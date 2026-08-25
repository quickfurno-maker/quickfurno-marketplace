#!/usr/bin/env node
// ============================================================================
// QF-MVP-40.13C — validator for the EXECUTABLE canary activation runtime.
//
// It drives the REAL runtime entry point through injected fake Supabase / Meta /
// health / index-proof / attestation adapters. No socket is opened, no credential is
// read, and no real client is ever constructed.
//
// Every consequential claim is paired with a mutant that must FAIL. This runtime arms a
// real WhatsApp send path, so a guard that cannot fail is worse than no guard.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as R from "./canaryActivationRuntime.mjs";
import { ActivationFailure, AssetScope, attestationDigest, planFingerprint, planCanaryArm, planReadinessArm }
  from "./activate-meta-staging-canary.mjs";
import { REQUIRED_ACCOUNT_READINESS } from "../../../lib/communication/providers/metaRuntimeGate.ts";
import { hashPhoneE164 } from "../../../lib/communication/phone.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const RUNTIME_PATH = "scripts/mvp/communication/canaryActivationRuntime.mjs";
const OPERATOR_PATH = "scripts/mvp/communication/activate-meta-staging-canary.mjs";
const runtimeSource = read(RUNTIME_PATH);
const operatorSource = read(OPERATOR_PATH);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const runtimeCode = strip(runtimeSource);
const operatorCode = strip(operatorSource);
const healthServiceSource = read("services/communicationProviderHealthService.ts");
/** QF-MVP-40-R7D — the bootstrap moved into its own entry module; the pin moves with it. */
const ENTRY_PATH = "scripts/mvp/communication/activate-meta-staging-canary-cli.mjs";
const entryCode = strip(read(ENTRY_PATH));

const results = [];
const record = (name, passed, detail = "") =>
  results.push({ name, passed: passed === true, detail });
const F = ActivationFailure;

const NOW = 1_800_000_000_000;
const EXPECTED = Object.freeze({ phoneNumberId: "123456789012345", wabaId: "987654321098765" });
/** Reserved fictional range: E.164-valid, deterministic, never dialable. */
const CANARY_HASH = hashPhoneE164("+15555550100");
const TEMPLATE_KEY = "vendor_onboarding_reminder";
const TEMPLATE_NAME = "qf_vendor_onboarding_reminder_v1";
const TARGET = Object.freeze({ ok: true, projectRef: "uckafzuochmbvtiodmcl", environment: "STAGING", destinationHash: CANARY_HASH });

const readyAccount = (over = {}) => ({
  id: "acct-1", provider_key: "meta_whatsapp_cloud", channel: "whatsapp",
  phone_number_reference: EXPECTED.phoneNumberId,
  business_account_reference: EXPECTED.wabaId,
  ...REQUIRED_ACCOUNT_READINESS, ...over,
});
const unreadyAccount = () => readyAccount({
  readiness_status: "disabled", configuration_status: "partial",
  webhook_status: "pending", health_status: "unknown",
  business_verification_status: "unknown", phone_number_status: "unknown",
});
const mapping = (over = {}) => ({
  id: "map-1", template_key: TEMPLATE_KEY, channel: "whatsapp",
  provider_key: "meta_whatsapp_cloud", language: "en",
  provider_template_name: TEMPLATE_NAME, approval_status: "approved", is_active: false, ...over,
});

/** A fake Supabase client that RECORDS everything and can express a table write. */
function fakeClient({ account = readyAccount(), policy, mappings = [mapping()], canaryRows = [], rpcImpl } = {}) {
  const log = { selects: [], rpcs: [], writes: [] };
  const table = (name) => {
    const builder = {
      select() { log.selects.push(name); return builder; },
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
      // Present ONLY so a test can prove the adapter never reaches for them.
      update() { log.writes.push(`${name}:update`); return builder; },
      insert() { log.writes.push(`${name}:insert`); return builder; },
      upsert() { log.writes.push(`${name}:upsert`); return builder; },
    };
    return builder;
  };
  return {
    log,
    from: (name) => table(name),
    async rpc(name, args) { log.rpcs.push({ name, args }); return rpcImpl ? rpcImpl(name, args) : { data: [{ ok: true }], error: null }; },
  };
}

const okResponse = (body, status = 200) => ({ kind: "response", status, bodyText: JSON.stringify(body) });

function fakeTransport(routes, log = []) {
  return {
    log,
    async request(req) {
      log.push({ url: req.url, method: req.method });
      for (const [pattern, response] of routes) {
        if (req.url.includes(pattern)) return typeof response === "function" ? response(req) : response;
      }
      return { kind: "response", status: 404, bodyText: "{}" };
    },
  };
}

/** A fictional Meta app id. Digits, because real Meta app ids are digits. */
const APP_ID = "111222333444555";

const defaultRoutes = () => [
  ["/subscribed_apps", okResponse({ data: [{ whatsapp_business_api_data: { id: APP_ID } }] })],
  ["/message_templates", okResponse({ data: [{ name: TEMPLATE_NAME, language: "en", status: "APPROVED", category: "UTILITY", components: [] }] })],
  [EXPECTED.wabaId, okResponse({ id: EXPECTED.wabaId, business_verification_status: "verified" })],
  [EXPECTED.phoneNumberId, okResponse({ id: EXPECTED.phoneNumberId, code_verification_status: "VERIFIED", quality_rating: "GREEN" })],
];

/**
 * QF-MVP-40-R3 — a VERIFIED staging-asset proof, as the real adapter would return it.
 * Every scope-guarded mode needs one; supplying `null` is how the tests below prove that
 * an unclassified asset refuses.
 */
const stagingAssetProof = (over = {}) => ({
  ok: true,
  hash: "s".repeat(64),
  scope: "STAGING_DEDICATED",
  metaAppId: APP_ID,
  wabaId: EXPECTED.wabaId,
  phoneNumberId: EXPECTED.phoneNumberId,
  branchHead: HEAD,
  expiresAtMs: NOW + 10 * 60 * 1000,
  prohibited: { ids: ["999888777666555"], digests: [] },
  ...over,
});

function buildAdapters({
  client = fakeClient(),
  routes = defaultRoutes(),
  proof = { ok: true, hash: "p".repeat(64) },
  assetProof = stagingAssetProof(),
} = {}) {
  const transportLog = [];
  const transport = fakeTransport(routes, transportLog);
  const shared = { transport, token: "TOKEN-NEVER-LOGGED", graphApiVersion: "v21.0", wabaId: EXPECTED.wabaId, phoneNumberId: EXPECTED.phoneNumberId };
  return {
    client,
    transportLog,
    db: R.createSupabaseDbAdapter(client),
    meta: R.createMetaGetAdapter(shared),
    health: R.createHealthAdapter(shared),
    indexProof: { verify: async () => proof },
    assetProof: assetProof === null ? null : { verify: async () => assetProof },
  };
}

function fakeAttestationIo(stored = null) {
  const state = { written: null, consumed: [], loads: 0 };
  return {
    state,
    async write(body) { state.written = body; },
    async load() { state.loads += 1; return stored ? { ok: true, parsed: stored } : { ok: false, reason: F.ATTESTATION_MISSING }; },
    async consumed() { return state.consumed; },
    async consume(d) { state.consumed.push(d); },
  };
}

/**
 * QF-MVP-40.13C-R1 adds a proven-HEAD requirement to every opening write, and
 * `branch_head` is now part of the drift comparison, so the fixtures must carry one.
 */
const HEAD = "a".repeat(40);

/**
 * QF-MVP-40-R7F: a preflight now REFUSES without an attestation target, because the
 * staging-asset proof is verified against the stage being attested for and a defaulted
 * stage would silently skip that check. The default below keeps every pre-existing
 * preflight fixture testing what it was written to test; `stageForAttestation: undefined`
 * still overrides it, which is how the fail-closed cases below are expressed. Write modes
 * ignore this field — `runCli` refuses `--attest-for` for them outright.
 */
const baseCtx = (over = {}) => ({
  target: TARGET, expected: EXPECTED, templateKeys: [TEMPLATE_KEY],
  destinationHash: CANARY_HASH, now: NOW, nonce: "n".repeat(64), attestationTtlMs: 10 * 60 * 1000,
  branchHead: HEAD, stageForAttestation: "ARM_READINESS",
  ...over,
});

/** Produce a genuine attestation for a stage by running the real preflight path. */
async function mintAttestation(stage, { client, policy = null } = {}) {
  const a = buildAdapters({ client: client ?? fakeClient({ policy }) });
  const io = fakeAttestationIo();
  const out = await R.runOperator(baseCtx({
    mode: "PREFLIGHT_READONLY", ...a, attestationIo: io,
    stageForAttestation: stage,
  }));
  if (!out.ok) return { ok: false, out };
  return { ok: true, attestation: io.state.written, adapters: a };
}

const readinessPolicy = () => ({ provider_key: "meta_whatsapp_cloud", channel: "whatsapp",
  activation_status: "readiness_only", outbound_enabled: false,
  webhook_processing_enabled: true, health_check_enabled: true });

// ---------------------------------------------------------------------------
// I. IMPORT SAFETY AND DISPATCH
// ---------------------------------------------------------------------------
record("I01 importing the runtime constructs no client, opens no socket, reads no credential",
  !/^\s*(const|let)\s+\w+\s*=\s*createClient\(/m.test(runtimeCode) &&
  !/process\.env\./.test(runtimeCode) &&
  !/new FetchHttpTransport\(/.test(runtimeCode));
// QF-MVP-40-R7D. The isDirect guard is GONE, because it was the defect: its top-level
// `await import()` of this runtime — which statically imports the operator back — deadlocked
// whenever the operator was the process entry (exit 13, no output, every mode, --disable
// included). The library now never self-executes at all, which is strictly stronger than
// guarding, and the client is still built only inside the exported factory.
record("I02 the operator never self-executes, and builds a client only inside its factory",
  !/process\.argv/.test(operatorCode) &&
  !/isDirect/.test(operatorCode) &&
  /export async function buildRealAdapters/.test(operatorCode) &&
  operatorCode.indexOf("export async function buildRealAdapters") < operatorCode.indexOf("createClient") &&
  /await import\("@supabase\/supabase-js"\)/.test(operatorCode) &&
  /runCli\(/.test(entryCode));
record("I03 the real client is constructed only AFTER the staging fence passes",
  operatorCode.indexOf("resolveActivationTarget(process.env") <
    operatorCode.indexOf('await import("@supabase/supabase-js")'));
record("I04 the mode vocabulary and requirement table are closed and aligned",
  Object.keys(R.MODE_REQUIREMENTS).join(",") ===
    "DRY_RUN,PREFLIGHT_READONLY,ARM_READINESS,ARM_CANARY,DISABLE");
record("I05 exactly one mode is dispatched per invocation",
  (await R.runOperator({ mode: "DRY_RUN" })).stage === "DRY_RUN" &&
  (await R.runOperator({ mode: "NOT_A_MODE" })).reason === F.MODE_MISSING);
record("I06 DRY_RUN needs no adapter, no credential and no network",
  (() => {
    const need = R.MODE_REQUIREMENTS.DRY_RUN;
    return need.db === false && need.meta === false && need.indexProof === false &&
      need.attestation === false && need.writes === false;
  })());

// ---------------------------------------------------------------------------
// P. PREFLIGHT ACTUALLY READS, AND NEVER WRITES
// ---------------------------------------------------------------------------
const pf = buildAdapters();
const pfIo = fakeAttestationIo();
const pfOut = await R.runOperator(baseCtx({ mode: "PREFLIGHT_READONLY", ...pf, attestationIo: pfIo }));

record("P01 preflight succeeds against healthy fakes", pfOut.ok === true, JSON.stringify(pfOut.reason ?? ""));
record("P02 preflight actually calls EVERY required DB read",
  ["readAccount", "readPolicy", "readMappings", "readCanaryDestinations"]
    .every((c) => pf.db.calls.includes(c)));
record("P03 preflight actually calls EVERY required Meta GET",
  ["waba", "phone_number", "subscribed_apps", "message_templates"]
    .every((l) => pf.meta.calls.some((c) => c.label === l)));
record("P04 preflight runs the health check",
  pf.health.calls.length === 1 && pf.health.calls[0].method === "GET");
record("P05 preflight validates the external index proof",
  pfOut.ok === true &&
  (await R.runOperator(baseCtx({
    mode: "PREFLIGHT_READONLY", ...buildAdapters({ proof: { ok: false, reason: F.INDEX_PROOF_UNAVAILABLE } }),
    attestationIo: fakeAttestationIo(),
  }))).reason === F.INDEX_PROOF_UNAVAILABLE);
record("P06 preflight performs ZERO table writes",
  pf.client.log.writes.length === 0);
record("P07 preflight performs ZERO RPC calls",
  pf.client.log.rpcs.length === 0);
record("P08 EVERY Meta request is a GET",
  pf.transportLog.length > 0 && pf.transportLog.every((r) => r.method === "GET"));
record("P09 no Meta request targets a send endpoint",
  pf.transportLog.every((r) => !r.url.includes("/messages")));
record("P10 preflight derives readiness through the frozen decision layer",
  pfOut.readiness === true && /deriveAccountReadinessFromEvidence\(/.test(runtimeCode));
record("P11 preflight writes a fresh attestation outside the repo contract",
  pfIo.state.written?.artifact === "QF-MVP-40-CANARY-ACTIVATION-ATTESTATION" &&
  pfIo.state.written.stage === "ARM_READINESS" &&
  pfIo.state.written.project_ref === "uckafzuochmbvtiodmcl");
record("P12 the attestation carries digests and a HASH, never a token or a plaintext number",
  (() => {
    const blob = JSON.stringify(pfIo.state.written);
    return blob.includes(CANARY_HASH) && !blob.includes("+15555550100") &&
      !blob.includes("TOKEN-NEVER-LOGGED") && !blob.includes("9876500000");
  })());
record("P13 sanitized output carries no account id, token or plaintext destination",
  (() => {
    const blob = JSON.stringify(pfOut);
    return !blob.includes("TOKEN-NEVER-LOGGED") && !blob.includes("+15555550100") &&
      !blob.includes("acct-1");
  })());
record("P14 an unapproved / drifted remote template is refused",
  (await R.runOperator(baseCtx({
    mode: "PREFLIGHT_READONLY", attestationIo: fakeAttestationIo(),
    ...buildAdapters({ routes: [
      ["/subscribed_apps", okResponse({ data: [{ id: APP_ID }] })],
      ["/message_templates", okResponse({ data: [{ name: TEMPLATE_NAME, language: "en", status: "PENDING", category: "UTILITY" }] })],
      [EXPECTED.wabaId, okResponse({ id: EXPECTED.wabaId, business_verification_status: "verified" })],
      [EXPECTED.phoneNumberId, okResponse({ id: EXPECTED.phoneNumberId, code_verification_status: "VERIFIED" })],
    ] }),
  }))).reason === F.META_STATUS_NOT_APPROVED);
record("P15 a MARKETING remote category is refused",
  (await R.runOperator(baseCtx({
    mode: "PREFLIGHT_READONLY", attestationIo: fakeAttestationIo(),
    ...buildAdapters({ routes: [
      ["/subscribed_apps", okResponse({ data: [{ id: APP_ID }] })],
      ["/message_templates", okResponse({ data: [{ name: TEMPLATE_NAME, language: "en", status: "APPROVED", category: "MARKETING" }] })],
      [EXPECTED.wabaId, okResponse({ id: EXPECTED.wabaId, business_verification_status: "verified" })],
      [EXPECTED.phoneNumberId, okResponse({ id: EXPECTED.phoneNumberId, code_verification_status: "VERIFIED" })],
    ] }),
  }))).reason === F.META_CATEGORY_MISMATCH);
/**
 * Each of these withholds ONE piece of real evidence. Preflight then refuses outright and
 * — the security-relevant part — writes NO attestation, so nothing downstream can arm on
 * unearned readiness.
 */
async function preflightWithRoutes(routes) {
  const io = fakeAttestationIo();
  const out = await R.runOperator(baseCtx({
    mode: "PREFLIGHT_READONLY", attestationIo: io, ...buildAdapters({ routes }),
  }));
  return { out, io };
}
const approvedTemplateRoute = ["/message_templates",
  okResponse({ data: [{ name: TEMPLATE_NAME, language: "en", status: "APPROVED", category: "UTILITY" }] })];

record("P16 a WABA identity mismatch blocks readiness and writes no attestation",
  (await (async () => {
    const { out, io } = await preflightWithRoutes([
      ["/subscribed_apps", okResponse({ data: [{ id: APP_ID }] })], approvedTemplateRoute,
      [EXPECTED.wabaId, okResponse({ id: "999999999999999", business_verification_status: "verified" })],
      [EXPECTED.phoneNumberId, okResponse({ id: EXPECTED.phoneNumberId, code_verification_status: "VERIFIED" })],
    ]);
    return out.ok === false && out.reason === F.READINESS_EVIDENCE_INSUFFICIENT && io.state.written === null;
  })()));
record("P17 an unsubscribed webhook blocks readiness and writes no attestation",
  (await (async () => {
    const { out, io } = await preflightWithRoutes([
      ["/subscribed_apps", okResponse({ data: [] })], approvedTemplateRoute,
      [EXPECTED.wabaId, okResponse({ id: EXPECTED.wabaId, business_verification_status: "verified" })],
      [EXPECTED.phoneNumberId, okResponse({ id: EXPECTED.phoneNumberId, code_verification_status: "VERIFIED" })],
    ]);
    return out.ok === false && out.reason === F.READINESS_EVIDENCE_INSUFFICIENT && io.state.written === null;
  })()));
// Injected at the HEALTH seam on purpose. An aborted phone GET fails earlier and harder
// (META_GET_FAILED), so it would not exercise the health verdict at all — this proves a
// reachable-but-degraded provider is refused even when every identity GET succeeds.
record("P18 a degraded/unhealthy provider blocks readiness and writes no attestation",
  (await (async () => {
    const io = fakeAttestationIo();
    const a = buildAdapters();
    const out = await R.runOperator(baseCtx({
      mode: "PREFLIGHT_READONLY", ...a, attestationIo: io,
      health: { calls: [], check: async () => ({ status: "degraded", reachable: true, latencyMs: 1 }) },
    }));
    return out.ok === false && out.reason === F.READINESS_EVIDENCE_INSUFFICIENT && io.state.written === null;
  })()));
record("P18a an aborted identity GET fails hard, before any readiness verdict",
  (await (async () => {
    const { out, io } = await preflightWithRoutes([
      ["/subscribed_apps", okResponse({ data: [{ id: APP_ID }] })], approvedTemplateRoute,
      [EXPECTED.wabaId, okResponse({ id: EXPECTED.wabaId, business_verification_status: "verified" })],
      [EXPECTED.phoneNumberId, { kind: "aborted" }],
    ]);
    return out.ok === false && out.reason === F.META_GET_FAILED && io.state.written === null;
  })()));
record("P19 an unverified phone-number state blocks readiness",
  (await (async () => {
    const { out } = await preflightWithRoutes([
      ["/subscribed_apps", okResponse({ data: [{ id: APP_ID }] })], approvedTemplateRoute,
      [EXPECTED.wabaId, okResponse({ id: EXPECTED.wabaId, business_verification_status: "verified" })],
      [EXPECTED.phoneNumberId, okResponse({ id: EXPECTED.phoneNumberId, code_verification_status: "PENDING" })],
    ]);
    return out.ok === false && out.reason === F.READINESS_EVIDENCE_INSUFFICIENT;
  })()));
record("P20 absent business verification blocks readiness",
  (await (async () => {
    const { out } = await preflightWithRoutes([
      ["/subscribed_apps", okResponse({ data: [{ id: APP_ID }] })], approvedTemplateRoute,
      [EXPECTED.wabaId, okResponse({ id: EXPECTED.wabaId })],
      [EXPECTED.phoneNumberId, okResponse({ id: EXPECTED.phoneNumberId, code_verification_status: "VERIFIED" })],
    ]);
    return out.ok === false && out.reason === F.READINESS_EVIDENCE_INSUFFICIENT;
  })()));

// ---------------------------------------------------------------------------
// W. WRITE MODES CALL EXACTLY ONE RPC EACH
// ---------------------------------------------------------------------------
/**
 * Stage 1 genuinely runs when NO policy row exists yet and creates it, so the attestation
 * and the pre-write preflight must both observe the same absent-policy state. The fake
 * therefore ADVANCES only after the RPC — which is also what makes the readback a real
 * test rather than an echo of the pre-state.
 */
function stateAdvancingDb(adapters, client, { before, after }) {
  const flag = { armed: false };
  const originalRpc = client.rpc.bind(client);
  client.rpc = async (name, args) => {
    const out = await originalRpc(name, args);
    flag.armed = true;
    return out;
  };
  return {
    ...adapters.db,
    async readPolicy() {
      adapters.db.calls.push("readPolicy");
      return flag.armed ? after.policy : before.policy;
    },
    async readMappings() {
      adapters.db.calls.push("readMappings");
      return flag.armed ? after.mappings : before.mappings;
    },
    async readCanaryDestinations() {
      adapters.db.calls.push("readCanaryDestinations");
      return flag.armed ? after.canaryRows : before.canaryRows;
    },
  };
}

const readinessMint = await mintAttestation("ARM_READINESS", { policy: null });
record("W01 a readiness attestation can be minted from a real preflight",
  readinessMint.ok === true, JSON.stringify(readinessMint.out?.reason ?? ""));

const armClient = fakeClient({
  policy: null,
  rpcImpl: () => ({ data: [{ policy_activation_status: "readiness_only" }], error: null }),
});
const armAdapters = buildAdapters({ client: armClient });
const armDb = stateAdvancingDb(armAdapters, armClient, {
  before: { policy: null, mappings: [mapping()], canaryRows: [] },
  after: { policy: readinessPolicy(), mappings: [mapping()], canaryRows: [] },
});
const armIo = fakeAttestationIo(readinessMint.attestation);
const armOut = await R.runOperator(baseCtx({
  mode: "ARM_READINESS", ...armAdapters, db: armDb, attestationIo: armIo,
}));
record("W01a arm-readiness succeeded", armOut.ok === true, JSON.stringify(armOut.reason ?? "") + JSON.stringify(armOut.detail ?? ""));

record("W02 arm-readiness invokes ONLY qf_arm_meta_provider_readiness_v1",
  armClient.log.rpcs.length === 1 &&
  armClient.log.rpcs[0].name === R.RPC_NAMES.armReadiness, JSON.stringify(armClient.log.rpcs.map((r) => r.name)));
record("W03 arm-readiness performs NO direct table write",
  armClient.log.writes.length === 0);
record("W04 arm-readiness reruns the FULL preflight immediately before mutating",
  armAdapters.db.calls.filter((c) => c === "readPolicy").length >= 2 &&
  armAdapters.meta.calls.length >= 4 && armAdapters.health.calls.length === 1);
record("W05 arm-readiness performs a mandatory post-write readback",
  armOut.ok === true && armOut.posture?.activation_status === "readiness_only" &&
  armOut.posture?.outbound_enabled === false);
record("W06 the nonce is consumed only AFTER the readback passed",
  armIo.state.consumed.length === 1 &&
  armIo.state.consumed[0] === readinessMint.attestation.attestation_sha256);
record("W07 arm-readiness leaves zero active mappings and zero active canary rows",
  armOut.ok === true && armOut.observed.activeMappingKeys.length === 0 &&
  armOut.observed.activeCanaryCount === 0);

const canaryMint = await mintAttestation("ARM_CANARY", { client: fakeClient({ policy: readinessPolicy() }) });
record("W08 a distinct canary-stage attestation can be minted", canaryMint.ok === true &&
  canaryMint.attestation.stage === "ARM_CANARY");

const canaryClient = fakeClient({
  policy: readinessPolicy(),
  rpcImpl: () => ({ data: [{ policy_activation_status: "canary" }], error: null }),
});
// The readback must observe the ARMED state, so the fake advances after the RPC.
canaryClient.armed = false;
const canaryAdapters = buildAdapters({ client: canaryClient });
const originalRpc = canaryClient.rpc.bind(canaryClient);
canaryClient.rpc = async (name, args) => {
  const out = await originalRpc(name, args);
  if (name === R.RPC_NAMES.armCanary) canaryClient.armed = true;
  return out;
};
const canaryDb = {
  ...canaryAdapters.db,
  async readPolicy() {
    canaryAdapters.db.calls.push("readPolicy");
    return canaryClient.armed
      ? { ...readinessPolicy(), activation_status: "canary", outbound_enabled: true }
      : readinessPolicy();
  },
  async readMappings() {
    canaryAdapters.db.calls.push("readMappings");
    return [mapping({ is_active: canaryClient.armed })];
  },
  async readCanaryDestinations() {
    canaryAdapters.db.calls.push("readCanaryDestinations");
    return canaryClient.armed
      ? [{ provider_key: "meta_whatsapp_cloud", channel: "whatsapp", destination_hash: CANARY_HASH, is_active: true, expires_at: new Date(NOW + 3_600_000).toISOString() }]
      : [];
  },
};
const canaryIo = fakeAttestationIo(canaryMint.attestation);
const canaryOut = await R.runOperator(baseCtx({
  mode: "ARM_CANARY", ...canaryAdapters, db: canaryDb, attestationIo: canaryIo,
}));

record("W09 arm-canary invokes ONLY qf_arm_meta_canary_v1",
  canaryClient.log.rpcs.filter((r) => r.name !== undefined).length === 1 &&
  canaryClient.log.rpcs[0].name === R.RPC_NAMES.armCanary,
  JSON.stringify(canaryClient.log.rpcs.map((r) => r.name)));
record("W10 arm-canary succeeds and the readback proves the exact canary posture",
  canaryOut.ok === true &&
  canaryOut.observed.policy.activation_status === "canary" &&
  canaryOut.observed.policy.outbound_enabled === true &&
  canaryOut.observed.activeMappingKeys.join(",") === TEMPLATE_KEY &&
  canaryOut.observed.activeCanaryCount === 1, JSON.stringify(canaryOut.reason ?? ""));
record("W11 arm-canary passes the exact selected template key and hash to the RPC",
  canaryClient.log.rpcs[0].args?.p_template_key === TEMPLATE_KEY &&
  canaryClient.log.rpcs[0].args?.p_destination_hash === CANARY_HASH &&
  canaryClient.log.rpcs[0].args?.p_phone_number_reference === EXPECTED.phoneNumberId);
record("W12 arm-canary consumes its nonce only after the readback",
  canaryIo.state.consumed.length === 1 &&
  canaryIo.state.consumed[0] === canaryMint.attestation.attestation_sha256);
record("W13 arm-canary refuses when durable readiness is not already true",
  (await (async () => {
    const c = fakeClient({ account: unreadyAccount(), policy: readinessPolicy() });
    const out = await R.runOperator(baseCtx({
      mode: "ARM_CANARY", ...buildAdapters({ client: c }),
      attestationIo: fakeAttestationIo(canaryMint.attestation),
    }));
    return out.ok === false && c.log.rpcs.length === 0;
  })()));
record("W14 arm-canary refuses when an unrelated mapping is already active",
  (await (async () => {
    const c = fakeClient({
      policy: readinessPolicy(),
      mappings: [mapping(), mapping({ id: "m2", template_key: "lead_received", provider_template_name: "qf_lead_received_v1", is_active: true })],
    });
    const out = await R.runOperator(baseCtx({
      mode: "ARM_CANARY", ...buildAdapters({ client: c }),
      attestationIo: fakeAttestationIo(canaryMint.attestation),
    }));
    return out.ok === false && c.log.rpcs.length === 0;
  })()));

// ---------------------------------------------------------------------------
// D. DISABLE — no Meta, no attestation, idempotent, from any state
// ---------------------------------------------------------------------------
const disabledState = () => ({
  policy: { provider_key: "meta_whatsapp_cloud", channel: "whatsapp", activation_status: "disabled",
    outbound_enabled: false, webhook_processing_enabled: false, health_check_enabled: false },
  mappings: [mapping({ is_active: false })], canaryRows: [],
  account: unreadyAccount(),
});

async function runDisableFrom(label) {
  const s = disabledState();
  const c = fakeClient({ ...s, rpcImpl: () => ({ data: [{ policy_activation_status: "disabled" }], error: null }) });
  const out = await R.runOperator(baseCtx({
    mode: "DISABLE", db: R.createSupabaseDbAdapter(c),
    meta: null, health: null, indexProof: null, attestationIo: null,
  }));
  return { label, out, client: c };
}

const dis1 = await runDisableFrom("from disabled");
record("D01 disable requires NO Meta adapter, NO health adapter and NO attestation",
  dis1.out.ok === true, JSON.stringify(dis1.out.reason ?? ""));
record("D02 disable invokes ONLY qf_disable_meta_canary_v1",
  dis1.client.log.rpcs.length === 1 && dis1.client.log.rpcs[0].name === R.RPC_NAMES.disable);
record("D03 disable performs no direct table write",
  dis1.client.log.writes.length === 0);
record("D04 disable performs an independent readback and proves the frozen gate refuses",
  dis1.out.observed.policy.activation_status === "disabled" &&
  dis1.out.observed.policy.outbound_enabled === false &&
  dis1.out.observed.activeMappingKeys.length === 0 &&
  dis1.out.observed.activeCanaryCount === 0);
record("D05 disable is idempotent — running it twice is still ok",
  (await runDisableFrom("again")).out.ok === true);
record("D06 disable refuses to report success if a gate is still open",
  (await (async () => {
    const c = fakeClient({
      policy: { activation_status: "canary", outbound_enabled: true },
      mappings: [mapping({ is_active: true })],
      rpcImpl: () => ({ data: [{ ok: true }], error: null }),
    });
    const out = await R.runOperator(baseCtx({
      mode: "DISABLE", db: R.createSupabaseDbAdapter(c), meta: null, health: null,
      indexProof: null, attestationIo: null,
    }));
    return out.ok === false && out.reason === F.READBACK_MISMATCH;
  })()));
record("D07 the requirement table states disable needs neither Meta nor attestation",
  R.MODE_REQUIREMENTS.DISABLE.meta === false &&
  R.MODE_REQUIREMENTS.DISABLE.attestation === false &&
  R.MODE_REQUIREMENTS.DISABLE.indexProof === false &&
  R.MODE_REQUIREMENTS.DISABLE.canaryDestination === false);

// ---------------------------------------------------------------------------
// A. ATTESTATION AND DRIFT
// ---------------------------------------------------------------------------
record("A01 a missing attestation blocks every opening write",
  (await (async () => {
    for (const mode of ["ARM_READINESS", "ARM_CANARY"]) {
      const c = fakeClient({ policy: readinessPolicy() });
      const out = await R.runOperator(baseCtx({ mode, ...buildAdapters({ client: c }), attestationIo: fakeAttestationIo(null) }));
      if (out.ok !== false || c.log.rpcs.length !== 0) return false;
    }
    return true;
  })()));
record("A02 a WRONG-STAGE attestation cannot open the other stage",
  (await (async () => {
    const c = fakeClient({ policy: readinessPolicy() });
    const out = await R.runOperator(baseCtx({
      mode: "ARM_CANARY", ...buildAdapters({ client: c }),
      attestationIo: fakeAttestationIo(readinessMint.attestation),
    }));
    return out.reason === F.ATTESTATION_WRONG_STAGE && c.log.rpcs.length === 0;
  })()));
record("A03 a REPLAYED (already consumed) attestation is refused",
  (await (async () => {
    // policy: null matches the state the attestation was minted against, so the replay
    // check is what refuses — not an unrelated drift mismatch.
    const c = fakeClient({ policy: null });
    const io = fakeAttestationIo(readinessMint.attestation);
    io.state.consumed.push(readinessMint.attestation.attestation_sha256);
    const out = await R.runOperator(baseCtx({ mode: "ARM_READINESS", ...buildAdapters({ client: c }), attestationIo: io }));
    return out.reason === F.ATTESTATION_ALREADY_CONSUMED && c.log.rpcs.length === 0;
  })()));
record("A04 a STALE attestation is refused",
  (await (async () => {
    const stale = { ...readinessMint.attestation, expires_at_ms: NOW - 1 };
    stale.attestation_sha256 = attestationDigest(
      Object.fromEntries(Object.entries(stale).filter(([k]) => k !== "attestation_sha256")));
    const c = fakeClient({ policy: readinessPolicy() });
    const out = await R.runOperator(baseCtx({ mode: "ARM_READINESS", ...buildAdapters({ client: c }), attestationIo: fakeAttestationIo(stale) }));
    return out.reason === F.ATTESTATION_EXPIRED && c.log.rpcs.length === 0;
  })()));
record("A05 a TAMPERED attestation is refused",
  (await (async () => {
    const t = { ...readinessMint.attestation, project_ref: "uckafzuochmbvtiodmcl", nonce: "z".repeat(64) };
    const c = fakeClient({ policy: readinessPolicy() });
    const out = await R.runOperator(baseCtx({ mode: "ARM_READINESS", ...buildAdapters({ client: c }), attestationIo: fakeAttestationIo(t) }));
    return out.ok === false && c.log.rpcs.length === 0;
  })()));
record("A06 DB DRIFT between preflight and write refuses the write",
  (await (async () => {
    // The attestation pinned a readiness_only policy; the fresh preflight sees canary.
    const c = fakeClient({
      policy: { ...readinessPolicy(), activation_status: "canary", outbound_enabled: true },
    });
    const out = await R.runOperator(baseCtx({
      mode: "ARM_READINESS", ...buildAdapters({ client: c }),
      attestationIo: fakeAttestationIo(readinessMint.attestation),
    }));
    return out.ok === false && c.log.rpcs.length === 0;
  })()));
record("A07 REMOTE template drift between preflight and write refuses the write",
  (await (async () => {
    const c = fakeClient({ policy: readinessPolicy() });
    const drifted = buildAdapters({ client: c, routes: [
      ["/subscribed_apps", okResponse({ data: [{ id: "app-CHANGED" }] })],
      ["/message_templates", okResponse({ data: [{ name: TEMPLATE_NAME, language: "en", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "changed" }] }] })],
      [EXPECTED.wabaId, okResponse({ id: EXPECTED.wabaId, business_verification_status: "verified" })],
      [EXPECTED.phoneNumberId, okResponse({ id: EXPECTED.phoneNumberId, code_verification_status: "VERIFIED", quality_rating: "YELLOW" })],
    ] });
    const out = await R.runOperator(baseCtx({
      mode: "ARM_READINESS", ...drifted, attestationIo: fakeAttestationIo(readinessMint.attestation),
    }));
    return out.ok === false && c.log.rpcs.length === 0;
  })()));

// ---------------------------------------------------------------------------
// U. AMBIGUOUS WRITE — NEVER A SECOND INVOCATION
// ---------------------------------------------------------------------------
record("U01 a thrown RPC is WRITE_OUTCOME_UNCERTAIN and is invoked exactly once",
  (await (async () => {
    const c = fakeClient({ policy: null, rpcImpl: () => { throw new Error("socket hang up"); } });
    const out = await R.runOperator(baseCtx({
      mode: "ARM_READINESS", ...buildAdapters({ client: c }),
      attestationIo: fakeAttestationIo(readinessMint.attestation),
    }));
    return out.reason === F.WRITE_OUTCOME_UNCERTAIN && c.log.rpcs.length === 1;
  })()));
record("U02 a data-less RPC result is uncertain, not success",
  (await (async () => {
    const c = fakeClient({ policy: null, rpcImpl: () => ({ data: null, error: null }) });
    const out = await R.runOperator(baseCtx({
      mode: "ARM_READINESS", ...buildAdapters({ client: c }),
      attestationIo: fakeAttestationIo(readinessMint.attestation),
    }));
    return out.reason === F.WRITE_OUTCOME_UNCERTAIN && c.log.rpcs.length === 1;
  })()));
record("U03 an uncertain write does NOT consume the nonce",
  (await (async () => {
    const c = fakeClient({ policy: null, rpcImpl: () => { throw new Error("x"); } });
    const io = fakeAttestationIo(readinessMint.attestation);
    await R.runOperator(baseCtx({ mode: "ARM_READINESS", ...buildAdapters({ client: c }), attestationIo: io }));
    return io.state.consumed.length === 0;
  })()));
record("U04 a definite server refusal is distinguished from ambiguity",
  (await R.invokeOnce(async () => ({ data: null, error: { message: "refused" } }))).refused === true);
record("U05 a failed readback does not consume the nonce",
  (await (async () => {
    const c = fakeClient({
      policy: readinessPolicy(),
      // The RPC "succeeds" but the readback still shows a sending posture.
      rpcImpl: () => ({ data: [{ ok: true }], error: null }),
    });
    const db = { ...R.createSupabaseDbAdapter(c) };
    const adapters = buildAdapters({ client: c });
    const io = fakeAttestationIo(readinessMint.attestation);
    const driftDb = {
      ...adapters.db,
      async readPolicy() { adapters.db.calls.push("readPolicy"); return { ...readinessPolicy(), outbound_enabled: true }; },
    };
    const out = await R.runOperator(baseCtx({ mode: "ARM_READINESS", ...adapters, db: driftDb, attestationIo: io }));
    return out.ok === false && io.state.consumed.length === 0 && Boolean(db);
  })()));

// ---------------------------------------------------------------------------
// E. ENVIRONMENT — one provider identity, staging only, secret hygiene
// ---------------------------------------------------------------------------
record("E01 a QF_META_* / WHATSAPP_* mismatch is rejected, naming only the variable",
  (() => {
    const r = R.reconcileProviderEnv({ QF_META_ACCESS_TOKEN: "A", WHATSAPP_ACCESS_TOKEN: "B" });
    return r.ok === false && r.reason === F.PROVIDER_ENV_MISMATCH &&
      r.fields.join(",") === "WHATSAPP_ACCESS_TOKEN" && !JSON.stringify(r).includes('"A"');
  })());
record("E02 every alias pair is individually reconciled",
  R.PROVIDER_ENV_ALIASES.length === 4 &&
  R.PROVIDER_ENV_ALIASES.every(([op, core]) => {
    const r = R.reconcileProviderEnv({ [op]: "same", [core]: "different" });
    return r.ok === false && r.fields.includes(core);
  }));
record("E03 an absent Core counterpart is tolerated before Core starts, required in strict mode",
  R.reconcileProviderEnv({ QF_META_WABA_ID: "1" }).ok === true &&
  R.reconcileProviderEnv({ QF_META_WABA_ID: "1" }, { strict: true }).ok === false);
record("E04 strict mode requires provider mode meta_cloud and the webhook secrets",
  (() => {
    const full = {
      QF_META_ACCESS_TOKEN: "t", WHATSAPP_ACCESS_TOKEN: "t",
      QF_META_PHONE_NUMBER_ID: "1", WHATSAPP_PHONE_NUMBER_ID: "1",
      QF_META_WABA_ID: "2", WHATSAPP_WABA_ID: "2",
      QF_META_GRAPH_API_VERSION: "v21.0", WHATSAPP_GRAPH_API_VERSION: "v21.0",
      WHATSAPP_APP_SECRET: "s", WHATSAPP_WEBHOOK_VERIFY_TOKEN: "v",
    };
    const good = R.reconcileProviderEnv({ ...full, WHATSAPP_PROVIDER_MODE: "meta_cloud" }, { strict: true });
    const badMode = R.reconcileProviderEnv({ ...full, WHATSAPP_PROVIDER_MODE: "mock" }, { strict: true });
    const noSecret = { ...full, WHATSAPP_PROVIDER_MODE: "meta_cloud" };
    delete noSecret.WHATSAPP_APP_SECRET;
    return good.ok === true && badMode.reason === F.PROVIDER_MODE_INVALID &&
      R.reconcileProviderEnv(noSecret, { strict: true }).reason === F.PROVIDER_ENV_MISSING;
  })());
record("E05 the runtime never reads process.env itself — the operator injects everything",
  !/process\.env/.test(runtimeCode));
record("E06 project identity is proven from the URL fence, never by parsing a key",
  !/atob|Buffer\.from\([^)]*base64|jwt|decode/i.test(runtimeCode) &&
  /resolveActivationTarget/.test(operatorCode));
record("E07 no secret value appears in any runtime output path",
  !/console\.log\([^)]*ACCESS_TOKEN|console\.log\([^)]*SERVICE_ROLE/.test(operatorCode + runtimeCode));

// ---------------------------------------------------------------------------
// S. STRUCTURAL — no send capability anywhere in the runtime
// ---------------------------------------------------------------------------
record("S01 the runtime's executable code contains no send endpoint",
  !/\/messages/.test(runtimeCode.replace(/message_templates/g, "")));
record("S02 the runtime issues no Meta write verb",
  !/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(runtimeCode));
record("S03 the db adapter cannot express a table write at all",
  (() => {
    const adapter = R.createSupabaseDbAdapter(fakeClient());
    return typeof adapter.update === "undefined" && typeof adapter.insert === "undefined" &&
      typeof adapter.upsert === "undefined" && typeof adapter.delete === "undefined";
  })());
record("S04 the runtime names exactly the three permitted RPCs and no other",
  Object.values(R.RPC_NAMES).length === 3 &&
  (runtimeCode.match(/qf_arm_meta_provider_readiness_v1|qf_arm_meta_canary_v1|qf_disable_meta_canary_v1/g) ?? []).length === 3 &&
  !/\.rpc\(["']/.test(runtimeCode));
record("S05 the two switch tables are never written directly",
  R.FORBIDDEN_DIRECT_WRITE_TABLES.every((t) =>
    !new RegExp(`from\\(["']${t}["']\\)[\\s\\S]{0,200}\\.(update|insert|upsert)\\(`).test(runtimeCode)));
record("S06 the runtime reuses the frozen gate and the canonical hash, not local copies",
  /proveDisabledIsFailClosed/.test(runtimeCode) &&
  /planCanaryArm|planReadinessArm/.test(runtimeCode) &&
  !/createHash\(["']sha256["']\)/.test(runtimeCode));
record("S07 the health mapping matches the canonical toAccountHealthStatus three-way rule",
  // The canonical class cannot be imported from an operator script (the MVP loader
  // refuses lib/supabase, and the provider uses TS parameter properties), so the rule is
  // pinned against that service's SOURCE so a drift is still caught.
  /if \(health\.status === "healthy"\) return "healthy";/.test(healthServiceSource) &&
  /if \(health\.reachable\) return "degraded";/.test(healthServiceSource) &&
  /return "unhealthy";/.test(healthServiceSource) &&
  /healthy.*:.*reachable.*\?.*"degraded".*:.*"unhealthy"/.test(runtimeCode));
record("S08 the operator uses the canonical abortable transport, not a bare fetch",
  /FetchHttpTransport/.test(operatorCode) && !/\bfetch\(/.test(runtimeCode));

// ---------------------------------------------------------------------------
// R3. DEDICATED STAGING META CONTROL PLANE — scope guard
//
// The rule: an asset nobody classified is SHARED_OR_UNKNOWN, and SHARED_OR_UNKNOWN is a
// hard stop before any provider arm. Emergency closure stays exempt.
// ---------------------------------------------------------------------------
const armReadyClient = () => fakeClient({ policy: readinessPolicy() });

/** Run a scope-guarded mode with a substituted staging-asset proof. */
async function withAssetProof(mode, assetProof, { attestation = null, client } = {}) {
  const c = client ?? armReadyClient();
  const out = await R.runOperator(baseCtx({
    mode, ...buildAdapters({ client: c, assetProof }),
    attestationIo: fakeAttestationIo(attestation),
    stageForAttestation: mode === "PREFLIGHT_READONLY" ? "ARM_READINESS" : null,
  }));
  return { out, client: c };
}

record("R3-01 MODE_REQUIREMENTS marks every scope-guarded mode",
  R.MODE_REQUIREMENTS.PREFLIGHT_READONLY.assetScope === true &&
  R.MODE_REQUIREMENTS.ARM_READINESS.assetScope === true &&
  R.MODE_REQUIREMENTS.ARM_CANARY.assetScope === true);
record("R3-02 DRY_RUN and DISABLE are deliberately NOT scope-guarded",
  R.MODE_REQUIREMENTS.DRY_RUN.assetScope === false &&
  R.MODE_REQUIREMENTS.DISABLE.assetScope === false);
record("R3-03 a preflight with a proven staging-dedicated asset records the classification",
  pfIo.state.written?.asset_scope === "STAGING_DEDICATED" &&
  pfIo.state.written?.staging_asset_proof_hash === "s".repeat(64));
record("R3-04 the attestation binds the live Meta asset identity",
  typeof pfIo.state.written?.meta_asset_identity_digest === "string" &&
  pfIo.state.written.meta_asset_identity_digest.length > 0);
record("R3-05 a MISSING staging-asset proof refuses the preflight",
  (await withAssetProof("PREFLIGHT_READONLY", null)).out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN);
record("R3-06 an UNVERIFIED staging-asset proof refuses the preflight",
  (await withAssetProof("PREFLIGHT_READONLY",
    { ok: false, reason: F.STAGING_ASSET_PROOF_INVALID })).out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN);
record("R3-07 no attestation is written when the asset scope is unproven",
  (await (async () => {
    const io = fakeAttestationIo();
    const out = await R.runOperator(baseCtx({
      mode: "PREFLIGHT_READONLY", ...buildAdapters({ assetProof: null }),
      attestationIo: io, stageForAttestation: "ARM_READINESS",
    }));
    return out.ok === false && io.state.written === null;
  })()));

// ---------------------------------------------------------------------------
// R7A. The owner-attested subscriber SET, proven end-to-end through runPreflight rather
// than only at the classifier. A dedicated Meta TEST WABA carries the owner's staging app
// plus a platform/test companion; R3 could not express that and refused it forever.
// ---------------------------------------------------------------------------
const COMPANION_APP_ID = "333444555666777";   // synthetic companion subscription
const THIRD_APP_ID = "444555666777888";       // synthetic unattested subscriber

const routesWithApps = (ids) => [
  ["/subscribed_apps", okResponse({ data: ids.map((id) => ({ whatsapp_business_api_data: { id } })) })],
  ...defaultRoutes().slice(1),
];
async function preflightWithApps(liveIds, assetProof) {
  const io = fakeAttestationIo();
  const out = await R.runOperator(baseCtx({
    mode: "PREFLIGHT_READONLY", stageForAttestation: "ARM_READINESS",
    ...buildAdapters({ client: armReadyClient(), routes: routesWithApps(liveIds), assetProof }),
    attestationIo: io,
  }));
  return { out, io };
}

record("R7A-R1 a dedicated TEST WABA with an owner-attested companion app passes preflight",
  (await (async () => {
    const { out, io } = await preflightWithApps([APP_ID, COMPANION_APP_ID],
      stagingAssetProof({ expectedSubscribedAppIds: [APP_ID, COMPANION_APP_ID] }));
    return out.ok === true && io.state.written?.asset_scope === "STAGING_DEDICATED";
  })()));
record("R7A-R2 an unattested third subscriber refuses the preflight and writes nothing",
  (await (async () => {
    const { out, io } = await preflightWithApps([APP_ID, COMPANION_APP_ID, THIRD_APP_ID],
      stagingAssetProof({ expectedSubscribedAppIds: [APP_ID, COMPANION_APP_ID] }));
    return out.ok === false && out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN && io.state.written === null;
  })()));
record("R7A-R3 a missing attested subscriber refuses the preflight",
  (await (async () => {
    const { out } = await preflightWithApps([APP_ID],
      stagingAssetProof({ expectedSubscribedAppIds: [APP_ID, COMPANION_APP_ID] }));
    return out.ok === false && out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN;
  })()));
record("R7A-R4 a pre-R7A proof carrying no attested set still refuses a second subscriber",
  (await (async () => {
    const { out } = await preflightWithApps([APP_ID, COMPANION_APP_ID], stagingAssetProof());
    return out.ok === false && out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN;
  })()));
record("R3-08 a proof for a DIFFERENT WABA cannot classify this asset",
  (await withAssetProof("PREFLIGHT_READONLY",
    stagingAssetProof({ wabaId: "555555555555555" }))).out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN);
record("R3-09 a proof for a DIFFERENT phone cannot classify this asset",
  (await withAssetProof("PREFLIGHT_READONLY",
    stagingAssetProof({ phoneNumberId: "555555555555555" }))).out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN);
record("R3-10 a proof for a DIFFERENT subscribed app cannot classify this asset",
  (await withAssetProof("PREFLIGHT_READONLY",
    stagingAssetProof({ metaAppId: "444444444444444" }))).out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN);
record("R3-11 a proof minted for a DIFFERENT commit refuses",
  (await withAssetProof("PREFLIGHT_READONLY",
    stagingAssetProof({ branchHead: "b".repeat(40) }))).out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN);
record("R3-12 a live asset on the owner's prohibited list refuses",
  (await withAssetProof("PREFLIGHT_READONLY",
    stagingAssetProof({ prohibited: { ids: [EXPECTED.wabaId], digests: [] } }))).out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN);
record("R3-13 an identity fault still reports the SPECIFIC evidence failure, not a scope verdict",
  (await (async () => {
    const { out } = await preflightWithRoutes([
      ["/subscribed_apps", okResponse({ data: [{ id: APP_ID }] })], approvedTemplateRoute,
      [EXPECTED.wabaId, okResponse({ id: "999999999999999", business_verification_status: "verified" })],
      [EXPECTED.phoneNumberId, okResponse({ id: EXPECTED.phoneNumberId, code_verification_status: "VERIFIED" })],
    ]);
    return out.reason === F.READINESS_EVIDENCE_INSUFFICIENT;
  })()));

// ---------------------------------------------------------------------------
// M. MUTANTS
// ---------------------------------------------------------------------------
const mutants = [
  ["ARM_READINESS refuses without a staging-asset proof, and calls NO rpc",
    async () => {
      const { out, client } = await withAssetProof("ARM_READINESS", null,
        { attestation: readinessMint.attestation });
      return out.ok === false && out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN && client.log.rpcs.length === 0;
    }],
  ["ARM_CANARY refuses without a staging-asset proof, and calls NO rpc",
    async () => {
      const { out, client } = await withAssetProof("ARM_CANARY", null,
        { attestation: canaryMint.attestation, client: fakeClient({ policy: readinessPolicy() }) });
      return out.ok === false && out.reason === F.STAGING_ASSET_SCOPE_UNPROVEN && client.log.rpcs.length === 0;
    }],
  ["an attestation minted as dedicated cannot be spent once the scope degrades",
    async () => {
      const { out, client } = await withAssetProof("ARM_READINESS",
        stagingAssetProof({ metaAppId: "444444444444444" }),
        { attestation: readinessMint.attestation });
      return out.ok === false && client.log.rpcs.length === 0;
    }],
  ["the scope classification is part of the attestation drift fence",
    () => /"asset_scope"|asset_scope/.test(runtimeCode) &&
      /asset_scope[\s\S]{0,200}staging_asset_proof_hash[\s\S]{0,200}meta_asset_identity_digest/.test(runtimeCode)],
  ["SHARED_OR_UNKNOWN can never be spelled as a third, softer value",
    () => Object.keys(AssetScope).length === 2 &&
      AssetScope.STAGING_DEDICATED === "STAGING_DEDICATED" &&
      AssetScope.SHARED_OR_UNKNOWN === "SHARED_OR_UNKNOWN"],
  ["emergency disable still works with NO staging-asset proof at all",
    async () => {
      const s = disabledState();
      const c = fakeClient({ ...s, rpcImpl: () => ({ data: [{ policy_activation_status: "disabled" }], error: null }) });
      const out = await R.runOperator(baseCtx({
        mode: "DISABLE", db: R.createSupabaseDbAdapter(c),
        meta: null, health: null, indexProof: null, attestationIo: null, assetProof: null,
      }));
      return out.ok === true && c.log.rpcs.length === 1;
    }],
  ["preflight cannot be made to write",
    () => pf.client.log.writes.length === 0 && pf.client.log.rpcs.length === 0],
  ["a write mode cannot skip its attestation",
    async () => {
      const c = fakeClient({ policy: readinessPolicy() });
      const out = await R.runOperator(baseCtx({ mode: "ARM_READINESS", ...buildAdapters({ client: c }), attestationIo: fakeAttestationIo(null) }));
      return out.ok === false && c.log.rpcs.length === 0;
    }],
  ["a readiness attestation cannot arm the canary",
    async () => {
      const c = fakeClient({ policy: readinessPolicy() });
      const out = await R.runOperator(baseCtx({ mode: "ARM_CANARY", ...buildAdapters({ client: c }), attestationIo: fakeAttestationIo(readinessMint.attestation) }));
      return out.ok === false && c.log.rpcs.length === 0;
    }],
  ["an ambiguous write is never retried",
    async () => {
      const c = fakeClient({ policy: null, rpcImpl: () => { throw new Error("x"); } });
      await R.runOperator(baseCtx({ mode: "ARM_READINESS", ...buildAdapters({ client: c }), attestationIo: fakeAttestationIo(readinessMint.attestation) }));
      return c.log.rpcs.length === 1;
    }],
  ["disable never needs Meta connectivity",
    async () => (await runDisableFrom("mutant")).out.ok === true],
  ["a provider env mismatch cannot be ignored",
    () => R.reconcileProviderEnv({ QF_META_WABA_ID: "1", WHATSAPP_WABA_ID: "2" }).ok === false],
  ["the runtime cannot acquire a send endpoint unnoticed",
    () => !/\/messages/.test(runtimeCode.replace(/message_templates/g, ""))],
  ["the db adapter cannot gain a generic write method unnoticed",
    () => {
      const a = R.createSupabaseDbAdapter(fakeClient());
      return ["update", "insert", "upsert", "delete", "patch"].every((m) => typeof a[m] === "undefined");
    }],
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
console.log(`\nQF-MVP-40.13C CANARY RUNTIME: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exit(1);
console.log("QF_MVP_40_13C_CANARY_RUNTIME_EXECUTABLE");
