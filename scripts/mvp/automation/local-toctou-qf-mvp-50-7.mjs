#!/usr/bin/env node
// ============================================================================
// QF-MVP-50.7 — LOCAL two-transaction concurrency proof (opt-in, Docker required)
//
// This is NOT part of the offline CI gate: it needs a container runtime, so it is
// run deliberately with `npm run test:mvp:50-7-toctou`. The offline gate proves
// the lock ORDER structurally; this proves the lock BEHAVIOUR empirically.
//
// IT TOUCHES NO REAL DATABASE. It starts its own throwaway Postgres with NO
// published port — every session connects through `docker exec`, so the container
// is unreachable from the host network and cannot collide with a local Supabase,
// let alone staging or production. It is destroyed on exit.
//
// It loads the REAL shipped function bodies verbatim out of the migration files
// (the QF-MVP-50.6 entity authority and the 50.7 threshold reader, business-state
// and terminalization functions) onto a minimal fixture schema, so what is under
// test is the code that ships — not a paraphrase of it.
//
// What it proves:
//   1. a concurrent business recovery CANNOT commit while the lane holds its locks
//   2. the missing-CRM phantom INSERT is blocked by FOR UPDATE on the parent
//      vendors row (the FK takes FOR KEY SHARE, which FOR UPDATE conflicts with)
//   3. a recovery that wins BEFORE lock acquisition makes the job unselectable
//   4. a genuinely stale job still terminalizes, with no attempt, no message and
//      no mutation of any business row
// ============================================================================

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const NAME = "qf-50-7-toctou";
const PSQL = ["exec", "-i", NAME, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"];
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const docker = (args, opts = {}) => spawnSync("docker", args, { encoding: "utf8", ...opts });
const psql = (sql) => docker([...PSQL, "-c", sql]);
const psqlFile = (file) => docker([...PSQL], { input: readFileSync(file, "utf8") });

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok === true);
  console.log(`${ok ? "  PASS  " : "  FAIL  "}${name}${detail ? "  " + detail : ""}`);
};

/** Pull a function definition verbatim out of a migration file. */
function extract(rel, startMarker, endMarker) {
  const s = read(rel);
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error(`could not extract ${startMarker} from ${rel}`);
  return s.slice(a, b);
}

const ORPHAN = "supabase/migrations/20260905000000_qf_mvp_50_6_automation_orphan_cancellation.sql";
const STALE = "supabase/migrations/20260906000000_qf_mvp_50_7_automation_stale_business_cancellation.sql";

const FIXTURE = `
create table public.vendors (
  id uuid primary key, business_name text, package_status text,
  package_expires_at timestamptz, remaining_credits integer, updated_by text);
-- FK and PK reproduced EXACTLY as in 20260723001100: the phantom proof depends on
-- the FK taking FOR KEY SHARE on the parent row.
create table public.vendor_crm_profiles (
  vendor_id uuid not null, onboarding_stage text not null default 'new',
  constraint vcp_pkey primary key (vendor_id),
  constraint vcp_vendor_fk foreign key (vendor_id)
    references public.vendors (id) on update restrict on delete restrict);
create table public.lead_assignments (id uuid primary key, vendor_id uuid, vendor_status text);
create table public.leads (id uuid primary key);
create table public.communication_intents (id uuid primary key);
create table public.automation_policy_configs (
  id uuid primary key, policy_key text not null, config_json jsonb not null,
  unique (policy_key, id));
create table public.automation_policy_active_configs (
  policy_key text primary key, config_id uuid not null,
  constraint apac_fk foreign key (policy_key, config_id)
    references public.automation_policy_configs(policy_key, id));
create table public.automation_action_requests (
  id uuid primary key, action_type text not null, entity_type text not null,
  entity_id text not null, idempotency_key text);
create table public.automation_jobs (
  id uuid primary key, action_request_id uuid not null references public.automation_action_requests(id),
  status text not null, attempt_count integer not null default 0, max_attempts integer not null default 5,
  next_retry_at timestamptz, locked_at timestamptz, locked_by text,
  last_result_classification text, last_safe_code text,
  available_at timestamptz not null default now(), completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.automation_transport_requests (
  id uuid primary key, route_key text not null, job_id uuid, action_request_id uuid,
  state text not null default 'processing');
create table public.automation_execution_attempts (id uuid primary key, job_id uuid not null);
create table public.communication_messages (id uuid primary key, idempotency_key text);
`;

async function main() {
  if (docker(["--version"]).status !== 0) {
    console.log("SKIPPED: docker is not available; this harness is opt-in and needs a container runtime.");
    process.exit(0);
  }
  docker(["rm", "-f", NAME]);
  const up = docker(["run", "-d", "--name", NAME, "-e", "POSTGRES_PASSWORD=x", "postgres:17-alpine"]);
  if (up.status !== 0) {
    console.log("could not start the disposable postgres:", (up.stderr || "").slice(0, 300));
    process.exit(2);
  }

  try {
    // Wait on a REAL query: pg_isready briefly succeeds before the client socket exists.
    let ready = false;
    for (let i = 0; i < 90; i += 1) {
      if (psql("select 1;").status === 0) { ready = true; break; }
      await sleep(1000);
    }
    if (!ready) { console.log("postgres never became connectable"); process.exit(2); }
    console.log("disposable postgres ready (no published port, destroyed on exit)");

    const dir = mkdtempSync(path.join(tmpdir(), "qf507-"));
    const fixtureFile = path.join(dir, "fixture.sql");
    writeFileSync(fixtureFile, FIXTURE, "utf8");
    if (psqlFile(fixtureFile).status !== 0) { console.log("fixture failed"); process.exit(2); }

    const fnFile = path.join(dir, "functions.sql");
    writeFileSync(fnFile, [
      extract(ORPHAN, "create or replace function public.qf_automation_entity_state_v1(",
        "comment on function public.qf_automation_entity_state_v1"),
      extract(STALE, "create or replace function public.qf_automation_low_credit_threshold_v1()",
        "comment on function public.qf_automation_low_credit_threshold_v1"),
      extract(STALE, "create or replace function public.qf_automation_vendor_business_state_v1(",
        "comment on function public.qf_automation_vendor_business_state_v1"),
      extract(STALE, "create or replace function public.qf_cancel_stale_automation_job_v1(",
        "comment on function public.qf_cancel_stale_automation_job_v1"),
    ].join("\n"), "utf8");
    const loaded = psqlFile(fnFile);
    if (loaded.status !== 0) {
      console.log("loading the REAL functions failed:", (loaded.stderr || "").slice(0, 900));
      process.exit(2);
    }
    console.log("loaded the REAL shipped function bodies verbatim\n");

    const vendorA = randomUUID(), vendorB = randomUUID(), assign = randomUUID();
    const jobRr = randomUUID(), reqRr = randomUUID(), jobOb = randomUUID(), reqOb = randomUUID();
    psql(`
      insert into public.vendors(id, business_name) values ('${vendorA}','A'), ('${vendorB}','B');
      insert into public.lead_assignments(id, vendor_id, vendor_status) values ('${assign}','${vendorA}','Contacted');
      insert into public.automation_action_requests(id, action_type, entity_type, entity_id, idempotency_key)
        values ('${reqRr}','vendor.response_reminder','lead_assignment','${assign}','v:x:resp2h'),
               ('${reqOb}','vendor.onboarding_reminder','vendor','${vendorB}','v:y');
      insert into public.automation_jobs(id, action_request_id, status, created_at)
        values ('${jobRr}','${reqRr}','retry_scheduled', now() - interval '2 days'),
               ('${jobOb}','${reqOb}','pending', now() - interval '1 day');`);

    const holdSql = (w) =>
      `begin; select job_id from public.qf_cancel_stale_automation_job_v1('${w}'); select pg_sleep(8); rollback;`;
    const hold = (w) => spawn("docker", [...PSQL, "-c", holdSql(w)], { encoding: "utf8" });
    const collect = (p) => new Promise((res) => {
      let out = ""; p.stdout.on("data", (d) => { out += d; }); p.on("close", () => res(out));
    });

    console.log("=== SCENARIO 1 - a business recovery cannot commit while the lane holds its locks ===");
    const a1 = hold("w1"); const a1out = collect(a1);
    await sleep(2500);
    const b1 = psql(`set lock_timeout='2500ms'; update public.lead_assignments set vendor_status='New' where id='${assign}';`);
    check("transaction B cannot recover vendor_status while A holds the assignment lock",
      b1.status !== 0 && /lock timeout|55P03/i.test(b1.stderr || ""));
    check("transaction A selected the stale job while holding that lock", (await a1out).includes(jobRr.slice(0, 8)));
    check("A rolled back, so the job is untouched",
      psql(`select status from public.automation_jobs where id='${jobRr}';`).stdout.includes("retry_scheduled"));

    console.log("\n=== SCENARIO 2 - the missing-CRM phantom is blocked by the PARENT lock ===");
    // Make the OLDER response-reminder job non-stale so the onboarding job (whose
    // vendor has no CRM row) is the selected candidate and vendor B gets locked.
    psql(`update public.lead_assignments set vendor_status='New' where id='${assign}';`);
    const a2 = hold("w2"); const a2out = collect(a2);
    await sleep(2500);
    const b2 = psql(`set lock_timeout='2500ms'; insert into public.vendor_crm_profiles(vendor_id, onboarding_stage) values ('${vendorB}','new');`);
    check("a concurrent CRM INSERT is blocked by FOR UPDATE on the parent vendors row",
      b2.status !== 0 && /lock timeout|55P03/i.test(b2.stderr || ""));
    await a2out;

    console.log("\n=== SCENARIO 3 - a recovery that wins BEFORE lock acquisition prevents cancellation ===");
    psql(`insert into public.vendor_crm_profiles(vendor_id, onboarding_stage) values ('${vendorB}','new')
          on conflict (vendor_id) do update set onboarding_stage='new';`);
    const sel = psql(`select coalesce((select job_id::text from public.qf_cancel_stale_automation_job_v1('w3')),'NONE');`);
    check("a recovered job is no longer selectable at all",
      sel.stdout.includes("NONE") && !sel.stdout.includes(jobRr.slice(0, 8)) && !sel.stdout.includes(jobOb.slice(0, 8)));
    check("and it remains queued, never cancelled",
      psql(`select status from public.automation_jobs where id='${jobRr}';`).stdout.includes("retry_scheduled"));

    console.log("\n=== SCENARIO 4 - a genuinely stale job still cancels, with no side effects ===");
    psql(`update public.lead_assignments set vendor_status='Contacted' where id='${assign}';`);
    check("one stale job is terminalized",
      psql(`select job_id from public.qf_cancel_stale_automation_job_v1('w4');`).stdout.includes(jobRr.slice(0, 8)));
    const shape = psql(`select status, attempt_count, last_result_classification is null,
      last_safe_code, next_retry_at is null from public.automation_jobs where id='${jobRr}';`).stdout;
    const row = (shape.split("\n").find((l) => l.includes("|") && l.includes("cancelled")) || "")
      .split("|").map((c) => c.trim());
    check("shape: cancelled / attempt_count 0 / classification null / fixed safe code / no retry",
      row.length === 5 && row[0] === "cancelled" && row[1] === "0" && row[2] === "t" &&
      row[3] === "QF_AUTOMATION_BUSINESS_STATE_NO_LONGER_ELIGIBLE" && row[4] === "t", JSON.stringify(row));
    check("no execution attempt was created",
      / 0/.test(psql("select count(*) from public.automation_execution_attempts;").stdout));
    check("no communication row was created",
      / 0/.test(psql("select count(*) from public.communication_messages;").stdout));
    check("the business row itself was NOT mutated by the lane",
      psql(`select vendor_status from public.lead_assignments where id='${assign}';`).stdout.includes("Contacted"));

    const passed = results.filter(Boolean).length;
    console.log(`\nQF-MVP-50.7 local TOCTOU: ${passed}/${results.length} PASS`);
    process.exitCode = passed === results.length ? 0 : 1;
  } finally {
    docker(["rm", "-f", NAME]);
    console.log("disposable container destroyed");
  }
}

main().catch((e) => { console.log("harness error:", e.message); docker(["rm", "-f", NAME]); process.exit(2); });
