import { adminClient } from "@/lib/supabase";
import {
  buildAosV2CanonicalSnapshot,
  buildAosV2LeadMemory,
  deriveAosV2LeadDecisions,
  deriveAosV2LeadRecommendation,
} from "@/lib/aos/v2/leadIntelligence";
import { getAosV2RuntimeState } from "@/lib/aos/v2/runtime";
import type {
  AosV2LeadIntelligenceInput,
  AosV2LeadIntelligenceResult,
  AosV2Recommendation,
} from "@/lib/aos/v2/contracts";
import { logAosAgentDecision } from "./aosService";

export async function runAosV2LeadIntelligence(
  input: AosV2LeadIntelligenceInput,
): Promise<AosV2LeadIntelligenceResult> {
  const runtime = await getAosV2RuntimeState();
  if (!runtime.intelligenceEnabled) {
    return {
      ok: true,
      active: false,
      mode: "off",
      runId: null,
      recommendationId: null,
      recommendation: null,
      persisted: false,
      message: "AOS V2 intelligence is disabled. Core processing remains authoritative.",
    };
  }

  const canonicalSnapshot = buildAosV2CanonicalSnapshot(input);
  const correlationId = buildCorrelationId(input.lead.leadId);
  let runId: string | null = null;

  try {
    runId = await createRun({
      correlationId,
      leadId: input.lead.leadId,
      canonicalInputs: canonicalSnapshot,
    });

    const decisions = deriveAosV2LeadDecisions(input);
    for (const decision of decisions) {
      await logAosAgentDecision({
        run_id: runId,
        agent_key: decision.agentKey,
        task_type: decision.taskType,
        entity_type: "lead",
        entity_id: input.lead.leadId,
        input_summary: "Canonical Core evidence observed; no AOS rescore or independent matching.",
        output_summary: decision.decision,
        decision: decision.decision,
        reason: decision.reason,
        confidence_score: decision.confidence,
        status: "completed",
        metadata: decision.metadata,
      });
    }

    const recommendation = deriveAosV2LeadRecommendation(input);
    const recommendationId = runId
      ? await persistRecommendation(runId, input.lead.leadId, recommendation)
      : null;

    if (runId) {
      await persistMemory(runId, input);
      await appendAudit(runId, input.lead.leadId, "aos_v2.lead_intelligence_completed", {
        recommendationKey: recommendation.key,
        priority: recommendation.priority,
        suggestedActionType: recommendation.suggestedActionType,
        actionProposalsEnabled: runtime.actionProposalsEnabled,
      });
      await completeRun(runId, recommendation);
    }

    return {
      ok: true,
      active: true,
      mode: runtime.mode,
      runId,
      recommendationId,
      recommendation,
      persisted: Boolean(runId && recommendationId),
      message: runId
        ? "AOS V2 intelligence completed from canonical Core evidence. No direct side effect executed."
        : "AOS V2 intelligence completed without durable persistence. Core processing was unaffected.",
    };
  } catch (error) {
    if (runId) {
      await markRunFailed(runId, safeErrorCode(error));
      await appendAudit(runId, input.lead.leadId, "aos_v2.lead_intelligence_failed", {
        errorCode: safeErrorCode(error),
      });
    }

    console.warn("[aos-v2] intelligence failed safely", {
      leadId: input.lead.leadId,
      code: safeErrorCode(error),
    });

    return {
      ok: true,
      active: true,
      mode: runtime.mode,
      runId,
      recommendationId: null,
      recommendation: null,
      persisted: false,
      message: "AOS V2 intelligence failed safely. Core processing and existing automation were not affected.",
    };
  }
}

async function createRun(input: {
  correlationId: string;
  leadId: string;
  canonicalInputs: Record<string, unknown>;
}): Promise<string | null> {
  const { data, error } = await adminClient()
    .from("aos_runs")
    .insert({
      correlation_id: input.correlationId,
      event_type: "lead.processed",
      entity_type: "lead",
      entity_id: input.leadId,
      source: "quickfurno-core",
      mode: "shadow",
      status: "started",
      canonical_inputs: input.canonicalInputs,
    })
    .select("id")
    .maybeSingle();

  if (error || !data?.id) {
    console.info("[aos-v2] run persistence unavailable; continuing advisory-only", {
      leadId: input.leadId,
      code: error?.code ?? "AOS_RUN_NOT_PERSISTED",
    });
    return null;
  }
  return String(data.id);
}

async function persistRecommendation(
  runId: string,
  leadId: string,
  recommendation: AosV2Recommendation,
): Promise<string | null> {
  const { data, error } = await adminClient()
    .from("aos_recommendations")
    .insert({
      run_id: runId,
      agent_key: "QF-AOS-NexusKernel",
      recommendation_key: recommendation.key,
      entity_type: "lead",
      entity_id: leadId,
      priority: recommendation.priority,
      confidence_score: recommendation.confidence,
      rationale: recommendation.rationale,
      payload: recommendation.payload,
      suggested_action_type: recommendation.suggestedActionType,
      action_state: recommendation.suggestedActionType ? "proposable" : "advisory_only",
    })
    .select("id")
    .maybeSingle();

  if (error || !data?.id) return null;
  return String(data.id);
}

async function persistMemory(
  runId: string,
  input: AosV2LeadIntelligenceInput,
): Promise<void> {
  const { error } = await adminClient()
    .from("aos_agent_memory")
    .upsert(
      {
        namespace: "lead_intelligence",
        subject_type: "lead",
        subject_id: input.lead.leadId,
        memory_key: "canonical_snapshot_v1",
        value: buildAosV2LeadMemory(input),
        source_run_id: runId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "namespace,subject_type,subject_id,memory_key" },
    );
  if (error) {
    console.info("[aos-v2] memory persistence skipped safely", { leadId: input.lead.leadId });
  }
}

async function completeRun(runId: string, recommendation: AosV2Recommendation): Promise<void> {
  await adminClient()
    .from("aos_runs")
    .update({
      status: "completed",
      recommendation_summary: {
        key: recommendation.key,
        priority: recommendation.priority,
        confidence: recommendation.confidence,
        suggestedActionType: recommendation.suggestedActionType,
      },
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

async function markRunFailed(runId: string, errorCode: string): Promise<void> {
  try {
    await adminClient()
      .from("aos_runs")
      .update({
        status: "failed",
        error_code: errorCode,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
  } catch {
    // AOS failure logging can never become a Core failure.
  }
}

async function appendAudit(
  runId: string,
  leadId: string,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await adminClient().from("aos_audit_logs").insert({
      run_id: runId,
      action,
      entity_type: "lead",
      entity_id: leadId,
      actor_type: "system",
      actor_id: "aos-v2",
      details,
    });
  } catch {
    // Advisory audit must not affect business flow.
  }
}

function buildCorrelationId(leadId: string): string {
  return `aosv2:${leadId}:${Date.now()}`.slice(0, 240);
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 120) || "AOS_V2_FAILED";
  }
  return "AOS_V2_FAILED";
}
