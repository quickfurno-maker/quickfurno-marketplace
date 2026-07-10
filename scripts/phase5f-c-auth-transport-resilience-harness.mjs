import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import crypto from "node:crypto";

/**
 * Phase 5F-C1 — QuickFurno Authentication Transport Decision Engine + Atomic Attempt
 * Ledger harness.
 *
 * WHAT MAKES THIS HARNESS HONEST
 *   1. The mock database's CHECK constraints and UNIQUE INDEXES are PARSED OUT OF THE
 *      REAL MIGRATIONS (5F-A + 5F-C1). Deleting a constraint from the SQL really does
 *      stop the model enforcing it.
 *   2. The two atomic RPCs are modelled by an interpreter whose guards are DERIVED
 *      FROM THE FUNCTION BODIES. Removing `v_primary.outcome_certainty =
 *      'unknown_outcome'` from the SQL really does change how the model behaves.
 *   3. Concurrency is real: when the advisory lock is present the interpreter's
 *      critical section contains no `await`, so JS run-to-completion makes it atomic —
 *      exactly like a locked SQL transaction. Remove the lock from the SQL and the
 *      interpreter yields between the read and the insert, so two racing callers
 *      genuinely interleave.
 *
 * NOTHING here sends an SMS, chooses an SMS vendor, enables a fallback, or touches a
 * real database. No OTP value exists anywhere in this file.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const TS_FILES = [
  "lib/errors.ts",
  "lib/supabase.ts",
  "lib/identity/authTransport.ts",
  "lib/communication/authenticationActionIdentity.ts",
  "lib/communication/authenticationTransportDecision.ts",
  "services/authenticationTransportPolicyService.ts",
  "services/authenticationDeliveryAttemptService.ts",
];

function compileTo(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  const tsconfigPath = resolve(`${outDir}.tsconfig.json`);
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          module: "commonjs", target: "ES2020", moduleResolution: "node",
          skipLibCheck: true, esModuleInterop: true, strict: true, jsx: "preserve",
          outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] }, lib: ["ES2021", "DOM"],
        },
        files: TS_FILES,
      },
      null,
      2
    )
  );
  try {
    execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" });
  } finally {
    rmSync(tsconfigPath, { force: true });
  }
  return outDir;
}

function wireBuild(outDir) {
  const req = createRequire(`${outDir}/`);
  return {
    req,
    ActionId: req("./lib/communication/authenticationActionIdentity.js"),
    Engine: req("./lib/communication/authenticationTransportDecision.js"),
    AuthTransport: req("./lib/identity/authTransport.js"),
    PolicySvc: req("./services/authenticationTransportPolicyService.js"),
    AttemptSvc: req("./services/authenticationDeliveryAttemptService.js"),
    Supabase: req("./lib/supabase.js"),
  };
}

// ============================================================================
// FILE PATHS
// ============================================================================
const MIGRATION_5FA = "supabase/migrations/20260709000100_messaging_channel_provider_foundation.sql";
const MIGRATION_5FC = "supabase/migrations/20260710000100_auth_transport_resilience_decision_foundation.sql";
const ENGINE_SRC = "lib/communication/authenticationTransportDecision.ts";
const POLICY_SVC_SRC = "services/authenticationTransportPolicyService.ts";
const ATTEMPT_SVC_SRC = "services/authenticationDeliveryAttemptService.ts";
const DOC_5FC = "docs/QF-Authentication-Transport-Resilience-Phase-5F-C.md";

const CLAIM_FN = "qf_claim_auth_delivery_attempt";
const FINALIZE_FN = "qf_finalize_auth_delivery_attempt";

// ============================================================================
// SQL MODEL — parsed from the REAL migrations, rebuilt after every SQL mutation
// ============================================================================
const stripSql = (s) => s.replace(/--[^\n]*/g, "");
const readCode = (p) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");

function createTableBody(sql, name) {
  const marker = `create table if not exists public.${name} (`;
  const start = sql.indexOf(marker);
  if (start < 0) return "";
  let i = sql.indexOf("(", start);
  let depth = 0;
  let out = "";
  for (; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "(") { depth += 1; if (depth === 1) continue; }
    if (ch === ")") { depth -= 1; if (depth === 0) break; }
    out += ch;
  }
  return out;
}

/** Body of `create or replace function public.NAME(...) ... as $$ ... $$;` */
function functionBody(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start === -1) return "";
  const bodyStart = sql.indexOf("as $$", start);
  if (bodyStart === -1) return "";
  const bodyEnd = sql.indexOf("$$;", bodyStart + 5);
  if (bodyEnd === -1) return "";
  return sql.slice(bodyStart + 5, bodyEnd);
}

/** The parameter list of `create or replace function public.NAME( ... )`. */
function functionSignature(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start === -1) return "";
  let i = sql.indexOf("(", start);
  let depth = 0;
  let out = "";
  for (; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "(") { depth += 1; if (depth === 1) continue; }
    if (ch === ")") { depth -= 1; if (depth === 0) break; }
    out += ch;
  }
  return out;
}

/** Roles explicitly granted EXECUTE on a function, and roles revoked from it. */
function functionGrants(sql, name) {
  const granted = new Set();
  const revoked = new Set();
  const grantRe = new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to (\\w+);`, "gi");
  const revokeRe = new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from (\\w+);`, "gi");
  for (const m of sql.matchAll(grantRe)) granted.add(m[1].toLowerCase());
  for (const m of sql.matchAll(revokeRe)) revoked.add(m[1].toLowerCase());
  return { granted, revoked };
}

/** Table-level grants/revokes. */
function tableGrants(sql, table) {
  const granted = {};
  const revoked = new Set();
  const grantRe = new RegExp(`grant ([\\w, ]+) on public\\.${table} to (\\w+);`, "gi");
  const revokeRe = new RegExp(`revoke all on public\\.${table} from (\\w+);`, "gi");
  for (const m of sql.matchAll(grantRe)) {
    granted[m[2].toLowerCase()] = m[1].split(",").map((s) => s.trim().toLowerCase());
  }
  for (const m of sql.matchAll(revokeRe)) revoked.add(m[1].toLowerCase());
  return { granted, revoked };
}

/**
 * Extract a `where` clause out of a SQL function body. The interpreter turns it into a
 * real row predicate, so re-scoping a query in the migration genuinely re-scopes the
 * model's lookup — it is never a hardcoded assumption about what the SQL "probably" does.
 */
function whereClause(body, re) {
  const m = body.match(re);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

/** Compile `a.col = p_param` / `a.col = 3` conjunctions into a row predicate. */
function wherePredicate(where) {
  if (!where) return null;
  const atoms = [...where.matchAll(/a\.(\w+)\s*=\s*(p_\w+|\d+)/g)].map(([, col, operand]) =>
    /^\d+$/.test(operand)
      ? (row) => row[col] === Number(operand)
      : (row, params) => row[col] === params[operand]
  );
  if (atoms.length === 0) throw new Error(`unsupported where clause: "${where}"`);
  return (row, params) => atoms.every((f) => f(row, params));
}

/**
 * Evaluate a PostgreSQL `||` concatenation of literals and `p_*` parameters into the real
 * advisory-lock key. Re-namespace the lock in the SQL and callers really do stop (or
 * start) serializing together.
 */
function evaluateLockKey(expression, params) {
  if (!expression) return null;
  return expression
    .split("||")
    .map((part) => {
      const token = part.trim();
      const literal = token.match(/^'([^']*)'$/);
      if (literal) return literal[1];
      if (/^p_\w+$/.test(token)) return String(params[token] ?? "");
      throw new Error(`unsupported advisory lock token: "${token}"`);
    })
    .join("");
}

/** A per-key async mutex — the model of `pg_advisory_xact_lock`. */
function createMutex() {
  let tail = Promise.resolve();
  return async () => {
    let unlock;
    const held = new Promise((resolve) => { unlock = resolve; });
    const previous = tail;
    tail = tail.then(() => held);
    await previous;
    return unlock;
  };
}
const advisoryLocks = new Map();
async function acquireAdvisoryLock(key) {
  if (key === null) return null;
  if (!advisoryLocks.has(key)) advisoryLocks.set(key, createMutex());
  return advisoryLocks.get(key)();
}

const UNIQUE_INDEX_RE =
  /create\s+unique\s+index(?:\s+if\s+not\s+exists)?\s+(\w+)\s+on\s+public\.(\w+)\s*\(([^)]*)\)(?:\s*where\s+([^;]+))?;/gi;

/** Compile a conjunctive partial-index predicate into a JS row predicate. */
function compilePredicate(sql) {
  if (!sql) return () => true;
  const atoms = sql.trim().toLowerCase().split(/\s+and\s+/);
  const tests = atoms.map((atom) => {
    let m = atom.match(/^(\w+)\s+is\s+not\s+null$/);
    if (m) return (r) => r[m[1]] !== null && r[m[1]] !== undefined;
    m = atom.match(/^(\w+)\s+is\s+null$/);
    if (m) return (r) => r[m[1]] === null || r[m[1]] === undefined;
    m = atom.match(/^(\w+)\s*=\s*(\d+)$/);
    if (m) return (r) => r[m[1]] === Number(m[2]);
    m = atom.match(/^(\w+)\s*=\s*'([^']*)'$/);
    if (m) return (r) => r[m[1]] === m[2];
    m = atom.match(/^(\w+)$/);
    if (m) return (r) => r[m[1]] === true;
    throw new Error(`unsupported index predicate atom: "${atom}"`);
  });
  return (row) => tests.every((t) => t(row));
}

/** The 5F-A seeded transport policy rows, parsed straight out of the migration. */
function parsePolicySeed(sql) {
  const m = sql.match(
    /insert into public\.authentication_transport_policies\s*\(([\s\S]*?)\)\s*values([\s\S]*?)on conflict/i
  );
  if (!m) return [];
  const cols = m[1].split(",").map((c) => c.trim());
  const rows = [];
  for (const tuple of m[2].matchAll(/\(([^)]*)\)/g)) {
    const vals = tuple[1].split(",").map((v) => {
      const t = v.trim();
      if (t === "null") return null;
      if (t === "true") return true;
      if (t === "false") return false;
      return t.replace(/^'|'$/g, "");
    });
    const row = {};
    cols.forEach((c, i) => { row[c] = vals[i]; });
    rows.push(row);
  }
  return rows;
}

function loadSql() {
  const raw5fa = readFileSync(MIGRATION_5FA, "utf8");
  const raw = readFileSync(MIGRATION_5FC, "utf8");
  const stripped = stripSql(raw);
  const stripped5fa = stripSql(raw5fa);
  const norm = stripped.toLowerCase().replace(/\s+/g, " ");

  const uniqueIndexes = {};
  for (const sql of [stripped5fa, stripped]) {
    UNIQUE_INDEX_RE.lastIndex = 0;
    for (const m of sql.matchAll(UNIQUE_INDEX_RE)) {
      const [, name, table, cols, where] = m;
      (uniqueIndexes[table] ??= []).push({
        name,
        cols: cols.split(",").map((c) => c.trim()),
        where: compilePredicate(where),
      });
    }
  }
  // An index the 5F-C1 migration DROPs leaves the model. Delete the `drop index`
  // statement from the SQL and the retired reference-scoped index really does come back.
  const droppedIndexes = new Set(
    [...stripped.matchAll(/drop index if exists public\.(\w+);/gi)].map((m) => m[1])
  );
  for (const table of Object.keys(uniqueIndexes)) {
    uniqueIndexes[table] = uniqueIndexes[table].filter((i) => !droppedIndexes.has(i.name));
  }

  // The `auth_action_id` CHECK pattern is PARSED (case-preserved) out of the migration,
  // so relaxing it in the SQL really does relax the model's ledger.
  const normCase = stripped.replace(/\s+/g, " ");
  const actionIdCheck = normCase.match(/check \(auth_action_id ~ '([^']+)'\)/);
  const actionIdPattern = actionIdCheck ? new RegExp(actionIdCheck[1]) : null;

  // Table CHECK constraints the ledger model enforces — DERIVED from the migration.
  const attemptChecks = {
    maxTwo: /check \(attempt_number in \(1, 2\)\)/.test(norm),
    actionIdPattern,
    actionIdIsSha256: actionIdCheck ? actionIdCheck[1] === "^[0-9a-f]{64}$" : false,
    actionIdNotNull: /alter column auth_action_id set not null/.test(norm),
    shape:
      /\(attempt_number = 1 and channel = 'whatsapp' and fallback_from_attempt_id is null\)/.test(norm) &&
      /\(attempt_number = 2 and channel = 'sms' and fallback_from_attempt_id is not null\)/.test(norm),
    whatsappVerifyNoFallback: /check \(auth_flow <> 'vendor_whatsapp_verify' or attempt_number = 1\)/.test(norm),
    statusCertainty:
      /\(outcome_certainty = 'accepted' and status in \('accepted', 'sent', 'delivered', 'read'\)\)/.test(norm) &&
      /\(outcome_certainty = 'definitive_failure' and status in \('failed', 'cancelled'\)\)/.test(norm) &&
      /\(outcome_certainty = 'unknown_outcome' and status in \('requested', 'dispatching', 'outcome_unknown'\)\)/.test(norm),
    statusVocabularyHasUnknown: /check \(status in \('requested', 'dispatching', 'accepted', 'sent', 'delivered', 'read', 'failed', 'cancelled', 'outcome_unknown'\)\)/.test(norm),
    sanitizedCodes: /failure_code is null or failure_code ~ '\^\[a-za-z0-9_\]\{1,120\}\$'/.test(norm),
  };

  const claimBody = functionBody(stripped, CLAIM_FN);
  const finalizeBody = functionBody(stripped, FINALIZE_FN);
  const lockMatch = claimBody.match(/pg_advisory_xact_lock\(hashtextextended\(([\s\S]*?), 0\)\)/);
  const lockExpression = lockMatch ? lockMatch[1].trim() : null;

  // The interpreter's guard set is DERIVED from the SQL, never hardcoded.
  const guards = {
    claim: {
      validatesAuthFlow: /p_auth_flow not in \('client_login_otp'/.test(claimBody),
      validatesReference: /p_auth_reference_type not in \('verification_challenge', 'auth_user'\)/.test(claimBody),
      validatesAttemptRange: /p_attempt_number not in \(1, 2\)/.test(claimBody),
      validatesPrimaryChannel: /p_attempt_number = 1 and p_channel <> 'whatsapp'/.test(claimBody),
      validatesFallbackChannel: /p_attempt_number = 2 and p_channel <> 'sms'/.test(claimBody),
      refusesWhatsappVerifyFallback: /p_attempt_number = 2 and p_auth_flow = 'vendor_whatsapp_verify'/.test(claimBody),
      validatesActionId: /p_auth_action_id is null or p_auth_action_id !~/.test(claimBody),
      // The RPC's own action-id pattern, parsed straight out of the function body.
      actionIdPattern: (() => {
        const m = claimBody.match(/p_auth_action_id !~ '([^']+)'/);
        return m ? new RegExp(m[1]) : null;
      })(),
      serializes: /pg_advisory_xact_lock/.test(claimBody),
      // The ADVISORY LOCK EXPRESSION, parsed verbatim. The interpreter evaluates it to a
      // real lock key, so re-namespacing the lock in the SQL genuinely changes which
      // callers serialize — the lock is not merely asserted to exist.
      lockExpression: lockExpression,
      lockIncludesActionId: /p_auth_action_id/.test(lockExpression ?? ""),
      lockIncludesAuthFlow: /p_auth_flow/.test(lockExpression ?? ""),
      lockIncludesReference: /p_auth_reference/.test(lockExpression ?? ""),
      /** The lock namespace must be the action identity ALONE. */
      locksOnAction:
        /p_auth_action_id/.test(lockExpression ?? "") &&
        !/p_auth_flow/.test(lockExpression ?? "") &&
        !/p_auth_reference/.test(lockExpression ?? ""),
      // The attempt-budget count, scoped by the SQL's own `where` clause.
      countWhere: whereClause(claimBody, /select count\(\*\) into v_count[\s\S]*?where ([\s\S]*?);/),
      countsByAction: /select count\(\*\) into v_count[\s\S]{0,200}?where a\.auth_action_id = p_auth_action_id;/.test(claimBody),
      countsAttempts: /v_count >= 2/.test(claimBody),
      primaryIdempotent: /'already_exists'/.test(claimBody),
      // The primary-claim conflict probe, scoped by the SQL's own `where` clause.
      primaryProbeWhere: whereClause(claimBody, /select \* into v_existing[\s\S]*?where ([\s\S]*?)\s*order by/),
      primaryLookupByAction: /where a\.auth_action_id = p_auth_action_id\s*order by a\.attempt_number/.test(claimBody),
      primaryLineage:
        /v_existing\.auth_flow is distinct from p_auth_flow/.test(claimBody) &&
        /v_existing\.auth_reference_type is distinct from p_auth_reference_type/.test(claimBody) &&
        /v_existing\.auth_reference_id is distinct from p_auth_reference_id/.test(claimBody) &&
        /v_existing\.destination_hash is distinct from p_destination_hash/.test(claimBody),
      requiresPrimary: /'primary_required'/.test(claimBody),
      // The fallback's primary lookup, scoped by the SQL's own `where` clause.
      fallbackLookupWhere: whereClause(claimBody, /select \* into v_primary[\s\S]*?where ([\s\S]*?)\s*limit 1/),
      fallbackLookupByAction: /where a\.auth_action_id = p_auth_action_id\s*and a\.attempt_number = 1/.test(claimBody),
      checksFallbackAuthFlow: /v_primary\.auth_flow is distinct from p_auth_flow/.test(claimBody),
      checksFallbackAuthAction: /v_primary\.auth_action_id is distinct from p_auth_action_id/.test(claimBody),
      checksFallbackReference:
        /v_primary\.auth_reference_type is distinct from p_auth_reference_type/.test(claimBody) &&
        /v_primary\.auth_reference_id is distinct from p_auth_reference_id/.test(claimBody),
      checksFallbackDestination: /v_primary\.destination_hash is distinct from p_destination_hash/.test(claimBody),
      checksPrimaryChannel: /v_primary\.channel <> 'whatsapp'/.test(claimBody),
      refusesAccepted: /v_primary\.outcome_certainty = 'accepted'/.test(claimBody),
      refusesUnknown: /v_primary\.outcome_certainty = 'unknown_outcome'/.test(claimBody),
      requiresDefinitive: /v_primary\.outcome_certainty <> 'definitive_failure'/.test(claimBody),
      requiresTerminalStatus: /v_primary\.status not in \('failed', 'cancelled'\)/.test(claimBody),
      existingFallbackWhere: whereClause(claimBody, /if exists \(\s*select 1 from public\.authentication_delivery_attempts a\s*where ([\s\S]*?)\s*\) then/),
      refusesExistingFallback: /if exists \([\s\S]{0,400}?a\.auth_action_id = p_auth_action_id[\s\S]{0,200}?attempt_number = 2[\s\S]{0,200}?\) then[\s\S]{0,200}?attempt_limit_reached/.test(claimBody),
      linksLineage: /v_primary\.id,\s*'requested'/.test(claimBody) || /fallback_from_attempt_id, status/.test(claimBody),
    },
    finalize: {
      validatesMatrix: /p_outcome_certainty = 'accepted'\s+and p_status in \('accepted', 'sent', 'delivered', 'read'\)/.test(finalizeBody),
      protectsUnknown: /v_row\.outcome_certainty = 'unknown_outcome' and v_row\.status = 'outcome_unknown'/.test(finalizeBody),
      protectsAccepted: /v_row\.outcome_certainty = 'accepted' and p_outcome_certainty <> 'accepted'/.test(finalizeBody),
      protectsDefinitive: /v_row\.outcome_certainty = 'definitive_failure' and p_outcome_certainty <> 'definitive_failure'/.test(finalizeBody),
      protectsMessageLink: /communication_message_already_linked/.test(finalizeBody),
    },
  };

  // The SCHEMA text: `--` comments already gone, and `comment on ... is '...'`
  // documentation strings removed too, so a doc string can never satisfy — nor break —
  // a security assertion about what the schema actually contains.
  // (The doc string itself may contain `;`, so the literal — not the first semicolon —
  // is what terminates the statement.)
  const schema = stripped.replace(/comment on\s+\w+\s+[\s\S]*?is\s+'(?:[^']|'')*';/gi, "");
  // The IDENTIFIER text: every single-quoted literal removed as well. A column name or a
  // function parameter survives; a `raise ... hint` sentence or an enum literal does not.
  // So "no OTP column / no OTP argument" is asserted against declarations, not prose.
  const ddl = schema.replace(/'(?:[^']|'')*'/g, "''");

  return {
    raw, stripped, schema, ddl, norm, raw5fa, stripped5fa,
    uniqueIndexes, droppedIndexes, attemptChecks, guards,
    claimBody, finalizeBody,
    claimSignature: functionSignature(stripped, CLAIM_FN),
    finalizeSignature: functionSignature(stripped, FINALIZE_FN),
    claimGrants: functionGrants(stripped, CLAIM_FN),
    finalizeGrants: functionGrants(stripped, FINALIZE_FN),
    failureRuleTable: createTableBody(stripped, "authentication_transport_failure_rules"),
    failureRuleGrants: tableGrants(stripped, "authentication_transport_failure_rules"),
    attemptGrants: tableGrants(stripped, "authentication_delivery_attempts"),
    policySeed: parsePolicySeed(stripped5fa),
  };
}
let SQL = loadSql();
function rebuildSqlModel() { SQL = loadSql(); }

// ============================================================================
// REGISTRY
// ============================================================================
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const tick = () => new Promise((r) => setImmediate(r));

// ============================================================================
// MAIN BUILD
// ============================================================================
const MAIN_DIR = resolve(".phase5fc-build-main");
compileTo(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// IN-MEMORY DATABASE (constraints PARSED from the real migrations)
// ============================================================================
const DB_TABLES = [
  "authentication_transport_policies",
  "authentication_transport_failure_rules",
  "authentication_delivery_attempts",
];
const db = {};
function resetDb() {
  for (const t of DB_TABLES) db[t] = [];
  advisoryLocks.clear(); // every lock is released by then; drop the empty mutex chains
}
resetDb();

function pgError(code, constraint) {
  const e = new Error(`${code}: ${constraint}`);
  e.code = code;
  e.constraint = constraint;
  return e;
}

const CONSISTENT = {
  accepted: ["accepted", "sent", "delivered", "read"],
  definitive_failure: ["failed", "cancelled"],
  unknown_outcome: ["requested", "dispatching", "outcome_unknown"],
};

/** Table CHECKs for authentication_delivery_attempts, enforced from the parsed model. */
function enforceAttemptChecks(row) {
  const C = SQL.attemptChecks;
  if (C.actionIdNotNull && (row.auth_action_id === null || row.auth_action_id === undefined)) {
    throw pgError("23502", "auth_action_id_not_null");
  }
  if (C.actionIdPattern && row.auth_action_id != null && !C.actionIdPattern.test(row.auth_action_id)) {
    throw pgError("23514", "chk_auth_attempt_action_id_shape");
  }
  if (C.statusVocabularyHasUnknown) {
    const vocab = ["requested", "dispatching", "accepted", "sent", "delivered", "read", "failed", "cancelled", "outcome_unknown"];
    if (!vocab.includes(row.status)) throw pgError("23514", "auth_delivery_attempt_status_chk");
  }
  if (C.maxTwo && ![1, 2].includes(row.attempt_number)) {
    throw pgError("23514", "chk_auth_attempt_number_max_two");
  }
  if (C.shape) {
    const primary = row.attempt_number === 1 && row.channel === "whatsapp" && row.fallback_from_attempt_id == null;
    const fallback = row.attempt_number === 2 && row.channel === "sms" && row.fallback_from_attempt_id != null;
    if (!primary && !fallback) throw pgError("23514", "chk_auth_attempt_shape");
  }
  if (C.whatsappVerifyNoFallback && row.auth_flow === "vendor_whatsapp_verify" && row.attempt_number !== 1) {
    throw pgError("23514", "chk_auth_attempt_whatsapp_verify_no_fallback");
  }
  if (C.statusCertainty) {
    const allowed = CONSISTENT[row.outcome_certainty];
    if (!allowed || !allowed.includes(row.status)) throw pgError("23514", "chk_auth_attempt_status_certainty");
  }
  if (C.sanitizedCodes) {
    for (const field of ["failure_code", "decision_reason", "failure_classification"]) {
      const v = row[field];
      if (v != null && !/^[A-Za-z0-9_]{1,120}$/.test(v)) throw pgError("23514", "chk_auth_attempt_sanitized_codes");
    }
  }
}

/** Failure-rule CHECK: vendor_whatsapp_verify is never eligible. */
function enforceFailureRuleChecks(row) {
  if (!/chk_auth_failure_rule_whatsapp_verify_never_eligible/.test(SQL.stripped)) return;
  if (row.auth_flow === "vendor_whatsapp_verify" && (row.automatic_fallback_eligible || row.user_requested_fallback_eligible)) {
    throw pgError("23514", "chk_auth_failure_rule_whatsapp_verify_never_eligible");
  }
}

function enforceUniqueIndexes(table, row) {
  for (const idx of SQL.uniqueIndexes[table] ?? []) {
    if (!idx.where(row)) continue;
    const clash = db[table].some(
      (existing) => existing !== row && idx.where(existing) && idx.cols.every((c) => existing[c] === row[c])
    );
    if (clash) throw pgError("23505", idx.name);
  }
}

function insertRow(table, values) {
  const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...values };
  if (table === "authentication_delivery_attempts") enforceAttemptChecks(row);
  if (table === "authentication_transport_failure_rules") enforceFailureRuleChecks(row);
  db[table].push(row);
  try {
    enforceUniqueIndexes(table, row);
  } catch (e) {
    db[table] = db[table].filter((r) => r !== row);
    throw e;
  }
  return row;
}

function updateRow(table, row, patch) {
  const next = { ...row, ...patch };
  if (table === "authentication_delivery_attempts") enforceAttemptChecks(next);
  Object.assign(row, patch);
  return row;
}

// ---- query builder ---------------------------------------------------------
class QB {
  constructor(table) { this.table = table; this.filters = []; }
  select() { return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  rows() {
    let list = db[this.table] ?? [];
    for (const f of this.filters) list = list.filter(f);
    return list;
  }
  async maybeSingle() { const list = this.rows(); return { data: list[0] ?? null, error: null }; }
  async then(res) { return res({ data: this.rows(), error: null }); }
}

// ---- RPC interpreter (guards DERIVED from the SQL function bodies) ---------
const AUTH_FLOWS = ["client_login_otp", "vendor_whatsapp_verify", "vendor_password_reset"];
const REFERENCE_TYPES = ["verification_challenge", "auth_user"];

function claimRow(outcome, detail, attempt) {
  return [{
    outcome, detail,
    attempt_id: attempt?.id ?? null,
    attempt_number: attempt?.attempt_number ?? null,
    channel: attempt?.channel ?? null,
    fallback_from_attempt_id: attempt?.fallback_from_attempt_id ?? null,
  }];
}

/**
 * `qf_claim_auth_delivery_attempt`.
 *
 * CONCURRENCY IS MODELLED, NOT ASSUMED. The interpreter evaluates the migration's OWN
 * `pg_advisory_xact_lock(hashtextextended(<expr>, 0))` expression into a real lock key and
 * takes a per-key async mutex. It then YIELDS inside the critical section, so JS
 * run-to-completion can never mask a missing or wrongly-namespaced lock: only holding the
 * right lock keeps the read and the insert atomic. Re-namespace the lock in the SQL and
 * callers really do stop (or start) serializing together; delete it and they interleave.
 *
 * Every lookup is likewise scoped by the SQL's OWN `where` clause, compiled into a row
 * predicate. Re-point a `where` clause in the migration and the model really does start
 * grouping attempts by the wrong thing.
 */
async function rpcClaim(p) {
  const g = SQL.guards.claim;
  if (g.validatesAuthFlow && (p.p_auth_flow == null || !AUTH_FLOWS.includes(p.p_auth_flow))) {
    return claimRow("invalid_request", "unknown_auth_flow", null);
  }
  if (g.validatesActionId && (p.p_auth_action_id == null || !g.actionIdPattern.test(p.p_auth_action_id))) {
    return claimRow("invalid_request", "invalid_auth_action_id", null);
  }
  if (g.validatesReference && (!REFERENCE_TYPES.includes(p.p_auth_reference_type) || !p.p_auth_reference_id || !p.p_destination_hash || !p.p_provider_key)) {
    return claimRow("invalid_request", "missing_reference", null);
  }
  if (g.validatesAttemptRange && ![1, 2].includes(p.p_attempt_number)) {
    return claimRow("attempt_limit_reached", "attempt_number_out_of_range", null);
  }
  if (g.validatesPrimaryChannel && p.p_attempt_number === 1 && p.p_channel !== "whatsapp") {
    return claimRow("lineage_mismatch", "primary_channel_must_be_whatsapp", null);
  }
  if (g.validatesFallbackChannel && p.p_attempt_number === 2 && p.p_channel !== "sms") {
    return claimRow("lineage_mismatch", "fallback_channel_must_be_sms", null);
  }
  if (g.refusesWhatsappVerifyFallback && p.p_attempt_number === 2 && p.p_auth_flow === "vendor_whatsapp_verify") {
    return claimRow("whatsapp_verify_fallback_forbidden", "possession_flow", null);
  }

  // The advisory lock the SQL actually takes (null when it takes none).
  const lockKey = g.serializes ? evaluateLockKey(g.lockExpression, p) : null;
  const unlock = await acquireAdvisoryLock(lockKey);
  try {
    return await claimCriticalSection(p, g);
  } finally {
    if (unlock) unlock();
  }
}

async function claimCriticalSection(p, g) {
  const attempts = () => db.authentication_delivery_attempts;
  const scoped = (where) => {
    const predicate = wherePredicate(where);
    return attempts().filter((a) => predicate(a, p));
  };
  const budget = () => scoped(g.countWhere);

  // The section yields, so ONLY the advisory lock can make it atomic.
  await tick();

  if (g.countsAttempts && budget().length >= 2) {
    return claimRow("attempt_limit_reached", "two_attempts_already_recorded", null);
  }

  if (p.p_attempt_number === 1) {
    const scope = scoped(g.primaryProbeWhere);
    const existing = [...scope].sort((a, b) => a.attempt_number - b.attempt_number)[0];
    await tick();
    if (existing) {
      if (
        g.primaryLineage &&
        (existing.auth_flow !== p.p_auth_flow ||
          existing.auth_reference_type !== p.p_auth_reference_type ||
          existing.auth_reference_id !== p.p_auth_reference_id ||
          existing.destination_hash !== p.p_destination_hash)
      ) {
        return claimRow("lineage_mismatch", "action_identity_conflict", null);
      }
      if (g.primaryIdempotent) return claimRow("already_exists", "primary_already_claimed", existing);
    }
    const row = insertRow("authentication_delivery_attempts", {
      auth_flow: p.p_auth_flow, auth_action_id: p.p_auth_action_id,
      auth_reference_type: p.p_auth_reference_type,
      auth_reference_id: p.p_auth_reference_id, challenge_id: p.p_challenge_id ?? null,
      auth_user_id: p.p_auth_user_id ?? null, destination_hash: p.p_destination_hash,
      attempt_number: 1, channel: "whatsapp", provider_key: p.p_provider_key,
      communication_message_id: null, fallback_from_attempt_id: null,
      status: "requested", outcome_certainty: "unknown_outcome",
      failure_code: null, failure_classification: null, decision_reason: p.p_decision_reason ?? null,
    });
    return claimRow("claimed", "primary_claimed", row);
  }

  // ---- fallback claim ----
  const primary = scoped(g.fallbackLookupWhere)[0];
  if (!primary) {
    if (g.requiresPrimary) return claimRow("primary_required", "no_primary_attempt", null);
    throw pgError("23514", "chk_auth_attempt_shape");
  }
  if (g.checksFallbackAuthFlow && primary.auth_flow !== p.p_auth_flow) {
    return claimRow("lineage_mismatch", "auth_flow_mismatch", null);
  }
  if (g.checksFallbackAuthAction && primary.auth_action_id !== p.p_auth_action_id) {
    return claimRow("lineage_mismatch", "auth_action_mismatch", null);
  }
  if (
    g.checksFallbackReference &&
    (primary.auth_reference_type !== p.p_auth_reference_type || primary.auth_reference_id !== p.p_auth_reference_id)
  ) {
    return claimRow("lineage_mismatch", "auth_reference_mismatch", null);
  }
  if (g.checksFallbackDestination && primary.destination_hash !== p.p_destination_hash) {
    return claimRow("lineage_mismatch", "destination_hash_mismatch", null);
  }
  if (g.checksPrimaryChannel && primary.channel !== "whatsapp") {
    return claimRow("lineage_mismatch", "primary_not_whatsapp", null);
  }
  if (g.refusesAccepted && primary.outcome_certainty === "accepted") {
    return claimRow("accepted_primary_blocked", "primary_accepted", null);
  }
  if (g.refusesUnknown && primary.outcome_certainty === "unknown_outcome") {
    return claimRow("unknown_outcome_blocked", "primary_outcome_unknown", null);
  }
  if (g.requiresDefinitive && primary.outcome_certainty !== "definitive_failure") {
    return claimRow("primary_not_definitive", "certainty_not_definitive", null);
  }
  if (g.requiresTerminalStatus && !["failed", "cancelled"].includes(primary.status)) {
    return claimRow("primary_not_definitive", "status_not_terminal_failure", null);
  }
  if (g.refusesExistingFallback && scoped(g.existingFallbackWhere).length > 0) {
    return claimRow("attempt_limit_reached", "fallback_already_claimed", null);
  }
  await tick();
  const row = insertRow("authentication_delivery_attempts", {
    auth_flow: p.p_auth_flow, auth_action_id: p.p_auth_action_id,
    auth_reference_type: p.p_auth_reference_type,
    auth_reference_id: p.p_auth_reference_id, challenge_id: primary.challenge_id,
    auth_user_id: primary.auth_user_id, destination_hash: p.p_destination_hash,
    attempt_number: 2, channel: "sms", provider_key: p.p_provider_key,
    communication_message_id: null, fallback_from_attempt_id: primary.id,
    status: "requested", outcome_certainty: "unknown_outcome",
    failure_code: null, failure_classification: null, decision_reason: p.p_decision_reason ?? null,
  });
  return claimRow("claimed", "fallback_claimed", row);
}

function finalizeRow(outcome, detail, row) {
  return [{
    outcome, detail,
    attempt_id: row?.id ?? null,
    status: row?.status ?? null,
    outcome_certainty: row?.outcome_certainty ?? null,
  }];
}

async function rpcFinalize(p) {
  const g = SQL.guards.finalize;
  if (!p.p_attempt_id || !p.p_status || !p.p_outcome_certainty) {
    return finalizeRow("invalid_request", "missing_argument", null);
  }
  if (g.validatesMatrix) {
    const allowed = { accepted: ["accepted", "sent", "delivered", "read"], definitive_failure: ["failed", "cancelled"], unknown_outcome: ["outcome_unknown"] };
    const list = allowed[p.p_outcome_certainty];
    if (!list || !list.includes(p.p_status)) return finalizeRow("contradictory_state", "status_certainty_mismatch", null);
  }
  const row = db.authentication_delivery_attempts.find((a) => a.id === p.p_attempt_id);
  if (!row) return finalizeRow("not_found", "attempt_not_found", null);

  if (g.protectsUnknown && row.outcome_certainty === "unknown_outcome" && row.status === "outcome_unknown") {
    if (p.p_outcome_certainty === "unknown_outcome" && p.p_status === "outcome_unknown") {
      return finalizeRow("no_change", "already_outcome_unknown", row);
    }
    return finalizeRow("terminal_outcome_unknown", "unknown_outcome_is_not_rewritable", row);
  }
  if (g.protectsAccepted && row.outcome_certainty === "accepted" && p.p_outcome_certainty !== "accepted") {
    return finalizeRow("terminal_accepted", "accepted_cannot_regress", row);
  }
  if (g.protectsDefinitive && row.outcome_certainty === "definitive_failure" && p.p_outcome_certainty !== "definitive_failure") {
    return finalizeRow("terminal_definitive_failure", "definitive_failure_cannot_regress", row);
  }
  if (g.protectsMessageLink && row.communication_message_id && p.p_communication_message_id && row.communication_message_id !== p.p_communication_message_id) {
    return finalizeRow("lineage_mismatch", "communication_message_already_linked", row);
  }

  updateRow("authentication_delivery_attempts", row, {
    status: p.p_status,
    outcome_certainty: p.p_outcome_certainty,
    failure_code: p.p_failure_code ?? row.failure_code,
    failure_classification: p.p_failure_classification ?? row.failure_classification,
    communication_message_id: row.communication_message_id ?? p.p_communication_message_id ?? null,
    completed_at: row.completed_at ?? new Date().toISOString(),
  });
  return finalizeRow("finalized", "attempt_finalized", row);
}

/** Counts RPC invocations, so "the service fails closed BEFORE the database" is testable. */
let rpcCallCount = 0;
const resetRpcCalls = () => { rpcCallCount = 0; };

function stubDb(build) {
  build.Supabase.adminClient = () => ({
    from: (t) => new QB(t),
    rpc: async (name, params) => {
      rpcCallCount += 1;
      try {
        if (name === CLAIM_FN) return { data: await rpcClaim(params), error: null };
        if (name === FINALIZE_FN) return { data: await rpcFinalize(params), error: null };
        return { data: null, error: { code: "42883", message: "function not found" } };
      } catch (e) {
        return { data: null, error: { code: e.code ?? "XX000", message: e.message } };
      }
    },
  });
}
stubDb(M);

// ============================================================================
// FIXTURES
// ============================================================================
const HASH_A = crypto.createHash("sha256").update("+15550001111").digest("hex");
const HASH_B = crypto.createHash("sha256").update("+15550002222").digest("hex");

/** Derive an action identity exactly as production must — never a hand-written string. */
const derive = (authFlow, sourceKind, authoritativeActionId, build = M) =>
  build.ActionId.deriveAuthenticationActionId({ authFlow, sourceKind, authoritativeActionId });
const clientAction = (webhookId, build = M) => derive("client_login_otp", "supabase_webhook", webhookId, build);
const challengeAction = (flow, challengeId, build = M) => derive(flow, "verification_challenge", challengeId, build);

/** Two logins by ONE auth user: distinct VERIFIED webhook ids → distinct action ids. */
const ACTION_A = clientAction("hook-A");
const ACTION_B = clientAction("hook-B");
const VERIFY_CHAL_1 = challengeAction("vendor_whatsapp_verify", "chal-1");
const RESET_CHAL_1 = challengeAction("vendor_password_reset", "chal-1");
const SHA256_HEX = /^[0-9a-f]{64}$/;

const REF = { authActionId: ACTION_A, authReferenceType: "auth_user", authReferenceId: "user-1", destinationHash: HASH_A };
const MODE = () => M.Engine.AuthFallbackRequestMode;
const REASON = () => M.Engine.AuthFallbackBlockReason;

/** A hypothetical FULLY-ENABLED policy. No such row exists in the migration seed. */
function greenPolicy(over = {}) {
  return {
    auth_flow: "client_login_otp", primary_channel: "whatsapp", primary_provider_key: "mock",
    fallback_channel: "sms", fallback_provider_key: "sms_mock",
    automatic_fallback_enabled: true, user_requested_fallback_enabled: true,
    fallback_policy_status: "automatic_ready", hard_failure_only: true, is_operationally_enabled: true,
    ...over,
  };
}
function definitivePrimary(over = {}) {
  return {
    authFlow: "client_login_otp", authActionId: ACTION_A,
    authReferenceType: "auth_user", authReferenceId: "user-1",
    destinationHash: HASH_A, attemptNumber: 1, channel: "whatsapp", providerKey: "mock",
    status: "failed", outcomeCertainty: "definitive_failure", failureCode: "META_ERROR_131026",
    ...over,
  };
}
const ELIGIBLE = { resolved: true, ruleId: "r1", scope: "auth_flow", automaticFallbackEligible: true, userRequestedFallbackEligible: true };
const NO_RULE = { resolved: false, reason: "no_rule" };
const HISTORY = (over = {}) => ({ authActionId: ACTION_A, totalAttempts: 1, hasFallbackAttempt: false, ...over });

function decide(over = {}, build = M) {
  return build.Engine.evaluateAuthenticationFallback({
    authFlow: "client_login_otp",
    requestMode: build.Engine.AuthFallbackRequestMode.AUTOMATIC,
    policy: greenPolicy(),
    primaryAttempt: definitivePrimary(),
    failureEligibility: ELIGIBLE,
    attemptHistory: HISTORY(),
    request: { ...REF },
    ...over,
  });
}

function failureRule(over = {}) {
  return {
    id: crypto.randomUUID(), auth_flow: "client_login_otp", primary_channel: "whatsapp",
    primary_provider_key: "mock", failure_code: "META_ERROR_131026", failure_classification: "provider_rejected",
    automatic_fallback_eligible: true, user_requested_fallback_eligible: true, is_active: true, ...over,
  };
}

async function claimPrimary(over = {}, build = M) {
  return build.AttemptSvc.claimPrimaryAttempt({
    authFlow: "client_login_otp", authActionId: ACTION_A,
    authReferenceType: "auth_user", authReferenceId: "user-1",
    destinationHash: HASH_A, providerKey: "mock", decisionReason: "PRIMARY", ...over,
  });
}
async function claimFallback(over = {}, build = M) {
  return build.AttemptSvc.claimFallbackAttempt({
    authFlow: "client_login_otp", authActionId: ACTION_A,
    authReferenceType: "auth_user", authReferenceId: "user-1",
    destinationHash: HASH_A, providerKey: "sms_mock", decisionReason: "ALLOWED", ...over,
  });
}
/** Force a primary into a definitive failure without going through the finalize RPC. */
function forcePrimary(patch, actionId = ACTION_A) {
  const primary = db.authentication_delivery_attempts.find(
    (a) => a.attempt_number === 1 && a.auth_action_id === actionId
  );
  Object.assign(primary, patch);
  return primary;
}

// ============================================================================
// PURE DECISION ENGINE (1–18)
// ============================================================================
check("1-3. missing / fallback-disabled / non-operational policy all block", () => {
  assert(decide({ policy: null }).reason === REASON().POLICY_MISSING, "1: missing policy blocks");
  assert(decide({ policy: greenPolicy({ auth_flow: "vendor_password_reset" }) }).reason === REASON().POLICY_FLOW_MISMATCH, "1: wrong-flow policy blocks");
  // 2 — the fallback policy status is 'disabled' (the Phase 5F-A shipped state).
  const d2 = decide({ policy: greenPolicy({ fallback_policy_status: "disabled" }) });
  assert(!d2.allowed && d2.reason === REASON().FALLBACK_POLICY_DISABLED, `2: got ${d2.reason}`);
  // 3 — the operator kill-switch.
  const d3 = decide({ policy: greenPolicy({ is_operationally_enabled: false }) });
  assert(!d3.allowed && d3.reason === REASON().POLICY_DISABLED, `3: got ${d3.reason}`);
  // The mode flags are independent of the status.
  assert(decide({ policy: greenPolicy({ automatic_fallback_enabled: false }) }).reason === REASON().AUTOMATIC_FALLBACK_DISABLED, "automatic flag required");
  assert(decide({ requestMode: MODE().USER_REQUESTED, policy: greenPolicy({ user_requested_fallback_enabled: false }) }).reason === REASON().USER_REQUESTED_FALLBACK_DISABLED, "user-requested flag required");
  assert(decide({ policy: greenPolicy({ hard_failure_only: false }) }).reason === REASON().HARD_FAILURE_ONLY_DISABLED, "hard_failure_only required for automatic");
});

check("4-5. an accepted primary and an unknown outcome both stop the fallback dead", () => {
  const accepted = decide({ primaryAttempt: definitivePrimary({ status: "accepted", outcomeCertainty: "accepted" }) });
  assert(!accepted.allowed && accepted.reason === REASON().PRIMARY_ACCEPTED, `4: got ${accepted.reason}`);
  const unknown = decide({ primaryAttempt: definitivePrimary({ status: "outcome_unknown", outcomeCertainty: "unknown_outcome" }) });
  assert(!unknown.allowed && unknown.reason === REASON().PRIMARY_OUTCOME_UNKNOWN, `5: got ${unknown.reason}`);
  // A certainty that contradicts the recorded status is not definitive either.
  const contradictory = decide({ primaryAttempt: definitivePrimary({ status: "sent" }) });
  assert(!contradictory.allowed && contradictory.reason === REASON().PRIMARY_NOT_DEFINITIVE, "contradictory status blocks");
  const inFlight = decide({ primaryAttempt: definitivePrimary({ status: "dispatching", outcomeCertainty: "unknown_outcome" }) });
  assert(!inFlight.allowed && inFlight.reason === REASON().PRIMARY_OUTCOME_UNKNOWN, "in-flight primary blocks");
});

check("6-9. failure rules are DEFAULT DENY, per mode", () => {
  // 6 — a definitive failure with no rule at all is NOT eligible.
  const d6 = decide({ failureEligibility: NO_RULE });
  assert(!d6.allowed && d6.reason === REASON().FAILURE_NOT_FALLBACK_ELIGIBLE, `6: got ${d6.reason}`);
  // 7 — an inactive rule is a denial, not a fallthrough.
  const inactive = M.Engine.resolveFailureRule([failureRule({ is_active: false })], {
    authFlow: "client_login_otp", primaryChannel: "whatsapp", primaryProviderKey: "mock", failureCode: "META_ERROR_131026",
  });
  assert(!inactive.resolved && inactive.reason === "inactive_rule", "7: inactive rule unresolved");
  assert(!decide({ failureEligibility: inactive }).allowed, "7: inactive rule blocks");
  // 8 — a rule that permits user-requested but not automatic blocks the automatic path.
  const autoOff = { resolved: true, ruleId: "r", scope: "auth_flow", automaticFallbackEligible: false, userRequestedFallbackEligible: true };
  assert(decide({ failureEligibility: autoOff }).reason === REASON().FAILURE_NOT_FALLBACK_ELIGIBLE, "8: automatic blocked");
  assert(decide({ requestMode: MODE().USER_REQUESTED, failureEligibility: autoOff }).allowed === true, "8: user-requested still allowed");
  // 9 — and the mirror image.
  const userOff = { resolved: true, ruleId: "r", scope: "auth_flow", automaticFallbackEligible: true, userRequestedFallbackEligible: false };
  assert(decide({ requestMode: MODE().USER_REQUESTED, failureEligibility: userOff }).reason === REASON().FAILURE_NOT_FALLBACK_ELIGIBLE, "9: user-requested blocked");
  assert(decide({ failureEligibility: userOff }).allowed === true, "9: automatic still allowed");
});

check("10-11. automatic needs automatic_ready; user-requested also accepts manual_only", () => {
  const manual = greenPolicy({ fallback_policy_status: "manual_only" });
  const d10 = decide({ policy: manual });
  assert(!d10.allowed && d10.reason === REASON().FALLBACK_POLICY_DISABLED, `10: got ${d10.reason}`);
  const d11 = decide({ requestMode: MODE().USER_REQUESTED, policy: manual });
  assert(d11.allowed === true && d11.channel === "sms", `11: got ${d11.reason}`);
  // pending_provider permits neither.
  const pending = greenPolicy({ fallback_policy_status: "pending_provider" });
  assert(!decide({ policy: pending }).allowed && !decide({ requestMode: MODE().USER_REQUESTED, policy: pending }).allowed, "pending_provider permits neither");
  assert(decide({ requestMode: MODE().USER_REQUESTED, policy: greenPolicy() }).allowed === true, "automatic_ready permits user-requested too");
});

check("12-13. RCS is never an auth fallback; a fallback needs a declared provider", () => {
  const rcs = decide({ policy: greenPolicy({ fallback_channel: "rcs" }) });
  assert(!rcs.allowed && rcs.reason === REASON().WRONG_FALLBACK_CHANNEL, `12: got ${rcs.reason}`);
  assert(!M.Engine.AUTH_TRANSPORT_CHANNELS_IN_USE.includes("rcs"), "12: rcs is not an auth transport channel");
  const none = decide({ policy: greenPolicy({ fallback_channel: null, fallback_provider_key: null }) });
  assert(!none.allowed && none.reason === REASON().FALLBACK_NOT_DECLARED, `12: undeclared fallback blocks`);
  const noProvider = decide({ policy: greenPolicy({ fallback_provider_key: null }) });
  assert(!noProvider.allowed && noProvider.reason === REASON().FALLBACK_PROVIDER_MISSING, `13: got ${noProvider.reason}`);
  const wrongPrimary = decide({ policy: greenPolicy({ primary_channel: "sms" }) });
  assert(!wrongPrimary.allowed && wrongPrimary.reason === REASON().WRONG_PRIMARY_CHANNEL, "non-whatsapp primary blocks");
});

check("14-15. vendor_whatsapp_verify never falls back — automatic OR user-requested", () => {
  // Even a (hypothetically corrupted) fully-enabled policy with a declared SMS fallback.
  const corrupted = greenPolicy({ auth_flow: "vendor_whatsapp_verify" });
  const primary = definitivePrimary({ authFlow: "vendor_whatsapp_verify" });
  for (const mode of [MODE().AUTOMATIC, MODE().USER_REQUESTED]) {
    const d = decide({ authFlow: "vendor_whatsapp_verify", requestMode: mode, policy: corrupted, primaryAttempt: primary });
    assert(!d.allowed && d.reason === REASON().WHATSAPP_VERIFICATION_FALLBACK_FORBIDDEN, `14/15 (${mode}): got ${d.reason}`);
  }
  // The ban precedes every operator toggle: no flag can reach it.
  assert(M.AuthTransport.WHATSAPP_POSSESSION_FLOW === "vendor_whatsapp_verify", "possession flow identity");
});

check("16. two attempts is the ceiling; a recorded fallback ends the lineage", () => {
  const d = decide({ attemptHistory: HISTORY({ totalAttempts: 2 }) });
  assert(!d.allowed && d.reason === REASON().ATTEMPT_LIMIT_REACHED, `16: got ${d.reason}`);
  const withFallback = decide({ attemptHistory: HISTORY({ hasFallbackAttempt: true }) });
  assert(!withFallback.allowed && withFallback.reason === REASON().ATTEMPT_LIMIT_REACHED, "16: existing fallback blocks");
  assert(M.Engine.MAX_AUTH_TRANSPORT_ATTEMPTS === 2, "16: the ceiling is two");
  // Lineage + reference + destination must all line up.
  assert(decide({ primaryAttempt: definitivePrimary({ attemptNumber: 2 }) }).reason === REASON().ATTEMPT_LINEAGE_INVALID, "attempt 2 cannot anchor a fallback");
  assert(decide({ primaryAttempt: definitivePrimary({ channel: "sms" }) }).reason === REASON().ATTEMPT_LINEAGE_INVALID, "an sms primary cannot anchor a fallback");
  assert(decide({ primaryAttempt: null }).reason === REASON().ATTEMPT_LINEAGE_INVALID, "no primary, no fallback");
  assert(decide({ primaryAttempt: definitivePrimary({ authReferenceId: "other" }) }).reason === REASON().AUTH_REFERENCE_MISMATCH, "auth reference must match");
  assert(decide({ primaryAttempt: definitivePrimary({ destinationHash: HASH_B }) }).reason === REASON().DESTINATION_HASH_MISMATCH, "destination hash must match");
});

check("17-18. a legal, proven, explicitly eligible failure is allowed — in both modes", () => {
  const auto = decide();
  assert(auto.allowed === true && auto.reason === "ALLOWED", `17: got ${auto.reason}`);
  assert(auto.channel === "sms" && auto.attemptNumber === 2 && auto.providerKey === "sms_mock", "17: the allowed plan is one SMS attempt 2");
  const user = decide({ requestMode: MODE().USER_REQUESTED });
  assert(user.allowed === true && user.attemptNumber === 2, `18: got ${user.reason}`);
  // The engine is PURE: no db, no env, no provider, no clock.
  const src = readCode(ENGINE_SRC);
  for (const forbidden of [/adminClient/, /process\.env/, /fetch\(/, /Date\.now/, /new Date\(/, /supabase/i, /\brpc\b/]) {
    assert(!forbidden.test(src), `engine must not use ${forbidden}`);
  }
  assert(!/\botp\b/i.test(src) && !/\bphone\b/i.test(src) && !/msisdn/i.test(src), "engine never sees an OTP or a phone number");
});

// ============================================================================
// FAILURE RULES (43–48)
// ============================================================================
check("43-44. the failure-rule table ships EMPTY and nothing permissive is seeded", () => {
  assert(SQL.failureRuleTable.length > 0, "43: the table exists");
  const inserts = SQL.stripped.match(/insert into public\.authentication_transport_failure_rules/gi) ?? [];
  assert(inserts.length === 0, "43/44: NO failure rule is seeded");
  assert(/automatic_fallback_eligible\s+boolean not null default false/i.test(SQL.failureRuleTable), "44: automatic eligibility defaults false");
  assert(/user_requested_fallback_eligible boolean not null default false/i.test(SQL.failureRuleTable.replace(/\s+/g, " ")), "44: user-requested eligibility defaults false");
  assert(/is_active\s+boolean not null default false/i.test(SQL.failureRuleTable), "44: rules default inactive");
  assert(/chk_auth_failure_rule_whatsapp_verify_never_eligible/.test(SQL.stripped), "vendor_whatsapp_verify can never hold an eligible rule");
});

check("45-48. precedence is deterministic; ambiguity, absence and inactivity all deny", () => {
  const E = M.Engine;
  const crit = { authFlow: "client_login_otp", primaryChannel: "whatsapp", primaryProviderKey: "mock", failureCode: "META_ERROR_131026" };
  // 47 — no rule is a denial.
  assert(E.resolveFailureRule([], crit).resolved === false, "47: no rule → deny");
  assert(E.resolveFailureRule([], crit).reason === "no_rule", "47: reason no_rule");
  // 45 — the exact auth-flow rule beats a provider-wide rule, deterministically.
  const wide = failureRule({ id: "wide", auth_flow: null, automatic_fallback_eligible: true });
  const exact = failureRule({ id: "exact", automatic_fallback_eligible: false, user_requested_fallback_eligible: false });
  const both = E.resolveFailureRule([wide, exact], crit);
  assert(both.resolved && both.ruleId === "exact" && both.scope === "auth_flow", "45: exact rule wins");
  const reversed = E.resolveFailureRule([exact, wide], crit);
  assert(reversed.resolved && reversed.ruleId === "exact", "45: order of rows is irrelevant");
  assert(both.automaticFallbackEligible === false, "45: the specific rule's denial is honoured");
  // A de-activated specific rule denies; it never falls through to a permissive wide rule.
  const deactivated = E.resolveFailureRule([wide, failureRule({ is_active: false })], crit);
  assert(!deactivated.resolved && deactivated.reason === "inactive_rule", "48: inactive specific rule denies, no fallthrough");
  // 46 — two ACTIVE rules in the same tier are ambiguous and fail closed.
  const ambiguous = E.resolveFailureRule([failureRule({ id: "a" }), failureRule({ id: "b" })], crit);
  assert(!ambiguous.resolved && ambiguous.reason === "ambiguous_rules", "46: ambiguity fails closed");
  // 48 — lookup is scoped by provider + failure code + channel.
  assert(E.resolveFailureRule([failureRule({ primary_provider_key: "other" })], crit).reason === "no_rule", "48: wrong provider → no rule");
  assert(E.resolveFailureRule([failureRule({ failure_code: "OTHER_CODE" })], crit).reason === "no_rule", "48: wrong failure code → no rule");
  assert(E.resolveFailureRule([failureRule({ auth_flow: "vendor_password_reset" })], crit).reason === "no_rule", "48: another flow's rule never applies");
  // The provider-wide rule applies only when no specific rule exists at all.
  const wideOnly = E.resolveFailureRule([wide], crit);
  assert(wideOnly.resolved && wideOnly.scope === "provider_wide", "provider-wide rule applies as a fallback tier");
  // The migration's unique indexes make ambiguity impossible at rest.
  const idx = (SQL.uniqueIndexes.authentication_transport_failure_rules ?? []).map((i) => i.name);
  assert(idx.includes("uq_auth_failure_rule_active_flow") && idx.includes("uq_auth_failure_rule_active_provider_wide"), "ambiguity is impossible at rest");
});

check("policy service: default deny end to end (empty rule table, disabled policy)", async () => {
  resetDb();
  db.authentication_transport_policies.push({
    auth_flow: "client_login_otp", primary_channel: "whatsapp", primary_provider_key: "mock",
    fallback_channel: "sms", fallback_provider_key: null, automatic_fallback_enabled: false,
    user_requested_fallback_enabled: false, fallback_policy_status: "disabled",
    hard_failure_only: true, is_operationally_enabled: false,
  });
  const res = await M.PolicySvc.decideAuthenticationFallback({
    authFlow: "client_login_otp", requestMode: "automatic",
    primaryAttempt: definitivePrimary(), attemptHistory: HISTORY(), request: { ...REF },
  });
  assert(res.ok && res.data.allowed === false, "shipped state blocks");
  assert(res.data.reason === REASON().POLICY_DISABLED, `shipped state reason ${res.data.reason}`);
  // No policy row at all → POLICY_MISSING.
  resetDb();
  const none = await M.PolicySvc.decideAuthenticationFallback({
    authFlow: "client_login_otp", requestMode: "automatic",
    primaryAttempt: definitivePrimary(), attemptHistory: HISTORY(), request: { ...REF },
  });
  assert(none.ok && none.data.reason === REASON().POLICY_MISSING, "no policy → POLICY_MISSING");
  // With an enabled policy but an EMPTY rule table the decision is still blocked.
  resetDb();
  db.authentication_transport_policies.push(greenPolicy());
  const empty = await M.PolicySvc.decideAuthenticationFallback({
    authFlow: "client_login_otp", requestMode: "automatic",
    primaryAttempt: definitivePrimary(), attemptHistory: HISTORY(), request: { ...REF },
  });
  assert(empty.ok && empty.data.reason === REASON().FAILURE_NOT_FALLBACK_ELIGIBLE, `empty rule table blocks: ${empty.data.reason}`);
  // Only an explicit ACTIVE eligible rule unlocks it.
  db.authentication_transport_failure_rules.push(failureRule());
  const allowed = await M.PolicySvc.decideAuthenticationFallback({
    authFlow: "client_login_otp", requestMode: "automatic",
    primaryAttempt: definitivePrimary(), attemptHistory: HISTORY(), request: { ...REF },
  });
  assert(allowed.ok && allowed.data.allowed === true, `explicit rule allows: ${allowed.data.reason}`);
  // The policy service never writes and never calls a provider.
  const src = readCode(POLICY_SVC_SRC);
  assert(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(src), "policy service never writes");
  assert(!/sendResolvedTemplate|healthCheck|fetch\(/.test(src), "policy service never calls a provider");
});

// ============================================================================
// ATTEMPT LEDGER (19–36)
// ============================================================================
check("19-21. primary claim: attempt 1, idempotent replay, and one row under a race", async () => {
  resetDb();
  const first = await claimPrimary();
  assert(first.ok && first.data.outcome === "CLAIMED", `19: got ${first.data?.outcome}`);
  assert(first.data.attemptNumber === 1 && first.data.channel === "whatsapp", "19: attempt 1 on whatsapp");
  assert(first.data.fallbackFromAttemptId === null, "19: the primary has no ancestor");

  // 20 — a duplicate claim is refused SAFELY (idempotent), never a second row.
  const again = await claimPrimary();
  assert(again.ok && again.data.outcome === "ALREADY_EXISTS", `20: got ${again.data.outcome}`);
  assert(again.data.attemptId === first.data.attemptId, "20: the same attempt is returned");
  assert(db.authentication_delivery_attempts.length === 1, "20: still one row");
  // A different destination under the same reference is a lineage error, not idempotency.
  const drifted = await claimPrimary({ destinationHash: HASH_B });
  assert(drifted.data.outcome === "LINEAGE_MISMATCH", `20: got ${drifted.data.outcome}`);
  assert(db.authentication_delivery_attempts.length === 1, "20: no row written");

  // 21 — two genuinely concurrent primary claims produce exactly one attempt.
  resetDb();
  const results = await Promise.all([claimPrimary(), claimPrimary(), claimPrimary()]);
  const outcomes = results.map((r) => r.data.outcome).sort();
  assert(db.authentication_delivery_attempts.length === 1, `21: exactly one attempt, got ${db.authentication_delivery_attempts.length}`);
  assert(outcomes.filter((o) => o === "CLAIMED").length === 1, `21: exactly one CLAIMED, got ${outcomes}`);
  assert(outcomes.every((o) => o === "CLAIMED" || o === "ALREADY_EXISTS"), `21: no database error under a race, got ${outcomes}`);
  assert(SQL.guards.claim.serializes, "21: the RPC serializes on the auth reference");
});

check("22-25. a fallback needs a PROVEN definitive failure on its own primary", async () => {
  // 22 — no primary at all.
  resetDb();
  const orphan = await claimFallback();
  assert(orphan.data.outcome === "PRIMARY_REQUIRED", `22: got ${orphan.data.outcome}`);
  assert(db.authentication_delivery_attempts.length === 0, "22: nothing written");

  // 23 — a primary still in flight (requested / unknown_outcome).
  resetDb();
  await claimPrimary();
  const inFlight = await claimFallback();
  assert(inFlight.data.outcome === "UNKNOWN_OUTCOME_BLOCKED", `23/25: got ${inFlight.data.outcome}`);

  // 24 — an accepted primary can never spawn a fallback.
  resetDb();
  await claimPrimary();
  forcePrimary({ status: "accepted", outcome_certainty: "accepted" });
  const accepted = await claimFallback();
  assert(accepted.data.outcome === "ACCEPTED_PRIMARY_BLOCKED", `24: got ${accepted.data.outcome}`);
  assert(db.authentication_delivery_attempts.length === 1, "24: nothing written");

  // 25 — a parked unknown outcome can never spawn a fallback.
  resetDb();
  await claimPrimary();
  forcePrimary({ status: "outcome_unknown", outcome_certainty: "unknown_outcome" });
  const unknown = await claimFallback();
  assert(unknown.data.outcome === "UNKNOWN_OUTCOME_BLOCKED", `25: got ${unknown.data.outcome}`);
  assert(db.authentication_delivery_attempts.length === 1, "25: nothing written");

  // A definitive certainty with a non-terminal status is not definitive enough.
  resetDb();
  await claimPrimary();
  const p = forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" });
  p.status = "dispatching"; // contradictory, force-written past the CHECK
  const contradictory = await claimFallback();
  assert(contradictory.data.outcome === "PRIMARY_NOT_DEFINITIVE", `got ${contradictory.data.outcome}`);
});

check("26-30. the fallback attempt: number 2, sms, linked, exactly once, never a third", async () => {
  resetDb();
  const primary = await claimPrimary();
  forcePrimary({ status: "failed", outcome_certainty: "definitive_failure", failure_code: "META_ERROR_131026" });
  const fb = await claimFallback();
  assert(fb.data.outcome === "CLAIMED", `26: got ${fb.data.outcome}`);
  assert(fb.data.attemptNumber === 2, "26: attempt_number is 2");
  assert(fb.data.channel === "sms", "27: the fallback channel is sms");
  assert(fb.data.fallbackFromAttemptId === primary.data.attemptId, "28: lineage points at attempt 1");
  assert(db.authentication_delivery_attempts.length === 2, "26: two attempts");

  // 30 — a third attempt is refused before anything is read or written.
  const third = await claimFallback();
  assert(third.data.outcome === "ATTEMPT_LIMIT_REACHED", `30: got ${third.data.outcome}`);
  const explicitThird = await M.AttemptSvc.claimPrimaryAttempt({
    authFlow: "client_login_otp", authActionId: ACTION_A, authReferenceType: "auth_user",
    authReferenceId: "user-1", destinationHash: HASH_A, providerKey: "mock",
  });
  assert(explicitThird.data.outcome === "ATTEMPT_LIMIT_REACHED", `30: got ${explicitThird.data.outcome}`);
  assert(db.authentication_delivery_attempts.length === 2, "30: still two attempts");
  // The RPC refuses an out-of-range attempt number outright.
  const raw = await M.Supabase.adminClient().rpc(CLAIM_FN, {
    p_auth_flow: "client_login_otp", p_auth_action_id: clientAction("hook-Z"), p_auth_reference_type: "auth_user",
    p_auth_reference_id: "user-9", p_destination_hash: HASH_A, p_attempt_number: 3,
    p_channel: "sms", p_provider_key: "sms_mock",
  });
  assert(raw.data[0].outcome === "attempt_limit_reached", `30: attempt 3 refused, got ${raw.data[0].outcome}`);
  assert(SQL.attemptChecks.maxTwo, "30: the database CHECK caps attempt_number at two");

  // 29 — two genuinely concurrent fallback claims create exactly ONE attempt.
  resetDb();
  await claimPrimary();
  forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" });
  const race = await Promise.all([claimFallback(), claimFallback()]);
  const outcomes = race.map((r) => r.data.outcome).sort();
  assert(db.authentication_delivery_attempts.filter((a) => a.attempt_number === 2).length === 1, `29: one fallback, got ${db.authentication_delivery_attempts.length} rows`);
  assert(outcomes.join(",") === "ATTEMPT_LIMIT_REACHED,CLAIMED", `29: got ${outcomes}`);
});

check("31-34. lineage: destination hash, auth reference, auth flow, and the possession flow", async () => {
  // 31 — the fallback must target the SAME destination hash the primary used.
  resetDb();
  await claimPrimary();
  forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" });
  const wrongHash = await claimFallback({ destinationHash: HASH_B });
  assert(wrongHash.data.outcome === "LINEAGE_MISMATCH" && wrongHash.data.detail === "destination_hash_mismatch", `31: got ${wrongHash.data.outcome}/${wrongHash.data.detail}`);
  assert(db.authentication_delivery_attempts.length === 1, "31: nothing written");

  // 32 — the fallback must carry the SAME auth reference as its primary.
  const wrongRef = await claimFallback({ authReferenceId: "user-2" });
  assert(wrongRef.data.outcome === "LINEAGE_MISMATCH" && wrongRef.data.detail === "auth_reference_mismatch", `32: got ${wrongRef.data.outcome}/${wrongRef.data.detail}`);
  const wrongRefType = await claimFallback({ authReferenceType: "verification_challenge" });
  assert(wrongRefType.data.outcome === "LINEAGE_MISMATCH" && wrongRefType.data.detail === "auth_reference_mismatch", `32: got ${wrongRefType.data.detail}`);
  // …and an unknown ACTION has no primary of its own.
  const unknownAction = await claimFallback({ authActionId: clientAction("hook-UNKNOWN") });
  assert(unknownAction.data.outcome === "PRIMARY_REQUIRED", `32: got ${unknownAction.data.outcome}`);

  // 33 — the fallback must carry the SAME auth flow as its primary.
  const wrongFlow = await claimFallback({ authFlow: "vendor_password_reset" });
  assert(wrongFlow.data.outcome === "LINEAGE_MISMATCH" && wrongFlow.data.detail === "auth_flow_mismatch", `33: got ${wrongFlow.data.outcome}/${wrongFlow.data.detail}`);
  assert(db.authentication_delivery_attempts.length === 1, "33: nothing written");

  // 34 — vendor_whatsapp_verify can never reach attempt 2.
  resetDb();
  const verifyAction = { authFlow: "vendor_whatsapp_verify", authActionId: VERIFY_CHAL_1, authReferenceType: "verification_challenge", authReferenceId: "chal-1" };
  await claimPrimary(verifyAction);
  forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" }, VERIFY_CHAL_1);
  const forbidden = await claimFallback(verifyAction);
  assert(forbidden.data.outcome === "WHATSAPP_VERIFY_FALLBACK_FORBIDDEN", `34: got ${forbidden.data.outcome}`);
  assert(db.authentication_delivery_attempts.length === 1, "34: nothing written");
  assert(SQL.attemptChecks.whatsappVerifyNoFallback, "34: a database CHECK makes attempt 2 impossible for this flow");
  // Even a direct insert is refused by the CHECK.
  let blocked = false;
  try {
    insertRow("authentication_delivery_attempts", {
      auth_flow: "vendor_whatsapp_verify", auth_action_id: challengeAction("vendor_whatsapp_verify", "chal-2"),
      auth_reference_type: "verification_challenge", auth_reference_id: "chal-2",
      destination_hash: HASH_A, attempt_number: 2, channel: "sms", provider_key: "sms_mock",
      fallback_from_attempt_id: crypto.randomUUID(), status: "requested", outcome_certainty: "unknown_outcome",
    });
  } catch (e) { blocked = e.constraint === "chk_auth_attempt_whatsapp_verify_no_fallback"; }
  assert(blocked, "34: the CHECK refuses a hand-written attempt 2");
});

check("35-36. no OTP and no plaintext destination exist anywhere in this foundation", async () => {
  const forbiddenSecret = /p_otp|\botp\b|one_time_password|passcode/i;
  const forbiddenPlaintext = /\bphone\b|phone_e164|msisdn|\be164\b|\bdestination\s+text\b|plaintext/i;
  // 35 — the migration DECLARATIONS: no OTP column, no OTP RPC argument.
  assert(!forbiddenSecret.test(SQL.ddl), "35: no OTP column or argument is declared");
  assert(!forbiddenSecret.test(SQL.claimSignature), "35: the claim RPC takes no OTP");
  assert(!forbiddenSecret.test(SQL.finalizeSignature), "35: the finalize RPC takes no OTP");
  // 36 — no plaintext destination column or argument.
  assert(!forbiddenPlaintext.test(SQL.failureRuleTable), "36: no plaintext phone on the failure-rule table");
  assert(!forbiddenPlaintext.test(SQL.claimSignature), "36: the claim RPC takes no plaintext phone");
  assert(!forbiddenPlaintext.test(SQL.finalizeSignature), "36: the finalize RPC takes no plaintext phone");
  assert(/p_destination_hash\s+text/.test(SQL.claimSignature), "36: destinations travel as a hash");
  // The added ledger columns are additive and sanitized.
  assert(/add column if not exists failure_code\s+text/.test(SQL.stripped), "failure_code added");
  assert(/add column if not exists decision_reason text/.test(SQL.stripped), "decision_reason added");
  assert(/add column if not exists completed_at\s+timestamptz/.test(SQL.stripped), "completed_at added");
  assert(SQL.attemptChecks.sanitizedCodes, "codes are identifier-shaped, so no raw payload fits");
  // And the services: no OTP, no plaintext phone parameter.
  for (const f of [ENGINE_SRC, POLICY_SVC_SRC, ATTEMPT_SVC_SRC]) {
    const code = readCode(f);
    assert(!forbiddenSecret.test(code), `35: ${f} never handles an OTP`);
    assert(!/\bphone\b|msisdn|phoneE164/i.test(code), `36: ${f} never handles a plaintext phone`);
  }
  // Nor a provider credential.
  assert(!/access_token|app_secret|api_key|credential/i.test(SQL.ddl), "no provider credential is declared");
  assert(!forbiddenPlaintext.test(SQL.ddl), "36: no plaintext destination column is declared");
  // A raw provider payload cannot be stored.
  let rejected = false;
  try {
    resetDb();
    insertRow("authentication_delivery_attempts", {
      auth_flow: "client_login_otp", auth_action_id: ACTION_A,
      auth_reference_type: "auth_user", auth_reference_id: "u",
      destination_hash: HASH_A, attempt_number: 1, channel: "whatsapp", provider_key: "mock",
      fallback_from_attempt_id: null, status: "requested", outcome_certainty: "unknown_outcome",
      failure_code: '{"error":{"message":"+15550001111 unreachable"}}',
    });
  } catch (e) { rejected = e.constraint === "chk_auth_attempt_sanitized_codes"; }
  assert(rejected, "36: a raw provider payload cannot be written to failure_code");
  assert(SQL.attemptChecks.actionIdNotNull, "auth_action_id is mandatory");
});

// ============================================================================
// ACTION IDENTITY DERIVATION (H1–H14)
// ============================================================================
const ACTION_ID_SRC = "lib/communication/authenticationActionIdentity.ts";

check("H1-8. the action identity is a pure, domain-separated SHA-256 of the server action", () => {
  const A = M.ActionId;
  // 1 — deterministic.
  assert(clientAction("hook-A") === clientAction("hook-A"), "1: same input, same identity");
  assert(clientAction("hook-A") === ACTION_A, "1: stable across calls");
  // 2 — different authoritative ids never collide.
  assert(clientAction("hook-A") !== clientAction("hook-B"), "2: different webhook ids differ");
  // 3 — DOMAIN SEPARATION on auth_flow.
  const asLogin = derive("client_login_otp", "verification_challenge", "chal-1");
  const asVerify = derive("vendor_whatsapp_verify", "verification_challenge", "chal-1");
  const asReset = derive("vendor_password_reset", "verification_challenge", "chal-1");
  assert(asLogin !== asVerify && asVerify !== asReset && asLogin !== asReset, "3: auth_flow is part of the digest");
  // 4 — DOMAIN SEPARATION on source kind.
  assert(derive("client_login_otp", "supabase_webhook", "x") !== derive("client_login_otp", "verification_challenge", "x"), "4: source kind is part of the digest");
  // …and no concatenation ambiguity can forge a collision (NUL separators, and a source
  // id may contain no control character).
  for (const hostile of ["a\u0000b", "a\nb", "a b", " "]) {
    let rejected = false;
    try { derive("client_login_otp", "supabase_webhook", hostile); } catch { rejected = true; }
    assert(rejected, `a separator/control character in the source id is refused (${JSON.stringify(hostile)})`);
  }
  assert(A.AUTH_ACTION_ID_DOMAIN === "qf-auth-action:v1", "the domain tag is versioned");
  // 5 — exactly 64 lowercase hex characters.
  for (const id of [ACTION_A, ACTION_B, VERIFY_CHAL_1, RESET_CHAL_1]) {
    assert(SHA256_HEX.test(id) && id.length === 64, `5: ${id.slice(0, 10)}… is 64 lowercase hex`);
  }
  assert(A.AUTH_ACTION_ID_PATTERN.source === "^[0-9a-f]{64}$", "5: the exported pattern is sha256 hex");
  assert(A.isAuthenticationActionId(ACTION_A) === true, "5: the guard accepts a real identity");
  // 6/7/8 — PURE: no env, no clock, no randomness, no key.
  const src = readCode(ACTION_ID_SRC);
  for (const forbidden of [/process\.env/, /Date\.now/, /new Date\(/, /performance\.now/, /Math\.random/, /randomBytes/, /randomUUID/, /randomFill/, /createHmac/, /adminClient/, /fetch\(/]) {
    assert(!forbidden.test(src), `6/7/8: the helper must not use ${forbidden}`);
  }
  assert(/createHash\("sha256"\)|createHash\(AUTH_ACTION_ID_ALGORITHM\)/.test(src), "sha256 is the digest");
  assert(/digest\("hex"\)/.test(src), "lowercase hex output");
  // The helper never touches an OTP, a phone, or a destination.
  assert(!/\botp\b/i.test(src) && !/\bphone\b/i.test(src) && !/destination_hash|destinationHash/.test(src), "the helper never sees an OTP, phone, or destination");
});

check("H9-14. client-login and vendor action identities are independent and stable", () => {
  // 9/11 — one auth user, two verified webhook actions, two distinct identities.
  assert(ACTION_A !== ACTION_B, "9: hook-A and hook-B derive distinct identities");
  const many = ["hook-C", "hook-D", "hook-E", "hook-F"].map((h) => clientAction(h));
  assert(new Set([ACTION_A, ACTION_B, ...many]).size === 6, "11: six independent login actions, six identities");
  // 10 — a replay of the SAME verified webhook derives the SAME identity (idempotency).
  assert(clientAction("hook-A") === ACTION_A, "10: hook-A replay is the same action");
  // 12 — a vendor challenge derives a stable identity.
  assert(challengeAction("vendor_whatsapp_verify", "chal-1") === VERIFY_CHAL_1, "12: stable challenge identity");
  // 13 — the SAME challenge id under two flows derives DIFFERENT identities.
  assert(VERIFY_CHAL_1 !== RESET_CHAL_1, "13: verify and reset never share an action identity");
  // 14 — separate challenges are separate actions.
  assert(challengeAction("vendor_password_reset", "chal-2") !== RESET_CHAL_1, "14: distinct challenges, distinct actions");
  // The convenience derivations agree with the general one.
  assert(M.ActionId.deriveClientLoginActionId("hook-A") === ACTION_A, "client convenience derivation");
  assert(M.ActionId.deriveVendorWhatsAppVerifyActionId("chal-1") === VERIFY_CHAL_1, "vendor verify convenience derivation");
  assert(M.ActionId.deriveVendorPasswordResetActionId("chal-1") === RESET_CHAL_1, "vendor reset convenience derivation");
  // A closed source vocabulary; anything else cannot derive an identity.
  assert(M.ActionId.KNOWN_AUTH_ACTION_SOURCE_KINDS.length === 2, "closed source vocabulary");
  let unknownRejected = false;
  try { derive("client_login_otp", "browser_supplied", "x"); } catch { unknownRejected = true; }
  assert(unknownRejected, "an unknown source kind cannot derive an identity");
  let unknownFlow = false;
  try { derive("admin_login", "supabase_webhook", "x"); } catch { unknownFlow = true; }
  assert(unknownFlow, "an unknown auth flow cannot derive an identity");
});

check("H15-22. raw OTPs, phone numbers and raw source ids are refused at every layer", async () => {
  // These are exactly the values the OLD `^[A-Za-z0-9_.:-]{1,128}$` shape accepted.
  const RAW = [
    ["483920", "a six-digit one-time code"],
    ["123456", "another one-time code"],
    ["919876543210", "a digit-only MSISDN"],
    ["9876543210", "a national number"],
    ["+919876543210", "an E.164 number"],
    ["hook-A", "a RAW webhook id (not yet derived)"],
    ["chal-1", "a RAW challenge id (not yet derived)"],
    ["0".repeat(63), "63-char hex"],
    ["0".repeat(65), "65-char hex"],
    [ACTION_A.toUpperCase(), "uppercase sha256 hex"],
    ["g".repeat(64), "64 non-hex characters"],
    ['{"otp":"483920"}', "a raw payload"],
  ];
  // 33/34 — the database CHECK is exactly lowercase 64-hex, not the old broad pattern.
  assert(SQL.attemptChecks.actionIdIsSha256, "33: the CHECK is ^[0-9a-f]{64}$");
  assert(!/\[A-Za-z0-9_\.:-\]\{1,128\}/.test(SQL.stripped), "34: the broad pattern no longer governs auth_action_id");
  assert(SQL.attemptChecks.actionIdPattern.source === "^[0-9a-f]{64}$", "33: the model enforces the parsed CHECK");

  for (const [value, label] of RAW) {
    // 15-22 (service): the attempt service fails closed BEFORE the database.
    resetDb();
    resetRpcCalls();
    const svc = await claimPrimary({ authActionId: value });
    assert(svc.data.outcome === "INVALID_REQUEST" && svc.data.detail === "invalid_auth_action_id", `service refuses ${label}, got ${svc.data.outcome}`);
    assert(rpcCallCount === 0, `the service refuses ${label} WITHOUT touching the database`);
    assert(db.authentication_delivery_attempts.length === 0, `service wrote nothing for ${label}`);

    // 15-22 (RPC): a caller that bypasses the service is refused before any mutation.
    const rpc = await M.Supabase.adminClient().rpc(CLAIM_FN, {
      p_auth_flow: "client_login_otp", p_auth_action_id: value, p_auth_reference_type: "auth_user",
      p_auth_reference_id: "user-1", p_destination_hash: HASH_A, p_attempt_number: 1,
      p_channel: "whatsapp", p_provider_key: "mock",
    });
    assert(rpc.data[0].outcome === "invalid_request" && rpc.data[0].detail === "invalid_auth_action_id", `rpc refuses ${label}, got ${rpc.data[0].detail}`);
    assert(db.authentication_delivery_attempts.length === 0, `rpc wrote nothing for ${label}`);

    // 15-22 (CHECK): even a hand-written insert cannot store it.
    let refused = false;
    try {
      insertRow("authentication_delivery_attempts", {
        auth_flow: "client_login_otp", auth_action_id: value,
        auth_reference_type: "auth_user", auth_reference_id: "user-1",
        destination_hash: HASH_A, attempt_number: 1, channel: "whatsapp", provider_key: "mock",
        fallback_from_attempt_id: null, status: "requested", outcome_certainty: "unknown_outcome",
      });
    } catch (e) { refused = e.constraint === "chk_auth_attempt_action_id_shape"; }
    assert(refused, `the CHECK refuses ${label}`);
  }
  // …and a real derived identity is accepted at all three layers.
  resetDb();
  assert((await claimPrimary({ authActionId: ACTION_A })).data.outcome === "CLAIMED", "a derived identity is accepted");
});

check("H23-27. no raw authority, no OTP, and no destination is ever persisted", () => {
  const forbiddenColumns = [
    /raw_webhook_id/i, /webhook_id/i, /raw_action/i, /source_action_id/i, /authoritative_action_id/i,
    /challenge_action_id/i, /action_source_id/i, /\botp\b/i, /one_time_password/i, /passcode/i,
    /\bphone\b/i, /phone_e164/i, /msisdn/i, /\be164\b/i, /\bdestination\s+text\b/i, /payload/i,
  ];
  // 23/24 — the ledger declares no column for the raw authoritative identifier.
  const attemptColumns = SQL.ddl.match(/add column if not exists\s+(\w+)/gi) ?? [];
  assert(attemptColumns.length === 4, `four columns added, got ${attemptColumns.length}`);
  for (const re of forbiddenColumns) {
    assert(!re.test(SQL.ddl), `23-27: the migration declares nothing matching ${re}`);
    assert(!re.test(SQL.claimSignature), `25/26: the claim RPC takes no ${re}`);
    assert(!re.test(SQL.finalizeSignature), `25/26: the finalize RPC takes no ${re}`);
  }
  // The RPC's action parameter is the derived digest, and it is the only action input.
  assert(/p_auth_action_id\s+text/.test(SQL.claimSignature), "the RPC takes the derived action identity");
  assert((SQL.claimSignature.match(/action/gi) ?? []).length === 1, "…and nothing else action-shaped");
  // 27 — destinations still travel only as a hash.
  assert(/p_destination_hash\s+text/.test(SQL.claimSignature), "27: destinations travel as a hash");
  // The service never accepts a raw source identifier either.
  const svc = readCode(ATTEMPT_SVC_SRC);
  assert(!/authoritativeActionId|rawWebhookId|webhookId/.test(svc), "the service never takes a raw source id");
  assert(/isAuthenticationActionId\(input\.authActionId\)/.test(svc), "9: the service validates the identity at runtime");
  assert(/AuthenticationActionId/.test(svc), "the branded type is required at compile time");
});

// ============================================================================
// ACTION GROUPING (G1–G12) — attempts belong to ONE auth action, not to a user
// ============================================================================
const actionAttempts = (id) => db.authentication_delivery_attempts.filter((a) => a.auth_action_id === id);

check("G1-3,G11. one auth user, many login actions: each action owns its own attempt 1", async () => {
  resetDb();
  // G1 — user-1 performs login action A.
  const a = await claimPrimary({ authActionId: ACTION_A });
  assert(a.data.outcome === "CLAIMED" && a.data.attemptNumber === 1, `G1: got ${a.data.outcome}`);
  // G2/G11 — the SAME user later performs login action B. It is NOT blocked.
  const b = await claimPrimary({ authActionId: ACTION_B });
  assert(b.data.outcome === "CLAIMED" && b.data.attemptNumber === 1, `G2: got ${b.data.outcome}/${b.data.detail}`);
  assert(b.data.attemptId !== a.data.attemptId, "G2: a distinct attempt row");
  assert(db.authentication_delivery_attempts.length === 2, "G11: two independent attempt 1 rows for one auth user");
  assert(actionAttempts(ACTION_A).length === 1 && actionAttempts(ACTION_B).length === 1, "G11: one attempt per action");
  // G3 — replaying action A is idempotent, not a new attempt.
  const replay = await claimPrimary({ authActionId: ACTION_A });
  assert(replay.data.outcome === "ALREADY_EXISTS" && replay.data.attemptId === a.data.attemptId, `G3: got ${replay.data.outcome}`);
  assert(db.authentication_delivery_attempts.length === 2, "G3: no third row");
  // G8 — a long history of actions for one user stays legal.
  for (const webhookId of ["hook-C", "hook-D", "hook-E"]) {
    const action = clientAction(webhookId);
    const r = await claimPrimary({ authActionId: action });
    assert(r.data.outcome === "CLAIMED", `G8: action ${webhookId} rejected (${r.data.detail})`);
  }
  assert(db.authentication_delivery_attempts.length === 5, "G8: five independent login actions");
});

check("G4-6. an action id may never be reused under a different identity", async () => {
  resetDb();
  await claimPrimary({ authActionId: ACTION_A });
  // G4 — same action, different destination hash.
  const hash = await claimPrimary({ authActionId: ACTION_A, destinationHash: HASH_B });
  assert(hash.data.outcome === "LINEAGE_MISMATCH" && hash.data.detail === "action_identity_conflict", `G4: got ${hash.data.outcome}/${hash.data.detail}`);
  // G5 — same action, different auth reference.
  const ref = await claimPrimary({ authActionId: ACTION_A, authReferenceId: "user-2" });
  assert(ref.data.outcome === "LINEAGE_MISMATCH" && ref.data.detail === "action_identity_conflict", `G5: got ${ref.data.detail}`);
  const refType = await claimPrimary({ authActionId: ACTION_A, authReferenceType: "verification_challenge" });
  assert(refType.data.outcome === "LINEAGE_MISMATCH", `G5: got ${refType.data.outcome}`);
  // G6 — same action, different auth flow.
  const flow = await claimPrimary({ authActionId: ACTION_A, authFlow: "vendor_password_reset" });
  assert(flow.data.outcome === "LINEAGE_MISMATCH" && flow.data.detail === "action_identity_conflict", `G6: got ${flow.data.detail}`);
  assert(db.authentication_delivery_attempts.length === 1, "G4-6: nothing written");
});

check("G7,G9,G10,G12. the two-attempt budget is per action, and never crosses actions", async () => {
  resetDb();
  // Action A: primary fails definitively, then falls back.
  await claimPrimary({ authActionId: ACTION_A });
  forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" }, ACTION_A);
  const fbA = await claimFallback({ authActionId: ACTION_A });
  assert(fbA.data.outcome === "CLAIMED" && fbA.data.attemptNumber === 2, `G12: action A fallback, got ${fbA.data.outcome}`);

  // G9/G10 — action A is now exhausted; a third attempt on it is impossible.
  assert((await claimFallback({ authActionId: ACTION_A })).data.outcome === "ATTEMPT_LIMIT_REACHED", "G10: action A cannot claim attempt 3");

  // G12 — the SAME user's action B is untouched: its own attempt 1 and attempt 2.
  const pB = await claimPrimary({ authActionId: ACTION_B });
  assert(pB.data.outcome === "CLAIMED" && pB.data.attemptNumber === 1, `G9: action B attempt 1, got ${pB.data.detail}`);
  forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" }, ACTION_B);
  const fbB = await claimFallback({ authActionId: ACTION_B });
  assert(fbB.data.outcome === "CLAIMED" && fbB.data.attemptNumber === 2, `G12: action B fallback, got ${fbB.data.detail}`);
  assert(fbB.data.fallbackFromAttemptId === pB.data.attemptId, "G12: action B's fallback links to action B's primary");
  assert(fbA.data.fallbackFromAttemptId !== pB.data.attemptId, "G12: lineages never cross");
  assert(db.authentication_delivery_attempts.length === 4, "G9: two full sequences for one auth user");

  // G7 — action B can never fall back from action A's primary, and vice versa.
  resetDb();
  await claimPrimary({ authActionId: ACTION_A });
  forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" }, ACTION_A);
  const cross = await claimFallback({ authActionId: ACTION_B });
  assert(cross.data.outcome === "PRIMARY_REQUIRED", `G7: cross-action fallback refused, got ${cross.data.outcome}`);
  assert(db.authentication_delivery_attempts.length === 1, "G7: nothing written");
  assert(SQL.guards.claim.fallbackLookupByAction, "G7: the fallback's primary lookup keys on the ACTION id");
  assert(SQL.guards.claim.checksFallbackAuthAction, "G7: and the action id is re-verified explicitly");

  // The pure engine agrees: a primary from another action never anchors this one.
  const crossDecision = decide({ primaryAttempt: definitivePrimary({ authActionId: ACTION_B }) });
  assert(!crossDecision.allowed && crossDecision.reason === REASON().AUTH_ACTION_MISMATCH, `G7: engine reason ${crossDecision.reason}`);
});

check("G-history. the evaluator refuses an attempt history that is not action-scoped", () => {
  // Handing the evaluator a history aggregated across every login this user ever made
  // must fail closed, not silently exhaust the budget (or silently permit a fallback).
  const crossScoped = decide({ attemptHistory: HISTORY({ authActionId: ACTION_B }) });
  assert(!crossScoped.allowed && crossScoped.reason === REASON().ATTEMPT_HISTORY_SCOPE_INVALID, `got ${crossScoped.reason}`);
  // A correctly scoped history with one attempt allows the fallback.
  assert(decide({ attemptHistory: HISTORY({ authActionId: ACTION_A, totalAttempts: 1 }) }).allowed === true, "action-scoped history allows");
  // And two attempts within THIS action exhaust it.
  assert(decide({ attemptHistory: HISTORY({ totalAttempts: 2 }) }).reason === REASON().ATTEMPT_LIMIT_REACHED, "per-action ceiling");
  assert(M.Engine.MAX_AUTH_TRANSPORT_ATTEMPTS === 2, "the ceiling is two, per action");
});

// ============================================================================
// ACTION CONCURRENCY (G13–G17)
// ============================================================================
check("G13-17. locks are action-scoped: same action serializes, different actions do not", async () => {
  // G13 — three concurrent primary claims for ONE action produce exactly one attempt.
  resetDb();
  let results = await Promise.all([ACTION_A, ACTION_A, ACTION_A].map((id) => claimPrimary({ authActionId: id })));
  let outcomes = results.map((r) => r.data.outcome).sort();
  assert(actionAttempts(ACTION_A).length === 1, `G13: one attempt, got ${actionAttempts(ACTION_A).length}`);
  assert(outcomes.filter((o) => o === "CLAIMED").length === 1, `G13: exactly one CLAIMED, got ${outcomes}`);
  assert(outcomes.every((o) => o === "CLAIMED" || o === "ALREADY_EXISTS"), `G13: no database error, got ${outcomes}`);

  // G14 — concurrent primary claims for DIFFERENT actions of the same user never collide.
  resetDb();
  const actions = ["hook-1", "hook-2", "hook-3", "hook-4"].map((h) => clientAction(h));
  results = await Promise.all(actions.map((id) => claimPrimary({ authActionId: id })));
  assert(results.every((r) => r.data.outcome === "CLAIMED"), `G14: all claimed, got ${results.map((r) => r.data.outcome)}`);
  assert(db.authentication_delivery_attempts.length === 4, "G14: four independent attempt 1 rows");

  // G15 — two concurrent fallback claims for one action produce exactly one fallback.
  resetDb();
  await claimPrimary({ authActionId: ACTION_A });
  forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" }, ACTION_A);
  results = await Promise.all([claimFallback({ authActionId: ACTION_A }), claimFallback({ authActionId: ACTION_A })]);
  outcomes = results.map((r) => r.data.outcome).sort();
  assert(actionAttempts(ACTION_A).filter((a) => a.attempt_number === 2).length === 1, "G15: exactly one fallback");
  assert(outcomes.join(",") === "ATTEMPT_LIMIT_REACHED,CLAIMED", `G15: got ${outcomes}`);

  // G16/G17 — the lock identity is the ACTION HASH ALONE. `auth_flow` is deliberately
  // absent: it is already inside the domain-separated digest, and including it would give
  // two same-hash/different-flow callers two different locks.
  assert(SQL.guards.claim.serializes, "G16: a transaction-scoped advisory lock exists");
  assert(SQL.guards.claim.locksOnAction, `G16/G17: the lock key is the action hash alone, got ${SQL.guards.claim.lockExpression}`);
  assert(/pg_advisory_xact_lock/.test(SQL.claimBody), "G16: transaction-scoped, not session-scoped");
  assert(!/pg_advisory_xact_lock\(hashtextextended\(p_auth_reference_type/.test(SQL.claimBody), "G17: the lock is never keyed on the long-lived reference");
  assert(/for update/.test(SQL.claimBody), "row locking is preserved");
  assert(SQL.guards.claim.countsByAction, "the attempt budget is counted per action hash");
});

// ============================================================================
// GLOBAL SAME-HASH CONCURRENCY (C1–C20)
// ============================================================================
// The RPC treats the action hash as a GLOBAL identity: reusing one hash under a different
// flow / reference / destination is `action_identity_conflict`. The advisory lock and both
// unique indexes must agree with that, or two same-hash callers could each insert a
// primary and silently break the invariant the RPC claims to enforce.
//
// These tests deliberately CLAIM ONE HASH UNDER A DIFFERENT FLOW. That combination can
// only arise from misuse or replay — a correctly derived action hash already carries its
// flow inside the digest — so it must fail atomically, never race.
const rowsFor = (id) => db.authentication_delivery_attempts.filter((a) => a.auth_action_id === id);

check("C1-C5. same action hash always serializes, whatever flow/reference/destination is claimed", async () => {
  const noDbError = (outcomes) => assert(!outcomes.includes("DATABASE_ERROR"), `5: a database error is never the concurrency control result, got ${outcomes}`);

  // 1 — same hash + same flow: exactly one CLAIMED, the rest idempotent.
  resetDb();
  let results = await Promise.all([1, 2, 3].map(() => claimPrimary({ authActionId: ACTION_A })));
  let outcomes = results.map((r) => r.data.outcome).sort();
  assert(rowsFor(ACTION_A).length === 1, `1: exactly one row, got ${rowsFor(ACTION_A).length}`);
  assert(outcomes.filter((o) => o === "CLAIMED").length === 1, `1: exactly one CLAIMED, got ${outcomes}`);
  assert(outcomes.filter((o) => o === "ALREADY_EXISTS").length === 2, `1: the losers are idempotent, got ${outcomes}`);
  noDbError(outcomes);

  // 2 — same hash + DIFFERENT flow, concurrently. One wins; the other fails closed.
  resetDb();
  results = await Promise.all([
    claimPrimary({ authActionId: ACTION_A, authFlow: "client_login_otp" }),
    claimPrimary({ authActionId: ACTION_A, authFlow: "vendor_password_reset", authReferenceType: "verification_challenge", authReferenceId: "chal-1" }),
  ]);
  outcomes = results.map((r) => r.data.outcome).sort();
  assert(db.authentication_delivery_attempts.length === 1, `2: exactly ONE physical primary row, got ${db.authentication_delivery_attempts.length}`);
  assert(outcomes.join(",") === "CLAIMED,LINEAGE_MISMATCH", `2: got ${outcomes}`);
  const conflict = results.find((r) => r.data.outcome === "LINEAGE_MISMATCH");
  assert(conflict.data.detail === "action_identity_conflict", `2: got ${conflict.data.detail}`);
  noDbError(outcomes);

  // 3 — same hash + different auth reference, concurrently.
  resetDb();
  results = await Promise.all([
    claimPrimary({ authActionId: ACTION_A, authReferenceId: "user-1" }),
    claimPrimary({ authActionId: ACTION_A, authReferenceId: "user-2" }),
  ]);
  outcomes = results.map((r) => r.data.outcome).sort();
  assert(db.authentication_delivery_attempts.length === 1, `3: exactly one physical row, got ${db.authentication_delivery_attempts.length}`);
  assert(outcomes.join(",") === "CLAIMED,LINEAGE_MISMATCH", `3: got ${outcomes}`);
  noDbError(outcomes);

  // 4 — same hash + different destination hash, concurrently.
  resetDb();
  results = await Promise.all([
    claimPrimary({ authActionId: ACTION_A, destinationHash: HASH_A }),
    claimPrimary({ authActionId: ACTION_A, destinationHash: HASH_B }),
  ]);
  outcomes = results.map((r) => r.data.outcome).sort();
  assert(db.authentication_delivery_attempts.length === 1, `4: exactly one physical row, got ${db.authentication_delivery_attempts.length}`);
  assert(outcomes.join(",") === "CLAIMED,LINEAGE_MISMATCH", `4: got ${outcomes}`);
  noDbError(outcomes);

  // …and sequentially, the conflict is the same fail-closed result.
  resetDb();
  await claimPrimary({ authActionId: ACTION_A });
  const seq = await claimPrimary({ authActionId: ACTION_A, authFlow: "vendor_password_reset", authReferenceType: "verification_challenge", authReferenceId: "chal-1" });
  assert(seq.data.outcome === "LINEAGE_MISMATCH" && seq.data.detail === "action_identity_conflict", `sequential conflict: got ${seq.data.detail}`);
  assert(db.authentication_delivery_attempts.length === 1, "sequential conflict writes nothing");
});

check("C6-C9. attempt uniqueness and single-fallback uniqueness are GLOBAL to the action hash", () => {
  const idx = SQL.uniqueIndexes.authentication_delivery_attempts ?? [];
  // 6/7 — the attempt-number authority is (auth_action_id, attempt_number).
  const attemptIdx = idx.find((i) => i.name === "uq_auth_delivery_attempt_action_number");
  assert(attemptIdx, "6: uq_auth_delivery_attempt_action_number exists");
  assert(attemptIdx.cols.join(",") === "auth_action_id,attempt_number", `6: got ${attemptIdx.cols}`);
  assert(!attemptIdx.cols.includes("auth_flow"), "7: it does not include auth_flow");
  // 8/9 — the single-fallback authority is (auth_action_id) where attempt_number = 2.
  const fallbackIdx = idx.find((i) => i.name === "uq_auth_delivery_attempt_single_fallback");
  assert(fallbackIdx, "8: uq_auth_delivery_attempt_single_fallback exists");
  assert(fallbackIdx.cols.join(",") === "auth_action_id", `8: got ${fallbackIdx.cols}`);
  assert(!fallbackIdx.cols.includes("auth_flow"), "9: it does not include auth_flow");
  assert(/where attempt_number = 2/.test(SQL.stripped), "8: it is partial on attempt_number = 2");
  // The database itself refuses two primaries for one hash, whatever flow they claim.
  resetDb();
  const seed = (flow) => insertRow("authentication_delivery_attempts", {
    auth_flow: flow, auth_action_id: ACTION_A, auth_reference_type: "auth_user", auth_reference_id: "u",
    destination_hash: HASH_A, attempt_number: 1, channel: "whatsapp", provider_key: "mock",
    fallback_from_attempt_id: null, status: "requested", outcome_certainty: "unknown_outcome",
  });
  seed("client_login_otp");
  let refused = false;
  try { seed("vendor_password_reset"); } catch (e) { refused = e.constraint === "uq_auth_delivery_attempt_action_number"; }
  assert(refused, "6/7: the index refuses a second primary for one action hash under another flow");
  assert(db.authentication_delivery_attempts.length === 1, "…and no second row survives");
});

check("C10-C13. the advisory lock is namespaced by the action hash alone", () => {
  const g = SQL.guards.claim;
  assert(g.serializes, "an advisory lock exists");
  // 10 — the key contains the action hash.
  assert(g.lockIncludesActionId, `10: the lock key contains p_auth_action_id, got ${g.lockExpression}`);
  // 11 — and NOT the auth flow.
  assert(!g.lockIncludesAuthFlow, `11: the lock key must not contain p_auth_flow, got ${g.lockExpression}`);
  // 12 — and NOT the long-lived reference (nor any other stand-in identity).
  assert(!g.lockIncludesReference, `12: the lock key must not contain the auth reference, got ${g.lockExpression}`);
  for (const forbidden of ["p_auth_user_id", "p_challenge_id", "p_destination_hash"]) {
    assert(!g.lockExpression.includes(forbidden), `12: the lock key must not contain ${forbidden}`);
  }
  assert(/^'qf-auth-action:' \|\| p_auth_action_id$/.test(g.lockExpression), `the lock key is domain-tagged, got ${g.lockExpression}`);
  // 13 — distinct legitimate actions never share a lock key, so nothing legitimate merges.
  const keyOf = (flow, action) => evaluateLockKey(g.lockExpression, { p_auth_flow: flow, p_auth_action_id: action });
  assert(keyOf("client_login_otp", ACTION_A) !== keyOf("client_login_otp", ACTION_B), "13: two login actions take different locks");
  assert(keyOf("vendor_whatsapp_verify", VERIFY_CHAL_1) !== keyOf("vendor_password_reset", RESET_CHAL_1), "13: verify and reset of one challenge take different locks");
  // …and the SAME hash claimed under two flows takes the SAME lock — that is the point.
  assert(keyOf("client_login_otp", ACTION_A) === keyOf("vendor_password_reset", ACTION_A), "13: one hash, one lock, whatever flow is claimed");
});

check("C14-C20. domain separation, replay, repeated logins and fallback lineage all survive", async () => {
  // 14 — one challenge id under two flows still derives two different action hashes.
  assert(VERIFY_CHAL_1 !== RESET_CHAL_1, "14: verify and reset never share an action hash");
  assert(challengeAction("vendor_whatsapp_verify", "chal-9") !== challengeAction("vendor_password_reset", "chal-9"), "14: holds for any challenge");
  // 15 — one authoritative id under two source kinds still differs.
  assert(derive("client_login_otp", "supabase_webhook", "x") !== derive("client_login_otp", "verification_challenge", "x"), "15: source kind still separates");
  // 16 — repeated client logins remain independent.
  resetDb();
  assert((await claimPrimary({ authActionId: ACTION_A })).data.outcome === "CLAIMED", "16: action A");
  assert((await claimPrimary({ authActionId: ACTION_B })).data.outcome === "CLAIMED", "16: action B");
  assert(db.authentication_delivery_attempts.length === 2, "16: two independent primaries for one auth user");
  // 17 — replaying one verified action is still idempotent.
  const replay = await claimPrimary({ authActionId: ACTION_A });
  assert(replay.data.outcome === "ALREADY_EXISTS", `17: got ${replay.data.outcome}`);
  assert(db.authentication_delivery_attempts.length === 2, "17: no new row");

  // 18 — at most ONE attempt 2 per action hash, globally.
  resetDb();
  await claimPrimary({ authActionId: ACTION_A });
  forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" }, ACTION_A);
  assert((await claimFallback({ authActionId: ACTION_A })).data.outcome === "CLAIMED", "18: first fallback");
  assert((await claimFallback({ authActionId: ACTION_A })).data.outcome === "ATTEMPT_LIMIT_REACHED", "18: second fallback refused");
  assert(rowsFor(ACTION_A).filter((a) => a.attempt_number === 2).length === 1, "18: exactly one attempt 2");
  // …enforced at the database too, even for a hand-written row claiming another flow.
  let refused = false;
  try {
    insertRow("authentication_delivery_attempts", {
      auth_flow: "vendor_password_reset", auth_action_id: ACTION_A,
      auth_reference_type: "verification_challenge", auth_reference_id: "chal-1",
      destination_hash: HASH_A, attempt_number: 2, channel: "sms", provider_key: "sms_mock",
      fallback_from_attempt_id: crypto.randomUUID(), status: "requested", outcome_certainty: "unknown_outcome",
    });
  } catch (e) { refused = ["uq_auth_delivery_attempt_action_number", "uq_auth_delivery_attempt_single_fallback"].includes(e.constraint); }
  assert(refused, "18: the database refuses a second attempt 2 for one action hash");

  // 19 — cross-action fallback remains impossible.
  resetDb();
  await claimPrimary({ authActionId: ACTION_A });
  forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" }, ACTION_A);
  const cross = await claimFallback({ authActionId: ACTION_B });
  assert(cross.data.outcome === "PRIMARY_REQUIRED", `19: got ${cross.data.outcome}`);
  assert(db.authentication_delivery_attempts.length === 1, "19: nothing written");

  // 20 — vendor_whatsapp_verify still cannot claim attempt 2.
  resetDb();
  const verify = { authFlow: "vendor_whatsapp_verify", authActionId: VERIFY_CHAL_1, authReferenceType: "verification_challenge", authReferenceId: "chal-1" };
  await claimPrimary(verify);
  forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" }, VERIFY_CHAL_1);
  assert((await claimFallback(verify)).data.outcome === "WHATSAPP_VERIFY_FALLBACK_FORBIDDEN", "20: still forbidden");
  assert(db.authentication_delivery_attempts.length === 1, "20: nothing written");

  // The RPC still validates auth_flow lineage explicitly on both paths.
  assert(SQL.guards.claim.primaryLineage, "auth_flow lineage is still checked on the primary probe");
  assert(SQL.guards.claim.checksFallbackAuthFlow, "auth_flow lineage is still checked on the fallback");
  assert(SQL.guards.claim.checksFallbackAuthAction && SQL.guards.claim.checksFallbackReference && SQL.guards.claim.checksFallbackDestination, "every fallback lineage field is still checked");
});

// ============================================================================
// INDEX SAFETY (G18–G22)
// ============================================================================
check("G18-22. the uniqueness authority moved from the reference to the action, safely", () => {
  const idx = SQL.uniqueIndexes.authentication_delivery_attempts ?? [];
  const names = idx.map((i) => i.name);
  // G18 — the Phase 5F-A reference-scoped authority is retired.
  assert(SQL.droppedIndexes.has("uq_auth_delivery_attempt_number"), "G18: the old index is dropped");
  assert(!names.includes("uq_auth_delivery_attempt_number"), "G18: it no longer governs the model");
  // G19 — the new authority is scoped to the action hash ALONE (globally).
  const action = idx.find((i) => i.name === "uq_auth_delivery_attempt_action_number");
  assert(action, "G19: uq_auth_delivery_attempt_action_number exists");
  assert(action.cols.join(",") === "auth_action_id,attempt_number", `G19: got ${action.cols}`);
  // The single-fallback guarantee is action-scoped too, and equally global.
  const single = idx.find((i) => i.name === "uq_auth_delivery_attempt_single_fallback");
  assert(single && single.cols.join(",") === "auth_action_id", `G19: single-fallback index is action-scoped, got ${single?.cols}`);
  // …and lineage still permits exactly one fallback per primary.
  assert(names.includes("uq_auth_delivery_attempt_fallback_lineage"), "one fallback per primary");
  // G20 — the migration validates the OLD index definition before replacing it.
  assert(/pg_get_indexdef/.test(SQL.stripped), "G20: the old index definition is read");
  assert(/refusing to replace it/.test(SQL.stripped) && /has drifted from its Phase 5F-A definition/.test(SQL.stripped), "G20: drift fails loud");
  assert(/refusing to replace an unknown uniqueness authority/.test(SQL.stripped), "G20: a missing index fails loud");
  const validateAt = SQL.stripped.indexOf("pg_get_indexdef");
  const dropAt = SQL.stripped.indexOf("drop index if exists public.uq_auth_delivery_attempt_number;");
  assert(validateAt > 0 && dropAt > validateAt, "G20: validation precedes the drop");
  // G21 — existing rows are never given a fabricated action id.
  assert(/refusing to fabricate one/.test(SQL.stripped), "G21: a null auth_action_id fails loud");
  for (const source of ["auth_reference_id", "destination_hash", "communication_message_id", "auth_user_id", "challenge_id"]) {
    assert(!new RegExp(`set auth_action_id\\s*=\\s*${source}`, "i").test(SQL.stripped), `G21: auth_action_id is never derived from ${source}`);
  }
  assert(!/update public\.authentication_delivery_attempts\s+set auth_action_id/i.test(SQL.stripped), "G21: no backfill is invented");
  assert(!/set auth_action_id/i.test(SQL.stripped), "G21: nothing writes auth_action_id outside the claim RPC");
  const orphanAt = SQL.stripped.indexOf("refusing to fabricate one");
  const notNullAt = SQL.stripped.indexOf("alter column auth_action_id set not null");
  assert(orphanAt > 0 && notNullAt > orphanAt, "G21: the orphan check precedes the NOT NULL");
  // G22 — no historical row is deleted.
  assert(!/delete from public\.authentication_delivery_attempts/i.test(SQL.stripped), "G22: no row deletion");
  assert(!/truncate/i.test(SQL.stripped), "G22: no truncate");
  assert(!/drop table/i.test(SQL.stripped), "G22: no table drop");
  // The lineage columns are preserved, not replaced.
  assert(!/drop column/i.test(SQL.stripped), "auth_reference_type/id are preserved for lineage validation");
});

// ============================================================================
// FINALIZATION (37–42)
// ============================================================================
async function freshPrimary() {
  resetDb();
  const r = await claimPrimary();
  return r.data.attemptId;
}

check("37-39. finalization maps each provider outcome to its own certainty", async () => {
  const F = M.AttemptSvc.AuthAttemptFinalizeOutcome;
  // 37 — accepted.
  let id = await freshPrimary();
  let res = await M.AttemptSvc.finalizeAttempt({ attemptId: id, status: "accepted", outcomeCertainty: "accepted" });
  assert(res.ok && res.data.outcome === F.FINALIZED, `37: got ${res.data.outcome}`);
  assert(res.data.status === "accepted" && res.data.outcomeCertainty === "accepted", "37: accepted certainty");
  // 38 — definitive failure.
  id = await freshPrimary();
  res = await M.AttemptSvc.finalizeAttempt({ attemptId: id, status: "failed", outcomeCertainty: "definitive_failure", failureCode: "META_ERROR_131026", failureClassification: "provider_rejected" });
  assert(res.ok && res.data.outcome === F.FINALIZED && res.data.status === "failed", `38: got ${res.data.outcome}`);
  assert(res.data.outcomeCertainty === "definitive_failure", "38: definitive_failure certainty");
  // 39 — an unknown outcome is parked, never recorded as an ordinary failure.
  id = await freshPrimary();
  res = await M.AttemptSvc.finalizeAttempt({ attemptId: id, status: "outcome_unknown", outcomeCertainty: "unknown_outcome" });
  assert(res.ok && res.data.outcome === F.FINALIZED, `39: got ${res.data.outcome}`);
  assert(res.data.status === "outcome_unknown" && res.data.outcomeCertainty === "unknown_outcome", "39: parked, not failed");
  assert(SQL.attemptChecks.statusVocabularyHasUnknown, "39: the status vocabulary carries outcome_unknown");
  const row = db.authentication_delivery_attempts[0];
  assert(row.completed_at, "39: completion is timestamped");
  assert(!row.failed_at, "39: an unknown outcome is not a failure");
});

check("40-42. contradictions and terminal states are refused, at both layers", async () => {
  const F = M.AttemptSvc.AuthAttemptFinalizeOutcome;
  // 40 — the service refuses a contradictory pair before any database call.
  let id = await freshPrimary();
  let res = await M.AttemptSvc.finalizeAttempt({ attemptId: id, status: "accepted", outcomeCertainty: "definitive_failure" });
  assert(res.ok && res.data.outcome === F.CONTRADICTORY_STATE, `40: service refuses, got ${res.data.outcome}`);
  assert(db.authentication_delivery_attempts[0].status === "requested", "40: nothing written");
  // …and the RPC refuses it independently, even when called directly.
  for (const [status, certainty] of [["accepted", "definitive_failure"], ["failed", "accepted"], ["outcome_unknown", "definitive_failure"], ["failed", "unknown_outcome"], ["delivered", "unknown_outcome"]]) {
    const raw = await M.Supabase.adminClient().rpc(FINALIZE_FN, { p_attempt_id: id, p_status: status, p_outcome_certainty: certainty });
    assert(raw.data[0].outcome === "contradictory_state", `40: rpc refuses ${status}+${certainty}, got ${raw.data[0].outcome}`);
  }
  assert(SQL.attemptChecks.statusCertainty, "40: a database CHECK forbids a contradictory row at rest");

  // 41 — a terminal accepted attempt never regresses to failed.
  id = await freshPrimary();
  await M.AttemptSvc.finalizeAttempt({ attemptId: id, status: "accepted", outcomeCertainty: "accepted" });
  res = await M.AttemptSvc.finalizeAttempt({ attemptId: id, status: "failed", outcomeCertainty: "definitive_failure" });
  assert(res.data.outcome === F.TERMINAL_ACCEPTED, `41: got ${res.data.outcome}`);
  assert(db.authentication_delivery_attempts[0].status === "accepted", "41: the row is unchanged");
  // A forward acceptance step is still allowed.
  res = await M.AttemptSvc.finalizeAttempt({ attemptId: id, status: "delivered", outcomeCertainty: "accepted" });
  assert(res.data.outcome === F.FINALIZED, "41: accepted → delivered is a legal forward step");

  // 42 — an unknown outcome cannot be rewritten to manufacture fallback eligibility.
  id = await freshPrimary();
  await M.AttemptSvc.finalizeAttempt({ attemptId: id, status: "outcome_unknown", outcomeCertainty: "unknown_outcome" });
  res = await M.AttemptSvc.finalizeAttempt({ attemptId: id, status: "failed", outcomeCertainty: "definitive_failure" });
  assert(res.data.outcome === F.TERMINAL_OUTCOME_UNKNOWN, `42: got ${res.data.outcome}`);
  assert(db.authentication_delivery_attempts[0].outcome_certainty === "unknown_outcome", "42: the row is unchanged");
  // …and the fallback stays blocked.
  const fb = await claimFallback();
  assert(fb.data.outcome === "UNKNOWN_OUTCOME_BLOCKED", `42: fallback still blocked, got ${fb.data.outcome}`);
  // Nor into an acceptance.
  res = await M.AttemptSvc.finalizeAttempt({ attemptId: id, status: "accepted", outcomeCertainty: "accepted" });
  assert(res.data.outcome === F.TERMINAL_OUTCOME_UNKNOWN, "42: unknown is not rewritable at all");
  // A proven failure never becomes an acceptance either.
  id = await freshPrimary();
  await M.AttemptSvc.finalizeAttempt({ attemptId: id, status: "failed", outcomeCertainty: "definitive_failure" });
  res = await M.AttemptSvc.finalizeAttempt({ attemptId: id, status: "accepted", outcomeCertainty: "accepted" });
  assert(res.data.outcome === F.TERMINAL_DEFINITIVE_FAILURE, `42: got ${res.data.outcome}`);
});

// ============================================================================
// SECURITY (49–57)
// ============================================================================
check("49-53. RLS on, zero browser policies, least-privilege table grants", () => {
  assert(/alter table public\.authentication_transport_failure_rules enable row level security;/.test(SQL.stripped), "49: RLS enabled");
  const policies = SQL.stripped.match(/create policy/gi) ?? [];
  assert(policies.length === 0, "50: zero policies");
  const g = SQL.failureRuleGrants;
  assert(g.revoked.has("anon") && g.revoked.has("authenticated") && g.revoked.has("service_role"), "51/52: revoke precedes grant for every role");
  assert(!g.granted.anon, "51: anon has no grants");
  assert(!g.granted.authenticated, "52: authenticated has no grants");
  const svc = g.granted.service_role ?? [];
  assert(svc.includes("select") && svc.includes("insert") && svc.includes("update"), "53: service_role gets select/insert/update");
  assert(!svc.includes("delete") && !svc.includes("truncate") && !svc.includes("all"), "53: no delete/truncate/all");
  // Defence in depth on the attempt ledger.
  assert(SQL.attemptGrants.revoked.has("anon") && SQL.attemptGrants.revoked.has("authenticated"), "the attempt ledger is revoked from the browser roles");
  assert(!SQL.attemptGrants.granted.anon && !SQL.attemptGrants.granted.authenticated, "no browser grant on the attempt ledger");
  // No trigger, no activation function.
  assert(!/create trigger/i.test(SQL.stripped), "no trigger");
});

check("54-57. the RPCs are executable ONLY by service_role", () => {
  for (const [name, grants] of [[CLAIM_FN, SQL.claimGrants], [FINALIZE_FN, SQL.finalizeGrants]]) {
    assert(grants.revoked.has("public"), `54: ${name} revoked from public`);
    assert(grants.revoked.has("anon"), `55: ${name} revoked from anon`);
    assert(grants.revoked.has("authenticated"), `56: ${name} revoked from authenticated`);
    assert(grants.granted.has("service_role"), `57: ${name} granted to service_role`);
    assert(grants.granted.size === 1, `57: ${name} granted to service_role ONLY, got ${[...grants.granted]}`);
  }
  // SECURITY DEFINER functions must pin a safe search_path.
  const definers = SQL.stripped.match(/security definer/gi) ?? [];
  const paths = SQL.stripped.match(/set search_path = public, pg_temp/gi) ?? [];
  assert(definers.length === 2 && paths.length === 2, "both definer functions pin a fixed search_path");
});

// ============================================================================
// NO ACTIVATION (58–64)
// ============================================================================
check("58-61. no existing authentication policy is created, changed, or enabled", () => {
  for (const verb of ["insert into", "update", "delete from"]) {
    const re = new RegExp(`${verb}\\s+public\\.authentication_transport_policies`, "i");
    assert(!re.test(SQL.stripped), `58: the migration never runs "${verb}" on authentication_transport_policies`);
  }
  assert(!/alter table public\.authentication_transport_policies/i.test(SQL.stripped), "58: the policy table is not altered");
  assert(!/automatic_fallback_enabled\s*=\s*true/i.test(SQL.stripped), "59: automatic fallback is never enabled");
  assert(!/user_requested_fallback_enabled\s*=\s*true/i.test(SQL.stripped), "60: user-requested fallback is never enabled");
  assert(!/is_operationally_enabled\s*=\s*true/i.test(SQL.stripped), "61: no policy is operationally enabled");
  assert(!/fallback_policy_status\s*=\s*'(manual_only|automatic_ready)'/i.test(SQL.stripped), "61: no fallback policy status is advanced");

  // The Phase 5F-A seed itself still ships everything off.
  assert(SQL.policySeed.length === 3, "58: three seeded policies");
  for (const row of SQL.policySeed) {
    assert(row.automatic_fallback_enabled === false, `59: ${row.auth_flow} automatic fallback off`);
    assert(row.user_requested_fallback_enabled === false, `60: ${row.auth_flow} user-requested fallback off`);
    assert(row.fallback_policy_status === "disabled", `61: ${row.auth_flow} fallback status disabled`);
    assert(row.is_operationally_enabled === false, `61: ${row.auth_flow} not operationally enabled`);
  }
  const verify = SQL.policySeed.find((r) => r.auth_flow === "vendor_whatsapp_verify");
  assert(verify.fallback_channel === null, "vendor_whatsapp_verify still declares no fallback");
});

check("62-64. no SMS account, no SMS mapping, no Meta activation change, no SMS vendor", () => {
  assert(!/insert into public\.communication_provider_accounts/i.test(SQL.stripped), "62: no SMS provider account seeded");
  assert(!/insert into public\.communication_provider_template_mappings/i.test(SQL.stripped), "63: no template mapping seeded");
  assert(!/insert into public\.communication_provider_canary_destinations/i.test(SQL.stripped), "64: no canary destination seeded");
  for (const verb of ["insert into", "update", "delete from", "alter table"]) {
    assert(!new RegExp(`${verb}\\s+public\\.communication_provider_runtime_policies`, "i").test(SQL.stripped), `64: no "${verb}" on the Meta runtime policy`);
  }
  // No SMS vendor is chosen anywhere in this phase.
  const allSrc = [SQL.stripped, readCode(ENGINE_SRC), readCode(POLICY_SVC_SRC), readCode(ATTEMPT_SVC_SRC)].join("\n");
  for (const vendor of [/twilio/i, /msg91/i, /exotel/i, /aws[_ -]?sns/i, /plivo/i, /kaleyra/i, /gupshup/i, /vonage/i, /nexmo/i]) {
    assert(!vendor.test(allSrc), `no SMS vendor is chosen (${vendor})`);
  }
  // No SMS HTTP/webhook/dispatch code is introduced.
  assert(!/fetch\(|AbortController|https:\/\//.test(readCode(ATTEMPT_SVC_SRC)), "no SMS HTTP code");
  assert(!/n8n/i.test(allSrc) && !/jarvis/i.test(allSrc), "no n8n, no Jarvis");
  assert(!/\brcs\b/i.test(readCode(ENGINE_SRC).replace(/RCS is never an auth channel/g, "")), "no RCS auth path");
});

check("G27-32. the action identity is documented, server-derived, and never browser-supplied", () => {
  const doc = readFileSync(DOC_5FC, "utf8");
  const attemptSvc = readFileSync(ATTEMPT_SVC_SRC, "utf8");
  // 27 — the action id must come from the authoritative integration context.
  for (const topic of [/auth_action_id/i, /authoritative/i, /never browser-supplied/i, /SHA-?256/i, /domain-separated/i, /qf-auth-action:v1/]) {
    assert(topic.test(doc), `27: the documentation covers ${topic}`);
  }
  assert(/not\W{0,4}an OTP hash/i.test(doc) && /not\W{0,4}an authentication proof/i.test(doc), "27: the doc states what the digest is NOT");
  assert(/never browser-supplied|Never browser-supplied/i.test(attemptSvc), "27: the service contract says so too");
  assert(/signature-\*\*verified\*\*|signature-verified/i.test(doc), "27: the webhook id must come from the verified hook context");
  // 28/29 — the client login model: verified webhook id is the ACTION, the auth user is the REFERENCE.
  assert(/verified\W{0,6}Supabase Standard Webhooks/i.test(doc) && /webhook-id/i.test(doc), "28: the verified webhook id is the client auth action identity");
  const clientRow = doc.split("\n").find((l) => l.startsWith("| `client_login_otp` |"));
  assert(clientRow, "28/29: the client-login row exists in the identity table");
  assert(/`supabase_webhook`/.test(clientRow) && /webhook-id/.test(clientRow), "28: the action source is the verified webhook id");
  assert(/`auth_user`/.test(clientRow) && /the Supabase Auth user id/.test(clientRow), "29: the auth user id remains the reference identity");
  assert(/never stored/i.test(doc), "the raw authoritative identifier is never stored");
  assert(/auth_reference_id/.test(doc) && /auth_action_id/.test(doc), "29: both identities are named");
  assert(/webhook/i.test(attemptSvc) && /verification_challenges\.id/.test(attemptSvc), "28/31: both derivations are stated in the service contract");
  // 30 — repeated login actions for one auth user are demonstrably supported.
  assert(/many OTP logins|many login actions|repeated login/i.test(doc), "30: repeated logins are documented as supported");
  // 31 — each server-created challenge is its own authentication action.
  assert(/verification_challenges\.id/.test(doc), "31: a challenge id is the vendor auth action identity");
  assert(/server-created/i.test(doc), "31: it is server-created");
  // 32 — vendor_whatsapp_verify still cannot claim attempt 2.
  assert(SQL.attemptChecks.whatsappVerifyNoFallback && SQL.guards.claim.refusesWhatsappVerifyFallback, "32: still forbidden at both layers");
  assert(!decide({ authFlow: "vendor_whatsapp_verify", policy: greenPolicy({ auth_flow: "vendor_whatsapp_verify" }), primaryAttempt: definitivePrimary({ authFlow: "vendor_whatsapp_verify" }) }).allowed, "32: the engine still refuses");
  // The service separates the two identities explicitly.
  assert(/authActionId/.test(attemptSvc) && /authReferenceType/.test(attemptSvc) && /authReferenceId/.test(attemptSvc), "the contract separates action from reference");
  assert(!/\bp_otp\b|\botp\b/i.test(readCode(ATTEMPT_SVC_SRC)), "no OTP parameter");
});

check("wiring. test:phase5f:c script, migration, and documentation exist", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(pkg.scripts["test:phase5f:c"] === "node scripts/phase5f-c-auth-transport-resilience-harness.mjs", "test:phase5f:c wired");
  for (const f of [MIGRATION_5FC, ENGINE_SRC, POLICY_SVC_SRC, ATTEMPT_SVC_SRC, DOC_5FC]) {
    assert(existsSync(f), `${f} exists`);
  }
  const doc = readFileSync(DOC_5FC, "utf8");
  for (const topic of [
    /one OTP authority/i, /request memory/i, /two transport attempts/i, /WhatsApp primary/i,
    /default[- ]deny/i, /automatic/i, /user[- ]requested/i, /vendor_whatsapp_verify/i,
    /no RCS/i, /n8n/i, /lineage/i, /activation checklist/i, /emergency disable/i,
  ]) {
    assert(topic.test(doc), `the documentation covers ${topic}`);
  }
  assert(!/SMS is live|SMS fallback is enabled|SMS is active/i.test(doc), "the documentation never claims SMS is live");
  assert(/not applied|NOT applied/.test(doc), "the documentation states the migration is unapplied");
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutationChecks = [];
function tsMutation(name, edits, scenario) {
  mutationChecks.push({ name, kind: "ts", edits: edits.map(([file, from, to]) => ({ file, from, to })), scenario });
}
function sqlMutation(name, edits, scenario) {
  mutationChecks.push({ name, kind: "sql", edits: edits.map(([file, from, to]) => ({ file, from, to })), scenario });
}
const readF = (f) => readFileSync(f, "utf8");
const NO_ACTIVATION_MARKER = "-- QF_NO_ACTIVATION_MARKER";

// ---- decision engine ------------------------------------------------------
tsMutation("MUT A: the engine allows a fallback after an unknown outcome",
  [[ENGINE_SRC,
    "  if (primaryAttempt.outcomeCertainty === AuthOutcomeCertainty.UNKNOWN_OUTCOME) {\n    return blocked(AuthFallbackBlockReason.PRIMARY_OUTCOME_UNKNOWN);\n  }",
    ""]],
  (mm) => {
    const d = decide({ primaryAttempt: definitivePrimary({ status: "outcome_unknown", outcomeCertainty: "unknown_outcome" }) }, mm);
    // The parked state is no longer distinguishable from "not definitive": the ledger
    // loses the one reason code that says "an OTP may already have arrived".
    return d.reason !== mm.Engine.AuthFallbackBlockReason.PRIMARY_OUTCOME_UNKNOWN;
  });

tsMutation("MUT B: the engine allows a fallback after an accepted primary",
  [[ENGINE_SRC,
    "  if (primaryAttempt.outcomeCertainty === AuthOutcomeCertainty.ACCEPTED) {\n    return blocked(AuthFallbackBlockReason.PRIMARY_ACCEPTED);\n  }",
    ""]],
  (mm) => {
    const d = decide({ primaryAttempt: definitivePrimary({ status: "accepted", outcomeCertainty: "accepted" }) }, mm);
    return d.reason !== mm.Engine.AuthFallbackBlockReason.PRIMARY_ACCEPTED;
  });

tsMutation("MUT C: every definitive failure is treated as fallback-eligible",
  [[ENGINE_SRC,
    "  const eligibility = input.failureEligibility;\n  if (!eligibility.resolved) return blocked(AuthFallbackBlockReason.FAILURE_NOT_FALLBACK_ELIGIBLE);",
    "  const eligibility = input.failureEligibility;\n  if (!eligibility.resolved) return { allowed: true, reason: AUTH_FALLBACK_ALLOWED, channel: AUTH_FALLBACK_CHANNEL, providerKey: policy.fallback_provider_key, attemptNumber: FALLBACK_ATTEMPT_NUMBER };"]],
  (mm) => decide({ failureEligibility: NO_RULE }, mm).allowed === true);

tsMutation("MUT D: the policy service bypasses the failure-rule lookup",
  [[POLICY_SVC_SRC,
    "    const failureEligibility = await resolveFailureEligibility({\n      authFlow: input.authFlow,\n      primaryProviderKey: policy.primary_provider_key,\n      failureCode: input.primaryAttempt?.failureCode ?? null,\n    });",
    "    const failureEligibility = { resolved: true as const, ruleId: null, scope: \"auth_flow\" as const, automaticFallbackEligible: true, userRequestedFallbackEligible: true };"]],
  async (mm) => {
    stubDb(mm); resetDb();
    db.authentication_transport_policies.push(greenPolicy()); // NO failure rule exists
    const res = await mm.PolicySvc.decideAuthenticationFallback({
      authFlow: "client_login_otp", requestMode: "automatic",
      primaryAttempt: definitivePrimary(), attemptHistory: HISTORY(), request: { ...REF },
    });
    return res.ok && res.data.allowed === true; // an empty rule table authorized a fallback
  });

tsMutation("MUT E: the engine allows a vendor_whatsapp_verify SMS fallback",
  [[ENGINE_SRC,
    "  if (authFlow === WHATSAPP_POSSESSION_FLOW || policy.auth_flow === WHATSAPP_POSSESSION_FLOW) {\n    return blocked(AuthFallbackBlockReason.WHATSAPP_VERIFICATION_FALLBACK_FORBIDDEN);\n  }",
    ""]],
  (mm) => {
    const d = decide({
      authFlow: "vendor_whatsapp_verify",
      policy: greenPolicy({ auth_flow: "vendor_whatsapp_verify" }),
      primaryAttempt: definitivePrimary({ authFlow: "vendor_whatsapp_verify" }),
    }, mm);
    return d.allowed === true; // SMS possession was accepted as WhatsApp possession
  });

// ---- attempt claim RPC ----------------------------------------------------
sqlMutation("MUT A-rpc: the claim RPC allows a fallback after an unknown outcome",
  [[MIGRATION_5FC,
    "  if v_primary.outcome_certainty = 'unknown_outcome' then\n    return query select 'unknown_outcome_blocked'::text, 'primary_outcome_unknown'::text, null::uuid, null::integer, null::text, null::uuid;\n    return;\n  end if;",
    ""]],
  async () => {
    resetDb(); await claimPrimary();
    forcePrimary({ status: "outcome_unknown", outcome_certainty: "unknown_outcome" });
    const r = await claimFallback();
    return r.data.outcome !== "UNKNOWN_OUTCOME_BLOCKED";
  });

sqlMutation("MUT B-rpc: the claim RPC allows a fallback after an accepted primary",
  [[MIGRATION_5FC,
    "  if v_primary.outcome_certainty = 'accepted' then\n    return query select 'accepted_primary_blocked'::text, 'primary_accepted'::text, null::uuid, null::integer, null::text, null::uuid;\n    return;\n  end if;",
    ""]],
  async () => {
    resetDb(); await claimPrimary();
    forcePrimary({ status: "accepted", outcome_certainty: "accepted" });
    const r = await claimFallback();
    return r.data.outcome !== "ACCEPTED_PRIMARY_BLOCKED";
  });

sqlMutation("MUT E-rpc: the claim RPC allows a vendor_whatsapp_verify attempt 2",
  [[MIGRATION_5FC,
    "  if p_attempt_number = 2 and p_auth_flow = 'vendor_whatsapp_verify' then\n    return query select 'whatsapp_verify_fallback_forbidden'::text, 'possession_flow'::text, null::uuid, null::integer, null::text, null::uuid;\n    return;\n  end if;",
    ""]],
  async () => {
    resetDb();
    await claimPrimary({ authFlow: "vendor_whatsapp_verify", authReferenceType: "verification_challenge", authReferenceId: "chal-1" });
    forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" });
    const r = await claimFallback({ authFlow: "vendor_whatsapp_verify", authReferenceType: "verification_challenge", authReferenceId: "chal-1" });
    return r.data.outcome !== "WHATSAPP_VERIFY_FALLBACK_FORBIDDEN";
  });

sqlMutation("MUT F: the claim RPC accepts an out-of-range attempt number",
  [[MIGRATION_5FC,
    "  if p_attempt_number is null or p_attempt_number not in (1, 2) then\n    return query select 'attempt_limit_reached'::text, 'attempt_number_out_of_range'::text, null::uuid, null::integer, null::text, null::uuid;\n    return;\n  end if;",
    ""]],
  async () => {
    resetDb(); await claimPrimary();
    forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" });
    // A caller asking for attempt 3 must be refused, not quietly given attempt 2.
    const raw = await M.Supabase.adminClient().rpc(CLAIM_FN, {
      p_auth_flow: "client_login_otp", p_auth_reference_type: "auth_user", p_auth_reference_id: "user-1",
      p_destination_hash: HASH_A, p_attempt_number: 3, p_channel: "sms", p_provider_key: "sms_mock",
    });
    return raw.data?.[0]?.outcome !== "attempt_limit_reached";
  });

sqlMutation("MUT G: the claim RPC drops the destination-hash lineage check",
  [[MIGRATION_5FC,
    "  if v_primary.destination_hash is distinct from p_destination_hash then\n    return query select 'lineage_mismatch'::text, 'destination_hash_mismatch'::text, null::uuid, null::integer, null::text, null::uuid;\n    return;\n  end if;",
    ""]],
  async () => {
    resetDb(); await claimPrimary();
    forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" });
    const r = await claimFallback({ destinationHash: HASH_B });
    // A fallback OTP would be delivered to a DIFFERENT destination than the primary.
    return r.data.outcome === "CLAIMED";
  });

sqlMutation("MUT H: the claim RPC drops the auth-flow lineage check",
  [[MIGRATION_5FC,
    "  if v_primary.auth_flow is distinct from p_auth_flow then\n    return query select 'lineage_mismatch'::text, 'auth_flow_mismatch'::text, null::uuid, null::integer, null::text, null::uuid;\n    return;\n  end if;",
    ""]],
  async () => {
    resetDb(); await claimPrimary();
    forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" });
    const r = await claimFallback({ authFlow: "vendor_password_reset" });
    // One flow's primary failure would authorize another flow's fallback.
    return r.data.outcome === "CLAIMED";
  });

sqlMutation("MUT I: the claim RPC drops the advisory lock (SELECT-then-INSERT race)",
  [[MIGRATION_5FC,
    "  perform pg_advisory_xact_lock(hashtextextended('qf-auth-action:' || p_auth_action_id, 0));",
    ""]],
  async () => {
    resetDb();
    const results = await Promise.all([claimPrimary(), claimPrimary(), claimPrimary()]);
    const outcomes = results.map((r) => r.data.outcome);
    // Concurrent claimers now collide: the unique index is the only thing left, and the
    // losers surface a raw database error instead of a safe, idempotent ALREADY_EXISTS.
    return outcomes.includes("DATABASE_ERROR");
  });

sqlMutation("MUT J: the claim RPC allows a second fallback attempt",
  [[MIGRATION_5FC,
    "  if v_count >= 2 then\n    return query select 'attempt_limit_reached'::text, 'two_attempts_already_recorded'::text, null::uuid, null::integer, null::text, null::uuid;\n    return;\n  end if;",
    ""],
   [MIGRATION_5FC,
    "  if exists (\n    select 1 from public.authentication_delivery_attempts a\n     where a.auth_action_id = p_auth_action_id\n       and a.attempt_number = 2\n  ) then\n    return query select 'attempt_limit_reached'::text, 'fallback_already_claimed'::text, null::uuid, null::integer, null::text, null::uuid;\n    return;\n  end if;",
    ""]],
  async () => {
    resetDb(); await claimPrimary();
    forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" });
    const first = await claimFallback();
    const second = await claimFallback();
    // Only the unique index stops a second SMS OTP; the RPC no longer refuses cleanly.
    return first.data.outcome === "CLAIMED" && second.data.outcome !== "ATTEMPT_LIMIT_REACHED";
  });

// ---- finalization ---------------------------------------------------------
sqlMutation("MUT K: finalization accepts a contradictory status/certainty pair",
  [[MIGRATION_5FC,
    "  if not (\n       (p_outcome_certainty = 'accepted'           and p_status in ('accepted', 'sent', 'delivered', 'read'))\n    or (p_outcome_certainty = 'definitive_failure' and p_status in ('failed', 'cancelled'))\n    or (p_outcome_certainty = 'unknown_outcome'    and p_status = 'outcome_unknown')\n  ) then\n    return query select 'contradictory_state'::text, 'status_certainty_mismatch'::text, null::uuid, null::text, null::text;\n    return;\n  end if;",
    ""],
   [MIGRATION_5FC,
    "      add constraint chk_auth_attempt_status_certainty\n      check (\n        (outcome_certainty = 'accepted'           and status in ('accepted', 'sent', 'delivered', 'read'))\n        or (outcome_certainty = 'definitive_failure' and status in ('failed', 'cancelled'))\n        or (outcome_certainty = 'unknown_outcome'    and status in ('requested', 'dispatching', 'outcome_unknown'))\n      );",
    "      add constraint chk_auth_attempt_status_certainty check (true);"]],
  async () => {
    resetDb();
    const r = await claimPrimary();
    // Bypass the service-level guard and call the RPC exactly as a bug would.
    const raw = await M.Supabase.adminClient().rpc(FINALIZE_FN, {
      p_attempt_id: r.data.attemptId, p_status: "accepted", p_outcome_certainty: "definitive_failure",
    });
    return raw.data?.[0]?.outcome === "finalized"; // an accepted+definitive_failure row now exists
  });

sqlMutation("MUT K2: an unknown outcome may be rewritten into a definitive failure",
  [[MIGRATION_5FC,
    "  if v_row.outcome_certainty = 'unknown_outcome' and v_row.status = 'outcome_unknown' then\n    if p_outcome_certainty = 'unknown_outcome' and p_status = 'outcome_unknown' then\n      return query select 'no_change'::text, 'already_outcome_unknown'::text, v_row.id, v_row.status, v_row.outcome_certainty;\n      return;\n    end if;\n    return query select 'terminal_outcome_unknown'::text, 'unknown_outcome_is_not_rewritable'::text, v_row.id, v_row.status, v_row.outcome_certainty;\n    return;\n  end if;",
    ""]],
  async () => {
    resetDb();
    const r = await claimPrimary();
    await M.AttemptSvc.finalizeAttempt({ attemptId: r.data.attemptId, status: "outcome_unknown", outcomeCertainty: "unknown_outcome" });
    const rewritten = await M.AttemptSvc.finalizeAttempt({ attemptId: r.data.attemptId, status: "failed", outcomeCertainty: "definitive_failure" });
    if (rewritten.data.outcome !== "FINALIZED") return false;
    // …and the rewrite manufactures fallback eligibility for a possibly-delivered OTP.
    const fb = await claimFallback();
    return fb.data.outcome === "CLAIMED";
  });

sqlMutation("MUT K3: a terminal accepted attempt may regress to failed",
  [[MIGRATION_5FC,
    "  if v_row.outcome_certainty = 'accepted' and p_outcome_certainty <> 'accepted' then\n    return query select 'terminal_accepted'::text, 'accepted_cannot_regress'::text, v_row.id, v_row.status, v_row.outcome_certainty;\n    return;\n  end if;",
    ""]],
  async () => {
    resetDb();
    const r = await claimPrimary();
    await M.AttemptSvc.finalizeAttempt({ attemptId: r.data.attemptId, status: "accepted", outcomeCertainty: "accepted" });
    const regressed = await M.AttemptSvc.finalizeAttempt({ attemptId: r.data.attemptId, status: "failed", outcomeCertainty: "definitive_failure" });
    if (regressed.data.outcome !== "FINALIZED") return false;
    const fb = await claimFallback();
    return fb.data.outcome === "CLAIMED"; // an accepted OTP is now re-sent over SMS
  });

// ---- migration safety -----------------------------------------------------
sqlMutation("MUT L: the migration seeds a permissive failure rule",
  [[MIGRATION_5FC, NO_ACTIVATION_MARKER,
    "insert into public.authentication_transport_failure_rules\n  (auth_flow, primary_channel, primary_provider_key, failure_code, failure_classification,\n   automatic_fallback_eligible, user_requested_fallback_eligible, is_active)\nvalues\n  (null, 'whatsapp', 'meta_whatsapp_cloud', 'ANY_FAILURE', 'provider_rejected', true, true, true);"]],
  () => { rebuildSqlModel(); return /insert into public\.authentication_transport_failure_rules/i.test(SQL.stripped); });

sqlMutation("MUT M: the migration enables automatic fallback",
  [[MIGRATION_5FC, NO_ACTIVATION_MARKER,
    "update public.authentication_transport_policies set automatic_fallback_enabled = true, fallback_policy_status = 'automatic_ready', is_operationally_enabled = true;"]],
  () => { rebuildSqlModel(); return /automatic_fallback_enabled\s*=\s*true/i.test(SQL.stripped); });

sqlMutation("MUT N: the migration enables user-requested fallback",
  [[MIGRATION_5FC, NO_ACTIVATION_MARKER,
    "update public.authentication_transport_policies set user_requested_fallback_enabled = true, fallback_policy_status = 'manual_only';"]],
  () => { rebuildSqlModel(); return /user_requested_fallback_enabled\s*=\s*true/i.test(SQL.stripped); });

sqlMutation("MUT O: the claim RPC is granted to authenticated",
  [[MIGRATION_5FC, NO_ACTIVATION_MARKER,
    `grant execute on function public.${CLAIM_FN}(text, text, text, text, text, integer, text, text, uuid, uuid, text) to authenticated;`]],
  () => { rebuildSqlModel(); return SQL.claimGrants.granted.has("authenticated"); });

sqlMutation("MUT P: the claim RPC takes an OTP parameter",
  [[MIGRATION_5FC, "  p_decision_reason     text default null\n)", "  p_decision_reason     text default null,\n  p_otp                 text default null\n)"]],
  () => { rebuildSqlModel(); return /p_otp/.test(SQL.claimSignature); });

sqlMutation("MUT Q: the failure-rule table stores a plaintext phone number",
  [[MIGRATION_5FC, "  reason_sanitized                text,", "  reason_sanitized                text,\n  phone_e164                      text,"]],
  () => { rebuildSqlModel(); return /phone_e164/i.test(SQL.failureRuleTable); });

// --- ACTION-GROUPING correction mutations (act-A … act-G) -------------------
sqlMutation("MUT act-A: the retired reference-scoped uniqueness authority is restored",
  [[MIGRATION_5FC, "drop index if exists public.uq_auth_delivery_attempt_number;", ""]],
  async () => {
    resetDb();
    const a = await claimPrimary({ authActionId: ACTION_A });
    const b = await claimPrimary({ authActionId: ACTION_B });
    // The same auth user's SECOND login action collides with its first, forever.
    return a.data.outcome === "CLAIMED" && b.data.outcome !== "CLAIMED";
  });

sqlMutation("MUT act-B: the new unique index omits auth_action_id",
  [[MIGRATION_5FC,
    "create unique index if not exists uq_auth_delivery_attempt_action_number\n  on public.authentication_delivery_attempts (auth_action_id, attempt_number);",
    "create unique index if not exists uq_auth_delivery_attempt_action_number\n  on public.authentication_delivery_attempts (auth_flow, auth_reference_id, attempt_number);"]],
  async () => {
    resetDb();
    const a = await claimPrimary({ authActionId: ACTION_A });
    const b = await claimPrimary({ authActionId: ACTION_B });
    return a.data.outcome === "CLAIMED" && b.data.outcome !== "CLAIMED";
  });

// --- CONCURRENCY-CONSISTENCY mutations (c-A … c-F) --------------------------
// The action hash is a GLOBAL identity in the RPC's conflict detection. The lock and both
// unique indexes must agree. Each of these re-introduces `auth_flow` (or the reference)
// somewhere and re-opens the same-hash race.
const LOCK_LINE = "  perform pg_advisory_xact_lock(hashtextextended('qf-auth-action:' || p_auth_action_id, 0));";
const FLOW_LOCK_LINE = "  perform pg_advisory_xact_lock(hashtextextended(p_auth_flow || ':' || p_auth_action_id, 0));";
const ACTION_IDX = "create unique index if not exists uq_auth_delivery_attempt_action_number\n  on public.authentication_delivery_attempts (auth_action_id, attempt_number);";
const FLOW_IDX = "create unique index if not exists uq_auth_delivery_attempt_action_number\n  on public.authentication_delivery_attempts (auth_flow, auth_action_id, attempt_number);";
const FALLBACK_IDX = "create unique index if not exists uq_auth_delivery_attempt_single_fallback\n  on public.authentication_delivery_attempts (auth_action_id)\n  where attempt_number = 2;";

/** Two concurrent primary claims for ONE hash under two different flows. */
async function sameHashDifferentFlowRace() {
  resetDb();
  const results = await Promise.all([
    claimPrimary({ authActionId: ACTION_A, authFlow: "client_login_otp" }),
    claimPrimary({ authActionId: ACTION_A, authFlow: "vendor_password_reset", authReferenceType: "verification_challenge", authReferenceId: "chal-1" }),
  ]);
  return { outcomes: results.map((r) => r.data.outcome), rows: db.authentication_delivery_attempts.length };
}

sqlMutation("MUT c-A: auth_flow is restored to the advisory lock key",
  [[MIGRATION_5FC, LOCK_LINE, FLOW_LOCK_LINE]],
  async () => {
    rebuildSqlModel();
    const { outcomes } = await sameHashDifferentFlowRace();
    // Two locks, two callers, one empty ledger observed twice. The unique index is now the
    // only thing standing between them, and the loser gets a raw database error instead of
    // the `action_identity_conflict` the RPC promises.
    return outcomes.includes("DATABASE_ERROR");
  });

sqlMutation("MUT c-B: auth_flow is restored to the action-number unique index",
  [[MIGRATION_5FC, ACTION_IDX, FLOW_IDX]],
  () => {
    rebuildSqlModel();
    resetDb();
    const seed = (flow) => insertRow("authentication_delivery_attempts", {
      auth_flow: flow, auth_action_id: ACTION_A, auth_reference_type: "auth_user", auth_reference_id: "u",
      destination_hash: HASH_A, attempt_number: 1, channel: "whatsapp", provider_key: "mock",
      fallback_from_attempt_id: null, status: "requested", outcome_certainty: "unknown_outcome",
    });
    seed("client_login_otp");
    try { seed("vendor_password_reset"); } catch { return false; }
    // Two physical primary attempts now exist for ONE action hash.
    return rowsFor(ACTION_A).filter((a) => a.attempt_number === 1).length === 2;
  });

sqlMutation("MUT c-C: auth_flow is restored to the single-fallback unique index",
  [[MIGRATION_5FC, FALLBACK_IDX,
    "create unique index if not exists uq_auth_delivery_attempt_single_fallback\n  on public.authentication_delivery_attempts (auth_flow, auth_action_id)\n  where attempt_number = 2;"],
   // Also widen the attempt-number authority, or it would still catch the second row.
   [MIGRATION_5FC, ACTION_IDX, FLOW_IDX]],
  () => {
    rebuildSqlModel();
    resetDb();
    const seedFallback = (flow) => insertRow("authentication_delivery_attempts", {
      auth_flow: flow, auth_action_id: ACTION_A, auth_reference_type: "auth_user", auth_reference_id: "u",
      destination_hash: HASH_A, attempt_number: 2, channel: "sms", provider_key: "sms_mock",
      fallback_from_attempt_id: crypto.randomUUID(), status: "requested", outcome_certainty: "unknown_outcome",
    });
    seedFallback("client_login_otp");
    try { seedFallback("vendor_password_reset"); } catch { return false; }
    // Two SMS fallbacks now exist for ONE action hash — two OTP deliveries.
    return rowsFor(ACTION_A).filter((a) => a.attempt_number === 2).length === 2;
  });

sqlMutation("MUT c-D: concurrent same-hash/different-flow primaries are both inserted",
  [[MIGRATION_5FC, LOCK_LINE, FLOW_LOCK_LINE],
   [MIGRATION_5FC, ACTION_IDX, FLOW_IDX]],
  async () => {
    rebuildSqlModel();
    const { outcomes, rows } = await sameHashDifferentFlowRace();
    // The exact race the correction closes: two primary rows for one action identity,
    // both callers told they CLAIMED it.
    return rows === 2 && outcomes.filter((o) => o === "CLAIMED").length === 2;
  });

sqlMutation("MUT c-E: the primary conflict probe is scoped by auth_flow (no global lookup)",
  [[MIGRATION_5FC,
    "    select * into v_existing\n      from public.authentication_delivery_attempts a\n     where a.auth_action_id = p_auth_action_id\n     order by a.attempt_number\n     limit 1\n     for update;",
    "    select * into v_existing\n      from public.authentication_delivery_attempts a\n     where a.auth_flow = p_auth_flow\n       and a.auth_action_id = p_auth_action_id\n     order by a.attempt_number\n     limit 1\n     for update;"]],
  async () => {
    rebuildSqlModel();
    resetDb();
    await claimPrimary({ authActionId: ACTION_A, authFlow: "client_login_otp" });
    const conflicting = await claimPrimary({ authActionId: ACTION_A, authFlow: "vendor_password_reset", authReferenceType: "verification_challenge", authReferenceId: "chal-1" });
    // The probe no longer sees the other flow's row, so the RPC cannot report
    // `action_identity_conflict`; only the unique index stops it, as a raw error.
    return conflicting.data.outcome !== "LINEAGE_MISMATCH";
  });

sqlMutation("MUT act-D: the fallback lookup ignores auth_action_id",
  [[MIGRATION_5FC,
    "  select * into v_primary\n    from public.authentication_delivery_attempts a\n   where a.auth_action_id = p_auth_action_id\n     and a.attempt_number = 1\n   limit 1\n   for update;",
    "  select * into v_primary\n    from public.authentication_delivery_attempts a\n   where a.auth_reference_type = p_auth_reference_type\n     and a.auth_reference_id = p_auth_reference_id\n     and a.attempt_number = 1\n   limit 1\n   for update;"],
   [MIGRATION_5FC,
    "  if v_primary.auth_action_id is distinct from p_auth_action_id then\n    return query select 'lineage_mismatch'::text, 'auth_action_mismatch'::text, null::uuid, null::integer, null::text, null::uuid;\n    return;\n  end if;",
    ""]],
  async () => {
    resetDb();
    await claimPrimary({ authActionId: ACTION_A });
    forcePrimary({ status: "failed", outcome_certainty: "definitive_failure" }, ACTION_A);
    const cross = await claimFallback({ authActionId: ACTION_B });
    // Login action B would send its SMS fallback off login action A's failed primary.
    return cross.data.outcome === "CLAIMED";
  });

sqlMutation("MUT c-F: the advisory lock reverts to the long-lived auth reference",
  [[MIGRATION_5FC, LOCK_LINE,
    "  perform pg_advisory_xact_lock(hashtextextended(p_auth_reference_type || ':' || p_auth_reference_id, 0));"]],
  async () => {
    rebuildSqlModel();
    if (SQL.guards.claim.locksOnAction) return false;
    // Same hash under two references now takes two different locks, so both callers
    // observe an empty ledger and race; only the unique index stops the second insert.
    resetDb();
    const results = await Promise.all([
      claimPrimary({ authActionId: ACTION_A, authReferenceId: "user-1" }),
      claimPrimary({ authActionId: ACTION_A, authReferenceId: "user-2" }),
    ]);
    return results.map((r) => r.data.outcome).includes("DATABASE_ERROR");
  });

sqlMutation("MUT act-E: a second login action for the same auth user is rejected",
  [[MIGRATION_5FC,
    "    select * into v_existing\n      from public.authentication_delivery_attempts a\n     where a.auth_action_id = p_auth_action_id\n     order by a.attempt_number\n     limit 1\n     for update;",
    "    select * into v_existing\n      from public.authentication_delivery_attempts a\n     where a.auth_reference_type = p_auth_reference_type\n       and a.auth_reference_id = p_auth_reference_id\n     order by a.attempt_number\n     limit 1\n     for update;"]],
  async () => {
    resetDb();
    const a = await claimPrimary({ authActionId: ACTION_A });
    const b = await claimPrimary({ authActionId: ACTION_B });
    // The user's first login permanently consumes their attempt-1 slot.
    return a.data.outcome === "CLAIMED" && b.data.outcome !== "CLAIMED";
  });

sqlMutation("MUT act-F: an action id may be replayed under a different identity",
  [[MIGRATION_5FC,
    "      if v_existing.auth_flow is distinct from p_auth_flow\n         or v_existing.auth_reference_type is distinct from p_auth_reference_type\n         or v_existing.auth_reference_id is distinct from p_auth_reference_id\n         or v_existing.destination_hash is distinct from p_destination_hash then\n        return query select 'lineage_mismatch'::text, 'action_identity_conflict'::text,\n                            null::uuid, null::integer, null::text, null::uuid;\n        return;\n      end if;",
    ""]],
  async () => {
    resetDb();
    await claimPrimary({ authActionId: ACTION_A, destinationHash: HASH_A });
    // The caller believes it claimed an attempt for HASH_B; it silently gets HASH_A's.
    const drifted = await claimPrimary({ authActionId: ACTION_A, destinationHash: HASH_B });
    const refDrift = await claimPrimary({ authActionId: ACTION_A, authReferenceId: "user-2" });
    return drifted.data.outcome !== "LINEAGE_MISMATCH" || refDrift.data.outcome !== "LINEAGE_MISMATCH";
  });

// --- ACTION-IDENTITY mutations (h-A … h-F) ---------------------------------
tsMutation("MUT h-A: the helper returns the raw authoritative id instead of a SHA-256 digest",
  [[ACTION_ID_SRC,
    "  return crypto\n    .createHash(AUTH_ACTION_ID_ALGORITHM)\n    .update(canonical, \"utf8\")\n    .digest(\"hex\") as AuthenticationActionId;",
    "  void canonical;\n  return sourceId as AuthenticationActionId;"]],
  (mm) => {
    const id = mm.ActionId.deriveAuthenticationActionId({ authFlow: "client_login_otp", sourceKind: "supabase_webhook", authoritativeActionId: "hook-A" });
    // The raw verified webhook id would now be persisted as the action identity.
    return id === "hook-A" && !SHA256_HEX.test(id);
  });

tsMutation("MUT h-B: authFlow is dropped from the canonical hash input",
  [[ACTION_ID_SRC,
    "  const canonical = [AUTH_ACTION_ID_DOMAIN, input.authFlow, input.sourceKind, sourceId].join(\n    FIELD_SEPARATOR\n  );",
    "  const canonical = [AUTH_ACTION_ID_DOMAIN, input.sourceKind, sourceId].join(\n    FIELD_SEPARATOR\n  );"]],
  (mm) => {
    const d = (flow) => mm.ActionId.deriveAuthenticationActionId({ authFlow: flow, sourceKind: "verification_challenge", authoritativeActionId: "chal-1" });
    // One challenge would derive ONE action across vendor verify and password reset.
    return d("vendor_whatsapp_verify") === d("vendor_password_reset");
  });

tsMutation("MUT h-C: sourceKind is dropped from the canonical hash input",
  [[ACTION_ID_SRC,
    "  const canonical = [AUTH_ACTION_ID_DOMAIN, input.authFlow, input.sourceKind, sourceId].join(\n    FIELD_SEPARATOR\n  );",
    "  const canonical = [AUTH_ACTION_ID_DOMAIN, input.authFlow, sourceId].join(\n    FIELD_SEPARATOR\n  );"]],
  (mm) => {
    const d = (kind) => mm.ActionId.deriveAuthenticationActionId({ authFlow: "client_login_otp", sourceKind: kind, authoritativeActionId: "x" });
    // A webhook id and a challenge id sharing a string would collide into one action.
    return d("supabase_webhook") === d("verification_challenge");
  });

tsMutation("MUT h-D: the attempt service accepts a raw six-digit one-time code",
  [[ATTEMPT_SVC_SRC,
    "  if (!isAuthenticationActionId(input.authActionId)) {\n    return ok(INVALID_ACTION_ID_RESULT);\n  }",
    "  if (!isAuthenticationActionId(input.authActionId) && !/^[0-9]{6}$/.test(input.authActionId)) {\n    return ok(INVALID_ACTION_ID_RESULT);\n  }"]],
  async (mm) => {
    stubDb(mm); resetDb(); resetRpcCalls();
    await claimPrimary({ authActionId: "483920" }, mm);
    // The service no longer fails closed: a raw one-time code is carried all the way to
    // the database boundary, where only the RPC's own guard still stops it.
    return rpcCallCount > 0;
  });

sqlMutation("MUT h-E: the claim RPC accepts a digit-only phone number as the action id",
  [[MIGRATION_5FC,
    "  if p_auth_action_id is null or p_auth_action_id !~ '^[0-9a-f]{64}$' then",
    "  if p_auth_action_id is null or p_auth_action_id !~ '^[0-9a-f]{64}$|^[0-9]{10,15}$' then"]],
  async () => {
    resetDb();
    const rpc = await M.Supabase.adminClient().rpc(CLAIM_FN, {
      p_auth_flow: "client_login_otp", p_auth_action_id: "919876543210", p_auth_reference_type: "auth_user",
      p_auth_reference_id: "user-1", p_destination_hash: HASH_A, p_attempt_number: 1,
      p_channel: "whatsapp", p_provider_key: "mock",
    });
    // A caller that bypasses the service is no longer refused before ledger mutation.
    return rpc.data[0].outcome !== "invalid_request";
  });

sqlMutation("MUT h-F: the CHECK is relaxed back to the broad 1-128 identifier pattern",
  [[MIGRATION_5FC,
    "      check (auth_action_id ~ '^[0-9a-f]{64}$');",
    "      check (auth_action_id ~ '^[A-Za-z0-9_.:-]{1,128}$');"]],
  () => {
    rebuildSqlModel();
    resetDb();
    // A raw one-time code and a bare MSISDN can now be persisted as the action identity.
    let stored = 0;
    for (const raw of ["483920", "919876543210"]) {
      try {
        insertRow("authentication_delivery_attempts", {
          auth_flow: "client_login_otp", auth_action_id: raw,
          auth_reference_type: "auth_user", auth_reference_id: `u-${raw}`,
          destination_hash: HASH_A, attempt_number: 1, channel: "whatsapp", provider_key: "mock",
          fallback_from_attempt_id: null, status: "requested", outcome_certainty: "unknown_outcome",
        });
        stored += 1;
      } catch { /* still refused */ }
    }
    return stored === 2;
  });

sqlMutation("MUT act-G: the migration fabricates auth_action_id from auth_reference_id",
  [[MIGRATION_5FC,
    "  if v_orphans > 0 then\n    raise exception 'Phase 5F-C1: % authentication_delivery_attempts row(s) have no auth_action_id; refusing to fabricate one', v_orphans\n      using errcode = 'invalid_table_definition',\n            hint = 'Backfill auth_action_id by DERIVING it with lib/communication/authenticationActionIdentity.ts from the authoritative server-side action (verified webhook id / challenge id). NEVER derive it from auth_reference_id, destination_hash, communication_message_id, or a one-time code.';\n  end if;",
    "  if v_orphans > 0 then\n    update public.authentication_delivery_attempts set auth_action_id = auth_reference_id where auth_action_id is null;\n  end if;"]],
  () => {
    rebuildSqlModel();
    // A client-login row's reference is the auth USER, so this silently recreates the
    // very collision the correction removes — and it is unverifiable, invented data.
    return /set auth_action_id = auth_reference_id/i.test(SQL.stripped) || !/refusing to fabricate one/.test(SQL.stripped);
  });

sqlMutation("MUT act-H: the migration fabricates auth_action_id from destination_hash",
  [[MIGRATION_5FC,
    "    alter column auth_action_id set not null;",
    "    update public.authentication_delivery_attempts set auth_action_id = destination_hash where auth_action_id is null;\n  alter table public.authentication_delivery_attempts\n    alter column auth_action_id set not null;"]],
  () => {
    rebuildSqlModel();
    // A destination hash IS 64 lowercase hex, so it would slip past the CHECK — and it
    // groups attempts by phone number, not by authentication action.
    return /set auth_action_id = destination_hash/i.test(SQL.stripped);
  });

// ============================================================================
// EXECUTE
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-C1 authentication transport resilience checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}
async function suiteGoesRed() {
  for (const c of checks) { try { await c.fn(); } catch { return true; } }
  return false;
}
async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5F-C1 mutation tests...\n");
  for (const mut of mutationChecks) {
    const mutDir = resolve(`.phase5fc-mut-${mutationChecks.indexOf(mut)}`);
    const originals = new Map();
    for (const edit of mut.edits) {
      const p = resolve(edit.file);
      if (!originals.has(p)) originals.set(p, readFileSync(p, "utf8"));
    }
    try {
      for (const edit of mut.edits) {
        const p = resolve(edit.file);
        const cur = readFileSync(p, "utf8");
        if (!cur.includes(edit.from)) throw new Error(`anchor not found in ${edit.file}`);
        writeFileSync(p, cur.replace(edit.from, edit.to));
      }
      let violation = false;
      if (mut.kind === "ts") {
        let mm;
        try { compileTo(mutDir); } catch { console.log(`PASS ${mut.name} (rejected at compile time)`); passed++; continue; }
        mm = wireBuild(mutDir);
        stubDb(mm);
        rebuildSqlModel();
        violation = await mut.scenario(mm);
      } else {
        rebuildSqlModel();
        violation = await mut.scenario();
      }
      if (!violation) violation = await suiteGoesRed();
      if (violation) { console.log(`PASS ${mut.name}`); passed++; }
      else { console.log(`FAIL ${mut.name} (guard did not prove load-bearing)`); failed++; }
    } catch (e) {
      console.log(`FAIL ${mut.name}`); console.error(e); failed++;
    } finally {
      for (const [p, original] of originals) writeFileSync(p, original);
      rmSync(mutDir, { recursive: true, force: true });
      rebuildSqlModel();
      stubDb(M);
    }
  }
  return { passed, failed };
}

const functional = await runFunctional();
const mutations = await runMutations();
rmSync(MAIN_DIR, { recursive: true, force: true });
const passed = functional.passed + mutations.passed;
const failed = functional.failed + mutations.failed;
console.log(`\nSummary: ${passed} passed, ${failed} failed (functional: ${functional.passed}/${functional.passed + functional.failed}, mutation: ${mutations.passed}/${mutations.passed + mutations.failed}).`);
process.exit(failed > 0 ? 1 : 0);
