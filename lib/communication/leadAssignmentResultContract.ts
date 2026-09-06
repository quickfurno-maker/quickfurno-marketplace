// ============================================================================
// QuickFurno — lib/communication/leadAssignmentResultContract.ts
//
// QF-MVP-80.17A — the PURE decision for converging a lead-assignment intent onto
// the terminal truth of its canonical message.
//
// THE DRIFT THIS REPAIRS
//   The lane projects `pending -> dispatched` the moment CommunicationService
//   accepts a send. Later a signed Meta webhook moves the canonical
//   communication_messages row to delivered / read / failed — and nothing
//   reconciled the derived communication_intents row, which stayed `dispatched`
//   forever. QF-MVP-80.16D-R2 proved it in production: message `failed`, intent
//   `dispatched`.
//
// DIRECTION OF TRUTH IS FIXED AND ONE-WAY
//   communication_messages is canonical delivery truth.
//   communication_intents is a DERIVED PROJECTION of it.
//   This module can only ever move the projection toward the message. It has no
//   opinion about delivery, invents no status vocabulary, and can never make the
//   intent authoritative over the message.
//
// IT REUSES THE EXISTING AUTHORITY, IT DOES NOT ADD ONE
//   `projectIntentStatus` (message status -> intent status) and
//   `isForwardTransition` (legal progression, no lateral delivered<->failed move)
//   both come from campaignResultContract.ts unchanged. There is deliberately no
//   second mapping here — a new message status must be decided THERE, once.
//
// WHAT IT CANNOT DO
//   It is pure: no I/O, no clock, no randomness, no database, no provider. It
//   returns either a single-column write PLAN or a named refusal. The plan can
//   only ever name `communication_intents.status`, so no send, no message, no
//   assignment, no credit and no vendor write is reachable from this decision.
//
// LINKAGE IS DETERMINISTIC OR IT IS REFUSED
//   A message may reconcile an intent only when the deterministic link the
//   dispatcher created still holds in every respect — including the exact
//   idempotency key `leadAssignmentMessageIdempotencyKey(intent.id)`. Nothing is
//   inferred from recency, recipient, vendor, assignment or provider ordering.
// ============================================================================

import {
  INTENT_ENTITY_TYPE,
  IntentResultStatus,
  isForwardTransition,
  projectIntentStatus,
  type IntentResultStatusValue,
} from "./campaignResultContract";
import {
  LEAD_ASSIGNMENT_AGGREGATE_TYPE,
  LEAD_ASSIGNMENT_INTENT_CHANNEL,
  LEAD_ASSIGNMENT_TEMPLATE_KEY,
  LEAD_ASSIGNMENT_TEMPLATE_PURPOSE,
  leadAssignmentMessageIdempotencyKey,
} from "./leadAssignmentDispatchContract";
import type { CommunicationMessageStatus } from "./types";

/** The one table this decision may ever name. */
export const LEAD_ASSIGNMENT_RECONCILE_TABLE = "communication_intents" as const;

/** The one column it may ever write. `dispatched_at` is deliberately absent. */
export const LEAD_ASSIGNMENT_RECONCILE_COLUMN = "status" as const;

/**
 * The eleven canonical message statuses. Listed so an unrecognised value is
 * REFUSED rather than silently projected through an undefined lookup.
 */
const KNOWN_MESSAGE_STATUSES: readonly CommunicationMessageStatus[] = Object.freeze([
  "queued", "dispatching", "accepted", "sent", "delivered", "read",
  "failed", "retry_scheduled", "dead_letter", "cancelled", "outcome_unknown",
] as unknown as CommunicationMessageStatus[]);

const KNOWN_INTENT_STATUSES: readonly IntentResultStatusValue[] = Object.freeze([
  IntentResultStatus.PENDING,
  IntentResultStatus.CLAIMED,
  IntentResultStatus.DISPATCHED,
  IntentResultStatus.DELIVERED,
  IntentResultStatus.FAILED,
  IntentResultStatus.UNCERTAIN,
]);

// ---------------------------------------------------------------------------
// The closed outcome vocabulary
// ---------------------------------------------------------------------------

export const LeadAssignmentReconcileOutcome = Object.freeze({
  /** A legal forward terminal move. `plan` carries the exact write. */
  APPLIED: "APPLIED",
  /** The projection already equals the intent's status. No write, ever. */
  NOOP_SAME_STATUS: "NOOP_SAME_STATUS",
  /** The message has not reached a terminal state. Terminal truth is not fabricated. */
  NOOP_NON_TERMINAL_MESSAGE: "NOOP_NON_TERMINAL_MESSAGE",
  /** delivered<->failed, or any backward move. Refused by isForwardTransition. */
  REFUSED_REGRESSION: "REFUSED_REGRESSION",

  /** Not this lane's work. Deterministic and NOT an error. */
  NOT_APPLICABLE_MESSAGE_NOT_INTENT_LINKED: "NOT_APPLICABLE_MESSAGE_NOT_INTENT_LINKED",
  NOT_APPLICABLE_NOT_LEAD_ASSIGNMENT: "NOT_APPLICABLE_NOT_LEAD_ASSIGNMENT",

  /** Linkage disagreements — every one fails closed. */
  REFUSED_MESSAGE_NOT_FOUND: "REFUSED_MESSAGE_NOT_FOUND",
  REFUSED_INTENT_NOT_FOUND: "REFUSED_INTENT_NOT_FOUND",
  REFUSED_INTENT_IDENTITY_INVALID: "REFUSED_INTENT_IDENTITY_INVALID",
  REFUSED_INTENT_CHANNEL_MISMATCH: "REFUSED_INTENT_CHANNEL_MISMATCH",
  REFUSED_INTENT_PURPOSE_MISMATCH: "REFUSED_INTENT_PURPOSE_MISMATCH",
  REFUSED_MESSAGE_ENTITY_ID_MISMATCH: "REFUSED_MESSAGE_ENTITY_ID_MISMATCH",
  REFUSED_MESSAGE_CHANNEL_MISMATCH: "REFUSED_MESSAGE_CHANNEL_MISMATCH",
  REFUSED_MESSAGE_TEMPLATE_MISMATCH: "REFUSED_MESSAGE_TEMPLATE_MISMATCH",
  REFUSED_MESSAGE_IDEMPOTENCY_KEY_MISMATCH: "REFUSED_MESSAGE_IDEMPOTENCY_KEY_MISMATCH",
  REFUSED_MESSAGE_STATUS_UNKNOWN: "REFUSED_MESSAGE_STATUS_UNKNOWN",
  REFUSED_INTENT_STATUS_UNKNOWN: "REFUSED_INTENT_STATUS_UNKNOWN",
} as const);

export type LeadAssignmentReconcileOutcomeValue =
  (typeof LeadAssignmentReconcileOutcome)[keyof typeof LeadAssignmentReconcileOutcome];

/** The durable shapes this decision reads. Nothing else is consulted. */
export interface ReconcilableIntentRow {
  readonly id: string;
  readonly aggregate_type: string;
  readonly channel: string;
  readonly template_purpose: string;
  readonly status: string;
}

export interface ReconcilableMessageRow {
  readonly id: string;
  readonly channel: string;
  readonly template_key: string | null;
  readonly entity_type: string | null;
  readonly entity_id: string | null;
  readonly idempotency_key: string;
  readonly status: string;
}

/**
 * A single-column compare-and-set, expressed as data so it is testable without a
 * database. `patch` carries EXACTLY one key.
 */
export interface LeadAssignmentReconcilePlan {
  readonly table: typeof LEAD_ASSIGNMENT_RECONCILE_TABLE;
  readonly patch: Readonly<Record<string, IntentResultStatusValue>>;
  readonly filters: readonly (readonly [string, string])[];
}

export type LeadAssignmentReconcileDecision = {
  readonly outcome: LeadAssignmentReconcileOutcomeValue;
  readonly plan: LeadAssignmentReconcilePlan | null;
  readonly derived: IntentResultStatusValue | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const decide = (
  outcome: LeadAssignmentReconcileOutcomeValue,
  derived: IntentResultStatusValue | null = null
): LeadAssignmentReconcileDecision => ({ outcome, plan: null, derived });

/**
 * Decide whether — and how — this intent converges onto this message.
 *
 * The CALLER SUPPLIES NO DESIRED STATE. Both rows are canonical re-reads, and the
 * target status is computed here from the message alone, so a caller cannot ask
 * for an outcome, a delivery result, a retryability or a provider verdict.
 */
export function evaluateLeadAssignmentReconciliation(input: {
  readonly intent: ReconcilableIntentRow | null | undefined;
  readonly message: ReconcilableMessageRow | null | undefined;
}): LeadAssignmentReconcileDecision {
  const { intent, message } = input;

  if (!message || typeof message !== "object") {
    return decide(LeadAssignmentReconcileOutcome.REFUSED_MESSAGE_NOT_FOUND);
  }

  // A message that is not intent-linked at all belongs to another lane (an auth
  // OTP, a client notification). Deterministically not our work.
  if (message.entity_type !== INTENT_ENTITY_TYPE) {
    return decide(LeadAssignmentReconcileOutcome.NOT_APPLICABLE_MESSAGE_NOT_INTENT_LINKED);
  }

  if (!intent || typeof intent !== "object") {
    return decide(LeadAssignmentReconcileOutcome.REFUSED_INTENT_NOT_FOUND);
  }
  if (typeof intent.id !== "string" || !UUID_RE.test(intent.id)) {
    return decide(LeadAssignmentReconcileOutcome.REFUSED_INTENT_IDENTITY_INVALID);
  }

  // A campaign intent reaching here is normal traffic, not a fault.
  if (intent.aggregate_type !== LEAD_ASSIGNMENT_AGGREGATE_TYPE) {
    return decide(LeadAssignmentReconcileOutcome.NOT_APPLICABLE_NOT_LEAD_ASSIGNMENT);
  }

  // ---- the deterministic linkage the dispatcher created, re-proved in full ----
  if (intent.channel !== LEAD_ASSIGNMENT_INTENT_CHANNEL) {
    return decide(LeadAssignmentReconcileOutcome.REFUSED_INTENT_CHANNEL_MISMATCH);
  }
  if (intent.template_purpose !== LEAD_ASSIGNMENT_TEMPLATE_PURPOSE) {
    return decide(LeadAssignmentReconcileOutcome.REFUSED_INTENT_PURPOSE_MISMATCH);
  }
  if (message.entity_id !== intent.id) {
    return decide(LeadAssignmentReconcileOutcome.REFUSED_MESSAGE_ENTITY_ID_MISMATCH);
  }
  if (message.channel !== LEAD_ASSIGNMENT_INTENT_CHANNEL) {
    return decide(LeadAssignmentReconcileOutcome.REFUSED_MESSAGE_CHANNEL_MISMATCH);
  }
  if (message.template_key !== LEAD_ASSIGNMENT_TEMPLATE_KEY) {
    return decide(LeadAssignmentReconcileOutcome.REFUSED_MESSAGE_TEMPLATE_MISMATCH);
  }
  // The strongest link: the key the dispatcher DERIVED from this intent's id.
  if (message.idempotency_key !== leadAssignmentMessageIdempotencyKey(intent.id)) {
    return decide(LeadAssignmentReconcileOutcome.REFUSED_MESSAGE_IDEMPOTENCY_KEY_MISMATCH);
  }

  // ---- status vocabulary: unknown values are refused, never guessed ----------
  if (!KNOWN_MESSAGE_STATUSES.includes(message.status as CommunicationMessageStatus)) {
    return decide(LeadAssignmentReconcileOutcome.REFUSED_MESSAGE_STATUS_UNKNOWN);
  }
  const observed = intent.status as IntentResultStatusValue;
  if (!KNOWN_INTENT_STATUSES.includes(observed)) {
    return decide(LeadAssignmentReconcileOutcome.REFUSED_INTENT_STATUS_UNKNOWN);
  }

  // ---- the projection, from the EXISTING authority ---------------------------
  const derived = projectIntentStatus(message.status as CommunicationMessageStatus);

  if (derived === observed) {
    return decide(LeadAssignmentReconcileOutcome.NOOP_SAME_STATUS, derived);
  }

  // This phase converges TERMINAL truth only. A message still in flight
  // (queued/dispatching/accepted/sent/retry_scheduled) must never be turned into
  // a terminal intent, and `dispatched` is already written by the send path — so
  // reconciliation never writes it and therefore never touches `dispatched_at`.
  if (derived !== IntentResultStatus.DELIVERED && derived !== IntentResultStatus.FAILED) {
    return decide(LeadAssignmentReconcileOutcome.NOOP_NON_TERMINAL_MESSAGE, derived);
  }

  if (!isForwardTransition(observed, derived)) {
    return decide(LeadAssignmentReconcileOutcome.REFUSED_REGRESSION, derived);
  }

  return {
    outcome: LeadAssignmentReconcileOutcome.APPLIED,
    derived,
    plan: {
      table: LEAD_ASSIGNMENT_RECONCILE_TABLE,
      // EXACTLY one column. `dispatched_at` already records the first provider
      // dispatch and is never rewritten by reconciliation.
      patch: Object.freeze({ [LEAD_ASSIGNMENT_RECONCILE_COLUMN]: derived }),
      filters: Object.freeze([
        ["id", intent.id],
        ["aggregate_type", LEAD_ASSIGNMENT_AGGREGATE_TYPE],
        // COMPARE-AND-SET on the status we actually observed: a concurrent writer
        // that already advanced the row wins, and this becomes a silent no-op
        // rather than an overwrite.
        ["status", observed],
      ] as const),
    },
  };
}
