import { adminClient } from "@/lib/supabase";
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
}

export interface AcquiredDomainEvent extends DomainEventRecord {
  acquisition_status: "acquired" | "already_processed";
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
  const { data, error } = await adminClient()
    .rpc("qf_acquire_domain_event", {
      p_event_id: eventId,
      p_worker_id: workerId,
    })
    .maybeSingle();

  if (error || !data) throw error ?? new Error("DOMAIN_EVENT_ACQUIRE_FAILED");
  return data as AcquiredDomainEvent;
}

export async function markDomainEventFailed(eventId: string, message: string): Promise<void> {
  const { error } = await adminClient()
    .from("domain_events")
    .update({
      processing_status: "failed",
      updated_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    })
    .eq("id", eventId)
    .neq("processing_status", "processed");
  if (error) throw error;
}

export async function markDomainEventDeadLetter(eventId: string, message: string): Promise<void> {
  const { error } = await adminClient()
    .from("domain_events")
    .update({
      processing_status: "dead_letter",
      updated_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    })
    .eq("id", eventId)
    .neq("processing_status", "processed");
  if (error) throw error;
}
