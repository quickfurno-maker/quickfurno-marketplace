// ============================================================================
// QF-MVP-40 — controlled STAGING Meta WhatsApp canary ACTIVATION operator.
//
// WHY THIS EXISTS
//   A canary send needs four durable states, and before this operator NONE of them
//   had a mutation authority anywhere in the repository:
//     1. a runtime policy at activation_status='canary' with outbound_enabled=true;
//     2. a provider account at ALL SIX production-ready values;
//     3. an ACTIVE, unexpired canary destination HASH;
//     4. the canary template's mapping at is_active=true.
//   This is QF-MVP-40.3's own "runtime enablement; canary control". It is the FIRST
//   such authority, not a second operator path: the runtime, admin and mapping
//   services are read-only, the only provider-table write in application code is the
//   health-status update after a real health check, and the QF-MVP-40.12 seed states
//   outright that it never activates a mapping, an account or a policy.
//
// GATES OPEN ONE AT A TIME, AND EVIDENCE DECIDES — NEVER AN ASSERTION
//   `--arm-readiness` opens ONLY the non-sending gates and then writes account status
//   fields strictly from REAL Meta GET evidence and a REAL health check. It cannot
//   reach a send-capable posture: outbound stays false and activation stays
//   `readiness_only`. `--arm-canary` is a separate invocation with its own
//   attestation, and it refuses unless readiness is already fully proven.
//
// SAFETY SHAPE (identical discipline to the QF-MVP-40.12 seed)
//   default              OFFLINE DRY RUN — no credential, no network, no database.
//   --preflight-readonly STAGING reads + Meta GET-only. ZERO writes.
//   --arm-readiness      stage 1 write. Requires a fresh single-use attestation.
//   --arm-canary         stage 2 write. Requires its own fresh attestation.
//   --disable            the §17 return to fail-closed. Always safe, idempotent, and
//                        deliberately needs NO attestation: closing a gate must never
//                        be harder than opening one.
//
// This operator issues NO Meta POST/PUT/PATCH/DELETE and contains no `/messages`
// endpoint, so it can never send a WhatsApp message. It runs no migration and no DDL.
// It never writes a plaintext destination, a token, an App Secret or a verify token.
// ============================================================================

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

// Reused rather than re-declared: a second copy of the staging fence is exactly how
// "staging only" stops meaning anything.
import {
  AUTHORIZED_STAGING_REF,
  ATTESTATION_TTL_MS,
  CHANNEL,
  FORBIDDEN_PROJECT_REFS,
  LANGUAGE,
  PROVIDER_KEY,
  SEED_SET,
  isInsideRepository,
  parseProjectRef,
} from "./seed-meta-staging-inactive-mappings.mjs";

// The REAL pure decision authorities. The operator never re-implements a gate.
import {
  REQUIRED_ACCOUNT_READINESS,
  SENDABLE_ACTIVATION_STATUSES,
  evaluateMetaOutboundGate,
} from "../../../lib/communication/providers/metaRuntimeGate.ts";
import { hashPhoneE164, normalizePhoneE164 } from "../../../lib/communication/phone.ts";

export const ActivationFailure = Object.freeze({
  MODE_MISSING: "MODE_MISSING",
  MODE_CONFLICT: "MODE_CONFLICT",
  UNKNOWN_FLAG: "UNKNOWN_FLAG",
  ENV_MISSING: "ENV_MISSING",
  STAGING_URL_MALFORMED: "STAGING_URL_MALFORMED",
  PROJECT_REF_NOT_AUTHORIZED: "PROJECT_REF_NOT_AUTHORIZED",
  PROJECT_REF_FORBIDDEN_PRODUCTION: "PROJECT_REF_FORBIDDEN_PRODUCTION",
  PROJECT_REF_FORBIDDEN_JARVIS: "PROJECT_REF_FORBIDDEN_JARVIS",
  GRAPH_API_VERSION_INVALID: "GRAPH_API_VERSION_INVALID",
  IDENTIFIER_MALFORMED: "IDENTIFIER_MALFORMED",
  CANARY_DESTINATION_MISSING: "CANARY_DESTINATION_MISSING",
  CANARY_DESTINATION_INVALID: "CANARY_DESTINATION_INVALID",
  TEMPLATE_SELECTION_MISSING: "TEMPLATE_SELECTION_MISSING",
  TEMPLATE_NOT_APPROVED_SET: "TEMPLATE_NOT_APPROVED_SET",
  TEMPLATE_EVIDENCE_BOUND: "TEMPLATE_EVIDENCE_BOUND",
  SCHEMA_MISSING: "SCHEMA_MISSING",
  ACCOUNT_MISSING: "ACCOUNT_MISSING",
  ACCOUNT_AMBIGUOUS: "ACCOUNT_AMBIGUOUS",
  ACCOUNT_IDENTITY_CONFLICT: "ACCOUNT_IDENTITY_CONFLICT",
  MAPPING_MISSING: "MAPPING_MISSING",
  MAPPING_NOT_APPROVED: "MAPPING_NOT_APPROVED",
  MAPPING_ALREADY_ACTIVE: "MAPPING_ALREADY_ACTIVE",
  UNRELATED_ACTIVE_MAPPING: "UNRELATED_ACTIVE_MAPPING",
  READINESS_NOT_PROVEN: "READINESS_NOT_PROVEN",
  READINESS_EVIDENCE_INSUFFICIENT: "READINESS_EVIDENCE_INSUFFICIENT",
  META_IDENTITY_MISMATCH: "META_IDENTITY_MISMATCH",
  META_PHONE_NOT_CONNECTED: "META_PHONE_NOT_CONNECTED",
  META_WEBHOOK_NOT_SUBSCRIBED: "META_WEBHOOK_NOT_SUBSCRIBED",
  META_GET_FAILED: "META_GET_FAILED",
  HEALTH_CHECK_NOT_HEALTHY: "HEALTH_CHECK_NOT_HEALTHY",
  ATTESTATION_MISSING: "ATTESTATION_MISSING",
  ATTESTATION_EXPIRED: "ATTESTATION_EXPIRED",
  ATTESTATION_MISMATCH: "ATTESTATION_MISMATCH",
  ATTESTATION_TAMPERED: "ATTESTATION_TAMPERED",
  ATTESTATION_ALREADY_CONSUMED: "ATTESTATION_ALREADY_CONSUMED",
  ATTESTATION_WRONG_STAGE: "ATTESTATION_WRONG_STAGE",
  WRITE_OUTCOME_UNCERTAIN: "WRITE_OUTCOME_UNCERTAIN",
  READBACK_MISMATCH: "READBACK_MISMATCH",
  SEND_CAPABLE_WITHOUT_EVIDENCE: "SEND_CAPABLE_WITHOUT_EVIDENCE",
  INDEX_PROOF_UNAVAILABLE: "INDEX_PROOF_UNAVAILABLE",
  // QF-MVP-40.13C — one effective provider identity, never two contradictory ones.
  PROVIDER_ENV_MISMATCH: "PROVIDER_ENV_MISMATCH",
  PROVIDER_ENV_MISSING: "PROVIDER_ENV_MISSING",
  PROVIDER_MODE_INVALID: "PROVIDER_MODE_INVALID",
  // QF-MVP-40.13C-R1 — CLI parity, emergency closure and the HEAD pin.
  ATTESTATION_TARGET_REQUIRED: "ATTESTATION_TARGET_REQUIRED",
  ATTESTATION_TARGET_INVALID: "ATTESTATION_TARGET_INVALID",
  ATTESTATION_TARGET_NOT_PERMITTED: "ATTESTATION_TARGET_NOT_PERMITTED",
  SOURCE_HEAD_UNPROVEN: "SOURCE_HEAD_UNPROVEN",
  SOURCE_HEAD_MISMATCH: "SOURCE_HEAD_MISMATCH",
});

/** An exact git commit SHA. Branch names are never the load-bearing pin. */
export const GIT_HEAD_RE = /^[0-9a-f]{40}$/;

/**
 * The exact reviewed source HEAD an opening attestation pins.
 *
 * QF-MVP-40.13C stored `branch_head` but never verified it, and the env pin was optional —
 * so a null or stale head could ride along without refusing a write. HEAD is now proven
 * from the repository itself; an optional env pin may only AGREE with it, never replace it.
 */
export function resolveSourceHead({ resolved, envPin }) {
  if (typeof resolved !== "string" || !GIT_HEAD_RE.test(resolved)) {
    return { ok: false, reason: ActivationFailure.SOURCE_HEAD_UNPROVEN };
  }
  if (envPin !== undefined && envPin !== null && envPin !== "") {
    if (!GIT_HEAD_RE.test(envPin)) {
      return { ok: false, reason: ActivationFailure.SOURCE_HEAD_UNPROVEN, detail: "env pin is not a 40-hex SHA" };
    }
    if (envPin !== resolved) {
      return { ok: false, reason: ActivationFailure.SOURCE_HEAD_MISMATCH, detail: "env pin disagrees with actual HEAD" };
    }
  }
  return { ok: true, head: resolved };
}

/** The env variable carrying the owner-controlled canary destination. */
export const CANARY_DESTINATION_ENV = "QF_META_CANARY_DESTINATION_E164";

/**
 * How long an armed canary destination stays usable. A canary that is forgotten must
 * close by itself: `evaluateCanaryGate` treats an expired row as not allowlisted, so
 * this bound is enforced by the frozen gate rather than by operator discipline.
 */
export const CANARY_WINDOW_MS = 2 * 60 * 60 * 1000;

/** The non-sending posture stage 1 may reach, and NOTHING beyond it. */
export const READINESS_POSTURE = Object.freeze({
  activation_status: "readiness_only",
  outbound_enabled: false,
  webhook_processing_enabled: true,
  health_check_enabled: true,
});

/** The canary posture stage 2 may reach. Still not `active`. */
export const CANARY_POSTURE = Object.freeze({
  activation_status: "canary",
  outbound_enabled: true,
  webhook_processing_enabled: true,
  health_check_enabled: true,
});

/** The fail-closed posture `--disable` always restores. */
export const DISABLED_POSTURE = Object.freeze({
  activation_status: "disabled",
  outbound_enabled: false,
  webhook_processing_enabled: false,
  health_check_enabled: false,
});

/** The account state that is NOT send-capable, used by `--disable`. */
export const NON_SEND_CAPABLE_ACCOUNT = Object.freeze({
  readiness_status: "disabled",
  configuration_status: "partial",
  webhook_status: "pending",
  health_status: "unknown",
});

/**
 * The three evidence-bound consent acknowledgements. They are authorised ONLY by the
 * one-shot enforcer bound to a verified inbound command, and are deliberately absent
 * from outboundConsentScope.ts. Activating one of them for a canary would manufacture
 * ordinary send authority for exactly the templates that must never have it.
 */
export const EVIDENCE_BOUND_KEYS = Object.freeze(
  SEED_SET.filter((s) => s.classification === "EVIDENCE_BOUND_ACK").map((s) => s.key),
);

/** The five ordinary business keys a canary may legitimately activate. */
export const CANARY_ELIGIBLE_KEYS = Object.freeze(
  SEED_SET.filter((s) => s.classification === "ORDINARY_BUSINESS").map((s) => s.key),
);

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

export const ACTIVATION_MODES = Object.freeze([
  "DRY_RUN", "PREFLIGHT_READONLY", "ARM_READINESS", "ARM_CANARY", "DISABLE",
]);

const KNOWN_FLAGS = Object.freeze([
  "--preflight-readonly", "--arm-readiness", "--arm-canary", "--disable", "--templates",
  // QF-MVP-40.13C-R1. Which opening transition a preflight is approving. It was
  // previously computed from an undeclared `--stage=canary`, which resolveMode refused as
  // UNKNOWN_FLAG — so a real CLI preflight could only ever mint a READINESS attestation
  // and the documented `preflight -> --arm-canary` sequence was unreachable.
  "--attest-for",
]);

/** The closed attestation targets a preflight may approve. */
export const ATTESTATION_TARGETS = Object.freeze({
  readiness: "ARM_READINESS",
  canary: "ARM_CANARY",
});

/**
 * Exactly one mode per invocation. Two write modes together, or an unknown flag, is a
 * hard refusal — an operator that quietly picks a mode is how the wrong gate opens.
 */
export function resolveMode(argv = []) {
  for (const a of argv) {
    const name = a.split("=")[0];
    if (!KNOWN_FLAGS.includes(name)) return { ok: false, reason: ActivationFailure.UNKNOWN_FLAG, detail: name };
  }
  const has = (f) => argv.some((a) => a === f || a.startsWith(`${f}=`));
  const selected = ["--preflight-readonly", "--arm-readiness", "--arm-canary", "--disable"]
    .filter((f) => has(f));
  if (selected.length > 1) {
    return { ok: false, reason: ActivationFailure.MODE_CONFLICT, detail: selected.join(" ") };
  }
  if (has("--disable")) return { ok: true, mode: "DISABLE", network: false, writes: true, attested: false };
  if (has("--arm-canary")) return { ok: true, mode: "ARM_CANARY", network: true, writes: true, attested: true };
  if (has("--arm-readiness")) return { ok: true, mode: "ARM_READINESS", network: true, writes: true, attested: true };
  if (has("--preflight-readonly")) {
    return { ok: true, mode: "PREFLIGHT_READONLY", network: true, writes: false, attested: false };
  }
  return { ok: true, mode: "DRY_RUN", network: false, writes: false, attested: false };
}

/**
 * Which opening transition this preflight approves.
 *
 * REQUIRED for `--preflight-readonly` and REFUSED for every other mode. There is
 * deliberately no default: an attestation authorises one specific opening write, and
 * silently defaulting to readiness is how the canary sequence became unreachable. It is
 * also never inferred from current database state — an operator states what is being
 * approved.
 */
export function resolveAttestationTarget(argv = [], mode) {
  const raw = argv.find((a) => a === "--attest-for" || a.startsWith("--attest-for="));

  if (mode !== "PREFLIGHT_READONLY") {
    if (raw) {
      return { ok: false, reason: ActivationFailure.ATTESTATION_TARGET_NOT_PERMITTED, detail: mode };
    }
    return { ok: true, stage: null };
  }

  if (!raw || !raw.includes("=")) {
    return { ok: false, reason: ActivationFailure.ATTESTATION_TARGET_REQUIRED };
  }
  const value = raw.slice("--attest-for=".length).trim();
  const stage = ATTESTATION_TARGETS[value];
  if (!stage) {
    return { ok: false, reason: ActivationFailure.ATTESTATION_TARGET_INVALID, detail: value };
  }
  // Exactly one selector, so `--attest-for=readiness --attest-for=canary` cannot pass.
  if (argv.filter((a) => a.startsWith("--attest-for")).length !== 1) {
    return { ok: false, reason: ActivationFailure.ATTESTATION_TARGET_INVALID, detail: "more than one" };
  }
  return { ok: true, stage };
}

/**
 * The canary template selection. It is NEVER defaulted: an operator must name the exact
 * keys, they must belong to the approved eight, and an evidence-bound acknowledgement is
 * refused by its own distinct code so the refusal is legible.
 */
export function resolveTemplateSelection(argv = []) {
  const raw = argv.find((a) => a.startsWith("--templates="));
  if (!raw) return { ok: false, reason: ActivationFailure.TEMPLATE_SELECTION_MISSING };
  const keys = raw.slice("--templates=".length).split(",").map((s) => s.trim()).filter(Boolean);
  if (keys.length === 0) return { ok: false, reason: ActivationFailure.TEMPLATE_SELECTION_MISSING };
  for (const k of keys) {
    if (EVIDENCE_BOUND_KEYS.includes(k)) {
      return { ok: false, reason: ActivationFailure.TEMPLATE_EVIDENCE_BOUND, detail: k };
    }
    if (!CANARY_ELIGIBLE_KEYS.includes(k)) {
      return { ok: false, reason: ActivationFailure.TEMPLATE_NOT_APPROVED_SET, detail: k };
    }
  }
  const unique = [...new Set(keys)];
  return { ok: true, keys: unique.sort() };
}

// ---------------------------------------------------------------------------
// Environment identity fence — runs BEFORE any client or network call
// ---------------------------------------------------------------------------

/**
 * Never returns, prints or logs a secret or a plaintext destination — only presence
 * booleans, the non-secret project ref, and the destination HASH.
 */
/**
 * QF-MVP-40.13C-R1. `requireMetaIdentity` exists so EMERGENCY CLOSURE never depends on a
 * Meta credential. `--disable` needs the staging identity fence and the staging DB
 * credential and nothing else: it calls one RPC that closes gates and reads back. Making
 * it demand a Meta token would mean an expired token could keep a canary armed, which is
 * exactly backwards.
 *
 * The staging project-ref fence is NEVER optional and is applied identically in all modes.
 */
export function resolveActivationTarget(
  env = {},
  { requireCanaryDestination = true, requireMetaIdentity = true } = {},
) {
  const url = env.QF_STAGING_SUPABASE_URL;
  if (!url) return { ok: false, reason: ActivationFailure.ENV_MISSING, missing: "QF_STAGING_SUPABASE_URL" };
  const ref = parseProjectRef(url);
  if (!ref) return { ok: false, reason: ActivationFailure.STAGING_URL_MALFORMED };
  if (ref === FORBIDDEN_PROJECT_REFS.production) {
    return { ok: false, reason: ActivationFailure.PROJECT_REF_FORBIDDEN_PRODUCTION };
  }
  if (ref === FORBIDDEN_PROJECT_REFS.jarvis) {
    return { ok: false, reason: ActivationFailure.PROJECT_REF_FORBIDDEN_JARVIS };
  }
  if (ref !== AUTHORIZED_STAGING_REF) {
    return { ok: false, reason: ActivationFailure.PROJECT_REF_NOT_AUTHORIZED };
  }
  if (!env.QF_STAGING_SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, reason: ActivationFailure.ENV_MISSING, missing: "QF_STAGING_SUPABASE_SERVICE_ROLE_KEY" };
  }
  if (requireMetaIdentity) {
    for (const k of ["QF_META_ACCESS_TOKEN", "QF_META_WABA_ID", "QF_META_PHONE_NUMBER_ID",
                     "QF_META_GRAPH_API_VERSION"]) {
      if (!env[k]) return { ok: false, reason: ActivationFailure.ENV_MISSING, missing: k };
    }
    if (!/^v\d+\.\d+$/.test(env.QF_META_GRAPH_API_VERSION)) {
      return { ok: false, reason: ActivationFailure.GRAPH_API_VERSION_INVALID };
    }
    for (const k of ["QF_META_WABA_ID", "QF_META_PHONE_NUMBER_ID"]) {
      if (!/^\d{6,}$/.test(env[k])) return { ok: false, reason: ActivationFailure.IDENTIFIER_MALFORMED, field: k };
    }
  }

  let destinationHash = null;
  if (requireCanaryDestination) {
    const raw = env[CANARY_DESTINATION_ENV];
    if (!raw) {
      return { ok: false, reason: ActivationFailure.CANARY_DESTINATION_MISSING, missing: CANARY_DESTINATION_ENV };
    }
    const normalized = normalizePhoneE164(raw);
    if (!normalized.ok) {
      // The code is returned, never the value.
      return { ok: false, reason: ActivationFailure.CANARY_DESTINATION_INVALID, detail: normalized.code };
    }
    destinationHash = hashPhoneE164(raw);
  }

  return { ok: true, projectRef: ref, environment: "STAGING", destinationHash };
}

// ---------------------------------------------------------------------------
// Evidence -> account status. THE ONLY place a readiness value is decided.
// ---------------------------------------------------------------------------

/**
 * Meta GET evidence and a real health verdict in; account status fields out.
 *
 * It REFUSES to fabricate. Every one of the six required values must be justified by a
 * distinct piece of real evidence, and `readiness_status: provider_ready` is DERIVED
 * from the other five rather than asserted alongside them. Missing evidence yields a
 * refusal, never a default — an operator that guesses "verified" is how a canary sends
 * from an unverified account.
 */
export function deriveAccountReadinessFromEvidence(evidence) {
  const need = (cond, detail) => (cond ? null : { ok: false, reason: ActivationFailure.READINESS_EVIDENCE_INSUFFICIENT, detail });

  const problems = [
    need(evidence && typeof evidence === "object", "no evidence object"),
    need(evidence?.configurationComplete === true, "provider configuration is not complete"),
    need(evidence?.wabaIdMatches === true, "WABA identity was not proven equal to the configured id"),
    need(evidence?.phoneNumberIdMatches === true, "phone-number identity was not proven equal to the configured id"),
    need(evidence?.phoneConnected === true, "the phone number is not connected at Meta"),
    need(evidence?.businessVerified === true, "Meta has not confirmed business verification"),
    need(evidence?.webhookSubscribed === true, "the webhook subscription GET did not prove a subscription"),
    need(evidence?.healthStatus === "healthy", `health check returned "${evidence?.healthStatus ?? "nothing"}"`),
  ].filter(Boolean);

  if (problems.length > 0) return problems[0];

  return {
    ok: true,
    fields: {
      readiness_status: REQUIRED_ACCOUNT_READINESS.readiness_status,
      configuration_status: REQUIRED_ACCOUNT_READINESS.configuration_status,
      business_verification_status: REQUIRED_ACCOUNT_READINESS.business_verification_status,
      phone_number_status: REQUIRED_ACCOUNT_READINESS.phone_number_status,
      webhook_status: REQUIRED_ACCOUNT_READINESS.webhook_status,
      health_status: REQUIRED_ACCOUNT_READINESS.health_status,
    },
  };
}

/**
 * Independent last fence before any write: refuse a send-capable combination that the
 * evidence does not support, even if a caller asked for it. This is deliberately a
 * SECOND check over the same facts — `deriveAccountReadinessFromEvidence` builds the
 * fields, and this proves the built fields were earned.
 */
export function assertWriteIsEarned({ posture, accountFields, evidence }) {
  const sendable = SENDABLE_ACTIVATION_STATUSES.includes(posture?.activation_status)
    || posture?.outbound_enabled === true;
  if (!sendable) return { ok: true };
  const derived = deriveAccountReadinessFromEvidence(evidence);
  if (!derived.ok) {
    return { ok: false, reason: ActivationFailure.SEND_CAPABLE_WITHOUT_EVIDENCE, detail: derived.detail };
  }
  for (const [k, v] of Object.entries(derived.fields)) {
    if (accountFields?.[k] !== v) {
      return { ok: false, reason: ActivationFailure.SEND_CAPABLE_WITHOUT_EVIDENCE, detail: `${k} is not the earned value` };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Plans — pure, so the validator can drive every branch with fixtures
// ---------------------------------------------------------------------------

/** Stage 1: open ONLY the non-sending gates and write earned account fields. */
export function planReadinessArm({ policy, account, evidence, expected }) {
  if (!account) return { ok: false, reason: ActivationFailure.ACCOUNT_MISSING };
  if (account.phone_number_reference !== expected.phoneNumberId
      || account.business_account_reference !== expected.wabaId) {
    return { ok: false, reason: ActivationFailure.ACCOUNT_IDENTITY_CONFLICT };
  }
  const derived = deriveAccountReadinessFromEvidence(evidence);
  if (!derived.ok) return derived;

  const plan = {
    stage: "ARM_READINESS",
    policy: { ...READINESS_POSTURE },
    policyExists: Boolean(policy),
    account: derived.fields,
    canary: null,
    mappingsToActivate: [],
  };
  const earned = assertWriteIsEarned({ posture: plan.policy, accountFields: plan.account, evidence });
  if (!earned.ok) return earned;
  // Structural proof that stage 1 cannot send, independent of the posture constant.
  if (plan.policy.outbound_enabled !== false
      || SENDABLE_ACTIVATION_STATUSES.includes(plan.policy.activation_status)) {
    return { ok: false, reason: ActivationFailure.SEND_CAPABLE_WITHOUT_EVIDENCE, detail: "stage 1 must stay non-sending" };
  }
  return { ok: true, plan };
}

/** Stage 2: canary destination, exactly the named mappings, then the canary posture. */
export function planCanaryArm({
  policy, account, mappings, canaryRows, evidence, expected, templateKeys, destinationHash, nowMs,
}) {
  if (!account) return { ok: false, reason: ActivationFailure.ACCOUNT_MISSING };

  // Readiness must ALREADY be true in the durable row — stage 2 never re-derives it
  // from fresh evidence, because that would let one invocation both earn and spend it.
  for (const [k, v] of Object.entries(REQUIRED_ACCOUNT_READINESS)) {
    if (account[k] !== v) {
      return { ok: false, reason: ActivationFailure.READINESS_NOT_PROVEN, detail: `${k}=${account[k]}` };
    }
  }
  if (!policy) return { ok: false, reason: ActivationFailure.READINESS_NOT_PROVEN, detail: "no runtime policy row" };

  if (!Array.isArray(templateKeys) || templateKeys.length === 0) {
    return { ok: false, reason: ActivationFailure.TEMPLATE_SELECTION_MISSING };
  }

  const rows = Array.isArray(mappings) ? mappings : [];
  // Any active mapping outside the selection is a refusal: the canary surface must be
  // exactly what was reviewed, and an unrelated active row widens it silently.
  const strayActive = rows.filter((m) => m.is_active === true && !templateKeys.includes(m.template_key));
  if (strayActive.length > 0) {
    return { ok: false, reason: ActivationFailure.UNRELATED_ACTIVE_MAPPING, detail: strayActive.map((m) => m.template_key).join(",") };
  }

  const toActivate = [];
  for (const key of templateKeys) {
    const candidates = rows.filter((m) => m.template_key === key
      && m.channel === CHANNEL && m.provider_key === PROVIDER_KEY && m.language === LANGUAGE);
    if (candidates.length !== 1) {
      return { ok: false, reason: ActivationFailure.MAPPING_MISSING, detail: `${key} matched ${candidates.length} rows` };
    }
    const row = candidates[0];
    if (row.approval_status !== "approved") {
      return { ok: false, reason: ActivationFailure.MAPPING_NOT_APPROVED, detail: key };
    }
    const seed = SEED_SET.find((s) => s.key === key);
    if (!seed || row.provider_template_name !== seed.name) {
      return { ok: false, reason: ActivationFailure.MAPPING_MISSING, detail: `${key} provider name drift` };
    }
    if (row.is_active === true) {
      return { ok: false, reason: ActivationFailure.MAPPING_ALREADY_ACTIVE, detail: key };
    }
    toActivate.push({ template_key: key, id: row.id ?? null, provider_template_name: row.provider_template_name });
  }

  if (typeof destinationHash !== "string" || !/^[0-9a-f]{64}$/.test(destinationHash)) {
    return { ok: false, reason: ActivationFailure.CANARY_DESTINATION_INVALID, detail: "hash shape" };
  }
  const existing = (Array.isArray(canaryRows) ? canaryRows : [])
    .find((r) => r.destination_hash === destinationHash);

  const plan = {
    stage: "ARM_CANARY",
    policy: { ...CANARY_POSTURE },
    policyExists: true,
    account: null,
    canary: {
      destination_hash: destinationHash,
      is_active: true,
      expires_at: new Date(nowMs + CANARY_WINDOW_MS).toISOString(),
      existingRow: existing ? true : false,
    },
    mappingsToActivate: toActivate,
  };

  const earned = assertWriteIsEarned({ posture: plan.policy, accountFields: account, evidence });
  if (!earned.ok) return earned;

  // FINAL independent proof, through the FROZEN composed gate: with this plan applied,
  // the canary destination — and only it — would be permitted. A plan that cannot pass
  // the real gate is never written.
  const gate = evaluateMetaOutboundGate({
    policy: { provider_key: PROVIDER_KEY, channel: CHANNEL, ...plan.policy },
    account,
    canaryRows: [{ provider_key: PROVIDER_KEY, channel: CHANNEL, destination_hash: destinationHash,
      is_active: true, expires_at: plan.canary.expires_at }],
    destinationHash,
    expected,
    now: nowMs,
  });
  if (!gate.ok) return { ok: false, reason: ActivationFailure.READINESS_NOT_PROVEN, detail: gate.reason };

  const foreign = evaluateMetaOutboundGate({
    policy: { provider_key: PROVIDER_KEY, channel: CHANNEL, ...plan.policy },
    account,
    canaryRows: [{ provider_key: PROVIDER_KEY, channel: CHANNEL, destination_hash: destinationHash,
      is_active: true, expires_at: plan.canary.expires_at }],
    destinationHash: "f".repeat(64),
    expected,
    now: nowMs,
  });
  if (foreign.ok) {
    return { ok: false, reason: ActivationFailure.SEND_CAPABLE_WITHOUT_EVIDENCE, detail: "plan would permit a non-canary destination" };
  }

  return { ok: true, plan };
}

/**
 * Stage 3 (§17): the return to fail-closed.
 *
 * Deliberately unconditional and idempotent — it does not require a policy row, a
 * ready account, an attestation or a healthy provider. Closing a gate must never be
 * harder than opening one, and a half-armed staging environment must always be
 * recoverable in one command.
 */
export function planDisable({ policy, mappings, canaryRows }) {
  return {
    ok: true,
    plan: {
      stage: "DISABLE",
      policy: { ...DISABLED_POSTURE },
      policyExists: Boolean(policy),
      account: { ...NON_SEND_CAPABLE_ACCOUNT },
      canaryToDeactivate: (Array.isArray(canaryRows) ? canaryRows : [])
        .filter((r) => r.is_active === true)
        .map((r) => r.destination_hash),
      mappingsToDeactivate: (Array.isArray(mappings) ? mappings : [])
        .filter((m) => m.is_active === true)
        .map((m) => m.template_key),
    },
  };
}

/** The disabled result must fail the real gate for ANY destination. */
export function proveDisabledIsFailClosed({ account, expected, destinationHash, nowMs }) {
  const gate = evaluateMetaOutboundGate({
    policy: { provider_key: PROVIDER_KEY, channel: CHANNEL, ...DISABLED_POSTURE },
    account,
    canaryRows: [{ provider_key: PROVIDER_KEY, channel: CHANNEL,
      destination_hash: destinationHash, is_active: true, expires_at: null }],
    destinationHash,
    expected,
    now: nowMs,
  });
  return gate.ok === false;
}

// ---------------------------------------------------------------------------
// Attestation — single-use, short-lived, stage-bound, stored outside the repo
// ---------------------------------------------------------------------------

export const ATTESTATION_ARTIFACT = "QF-MVP-40-CANARY-ACTIVATION-ATTESTATION";

/** Deterministic digest of the body, so tampering is detectable without a secret. */
export function attestationDigest(body) {
  const ordered = JSON.stringify(body, Object.keys(body).sort());
  return createHash("sha256").update(ordered).digest("hex");
}

export function planFingerprint(plan) {
  return createHash("sha256").update(JSON.stringify(plan, Object.keys(plan).sort())).digest("hex");
}

/**
 * A stale, tampered, wrong-stage, foreign-project or already-consumed attestation must
 * never authorize a write. The stage is pinned, so a readiness attestation can never be
 * spent on a canary arm.
 */
export function verifyAttestation(parsed, { now, projectRef, stage, planHash, consumedHashes = [] }) {
  const bad = (reason, detail) => ({ ok: false, reason, detail });
  if (!parsed || typeof parsed !== "object") return bad(ActivationFailure.ATTESTATION_MISSING, "unreadable");
  if (parsed.artifact !== ATTESTATION_ARTIFACT) return bad(ActivationFailure.ATTESTATION_MISMATCH, "artifact");
  if (parsed.environment !== "STAGING") return bad(ActivationFailure.ATTESTATION_MISMATCH, "environment");
  if (parsed.project_ref !== projectRef) return bad(ActivationFailure.ATTESTATION_MISMATCH, "project_ref");
  if (parsed.stage !== stage) return bad(ActivationFailure.ATTESTATION_WRONG_STAGE, `${parsed.stage} != ${stage}`);

  const { attestation_sha256: claimed, ...body } = parsed;
  if (typeof claimed !== "string" || claimed !== attestationDigest(body)) {
    return bad(ActivationFailure.ATTESTATION_TAMPERED, "digest");
  }
  const issued = Number(parsed.issued_at_ms);
  const expires = Number(parsed.expires_at_ms);
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) {
    return bad(ActivationFailure.ATTESTATION_MISSING, "timestamps");
  }
  if (issued > now() + 60_000) return bad(ActivationFailure.ATTESTATION_TAMPERED, "future-dated");
  if (expires - issued > ATTESTATION_TTL_MS) return bad(ActivationFailure.ATTESTATION_EXPIRED, "ttl exceeds 15 minutes");
  if (expires <= now()) return bad(ActivationFailure.ATTESTATION_EXPIRED, "expired");
  if (parsed.plan_sha256 !== planHash) {
    return bad(ActivationFailure.ATTESTATION_MISMATCH, "the fresh plan differs from the approved plan");
  }
  if (consumedHashes.includes(claimed)) {
    return bad(ActivationFailure.ATTESTATION_ALREADY_CONSUMED, "single-use");
  }
  return { ok: true, digest: claimed };
}

/** The attestation must live OUTSIDE the repository, exactly as the 40.12 proof does. */
export function loadAttestationFile(path) {
  if (!path) return { ok: false, reason: ActivationFailure.ATTESTATION_MISSING, detail: "no path supplied" };
  if (isInsideRepository(path)) {
    return { ok: false, reason: ActivationFailure.ATTESTATION_MISSING, detail: "must live OUTSIDE the repository" };
  }
  try {
    return { ok: true, parsed: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { ok: false, reason: ActivationFailure.ATTESTATION_MISSING, detail: "unreadable or not valid JSON" };
  }
}

// ---------------------------------------------------------------------------
// Meta GET-only URL builders. There is deliberately no /messages builder here.
// ---------------------------------------------------------------------------

export const GRAPH_BASE = "https://graph.facebook.com";

export function buildPhoneNumberGetUrl({ graphApiVersion, phoneNumberId }) {
  return `${GRAPH_BASE}/${graphApiVersion}/${phoneNumberId}`
    + "?fields=id,verified_name,code_verification_status,quality_rating,platform_type";
}

export function buildWabaGetUrl({ graphApiVersion, wabaId }) {
  return `${GRAPH_BASE}/${graphApiVersion}/${wabaId}`
    + "?fields=id,name,account_review_status,business_verification_status";
}

export function buildSubscribedAppsGetUrl({ graphApiVersion, wabaId }) {
  return `${GRAPH_BASE}/${graphApiVersion}/${wabaId}/subscribed_apps`;
}

/**
 * Structural proof: this operator can never build a send endpoint.
 *
 * The needle is assembled from parts on purpose. Written as a regex literal, this
 * function's own source would contain the exact sequence it searches for, so a
 * whole-file scan would always match itself and the guard would be unfalsifiable.
 */
const SEND_ENDPOINT_NEEDLE = ["/", "messages"].join("");

export function operatorHasNoSendEndpoint(source) {
  return !String(source).includes(SEND_ENDPOINT_NEEDLE);
}

export default {
  ActivationFailure,
  resolveMode,
  resolveTemplateSelection,
  resolveActivationTarget,
  deriveAccountReadinessFromEvidence,
  assertWriteIsEarned,
  planReadinessArm,
  planCanaryArm,
  planDisable,
  proveDisabledIsFailClosed,
  verifyAttestation,
};

// ===========================================================================
// QF-MVP-40.13C — EXECUTABLE ENTRY POINT.
//
// Everything above is import-safe: importing this file constructs no client, opens no
// socket and reads no credential. The block below runs ONLY when this file is the
// process entry point, which is what keeps the validator able to import and drive the
// contract without any of it executing.
//
// The real adapters are built here and NOWHERE else, and only AFTER the staging identity
// fence has passed — so a wrong project ref is refused before a client exists.
// ===========================================================================
const isDirect = process.argv[1]
  && process.argv[1].endsWith("activate-meta-staging-canary.mjs");

if (isDirect) {
  const runtime = await import("./canaryActivationRuntime.mjs");

  // ALL CLI logic lives in runtime.runCli, which the offline tests call with fakes. This
  // block only supplies real dependencies — there is no second parser and no behaviour
  // here that a test cannot reach.
  const result = await runtime.runCli({
    argv: process.argv.slice(2),
    env: process.env,
    headResolver: resolveGitHead,
    adapterFactory: buildRealAdapters,
    attestationIoFactory: ({ mode }) => buildAttestationIo(mode),
    indexProofFactory: buildIndexProofAdapter,
    now: () => Date.now(),
    nonce: randomNonce(),
    log: (line) => console.log(line),
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error(`REFUSED: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`);
    process.exit(3);
  }
  process.exit(0);
}

/**
 * Real adapters, constructed here and NOWHERE else — and only after runCli has already
 * proven the staging identity fence, so a wrong project ref never reaches a client.
 */
async function buildRealAdapters({ env, need }) {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(
    env.QF_STAGING_SUPABASE_URL,
    env.QF_STAGING_SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const runtime = await import("./canaryActivationRuntime.mjs");
  const expected = {
    phoneNumberId: env.QF_META_PHONE_NUMBER_ID ?? null,
    wabaId: env.QF_META_WABA_ID ?? null,
  };
  const adapters = { db: runtime.createSupabaseDbAdapter(client), expected, meta: null, health: null };
  if (need.meta) {
    const { FetchHttpTransport } = await import("../../../lib/communication/httpTransport.ts");
    const shared = {
      transport: new FetchHttpTransport(),
      token: env.QF_META_ACCESS_TOKEN,
      graphApiVersion: env.QF_META_GRAPH_API_VERSION,
      wabaId: expected.wabaId,
      phoneNumberId: expected.phoneNumberId,
    };
    adapters.meta = runtime.createMetaGetAdapter(shared);
    adapters.health = runtime.createHealthAdapter(shared);
  }
  return adapters;
}

/**
 * The exact current commit SHA, read from the repository itself rather than trusted from a
 * typed environment value. A detached HEAD is perfectly valid — the commit is the pin, a
 * branch name never is.
 */
async function resolveGitHead() {
  const { execFileSync } = await import("node:child_process");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return GIT_HEAD_RE.test(head) ? head : null;
}

/** The standard CSPRNG. A nonce is not a secret, but replay identity should not be seeded
 *  from a pid and a clock. */
function randomNonce() {
  return randomBytes(32).toString("hex");
}

/** The 40.12 external index proof, consumed through its existing file contract. */
async function buildIndexProofAdapter() {
  const { verifyIndexProof } = await import("./seed-meta-staging-inactive-mappings.mjs");
  const path = process.env.QF_STAGING_INDEX_PROOF_PATH;
  return {
    async verify({ projectRef, now }) {
      if (!path) {
        return { ok: false, reason: ActivationFailure.INDEX_PROOF_UNAVAILABLE, detail: "QF_STAGING_INDEX_PROOF_PATH is not set" };
      }
      if (isInsideRepository(path)) {
        return { ok: false, reason: ActivationFailure.INDEX_PROOF_UNAVAILABLE, detail: "the proof must live OUTSIDE the repository" };
      }
      let parsed;
      try { parsed = JSON.parse(readFileSync(path, "utf8")); }
      catch { return { ok: false, reason: ActivationFailure.INDEX_PROOF_UNAVAILABLE, detail: "unreadable or not valid JSON" }; }
      const verified = verifyIndexProof(parsed, { now: () => now, projectRef });
      if (!verified.ok) return verified;
      return { ok: true, hash: parsed.proof_sha256 };
    },
  };
}

/**
 * Attestation file IO. The file and the consumed-nonce ledger both live OUTSIDE the
 * repository, exactly as the 40.12 attestation does.
 */
async function buildAttestationIo(mode) {
  const { writeFileSync, existsSync, mkdirSync, appendFileSync, readFileSync: rf } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const home = process.env.USERPROFILE || process.env.HOME || ".";
  const dir = join(home, ".qf-mvp-40-canary");
  const attestationPath = process.env.QF_ACTIVATION_ATTESTATION_PATH || join(dir, "attestation.json");
  const ledgerPath = join(dir, "consumed-nonces.log");
  return {
    async write(body) {
      if (isInsideRepository(attestationPath)) {
        throw new Error(`${ActivationFailure.ATTESTATION_MISSING}: must live OUTSIDE the repository`);
      }
      mkdirSync(dirname(attestationPath), { recursive: true });
      writeFileSync(attestationPath, JSON.stringify(body, null, 2), "utf8");
      console.log(`Attestation    : written outside the repository (${mode})`);
    },
    async load() {
      return loadAttestationFile(attestationPath);
    },
    async consumed() {
      if (!existsSync(ledgerPath)) return [];
      return rf(ledgerPath, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    },
    async consume(digest) {
      mkdirSync(dirname(ledgerPath), { recursive: true });
      appendFileSync(ledgerPath, `${digest}\n`, "utf8");
    },
  };
}
