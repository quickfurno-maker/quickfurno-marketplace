import { adminClient } from "../lib/supabase";
import { appError, fail, ok, type Result } from "../lib/errors";
import {
  buildClarificationPreviewMessage,
  buildClarificationQuestions,
  detectMissingClarificationFields,
  getClarificationPresetForLead,
  mapClarificationAnswerToLeadField,
  type ClarificationLeadLike,
  type ClarificationQuestion,
} from "../lib/lead-quality/clarificationPresets";
import { scoreAndStoreLead, type LeadQualityScoreResult } from "./leadQualityService";

export type LeadClarificationRequest = {
  id: string;
  lead_id: string;
  score_before?: number | null;
  score_class_before?: string | null;
  parent_category_group?: string | null;
  marketplace_category?: string | null;
  service_required?: string | null;
  subcategory?: string | null;
  missing_fields?: string[] | null;
  questions_json?: ClarificationQuestion[] | null;
  preview_message?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ClarificationResponseInput = {
  question_key: string;
  answer_value: string;
  answer_label?: string | null;
  raw_payload?: Record<string, unknown>;
};

type LeadRow = ClarificationLeadLike & {
  id: string;
  phone?: string | null;
  email?: string | null;
  share_consent?: boolean | null;
  location_consent?: boolean | null;
  is_duplicate?: boolean | null;
  lead_intent?: string | null;
  lead_quality_score?: number | null;
  lead_quality_class?: string | null;
  lead_quality_recommended_action?: string | null;
  clarification_status?: string | null;
  clarification_last_request_id?: string | null;
};

export function shouldCreateClarificationForLead(lead: Partial<LeadRow>, scoreResult?: LeadQualityScoreResult | null): boolean {
  if (lead.is_duplicate) return false;
  const scoreClass = String(scoreResult?.score_class ?? lead.lead_quality_class ?? "").toUpperCase();
  const action = String(scoreResult?.recommended_action ?? lead.lead_quality_recommended_action ?? "");
  return scoreClass === "B" || action === "clarification_required";
}

export async function createClarificationRequestForLead(leadId: string): Promise<Result<LeadClarificationRequest>> {
  try {
    const existing = await getLatestClarificationRequest(leadId);
    if (existing.ok && existing.data && ["preview_prepared", "preview_sent"].includes(String(existing.data.status ?? ""))) {
      return ok(existing.data);
    }

    const lead = await loadLeadForClarification(leadId);
    if (!lead) throw appError("LEAD_NOT_FOUND");
    if (!shouldCreateClarificationForLead(lead)) {
      return { ok: false, code: "CLARIFICATION_NOT_REQUIRED", error: "Clarification preview is only prepared for B leads or clarification-required leads." };
    }

    const preset = getClarificationPresetForLead(lead);
    const questions = preset.questions.length ? preset.questions : buildClarificationQuestions(lead);
    const missingFields = preset.missingFields.length ? preset.missingFields : detectMissingClarificationFields(lead);
    const previewMessage = preset.previewMessage || buildClarificationPreviewMessage(lead, questions);
    const now = new Date().toISOString();

    const { data, error } = await adminClient()
      .from("lead_clarification_requests")
      .insert({
        lead_id: leadId,
        score_before: lead.lead_quality_score ?? null,
        score_class_before: lead.lead_quality_class ?? null,
        parent_category_group: preset.parentCategoryGroup,
        marketplace_category: preset.marketplaceCategory,
        service_required: preset.serviceRequired,
        subcategory: preset.subcategory,
        missing_fields: missingFields,
        questions_json: questions,
        preview_message: previewMessage,
        status: "preview_prepared",
        sent_preview_at: now,
        created_by: "system",
      })
      .select("*")
      .single();
    if (error) throw error;

    await adminClient().from("leads").update({
      clarification_required: true,
      clarification_status: "preview_prepared",
      clarification_missing_fields: missingFields,
      clarification_last_request_id: data.id,
      clarification_checked_at: now,
    }).eq("id", leadId);

    return ok(normalizeRequest(data));
  } catch (e) {
    return fail(e);
  }
}

export async function getLatestClarificationRequest(leadId: string): Promise<Result<LeadClarificationRequest | null>> {
  try {
    const { data, error } = await adminClient()
      .from("lead_clarification_requests")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    return ok(data?.[0] ? normalizeRequest(data[0]) : null);
  } catch (e) {
    return fail(e);
  }
}

export async function saveClarificationResponses(
  leadId: string,
  requestId: string,
  responses: ClarificationResponseInput[],
): Promise<Result<{ score: LeadQualityScoreResult; status: string }>> {
  try {
    if (!leadId || !requestId || responses.length === 0) throw appError("VALIDATION");

    const rows = responses.map((response) => {
      const mapped = mapClarificationAnswerToLeadField(response.question_key, response.answer_value);
      return {
        lead_id: leadId,
        request_id: requestId,
        question_key: response.question_key,
        answer_value: response.answer_value,
        answer_label: response.answer_label ?? response.answer_value,
        mapped_field: mapped?.mapped_field ?? null,
        mapped_value: mapped?.mapped_value ?? null,
        raw_payload: response.raw_payload ?? {},
      };
    });

    const { error } = await adminClient().from("lead_clarification_responses").insert(rows);
    if (error) throw error;

    await applyClarificationResponsesToLead(leadId, responses);
    const score = await recalculateLeadAfterClarification(leadId);
    if (!score.ok) return score;

    const upgraded = score.data.total_score >= 70 && !score.data.hard_block_reason;
    const status = upgraded ? "completed_upgraded" : "completed_still_incomplete";
    const now = new Date().toISOString();

    await adminClient().from("lead_clarification_requests").update({
      status,
      response_received_at: now,
      completed_at: now,
      updated_at: now,
    }).eq("id", requestId);

    await adminClient().from("leads").update({
      clarification_required: !upgraded,
      clarification_status: status,
      clarification_checked_at: now,
      status: upgraded ? "Manual Review" : "Clarification Required",
      verification_status: upgraded ? "Manual Review" : "Quality Checked",
    }).eq("id", leadId);

    return ok({ score: score.data, status });
  } catch (e) {
    return fail(e);
  }
}

export async function applyClarificationResponsesToLead(leadId: string, responses: ClarificationResponseInput[]): Promise<Result<null>> {
  try {
    const lead = await loadLeadForClarification(leadId);
    if (!lead) throw appError("LEAD_NOT_FOUND");

    const patch: Record<string, unknown> = {};
    const detailLines: string[] = [];
    for (const response of responses) {
      const mapped = mapClarificationAnswerToLeadField(response.question_key, response.answer_value);
      if (!mapped) continue;
      for (const [key, value] of Object.entries(mapped.lead_patch)) {
        if (key === "message_append") detailLines.push(String(value));
        else patch[key] = value;
      }
    }

    if (detailLines.length > 0) {
      const current = text(lead.message);
      patch.message = [current, ...detailLines].filter(Boolean).join("\n");
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await adminClient().from("leads").update(patch).eq("id", leadId);
      if (error) throw error;
    }

    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function recalculateLeadAfterClarification(leadId: string): Promise<Result<LeadQualityScoreResult>> {
  try {
    const lead = await loadLeadForClarification(leadId);
    if (!lead) throw appError("LEAD_NOT_FOUND");
    const score = await scoreAndStoreLead(leadId, {
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      city: lead.city,
      area: lead.area ?? lead.locality,
      service_required: lead.service_required,
      service_category: lead.service_category,
      serviceCategory: lead.serviceCategory,
      category: lead.category,
      subcategory: lead.subcategory,
      budget: lead.budget ?? lead.budget_range ?? lead.budgetRange,
      property_type: lead.property_type,
      timeline: lead.timeline,
      message: lead.message ?? lead.requirement,
      share_consent: lead.share_consent,
      location_consent: lead.location_consent,
      is_duplicate: lead.is_duplicate,
      lead_intent: lead.lead_intent,
    });
    return ok(score);
  } catch (e) {
    return fail(e);
  }
}

async function loadLeadForClarification(leadId: string): Promise<LeadRow | null> {
  const { data, error } = await adminClient()
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw error;
  return (data as LeadRow | null) ?? null;
}

function normalizeRequest(value: unknown): LeadClarificationRequest {
  const record = isRecord(value) ? value : {};
  return {
    id: String(record.id ?? ""),
    lead_id: String(record.lead_id ?? ""),
    score_before: numberOrNull(record.score_before),
    score_class_before: stringOrNull(record.score_class_before),
    parent_category_group: stringOrNull(record.parent_category_group),
    marketplace_category: stringOrNull(record.marketplace_category),
    service_required: stringOrNull(record.service_required),
    subcategory: stringOrNull(record.subcategory),
    missing_fields: Array.isArray(record.missing_fields) ? record.missing_fields.map(String) : [],
    questions_json: Array.isArray(record.questions_json) ? record.questions_json as ClarificationQuestion[] : [],
    preview_message: stringOrNull(record.preview_message),
    status: stringOrNull(record.status),
    created_at: stringOrNull(record.created_at),
    updated_at: stringOrNull(record.updated_at),
  };
}

function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
