import { LeadLifecycleEventType } from "../leadLifecycleEvents";
import type {
  DistributionValidationResult,
  LeadDistributionAuthorizationExpectation,
  LeadDistributionAuthorizationSnapshot,
  LeadDistributionRecommendationEventPort,
  LeadDistributionRecommendationSnapshot,
} from "./leadDistributionTypes";
import {
  LeadDistributionAuthorizationSource,
} from "./leadDistributionTypes";
import { validateApprovedEventSnapshot } from "./leadDistributionValidation";
import { validateAutoAuthorizedEventSnapshot } from "./leadDistributionAutoAuthorizationValidation";
import { resolveLeadDistributionRecommendation } from "./leadDistributionRecommendationResolver";

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
    const auto = validateAutoAuthorizedEventSnapshot(event, {
      authorizationEventId: eventId,
      expectedWorkflowInstanceId: expectation.expectedWorkflowInstanceId,
      expectedLeadId: expectation.expectedLeadId,
    });
    if (!auto.ok) return auto;

    // Correction 2 — cross-bind the auto-authorization to the ORIGINAL immutable
    // lead.matching.completed event. An internally-consistent but forged / corrupted
    // / manually-inserted auto event must not authorize a different vendor list than
    // the authoritative matching snapshot. This never reruns matching, reranks,
    // appends, truncates, or replaces vendors — it only reads and compares.
    const recommendation = await resolveLeadDistributionRecommendation(
      {
        recommendationEventId: auto.value.recommendationEventId,
        expectedWorkflowInstanceId: expectation.expectedWorkflowInstanceId,
        expectedLeadId: expectation.expectedLeadId,
      },
      port,
    );
    if (!recommendation.ok) return recommendation;

    const bound = assertAutoAuthorizationMatchesRecommendation(auto.value, recommendation.value);
    if (!bound.ok) return bound;
    return auto;
  }

  return { ok: false, message: "AUTHORIZATION_EVENT_TYPE_INVALID" };
}

/**
 * Verify the auto-authorization snapshot exactly matches the authoritative
 * recommendation snapshot: same lead, workflow, recommendation event id,
 * recommended vendor count, and recommended vendor ids in the exact same order.
 * The authorized ids (already proven equal to the auto event's recommended ids)
 * are also cross-checked against the authoritative matching ids.
 */
function assertAutoAuthorizationMatchesRecommendation(
  auto: LeadDistributionAuthorizationSnapshot,
  recommendation: LeadDistributionRecommendationSnapshot,
): DistributionValidationResult<true> {
  if (recommendation.leadId !== auto.leadId) {
    return { ok: false, message: "AUTO_AUTH_RECOMMENDATION_SNAPSHOT_MISMATCH" };
  }
  if (recommendation.workflowInstanceId !== auto.workflowInstanceId) {
    return { ok: false, message: "AUTO_AUTH_RECOMMENDATION_SNAPSHOT_MISMATCH" };
  }
  if (recommendation.recommendationEventId !== auto.recommendationEventId) {
    return { ok: false, message: "AUTO_AUTH_RECOMMENDATION_SNAPSHOT_MISMATCH" };
  }
  if (recommendation.recommendedVendorCount !== auto.recommendedVendorCount) {
    return { ok: false, message: "AUTO_AUTH_RECOMMENDATION_SNAPSHOT_MISMATCH" };
  }
  if (recommendation.recommendedVendorIds.length !== auto.recommendedVendorIds.length) {
    return { ok: false, message: "AUTO_AUTH_RECOMMENDATION_SNAPSHOT_MISMATCH" };
  }
  for (let index = 0; index < recommendation.recommendedVendorIds.length; index += 1) {
    if (recommendation.recommendedVendorIds[index] !== auto.recommendedVendorIds[index]) {
      return { ok: false, message: "AUTO_AUTH_RECOMMENDATION_SNAPSHOT_MISMATCH" };
    }
    if (recommendation.recommendedVendorIds[index] !== auto.authorizedVendorIds[index]) {
      return { ok: false, message: "AUTO_AUTH_RECOMMENDATION_SNAPSHOT_MISMATCH" };
    }
  }
  return { ok: true, value: true };
}
