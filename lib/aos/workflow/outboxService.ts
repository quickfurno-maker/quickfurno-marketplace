import { adminClient } from "@/lib/supabase";
import type { OutboxEventRecord } from "./workflowPersistenceTypes";
import type { OutboxCommandRequest, RetryDecision } from "./workflowTypes";

export async function createOutboxCommand(request: OutboxCommandRequest): Promise<OutboxEventRecord> {
  const { data, error } = await adminClient()
    .from("outbox_events")
    .insert({
      command_type: request.commandType,
      entity_type: request.entityType ?? null,
      entity_id: request.entityId ?? null,
      payload_json: request.payload ?? {},
      idempotency_key: request.idempotencyKey,
      status: "pending",
    })
    .select("*")
    .maybeSingle();

  if (error || !data) throw error ?? new Error("OUTBOX_COMMAND_CREATE_FAILED");
  return data as OutboxEventRecord;
}

export async function getOutboxCommand(id: string): Promise<OutboxEventRecord | null> {
  const { data, error } = await adminClient()
    .from("outbox_events")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as OutboxEventRecord | null) ?? null;
}

export async function claimOneDueOutboxCommand(workerId: string): Promise<OutboxEventRecord | null> {
  const { data, error } = await adminClient()
    .rpc("qf_claim_due_outbox_event", {
      p_worker_id: workerId,
    })
    .maybeSingle();

  if (error) throw error;
  return (data as OutboxEventRecord | null) ?? null;
}

export async function markOutboxSent(id: string): Promise<void> {
  const { error } = await adminClient()
    .from("outbox_events")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function markOutboxCompleted(id: string): Promise<void> {
  const { error } = await adminClient()
    .from("outbox_events")
    .update({
      status: "completed",
      locked_at: null,
      locked_by: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function scheduleOutboxRetry(
  event: OutboxEventRecord,
  decision: RetryDecision,
  errorMessage: string,
): Promise<void> {
  const terminal = decision.shouldDeadLetter || !decision.shouldRetry;
  const { error } = await adminClient()
    .from("outbox_events")
    .update({
      status: terminal ? "dead_letter" : "retry_scheduled",
      attempt_count: Math.min(decision.attemptNumber, event.max_attempts),
      next_retry_at: terminal ? null : decision.nextRetryAt,
      locked_at: null,
      locked_by: null,
      last_error: errorMessage.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", event.id);
  if (error) throw error;
}

export async function markOutboxFailed(id: string, errorMessage: string): Promise<void> {
  const { error } = await adminClient()
    .from("outbox_events")
    .update({
      status: "failed",
      locked_at: null,
      locked_by: null,
      last_error: errorMessage.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function markOutboxDeadLetter(id: string, errorMessage: string): Promise<void> {
  const { error } = await adminClient()
    .from("outbox_events")
    .update({
      status: "dead_letter",
      locked_at: null,
      locked_by: null,
      last_error: errorMessage.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}
