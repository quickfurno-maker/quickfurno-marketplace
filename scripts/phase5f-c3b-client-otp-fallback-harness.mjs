import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5F-C3-B — client_login_otp attempt ledger + OPTIONAL SMS fallback harness.
 *
 * The fallback ships operationally DISABLED. This harness proves that, and then proves the
 * disabled machinery is nonetheless correct: it drives the orchestrator with injected fake
 * collaborators so NO database, NO network, NO real provider and NO real credential is ever
 * touched, and NO SMS is ever sent.
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

/**
 * The orchestrator imports the real service layer (Supabase, CommunicationService, the
 * Meta/Exotel adapters). Compiling that graph would drag the whole app in, so it is
 * transpiled ALONE and its service imports are satisfied by in-memory stubs. Every
 * collaborator it actually uses is injected via its `deps` parameter anyway.
 */
const ORCHESTRATOR_SRC = "services/clientLoginOtpDeliveryOrchestrator.ts";
const MAPPING_SRC = "lib/auth/authAttemptOutcomeMapping.ts";
const FACTORY_SRC = "services/runtimeSmsAdapterFactory.ts";
const HOOK_SRC = "services/supabaseSendSmsHookService.ts";
const DECISION_SRC = "lib/communication/authenticationTransportDecision.ts";
const ATTEMPT_SVC_SRC = "services/authenticationDeliveryAttemptService.ts";
const POLICY_SVC_SRC = "services/authenticationTransportPolicyService.ts";
const EXOTEL_ADAPTER_SRC = "lib/communication/providers/exotelSmsProvider.ts";
const AUTH_MIGRATION = "supabase/migrations/20260710000100_auth_transport_resilience_decision_foundation.sql";
const DOC_C3B = "docs/QF-Client-OTP-Attempt-Ledger-And-SMS-Fallback-Phase-5F-C3B.md";

const readCode = (p) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
const readF = (f) => readFileSync(f, "utf8");

// ============================================================================
// REGISTRY
// ============================================================================
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ============================================================================
// BUILD — pure modules compiled; the orchestrator transpiled with stubbed services
// ============================================================================
const MAIN_DIR = resolve(".phase5fc3b-build-main");

function transpileOrchestrator(outDir) {
  const tsconfigPath = resolve(`${outDir}.orch.tsconfig.json`);
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          module: "commonjs", target: "ES2020", moduleResolution: "node",
          skipLibCheck: true, esModuleInterop: true, strict: false, isolatedModules: true,
          outDir, rootDir: ".", types: [],
          // Do not follow imports: the service graph is satisfied by the require() stubs
          // below, and `npm run typecheck` already type-checks the real graph.
          noResolve: true,
        },
        files: [ORCHESTRATOR_SRC],
      },
      null,
      2
    )
  );
  try {
    // `noEmitOnError` defaults to false, so the JS is emitted despite the unresolved-import
    // diagnostics that `noResolve` necessarily produces. Those are not real type errors.
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

compileTo(MAIN_DIR);
transpileOrchestrator(MAIN_DIR);

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
    Decision: req("./lib/communication/authenticationTransportDecision.js"),
    Identity: req("./lib/communication/authenticationActionIdentity.js"),
    Phone: req("./lib/communication/phone.js"),
    Deadline: req("./lib/auth/hookDeadline.js"),
    Mapping: req("./lib/auth/authAttemptOutcomeMapping.js"),
    Gate: req("./lib/communication/providers/smsRuntimeGate.js"),
    Orchestrator: req("./services/clientLoginOtpDeliveryOrchestrator.js"),
  };
}

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
const NETWORK_FAILURE_CODE = "META_ERROR_131026"; // a real provider rejection, not local

const DESTINATION_HASH = () => M.Phone.hashPhoneE164(PHONE);
const ACTION_ID = () => M.Identity.deriveClientLoginActionId(WEBHOOK_ID);

const ok = (data) => ({ ok: true, data });
const failResult = (code) => ({ ok: false, code, error: "x" });

/** A deadline with an injectable monotonic clock — never a real timer. */
function fakeDeadline(remainingMs = 4000) {
  return {
    totalBudgetMs: 5000,
    responseReserveMs: 750,
    remainingNetworkBudgetMs: () => remainingMs,
  };
}

const message = (over = {}) => ({
  id: "msg-row-1", status: "accepted", failure_code: null, provider: WHATSAPP_PROVIDER, ...over,
});

const intent = () => ({
  type: TEMPLATE, lane: "authentication", channel: "whatsapp", template_key: TEMPLATE,
  variables: { otp: OTP }, idempotency_key: `${TEMPLATE}:${WEBHOOK_ID}`, correlation_id: WEBHOOK_ID,
  entity_type: "auth_user", entity_id: AUTH_USER_ID,
});

const READY_GATE = () => ({
  status: "SMS_RUNTIME_READY", providerKey: SMS_PROVIDER, channel: "sms", activation: "active",
  mapping: {
    mappingId: "map-1", templateKey: TEMPLATE, providerKey: SMS_PROVIDER, channel: "sms",
    language: "en", providerTemplateName: "QF_OTP_DLT", providerTemplateId: "dlt-1",
    providerCategory: "authentication",
  },
});
const BLOCKED_GATE = { status: "SMS_RUNTIME_BLOCKED", reason: "RUNTIME_POLICY_MISSING" };
/**
 * A blocked gate that nonetheless carries a mapping. A real gate never does — a block has no
 * mapping — but it lets the "gate check removed" mutation run to completion and actually SEND
 * rather than merely crashing on the absent mapping. The mutation must expose a duplicate-OTP
 * hazard, not a TypeError.
 */
const BLOCKED_GATE_WITH_MAPPING = () => ({ ...BLOCKED_GATE, mapping: READY_GATE().mapping });

const ALLOWED_DECISION = { allowed: true, reason: "ALLOWED", channel: "sms", providerKey: SMS_PROVIDER, attemptNumber: 2 };
const blockedDecision = (reason) => ({ allowed: false, reason });

/**
 * A recording spy set of deps. Every collaborator is fake; nothing touches a database, a
 * network, a real provider, or a real credential.
 */
function makeDeps(over = {}) {
  const calls = {
    primaryClaims: [], fallbackClaims: [], finalizes: [], decisions: [], gates: [],
    sends: [], smsSends: [], smsFactoriesUsed: [], securityEvents: [], serverLogs: [],
  };
  const smsProvider = {
    providerKey: SMS_PROVIDER,
    channel: "sms",
    async sendAuthenticationMessage(to, templateKey, variables, options) {
      calls.smsSends.push({ to, templateKey, variables, options });
      return over.smsResult ?? {
        accepted: true, provider: SMS_PROVIDER, channel: "sms",
        providerMessageId: "exotel-sid-1", normalizedStatus: "accepted",
        errorCode: null, errorMessage: null, retryable: false, outcomeCertainty: "accepted",
      };
    },
  };
  let fallbackClaimCount = 0;
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
      fallbackClaimCount += 1;
      // The RPC caps a single fallback per action: a second claim is ATTEMPT_LIMIT_REACHED.
      if (fallbackClaimCount > 1) {
        return ok({ outcome: "ATTEMPT_LIMIT_REACHED", detail: null, attemptId: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null });
      }
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
    createRuntimeSmsProvider: over.createRuntimeSmsProvider ?? ((factory) => {
      calls.smsFactoriesUsed.push(factory);
      return ok(over.smsProvider ?? smsProvider);
    }),
    logLedgerUnavailable: over.logLedgerUnavailable ?? ((line) => {
      calls.serverLogs.push(line);
      if (over.serverLogThrows) throw new Error("simulated server-log failure");
    }),
    recordLedgerUnavailableEvent: over.recordLedgerUnavailableEvent ?? (async (event) => {
      calls.securityEvents.push(event);
      if (over.securityEventThrows) throw new Error("simulated observability failure");
      return ok(null);
    }),
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

/** Drive the orchestrator with a definitive WhatsApp failure that is NOT a local code. */
function definitiveFailureOver(over = {}) {
  return { sendResult: ok(message({ status: "failed", failure_code: NETWORK_FAILURE_CODE })), ...over };
}

const run = (over = {}, inputOver = {}) => {
  const deps = makeDeps(over);
  return M.Orchestrator.deliverClientLoginOtp(baseInput(inputOver), deps).then((r) => ({ r, deps }));
};

async function captureConsole(fn) {
  const methods = ["log", "error", "warn", "info", "debug", "trace"];
  const original = {};
  let buffer = "";
  for (const m of methods) {
    original[m] = console[m];
    console[m] = (...args) => { buffer += args.map((a) => (typeof a === "string" ? a : safeStringify(a))).join(" ") + "\n"; };
  }
  try { const value = await fn(); return { value, buffer }; }
  finally { for (const m of methods) console[m] = original[m]; }
}
function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }

// ============================================================================
// 1. SHIPPED STATE — DISABLED, NO BEHAVIOUR CHANGE
// ============================================================================
check("1. shipped disabled: policy rows are not operationally enabled and NO failure rule exists", () => {
  const sql = readF(AUTH_MIGRATION);
  assert(!/insert\s+into\s+public\.authentication_transport_failure_rules/i.test(sql),
    "the failure-rule table is never seeded — default deny");
  assert(!/update\s+public\.authentication_transport_policies[\s\S]{0,200}is_operationally_enabled\s*=\s*true/i.test(sql),
    "no policy is operationally enabled by a migration");
  // C3-B adds no migration at all.
  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  assert(migrations[migrations.length - 1] === "20260710000100_auth_transport_resilience_decision_foundation.sql",
    `no new migration; newest is ${migrations[migrations.length - 1]}`);
});

check("2. disabled policy → fallback blocked, primary behaviour unchanged, no SMS", async () => {
  const { r, deps } = await run(definitiveFailureOver({ decision: blockedDecision("POLICY_DISABLED") }));
  assert(r.kind === "delivery_failed", `got ${r.kind}`);
  assert(r.dispatchAttempted === true, "the primary was still dispatched");
  assert(r.fallbackBlockedReason === "POLICY_DISABLED", `got ${r.fallbackBlockedReason}`);
  assert(r.smsSent === false && r.fallbackClaimed === false, "no SMS, no fallback claim");
  assert(deps.calls.fallbackClaims.length === 0, "no fallback attempt was claimed");
  assert(deps.calls.gates.length === 0, "a blocked decision never even reaches the SMS gate");
  assert(deps.calls.smsSends.length === 0, "no SMS was sent");
});

// ============================================================================
// 3-5. PRIMARY OUTCOME → FALLBACK ELIGIBILITY
// ============================================================================
check("3. accepted primary → no fallback attempt claimed, no decision even requested", async () => {
  for (const status of ["accepted", "sent", "delivered", "read"]) {
    const { r, deps } = await run({ sendResult: ok(message({ status })) });
    assert(r.kind === "delivered", `${status} → ${r.kind}`);
    assert(deps.calls.decisions.length === 0, `${status}: the fallback decision is never consulted`);
    assert(deps.calls.fallbackClaims.length === 0, `${status}: no fallback attempt claimed`);
    assert(deps.calls.smsSends.length === 0, `${status}: no SMS sent`);
    const fin = deps.calls.finalizes[0];
    assert(fin.attemptId === "attempt-1" && fin.outcomeCertainty === "accepted", `${status}: attempt 1 finalized accepted`);
  }
});

check("4. unknown_outcome primary → NEVER a fallback (the OTP may already have arrived)", async () => {
  const { r, deps } = await run({ sendResult: ok(message({ status: "outcome_unknown" })) });
  assert(r.kind === "delivery_uncertain", `got ${r.kind}`);
  assert(deps.calls.decisions.length === 0, "the fallback decision is never consulted");
  assert(deps.calls.fallbackClaims.length === 0, "no fallback attempt claimed");
  assert(deps.calls.smsSends.length === 0, "no SMS sent");
  const fin = deps.calls.finalizes[0];
  assert(fin.outcomeCertainty === "unknown_outcome" && fin.status === "outcome_unknown", "attempt 1 parked");

  // An in-flight status is also never a proven failure.
  for (const status of ["queued", "dispatching", "retry_scheduled", "something_new"]) {
    const { r: r2, deps: d2 } = await run({ sendResult: ok(message({ status })) });
    assert(r2.kind === "in_progress", `${status} → ${r2.kind}`);
    assert(d2.calls.decisions.length === 0, `${status}: no fallback considered`);
    assert(d2.calls.finalizes[0].outcomeCertainty === "unknown_outcome", `${status}: never a proven failure`);
  }
});

check("5. definitive_failure + NO failure rule → blocked, no SMS (default deny)", async () => {
  const { r, deps } = await run(definitiveFailureOver({ decision: blockedDecision("FAILURE_NOT_FALLBACK_ELIGIBLE") }));
  assert(r.kind === "delivery_failed", `got ${r.kind}`);
  assert(r.fallbackBlockedReason === "FAILURE_NOT_FALLBACK_ELIGIBLE", `got ${r.fallbackBlockedReason}`);
  assert(deps.calls.decisions.length === 1, "the decision WAS consulted for a proven failure");
  assert(deps.calls.fallbackClaims.length === 0 && deps.calls.smsSends.length === 0, "no claim, no SMS");

  // The PURE engine agrees: an empty rule table can never resolve eligibility.
  const eligibility = M.Decision.resolveFailureRule([], {
    authFlow: "client_login_otp", primaryChannel: "whatsapp",
    primaryProviderKey: WHATSAPP_PROVIDER, failureCode: NETWORK_FAILURE_CODE,
  });
  assert(eligibility.resolved === false && eligibility.reason === "no_rule", "no rule → default deny");
});

// ============================================================================
// 6-8. THE ALLOWED PATH — CLAIMED EXACTLY ONCE
// ============================================================================
check("6. definitive_failure + rule + ready gate → fallback claimed ONCE, SMS sent once", async () => {
  const { r, deps } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }));
  assert(r.kind === "delivered", `got ${r.kind}`);
  assert(r.fallbackClaimed === true && r.smsSent === true, "the fallback happened");
  assert(deps.calls.fallbackClaims.length === 1, `claimed exactly once, got ${deps.calls.fallbackClaims.length}`);
  assert(deps.calls.smsSends.length === 1, `sent exactly once, got ${deps.calls.smsSends.length}`);
  assert(deps.calls.finalizes.length === 2, "both attempts finalized");
  assert(deps.calls.finalizes[1].attemptId === "attempt-2", "attempt 2 finalized");

  // The claim carries the decision's reason and the provider it allowed — never a guess.
  const claim = deps.calls.fallbackClaims[0];
  assert(claim.decisionReason === "ALLOWED", `decision reason recorded, got ${claim.decisionReason}`);
  assert(claim.providerKey === SMS_PROVIDER, `the allowed provider, got ${claim.providerKey}`);
  assert(claim.authActionId === ACTION_ID(), "the same authentication action");
  assert(claim.destinationHash === DESTINATION_HASH(), "the same destination hash");
});

check("7. a SECOND fallback attempt is rejected by the ledger — max two attempts, ever", async () => {
  // The fake claim mirrors the RPC: the first claim CLAIMS, a second returns the limit.
  const deps = makeDeps(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }));
  const first = await M.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
  assert(first.fallbackClaimed === true && first.smsSent === true, "first fallback succeeded");

  const second = await M.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
  assert(second.fallbackClaimed === false, "the second fallback is NOT claimed");
  assert(second.smsSent === false, "and NO second SMS is sent");
  assert(second.kind === "delivery_failed", `got ${second.kind}`);
  assert(second.fallbackBlockedReason === "FALLBACK_CLAIM_REJECTED", `got ${second.fallbackBlockedReason}`);
  assert(deps.calls.smsSends.length === 1, `exactly one SMS across both runs, got ${deps.calls.smsSends.length}`);
});

check("8. a rejected fallback claim NEVER sends SMS, for every rejection outcome", async () => {
  for (const outcome of [
    "ALREADY_EXISTS", "PRIMARY_REQUIRED", "PRIMARY_NOT_DEFINITIVE", "UNKNOWN_OUTCOME_BLOCKED",
    "ACCEPTED_PRIMARY_BLOCKED", "LINEAGE_MISMATCH", "ATTEMPT_LIMIT_REACHED",
    "WHATSAPP_VERIFY_FALLBACK_FORBIDDEN", "INVALID_REQUEST", "DATABASE_ERROR",
  ]) {
    // A rejected claim may still carry an attempt id (ALREADY_EXISTS returns the existing
    // row). The OUTCOME — not the presence of an id — is what authorizes a send.
    const rejected = ok({ outcome, attemptId: "attempt-2", detail: null, attemptNumber: 2, channel: "sms", fallbackFromAttemptId: "attempt-1" });
    const { r, deps } = await run(definitiveFailureOver({
      decision: ALLOWED_DECISION, gate: READY_GATE(),
      claimFallbackAttempt: async () => rejected,
    }));
    assert(r.smsSent === false, `${outcome}: no SMS`);
    assert(r.fallbackClaimed === false, `${outcome}: not claimed`);
    assert(r.kind === "delivery_failed", `${outcome}: ${r.kind}`);
    assert(r.fallbackBlockedReason === "FALLBACK_CLAIM_REJECTED", `${outcome}: ${r.fallbackBlockedReason}`);
    assert(deps.calls.smsSends.length === 0, `${outcome}: transport untouched`);
  }
  // A claim that CLAIMS but returns no attempt id is also refused: nothing to finalize.
  const { r, deps } = await run(definitiveFailureOver({
    decision: ALLOWED_DECISION, gate: READY_GATE(),
    claimFallbackAttempt: async () => ok({ outcome: "CLAIMED", attemptId: null, detail: null, attemptNumber: 2, channel: "sms", fallbackFromAttemptId: null }),
  }));
  assert(r.smsSent === false && deps.calls.smsSends.length === 0, "a claim without an attempt id sends nothing");
  // A thrown claim also sends nothing.
  const { r: r2, deps: d2 } = await run(definitiveFailureOver({
    decision: ALLOWED_DECISION, gate: READY_GATE(),
    claimFallbackAttempt: async () => failResult("BOOM"),
  }));
  assert(r2.smsSent === false && d2.calls.smsSends.length === 0, "a thrown claim sends nothing");
});

// ============================================================================
// 9-11. GATE, IDENTITY FENCE, BUDGET
// ============================================================================
check("9. an allowed decision with a BLOCKED SMS runtime gate → no claim, no SMS", async () => {
  const { r, deps } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: BLOCKED_GATE }));
  assert(r.kind === "delivery_failed" && r.fallbackBlockedReason === "SMS_RUNTIME_BLOCKED", `got ${r.fallbackBlockedReason}`);
  assert(deps.calls.fallbackClaims.length === 0 && deps.calls.smsSends.length === 0, "nothing claimed, nothing sent");
  // The gate was asked about the provider the DECISION allowed, on the sms channel.
  assert(deps.calls.gates[0].providerKey === SMS_PROVIDER && deps.calls.gates[0].channel === "sms", "gate scoped correctly");
  assert(deps.calls.gates[0].destinationHash === DESTINATION_HASH(), "the gate sees only a hash");
  assert(!safeStringify(deps.calls.gates[0]).includes(PHONE), "the gate never sees a plaintext phone");
});

check("10. provider identity mismatch → blocked BEFORE any claim or send", async () => {
  const impostor = { providerKey: "msg91_sms", channel: "sms", sendAuthenticationMessage: async () => { throw new Error("must not send"); } };
  const { r, deps } = await run(definitiveFailureOver({
    decision: ALLOWED_DECISION, gate: READY_GATE(), smsProvider: impostor,
  }));
  assert(r.kind === "delivery_failed", `got ${r.kind}`);
  assert(r.fallbackBlockedReason === "SMS_PROVIDER_IDENTITY_MISMATCH", `got ${r.fallbackBlockedReason}`);
  assert(deps.calls.fallbackClaims.length === 0, "blocked BEFORE the claim");
  assert(deps.calls.smsSends.length === 0, "blocked BEFORE the send");

  // A wrong channel is refused by the same fence.
  const wrongChannel = { providerKey: SMS_PROVIDER, channel: "whatsapp", sendAuthenticationMessage: async () => { throw new Error("must not send"); } };
  const { r: r2 } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE(), smsProvider: wrongChannel }));
  assert(r2.fallbackBlockedReason === "SMS_PROVIDER_IDENTITY_MISMATCH", `got ${r2.fallbackBlockedReason}`);

  // An unresolvable provider (mock candidate, incomplete config, throwing factory) fails closed.
  const { r: r3, deps: d3 } = await run(definitiveFailureOver({
    decision: ALLOWED_DECISION, gate: READY_GATE(),
    createRuntimeSmsProvider: () => { throw new Error("factory blew up"); },
  }));
  assert(r3.fallbackBlockedReason === "SMS_PROVIDER_UNAVAILABLE", `got ${r3.fallbackBlockedReason}`);
  assert(d3.calls.fallbackClaims.length === 0 && d3.calls.smsSends.length === 0, "nothing claimed or sent");

  const { r: r4 } = await run(definitiveFailureOver({
    decision: ALLOWED_DECISION, gate: READY_GATE(),
    createRuntimeSmsProvider: () => failResult("SMS_PROVIDER_NOT_CONFIGURED"),
  }));
  assert(r4.fallbackBlockedReason === "SMS_PROVIDER_UNAVAILABLE", `got ${r4.fallbackBlockedReason}`);
});

check("11. budget exhausted → NO claim, NO SMS; the deadline covers BOTH attempts", async () => {
  const MIN = M.Deadline.MIN_VIABLE_AUTH_NETWORK_BUDGET_MS;
  for (const remaining of [MIN - 1, 0, -250, 1]) {
    const { r, deps } = await run(
      definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }),
      { deadline: fakeDeadline(remaining) }
    );
    assert(r.kind === "delivery_failed", `remaining=${remaining} → ${r.kind}`);
    assert(r.fallbackBlockedReason === M.Deadline.AUTH_NETWORK_DEADLINE_EXHAUSTED, `got ${r.fallbackBlockedReason}`);
    assert(deps.calls.fallbackClaims.length === 0, `remaining=${remaining}: nothing claimed`);
    assert(deps.calls.smsSends.length === 0, `remaining=${remaining}: NO SMS sent`);
  }
  // Exactly the minimum is viable, and the remaining budget is a CEILING on the SMS timeout.
  const { r, deps } = await run(
    definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }),
    { deadline: fakeDeadline(MIN) }
  );
  assert(r.smsSent === true, "the minimum viable budget still sends");
  assert(deps.calls.smsSends[0].options.maxNetworkTimeoutMs === MIN, "the remaining budget is passed as a ceiling");
  assert(MIN <= M.Deadline.AUTH_HOOK_TOTAL_BUDGET_MS, "never above the total hook budget");
  // The primary send received the same deadline object — one budget, both attempts.
  assert(deps.calls.sends[0].options.authDeadline.totalBudgetMs === M.Deadline.AUTH_HOOK_TOTAL_BUDGET_MS,
    "the primary shares the total budget");
});

// ============================================================================
// 12-14. NO SECOND OTP, NO SECRET LEAK
// ============================================================================
check("12. the SAME OTP is used for BOTH attempts — never regenerated", async () => {
  const { r, deps } = await run(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }));
  assert(r.smsSent === true, "the fallback ran");
  assert(deps.calls.sends[0].intent.variables.otp === OTP, "attempt 1 carried the caller's OTP");
  assert(deps.calls.smsSends[0].variables.otp === OTP, "attempt 2 carried the SAME OTP");
  assert(deps.calls.smsSends[0].to === PHONE, "the SMS went to the same destination");

  // The orchestrator contains no OTP generator of any kind.
  const src = readCode(ORCHESTRATOR_SRC);
  assert(!/Math\.random|randomInt|randomBytes|randomUUID|generateOtp|createOtp/i.test(src),
    "the orchestrator never generates an OTP");
  assert(!/\botp\s*=\s*(?!input\.otp)/.test(src), "the OTP is never reassigned");
  // Exactly one read of the OTP, handed straight to the SMS adapter.
  assert((src.match(/input\.otp/g) ?? []).length === 1, "the OTP is read exactly once");
});

check("13. no OTP and no plaintext phone reaches any ledger write, log, or result", async () => {
  const { value, buffer } = await captureConsole(async () => {
    const results = [];
    for (const over of [
      { sendResult: ok(message()) },
      { sendResult: ok(message({ status: "outcome_unknown" })) },
      definitiveFailureOver({ decision: blockedDecision("POLICY_DISABLED") }),
      definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }),
    ]) {
      results.push(await run(over));
    }
    return results;
  });
  assert(buffer === "", "the orchestrator logs nothing at all");

  for (const { r, deps } of value) {
    const rendered = safeStringify(r);
    assert(!rendered.includes(OTP) && !rendered.includes(PHONE), "the result carries neither OTP nor phone");

    // Every ledger write: claims and finalizes.
    for (const write of [...deps.calls.primaryClaims, ...deps.calls.fallbackClaims, ...deps.calls.finalizes]) {
      const w = safeStringify(write);
      assert(!w.includes(OTP), "no OTP in a ledger write");
      assert(!w.includes(PHONE), "no plaintext phone in a ledger write");
      assert(!w.includes(WEBHOOK_ID), "no raw webhook id in a ledger write");
    }
    for (const claim of [...deps.calls.primaryClaims, ...deps.calls.fallbackClaims]) {
      assert(claim.destinationHash === DESTINATION_HASH(), "the destination is a hash");
      assert(/^[0-9a-f]{64}$/.test(claim.destinationHash), "…a 64-char sha256 hex digest");
      assert(/^[0-9a-f]{64}$/.test(claim.authActionId), "the action id is a 64-char sha256 digest");
      assert(claim.authActionId !== claim.destinationHash, "…and is not the destination hash");
    }
  }
  // The action id is derived from the VERIFIED webhook id, deterministically.
  assert(ACTION_ID() === M.Identity.deriveClientLoginActionId(WEBHOOK_ID), "deterministic");
  assert(ACTION_ID() !== M.Identity.deriveClientLoginActionId(`${WEBHOOK_ID}x`), "distinct actions differ");
});

check("14. a local/preflight failure code is NEVER fallback-eligible", async () => {
  const localCodes = [
    "AUTH_NETWORK_DEADLINE_EXHAUSTED", "EXOTEL_RESOLVED_TEMPLATE_REQUIRED", "META_RESOLVED_TEMPLATE_REQUIRED",
    "META_OUTBOUND_CONFIG_MISSING", "META_TEMPLATE_RENDER_MISSING_VARIABLE", "WHATSAPP_PROVIDER_NOT_CONFIGURED",
    "SMS_PROVIDER_NOT_CONFIGURED", "SMS_PROVIDER_IDENTITY_MISMATCH", "VALIDATION", "PROVIDER_EXCEPTION",
    "EXOTEL_DESTINATION_INVALID", "EXOTEL_TEMPLATE_BODY_MISSING", "APPROVED_TEMPLATE_UNAVAILABLE",
  ];
  for (const code of localCodes) {
    assert(M.Mapping.isLocalPreflightFailureCode(code) === true, `${code} is local`);
    // Even with a fully permissive decision and a ready gate, the orchestrator refuses.
    const { r, deps } = await run({
      sendResult: ok(message({ status: "failed", failure_code: code })),
      decision: ALLOWED_DECISION, gate: READY_GATE(),
    });
    assert(r.fallbackBlockedReason === "LOCAL_PREFLIGHT_FAILURE", `${code} → ${r.fallbackBlockedReason}`);
    assert(deps.calls.decisions.length === 0, `${code}: the decision is not even consulted`);
    assert(deps.calls.fallbackClaims.length === 0 && deps.calls.smsSends.length === 0, `${code}: no claim, no SMS`);
  }
  // An absent or unsanitizable code fails closed as local.
  for (const bad of [null, undefined, "", "not an identifier", "1234", "a".repeat(80)]) {
    assert(M.Mapping.isLocalPreflightFailureCode(bad) === true, `${bad} fails closed as local`);
  }
  // A genuine provider rejection is NOT local — but still needs an explicit rule.
  for (const code of [NETWORK_FAILURE_CODE, "EXOTEL_ERROR_1001", "META_HTTP_400"]) {
    assert(M.Mapping.isLocalPreflightFailureCode(code) === false, `${code} is a provider rejection`);
  }
  // isLocalPreflightFailureCode is DENY-ONLY: it appears in no allow branch.
  const src = readCode(ORCHESTRATOR_SRC);
  assert(/if\s*\(\s*isLocalPreflightFailureCode\([^)]*\)\s*\)/.test(src), "used as a positive deny guard");
  assert(!/if\s*\(\s*!\s*isLocalPreflightFailureCode/.test(src), "never used to GRANT a fallback");
});

// ============================================================================
// 15-17. LEDGER SEMANTICS
// ============================================================================
check("15. an unavailable ledger still delivers the primary, and makes fallback impossible", async () => {
  const { r, deps } = await run({
    claimPrimaryAttempt: async () => ok({ outcome: "DATABASE_ERROR", attemptId: null, detail: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null }),
    sendResult: ok(message()),
  });
  assert(r.kind === "delivered", `the primary still went out, got ${r.kind}`);
  assert(r.ledgerUnavailable === true, "the ledger was reported unavailable");
  assert(deps.calls.finalizes.length === 0, "nothing is finalized without a claimed attempt");

  // …and a definitive failure cannot fall back without a claimed attempt 1.
  const { r: r2, deps: d2 } = await run(definitiveFailureOver({
    claimPrimaryAttempt: async () => ok({ outcome: "DATABASE_ERROR", attemptId: null, detail: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null }),
    decision: ALLOWED_DECISION, gate: READY_GATE(),
  }));
  assert(r2.fallbackBlockedReason === "LEDGER_UNAVAILABLE", `got ${r2.fallbackBlockedReason}`);
  assert(d2.calls.decisions.length === 0 && d2.calls.smsSends.length === 0, "no decision, no SMS");

  // A thrown claim is treated the same way — never a silent block of the OTP.
  const { r: r3 } = await run({ claimPrimaryAttempt: async () => failResult("BOOM"), sendResult: ok(message()) });
  assert(r3.kind === "delivered" && r3.ledgerUnavailable === true, "a thrown claim still delivers");
});

check("16. a STRUCTURAL primary-claim refusal never dispatches the OTP", async () => {
  for (const outcome of ["ATTEMPT_LIMIT_REACHED", "LINEAGE_MISMATCH", "INVALID_REQUEST", "PRIMARY_REQUIRED", "WHATSAPP_VERIFY_FALLBACK_FORBIDDEN"]) {
    const { r, deps } = await run({
      claimPrimaryAttempt: async () => ok({ outcome, attemptId: null, detail: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null }),
    });
    assert(r.kind === "delivery_failed", `${outcome} → ${r.kind}`);
    assert(r.dispatchAttempted === false, `${outcome}: nothing dispatched`);
    assert(deps.calls.sends.length === 0, `${outcome}: no WhatsApp send — a second OTP is never risked`);
  }
  // An idempotent replay of the SAME action still dispatches (CommunicationService dedupes).
  const { r, deps } = await run({
    claimPrimaryAttempt: async () => ok({ outcome: "ALREADY_EXISTS", attemptId: "attempt-1", detail: null, attemptNumber: 1, channel: "whatsapp", fallbackFromAttemptId: null }),
    sendResult: ok(message()),
  });
  assert(r.kind === "delivered" && deps.calls.sends.length === 1, "a replay re-enters the idempotent dispatch");
});

check("17. attempt 1 is claimed under the RUNTIME WhatsApp provider, before the send", async () => {
  const { deps } = await run({ sendResult: ok(message()) });
  assert(deps.calls.primaryClaims.length === 1, "claimed once");
  const claim = deps.calls.primaryClaims[0];
  assert(claim.providerKey === WHATSAPP_PROVIDER, `the runtime provider, got ${claim.providerKey}`);
  assert(claim.authFlow === "client_login_otp", `the flow, got ${claim.authFlow}`);
  assert(claim.authReferenceType === "auth_user" && claim.authReferenceId === AUTH_USER_ID, "the auth reference");

  // An unresolvable WhatsApp provider fails closed with no claim and no dispatch.
  const { r, deps: d2 } = await run({ resolveWhatsAppProviderKey: () => failResult("WHATSAPP_PROVIDER_NOT_CONFIGURED") });
  assert(r.kind === "delivery_failed" && r.dispatchAttempted === false, "fail closed");
  assert(d2.calls.primaryClaims.length === 0 && d2.calls.sends.length === 0, "no claim, no send");
});

// ============================================================================
// 18-20. SCOPE, VENDOR FLOWS, WIRING
// ============================================================================
check("18. vendor_whatsapp_verify and vendor_password_reset can never reach SMS", () => {
  const src = readCode(ORCHESTRATOR_SRC);
  assert(/ORCHESTRATED_AUTH_FLOW = "client_login_otp"/.test(readF(ORCHESTRATOR_SRC)), "the flow is a hardcoded constant");
  assert(!/vendor_whatsapp_verify|vendor_password_reset/.test(src), "no vendor flow is named in the orchestrator");
  assert((src.match(/authFlow:\s*ORCHESTRATED_AUTH_FLOW/g) ?? []).length >= 2, "every call site passes the one flow");

  // The PURE engine forbids it structurally, whatever a caller passes.
  const policy = {
    auth_flow: "vendor_whatsapp_verify", primary_channel: "whatsapp", primary_provider_key: WHATSAPP_PROVIDER,
    fallback_channel: "sms", fallback_provider_key: SMS_PROVIDER, automatic_fallback_enabled: true,
    user_requested_fallback_enabled: true, fallback_policy_status: "automatic_ready",
    hard_failure_only: true, is_operationally_enabled: true,
  };
  const decision = M.Decision.evaluateAuthenticationFallback({
    authFlow: "vendor_whatsapp_verify", requestMode: "automatic", policy,
    primaryAttempt: null,
    failureEligibility: { resolved: true, ruleId: "r", scope: "auth_flow", automaticFallbackEligible: true, userRequestedFallbackEligible: true },
    attemptHistory: { authActionId: "a", totalAttempts: 1, hasFallbackAttempt: false },
    request: { authActionId: "a", authReferenceType: "verification_challenge", authReferenceId: "c", destinationHash: "h" },
  });
  assert(decision.allowed === false, "a fully enabled vendor policy is still refused");
  assert(decision.reason === "WHATSAPP_VERIFICATION_FALLBACK_FORBIDDEN", `got ${decision.reason}`);

  // Neither vendor service was touched by this phase.
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })
    .split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
  for (const forbidden of ["services/vendorAuthService.ts", "services/vendorAuthChallengeService.ts", "lib/identity/vendorVerification.ts", "lib/identity/vendorPasswordReset.ts"]) {
    assert(!dirty.includes(forbidden), `${forbidden} must be untouched`);
  }
});

check("19. no migration, no SQL, no env change, and C1's authority files are untouched", () => {
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })
    .split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
  for (const path of dirty) {
    assert(!path.startsWith("supabase/migrations"), `no migration may be created or modified (${path})`);
    assert(!path.endsWith(".sql"), `no SQL file may be created or modified (${path})`);
    assert(!/(^|\/)\.env/.test(path), `no env file may be created or modified (${path})`);
  }
  // The C1 decision engine and the Exotel adapter internals are byte-for-byte unchanged.
  for (const authority of [DECISION_SRC, EXOTEL_ADAPTER_SRC]) {
    assert(!dirty.includes(authority), `${authority} must be unmodified`);
  }
  // The orchestrator touches no database and issues no SQL of its own.
  const src = readCode(ORCHESTRATOR_SRC);
  assert(!/adminClient|from\(["']|\.rpc\(/.test(src), "the orchestrator never touches the database directly");
  assert(!/insert into|update\s+public\.|create table/i.test(src), "no SQL");
  assert(!/\bn8n\b|\bqueue\b|setTimeout|setInterval|\bfor\s*\(|\bwhile\s*\(/i.test(src), "no queue, no scheduler, no retry loop");
  assert(!/Promise\.race/.test(src), "no pseudo-timeout");
});

check("20. wiring: test:phase5f:c3b exists, earlier harnesses untouched, the doc is complete", () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:c3b"] === "node scripts/phase5f-c3b-client-otp-fallback-harness.mjs", "test:phase5f:c3b wired");
  for (const [name, script] of [
    ["test:phase5f:c3a", "node scripts/phase5f-c3a-exotel-adapter-harness.mjs"],
    ["test:phase5f:c2", "node scripts/phase5f-c2-sms-runtime-foundation-harness.mjs"],
    ["test:phase5f:c", "node scripts/phase5f-c-auth-transport-resilience-harness.mjs"],
  ]) {
    assert(pkg.scripts[name] === script, `${name} unchanged`);
  }
  for (const f of [ORCHESTRATOR_SRC, MAPPING_SRC, FACTORY_SRC, HOOK_SRC, DOC_C3B]) assert(existsSync(f), `${f} exists`);

  const doc = readF(DOC_C3B);
  for (const topic of [
    /what this phase does not do/i, /authority boundar/i, /ships? (operationally )?disabled/i,
    /no second OTP/i, /attempt ledger/i, /fallback/i, /deadline/i, /budget/i,
    /identity fence/i, /default deny/i, /no migration/i, /local\/preflight/i, /DLT/,
    /observable, never silent/i, /ledger_unavailable/, /best-effort/i,
    /DB-independent server log/i, /survives a total DB outage/i, /greppable prefix/i,
  ]) {
    assert(topic.test(doc), `the documentation covers ${topic}`);
  }
  for (const affirmative of [/\bSMS is live\b/i, /SMS fallback is enabled\b/i, /fallback is active\b/i]) {
    assert(!affirmative.test(doc), `the doc must never claim ${affirmative}`);
  }
  // The corrected justification must be present, and the false premise absent.
  assert(/availability decision, not a schema-readiness/i.test(doc), "the doc states the corrected justification");
  assert(/The Phase 5F-C1 ledger is live/i.test(doc), "the doc affirms the ledger is live");
  assert(!/its migration is not applied|migration is unapplied|the RPC errors on live/i.test(doc), "no false unapplied-migration premise remains");
  // And the bare-send technical debt is recorded.
  assert(/known technical debt/i.test(doc) && /sendResolvedAuthenticationSms/.test(doc) && /EXOTEL_RESOLVED_TEMPLATE_REQUIRED/.test(doc),
    "the doc records the bare-send technical debt deferred to 5F-C3-C");
  // The orchestrator's code comments carry no false premise either.
  const orch = readF(ORCHESTRATOR_SRC);
  assert(!/migration is not applied|the RPC errors/i.test(orch), "the orchestrator comments carry no false premise");
  assert(/availability decision, not a\n?\s*\/\/\s*schema-readiness|availability decision, not a schema-readiness/i.test(orch),
    "the orchestrator comments state the corrected justification");
});

// ============================================================================
// 21-24. HEALTHY-DATABASE PROOF + OBSERVABLE DEGRADED PATH (Phase 5F-C3-B correction)
// ============================================================================
/** A claim stub that behaves like a HEALTHY database: it never returns DATABASE_ERROR. */
function healthyClaim() {
  return async (i) => {
    // A real successful claim always carries a concrete attempt id.
    return ok({ outcome: "CLAIMED", detail: null, attemptId: "attempt-1", attemptNumber: 1, channel: "whatsapp", fallbackFromAttemptId: null });
  };
}

check("21. on a HEALTHY database ledgerUnavailable is NEVER set, on any outcome path", async () => {
  const paths = [
    ["accepted", { sendResult: ok(message({ status: "accepted" })) }],
    ["sent", { sendResult: ok(message({ status: "sent" })) }],
    ["unknown", { sendResult: ok(message({ status: "outcome_unknown" })) }],
    ["in_progress", { sendResult: ok(message({ status: "queued" })) }],
    ["definitive+blocked", definitiveFailureOver({ decision: blockedDecision("POLICY_DISABLED") })],
    ["definitive+allowed+ready", definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() })],
    ["local-preflight", { sendResult: ok(message({ status: "failed", failure_code: "META_OUTBOUND_CONFIG_MISSING" })) }],
  ];
  for (const [label, over] of paths) {
    const { r, deps } = await run({ ...over, claimPrimaryAttempt: healthyClaim() });
    assert(r.ledgerUnavailable === false, `${label}: ledgerUnavailable must stay false on a healthy DB`);
    assert(deps.calls.securityEvents.length === 0, `${label}: no ledger_unavailable event on a healthy DB`);
  }
});

check("22. ledgerUnavailable and a claimed fallback attempt can NEVER both be true", async () => {
  // Force the most permissive world: allowed decision, ready gate — but the ledger is down.
  const { r, deps } = await run(definitiveFailureOver({
    claimPrimaryAttempt: async () => ok({ outcome: "DATABASE_ERROR", detail: null, attemptId: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null }),
    decision: ALLOWED_DECISION, gate: READY_GATE(),
  }));
  assert(r.ledgerUnavailable === true, "the ledger is unavailable");
  assert(r.fallbackClaimed === false, "…so a fallback can never be claimed");
  assert(!(r.ledgerUnavailable && r.fallbackClaimed), "the two are mutually exclusive by construction");
  assert(deps.calls.fallbackClaims.length === 0 && deps.calls.smsSends.length === 0, "no claim, no SMS");
  assert(r.fallbackBlockedReason === "LEDGER_UNAVAILABLE", `got ${r.fallbackBlockedReason}`);

  // Across every primary outcome, the invariant holds: a claimed fallback ⇒ ledger available.
  for (const over of [
    { sendResult: ok(message({ status: "accepted" })) },
    { sendResult: ok(message({ status: "outcome_unknown" })) },
    definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }),
  ]) {
    const { r: r2 } = await run({ ...over, claimPrimaryAttempt: healthyClaim() });
    if (r2.fallbackClaimed) assert(r2.ledgerUnavailable === false, "a claimed fallback proves the ledger was available");
  }
});

check("23. a ledger-unavailable action emits EXACTLY ONE sanitized security event", async () => {
  const { value, buffer } = await captureConsole(() => run(definitiveFailureOver({
    claimPrimaryAttempt: async () => ok({ outcome: "DATABASE_ERROR", detail: "connection_reset", attemptId: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null }),
    decision: ALLOWED_DECISION, gate: READY_GATE(),
  })));
  const { r, deps } = value;
  assert(r.ledgerUnavailable === true, "the degraded path was taken");
  assert(deps.calls.securityEvents.length === 1, `exactly one event, got ${deps.calls.securityEvents.length}`);
  const ev = deps.calls.securityEvents[0];
  assert(ev.authFlow === "client_login_otp", "records the auth flow");
  assert(ev.failureClassification === "connection_reset", `carries a sanitized classification, got ${ev.failureClassification}`);
  assert(ev.destinationHash === DESTINATION_HASH() && /^[0-9a-f]{64}$/.test(ev.destinationHash), "the destination is a sha256 hash");

  // No OTP, no plaintext phone, no hash pre-image, no raw error text — anywhere in the event.
  const rendered = safeStringify(ev);
  assert(!rendered.includes(OTP), "no OTP in the event");
  assert(!rendered.includes(PHONE), "no plaintext phone (hash pre-image) in the event");
  assert(!/connection reset by peer|ECONN|SQLSTATE|pg_|stack/i.test(rendered), "no raw database error text");
  assert(buffer === "", "the degraded path logs nothing to the console");

  // A happy path emits nothing.
  const { deps: healthy } = await run({ sendResult: ok(message()), claimPrimaryAttempt: healthyClaim() });
  assert(healthy.calls.securityEvents.length === 0, "a healthy action emits no event");

  // An unsanitizable claim detail falls back to the safe reason, never raw text.
  const { deps: d2 } = await run(definitiveFailureOver({
    claimPrimaryAttempt: async () => ok({ outcome: "DATABASE_ERROR", detail: "syntax error at or near \"$1\"", attemptId: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null }),
    decision: ALLOWED_DECISION, gate: READY_GATE(),
  }));
  assert(d2.calls.securityEvents[0].failureClassification === "ledger_unavailable", "an unsafe detail falls back to the safe reason");
});

check("24. if the security-event write THROWS, the OTP send still proceeds", async () => {
  const { r, deps } = await run({
    sendResult: ok(message({ status: "accepted" })),
    claimPrimaryAttempt: async () => ok({ outcome: "DATABASE_ERROR", detail: null, attemptId: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null }),
    securityEventThrows: true,
  });
  assert(deps.calls.sends.length === 1, "the WhatsApp primary was still dispatched");
  assert(r.dispatchAttempted === true, "dispatch happened");
  assert(r.kind === "delivered", `the login still succeeded, got ${r.kind}`);
  assert(r.ledgerUnavailable === true, "the degraded state is still reported");
  assert(deps.calls.securityEvents.length === 1, "the throwing emit was still attempted exactly once");

  // On the dispatch path the send happens BEFORE the (throwing) emit — observability can
  // never gate delivery. The post-send emit is the LAST call site (an earlier one guards the
  // rare service-construction-failure branch, where no send ever occurs).
  const src = readCode(ORCHESTRATOR_SRC);
  const sendIdx = src.indexOf(".send(input.buildPrimaryIntent()");
  const emitIdx = src.lastIndexOf("emitLedgerUnavailable(");
  assert(sendIdx > 0 && emitIdx > sendIdx, "the primary send precedes the observability emit");
});

// ============================================================================
// 25-28. DB-INDEPENDENT SERVER LOG (Phase 5F-C3-B second correction)
// ============================================================================
/** A claim result that looks like a genuine database OUTAGE — the case the log exists for. */
const DB_OUTAGE_CLAIM = (detail = null) => async () =>
  ok({ outcome: "DATABASE_ERROR", detail, attemptId: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null });

check("25. when the DB event write THROWS, the DB-independent server log still fired once", async () => {
  const { r, deps } = await run({
    sendResult: ok(message({ status: "accepted" })),
    claimPrimaryAttempt: DB_OUTAGE_CLAIM("connection_reset"),
    securityEventThrows: true, // the auth_security_events write fails, as it would in a real outage
  });
  assert(r.kind === "delivered", `the login still succeeded, got ${r.kind}`);
  assert(deps.calls.sends.length === 1, "the OTP was dispatched");
  assert(deps.calls.serverLogs.length === 1, `the server log fired exactly once, got ${deps.calls.serverLogs.length}`);
  assert(deps.calls.securityEvents.length === 1, "the DB event write was still attempted");
  const line = deps.calls.serverLogs[0];
  assert(line.authFlow === "client_login_otp", "log carries the auth flow");
  assert(line.reason === "ledger_unavailable", "log carries reason=ledger_unavailable");
  assert(line.failureClassification === "connection_reset", `log carries the sanitized classification, got ${line.failureClassification}`);
});

check("26. the server log emit PRECEDES the database event write, in source order", () => {
  const src = readCode(ORCHESTRATOR_SRC);
  const logIdx = src.indexOf("deps.logLedgerUnavailable({");
  const eventIdx = src.indexOf("deps.recordLedgerUnavailableEvent({");
  assert(logIdx > 0, "the server log emit exists");
  assert(eventIdx > 0, "the security-event write exists");
  assert(logIdx < eventIdx, "the DB-independent log must be emitted BEFORE the DB-backed write");
  // The log emit is guarded and never awaits a database.
  assert(!/await\s+deps\.logLedgerUnavailable/.test(src), "the server log is never awaited on a DB path");
});

check("27. the DEFAULT server logger writes one sanitized, greppable console line, no secrets", async () => {
  const PREFIX = M.Orchestrator.LEDGER_UNAVAILABLE_LOG_PREFIX;
  assert(typeof PREFIX === "string" && PREFIX.length > 0, "a fixed prefix is exported");

  // Drive a real DB-outage action but route the log through the DEFAULT (console) logger,
  // with a HOSTILE claim detail that tries to smuggle raw error text, the OTP and the phone.
  const defaultLog = M.Orchestrator.defaultClientOtpDeliveryDeps().logLedgerUnavailable;
  const hostileDetail = `syntax error at or near "$1"; otp=${OTP} phone=${PHONE}`;
  const { buffer } = await captureConsole(() => run({
    sendResult: ok(message({ status: "accepted" })),
    claimPrimaryAttempt: DB_OUTAGE_CLAIM(hostileDetail),
    logLedgerUnavailable: defaultLog,
  }));
  const occurrences = buffer.split(PREFIX).length - 1;
  assert(occurrences === 1, `exactly one prefixed line, got ${occurrences}`);
  assert(buffer.includes("ledger_unavailable"), "the line carries reason=ledger_unavailable");
  assert(!buffer.includes(OTP), "no OTP in the server log");
  assert(!buffer.includes(PHONE), "no plaintext phone in the server log");
  assert(!buffer.includes(DESTINATION_HASH()), "no destination hash in the server log (nor its pre-image)");
  assert(!/syntax error|SQLSTATE|ECONN|at or near/i.test(buffer), "no raw database error text in the server log");
});

check("28. on a HEALTHY ledger, NEITHER emit fires", async () => {
  for (const over of [
    { sendResult: ok(message({ status: "accepted" })) },
    { sendResult: ok(message({ status: "outcome_unknown" })) },
    definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }),
  ]) {
    const { r, deps } = await run({ ...over, claimPrimaryAttempt: healthyClaim() });
    assert(r.ledgerUnavailable === false, "the ledger was available");
    assert(deps.calls.serverLogs.length === 0, "no server log on a healthy ledger");
    assert(deps.calls.securityEvents.length === 0, "no security event on a healthy ledger");
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

tsMutation("MUT A: an unknown_outcome primary is allowed to fall back",
  [[ORCHESTRATOR_SRC,
    '  if (outcome.certainty !== "definitive_failure") {\n    return result(hookKind, base);\n  }',
    '  if (outcome.certainty === "accepted") {\n    return result(hookKind, base);\n  }']],
  async (mm) => {
    // A non-local failure code, so nothing but the certainty guard can stop the fallback.
    const deps = makeDeps({ sendResult: ok(message({ status: "outcome_unknown", failure_code: NETWORK_FAILURE_CODE })), decision: ALLOWED_DECISION, gate: READY_GATE() });
    const r = await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    return r.smsSent === true || deps.calls.decisions.length > 0;
  });

tsMutation("MUT B: an accepted primary is allowed to fall back",
  [[ORCHESTRATOR_SRC,
    '  if (outcome.certainty !== "definitive_failure") {\n    return result(hookKind, base);\n  }',
    '  if (outcome.certainty === "unknown_outcome") {\n    return result(hookKind, base);\n  }']],
  async (mm) => {
    const deps = makeDeps({ sendResult: ok(message({ status: "accepted", failure_code: NETWORK_FAILURE_CODE })), decision: ALLOWED_DECISION, gate: READY_GATE() });
    const r = await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    return r.smsSent === true;
  });

tsMutation("MUT C: a blocked fallback decision is ignored",
  [[ORCHESTRATOR_SRC,
    "  if (!allowed.allowed) return blocked(allowed.reason);",
    "  if (false) return blocked(allowed.reason);"]],
  async (mm) => {
    const deps = makeDeps(definitiveFailureOver({ decision: blockedDecision("POLICY_DISABLED"), gate: READY_GATE() }));
    const r = await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    // Proceeding past a BLOCKED decision at all is the violation: a blocked decision must
    // never reach the SMS runtime gate, let alone a claim or a send.
    return r.smsSent === true || deps.calls.fallbackClaims.length > 0 || deps.calls.gates.length > 0;
  });

tsMutation("MUT D: the SMS runtime gate is not consulted",
  [[ORCHESTRATOR_SRC,
    "  if (gate.status !== SMS_RUNTIME_READY) {\n    return blocked(OrchestratorFallbackBlockReason.SMS_RUNTIME_BLOCKED);\n  }",
    "  if (false) {\n    return blocked(OrchestratorFallbackBlockReason.SMS_RUNTIME_BLOCKED);\n  }"]],
  async (mm) => {
    const deps = makeDeps(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: BLOCKED_GATE_WITH_MAPPING() }));
    const r = await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    return r.smsSent === true || deps.calls.fallbackClaims.length > 0;
  });

tsMutation("MUT E: the provider identity fence is removed",
  [[ORCHESTRATOR_SRC,
    '  if (smsProvider.providerKey !== allowedProviderKey || smsProvider.channel !== "sms") {',
    "  if (false) {"]],
  async (mm) => {
    const impostor = { providerKey: "msg91_sms", channel: "sms", sendAuthenticationMessage: async () => ({ accepted: true, outcomeCertainty: "accepted", errorCode: null, provider: "msg91_sms", channel: "sms", providerMessageId: "x", normalizedStatus: "accepted", errorMessage: null, retryable: false }) };
    const deps = makeDeps(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE(), smsProvider: impostor }));
    const r = await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    return r.smsSent === true;
  });

tsMutation("MUT F: the budget check is skipped and an SMS is started with no time left",
  [[ORCHESTRATOR_SRC,
    "  if (!isViableAuthNetworkBudget(remainingMs)) {\n    return blocked(OrchestratorFallbackBlockReason.BUDGET_EXHAUSTED);\n  }",
    "  if (false) {\n    return blocked(OrchestratorFallbackBlockReason.BUDGET_EXHAUSTED);\n  }"]],
  async (mm) => {
    const deps = makeDeps(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }));
    const r = await mm.Orchestrator.deliverClientLoginOtp(baseInput({ deadline: fakeDeadline(0) }), deps);
    return r.smsSent === true;
  });

tsMutation("MUT G: SMS is sent even though the fallback claim was rejected",
  [[ORCHESTRATOR_SRC,
    '  if (!fallbackClaim.ok || fallbackClaim.data.outcome !== AuthAttemptClaimOutcome.CLAIMED) {\n    return blocked(OrchestratorFallbackBlockReason.FALLBACK_CLAIM_REJECTED);\n  }',
    "  if (false) {\n    return blocked(OrchestratorFallbackBlockReason.FALLBACK_CLAIM_REJECTED);\n  }"]],
  async (mm) => {
    // ALREADY_EXISTS is the dangerous rejection: the RPC returns the EXISTING attempt id, so
    // dropping the outcome check sends a duplicate OTP on a replay. The attempt-id guard
    // alone cannot save it.
    const deps = makeDeps(definitiveFailureOver({
      decision: ALLOWED_DECISION, gate: READY_GATE(),
      claimFallbackAttempt: async () => ok({ outcome: "ALREADY_EXISTS", attemptId: "attempt-2", detail: null, attemptNumber: 2, channel: "sms", fallbackFromAttemptId: "attempt-1" }),
    }));
    const r = await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    return deps.calls.smsSends.length > 0;
  });

tsMutation("MUT H: a local/preflight failure becomes fallback-eligible",
  [[ORCHESTRATOR_SRC,
    "  if (isLocalPreflightFailureCode(failureCode)) {",
    "  if (false) {"]],
  async (mm) => {
    const deps = makeDeps({
      sendResult: ok(message({ status: "failed", failure_code: "META_OUTBOUND_CONFIG_MISSING" })),
      decision: ALLOWED_DECISION, gate: READY_GATE(),
    });
    const r = await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    return r.smsSent === true;
  });

tsMutation("MUT H2: the deny-list forgets the spent-budget code",
  [[MAPPING_SRC,
    "export function isLocalPreflightFailureCode(code: string | null | undefined): boolean {\n  const safe = safeFailureCode(code);\n  if (safe === null) return true;",
    "export function isLocalPreflightFailureCode(code: string | null | undefined): boolean {\n  const safe = safeFailureCode(code);\n  if (safe === null) return false;"]],
  (mm) => mm.Mapping.isLocalPreflightFailureCode(null) === false);

tsMutation("MUT I: an unrecognised message status is treated as a proven failure",
  [[MAPPING_SRC,
    '    default:\n      // queued / dispatching / retry_scheduled / anything new. Never a proven failure.\n      return { status: "dispatching", certainty: "unknown_outcome" };',
    '    default:\n      return { status: "failed", certainty: "definitive_failure" };']],
  (mm) => mm.Mapping.mapMessageStatusToAttemptOutcome("queued").certainty === "definitive_failure");

tsMutation("MUT J: outcome_unknown is recorded as a definitive failure",
  [[MAPPING_SRC,
    '    case "outcome_unknown":\n      return { status: "outcome_unknown", certainty: "unknown_outcome" };',
    '    case "outcome_unknown":\n      return { status: "failed", certainty: "definitive_failure" };']],
  (mm) => mm.Mapping.mapMessageStatusToAttemptOutcome("outcome_unknown").certainty === "definitive_failure");

tsMutation("MUT K: a raw provider payload passes the ledger-safe failure-code filter",
  [[MAPPING_SRC,
    "export function safeFailureCode(value: unknown): string | null {\n  return typeof value === \"string\" && SAFE_FAILURE_CODE.test(value) ? value : null;\n}",
    "export function safeFailureCode(value: unknown): string | null {\n  return typeof value === \"string\" ? value : null;\n}"]],
  (mm) => mm.Mapping.safeFailureCode(`otp ${OTP} phone ${PHONE}`) !== null);

tsMutation("MUT L: the plaintext phone is sent to the ledger instead of its hash",
  [[ORCHESTRATOR_SRC,
    "  const destinationHash = hashPhoneE164(input.phoneE164);",
    "  const destinationHash = input.phoneE164;"]],
  async (mm) => {
    const deps = makeDeps({ sendResult: ok(message()) });
    await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    return safeStringify(deps.calls.primaryClaims).includes(PHONE);
  });

tsMutation("MUT M: the raw verified webhook id is used as the action identity",
  [[ORCHESTRATOR_SRC,
    "    authActionId = deriveClientLoginActionId(input.verifiedWebhookId);",
    "    authActionId = input.verifiedWebhookId as AuthenticationActionId;"]],
  async (mm) => {
    const deps = makeDeps({ sendResult: ok(message()) });
    await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    return safeStringify(deps.calls.primaryClaims).includes(WEBHOOK_ID);
  });

tsMutation("MUT N: a fresh OTP is generated for the fallback attempt",
  [[ORCHESTRATOR_SRC,
    "    { otp: input.otp },",
    '    { otp: String(Number(input.otp) + 1) },']],
  async (mm) => {
    const deps = makeDeps(definitiveFailureOver({ decision: ALLOWED_DECISION, gate: READY_GATE() }));
    await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    return deps.calls.smsSends.length > 0 && deps.calls.smsSends[0].variables.otp !== OTP;
  });

tsMutation("MUT O: a structural primary-claim refusal still dispatches the OTP",
  [[ORCHESTRATOR_SRC,
    "  if (!primaryClaimPermitsDispatch(claimOutcome)) {\n    return result(ClientOtpDeliveryKind.DELIVERY_FAILED);\n  }",
    "  if (false) {\n    return result(ClientOtpDeliveryKind.DELIVERY_FAILED);\n  }"]],
  async (mm) => {
    const deps = makeDeps({
      claimPrimaryAttempt: async () => ok({ outcome: "ATTEMPT_LIMIT_REACHED", attemptId: null, detail: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null }),
      sendResult: ok(message()),
    });
    await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    return deps.calls.sends.length > 0;
  });

tsMutation("MUT P: a fallback is anchored on a synthesized attempt when the ledger is unavailable",
  [[ORCHESTRATOR_SRC,
    "  if (ledgerUnavailable || !primaryAttemptId) {",
    "  if (false) {"]],
  async (mm) => {
    const deps = makeDeps(definitiveFailureOver({
      claimPrimaryAttempt: async () => ok({ outcome: "DATABASE_ERROR", attemptId: null, detail: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null }),
      decision: ALLOWED_DECISION, gate: READY_GATE(),
    }));
    const r = await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    return r.smsSent === true || deps.calls.decisions.length > 0;
  });

srcMutation("MUT Q: a retry loop is introduced into the orchestrator",
  ORCHESTRATOR_SRC,
  "  // 17 — finalize attempt 2.",
  "  for (let i = 0; i < 2; i++) { await smsProvider.sendAuthenticationMessage(input.phoneE164, gate.mapping.templateKey, { otp: input.otp }); }\n  // 17 — finalize attempt 2.",
  () => /\bfor\s*\(/.test(readCode(ORCHESTRATOR_SRC)));

srcMutation("MUT R: the orchestrator logs the OTP",
  ORCHESTRATOR_SRC,
  "  const destinationHash = hashPhoneE164(input.phoneE164);",
  "  console.log(\"otp\", input.otp);\n  const destinationHash = hashPhoneE164(input.phoneE164);",
  () => /console\./.test(readCode(ORCHESTRATOR_SRC)));

srcMutation("MUT S: the factory constructs the mock SMS adapter in production code",
  FACTORY_SRC,
  "  // A mock candidate, or any candidate this factory does not know, resolves no adapter.",
  "  if (candidate.isMock) return new MockSmsProvider();\n  // A mock candidate, or any candidate this factory does not know, resolves no adapter.",
  () => /MockSmsProvider/.test(readCode(FACTORY_SRC)));

// ---- Phase 5F-C3-B correction: observability + healthy-DB proof -------------
tsMutation("MUT T: the degraded ledger path is silent — no security event is emitted",
  [[ORCHESTRATOR_SRC,
    "  if (ledgerUnavailable) {\n    await emitLedgerUnavailable(deps, input, destinationHash, claimResult);\n  }",
    "  if (false) {\n    await emitLedgerUnavailable(deps, input, destinationHash, claimResult);\n  }"]],
  async (mm) => {
    const deps = makeDeps({
      claimPrimaryAttempt: async () => ok({ outcome: "DATABASE_ERROR", detail: null, attemptId: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null }),
      sendResult: ok(message({ status: "accepted" })),
    });
    const r = await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    // The degraded path went silent: ledger unavailable, yet no event was emitted.
    return r.ledgerUnavailable === true && deps.calls.securityEvents.length === 0;
  });

tsMutation("MUT U: a thrown security-event write is allowed to abort the login",
  [[ORCHESTRATOR_SRC,
    "  } catch {\n    // Observability is advisory. A failure here must never deny a login.\n  }",
    "  } catch {\n    throw new Error(\"rethrow\");\n  }"]],
  async (mm) => {
    const deps = makeDeps({
      claimPrimaryAttempt: async () => ok({ outcome: "DATABASE_ERROR", detail: null, attemptId: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null }),
      sendResult: ok(message({ status: "accepted" })),
      securityEventThrows: true,
    });
    // With the try removed, the throw escapes deliverClientLoginOtp and rejects.
    try {
      await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
      return false;
    } catch {
      return true; // the observability throw took down the login — the guard was load-bearing
    }
  });

tsMutation("MUT V: a raw claim detail is written to the event instead of a sanitized code",
  [[ORCHESTRATOR_SRC,
    "  const failureClassification = safeFailureCode(claimResult?.detail) ?? LEDGER_UNAVAILABLE_REASON;",
    "  const failureClassification = (claimResult?.detail as string) ?? LEDGER_UNAVAILABLE_REASON;"]],
  async (mm) => {
    const deps = makeDeps({
      claimPrimaryAttempt: async () => ok({ outcome: "DATABASE_ERROR", detail: "syntax error at or near \"$1\"", attemptId: null, attemptNumber: null, channel: null, fallbackFromAttemptId: null }),
      sendResult: ok(message({ status: "accepted" })),
    });
    await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    const ev = deps.calls.securityEvents[0];
    return ev && ev.failureClassification.includes("syntax error");
  });

tsMutation("MUT W: the emit fires even when the ledger was AVAILABLE (healthy DB)",
  [[ORCHESTRATOR_SRC,
    "  if (ledgerUnavailable) {\n    await emitLedgerUnavailable(deps, input, destinationHash, claimResult);\n  }",
    "  if (true) {\n    await emitLedgerUnavailable(deps, input, destinationHash, claimResult);\n  }"]],
  async (mm) => {
    const deps = makeDeps({ sendResult: ok(message({ status: "accepted" })), claimPrimaryAttempt: healthyClaim() });
    const r = await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    // A healthy DB must never emit a ledger_unavailable event.
    return r.ledgerUnavailable === false && deps.calls.securityEvents.length > 0;
  });

// ---- Phase 5F-C3-B second correction: DB-independent server log ------------
tsMutation("MUT X: the degraded path is silent — the DB-independent server log is removed",
  [[ORCHESTRATOR_SRC,
    "    deps.logLedgerUnavailable({\n      authFlow: ORCHESTRATED_AUTH_FLOW,",
    "    void ({\n      authFlow: ORCHESTRATED_AUTH_FLOW,"]],
  async (mm) => {
    const deps = makeDeps({
      sendResult: ok(message({ status: "accepted" })),
      claimPrimaryAttempt: DB_OUTAGE_CLAIM("connection_reset"),
      securityEventThrows: true, // the DB write also fails, as in a real outage
    });
    const r = await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
    // A full outage produced NO surviving signal at all.
    return r.ledgerUnavailable === true && deps.calls.serverLogs.length === 0;
  });

tsMutation("MUT Y: a throwing server log is allowed to abort the login",
  [[ORCHESTRATOR_SRC,
    "  } catch {\n    // Logging must never deny a login.\n  }",
    "  } catch {\n    throw new Error(\"log-rethrow\");\n  }"]],
  async (mm) => {
    const deps = makeDeps({
      sendResult: ok(message({ status: "accepted" })),
      claimPrimaryAttempt: DB_OUTAGE_CLAIM(),
      serverLogThrows: true,
    });
    try {
      await mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps);
      return false;
    } catch {
      return true; // the log throw took down the login — the guard was load-bearing
    }
  });

tsMutation("MUT Z: a raw claim detail leaks into the server log line",
  [[ORCHESTRATOR_SRC,
    "  const failureClassification = safeFailureCode(claimResult?.detail) ?? LEDGER_UNAVAILABLE_REASON;",
    "  const failureClassification = (claimResult?.detail as string) ?? LEDGER_UNAVAILABLE_REASON;"]],
  async (mm) => {
    const defaultLog = mm.Orchestrator.defaultClientOtpDeliveryDeps().logLedgerUnavailable;
    const deps = makeDeps({
      sendResult: ok(message({ status: "accepted" })),
      claimPrimaryAttempt: DB_OUTAGE_CLAIM(`syntax error at or near "$1"`),
      logLedgerUnavailable: defaultLog,
    });
    const { buffer } = await captureConsole(() => mm.Orchestrator.deliverClientLoginOtp(baseInput(), deps));
    return /syntax error|at or near/i.test(buffer);
  });

// ============================================================================
// RUNNER
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-C3-B client OTP ledger + fallback checks...\n");
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
  console.log("\nRunning Phase 5F-C3-B mutation tests...\n");
  for (const mut of mutationChecks) {
    const mutDir = resolve(`.phase5fc3b-mut-${mutationChecks.indexOf(mut)}`);
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
        try { compileTo(mutDir); transpileOrchestrator(mutDir); } catch { console.log(`PASS ${mut.name} (rejected at compile time)`); passed++; continue; }
        mm = wireBuild(mutDir);
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
