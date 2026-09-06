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
//   Re-running against a row that already holds the derived state is a PROVEN
//   NOOP_SAME_STATUS — proven because the contract compared the two statuses. That
//   is what lets a Meta redelivery safely re-attempt a projection that previously
//   failed on a transient database error, without any second provider call, second
//   message or status regression.
//
// A ZERO-ROW CAS IS NOT A NO-OP CLAIM.
//   An earlier revision of this file labelled every zero-row UPDATE
//   `NOOP_SAME_STATUS` and tallied `APPLIED` from the DECISION, before the
//   statement ran. Both were untrue: a missed guard proves only that the row no
//   longer matched what we observed — not that it already reached the derived
//   state — and one attempt could report `outcomes.APPLIED = 1` beside
//   `applied = 0`. The write result is now classified by the pure
//   `classifyReconcileWriteResult`, and a zero-row result is its own closed
//   outcome, CONCURRENT_MODIFICATION, which claims nothing about the row.
// ============================================================================

import { adminClient } from "@/lib/supabase";
import {
  LeadAssignmentReconcileOutcome,
  classifyReconcileWriteResult,
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
  /** ONLY writes that actually matched a row. Never a decision, never an attempt. */
  readonly applied: number;
  /** PROVEN no-ops: the projection already equalled the row, or was non-terminal. */
  readonly unchanged: number;
  readonly notApplicable: number;
  /**
   * Guarded writes that matched zero rows. Distinct from `unchanged` on purpose:
   * this reconciler did not write and did not re-read, so it makes no claim about
   * the row's current state.
   */
  readonly concurrent: number;
  readonly refused: number;
  /** Sanitized outcome tally. Carries no id, destination, vendor or provider text. */
  readonly outcomes: Readonly<Record<string, number>>;
}

const EMPTY: LeadAssignmentReconcileSummary = Object.freeze({
  examined: 0, applied: 0, unchanged: 0, notApplicable: 0, concurrent: 0, refused: 0,
  outcomes: Object.freeze({}),
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
  let examined = 0, applied = 0, unchanged = 0, notApplicable = 0, concurrent = 0, refused = 0;

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

    // A DECISION is not an OUTCOME. Anything that does not attempt a write is
    // tallied here, exactly once; `APPLIED` is deliberately NOT tallied yet,
    // because at this point nothing has touched the database.
    if (decision.outcome !== LeadAssignmentReconcileOutcome.APPLIED || decision.plan === null) {
      const outcome = decision.plan === null && decision.outcome === LeadAssignmentReconcileOutcome.APPLIED
        ? LeadAssignmentReconcileOutcome.REFUSED_WRITE_FAILED // an apply decision with no plan is unusable
        : decision.outcome;
      note(outcome);
      switch (outcome) {
        case LeadAssignmentReconcileOutcome.NOOP_SAME_STATUS:
        case LeadAssignmentReconcileOutcome.NOOP_NON_TERMINAL_MESSAGE:
          unchanged += 1;
          break;
        case LeadAssignmentReconcileOutcome.NOT_APPLICABLE_MESSAGE_NOT_INTENT_LINKED:
        case LeadAssignmentReconcileOutcome.NOT_APPLICABLE_NOT_LEAD_ASSIGNMENT:
          notApplicable += 1;
          break;
        default:
          refused += 1;
          break;
      }
      continue;
    }

    const plan = decision.plan;

    // The write, then ONE truthful label derived from what it actually did.
    let matchedRows: number | null = null;
    let failed = false;
    try {
      // The plan is applied verbatim: the table, the single column and all three
      // fences are decided in the pure contract, never widened here.
      let update = db().from(plan.table).update(plan.patch);
      for (const [column, value] of plan.filters) update = update.eq(column, value);
      const { data, error } = await update.select("id, status");
      if (error) failed = true;
      else matchedRows = Array.isArray(data) ? data.length : null;
    } catch {
      // Reconciliation failure is NEVER fatal: the canonical message row is
      // already correct, and a Meta redelivery re-attempts this projection.
      failed = true;
    }

    // `classifyReconcileWriteResult` is pure, so this accounting is provable
    // offline. A zero-row CAS becomes CONCURRENT_MODIFICATION — never
    // NOOP_SAME_STATUS, which would claim a state this code never re-read.
    const writeOutcome = classifyReconcileWriteResult({ matchedRows, failed });
    note(writeOutcome);
    if (writeOutcome === LeadAssignmentReconcileOutcome.APPLIED) applied += 1;
    else if (writeOutcome === LeadAssignmentReconcileOutcome.CONCURRENT_MODIFICATION) concurrent += 1;
    else refused += 1;
  }

  return {
    examined, applied, unchanged, notApplicable, concurrent, refused,
    outcomes: Object.freeze({ ...tally }),
  };
}

/** Re-exported so an operator surface never re-derives the lane's identity. */
export { LEAD_ASSIGNMENT_AGGREGATE_TYPE };
