import {
  markWorkflowTaskCompleted,
  scheduleWorkflowTaskRetry,
} from "../../../workflow/workflowTaskService";
import {
  classifyRetryableFailure,
  recordWorkflowFailure,
  safeErrorMessage,
  sanitizeWorkflowMetadata,
} from "../../../workflow/failureService";
import { calculateRetryDecision, createRetryPolicyConfig } from "../../../workflow/retryPolicy";
import type { WorkflowTaskRecord } from "../../../workflow/workflowPersistenceTypes";
import {
  executeLeadLifecycleTask,
  type LeadLifecycleTaskExecutorDeps,
} from "./leadLifecycleTaskExecutor";
import type { LeadLifecycleTaskExecutionResult } from "./leadLifecycleTaskExecutionTypes";

export async function executeClaimedLeadLifecycleTask(
  task: WorkflowTaskRecord,
  workerId: string,
  deps: LeadLifecycleTaskExecutorDeps,
): Promise<LeadLifecycleTaskExecutionResult> {
  try {
    const result = await executeLeadLifecycleTask(task, deps);
    await markWorkflowTaskCompleted(task.id, workerId, {
      ...result.result,
      execution_status: result.status,
      task_type: result.task_type,
    });
    return result;
  } catch (error) {
    const message = safeErrorMessage(error);
    const retryable = classifyRetryableFailure(error);
    const retryConfig = createRetryPolicyConfig(task.max_attempts);
    const decision = calculateRetryDecision(task.attempt_count, retryable, new Date(), retryConfig);

    await recordWorkflowFailure({
      workflowInstanceId: task.workflow_instance_id,
      taskId: task.id,
      errorCode: codeFromError(error),
      message,
      retryable,
      status: decision.shouldRetry ? "retry_scheduled" : "dead_letter",
      attemptNumber: decision.attemptNumber,
      metadata: sanitizeWorkflowMetadata({
        task_type: task.task_type,
        worker_id: workerId,
        retry_reason: decision.reason,
      }),
    });

    await scheduleWorkflowTaskRetry(task, workerId, decision, message);
    throw error;
  }
}

function codeFromError(error: unknown): string {
  const message = safeErrorMessage(error);
  if (message.includes("VALIDATION") || message.includes("REQUIRED") || message.includes("MISMATCH")) {
    return "LEAD_LIFECYCLE_TASK_VALIDATION";
  }
  if (message.includes("IDEMPOTENCY_CONFLICT")) return "DOMAIN_EVENT_IDEMPOTENCY_CONFLICT";
  return "LEAD_LIFECYCLE_TASK_EXECUTION_FAILED";
}
