import { adminClient } from "@/lib/supabase";
import type { IdempotencyRecord, JsonRecord } from "./workflowPersistenceTypes";

export interface IdempotencyBeginResult extends IdempotencyRecord {
  was_created: boolean;
}

export async function beginIdempotentOperation(
  idempotencyKey: string,
  operationType: string,
  entityType?: string | null,
  entityId?: string | null,
): Promise<IdempotencyBeginResult> {
  const { data, error } = await adminClient()
    .rpc("qf_begin_idempotent_operation", {
      p_idempotency_key: idempotencyKey,
      p_operation_type: operationType,
      p_entity_type: entityType ?? null,
      p_entity_id: entityId ?? null,
    })
    .maybeSingle();

  if (error || !data) throw error ?? new Error("IDEMPOTENCY_BEGIN_FAILED");
  return data as IdempotencyBeginResult;
}

export async function getIdempotencyRecord(idempotencyKey: string): Promise<IdempotencyRecord | null> {
  const { data, error } = await adminClient()
    .from("idempotency_records")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  return (data as IdempotencyRecord | null) ?? null;
}

export async function completeIdempotentOperation(idempotencyKey: string, result: JsonRecord): Promise<void> {
  const { error } = await adminClient()
    .from("idempotency_records")
    .update({
      status: "completed",
      result_json: result,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("idempotency_key", idempotencyKey);

  if (error) throw error;
}

export async function failIdempotentOperation(idempotencyKey: string, result: JsonRecord): Promise<void> {
  const { error } = await adminClient()
    .from("idempotency_records")
    .update({
      status: "failed",
      result_json: result,
      updated_at: new Date().toISOString(),
    })
    .eq("idempotency_key", idempotencyKey);

  if (error) throw error;
}

export function isIdempotencyScopeMismatch(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? "";
  return message.includes("IDEMPOTENCY_KEY_SCOPE_MISMATCH");
}

