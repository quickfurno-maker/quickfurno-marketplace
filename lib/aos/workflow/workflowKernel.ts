import { acquireDomainEvent, markDomainEventDeadLetter, scheduleDomainEventRetry } from "./domainEventService";
import { recordWorkflowFailure, safeErrorMessage, classifyRetryableFailure, sanitizeWorkflowMetadata } from "./failureService";
import { beginIdempotentOperation, failIdempotentOperation } from "./idempotencyService";
import { calculateRetryDecision } from "./retryPolicy";
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
  let acquiredEvent: DomainEventRecord | null = null;
  let ownsEvent = false;
  let idempotencyStarted = false;
  let stepCommitted = false;
  const idempotencyKey = `workflow_kernel:event:${eventId}`;

  try {
    const event = await acquireDomainEvent(eventId, options.workerId);
    if (event.acquisition_status === "already_processed") {
      return { status: "already_processed", eventId };
    }
    if (event.acquisition_status === "already_processing") {
      return { status: "already_processing", eventId, workflowInstance: null };
    }
    if (event.acquisition_status === "retry_not_due") {
      return { status: "retry_not_due", eventId, workflowInstance: null };
    }

    acquiredEvent = event;
    ownsEvent = event.locked_by === options.workerId && event.processing_status === "processing";

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
    idempotencyStarted = true;

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
      workerId: options.workerId,
      reason: handlerResult.reason ?? null,
      metadata: handlerResult.metadata ?? {},
      createdBy: options.createdBy ?? "workflow_kernel",
      tasks: handlerResult.tasks ?? [],
      outboxCommands: handlerResult.outboxCommands ?? [],
      idempotencyKey,
      idempotencyResult: {
        status: "processed",
        workflow_instance_id: workflow.id,
        workflow_type: workflow.workflow_type,
        next_state: handlerResult.nextState,
      },
    });

    if (!transition.ok) {
      throw new Error(transition.code);
    }
    stepCommitted = true;

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
    const retryDecision = calculateRetryDecision(acquiredEvent?.attempt_count ?? 0, retryable);

    if (workflowId) {
      await recordWorkflowFailure({
        workflowInstanceId: workflowId,
        errorCode: codeFromError(error),
        message,
        retryable,
        status: retryDecision.shouldRetry ? "retry_scheduled" : "dead_letter",
        attemptNumber: retryDecision.attemptNumber,
        metadata: sanitizeWorkflowMetadata({ eventId, workerId: options.workerId, retry_reason: retryDecision.reason }),
      });
    }

    if (idempotencyStarted && !stepCommitted) {
      try {
        await failIdempotentOperation(idempotencyKey, {
          status: "failed",
          error: message,
        });
      } catch {
        // Preserve the original safe failure result.
      }
    }

    if (ownsEvent && acquiredEvent && !stepCommitted && acquiredEvent.processing_status !== "processed") {
      try {
        if (retryDecision.shouldRetry && retryDecision.nextRetryAt) {
          await scheduleDomainEventRetry(eventId, options.workerId, retryDecision.attemptNumber, retryDecision.nextRetryAt);
        } else {
          await markDomainEventDeadLetter(eventId, options.workerId, retryDecision.attemptNumber);
        }
      } catch {
        // Preserve the original safe failure result.
      }
    }

    return {
      status: retryDecision.shouldRetry ? "failed" : "dead_letter",
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

function codeFromError(error: unknown): "WORKFLOW_DEFINITION_NOT_FOUND" | "WORKFLOW_HANDLER_FAILED" | "WORKFLOW_STATE_CONFLICT" | "INVALID_TRANSITION" | "IDEMPOTENCY_CONFLICT" | "DOMAIN_EVENT_OWNERSHIP_CONFLICT" | "PERSISTENCE_ERROR" | "UNKNOWN" {
  const message = safeErrorMessage(error);
  if (message.includes("WORKFLOW_DEFINITION_NOT_FOUND")) return "WORKFLOW_DEFINITION_NOT_FOUND";
  if (message.includes("WORKFLOW_STATE_CONFLICT")) return "WORKFLOW_STATE_CONFLICT";
  if (message.includes("DOMAIN_EVENT_OWNERSHIP_CONFLICT")) return "DOMAIN_EVENT_OWNERSHIP_CONFLICT";
  if (message.includes("INVALID_TRANSITION")) return "INVALID_TRANSITION";
  if (message.includes("IDEMPOTENCY")) return "IDEMPOTENCY_CONFLICT";
  if (message.includes("PGRST") || message.includes("PostgREST") || message.includes("SQL")) return "PERSISTENCE_ERROR";
  if (error instanceof Error) return "WORKFLOW_HANDLER_FAILED";
  return "UNKNOWN";
}
