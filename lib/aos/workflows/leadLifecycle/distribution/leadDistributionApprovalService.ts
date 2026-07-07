import type { DomainEventRecord } from "../../../workflow/workflowPersistenceTypes";
import { LEAD_ENTITY_TYPE, LeadLifecycleState, LEAD_LIFECYCLE_WORKFLOW_TYPE } from "../leadLifecycleStates";
import {
  MAX_DISTRIBUTION_VENDORS,
  type ApproveLeadDistributionInput,
  type LeadDistributionRecommendationEventPort,
  type LeadDistributionRecommendationSnapshot,
  type LeadDistributionRoutingPort,
  type LeadDistributionWorkflowStatePort,
} from "./leadDistributionTypes";
import { resolveLeadDistributionRecommendation } from "./leadDistributionRecommendationResolver";
import { resolveLeadDistributionRoute } from "./leadDistributionRouteGuard";
import { isApprovedSubsetPreservingOrder, normalizeVendorIdList } from "./leadDistributionValidation";
import type { LeadDistributionApprovalPublisher } from "./leadDistributionApprovalPublisher";

/**
 * QuickFurno Distribution Control — human approval command (Phase 3A).
 *
 * A callable BACKEND domain service (not a UI route). It records an explicit,
 * auditable human distribution approval as a durable `lead.distribution.approved`
 * event. It performs NO assignment, NO credit mutation, NO delivery, NO WhatsApp,
 * and NO n8n. Special routing paths (preferred-vendor, requirement-group) must
 * not use this service and are rejected.
 */

export class LeadDistributionApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadDistributionApprovalError";
  }
}

export interface LeadDistributionApprovalServiceDeps {
  recommendationEventPort: LeadDistributionRecommendationEventPort;
  routingPort: LeadDistributionRoutingPort;
  workflowStatePort: LeadDistributionWorkflowStatePort;
  approvalPublisher: LeadDistributionApprovalPublisher;
}

export interface LeadDistributionApprovalResult {
  event: DomainEventRecord;
  approvedVendorIds: string[];
  snapshot: LeadDistributionRecommendationSnapshot;
}

function requireText(value: string | undefined | null, code: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new LeadDistributionApprovalError(code);
  }
  return value.trim();
}

export async function approveLeadDistribution(
  input: ApproveLeadDistributionInput,
  deps: LeadDistributionApprovalServiceDeps,
): Promise<LeadDistributionApprovalResult> {
  const workflowInstanceId = requireText(input.workflowInstanceId, "DISTRIBUTION_WORKFLOW_INSTANCE_ID_REQUIRED");
  const leadId = requireText(input.leadId, "DISTRIBUTION_LEAD_ID_REQUIRED");
  const recommendationEventId = requireText(input.recommendationEventId, "DISTRIBUTION_RECOMMENDATION_EVENT_ID_REQUIRED");

  // 1. approvedBy — required, trimmed, non-empty.
  const approvedBy = requireText(input.approvedBy, "DISTRIBUTION_APPROVED_BY_REQUIRED");

  // 2. approvedVendorIds — array, 1..3, unique, non-empty strings.
  const normalizedApproved = normalizeVendorIdList(input.approvedVendorIds, "DISTRIBUTION_APPROVED_IDS_REQUIRED");
  if (!normalizedApproved.ok) {
    throw new LeadDistributionApprovalError(normalizedApproved.message);
  }
  const approvedVendorIds = normalizedApproved.value;
  if (approvedVendorIds.length < 1 || approvedVendorIds.length > MAX_DISTRIBUTION_VENDORS) {
    throw new LeadDistributionApprovalError("DISTRIBUTION_APPROVED_COUNT_INVALID");
  }

  // 3. Bind to the immutable recommendation snapshot (same lead, same workflow).
  const resolved = await resolveLeadDistributionRecommendation(
    { recommendationEventId, expectedWorkflowInstanceId: workflowInstanceId, expectedLeadId: leadId },
    deps.recommendationEventPort,
  );
  if (!resolved.ok) {
    throw new LeadDistributionApprovalError(resolved.message);
  }
  const snapshot = resolved.value;
  if (snapshot.recommendedVendorCount < 1) {
    throw new LeadDistributionApprovalError("DISTRIBUTION_NO_RECOMMENDATIONS_TO_APPROVE");
  }

  // 4. approved IDs must be a subset of recommended IDs preserving recommendation order.
  const subset = isApprovedSubsetPreservingOrder(snapshot.recommendedVendorIds, approvedVendorIds);
  if (!subset.ok) {
    throw new LeadDistributionApprovalError(subset.message);
  }

  // 5. Special routing paths must not use this approval service.
  const route = await resolveLeadDistributionRoute(leadId, deps.routingPort);
  if (!route.isStandardRoute) {
    throw new LeadDistributionApprovalError("DISTRIBUTION_SPECIAL_ROUTE_NOT_ALLOWED");
  }

  // 6. Authoritative workflow state must be DISTRIBUTION_APPROVAL_PENDING.
  const workflow = await deps.workflowStatePort.getWorkflowInstanceById(workflowInstanceId);
  if (!workflow) {
    throw new LeadDistributionApprovalError("DISTRIBUTION_WORKFLOW_NOT_FOUND");
  }
  if (workflow.workflow_type !== LEAD_LIFECYCLE_WORKFLOW_TYPE) {
    throw new LeadDistributionApprovalError("DISTRIBUTION_WORKFLOW_TYPE_MISMATCH");
  }
  if (workflow.entity_type !== LEAD_ENTITY_TYPE || workflow.entity_id !== leadId) {
    throw new LeadDistributionApprovalError("DISTRIBUTION_WORKFLOW_LEAD_MISMATCH");
  }
  if (workflow.current_state !== LeadLifecycleState.DISTRIBUTION_APPROVAL_PENDING) {
    throw new LeadDistributionApprovalError("DISTRIBUTION_WORKFLOW_STATE_NOT_APPROVAL_PENDING");
  }

  // 7. Publish the durable approved event under the dedicated human-approval key.
  const event = await deps.approvalPublisher.publish({
    workflowInstanceId,
    leadId,
    recommendationEventId: snapshot.recommendationEventId,
    recommendedVendorCount: snapshot.recommendedVendorCount,
    recommendedVendorIds: snapshot.recommendedVendorIds,
    approvedVendorIds,
    approvedBy,
    reason: input.reason,
    correlationId: workflowInstanceId,
    causationId: snapshot.recommendationEventId,
  });

  return { event, approvedVendorIds, snapshot };
}
