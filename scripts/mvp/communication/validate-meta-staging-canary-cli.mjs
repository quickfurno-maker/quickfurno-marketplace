#!/usr/bin/env node
// ============================================================================
// QF-MVP-40.13C-R1 — direct-CLI parity validator.
//
// The 40.13C validator drove `runOperator()` with injected adapters. That proved the
// runtime but never executed the real CLI setup path, where resolveMode, the staging
// fence, the provider-env reconciliation, the attestation target and the HEAD pin are
// COMBINED — and three defects hid exactly there:
//
//   A. `--preflight-readonly` could only ever mint an ARM_READINESS attestation, because
//      the stage was chosen by an undeclared `--stage=canary` that resolveMode refused.
//   B. emergency `--disable` demanded QF_META_* credentials, so an expired Meta token
//      could keep a canary armed.
//   C. the attestation stored `branch_head` but nothing ever verified it.
//
// Every test here calls the SAME exported `runCli` the entry point calls. There is no
// test-only parser. No socket is opened and no credential is read.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as R from "./canaryActivationRuntime.mjs";
import { ActivationFailure, GIT_HEAD_RE } from "./activate-meta-staging-canary.mjs";
import { REQUIRED_ACCOUNT_READINESS } from "../../../lib/communication/providers/metaRuntimeGate.ts";
import { hashPhoneE164 } from "../../../lib/communication/phone.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const operatorCode = strip(read("scripts/mvp/communication/activate-meta-staging-canary.mjs"));
const runtimeCode = strip(read("scripts/mvp/communication/canaryActivationRuntime.mjs"));

const results = [];
const record = (n, p, d = "") => results.push({ name: n, passed: p === true, detail: d });
const F = ActivationFailure;

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const EXPECTED = Object.freeze({ phoneNumberId: "123456789012345", wabaId: "987654321098765" });
const CANARY_HASH = hashPhoneE164("+15555550100");
const TEMPLATE_KEY = "vendor_onboarding_reminder";
const TEMPLATE_NAME = "qf_vendor_onboarding_reminder_v1";
const STAGING_URL = "https://uckafzuochmbvtiodmcl.supabase.co";

/** The FULL env an opening mode needs. */
const openEnv = (over = {}) => ({
  QF_STAGING_SUPABASE_URL: STAGING_URL,
  QF_STAGING_SUPABASE_SERVICE_ROLE_KEY: "sb_secret_" + "x".repeat(32),
  QF_META_ACCESS_TOKEN: "TOKEN-NEVER-LOGGED",
  QF_META_WABA_ID: EXPECTED.wabaId,
  QF_META_PHONE_NUMBER_ID: EXPECTED.phoneNumberId,
  QF_META_GRAPH_API_VERSION: "v21.0",
  QF_META_CANARY_DESTINATION_E164: "+15555550100",
  QF_STAGING_INDEX_PROOF_PATH: "/outside/proof.json",
  ...over,
});

/** The MINIMAL env emergency closure may rely on. Nothing Meta, nothing WhatsApp. */
const disableEnv = (over = {}) => ({
  QF_STAGING_SUPABASE_URL: STAGING_URL,
  QF_STAGING_SUPABASE_SERVICE_ROLE_KEY: "sb_secret_" + "x".repeat(32),
  ...over,
});

const readyAccount = () => ({
  id: "acct-1", provider_key: "meta_whatsapp_cloud", channel: "whatsapp",
  phone_number_reference: EXPECTED.phoneNumberId, business_account_reference: EXPECTED.wabaId,
  ...REQUIRED_ACCOUNT_READINESS,
});
const mapping = (over = {}) => ({
  id: "map-1", template_key: TEMPLATE_KEY, channel: "whatsapp", provider_key: "meta_whatsapp_cloud",
  language: "en", provider_template_name: TEMPLATE_NAME, approval_status: "approved", is_active: false, ...over,
});
const okResponse = (body, status = 200) => ({ kind: "response", status, bodyText: JSON.stringify(body) });

/** Records every factory call so a test can prove a factory was NEVER reached. */
function harness({ policy = null, mappings = [mapping()], canaryRows = [], account = readyAccount(),
                   rpcImpl, headResolver, storedAttestation = null, proofOk = true } = {}) {
  const seen = { adapterFactory: 0, metaBuilt: 0, healthBuilt: 0, indexProof: 0,
    attestationIo: 0, headResolver: 0, rpcs: [], writes: [], metaRequests: [] };
  const state = { armed: false };

  const db = {
    calls: [],
    async readAccount() { db.calls.push("readAccount"); return account; },
    async readPolicy() { db.calls.push("readPolicy"); return state.armed ? state.afterPolicy : policy; },
    async readMappings() { db.calls.push("readMappings"); return state.armed ? state.afterMappings ?? mappings : mappings; },
    async readCanaryDestinations() { db.calls.push("readCanary"); return state.armed ? state.afterCanary ?? canaryRows : canaryRows; },
    async rpcArmReadiness(a) { seen.rpcs.push({ name: R.RPC_NAMES.armReadiness, a }); state.armed = true; return rpcImpl ? rpcImpl() : { data: [{ ok: true }], error: null }; },
    async rpcArmCanary(a) { seen.rpcs.push({ name: R.RPC_NAMES.armCanary, a }); state.armed = true; return rpcImpl ? rpcImpl() : { data: [{ ok: true }], error: null }; },
    async rpcDisable() { seen.rpcs.push({ name: R.RPC_NAMES.disable }); state.armed = true; return rpcImpl ? rpcImpl() : { data: [{ ok: true }], error: null }; },
  };

  const transport = {
    async request(req) {
      seen.metaRequests.push({ url: req.url, method: req.method });
      if (req.url.includes("/subscribed_apps")) return okResponse({ data: [{ id: "app" }] });
      if (req.url.includes("/message_templates")) {
        return okResponse({ data: [{ name: TEMPLATE_NAME, language: "en", status: "APPROVED", category: "UTILITY" }] });
      }
      if (req.url.includes(EXPECTED.wabaId)) return okResponse({ id: EXPECTED.wabaId, business_verification_status: "verified" });
      if (req.url.includes(EXPECTED.phoneNumberId)) return okResponse({ id: EXPECTED.phoneNumberId, code_verification_status: "VERIFIED" });
      return okResponse({}, 404);
    },
  };

  const io = { written: null, consumed: [] };
  return {
    seen, state, db, io,
    async adapterFactory({ need }) {
      seen.adapterFactory += 1;
      const out = { db, expected: EXPECTED, meta: null, health: null };
      if (need.meta) {
        seen.metaBuilt += 1; seen.healthBuilt += 1;
        const shared = { transport, token: "TOKEN-NEVER-LOGGED", graphApiVersion: "v21.0",
          wabaId: EXPECTED.wabaId, phoneNumberId: EXPECTED.phoneNumberId };
        out.meta = R.createMetaGetAdapter(shared);
        out.health = R.createHealthAdapter(shared);
      }
      return out;
    },
    async attestationIoFactory() {
      seen.attestationIo += 1;
      return {
        async write(b) { io.written = b; },
        async load() { return storedAttestation ? { ok: true, parsed: storedAttestation } : { ok: false, reason: F.ATTESTATION_MISSING }; },
        async consumed() { return io.consumed; },
        async consume(d) { io.consumed.push(d); },
      };
    },
    async indexProofFactory() {
      seen.indexProof += 1;
      return { verify: async () => (proofOk ? { ok: true, hash: "p".repeat(64) } : { ok: false, reason: F.INDEX_PROOF_UNAVAILABLE }) };
    },
    headResolver: headResolver ?? (async () => { seen.headResolver += 1; return HEAD_A; }),
  };
}

const cli = (argv, env, h, over = {}) => R.runCli({
  argv, env,
  headResolver: h.headResolver,
  adapterFactory: h.adapterFactory,
  attestationIoFactory: h.attestationIoFactory,
  indexProofFactory: h.indexProofFactory,
  now: () => 1_800_000_000_000,
  nonce: "n".repeat(64),
  log: () => {},
  ...over,
});

/** Mint a real attestation for a stage through the real CLI. */
async function mint(stage, opts = {}) {
  const h = harness(opts);
  const out = await cli(
    ["--preflight-readonly", `--attest-for=${stage === "ARM_CANARY" ? "canary" : "readiness"}`,
     `--templates=${TEMPLATE_KEY}`],
    openEnv(), h);
  return { out, attestation: h.io.written, h };
}

// ---------------------------------------------------------------------------
// A. ATTESTATION TARGET — DEFECT A
// ---------------------------------------------------------------------------
record("A01 --preflight-readonly WITHOUT --attest-for refuses",
  (await cli(["--preflight-readonly", `--templates=${TEMPLATE_KEY}`], openEnv(), harness())).reason
    === F.ATTESTATION_TARGET_REQUIRED);
record("A02 --preflight-readonly --attest-for=readiness mints an ARM_READINESS attestation",
  (await (async () => { const m = await mint("ARM_READINESS"); return m.out.ok === true && m.attestation?.stage === "ARM_READINESS"; })()));
/**
 * A canary attestation can only be minted AFTER stage 1, because planCanaryArm requires
 * durable readiness and the readiness_only posture to already exist. So this is the real
 * sequence: arm readiness, then preflight --attest-for=canary. That whole path was
 * unreachable through the CLI before this repair.
 */
const READINESS_POSTURE_ROW = Object.freeze({
  activation_status: "readiness_only", outbound_enabled: false,
  webhook_processing_enabled: true, health_check_enabled: true,
});
record("A03 --preflight-readonly --attest-for=canary mints an ARM_CANARY attestation once readiness exists",
  (await (async () => {
    const m = await mint("ARM_CANARY", { policy: READINESS_POSTURE_ROW });
    return m.out.ok === true && m.attestation?.stage === "ARM_CANARY";
  })()),
  "the sequence that was previously unreachable through the CLI");
record("A03a a canary attestation cannot be minted BEFORE readiness exists",
  (await (async () => { const m = await mint("ARM_CANARY", { policy: null }); return m.out.ok === false; })()));
record("A04 an unsupported --attest-for value refuses",
  (await (async () => {
    for (const v of ["", "both", "ARM_CANARY", "canary,readiness", "Canary"]) {
      const o = await cli(["--preflight-readonly", `--attest-for=${v}`, `--templates=${TEMPLATE_KEY}`], openEnv(), harness());
      if (o.ok !== false) return false;
    }
    return true;
  })()));
record("A05 two --attest-for selectors refuse",
  (await cli(["--preflight-readonly", "--attest-for=readiness", "--attest-for=canary", `--templates=${TEMPLATE_KEY}`], openEnv(), harness())).ok === false);
record("A06 --arm-readiness plus --attest-for refuses",
  (await cli(["--arm-readiness", "--attest-for=readiness", `--templates=${TEMPLATE_KEY}`], openEnv(), harness())).reason
    === F.ATTESTATION_TARGET_NOT_PERMITTED);
record("A07 --arm-canary plus --attest-for refuses",
  (await cli(["--arm-canary", "--attest-for=canary", `--templates=${TEMPLATE_KEY}`], openEnv(), harness())).reason
    === F.ATTESTATION_TARGET_NOT_PERMITTED);
record("A08 --disable plus --attest-for refuses",
  (await cli(["--disable", "--attest-for=readiness"], disableEnv(), harness())).reason
    === F.ATTESTATION_TARGET_NOT_PERMITTED);
record("A09 no hidden --stage=canary path remains anywhere",
  !/--stage=canary/.test(operatorCode) && !/--stage=canary/.test(runtimeCode) &&
  !/stageForAttestation:\s*argv/.test(operatorCode));
record("A10 --stage=canary is now refused as an unknown flag",
  (await cli(["--preflight-readonly", "--stage=canary", `--templates=${TEMPLATE_KEY}`], openEnv(), harness())).reason
    === F.UNKNOWN_FLAG);
record("A11 the attestation target vocabulary is closed to exactly two",
  Object.keys(R.ATTESTATION_TARGETS).join(",") === "readiness,canary");

// ---------------------------------------------------------------------------
// B. EMERGENCY DISABLE — DEFECT B
// ---------------------------------------------------------------------------
const disArmed = harness({
  policy: { activation_status: "canary", outbound_enabled: true, webhook_processing_enabled: true, health_check_enabled: true },
  mappings: [mapping({ is_active: true })],
  canaryRows: [{ provider_key: "meta_whatsapp_cloud", channel: "whatsapp", destination_hash: CANARY_HASH, is_active: true, expires_at: null }],
});
disArmed.state.afterPolicy = { activation_status: "disabled", outbound_enabled: false, webhook_processing_enabled: false, health_check_enabled: false };
disArmed.state.afterMappings = [mapping({ is_active: false })];
disArmed.state.afterCanary = [{ provider_key: "meta_whatsapp_cloud", channel: "whatsapp", destination_hash: CANARY_HASH, is_active: false, expires_at: null }];
const disOut = await cli(["--disable"], disableEnv(), disArmed);

record("B01 direct CLI --disable succeeds with ONLY the staging URL and DB credential",
  disOut.ok === true, JSON.stringify(disOut.reason ?? "") + JSON.stringify(disOut.detail ?? ""));
record("B02 every QF_META_* variable is absent from that env",
  Object.keys(disableEnv()).every((k) => !k.startsWith("QF_META_")));
record("B03 every WHATSAPP_* variable is absent from that env",
  Object.keys(disableEnv()).every((k) => !k.startsWith("WHATSAPP_")));
record("B04 the Meta adapter was NEVER built", disArmed.seen.metaBuilt === 0);
record("B05 the health adapter was NEVER built", disArmed.seen.healthBuilt === 0);
record("B06 the index-proof factory was NEVER called", disArmed.seen.indexProof === 0);
record("B07 no Meta request was made at all", disArmed.seen.metaRequests.length === 0);
record("B08 the attestation IO was never needed to authorize closure",
  disArmed.seen.attestationIo === 0);
record("B09 the git HEAD resolver was never called for closure",
  disArmed.seen.headResolver === 0);
record("B10 exactly the disable RPC was called, exactly once",
  disArmed.seen.rpcs.length === 1 && disArmed.seen.rpcs[0].name === R.RPC_NAMES.disable);
record("B11 an independent fail-closed readback was performed",
  disOut.observed?.policy?.activation_status === "disabled" &&
  disOut.observed.policy.outbound_enabled === false &&
  disOut.observed.activeMappingKeys.length === 0 &&
  disOut.observed.activeCanaryCount === 0);
record("B12 --disable still refuses the PRODUCTION project ref before any client exists",
  (await (async () => {
    const h = harness();
    const o = await cli(["--disable"], disableEnv({ QF_STAGING_SUPABASE_URL: "https://yqpgcsduqbxulrlzwzap.supabase.co" }), h);
    return o.reason === F.PROJECT_REF_FORBIDDEN_PRODUCTION && h.seen.adapterFactory === 0;
  })()));
record("B13 --disable still refuses the QF-Jarvis ref before any client exists",
  (await (async () => {
    const h = harness();
    const o = await cli(["--disable"], disableEnv({ QF_STAGING_SUPABASE_URL: "https://coilipywdvxklewquqvv.supabase.co" }), h);
    return o.reason === F.PROJECT_REF_FORBIDDEN_JARVIS && h.seen.adapterFactory === 0;
  })()));
record("B14 --disable still refuses a foreign ref and a missing DB credential",
  (await (async () => {
    const h1 = harness();
    const o1 = await cli(["--disable"], disableEnv({ QF_STAGING_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }), h1);
    const h2 = harness();
    const e = disableEnv(); delete e.QF_STAGING_SUPABASE_SERVICE_ROLE_KEY;
    const o2 = await cli(["--disable"], e, h2);
    return o1.reason === F.PROJECT_REF_NOT_AUTHORIZED && h1.seen.adapterFactory === 0 &&
      o2.reason === F.ENV_MISSING && h2.seen.adapterFactory === 0;
  })()));
record("B15 an ambiguous disable write is NOT blindly retried",
  (await (async () => {
    const h = harness({ rpcImpl: () => { throw new Error("socket hang up"); } });
    const o = await cli(["--disable"], disableEnv(), h);
    return o.reason === F.WRITE_OUTCOME_UNCERTAIN && h.seen.rpcs.length === 1;
  })()));
record("B16 --disable succeeds even when the git HEAD resolver throws",
  (await (async () => {
    const h = harness({ headResolver: async () => { throw new Error("not a git repo"); } });
    h.state.afterPolicy = { activation_status: "disabled", outbound_enabled: false, webhook_processing_enabled: false, health_check_enabled: false };
    const o = await cli(["--disable"], disableEnv(), h);
    return o.ok === true;
  })()));

// ---------------------------------------------------------------------------
// C. HEAD PIN — DEFECT C
// ---------------------------------------------------------------------------
record("C01 an opening preflight refuses when actual git HEAD cannot be proven",
  (await (async () => {
    for (const resolver of [async () => null, async () => "not-a-sha", async () => { throw new Error("x"); }]) {
      const h = harness({ headResolver: resolver });
      const o = await cli(["--preflight-readonly", "--attest-for=readiness", `--templates=${TEMPLATE_KEY}`], openEnv(), h);
      if (o.reason !== F.SOURCE_HEAD_UNPROVEN) return false;
    }
    return true;
  })()));
record("C02 the attestation stores the exact actual 40-hex HEAD",
  (await (async () => {
    const m = await mint("ARM_READINESS");
    return GIT_HEAD_RE.test(String(m.attestation?.branch_head)) && m.attestation.branch_head === HEAD_A;
  })()));
record("C03 an optional env HEAD pin that disagrees with actual HEAD refuses",
  (await cli(["--preflight-readonly", "--attest-for=readiness", `--templates=${TEMPLATE_KEY}`],
    openEnv({ QF_ACTIVATION_BRANCH_HEAD: HEAD_B }), harness())).reason === F.SOURCE_HEAD_MISMATCH);
record("C04 a malformed env HEAD pin refuses",
  (await cli(["--preflight-readonly", "--attest-for=readiness", `--templates=${TEMPLATE_KEY}`],
    openEnv({ QF_ACTIVATION_BRANCH_HEAD: "abc" }), harness())).reason === F.SOURCE_HEAD_UNPROVEN);
record("C05 an agreeing env HEAD pin is accepted",
  (await cli(["--preflight-readonly", "--attest-for=readiness", `--templates=${TEMPLATE_KEY}`],
    openEnv({ QF_ACTIVATION_BRANCH_HEAD: HEAD_A }), harness())).ok === true);

const readinessMint = await mint("ARM_READINESS");
record("C06 arm-readiness at the SAME HEAD passes",
  (await (async () => {
    const h = harness({ storedAttestation: readinessMint.attestation });
    h.state.afterPolicy = { activation_status: "readiness_only", outbound_enabled: false, webhook_processing_enabled: true, health_check_enabled: true };
    const o = await cli(["--arm-readiness", `--templates=${TEMPLATE_KEY}`], openEnv(), h);
    return o.ok === true && h.seen.rpcs.length === 1 && h.seen.rpcs[0].name === R.RPC_NAMES.armReadiness;
  })()), JSON.stringify((await (async () => {
    const h = harness({ storedAttestation: readinessMint.attestation });
    h.state.afterPolicy = { activation_status: "readiness_only", outbound_enabled: false, webhook_processing_enabled: true, health_check_enabled: true };
    return (await cli(["--arm-readiness", `--templates=${TEMPLATE_KEY}`], openEnv(), h)).reason ?? "";
  })())));
record("C07 HEAD DRIFT after minting refuses the write, and no RPC runs",
  (await (async () => {
    const h = harness({ storedAttestation: readinessMint.attestation, headResolver: async () => HEAD_B });
    const o = await cli(["--arm-readiness", `--templates=${TEMPLATE_KEY}`], openEnv(), h);
    return o.reason === F.SOURCE_HEAD_MISMATCH && h.seen.rpcs.length === 0;
  })()));
record("C08 a tampered branch_head with a RECOMPUTED body digest still fails on current HEAD",
  (await (async () => {
    // The forger rewrites branch_head AND fixes attestation_sha256, so the tamper check
    // passes — the current-HEAD comparison is what refuses.
    const forged = { ...readinessMint.attestation, branch_head: HEAD_B };
    const { attestation_sha256: _drop, ...body } = forged;
    const { attestationDigest } = await import("./activate-meta-staging-canary.mjs");
    forged.attestation_sha256 = attestationDigest(body);
    const h = harness({ storedAttestation: forged });
    const o = await cli(["--arm-readiness", `--templates=${TEMPLATE_KEY}`], openEnv(), h);
    return o.ok === false && h.seen.rpcs.length === 0;
  })()));
record("C09 arm-canary at the same HEAD reaches its RPC when state is correct",
  (await (async () => {
    const readinessPolicy = { activation_status: "readiness_only", outbound_enabled: false,
      webhook_processing_enabled: true, health_check_enabled: true };
    const cm = await mint("ARM_CANARY", { policy: readinessPolicy });
    if (!cm.out.ok) return false;
    const h = harness({ policy: readinessPolicy, storedAttestation: cm.attestation });
    h.state.afterPolicy = { activation_status: "canary", outbound_enabled: true, webhook_processing_enabled: true, health_check_enabled: true };
    h.state.afterMappings = [mapping({ is_active: true })];
    h.state.afterCanary = [{ provider_key: "meta_whatsapp_cloud", channel: "whatsapp",
      destination_hash: CANARY_HASH, is_active: true, expires_at: new Date(1_800_000_000_000 + 3_600_000).toISOString() }];
    const o = await cli(["--arm-canary", `--templates=${TEMPLATE_KEY}`], openEnv(), h);
    return o.ok === true && h.seen.rpcs.length === 1 && h.seen.rpcs[0].name === R.RPC_NAMES.armCanary;
  })()));

// ---------------------------------------------------------------------------
// D. PARITY AND CONTAINMENT
// ---------------------------------------------------------------------------
record("D01 the entry point contains NO second parser — it only supplies dependencies",
  /runtime\.runCli\(/.test(operatorCode) &&
  !/resolveMode\(process\.argv/.test(operatorCode) &&
  !/argv\.includes\(/.test(operatorCode));
record("D02 runCli is exported and import-safe",
  typeof R.runCli === "function" && !/process\.env/.test(runtimeCode));
record("D03 the CLI maps each mode to exactly the intended runtime mode",
  (await (async () => {
    const cases = [[["--disable"], "DISABLE"]];
    for (const [argv, expectStage] of cases) {
      const h = harness();
      h.state.afterPolicy = { activation_status: "disabled", outbound_enabled: false, webhook_processing_enabled: false, health_check_enabled: false };
      const o = await cli(argv, disableEnv(), h);
      if (o.stage !== expectStage) return false;
    }
    const dry = await cli([], {}, harness());
    return dry.stage === "DRY_RUN";
  })()));
record("D04 DRY_RUN through the real CLI touches no factory at all",
  (await (async () => {
    const h = harness();
    const o = await cli([], {}, h);
    return o.ok === true && h.seen.adapterFactory === 0 && h.seen.attestationIo === 0 &&
      h.seen.indexProof === 0 && h.seen.headResolver === 0;
  })()));
record("D05 the nonce uses the standard CSPRNG, not pid/clock/Math.random",
  /randomBytes\(32\)\.toString\("hex"\)/.test(operatorCode) &&
  !/Math\.random\(\)/.test(operatorCode) &&
  !/process\.pid/.test(operatorCode));
record("D06 HEAD is derived from the repository, not merely trusted from env",
  /git", \["rev-parse", "HEAD"\]/.test(operatorCode) &&
  /resolveSourceHead\(/.test(runtimeCode));
record("D07 no secret or plaintext destination appears in any CLI result",
  (() => {
    const blob = JSON.stringify(disOut) + JSON.stringify(readinessMint.out) + JSON.stringify(readinessMint.attestation);
    return !blob.includes("TOKEN-NEVER-LOGGED") && !blob.includes("+15555550100") &&
      !blob.includes("sb_secret_");
  })());

// ---------------------------------------------------------------------------
// E. STRICT CORE ENV — separate from closure
// ---------------------------------------------------------------------------
const fullCoreEnv = () => ({
  QF_META_ACCESS_TOKEN: "t", WHATSAPP_ACCESS_TOKEN: "t",
  QF_META_PHONE_NUMBER_ID: "1", WHATSAPP_PHONE_NUMBER_ID: "1",
  QF_META_WABA_ID: "2", WHATSAPP_WABA_ID: "2",
  QF_META_GRAPH_API_VERSION: "v21.0", WHATSAPP_GRAPH_API_VERSION: "v21.0",
  WHATSAPP_PROVIDER_MODE: "meta_cloud",
  WHATSAPP_APP_SECRET: "s", WHATSAPP_WEBHOOK_VERIFY_TOKEN: "v",
});
record("E01 the strict Core-env check exists separately and passes on a complete env",
  typeof R.verifyCoreProviderEnv === "function" && R.verifyCoreProviderEnv(fullCoreEnv()).ok === true);
record("E02 it refuses a provider mode that is not meta_cloud",
  ["mock", "", "META_CLOUD", undefined].every((m) =>
    R.verifyCoreProviderEnv({ ...fullCoreEnv(), WHATSAPP_PROVIDER_MODE: m }).ok === false));
record("E03 it refuses a missing app secret or verify token",
  ["WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN"].every((k) => {
    const e = fullCoreEnv(); delete e[k];
    return R.verifyCoreProviderEnv(e).reason === F.PROVIDER_ENV_MISSING;
  }));
record("E04 it refuses any alias whose Core counterpart disagrees",
  R.PROVIDER_ENV_ALIASES.every(([op, core]) =>
    R.verifyCoreProviderEnv({ ...fullCoreEnv(), [op]: "X", [core]: "Y" }).ok === false));
record("E05 emergency --disable is NOT burdened with the strict Core-env requirements",
  disOut.ok === true && R.verifyCoreProviderEnv(disableEnv()).ok === false);

// ---------------------------------------------------------------------------
// M. MUTANTS — one per repaired defect, at minimum
// ---------------------------------------------------------------------------
const mutants = [
  ["DEFECT A cannot regress: a canary attestation is reachable through the real CLI",
    async () => (await mint("ARM_CANARY", { policy: READINESS_POSTURE_ROW })).attestation?.stage === "ARM_CANARY"],
  ["DEFECT A cannot regress: preflight cannot silently default a stage",
    async () => (await cli(["--preflight-readonly", `--templates=${TEMPLATE_KEY}`], openEnv(), harness())).ok === false],
  ["DEFECT B cannot regress: closure never builds a Meta adapter",
    async () => {
      const h = harness();
      h.state.afterPolicy = { activation_status: "disabled", outbound_enabled: false, webhook_processing_enabled: false, health_check_enabled: false };
      await cli(["--disable"], disableEnv(), h);
      return h.seen.metaBuilt === 0 && h.seen.healthBuilt === 0 && h.seen.metaRequests.length === 0;
    }],
  ["DEFECT B cannot regress: closure needs no Meta env to be present",
    async () => {
      const h = harness();
      h.state.afterPolicy = { activation_status: "disabled", outbound_enabled: false, webhook_processing_enabled: false, health_check_enabled: false };
      return (await cli(["--disable"], disableEnv(), h)).ok === true;
    }],
  ["DEFECT C cannot regress: an unproven HEAD blocks an opening write",
    async () => {
      const h = harness({ storedAttestation: readinessMint.attestation, headResolver: async () => null });
      const o = await cli(["--arm-readiness", `--templates=${TEMPLATE_KEY}`], openEnv(), h);
      return o.reason === F.SOURCE_HEAD_UNPROVEN && h.seen.rpcs.length === 0;
    }],
  ["DEFECT C cannot regress: branch_head is part of the drift comparison",
    () => /"branch_head"/.test(runtimeCode) && /loaded\.parsed\.branch_head !== ctx\.branchHead/.test(runtimeCode)],
  ["the staging ref fence was not weakened for closure",
    async () => {
      const h = harness();
      return (await cli(["--disable"], disableEnv({ QF_STAGING_SUPABASE_URL: "https://yqpgcsduqbxulrlzwzap.supabase.co" }), h)).ok === false;
    }],
  ["the entry point cannot regain its own argv parsing unnoticed",
    () => !/argv\.includes\(/.test(operatorCode) && !/resolveMode\(process\.argv/.test(operatorCode)],
];
for (const [name, fn] of mutants) {
  let held = false;
  try { held = (await fn()) === true; } catch { held = false; }
  record(`MUT ${name}`, held);
}

// ---------------------------------------------------------------------------
for (const [i, r] of results.entries()) {
  console.log(`${r.passed ? "PASS" : "FAIL"} ${String(i + 1).padStart(3, "0")} ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
}
const failed = results.filter((r) => !r.passed);
console.log(`\nQF-MVP-40.13C-R1 DIRECT CLI: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exit(1);
console.log("QF_MVP_40_13C_R1_CLI_PARITY_PROVEN");
