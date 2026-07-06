import { acquireDomainEvent, markDomainEventDeadLetter, markDomainEventFailed } from "./domainEventService";
import { recordWorkflowFailure, safeErrorMessage, classifyRetryableFailure, sanitizeWorkflowMetadata } from "./failureService";
import { beginIdempotentOperation, completeIdempotentOperation, failIdempotentOperation } from "./idempotencyService";
import { getOrCreateWorkflowInstance } from "./workflowRepository";
import type { WorkflowRegistry } from "./workflowRegistry";
import { normalizeWorkflowStatus } from "./workflowState";
import { applyWorkflowTransition } from "./workflowTransitionService";
import { validateHandlerResult } from "./workflowValidation";
import type {
  WorkflowKernelOptions,
  WorkflowKernelResult,
} from "./workflowTypes";
import type { DomainEventRecord, JsonRecord } from "./workflowPersistenceTypes";

const KERNEL_OPERATION_TYPE = "workflow_kernel.process_event";

export async function processDomainEventById(
  eventId: string,
  registry: WorkflowRegistry,
  options: WorkflowKernelOptions,
): Promise<WorkflowKernelResult> {
  let workflowId: string | null = null;
  const idempotencyKey = `workflow_kernel:event:${eventId}`;

  try {
    const event = await acquireDomainEvent(eventId, options.workerId);
    if (event.acquisition_status === "already_processed") {
      return { status: "already_processed", eventId };
    }

    const workflowType = resolveWorkflowType(event);
    const definition = registry.resolve(workflowType);
    if (!definition) {
      throw new Error("WORKFLOW_DEFINITION_NOT_FOUND");
    }

    const idempotency = await beginIdempotentOperation(
      idempotencyKey,
      KERNEL_OPERATION_TYPE,
      "domain_event",
      eventId,
    );

    if (!idempotency.was_created && idempotency.status === "completed") {
      return {
        status: "already_processed",
        eventId,
        workflowType,
        idempotency,
      };
    }

    const workflow = await getOrCreateWorkflowInstance({
      workflowType: definition.workflowType,
      entityType: event.entity_type ?? "unknown",
      entityId: event.entity_id ?? event.id,
      initialState: definition.initialState,
      status: definition.activeStatus ?? "active",
      context: {
        first_event_id: event.id,
        correlation_id: event.correlation_id,
      },
    });
    workflowId = workflow.id;

    const handlerResult = await definition.handler({
      workflow,
      event,
      definition,
      now: new Date().toISOString(),
    });

    const validation = validateHandlerResult(handlerResult);
    if (!validation.ok) {
      throw new Error(validation.message);
    }

    const targetStatus = normalizeWorkflowStatus(handlerResult.workflowStatus);
    const transition = await applyWorkflowTransition(definition, workflow, {
      workflowInstanceId: workflow.id,
      expectedState: workflow.current_state,
      expectedVersion: workflow.version,
      targetState: handlerResult.nextState,
      targetStatus,
      domainEventId: event.id,
      eventType: event.event_type,
      reason: handlerResult.reason ?? null,
      metadata: handlerResult.metadata ?? {},
      createdBy: options.createdBy ?? "workflow_kernel",
      tasks: handlerResult.tasks ?? [],
      outboxCommands: handlerResult.outboxCommands ?? [],
    });

    if (!transition.ok) {
      throw new Error(transition.code);
    }

    await completeIdempotentOperation(idempotencyKey, {
      status: "processed",
      workflow_instance_id: transition.workflow.id,
      workflow_type: transition.workflow.workflow_type,
      state: transition.workflow.current_state,
      version: transition.workflow.version,
    });

    return {
      status: "processed",
      eventId,
      workflowType,
      workflowInstance: transition.workflow,
      idempotency,
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    const retryable = classifyRetryableFailure(error);

    if (workflowId) {
      await recordWorkflowFailure({
        workflowInstanceId: workflowId,
        errorCode: codeFromError(error),
        message,
        retryable,
        status: retryable ? "open" : "dead_letter",
        metadata: sanitizeWorkflowMetadata({ eventId }),
      });
    }

    try {
      await failIdempotentOperation(idempotencyKey, {
        status: "failed",
        error: message,
      });
    } catch {
      // The idempotency row may not exist if acquisition or definition resolution failed.
    }

    try {
      if (retryable) await markDomainEventFailed(eventId, message);
      else await markDomainEventDeadLetter(eventId, message);
    } catch {
      // Preserve the original safe failure result.
    }

    return {
      status: retryable ? "failed" : "dead_letter",
      eventId,
      workflowInstance: null,
      failure: {
        code: codeFromError(error),
        message,
        retryable,
      },
    };
  }
}

export function resolveWorkflowType(event: DomainEventRecord): string {
  const payload = event.payload_json as JsonRecord;
  const fromPayload = payload.workflow_type;
  return typeof fromPayload === "string" && fromPayload.trim() ? fromPayload.trim() : event.event_type;
}

function codeFromError(error: unknown): "WORKFLOW_DEFINITION_NOT_FOUND" | "WORKFLOW_HANDLER_FAILED" | "WORKFLOW_STATE_CONFLICT" | "INVALID_TRANSITION" | "IDEMPOTENCY_CONFLICT" | "PERSISTENCE_ERROR" | "UNKNOWN" {
  const message = safeErrorMessage(error);
  if (message.includes("WORKFLOW_DEFINITION_NOT_FOUND")) return "WORKFLOW_DEFINITION_NOT_FOUND";
  if (message.includes("WORKFLOW_STATE_CONFLICT")) return "WORKFLOW_STATE_CONFLICT";
  if (message.includes("INVALID_TRANSITION")) return "INVALID_TRANSITION";
  if (message.includes("IDEMPOTENCY")) return "IDEMPOTENCY_CONFLICT";
  if (message.includes("PGRST") || message.includes("PostgREST") || message.includes("SQL")) return "PERSISTENCE_ERROR";
  if (error instanceof Error) return "WORKFLOW_HANDLER_FAILED";
  return "UNKNOWN";
}
