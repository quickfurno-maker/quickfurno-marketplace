import { randomUUID } from "node:crypto";
import { adminClient } from "@/lib/supabase";
import { getAosV2RuntimeState } from "@/lib/aos/v2/runtime";
import { canSourceRequestAction, type AutomationActionType } from "@/lib/automation/actionRegistry";
import {
  CERTIFIED_AOS_PROPOSAL_ACTIONS,
  isCertifiedAosProposalAction,
} from "@/lib/aos/v2/proposalPolicy";
import { AUTOMATION_CONTRACT_VERSION } from "@/lib/automation/actionContract";
import { createAutomationActionRequest } from "./automationPersistenceService";

export type AosProposalResult =
  | { ok: true; requestId: string; decisionStatus: "requested" }
  | { ok: false; code: string };

export async function proposeAosRecommendationToCore(
  recommendationId: string,
): Promise<AosProposalResult> {
  const runtime = await getAosV2RuntimeState();
  if (!runtime.intelligenceEnabled) return { ok: false, code: "AOS_V2_INTELLIGENCE_DISABLED" };
  if (!runtime.actionProposalsEnabled) return { ok: false, code: "AOS_V2_ACTION_PROPOSALS_DISABLED" };

  const { data, error } = await adminClient()
    .from("aos_recommendations")
    .select("id, run_id, recommendation_key, entity_type, entity_id, suggested_action_type, action_state")
    .eq("id", recommendationId)
    .maybeSingle();

  if (error || !data) return { ok: false, code: "AOS_V2_RECOMMENDATION_NOT_FOUND" };
  if (data.action_state !== "proposable") return { ok: false, code: "AOS_V2_RECOMMENDATION_NOT_PROPOSABLE" };

  const actionType = data.suggested_action_type;
  if (!isCertifiedAosProposalAction(actionType)) {
    return { ok: false, code: "AOS_V2_ACTION_NOT_CERTIFIED_FOR_PROPOSAL" };
  }
  if (!canSourceRequestAction("system", actionType)) {
    return { ok: false, code: "AOS_V2_CORE_REQUEST_SCOPE_REFUSED" };
  }

  const requestId = randomUUID();
  const now = new Date().toISOString();
  const request = await createAutomationActionRequest({
    contractVersion: AUTOMATION_CONTRACT_VERSION,
    requestId,
    actionType,
    entityType: String(data.entity_type),
    entityId: String(data.entity_id),
    source: "system",
    requestedBy: { actorType: "system", actorId: "aos-v2-proposal" },
    requestedAt: now,
    idempotencyKey: `aosv2:${data.id}:${actionType}`.slice(0, 240),
    correlationId: `aosv2:${data.run_id}`.slice(0, 240),
    safeContext: {
      aosRecommendationId: String(data.id),
      aosRecommendationKey: String(data.recommendation_key),
      aosRunId: String(data.run_id),
    },
  });

  // Creating a request is deliberately NOT authorization. Core/admin must make
  // the separate decision before any automation job can exist.
  const { error: updateError } = await adminClient()
    .from("aos_recommendations")
    .update({
      action_state: "requested",
      automation_request_id: request.id,
    })
    .eq("id", data.id)
    .eq("action_state", "proposable");
  if (updateError) return { ok: false, code: "AOS_V2_RECOMMENDATION_LINK_FAILED" };

  await adminClient().from("aos_audit_logs").insert({
    run_id: data.run_id,
    action: "aos_v2.core_action_requested",
    entity_type: data.entity_type,
    entity_id: data.entity_id,
    actor_type: "system",
    actor_id: "aos-v2-proposal",
    details: {
      recommendationId: data.id,
      automationRequestId: request.id,
      actionType,
      decisionStatus: "requested",
      authorized: false,
      jobCreated: false,
    },
  });

  return { ok: true, requestId: request.id, decisionStatus: "requested" };
}
