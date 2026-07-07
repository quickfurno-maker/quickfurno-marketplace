import type {
  DistributionValidationResult,
  LeadDistributionApprovedExpectation,
  LeadDistributionApprovedSnapshot,
  LeadDistributionRecommendationEventPort,
} from "./leadDistributionTypes";
import { validateApprovedEventSnapshot } from "./leadDistributionValidation";

/**
 * QuickFurno Distribution Control — approved-event snapshot resolver (Phase 3B).
 *
 * Loads the authoritative `lead.distribution.approved` domain event by id (the
 * event that caused the workflow to enter DISTRIBUTION_PENDING) and normalizes it
 * into an immutable snapshot bound to the expected lead + workflow. It does NOT
 * rerun matching and does NOT load a new ranking. Reuses the generic
 * "get domain event by id" port.
 */
export async function resolveLeadDistributionApprovedSnapshot(
  expectation: LeadDistributionApprovedExpectation,
  port: LeadDistributionRecommendationEventPort,
): Promise<DistributionValidationResult<LeadDistributionApprovedSnapshot>> {
  const eventId = expectation.approvalEventId?.trim();
  if (!eventId) {
    return { ok: false, message: "APPROVAL_EVENT_ID_REQUIRED" };
  }

  const event = await port.getDomainEventById(eventId);
  if (!event) {
    return { ok: false, message: "APPROVED_EVENT_NOT_FOUND" };
  }

  return validateApprovedEventSnapshot(event, {
    approvalEventId: eventId,
    expectedWorkflowInstanceId: expectation.expectedWorkflowInstanceId,
    expectedLeadId: expectation.expectedLeadId,
  });
}
