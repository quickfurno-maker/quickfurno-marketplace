import type {
  LeadQualityRecommendedAction,
  LeadScoreClass,
} from "../../../services/leadQualityService";
import {
  LeadDistributionRoute,
  MAX_DISTRIBUTION_VENDORS,
  type LeadDistributionRouteValue,
} from "../workflows/leadLifecycle/distribution/leadDistributionTypes";

/**
 * QuickFurno Central Automation Policy Engine — shared types (Phase 4A).
 *
 * This module is a PURE, deterministic contract layer. It has NO database
 * dependency, performs NO IO, publishes NO events, and calls NO service. It only
 * describes:
 *
 *   - which automation policies exist (AutomationPolicyKey),
 *   - the immutable, PII-free facts a policy consumes,
 *   - the strict configuration a policy is evaluated against,
 *   - the deterministic, explainable decision result a policy returns.
 *
 * The Automation Policy Engine CONSUMES the authoritative quality facts produced
 * by services/leadQualityService.ts (score_class, total_score, hard_block_reason,
 * recommended_action). It never re-scores a lead, re-ranks vendors, or changes
 * quality thresholds. The Quality Engine answers "is the lead qualified and what
 * action is recommended?"; the Policy Engine answers "given those authoritative
 * facts, what automation authority is currently permitted?".
 */

// Re-export the authoritative quality contract types so downstream policy code can
// reference them without creating a divergent duplicate list.
export type { LeadQualityRecommendedAction, LeadScoreClass };
export type { LeadDistributionRouteValue };

/** The maximum vendors a standard distribution may ever recommend (shared Phase 3 bound). */
export const MAX_POLICY_RECOMMENDATION_VENDORS = MAX_DISTRIBUTION_VENDORS;

// ---------------------------------------------------------------------------
// Policy identity
// ---------------------------------------------------------------------------

/** Strongly typed automation policy keys. Phase 4A defines exactly one policy. */
export const AutomationPolicyKey = {
  LEAD_DISTRIBUTION_AUTHORIZATION: "lead_distribution_authorization",
} as const;

export type AutomationPolicyKeyValue =
  (typeof AutomationPolicyKey)[keyof typeof AutomationPolicyKey];

// ---------------------------------------------------------------------------
// Policy mode + decision enums
// ---------------------------------------------------------------------------

/**
 * Automation authorization MODE for the distribution policy. This is entirely
 * separate from the marketplace `auto_assignment_mode` runtime setting
 * (off/preview/auto_suggest). Marketplace runtime mode and automation authority
 * are different concepts; `auto_suggest` is NOT permission to auto-authorize.
 */
export const AutomationPolicyMode = {
  HUMAN_APPROVAL_ONLY: "human_approval_only",
  GUARDED_AUTO_AUTHORIZE: "guarded_auto_authorize",
  MANUAL_REVIEW_ONLY: "manual_review_only",
} as const;

export type AutomationPolicyModeValue =
  (typeof AutomationPolicyMode)[keyof typeof AutomationPolicyMode];

export const KNOWN_POLICY_MODES: readonly AutomationPolicyModeValue[] = Object.freeze(
  Object.values(AutomationPolicyMode),
);

/** The four decisions the lead_distribution_authorization policy may return. */
export const DistributionAuthorizationDecision = {
  REQUIRE_HUMAN_APPROVAL: "require_human_approval",
  AUTO_AUTHORIZE: "auto_authorize",
  MANUAL_REVIEW: "manual_review",
  DEFER_SPECIAL_ROUTE: "defer_special_route",
} as const;

export type DistributionAuthorizationDecisionValue =
  (typeof DistributionAuthorizationDecision)[keyof typeof DistributionAuthorizationDecision];

// ---------------------------------------------------------------------------
// Known-value contracts (exhaustively derived from the authoritative unions)
// ---------------------------------------------------------------------------

// A Record keyed by the authoritative union forces this list to stay exhaustive:
// if a new LeadScoreClass is ever added, this object fails to compile until it is
// listed here, so the runtime known-set can never silently drift from the type.
const SCORE_CLASS_PRESENCE: Record<LeadScoreClass, true> = {
  "A+": true,
  A: true,
  B: true,
  C: true,
  D: true,
};
export const KNOWN_SCORE_CLASSES: readonly LeadScoreClass[] = Object.freeze(
  Object.keys(SCORE_CLASS_PRESENCE) as LeadScoreClass[],
);

const RECOMMENDED_ACTION_PRESENCE: Record<LeadQualityRecommendedAction, true> = {
  auto_distribute: true,
  clarification_required: true,
  nurture: true,
  reject_or_manual_review: true,
  duplicate_no_bill: true,
  consent_required_no_distribution: true,
  invalid_phone_no_distribution: true,
  manual_review_suspicious_name: true,
};
export const KNOWN_RECOMMENDED_ACTIONS: readonly LeadQualityRecommendedAction[] = Object.freeze(
  Object.keys(RECOMMENDED_ACTION_PRESENCE) as LeadQualityRecommendedAction[],
);

/** The exact Phase 3 route classifications (no overlapping/invented names). */
export const KNOWN_ROUTE_CLASSIFICATIONS: readonly LeadDistributionRouteValue[] = Object.freeze(
  Object.values(LeadDistributionRoute),
);

// ---------------------------------------------------------------------------
// Pure validation result
// ---------------------------------------------------------------------------

export type PolicyValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

// ---------------------------------------------------------------------------
// Policy facts contract (immutable, PII-FREE)
// ---------------------------------------------------------------------------

/**
 * Authoritative quality facts consumed (never recomputed) by the policy engine.
 * These mirror the Lead Quality Engine outputs.
 */
export interface LeadDistributionAuthorizationQualityFacts {
  readonly scoreClass: LeadScoreClass;
  readonly totalScore: number;
  readonly hardBlockReason: string | null;
  readonly recommendedAction: LeadQualityRecommendedAction;
}

/** The immutable recommendation-snapshot facts (bounded to at most 3 vendors). */
export interface LeadDistributionAuthorizationRecommendationFacts {
  readonly recommendationEventId: string;
  readonly recommendedVendorCount: number;
  readonly recommendedVendorIds: readonly string[];
}

/**
 * Identity + quality + route portion of the facts contract. Deliberately excludes
 * the recommendation snapshot so the deterministic evaluator can distinguish a
 * malformed recommendation (its own reason code) from malformed core facts.
 */
export interface LeadDistributionAuthorizationCoreFacts {
  readonly policyKey: AutomationPolicyKeyValue;
  readonly workflowType: string;
  readonly workflowInstanceId: string;
  readonly leadId: string;
  readonly currentLifecycleState: string;
  readonly routeClassification: LeadDistributionRouteValue;
  readonly quality: LeadDistributionAuthorizationQualityFacts;
}

/**
 * The complete, immutable, PII-FREE facts contract the policy engine evaluates.
 *
 * PII EXCLUSION (hard rule): this contract must NEVER carry client name, phone,
 * email, WhatsApp number, address, raw client message, budget text, or GPS
 * coordinates. Vendor ids and durable workflow/event ids are allowed.
 */
export interface LeadDistributionAuthorizationFacts
  extends LeadDistributionAuthorizationCoreFacts {
  readonly recommendation: LeadDistributionAuthorizationRecommendationFacts;
}

// ---------------------------------------------------------------------------
// Policy config contract (strict, fail-closed)
// ---------------------------------------------------------------------------

/**
 * Strict Phase 4A configuration contract for the distribution authorization
 * policy. These are AUTOMATION AUTHORIZATION gates only — they do NOT change any
 * quality classification threshold.
 */
export interface LeadDistributionAuthorizationPolicyConfig {
  readonly policyVersion: string;
  readonly mode: AutomationPolicyModeValue;
  readonly enabled: boolean;
  readonly minimumAutoAuthorizeScore: number;
  readonly allowedAutoAuthorizeScoreClasses: readonly LeadScoreClass[];
  readonly requireNoHardBlock: boolean;
  readonly requiredRecommendedAction: LeadQualityRecommendedAction;
  readonly minimumRecommendationCount: number;
  readonly maximumRecommendationCount: number;
}

// ---------------------------------------------------------------------------
// Deterministic, explainable decision result
// ---------------------------------------------------------------------------

/**
 * PII-free summary of the facts that produced a decision. Used for explainability
 * and audit. Never contains client PII; exposes hard-block presence as a boolean
 * rather than leaking any downstream reason string.
 */
export interface PolicyEvaluatedFactsSummary {
  readonly policyKey: string;
  readonly workflowType: string;
  readonly workflowInstanceId: string;
  readonly leadId: string;
  readonly currentLifecycleState: string;
  readonly routeClassification: string;
  readonly scoreClass: string;
  readonly totalScore: number;
  readonly hardBlockReasonPresent: boolean;
  readonly recommendedAction: string;
  readonly recommendationEventId: string;
  readonly recommendedVendorCount: number;
}

/**
 * The immutable, deterministic decision result. For the SAME facts + SAME config
 * this object is byte-for-byte identical: it carries NO evaluation timestamp, NO
 * random id, NO worker id, NO attempt count, and NO hostname.
 */
export interface PolicyDecisionResult {
  readonly policyKey: string;
  readonly policyVersion: string;
  readonly policyFingerprint: string;
  readonly decision: DistributionAuthorizationDecisionValue;
  readonly reasonCode: string;
  readonly evaluatedFactsSummary: PolicyEvaluatedFactsSummary;
  readonly passedGates: readonly string[];
  readonly failedGates: readonly string[];
}

/** A pure policy evaluator: (facts, config) -> deterministic decision result. */
export type PolicyEvaluator = (
  facts: unknown,
  config: unknown,
) => PolicyDecisionResult;
