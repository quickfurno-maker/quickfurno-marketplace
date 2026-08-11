// ============================================================================
// QF-MVP-40.13C — EXECUTABLE runtime for the staging canary activation operator.
//
// This module is the missing executable layer. 40.13B shipped the pure decision
// authority and the SQL RPCs but never wired them together, so the operator modes
// could not actually do what their names claim. This does.
//
// IMPORT-SAFE BY CONSTRUCTION
//   Importing this file constructs no client, opens no socket, reads no credential and
//   touches no file. EVERY effect arrives through an injected adapter, so the offline
//   tests drive all five modes with fakes. The real adapters are built only by the
//   operator's `isDirect` entry point, and only after the staging identity fence passes.
//
// TWO CONSTRAINTS THAT SHAPED THIS FILE — STATED, NOT HIDDEN
//   1. The MVP loader REFUSES to resolve `lib/supabase` and service modules, so
//      `services/communicationProviderHealthService.ts` cannot be imported here at all.
//   2. `lib/communication/providers/metaCloudWhatsAppProvider.ts` cannot be imported
//      under Node's strip-only type mode (it uses TS parameter properties).
//
//   So the canonical health CLASS is unreachable from an operator script — which is
//   exactly why the QF-MVP-40.12 seed also issues its own GET-only Meta calls. What this
//   file does reuse: the canonical abortable `FetchHttpTransport`, the canonical
//   `evaluateMetaOutboundGate`, the canonical phone normalisation/hash, the canonical
//   staging fence and approved set, and the SAME three-way health mapping
//   `toAccountHealthStatus` applies. The 40-13 validator asserts that mapping against the
//   health service's SOURCE TEXT, so a drift is caught even though an import is impossible.
//
//   The canonical PERSISTING health path (`runMetaProviderHealthCheck`) is deliberately
//   not used: it requires `health_check_enabled` and it WRITES, and preflight must be
//   write-free. Core keeps using it at runtime; the operator only reads.
//
// NO SEND CAPABILITY. GET only, no write verb, no `/messages`, no communication row,
// no CommunicationService call, no n8n activation.
// ============================================================================

import {
  ActivationFailure,
  CANARY_DESTINATION_ENV,
  CANARY_WINDOW_MS,
  ATTESTATION_ARTIFACT,
  attestationDigest,
  buildPhoneNumberGetUrl,
  buildSubscribedAppsGetUrl,
  buildWabaGetUrl,
  deriveAccountReadinessFromEvidence,
  planCanaryArm,
  planDisable,
  planFingerprint,
  planReadinessArm,
  proveDisabledIsFailClosed,
  resolveActivationTarget,
  resolveTemplateSelection,
  verifyAttestation,
} from "./activate-meta-staging-canary.mjs";

import { PROVIDER_KEY, CHANNEL, LANGUAGE, SEED_SET } from "./seed-meta-staging-inactive-mappings.mjs";

/** The exact three RPCs this runtime may ever call. Nothing else is reachable. */
export const RPC_NAMES = Object.freeze({
  armReadiness: "qf_arm_meta_provider_readiness_v1",
  armCanary: "qf_arm_meta_canary_v1",
  disable: "qf_disable_meta_canary_v1",
});

/** The two switch tables that must NEVER be written directly by this runtime. */
export const FORBIDDEN_DIRECT_WRITE_TABLES = Object.freeze([
  "communication_provider_runtime_policies",
  "communication_provider_canary_destinations",
]);

/**
 * What each mode genuinely needs.
 *
 * `disable` deliberately needs NO Meta token, NO canary destination, NO index proof and
 * NO attestation. Closing a gate must never be harder than opening one, and a
 * half-armed staging environment must be recoverable even when Meta is unreachable.
 */
export const MODE_REQUIREMENTS = Object.freeze({
  DRY_RUN:             { db: false, meta: false, indexProof: false, canaryDestination: false, attestation: false, writes: false },
  PREFLIGHT_READONLY:  { db: true,  meta: true,  indexProof: true,  canaryDestination: true,  attestation: false, writes: false },
  ARM_READINESS:       { db: true,  meta: true,  indexProof: true,  canaryDestination: true,  attestation: true,  writes: true  },
  ARM_CANARY:          { db: true,  meta: true,  indexProof: true,  canaryDestination: true,  attestation: true,  writes: true  },
  DISABLE:             { db: true,  meta: false, indexProof: false, canaryDestination: false, attestation: false, writes: true  },
});

// ---------------------------------------------------------------------------
// Env reconciliation — one effective provider identity, never two
// ---------------------------------------------------------------------------

/** The canonical Core provider variables the later staging Core must export. */
export const CORE_PROVIDER_ENV = Object.freeze([
  "WHATSAPP_PROVIDER_MODE",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_WABA_ID",
  "WHATSAPP_GRAPH_API_VERSION",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
]);

/** The operator-local aliases 40.13 locked. */
export const OPERATOR_PROVIDER_ENV = Object.freeze([
  "QF_META_ACCESS_TOKEN",
  "QF_META_PHONE_NUMBER_ID",
  "QF_META_WABA_ID",
  "QF_META_GRAPH_API_VERSION",
]);

/** The exact alias pairs that must hold the SAME effective value. */
export const PROVIDER_ENV_ALIASES = Object.freeze([
  ["QF_META_ACCESS_TOKEN", "WHATSAPP_ACCESS_TOKEN"],
  ["QF_META_PHONE_NUMBER_ID", "WHATSAPP_PHONE_NUMBER_ID"],
  ["QF_META_WABA_ID", "WHATSAPP_WABA_ID"],
  ["QF_META_GRAPH_API_VERSION", "WHATSAPP_GRAPH_API_VERSION"],
]);

export const REQUIRED_PROVIDER_MODE = "meta_cloud";

/**
 * Prove the operator's inputs and the canonical Core runtime variables describe ONE
 * provider identity.
 *
 * Two contradictory provider configurations is how a canary gets armed against one
 * phone number and sent from another. When a `WHATSAPP_*` counterpart is present it must
 * match EXACTLY; comparison is by equality only and NEITHER value is ever returned,
 * printed or logged — only the variable name of a mismatch.
 *
 * A counterpart being ABSENT is not a mismatch here: the operator runs before Core is
 * started. `strict: true` additionally requires every counterpart to be present, which
 * is what the live launcher uses immediately before starting Core.
 */
export function reconcileProviderEnv(env = {}, { strict = false } = {}) {
  const mismatched = [];
  const missing = [];
  for (const [operatorName, coreName] of PROVIDER_ENV_ALIASES) {
    const operatorValue = env[operatorName];
    const coreValue = env[coreName];
    if (coreValue === undefined || coreValue === null || coreValue === "") {
      if (strict) missing.push(coreName);
      continue;
    }
    if (operatorValue !== coreValue) mismatched.push(coreName);
  }
  if (mismatched.length > 0) {
    return { ok: false, reason: ActivationFailure.PROVIDER_ENV_MISMATCH, fields: mismatched.sort() };
  }
  if (strict) {
    if (missing.length > 0) {
      return { ok: false, reason: ActivationFailure.PROVIDER_ENV_MISSING, fields: missing.sort() };
    }
    const mode = env.WHATSAPP_PROVIDER_MODE;
    if (mode !== REQUIRED_PROVIDER_MODE) {
      return { ok: false, reason: ActivationFailure.PROVIDER_MODE_INVALID, fields: ["WHATSAPP_PROVIDER_MODE"] };
    }
    for (const name of ["WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN"]) {
      if (!env[name]) return { ok: false, reason: ActivationFailure.PROVIDER_ENV_MISSING, fields: [name] };
    }
  }
  return { ok: true, reconciled: PROVIDER_ENV_ALIASES.length };
}

// ---------------------------------------------------------------------------
// Adapters — real ones are constructed ONLY by the operator entry point
// ---------------------------------------------------------------------------

/**
 * Read-only Supabase reads plus the three RPCs. There is deliberately no generic
 * `update`/`insert`/`patch` method on this adapter at all: a table write is not
 * expressible through it, which is stronger than choosing not to call one.
 */
export function createSupabaseDbAdapter(client) {
  const calls = [];
  const record = (name) => calls.push(name);
  return {
    calls,
    async readAccount(phoneNumberReference) {
      record("readAccount");
      const { data, error } = await client
        .from("communication_provider_accounts")
        .select("id,provider_key,channel,phone_number_reference,business_account_reference,readiness_status,configuration_status,business_verification_status,phone_number_status,webhook_status,health_status")
        .eq("provider_key", PROVIDER_KEY).eq("channel", CHANNEL)
        .eq("phone_number_reference", phoneNumberReference)
        .maybeSingle();
      if (error) throw new Error(ActivationFailure.SCHEMA_MISSING);
      return data ?? null;
    },
    async readPolicy() {
      record("readPolicy");
      const { data, error } = await client
        .from("communication_provider_runtime_policies")
        .select("provider_key,channel,activation_status,outbound_enabled,webhook_processing_enabled,health_check_enabled")
        .eq("provider_key", PROVIDER_KEY).eq("channel", CHANNEL)
        .maybeSingle();
      if (error) throw new Error(ActivationFailure.SCHEMA_MISSING);
      return data ?? null;
    },
    async readMappings() {
      record("readMappings");
      const { data, error } = await client
        .from("communication_provider_template_mappings")
        .select("id,template_key,channel,provider_key,language,provider_template_name,provider_template_id,provider_category,approval_status,variables_schema,is_active")
        .eq("provider_key", PROVIDER_KEY).eq("channel", CHANNEL);
      if (error) throw new Error(ActivationFailure.SCHEMA_MISSING);
      return data ?? [];
    },
    async readCanaryDestinations() {
      record("readCanaryDestinations");
      const { data, error } = await client
        .from("communication_provider_canary_destinations")
        .select("provider_key,channel,destination_hash,is_active,expires_at")
        .eq("provider_key", PROVIDER_KEY).eq("channel", CHANNEL);
      if (error) throw new Error(ActivationFailure.SCHEMA_MISSING);
      return data ?? [];
    },
    async rpcArmReadiness(args) {
      record(`rpc:${RPC_NAMES.armReadiness}`);
      return client.rpc(RPC_NAMES.armReadiness, args);
    },
    async rpcArmCanary(args) {
      record(`rpc:${RPC_NAMES.armCanary}`);
      return client.rpc(RPC_NAMES.armCanary, args);
    },
    async rpcDisable() {
      record(`rpc:${RPC_NAMES.disable}`);
      return client.rpc(RPC_NAMES.disable, {});
    },
  };
}

/** GET-only Meta evidence. There is no method here that can send anything. */
export function createMetaGetAdapter({ transport, token, graphApiVersion, wabaId, phoneNumberId, timeoutMs = 10_000, maxResponseBytes = 64 * 1024 }) {
  const calls = [];
  const get = async (url, label) => {
    calls.push({ label, method: "GET", url });
    const result = await transport.request({
      url, method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs, maxResponseBytes,
    });
    if (result.kind !== "response") {
      return { ok: false, reason: ActivationFailure.META_GET_FAILED, label };
    }
    let body = null;
    try { body = JSON.parse(result.bodyText); } catch { body = null; }
    return { ok: result.status >= 200 && result.status < 300, status: result.status, body, label };
  };
  return {
    calls,
    getWaba: () => get(buildWabaGetUrl({ graphApiVersion, wabaId }), "waba"),
    getPhoneNumber: () => get(buildPhoneNumberGetUrl({ graphApiVersion, phoneNumberId }), "phone_number"),
    getSubscribedApps: () => get(buildSubscribedAppsGetUrl({ graphApiVersion, wabaId }), "subscribed_apps"),
    getTemplate: (providerTemplateName) =>
      get(`https://graph.facebook.com/${graphApiVersion}/${wabaId}/message_templates`
        + `?fields=name,language,status,category,components&name=${encodeURIComponent(providerTemplateName)}`,
        "message_templates"),
  };
}

/**
 * The health verdict, using the canonical abortable transport and a GET on the phone
 * number — the same request and the same three-way mapping the canonical
 * `toAccountHealthStatus` applies (`healthy` / `degraded` when reachable / `unhealthy`).
 * The canonical class is un-importable from an operator script; the 40-13 validator pins
 * this mapping against that service's source so a drift is still caught.
 */
export function createHealthAdapter({ transport, token, graphApiVersion, phoneNumberId, timeoutMs = 10_000 }) {
  const calls = [];
  return {
    calls,
    async check() {
      calls.push({ method: "GET", label: "health" });
      const started = Date.now();
      const result = await transport.request({
        url: buildPhoneNumberGetUrl({ graphApiVersion, phoneNumberId }),
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        timeoutMs, maxResponseBytes: 64 * 1024,
      });
      const latencyMs = Date.now() - started;
      if (result.kind !== "response") {
        return { status: "unhealthy", reachable: false, latencyMs };
      }
      const reachable = result.status >= 200 && result.status < 500;
      const healthy = result.status >= 200 && result.status < 300;
      return { status: healthy ? "healthy" : reachable ? "degraded" : "unhealthy", reachable, latencyMs };
    },
  };
}

// ---------------------------------------------------------------------------
// PREFLIGHT — reads and Meta GETs only. Structurally incapable of writing.
// ---------------------------------------------------------------------------

/**
 * Gather every durable fact and every piece of Meta evidence the decision layer needs.
 *
 * ZERO writes: the db adapter exposes no write method except the three RPCs, and none is
 * called here. Returns sanitized observed state, the derived evidence, the readiness
 * verdict and the plan — never a token, never a plaintext destination.
 */
export async function runPreflight({ db, meta, health, indexProof, target, templateKeys, expected, now }) {
  const observed = {
    account: await db.readAccount(expected.phoneNumberId),
    policy: await db.readPolicy(),
    mappings: await db.readMappings(),
    canaryRows: await db.readCanaryDestinations(),
  };

  // The 40.12 external index proof, verified through its existing mechanism.
  const proof = await indexProof.verify({ projectRef: target.projectRef, now });
  if (!proof.ok) return { ok: false, reason: proof.reason ?? ActivationFailure.INDEX_PROOF_UNAVAILABLE, detail: proof.detail };

  const waba = await meta.getWaba();
  const phone = await meta.getPhoneNumber();
  const subscribed = await meta.getSubscribedApps();
  if (!waba.ok || !phone.ok || !subscribed.ok) {
    return { ok: false, reason: ActivationFailure.META_GET_FAILED,
      detail: [waba, phone, subscribed].filter((r) => !r.ok).map((r) => r.label).join(",") };
  }

  // Exact remote semantic identity for every selected template.
  const templates = {};
  for (const key of templateKeys) {
    const seed = SEED_SET.find((s) => s.key === key);
    if (!seed) return { ok: false, reason: ActivationFailure.TEMPLATE_NOT_APPROVED_SET, detail: key };
    const remote = await meta.getTemplate(seed.name);
    if (!remote.ok) return { ok: false, reason: ActivationFailure.META_GET_FAILED, detail: `template:${key}` };
    const rows = Array.isArray(remote.body?.data) ? remote.body.data : [];
    const exact = rows.filter((r) => r?.name === seed.name && r?.language === LANGUAGE);
    if (exact.length !== 1) {
      return { ok: false, reason: ActivationFailure.META_TEMPLATE_AMBIGUOUS, detail: key };
    }
    if (String(exact[0].status).toUpperCase() !== "APPROVED") {
      return { ok: false, reason: ActivationFailure.META_STATUS_NOT_APPROVED, detail: key };
    }
    if (String(exact[0].category).toUpperCase() !== "UTILITY") {
      return { ok: false, reason: ActivationFailure.META_CATEGORY_MISMATCH, detail: key };
    }
    templates[key] = { name: seed.name, status: "APPROVED", category: "UTILITY" };
  }

  const verdict = await health.check();

  const wabaId = waba.body?.id;
  const phoneId = phone.body?.id;
  const subscribedData = Array.isArray(subscribed.body?.data) ? subscribed.body.data : [];

  const evidence = {
    configurationComplete: Boolean(target.projectRef) && proof.ok === true,
    wabaIdMatches: typeof wabaId === "string" && wabaId === expected.wabaId,
    phoneNumberIdMatches: typeof phoneId === "string" && phoneId === expected.phoneNumberId,
    phoneConnected: String(phone.body?.code_verification_status ?? "").toUpperCase() === "VERIFIED",
    businessVerified: ["VERIFIED", "APPROVED"].includes(
      String(waba.body?.business_verification_status ?? waba.body?.account_review_status ?? "").toUpperCase()),
    webhookSubscribed: subscribedData.length > 0,
    healthStatus: verdict.status,
  };

  const readiness = deriveAccountReadinessFromEvidence(evidence);

  return {
    ok: true,
    observed: sanitizeObserved(observed),
    observedRaw: observed,
    evidence,
    readiness,
    indexProofHash: proof.hash,
    templates,
    healthVerdict: { status: verdict.status, reachable: verdict.reachable },
  };
}

/** Only non-secret, non-PII projections leave the runtime. */
export function sanitizeObserved(observed) {
  return {
    accountPresent: Boolean(observed.account),
    accountReadiness: observed.account
      ? {
          readiness_status: observed.account.readiness_status,
          configuration_status: observed.account.configuration_status,
          business_verification_status: observed.account.business_verification_status,
          phone_number_status: observed.account.phone_number_status,
          webhook_status: observed.account.webhook_status,
          health_status: observed.account.health_status,
        }
      : null,
    policy: observed.policy
      ? {
          activation_status: observed.policy.activation_status,
          outbound_enabled: observed.policy.outbound_enabled,
          webhook_processing_enabled: observed.policy.webhook_processing_enabled,
          health_check_enabled: observed.policy.health_check_enabled,
        }
      : null,
    mappingCount: observed.mappings.length,
    activeMappingKeys: observed.mappings.filter((m) => m.is_active).map((m) => m.template_key).sort(),
    canaryRowCount: observed.canaryRows.length,
    activeCanaryCount: observed.canaryRows.filter((r) => r.is_active).length,
  };
}

/** The attestation body a preflight publishes. Digests and hashes only. */
export function buildAttestationBody({ stage, target, templateKeys, destinationHash, preflight, planHash, now, nonce, ttlMs }) {
  const body = {
    artifact: ATTESTATION_ARTIFACT,
    environment: "STAGING",
    project_ref: target.projectRef,
    stage,
    branch_head: preflight.branchHead ?? null,
    template_keys: [...templateKeys].sort(),
    provider_key: PROVIDER_KEY,
    channel: CHANNEL,
    language: LANGUAGE,
    account_identity_digest: digestOf({ phoneNumberId: preflight.expected?.phoneNumberId, wabaId: preflight.expected?.wabaId }),
    policy_observed_digest: digestOf(preflight.observed.policy),
    mapping_observed_digest: digestOf({ count: preflight.observed.mappingCount, active: preflight.observed.activeMappingKeys }),
    canary_destination_hash: destinationHash,
    remote_template_digest: digestOf(preflight.templates),
    readiness_evidence_digest: digestOf(preflight.evidence),
    health_verdict_digest: digestOf(preflight.healthVerdict),
    index_proof_hash: preflight.indexProofHash ?? null,
    plan_sha256: planHash,
    nonce,
    issued_at_ms: now,
    expires_at_ms: now + ttlMs,
  };
  return { ...body, attestation_sha256: attestationDigest(body) };
}

function digestOf(value) {
  return planFingerprint({ v: JSON.stringify(value ?? null) });
}

// ---------------------------------------------------------------------------
// WRITE MODES — fresh preflight, exact drift comparison, one RPC, readback
// ---------------------------------------------------------------------------

const RPC_UNCERTAIN = Object.freeze({ ok: false, reason: ActivationFailure.WRITE_OUTCOME_UNCERTAIN });

/**
 * Invoke an RPC EXACTLY ONCE and classify the outcome.
 *
 * An ambiguous outcome — a thrown transport error, or a result carrying neither data nor
 * a definite error — is WRITE_OUTCOME_UNCERTAIN and is NEVER retried. The write may have
 * committed; a second call could double-apply, and for an arming operation that means
 * arming twice.
 */
export async function invokeOnce(fn) {
  let result;
  try {
    result = await fn();
  } catch {
    return RPC_UNCERTAIN;
  }
  if (!result || typeof result !== "object") return RPC_UNCERTAIN;
  if (result.error) {
    // A definite server-side refusal is NOT ambiguous: nothing was written.
    return { ok: false, reason: ActivationFailure.READINESS_NOT_PROVEN, refused: true };
  }
  if (result.data === undefined || result.data === null) return RPC_UNCERTAIN;
  return { ok: true, data: result.data };
}

/** Stage 1: arm readiness. Cannot reach a sending posture. */
export async function runArmReadiness(ctx) {
  const gathered = await preflightForWrite(ctx, "ARM_READINESS");
  if (!gathered.ok) return gathered;
  const { preflight, attestation } = gathered;

  const plan = planReadinessArm({
    policy: preflight.observedRaw.policy,
    account: preflight.observedRaw.account,
    evidence: preflight.evidence,
    expected: ctx.expected,
  });
  if (!plan.ok) return plan;

  const written = await invokeOnce(() => ctx.db.rpcArmReadiness({
    p_phone_number_reference: ctx.expected.phoneNumberId,
    p_business_account_reference: ctx.expected.wabaId,
    p_evidence_digest: digestOf(preflight.evidence),
  }));
  if (!written.ok) return written;

  // MANDATORY post-write readback, from independent reads.
  const after = {
    account: await ctx.db.readAccount(ctx.expected.phoneNumberId),
    policy: await ctx.db.readPolicy(),
    mappings: await ctx.db.readMappings(),
    canaryRows: await ctx.db.readCanaryDestinations(),
  };
  const proof = proveReadinessPosture(after);
  if (!proof.ok) return proof;

  // The nonce is consumed ONLY now — after the readback proved the intended state.
  await ctx.attestationIo.consume(attestation.attestation_sha256);
  return { ok: true, stage: "ARM_READINESS", observed: sanitizeObserved(after), posture: proof.posture };
}

/** Stage 2: arm the canary. */
export async function runArmCanary(ctx) {
  const gathered = await preflightForWrite(ctx, "ARM_CANARY");
  if (!gathered.ok) return gathered;
  const { preflight, attestation } = gathered;

  const plan = planCanaryArm({
    policy: preflight.observedRaw.policy,
    account: preflight.observedRaw.account,
    mappings: preflight.observedRaw.mappings,
    canaryRows: preflight.observedRaw.canaryRows,
    evidence: preflight.evidence,
    expected: ctx.expected,
    templateKeys: ctx.templateKeys,
    destinationHash: ctx.destinationHash,
    nowMs: ctx.now,
  });
  if (!plan.ok) return plan;
  if (ctx.templateKeys.length !== 1) {
    return { ok: false, reason: ActivationFailure.TEMPLATE_SELECTION_MISSING, detail: "exactly one key per canary arm" };
  }

  const written = await invokeOnce(() => ctx.db.rpcArmCanary({
    p_phone_number_reference: ctx.expected.phoneNumberId,
    p_business_account_reference: ctx.expected.wabaId,
    p_template_key: ctx.templateKeys[0],
    p_destination_hash: ctx.destinationHash,
    p_expires_at: plan.plan.canary.expires_at,
    p_plan_digest: planFingerprint(plan.plan),
  }));
  if (!written.ok) return written;

  const after = {
    account: await ctx.db.readAccount(ctx.expected.phoneNumberId),
    policy: await ctx.db.readPolicy(),
    mappings: await ctx.db.readMappings(),
    canaryRows: await ctx.db.readCanaryDestinations(),
  };
  const proof = proveCanaryPosture(after, {
    templateKey: ctx.templateKeys[0], destinationHash: ctx.destinationHash, expected: ctx.expected,
  });
  if (!proof.ok) return proof;

  await ctx.attestationIo.consume(attestation.attestation_sha256);
  return { ok: true, stage: "ARM_CANARY", observed: sanitizeObserved(after) };
}

/**
 * The emergency close path. Requires ONLY staging identity and the DB credential: no
 * Meta token, no canary destination, no index proof and no attestation. It must succeed
 * even when Meta is unreachable.
 */
export async function runDisable(ctx) {
  const written = await invokeOnce(() => ctx.db.rpcDisable());
  if (!written.ok) return written;

  const after = {
    account: await ctx.db.readAccount(ctx.expected.phoneNumberId),
    policy: await ctx.db.readPolicy(),
    mappings: await ctx.db.readMappings(),
    canaryRows: await ctx.db.readCanaryDestinations(),
  };

  if (after.policy?.activation_status !== "disabled" || after.policy?.outbound_enabled !== false
      || after.mappings.some((m) => m.is_active) || after.canaryRows.some((r) => r.is_active)) {
    return { ok: false, reason: ActivationFailure.READBACK_MISMATCH, detail: "a sending gate is still open" };
  }
  // Proven through the FROZEN gate, not by reading the columns we just wrote.
  const failsClosed = proveDisabledIsFailClosed({
    account: after.account ?? { provider_key: PROVIDER_KEY, channel: CHANNEL },
    expected: ctx.expected,
    destinationHash: ctx.destinationHash ?? "0".repeat(64),
    nowMs: ctx.now,
  });
  if (!failsClosed) {
    return { ok: false, reason: ActivationFailure.READBACK_MISMATCH, detail: "frozen gate still permits outbound" };
  }
  return { ok: true, stage: "DISABLE", observed: sanitizeObserved(after) };
}

/** Fresh preflight + exact attestation comparison, run immediately before every open. */
async function preflightForWrite(ctx, stage) {
  const loaded = await ctx.attestationIo.load();
  if (!loaded.ok) return loaded;

  const preflight = await runPreflight({
    db: ctx.db, meta: ctx.meta, health: ctx.health, indexProof: ctx.indexProof,
    target: ctx.target, templateKeys: ctx.templateKeys, expected: ctx.expected, now: ctx.now,
  });
  if (!preflight.ok) return preflight;
  preflight.expected = ctx.expected;
  preflight.branchHead = ctx.branchHead ?? null;

  const plan = stage === "ARM_READINESS"
    ? planReadinessArm({
        policy: preflight.observedRaw.policy, account: preflight.observedRaw.account,
        evidence: preflight.evidence, expected: ctx.expected })
    : planCanaryArm({
        policy: preflight.observedRaw.policy, account: preflight.observedRaw.account,
        mappings: preflight.observedRaw.mappings, canaryRows: preflight.observedRaw.canaryRows,
        evidence: preflight.evidence, expected: ctx.expected, templateKeys: ctx.templateKeys,
        destinationHash: ctx.destinationHash, nowMs: ctx.now });
  if (!plan.ok) return plan;

  const verified = verifyAttestation(loaded.parsed, {
    now: () => ctx.now,
    projectRef: ctx.target.projectRef,
    stage,
    planHash: planFingerprint(plan.plan),
    consumedHashes: await ctx.attestationIo.consumed(),
  });
  if (!verified.ok) return verified;

  // DRIFT FENCE. Every digest the attestation pinned is recomputed from the FRESH
  // preflight and compared exactly. A database or remote change between approval and
  // execution refuses the write rather than proceeding on stale truth.
  const fresh = buildAttestationBody({
    stage, target: ctx.target, templateKeys: ctx.templateKeys,
    destinationHash: ctx.destinationHash, preflight, planHash: planFingerprint(plan.plan),
    now: loaded.parsed.issued_at_ms, nonce: loaded.parsed.nonce,
    ttlMs: loaded.parsed.expires_at_ms - loaded.parsed.issued_at_ms,
  });
  for (const field of [
    "policy_observed_digest", "mapping_observed_digest", "remote_template_digest",
    "readiness_evidence_digest", "health_verdict_digest", "index_proof_hash",
    "canary_destination_hash", "account_identity_digest", "plan_sha256",
  ]) {
    if (fresh[field] !== loaded.parsed[field]) {
      return { ok: false, reason: ActivationFailure.ATTESTATION_MISMATCH, detail: field };
    }
  }

  return { ok: true, preflight, attestation: loaded.parsed, plan };
}

function proveReadinessPosture(after) {
  const posture = after.policy;
  if (!posture) return { ok: false, reason: ActivationFailure.READBACK_MISMATCH, detail: "no policy row" };
  if (posture.activation_status !== "readiness_only" || posture.outbound_enabled !== false) {
    return { ok: false, reason: ActivationFailure.READBACK_MISMATCH, detail: "posture is not readiness_only/non-sending" };
  }
  if (after.mappings.filter((m) => m.is_active).length !== 0) {
    return { ok: false, reason: ActivationFailure.READBACK_MISMATCH, detail: "a mapping is active after stage 1" };
  }
  if (after.canaryRows.filter((r) => r.is_active).length !== 0) {
    return { ok: false, reason: ActivationFailure.READBACK_MISMATCH, detail: "a canary destination is active after stage 1" };
  }
  return { ok: true, posture };
}

function proveCanaryPosture(after, { templateKey, destinationHash, expected }) {
  const p = after.policy;
  if (!p || p.activation_status !== "canary" || p.outbound_enabled !== true) {
    return { ok: false, reason: ActivationFailure.READBACK_MISMATCH, detail: "posture is not canary/outbound" };
  }
  const active = after.mappings.filter((m) => m.is_active).map((m) => m.template_key);
  if (active.length !== 1 || active[0] !== templateKey) {
    return { ok: false, reason: ActivationFailure.READBACK_MISMATCH, detail: "active mapping set is not exactly the selected key" };
  }
  const activeCanary = after.canaryRows.filter((r) => r.is_active);
  if (activeCanary.length !== 1 || activeCanary[0].destination_hash !== destinationHash) {
    return { ok: false, reason: ActivationFailure.READBACK_MISMATCH, detail: "active canary set is not exactly the selected hash" };
  }
  const a = after.account;
  if (!a || a.phone_number_reference !== expected.phoneNumberId
      || a.business_account_reference !== expected.wabaId
      || a.readiness_status !== "provider_ready") {
    return { ok: false, reason: ActivationFailure.READBACK_MISMATCH, detail: "account identity or readiness changed" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The dispatcher — exactly one mode per invocation
// ---------------------------------------------------------------------------

export async function runOperator(ctx) {
  const mode = ctx.mode;
  const need = MODE_REQUIREMENTS[mode];
  if (!need) return { ok: false, reason: ActivationFailure.MODE_MISSING, detail: String(mode) };

  if (mode === "DRY_RUN") {
    return {
      ok: true, stage: "DRY_RUN", offline: true,
      plan: { modes: Object.keys(MODE_REQUIREMENTS), rpcs: RPC_NAMES, requirements: need },
    };
  }
  if (mode === "PREFLIGHT_READONLY") {
    const preflight = await runPreflight({
      db: ctx.db, meta: ctx.meta, health: ctx.health, indexProof: ctx.indexProof,
      target: ctx.target, templateKeys: ctx.templateKeys, expected: ctx.expected, now: ctx.now,
    });
    if (!preflight.ok) return preflight;
    preflight.expected = ctx.expected;
    preflight.branchHead = ctx.branchHead ?? null;
    const plan = ctx.stageForAttestation === "ARM_CANARY"
      ? planCanaryArm({
          policy: preflight.observedRaw.policy, account: preflight.observedRaw.account,
          mappings: preflight.observedRaw.mappings, canaryRows: preflight.observedRaw.canaryRows,
          evidence: preflight.evidence, expected: ctx.expected, templateKeys: ctx.templateKeys,
          destinationHash: ctx.destinationHash, nowMs: ctx.now })
      : planReadinessArm({
          policy: preflight.observedRaw.policy, account: preflight.observedRaw.account,
          evidence: preflight.evidence, expected: ctx.expected });
    if (!plan.ok) return plan;
    const attestation = buildAttestationBody({
      stage: ctx.stageForAttestation ?? "ARM_READINESS",
      target: ctx.target, templateKeys: ctx.templateKeys, destinationHash: ctx.destinationHash,
      preflight, planHash: planFingerprint(plan.plan), now: ctx.now,
      nonce: ctx.nonce, ttlMs: ctx.attestationTtlMs,
    });
    await ctx.attestationIo.write(attestation);
    return { ok: true, stage: "PREFLIGHT_READONLY", observed: preflight.observed,
      readiness: preflight.readiness.ok, attestationWritten: true };
  }
  if (mode === "ARM_READINESS") return runArmReadiness(ctx);
  if (mode === "ARM_CANARY") return runArmCanary(ctx);
  if (mode === "DISABLE") return runDisable(ctx);
  return { ok: false, reason: ActivationFailure.MODE_MISSING, detail: mode };
}

export { CANARY_DESTINATION_ENV, CANARY_WINDOW_MS, resolveActivationTarget, resolveTemplateSelection };
