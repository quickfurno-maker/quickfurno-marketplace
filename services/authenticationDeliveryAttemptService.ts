// ============================================================================
// QuickFurno — services/authenticationDeliveryAttemptService.ts  (Phase 5F-C1, server-only)
//
// A THIN, service-role wrapper over the two atomic attempt RPCs. It normalizes the
// database result into a typed outcome and does nothing else.
//
// It takes NO OTP and NO plaintext phone: a destination is referenced only by its
// non-reversible `destination_hash`, and an authentication action only by its derived
// 64-character SHA-256 identity — never a raw webhook id, challenge id, or request body.
// It calls no provider, mutates no policy, and does NOT duplicate the fallback decision
// — `decideAuthenticationFallback` must have already allowed the fallback before a
// fallback claim is attempted. The RPC is the RACE-SAFETY boundary, not the business
// policy authority: it independently rechecks the structural properties, so a bug here
// cannot manufacture a second OTP delivery.
//
// Phase 5F-C1 does not send SMS. Claiming an attempt records intent, not delivery.
// ============================================================================

import { adminClient } from "../lib/supabase";
import { fail, ok, type Result } from "../lib/errors";
import type { AuthFlowValue, AuthOutcomeCertaintyValue } from "../lib/identity/authTransport";
import { isConsistentAttemptOutcome } from "../lib/communication/authenticationTransportDecision";
import {
  isAuthenticationActionId,
  type AuthenticationActionId,
} from "../lib/communication/authenticationActionIdentity";

const CLAIM_RPC = "qf_claim_auth_delivery_attempt";
const FINALIZE_RPC = "qf_finalize_auth_delivery_attempt";

// ----------------------------------------------------------------------------
// Result vocabulary
// ----------------------------------------------------------------------------
export const AuthAttemptClaimOutcome = {
  CLAIMED: "CLAIMED",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  PRIMARY_REQUIRED: "PRIMARY_REQUIRED",
  PRIMARY_NOT_DEFINITIVE: "PRIMARY_NOT_DEFINITIVE",
  UNKNOWN_OUTCOME_BLOCKED: "UNKNOWN_OUTCOME_BLOCKED",
  ACCEPTED_PRIMARY_BLOCKED: "ACCEPTED_PRIMARY_BLOCKED",
  LINEAGE_MISMATCH: "LINEAGE_MISMATCH",
  ATTEMPT_LIMIT_REACHED: "ATTEMPT_LIMIT_REACHED",
  WHATSAPP_VERIFY_FALLBACK_FORBIDDEN: "WHATSAPP_VERIFY_FALLBACK_FORBIDDEN",
  INVALID_REQUEST: "INVALID_REQUEST",
  DATABASE_ERROR: "DATABASE_ERROR",
} as const;

export type AuthAttemptClaimOutcomeValue =
  (typeof AuthAttemptClaimOutcome)[keyof typeof AuthAttemptClaimOutcome];

export const AuthAttemptFinalizeOutcome = {
  FINALIZED: "FINALIZED",
  NO_CHANGE: "NO_CHANGE",
  NOT_FOUND: "NOT_FOUND",
  CONTRADICTORY_STATE: "CONTRADICTORY_STATE",
  TERMINAL_ACCEPTED: "TERMINAL_ACCEPTED",
  TERMINAL_DEFINITIVE_FAILURE: "TERMINAL_DEFINITIVE_FAILURE",
  TERMINAL_OUTCOME_UNKNOWN: "TERMINAL_OUTCOME_UNKNOWN",
  LINEAGE_MISMATCH: "LINEAGE_MISMATCH",
  INVALID_REQUEST: "INVALID_REQUEST",
  DATABASE_ERROR: "DATABASE_ERROR",
} as const;

export type AuthAttemptFinalizeOutcomeValue =
  (typeof AuthAttemptFinalizeOutcome)[keyof typeof AuthAttemptFinalizeOutcome];

/** The RPC's lowercase outcome → the service's typed vocabulary. Unknown → DATABASE_ERROR. */
const CLAIM_OUTCOME_MAP: Readonly<Record<string, AuthAttemptClaimOutcomeValue>> = Object.freeze({
  claimed: AuthAttemptClaimOutcome.CLAIMED,
  already_exists: AuthAttemptClaimOutcome.ALREADY_EXISTS,
  primary_required: AuthAttemptClaimOutcome.PRIMARY_REQUIRED,
  primary_not_definitive: AuthAttemptClaimOutcome.PRIMARY_NOT_DEFINITIVE,
  unknown_outcome_blocked: AuthAttemptClaimOutcome.UNKNOWN_OUTCOME_BLOCKED,
  accepted_primary_blocked: AuthAttemptClaimOutcome.ACCEPTED_PRIMARY_BLOCKED,
  lineage_mismatch: AuthAttemptClaimOutcome.LINEAGE_MISMATCH,
  attempt_limit_reached: AuthAttemptClaimOutcome.ATTEMPT_LIMIT_REACHED,
  whatsapp_verify_fallback_forbidden: AuthAttemptClaimOutcome.WHATSAPP_VERIFY_FALLBACK_FORBIDDEN,
  invalid_request: AuthAttemptClaimOutcome.INVALID_REQUEST,
});

const FINALIZE_OUTCOME_MAP: Readonly<Record<string, AuthAttemptFinalizeOutcomeValue>> = Object.freeze({
  finalized: AuthAttemptFinalizeOutcome.FINALIZED,
  no_change: AuthAttemptFinalizeOutcome.NO_CHANGE,
  not_found: AuthAttemptFinalizeOutcome.NOT_FOUND,
  contradictory_state: AuthAttemptFinalizeOutcome.CONTRADICTORY_STATE,
  terminal_accepted: AuthAttemptFinalizeOutcome.TERMINAL_ACCEPTED,
  terminal_definitive_failure: AuthAttemptFinalizeOutcome.TERMINAL_DEFINITIVE_FAILURE,
  terminal_outcome_unknown: AuthAttemptFinalizeOutcome.TERMINAL_OUTCOME_UNKNOWN,
  lineage_mismatch: AuthAttemptFinalizeOutcome.LINEAGE_MISMATCH,
  invalid_request: AuthAttemptFinalizeOutcome.INVALID_REQUEST,
});

export interface AuthAttemptClaimResult {
  readonly outcome: AuthAttemptClaimOutcomeValue;
  /** A sanitized structural detail from the RPC. Never a payload, phone, or OTP. */
  readonly detail: string | null;
  readonly attemptId: string | null;
  readonly attemptNumber: number | null;
  readonly channel: string | null;
  readonly fallbackFromAttemptId: string | null;
}

export interface AuthAttemptFinalizeResult {
  readonly outcome: AuthAttemptFinalizeOutcomeValue;
  readonly detail: string | null;
  readonly attemptId: string | null;
  readonly status: string | null;
  readonly outcomeCertainty: string | null;
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
}

function claimResult(row: Record<string, unknown> | null): AuthAttemptClaimResult {
  const outcome = typeof row?.outcome === "string" ? row.outcome : "";
  return {
    outcome: CLAIM_OUTCOME_MAP[outcome] ?? AuthAttemptClaimOutcome.DATABASE_ERROR,
    detail: typeof row?.detail === "string" ? row.detail : null,
    attemptId: typeof row?.attempt_id === "string" ? row.attempt_id : null,
    attemptNumber: typeof row?.attempt_number === "number" ? row.attempt_number : null,
    channel: typeof row?.channel === "string" ? row.channel : null,
    fallbackFromAttemptId:
      typeof row?.fallback_from_attempt_id === "string" ? row.fallback_from_attempt_id : null,
  };
}

const DATABASE_ERROR_RESULT: AuthAttemptClaimResult = Object.freeze({
  outcome: AuthAttemptClaimOutcome.DATABASE_ERROR,
  detail: null,
  attemptId: null,
  attemptNumber: null,
  channel: null,
  fallbackFromAttemptId: null,
});

// ----------------------------------------------------------------------------
// Claim
// ----------------------------------------------------------------------------
export interface PrimaryAttemptClaimInput {
  readonly authFlow: AuthFlowValue;
  /**
   * ONE authentication delivery action — the unit the two-attempt budget belongs to.
   *
   * It is the ALREADY-DERIVED 64-character lowercase SHA-256 action identity, produced
   * by `deriveAuthenticationActionId` in lib/communication/authenticationActionIdentity.ts.
   * The BRAND means a raw webhook id, a raw challenge id, an OTP, or a phone number
   * cannot be handed here by accident; the runtime guard below rejects one anyway.
   *
   * It is NOT the auth reference, and its authoritative source is NEVER browser-supplied:
   *   • `client_login_otp`       → the SIGNATURE-VERIFIED Supabase Standard Webhooks
   *                                `webhook-id` (already the correlation + idempotency
   *                                key on the communication path);
   *   • `vendor_whatsapp_verify` → the server-created `verification_challenges.id`;
   *   • `vendor_password_reset`  → the server-created `verification_challenges.id`.
   *
   * The raw source identifier is never sent here and never stored.
   */
  readonly authActionId: AuthenticationActionId;
  /**
   * WHO/WHAT is being authenticated. Long-lived: one Supabase Auth user performs many
   * login actions over time, and each is its own `authActionId`.
   */
  readonly authReferenceType: "verification_challenge" | "auth_user";
  readonly authReferenceId: string;
  /** sha256 of the canonical E.164 destination. NEVER a plaintext number. */
  readonly destinationHash: string;
  readonly providerKey: string;
  readonly challengeId?: string | null;
  readonly authUserId?: string | null;
  readonly decisionReason?: string | null;
}

export interface FallbackAttemptClaimInput extends PrimaryAttemptClaimInput {
  /** The reason code the decision engine returned when it ALLOWED this fallback. */
  readonly decisionReason: string;
}

const INVALID_ACTION_ID_RESULT: AuthAttemptClaimResult = Object.freeze({
  outcome: AuthAttemptClaimOutcome.INVALID_REQUEST,
  detail: "invalid_auth_action_id",
  attemptId: null,
  attemptNumber: null,
  channel: null,
  fallbackFromAttemptId: null,
});

async function callClaim(
  attemptNumber: 1 | 2,
  channel: "whatsapp" | "sms",
  input: PrimaryAttemptClaimInput
): Promise<Result<AuthAttemptClaimResult>> {
  // FAIL CLOSED before the database. A raw OTP (`483920`), a bare MSISDN
  // (`919876543210`), an E.164 number, a raw webhook id, or a mis-cased digest is not an
  // action identity, and no ledger row may be attempted for one.
  if (!isAuthenticationActionId(input.authActionId)) {
    return ok(INVALID_ACTION_ID_RESULT);
  }
  try {
    const { data, error } = await adminClient().rpc(CLAIM_RPC, {
      p_auth_flow: input.authFlow,
      p_auth_action_id: input.authActionId,
      p_auth_reference_type: input.authReferenceType,
      p_auth_reference_id: input.authReferenceId,
      p_destination_hash: input.destinationHash,
      p_attempt_number: attemptNumber,
      p_channel: channel,
      p_provider_key: input.providerKey,
      p_challenge_id: input.challengeId ?? null,
      p_auth_user_id: input.authUserId ?? null,
      p_decision_reason: input.decisionReason ?? null,
    });
    if (error) return ok(DATABASE_ERROR_RESULT);
    const row = firstRow<Record<string, unknown>>(data);
    if (!row) return ok(DATABASE_ERROR_RESULT);
    return ok(claimResult(row));
  } catch (e) {
    return fail(e);
  }
}

/**
 * Claim attempt 1 — the WhatsApp primary, scoped to ONE authentication action.
 * Idempotent for an identical replay of the same action; a replay that reuses the
 * action id under a different flow, reference, or destination hash fails closed. A
 * DIFFERENT action id for the same auth user legally starts a new attempt 1.
 */
export async function claimPrimaryAttempt(
  input: PrimaryAttemptClaimInput
): Promise<Result<AuthAttemptClaimResult>> {
  return callClaim(1, "whatsapp", input);
}

/**
 * Claim attempt 2 — the SMS fallback for THIS authentication action. The caller MUST
 * have obtained an `allowed` decision from `decideAuthenticationFallback` first; the
 * RPC re-checks the action lineage (flow, action id, reference, destination hash), the
 * primary's proven definitive failure, the possession-flow ban, and the per-action
 * attempt ceiling under an action-scoped advisory lock, so a race can never produce two
 * fallbacks and no action can ever fall back from another action's primary.
 */
export async function claimFallbackAttempt(
  input: FallbackAttemptClaimInput
): Promise<Result<AuthAttemptClaimResult>> {
  return callClaim(2, "sms", input);
}

// ----------------------------------------------------------------------------
// Finalize
// ----------------------------------------------------------------------------
export interface AttemptFinalizeInput {
  readonly attemptId: string;
  readonly status: string;
  readonly outcomeCertainty: AuthOutcomeCertaintyValue;
  /** Sanitized, identifier-shaped. Never a raw provider payload. */
  readonly failureCode?: string | null;
  readonly failureClassification?: string | null;
  readonly communicationMessageId?: string | null;
}

/**
 * Record one attempt's transport outcome. A contradictory (status, certainty) pair is
 * refused HERE before it reaches SQL, and again by the RPC and by a table CHECK.
 */
export async function finalizeAttempt(
  input: AttemptFinalizeInput
): Promise<Result<AuthAttemptFinalizeResult>> {
  if (!isConsistentAttemptOutcome(input.status, input.outcomeCertainty)) {
    return ok({
      outcome: AuthAttemptFinalizeOutcome.CONTRADICTORY_STATE,
      detail: "status_certainty_mismatch",
      attemptId: input.attemptId,
      status: null,
      outcomeCertainty: null,
    });
  }
  try {
    const { data, error } = await adminClient().rpc(FINALIZE_RPC, {
      p_attempt_id: input.attemptId,
      p_status: input.status,
      p_outcome_certainty: input.outcomeCertainty,
      p_failure_code: input.failureCode ?? null,
      p_failure_classification: input.failureClassification ?? null,
      p_communication_message_id: input.communicationMessageId ?? null,
    });
    if (error) {
      return ok({
        outcome: AuthAttemptFinalizeOutcome.DATABASE_ERROR,
        detail: null,
        attemptId: input.attemptId,
        status: null,
        outcomeCertainty: null,
      });
    }
    const row = firstRow<Record<string, unknown>>(data);
    if (!row) {
      return ok({
        outcome: AuthAttemptFinalizeOutcome.DATABASE_ERROR,
        detail: null,
        attemptId: input.attemptId,
        status: null,
        outcomeCertainty: null,
      });
    }
    const outcome = typeof row.outcome === "string" ? row.outcome : "";
    return ok({
      outcome: FINALIZE_OUTCOME_MAP[outcome] ?? AuthAttemptFinalizeOutcome.DATABASE_ERROR,
      detail: typeof row.detail === "string" ? row.detail : null,
      attemptId: typeof row.attempt_id === "string" ? row.attempt_id : null,
      status: typeof row.status === "string" ? row.status : null,
      outcomeCertainty: typeof row.outcome_certainty === "string" ? row.outcome_certainty : null,
    });
  } catch (e) {
    return fail(e);
  }
}

/** Never thrown away silently: an unmapped RPC outcome is a database error, not success. */
export function isClaimSuccessful(result: AuthAttemptClaimResult): boolean {
  return result.outcome === AuthAttemptClaimOutcome.CLAIMED;
}
