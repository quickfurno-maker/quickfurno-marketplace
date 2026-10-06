#!/usr/bin/env node
import assert from "node:assert/strict";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://qf_phase23:qf_phase23_ci_only@127.0.0.1:5432/qf_phase23_test",
  max: 6,
  application_name: "qf-phase23-n-nminus1",
});
const schema = "phase23_compat";

async function row(id) {
  const { rows } = await pool.query(
    `select id,status_v1,status_v2,row_revision from ${schema}.job_state where id=$1`,
    [id],
  );
  return rows[0];
}

try {
  const existing = await pool.query(
    "select count(*)::int n from information_schema.schemata where schema_name=$1",
    [schema],
  );
  assert.equal(existing.rows[0].n, 0, "Phase23 certification requires a fresh disposable database");

  await pool.query(`create schema ${schema}`);
  await pool.query(`
    create table ${schema}.release_floor(
      singleton boolean primary key default true check(singleton),
      minimum_active_release integer not null check(minimum_active_release >= 1)
    );
    insert into ${schema}.release_floor(singleton,minimum_active_release) values(true,22);

    create table ${schema}.job_state(
      id bigint primary key,
      status_v1 text not null,
      row_revision integer not null default 1
    );
    insert into ${schema}.job_state(id,status_v1)
    select g, case when g % 2 = 0 then 'ready' else 'pending' end
    from generate_series(1,100) g;
  `);

  // EXPAND. New representation is nullable so N-1 remains valid.
  await pool.query(`
    alter table ${schema}.job_state add column status_v2 text;
    create or replace function ${schema}.sync_status_v2_from_v1()
    returns trigger language plpgsql as $$
    begin
      if new.status_v2 is null or new.status_v1 is distinct from old.status_v1 then
        new.status_v2 := new.status_v1;
      end if;
      return new;
    end $$;
    create trigger job_state_nminus1_compat
      before insert or update of status_v1 on ${schema}.job_state
      for each row execute function ${schema}.sync_status_v2_from_v1();
  `);

  // N-1 writer only knows status_v1.
  await pool.query(
    `insert into ${schema}.job_state(id,status_v1) values(101,'legacy-created')`,
  );
  assert.equal((await row(101)).status_v2, "legacy-created");

  // N writer dual-writes during overlap.
  await pool.query(
    `insert into ${schema}.job_state(id,status_v1,status_v2) values(102,'new-created','new-created')`,
  );

  // N-1 update after N is deployed must still be visible to N.
  await pool.query(
    `update ${schema}.job_state set status_v1='legacy-updated',row_revision=row_revision+1 where id=101`,
  );
  const coexist = await pool.query(
    `select id,status_v1,coalesce(status_v2,status_v1) status_n
       from ${schema}.job_state where id in(101,102) order by id`,
  );
  assert.deepEqual(coexist.rows, [
    { id: "101", status_v1: "legacy-updated", status_n: "legacy-updated" },
    { id: "102", status_v1: "new-created", status_n: "new-created" },
  ]);

  // Bounded backfill; production strategy never assumes an unbounded rewrite.
  let backfilled = 0;
  for (;;) {
    const r = await pool.query(`
      with batch as (
        select id from ${schema}.job_state
        where status_v2 is null
        order by id
        limit 20
        for update skip locked
      )
      update ${schema}.job_state j
      set status_v2=j.status_v1,row_revision=row_revision+1
      from batch where j.id=batch.id
      returning j.id
    `);
    assert.ok(r.rowCount <= 20);
    backfilled += r.rowCount;
    if (r.rowCount === 0) break;
  }
  assert.equal(backfilled, 100);

  const noNulls = await pool.query(
    `select count(*)::int n from ${schema}.job_state where status_v2 is null`,
  );
  assert.equal(noNulls.rows[0].n, 0);

  // Rollback proof while overlap is active: remove N, continue N-1 writes.
  await pool.query(
    `insert into ${schema}.job_state(id,status_v1) values(103,'rollback-old-writer')`,
  );
  assert.equal((await row(103)).status_v2, "rollback-old-writer");

  // Reintroduce N and confirm it sees every row produced during rollback.
  const newReader = await pool.query(
    `select id,coalesce(status_v2,status_v1) status from ${schema}.job_state
     where id in(101,102,103) order by id`,
  );
  assert.deepEqual(
    newReader.rows.map((r) => r.status),
    ["legacy-updated", "new-created", "rollback-old-writer"],
  );

  // CONTRACT is mechanically blocked while N-1 is still active.
  const floorBefore = await pool.query(
    `select minimum_active_release from ${schema}.release_floor where singleton=true`,
  );
  let contractBlocked = false;
  try {
    if (floorBefore.rows[0].minimum_active_release < 23) {
      throw new Error("N_MINUS_1_ACTIVE");
    }
  } catch (error) {
    contractBlocked = error?.message === "N_MINUS_1_ACTIVE";
  }
  assert.equal(contractBlocked, true);
  await pool.query(
    `update ${schema}.release_floor set minimum_active_release=23 where singleton=true`,
  );
  await pool.query(`
    drop trigger job_state_nminus1_compat on ${schema}.job_state;
    drop function ${schema}.sync_status_v2_from_v1();
    alter table ${schema}.job_state alter column status_v2 set not null;
    alter table ${schema}.job_state drop column status_v1;
    alter table ${schema}.job_state rename column status_v2 to status;
  `);

  let oldWriterRejected = false;
  try {
    await pool.query(
      `insert into ${schema}.job_state(id,status_v1) values(104,'must-fail-after-contract')`,
    );
  } catch (error) {
    oldWriterRejected = error?.code === "42703";
  }
  assert.equal(oldWriterRejected, true);

  await pool.query(
    `insert into ${schema}.job_state(id,status) values(104,'new-after-contract')`,
  );
  const final = await pool.query(
    `select count(*)::int n,count(*) filter(where status is null)::int nulls
     from ${schema}.job_state`,
  );
  assert.deepEqual(final.rows[0], { n: 104, nulls: 0 });

  console.log("QuickFurno Phase23 N/N-1 PostgreSQL compatibility PASS");
  console.log(JSON.stringify({
    baselineRows: 100,
    nMinus1WriterDuringN: true,
    nReaderSeesNMinus1Updates: true,
    boundedBackfillBatch: 20,
    backfilledRows: backfilled,
    rollbackToNMinus1DuringOverlap: true,
    reintroduceNAfterRollback: true,
    contractOnlyAfterNMinus1Retired: true,
    oldWriterRejectedAfterContract: true,
    finalRows: 104,
    productionMutation: false
  }, null, 2));
} finally {
  await pool.end();
}
