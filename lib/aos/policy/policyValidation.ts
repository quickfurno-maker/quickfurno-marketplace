import {
  AutomationPolicyKey,
  KNOWN_POLICY_MODES,
  KNOWN_RECOMMENDED_ACTIONS,
  KNOWN_ROUTE_CLASSIFICATIONS,
  KNOWN_SCORE_CLASSES,
  MAX_POLICY_RECOMMENDATION_VENDORS,
  type AutomationPolicyModeValue,
  type LeadDistributionAuthorizationCoreFacts,
  type LeadDistributionAuthorizationFacts,
  type LeadDistributionAuthorizationPolicyConfig,
  type LeadDistributionAuthorizationRecommendationFacts,
  type LeadDistributionRouteValue,
  type LeadQualityRecommendedAction,
  type LeadScoreClass,
  type PolicyEvaluatedFactsSummary,
  type PolicyValidationResult,
} from "./policyTypes";

/**
 * QuickFurno Automation Policy Engine — fail-closed validation (Phase 4A).
 *
 * Unknown or malformed configuration must NEVER expand automation authority, and
 * malformed facts must NEVER be admitted into auto-authorization. Every validator
 * returns a typed result and never throws; a more permissive value is never
 * silently substituted for an invalid one.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function fail<T>(message: string): PolicyValidationResult<T> {
  return { ok: false, message };
}

function ok<T>(value: T): PolicyValidationResult<T> {
  return { ok: true, value };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// ---------------------------------------------------------------------------
// Facts validation
// ---------------------------------------------------------------------------

/**
 * Validate the identity + quality + route portion of the facts (NOT the
 * recommendation snapshot, which has its own reason code in the precedence).
 */
export function validateAuthorizationFactsCore(
  raw: unknown,
): PolicyValidationResult<LeadDistributionAuthorizationCoreFacts> {
  if (!isRecord(raw)) return fail("FACTS_NOT_OBJECT");

  if (raw.policyKey !== AutomationPolicyKey.LEAD_DISTRIBUTION_AUTHORIZATION) {
    return fail("FACTS_POLICY_KEY_INVALID");
  }

  const workflowType = raw.workflowType;
  if (!isNonEmptyString(workflowType)) return fail("FACTS_WORKFLOW_TYPE_INVALID");

  const workflowInstanceId = raw.workflowInstanceId;
  if (!isNonEmptyString(workflowInstanceId)) {
    return fail("FACTS_WORKFLOW_INSTANCE_ID_INVALID");
  }

  const leadId = raw.leadId;
  if (!isNonEmptyString(leadId)) return fail("FACTS_LEAD_ID_INVALID");

  const currentLifecycleState = raw.currentLifecycleState;
  if (!isNonEmptyString(currentLifecycleState)) {
    return fail("FACTS_LIFECYCLE_STATE_INVALID");
  }

  const routeClassification = raw.routeClassification;
  if (
    !KNOWN_ROUTE_CLASSIFICATIONS.includes(
      routeClassification as LeadDistributionRouteValue,
    )
  ) {
    return fail("FACTS_ROUTE_CLASSIFICATION_INVALID");
  }

  const quality = raw.quality;
  if (!isRecord(quality)) return fail("FACTS_QUALITY_INVALID");

  const totalScore = quality.totalScore;
  if (!isIntegerInRange(totalScore, 0, 100)) {
    return fail("FACTS_QUALITY_SCORE_INVALID");
  }

  const scoreClass = quality.scoreClass;
  if (!KNOWN_SCORE_CLASSES.includes(scoreClass as LeadScoreClass)) {
    return fail("FACTS_QUALITY_SCORE_CLASS_INVALID");
  }

  const recommendedAction = quality.recommendedAction;
  if (
    !KNOWN_RECOMMENDED_ACTIONS.includes(
      recommendedAction as LeadQualityRecommendedAction,
    )
  ) {
    return fail("FACTS_QUALITY_RECOMMENDED_ACTION_INVALID");
  }

  const hardBlockReason = quality.hardBlockReason;
  if (!(hardBlockReason === null || typeof hardBlockReason === "string")) {
    return fail("FACTS_QUALITY_HARD_BLOCK_REASON_INVALID");
  }

  return ok(
    Object.freeze({
      policyKey: AutomationPolicyKey.LEAD_DISTRIBUTION_AUTHORIZATION,
      workflowType,
      workflowInstanceId,
      leadId,
      currentLifecycleState,
      routeClassification: routeClassification as LeadDistributionRouteValue,
      quality: Object.freeze({
        scoreClass: scoreClass as LeadScoreClass,
        totalScore,
        hardBlockReason,
        recommendedAction: recommendedAction as LeadQualityRecommendedAction,
      }),
    }),
  );
}

/**
 * Validate the immutable recommendation snapshot. A structurally-valid but empty
 * snapshot (count 0, empty list) is VALID here — the precedence turns that into a
 * "no_distribution_recommendations" decision, separate from a malformed snapshot.
 */
export function validateAuthorizationRecommendation(
  raw: unknown,
): PolicyValidationResult<LeadDistributionAuthorizationRecommendationFacts> {
  if (!isRecord(raw)) return fail("FACTS_NOT_OBJECT");

  const recommendation = raw.recommendation;
  if (!isRecord(recommendation)) return fail("RECOMMENDATION_NOT_OBJECT");

  const recommendationEventId = recommendation.recommendationEventId;
  if (!isNonEmptyString(recommendationEventId)) {
    return fail("RECOMMENDATION_EVENT_ID_INVALID");
  }

  const recommendedVendorCount = recommendation.recommendedVendorCount;
  if (!isIntegerInRange(recommendedVendorCount, 0, MAX_POLICY_RECOMMENDATION_VENDORS)) {
    return fail("RECOMMENDATION_COUNT_INVALID");
  }

  const recommendedVendorIds = recommendation.recommendedVendorIds;
  if (!Array.isArray(recommendedVendorIds)) {
    return fail("RECOMMENDATION_IDS_NOT_ARRAY");
  }
  for (const id of recommendedVendorIds) {
    if (!isNonEmptyString(id)) return fail("RECOMMENDATION_ID_INVALID");
  }
  const uniqueIds = new Set(recommendedVendorIds as string[]);
  if (uniqueIds.size !== recommendedVendorIds.length) {
    return fail("RECOMMENDATION_IDS_NOT_UNIQUE");
  }
  if (recommendedVendorIds.length !== recommendedVendorCount) {
    return fail("RECOMMENDATION_IDS_COUNT_MISMATCH");
  }

  return ok(
    Object.freeze({
      recommendationEventId,
      recommendedVendorCount,
      recommendedVendorIds: Object.freeze([...(recommendedVendorIds as string[])]),
    }),
  );
}

/** Full facts validation = core facts + recommendation snapshot. */
export function validateLeadDistributionAuthorizationFacts(
  raw: unknown,
): PolicyValidationResult<LeadDistributionAuthorizationFacts> {
  const core = validateAuthorizationFactsCore(raw);
  if (!core.ok) return core;
  const recommendation = validateAuthorizationRecommendation(raw);
  if (!recommendation.ok) return recommendation;
  return ok(
    Object.freeze({ ...core.value, recommendation: recommendation.value }),
  );
}

// ---------------------------------------------------------------------------
// Config validation (fail-closed)
// ---------------------------------------------------------------------------

/**
 * Validate a distribution authorization config. Any unknown mode, out-of-range
 * score, empty/invalid allowed-class list, invalid vendor bounds (max > 3,
 * min > max, min < 0), or missing required action fails closed.
 */
export function validateLeadDistributionAuthorizationConfig(
  raw: unknown,
): PolicyValidationResult<LeadDistributionAuthorizationPolicyConfig> {
  if (!isRecord(raw)) return fail("CONFIG_NOT_OBJECT");

  const policyVersion = raw.policyVersion;
  if (!isNonEmptyString(policyVersion)) return fail("CONFIG_POLICY_VERSION_INVALID");

  const mode = raw.mode;
  if (!KNOWN_POLICY_MODES.includes(mode as AutomationPolicyModeValue)) {
    return fail("CONFIG_MODE_INVALID");
  }

  const enabled = raw.enabled;
  if (typeof enabled !== "boolean") return fail("CONFIG_ENABLED_INVALID");

  const minimumAutoAuthorizeScore = raw.minimumAutoAuthorizeScore;
  if (!isIntegerInRange(minimumAutoAuthorizeScore, 0, 100)) {
    return fail("CONFIG_MINIMUM_SCORE_INVALID");
  }

  const allowedAutoAuthorizeScoreClasses = raw.allowedAutoAuthorizeScoreClasses;
  if (
    !Array.isArray(allowedAutoAuthorizeScoreClasses) ||
    allowedAutoAuthorizeScoreClasses.length === 0
  ) {
    return fail("CONFIG_ALLOWED_CLASSES_INVALID");
  }
  for (const scoreClass of allowedAutoAuthorizeScoreClasses) {
    if (!KNOWN_SCORE_CLASSES.includes(scoreClass as LeadScoreClass)) {
      return fail("CONFIG_ALLOWED_CLASSES_INVALID");
    }
  }

  const requireNoHardBlock = raw.requireNoHardBlock;
  if (typeof requireNoHardBlock !== "boolean") {
    return fail("CONFIG_REQUIRE_NO_HARD_BLOCK_INVALID");
  }

  const requiredRecommendedAction = raw.requiredRecommendedAction;
  if (
    !KNOWN_RECOMMENDED_ACTIONS.includes(
      requiredRecommendedAction as LeadQualityRecommendedAction,
    )
  ) {
    return fail("CONFIG_REQUIRED_ACTION_INVALID");
  }

  const minimumRecommendationCount = raw.minimumRecommendationCount;
  if (!isIntegerInRange(minimumRecommendationCount, 0, MAX_POLICY_RECOMMENDATION_VENDORS)) {
    return fail("CONFIG_MINIMUM_RECOMMENDATION_COUNT_INVALID");
  }

  const maximumRecommendationCount = raw.maximumRecommendationCount;
  if (!isIntegerInRange(maximumRecommendationCount, 1, MAX_POLICY_RECOMMENDATION_VENDORS)) {
    return fail("CONFIG_MAXIMUM_RECOMMENDATION_COUNT_INVALID");
  }

  if (minimumRecommendationCount > maximumRecommendationCount) {
    return fail("CONFIG_RECOMMENDATION_BOUNDS_INVALID");
  }

  return ok(
    Object.freeze({
      policyVersion,
      mode: mode as AutomationPolicyModeValue,
      enabled,
      minimumAutoAuthorizeScore,
      allowedAutoAuthorizeScoreClasses: Object.freeze([
        ...(allowedAutoAuthorizeScoreClasses as LeadScoreClass[]),
      ]),
      requireNoHardBlock,
      requiredRecommendedAction: requiredRecommendedAction as LeadQualityRecommendedAction,
      minimumRecommendationCount,
      maximumRecommendationCount,
    }),
  );
}

// ---------------------------------------------------------------------------
// PII-free facts summary
// ---------------------------------------------------------------------------

/**
 * Build a deterministic, PII-free summary of whatever facts were supplied. Reads
 * defensively so it is safe to call on malformed facts (used to attach a summary
 * even to a policy_facts_invalid decision). Never reads any PII field.
 */
export function summarizeAuthorizationFacts(raw: unknown): PolicyEvaluatedFactsSummary {
  const facts = isRecord(raw) ? raw : {};
  const quality = isRecord(facts.quality) ? facts.quality : {};
  const recommendation = isRecord(facts.recommendation) ? facts.recommendation : {};
  const hardBlockReason = quality.hardBlockReason;

  return Object.freeze({
    policyKey: AutomationPolicyKey.LEAD_DISTRIBUTION_AUTHORIZATION,
    workflowType: asString(facts.workflowType),
    workflowInstanceId: asString(facts.workflowInstanceId),
    leadId: asString(facts.leadId),
    currentLifecycleState: asString(facts.currentLifecycleState),
    routeClassification: asString(facts.routeClassification),
    scoreClass: asString(quality.scoreClass),
    totalScore: asFiniteNumber(quality.totalScore),
    hardBlockReasonPresent:
      hardBlockReason !== null &&
      hardBlockReason !== undefined &&
      hardBlockReason !== "",
    recommendedAction: asString(quality.recommendedAction),
    recommendationEventId: asString(recommendation.recommendationEventId),
    recommendedVendorCount: asFiniteNumber(recommendation.recommendedVendorCount),
  });
}
