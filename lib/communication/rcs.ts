// ============================================================================
// QuickFurno — lib/communication/rcs.ts   (Phase 5F-A)
//
// PURE readiness contracts for a FUTURE RCS integration. Phase 5F-A creates NO RCS
// provider adapter, makes NO Google API call, stores NO service-account JSON, and
// sends NO RCS message. This module only encodes the vocabulary and readiness model
// so a later phase (5F-E) has a stable foundation.
//
// PLANNED FIRST USE CASE: PROMOTIONAL (future campaigns). RCS is deliberately NOT
// an authentication channel — see `lib/identity/authTransport.ts`, whose transport
// vocabulary is whatsapp/sms only, and the DB CHECK that forbids RCS in any
// authentication transport policy.
// ============================================================================

/**
 * RCS use cases, provider-agnostic. QuickFurno's planned FIRST use case is
 * `promotional`; `otp` is listed for completeness only and is NOT how QuickFurno
 * intends to use RCS (authentication stays on WhatsApp/SMS).
 */
export const RcsUseCase = {
  OTP: "otp",
  TRANSACTIONAL: "transactional",
  PROMOTIONAL: "promotional",
  MULTI_USE: "multi_use",
} as const;

export type RcsUseCaseValue = (typeof RcsUseCase)[keyof typeof RcsUseCase];

export const KNOWN_RCS_USE_CASES: readonly RcsUseCaseValue[] = Object.freeze(Object.values(RcsUseCase));

/** QuickFurno's planned first RCS use case. Documented target only — not wired. */
export const QUICKFURNO_PLANNED_FIRST_RCS_USE_CASE: RcsUseCaseValue = RcsUseCase.PROMOTIONAL;

export function isRcsUseCase(value: unknown): value is RcsUseCaseValue {
  return typeof value === "string" && (KNOWN_RCS_USE_CASES as string[]).includes(value);
}

/**
 * Agent-level readiness for a future RCS integration. Non-secret state only — no
 * Google service-account material is ever represented here.
 */
export const RcsAgentReadiness = {
  NOT_STARTED: "not_started",
  ACCOUNT_PENDING: "account_pending",
  AGENT_CREATED: "agent_created",
  BRAND_VERIFICATION_PENDING: "brand_verification_pending",
  LAUNCH_REVIEW_PENDING: "launch_review_pending",
  CARRIER_ROLLOUT_PENDING: "carrier_rollout_pending",
  LAUNCHED: "launched",
  SUSPENDED: "suspended",
} as const;

export type RcsAgentReadinessValue = (typeof RcsAgentReadiness)[keyof typeof RcsAgentReadiness];

export const KNOWN_RCS_AGENT_READINESS: readonly RcsAgentReadinessValue[] =
  Object.freeze(Object.values(RcsAgentReadiness));

export function isRcsAgentReadiness(value: unknown): value is RcsAgentReadinessValue {
  return typeof value === "string" && (KNOWN_RCS_AGENT_READINESS as string[]).includes(value);
}

/**
 * Per-destination RCS capability status (mirrors
 * communication_channel_capabilities.capability_status). A future reachability
 * cache keyed on a destination HASH — never a plaintext MSISDN.
 */
export const RcsCapabilityStatus = {
  UNKNOWN: "unknown",
  REACHABLE: "reachable",
  NOT_REACHABLE: "not_reachable",
  STALE: "stale",
  ERROR: "error",
} as const;

export type RcsCapabilityStatusValue = (typeof RcsCapabilityStatus)[keyof typeof RcsCapabilityStatus];

export const KNOWN_RCS_CAPABILITY_STATUSES: readonly RcsCapabilityStatusValue[] =
  Object.freeze(Object.values(RcsCapabilityStatus));

export function isRcsCapabilityStatus(value: unknown): value is RcsCapabilityStatusValue {
  return typeof value === "string" && (KNOWN_RCS_CAPABILITY_STATUSES as string[]).includes(value);
}

/**
 * A pure readiness snapshot. Deliberately carries NO credential, NO plaintext
 * MSISDN, and NO live provider handle — Phase 5F-A models readiness only.
 */
export interface RcsAgentReadinessSnapshot {
  readonly agentReadiness: RcsAgentReadinessValue;
  readonly plannedUseCase: RcsUseCaseValue;
  /** True only when the agent is genuinely launched AND carrier rollout covers it. */
  readonly isLaunched: boolean;
}

/** Phase 5F-A is never RCS-active. Encoded so a mutation that flips it is caught. */
export function isRcsActive(_snapshot?: RcsAgentReadinessSnapshot): boolean {
  return false;
}
