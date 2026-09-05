#!/usr/bin/env node
/**
 * QF-LOCAL-QA-BASELINE-01 — canonical QuickFurno local QA database bootstrap.
 *
 * WHY THIS EXISTS
 * `supabase db reset` replays supabase/migrations from file #1. This repository
 * forbids that: the first 68 migrations are classified
 * PRE_BASELINE_CHAIN_INTENTIONALLY_SUPERSEDED_FOR_STAGING, safety
 * .preBaselineReplayForbidden is true, and QF-MVP-50.1B aborts on purpose if
 * the historical generic workflow kernel exists, because two durable
 * orchestration authorities are unsafe. A full replay therefore builds a
 * database that the repository explicitly does not want to exist.
 *
 * WHAT THIS DOES INSTEAD — it reproduces the CANONICAL staging shape locally:
 *
 *     reviewed baseline  ->  canonical post-baseline forward migrations
 *
 * The forward set is DERIVED from the staging-history manifest, never
 * hardcoded and never a loose wildcard, and every count is asserted against
 * source truth before a single statement runs.
 *
 * SCOPE: local, disposable, read-only with respect to every remote project.
 * It refuses to run against anything that is not a local Supabase container,
 * writes no migration-history rows, and never performs `migration repair`.
 *
 * Usage:
 *   node scripts/mvp/local/bootstrap-qf-canonical-local-qa.mjs [--verify-only]
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const BASELINE = "supabase/staging-baseline/20260722000100_qf_mvp_staging_baseline_269c9265.sql";
const MANIFEST = "supabase/staging-history/qf-mvp-staging-history-manifest.json";
const MIGRATIONS_DIR = "supabase/migrations";
const ANCHOR = "20260722000100";

/** The only database this harness will ever talk to. */
const CONTAINER = process.env.QF_LOCAL_DB_CONTAINER || "supabase_db_quickfurno";
const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

/** Transport extensions the canonical staging target does not have. */
const TRANSPORT_EXTENSIONS = ["pg_net", "http", "dblink"];

/** Tables that prove the historical kernel was NOT resurrected. */
const LEGACY_KERNEL_TABLES = [
  "workflow_instances", "workflow_tasks", "domain_events", "outbox_events",
  "workflow_failures", "idempotency_records", "workflow_transition_history",
];

/** Tables QF-MVP-50 durable automation persistence must create. */
const AUTOMATION_TABLES = [
  "automation_action_requests", "automation_jobs", "automation_execution_attempts",
];

let failures = 0;
const line = (s = "") => process.stdout.write(s + "\n");
function check(label, ok, detail = "") {
  if (!ok) failures += 1;
  line(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? "  :: " + detail : ""}`);
  return ok;
}
function die(message) {
  line(`\nABORTED: ${message}`);
  process.exit(1);
}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** Run SQL in the LOCAL container. No remote transport is possible from here. */
function psql(sql, { file = null } = {}) {
  const args = ["exec", "-i", CONTAINER, "psql", LOCAL_DSN, "-v", "ON_ERROR_STOP=1", "-tA"];
  if (file) {
    return execFileSync("docker", [...args, "-f", "-"], {
      input: readFileSync(file, "utf8"), encoding: "utf8", maxBuffer: 1024 * 1024 * 256,
    });
  }
  return execFileSync("docker", [...args, "-c", sql], {
    encoding: "utf8", maxBuffer: 1024 * 1024 * 64,
  });
}
const scalar = (sql) => psql(sql).trim();
/** psql prints boolean::text as 'true' and a bare boolean as 't'. Accept both. */
const isTrue = (sql) => ["t", "true"].includes(scalar(sql).toLowerCase());

// ---------------------------------------------------------------------------
// A. PRE-FLIGHT
// ---------------------------------------------------------------------------
line("\n== A. PRE-FLIGHT ==");

check("running inside the QuickFurno repo",
  existsSync("package.json") && JSON.parse(readFileSync("package.json", "utf8")).name === "quickfurno-portal");
check("reviewed baseline present", existsSync(BASELINE));
check("staging-history manifest present", existsSync(MANIFEST));
if (failures) die("pre-flight file checks failed");

// Refuse anything that is not the local container. A remote host or project ref
// must never reach this harness.
const REMOTE_MARKERS = ["supabase.co", "uckafzuochmbvtiodmcl", "yqpgcsduqbxulrlzwzap"];
const dsnClean = !REMOTE_MARKERS.some((m) => LOCAL_DSN.includes(m) || CONTAINER.includes(m));
check("target DSN and container are local-only", dsnClean, CONTAINER);
for (const key of ["QF_STAGING_DB_URL", "SUPABASE_DB_URL", "DATABASE_URL"]) {
  const v = process.env[key] || "";
  check(`env ${key} carries no remote target`, !REMOTE_MARKERS.some((m) => v.includes(m)));
}
if (failures) die("refusing to run: a remote target was detected");

const host = scalar("select inet_server_addr()::text || ' / ' || current_database();");
check("connected database is local", /^(127\.0\.0\.1|::1|172\.|10\.|192\.168\.)/.test(host) || host.startsWith(" /"), host);

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const pre = manifest.preBaselineChain || {};
check("preBaselineChain.classification is the superseded chain",
  pre.classification === "PRE_BASELINE_CHAIN_INTENTIONALLY_SUPERSEDED_FOR_STAGING", String(pre.classification));
check("preBaselineChain.count == 68", pre.count === 68, String(pre.count));
check("preBaselineChain.mustReplayOnStaging == false", pre.mustReplayOnStaging === false);
check("safety.preBaselineReplayForbidden == true", (manifest.safety || {}).preBaselineReplayForbidden === true);
if (failures) die("governance assertions failed — the canonical model is not what this harness expects");

// ---------------------------------------------------------------------------
// B. DERIVE THE CANONICAL SOURCE SET (never a wildcard)
// ---------------------------------------------------------------------------
line("\n== B. CANONICAL SOURCE SET ==");

const version = (x) => String(typeof x === "string" ? x : x.version);
const canonicalVersions = [
  ...(manifest.postBaselineApplied || []).map(version),
  version(manifest.appliedAnchor),
  ...(manifest.appliedPostAnchorMigrations || []).map(version),
  ...(manifest.reconciledPostAnchorMigrations || []).map(version),
].sort();
const pendingVersions = (manifest.pendingPostAnchorMigrations || []).map(version);

const allFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const preFiles = allFiles.filter((f) => f.slice(0, 14) <= ANCHOR);
const postFiles = allFiles.filter((f) => f.slice(0, 14) > ANCHOR);

check("pre-baseline file count matches the manifest (68)", preFiles.length === pre.count,
  `${preFiles.length} files vs manifest ${pre.count}`);
check("no duplicate canonical version", canonicalVersions.length === new Set(canonicalVersions).size);
check("every post-baseline file is classified",
  postFiles.every((f) => canonicalVersions.includes(f.slice(0, 14)) || pendingVersions.includes(f.slice(0, 14))));

const forward = canonicalVersions.map((v) => {
  const file = postFiles.find((f) => f.slice(0, 14) === v);
  if (!file) die(`canonical version ${v} has no migration file`);
  return { version: v, file: path.join(MIGRATIONS_DIR, file) };
});
check("canonical forward migration count == 34", forward.length === 34, String(forward.length));
check("canonical identities (baseline + forward) == 35", 1 + forward.length === 35);
check("exactly one pending version is excluded", pendingVersions.length === 1, pendingVersions.join(","));
line(`  excluded PENDING (not applied): ${pendingVersions.join(", ") || "none"}`);
line(`  pre-baseline files NOT replayed: ${preFiles.length}`);
if (failures) die("derived source set does not match manifest/source truth");

if (process.argv.includes("--verify-only")) {
  line(`\nverify-only: derivation clean (${failures} failures)`);
  process.exit(failures ? 1 : 0);
}

// ---------------------------------------------------------------------------
// C. FRESH DISPOSABLE LOCAL PUBLIC SCHEMA
// ---------------------------------------------------------------------------
line("\n== C. RESET DISPOSABLE LOCAL SCHEMA ==");

// Only `public` is rebuilt. Managed Supabase schemas (auth, storage, graphql,
// vault, extensions) and the anon/authenticated/service_role roles survive, so
// auth.users and the managed prerequisites remain available. Dropping public
// also removes any auth.users trigger whose function lived there, which is
// exactly the canonical baseline starting point (0 non-internal triggers).
psql(`
  drop schema if exists public cascade;
  create schema public;
  alter schema public owner to postgres;
  grant usage on schema public to anon, authenticated, service_role;
`);
check("public schema recreated empty",
  scalar("select count(*)::text from pg_tables where schemaname='public';") === "0");
check("auth.users still present (managed prerequisite)",
  isTrue("select (to_regclass('auth.users') is not null)::text;"));
check("supabase roles still present",
  scalar("select count(*)::text from pg_roles where rolname in ('anon','authenticated','service_role');") === "3");
check("no non-internal auth.users trigger at the baseline start",
  scalar(`select count(*)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid
          join pg_namespace n on n.oid=c.relnamespace
          where not t.tgisinternal and n.nspname='auth' and c.relname='users';`) === "0");

// ---------------------------------------------------------------------------
// D. NORMALIZE AMBIENT STATE TO THE CANONICAL TARGET
// ---------------------------------------------------------------------------
line("\n== D. NORMALIZE LOCAL AMBIENT STATE ==");

// The canonical staging target has no database transport at the QF-MVP-50
// gate. Supabase installs pg_net locally as a PLATFORM default. The disposable
// local environment is normalized to the target; the migration's transport-free
// fence is never weakened.
for (const ext of TRANSPORT_EXTENSIONS) {
  const present = scalar(`select count(*)::text from pg_extension where extname='${ext}';`) !== "0";
  if (!present) { line(`  --    ${ext} already absent`); continue; }
  try {
    psql(`drop extension if exists ${ext} restrict;`);
    line(`  ok    ${ext} dropped (RESTRICT — no cascade into managed objects)`);
  } catch (e) {
    die(`dropping ${ext} requires a cascade into managed objects; stopping instead of cascading blindly. ${String(e.message).slice(0, 200)}`);
  }
}
check("no transport extension remains before the QF-MVP-50 gate",
  scalar(`select count(*)::text from pg_extension where extname in ('pg_net','http','dblink');`) === "0");

// ---------------------------------------------------------------------------
// E. APPLY THE REVIEWED BASELINE (local only)
// ---------------------------------------------------------------------------
line("\n== E. BASELINE ==");
const baselineSha = sha256(readFileSync(BASELINE, "utf8"));
try {
  psql(null, { file: BASELINE });
  line(`  ok    ${ANCHOR}  ${path.basename(BASELINE)}  sha256=${baselineSha.slice(0, 16)}…`);
} catch (e) {
  die(`baseline apply failed: ${String(e.message).slice(0, 400)}`);
}

// ---------------------------------------------------------------------------
// F. APPLY CANONICAL FORWARD MIGRATIONS IN ORDER
// ---------------------------------------------------------------------------
line("\n== F. CANONICAL FORWARD MIGRATIONS ==");
let applied = 0;
for (const m of forward) {
  const sha = sha256(readFileSync(m.file, "utf8"));
  try {
    psql(null, { file: m.file });
    applied += 1;
    line(`  ok    ${m.version}  ${path.basename(m.file)}  sha256=${sha.slice(0, 16)}…`);
  } catch (e) {
    line(`  FAIL  ${m.version}  ${path.basename(m.file)}`);
    die(`forward migration ${m.version} failed:\n${String(e.message).slice(0, 900)}`);
  }
}
check(`applied all ${forward.length} canonical forward migrations`, applied === forward.length, String(applied));

// ---------------------------------------------------------------------------
// G. REQUIRED BOOTSTRAP PROOFS
// ---------------------------------------------------------------------------
line("\n== G. BOOTSTRAP PROOFS ==");

for (const t of LEGACY_KERNEL_TABLES) {
  check(`legacy kernel table absent: ${t}`,
    isTrue(`select (to_regclass('public.${t}') is null)::text;`));
}
for (const t of AUTOMATION_TABLES) {
  check(`QF-MVP-50 table present: ${t}`,
    isTrue(`select (to_regclass('public.${t}') is not null)::text;`));
}

const trg = scalar(`
  select coalesce(string_agg(t.tgname || '|' || t.tgtype::text || '|' || t.tgenabled::text || '|' || p.proname, ','), '')
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal and n.nspname='auth' and c.relname='users';`);
check("exactly one non-internal auth.users trigger", trg.split(",").filter(Boolean).length === 1, trg);
// tgtype bit 1 = ROW, bit 4 = INSERT, and BEFORE(2) must be clear -> AFTER INSERT FOR EACH ROW = 5
check("it is AFTER INSERT FOR EACH ROW executing handle_new_user",
  /^on_auth_user_created\|5\|O\|handle_new_user$/.test(trg), trg);
check("handle_new_user is SECURITY DEFINER",
  isTrue("select p.prosecdef::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='handle_new_user';"));
check("handle_new_user search_path pins pg_catalog",
  isTrue(`select (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
          unnest(coalesce(p.proconfig,'{}')) cfg
          where n.nspname='public' and p.proname='handle_new_user'
            and cfg like 'search_path=%' and cfg like '%pg_catalog%'))::text;`));
check("PUBLIC/anon/authenticated cannot execute handle_new_user",
  isTrue(`select (not (has_function_privilege('public','public.handle_new_user()','execute')
                    or has_function_privilege('anon','public.handle_new_user()','execute')
                    or has_function_privilege('authenticated','public.handle_new_user()','execute')))::text;`));
check("service_role retains EXECUTE on handle_new_user",
  isTrue("select has_function_privilege('service_role','public.handle_new_user()','execute')::text;"));
check("role is classified from the trusted app_metadata qf_principal marker",
  /qf_principal/.test(scalar("select pg_get_functiondef(to_regprocedure('public.handle_new_user()'));")));
const handleNewUserCode = scalar("select pg_get_functiondef(to_regprocedure('public.handle_new_user()'));")
  .split(String.fromCharCode(10)).map((l) => l.replace(/--.*/, "")).join(" ");
check("no executable branch in handle_new_user can produce 'admin'",
  !/'admin'/.test(handleNewUserCode));
check("role is assigned only 'vendor' or null",
  /:=\s*'vendor'/.test(handleNewUserCode) && /:=\s*null/i.test(handleNewUserCode));
check("profiles.role remains nullable (neutral principals)",
  scalar("select is_nullable from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='role';") === "YES");

check("canonical assignment authority present",
  isTrue("select (to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is not null)::text;"));
check("four B2 enforcement triggers exist and are enabled",
  scalar(`select count(*)::text from pg_trigger t where not t.tgisinternal and t.tgenabled='O'
          and t.tgname in ('trg_lead_assignments_active_cap','trg_lead_assignment_events_lifetime_cap',
                           'trg_lead_assignment_events_immutable','trg_lead_assignment_events_no_truncate');`) === "4");

check("public.vendors exists", isTrue("select (to_regclass('public.vendors') is not null)::text;"));
const vendorCols = ["id", "business_name", "city", "status", "is_active", "package_status", "paid_status",
  "service_categories", "areas_covered", "profile_image_url", "cover_image_url", "portfolio_urls",
  "public_description", "public_business_hours", "public_service_area_summary", "starting_price"];
const missingCols = vendorCols.filter((c) =>
  !isTrue(`select (exists (select 1 from information_schema.columns where table_schema='public' and table_name='vendors' and column_name='${c}'))::text;`));
check("publicVendorService vendor columns all present", missingCols.length === 0, missingCols.join(","));
check("marketplace runtime settings source present",
  isTrue("select (to_regclass('public.marketplace_runtime_settings') is not null)::text;"));
check("no vendor rows seeded yet", scalar("select count(*)::text from public.vendors;") === "0");

check("end state carries no database transport extension",
  scalar("select count(*)::text from pg_extension where extname in ('pg_net','http','dblink');") === "0");
const historyRows = isTrue("select (to_regclass('supabase_migrations.schema_migrations') is not null)::text;")
  ? scalar("select count(*)::text from supabase_migrations.schema_migrations;")
  : "0";
check("no migration-history rows were fabricated", historyRows === "0", `${historyRows} row(s)`);

line(`\n== RESULT: ${failures === 0 ? "PASS" : "FAIL"} (${failures} failing check${failures === 1 ? "" : "s"}) ==`);
line(`   canonical identities reproduced locally: 1 baseline + ${forward.length} forward = ${1 + forward.length}`);
process.exit(failures ? 1 : 0);
