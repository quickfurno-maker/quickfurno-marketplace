import { AUTOMATION_CONTRACT_VERSION, type CoreActionRequest } from "../lib/automation/actionContract";
import type { AutomationActionType } from "../lib/automation/actionRegistry";
import type { QfjActionRequestV1 } from "../lib/jarvis/actionRequestContract";
import { submitJarvisRecommendationToStore, type JarvisRecommendationRecord, type JarvisRecommendationResult, type JarvisRecommendationStore } from "../lib/jarvis/recommendationIntake";
import { isQfJarvisActionTypeEnabled, type QfJarvisRuntimePolicy } from "../lib/jarvis/runtimePolicy";

async function productionDb() { const { adminClient } = await import("../lib/supabase"); return adminClient(); }
function priority(action: AutomationActionType): "low" | "medium" { return action === "client.requirement_collection" || action === "vendor.onboarding_reminder" || action === "vendor.document_reminder" ? "low" : "medium"; }

const productionStore: JarvisRecommendationStore = Object.freeze({
  async save({ request, actionState, mode }: { readonly request: QfjActionRequestV1; readonly actionState: "advisory_only" | "proposable"; readonly mode: "shadow" | "recommend" }): Promise<JarvisRecommendationRecord> {
    const db = await productionDb(); const runId = request.requestId;
    const runInsert = await db.from("aos_runs").insert({ id:runId, correlation_id:`qfj:${runId}`, event_type:"jarvis.recommendation.submitted", entity_type:request.entityType, entity_id:request.entityId, source:"qf-jarvis", mode, status:"started", canonical_inputs:{ source:request.source, actionType:request.actionType, evidenceId:request.evidenceId } }).select("id").maybeSingle();
    if (runInsert.error && runInsert.error.code !== "23505") throw runInsert.error;
    const existing = await db.from("aos_recommendations").select("id, action_state, run_id").eq("run_id",runId).eq("agent_key",request.source).eq("recommendation_key",request.actionType).maybeSingle();
    if (existing.data?.id) return { recommendationId:String(existing.data.id), actionState:existing.data.action_state as "advisory_only"|"proposable", runId };
    const inserted = await db.from("aos_recommendations").insert({ run_id:runId, agent_key:request.source, recommendation_key:request.actionType, entity_type:request.entityType, entity_id:request.entityId, priority:priority(request.actionType), confidence_score:request.confidence, rationale:request.reasonCode, payload:{ evidenceId:request.evidenceId, ...request.safeContext }, suggested_action_type:request.actionType, action_state:actionState }).select("id, action_state").maybeSingle();
    if (inserted.error || !inserted.data?.id) throw inserted.error ?? new Error("JARVIS_RECOMMENDATION_NOT_PERSISTED");
    await db.from("aos_runs").update({ status:"completed", recommendation_summary:{ recommendationId:inserted.data.id, actionType:request.actionType, actionState }, completed_at:new Date().toISOString() }).eq("id",runId);
    return { recommendationId:String(inserted.data.id), actionState, runId };
  },
});

export async function submitJarvisRecommendation(args:{ readonly request:QfjActionRequestV1; readonly policy:QfJarvisRuntimePolicy }):Promise<JarvisRecommendationResult> {
  return submitJarvisRecommendationToStore({ ...args, store:productionStore });
}

export type JarvisPromotionResult = { readonly ok:true; readonly requestId:string; readonly decisionStatus:"requested" } | { readonly ok:false; readonly code:string };
export async function promoteJarvisRecommendationToCore(recommendationId:string, policy:QfJarvisRuntimePolicy):Promise<JarvisPromotionResult> {
  if (policy.mode !== "active" || !policy.actionProposalEnabled) return { ok:false, code:"JARVIS_ACTION_PROPOSALS_DISABLED" };
  const db = await productionDb();
  const rec = await db.from("aos_recommendations").select("id, run_id, agent_key, entity_type, entity_id, suggested_action_type, action_state, payload, automation_request_id").eq("id",recommendationId).maybeSingle();
  if (rec.error || !rec.data) return { ok:false, code:"JARVIS_RECOMMENDATION_NOT_FOUND" };
  if (rec.data.action_state === "requested" && rec.data.automation_request_id) return { ok:true, requestId:String(rec.data.automation_request_id), decisionStatus:"requested" };
  if (rec.data.action_state !== "proposable") return { ok:false, code:"JARVIS_RECOMMENDATION_NOT_PROPOSABLE" };
  const run = await db.from("aos_runs").select("id, source").eq("id",rec.data.run_id).maybeSingle();
  if (run.error || run.data?.source !== "qf-jarvis") return { ok:false, code:"JARVIS_RECOMMENDATION_PROVENANCE_REFUSED" };
  const actionType = String(rec.data.suggested_action_type ?? ""); if (!isQfJarvisActionTypeEnabled(policy,actionType)) return { ok:false, code:"JARVIS_ACTION_TYPE_PAUSED" };
  const source=String(rec.data.agent_key); if ((source === "riya" && !policy.riyaEnabled) || (source === "anisha" && !policy.anishaEnabled)) return { ok:false, code:"JARVIS_AGENT_PAUSED" };
  const requestId=globalThis.crypto.randomUUID(), now=new Date().toISOString();
  const payload=rec.data.payload as Record<string,unknown>|null; const evidenceId=typeof payload?.evidenceId === "string" ? payload.evidenceId : String(rec.data.id);
  const request:CoreActionRequest={ contractVersion:AUTOMATION_CONTRACT_VERSION, requestId, actionType, entityType:String(rec.data.entity_type), entityId:String(rec.data.entity_id), source:"system", requestedBy:{ actorType:"system", actorId:"qf-jarvis-proposal-bridge" }, requestedAt:now, idempotencyKey:`qfj:${rec.data.id}:${actionType}`.slice(0,240), correlationId:`qfj:${rec.data.run_id}`.slice(0,240), safeContext:{ jarvisRecommendationId:String(rec.data.id), jarvisRunId:String(rec.data.run_id), evidenceId } };
  let created; try { const { createAutomationActionRequest } = await import("./automationPersistenceService"); created=await createAutomationActionRequest(request); } catch { return { ok:false, code:"JARVIS_CORE_REQUEST_CREATE_FAILED" }; }
  const update=await db.from("aos_recommendations").update({ action_state:"requested", automation_request_id:created.id }).eq("id",rec.data.id).eq("action_state","proposable");
  if (update.error) return { ok:false, code:"JARVIS_RECOMMENDATION_LINK_FAILED" };
  return { ok:true, requestId:String(created.id), decisionStatus:"requested" };
}