import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 8B-1B-D6 WAVE 1 — delivery-event provider-account enforcement harness.
 *
 * THE INVARIANT UNDER TEST:
 *
 *     Every legitimate communication_delivery_events row must have a non-NULL
 *     provider_account_id at INSERT, enforced at the DATABASE boundary.
 *
 * The subject under test is a MIGRATION FILE, so the primary evidence is the exact DDL the
 * migration will execute — parsed, normalised and asserted against, not string-matched loosely.
 * Every static check runs against the parsed statement list, so a mutation that changes what the
 * database would actually do changes what these checks see.
 *
 * DATABASE PROBES ARE OPT-IN AND NEVER TOUCH PRODUCTION. Checks that require a live database
 * (accepting a bound insert, rejecting a NULL insert, FK enforcement, uniqueness preservation,
 * rollback) run ONLY when an approved LOCAL test DSN is supplied via D6W1_TEST_DATABASE_URL.
 * Without it they are reported as SKIPPED — never as passed. A skipped proof is an absent proof,
 * and this harness refuses to launder one into the other. There is no production DSN fallback,
 * no credential in this file, and no network call of any kind on the default path.
 *
 * The mutation runner classifies each mutation killed / survived / infra_fail. An INFRASTRUCTURE
 * failure is NEVER a kill, and a deliberate no-op mutation must SURVIVE — both are self-tested, so
 * a suite that trivially fails everything cannot masquerade as a suite that detects everything.
 */

const MIGRATION = "supabase/migrations/20260720000100_communication_delivery_event_provider_account_required.sql";
const TARGET_TABLE = "communication_delivery_events";
const CONSTRAINT_NAME = "communication_delivery_events_provider_account_required_check";
const COLUMN = "provider_account_id";

/** Every other communication table Wave 1 must NOT touch. */
const FORBIDDEN_TABLES = Object.freeze([
  "communication_messages",
  "communication_webhook_receipts",
  "communication_inbound_messages",
  "communication_consent_ack_intents",
  "communication_provider_accounts",
  "communication_templates",
  "communication_automation_catalog",
]);

// ----------------------------------------------------------------------------
// SQL lexing — strip comments and string literals so checks see EXECUTABLE code only.
// A naive grep over raw text would be fooled by the migration's own explanatory comments,
// which deliberately discuss NOT NULL, created_at, readiness and IF NOT EXISTS in order to
// document why each is absent.
// ----------------------------------------------------------------------------
function stripNonCode(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'") {
          if (j + 1 < n && sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      out += "''";
      i = j + 1;
    } else if (sql.startsWith("--", i)) {
      const j = sql.indexOf("\n", i);
      i = j < 0 ? n : j;
    } else if (sql.startsWith("/*", i)) {
      const j = sql.indexOf("*/", i);
      i = j < 0 ? n : j + 2;
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
}

function statements(sql) {
  return stripNonCode(sql)
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

function normalise(s) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// ----------------------------------------------------------------------------
// Static checks. Each returns a boolean. They are pure functions of the migration text,
// so the mutation runner can re-run the whole suite against mutated content.
// ----------------------------------------------------------------------------
function staticChecks(sql) {
  const stmts = statements(sql);
  const code = normalise(stripNonCode(sql));
  const results = [];
  const add = (name, ok) => results.push({ name, ok: ok === true });

  // 1 — the migration targets ONLY communication_delivery_events.
  add("1.1 exactly one executable statement", stmts.length === 1);
  const only = stmts[0] ? normalise(stmts[0]) : "";
  add("1.2 the statement is an ALTER TABLE on the target table",
    only.startsWith(`alter table public.${TARGET_TABLE} `));
  add("1.3 no other communication table appears in executable code",
    FORBIDDEN_TABLES.every((t) => !code.includes(t)));

  // 2 — the predicate is EXACTLY `provider_account_id is not null`.
  const m = only.match(/check\s*\(\s*(.+?)\s*\)\s*$/);
  const predicate = m ? m[1].trim() : null;
  add("2.1 a CHECK predicate is present", predicate !== null);
  add("2.2 predicate is exactly `provider_account_id is not null`",
    predicate === `${COLUMN} is not null`);
  add("2.3 constraint carries the exact stable name",
    only.includes(`add constraint ${CONSTRAINT_NAME} `));

  // 3 — no timestamp / status bypass.
  add("3.1 no created_at exemption", !code.includes("created_at"));
  add("3.2 no timestamp literal or cast", !/timestamptz|now\(\)|current_timestamp/.test(code));
  add("3.3 no status/type condition", !/\bstatus\b|normalized_event_type|processing_status/.test(code));
  add("3.4 no OR-widening in the predicate", predicate !== null && !predicate.includes(" or "));
  add("3.5 no tautology", predicate !== null && !/\btrue\b|1\s*=\s*1/.test(predicate));

  // 4 — no provider-readiness condition. Readiness gates SENDING, never attribution.
  add("4.1 no readiness_status reference", !code.includes("readiness_status"));
  add("4.2 no provider-account state reference",
    !/configuration_status|webhook_status|health_status|billing_status|provider_ready|disabled/.test(code));

  // 5 — no other object changed (covered for tables by 1.3; here: no schema objects at all).
  add("5.1 no index change", !/create\s+(unique\s+)?index|drop\s+index/.test(code));
  add("5.2 no RLS or grant change", !/\bgrant\b|\brevoke\b|row level security|create policy|drop policy/.test(code));
  add("5.3 no column type or nullability change on the column itself",
    !/alter\s+column|set\s+not\s+null|drop\s+not\s+null|set\s+default/.test(code));

  // 6 — no UPDATE, backfill, default assignment, trigger or function.
  add("6.1 no DML", !/\binsert\b|\bupdate\b|\bdelete\b|\bmerge\b|\btruncate\b|\bcopy\b/.test(code));
  add("6.2 no trigger", !/create\s+(or\s+replace\s+)?trigger/.test(code));
  add("6.3 no function or procedure", !/create\s+(or\s+replace\s+)?(function|procedure)|\bdo\s*\$\$/.test(code));
  add("6.4 no default provider account literal (no bare UUID)",
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(code));

  // 12 — migration drift / unexpected schema must fail closed.
  add("12.1 no IF NOT EXISTS silent-skip guard", !/if\s+not\s+exists/.test(code));
  add("12.2 no IF EXISTS silent-skip guard", !/if\s+exists/.test(code));
  add("12.3 constraint is added VALIDATED (no NOT VALID)", !/not\s+valid/.test(code));
  add("12.4 no exception swallowing", !/\bexception\b|\bwhen\s+others\b/.test(code));

  return results;
}

/** The Wave-1 boundary: no other repository file may be touched by the implementation commit. */
function scopeChecks() {
  const results = [];
  const add = (name, ok) => results.push({ name, ok: ok === true });
  add("5.4 migration file exists at the expected path", existsSync(resolve(MIGRATION)));

  // Wave 2 / Wave 3 tables must have no constraint migration in this branch.
  // Read the WORKING TREE, not `git ls-tree HEAD`: at harness-run time the Wave 1 migration is
  // typically still uncommitted, so a HEAD listing would under-count it and report a false
  // failure (and, worse, would not see an unauthorised sibling migration that is also uncommitted).
  const listed = readdirSync(resolve("supabase/migrations")).filter((f) => f.endsWith(".sql"));
  const w23 = listed.filter((f) => /ack_intent|inbound_message|webhook_receipt/.test(f) && /constraint|required|not_null/.test(f));
  add("5.5 no Wave 2 / Wave 3 constraint migration present", w23.length === 0);
  add("5.6 exactly one 20260720 migration", listed.filter((f) => f.includes("20260720")).length === 1);
  return results;
}

// ----------------------------------------------------------------------------
// Database probes — OPT-IN, LOCAL ONLY. Never production.
// ----------------------------------------------------------------------------
const TEST_DSN = process.env.D6W1_TEST_DATABASE_URL ?? null;

function dsnIsLocal(dsn) {
  if (typeof dsn !== "string" || dsn.length === 0) return false;
  if (/supabase\.co|supabase\.in|pooler\.supabase/.test(dsn)) return false;
  return /@(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)[:/]/.test(dsn);
}

function databaseChecks() {
  const results = [];
  const add = (name, ok, skipped) => results.push({ name, ok: ok === true, skipped: skipped === true });
  const names = [
    "7 a bound delivery-event insert is ACCEPTED",
    "8 an otherwise-valid NULL provider-account insert is REJECTED",
    "9 parent-message and provider-account FKs still apply",
    "10 existing delivery-event uniqueness behaviour is preserved",
    "11 rollback removes ONLY the new constraint",
  ];
  if (TEST_DSN === null) {
    for (const n of names) add(`${n} [SKIPPED — no D6W1_TEST_DATABASE_URL]`, false, true);
    return results;
  }
  if (!dsnIsLocal(TEST_DSN)) {
    throw new Error(
      "D6W1_TEST_DATABASE_URL is not a recognised LOCAL DSN. This harness refuses to run probes " +
      "against a managed or remote database. Point it at a local test instance."
    );
  }
  for (const n of names) add(`${n} [DSN present — implement probe before relying on this]`, false, true);
  return results;
}

// ----------------------------------------------------------------------------
// Mutations. Each must be KILLED by the static suite.
// ----------------------------------------------------------------------------
const DDL_ANCHOR =
  "alter table public.communication_delivery_events\n" +
  "  add constraint communication_delivery_events_provider_account_required_check\n" +
  "  check (provider_account_id is not null);";

const MUTATIONS = [
  { name: "M1 remove the constraint entirely", expect: "killed",
    mutate: (s) => s.replace(DDL_ANCHOR, "") },
  { name: "M2 IS NOT NULL -> IS NULL", expect: "killed",
    mutate: (s) => s.replace("check (provider_account_id is not null)", "check (provider_account_id is null)") },
  { name: "M3 add an ignored/status bypass", expect: "killed",
    mutate: (s) => s.replace("check (provider_account_id is not null)",
      "check (provider_account_id is not null or normalized_event_type = 'ignored')") },
  { name: "M4 add a created_at legacy exemption", expect: "killed",
    mutate: (s) => s.replace("check (provider_account_id is not null)",
      "check (created_at < timestamptz '2026-07-20 00:00:00+00' or provider_account_id is not null)") },
  { name: "M5 apply the constraint to the WRONG table", expect: "killed",
    mutate: (s) => s.replace(DDL_ANCHOR, DDL_ANCHOR.replace(
      "alter table public.communication_delivery_events",
      "alter table public.communication_messages")) },
  { name: "M6 weaken the predicate with OR TRUE", expect: "killed",
    mutate: (s) => s.replace("check (provider_account_id is not null)",
      "check (provider_account_id is not null or true)") },
  { name: "M7 silently skip with IF NOT EXISTS", expect: "killed",
    mutate: (s) => s.replace("add constraint communication_delivery_events_provider_account_required_check",
      "add constraint if not exists communication_delivery_events_provider_account_required_check") },
  { name: "M8 turn the constraint into provider-readiness logic", expect: "killed",
    mutate: (s) => s.replace("check (provider_account_id is not null)",
      "check (provider_account_id is not null or readiness_status <> 'provider_ready')") },
  { name: "M9 stage it as NOT VALID", expect: "killed",
    mutate: (s) => s.replace("check (provider_account_id is not null);",
      "check (provider_account_id is not null) not valid;") },
  { name: "M10 rename the constraint (authority drift)", expect: "killed",
    mutate: (s) => s.replace(DDL_ANCHOR, DDL_ANCHOR.replace(
      "communication_delivery_events_provider_account_required_check",
      "delivery_events_account_chk")) },
  // SELF-TEST: a comment-only edit changes nothing executable and MUST survive. If this is
  // reported killed, the static suite is reading comments and every other kill is suspect.
  { name: "S1 comment-only edit (must SURVIVE)", expect: "survived",
    mutate: (s) => s.replace("-- ROLLBACK:", "-- ROLLBACK NOTE:") },
];

// ----------------------------------------------------------------------------
// Runner
// ----------------------------------------------------------------------------
const raw = readFileSync(resolve(MIGRATION), "utf8");

console.log("Phase 8B-1B-D6 Wave 1 — delivery-event provider-account constraint harness\n");
console.log(`Migration under test: ${MIGRATION}\n`);

let passed = 0, failed = 0, skipped = 0;
const baseline = [...staticChecks(raw), ...scopeChecks(), ...databaseChecks()];
for (const r of baseline) {
  if (r.skipped) { console.log(`SKIP  ${r.name}`); skipped += 1; continue; }
  if (r.ok) { console.log(`PASS  ${r.name}`); passed += 1; }
  else { console.log(`FAIL  ${r.name}`); failed += 1; }
}

console.log("\n--- mutation tests ---\n");
let killed = 0, survived = 0, infra = 0, selfOk = 0;
for (const mut of MUTATIONS) {
  let status;
  try {
    const mutated = mut.mutate(raw);
    if (mutated === raw) {
      status = "infra_fail"; // anchor missed — never counts as a kill
    } else {
      const after = staticChecks(mutated);
      status = after.some((r) => !r.ok) ? "killed" : "survived";
    }
  } catch {
    status = "infra_fail";
  }
  const ok = status === mut.expect;
  if (status === "infra_fail") { console.log(`INFRA ${mut.name}`); infra += 1; }
  else if (status === "killed") { console.log(`${ok ? "KILLED  " : "KILLED* "}${mut.name}`); killed += 1; }
  else { console.log(`${ok ? "SURVIVED" : "SURVIVED*"} ${mut.name}`); survived += 1; }
  if (ok) selfOk += 1; else failed += 1;
}

const expectedKills = MUTATIONS.filter((m) => m.expect === "killed").length;
console.log(`\nchecks: ${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log(`mutations: ${killed} killed, ${survived} survived, ${infra} infra_fail (expected kills: ${expectedKills})`);
if (skipped > 0) {
  console.log("\nNOTE: database probes were SKIPPED (no D6W1_TEST_DATABASE_URL). A skipped proof is an");
  console.log("      ABSENT proof — it is not a pass. Constraint behaviour against a live database");
  console.log("      remains unverified by this run.");
}
console.log(failed === 0 ? "\nHARNESS GREEN" : "\nHARNESS RED");
process.exit(failed > 0 ? 1 : 0);
