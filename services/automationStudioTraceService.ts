import "server-only";

import { adminClient } from "@/lib/supabase";
import { getAutomationStudioWorkflowKeyForFamily } from "@/services/automationStudioService";
import { getWorkflowFamilyForAction, isAutomationActionType } from "@/lib/automation/actionRegistry";
import { isAutomationTraceJobId, safeTraceCode, safeTraceCorrelationId, sortTraceEvents, traceStateForStatus, type AutomationTraceEvent, type AutomationStudioExecutionTrace } from "@/lib/automation/studioTraceContract";

const MAX_EVIDENCE_ROWS = 40;

export async function getAutomationStudioExecutionTrace(jobId: string): Promise<AutomationStudioExecutionTrace | null> {
  if (!isAutomationTraceJobId(jobId)) return null;
  const db = adminClient();
  const { data: job, error: jobError } = await db.from("automation_jobs")
    .select("id,action_request_id,status,attempt_count,available_at,locked_at,completed_at,created_at,updated_at,last_safe_code")
    .eq("id", jobId).maybeSingle();
  if (jobError) throw jobError;
  if (!job) return null;

  const [requestResult, attemptsResult, transportsResult] = await Promise.all([
    db.from("automation_action_requests")
      .select("id,action_type,entity_type,correlation_id,decision_status,decision_at,decision_reason_code,created_at")
      .eq("id", job.action_request_id).maybeSingle(),
    db.from("automation_execution_attempts")
      .select("id,attempt_number,status,classification,safe_code,started_at,finished_at")
      .eq("job_id", jobId).order("started_at", { ascending: true }).limit(MAX_EVIDENCE_ROWS + 1),
    db.from("automation_transport_requests")
      .select("id,attempt_id,direction,route_key,state,created_at,finalized_at")
      .eq("job_id", jobId).order("created_at", { ascending: true }).limit(MAX_EVIDENCE_ROWS + 1),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (attemptsResult.error) throw attemptsResult.error;
  if (transportsResult.error) throw transportsResult.error;
  const request = requestResult.data;
  if (!request) return null;
  const attempts = (attemptsResult.data ?? []).slice(0, MAX_EVIDENCE_ROWS);
  const transports = (transportsResult.data ?? []).slice(0, MAX_EVIDENCE_ROWS);
  const evidenceTruncated = (attemptsResult.data?.length ?? 0) > MAX_EVIDENCE_ROWS ||
    (transportsResult.data?.length ?? 0) > MAX_EVIDENCE_ROWS;

  const events: AutomationTraceEvent[] = [];
  const add = (event: AutomationTraceEvent) => events.push(event);
  const code = (value: unknown) => safeTraceCode(value);
  add({
    id: "request:" + request.id, at: request.created_at, source: "core",
    title: "Action requested", detail: code(request.action_type) ?? "Registered workflow action",
    state: "observed", safeCode: null,
  });
  if (request.decision_at) add({
    id: "decision:" + request.id, at: request.decision_at, source: "core",
    title: "Core authorization: " + (code(request.decision_status) ?? "unknown"),
    detail: "Decision recorded by QuickFurno Core", state: traceStateForStatus(request.decision_status),
    safeCode: code(request.decision_reason_code),
  });
  add({
    id: "queued:" + job.id, at: job.created_at, source: "queue",
    title: "Durable job created", detail: "Queued for authorized execution",
    state: "observed", safeCode: null,
  });
  if (job.available_at && Date.parse(job.available_at) > Date.parse(job.created_at)) add({
    id: "available:" + job.id, at: job.available_at, source: "queue",
    title: "Scheduled eligibility time", detail: "Earliest permitted queue availability; not proof of a claim",
    state: "observed", safeCode: null,
  });
  if (job.locked_at) add({
    id: "locked:" + job.id, at: job.locked_at, source: "queue",
    title: "Worker claim timestamp", detail: "Queue recorded a worker lock",
    state: "observed", safeCode: null,
  });

  for (const attempt of attempts) {
    const number = Number.isInteger(attempt.attempt_number) ? attempt.attempt_number : "?";
    if (attempt.started_at) add({
      id: "attempt:start:" + attempt.id, at: attempt.started_at, source: "worker",
      title: "Attempt " + number + " started", detail: "Worker execution attempt",
      state: "observed", safeCode: null,
    });
    if (attempt.finished_at) add({
      id: "attempt:end:" + attempt.id, at: attempt.finished_at, source: "worker",
      title: "Attempt " + number + ": " + (code(attempt.status) ?? "unknown"),
      detail: code(attempt.classification) ?? "Worker result recorded",
      state: traceStateForStatus(attempt.status), safeCode: code(attempt.safe_code),
    });
  }
  for (const transport of transports) {
    add({
      id: "transport:" + transport.id, at: transport.created_at, source: "transport",
      title: "Transport: " + (code(transport.direction) ?? "unknown"),
      detail: (code(transport.route_key) ?? "registered route") + " · " + (code(transport.state) ?? "unknown"),
      state: "observed", safeCode: null,
    });
    if (transport.finalized_at) add({
      id: "transport:done:" + transport.id, at: transport.finalized_at, source: "transport",
      title: "Transport finalized", detail: "Persisted transport state: " + (code(transport.state) ?? "unknown"),
      state: traceStateForStatus(transport.state), safeCode: null,
    });
  }
  add({
    id: "job:status:" + job.id, at: job.completed_at ?? job.updated_at, source: "queue",
    title: "Job state: " + (code(job.status) ?? "unknown"), detail: "Latest persisted queue state",
    state: traceStateForStatus(job.status), safeCode: code(job.last_safe_code),
  });

  return {
    ok: true, jobId: job.id, actionRequestId: request.id,
    actionType: code(request.action_type) ?? "unknown",
    workflowKey: isAutomationActionType(request.action_type)
      ? getAutomationStudioWorkflowKeyForFamily(getWorkflowFamilyForAction(request.action_type))
      : "unknown",
    entityType: code(request.entity_type) ?? "unknown",
    correlationId: safeTraceCorrelationId(request.correlation_id),
    jobStatus: code(job.status) ?? "unknown",
    decisionStatus: code(request.decision_status) ?? "unknown",
    events: sortTraceEvents(events),
    coverage: attempts.length > 0
      ? (transports.length > 0 ? "core_queue_worker_transport" : "core_queue_worker")
      : (transports.length > 0 ? "core_queue_transport" : "core_queue"),
    evidenceTruncated,
    providerDeliveryVerified: false,
    notice: "Read-only persisted event evidence. A draft canvas is not a historical execution replay. Provider delivery and Anisha/AOS effects are NOT verified by this trace.",
  };
}
