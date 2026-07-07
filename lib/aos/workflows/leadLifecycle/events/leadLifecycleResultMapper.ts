import {
  canAutoDistributeLead,
  getLeadQualityDecision,
  type LeadQualityRecommendedAction,
  type LeadQualityScoreResult,
} from "../../../../../services/leadQualityService";
import { LeadLifecycleEventType } from "../leadLifecycleEvents";
import { LEAD_LIFECYCLE_WORKFLOW_TYPE } from "../leadLifecycleStates";
import type { LeadLifecycleEventTypeValue } from "../leadLifecycleEvents";
import type { JsonRecord } from "../../../workflow/workflowPersistenceTypes";

export interface LeadLifecycleMappedEvent {
  eventType: LeadLifecycleEventTypeValue;
  payload: JsonRecord;
}

export type LeadLifecycleQualityEventOrigin = "initial" | "rescore";

const THRESHOLD_BLOCK_REASON = "score_below_auto_distribution_threshold";

export function mapQualityResultToLifecycleEvent(
  scoreResult: LeadQualityScoreResult,
  origin: LeadLifecycleQualityEventOrigin,
): LeadLifecycleMappedEvent {
  const decision = getLeadQualityDecision(scoreResult);
  const base = {
    quality: {
      source: "leadQualityService",
      origin,
      score_class: scoreResult.score_class,
      total_score: scoreResult.total_score,
      recommended_action: scoreResult.recommended_action,
      hard_block_reason: scoreResult.hard_block_reason,
      can_auto_distribute: decision.canAutoDistribute,
      lead_quality_status: decision.leadQualityStatus,
      lead_status: decision.leadStatus,
      verification_status: decision.verificationStatus,
    },
  };

  switch (scoreResult.recommended_action) {
    case "auto_distribute":
      if (canAutoDistributeLead(scoreResult)) {
        return qualityResulted({ ...base, quality: { ...base.quality, tier: scoreResult.score_class } });
      }
      return manualReviewRequired(scoreResult, "auto_distribute_blocked_by_quality_gate", base);

    case "clarification_required":
      if (isBlockedAOrBetter(scoreResult)) {
        return manualReviewRequired(scoreResult, "a_tier_clarification_hard_block", base);
      }
      return qualityResulted({
        ...base,
        quality: {
          ...base.quality,
          tier: "B",
          clarification_allowed: true,
        },
      });

    case "nurture":
      if (isBlockedAOrBetter(scoreResult)) {
        return manualReviewRequired(scoreResult, "a_tier_nurture_hard_block", base);
      }
      return qualityResulted({ ...base, quality: { ...base.quality, tier: "C" } });

    case "reject_or_manual_review":
      if (requiresManualReview(scoreResult)) {
        return manualReviewRequired(scoreResult, "reject_or_manual_review_condition", base);
      }
      return qualityResulted({ ...base, quality: { ...base.quality, tier: "D" } });

    case "duplicate_no_bill":
    case "consent_required_no_distribution":
    case "invalid_phone_no_distribution":
    case "manual_review_suspicious_name":
      return manualReviewRequired(scoreResult, scoreResult.recommended_action, base);

    default: {
      const exhaustive: never = scoreResult.recommended_action;
      throw new Error(`LEAD_QUALITY_RECOMMENDED_ACTION_UNMAPPED:${String(exhaustive)}`);
    }
  }
}

export function listExplicitlyMappedRecommendedActions(): LeadQualityRecommendedAction[] {
  return [
    "auto_distribute",
    "clarification_required",
    "nurture",
    "reject_or_manual_review",
    "duplicate_no_bill",
    "consent_required_no_distribution",
    "invalid_phone_no_distribution",
    "manual_review_suspicious_name",
  ];
}

function isBlockedAOrBetter(scoreResult: LeadQualityScoreResult): boolean {
  return (scoreResult.score_class === "A" || scoreResult.score_class === "A+")
    && Boolean(scoreResult.hard_block_reason);
}

function requiresManualReview(scoreResult: LeadQualityScoreResult): boolean {
  if (isBlockedAOrBetter(scoreResult)) return true;
  if (!scoreResult.hard_block_reason) return false;
  return scoreResult.hard_block_reason !== THRESHOLD_BLOCK_REASON;
}

function qualityResulted(payload: JsonRecord): LeadLifecycleMappedEvent {
  return {
    eventType: LeadLifecycleEventType.QUALITY_RESULTED,
    payload,
  };
}

function manualReviewRequired(
  scoreResult: LeadQualityScoreResult,
  reason: string,
  payload: JsonRecord,
): LeadLifecycleMappedEvent {
  return {
    eventType: LeadLifecycleEventType.MANUAL_REVIEW_REQUIRED,
    payload: {
      ...payload,
      manual_review: {
        source: "leadQualityService",
        reason,
        recommended_action: scoreResult.recommended_action,
        hard_block_reason: scoreResult.hard_block_reason,
        score_class: scoreResult.score_class,
      },
    },
  };
}

export function assertNoManualReviewResolution(event: LeadLifecycleMappedEvent): void {
  if (event.eventType === LeadLifecycleEventType.MANUAL_REVIEW_RESOLVED) {
    throw new Error("PHASE_2B_MUST_NOT_GENERATE_MANUAL_REVIEW_RESOLVED");
  }
  const payload = event.payload;
  if (payload.reviewed_by !== undefined || payload.outcome !== undefined) {
    throw new Error("PHASE_2B_MUST_NOT_FABRICATE_MANUAL_REVIEW_DECISION");
  }
}

export function withWorkflowPayloadIdentity(payload: JsonRecord, leadId: string): JsonRecord {
  return {
    ...payload,
    workflow_type: LEAD_LIFECYCLE_WORKFLOW_TYPE,
    lead_id: leadId,
  };
}
