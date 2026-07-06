import { adminClient } from "@/lib/supabase";
import type { JsonRecord, WorkflowTaskRecord } from "./workflowPersistenceTypes";
import type { RetryDecision, WorkflowTaskRequest } from "./workflowTypes";

export async function enqueueWorkflowTask(
  workflowInstanceId: string,
  request: WorkflowTaskRequest,
): Promise<WorkflowTaskRecord> {
  const { data, error } = await adminClient()
    .from("workflow_tasks")
    .insert({
      workflow_instance_id: workflowInstanceId,
      task_type: request.taskType,
      status: "pending",
      priority: request.priority ?? 100,
      due_at: request.dueAt ?? new Date().toISOString(),
      max_attempts: request.maxAttempts ?? 5,
      idempotency_key: request.idempotencyKey ?? null,
      payload_json: request.payload ?? {},
    })
    .select("*")
    .maybeSingle();

  if (error || !data) throw error ?? new Error("WORKFLOW_TASK_ENQUEUE_FAILED");
  return data as WorkflowTaskRecord;
}

export async function claimOneDueWorkflowTask(workerId: string): Promise<WorkflowTaskRecord | null> {
  const { data, error } = await adminClient()
    .rpc("qf_claim_due_workflow_task", {
      p_worker_id: workerId,
    })
    .maybeSingle();

  if (error) throw error;
  return (data as WorkflowTaskRecord | null) ?? null;
}

export async function markWorkflowTaskCompleted(taskId: string, workerId: string, result: JsonRecord = {}): Promise<void> {
  const { data, error } = await adminClient()
    .from("workflow_tasks")
    .update({
      status: "completed",
      result_json: result,
      locked_at: null,
      locked_by: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .eq("status", "processing")
    .eq("locked_by", workerId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("WORKFLOW_TASK_OWNERSHIP_CONFLICT");
}

export async function scheduleWorkflowTaskRetry(
  task: WorkflowTaskRecord,
  workerId: string,
  decision: RetryDecision,
  errorMessage: string,
): Promise<void> {
  const nextAttemptCount = Math.min(decision.attemptNumber, task.max_attempts);
  const terminal = decision.shouldDeadLetter || !decision.shouldRetry;
  const { data, error } = await adminClient()
    .from("workflow_tasks")
    .update({
      status: terminal ? "dead_letter" : "retry_scheduled",
      attempt_count: nextAttemptCount,
      next_retry_at: terminal ? null : decision.nextRetryAt,
      locked_at: null,
      locked_by: null,
      last_error: errorMessage.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id)
    .eq("status", "processing")
    .eq("locked_by", workerId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("WORKFLOW_TASK_OWNERSHIP_CONFLICT");
}

export async function markWorkflowTaskFailed(taskId: string, workerId: string, errorMessage: string): Promise<void> {
  const { data, error } = await adminClient()
    .from("workflow_tasks")
    .update({
      status: "failed",
      locked_at: null,
      locked_by: null,
      last_error: errorMessage.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .eq("status", "processing")
    .eq("locked_by", workerId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("WORKFLOW_TASK_OWNERSHIP_CONFLICT");
}

export async function markWorkflowTaskDeadLetter(taskId: string, workerId: string, errorMessage: string): Promise<void> {
  const { data, error } = await adminClient()
    .from("workflow_tasks")
    .update({
      status: "dead_letter",
      locked_at: null,
      locked_by: null,
      last_error: errorMessage.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .eq("status", "processing")
    .eq("locked_by", workerId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("WORKFLOW_TASK_OWNERSHIP_CONFLICT");
}

export async function inspectStaleProcessingTasks(olderThanIso: string, limit = 25): Promise<WorkflowTaskRecord[]> {
  const { data, error } = await adminClient()
    .from("workflow_tasks")
    .select("*")
    .eq("status", "processing")
    .lt("locked_at", olderThanIso)
    .order("locked_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as WorkflowTaskRecord[];
}
