/**
 * QuickFurno Automation Policy Engine — deterministic reason codes + gate names
 * (Phase 4A).
 *
 * Every policy decision exposes a stable `reasonCode` and the exact `passedGates`
 * / `failedGates` that produced it. These constants are the single source of
 * truth for those strings so decisions stay explainable and comparable over time.
 */

/**
 * The deterministic reason a decision was reached. One reason per decision path;
 * the evaluator is fail-fast on the first failing gate so the reason is precise.
 */
export const PolicyDecisionReason = {
  // Facts / recommendation integrity
  POLICY_FACTS_INVALID: "policy_facts_invalid",
  RECOMMENDATION_SNAPSHOT_INVALID: "recommendation_snapshot_invalid",
  NO_DISTRIBUTION_RECOMMENDATIONS: "no_distribution_recommendations",

  // Route ownership
  SPECIAL_ROUTE_OWNED_ELSEWHERE: "special_route_owned_elsewhere",

  // Config / mode gates (fail-closed)
  POLICY_CONFIG_INVALID_FAIL_CLOSED: "policy_config_invalid_fail_closed",
  AUTOMATION_POLICY_DISABLED: "automation_policy_disabled",
  HUMAN_APPROVAL_MODE: "human_approval_mode",
  MANUAL_REVIEW_MODE: "manual_review_mode",

  // Guarded auto-authorization quality gates
  QUALITY_SCORE_BELOW_POLICY_THRESHOLD: "quality_score_below_policy_threshold",
  QUALITY_CLASS_NOT_ALLOWED: "quality_class_not_allowed",
  QUALITY_HARD_BLOCK_PRESENT: "quality_hard_block_present",
  QUALITY_RECOMMENDED_ACTION_NOT_ALLOWED: "quality_recommended_action_not_allowed",

  // Recommendation-count bounds
  RECOMMENDATION_COUNT_BELOW_POLICY_MINIMUM: "recommendation_count_below_policy_minimum",
  RECOMMENDATION_COUNT_ABOVE_POLICY_MAXIMUM: "recommendation_count_above_policy_maximum",

  // Success
  GUARDED_AUTO_AUTHORIZATION_ELIGIBLE: "guarded_auto_authorization_eligible",
} as const;

export type PolicyDecisionReasonValue =
  (typeof PolicyDecisionReason)[keyof typeof PolicyDecisionReason];

/**
 * Named gates in the deterministic precedence. A decision reports which gates it
 * cleared (`passedGates`, in evaluation order) and which single gate it failed on
 * (`failedGates`). Auto-authorization reports an empty `failedGates`.
 */
export const PolicyGate = {
  FACTS_VALID: "facts_valid",
  STANDARD_ROUTE: "standard_route",
  RECOMMENDATION_SNAPSHOT_VALID: "recommendation_snapshot_valid",
  RECOMMENDATIONS_PRESENT: "recommendations_present",
  POLICY_CONFIG_VALID: "policy_config_valid",
  POLICY_ENABLED: "policy_enabled",
  GUARDED_AUTO_AUTHORIZE_MODE: "guarded_auto_authorize_mode",
  MINIMUM_AUTO_AUTHORIZE_SCORE: "minimum_auto_authorize_score",
  ALLOWED_AUTO_AUTHORIZE_SCORE_CLASS: "allowed_auto_authorize_score_class",
  NO_HARD_BLOCK: "no_hard_block",
  REQUIRED_RECOMMENDED_ACTION: "required_recommended_action",
  RECOMMENDATION_WITHIN_MINIMUM_BOUND: "recommendation_within_minimum_bound",
  RECOMMENDATION_WITHIN_MAXIMUM_BOUND: "recommendation_within_maximum_bound",
} as const;

export type PolicyGateValue = (typeof PolicyGate)[keyof typeof PolicyGate];
