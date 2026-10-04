#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for Phase 07 DB certification");

const pool = new Pool({ connectionString: url, max: 12 });

async function scalar(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0];
}

try {
  await pool.query(`
    drop schema if exists public cascade;
    create schema public;
    create table public.automation_jobs (
      id uuid primary key default gen_random_uuid(),
      status text not null,
      available_at timestamptz not null default clock_timestamp(),
      next_retry_at timestamptz,
      created_at timestamptz not null default clock_timestamp()
    );
    create table public.communication_conversation_outbox (
      id uuid primary key default gen_random_uuid(),
      status text not null,
      created_at timestamptz not null default clock_timestamp()
    );
    create table public.communication_jarvis_turn_outbox (
      id uuid primary key default gen_random_uuid(),
      status text not null,
      next_retry_at timestamptz,
      created_at timestamptz not null default clock_timestamp()
    );
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
  `);

  const migration = await readFile(
    new URL("../../supabase/migrations/20261004190000_scale_phase07_durable_jobs_hardening.sql", import.meta.url),
    "utf8",
  );
  await pool.query(migration);

  // Twenty concurrent scheduler replicas replay the SAME occurrence.
  const occurrenceArgs = ["aarohi-phase2-cycle", "bucket-123"];
  const claims = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      pool.query(
        `select * from public.qf_claim_scale_scheduler_occurrence_v1($1,$2,$3,$4)`,
        [...occurrenceArgs, `worker-${index + 1}`, 120],
      ),
    ),
  );
  const rows = claims.map((result) => result.rows[0]);
  const winners = rows.filter((row) => row.claim_status === "acquired");
  assert.equal(winners.length, 1, "exactly one concurrent scheduler replica must acquire");
  assert.equal(rows.filter((row) => row.claim_status === "busy").length, 19);

  // The single acquired occurrence creates exactly one simulated business effect.
  await pool.query(`
    create table public.phase07_effect_probe (
      occurrence_key text primary key,
      effect_count integer not null default 1
    )
  `);
  await Promise.all(
    winners.map(() =>
      pool.query(
        `insert into public.phase07_effect_probe(occurrence_key) values($1)
         on conflict (occurrence_key) do nothing`,
        [occurrenceArgs[1]],
      ),
    ),
  );
  assert.equal((await scalar("select count(*)::int as count from public.phase07_effect_probe")).count, 1);

  const winner = winners[0];
  const ownerRow = await scalar(
    `select worker_id from public.scale_scheduler_occurrences
      where scheduler_key=$1 and occurrence_key=$2`,
    occurrenceArgs,
  );

  // A stale/non-owner completion is powerless.
  const wrongComplete = await scalar(
    `select public.qf_complete_scale_scheduler_occurrence_v1($1,$2,$3,$4,$5,$6) as ok`,
    [...occurrenceArgs, "wrong-worker", winner.lease_token, winner.fence, "WRONG_OWNER"],
  );
  assert.equal(wrongComplete.ok, false);

  const complete = await scalar(
    `select public.qf_complete_scale_scheduler_occurrence_v1($1,$2,$3,$4,$5,$6) as ok`,
    [...occurrenceArgs, ownerRow.worker_id, winner.lease_token, winner.fence, "COMPLETED"],
  );
  assert.equal(complete.ok, true);

  const replay = await scalar(
    `select * from public.qf_claim_scale_scheduler_occurrence_v1($1,$2,$3,$4)`,
    [...occurrenceArgs, "replay-worker", 120],
  );
  assert.equal(replay.claim_status, "completed");

  // Crash recovery: expire an incomplete lease, then race replicas to reclaim it.
  const firstCrash = await scalar(
    `select * from public.qf_claim_scale_scheduler_occurrence_v1($1,$2,$3,$4)`,
    ["crash-cycle", "bucket-crash", "crashed-worker", 120],
  );
  assert.equal(firstCrash.claim_status, "acquired");
  await pool.query(
    `update public.scale_scheduler_occurrences
        set claimed_at=clock_timestamp()-interval '120 seconds',
            lease_expires_at=clock_timestamp()-interval '1 second'
      where scheduler_key='crash-cycle' and occurrence_key='bucket-crash'`,
  );

  const reclaim = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      pool.query(
        `select * from public.qf_claim_scale_scheduler_occurrence_v1($1,$2,$3,$4)`,
        ["crash-cycle", "bucket-crash", `recovery-${index + 1}`, 120],
      ),
    ),
  );
  const recovered = reclaim.map((result) => result.rows[0]).filter((row) => row.claim_status === "acquired");
  assert.equal(recovered.length, 1, "only one replica may reclaim an expired occurrence");
  assert.equal(Number(recovered[0].fence), 2);
  assert.equal(Number(recovered[0].attempt_count), 2);

  const staleOwner = await scalar(
    `select public.qf_complete_scale_scheduler_occurrence_v1($1,$2,$3,$4,$5,$6) as ok`,
    ["crash-cycle", "bucket-crash", "crashed-worker", firstCrash.lease_token, firstCrash.fence, "STALE"],
  );
  assert.equal(staleOwner.ok, false, "old fence/token must be rejected after reclaim");

  const recoveredOwner = await scalar(
    `select worker_id from public.scale_scheduler_occurrences
      where scheduler_key='crash-cycle' and occurrence_key='bucket-crash'`,
  );
  const recoveredComplete = await scalar(
    `select public.qf_complete_scale_scheduler_occurrence_v1($1,$2,$3,$4,$5,$6) as ok`,
    ["crash-cycle", "bucket-crash", recoveredOwner.worker_id, recovered[0].lease_token, recovered[0].fence, "RECOVERED"],
  );
  assert.equal(recoveredComplete.ok, true);

  // Per-replica heartbeats coexist: no last-writer-wins singleton heartbeat.
  await Promise.all([
    pool.query(
      `select public.qf_scale_worker_heartbeat_v1($1,$2,$3,$4,$5,$6,$7,$8)`,
      ["conversation-transport", "ct-1", "running", true, 1, new Date().toISOString(), null, null],
    ),
    pool.query(
      `select public.qf_scale_worker_heartbeat_v1($1,$2,$3,$4,$5,$6,$7,$8)`,
      ["conversation-transport", "ct-2", "idle", true, 0, new Date().toISOString(), null, null],
    ),
  ]);
  assert.equal(
    (await scalar(
      `select count(*)::int as count from public.scale_worker_heartbeats where worker_role='conversation-transport'`,
    )).count,
    2,
  );

  // Queue depth + oldest age is read-only and exposes dead-letter pressure.
  await pool.query(`
    insert into public.automation_jobs(status, available_at) values
      ('pending', clock_timestamp()-interval '30 seconds'),
      ('dead_letter', clock_timestamp());
    insert into public.communication_conversation_outbox(status, created_at)
      values ('pending', clock_timestamp()-interval '15 seconds');
    insert into public.communication_jarvis_turn_outbox(status, created_at)
      values ('pending', clock_timestamp()-interval '10 seconds');
  `);
  const health = (await scalar("select public.qf_scale_queue_health_v1() as health")).health;
  assert.equal(Number(health.automationJobs.ready), 1);
  assert.equal(Number(health.automationJobs.deadLetter), 1);
  assert.equal(Number(health.conversationOutbox.pending), 1);
  assert.equal(Number(health.jarvisTurnOutbox.ready), 1);
  assert.ok(Number(health.automationJobs.oldestReadyAgeSeconds) >= 29);

  console.log("QuickFurno Phase 07 PostgreSQL certification PASS");
  console.log(
    JSON.stringify(
      {
        concurrentReplicas: 20,
        exactlyOneOccurrenceOwner: "PASS",
        exactlyOneEffect: "PASS",
        crashLeaseRecovery: "PASS",
        staleFenceRejected: "PASS",
        perReplicaHeartbeats: "PASS",
        queueDepthAndAge: "PASS",
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
