// ============================================================================
// QuickFurno — Identity Foundation: authentication transport contracts (5F-A)
//
// PURE contracts for a FUTURE AuthenticationTransportRouter (wired in Phase 5F-C).
// No Supabase client, no network, no OTP generation, no send path. Phase 5F-A does
// NOT perform any fallback send — this module only encodes the vocabulary and the
// fail-closed eligibility rule so a later phase cannot loosen it by accident.
//
// AUTHORITY BOUNDARIES (never merged):
//   • Supabase Auth owns client OTP + session; verification_challenges owns vendor
//     challenge state. Channel/provider selection is a TRANSPORT decision — it is
//     NEVER an authentication authority. One user action must not spawn competing
//     OTP authorities.
//   • SMS must NEVER automatically substitute for vendor_whatsapp_verify: that flow
//     proves possession of the WhatsApp destination, and SMS possession is a
//     different claim. Encoded here AND as a DB CHECK.
// ============================================================================

// ----------------------------------------------------------------------------
// Auth flows
// ----------------------------------------------------------------------------
export const AuthFlow = {
  CLIENT_LOGIN_OTP: "client_login_otp",
  VENDOR_WHATSAPP_VERIFY: "vendor_whatsapp_verify",
  VENDOR_PASSWORD_RESET: "vendor_password_reset",
} as const;

export type AuthFlowValue = (typeof AuthFlow)[keyof typeof AuthFlow];

export const KNOWN_AUTH_FLOWS: readonly AuthFlowValue[] = Object.freeze(Object.values(AuthFlow));

export function isAuthFlow(value: unknown): value is AuthFlowValue {
  return typeof value === "string" && (KNOWN_AUTH_FLOWS as string[]).includes(value);
}

/**
 * The flow that PROVES possession of the WhatsApp destination. It may never fall
 * back to another channel — SMS possession is not WhatsApp possession.
 */
export const WHATSAPP_POSSESSION_FLOW: AuthFlowValue = AuthFlow.VENDOR_WHATSAPP_VERIFY;

// ----------------------------------------------------------------------------
// Transport channels (authentication is whatsapp/sms ONLY — never RCS)
// ----------------------------------------------------------------------------
export const AuthTransportChannel = {
  WHATSAPP: "whatsapp",
  SMS: "sms",
} as const;

export type AuthTransportChannelValue =
  (typeof AuthTransportChannel)[keyof typeof AuthTransportChannel];

export const KNOWN_AUTH_TRANSPORT_CHANNELS: readonly AuthTransportChannelValue[] =
  Object.freeze(Object.values(AuthTransportChannel));

export function isAuthTransportChannel(value: unknown): value is AuthTransportChannelValue {
  return typeof value === "string" && (KNOWN_AUTH_TRANSPORT_CHANNELS as string[]).includes(value);
}

// ----------------------------------------------------------------------------
// Outcome certainty — the fail-closed heart of fallback eligibility
// ----------------------------------------------------------------------------
/**
 * How certain we are about a transport attempt's result.
 *   accepted           — the provider accepted the message (no fallback needed).
 *   definitive_failure — the request PROVABLY did not deliver (only this may ever
 *                        make an automatic fallback eligible).
 *   unknown_outcome    — a timeout, a delayed/absent webhook, or "the user hasn't
 *                        typed the OTP yet". NEVER fallback-eligible — a fallback
 *                        here risks a duplicate OTP.
 */
export const AuthOutcomeCertainty = {
  ACCEPTED: "accepted",
  DEFINITIVE_FAILURE: "definitive_failure",
  UNKNOWN_OUTCOME: "unknown_outcome",
} as const;

export type AuthOutcomeCertaintyValue =
  (typeof AuthOutcomeCertainty)[keyof typeof AuthOutcomeCertainty];

export const KNOWN_AUTH_OUTCOME_CERTAINTIES: readonly AuthOutcomeCertaintyValue[] =
  Object.freeze(Object.values(AuthOutcomeCertainty));

export function isAuthOutcomeCertainty(value: unknown): value is AuthOutcomeCertaintyValue {
  return typeof value === "string" && (KNOWN_AUTH_OUTCOME_CERTAINTIES as string[]).includes(value);
}

// ----------------------------------------------------------------------------
// Transport policy (mirrors authentication_transport_policies)
// ----------------------------------------------------------------------------
export interface AuthTransportPolicy {
  readonly authFlow: AuthFlowValue;
  readonly primaryChannel: AuthTransportChannelValue;
  readonly primaryProviderKey: string;
  readonly fallbackChannel: AuthTransportChannelValue | null;
  readonly fallbackProviderKey: string | null;
  readonly automaticFallbackEnabled: boolean;
  readonly userRequestedFallbackEnabled: boolean;
  /** Automatic fallback may only ever be considered after a definitive failure. */
  readonly hardFailureOnly: boolean;
  readonly isOperationallyEnabled: boolean;
}

/** A single planned transport step (one channel + provider for one attempt). */
export interface AuthTransportPlanStep {
  readonly channel: AuthTransportChannelValue;
  readonly providerKey: string;
  readonly attemptNumber: number;
}

/** The ordered plan: the primary step, plus an OPTIONAL declared fallback step. */
export interface AuthTransportPlan {
  readonly authFlow: AuthFlowValue;
  readonly primary: AuthTransportPlanStep;
  /** Present only when a fallback is DECLARED (still gated by eligibility below). */
  readonly fallback: AuthTransportPlanStep | null;
}

/** The result of one attempt, in the vocabulary the ledger records. */
export interface AuthTransportOutcome {
  readonly attemptNumber: number;
  readonly channel: AuthTransportChannelValue;
  readonly providerKey: string;
  readonly certainty: AuthOutcomeCertaintyValue;
  readonly failureClassification: string | null;
}

/** A recorded attempt (mirrors authentication_delivery_attempts, sans secrets). */
export interface AuthDeliveryAttempt {
  readonly attemptNumber: number;
  readonly channel: AuthTransportChannelValue;
  readonly providerKey: string;
  readonly communicationMessageId: string | null;
  readonly fallbackFromAttemptNumber: number | null;
  readonly certainty: AuthOutcomeCertaintyValue;
}

// ----------------------------------------------------------------------------
// Fallback eligibility — fail closed
// ----------------------------------------------------------------------------
export const FallbackIneligibleReason = {
  NOT_DEFINITIVE_FAILURE: "not_definitive_failure",
  POLICY_DISABLED: "policy_disabled",
  AUTOMATIC_FALLBACK_DISABLED: "automatic_fallback_disabled",
  NO_FALLBACK_CHANNEL: "no_fallback_channel",
  WHATSAPP_POSSESSION_FLOW: "whatsapp_possession_flow",
} as const;

export type FallbackIneligibleReasonValue =
  (typeof FallbackIneligibleReason)[keyof typeof FallbackIneligibleReason];

export type FallbackEligibility =
  | { readonly eligible: true; readonly channel: AuthTransportChannelValue; readonly providerKey: string }
  | { readonly eligible: false; readonly reason: FallbackIneligibleReasonValue };

/**
 * THE fail-closed automatic-fallback gate.
 *
 * An automatic fallback is eligible ONLY when ALL of the following hold:
 *   1. the flow is NOT the WhatsApp-possession flow (vendor_whatsapp_verify never
 *      falls back — SMS possession ≠ WhatsApp possession);
 *   2. the outcome certainty is EXACTLY `definitive_failure` — never
 *      `unknown_outcome` (timeout / delayed webhook / user-hasn't-typed) and never
 *      merely `!result.ok`;
 *   3. the policy is operationally enabled;
 *   4. automatic fallback is enabled on the policy;
 *   5. a fallback channel + provider are declared.
 *
 * `hardFailureOnly` is a belt-and-braces flag: even if it were somehow false, this
 * function still requires a definitive failure. Anything short of all conditions
 * returns a reason and NO fallback. Phase 5F-A never acts on an eligible result —
 * it only encodes the rule.
 */
export function evaluateAutomaticFallback(
  authFlow: AuthFlowValue,
  outcome: AuthTransportOutcome,
  policy: AuthTransportPolicy
): FallbackEligibility {
  if (authFlow === WHATSAPP_POSSESSION_FLOW || policy.authFlow === WHATSAPP_POSSESSION_FLOW) {
    return { eligible: false, reason: FallbackIneligibleReason.WHATSAPP_POSSESSION_FLOW };
  }
  // Only a proven, definitive failure may ever trigger an automatic fallback.
  if (outcome.certainty !== AuthOutcomeCertainty.DEFINITIVE_FAILURE) {
    return { eligible: false, reason: FallbackIneligibleReason.NOT_DEFINITIVE_FAILURE };
  }
  if (!policy.isOperationallyEnabled) {
    return { eligible: false, reason: FallbackIneligibleReason.POLICY_DISABLED };
  }
  if (!policy.automaticFallbackEnabled) {
    return { eligible: false, reason: FallbackIneligibleReason.AUTOMATIC_FALLBACK_DISABLED };
  }
  if (!policy.fallbackChannel || !policy.fallbackProviderKey) {
    return { eligible: false, reason: FallbackIneligibleReason.NO_FALLBACK_CHANNEL };
  }
  return { eligible: true, channel: policy.fallbackChannel, providerKey: policy.fallbackProviderKey };
}

/**
 * A convenience over `evaluateAutomaticFallback` — true ONLY when eligible. Kept
 * separate so a caller cannot accidentally treat a reasoned rejection as a boolean
 * "maybe".
 */
export function isAutomaticFallbackEligible(
  authFlow: AuthFlowValue,
  outcome: AuthTransportOutcome,
  policy: AuthTransportPolicy
): boolean {
  return evaluateAutomaticFallback(authFlow, outcome, policy).eligible;
}

/**
 * Build the declared transport plan from a policy. The plan carries a fallback
 * STEP only when the policy declares one AND the flow permits it (the
 * WhatsApp-possession flow never gets a fallback step). Declaring a plan is not the
 * same as being eligible to execute it — eligibility is re-checked per outcome.
 */
export function buildAuthTransportPlan(policy: AuthTransportPolicy): AuthTransportPlan {
  const primary: AuthTransportPlanStep = {
    channel: policy.primaryChannel,
    providerKey: policy.primaryProviderKey,
    attemptNumber: 1,
  };
  const canDeclareFallback =
    policy.authFlow !== WHATSAPP_POSSESSION_FLOW &&
    policy.fallbackChannel !== null &&
    policy.fallbackProviderKey !== null;
  return {
    authFlow: policy.authFlow,
    primary,
    fallback: canDeclareFallback
      ? { channel: policy.fallbackChannel as AuthTransportChannelValue, providerKey: policy.fallbackProviderKey as string, attemptNumber: 2 }
      : null,
  };
}
