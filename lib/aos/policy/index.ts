/**
 * QuickFurno Central Automation Policy Engine (Phase 4A) — public surface.
 *
 * A pure, deterministic, explainable, fail-closed policy foundation that decides
 * whether business automation is currently PERMITTED. Phase 4A builds ONLY the
 * foundation: it is NOT integrated into the live lead lifecycle, publishes NO
 * events, writes NO database rows, and activates NO auto-authorization. Phase 4B
 * will decide how a decision is consumed at MATCH_RECOMMENDATION_READY.
 */

export {
  AutomationPolicyKey,
  AutomationPolicyMode,
  DistributionAuthorizationDecision,
  KNOWN_POLICY_MODES,
  KNOWN_RECOMMENDED_ACTIONS,
  KNOWN_ROUTE_CLASSIFICATIONS,
  KNOWN_SCORE_CLASSES,
  MAX_POLICY_RECOMMENDATION_VENDORS,
} from "./policyTypes";
export type {
  AutomationPolicyKeyValue,
  AutomationPolicyModeValue,
  DistributionAuthorizationDecisionValue,
  LeadDistributionAuthorizationCoreFacts,
  LeadDistributionAuthorizationFacts,
  LeadDistributionAuthorizationPolicyConfig,
  LeadDistributionAuthorizationQualityFacts,
  LeadDistributionAuthorizationRecommendationFacts,
  LeadDistributionRouteValue,
  LeadQualityRecommendedAction,
  LeadScoreClass,
  PolicyDecisionResult,
  PolicyEvaluatedFactsSummary,
  PolicyEvaluator,
  PolicyValidationResult,
} from "./policyTypes";

export {
  PolicyDecisionReason,
  PolicyGate,
} from "./policyDecisionReasons";
export type {
  PolicyDecisionReasonValue,
  PolicyGateValue,
} from "./policyDecisionReasons";

export {
  LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION,
  SAFE_DEFAULT_LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_CONFIG,
} from "./policyConfig";

export {
  summarizeAuthorizationFacts,
  validateAuthorizationFactsCore,
  validateAuthorizationRecommendation,
  validateLeadDistributionAuthorizationConfig,
  validateLeadDistributionAuthorizationFacts,
} from "./policyValidation";

export { computePolicyConfigFingerprint } from "./policyFingerprint";

export {
  evaluateDistributionAuthorizationPolicy,
  evaluateDistributionAuthorizationPolicySafely,
} from "./distributionAuthorizationPolicy";

export {
  isRegisteredPolicyKey,
  listRegisteredPolicyKeys,
  resolvePolicyEvaluator,
} from "./policyRegistry";
