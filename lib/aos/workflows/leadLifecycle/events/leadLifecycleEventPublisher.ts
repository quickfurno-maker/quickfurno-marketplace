import { adminClient } from "../../../../supabase";
import { LeadLifecycleEventType } from "../leadLifecycleEvents";
import { LEAD_ENTITY_TYPE, LEAD_LIFECYCLE_WORKFLOW_TYPE } from "../leadLifecycleStates";
import type { LeadLifecycleEventTypeValue } from "../leadLifecycleEvents";
import type { DomainEventRecord, JsonRecord } from "../../../workflow/workflowPersistenceTypes";
import { assertNoManualReviewResolution, withWorkflowPayloadIdentity } from "./leadLifecycleResultMapper";

export interface PublishLeadLifecycleEventInput {
  workflowTaskId: string;
  leadId: string;
  eventType: LeadLifecycleEventTypeValue;
  payload?: JsonRecord;
  correlationId?: string | null;
  causationId?: string | null;
  traceId?: string | null;
}

export interface LeadLifecycleEventPublisher {
  publish(input: PublishLeadLifecycleEventInput): Promise<DomainEventRecord>;
}

export interface LeadLifecycleDomainEventRepository {
  insert(input: {
    eventType: LeadLifecycleEventTypeValue;
    entityType: string;
    entityId: string;
    payload: JsonRecord;
    traceId: string | null;
    correlationId: string | null;
    causationId: string | null;
    idempotencyKey: string;
  }): Promise<DomainEventRecord>;
  findByIdempotencyKey(idempotencyKey: string): Promise<DomainEventRecord | null>;
}

export class DurableLeadLifecycleEventPublisher implements LeadLifecycleEventPublisher {
  constructor(private readonly repository: LeadLifecycleDomainEventRepository = new SupabaseLeadLifecycleDomainEventRepository()) {}

  async publish(input: PublishLeadLifecycleEventInput): Promise<DomainEventRecord> {
    const leadId = input.leadId.trim();
    if (!leadId) throw new Error("LEAD_ID_REQUIRED");

    const payload = withWorkflowPayloadIdentity(input.payload ?? {}, leadId);
    assertLifecycleIdentity(input.eventType, leadId, payload);
    assertNoManualReviewResolution({ eventType: input.eventType, payload });

    const idempotencyKey = buildLeadLifecycleResultEventIdempotencyKey(
      input.workflowTaskId,
    );

    try {
      return await this.repository.insert({
        eventType: input.eventType,
        entityType: LEAD_ENTITY_TYPE,
        entityId: leadId,
        payload,
        correlationId: input.correlationId ?? null,
        causationId: input.causationId ?? null,
        traceId: input.traceId ?? null,
        idempotencyKey,
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const existing = await this.repository.findByIdempotencyKey(idempotencyKey);
      if (!existing) throw error;
      assertExistingEventScope(existing, input.eventType, leadId, payload);
      return existing;
    }
  }
}

export function buildLeadLifecycleResultEventIdempotencyKey(
  workflowTaskId: string,
): string {
  const taskId = workflowTaskId.trim();
  if (!taskId) throw new Error("WORKFLOW_TASK_ID_REQUIRED");
  return `${LEAD_LIFECYCLE_WORKFLOW_TYPE}:task_result:${taskId}`;
}

function assertLifecycleIdentity(
  eventType: LeadLifecycleEventTypeValue,
  leadId: string,
  payload: JsonRecord,
): void {
  if (eventType === LeadLifecycleEventType.MANUAL_REVIEW_RESOLVED) {
    throw new Error("PHASE_2B_MUST_NOT_GENERATE_MANUAL_REVIEW_RESOLVED");
  }
  if (payload.workflow_type !== LEAD_LIFECYCLE_WORKFLOW_TYPE) {
    throw new Error("LEAD_LIFECYCLE_WORKFLOW_TYPE_REQUIRED");
  }
  if (payload.lead_id !== leadId) {
    throw new Error("LEAD_LIFECYCLE_EVENT_LEAD_ID_MISMATCH");
  }
}

class SupabaseLeadLifecycleDomainEventRepository implements LeadLifecycleDomainEventRepository {
  async insert(input: {
    eventType: LeadLifecycleEventTypeValue;
    entityType: string;
    entityId: string;
    payload: JsonRecord;
    traceId: string | null;
    correlationId: string | null;
    causationId: string | null;
    idempotencyKey: string;
  }): Promise<DomainEventRecord> {
    const { data, error } = await adminClient()
      .from("domain_events")
      .insert({
        event_type: input.eventType,
        entity_type: input.entityType,
        entity_id: input.entityId,
        payload_version: 1,
        payload_json: input.payload,
        trace_id: input.traceId,
        correlation_id: input.correlationId,
        causation_id: input.causationId,
        idempotency_key: input.idempotencyKey,
        processing_status: "pending",
        max_attempts: 5,
      })
      .select("*")
      .maybeSingle();

    if (error || !data) throw error ?? new Error("DOMAIN_EVENT_CREATE_FAILED");
    return data as DomainEventRecord;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<DomainEventRecord | null> {
    const { data, error } = await adminClient()
      .from("domain_events")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error) throw error;
    return (data as DomainEventRecord | null) ?? null;
  }
}

function assertExistingEventScope(
  existing: DomainEventRecord,
  expectedEventType: LeadLifecycleEventTypeValue,
  expectedLeadId: string,
  expectedPayload: JsonRecord,
): void {
  const sameScope =
    existing.event_type === expectedEventType &&
    existing.entity_type === LEAD_ENTITY_TYPE &&
    existing.entity_id === expectedLeadId &&
    stableStringify(existing.payload_json) === stableStringify(expectedPayload);

  if (!sameScope) {
    throw new Error("DOMAIN_EVENT_IDEMPOTENCY_CONFLICT");
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
