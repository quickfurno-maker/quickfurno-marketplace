import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5F-C3-A — QuickFurno Exotel SMS provider adapter harness.
 *
 * Verifies the first REAL SMS provider adapter while it is PERMANENTLY INACTIVE: the
 * server-only config contract, the fail-closed candidacy rule, the provider identity fence,
 * the abortable single-request transport, and the outcome-certainty classification table.
 *
 * NO SMS is sent. NO network call is made — every request goes through an injected fake
 * transport. NO credential is real. NO migration, NO SQL, NO env file, NO fallback wiring,
 * NO CommunicationService change. The Exotel adapter is instantiated ONLY here.
 *
 * Mutation tests edit the REAL source, recompile, and assert the vulnerability appears,
 * restoring every file byte-identically afterwards.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const TS_FILES = [
  "lib/errors.ts",
  "lib/communication/httpTransport.ts",
  "lib/communication/providers/providerError.ts",
  "lib/communication/providers/providerOutcome.ts",
  "lib/communication/providers/whatsappProvider.ts",
  "lib/communication/providers/smsProvider.ts",
  "lib/communication/providers/mockSmsProvider.ts",
  "lib/communication/providers/exotelConfig.ts",
  "lib/communication/providers/exotelSmsProvider.ts",
  "services/smsProviderSelection.ts",
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
    Outcome: req("./lib/communication/providers/providerOutcome.js"),
    Sms: req("./lib/communication/providers/smsProvider.js"),
    MockSms: req("./lib/communication/providers/mockSmsProvider.js"),
    ExotelConfig: req("./lib/communication/providers/exotelConfig.js"),
    Exotel: req("./lib/communication/providers/exotelSmsProvider.js"),
    Selection: req("./services/smsProviderSelection.js"),
    RuntimeProvider: req("./services/runtimeSmsProviderService.js"),
  };
}

// ============================================================================
// FILE PATHS
// ============================================================================
const CONFIG_SRC = "lib/communication/providers/exotelConfig.ts";
const ADAPTER_SRC = "lib/communication/providers/exotelSmsProvider.ts";
const SELECTION_SRC = "services/smsProviderSelection.ts";
const RUNTIME_PROVIDER_SRC = "services/runtimeSmsProviderService.ts";
const TRANSPORT_SRC = "lib/communication/httpTransport.ts";
const SMS_IFACE_SRC = "lib/communication/providers/smsProvider.ts";
const MOCK_SMS_SRC = "lib/communication/providers/mockSmsProvider.ts";
const DOC_C3A = "docs/QF-Exotel-SMS-Provider-Integration-Phase-5F-C3A.md";
/** Phase 5F-C3-B: the single construction site and the single fence caller. */
const SMS_FACTORY_SRC = "services/runtimeSmsAdapterFactory.ts";
const ORCHESTRATOR_SRC = "services/clientLoginOtpDeliveryOrchestrator.ts";

/** Authority files this phase may never touch. */
const UNTOUCHABLE = [
  "lib/communication/authenticationTransportDecision.ts",
  "services/authenticationDeliveryAttemptService.ts",
  "services/authenticationTransportPolicyService.ts",
  "lib/communication/providers/metaCloudWhatsAppProvider.ts",
  "lib/communication/providers/metaCloudWhatsAppConfig.ts",
  "lib/communication/providers/whatsappProvider.ts",
  "lib/communication/providers/smsRuntimeGate.ts",
  "services/communicationService.ts",
];

/** Every SMS vendor except the ONE reviewed in this phase. None may be named anywhere. */
const UNREVIEWED_PROVIDERS = [
  /twilio/i, /msg91/i, /gupshup/i, /kaleyra/i, /plivo/i, /vonage/i, /nexmo/i,
  /aws[_ -]?sns/i, /textlocal/i, /sinch/i, /infobip/i, /karix/i, /routemobile/i, /netcore/i,
];

const readCode = (p) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
const readF = (f) => readFileSync(f, "utf8");

/** Every application source file, tracked or not — so the scan works before a commit too. */
function walkSources(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkSources(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

// ============================================================================
// REGISTRY
// ============================================================================
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ============================================================================
// MAIN BUILD
// ============================================================================
const MAIN_DIR = resolve(".phase5fc3a-build-main");
compileTo(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// FIXTURES — obviously fake, never a real credential
// ============================================================================
const FAKE_SID = "qftestaccountsid0000";
const FAKE_KEY = "qftestapikeyAAAAAAAAAAAA";
const FAKE_TOKEN = "qftestapitokenBBBBBBBBBB";
const FAKE_SENDER = "QFTEST";
const FAKE_BASIC = Buffer.from(`${FAKE_KEY}:${FAKE_TOKEN}`, "utf8").toString("base64");

/** Values that must NEVER appear in a result, an error, a log, or harness output. */
const SECRET_VALUES = [FAKE_KEY, FAKE_TOKEN, FAKE_SID, FAKE_BASIC];

const EXOTEL_ENV = Object.freeze({
  SMS_PROVIDER_MODE: "exotel_sms",
  EXOTEL_ACCOUNT_SID: FAKE_SID,
  EXOTEL_API_KEY: FAKE_KEY,
  EXOTEL_API_TOKEN: FAKE_TOKEN,
  EXOTEL_SENDER_ID: FAKE_SENDER,
});
const REQUIRED_VARS = ["EXOTEL_ACCOUNT_SID", "EXOTEL_API_KEY", "EXOTEL_API_TOKEN", "EXOTEL_SENDER_ID"];

const DESTINATION = "+919812345678";
const OTP = "482913";
const RESOLVED = Object.freeze({
  providerTemplateName: "QF_CLIENT_LOGIN_OTP_DLT",
  messageBody: `Your QuickFurno code is ${OTP}. Valid 10 minutes.`,
  // Phase 5F-C3-C-1: the neutral resolved contract. The provider TEMPLATE id is a per-send
  // mapping fact carried on the descriptor; the DLT ENTITY id is account-level and owned by the
  // adapter's own config, never this descriptor.
  providerTemplateId: "9876543210987654321",
});

/** A 4xx body that deliberately embeds the token, the destination and the OTP. */
const HOSTILE_4XX_BODY = JSON.stringify({
  RestException: {
    Status: 400, Code: 1001,
    Message: `Invalid To ${DESTINATION} for account ${FAKE_SID} using token ${FAKE_TOKEN} body ${OTP}`,
  },
});

const OK_BODY = JSON.stringify({ SMSMessage: { Sid: "exotel-sid-abc123", Status: "queued" } });
const OK_BODY_NO_SID = JSON.stringify({ SMSMessage: { Status: "queued" } });

const response = (status, bodyText) => ({ kind: "response", status, bodyText, truncated: false });
const aborted = () => ({ kind: "aborted" });
const networkError = (code) => ({ kind: "network_error", code });

/** An injected fake transport. Records every request; performs no I/O. */
function fakeTransport(...results) {
  const calls = [];
  let index = 0;
  return {
    calls,
    async request(req) {
      calls.push(req);
      const r = results[Math.min(index, results.length - 1)];
      index += 1;
      if (!r) throw new Error("fake transport ran out of scripted results");
      return r;
    },
  };
}

function exotelConfig(build = M, env = EXOTEL_ENV) {
  const res = build.ExotelConfig.resolveExotelConfig(env);
  if (!res.ok) throw new Error(`fixture config must resolve, got ${JSON.stringify(res)}`);
  return res.config;
}
function exotelProvider(build = M, transport, env = EXOTEL_ENV) {
  return new build.Exotel.ExotelSmsProvider(exotelConfig(build, env), transport);
}

/** Capture everything written to the console while `fn` runs. */
async function captureConsole(fn) {
  const methods = ["log", "error", "warn", "info", "debug", "trace"];
  const original = {};
  let buffer = "";
  for (const m of methods) {
    original[m] = console[m];
    console[m] = (...args) => {
      buffer += args.map((a) => (typeof a === "string" ? a : safeStringify(a))).join(" ") + "\n";
    };
  }
  try {
    const value = await fn();
    return { value, buffer };
  } finally {
    for (const m of methods) console[m] = original[m];
  }
}
function safeStringify(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}

function assertNoSecrets(label, text) {
  for (const secret of SECRET_VALUES) {
    assert(!text.includes(secret), `${label} leaked a secret value`);
  }
}

// ============================================================================
// 1. MOCK BEHAVIOUR IS COMPLETELY UNAFFECTED
// ============================================================================
check("1. mock selection and mock adapter behave exactly as in C2", async () => {
  const S = M.Selection;
  const implicit = S.selectSmsProvider({});
  assert(implicit.ok && implicit.candidate.mode === "mock", "non-production absent mode → mock");
  assert(implicit.candidate.providerKey === "mock_sms" && implicit.candidate.isMock === true, "mock identity");
  assert(implicit.candidate.channel === "sms", "mock channel");
  assert(S.selectSmsProvider({ SMS_PROVIDER_MODE: "mock" }).ok === true, "explicit mock");
  assert(S.selectSmsProvider({ NODE_ENV: "development", SMS_PROVIDER_MODE: "mock" }).ok === true, "dev explicit mock");

  // Even a complete Exotel environment leaves an absent/mock mode on the mock path.
  const withExotelVars = { ...EXOTEL_ENV, SMS_PROVIDER_MODE: "mock" };
  assert(S.selectSmsProvider(withExotelVars).candidate.providerKey === "mock_sms", "exotel vars never hijack mock");

  const mock = new M.MockSms.MockSmsProvider();
  const accepted = await mock.sendAuthenticationMessage("+15550002222", "client_login_otp", { otp: OTP });
  assert(accepted.accepted === true && accepted.outcomeCertainty === "accepted", "mock accepted path");
  const retryable = await mock.sendAuthenticationMessage(M.MockSms.MOCK_SMS_DESTINATIONS.RETRYABLE_FAILURE, "t", {});
  assert(retryable.outcomeCertainty === "definitive_failure" && retryable.retryable === true, "mock retryable failure");
  const permanent = await mock.sendAuthenticationMessage(M.MockSms.MOCK_SMS_DESTINATIONS.PERMANENT_FAILURE, "t", {});
  assert(permanent.outcomeCertainty === "definitive_failure" && permanent.retryable === false, "mock permanent failure");
  const unknown = await mock.sendAuthenticationMessage(M.MockSms.MOCK_SMS_DESTINATIONS.UNKNOWN_OUTCOME, "t", {});
  assert(unknown.outcomeCertainty === "unknown_outcome" && unknown.retryable === false, "mock unknown outcome");
  assert(!readF(MOCK_SMS_SRC).includes("exotel"), "the mock adapter never mentions the new provider");
});

// ============================================================================
// 2. PRODUCTION FAIL-CLOSED RULES ARE PRESERVED VERBATIM (C2)
// ============================================================================
check("2. production + absent mode, and production + mock mode, both fail closed", () => {
  const S = M.Selection;
  const R = S.SmsSelectionBlockReason;

  const absent = S.selectSmsProvider({ NODE_ENV: "production" });
  assert(absent.ok === false && absent.reason === R.MODE_REQUIRED_IN_PRODUCTION, `absent → ${absent.reason}`);
  assert(!("candidate" in absent), "absent yields no candidate");

  const mock = S.selectSmsProvider({ NODE_ENV: "production", SMS_PROVIDER_MODE: "mock" });
  assert(mock.ok === false && mock.reason === R.MOCK_FORBIDDEN_IN_PRODUCTION, `mock → ${mock.reason}`);
  assert(!("candidate" in mock), "production mock yields no candidate");

  // Even with a complete Exotel config present, an absent or mock mode stays closed.
  const absentWithConfig = S.selectSmsProvider({ ...EXOTEL_ENV, NODE_ENV: "production", SMS_PROVIDER_MODE: undefined });
  assert(absentWithConfig.ok === false && absentWithConfig.reason === R.MODE_REQUIRED_IN_PRODUCTION, "config never implies a mode");
  const mockWithConfig = S.selectSmsProvider({ ...EXOTEL_ENV, NODE_ENV: "production", SMS_PROVIDER_MODE: "mock" });
  assert(mockWithConfig.ok === false && mockWithConfig.reason === R.MOCK_FORBIDDEN_IN_PRODUCTION, "config never rescues a mock");

  // An unreviewed vendor mode never becomes mock and never becomes exotel.
  for (const mode of ["msg91", "twilio", "exotel", "EXOTEL_SMS", "exotel_sms ", "sms_cloud", "real"]) {
    const bad = S.selectSmsProvider({ ...EXOTEL_ENV, SMS_PROVIDER_MODE: mode });
    if (mode === "exotel_sms ") {
      // trimming is applied to the READ, so a padded literal is the same reviewed mode
      assert(bad.ok === true && bad.candidate.mode === "exotel_sms", "a trimmed literal is the reviewed mode");
      continue;
    }
    assert(bad.ok === false && bad.reason === R.UNSUPPORTED_PROVIDER_MODE, `${mode} → ${bad.reason}`);
    assert(!("candidate" in bad), `${mode} yields no candidate`);
  }
});

// ============================================================================
// 3. EXOTEL CANDIDACY — CONFIG COMPLETENESS
// ============================================================================
check("3. exotel mode + any missing/blank required var → NOT a candidate, fail closed", () => {
  const S = M.Selection;
  const R = S.SmsSelectionBlockReason;

  for (const variable of REQUIRED_VARS) {
    for (const blank of [undefined, "", "   "]) {
      for (const nodeEnv of [undefined, "production"]) {
        const env = { ...EXOTEL_ENV, NODE_ENV: nodeEnv, [variable]: blank };
        const out = S.selectSmsProvider(env);
        assert(out.ok === false, `${variable}=${JSON.stringify(blank)} must not select a candidate`);
        assert(out.reason === R.PROVIDER_CONFIG_INCOMPLETE, `${variable} → ${out.reason}`);
        assert(!("candidate" in out), `${variable} yields no candidate`);
        assert(out.missing.includes(variable), `${variable} is reported missing by NAME`);
        assertNoSecrets("selection failure", safeStringify(out));
      }
    }
  }
  // Missing EVERY required var at once.
  const empty = S.selectSmsProvider({ SMS_PROVIDER_MODE: "exotel_sms" });
  assert(empty.ok === false && empty.reason === R.PROVIDER_CONFIG_INCOMPLETE, "all missing → fail closed");
  assert(REQUIRED_VARS.every((v) => empty.missing.includes(v)), "every missing var is named");
});

check("4. exotel mode + complete config → candidate selected, in every environment", () => {
  const S = M.Selection;
  for (const nodeEnv of [undefined, "development", "test", "production"]) {
    const out = S.selectSmsProvider({ ...EXOTEL_ENV, NODE_ENV: nodeEnv });
    assert(out.ok === true, `NODE_ENV=${nodeEnv} → candidate`);
    assert(out.candidate.mode === "exotel_sms", "mode");
    assert(out.candidate.providerKey === "exotel_sms", "provider key");
    assert(out.candidate.channel === "sms", "channel");
    assert(out.candidate.isMock === false, "the reviewed provider is not a mock");
  }
  assert(S.KNOWN_SMS_PROVIDER_MODES.length === 2, "the vocabulary stays closed");
  assert(S.KNOWN_SMS_PROVIDER_MODES.includes("mock") && S.KNOWN_SMS_PROVIDER_MODES.includes("exotel_sms"), "exactly mock + exotel_sms");
  // Candidacy is not authorization: selection constructs nothing and names no endpoint.
  const src = readCode(SELECTION_SRC);
  assert(!/https?:\/\//.test(src), "selection names no HTTP endpoint");
  assert(!/new ExotelSmsProvider|ExotelSmsProvider/.test(src), "selection never constructs an adapter");
  for (const vendor of UNREVIEWED_PROVIDERS) assert(!vendor.test(src), `no unreviewed vendor (${vendor})`);
});

check("5. an invalid OPTIONAL var makes the config incomplete — never silently ignored", () => {
  const S = M.Selection;
  const R = S.SmsSelectionBlockReason;
  const cases = [
    ["EXOTEL_SUBDOMAIN", "https://api.exotel.com"],
    ["EXOTEL_SUBDOMAIN", "api.exotel.com/v1"],
    ["EXOTEL_SUBDOMAIN", "attacker.example.com"],
    ["EXOTEL_SUBDOMAIN", "api.exotel.com.attacker.test"],
    ["EXOTEL_SUBDOMAIN", "key:token@api.exotel.com"],
    ["EXOTEL_DLT_ENTITY_ID", "not-numeric"],
    ["EXOTEL_DLT_TEMPLATE_ID", "12 34"],
    ["EXOTEL_AUTH_HTTP_TIMEOUT_MS", "99000"],
    ["EXOTEL_AUTH_HTTP_TIMEOUT_MS", "0"],
    ["EXOTEL_AUTH_HTTP_TIMEOUT_MS", "abc"],
    ["EXOTEL_HEALTH_HTTP_TIMEOUT_MS", "-1"],
    // Pins the health floor at EXOTEL_HEALTH_TIMEOUT_MIN_MS (1000), aligned with Meta's.
    ["EXOTEL_HEALTH_HTTP_TIMEOUT_MS", "500"],
  ];
  for (const [variable, value] of cases) {
    const out = S.selectSmsProvider({ ...EXOTEL_ENV, [variable]: value });
    assert(out.ok === false && out.reason === R.PROVIDER_CONFIG_INCOMPLETE, `${variable}=${value} → ${out.reason}`);
    assert(out.invalid.includes(variable), `${variable} is reported invalid by NAME`);
    assert(!safeStringify(out).includes(value) || variable.endsWith("_MS"), `${variable} value is not echoed`);
  }
  // Malformed REQUIRED values are invalid too — not merely "present".
  for (const [variable, value] of [["EXOTEL_API_KEY", "has:colon"], ["EXOTEL_SENDER_ID", "toolongsenderid"], ["EXOTEL_ACCOUNT_SID", "bad sid"]]) {
    const out = S.selectSmsProvider({ ...EXOTEL_ENV, [variable]: value });
    assert(out.ok === false && out.invalid.includes(variable), `${variable}=${value} is invalid`);
  }
});

check("6. subdomain default, Mumbai endpoint, and the SSRF host fence", () => {
  const EC = M.ExotelConfig;
  assert(exotelConfig().subdomain === "api.exotel.com", "default subdomain");
  assert(EC.DEFAULT_EXOTEL_SUBDOMAIN === "api.exotel.com", "the default is exported");
  assert(EC.EXOTEL_MUMBAI_SUBDOMAIN === "api.in.exotel.com", "the Mumbai endpoint is known");

  const mumbai = EC.resolveExotelConfig({ ...EXOTEL_ENV, EXOTEL_SUBDOMAIN: "api.in.exotel.com" });
  assert(mumbai.ok && mumbai.config.subdomain === "api.in.exotel.com", "Mumbai endpoint is accepted");
  const upper = EC.resolveExotelConfig({ ...EXOTEL_ENV, EXOTEL_SUBDOMAIN: "API.IN.EXOTEL.COM" });
  assert(upper.ok && upper.config.subdomain === "api.in.exotel.com", "case is normalized, not rejected");
  const hostile = EC.resolveExotelConfig({ ...EXOTEL_ENV, EXOTEL_SUBDOMAIN: "evil.test" });
  assert(!hostile.ok && hostile.invalid.includes("EXOTEL_SUBDOMAIN"), "a non-Exotel host cannot receive the credentials");

  const url = M.Exotel.buildExotelSendSmsUrl({ subdomain: "api.in.exotel.com", accountSid: FAKE_SID });
  assert(url === `https://api.in.exotel.com/v1/Accounts/${FAKE_SID}/Sms/send.json`, `send url: ${url}`);
});

check("7. a NEXT_PUBLIC_EXOTEL_* variable proves a bundle leak → config incomplete", () => {
  const EC = M.ExotelConfig;
  for (const name of ["NEXT_PUBLIC_EXOTEL_API_KEY", "NEXT_PUBLIC_EXOTEL_ACCOUNT_SID", "next_public_exotel_token"]) {
    const out = EC.resolveExotelConfig({ ...EXOTEL_ENV, [name]: "anything" });
    assert(out.ok === false, `${name} must fail the config closed`);
    assert(out.invalid.some((v) => v.toLowerCase() === name.toLowerCase()), `${name} is reported by NAME`);
    assert(M.Selection.selectSmsProvider({ ...EXOTEL_ENV, [name]: "anything" }).ok === false, `${name} → not a candidate`);
  }
  // No variable this loader reads is itself a NEXT_PUBLIC_ name.
  for (const name of [...EC.EXOTEL_REQUIRED_ENV_VARS, ...EC.EXOTEL_OPTIONAL_ENV_VARS]) {
    assert(!/^NEXT_PUBLIC_/.test(name), `${name} must be server-only`);
  }
  assert(!/NEXT_PUBLIC_EXOTEL_[A-Z_]+\s*[:=]/.test(readF(CONFIG_SRC)), "no NEXT_PUBLIC variable is ever read");
});

// ============================================================================
// 8. PROVIDER IDENTITY FENCE
// ============================================================================
check("8. identity fence: an adapter whose providerKey ≠ the selected candidate is rejected", () => {
  const RP = M.RuntimeProvider;
  const transport = fakeTransport(response(200, OK_BODY));

  const good = RP.createRuntimeSmsProvider(() => exotelProvider(M, transport), EXOTEL_ENV);
  assert(good.ok === true, "a matching adapter passes the fence");
  assert(good.data.providerKey === "exotel_sms" && good.data.channel === "sms", "the fenced adapter is Exotel");

  const impostorKey = RP.createRuntimeSmsProvider(
    () => Object.assign(exotelProvider(M, transport), { providerKey: "impostor_sms" }), EXOTEL_ENV);
  assert(impostorKey.ok === false, "a mismatched providerKey is rejected");
  assert(impostorKey.code === RP.RUNTIME_SMS_PROVIDER_IDENTITY_MISMATCH, `got ${impostorKey.code}`);

  const impostorChannel = RP.createRuntimeSmsProvider(
    () => Object.assign(exotelProvider(M, transport), { channel: "whatsapp" }), EXOTEL_ENV);
  assert(impostorChannel.ok === false, "a non-sms channel is rejected");

  // A mock adapter offered where Exotel was selected is rejected by the same fence.
  const mockWhereExotel = RP.createRuntimeSmsProvider(() => new M.MockSms.MockSmsProvider(), EXOTEL_ENV);
  assert(mockWhereExotel.ok === false && mockWhereExotel.code === RP.RUNTIME_SMS_PROVIDER_IDENTITY_MISMATCH,
    "a mock may never stand in for the reviewed provider");
  // …and the Exotel adapter offered where mock was selected is rejected too.
  const exotelWhereMock = RP.createRuntimeSmsProvider(() => exotelProvider(M, transport), {});
  assert(exotelWhereMock.ok === false && exotelWhereMock.code === RP.RUNTIME_SMS_PROVIDER_IDENTITY_MISMATCH,
    "the fence is symmetric");

  // An incomplete config never reaches the fence at all.
  const noConfig = RP.createRuntimeSmsProvider(() => { throw new Error("factory must not run"); },
    { SMS_PROVIDER_MODE: "exotel_sms" });
  assert(noConfig.ok === false && noConfig.code === RP.RUNTIME_SMS_PROVIDER_UNAVAILABLE, "incomplete config → unavailable");
  // No error string ever carries a credential.
  for (const bad of [impostorKey, mockWhereExotel, exotelWhereMock, noConfig]) assertNoSecrets("fence error", safeStringify(bad));

  assert(new M.Exotel.ExotelSmsProvider(exotelConfig(), transport).providerKey === "exotel_sms", "providerKey is exactly exotel_sms");
  assert(M.Exotel.EXOTEL_SMS_PROVIDER_KEY === "exotel_sms", "the exported key is exactly exotel_sms");
});

// ============================================================================
// 9. TRANSPORT DISCIPLINE
// ============================================================================
check("9. abortable HttpTransport only: no Promise.race, no fetch, no retry, no loop, no scheduler", () => {
  const adapter = readCode(ADAPTER_SRC);
  const config = readCode(CONFIG_SRC);

  assert(!/Promise\.race/.test(adapter), "no Promise.race in the adapter");
  assert(!/Promise\.race/.test(config), "no Promise.race in the config loader");
  assert(!/\bfetch\s*\(/.test(adapter), "the adapter never calls fetch directly");
  assert(!/new AbortController/.test(adapter), "the adapter never owns an AbortController — the transport does");
  assert(/this\.transport\.request\(/.test(adapter), "the adapter goes through the injected transport");

  // The transport it depends on genuinely aborts the real request.
  const transport = readCode(TRANSPORT_SRC);
  assert(/new AbortController\(\)/.test(transport) && /signal: controller\.signal/.test(transport), "AbortController cancels the request");
  assert(/controller\.abort\(\)/.test(transport), "the timeout aborts");
  assert(!/Promise\.race/.test(transport), "the transport uses no pseudo-timeout");

  // Exactly two requests exist in the adapter: one send, one health probe. Neither loops.
  const requests = (adapter.match(/this\.transport\.request\(/g) ?? []).length;
  assert(requests === 2, `one send + one health probe, got ${requests}`);
  assert(!/\bfor\s*\(|\bwhile\s*\(|\bdo\s*\{/.test(adapter), "no loop construct");
  assert(!/\bsetTimeout\b|\bsetInterval\b|\bqueue\b|\bn8n\b/i.test(adapter), "no scheduler, no queue");
  assert(!/\bretries\b|\bretryCount\b|\bmaxAttempts\b|\battempt\s*\+\+/i.test(adapter), "no retry counter");

  // The contract still forbids the pseudo-timeout, and no unreviewed vendor is named.
  assert(/Promise\.race/.test(readF(SMS_IFACE_SRC)), "the SmsProvider contract forbids Promise.race explicitly");
  for (const vendor of UNREVIEWED_PROVIDERS) {
    assert(!vendor.test(adapter) && !vendor.test(config), `no unreviewed vendor (${vendor})`);
  }
});

check("10. the timeout ceiling may only shorten the configured timeout, never extend it", async () => {
  const cfg = exotelConfig();
  assert(cfg.authHttpTimeoutMs === 3000, `default auth timeout, got ${cfg.authHttpTimeoutMs}`);

  const noCeiling = fakeTransport(response(200, OK_BODY));
  await exotelProvider(M, noCeiling).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
  assert(noCeiling.calls[0].timeoutMs === 3000, "absent ceiling → configured timeout");

  const shorter = fakeTransport(response(200, OK_BODY));
  await exotelProvider(M, shorter).sendResolvedAuthenticationSms(DESTINATION, RESOLVED, { maxNetworkTimeoutMs: 900 });
  assert(shorter.calls[0].timeoutMs === 900, "a lower ceiling shortens");

  const longer = fakeTransport(response(200, OK_BODY));
  await exotelProvider(M, longer).sendResolvedAuthenticationSms(DESTINATION, RESOLVED, { maxNetworkTimeoutMs: 60000 });
  assert(longer.calls[0].timeoutMs === 3000, "a higher ceiling NEVER extends");

  const spent = fakeTransport(response(200, OK_BODY));
  await exotelProvider(M, spent).sendResolvedAuthenticationSms(DESTINATION, RESOLVED, { maxNetworkTimeoutMs: 0 });
  assert(spent.calls[0].timeoutMs === 1, "a spent budget clamps to the minimum, never to zero-forever");
});

// ============================================================================
// 11-16. OUTCOME CLASSIFICATION
// ============================================================================
check("11. 2xx WITH a usable Sid → accepted", async () => {
  for (const status of [200, 201, 202]) {
    const transport = fakeTransport(response(status, OK_BODY));
    const out = await exotelProvider(M, transport).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
    assert(out.accepted === true && out.outcomeCertainty === "accepted", `HTTP ${status} → accepted`);
    assert(out.providerMessageId === "exotel-sid-abc123", "the Sid becomes the provider message id");
    assert(out.normalizedStatus === "accepted" && out.retryable === false, "an accepted send is never retryable");
    assert(out.errorCode === null && out.errorMessage === null, "no error on the accepted path");
    assert(out.provider === "exotel_sms" && out.channel === "sms", "identity is stamped on the result");
    assert(transport.calls.length === 1, "exactly one request");
  }
});

check("12. 2xx WITHOUT a usable Sid → unknown_outcome (never accepted, never retried)", async () => {
  for (const body of [OK_BODY_NO_SID, "{}", "", "not json", JSON.stringify({ SMSMessage: { Sid: "   " } }), JSON.stringify({ SMSMessage: [] })]) {
    const transport = fakeTransport(response(200, body));
    const out = await exotelProvider(M, transport).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
    assert(out.accepted === false, `body ${JSON.stringify(body)} is not an acceptance`);
    assert(out.outcomeCertainty === "unknown_outcome", `body ${JSON.stringify(body)} → unknown_outcome`);
    assert(out.errorCode === "EXOTEL_NO_MESSAGE_SID", `got ${out.errorCode}`);
    assert(out.retryable === false, "an unknown outcome is NEVER retry authorization");
    assert(out.providerMessageId === null, "no fabricated id");
  }
  assert(M.Outcome.permitsAutomaticRetry({ accepted: false, outcomeCertainty: "unknown_outcome", retryable: true }) === false,
    "the generic model refuses to retry an unknown outcome even if an adapter lied about retryable");
});

check("13. 4xx explicit rejection → definitive_failure with a SANITIZED failure code", async () => {
  const transport = fakeTransport(response(400, HOSTILE_4XX_BODY));
  const out = await exotelProvider(M, transport).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
  assert(out.accepted === false && out.outcomeCertainty === "definitive_failure", "4xx is a proven non-delivery");
  assert(out.errorCode === "EXOTEL_ERROR_1001", `Exotel's code is carried, got ${out.errorCode}`);
  assert(out.retryable === false, "an explicit rejection is not retryable");
  assert(/^[A-Za-z0-9_]{1,64}$/.test(out.errorCode), "the failure code is an allowlisted identifier");

  // The hostile provider Message — token, destination, OTP — reaches nothing.
  const rendered = safeStringify(out);
  assertNoSecrets("4xx result", rendered);
  assert(!rendered.includes(DESTINATION), "the plaintext destination never survives");
  assert(!rendered.includes(OTP), "the OTP never survives");
  assert(!rendered.includes("Invalid To"), "the raw provider message never survives");

  // Code → Status → HTTP status, in that order; never the free-text Message.
  const statusOnly = fakeTransport(response(422, JSON.stringify({ RestException: { Status: 422, Message: FAKE_TOKEN } })));
  const s = await exotelProvider(M, statusOnly).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
  assert(s.errorCode === "EXOTEL_STATUS_422" && s.outcomeCertainty === "definitive_failure", `got ${s.errorCode}`);

  for (const [status, body] of [[403, "{}"], [404, "garbage"], [401, JSON.stringify({ RestException: { Code: "not-a-number" } })]]) {
    const t = fakeTransport(response(status, body));
    const r = await exotelProvider(M, t).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
    assert(r.errorCode === `EXOTEL_HTTP_${status}`, `HTTP ${status} → ${r.errorCode}`);
    assert(r.outcomeCertainty === "definitive_failure", `HTTP ${status} is an explicit rejection`);
  }
});

check("14. 5xx → unknown_outcome (the request may already have been processed)", async () => {
  for (const status of [500, 502, 503, 504]) {
    const transport = fakeTransport(response(status, JSON.stringify({ RestException: { Status: status, Code: 9001 } })));
    const out = await exotelProvider(M, transport).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
    assert(out.accepted === false, `HTTP ${status} is not an acceptance`);
    assert(out.outcomeCertainty === "unknown_outcome", `HTTP ${status} → unknown_outcome, got ${out.outcomeCertainty}`);
    assert(out.retryable === false, `HTTP ${status} is never retry authorization`);
    assert(out.errorCode === `EXOTEL_HTTP_${status}`, `got ${out.errorCode}`);
  }
});

check("15. PROVEN pre-connect network failure → definitive_failure, safely retryable", async () => {
  for (const code of ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN", "UND_ERR_CONNECT_TIMEOUT"]) {
    const transport = fakeTransport(networkError(code));
    const out = await exotelProvider(M, transport).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
    assert(out.outcomeCertainty === "definitive_failure", `${code} provably never reached Exotel, got ${out.outcomeCertainty}`);
    assert(out.retryable === true, `${code} is safely retryable at the transport level`);
    assert(out.errorCode === `EXOTEL_${code}`, `the transport code is carried sanitized, got ${out.errorCode}`);
    assert(out.accepted === false && out.providerMessageId === null, "nothing was delivered");
  }
});

check("16. abort/timeout and POST-connect ambiguity → unknown_outcome, never retryable", async () => {
  const timedOut = fakeTransport(aborted());
  const t = await exotelProvider(M, timedOut).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
  assert(t.outcomeCertainty === "unknown_outcome", "an aborted request has an unknown outcome");
  assert(t.retryable === false, "a timeout is NEVER retry authorization — the OTP may already have been delivered");
  assert(t.errorCode === "EXOTEL_TIMEOUT" && t.accepted === false, `got ${t.errorCode}`);

  for (const code of ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ESOCKETTIMEDOUT", "ECONNABORTED", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", null, "SOMETHING_NEW"]) {
    const transport = fakeTransport(networkError(code));
    const out = await exotelProvider(M, transport).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
    assert(out.outcomeCertainty === "unknown_outcome", `${code} is ambiguous, got ${out.outcomeCertainty}`);
    assert(out.retryable === false, `${code} is never retryable`);
    assert(out.errorCode === "EXOTEL_NETWORK_ERROR", `an ambiguous code is not surfaced, got ${out.errorCode}`);
  }
});

// ============================================================================
// 17-19. PRIVACY, CREDENTIAL HANDLING, AND THE SEND FENCE
// ============================================================================
check("17. no OTP, body, destination, credential, or raw response survives a call — or is logged", async () => {
  const scenarios = [
    () => fakeTransport(response(400, HOSTILE_4XX_BODY)),
    () => fakeTransport(response(200, OK_BODY)),
    () => fakeTransport(response(500, HOSTILE_4XX_BODY)),
    () => fakeTransport(aborted()),
    () => fakeTransport(networkError("ECONNREFUSED")),
  ];
  for (const make of scenarios) {
    const transport = make();
    const { value: out, buffer } = await captureConsole(() =>
      exotelProvider(M, transport).sendResolvedAuthenticationSms(DESTINATION, RESOLVED));
    const rendered = safeStringify(out);
    assertNoSecrets("send result", rendered);
    assertNoSecrets("console output", buffer);
    assert(!rendered.includes(DESTINATION) && !buffer.includes(DESTINATION), "no plaintext destination");
    assert(!rendered.includes(OTP) && !buffer.includes(OTP), "no OTP");
    assert(!rendered.includes(RESOLVED.messageBody) && !buffer.includes(RESOLVED.messageBody), "no message body");
    assert(buffer === "", "the adapter logs nothing at all");
  }

  // Health checks are equally silent.
  const healthTransport = fakeTransport(response(200, JSON.stringify({ AccountSid: FAKE_SID, Token: FAKE_TOKEN })));
  const { value: health, buffer: healthLog } = await captureConsole(() => exotelProvider(M, healthTransport).healthCheck());
  assertNoSecrets("health result", safeStringify(health));
  assertNoSecrets("health log", healthLog);
  assert(health.provider === "exotel_sms" && health.channel === "sms" && health.status === "healthy", "health identity");
  assert(healthLog === "", "the health check logs nothing");

  // Config failures name variables, never values.
  const failure = M.ExotelConfig.resolveExotelConfig({ SMS_PROVIDER_MODE: "exotel_sms", EXOTEL_API_KEY: FAKE_KEY });
  assert(!failure.ok, "fixture is incomplete");
  const described = M.ExotelConfig.describeExotelConfigFailure(failure);
  assertNoSecrets("config failure description", described + safeStringify(failure));
  assert(described.includes("EXOTEL_ACCOUNT_SID"), "variable NAMES are reported");
  assert(!/console\./.test(readCode(CONFIG_SRC)), "the config loader has no console call");
  assert(!/console\./.test(readCode(ADAPTER_SRC)), "the adapter has no console call");
});

check("18. credentials travel only in the Authorization header — never a URL, never a body", async () => {
  const transport = fakeTransport(response(200, OK_BODY));
  await exotelProvider(M, transport).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
  const req = transport.calls[0];

  assert(req.method === "POST" && req.url.startsWith("https://api.exotel.com/"), `send url: ${req.url}`);
  assert(req.headers.Authorization === `Basic ${FAKE_BASIC}`, "Basic credential in the header");
  assert(!req.url.includes(FAKE_KEY) && !req.url.includes(FAKE_TOKEN), "no credential in the URL");
  assert(!req.url.includes("@"), "no userinfo in the URL");
  assert(!req.body.includes(FAKE_KEY) && !req.body.includes(FAKE_TOKEN), "no credential in the body");
  assert(req.headers["Content-Type"] === "application/x-www-form-urlencoded", "form encoding");
  assert(req.maxResponseBytes > 0, "the response body read is bounded");

  // Phase 5F-C3-C-1 (corrected) DLT ownership — ONE template-identity authority, NO fallback:
  //   • TEMPLATE id ← the resolved descriptor (the runtime mapping's providerTemplateId) ONLY;
  //   • ENTITY id   ← the adapter's account config ONLY.
  const form = new URLSearchParams(req.body);
  assert(form.get("From") === FAKE_SENDER && form.get("To") === DESTINATION, "From/To");
  assert(form.get("DltTemplateId") === RESOLVED.providerTemplateId, "DLT template id from the descriptor");
  assert(!form.has("DltEntityId"), "no account-level DLT entity id configured → absent");

  // With account config present: the ENTITY id comes from config; the config TEMPLATE id can
  // NEVER override the descriptor template id.
  const envWithDlt = { ...EXOTEL_ENV, EXOTEL_DLT_ENTITY_ID: "111", EXOTEL_DLT_TEMPLATE_ID: "222" };
  const t2 = fakeTransport(response(200, OK_BODY));
  await exotelProvider(M, t2, envWithDlt).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
  const form2 = new URLSearchParams(t2.calls[0].body);
  assert(form2.get("DltEntityId") === "111", "entity id from account config");
  assert(form2.get("DltTemplateId") === RESOLVED.providerTemplateId, "descriptor template id is the sole authority");
  assert(form2.get("DltTemplateId") !== "222", "the config template id can NEVER override the descriptor");

  // A descriptor with NO template id → the config template id can NEVER rescue it. Nothing invented.
  const t3 = fakeTransport(response(200, OK_BODY));
  await exotelProvider(M, t3, envWithDlt).sendResolvedAuthenticationSms(DESTINATION,
    { providerTemplateName: RESOLVED.providerTemplateName, messageBody: RESOLVED.messageBody, providerTemplateId: null });
  const form3 = new URLSearchParams(t3.calls[0].body);
  assert(!form3.has("DltTemplateId"), "no config template-id rescue for a missing descriptor id");
  assert(form3.get("DltEntityId") === "111", "the account entity id is still forwarded");

  // No account config and no descriptor template id → the fields are simply absent. Nothing invented.
  const t4 = fakeTransport(response(200, OK_BODY));
  await exotelProvider(M, t4).sendResolvedAuthenticationSms(DESTINATION,
    { providerTemplateName: "T", messageBody: "B", providerTemplateId: null });
  const form4 = new URLSearchParams(t4.calls[0].body);
  assert(!form4.has("DltEntityId") && !form4.has("DltTemplateId"), "no fabricated DLT id");
});

check("19. the bare SmsProvider send method can never put a message on the wire", async () => {
  const transport = fakeTransport(response(200, OK_BODY));
  const provider = exotelProvider(M, transport);
  const out = await provider.sendAuthenticationMessage(DESTINATION, "client_login_otp", { otp: OTP });
  assert(out.accepted === false, "a bare template key is refused");
  assert(out.outcomeCertainty === "definitive_failure", "the refusal provably delivered nothing");
  assert(out.errorCode === "EXOTEL_RESOLVED_TEMPLATE_REQUIRED", `got ${out.errorCode}`);
  assert(transport.calls.length === 0, "no request was made");

  // The resolved path also refuses to send on a bad destination or an unrendered template.
  for (const [dest, resolved, code] of [
    ["9812345678", RESOLVED, "EXOTEL_DESTINATION_INVALID"],
    ["+91 981 234", RESOLVED, "EXOTEL_DESTINATION_INVALID"],
    [DESTINATION, { providerTemplateName: "", messageBody: "x" }, "EXOTEL_TEMPLATE_NAME_MISSING"],
    [DESTINATION, { providerTemplateName: "T", messageBody: "  " }, "EXOTEL_TEMPLATE_BODY_MISSING"],
  ]) {
    const t = fakeTransport(response(200, OK_BODY));
    const r = await exotelProvider(M, t).sendResolvedAuthenticationSms(dest, resolved);
    assert(r.errorCode === code && r.outcomeCertainty === "definitive_failure", `${code}, got ${r.errorCode}`);
    assert(t.calls.length === 0, `${code} made no request`);
  }
});

// ============================================================================
// 20-22. NO ACTIVATION, NO MIGRATION, NO ENV, NO SCOPE CREEP
// ============================================================================
check("20. no migration, no SQL, no env file, and no authority file was touched", () => {
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })
    .split("\n").map((l) => l.slice(3).trim()).filter(Boolean);

  for (const path of dirty) {
    assert(!path.startsWith("supabase/migrations"), `no migration may be created or modified (${path})`);
    assert(!path.endsWith(".sql"), `no SQL file may be created or modified (${path})`);
    assert(!/(^|\/)\.env/.test(path), `no env file may be created or modified (${path})`);
    assert(!UNTOUCHABLE.includes(path), `${path} is an authority file this phase may never touch`);
  }
  // The newest migration is still C1's; C3-A adds none.
  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  assert(migrations[migrations.length - 1] === "20260710000100_auth_transport_resilience_decision_foundation.sql",
    `no new migration; newest is ${migrations[migrations.length - 1]}`);
  for (const f of migrations) assert(!/sms|exotel/i.test(f), `no SMS/Exotel migration exists (${f})`);

  // Neither new file contains any SQL or DDL.
  for (const f of [CONFIG_SRC, ADAPTER_SRC]) {
    const src = readCode(f);
    assert(!/insert into|create table|alter table|update\s+public\.|drop\s+table/i.test(src), `${f} contains no SQL`);
    assert(!/adminClient|supabase/i.test(src), `${f} touches no database`);
  }
});

check("21. the adapter authorizes nothing: no fallback, no policy, no ledger, no C1 contact", () => {
  const src = [readCode(CONFIG_SRC), readCode(ADAPTER_SRC), readCode(SELECTION_SRC)].join("\n");
  for (const forbidden of [
    /authentication_transport_policies/, /authentication_transport_failure_rules/,
    /evaluateAuthenticationFallback/, /claimAuthenticationDeliveryAttempt/,
    /communication_messages/, /is_operationally_enabled/, /outbound_enabled/,
    /\bn8n\b/i, /\bjarvis\b/i, /CommunicationService/,
  ]) {
    assert(!forbidden.test(src), `C3-A must never touch ${forbidden}`);
  }
  // Phase 5F-C3-B introduced exactly ONE construction site and exactly ONE caller. The
  // adapter must remain unreachable from anywhere else. Scanned on the working tree, so the
  // guard holds before the phase is committed as well as after.
  const appSources = ["app", "lib", "services", "components", "pages"].flatMap((d) => walkSources(d));
  const constructors = appSources.filter((f) => /new\s+ExotelSmsProvider\s*\(/.test(readF(f)));
  assert(constructors.length === 1 && constructors[0] === SMS_FACTORY_SRC,
    `only ${SMS_FACTORY_SRC} may construct the adapter, found ${constructors}`);
  // `createRuntimeSmsProvider` is called by the orchestrator alone; the fence is never bypassed.
  const callers = appSources
    .filter((f) => f !== RUNTIME_PROVIDER_SRC)
    .filter((f) => /createRuntimeSmsProvider\s*\(/.test(readF(f)));
  assert(callers.length === 1 && callers[0] === ORCHESTRATOR_SRC,
    `only ${ORCHESTRATOR_SRC} may inject an SMS provider factory, found ${callers}`);
  // The factory never instantiates the mock: a mock may never carry a live OTP.
  assert(!/MockSmsProvider/.test(readCode(SMS_FACTORY_SRC)), "the factory never constructs the mock adapter");
  // Docs and the fail-closed statement are explicit.
  assert(/CANDIDATE IS NOT AUTHORIZATION/i.test(readF(SELECTION_SRC)), "selection states that candidacy is not authorization");
});

check("22. wiring: test:phase5f:c3a exists, earlier harnesses untouched, the doc is complete", () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:c3a"] === "node scripts/phase5f-c3a-exotel-adapter-harness.mjs", "test:phase5f:c3a wired");
  assert(pkg.scripts["test:phase5f:c2"] === "node scripts/phase5f-c2-sms-runtime-foundation-harness.mjs", "test:phase5f:c2 unchanged");
  assert(pkg.scripts["test:phase5f:c"] === "node scripts/phase5f-c-auth-transport-resilience-harness.mjs", "test:phase5f:c unchanged");
  assert(pkg.scripts["test:phase5f:b"] === "node scripts/phase5f-b-whatsapp-cloud-api-harness.mjs", "test:phase5f:b unchanged");
  for (const f of [CONFIG_SRC, ADAPTER_SRC, SELECTION_SRC, RUNTIME_PROVIDER_SRC, DOC_C3A]) assert(existsSync(f), `${f} exists`);

  const doc = readF(DOC_C3A);
  for (const topic of [
    /what this phase does not do/i, /authority boundar/i, /fail closed/i, /outcome[- ]certainty/i,
    /classification/i, /config(uration)? contract/i, /identity fence/i, /timeout/i,
    /no migration/i, /no credential/i, /DLT/, /Phase 5F-C3-C/, /Mumbai/i, /candidate/i,
  ]) {
    assert(topic.test(doc), `the documentation covers ${topic}`);
  }
  assert(/no Exotel account exists/i.test(doc), "the doc states no Exotel account exists yet");
  assert(/remains \*\*external and pending\*\*/i.test(doc), "the doc states DLT registration is external and pending");
  for (const affirmative of [/\bSMS is live\b/i, /SMS fallback is enabled/i, /DLT approval is complete/i, /Exotel is activated/i]) {
    assert(!affirmative.test(doc), `the doc must never claim ${affirmative}`);
  }
  for (const vendor of UNREVIEWED_PROVIDERS) {
    if (vendor.test(doc)) assert(/not been (chosen|selected)|no other commercial provider/i.test(doc), `${vendor} appears without a "not chosen" statement`);
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

// ---- candidacy / fail-closed ----------------------------------------------
tsMutation("MUT A: an incomplete Exotel config still yields a candidate",
  [[SELECTION_SRC,
    "  const config = resolveExotelConfig(env);\n  if (!config.ok) {",
    "  const config = resolveExotelConfig(env);\n  if (false && !config.ok) {"]],
  (mm) => mm.Selection.selectSmsProvider({ SMS_PROVIDER_MODE: "exotel_sms" }).ok === true);

tsMutation("MUT B: a missing required credential is treated as present",
  [[CONFIG_SRC,
    "  const v = readTrimmed(env, name);\n  if (v === null) {\n    missing.push(name);\n    return null;\n  }\n  if (!pattern.test(v)) {\n    invalid.push(name);\n    return null;\n  }\n  return v;\n}",
    "  const v = readTrimmed(env, name);\n  if (v === null) {\n    return \"\";\n  }\n  if (!pattern.test(v)) {\n    invalid.push(name);\n    return null;\n  }\n  return v;\n}"]],
  (mm) => mm.Selection.selectSmsProvider({ SMS_PROVIDER_MODE: "exotel_sms" }).ok === true);

tsMutation("MUT C: production with no mode silently falls back to mock",
  [[SELECTION_SRC,
    "    if (raw === null) {\n      return { ok: false, reason: SmsSelectionBlockReason.MODE_REQUIRED_IN_PRODUCTION, variable: SMS_PROVIDER_MODE_ENV };\n    }",
    "    if (raw === null) {\n      return { ok: true, candidate: MOCK_CANDIDATE };\n    }"]],
  (mm) => mm.Selection.selectSmsProvider({ NODE_ENV: "production" }).ok === true);

tsMutation("MUT D: production with an explicit mock is allowed to send",
  [[SELECTION_SRC,
    "    if (raw === SmsProviderMode.MOCK) {\n      return { ok: false, reason: SmsSelectionBlockReason.MOCK_FORBIDDEN_IN_PRODUCTION, variable: SMS_PROVIDER_MODE_ENV };\n    }",
    "    if (raw === SmsProviderMode.MOCK) {\n      return { ok: true, candidate: MOCK_CANDIDATE };\n    }"]],
  (mm) => mm.Selection.selectSmsProvider({ NODE_ENV: "production", SMS_PROVIDER_MODE: "mock" }).ok === true);

tsMutation("MUT E: an unreviewed vendor mode is normalized onto the reviewed provider",
  [[SELECTION_SRC,
    "  if (raw === SmsProviderMode.EXOTEL_SMS) {\n    return selectExotel(env);\n  }",
    "  if (raw !== null && raw !== SmsProviderMode.MOCK) {\n    return selectExotel(env);\n  }"]],
  (mm) => mm.Selection.selectSmsProvider({ ...EXOTEL_ENV, SMS_PROVIDER_MODE: "msg91" }).ok === true);

// ---- identity fence --------------------------------------------------------
tsMutation("MUT F: the provider identity fence is removed",
  [[RUNTIME_PROVIDER_SRC,
    "  if (provider.providerKey !== candidate.data.providerKey || provider.channel !== \"sms\") {",
    "  if (false) {"]],
  // A mock adapter is accepted where the reviewed provider was selected.
  (mm) => mm.RuntimeProvider.createRuntimeSmsProvider(() => new mm.MockSms.MockSmsProvider(), EXOTEL_ENV).ok === true);

tsMutation("MUT G: the fence compares the channel but not the provider identity",
  [[RUNTIME_PROVIDER_SRC,
    "  if (provider.providerKey !== candidate.data.providerKey || provider.channel !== \"sms\") {",
    "  if (provider.channel !== \"sms\") {"]],
  (mm) => mm.RuntimeProvider.createRuntimeSmsProvider(() => new mm.MockSms.MockSmsProvider(), EXOTEL_ENV).ok === true);

// ---- outcome certainty -----------------------------------------------------
tsMutation("MUT H: a 2xx without a usable Sid is reported as accepted",
  [[ADAPTER_SRC,
    "  const sid = status >= 200 && status < 300 ? extractExotelSmsSid(body) : null;\n  const certainty = classifyTransportCertainty({ kind: \"response\", status, hasProviderMessageId: sid !== null });",
    "  const sid = status >= 200 && status < 300 ? extractExotelSmsSid(body) : null;\n  const certainty = classifyTransportCertainty({ kind: \"response\", status, hasProviderMessageId: status >= 200 && status < 300 });"]],
  async (mm) => {
    const t = fakeTransport(response(200, OK_BODY_NO_SID));
    const out = await new mm.Exotel.ExotelSmsProvider(exotelConfig(mm), t).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
    return out.accepted === true || out.outcomeCertainty === "accepted";
  });

tsMutation("MUT I: an aborted request becomes a proven failure (and thus retry/fallback authorization)",
  [[ADAPTER_SRC,
    "  if (transport.kind === \"aborted\") {\n    const certainty = classifyTransportCertainty({ kind: \"aborted\" });",
    "  if (transport.kind === \"aborted\") {\n    const certainty = { outcomeCertainty: \"definitive_failure\" as const, retryable: true };"]],
  async (mm) => {
    const t = fakeTransport(aborted());
    const out = await new mm.Exotel.ExotelSmsProvider(exotelConfig(mm), t).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
    return out.outcomeCertainty === "definitive_failure";
  });

tsMutation("MUT J: an ambiguous network failure is treated as a proven pre-connect failure",
  [[ADAPTER_SRC,
    "    const certainty = classifyTransportCertainty({ kind: \"network_error\", code: transport.code });",
    "    const certainty = { outcomeCertainty: \"definitive_failure\" as const, retryable: true };"]],
  async (mm) => {
    const t = fakeTransport(networkError("ECONNRESET"));
    const out = await new mm.Exotel.ExotelSmsProvider(exotelConfig(mm), t).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
    return out.outcomeCertainty === "definitive_failure";
  });

tsMutation("MUT K: providerOutcome downgrades an ambiguous 5xx into a definitive rejection",
  [["lib/communication/providers/providerOutcome.ts",
    "  if (status >= 400 && status < 500) {\n    return { outcomeCertainty: \"definitive_failure\", retryable: false };\n  }\n  return { outcomeCertainty: \"unknown_outcome\", retryable: false };",
    "  return { outcomeCertainty: \"definitive_failure\", retryable: false };"]],
  async (mm) => {
    const t = fakeTransport(response(503, "{}"));
    const out = await new mm.Exotel.ExotelSmsProvider(exotelConfig(mm), t).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
    return out.outcomeCertainty === "definitive_failure";
  });

tsMutation("MUT L: a proven pre-connect failure is downgraded to an unknown outcome",
  [["lib/communication/providers/providerError.ts",
    "export const PROVEN_PRECONNECT_FAILURE_CODES: ReadonlySet<string> = new Set([\n  \"ENOTFOUND\",",
    "export const PROVEN_PRECONNECT_FAILURE_CODES: ReadonlySet<string> = new Set([\n  \"__NEVER_MATCHES__\","]],
  async (mm) => {
    // ENOTFOUND is the entry this mutation removes, so it must stop being provable.
    const t = fakeTransport(networkError("ENOTFOUND"));
    const out = await new mm.Exotel.ExotelSmsProvider(exotelConfig(mm), t).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
    return out.outcomeCertainty !== "definitive_failure" || out.retryable !== true;
  });

// ---- secret / privacy leaks -------------------------------------------------
tsMutation("MUT M: the adapter leaks a credential into the result error message",
  [[ADAPTER_SRC,
    "    return interpretExotelSendResult(transportResult, this.providerKey);",
    "    const r = interpretExotelSendResult(transportResult, this.providerKey);\n    return { ...r, errorMessage: `${r.errorMessage ?? \"\"} sid=${this.config.accountSid} token=${this.config.apiToken}` };"]],
  async (mm) => {
    const t = fakeTransport(response(400, HOSTILE_4XX_BODY));
    const out = await new mm.Exotel.ExotelSmsProvider(exotelConfig(mm), t).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
    return SECRET_VALUES.some((s) => safeStringify(out).includes(s));
  });

tsMutation("MUT N: the raw provider response body is persisted in the failure message",
  [[ADAPTER_SRC,
    "      errorMessage: `Exotel rejected the request (HTTP ${status}).`,",
    "      errorMessage: `Exotel rejected the request (HTTP ${status}): ${bodyText}`,"]],
  async (mm) => {
    const t = fakeTransport(response(400, HOSTILE_4XX_BODY));
    const out = await new mm.Exotel.ExotelSmsProvider(exotelConfig(mm), t).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
    const rendered = safeStringify(out);
    return rendered.includes(FAKE_TOKEN) || rendered.includes(OTP) || rendered.includes(DESTINATION);
  });

tsMutation("MUT O: an unsanitized provider error code reaches the result",
  [[ADAPTER_SRC,
    "  if (typeof value === \"string\" && /^[0-9]{1,9}$/.test(value)) return value;\n  return null;",
    "  if (typeof value === \"string\") return value;\n  return null;"]],
  async (mm) => {
    const body = JSON.stringify({ RestException: { Status: 400, Code: `leak-${FAKE_TOKEN}` } });
    const t = fakeTransport(response(400, body));
    const out = await new mm.Exotel.ExotelSmsProvider(exotelConfig(mm), t).sendResolvedAuthenticationSms(DESTINATION, RESOLVED);
    return safeStringify(out).includes(FAKE_TOKEN);
  });

tsMutation("MUT P: the config loader echoes a variable VALUE in its failure description",
  [[CONFIG_SRC,
    "  if (result.invalid.length > 0) parts.push(`invalid: ${result.invalid.join(\", \")}`);",
    "  if (result.invalid.length > 0) parts.push(`invalid: ${result.invalid.join(\", \")} (${process.env.EXOTEL_API_TOKEN ?? \"\"})`);"]],
  (mm) => {
    process.env.EXOTEL_API_TOKEN = FAKE_TOKEN;
    try {
      const failure = mm.ExotelConfig.resolveExotelConfig({ ...EXOTEL_ENV, EXOTEL_SUBDOMAIN: "evil.test" });
      return mm.ExotelConfig.describeExotelConfigFailure(failure).includes(FAKE_TOKEN);
    } finally {
      delete process.env.EXOTEL_API_TOKEN;
    }
  });

// ---- server-only / SSRF fences ---------------------------------------------
tsMutation("MUT Q: the SSRF host fence is removed — credentials may reach any host",
  [[CONFIG_SRC,
    "  if (!HOSTNAME_PATTERN.test(host) || !host.endsWith(EXOTEL_SUBDOMAIN_SUFFIX)) {",
    "  if (false) {"]],
  (mm) => {
    const out = mm.ExotelConfig.resolveExotelConfig({ ...EXOTEL_ENV, EXOTEL_SUBDOMAIN: "attacker.example.com" });
    return out.ok === true;
  });

tsMutation("MUT R: the NEXT_PUBLIC credential-exposure fence is removed",
  [[CONFIG_SRC,
    "  const exposed = publicExotelVariables(env);\n  if (exposed.length > 0) return { ok: false, missing: [], invalid: exposed };",
    "  const exposed: string[] = [];\n  if (exposed.length > 0) return { ok: false, missing: [], invalid: exposed };"]],
  (mm) => mm.ExotelConfig.resolveExotelConfig({ ...EXOTEL_ENV, NEXT_PUBLIC_EXOTEL_API_KEY: FAKE_KEY }).ok === true);

// ---- transport discipline (source-level) ------------------------------------
srcMutation("MUT S: a Promise.race pseudo-timeout is introduced into the adapter",
  ADAPTER_SRC,
  "    const transportResult = await this.transport.request({",
  "    const transportResult = await Promise.race([this.transport.request({",
  () => /Promise\.race/.test(readCode(ADAPTER_SRC)));

srcMutation("MUT T: the adapter calls fetch directly, bypassing the abortable transport",
  ADAPTER_SRC,
  "      body: form.toString(),\n      timeoutMs,",
  "      body: (await fetch(\"https://api.exotel.com\"), form.toString()),\n      timeoutMs,",
  () => /\bfetch\s*\(/.test(readCode(ADAPTER_SRC)));

srcMutation("MUT U: a retry loop is introduced into the adapter",
  ADAPTER_SRC,
  "  async healthCheck(): Promise<SmsProviderHealth> {",
  "  async retryTwice(): Promise<void> {\n    for (let attempt = 0; attempt < 2; attempt++) { await this.transport.request({ url: \"\", method: \"GET\", headers: {}, timeoutMs: 1, maxResponseBytes: 1 }); }\n  }\n\n  async healthCheck(): Promise<SmsProviderHealth> {",
  () => /\bfor\s*\(/.test(readCode(ADAPTER_SRC)));

srcMutation("MUT V: an unreviewed commercial vendor is named in the adapter",
  ADAPTER_SRC,
  "export { EXOTEL_SMS_PROVIDER_KEY };",
  "export const TWILIO_FALLBACK_KEY = \"twilio_sms\";\nexport { EXOTEL_SMS_PROVIDER_KEY };",
  () => UNREVIEWED_PROVIDERS.some((v) => v.test(readCode(ADAPTER_SRC))));

// ============================================================================
// RUNNER
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-C3-A Exotel adapter checks...\n");
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
  console.log("\nRunning Phase 5F-C3-A mutation tests...\n");
  for (const mut of mutationChecks) {
    const mutDir = resolve(`.phase5fc3a-mut-${mutationChecks.indexOf(mut)}`);
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
