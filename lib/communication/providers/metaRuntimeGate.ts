// ============================================================================
// QuickFurno — lib/communication/providers/metaRuntimeGate.ts  (Phase 5F-B)
//
// PURE, fail-closed decision functions for whether a Meta WhatsApp Cloud outbound
// delivery may proceed. These encode INFRASTRUCTURE gating only — they never
// authorize a communication (Phase 4 Policy Engine remains the business authority).
// A provider being technically "provider_ready" is NOT activation, and none of
// these functions ever mutates a row, creates an account, or advances readiness.
//
// Composed order (all must pass): runtime activation → provider-account readiness →
// canary allowlist (only in canary activation). Any failure returns a reason and
// NO permission. No network, no DB, no clock except an injected `now`.
// ============================================================================

export type ProviderActivationStatus =
  | "disabled" | "readiness_only" | "shadow" | "canary" | "active" | "paused";

/** Runtime policy row projection (no secret columns exist on this table). */
export interface ProviderRuntimePolicyRow {
  readonly provider_key: string;
  readonly channel: string;
  readonly activation_status: ProviderActivationStatus;
  readonly outbound_enabled: boolean;
  readonly webhook_processing_enabled: boolean;
  readonly health_check_enabled: boolean;
}

/** Provider-account readiness projection (non-secret references + statuses only). */
export interface ProviderAccountRow {
  readonly provider_key: string;
  readonly channel: string;
  readonly phone_number_reference: string | null;
  readonly business_account_reference: string | null;
  readonly readiness_status: string;
  readonly configuration_status: string;
  readonly business_verification_status: string;
  readonly phone_number_status: string;
  readonly webhook_status: string;
  readonly health_status: string;
}

/** Canary allowlist row projection (destination HASH only — never a plaintext number). */
export interface CanaryDestinationRow {
  readonly provider_key: string;
  readonly channel: string;
  readonly destination_hash: string;
  readonly is_active: boolean;
  readonly expires_at: string | null;
}

export const OutboundGateReason = {
  RUNTIME_POLICY_MISSING: "runtime_policy_missing",
  OUTBOUND_DISABLED: "outbound_disabled",
  ACTIVATION_NOT_SENDABLE: "activation_not_sendable",
  PROVIDER_ACCOUNT_MISSING: "provider_account_missing",
  PROVIDER_ACCOUNT_REFERENCE_MISMATCH: "provider_account_reference_mismatch",
  PROVIDER_ACCOUNT_NOT_READY: "provider_account_not_ready",
  CANARY_DESTINATION_NOT_ALLOWLISTED: "canary_destination_not_allowlisted",
} as const;

export type OutboundGateReasonValue = (typeof OutboundGateReason)[keyof typeof OutboundGateReason];

export type GateResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: OutboundGateReasonValue };

/** The activation states in which outbound delivery is even conceptually permitted. */
export const SENDABLE_ACTIVATION_STATUSES: readonly ProviderActivationStatus[] =
  Object.freeze(["canary", "active"]);

/**
 * Gate 1 — runtime activation. Outbound is permitted only when the policy exists,
 * `outbound_enabled` is true, AND activation is `canary` or `active`. Every other
 * state (disabled/readiness_only/shadow/paused) fails closed. `provider_ready` on
 * the account is irrelevant here — activation is a separate, explicit decision.
 */
export function evaluateRuntimeActivation(
  policy: ProviderRuntimePolicyRow | null | undefined
): GateResult<ProviderActivationStatus> {
  if (!policy) return { ok: false, reason: OutboundGateReason.RUNTIME_POLICY_MISSING };
  if (policy.outbound_enabled !== true) return { ok: false, reason: OutboundGateReason.OUTBOUND_DISABLED };
  if (!SENDABLE_ACTIVATION_STATUSES.includes(policy.activation_status)) {
    return { ok: false, reason: OutboundGateReason.ACTIVATION_NOT_SENDABLE };
  }
  return { ok: true, value: policy.activation_status };
}

/** The production-ready values every provider-account status field must hold. */
export const REQUIRED_ACCOUNT_READINESS = Object.freeze({
  readiness_status: "provider_ready",
  configuration_status: "complete",
  business_verification_status: "verified",
  phone_number_status: "connected",
  webhook_status: "verified",
  health_status: "healthy",
});

/**
 * Gate 2 — provider-account readiness. The account must exist, its non-secret
 * references must EXACTLY match the configured phone-number id + WABA id, and every
 * readiness status field must be at its production-ready value. `provider_ready`
 * alone is never sufficient — all fields are required.
 */
export function evaluateProviderAccountReadiness(
  account: ProviderAccountRow | null | undefined,
  expected: { readonly phoneNumberId: string; readonly wabaId: string }
): GateResult<true> {
  if (!account) return { ok: false, reason: OutboundGateReason.PROVIDER_ACCOUNT_MISSING };
  if (
    account.phone_number_reference !== expected.phoneNumberId ||
    account.business_account_reference !== expected.wabaId
  ) {
    return { ok: false, reason: OutboundGateReason.PROVIDER_ACCOUNT_REFERENCE_MISMATCH };
  }
  if (
    account.readiness_status !== REQUIRED_ACCOUNT_READINESS.readiness_status ||
    account.configuration_status !== REQUIRED_ACCOUNT_READINESS.configuration_status ||
    account.business_verification_status !== REQUIRED_ACCOUNT_READINESS.business_verification_status ||
    account.phone_number_status !== REQUIRED_ACCOUNT_READINESS.phone_number_status ||
    account.webhook_status !== REQUIRED_ACCOUNT_READINESS.webhook_status ||
    account.health_status !== REQUIRED_ACCOUNT_READINESS.health_status
  ) {
    return { ok: false, reason: OutboundGateReason.PROVIDER_ACCOUNT_NOT_READY };
  }
  return { ok: true, value: true };
}

function isCanaryRowUsable(row: CanaryDestinationRow, nowMs: number): boolean {
  if (row.is_active !== true) return false;
  if (row.expires_at === null) return true;
  const exp = Date.parse(row.expires_at);
  return Number.isFinite(exp) && exp > nowMs;
}

/**
 * Gate 3 — canary allowlist. In `active` activation the allowlist is NOT required.
 * In `canary` activation the destination HASH must have an ACTIVE, UNEXPIRED row.
 * Compares hash-to-hash — a plaintext number never enters this function.
 */
export function evaluateCanaryGate(
  activation: ProviderActivationStatus,
  destinationHash: string,
  canaryRows: readonly CanaryDestinationRow[],
  now: Date | string | number = Date.now()
): GateResult<true> {
  if (activation === "active") return { ok: true, value: true };
  if (activation !== "canary") {
    // Defence in depth: only canary/active reach here via evaluateRuntimeActivation.
    return { ok: false, reason: OutboundGateReason.ACTIVATION_NOT_SENDABLE };
  }
  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  const allowed = canaryRows.some(
    (r) => r.destination_hash === destinationHash && isCanaryRowUsable(r, nowMs)
  );
  return allowed
    ? { ok: true, value: true }
    : { ok: false, reason: OutboundGateReason.CANARY_DESTINATION_NOT_ALLOWLISTED };
}

/**
 * The composed Meta outbound gate. Runs activation → account readiness → canary in
 * order and fails closed on the first failure. Pure: the caller supplies already-
 * fetched rows, so this never touches the DB or the network.
 */
export function evaluateMetaOutboundGate(input: {
  readonly policy: ProviderRuntimePolicyRow | null | undefined;
  readonly account: ProviderAccountRow | null | undefined;
  readonly canaryRows: readonly CanaryDestinationRow[];
  readonly destinationHash: string;
  readonly expected: { readonly phoneNumberId: string; readonly wabaId: string };
  readonly now?: Date | string | number;
}): GateResult<{ readonly activation: ProviderActivationStatus }> {
  const activation = evaluateRuntimeActivation(input.policy);
  if (!activation.ok) return activation;

  const readiness = evaluateProviderAccountReadiness(input.account, input.expected);
  if (!readiness.ok) return readiness;

  const canary = evaluateCanaryGate(
    activation.value,
    input.destinationHash,
    input.canaryRows,
    input.now ?? Date.now()
  );
  if (!canary.ok) return canary;

  return { ok: true, value: { activation: activation.value } };
}

/**
 * Provider identity fence: a persisted message may only be dispatched by the
 * provider that owns it. Exact, case-sensitive equality of non-empty keys — never a
 * reroute, never a silent rewrite of message.provider.
 */
export function providerIdentityMatches(
  messageProvider: string | null | undefined,
  activeProviderKey: string
): boolean {
  return (
    typeof messageProvider === "string" &&
    messageProvider.length > 0 &&
    messageProvider === activeProviderKey
  );
}
