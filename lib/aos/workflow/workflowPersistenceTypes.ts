export type JsonRecord = Record<string, unknown>;

export type WorkflowStatus =
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowTaskStatus =
  | "pending"
  | "processing"
  | "completed"
  | "retry_scheduled"
  | "failed"
  | "dead_letter"
  | "cancelled";

export type DomainEventStatus =
  | "pending"
  | "processing"
  | "processed"
  | "failed"
  | "dead_letter";

export type OutboxStatus =
  | "pending"
  | "processing"
  | "sent"
  | "completed"
  | "retry_scheduled"
  | "failed"
  | "dead_letter"
  | "cancelled";

export type WorkflowFailureStatus =
  | "open"
  | "retry_scheduled"
  | "resolved"
  | "dead_letter";

export type IdempotencyStatus = "started" | "completed" | "failed";

export interface WorkflowInstanceRecord {
  id: string;
  workflow_type: string;
  entity_type: string;
  entity_id: string;
  current_state: string;
  status: WorkflowStatus;
  version: number;
  context_json: JsonRecord;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface WorkflowTaskRecord {
  id: string;
  workflow_instance_id: string;
  task_type: string;
  status: WorkflowTaskStatus;
  priority: number;
  due_at: string;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  idempotency_key: string | null;
  payload_json: JsonRecord;
  result_json: JsonRecord;
  last_error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface DomainEventRecord {
  id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload_version: number;
  payload_json: JsonRecord;
  trace_id: string | null;
  correlation_id: string | null;
  causation_id: string | null;
  idempotency_key: string | null;
  processing_status: DomainEventStatus;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutboxEventRecord {
  id: string;
  command_type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload_json: JsonRecord;
  idempotency_key: string;
  status: OutboxStatus;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  completed_at: string | null;
  last_error: string | null;
}

export interface WorkflowFailureRecord {
  id: string;
  workflow_instance_id: string | null;
  task_id: string | null;
  error_code: string | null;
  safe_error_message: string;
  attempt_number: number;
  status: WorkflowFailureStatus;
  retryable: boolean;
  metadata_json: JsonRecord;
  created_at: string;
  resolved_at: string | null;
}

export interface IdempotencyRecord {
  id: string;
  idempotency_key: string;
  operation_type: string;
  entity_type: string | null;
  entity_id: string | null;
  status: IdempotencyStatus;
  result_json: JsonRecord;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface WorkflowTransitionRecord {
  id: string;
  workflow_instance_id: string;
  from_state: string | null;
  to_state: string;
  event_type: string | null;
  reason: string | null;
  metadata_json: JsonRecord;
  created_by: string | null;
  created_at: string;
}
