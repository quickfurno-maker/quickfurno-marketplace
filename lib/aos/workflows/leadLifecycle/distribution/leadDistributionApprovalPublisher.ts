import type { DomainEventRecord, JsonRecord } from "../../../workflow/workflowPersistenceTypes";
import { LeadLifecycleEventType } from "../leadLifecycleEvents";
import { LEAD_ENTITY_TYPE, LEAD_LIFECYCLE_WORKFLOW_TYPE } from "../leadLifecycleStates";
import type { LeadDistributionDomainEventRepository } from "./leadDistributionTypes";

/**
 * QuickFurno Distribution Control — approval event publisher (Phase 3A).
 *
 * Publishes exactly one durable `lead.distribution.approved` event per approval
 * decision, keyed by a DEDICATED human-approval idempotency key that is distinct
 * from the Phase 2B task-result key. This publisher never assigns vendors,
 * deducts credits, or sends any external message — it only records the durable
 * approval decision. First valid approval wins for a recommendation snapshot.
 */

export interface PublishLeadDistributionApprovedInput {
  workflowInstanceId: string;
  leadId: string;
  recommendationEventId: string;
  recommendedVendorCount: number;
  recommendedVendorIds: readonly string[];
  approvedVendorIds: readonly string[];
  approvedBy: string;
  reason?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
}

export interface LeadDistributionApprovalPublisher {
  publish(input: PublishLeadDistributionApprovedInput): Promise<DomainEventRecord>;
}

/**
 * Deterministic human-approval idempotency key. NOTE: intentionally different
 * from `buildLeadLifecycleResultEventIdempotencyKey` (task-result). It is derived
 * from the workflow instance + the bound recommendation event only — no random
 * values, no timestamps.
 */
export function buildLeadDistributionApprovalIdempotencyKey(
  workflowInstanceId: string,
  recommendationEventId: string,
): string {
  const workflowId = workflowInstanceId.trim();
  const recommendationId = recommendationEventId.trim();
  if (!workflowId) throw new Error("WORKFLOW_INSTANCE_ID_REQUIRED");
  if (!recommendationId) throw new Error("RECOMMENDATION_EVENT_ID_REQUIRED");
  return `${LEAD_LIFECYCLE_WORKFLOW_TYPE}:distribution_approval:${workflowId}:${recommendationId}`;
}

export class DurableLeadDistributionApprovalPublisher implements LeadDistributionApprovalPublisher {
  constructor(private readonly repository: LeadDistributionDomainEventRepository) {}

  async publish(input: PublishLeadDistributionApprovedInput): Promise<DomainEventRecord> {
    const leadId = input.leadId.trim();
    if (!leadId) throw new Error("LEAD_ID_REQUIRED");
    if (!input.approvedBy.trim()) throw new Error("DISTRIBUTION_APPROVED_BY_REQUIRED");

    const idempotencyKey = buildLeadDistributionApprovalIdempotencyKey(
      input.workflowInstanceId,
      input.recommendationEventId,
    );

    const payload = buildApprovedPayload(input, leadId);

    try {
      return await this.repository.insert({
        eventType: LeadLifecycleEventType.DISTRIBUTION_APPROVED,
        entityType: LEAD_ENTITY_TYPE,
        entityId: leadId,
        payload,
        traceId: null,
        correlationId: input.correlationId ?? input.workflowInstanceId.trim(),
        causationId: input.causationId ?? input.recommendationEventId.trim(),
        idempotencyKey,
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const existing = await this.repository.findByIdempotencyKey(idempotencyKey);
      if (!existing) throw error;
      assertSameApprovalScope(existing, leadId, payload);
      return existing;
    }
  }
}

/**
 * Build the durable approved payload. Contains only vendor ids, counts, the
 * approver identity, and an optional approval reason — no phone number, no raw
 * client PII, no secrets.
 */
function buildApprovedPayload(input: PublishLeadDistributionApprovedInput, leadId: string): JsonRecord {
  const payload: JsonRecord = {
    workflow_type: LEAD_LIFECYCLE_WORKFLOW_TYPE,
    lead_id: leadId,
    recommendation_event_id: input.recommendationEventId.trim(),
    recommended_vendor_count: input.recommendedVendorCount,
    recommended_vendor_ids: [...input.recommendedVendorIds],
    approved_vendor_count: input.approvedVendorIds.length,
    approved_vendor_ids: [...input.approvedVendorIds],
    approved_by: input.approvedBy.trim(),
  };
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason) payload.approval_reason = reason;
  return payload;
}

function assertSameApprovalScope(
  existing: DomainEventRecord,
  expectedLeadId: string,
  expectedPayload: JsonRecord,
): void {
  const sameScope =
    existing.event_type === LeadLifecycleEventType.DISTRIBUTION_APPROVED &&
    existing.entity_type === LEAD_ENTITY_TYPE &&
    existing.entity_id === expectedLeadId &&
    stableStringify(existing.payload_json) === stableStringify(expectedPayload);

  if (!sameScope) {
    throw new Error("DISTRIBUTION_APPROVAL_IDEMPOTENCY_CONFLICT");
  }
}

function isUniqueConflict(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string; details?: string; constraint?: string };
  const text = `${maybe.message ?? ""} ${maybe.details ?? ""} ${maybe.constraint ?? ""}`.toLowerCase();
  return maybe.code === "23505" && text.includes("idempotency");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
