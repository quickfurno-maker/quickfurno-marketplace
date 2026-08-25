#!/usr/bin/env node
// ============================================================================
// QF-MVP-40-R7F — the staging-asset proof STAGE BINDING, driven through the REAL adapter
// across a full preflight → write sequence.
//
// THE DEFECT THIS FILE EXISTS TO KILL
//   `--preflight-readonly` used to verify the staging-asset proof at the literal CLI mode
//   `"PREFLIGHT_READONLY"`, while `preflightForWrite` re-verifies it at the WRITE stage
//   (`ARM_READINESS` / `ARM_CANARY`). Because the attestation pins
//   `staging_asset_proof_hash`, the two steps demanded two different files with two
//   different hashes, and the drift fence then refused the write. Measured live on
//   2026-08-13 at HEAD 14bf8bd, both branches refused:
//     * keep the preflight-stage proof  → STAGING_ASSET_SCOPE_UNPROVEN / ..._PROOF_INVALID
//     * mint a write-stage proof        → ATTESTATION_MISMATCH(staging_asset_proof_hash)
//   The governed arm path was therefore unreachable for every template and destination.
//
// WHY NO EXISTING HARNESS SAW IT
//   `validate-meta-staging-canary-runtime.mjs` injects `{ verify: async () => assetProof }`,
//   which DISCARDS the `stage` argument. A stub that ignores an argument can never fail on
//   it. So this file injects the REAL `buildStagingAssetProofAdapter()`, reading a REAL
//   proof file through the REAL `verifyStagingAssetProof()`, and merely WRAPS it to record
//   which stage each call received. The recording wrapper adds no behaviour: every verdict
//   below is the committed verifier's.
//
// The proof files live in an OS temp directory — outside the repository, because
// `isInsideRepository()` refuses a proof stored under the repo, and that rule is part of
// what is being exercised here.
//
// Nothing in this file opens a socket, reads a credential, constructs a real client, or
// reaches a database. Every Supabase and Meta interaction is a local fake.
// ============================================================================

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as R from "./canaryActivationRuntime.mjs";
import {
  ActivationFailure,
  AssetScope,
  STAGING_ASSET_PROOF_ENV,
  STAGING_ASSET_PROOF_ARTIFACT,
  STAGING_ASSET_PROOF_TTL_MS,
  attestationDigest,
  buildStagingAssetProofAdapter,
  stagingAssetProofDigest,
} from "./activate-meta-staging-canary.mjs";
import { REQUIRED_ACCOUNT_READINESS } from "../../../lib/communication/providers/metaRuntimeGate.ts";
import { hashPhoneE164 } from "../../../lib/communication/phone.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const runtimeCode = strip(readFileSync(path.join(ROOT, "scripts/mvp/communication/canaryActivationRuntime.mjs"), "utf8"));

const F = ActivationFailure;
const results = [];
const record = (name, passed, detail = "") => results.push({ name, passed: passed === true, detail });

// ---------------------------------------------------------------------------
// Fixtures — deliberately the SAME shapes the 40.13C runtime validator uses, so the two
// files cannot drift into describing different systems.
// ---------------------------------------------------------------------------
const NOW = 1_800_000_000_000;
const HEAD = "a".repeat(40);
const APP_ID = "111222333444555";
const PROHIBITED_ID = "999888777666555";
const EXPECTED = Object.freeze({ phoneNumberId: "123456789012345", wabaId: "987654321098765" });
const CANARY_HASH = hashPhoneE164("+15555550100");
const TEMPLATE_KEY = "vendor_onboarding_reminder";
const TEMPLATE_NAME = "qf_vendor_onboarding_reminder_v1";
const TARGET = Object.freeze({
  ok: true, projectRef: "uckafzuochmbvtiodmcl", environment: "STAGING", destinationHash: CANARY_HASH,
});

const readyAccount = (over = {}) => ({
  id: "acct-1", provider_key: "meta_whatsapp_cloud", channel: "whatsapp",
  phone_number_reference: EXPECTED.phoneNumberId,
  business_account_reference: EXPECTED.wabaId,
  ...REQUIRED_ACCOUNT_READINESS, ...over,
});
const mapping = (over = {}) => ({
  id: "map-1", template_key: TEMPLATE_KEY, channel: "whatsapp",
  provider_key: "meta_whatsapp_cloud", language: "en",
  provider_template_name: TEMPLATE_NAME, approval_status: "approved", is_active: false, ...over,
});
const readinessPolicy = () => ({
  provider_key: "meta_whatsapp_cloud", channel: "whatsapp",
  activation_status: "readiness_only", outbound_enabled: false,
  webhook_processing_enabled: true, health_check_enabled: true,
});

function fakeClient({ account = readyAccount(), policy = null, mappings = [mapping()], canaryRows = [], rpcImpl } = {}) {
  const log = { rpcs: [], writes: [] };
  const table = (name) => {
    const builder = {
      select() { return builder; },
      eq() { return builder; },
      async maybeSingle() {
        if (name === "communication_provider_accounts") return { data: account, error: null };
        if (name === "communication_provider_runtime_policies") return { data: policy ?? null, error: null };
        return { data: null, error: null };
      },
      then(resolve) {
        if (name === "communication_provider_template_mappings") return resolve({ data: mappings, error: null });
        if (name === "communication_provider_canary_destinations") return resolve({ data: canaryRows, error: null });
        return resolve({ data: [], error: null });
      },
      update() { log.writes.push(`${name}:update`); return builder; },
      insert() { log.writes.push(`${name}:insert`); return builder; },
      upsert() { log.writes.push(`${name}:upsert`); return builder; },
    };
    return builder;
  };
  return {
    log,
    from: (name) => table(name),
    async rpc(name, args) {
      log.rpcs.push({ name, args });
      return rpcImpl ? rpcImpl(name, args) : { data: [{ ok: true }], error: null };
    },
  };
}

const okResponse = (body, status = 200) => ({ kind: "response", status, bodyText: JSON.stringify(body) });
const fakeTransport = (routes) => ({
  async request(req) {
    for (const [pattern, response] of routes) {
      if (req.url.includes(pattern)) return typeof response === "function" ? response(req) : response;
    }
    return { kind: "response", status: 404, bodyText: "{}" };
  },
});
const routesWithApps = (appIds = [APP_ID]) => [
  ["/subscribed_apps", okResponse({ data: appIds.map((id) => ({ whatsapp_business_api_data: { id } })) })],
  ["/message_templates", okResponse({ data: [{ name: TEMPLATE_NAME, language: "en", status: "APPROVED", category: "UTILITY", components: [] }] })],
  [EXPECTED.wabaId, okResponse({ id: EXPECTED.wabaId, business_verification_status: "verified" })],
  [EXPECTED.phoneNumberId, okResponse({ id: EXPECTED.phoneNumberId, code_verification_status: "VERIFIED", quality_rating: "GREEN" })],
];

function fakeAttestationIo(stored = null) {
  const state = { written: null, consumed: [] };
  return {
    state,
    async write(body) { state.written = body; },
    async load() { return stored ? { ok: true, parsed: stored } : { ok: false, reason: F.ATTESTATION_MISSING }; },
    async consumed() { return state.consumed; },
    async consume(d) { state.consumed.push(d); },
  };
}

// ---------------------------------------------------------------------------
// REAL staging-asset proofs, written to REAL files OUTSIDE the repository.
// ---------------------------------------------------------------------------
const PROOF_DIR = mkdtempSync(path.join(tmpdir(), "qf-mvp-40-r7f-"));
let proofSeq = 0;

/** A well-formed proof, signed with the committed digest function. */
function writeProof(over = {}) {
  proofSeq += 1;
  const issued = NOW - 60_000;
  const body = {
    artifact: STAGING_ASSET_PROOF_ARTIFACT,
    environment: "STAGING",
    project_ref: TARGET.projectRef,
    branch_head: HEAD,
    intended_stage: "ARM_READINESS",
    meta_app_id: APP_ID,
    waba_id: EXPECTED.wabaId,
    phone_number_id: EXPECTED.phoneNumberId,
    expected_subscribed_app_ids: [APP_ID],
    asset_scope: AssetScope.STAGING_DEDICATED,
    prohibited_asset_ids: [PROHIBITED_ID],
    prohibited_asset_digests: [],
    nonce: `r7f-nonce-${proofSeq}`,
    issued_at_ms: issued,
    // Exactly the ceiling the verifier permits; `expires - issued > TTL` refuses.
    expires_at_ms: issued + STAGING_ASSET_PROOF_TTL_MS,
    ...over,
  };
  const proof = { ...body, proof_sha256: stagingAssetProofDigest(body) };
  const file = path.join(PROOF_DIR, `proof-${proofSeq}.json`);
  writeFileSync(file, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  return { file, proof };
}

/**
 * The REAL adapter, over a real file. The env var is set only for the duration of the
 * factory call, because the factory captures the path at construction time.
 */
async function realAssetProofAdapter(file) {
  const previous = process.env[STAGING_ASSET_PROOF_ENV];
  process.env[STAGING_ASSET_PROOF_ENV] = file;
  try {
    return await buildStagingAssetProofAdapter();
  } finally {
    if (previous === undefined) delete process.env[STAGING_ASSET_PROOF_ENV];
    else process.env[STAGING_ASSET_PROOF_ENV] = previous;
  }
}

/**
 * Records the stage each verification received, then delegates UNCHANGED. This wrapper is
 * the entire difference from the 40.13C stub: it preserves the argument instead of
 * dropping it, so a wrong stage is observable rather than invisible.
 */
function recordingProof(adapter, log) {
  return {
    async verify(args) {
      log.push(args?.stage ?? null);
      return adapter.verify(args);
    },
  };
}

function baseAdapters({ client, routes = routesWithApps() }) {
  const shared = {
    transport: fakeTransport(routes), token: "TOKEN-NEVER-LOGGED", graphApiVersion: "v21.0",
    wabaId: EXPECTED.wabaId, phoneNumberId: EXPECTED.phoneNumberId,
  };
  return {
    db: R.createSupabaseDbAdapter(client),
    meta: R.createMetaGetAdapter(shared),
    health: R.createHealthAdapter(shared),
    indexProof: { verify: async () => ({ ok: true, hash: "p".repeat(64) }) },
  };
}

const baseCtx = (over = {}) => ({
  target: TARGET, expected: EXPECTED, templateKeys: [TEMPLATE_KEY],
  destinationHash: CANARY_HASH, now: NOW, nonce: "n".repeat(64),
  attestationTtlMs: 10 * 60 * 1000, branchHead: HEAD,
  ...over,
});

/** Run a preflight that attests for `attestStage`, using a real proof file. */
async function preflight(attestStage, file, { client = fakeClient({ policy: null }), routes } = {}) {
  const stages = [];
  const io = fakeAttestationIo();
  const adapters = baseAdapters({ client, routes });
  const out = await R.runOperator(baseCtx({
    mode: "PREFLIGHT_READONLY", ...adapters, attestationIo: io,
    assetProof: recordingProof(await realAssetProofAdapter(file), stages),
    stageForAttestation: attestStage,
  }));
  return { out, attestation: io.state.written, stages, client };
}

/** The readiness write, whose pre-write preflight re-verifies the SAME proof file. */
async function armReadiness(file, attestation) {
  const stages = [];
  const armed = { yet: false };
  const client = fakeClient({
    policy: null,
    rpcImpl: () => { armed.yet = true; return { data: [{ policy_activation_status: "readiness_only" }], error: null }; },
  });
  const adapters = baseAdapters({ client });
  const db = {
    ...adapters.db,
    async readPolicy() { return armed.yet ? readinessPolicy() : null; },
    async readMappings() { return [mapping()]; },
    async readCanaryDestinations() { return []; },
  };
  const out = await R.runOperator(baseCtx({
    mode: "ARM_READINESS", ...adapters, db, attestationIo: fakeAttestationIo(attestation),
    assetProof: recordingProof(await realAssetProofAdapter(file), stages),
  }));
  return { out, stages, client };
}

/** The canary write, same shape. */
async function armCanary(file, attestation) {
  const stages = [];
  const armed = { yet: false };
  const client = fakeClient({
    policy: readinessPolicy(),
    rpcImpl: (name) => {
      if (name === R.RPC_NAMES.armCanary) armed.yet = true;
      return { data: [{ policy_activation_status: "canary" }], error: null };
    },
  });
  const adapters = baseAdapters({ client });
  const db = {
    ...adapters.db,
    async readPolicy() {
      return armed.yet ? { ...readinessPolicy(), activation_status: "canary", outbound_enabled: true } : readinessPolicy();
    },
    async readMappings() { return [mapping({ is_active: armed.yet })]; },
    async readCanaryDestinations() {
      return armed.yet
        ? [{ provider_key: "meta_whatsapp_cloud", channel: "whatsapp", destination_hash: CANARY_HASH,
             is_active: true, expires_at: new Date(NOW + 3_600_000).toISOString() }]
        : [];
    },
  };
  const out = await R.runOperator(baseCtx({
    mode: "ARM_CANARY", ...adapters, db, attestationIo: fakeAttestationIo(attestation),
    assetProof: recordingProof(await realAssetProofAdapter(file), stages),
  }));
  return { out, stages, client };
}

/** Re-sign an attestation after altering it, so the DRIFT FENCE is what refuses it —
 *  not the tamper check, which would otherwise fire first and prove nothing. */
const resign = (attestation, over) => {
  const body = { ...attestation, ...over };
  delete body.attestation_sha256;
  return { ...body, attestation_sha256: attestationDigest(body) };
};

// ===========================================================================
// S. THE READINESS SEQUENCE — one proof, both steps
// ===========================================================================
const rProof = writeProof({ intended_stage: "ARM_READINESS" });
const rPre = await preflight("ARM_READINESS", rProof.file);

record("S01 readiness preflight succeeds against a real ARM_READINESS-bound proof",
  rPre.out.ok === true, JSON.stringify(rPre.out.reason ?? "") + JSON.stringify(rPre.out.detail ?? ""));
record("S02 readiness preflight verifies the asset proof at ARM_READINESS, not PREFLIGHT_READONLY",
  rPre.stages.length === 1 && rPre.stages[0] === "ARM_READINESS", JSON.stringify(rPre.stages));
record("S03 the attestation it mints pins that exact proof hash",
  rPre.attestation?.staging_asset_proof_hash === rProof.proof.proof_sha256);
record("S04 the attestation records STAGING_DEDICATED and targets ARM_READINESS",
  rPre.attestation?.asset_scope === AssetScope.STAGING_DEDICATED &&
  rPre.attestation?.stage === "ARM_READINESS");

const rArm = await armReadiness(rProof.file, rPre.attestation);
record("S05 the readiness WRITE re-verifies at ARM_READINESS",
  rArm.stages.length === 1 && rArm.stages[0] === "ARM_READINESS", JSON.stringify(rArm.stages));
record("S06 the readiness write accepts the SAME proof file and passes the drift fence",
  rArm.out.ok === true, JSON.stringify(rArm.out.reason ?? "") + JSON.stringify(rArm.out.detail ?? ""));
record("S07 exactly one RPC, and it is the readiness RPC",
  rArm.client.log.rpcs.length === 1 && rArm.client.log.rpcs[0].name === R.RPC_NAMES.armReadiness);
record("S08 the armed posture is readiness_only with outbound still false",
  rArm.out.posture?.activation_status === "readiness_only" && rArm.out.posture?.outbound_enabled === false);

// ===========================================================================
// C. THE CANARY SEQUENCE — one proof, both steps
// ===========================================================================
const cProof = writeProof({ intended_stage: "ARM_CANARY" });
const cPre = await preflight("ARM_CANARY", cProof.file, { client: fakeClient({ policy: readinessPolicy() }) });

record("C01 canary preflight succeeds against a real ARM_CANARY-bound proof",
  cPre.out.ok === true, JSON.stringify(cPre.out.reason ?? "") + JSON.stringify(cPre.out.detail ?? ""));
record("C02 canary preflight verifies the asset proof at ARM_CANARY",
  cPre.stages.length === 1 && cPre.stages[0] === "ARM_CANARY", JSON.stringify(cPre.stages));
record("C03 the canary attestation pins that exact proof hash and targets ARM_CANARY",
  cPre.attestation?.staging_asset_proof_hash === cProof.proof.proof_sha256 &&
  cPre.attestation?.stage === "ARM_CANARY");

const cArm = await armCanary(cProof.file, cPre.attestation);
record("C04 the canary WRITE re-verifies at ARM_CANARY",
  cArm.stages.length === 1 && cArm.stages[0] === "ARM_CANARY", JSON.stringify(cArm.stages));
record("C05 the canary write accepts the SAME proof file and passes the drift fence",
  cArm.out.ok === true, JSON.stringify(cArm.out.reason ?? "") + JSON.stringify(cArm.out.detail ?? ""));
record("C06 exactly one RPC, and it is the canary RPC",
  cArm.client.log.rpcs.length === 1 && cArm.client.log.rpcs[0].name === R.RPC_NAMES.armCanary);
record("C07 the armed posture activates exactly the selected template",
  cArm.out.observed?.activeMappingKeys.join(",") === TEMPLATE_KEY &&
  cArm.out.observed?.activeCanaryCount === 1);

// ===========================================================================
// X. CROSS-STAGE SUBSTITUTION IS REFUSED — the binding is not merely relabelled
// ===========================================================================
const pflProof = writeProof({ intended_stage: "PREFLIGHT_READONLY" });
const xA = await preflight("ARM_READINESS", pflProof.file);
record("X01 a PREFLIGHT_READONLY-bound proof is refused for a readiness attestation",
  xA.out.ok === false && xA.out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN &&
  xA.attestation === null, JSON.stringify(xA.out.reason ?? ""));

const xB = await preflight("ARM_READINESS", cProof.file);
record("X02 an ARM_CANARY proof cannot serve an ARM_READINESS attestation",
  xB.out.ok === false && xB.out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN && xB.attestation === null);

const xC = await preflight("ARM_CANARY", rProof.file, { client: fakeClient({ policy: readinessPolicy() }) });
record("X03 an ARM_READINESS proof cannot serve an ARM_CANARY attestation",
  xC.out.ok === false && xC.out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN && xC.attestation === null);

const xD = await armReadiness(cProof.file, rPre.attestation);
record("X04 the readiness WRITE refuses a canary-bound proof, and calls no RPC",
  xD.out.ok === false && xD.out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN && xD.client.log.rpcs.length === 0);

const unknownStage = writeProof({ intended_stage: "SEND" });
const xE = await preflight("ARM_READINESS", unknownStage.file);
record("X05 an unknown intended_stage fails closed",
  xE.out.ok === false && xE.out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN && xE.attestation === null);

const missingStage = writeProof({ intended_stage: undefined });
const xF = await preflight("ARM_READINESS", missingStage.file);
record("X06 a missing intended_stage fails closed",
  xF.out.ok === false && xF.out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN && xF.attestation === null);

// The attestation TARGET itself must be present and valid, or the preflight cannot know
// which stage to verify against — and a defaulted stage would silently skip the check.
const xG = await preflight(null, rProof.file);
record("X07 a preflight with NO attestation target refuses and writes nothing",
  xG.out.ok === false && xG.out.reason === F.ATTESTATION_TARGET_REQUIRED && xG.attestation === null,
  JSON.stringify(xG.out.reason ?? ""));
record("X08 the refused preflight never even consulted the asset proof",
  xG.stages.length === 0);

const xH = await preflight("PREFLIGHT_READONLY", pflProof.file);
record("X09 a preflight cannot attest for PREFLIGHT_READONLY itself",
  xH.out.ok === false && xH.out.reason === F.ATTESTATION_TARGET_INVALID && xH.attestation === null,
  JSON.stringify(xH.out.reason ?? ""));

// ===========================================================================
// D. THE DRIFT FENCE IS UNCHANGED — every pin still refuses
// ===========================================================================
const otherReadinessProof = writeProof({ intended_stage: "ARM_READINESS" });
record("D00 the second proof is a genuinely different artifact",
  otherReadinessProof.proof.proof_sha256 !== rProof.proof.proof_sha256);

const dA = await armReadiness(otherReadinessProof.file, rPre.attestation);
record("D01 swapping in a DIFFERENT valid proof between preflight and write still refuses",
  dA.out.ok === false && dA.out.reason === F.ATTESTATION_MISMATCH &&
  dA.out.detail === "staging_asset_proof_hash" && dA.client.log.rpcs.length === 0,
  `${dA.out.reason ?? ""}/${dA.out.detail ?? ""}`);

const dB = await armReadiness(rProof.file, resign(rPre.attestation, { staging_asset_proof_hash: "9".repeat(64) }));
record("D02 staging_asset_proof_hash is still fenced (re-signed attestation, so the fence refuses, not the tamper check)",
  dB.out.ok === false && dB.out.reason === F.ATTESTATION_MISMATCH &&
  dB.out.detail === "staging_asset_proof_hash" && dB.client.log.rpcs.length === 0,
  `${dB.out.reason ?? ""}/${dB.out.detail ?? ""}`);

const dC = await armReadiness(rProof.file, resign(rPre.attestation, { meta_asset_identity_digest: "9".repeat(64) }));
record("D03 meta_asset_identity_digest is still fenced",
  dC.out.ok === false && dC.out.reason === F.ATTESTATION_MISMATCH &&
  dC.out.detail === "meta_asset_identity_digest" && dC.client.log.rpcs.length === 0,
  `${dC.out.reason ?? ""}/${dC.out.detail ?? ""}`);

const dD = await armReadiness(rProof.file, resign(rPre.attestation, { asset_scope: AssetScope.SHARED_OR_UNKNOWN }));
record("D04 asset_scope is still fenced",
  dD.out.ok === false && dD.out.reason === F.ATTESTATION_MISMATCH &&
  dD.out.detail === "asset_scope" && dD.client.log.rpcs.length === 0,
  `${dD.out.reason ?? ""}/${dD.out.detail ?? ""}`);

// ===========================================================================
// V. EVERY OTHER PROOF RULE STILL HOLDS AT THE NEW STAGE
// ===========================================================================
const expiredProof = writeProof({
  intended_stage: "ARM_READINESS", issued_at_ms: NOW - 3_600_000, expires_at_ms: NOW - 1,
});
const vA = await preflight("ARM_READINESS", expiredProof.file);
record("V01 an expired proof is refused",
  vA.out.ok === false && vA.out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN && vA.attestation === null);

const prohibitedProof = writeProof({
  intended_stage: "ARM_READINESS", prohibited_asset_ids: [PROHIBITED_ID, EXPECTED.wabaId],
});
const vB = await preflight("ARM_READINESS", prohibitedProof.file);
record("V02 an asset on the owner's production deny-list can never be attested as staging",
  vB.out.ok === false && vB.out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN && vB.attestation === null);

const vC = await preflight("ARM_READINESS", rProof.file, { routes: routesWithApps([APP_ID, "222333444555666"]) });
record("V03 an unattested extra live subscriber still fails the exact-set rule",
  vC.out.ok === false && vC.attestation === null, JSON.stringify(vC.out.reason ?? ""));

const tamperedFile = path.join(PROOF_DIR, "tampered.json");
writeFileSync(tamperedFile, JSON.stringify({ ...rProof.proof, waba_id: "555555555555555" }, null, 2), "utf8");
const vD = await preflight("ARM_READINESS", tamperedFile);
record("V04 a proof altered after issue is refused by its own digest",
  vD.out.ok === false && vD.out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN && vD.attestation === null);

const wrongHeadProof = writeProof({ intended_stage: "ARM_READINESS", branch_head: "b".repeat(40) });
const vE = await preflight("ARM_READINESS", wrongHeadProof.file);
record("V05 a proof classified against a different commit is refused",
  vE.out.ok === false && vE.attestation === null);

const insideRepo = path.join(ROOT, "qf-r7f-must-never-be-read.json");
const vF = await (async () => {
  // The file is never created: the adapter must refuse on the PATH alone.
  const out = await preflight("ARM_READINESS", insideRepo);
  return out;
})();
record("V06 a proof path inside the repository is refused without being read",
  vF.out.ok === false && vF.out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN && vF.attestation === null);

// ===========================================================================
// L. THE CLI CONTRACT — `--attest-for=<x>` reaches the asset verifier as <x>'s arm stage
//
// The sequences above drive `runOperator` directly. This section drives the ONE CLI path
// (`runCli`, the same function the R7D entry point calls) so the argv contract itself is
// bound to the repair: nothing else may decide which stage the proof is checked at.
// ===========================================================================
const cliEnv = (over = {}) => ({
  QF_STAGING_SUPABASE_URL: `https://${TARGET.projectRef}.supabase.co`,
  QF_STAGING_SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"x".repeat(32)}`,
  QF_META_ACCESS_TOKEN: "TOKEN-NEVER-LOGGED",
  QF_META_WABA_ID: EXPECTED.wabaId,
  QF_META_PHONE_NUMBER_ID: EXPECTED.phoneNumberId,
  QF_META_GRAPH_API_VERSION: "v21.0",
  QF_META_CANARY_DESTINATION_E164: "+15555550100",
  ...over,
});

async function cli(argv, { file, client = fakeClient({ policy: null }) }) {
  const stages = [];
  const io = fakeAttestationIo();
  const adapters = baseAdapters({ client });
  const out = await R.runCli({
    argv, env: cliEnv(),
    headResolver: async () => HEAD,
    adapterFactory: async () => ({ db: adapters.db, meta: adapters.meta, health: adapters.health, expected: EXPECTED }),
    attestationIoFactory: async () => io,
    indexProofFactory: async () => adapters.indexProof,
    stagingAssetProofFactory: async () => recordingProof(await realAssetProofAdapter(file), stages),
    now: () => NOW,
    nonce: "n".repeat(64),
  });
  return { out, stages, attestation: io.state.written };
}

const lA = await cli(["--preflight-readonly", "--attest-for=readiness", `--templates=${TEMPLATE_KEY}`], { file: rProof.file });
record("L01 --attest-for=readiness verifies the asset proof at ARM_READINESS",
  lA.out.ok === true && lA.stages.join(",") === "ARM_READINESS",
  `${JSON.stringify(lA.out.reason ?? "")}${JSON.stringify(lA.stages)}`);
record("L02 the CLI-minted attestation pins the same proof hash it verified",
  lA.attestation?.staging_asset_proof_hash === rProof.proof.proof_sha256);

const lB = await cli(["--preflight-readonly", "--attest-for=canary", `--templates=${TEMPLATE_KEY}`],
  { file: cProof.file, client: fakeClient({ policy: readinessPolicy() }) });
record("L03 --attest-for=canary verifies the asset proof at ARM_CANARY",
  lB.out.ok === true && lB.stages.join(",") === "ARM_CANARY",
  `${JSON.stringify(lB.out.reason ?? "")}${JSON.stringify(lB.stages)}`);

const lC = await cli(["--preflight-readonly", "--attest-for=canary", `--templates=${TEMPLATE_KEY}`], { file: rProof.file });
record("L04 the CLI cannot spend a readiness proof on a canary attestation",
  lC.out.ok === false && lC.attestation === null);

const lD = await cli(["--preflight-readonly", `--templates=${TEMPLATE_KEY}`], { file: rProof.file });
record("L05 the CLI still requires an attestation target, before any proof is read",
  lD.out.ok === false && lD.out.reason === F.ATTESTATION_TARGET_REQUIRED && lD.stages.length === 0);

const lE = await cli(["--arm-readiness", "--attest-for=readiness", `--templates=${TEMPLATE_KEY}`], { file: rProof.file });
record("L06 --attest-for is still refused on a write mode (R7D argv contract intact)",
  lE.out.ok === false && lE.out.reason === F.ATTESTATION_TARGET_NOT_PERMITTED);

// ===========================================================================
// MUTANTS — each must FAIL if the corresponding guard is weakened
// ===========================================================================
const mutants = [
  ["the literal PREFLIGHT_READONLY stage cannot come back into the preflight asset check",
    () => !/requireDedicatedScope:[\s\S]{0,120}stage:\s*"PREFLIGHT_READONLY"/.test(runtimeCode)],
  ["the preflight passes a stage to the asset proof at all",
    () => rPre.stages[0] !== null && rPre.stages[0] !== undefined],
  ["readiness and canary cannot be swapped",
    () => rPre.stages[0] === "ARM_READINESS" && cPre.stages[0] === "ARM_CANARY"],
  ["one proof can never satisfy two stages",
    async () => {
      const both = await Promise.all([
        preflight("ARM_CANARY", rProof.file, { client: fakeClient({ policy: readinessPolicy() }) }),
        preflight("ARM_READINESS", cProof.file),
      ]);
      return both.every((b) => b.out.ok === false && b.attestation === null);
    }],
  ["all three asset pins remain in the drift fence, in one list",
    () => /asset_scope[\s\S]{0,200}staging_asset_proof_hash[\s\S]{0,200}meta_asset_identity_digest/.test(runtimeCode)],
  ["the attested stage is never defaulted when the target is absent",
    () => !/stageForAttestation\s*\?\?\s*"ARM_/.test(runtimeCode)],
  ["the preflight still refuses to write",
    () => rPre.client.log.writes.length === 0 && rPre.client.log.rpcs.length === 0],
  ["no send endpoint appears in the runtime",
    () => !/\/messages/.test(runtimeCode.replace(/message_templates/g, ""))],
  ["the asset-proof verifier is still the committed one, reached through the real adapter",
    async () => {
      const adapter = await realAssetProofAdapter(rProof.file);
      const good = await adapter.verify({ projectRef: TARGET.projectRef, now: NOW, branchHead: HEAD, stage: "ARM_READINESS" });
      const bad = await adapter.verify({ projectRef: "yqpgcsduqbxulrlzwzap", now: NOW, branchHead: HEAD, stage: "ARM_READINESS" });
      return good.ok === true && good.scope === AssetScope.STAGING_DEDICATED && bad.ok === false;
    }],
];
for (const [name, fn] of mutants) {
  let held = false;
  try { held = (await fn()) === true; } catch { held = false; }
  record(`MUT ${name}`, held);
}

// ---------------------------------------------------------------------------
rmSync(PROOF_DIR, { recursive: true, force: true });

for (const [i, r] of results.entries()) {
  console.log(`${r.passed ? "PASS" : "FAIL"} ${String(i + 1).padStart(3, "0")} ${r.name}${r.detail && !r.passed ? ` (${r.detail})` : ""}`);
}
const passed = results.filter((r) => r.passed).length;
console.log(`\nQF-MVP-40-R7F ASSET STAGE BINDING: ${passed}/${results.length} PASS`);
if (passed === results.length) console.log("QF_MVP_40_R7F_ASSET_STAGE_BINDING_PROVEN");
process.exitCode = passed === results.length ? 0 : 1;
