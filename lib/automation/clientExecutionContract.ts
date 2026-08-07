// ============================================================================
// QuickFurno — QF-MVP-50.2E signed client-execution contract
//
// Pure module: no database, network, environment, clock, logging or provider
// import. It executes nothing, sends nothing, and resolves no recipient,
// template, provider account or consent state.
//
// AUTHORITY
//   n8n is NOT execution authority. The request body below carries ONLY
//   transport and identity fields — five keys, nothing else. Every business
//   fact (action, workflow family, entity, recipient, template, variables,
//   consent, provider mapping, provider account, idempotency key) is rebuilt by
//   Core from its own ledgers and registries. A body offering any business
//   field is rejected outright rather than accepted and ignored: a silently
//   dropped field is how an unauthorized override eventually arrives.
//
//   `executorReference` is deliberately NOT an input here. This is the exact
//   inverse of QF-MVP-50.2D, which accepts it as evidence to CHECK. 50.2E MINTS
//   it, and only ever from a real `communication_messages.id`.
// ============================================================================

import {
  findForbiddenAutomationField,
  type AutomationResultClassification,
} from "./actionContract";
import type { CommunicationMessageStatus } from "@/lib/communication/types";

/** Exactly the five keys an execution request may carry. Order-independent. */
export const N8N_EXECUTE_CLIENT_REQUEST_KEYS = Object.freeze([
  "attemptId",
  "jobId",
  "requestId",
  "transportVersion",
  "workerId",
] as const);

export interface N8nExecuteClientRequestBody {
  transportVersion: 1;
  requestId: string;
  workerId: string;
  jobId: string;
  attemptId: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export type ExecuteClientRequestParseResult =
  | { ok: true; body: N8nExecuteClientRequestBody }
  | { ok: false; status: 400; code: string };

/**
 * Strict, closed parse.
 *
 * Two independent fences, in this order:
 *   1. the FORBIDDEN-TOKEN scan (`findForbiddenAutomationField`), so a body that
 *      smuggles `recipientPhone`, `templateKey`, `providerAccountId`, `token`
 *      and friends is named as a forbidden-field violation rather than lumped in
 *      with an ordinary typo;
 *   2. exact key-set equality against the five permitted keys, so ANY other
 *      unknown key — including ones the token list has never heard of — is still
 *      rejected.
 *
 * Fence 2 alone would be sufficient for safety. Fence 1 exists so the refusal is
 * legible in the transport log, and so the shared automation forbidden-key
 * vocabulary is exercised on every inbound execution request.
 */
export function parseExecuteClientRequestBody(
  rawBody: string,
): ExecuteClientRequestParseResult {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_JSON_INVALID" };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_BODY_INVALID" };
  }

  const record = value as Record<string, unknown>;

  const forbidden = findForbiddenAutomationField(record);
  if (forbidden) {
    return {
      ok: false,
      status: 400,
      code: "AUTOMATION_EXECUTION_FORBIDDEN_FIELD",
    };
  }

  const keys = Object.keys(record).sort();
  if (
    keys.length !== N8N_EXECUTE_CLIENT_REQUEST_KEYS.length ||
    keys.some((key, index) => key !== N8N_EXECUTE_CLIENT_REQUEST_KEYS[index])
  ) {
    return {
      ok: false,
      status: 400,
      code: "AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID",
    };
  }

  if (
    record.transportVersion !== 1 ||
    typeof record.requestId !== "string" ||
    typeof record.workerId !== "string" ||
    typeof record.jobId !== "string" ||
    typeof record.attemptId !== "string"
  ) {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_BODY_INVALID" };
  }

  if (
    !UUID_RE.test(record.requestId) ||
    !UUID_RE.test(record.jobId) ||
    !UUID_RE.test(record.attemptId) ||
    !SAFE_WORKER_RE.test(record.workerId)
  ) {
    return {
      ok: false,
      status: 400,
      code: "AUTOMATION_TRANSPORT_BODY_IDENTITY_INVALID",
    };
  }

  return {
    ok: true,
    body: {
      transportVersion: 1,
      requestId: record.requestId,
      workerId: record.workerId,
      jobId: record.jobId,
      attemptId: record.attemptId,
    },
  };
}

// ---------------------------------------------------------------------------
// Public orchestration vocabulary
// ---------------------------------------------------------------------------

/**
 * The COMPLETE, closed set of Core-authored orchestration states. n8n branches on
 * this and on nothing else — never on the HTTP status, never on a body heuristic,
 * never on the presence of a field.
 *
 *   execution_recorded    a REAL communication row exists for this attempt and its
 *                         persisted status is completion-ready. `executorReference`
 *                         is present and is that row's id. n8n calls QF-MVP-50.2D.
 *
 *   communication_pending a REAL communication row exists but its persisted status
 *                         is NOT completable — `queued`, `dispatching` or
 *                         `retry_scheduled`. `executorReference` is DELIBERATELY
 *                         ABSENT so a state-blind orchestrator cannot even build a
 *                         50.2D body. n8n stops: no completion, no re-execution,
 *                         and above all NO new automation attempt. The automation
 *                         attempt stays owned and open.
 *
 *   attempt_finalized     NO communication row exists and Core itself finalized a
 *                         safely classifiable pre-communication failure through the
 *                         existing attempt-completion authority. No
 *                         `executorReference` — there is no communication row to
 *                         reference. n8n stops and MUST NOT call 50.2D.
 *
 *   rejected              the request, its authentication, its ownership, its
 *                         current-attempt currency, or its action-family authority
 *                         was not proven — or the outcome could not be safely
 *                         classified. The attempt is NEVER silently consumed.
 */
export const AUTOMATION_EXECUTION_ORCHESTRATION_STATES = Object.freeze([
  "execution_recorded",
  "communication_pending",
  "attempt_finalized",
  "rejected",
] as const);

export type AutomationExecutionOrchestrationState =
  (typeof AUTOMATION_EXECUTION_ORCHESTRATION_STATES)[number];

export function isAutomationExecutionOrchestrationState(
  value: unknown,
): value is AutomationExecutionOrchestrationState {
  return (
    typeof value === "string" &&
    (AUTOMATION_EXECUTION_ORCHESTRATION_STATES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Communication status partition
// ---------------------------------------------------------------------------

export type CommunicationExecutionPartition = "completion_ready" | "pending";

/**
 * The canonical partition of the closed communication status vocabulary into the
 * two orchestration branches 50.2E may take when a REAL communication row exists.
 *
 * It is deliberately DERIVED FROM, and consistent with, the QF-MVP-50.2D
 * completion rulings: everything 50.2D can complete is `completion_ready`, and
 * everything 50.2D refuses as unresolved or retry-pending is `pending`. The two
 * modules must never disagree, because a `completion_ready` verdict here is
 * precisely an instruction to call 50.2D.
 *
 *   queued           no dispatch has begun.
 *   dispatching      a provider call is in flight; the outcome is unresolved.
 *   retry_scheduled  THE COMMUNICATION LANE OWNS A PENDING PROVIDER RETRY FOR THIS
 *                    EXACT ROW. `dispatchPersistedMessage` accepts precisely
 *                    `queued` and `retry_scheduled` and re-dispatches the SAME row
 *                    under the SAME idempotency key. Opening a NEW automation
 *                    attempt here would mint a NEW qf_auto_v1:{jobId}:{attemptId}
 *                    key, therefore a SECOND communication row and a SECOND
 *                    provider send — two independent retry mechanisms over one
 *                    logical send. 50.2E therefore NEVER creates a new attempt for
 *                    a pending communication row, and never re-dispatches one.
 *
 * HONEST LIMIT: no communication due-sweep exists in this repository today —
 * `dispatchPersistedMessage` has no production caller. A `pending` row is
 * therefore not reconcilable by 50.2E and is not made reconcilable by 50.2E.
 * Recovery of pending/stuck rows belongs to QF-MVP-50.5 and to a separately
 * governed communication retry sweep. Fabricating one here would be exactly the
 * duplicate-send defect described above.
 */
export const COMMUNICATION_EXECUTION_PARTITION: Readonly<
  Record<CommunicationMessageStatus, CommunicationExecutionPartition>
> = Object.freeze({
  queued: "pending",
  dispatching: "pending",
  retry_scheduled: "pending",
  accepted: "completion_ready",
  sent: "completion_ready",
  delivered: "completion_ready",
  read: "completion_ready",
  failed: "completion_ready",
  dead_letter: "completion_ready",
  cancelled: "completion_ready",
  outcome_unknown: "completion_ready",
});

/**
 * Total over the closed vocabulary. A status Core does not recognise — a future
 * ledger value this table has not been taught — returns `null` and fails closed
 * rather than inheriting a neighbouring meaning.
 */
export function resolveCommunicationExecutionPartition(
  status: unknown,
): CommunicationExecutionPartition | null {
  if (typeof status !== "string") return null;
  return (
    (
      COMMUNICATION_EXECUTION_PARTITION as Record<
        string,
        CommunicationExecutionPartition | undefined
      >
    )[status] ?? null
  );
}

// ---------------------------------------------------------------------------
// Pre-communication failure rulings (the ONLY input to B1)
// ---------------------------------------------------------------------------

export interface PreCommunicationRuling {
  readonly classification: AutomationResultClassification;
  readonly safeCode: string;
}

/**
 * The closed table Core uses to classify a failure that produced NO
 * `communication_messages` row at all.
 *
 * REACHABILITY RULE. This table is consulted ONLY after Core has re-read
 * `communication_messages` by its own derived key `qf_auto_v1:{jobId}:{attemptId}`
 * and PROVEN that no row exists. When a row exists, the persisted communication
 * status is the sole authority and this table is never consulted — that is what
 * makes "no fabricated communication evidence" a structural property rather than
 * a convention.
 *
 * DEFINITIVE vs RETRYABLE. A `retryable_failure` opens a NEW automation attempt,
 * which mints a NEW idempotency key. That is only safe because no communication
 * row exists, so there is nothing for the communication lane to retry — this is
 * exactly the genuine automation-level retryable failure QF-MVP-50.2D anticipated
 * but could not yet reach.
 *
 *   definitive_failure  a standing configuration/readiness/business fact. Retrying
 *                       cannot change it without a human or provider act:
 *                       a missing or draft internal template, an absent approved
 *                       mapping, a refused runtime gate, an unresolvable or
 *                       missing recipient, a mismatched channel/lane, a consent
 *                       REFUSAL, an untrustworthy consent authority, or an invalid
 *                       enforcement request. Blindly retrying any of these would be
 *                       the "no blind retry" defect.
 *
 *   retryable_failure   a genuine, bounded INFRASTRUCTURE transient proven by the
 *                       existing source: the recipient LOOKUP itself broke, the
 *                       consent authority was UNAVAILABLE (as distinct from
 *                       denying), the provider runtime could not be resolved at
 *                       all, or the message ledger write/claim lost a concurrency
 *                       race. Each of these is already treated as re-runnable by
 *                       the communication layer that produced it.
 *
 * ANYTHING NOT LISTED IS UNCLASSIFIABLE. Core does not guess: it returns `null`,
 * the caller answers `rejected`, and the attempt is left OWNED AND OPEN for
 * QF-MVP-50.5 recovery. Silence is never converted into a verdict.
 */
export const PRE_COMMUNICATION_FAILURE_RULINGS: Readonly<
  Record<string, PreCommunicationRuling>
> = Object.freeze({
  // --- internal template registry -----------------------------------------
  TEMPLATE_NOT_FOUND_OR_INACTIVE: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_TEMPLATE_UNAVAILABLE",
  },
  TEMPLATE_NOT_READY: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_TEMPLATE_NOT_READY",
  },
  TEMPLATE_LANE_MISMATCH: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_TEMPLATE_CONTRACT_INVALID",
  },
  TEMPLATE_CHANNEL_MISMATCH: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_TEMPLATE_CONTRACT_INVALID",
  },

  // --- channel / provider identity ----------------------------------------
  UNSUPPORTED_DISPATCH_CHANNEL: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_CHANNEL_UNSUPPORTED",
  },
  UNSUPPORTED_DISPATCH_PROVIDER: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_PROVIDER_IDENTITY_REFUSED",
  },

  // --- recipient resolution -------------------------------------------------
  // A recipient that cannot be resolved is a standing data fact; a lookup that
  // BROKE is infrastructure. The two are deliberately classified differently.
  RECIPIENT_NOT_FOUND: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_RECIPIENT_UNRESOLVABLE",
  },
  RECIPIENT_ID_REQUIRED: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_RECIPIENT_UNRESOLVABLE",
  },
  RECIPIENT_TYPE_UNSUPPORTED: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_RECIPIENT_UNRESOLVABLE",
  },
  RECIPIENT_DESTINATION_MISSING: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_RECIPIENT_UNRESOLVABLE",
  },
  RECIPIENT_DESTINATION_INVALID: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_RECIPIENT_UNRESOLVABLE",
  },
  RECIPIENT_LOOKUP_FAILED: {
    classification: "retryable_failure",
    safeCode: "QF_EXEC_INFRASTRUCTURE_TRANSIENT",
  },

  // --- consent -------------------------------------------------------------
  // A single generic safe code for every REFUSAL, so the callback surface cannot
  // be used to distinguish suppression from absent consent from an unclassified
  // message type. Consent STATE is never inferable from an automation safe code.
  CONSENT_SUPPRESSED: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_DISPATCH_NOT_AUTHORIZED",
  },
  CONSENT_NOT_GRANTED: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_DISPATCH_NOT_AUTHORIZED",
  },
  UNCLASSIFIED_MESSAGE_TYPE: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_DISPATCH_NOT_AUTHORIZED",
  },
  MESSAGE_TYPE_TEMPLATE_MISMATCH: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_DISPATCH_NOT_AUTHORIZED",
  },
  MESSAGE_LANE_SCOPE_MISMATCH: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_DISPATCH_NOT_AUTHORIZED",
  },
  CONSENT_ENFORCEMENT_INVALID: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_CONSENT_AUTHORITY_UNTRUSTWORTHY",
  },
  CONSENT_AUTHORITY_INTEGRITY: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_CONSENT_AUTHORITY_UNTRUSTWORTHY",
  },
  // Infrastructure, not a decision — the existing business-lane behaviour leaves
  // the row untouched and returns a retryable failure.
  CONSENT_AUTHORITY_UNAVAILABLE: {
    classification: "retryable_failure",
    safeCode: "QF_EXEC_INFRASTRUCTURE_TRANSIENT",
  },

  // --- approved provider mapping / runtime gate -----------------------------
  // Every one of these requires a human, an operator or Meta to act. None is
  // auto-retryable: "template not ready" must never become a blind retry.
  APPROVED_TEMPLATE_COORDINATOR_UNAVAILABLE: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_PROVIDER_NOT_READY",
  },
  APPROVED_TEMPLATE_SENDER_UNSUPPORTED: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_PROVIDER_NOT_READY",
  },
  META_OUTBOUND_CONFIG_MISSING: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_PROVIDER_NOT_READY",
  },
  META_RUNTIME_GATE_BLOCKED: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_PROVIDER_NOT_READY",
  },
  META_FINAL_RUNTIME_GATE_BLOCKED: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_PROVIDER_NOT_READY",
  },
  META_APPROVED_MAPPING_UNRESOLVED: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_PROVIDER_MAPPING_UNAVAILABLE",
  },
  META_MAPPING_IDENTITY_MISSING: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_PROVIDER_MAPPING_UNAVAILABLE",
  },
  META_MAPPING_IDENTITY_CHANGED: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_PROVIDER_MAPPING_UNAVAILABLE",
  },
  META_MAPPING_FINGERPRINT_MISSING: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_PROVIDER_MAPPING_UNAVAILABLE",
  },
  META_MAPPING_FINGERPRINT_MISMATCH: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_PROVIDER_MAPPING_UNAVAILABLE",
  },
  META_INTERNAL_TEMPLATE_UNRESOLVED: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_TEMPLATE_UNAVAILABLE",
  },

  // --- runtime provider selection ------------------------------------------
  WHATSAPP_PROVIDER_NOT_CONFIGURED: {
    classification: "retryable_failure",
    safeCode: "QF_EXEC_INFRASTRUCTURE_TRANSIENT",
  },

  // --- ledger write / concurrency ------------------------------------------
  MESSAGE_INSERT_FAILED: {
    classification: "retryable_failure",
    safeCode: "QF_EXEC_INFRASTRUCTURE_TRANSIENT",
  },
  MESSAGE_ALREADY_CLAIMED: {
    classification: "retryable_failure",
    safeCode: "QF_EXEC_INFRASTRUCTURE_TRANSIENT",
  },

  // --- Core-side pre-flight (proven by Core BEFORE the communication call) ---
  QF_EXEC_LEAD_NOT_FOUND: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_LEAD_NOT_FOUND",
  },
  QF_EXEC_VARIABLES_UNRESOLVED: {
    classification: "definitive_failure",
    safeCode: "QF_EXEC_VARIABLES_UNRESOLVED",
  },
  QF_EXEC_LEAD_LOOKUP_FAILED: {
    classification: "retryable_failure",
    safeCode: "QF_EXEC_INFRASTRUCTURE_TRANSIENT",
  },
});

/**
 * Returns `null` for anything not explicitly ruled on. `null` means "Core cannot
 * safely classify this", NOT "this succeeded" and NOT "this failed definitively".
 * The caller must answer `rejected` and leave the attempt owned and open.
 */
export function resolvePreCommunicationRuling(
  code: unknown,
): PreCommunicationRuling | null {
  if (typeof code !== "string" || code === "") return null;
  return (
    (
      PRE_COMMUNICATION_FAILURE_RULINGS as Record<
        string,
        PreCommunicationRuling | undefined
      >
    )[code] ?? null
  );
}
