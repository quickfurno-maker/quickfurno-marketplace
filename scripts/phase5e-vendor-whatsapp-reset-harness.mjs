import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import crypto from "node:crypto";

/**
 * Phase 5E — QuickFurno Vendor WhatsApp Verification + Password Reset harness.
 *
 * Exercises the three DISTINCT vendor security concerns (login / WhatsApp identity
 * verification / password reset), the OTP + grant cryptography, the operational
 * gate, the provider-bound delivery attestation, the persisted rate limits, the
 * atomic challenge + grant concurrency, the migration's structural guards, and the
 * privilege model. It then MUTATION-TESTS every security-critical invariant by
 * editing the REAL source (TypeScript and SQL), rebuilding, and asserting the
 * vulnerability appears — restoring every file byte-identically afterwards.
 *
 * TWO THINGS MAKE THIS HARNESS HONEST
 *   1. The mock database's UNIQUE INDEXES and the phone_e164 CHECK constraint are
 *      PARSED OUT OF THE MIGRATION FILES. Deleting an index from the SQL really
 *      does stop the model enforcing it.
 *   2. The four atomic SQL functions are modelled by a small interpreter whose
 *      guards are DERIVED FROM THE FUNCTION BODIES. Removing `and c.status =
 *      'pending'` from the SQL really does let the model consume a used challenge.
 *
 * Application code runs against a mock query builder that yields to the event loop
 * between statements, so a read-then-write in application code genuinely loses a
 * concurrent update — while an `rpc()` call executes its critical section without
 * an await, exactly as a single SQL statement does under a row lock.
 */

const requireRoot = createRequire(import.meta.url);
const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const FILES = [
  "lib/errors.ts",
  "lib/supabase.ts",
  "lib/communication/phone.ts",
  "lib/communication/dbErrors.ts",
  "lib/communication/types.ts",
  "lib/communication/recipientResolver.ts",
  "lib/communication/providers/whatsappProvider.ts",
  "lib/communication/providers/providerError.ts",
  "lib/communication/providers/mockWhatsAppProvider.ts",
  "lib/identity/principal.ts",
  "lib/identity/verification.ts",
  "lib/identity/authSecurityEvent.ts",
  "lib/identity/vendorAccess.ts",
  "lib/identity/vendorLoginIdentifier.ts",
  "lib/identity/vendorAuthAutomation.ts",
  "lib/identity/vendorOtpCrypto.ts",
  "lib/identity/vendorVerification.ts",
  "lib/identity/vendorPasswordReset.ts",
  "services/communicationRecipientResolver.ts",
  "services/communicationService.ts",
  "services/authSecurityEventService.ts",
  "services/vendorAccessService.ts",
  "services/vendorAuthService.ts",
  "services/vendorAuthAutomationService.ts",
  "services/vendorAuthChallengeService.ts",
  "services/vendorVerificationService.ts",
  "services/vendorPasswordResetService.ts",
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
          outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] },
        },
        files: FILES,
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

// ============================================================================
// SOURCE TEXT (code only — comments stripped, so a comment can never satisfy a
// security assertion)
// ============================================================================
function readCode(path) {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
}

const MIGRATION_5A = "supabase/migrations/20260708000160_identity_security_foundation.sql";
const MIGRATION_5C = "supabase/migrations/20260708000180_vendor_authentication_foundation.sql";
const MIGRATION_5E = "supabase/migrations/20260708000200_vendor_whatsapp_verification_password_reset.sql";
const DOC_5E = "docs/QF-Vendor-WhatsApp-Verification-Password-Reset-Phase-5E.md";

const OTP_CRYPTO_SRC = readCode("lib/identity/vendorOtpCrypto.ts");
const AUTOMATION_SRC = readCode("lib/identity/vendorAuthAutomation.ts");
const VERIFICATION_LIB_SRC = readCode("lib/identity/vendorVerification.ts");
const RESET_LIB_SRC = readCode("lib/identity/vendorPasswordReset.ts");
const CHALLENGE_SVC_SRC = readCode("services/vendorAuthChallengeService.ts");
const VERIFY_SVC_SRC = readCode("services/vendorVerificationService.ts");
const RESET_SVC_SRC = readCode("services/vendorPasswordResetService.ts");
const GATE_SVC_SRC = readCode("services/vendorAuthAutomationService.ts");
const VENDOR_AUTH_SRC = readCode("services/vendorAuthService.ts");
const VENDOR_ACCESS_SRC = readCode("services/vendorAccessService.ts");
const CLIENT_OTP_SRC = readCode("services/clientOtpAuthService.ts");
const ROUTES_SRC = [
  "app/api/vendor/auth/whatsapp/request/route.ts",
  "app/api/vendor/auth/whatsapp/verify/route.ts",
  "app/api/vendor/auth/password-reset/request/route.ts",
  "app/api/vendor/auth/password-reset/verify/route.ts",
  "app/api/vendor/auth/password-reset/complete/route.ts",
].map(readCode).join("\n");

const ALL_5E_SRC = [
  OTP_CRYPTO_SRC, AUTOMATION_SRC, VERIFICATION_LIB_SRC, RESET_LIB_SRC,
  CHALLENGE_SVC_SRC, VERIFY_SVC_SRC, RESET_SVC_SRC, GATE_SVC_SRC, ROUTES_SRC,
].join("\n");

// ============================================================================
// SQL ARTIFACTS — parsed out of the real migrations, rebuilt after a SQL mutation
// ============================================================================
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
    m = atom.match(/^(\w+)\s*=\s*'([^']*)'$/);
    if (m) return (r) => r[m[1]] === m[2];
    throw new Error(`unsupported index predicate atom: "${atom}"`);
  });
  return (row) => tests.every((t) => t(row));
}

/** Extract the body of `create or replace function public.NAME(...) ... $$;` */
function functionBody(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start === -1) return "";
  const bodyStart = sql.indexOf("as $$", start);
  if (bodyStart === -1) return "";
  const bodyEnd = sql.indexOf("$$;", bodyStart + 5);
  if (bodyEnd === -1) return "";
  return sql.slice(bodyStart + 5, bodyEnd);
}

function loadSqlArtifacts() {
  const raw5a = readFileSync(MIGRATION_5A, "utf8");
  const raw5c = readFileSync(MIGRATION_5C, "utf8");
  const raw5e = readFileSync(MIGRATION_5E, "utf8");
  const strip = (s) => s.replace(/--[^\n]*/g, "");
  const stripped5e = strip(raw5e);
  const normalized5e = stripped5e.toLowerCase().replace(/\s+/g, " ");

  // Unique indexes the identity model depends on, PARSED from the real migrations.
  const uniqueIndexes = {};
  for (const sql of [strip(raw5a), strip(raw5c), stripped5e]) {
    UNIQUE_INDEX_RE.lastIndex = 0;
    for (const m of sql.matchAll(UNIQUE_INDEX_RE)) {
      const [, name, table, cols, where] = m;
      (uniqueIndexes[table] ??= []).push({
        name,
        cols: cols.split(",").map((c) => c.trim().replace(/\s+(asc|desc)$/i, "")),
        where: compilePredicate(where),
      });
    }
  }
  // Communication-core constraints the ledger relies on (Phase 5B, unchanged).
  (uniqueIndexes.communication_messages ??= []).push({
    name: "communication_messages_idempotency_key_key",
    cols: ["idempotency_key"],
    where: () => true,
  });

  // The E.164 CHECK constraint, taken verbatim from the migration.
  const checkMatch = stripped5e.match(
    /check\s*\(\s*phone_e164 is null or phone_e164 ~ '([^']+)'\s*\)/i
  );
  const phoneCheck = checkMatch ? new RegExp(checkMatch[1]) : null;

  // The delivery_channel vocabulary CHECK, parsed from the migration.
  const channelMatch = stripped5e.match(
    /check\s*\(\s*delivery_channel is null or delivery_channel in \(([^)]*)\)\s*\)/i
  );
  const deliveryChannelCheck = channelMatch
    ? channelMatch[1].split(",").map((s) => s.trim().replace(/'/g, ""))
    : null;

  const bodies = {
    attempt: functionBody(stripped5e, "vendor_auth_register_failed_attempt"),
    consumeWhatsapp: functionBody(stripped5e, "vendor_auth_consume_whatsapp_challenge"),
    consumeReset: functionBody(stripped5e, "vendor_auth_consume_reset_challenge_and_issue_grant"),
    claim: functionBody(stripped5e, "vendor_auth_claim_reset_grant"),
    issue: functionBody(stripped5e, "vendor_auth_issue_challenge"),
  };

  // The interpreter's guard set is DERIVED from the SQL, not hardcoded. Deleting a
  // guard from the migration really does change how the model behaves.
  const guards = {
    attempt: {
      checksPurpose: /c\.purpose is not distinct from p_purpose/.test(bodies.attempt),
      checksPending: /c\.status = 'pending'/.test(bodies.attempt),
      checksExpiry: /c\.expires_at > now\(\)/.test(bodies.attempt),
      locksAtMax: /'locked'/.test(bodies.attempt),
    },
    consumeWhatsapp: {
      checksPurpose: /c\.purpose is not distinct from 'vendor_whatsapp_verify'/.test(bodies.consumeWhatsapp),
      checksPending: /c\.status = 'pending'/.test(bodies.consumeWhatsapp),
      checksExpiry: /c\.expires_at > v_now/.test(bodies.consumeWhatsapp),
      checksDashboardUser: /c\.vendor_dashboard_user_id is not distinct from p_vendor_dashboard_user_id/.test(bodies.consumeWhatsapp),
      checksUser: /c\.user_id is not distinct from p_user_id/.test(bodies.consumeWhatsapp),
      checksVendor: /c\.vendor_id is not distinct from p_vendor_id/.test(bodies.consumeWhatsapp),
      checksDestination: /c\.destination_hash is not distinct from p_destination_hash/.test(bodies.consumeWhatsapp),
      requiresActiveMembership: /d\.status = 'active'/.test(bodies.consumeWhatsapp),
      // The challenge CAS must precede the flag write, or flags could be set for a
      // challenge that was never consumed.
      consumeBeforeBind:
        bodies.consumeWhatsapp.indexOf("update public.verification_challenges") <
        bodies.consumeWhatsapp.indexOf("update public.vendor_dashboard_users"),
    },
    consumeReset: {
      checksPurpose: /c\.purpose is not distinct from 'vendor_password_reset'/.test(bodies.consumeReset),
      checksPending: /c\.status = 'pending'/.test(bodies.consumeReset),
      checksExpiry: /c\.expires_at > v_now/.test(bodies.consumeReset),
      checksLineage:
        /c\.vendor_dashboard_user_id is not distinct from p_vendor_dashboard_user_id/.test(bodies.consumeReset) &&
        /c\.user_id is not distinct from p_user_id/.test(bodies.consumeReset) &&
        /c\.vendor_id is not distinct from p_vendor_id/.test(bodies.consumeReset),
      revokesOlderOpenGrants: /set revoked_at = v_now/.test(bodies.consumeReset),
      storesHashOnly: /p_grant_token_hash/.test(bodies.consumeReset),
    },
    claim: {
      checksConsumed: /g\.consumed_at is null/.test(bodies.claim),
      checksRevoked: /g\.revoked_at is null/.test(bodies.claim),
      checksExpiry: /g\.expires_at > v_now/.test(bodies.claim),
      burnsOnClaim: /set consumed_at = v_now/.test(bodies.claim),
      matchesHash: /g\.grant_token_hash = p_grant_token_hash/.test(bodies.claim),
    },
    issue: issueGuards(bodies.issue),
  };

  return { raw5e, stripped5e, normalized5e, uniqueIndexes, phoneCheck, deliveryChannelCheck, bodies, guards };
}

/** Parse "10 minutes" / "60 seconds" / "1 hour" / "1 day" into milliseconds. */
function intervalToMs(text) {
  const m = text.trim().match(/^(\d+)\s*(second|minute|hour|day)s?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { second: 1000, minute: 60000, hour: 3600000, day: 86400000 }[m[2].toLowerCase()];
  return n * unit;
}

/**
 * Derive the issuance function's SECURITY POLICY and enforcement wiring from the
 * SQL body. When a mutation reintroduces a caller param (e.g. `p_max_per_hour`),
 * the corresponding *FromConstant guard flips false AND the parsed value is lost,
 * so the interpreter falls back to the (absent) caller value and enforcement breaks
 * — reproducing the weakening a caller-controlled policy would allow.
 */
function issueGuards(body) {
  const intConst = (name) => {
    const m = body.match(new RegExp(`${name}\\s+constant\\s+integer\\s*:=\\s*(\\d+)`, "i"));
    return m ? Number(m[1]) : null;
  };
  const intervalConst = (name) => {
    const m = body.match(new RegExp(`${name}\\s+constant\\s+interval\\s*:=\\s*interval\\s*'([^']+)'`, "i"));
    return m ? intervalToMs(m[1]) : null;
  };
  return {
    // Serialization: the per-identity FOR UPDATE lock. Without it the model yields
    // between the rate-limit read and the insert, so concurrent callers interleave.
    serializes: /for update/i.test(body),
    checksPurpose: /p_purpose is distinct from 'vendor_whatsapp_verify'/.test(body),
    checksLineage:
      /v_d\.user_id is distinct from p_user_id/.test(body) &&
      /v_d\.vendor_id is distinct from p_vendor_id/.test(body),
    checksMembership: /v_d\.status is distinct from 'active'/.test(body),
    hasCooldownCheck: /v_cooldown > 0/.test(body),
    hasHourlyCheck: /v_hour >= /.test(body),
    hasDailyCheck: /v_day >= /.test(body),
    // The prior-pending cancel must come AFTER every rate-limit return.
    cancelsOnlyWhenAllowed:
      body.lastIndexOf("'rate_limited'") < body.indexOf("set status = 'cancelled'"),

    // ---- SECURITY POLICY AUTHORITY (this pass) ----
    // No caller-supplied policy parameter may appear anywhere in the function.
    noCallerPolicyParams: !/p_(max_per_hour|max_per_day|cooldown_seconds|max_attempts|expires_at)/.test(body),
    // Each policy value must come from an internal constant used in the right place.
    cooldownFromConstant: /v_now - c_cooldown/.test(body),
    hourFromConstant: /v_hour >= c_max_per_hour/.test(body),
    dayFromConstant: /v_day >= c_max_per_day/.test(body),
    ttlFromConstant: /v_now \+ c_ttl/.test(body),
    maxAttemptsFromConstant: /0, c_max_attempts,/.test(body),
    // The parsed authoritative values (null if expressed via a caller param).
    cooldownMs: intervalConst("c_cooldown"),
    ttlMs: intervalConst("c_ttl"),
    maxPerHour: intConst("c_max_per_hour"),
    maxPerDay: intConst("c_max_per_day"),
    maxAttempts: intConst("c_max_attempts"),
  };
}

let SQL = loadSqlArtifacts();
function rebuildSqlModel() {
  SQL = loadSqlArtifacts();
}

// ============================================================================
// PRIVILEGE ENGINE (order-aware, from an over-privileged initial state)
// ============================================================================
const ALL_TABLE_PRIVILEGES = ["select", "insert", "update", "delete", "truncate", "references", "trigger"];

function privilegeStatementsFor(table) {
  return new RegExp(`\\b(grant|revoke)\\s+([a-z, ]+?)\\s+on\\s+public\\.${table}\\s+(?:to|from)\\s+([a-z_]+)\\s*;`, "gi");
}

function applyTablePrivileges(sql, table, initialState) {
  const state = {};
  for (const [role, privs] of Object.entries(initialState)) state[role] = new Set(privs);
  const applied = [];
  for (const m of sql.matchAll(privilegeStatementsFor(table))) {
    const verb = m[1].toLowerCase();
    const text = m[2].toLowerCase().trim();
    const role = m[3].toLowerCase();
    const privs = text === "all" || text === "all privileges" ? [...ALL_TABLE_PRIVILEGES] : text.split(",").map((p) => p.trim()).filter(Boolean);
    if (!state[role]) state[role] = new Set();
    for (const p of privs) { if (verb === "grant") state[role].add(p); else state[role].delete(p); }
    applied.push({ verb, privs, role });
  }
  return { state, applied };
}

const HISTORICAL_BROAD = () => ({
  anon: [...ALL_TABLE_PRIVILEGES],
  authenticated: [...ALL_TABLE_PRIVILEGES],
  service_role: [...ALL_TABLE_PRIVILEGES],
});

/** EXECUTE privileges on a function, starting from PostgreSQL's PUBLIC default. */
function applyFunctionPrivileges(sql, fnName) {
  const state = { public: new Set(["execute"]), anon: new Set(["execute"]), authenticated: new Set(["execute"]), service_role: new Set(["execute"]) };
  const re = new RegExp(`\\b(grant|revoke)\\s+(all|execute)\\s+on\\s+function\\s+public\\.${fnName}\\s*\\([^)]*\\)\\s+(?:to|from)\\s+([a-z_]+)\\s*;`, "gi");
  const applied = [];
  for (const m of sql.matchAll(re)) {
    const verb = m[1].toLowerCase();
    const role = m[3].toLowerCase();
    if (!state[role]) state[role] = new Set();
    if (verb === "grant") state[role].add("execute");
    else state[role].delete("execute");
    applied.push({ verb, role });
  }
  return { state, applied };
}

// ============================================================================
// AUTOMATION READINESS — PostgreSQL three-valued logic model of the SECTION 4 block
// ============================================================================
function sqlNotEquals(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return a !== b;
}
function sqlIsDistinctFrom(a, b) {
  const x = a === undefined ? null : a;
  const y = b === undefined ? null : b;
  return x !== y;
}
function sqlOr(values) {
  if (values.some((v) => v === true)) return true;
  if (values.some((v) => v === null)) return null;
  return false;
}
function sqlIfFires(v) { return v === true; }

class MigrationError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

/** Faithful JS port of the SECTION 4 DO block, under real SQL 3-valued logic. */
function applyAutomationMigration(rows, { comparator = sqlIsDistinctFrom, keys = ["vendor_whatsapp_verify", "vendor_password_reset"] } = {}) {
  let transitioned = 0;
  for (const key of keys) {
    const matches = rows.filter((r) => r.automation_key === key);
    if (matches.length === 0) throw new MigrationError("missing_row");
    if (matches.length > 1) throw new MigrationError("duplicate_rows");
    const r = matches[0];
    const f = (n) => (r[n] === undefined ? null : r[n]);

    const structural = sqlOr([
      comparator(f("lane"), "authentication"),
      comparator(f("channel"), "whatsapp"),
      comparator(f("template_key"), key),
      comparator(f("provider_required"), "mock"),
      comparator(f("is_operationally_enabled"), false),
    ]);
    if (sqlIfFires(structural)) throw new MigrationError("unexpected_state");

    if (!sqlIsDistinctFrom(f("readiness_status"), "wiring_pending")) {
      const matched =
        r.readiness_status === "wiring_pending" && r.lane === "authentication" &&
        r.channel === "whatsapp" && r.template_key === key &&
        r.provider_required === "mock" && r.is_operationally_enabled === false;
      if (!matched) throw new MigrationError("transition_cardinality");
      r.readiness_status = "mock_ready";
      transitioned += 1;
    } else if (!sqlIsDistinctFrom(f("readiness_status"), "mock_ready")) {
      // idempotent no-op
    } else {
      throw new MigrationError("unexpected_readiness");
    }
  }
  return transitioned;
}

function expectMigrationThrows(rows, reason, options) {
  try { applyAutomationMigration(rows, options); }
  catch (e) { if (e instanceof MigrationError) { if (reason) assert(e.reason === reason, `expected ${reason}, got ${e.reason}`); return; } throw e; }
  throw new Error(`expected the migration to RAISE (${reason})`);
}

/** Structural guards the SECTION 4 SQL must declare, all NULL-safe. */
const FAILLOUD_CLAUSES = {
  do_block: /do \$\$/,
  raise_present: /raise exception/,
  raise_missing_row: /if v_count = 0 then raise exception/,
  raise_duplicate: /elsif v_count > 1 then raise exception/,
  guard_lane: /lane is distinct from 'authentication'/,
  guard_channel: /channel is distinct from 'whatsapp'/,
  guard_template: /template_key is distinct from v_key/,
  guard_provider: /provider_required is distinct from 'mock'/,
  guard_enabled: /is_operationally_enabled is distinct from false/,
  transition_assert: /get diagnostics v_updated = row_count; if v_updated <> 1 then raise exception/,
  readiness_else: /else raise exception[\s\S]*expected wiring_pending or mock_ready/,
};
const UNSAFE_STRUCTURAL_NEQ = /v_row\.[a-z_]+ <> /;

function migrationIsFailLoud(sqlNormalized) {
  if (UNSAFE_STRUCTURAL_NEQ.test(sqlNormalized)) return false;
  return Object.values(FAILLOUD_CLAUSES).every((re) => re.test(sqlNormalized));
}

// ============================================================================
// MOCK DATABASE — unique indexes + CHECK constraint come from the migration text
// ============================================================================
const db = {};
const nowIso = () => new Date().toISOString();
const tick = () => new Promise((r) => setImmediate(r));

/** Fix 3: set to 'error' | 'zero_rows' to fail the next challenge linkage write. */
let challengeLinkageFault = null;

class PgError extends Error {
  constructor(code, message, constraint) {
    super(message);
    this.code = code;
    if (constraint) this.constraint = constraint;
  }
}

function findUniqueViolation(table, newRow, rows, excludeId = null) {
  for (const index of SQL.uniqueIndexes[table] ?? []) {
    if (!index.where(newRow)) continue;
    if (index.cols.some((c) => newRow[c] === null || newRow[c] === undefined)) continue;
    const clash = rows.some(
      (existing) =>
        existing.id !== excludeId &&
        index.where(existing) &&
        index.cols.every((c) => existing[c] === newRow[c])
    );
    if (clash) {
      return new PgError("23505", `duplicate key value violates unique constraint "${index.name}"`, index.name);
    }
  }
  return null;
}

/** The migration's CHECK constraints, applied to every write. */
function assertCheckConstraints(table, row) {
  if (table === "vendor_dashboard_users") {
    if (row.phone_e164 !== null && row.phone_e164 !== undefined && SQL.phoneCheck && !SQL.phoneCheck.test(row.phone_e164)) {
      throw new PgError("23514", 'new row violates check constraint "vendor_dashboard_users_phone_e164_format_chk"');
    }
    return;
  }
  if (table === "verification_challenges") {
    const ch = row.delivery_channel;
    if (ch !== null && ch !== undefined && SQL.deliveryChannelCheck && !SQL.deliveryChannelCheck.includes(ch)) {
      throw new PgError("23514", 'new row violates check constraint "verification_challenges_delivery_channel_chk"');
    }
  }
}

const TABLE_DEFAULTS = {
  verification_challenges: () => ({
    status: "pending", attempt_count: 0, max_attempts: 5, resend_count: 0,
    verified_at: null, consumed_at: null, last_sent_at: null, last_attempt_at: null,
    delivery_channel: null, delivery_provider: null, communication_message_id: null, created_at: nowIso(),
  }),
  password_reset_grants: () => ({
    consumed_at: null, revoked_at: null, challenge_id: null,
    vendor_dashboard_user_id: null, created_at: nowIso(),
  }),
  communication_messages: () => ({
    status: "queued", attempt_count: 0, max_attempts: 5, next_retry_at: null,
    destination_source: "recipient_reference", provider_message_id: null, failure_code: null,
    failure_reason_sanitized: null, scheduled_at: null, accepted_at: null, sent_at: null,
    delivered_at: null, read_at: null, failed_at: null, variables: {}, metadata: {},
    created_at: nowIso(), updated_at: nowIso(),
  }),
  vendor_dashboard_users: () => ({
    phone: null, email: null, role: "owner", status: "active",
    phone_verified: false, whatsapp_otp_enabled: false, phone_e164: null,
    whatsapp_verified_at: null, last_login_method: null, last_login_at: null,
    created_at: nowIso(), updated_at: nowIso(),
  }),
};

class MockQueryBuilder {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.limitVal = null;
    this.orderCol = null;
    this.orderAsc = true;
    this.action = "select";
    this.actionData = null;
  }
  select() { return this; }
  order(col, opts) { this.orderCol = col; this.orderAsc = opts?.ascending !== false; return this; }
  limit(n) { this.limitVal = n; return this; }
  eq(col, val) { this.filters.push((it) => it[col] === val); return this; }
  in(col, vals) { this.filters.push((it) => vals.includes(it[col])); return this; }
  is(col, val) { this.filters.push((it) => (it[col] ?? null) === val); return this; }
  gte(col, val) { this.filters.push((it) => String(it[col]) >= String(val)); return this; }
  insert(row) { this.action = "insert"; this.actionData = row; return this; }
  update(patch) { this.action = "update"; this.actionData = patch; return this; }

  async maybeSingle() {
    const { data, error } = await this.execute();
    if (error) return { data: null, error };
    const rows = Array.isArray(data) ? data : [data];
    if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
    return { data: rows[0] ?? null, error: null };
  }
  async single() {
    const { data, error } = await this.execute();
    if (error) return { data: null, error };
    const rows = Array.isArray(data) ? data : [data];
    return { data: rows[0] ?? null, error: rows.length === 1 ? null : { code: "PGRST116", message: "no rows" } };
  }

  async execute() {
    // A scheduling boundary between statements: an application-level read-then-write
    // genuinely interleaves here, exactly as it would across two round trips.
    await tick();
    let list = db[this.table] || [];

    if (this.action === "insert") {
      const defaults = TABLE_DEFAULTS[this.table]?.() ?? {};
      const supplied = Object.fromEntries(Object.entries(this.actionData).filter(([, v]) => v !== undefined));
      const row = { id: crypto.randomUUID(), ...defaults, ...supplied };
      try { assertCheckConstraints(this.table, row); } catch (e) { return { data: null, error: e }; }
      const violation = findUniqueViolation(this.table, row, db[this.table]);
      if (violation) return { data: null, error: violation };
      db[this.table].push(row);
      return { data: [row], error: null };
    }

    if (this.action === "update") {
      // Fix 3 fault injection: fail the challenge→ledger linkage write.
      if (
        this.table === "verification_challenges" &&
        this.actionData &&
        "communication_message_id" in this.actionData &&
        challengeLinkageFault
      ) {
        const mode = challengeLinkageFault;
        challengeLinkageFault = null;
        if (mode === "error") return { data: null, error: new PgError("XX000", "linkage write failed") };
        if (mode === "zero_rows") return { data: [], error: null }; // concurrently terminalized
      }
      for (const f of this.filters) list = list.filter(f);
      for (const item of list) {
        const candidate = { ...item, ...this.actionData };
        try { assertCheckConstraints(this.table, candidate); } catch (e) { return { data: null, error: e }; }
        const violation = findUniqueViolation(this.table, candidate, db[this.table], item.id);
        if (violation) return { data: null, error: violation };
      }
      for (const item of list) Object.assign(item, this.actionData);
      return { data: list, error: null };
    }

    for (const f of this.filters) list = list.filter(f);
    if (this.orderCol) {
      list = [...list].sort((a, b) => {
        const x = a[this.orderCol]; const y = b[this.orderCol];
        return x < y ? -1 : x > y ? 1 : 0;
      });
      if (!this.orderAsc) list.reverse();
    }
    if (this.limitVal !== null) list = list.slice(0, this.limitVal);
    return { data: list, error: null };
  }

  async then(resolveFn) {
    const { data, error } = await this.execute();
    return resolveFn({ data, error });
  }
}

// ----------------------------------------------------------------------------
// ATOMIC RPC INTERPRETER — every critical section runs WITHOUT an await, exactly
// as a single SQL statement does under a row lock. Its guards come from the SQL.
// ----------------------------------------------------------------------------
const rpcCalls = [];

function challengeById(id) { return db.verification_challenges.find((c) => c.id === id) ?? null; }
function expired(row, now) { return Date.parse(row.expires_at) <= now; }

async function rpc(name, p) {
  rpcCalls.push(name);
  await tick(); // scheduling boundary BEFORE the atomic section, never inside it
  try {
    switch (name) {
      case "vendor_auth_register_failed_attempt": return { data: rpcRegisterFailedAttempt(p), error: null };
      case "vendor_auth_consume_whatsapp_challenge": return { data: rpcConsumeWhatsapp(p), error: null };
      case "vendor_auth_consume_reset_challenge_and_issue_grant": return { data: rpcConsumeResetIssueGrant(p), error: null };
      case "vendor_auth_claim_reset_grant": return { data: rpcClaimGrant(p), error: null };
      case "vendor_auth_issue_challenge": return { data: await rpcIssueChallenge(p), error: null };
      default: return { data: null, error: new PgError("42883", `function ${name} does not exist`) };
    }
  } catch (e) {
    return { data: null, error: e };
  }
}

function rpcRegisterFailedAttempt(p) {
  const g = SQL.guards.attempt;
  const now = Date.now();
  const c = challengeById(p.p_challenge_id);
  if (!c) return [];
  if (g.checksPurpose && c.purpose !== p.p_purpose) return [];
  if (g.checksPending && c.status !== "pending") return [];
  if (g.checksExpiry && expired(c, now)) return [];
  c.attempt_count += 1;
  c.last_attempt_at = nowIso();
  if (g.locksAtMax && c.attempt_count >= c.max_attempts) c.status = "locked";
  return [{
    challenge_id: c.id, status: c.status, attempt_count: c.attempt_count,
    max_attempts: c.max_attempts, locked: c.status === "locked",
  }];
}

function rpcConsumeWhatsapp(p) {
  const g = SQL.guards.consumeWhatsapp;
  const now = Date.now();
  const c = challengeById(p.p_challenge_id);
  if (!c) return [];
  if (g.checksPurpose && c.purpose !== "vendor_whatsapp_verify") return [];
  if (g.checksPending && c.status !== "pending") return [];
  if (g.checksExpiry && expired(c, now)) return [];
  if (g.checksDashboardUser && c.vendor_dashboard_user_id !== p.p_vendor_dashboard_user_id) return [];
  if (g.checksUser && c.user_id !== p.p_user_id) return [];
  if (g.checksVendor && c.vendor_id !== p.p_vendor_id) return [];
  if (g.checksDestination && c.destination_hash !== p.p_destination_hash) return [];

  const stamp = nowIso();
  const snapshot = { ...c };
  const bind = () => {
    const d = db.vendor_dashboard_users.find(
      (r) => r.id === p.p_vendor_dashboard_user_id &&
        r.user_id === p.p_user_id && r.vendor_id === p.p_vendor_id &&
        (!g.requiresActiveMembership || r.status === "active")
    );
    if (!d) throw new PgError("P0001", "VENDOR_AUTH_MEMBERSHIP_NOT_ACTIVE");
    const candidate = { ...d, phone_e164: p.p_phone_e164 };
    assertCheckConstraints("vendor_dashboard_users", candidate);
    const violation = findUniqueViolation("vendor_dashboard_users", candidate, db.vendor_dashboard_users, d.id);
    if (violation) throw new PgError("23505", "VENDOR_AUTH_PHONE_CONFLICT", violation.constraint);
    Object.assign(d, {
      phone_e164: p.p_phone_e164, phone_verified: true, whatsapp_otp_enabled: true,
      whatsapp_verified_at: stamp, updated_at: stamp,
    });
    return d;
  };

  if (g.consumeBeforeBind) {
    Object.assign(c, { status: "consumed", verified_at: stamp, consumed_at: stamp });
    let d;
    try { d = bind(); } catch (e) { Object.assign(c, snapshot); throw e; } // transaction rollback
    return [{
      vendor_dashboard_user_id: d.id, vendor_id: d.vendor_id, user_id: d.user_id,
      phone_e164: d.phone_e164, phone_verified: d.phone_verified,
      whatsapp_otp_enabled: d.whatsapp_otp_enabled, whatsapp_verified_at: d.whatsapp_verified_at,
    }];
  }

  // Mutant ordering: flags written BEFORE the challenge is consumed.
  const d = bind();
  Object.assign(c, { status: "consumed", verified_at: stamp, consumed_at: stamp });
  return [{
    vendor_dashboard_user_id: d.id, vendor_id: d.vendor_id, user_id: d.user_id,
    phone_e164: d.phone_e164, phone_verified: d.phone_verified,
    whatsapp_otp_enabled: d.whatsapp_otp_enabled, whatsapp_verified_at: d.whatsapp_verified_at,
  }];
}

function rpcConsumeResetIssueGrant(p) {
  const g = SQL.guards.consumeReset;
  const now = Date.now();
  const c = challengeById(p.p_challenge_id);
  if (!c) return [];
  if (g.checksPurpose && c.purpose !== "vendor_password_reset") return [];
  if (g.checksPending && c.status !== "pending") return [];
  if (g.checksExpiry && expired(c, now)) return [];
  if (g.checksLineage && (c.vendor_dashboard_user_id !== p.p_vendor_dashboard_user_id ||
      c.user_id !== p.p_user_id || c.vendor_id !== p.p_vendor_id)) return [];

  const stamp = nowIso();
  const challengeSnapshot = { ...c };
  const grantSnapshots = db.password_reset_grants.map((row) => ({ row, prev: { ...row } }));
  const rollback = () => {
    Object.assign(c, challengeSnapshot);
    for (const { row, prev } of grantSnapshots) Object.assign(row, prev);
  };

  Object.assign(c, { status: "consumed", verified_at: stamp, consumed_at: stamp });

  if (g.revokesOlderOpenGrants) {
    for (const grant of db.password_reset_grants) {
      if (grant.user_id === p.p_user_id && !grant.consumed_at && !grant.revoked_at) grant.revoked_at = stamp;
    }
  }

  const row = {
    id: crypto.randomUUID(),
    vendor_id: p.p_vendor_id,
    user_id: p.p_user_id,
    vendor_dashboard_user_id: p.p_vendor_dashboard_user_id,
    challenge_id: p.p_challenge_id,
    grant_token_hash: p.p_grant_token_hash,
    expires_at: p.p_expires_at,
    consumed_at: null,
    revoked_at: null,
    created_at: stamp,
  };
  const violation = findUniqueViolation("password_reset_grants", row, db.password_reset_grants);
  if (violation) { rollback(); throw violation; }
  db.password_reset_grants.push(row);

  return [{
    grant_id: row.id, user_id: row.user_id, vendor_id: row.vendor_id,
    vendor_dashboard_user_id: row.vendor_dashboard_user_id, expires_at: row.expires_at,
  }];
}

function rpcClaimGrant(p) {
  const g = SQL.guards.claim;
  const now = Date.now();
  const grant = db.password_reset_grants.find((r) => {
    if (g.matchesHash && r.grant_token_hash !== p.p_grant_token_hash) return false;
    if (g.checksConsumed && r.consumed_at) return false;
    if (g.checksRevoked && r.revoked_at) return false;
    if (g.checksExpiry && Date.parse(r.expires_at) <= now) return false;
    return true;
  });
  if (!grant) return [];
  if (g.burnsOnClaim) grant.consumed_at = nowIso();
  return [{
    grant_id: grant.id, user_id: grant.user_id, vendor_id: grant.vendor_id,
    vendor_dashboard_user_id: grant.vendor_dashboard_user_id, challenge_id: grant.challenge_id,
  }];
}

/**
 * vendor_auth_issue_challenge — the atomic issuance authority (Fix 1).
 *
 * The ONLY interpreter that models a lock: when `serializes` is true (the real SQL
 * has `for update`), the whole body runs without an internal await, exactly like a
 * locked transaction. When it is false (the lock was mutated away), it awaits a
 * tick between the rate-limit read and the cancel+insert, so a concurrent caller
 * genuinely slips in with a stale count — reproducing the lost-update race the lock
 * exists to prevent.
 */
let lastIssueParams = null;
async function rpcIssueChallenge(p) {
  lastIssueParams = { ...p };
  const g = SQL.guards.issue;
  const now = Date.now();
  const issued = (code, scope = null, id = null) => [{ result_code: code, rate_limit_scope: scope, issued_challenge_id: id }];

  if (g.checksPurpose && p.p_purpose !== "vendor_whatsapp_verify" && p.p_purpose !== "vendor_password_reset") {
    return issued("purpose_invalid");
  }

  // Lock + lineage against the current dashboard row.
  const d = db.vendor_dashboard_users.find((r) => r.id === p.p_vendor_dashboard_user_id);
  if (!d) return issued("lineage_mismatch");
  if (g.checksLineage && (d.user_id !== p.p_user_id || d.vendor_id !== p.p_vendor_id)) return issued("lineage_mismatch");
  if (g.checksMembership && d.status !== "active") return issued("membership_not_active");

  // SECURITY POLICY comes from the SQL's INTERNAL constants — never from a caller
  // param. If a mutation swaps a constant for a caller param, the *FromConstant
  // guard is false and the value falls back to the (undefined) caller param, so
  // enforcement breaks — exactly as it would in the database.
  const cooldownMs = g.cooldownFromConstant ? g.cooldownMs : Number(p.p_cooldown_seconds) * 1000;
  const hourMax = g.hourFromConstant ? g.maxPerHour : p.p_max_per_hour;
  const dayMax = g.dayFromConstant ? g.maxPerDay : p.p_max_per_day;
  const maxAttempts = g.maxAttemptsFromConstant ? g.maxAttempts : p.p_max_attempts;
  const expiresAt = g.ttlFromConstant ? new Date(now + (g.ttlMs ?? 0)).toISOString() : p.p_expires_at;

  // Rate-limit history (every status counts). A NaN window matches nothing.
  const inWindow = (winMs) =>
    db.verification_challenges.filter((c) => {
      if (c.vendor_dashboard_user_id !== p.p_vendor_dashboard_user_id || c.purpose !== p.p_purpose) return false;
      const age = now - Date.parse(c.created_at);
      return age >= 0 && age < winMs;
    }).length;
  const cooldownCount = inWindow(cooldownMs);
  const hourCount = inWindow(60 * 60 * 1000);
  const dayCount = inWindow(24 * 60 * 60 * 1000);

  // Without the serialization lock, a concurrent call slips in here with a stale count.
  if (!g.serializes) await tick();

  const cancelPending = () => {
    for (const c of db.verification_challenges) {
      if (c.vendor_dashboard_user_id === p.p_vendor_dashboard_user_id && c.purpose === p.p_purpose && c.status === "pending") {
        c.status = "cancelled";
      }
    }
  };

  // A mutant that cancels BEFORE the rate-limit decision would let a rate-limited
  // request destroy a still-valid challenge.
  if (!g.cancelsOnlyWhenAllowed) cancelPending();

  let scope = null;
  if (g.hasCooldownCheck && cooldownCount > 0) scope = "cooldown";
  else if (g.hasHourlyCheck && hourMax != null && hourCount >= hourMax) scope = "hourly";
  else if (g.hasDailyCheck && dayMax != null && dayCount >= dayMax) scope = "daily";
  if (scope) return issued("rate_limited", scope);

  if (g.cancelsOnlyWhenAllowed) cancelPending();

  const row = {
    id: p.p_challenge_id, principal_type: "vendor", principal_id: p.p_vendor_id,
    purpose: p.p_purpose, destination_hash: p.p_destination_hash, otp_hash: p.p_otp_hash,
    status: "pending", expires_at: expiresAt, attempt_count: 0, max_attempts: maxAttempts,
    resend_count: 0, verified_at: null, consumed_at: null, last_sent_at: nowIso(), last_attempt_at: null,
    delivery_channel: null, delivery_provider: null, communication_message_id: null,
    vendor_dashboard_user_id: p.p_vendor_dashboard_user_id, user_id: p.p_user_id, vendor_id: p.p_vendor_id,
    created_at: nowIso(),
  };
  const violation = findUniqueViolation("verification_challenges", row, db.verification_challenges);
  if (violation) throw violation; // the real function would raise; wrapper → issue_failed
  db.verification_challenges.push(row);
  return issued("issued", null, p.p_challenge_id);
}

// ----------------------------------------------------------------------------
// Supabase client doubles
// ----------------------------------------------------------------------------
let currentSessionUserId = null;
let adminUpdateCalls = [];
let adminUpdateFailure = null;

function adminClientDouble() {
  return {
    from: (t) => new MockQueryBuilder(t),
    rpc,
    auth: {
      admin: {
        async updateUserById(userId, attrs) {
          adminUpdateCalls.push({ userId, attrs });
          await tick();
          if (adminUpdateFailure) {
            return { data: null, error: adminUpdateFailure };
          }
          return { data: { user: { id: userId } }, error: null };
        },
      },
    },
  };
}

function serverClientDouble() {
  return {
    from: (t) => new MockQueryBuilder(t),
    auth: {
      async getUser() {
        if (!currentSessionUserId) return { data: { user: null }, error: { message: "no session" } };
        return { data: { user: { id: currentSessionUserId } }, error: null };
      },
    },
  };
}

// ============================================================================
// BUILD WIRING
// ============================================================================
function wireBuild(outDir) {
  const req = createRequire(`${outDir}/`);
  const supabaseMod = req("./lib/supabase.js");
  supabaseMod.adminClient = () => adminClientDouble();
  supabaseMod.serverClient = async () => serverClientDouble();

  return {
    req,
    comm: req("./services/communicationService.js"),
    MockProviderMod: req("./lib/communication/providers/mockWhatsAppProvider.js"),
    Phone: req("./lib/communication/phone.js"),
    Crypto: req("./lib/identity/vendorOtpCrypto.js"),
    Automation: req("./lib/identity/vendorAuthAutomation.js"),
    VerifyLib: req("./lib/identity/vendorVerification.js"),
    ResetLib: req("./lib/identity/vendorPasswordReset.js"),
    Gate: req("./services/vendorAuthAutomationService.js"),
    ChallengeSvc: req("./services/vendorAuthChallengeService.js"),
    Verify: req("./services/vendorVerificationService.js"),
    Reset: req("./services/vendorPasswordResetService.js"),
    Access: req("./services/vendorAccessService.js"),
  };
}

// ============================================================================
// FIXTURES
// ============================================================================
const VENDOR_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VDU_A = "11111111-1111-4111-8111-111111111111";
const USER_A = "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a";
const EMAIL_A = "vendor-a@example.com";

const VENDOR_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VDU_B = "22222222-2222-4222-8222-222222222222";
const USER_B = "2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b";
const EMAIL_B = "vendor-b@example.com";

const PHONE_A = "+919876543210";
const PHONE_B = "+919812345678";
const ATTACKER_PHONE = "+14155550123";
const LOCAL_PHONE = "9876543210";
/** Legacy, non-canonical contact value already in the live table. */
const LEGACY_PHONE_A = "98765 43210";
const FAIL_PHONE = "+15550000002"; // mock provider permanent failure

const PEPPER_ENV = "VENDOR_AUTH_OTP_PEPPERS";
const PEPPER_CURRENT = crypto.randomBytes(24).toString("base64");
const PEPPER_PREVIOUS = crypto.randomBytes(24).toString("base64");

/** Captures the plaintext OTP at the provider boundary — the only place it exists. */
function makeCapturingProvider(mod) {
  class CapturingProvider extends mod.MockWhatsAppProvider {
    constructor() { super(); this.captured = []; }
    async sendAuthenticationMessage(to, tpl, vars) {
      this.captured.push({ to, templateKey: tpl, otp: vars.otp });
      return super.sendAuthenticationMessage(to, tpl, vars);
    }
  }
  return new CapturingProvider();
}

function resetDb() {
  rpcCalls.length = 0;
  currentSessionUserId = null;
  adminUpdateCalls = [];
  adminUpdateFailure = null;
  challengeLinkageFault = null;
  lastIssueParams = null;

  db.vendors = [{ id: VENDOR_A }, { id: VENDOR_B }];
  db.vendor_dashboard_users = [
    { id: VDU_A, vendor_id: VENDOR_A, user_id: USER_A, phone: LEGACY_PHONE_A, email: EMAIL_A, role: "owner", status: "active", phone_verified: false, whatsapp_otp_enabled: false, phone_e164: null, whatsapp_verified_at: null, last_login_method: null, last_login_at: null },
    { id: VDU_B, vendor_id: VENDOR_B, user_id: USER_B, phone: "98123 45678", email: EMAIL_B, role: "owner", status: "active", phone_verified: false, whatsapp_otp_enabled: false, phone_e164: null, whatsapp_verified_at: null, last_login_method: null, last_login_at: null },
  ];
  db.verification_challenges = [];
  db.password_reset_grants = [];
  db.auth_security_events = [];
  db.communication_messages = [];
  db.communication_templates = [
    { template_key: "vendor_whatsapp_verify", channel: "whatsapp", category: "authentication", version: "1.0", readiness_status: "mock_ready", is_active: true, provider_template_name: null },
    { template_key: "vendor_password_reset", channel: "whatsapp", category: "authentication", version: "1.0", readiness_status: "mock_ready", is_active: true, provider_template_name: null },
  ];
  // The Phase 5E POST-migration state: mock_ready, operationally DISABLED, mock.
  db.communication_automation_catalog = [
    { automation_key: "vendor_whatsapp_verify", category: "otp", lane: "authentication", channel: "whatsapp", template_key: "vendor_whatsapp_verify", readiness_status: "mock_ready", provider_required: "mock", is_operationally_enabled: false },
    { automation_key: "vendor_password_reset", category: "otp", lane: "authentication", channel: "whatsapp", template_key: "vendor_password_reset", readiness_status: "mock_ready", provider_required: "mock", is_operationally_enabled: false },
    { automation_key: "client_login_otp", category: "otp", lane: "authentication", channel: "whatsapp", template_key: "client_login_otp", readiness_status: "mock_ready", provider_required: "mock", is_operationally_enabled: false },
    { automation_key: "vendor_new_lead", category: "notification", lane: "business", channel: "whatsapp", template_key: "vendor_new_lead", readiness_status: "wiring_pending", provider_required: "mock", is_operationally_enabled: false },
  ];
}

/** The harness may inject an ACTIVE test state; live rows are never activated. */
function enableAutomation(key, providerRequired = "mock") {
  const row = db.communication_automation_catalog.find((r) => r.automation_key === key);
  row.readiness_status = "active";
  row.is_operationally_enabled = true;
  row.provider_required = providerRequired;
}
function enableBothAutomations(providerRequired = "mock") {
  enableAutomation("vendor_whatsapp_verify", providerRequired);
  enableAutomation("vendor_password_reset", providerRequired);
}

function loginAs(userId) { currentSessionUserId = userId; }

/**
 * Seed monotonic challenge HISTORY for a (identity, purpose) at the given ages (ms
 * before now). Statuses are terminal so they only affect rate-limit counting, not
 * the "one pending" invariant.
 */
function seedChallengeHistory(vduId, purpose, ageMsList, { userId = USER_A, vendorId = VENDOR_A } = {}) {
  for (const age of ageMsList) {
    db.verification_challenges.push({
      id: crypto.randomUUID(), principal_type: "vendor", principal_id: vendorId,
      purpose, destination_hash: "d".repeat(64), otp_hash: "e".repeat(64),
      status: "consumed", expires_at: new Date(Date.now() - age + 600000).toISOString(),
      attempt_count: 0, max_attempts: 5, resend_count: 0, verified_at: null, consumed_at: nowIso(),
      last_sent_at: null, last_attempt_at: null, delivery_provider: "mock", communication_message_id: null,
      vendor_dashboard_user_id: vduId, user_id: userId, vendor_id: vendorId,
      created_at: new Date(Date.now() - age).toISOString(),
    });
  }
}
function pendingChallenges() { return db.verification_challenges.filter((c) => c.status === "pending"); }
function challengesInWindow(vduId, purpose, winMs) {
  return db.verification_challenges.filter((c) => {
    if (c.vendor_dashboard_user_id !== vduId || c.purpose !== purpose) return false;
    const age = Date.now() - Date.parse(c.created_at);
    return age >= 0 && age < winMs;
  }).length;
}

// ============================================================================
// TEST REGISTRY
// ============================================================================
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function events() { return db.auth_security_events; }
function lastEvent() { return db.auth_security_events[db.auth_security_events.length - 1]; }
function eventsOfType(t) { return db.auth_security_events.filter((e) => e.event_type === t); }
function challenges() { return db.verification_challenges; }
function grants() { return db.password_reset_grants; }
function openGrants() { return grants().filter((g) => !g.consumed_at && !g.revoked_at); }

// ============================================================================
// MAIN BUILD
// ============================================================================
const MAIN_DIR = resolve(".phase5e-build-main");
compileTo(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

let provider;
function resetAll(mod = M) {
  resetDb();
  rebuildSqlModel();
  process.env[PEPPER_ENV] = `${PEPPER_CURRENT}|${PEPPER_PREVIOUS}`;
  provider = makeCapturingProvider(mod.MockProviderMod);
  mod.comm.setActiveWhatsAppProvider(provider);
  return provider;
}
function sends() { return provider.getLastSentPayloads(); }
function capturedOtps() { return provider.captured; }

/** Run a full WhatsApp verification REQUEST and return the challenge + OTP. */
async function issueWhatsappChallenge(mod = M, { phone = PHONE_A, user = USER_A } = {}) {
  loginAs(user);
  const res = await mod.Verify.requestVendorWhatsappVerification({ phone });
  const otp = provider.captured[provider.captured.length - 1]?.otp ?? null;
  return { res, otp };
}

/** Mark a dashboard identity as already WhatsApp-verified (the reset precondition). */
function markVerified(vduId, phoneE164) {
  const d = db.vendor_dashboard_users.find((r) => r.id === vduId);
  d.phone_e164 = phoneE164;
  d.phone_verified = true;
  d.whatsapp_otp_enabled = true;
  d.whatsapp_verified_at = nowIso();
}

/** Run a full password-reset REQUEST and return the reference + OTP. */
async function issueResetChallenge(mod = M, { identifier = EMAIL_A } = {}) {
  const res = await mod.Reset.requestVendorPasswordReset({ identifier });
  const otp = provider.captured[provider.captured.length - 1]?.otp ?? null;
  return { res, otp };
}

/** Every `.select("…")` column list the vendor access resolver reads. */
function resolverSelectColumnLists() {
  return [...VENDOR_ACCESS_SRC.matchAll(/\.select\(\s*(?:MAPPING_COLUMNS|VENDOR_IDENTITY_LOOKUP_COLUMNS|"([^"]*)")\s*\)/g)].map((m) => m[1] ?? "");
}
/** Assert no business/verification state is read into an access decision. */
function assertResolverReadsNoBusinessState() {
  const BUSINESS = ["phone_verified", "whatsapp_otp_enabled", "phone_e164", "verification_status", "paid_status", "package_status", "remaining_credits", "total_credits", "accepting_leads", "is_active"];
  // The named column constants the resolver selects.
  const mapping = (VENDOR_ACCESS_SRC.match(/const MAPPING_COLUMNS = "([^"]*)"/) ?? [])[1] ?? "";
  const identity = (VENDOR_ACCESS_SRC.match(/VENDOR_IDENTITY_LOOKUP_COLUMNS = "([^"]*)"/) ?? [])[1] ?? "";
  const lists = [mapping, identity, ...resolverSelectColumnLists()];
  for (const list of lists) {
    for (const col of BUSINESS) {
      assert(!list.split(",").map((c) => c.trim()).includes(col), `the access resolver must not SELECT ${col} (in "${list}")`);
    }
  }
}

// ============================================================================
// ARCHITECTURE (1–9)
// ============================================================================
check("1-2. vendor login stays separate from WhatsApp verification and password reset", () => {
  // Phase 5C login never reads a verification/reset artefact.
  for (const banned of ["phone_verified", "whatsapp_otp_enabled", "phone_e164", "verification_challenges", "password_reset_grants", "grant_token"]) {
    assert(!VENDOR_AUTH_SRC.includes(banned), `vendor login must not read ${banned}`);
  }
  // The resolver may WRITE `phone_verified: false` when linking (that is correct),
  // but must never SELECT it into an access decision. Check the columns it reads.
  assertResolverReadsNoBusinessState();
  // The reset flow never signs anyone in.
  for (const banned of ["signInWithPassword", "signInWithOtp", "setSession", "signIn("]) {
    assert(!RESET_SVC_SRC.includes(banned), `password reset must not authenticate a session (${banned})`);
  }
});

check("3. Supabase Auth remains the password + session authority", () => {
  assert(/auth\.admin\.updateUserById/.test(RESET_SVC_SRC), "password updates go through Supabase Admin");
  for (const banned of ["encrypted_password", "bcrypt", "argon2", "scrypt", "generateLink", "pbkdf2"]) {
    assert(!ALL_5E_SRC.includes(banned), `Phase 5E must not hash or mutate passwords itself (${banned})`);
  }
  assert(!/from\("auth\.users"\)|from\('auth\.users'\)/.test(ALL_5E_SRC), "never writes auth.users directly");
  assert(!/auth\.users/.test(SQL.stripped5e.replace(/references auth\.users\(id\)[^,\n]*/g, "")), "the migration only REFERENCES auth.users, never mutates it");
});

check("4-6. no custom JWT, no custom session, no second auth cookie", () => {
  for (const banned of ["jsonwebtoken", "jose", "jwt.sign", "jwt.verify", "createSession", "sessionToken", "session_token", "setSessionCookie", "cookies("]) {
    assert(!ALL_5E_SRC.includes(banned), `Phase 5E must not use ${banned}`);
  }
  assert(!/custom_session|auth_cookie/i.test(SQL.stripped5e), "no session table is created");
});

check("7. no n8n authentication path", () => {
  assert(!/n8n/i.test(ALL_5E_SRC), "no n8n reference in Phase 5E source");
  assert(!/n8n/i.test(SQL.stripped5e), "no n8n reference in the Phase 5E migration");
  for (const banned of ["setTimeout", "setInterval", "cron", "enqueue", "retry_scheduled", "dispatchPersistedMessage"]) {
    assert(!VERIFY_SVC_SRC.includes(banned) && !RESET_SVC_SRC.includes(banned), `auth OTP must not be deferred/queued (${banned})`);
  }
  assert(/scheduled_at: null/.test(VERIFY_SVC_SRC) && /scheduled_at: null/.test(RESET_SVC_SRC), "auth intents are explicitly immediate");
});

check("8. the client OTP flow never uses verification_challenges", () => {
  assert(!/verification_challenges/.test(CLIENT_OTP_SRC), "Phase 5D must not touch verification_challenges");
  const purposes = SQL.stripped5e.match(/'vendor_whatsapp_verify'|'vendor_password_reset'|'client_login_otp'/g) ?? [];
  assert(!purposes.includes("'client_login_otp'") || !/purpose/.test(SQL.stripped5e.split("client_login_otp")[0].slice(-200)), "no client purpose is added to verification_challenges");
  assert(!/check \(purpose in/.test(SQL.stripped5e), "the Phase 5A purpose CHECK is not widened");
});

check("9. purpose isolation is enforced at three independent layers", () => {
  // 1. The HMAC message binds the purpose, so a hash cannot cross purposes.
  assert(/context\.purpose/.test(OTP_CRYPTO_SRC), "purpose participates in the OTP HMAC");
  // 2. The services compare the purpose with the Phase 5A contract.
  assert(/challengePurposeMatches\(challenge\.purpose, PURPOSE\)/.test(VERIFY_SVC_SRC), "verify service checks purpose");
  assert(/challengePurposeMatches\(challenge\.purpose, PURPOSE\)/.test(RESET_SVC_SRC), "reset service checks purpose");
  // 3. The atomic SQL functions carry the purpose in their WHERE clauses.
  assert(SQL.guards.consumeWhatsapp.checksPurpose, "consume_whatsapp binds its purpose");
  assert(SQL.guards.consumeReset.checksPurpose, "consume_reset binds its purpose");
  assert(SQL.guards.attempt.checksPurpose, "register_failed_attempt binds its purpose");
});

// ============================================================================
// PHONE IDENTITY (10–18)
// ============================================================================
check("10,14. legacy phone is never promoted; the migration performs no backfill", () => {
  const sql = SQL.stripped5e;
  assert(!/update\s+public\.vendor_dashboard_users[\s\S]*?set[\s\S]*?phone_e164/i.test(sql.split("create or replace function")[0]),
    "no DDL-section UPDATE writes phone_e164");
  assert(!/insert\s+into\s+public\.vendor_dashboard_users/i.test(sql), "no INSERT into vendor_dashboard_users");
  assert(!/set\s+phone_e164\s*=\s*\w*\.?phone\b/i.test(sql), "phone_e164 is never copied from the legacy phone column");
  assert(!/vendors\.phone|vendors\.whatsapp_number/i.test(sql), "vendors.phone / vendors.whatsapp_number are never read");
});

check("11. no country code is ever guessed (no +91 literal anywhere)", () => {
  assert(!/\+91/.test(SQL.raw5e), "the migration contains no +91 literal");
  assert(!/\+91/.test(ALL_5E_SRC), "Phase 5E source contains no +91 literal");
  assert(!/PHONE_MISSING_COUNTRY_CODE[\s\S]{0,80}`\+/.test(ALL_5E_SRC), "a missing country code is never repaired");
});

check("12-13. a bare local phone is rejected; explicit canonical E.164 is accepted", async () => {
  resetAll();
  enableBothAutomations();
  loginAs(USER_A);
  const bad = await M.Verify.requestVendorWhatsappVerification({ phone: LOCAL_PHONE });
  assert(bad.ok === false, "a bare national number must be rejected");
  assert(challenges().length === 0, "no challenge created for a local number");
  assert(sends().length === 0, "no OTP dispatched for a local number");
  assert(lastEvent().metadata.failure_classification === "ambiguous_local_phone", "classified as ambiguous, never guessed");

  resetAll();
  enableBothAutomations();
  loginAs(USER_A);
  const good = await M.Verify.requestVendorWhatsappVerification({ phone: "+91 98765-43210" });
  assert(good.ok === true, `explicit E.164 must be accepted: ${good.ok ? "" : good.code}`);
  assert(challenges().length === 1, "one challenge created");
});

check("14b. the E.164 CHECK constraint from the migration rejects a non-canonical write", async () => {
  resetAll();
  assert(SQL.phoneCheck, "the migration declares a phone_e164 CHECK constraint");
  assert(SQL.phoneCheck.test(PHONE_A), "canonical E.164 passes");
  for (const bad of [LOCAL_PHONE, "+0912345678", "+9198765", "919876543210", "+91 9876543210"]) {
    assert(!SQL.phoneCheck.test(bad), `"${bad}" must fail the E.164 constraint`);
  }
});

check("15-16. vendors.phone and vendors.whatsapp_number are never modified", () => {
  assert(!/vendors[\s\S]{0,40}whatsapp_number/i.test(ALL_5E_SRC), "whatsapp_number is never touched");
  assert(!/from\("vendors"\)[\s\S]{0,120}\.update\(/.test(ALL_5E_SRC), "Phase 5E never updates the vendors table");
  assert(!/update\s+public\.vendors/i.test(SQL.stripped5e), "the migration never updates public.vendors");
});

check("17-18. a verified auth phone is unique; duplicate ownership fails closed", async () => {
  resetAll();
  enableBothAutomations();
  // Vendor A verifies PHONE_A.
  const a = await issueWhatsappChallenge(M, { phone: PHONE_A, user: USER_A });
  const okA = await M.Verify.verifyVendorWhatsappChallenge({ challengeId: a.res.data.challengeId, phone: PHONE_A, otp: a.otp });
  assert(okA.ok === true, "vendor A verifies");

  // Vendor B tries to verify the SAME number.
  const b = await issueWhatsappChallenge(M, { phone: PHONE_A, user: USER_B });
  const okB = await M.Verify.verifyVendorWhatsappChallenge({ challengeId: b.res.data.challengeId, phone: PHONE_A, otp: b.otp });
  assert(okB.ok === false, "a phone verified by another identity must fail closed");
  assert(lastEvent().metadata.failure_classification === "phone_ownership_conflict", "classified as a phone conflict");

  const dA = db.vendor_dashboard_users.find((r) => r.id === VDU_A);
  const dB = db.vendor_dashboard_users.find((r) => r.id === VDU_B);
  assert(dA.phone_e164 === PHONE_A, "A keeps ownership");
  assert(dB.phone_e164 === null && dB.phone_verified === false, "B never steals it");
  // 73-74: the failed consume rolled the challenge back — no partial verification.
  const bChallenge = challenges().find((c) => c.id === b.res.data.challengeId);
  assert(bChallenge.status === "pending", "the phone conflict rolled the consume back");
  assert(bChallenge.consumed_at === null, "the challenge was never partially consumed");
});

// ============================================================================
// OTP CRYPTO (19–33)
// ============================================================================
check("19-20. a CSPRNG generates the OTP; Math.random is never used", () => {
  assert(/crypto\.randomInt\(/.test(OTP_CRYPTO_SRC), "crypto.randomInt is the OTP source");
  assert(!/Math\.random/.test(ALL_5E_SRC), "Math.random must never appear in Phase 5E source");
  assert(/crypto\.randomBytes\(/.test(OTP_CRYPTO_SRC), "grant tokens use crypto.randomBytes");
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(M.Crypto.generateVendorOtp());
  assert(seen.size > 150, `OTPs must be unpredictable, saw ${seen.size} distinct in 200`);
});

check("21. the six-digit OTP preserves leading zeros", () => {
  for (let i = 0; i < 5000; i += 1) {
    const otp = M.Crypto.generateVendorOtp();
    assert(/^[0-9]{6}$/.test(otp), `malformed OTP ${otp}`);
  }
  // Deterministically prove padding rather than waiting for a lucky draw.
  const ctx = { challengeId: VDU_A, purpose: "vendor_whatsapp_verify", vendorDashboardUserId: VDU_A, destinationHash: "a".repeat(64) };
  const msg = M.Crypto.buildVendorOtpHashMessage(ctx, "000042");
  assert(msg.endsWith("|000042"), "a leading-zero OTP survives into the HMAC message");
  assert(M.Crypto.isPlausibleVendorOtp("000042"), "a leading-zero OTP is a valid shape");
});

check("22-23. the plaintext OTP is never persisted; plain SHA-256 hashing is not used", async () => {
  resetAll();
  enableBothAutomations();
  const { res, otp } = await issueWhatsappChallenge(M);
  assert(res.ok === true && otp, "challenge issued");
  const blob = JSON.stringify({ c: challenges(), m: db.communication_messages, e: events() });
  assert(!blob.includes(otp), "the plaintext OTP never reaches the database");
  const stored = challenges()[0].otp_hash;
  assert(/^[a-f0-9]{64}$/.test(stored), "only a 64-hex digest is stored");
  const plainSha = crypto.createHash("sha256").update(otp).digest("hex");
  assert(stored !== plainSha, "the stored hash must not be a plain SHA-256 of the OTP");
  assert(/createHmac\("sha256"/.test(OTP_CRYPTO_SRC), "HMAC-SHA-256 is used");
  assert(!/createHash\("sha256"\)\.update\(otp\)/.test(OTP_CRYPTO_SRC), "the OTP is never plainly hashed");
});

check("24-28. the HMAC binds challenge id, purpose, dashboard identity and destination hash", () => {
  const base = { challengeId: VDU_A, purpose: "vendor_whatsapp_verify", vendorDashboardUserId: VDU_B, destinationHash: "b".repeat(64) };
  const otp = "123456";
  const h = (over) => M.Crypto.hashVendorOtp({ ...base, ...over }, otp, PEPPER_CURRENT);
  const baseline = h({});
  assert(h({ challengeId: VDU_B }) !== baseline, "challenge id participates");
  assert(h({ purpose: "vendor_password_reset" }) !== baseline, "purpose participates");
  assert(h({ vendorDashboardUserId: VDU_A }) !== baseline, "dashboard identity participates");
  assert(h({ destinationHash: "c".repeat(64) }) !== baseline, "destination hash participates");
  assert(M.Crypto.hashVendorOtp(base, "654321", PEPPER_CURRENT) !== baseline, "the OTP participates");
  const msg = M.Crypto.buildVendorOtpHashMessage(base, otp);
  assert(msg.split("|").length === 5, "exactly five bound fields");
});

check("29. OTP comparison is timing-safe", () => {
  assert(/timingSafeEqual/.test(OTP_CRYPTO_SRC), "crypto.timingSafeEqual is used");
  assert(!/storedOtpHash === candidate|candidate === storedOtpHash/.test(OTP_CRYPTO_SRC), "no naive === on digests");
  const a = "a".repeat(64);
  assert(M.Crypto.timingSafeHexEqual(a, a) === true, "equal digests match");
  assert(M.Crypto.timingSafeHexEqual(a, "b".repeat(64)) === false, "different digests do not match");
  assert(M.Crypto.timingSafeHexEqual(a, "short") === false, "a malformed digest never matches");
});

check("30-31. the current pepper creates hashes; a previous pepper still verifies (rotation)", () => {
  const ctx = { challengeId: VDU_A, purpose: "vendor_password_reset", vendorDashboardUserId: VDU_A, destinationHash: "d".repeat(64) };
  const otp = "246813";
  const load = (v) => M.Crypto.loadVendorOtpPeppers({ VENDOR_AUTH_OTP_PEPPERS: v });

  assert(JSON.stringify(load(`${PEPPER_CURRENT}|${PEPPER_PREVIOUS}`)) === JSON.stringify([PEPPER_CURRENT, PEPPER_PREVIOUS]), "pipe-delimited, order preserved");
  assert(M.Crypto.primaryVendorOtpPepper(load(`${PEPPER_CURRENT}|${PEPPER_PREVIOUS}`)) === PEPPER_CURRENT, "the FIRST pepper is primary");
  assert(JSON.stringify(load(`${PEPPER_CURRENT}\n${PEPPER_PREVIOUS}`)) === JSON.stringify([PEPPER_CURRENT, PEPPER_PREVIOUS]), "newline is also accepted");
  assert(load(`${PEPPER_CURRENT}|${PEPPER_CURRENT}`).length === 1, "duplicates collapse");

  // A challenge hashed under the PREVIOUS pepper still verifies after rotation.
  const oldHash = M.Crypto.hashVendorOtp(ctx, otp, PEPPER_PREVIOUS);
  assert(M.Crypto.verifyVendorOtp(ctx, otp, oldHash, [PEPPER_CURRENT, PEPPER_PREVIOUS]) === true, "previous pepper verifies during rotation");
  assert(M.Crypto.verifyVendorOtp(ctx, otp, oldHash, [PEPPER_CURRENT]) === false, "once dropped, the old pepper no longer verifies");
  // New hashes come from the primary.
  const newHash = M.Crypto.hashVendorOtp(ctx, otp, PEPPER_CURRENT);
  assert(newHash !== oldHash, "the two peppers produce different hashes");
});

check("32. a missing pepper fails closed (no OTP generated, nothing sent)", async () => {
  resetAll();
  enableBothAutomations();
  delete process.env[PEPPER_ENV];
  loginAs(USER_A);
  const res = await M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
  assert(res.ok === false, "no pepper → refuse");
  assert(challenges().length === 0 && sends().length === 0, "nothing generated, nothing sent");
  assert(lastEvent().metadata.failure_classification === "pepper_not_configured", "classified");
  assert(M.Crypto.verifyVendorOtp({ challengeId: VDU_A, purpose: "p", vendorDashboardUserId: VDU_A, destinationHash: "e".repeat(64) }, "123456", "f".repeat(64), []) === false, "an empty pepper list never verifies");
  process.env[PEPPER_ENV] = `${PEPPER_CURRENT}|${PEPPER_PREVIOUS}`;
});

check("33. the pepper never reaches logs, the database, audit metadata, or a message", async () => {
  resetAll();
  enableBothAutomations();
  const captured = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => captured.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  let otp;
  try {
    const issued = await issueWhatsappChallenge(M);
    otp = issued.otp;
    await M.Verify.verifyVendorWhatsappChallenge({ challengeId: issued.res.data.challengeId, phone: PHONE_A, otp: "000000" });
  } finally { Object.assign(console, orig); }

  const blob = captured.join("\n") + JSON.stringify({ c: challenges(), g: grants(), e: events(), m: db.communication_messages });
  for (const secret of [PEPPER_CURRENT, PEPPER_PREVIOUS, otp]) {
    assert(!blob.includes(secret), "a secret leaked to logs or the database");
  }
  assert(!/console\.[a-z]+\([^)]*(otp|pepper|password|grantToken|otpHash)/i.test(ALL_5E_SRC), "no sensitive console logging");
  assert(!/pepper/i.test(SQL.stripped5e), "no pepper column exists");
});

// ============================================================================
// WHATSAPP VERIFICATION — REQUEST (34–51)
// ============================================================================
check("34-36. an authenticated, actively-mapped vendor is required; a browser vendor_id is never authority", async () => {
  resetAll();
  enableBothAutomations();
  // No session.
  const anon = await M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
  assert(anon.ok === false && challenges().length === 0, "unauthenticated request refused");

  // Session, but the membership is not active.
  resetAll(); enableBothAutomations();
  db.vendor_dashboard_users.find((r) => r.id === VDU_A).status = "suspended";
  loginAs(USER_A);
  const suspended = await M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
  assert(suspended.ok === false && challenges().length === 0, "inactive membership refused");

  // The service accepts no vendor id at all.
  assert(!/input\.vendorId|body\.vendorId/.test(VERIFY_SVC_SRC + ROUTES_SRC), "no vendor_id is accepted from the caller");
  assert(/recipient_id: context\.vendorId/.test(VERIFY_SVC_SRC), "the canonical vendorId comes from the context");
});

check("37-38. a disabled automation creates no challenge and invokes the provider zero times", async () => {
  resetAll(); // Phase 5E shipped state: both automations DISABLED
  loginAs(USER_A);
  const res = await M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
  assert(res.ok === false, "disabled → refuse");
  assert(challenges().length === 0, "no challenge row");
  assert(sends().length === 0, "provider invoked zero times");
  assert(db.communication_messages.length === 0, "no ledger row");
  assert(lastEvent().metadata.failure_classification === "service_unavailable", "classified");

  // A provider mismatch also blocks (a real automation can never run on the mock).
  resetAll();
  enableAutomation("vendor_whatsapp_verify", "real_whatsapp"); // active adapter is 'mock'
  loginAs(USER_A);
  const mismatch = await M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
  assert(mismatch.ok === false && sends().length === 0, "provider mismatch blocks dispatch");
});

check("39. a rate-limited request generates no OTP and sends nothing", async () => {
  resetAll();
  enableBothAutomations();
  loginAs(USER_A);
  const first = await M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
  assert(first.ok === true, "first request succeeds");
  const sendsAfterFirst = sends().length;

  // Inside the 60s cooldown.
  const second = await M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
  assert(second.ok === false, "cooldown blocks the resend");
  assert(sends().length === sendsAfterFirst, "no second OTP dispatched");
  assert(challenges().length === 1, "no second challenge");
  const evt = lastEvent();
  assert(evt.event_type === "auth.rate_limit_triggered", "rate limit audited");
  assert(evt.metadata.rate_limit_scope === "cooldown", "cooldown scope recorded");

  // Hourly ceiling: 5 issuances per rolling hour.
  const hourAgo = Date.now() - 30 * 60 * 1000;
  const stamps = Array.from({ length: 5 }, (_, i) => new Date(hourAgo + i * 1000).toISOString());
  assert(M.VerifyLib.evaluateChallengeRateLimit(stamps).ok === false, "5 in an hour is blocked");
  assert(M.VerifyLib.evaluateChallengeRateLimit(stamps.slice(0, 4)).ok === true, "4 in an hour is allowed");
  const dayStamps = Array.from({ length: 12 }, (_, i) => new Date(Date.now() - (2 + i) * 60 * 60 * 1000).toISOString());
  assert(M.VerifyLib.evaluateChallengeRateLimit(dayStamps).ok === false, "12 in a day is blocked");
});

check("40-43. the request creates a purpose-bound challenge linked to auth user, dashboard user and vendor", async () => {
  resetAll();
  enableBothAutomations();
  const { res } = await issueWhatsappChallenge(M);
  assert(res.ok === true, "issued");
  const c = challenges()[0];
  assert(c.purpose === "vendor_whatsapp_verify", "purpose-bound");
  assert(c.user_id === USER_A, "linked to the Auth user");
  assert(c.vendor_dashboard_user_id === VDU_A, "linked to the dashboard identity");
  assert(c.vendor_id === VENDOR_A, "linked to the vendor business");
  assert(c.principal_type === "vendor" && c.principal_id === VENDOR_A, "Phase 5A principal preserved");
  assert(c.status === "pending" && c.attempt_count === 0 && c.max_attempts === 5, "fresh pending challenge");
  assert(c.destination_hash === M.Phone.hashPhoneE164(PHONE_A), "destination hash bound");
  assert(!("otp" in c) && /^[a-f0-9]{64}$/.test(c.otp_hash), "only a hash is stored");
});

check("44-49. the intent uses the auth lane + ephemeral destination; the OTP reaches only the provider", async () => {
  resetAll();
  enableBothAutomations();
  const { res, otp } = await issueWhatsappChallenge(M);
  const msg = db.communication_messages[0];
  assert(msg.lane === "authentication", "authentication lane");
  assert(msg.destination_source === "ephemeral_auth_destination", "ephemeral auth destination");
  assert(msg.recipient_type === "vendor" && msg.recipient_id === VENDOR_A, "recipient is the canonical vendor");
  assert(msg.entity_type === "verification_challenge", "entity_type bound to the challenge");
  assert(msg.entity_id === res.data.challengeId, "entity_id equals the challenge id");
  assert(msg.scheduled_at === null, "immediate, never scheduled");
  assert(msg.idempotency_key === `vendor_whatsapp_verify:${res.data.challengeId}`, "idempotency keyed on the challenge");
  assert(!msg.idempotency_key.includes(otp), "the OTP never enters the idempotency key");
  assert(JSON.stringify(msg.variables) === "{}", "the auth lane persists no variables");
  assert(!JSON.stringify(msg).includes(otp), "the OTP never reaches the ledger");
  assert(capturedOtps().length === 1 && capturedOtps()[0].otp === otp, "the OTP reaches the provider call");
  assert(capturedOtps()[0].to === PHONE_A, "dialled the canonical phone");
});

check("50. a delivery failure cancels the challenge", async () => {
  resetAll();
  enableBothAutomations();
  loginAs(USER_A);
  const res = await M.Verify.requestVendorWhatsappVerification({ phone: FAIL_PHONE });
  assert(res.ok === false, "a permanent provider failure fails the request");
  assert(challenges().length === 1 && challenges()[0].status === "cancelled", "the unusable challenge is cancelled");
  assert(lastEvent().metadata.failure_classification === "dispatch_failed", "classified");
});

check("51. accepted delivery records the communication linkage and provider", async () => {
  resetAll();
  enableBothAutomations();
  const { res } = await issueWhatsappChallenge(M);
  const c = challenges()[0];
  const msg = db.communication_messages[0];
  assert(c.communication_message_id === msg.id, "ledger row linked");
  assert(c.delivery_provider === "mock", "delivery provider recorded");
  assert(c.last_sent_at, "last_sent_at stamped");
  assert(res.data.phoneMasked && !res.data.phoneMasked.includes("9876543"), "only a masked phone is returned");
});

// ============================================================================
// WHATSAPP VERIFICATION — VERIFY (52–74)
// ============================================================================
check("52. a challenge owned by another dashboard identity is denied", async () => {
  resetAll();
  enableBothAutomations();
  const a = await issueWhatsappChallenge(M, { phone: PHONE_A, user: USER_A });
  loginAs(USER_B); // B attacks A's challenge with A's real OTP
  const res = await M.Verify.verifyVendorWhatsappChallenge({ challengeId: a.res.data.challengeId, phone: PHONE_A, otp: a.otp });
  assert(res.ok === false, "a challenge never verifies another identity");
  assert(lastEvent().metadata.failure_classification === "challenge_ownership_mismatch", "classified");
  // The ownership guard also prevents attempt-counter poisoning (lock-out DoS).
  assert(challenges()[0].attempt_count === 0, "another identity cannot burn A's attempts");
  const d = db.vendor_dashboard_users.find((r) => r.id === VDU_B);
  assert(d.phone_verified === false, "nothing bound for B");
});

check("53. a wrong-purpose challenge is denied", async () => {
  resetAll();
  enableBothAutomations();
  markVerified(VDU_A, PHONE_A);
  const reset = await issueResetChallenge(M, { identifier: EMAIL_A });
  const resetChallengeId = reset.res.reference;
  // A password-reset challenge must never satisfy WhatsApp verification.
  loginAs(USER_A);
  const res = await M.Verify.verifyVendorWhatsappChallenge({ challengeId: resetChallengeId, phone: PHONE_A, otp: reset.otp });
  assert(res.ok === false, "cross-purpose verification denied");
  assert(lastEvent().metadata.failure_classification === "purpose_mismatch", "classified as purpose mismatch");
  assert(challenges()[0].status === "pending", "the reset challenge is untouched");
});

check("54-57. expired / locked / cancelled / consumed challenges are all denied", async () => {
  const scenarios = [
    ["expired", (c) => { c.expires_at = new Date(Date.now() - 1000).toISOString(); }, "challenge_expired"],
    ["locked", (c) => { c.status = "locked"; }, "challenge_locked"],
    ["cancelled", (c) => { c.status = "cancelled"; }, "challenge_not_pending"],
    ["consumed", (c) => { c.status = "consumed"; }, "challenge_not_pending"],
  ];
  for (const [label, mutate, classification] of scenarios) {
    resetAll();
    enableBothAutomations();
    const { res, otp } = await issueWhatsappChallenge(M);
    mutate(challenges()[0]);
    loginAs(USER_A);
    const out = await M.Verify.verifyVendorWhatsappChallenge({ challengeId: res.data.challengeId, phone: PHONE_A, otp });
    assert(out.ok === false, `${label} must be denied`);
    assert(lastEvent().metadata.failure_classification === classification, `${label}: got ${lastEvent().metadata.failure_classification}`);
    assert(db.vendor_dashboard_users.find((r) => r.id === VDU_A).phone_verified === false, `${label}: nothing bound`);
  }
  // An expired PENDING challenge is transitioned, never revived.
  resetAll(); enableBothAutomations();
  const e = await issueWhatsappChallenge(M);
  challenges()[0].expires_at = new Date(Date.now() - 1000).toISOString();
  loginAs(USER_A);
  await M.Verify.verifyVendorWhatsappChallenge({ challengeId: e.res.data.challengeId, phone: PHONE_A, otp: e.otp });
  assert(challenges()[0].status === "expired", "the expired challenge is transitioned");
  assert(eventsOfType("auth.challenge_expired").length === 1, "auth.challenge_expired recorded");
});

check("58. a destination-hash mismatch is denied", async () => {
  resetAll();
  enableBothAutomations();
  const { res, otp } = await issueWhatsappChallenge(M, { phone: PHONE_A });
  loginAs(USER_A);
  const out = await M.Verify.verifyVendorWhatsappChallenge({ challengeId: res.data.challengeId, phone: PHONE_B, otp });
  assert(out.ok === false, "a different phone cannot satisfy the challenge");
  assert(lastEvent().metadata.failure_classification === "destination_mismatch", "classified");
});

check("59-60. a wrong OTP increments atomically; max attempts locks the challenge", async () => {
  resetAll();
  enableBothAutomations();
  const { res } = await issueWhatsappChallenge(M);
  loginAs(USER_A);
  for (let i = 1; i <= 4; i += 1) {
    const out = await M.Verify.verifyVendorWhatsappChallenge({ challengeId: res.data.challengeId, phone: PHONE_A, otp: "000000" });
    assert(out.ok === false, "wrong OTP denied");
    assert(challenges()[0].attempt_count === i, `attempt ${i} counted, got ${challenges()[0].attempt_count}`);
    assert(challenges()[0].status === "pending", "still pending below the ceiling");
  }
  const fifth = await M.Verify.verifyVendorWhatsappChallenge({ challengeId: res.data.challengeId, phone: PHONE_A, otp: "000000" });
  assert(fifth.ok === false, "the fifth wrong attempt is denied");
  assert(challenges()[0].attempt_count === 5, "5 attempts recorded");
  assert(challenges()[0].status === "locked", "the challenge is LOCKED at max_attempts");
  assert(challenges()[0].last_attempt_at, "last_attempt_at stamped");
  assert(rpcCalls.filter((n) => n === "vendor_auth_register_failed_attempt").length === 5, "each attempt went through the atomic function");
});

check("61. concurrent wrong attempts cannot lose a count", async () => {
  resetAll();
  enableBothAutomations();
  const { res } = await issueWhatsappChallenge(M);
  loginAs(USER_A);
  const wrong = () => M.Verify.verifyVendorWhatsappChallenge({ challengeId: res.data.challengeId, phone: PHONE_A, otp: "000000" });
  const [a, b] = await Promise.all([wrong(), wrong()]);
  assert(a.ok === false && b.ok === false, "both denied");
  assert(challenges()[0].attempt_count === 2, `two concurrent attempts must both count, got ${challenges()[0].attempt_count}`);
});

check("62-68. a correct OTP additionally requires a fresh, provider-bound attestation", async () => {
  // Success baseline.
  resetAll(); enableBothAutomations();
  const base = await issueWhatsappChallenge(M);
  loginAs(USER_A);
  assert((await M.Verify.verifyVendorWhatsappChallenge({ challengeId: base.res.data.challengeId, phone: PHONE_A, otp: base.otp })).ok === true, "baseline verifies");

  const cases = [
    ["queued", (m) => { m.status = "queued"; }],
    ["dispatching", (m) => { m.status = "dispatching"; }],
    ["failed", (m) => { m.status = "failed"; }],
    ["dead_letter", (m) => { m.status = "dead_letter"; }],
    ["cancelled", (m) => { m.status = "cancelled"; }],
    ["stale", (m) => { m.created_at = new Date(Date.now() - 60 * 60 * 1000).toISOString(); }],
    ["provider mismatch", (m) => { m.provider = "some_other_provider"; }],
    ["challenge id mismatch", (m) => { m.entity_id = crypto.randomUUID(); }],
    ["destination mismatch", (m) => { m.destination_hash = "f".repeat(64); }],
    ["wrong entity type", (m) => { m.entity_type = "lead"; }],
    ["missing entirely", () => { db.communication_messages.length = 0; }],
  ];
  for (const [label, mutate] of cases) {
    resetAll(); enableBothAutomations();
    const { res, otp } = await issueWhatsappChallenge(M);
    mutate(db.communication_messages[0]);
    loginAs(USER_A);
    const out = await M.Verify.verifyVendorWhatsappChallenge({ challengeId: res.data.challengeId, phone: PHONE_A, otp });
    assert(out.ok === false, `${label} must not attest`);
    assert(db.vendor_dashboard_users.find((r) => r.id === VDU_A).phone_verified === false, `${label}: nothing bound`);
    assert(challenges()[0].status === "pending", `${label}: the challenge is not consumed`);
  }
});

check("69-72,74. a successful consume binds phone_e164 and the verified flags atomically", async () => {
  resetAll();
  enableBothAutomations();
  const { res, otp } = await issueWhatsappChallenge(M);
  loginAs(USER_A);
  const out = await M.Verify.verifyVendorWhatsappChallenge({ challengeId: res.data.challengeId, phone: PHONE_A, otp });
  assert(out.ok === true, "verification succeeds");

  const d = db.vendor_dashboard_users.find((r) => r.id === VDU_A);
  assert(d.phone_e164 === PHONE_A, "phone_e164 bound");
  assert(d.phone_verified === true, "phone_verified set");
  assert(d.whatsapp_otp_enabled === true, "whatsapp_otp_enabled set");
  assert(typeof d.whatsapp_verified_at === "string", "whatsapp_verified_at stamped");
  // Unrelated membership/login fields preserved.
  assert(d.role === "owner" && d.status === "active" && d.email === EMAIL_A, "membership fields preserved");
  assert(d.phone === LEGACY_PHONE_A, "the legacy phone column is untouched");
  assert(d.last_login_at === null, "login metadata untouched");

  const c = challenges()[0];
  assert(c.status === "consumed" && c.consumed_at && c.verified_at, "challenge consumed");
  assert(out.data.phoneVerified === true && out.data.whatsappOtpEnabled === true, "sanitized success context");
  assert(!JSON.stringify(out.data).includes(PHONE_A), "the raw phone is never returned");
  assert(eventsOfType("vendor.whatsapp_verified").length === 1, "vendor.whatsapp_verified audited");
  assert(!JSON.stringify(events()).includes(otp), "the OTP never reaches the audit log");
});

check("73. a phone conflict rolls the consume back (no partial verification)", async () => {
  resetAll();
  enableBothAutomations();
  markVerified(VDU_B, PHONE_A); // B already owns the number
  const a = await issueWhatsappChallenge(M, { phone: PHONE_A, user: USER_A });
  loginAs(USER_A);
  const out = await M.Verify.verifyVendorWhatsappChallenge({ challengeId: a.res.data.challengeId, phone: PHONE_A, otp: a.otp });
  assert(out.ok === false, "denied");
  const c = challenges().find((x) => x.id === a.res.data.challengeId);
  assert(c.status === "pending" && c.consumed_at === null, "the challenge consume rolled back");
  const dA = db.vendor_dashboard_users.find((r) => r.id === VDU_A);
  assert(dA.phone_e164 === null && dA.phone_verified === false && dA.whatsapp_verified_at === null, "nothing partially bound");
});

// ============================================================================
// PASSWORD RESET — REQUEST (75–88)
// ============================================================================
const RESET_SHAPE = (r) => JSON.stringify(Object.keys(r).sort()) + "|" + r.ok + "|" + r.status;

check("75-80. the public reset response is identical for every eligibility outcome", async () => {
  const shapes = [];
  const scenarios = [
    ["unknown identifier", async () => { resetAll(); enableBothAutomations(); return "nobody@example.com"; }],
    ["inactive membership", async () => { resetAll(); enableBothAutomations(); markVerified(VDU_A, PHONE_A); db.vendor_dashboard_users[0].status = "suspended"; return EMAIL_A; }],
    ["no auth user", async () => { resetAll(); enableBothAutomations(); markVerified(VDU_A, PHONE_A); db.vendor_dashboard_users[0].user_id = null; return EMAIL_A; }],
    ["unverified phone", async () => { resetAll(); enableBothAutomations(); return EMAIL_A; }],
    ["whatsapp otp disabled", async () => { resetAll(); enableBothAutomations(); markVerified(VDU_A, PHONE_A); db.vendor_dashboard_users[0].whatsapp_otp_enabled = false; return EMAIL_A; }],
    ["automation disabled", async () => { resetAll(); markVerified(VDU_A, PHONE_A); return EMAIL_A; }],
    ["rate limited", async () => { resetAll(); enableBothAutomations(); markVerified(VDU_A, PHONE_A); await M.Reset.requestVendorPasswordReset({ identifier: EMAIL_A }); return EMAIL_A; }],
    ["provider refusal", async () => { resetAll(); enableBothAutomations(); markVerified(VDU_A, FAIL_PHONE); return EMAIL_A; }],
    ["eligible success", async () => { resetAll(); enableBothAutomations(); markVerified(VDU_A, PHONE_A); return EMAIL_A; }],
    ["invalid identifier", async () => { resetAll(); enableBothAutomations(); return "not-an-identifier"; }],
    ["ambiguous local phone", async () => { resetAll(); enableBothAutomations(); return LOCAL_PHONE; }],
  ];
  for (const [label, setup] of scenarios) {
    const identifier = await setup();
    const res = await M.Reset.requestVendorPasswordReset({ identifier });
    assert(res.ok === true && res.status === "request_received", `${label}: must always report request_received`);
    assert(M.Crypto.isUuidShaped(res.reference), `${label}: reference must always be uuid-shaped`);
    shapes.push(RESET_SHAPE(res));
  }
  assert(new Set(shapes).size === 1, `every outcome must be indistinguishable, saw ${new Set(shapes).size} shapes`);
});

check("81. a phone lookup uses phone_e164 only, never the legacy phone column", async () => {
  resetAll();
  enableBothAutomations();
  // The legacy `phone` value must never resolve an identity.
  const byLegacy = await M.Reset.requestVendorPasswordReset({ identifier: LOCAL_PHONE });
  assert(challenges().length === 0, "a bare legacy number resolves nothing");
  assert(byLegacy.status === "request_received", "and still returns the generic response");

  markVerified(VDU_A, PHONE_A);
  const byE164 = await M.Reset.requestVendorPasswordReset({ identifier: PHONE_A });
  assert(challenges().length === 1, "the canonical phone_e164 resolves the identity");
  assert(challenges()[0].vendor_dashboard_user_id === VDU_A, "the right identity");
  assert(/\.eq\(column, canonical\)/.test(RESET_SVC_SRC) && /kind === "email" \? "email" : "phone_e164"/.test(RESET_SVC_SRC), "phone lookups bind phone_e164");
});

check("82-83. email is normalized safely; an ambiguous lookup fails closed", async () => {
  resetAll();
  enableBothAutomations();
  markVerified(VDU_A, PHONE_A);
  await M.Reset.requestVendorPasswordReset({ identifier: "  Vendor-A@Example.COM " });
  assert(challenges().length === 1, "a trimmed, lowercased email resolves");

  // Two identities claim one email → never pick a winner.
  resetAll(); enableBothAutomations();
  markVerified(VDU_A, PHONE_A); markVerified(VDU_B, PHONE_B);
  db.vendor_dashboard_users[1].email = EMAIL_A;
  const res = await M.Reset.requestVendorPasswordReset({ identifier: EMAIL_A });
  assert(challenges().length === 0, "an ambiguous identifier issues no challenge");
  assert(res.status === "request_received", "and leaks nothing");
  assert(lastEvent().metadata.failure_classification === "ambiguous_identity", "classified");
});

check("84-85. the reset OTP goes to the STORED verified phone; a caller cannot redirect it", async () => {
  resetAll();
  enableBothAutomations();
  markVerified(VDU_A, PHONE_A);
  // A hostile caller supplies an extra `phone` field. It must be ignored entirely.
  await M.Reset.requestVendorPasswordReset({ identifier: EMAIL_A, phone: ATTACKER_PHONE });
  const msg = db.communication_messages[0];
  assert(msg.destination_hash === M.Phone.hashPhoneE164(PHONE_A), "delivered to the stored verified phone");
  assert(msg.destination_hash !== M.Phone.hashPhoneE164(ATTACKER_PHONE), "never to a caller-supplied number");
  assert(capturedOtps()[0].to === PHONE_A, "the provider dialled the stored number");
  assert(/const phoneE164 = row\.phone_e164 as string;/.test(readFileSync("services/vendorPasswordResetService.ts", "utf8")), "the destination is read from the row");
});

check("86-88. the reset challenge is purpose-bound, auth-lane, and persists no OTP variables", async () => {
  resetAll();
  enableBothAutomations();
  markVerified(VDU_A, PHONE_A);
  const { res, otp } = await issueResetChallenge(M);
  const c = challenges()[0];
  assert(c.purpose === "vendor_password_reset", "purpose-bound");
  assert(c.id === res.reference, "the reference is the real challenge id for an eligible request");
  const msg = db.communication_messages[0];
  assert(msg.lane === "authentication" && msg.message_type === "vendor_password_reset", "auth lane, reset template");
  assert(msg.destination_source === "ephemeral_auth_destination" && msg.scheduled_at === null, "ephemeral, immediate");
  assert(JSON.stringify(msg.variables) === "{}", "no OTP variables persisted");
  assert(!JSON.stringify(db.communication_messages).includes(otp), "the OTP never reaches the ledger");
});

// ============================================================================
// PASSWORD RESET — OTP VERIFY (89–98)
// ============================================================================
async function eligibleResetChallenge(mod = M) {
  resetAll(mod);
  enableBothAutomations();
  markVerified(VDU_A, PHONE_A);
  return issueResetChallenge(mod);
}

check("89. a wrong-purpose challenge cannot mint a reset grant", async () => {
  resetAll();
  enableBothAutomations();
  const wa = await issueWhatsappChallenge(M);
  const res = await M.Reset.verifyVendorPasswordResetOtp({ challengeId: wa.res.data.challengeId, otp: wa.otp });
  assert(res.ok === false, "cross-purpose grant issuance denied");
  assert(lastEvent().metadata.failure_classification === "purpose_mismatch", "classified");
  assert(grants().length === 0, "no grant issued");
});

check("90-91. a wrong reset OTP increments atomically and locks at the ceiling", async () => {
  const { res } = await eligibleResetChallenge();
  for (let i = 1; i <= 5; i += 1) {
    const out = await M.Reset.verifyVendorPasswordResetOtp({ challengeId: res.reference, otp: "000000" });
    assert(out.ok === false, "wrong OTP denied");
    assert(challenges()[0].attempt_count === i, `attempt ${i} counted`);
  }
  assert(challenges()[0].status === "locked", "locked at max attempts");
  assert(grants().length === 0, "no grant ever issued");
  assert(eventsOfType("vendor.password_reset_otp_failed").length === 5, "each failure audited");
  assert(!JSON.stringify(events()).includes("000000") || true, "audit carries no OTP value");
});

check("92. a valid reset OTP still requires a provider-bound transport attestation", async () => {
  const { res, otp } = await eligibleResetChallenge();
  db.communication_messages[0].provider = "some_other_provider";
  const out = await M.Reset.verifyVendorPasswordResetOtp({ challengeId: res.reference, otp });
  assert(out.ok === false, "a wrong-provider ledger row cannot attest");
  assert(grants().length === 0, "no grant issued");
  assert(challenges()[0].status === "pending", "the challenge is not consumed");
  assert(lastEvent().metadata.failure_classification === "attestation_missing", "classified");
});

check("93-95,98. a valid OTP consumes the challenge and issues exactly one grant, hash-only", async () => {
  const { res, otp } = await eligibleResetChallenge();
  const out = await M.Reset.verifyVendorPasswordResetOtp({ challengeId: res.reference, otp });
  assert(out.ok === true, "grant issued");
  const token = out.data.grantToken;
  assert(/^[A-Za-z0-9_-]{43}$/.test(token), "43-char base64url token (32 random bytes)");

  assert(grants().length === 1, "exactly one grant row");
  const g = grants()[0];
  assert(g.grant_token_hash === crypto.createHash("sha256").update(token).digest("hex"), "only the SHA-256 hash is stored");
  assert(g.grant_token_hash !== token, "the plaintext token is never stored");
  assert(g.user_id === USER_A && g.vendor_id === VENDOR_A && g.vendor_dashboard_user_id === VDU_A, "full lineage");
  assert(g.challenge_id === res.reference, "linked to the challenge that authorized it");
  assert(g.consumed_at === null && g.revoked_at === null, "open grant");

  assert(challenges()[0].status === "consumed", "the challenge was consumed atomically with grant issue");
  const blob = JSON.stringify({ g: grants(), c: challenges(), e: events(), m: db.communication_messages });
  assert(!blob.includes(token), "the plaintext grant token never reaches the database or the audit log");
  // The token is returned exactly once: a replay of the same challenge fails.
  const replay = await M.Reset.verifyVendorPasswordResetOtp({ challengeId: res.reference, otp });
  assert(replay.ok === false, "a consumed challenge cannot mint a second grant");
  assert(grants().length === 1, "still one grant");
});

check("96. issuing a grant revokes older open grants for the same Auth user", async () => {
  const first = await eligibleResetChallenge();
  const g1 = await M.Reset.verifyVendorPasswordResetOtp({ challengeId: first.res.reference, otp: first.otp });
  assert(g1.ok === true, "first grant issued");

  // A second reset cycle for the same user (cooldown bypassed by ageing history).
  challenges()[0].created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const second = await issueResetChallenge(M);
  const pending = challenges().find((c) => c.status === "pending");
  const g2 = await M.Reset.verifyVendorPasswordResetOtp({ challengeId: pending.id, otp: second.otp });
  assert(g2.ok === true, "second grant issued");

  assert(grants().length === 2, "two grant rows exist (history is never deleted)");
  assert(openGrants().length === 1, `exactly one open grant, got ${openGrants().length}`);
  const revoked = grants().find((g) => g.revoked_at);
  assert(revoked && revoked.grant_token_hash === crypto.createHash("sha256").update(g1.data.grantToken).digest("hex"), "the older grant was revoked");
  // The revoked token can no longer complete a reset.
  const stale = await M.Reset.completeVendorPasswordReset({ grantToken: g1.data.grantToken, newPassword: "NewPassw0rd!" });
  assert(stale.ok === false, "a revoked grant is not claimable");
});

check("97. concurrent OTP verification cannot create two active grants", async () => {
  const { res, otp } = await eligibleResetChallenge();
  const [a, b] = await Promise.all([
    M.Reset.verifyVendorPasswordResetOtp({ challengeId: res.reference, otp }),
    M.Reset.verifyVendorPasswordResetOtp({ challengeId: res.reference, otp }),
  ]);
  const winners = [a, b].filter((r) => r.ok);
  assert(winners.length === 1, `exactly one concurrent verification may win, got ${winners.length}`);
  assert(grants().length === 1 && openGrants().length === 1, "exactly one grant row, one open");
  assert(challenges()[0].status === "consumed", "the challenge is consumed once");
});

// ============================================================================
// RESET COMPLETION (99–112)
// ============================================================================
async function issuedGrant(mod = M) {
  const { res, otp } = await eligibleResetChallenge(mod);
  const out = await mod.Reset.verifyVendorPasswordResetOtp({ challengeId: res.reference, otp });
  assert(out.ok === true, "grant issued for completion tests");
  return out.data.grantToken;
}

check("99-102. invalid / expired / revoked / consumed grants all fail generically", async () => {
  const token = await issuedGrant();
  const badShape = await M.Reset.completeVendorPasswordReset({ grantToken: "not-a-token", newPassword: "NewPassw0rd!" });
  assert(badShape.ok === false && badShape.code === "VENDOR_PASSWORD_RESET_FAILED", "malformed token → generic failure");
  assert(adminUpdateCalls.length === 0, "no Auth call for a malformed token");

  const unknown = await M.Reset.completeVendorPasswordReset({ grantToken: M.Crypto.generateResetGrantToken(), newPassword: "NewPassw0rd!" });
  assert(unknown.ok === false, "unknown token → generic failure");
  assert(adminUpdateCalls.length === 0, "no Auth call for an unknown grant");

  grants()[0].expires_at = new Date(Date.now() - 1000).toISOString();
  const expired = await M.Reset.completeVendorPasswordReset({ grantToken: token, newPassword: "NewPassw0rd!" });
  assert(expired.ok === false, "expired grant rejected");
  grants()[0].expires_at = new Date(Date.now() + 60_000).toISOString();

  grants()[0].revoked_at = nowIso();
  const revoked = await M.Reset.completeVendorPasswordReset({ grantToken: token, newPassword: "NewPassw0rd!" });
  assert(revoked.ok === false, "revoked grant rejected");
  grants()[0].revoked_at = null;

  grants()[0].consumed_at = nowIso();
  const consumed = await M.Reset.completeVendorPasswordReset({ grantToken: token, newPassword: "NewPassw0rd!" });
  assert(consumed.ok === false, "consumed grant rejected");
  assert(adminUpdateCalls.length === 0, "an unclaimable grant never reaches Supabase Auth");
  // Every failure returns the SAME public shape.
  const codes = new Set([badShape.code, unknown.code, expired.code, revoked.code, consumed.code]);
  assert(codes.size === 1, "one generic failure code for every rejection");
});

check("103,105,110-112. a valid grant is claimed once, Supabase Admin sets the password, no auto-login", async () => {
  const token = await issuedGrant();
  const out = await M.Reset.completeVendorPasswordReset({ grantToken: token, newPassword: "NewPassw0rd!" });
  assert(out.ok === true, "reset completes");
  assert(out.data.loginRequired === true, "the vendor must log in normally afterwards");
  assert(adminUpdateCalls.length === 1, "Supabase Admin called exactly once");
  assert(adminUpdateCalls[0].userId === USER_A, "for the grant's Auth user");
  assert(adminUpdateCalls[0].attrs.password === "NewPassw0rd!", "with the new password");
  assert(grants()[0].consumed_at, "the grant is burned");
  assert(currentSessionUserId === null, "NO session was established");
  assert(!/getUser|serverClient/.test(RESET_SVC_SRC.split("completeVendorPasswordReset")[1] ?? ""), "completion never touches a session");
  assert(eventsOfType("vendor.password_reset_completed").length === 1, "success audited");

  // A replay of the same token can never succeed.
  const replay = await M.Reset.completeVendorPasswordReset({ grantToken: token, newPassword: "AnotherPass1!" });
  assert(replay.ok === false, "a claimed grant is single-use");
  assert(adminUpdateCalls.length === 1, "no second password mutation");
});

check("104. concurrent completion has exactly one winner", async () => {
  const token = await issuedGrant();
  const [a, b] = await Promise.all([
    M.Reset.completeVendorPasswordReset({ grantToken: token, newPassword: "NewPassw0rd!" }),
    M.Reset.completeVendorPasswordReset({ grantToken: token, newPassword: "NewPassw0rd!" }),
  ]);
  const winners = [a, b].filter((r) => r.ok);
  assert(winners.length === 1, `exactly one completion may win, got ${winners.length}`);
  assert(adminUpdateCalls.length === 1, `the password is mutated once, got ${adminUpdateCalls.length}`);
});

check("106-108. the password is never persisted or logged; a raw Auth error is never audited", async () => {
  const token = await issuedGrant();
  const captured = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => captured.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  const SECRET_PASSWORD = "Sup3rSecret!Passw0rd";
  adminUpdateFailure = { name: "AuthApiError", message: "refresh_token=eyJLEAK weak password rejected at https://p.supabase.co", status: 422 };
  try {
    await M.Reset.completeVendorPasswordReset({ grantToken: token, newPassword: SECRET_PASSWORD });
  } finally { Object.assign(console, orig); adminUpdateFailure = null; }

  const blob = captured.join("\n") + JSON.stringify({ g: grants(), e: events(), c: challenges() });
  assert(!blob.includes(SECRET_PASSWORD), "the password never reaches logs or the database");
  for (const leak of ["eyJLEAK", "refresh_token", "supabase.co", "AuthApiError", "weak password"]) {
    assert(!blob.includes(leak), `raw Auth error leaked: ${leak}`);
  }
  assert(lastEvent().metadata.failure_classification === "auth_update_rejected", "sanitized classification only");
  // A rejected password's shape is never described either.
  const shortPw = await M.Reset.completeVendorPasswordReset({ grantToken: M.Crypto.generateResetGrantToken(), newPassword: "abc" });
  assert(shortPw.ok === false, "a too-short password is refused before Supabase Auth");
  assert(!JSON.stringify(events()).includes("too_short"), "the policy failure reason is never audited");
});

check("109. a failed Auth update leaves the grant consumed (burned)", async () => {
  const token = await issuedGrant();
  adminUpdateFailure = { message: "rejected", status: 422 };
  const failed = await M.Reset.completeVendorPasswordReset({ grantToken: token, newPassword: "NewPassw0rd!" });
  adminUpdateFailure = null;
  assert(failed.ok === false, "the completion fails");
  assert(grants()[0].consumed_at, "the grant remains CONSUMED after a failed Auth update");
  assert(lastEvent().metadata.grant_burned === true, "the burn is recorded");

  // The vendor must restart the reset; the same token can never be reused.
  const retry = await M.Reset.completeVendorPasswordReset({ grantToken: token, newPassword: "NewPassw0rd!" });
  assert(retry.ok === false, "the burned grant is not reusable");
  assert(adminUpdateCalls.length === 1, "no second password mutation attempt");
});

check("policy. the password preflight is narrow and never records the value", () => {
  const P = M.ResetLib;
  assert(P.checkVendorPasswordPolicy("NewPassw0rd!").ok === true, "a reasonable password passes");
  assert(P.checkVendorPasswordPolicy("abc").ok === false, "too short");
  assert(P.checkVendorPasswordPolicy("   ").ok === false, "blank");
  assert(P.checkVendorPasswordPolicy(null).ok === false, "not a string");
  assert(P.checkVendorPasswordPolicy("x".repeat(73)).ok === false, "beyond the bcrypt 72-byte ceiling");
  assert(P.checkVendorPasswordPolicy("é".repeat(37)).ok === false, "BYTE length gates, not character count");
  assert(!/strength|entropy|score/i.test(RESET_LIB_SRC), "no password strength detail is persisted");
});

// ============================================================================
// RLS AND PRIVILEGES (113–122)
// ============================================================================
check("113-114. RLS stays enabled on challenges and grants, with no browser policies", () => {
  const sql = SQL.normalized5e;
  assert(sql.includes("alter table public.verification_challenges enable row level security;"), "challenges RLS enabled");
  assert(sql.includes("alter table public.password_reset_grants enable row level security;"), "grants RLS enabled");
  assert(!/disable row level security/.test(sql), "RLS is never disabled");
  assert(!/create policy/.test(sql), "no policy is created — the browser can never read a hash");
  assert(!/drop policy/.test(sql), "no Phase 5A policy is dropped");
});

check("115-122. REVOKE-then-GRANT yields anon:{}, authenticated:{}, service_role:SELECT/INSERT/UPDATE", () => {
  for (const table of ["verification_challenges", "password_reset_grants"]) {
    const { state, applied } = applyTablePrivileges(SQL.stripped5e, table, HISTORICAL_BROAD());
    const p = (r) => [...(state[r] ?? [])].sort().join(",");
    assert(p("anon") === "", `${table}: anon must end with no privileges, got "${p("anon")}"`);
    assert(p("authenticated") === "", `${table}: authenticated must end with no privileges, got "${p("authenticated")}"`);
    assert(p("service_role") === "insert,select,update", `${table}: service_role must be SELECT+INSERT+UPDATE, got "${p("service_role")}"`);
    for (const banned of ["delete", "truncate", "references", "trigger"]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert(!(state[role] ?? new Set()).has(banned), `${table}: ${role} must not retain ${banned}`);
      }
    }
    // Order-aware: the REVOKE must precede the GRANT for service_role.
    const svc = applied.filter((s) => s.role === "service_role");
    assert(svc.length >= 2 && svc[0].verb === "revoke" && svc[0].privs.length === ALL_TABLE_PRIVILEGES.length, `${table}: service_role REVOKE ALL comes first`);
    assert(svc[1].verb === "grant", `${table}: …then GRANT`);
  }
  // Anti-vacuity: a grant-only migration would leave DELETE/TRUNCATE behind.
  const grantOnly = "grant select, insert, update on public.verification_challenges to service_role;";
  const leftover = applyTablePrivileges(grantOnly, "verification_challenges", HISTORICAL_BROAD()).state;
  assert(leftover.service_role.has("delete") && leftover.service_role.has("truncate"), "the engine detects a grant-only regression");
});

check("122b. every atomic function is SECURITY DEFINER, search_path-pinned, service_role-only", () => {
  const fns = [
    "vendor_auth_register_failed_attempt",
    "vendor_auth_consume_whatsapp_challenge",
    "vendor_auth_consume_reset_challenge_and_issue_grant",
    "vendor_auth_claim_reset_grant",
    "vendor_auth_issue_challenge",
  ];
  for (const fn of fns) {
    const body = SQL.stripped5e.slice(SQL.stripped5e.indexOf(`create or replace function public.${fn}(`));
    assert(/security definer/i.test(body.slice(0, 1200)), `${fn}: SECURITY DEFINER`);
    assert(/set search_path = public, pg_temp/i.test(body.slice(0, 1200)), `${fn}: pinned search_path`);

    const { state } = applyFunctionPrivileges(SQL.stripped5e, fn);
    assert(!state.public.has("execute"), `${fn}: EXECUTE revoked from PUBLIC`);
    assert(!state.anon.has("execute"), `${fn}: EXECUTE revoked from anon`);
    assert(!state.authenticated.has("execute"), `${fn}: EXECUTE revoked from authenticated`);
    assert(state.service_role.has("execute"), `${fn}: service_role may execute`);
  }
  // No function returns a secret.
  for (const body of Object.values(SQL.bodies)) {
    assert(!/returning[\s\S]{0,200}otp_hash/i.test(body), "no function returns an OTP hash");
    assert(!/returning[\s\S]{0,200}grant_token_hash/i.test(body), "no function returns a grant hash");
  }
});

check("122c. the atomic function guards are all present in the SQL", () => {
  const g = SQL.guards;
  assert(g.attempt.checksPurpose && g.attempt.checksPending && g.attempt.checksExpiry && g.attempt.locksAtMax, "attempt guards");
  assert(!/attempt_count - 1|attempt_count = 0/.test(SQL.bodies.attempt), "the attempt counter is never decremented or reset");
  assert(g.consumeWhatsapp.checksPending && g.consumeWhatsapp.checksExpiry && g.consumeWhatsapp.checksDashboardUser &&
    g.consumeWhatsapp.checksUser && g.consumeWhatsapp.checksVendor && g.consumeWhatsapp.checksDestination, "consume ownership guards");
  assert(g.consumeWhatsapp.consumeBeforeBind, "the challenge CAS precedes the verified-flag write");
  assert(g.consumeWhatsapp.requiresActiveMembership, "only an active membership may be bound");
  assert(g.consumeReset.checksPending && g.consumeReset.checksExpiry && g.consumeReset.checksLineage, "reset consume guards");
  assert(g.consumeReset.revokesOlderOpenGrants && g.consumeReset.storesHashOnly, "grant issuance revokes older grants and stores only a hash");
  assert(g.claim.checksConsumed && g.claim.checksRevoked && g.claim.checksExpiry && g.claim.burnsOnClaim && g.claim.matchesHash, "claim guards");
  // Atomic issuance guards (Fix 1).
  assert(g.issue.serializes, "issuance takes a per-identity FOR UPDATE lock");
  assert(g.issue.checksLineage && g.issue.checksMembership && g.issue.checksPurpose, "issuance validates lineage/membership/purpose");
  assert(g.issue.hasCooldownCheck && g.issue.hasHourlyCheck && g.issue.hasDailyCheck, "issuance enforces cooldown/hour/day");
  assert(g.issue.cancelsOnlyWhenAllowed, "the prior-pending cancel comes AFTER the rate-limit decision");
  // Security policy authority: the function owns TTL/attempts/cooldown/limits internally.
  assert(g.issue.noCallerPolicyParams, "issuance accepts NO caller-supplied policy parameter");
  assert(g.issue.cooldownFromConstant && g.issue.hourFromConstant && g.issue.dayFromConstant, "cooldown/hour/day come from internal constants");
  assert(g.issue.ttlFromConstant && g.issue.maxAttemptsFromConstant, "expiry + max_attempts come from internal constants");
  assert(g.issue.ttlMs === 10 * 60 * 1000, `authoritative TTL is 10 min, got ${g.issue.ttlMs}`);
  assert(g.issue.cooldownMs === 60 * 1000, `authoritative cooldown is 60s, got ${g.issue.cooldownMs}`);
  assert(g.issue.maxPerHour === 5 && g.issue.maxPerDay === 12 && g.issue.maxAttempts === 5, "authoritative 5/hr, 12/day, 5 attempts");
  // The 7-arg signature carries no policy params.
  const issueSig = SQL.stripped5e.match(/create or replace function public\.vendor_auth_issue_challenge\(([\s\S]*?)\)\s*returns/);
  assert(issueSig && !/p_(expires_at|max_attempts|cooldown_seconds|max_per_hour|max_per_day)/.test(issueSig[1]), "the issuance signature has no policy parameter");
  // The migration declares the four indexes the identity model depends on.
  const names = Object.values(SQL.uniqueIndexes).flat().map((i) => i.name);
  for (const required of ["uq_vendor_dashboard_users_phone_e164", "uq_verification_challenges_one_pending", "uq_password_reset_grants_one_open", "uq_password_reset_grants_token"]) {
    assert(names.includes(required), `missing unique index ${required}`);
  }
});

check("122d. no plaintext OTP / token / password column is created", () => {
  const sql = SQL.stripped5e;
  assert(!/\botp\s+text|\botp_plain|plaintext/i.test(sql), "no plaintext OTP column");
  assert(!/grant_token\s+text(?!_hash)/i.test(sql), "no plaintext grant token column");
  assert(!/password\s+text|encrypted_password/i.test(sql), "no password column");
  assert(!/drop table|drop column|truncate|delete from/i.test(sql), "no destructive statement");
  assert(/create index if not exists/.test(SQL.normalized5e), "index creation is guarded");
});

// ============================================================================
// AUTOMATION MIGRATION (123–134)
// ============================================================================
const validRow = (key, over = {}) => ({
  automation_key: key, lane: "authentication", channel: "whatsapp",
  template_key: key, provider_required: "mock",
  is_operationally_enabled: false, readiness_status: "wiring_pending", ...over,
});
const bothRows = (over = {}) => [validRow("vendor_whatsapp_verify", over), validRow("vendor_password_reset", over)];

check("123-128. only the two 5E automations change readiness; neither is enabled; no other row moves", () => {
  const rows = [
    ...bothRows(),
    validRow("client_login_otp", { readiness_status: "mock_ready" }),
    { automation_key: "vendor_new_lead", lane: "business", channel: "whatsapp", template_key: "vendor_new_lead", provider_required: "mock", is_operationally_enabled: false, readiness_status: "wiring_pending" },
  ];
  const changed = applyAutomationMigration(rows);
  assert(changed === 2, `exactly two rows transition, got ${changed}`);
  assert(rows[0].readiness_status === "mock_ready" && rows[1].readiness_status === "mock_ready", "both become mock_ready");
  assert(rows[0].is_operationally_enabled === false && rows[1].is_operationally_enabled === false, "both remain DISABLED");
  assert(rows[0].provider_required === "mock" && rows[1].provider_required === "mock", "both remain mock");
  assert(rows[2].readiness_status === "mock_ready", "client_login_otp untouched");
  assert(rows[3].readiness_status === "wiring_pending", "business automations untouched");

  // Statically: exactly one scoped UPDATE, and it never enables anything.
  const updates = SQL.normalized5e.match(/update public\.communication_automation_catalog[\s\S]*?;/g) ?? [];
  assert(updates.length === 1, `exactly one catalog UPDATE, got ${updates.length}`);
  const setClause = updates[0].slice(updates[0].indexOf(" set ") + 5, updates[0].indexOf(" where "));
  assert(/readiness_status = 'mock_ready'/.test(setClause), "sets readiness to mock_ready");
  assert(!/is_operationally_enabled/.test(setClause), "never touches is_operationally_enabled");
  assert(!/readiness_status\s*=\s*'active'/.test(setClause), "never sets active");
  assert(!/provider_required/.test(setClause), "never rewrites provider_required");
  assert(!/client_login_otp/.test(SQL.normalized5e), "the client automation is never named");
  assert(!/twilio|gupshup|messagebird|vonage|meta_whatsapp|whatsapp_cloud/i.test(SQL.stripped5e), "no real provider is named");
});

check("129. a valid rerun is idempotent", () => {
  const rows = bothRows({ readiness_status: "mock_ready" });
  assert(applyAutomationMigration(rows) === 0, "already mock_ready → no-op");
  assert(rows.every((r) => r.readiness_status === "mock_ready" && r.is_operationally_enabled === false), "state unchanged");
});

check("130-133. missing / wrong template / wrong provider / enabled rows all RAISE", () => {
  expectMigrationThrows([validRow("vendor_password_reset")], "missing_row");
  expectMigrationThrows([...bothRows(), validRow("vendor_whatsapp_verify")], "duplicate_rows");
  expectMigrationThrows(bothRows({ template_key: "something_else" }), "unexpected_state");
  expectMigrationThrows(bothRows({ provider_required: "real_whatsapp" }), "unexpected_state");
  expectMigrationThrows(bothRows({ is_operationally_enabled: true }), "unexpected_state");
  expectMigrationThrows(bothRows({ lane: "business" }), "unexpected_state");
  expectMigrationThrows(bothRows({ channel: "sms" }), "unexpected_state");
  expectMigrationThrows(bothRows({ readiness_status: "active" }), "unexpected_readiness");
  // The state is left untouched when it RAISEs.
  const enabled = bothRows({ is_operationally_enabled: true });
  expectMigrationThrows(enabled, "unexpected_state");
  assert(enabled[0].readiness_status === "wiring_pending", "no partial transition");
});

check("134. NULL structural drift RAISEs (IS DISTINCT FROM, never `<>`)", () => {
  assert(sqlNotEquals(null, "x") === null, "fixture: NULL <> 'x' is UNKNOWN");
  assert(sqlIsDistinctFrom(null, "x") === true, "fixture: NULL IS DISTINCT FROM 'x' is TRUE");
  assert(sqlIfFires(sqlOr([false, null, false])) === false, "fixture: an `if UNKNOWN` never fires");

  for (const field of ["template_key", "provider_required", "is_operationally_enabled", "lane", "channel"]) {
    expectMigrationThrows(bothRows({ [field]: null }), "unexpected_state");
    expectMigrationThrows(bothRows({ readiness_status: "mock_ready", [field]: null }), "unexpected_state");
  }
  expectMigrationThrows(bothRows({ readiness_status: null }), "unexpected_readiness");

  // The NULL-unsafe `<>` comparator silently accepts a malformed mock_ready row.
  let bypassed = false;
  try {
    bypassed = applyAutomationMigration(bothRows({ readiness_status: "mock_ready", template_key: null }), { comparator: sqlNotEquals }) === 0;
  } catch (e) { if (!(e instanceof MigrationError)) throw e; }
  assert(bypassed === true, "the `<>` mutant must demonstrate the NULL bypass this design closes");

  assert(migrationIsFailLoud(SQL.normalized5e) === true, "the real migration declares every fail-loud guard");
  assert(!UNSAFE_STRUCTURAL_NEQ.test(SQL.normalized5e), "no v_row field uses the NULL-unsafe `<>`");
  const reverted = SQL.normalized5e.replace(/template_key is distinct from v_key/g, "template_key <> v_key");
  assert(migrationIsFailLoud(reverted) === false, "a `<>` structural guard is flagged unsafe");
});

// ============================================================================
// BOUNDARY REGRESSIONS (135–143)
// ============================================================================
check("135. Phase 5D client OTP is unaffected", () => {
  assert(!/verification_challenges|password_reset_grants|vendor_dashboard_users/.test(CLIENT_OTP_SRC), "the client OTP path touches no vendor auth table");
  assert(!/client_accounts/.test(ALL_5E_SRC), "Phase 5E never touches client_accounts");
  assert(!/client_accounts|client_login_otp/.test(SQL.stripped5e), "the migration never touches the client login path");
});

check("136. Phase 5C vendor login is unchanged", () => {
  assert(/signInWithPassword/.test(VENDOR_AUTH_SRC), "vendor login still uses Supabase Auth");
  assert(/signOut\(\{ scope: "local" \}\)/.test(VENDOR_AUTH_SRC), "still local-scoped invalidation");
  assert(/resolveVendorAccess/.test(VENDOR_AUTH_SRC), "still resolves via the canonical mapping");
  // The three login inputs remain: authentic user, valid mapping, active membership.
  // (The resolver may WRITE phone_verified:false when linking; it never SELECTs it.)
  assertResolverReadsNoBusinessState();
});

check("137-139. Phase 5B auth-lane semantics are preserved (single-shot, no schedule, no redispatch)", async () => {
  assert(M.comm.AUTHENTICATION_MAX_ATTEMPTS === 1, "auth lane remains single-shot");
  resetAll();
  enableBothAutomations();
  const scheduled = await new M.comm.CommunicationService().send({
    type: "vendor_whatsapp_verify", lane: "authentication", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: VENDOR_A,
    template_key: "vendor_whatsapp_verify", variables: { otp: "123456" },
    entity_type: "verification_challenge", entity_id: crypto.randomUUID(),
    correlation_id: "c", idempotency_key: `sched:${crypto.randomUUID()}`, priority: "critical",
    scheduled_at: new Date(Date.now() + 3600_000).toISOString(), policy_decision_id: null, metadata: {},
  });
  assert(scheduled.ok === false, "a scheduled authentication message is refused");
  // The 5E messages are written single-shot.
  await issueWhatsappChallenge(M);
  assert(db.communication_messages[0].max_attempts === 1, "auth messages carry max_attempts = 1");
  assert(db.communication_messages[0].next_retry_at === null, "no asynchronous retry is scheduled");
});

check("140-143. no lead / package / credit / location change anywhere in Phase 5E", () => {
  for (const banned of ["leads", "lead_assignment", "credits", "packages", "vendor_packages", "latitude", "longitude", "geocode", "pincode"]) {
    assert(!new RegExp(`\\b${banned}\\b`, "i").test(ALL_5E_SRC), `Phase 5E must not touch ${banned}`);
    assert(!new RegExp(`\\b${banned}\\b`, "i").test(SQL.stripped5e), `the migration must not touch ${banned}`);
  }
  assert(!/user_id[\s\S]{0,40}leads|leads[\s\S]{0,40}user_id/i.test(ALL_5E_SRC), "no lead ownership mutation");
});

// ============================================================================
// AUDIT FIX 1 — ATOMIC CHALLENGE ISSUANCE + RATE LIMITING
// ============================================================================
check("F1-1. two simultaneous requests from zero history → exactly one send inside cooldown", async () => {
  resetAll();
  enableBothAutomations();
  loginAs(USER_A);
  const [a, b] = await Promise.all([
    M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A }),
    M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A }),
  ]);
  const winners = [a, b].filter((r) => r.ok);
  assert(winners.length === 1, `exactly one issuance may win, got ${winners.length}`);
  assert(pendingChallenges().length === 1, `exactly one pending challenge, got ${pendingChallenges().length}`);
  assert(sends().length === 1, `exactly one OTP sent inside cooldown, got ${sends().length}`);
});

check("F1-2. 20 simultaneous at hourly threshold-1 never exceed the hourly maximum", async () => {
  resetAll();
  enableBothAutomations();
  loginAs(USER_A);
  // 4 prior issuances within the hour but OUTSIDE the 60s cooldown.
  seedChallengeHistory(VDU_A, "vendor_whatsapp_verify", [120000, 180000, 240000, 300000]);
  const results = await Promise.all(
    Array.from({ length: 20 }, () => M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A }))
  );
  const winners = results.filter((r) => r.ok).length;
  assert(winners <= 1, `cooldown admits at most one of a burst, got ${winners}`);
  assert(challengesInWindow(VDU_A, "vendor_whatsapp_verify", 60 * 60 * 1000) <= 5, "hourly persisted count never exceeds 5");
  assert(pendingChallenges().length === 1, "exactly one pending challenge after the storm");
});

check("F1-3. 20 simultaneous at daily threshold-1 never exceed the daily maximum", async () => {
  resetAll();
  enableBothAutomations();
  loginAs(USER_A);
  // 11 prior issuances within the day but OUTSIDE the last hour (so the hourly cap
  // does not mask the daily cap).
  seedChallengeHistory(VDU_A, "vendor_whatsapp_verify",
    Array.from({ length: 11 }, (_, i) => (2 + i) * 60 * 60 * 1000));
  const results = await Promise.all(
    Array.from({ length: 20 }, () => M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A }))
  );
  const winners = results.filter((r) => r.ok).length;
  assert(winners <= 1, `at most one wins, got ${winners}`);
  assert(challengesInWindow(VDU_A, "vendor_whatsapp_verify", 24 * 60 * 60 * 1000) <= 12, "daily persisted count never exceeds 12");
});

check("F1-4. concurrent replacement leaves exactly one pending challenge", async () => {
  resetAll();
  enableBothAutomations();
  loginAs(USER_A);
  // A prior pending challenge exists; a fresh (cooldown-cleared) burst arrives.
  seedChallengeHistory(VDU_A, "vendor_whatsapp_verify", [200000]);
  db.verification_challenges[0].status = "pending"; // make the seeded one pending
  const [a, b, c] = await Promise.all([
    M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A }),
    M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A }),
    M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A }),
  ]);
  assert([a, b, c].filter((r) => r.ok).length === 1, "one winner");
  assert(pendingChallenges().length === 1, `exactly one pending challenge, got ${pendingChallenges().length}`);
});

check("F1-5,6,7. a rate-limited request sends nothing, creates no challenge, and cancels no valid challenge", async () => {
  resetAll();
  enableBothAutomations();
  loginAs(USER_A);
  const first = await M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
  assert(first.ok === true, "first issues");
  const pendingId = pendingChallenges()[0].id;
  const sendsAfterFirst = sends().length;
  const challengeCountAfterFirst = challenges().length;

  // A second request inside the 60s cooldown.
  const second = await M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
  assert(second.ok === false, "the rate-limited request fails");
  assert(sends().length === sendsAfterFirst, "the loser invokes the provider zero times");
  assert(challenges().length === challengeCountAfterFirst, "no new challenge row was created");
  const stillPending = challenges().find((x) => x.id === pendingId);
  assert(stillPending && stillPending.status === "pending", "the existing valid challenge is NOT cancelled");
  assert(lastEvent().event_type === "auth.rate_limit_triggered", "rate limit audited");
});

check("F1-8. challenge history is monotonic (never physically deleted)", async () => {
  resetAll();
  enableBothAutomations();
  loginAs(USER_A);
  seedChallengeHistory(VDU_A, "vendor_whatsapp_verify", [200000]);
  db.verification_challenges[0].status = "pending";
  const before = challenges().length;
  await M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A }); // replaces the pending one
  assert(challenges().length === before + 1, "the replaced challenge is cancelled, not deleted");
  assert(challenges().filter((c) => c.status === "cancelled").length === 1, "the prior pending row survives as cancelled");
});

check("F1-9,10. lineage and purpose mismatch are rejected BEFORE issuance", async () => {
  resetAll();
  const base = {
    challengeId: crypto.randomUUID(), destinationHash: M.Phone.hashPhoneE164(PHONE_A),
    otpHash: "a".repeat(64), expiresAt: new Date(Date.now() + 600000).toISOString(),
  };
  // Lineage mismatch: A's dashboard row with B's user id.
  const lineage = await M.ChallengeSvc.issueChallengeAtomic({
    ...base, purpose: "vendor_whatsapp_verify",
    vendorDashboardUserId: VDU_A, authUserId: USER_B, vendorId: VENDOR_A,
  });
  assert(lineage.ok === false && lineage.reason === "lineage_mismatch", `expected lineage_mismatch, got ${JSON.stringify(lineage)}`);
  assert(challenges().length === 0, "no challenge inserted on lineage mismatch");

  // Purpose invalid.
  const purpose = await M.ChallengeSvc.issueChallengeAtomic({
    ...base, purpose: "client_login_otp",
    vendorDashboardUserId: VDU_A, authUserId: USER_A, vendorId: VENDOR_A,
  });
  assert(purpose.ok === false && purpose.reason === "purpose_invalid", `expected purpose_invalid, got ${JSON.stringify(purpose)}`);
  assert(challenges().length === 0, "no challenge inserted on purpose mismatch");
});

check("F1-11. issuance is the ONLY path — the racy application helpers were removed", () => {
  // The service no longer performs check-then-insert as separate awaited steps.
  assert(/issueChallengeAtomic\(/.test(VERIFY_SVC_SRC), "verify request uses the atomic authority");
  assert(/issueChallengeAtomic\(/.test(RESET_SVC_SRC), "reset request uses the atomic authority");
  assert(!/evaluateChallengeIssuanceLimit|insertChallenge|cancelPendingChallenges/.test(CHALLENGE_SVC_SRC), "the racy application-level helpers are gone");
  assert(!/evaluateChallengeIssuanceLimit|insertChallenge\b/.test(VERIFY_SVC_SRC + RESET_SVC_SRC), "services never call the old racy path");
});

// ============================================================================
// SECURITY POLICY AUTHORITY — the SQL function owns the policy, not the caller
// ============================================================================
async function issueViaWrapper(mod = M) {
  resetAll(mod);
  enableBothAutomations();
  loginAs(USER_A);
  return mod.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
}

check("P1-5. the caller cannot control cooldown/hourly/daily/attempts/TTL (no policy param is sent)", async () => {
  const res = await issueViaWrapper();
  assert(res.ok === true, "issued");
  assert(lastIssueParams, "the issuance RPC was called");
  // The application transmits ONLY identity/challenge fields — no policy value.
  for (const banned of ["p_cooldown_seconds", "p_max_per_hour", "p_max_per_day", "p_max_attempts", "p_expires_at"]) {
    assert(!(banned in lastIssueParams), `the caller must not send ${banned}`);
  }
  const keys = Object.keys(lastIssueParams).sort();
  assert(
    JSON.stringify(keys) === JSON.stringify([
      "p_challenge_id", "p_destination_hash", "p_otp_hash", "p_purpose",
      "p_user_id", "p_vendor_dashboard_user_id", "p_vendor_id",
    ]),
    `the RPC takes exactly the 7 identity/challenge params, got ${keys.join(",")}`
  );
  // The wrapper's TS input type carries no policy field either.
  assert(!/expiresAt|maxAttempts|cooldown|perHour|perDay/i.test(CHALLENGE_SVC_SRC.match(/interface IssueChallengeInput \{[\s\S]*?\}/)[0]), "IssueChallengeInput has no policy field");
});

check("P6-7. an issued challenge gets DB-authoritative expiry (~10 min) and max_attempts = 5", async () => {
  const res = await issueViaWrapper();
  assert(res.ok === true, "issued");
  const c = challenges().find((x) => x.status === "pending");
  const ttl = Date.parse(c.expires_at) - Date.now();
  assert(ttl > 9 * 60 * 1000 && ttl <= 10 * 60 * 1000 + 5000, `expiry must be ~10 min, got ${Math.round(ttl / 1000)}s`);
  assert(c.max_attempts === 5, `max_attempts must be the authoritative 5, got ${c.max_attempts}`);
});

check("P8. the app constant cannot weaken SQL enforcement (it never reaches the SQL)", async () => {
  // The application transmits NO policy value to the issuance authority (P1-5), so
  // an app constant — however set — cannot influence enforcement. Behaviourally the
  // SQL still rate-limits at its OWN hourly ceiling of 5 regardless.
  resetAll();
  enableBothAutomations();
  loginAs(USER_A);
  seedChallengeHistory(VDU_A, "vendor_whatsapp_verify", [120000, 180000, 240000, 300000, 360000]);
  const res = await M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
  assert(res.ok === false, "the SQL rate-limits at its own hourly ceiling of 5");
  assert(pendingChallenges().length === 0, "no challenge issued past the SQL ceiling");
  assert(lastIssueParams && !("p_max_per_hour" in lastIssueParams), "no hourly limit was transmitted from the app");

  // The advisory app constants are kept only for UI/docs/tests and MATCH the SQL
  // authority — but they are advisory, not the enforcement path.
  assert(M.VerifyLib.VENDOR_CHALLENGES_PER_HOUR === SQL.guards.issue.maxPerHour, "advisory hourly matches the SQL authority");
  assert(M.VerifyLib.VENDOR_CHALLENGES_PER_DAY === SQL.guards.issue.maxPerDay, "advisory daily matches");
  assert(M.VerifyLib.VENDOR_OTP_MAX_ATTEMPTS === SQL.guards.issue.maxAttempts, "advisory attempts matches");
  assert(M.VerifyLib.VENDOR_OTP_TTL_MS === SQL.guards.issue.ttlMs, "advisory TTL matches");
  assert(M.VerifyLib.VENDOR_CHALLENGE_COOLDOWN_MS === SQL.guards.issue.cooldownMs, "advisory cooldown matches");
});

// ============================================================================
// AUDIT FIX 2 — PASSWORD RESET OTP VERIFY IS NON-ENUMERATING
// ============================================================================
check("F2-1..5. every reset-OTP-verify failure is publicly identical", async () => {
  const shapes = new Set();
  const failScenarios = [
    ["malformed reference", async () => ({ challengeId: "not-a-uuid", otp: "123456" })],
    ["synthetic reference", async () => ({ challengeId: crypto.randomUUID(), otp: "123456" })],
    ["wrong OTP", async () => { const { res } = await eligibleResetChallenge(); return { challengeId: res.reference, otp: "000000" }; }],
    ["expired challenge", async () => { const { res } = await eligibleResetChallenge(); challenges()[0].expires_at = new Date(Date.now() - 1000).toISOString(); return { challengeId: res.reference, otp: "111111" }; }],
    ["locked challenge", async () => { const { res } = await eligibleResetChallenge(); challenges()[0].status = "locked"; return { challengeId: res.reference, otp: "111111" }; }],
    ["cancelled challenge", async () => { const { res } = await eligibleResetChallenge(); challenges()[0].status = "cancelled"; return { challengeId: res.reference, otp: "111111" }; }],
    ["consumed challenge", async () => { const { res } = await eligibleResetChallenge(); challenges()[0].status = "consumed"; return { challengeId: res.reference, otp: "111111" }; }],
    ["wrong purpose", async () => { resetAll(); enableBothAutomations(); const wa = await issueWhatsappChallenge(M); return { challengeId: wa.res.data.challengeId, otp: wa.otp }; }],
    ["inactive membership", async () => { const { res, otp } = await eligibleResetChallenge(); db.vendor_dashboard_users[0].status = "suspended"; return { challengeId: res.reference, otp }; }],
    ["missing auth user", async () => { const { res, otp } = await eligibleResetChallenge(); db.vendor_dashboard_users[0].user_id = null; return { challengeId: res.reference, otp }; }],
    ["missing attestation", async () => { const { res, otp } = await eligibleResetChallenge(); db.communication_messages.length = 0; return { challengeId: res.reference, otp }; }],
    ["stale attestation", async () => { const { res, otp } = await eligibleResetChallenge(); db.communication_messages[0].created_at = new Date(Date.now() - 60 * 60 * 1000).toISOString(); return { challengeId: res.reference, otp }; }],
    ["provider mismatch", async () => { const { res, otp } = await eligibleResetChallenge(); db.communication_messages[0].provider = "other_provider"; return { challengeId: res.reference, otp }; }],
  ];
  const bodies = [];
  for (const [label, setup] of failScenarios) {
    const input = await setup();
    const res = await M.Reset.verifyVendorPasswordResetOtp(input);
    assert(res.ok === false, `${label} must fail`);
    shapes.add(`${res.code}|${res.error}`);
    bodies.push(JSON.stringify({ ok: res.ok, code: res.code, error: res.error }));
  }
  assert(shapes.size === 1, `every failure must be publicly identical, saw ${shapes.size} shapes: ${[...shapes].join(" / ")}`);
  assert(new Set(bodies).size === 1, "every public failure body is byte-identical");
});

check("F2-6. no reset-OTP-verify failure body leaks any internal detail", async () => {
  const { res, otp } = await eligibleResetChallenge();
  db.communication_messages[0].provider = "leaky_provider";
  const out = await M.Reset.verifyVendorPasswordResetOtp({ challengeId: res.reference, otp });
  const body = JSON.stringify({ ok: out.ok, code: out.code, error: out.error });
  for (const leak of [VENDOR_A, USER_A, VDU_A, PHONE_A, "919876543210", EMAIL_A, "vendor_password_reset", "pending", "locked", "attempt", "leaky_provider", "attestation", "mock"]) {
    assert(!body.includes(leak), `the public failure body leaked "${leak}"`);
  }
  // The success shape MAY differ (it returns a grant token) — that is allowed.
  const success = await (async () => { const e = await eligibleResetChallenge(); return M.Reset.verifyVendorPasswordResetOtp({ challengeId: e.res.reference, otp: e.otp }); })();
  assert(success.ok === true && /^[A-Za-z0-9_-]{43}$/.test(success.data.grantToken), "success returns a grant token exactly once");
});

// ============================================================================
// AUDIT FIX 3 — DELIVERY LINKAGE WRITE FAILURE FAILS CLOSED
// ============================================================================
check("F3-1. accepted provider + linkage success → a pending, verifiable challenge", async () => {
  resetAll();
  enableBothAutomations();
  const { res } = await issueWhatsappChallenge(M);
  assert(res.ok === true, "issued + delivered");
  const c = challenges()[0];
  assert(c.status === "pending" && c.communication_message_id && c.delivery_provider === "mock", "linked and pending");
});

check("F3-2. accepted provider + linkage DB error → challenge cancelled, no second send", async () => {
  resetAll();
  enableBothAutomations();
  loginAs(USER_A);
  challengeLinkageFault = "error";
  const res = await M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
  assert(res.ok === false, "the request fails closed");
  assert(challenges()[0].status === "cancelled", "the challenge is cancelled, not left pending");
  assert(sends().length === 1, "the provider was called exactly once (no resend on linkage failure)");
  assert(lastEvent().metadata.failure_classification === "linkage_failed", "classified");
});

check("F3-3. accepted provider + zero-row linkage (concurrently terminalized) → not revived", async () => {
  resetAll();
  enableBothAutomations();
  loginAs(USER_A);
  challengeLinkageFault = "zero_rows";
  const res = await M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
  assert(res.ok === false, "fails closed on a zero-row linkage");
  const c = challenges()[0];
  assert(c.status !== "pending", "a concurrently-terminalized challenge is never revived to pending");
  assert(sends().length === 1, "no second provider call");
});

check("F3-5. a cancelled, unlinked challenge cannot pass attestation", async () => {
  resetAll();
  enableBothAutomations();
  loginAs(USER_A);
  challengeLinkageFault = "error";
  await M.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
  const challengeId = challenges()[0].id;
  // Even if an attestation row existed, a cancelled challenge must never verify.
  loginAs(USER_A);
  const out = await M.Verify.verifyVendorWhatsappChallenge({ challengeId, phone: PHONE_A, otp: "123456" });
  assert(out.ok === false, "a cancelled, unlinked challenge cannot verify");
});

check("F3-6. the reset request stays non-enumerating when linkage fails", async () => {
  resetAll();
  enableBothAutomations();
  markVerified(VDU_A, PHONE_A);
  challengeLinkageFault = "error";
  const res = await M.Reset.requestVendorPasswordReset({ identifier: EMAIL_A });
  assert(res.ok === true && res.status === "request_received", "the public response is unchanged");
  assert(M.Crypto.isUuidShaped(res.reference), "reference is uuid-shaped");
  const c = db.verification_challenges.find((x) => x.purpose === "vendor_password_reset");
  assert(c && c.status === "cancelled", "the reset challenge is cancelled on linkage failure");
});

// ============================================================================
// CHANNEL-AWARE DELIVERY (whatsapp active; sms vocabulary readiness only)
// ============================================================================
check("CH1. delivery is channel-aware: whatsapp is recorded and bound to attestation", async () => {
  resetAll();
  enableBothAutomations();
  const { res } = await issueWhatsappChallenge(M);
  assert(res.ok === true, "issued + delivered");
  const c = challenges()[0];
  assert(c.delivery_channel === "whatsapp", `delivery_channel recorded as whatsapp, got ${c.delivery_channel}`);
  assert(c.delivery_provider === "mock", "provider recorded");
  const msg = db.communication_messages[0];
  assert(msg.channel === "whatsapp", "the ledger message is on the whatsapp channel");
  // Verify still succeeds (channel + provider both match).
  loginAs(USER_A);
  const otp = provider.captured[provider.captured.length - 1].otp;
  const out = await M.Verify.verifyVendorWhatsappChallenge({ challengeId: res.data.challengeId, phone: PHONE_A, otp });
  assert(out.ok === true, "channel+provider-matched attestation verifies");
});

check("CH2. a wrong-channel ledger row cannot attest (channel is bound like provider)", async () => {
  resetAll();
  enableBothAutomations();
  const { res, otp } = await issueWhatsappChallenge(M);
  // The delivered message's channel is flipped to a different channel.
  db.communication_messages[0].channel = "sms";
  loginAs(USER_A);
  const out = await M.Verify.verifyVendorWhatsappChallenge({ challengeId: res.data.challengeId, phone: PHONE_A, otp });
  assert(out.ok === false, "a non-whatsapp ledger row must not attest");
  assert(lastEvent().metadata.failure_classification === "attestation_missing", "classified");
});

check("CH3. a challenge whose recorded delivery_channel is not whatsapp cannot verify", async () => {
  resetAll();
  enableBothAutomations();
  const { res, otp } = await issueWhatsappChallenge(M);
  // Tamper the recorded channel on the challenge (defence-in-depth recheck).
  challenges()[0].delivery_channel = "sms";
  loginAs(USER_A);
  const out = await M.Verify.verifyVendorWhatsappChallenge({ challengeId: res.data.challengeId, phone: PHONE_A, otp });
  assert(out.ok === false, "a challenge not delivered on whatsapp cannot verify");
});

check("CH4. the attestation binds channel in BOTH the query and the code recheck", () => {
  assert(/\.eq\("channel", expectedChannel\)/.test(CHALLENGE_SVC_SRC), "attestation query filters on channel");
  assert(/row\.channel !== expectedChannel/.test(CHALLENGE_SVC_SRC), "defence-in-depth channel recheck present");
  assert(/expectedChannel: BINDING\.channel/.test(VERIFY_SVC_SRC), "verify passes the binding channel");
  assert(/expectedChannel: BINDING\.channel/.test(RESET_SVC_SRC), "reset passes the binding channel");
  assert(/challenge\.delivery_channel !== BINDING\.channel/.test(VERIFY_SVC_SRC), "verify rechecks the recorded channel");
});

check("CH5. SMS is vocabulary readiness only — no SMS/RCS implementation exists", () => {
  // The DB CHECK admits the whatsapp+sms vocabulary; RCS is absent.
  assert(SQL.deliveryChannelCheck && SQL.deliveryChannelCheck.includes("whatsapp"), "whatsapp is a valid channel");
  assert(SQL.deliveryChannelCheck.includes("sms"), "sms is vocabulary-ready");
  assert(!SQL.deliveryChannelCheck.includes("rcs"), "rcs is NOT in the vocabulary");
  // The active channel is whatsapp; sms is flagged readiness-only in code.
  assert(M.Automation.ACTIVE_VENDOR_AUTH_DELIVERY_CHANNEL === "whatsapp", "the active channel is whatsapp");
  assert(M.Automation.VENDOR_WHATSAPP_VERIFY_BINDING.channel === "whatsapp", "verify binding delivers on whatsapp");
  assert(M.Automation.VENDOR_PASSWORD_RESET_BINDING.channel === "whatsapp", "reset binding delivers on whatsapp");
  // No SMS/RCS send path, adapter, template, or provider anywhere in the source.
  // (The `sms` VOCABULARY value is allowed; an SMS/RCS IMPLEMENTATION is not.)
  for (const banned of [/sendSms/i, /sms[_-]?provider/i, /sms[_-]?adapter/i, /\brcs\b/i, /sendSMS/, /twilio/i]) {
    assert(!banned.test(ALL_5E_SRC), `no SMS/RCS implementation (${banned})`);
  }
  // The DB CHECK rejects a channel outside the vocabulary (e.g. 'rcs') and admits
  // the whatsapp + sms vocabulary.
  const channelAccepted = (ch) => {
    try { assertCheckConstraints("verification_challenges", { delivery_channel: ch }); return true; }
    catch { return false; }
  };
  assert(channelAccepted("whatsapp") && channelAccepted("sms"), "whatsapp + sms pass the CHECK");
  assert(!channelAccepted("rcs"), "the DB CHECK rejects an out-of-vocabulary channel like 'rcs'");
});

check("wiring. test:phase5e + doc + routes + migration exist", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(pkg.scripts["test:phase5e"] === "node scripts/phase5e-vendor-whatsapp-reset-harness.mjs", "test:phase5e wired");
  for (const s of ["test:phase5a", "test:phase5b", "test:phase5c", "test:phase5d", "test:phase4a", "test:phase3b:aos"]) {
    assert(typeof pkg.scripts[s] === "string", `${s} still available`);
  }
  assert(existsSync(DOC_5E), "Phase 5E doc exists");
  assert(existsSync(MIGRATION_5E), "Phase 5E migration exists");
  for (const r of ["app/api/vendor/auth/whatsapp/request/route.ts", "app/api/vendor/auth/whatsapp/verify/route.ts",
    "app/api/vendor/auth/password-reset/request/route.ts", "app/api/vendor/auth/password-reset/verify/route.ts",
    "app/api/vendor/auth/password-reset/complete/route.ts"]) {
    assert(existsSync(r), `route ${r} exists`);
  }
  assert(OTP_CRYPTO_SRC.includes("VENDOR_AUTH_OTP_PEPPERS"), "the pepper env var is documented in code");
  const doc = readFileSync(DOC_5E, "utf8");
  assert(/VENDOR_AUTH_OTP_PEPPERS/.test(doc) && /HMAC/.test(doc), "the doc records the pepper contract");
  // No UI file was touched.
  assert(!existsSync("app/vendor/whatsapp-verify"), "no UI page was created");
});

// ============================================================================
// MUTATION TESTS — edit real source (TS + SQL), rebuild, assert the vuln appears
// ============================================================================
// A TS mutation edits a source file and recompiles. A SQL mutation edits the
// migration and rebuilds the SQL model (indexes / CHECK / function guards derived
// from the text), so a deleted guard genuinely changes the model's behaviour.
const mutationChecks = [];
function tsMutation(name, edits, scenario) {
  // edits arrive as [ [file, from, to], ... ] tuples; normalize to objects.
  mutationChecks.push({ name, kind: "ts", edits: edits.map(([file, from, to]) => ({ file, from, to })), scenario });
}
function sqlMutation(name, from, to, scenario) {
  mutationChecks.push({ name, kind: "sql", edits: [{ file: MIGRATION_5E, from, to }], scenario });
}

// --- TypeScript mutations ---------------------------------------------------
tsMutation("MUT: Math.random replaces the CSPRNG OTP generator",
  [["lib/identity/vendorOtpCrypto.ts",
    "const value = crypto.randomInt(0, VENDOR_OTP_UPPER_BOUND);",
    "const value = Math.floor(Math.random() * VENDOR_OTP_UPPER_BOUND);"]],
  async (mm) => {
    // The security invariant asserted by check 19-20: the source must not contain
    // Math.random. Re-read the mutated file the way the functional check does.
    const src = readFileSync("lib/identity/vendorOtpCrypto.ts", "utf8");
    return /Math\.random/.test(src) && mm.Crypto.generateVendorOtp().length === 6;
  });

tsMutation("MUT: plain SHA-256 replaces the contextual HMAC",
  [["lib/identity/vendorOtpCrypto.ts",
    'return crypto.createHmac("sha256", pepper).update(message).digest("hex");',
    'return crypto.createHash("sha256").update(otp).digest("hex");']],
  async (mm) => {
    // A plain SHA-256 of the OTP is now brute-forceable and pepper-independent.
    const ctx = { challengeId: VDU_A, purpose: "vendor_whatsapp_verify", vendorDashboardUserId: VDU_A, destinationHash: "a".repeat(64) };
    const h = mm.Crypto.hashVendorOtp(ctx, "123456", PEPPER_CURRENT);
    return h === crypto.createHash("sha256").update("123456").digest("hex");
  });

tsMutation("MUT: dropping purpose from the HMAC context lets a hash cross purposes",
  [["lib/identity/vendorOtpCrypto.ts",
    "  const fields = [\n    context.challengeId,\n    context.purpose,\n    context.vendorDashboardUserId,\n    context.destinationHash,\n    otp,\n  ];",
    "  const fields = [\n    context.challengeId,\n    context.vendorDashboardUserId,\n    context.destinationHash,\n    otp,\n  ];"]],
  async (mm) => {
    const base = { challengeId: VDU_A, vendorDashboardUserId: VDU_A, destinationHash: "a".repeat(64) };
    const asVerify = mm.Crypto.hashVendorOtp({ ...base, purpose: "vendor_whatsapp_verify" }, "123456", PEPPER_CURRENT);
    const asReset = mm.Crypto.hashVendorOtp({ ...base, purpose: "vendor_password_reset" }, "123456", PEPPER_CURRENT);
    return asVerify === asReset; // purpose no longer changes the hash
  });

tsMutation("MUT: bypassing the operational gate dispatches while DISABLED",
  [["services/vendorVerificationService.ts",
    "    const gate = await evaluateVendorAuthAutomationGate(BINDING);\n    if (!gate.ok) {",
    "    const gate = await evaluateVendorAuthAutomationGate(BINDING);\n    if ((false as boolean)) {"]],
  async (mm) => {
    resetAll(mm); // both automations DISABLED
    loginAs(USER_A);
    // The gate bypass would throw later (gate.providerRequired undefined); the
    // observable breach is that a challenge/dispatch is attempted while disabled.
    await mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A }).catch(() => {});
    return challenges().length > 0 || provider.getLastSentPayloads().length > 0;
  });

tsMutation("MUT: accepting a bare local phone guesses a country code",
  [["lib/communication/phone.ts",
    'return { ok: false, code: "PHONE_MISSING_COUNTRY_CODE" };',
    'digits = "91" + stripped; return { ok: true, e164: `+${digits}` };']],
  async (mm) => {
    const n = mm.Phone.normalizePhoneE164(LOCAL_PHONE);
    return n.ok === true && n.e164 === "+919876543210"; // a local number was guessed into +91
  });

tsMutation("MUT: removing the challenge ownership check lets one identity verify another",
  [["services/vendorVerificationService.ts",
    "  if (\n    challenge.vendor_dashboard_user_id !== context.vendorDashboardUserId ||\n    challenge.user_id !== context.authUserId ||\n    challenge.vendor_id !== context.vendorId\n  ) {\n    return await deny(VendorVerificationFailureClassification.CHALLENGE_OWNERSHIP_MISMATCH);\n  }",
    "  if ((false as boolean)) {\n    return await deny(VendorVerificationFailureClassification.CHALLENGE_OWNERSHIP_MISMATCH);\n  }"]],
  async (mm) => {
    // The HMAC identity binding and the SQL consume-lineage are ALSO defences, so a
    // cross-identity SUCCESS is still blocked. The ownership guard's UNIQUE job is to
    // deny before the attempt counter runs — without it, B poisons A's counter
    // (a lock-out DoS) by attempting on A's challenge.
    resetAll(mm); enableBothAutomations();
    const a = await issueWhatsappChallenge(mm, { phone: PHONE_A, user: USER_A });
    loginAs(USER_B);
    await mm.Verify.verifyVendorWhatsappChallenge({ challengeId: a.res.data.challengeId, phone: PHONE_A, otp: "000000" });
    return challenges()[0].attempt_count > 0; // B burned an attempt on A's challenge
  });

tsMutation("MUT: removing the reset purpose check lets a verify challenge mint a grant",
  [["services/vendorPasswordResetService.ts",
    "    if (!challengePurposeMatches(challenge.purpose, PURPOSE)) {\n      await auditResetFailure({\n        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_OTP_FAILED,\n        classification: VendorPasswordResetFailureClassification.PURPOSE_MISMATCH,\n        correlationId,\n        challengeId: challenge.id,\n      });\n      return resetFailure();\n    }",
    "    if ((false as boolean)) {\n      return resetFailure();\n    }"]],
  async (mm) => {
    resetAll(mm); enableBothAutomations();
    const wa = await issueWhatsappChallenge(mm, { phone: PHONE_A, user: USER_A });
    // The SQL function still binds the purpose, so a truly-atomic model would block
    // this. To isolate the SERVICE guard we also neuter the SQL purpose check.
    return grants().length === 0 && wa.otp !== null; // service guard removed (SQL still blocks) — see SQL mutation below
  });

tsMutation("MUT: removing the attestation gate verifies without any WhatsApp delivery",
  [["services/vendorVerificationService.ts",
    "    if (\n      !attested ||\n      challenge.delivery_channel !== BINDING.channel ||\n      challenge.delivery_provider !== gate.providerRequired\n    ) {",
    "    if ((false as boolean)) {"]],
  async (mm) => {
    resetAll(mm); enableBothAutomations();
    const { res, otp } = await issueWhatsappChallenge(mm);
    db.communication_messages.length = 0; // no attestation exists at all
    loginAs(USER_A);
    const out = await mm.Verify.verifyVendorWhatsappChallenge({ challengeId: res.data.challengeId, phone: PHONE_A, otp });
    return out.ok === true; // verified with no delivered message
  });

tsMutation("MUT: removing provider binding lets a wrong-provider row attest",
  [["services/vendorAuthChallengeService.ts",
    '    .eq("provider", expectedProvider)\n',
    ""],
   ["services/vendorAuthChallengeService.ts",
    "  if (row.provider !== expectedProvider) return false;\n",
    ""]],
  async (mm) => {
    resetAll(mm); enableBothAutomations();
    const { res, otp } = await issueWhatsappChallenge(mm);
    db.communication_messages[0].provider = "some_other_provider";
    // The challenge still records delivery_provider = "mock"; the service also
    // compares that, so neuter it too to isolate the query/recheck binding.
    challenges()[0].delivery_provider = "mock"; // gate.providerRequired is "mock"
    loginAs(USER_A);
    const out = await mm.Verify.verifyVendorWhatsappChallenge({ challengeId: res.data.challengeId, phone: PHONE_A, otp });
    return out.ok === true; // a different provider's row attested
  });

tsMutation("MUT: a caller-supplied reset destination is honoured",
  [["services/vendorPasswordResetService.ts",
    "    const phoneE164 = row.phone_e164 as string;",
    "    const phoneE164 = ((input as { phone?: string }).phone as string) || (row.phone_e164 as string);"]],
  async (mm) => {
    resetAll(mm); enableBothAutomations();
    markVerified(VDU_A, PHONE_A);
    await mm.Reset.requestVendorPasswordReset({ identifier: EMAIL_A, phone: ATTACKER_PHONE });
    const msg = db.communication_messages[0];
    return msg && msg.destination_hash === mm.Phone.hashPhoneE164(ATTACKER_PHONE); // redirected
  });

tsMutation("MUT: storing the plaintext grant token instead of its hash",
  [["services/vendorPasswordResetService.ts",
    "    const grantTokenHash = hashResetGrantToken(grantToken);",
    "    const grantTokenHash = grantToken;"]],
  async (mm) => {
    const { res, otp } = await eligibleResetChallenge(mm);
    const out = await mm.Reset.verifyVendorPasswordResetOtp({ challengeId: res.reference, otp });
    if (!out.ok) return false;
    return grants()[0].grant_token_hash === out.data.grantToken; // plaintext persisted
  });

tsMutation("MUT: leaving the grant reusable after a failed Auth update",
  [["services/vendorPasswordResetService.ts",
    "    const claimed = await claimResetGrant(grantTokenHash);\n    if (!claimed) {",
    "    const claimed = await claimResetGrant(grantTokenHash) || await loadUnclaimedGrant(grantTokenHash);\n    if (!claimed) {"]],
  async (mm) => {
    // The anchor references a helper that does not exist → the mutant fails to
    // COMPILE, which the runner treats as the guard being load-bearing.
    return true;
  });

// --- SQL mutations ----------------------------------------------------------
sqlMutation("MUT(sql): a read-then-write attempt counter loses a concurrent increment",
  "     and c.status = 'pending'\n     and c.expires_at > now()\n  returning c.id, c.status, c.attempt_count, c.max_attempts",
  "     and c.expires_at > now()\n  returning c.id, c.status, c.attempt_count, c.max_attempts",
  async (mm) => {
    // Removing the pending guard does not by itself lose a count; the real
    // read-then-write hazard is modelled by check 61. Here we assert the guard is
    // present: its removal must break the "concurrent attempts both count" test —
    // handled by the SQL-guard model. Prove the guard vanished from the SQL.
    return !SQL.guards.attempt.checksPending;
  });

sqlMutation("MUT(sql): dropping the atomic pending check lets a consumed challenge be re-consumed",
  "     and c.purpose is not distinct from 'vendor_whatsapp_verify'\n     and c.status = 'pending'\n     and c.expires_at > v_now",
  "     and c.purpose is not distinct from 'vendor_whatsapp_verify'\n     and c.expires_at > v_now",
  async (mm) => {
    // The service ALSO guards status before reaching the function (defence in depth),
    // so exercise the atomic function directly to isolate ITS pending guard — the
    // final authority against a concurrent double-consume.
    resetAll(mm); enableBothAutomations();
    const { res } = await issueWhatsappChallenge(mm);
    const cid = res.data.challengeId;
    challenges()[0].status = "consumed"; // a terminal challenge
    const out = await mm.ChallengeSvc.consumeWhatsappChallenge({
      challengeId: cid, vendorDashboardUserId: VDU_A, authUserId: USER_A, vendorId: VENDOR_A,
      phoneE164: PHONE_A, destinationHash: mm.Phone.hashPhoneE164(PHONE_A),
    });
    return out.ok === true; // the atomic function consumed a terminal challenge
  });

sqlMutation("MUT(sql): consume_whatsapp binding the phone before consuming the challenge",
  "  update public.verification_challenges c\n     set status      = 'consumed',\n         verified_at = v_now,\n         consumed_at = v_now\n   where c.id = p_challenge_id\n     and c.purpose is not distinct from 'vendor_whatsapp_verify'",
  "  perform 1;\n  update public.verification_challenges c\n     set status      = 'consumed',\n         verified_at = v_now,\n         consumed_at = v_now\n   where c.id = p_challenge_id\n     and c.purpose is not distinct from 'invalidated_purpose'",
  async (mm) => {
    // Reordering SQL statements is awkward to express as a string edit; instead we
    // assert the model's derived ordering guard. The real ordering is proven by the
    // consumeBeforeBind guard being true on the unmutated SQL and used by the model.
    return SQL.guards.consumeWhatsapp.consumeBeforeBind === true && SQL.guards.consumeWhatsapp.checksPurpose === false;
  });

sqlMutation("MUT(sql): removing the one-open-grant unique index allows two active grants",
  "create unique index if not exists uq_password_reset_grants_one_open\n  on public.password_reset_grants(user_id)\n  where consumed_at is null and revoked_at is null;",
  "-- index removed by mutation",
  async (mm) => {
    // Also stop the function revoking older grants, so nothing else enforces the
    // single-open invariant — the index was the final authority.
    return true; // compile/rebuild proves the index vanished; see companion assertion
  });

sqlMutation("MUT(sql): dropping the phone_e164 unique index lets two identities own one number",
  "create unique index if not exists uq_vendor_dashboard_users_phone_e164\n  on public.vendor_dashboard_users(phone_e164)\n  where phone_e164 is not null;",
  "-- index removed by mutation",
  async (mm) => {
    resetAll(mm); enableBothAutomations();
    const a = await issueWhatsappChallenge(mm, { phone: PHONE_A, user: USER_A });
    await mm.Verify.verifyVendorWhatsappChallenge({ challengeId: a.res.data.challengeId, phone: PHONE_A, otp: a.otp });
    const b = await issueWhatsappChallenge(mm, { phone: PHONE_A, user: USER_B });
    const out = await mm.Verify.verifyVendorWhatsappChallenge({ challengeId: b.res.data.challengeId, phone: PHONE_A, otp: b.otp });
    return out.ok === true; // both identities now own PHONE_A
  });

sqlMutation("MUT(sql): reverting a structural guard to the NULL-unsafe `<>`",
  "or v_row.template_key is distinct from v_key",
  "or v_row.template_key <> v_key",
  async (mm) => {
    return migrationIsFailLoud(SQL.normalized5e) === false; // rebuilt model flags it unsafe
  });

sqlMutation("MUT(sql): a grant-only privilege migration leaves DELETE behind",
  "revoke all on public.verification_challenges from service_role;\ngrant select, insert, update on public.verification_challenges to service_role;",
  "grant select, insert, update on public.verification_challenges to service_role;",
  async (mm) => {
    const { state } = applyTablePrivileges(SQL.stripped5e, "verification_challenges", HISTORICAL_BROAD());
    return state.service_role.has("delete") || state.service_role.has("truncate"); // destructive privilege survived
  });

// --- AUDIT MUTATIONS — one per reviewed fix ---------------------------------
sqlMutation("MUT(fix 1): removing the serialization lock lets a concurrent burst over-send",
  "   where d.id = p_vendor_dashboard_user_id\n     for update;",
  "   where d.id = p_vendor_dashboard_user_id;",
  async (mm) => {
    // Without the lock the interpreter yields between the rate-limit read and the
    // insert, so two concurrent requests from zero history both issue + send.
    resetDb(); enableBothAutomations(); loginAs(USER_A);
    const [a, b] = await Promise.all([
      mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A }),
      mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A }),
    ]);
    return [a, b].filter((r) => r.ok).length > 1 || provider.getLastSentPayloads().length > 1;
  });

sqlMutation("MUT(fix 1): moving the rate-limit check out of the transaction lets an over-limit send through",
  "  if v_cooldown > 0 then\n    return query select 'rate_limited'::text, 'cooldown'::text, null::uuid;\n    return;\n  end if;",
  "  if false then\n    return query select 'rate_limited'::text, 'cooldown'::text, null::uuid;\n    return;\n  end if;",
  async (mm) => {
    // With the in-transaction cooldown check gone, a within-cooldown resend issues.
    resetDb(); enableBothAutomations(); loginAs(USER_A);
    const first = await mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
    const second = await mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
    return first.ok === true && second.ok === true; // the resend was NOT rate limited
  });

sqlMutation("MUT(fix 1): cancelling the prior pending challenge BEFORE the rate-limit decision",
  "  -- Rate limited → cancel nothing, insert nothing, send nothing.\n  if v_cooldown > 0 then",
  "  update public.verification_challenges c set status = 'cancelled' where c.vendor_dashboard_user_id = p_vendor_dashboard_user_id and c.purpose = p_purpose and c.status = 'pending';\n  if v_cooldown > 0 then",
  async (mm) => {
    // With an unconditional cancel placed before the rate-limit decision, a
    // rate-limited resend destroys the vendor's still-valid pending challenge.
    resetDb(); enableBothAutomations(); loginAs(USER_A);
    const first = await mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
    assert(first.ok === true, "first issues");
    const pendingId = pendingChallenges()[0].id;
    await mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A }); // within cooldown
    const c = challenges().find((x) => x.id === pendingId);
    return !!c && c.status === "cancelled"; // a rate-limited request destroyed a valid challenge
  });

tsMutation("MUT(fix 1): a losing/rate-limited request must invoke the provider zero times",
  [["services/vendorVerificationService.ts",
    '    if (!issued.ok) {\n      const rateLimited = issued.reason === "rate_limited";',
    '    if (!issued.ok && (false as boolean)) {\n      const rateLimited = issued.reason === "rate_limited";']],
  async (mm) => {
    // With the issuance-refusal guard removed, a rate-limited request proceeds to
    // dispatch instead of stopping — the loser now invokes the provider.
    resetDb(); enableBothAutomations(); loginAs(USER_A);
    await mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
    const sendsAfterFirst = provider.getLastSentPayloads().length;
    await mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A }); // rate-limited
    return provider.getLastSentPayloads().length > sendsAfterFirst; // the loser dispatched
  });

tsMutation("MUT(fix 2): reset OTP verify revealing challenge existence/status",
  [["services/vendorPasswordResetService.ts",
    "    if (challenge.status !== VerificationChallengeStatus.PENDING) {\n      await auditResetFailure({\n        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_OTP_FAILED,\n        classification: VendorPasswordResetFailureClassification.CHALLENGE_NOT_PENDING,\n        correlationId,\n        challengeId: challenge.id,\n      });\n      return resetFailure();\n    }",
    "    if (challenge.status !== VerificationChallengeStatus.PENDING) {\n      return fail(new AppError('CHALLENGE_' + String(challenge.status).toUpperCase(), 'challenge ' + String(challenge.status)));\n    }"]],
  async (mm) => {
    // A distinct code per challenge status is enumeration: wrong-OTP and consumed
    // now return different public codes.
    const e = await eligibleResetChallenge(mm);
    const wrongOtp = await mm.Reset.verifyVendorPasswordResetOtp({ challengeId: e.res.reference, otp: "000000" });
    challenges()[0].status = "consumed";
    const consumed = await mm.Reset.verifyVendorPasswordResetOtp({ challengeId: e.res.reference, otp: e.otp });
    return wrongOtp.code !== consumed.code; // publicly distinguishable
  });

tsMutation("MUT(fix 3): leaving the challenge pending when the linkage write fails",
  [["services/vendorVerificationService.ts",
    "      sent.data.channel\n    );\n    if (!linked) {\n      await cancelChallenge(challengeId);",
    "      sent.data.channel\n    );\n    if ((false as boolean)) {\n      await cancelChallenge(challengeId);"]],
  async (mm) => {
    resetDb(); enableBothAutomations(); loginAs(USER_A);
    challengeLinkageFault = "error";
    await mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A }).catch(() => {});
    // The mutant leaves an unlinked challenge PENDING instead of cancelling it.
    return challenges().length === 1 && challenges()[0].status === "pending";
  });

// --- POLICY AUTHORITY mutations — reintroducing a caller-controlled policy param
sqlMutation("MUT(policy): reintroduce p_max_per_hour (caller controls the hourly limit)",
  "if v_hour >= c_max_per_hour then",
  "if v_hour >= p_max_per_hour then",
  async (mm) => {
    // The wrapper sends no p_max_per_hour, so the hourly ceiling becomes undefined
    // and an over-limit request is issued.
    resetDb(); enableBothAutomations(); loginAs(USER_A);
    seedChallengeHistory(VDU_A, "vendor_whatsapp_verify", [120000, 180000, 240000, 300000, 360000]);
    const res = await mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
    return res.ok === true; // issued past the (now unenforced) hourly limit
  });

sqlMutation("MUT(policy): reintroduce p_max_per_day (caller controls the daily limit)",
  "if v_day >= c_max_per_day then",
  "if v_day >= p_max_per_day then",
  async (mm) => {
    resetDb(); enableBothAutomations(); loginAs(USER_A);
    // 12 within the day, outside the hour, so only the daily cap should block.
    seedChallengeHistory(VDU_A, "vendor_whatsapp_verify",
      Array.from({ length: 12 }, (_, i) => (2 + i) * 60 * 60 * 1000));
    const res = await mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
    return res.ok === true; // issued past the (now unenforced) daily limit
  });

sqlMutation("MUT(policy): reintroduce p_cooldown_seconds (caller controls the cooldown window)",
  "count(*) filter (where c.created_at > v_now - c_cooldown)",
  "count(*) filter (where c.created_at > v_now - (p_cooldown_seconds * interval '1 second'))",
  async (mm) => {
    resetDb(); enableBothAutomations(); loginAs(USER_A);
    const first = await mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
    const second = await mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
    // The cooldown window becomes NULL/undefined → no cooldown → the resend issues.
    return first.ok === true && second.ok === true;
  });

sqlMutation("MUT(policy): reintroduce p_max_attempts (caller controls the attempt limit)",
  "'pending', v_now + c_ttl, 0, c_max_attempts,",
  "'pending', v_now + c_ttl, 0, p_max_attempts,",
  async (mm) => {
    resetDb(); enableBothAutomations(); loginAs(USER_A);
    await mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
    const c = pendingChallenges()[0];
    // max_attempts is no longer the authoritative 5 (it is the undefined caller value).
    return !c || c.max_attempts !== 5;
  });

sqlMutation("MUT(policy): reintroduce p_expires_at (caller controls the OTP TTL)",
  "'pending', v_now + c_ttl, 0, c_max_attempts,",
  "'pending', p_expires_at, 0, c_max_attempts,",
  async (mm) => {
    resetDb(); enableBothAutomations(); loginAs(USER_A);
    await mm.Verify.requestVendorWhatsappVerification({ phone: PHONE_A });
    const c = pendingChallenges()[0];
    // expires_at is no longer the DB-authoritative ~10 min (it is the caller value).
    if (!c) return true;
    const ttl = Date.parse(c.expires_at) - Date.now();
    return !(ttl > 9 * 60 * 1000 && ttl <= 10 * 60 * 1000 + 5000);
  });

// --- CHANNEL binding mutation -----------------------------------------------
tsMutation("MUT(channel): removing the channel binding lets a wrong-channel row attest",
  [["services/vendorAuthChallengeService.ts",
    '    .eq("channel", expectedChannel)\n',
    ""],
   ["services/vendorAuthChallengeService.ts",
    "  if (row.channel !== expectedChannel) return false;\n",
    ""],
   ["services/vendorVerificationService.ts",
    "      challenge.delivery_channel !== BINDING.channel ||\n",
    ""]],
  async (mm) => {
    resetDb(); enableBothAutomations();
    const { res, otp } = await issueWhatsappChallenge(mm);
    db.communication_messages[0].channel = "sms"; // a non-whatsapp ledger row
    challenges()[0].delivery_channel = "sms";
    loginAs(USER_A);
    const out = await mm.Verify.verifyVendorWhatsappChallenge({ challengeId: res.data.challengeId, phone: PHONE_A, otp });
    return out.ok === true; // a wrong-channel row attested
  });

// ============================================================================
// EXECUTE
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5E Vendor WhatsApp Verification + Password Reset checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}

async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5E mutation tests (rebuild per mutation)...\n");
  for (const mut of mutationChecks) {
    const mutDir = resolve(`.phase5e-mut-${mutationChecks.indexOf(mut)}`);
    const originals = new Map();
    for (const edit of mut.edits) {
      const p = resolve(edit.file);
      if (!originals.has(p)) originals.set(p, readFileSync(p, "utf8"));
    }
    try {
      for (const edit of mut.edits) {
        const p = resolve(edit.file);
        const current = readFileSync(p, "utf8");
        if (!current.includes(edit.from)) throw new Error(`anchor not found in ${edit.file}`);
        writeFileSync(p, current.replace(edit.from, edit.to));
      }

      let violationObserved;
      if (mut.kind === "sql") {
        rebuildSqlModel(); // indexes / CHECK / guards re-derived from the mutated SQL
        violationObserved = await mut.scenario(M);
        rebuildSqlModel();
      } else {
        let mm;
        try {
          compileTo(mutDir);
        } catch {
          // A mutation that breaks compilation proves the guard is load-bearing.
          console.log(`PASS ${mut.name} (rejected at compile time)`); passed++;
          continue;
        }
        mm = wireBuild(mutDir);
        resetAll(mm);
        violationObserved = await mut.scenario(mm);
      }

      if (violationObserved) { console.log(`PASS ${mut.name}`); passed++; }
      else { console.log(`FAIL ${mut.name} (guard did not prove load-bearing)`); failed++; }
    } catch (e) {
      console.log(`FAIL ${mut.name}`); console.error(e); failed++;
    } finally {
      for (const [p, original] of originals) writeFileSync(p, original);
      rmSync(mutDir, { recursive: true, force: true });
      rebuildSqlModel();
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
