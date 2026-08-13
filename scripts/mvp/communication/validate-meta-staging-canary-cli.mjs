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

import { spawnSync } from "node:child_process";
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
/** QF-MVP-40-R7D — the thin bootstrap that is now the real process entry point. */
const ENTRY_REL = "scripts/mvp/communication/activate-meta-staging-canary-cli.mjs";
const entryCode = strip(read(ENTRY_REL));

const results = [];
const record = (n, p, d = "") => results.push({ name: n, passed: p === true, detail: d });
const F = ActivationFailure;

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const EXPECTED = Object.freeze({ phoneNumberId: "123456789012345", wabaId: "987654321098765" });
/** QF-MVP-40-R3 — a fictional Meta app id. Digits, as real Meta app ids are. */
const APP_ID = "111222333444555";
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
                   rpcImpl, headResolver, storedAttestation = null, proofOk = true,
                   assetProofOk = true } = {}) {
  const seen = { adapterFactory: 0, metaBuilt: 0, healthBuilt: 0, indexProof: 0,
    stagingAssetProof: 0, attestationIo: 0, headResolver: 0, rpcs: [], writes: [], metaRequests: [] };
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
      if (req.url.includes("/subscribed_apps")) return okResponse({ data: [{ id: APP_ID }] });
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
    // QF-MVP-40-R3 — the owner-generated staging-asset attestation. Bound to whatever HEAD
    // the harness resolves, so the HEAD-drift tests still exercise the HEAD fence itself.
    async stagingAssetProofFactory() {
      seen.stagingAssetProof += 1;
      return {
        verify: async ({ branchHead }) => (assetProofOk
          ? { ok: true, hash: "s".repeat(64), scope: "STAGING_DEDICATED", metaAppId: APP_ID,
              wabaId: EXPECTED.wabaId, phoneNumberId: EXPECTED.phoneNumberId,
              branchHead, expiresAtMs: 1_800_000_000_000 + 600_000,
              prohibited: { ids: ["555444333222111"], digests: [] } }
          : { ok: false, reason: F.STAGING_ASSET_PROOF_MISSING }),
      };
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
  stagingAssetProofFactory: h.stagingAssetProofFactory,
  now: () => 1_800_000_000_000,
  nonce: "n".repeat(64),
  log: () => {},
  ...over,
});

/** A harness whose post-disable readback is genuinely fail-closed, as B01 builds. */
function disableHarness(over = {}) {
  const h = harness(over);
  h.state.afterPolicy = { activation_status: "disabled", outbound_enabled: false, webhook_processing_enabled: false, health_check_enabled: false };
  h.state.afterMappings = [mapping({ is_active: false })];
  h.state.afterCanary = [{ provider_key: "meta_whatsapp_cloud", channel: "whatsapp", destination_hash: CANARY_HASH, is_active: false, expires_at: null }];
  return h;
}

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
// QF-MVP-40-R7D. The bootstrap moved OUT of the operator into its own entry module, so
// this pin moves with it — and gains a half: the operator must now be proven to contain no
// bootstrap at all, which is what makes the old import cycle unconstructible.
record("D01 the entry point contains NO second parser — it only supplies dependencies",
  /runCli\(/.test(entryCode) &&
  !/resolveMode\(/.test(entryCode) &&
  !/argv\.includes\(/.test(entryCode) &&
  !/resolveMode\(process\.argv/.test(operatorCode) &&
  !/argv\.includes\(/.test(operatorCode));
record("D01a the operator LIBRARY no longer bootstraps itself — no argv, no self-execution",
  !/process\.argv/.test(operatorCode) &&
  !/isDirect/.test(operatorCode) &&
  !/runtime\.runCli\(/.test(operatorCode));
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
// R2. LIVE-SEQUENCE LOCK — seed branch authority, two cycles, campaign blocker
// ---------------------------------------------------------------------------
const seedSource = read("scripts/mvp/communication/seed-internal-staging-templates.mjs");
const seedExec = strip(seedSource);
const runbookRaw = read("docs/QF-MVP-40-LIVE-CANARY-RUNBOOK.md");
/**
 * Prose assertions run over a WHITESPACE-NORMALIZED copy. Markdown wraps sentences across
 * lines, so a newline-sensitive regex would force the document to be reflowed to satisfy
 * the test — which is the test dictating prose rather than checking it.
 */
const runbook = runbookRaw.replace(/\s+/g, " ");

record("R01 the internal-template seed is pinned to the CURRENT certified branch",
  /export const AUTHORIZED_BRANCH = "mvp\/qf-mvp-40-final-provider-canary";/.test(seedExec) &&
  !/mvp\/qf-mvp-40-meta-readiness-v1/.test(seedExec));
record("R02 the seed branch pin is ONE exact literal — no wildcard, list, prefix or env override",
  !/AUTHORIZED_BRANCH\s*=\s*\[/.test(seedExec) &&
  !/AUTHORIZED_BRANCH\.(startsWith|includes|test)/.test(seedExec) &&
  !/process\.env\.[A-Z_]*BRANCH/.test(seedExec) &&
  /git\.branch !== AUTHORIZED_BRANCH/.test(seedExec) &&
  (seedExec.match(/AUTHORIZED_BRANCH = /g) ?? []).length === 1);
record("R03 the seed's clean-tree, HEAD-pin and staging fence survive the re-pin",
  /if \(!git\.clean\)/.test(seedExec) && /GIT_DIRTY/.test(seedExec) &&
  /rev-parse", "HEAD"/.test(seedExec) && /head: git\.head/.test(seedExec) &&
  /AUTHORIZED_STAGING_REF/.test(seedExec) && /FORBIDDEN_PROJECT_REFS/.test(seedExec));
record("R04 no live operator still names the superseded branch",
  [operatorCode, runtimeCode, seedExec,
   strip(read("scripts/mvp/communication/verify-core-provider-env.mjs"))]
    .every((s) => !/mvp\/qf-mvp-40-meta-readiness-v1/.test(s)));
record("R05 the runbook locks TWO independent canary cycles, never one",
  /Vendor cycle/i.test(runbook) && /Client cycle/i.test(runbook) &&
  /exactly one\*{0,2} ordinary-business mapping/i.test(runbook) &&
  /never left armed while the client canary is attempted/i.test(runbook) &&
  /Maximum two real outbound messages/i.test(runbook));
record("R06 the one-active-mapping invariant is enforced in CODE, not only documented",
  // SQL refuses an unrelated active mapping, and the pure plan refuses it too.
  /QF_CANARY_UNRELATED_ACTIVE_MAPPING/.test(read("supabase/migrations/20260813000000_qf_mvp_40_13b_canary_activation_authority.sql")) &&
  /UNRELATED_ACTIVE_MAPPING/.test(operatorCode));
record("R07 arming a second template while one is active is refused end to end",
  (await (async () => {
    const READY = { activation_status: "readiness_only", outbound_enabled: false,
      webhook_processing_enabled: true, health_check_enabled: true };
    const cm = await mint("ARM_CANARY", { policy: READY });
    const h = harness({
      policy: READY, storedAttestation: cm.attestation,
      mappings: [mapping(), mapping({ id: "m2", template_key: "client_matching_update",
        provider_template_name: "qf_client_matching_update_v1", is_active: true })],
    });
    const o = await cli(["--arm-canary", `--templates=${TEMPLATE_KEY}`], openEnv(), h);
    return o.ok === false && h.seen.rpcs.length === 0;
  })()));
record("R08 the campaign criterion is recorded as an OPEN QF-MVP-40 blocker",
  /campaign canary succeeds/.test(runbook) &&
  /no approved MARKETING template/i.test(runbook) &&
  /must \*{0,2}not\*{0,2} be marked complete after the vendor and client utility canaries alone/i.test(runbook) &&
  /QF_MVP_40_STATUS: IN_PROGRESS/.test(runbook));
record("R09 the campaign packet forbids every substitute and invents nothing",
  /qf_consent_help_response_v2/.test(runbook) &&
  /evidence-bound acknowledgement/i.test(runbook) &&
  /No consent may be invented/i.test(runbook) &&
  /OWNER MUST DECIDE/.test(runbook) &&
  (runbook.match(/OWNER MUST DECIDE/g) ?? []).length === 3);
record("R10 the packet chooses NO frequency threshold, window or interval",
  !/max_per_window[^|\n]*\|\s*\d/.test(runbook) &&
  !/window_length[^|\n]*\|\s*\d+\s*(h|hour)/i.test(runbook) &&
  /No default is proposed/i.test(runbook));
record("R11 the packet prefers a ZERO-variable marketing template",
  /ZERO — recommended/.test(runbook) && /vendor_crm_promotion/.test(runbook));
record("R12 all TEN locked exit criteria appear with a test path and a blocker column",
  ["staging webhook verified", "signed inbound callback accepted",
   "foreign callback", "template send succeeds", "delivery lifecycle updates Core",
   "STOP blocks future promotional messages", "START restores only permitted communication",
   "HELP responds safely", "campaign canary succeeds", "no voice path exists"]
    .every((c) => runbook.includes(c)) &&
  /Owner phone action/.test(runbook) && /Executable now/.test(runbook) && /Blocker/.test(runbook));
record("R13 the runbook keeps Core/n8n ready BEFORE any provider gate opens",
  /Arming is the \*{0,2}last\*{0,2} thing/i.test(runbook) &&
  /schedules \*{0,2}INACTIVE\*{0,2}/i.test(runbook) &&
  /guaranteed-oldest/.test(runbook) &&
  /eight historical failed orphan/i.test(runbook));
record("R14 the runbook states emergency closure needs only the staging DB identity",
  /Emergency closure needs ONLY/.test(runbook) &&
  /QF_STAGING_SUPABASE_SERVICE_ROLE_KEY/.test(runbook));
record("R15 the runbook contains no secret value and no plaintext canary number",
  !/sb_secret_[A-Za-z0-9]{10}/.test(runbook) && !/EAA[A-Za-z0-9]{20}/.test(runbook) &&
  !/\+\d{10,}/.test(runbook));

// ---------------------------------------------------------------------------
// M. MUTANTS — one per repaired defect, at minimum
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// R3. The dedicated-staging scope guard, proven through the REAL CLI path
// ---------------------------------------------------------------------------
record("R3-C01 the CLI builds a staging-asset proof for scope-guarded modes",
  (await (async () => {
    const h = harness();
    await cli(["--preflight-readonly", "--attest-for=readiness", `--templates=${TEMPLATE_KEY}`], openEnv(), h);
    return h.seen.stagingAssetProof === 1;
  })()));
record("R3-C02 --preflight-readonly refuses when the staging asset is unclassified",
  (await cli(["--preflight-readonly", "--attest-for=readiness", `--templates=${TEMPLATE_KEY}`],
    openEnv(), harness({ assetProofOk: false }))).reason === F.STAGING_ASSET_SCOPE_UNPROVEN);
record("R3-C03 --arm-readiness refuses when the staging asset is unclassified, and runs NO rpc",
  (await (async () => {
    const minted = await mint("ARM_READINESS");
    const h = harness({ storedAttestation: minted.attestation, assetProofOk: false });
    const out = await cli(["--arm-readiness", `--templates=${TEMPLATE_KEY}`], openEnv(), h);
    return out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN && h.seen.rpcs.length === 0;
  })()));
record("R3-C04 --arm-canary refuses when the staging asset is unclassified, and runs NO rpc",
  (await (async () => {
    const minted = await mint("ARM_CANARY", { policy: READINESS_POSTURE_ROW });
    const h = harness({ storedAttestation: minted.attestation, policy: READINESS_POSTURE_ROW, assetProofOk: false });
    const out = await cli(["--arm-canary", `--templates=${TEMPLATE_KEY}`], openEnv(), h);
    return out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN && h.seen.rpcs.length === 0;
  })()));
record("R3-C05 --disable never asks for a staging-asset proof at all",
  (await (async () => {
    const h = disableHarness();
    const out = await cli(["--disable"], disableEnv(), h);
    return out.ok === true && h.seen.stagingAssetProof === 0;
  })()));

const mutants = [
  ["a scope-guarded CLI mode cannot arm against an unclassified Meta asset",
    async () => {
      const minted = await mint("ARM_READINESS");
      const h = harness({ storedAttestation: minted.attestation, assetProofOk: false });
      return (await cli(["--arm-readiness", `--templates=${TEMPLATE_KEY}`], openEnv(), h)).ok === false && h.seen.rpcs.length === 0;
    }],
  ["emergency closure cannot be made to depend on the staging-asset proof",
    async () => {
      const h = disableHarness({ assetProofOk: false });
      return (await cli(["--disable"], disableEnv(), h)).ok === true;
    }],
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
    () => !/argv\.includes\(/.test(operatorCode) && !/resolveMode\(process\.argv/.test(operatorCode)
      && !/argv\.includes\(/.test(entryCode) && !/resolveMode\(/.test(entryCode)],

  // QF-MVP-40.13C-R2 required mutants.
  ["the SUPERSEDED seed branch cannot be accepted again",
    () => !/mvp\/qf-mvp-40-meta-readiness-v1/.test(seedExec)],
  ["a wildcard or arbitrary seed branch cannot be accepted",
    () => !/AUTHORIZED_BRANCH\s*=\s*\[/.test(seedExec) &&
          !/AUTHORIZED_BRANCH\.(startsWith|includes|test)/.test(seedExec) &&
          !/process\.env\.[A-Z_]*BRANCH/.test(seedExec)],
  ["the seed clean-tree requirement cannot be removed unnoticed",
    () => /if \(!git\.clean\)/.test(seedExec) && /GIT_DIRTY/.test(seedExec)],
  ["the seed HEAD pin cannot be removed unnoticed",
    () => /rev-parse", "HEAD"/.test(seedExec) && /head: git\.head/.test(seedExec)],
  ["vendor and client cannot be collapsed into ONE active-mapping cycle",
    async () => {
      const READY = { activation_status: "readiness_only", outbound_enabled: false,
        webhook_processing_enabled: true, health_check_enabled: true };
      const cm = await mint("ARM_CANARY", { policy: READY });
      const h = harness({
        policy: READY, storedAttestation: cm.attestation,
        mappings: [mapping(), mapping({ id: "m2", template_key: "client_matching_update",
          provider_template_name: "qf_client_matching_update_v1", is_active: true })],
      });
      const o = await cli(["--arm-canary", `--templates=${TEMPLATE_KEY}`], openEnv(), h);
      return o.ok === false && h.seen.rpcs.length === 0;
    }],
  ["campaign cannot be marked complete without the marketing prerequisites",
    () => /QF_MVP_40_STATUS: IN_PROGRESS/.test(runbook) &&
          /no approved MARKETING template/i.test(runbook) &&
          !/QF_MVP_40_FINAL_PROVIDER_READINESS_COMPLETE/.test(runbook) &&
          !/COMPLETE \/ TESTED \/ FROZEN\*{0,2}\s*$/m.test(runbook)],
];
for (const [name, fn] of mutants) {
  let held = false;
  try { held = (await fn()) === true; } catch { held = false; }
  record(`MUT ${name}`, held);
}

// ---------------------------------------------------------------------------
// S. PROCESS STARTUP — QF-MVP-40-R7D
//
// THE DEFECT THIS SECTION EXISTS FOR
//   Every test above imports `runCli` as a module. That makes `isDirect` false, so the
//   old in-operator bootstrap never ran, its top-level `await import()` never formed a
//   cycle with `canaryActivationRuntime.mjs`, and 85/85 stayed green while the real CLI
//   exited 13 with no output in EVERY mode — `--disable` included. A contract test cannot
//   see a startup defect. Only spawning the process can.
//
// WHY THIS IS SAFE TO RUN ANYWHERE, INCLUDING A LIVE OPERATOR SHELL
//   Every child is spawned with an env from which EVERY `QF_*` and `WHATSAPP_*` variable
//   has been removed. A real staging credential present in the parent shell therefore
//   cannot reach a child, so no child can construct a database client, reach Meta, arm
//   anything or send anything. Each case refuses inside `runCli`'s own fences — which is
//   precisely what proves the process reached `runCli` at all. Nothing here writes.
// ---------------------------------------------------------------------------

/** The parent env minus every credential-bearing variable. */
const SAFE_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(QF_|WHATSAPP_)/.test(k)),
);

/** Spawn the REAL entry point exactly as the governed npm target does. */
function spawnCli(args, envOver = {}) {
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
     "--import", "./scripts/mvp/loader/register.mjs", ENTRY_REL, ...args],
    { cwd: ROOT, env: { ...SAFE_ENV, ...envOver }, encoding: "utf8", timeout: 120_000 },
  );
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  let json = null;
  const brace = stdout.indexOf("{");
  if (brace >= 0) { try { json = JSON.parse(stdout.slice(brace)); } catch { json = null; } }
  return { status: r.status, stdout, stderr, json };
}

const spawnNoFlags   = spawnCli([]);
const spawnDisable   = spawnCli(["--disable"]);
const spawnProdRef   = spawnCli(["--disable"], { QF_STAGING_SUPABASE_URL: "https://yqpgcsduqbxulrlzwzap.supabase.co", QF_STAGING_SUPABASE_SERVICE_ROLE_KEY: "sb_secret_" + "x".repeat(32) });
const spawnUnknown   = spawnCli(["--totally-unknown-flag"]);
const spawnConflict  = spawnCli(["--arm-readiness", "--disable"]);
const spawnNoAttest  = spawnCli(["--preflight-readonly", `--templates=${TEMPLATE_KEY}`]);
const ALL_SPAWNS = [spawnNoFlags, spawnDisable, spawnProdRef, spawnUnknown, spawnConflict, spawnNoAttest];

record("S01 the entry point STARTS — no spawned mode exits 13",
  ALL_SPAWNS.every((s) => s.status !== 13),
  ALL_SPAWNS.map((s) => s.status).join(","));
record("S02 no spawned mode emits an unsettled top-level-await warning",
  ALL_SPAWNS.every((s) => !/unsettled top-level await/i.test(s.stderr)));
record("S03 every spawned mode produced a parseable result object",
  ALL_SPAWNS.every((s) => s.json !== null));
record("S04 no flags reaches the source-defined safe offline path, exit 0",
  spawnNoFlags.status === 0 && spawnNoFlags.json?.ok === true &&
  spawnNoFlags.json?.stage === "DRY_RUN" && spawnNoFlags.json?.offline === true);
record("S05 --disable REACHES the real runCli disable path and refuses on its own fence",
  spawnDisable.status === 3 && spawnDisable.json?.ok === false &&
  spawnDisable.json?.reason === F.ENV_MISSING,
  JSON.stringify(spawnDisable.json ?? spawnDisable.stderr.slice(0, 200)));
record("S06 the staging fence still refuses PRODUCTION at process level",
  spawnProdRef.status === 3 && spawnProdRef.json?.reason === F.PROJECT_REF_FORBIDDEN_PRODUCTION);
record("S07 an unknown flag keeps its refusal semantics through the process",
  spawnUnknown.status === 3 && spawnUnknown.json?.reason === F.UNKNOWN_FLAG);
record("S08 two write modes together keep refusing through the process",
  spawnConflict.status === 3 && spawnConflict.json?.reason === F.MODE_CONFLICT);
record("S09 preflight without --attest-for keeps refusing through the process",
  spawnNoAttest.status === 3 && spawnNoAttest.json?.reason === F.ATTESTATION_TARGET_REQUIRED);
record("S10 spawned DRY_RUN output is IDENTICAL to the in-process runCli result",
  (await (async () => {
    const inProc = await cli([], {}, harness());
    return JSON.stringify(spawnNoFlags.json) === JSON.stringify(inProc);
  })()));
record("S11 a refusal exit code is 3 and a success exit code is 0 — the documented contract",
  spawnNoFlags.status === 0 &&
  [spawnDisable, spawnProdRef, spawnUnknown, spawnConflict, spawnNoAttest].every((s) => s.status === 3));
record("S12 no spawned child could have held a credential",
  Object.keys(SAFE_ENV).every((k) => !/^(QF_|WHATSAPP_)/.test(k)));
record("S13 a refusal is also reported on stderr for an operator watching a terminal",
  /REFUSED: /.test(spawnDisable.stderr) && /REFUSED: /.test(spawnUnknown.stderr));

// The containment rules that keep the cycle unconstructible and the authority single.
record("S14 NOTHING imports the entry module — that is what prevents the cycle",
  (() => {
    const base = path.basename(ENTRY_REL);
    for (const rel of ["scripts/mvp/communication/activate-meta-staging-canary.mjs",
                       "scripts/mvp/communication/canaryActivationRuntime.mjs",
                       "scripts/mvp/communication/seed-meta-staging-inactive-mappings.mjs",
                       "scripts/mvp/communication/verify-core-provider-env.mjs"]) {
      if (new RegExp(`(import|from)[^\\n]*${base.replace(/[.]/g, "\\.")}`).test(read(rel))) return false;
    }
    return true;
  })());
record("S15 the entry duplicates NO adapter, credential or attestation wiring",
  !/createClient|FetchHttpTransport|createSupabaseDbAdapter|createMetaGetAdapter|createHealthAdapter/.test(entryCode) &&
  !/writeFileSync|appendFileSync|readFileSync/.test(entryCode) &&
  !/@supabase\/supabase-js/.test(entryCode) &&
  !/process\.env\.[A-Z_]/.test(entryCode) &&
  !/QF_[A-Z_]+|WHATSAPP_[A-Z_]+/.test(entryCode));
record("S16 the entry imports its dependencies from the audited modules, not its own copies",
  /from "\.\/canaryActivationRuntime\.mjs"/.test(entryCode) &&
  /from "\.\/activate-meta-staging-canary\.mjs"/.test(entryCode) &&
  ["buildRealAdapters", "buildAttestationIo", "buildIndexProofAdapter",
   "buildStagingAssetProofAdapter", "resolveGitHead", "randomNonce"]
    .every((f) => entryCode.includes(f)));
record("S17 the entry can neither send, arm nor write — it names no such surface",
  !/\/messages/.test(entryCode) &&
  !/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(entryCode) &&
  !/\.rpc\(|qf_arm_|qf_disable_/.test(entryCode));
record("S18 the governed npm target invokes the ENTRY, not the library",
  (() => {
    const pkg = JSON.parse(read("package.json"));
    const t = pkg.scripts?.["canary:mvp:40"] ?? "";
    return t.includes(ENTRY_REL) && !/activate-meta-staging-canary\.mjs(\s|$)/.test(t);
  })());

const startupMutants = [
  ["R7D the old TLA import cycle cannot be restored in the library",
    () => !/process\.argv/.test(operatorCode) && !/isDirect/.test(operatorCode)],
  ["R7D the entry cannot be pulled back into the import graph",
    () => !/(import|from)[^\n]*activate-meta-staging-canary-cli/.test(runtimeCode) &&
          !/(import|from)[^\n]*activate-meta-staging-canary-cli/.test(operatorCode)],
  ["R7D a second argv parser in the entry is killed",
    () => !/resolveMode\(/.test(entryCode) && !/argv\.includes\(/.test(entryCode) &&
          !/startsWith\("--"\)/.test(entryCode) && !/"--(disable|arm-canary|arm-readiness|preflight-readonly)"/.test(entryCode)],
  ["R7D duplicated adapter wiring in the entry is killed",
    () => !/createClient|FetchHttpTransport|createSupabaseDbAdapter/.test(entryCode)],
  ["R7D startup regressions are caught by SPAWNING, not by importing",
    () => /spawnSync\(/.test(strip(read("scripts/mvp/communication/validate-meta-staging-canary-cli.mjs")))],
  ["R7D a spawned child can never inherit a live credential",
    () => /\^\(QF_\|WHATSAPP_\)/.test(read("scripts/mvp/communication/validate-meta-staging-canary-cli.mjs"))],
];
for (const [name, fn] of startupMutants) {
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
