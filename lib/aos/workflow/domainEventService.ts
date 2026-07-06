import { adminClient } from "@/lib/supabase";
import { normalizeWorkerId } from "./workerIdentity";
import type { DomainEventRecord, JsonRecord } from "./workflowPersistenceTypes";

export interface CreateDomainEventInput {
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  payload?: JsonRecord;
  payloadVersion?: number;
  traceId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  idempotencyKey?: string | null;
  maxAttempts?: number;
}

export interface AcquiredDomainEvent extends DomainEventRecord {
  acquisition_status: "acquired" | "already_processed" | "already_processing" | "retry_not_due" | "retry_exhausted";
}

export async function createDomainEvent(input: CreateDomainEventInput): Promise<DomainEventRecord> {
  const payload = {
    event_type: input.eventType,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    payload_version: input.payloadVersion ?? 1,
    payload_json: input.payload ?? {},
    trace_id: input.traceId ?? null,
    correlation_id: input.correlationId ?? null,
    causation_id: input.causationId ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    processing_status: "pending",
    max_attempts: input.maxAttempts ?? 5,
  };

  const { data, error } = await adminClient()
    .from("domain_events")
    .insert(payload)
    .select("*")
    .maybeSingle();

  if (error || !data) throw error ?? new Error("DOMAIN_EVENT_CREATE_FAILED");
  return data as DomainEventRecord;
}

export async function getDomainEventById(id: string): Promise<DomainEventRecord | null> {
  const { data, error } = await adminClient()
    .from("domain_events")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as DomainEventRecord | null) ?? null;
}

export async function acquireDomainEvent(eventId: string, workerId: string): Promise<AcquiredDomainEvent> {
  const canonicalWorkerId = normalizeWorkerId(workerId);
  const { data, error } = await adminClient()
    .rpc("qf_acquire_domain_event", {
      p_event_id: eventId,
      p_worker_id: canonicalWorkerId,
      p_stale_lock_after: "15 minutes",
    })
    .maybeSingle();

  if (error || !data) throw error ?? new Error("DOMAIN_EVENT_ACQUIRE_FAILED");
  return data as AcquiredDomainEvent;
}

export async function scheduleDomainEventRetry(
  eventId: string,
  workerId: string,
  attemptCount: number,
  nextRetryAt: string,
): Promise<DomainEventRecord> {
  const canonicalWorkerId = normalizeWorkerId(workerId);
  const { data, error } = await adminClient()
    .rpc("qf_schedule_domain_event_retry", {
      p_event_id: eventId,
      p_worker_id: canonicalWorkerId,
      p_attempt_count: attemptCount,
      p_next_retry_at: nextRetryAt,
    })
    .maybeSingle();

  if (error || !data) throw error ?? new Error("DOMAIN_EVENT_RETRY_SCHEDULE_FAILED");
  return data as DomainEventRecord;
}

export async function markDomainEventDeadLetter(
  eventId: string,
  workerId: string,
  attemptCount: number,
): Promise<DomainEventRecord> {
  const canonicalWorkerId = normalizeWorkerId(workerId);
  const { data, error } = await adminClient()
    .rpc("qf_dead_letter_domain_event", {
      p_event_id: eventId,
      p_worker_id: canonicalWorkerId,
      p_attempt_count: attemptCount,
    })
    .maybeSingle();

  if (error || !data) throw error ?? new Error("DOMAIN_EVENT_DEAD_LETTER_FAILED");
  return data as DomainEventRecord;
}
