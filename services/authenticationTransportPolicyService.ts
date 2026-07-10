// ============================================================================
// QuickFurno — services/authenticationTransportPolicyService.ts  (Phase 5F-C1, server-only)
//
// The READ side of the authentication fallback decision. It fetches the exact
// transport policy and the exact candidate failure rules, hands them to the PURE
// decision engine, and returns the decision plus its reason code.
//
// It NEVER: writes a policy, enables a policy, creates a failure rule, calls a
// provider, reads a secret, generates or verifies an OTP, or sends anything. The
// decision engine it delegates to has no database access at all.
//
// PROVIDER LINEAGE (Phase 5F-C3-0): the failure-rule lookup is keyed on the provider that
// ACTUALLY owned attempt 1, never on the policy's declared primary provider. The two are
// kept as separate facts and the pure engine proves their equality. Grounding the lookup
// in the declared provider would let provider A's failure be judged by provider B's rule.
//
// Phase 5F-C1 ships every fallback BLOCKED: the policy rows are operationally
// disabled and `authentication_transport_failure_rules` is empty (default deny).
// ============================================================================

import { adminClient } from "../lib/supabase";
import { AppError, fail, isMissingRelationError, ok, type Result } from "../lib/errors";
import type { AuthFlowValue } from "../lib/identity/authTransport";
import {
  AUTH_PRIMARY_CHANNEL,
  AuthFallbackBlockReason,
  FailureRuleUnresolvedReason,
  evaluateAuthenticationFallback,
  resolveFailureRule,
  type AttemptHistorySummary,
  type AuthenticationFallbackDecision,
  type AuthFallbackRequestModeValue,
  type AuthTransportFailureRuleRow,
  type AuthTransportPolicyRow,
  type FailureEligibility,
  type FallbackRequestReference,
  type PrimaryAttemptSummary,
} from "../lib/communication/authenticationTransportDecision";

const POLICY_TABLE = "authentication_transport_policies";
const FAILURE_RULE_TABLE = "authentication_transport_failure_rules";

export const AUTH_TRANSPORT_POLICY_READ_FAILED = "AUTH_TRANSPORT_POLICY_READ_FAILED";

/**
 * The exact policy row for one auth flow, or null. A missing table (the migration is
 * not applied) is indistinguishable from a missing row on purpose: both mean "no
 * policy", and the decision engine blocks.
 */
export async function loadAuthTransportPolicy(
  authFlow: AuthFlowValue
): Promise<AuthTransportPolicyRow | null> {
  try {
    const { data, error } = await adminClient()
      .from(POLICY_TABLE)
      .select("*")
      .eq("auth_flow", authFlow)
      .maybeSingle();
    if (error || !data) return null;
    return data as AuthTransportPolicyRow;
  } catch {
    return null;
  }
}

/**
 * Every candidate failure rule for (primary provider, failure code). BOTH the exact
 * auth-flow rows and the provider-wide (`auth_flow is null`) rows are returned,
 * active or not — precedence, activation, and ambiguity are decided by the PURE
 * resolver, never by a query that could silently pick a row.
 */
export async function loadFailureRuleCandidates(criteria: {
  readonly primaryProviderKey: string;
  readonly failureCode: string;
}): Promise<AuthTransportFailureRuleRow[]> {
  try {
    const { data, error } = await adminClient()
      .from(FAILURE_RULE_TABLE)
      .select("*")
      .eq("primary_channel", AUTH_PRIMARY_CHANNEL)
      .eq("primary_provider_key", criteria.primaryProviderKey)
      .eq("failure_code", criteria.failureCode);
    if (error) {
      // Table absent (migration unapplied) → no rule → default deny.
      if (isMissingRelationError(error)) return [];
      return [];
    }
    return (data ?? []) as AuthTransportFailureRuleRow[];
  } catch {
    return [];
  }
}

/**
 * Resolve the single governing failure rule, DEFAULT DENY. Delegates the precedence
 * and ambiguity rules to the pure resolver.
 *
 * `primaryProviderKey` MUST be the provider that ACTUALLY owned attempt 1, because that
 * is the provider which emitted `failureCode`. It is never the policy's declared primary
 * provider: judging provider A's failure by provider B's rule is exactly the cross-provider
 * authorization this lookup must make impossible. Absent either identity, deny.
 */
export async function resolveFailureEligibility(criteria: {
  readonly authFlow: AuthFlowValue;
  readonly primaryProviderKey: string | null;
  readonly failureCode: string | null;
}): Promise<FailureEligibility> {
  if (!criteria.primaryProviderKey || !criteria.failureCode) {
    // No actual primary provider, or no sanitized failure code, means nothing to look a
    // rule up by. Deny; never substitute a provider identity to make a lookup succeed.
    return { resolved: false, reason: FailureRuleUnresolvedReason.NO_RULE };
  }
  const rows = await loadFailureRuleCandidates({
    primaryProviderKey: criteria.primaryProviderKey,
    failureCode: criteria.failureCode,
  });
  return resolveFailureRule(rows, {
    authFlow: criteria.authFlow,
    primaryChannel: AUTH_PRIMARY_CHANNEL,
    primaryProviderKey: criteria.primaryProviderKey,
    failureCode: criteria.failureCode,
  });
}

export interface FallbackDecisionRequest {
  readonly authFlow: AuthFlowValue;
  readonly requestMode: AuthFallbackRequestModeValue;
  readonly primaryAttempt: PrimaryAttemptSummary | null;
  readonly attemptHistory: AttemptHistorySummary;
  readonly request: FallbackRequestReference;
}

/**
 * The one place an application asks "may this authentication action fall back to SMS
 * right now?". Reads the policy, resolves the failure rule, and evaluates the PURE
 * engine. Never mutates anything and never sends anything.
 *
 * A read failure is a decision failure, not an approval: it returns a blocked decision.
 */
export async function decideAuthenticationFallback(
  input: FallbackDecisionRequest
): Promise<Result<AuthenticationFallbackDecision>> {
  try {
    const policy = await loadAuthTransportPolicy(input.authFlow);
    if (!policy) {
      return ok({ allowed: false, reason: AuthFallbackBlockReason.POLICY_MISSING });
    }

    // TWO INDEPENDENT PROVIDER FACTS, neither derived from the other:
    //   actualPrimaryProviderKey — who actually owned attempt 1 (lineage fact)
    //   policy.primary_provider_key — who the policy declares (policy fact)
    // The rule lookup is grounded in the ACTUAL provider, because that provider emitted
    // the failure code. The PURE engine then proves the two identities are equal and
    // blocks with PRIMARY_PROVIDER_MISMATCH otherwise. Neither value is copied onto the
    // other, and no input projection is mutated.
    const actualPrimaryProviderKey = input.primaryAttempt?.providerKey ?? null;

    const failureEligibility = await resolveFailureEligibility({
      authFlow: input.authFlow,
      primaryProviderKey: actualPrimaryProviderKey,
      failureCode: input.primaryAttempt?.failureCode ?? null,
    });

    return ok(
      evaluateAuthenticationFallback({
        authFlow: input.authFlow,
        requestMode: input.requestMode,
        policy,
        primaryAttempt: input.primaryAttempt,
        failureEligibility,
        attemptHistory: input.attemptHistory,
        request: input.request,
      })
    );
  } catch {
    return fail(
      new AppError(
        AUTH_TRANSPORT_POLICY_READ_FAILED,
        "The authentication transport policy could not be read; no fallback was authorized."
      )
    );
  }
}
