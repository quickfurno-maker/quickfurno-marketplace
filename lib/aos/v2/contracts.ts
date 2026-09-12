// ==========================================================================
// QuickFurno AOS V2 — production intelligence contracts
//
// AOS is advisory intelligence. QuickFurno Core remains the only business
// authority; n8n executes only Core-authorized automation jobs.
// ============================================================================
import type { LeadQualityScoreResult } from "@/services/leadQualityService";

export const AOS_V2_RUNTIME_KEY = "aos_v2_intelligence" as const;
export const AOS_V2_ACTION_PROPOSALS_KEY = "aos_v2_action_proposals" as const;

export type AosV2Mode = "off" | "shadow";

export type AosV2RunStatus =
  | "started"
  | "completed"
  | "failed"
  | "skipped";

export type AosV2RecommendationKey =
  | "lead_ready_for_distribution"
  | "clarification_needed"
  | "nurture"
  | "duplicate_hold"
  | "consent_hold"
  | "invalid_phone_hold"
  | "manual_review"
  | "quality_unavailable"
  | "matching_completed"
  | "matching_waiting"
  | "preferred_vendor_routing"
  | "client_selected_routing";

export interface AosV2LeadContext {
  leadId: string;
  city: string | null;
  area: string | null;
  serviceRequired: string | null;
  budget: string | null;
  isDuplicate: boolean;
  shareConsent: boolean;
  leadIntent?: string | null;
  assignmentIntent?: string | null;
  targetVendorId?: string | null;
}

export interface AosV2CoreMatchEvidence {
  status: "matched" | "waiting" | "skipped" | "failed";
  eligibleVendorCount: number;
  selectedVendorIds: string[];
  failureReason?: string | null;
}

export interface AosV2LeadIntelligenceInput {
  lead: AosV2LeadContext;
  quality: LeadQualityScoreResult | null;
  coreMatch: AosV2CoreMatchEvidence | null;
}

export interface AosV2AgentDecision {
  agentKey: string;
  taskType: string;
  decision: string;
  reason: string;
  confidence: number;
  metadata: Readonly<Record<string, unknown>>;
}

export interface AosV2Recommendation {
  key: AosV2RecommendationKey;
  priority: "low" | "medium" | "high";
  confidence: number;
  rationale: string;
  payload: Readonly<Record<string, unknown>>;
  suggestedActionType: string | null;
}

export interface AosV2LeadIntelligenceResult {
  ok: true;
  active: boolean;
  mode: AosV2Mode;
  runId: string | null;
  recommendationId: string | null;
  recommendation: AosV2Recommendation | null;
  persisted: boolean;
  message: string;
}

export interface AosV2RuntimeState {
  intelligenceEnabled: boolean;
  mode: AosV2Mode;
  actionProposalsEnabled: boolean;
  legacyDirectN8nRetired: true;
}
