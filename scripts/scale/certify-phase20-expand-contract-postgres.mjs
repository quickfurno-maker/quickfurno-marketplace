#!/usr/bin/env node
import assert from "node:assert/strict";
import pg from "pg";
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || "postgresql://qf_phase20:qf_phase20_ci_only@127.0.0.1:5432/qf_phase20";
const pool = new Pool({ connectionString, max: 4, application_name: "qf-phase20-expand-contract" });
const s = "phase20_rehearsal";

try {
  await pool.query(`drop schema if exists ${s} cascade; create schema ${s}`);
  await pool.query(`
    create table ${s}.customer_profile(
      id bigint primary key,
      display_name_v1 text not null,
      row_revision integer not null default 1
    );
    insert into ${s}.customer_profile(id,display_name_v1)
    select g,'customer-'||g from generate_series(1,100) g;
  `);

  // EXPAND: additive + nullable, so the old binary remains valid.
  await pool.query(`alter table ${s}.customer_profile add column display_name_v2 text`);
  await pool.query(`create index customer_profile_display_name_v2_idx on ${s}.customer_profile(lower(display_name_v2))`);

  // Old and new application versions coexist.
  await pool.query(`insert into ${s}.customer_profile(id,display_name_v1) values (101,'legacy-writer')`);
  await pool.query(`insert into ${s}.customer_profile(id,display_name_v1,display_name_v2) values (102,'dual-writer','dual-writer')`);
  const coexist = await pool.query(`select id,coalesce(display_name_v2,display_name_v1) as name from ${s}.customer_profile where id in (101,102) order by id`);
  assert.deepEqual(coexist.rows.map((r) => r.name), ["legacy-writer","dual-writer"]);

  // Bounded backfill: never rewrite the whole relation in one unbounded statement.
  let backfilled = 0;
  for (;;) {
    const r = await pool.query(`
      with batch as (
        select id from ${s}.customer_profile
        where display_name_v2 is null
        order by id
        limit 25
        for update skip locked
      )
      update ${s}.customer_profile p
      set display_name_v2=p.display_name_v1, row_revision=row_revision+1
      from batch where p.id=batch.id
      returning p.id
    `);
    backfilled += r.rowCount;
    if (r.rowCount === 0) break;
    assert.ok(r.rowCount <= 25);
  }
  assert.equal(backfilled, 101);

  const complete = await pool.query(`select count(*)::int as n from ${s}.customer_profile where display_name_v2 is null`);
  assert.equal(complete.rows[0].n, 0);

  // CUTOVER then CONTRACT only after old-writer drain has been proven.
  await pool.query(`alter table ${s}.customer_profile alter column display_name_v2 set not null`);
  const before = await pool.query(`select count(*)::int as n from ${s}.customer_profile`);
  assert.equal(before.rows[0].n, 102);
  await pool.query(`alter table ${s}.customer_profile drop column display_name_v1`);
  await pool.query(`alter table ${s}.customer_profile rename column display_name_v2 to display_name`);

  let oldWriterRejected = false;
  try {
    await pool.query(`insert into ${s}.customer_profile(id,display_name_v1) values (103,'must-fail')`);
  } catch (error) {
    oldWriterRejected = error?.code === "42703";
  }
  assert.equal(oldWriterRejected, true);
  await pool.query(`insert into ${s}.customer_profile(id,display_name) values (103,'new-writer')`);

  const final = await pool.query(`select count(*)::int as n, count(*) filter(where display_name is null)::int as nulls from ${s}.customer_profile`);
  assert.deepEqual(final.rows[0], { n: 103, nulls: 0 });

  console.log("QuickFurno Phase 20 expand/contract PostgreSQL rehearsal PASS");
  console.log(JSON.stringify({
    baselineRows: 100,
    oldNewCoexistence: true,
    boundedBackfillBatch: 25,
    backfilledRows: backfilled,
    preContractRows: 102,
    oldWriterRejectedAfterContract: true,
    finalRows: 103,
    productionMutation: false
  }, null, 2));
} finally {
  await pool.query(`drop schema if exists ${s} cascade`).catch(() => undefined);
  await pool.end();
}
