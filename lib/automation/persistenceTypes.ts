// ============================================================================
// QuickFurno — QF-MVP-50.1B durable automation persistence types
// ============================================================================

import type {
  AutomationAuditActorType,
  AutomationRequestSource,
  AutomationResultClassification,
} from "./actionContract";

export type AutomationActionDecisionStatus =
  | "requested"
  | "authorized"
  | "rejected";

export type AutomationJobStatus =
  | "pending"
  | "processing"
  | "retry_scheduled"
  | "succeeded"
  | "failed"
  | "uncertain"
  | "dead_letter"
  | "cancelled";

export type AutomationAttemptStatus = "started" | "completed";

export interface AutomationActionRequestRow {
  id: string;
  contract_version: number;
  action_type: string;
  entity_type: string;
  entity_id: string;

  source: AutomationRequestSource;
  requested_by_type: AutomationAuditActorType;
  requested_by_id: string;
  requested_at: string;

  idempotency_key: string;
  correlation_id: string;
  safe_context: Record<string, unknown>;

  decision_status: AutomationActionDecisionStatus;
  decision_id: string | null;
  decision_at: string | null;
  decision_actor_type: "core_service" | "admin_user" | null;
  decision_actor_id: string | null;
  decision_reason_code: string | null;

  created_at: string;
  updated_at: string;
}

export interface AutomationJobRow {
  id: string;
  action_request_id: string;
  status: AutomationJobStatus;
  available_at: string;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  last_result_classification: AutomationResultClassification | null;
  last_safe_code: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationExecutionAttemptRow {
  id: string;
  job_id: string;
  attempt_number: number;
  worker_id: string;
  status: AutomationAttemptStatus;
  classification: AutomationResultClassification | null;
  safe_code: string | null;
  executor_reference: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
}

export interface ClaimedAutomationJob {
  job_id: string;
  action_request_id: string;
  attempt_id: string;
  attempt_number: number;
  max_attempts: number;
}

export interface RejectAutomationRequestInput {
  requestId: string;
  decisionId: string;
  rejectedBy: {
    actorType: "core_service" | "admin_user";
    actorId: string;
  };
  reasonCode: string;
}

export interface CreateAutomationJobInput {
  actionRequestId: string;
  maxAttempts?: number;
  availableAt?: string;
}

export interface CompleteAutomationAttemptInput {
  jobId: string;
  attemptId: string;
  workerId: string;
  classification: AutomationResultClassification;
  safeCode: string;
  executorReference?: string | null;
  nextRetryAt?: string | null;
}
