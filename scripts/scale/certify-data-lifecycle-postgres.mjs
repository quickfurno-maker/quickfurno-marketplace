#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://qf_phase08:phase08local@127.0.0.1:15434/qf_phase09";
const pool = new Pool({ connectionString, max: 8 });

async function count(table, where = "true") {
  const result = await pool.query("select count(*)::int as n from public." + table + " where " + where);
  return result.rows[0].n;
}

try {
  await pool.query("drop schema if exists public cascade; create schema public;");
  for (const role of ["anon", "authenticated", "service_role"]) {
    const present = await pool.query("select 1 from pg_roles where rolname=$1", [role]);
    if (present.rowCount === 0) {
      await pool.query("create role " + role + " noinherit");
    }
  }

  await pool.query(`
    create table public.automation_transport_requests(
      id uuid primary key,
      created_at timestamptz not null,
      finalized_at timestamptz
    );
    create table public.communication_webhook_receipts(
      id uuid primary key,
      processing_status text not null,
      processed_at timestamptz,
      created_at timestamptz not null
    );
    create table public.audit_logs(
      id uuid primary key,
      created_at timestamptz not null
    );
  `);

  const migration = await readFile(
    new URL("../../supabase/migrations/20261004190002_scale_phase09_data_lifecycle.sql", import.meta.url),
    "utf8",
  );
  await pool.query(migration);

  await pool.query(`
    insert into public.automation_transport_requests(id,created_at,finalized_at)
    select md5('old-final-'||g)::uuid, now()-interval '90 days', now()-interval '89 days'
    from generate_series(1,1200) g;
    insert into public.automation_transport_requests(id,created_at,finalized_at)
    select md5('recent-final-'||g)::uuid, now()-interval '5 days', now()-interval '4 days'
    from generate_series(1,100) g;
    insert into public.automation_transport_requests(id,created_at,finalized_at)
    select md5('old-open-'||g)::uuid, now()-interval '90 days', null
    from generate_series(1,100) g;

    insert into public.communication_webhook_receipts(id,processing_status,processed_at,created_at)
    select md5('old-webhook-'||g)::uuid,
           case when g%2=0 then 'processed' else 'ignored' end,
           now()-interval '399 days', now()-interval '400 days'
    from generate_series(1,1100) g;
    insert into public.communication_webhook_receipts(id,processing_status,processed_at,created_at)
    select md5('recent-webhook-'||g)::uuid,'processed',now()-interval '9 days',now()-interval '10 days'
    from generate_series(1,100) g;
    insert into public.communication_webhook_receipts(id,processing_status,processed_at,created_at)
    select md5('pending-webhook-'||g)::uuid,'pending',null,now()-interval '400 days'
    from generate_series(1,100) g;

    insert into public.audit_logs(id,created_at)
    select md5('audit-'||g)::uuid, now()-interval '3000 days'
    from generate_series(1,25) g;
  `);

  const beforeAutomation = await count("automation_transport_requests");
  assert.equal(beforeAutomation, 1400);

  const [first, second] = await Promise.all([
    pool.query(
      "select public.qf_prune_operational_history_v1($1,now()-interval '30 days',$2) as result",
      ["automation_transport_requests_v1", 500],
    ),
    pool.query(
      "select public.qf_prune_operational_history_v1($1,now()-interval '30 days',$2) as result",
      ["automation_transport_requests_v1", 500],
    ),
  ]);
  assert.equal(first.rows[0].result.deleted + second.rows[0].result.deleted, 1000);

  const third = await pool.query(
    "select public.qf_prune_operational_history_v1($1,now()-interval '30 days',$2) as result",
    ["automation_transport_requests_v1", 500],
  );
  assert.equal(third.rows[0].result.deleted, 200);
  assert.equal(await count("automation_transport_requests"), 200);
  assert.equal(await count("automation_transport_requests", "finalized_at is null"), 100);

  const nearLive = await pool.query(
    "select public.qf_prune_operational_history_v1($1,now()-interval '1 hour',$2) as result",
    ["automation_transport_requests_v1", 1000],
  );
  assert.equal(nearLive.rows[0].result.status, "rejected");
  assert.equal(nearLive.rows[0].result.reason_code, "cutoff_too_recent");

  const w1 = await pool.query(
    "select public.qf_prune_operational_history_v1($1,now()-interval '365 days',$2) as result",
    ["communication_webhook_receipts_v1", 1000],
  );
  const w2 = await pool.query(
    "select public.qf_prune_operational_history_v1($1,now()-interval '365 days',$2) as result",
    ["communication_webhook_receipts_v1", 1000],
  );
  assert.equal(w1.rows[0].result.deleted, 1000);
  assert.equal(w2.rows[0].result.deleted, 100);
  assert.equal(await count("communication_webhook_receipts"), 200);
  assert.equal(await count("communication_webhook_receipts", "processing_status='pending'"), 100);

  const protectedAttempt = await pool.query(
    "select public.qf_prune_operational_history_v1($1,now()-interval '365 days',$2) as result",
    ["audit_logs_v1", 1000],
  );
  assert.equal(protectedAttempt.rows[0].result.status, "rejected");
  assert.equal(protectedAttempt.rows[0].result.reason_code, "policy_not_auto_prunable");
  assert.equal(await count("audit_logs"), 25);

  const policyRows = await pool.query(
    "select policy_key,auto_delete_enabled,archive_required_before_delete from public.data_lifecycle_policies order by policy_key",
  );
  const enabled = policyRows.rows.filter((row) => row.auto_delete_enabled).map((row) => row.policy_key);
  assert.deepEqual(enabled, [
    "automation_transport_requests_v1",
    "communication_webhook_receipts_v1",
  ]);

  console.log("QuickFurno Phase 09 lifecycle PostgreSQL certification PASS");
  console.log(JSON.stringify({
    automation: {
      initial: 1400,
      pruned: 1200,
      retainedRecentOrOpen: 200,
      concurrentBatchExact: true,
    },
    webhook: {
      initial: 1300,
      pruned: 1100,
      retainedRecentOrPending: 200,
    },
    protectedAuditRows: 25,
    maxBatch: 1000,
    nearLiveCutoffRejected: true,
  }, null, 2));
} finally {
  await pool.end();
}
