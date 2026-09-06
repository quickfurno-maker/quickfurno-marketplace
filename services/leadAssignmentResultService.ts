// ============================================================================
// QuickFurno — services/leadAssignmentResultService.ts   (server-only)
//
// QF-MVP-80.17A — the I/O half of lead-assignment terminal reconciliation.
//
// It does exactly three things: re-read the canonical message, re-read the
// derived intent, and apply the single-column compare-and-set that
// `evaluateLeadAssignmentReconciliation` returns. Every rule — linkage,
// projection, forward-only progression — lives in the pure contract.
//
// STRUCTURALLY INCAPABLE OF SENDING.
//   There is no CommunicationService import, no provider, no fetch, no Graph
//   call, no n8n call, no message INSERT, no intent INSERT, no retry scheduling,
//   no assignment write, no credit write, no vendor write, no lead write and no
//   runtime/provider-account write. The only statement that mutates anything is
//   the UPDATE built from the pure plan, and that plan can only ever name
//   `communication_intents.status`.
//
// CANONICAL TRUTH IS RE-READ, NEVER SUPPLIED.
//   Callers hand over provider message ids only. The delivery result, the target
//   status and the retryability are all derived here from the persisted message
//   row, so no caller can assert an outcome.
//
// ORDERING.
//   This must run only AFTER CommunicationService has persisted the canonical
//   message lifecycle and its immutable delivery event. It is wired into the
//   Meta delivery orchestration after that step, never before it.
//
// IDEMPOTENT BY CONSTRUCTION.
//   Re-running against the same message is a NOOP_SAME_STATUS. That is what lets
//   a Meta redelivery safely re-attempt a projection that previously failed on a
//   transient database error, without any second provider call, second message or
//   status regression.
// ============================================================================

import { adminClient } from "@/lib/supabase";
import {
  LeadAssignmentReconcileOutcome,
  evaluateLeadAssignmentReconciliation,
  type LeadAssignmentReconcileOutcomeValue,
  type ReconcilableIntentRow,
  type ReconcilableMessageRow,
} from "@/lib/communication/leadAssignmentResultContract";
import { LEAD_ASSIGNMENT_AGGREGATE_TYPE } from "@/lib/communication/leadAssignmentDispatchContract";

const db = () => adminClient();

const MESSAGE_COLUMNS =
  "id, channel, template_key, entity_type, entity_id, idempotency_key, status";
const INTENT_COLUMNS = "id, aggregate_type, channel, template_purpose, status";

/** Bounded: one webhook envelope carries a handful of statuses, never a batch job. */
const MAX_PROVIDER_MESSAGE_IDS = 100;

export interface LeadAssignmentReconcileSummary {
  readonly examined: number;
  readonly applied: number;
  readonly unchanged: number;
  readonly notApplicable: number;
  readonly refused: number;
  /** Sanitized outcome tally. Carries no id, destination, vendor or provider text. */
  readonly outcomes: Readonly<Record<string, number>>;
}

const EMPTY: LeadAssignmentReconcileSummary = Object.freeze({
  examined: 0, applied: 0, unchanged: 0, notApplicable: 0, refused: 0, outcomes: Object.freeze({}),
});

/**
 * Reconcile the lead-assignment intents behind the messages a verified delivery
 * webhook just settled.
 *
 * `providerMessageIds` come from the ALREADY-VERIFIED, already-parsed envelope,
 * so the set is deterministic and a redelivery derives exactly the same set.
 */
export async function reconcileLeadAssignmentDeliveryResults(input: {
  readonly provider: string;
  readonly providerMessageIds: readonly string[];
  readonly providerAccountId?: string | null;
}): Promise<LeadAssignmentReconcileSummary> {
  const ids = Array.from(
    new Set((input?.providerMessageIds ?? []).filter((v): v is string => typeof v === "string" && v !== ""))
  ).slice(0, MAX_PROVIDER_MESSAGE_IDS);
  if (ids.length === 0 || typeof input?.provider !== "string" || input.provider === "") return EMPTY;

  const tally: Record<string, number> = {};
  let examined = 0, applied = 0, unchanged = 0, notApplicable = 0, refused = 0;

  const note = (outcome: LeadAssignmentReconcileOutcomeValue) => {
    tally[outcome] = (tally[outcome] ?? 0) + 1;
  };

  let messages: ReconcilableMessageRow[] = [];
  try {
    // Canonical re-read. The webhook's own view of the status is never trusted;
    // only what CommunicationService actually persisted counts.
    let query = db()
      .from("communication_messages")
      .select(MESSAGE_COLUMNS)
      .eq("provider", input.provider)
      .in("provider_message_id", ids);
    // When the owning account is known, bind to it — the same account the
    // ownership fence already resolved for this envelope.
    if (typeof input.providerAccountId === "string" && input.providerAccountId !== "") {
      query = query.eq("provider_account_id", input.providerAccountId);
    }
    const { data, error } = await query;
    if (error) return EMPTY;
    messages = (data ?? []) as ReconcilableMessageRow[];
  } catch {
    return EMPTY;
  }

  for (const message of messages) {
    examined += 1;

    // Only intent-linked messages can reconcile anything; the contract decides.
    let intent: ReconcilableIntentRow | null = null;
    if (typeof message.entity_id === "string" && message.entity_id !== "") {
      try {
        const { data, error } = await db()
          .from("communication_intents")
          .select(INTENT_COLUMNS)
          .eq("id", message.entity_id)
          .maybeSingle();
        if (!error) intent = (data ?? null) as ReconcilableIntentRow | null;
      } catch {
        intent = null;
      }
    }

    const decision = evaluateLeadAssignmentReconciliation({ intent, message });
    note(decision.outcome);

    switch (decision.outcome) {
      case LeadAssignmentReconcileOutcome.APPLIED:
        break;
      case LeadAssignmentReconcileOutcome.NOOP_SAME_STATUS:
      case LeadAssignmentReconcileOutcome.NOOP_NON_TERMINAL_MESSAGE:
        unchanged += 1;
        continue;
      case LeadAssignmentReconcileOutcome.NOT_APPLICABLE_MESSAGE_NOT_INTENT_LINKED:
      case LeadAssignmentReconcileOutcome.NOT_APPLICABLE_NOT_LEAD_ASSIGNMENT:
        notApplicable += 1;
        continue;
      default:
        refused += 1;
        continue;
    }

    const plan = decision.plan;
    if (plan === null) { refused += 1; continue; }

    try {
      // The plan is applied verbatim: the table, the single column and all three
      // fences are decided in the pure contract, never widened here.
      let update = db().from(plan.table).update(plan.patch);
      for (const [column, value] of plan.filters) update = update.eq(column, value);
      const { data, error } = await update.select("id, status");

      if (error || !data || data.length === 0) {
        // A concurrent writer already advanced the row and won the CAS. That is a
        // correct no-op, never a forced overwrite and never a retry loop.
        unchanged += 1;
        note(LeadAssignmentReconcileOutcome.NOOP_SAME_STATUS);
        continue;
      }
      applied += 1;
    } catch {
      // Reconciliation failure is NEVER fatal: the canonical message row is
      // already correct, and a Meta redelivery re-attempts this projection.
      refused += 1;
    }
  }

  return {
    examined, applied, unchanged, notApplicable, refused,
    outcomes: Object.freeze({ ...tally }),
  };
}

/** Re-exported so an operator surface never re-derives the lane's identity. */
export { LEAD_ASSIGNMENT_AGGREGATE_TYPE };
