import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

/**
 * Phase 5F-D3-B — OUTBOUND CONSENT ENFORCEMENT.
 *
 * The pure scope registry, the coordinator, CommunicationService's single authoritative gate, and the
 * SMS authentication fallback gate are all driven through INJECTED fakes:
 *   • D2-C is a fake `decide` — the real decision authority is never loaded, never called;
 *   • Supabase is a STUB that throws if touched, plus a small compare-and-set fake table for the
 *     ledger tests (it models the REAL `.eq(id).eq(status)` semantics, so a lost race is a lost race);
 *   • the WhatsApp/SMS providers are fakes that COUNT calls — so "zero provider calls" is proven, not
 *     asserted by inspection.
 *
 * It never connects to Supabase, never reaches Meta/Exotel/any network, and never reads a real
 * credential. Every mutation is restored byte-identically in a `finally` block.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

// The full transitive graph CommunicationService needs, compiled once.
const TS_FILES = [
  "lib/errors.ts",
  "lib/supabase.ts",
  "lib/identity/principal.ts",
  "lib/identity/verification.ts",
  "lib/identity/clientAccount.ts",
  "lib/identity/authSecurityEvent.ts",
  "lib/communication/types.ts",
  "lib/communication/phone.ts",
  "lib/communication/dbErrors.ts",
  "lib/communication/recipientResolver.ts",
  "lib/communication/channelDispatchGuard.ts",
  "lib/communication/whatsappTemplate.ts",
  "lib/communication/approvedTemplateOutbound.ts",
  "lib/communication/providerMappingFingerprint.ts",
  "lib/communication/canonicalJson.ts",
  "lib/communication/providers/whatsappProvider.ts",
  "lib/communication/providers/providerError.ts",
  "lib/communication/providers/mockWhatsAppProvider.ts",
  "lib/communication/outboundConsentScope.ts",
  "services/communicationRecipientResolver.ts",
  "services/communicationService.ts",
  "services/outboundConsentEnforcementService.ts",
];

const SCOPE_SRC = "lib/communication/outboundConsentScope.ts";
const COORD_SRC = "services/outboundConsentEnforcementService.ts";
const COMM_SRC = "services/communicationService.ts";
const RUNTIME_SRC = "services/runtimeCommunicationService.ts";
const ORCH_SRC = "services/clientLoginOtpDeliveryOrchestrator.ts";
const HARNESS_SRC = "scripts/phase5f-d3b-outbound-consent-enforcement-harness.mjs";
const DOC_SRC = "docs/QF-Outbound-Consent-Enforcement-Phase-5F-D3-B.md";

// The frozen consent authorities D3-B may call but must NEVER modify.
const D2C_SRC = "services/communicationConsentDecisionService.ts";
const D2D_WRITER_SRC = "services/communicationConsentWriterService.ts";
const D2D_COMMAND_SRC = "lib/communication/consentCommand.ts";
const POLICY_SRC = "lib/communication/consentPolicy.ts";
const D2E_ORCH_SRC = "services/inboundConsentCommandService.ts";
const D2E_INPUT_SRC = "lib/communication/inboundConsentCommandInput.ts";

/**
 * The 5F-B harness. FOUNDER-APPROVED for ONE compatibility change ONLY: its fake query builder needed an
 * `.in()` method, because the runtime factory now binds the consent enforcer and D2-C's suppression read
 * filters with `.in("scope", …)`. It is admitted to the D3-B delta on that basis alone, and `B4` proves
 * the change really is limited to that method — it removes nothing and weakens no test.
 */
const PHASE5FB_SRC = "scripts/phase5f-b-whatsapp-cloud-api-harness.mjs";
/** The EXACT approved 5F-B addition. Anything else in that file is a scope violation. */
const PHASE5FB_APPROVED_LINE = "in(col, vals) { this.filters.push((row) => vals.includes(row[col])); return this; }";

/**
 * The two legacy SMS-fallback harnesses. FOUNDER-APPROVED to receive an INJECTED TEST CONSENT ENFORCER,
 * because the orchestrator no longer has any implicit allow: absent an injected enforcer it loads the REAL
 * coordinator, which these isolated builds do not contain. The `allow` therefore lives ONLY in their
 * dependency objects — never in production code. `B4` proves they REMOVE nothing (no assertion weakened).
 */
const LEGACY_SMS_HARNESSES = [
  "scripts/phase5f-c3b-client-otp-fallback-harness.mjs",
  "scripts/phase5f-c3c1-client-otp-resolved-sms-harness.mjs",
];

const D3B_EXPECTED_FILES = [
  DOC_SRC,
  "lib/communication/outboundConsentScope.ts",
  "package.json",
  HARNESS_SRC,
  PHASE5FB_SRC,
  ...LEGACY_SMS_HARNESSES,
  "services/clientLoginOtpDeliveryOrchestrator.ts",
  "services/communicationService.ts",
  "services/outboundConsentEnforcementService.ts",
  "services/runtimeCommunicationService.ts",
];

function compileTo(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  const tsconfigPath = resolve(`${outDir}.tsconfig.json`);
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: true, jsx: "preserve",
      outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] }, lib: ["ES2021", "DOM"],
    },
    files: TS_FILES,
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  finally { rmSync(tsconfigPath, { force: true }); }
  return outDir;
}

/** The live fake ledger the stubbed Supabase writes through. Reset per test. */
let TABLE = [];
let DB_THROWS = false;

/**
 * A compare-and-set fake of PostgREST, modelling ONLY what the dispatch path uses. `.eq()` filters are
 * ANDed, exactly as PostgREST does — so `.eq(id).eq(status)` updates ZERO rows when another worker
 * already moved the row. That is what makes the lost-race test real rather than decorative.
 */
function fakeAdminClient() {
  return () => ({
    from: () => {
      const state = { op: null, updates: null, filters: {} };
      const run = () => {
        if (DB_THROWS) throw new Error("db down: SQLSTATE 08006 connection reset by peer");
        const matches = TABLE.filter((r) => Object.entries(state.filters).every(([c, v]) => r[c] === v));
        if (state.op === "update") for (const row of matches) Object.assign(row, state.updates);
        return matches.map((r) => ({ ...r }));
      };
      const builder = {
        update(u) { state.op = "update"; state.updates = u; return builder; },
        insert(r) { state.op = "insert"; state.row = r; return builder; },
        select() { state.selected = true; return builder; },
        eq(col, val) { state.filters[col] = val; return builder; },
        // `.single()` collapses to ONE row (PostgREST semantics) — used by applyMessageUpdate.
        single() { return Promise.resolve().then(() => { const rows = run(); return { data: rows[0] ?? null, error: null }; }); },
        limit() { return Promise.resolve().then(() => ({ data: run(), error: null })); },
        then(onF, onR) {
          return Promise.resolve().then(() => ({ data: run(), error: null })).then(onF, onR);
        },
      };
      return builder;
    },
  });
}

function wireBuild(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const original = Module._load;
  const STUBS = {
    "../lib/supabase": { adminClient: fakeAdminClient() },
  };
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return original.apply(this, [request, parent, isMain]);
  };
  return {
    Scope: req("./lib/communication/outboundConsentScope.js"),
    Coord: req("./services/outboundConsentEnforcementService.js"),
    Comm: req("./services/communicationService.js"),
  };
}

const readF = (f) => readFileSync(f, "utf8");
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }
function gitDirty() {
  return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })
    .split("\n").map((l) => l.slice(3).trim()).filter(Boolean).map((p) => p.replace(/\\/g, "/"))
    .filter((p) => !p.startsWith(".phase5fd3b"));
}

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function has(re, s, msg) { assert(re.test(s), msg); }
function hasNot(re, s, msg) { assert(!re.test(s), msg); }

const MAIN_DIR = resolve(".phase5fd3b-build-main");
compileTo(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// FIXTURES
// ============================================================================
const HASH = "a".repeat(64);
const UUID = "11111111-2222-4333-8444-555555555555";
const PROVIDER_KEY = "mock";
/** The REAL destination + its REAL sha256 — the dispatch path verifies the hash against the row. */
const DEST = "+919812345678";
const DEST_HASH = createHash("sha256").update(DEST).digest("hex");

/** A fake WhatsApp provider that COUNTS network calls. Zero-call assertions are therefore provable. */
function fakeProvider(over = {}) {
  const calls = { send: 0 };
  return {
    calls,
    provider: {
      providerKey: PROVIDER_KEY,
      channel: "whatsapp",
      templateResolutionMode: over.templateResolutionMode ?? "provider_template_name",
      async sendTemplateMessage() { calls.send++; return { accepted: true, providerMessageId: "pm-1", outcomeCertainty: "accepted" }; },
      async sendAuthenticationMessage() { calls.send++; return { accepted: true, providerMessageId: "pm-1", outcomeCertainty: "accepted" }; },
      async sendResolvedTemplate() { calls.send++; return { accepted: true, providerMessageId: "pm-1", outcomeCertainty: "accepted" }; },
    },
  };
}

const fakeResolver = { resolverKey: "fake", async resolveDestination() { return { ok: true, data: DEST }; } };

/** An enforcer that returns a scripted outcome and counts how many times it was consulted. */
function fakeEnforcer(outcome) {
  const calls = [];
  return {
    calls,
    enforcer: {
      async authorize(input) {
        calls.push(input);
        if (typeof outcome === "function") return outcome(input);
        return outcome;
      },
    },
  };
}

const ALLOW = { kind: "allow", scope: "transactional" };
const DENY_SUPPRESSED = { kind: "deny", code: "CONSENT_SUPPRESSED", retryable: false };
const DENY_NOT_GRANTED = { kind: "deny", code: "CONSENT_NOT_GRANTED", retryable: false };
const UNAVAILABLE = { kind: "unavailable", code: "CONSENT_AUTHORITY_UNAVAILABLE", retryable: true };
const INVALID = { kind: "invalid", code: "CONSENT_ENFORCEMENT_INVALID", retryable: false };
const INTEGRITY = { kind: "invalid", code: "CONSENT_AUTHORITY_INTEGRITY", retryable: false };

/** A business (transactional) ledger row, in whatever status the test needs. */
function row(over = {}) {
  return {
    id: "msg-1",
    message_type: "lead_received",
    lane: "business",
    channel: "whatsapp",
    recipient_type: "client",
    recipient_id: UUID,
    destination_source: "recipient_reference",
    destination_hash: DEST_HASH,
    destination_masked: "+91******5678",
    template_key: "lead_received",
    status: "queued",
    attempt_count: 0,
    max_attempts: 5,
    next_retry_at: null,
    scheduled_at: null,
    provider: PROVIDER_KEY,
    failure_code: null,
    failure_reason_sanitized: null,
    failed_at: null,
    variables: {},
    metadata: {},
    ...over,
  };
}
const authRow = (over = {}) => row({
  id: "msg-auth", message_type: "client_login_otp", lane: "authentication",
  template_key: "client_login_otp", destination_source: "ephemeral_auth_destination",
  recipient_id: null, max_attempts: 1, ...over,
});

/** Build a service + drive one dispatch attempt against the fake ledger. */
async function dispatch(message, outcome, over = {}) {
  TABLE = [{ ...message }];
  DB_THROWS = false;
  const p = over.provider ?? fakeProvider();
  const e = fakeEnforcer(outcome);
  const svc = new M.Comm.CommunicationService(p.provider, fakeResolver, null, e.enforcer);
  const res = await svc.dispatchMessage(message, {
    rawVariables: over.rawVariables ?? (message.lane === "authentication" ? { otp: "123456" } : undefined),
    providerTemplateName: "tpl",
    preResolvedDestination: over.preResolvedDestination ?? DEST,
    templateLanguage: "en",
  });
  return { res, providerCalls: p.calls.send, consentCalls: e.calls, stored: TABLE[0] };
}

// ============================================================================
// SCOPE REGISTRY
// ============================================================================
const AUTH_TYPES = ["client_login_otp", "vendor_whatsapp_verify", "vendor_password_reset"];
const TRANSACTIONAL_TYPES = [
  "lead_received", "vendor_new_lead", "clarification_request", "clarification_reminder",
  "lead_assignment_alert", "low_credit_warning", "recharge_reminder",
  "admin_policy_block_alert", "admin_assignment_failure_alert",
  "admin_provider_outage_alert", "admin_automation_failure_alert",
];
const MARKETING_TYPES = ["client_nurture_followup", "dormant_requirement_reactivation"];

check("R1. all 3 authentication message types resolve to the authentication scope (lane: authentication)", () => {
  for (const t of AUTH_TYPES) {
    const r = M.Scope.resolveOutboundConsentScope({ messageType: t, templateKey: t, lane: "authentication" });
    assert(r.ok && r.scope === "authentication", `${t} → authentication`);
  }
  assert(AUTH_TYPES.length === 3, "exactly three authentication types");
});

check("R2. all 11 transactional message types resolve to the transactional scope (lane: business)", () => {
  for (const t of TRANSACTIONAL_TYPES) {
    const r = M.Scope.resolveOutboundConsentScope({ messageType: t, templateKey: t, lane: "business" });
    assert(r.ok && r.scope === "transactional", `${t} → transactional`);
  }
  assert(TRANSACTIONAL_TYPES.length === 11, "exactly eleven transactional types");
});

check("R3. FOUNDER-RATIFIED: both re-engagement types are MARKETING (not transactional)", () => {
  for (const t of MARKETING_TYPES) {
    const r = M.Scope.resolveOutboundConsentScope({ messageType: t, templateKey: t, lane: "business" });
    assert(r.ok && r.scope === "marketing", `${t} → marketing`);
    assert(r.scope !== "transactional", `${t} must NEVER be transactional`);
  }
  assert(MARKETING_TYPES.includes("client_nurture_followup"), "client_nurture_followup is marketing");
  assert(MARKETING_TYPES.includes("dormant_requirement_reactivation"), "dormant_requirement_reactivation is marketing");
});

check("R4. the registry is EXACTLY the 16 approved types and its lane⟷scope invariant holds", () => {
  const all = [...AUTH_TYPES, ...TRANSACTIONAL_TYPES, ...MARKETING_TYPES];
  const registered = [...M.Scope.REGISTERED_MESSAGE_TYPES].sort();
  assert(JSON.stringify(registered) === JSON.stringify([...all].sort()), `registry must be exactly the 16 approved types (got ${registered.length})`);
  assert(M.Scope.assertRegistryInvariants().length === 0, "authentication⟺auth lane, transactional/marketing⟺business lane");
});

check("R5. an UNKNOWN message type is BLOCKED — never transactional, never marketing", () => {
  for (const t of ["", "unknown_thing", "promo_blast", "lead_receive", "LEAD_RECEIVED", "admin_new_alert", null, undefined, 42, {}]) {
    const r = M.Scope.resolveOutboundConsentScope({ messageType: t, templateKey: t, lane: "business" });
    assert(r.ok === false && r.reason === "UNCLASSIFIED_MESSAGE_TYPE", `unknown blocked: ${safeStringify(t)}`);
    assert(!("scope" in r), "an unclassified type NEVER yields a scope");
  }
});

check("R6. NO wildcard / prefix classification (`admin_*` is not a pattern)", () => {
  // Every admin alert is registered EXPLICITLY…
  for (const t of ["admin_policy_block_alert", "admin_assignment_failure_alert", "admin_provider_outage_alert", "admin_automation_failure_alert"]) {
    assert(M.Scope.resolveOutboundConsentScope({ messageType: t, templateKey: t, lane: "business" }).ok, `${t} is explicitly registered`);
  }
  // …and an unregistered `admin_`-prefixed type is still BLOCKED.
  for (const t of ["admin_", "admin_anything", "admin_new_marketing_blast"]) {
    const r = M.Scope.resolveOutboundConsentScope({ messageType: t, templateKey: t, lane: "business" });
    assert(r.ok === false && r.reason === "UNCLASSIFIED_MESSAGE_TYPE", `no prefix rule: ${t}`);
  }
  // The source contains no wildcard/regex/prefix classification.
  const src = stripTs(readF(SCOPE_SRC));
  hasNot(/startsWith\(|\.test\(|RegExp|endsWith\(|includes\(.*admin/, src, "no prefix/regex classification in the registry");
});

check("R7. a message/template MISMATCH is BLOCKED", () => {
  const r = M.Scope.resolveOutboundConsentScope({ messageType: "lead_received", templateKey: "client_nurture_followup", lane: "business" });
  assert(r.ok === false && r.reason === "MESSAGE_TYPE_TEMPLATE_MISMATCH", "a swapped template never inherits another type's scope");
  for (const bad of ["", "other", null, undefined, 42]) {
    const x = M.Scope.resolveOutboundConsentScope({ messageType: "lead_received", templateKey: bad, lane: "business" });
    assert(x.ok === false && x.reason === "MESSAGE_TYPE_TEMPLATE_MISMATCH", `template mismatch: ${safeStringify(bad)}`);
  }
});

check("R8. a WRONG LANE is BLOCKED", () => {
  const a = M.Scope.resolveOutboundConsentScope({ messageType: "client_login_otp", templateKey: "client_login_otp", lane: "business" });
  assert(a.ok === false && a.reason === "MESSAGE_LANE_SCOPE_MISMATCH", "an auth type declared as business is blocked");
  const b = M.Scope.resolveOutboundConsentScope({ messageType: "client_nurture_followup", templateKey: "client_nurture_followup", lane: "authentication" });
  assert(b.ok === false && b.reason === "MESSAGE_LANE_SCOPE_MISMATCH", "a marketing type declared as authentication is blocked");
  // …a marketing type can NEVER be laundered into the authentication scope by a lane swap.
  assert(b.ok === false && !("scope" in b), "no scope is produced on a lane mismatch");
});

check("R9. the registry is PURE (no I/O, no db, no env, no clock)", () => {
  const src = stripTs(readF(SCOPE_SRC));
  hasNot(/adminClient|supabase|fetch\(|process\.env|console\.|Date\.now\(|Math\.random|import .*services\//i, src, "the registry is pure");
});

// ============================================================================
// COORDINATOR
// ============================================================================
const capture = () => {
  const seen = [];
  return { seen, deps: (outcome) => ({ decide: async (i) => { seen.push(i); return typeof outcome === "function" ? outcome(i) : outcome; } }) };
};
const decided = (o) => ({ decide: async () => o });
const ok2 = (disposition) => ({ ok: true, disposition, reasonCode: "x", policyVersion: "qf-consent-v1", principalConfidence: "exact", matchedPreferenceId: "pref-1", matchedSuppressionId: "supp-1", suppressionReason: "user_stop", reconsent: "self_service_allowed" });

const enforce = (over, deps) => M.Coord.authorizeOutboundConsent({
  channel: "whatsapp", messageType: "lead_received", templateKey: "lead_received", lane: "business",
  destinationHash: HASH, destinationSource: "recipient_reference", recipientType: "client", recipientId: UUID,
  ...over,
}, deps);

check("C1. AUTHENTICATION: no_consent_objection → allow; blocked → deny", async () => {
  const base = { messageType: "client_login_otp", templateKey: "client_login_otp", lane: "authentication" };
  const a = await enforce(base, decided(ok2("no_consent_objection")));
  assert(a.kind === "allow" && a.scope === "authentication", "auth no_consent_objection allows the CONSENT LAYER");
  const b = await enforce(base, decided(ok2("blocked")));
  assert(b.kind === "deny" && b.code === "CONSENT_SUPPRESSED", "auth blocked → deny");
});

check("C2. AUTHENTICATION: any unexpected disposition FAILS CLOSED", async () => {
  const base = { messageType: "client_login_otp", templateKey: "client_login_otp", lane: "authentication" };
  for (const d of ["marketing_opted_in", "unknown", "allowed", "", null, undefined, 42]) {
    const r = await enforce(base, decided(ok2(d)));
    assert(r.kind === "invalid" && r.code === "CONSENT_ENFORCEMENT_INVALID", `auth unexpected '${safeStringify(d)}' fails closed`);
    assert(r.kind !== "allow", "an unexpected disposition NEVER allows");
  }
});

check("C3. TRANSACTIONAL: no_consent_objection → allow; blocked → deny; unexpected fails closed", async () => {
  const a = await enforce({}, decided(ok2("no_consent_objection")));
  assert(a.kind === "allow" && a.scope === "transactional", "transactional no_consent_objection allows");
  const b = await enforce({}, decided(ok2("blocked")));
  assert(b.kind === "deny" && b.code === "CONSENT_SUPPRESSED", "transactional blocked → deny");
  for (const d of ["marketing_opted_in", "unknown", "yes"]) {
    const r = await enforce({}, decided(ok2(d)));
    assert(r.kind === "invalid", `transactional unexpected '${d}' fails closed`);
  }
});

check("C4. MARKETING DEFAULT-DENY: only marketing_opted_in allows; unknown + blocked deny", async () => {
  const base = { messageType: "client_nurture_followup", templateKey: "client_nurture_followup", lane: "business" };
  const a = await enforce(base, decided(ok2("marketing_opted_in")));
  assert(a.kind === "allow" && a.scope === "marketing", "an explicit opt-in allows");
  const u = await enforce(base, decided(ok2("unknown")));
  assert(u.kind === "deny" && u.code === "CONSENT_NOT_GRANTED", "unknown → DENY (absence of consent is never consent)");
  const b = await enforce(base, decided(ok2("blocked")));
  assert(b.kind === "deny" && b.code === "CONSENT_SUPPRESSED", "blocked → deny");
  for (const d of ["no_consent_objection", "allowed", null]) {
    const r = await enforce(base, decided(ok2(d)));
    assert(r.kind === "invalid", `marketing unexpected '${safeStringify(d)}' fails closed`);
  }
});

check("C5. a STALE marketing preference (D2-C 'unknown') NEVER authorizes marketing", async () => {
  // D2-C returns `unknown` + `preference_policy_version_mismatch` for a stale allowed preference.
  const stale = { ...ok2("unknown"), reasonCode: "preference_policy_version_mismatch" };
  const r = await enforce({ messageType: "dormant_requirement_reactivation", templateKey: "dormant_requirement_reactivation", lane: "business" }, decided(stale));
  assert(r.kind === "deny" && r.code === "CONSENT_NOT_GRANTED", "a stale opt-in is NOT an opt-in");
});

check("C6. D2-C failure mapping: invalid / unavailable / integrity / thrown", async () => {
  const i = await enforce({}, decided({ ok: false, code: "INVALID_DECISION_INPUT" }));
  assert(i.kind === "invalid" && i.code === "CONSENT_ENFORCEMENT_INVALID" && i.retryable === false, "INVALID_DECISION_INPUT → invalid, not retryable");
  const u = await enforce({}, decided({ ok: false, code: "AUTHORITY_LOOKUP_FAILED" }));
  assert(u.kind === "unavailable" && u.code === "CONSENT_AUTHORITY_UNAVAILABLE" && u.retryable === true, "AUTHORITY_LOOKUP_FAILED → unavailable, RETRYABLE");
  const g = await enforce({}, decided({ ok: false, code: "AUTHORITY_INTEGRITY_VIOLATION" }));
  assert(g.kind === "invalid" && g.code === "CONSENT_AUTHORITY_INTEGRITY" && g.retryable === false, "AUTHORITY_INTEGRITY_VIOLATION → invalid, NOT retryable");
  const t = await enforce({}, { decide: async () => { throw new Error("db down: SQLSTATE 08006"); } });
  assert(t.kind === "unavailable" && t.retryable === true, "a THROWN dependency → unavailable, retryable");
  assert(!safeStringify(t).includes("SQLSTATE"), "no raw error leaks");
  const un = await enforce({}, decided({ ok: false, code: "SOMETHING_NEW" }));
  assert(un.kind === "invalid", "an unexpected failure code fails closed");
});

check("C7. an unclassified / mismatched message NEVER reaches D2-C (no DB call at all)", async () => {
  for (const over of [
    { messageType: "promo_blast", templateKey: "promo_blast" },
    { messageType: "lead_received", templateKey: "client_nurture_followup" },
    { messageType: "client_login_otp", templateKey: "client_login_otp", lane: "business" },
  ]) {
    const c = capture();
    const r = await enforce(over, c.deps(ok2("no_consent_objection")));
    assert(r.kind === "deny", "blocked before the authority");
    assert(c.seen.length === 0, `D2-C is NEVER consulted for an unreviewed send: ${safeStringify(over)}`);
  }
  // …and the deny codes are the closed registry reasons.
  const a = await enforce({ messageType: "promo_blast", templateKey: "promo_blast" }, decided(ok2("blocked")));
  assert(a.code === "UNCLASSIFIED_MESSAGE_TYPE", "closed code");
  const b = await enforce({ messageType: "lead_received", templateKey: "x" }, decided(ok2("blocked")));
  assert(b.code === "MESSAGE_TYPE_TEMPLATE_MISMATCH", "closed code");
  const c2 = await enforce({ messageType: "client_login_otp", templateKey: "client_login_otp", lane: "business" }, decided(ok2("blocked")));
  assert(c2.code === "MESSAGE_LANE_SCOPE_MISMATCH", "closed code");
});

check("C8. an EPHEMERAL destination ALWAYS reaches D2-C as unknown/null — recipient_id cannot upgrade it", async () => {
  for (const recipientId of [UUID, null, "not-a-uuid"]) {
    for (const recipientType of ["client", "vendor", "admin"]) {
      const c = capture();
      await M.Coord.authorizeOutboundConsent({
        channel: "whatsapp", messageType: "vendor_whatsapp_verify", templateKey: "vendor_whatsapp_verify",
        lane: "authentication", destinationHash: HASH,
        destinationSource: "ephemeral_auth_destination", recipientType, recipientId,
      }, c.deps(ok2("no_consent_objection")));
      assert(c.seen.length === 1, "D2-C consulted once");
      assert(c.seen[0].identityConfidence === "unknown", `ephemeral is ALWAYS unknown (${recipientType}/${recipientId})`);
      assert(c.seen[0].principal === null, "ephemeral ALWAYS carries a null principal");
    }
  }
  // The pure derivation says the same thing.
  const d = M.Coord.deriveConsentIdentity({ destinationSource: "ephemeral_auth_destination", recipientType: "vendor", recipientId: UUID });
  assert(d.identityConfidence === "unknown" && d.principal === null, "a vendor id NEVER upgrades an ephemeral destination");
});

check("C9. a recipient_reference destination CAN be exact — but only when the binding is provable", async () => {
  const c = capture();
  await enforce({}, c.deps(ok2("no_consent_objection")));
  assert(c.seen[0].identityConfidence === "exact", "recipient_reference + client + UUID → exact");
  assert(c.seen[0].principal.type === "client" && c.seen[0].principal.id === UUID, "the principal is carried");
  // …and anything unprovable stays unknown. Never guessed, never a first match.
  for (const bad of [
    { recipientType: "client", recipientId: null },
    { recipientType: "client", recipientId: "not-a-uuid" },
    { recipientType: "integration", recipientId: UUID },
    { recipientType: "system", recipientId: UUID },
    { recipientType: "", recipientId: UUID },
  ]) {
    const d = M.Coord.deriveConsentIdentity({ destinationSource: "recipient_reference", ...bad });
    assert(d.identityConfidence === "unknown" && d.principal === null, `unprovable stays unknown: ${safeStringify(bad)}`);
  }
});

check("C10. the coordinator OUTPUT leaks nothing (no hash, phone, principal id, matched ids, raw error)", async () => {
  const outcomes = [
    await enforce({}, decided(ok2("no_consent_objection"))),
    await enforce({}, decided(ok2("blocked"))),
    await enforce({ messageType: "client_nurture_followup", templateKey: "client_nurture_followup" }, decided(ok2("unknown"))),
    await enforce({}, decided({ ok: false, code: "AUTHORITY_LOOKUP_FAILED" })),
    await enforce({}, { decide: async () => { throw new Error("boom SQLSTATE 08006 at Object.x"); } }),
    await enforce({ messageType: "promo_blast", templateKey: "promo_blast" }, decided(ok2("blocked"))),
  ];
  for (const o of outcomes) {
    const s = safeStringify(o);
    assert(!s.includes(HASH), "no destination hash");
    assert(!s.includes("+9198"), "no plaintext phone");
    assert(!s.includes(UUID), "no principal id");
    assert(!s.includes("pref-1") && !s.includes("supp-1"), "no matched preference/suppression id");
    assert(!/SQLSTATE|boom|at Object\.|stack|user_stop/i.test(s), "no raw db error / stack / D2-C reason");
    assert(!/disposition|reasonCode|policyVersion/i.test(s), "no D2-C row / disposition leaks into the closed outcome");
  }
});

check("C11. invalid enforcement input fails closed WITHOUT touching the authority", async () => {
  for (const over of [
    { channel: "rcs" }, { channel: "" }, { destinationHash: "nope" }, { destinationHash: "A".repeat(64) },
    { destinationSource: "made_up" },
  ]) {
    const c = capture();
    const r = await enforce(over, c.deps(ok2("no_consent_objection")));
    assert(r.kind === "invalid" && r.code === "CONSENT_ENFORCEMENT_INVALID", `invalid input fails closed: ${safeStringify(over)}`);
    assert(c.seen.length === 0, "no authority call for invalid input");
  }
  // RCS is EXCLUDED from D3-B.
  const rcs = await enforce({ channel: "rcs" }, decided(ok2("no_consent_objection")));
  assert(rcs.kind !== "allow", "RCS is never authorized by D3-B");
});

// ============================================================================
// COMMUNICATIONSERVICE — the one authoritative gate
// ============================================================================
check("S1. ALLOW reaches the claim and the provider; consent is consulted EXACTLY ONCE", async () => {
  const d = await dispatch(row(), ALLOW);
  assert(d.res.ok === true, `the dispatch succeeds (got ${safeStringify(d.res)})`);
  assert(d.consentCalls.length === 1, "EXACTLY ONE consent decision per dispatch attempt");
  assert(d.providerCalls === 1, "the provider was called");
  assert(d.stored.status !== "cancelled", "not cancelled");
});

check("S2. consent runs AFTER destination resolution and BEFORE the claim (source order + behaviour)", async () => {
  const src = readF(COMM_SRC);
  const iResolve = src.indexOf("await this.resolveDispatchDestination(");
  const iConsent = src.indexOf("await this.enforceOutboundConsent(");
  const iClaim = src.indexOf("await this.claimMessageForDispatch(");
  const iInvoke = src.indexOf("await this.invokeProvider(");
  assert(iResolve > 0 && iConsent > 0 && iClaim > 0 && iInvoke > 0, "all four steps exist");
  assert(iResolve < iConsent, "consent runs AFTER destination resolution");
  assert(iConsent < iClaim, "consent runs BEFORE the atomic claim");
  assert(iClaim < iInvoke, "the provider call remains AFTER the claim");
  // Behavioural: a denial leaves the row un-claimed (never 'dispatching').
  const d = await dispatch(row(), DENY_SUPPRESSED);
  assert(d.stored.status === "cancelled", "denied before the claim → cancelled, never dispatching");
});

check("S3. there is NO pre-insert consent read (exactly one gate, in dispatch)", () => {
  const src = stripTs(readF(COMM_SRC));
  const occurrences = (src.match(/this\.enforceOutboundConsent\(/g) || []).length;
  assert(occurrences === 1, `exactly ONE consent gate call site (found ${occurrences})`);
  // …and it is not inside send()'s insert path: the gate sits after resolveDispatchDestination.
  const iInsert = src.indexOf('.from("communication_messages")\n        .insert(');
  const iGate = src.indexOf("this.enforceOutboundConsent(");
  assert(iGate > 0, "the gate exists");
  if (iInsert > 0) assert(iGate > iInsert, "the gate is in the dispatch path, not before the insert");
});

check("S4. BLOCKED → cancelled, ZERO provider calls", async () => {
  const d = await dispatch(row(), DENY_SUPPRESSED);
  assert(d.providerCalls === 0, "ZERO provider calls");
  assert(d.stored.status === "cancelled", "queued → cancelled");
  assert(d.stored.failure_code === "CONSENT_SUPPRESSED", "sanitized closed code");
  assert(d.stored.failed_at === null, "cancelled does NOT stamp failed_at (nothing failed; we declined)");
  assert(d.stored.next_retry_at === null, "next_retry_at cleared");
  assert(d.res.ok === true && d.res.data.status === "cancelled", "the cancelled message is returned");
});

check("S5. MARKETING NOT GRANTED → cancelled, ZERO provider calls", async () => {
  const d = await dispatch(row({ message_type: "client_nurture_followup", template_key: "client_nurture_followup" }), DENY_NOT_GRANTED);
  assert(d.providerCalls === 0, "ZERO provider calls");
  assert(d.stored.status === "cancelled" && d.stored.failure_code === "CONSENT_NOT_GRANTED", "cancelled with the closed code");
});

check("S6. INVALID and INTEGRITY → failed (with failed_at), ZERO provider calls", async () => {
  const i = await dispatch(row(), INVALID);
  assert(i.providerCalls === 0 && i.stored.status === "failed", "invalid → failed");
  assert(i.stored.failed_at !== null, "failed stamps failed_at");
  assert(i.stored.failure_code === "CONSENT_ENFORCEMENT_INVALID", "closed code");
  const g = await dispatch(row(), INTEGRITY);
  assert(g.providerCalls === 0 && g.stored.status === "failed", "integrity → failed");
  assert(g.stored.failure_code === "CONSENT_AUTHORITY_INTEGRITY", "closed code");
});

check("S7. AUTHORITY UNAVAILABLE: an AUTH message FAILS (the OTP can never be re-dispatched)", async () => {
  const d = await dispatch(authRow(), UNAVAILABLE);
  assert(d.providerCalls === 0, "ZERO provider calls");
  assert(d.stored.status === "failed", "an authentication row becomes failed, never left queued");
  assert(d.stored.failure_code === "CONSENT_AUTHORITY_UNAVAILABLE", "closed code");
  assert(d.res.ok === true && d.res.data.status === "failed", "the failed message is returned");
});

check("S8. AUTHORITY UNAVAILABLE: a BUSINESS message is LEFT UNCHANGED and is retryable", async () => {
  for (const status of ["queued", "retry_scheduled"]) {
    const d = await dispatch(row({ status }), UNAVAILABLE);
    assert(d.providerCalls === 0, "ZERO provider calls");
    assert(d.stored.status === status, `a transient authority blip must NOT destroy a business message (stayed ${status})`);
    assert(d.stored.failure_code === null, "the ledger is not written at all");
    assert(d.res.ok === false && d.res.code === "CONSENT_AUTHORITY_UNAVAILABLE", "a sanitized RETRYABLE failure is returned");
  }
});

check("S9. cancellation is legal from BOTH queued and retry_scheduled", async () => {
  for (const status of ["queued", "retry_scheduled"]) {
    const d = await dispatch(row({ status }), DENY_SUPPRESSED);
    assert(d.stored.status === "cancelled", `${status} → cancelled is legal`);
    assert(d.providerCalls === 0, "ZERO provider calls");
  }
});

check("S10. a retry dispatch and a scheduled dispatch BOTH re-evaluate consent", async () => {
  // retry_scheduled row (a retry) → consent is consulted again
  const retry = await dispatch(row({ status: "retry_scheduled", attempt_count: 2 }), ALLOW);
  assert(retry.consentCalls.length === 1, "a RETRY dispatch re-evaluates consent");
  // a previously-scheduled row that has come due → consent is consulted at dispatch, not at enqueue
  const scheduled = await dispatch(row({ status: "queued", scheduled_at: "2020-01-01T00:00:00.000Z" }), ALLOW);
  assert(scheduled.consentCalls.length === 1, "a SCHEDULED dispatch re-evaluates consent");
});

check("S11. consent CHANGED between enqueue and dispatch is observed (STOP after enqueue)", async () => {
  // The row was enqueued while consent allowed. By dispatch time a STOP exists → the authority now blocks.
  const d = await dispatch(row({ status: "queued" }), DENY_SUPPRESSED);
  assert(d.consentCalls.length === 1, "consent is re-read at dispatch time, not trusted from enqueue");
  assert(d.stored.status === "cancelled" && d.providerCalls === 0, "the post-enqueue STOP is observed and nothing is sent");
});

check("S12. terminalization is COMPARE-AND-SET on (id, exact current status)", async () => {
  const src = readF(COMM_SRC);
  const start = src.indexOf("private async terminalizeBeforeClaim");
  assert(start > 0, "the helper exists");
  const body = src.slice(start, src.indexOf("\n  private async claimMessageForDispatch", start));
  has(/\.eq\("id", message\.id\)/, body, "filters by id");
  has(/\.eq\("status", message\.status\)/, body, "AND by the EXACT status we read (compare-and-set)");
  hasNot(/\.neq\(|\.in\(/, body, "no unconditional / widened update");
  has(/updated\.length !== 1/, body, "zero rows updated ⇒ a lost race, not a clobber");
});

check("S13. a LOST terminalization race never calls the provider and never clobbers", async () => {
  // Model the race: the row we read as `queued` is already `dispatching` in the table.
  TABLE = [{ ...row(), status: "dispatching" }];
  DB_THROWS = false;
  const p = fakeProvider();
  const e = fakeEnforcer(DENY_SUPPRESSED);
  const svc = new M.Comm.CommunicationService(p.provider, fakeResolver, null, e.enforcer);
  const res = await svc.dispatchMessage(row({ status: "queued" }), { preResolvedDestination: DEST, providerTemplateName: "tpl" });
  assert(p.calls.send === 0, "ZERO provider calls after a lost terminalization race");
  assert(res.ok === false && res.code === "MESSAGE_ALREADY_CLAIMED", "the safe concurrent-claim outcome is returned");
  assert(TABLE[0].status === "dispatching", "the other worker's claim is NOT clobbered");
});

check("S14. the existing final template/runtime/provider gates remain AFTER consent", () => {
  const src = readF(COMM_SRC);
  const iConsent = src.indexOf("await this.enforceOutboundConsent(");
  const iForeignChannel = src.indexOf("this.isForeignChannel(message.channel)");
  const iForeignProvider = src.indexOf("this.isForeignProvider(message.provider)");
  const iInvoke = src.indexOf("await this.invokeProvider(");
  assert(iForeignChannel < iConsent && iForeignProvider < iConsent, "the channel/provider fences still run first (fail closed earliest)");
  assert(iConsent < iInvoke, "the approved-mapping/provider gates inside invokeProvider still run AFTER consent");
  // The mapping gate is still reached on an allowed send.
  has(/requiresApprovedMapping\(\)/, src, "the approved-mapping gate is intact");
});

check("S16. RCS / any unknown channel can NEVER be coerced to WhatsApp — it fails closed", async () => {
  // (a) The closed map is total and refuses everything except the two enforced channels.
  const map = M.Comm.toEnforcementChannel;
  assert(map("whatsapp") === "whatsapp", "whatsapp maps only to whatsapp");
  assert(map("sms") === "sms", "sms maps only to sms");
  for (const bad of ["rcs", "RCS", "email", "telegram", "", null, undefined, "whatsapp ", "WhatsApp"]) {
    assert(map(bad) === null, `an unsupported channel is NEVER coerced to whatsapp: ${safeStringify(bad)}`);
  }
  // (b) The source contains no coercing ternary any more.
  hasNot(/message\.channel === "sms" \? "sms" : "whatsapp"/, readF(COMM_SRC), "the silent channel coercion is gone");
  hasNot(/channel:\s*"whatsapp"\s*(\/\/|$)/m, stripTs(readF(COMM_SRC)), "no hard-coded whatsapp channel is passed to the enforcer");

  // (c) BEHAVIOURAL: an `rcs` row reaching the gate is terminalized BEFORE consent, claim and provider.
  // (A provider whose own channel is `rcs` gets past the foreign-channel guard, so this is the second,
  // independent fence — it proves the row can never inherit WhatsApp's consent decision.)
  const rcsRow = row({ channel: "rcs" });
  TABLE = [{ ...rcsRow }];
  DB_THROWS = false;
  const p = fakeProvider();
  p.provider.channel = "rcs";                 // so the foreign-channel guard does not short-circuit first
  const e = fakeEnforcer(ALLOW);              // even a permissive enforcer must never be consulted
  const svc = new M.Comm.CommunicationService(p.provider, fakeResolver, null, e.enforcer);
  const res = await svc.dispatchMessage(rcsRow, { preResolvedDestination: DEST, providerTemplateName: "tpl" });
  assert(e.calls.length === 0, "the consent authority is NEVER asked about an unsupported channel");
  assert(p.calls.send === 0, "ZERO provider calls for an unsupported channel");
  assert(TABLE[0].status === "failed", "the row fails closed (never dispatched, never cancelled-as-consented)");
  assert(TABLE[0].failure_code === "UNSUPPORTED_DISPATCH_CHANNEL", "a sanitized, closed failure code");
  assert(res.ok === true && res.data.status === "failed", "the failed message is returned");
});

check("S15. this service NEVER interprets consent (no D2-C import, no suppression/preference read)", () => {
  const code = stripTs(readF(COMM_SRC));
  hasNot(/communicationConsentDecisionService|decideCommunicationConsent/, code, "no D2-C import");
  hasNot(/communication_suppressions|communication_preferences/, code, "never reads a consent table");
  hasNot(/marketing_opted_in|no_consent_objection|disposition/, code, "never sees a disposition");
  has(/this\.consentEnforcer/, code, "it consumes only the closed enforcer outcome");
  hasNot(/policy_decision_id:\s*consent|metadata.*consent/i, code, "no policy_decision_id reuse, no consent stored in metadata");
});

// ============================================================================
// SMS AUTHENTICATION FALLBACK
// ============================================================================
check("F1. the SMS fallback has its OWN channel=sms decision, BEFORE the fallback claim", () => {
  const src = readF(ORCH_SRC);
  const iBody = src.indexOf("deps.resolveAuthenticationSmsContent(");
  const iConsent = src.indexOf("smsConsent = await authorize({");
  const iDeadline = src.indexOf("input.deadline.remainingNetworkBudgetMs()");
  const iClaim = src.indexOf("deps.claimFallbackAttempt(");
  const iSend = src.indexOf("smsProvider.sendResolvedAuthenticationSms(");
  assert(iBody > 0 && iConsent > 0 && iDeadline > 0 && iClaim > 0 && iSend > 0, "all five steps exist");
  assert(iBody < iConsent, "consent runs after the reviewed body resolves");
  assert(iConsent < iDeadline, "consent runs before the deadline check");
  assert(iConsent < iClaim, "consent runs BEFORE the fallback claim");
  assert(iClaim < iSend, "the provider call remains after the claim");
  // …with channel sms, an ephemeral source, and the already-computed hash — never the plaintext phone.
  const block = src.slice(iConsent, iConsent + 500);
  has(/channel: "sms"/, block, "channel: sms — a WhatsApp decision NEVER authorizes SMS");
  has(/destinationSource: "ephemeral_auth_destination"/, block, "ephemeral source ⇒ unknown identity");
  has(/destinationHash,/, block, "the already-computed sha256 is passed");
  hasNot(/phoneE164|input\.otp/, block, "NEVER the plaintext phone or the OTP");
});

check("F2. every non-allow SMS outcome blocks with a closed, sanitized reason", () => {
  const src = readF(ORCH_SRC);
  for (const r of ["SMS_CONSENT_DENIED", "SMS_CONSENT_AUTHORITY_UNAVAILABLE", "SMS_CONSENT_ENFORCEMENT_INVALID"]) {
    has(new RegExp(`${r}:\\s*"${r}"`), src, `the closed reason ${r} exists`);
    has(new RegExp(`OrchestratorFallbackBlockReason\\.${r}`), src, `${r} is actually used`);
  }
  // The block branch returns BEFORE the claim/provider — proven by source ordering in F1 and by the
  // early `return blocked(...)` on a non-allow.
  const i = src.indexOf('if (smsConsent.kind !== "allow")');
  assert(i > 0, "a non-allow short-circuits");
  const branch = src.slice(i, i + 420);
  has(/return blocked\(/, branch, "it returns a blocked result");
  hasNot(/claimFallbackAttempt|sendResolvedAuthenticationSms/, branch, "no claim and no provider call on a non-allow");
});

check("F3. the SMS fallback leaks no OTP / phone / hash / D2-C detail in its block reasons", () => {
  // Assert on the CODE, not the prose: the surrounding comment legitimately NAMES the things it must
  // not carry ("carries NO phone, hash, OTP, …"), which is documentation, not a leak. So strip the
  // comments FIRST, then take the window — otherwise the prose eats the branch.
  const stripped = stripTs(readF(ORCH_SRC));
  const i = stripped.indexOf('if (smsConsent.kind !== "allow")');
  assert(i > 0, "the non-allow short-circuit exists");
  const branch = stripped.slice(i, i + 520);
  hasNot(/\botp\b|phoneE164|destinationHash|suppressionId|matchedPreferenceId|reasonCode|disposition/i, branch, "the block reason carries nothing sensitive");
  // The only things the branch returns are the three closed block reasons.
  const returns = branch.match(/return blocked\(([^)]*)\)/g) || [];
  assert(returns.length === 3, `exactly the three closed SMS consent block reasons (got ${returns.length})`);
  for (const r of returns) assert(/SMS_CONSENT_(DENIED|AUTHORITY_UNAVAILABLE|ENFORCEMENT_INVALID)/.test(r), `closed reason only: ${r}`);
});

check("F4. the REAL coordinator is bound by default (lazily); DI stays available; NO production fail-open", () => {
  const raw = readF(ORCH_SRC);
  const src = stripTs(raw);

  // (1) THE DEFAULT DEPENDENCIES BIND THE REAL COORDINATOR.
  // The import is LAZY — a dynamic import INSIDE the closure — so an isolated legacy harness build that
  // does not contain the coordinator module never has to resolve it at load time. What it loads when it
  // DOES run is the real coordinator and nothing else.
  has(/authorizeOutboundConsent:\s*async \(enforcementInput\) => \{[\s\S]{0,240}await import\("\.\/outboundConsentEnforcementService"\)[\s\S]{0,160}authorizeOutboundConsent\(enforcementInput\)/,
    src, "defaultClientOtpDeliveryDeps() LAZILY binds the REAL outbound consent coordinator");
  has(/import type \{[\s\S]{0,120}OutboundConsentEnforcer[\s\S]{0,120}\} from "\.\/outboundConsentEnforcementService"/, raw,
    "only the TYPE is statically imported (erased at compile time)");
  hasNot(/^import \{[^}]*\bauthorizeOutboundConsent\b[^}]*\} from "\.\/outboundConsentEnforcementService"/m, src,
    "the coordinator VALUE is not statically imported (that is what broke the isolated legacy builds)");

  // (2) DEPENDENCY INJECTION REMAINS AVAILABLE FOR TESTS.
  has(/readonly authorizeOutboundConsent\?: OutboundConsentEnforcer\["authorize"\]/, src, "the enforcer is injectable");

  // (3) THE ORCHESTRATOR NEVER INTERPRETS CONSENT ITSELF — it goes through the ONE coordinator.
  hasNot(/decideCommunicationConsent|communicationConsentDecisionService/, src, "the orchestrator never calls D2-C directly");
  hasNot(/communication_suppressions|communication_preferences|marketing_opted_in|no_consent_objection/, src,
    "the orchestrator never reads a consent row or a disposition");

  // (4) ★ ZERO IMPLICIT ALLOW ★ — ABSENCE IS NEVER AUTHORIZATION.
  // There is NO `{ kind: "allow" }` literal anywhere in the orchestrator. When the dependency is absent it
  // LAZILY LOADS THE REAL COORDINATOR; it does not fabricate a decision. This is the single most important
  // property in this file, and it is asserted as an absolute.
  hasNot(/kind:\s*"allow"/, src, "the orchestrator NEVER constructs an allow outcome — absence is never authorization");
  has(/const authorize: OutboundConsentEnforcer\["authorize"\] =\s*deps\.authorizeOutboundConsent \?\?\s*\(async \(enforcementInput\) => \{[\s\S]{0,220}await import\("\.\/outboundConsentEnforcementService"\)/, src,
    "an ABSENT dependency falls back to the REAL coordinator (never to an allow)");
  hasNot(/deps\.authorizeOutboundConsent\s*\?\s*await/, src, "the old permissive ternary is gone");

  // The production entry point uses the DEFAULTS and never overrides the enforcer.
  const hook = readF("services/supabaseSendSmsHookService.ts");
  has(/deliverClientLoginOtp\(\{/, hook, "the production entry point calls the orchestrator");
  hasNot(/authorizeOutboundConsent/, hook, "…and NEVER overrides the enforcer ⇒ the real coordinator always applies in production");

  // (5) A FAILING COORDINATOR CAN NEVER AUTHORIZE AN SMS.
  // A dynamic-import failure or a thrown coordinator is caught and mapped to the SAFE UNAVAILABLE outcome
  // — never to an allow. There is no catch-to-allow path anywhere.
  has(/try \{\s*smsConsent = await authorize\(\{/, src, "the authorization call is guarded");
  has(/\} catch \{[\s\S]{0,200}return blocked\(OrchestratorFallbackBlockReason\.SMS_CONSENT_AUTHORITY_UNAVAILABLE\)/, src,
    "an import failure / thrown coordinator BLOCKS the SMS (mapped to the safe unavailable outcome)");
  hasNot(/catch[\s\S]{0,200}kind: "allow"/, src, "there is NO catch-to-allow path");
  hasNot(/smsConsent\.kind !== "allow"[\s\S]{0,120}(claimFallbackAttempt|sendResolvedAuthenticationSms)/, src,
    "a non-allow never continues to the claim or the provider");
  for (const kind of ["deny", "unavailable"]) {
    has(new RegExp(`smsConsent\\.kind === "${kind}"`), src, `the '${kind}' outcome is handled explicitly (blocked)`);
  }
  // …and the `invalid` outcome (invalid request OR authority integrity violation) is the closed default.
  has(/return blocked\(OrchestratorFallbackBlockReason\.SMS_CONSENT_ENFORCEMENT_INVALID\)/, src,
    "an invalid / integrity outcome BLOCKS the SMS");

  // (6) THE GATE STAYS BEFORE THE FALLBACK CLAIM AND THE PROVIDER CALL.
  const iConsent = src.indexOf("deps.authorizeOutboundConsent");
  const iClaim = src.indexOf("deps.claimFallbackAttempt(");
  const iSend = src.indexOf("smsProvider.sendResolvedAuthenticationSms(");
  assert(iConsent > 0 && iClaim > 0 && iSend > 0, "all three steps exist");
  assert(iConsent < iClaim, "the consent gate precedes the fallback claim");
  assert(iClaim < iSend, "the provider call remains after the claim");
});

// ============================================================================
// BOUNDARIES
// ============================================================================
check("B1. the runtime factory ALWAYS injects the real enforcer (the production construction boundary)", () => {
  const src = readF(RUNTIME_SRC);
  has(/consentEnforcer: OutboundConsentEnforcer = createOutboundConsentEnforcer\(\)/, src, "defaulted to the REAL enforcer");
  has(/new CommunicationService\(provider\.data, getActiveRecipientResolver\(\), coordinator, consentEnforcer\)/, src, "it is passed to the service");
  hasNot(/process\.env\.[A-Z_]*CONSENT/, src, "no new environment variable");
});

check("B2. EVERY production send path builds its service via the runtime factory (no direct construction)", () => {
  const out = execFileSync("git", ["grep", "-n", "new CommunicationService(", "--", "services/", "app/", "lib/"], { encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean)
    // A COMMENT that merely mentions the constructor is documentation, not a construction.
    .filter((l) => {
      const code = l.replace(/^[^:]+:\d+:/, "").trim();
      return !code.startsWith("//") && !code.startsWith("*") && !code.startsWith("/*");
    });
  for (const line of out) {
    const file = line.split(":")[0];
    // The ONLY permitted direct constructions: the runtime factory itself, and the webhook service
    // (which processes DELIVERY RECEIPTS and never sends).
    assert(
      file === RUNTIME_SRC || file === "services/metaWhatsAppWebhookService.ts",
      `a production direct construction bypasses consent enforcement: ${line}`
    );
  }
  // …and the webhook service really does not send.
  const hook = stripTs(readF("services/metaWhatsAppWebhookService.ts"));
  hasNot(/\.send\(|dispatchMessage\(|dispatchPersistedMessage\(/, hook, "the webhook service never sends");
  // The three real send callers all use the factory.
  for (const f of ["services/clientLoginOtpDeliveryOrchestrator.ts", "services/vendorPasswordResetService.ts", "services/vendorVerificationService.ts"]) {
    has(/createRuntimeCommunicationService\(/, readF(f), `${f} uses the runtime factory`);
  }
});

check("B3. the ONLY direct provider call outside CommunicationService is the D3-B-gated SMS fallback", () => {
  const out = execFileSync("git", ["grep", "-n", "-E", "\\.(sendTemplateMessage|sendAuthenticationMessage|sendResolvedTemplate|sendResolvedAuthenticationSms)\\(", "--", "services/", "app/", "lib/"], { encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean)
    .filter((l) => !l.startsWith("lib/communication/providers/"));
  for (const line of out) {
    const file = line.split(":")[0];
    assert(file === COMM_SRC || file === ORCH_SRC, `an ungated provider bypass exists: ${line}`);
  }
  assert(out.some((l) => l.startsWith(ORCH_SRC)), "the SMS fallback is the known bypass…");
  has(/smsConsent = await authorize\(\{/, readF(ORCH_SRC), "…and it is now gated by D3-B");
});

check("B4. the frozen consent authorities are UNCHANGED, and no SQL/route/env/provider file is touched", () => {
  const dirty = gitDirty();
  for (const f of [D2C_SRC, D2D_WRITER_SRC, D2D_COMMAND_SRC, POLICY_SRC, D2E_ORCH_SRC, D2E_INPUT_SRC]) {
    assert(!dirty.includes(f), `a frozen consent authority must not change: ${f}`);
  }
  for (const p of dirty) {
    assert(!/^supabase\/migrations\//.test(p), `no migration may change (${p})`);
    assert(!/^app\/api\/.*route\.ts$|^pages\/api\//.test(p), `no API route may change (${p})`);
    assert(!/\.env/.test(p), `no env file may change (${p})`);
    assert(!/^lib\/communication\/providers\//.test(p), `no provider adapter may change (${p})`);
    assert(!/package-lock\.json|yarn\.lock|pnpm-lock\.yaml/.test(p), `no lockfile may change (${p})`);
    // NO existing harness may change — with EXACTLY ONE founder-approved exception, 5F-B, whose scope is
    // then verified line-by-line below. Every other historical harness stays frozen.
    assert(
      !/^scripts\/phase5(b|c|d|e|f-(a|b|c|d1|d2))/.test(p) || p === HARNESS_SRC || p === PHASE5FB_SRC || LEGACY_SMS_HARNESSES.includes(p),
      `no existing harness may change (${p})`
    );
  }
  // The D3-B delta is within the approved scope.
  for (const p of dirty) assert(D3B_EXPECTED_FILES.includes(p), `file outside the approved D3-B scope: ${p}`);

  // The legacy SMS harnesses are approved to INJECT a test enforcer — never to weaken a test.
  // "Removes nothing" is too blunt (instrumenting an existing line legitimately rewrites it), so the
  // guarantee proven here is the one that actually matters: NO TEST WAS WEAKENED OR DELETED.
  //   • no removed line may contain a `check(` or an `assert(`;
  //   • the count of `check(` and `assert(` may only GROW, never shrink, versus HEAD.
  for (const h of LEGACY_SMS_HARNESSES) {
    if (!dirty.includes(h)) continue;
    const diff = execFileSync("git", ["diff", "--unified=0", "--", h], { encoding: "utf8" }).split("\n");

    const removed = diff.filter((l) => l.startsWith("-") && !l.startsWith("---"));
    for (const line of removed) {
      assert(!/\bcheck\(|\bassert\(/.test(line), `${h}: an assertion/check line was REMOVED — a test may have been weakened: ${line.trim().slice(0, 90)}`);
    }

    const before = execFileSync("git", ["show", `HEAD:${h}`], { encoding: "utf8" });
    const after = readF(h);
    const count = (s, re) => (s.match(re) || []).length;
    assert(count(after, /\bcheck\(/g) >= count(before, /\bcheck\(/g),
      `${h}: the number of checks must not shrink (${count(before, /\bcheck\(/g)} → ${count(after, /\bcheck\(/g)})`);
    assert(count(after, /\bassert\(/g) >= count(before, /\bassert\(/g),
      `${h}: the number of assertions must not shrink (${count(before, /\bassert\(/g)} → ${count(after, /\bassert\(/g)})`);

    // …and the only `allow` they gained lives in their dependency object (a TEST DOUBLE), not production.
    const added = diff.filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
    has(/authorizeOutboundConsent/, added, `${h}: it injects a test consent enforcer`);
    has(/kind: "allow"/, added, `${h}: the allow lives in the HARNESS dependency object, not in production`);
  }

  // The 5F-B exception is BOUNDED: prove its diff is EXACTLY the approved `.in()` compatibility method.
  // It must ADD only that one line of code, and must REMOVE nothing — so no assertion can be weakened,
  // deleted, or quietly altered under cover of the exception.
  if (dirty.includes(PHASE5FB_SRC)) {
    const diff = execFileSync("git", ["diff", "--unified=0", "--", PHASE5FB_SRC], { encoding: "utf8" }).split("\n");
    const removed = diff.filter((l) => l.startsWith("-") && !l.startsWith("---"));
    assert(removed.length === 0, `the approved 5F-B change must REMOVE nothing (it removed ${removed.length} line(s) — a test may have been weakened)`);
    const addedCode = diff
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1).trim())
      .filter((l) => l !== "" && !l.startsWith("//"));   // comments are allowed; code is not
    assert(addedCode.length === 1, `the 5F-B change must add exactly ONE line of code (got ${addedCode.length}: ${addedCode.join(" | ")})`);
    assert(addedCode[0] === PHASE5FB_APPROVED_LINE, `the ONLY approved 5F-B addition is the .in() fake-query-builder method (got: ${addedCode[0]})`);
  }
});

check("B5. no provider activation, no n8n, no RCS send, no migration, no durable consent storage", () => {
  // Assert on CODE, not prose: several files legitimately DOCUMENT "no n8n" / "no RCS" in comments.
  const all = [SCOPE_SRC, COORD_SRC, COMM_SRC, RUNTIME_SRC, ORCH_SRC].map((f) => stripTs(readF(f))).join("\n");
  hasNot(/is_operationally_enabled\s*=|outbound_enabled\s*=|activation_status\s*=|webhook_processing_enabled\s*=/, all, "no provider activation");
  hasNot(/\bn8n\b/i, all, "no n8n");
  hasNot(/sendRcs|rcsProvider|channel: "rcs"/, all, "no RCS send path");
  hasNot(/create table|alter table|supabase db push|migration up/i, all, "no SQL / migration");
  const coord = stripTs(readF(COORD_SRC));
  hasNot(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/, coord, "the coordinator writes NOTHING (no durable consent record)");
  hasNot(/communication_suppressions|communication_preferences/, coord, "the coordinator never reads a consent table directly");
  has(/decideCommunicationConsent/, coord, "it delegates to D2-C, the sole decision authority");
});

check("B6. wiring: the d3b script + the doc exist and the doc covers the contract", () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:d3b"] === "node scripts/phase5f-d3b-outbound-consent-enforcement-harness.mjs", "d3b script wired");
  for (const f of [SCOPE_SRC, COORD_SRC, HARNESS_SRC, DOC_SRC]) assert(existsSync(f), `${f} exists`);
  const doc = readF(DOC_SRC);
  for (const topic of [
    /founder/i, /client_nurture_followup/, /dormant_requirement_reactivation/, /marketing/i,
    /registry/i, /unclassified|unknown message type/i, /one (authoritative )?check|single gate/i,
    /pre-insert/i, /runtime factory/i, /SMS/i, /bypass/i, /ephemeral/i, /unknown identity/i,
    /disposition/i, /authority[ _]unavailable/i, /compare-and-set/i, /cancelled/i,
    /scheduled|retry/i, /race/i, /no migration/i, /policy_decision_id/i, /rollback/i,
  ]) has(topic, doc, `doc covers ${topic}`);
  hasNot(/atomic(ally)? (across|with) the provider|transactional with the provider/i, doc, "the doc must NOT claim external-provider atomicity");
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutationChecks = [];
function srcMutation(name, file, from, to, scenario) { mutationChecks.push({ name, kind: "src", edits: [{ file, from, to }], scenario }); }

/** Rebuild from the mutated sources and re-drive the scenario. */
async function withMutatedBuild(fn) {
  const dir = resolve(`.phase5fd3b-mut-${Math.random().toString(36).slice(2, 8)}`);
  try {
    compileTo(dir);
    return await fn(wireBuild(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function dispatchWith(mm, message, outcome) {
  TABLE = [{ ...message }];
  DB_THROWS = false;
  const p = fakeProvider();
  const e = fakeEnforcer(outcome);
  const svc = new mm.Comm.CommunicationService(p.provider, fakeResolver, null, e.enforcer);
  const res = await svc.dispatchMessage(message, { rawVariables: { otp: "1" }, providerTemplateName: "tpl", preResolvedDestination: DEST });
  return { res, providerCalls: p.calls.send, consentCalls: e.calls, stored: TABLE[0] };
}

srcMutation("MUT 1: the CommunicationService consent gate is REMOVED (a suppressed destination is sent)",
  COMM_SRC,
  "      const consentDenial = await this.enforceOutboundConsent(message);\n      if (consentDenial) return consentDenial;",
  "",
  () => withMutatedBuild(async (mm) => {
    const d = await dispatchWith(mm, row(), DENY_SUPPRESSED);
    return d.providerCalls > 0; // a BLOCKED destination reached the provider
  }));

srcMutation("MUT 2: the gate is MOVED AFTER the claim (cancellation becomes an illegal transition)",
  COMM_SRC,
  "      const consentDenial = await this.enforceOutboundConsent(message);\n      if (consentDenial) return consentDenial;\n\n      // Atomic claim. A loser here has sent nothing and must send nothing.\n      const claim = await this.claimMessageForDispatch(message);\n      if (!claim.ok) return claim;\n      const claimed = claim.data;",
  "      // Atomic claim. A loser here has sent nothing and must send nothing.\n      const claim = await this.claimMessageForDispatch(message);\n      if (!claim.ok) return claim;\n      const claimed = claim.data;\n\n      const consentDenial = await this.enforceOutboundConsent(claimed);\n      if (consentDenial) return consentDenial;",
  () => withMutatedBuild(async (mm) => {
    const d = await dispatchWith(mm, row(), DENY_SUPPRESSED);
    // From `dispatching` there is NO legal edge to `cancelled`, so the denial can no longer be recorded.
    return d.stored.status !== "cancelled";
  }));

srcMutation("MUT 3: a DENY is converted to an ALLOW",
  COMM_SRC,
  'if (outcome.kind === "allow") return null;',
  'if (outcome.kind === "allow" || outcome.kind === "deny") return null;',
  () => withMutatedBuild(async (mm) => {
    const d = await dispatchWith(mm, row(), DENY_SUPPRESSED);
    return d.providerCalls > 0;
  }));

srcMutation("MUT 4: MARKETING 'unknown' is converted to an ALLOW (default-deny broken)",
  COORD_SRC,
  'if (disposition === "unknown") return deny("CONSENT_NOT_GRANTED");',
  'if (disposition === "unknown") return { kind: "allow", scope };',
  () => withMutatedBuild(async (mm) => {
    const r = await mm.Coord.authorizeOutboundConsent({
      channel: "whatsapp", messageType: "client_nurture_followup", templateKey: "client_nurture_followup",
      lane: "business", destinationHash: HASH, destinationSource: "recipient_reference",
      recipientType: "client", recipientId: UUID,
    }, decided(ok2("unknown")));
    return r.kind === "allow"; // absence of consent became consent
  }));

srcMutation("MUT 5: an AUTHORITY LOOKUP FAILURE is converted to an ALLOW (fail-open)",
  COORD_SRC,
  '      case "AUTHORITY_LOOKUP_FAILED":\n        return unavailable();                                  // retryable: the authority may recover',
  '      case "AUTHORITY_LOOKUP_FAILED":\n        return { kind: "allow", scope };',
  () => withMutatedBuild(async (mm) => {
    const r = await mm.Coord.authorizeOutboundConsent({
      channel: "whatsapp", messageType: "lead_received", templateKey: "lead_received", lane: "business",
      destinationHash: HASH, destinationSource: "recipient_reference", recipientType: "client", recipientId: UUID,
    }, decided({ ok: false, code: "AUTHORITY_LOOKUP_FAILED" }));
    return r.kind === "allow"; // an unreadable authority became permission
  }));

srcMutation("MUT 6: an EPHEMERAL destination is upgraded to EXACT from its recipient_id",
  COORD_SRC,
  '  if (input.destinationSource !== "recipient_reference") return unknown;',
  "  // upgraded",
  () => withMutatedBuild(async (mm) => {
    const d = mm.Coord.deriveConsentIdentity({ destinationSource: "ephemeral_auth_destination", recipientType: "vendor", recipientId: UUID });
    return d.identityConfidence === "exact"; // a caller-supplied number now claims a principal's identity
  }));

// The SMS gate mutations below are REAL bypasses, and each is proven load-bearing by requiring the D3-B
// suite to actually GO RED — not by a string-presence check. If a mutation could reopen the SMS
// direct-provider bypass without any test failing, that mutation would report FAIL.
srcMutation("MUT 7: the SMS consent DENIAL is ignored (a denied/blocked destination proceeds to the claim + provider)",
  ORCH_SRC,
  '  if (smsConsent.kind !== "allow") {',
  "  if (false) {",
  async () => {
    const src = stripTs(readF(ORCH_SRC));
    // The denial short-circuit is gone: a deny / unavailable / invalid outcome now falls straight through
    // to the fallback claim and the SMS provider call.
    const shortCircuitGone = !/if \(smsConsent\.kind !== "allow"\) \{/.test(src);
    return shortCircuitGone && (await suiteGoesRed());
  });

srcMutation("MUT 8: an ABSENT enforcer is treated as an ALLOW again (the implicit-allow bypass is reintroduced)",
  ORCH_SRC,
  "  const authorize: OutboundConsentEnforcer[\"authorize\"] =\n    deps.authorizeOutboundConsent ??\n    (async (enforcementInput) => {\n      const mod = await import(\"./outboundConsentEnforcementService\");\n      return mod.authorizeOutboundConsent(enforcementInput);\n    });",
  "  const authorize: OutboundConsentEnforcer[\"authorize\"] =\n    deps.authorizeOutboundConsent ??\n    (async () => ({ kind: \"allow\", scope: \"authentication\" } as const));",
  async () => {
    const src = stripTs(readF(ORCH_SRC));
    // A missing dependency would once again MEAN AUTHORIZATION — the exact fail-open D3-B exists to close.
    const implicitAllowBack = /kind:\s*"allow"/.test(src)
      && !/await import\("\.\/outboundConsentEnforcementService"\)/.test(src);
    return implicitAllowBack && (await suiteGoesRed());
  });

srcMutation("MUT 8b: an import failure / thrown coordinator is swallowed into an ALLOW (catch-to-allow)",
  ORCH_SRC,
  "  } catch {\n    // NO DECISION COULD BE OBTAINED AT ALL — a dynamic-import failure, or a coordinator that threw.\n    // That is an authority OUTAGE, never an allow. Fail closed onto the existing safe outcome.\n    return blocked(OrchestratorFallbackBlockReason.SMS_CONSENT_AUTHORITY_UNAVAILABLE);\n  }",
  "  } catch {\n    smsConsent = { kind: \"allow\", scope: \"authentication\" } as const;\n  }",
  async () => {
    const src = stripTs(readF(ORCH_SRC));
    // A coordinator that could not even be loaded would now authorize the SMS.
    const catchToAllow = /catch[\s\S]{0,200}kind:\s*"allow"/.test(src);
    return catchToAllow && (await suiteGoesRed());
  });

// ---- MUT 8c: the SMS gate is MOVED AFTER the fallback claim (a genuine RELOCATION, not a deletion) ----
// The whole SMS consent path survives — the decision is still made, still fails closed, still blocks a
// deny. The ONLY thing that changes is its POSITION: it now runs AFTER `claimFallbackAttempt`. That
// violates the security contract, because attempt 2 is consumed (and the single-fallback budget spent)
// BEFORE we know whether consent permits the SMS at all — a denied destination would still burn a claim.
const SMS_CONSENT_BLOCK = `  let smsConsent: OutboundConsentOutcome;
  try {
    smsConsent = await authorize({
      channel: "sms",
      messageType: ORCHESTRATED_AUTH_FLOW,
      templateKey: ORCHESTRATED_AUTH_FLOW,
      lane: "authentication",
      destinationHash,
      destinationSource: "ephemeral_auth_destination",
      recipientType: "client",
      recipientId: null,
    });
  } catch {
    // NO DECISION COULD BE OBTAINED AT ALL — a dynamic-import failure, or a coordinator that threw.
    // That is an authority OUTAGE, never an allow. Fail closed onto the existing safe outcome.
    return blocked(OrchestratorFallbackBlockReason.SMS_CONSENT_AUTHORITY_UNAVAILABLE);
  }

  if (smsConsent.kind !== "allow") {
    // Sanitized + closed. The result carries NO phone, hash, OTP, D2-C reason, suppression id,
    // preference id or raw error — only which of the three closed block reasons applied. The
    // orchestrator NEVER reinterprets a D2-C disposition: it consumes the coordinator's closed outcome.
    if (smsConsent.kind === "deny") return blocked(OrchestratorFallbackBlockReason.SMS_CONSENT_DENIED);
    if (smsConsent.kind === "unavailable") {
      return blocked(OrchestratorFallbackBlockReason.SMS_CONSENT_AUTHORITY_UNAVAILABLE);
    }
    // \`invalid\` — an invalid enforcement request or an untrustworthy authority (integrity violation).
    return blocked(OrchestratorFallbackBlockReason.SMS_CONSENT_ENFORCEMENT_INVALID);
  }
`;
const SMS_CLAIM_GUARD = `  const fallbackAttemptId = fallbackClaim.data.attemptId;
  if (!fallbackAttemptId) return blocked(OrchestratorFallbackBlockReason.FALLBACK_CLAIM_REJECTED);
`;

mutationChecks.push({
  name: "MUT 8c: the SMS consent gate is MOVED AFTER the fallback claim (claim-before-consent)",
  kind: "src",
  edits: [
    // 1) lift the consent decision + gate OUT of its position (the SMS path itself stays intact)…
    { file: ORCH_SRC, from: SMS_CONSENT_BLOCK, to: "" },
    // 2) …and re-insert it AFTER the fallback claim has already been consumed.
    { file: ORCH_SRC, from: SMS_CLAIM_GUARD, to: `${SMS_CLAIM_GUARD}\n${SMS_CONSENT_BLOCK}` },
  ],
  scenario: async () => {
    const src = stripTs(readF(ORCH_SRC));
    const iConsent = src.indexOf("smsConsent = await authorize({");
    const iClaim = src.indexOf("deps.claimFallbackAttempt(");
    const iSend = src.indexOf("smsProvider.sendResolvedAuthenticationSms(");
    // The SMS path is NOT deleted — the decision, the claim and the send all still exist…
    const pathIntact = iConsent > 0 && iClaim > 0 && iSend > 0;
    // …and the gate still blocks a deny (the short-circuit survives the move).
    const gateStillBlocks = /if \(smsConsent\.kind !== "allow"\) \{/.test(src);
    // …but consent now runs AFTER the claim: attempt 2 is burned before consent is even consulted.
    const consentAfterClaim = iClaim < iConsent;
    // That must make the D3-B suite go RED (the ordering assertions are load-bearing).
    return pathIntact && gateStillBlocks && consentAfterClaim && (await suiteGoesRed());
  },
});

srcMutation("MUT 9: an UNKNOWN message type is classified as TRANSACTIONAL",
  SCOPE_SRC,
  "    return { ok: false, reason: ScopeResolutionFailure.UNCLASSIFIED_MESSAGE_TYPE };",
  '    return { ok: true, scope: "transactional", templateKey: String(messageType), lane: "business" };',
  () => withMutatedBuild(async (mm) => {
    const r = mm.Scope.resolveOutboundConsentScope({ messageType: "promo_blast", templateKey: "promo_blast", lane: "business" });
    return r.ok === true && r.scope === "transactional"; // an unreviewed send silently became transactional
  }));

srcMutation("MUT 10: a MESSAGE/TEMPLATE MISMATCH is allowed",
  SCOPE_SRC,
  "  if (typeof input.templateKey !== \"string\" || input.templateKey !== entry.templateKey) {\n    return { ok: false, reason: ScopeResolutionFailure.MESSAGE_TYPE_TEMPLATE_MISMATCH };\n  }",
  "  // mismatch allowed",
  () => withMutatedBuild(async (mm) => {
    const r = mm.Scope.resolveOutboundConsentScope({ messageType: "lead_received", templateKey: "client_nurture_followup", lane: "business" });
    return r.ok === true; // a swapped template inherited another type's consent scope
  }));

srcMutation("MUT 11: the runtime factory OMITS the enforcer (production sends without consent)",
  RUNTIME_SRC,
  "  return ok(\n    new CommunicationService(provider.data, getActiveRecipientResolver(), coordinator, consentEnforcer)\n  );",
  "  return ok(new CommunicationService(provider.data, getActiveRecipientResolver(), coordinator));",
  () => {
    const src = readF(RUNTIME_SRC);
    return !/new CommunicationService\(provider\.data, getActiveRecipientResolver\(\), coordinator, consentEnforcer\)/.test(src);
  });

srcMutation("MUT 12: cancellation becomes an UNCONDITIONAL update (it clobbers another worker's claim)",
  COMM_SRC,
  '      .eq("id", message.id)\n      .eq("status", message.status)\n      .select("*");\n\n    if (error) throw error;\n\n    const updated = (data ?? []) as CommunicationMessage[];',
  '      .eq("id", message.id)\n      .select("*");\n\n    if (error) throw error;\n\n    const updated = (data ?? []) as CommunicationMessage[];',
  () => withMutatedBuild(async (mm) => {
    // The row is already `dispatching` (another worker owns it). An unconditional update clobbers it.
    TABLE = [{ ...row(), status: "dispatching" }];
    DB_THROWS = false;
    const p = fakeProvider();
    const e = fakeEnforcer(DENY_SUPPRESSED);
    const svc = new mm.Comm.CommunicationService(p.provider, fakeResolver, null, e.enforcer);
    await svc.dispatchMessage(row({ status: "queued" }), { preResolvedDestination: DEST, providerTemplateName: "tpl" });
    return TABLE[0].status === "cancelled"; // the other worker's claim was clobbered
  }));

// A LOST terminalization race is fenced TWICE — the terminalizer's own zero-row guard, AND the atomic
// claim (which also matches zero rows). Either alone still prevents the provider call, so a load-bearing
// mutation must remove BOTH. That redundancy is the point: no single edit can reopen the hole.
// `updated.length` is unique to terminalizeBeforeClaim (the claim uses `claimed.length`), so this anchor
// is independent of any surrounding doc comment.
const TERMINALIZE_GUARD_EDIT = {
  file: COMM_SRC,
  from: "    if (updated.length !== 1) return fail(commError(\"MESSAGE_ALREADY_CLAIMED\"));\n    return ok(updated[0]);",
  to: "    if (updated.length !== 1) return null as unknown as Result<CommunicationMessage>;\n    return ok(updated[0]);",
};
const CLAIM_GUARD_EDIT = {
  file: COMM_SRC,
  from: "    if (claimed.length !== 1) return fail(commError(\"MESSAGE_ALREADY_CLAIMED\"));\n    return ok(claimed[0]);",
  to: "    if (claimed.length !== 1) return ok(message);\n    return ok(claimed[0]);",
};

/** Drive a DENIED dispatch whose row was already moved to `dispatching` by another worker. */
async function lostRaceDispatch(mm) {
  TABLE = [{ ...row(), status: "dispatching" }];
  DB_THROWS = false;
  const p = fakeProvider();
  const e = fakeEnforcer(DENY_SUPPRESSED);
  const svc = new mm.Comm.CommunicationService(p.provider, fakeResolver, null, e.enforcer);
  await svc.dispatchMessage(row({ status: "queued" }), { preResolvedDestination: DEST, providerTemplateName: "tpl" });
  return p.calls.send;
}

mutationChecks.push({
  name: "MUT 13: BOTH the terminalization guard AND the claim guard removed ⇒ the provider IS invoked after a lost race",
  kind: "src",
  edits: [TERMINALIZE_GUARD_EDIT, CLAIM_GUARD_EDIT],
  scenario: () => withMutatedBuild(async (mm) => (await lostRaceDispatch(mm)) > 0),
});

srcMutation("MUT 13b: the atomic CLAIM alone still blocks the provider when the terminalization guard is removed",
  TERMINALIZE_GUARD_EDIT.file, TERMINALIZE_GUARD_EDIT.from, TERMINALIZE_GUARD_EDIT.to,
  () => withMutatedBuild(async (mm) => (await lostRaceDispatch(mm)) === 0));

srcMutation("MUT 14: the coordinator EXPOSES the destination hash / raw authority detail",
  COORD_SRC,
  'const deny = (code: OutboundConsentDenyCode): OutboundConsentOutcome => ({ kind: "deny", code, retryable: false });',
  'const deny = (code: OutboundConsentDenyCode): OutboundConsentOutcome => ({ kind: "deny", code, retryable: false, hash: HASH_LEAK } as unknown as OutboundConsentOutcome);\nconst HASH_LEAK = "a".repeat(64);',
  () => withMutatedBuild(async (mm) => {
    const r = await mm.Coord.authorizeOutboundConsent({
      channel: "whatsapp", messageType: "lead_received", templateKey: "lead_received", lane: "business",
      destinationHash: HASH, destinationSource: "recipient_reference", recipientType: "client", recipientId: UUID,
    }, decided(ok2("blocked")));
    return safeStringify(r).includes(HASH);
  }));

srcMutation("MUT 15: D2-C authority code is modified (the frozen authority must be byte-unchanged)",
  D2C_SRC,
  "export async function decideCommunicationConsent(",
  "export async function decideCommunicationConsent_MUTATED(",
  () => {
    const dirty = gitDirty();
    return dirty.includes(D2C_SRC); // the boundary check must see a frozen authority go dirty
  });

// ============================================================================
// RUNNER
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-D3-B outbound consent enforcement checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}
async function suiteGoesRed() { for (const c of checks) { try { await c.fn(); } catch { return true; } } return false; }

async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5F-D3-B mutation tests...\n");
  for (const mut of mutationChecks) {
    const originals = new Map();
    for (const edit of mut.edits) { const p = resolve(edit.file); if (!originals.has(p)) originals.set(p, readFileSync(p, "utf8")); }
    try {
      for (const edit of mut.edits) {
        const p = resolve(edit.file);
        const cur = readFileSync(p, "utf8");
        if (!cur.includes(edit.from)) throw new Error(`anchor not found in ${edit.file}`);
        writeFileSync(p, cur.replace(edit.from, edit.to));
      }
      let violation = false;
      try { violation = await mut.scenario(); }
      catch { violation = true; /* the mutation broke the build/behaviour → it was load-bearing */ }
      if (!violation) violation = await suiteGoesRed();
      if (violation) { console.log(`PASS ${mut.name}`); passed++; }
      else { console.log(`FAIL ${mut.name} (guard did not prove load-bearing)`); failed++; }
    } catch (e) { console.log(`FAIL ${mut.name}`); console.error(e); failed++; }
    finally { for (const [p, original] of originals) writeFileSync(p, original); }
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
