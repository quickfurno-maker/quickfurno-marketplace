import { LeadLifecycleEventType } from "../leadLifecycleEvents";
import type {
  DistributionValidationResult,
  LeadDistributionAuthorizationExpectation,
  LeadDistributionAuthorizationSnapshot,
  LeadDistributionRecommendationEventPort,
} from "./leadDistributionTypes";
import {
  LeadDistributionAuthorizationSource,
} from "./leadDistributionTypes";
import { validateApprovedEventSnapshot } from "./leadDistributionValidation";
import { validateAutoAuthorizedEventSnapshot } from "./leadDistributionAutoAuthorizationValidation";

/**
 * Neutral authorization resolver (Phase 4B-1 contract only).
 *
 * Loads the exact durable authorization event by id and maps either:
 * - lead.distribution.approved -> human_approval snapshot
 * - lead.distribution.auto_authorized -> policy_auto_authorization snapshot
 *
 * It never reruns matching, reranks, assigns vendors, mutates credits, or
 * publishes events. Phase 3B execution continues to use the existing approved
 * resolver until Phase 4B-2.
 */
export async function resolveLeadDistributionAuthorizationSnapshot(
  expectation: LeadDistributionAuthorizationExpectation,
  port: LeadDistributionRecommendationEventPort,
): Promise<DistributionValidationResult<LeadDistributionAuthorizationSnapshot>> {
  const eventId = expectation.authorizationEventId?.trim();
  if (!eventId) {
    return { ok: false, message: "AUTHORIZATION_EVENT_ID_REQUIRED" };
  }

  const event = await port.getDomainEventById(eventId);
  if (!event) {
    return { ok: false, message: "AUTHORIZATION_EVENT_NOT_FOUND" };
  }

  if (event.event_type === LeadLifecycleEventType.DISTRIBUTION_APPROVED) {
    const approved = validateApprovedEventSnapshot(event, {
      approvalEventId: eventId,
      expectedWorkflowInstanceId: expectation.expectedWorkflowInstanceId,
      expectedLeadId: expectation.expectedLeadId,
    });
    if (!approved.ok) return approved;
    return {
      ok: true,
      value: Object.freeze({
        authorizationEventId: approved.value.approvalEventId,
        authorizationSource: LeadDistributionAuthorizationSource.HUMAN_APPROVAL,
        recommendationEventId: approved.value.recommendationEventId,
        leadId: approved.value.leadId,
        workflowInstanceId: approved.value.workflowInstanceId,
        recommendedVendorIds: Object.freeze([...approved.value.recommendedVendorIds]),
        recommendedVendorCount: approved.value.recommendedVendorCount,
        authorizedVendorIds: Object.freeze([...approved.value.approvedVendorIds]),
        authorizedVendorCount: approved.value.approvedVendorCount,
        humanApprovedBy: approved.value.approvedBy,
        policyAudit: null,
      }),
    };
  }

  if (event.event_type === LeadLifecycleEventType.DISTRIBUTION_AUTO_AUTHORIZED) {
    return validateAutoAuthorizedEventSnapshot(event, {
      authorizationEventId: eventId,
      expectedWorkflowInstanceId: expectation.expectedWorkflowInstanceId,
      expectedLeadId: expectation.expectedLeadId,
    });
  }

  return { ok: false, message: "AUTHORIZATION_EVENT_TYPE_INVALID" };
}
