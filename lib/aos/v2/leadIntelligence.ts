import { canAutoDistributeLead } from "../../lead-quality/distributionGate";
import type {
  AosV2AgentDecision,
  AosV2LeadIntelligenceInput,
  AosV2Recommendation,
} from "./contracts";

export function buildAosV2CanonicalSnapshot(input: AosV2LeadIntelligenceInput) {
  return {
    lead: {
      leadId: input.lead.leadId,
      city: input.lead.city,
      area: input.lead.area,
      serviceRequired: input.lead.serviceRequired,
      budget: input.lead.budget,
      isDuplicate: input.lead.isDuplicate,
      shareConsent: input.lead.shareConsent,
      leadIntent: input.lead.leadIntent ?? null,
      assignmentIntent: input.lead.assignmentIntent ?? null,
      targetVendorSelected: Boolean(input.lead.targetVendorId),
    },
    quality: input.quality
      ? {
          totalScore: input.quality.total_score,
          scoreClass: input.quality.score_class,
          hardBlockReason: input.quality.hard_block_reason,
          recommendedAction: input.quality.recommended_action,
          locationConfidence: input.quality.location_confidence,
          autoDistributionEligible: canAutoDistributeLead(input.quality),
        }
      : null,
    coreMatch: input.coreMatch
      ? {
          status: input.coreMatch.status,
          eligibleVendorCount: input.coreMatch.eligibleVendorCount,
          selectedVendorCount: input.coreMatch.selectedVendorIds.length,
          failureReason: input.coreMatch.failureReason ?? null,
        }
      : null,
  };
}

export function deriveAosV2LeadDecisions(
  input: AosV2LeadIntelligenceInput,
): AosV2AgentDecision[] {
  const quality = input.quality;
  const coreMatch = input.coreMatch;
  const decisions: AosV2AgentDecision[] = [
    {
      agentKey: "QF-AOS-NexusKernel",
      taskType: "authority_guard",
      decision: "core_authority_preserved",
      reason: "AOS is advisory. Core owns scoring, assignment, credits, communication authorization and automation decisions.",
      confidence: 1,
      metadata: { directN8nAllowed: false, businessMutationAllowed: false },
    },
  ];

  decisions.push({
    agentKey: "QF-AOS-LeadLens",
    taskType: "lead_quality_observation",
    decision: quality ? quality.recommended_action : "quality_unavailable",
    reason: quality
      ? `Canonical Core quality=${quality.score_class} score=${quality.total_score}; no AOS rescore performed.`
      : "Canonical Core quality result was unavailable; AOS did not invent a replacement score.",
    confidence: quality ? 1 : 0.4,
    metadata: quality
      ? {
          scoreClass: quality.score_class,
          totalScore: quality.total_score,
          hardBlockReason: quality.hard_block_reason,
        }
      : {},
  });

  const duplicate = input.lead.isDuplicate || quality?.recommended_action === "duplicate_no_bill";
  decisions.push({
    agentKey: "QF-AOS-TrustShield",
    taskType: "trust_observation",
    decision: duplicate ? "duplicate_hold" : quality?.hard_block_reason ? "review_signal" : "no_canonical_hold",
    reason: duplicate
      ? "Core marked the lead duplicate; AOS preserves the hold and does not create billing/distribution authority."
      : quality?.hard_block_reason
        ? `Core quality gate reported: ${quality.hard_block_reason}.`
        : "No duplicate or canonical quality hard-block signal was observed.",
    confidence: quality || duplicate ? 1 : 0.6,
    metadata: { duplicate, hardBlockReason: quality?.hard_block_reason ?? null },
  });

  decisions.push({
    agentKey: "QF-AOS-MatchForge",
    taskType: "matching_observation",
    decision: coreMatch ? coreMatch.status : "not_run",
    reason: coreMatch
      ? `Observed canonical Core matcher outcome ${coreMatch.status}; AOS did not rank or assign vendors independently.`
      : "Canonical matcher did not run for this lead path; AOS did not create a competing candidate ranking.",
    confidence: coreMatch ? 1 : 0.7,
    metadata: coreMatch
      ? {
          eligibleVendorCount: coreMatch.eligibleVendorCount,
          selectedVendorCount: coreMatch.selectedVendorIds.length,
          failureReason: coreMatch.failureReason ?? null,
        }
      : {},
  });

  decisions.push({
    agentKey: "QF-AOS-LeadFlow",
    taskType: "lead_flow_observation",
    decision: resolveLeadFlowDecision(input),
    reason: "Observed the Core-owned lead route. AOS performed no assignment, credit mutation, WhatsApp send or n8n dispatch.",
    confidence: 1,
    metadata: {
      leadIntent: input.lead.leadIntent ?? null,
      assignmentIntent: input.lead.assignmentIntent ?? null,
      matcherStatus: coreMatch?.status ?? null,
    },
  });

  return decisions;
}

export function deriveAosV2LeadRecommendation(
  input: AosV2LeadIntelligenceInput,
): AosV2Recommendation {
  const quality = input.quality;
  if (!quality) {
    return recommendation("quality_unavailable", "high", 0.6,
      "Canonical Core quality evidence is unavailable. Keep distribution governed by Core and surface this lead for operational review.");
  }

  if (input.lead.isDuplicate || quality.recommended_action === "duplicate_no_bill") {
    return recommendation("duplicate_hold", "high", 1,
      "Core identified a duplicate lead. Preserve no-bill/no-distribution treatment.");
  }
  if (!input.lead.shareConsent || quality.recommended_action === "consent_required_no_distribution") {
    return recommendation("consent_hold", "high", 1,
      "Share consent is absent. Do not distribute the lead until Core records valid consent.");
  }
  if (quality.recommended_action === "invalid_phone_no_distribution") {
    return recommendation("invalid_phone_hold", "high", 1,
      "Core rejected the contact number for distribution. Keep the lead held for correction/manual review.");
  }
  if (quality.recommended_action === "clarification_required") {
    return recommendation("clarification_needed", "high", 1,
      "Core quality policy requires requirement clarification before distribution. Core already owns the canonical clarification producer, so AOS does not propose a duplicate action.");
  }
  if (quality.recommended_action === "nurture") {
    return recommendation("nurture", "medium", 1,
      "Core classified the lead for nurture rather than immediate distribution.",
      "client.transactional_followup");
  }
  if (quality.hard_block_reason || quality.recommended_action === "reject_or_manual_review") {
    return recommendation("manual_review", "high", 1,
      `Core requires manual review${quality.hard_block_reason ? `: ${quality.hard_block_reason}` : "."}`);
  }

  if (input.lead.leadIntent === "preferred_vendor" && input.lead.targetVendorId) {
    return recommendation("preferred_vendor_routing", "medium", 1,
      "Client selected a preferred vendor route. Preserve the Core-owned preferred-vendor policy.");
  }
  if (input.lead.assignmentIntent === "client_selected_vendor") {
    return recommendation("client_selected_routing", "medium", 1,
      "Client-selected assignment intent is active. Preserve the dedicated Core assignment window.");
  }

  if (canAutoDistributeLead(quality)) {
    if (input.coreMatch?.status === "matched") {
      return recommendation("matching_completed", "low", 1,
        `Core completed matching with ${input.coreMatch.selectedVendorIds.length} selected vendor(s). No duplicate AOS action is required.`);
    }
    if (input.coreMatch?.status === "waiting") {
      return recommendation("matching_waiting", "high", 1,
        "Lead passed quality but Core matching is waiting for eligible supply. Surface for operations without bypassing matching policy.");
    }
    if (input.coreMatch?.status === "failed") {
      return recommendation("manual_review", "high", 1,
        `Core matching failed${input.coreMatch.failureReason ? `: ${input.coreMatch.failureReason}` : "."}`);
    }
    return recommendation("lead_ready_for_distribution", "medium", 1,
      "Lead passed the canonical Core quality gate. Core remains responsible for whether and when matching executes.");
  }

  return recommendation("manual_review", "medium", 0.95,
    "No safe automated next step follows from the canonical Core evidence. Keep this advisory for operations.");
}

export function buildAosV2LeadMemory(input: AosV2LeadIntelligenceInput) {
  return {
    qualityClass: input.quality?.score_class ?? null,
    qualityScore: input.quality?.total_score ?? null,
    qualityAction: input.quality?.recommended_action ?? null,
    hardBlockReason: input.quality?.hard_block_reason ?? null,
    matcherStatus: input.coreMatch?.status ?? null,
    eligibleVendorCount: input.coreMatch?.eligibleVendorCount ?? null,
    selectedVendorCount: input.coreMatch?.selectedVendorIds.length ?? null,
    leadIntent: input.lead.leadIntent ?? null,
    assignmentIntent: input.lead.assignmentIntent ?? null,
  };
}

function recommendation(
  key: AosV2Recommendation["key"],
  priority: AosV2Recommendation["priority"],
  confidence: number,
  rationale: string,
  suggestedActionType: string | null = null,
): AosV2Recommendation {
  return { key, priority, confidence, rationale, payload: {}, suggestedActionType };
}

function resolveLeadFlowDecision(input: AosV2LeadIntelligenceInput): string {
  if (input.lead.leadIntent === "preferred_vendor") return "preferred_vendor_core_route";
  if (input.lead.assignmentIntent === "client_selected_vendor") return "client_selected_core_route";
  if (input.coreMatch) return `core_match_${input.coreMatch.status}`;
  if (input.quality?.recommended_action) return `core_quality_${input.quality.recommended_action}`;
  return "core_route_observed";
}

