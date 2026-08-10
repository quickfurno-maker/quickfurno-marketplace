// ============================================================================
// QuickFurno — QF-MVP-50.5 recovery / reconciliation contract
//
// Pure module: no database, network, environment, clock, logging or provider
// import. It recovers nothing, reconciles nothing, sends nothing and reads no
// ledger. Everything here is a closed vocabulary, a schema or a total decision
// function over facts the CALLER has already proven from durable Core evidence.
//
// TWO DISTINCT TRANSPORT ROUTES — THE CENTRAL RULE OF THIS PHASE
//   `recover_v1`   due-retry recovery. Core selects ONE eligible due
//                  `retry_scheduled` job, creates the NEXT attempt, increments
//                  attempt_count exactly once, moves retry_scheduled ->
//                  processing and returns the new exact attempt identity plus the
//                  canonical workflow family. It never classifies a stale
//                  current attempt.
//
//   `reconcile_v1` stale-processing reconciliation. Core selects ONE stale
//                  current attempt, inspects durable evidence for THAT attempt
//                  and either finalizes it through the frozen completion
//                  authority or deliberately withholds. It never blindly creates
//                  another attempt.
//
//   These are not two spellings of one operation. They have different authority
//   (create an attempt vs. finalize one), different replay identity (per retry
//   generation vs. per examination), different uniqueness and different legal
//   state transitions. Collapsing them into one route would make the ledger
//   constraints unstatable and the audit trail ambiguous, so the vocabulary here
//   keeps them apart at every layer.
//
// `claim_v1` IS UNTOUCHED. Fresh `pending` work only, `retry_scheduled` still
// excluded, still exactly one claim_v1 row per job. Nothing in this phase
// relaxes uq_automation_transport_requests_claim_job, reuses claim_v1 for a
// retry, or deletes a claim row.
// ============================================================================

import type { AutomationResultClassification } from "./actionContract";
import {
  resolveCommunicationExecutionPartition,
} from "./clientExecutionContract";
import { resolveCompletionEvidenceRuling } from "./completionContract";
import { AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS } from "./transportAuth";

// ---------------------------------------------------------------------------
// 1. The stale-attempt threshold — DERIVED, not invented
// ---------------------------------------------------------------------------

/**
 * The n8n -> Core HTTP timeout, hard-coded in every signed POST node of every
 * shipped workflow (`timeout: 10000`). A signed transport call cannot outlive it
 * on the n8n side.
 */
export const TRANSPORT_HTTP_TIMEOUT_SECONDS = 10;

/**
 * How many signed Core calls one legitimate attempt may make end to end:
 * claim/recover, execute, complete. Recovery adds no fourth call to an attempt.
 */
export const TRANSPORT_CALLS_PER_ATTEMPT = 3;

/**
 * The provider ceiling Core itself enforces. `WHATSAPP_HTTP_TIMEOUT_MS` is read
 * through `readBoundedInt(..., BUSINESS_TIMEOUT_MIN_MS, BUSINESS_TIMEOUT_MAX_MS)`
 * = 1000..30000 ms and is enforced by a real AbortController in
 * `lib/communication/httpTransport.ts`, so 30s is the maximum a provider call can
 * legitimately hold the execution open.
 */
export const PROVIDER_CALL_CEILING_SECONDS = 30;

/**
 * The signed-request validity window. `AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS`
 * is the real upper bound on how late a legitimately signed execute request may
 * still arrive and START work, so it is part of the in-flight window rather than
 * an afterthought.
 */
export const TRANSPORT_SIGNATURE_WINDOW_SECONDS =
  AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS;

/**
 * The same safety margin the already-reviewed communication-lane recovery
 * constant uses (`RECOVERY_SAFETY_MARGIN_MS` = 60s in
 * `lib/communication/consentAckIntent.ts`). Reused rather than re-chosen so the
 * two recovery surfaces cannot drift on how much slack "safe" means.
 */
export const RECOVERY_SAFETY_MARGIN_SECONDS = 60;

/**
 * The maximum wall-clock lifetime a legitimately in-flight current attempt can
 * have, summed from the bounds above:
 *
 *   300  signature window — the execute request may legitimately arrive this late
 *  + 30  provider call ceiling
 *  + 30  3 x 10s transport HTTP
 *  + 60  reviewed safety margin
 *   ---
 *   420  seconds
 */
export const IN_FLIGHT_ATTEMPT_CEILING_SECONDS =
  TRANSPORT_SIGNATURE_WINDOW_SECONDS +
  PROVIDER_CALL_CEILING_SECONDS +
  TRANSPORT_HTTP_TIMEOUT_SECONDS * TRANSPORT_CALLS_PER_ATTEMPT +
  RECOVERY_SAFETY_MARGIN_SECONDS;

/**
 * THE VERSIONED THRESHOLD. v1 = 900 seconds.
 *
 * Chosen as the smallest round value that is more than DOUBLE the derived 420s
 * ceiling above, and which coincides with the third step of the frozen automation
 * retry schedule (`AUTOMATION_RETRY_DELAY_SCHEDULE_SECONDS` = 60/300/900) so the
 * two timing vocabularies stay coherent.
 *
 * It is a fixed repository constant, exactly like the retry schedule: no
 * environment variable, no admin setting, no n8n input and no provider input.
 * Revising it means a new named version in this file plus a governed successor
 * migration, never an operator edit.
 *
 * WHAT IT BUYS. Below this age Core cannot prove an executor is dead, so
 * reconciliation refuses to act. Above it, combined with the durable evidence
 * table, a stale attempt can be finalized without any risk of terminalizing work
 * that is still legitimately running.
 */
export const AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS_V1 = 900;

/** The threshold this build uses. */
export const AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS =
  AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS_V1;

/** The closed range SQL also enforces, so a caller cannot pass 0 or a year. */
export const STALE_THRESHOLD_MIN_SECONDS = 300;
export const STALE_THRESHOLD_MAX_SECONDS = 86_400;

/**
 * The invariant, asserted at module load exactly as the communication lane's
 * `recoveryThresholdIsSafe()` is: a mis-set threshold must not be silently
 * shippable.
 */
export function staleThresholdIsSafe(
  thresholdSeconds: number = AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS,
  ceilingSeconds: number = IN_FLIGHT_ATTEMPT_CEILING_SECONDS,
): boolean {
  return (
    Number.isInteger(thresholdSeconds) &&
    thresholdSeconds > ceilingSeconds &&
    thresholdSeconds >= STALE_THRESHOLD_MIN_SECONDS &&
    thresholdSeconds <= STALE_THRESHOLD_MAX_SECONDS
  );
}

if (!staleThresholdIsSafe()) {
  throw new Error(
    "AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS must exceed IN_FLIGHT_ATTEMPT_CEILING_SECONDS and stay inside the closed range",
  );
}

// ---------------------------------------------------------------------------
// 2. Request schemas — three keys each, and nothing else
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/**
 * Both recovery requests carry EXACTLY the same three transport keys as the
 * legacy claim body.
 *
 * There is deliberately no jobId, attemptId, workflowFamily, actionType,
 * classification, safeCode, staleness threshold, retry timestamp, dead-letter
 * flag, provider, recipient or template field in either schema at all — which is
 * stronger than accepting and ignoring them. CORE SELECTS THE WORK. n8n selects
 * nothing: not the job, the action, the family, the classification, the retry
 * time, the stale outcome, the dead-letter decision, the provider, the recipient
 * or the template.
 */
export const N8N_RECOVERY_REQUEST_KEYS = Object.freeze([
  "requestId",
  "transportVersion",
  "workerId",
] as const);

export interface N8nRecoveryRequestBody {
  transportVersion: 1;
  requestId: string;
  workerId: string;
}

export type RecoveryRequestParseResult =
  | { ok: true; body: N8nRecoveryRequestBody }
  | { ok: false; status: 400; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strict, closed parse. Any extra key is a hard refusal, never ignored. */
export function parseRecoveryRequestBody(
  rawBody: string,
): RecoveryRequestParseResult {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_JSON_INVALID" };
  }

  if (!isRecord(value)) {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_BODY_INVALID" };
  }

  const keys = Object.keys(value).sort();
  if (
    keys.length !== N8N_RECOVERY_REQUEST_KEYS.length ||
    keys.some((key, index) => key !== N8N_RECOVERY_REQUEST_KEYS[index])
  ) {
    return {
      ok: false,
      status: 400,
      code: "AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID",
    };
  }

  if (value.transportVersion !== 1) {
    return { ok: false, status: 400, code: "TRANSPORT_VERSION_INVALID" };
  }
  if (typeof value.requestId !== "string" || !UUID_RE.test(value.requestId)) {
    return {
      ok: false,
      status: 400,
      code: "AUTOMATION_TRANSPORT_REQUEST_ID_INVALID",
    };
  }
  if (typeof value.workerId !== "string" || !SAFE_WORKER_RE.test(value.workerId)) {
    return {
      ok: false,
      status: 400,
      code: "AUTOMATION_TRANSPORT_WORKER_ID_INVALID",
    };
  }

  return {
    ok: true,
    body: {
      transportVersion: 1,
      requestId: value.requestId,
      workerId: value.workerId,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Public orchestration vocabularies — one closed set per lane
// ---------------------------------------------------------------------------

/**
 * The COMPLETE, closed set of Core-authored `recover_v1` states. n8n branches on
 * this and on nothing else — never on the HTTP status, never on a body heuristic,
 * never on the presence of a field.
 *
 *   recovery_empty     no due `retry_scheduled` job was eligible. n8n stops.
 *   recovery_claimed    a NEW attempt exists and is owned. The response carries
 *                       the exact new attempt identity and the canonical
 *                       `workflowFamily`, and n8n's ONLY permitted decision is
 *                       which family execute boundary to forward that identity to.
 *   rejected            authentication, authorization or an invariant was not
 *                       proven. Nothing was recovered.
 */
export const AUTOMATION_RECOVER_ORCHESTRATION_STATES = Object.freeze([
  "recovery_empty",
  "recovery_claimed",
  "rejected",
] as const);

export type AutomationRecoverOrchestrationState =
  (typeof AUTOMATION_RECOVER_ORCHESTRATION_STATES)[number];

/**
 * The COMPLETE, closed set of Core-authored `reconcile_v1` states.
 *
 *   reconcile_empty      no stale current attempt was eligible. n8n stops.
 *   reconcile_finalized  the stale current attempt was finalized from durable
 *                        evidence through the FROZEN completion authority. The
 *                        job is now `retry_scheduled`, `succeeded`, `failed`,
 *                        `uncertain` or `dead_letter` — Core decided which, from
 *                        evidence. n8n stops: it must not execute, complete or
 *                        recover anything in response.
 *   reconcile_deferred   a stale attempt was examined and DELIBERATELY left
 *                        alone, because durable evidence proves another lane owns
 *                        it or because Core cannot yet prove the executor is
 *                        dead. Nothing was mutated. n8n stops.
 *   rejected             authentication, authorization or an invariant was not
 *                        proven, or the evidence was contradictory. Nothing was
 *                        mutated.
 */
export const AUTOMATION_RECONCILE_ORCHESTRATION_STATES = Object.freeze([
  "reconcile_empty",
  "reconcile_finalized",
  "reconcile_deferred",
  "rejected",
] as const);

export type AutomationReconcileOrchestrationState =
  (typeof AUTOMATION_RECONCILE_ORCHESTRATION_STATES)[number];

/** Sanitized `recover_v1` answer. */
export interface N8nRecoverSuccessBody {
  readonly ok: true;
  readonly transportVersion: 1;
  readonly requestId: string;
  readonly route: "recover_v1";
  readonly orchestrationState: Exclude<
    AutomationRecoverOrchestrationState,
    "rejected"
  >;
  readonly replayed: boolean;
  /**
   * Present ONLY on `recovery_claimed`. The canonical family comes from durable
   * action truth through the SQL action -> family map; it is never taken from a
   * request and never guessed by n8n.
   */
  readonly workflowFamily?: string;
  /** Present ONLY on `recovery_claimed`. The NEW attempt, never the old one. */
  readonly recovery?: {
    readonly jobId: string;
    readonly actionRequestId: string;
    readonly attemptId: string;
    readonly attemptNumber: number;
    readonly maxAttempts: number;
  };
}

/**
 * Sanitized `reconcile_v1` answer.
 *
 * `jobStatus`, `classification` and `safeCode` appear only on
 * `reconcile_finalized` and are OBSERVABILITY ONLY, exactly as the frozen
 * `complete_v1` response already exposes them. n8n must branch on
 * `orchestrationState` and on nothing else.
 *
 * Deliberately absent everywhere: recipient, destination, phone, template key,
 * variables, provider key, provider account, provider message id, raw provider
 * status/body/error, consent state, lead data, SQL, stack, secret, environment
 * value.
 */
export interface N8nReconcileSuccessBody {
  readonly ok: true;
  readonly transportVersion: 1;
  readonly requestId: string;
  readonly route: "reconcile_v1";
  readonly orchestrationState: Exclude<
    AutomationReconcileOrchestrationState,
    "rejected"
  >;
  readonly replayed: boolean;
  readonly jobStatus?: string;
  readonly classification?: string;
  readonly safeCode?: string;
}

export interface N8nRecoveryRejectionBody {
  readonly ok: false;
  readonly transportVersion: 1;
  readonly requestId: string;
  readonly route: "recover_v1" | "reconcile_v1";
  readonly orchestrationState: "rejected";
  readonly code: string;
}

export type RecoverResult =
  | { ok: true; body: N8nRecoverSuccessBody }
  | { ok: false; status: number; code: string };

export type ReconcileResult =
  | { ok: true; body: N8nReconcileSuccessBody }
  | { ok: false; status: number; code: string };

// ---------------------------------------------------------------------------
// 4. THE CLOSED STALE-EVIDENCE DECISION TABLE (owner-locked cases A-G)
// ---------------------------------------------------------------------------

/**
 * The durable facts a reconciliation decision is allowed to rest on. Every one
 * is read by Core from its OWN ledgers before this function is called; nothing
 * here is supplied by n8n and nothing here is a guess.
 */
export interface StaleAttemptEvidence {
  /**
   * Whether an `execute_v1` transport reservation exists for THIS EXACT attempt.
   * The reservation is identity-only: its presence proves an execution request
   * was durably accepted, never that anything was sent.
   */
  readonly executeReservationExists: boolean;
  /**
   * Whether that reservation is itself older than the stale threshold. A fresh
   * reservation means the execute route may still be running, so Core cannot
   * prove abandonment no matter how old the job lock is.
   */
  readonly executeReservationStale: boolean;
  /**
   * The persisted `communication_messages.status` for the Core-derived key
   * `qf_auto_v1:{jobId}:{attemptId}`, or null when NO row exists. Never a
   * provider status, never an inferred value.
   */
  readonly communicationStatus: string | null;
}

export type StaleReconcileDisposition =
  /** Finalize the stale current attempt through the frozen completion authority. */
  | {
      readonly disposition: "finalize";
      readonly classification: AutomationResultClassification;
      readonly safeCode: string;
      /** Only ever a real communication_messages.id, and only when one exists. */
      readonly useCommunicationEvidenceReference: boolean;
      readonly caseId: StaleEvidenceCaseId;
    }
  /** Examine and deliberately leave alone. Nothing is mutated. */
  | {
      readonly disposition: "defer";
      readonly code: string;
      readonly caseId: StaleEvidenceCaseId;
    }
  /** Contradictory or unrecognised evidence. Fail closed; mutate nothing. */
  | {
      readonly disposition: "anomaly";
      readonly code: string;
      readonly caseId: StaleEvidenceCaseId;
    };

export type StaleEvidenceCaseId =
  | "A_NO_EXECUTE_EVIDENCE"
  | "B_RESERVED_NO_COMMUNICATION"
  | "B_RESERVATION_TOO_FRESH"
  | "C_COMMUNICATION_LANE_OWNS"
  | "D_COMMUNICATION_SUCCESS"
  | "E_COMMUNICATION_DEFINITIVE_FAILURE"
  | "F_OUTCOME_UNCERTAIN"
  | "G_CONTRADICTORY_EVIDENCE";

/**
 * The owner-locked table, total over its input.
 *
 * A. NO execute_v1 evidence at all -> SAFE pre-execution retry. The claim
 *    committed and the execute request never durably arrived, so no communication
 *    row can exist and no provider was contacted. The job-lock staleness the
 *    caller already proved is what makes "never arrived" provable.
 *
 * B. execute_v1 reserved, NO communication row -> SAFE pre-communication retry,
 *    but ONLY once the reservation itself is stale.
 *
 *    WHY THIS IS SAFE AND NOT AN ASSUMPTION. `services/communicationService.ts`
 *    resolves template, recipient, consent, provider mapping and runtime gate and
 *    returns BEFORE any persistence on every failure path, then persists the
 *    `communication_messages` row and claims it with a compare-and-set, and only
 *    THEN calls the provider. A provider call therefore cannot precede durable
 *    communication persistence. "Reserved, and still no row after the threshold"
 *    consequently means the send never began.
 *
 *    RESIDUAL RISK, STATED HONESTLY: a process wedged for longer than the
 *    threshold strictly between reserving and persisting would be misread as
 *    abandoned. The threshold is derived to more than double the maximum
 *    legitimate in-flight window precisely to make that window vanishingly small,
 *    and the fresh-reservation branch below refuses to act before it elapses.
 *
 * C. communication queued / dispatching / retry_scheduled -> automation MUST NOT
 *    retry. THE COMMUNICATION LANE OWNS THAT ROW. A new automation attempt would
 *    mint a new `qf_auto_v1:{jobId}:{attemptId}` key, therefore a SECOND
 *    communication row and a SECOND provider send. Defer, mutate nothing.
 *
 * D. communication success (accepted/sent/delivered/read) -> reconcile to the
 *    canonical terminal success.
 *
 * E. communication definitive failure (failed/dead_letter/cancelled) -> reconcile
 *    to the canonical definitive failure.
 *
 * F. outcome_unknown -> `uncertain`, which is TERMINAL. Never converted into a
 *    retry, in either direction.
 *
 * G. anything unrecognised or self-contradictory -> anomaly. Core does not guess.
 *
 * Note that no branch here can produce `retryable_failure` from a communication
 * status: `resolveCompletionEvidenceRuling` never returns one. Automation retry
 * is reachable ONLY from cases A and B, where no communication row exists at all.
 */
export function resolveStaleReconcileDisposition(
  evidence: StaleAttemptEvidence,
): StaleReconcileDisposition {
  if (evidence.communicationStatus !== null) {
    if (typeof evidence.communicationStatus !== "string") {
      return {
        disposition: "anomaly",
        code: "AUTOMATION_RECONCILE_COMMUNICATION_STATE_UNKNOWN",
        caseId: "G_CONTRADICTORY_EVIDENCE",
      };
    }

    const partition = resolveCommunicationExecutionPartition(
      evidence.communicationStatus,
    );
    if (!partition) {
      return {
        disposition: "anomaly",
        code: "AUTOMATION_RECONCILE_COMMUNICATION_STATE_UNKNOWN",
        caseId: "G_CONTRADICTORY_EVIDENCE",
      };
    }

    if (partition === "pending") {
      // CASE C. Not a failure of anything — a correct handover.
      return {
        disposition: "defer",
        code: "AUTOMATION_RECONCILE_COMMUNICATION_LANE_OWNS_ROW",
        caseId: "C_COMMUNICATION_LANE_OWNS",
      };
    }

    const ruling = resolveCompletionEvidenceRuling(evidence.communicationStatus);
    if (!ruling.completable) {
      // The two tables are derived from each other, so this is unreachable while
      // they agree. It stays a fail-closed anomaly rather than an assumption.
      return {
        disposition: "anomaly",
        code: "AUTOMATION_RECONCILE_EVIDENCE_PARTITION_DISAGREEMENT",
        caseId: "G_CONTRADICTORY_EVIDENCE",
      };
    }

    return {
      disposition: "finalize",
      classification: ruling.classification,
      safeCode: ruling.safeCode,
      useCommunicationEvidenceReference: true,
      caseId:
        ruling.classification === "success"
          ? "D_COMMUNICATION_SUCCESS"
          : ruling.classification === "uncertain"
            ? "F_OUTCOME_UNCERTAIN"
            : "E_COMMUNICATION_DEFINITIVE_FAILURE",
    };
  }

  if (!evidence.executeReservationExists) {
    // CASE A.
    return {
      disposition: "finalize",
      classification: "retryable_failure",
      safeCode: "QF_RECOVER_PRE_EXECUTION_ABANDONED",
      useCommunicationEvidenceReference: false,
      caseId: "A_NO_EXECUTE_EVIDENCE",
    };
  }

  if (!evidence.executeReservationStale) {
    // The execute route may still legitimately be running. Refusing here is what
    // stops case B from ever racing a live execution.
    return {
      disposition: "defer",
      code: "AUTOMATION_RECONCILE_EXECUTION_RESERVATION_TOO_FRESH",
      caseId: "B_RESERVATION_TOO_FRESH",
    };
  }

  // CASE B.
  return {
    disposition: "finalize",
    classification: "retryable_failure",
    safeCode: "QF_RECOVER_PRE_COMMUNICATION_ABANDONED",
    useCommunicationEvidenceReference: false,
    caseId: "B_RESERVED_NO_COMMUNICATION",
  };
}

/**
 * The exact SQL disposition vocabulary the reconcile transport RPC accepts. The
 * `anomaly` disposition is deliberately NOT in this list: an anomaly never
 * reaches SQL at all, because Core refuses before calling it and therefore
 * consumes no durable request identity for a state it cannot explain.
 */
export const RECONCILE_SQL_DISPOSITIONS = Object.freeze([
  "finalize",
  "defer",
  "empty",
] as const);

export type ReconcileSqlDisposition =
  (typeof RECONCILE_SQL_DISPOSITIONS)[number];
