import type { QfjActionRequestV1 } from "./actionRequestContract";
import { isQfJarvisActionTypeEnabled, type QfJarvisRuntimePolicy } from "./runtimePolicy";

export interface JarvisRecommendationRecord { readonly recommendationId: string; readonly actionState: "advisory_only" | "proposable"; readonly runId: string; }
export interface JarvisRecommendationStore { save(input: { readonly request: QfjActionRequestV1; readonly actionState: "advisory_only" | "proposable"; readonly mode: "shadow" | "recommend" }): Promise<JarvisRecommendationRecord>; }
export type JarvisRecommendationResult = { readonly ok:true; readonly recommendation:JarvisRecommendationRecord } | { readonly ok:false; readonly reason:"disabled" | "agent_paused" | "unavailable" };
function agentEnabled(policy: QfJarvisRuntimePolicy, source: QfjActionRequestV1["source"]): boolean { if (source === "riya") return policy.riyaEnabled; if (source === "anisha") return policy.anishaEnabled; return true; }
export async function submitJarvisRecommendationToStore(args: { readonly request:QfjActionRequestV1; readonly policy:QfJarvisRuntimePolicy; readonly store:JarvisRecommendationStore }): Promise<JarvisRecommendationResult> {
  if (args.policy.mode === "off" || !args.policy.recommendationIntakeEnabled) return { ok:false, reason:"disabled" };
  if (!agentEnabled(args.policy,args.request.source)) return { ok:false, reason:"agent_paused" };
  const actionState = isQfJarvisActionTypeEnabled(args.policy,args.request.actionType) ? "proposable" : "advisory_only";
  try { return { ok:true, recommendation:await args.store.save({ request:args.request, actionState, mode:args.policy.mode === "shadow" ? "shadow" : "recommend" }) }; }
  catch { return { ok:false, reason:"unavailable" }; }
}