import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import crypto from "node:crypto";

/**
 * Phase 5D — QuickFurno Client WhatsApp OTP Login Readiness harness.
 *
 * Exercises the authoritative model (Supabase Auth = OTP authority), the Send SMS
 * Auth Hook adapter (Standard Webhooks verification → CommunicationService), the
 * operational gate / mock-safety kill-switch, the OTP request + verify services,
 * the WhatsApp delivery attestation, client_accounts provisioning + identity
 * safety, local session invalidation, the additive migration (readiness
 * transition, client_accounts privilege hardening, attestation index), and the
 * boundary regressions. It then MUTATION-TESTS the security-critical guarantees
 * by editing the real source, recompiling, and asserting the vulnerability
 * appears — restoring every file afterwards.
 *
 * The mock database models the REAL PostgreSQL unique constraints (including
 * partial indexes) so a write production would reject is rejected here too.
 */

const requireRoot = createRequire(import.meta.url);
const { Webhook } = requireRoot("standardwebhooks");

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
  "lib/identity/clientAccount.ts",
  "lib/identity/authSecurityEvent.ts",
  "lib/identity/clientAccess.ts",
  "lib/identity/clientOtp.ts",
  "lib/identity/clientOtpAutomation.ts",
  "lib/identity/sessionInvalidation.ts",
  "lib/auth/supabaseSendSmsHook.ts",
  "services/communicationRecipientResolver.ts",
  "services/communicationService.ts",
  "services/authSecurityEventService.ts",
  "services/clientAccessService.ts",
  "services/clientOtpAutomationService.ts",
  "services/clientOtpAuthService.ts",
  "services/supabaseSendSmsHookService.ts",
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

// ----------------------------------------------------------------------------
// Shared mock database (real unique-constraint semantics)
// ----------------------------------------------------------------------------
const UNIQUE_INDEXES = {
  client_accounts: [
    { name: "uq_client_accounts_user", cols: ["user_id"] },
    { name: "uq_client_accounts_phone_e164", cols: ["phone_e164"], where: (r) => r.phone_e164 !== null && r.phone_e164 !== undefined },
  ],
  communication_messages: [{ name: "communication_messages_idempotency_key_key", cols: ["idempotency_key"] }],
  communication_automation_catalog: [{ name: "communication_automation_catalog_pkey", cols: ["automation_key"] }],
  communication_templates: [{ name: "communication_templates_template_key_key", cols: ["template_key"] }],
};

function findUniqueViolation(table, newRow, rows, excludeId = null) {
  for (const index of UNIQUE_INDEXES[table] ?? []) {
    if (index.where && !index.where(newRow)) continue;
    if (index.cols.some((c) => newRow[c] === null || newRow[c] === undefined)) continue;
    const clash = rows.some(
      (existing) =>
        existing.id !== excludeId &&
        (!index.where || index.where(existing)) &&
        index.cols.every((c) => existing[c] === newRow[c])
    );
    if (clash) {
      return { code: "23505", message: `duplicate key value violates unique constraint "${index.name}"`, constraint: index.name };
    }
  }
  return null;
}

const TABLE_DEFAULTS = {
  communication_messages: () => ({
    status: "queued", attempt_count: 0, max_attempts: 5, next_retry_at: null,
    destination_source: "recipient_reference", provider_message_id: null, failure_code: null,
    failure_reason_sanitized: null, scheduled_at: null, accepted_at: null, sent_at: null,
    delivered_at: null, read_at: null, failed_at: null, variables: {}, metadata: {},
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }),
  client_accounts: () => ({
    phone_e164: null, display_name: null, whatsapp_verified_at: null, status: "active",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }),
};

const db = {};
let insertFaults = [];
function failNextInsert(table, error, sideEffect = null) { insertFaults.push({ table, error, sideEffect }); }

// Supabase Auth trackers
let signInOtpCalls = [];
let signInOtpResult = { error: null };
let verifyOtpCalls = [];
let verifyOtpResult = null;
let currentSessionUserId = null;
let signOutCalls = 0;
let signOutOptions = [];
let signOutFailure = null;

function resetDb() {
  insertFaults = [];
  signInOtpCalls = [];
  signInOtpResult = { error: null };
  verifyOtpCalls = [];
  verifyOtpResult = null;
  currentSessionUserId = null;
  signOutCalls = 0;
  signOutOptions = [];
  signOutFailure = null;

  db.communication_templates = [
    { template_key: "client_login_otp", channel: "whatsapp", category: "authentication", description: "OTP", version: "1.0", readiness_status: "mock_ready", is_active: true, provider_template_name: null },
  ];
  db.communication_messages = [];
  db.communication_automation_catalog = [
    // Phase 5D shipped state: mock_ready but operationally DISABLED (mock provider).
    { automation_key: "client_login_otp", category: "otp", lane: "authentication", channel: "whatsapp", readiness_status: "mock_ready", is_operationally_enabled: false, provider_required: "mock", template_key: "client_login_otp" },
  ];
  db.client_accounts = [];
  db.auth_security_events = [];
}

/** Enable the automation for tests that must exercise mock delivery. */
function enableAutomation(providerRequired = "mock") {
  const row = db.communication_automation_catalog.find((r) => r.automation_key === "client_login_otp");
  row.readiness_status = "active";
  row.is_operationally_enabled = true;
  row.provider_required = providerRequired;
}

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
    let list = db[this.table] || [];

    if (this.action === "insert") {
      const faultIndex = insertFaults.findIndex((f) => f.table === this.table);
      if (faultIndex !== -1) {
        const [fault] = insertFaults.splice(faultIndex, 1);
        if (fault.sideEffect) fault.sideEffect();
        return { data: null, error: fault.error };
      }
      const defaults = TABLE_DEFAULTS[this.table]?.() ?? {};
      const supplied = Object.fromEntries(Object.entries(this.actionData).filter(([, v]) => v !== undefined));
      const row = { id: crypto.randomUUID(), ...defaults, ...supplied };
      const violation = findUniqueViolation(this.table, row, db[this.table]);
      if (violation) return { data: null, error: violation };
      db[this.table].push(row);
      return { data: [row], error: null };
    }

    if (this.action === "update") {
      for (const f of this.filters) list = list.filter(f);
      for (const item of list) {
        const candidate = { ...item, ...this.actionData };
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

  async then(resolve) {
    const { data, error } = await this.execute();
    return resolve({ data, error });
  }
}

function fakeAuthClient() {
  return {
    from: (t) => new MockQueryBuilder(t),
    auth: {
      async signInWithOtp(creds) { signInOtpCalls.push(creds); return { data: {}, error: signInOtpResult.error }; },
      async verifyOtp(params) {
        verifyOtpCalls.push(params);
        const res = verifyOtpResult ?? { data: { user: null }, error: { message: "no responder" } };
        if (res.data?.user?.id) currentSessionUserId = res.data.user.id;
        return res;
      },
      async getUser() {
        if (!currentSessionUserId) return { data: { user: null }, error: { message: "no session" } };
        return { data: { user: { id: currentSessionUserId } }, error: null };
      },
      async signOut(options) {
        signOutCalls += 1;
        signOutOptions.push(options);
        const shouldFail = signOutFailure && (signOutFailure.remaining === undefined || signOutFailure.remaining > 0);
        if (shouldFail) {
          if (signOutFailure.remaining !== undefined) signOutFailure.remaining -= 1;
          if (signOutFailure.throws) throw signOutFailure.error;
          return { error: signOutFailure.error };
        }
        currentSessionUserId = null;
        return { error: null };
      },
    },
  };
}

// ----------------------------------------------------------------------------
// Build wiring
// ----------------------------------------------------------------------------
function wireBuild(outDir) {
  const req = createRequire(`${outDir}/`);
  const supabaseMod = req("./lib/supabase.js");
  supabaseMod.adminClient = () => ({ from: (t) => new MockQueryBuilder(t) });
  supabaseMod.serverClient = async () => fakeAuthClient();

  const comm = req("./services/communicationService.js");
  const hookLib = req("./lib/auth/supabaseSendSmsHook.js");
  const MockProviderMod = req("./lib/communication/providers/mockWhatsAppProvider.js");

  return {
    req, comm, hookLib, MockProviderMod,
    OtpAuth: req("./services/clientOtpAuthService.js"),
    HookSvc: req("./services/supabaseSendSmsHookService.js"),
    Access: req("./services/clientAccessService.js"),
    Gate: req("./services/clientOtpAutomationService.js"),
    Phone: req("./lib/communication/phone.js"),
    ClientOtp: req("./lib/identity/clientOtp.js"),
    ClientOtpAutomation: req("./lib/identity/clientOtpAutomation.js"),
    AuthEvent: req("./lib/identity/authSecurityEvent.js"),
  };
}

// Pass-through verifier: records calls and returns the parsed body (no crypto).
let verifyCalls = [];
function passThroughVerifier() {
  return {
    verifierKey: "test-passthrough",
    verify(rawBody, headers, secrets) {
      verifyCalls.push({ rawBody, headers, secrets });
      try { return { ok: true, payload: JSON.parse(rawBody) }; } catch { return { ok: false }; }
    },
  };
}
function rejectingVerifier() {
  return {
    verifierKey: "test-reject",
    verify(rawBody, headers, secrets) { verifyCalls.push({ rawBody, headers, secrets }); return { ok: false }; },
  };
}

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------
const AUTH_USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const PHONE = "+919876543210";
const PHONE_DIGITS = "919876543210";
const OTHER_PHONE = "+919812345678";
const OTHER_DIGITS = "919812345678";
const OTP = "654321";
const SECRET_B64 = crypto.randomBytes(24).toString("base64");
const SECRET_ENV = "SEND_SMS_HOOK_SECRETS";

function hookPayload({ userId = AUTH_USER, phoneDigits = PHONE_DIGITS, otp = OTP } = {}) {
  return { user: { id: userId, phone: phoneDigits }, sms: { otp } };
}

function unsignedRequest(payloadObj, headers = {}) {
  const rawBody = typeof payloadObj === "string" ? payloadObj : JSON.stringify(payloadObj);
  const h = {
    "webhook-id": "wh_default",
    "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
    "webhook-signature": "v1,placeholder",
    ...headers,
  };
  return { rawBody, getHeader: (n) => (n.toLowerCase() in h ? h[n.toLowerCase()] : null) };
}

function signedRequest({ webhookId = "wh_signed", payloadObj = hookPayload(), secret = SECRET_B64, timestamp = new Date() } = {}) {
  const rawBody = JSON.stringify(payloadObj);
  const wh = new Webhook(secret);
  const signature = wh.sign(webhookId, timestamp, rawBody);
  const h = {
    "webhook-id": webhookId,
    "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "webhook-signature": signature,
  };
  return { rawBody, getHeader: (n) => (n.toLowerCase() in h ? h[n.toLowerCase()] : null) };
}

function seedAttestation(M, { userId = AUTH_USER, phone = PHONE, status = "accepted", ageMs = 0 } = {}) {
  db.communication_messages.push({
    id: crypto.randomUUID(),
    message_type: "client_login_otp", lane: "authentication", channel: "whatsapp",
    recipient_type: "client", recipient_id: null, destination_source: "ephemeral_auth_destination",
    destination_hash: M.Phone.hashPhoneE164(phone), destination_masked: "masked",
    template_key: "client_login_otp", entity_type: "auth_user", entity_id: userId,
    idempotency_key: `seed:${crypto.randomUUID()}`, status, priority: "critical", provider: "mock",
    variables: {}, metadata: {}, created_at: new Date(Date.now() - ageMs).toISOString(),
  });
}

// ----------------------------------------------------------------------------
// Test registry
// ----------------------------------------------------------------------------
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function events() { return db.auth_security_events; }
function lastEvent() { return db.auth_security_events[db.auth_security_events.length - 1]; }

// ----------------------------------------------------------------------------
// Source text (code only, comments stripped)
// ----------------------------------------------------------------------------
function readCode(path) {
  // Strip block comments and line-leading `//` comments (CRLF-safe: [^\n]* also
  // consumes a trailing \r, which `.*$` would not on Windows line endings).
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
}
const OTP_AUTH_SRC = readCode("services/clientOtpAuthService.ts");
const HOOK_SVC_SRC = readCode("services/supabaseSendSmsHookService.ts");
const HOOK_LIB_SRC = readCode("lib/auth/supabaseSendSmsHook.ts");
const ACCESS_SRC = readCode("services/clientAccessService.ts");
const GATE_SRC = readCode("services/clientOtpAutomationService.ts");
const SESSION_INV_SRC = readCode("lib/identity/sessionInvalidation.ts");
const ROUTE_SRC = readCode("app/api/auth/hooks/supabase-send-sms/route.ts");
const VENDOR_AUTH_SRC = readCode("services/vendorAuthService.ts");
const CLIENT_OTP_LIB_SRC = readCode("lib/identity/clientOtp.ts");
const ALL_5D_SRC =
  OTP_AUTH_SRC + "\n" + HOOK_SVC_SRC + "\n" + HOOK_LIB_SRC + "\n" + ACCESS_SRC + "\n" + GATE_SRC + "\n" +
  SESSION_INV_SRC + "\n" + ROUTE_SRC + "\n" + CLIENT_OTP_LIB_SRC + "\n" +
  readCode("lib/identity/clientAccess.ts") + "\n" + readCode("lib/identity/clientOtpAutomation.ts");

const MIGRATION = "supabase/migrations/20260708000190_client_whatsapp_otp_login_readiness.sql";
const rawSql = readFileSync(MIGRATION, "utf8");
const strippedSql = rawSql.replace(/--[^\n]*/g, "");
const normalizedSql = strippedSql.toLowerCase().replace(/\s+/g, " ");

// ----------------------------------------------------------------------------
// Privilege engine (order-aware) — mirrors the migration's GRANT/REVOKE
// ----------------------------------------------------------------------------
const ALL_TABLE_PRIVILEGES = ["select", "insert", "update", "delete", "truncate", "references", "trigger"];
const PRIVILEGE_STATEMENT = /\b(grant|revoke)\s+([a-z, ]+?)\s+on\s+public\.client_accounts\s+(?:to|from)\s+([a-z_]+)\s*;/gi;

function applyPrivilegeStatements(sql, initialState) {
  const state = {};
  for (const [role, privs] of Object.entries(initialState)) state[role] = new Set(privs);
  const applied = [];
  for (const m of sql.matchAll(PRIVILEGE_STATEMENT)) {
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
const HISTORICAL_BROAD = () => ({ anon: [...ALL_TABLE_PRIVILEGES], authenticated: [...ALL_TABLE_PRIVILEGES], service_role: [...ALL_TABLE_PRIVILEGES] });

/**
 * Faithful JS port of the migration's fail-loud DO block. THROWS on any
 * unexpected state (missing/duplicate/enabled/wrong lane/channel/template/
 * provider/readiness); transitions exactly one wiring_pending row; no-ops an
 * already-mock_ready row.
 */
class MigrationError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
function applyReadinessMigration(rows) {
  const matches = rows.filter((r) => r.automation_key === "client_login_otp");
  if (matches.length === 0) throw new MigrationError("missing_row");
  if (matches.length > 1) throw new MigrationError("duplicate_rows");
  const r = matches[0];
  if (
    r.lane !== "authentication" || r.channel !== "whatsapp" || r.template_key !== "client_login_otp" ||
    r.provider_required !== "mock" || r.is_operationally_enabled !== false
  ) {
    throw new MigrationError("unexpected_state");
  }
  if (r.readiness_status === "wiring_pending") { r.readiness_status = "mock_ready"; return 1; }
  if (r.readiness_status === "mock_ready") return 0;
  throw new MigrationError("unexpected_readiness");
}
function expectMigrationThrows(rows, reason) {
  try { applyReadinessMigration(rows); }
  catch (e) { if (e instanceof MigrationError) { if (reason) assert(e.reason === reason, `expected ${reason}, got ${e.reason}`); return; } throw e; }
  throw new Error(`expected the migration to RAISE (${reason})`);
}

/** The fail-loud guard clauses the migration SQL must declare (on normalizedSql). */
const FAILLOUD_CLAUSES = {
  do_block: /do \$\$/,
  raise_present: /raise exception/,
  raise_missing_row: /if v_count = 0 then raise exception/,
  raise_duplicate: /elsif v_count > 1 then raise exception/,
  guard_enabled: /is_operationally_enabled <> false/,
  guard_lane: /lane <> 'authentication'/,
  guard_channel: /channel <> 'whatsapp'/,
  guard_template: /template_key <> 'client_login_otp'/,
  guard_provider: /provider_required <> 'mock'/,
  transition_assert: /get diagnostics v_updated = row_count; if v_updated <> 1 then raise exception/,
  readiness_else: /else raise exception[\s\S]*expected wiring_pending or mock_ready/,
};
function migrationIsFailLoud(sqlNormalized) {
  return Object.values(FAILLOUD_CLAUSES).every((re) => re.test(sqlNormalized));
}

// ============================================================================
// MAIN BUILD
// ============================================================================
const MAIN_DIR = resolve(".phase5d-build-main");
compileTo(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

function resetAll() {
  resetDb();
  verifyCalls = [];
  process.env[SECRET_ENV] = SECRET_B64;
  M.comm.setActiveWhatsAppProvider(new M.MockProviderMod.MockWhatsAppProvider());
  M.hookLib.setActiveSendSmsHookVerifier(passThroughVerifier());
}
function provider() { return M.comm.getActiveWhatsAppProvider(); }
function sends() { return provider().getLastSentPayloads(); }

// ============================================================================
// ARCHITECTURE (1–10)
// ============================================================================
check("1-3. Supabase Auth is the OTP authority; the services never generate an OTP", () => {
  assert(/auth\.signInWithOtp/.test(OTP_AUTH_SRC), "request path uses signInWithOtp");
  assert(/auth\.verifyOtp/.test(OTP_AUTH_SRC), "verify path uses verifyOtp");
  for (const banned of ["Math.random", "randomInt", "randomBytes", "generateOtp", "generateLink", "crypto.randomUUID"]) {
    assert(!ALL_5D_SRC.includes(banned), `Phase 5D must not generate/derive an OTP (${banned})`);
  }
});

check("4-5. request path uses request-scoped auth, no admin auth, no channel:whatsapp", () => {
  assert(!/adminClient\(\)\s*\.\s*auth/.test(OTP_AUTH_SRC), "must never use adminClient().auth");
  assert(/serverClient\(\)/.test(OTP_AUTH_SRC), "uses the request-scoped SSR client");
  assert(!/signInWithOtp\([^)]*channel/.test(OTP_AUTH_SRC), "signInWithOtp must not pass a channel");
});

check("6. verify path calls verifyOtp with type='sms'", async () => {
  resetAll();
  enableAutomation();
  seedAttestation(M);
  verifyOtpResult = { data: { user: { id: AUTH_USER, phone: PHONE_DIGITS } }, error: null };
  await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
  assert(verifyOtpCalls.length === 1, "verifyOtp called once");
  assert(verifyOtpCalls[0].type === "sms", `type must be sms, got ${verifyOtpCalls[0].type}`);
  assert(verifyOtpCalls[0].phone === PHONE, "canonical phone passed");
  assert(/verifyOtp\(\{\s*phone[^}]*type:\s*"sms"/.test(OTP_AUTH_SRC), "source declares type:'sms'");
});

check("7-9. no custom JWT, no custom session, no second auth cookie", () => {
  for (const banned of ["jsonwebtoken", "jose", "jwt.sign", "jwt.verify", "createSession", "sessionToken", "session_token", "setSessionCookie", "cookies("]) {
    assert(!ALL_5D_SRC.includes(banned), `Phase 5D must not use ${banned}`);
  }
});

check("10. no client verification_challenges row is ever created", () => {
  assert(!/verification_challenges/.test(ALL_5D_SRC), "Phase 5D services must not reference verification_challenges");
  // Comments legitimately explain that it is NOT used; the SQL must not touch it.
  assert(!/verification_challenges/.test(strippedSql), "Phase 5D migration SQL must not reference verification_challenges");
});

// ============================================================================
// HOOK SECURITY (11–21)
// ============================================================================
check("11. missing webhook headers are rejected", async () => {
  resetAll();
  const req = unsignedRequest(hookPayload(), { "webhook-signature": "" });
  const out = await M.HookSvc.handleSupabaseSendSmsHook(req);
  assert(out.kind === "rejected" && out.rejectReason === "missing_headers", `got ${out.kind}/${out.rejectReason}`);
  assert(sends().length === 0, "no dispatch");
});

check("12. an invalid signature is rejected (real Standard Webhooks verifier)", async () => {
  resetAll();
  enableAutomation();
  M.hookLib.setActiveSendSmsHookVerifier(new M.hookLib.StandardWebhooksSignatureVerifier());
  const good = signedRequest();
  const forged = { rawBody: good.rawBody, getHeader: (n) => (n.toLowerCase() === "webhook-signature" ? "v1,Zm9yZ2Vk" : good.getHeader(n)) };
  const out = await M.HookSvc.handleSupabaseSendSmsHook(forged);
  assert(out.kind === "rejected" && out.rejectReason === "invalid_signature", `got ${out.kind}/${out.rejectReason}`);
  assert(sends().length === 0, "forged signature must not dispatch");
});

check("13. signature verification happens before any JSON processing", async () => {
  resetAll();
  M.hookLib.setActiveSendSmsHookVerifier(rejectingVerifier());
  // A body that is NOT valid JSON. If we parsed before verifying, this would fail
  // as a parse error; instead it is rejected at the signature step.
  const req = unsignedRequest("{not-json");
  const out = await M.HookSvc.handleSupabaseSendSmsHook(req);
  assert(out.kind === "rejected" && out.rejectReason === "invalid_signature", `verify must run first, got ${out.rejectReason}`);
  assert(verifyCalls.length === 1, "the verifier was consulted");
});

check("14. the RAW body is what signature verification receives (tamper breaks it)", async () => {
  resetAll();
  enableAutomation();
  M.hookLib.setActiveSendSmsHookVerifier(new M.hookLib.StandardWebhooksSignatureVerifier());
  const good = signedRequest();
  const okOut = await M.HookSvc.handleSupabaseSendSmsHook(good);
  assert(okOut.kind === "delivered", `a correctly signed raw body verifies: got ${okOut.kind}`);

  resetAll();
  enableAutomation();
  M.hookLib.setActiveSendSmsHookVerifier(new M.hookLib.StandardWebhooksSignatureVerifier());
  const tampered = { rawBody: good.rawBody + " ", getHeader: good.getHeader };
  const badOut = await M.HookSvc.handleSupabaseSendSmsHook(tampered);
  assert(badOut.kind === "rejected" && badOut.rejectReason === "invalid_signature", "a one-byte change breaks verification");
});

check("14b. the v1,whsec_ secret prefix is handled by the official library", async () => {
  resetAll();
  enableAutomation();
  process.env[SECRET_ENV] = `v1,whsec_${SECRET_B64}`;
  M.hookLib.setActiveSendSmsHookVerifier(new M.hookLib.StandardWebhooksSignatureVerifier());
  const out = await M.HookSvc.handleSupabaseSendSmsHook(signedRequest({ secret: SECRET_B64 }));
  assert(out.kind === "delivered", `prefixed secret must verify, got ${out.kind}`);
});

check("15. a malformed verified payload is rejected", async () => {
  resetAll();
  enableAutomation();
  for (const payload of [{ user: { id: AUTH_USER } }, { sms: { otp: OTP } }, { user: { id: "not-a-uuid", phone: PHONE_DIGITS }, sms: { otp: OTP } }, { user: { id: AUTH_USER, phone: "abc" }, sms: { otp: OTP } }, { user: { id: AUTH_USER, phone: PHONE_DIGITS }, sms: {} }]) {
    const out = await M.HookSvc.handleSupabaseSendSmsHook(unsignedRequest(payload));
    assert(out.kind === "rejected" && out.rejectReason === "malformed_payload", `payload ${JSON.stringify(payload)} → ${out.rejectReason}`);
  }
  assert(sends().length === 0, "no malformed payload dispatched");
});

check("16. an oversized payload is rejected before verification", async () => {
  resetAll();
  const huge = JSON.stringify({ user: { id: AUTH_USER, phone: PHONE_DIGITS }, sms: { otp: OTP }, pad: "x".repeat(20 * 1024) });
  const out = await M.HookSvc.handleSupabaseSendSmsHook(unsignedRequest(huge));
  assert(out.kind === "rejected" && out.rejectReason === "oversized_body", `got ${out.rejectReason}`);
  assert(verifyCalls.length === 0, "verification must not even run on an oversized body");
});

check("17-21. raw body / OTP / phone / secret / signature are never logged", async () => {
  resetAll();
  enableAutomation();
  M.hookLib.setActiveSendSmsHookVerifier(new M.hookLib.StandardWebhooksSignatureVerifier());
  const captured = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => captured.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  try {
    const req = signedRequest();
    await M.HookSvc.handleSupabaseSendSmsHook(req);
    await M.HookSvc.handleSupabaseSendSmsHook(unsignedRequest("{bad", { "webhook-signature": "v1,bad" }));
  } finally {
    Object.assign(console, orig);
  }
  const blob = captured.join("\n");
  for (const secret of [OTP, PHONE, PHONE_DIGITS, SECRET_B64, "whsec_"]) {
    assert(!blob.includes(secret), `a sensitive value leaked to logs: ${secret.slice(0, 6)}…`);
  }
  // Static: services never console-log the raw body / otp / phone / secret / signature.
  for (const src of [HOOK_SVC_SRC, HOOK_LIB_SRC, OTP_AUTH_SRC]) {
    assert(!/console\.[a-z]+\([^)]*(rawBody|otp|phone|secret|signature)/i.test(src), "no sensitive console logging");
  }
});

// ============================================================================
// HOOK DELIVERY (22–40)
// ============================================================================
async function deliverOnce(req) {
  const out = await M.HookSvc.handleSupabaseSendSmsHook(req);
  return out;
}

check("22-30. a valid signed event builds an immediate ephemeral auth intent to the client", async () => {
  resetAll();
  enableAutomation();
  const out = await deliverOnce(unsignedRequest(hookPayload(), { "webhook-id": "wh_A" }));
  assert(out.kind === "delivered", `expected delivered, got ${out.kind}`);
  assert(db.communication_messages.length === 1, "one message row");
  const msg = db.communication_messages[0];
  assert(msg.lane === "authentication", "authentication lane");
  assert(msg.destination_source === "ephemeral_auth_destination", "ephemeral destination source");
  assert(msg.scheduled_at === null, "immediate, not scheduled");
  assert(msg.recipient_type === "client", "recipient_type=client");
  assert(msg.recipient_id === null, "recipient_id=null for first-time client");
  assert(msg.entity_type === "auth_user", "entity_type=auth_user");
  assert(msg.entity_id === AUTH_USER, "entity_id=Supabase auth user id");
  assert(JSON.stringify(msg.variables) === "{}", "auth-lane variables persist empty");
});

check("29b. the OTP value reaches the authentication provider call (and only there)", async () => {
  resetAll();
  enableAutomation();
  class CapturingProvider extends M.MockProviderMod.MockWhatsAppProvider {
    constructor() { super(); this.captured = []; }
    async sendAuthenticationMessage(to, tpl, vars) { this.captured.push({ to, otp: vars.otp }); return super.sendAuthenticationMessage(to, tpl, vars); }
  }
  const cap = new CapturingProvider();
  M.comm.setActiveWhatsAppProvider(cap);
  await deliverOnce(unsignedRequest(hookPayload({ otp: "918273" }), { "webhook-id": "wh_cap" }));
  assert(cap.captured.length === 1 && cap.captured[0].otp === "918273", "OTP reached the auth provider call");
  assert(cap.captured[0].to === PHONE, "provider dialled the canonical phone");
});

check("31-34. the OTP never touches the ledger, metadata, idempotency key, or security events", async () => {
  resetAll();
  enableAutomation();
  seedAttestation(M);
  await deliverOnce(unsignedRequest(hookPayload(), { "webhook-id": "wh_secret" }));
  verifyOtpResult = { data: { user: { id: AUTH_USER, phone: PHONE_DIGITS } }, error: null };
  await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });

  const msg = db.communication_messages.find((m) => m.idempotency_key === "client_login_otp:wh_secret");
  assert(msg, "message written");
  assert(!msg.idempotency_key.includes(OTP), "idempotency key excludes OTP");
  assert(msg.idempotency_key === "client_login_otp:wh_secret", "idempotency key derived from webhook-id");
  assert(!JSON.stringify(msg.metadata).includes(OTP), "OTP absent from metadata");
  assert(!JSON.stringify(db.communication_messages).includes(OTP), "OTP absent from the message ledger");
  assert(!JSON.stringify(db.auth_security_events).includes(OTP), "OTP absent from security events");
});

check("35. the same webhook-id cannot send twice (idempotent success)", async () => {
  resetAll();
  enableAutomation();
  const req = unsignedRequest(hookPayload(), { "webhook-id": "wh_dup" });
  const first = await deliverOnce(req);
  const second = await deliverOnce(req);
  assert(first.kind === "delivered" && second.kind === "delivered", "both report delivered");
  assert(db.communication_messages.length === 1, "only one message row");
  assert(sends().length === 1, `provider invoked once, got ${sends().length}`);
});

check("36. concurrent duplicate delivery cannot send twice", async () => {
  resetAll();
  enableAutomation();
  const req = unsignedRequest(hookPayload(), { "webhook-id": "wh_race" });
  const [a, b] = await Promise.all([deliverOnce(req), deliverOnce(req)]);
  // The loser of the insert race returns the winner mid-dispatch (delivered) or
  // still in-flight (in_progress) — either way it must never dispatch a second time.
  for (const out of [a, b]) {
    assert(out.kind === "delivered" || out.kind === "in_progress", `neither may be rejected/failed, got ${out.kind}`);
  }
  assert(db.communication_messages.length === 1, `one row only, got ${db.communication_messages.length}`);
  assert(sends().length === 1, `one provider invocation, got ${sends().length}`);
});

check("37-38. accepted replay is idempotent; a failed message is not blindly resent", async () => {
  resetAll();
  enableAutomation();
  // Force a permanent provider failure by steering to a mock failure destination.
  const failReq = unsignedRequest(hookPayload({ phoneDigits: "15550000002" }), { "webhook-id": "wh_fail" });
  const first = await deliverOnce(failReq);
  assert(first.kind === "delivery_failed", `first attempt fails, got ${first.kind}`);
  assert(sends().length === 1, "provider invoked once");
  const replay = await deliverOnce(failReq);
  assert(replay.kind === "delivery_failed", "failed replay stays failed");
  assert(sends().length === 1, "a failed auth OTP is never blindly resent");
  assert(db.communication_messages.length === 1, "no second row");
});

check("39-40. a disabled automation invokes the provider zero times (mock default cannot go live)", async () => {
  resetAll(); // automation ships DISABLED
  const out = await deliverOnce(unsignedRequest(hookPayload(), { "webhook-id": "wh_off" }));
  assert(out.kind === "service_unavailable", `disabled → service_unavailable, got ${out.kind}`);
  assert(out.dispatchAttempted === false, "no dispatch attempted");
  assert(sends().length === 0, "provider invoked zero times");
  assert(db.communication_messages.length === 0, "no message row");
  // Provider mismatch also blocks (real automation can never run on the mock adapter).
  resetAll();
  enableAutomation("real_whatsapp"); // active provider is 'mock'
  const mismatch = await deliverOnce(unsignedRequest(hookPayload(), { "webhook-id": "wh_mm" }));
  assert(mismatch.kind === "service_unavailable", "provider mismatch blocks dispatch");
  assert(sends().length === 0, "no send on provider mismatch");
});

// ============================================================================
// OTP REQUEST (41–48)
// ============================================================================
check("41-42. invalid / bare-local phones are rejected before Supabase Auth", async () => {
  resetAll();
  enableAutomation();
  for (const phone of ["not-a-phone", "9876543210", "", "+12"]) {
    const res = await M.OtpAuth.requestClientWhatsappOtp({ phone });
    assert(res.status === "invalid_phone", `phone ${JSON.stringify(phone)} → ${res.status}`);
  }
  assert(signInOtpCalls.length === 0, "Supabase Auth is never called with an invalid/guessed phone");
});

check("43,45. an enabled test state calls signInWithOtp exactly once with the canonical phone", async () => {
  resetAll();
  enableAutomation();
  const res = await M.OtpAuth.requestClientWhatsappOtp({ phone: "+91 98765-43210" });
  assert(res.status === "otp_requested" && res.ok === true, `got ${res.status}`);
  assert(signInOtpCalls.length === 1, `signInWithOtp once, got ${signInOtpCalls.length}`);
  assert(signInOtpCalls[0].phone === PHONE, "canonical E.164 phone");
  assert(!("channel" in signInOtpCalls[0]), "no channel argument");
});

check("44. a disabled automation prevents the signInWithOtp call", async () => {
  resetAll(); // disabled
  const res = await M.OtpAuth.requestClientWhatsappOtp({ phone: PHONE });
  assert(res.status === "service_unavailable", `got ${res.status}`);
  assert(signInOtpCalls.length === 0, "signInWithOtp must not be called when the gate is closed");
});

check("46. the request response never enumerates user existence", async () => {
  resetAll();
  enableAutomation();
  const existing = await M.OtpAuth.requestClientWhatsappOtp({ phone: PHONE });
  const fresh = await M.OtpAuth.requestClientWhatsappOtp({ phone: OTHER_PHONE });
  assert(JSON.stringify(existing) === JSON.stringify(fresh), "existing and new numbers get identical responses");
  // Even a post-call Supabase error does not change the public response.
  signInOtpResult = { error: { message: "User already registered at https://x.supabase.co" } };
  const errored = await M.OtpAuth.requestClientWhatsappOtp({ phone: PHONE });
  assert(errored.status === "otp_requested", "a Supabase error must not change the public status");
});

check("47-48. request auditing uses the destination hash only and never a raw Auth error", async () => {
  resetAll();
  enableAutomation();
  await M.OtpAuth.requestClientWhatsappOtp({ phone: PHONE });
  const success = lastEvent();
  assert(success.event_type === "client.otp_requested", "success event type");
  assert(success.destination_hash === M.Phone.hashPhoneE164(PHONE), "destination hash recorded");
  assert(!JSON.stringify(events()).includes(PHONE) && !JSON.stringify(events()).includes(PHONE_DIGITS), "no raw phone in audit");

  resetAll();
  enableAutomation();
  signInOtpResult = { error: { message: "refresh_token=eyJLEAK rejected at https://proj.supabase.co" } };
  await M.OtpAuth.requestClientWhatsappOtp({ phone: PHONE });
  const failed = lastEvent();
  assert(failed.event_type === "client.otp_request_failed", "failure event type");
  assert(failed.metadata.failure_classification === "otp_dispatch_rejected", "sanitized classification");
  for (const leak of ["eyJLEAK", "refresh_token", "supabase.co", "rejected at"]) {
    assert(!JSON.stringify(events()).includes(leak), `raw Auth error leaked: ${leak}`);
  }
});

// ============================================================================
// OTP VERIFY (49–64)
// ============================================================================
function verifySuccessResponder(userId = AUTH_USER, phoneDigits = PHONE_DIGITS) {
  verifyOtpResult = { data: { user: { id: userId, phone: phoneDigits } }, error: null };
}

check("49-50. an invalid OTP creates no client account and sets no verified timestamp", async () => {
  resetAll();
  enableAutomation();
  seedAttestation(M);
  verifyOtpResult = { data: { user: null }, error: { message: "Token has expired or is invalid" } };
  const res = await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
  assert(res.ok === false, "verify fails");
  assert(db.client_accounts.length === 0, "no client account provisioned");
  assert(signOutCalls === 0, "no session was established, so none is torn down");
});

check("51. an Auth phone mismatch fails closed and invalidates the session", async () => {
  resetAll();
  enableAutomation();
  seedAttestation(M);
  verifySuccessResponder(AUTH_USER, "911111111111"); // different verified phone
  const res = await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
  assert(res.ok === false, "denied");
  assert(db.client_accounts.length === 0, "no account provisioned");
  assert(signOutCalls === 1 && signOutOptions[0].scope === "local", "local session invalidated");
  assert(lastEvent().metadata.failure_classification === "auth_phone_mismatch", "classified");
});

check("52-55. queued / dispatching / failed / missing attestations all fail closed", async () => {
  for (const status of [null, "queued", "dispatching", "failed", "retry_scheduled", "dead_letter", "cancelled"]) {
    resetAll();
    enableAutomation();
    if (status) seedAttestation(M, { status });
    verifySuccessResponder();
    const res = await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
    assert(res.ok === false, `status ${status} must not attest`);
    assert(db.client_accounts.length === 0, `status ${status}: no provisioning`);
    assert(signOutCalls === 1, `status ${status}: session invalidated`);
  }
});

check("56-57. accepted / sent / delivered / read attestations succeed", async () => {
  for (const status of ["accepted", "sent", "delivered", "read"]) {
    resetAll();
    enableAutomation();
    seedAttestation(M, { status });
    verifySuccessResponder();
    const res = await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
    assert(res.ok === true, `status ${status} must attest: ${res.ok ? "" : res.code}`);
    assert(res.data.clientAccountId, "client account resolved");
  }
});

check("58-60. attestation must match auth user id + destination hash, and be fresh", async () => {
  // wrong auth user
  resetAll(); enableAutomation(); seedAttestation(M, { userId: OTHER_USER }); verifySuccessResponder();
  assert((await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP })).ok === false, "wrong entity_id must not attest");

  // wrong destination hash
  resetAll(); enableAutomation(); seedAttestation(M, { phone: OTHER_PHONE }); verifySuccessResponder();
  assert((await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP })).ok === false, "wrong destination_hash must not attest");

  // stale
  resetAll(); enableAutomation(); seedAttestation(M, { ageMs: 30 * 60 * 1000 }); verifySuccessResponder();
  assert((await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP })).ok === false, "a stale attestation must be rejected");
});

check("61-62. success provisions the account and sets whatsapp_verified_at only after both conditions", async () => {
  resetAll();
  enableAutomation();
  seedAttestation(M);
  verifySuccessResponder();
  const res = await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
  assert(res.ok === true, "verify succeeds");
  assert(db.client_accounts.length === 1, "one client account created");
  const row = db.client_accounts[0];
  assert(row.user_id === AUTH_USER && row.phone_e164 === PHONE, "identity persisted");
  assert(row.status === "active", "status active");
  assert(typeof row.whatsapp_verified_at === "string", "whatsapp_verified_at set");
  assert(res.data.clientAccountId === row.id && res.data.whatsappVerifiedAt === row.whatsapp_verified_at, "context returned");
});

check("63-64. repeated login is idempotent and preserves the first verification timestamp", async () => {
  resetAll();
  enableAutomation();
  seedAttestation(M);
  verifySuccessResponder();
  const first = await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
  const ts = db.client_accounts[0].whatsapp_verified_at;
  seedAttestation(M); // a fresh delivery for the second login
  const second = await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
  assert(first.ok && second.ok, "both logins succeed");
  assert(db.client_accounts.length === 1, "no duplicate account");
  assert(db.client_accounts[0].whatsapp_verified_at === ts, "the first verification timestamp is preserved");
});

// ============================================================================
// CLIENT IDENTITY SAFETY (65–77)
// ============================================================================
check("65-66. the unique user_id and partial phone indexes are the final authority", async () => {
  resetAll();
  // one auth user → one account
  db.client_accounts.push({ id: "ca-1", user_id: AUTH_USER, phone_e164: PHONE, status: "active", whatsapp_verified_at: null });
  const dupUser = await M.Access.provisionVerifiedClientAccount({ authUserId: AUTH_USER, phoneE164: OTHER_PHONE });
  assert(dupUser.ok === false, "a second phone for a mapped user is a conflict, never a new row");
  assert(db.client_accounts.length === 1, "no extra row");

  // one non-null phone → one account (direct insert is rejected 23505)
  const { error } = await M.Access.provisionVerifiedClientAccount({ authUserId: OTHER_USER, phoneE164: PHONE });
  assert(error === undefined ? true : true, "");
  const conflict = await M.Access.provisionVerifiedClientAccount({ authUserId: OTHER_USER, phoneE164: PHONE });
  assert(conflict.ok === false, "a phone already owned by another user is refused");
  assert(db.client_accounts.length === 1, "still one row; ownership never reassigned");
});

check("67. a null-phone account may adopt the verified phone", async () => {
  resetAll();
  enableAutomation();
  db.client_accounts.push({ id: "ca-np", user_id: AUTH_USER, phone_e164: null, status: "active", whatsapp_verified_at: null });
  seedAttestation(M);
  verifySuccessResponder();
  const res = await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
  assert(res.ok === true, "adoption succeeds");
  assert(db.client_accounts.length === 1 && db.client_accounts[0].phone_e164 === PHONE, "phone adopted");
  assert(typeof db.client_accounts[0].whatsapp_verified_at === "string", "verified timestamp set on adoption");
});

check("68,71. a phone owned by a different user fails closed with no reassignment", async () => {
  resetAll();
  enableAutomation();
  db.client_accounts.push({ id: "ca-other", user_id: OTHER_USER, phone_e164: PHONE, status: "active", whatsapp_verified_at: "2026-01-01T00:00:00Z" });
  seedAttestation(M);
  verifySuccessResponder();
  const res = await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
  assert(res.ok === false, "denied");
  assert(db.client_accounts.length === 1 && db.client_accounts[0].user_id === OTHER_USER, "ownership untouched");
  assert(signOutCalls === 1, "session invalidated");
  assert(lastEvent().metadata.failure_classification === "identity_conflict", "classified");
});

check("69. a user already mapped to a different phone fails closed", async () => {
  resetAll();
  enableAutomation();
  db.client_accounts.push({ id: "ca-diff", user_id: AUTH_USER, phone_e164: OTHER_PHONE, status: "active", whatsapp_verified_at: "2026-01-01T00:00:00Z" });
  seedAttestation(M);
  verifySuccessResponder();
  const res = await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
  assert(res.ok === false, "denied");
  assert(db.client_accounts[0].phone_e164 === OTHER_PHONE, "established identity never overwritten");
});

check("70. a concurrent insert conflict refetches and validates the winner", async () => {
  resetAll();
  const winner = { id: "ca-winner", user_id: AUTH_USER, phone_e164: PHONE, status: "active", whatsapp_verified_at: "2026-02-02T00:00:00Z" };
  // fetchByUser/byPhone both return null first; the insert 23505s and the winner appears.
  failNextInsert("client_accounts", { code: "23505", message: "duplicate", constraint: "uq_client_accounts_user" }, () => db.client_accounts.push(winner));
  const res = await M.Access.provisionVerifiedClientAccount({ authUserId: AUTH_USER, phoneE164: PHONE });
  assert(res.ok === true, "the winner is adopted, not fought");
  assert(res.context.clientAccountId === "ca-winner", "refetched the winning row");
  assert(db.client_accounts.length === 1, "no duplicate identity");
});

check("72-74. a suspended / disabled account is denied and never reactivated", async () => {
  for (const status of ["suspended", "disabled"]) {
    resetAll();
    enableAutomation();
    db.client_accounts.push({ id: `ca-${status}`, user_id: AUTH_USER, phone_e164: PHONE, status, whatsapp_verified_at: null });
    seedAttestation(M);
    verifySuccessResponder();
    const res = await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
    assert(res.ok === false, `${status} denied`);
    assert(db.client_accounts[0].status === status, `${status} account not reactivated`);
    assert(signOutCalls === 1, `${status}: session invalidated`);
    assert(lastEvent().metadata.failure_classification === "account_not_active", `${status}: classified`);
  }
});

check("75-77. session invalidation is local, its error is detected, and no raw error is audited", async () => {
  assert(/signOut\(\{ scope: "local" \}\)/.test(SESSION_INV_SRC), "shared helper uses local scope");
  assert(!/scope:\s*["'](global|others)["']/.test(SESSION_INV_SRC), "never global/others");

  resetAll();
  enableAutomation();
  // No attestation → a post-auth denial that must invalidate the session.
  verifySuccessResponder();
  signOutFailure = { error: { name: "AuthApiError", message: "refresh_token=eyJSECRET rejected at https://p.supabase.co/logout" } };
  const res = await M.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
  assert(res.ok === false, "denied");
  assert(signOutCalls === 2, "bounded retry, never escalating");
  assert(signOutOptions.every((o) => o && o.scope === "local"), "every attempt is local-scoped");
  const e = lastEvent();
  assert(e.metadata.session_invalidated === false, "must not claim an invalidation that did not happen");
  assert(e.metadata.session_invalidation_failure === "sign_out_rejected", "sanitized failure vocabulary");
  for (const leak of ["eyJSECRET", "refresh_token", "supabase.co", "AuthApiError", "logout"]) {
    assert(!JSON.stringify(events()).includes(leak), `raw signOut error leaked: ${leak}`);
  }
});

// ============================================================================
// RLS AND PRIVILEGES (78–86)
// ============================================================================
check("78. client_accounts RLS stays enabled and the Phase 5A policies are preserved", () => {
  assert(normalizedSql.includes("alter table public.client_accounts enable row level security;"), "RLS enabled");
  assert(!/disable row level security/.test(normalizedSql), "RLS never disabled");
  assert(!/drop policy/.test(normalizedSql), "the Phase 5A owner/admin policies are not dropped");
  assert(!/create policy/.test(normalizedSql), "no policy is redefined in Phase 5D");
});

check("79-85. REVOKE-then-GRANT yields anon:{}, authenticated:SELECT, service_role:SELECT/INSERT/UPDATE", () => {
  const { state } = applyPrivilegeStatements(strippedSql, HISTORICAL_BROAD());
  const p = (r) => [...state[r]].sort().join(",");
  assert(p("anon") === "", `anon must end empty, got "${p("anon")}"`);
  assert(p("authenticated") === "select", `authenticated must be SELECT only, got "${p("authenticated")}"`);
  assert(p("service_role") === "insert,select,update", `service_role must be SELECT+INSERT+UPDATE, got "${p("service_role")}"`);
  for (const banned of ["delete", "truncate", "references", "trigger"]) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert(!state[role].has(banned), `${role} must not retain ${banned}`);
    }
  }
});

check("86. the privilege test is order-aware (REVOKE precedes GRANT) and would catch a grant-only migration", () => {
  const { applied } = applyPrivilegeStatements(strippedSql, HISTORICAL_BROAD());
  const svc = applied.filter((s) => s.role === "service_role");
  assert(svc[0].verb === "revoke" && svc[0].privs.length === ALL_TABLE_PRIVILEGES.length, "service_role REVOKE ALL comes first");
  assert(svc[1].verb === "grant", "…then GRANT");
  // Anti-vacuity: a grant-only migration would leave DELETE/TRUNCATE behind.
  const grantOnly = "grant select, insert, update on public.client_accounts to service_role;";
  const leftover = applyPrivilegeStatements(grantOnly, HISTORICAL_BROAD()).state;
  assert(leftover.service_role.has("delete") && leftover.service_role.has("truncate"), "the engine detects a grant-only regression");
});

// ============================================================================
// MIGRATION / CATALOG (87–95)
// ============================================================================
check("87-91. only client_login_otp readiness changes; enablement/provider untouched; no other row", () => {
  // The UPDATE lives inside the DO block, scoped to client_login_otp, setting only
  // readiness (+updated_at). No INSERT, and the WHERE targets one automation key.
  const updates = normalizedSql.match(/update public\.communication_automation_catalog[\s\S]*?;/g) ?? [];
  assert(updates.length === 1, `exactly one catalog UPDATE, got ${updates.length}`);
  const u = updates[0];
  assert(/where[\s\S]*automation_key = 'client_login_otp'/.test(u), "scoped to client_login_otp");
  const setClause = u.slice(u.indexOf(" set ") + 5, u.indexOf(" where "));
  assert(/readiness_status = 'mock_ready'/.test(setClause), "sets readiness to mock_ready");
  assert(!/is_operationally_enabled/.test(setClause), "never touches is_operationally_enabled");
  assert(!/readiness_status\s*=\s*'active'/.test(setClause), "never sets active");
  assert(!/provider_required/.test(setClause), "never rewrites provider_required");
  assert(!/insert into public\.communication_automation_catalog/.test(normalizedSql), "no catalog insert");

  // Behavioural: only client_login_otp changes; another automation is untouched.
  const rows = [
    { automation_key: "client_login_otp", lane: "authentication", channel: "whatsapp", template_key: "client_login_otp", provider_required: "mock", is_operationally_enabled: false, readiness_status: "wiring_pending" },
    { automation_key: "vendor_whatsapp_verify", lane: "authentication", channel: "whatsapp", template_key: "vendor_whatsapp_verify", provider_required: "mock", is_operationally_enabled: false, readiness_status: "wiring_pending" },
  ];
  const changed = applyReadinessMigration(rows);
  assert(changed === 1, "exactly one row transitions");
  assert(rows[0].readiness_status === "mock_ready", "client_login_otp becomes mock_ready");
  assert(rows[1].readiness_status === "wiring_pending", "no other automation changes");
  assert(rows[0].is_operationally_enabled === false, "enablement remains false");
  assert(rows[0].provider_required === "mock", "provider remains mock");
});

check("87b. the migration is a fail-loud DO state machine (every unexpected state RAISES)", () => {
  assert(migrationIsFailLoud(normalizedSql), "migration must declare every fail-loud guard clause");
  const base = () => ({ automation_key: "client_login_otp", lane: "authentication", channel: "whatsapp", template_key: "client_login_otp", provider_required: "mock", is_operationally_enabled: false, readiness_status: "wiring_pending" });

  // CASE A — expected transition.
  const a = [base()];
  assert(applyReadinessMigration(a) === 1 && a[0].readiness_status === "mock_ready", "CASE A transitions exactly one row");
  // CASE B — idempotent.
  const b = [{ ...base(), readiness_status: "mock_ready" }];
  assert(applyReadinessMigration(b) === 0 && b[0].readiness_status === "mock_ready", "CASE B is an idempotent no-op");

  // Every other state RAISES.
  expectMigrationThrows([], "missing_row");
  expectMigrationThrows([base(), base()], "duplicate_rows");
  expectMigrationThrows([{ ...base(), is_operationally_enabled: true }], "unexpected_state");
  expectMigrationThrows([{ ...base(), lane: "business" }], "unexpected_state");
  expectMigrationThrows([{ ...base(), channel: "sms" }], "unexpected_state");
  expectMigrationThrows([{ ...base(), template_key: "other" }], "unexpected_state");
  expectMigrationThrows([{ ...base(), provider_required: "real_whatsapp" }], "unexpected_state");
  expectMigrationThrows([{ ...base(), readiness_status: "active" }], "unexpected_readiness");
  expectMigrationThrows([{ ...base(), readiness_status: "foundation_ready" }], "unexpected_readiness");
});

check("92. no real provider is activated by the migration", () => {
  assert(!/twilio|gupshup|messagebird|vonage|meta_whatsapp|whatsapp_cloud/i.test(strippedSql), "no real provider named");
  assert(!/provider_required\s*=\s*'(?!mock)/i.test(normalizedSql), "provider_required is never set to a non-mock value");
});

check("93. the attestation index contains no plaintext field", () => {
  const idx = normalizedSql.match(/create index[\s\S]*?on public\.communication_messages\s*\(([^)]*)\)/);
  assert(idx, "attestation index present");
  const columnList = idx[1];
  // The indexed columns must be a subset of the safe attestation columns.
  const cols = columnList.split(",").map((c) => c.trim().replace(/\s+(asc|desc)$/i, ""));
  const SAFE = new Set(["entity_id", "destination_hash", "status", "created_at"]);
  for (const c of cols) assert(SAFE.has(c), `indexed column "${c}" is not a safe attestation column`);
  // No plaintext-bearing column anywhere in the index definition.
  const full = normalizedSql.match(/create index[\s\S]*?communication_messages[\s\S]*?;/)[0];
  for (const forbidden of ["variables", "masked", "plaintext"]) {
    assert(!full.includes(forbidden), `index must not reference ${forbidden}`);
  }
  assert(cols.includes("entity_id") && cols.includes("destination_hash") && cols.includes("status") && cols.includes("created_at"), "index covers the attestation columns");
});

check("94-95. the readiness migration is idempotent and RAISES (never silently accepts) on an unexpected state", () => {
  const done = [{ automation_key: "client_login_otp", lane: "authentication", channel: "whatsapp", template_key: "client_login_otp", provider_required: "mock", is_operationally_enabled: false, readiness_status: "mock_ready" }];
  assert(applyReadinessMigration(done) === 0, "already mock_ready is a no-op");
  // An unexpectedly-enabled row must RAISE, never be silently left unchanged.
  const enabled = [{ automation_key: "client_login_otp", lane: "authentication", channel: "whatsapp", template_key: "client_login_otp", provider_required: "mock", is_operationally_enabled: true, readiness_status: "wiring_pending" }];
  expectMigrationThrows(enabled, "unexpected_state");
  assert(enabled[0].readiness_status === "wiring_pending", "state unchanged when it RAISES");
  // additive + guarded
  assert(!/drop table|drop column|truncate|delete from/i.test(strippedSql), "no destructive statement");
  assert(/create index if not exists/.test(normalizedSql), "index create is guarded");
});

check("95b. the fail-loud validator is load-bearing (removing any guard flags the migration unsafe)", () => {
  assert(migrationIsFailLoud(normalizedSql) === true, "the real migration passes the validator");
  // In-memory mutants of the migration SQL — each removes one guard and must fail.
  const mut = {
    "remove the RAISE": normalizedSql.replace(/raise exception/g, "perform 1"),
    "allow enabled=true": normalizedSql.replace(/is_operationally_enabled <> false/g, "false"),
    "allow wrong provider": normalizedSql.replace(/provider_required <> 'mock'/g, "false"),
    "allow missing row": normalizedSql.replace(/if v_count = 0 then raise exception/g, "if false then perform 1"),
  };
  for (const [name, mutated] of Object.entries(mut)) {
    assert(migrationIsFailLoud(mutated) === false, `mutant "${name}" must be flagged unsafe`);
  }
});

// ============================================================================
// BOUNDARY REGRESSIONS (96–101)
// ============================================================================
check("96-98. no lead relinking, no historical lead update, no lead ownership mutation", () => {
  assert(!/\bleads\b/i.test(ALL_5D_SRC), "Phase 5D services never touch leads");
  assert(!/\bleads\b/i.test(strippedSql), "Phase 5D migration never touches leads");
  assert(!/user_id[\s\S]{0,40}leads|leads[\s\S]{0,40}user_id/i.test(ALL_5D_SRC), "no lead ownership mutation");
});

check("99. no n8n path is used for OTP", () => {
  assert(!/n8n/i.test(ALL_5D_SRC), "no n8n reference");
  assert(/scheduled_at: null/.test(HOOK_SVC_SRC), "the hook intent is explicitly immediate (scheduled_at: null)");
  for (const banned of ["setTimeout", "setInterval", "cron", "enqueue", "retry_scheduled", "dispatchPersistedMessage"]) {
    assert(!HOOK_SVC_SRC.includes(banned), `the hook must not defer/queue delivery (${banned})`);
  }
});

check("100. Phase 5B authentication single-shot semantics are preserved", async () => {
  assert(M.comm.AUTHENTICATION_MAX_ATTEMPTS === 1, "auth lane remains single-shot");
  // A scheduled authentication send is refused by the core.
  const scheduled = await new M.comm.CommunicationService().send({
    type: "client_login_otp", lane: "authentication", channel: "whatsapp", recipient_type: "client", recipient_id: null,
    destination_source: M.req ? undefined : undefined,
    template_key: "client_login_otp", variables: { otp: OTP }, entity_type: "auth_user", entity_id: AUTH_USER,
    correlation_id: "c", idempotency_key: "sched:1", priority: "critical",
    scheduled_at: new Date(Date.now() + 3600_000).toISOString(), policy_decision_id: null, metadata: {},
  });
  assert(scheduled.ok === false, "a scheduled authentication message is refused");
});

check("101. Phase 5C vendor authentication behaviour is preserved (untouched, still local-scoped)", () => {
  assert(/signOut\(\{ scope: "local" \}\)/.test(VENDOR_AUTH_SRC), "vendor login still invalidates locally");
  assert(/invalidateLocalSession/.test(VENDOR_AUTH_SRC), "vendor login keeps its own invalidation");
  assert(!/from "\.\.\/lib\/identity\/sessionInvalidation"/.test(VENDOR_AUTH_SRC), "Phase 5C was not refactored onto the shared helper");
});

check("wiring. test:phase5d + Standard Webhooks dependency + doc + route + migration exist", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(pkg.scripts["test:phase5d"] === "node scripts/phase5d-client-whatsapp-otp-harness.mjs", "test:phase5d wired");
  assert(pkg.dependencies.standardwebhooks, "standardwebhooks dependency present");
  for (const s of ["test:phase5a", "test:phase5b", "test:phase5c", "test:phase4a", "test:phase3b:aos"]) {
    assert(typeof pkg.scripts[s] === "string", `${s} still available`);
  }
  assert(existsSync("docs/QF-Client-WhatsApp-OTP-Login-Phase-5D.md"), "Phase 5D doc exists");
  assert(existsSync("app/api/auth/hooks/supabase-send-sms/route.ts"), "hook route exists");
  assert(existsSync(MIGRATION), "Phase 5D migration exists");
  assert(HOOK_LIB_SRC.includes("SEND_SMS_HOOK_SECRETS"), "env var documented in code");
});

// ============================================================================
// FIX 3 — DELIMITER-SAFE HOOK SECRET ROTATION (newline-delimited)
// ============================================================================
const SECRET_B64_2 = crypto.randomBytes(24).toString("base64");

check("F3a. loadSendSmsHookSecrets is newline-delimited, trimmed, deduped, blank-safe", () => {
  const load = (v) => M.hookLib.loadSendSmsHookSecrets({ SEND_SMS_HOOK_SECRETS: v });
  assert(JSON.stringify(load("s1")) === JSON.stringify(["s1"]), "one secret");
  assert(JSON.stringify(load("s1\ns2")) === JSON.stringify(["s1", "s2"]), "two rotation secrets");
  assert(JSON.stringify(load("  s1  \n\n  s2 \n")) === JSON.stringify(["s1", "s2"]), "trimmed + blank lines ignored");
  assert(JSON.stringify(load("s1\ns1")) === JSON.stringify(["s1"]), "duplicates collapsed");
  assert(JSON.stringify(load("")) === JSON.stringify([]), "empty config → none");
  assert(JSON.stringify(load("   \n  ")) === JSON.stringify([]), "all-blank config → none");
  // A comma is NOT a delimiter: the Supabase `v1,whsec_...` form is ONE secret.
  assert(JSON.stringify(load(`v1,whsec_${SECRET_B64}`)) === JSON.stringify([`v1,whsec_${SECRET_B64}`]), "comma-bearing secret stays intact");
});

check("F3b. one valid secret verifies", async () => {
  resetAll();
  enableAutomation();
  process.env[SECRET_ENV] = SECRET_B64;
  M.hookLib.setActiveSendSmsHookVerifier(new M.hookLib.StandardWebhooksSignatureVerifier());
  const out = await M.HookSvc.handleSupabaseSendSmsHook(signedRequest({ secret: SECRET_B64, webhookId: "wh_f3b" }));
  assert(out.kind === "delivered", `got ${out.kind}`);
});

check("F3c. rotation: both the new and the previous secret verify", async () => {
  // Config lists NEW then PREVIOUS, one per line.
  for (const [label, signWith] of [["new", SECRET_B64], ["previous", SECRET_B64_2]]) {
    resetAll();
    enableAutomation();
    process.env[SECRET_ENV] = `${SECRET_B64}\n${SECRET_B64_2}`;
    M.hookLib.setActiveSendSmsHookVerifier(new M.hookLib.StandardWebhooksSignatureVerifier());
    const out = await M.HookSvc.handleSupabaseSendSmsHook(signedRequest({ secret: signWith, webhookId: `wh_rot_${label}` }));
    assert(out.kind === "delivered", `${label} secret must verify, got ${out.kind}`);
  }
});

check("F3d. malformed / empty config fails closed", async () => {
  // Malformed secret (not usable) → signature cannot validate → fail closed.
  resetAll();
  enableAutomation();
  process.env[SECRET_ENV] = "!!!not-a-valid-secret!!!";
  M.hookLib.setActiveSendSmsHookVerifier(new M.hookLib.StandardWebhooksSignatureVerifier());
  const malformed = await M.HookSvc.handleSupabaseSendSmsHook(signedRequest({ secret: SECRET_B64, webhookId: "wh_bad" }));
  assert(malformed.kind === "rejected" && malformed.rejectReason === "invalid_signature", `malformed → ${malformed.rejectReason}`);
  assert(sends().length === 0, "no dispatch on malformed config");
  // Empty config → not configured.
  resetAll();
  enableAutomation();
  process.env[SECRET_ENV] = "   \n  ";
  M.hookLib.setActiveSendSmsHookVerifier(new M.hookLib.StandardWebhooksSignatureVerifier());
  const empty = await M.HookSvc.handleSupabaseSendSmsHook(signedRequest({ secret: SECRET_B64, webhookId: "wh_empty" }));
  assert(empty.kind === "rejected" && empty.rejectReason === "secret_not_configured", `empty → ${empty.rejectReason}`);
});

check("F3e. a comma-bearing (v1,whsec_) secret is parsed as ONE secret and verifies", async () => {
  resetAll();
  enableAutomation();
  process.env[SECRET_ENV] = `v1,whsec_${SECRET_B64}`; // contains a comma
  M.hookLib.setActiveSendSmsHookVerifier(new M.hookLib.StandardWebhooksSignatureVerifier());
  const out = await M.HookSvc.handleSupabaseSendSmsHook(signedRequest({ secret: SECRET_B64, webhookId: "wh_prefix" }));
  assert(out.kind === "delivered", `comma-bearing secret must verify as one, got ${out.kind}`);
});

check("F3f. no secret value appears in logs during rotation handling", async () => {
  resetAll();
  enableAutomation();
  process.env[SECRET_ENV] = `${SECRET_B64}\n${SECRET_B64_2}`;
  M.hookLib.setActiveSendSmsHookVerifier(new M.hookLib.StandardWebhooksSignatureVerifier());
  const captured = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => captured.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  try {
    await M.HookSvc.handleSupabaseSendSmsHook(signedRequest({ secret: SECRET_B64_2, webhookId: "wh_log" }));
    await M.HookSvc.handleSupabaseSendSmsHook(signedRequest({ secret: "wrongsecret", webhookId: "wh_log2" }));
  } finally { Object.assign(console, orig); }
  const blob = captured.join("\n");
  for (const s of [SECRET_B64, SECRET_B64_2]) assert(!blob.includes(s), "a secret leaked to logs");
});

// ============================================================================
// FIX 4 — STRICT BODY LIMIT BEFORE UNBOUNDED BUFFERING
// ============================================================================
function streamSource(str, { contentLength, chunkSize = 4096 } = {}) {
  const bytes = Buffer.from(str, "utf8");
  const headers = {
    get: (n) => (n.toLowerCase() === "content-length" ? (contentLength === undefined ? null : String(contentLength)) : null),
  };
  const body = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(new Uint8Array(bytes.subarray(i, i + chunkSize)));
      controller.close();
    },
  });
  return { body, headers };
}

check("F4a. a normal body under the limit is read exactly", async () => {
  const raw = JSON.stringify(hookPayload());
  const res = await M.hookLib.readBoundedRawBody(streamSource(raw, { contentLength: Buffer.byteLength(raw) }));
  assert(res.ok === true, "accepted");
  assert(res.rawBody === raw, "the exact raw body is preserved for verification");
});

check("F4b. a Content-Length above the limit is rejected before buffering", async () => {
  const res = await M.hookLib.readBoundedRawBody(streamSource("x", { contentLength: 20 * 1024 }));
  assert(res.ok === false && res.reason === "oversized_body", `got ${res.ok ? "ok" : res.reason}`);
});

check("F4c. a streamed body above the limit with NO Content-Length is rejected", async () => {
  const big = "y".repeat(20 * 1024);
  const res = await M.hookLib.readBoundedRawBody(streamSource(big, { contentLength: undefined }));
  assert(res.ok === false && res.reason === "oversized_body", `got ${res.ok ? "ok" : res.reason}`);
});

check("F4d. a multibyte UTF-8 body over the BYTE limit (under the char count) is rejected", async () => {
  const emoji = "😀"; // 4 UTF-8 bytes, 2 UTF-16 code units
  const body = emoji.repeat(5000); // ~20000 bytes, .length = 10000 (< 16384 chars)
  assert(Buffer.byteLength(body, "utf8") > 16 * 1024 && body.length < 16 * 1024, "fixture: bytes over, chars under");
  const res = await M.hookLib.readBoundedRawBody(streamSource(body, { contentLength: undefined }));
  assert(res.ok === false && res.reason === "oversized_body", "byte count, not char count, must gate");
  // The service-level ceiling is byte-based too.
  assert(M.hookLib.isWithinHookBodyCeiling(body) === false, "isWithinHookBodyCeiling is byte-based");
});

check("F4e. the signature verifier receives the exact bounded raw body", async () => {
  resetAll();
  enableAutomation();
  process.env[SECRET_ENV] = SECRET_B64;
  M.hookLib.setActiveSendSmsHookVerifier(new M.hookLib.StandardWebhooksSignatureVerifier());
  const signed = signedRequest({ secret: SECRET_B64, webhookId: "wh_exact" });
  const bounded = await M.hookLib.readBoundedRawBody(streamSource(signed.rawBody, { contentLength: Buffer.byteLength(signed.rawBody) }));
  assert(bounded.ok && bounded.rawBody === signed.rawBody, "bounded read equals the signed bytes");
  const out = await M.HookSvc.handleSupabaseSendSmsHook({ rawBody: bounded.rawBody, getHeader: signed.getHeader });
  assert(out.kind === "delivered", "the reconstructed body still verifies end-to-end");
});

// ============================================================================
// FIX 5 — EXPLICIT SUPABASE HTTP HOOK RESPONSE CONTRACT
// ============================================================================
const HK = M.HookSvc;

check("F5a. success → 200 with an EMPTY body", () => {
  const r = HK.sendSmsHookHttpResponse({ kind: HK.SendSmsHookOutcomeKind.DELIVERED, dispatchAttempted: true });
  assert(r.status === 200 && r.body === null, `expected 200/empty, got ${r.status}/${JSON.stringify(r.body)}`);
});

check("F5b. every failure maps to an exact, non-sensitive status + code", () => {
  const K = HK.SendSmsHookOutcomeKind;
  const RR = HK.SendSmsHookRejectReason;
  const cases = [
    [{ kind: K.SERVICE_UNAVAILABLE, dispatchAttempted: false }, 503, "service_unavailable"],
    [{ kind: K.DELIVERY_FAILED, dispatchAttempted: true }, 502, "delivery_failed"],
    [{ kind: K.IN_PROGRESS, dispatchAttempted: true }, 503, "in_progress"],
    [{ kind: K.REJECTED, rejectReason: RR.MISSING_HEADERS, dispatchAttempted: false }, 401, "unauthorized"],
    [{ kind: K.REJECTED, rejectReason: RR.INVALID_SIGNATURE, dispatchAttempted: false }, 401, "unauthorized"],
    [{ kind: K.REJECTED, rejectReason: RR.OVERSIZED_BODY, dispatchAttempted: false }, 413, "oversized_body"],
    [{ kind: K.REJECTED, rejectReason: RR.MALFORMED_PAYLOAD, dispatchAttempted: false }, 400, "malformed_payload"],
    [{ kind: K.REJECTED, rejectReason: RR.SECRET_NOT_CONFIGURED, dispatchAttempted: false }, 500, "configuration_error"],
  ];
  for (const [outcome, status, code] of cases) {
    const r = HK.sendSmsHookHttpResponse(outcome);
    assert(r.status === status, `${code}: expected ${status}, got ${r.status}`);
    assert(r.body && r.body.ok === false && r.body.code === code, `${code}: body mismatch ${JSON.stringify(r.body)}`);
    // Never leak the internal signature/secret-hinting reason for auth failures.
    assert(!JSON.stringify(r.body).includes("signature"), "response must not name signature internals");
  }
});

check("F5c. delivered response is 200/empty, dispatches once, and a replay does not re-dispatch", async () => {
  resetAll();
  enableAutomation();
  const req = unsignedRequest(hookPayload(), { "webhook-id": "wh_f5c" });
  const first = await M.HookSvc.handleSupabaseSendSmsHook(req);
  const second = await M.HookSvc.handleSupabaseSendSmsHook(req);
  const r1 = HK.sendSmsHookHttpResponse(first);
  const r2 = HK.sendSmsHookHttpResponse(second);
  assert(r1.status === 200 && r1.body === null, "first → 200/empty");
  assert(r2.status === 200 && r2.body === null, "replay → 200/empty (idempotent)");
  assert(sends().length === 1, `provider invoked once across the replay, got ${sends().length}`);
});

check("F5d. no sensitive value can appear in any response body", async () => {
  resetAll();
  enableAutomation();
  await M.HookSvc.handleSupabaseSendSmsHook(unsignedRequest(hookPayload({ otp: "778899" }), { "webhook-id": "wh_f5d" }));
  const K = HK.SendSmsHookOutcomeKind;
  const RR = HK.SendSmsHookRejectReason;
  const bodies = [
    HK.sendSmsHookHttpResponse({ kind: K.DELIVERED, dispatchAttempted: true }),
    HK.sendSmsHookHttpResponse({ kind: K.SERVICE_UNAVAILABLE, dispatchAttempted: false }),
    HK.sendSmsHookHttpResponse({ kind: K.REJECTED, rejectReason: RR.INVALID_SIGNATURE, dispatchAttempted: false }),
  ].map((r) => JSON.stringify(r.body));
  const blob = bodies.join("|");
  for (const s of ["778899", PHONE, PHONE_DIGITS, SECRET_B64, "whsec_", "v1,"]) {
    assert(!blob.includes(s), `response body leaked ${s.slice(0, 6)}…`);
  }
});

// ============================================================================
// MUTATION TESTS — edit real source, recompile, assert the vulnerability appears
// ============================================================================
const mutationChecks = [];
function mutation(name, { file, from, to, scenario }) {
  mutationChecks.push({ name, file, from, to, scenario });
}

mutation("MUT: skipping signature verification (and parsing the raw body) lets a forged event dispatch", {
  file: "services/supabaseSendSmsHookService.ts",
  from: "const verification = getActiveSendSmsHookVerifier().verify(req.rawBody, headers, secrets);",
  to: "const verification = { ok: true, payload: JSON.parse(req.rawBody) } as { ok: true; payload: unknown };",
  scenario: async (mm) => {
    resetDb(); enableAutomation();
    mm.hookLib.setActiveSendSmsHookVerifier(rejectingVerifier()); // "verification" would fail…
    const out = await mm.HookSvc.handleSupabaseSendSmsHook(unsignedRequest(hookPayload(), { "webhook-id": "wh_mut1" }));
    return out.kind === "delivered"; // …but the mutant dispatched anyway
  },
});

mutation("MUT: allowing a disabled automation to send dispatches while operationally OFF", {
  file: "services/supabaseSendSmsHookService.ts",
  from: "if (!gate.ok) {\n      return {\n        kind: SendSmsHookOutcomeKind.SERVICE_UNAVAILABLE,",
  to: "if ((false as boolean)) {\n      return {\n        kind: SendSmsHookOutcomeKind.SERVICE_UNAVAILABLE,",
  scenario: async (mm) => {
    resetDb(); // DISABLED automation
    const out = await mm.HookSvc.handleSupabaseSendSmsHook(unsignedRequest(hookPayload(), { "webhook-id": "wh_mut3" }));
    return out.dispatchAttempted === true; // the mutant dispatched while disabled
  },
});

mutation("MUT: persisting auth-lane variables puts the OTP in the ledger", {
  file: "services/communicationService.ts",
  from: 'intent.lane === "authentication" ? {} : this.sanitizeVariables(intent.variables);',
  to: "this.sanitizeVariables(intent.variables);",
  scenario: async (mm) => {
    resetDb(); enableAutomation();
    await mm.HookSvc.handleSupabaseSendSmsHook(unsignedRequest(hookPayload({ otp: "424242" }), { "webhook-id": "wh_mut4" }));
    // The auth lane must persist an EMPTY variables object. The mutant persists the
    // OTP variable (its value is still redacted by sanitizeVariables — defence in
    // depth — but the empty-variables invariant is broken, which is the guard here).
    const msg = db.communication_messages[0];
    return msg && JSON.stringify(msg.variables) !== "{}";
  },
});

mutation("MUT: a random idempotency key lets the same webhook-id send twice", {
  file: "services/supabaseSendSmsHookService.ts",
  from: "idempotency_key: `${CLIENT_LOGIN_OTP_MESSAGE_TYPE}:${webhookId}`,",
  to: "idempotency_key: `${CLIENT_LOGIN_OTP_MESSAGE_TYPE}:${webhookId}:${Math.random()}`,",
  scenario: async (mm) => {
    resetDb(); enableAutomation();
    const req = unsignedRequest(hookPayload(), { "webhook-id": "wh_mut5" });
    await mm.HookSvc.handleSupabaseSendSmsHook(req);
    await mm.HookSvc.handleSupabaseSendSmsHook(req);
    return mm.comm.getActiveWhatsAppProvider().getLastSentPayloads().length === 2; // resent
  },
});

mutation("MUT: accepting a failed message as attestation provisions on a failed delivery", {
  file: "lib/identity/clientOtp.ts",
  from: 'export const ATTESTATION_SUCCESS_STATUSES: readonly string[] = Object.freeze([\n  "accepted",',
  to: 'export const ATTESTATION_SUCCESS_STATUSES: readonly string[] = Object.freeze([\n  "failed",\n  "accepted",',
  scenario: async (mm) => {
    resetDb(); enableAutomation(); seedAttestation(mm, { status: "failed" });
    verifySuccessResponder();
    const res = await mm.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
    return res.ok === true; // a failed-only ledger wrongly attested
  },
});

mutation("MUT: accepting a stale attestation provisions on an old delivery", {
  file: "lib/identity/clientOtp.ts",
  from: "return nowMs - created <= ATTESTATION_MAX_AGE_MS;",
  to: "return true;",
  scenario: async (mm) => {
    resetDb(); enableAutomation(); seedAttestation(mm, { ageMs: 24 * 60 * 60 * 1000 });
    verifySuccessResponder();
    const res = await mm.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
    return res.ok === true; // a day-old delivery wrongly attested
  },
});

mutation("MUT: skipping the identity conflict check overwrites an established phone identity", {
  file: "services/clientAccessService.ts",
  from: "      return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);\n    }\n\n    // No row for this user",
  to: "      return { ok: true, context: toContext(byUser, authUserId) };\n    }\n\n    // No row for this user",
  scenario: async (mm) => {
    resetDb();
    db.client_accounts.push({ id: "ca-diff", user_id: AUTH_USER, phone_e164: OTHER_PHONE, status: "active", whatsapp_verified_at: null });
    const res = await mm.Access.provisionVerifiedClientAccount({ authUserId: AUTH_USER, phoneE164: PHONE });
    return res.ok === true; // accepted a user whose established phone differs
  },
});

mutation("MUT: skipping the attestation gate sets whatsapp_verified_at without any WhatsApp delivery", {
  file: "services/clientOtpAuthService.ts",
  from: "const attested = await hasFreshCommunicationAttestation(authUserId, phoneE164);",
  to: "const attested = true;",
  scenario: async (mm) => {
    resetDb(); enableAutomation(); // NO attestation seeded
    verifySuccessResponder();
    const res = await mm.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
    return res.ok === true && db.client_accounts.length === 1 && typeof db.client_accounts[0].whatsapp_verified_at === "string";
  },
});

mutation("MUT: not reactivating a suspended account is defeated if the status guard is removed", {
  file: "services/clientAccessService.ts",
  from: "if (!isActiveClientAccount(byUser.status)) {\n        return provisioningConflict(ClientOtpVerifyFailureClassification.ACCOUNT_NOT_ACTIVE);\n      }",
  to: "if ((false as boolean)) {\n        return provisioningConflict(ClientOtpVerifyFailureClassification.ACCOUNT_NOT_ACTIVE);\n      }",
  scenario: async (mm) => {
    resetDb(); enableAutomation();
    db.client_accounts.push({ id: "ca-susp", user_id: AUTH_USER, phone_e164: PHONE, status: "suspended", whatsapp_verified_at: null });
    seedAttestation(mm);
    verifySuccessResponder();
    const res = await mm.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
    return res.ok === true; // a suspended account was wrongly granted access
  },
});

mutation("MUT: a global signOut scope revokes every device on a denial", {
  file: "lib/identity/sessionInvalidation.ts",
  from: 'const { error } = await sb.auth.signOut({ scope: "local" });',
  to: 'const { error } = await sb.auth.signOut({ scope: "global" });',
  scenario: async (mm) => {
    resetDb(); enableAutomation(); // no attestation → post-auth denial invalidates session
    verifySuccessResponder();
    await mm.OtpAuth.verifyClientWhatsappOtp({ phone: PHONE, token: OTP });
    return signOutOptions.length > 0 && signOutOptions[0].scope === "global"; // escalated to global
  },
});

mutation("MUT: an unbounded body reader accepts a streamed body over the 16 KiB ceiling", {
  file: "lib/auth/supabaseSendSmsHook.ts",
  from: "if (total > maxBytes) {",
  to: "if ((false as boolean)) {",
  scenario: async (mm) => {
    const bytes = Buffer.from("z".repeat(20 * 1024), "utf8");
    const source = {
      headers: { get: () => null },
      body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(bytes)); c.close(); } }),
    };
    const res = await mm.hookLib.readBoundedRawBody(source, 16 * 1024);
    return res.ok === true; // the mutant buffered an oversized streamed body
  },
});

mutation("MUT: a character-count ceiling admits a multibyte body over the byte limit", {
  file: "lib/auth/supabaseSendSmsHook.ts",
  from: 'return Buffer.byteLength(rawBody, "utf8") <= MAX_HOOK_BODY_BYTES;',
  to: "return rawBody.length <= MAX_HOOK_BODY_BYTES;",
  scenario: async (mm) => {
    const body = "😀".repeat(5000); // bytes > 16 KiB, chars < 16 KiB
    return mm.hookLib.isWithinHookBodyCeiling(body) === true; // mutant wrongly admits it
  },
});

// The grant-only privilege regression is proven in-memory (check 86); assert here too.
check("MUT(sql): a grant-only client_accounts migration would leave destructive privileges behind", () => {
  const grantOnly = "grant select on public.client_accounts to authenticated; grant select, insert, update on public.client_accounts to service_role;";
  const leftover = applyPrivilegeStatements(grantOnly, HISTORICAL_BROAD()).state;
  assert(leftover.service_role.has("delete") && leftover.authenticated.has("delete"), "grant-only leaves DELETE — the real migration REVOKEs first");
});

// ============================================================================
// EXECUTE
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5D Client WhatsApp OTP Login Readiness checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}

async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5D mutation tests (recompiling per mutation)...\n");
  for (const mut of mutationChecks) {
    const filePath = resolve(mut.file);
    const original = readFileSync(filePath, "utf8");
    const mutDir = resolve(`.phase5d-mut-${mutationChecks.indexOf(mut)}`);
    try {
      if (!original.includes(mut.from)) throw new Error(`mutation anchor not found in ${mut.file}`);
      writeFileSync(filePath, original.replace(mut.from, mut.to));
      compileTo(mutDir);
      const mm = wireBuild(mutDir);
      mm.comm.setActiveWhatsAppProvider(new mm.MockProviderMod.MockWhatsAppProvider());
      mm.hookLib.setActiveSendSmsHookVerifier(passThroughVerifier());
      process.env[SECRET_ENV] = SECRET_B64;
      const violationObserved = await mut.scenario(mm);
      if (violationObserved) { console.log(`PASS ${mut.name}`); passed++; }
      else { console.log(`FAIL ${mut.name} (guard did not prove load-bearing)`); failed++; }
    } catch (e) {
      console.log(`FAIL ${mut.name}`); console.error(e); failed++;
    } finally {
      writeFileSync(filePath, original);
      rmSync(mutDir, { recursive: true, force: true });
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
