import type {
  DistributionValidationResult,
  LeadDistributionRecommendationEventPort,
  LeadDistributionRecommendationExpectation,
  LeadDistributionRecommendationSnapshot,
} from "./leadDistributionTypes";
import { validateRecommendationEventSnapshot } from "./leadDistributionValidation";

/**
 * QuickFurno Distribution Control — recommendation snapshot resolver (Phase 3A).
 *
 * A narrow resolver that loads the authoritative `lead.matching.completed`
 * domain event by id and normalizes it into an immutable snapshot bound to the
 * expected lead + workflow. It does NOT re-run matching and does NOT call any
 * ranking function (getEligibleVendorsForLead / runAutoLeadMatchingForLead / …).
 * Recommendation order is authoritative.
 */
export async function resolveLeadDistributionRecommendation(
  expectation: LeadDistributionRecommendationExpectation,
  port: LeadDistributionRecommendationEventPort,
): Promise<DistributionValidationResult<LeadDistributionRecommendationSnapshot>> {
  const eventId = expectation.recommendationEventId?.trim();
  if (!eventId) {
    return { ok: false, message: "RECOMMENDATION_EVENT_ID_REQUIRED" };
  }

  const event = await port.getDomainEventById(eventId);
  if (!event) {
    return { ok: false, message: "RECOMMENDATION_EVENT_NOT_FOUND" };
  }

  return validateRecommendationEventSnapshot(event, {
    recommendationEventId: eventId,
    expectedWorkflowInstanceId: expectation.expectedWorkflowInstanceId,
    expectedLeadId: expectation.expectedLeadId,
  });
}
