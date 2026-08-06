// ============================================================================
// QuickFurno — QF-MVP-50.2D signed attempt-completion contract
//
// Pure module: no database, network, environment, clock, logging or provider
// import. It completes no attempt, sends nothing and resolves no recipient,
// template, provider account or consent state.
//
// AUTHORITY
//   n8n is NOT completion authority. The request body below carries NO
//   classification, NO safe code and NO retry timestamp — those fields do not
//   exist in the schema at all, which is a stronger guarantee than accepting
//   and ignoring them. Core derives every one of them from its own
//   communication ledger, reached through the Core-derived idempotency key
//   qf_auto_v1:{jobId}:{attemptId}.
//
//   The single reference n8n may supply is `executorReference`, and it is
//   evidence to be CHECKED, never a pointer to be followed: Core resolves the
//   communication row by its own key first and then requires equality.
// ============================================================================

import type { AutomationResultClassification } from "./actionContract";
import type { CommunicationMessageStatus } from "@/lib/communication/types";

/** Exactly the six keys a completion request may carry. Order-independent. */
export const N8N_COMPLETE_REQUEST_KEYS = Object.freeze([
  "attemptId",
  "executorReference",
  "jobId",
  "requestId",
  "transportVersion",
  "workerId",
] as const);

export interface N8nCompleteRequestBody {
  transportVersion: 1;
  requestId: string;
  workerId: string;
  jobId: string;
  attemptId: string;
  executorReference: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export type CompletionRequestParseResult =
  | { ok: true; body: N8nCompleteRequestBody }
  | { ok: false; status: 400; code: string };

/**
 * Strict, closed parse. Unknown keys are rejected outright rather than ignored:
 * a silently dropped field is how an unauthorized override eventually arrives.
 */
export function parseCompletionRequestBody(
  rawBody: string,
): CompletionRequestParseResult {
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
  const keys = Object.keys(record).sort();
  if (
    keys.length !== N8N_COMPLETE_REQUEST_KEYS.length ||
    keys.some((key, index) => key !== N8N_COMPLETE_REQUEST_KEYS[index])
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
    typeof record.attemptId !== "string" ||
    typeof record.executorReference !== "string"
  ) {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_BODY_INVALID" };
  }

  if (
    !UUID_RE.test(record.requestId) ||
    !UUID_RE.test(record.jobId) ||
    !UUID_RE.test(record.attemptId) ||
    !UUID_RE.test(record.executorReference) ||
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
      executorReference: record.executorReference,
    },
  };
}

// ---------------------------------------------------------------------------
// Core completion evidence
// ---------------------------------------------------------------------------

export type CompletionEvidenceRuling =
  | {
      readonly completable: true;
      readonly classification: AutomationResultClassification;
      readonly safeCode: string;
    }
  | {
      readonly completable: false;
      readonly code: string;
    };

/**
 * The canonical communication status -> automation classification table.
 *
 * Every entry is justified by the exact Core writer that can produce that
 * status; nothing is inferred from routing, from a claim, from an internal
 * HTTP 200 or from an n8n workflow finishing.
 *
 *   accepted  Written ONLY by recordDispatchSuccess, which is reached ONLY when
 *             effectiveOutcomeCertainty(result) === "accepted" (which itself
 *             requires result.accepted === true). It is proven provider
 *             acceptance, not internal queueing — `queued` is that state.
 *   sent      recordDispatchSuccess with a synchronous provider "sent", or a
 *             verified forward webhook.
 *   delivered Verified forward webhook from accepted/sent/outcome_unknown.
 *   read      Verified forward webhook.
 *
 *   retry_scheduled  recordDispatchFailure with result.retryable, a lane that
 *                    allows retry, and attempts remaining. This is Core's own
 *                    normalized retry-safe failure.
 *
 *   failed      A non-retryable provider failure, or markMessageFailed for a
 *               terminal failure that never reached the provider.
 *   dead_letter recordDispatchFailure with a retryable error whose attempts are
 *               exhausted. Terminal for automation too: a fresh automation
 *               attempt would mint a NEW idempotency key and therefore a NEW
 *               message, amplifying a send the communication lane already gave
 *               up on. Fail closed rather than resend.
 *   cancelled   Administratively terminal.
 *
 *   outcome_unknown  recordDispatchFailure when effectiveOutcomeCertainty is
 *                    "unknown_outcome": the provider may have accepted and Core
 *                    can neither prove nor disprove it. This is exactly the
 *                    automation `uncertain` meaning — terminal, never resent.
 *
 *   queued / dispatching  NOT completable. `queued` means no dispatch has begun;
 *                         `dispatching` means a provider call is still in flight
 *                         and its outcome is genuinely unresolved. Guessing here
 *                         would either fabricate a success or burn an attempt as
 *                         uncertain while the send is still live, so the callback
 *                         is refused and the attempt is left owned and open.
 *                         Genuinely stuck rows are QF-MVP-50.5's problem.
 */
export const COMPLETION_EVIDENCE_RULINGS: Readonly<
  Record<CommunicationMessageStatus, CompletionEvidenceRuling>
> = Object.freeze({
  queued: {
    completable: false,
    code: "AUTOMATION_COMPLETION_EVIDENCE_UNRESOLVED",
  },
  dispatching: {
    completable: false,
    code: "AUTOMATION_COMPLETION_EVIDENCE_UNRESOLVED",
  },
  accepted: {
    completable: true,
    classification: "success",
    safeCode: "QF_COMM_ACCEPTED",
  },
  sent: {
    completable: true,
    classification: "success",
    safeCode: "QF_COMM_SENT",
  },
  delivered: {
    completable: true,
    classification: "success",
    safeCode: "QF_COMM_DELIVERED",
  },
  read: {
    completable: true,
    classification: "success",
    safeCode: "QF_COMM_READ",
  },
  retry_scheduled: {
    completable: true,
    classification: "retryable_failure",
    safeCode: "QF_COMM_RETRY_SCHEDULED",
  },
  failed: {
    completable: true,
    classification: "definitive_failure",
    safeCode: "QF_COMM_FAILED",
  },
  dead_letter: {
    completable: true,
    classification: "definitive_failure",
    safeCode: "QF_COMM_DEAD_LETTER",
  },
  cancelled: {
    completable: true,
    classification: "definitive_failure",
    safeCode: "QF_COMM_CANCELLED",
  },
  outcome_unknown: {
    completable: true,
    classification: "uncertain",
    safeCode: "QF_COMM_OUTCOME_UNKNOWN",
  },
});

/**
 * Total over the closed communication status vocabulary. A status Core does not
 * recognise — a future ledger value this table has not been taught — fails
 * closed rather than inheriting a neighbouring meaning.
 */
export function resolveCompletionEvidenceRuling(
  status: unknown,
): CompletionEvidenceRuling {
  if (typeof status !== "string") {
    return {
      completable: false,
      code: "AUTOMATION_COMPLETION_EVIDENCE_UNKNOWN_STATE",
    };
  }

  const ruling = (
    COMPLETION_EVIDENCE_RULINGS as Record<string, CompletionEvidenceRuling | undefined>
  )[status];

  return (
    ruling ?? {
      completable: false,
      code: "AUTOMATION_COMPLETION_EVIDENCE_UNKNOWN_STATE",
    }
  );
}
