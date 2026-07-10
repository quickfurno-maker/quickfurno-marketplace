import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import crypto from "node:crypto";

/**
 * Phase 5F-C2 — QuickFurno SMS Provider & Runtime Foundation harness.
 *
 * Verifies the provider-neutral SMS runtime foundation WITHOUT sending anything: the
 * generic outcome-certainty contract, the hardened SmsProvider result, the deterministic
 * mock adapter, the controlled (production fail-closed) provider selection, the PURE SMS
 * infrastructure runtime gate, and the read-only runtime service.
 *
 * NO commercial provider is selected. NO SMS is sent. NO network call is made. NO fallback
 * is enabled. NO migration is created. The mock adapter is the only adapter that exists,
 * and it is instantiated ONLY here in the harness — never in a production file.
 *
 * Mutation tests edit the REAL source, recompile, and assert the vulnerability appears,
 * restoring every file byte-identically afterwards.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const TS_FILES = [
  "lib/errors.ts",
  "lib/supabase.ts",
  "lib/communication/httpTransport.ts",
  "lib/communication/providers/providerError.ts",
  "lib/communication/providers/providerOutcome.ts",
  "lib/communication/providers/whatsappProvider.ts",
  "lib/communication/providers/smsProvider.ts",
  "lib/communication/providers/mockSmsProvider.ts",
  // Phase 5F-C3-A: selection consults the Exotel config loader to decide candidacy. The
  // Exotel ADAPTER is deliberately absent — C2's own surface still constructs no provider.
  "lib/communication/providers/exotelConfig.ts",
  "lib/communication/providers/smsRuntimeGate.ts",
  "services/smsProviderSelection.ts",
  "services/smsProviderRuntimeService.ts",
  "services/runtimeSmsProviderService.ts",
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
    Outcome: req("./lib/communication/providers/providerOutcome.js"),
    WhatsApp: req("./lib/communication/providers/whatsappProvider.js"),
    Sms: req("./lib/communication/providers/smsProvider.js"),
    MockSms: req("./lib/communication/providers/mockSmsProvider.js"),
    Gate: req("./lib/communication/providers/smsRuntimeGate.js"),
    Selection: req("./services/smsProviderSelection.js"),
    RuntimeSvc: req("./services/smsProviderRuntimeService.js"),
    RuntimeProvider: req("./services/runtimeSmsProviderService.js"),
    Supabase: req("./lib/supabase.js"),
  };
}

// ============================================================================
// FILE PATHS
// ============================================================================
const OUTCOME_SRC = "lib/communication/providers/providerOutcome.ts";
const SMS_IFACE_SRC = "lib/communication/providers/smsProvider.ts";
const MOCK_SMS_SRC = "lib/communication/providers/mockSmsProvider.ts";
const GATE_SRC = "lib/communication/providers/smsRuntimeGate.ts";
const SELECTION_SRC = "services/smsProviderSelection.ts";
const RUNTIME_SVC_SRC = "services/smsProviderRuntimeService.ts";
const RUNTIME_PROVIDER_SRC = "services/runtimeSmsProviderService.ts";
const DOC_C2 = "docs/QF-SMS-Provider-Runtime-Foundation-Phase-5F-C2.md";
const AUTH_TRANSPORT_MIGRATION = "supabase/migrations/20260710000100_auth_transport_resilience_decision_foundation.sql";
const FOUNDATION_MIGRATION = "supabase/migrations/20260709000100_messaging_channel_provider_foundation.sql";
const C1_DECISION_SRC = "lib/communication/authenticationTransportDecision.ts";
const C1_ATTEMPT_SVC_SRC = "services/authenticationDeliveryAttemptService.ts";

const readCode = (p) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");

/** Every commercial SMS vendor. Used verbatim for the documentation check. */
const COMMERCIAL_PROVIDERS = [
  /twilio/i, /msg91/i, /exotel/i, /gupshup/i, /kaleyra/i, /plivo/i, /vonage/i, /nexmo/i,
  /aws[_ -]?sns/i, /textlocal/i, /sinch/i, /infobip/i, /karix/i, /routemobile/i, /netcore/i,
];

/**
 * Phase 5F-C3-A performed the C3 review C2 required, and admitted EXACTLY ONE vendor into
 * the still-closed selection vocabulary. That vendor may be named in the selection module
 * and NOWHERE else in C2's surface; every other vendor remains unnameable everywhere.
 */
const REVIEWED_PROVIDER = /exotel/i;
const UNREVIEWED_PROVIDERS = COMMERCIAL_PROVIDERS.filter((v) => v.source !== REVIEWED_PROVIDER.source);

// ============================================================================
// REGISTRY
// ============================================================================
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ============================================================================
// MAIN BUILD
// ============================================================================
const MAIN_DIR = resolve(".phase5fc2-build-main");
compileTo(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ---- in-memory database stub (READ ONLY — a write here would throw) ---------
const DB_TABLES = [
  "communication_provider_runtime_policies",
  "communication_provider_accounts",
  "communication_provider_template_mappings",
  "communication_provider_canary_destinations",
];
const db = {};
function resetDb() { for (const t of DB_TABLES) db[t] = []; }
resetDb();

let dbReadFailure = false;
class QB {
  constructor(table) { this.table = table; this.filters = []; }
  select() { return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  rows() {
    if (dbReadFailure) throw new Error("simulated read failure");
    let list = db[this.table] ?? [];
    for (const f of this.filters) list = list.filter(f);
    return list;
  }
  async maybeSingle() {
    try { const list = this.rows(); return { data: list[0] ?? null, error: null }; }
    catch { return { data: null, error: { code: "XX000" } }; }
  }
  async then(res) {
    try { return res({ data: this.rows(), error: null }); }
    catch { return res({ data: null, error: { code: "XX000" } }); }
  }
  // A write must never be reachable from the read-only runtime service.
  insert() { throw new Error("the SMS runtime service must never write"); }
  update() { throw new Error("the SMS runtime service must never write"); }
  upsert() { throw new Error("the SMS runtime service must never write"); }
  delete() { throw new Error("the SMS runtime service must never write"); }
}
function stubDb(build) {
  build.Supabase.adminClient = () => ({
    from: (t) => new QB(t),
    rpc: () => { throw new Error("the SMS runtime service must never call an RPC"); },
  });
}
stubDb(M);

// ============================================================================
// FIXTURES
// ============================================================================
const PROVIDER = "mock_sms";
const TEMPLATE = "client_login_otp";
const LANGUAGE = "en";
const HASH_A = crypto.createHash("sha256").update("+15550009999").digest("hex");
const HASH_B = crypto.createHash("sha256").update("+15550008888").digest("hex");
const NOW = Date.parse("2026-07-10T12:00:00.000Z");
const FUTURE = new Date(NOW + 3_600_000).toISOString();
const PAST = new Date(NOW - 3_600_000).toISOString();

const policyRow = (over = {}) => ({
  provider_key: PROVIDER, channel: "sms", activation_status: "active", outbound_enabled: true, ...over,
});
const accountRow = (over = {}) => ({
  provider_key: PROVIDER, channel: "sms",
  readiness_status: "provider_ready", configuration_status: "complete", health_status: "healthy", ...over,
});
const mappingRow = (over = {}) => ({
  id: "map-sms-1", template_key: TEMPLATE, channel: "sms", provider_key: PROVIDER, language: LANGUAGE,
  provider_template_name: "QF_OTP_DLT", provider_template_id: "dlt-1",
  provider_category: "authentication", approval_status: "approved", is_active: true, ...over,
});
const canaryRow = (over = {}) => ({
  provider_key: PROVIDER, channel: "sms", destination_hash: HASH_A, is_active: true, expires_at: null, ...over,
});

function gate(over = {}, build = M) {
  return build.Gate.evaluateSmsRuntimeGate({
    providerKey: PROVIDER, channel: "sms", templateKey: TEMPLATE, language: LANGUAGE,
    destinationHash: HASH_A,
    policy: policyRow(), accounts: [accountRow()], mappings: [mappingRow()], canaryRows: [],
    now: NOW,
    ...over,
  });
}
const REASON = () => M.Gate.SmsRuntimeBlockReason;
const blockedFor = (over) => {
  const d = gate(over);
  assert(d.status === "SMS_RUNTIME_BLOCKED", `expected blocked, got ${d.status}`);
  return d.reason;
};

// ============================================================================
// PROVIDER OUTCOME CONTRACT (1–7)
// ============================================================================
check("1-7. the generic certainty contract fails conservative and is never inferred", () => {
  const O = M.Outcome;
  const mock = new M.MockSms.MockSmsProvider();
  assert(O.KNOWN_OUTCOME_CERTAINTIES.join(",") === "accepted,definitive_failure,unknown_outcome", "the vocabulary is exactly three values");

  // 1 — an accepted SMS result declares `accepted` certainty.
  const accepted = { accepted: true, outcomeCertainty: "accepted" };
  assert(O.effectiveProviderOutcomeCertainty(accepted) === "accepted", "1: accepted");
  // 2 — a definitive rejection.
  assert(O.effectiveProviderOutcomeCertainty({ accepted: false, outcomeCertainty: "definitive_failure" }) === "definitive_failure", "2: definitive_failure");
  // 3 — an unknown outcome.
  assert(O.effectiveProviderOutcomeCertainty({ accepted: false, outcomeCertainty: "unknown_outcome" }) === "unknown_outcome", "3: unknown_outcome");

  // 4 — contradictions fold to unknown_outcome, never to success and never to failure.
  assert(O.isContradictoryProviderOutcome({ accepted: true, outcomeCertainty: "definitive_failure" }) === true, "4: accepted+definitive is contradictory");
  assert(O.isContradictoryProviderOutcome({ accepted: false, outcomeCertainty: "accepted" }) === true, "4: rejected+accepted is contradictory");
  assert(O.effectiveProviderOutcomeCertainty({ accepted: true, outcomeCertainty: "definitive_failure" }) === "unknown_outcome", "4: folds to unknown");
  assert(O.effectiveProviderOutcomeCertainty({ accepted: false, outcomeCertainty: "accepted" }) === "unknown_outcome", "4: folds to unknown");
  assert(O.effectiveProviderOutcomeCertainty({ accepted: true, outcomeCertainty: "unknown_outcome" }) === "unknown_outcome", "4: folds to unknown");

  // 5 — a MISSING certainty is never accepted and never definitive.
  assert(O.effectiveProviderOutcomeCertainty({ accepted: true }) === "unknown_outcome", "5: missing on accepted");
  assert(O.effectiveProviderOutcomeCertainty({ accepted: false }) === "unknown_outcome", "5: missing on rejection");
  // 6 — an INVALID certainty likewise.
  for (const bad of ["retryable", "ACCEPTED", "", null, 0, {}]) {
    assert(O.effectiveProviderOutcomeCertainty({ accepted: true, outcomeCertainty: bad }) === "unknown_outcome", `6: invalid ${JSON.stringify(bad)}`);
  }
  // 7 — unknown_outcome is never converted to a definitive failure, and never authorizes a retry.
  assert(O.permitsAutomaticRetry({ accepted: false, outcomeCertainty: "unknown_outcome", retryable: true }) === false, "7: unknown never retried");
  assert(O.permitsAutomaticRetry({ accepted: true, outcomeCertainty: "accepted", retryable: true }) === false, "7: accepted never retried");
  assert(O.permitsAutomaticRetry({ accepted: false, outcomeCertainty: "definitive_failure", retryable: true }) === true, "7: proven failure may be retried at transport level");
  assert(O.permitsAutomaticRetry({ accepted: false, outcomeCertainty: "definitive_failure", retryable: false }) === false, "7: permanent rejection is not retried");
  // Certainty is never inferred from `accepted=false`, `retryable=true`, or an exception.
  assert(O.effectiveProviderOutcomeCertainty({ accepted: false, retryable: true }) === "unknown_outcome", "never inferred from retryable");
  // The WhatsApp module still exposes the historical names, delegating to the ONE impl.
  assert(typeof M.WhatsApp.effectiveOutcomeCertainty === "function" && typeof M.WhatsApp.isContradictorySendResult === "function", "backward-compatible re-exports");
  assert(M.WhatsApp.effectiveOutcomeCertainty({ accepted: true }) === "unknown_outcome", "the re-export shares the conservative rule");
  assert(mock.channel === "sms", "mock identity");
});

check("22-25 (transport). timeout, ambiguous network, ambiguous 5xx, 2xx-without-id, proven pre-connect", () => {
  const O = M.Outcome;
  const c = (o) => O.classifyTransportCertainty(o);
  // ABORTED → unknown_outcome, never retried.
  assert(c({ kind: "aborted" }).outcomeCertainty === "unknown_outcome" && c({ kind: "aborted" }).retryable === false, "aborted → unknown, never retried");
  // AMBIGUOUS network failure → unknown_outcome, never retried.
  for (const code of ["ECONNRESET", "EPIPE", "ETIMEDOUT", "UND_ERR_SOCKET", null, "SOMETHING_NEW"]) {
    const r = c({ kind: "network_error", code });
    assert(r.outcomeCertainty === "unknown_outcome" && r.retryable === false, `ambiguous ${code} → unknown, never retried`);
  }
  // PROVEN pre-connect failure → definitive_failure, safely retryable at transport level.
  for (const code of ["ENOTFOUND", "ECONNREFUSED", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]) {
    const r = c({ kind: "network_error", code });
    assert(r.outcomeCertainty === "definitive_failure" && r.retryable === true, `proven ${code} → definitive`);
  }
  // AMBIGUOUS 5xx → unknown_outcome.
  assert(c({ kind: "response", status: 500, hasProviderMessageId: false }).outcomeCertainty === "unknown_outcome", "5xx → unknown");
  assert(c({ kind: "response", status: 503, hasProviderMessageId: true }).outcomeCertainty === "unknown_outcome", "5xx → unknown even with an id");
  // 2xx WITHOUT a usable provider message id → unknown_outcome.
  assert(c({ kind: "response", status: 200, hasProviderMessageId: false }).outcomeCertainty === "unknown_outcome", "2xx without id → unknown");
  // 2xx WITH an id → accepted.
  assert(c({ kind: "response", status: 202, hasProviderMessageId: true }).outcomeCertainty === "accepted", "2xx with id → accepted");
  // EXPLICIT provider rejection (4xx) → definitive_failure, not retryable.
  const rej = c({ kind: "response", status: 400, hasProviderMessageId: false });
  assert(rej.outcomeCertainty === "definitive_failure" && rej.retryable === false, "4xx → definitive, not retryable");
  // The generic classifier never claims to understand a provider payload.
  const src = readFileSync(OUTCOME_SRC, "utf8");
  assert(/does NOT interpret any provider's own response body/.test(src), "the limits of generic classification are documented");
});

// ============================================================================
// MOCK PROVIDER (8–15)
// ============================================================================
check("8-15. the mock is deterministic, network-free, and retains no OTP or destination", async () => {
  const p = new M.MockSms.MockSmsProvider();
  const D = M.MockSms.MOCK_SMS_DESTINATIONS;
  const OTP = "483920";
  const REAL = "+919876543210";

  // 8 — accepted.
  const ok1 = await p.sendAuthenticationMessage(REAL, TEMPLATE, { otp: OTP });
  assert(ok1.accepted === true && ok1.outcomeCertainty === "accepted", "8: accepted certainty");
  assert(ok1.channel === "sms" && ok1.provider === "mock_sms" && ok1.normalizedStatus === "accepted", "8: provider-neutral shape");
  assert(ok1.retryable === false, "8: an accepted result is never retryable");

  // 9 — definitive failure (both a proven non-delivery and a permanent rejection).
  const retryable = await p.sendAuthenticationMessage(D.RETRYABLE_FAILURE, TEMPLATE, { otp: OTP });
  assert(retryable.accepted === false && retryable.outcomeCertainty === "definitive_failure" && retryable.retryable === true, "9: proven non-delivery");
  const permanent = await p.sendAuthenticationMessage(D.PERMANENT_FAILURE, TEMPLATE, { otp: OTP });
  assert(permanent.accepted === false && permanent.outcomeCertainty === "definitive_failure" && permanent.retryable === false, "9: permanent rejection");

  // 10 — unknown outcome, and it is NEVER retryable.
  const unknown = await p.sendAuthenticationMessage(D.UNKNOWN_OUTCOME, TEMPLATE, { otp: OTP });
  assert(unknown.accepted === false && unknown.outcomeCertainty === "unknown_outcome", "10: unknown_outcome");
  assert(unknown.retryable === false, "10: an unknown outcome is never retryable");
  assert(M.Outcome.permitsAutomaticRetry(unknown) === false, "10: and never authorizes a retry");

  // 11 — zero network calls (the source contains no network primitive at all).
  const code = readCode(MOCK_SMS_SRC);
  for (const banned of [/\bfetch\s*\(/i, /https?:\/\//i, /require\(['"]https?['"]\)/i, /\bnet\.|dgram|axios|undici/i, /XMLHttpRequest/i, /AbortController/i]) {
    assert(!banned.test(code), `11: the mock must not use ${banned}`);
  }

  // 12/13/14 — nothing sensitive is retained.
  const history = JSON.stringify(p.getLastSentRecords());
  assert(!history.includes(OTP), "12: the OTP value is never retained");
  assert(!history.includes(REAL), "14: the plaintext destination is never retained");
  for (const trigger of Object.values(D)) {
    assert(!history.includes(trigger), `14: the reserved destination ${trigger} is never retained`);
  }
  const record = p.getLastSentRecords()[0];
  assert(record.variableKeys.includes("otp"), "13: variable NAMES are retained");
  assert(!("variables" in record) && !("to" in record) && !("destination" in record), "13/14: no values, no destination");
  assert(Object.keys(record).sort().join(",") === "outcome,sequence,templateKey,variableKeys", `record shape: ${Object.keys(record)}`);
  assert(!/Authorization|credential|apiKey|api_key|secret/i.test(history), "no credential retained");
  // Inspect the pushed object literal itself — the file legitimately contains `to: string`
  // in the private `simulateSend` signature, where the destination is used transiently.
  const pushedLiteral = readCode(MOCK_SMS_SRC).split("lastSentRecords.push({")[1].split("});")[0];
  for (const leaked of [/\bto\b/, /destination/i, /variables\s*[,}]/, /otp/i]) {
    assert(!leaked.test(pushedLiteral), `the retained record literal must not carry ${leaked}`);
  }

  // 15 — deterministic provider message ids, independent of the destination.
  const a = new M.MockSms.MockSmsProvider();
  const b = new M.MockSms.MockSmsProvider();
  const ra = await a.sendAuthenticationMessage("+15550001111", TEMPLATE, { otp: "111111" });
  const rb = await b.sendAuthenticationMessage("+15550002222", TEMPLATE, { otp: "222222" });
  assert(ra.providerMessageId === rb.providerMessageId, "15: ids are deterministic and destination/OTP independent");
  const ra2 = await a.sendAuthenticationMessage("+15550001111", TEMPLATE, { otp: "111111" });
  assert(ra2.providerMessageId !== ra.providerMessageId, "15: the monotonic sequence advances");
  assert(!/Math\.random|Date\.now|randomUUID|randomBytes/.test(code), "15: no randomness, no clock");
});

// ============================================================================
// SELECTION (16–23)
// ============================================================================
check("16-23. selection is lazy, controlled, and ALWAYS fails closed in production", () => {
  const S = M.Selection;
  const R = S.SmsSelectionBlockReason;

  // 16 — non-production, mode absent → controlled mock.
  const implicit = S.selectSmsProvider({});
  assert(implicit.ok && implicit.candidate.mode === "mock" && implicit.candidate.providerKey === "mock_sms", "16: implicit mock");
  assert(implicit.candidate.channel === "sms" && implicit.candidate.isMock === true, "16: candidate identity");
  // 17 — non-production, explicit mock.
  assert(S.selectSmsProvider({ SMS_PROVIDER_MODE: "mock" }).ok === true, "17: explicit mock");
  assert(S.selectSmsProvider({ NODE_ENV: "development", SMS_PROVIDER_MODE: "mock" }).ok === true, "17: development explicit mock");
  // 18 — non-production, unknown mode → fail closed, never mock.
  for (const mode of ["msg91", "twilio", "sms_cloud", "MOCK", "real"]) {
    const bad = S.selectSmsProvider({ SMS_PROVIDER_MODE: mode });
    assert(bad.ok === false && bad.reason === R.UNSUPPORTED_PROVIDER_MODE, `18: ${mode} fails closed`);
    assert(!("candidate" in bad), `18: ${mode} yields no candidate`);
  }
  // 19 — production, mode absent → fail closed.
  const prodAbsent = S.selectSmsProvider({ NODE_ENV: "production" });
  assert(prodAbsent.ok === false && prodAbsent.reason === R.MODE_REQUIRED_IN_PRODUCTION, `19: got ${prodAbsent.reason}`);
  // 20 — production, explicit mock → fail closed (a mock must never carry a live OTP).
  const prodMock = S.selectSmsProvider({ NODE_ENV: "production", SMS_PROVIDER_MODE: "mock" });
  assert(prodMock.ok === false && prodMock.reason === R.MOCK_FORBIDDEN_IN_PRODUCTION, `20: got ${prodMock.reason}`);
  // 21 — production, unsupported mode → fail closed.
  const prodOther = S.selectSmsProvider({ NODE_ENV: "production", SMS_PROVIDER_MODE: "msg91" });
  assert(prodOther.ok === false && prodOther.reason === R.UNSUPPORTED_PROVIDER_MODE, `21: got ${prodOther.reason}`);
  assert(S.selectSmsProvider({ NODE_ENV: "production" }).ok === false && S.selectSmsProvider({ NODE_ENV: "production", SMS_PROVIDER_MODE: "mock" }).ok === false, "production is unconditionally closed");

  // 22 — LAZY: no module-level env read, no module-level resolution.
  const src = readCode(SELECTION_SRC);
  assert(!/^\s*const\s+\w+\s*=\s*process\.env/m.test(src), "22: no module-level process.env read");
  assert(!/^\s*(const|let|var)\s+\w+\s*=\s*selectSmsProvider\(/m.test(src), "22: no module-level resolution");
  assert(/env: EnvSource = process\.env/.test(src), "22: env is a default parameter, evaluated per call");

  // 23 — the mode vocabulary stays CLOSED. It holds mock plus exactly one reviewed vendor,
  // which may be named only in the selection module. No other vendor exists anywhere in C2.
  assert(S.KNOWN_SMS_PROVIDER_MODES.length === 2, "23: closed vocabulary");
  assert(S.KNOWN_SMS_PROVIDER_MODES[0] === "mock" && S.KNOWN_SMS_PROVIDER_MODES[1] === "exotel_sms",
    `23: exactly mock + the one reviewed provider, got ${S.KNOWN_SMS_PROVIDER_MODES}`);
  const c2Files = [OUTCOME_SRC, SMS_IFACE_SRC, MOCK_SMS_SRC, GATE_SRC, SELECTION_SRC, RUNTIME_SVC_SRC, RUNTIME_PROVIDER_SRC];
  const allC2 = c2Files.map((f) => readCode(f)).join("\n");
  for (const vendor of UNREVIEWED_PROVIDERS) {
    assert(!vendor.test(allC2), `23: no unreviewed commercial provider literal (${vendor})`);
  }
  for (const f of c2Files.filter((x) => x !== SELECTION_SRC)) {
    assert(!REVIEWED_PROVIDER.test(readCode(f)), `23: the reviewed vendor is confined to selection, found in ${f}`);
  }
  assert(!/https?:\/\//.test(allC2), "23: no provider HTTP endpoint");
});

// ============================================================================
// PURE RUNTIME GATE (24–47)
// ============================================================================
check("24-29. the runtime activation policy must exist, match, and permit outbound", () => {
  const R = REASON();
  // 24 — missing policy.
  assert(blockedFor({ policy: null }) === R.RUNTIME_POLICY_MISSING, "24: missing policy");
  // policy identity must match the candidate.
  assert(blockedFor({ policy: policyRow({ provider_key: "other" }) }) === R.RUNTIME_POLICY_PROVIDER_MISMATCH, "policy provider must match");
  assert(blockedFor({ policy: policyRow({ channel: "whatsapp" }) }) === R.RUNTIME_POLICY_CHANNEL_NOT_SMS, "policy channel must be sms");
  // 29 — outbound_enabled false blocks, even when activation is `active`.
  assert(blockedFor({ policy: policyRow({ outbound_enabled: false }) }) === R.OUTBOUND_DISABLED, "29: outbound disabled");
  // 25-28 — only canary/active are sendable.
  for (const [n, status] of [[25, "disabled"], [26, "readiness_only"], [27, "shadow"], [28, "paused"]]) {
    assert(blockedFor({ policy: policyRow({ activation_status: status }) }) === R.ACTIVATION_NOT_SENDABLE, `${n}: ${status} blocks`);
  }
  assert(M.Gate.SMS_SENDABLE_ACTIVATION_STATUSES.join(",") === "canary,active", "only canary and active are sendable");
  // The candidate's own identity is checked first.
  assert(blockedFor({ providerKey: "" }) === R.PROVIDER_KEY_MISSING, "empty provider key blocks");
  assert(blockedFor({ channel: "whatsapp" }) === R.PROVIDER_CHANNEL_NOT_SMS, "a non-sms candidate blocks");
});

check("30-36. the provider account must exist, be unique, ready, complete and healthy", () => {
  const R = REASON();
  // 30 — missing account.
  assert(blockedFor({ accounts: [] }) === R.PROVIDER_ACCOUNT_MISSING, "30: missing account");
  // 31 — the provider has an account, but on another channel.
  assert(blockedFor({ accounts: [accountRow({ channel: "whatsapp" })] }) === R.PROVIDER_ACCOUNT_CHANNEL_NOT_SMS, "31: wrong-channel account");
  // …and an sms account belonging to a different provider is not ours.
  assert(blockedFor({ accounts: [accountRow({ provider_key: "other" })] }) === R.PROVIDER_ACCOUNT_PROVIDER_MISMATCH, "wrong-provider account");
  // 32-34 — readiness must be exactly provider_ready.
  for (const [n, status] of [[32, "not_configured"], [33, "credentials_pending"], [34, "account_ready"], [34, "webhook_pending"], [34, "template_mapping_pending"], [34, "disabled"]]) {
    assert(blockedFor({ accounts: [accountRow({ readiness_status: status })] }) === R.PROVIDER_ACCOUNT_NOT_READY, `${n}: ${status} blocks`);
  }
  // 35 — configuration must be complete.
  for (const status of ["pending", "partial", "error"]) {
    assert(blockedFor({ accounts: [accountRow({ configuration_status: status })] }) === R.PROVIDER_ACCOUNT_CONFIGURATION_INCOMPLETE, `35: configuration ${status} blocks`);
  }
  // 36 — an authentication transport demands a HEALTHY provider; `degraded` is refused.
  for (const status of ["unknown", "degraded", "unhealthy"]) {
    assert(blockedFor({ accounts: [accountRow({ health_status: status })] }) === R.PROVIDER_ACCOUNT_UNHEALTHY, `36: health ${status} blocks`);
  }
  // Ambiguity fails closed: readiness must never depend on which row a query returned first.
  assert(blockedFor({ accounts: [accountRow(), accountRow()] }) === R.PROVIDER_ACCOUNT_AMBIGUOUS, "ambiguous account blocks");
});

check("37-47. the approved, active, authentication SMS template mapping", () => {
  const R = REASON();
  // 37 — no mapping at all.
  assert(blockedFor({ mappings: [] }) === R.TEMPLATE_MAPPING_MISSING, "37: missing mapping");
  // 38-40 — not approved (and inactive, as those states ship).
  for (const [n, status] of [[38, "draft"], [38, "ready_for_submission"], [39, "submitted"], [40, "rejected"], [40, "paused"], [40, "disabled"], [40, "superseded"]]) {
    assert(blockedFor({ mappings: [mappingRow({ approval_status: status, is_active: false })] }) === R.TEMPLATE_MAPPING_NOT_APPROVED, `${n}: ${status} blocks`);
  }
  // …and an approval_status that is not `approved` on an ACTIVE row is still refused.
  assert(blockedFor({ mappings: [mappingRow({ approval_status: "submitted", is_active: true })] }) === R.TEMPLATE_MAPPING_NOT_APPROVED, "active but unapproved blocks");
  // 41 — approved but inactive.
  assert(blockedFor({ mappings: [mappingRow({ is_active: false })] }) === R.TEMPLATE_MAPPING_INACTIVE, "41: approved+inactive blocks");
  // 42-45 — the mapping must match template / provider / channel / language exactly.
  assert(blockedFor({ mappings: [mappingRow({ template_key: "other_template" })] }) === R.TEMPLATE_MAPPING_MISSING, "42: wrong template");
  assert(blockedFor({ mappings: [mappingRow({ provider_key: "other" })] }) === R.TEMPLATE_MAPPING_MISSING, "43: wrong provider");
  assert(blockedFor({ mappings: [mappingRow({ channel: "whatsapp" })] }) === R.TEMPLATE_MAPPING_MISSING, "44: wrong channel");
  assert(blockedFor({ mappings: [mappingRow({ language: "hi" })] }) === R.TEMPLATE_MAPPING_MISSING, "45: wrong language");
  // 46 — only the authentication category may carry an OTP.
  for (const category of ["utility", "marketing", "service", null]) {
    assert(blockedFor({ mappings: [mappingRow({ provider_category: category })] }) === R.TEMPLATE_MAPPING_CATEGORY_NOT_AUTHENTICATION, `46: category ${category} blocks`);
  }
  // 47 — two approved+active candidates are ambiguous and fail closed.
  assert(blockedFor({ mappings: [mappingRow({ id: "a" }), mappingRow({ id: "b" })] }) === R.TEMPLATE_MAPPING_AMBIGUOUS, "47: ambiguous mapping blocks");
  // A registered (e.g. DLT) content template name is required — never fabricated.
  assert(blockedFor({ mappings: [mappingRow({ provider_template_name: null })] }) === R.TEMPLATE_MAPPING_PROVIDER_NAME_MISSING, "missing provider template name blocks");
  assert(blockedFor({ mappings: [mappingRow({ provider_template_name: "   " })] }) === R.TEMPLATE_MAPPING_PROVIDER_NAME_MISSING, "blank provider template name blocks");
});

// ============================================================================
// CANARY (48–52) AND ACTIVE (53)
// ============================================================================
check("48-52. canary requires an active, unexpired, exact destination-hash allowlist row", () => {
  const R = REASON();
  const canary = { policy: policyRow({ activation_status: "canary" }) };
  // 48 — no allowlist at all.
  assert(blockedFor({ ...canary, canaryRows: [] }) === R.CANARY_DESTINATION_NOT_ALLOWLISTED, "48: no allowlist");
  // 49 — a different destination hash.
  assert(blockedFor({ ...canary, canaryRows: [canaryRow({ destination_hash: HASH_B })] }) === R.CANARY_DESTINATION_NOT_ALLOWLISTED, "49: wrong hash");
  // …and a row for another provider or channel does not count.
  assert(blockedFor({ ...canary, canaryRows: [canaryRow({ provider_key: "other" })] }) === R.CANARY_DESTINATION_NOT_ALLOWLISTED, "wrong provider row");
  assert(blockedFor({ ...canary, canaryRows: [canaryRow({ channel: "whatsapp" })] }) === R.CANARY_DESTINATION_NOT_ALLOWLISTED, "wrong channel row");
  // 50 — inactive.
  assert(blockedFor({ ...canary, canaryRows: [canaryRow({ is_active: false })] }) === R.CANARY_DESTINATION_NOT_ALLOWLISTED, "50: inactive");
  // 51 — expired.
  assert(blockedFor({ ...canary, canaryRows: [canaryRow({ expires_at: PAST })] }) === R.CANARY_DESTINATION_NOT_ALLOWLISTED, "51: expired");
  assert(blockedFor({ ...canary, canaryRows: [canaryRow({ expires_at: "not-a-date" })] }) === R.CANARY_DESTINATION_NOT_ALLOWLISTED, "unparseable expiry");
  // 52 — active + unexpired + exact hash → infrastructure ready.
  for (const expires of [null, FUTURE]) {
    const d = gate({ ...canary, canaryRows: [canaryRow({ expires_at: expires })] });
    assert(d.status === "SMS_RUNTIME_READY" && d.activation === "canary", `52: canary ready (expires ${expires})`);
    assert(d.mapping.providerTemplateName === "QF_OTP_DLT" && d.mapping.providerCategory === "authentication", "52: the approved mapping is returned");
  }
  // The gate owns no clock: `now` is supplied.
  const src = readCode(GATE_SRC);
  assert(!/Date\.now\(\)/.test(src), "the gate never reads the clock");
});

check("53. an `active` runtime becomes infrastructure-ready without any canary row", () => {
  const d = gate({ policy: policyRow({ activation_status: "active" }), canaryRows: [] });
  assert(d.status === "SMS_RUNTIME_READY" && d.activation === "active", `53: got ${d.status}`);
  assert(d.providerKey === PROVIDER && d.channel === "sms", "53: the ready decision carries the identity");
  assert(M.Gate.isSmsRuntimeReady(d) === true && M.Gate.isSmsRuntimeReady(gate({ policy: null })) === false, "the readiness guard is exact");
  // The gate is PURE.
  const src = readCode(GATE_SRC);
  for (const forbidden of [/adminClient/, /process\.env/, /fetch\(/, /supabase/i, /\.rpc\(/, /Date\.now/, /Math\.random/]) {
    assert(!forbidden.test(src), `the gate must not use ${forbidden}`);
  }
  assert(!/\botp\b/i.test(src) && !/\bphone\b/i.test(src) && !/msisdn/i.test(src), "the gate never sees an OTP or a phone number");
});

// ============================================================================
// RUNTIME READ SERVICE
// ============================================================================
check("runtime service: projects the real registries into the pure gate and fails closed", async () => {
  const R = REASON();
  const query = { providerKey: PROVIDER, channel: "sms", templateKey: TEMPLATE, language: LANGUAGE, destinationHash: HASH_A, now: NOW };

  // Nothing seeded — the shipped state. Blocked.
  resetDb();
  let d = await M.RuntimeSvc.evaluateSmsRuntimeReadiness(query);
  assert(d.status === "SMS_RUNTIME_BLOCKED" && d.reason === R.RUNTIME_POLICY_MISSING, `shipped state blocks: ${d.reason}`);

  // A fully green (hypothetical) infrastructure becomes ready — and nothing else changes.
  db.communication_provider_runtime_policies.push(policyRow());
  db.communication_provider_accounts.push(accountRow());
  db.communication_provider_template_mappings.push(mappingRow());
  d = await M.RuntimeSvc.evaluateSmsRuntimeReadiness(query);
  assert(d.status === "SMS_RUNTIME_READY", `green infra ready: ${d.reason}`);

  // Canary activation needs the allowlist row, read by (provider, sms, hash, is_active).
  db.communication_provider_runtime_policies[0].activation_status = "canary";
  d = await M.RuntimeSvc.evaluateSmsRuntimeReadiness(query);
  assert(d.status === "SMS_RUNTIME_BLOCKED" && d.reason === R.CANARY_DESTINATION_NOT_ALLOWLISTED, "canary without allowlist blocks");
  db.communication_provider_canary_destinations.push(canaryRow());
  d = await M.RuntimeSvc.evaluateSmsRuntimeReadiness(query);
  assert(d.status === "SMS_RUNTIME_READY" && d.activation === "canary", "canary + allowlist ready");
  // An EXPIRED allowlist row blocks, using the supplied clock.
  db.communication_provider_canary_destinations[0].expires_at = PAST;
  d = await M.RuntimeSvc.evaluateSmsRuntimeReadiness(query);
  assert(d.status === "SMS_RUNTIME_BLOCKED" && d.reason === R.CANARY_DESTINATION_NOT_ALLOWLISTED, "expired allowlist blocks");

  // A database read failure is a BLOCK, never an approval.
  dbReadFailure = true;
  d = await M.RuntimeSvc.evaluateSmsRuntimeReadiness(query);
  dbReadFailure = false;
  assert(d.status === "SMS_RUNTIME_BLOCKED" && d.reason === R.RUNTIME_READ_FAILED, `read failure blocks: ${d.reason}`);

  // Ambiguity in the real registries fails closed too.
  resetDb();
  db.communication_provider_runtime_policies.push(policyRow());
  db.communication_provider_accounts.push(accountRow(), accountRow());
  db.communication_provider_template_mappings.push(mappingRow());
  d = await M.RuntimeSvc.evaluateSmsRuntimeReadiness(query);
  assert(d.reason === R.PROVIDER_ACCOUNT_AMBIGUOUS, "ambiguous accounts block");
  resetDb();
  db.communication_provider_runtime_policies.push(policyRow());
  db.communication_provider_accounts.push(accountRow());
  db.communication_provider_template_mappings.push(mappingRow({ id: "a" }), mappingRow({ id: "b" }));
  d = await M.RuntimeSvc.evaluateSmsRuntimeReadiness(query);
  assert(d.reason === R.TEMPLATE_MAPPING_AMBIGUOUS, "ambiguous mappings block");
  resetDb();
});

// ============================================================================
// RUNTIME PROVIDER RESOLUTION BOUNDARY
// ============================================================================
check("runtime provider boundary: lazy candidate, identity fence, and it never sends", () => {
  const RP = M.RuntimeProvider;
  // Non-production resolves the mock CANDIDATE — an identity, not an instance.
  const candidate = RP.resolveSmsProviderCandidate({});
  assert(candidate.ok && candidate.data.providerKey === "mock_sms" && candidate.data.channel === "sms", "candidate resolves");
  assert(RP.isSmsProviderCandidateAvailable({}) === true, "availability guard");
  // Production fails closed, in every mode.
  for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "production", SMS_PROVIDER_MODE: "mock" }, { NODE_ENV: "production", SMS_PROVIDER_MODE: "msg91" }]) {
    const r = RP.resolveSmsProviderCandidate(env);
    assert(!r.ok && r.code === RP.RUNTIME_SMS_PROVIDER_UNAVAILABLE, `production fails closed: ${JSON.stringify(env)}`);
    assert(!("data" in r), "no candidate on failure");
    assert(RP.isSmsProviderCandidateAvailable(env) === false, "availability guard fails closed");
  }
  // The adapter comes from a CALLER-injected factory, behind a provider identity fence.
  const built = RP.createRuntimeSmsProvider(() => new M.MockSms.MockSmsProvider(), {});
  assert(built.ok && built.data.providerKey === "mock_sms", "a matching adapter is accepted");
  const impostor = RP.createRuntimeSmsProvider(() => ({ providerKey: "not_the_candidate", channel: "sms" }), {});
  assert(!impostor.ok && impostor.code === RP.RUNTIME_SMS_PROVIDER_IDENTITY_MISMATCH, "a mismatched adapter is refused");
  const wrongChannel = RP.createRuntimeSmsProvider(() => ({ providerKey: "mock_sms", channel: "whatsapp" }), {});
  assert(!wrongChannel.ok && wrongChannel.code === RP.RUNTIME_SMS_PROVIDER_IDENTITY_MISMATCH, "a non-sms adapter is refused");
  assert(RP.createRuntimeSmsProvider(() => new M.MockSms.MockSmsProvider(), { NODE_ENV: "production" }).ok === false, "production never builds an adapter");

  // C2 constructs NO adapter and sends NOTHING.
  const src = readCode(RUNTIME_PROVIDER_SRC);
  assert(!/new\s+\w*SmsProvider\s*\(/.test(src), "the boundary never instantiates an adapter");
  assert(!/sendAuthenticationMessage\s*\(/.test(src), "the boundary never sends");
});

// ============================================================================
// AUTHORITY SEPARATION (54–60)
// ============================================================================
check("54-58. runtime readiness is INFRASTRUCTURE, never fallback authorization", () => {
  // 54 — the vocabulary itself refuses to say "allowed".
  const gateSrc = readCode(GATE_SRC);
  const runtimeSrc = readCode(RUNTIME_SVC_SRC);
  const boundarySrc = readCode(RUNTIME_PROVIDER_SRC);
  assert(M.Gate.SMS_RUNTIME_READY === "SMS_RUNTIME_READY" && M.Gate.SMS_RUNTIME_BLOCKED === "SMS_RUNTIME_BLOCKED", "54: infrastructure vocabulary");
  for (const forbidden of [/FALLBACK_ALLOWED/i, /fallbackAuthorized/i, /authorizeFallback/i, /fallbackEligible/i]) {
    for (const [name, src] of [["gate", gateSrc], ["runtime service", runtimeSrc], ["boundary", boundarySrc]]) {
      assert(!forbidden.test(src), `54: the ${name} must not export ${forbidden}`);
    }
  }
  assert(!Object.keys(M.Gate).some((k) => /fallback/i.test(k)), "54: the gate exports nothing named fallback");

  // 55 — the runtime service never writes (a write throws in the stub, and the source has none).
  for (const write of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /\.rpc\(/]) {
    assert(!write.test(runtimeSrc), `55: the runtime service must not ${write}`);
  }
  // 56 — it never claims an attempt, and never calls the C1 decision engine.
  for (const src of [runtimeSrc, boundarySrc, gateSrc]) {
    assert(!/claimPrimaryAttempt|claimFallbackAttempt|finalizeAttempt|authentication_delivery_attempts/.test(src), "56: no attempt claim");
    assert(!/decideAuthenticationFallback|evaluateAuthenticationFallback|authenticationTransportDecision/.test(src), "56: no fallback decision");
    // 57 — it never sends.
    assert(!/sendAuthenticationMessage\s*\(/.test(src), "57: no SMS send call");
    assert(!/communication_messages/.test(src), "57: no communication ledger write");
  }
  // 58 — C2 creates no fallback integration endpoint and no SMS dispatch service/webhook.
  for (const f of ["services/smsDispatchService.ts", "services/smsFallbackService.ts", "services/authenticationFallbackService.ts", "services/messageRouter.ts"]) {
    assert(!existsSync(f), `58: ${f} must not exist`);
  }
  for (const d of ["app/api/webhooks/sms", "app/api/communication/sms", "app/api/auth/fallback"]) {
    assert(!existsSync(d), `58: ${d} must not exist`);
  }
  // No production file instantiates the mock SMS adapter (the 5F-A invariant still holds).
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  for (const f of [...walk("services"), ...walk("app"), ...walk("lib")]) {
    if (f === MOCK_SMS_SRC) continue;
    const c = readFileSync(f, "utf8");
    assert(!/new\s+MockSmsProvider\s*\(/.test(c), `${f} must not instantiate MockSmsProvider`);
    assert(!/setActiveSmsProvider|activeSmsProvider/.test(c), `${f} must not register an active SMS provider`);
  }
});

check("59-60. C1 authority, Supabase OTP authority, and vendor_whatsapp_verify are untouched", () => {
  // 59 — the Supabase OTP hook is untouched: it dispatches WhatsApp only, and knows no SMS.
  const hook = readCode("services/supabaseSendSmsHookService.ts");
  assert(/channel: "whatsapp"/.test(hook), "59: the OTP intent is still whatsapp");
  assert(!/smsProvider|SmsProvider|selectSmsProvider|runtimeSmsProvider|smsRuntimeGate/.test(hook), "59: the hook knows nothing about SMS");
  assert(!/fallback/i.test(hook), "59: the hook has no fallback path");
  // The vendor reset service is likewise untouched.
  const reset = readCode("services/vendorPasswordResetService.ts");
  assert(!/smsProvider|SmsProvider|selectSmsProvider|smsRuntimeGate/.test(reset), "59: vendor reset dispatches no SMS");

  // 60 — vendor_whatsapp_verify remains WhatsApp-only, at every layer C1 built.
  const c1 = readFileSync(C1_DECISION_SRC, "utf8");
  assert(/WHATSAPP_VERIFICATION_FALLBACK_FORBIDDEN/.test(c1), "60: the engine still forbids it");
  const migration = readFileSync(AUTH_TRANSPORT_MIGRATION, "utf8");
  assert(/chk_auth_attempt_whatsapp_verify_no_fallback/.test(migration), "60: attempt 2 is structurally impossible");
  assert(/chk_auth_failure_rule_whatsapp_verify_never_eligible/.test(migration), "60: no eligible failure rule may exist");
  assert(/whatsapp_verify_fallback_forbidden/.test(migration), "60: the claim RPC refuses it");

  // C1's decision authority is byte-for-byte unchanged by C2.
  const c1Files = [C1_DECISION_SRC, C1_ATTEMPT_SVC_SRC, "services/authenticationTransportPolicyService.ts", AUTH_TRANSPORT_MIGRATION];
  const changed = execFileSync("git", ["status", "--porcelain", "--", ...c1Files], { encoding: "utf8" }).trim();
  assert(changed === "", `C1 authority files must be unmodified, got:\n${changed}`);
});

// ============================================================================
// NO ACTIVATION / NO MIGRATION
// ============================================================================
check("no activation: no migration, no seeds, no policy change, no Meta activation", () => {
  // C2 adds NO migration. The generic 5F-A/5F-B schemas already support sms.
  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  const newest = migrations[migrations.length - 1];
  assert(newest === "20260710000100_auth_transport_resilience_decision_foundation.sql", `no new migration; newest is ${newest}`);
  const untracked = execFileSync("git", ["status", "--porcelain", "--", "supabase/migrations"], { encoding: "utf8" }).trim();
  assert(untracked === "", `no migration was created or modified, got:\n${untracked}`);

  // The generic registries already support sms — no duplicate SMS table exists.
  const foundation = readFileSync(FOUNDATION_MIGRATION, "utf8");
  for (const table of ["communication_provider_accounts", "communication_provider_template_mappings"]) {
    assert(new RegExp(`create table if not exists public\\.${table}`).test(foundation), `${table} already exists`);
  }
  assert(/check \(channel in \('whatsapp', 'sms', 'rcs'\)\)/.test(foundation), "the generic channel vocabulary already supports sms");
  assert(/provider_category[\s\S]{0,200}'authentication'/.test(foundation), "the mapping registry already has provider_category");
  for (const f of readdirSync("supabase/migrations")) {
    assert(!/sms/i.test(f), `no SMS-specific migration exists (${f})`);
  }

  // The three auth transport policies still ship fully disabled, with no fallback provider.
  const seed = foundation.match(/insert into public\.authentication_transport_policies[\s\S]*?on conflict/i)[0];
  assert(/\('client_login_otp',\s*'whatsapp', 'mock', 'sms',\s*null, false, false, 'disabled', true, false\)/.test(seed), "client_login_otp still disabled with no fallback provider");
  assert(/\('vendor_password_reset', 'whatsapp', 'mock', 'sms',\s*null, false, false, 'disabled', true, false\)/.test(seed), "vendor_password_reset still disabled");
  assert(/\('vendor_whatsapp_verify','whatsapp', 'mock', null,\s*null, false, false, 'disabled', true, false\)/.test(seed), "vendor_whatsapp_verify has no fallback channel");

  // No failure rule is ever seeded, and Meta stays inactive.
  const c1Migration = readFileSync(AUTH_TRANSPORT_MIGRATION, "utf8");
  assert(!/insert into public\.authentication_transport_failure_rules/i.test(c1Migration), "the failure-rule table stays empty");
  const metaMigration = readFileSync("supabase/migrations/20260709000200_whatsapp_cloud_api_runtime_control.sql", "utf8");
  assert(/\('meta_whatsapp_cloud', 'whatsapp', 'disabled', false, false, false\)/.test(metaMigration), "Meta remains fully disabled");

  // C2's own sources seed nothing and enable nothing.
  const allC2 = [OUTCOME_SRC, SMS_IFACE_SRC, MOCK_SMS_SRC, GATE_SRC, SELECTION_SRC, RUNTIME_SVC_SRC, RUNTIME_PROVIDER_SRC].map(readCode).join("\n");
  for (const forbidden of [/insert into/i, /authentication_transport_policies/, /authentication_transport_failure_rules/, /outbound_enabled\s*=\s*true/, /is_operationally_enabled/, /n8n/i, /jarvis/i]) {
    assert(!forbidden.test(allC2), `C2 must not touch ${forbidden}`);
  }
});

check("no SMS resend loop exists anywhere in C2", () => {
  const allC2 = [OUTCOME_SRC, SMS_IFACE_SRC, MOCK_SMS_SRC, GATE_SRC, SELECTION_SRC, RUNTIME_SVC_SRC, RUNTIME_PROVIDER_SRC].map(readCode).join("\n");
  // No loop construct wraps a send, because no send exists at all outside the mock adapter.
  assert(!/for\s*\([^)]*\)\s*{[^}]*sendAuthenticationMessage/.test(allC2), "no send inside a for loop");
  assert(!/while\s*\([^)]*\)\s*{[^}]*sendAuthenticationMessage/.test(allC2), "no send inside a while loop");
  assert(!/retry|resend|attempts\s*\+\+/i.test(readCode(RUNTIME_PROVIDER_SRC)), "the boundary has no retry logic");
  assert(!/\bsetTimeout\b|\bsetInterval\b/.test(allC2), "no scheduler");
  // The only `sendAuthenticationMessage` implementation in C2 is the mock's, called once.
  const sends = (allC2.match(/sendAuthenticationMessage/g) ?? []).length;
  assert(sends === 2, `sendAuthenticationMessage appears only in the interface declaration + the mock's implementation, got ${sends}`);
  assert(/sendAuthenticationMessage/.test(readCode(SMS_IFACE_SRC)) && /sendAuthenticationMessage/.test(readCode(MOCK_SMS_SRC)), "…and only in those two files");
  // `permitsAutomaticRetry` is a transport-level predicate and is called by nothing in C2.
  const callers = [SMS_IFACE_SRC, MOCK_SMS_SRC, GATE_SRC, SELECTION_SRC, RUNTIME_SVC_SRC, RUNTIME_PROVIDER_SRC]
    .filter((f) => /permitsAutomaticRetry\s*\(/.test(readCode(f)));
  assert(callers.length === 0, `nothing in C2 acts on permitsAutomaticRetry, got ${callers}`);
  assert(/two transport attempts per authentication action/.test(readFileSync(OUTCOME_SRC, "utf8")), "the C1 attempt budget is documented as authoritative");
  // A real adapter must use the abortable transport, never Promise.race.
  assert(!/Promise\.race/.test(allC2), "no Promise.race pseudo-timeout");
  assert(/Promise\.race/.test(readFileSync(SMS_IFACE_SRC, "utf8")), "the contract forbids Promise.race explicitly");
});

check("timeout ceiling may only shorten a configured timeout, never extend it", () => {
  const { resolveSmsNetworkTimeoutMs } = M.Sms;
  assert(resolveSmsNetworkTimeoutMs(3000) === 3000, "no ceiling → configured");
  assert(resolveSmsNetworkTimeoutMs(3000, {}) === 3000, "absent ceiling → configured");
  assert(resolveSmsNetworkTimeoutMs(3000, { maxNetworkTimeoutMs: null }) === 3000, "null ceiling → configured");
  assert(resolveSmsNetworkTimeoutMs(3000, { maxNetworkTimeoutMs: 1100 }) === 1100, "a lower ceiling shortens");
  assert(resolveSmsNetworkTimeoutMs(3000, { maxNetworkTimeoutMs: 9000 }) === 3000, "a higher ceiling NEVER extends");
  assert(resolveSmsNetworkTimeoutMs(3000, { maxNetworkTimeoutMs: 0 }) === 1, "a spent budget clamps to the minimum, never to zero-forever");
  assert(/maxNetworkTimeoutMs\?: number \| null/.test(readFileSync(SMS_IFACE_SRC, "utf8")), "the option is declared on the contract");
});

check("wiring. test:phase5f:c2 exists, test:phase5f:c is untouched, docs exist", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(pkg.scripts["test:phase5f:c2"] === "node scripts/phase5f-c2-sms-runtime-foundation-harness.mjs", "test:phase5f:c2 wired");
  assert(pkg.scripts["test:phase5f:c"] === "node scripts/phase5f-c-auth-transport-resilience-harness.mjs", "test:phase5f:c unchanged");
  for (const f of [OUTCOME_SRC, SMS_IFACE_SRC, MOCK_SMS_SRC, GATE_SRC, SELECTION_SRC, RUNTIME_SVC_SRC, RUNTIME_PROVIDER_SRC, DOC_C2]) {
    assert(existsSync(f), `${f} exists`);
  }
  const doc = readFileSync(DOC_C2, "utf8");
  for (const topic of [
    /authority boundar/i, /provider-neutral/i, /no commercial provider/i, /fail closed/i,
    /outcome[- ]certainty/i, /timeout/i, /runtime readiness/i, /provider account/i,
    /template mapping/i, /canary/i, /active/i, /fallback authorization/i,
    /no SMS retry loop/i, /no real send/i, /no policy activation/i, /C3/, /C4/, /DLT/,
  ]) {
    assert(topic.test(doc), `the documentation covers ${topic}`);
  }
  assert(/not applied|NOT applied|no migration/i.test(doc), "the doc states no migration was created");
  // The doc must STATE the negations, and must never make the affirmative claims.
  assert(/SMS is not live/i.test(doc), "the doc states SMS is not live");
  assert(/remains \*\*external and pending\*\*/i.test(doc) && /No DLT approval is\s*\n?\s*claimed/i.test(doc), "the doc states DLT readiness is external and pending");
  for (const affirmative of [/\bSMS is live\b/i, /SMS fallback is enabled/i, /DLT approval is complete/i]) {
    assert(!affirmative.test(doc), `the doc must never claim ${affirmative}`);
  }
  for (const vendor of COMMERCIAL_PROVIDERS) {
    // A vendor may be NAMED in the doc only as a thing that has NOT been chosen.
    if (vendor.test(doc)) assert(/not been (chosen|selected)|no commercial provider/i.test(doc), `${vendor} appears without a "not chosen" statement`);
  }
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutationChecks = [];
function tsMutation(name, edits, scenario) {
  mutationChecks.push({ name, kind: "ts", edits: edits.map(([file, from, to]) => ({ file, from, to })), scenario });
}
function srcMutation(name, file, from, to, scenario) {
  mutationChecks.push({ name, kind: "src", edits: [{ file, from, to }], scenario });
}
const readF = (f) => readFileSync(f, "utf8");

// ---- selection ------------------------------------------------------------
tsMutation("MUT A: production with no mode silently falls back to mock",
  [[SELECTION_SRC,
    "    if (raw === null) {\n      return { ok: false, reason: SmsSelectionBlockReason.MODE_REQUIRED_IN_PRODUCTION, variable: SMS_PROVIDER_MODE_ENV };\n    }",
    "    if (raw === null) {\n      return { ok: true, candidate: MOCK_CANDIDATE };\n    }"]],
  (mm) => mm.Selection.selectSmsProvider({ NODE_ENV: "production" }).ok === true);

tsMutation("MUT B: production with an explicit mock is allowed to send",
  [[SELECTION_SRC,
    "    if (raw === SmsProviderMode.MOCK) {\n      return { ok: false, reason: SmsSelectionBlockReason.MOCK_FORBIDDEN_IN_PRODUCTION, variable: SMS_PROVIDER_MODE_ENV };\n    }",
    "    if (raw === SmsProviderMode.MOCK) {\n      return { ok: true, candidate: MOCK_CANDIDATE };\n    }"]],
  (mm) => mm.Selection.selectSmsProvider({ NODE_ENV: "production", SMS_PROVIDER_MODE: "mock" }).ok === true);

tsMutation("MUT C: an unknown provider mode silently becomes mock",
  [[SELECTION_SRC,
    "  if (raw === null || raw === SmsProviderMode.MOCK) {\n    return { ok: true, candidate: MOCK_CANDIDATE };\n  }\n  return { ok: false, reason: SmsSelectionBlockReason.UNSUPPORTED_PROVIDER_MODE, variable: SMS_PROVIDER_MODE_ENV };",
    "  return { ok: true, candidate: MOCK_CANDIDATE };"]],
  (mm) => {
    const r = mm.Selection.selectSmsProvider({ SMS_PROVIDER_MODE: "some_unreviewed_vendor" });
    return r.ok === true; // an unreviewed vendor mode silently produced a provider
  });

// ---- outcome certainty ----------------------------------------------------
tsMutation("MUT D: an unknown outcome is converted into a definitive failure",
  [[OUTCOME_SRC,
    '  if (!KNOWN_OUTCOME_CERTAINTIES.includes(c)) return "unknown_outcome";',
    '  if (!KNOWN_OUTCOME_CERTAINTIES.includes(c)) return "definitive_failure";']],
  (mm) => mm.Outcome.effectiveProviderOutcomeCertainty({ accepted: false }) === "definitive_failure");

tsMutation("MUT D2: a contradictory result is accepted at face value",
  [[OUTCOME_SRC,
    "  if (isContradictoryProviderOutcome(result)) return \"unknown_outcome\";",
    ""]],
  (mm) => mm.Outcome.effectiveProviderOutcomeCertainty({ accepted: true, outcomeCertainty: "definitive_failure" }) === "definitive_failure");

tsMutation("MUT E: a timeout becomes retry authorization",
  [[OUTCOME_SRC,
    '  if (outcome.kind === "aborted") {\n    return { outcomeCertainty: "unknown_outcome", retryable: false };\n  }',
    '  if (outcome.kind === "aborted") {\n    return { outcomeCertainty: "definitive_failure", retryable: true };\n  }']],
  (mm) => {
    const r = mm.Outcome.classifyTransportCertainty({ kind: "aborted" });
    // A timed-out request may already have delivered the OTP; a resend duplicates it.
    return mm.Outcome.permitsAutomaticRetry({ accepted: false, ...r }) === true;
  });

tsMutation("MUT E2: unknown_outcome authorizes an automatic retry",
  [[OUTCOME_SRC,
    '  return effectiveProviderOutcomeCertainty(result) === "definitive_failure" && result.retryable === true;',
    "  return result.retryable === true;"]],
  (mm) => mm.Outcome.permitsAutomaticRetry({ accepted: false, outcomeCertainty: "unknown_outcome", retryable: true }) === true);

// ---- runtime gate ---------------------------------------------------------
const gateMutation = (name, from, to, scenario) => tsMutation(name, [[GATE_SRC, from, to]], scenario);

gateMutation("MUT F: a missing runtime policy becomes ready",
  "  if (!policy) return blocked(SmsRuntimeBlockReason.RUNTIME_POLICY_MISSING);",
  "  if (!policy) return { status: SMS_RUNTIME_READY, providerKey: input.providerKey, channel: \"sms\", activation: \"active\", mapping: { mappingId: null, templateKey: input.templateKey, providerKey: input.providerKey, channel: \"sms\", language: input.language, providerTemplateName: \"fabricated\", providerTemplateId: null, providerCategory: AUTHENTICATION_TEMPLATE_CATEGORY } };",
  (mm) => gate({ policy: null }, mm).status === "SMS_RUNTIME_READY");

gateMutation("MUT G: a disabled runtime policy becomes ready",
  "  if (!SMS_SENDABLE_ACTIVATION_STATUSES.includes(policy.activation_status)) {\n    // disabled / readiness_only / shadow / paused all stop here.\n    return blocked(SmsRuntimeBlockReason.ACTIVATION_NOT_SENDABLE, policy.activation_status);\n  }",
  "",
  (mm) => gate({ policy: policyRow({ activation_status: "disabled" }) }, mm).status === "SMS_RUNTIME_READY");

gateMutation("MUT H: the outbound_enabled check is removed",
  "  if (policy.outbound_enabled !== true) {\n    return blocked(SmsRuntimeBlockReason.OUTBOUND_DISABLED);\n  }",
  "",
  (mm) => gate({ policy: policyRow({ outbound_enabled: false }) }, mm).status === "SMS_RUNTIME_READY");

gateMutation("MUT I: the provider_ready check is removed",
  "  if (account.readiness_status !== REQUIRED_SMS_ACCOUNT_READINESS.readiness_status) {",
  "  if (false) {",
  (mm) => gate({ accounts: [accountRow({ readiness_status: "credentials_pending" })] }, mm).status === "SMS_RUNTIME_READY");

gateMutation("MUT J: the configuration-complete check is removed",
  "  if (account.configuration_status !== REQUIRED_SMS_ACCOUNT_READINESS.configuration_status) {",
  "  if (false) {",
  (mm) => gate({ accounts: [accountRow({ configuration_status: "partial" })] }, mm).status === "SMS_RUNTIME_READY");

gateMutation("MUT K: the provider health check is removed",
  "  if (account.health_status !== REQUIRED_SMS_ACCOUNT_READINESS.health_status) {",
  "  if (false) {",
  (mm) => gate({ accounts: [accountRow({ health_status: "unhealthy" })] }, mm).status === "SMS_RUNTIME_READY");

gateMutation("MUT L: the mapping approval check is removed",
  "  if (mapping.approval_status !== \"approved\") {",
  "  if (false) {",
  (mm) => gate({ mappings: [mappingRow({ approval_status: "draft" })] }, mm).status === "SMS_RUNTIME_READY");

gateMutation("MUT M: the mapping active check is removed",
  "  const active = matching.filter((m) => m.is_active === true);",
  "  const active = matching;",
  (mm) => gate({ mappings: [mappingRow({ is_active: false })] }, mm).status === "SMS_RUNTIME_READY");

gateMutation("MUT N: the authentication-category check is removed",
  "  if (mapping.provider_category !== AUTHENTICATION_TEMPLATE_CATEGORY) {",
  "  if (false) {",
  (mm) => gate({ mappings: [mappingRow({ provider_category: "marketing" })] }, mm).status === "SMS_RUNTIME_READY");

gateMutation("MUT O: the provider identity check is removed from the mapping filter",
  "      m.provider_key === input.providerKey &&\n      m.language === input.language",
  "      m.language === input.language",
  (mm) => gate({ mappings: [mappingRow({ provider_key: "an_unrelated_provider" })] }, mm).status === "SMS_RUNTIME_READY");

gateMutation("MUT P: the channel check is removed from the mapping filter",
  "      m.channel === SMS_CHANNEL &&",
  "",
  (mm) => gate({ mappings: [mappingRow({ channel: "whatsapp" })] }, mm).status === "SMS_RUNTIME_READY");

gateMutation("MUT Q: the canary destination-hash requirement is removed",
  "        row.destination_hash === input.destinationHash &&",
  "",
  (mm) => gate({ policy: policyRow({ activation_status: "canary" }), canaryRows: [canaryRow({ destination_hash: HASH_B })] }, mm).status === "SMS_RUNTIME_READY");

gateMutation("MUT R: an expired canary row becomes valid",
  "  if (row.expires_at === null || row.expires_at === undefined) return true;\n  const expiresAt = Date.parse(row.expires_at);\n  return Number.isFinite(expiresAt) && expiresAt > nowMs;",
  "  return true;",
  (mm) => gate({ policy: policyRow({ activation_status: "canary" }), canaryRows: [canaryRow({ expires_at: PAST })] }, mm).status === "SMS_RUNTIME_READY");

gateMutation("MUT S: an ambiguous mapping set silently picks the first row",
  "  if (active.length > 1) {\n    // Ambiguity is a security bug: eligibility must never depend on row order.\n    return blocked(SmsRuntimeBlockReason.TEMPLATE_MAPPING_AMBIGUOUS);\n  }",
  "",
  (mm) => gate({ mappings: [mappingRow({ id: "a" }), mappingRow({ id: "b", provider_template_name: "OTHER" })] }, mm).status === "SMS_RUNTIME_READY");

gateMutation("MUT S2: an ambiguous provider-account set silently picks the first row",
  "  if (candidates.length > 1) {\n    // Readiness must never depend on which row a query happened to return first.\n    return blocked(SmsRuntimeBlockReason.PROVIDER_ACCOUNT_AMBIGUOUS);\n  }",
  "",
  (mm) => gate({ accounts: [accountRow(), accountRow({ health_status: "unhealthy" })] }, mm).status === "SMS_RUNTIME_READY");

// ---- mock hardening -------------------------------------------------------
// Both edits widen the RECORD TYPE as well as the pushed literal, so the mutant compiles
// and the leak is observed for real. (The type alone already refuses the field, which is a
// guard in its own right — these prove the retention behaviour, not just the type.)
tsMutation("MUT T: the mock retains the OTP value in its send history",
  [[MOCK_SMS_SRC,
    "  readonly variableKeys: readonly string[];",
    "  readonly variableKeys: readonly string[];\n  readonly variables?: Record<string, string>;"],
   [MOCK_SMS_SRC,
    "      variableKeys: Object.keys(variables),",
    "      variableKeys: Object.keys(variables),\n      variables,"]],
  async (mm) => {
    const p = new mm.MockSms.MockSmsProvider();
    await p.sendAuthenticationMessage("+919876543210", TEMPLATE, { otp: "483920" });
    return JSON.stringify(p.getLastSentRecords()).includes("483920");
  });

tsMutation("MUT U: the mock retains the plaintext destination in its send history",
  [[MOCK_SMS_SRC,
    "export interface MockSmsSendRecord {\n  readonly templateKey: string;",
    "export interface MockSmsSendRecord {\n  readonly to?: string;\n  readonly templateKey: string;"],
   [MOCK_SMS_SRC,
    "      templateKey,\n      variableKeys: Object.keys(variables),",
    "      to,\n      templateKey,\n      variableKeys: Object.keys(variables),"]],
  async (mm) => {
    const p = new mm.MockSms.MockSmsProvider();
    await p.sendAuthenticationMessage("+919876543210", TEMPLATE, { otp: "483920" });
    return JSON.stringify(p.getLastSentRecords()).includes("+919876543210");
  });

// ---- structural: no send, no vendor, no activation -------------------------
srcMutation("MUT V: an SMS send call is introduced into the runtime readiness path",
  RUNTIME_SVC_SRC,
  "    return evaluateSmsRuntimeGate({",
  "    await (globalThis as { provider?: { sendAuthenticationMessage: (a: string, b: string, c: Record<string, string>) => Promise<unknown> } }).provider?.sendAuthenticationMessage(\"+10000000000\", query.templateKey, {});\n    return evaluateSmsRuntimeGate({",
  () => /sendAuthenticationMessage/.test(readF(RUNTIME_SVC_SRC)));

srcMutation("MUT W: an UNREVIEWED commercial provider literal appears in the selection vocabulary",
  SELECTION_SRC,
  "export const SmsProviderMode = {\n  MOCK: \"mock\",\n  EXOTEL_SMS: \"exotel_sms\",\n} as const;",
  "export const SmsProviderMode = {\n  MOCK: \"mock\",\n  EXOTEL_SMS: \"exotel_sms\",\n  MSG91: \"msg91\",\n} as const;",
  () => UNREVIEWED_PROVIDERS.some((v) => v.test(readF(SELECTION_SRC))));

srcMutation("MUT X: a transport policy activation appears in the runtime service",
  RUNTIME_SVC_SRC,
  "export async function evaluateSmsRuntimeReadiness(",
  "export async function activateSmsFallback(): Promise<void> {\n  await adminClient().from(\"authentication_transport_policies\").update({ is_operationally_enabled: true });\n}\n\nexport async function evaluateSmsRuntimeReadiness(",
  () => /authentication_transport_policies/.test(readF(RUNTIME_SVC_SRC)) || /\.update\(/.test(readF(RUNTIME_SVC_SRC)));

// ============================================================================
// EXECUTE
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-C2 SMS runtime foundation checks...\n");
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
  console.log("\nRunning Phase 5F-C2 mutation tests...\n");
  for (const mut of mutationChecks) {
    const mutDir = resolve(`.phase5fc2-mut-${mutationChecks.indexOf(mut)}`);
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
        violation = await mut.scenario(mm);
      } else {
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
