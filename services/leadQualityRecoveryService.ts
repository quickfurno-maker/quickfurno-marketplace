// ============================================================================
// QuickFurno — services/leadQualityRecoveryService.ts
// Phase 3B: EXPLICIT quality-only rescore (backend-only).
//
// rescoreLeadQualityOnly(leadId) re-runs the EXISTING Quality V2 engine on the
// CURRENT stored lead and re-persists via the EXISTING contract (scoreAndStoreLead
// inserts a lead_scores row + updates the leads quality mirror). It returns the
// previous vs current decision.
//
// STRICTLY quality-only. It does NOT match, assign, deduct credits, touch
// packages, write delivery/notification logs, or start a matching run. It never
// auto-recovers: even when the decision improves (e.g. B → A), the operator must
// separately call retryLeadMatchingAfterQualityPass(). This module contains NO
// .rpc() call and NO direct write to any table other than through the Quality V2
// persistence contract (scoreAndStoreLead).
// ============================================================================
import { adminClient } from "../lib/supabase";
import { isMissingRelationError, ok, type Result } from "../lib/errors";
import { SCORE_MODEL_VERSION, getLeadQualityDecision, scoreAndStoreLead } from "./leadQualityService";
import {
  buildRescoreQualityInput,
  readPreviousDecision,
  summarizeRescoreComparison,
  type RecoveryErrorCode,
  type RecoveryLeadRow,
  type RescoreResult,
} from "./leadQualityRecoveryCore";

export type { RescoreResult } from "./leadQualityRecoveryCore";

type RecoveryFailure = { ok: false; code: RecoveryErrorCode; error: string };

/**
 * Explicit, quality-only rescore. Reuses Quality V2 + its persistence contract;
 * performs no matching/assignment/credit/delivery side effects.
 */
export async function rescoreLeadQualityOnly(leadId: string): Promise<Result<RescoreResult>> {
  const id = (leadId ?? "").trim();
  if (!id) return failure("VALIDATION", "A lead id is required.");

  try {
    const db = adminClient();

    // Read the stored lead (select * mirrors the established reconstruction pattern
    // in recalculateLeadAfterClarification and is drift-safe) + the latest score row
    // (for the previous model version). Single-row reads — no vendor/log scans.
    const [leadRes, scoreRes] = await Promise.all([
      db.from("leads").select("*").eq("id", id).maybeSingle(),
      db
        .from("lead_scores")
        .select("score_breakdown, created_at, id")
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1),
    ]);

    if (leadRes.error && !isMissingRelationError(leadRes.error)) throw leadRes.error;
    const lead = (leadRes.data as RecoveryLeadRow | null) ?? null;
    if (!lead) return failure("LEAD_NOT_FOUND", "Lead not found.");

    const previousModelVersion = readModelVersion(scoreRes);
    const previous = readPreviousDecision(lead, previousModelVersion);

    // Re-run Quality V2 on the CURRENT stored data via the existing persistence
    // contract (writes lead_scores row + leads mirror, consistently, together).
    const input = buildRescoreQualityInput(lead);
    const currentScore = await scoreAndStoreLead(id, input);
    const decision = getLeadQualityDecision(currentScore);

    const current: RescoreResult["current"] = {
      score: currentScore.total_score,
      class: currentScore.score_class,
      status: decision.leadQualityStatus,
      hard_block_reason: currentScore.hard_block_reason,
      recommended_action: currentScore.recommended_action,
      score_model_version: SCORE_MODEL_VERSION,
    };

    const { decision_changed, change_summary } = summarizeRescoreComparison(previous, current);

    // Structured, PII-free audit (lead_id + score transition only).
    console.info("[lead rescore] quality-only rescore", {
      lead_id: id,
      previous_score: previous.score,
      current_score: current.score,
      previous_action: previous.recommended_action,
      current_action: current.recommended_action,
      decision_changed,
      at: new Date().toISOString(),
    });

    return ok({ lead_id: id, previous, current, decision_changed, change_summary });
  } catch (e) {
    console.warn("[lead rescore] failed", { lead_id: id, message: e instanceof Error ? e.message : "unknown_error" });
    return failure("QUALITY_RESCORE_FAILED", "Lead quality rescore failed.");
  }
}

function failure(code: RecoveryErrorCode, error: string): RecoveryFailure {
  return { ok: false, code, error };
}

function readModelVersion(res: { data: Array<{ score_breakdown?: unknown }> | null; error: unknown }): string | null {
  if (res.error) return null;
  const row = (res.data ?? [])[0];
  const breakdown = row?.score_breakdown;
  if (breakdown && typeof breakdown === "object" && !Array.isArray(breakdown)) {
    const v = (breakdown as Record<string, unknown>).score_model_version;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  }
  return null;
}
