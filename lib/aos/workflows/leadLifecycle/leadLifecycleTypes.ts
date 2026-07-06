import type { JsonRecord } from "../../workflow/workflowPersistenceTypes";
import type { LeadLifecycleStateValue } from "./leadLifecycleStates";
import type { LeadLifecycleEventTypeValue } from "./leadLifecycleEvents";

/**
 * QuickFurno Lead Lifecycle — shared type contracts (Phase 2A).
 *
 * Phase 2A never calculates a quality score. It only *consumes* an authoritative
 * quality result. The tiers below mirror `LeadScoreClass` from
 * services/leadQualityService.ts and must not be extended or re-thresholded here.
 */

export type LeadQualityTier = "A+" | "A" | "B" | "C" | "D";

export const LEAD_QUALITY_TIERS: LeadQualityTier[] = ["A+", "A", "B", "C", "D"];

/**
 * QuickFurno's authoritative maximum number of vendors a single lead may ever be
 * distributed to. Phase 2A uses this purely as a *contract guard* to reject
 * impossible authoritative results — it never assigns vendors or runs matching.
 */
export const MAX_VENDORS_PER_LEAD = 3;

/**
 * Authoritative quality result payload consumed by the lifecycle. The score is
 * produced by the real Lead Quality Engine (not here). Only routing metadata is
 * consumed.
 */
export interface LeadQualityResult {
  tier: LeadQualityTier;
  /** When true, an authoritative source demands human review (overrides reject). */
  manualReviewRequired: boolean;
  /** When true, another clarification cycle is explicitly authorized. */
  clarificationAllowed: boolean;
  /**
   * Non-negative count of clarification cycles the authoritative source *reports*.
   * NOTE: Phase 2A does NOT use this for loop protection — the cap is enforced
   * structurally by the durable clarification-round state. It is validated for
   * payload hygiene and echoed into metadata only.
   */
  clarificationCycle: number;
}

/** Origin of a quality result — first scoring vs. a post-clarification rescore. */
export type QualityResultOrigin = "initial" | "rescore";

/**
 * Authoritative matching result. Phase 2A does not rank or query vendors; it only
 * guards that the reported recommendation count cannot violate the 3-vendor rule.
 */
export interface MatchingResult {
  recommendedVendorCount: number;
  /** Optional vendor ids; when present their count must equal the count field. */
  vendorIds: string[] | null;
}

/**
 * Authoritative distribution result. Phase 2A does not assign vendors; it only
 * guards that the reported distributed count is within [1, MAX_VENDORS_PER_LEAD].
 */
export interface DistributionResult {
  distributedVendorCount: number;
  vendorIds: string[] | null;
}

/**
 * Explicit, human-gated manual review resolution outcomes. Unknown outcomes are
 * rejected. APPROVE_DISTRIBUTION additionally requires authoritative review
 * metadata (see validation) and remains state-machine-only.
 */
export const ManualReviewOutcome = {
  APPROVE_FOR_MATCHING: "APPROVE_FOR_MATCHING",
  ALLOW_CLARIFICATION: "ALLOW_CLARIFICATION",
  SEND_TO_NURTURE: "SEND_TO_NURTURE",
  APPROVE_DISTRIBUTION: "APPROVE_DISTRIBUTION",
  REJECT: "REJECT",
  CLOSE: "CLOSE",
} as const;

export type ManualReviewOutcomeValue =
  (typeof ManualReviewOutcome)[keyof typeof ManualReviewOutcome];

export interface ManualReviewResolution {
  outcome: ManualReviewOutcomeValue;
  /** True only when an authoritative reviewer explicitly authorized distribution. */
  distributionAuthorized: boolean;
  /** Optional non-empty reviewer identity echoed into metadata. */
  reviewedBy: string | null;
}

/** Canonical lead identity derived from validated workflow/event entity identity. */
export interface CanonicalLeadIdentity {
  leadId: string;
}

export interface LeadLifecycleDecisionInput {
  currentState: LeadLifecycleStateValue;
  eventType: LeadLifecycleEventTypeValue;
  payload: JsonRecord;
}

/** Deterministic, side-effect-free description of a lifecycle decision. */
export interface LeadLifecycleDecision {
  nextState: LeadLifecycleStateValue;
  reason: string;
  metadata: JsonRecord;
}
