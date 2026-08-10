// ============================================================================
// QF-MVP-50.5 — automation recovery and reconciliation service
//
// Server-only Core boundary. No n8n URL, Meta token, provider call or direct
// table mutation exists here.
//
// TWO LANES, NEVER MIXED
//   recoverDueAutomationRetryForN8nTransport()  serves the `recover_v1` route.
//   reconcileStaleAutomationAttemptForN8nTransport() serves `reconcile_v1`.
//
//   Each is driven by its own signed request and its own SQL selector. There is
//   deliberately no shared selector that unions due-retry and stale-processing
//   rows: a union would let whichever class happened to sort first monopolise the
//   supervisor, and fresh `pending` work — which neither lane ever touches — would
//   have no protection at all. Three classes of work, three independent lanes.
//
// CORE SELECTS EVERYTHING
//   n8n supplies three transport fields and nothing else. It never chooses the
//   job, the action, the family, the classification, the retry time, the stale
//   outcome, the dead-letter decision, the provider, the recipient or the
//   template. On a successful recovery it is told which family execute boundary
//   to forward the new attempt to, and that is the entirety of its discretion.
//
// NO PROVIDER CALL AND NO COMMUNICATION WRITE HAPPENS HERE
//   Reconciliation READS `communication_messages` through Core's own derived key
//   and never writes it, never re-dispatches it and never cancels it. Where the
//   communication lane owns a row, this service deliberately does nothing.
// ============================================================================

import { adminClient } from "@/lib/supabase";
import { buildAutomationCommunicationIdempotencyKey } from "@/lib/automation/clientDispatchRegistry";
import { isClaimableWorkflowFamily } from "@/lib/automation/transportTypes";
import { buildAutomationNextRetryAt } from "@/lib/automation/retryPolicy";
import {
  AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS,
  resolveStaleReconcileDisposition,
  type RecoverResult,
  type ReconcileResult,
} from "@/lib/automation/recoveryContract";
import type {
  AutomationStaleAttemptCandidateRow,
  AutomationTransportReconciliationRow,
  AutomationTransportRecoveryRow,
} from "@/lib/automation/transportTypes";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export interface AutomationRecoveryTransportInput {
  readonly requestId: string;
  readonly workerId: string;
  readonly bodySha256: string;
  /** Canonical clock, injected so retry timing stays deterministic under test. */
  readonly now?: Date;
}

function assertTransportIdentity(input: AutomationRecoveryTransportInput): void {
  if (!UUID_RE.test(input.requestId)) {
    throw new Error("AUTOMATION_TRANSPORT_REQUEST_ID_INVALID");
  }
  if (!SAFE_WORKER_RE.test(input.workerId)) {
    throw new Error("AUTOMATION_TRANSPORT_WORKER_ID_INVALID");
  }
  if (!SHA256_RE.test(input.bodySha256)) {
    throw new Error("AUTOMATION_TRANSPORT_BODY_HASH_INVALID");
  }
}

// ---------------------------------------------------------------------------
// A. recover_v1 — due-retry recovery
// ---------------------------------------------------------------------------

/**
 * Recover ONE eligible due `retry_scheduled` job into a new owned attempt.
 *
 * The whole operation is a single SQL transaction: the transport identity, the
 * `retry_scheduled -> processing` transition, the attempt_count increment and the
 * new attempt row all commit together or not at all. There is therefore no window
 * in which a recovery is half-done.
 *
 * A REPLAY NEVER RE-EXECUTES. Exactly as with `claim_v1`, a duplicate request UUID
 * returns the stored identity with `replayed: true` and is NOT handed back as an
 * executable envelope, so a lost HTTP response can never cause a second send.
 */
export async function recoverDueAutomationRetryForN8nTransport(
  input: AutomationRecoveryTransportInput,
): Promise<RecoverResult> {
  assertTransportIdentity(input);

  const { data, error } = await adminClient()
    .rpc("qf_recover_automation_job_transport_v1", {
      p_request_id: input.requestId,
      p_worker_id: input.workerId,
      p_body_sha256: input.bodySha256,
    })
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error("AUTOMATION_TRANSPORT_RECOVERY_FAILED");
  }

  const row = data as AutomationTransportRecoveryRow;

  if (row.request_id !== input.requestId || row.route_key !== "recover_v1") {
    throw new Error("AUTOMATION_TRANSPORT_RECOVERY_EVIDENCE_MISMATCH");
  }

  if (row.state === "empty") {
    return {
      ok: true,
      body: {
        ok: true,
        transportVersion: 1,
        requestId: input.requestId,
        route: "recover_v1",
        orchestrationState: "recovery_empty",
        replayed: row.is_replay,
      },
    };
  }

  if (row.state !== "recovered") {
    throw new Error("AUTOMATION_TRANSPORT_RECOVERY_STATE_INVALID");
  }

  // THE NO-BLIND-RESEND RULE, identical to the claim route's. Even when the
  // original response was lost, a replay is never given executable work: the
  // attempt it names is already owned and is the execute route's business, and
  // handing it out again could produce two concurrent executions of one attempt.
  if (row.is_replay) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_RECOVERY_REPLAY_EXECUTION_SUPPRESSED",
    };
  }

  if (
    !row.job_id ||
    !row.action_request_id ||
    !row.attempt_id ||
    row.attempt_number == null ||
    row.max_attempts == null
  ) {
    throw new Error("AUTOMATION_TRANSPORT_RECOVERY_EVIDENCE_INCOMPLETE");
  }

  // The family is Core's answer, derived in SQL from durable action truth. It is
  // re-checked against the closed vocabulary here so a value outside the three
  // canonical families can never reach an orchestrator that might treat an
  // unknown string as "any".
  if (!isClaimableWorkflowFamily(row.workflow_family)) {
    throw new Error("AUTOMATION_RECOVERY_WORKFLOW_FAMILY_INVALID");
  }

  return {
    ok: true,
    body: {
      ok: true,
      transportVersion: 1,
      requestId: input.requestId,
      route: "recover_v1",
      orchestrationState: "recovery_claimed",
      replayed: false,
      workflowFamily: row.workflow_family,
      recovery: {
        jobId: row.job_id,
        actionRequestId: row.action_request_id,
        attemptId: row.attempt_id,
        attemptNumber: row.attempt_number,
        maxAttempts: row.max_attempts,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// B. reconcile_v1 — stale current-attempt reconciliation
// ---------------------------------------------------------------------------

interface CommunicationEvidence {
  readonly id: string;
  readonly status: string;
}

/**
 * Examine ONE stale current attempt and apply the closed evidence ruling.
 *
 * ORDER IS THE SECURITY PROPERTY, exactly as in the frozen execution services:
 * durable evidence is read BEFORE anything is decided, and the decision table is
 * the same closed communication vocabulary QF-MVP-50.2D and 50.2E already use. So
 * there is one communication-status meaning in the system, not two.
 *
 * WHAT THIS CAN AND CANNOT DO
 *   It can finalize a stale attempt to `retry_scheduled`, `succeeded`, `failed`,
 *   `uncertain` or `dead_letter` — but it decides none of those names itself: it
 *   supplies a classification derived from evidence and the FROZEN
 *   `qf_complete_automation_attempt_v1` maps it, including the single
 *   dead-letter boundary.
 *
 *   It can deliberately do nothing, and says so.
 *
 *   It cannot invent a communication row, re-dispatch one, cancel one, or retry
 *   an attempt whose communication row is still pending. It cannot reclaim a
 *   processing job merely because it is old.
 */
export async function reconcileStaleAutomationAttemptForN8nTransport(
  input: AutomationRecoveryTransportInput,
): Promise<ReconcileResult> {
  assertTransportIdentity(input);

  const threshold = AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS;

  // 1. CORE SELECTS THE CANDIDATE. n8n has no say in which attempt is examined.
  const candidate = await selectStaleCandidate(threshold);

  if (!candidate) {
    const row = await applyReconciliation({
      input,
      threshold,
      disposition: "empty",
    });
    return emptyReconcileResult(input.requestId, row);
  }

  // 2. CONTRADICTION CHECKS BEFORE ANY RULING. The selector already refuses a
  //    superseded or completed attempt, so a mismatch here means the row changed
  //    underneath us or the ledger is torn. Either way Core does not guess.
  if (
    candidate.attempt_number !== candidate.attempt_count ||
    !candidate.locked_by ||
    (candidate.execute_request_id !== null && !candidate.execute_reserved_at)
  ) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_RECONCILE_EVIDENCE_CONTRADICTORY",
    };
  }

  // A candidate whose action has no canonical family cannot be reasoned about at
  // all — it should have been invisible to the selector. Fail closed.
  if (!isClaimableWorkflowFamily(candidate.workflow_family)) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_RECONCILE_WORKFLOW_FAMILY_UNRESOLVED",
    };
  }

  // 3. DURABLE COMMUNICATION EVIDENCE, through Core's OWN derived key. The key
  //    has exactly one derivation in the repository and is never accepted from a
  //    caller, so the row that is read is always the row this exact attempt owns.
  const idempotencyKey = buildAutomationCommunicationIdempotencyKey(
    candidate.job_id,
    candidate.attempt_id,
  );
  if (!idempotencyKey) {
    throw new Error("AUTOMATION_RECONCILE_IDENTITY_INVALID");
  }

  const evidence = await readCommunicationEvidence(idempotencyKey);

  // 4. THE CLOSED RULING. Pure, total, and the single place cases A-G are decided.
  const ruling = resolveStaleReconcileDisposition({
    executeReservationExists: candidate.execute_request_id !== null,
    executeReservationStale: candidate.execute_reservation_stale === true,
    communicationStatus: evidence?.status ?? null,
  });

  // 5. An anomaly consumes NO durable request identity. Recording "handled" for a
  //    state Core cannot explain would be exactly the kind of comfortable
  //    falsehood this ledger exists to prevent.
  if (ruling.disposition === "anomaly") {
    return { ok: false, status: 409, code: ruling.code };
  }

  if (ruling.disposition === "defer") {
    const deferred = await applyReconciliationGuarded({
      input,
      threshold,
      disposition: "defer",
      jobId: candidate.job_id,
      attemptId: candidate.attempt_id,
    });
    if (!deferred.ok) return deferred;
    return deferredReconcileResult(input.requestId, deferred.row);
  }

  // 6. Only a retryable failure may carry a retry instant, and it comes from the
  //    single frozen backoff schedule. When the budget is spent this stays null so
  //    the RPC applies its OWN dead-letter rule — the boundary never moves here.
  const nextRetryAt =
    ruling.classification === "retryable_failure"
      ? buildAutomationNextRetryAt({
          attemptCount: candidate.attempt_count,
          maxAttempts: candidate.max_attempts,
          now: input.now ?? new Date(),
        })
      : null;

  // `executorReference` is only ever a real communication_messages.id, and only
  // when a row actually exists. A pre-communication ruling has nothing to point at
  // and passes null rather than inventing a reference.
  const executorReference =
    ruling.useCommunicationEvidenceReference && evidence ? evidence.id : null;

  const finalized = await applyReconciliationGuarded({
    input,
    threshold,
    disposition: "finalize",
    jobId: candidate.job_id,
    attemptId: candidate.attempt_id,
    classification: ruling.classification,
    safeCode: ruling.safeCode,
    executorReference,
    nextRetryAt,
  });
  if (!finalized.ok) return finalized;

  return finalizedReconcileResult(input.requestId, finalized.row);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function selectStaleCandidate(
  thresholdSeconds: number,
): Promise<AutomationStaleAttemptCandidateRow | null> {
  const { data, error } = await adminClient()
    .rpc("qf_select_stale_automation_attempt_v1", {
      p_stale_after_seconds: thresholdSeconds,
    })
    .maybeSingle();

  if (error) throw error;
  return (data as AutomationStaleAttemptCandidateRow | null) ?? null;
}

async function readCommunicationEvidence(
  idempotencyKey: string,
): Promise<CommunicationEvidence | null> {
  // `provider_message_id` is deliberately not in this projection, so the
  // provider's own identifier can never be read here and therefore can never be
  // surfaced to n8n.
  const { data, error } = await adminClient()
    .from("communication_messages")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  return (data as CommunicationEvidence | null) ?? null;
}

async function applyReconciliation(args: {
  input: AutomationRecoveryTransportInput;
  threshold: number;
  disposition: "finalize" | "defer" | "empty";
  jobId?: string;
  attemptId?: string;
  classification?: string;
  safeCode?: string;
  executorReference?: string | null;
  nextRetryAt?: string | null;
}): Promise<AutomationTransportReconciliationRow> {
  const { data, error } = await adminClient()
    .rpc("qf_reconcile_automation_attempt_transport_v1", {
      p_request_id: args.input.requestId,
      p_worker_id: args.input.workerId,
      p_body_sha256: args.input.bodySha256,
      p_disposition: args.disposition,
      p_stale_after_seconds: args.threshold,
      p_job_id: args.jobId ?? null,
      p_attempt_id: args.attemptId ?? null,
      p_classification: args.classification ?? null,
      p_safe_code: args.safeCode ?? null,
      p_executor_reference: args.executorReference ?? null,
      p_next_retry_at: args.nextRetryAt ?? null,
    })
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error("AUTOMATION_TRANSPORT_RECONCILE_FAILED");
  }

  const row = data as AutomationTransportReconciliationRow;

  if (row.request_id !== args.input.requestId || row.route_key !== "reconcile_v1") {
    throw new Error("AUTOMATION_TRANSPORT_RECONCILE_EVIDENCE_MISMATCH");
  }

  return row;
}

/**
 * A REFUSED apply is a benign race, not an internal failure.
 *
 * Between Core's read and the RPC's re-proof the candidate may legitimately have
 * been finalized by the attempt's real executor, or have stopped being stale. The
 * RPC fails closed in that case, and the honest answer is an authenticated 409 —
 * never a 500, and never a database detail on the wire.
 */
type GuardedReconcileApply =
  | { readonly ok: true; readonly row: AutomationTransportReconciliationRow }
  | { readonly ok: false; readonly status: 409; readonly code: string };

async function applyReconciliationGuarded(
  args: Parameters<typeof applyReconciliation>[0],
): Promise<GuardedReconcileApply> {
  try {
    return { ok: true, row: await applyReconciliation(args) };
  } catch {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_RECONCILE_APPLY_REFUSED",
    };
  }
}

function emptyReconcileResult(
  requestId: string,
  row: AutomationTransportReconciliationRow,
): ReconcileResult {
  // A replayed request is answered from LIVE truth, never from a stored verdict:
  // if the original examination deferred and a later one finalized the attempt,
  // the replay reports the finalized reality.
  if (row.is_replay) return resolveReplayedReconcileResult(requestId, row);
  if (row.state !== "empty") {
    throw new Error("AUTOMATION_TRANSPORT_RECONCILE_STATE_INVALID");
  }
  return {
    ok: true,
    body: {
      ok: true,
      transportVersion: 1,
      requestId,
      route: "reconcile_v1",
      orchestrationState: "reconcile_empty",
      replayed: false,
    },
  };
}

function deferredReconcileResult(
  requestId: string,
  row: AutomationTransportReconciliationRow,
): ReconcileResult {
  if (row.is_replay) return resolveReplayedReconcileResult(requestId, row);
  if (row.state !== "reconciled") {
    throw new Error("AUTOMATION_TRANSPORT_RECONCILE_STATE_INVALID");
  }
  // A deferral MUST have changed nothing. The attempt is still open and the job is
  // still processing; asserting it here means a future SQL change that silently
  // mutated on a deferral would be caught rather than reported as a no-op.
  if (row.attempt_status !== "started" || row.job_status !== "processing") {
    throw new Error("AUTOMATION_RECONCILE_DEFERRAL_MUTATED_STATE");
  }
  return {
    ok: true,
    body: {
      ok: true,
      transportVersion: 1,
      requestId,
      route: "reconcile_v1",
      orchestrationState: "reconcile_deferred",
      replayed: false,
    },
  };
}

function finalizedReconcileResult(
  requestId: string,
  row: AutomationTransportReconciliationRow,
): ReconcileResult {
  if (row.is_replay) return resolveReplayedReconcileResult(requestId, row);
  if (row.state !== "reconciled") {
    throw new Error("AUTOMATION_TRANSPORT_RECONCILE_STATE_INVALID");
  }
  if (
    row.attempt_status !== "completed" ||
    !row.job_status ||
    !row.classification ||
    !row.safe_code
  ) {
    throw new Error("AUTOMATION_RECONCILE_FINALIZATION_EVIDENCE_INCOMPLETE");
  }
  return {
    ok: true,
    body: {
      ok: true,
      transportVersion: 1,
      requestId,
      route: "reconcile_v1",
      orchestrationState: "reconcile_finalized",
      replayed: false,
      jobStatus: row.job_status,
      classification: row.classification,
      safeCode: row.safe_code,
    },
  };
}

/**
 * The one place a replayed reconciliation is answered. The transport ledger
 * stores no verdict by design, so the answer is rebuilt from the live attempt
 * state the RPC just read: `completed` means the examination finalized it,
 * `started` means it deferred, and `empty` means it found nothing.
 */
function resolveReplayedReconcileResult(
  requestId: string,
  row: AutomationTransportReconciliationRow,
): ReconcileResult {
  if (row.state === "empty") {
    return {
      ok: true,
      body: {
        ok: true,
        transportVersion: 1,
        requestId,
        route: "reconcile_v1",
        orchestrationState: "reconcile_empty",
        replayed: true,
      },
    };
  }

  if (row.attempt_status === "completed") {
    if (!row.job_status || !row.classification || !row.safe_code) {
      throw new Error("AUTOMATION_RECONCILE_FINALIZATION_EVIDENCE_INCOMPLETE");
    }
    return {
      ok: true,
      body: {
        ok: true,
        transportVersion: 1,
        requestId,
        route: "reconcile_v1",
        orchestrationState: "reconcile_finalized",
        replayed: true,
        jobStatus: row.job_status,
        classification: row.classification,
        safeCode: row.safe_code,
      },
    };
  }

  if (row.attempt_status === "started") {
    return {
      ok: true,
      body: {
        ok: true,
        transportVersion: 1,
        requestId,
        route: "reconcile_v1",
        orchestrationState: "reconcile_deferred",
        replayed: true,
      },
    };
  }

  throw new Error("AUTOMATION_TRANSPORT_RECONCILE_REPLAY_STATE_INVALID");
}
