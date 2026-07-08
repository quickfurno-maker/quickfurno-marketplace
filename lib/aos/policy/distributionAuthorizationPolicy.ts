import {
  AutomationPolicyKey,
  AutomationPolicyMode,
  DistributionAuthorizationDecision,
  type DistributionAuthorizationDecisionValue,
  type PolicyDecisionResult,
  type PolicyEvaluatedFactsSummary,
} from "./policyTypes";
import { LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION } from "./policyConfig";
import { PolicyDecisionReason, PolicyGate } from "./policyDecisionReasons";
import { computePolicyConfigFingerprint } from "./policyFingerprint";
import {
  summarizeAuthorizationFacts,
  validateAuthorizationFactsCore,
  validateAuthorizationRecommendation,
  validateLeadDistributionAuthorizationConfig,
} from "./policyValidation";
import { LeadDistributionRoute } from "../workflows/leadLifecycle/distribution/leadDistributionTypes";

/**
 * QuickFurno lead_distribution_authorization policy — deterministic evaluator
 * (Phase 4A).
 *
 * Given authoritative, PII-free facts and a strict config, this returns exactly
 * one of: require_human_approval, auto_authorize, manual_review, or
 * defer_special_route. It is PURE: no DB, no events, no service calls, no vendor
 * selection, no re-ranking, no credit math. The decision only STATES the
 * permitted automation authority; it never acts on it.
 *
 * DETERMINISTIC PRECEDENCE (fail-fast on the first failing gate):
 *   1. facts valid            else manual_review        (policy_facts_invalid)
 *   2. standard route         else defer_special_route  (special_route_owned_elsewhere)
 *   3. recommendation valid   else manual_review        (recommendation_snapshot_invalid)
 *      recommendations > 0    else manual_review        (no_distribution_recommendations)
 *   4. config valid           else require_human_approval (policy_config_invalid_fail_closed)
 *   5. enabled                else require_human_approval (automation_policy_disabled)
 *   6. mode: human_approval_only -> require_human_approval (human_approval_mode)
 *           manual_review_only  -> manual_review         (manual_review_mode)
 *           guarded_auto_authorize -> continue
 *   7. quality gates (guarded only): min score, allowed class, no hard block,
 *      required recommended action
 *   8. recommendation-count bounds: within [min, max]
 *   9. all gates pass         -> auto_authorize          (guarded_auto_authorization_eligible)
 *
 * Array-ordering policy: `passedGates` is appended strictly in evaluation order
 * above; `failedGates` holds exactly the single gate that stopped evaluation
 * (empty for auto_authorize). Both are therefore fully deterministic.
 */

interface BuildDecisionInput {
  readonly decision: DistributionAuthorizationDecisionValue;
  readonly reasonCode: string;
  readonly passedGates: readonly string[];
  readonly failedGates: readonly string[];
  readonly summary: PolicyEvaluatedFactsSummary;
  readonly fingerprint: string;
}

function buildDecision(input: BuildDecisionInput): PolicyDecisionResult {
  return Object.freeze({
    policyKey: AutomationPolicyKey.LEAD_DISTRIBUTION_AUTHORIZATION,
    policyVersion: LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION,
    policyFingerprint: input.fingerprint,
    decision: input.decision,
    reasonCode: input.reasonCode,
    evaluatedFactsSummary: input.summary,
    passedGates: Object.freeze([...input.passedGates]),
    failedGates: Object.freeze([...input.failedGates]),
  });
}

/**
 * Evaluate the distribution authorization policy. Returns a deterministic result
 * for expected inputs (including invalid facts/config); it does not throw for
 * malformed inputs — those resolve to explicit fail-closed decisions.
 */
export function evaluateDistributionAuthorizationPolicy(
  facts: unknown,
  config: unknown,
): PolicyDecisionResult {
  const fingerprint = computePolicyConfigFingerprint(config);
  const summary = summarizeAuthorizationFacts(facts);
  const passed: string[] = [];

  // 1. Validate facts (identity + quality + route).
  const core = validateAuthorizationFactsCore(facts);
  if (!core.ok) {
    return buildDecision({
      decision: DistributionAuthorizationDecision.MANUAL_REVIEW,
      reasonCode: PolicyDecisionReason.POLICY_FACTS_INVALID,
      passedGates: passed,
      failedGates: [PolicyGate.FACTS_VALID],
      summary,
      fingerprint,
    });
  }
  passed.push(PolicyGate.FACTS_VALID);

  // 2. Route ownership: only the standard route is owned by this policy.
  if (core.value.routeClassification !== LeadDistributionRoute.STANDARD) {
    return buildDecision({
      decision: DistributionAuthorizationDecision.DEFER_SPECIAL_ROUTE,
      reasonCode: PolicyDecisionReason.SPECIAL_ROUTE_OWNED_ELSEWHERE,
      passedGates: passed,
      failedGates: [PolicyGate.STANDARD_ROUTE],
      summary,
      fingerprint,
    });
  }
  passed.push(PolicyGate.STANDARD_ROUTE);

  // 3. Recommendation snapshot integrity, then non-emptiness.
  const recommendation = validateAuthorizationRecommendation(facts);
  if (!recommendation.ok) {
    return buildDecision({
      decision: DistributionAuthorizationDecision.MANUAL_REVIEW,
      reasonCode: PolicyDecisionReason.RECOMMENDATION_SNAPSHOT_INVALID,
      passedGates: passed,
      failedGates: [PolicyGate.RECOMMENDATION_SNAPSHOT_VALID],
      summary,
      fingerprint,
    });
  }
  passed.push(PolicyGate.RECOMMENDATION_SNAPSHOT_VALID);

  if (recommendation.value.recommendedVendorCount === 0) {
    return buildDecision({
      decision: DistributionAuthorizationDecision.MANUAL_REVIEW,
      reasonCode: PolicyDecisionReason.NO_DISTRIBUTION_RECOMMENDATIONS,
      passedGates: passed,
      failedGates: [PolicyGate.RECOMMENDATIONS_PRESENT],
      summary,
      fingerprint,
    });
  }
  passed.push(PolicyGate.RECOMMENDATIONS_PRESENT);

  // 4. Config validation (fail-closed to human approval).
  const configResult = validateLeadDistributionAuthorizationConfig(config);
  if (!configResult.ok) {
    return buildDecision({
      decision: DistributionAuthorizationDecision.REQUIRE_HUMAN_APPROVAL,
      reasonCode: PolicyDecisionReason.POLICY_CONFIG_INVALID_FAIL_CLOSED,
      passedGates: passed,
      failedGates: [PolicyGate.POLICY_CONFIG_VALID],
      summary,
      fingerprint,
    });
  }
  passed.push(PolicyGate.POLICY_CONFIG_VALID);
  const cfg = configResult.value;

  // 5. Policy enabled.
  if (!cfg.enabled) {
    return buildDecision({
      decision: DistributionAuthorizationDecision.REQUIRE_HUMAN_APPROVAL,
      reasonCode: PolicyDecisionReason.AUTOMATION_POLICY_DISABLED,
      passedGates: passed,
      failedGates: [PolicyGate.POLICY_ENABLED],
      summary,
      fingerprint,
    });
  }
  passed.push(PolicyGate.POLICY_ENABLED);

  // 6. Policy mode.
  if (cfg.mode === AutomationPolicyMode.HUMAN_APPROVAL_ONLY) {
    return buildDecision({
      decision: DistributionAuthorizationDecision.REQUIRE_HUMAN_APPROVAL,
      reasonCode: PolicyDecisionReason.HUMAN_APPROVAL_MODE,
      passedGates: passed,
      failedGates: [PolicyGate.GUARDED_AUTO_AUTHORIZE_MODE],
      summary,
      fingerprint,
    });
  }
  if (cfg.mode === AutomationPolicyMode.MANUAL_REVIEW_ONLY) {
    return buildDecision({
      decision: DistributionAuthorizationDecision.MANUAL_REVIEW,
      reasonCode: PolicyDecisionReason.MANUAL_REVIEW_MODE,
      passedGates: passed,
      failedGates: [PolicyGate.GUARDED_AUTO_AUTHORIZE_MODE],
      summary,
      fingerprint,
    });
  }
  // guarded_auto_authorize
  passed.push(PolicyGate.GUARDED_AUTO_AUTHORIZE_MODE);

  const quality = core.value.quality;

  // 7. Quality gates (all required for guarded auto-authorization).
  if (quality.totalScore < cfg.minimumAutoAuthorizeScore) {
    return buildDecision({
      decision: DistributionAuthorizationDecision.REQUIRE_HUMAN_APPROVAL,
      reasonCode: PolicyDecisionReason.QUALITY_SCORE_BELOW_POLICY_THRESHOLD,
      passedGates: passed,
      failedGates: [PolicyGate.MINIMUM_AUTO_AUTHORIZE_SCORE],
      summary,
      fingerprint,
    });
  }
  passed.push(PolicyGate.MINIMUM_AUTO_AUTHORIZE_SCORE);

  if (!cfg.allowedAutoAuthorizeScoreClasses.includes(quality.scoreClass)) {
    return buildDecision({
      decision: DistributionAuthorizationDecision.REQUIRE_HUMAN_APPROVAL,
      reasonCode: PolicyDecisionReason.QUALITY_CLASS_NOT_ALLOWED,
      passedGates: passed,
      failedGates: [PolicyGate.ALLOWED_AUTO_AUTHORIZE_SCORE_CLASS],
      summary,
      fingerprint,
    });
  }
  passed.push(PolicyGate.ALLOWED_AUTO_AUTHORIZE_SCORE_CLASS);

  if (cfg.requireNoHardBlock && quality.hardBlockReason !== null) {
    return buildDecision({
      decision: DistributionAuthorizationDecision.REQUIRE_HUMAN_APPROVAL,
      reasonCode: PolicyDecisionReason.QUALITY_HARD_BLOCK_PRESENT,
      passedGates: passed,
      failedGates: [PolicyGate.NO_HARD_BLOCK],
      summary,
      fingerprint,
    });
  }
  passed.push(PolicyGate.NO_HARD_BLOCK);

  if (quality.recommendedAction !== cfg.requiredRecommendedAction) {
    return buildDecision({
      decision: DistributionAuthorizationDecision.REQUIRE_HUMAN_APPROVAL,
      reasonCode: PolicyDecisionReason.QUALITY_RECOMMENDED_ACTION_NOT_ALLOWED,
      passedGates: passed,
      failedGates: [PolicyGate.REQUIRED_RECOMMENDED_ACTION],
      summary,
      fingerprint,
    });
  }
  passed.push(PolicyGate.REQUIRED_RECOMMENDED_ACTION);

  // 8. Recommendation-count bounds.
  const count = recommendation.value.recommendedVendorCount;
  if (count < cfg.minimumRecommendationCount) {
    return buildDecision({
      decision: DistributionAuthorizationDecision.REQUIRE_HUMAN_APPROVAL,
      reasonCode: PolicyDecisionReason.RECOMMENDATION_COUNT_BELOW_POLICY_MINIMUM,
      passedGates: passed,
      failedGates: [PolicyGate.RECOMMENDATION_WITHIN_MINIMUM_BOUND],
      summary,
      fingerprint,
    });
  }
  passed.push(PolicyGate.RECOMMENDATION_WITHIN_MINIMUM_BOUND);

  if (count > cfg.maximumRecommendationCount) {
    return buildDecision({
      decision: DistributionAuthorizationDecision.REQUIRE_HUMAN_APPROVAL,
      reasonCode: PolicyDecisionReason.RECOMMENDATION_COUNT_ABOVE_POLICY_MAXIMUM,
      passedGates: passed,
      failedGates: [PolicyGate.RECOMMENDATION_WITHIN_MAXIMUM_BOUND],
      summary,
      fingerprint,
    });
  }
  passed.push(PolicyGate.RECOMMENDATION_WITHIN_MAXIMUM_BOUND);

  // 9. All gates passed.
  return buildDecision({
    decision: DistributionAuthorizationDecision.AUTO_AUTHORIZE,
    reasonCode: PolicyDecisionReason.GUARDED_AUTO_AUTHORIZATION_ELIGIBLE,
    passedGates: passed,
    failedGates: [],
    summary,
    fingerprint,
  });
}

/**
 * Safe wrapper. Guarantees a decision is ALWAYS returned and that an unexpected
 * throw can never leak into auto-authorization: any thrown error fails closed to
 * require_human_approval with policy_config_invalid_fail_closed.
 */
export function evaluateDistributionAuthorizationPolicySafely(
  facts: unknown,
  config: unknown,
): PolicyDecisionResult {
  try {
    return evaluateDistributionAuthorizationPolicy(facts, config);
  } catch {
    return buildDecision({
      decision: DistributionAuthorizationDecision.REQUIRE_HUMAN_APPROVAL,
      reasonCode: PolicyDecisionReason.POLICY_CONFIG_INVALID_FAIL_CLOSED,
      passedGates: [],
      failedGates: [PolicyGate.POLICY_CONFIG_VALID],
      summary: summarizeAuthorizationFacts(facts),
      fingerprint: computePolicyConfigFingerprint(config),
    });
  }
}
