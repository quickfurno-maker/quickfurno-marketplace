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
  /** Non-negative count of clarification cycles already consumed. */
  clarificationCycle: number;
}

/** Origin of a quality result — first scoring vs. a post-clarification rescore. */
export type QualityResultOrigin = "initial" | "rescore";

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
