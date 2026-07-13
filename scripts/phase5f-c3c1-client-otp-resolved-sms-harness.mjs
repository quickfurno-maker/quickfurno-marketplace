import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5F-C3-C-1 — pure DLT authentication body renderer + resolved SMS send contract +
 * provider-neutral orchestrator wiring.
 *
 * Proves, with NO database, NO network, NO real provider and NO real credential, and while
 * everything ships operationally DISABLED:
 *   • the renderer is pure, deterministic, narrow, cross-checks the template identity, and
 *     fails closed without ever logging or returning the OTP;
 *   • the widened SmsProvider contract is implemented by BOTH the mock (no-wire) and Exotel,
 *     and widening it does not weaken the production mock prohibition;
 *   • the orchestrator resolves the reviewed body BEFORE the atomic attempt-2 claim, sends
 *     exactly one RESOLVED SMS carrying the SAME OTP inside the body, stays provider-neutral,
 *     and every gate blocks with no claim and no send.
 *
 * Mutation tests edit the REAL source, recompile, and assert the vulnerability appears,
 * restoring every file byte-identically afterwards.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const TS_FILES = [
  "lib/errors.ts",
  "lib/communication/httpTransport.ts",
  "lib/communication/phone.ts",
  "lib/communication/providers/providerError.ts",
  "lib/communication/providers/providerOutcome.ts",
  "lib/communication/providers/whatsappProvider.ts",
  "lib/communication/providers/smsProvider.ts",
  "lib/communication/providers/smsRuntimeGate.ts",
  "lib/communication/providers/mockSmsProvider.ts",
  "lib/communication/providers/exotelConfig.ts",
  "lib/communication/providers/exotelSmsProvider.ts",
  "lib/communication/authSmsBodyRenderer.ts",
  "lib/identity/authTransport.ts",
  "lib/identity/authSecurityEvent.ts",
  "lib/communication/authenticationActionIdentity.ts",
  "lib/communication/authenticationTransportDecision.ts",
  "lib/auth/hookDeadline.ts",
  "lib/auth/authAttemptOutcomeMapping.ts",
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

const ORCHESTRATOR_SRC = "services/clientLoginOtpDeliveryOrchestrator.ts";
const RENDERER_SRC = "lib/communication/authSmsBodyRenderer.ts";
const SMS_IFACE_SRC = "lib/communication/providers/smsProvider.ts";
const MOCK_SMS_SRC = "lib/communication/providers/mockSmsProvider.ts";
const EXOTEL_ADAPTER_SRC = "lib/communication/providers/exotelSmsProvider.ts";
const SMS_FACTORY_SRC = "services/runtimeSmsAdapterFactory.ts";
const DOC_C3C1 = "docs/QF-Client-OTP-Resolved-SMS-Renderer-Phase-5F-C3-C-1.md";

/** Transpile the orchestrator ALONE; its service graph is satisfied by require() stubs. */
function transpileOrchestrator(outDir) {
  const tsconfigPath = resolve(`${outDir}.orch.tsconfig.json`);
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          module: "commonjs", target: "ES2020", moduleResolution: "node",
          skipLibCheck: true, esModuleInterop: true, strict: false, isolatedModules: true,
          outDir, rootDir: ".", types: [], noResolve: true,
        },
        files: [ORCHESTRATOR_SRC],
      },
      null,
      2
    )
  );
  try {
    execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" });
  } catch {
    /* expected: noResolve diagnostics. Emit still happened. */
  } finally {
    rmSync(tsconfigPath, { force: true });
  }
  if (!existsSync(resolve(outDir, "services/clientLoginOtpDeliveryOrchestrator.js"))) {
    throw new Error("the orchestrator did not transpile");
  }
}

/** Stub the orchestrator's service-layer imports. It never calls them (deps are injected). */
function stubServiceModules(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const original = Module._load;
  const STUBS = {
    "./authenticationDeliveryAttemptService": {
      AuthAttemptClaimOutcome: {
        CLAIMED: "CLAIMED", ALREADY_EXISTS: "ALREADY_EXISTS", PRIMARY_REQUIRED: "PRIMARY_REQUIRED",
        PRIMARY_NOT_DEFINITIVE: "PRIMARY_NOT_DEFINITIVE", UNKNOWN_OUTCOME_BLOCKED: "UNKNOWN_OUTCOME_BLOCKED",
        ACCEPTED_PRIMARY_BLOCKED: "ACCEPTED_PRIMARY_BLOCKED", LINEAGE_MISMATCH: "LINEAGE_MISMATCH",
        ATTEMPT_LIMIT_REACHED: "ATTEMPT_LIMIT_REACHED",
        WHATSAPP_VERIFY_FALLBACK_FORBIDDEN: "WHATSAPP_VERIFY_FALLBACK_FORBIDDEN",
        INVALID_REQUEST: "INVALID_REQUEST", DATABASE_ERROR: "DATABASE_ERROR",
      },
      claimPrimaryAttempt: () => { throw new Error("real claim must never run"); },
      claimFallbackAttempt: () => { throw new Error("real claim must never run"); },
      finalizeAttempt: () => { throw new Error("real finalize must never run"); },
    },
    "./authenticationTransportPolicyService": {
      decideAuthenticationFallback: () => { throw new Error("real decision must never run"); },
    },
    "./runtimeCommunicationService": {
      createRuntimeCommunicationService: () => { throw new Error("real service must never run"); },
      resolveRuntimeWhatsAppProvider: () => { throw new Error("real provider must never run"); },
    },
    "./runtimeSmsProviderService": {
      createRuntimeSmsProvider: () => { throw new Error("real sms provider must never run"); },
    },
    "./runtimeSmsAdapterFactory": {
      runtimeSmsAdapterFactory: () => { throw new Error("real adapter factory must never run"); },
    },
    "./smsProviderRuntimeService": {
      evaluateSmsRuntimeReadiness: () => { throw new Error("real gate must never run"); },
    },
    "./authSecurityEventService": {
      recordAuthSecurityEvent: () => { throw new Error("real security-event write must never run"); },
    },
  };
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return original.apply(this, [request, parent, isMain]);
  };
  return req;
}

function wireBuild(outDir) {
  const req = stubServiceModules(outDir);
  return {
    Sms: req("./lib/communication/providers/smsProvider.js"),
    MockSms: req("./lib/communication/providers/mockSmsProvider.js"),
    ExotelConfig: req("./lib/communication/providers/exotelConfig.js"),
    Exotel: req("./lib/communication/providers/exotelSmsProvider.js"),
    Renderer: req("./lib/communication/authSmsBodyRenderer.js"),
    Identity: req("./lib/communication/authenticationActionIdentity.js"),
    Phone: req("./lib/communication/phone.js"),
    Deadline: req("./lib/auth/hookDeadline.js"),
    Orchestrator: req("./services/clientLoginOtpDeliveryOrchestrator.js"),
  };
}

const readCode = (p) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
const readF = (f) => readFileSync(f, "utf8");

// ============================================================================
// REGISTRY
// ============================================================================
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const MAIN_DIR = resolve(".phase5fc3c1-build-main");
compileTo(MAIN_DIR);
transpileOrchestrator(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// FIXTURES
// ============================================================================
const AUTH_USER_ID = "11111111-2222-3333-4444-555555555555";
const PHONE = "+919812345678";
const OTP = "482913";
const WEBHOOK_ID = "msg_2abc3def4ghi5jkl";
const WHATSAPP_PROVIDER = "meta_whatsapp_cloud";
const SMS_PROVIDER = "exotel_sms";
const TEMPLATE = "client_login_otp";
const PROVIDER_TEMPLATE_NAME = "QF_CLIENT_LOGIN_OTP_DLT";
const PROVIDER_TEMPLATE_ID = "9876543210987654321";
const NETWORK_FAILURE_CODE = "META_ERROR_131026";

const DESTINATION_HASH = () => M.Phone.hashPhoneE164(PHONE);
const ACTION_ID = () => M.Identity.deriveClientLoginActionId(WEBHOOK_ID);

const ok = (data) => ({ ok: true, data });
const failResult = (code) => ({ ok: false, code, error: "x" });

function fakeDeadline(remainingMs = 4000) {
  return { totalBudgetMs: 5000, responseReserveMs: 750, remainingNetworkBudgetMs: () => remainingMs };
}

const message = (over = {}) => ({
  id: "msg-row-1", status: "accepted", failure_code: null, provider: WHATSAPP_PROVIDER, ...over,
});

const intent = () => ({
  type: TEMPLATE, lane: "authentication", channel: "whatsapp", template_key: TEMPLATE,
  variables: { otp: OTP }, idempotency_key: `${TEMPLATE}:${WEBHOOK_ID}`, correlation_id: WEBHOOK_ID,
  entity_type: "auth_user", entity_id: AUTH_USER_ID,
});

const mapping = (over = {}) => ({
  mappingId: "map-1", templateKey: TEMPLATE, providerKey: SMS_PROVIDER, channel: "sms",
  language: "en", providerTemplateName: PROVIDER_TEMPLATE_NAME, providerTemplateId: PROVIDER_TEMPLATE_ID,
  providerCategory: "authentication", ...over,
});
const READY_GATE = (over = {}) => ({ status: "SMS_RUNTIME_READY", providerKey: SMS_PROVIDER, channel: "sms", activation: "active", mapping: mapping(over) });
const BLOCKED_GATE = { status: "SMS_RUNTIME_BLOCKED", reason: "RUNTIME_POLICY_MISSING" };

const ALLOWED_DECISION = { allowed: true, reason: "ALLOWED", channel: "sms", providerKey: SMS_PROVIDER, attemptNumber: 2 };
const blockedDecision = (reason) => ({ allowed: false, reason });

function makeDeps(over = {}) {
  const calls = {
    primaryClaims: [], fallbackClaims: [], finalizes: [], decisions: [], gates: [],
    sends: [], smsSends: [], bareSends: [], renders: [], order: [], consentChecks: [],
  };
  const smsProvider = {
    providerKey: SMS_PROVIDER,
    channel: "sms",
    async sendResolvedAuthenticationSms(to, resolved, options) {
      calls.smsSends.push({ to, resolved, options });
      calls.order.push("send");
      return over.smsResult ?? {
        accepted: true, provider: SMS_PROVIDER, channel: "sms",
        providerMessageId: "exotel-sid-1", normalizedStatus: "accepted",
        errorCode: null, errorMessage: null, retryable: false, outcomeCertainty: "accepted",
      };
    },
    // Present ONLY so a mutation that reverts to the bare send is detectable rather than a crash.
    async sendAuthenticationMessage(to, templateKey, variables, options) {
      calls.bareSends.push({ to, templateKey, variables, options });
      calls.order.push("bareSend");
      return { accepted: true, provider: SMS_PROVIDER, channel: "sms", providerMessageId: "bare-1",
        normalizedStatus: "accepted", errorCode: null, errorMessage: null, retryable: false, outcomeCertainty: "accepted" };
    },
  };
  const deps = {
    calls,
    resolveWhatsAppProviderKey: over.resolveWhatsAppProviderKey ?? (() => ok(WHATSAPP_PROVIDER)),
    createCommunicationService: over.createCommunicationService ?? (() => ok({
      send: async (i, o) => { calls.sends.push({ intent: i, options: o }); return over.sendResult ?? ok(message()); },
    })),
    claimPrimaryAttempt: over.claimPrimaryAttempt ?? (async (i) => {
      calls.primaryClaims.push(i);
      return ok({ outcome: "CLAIMED", detail: null, attemptId: "attempt-1", attemptNumber: 1, channel: "whatsapp", fallbackFromAttemptId: null });
    }),
    claimFallbackAttempt: over.claimFallbackAttempt ?? (async (i) => {
      calls.fallbackClaims.push(i);
      calls.order.push("claim");
      return ok({ outcome: "CLAIMED", detail: null, attemptId: "attempt-2", attemptNumber: 2, channel: "sms", fallbackFromAttemptId: "attempt-1" });
    }),
    finalizeAttempt: over.finalizeAttempt ?? (async (i) => {
      calls.finalizes.push(i);
      return ok({ outcome: "FINALIZED", detail: null, attemptId: i.attemptId, status: i.status, outcomeCertainty: i.outcomeCertainty });
    }),
    decideAuthenticationFallback: over.decideAuthenticationFallback ?? (async (i) => {
      calls.decisions.push(i);
      return ok(over.decision ?? blockedDecision("POLICY_DISABLED"));
    }),
    evaluateSmsRuntimeReadiness: over.evaluateSmsRuntimeReadiness ?? (async (q) => {
      calls.gates.push(q);
      return over.gate ?? BLOCKED_GATE;
    }),
    createRuntimeSmsProvider: over.createRuntimeSmsProvider ?? (() => ok(over.smsProvider ?? smsProvider)),
    resolveAuthenticationSmsContent: over.resolveAuthenticationSmsContent ?? ((input) => {
      calls.renders.push(input);
      calls.order.push("render");
      return over.renderResult ?? M.Renderer.resolveAuthenticationSmsContent(input);
    }),
    // Phase 5F-D3-B: the SMS fallback now requires its OWN `channel: "sms"` consent authorization, and
    // ABSENCE OF THE DEPENDENCY IS NEVER AUTHORIZATION (the orchestrator would lazily load the real
    // coordinator, which this isolated build does not contain). These SMS-fallback tests therefore inject
    // a DETERMINISTIC TEST ENFORCER. The `allow` lives ONLY here, in the harness dependency object —
    // never in production code. Its call is recorded so the ordering (consent → claim → provider) is proven.
    authorizeOutboundConsent: over.authorizeOutboundConsent ?? (async (enforcementInput) => {
      calls.consentChecks.push(enforcementInput);
      calls.order.push("consent");
      return over.consentOutcome ?? { kind: "allow", scope: "authentication" };
    }),
    logLedgerUnavailable: over.logLedgerUnavailable ?? (() => {}),
    recordLedgerUnavailableEvent: over.recordLedgerUnavailableEvent ?? (async () => ok(null)),
  };
  return deps;
}

function baseInput(over = {}) {
  return {
    authUserId: AUTH_USER_ID, phoneE164: PHONE, otp: OTP, verifiedWebhookId: WEBHOOK_ID,
    deadline: over.deadline ?? fakeDeadline(),
    buildPrimaryIntent: () => intent(),
    ...over,
  };
}

const run = (over = {}, inputOver = {}) => {
  const deps = makeDeps(over);
  return M.Orchestrator.deliverClientLoginOtp(baseInput(inputOver), deps).then((r) => ({ r, deps }));
};
const definitiveFailureOver = (over = {}) => ({ sendResult: ok(message({ status: "failed", failure_code: NETWORK_FAILURE_CODE })), ...over });

async function captureConsole(fn) {
  const methods = ["log", "error", "warn", "info", "debug", "trace"];
  const original = {};
  let buffer = "";
  for (const m of methods) { original[m] = console[m]; console[m] = (...a) => { buffer += a.map((x) => (typeof x === "string" ? x : safeStringify(x))).join(" ") + "\n"; }; }
  try { const value = await fn(); return { value, buffer }; }
  finally { for (const m of methods) console[m] = original[m]; }
}
function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }

// A fake Exotel HTTP transport (records requests; performs no I/O).
function fakeTransport(result) {
  const calls = [];
  return { calls, async request(req) { calls.push(req); return result ?? { kind: "response", status: 200, bodyText: JSON.stringify({ SMSMessage: { Sid: "sid-1" } }), truncated: false }; } };
}
const EXOTEL_ENV = Object.freeze({
  SMS_PROVIDER_MODE: "exotel_sms", EXOTEL_ACCOUNT_SID: "qftestaccountsid0000",
  EXOTEL_API_KEY: "qftestapikeyAAAAAAAAAAAA", EXOTEL_API_TOKEN: "qftestapitokenBBBBBBBBBB", EXOTEL_SENDER_ID: "QFTEST",
});
function exotelProvider(env = EXOTEL_ENV, transport = fakeTransport()) {
  const cfg = M.ExotelConfig.resolveExotelConfig(env);
  if (!cfg.ok) throw new Error("fixture exotel config must resolve");
  return new M.Exotel.ExotelSmsProvider(cfg.config, transport);
}

// ============================================================================
// PART A — PURE RENDERER
// ============================================================================
const renderInput = (over = {}) => ({
  reviewedTemplateKey: TEMPLATE, language: "en", otp: OTP,
  runtimeMapping: {
    templateKey: TEMPLATE, language: "en", providerTemplateName: PROVIDER_TEMPLATE_NAME,
    providerTemplateId: PROVIDER_TEMPLATE_ID, providerCategory: "authentication",
  },
  ...over,
});

check("A1. renderer: deterministic, exact content shape, OTP substituted, identity carried through", () => {
  const R = M.Renderer;
  const a = R.resolveAuthenticationSmsContent(renderInput());
  const b = R.resolveAuthenticationSmsContent(renderInput());
  assert(a.ok && b.ok, "renders");
  assert(a.resolved.messageBody === b.resolved.messageBody, "deterministic body");
  assert(a.resolved.messageBody.includes(OTP), "the OTP is substituted into the body");
  assert(/verification code/i.test(a.resolved.messageBody), "the reviewed content shape is present");
  assert(a.resolved.providerTemplateName === PROVIDER_TEMPLATE_NAME, "provider template name carried through");
  assert(a.resolved.providerTemplateId === PROVIDER_TEMPLATE_ID, "provider template id carried through");
  // A different OTP yields a different body but the same shape.
  const c = R.resolveAuthenticationSmsContent(renderInput({ otp: "135790" }));
  assert(c.ok && c.resolved.messageBody.includes("135790") && !c.resolved.messageBody.includes(OTP), "distinct OTP → distinct body");
});

check("A2. renderer: an unreviewed (key, language) fails closed", () => {
  const R = M.Renderer;
  for (const over of [{ reviewedTemplateKey: "vendor_whatsapp_verify" }, { reviewedTemplateKey: "unknown" }, { language: "hi" }]) {
    const r = R.resolveAuthenticationSmsContent(renderInput(over));
    assert(r.ok === false && r.code === "AUTH_SMS_TEMPLATE_NOT_REVIEWED", `${JSON.stringify(over)} → ${r.code}`);
  }
  assert(R.hasReviewedAuthenticationSmsTemplate(TEMPLATE, "en") === true, "the one reviewed template exists");
  assert(R.hasReviewedAuthenticationSmsTemplate("vendor_whatsapp_verify", "en") === false, "vendor flows are not reviewed here");
});

check("A3. renderer: reviewed identity must equal the runtime mapping identity", () => {
  const R = M.Renderer;
  const mismatchKey = R.resolveAuthenticationSmsContent(renderInput({ runtimeMapping: { templateKey: "other", language: "en", providerTemplateName: PROVIDER_TEMPLATE_NAME, providerTemplateId: PROVIDER_TEMPLATE_ID, providerCategory: "authentication" } }));
  assert(mismatchKey.ok === false && mismatchKey.code === "AUTH_SMS_TEMPLATE_IDENTITY_MISMATCH", `key mismatch → ${mismatchKey.code}`);
  const mismatchLang = R.resolveAuthenticationSmsContent(renderInput({ runtimeMapping: { templateKey: TEMPLATE, language: "hi", providerTemplateName: PROVIDER_TEMPLATE_NAME, providerTemplateId: PROVIDER_TEMPLATE_ID, providerCategory: "authentication" } }));
  assert(mismatchLang.ok === false && mismatchLang.code === "AUTH_SMS_TEMPLATE_IDENTITY_MISMATCH", `lang mismatch → ${mismatchLang.code}`);
});

check("A4. renderer: a non-authentication mapping fails closed", () => {
  const R = M.Renderer;
  for (const category of ["utility", "marketing", "service", "", null]) {
    const r = R.resolveAuthenticationSmsContent(renderInput({ runtimeMapping: { templateKey: TEMPLATE, language: "en", providerTemplateName: PROVIDER_TEMPLATE_NAME, providerTemplateId: PROVIDER_TEMPLATE_ID, providerCategory: category } }));
    assert(r.ok === false && r.code === "AUTH_SMS_CATEGORY_NOT_AUTHENTICATION", `category=${category} → ${r.code}`);
  }
});

check("A5. renderer: a missing provider template name fails closed", () => {
  const R = M.Renderer;
  for (const name of ["", "   ", null, undefined]) {
    const r = R.resolveAuthenticationSmsContent(renderInput({ runtimeMapping: { templateKey: TEMPLATE, language: "en", providerTemplateName: name, providerTemplateId: PROVIDER_TEMPLATE_ID, providerCategory: "authentication" } }));
    assert(r.ok === false && r.code === "AUTH_SMS_PROVIDER_TEMPLATE_NAME_MISSING", `name=${name} → ${r.code}`);
  }
});

check("A5b. renderer: a missing/empty provider template id fails closed — ONE authority, no substitution", () => {
  const R = M.Renderer;
  const rm = (providerTemplateId) => ({ templateKey: TEMPLATE, language: "en", providerTemplateName: PROVIDER_TEMPLATE_NAME, providerTemplateId, providerCategory: "authentication" });
  for (const id of ["", "   ", null, undefined]) {
    const r = R.resolveAuthenticationSmsContent(renderInput({ runtimeMapping: rm(id) }));
    assert(r.ok === false && r.code === "AUTH_SMS_PROVIDER_TEMPLATE_ID_MISSING", `id=${JSON.stringify(id)} → ${r && r.code}`);
  }
  // A present id is carried through EXACTLY (trimmed) — never invented, replaced, or read from env.
  const okr = R.resolveAuthenticationSmsContent(renderInput({ runtimeMapping: rm(`  ${PROVIDER_TEMPLATE_ID}  `) }));
  assert(okr.ok === true && okr.resolved.providerTemplateId === PROVIDER_TEMPLATE_ID, "the exact mapping id is carried through");
  // The renderer never reads config (it has no env access — see A7): there is no other authority.
});

check("A6. renderer: a malformed OTP fails closed, and the OTP never appears in the failure", async () => {
  const R = M.Renderer;
  for (const bad of ["", "abc", "12", "12345678901", "48 913", null, undefined, 482913]) {
    const { value: r, buffer } = await captureConsole(() => R.resolveAuthenticationSmsContent(renderInput({ otp: bad })));
    assert(r.ok === false && r.code === "AUTH_SMS_OTP_INVALID", `otp=${bad} → ${r && r.code}`);
    assert(!safeStringify(r).includes(String(bad)) || String(bad).length < 3, "the failure carries no usable OTP value");
    assert(buffer === "", "the renderer logs nothing, even on a bad OTP");
  }
  // A well-formed OTP of each accepted length renders.
  for (const good of ["1234", "482913", "1234567890"]) {
    assert(R.resolveAuthenticationSmsContent(renderInput({ otp: good })).ok === true, `otp=${good} renders`);
  }
});

check("A7. renderer purity: no db/env/network/clock/randomness/provider import/exotel literal/console", () => {
  const src = readF(RENDERER_SRC);
  const code = readCode(RENDERER_SRC);
  assert(!/adminClient|from\(["']|\.rpc\(|createClient/.test(code), "no database access");
  assert(!/process\.env|process\[/.test(code), "no environment access");
  assert(!/fetch\(|http|https|XMLHttpRequest|require\(["']node:/.test(code), "no network");
  assert(!/Date\.|Date\(|performance\.now|hrtime/.test(code), "no clock");
  assert(!/Math\.random|randomBytes|randomUUID|randomInt/.test(code), "no randomness");
  assert(!/exotel|meta_whatsapp|msg91|twilio/i.test(code), "no provider literal");
  assert(!/from ["'][^"']*providers\/(exotel|meta|mock)/i.test(src), "no provider adapter import");
  assert(!/console\./.test(code), "no console call");
  // The only import is the RESOLVED type (type-only), never a value from a provider adapter.
  assert(/import type \{ ResolvedAuthenticationSms \}/.test(src), "imports only the neutral type");
});

check("A8. renderer secrecy: a hostile input renders nothing and logs nothing", async () => {
  const R = M.Renderer;
  const { value, buffer } = await captureConsole(() =>
    R.resolveAuthenticationSmsContent(renderInput({ otp: `otp ${OTP} phone ${PHONE}` })));
  assert(value.ok === false, "a non-OTP fails closed");
  assert(buffer === "", "no log");
  assert(!safeStringify(value).includes(PHONE), "no phone in the failure");
});

// ============================================================================
// PART B — CONTRACT
// ============================================================================
check("B1. the SmsProvider contract declares sendResolvedAuthenticationSms + ResolvedAuthenticationSms", () => {
  const src = readF(SMS_IFACE_SRC);
  assert(/sendResolvedAuthenticationSms\(\s*\n?\s*to: string,\s*\n?\s*resolved: ResolvedAuthenticationSms/.test(src.replace(/\s+/g, " ")) ||
    /sendResolvedAuthenticationSms\(/.test(src), "the interface declares the resolved send");
  assert(/export interface ResolvedAuthenticationSms/.test(src), "the neutral resolved type is exported");
  assert(/messageBody/.test(src) && /providerTemplateName/.test(src) && /providerTemplateId/.test(src), "with the neutral fields");
});

check("B2. MockSmsProvider implements the resolved send: no-wire, deterministic, retains no body/OTP", async () => {
  const mock = new M.MockSms.MockSmsProvider();
  assert(typeof mock.sendResolvedAuthenticationSms === "function", "mock exposes the method");
  const resolved = { messageBody: `${OTP} is your QuickFurno verification code.`, providerTemplateName: PROVIDER_TEMPLATE_NAME, providerTemplateId: PROVIDER_TEMPLATE_ID };
  const a = await mock.sendResolvedAuthenticationSms("+15550002222", resolved);
  const b = await mock.sendResolvedAuthenticationSms("+15550002222", resolved);
  assert(a.accepted === true && a.outcomeCertainty === "accepted", "accepted path");
  assert(a.channel === "sms" && a.provider === "mock_sms", "mock identity");
  assert(a.providerMessageId !== b.providerMessageId, "monotonic, deterministic ids");
  // Destination steering still works on the resolved path.
  const perm = await mock.sendResolvedAuthenticationSms(M.MockSms.MOCK_SMS_DESTINATIONS.PERMANENT_FAILURE, resolved);
  assert(perm.outcomeCertainty === "definitive_failure" && perm.retryable === false, "permanent failure steering");
  const unk = await mock.sendResolvedAuthenticationSms(M.MockSms.MOCK_SMS_DESTINATIONS.UNKNOWN_OUTCOME, resolved);
  assert(unk.outcomeCertainty === "unknown_outcome", "unknown steering");
  // SECRECY: the retained record holds the NON-secret provider template name only, never the body/OTP.
  const rendered = safeStringify(mock.getLastSentRecords());
  assert(!rendered.includes(OTP), "no OTP in the mock's retained records");
  assert(!rendered.includes(resolved.messageBody), "no message body retained");
  assert(rendered.includes(PROVIDER_TEMPLATE_NAME), "only the provider template name is retained");
});

check("B3. ExotelSmsProvider implements the resolved send: form built from neutral facts, no secret/body leak", async () => {
  const t = fakeTransport();
  const provider = exotelProvider(EXOTEL_ENV, t);
  assert(typeof provider.sendResolvedAuthenticationSms === "function", "exotel exposes the method");
  const resolved = { messageBody: `${OTP} is your QuickFurno verification code.`, providerTemplateName: PROVIDER_TEMPLATE_NAME, providerTemplateId: PROVIDER_TEMPLATE_ID };
  const out = await provider.sendResolvedAuthenticationSms(PHONE, resolved);
  assert(out.accepted === true, "accepted");
  const form = new URLSearchParams(t.calls[0].body);
  assert(form.get("To") === PHONE && form.get("From") === "QFTEST", "From/To");
  assert(form.get("Body") === resolved.messageBody, "the reviewed body is the request Body");
  // Template id comes from the resolved (mapping) fact; entity id is account-config-owned (absent here).
  assert(form.get("DltTemplateId") === PROVIDER_TEMPLATE_ID, "DLT template id from the resolved descriptor");
  assert(!form.has("DltEntityId"), "no DLT entity id without account config");
  // The bare interface method can never put a message on the wire.
  const t2 = fakeTransport();
  const bare = await exotelProvider(EXOTEL_ENV, t2).sendAuthenticationMessage(PHONE, TEMPLATE, { otp: OTP });
  assert(bare.accepted === false && bare.errorCode === "EXOTEL_RESOLVED_TEMPLATE_REQUIRED", "bare send refuses");
  assert(t2.calls.length === 0, "the bare send makes no request");
  // No credential in the request; the result never echoes the body/OTP.
  assert(!safeStringify(out).includes(OTP) && !safeStringify(out).includes(resolved.messageBody), "result carries no OTP/body");
  assert(!t.calls[0].body.includes(EXOTEL_ENV.EXOTEL_API_TOKEN), "no credential in the body");
});

check("B4. DLT ownership: entity from config, template ONLY from the descriptor; a MISSING id fails closed with ZERO calls", async () => {
  const envWithDlt = { ...EXOTEL_ENV, EXOTEL_DLT_ENTITY_ID: "111", EXOTEL_DLT_TEMPLATE_ID: "222" };
  // Valid path: entity id from config; template id from the descriptor; config NEVER overrides;
  // body from resolved.messageBody; exactly one network call.
  const t = fakeTransport();
  const okr = await exotelProvider(envWithDlt, t).sendResolvedAuthenticationSms(PHONE,
    { messageBody: "reviewed-body", providerTemplateName: "T", providerTemplateId: PROVIDER_TEMPLATE_ID });
  const form = new URLSearchParams(t.calls[0].body);
  assert(okr.accepted === true, "a valid request is accepted");
  assert(form.get("DltEntityId") === "111", "entity id from account config");
  assert(form.get("DltTemplateId") === PROVIDER_TEMPLATE_ID, "template id from the descriptor");
  assert(form.get("DltTemplateId") !== "222", "the config template id can NEVER override the descriptor");
  assert(form.get("Body") === "reviewed-body", "body from resolved.messageBody");
  assert(t.calls.length === 1, "exactly one network call for a valid request");

  // A missing/empty/whitespace descriptor id → DEFINITIVE local preflight failure, ZERO calls.
  // The account config template id can NEVER rescue it: the request simply never happens.
  for (const badId of [null, undefined, "", "   "]) {
    const tt = fakeTransport();
    const r = await exotelProvider(envWithDlt, tt).sendResolvedAuthenticationSms(PHONE,
      { messageBody: "reviewed-body", providerTemplateName: "T", providerTemplateId: badId });
    assert(r.accepted === false, `id=${JSON.stringify(badId)}: not accepted`);
    assert(r.errorCode === "EXOTEL_DLT_TEMPLATE_ID_MISSING", `id=${JSON.stringify(badId)}: ${r.errorCode}`);
    assert(r.outcomeCertainty === "definitive_failure" && r.retryable === false && r.providerMessageId === null,
      `id=${JSON.stringify(badId)}: definitive, not retryable, no message id`);
    assert(tt.calls.length === 0, `id=${JSON.stringify(badId)}: ZERO network calls (config cannot rescue)`);
  }
  // The earlier preflight fences still refuse first (destination/name/body), also with zero calls.
  for (const [dest, resolved, code] of [
    ["9812345678", { messageBody: "B", providerTemplateName: "T", providerTemplateId: "1" }, "EXOTEL_DESTINATION_INVALID"],
    [PHONE, { messageBody: "B", providerTemplateName: "", providerTemplateId: "1" }, "EXOTEL_TEMPLATE_NAME_MISSING"],
    [PHONE, { messageBody: "  ", providerTemplateName: "T", providerTemplateId: "1" }, "EXOTEL_TEMPLATE_BODY_MISSING"],
  ]) {
    const t3 = fakeTransport();
    const r = await exotelProvider(EXOTEL_ENV, t3).sendResolvedAuthenticationSms(dest, resolved);
    assert(r.errorCode === code && r.outcomeCertainty === "definitive_failure" && t3.calls.length === 0, `${code} refused with no request`);
  }
});

check("B5. widening the contract does not weaken the production mock prohibition or provider neutrality", () => {
  // The mock stays test/dev only: the runtime factory never constructs it (Phase 5F-C3-A/B fence).
  assert(!/MockSmsProvider/.test(readCode(SMS_FACTORY_SRC)), "the factory never constructs the mock");
  // The orchestrator remains provider-neutral: no Exotel class/endpoint/credential/response knowledge.
  const orch = readCode(ORCHESTRATOR_SRC);
  assert(!/exotel/i.test(orch), "no exotel literal in the orchestrator");
  assert(!/ExotelSmsProvider|exotelConfig|buildExotelSendSmsUrl|Basic |RestException|SMSMessage/.test(orch), "no exotel-specific type/endpoint/schema");
  assert(!/msg91|twilio|gupshup|plivo|vonage/i.test(orch), "no other provider literal");
  assert(/sendResolvedAuthenticationSms\(/.test(orch), "the orchestrator uses the neutral resolved send");
  assert(!/\.sendAuthenticationMessage\(/.test(orch), "the orchestrator never uses the bare send");
});

// ============================================================================
// ORCHESTRATOR
// ============================================================================
check("O1. accepted primary → no render, no SMS", async () => {
  for (const status of ["accepted", "sent", "delivered", "read"]) {
    const { r, deps } = await run({ sendResult: ok(message({ status })) });
    assert(r.kind === "delivered", `${status} → ${r.kind}`);
    assert(deps.calls.renders.length === 0, `${status}: nothing rendered`);
    assert(deps.calls.smsSends.length === 0 && deps.calls.bareSends.length === 0, `${status}: no SMS`);
  }
});

check("O2. unknown_outcome primary → no render, no SMS", async () => {
  for (const status of ["outcome_unknown", "queued", "dispatching"]) {
    const { r, deps } = await run({ sendResult: ok(message({ status })) });
    assert(deps.calls.renders.length === 0, `${status}: nothing rendered`);
    assert(deps.calls.smsSends.length === 0, `${status}: no SMS`);
  }
});

check("O3. blocked C1 decision → no render, no SMS", async () => {
  const { r, deps } = await run(definitiveFailureOver({ decision: blockedDecision("POLICY_DISABLED"), gate: READY_GATE() }));
  assert(r.kind === "delivery_failed" && r.fallbackBlockedReason === "POLICY_DISABLED", `got ${r.fallbackBlockedReason}`);
  assert(deps.calls.gates.length === 0 && deps.calls.renders.length === 0 && deps.calls.smsSends.length === 0, "nothing beyond the decision");
});

check("O4. SMS runtime blocked → no render, no SMS", async () => {
  const { r, deps } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: BLOCKED_GATE }));
  assert(r.fallbackBlockedReason === "SMS_RUNTIME_BLOCKED", `got ${r.fallbackBlockedReason}`);
  assert(deps.calls.renders.length === 0 && deps.calls.fallbackClaims.length === 0 && deps.calls.smsSends.length === 0, "no render, claim, or send");
});

check("O5. provider identity mismatch → blocked before render, claim, or send", async () => {
  const impostor = { providerKey: "msg91_sms", channel: "sms", sendResolvedAuthenticationSms: async () => { throw new Error("must not send"); } };
  const { r, deps } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE(), smsProvider: impostor }));
  assert(r.fallbackBlockedReason === "SMS_PROVIDER_IDENTITY_MISMATCH", `got ${r.fallbackBlockedReason}`);
  assert(deps.calls.renders.length === 0 && deps.calls.fallbackClaims.length === 0 && deps.calls.smsSends.length === 0, "blocked before render/claim/send");
});

check("O6. a local RENDER failure blocks BEFORE any claim and sends nothing", async () => {
  // A ready gate whose mapping identity disagrees with the reviewed key: the REAL renderer refuses.
  const { r, deps } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE({ templateKey: "some_other_template" }) }));
  assert(r.kind === "delivery_failed" && r.fallbackBlockedReason === "RESOLVED_BODY_UNAVAILABLE", `got ${r.fallbackBlockedReason}`);
  assert(deps.calls.renders.length === 1, "render was attempted");
  assert(deps.calls.fallbackClaims.length === 0, "NO attempt-2 claim was made (render precedes and gates the claim)");
  assert(deps.calls.smsSends.length === 0 && deps.calls.bareSends.length === 0, "NO SMS was sent");
  // An injected render failure (any code) blocks identically.
  const inj = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE(), renderResult: { ok: false, code: "AUTH_SMS_OTP_INVALID" } }));
  assert(inj.r.fallbackBlockedReason === "RESOLVED_BODY_UNAVAILABLE" && inj.deps.calls.fallbackClaims.length === 0 && inj.deps.calls.smsSends.length === 0, "injected render failure blocks with no claim/send");
});

check("O6b. a runtime mapping with NO usable provider template id → blocked BEFORE claim/send", async () => {
  // A gate that is READY but whose mapping lacks a template id: the REAL renderer fails closed,
  // so the missing template identity blocks the fallback before the atomic claim and the send.
  for (const badId of [null, "", "   "]) {
    const { r, deps } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE({ providerTemplateId: badId }) }));
    assert(r.kind === "delivery_failed" && r.fallbackBlockedReason === "RESOLVED_BODY_UNAVAILABLE", `id=${JSON.stringify(badId)} → ${r.fallbackBlockedReason}`);
    assert(deps.calls.renders.length === 1, "render was attempted");
    assert(deps.calls.fallbackClaims.length === 0, "NO attempt-2 claim");
    assert(deps.calls.smsSends.length === 0 && deps.calls.bareSends.length === 0, "NO SMS send");
  }
});

check("O7. allowed path → render, then exactly one resolved SMS with the SAME OTP in the body", async () => {
  const { r, deps } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }));
  assert(r.kind === "delivered" && r.smsSent === true && r.fallbackClaimed === true, "the fallback happened");
  assert(deps.calls.smsSends.length === 1 && deps.calls.bareSends.length === 0, "exactly one RESOLVED send, no bare send");
  assert(deps.calls.fallbackClaims.length === 1, "claimed exactly once");
  const sent = deps.calls.smsSends[0];
  assert(sent.to === PHONE, "sent to the same destination");
  assert(sent.resolved.messageBody.includes(OTP), "attempt 2 carried the SAME OTP inside the reviewed body");
  assert(sent.resolved.providerTemplateName === PROVIDER_TEMPLATE_NAME, "the resolved descriptor carries the approved provider template name");
  assert(sent.resolved.providerTemplateId === PROVIDER_TEMPLATE_ID, "…and the EXACT runtime-mapping template id (the one DLT authority)");
  assert(sent.options.maxNetworkTimeoutMs === 4000, "the remaining budget is passed as a ceiling");
  // Attempt 1 carried the same OTP as a WhatsApp variable.
  assert(deps.calls.sends[0].intent.variables.otp === OTP, "attempt 1 used the same OTP");
});

check("O8. render precedes the claim, which precedes the send", async () => {
  const { deps } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }));
  const order = deps.calls.order.filter((s) => s === "render" || s === "claim" || s === "send");
  assert(order.join(",") === "render,claim,send", `order was ${order.join(",")}`);
});

// Phase 5F-D3-B: the SMS fallback carries its OWN consent authorization, and it must run BEFORE the
// attempt-2 claim and BEFORE the provider. The enforcer here is an INJECTED TEST DOUBLE — the orchestrator
// itself has NO implicit allow: absent the injection it would load the real coordinator.
check("O8b. the SMS consent authorization runs BEFORE the claim and BEFORE the provider", async () => {
  const { deps } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }));
  assert(deps.calls.consentChecks.length === 1, `consent authorized exactly once, got ${deps.calls.consentChecks.length}`);
  const c = deps.calls.consentChecks[0];
  assert(c.channel === "sms", "the SMS channel gets its OWN decision — a WhatsApp decision never authorizes SMS");
  assert(c.destinationSource === "ephemeral_auth_destination", "an ephemeral (caller-supplied) destination");
  assert(c.recipientId === null, "no principal is claimed for an ephemeral destination");
  assert(typeof c.destinationHash === "string" && /^[0-9a-f]{64}$/.test(c.destinationHash), "a sha256 hash, never a plaintext phone");
  const order = deps.calls.order.filter((s) => s === "consent" || s === "claim" || s === "send");
  assert(order.join(",") === "consent,claim,send", `order was ${order.join(",")}`);
});

check("O8c. a DENIED SMS consent blocks before any claim and any provider call", async () => {
  const { r, deps } = await run(definitiveFailureOver({
    decision: ALLOWED_DECISION,
    gate: READY_GATE(),
    consentOutcome: { kind: "deny", code: "CONSENT_SUPPRESSED", retryable: false },
  }));
  assert(deps.calls.consentChecks.length === 1, "consent was consulted");
  assert(deps.calls.fallbackClaims.length === 0, "ZERO fallback claims");
  assert(deps.calls.smsSends.length === 0, "ZERO SMS provider calls");
  assert(r.smsSent !== true, "no SMS was sent");
});

check("O9. a rejected attempt-2 claim renders but never sends", async () => {
  const { r, deps } = await run(definitiveFailureOver({
    decision: ALLOWED_DECISION, gate: READY_GATE(),
    claimFallbackAttempt: async () => ok({ outcome: "ATTEMPT_LIMIT_REACHED", attemptId: null, detail: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null }),
  }));
  assert(r.fallbackBlockedReason === "FALLBACK_CLAIM_REJECTED", `got ${r.fallbackBlockedReason}`);
  assert(deps.calls.renders.length === 1, "render happened");
  assert(deps.calls.smsSends.length === 0, "but nothing was sent");
});

check("O10. budget exhausted → render happened, but NO claim and NO send", async () => {
  const { r, deps } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }), { deadline: fakeDeadline(0) });
  assert(r.fallbackBlockedReason === M.Deadline.AUTH_NETWORK_DEADLINE_EXHAUSTED, `got ${r.fallbackBlockedReason}`);
  assert(deps.calls.renders.length === 1 && deps.calls.fallbackClaims.length === 0 && deps.calls.smsSends.length === 0, "render only; no claim/send");
});

check("O11. the SAME OTP is used; the orchestrator generates none and reads input.otp once", async () => {
  const { deps } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }));
  assert(deps.calls.smsSends[0].resolved.messageBody.includes(OTP), "same OTP in the body");
  const src = readCode(ORCHESTRATOR_SRC);
  assert(!/Math\.random|randomInt|randomBytes|randomUUID|generateOtp|createOtp/i.test(src), "no OTP generator");
  assert((src.match(/input\.otp/g) ?? []).length === 1, "input.otp is read exactly once (into the renderer)");
});

check("O12. provider result certainty maps unchanged; no third attempt, retry, queue, or race", async () => {
  for (const [certainty, kind] of [["accepted", "delivered"], ["definitive_failure", "delivery_failed"], ["unknown_outcome", "delivery_uncertain"]]) {
    const smsResult = { accepted: certainty === "accepted", provider: SMS_PROVIDER, channel: "sms", providerMessageId: certainty === "accepted" ? "sid" : null, normalizedStatus: certainty === "accepted" ? "accepted" : "failed", errorCode: null, errorMessage: null, retryable: false, outcomeCertainty: certainty };
    const { r } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE(), smsResult }));
    assert(r.kind === kind, `${certainty} → ${r.kind}`);
  }
  const src = readCode(ORCHESTRATOR_SRC);
  assert(!/\bn8n\b|\bqueue\b|setTimeout|setInterval|\bfor\s*\(|\bwhile\s*\(/i.test(src), "no queue/scheduler/retry loop");
  assert(!/Promise\.race/.test(src), "no pseudo-timeout");
  assert((src.match(/sendResolvedAuthenticationSms\(/g) ?? []).length === 1, "exactly one send call site — no resend");
});

// ============================================================================
// SECRECY + PHASE SAFETY
// ============================================================================
check("S1. no OTP, phone, or body reaches a result, a log, or a ledger write", async () => {
  const { value, buffer } = await captureConsole(async () => {
    const out = [];
    for (const over of [
      { sendResult: ok(message()) },
      definitiveFailureOver({ decision: blockedDecision("POLICY_DISABLED") }),
      definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }),
    ]) out.push(await run(over));
    return out;
  });
  assert(buffer === "", "the orchestrator logs nothing");
  for (const { r, deps } of value) {
    const rendered = safeStringify(r);
    assert(!rendered.includes(OTP) && !rendered.includes(PHONE), "the result carries neither OTP nor phone");
    for (const w of [...deps.calls.primaryClaims, ...deps.calls.fallbackClaims, ...deps.calls.finalizes]) {
      const s = safeStringify(w);
      assert(!s.includes(OTP), "no OTP in a ledger write");
      assert(!s.includes(PHONE), "no plaintext phone in a ledger write");
    }
    // The rendered body (which contains the OTP) never reaches a ledger write.
    for (const w of [...deps.calls.fallbackClaims, ...deps.calls.finalizes]) {
      assert(!safeStringify(w).includes("verification code"), "no message body in a ledger write");
    }
  }
});

check("S2. the ledger sees only a hash and a derived action id — never the raw phone or webhook id", async () => {
  const { deps } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }));
  for (const claim of [...deps.calls.primaryClaims, ...deps.calls.fallbackClaims]) {
    assert(claim.destinationHash === DESTINATION_HASH() && /^[0-9a-f]{64}$/.test(claim.destinationHash), "destination is a sha256 hash");
    assert(claim.authActionId === ACTION_ID() && !safeStringify(claim).includes(WEBHOOK_ID), "action id derived, raw webhook id absent");
  }
});

check("P1. no migration, no SQL, no env change; renderer and orchestrator touch no DB and issue no SQL", () => {
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
  for (const path of dirty) {
    assert(!path.startsWith("supabase/migrations"), `no migration created/modified (${path})`);
    assert(!path.endsWith(".sql"), `no SQL file created/modified (${path})`);
    assert(!/(^|\/)\.env/.test(path), `no env file created/modified (${path})`);
  }
  const orch = readCode(ORCHESTRATOR_SRC);
  assert(!/adminClient|\.rpc\(|insert into|update\s+public\./i.test(orch), "the orchestrator issues no SQL");
  assert(!/is_operationally_enabled|activation_status\s*=|failure_rule|canary/i.test(orch), "the orchestrator activates nothing");
});

check("P2. wiring: test:phase5f:c3c1 exists, earlier scripts unchanged, docs present", () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:c3c1"] === "node scripts/phase5f-c3c1-client-otp-resolved-sms-harness.mjs", "c3c1 wired");
  for (const [name, script] of [
    ["test:phase5f:c3b", "node scripts/phase5f-c3b-client-otp-fallback-harness.mjs"],
    ["test:phase5f:c3a", "node scripts/phase5f-c3a-exotel-adapter-harness.mjs"],
    ["test:phase5f:c2", "node scripts/phase5f-c2-sms-runtime-foundation-harness.mjs"],
  ]) assert(pkg.scripts[name] === script, `${name} unchanged`);
  for (const f of [RENDERER_SRC, SMS_IFACE_SRC, MOCK_SMS_SRC, EXOTEL_ADAPTER_SRC, ORCHESTRATOR_SRC, DOC_C3C1]) assert(existsSync(f), `${f} exists`);
  const doc = readF(DOC_C3C1);
  for (const topic of [/reviewed code/i, /not operator-editable/i, /pure/i, /template identity/i, /sendResolvedAuthenticationSms/, /provider-neutral/i, /render.{0,20}claim/i, /same OTP/i, /no activation/i, /placeholder/i]) {
    assert(topic.test(doc), `doc covers ${topic}`);
  }
  for (const forbidden of [/DLT.{0,20}approv(ed|al) (exists|is (in )?place|complete)/i, /SMS fallback is (now )?active/i, /production SMS is live/i, /canary has run/i]) {
    assert(!forbidden.test(doc), `doc must not claim ${forbidden}`);
  }
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutationChecks = [];
function tsMutation(name, edits, scenario) {
  mutationChecks.push({ name, edits: edits.map(([file, from, to]) => ({ file, from, to })), scenario });
}

tsMutation("MUT A: the orchestrator ignores a failed render and sends anyway",
  [[ORCHESTRATOR_SRC,
    "  if (!rendered.ok) return blocked(OrchestratorFallbackBlockReason.RESOLVED_BODY_UNAVAILABLE);",
    "  if (false) return blocked(OrchestratorFallbackBlockReason.RESOLVED_BODY_UNAVAILABLE);"]],
  async (mm) => {
    const deps = makeDeps(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE(), renderResult: { ok: false, code: "AUTH_SMS_OTP_INVALID" } }));
    await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    return deps.calls.smsSends.length > 0 || deps.calls.fallbackClaims.length > 0;
  });

tsMutation("MUT B: the orchestrator reverts to the bare (never-sends) SmsProvider method",
  [[ORCHESTRATOR_SRC, "smsProvider.sendResolvedAuthenticationSms(", "smsProvider.sendAuthenticationMessage("]],
  async (mm) => {
    const deps = makeDeps(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }));
    await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    return deps.calls.bareSends.length > 0 && deps.calls.smsSends.length === 0;
  });

tsMutation("MUT C: the renderer skips OTP-shape validation",
  [[RENDERER_SRC,
    "  if (typeof input.otp !== \"string\" || !AUTH_SMS_OTP_PATTERN.test(input.otp)) {",
    "  if (false) {"]],
  (mm) => {
    const r = mm.Renderer.resolveAuthenticationSmsContent(renderInput({ otp: "not-an-otp" }));
    return r.ok === true; // a non-OTP was rendered into an authentication body
  });

tsMutation("MUT D: the renderer skips the template-identity cross-check",
  [[RENDERER_SRC,
    "  if (m.templateKey !== input.reviewedTemplateKey || m.language !== input.language) {",
    "  if (false) {"]],
  (mm) => {
    const r = mm.Renderer.resolveAuthenticationSmsContent(renderInput({ runtimeMapping: { templateKey: "wrong", language: "en", providerTemplateName: PROVIDER_TEMPLATE_NAME, providerTemplateId: PROVIDER_TEMPLATE_ID, providerCategory: "authentication" } }));
    return r.ok === true; // a body was rendered for a mapping of a different template
  });

tsMutation("MUT E: the renderer accepts a non-authentication category",
  [[RENDERER_SRC,
    "  if (m.providerCategory !== AUTHENTICATION_SMS_CATEGORY) {",
    "  if (false) {"]],
  (mm) => {
    const r = mm.Renderer.resolveAuthenticationSmsContent(renderInput({ runtimeMapping: { templateKey: TEMPLATE, language: "en", providerTemplateName: PROVIDER_TEMPLATE_NAME, providerTemplateId: PROVIDER_TEMPLATE_ID, providerCategory: "marketing" } }));
    return r.ok === true; // an OTP rendered onto a marketing template
  });

tsMutation("MUT F: the mock retains the message body (which contains the OTP)",
  [[MOCK_SMS_SRC, "      templateKey: resolved.providerTemplateName,", "      templateKey: resolved.messageBody,"]],
  async (mm) => {
    const mock = new mm.MockSms.MockSmsProvider();
    await mock.sendResolvedAuthenticationSms("+15550002222", { messageBody: `${OTP} secret body`, providerTemplateName: PROVIDER_TEMPLATE_NAME, providerTemplateId: PROVIDER_TEMPLATE_ID });
    return safeStringify(mock.getLastSentRecords()).includes(OTP);
  });

tsMutation("MUT G: the Exotel adapter sends the OTP as a bare template variable instead of the reviewed body",
  [[EXOTEL_ADAPTER_SRC, "      Body: resolved.messageBody,", "      Body: \"\","]],
  async (mm) => {
    const cfg = mm.ExotelConfig.resolveExotelConfig(EXOTEL_ENV);
    const t = fakeTransport();
    await new mm.Exotel.ExotelSmsProvider(cfg.config, t).sendResolvedAuthenticationSms(PHONE, { messageBody: "real body", providerTemplateName: "T", providerTemplateId: "1" });
    return new URLSearchParams(t.calls[0].body).get("Body") === ""; // the reviewed body was dropped
  });

// ---- Phase 5F-C3-C-1 correction: ONE DLT template-identity authority, no fallback ----------
tsMutation("MUT H: the Exotel adapter reads the CONFIG template id instead of the descriptor",
  [[EXOTEL_ADAPTER_SRC, "    const dltTemplateId = resolved.providerTemplateId;", "    const dltTemplateId = this.config.dltTemplateId;"]],
  async (mm) => {
    const env = { ...EXOTEL_ENV, EXOTEL_DLT_ENTITY_ID: "111", EXOTEL_DLT_TEMPLATE_ID: "222" };
    const cfg = mm.ExotelConfig.resolveExotelConfig(env);
    const t = fakeTransport();
    await new mm.Exotel.ExotelSmsProvider(cfg.config, t).sendResolvedAuthenticationSms(PHONE, { messageBody: "B", providerTemplateName: "T", providerTemplateId: "TMPL_X" });
    // The wire carries the CONFIG id, not the descriptor id the mapping resolved.
    return new URLSearchParams(t.calls[0].body).get("DltTemplateId") === "222";
  });

tsMutation("MUT I: with the preflight bypassed, a nullish CONFIG fallback rescues a missing template id onto the wire",
  [
    [EXOTEL_ADAPTER_SRC, "    if (typeof resolved.providerTemplateId !== \"string\" || resolved.providerTemplateId.trim() === \"\") {", "    if (false) {"],
    [EXOTEL_ADAPTER_SRC, "    const dltTemplateId = resolved.providerTemplateId;", "    const dltTemplateId = resolved.providerTemplateId ?? this.config.dltTemplateId;"],
  ],
  async (mm) => {
    const env = { ...EXOTEL_ENV, EXOTEL_DLT_ENTITY_ID: "111", EXOTEL_DLT_TEMPLATE_ID: "222" };
    const cfg = mm.ExotelConfig.resolveExotelConfig(env);
    const t = fakeTransport();
    // The correct code's preflight refuses a null id with ZERO calls; here config "222" reaches the wire.
    await new mm.Exotel.ExotelSmsProvider(cfg.config, t).sendResolvedAuthenticationSms(PHONE, { messageBody: "B", providerTemplateName: "T", providerTemplateId: null });
    return t.calls.length > 0 && new URLSearchParams(t.calls[0].body).get("DltTemplateId") === "222";
  });

tsMutation("MUT K: the Exotel DLT-template-id preflight is removed, letting a missing id reach transport",
  [[EXOTEL_ADAPTER_SRC, "    if (typeof resolved.providerTemplateId !== \"string\" || resolved.providerTemplateId.trim() === \"\") {", "    if (false) {"]],
  async (mm) => {
    const cfg = mm.ExotelConfig.resolveExotelConfig(EXOTEL_ENV);
    const t = fakeTransport();
    await new mm.Exotel.ExotelSmsProvider(cfg.config, t).sendResolvedAuthenticationSms(PHONE, { messageBody: "B", providerTemplateName: "T", providerTemplateId: null });
    // Without the preflight, a request left the process despite a missing DLT template id.
    return t.calls.length > 0;
  });

tsMutation("MUT J: the renderer drops the missing-template-id guard",
  [[RENDERER_SRC, "  if (providerTemplateId === \"\") {", "  if (false) {"]],
  (mm) => {
    const r = mm.Renderer.resolveAuthenticationSmsContent(renderInput({ runtimeMapping: { templateKey: TEMPLATE, language: "en", providerTemplateName: PROVIDER_TEMPLATE_NAME, providerTemplateId: null, providerCategory: "authentication" } }));
    return r.ok === true && r.resolved.providerTemplateId === ""; // an empty template id was emitted
  });

// ============================================================================
// RUNNER
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-C3-C-1 resolved-SMS renderer + contract + orchestrator checks...\n");
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
  console.log("\nRunning Phase 5F-C3-C-1 mutation tests...\n");
  for (const mut of mutationChecks) {
    const mutDir = resolve(`.phase5fc3c1-mut-${mutationChecks.indexOf(mut)}`);
    const originals = new Map();
    for (const edit of mut.edits) { const p = resolve(edit.file); if (!originals.has(p)) originals.set(p, readFileSync(p, "utf8")); }
    try {
      for (const edit of mut.edits) {
        const p = resolve(edit.file);
        const cur = readFileSync(p, "utf8");
        if (!cur.includes(edit.from)) throw new Error(`anchor not found in ${edit.file}`);
        writeFileSync(p, cur.replace(edit.from, edit.to));
      }
      let mm;
      try { compileTo(mutDir); transpileOrchestrator(mutDir); } catch { console.log(`PASS ${mut.name} (rejected at compile time)`); passed++; continue; }
      mm = wireBuild(mutDir);
      let violation = await mut.scenario(mm);
      if (!violation) violation = await suiteGoesRed();
      if (violation) { console.log(`PASS ${mut.name}`); passed++; }
      else { console.log(`FAIL ${mut.name} (guard did not prove load-bearing)`); failed++; }
    } catch (e) {
      console.log(`FAIL ${mut.name}`); console.error(e); failed++;
    } finally {
      for (const [p, original] of originals) writeFileSync(p, original);
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
