#!/usr/bin/env node
import assert from "node:assert/strict";
import pg from "pg";
const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const u = new URL(connectionString);
if (!["127.0.0.1","localhost","::1"].includes(u.hostname) && process.env.PHASE20_ALLOW_REMOTE_REHEARSAL !== "1") {
  throw new Error("Phase20 expand/contract rehearsal REFUSED non-loopback database");
}
const pool = new Pool({ connectionString, max: 4 });
const scalar = async (sql, params=[]) => (await pool.query(sql,params)).rows[0];
try {
  await pool.query("drop schema if exists phase20_rehearsal cascade; create schema phase20_rehearsal");
  await pool.query(`
    create table phase20_rehearsal.account_state(
      id bigint generated always as identity primary key,
      legacy_state text not null check (legacy_state in ('active','paused')),
      payload text not null
    );
    insert into phase20_rehearsal.account_state(legacy_state,payload)
    select case when g%3=0 then 'paused' else 'active' end, 'row-'||g
    from generate_series(1,2000) g;
  `);
  const before = await scalar(`select count(*)::int n, md5(string_agg(id||':'||legacy_state||':'||payload,',' order by id)) digest from phase20_rehearsal.account_state`);

  // EXPAND: additive column + compatibility reader. Old readers still see legacy_state.
  await pool.query(`
    alter table phase20_rehearsal.account_state add column state_v2 text;
    create view phase20_rehearsal.account_state_compat as
      select id, coalesce(state_v2,legacy_state) as state, payload
      from phase20_rehearsal.account_state;
  `);
  assert.equal((await scalar("select count(*)::int n from phase20_rehearsal.account_state where legacy_state is not null")).n, 2000);

  // BACKFILL in bounded batches; safe to resume.
  let total=0;
  while (true) {
    const r=await pool.query(`
      with batch as (
        select id from phase20_rehearsal.account_state
        where state_v2 is null order by id limit 137
        for update skip locked
      )
      update phase20_rehearsal.account_state a
      set state_v2=a.legacy_state
      from batch b where a.id=b.id
      returning a.id
    `);
    total += r.rowCount;
    if (r.rowCount===0) break;
  }
  assert.equal(total,2000);
  assert.equal((await scalar("select count(*)::int n from phase20_rehearsal.account_state where state_v2 is null")).n,0);

  // COMPATIBILITY: old and new state are identical before contract.
  const mismatch = await scalar("select count(*)::int n from phase20_rehearsal.account_state where state_v2 is distinct from legacy_state");
  assert.equal(mismatch.n,0);
  const compat = await scalar("select count(*)::int n from phase20_rehearsal.account_state_compat where state in ('active','paused')");
  assert.equal(compat.n,2000);

  // Rollback checkpoint exists before destructive contract.
  await pool.query("create table phase20_rehearsal.rollback_checkpoint as table phase20_rehearsal.account_state");
  assert.equal((await scalar("select count(*)::int n from phase20_rehearsal.rollback_checkpoint")).n,2000);

  // CONTRACT only after backfill + compatibility proof.
  await pool.query(`
    drop view phase20_rehearsal.account_state_compat;
    alter table phase20_rehearsal.account_state alter column state_v2 set not null;
    alter table phase20_rehearsal.account_state add constraint account_state_v2_valid check (state_v2 in ('active','paused')) not valid;
    alter table phase20_rehearsal.account_state validate constraint account_state_v2_valid;
    alter table phase20_rehearsal.account_state drop column legacy_state;
    alter table phase20_rehearsal.account_state rename column state_v2 to state;
  `);
  const after = await scalar(`select count(*)::int n, md5(string_agg(id||':'||state||':'||payload,',' order by id)) digest from phase20_rehearsal.account_state`);
  assert.equal(after.n,before.n);
  assert.equal(after.digest,before.digest);
  assert.equal((await scalar("select count(*)::int n from information_schema.columns where table_schema='phase20_rehearsal' and table_name='account_state' and column_name='legacy_state'")).n,0);
  console.log("Phase20 expand/backfill/compatibility/contract rehearsal PASS");
  console.log(JSON.stringify({rows:before.n,batches:Math.ceil(total/137),semanticDigestPreserved:true,rollbackCheckpoint:true,productionMutation:false},null,2));
} finally {
  await pool.query("drop schema if exists phase20_rehearsal cascade").catch(()=>undefined);
  await pool.end();
}
