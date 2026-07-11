import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5F-C3-C-2 — isolated SMS provider CANARY READINESS + HEALTH PROBE harness.
 *
 * Proves the readiness probe with NO database, NO network, NO real provider and NO real
 * credential, and while everything ships operationally DISABLED. The probe SENDS NOTHING: it
 * evaluates the existing SMS runtime gate, requires exactly `canary` activation, fences the
 * provider identity three ways, honours the runtime policy's health-check toggle, demands a
 * fully healthy provider, and proves the exact mapping resolves through the reviewed content
 * boundary — then STOPS. Every collaborator is injected; the real gate and the real renderer
 * are exercised where it strengthens the proof.
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
  "lib/communication/providers/smsProvider.ts",
  "lib/communication/providers/smsRuntimeGate.ts",
  "lib/communication/authSmsBodyRenderer.ts",
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

const CANARY_SRC = "services/smsProviderCanaryProbeService.ts";
const RENDERER_SRC = "lib/communication/authSmsBodyRenderer.ts";
const GATE_SRC = "lib/communication/providers/smsRuntimeGate.ts";
const DOC_C3C2 = "docs/QF-SMS-Provider-Canary-Readiness-Probe-Phase-5F-C3-C-2.md";

/** Transpile the canary service ALONE; its service graph is satisfied by require() stubs. */
function transpileCanary(outDir) {
  const tsconfigPath = resolve(`${outDir}.canary.tsconfig.json`);
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          module: "commonjs", target: "ES2020", moduleResolution: "node",
          skipLibCheck: true, esModuleInterop: true, strict: false, isolatedModules: true,
          outDir, rootDir: ".", types: [], noResolve: true,
        },
        files: [CANARY_SRC],
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
  if (!existsSync(resolve(outDir, "services/smsProviderCanaryProbeService.js"))) {
    throw new Error("the canary service did not transpile");
  }
}

/** Stub the canary's service-layer imports. It never calls them (deps are injected). */
function stubServiceModules(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const original = Module._load;
  const STUBS = {
    "./smsProviderRuntimeService": {
      evaluateSmsRuntimeReadiness: () => { throw new Error("real gate read must never run"); },
      readSmsRuntimePolicy: () => { throw new Error("real policy read must never run"); },
    },
    "./runtimeSmsProviderService": {
      createRuntimeSmsProvider: () => { throw new Error("real provider construction must never run"); },
    },
    "./runtimeSmsAdapterFactory": {
      runtimeSmsAdapterFactory: () => { throw new Error("real adapter factory must never run"); },
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
    Canary: req("./services/smsProviderCanaryProbeService.js"),
    Renderer: req("./lib/communication/authSmsBodyRenderer.js"),
    Gate: req("./lib/communication/providers/smsRuntimeGate.js"),
    Phone: req("./lib/communication/phone.js"),
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

const MAIN_DIR = resolve(".phase5fc3c2-build-main");
compileTo(MAIN_DIR);
transpileCanary(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// FIXTURES
// ============================================================================
const PROVIDER = "exotel_sms";
const FOUNDER_PHONE = "+919812345678";
const TEMPLATE = "client_login_otp";
const LANGUAGE = "en";
const SYNTH_CODE = "482913";
const PROVIDER_TEMPLATE_NAME = "QF_CLIENT_LOGIN_OTP_DLT";
const PROVIDER_TEMPLATE_ID = "9876543210987654321";
const HASH = () => M.Phone.hashPhoneE164(FOUNDER_PHONE);

const ok = (data) => ({ ok: true, data });
const failResult = (code) => ({ ok: false, code, error: "x" });

const mapping = (over = {}) => ({
  mappingId: "m1", templateKey: TEMPLATE, providerKey: PROVIDER, channel: "sms", language: LANGUAGE,
  providerTemplateName: PROVIDER_TEMPLATE_NAME, providerTemplateId: PROVIDER_TEMPLATE_ID,
  providerCategory: "authentication", ...over,
});
const readyDecision = (over = {}) => ({ status: "SMS_RUNTIME_READY", providerKey: PROVIDER, channel: "sms", activation: "canary", mapping: mapping(over.mapping), ...(over.decision ?? {}) });
const health = (over = {}) => ({ provider: PROVIDER, channel: "sms", configured: true, reachable: true, status: "healthy", checkedAt: new Date(0).toISOString(), latencyMs: 1, detailsSanitized: {}, ...over });

function makeDeps(over = {}) {
  const calls = { readiness: [], policies: [], factories: [], healthChecks: [], renders: [], sends: [] };
  const adapter = over.adapter ?? {
    providerKey: over.adapterProviderKey ?? PROVIDER,
    channel: over.adapterChannel ?? "sms",
    async healthCheck() {
      calls.healthChecks.push(1);
      if (over.healthThrows) throw new Error(`raw provider boom token=${SECRET} phone=${FOUNDER_PHONE}`);
      return over.health ?? health();
    },
    async sendResolvedAuthenticationSms() { calls.sends.push("resolved"); throw new Error("canary must not send"); },
    async sendAuthenticationMessage() { calls.sends.push("bare"); throw new Error("canary must not send"); },
  };
  const deps = {
    calls,
    evaluateSmsRuntimeReadiness: over.evaluateSmsRuntimeReadiness ?? (async (q) => { calls.readiness.push(q); return over.decision ?? readyDecision(); }),
    readSmsRuntimePolicy: over.readSmsRuntimePolicy ?? (async (pk) => { calls.policies.push(pk); return ("policy" in over) ? over.policy : { provider_key: PROVIDER, channel: "sms", activation_status: "canary", outbound_enabled: true, health_check_enabled: true }; }),
    createRuntimeSmsProvider: over.createRuntimeSmsProvider ?? ((factory, env) => { calls.factories.push({ factory, env }); return over.providerResult ?? ok(adapter); }),
    resolveAuthenticationSmsContent: over.resolveAuthenticationSmsContent ?? ((inp) => { calls.renders.push(inp); return over.renderResult ?? M.Renderer.resolveAuthenticationSmsContent(inp); }),
  };
  return deps;
}
const SECRET = "SUPERSECRETtoken";

function baseInput(over = {}) {
  return { providerKey: PROVIDER, founderPhoneE164: FOUNDER_PHONE, reviewedTemplateKey: TEMPLATE, language: LANGUAGE, syntheticCanaryCode: SYNTH_CODE, ...over };
}
const run = (over = {}, inputOver = {}) => {
  const deps = makeDeps(over);
  return M.Canary.probeSmsProviderCanaryReadiness(baseInput(inputOver), deps).then((r) => ({ r, deps }));
};

/** Deps whose readiness dep projects fixture rows through the REAL C2 gate. */
function gateBackedDeps(rows, over = {}) {
  return makeDeps({
    ...over,
    evaluateSmsRuntimeReadiness: async (q) => {
      over.calls?.readiness?.push?.(q);
      return M.Gate.evaluateSmsRuntimeGate({
        providerKey: q.providerKey, channel: q.channel, templateKey: q.templateKey, language: q.language,
        destinationHash: q.destinationHash, policy: rows.policy, accounts: rows.accounts, mappings: rows.mappings,
        canaryRows: rows.canaryRows, now: rows.now ?? Date.now(),
      });
    },
    readSmsRuntimePolicy: async () => rows.policy,
  });
}
const READY_ROWS = () => ({
  policy: { provider_key: PROVIDER, channel: "sms", activation_status: "canary", outbound_enabled: true, health_check_enabled: true },
  accounts: [{ provider_key: PROVIDER, channel: "sms", readiness_status: "provider_ready", configuration_status: "complete", health_status: "healthy" }],
  mappings: [{ id: "m1", template_key: TEMPLATE, channel: "sms", provider_key: PROVIDER, language: LANGUAGE, provider_template_name: PROVIDER_TEMPLATE_NAME, provider_template_id: PROVIDER_TEMPLATE_ID, provider_category: "authentication", approval_status: "approved", is_active: true }],
  canaryRows: [{ provider_key: PROVIDER, channel: "sms", destination_hash: HASH(), is_active: true, expires_at: null }],
});

async function captureConsole(fn) {
  const methods = ["log", "error", "warn", "info", "debug", "trace"];
  const original = {};
  let buffer = "";
  for (const m of methods) { original[m] = console[m]; console[m] = (...a) => { buffer += a.map((x) => (typeof x === "string" ? x : safeStringify(x))).join(" ") + "\n"; }; }
  try { const value = await fn(); return { value, buffer }; }
  finally { for (const m of methods) console[m] = original[m]; }
}
function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }
const BLOCKED = "SMS_CANARY_PROBE_BLOCKED";
const READY = "SMS_CANARY_PROBE_READY";

// ============================================================================
// INPUT + SECRECY (1-10)
// ============================================================================
check("1. invalid phone / missing fields fail closed with no downstream call", async () => {
  for (const inputOver of [
    { founderPhoneE164: "9812345678" },       // no country code
    { founderPhoneE164: "+91 981" },          // too short
    { founderPhoneE164: "not-a-phone" },
    { founderPhoneE164: "" },
    { providerKey: "" }, { reviewedTemplateKey: "" }, { language: "" },
  ]) {
    const { r, deps } = await run({}, inputOver);
    assert(r.status === BLOCKED && r.reason === "INVALID_INPUT", `${JSON.stringify(inputOver)} → ${r.reason}`);
    assert(deps.calls.readiness.length === 0, "no readiness query on invalid input");
    assert(deps.calls.healthChecks.length === 0 && deps.calls.sends.length === 0, "no health/send");
  }
});

check("2. a malformed synthetic test code fails closed", async () => {
  for (const code of ["", "abc", "12", "12345678901", "48 913", null, undefined, 482913]) {
    const { r, deps } = await run({}, { syntheticCanaryCode: code });
    assert(r.status === BLOCKED && r.reason === "INVALID_INPUT", `code=${JSON.stringify(code)} → ${r.reason}`);
    assert(deps.calls.readiness.length === 0, "no readiness query");
  }
});

check("3-5. only the destination HASH enters the readiness query; phone and code never do", async () => {
  const { deps } = await run();
  const q = deps.calls.readiness[0];
  assert(q.destinationHash === HASH() && /^[0-9a-f]{64}$/.test(q.destinationHash), "the query carries a sha256 hash"); // (4)
  const rendered = safeStringify(q);
  assert(!rendered.includes(FOUNDER_PHONE), "the plaintext founder phone never enters the readiness query"); // (3)
  assert(!rendered.includes(SYNTH_CODE), "the synthetic code never enters the readiness query"); // (5)
});

check("6-10. no phone / code / body reaches the result, a log, the policy read, or persistence", async () => {
  const { value, buffer } = await captureConsole(async () => {
    const out = [];
    for (const over of [{}, { decision: { status: "SMS_RUNTIME_BLOCKED", reason: "RUNTIME_POLICY_MISSING" } }, { health: health({ status: "unhealthy" }) }]) out.push(await run(over));
    return out;
  });
  assert(buffer === "", "the probe logs nothing at all"); // (9)
  for (const { r, deps } of value) {
    const rr = safeStringify(r);
    assert(!rr.includes(FOUNDER_PHONE), "phone absent from result"); // (6)
    assert(!rr.includes(SYNTH_CODE), "synthetic code absent from result"); // (7)
    assert(!rr.includes("verification code") && !rr.includes(PROVIDER_TEMPLATE_NAME), "no rendered body / template name in result"); // (8)
    for (const p of deps.calls.policies) assert(!String(p).includes(FOUNDER_PHONE) && !String(p).includes(SYNTH_CODE), "policy read keyed only by provider key");
  }
  // (10) The service persists nothing: no db client, no insert/update in the source.
  const src = readCode(CANARY_SRC);
  assert(!/adminClient|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(src), "the probe performs no DB writes/mutations");
});

// ============================================================================
// RUNTIME GATE (11-18) — via the REAL C2 gate
// ============================================================================
check("11. a runtime-blocked gate → probe blocked (RUNTIME_NOT_READY)", async () => {
  const rows = READY_ROWS(); rows.policy = null; // RUNTIME_POLICY_MISSING
  const deps = gateBackedDeps(rows);
  const r = await M.Canary.probeSmsProviderCanaryReadiness(baseInput(), deps);
  assert(r.status === BLOCKED && r.reason === "RUNTIME_NOT_READY", `got ${r.reason}`);
  assert(deps.calls.healthChecks.length === 0, "no health check");
});

check("12-16. gate blocks (not allowlisted / inactive / expired / provider / channel) → RUNTIME_NOT_READY", async () => {
  const cases = {
    "not allowlisted": (r) => { r.canaryRows = []; },
    "inactive canary row": (r) => { r.canaryRows = [{ ...r.canaryRows[0], is_active: false }]; },
    "expired canary row": (r) => { r.canaryRows = [{ ...r.canaryRows[0], expires_at: new Date(Date.now() - 60000).toISOString() }]; },
    "provider mismatch": (r) => { r.policy = { ...r.policy, provider_key: "other_sms" }; },
    "channel mismatch": (r) => { r.accounts = [{ ...r.accounts[0], channel: "whatsapp" }]; },
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const rows = READY_ROWS(); mutate(rows);
    const r = await M.Canary.probeSmsProviderCanaryReadiness(baseInput(), gateBackedDeps(rows));
    assert(r.status === BLOCKED && r.reason === "RUNTIME_NOT_READY", `${label} → ${r.reason}`);
  }
});

check("17. READY but activation=active → canary probe STILL blocked (ACTIVATION_NOT_CANARY)", async () => {
  const rows = READY_ROWS();
  rows.policy = { ...rows.policy, activation_status: "active" };
  rows.canaryRows = []; // active needs no canary row
  const deps = gateBackedDeps(rows);
  const r = await M.Canary.probeSmsProviderCanaryReadiness(baseInput(), deps);
  assert(r.status === BLOCKED && r.reason === "ACTIVATION_NOT_CANARY", `got ${r.reason}`);
  assert(deps.calls.healthChecks.length === 0, "no health check under a refused activation");
});

check("18. READY with activation=canary (real gate) → probe continues to READY", async () => {
  const r = await M.Canary.probeSmsProviderCanaryReadiness(baseInput(), gateBackedDeps(READY_ROWS()));
  assert(r.status === READY && r.readiness === "READY_FOR_CONTROLLED_CANARY", `got ${r.status}/${r.reason}`);
  assert(r.activation === "canary" && r.providerKey === PROVIDER, "canary activation + provider carried");
});

// ============================================================================
// PROVIDER IDENTITY (19-23)
// ============================================================================
check("19. runtime provider factory failure / throw → PROVIDER_UNAVAILABLE", async () => {
  const a = await run({ providerResult: failResult("SMS_PROVIDER_NOT_CONFIGURED") });
  assert(a.r.reason === "PROVIDER_UNAVAILABLE", `!ok → ${a.r.reason}`);
  const b = await run({ createRuntimeSmsProvider: () => { throw new Error("boom"); } });
  assert(b.r.reason === "PROVIDER_UNAVAILABLE", `throw → ${b.r.reason}`);
  assert(a.deps.calls.healthChecks.length === 0 && b.deps.calls.healthChecks.length === 0, "no health check");
});

check("20-21. adapter provider / channel mismatch → PROVIDER_IDENTITY_MISMATCH (before health)", async () => {
  const key = await run({ adapterProviderKey: "msg91_sms" });
  assert(key.r.reason === "PROVIDER_IDENTITY_MISMATCH", `key → ${key.r.reason}`);
  const chan = await run({ adapterChannel: "whatsapp" });
  assert(chan.r.reason === "PROVIDER_IDENTITY_MISMATCH", `channel → ${chan.r.reason}`);
  assert(key.deps.calls.healthChecks.length === 0 && chan.deps.calls.healthChecks.length === 0, "fenced before health");
});

check("22-23. exact provider identity continues; a mock can never silently substitute", async () => {
  const { r } = await run();
  assert(r.status === READY, `exact identity → ${r.status}`);
  // A mock adapter (providerKey mock_sms) against a live decision (exotel_sms) is refused.
  const sub = await run({ adapterProviderKey: "mock_sms" });
  assert(sub.r.reason === "PROVIDER_IDENTITY_MISMATCH", `mock substitution → ${sub.r.reason}`);
  // The probe never imports the mock adapter or names a provider literal.
  const src = readCode(CANARY_SRC);
  assert(!/MockSmsProvider|mock_sms|exotel|meta_whatsapp|msg91/i.test(src), "the probe names no provider literal / mock");
});

// ============================================================================
// HEALTH (24-33)
// ============================================================================
check("24. health-check-disabled → no health call, HEALTH_CHECK_DISABLED", async () => {
  for (const policy of [
    { provider_key: PROVIDER, channel: "sms", activation_status: "canary", outbound_enabled: true, health_check_enabled: false },
    null,
  ]) {
    const { r, deps } = await run({ policy });
    assert(r.reason === "HEALTH_CHECK_DISABLED", `policy=${JSON.stringify(policy)} → ${r.reason}`);
    assert(deps.calls.healthChecks.length === 0, "the health check never ran");
  }
});

check("25. healthCheck runs EXACTLY once on the eligible path", async () => {
  const { r, deps } = await run();
  assert(r.status === READY, `eligible → ${r.status}`);
  assert(deps.calls.healthChecks.length === 1, `exactly one health call, got ${deps.calls.healthChecks.length}`);
});

check("26-27. health provider / channel mismatch → HEALTH_IDENTITY_MISMATCH", async () => {
  const p = await run({ health: health({ provider: "msg91_sms" }) });
  assert(p.r.reason === "HEALTH_IDENTITY_MISMATCH", `provider → ${p.r.reason}`);
  const c = await run({ health: health({ channel: "whatsapp" }) });
  assert(c.r.reason === "HEALTH_IDENTITY_MISMATCH", `channel → ${c.r.reason}`);
});

check("28-31. configured/reachable/healthy required; the exact healthy result continues", async () => {
  assert((await run({ health: health({ configured: false }) })).r.reason === "PROVIDER_UNHEALTHY", "configured false");
  assert((await run({ health: health({ reachable: false }) })).r.reason === "PROVIDER_UNHEALTHY", "reachable false");
  assert((await run({ health: health({ status: "degraded" }) })).r.reason === "PROVIDER_UNHEALTHY", "degraded");
  assert((await run({ health: health({ status: "unhealthy" }) })).r.reason === "PROVIDER_UNHEALTHY", "unhealthy");
  assert((await run()).r.status === READY, "exact healthy → continue");
});

check("32-33. a thrown health check → sanitized HEALTH_CHECK_FAILED; no raw error leaks", async () => {
  const { value, buffer } = await captureConsole(() => run({ healthThrows: true }));
  const { r, deps } = value;
  assert(r.reason === "HEALTH_CHECK_FAILED", `got ${r.reason}`);
  assert(deps.calls.healthChecks.length === 1, "the throwing check was attempted once");
  const rr = safeStringify(r);
  assert(!rr.includes(SECRET) && !rr.includes(FOUNDER_PHONE) && !/boom/i.test(rr), "no raw provider error text / secret / phone in result");
  assert(buffer === "", "nothing logged");
});

// ============================================================================
// CONTENT READINESS (34-40)
// ============================================================================
check("34. an injected renderer failure → RESOLVED_CONTENT_UNAVAILABLE", async () => {
  const { r } = await run({ renderResult: { ok: false, code: "AUTH_SMS_OTP_INVALID" } });
  assert(r.reason === "RESOLVED_CONTENT_UNAVAILABLE", `got ${r.reason}`);
});

check("35-37. real renderer: missing template id / identity mismatch / wrong category → blocked", async () => {
  const missId = await run({ decision: readyDecision({ mapping: { providerTemplateId: null } }) });
  assert(missId.r.reason === "RESOLVED_CONTENT_UNAVAILABLE", `missing id → ${missId.r.reason}`);
  const mism = await run({ decision: readyDecision({ mapping: { templateKey: "some_other_template" } }) });
  assert(mism.r.reason === "RESOLVED_CONTENT_UNAVAILABLE", `identity mismatch → ${mism.r.reason}`);
  const cat = await run({ decision: readyDecision({ mapping: { providerCategory: "marketing" } }) });
  assert(cat.r.reason === "RESOLVED_CONTENT_UNAVAILABLE", `wrong category → ${cat.r.reason}`);
});

check("38-40. a valid exact mapping → READY; the body and synthetic code remain internal", async () => {
  const { r, deps } = await run();
  assert(r.status === READY && r.readiness === "READY_FOR_CONTROLLED_CANARY" && r.contentResolved === true, `got ${r.status}`);
  // (39/40) the renderer DID produce a body containing the synthetic code, but it never leaves the stack.
  const rendered = deps.calls.renders[0];
  const produced = M.Renderer.resolveAuthenticationSmsContent(rendered);
  assert(produced.ok && produced.resolved.messageBody.includes(SYNTH_CODE), "the renderer really substituted the synthetic code");
  const rr = safeStringify(r);
  assert(!rr.includes(SYNTH_CODE) && !rr.includes(produced.resolved.messageBody), "neither the code nor the body is in the result");
});

// ============================================================================
// AUTHORITY BOUNDARIES (41-47) — static
// ============================================================================
check("41-47. the probe imports/calls no C1, no auth ledger, no OTP hook, no challenge, no policy mutation", () => {
  const src = readF(CANARY_SRC);
  const code = readCode(CANARY_SRC);
  for (const forbidden of [
    /decideAuthenticationFallback/, /evaluateAuthenticationFallback/,
    /claimPrimaryAttempt/, /claimFallbackAttempt/, /finalizeAttempt/,
    /authentication_delivery_attempts/, /authentication_transport_failure_rules/,
    /verification_challenges/, /supabaseSendSmsHook/, /handleSupabaseSendSmsHook/,
    /generateOtp|createOtp/, /authenticationDeliveryAttemptService/, /authenticationTransportPolicyService/,
  ]) {
    assert(!forbidden.test(src), `the probe must never reference ${forbidden}`);
  }
  // No policy/state mutation verbs at all.
  assert(!/is_operationally_enabled|activation_status\s*=|outbound_enabled\s*=|readiness_status\s*=|configuration_status\s*=/.test(code), "no policy/account activation");
});

// ============================================================================
// NO SEND (48-55) — static + runtime
// ============================================================================
check("48-51. no send call site exists; the injected adapter's send methods are never called", async () => {
  const code = readCode(CANARY_SRC);
  assert(!/sendResolvedAuthenticationSms\s*\(/.test(code), "no resolved send call site");
  assert(!/sendAuthenticationMessage\s*\(/.test(code), "no bare send call site");
  assert(!/\.send\s*\(/.test(code), "no CommunicationService.send call site");
  assert(!/transport\.request|fetch\(|POST/.test(code), "no direct provider transport request");
  // Runtime: across every path, the adapter's send methods are never invoked.
  for (const over of [{}, { health: health({ status: "unhealthy" }) }, { renderResult: { ok: false, code: "X" } }]) {
    const { deps } = await run(over);
    assert(deps.calls.sends.length === 0, "the adapter send methods were never called");
  }
});

check("52-55. no queue, retry loop, scheduler, or n8n", () => {
  const code = readCode(CANARY_SRC);
  assert(!/\bqueue\b|enqueue/i.test(code), "no queue");
  assert(!/\bfor\s*\(|\bwhile\s*\(|Promise\.race/.test(code), "no retry loop / race");
  assert(!/setTimeout|setInterval|cron/i.test(code), "no scheduler");
  assert(!/\bn8n\b/i.test(code), "no n8n");
});

// ============================================================================
// NO ACTIVATION / NO PUBLIC ROUTE (56-64)
// ============================================================================
check("56-64. no DB writes, no migration/SQL/env, no activation, no public route surface", () => {
  const code = readCode(CANARY_SRC);
  assert(!/adminClient|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|from\(["']/.test(code), "the probe writes nothing to the DB");
  // No public invocation surface references a route/handler/action.
  assert(!/NextRequest|NextResponse|export const (GET|POST|PUT|PATCH|DELETE)|use server|app\/api|pages\/api/.test(readF(CANARY_SRC)), "the probe exposes no route/server-action");
  // Git: this phase created/modified no migration, SQL, or env file.
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
  for (const p of dirty) {
    assert(!p.startsWith("supabase/migrations"), `no migration (${p})`);
    assert(!p.endsWith(".sql"), `no SQL (${p})`);
    assert(!/(^|\/)\.env/.test(p), `no env (${p})`);
  }
  // No NEW app route/page file was added by this phase.
  for (const p of dirty) assert(!/^app\/api\/.*\/route\.ts$|^pages\/api\//.test(p), `no public route added (${p})`);
});

check("wiring: the c3c2 script exists, earlier scripts unchanged, the doc is complete and honest", () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:c3c2"] === "node scripts/phase5f-c3c2-sms-canary-readiness-probe-harness.mjs", "c3c2 wired");
  for (const [name, script] of [
    ["test:phase5f:c3c1", "node scripts/phase5f-c3c1-client-otp-resolved-sms-harness.mjs"],
    ["test:phase5f:c3b", "node scripts/phase5f-c3b-client-otp-fallback-harness.mjs"],
  ]) assert(pkg.scripts[name] === script, `${name} unchanged`);
  for (const f of [CANARY_SRC, DOC_C3C2]) assert(existsSync(f), `${f} exists`);
  const doc = readF(DOC_C3C2);
  for (const topic of [
    /isolated/i, /bypass(es)? .*(c1|auth)/i, /runtime safety/i, /destination hash/i, /activation .*canary/i,
    /identity fence/i, /health check/i, /reviewed content/i, /no SMS/i, /no public route/i, /no DB writes/i,
    /allowlist, not a one-shot/i, /one-shot/i, /deferred/i, /C3-C-3A/i, /C3-C-3B/i, /C3-C-3C/i, /C3-D/i,
  ]) assert(topic.test(doc), `doc covers ${topic}`);
  for (const forbidden of [/DLT (is )?approved/i, /Exotel is live/i, /provider is configured/i, /provider is healthy/i, /canary (row )?exists/i, /real canary (was )?sent/i, /SMS fallback is active/i]) {
    assert(!forbidden.test(doc), `doc must not claim ${forbidden}`);
  }
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutationChecks = [];
function tsMutation(name, edits, scenario) { mutationChecks.push({ name, kind: "ts", edits: edits.map(([file, from, to]) => ({ file, from, to })), scenario }); }
function srcMutation(name, file, from, to, scenario) { mutationChecks.push({ name, kind: "src", edits: [{ file, from, to }], scenario }); }

tsMutation("MUT A: the exact canary-activation check is removed",
  [[CANARY_SRC, '  if (decision.activation !== "canary") {', "  if (false) {"]],
  async (mm) => {
    // A fully READY but ACTIVE decision must never satisfy a CANARY probe.
    const deps = makeDeps({ decision: { status: "SMS_RUNTIME_READY", providerKey: PROVIDER, channel: "sms", activation: "active", mapping: mapping() } });
    const r = await mm.Canary.probeSmsProviderCanaryReadiness(baseInput(), deps);
    return r.status === READY; // proceeded to READY under full production activation
  });

tsMutation("MUT B: the adapter provider identity fence is removed",
  [[CANARY_SRC, '  if (adapter.providerKey !== decidedProviderKey || adapter.channel !== SMS_CHANNEL) {', "  if (false) {"]],
  async (mm) => {
    // A WRONG adapter (msg91) whose health lies about its identity must not be silently used.
    const impostor = { providerKey: "msg91_sms", channel: "sms", async healthCheck() { return health({ provider: PROVIDER }); }, async sendResolvedAuthenticationSms() {}, async sendAuthenticationMessage() {} };
    const deps = makeDeps({ adapter: impostor });
    const r = await mm.Canary.probeSmsProviderCanaryReadiness(baseInput(), deps);
    return r.status === READY; // a mismatched adapter was accepted
  });

tsMutation("MUT C: the health identity fence is removed",
  [[CANARY_SRC, "  if (health.provider !== decidedProviderKey || health.channel !== SMS_CHANNEL) {", "  if (false) {"]],
  async (mm) => {
    const deps = makeDeps({ health: health({ provider: "msg91_sms" }) });
    const r = await mm.Canary.probeSmsProviderCanaryReadiness(baseInput(), deps);
    return r.status === READY; // a wrong health identity was accepted
  });

tsMutation("MUT D: an unhealthy provider is allowed through",
  [[CANARY_SRC, "  if (health.configured !== true || health.reachable !== true || health.status !== \"healthy\") {", "  if (false) {"]],
  async (mm) => {
    const deps = makeDeps({ health: health({ status: "unhealthy", reachable: false }) });
    const r = await mm.Canary.probeSmsProviderCanaryReadiness(baseInput(), deps);
    return r.status === READY; // an unhealthy provider passed
  });

tsMutation("MUT E: the reviewed-content-resolution guard is removed",
  [[CANARY_SRC, "  if (!resolved.ok) {", "  if (false) {"]],
  async (mm) => {
    const deps = makeDeps({ renderResult: { ok: false, code: "AUTH_SMS_PROVIDER_TEMPLATE_ID_MISSING" } });
    const r = await mm.Canary.probeSmsProviderCanaryReadiness(baseInput(), deps);
    return r.status === READY; // unresolved content still reported READY
  });

tsMutation("MUT F: the plaintext founder phone replaces the destination hash in the readiness query",
  [[CANARY_SRC, "    destinationHash, // HASH ONLY — never the plaintext founder phone", "    destinationHash: input.founderPhoneE164, // HASH ONLY — never the plaintext founder phone"]],
  async (mm) => {
    const deps = makeDeps();
    await mm.Canary.probeSmsProviderCanaryReadiness(baseInput(), deps);
    return deps.calls.readiness[0].destinationHash === FOUNDER_PHONE; // the plaintext phone leaked into the query
  });

srcMutation("MUT G: a provider send call is introduced into the probe",
  CANARY_SRC,
  "  // 13 — sanitized READY result. 14 — STOP. There is no send call anywhere in this module.",
  "  await adapter.sendResolvedAuthenticationSms(input.founderPhoneE164, resolved.resolved);\n  // 13 — sanitized READY result. 14 — STOP. There is no send call anywhere in this module.",
  () => /sendResolvedAuthenticationSms\s*\(/.test(readCode(CANARY_SRC)));

// ============================================================================
// RUNNER
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-C3-C-2 SMS canary readiness probe checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}
async function suiteGoesRed() { for (const c of checks) { try { await c.fn(); } catch { return true; } } return false; }
async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5F-C3-C-2 mutation tests...\n");
  for (const mut of mutationChecks) {
    const mutDir = resolve(`.phase5fc3c2-mut-${mutationChecks.indexOf(mut)}`);
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
      if (mut.kind === "ts") {
        let mm;
        try { compileTo(mutDir); transpileCanary(mutDir); } catch { console.log(`PASS ${mut.name} (rejected at compile time)`); passed++; continue; }
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
