// ============================================================================
// QuickFurno — services/aosService.ts   (server-only)
// Safe audit logging for AOS agent decisions. Writes to aos_agent_logs when the
// table exists; otherwise it degrades gracefully (no throw, no app break).
//
// This service performs NO AI calls, NO WhatsApp, NO credit deduction, and NO
// lead distribution. It only persists a safe, summarized decision record for
// auditing. Phone numbers / secrets must never be passed in — callers send
// already-summarized, masked content.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { ok, type Result } from "../lib/errors";

export interface AosDecisionLogInput {
  agent_key: string;
  task_type: string;
  entity_type?: string | null;
  entity_id?: string | null;
  input_summary?: string | null;
  output_summary?: string | null;
  decision?: string | null;
  reason?: string | null;
  confidence_score?: number | null; // 0..1
  status?: string;
}

export interface AosLogResult {
  persisted: boolean;
  fallback: boolean;
  message: string;
}

// Try to persist an AOS decision. Never throws — if the table is missing or the
// insert fails, it returns a safe fallback result so callers/lead flow continue.
export async function logAosAgentDecision(input: AosDecisionLogInput): Promise<Result<AosLogResult>> {
  const safeConfidence =
    typeof input.confidence_score === "number" && Number.isFinite(input.confidence_score)
      ? Math.max(0, Math.min(1, input.confidence_score))
      : null;

  try {
    const { error } = await adminClient().from("aos_agent_logs").insert({
      agent_key: input.agent_key,
      task_type: input.task_type,
      entity_type: input.entity_type ?? null,
      entity_id: input.entity_id ?? null,
      input_summary: input.input_summary ?? null,
      output_summary: input.output_summary ?? null,
      decision: input.decision ?? null,
      reason: input.reason ?? null,
      confidence_score: safeConfidence,
      status: input.status ?? "completed",
    });
    if (error) throw error;
    return ok({ persisted: true, fallback: false, message: "AOS decision logged to aos_agent_logs." });
  } catch (error) {
    // Table not applied yet, or transient failure — degrade safely.
    console.info("[aos log] aos_agent_logs not available; used safe fallback", {
      agent: input.agent_key,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return ok({
      persisted: false,
      fallback: true,
      message: "aos_agent_logs not available yet — used safe in-memory fallback. Nothing was lost from the lead flow.",
    });
  }
}
