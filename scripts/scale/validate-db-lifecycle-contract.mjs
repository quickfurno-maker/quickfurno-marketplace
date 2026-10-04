#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20261004190002_scale_phase09_data_lifecycle.sql"),
  "utf8",
);
const policy = readFileSync(join(root, "lib/database/scalePolicy.ts"), "utf8");

const runtimeRoots = ["app", "lib", "services"].map((p) => join(root, p));
const runtimeFiles = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const s = statSync(path);
    if (s.isDirectory()) walk(path);
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/u.test(name)) runtimeFiles.push(path);
  }
}
for (const dir of runtimeRoots) walk(dir);

const runtimeText = runtimeFiles
  .filter((path) => !path.endsWith("lib/database/scalePolicy.ts"))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

function check(name, fn) {
  try {
    fn();
    console.log("PASS " + name);
  } catch (error) {
    console.error("FAIL " + name + ": " + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

check("QuickFurno runtime declares Supabase Data API and no pg.Pool", () => {
  assert.match(policy, /runtimeConnectionMode:\s*"SUPABASE_DATA_API"/);
  assert.match(policy, /runtimeCreatesPgPool:\s*false/);
  assert.doesNotMatch(runtimeText, /from\s+["']pg["']|require\(["']pg["']\)|\bnew\s+Pool\s*\(/);
});

check("future transient SQL is pooled but session-state work stays direct/session mode", () => {
  assert.match(policy, /SUPAVISOR_TRANSACTION_WHEN_SESSION_STATE_FREE/);
  assert.match(policy, /migrationMode:\s*"DIRECT_OR_SESSION"/);
});

check("read replicas are opt-in and correctness reads remain primary", () => {
  for (const name of [
    "lead_assignment",
    "credit_balance",
    "payment_state",
    "consent_state",
    "idempotency_replay",
    "job_claim",
    "post_write_confirmation",
  ]) {
    assert.ok(policy.includes('"' + name + '"'));
  }
  assert.match(policy, /"PRIMARY_STRONG"/);
  assert.match(policy, /"REPLICA_EVENTUAL"/);
  assert.doesNotMatch(runtimeText, /REPLICA_DATABASE_URL|READ_REPLICA_URL/);
});

check("lifecycle registry exists and only reviewed operational policies auto-delete", () => {
  assert.match(migration, /create table if not exists public\.data_lifecycle_policies/i);
  const enabled = [...migration.matchAll(/'([^']+_v1)'[\s\S]{0,260}?false,true,/g)].map((m) => m[1]);
  assert.deepEqual(enabled.sort(), [
    "automation_transport_requests_v1",
    "communication_webhook_receipts_v1",
  ]);
});

check("protected business and audit evidence has auto-delete disabled", () => {
  for (const table of [
    "communication_conversation_events",
    "communication_delivery_events",
    "automation_execution_attempts",
    "audit_logs",
    "lead_matching_runs",
    "vendor_campaign_events",
  ]) {
    const at = migration.indexOf("'public." + table + "'");
    assert.ok(at >= 0, table + " policy missing");
    const excerpt = migration.slice(at, at + 340);
    assert.match(excerpt, /true,false,/);
  }
});

check("pruner is hard-bounded and refuses near-live cutoffs", () => {
  assert.match(migration, /least\(greatest\(coalesce\(p_limit,500\),1\),1000\)/);
  assert.match(migration, /p_before > now\(\) - interval '24 hours'/);
  assert.match(migration, /for update skip locked/);
});

check("pruner has exactly two hardcoded deletion targets", () => {
  const targets = [...migration.matchAll(/delete from public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
  assert.deepEqual([...new Set(targets)].sort(), [
    "automation_transport_requests",
    "communication_webhook_receipts",
  ]);
});

check("retention scans have partial ordered indexes", () => {
  assert.match(migration, /idx_automation_transport_requests_retention/i);
  assert.match(migration, /where finalized_at is not null/i);
  assert.match(migration, /idx_communication_webhook_receipts_retention/i);
  assert.match(migration, /processing_status in \('processed','ignored'\)/i);
});

check("Phase 09 introduces no table partition rewrite", () => {
  assert.doesNotMatch(migration, /partition by|attach partition|detach partition/i);
});

if (process.exitCode) process.exit(process.exitCode);
console.log("QuickFurno Phase 09 database lifecycle contract PASS");
