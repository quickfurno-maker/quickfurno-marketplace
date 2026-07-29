// ============================================================================
// QuickFurno — lib/communication/campaignResultContract.ts   (QF-MVP-40.8)
//
// The PURE, Core-owned contract that projects a canonical communication MESSAGE
// state onto a provider-neutral communication INTENT state.
//
// WHY THIS IS PURE
//   No database, no network, no clock, no environment. Everything is a function of
//   its arguments, so the mapping can be exhaustively tested and can never be the
//   thing that reaches a provider. The service layer supplies rows; this file
//   decides nothing about WHO may call it.
//
// THE AUTHORITY RULE
//   `communication_messages` is CANONICAL. The intent's status is DERIVED from it
//   and is never supplied by a caller. There is deliberately no input on this
//   contract for a desired status, a provider message id, a delivery claim, a
//   recipient, a consent result or a retryability flag — an external orchestrator
//   (QF-MVP-50) can only identify work, never assert its outcome.
//
// UNCERTAINTY IS NOT FAILURE
//   `outcome_unknown` means provider acceptance could be neither proven nor
//   disproven. It projects to `uncertain`, never to `failed`, and it NEVER
//   triggers a resend. Only a later VERIFIED provider webhook may move the
//   canonical message forward, after which reconciliation may resolve the intent.
// ============================================================================

import type { CommunicationMessageStatus } from "./types";

/** The closed intent vocabulary, exactly matching communication_intents_status_check. */
export const IntentResultStatus = Object.freeze({
  PENDING: "pending",
  CLAIMED: "claimed",
  DISPATCHED: "dispatched",
  DELIVERED: "delivered",
  FAILED: "failed",
  UNCERTAIN: "uncertain",
} as const);
export type IntentResultStatusValue = (typeof IntentResultStatus)[keyof typeof IntentResultStatus];

export const INTENT_RESULT_STATUSES: readonly IntentResultStatusValue[] = Object.freeze([
  IntentResultStatus.PENDING,
  IntentResultStatus.CLAIMED,
  IntentResultStatus.DISPATCHED,
  IntentResultStatus.DELIVERED,
  IntentResultStatus.FAILED,
  IntentResultStatus.UNCERTAIN,
]);

/** The aggregate type campaign intents use. Widened by migration 20260728001500. */
export const CAMPAIGN_AGGREGATE_TYPE = "vendor_campaign" as const;
/** The entity_type stamped on the canonical message that serves a campaign intent. */
export const INTENT_ENTITY_TYPE = "communication_intent" as const;
export const CAMPAIGN_INTENT_CHANNEL = "whatsapp" as const;

// ---------------------------------------------------------------------------
// Deterministic key grammar — Core-owned, derived only from identities Core can
// verify. Nothing here is caller-supplied, so two orchestrator calls for the same
// intent necessarily collide on the message's UNIQUE idempotency_key.
// ---------------------------------------------------------------------------
export const CAMPAIGN_MESSAGE_IDEMPOTENCY_PREFIX = "qf_mvp_40_8_campaign_intent_v1:";
export const CAMPAIGN_CORRELATION_PREFIX = "qf_campaign:";

/** EXACTLY one message may exist per intent: the value is a pure function of the intent id. */
export function campaignMessageIdempotencyKey(intentId: string): string {
  return `${CAMPAIGN_MESSAGE_IDEMPOTENCY_PREFIX}${intentId}`;
}
/** Groups every message of one campaign without carrying any recipient information. */
export function campaignCorrelationId(campaignId: string): string {
  return `${CAMPAIGN_CORRELATION_PREFIX}${campaignId}`;
}

// ---------------------------------------------------------------------------
// THE CLOSED MAPPING — canonical message status → intent status.
//
// Every one of the eleven message statuses is listed explicitly. There is no
// default branch and no fallback: adding a message status without deciding its
// projection is a TypeScript error, not a silent "probably failed".
// ---------------------------------------------------------------------------
const MESSAGE_TO_INTENT: Readonly<Record<CommunicationMessageStatus, IntentResultStatusValue>> =
  Object.freeze({
    // Not yet handed to a provider.
    queued: IntentResultStatus.PENDING,
    // In flight. `retry_scheduled` is explicitly NOT a success — it is still work
    // in progress, and it must never read as dispatched.
    dispatching: IntentResultStatus.CLAIMED,
    retry_scheduled: IntentResultStatus.CLAIMED,
    // Provider accepted the request. Acceptance is not delivery.
    accepted: IntentResultStatus.DISPATCHED,
    sent: IntentResultStatus.DISPATCHED,
    // Delivery confirmed. The intent vocabulary has no `read`, so a read message
    // projects to `delivered` — the finer message status stays visible separately
    // via canonicalMessageStatus, so read is never LOST, only never CLAIMED as a
    // distinct intent state.
    delivered: IntentResultStatus.DELIVERED,
    read: IntentResultStatus.DELIVERED,
    // Definitive negative outcomes.
    failed: IntentResultStatus.FAILED,
    dead_letter: IntentResultStatus.FAILED,
    cancelled: IntentResultStatus.FAILED,
    // Acceptance neither proven nor disproven. NEVER failed, never resent.
    outcome_unknown: IntentResultStatus.UNCERTAIN,
  });

export function projectIntentStatus(messageStatus: CommunicationMessageStatus): IntentResultStatusValue {
  return MESSAGE_TO_INTENT[messageStatus];
}

// ---------------------------------------------------------------------------
// FORWARD-ONLY PROGRESSION
//
// `uncertain` sits BELOW the terminal pair deliberately: a later verified webhook
// must be able to resolve uncertain → delivered or uncertain → failed. The reverse
// is impossible, so a confirmed delivery can never decay back into uncertainty.
// ---------------------------------------------------------------------------
const RANK: Readonly<Record<IntentResultStatusValue, number>> = Object.freeze({
  pending: 0,
  claimed: 1,
  dispatched: 2,
  uncertain: 3,
  delivered: 4,
  failed: 4,
});

/**
 * True when `next` is a legal progression from `current`.
 *
 * Same status is allowed and callers MUST treat it as a no-op, so a repeated
 * reconciliation never rewrites a timestamp. Equal-rank but DIFFERENT statuses
 * (delivered ↔ failed) are rejected: neither may overwrite the other.
 */
export function isForwardTransition(
  current: IntentResultStatusValue,
  next: IntentResultStatusValue
): boolean {
  if (current === next) return true;
  if (RANK[next] === RANK[current]) return false; // no lateral delivered↔failed move
  return RANK[next] > RANK[current];
}

export function isSameStatus(
  current: IntentResultStatusValue,
  next: IntentResultStatusValue
): boolean {
  return current === next;
}

/** A terminal intent state needs no further reconciliation. `uncertain` is NOT terminal. */
export function isTerminalIntentStatus(status: IntentResultStatusValue): boolean {
  return status === IntentResultStatus.DELIVERED || status === IntentResultStatus.FAILED;
}

// ---------------------------------------------------------------------------
// The closed reconciliation outcome. Every refusal names a reason; none of them
// carries a destination, a provider payload, a database message or a stack.
// ---------------------------------------------------------------------------
export const ReconcileRefusal = Object.freeze({
  INTENT_NOT_FOUND: "INTENT_NOT_FOUND",
  INTENT_NOT_CAMPAIGN: "INTENT_NOT_CAMPAIGN",
  INTENT_CAMPAIGN_MISMATCH: "INTENT_CAMPAIGN_MISMATCH",
  INTENT_CHANNEL_UNSUPPORTED: "INTENT_CHANNEL_UNSUPPORTED",
  INTENT_EVIDENCE_INVALID: "INTENT_EVIDENCE_INVALID",
  MESSAGE_NOT_FOUND: "MESSAGE_NOT_FOUND",
  MESSAGE_LINKAGE_MISMATCH: "MESSAGE_LINKAGE_MISMATCH",
  MESSAGE_TEMPLATE_MISMATCH: "MESSAGE_TEMPLATE_MISMATCH",
  MESSAGE_CHANNEL_MISMATCH: "MESSAGE_CHANNEL_MISMATCH",
  STATUS_REGRESSION_REFUSED: "STATUS_REGRESSION_REFUSED",
  CONCURRENT_MODIFICATION: "CONCURRENT_MODIFICATION",
  RECONCILE_FAILED: "RECONCILE_FAILED",
} as const);
export type ReconcileRefusalValue = (typeof ReconcileRefusal)[keyof typeof ReconcileRefusal];

export type IntentReconcileResult =
  | {
      readonly ok: true;
      readonly intentId: string;
      readonly intentStatus: IntentResultStatusValue;
      readonly canonicalMessageStatus: CommunicationMessageStatus;
      /** True when the intent already held this status — the write was a no-op. */
      readonly unchanged: boolean;
      readonly uncertain: boolean;
      readonly terminal: boolean;
    }
  | { readonly ok: false; readonly reason: ReconcileRefusalValue };

/** Per-campaign projection. Counts only — never a recipient_ref, destination or payload. */
export interface CampaignResultProjection {
  readonly campaignId: string;
  readonly aggregateType: typeof CAMPAIGN_AGGREGATE_TYPE;
  readonly totalIntents: number;
  readonly byIntentStatus: Readonly<Record<string, number>>;
  readonly byCanonicalMessageStatus: Readonly<Record<string, number>>;
  readonly linkedCount: number;
  readonly unlinkedCount: number;
  readonly pendingOrClaimedCount: number;
  readonly dispatchedCount: number;
  readonly deliveredCount: number;
  readonly readCount: number;
  readonly failedCount: number;
  readonly uncertainCount: number;
  /** Intents whose derived status disagrees with their linked canonical message. */
  readonly reconciliationAnomalies: number;
  readonly latestIntentCreatedAt: string | null;
  readonly latestDispatchedAt: string | null;
}
