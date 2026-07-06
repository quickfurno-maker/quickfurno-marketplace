import { adminClient } from "@/lib/supabase";
import type { JsonRecord, WorkflowFailureRecord, WorkflowFailureStatus } from "./workflowPersistenceTypes";
import { classifyRetryableFailure, safeErrorMessage, sanitizeWorkflowMetadata } from "./failureRedaction";

export interface WorkflowFailureInput {
  workflowInstanceId?: string | null;
  taskId?: string | null;
  errorCode?: string | null;
  message: string;
  attemptNumber?: number;
  retryable?: boolean;
  status?: WorkflowFailureStatus;
  metadata?: JsonRecord;
}

export { classifyRetryableFailure, safeErrorMessage, sanitizeWorkflowMetadata };

export async function recordWorkflowFailure(input: WorkflowFailureInput): Promise<WorkflowFailureRecord | null> {
  const payload = {
    workflow_instance_id: input.workflowInstanceId ?? null,
    task_id: input.taskId ?? null,
    error_code: input.errorCode ?? null,
    safe_error_message: safeErrorMessage(input.message),
    attempt_number: input.attemptNumber ?? 0,
    status: input.status ?? "open",
    retryable: input.retryable ?? false,
    metadata_json: sanitizeWorkflowMetadata(input.metadata ?? {}),
  };

  const { data, error } = await adminClient()
    .from("workflow_failures")
    .insert(payload)
    .select("*")
    .maybeSingle();

  if (error || !data) return null;
  return data as WorkflowFailureRecord;
}

export async function resolveWorkflowFailure(failureId: string): Promise<boolean> {
  const { error } = await adminClient()
    .from("workflow_failures")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", failureId);
  return !error;
}
