// ============================================================================
// QF-MVP-10.7 — Read-only staging/production DB reconciliation runner.
//
//   npm run reconcile:mvp:staging      (needs QF_STAGING_READONLY_DATABASE_URL)
//   npm run reconcile:mvp:production    (needs QF_PRODUCTION_READONLY_DATABASE_URL)
//   npm run reconcile:mvp:compare       (diffs the two env JSONs vs the repo ledger)
//   npm run reconcile:mvp:selftest      (validates the tool with NO database)
//
// READ-ONLY. One BEGIN READ ONLY session per env; SHOW transaction_read_only must
// be `on` or it stops. Credentials are read from env, never printed or written.
// No fabrication: when credentials/psql are unavailable it stops with a distinct
// exit code and writes nothing.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS, FUNCTION_TARGETS, EXPECTED_CONSTRAINTS, assertReadOnly } from './lib/sql.mjs';
import { hasPsql, runReadOnlySession } from './lib/psql.mjs';
import { stableJson, assertNoLeak } from './lib/normalize.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(REPO, 'docs/generated');
const ENV_VARS = {
  staging: 'QF_STAGING_READONLY_DATABASE_URL',
  production: 'QF_PRODUCTION_READONLY_DATABASE_URL',
};
const OUT_FILES = {
  staging: 'qf-mvp-staging-db-reconciliation.json',
  production: 'qf-mvp-production-db-reconciliation.json',
};

const EXIT = { OK: 0, SELFTEST_FAIL: 1, CREDS: 3, PSQL: 4, READONLY: 5, USAGE: 2 };

function log(...a) { console.log('[reconcile]', ...a); }

function collect(label) {
  const envVar = ENV_VARS[label];
  const uri = process.env[envVar];
  if (!uri) {
    log(`CREDENTIALS_UNAVAILABLE: ${envVar} is not set. No data collected (no fabrication). ` +
        `Supply a READ-ONLY connection URI and re-run.`);
    process.exit(EXIT.CREDS);
  }
  if (!hasPsql()) {
    log('PSQL_UNAVAILABLE: `psql` was not found on PATH. Per QF-MVP-10.7 this stops rather than ' +
        'using an unsafe path or adding a new DB dependency. Install the postgres client and re-run.');
    process.exit(EXIT.PSQL);
  }
  log(`connecting (read-only) to ${label} via ${envVar} … [URI never printed]`);
  const { readonly, sections } = runReadOnlySession(uri, SECTIONS);
  if (!readonly) {
    log(`READONLY_ASSERT_FAILED: SHOW transaction_read_only did not report "on" (got "${sections.readonly_check}"). Aborting.`);
    process.exit(EXIT.READONLY);
  }

  const result = {
    schemaVersion: 1,
    generator: 'scripts/mvp/reconciliation/run.mjs',
    environment: label,
    note: 'Read-only metadata only. No row-level/business/personal data, no phone/email/message content, no secrets, no connection URL. Deterministic ordering.',
    readOnlyProof: { transaction_read_only: sections.readonly_check },
    identity: sections.identity,
    migrationTables: sections.migration_tables,
    migrationsRecorded: {
      supabase: sections.migrations_supabase,
      publicLegacy: sections.migrations_public,
    },
    columns: sections.columns,
    constraints: sections.constraints,
    indexes: sections.indexes,
    functions: sections.functions,
    loadBearingFunctions: sections.load_bearing_functions,
    triggers: sections.triggers,
    rls: sections.rls,
    policies: sections.policies,
    tableGrants: sections.table_grants,
    safeCounts: sections.safe_counts,
    expectedConstraintsWatchlist: EXPECTED_CONSTRAINTS,
    loadBearingTargets: FUNCTION_TARGETS,
  };

  const serialized = assertNoLeak(stableJson(result));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, OUT_FILES[label]), serialized);
  const c = (a) => (Array.isArray(a) ? a.length : 0);
  log(`${label}: db=${result.identity?.current_database} readonly=${sections.readonly_check} ` +
      `tables≈${new Set((result.columns || []).map((x) => x.table)).size} constraints=${c(result.constraints)} ` +
      `functions=${c(result.functions)} loadBearing=${c(result.loadBearingFunctions)} policies=${c(result.policies)}`);
  log(`wrote docs/generated/${OUT_FILES[label]}`);
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function compare() {
  const staging = readJson(path.join(OUT, OUT_FILES.staging));
  const production = readJson(path.join(OUT, OUT_FILES.production));
  const ledger = readJson(path.join(OUT, 'qf-mvp-migration-ledger.json'));
  if (!staging || !production) {
    log('COMPARE_INPUT_MISSING: run reconcile:mvp:staging and reconcile:mvp:production first ' +
        '(both require read-only credentials). No drift file written (no fabrication).');
    process.exit(EXIT.CREDS);
  }
  const objName = (arr, key) => new Set((arr || []).map((x) => x[key]));
  const stTables = objName(staging.columns, 'table');
  const prTables = objName(production.columns, 'table');
  const stFns = objName(staging.functions, 'name');
  const prFns = objName(production.functions, 'name');

  const migrations = (ledger?.migrations || []).map((m) => {
    const decl = [...m.objects.tablesCreated, ...m.objects.functions];
    const presentIn = (tset, fset) => decl.every((o) => tset.has(o) || fset.has(o)) && decl.length > 0;
    return {
      file: m.name,
      declaredObjects: decl,
      staging: decl.length === 0 ? 'NO_OBJECTS_TO_CHECK' : presentIn(stTables, stFns) ? 'STAGING_MATCHED' : 'STAGING_DRIFT_OR_NOT_PRESENT',
      production: decl.length === 0 ? 'NO_OBJECTS_TO_CHECK' : presentIn(prTables, prFns) ? 'PRODUCTION_MATCHED' : 'PRODUCTION_DRIFT_OR_NOT_PRESENT',
    };
  });

  const drift = {
    schemaVersion: 1,
    generator: 'scripts/mvp/reconciliation/run.mjs',
    note: 'Structural presence comparison of repository-declared objects vs live DB metadata. DEFINITION_DRIFT of function bodies requires human review of loadBearingFunctions[].body across the two env files (this task proposes no automatic remediation).',
    classifications: ['MATCHED', 'REPOSITORY_ONLY', 'DATABASE_ONLY', 'DEFINITION_DRIFT', 'HISTORY_DRIFT', 'EXPECTED_ENVIRONMENT_DIFFERENCE', 'UNKNOWN_REQUIRES_REVIEW'],
    migrationPresence: migrations,
    loadBearingSummary: FUNCTION_TARGETS.map((name) => ({
      name,
      staging: (staging.loadBearingFunctions || []).filter((f) => f.name === name).map((f) => ({ args: f.args, body_md5: f.body_md5, writes_vendor_credit_logs: f.writes_vendor_credit_logs, debits_credits: f.debits_credits, mentions_max_vendors: f.mentions_max_vendors, security_definer: f.security_definer })),
      production: (production.loadBearingFunctions || []).filter((f) => f.name === name).map((f) => ({ args: f.args, body_md5: f.body_md5, writes_vendor_credit_logs: f.writes_vendor_credit_logs, debits_credits: f.debits_credits, mentions_max_vendors: f.mentions_max_vendors, security_definer: f.security_definer })),
      body_md5_matches: JSON.stringify((staging.loadBearingFunctions || []).filter((f) => f.name === name).map((f) => f.body_md5).sort()) === JSON.stringify((production.loadBearingFunctions || []).filter((f) => f.name === name).map((f) => f.body_md5).sort()),
    })),
    safeCounts: { staging: staging.safeCounts, production: production.safeCounts },
  };
  const serialized = assertNoLeak(stableJson(drift));
  fs.writeFileSync(path.join(OUT, 'qf-mvp-db-drift-comparison.json'), serialized);
  log('wrote docs/generated/qf-mvp-db-drift-comparison.json');
}

function selftest() {
  let ok = true;
  const check = (cond, msg) => { if (!cond) { ok = false; log('SELFTEST FAIL:', msg); } };

  // 1. read-only guard accepts SELECT/SHOW and rejects every write/DDL keyword.
  try { assertReadOnly('select 1 from pg_class where relname = current_database();'); } catch { check(false, 'guard rejected a pure SELECT'); }
  try { assertReadOnly('show transaction_read_only;'); } catch { check(false, 'guard rejected SHOW'); }
  for (const bad of ['insert into t values(1)', 'update t set a=1', 'delete from t', 'drop table t', 'alter table t add x int', 'create table t()', 'truncate t', 'grant all on t to r', 'revoke all on t from r', 'do $$ begin end $$', 'copy t to stdout']) {
    let threw = false;
    try { assertReadOnly(bad); } catch { threw = true; }
    check(threw, `guard failed to reject: ${bad}`);
  }
  // guard must NOT false-positive on catalog names containing keyword substrings
  try { assertReadOnly('select grantee from information_schema.role_table_grants;'); } catch { check(false, 'guard false-positive on role_table_grants'); }

  // 2. deterministic serialization: same input → byte-identical output twice.
  const fixture = { b: [3, 1, 2], a: { z: 1, y: 2 }, note: 'metadata' };
  check(stableJson(fixture) === stableJson(fixture), 'stableJson not deterministic');

  // 3. leak fence: rejects a connection URL / JWT, accepts clean metadata.
  let leakCaught = false;
  try { assertNoLeak('{"url":"postgresql://u:p@host:5432/db"}'); } catch { leakCaught = true; }
  check(leakCaught, 'leak fence failed to catch a connection URL');
  try { assertNoLeak('{"table":"vendor_credit_logs","count":0}'); } catch { check(false, 'leak fence false-positive on clean metadata'); }

  // 4. every section SQL passes the read-only guard.
  for (const s of SECTIONS) {
    try { assertReadOnly(s.sql); } catch (e) { check(false, `section ${s.name}: ${e.message}`); }
  }

  log(ok ? 'SELFTEST PASS — guard, determinism, leak-fence, and all section SQL are read-only-safe.' : 'SELFTEST FAILED');
  process.exit(ok ? EXIT.OK : EXIT.SELFTEST_FAIL);
}

const cmd = process.argv[2];
if (cmd === 'staging' || cmd === 'production') collect(cmd);
else if (cmd === 'compare') compare();
else if (cmd === 'selftest') selftest();
else { log(`usage: run.mjs <staging|production|compare|selftest>`); process.exit(EXIT.USAGE); }
