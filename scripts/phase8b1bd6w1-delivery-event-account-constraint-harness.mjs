import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  // QF-MVP-40.1-R — this was "no Wave 2 / Wave 3 constraint migration present", written while Wave 1
  // was the newest wave. Wave 2A-R2 has since been reviewed and merged, so the original fence now
  // rejects an APPROVED successor. The check is not removed and not loosened to a count: it is
  // re-expressed as an exact-identity invariant. Exactly the one approved R2 migration may exist,
  // matched by full filename — an unauthorised Wave 2B/Wave 3 sibling still fails here, which is
  // the property the original fence actually protected.
  const APPROVED_W2_MIGRATIONS = Object.freeze([
    "20260721000100_communication_consent_ack_intent_provider_account_required.sql",
  ]);
  const unapproved = w23.filter((f) => !APPROVED_W2_MIGRATIONS.includes(f));
  add("5.5 only approved Wave 2A-R2 constraint migrations present (no unapproved Wave 2B/3 sibling)",
    unapproved.length === 0 && w23.length === APPROVED_W2_MIGRATIONS.length);
  add("5.6 exactly one 20260720 migration", listed.filter((f) => f.includes("20260720")).length === 1);
  return results;
}

// ----------------------------------------------------------------------------
// DATABASE PROBES — MANDATORY, LOOPBACK-ONLY, DISPOSABLE.
//
// AUTHORITATIVE VARIABLE: QF_D6W1_TEST_DATABASE_URL  (and nothing else).
//
// The repository previously carried two competing names. This harness settles it:
//   * QF_WORKFLOW_TEST_DATABASE_URL belongs to the Phase 1B workflow-kernel harness. It points at
//     a workflow-kernel schema and is NEVER read here — reusing it would silently run Wave 1 DDL
//     against another phase's database.
//   * A bare D6W1_TEST_DATABASE_URL breaks the repository's QF_* prefix family.
// The standardized name is QF_D6W1_TEST_DATABASE_URL. If the legacy bare name is set, the harness
// FAILS LOUDLY rather than honouring either silently.
//
// The probes shell out to `psql`, matching the existing repository convention
// (scripts/phase1b-workflow-runtime-db-harness.mjs) and deliberately adding no node dependency —
// a package.json / lockfile change would contaminate the governance scope.
// ----------------------------------------------------------------------------
const DB_VAR = "QF_D6W1_TEST_DATABASE_URL";
const LEGACY_VARS = ["D6W1_TEST_DATABASE_URL"];
const FORBIDDEN_DB_NAME = /quickfurno|prod|production|live/i;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Parsed once so every guard and every probe agrees on the same target. */
function resolveTarget() {
  for (const legacy of LEGACY_VARS) {
    if (process.env[legacy]) {
      throw new Error(
        `${legacy} is set. That name is RETIRED — the authoritative variable is ${DB_VAR}. ` +
        "Supporting both silently would let a stale DSN decide where DDL runs. Unset the legacy name."
      );
    }
  }
  if (process.env.QF_WORKFLOW_TEST_DATABASE_URL && !process.env[DB_VAR]) {
    throw new Error(
      `QF_WORKFLOW_TEST_DATABASE_URL is set but ${DB_VAR} is not. The workflow-kernel DSN is NEVER ` +
      "reused here — it targets a different phase's schema. Set the Wave 1 variable explicitly."
    );
  }
  const raw = process.env[DB_VAR] ?? null;
  if (raw === null) return null;

  let u;
  try { u = new URL(raw); } catch { throw new Error(`${DB_VAR} is not a valid URL.`); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error(`${DB_VAR} must be a postgres:// URL.`);

  const host = u.hostname.toLowerCase();
  const dbName = u.pathname.replace(/^\//, "");
  if (/supabase\.co|supabase\.in|pooler\.supabase/.test(host)) {
    throw new Error("REFUSING: the DSN points at a managed Supabase host.");
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `REFUSING: host "${host}" is not loopback. Wave 1 probes run ONLY against 127.0.0.1 — there ` +
      "is no remote opt-in, deliberately."
    );
  }
  if (FORBIDDEN_DB_NAME.test(dbName) || FORBIDDEN_DB_NAME.test(host)) {
    throw new Error(`REFUSING: database name "${dbName}" matches a prohibited production pattern.`);
  }
  if (dbName.length === 0) throw new Error(`${DB_VAR} must name a database.`);
  return { raw, host, port: u.port || "5432", dbName, user: u.username };
}

/** One psql invocation. Returns exit status, stdout, stderr, SQLSTATE and constraint name. */
function psql(target, sql, { file = null } = {}) {
  // -t -A: tuples-only, unaligned. Without them psql emits column headers and box drawing, and
  // every scalar read below would parse formatting instead of the value.
  const args = ["-X", "-q", "-t", "-A", "-h", target.host, "-p", target.port, "-d", target.dbName,
                "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "--no-psqlrc"];
  if (target.user) args.push("-U", target.user);
  // SQL is ALWAYS delivered via -f, never -c. With shell:true (needed for PATH resolution of
  // psql.exe) the shell would interpret `|`, `||`, `(` and quotes inside an inline -c string —
  // the concatenation operator in an identity query is otherwise parsed as a pipe. The temp file
  // is written OUTSIDE the repository so it can never contaminate the working tree.
  const tmp = join(mkdtempSync(join(tmpdir(), "qf-d6w1-")), "q.sql");
  // \set VERBOSITY verbose is written INTO the file so SQLSTATE and CONSTRAINT NAME are always
  // emitted, independent of how psql variables are passed.
  const body = file ? readFileSync(file, "utf8") : sql;
  // VERBOSITY is supplied via -v (verified: psql emits `ERROR:  <sqlstate>:` with it). It is NOT
  // written into the file — a backslash meta-command is fragile to escape through this many layers.
  writeFileSync(tmp, body, "utf8");
  args.push("-f", tmp);
  const r = spawnSync("psql", args, { encoding: "utf8", shell: true });
  try { rmSync(dirname(tmp), { recursive: true, force: true }); } catch { /* best effort */ }
  const err = (r.stderr || "") + (r.stdout || "");
  // psql verbose format is `ERROR:  23514: <message>` — the SQLSTATE follows ERROR:, it is NOT
  // emitted on a separate "SQLSTATE:" line. Verified against a live check violation.
  const sqlstate = (err.match(/ERROR:\s+([0-9A-Z]{5}):/) || [])[1] ?? null;
  const constraint = (err.match(/CONSTRAINT NAME:\s*(\S+)/i) ||
                      err.match(/violates \w+ constraint "([^"]+)"/i) ||
                      err.match(/constraint "([^"]+)" .*already exists/i) ||
                      err.match(/relation "([^"]+)" already exists/i) || [])[1] ?? null;
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", sqlstate, constraint };
}

/** The PRE-WAVE-1 schema, derived from the committed migrations for the delivery-event chain.
 *  It is the CONSTRAINT-RELEVANT SUBSET — the objects proofs A-H actually exercise — not a full
 *  production clone. Every column, FK action and index below is copied from:
 *    20260708000170_unified_communication_core.sql       (table + provider-scoped unique)
 *    20260716000100_communication_provider_account_binding.sql (bound column, FK, paired uniques)
 *  with the Wave 1 CHECK deliberately ABSENT, which is what makes proof A meaningful. */
const PRE_WAVE1_SCHEMA = `
drop schema if exists public cascade;
create schema public;

create table public.communication_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  channel text not null check (channel in ('whatsapp','sms','rcs')),
  display_name text not null,
  readiness_status text not null default 'not_configured'
);

create table public.communication_messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp','sms','rcs')),
  provider text not null,
  provider_message_id text,
  status text not null default 'queued',
  provider_account_id uuid references public.communication_provider_accounts(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.communication_delivery_events (
  id uuid primary key default gen_random_uuid(),
  communication_message_id uuid not null references public.communication_messages(id) on delete restrict,
  provider text not null,
  provider_event_id text,
  normalized_event_type text not null check (normalized_event_type in ('accepted','sent','delivered','read','failed')),
  provider_message_id text not null,
  occurred_at timestamptz not null default now(),
  sanitized_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  provider_account_id uuid references public.communication_provider_accounts(id) on delete restrict
);

create index idx_comm_delivery_event_provider_account
  on public.communication_delivery_events(provider_account_id)
  where provider_account_id is not null;
create unique index uq_comm_delivery_event_provider_event_legacy
  on public.communication_delivery_events(provider, provider_event_id, provider_message_id, normalized_event_type)
  where provider_event_id is not null and provider_account_id is null;
create unique index uq_comm_delivery_event_account_event
  on public.communication_delivery_events(provider_account_id, provider_event_id, provider_message_id, normalized_event_type)
  where provider_event_id is not null and provider_account_id is not null;
`;

const ACC = "11111111-1111-4111-8111-111111111111";
const MSG = "22222222-2222-4222-8222-222222222222";
const SEED = `
insert into public.communication_provider_accounts (id, provider_key, channel, display_name, readiness_status)
  values ('${ACC}', 'meta_whatsapp_cloud', 'whatsapp', 'D6W1 disposable fixture', 'provider_ready');
insert into public.communication_messages (id, channel, provider, provider_message_id, status, provider_account_id)
  values ('${MSG}', 'whatsapp', 'meta_whatsapp_cloud', 'wamid.D6W1FIXTURE', 'sent', '${ACC}');
`;

function ev(extra) {
  return `insert into public.communication_delivery_events
    (communication_message_id, provider, provider_event_id, normalized_event_type,
     provider_message_id, provider_account_id)
    values (${extra});`;
}

function databaseChecks() {
  const results = [];
  const add = (name, ok, skipped, detail) =>
    results.push({ name, ok: ok === true, skipped: skipped === true, detail: detail ?? "" });

  const target = resolveTarget();
  if (target === null) {
    for (const n of ["A migration applies to the pre-Wave-1 schema",
                     "B bound delivery-event INSERT is ACCEPTED",
                     "C NULL provider_account_id INSERT is REJECTED by the Wave 1 CHECK",
                     "D invalid communication_message_id REJECTED by FK",
                     "E invalid provider_account_id REJECTED by FK",
                     "F existing delivery-event uniqueness still enforced",
                     "G dropping ONLY the new CHECK restores nullable behaviour",
                     "H reapplying the bare-DDL migration FAILS CLOSED"]) {
      add(`${n} [SKIPPED — ${DB_VAR} not set]`, false, true);
    }
    return results;
  }

  const probe = spawnSync("psql", ["--version"], { encoding: "utf8", shell: true });
  if (probe.status !== 0) throw new Error("psql is not available on PATH; the database gate cannot run.");

  // Identity is re-verified from the SERVER, not just the DSN string.
  const ident = psql(target, "select current_database()||'|'||coalesce(host(inet_server_addr()),'local')||'|'||inet_server_port();");
  if (ident.status !== 0) throw new Error(`cannot reach the test database: ${ident.stderr.slice(0, 200)}`);
  const [srvDb, srvHost] = ident.stdout.trim().split("\n").pop().trim().split("|");
  if (FORBIDDEN_DB_NAME.test(srvDb)) throw new Error(`REFUSING: server reports database "${srvDb}".`);
  if (!LOOPBACK_HOSTS.has(srvHost)) throw new Error(`REFUSING: server reports non-loopback address "${srvHost}".`);
  add(`0 target verified from server: db=${srvDb} host=${srvHost} (loopback, non-production name)`, true);

  // ---- establish the PRE-WAVE-1 schema, then seed ----
  const schema = psql(target, PRE_WAVE1_SCHEMA);
  if (schema.status !== 0) throw new Error(`pre-Wave-1 schema setup failed: ${schema.stderr.slice(0, 300)}`);
  const seed = psql(target, SEED);
  if (seed.status !== 0) throw new Error(`fixture seed failed: ${seed.stderr.slice(0, 300)}`);

  // ---- A: the Wave 1 migration applies to the exact pre-Wave-1 schema ----
  const a = psql(target, null, { file: resolve(MIGRATION) });
  add(`A migration applies to the pre-Wave-1 schema (exit ${a.status})`, a.status === 0,
      false, a.status === 0 ? "" : a.stderr.slice(0, 200));
  const present = psql(target,
    `select count(*) from pg_constraint where conname = '${CONSTRAINT_NAME}' and convalidated;`);
  add(`A2 constraint ${CONSTRAINT_NAME} present and VALIDATED`,
      present.status === 0 && present.stdout.trim().split("\n").pop().trim() === "1");

  // ---- B: a fully bound delivery event is ACCEPTED ----
  const b = psql(target, ev(`'${MSG}','meta_whatsapp_cloud','evt-B','sent','wamid.B','${ACC}'`));
  add(`B bound delivery-event INSERT is ACCEPTED (exit ${b.status})`, b.status === 0,
      false, b.status === 0 ? "" : b.stderr.slice(0, 200));

  // ---- C: NULL provider_account_id REJECTED by the Wave 1 CHECK ----
  const c = psql(target, ev(`'${MSG}','meta_whatsapp_cloud','evt-C','sent','wamid.C',null`));
  add(`C NULL provider_account_id REJECTED by ${CONSTRAINT_NAME} [SQLSTATE ${c.sqlstate}]`,
      c.status !== 0 && c.sqlstate === "23514" && c.constraint === CONSTRAINT_NAME,
      false, `constraint=${c.constraint}`);

  // ---- D: invalid parent message REJECTED by the existing FK ----
  const d = psql(target, ev(`'33333333-3333-4333-8333-333333333333','meta_whatsapp_cloud','evt-D','sent','wamid.D','${ACC}'`));
  add(`D invalid communication_message_id REJECTED by FK [SQLSTATE ${d.sqlstate}]`,
      d.status !== 0 && d.sqlstate === "23503", false, `constraint=${d.constraint}`);

  // ---- E: invalid provider account REJECTED by the existing FK ----
  const e = psql(target, ev(`'${MSG}','meta_whatsapp_cloud','evt-E','sent','wamid.E','44444444-4444-4444-8444-444444444444'`));
  add(`E invalid provider_account_id REJECTED by FK [SQLSTATE ${e.sqlstate}]`,
      e.status !== 0 && e.sqlstate === "23503", false, `constraint=${e.constraint}`);

  // ---- F: the bound uniqueness namespace is still enforced (duplicate of B) ----
  const f = psql(target, ev(`'${MSG}','meta_whatsapp_cloud','evt-B','sent','wamid.B','${ACC}'`));
  add(`F delivery-event uniqueness still enforced [SQLSTATE ${f.sqlstate}]`,
      f.status !== 0 && f.sqlstate === "23505", false, `index=${f.constraint}`);

  // ---- H (before G, so G's drop does not mask it): reapplying the bare DDL FAILS CLOSED ----
  const h = psql(target, null, { file: resolve(MIGRATION) });
  add(`H reapplying the bare-DDL migration FAILS CLOSED [SQLSTATE ${h.sqlstate}]`,
      h.status !== 0 && h.sqlstate === "42710", false, `object=${h.constraint}`);

  // ---- G: dropping ONLY the new CHECK restores nullable behaviour ----
  const g1 = psql(target, `alter table public.communication_delivery_events drop constraint ${CONSTRAINT_NAME};`);
  const g2 = psql(target, ev(`'${MSG}','meta_whatsapp_cloud','evt-G','sent','wamid.G',null`));
  const g3 = psql(target,
    `select count(*) from pg_constraint where conrelid='public.communication_delivery_events'::regclass and contype='f';`);
  const fkCount = g3.stdout.trim().split("\n").pop().trim();
  add(`G dropping ONLY the new CHECK restores nullable behaviour (FKs intact: ${fkCount})`,
      g1.status === 0 && g2.status === 0 && fkCount === "2");

  // ---- CLEANUP: remove every row and the fixture schema; leave the database empty ----
  const cleanup = psql(target,
    "delete from public.communication_delivery_events; " +
    "delete from public.communication_messages; " +
    "delete from public.communication_provider_accounts; " +
    "drop schema public cascade; create schema public;");
  const leftover = psql(target,
    "select count(*) from information_schema.tables where table_schema='public';");
  const remaining = leftover.stdout.trim().split("\n").pop().trim();
  add(`CLEANUP fixture removed, public schema empty (tables remaining: ${remaining})`,
      cleanup.status === 0 && remaining === "0");

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
