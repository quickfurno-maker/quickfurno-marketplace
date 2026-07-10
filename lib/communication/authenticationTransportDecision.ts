// ============================================================================
// QuickFurno — lib/communication/authenticationTransportDecision.ts  (Phase 5F-C1)
//
// The PURE authentication transport fallback decision engine.
//
// No database, no environment, no provider, no network, no clock. Every input is
// passed in explicitly, so this module is exhaustively testable and cannot be made
// permissive by a misconfigured runtime.
//
// AUTHORITY BOUNDARIES (never merged):
//   • Supabase Auth owns the client login OTP + session. `verification_challenges`
//     owns vendor_whatsapp_verify and vendor_password_reset challenge state.
//   • Phase 4 Policy Engine owns business communication authorization.
//   • CommunicationService owns the message ledger and the dispatch boundary.
//   • n8n is never an OTP, password-reset, session, identity, or fallback authority.
//   • Channel selection is TRANSPORT policy. Provider selection is INFRASTRUCTURE
//     policy. Neither is ever an authentication authority.
//
// THE MODEL (Phase 5F-C maximum transport tree):
//   attempt 1 — WhatsApp primary
//   attempt 2 — SMS fallback, OPTIONAL, and only after a PROVEN definitive failure
//               that an explicit, active, eligible failure rule permits.
//
//   accepted        → stop. No fallback.
//   unknown_outcome → park. NEVER a fallback (a fallback here risks delivering a
//                     second copy of an OTP that may already have arrived).
//   definitive_failure → evaluate. Still default-deny.
//
// A fallback NEVER generates a second OTP: the existing authority's OTP is reused
// from request memory. No OTP value ever enters this module.
//
// GROUPING — the attempt budget belongs to ONE AUTHENTICATION ACTION:
//   AUTH REFERENCE (auth_reference_type + auth_reference_id) = who/what is being
//     authenticated. A Supabase Auth user legitimately performs many OTP logins.
//   AUTH ACTION (authActionId) = this specific OTP issuance/delivery operation, carried
//     as the deterministic 64-char SHA-256 identity derived by
//     lib/communication/authenticationActionIdentity.ts. A new login is a NEW action and
//     begins a fresh (attempt 1 [, attempt 2]) sequence; a replay of one verified action
//     derives the same identity and is idempotent.
//   The evaluator never sees a history aggregated across actions, and a primary from
//   one action can never anchor another action's fallback. It only ever COMPARES these
//   identities — it never derives, parses, or trusts them as authorization.
//
// Phase 5F-C1 does NOT send SMS. This is decision authority only.
// ============================================================================

import {
  AuthOutcomeCertainty,
  AuthTransportChannel,
  WHATSAPP_POSSESSION_FLOW,
  type AuthFlowValue,
  type AuthOutcomeCertaintyValue,
  type AuthTransportChannelValue,
} from "../identity/authTransport";

/** Phase 5F-C allows at most TWO transport attempts per authentication action. */
export const MAX_AUTH_TRANSPORT_ATTEMPTS = 2;
export const PRIMARY_ATTEMPT_NUMBER = 1;
export const FALLBACK_ATTEMPT_NUMBER = 2;

/** The only channel a Phase 5F-C primary attempt may use. */
export const AUTH_PRIMARY_CHANNEL = AuthTransportChannel.WHATSAPP;
/** The only channel a Phase 5F-C fallback attempt may use. RCS is never an auth channel. */
export const AUTH_FALLBACK_CHANNEL = AuthTransportChannel.SMS;

/** Both channels this phase can ever use. RCS is deliberately absent. */
export const AUTH_TRANSPORT_CHANNELS_IN_USE: readonly AuthTransportChannelValue[] = Object.freeze([
  AUTH_PRIMARY_CHANNEL,
  AUTH_FALLBACK_CHANNEL,
]);

// ----------------------------------------------------------------------------
// Request mode — automatic and user-requested are DIFFERENT authorities
// ----------------------------------------------------------------------------
export const AuthFallbackRequestMode = {
  AUTOMATIC: "automatic",
  USER_REQUESTED: "user_requested",
} as const;

export type AuthFallbackRequestModeValue =
  (typeof AuthFallbackRequestMode)[keyof typeof AuthFallbackRequestMode];

/** The fallback_policy_status values in which each mode may even be considered. */
export const AUTOMATIC_FALLBACK_POLICY_STATUSES: readonly string[] = Object.freeze(["automatic_ready"]);
export const USER_REQUESTED_FALLBACK_POLICY_STATUSES: readonly string[] =
  Object.freeze(["manual_only", "automatic_ready"]);

// ----------------------------------------------------------------------------
// Decision vocabulary — stable, ledger-safe, identifier-shaped reason codes
// ----------------------------------------------------------------------------
export const AUTH_FALLBACK_ALLOWED = "ALLOWED" as const;

export const AuthFallbackBlockReason = {
  /** No transport policy row exists for this auth flow. */
  POLICY_MISSING: "POLICY_MISSING",
  /** The policy row governs a different auth flow than the one being evaluated. */
  POLICY_FLOW_MISMATCH: "POLICY_FLOW_MISMATCH",
  /** The policy exists but is not operationally enabled. */
  POLICY_DISABLED: "POLICY_DISABLED",
  /** The policy declares no fallback channel at all. */
  FALLBACK_NOT_DECLARED: "FALLBACK_NOT_DECLARED",
  /** `fallback_policy_status` does not permit this request mode. */
  FALLBACK_POLICY_DISABLED: "FALLBACK_POLICY_DISABLED",
  AUTOMATIC_FALLBACK_DISABLED: "AUTOMATIC_FALLBACK_DISABLED",
  USER_REQUESTED_FALLBACK_DISABLED: "USER_REQUESTED_FALLBACK_DISABLED",
  /** `hard_failure_only` is the belt-and-braces automatic guard; it must be true. */
  HARD_FAILURE_ONLY_DISABLED: "HARD_FAILURE_ONLY_DISABLED",
  /** The primary channel is not whatsapp — Phase 5F-C models no other primary. */
  WRONG_PRIMARY_CHANNEL: "WRONG_PRIMARY_CHANNEL",
  /** The declared fallback channel is not sms (an RCS fallback is never legal). */
  WRONG_FALLBACK_CHANNEL: "WRONG_FALLBACK_CHANNEL",
  FALLBACK_PROVIDER_MISSING: "FALLBACK_PROVIDER_MISSING",
  /** The primary was accepted. Nothing to fall back from. */
  PRIMARY_ACCEPTED: "PRIMARY_ACCEPTED",
  /** The primary outcome could be neither proven nor disproven. NEVER fallback. */
  PRIMARY_OUTCOME_UNKNOWN: "PRIMARY_OUTCOME_UNKNOWN",
  /** The primary is still in flight, or its status contradicts its certainty. */
  PRIMARY_NOT_DEFINITIVE: "PRIMARY_NOT_DEFINITIVE",
  /** No explicit, active rule makes THIS failure code fallback-eligible (default deny). */
  FAILURE_NOT_FALLBACK_ELIGIBLE: "FAILURE_NOT_FALLBACK_ELIGIBLE",
  /** vendor_whatsapp_verify proves possession of the WhatsApp destination. SMS cannot. */
  WHATSAPP_VERIFICATION_FALLBACK_FORBIDDEN: "WHATSAPP_VERIFICATION_FALLBACK_FORBIDDEN",
  ATTEMPT_LIMIT_REACHED: "ATTEMPT_LIMIT_REACHED",
  /** The primary attempt's shape (number/channel/flow) cannot anchor a fallback. */
  ATTEMPT_LINEAGE_INVALID: "ATTEMPT_LINEAGE_INVALID",
  DESTINATION_HASH_MISMATCH: "DESTINATION_HASH_MISMATCH",
  AUTH_REFERENCE_MISMATCH: "AUTH_REFERENCE_MISMATCH",
  /** The primary attempt belongs to a DIFFERENT authentication action. */
  AUTH_ACTION_MISMATCH: "AUTH_ACTION_MISMATCH",
  /** The supplied attempt history is not scoped to this authentication action. */
  ATTEMPT_HISTORY_SCOPE_INVALID: "ATTEMPT_HISTORY_SCOPE_INVALID",
} as const;

export type AuthFallbackBlockReasonValue =
  (typeof AuthFallbackBlockReason)[keyof typeof AuthFallbackBlockReason];

export type AuthenticationFallbackDecision =
  | {
      readonly allowed: true;
      readonly reason: typeof AUTH_FALLBACK_ALLOWED;
      readonly channel: typeof AUTH_FALLBACK_CHANNEL;
      readonly providerKey: string;
      readonly attemptNumber: typeof FALLBACK_ATTEMPT_NUMBER;
    }
  | { readonly allowed: false; readonly reason: AuthFallbackBlockReasonValue };

// ----------------------------------------------------------------------------
// Inputs — plain projections, never a live row handle, never a secret
// ----------------------------------------------------------------------------

/** Projection of `authentication_transport_policies` (no secret columns exist). */
export interface AuthTransportPolicyRow {
  readonly auth_flow: string;
  readonly primary_channel: string;
  readonly primary_provider_key: string;
  readonly fallback_channel: string | null;
  readonly fallback_provider_key: string | null;
  readonly automatic_fallback_enabled: boolean;
  readonly user_requested_fallback_enabled: boolean;
  readonly fallback_policy_status: string;
  readonly hard_failure_only: boolean;
  readonly is_operationally_enabled: boolean;
}

/**
 * The primary attempt, as recorded. Carries a destination HASH, never a number.
 *
 * `authActionId` is the derived 64-char SHA-256 identity of ONE authentication delivery
 * action. It is NOT the auth reference: the reference says WHO is being authenticated
 * and lives for the life of the account, while a new login OTP is a NEW action that
 * legally begins a fresh attempt sequence.
 */
export interface PrimaryAttemptSummary {
  readonly authFlow: string;
  readonly authActionId: string;
  readonly authReferenceType: string;
  readonly authReferenceId: string;
  readonly destinationHash: string;
  readonly attemptNumber: number;
  readonly channel: string;
  readonly providerKey: string;
  readonly status: string;
  readonly outcomeCertainty: string;
  readonly failureCode: string | null;
}

/** What the caller says this decision is about. Compared against the primary. */
export interface FallbackRequestReference {
  readonly authActionId: string;
  readonly authReferenceType: string;
  readonly authReferenceId: string;
  readonly destinationHash: string;
}

/**
 * Attempt counts for ONE authentication action. `authActionId` is carried so the
 * evaluator can PROVE the history it was handed is action-scoped: aggregating every
 * attempt an auth user ever made would exhaust the two-attempt budget after that
 * user's first login, forever.
 */
export interface AttemptHistorySummary {
  readonly authActionId: string;
  readonly totalAttempts: number;
  readonly hasFallbackAttempt: boolean;
}

// ----------------------------------------------------------------------------
// Failure eligibility — DEFAULT DENY
// ----------------------------------------------------------------------------
// A `definitive_failure` is NOT automatically fallback-eligible. Many definitive
// failures are LOCAL configuration problems (missing template mapping, disabled
// runtime gate, unready provider account, missing config, render failure, provider
// identity mismatch). Falling back to SMS would hide the misconfiguration behind a
// second channel and a second bill, forever. Eligibility must be declared, per
// failure code, by an explicit ACTIVE row an operator wrote on purpose.
// ----------------------------------------------------------------------------

export const FailureRuleUnresolvedReason = {
  NO_RULE: "no_rule",
  INACTIVE_RULE: "inactive_rule",
  AMBIGUOUS_RULES: "ambiguous_rules",
} as const;

export type FailureRuleUnresolvedReasonValue =
  (typeof FailureRuleUnresolvedReason)[keyof typeof FailureRuleUnresolvedReason];

/** The scope a resolved rule was matched at. Exact auth-flow beats provider-wide. */
export const FailureRuleScope = {
  AUTH_FLOW: "auth_flow",
  PROVIDER_WIDE: "provider_wide",
} as const;

export type FailureRuleScopeValue = (typeof FailureRuleScope)[keyof typeof FailureRuleScope];

/** Projection of `authentication_transport_failure_rules` (no secret columns exist). */
export interface AuthTransportFailureRuleRow {
  readonly id?: string | null;
  readonly auth_flow: string | null;
  readonly primary_channel: string;
  readonly primary_provider_key: string;
  readonly failure_code: string;
  readonly failure_classification: string;
  readonly automatic_fallback_eligible: boolean;
  readonly user_requested_fallback_eligible: boolean;
  readonly is_active: boolean;
}

export type FailureEligibility =
  | {
      readonly resolved: true;
      readonly ruleId: string | null;
      readonly scope: FailureRuleScopeValue;
      readonly automaticFallbackEligible: boolean;
      readonly userRequestedFallbackEligible: boolean;
    }
  | { readonly resolved: false; readonly reason: FailureRuleUnresolvedReasonValue };

export interface FailureRuleCriteria {
  readonly authFlow: string;
  readonly primaryChannel: string;
  readonly primaryProviderKey: string;
  readonly failureCode: string;
}

function matchesProviderAndCode(row: AuthTransportFailureRuleRow, c: FailureRuleCriteria): boolean {
  return (
    row.primary_channel === c.primaryChannel &&
    row.primary_provider_key === c.primaryProviderKey &&
    row.failure_code === c.failureCode
  );
}

/**
 * PURE, DEFAULT-DENY resolution of the single failure rule that governs this
 * (auth flow, primary provider, failure code).
 *
 * Precedence: an EXACT `auth_flow` rule beats a provider-wide (`auth_flow is null`)
 * rule. Within a precedence tier, more than one ACTIVE candidate is AMBIGUOUS and
 * fails closed — an operator must never be able to make eligibility depend on row
 * order. No candidate at all, or only inactive candidates, is a denial.
 *
 * The caller supplies the candidate rows; this function never touches the database.
 */
export function resolveFailureRule(
  rows: readonly AuthTransportFailureRuleRow[],
  criteria: FailureRuleCriteria
): FailureEligibility {
  const candidates = rows.filter((r) => matchesProviderAndCode(r, criteria));
  if (candidates.length === 0) {
    return { resolved: false, reason: FailureRuleUnresolvedReason.NO_RULE };
  }

  const tiers: readonly { scope: FailureRuleScopeValue; rows: AuthTransportFailureRuleRow[] }[] = [
    { scope: FailureRuleScope.AUTH_FLOW, rows: candidates.filter((r) => r.auth_flow === criteria.authFlow) },
    { scope: FailureRuleScope.PROVIDER_WIDE, rows: candidates.filter((r) => r.auth_flow === null) },
  ];

  for (const tier of tiers) {
    if (tier.rows.length === 0) continue;
    const active = tier.rows.filter((r) => r.is_active === true);
    if (active.length === 0) {
      // A rule exists at this tier but nobody activated it. Deny; do not fall through
      // to a broader tier — a deliberately de-activated specific rule must not be
      // silently replaced by a permissive provider-wide one.
      return { resolved: false, reason: FailureRuleUnresolvedReason.INACTIVE_RULE };
    }
    if (active.length > 1) {
      return { resolved: false, reason: FailureRuleUnresolvedReason.AMBIGUOUS_RULES };
    }
    const rule = active[0];
    return {
      resolved: true,
      ruleId: rule.id ?? null,
      scope: tier.scope,
      automaticFallbackEligible: rule.automatic_fallback_eligible === true,
      userRequestedFallbackEligible: rule.user_requested_fallback_eligible === true,
    };
  }

  // Candidates existed but matched neither tier (e.g. a rule for another auth flow).
  return { resolved: false, reason: FailureRuleUnresolvedReason.NO_RULE };
}

// ----------------------------------------------------------------------------
// The decision engine
// ----------------------------------------------------------------------------
export interface FallbackDecisionInput {
  readonly authFlow: AuthFlowValue;
  readonly requestMode: AuthFallbackRequestModeValue;
  readonly policy: AuthTransportPolicyRow | null;
  readonly primaryAttempt: PrimaryAttemptSummary | null;
  readonly failureEligibility: FailureEligibility;
  readonly attemptHistory: AttemptHistorySummary;
  readonly request: FallbackRequestReference;
}

function blocked(reason: AuthFallbackBlockReasonValue): AuthenticationFallbackDecision {
  return { allowed: false, reason };
}

/**
 * The statuses that are CONSISTENT with a `definitive_failure` certainty. A row whose
 * certainty says "provably not delivered" while its status says "sent" is
 * contradictory and can never anchor a fallback.
 */
const DEFINITIVE_FAILURE_STATUSES: readonly string[] = Object.freeze(["failed", "cancelled"]);

/**
 * THE fail-closed authentication fallback gate.
 *
 * Evaluated in a fixed order, structural facts first, so the returned reason is the
 * most fundamental one and no later check can be reached by an illegal state:
 *
 *   1. a policy exists, and it is THIS flow's policy;
 *   2. the flow is not the WhatsApp-possession flow;
 *   3. the policy is operationally enabled;
 *   4. the transport shape is legal (whatsapp primary, sms fallback, provider declared);
 *   5. `fallback_policy_status` permits THIS request mode;
 *   6. the mode's own enable flag is set (and, for automatic, `hard_failure_only`);
 *   7. a primary attempt exists with legal lineage, belonging to the SAME authentication
 *      action, the same auth reference and the same destination hash;
 *   8. the primary outcome is EXACTLY a definitive failure (never accepted, never
 *      unknown_outcome, never a status that contradicts the certainty);
 *   9. the attempt history is scoped to THIS action and its budget is not spent;
 *  10. an explicit, active, unambiguous failure rule permits THIS mode.
 *
 * Nothing here infers authorization from provider readiness, and nothing here reads
 * a secret, a credential, or an OTP.
 */
export function evaluateAuthenticationFallback(
  input: FallbackDecisionInput
): AuthenticationFallbackDecision {
  const { policy, primaryAttempt, request, attemptHistory, requestMode, authFlow } = input;

  // 1 — a policy for exactly this flow.
  if (!policy) return blocked(AuthFallbackBlockReason.POLICY_MISSING);
  if (policy.auth_flow !== authFlow) return blocked(AuthFallbackBlockReason.POLICY_FLOW_MISMATCH);

  // 2 — SMS possession is not WhatsApp possession. This flow never falls back, and the
  // check precedes every enable flag so no operator toggle can ever reach it.
  if (authFlow === WHATSAPP_POSSESSION_FLOW || policy.auth_flow === WHATSAPP_POSSESSION_FLOW) {
    return blocked(AuthFallbackBlockReason.WHATSAPP_VERIFICATION_FALLBACK_FORBIDDEN);
  }

  // 3 — the standing operator kill-switch.
  if (policy.is_operationally_enabled !== true) return blocked(AuthFallbackBlockReason.POLICY_DISABLED);

  // 4 — legal transport shape.
  if (policy.primary_channel !== AUTH_PRIMARY_CHANNEL) {
    return blocked(AuthFallbackBlockReason.WRONG_PRIMARY_CHANNEL);
  }
  if (policy.fallback_channel === null) return blocked(AuthFallbackBlockReason.FALLBACK_NOT_DECLARED);
  if (policy.fallback_channel !== AUTH_FALLBACK_CHANNEL) {
    // Covers 'rcs' and any other non-sms value. RCS is never an auth channel.
    return blocked(AuthFallbackBlockReason.WRONG_FALLBACK_CHANNEL);
  }
  if (!policy.fallback_provider_key) return blocked(AuthFallbackBlockReason.FALLBACK_PROVIDER_MISSING);

  // 5/6 — the mode-specific policy gates. Automatic and user-requested are separate
  // authorities: neither implies the other.
  if (requestMode === AuthFallbackRequestMode.AUTOMATIC) {
    if (!AUTOMATIC_FALLBACK_POLICY_STATUSES.includes(policy.fallback_policy_status)) {
      return blocked(AuthFallbackBlockReason.FALLBACK_POLICY_DISABLED);
    }
    if (policy.automatic_fallback_enabled !== true) {
      return blocked(AuthFallbackBlockReason.AUTOMATIC_FALLBACK_DISABLED);
    }
    if (policy.hard_failure_only !== true) {
      return blocked(AuthFallbackBlockReason.HARD_FAILURE_ONLY_DISABLED);
    }
  } else {
    if (!USER_REQUESTED_FALLBACK_POLICY_STATUSES.includes(policy.fallback_policy_status)) {
      return blocked(AuthFallbackBlockReason.FALLBACK_POLICY_DISABLED);
    }
    if (policy.user_requested_fallback_enabled !== true) {
      return blocked(AuthFallbackBlockReason.USER_REQUESTED_FALLBACK_DISABLED);
    }
  }

  // 7 — a primary attempt with legal lineage, for THIS action, THIS reference and THIS
  // destination. The ACTION is checked first: it is the finest identity, and a primary
  // from another login action must never anchor this action's fallback.
  if (!primaryAttempt) return blocked(AuthFallbackBlockReason.ATTEMPT_LINEAGE_INVALID);
  if (
    primaryAttempt.attemptNumber !== PRIMARY_ATTEMPT_NUMBER ||
    primaryAttempt.channel !== AUTH_PRIMARY_CHANNEL ||
    primaryAttempt.authFlow !== authFlow
  ) {
    return blocked(AuthFallbackBlockReason.ATTEMPT_LINEAGE_INVALID);
  }
  if (!request.authActionId || primaryAttempt.authActionId !== request.authActionId) {
    return blocked(AuthFallbackBlockReason.AUTH_ACTION_MISMATCH);
  }
  if (
    primaryAttempt.authReferenceType !== request.authReferenceType ||
    primaryAttempt.authReferenceId !== request.authReferenceId
  ) {
    return blocked(AuthFallbackBlockReason.AUTH_REFERENCE_MISMATCH);
  }
  if (primaryAttempt.destinationHash !== request.destinationHash) {
    return blocked(AuthFallbackBlockReason.DESTINATION_HASH_MISMATCH);
  }

  // 8 — the outcome must be a PROVEN failure. Accepted and unknown both stop here, and
  // a certainty that contradicts the recorded status is treated as not definitive.
  if (primaryAttempt.outcomeCertainty === AuthOutcomeCertainty.ACCEPTED) {
    return blocked(AuthFallbackBlockReason.PRIMARY_ACCEPTED);
  }
  if (primaryAttempt.outcomeCertainty === AuthOutcomeCertainty.UNKNOWN_OUTCOME) {
    return blocked(AuthFallbackBlockReason.PRIMARY_OUTCOME_UNKNOWN);
  }
  if (primaryAttempt.outcomeCertainty !== AuthOutcomeCertainty.DEFINITIVE_FAILURE) {
    return blocked(AuthFallbackBlockReason.PRIMARY_NOT_DEFINITIVE);
  }
  if (!DEFINITIVE_FAILURE_STATUSES.includes(primaryAttempt.status)) {
    return blocked(AuthFallbackBlockReason.PRIMARY_NOT_DEFINITIVE);
  }

  // 9 — the attempt budget: two transport attempts per AUTHENTICATION ACTION, not per
  // auth user. A history that is not scoped to this action fails closed rather than
  // silently counting every login the user ever performed.
  if (attemptHistory.authActionId !== request.authActionId) {
    return blocked(AuthFallbackBlockReason.ATTEMPT_HISTORY_SCOPE_INVALID);
  }
  if (
    attemptHistory.hasFallbackAttempt ||
    attemptHistory.totalAttempts >= MAX_AUTH_TRANSPORT_ATTEMPTS
  ) {
    return blocked(AuthFallbackBlockReason.ATTEMPT_LIMIT_REACHED);
  }

  // 10 — DEFAULT DENY: an explicit, active, unambiguous rule must permit THIS mode for
  // THIS failure code. A definitive failure is never eligible merely by being definitive.
  const eligibility = input.failureEligibility;
  if (!eligibility.resolved) return blocked(AuthFallbackBlockReason.FAILURE_NOT_FALLBACK_ELIGIBLE);
  const permitted =
    requestMode === AuthFallbackRequestMode.AUTOMATIC
      ? eligibility.automaticFallbackEligible
      : eligibility.userRequestedFallbackEligible;
  if (!permitted) return blocked(AuthFallbackBlockReason.FAILURE_NOT_FALLBACK_ELIGIBLE);

  return {
    allowed: true,
    reason: AUTH_FALLBACK_ALLOWED,
    channel: AUTH_FALLBACK_CHANNEL,
    providerKey: policy.fallback_provider_key,
    attemptNumber: FALLBACK_ATTEMPT_NUMBER,
  };
}

/** Convenience guard. Kept separate so a reasoned rejection is never a boolean "maybe". */
export function isAuthenticationFallbackAllowed(input: FallbackDecisionInput): boolean {
  return evaluateAuthenticationFallback(input).allowed;
}

/**
 * The (status, certainty) pairs a delivery attempt may ever hold. The database CHECK
 * enforces the same matrix; this is the application-side mirror so a contradictory
 * finalization is refused before it reaches SQL.
 */
export const ATTEMPT_STATUS_BY_CERTAINTY: Readonly<Record<AuthOutcomeCertaintyValue, readonly string[]>> =
  Object.freeze({
    accepted: Object.freeze(["accepted", "sent", "delivered", "read"]),
    definitive_failure: Object.freeze(["failed", "cancelled"]),
    unknown_outcome: Object.freeze(["requested", "dispatching", "outcome_unknown"]),
  });

/** True only when the status and the certainty agree. Contradictions fail closed. */
export function isConsistentAttemptOutcome(status: string, certainty: string): boolean {
  const allowed = ATTEMPT_STATUS_BY_CERTAINTY[certainty as AuthOutcomeCertaintyValue];
  return Array.isArray(allowed) && allowed.includes(status);
}
