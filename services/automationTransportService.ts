// ============================================================================
// QuickFurno — QF-MVP-50.1C secure n8n transport service
//
// Server-only Core boundary. No n8n URL, Meta token, provider call or direct
// table mutation exists here.
// ============================================================================

import { adminClient } from "@/lib/supabase";
import {
  getAutomationJob,
  getClaimedAutomationJobEnvelope,
} from "@/services/automationPersistenceService";
import { buildAutomationCommunicationIdempotencyKey } from "@/lib/automation/clientDispatchRegistry";
import { resolveCompletionEvidenceRuling } from "@/lib/automation/completionContract";
import { buildAutomationNextRetryAt } from "@/lib/automation/retryPolicy";
import type {
  AutomationTransportClaimRow,
  AutomationTransportCompletionRow,
  AutomationTransportExecutionRow,
  AutomationTransportRuntimeConfig,
  FreshClaimEvidence,
  N8nClaimResponseBody,
  N8nCompleteResponseBody,
} from "@/lib/automation/transportTypes";

const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

export function getAutomationTransportRuntimeConfig():
  | { ok: true; config: AutomationTransportRuntimeConfig }
  | { ok: false; code: string } {
  const modeRaw = process.env.QF_N8N_TRANSPORT_MODE?.trim().toLowerCase() ?? "off";

  if (modeRaw === "off") {
    return {
      ok: true,
      config: {
        mode: "off",
        runtimeEnvironment: null,
        inboundSecret: null,
        responseSecret: null,
        workerId: null,
      },
    };
  }

  if (modeRaw !== "staging" && modeRaw !== "production") {
    return { ok: false, code: "AUTOMATION_TRANSPORT_MODE_INVALID" };
  }

  const runtimeEnvironment =
    process.env.QF_AUTOMATION_RUNTIME_ENV?.trim().toLowerCase() ?? "";
  if (runtimeEnvironment !== modeRaw) {
    return { ok: false, code: "AUTOMATION_TRANSPORT_ENVIRONMENT_MISMATCH" };
  }

  const inboundSecret =
    process.env.QF_N8N_TO_CORE_HMAC_SECRET?.trim() ?? "";
  const responseSecret =
    process.env.QF_CORE_TO_N8N_HMAC_SECRET?.trim() ?? "";
  const workerId = process.env.QF_N8N_WORKER_ID?.trim() ?? "";

  if (inboundSecret.length < 32 || responseSecret.length < 32) {
    return { ok: false, code: "AUTOMATION_TRANSPORT_SECRET_MISSING" };
  }
  if (inboundSecret === responseSecret) {
    return { ok: false, code: "AUTOMATION_TRANSPORT_DIRECTIONAL_SECRETS_REQUIRED" };
  }
  if (!SAFE_WORKER_RE.test(workerId)) {
    return { ok: false, code: "AUTOMATION_TRANSPORT_WORKER_ID_INVALID" };
  }

  return {
    ok: true,
    config: {
      mode: modeRaw,
      runtimeEnvironment: modeRaw,
      inboundSecret,
      responseSecret,
      workerId,
    },
  };
}

export async function claimAutomationJobForN8nTransport(input: {
  requestId: string;
  workerId: string;
  bodySha256: string;
}): Promise<N8nClaimResponseBody> {
  if (!UUID_RE.test(input.requestId)) {
    throw new Error("AUTOMATION_TRANSPORT_REQUEST_ID_INVALID");
  }
  if (!SAFE_WORKER_RE.test(input.workerId)) {
    throw new Error("AUTOMATION_TRANSPORT_WORKER_ID_INVALID");
  }
  if (!SHA256_RE.test(input.bodySha256)) {
    throw new Error("AUTOMATION_TRANSPORT_BODY_HASH_INVALID");
  }

  const { data, error } = await adminClient()
    .rpc("qf_claim_automation_job_transport_v1", {
      p_request_id: input.requestId,
      p_worker_id: input.workerId,
      p_body_sha256: input.bodySha256,
    })
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error("AUTOMATION_TRANSPORT_CLAIM_FAILED");
  }

  const row = data as AutomationTransportClaimRow;

  if (row.request_id !== input.requestId) {
    throw new Error("AUTOMATION_TRANSPORT_REQUEST_EVIDENCE_MISMATCH");
  }

  if (row.is_replay) {
    if (row.state === "empty") {
      return {
        ok: true,
        transportVersion: 1,
        requestId: input.requestId,
        state: "empty",
        replayed: true,
        executable: false,
      };
    }

    if (row.state !== "claimed") {
      throw new Error("AUTOMATION_TRANSPORT_REPLAY_STATE_INVALID");
    }

    // This is the critical no-blind-resend rule. Even if the original HTTP
    // response was lost, a replay never receives the executable envelope.
    return {
      ok: true,
      transportVersion: 1,
      requestId: input.requestId,
      state: "claimed",
      replayed: true,
      executable: false,
      message: "CLAIM_REPLAY_EXECUTION_SUPPRESSED",
    };
  }

  if (row.state === "empty") {
    return {
      ok: true,
      transportVersion: 1,
      requestId: input.requestId,
      state: "empty",
      replayed: false,
      executable: false,
    };
  }

  if (row.state !== "claimed") {
    throw new Error("AUTOMATION_TRANSPORT_CLAIM_STATE_INVALID");
  }

  const claim = requireFreshClaimEvidence(row);

  const job = await getClaimedAutomationJobEnvelope(
    claim,
    input.workerId,
  );

  return {
    ok: true,
    transportVersion: 1,
    requestId: input.requestId,
    state: "claimed",
    replayed: false,
    executable: true,
    claim,
    job,
  };
}

// ---------------------------------------------------------------------------
// QF-MVP-50.2D — signed attempt completion
// ---------------------------------------------------------------------------

export type N8nCompletionTransportResult =
  | { ok: true; body: N8nCompleteResponseBody }
  | { ok: false; status: 409; code: string };

export interface CompleteAutomationAttemptForN8nTransportInput {
  readonly requestId: string;
  readonly workerId: string;
  readonly bodySha256: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly executorReference: string;
  /** Canonical clock, injected so retry timing is deterministic under test. */
  readonly now?: Date;
}

/**
 * Finalize the exact current automation attempt from Core-owned evidence.
 *
 * NOTHING here trusts n8n. The classification, the safe code and the retry
 * timestamp are all derived from the communication row that Core reaches
 * through its OWN key, qf_auto_v1:{jobId}:{attemptId}. n8n's only contribution
 * is an executorReference, and that is checked for equality against the row
 * Core already found — never used to select a row.
 *
 * No provider call, no communication send, no Meta/WhatsApp, no n8n execution.
 */
export async function completeAutomationAttemptForN8nTransport(
  input: CompleteAutomationAttemptForN8nTransportInput,
): Promise<N8nCompletionTransportResult> {
  if (!UUID_RE.test(input.requestId)) {
    throw new Error("AUTOMATION_TRANSPORT_REQUEST_ID_INVALID");
  }
  if (!SAFE_WORKER_RE.test(input.workerId)) {
    throw new Error("AUTOMATION_TRANSPORT_WORKER_ID_INVALID");
  }
  if (!SHA256_RE.test(input.bodySha256)) {
    throw new Error("AUTOMATION_TRANSPORT_BODY_HASH_INVALID");
  }
  if (
    !UUID_RE.test(input.jobId) ||
    !UUID_RE.test(input.attemptId) ||
    !UUID_RE.test(input.executorReference)
  ) {
    throw new Error("AUTOMATION_TRANSPORT_COMPLETION_IDENTITY_INVALID");
  }

  // Read ONLY to obtain the durable retry budget (attempt_count / max_attempts)
  // needed to compute a legal next_retry_at. Ownership remains the RPC's
  // authority and is deliberately not re-decided here.
  const job = await getAutomationJob(input.jobId);
  if (!job) {
    return { ok: false, status: 409, code: "AUTOMATION_COMPLETION_JOB_NOT_FOUND" };
  }

  const idempotencyKey = buildAutomationCommunicationIdempotencyKey(
    input.jobId,
    input.attemptId,
  );
  if (!idempotencyKey) {
    throw new Error("AUTOMATION_TRANSPORT_COMPLETION_IDENTITY_INVALID");
  }

  // `provider_message_id` is not in this projection. The provider's own message
  // identifier is never read here and therefore can never be surfaced to n8n.
  const { data: evidence, error: evidenceError } = await adminClient()
    .from("communication_messages")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (evidenceError) throw evidenceError;

  const message = evidence as { id: string; status: string } | null;
  if (!message) {
    // Expected until QF-MVP-50.2E creates execution evidence. No evidence is
    // invented to make this route look useful before then.
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_COMPLETION_EVIDENCE_NOT_FOUND",
    };
  }

  if (message.id !== input.executorReference) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_COMPLETION_EXECUTOR_REFERENCE_MISMATCH",
    };
  }

  const ruling = resolveCompletionEvidenceRuling(message.status);
  if (!ruling.completable) {
    return { ok: false, status: 409, code: ruling.code };
  }

  // Only a retryable failure may carry a retry timestamp, and Core alone
  // computes it. When the budget is spent this stays null so the RPC applies
  // its own dead-letter rule.
  //
  // No communication status maps to `retryable_failure` today — `retry_scheduled`
  // is the communication lane's OWN pending retry and is refused as unresolved,
  // so completing it here would create a second, duplicate send. This branch is
  // therefore currently unreachable and is retained deliberately: retry timing
  // must already be Core-owned when QF-MVP-50.2E introduces a genuine
  // automation-level retryable failure. See lib/automation/completionContract.ts.
  const nextRetryAt =
    ruling.classification === "retryable_failure"
      ? buildAutomationNextRetryAt({
          attemptCount: job.attempt_count,
          maxAttempts: job.max_attempts,
          now: input.now ?? new Date(),
        })
      : null;

  const { data, error } = await adminClient()
    .rpc("qf_complete_automation_attempt_transport_v1", {
      p_request_id: input.requestId,
      p_worker_id: input.workerId,
      p_body_sha256: input.bodySha256,
      p_job_id: input.jobId,
      p_attempt_id: input.attemptId,
      p_classification: ruling.classification,
      p_safe_code: ruling.safeCode,
      p_executor_reference: input.executorReference,
      p_next_retry_at: nextRetryAt,
    })
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error("AUTOMATION_TRANSPORT_COMPLETION_FAILED");
  }

  const row = data as AutomationTransportCompletionRow;

  if (
    row.request_id !== input.requestId ||
    row.route_key !== "complete_v1" ||
    row.state !== "completed" ||
    row.job_id !== input.jobId ||
    row.attempt_id !== input.attemptId
  ) {
    throw new Error("AUTOMATION_TRANSPORT_COMPLETION_EVIDENCE_MISMATCH");
  }

  if (!row.classification || !row.safe_code || !row.executor_reference) {
    throw new Error("AUTOMATION_TRANSPORT_COMPLETION_EVIDENCE_INCOMPLETE");
  }

  return {
    ok: true,
    body: {
      ok: true,
      transportVersion: 1,
      requestId: input.requestId,
      route: "complete_v1",
      state: "completed",
      replayed: row.is_replay,
      jobStatus: row.job_status,
      attemptStatus: row.attempt_status,
      classification: row.classification,
      safeCode: row.safe_code,
      executorReference: row.executor_reference,
    },
  };
}

// ---------------------------------------------------------------------------
// QF-MVP-50.2E — signed client-execution identity reservation
// ---------------------------------------------------------------------------

export interface RecordedClientExecutionIdentity {
  readonly requestId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly isReplay: boolean;
}

/**
 * Reserve the durable, attempt-scoped `execute_v1` transport identity.
 *
 * IDENTITY ONLY. Nothing about the outcome of the execution is stored, because
 * the execution has not happened yet and will happen in the application layer
 * AFTER this call commits. No cross-system atomicity exists or is claimed; the
 * crash-safety property comes from every replay re-reading Core truth.
 */
export async function recordClientExecutionTransportIdentity(input: {
  requestId: string;
  workerId: string;
  bodySha256: string;
  jobId: string;
  attemptId: string;
}): Promise<RecordedClientExecutionIdentity> {
  if (!UUID_RE.test(input.requestId)) {
    throw new Error("AUTOMATION_TRANSPORT_REQUEST_ID_INVALID");
  }
  if (!SAFE_WORKER_RE.test(input.workerId)) {
    throw new Error("AUTOMATION_TRANSPORT_WORKER_ID_INVALID");
  }
  if (!SHA256_RE.test(input.bodySha256)) {
    throw new Error("AUTOMATION_TRANSPORT_BODY_HASH_INVALID");
  }
  if (!UUID_RE.test(input.jobId) || !UUID_RE.test(input.attemptId)) {
    throw new Error("AUTOMATION_TRANSPORT_EXECUTION_IDENTITY_INVALID");
  }

  const { data, error } = await adminClient()
    .rpc("qf_record_automation_execution_transport_v1", {
      p_request_id: input.requestId,
      p_worker_id: input.workerId,
      p_body_sha256: input.bodySha256,
      p_job_id: input.jobId,
      p_attempt_id: input.attemptId,
    })
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error("AUTOMATION_TRANSPORT_EXECUTION_FAILED");
  }

  const row = data as AutomationTransportExecutionRow;

  if (
    row.route_key !== "execute_v1" ||
    row.state !== "recorded" ||
    row.job_id !== input.jobId ||
    row.attempt_id !== input.attemptId
  ) {
    throw new Error("AUTOMATION_TRANSPORT_EXECUTION_EVIDENCE_MISMATCH");
  }

  return {
    requestId: row.request_id,
    jobId: row.job_id,
    attemptId: row.attempt_id,
    isReplay: row.is_replay,
  };
}

/**
 * Read the existing `execute_v1` reservation for an attempt, if any.
 *
 * This is the ONLY thing that lets a replay distinguish "Core executed this
 * attempt and finalized it, then the response was lost" from "somebody else
 * finalized this attempt". Without it, a lost response after a pre-communication
 * finalization would be indistinguishable from an unauthorized request.
 */
export async function getRecordedClientExecutionIdentity(input: {
  jobId: string;
  attemptId: string;
}): Promise<{ requestId: string } | null> {
  if (!UUID_RE.test(input.jobId) || !UUID_RE.test(input.attemptId)) {
    throw new Error("AUTOMATION_TRANSPORT_EXECUTION_IDENTITY_INVALID");
  }

  const { data, error } = await adminClient()
    .from("automation_transport_requests")
    .select("id")
    .eq("route_key", "execute_v1")
    .eq("job_id", input.jobId)
    .eq("attempt_id", input.attemptId)
    .maybeSingle();

  if (error) throw error;

  const row = data as { id: string } | null;
  return row ? { requestId: row.id } : null;
}

function requireFreshClaimEvidence(
  row: AutomationTransportClaimRow,
): FreshClaimEvidence {
  if (
    !row.job_id ||
    !row.action_request_id ||
    !row.attempt_id ||
    row.attempt_number == null ||
    row.max_attempts == null
  ) {
    throw new Error("AUTOMATION_TRANSPORT_CLAIM_EVIDENCE_INCOMPLETE");
  }

  return {
    job_id: row.job_id,
    action_request_id: row.action_request_id,
    attempt_id: row.attempt_id,
    attempt_number: row.attempt_number,
    max_attempts: row.max_attempts,
  };
}
