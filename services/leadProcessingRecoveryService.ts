// ============================================================================
// QuickFurno — services/leadProcessingRecoveryService.ts
// Phase 3B: EXPLICIT matching retry (backend-only).
//
// retryLeadMatchingAfterQualityPass(leadId) re-runs matching for a lead that has
// ALREADY passed the stored Quality V2 gate but has no assignments yet (e.g. a
// selected_but_unassigned / waiting_with_eligible_vendors case). It is the
// deliberately-separate counterpart to rescoreLeadQualityOnly() — it does NOT
// rescore.
//
// Order (Part 5): validate → reject missing → reject duplicate → require quality
// gate → check ACTUAL lead_assignments (Layer 1) → reuse runAutoLeadMatchingForLead.
//
// It NEVER re-implements ranking, deducts credits directly, inserts assignments
// directly, bypasses the quality/duplicate gate, or contains any .rpc() call. The
// only writes it can cause flow through the EXISTING matcher + assignment RPC,
// whose idempotency (lead lock + existing-assignment short-circuit + unique
// (lead_id,vendor_id) + credit rollback) is Layer 2 under concurrent retries.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { isMissingRelationError, ok, type Result } from "../lib/errors";
import { runAutoLeadMatchingForLead } from "./leadMatchingEngine";
import {
  EMPTY_MATCHING_SUMMARY,
  classifyRetryPrecondition,
  evaluateRetryQualityGate,
  mapMatcherStatusToRetryStatus,
  type RecoveryErrorCode,
  type RecoveryQualityDecision,
  type RetryLeadMatchingResult,
  type RetryStatus,
} from "./leadQualityRecoveryCore";

export type { RetryLeadMatchingResult } from "./leadQualityRecoveryCore";

type RecoveryFailure = { ok: false; code: RecoveryErrorCode; error: string };

/**
 * Explicit matching retry, only after the stored quality gate passes and only when
 * no assignments exist yet. Reuses the existing matcher (no ranking duplication,
 * no direct credit/assignment writes).
 */
export async function retryLeadMatchingAfterQualityPass(leadId: string): Promise<Result<RetryLeadMatchingResult>> {
  const id = (leadId ?? "").trim();
  if (!id) return failure("VALIDATION", "A lead id is required.");

  try {
    const db = adminClient();

    // Minimal reads: duplicate flag, deterministic latest quality decision, and the
    // ACTUAL assignment count (head-only, no rows). No vendor/log scans.
    const [leadRes, scoreRes, assignRes] = await Promise.all([
      db.from("leads").select("id, is_duplicate").eq("id", id).maybeSingle(),
      db
        .from("lead_scores")
        .select("total_score, score_class, hard_block_reason, recommended_action, created_at, id")
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1),
      db.from("lead_assignments").select("id", { count: "exact", head: true }).eq("lead_id", id),
    ]);

    if (leadRes.error && !isMissingRelationError(leadRes.error)) throw leadRes.error;

    const leadRow = leadRes.data as { id?: string | null; is_duplicate?: boolean | null } | null;
    const leadExists = Boolean(leadRow?.id);
    const isDuplicate = leadRow?.is_duplicate === true;

    const latest = firstScoreRow(scoreRes);
    const decision: RecoveryQualityDecision = {
      score: numOrNull(latest?.total_score),
      class: strOrNull(latest?.score_class),
      status: null,
      hard_block_reason: strOrNull(latest?.hard_block_reason),
      recommended_action: strOrNull(latest?.recommended_action),
      score_model_version: null,
    };
    const gate = evaluateRetryQualityGate(decision);
    const assignmentCount = assignRes.count ?? 0;

    const pre = classifyRetryPrecondition({ leadExists, isDuplicate, gatePassed: gate.passed, assignmentCount });

    if (pre === "lead_not_found") return failure("LEAD_NOT_FOUND", "Lead not found.");

    // duplicate_lead | quality_gate_hold | already_assigned → NEVER call the matcher.
    if (pre !== "proceed") {
      const status: RetryStatus = pre;
      logRetry(id, status, gate.score, assignmentCount);
      return ok({ lead_id: id, status, quality_gate: gate, matching: EMPTY_MATCHING_SUMMARY, assignment_count: assignmentCount });
    }

    // proceed → reuse the EXISTING matcher. Layer 2 (RPC idempotency) still applies.
    const matching = await runAutoLeadMatchingForLead(id);
    if (!matching.ok) return failure("MATCHING_FAILED", matching.error);

    const m = matching.data;
    const assignedIds = m.assignedVendors.map((v) => v.vendor_id);
    const status = mapMatcherStatusToRetryStatus(m.status);
    logRetry(id, status, gate.score, assignedIds.length);

    return ok({
      lead_id: id,
      status,
      quality_gate: gate,
      matching: {
        run_status: m.status,
        eligible_vendor_count: m.eligibleVendorCount,
        selected_vendor_ids: m.selectedVendorIds,
        assigned_vendor_ids: assignedIds,
        failure_reason: m.failureReason ?? null,
      },
      assignment_count: assignedIds.length,
    });
  } catch (e) {
    console.warn("[lead retry] failed", { lead_id: id, message: e instanceof Error ? e.message : "unknown_error" });
    return failure("MATCHING_FAILED", "Lead matching retry failed.");
  }
}

function failure(code: RecoveryErrorCode, error: string): RecoveryFailure {
  return { ok: false, code, error };
}

function logRetry(leadId: string, status: RetryStatus, score: number | null, assignmentCount: number): void {
  console.info("[lead retry] explicit matching retry", {
    lead_id: leadId,
    status,
    quality_score: score,
    assignment_count: assignmentCount,
    at: new Date().toISOString(),
  });
}

function firstScoreRow(res: {
  data: Array<{ total_score?: number | null; score_class?: string | null; hard_block_reason?: string | null; recommended_action?: string | null }> | null;
  error: unknown;
}): { total_score?: number | null; score_class?: string | null; hard_block_reason?: string | null; recommended_action?: string | null } | null {
  if (res.error) return null;
  return (res.data ?? [])[0] ?? null;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function strOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}
