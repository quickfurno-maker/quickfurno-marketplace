// ==========================================================================
// QuickFurno — services/aosService.ts (server-only)
//
// Durable, safe AOS decision logging. This service is audit-only: no AI/network
// provider call, WhatsApp, credit deduction, assignment, or automation authority.
// It degrades safely when the AOS V2 migration is not present.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { ok, type Result } from "../lib/errors";

export interface AosDecisionLogInput {
  run_id?: string | null;
  agent_key: string;
  task_type: string;
  entity_type?: string | null;
  entity_id?: string | null;
  input_summary?: string | null;
  output_summary?: string | null;
  decision?: string | null;
  reason?: string | null;
  confidence_score?: number | null;
  status?: "started" | "completed" | "failed" | "skipped";
  metadata?: Readonly<Record<string, unknown>>;
}

export interface AosLogResult {
  persisted: boolean;
  fallback: boolean;
  message: string;
}

export async function logAosAgentDecision(
  input: AosDecisionLogInput,
): Promise<Result<AosLogResult>> {
  const safeConfidence =
    typeof input.confidence_score === "number" &&
    Number.isFinite(input.confidence_score)
      ? Math.max(0, Math.min(1, input.confidence_score))
      : null;

  try {
    const { error } = await adminClient().from("aos_agent_logs").insert({
      run_id: input.run_id ?? null,
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
      metadata: sanitizeMetadata(input.metadata),
    });

    if (error) throw error;
    return ok({
      persisted: true,
      fallback: false,
      message: "AOS decision logged to aos_agent_logs.",
    });
  } catch (error) {
    console.info("[aos log] durable AOS log unavailable; safe fallback used", {
      agent: input.agent_key,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return ok({
      persisted: false,
      fallback: true,
      message:
        "AOS durable log unavailable — safe fallback used. Core processing was not affected.",
    });
  }
}

function sanitizeMetadata(
  value: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  if (!value) return {};
  const entries = Object.entries(value).slice(0, 30);
  return Object.fromEntries(
    entries.map(([key, child]) => [key.slice(0, 80), sanitizeValue(child)]),
  );
}

function sanitizeValue(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeValue);
  if (typeof value === "object") {
    return sanitizeMetadata(value as Record<string, unknown>);
  }
  return String(value).slice(0, 200);
}
