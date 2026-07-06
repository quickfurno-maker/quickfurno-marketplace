import type {
  DomainEventRecord,
  IdempotencyRecord,
  JsonRecord,
  WorkflowInstanceRecord,
  WorkflowStatus,
} from "./workflowPersistenceTypes";

export type WorkflowKernelStatus =
  | "processed"
  | "already_processed"
  | "already_processing"
  | "retry_not_due"
  | "failed"
  | "dead_letter"
  | "skipped";

export type WorkflowKernelFailureCode =
  | "DOMAIN_EVENT_NOT_FOUND"
  | "DOMAIN_EVENT_NOT_PROCESSABLE"
  | "DOMAIN_EVENT_OWNERSHIP_CONFLICT"
  | "WORKFLOW_DEFINITION_NOT_FOUND"
  | "WORKFLOW_HANDLER_FAILED"
  | "WORKFLOW_STATE_CONFLICT"
  | "INVALID_TRANSITION"
  | "INVALID_HANDLER_RESULT"
  | "IDEMPOTENCY_CONFLICT"
  | "PERSISTENCE_ERROR"
  | "UNKNOWN";

export interface WorkflowTaskRequest {
  taskType: string;
  payload?: JsonRecord;
  idempotencyKey?: string | null;
  dueAt?: string | null;
  priority?: number;
  maxAttempts?: number;
}

export interface OutboxCommandRequest {
  commandType: string;
  payload?: JsonRecord;
  idempotencyKey: string;
  entityType?: string | null;
  entityId?: string | null;
}

export interface WorkflowHandlerResult {
  nextState: string;
  workflowStatus?: WorkflowStatus;
  reason?: string | null;
  metadata?: JsonRecord;
  tasks?: WorkflowTaskRequest[];
  outboxCommands?: OutboxCommandRequest[];
}

export interface WorkflowHandlerContext {
  workflow: WorkflowInstanceRecord;
  event: DomainEventRecord;
  definition: WorkflowDefinition;
  now: string;
}

export type WorkflowHandler = (context: WorkflowHandlerContext) => Promise<WorkflowHandlerResult> | WorkflowHandlerResult;

export interface WorkflowDefinition {
  workflowType: string;
  initialState: string;
  activeStatus?: WorkflowStatus;
  terminalStates?: string[];
  transitions: Record<string, string[]>;
  handler: WorkflowHandler;
}

export interface WorkflowTransitionRequest {
  workflowInstanceId: string;
  expectedState: string;
  expectedVersion: number;
  targetState: string;
  targetStatus: WorkflowStatus;
  domainEventId: string;
  eventType: string;
  workerId: string;
  reason?: string | null;
  metadata?: JsonRecord;
  createdBy?: string | null;
  tasks?: WorkflowTaskRequest[];
  outboxCommands?: OutboxCommandRequest[];
  idempotencyKey?: string | null;
  idempotencyResult?: JsonRecord;
}

export interface WorkflowKernelFailure {
  code: WorkflowKernelFailureCode;
  message: string;
  retryable: boolean;
  metadata?: JsonRecord;
}

export interface WorkflowKernelResult {
  status: WorkflowKernelStatus;
  eventId: string;
  workflowType?: string;
  workflowInstance?: WorkflowInstanceRecord | null;
  idempotency?: IdempotencyRecord | null;
  failure?: WorkflowKernelFailure;
}

export interface RetryDecision {
  shouldRetry: boolean;
  shouldDeadLetter: boolean;
  attemptNumber: number;
  nextRetryAt: string | null;
  reason: string;
}

export interface WorkflowKernelOptions {
  workerId: string;
  createdBy?: string;
}
