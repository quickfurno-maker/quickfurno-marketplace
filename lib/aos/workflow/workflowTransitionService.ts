import { adminClient } from "@/lib/supabase";
import { normalizeWorkflowStatus, validateWorkflowTransition } from "./workflowState";
import type { WorkflowInstanceRecord } from "./workflowPersistenceTypes";
import type { WorkflowDefinition, WorkflowTransitionRequest } from "./workflowTypes";

export type WorkflowTransitionApplyResult =
  | { ok: true; workflow: WorkflowInstanceRecord }
  | { ok: false; code: string; message: string; retryable: boolean };

export function validateHandlerTransition(
  definition: WorkflowDefinition,
  workflow: WorkflowInstanceRecord,
  request: Pick<WorkflowTransitionRequest, "targetState" | "targetStatus">,
): WorkflowTransitionApplyResult | null {
  const validation = validateWorkflowTransition(
    definition,
    workflow.current_state,
    request.targetState,
    workflow.status,
  );

  if (!validation.ok) {
    return {
      ok: false,
      code: validation.code ?? "INVALID_TRANSITION",
      message: validation.message ?? "Invalid workflow transition.",
      retryable: false,
    };
  }

  normalizeWorkflowStatus(request.targetStatus);
  return null;
}

export async function applyWorkflowTransition(
  definition: WorkflowDefinition,
  workflow: WorkflowInstanceRecord,
  request: WorkflowTransitionRequest,
): Promise<WorkflowTransitionApplyResult> {
  const validationFailure = validateHandlerTransition(definition, workflow, request);
  if (validationFailure) return validationFailure;

  const { data, error } = await adminClient()
    .rpc("qf_apply_workflow_step", {
      p_workflow_instance_id: request.workflowInstanceId,
      p_expected_state: request.expectedState,
      p_expected_version: request.expectedVersion,
      p_target_state: request.targetState,
      p_target_status: request.targetStatus,
      p_domain_event_id: request.domainEventId,
      p_event_type: request.eventType,
      p_reason: request.reason ?? null,
      p_transition_metadata: request.metadata ?? {},
      p_created_by: request.createdBy ?? "workflow_kernel",
      p_next_tasks: (request.tasks ?? []).map((task) => ({
        task_type: task.taskType,
        payload_json: task.payload ?? {},
        idempotency_key: task.idempotencyKey ?? null,
        due_at: task.dueAt ?? null,
        priority: task.priority ?? 100,
        max_attempts: task.maxAttempts ?? 5,
      })),
      p_outbox_commands: (request.outboxCommands ?? []).map((command) => ({
        command_type: command.commandType,
        payload_json: command.payload ?? {},
        idempotency_key: command.idempotencyKey,
        entity_type: command.entityType ?? null,
        entity_id: command.entityId ?? null,
      })),
    })
    .maybeSingle();

  if (error || !data) {
    const message = error?.message ?? "Workflow transition failed.";
    const stateConflict = /WORKFLOW_STATE_CONFLICT|DOMAIN_EVENT_PROCESSING_STATE_CONFLICT/i.test(message);
    return {
      ok: false,
      code: stateConflict ? "WORKFLOW_STATE_CONFLICT" : "PERSISTENCE_ERROR",
      message,
      retryable: stateConflict,
    };
  }

  return { ok: true, workflow: data as WorkflowInstanceRecord };
}

