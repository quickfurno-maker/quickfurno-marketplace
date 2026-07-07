import { adminClient } from "../../../../supabase";
import {
  scoreAndStoreLead,
  type LeadQualityInput,
  type LeadQualityRecommendedAction,
  type LeadQualityScoreResult,
  type LeadScoreClass,
} from "../../../../../services/leadQualityService";
import type {
  LeadLifecycleLatestQualityPort,
  LeadLifecycleQualityPort,
} from "./leadLifecycleServicePorts";

type LeadQualityRow = LeadQualityInput & {
  id: string;
  serviceCategory?: string | null;
  budgetRange?: string | null;
};

type PersistedLeadScoreRow = {
  contact_score?: number | null;
  location_score?: number | null;
  requirement_score?: number | null;
  intent_score?: number | null;
  fraud_penalty?: number | null;
  total_score?: number | null;
  score_class?: string | null;
  hard_block_reason?: string | null;
  recommended_action?: string | null;
  score_breakdown?: Record<string, unknown> | null;
};

export class LeadQualityServiceAdapter implements LeadLifecycleQualityPort {
  async scoreLead(leadId: string): Promise<LeadQualityScoreResult> {
    const lead = await loadLeadForQuality(leadId);
    return scoreAndStoreLead(leadId, toQualityInput(lead));
  }
}

/**
 * Rescore tasks read the latest persisted authoritative score. The live
 * clarification completion path already recalculates and stores that score.
 */
export class LatestPersistedLeadQualityAdapter implements LeadLifecycleLatestQualityPort {
  async readLatestQualityResult(leadId: string): Promise<LeadQualityScoreResult> {
    const { data, error } = await adminClient()
      .from("lead_scores")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("LEAD_QUALITY_SCORE_NOT_FOUND");
    return normalizePersistedScore(data as PersistedLeadScoreRow);
  }
}

async function loadLeadForQuality(leadId: string): Promise<LeadQualityRow> {
  const { data, error } = await adminClient()
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("LEAD_NOT_FOUND");
  return data as LeadQualityRow;
}

function toQualityInput(lead: LeadQualityRow): LeadQualityInput {
  return {
    name: lead.name,
    phone: lead.phone,
    city: lead.city,
    area: lead.area ?? lead.locality,
    locality: lead.locality,
    address: lead.address,
    latitude: lead.latitude,
    longitude: lead.longitude,
    google_place_id: lead.google_place_id,
    formatted_address: lead.formatted_address,
    area_normalized: lead.area_normalized,
    sublocality: lead.sublocality,
    neighborhood: lead.neighborhood,
    location_source: lead.location_source,
    service_required: lead.service_required,
    service_category: lead.service_category,
    serviceCategory: lead.serviceCategory,
    category: lead.category,
    subcategory: lead.subcategory,
    budget: lead.budget ?? lead.budget_range ?? lead.budgetRange,
    budget_range: lead.budget_range,
    budgetRange: lead.budgetRange,
    property_type: lead.property_type,
    timeline: lead.timeline,
    message: lead.message ?? lead.requirement,
    requirement: lead.requirement,
    share_consent: lead.share_consent,
    location_consent: lead.location_consent,
    is_duplicate: lead.is_duplicate,
    lead_intent: lead.lead_intent,
    assignment_intent: lead.assignment_intent,
  };
}

function normalizePersistedScore(row: PersistedLeadScoreRow): LeadQualityScoreResult {
  const scoreBreakdown = isRecord(row.score_breakdown) ? row.score_breakdown : {};
  return {
    contact_score: numberOrZero(row.contact_score),
    location_score: numberOrZero(row.location_score),
    requirement_score: numberOrZero(row.requirement_score),
    intent_score: numberOrZero(row.intent_score),
    fraud_penalty: numberOrZero(row.fraud_penalty),
    total_score: numberOrZero(row.total_score),
    location_confidence: readLocationConfidence(scoreBreakdown),
    score_class: normalizeScoreClass(row.score_class),
    hard_block_reason: textOrNull(row.hard_block_reason),
    recommended_action: normalizeRecommendedAction(row.recommended_action),
    score_breakdown: scoreBreakdown,
  };
}

function readLocationConfidence(scoreBreakdown: Record<string, unknown>): number {
  const nested = scoreBreakdown.location_confidence;
  if (isRecord(nested)) return numberOrZero(nested.score);
  return 0;
}

function normalizeScoreClass(value: unknown): LeadScoreClass {
  if (value === "A+" || value === "A" || value === "B" || value === "C" || value === "D") return value;
  throw new Error("LEAD_QUALITY_SCORE_CLASS_INVALID");
}

function normalizeRecommendedAction(value: unknown): LeadQualityRecommendedAction {
  switch (value) {
    case "auto_distribute":
    case "clarification_required":
    case "nurture":
    case "reject_or_manual_review":
    case "duplicate_no_bill":
    case "consent_required_no_distribution":
    case "invalid_phone_no_distribution":
    case "manual_review_suspicious_name":
      return value;
    default:
      throw new Error("LEAD_QUALITY_RECOMMENDED_ACTION_INVALID");
  }
}

function numberOrZero(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
