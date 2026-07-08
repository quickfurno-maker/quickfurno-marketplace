import {
  AutomationPolicyMode,
  type LeadDistributionAuthorizationPolicyConfig,
  type LeadScoreClass,
} from "./policyTypes";

/**
 * QuickFurno Automation Policy Engine — versioning + safe defaults (Phase 4A).
 *
 * The policy version is an EXPLICIT constant (never the package version or a
 * timestamp) so a decision can always be attributed to a stable policy revision.
 */

export const LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION =
  "lead_distribution_authorization_v1";

/**
 * The SAFE DEFAULT configuration. It is intentionally the most conservative
 * setting: human approval only, disabled, and — even if it were enabled and
 * flipped to guarded mode — it would require A+ / score >= 90 / no hard block /
 * recommended_action = auto_distribute / 1..3 recommendations. These are
 * AUTOMATION AUTHORIZATION gates and do NOT change any quality threshold.
 *
 * Frozen so it can be shared as an immutable baseline.
 */
export const SAFE_DEFAULT_LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_CONFIG: LeadDistributionAuthorizationPolicyConfig =
  Object.freeze({
    policyVersion: LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION,
    mode: AutomationPolicyMode.HUMAN_APPROVAL_ONLY,
    enabled: false,
    minimumAutoAuthorizeScore: 90,
    allowedAutoAuthorizeScoreClasses: Object.freeze(["A+"] as LeadScoreClass[]),
    requireNoHardBlock: true,
    requiredRecommendedAction: "auto_distribute",
    minimumRecommendationCount: 1,
    maximumRecommendationCount: 3,
  });
