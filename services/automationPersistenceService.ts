// ============================================================================
// QuickFurno — QF-MVP-50.1B durable automation persistence service
//
// Server-only Core boundary. No network/provider/n8n call exists here.
// All mutations go through service-role-only database RPCs.
// ============================================================================

import { adminClient } from "@/lib/supabase";
import {
  AUTOMATION_CONTRACT_VERSION,
  buildAutomationJobEnvelope,
  isAutomaticRetryAllowed,
  validateCoreActionRequestEnvelope,
  type AutomationAuditActor,
  type CoreActionRequest,
  type CoreAuthorizedAction,
} from "@/lib/automation/actionContract";
import {
  canSourceRequestAction,
  isAutomationActionType,
} from "@/lib/automation/actionRegistry";
import type {
  AutomationActionRequestRow,
  AutomationExecutionAttemptRow,
  AutomationJobRow,
  ClaimedAutomationJob,
  CompleteAutomationAttemptInput,
  CreateAutomationJobInput,
  RejectAutomationRequestInput,
} from "@/lib/automation/persistenceTypes";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;

export interface AuthorizeAutomationRequestInput {
  requestId: string;
  authorizationId: string;
  authorizedBy: {
    actorType: "core_service" | "admin_user";
    actorId: string;
  };
  reasonCode: string;
}

export async function createAutomationActionRequest(
  request: CoreActionRequest,
): Promise<AutomationActionRequestRow> {
  const validation = validateCoreActionRequestEnvelope(request);
  if (!validation.ok) throw new Error(validation.reason);

  if (!isAutomationActionType(request.actionType)) {
    throw new Error("AUTOMATION_ACTION_TYPE_NOT_REGISTERED");
  }
  if (!canSourceRequestAction(request.source, request.actionType)) {
    throw new Error("AUTOMATION_SOURCE_ACTION_NOT_REQUESTABLE");
  }
  requireUuid(request.requestId, "AUTOMATION_REQUEST_ID_INVALID");

  const { data, error } = await adminClient()
    .rpc("qf_create_automation_action_request_v1", {
      p_request_id: request.requestId,
      p_contract_version: request.contractVersion,
      p_action_type: request.actionType,
      p_entity_type: request.entityType,
      p_entity_id: request.entityId,
      p_source: request.source,
      p_requested_by_type: request.requestedBy.actorType,
      p_requested_by_id: request.requestedBy.actorId,
      p_requested_at: request.requestedAt,
      p_idempotency_key: request.idempotencyKey,
      p_correlation_id: request.correlationId,
      p_safe_context: request.safeContext,
    })
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error("AUTOMATION_ACTION_REQUEST_CREATE_FAILED");
  }

  return data as AutomationActionRequestRow;
}

export async function authorizeAutomationActionRequest(
  input: AuthorizeAutomationRequestInput,
): Promise<AutomationActionRequestRow> {
  validateDecisionIdentity(
    input.requestId,
    input.authorizationId,
    input.authorizedBy,
    input.reasonCode,
  );

  return decideAutomationActionRequest({
    requestId: input.requestId,
    decision: "authorized",
    decisionId: input.authorizationId,
    actor: input.authorizedBy,
    reasonCode: input.reasonCode,
  });
}

export async function rejectAutomationActionRequest(
  input: RejectAutomationRequestInput,
): Promise<AutomationActionRequestRow> {
  validateDecisionIdentity(
    input.requestId,
    input.decisionId,
    input.rejectedBy,
    input.reasonCode,
  );

  return decideAutomationActionRequest({
    requestId: input.requestId,
    decision: "rejected",
    decisionId: input.decisionId,
    actor: input.rejectedBy,
    reasonCode: input.reasonCode,
  });
}

export async function createAutomationJob(
  input: CreateAutomationJobInput,
): Promise<AutomationJobRow> {
  requireUuid(input.actionRequestId, "AUTOMATION_ACTION_REQUEST_ID_INVALID");

  const maxAttempts = input.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error("AUTOMATION_JOB_MAX_ATTEMPTS_INVALID");
  }

  const availableAt = input.availableAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(availableAt))) {
    throw new Error("AUTOMATION_JOB_AVAILABLE_AT_INVALID");
  }

  const { data, error } = await adminClient()
    .rpc("qf_create_automation_job_v1", {
      p_action_request_id: input.actionRequestId,
      p_max_attempts: maxAttempts,
      p_available_at: availableAt,
    })
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error("AUTOMATION_JOB_CREATE_FAILED");
  }

  return data as AutomationJobRow;
}

export async function claimAutomationJob(
  workerId: string,
): Promise<ClaimedAutomationJob | null> {
  requireSafeId(workerId, "AUTOMATION_WORKER_ID_INVALID", 200);

  const { data, error } = await adminClient()
    .rpc("qf_claim_automation_job_v1", {
      p_worker_id: workerId,
    })
    .maybeSingle();

  if (error) throw error;
  return (data as ClaimedAutomationJob | null) ?? null;
}

export async function completeAutomationAttempt(
  input: CompleteAutomationAttemptInput,
): Promise<AutomationJobRow> {
  requireUuid(input.jobId, "AUTOMATION_JOB_ID_INVALID");
  requireUuid(input.attemptId, "AUTOMATION_ATTEMPT_ID_INVALID");
  requireSafeId(input.workerId, "AUTOMATION_WORKER_ID_INVALID", 200);
  requireSafeId(input.safeCode, "AUTOMATION_SAFE_CODE_INVALID", 200);

  if (input.executorReference != null) {
    requireSafeId(
      input.executorReference,
      "AUTOMATION_EXECUTOR_REFERENCE_INVALID",
      200,
    );
  }

  if (
    !isAutomaticRetryAllowed(input.classification) &&
    input.nextRetryAt != null
  ) {
    throw new Error("AUTOMATION_TERMINAL_RESULT_NEXT_RETRY_FORBIDDEN");
  }

  if (input.nextRetryAt != null && Number.isNaN(Date.parse(input.nextRetryAt))) {
    throw new Error("AUTOMATION_NEXT_RETRY_AT_INVALID");
  }

  const { data, error } = await adminClient()
    .rpc("qf_complete_automation_attempt_v1", {
      p_job_id: input.jobId,
      p_attempt_id: input.attemptId,
      p_worker_id: input.workerId,
      p_classification: input.classification,
      p_safe_code: input.safeCode,
      p_executor_reference: input.executorReference ?? null,
      p_next_retry_at: input.nextRetryAt ?? null,
    })
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error("AUTOMATION_ATTEMPT_COMPLETE_FAILED");
  }

  return data as AutomationJobRow;
}

export async function getAutomationActionRequest(
  requestId: string,
): Promise<AutomationActionRequestRow | null> {
  requireUuid(requestId, "AUTOMATION_REQUEST_ID_INVALID");

  const { data, error } = await adminClient()
    .from("automation_action_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (error) throw error;
  return (data as AutomationActionRequestRow | null) ?? null;
}

export async function getAutomationJob(
  jobId: string,
): Promise<AutomationJobRow | null> {
  requireUuid(jobId, "AUTOMATION_JOB_ID_INVALID");

  const { data, error } = await adminClient()
    .from("automation_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error) throw error;
  return (data as AutomationJobRow | null) ?? null;
}

export async function getAutomationExecutionAttempt(
  attemptId: string,
): Promise<AutomationExecutionAttemptRow | null> {
  requireUuid(attemptId, "AUTOMATION_ATTEMPT_ID_INVALID");

  const { data, error } = await adminClient()
    .from("automation_execution_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();

  if (error) throw error;
  return (data as AutomationExecutionAttemptRow | null) ?? null;
}

/**
 * QF-MVP-50.2E — the READ-SIDE current-attempt proof.
 *
 * The identical rule already exists as the authoritative WRITE-side guard inside
 * `qf_complete_automation_attempt_v1` (job `processing`, `locked_by` equal to the
 * worker, attempt linked to the job, `attempt_number = job.attempt_count`,
 * attempt worker equal, attempt `started`). That guard is reached only when Core
 * is ALREADY finalizing, so an execution boundary that must decide BEFORE doing
 * anything had no way to ask the same question. This is that question, and
 * nothing more: it decides no outcome, writes nothing and locks nothing.
 *
 * `owned_completed` is a deliberately separate verdict from `not_owned`. An
 * attempt that is fully linked and current but already `completed` is the exact
 * shape of a REPLAY after a lost response, and the caller must be able to answer
 * it truthfully from durable evidence rather than refuse it as unauthorized.
 */
export type AutomationAttemptOwnership =
  | {
      readonly verdict: "owned_started" | "owned_completed";
      readonly job: AutomationJobRow;
      readonly attempt: AutomationExecutionAttemptRow;
    }
  | { readonly verdict: "not_owned"; readonly code: string };

export async function proveCurrentAutomationAttemptOwnership(input: {
  jobId: string;
  attemptId: string;
  workerId: string;
}): Promise<AutomationAttemptOwnership> {
  requireUuid(input.jobId, "AUTOMATION_JOB_ID_INVALID");
  requireUuid(input.attemptId, "AUTOMATION_ATTEMPT_ID_INVALID");
  requireSafeId(input.workerId, "AUTOMATION_WORKER_ID_INVALID", 200);

  const job = await getAutomationJob(input.jobId);
  if (!job) {
    return { verdict: "not_owned", code: "AUTOMATION_EXECUTION_JOB_NOT_FOUND" };
  }

  const attempt = await getAutomationExecutionAttempt(input.attemptId);
  if (!attempt) {
    return {
      verdict: "not_owned",
      code: "AUTOMATION_EXECUTION_ATTEMPT_NOT_FOUND",
    };
  }

  // Linkage and currency are checked BEFORE status, so an attempt belonging to a
  // different job, or a superseded attempt of this job, is never mistaken for a
  // replay of the current one.
  if (
    attempt.job_id !== job.id ||
    attempt.worker_id !== input.workerId ||
    attempt.attempt_number !== job.attempt_count
  ) {
    return {
      verdict: "not_owned",
      code: "AUTOMATION_EXECUTION_ATTEMPT_NOT_CURRENT",
    };
  }

  if (attempt.status === "completed") {
    return { verdict: "owned_completed", job, attempt };
  }

  if (
    attempt.status !== "started" ||
    job.status !== "processing" ||
    job.locked_by !== input.workerId
  ) {
    return {
      verdict: "not_owned",
      code: "AUTOMATION_EXECUTION_JOB_NOT_OWNED",
    };
  }

  return { verdict: "owned_started", job, attempt };
}

/**
 * Reconstruct the pure 50.1A authorized action from persisted Core evidence.
 * This is what a later dispatcher will feed into buildAutomationJobEnvelope().
 */
export function toCoreAuthorizedAction(
  row: AutomationActionRequestRow,
): CoreAuthorizedAction {
  if (
    row.contract_version !== AUTOMATION_CONTRACT_VERSION ||
    row.decision_status !== "authorized" ||
    !row.decision_id ||
    !row.decision_at ||
    !row.decision_actor_type ||
    !row.decision_actor_id ||
    !row.decision_reason_code
  ) {
    throw new Error("AUTOMATION_REQUEST_NOT_AUTHORIZED");
  }

  const request: CoreActionRequest = {
    contractVersion: AUTOMATION_CONTRACT_VERSION,
    requestId: row.id,
    actionType: row.action_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    source: row.source,
    requestedBy: {
      actorType: row.requested_by_type,
      actorId: row.requested_by_id,
    },
    requestedAt: row.requested_at,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    safeContext: row.safe_context,
  };

  const validation = validateCoreActionRequestEnvelope(request);
  if (!validation.ok) throw new Error(validation.reason);

  return {
    request,
    authorization: {
      decision: "authorized",
      authorizationId: row.decision_id,
      authorizedAt: row.decision_at,
      authorizedBy: {
        actorType: row.decision_actor_type,
        actorId: row.decision_actor_id,
      },
      reasonCode: row.decision_reason_code,
    },
  };
}

/**
 * Convenience for the future dispatcher. No network call is made.
 *
 * The executor envelope is exposed only for the exact currently claimed job.
 * Knowing a job UUID is not enough to obtain executable work.
 */
export async function getClaimedAutomationJobEnvelope(
  claim: ClaimedAutomationJob,
  workerId: string,
) {
  requireUuid(claim.job_id, "AUTOMATION_JOB_ID_INVALID");
  requireUuid(claim.action_request_id, "AUTOMATION_ACTION_REQUEST_ID_INVALID");
  requireUuid(claim.attempt_id, "AUTOMATION_ATTEMPT_ID_INVALID");
  requireSafeId(workerId, "AUTOMATION_WORKER_ID_INVALID", 200);

  const job = await getAutomationJob(claim.job_id);
  if (!job) throw new Error("AUTOMATION_JOB_NOT_FOUND");

  if (
    job.status !== "processing" ||
    job.locked_by !== workerId ||
    job.action_request_id !== claim.action_request_id ||
    job.attempt_count !== claim.attempt_number ||
    job.max_attempts !== claim.max_attempts
  ) {
    throw new Error("AUTOMATION_JOB_CLAIM_EVIDENCE_MISMATCH");
  }

  const request = await getAutomationActionRequest(job.action_request_id);
  if (!request) throw new Error("AUTOMATION_ACTION_REQUEST_NOT_FOUND");

  return buildAutomationJobEnvelope(toCoreAuthorizedAction(request), job.id);
}

async function decideAutomationActionRequest(input: {
  requestId: string;
  decision: "authorized" | "rejected";
  decisionId: string;
  actor: {
    actorType: "core_service" | "admin_user";
    actorId: string;
  };
  reasonCode: string;
}): Promise<AutomationActionRequestRow> {
  const { data, error } = await adminClient()
    .rpc("qf_decide_automation_action_request_v1", {
      p_request_id: input.requestId,
      p_decision: input.decision,
      p_decision_id: input.decisionId,
      p_decision_actor_type: input.actor.actorType,
      p_decision_actor_id: input.actor.actorId,
      p_reason_code: input.reasonCode,
    })
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error("AUTOMATION_ACTION_REQUEST_DECISION_FAILED");
  }

  return data as AutomationActionRequestRow;
}

function validateDecisionIdentity(
  requestId: string,
  decisionId: string,
  actor: AutomationAuditActor,
  reasonCode: string,
): void {
  requireUuid(requestId, "AUTOMATION_REQUEST_ID_INVALID");
  requireSafeId(decisionId, "AUTOMATION_DECISION_ID_INVALID");
  requireSafeId(actor.actorId, "AUTOMATION_DECISION_ACTOR_ID_INVALID");
  requireSafeId(reasonCode, "AUTOMATION_DECISION_REASON_INVALID");

  if (actor.actorType !== "core_service" && actor.actorType !== "admin_user") {
    throw new Error("AUTOMATION_DECISION_ACTOR_INVALID");
  }
}

function requireUuid(value: string, errorCode: string): void {
  if (!UUID_RE.test(value)) throw new Error(errorCode);
}

function requireSafeId(
  value: string,
  errorCode: string,
  maxLength = 240,
): void {
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    !SAFE_ID_RE.test(value)
  ) {
    throw new Error(errorCode);
  }
}
