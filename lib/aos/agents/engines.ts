// ============================================================================
// QuickFurno AOS agent engines (Phase 7)
// Real, deterministic, rule-based logic for the first 5 agents. AI-optional:
// when AI is disabled or unconfigured, these rule-based engines are the fallback
// (and currently the only) path. They are pure functions with no side effects —
// no DB writes, no AI calls, no WhatsApp, no n8n, no credit deduction, and no
// auto-assignment. Every engine is wrapped so a failure NEVER throws to callers,
// keeping existing lead flow intact.
//
// TODO(aos-ai): when AOS_AI_ENABLED + isAiConfigured(), call the provider from a
//   server action and use these engines as the fallback on error/timeout.
// ============================================================================

import {
  AOS_AUTO_ASSIGNMENT_ENABLED,
  AOS_CREDIT_DEDUCTION_ENABLED,
  AOS_LEADFLOW_ENABLED,
  AOS_LEADLENS_ENABLED,
  AOS_MATCHFORGE_ENABLED,
  AOS_OPSBRIEF_ENABLED,
  AOS_TRUSTSHIELD_ENABLED,
  AOS_WHATSAPP_SENDING_ENABLED,
  agentRuntimeMode,
  type AosAgentMode,
} from "@/lib/aos/config/featureFlags";
import type { CRMLead, LeadScoringSignals } from "@/lib/crm/types";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const emptySignals: LeadScoringSignals = {
  has_valid_phone: false,
  has_service: false,
  has_city: false,
  has_area: false,
  has_budget: false,
  has_urgency: false,
  has_requirement_detail: false,
  high_project_value: false,
  looks_like_test_name: false,
  blank_requirement: true,
  duplicate_phone: false,
};

// ---------------------------------------------------------------------------
// 1. LeadLens — rule-based lead scoring
// ---------------------------------------------------------------------------
export type LeadQuality = "hot" | "warm" | "cold" | "weak";

export interface LeadLensResult {
  agent: "QF-AOS-LeadLens";
  mode: AosAgentMode;
  agent_status: string;
  lead_score: number;
  lead_quality: LeadQuality;
  reason: string;
  confidence: number;
  factors: Array<{ label: string; points: number; met: boolean }>;
  error?: string | null;
}

export function runLeadLens(lead: CRMLead): LeadLensResult {
  const mode = agentRuntimeMode(AOS_LEADLENS_ENABLED);
  const base: LeadLensResult = {
    agent: "QF-AOS-LeadLens",
    mode,
    agent_status: mode === "disabled" ? "Disabled" : "Active (rule-based fallback)",
    lead_score: 0,
    lead_quality: "weak",
    reason: "",
    confidence: 0,
    factors: [],
    error: null,
  };
  if (mode === "disabled") {
    return { ...base, reason: "LeadLens is disabled by feature flag." };
  }
  try {
    const s = lead.signals ?? emptySignals;
    const factors = [
      { label: "Valid phone", points: 14, met: s.has_valid_phone },
      { label: "Clear service", points: 12, met: s.has_service },
      { label: "City / area present", points: 12, met: s.has_city || s.has_area },
      { label: "Budget mentioned", points: 18, met: s.has_budget },
      { label: "Urgency mentioned", points: 12, met: s.has_urgency },
      { label: "Requirement detail", points: 16, met: s.has_requirement_detail },
      { label: "High project value", points: 16, met: s.high_project_value },
    ];
    let score = factors.reduce((sum, f) => sum + (f.met ? f.points : 0), 0);
    // Penalize obvious low-quality signals.
    if (s.looks_like_test_name) score -= 25;
    if (s.blank_requirement) score -= 10;
    score = clamp(score, 0, 100);

    const lead_quality: LeadQuality = score >= 75 ? "hot" : score >= 55 ? "warm" : score >= 35 ? "cold" : "weak";
    const met = factors.filter((f) => f.met).length;
    const confidence = clamp(Math.round((met / factors.length) * 40) + 55, 40, 95);
    const topMissing = factors.filter((f) => !f.met).map((f) => f.label).slice(0, 2);

    return {
      ...base,
      lead_score: score,
      lead_quality,
      confidence,
      factors,
      reason: `Rule-based score from ${met}/${factors.length} factors${topMissing.length ? `; missing: ${topMissing.join(", ")}` : ""}.`,
    };
  } catch (error) {
    // Safe fallback — never throw to the lead flow.
    return { ...base, reason: "LeadLens failed; safe fallback applied.", error: errMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// 2. TrustShield — rule-based spam / duplicate risk (never blocks)
// ---------------------------------------------------------------------------
export type RiskLevel = "low" | "medium" | "high";

export interface TrustShieldResult {
  agent: "QF-AOS-TrustShield";
  mode: AosAgentMode;
  agent_status: string;
  spam_risk: RiskLevel;
  duplicate_risk: RiskLevel;
  chargeable_lead: string;
  review_recommended: boolean;
  reason: string;
  confidence: number;
  error?: string | null;
}

export function runTrustShield(lead: CRMLead): TrustShieldResult {
  const mode = agentRuntimeMode(AOS_TRUSTSHIELD_ENABLED);
  const base: TrustShieldResult = {
    agent: "QF-AOS-TrustShield",
    mode,
    agent_status: mode === "disabled" ? "Disabled" : "Active (rule-based fallback)",
    spam_risk: "low",
    duplicate_risk: "low",
    chargeable_lead: "Unknown",
    review_recommended: false,
    reason: "",
    confidence: 0,
    error: null,
  };
  if (mode === "disabled") {
    return { ...base, reason: "TrustShield is disabled by feature flag." };
  }
  try {
    const s = lead.signals ?? emptySignals;
    const reasons: string[] = [];
    let spamScore = 0;
    if (!s.has_valid_phone) { spamScore += 2; reasons.push("invalid phone"); }
    if (s.looks_like_test_name) { spamScore += 2; reasons.push("test-like name"); }
    if (s.blank_requirement) { spamScore += 1; reasons.push("blank requirement"); }
    if (lead.priority === "spam" || lead.status === "spam_review") { spamScore += 2; reasons.push("flagged status"); }
    // Placeholder city/service mismatch heuristic.
    if (!s.has_service && !s.has_city) { spamScore += 1; reasons.push("city/service missing"); }

    const spam_risk: RiskLevel = spamScore >= 4 ? "high" : spamScore >= 2 ? "medium" : "low";
    const duplicate_risk: RiskLevel = s.duplicate_phone ? "high" : lead.status === "duplicate" ? "high" : "low";

    const review_recommended = spam_risk === "high" || duplicate_risk === "high";
    // Verdict only — never a billing action. Invalid leads are replaced, not refunded.
    const chargeable_lead = review_recommended
      ? "No — review recommended (not auto-charged)"
      : spam_risk === "medium"
        ? "Maybe — verify before charging"
        : "Yes — appears chargeable (rule-based)";

    return {
      ...base,
      spam_risk,
      duplicate_risk,
      chargeable_lead,
      review_recommended,
      confidence: clamp(60 + spamScore * 6, 50, 92),
      reason: reasons.length ? `Signals: ${reasons.join(", ")}. No lead was blocked.` : "No spam/duplicate signals detected. No lead was blocked.",
    };
  } catch (error) {
    return { ...base, reason: "TrustShield failed; safe fallback applied.", error: errMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// 3. MatchForge — rule-based vendor SUGGESTIONS (no assignment)
// ---------------------------------------------------------------------------
export interface MatchForgeVendor {
  id: string;
  business_name?: string | null;
  city?: string | null;
  areas_covered?: string[] | null;
  service_categories?: string[] | null;
  status?: string | null;
  is_active?: boolean | null;
  remaining_credits?: number | null;
  rating?: number | null;
}

export interface MatchForgeSuggestion {
  vendor_id: string;
  vendor_name: string;
  score: number;
  reason: string;
}

export interface MatchForgeResult {
  agent: "QF-AOS-MatchForge";
  mode: AosAgentMode;
  agent_status: string;
  suggested_vendors: MatchForgeSuggestion[];
  ranking_reason: string;
  assignment_ready: boolean;
  human_review_required: boolean;
  auto_assignment_enabled: boolean;
  reason: string;
  error?: string | null;
}

export function runMatchForge(lead: CRMLead, vendors: MatchForgeVendor[] = []): MatchForgeResult {
  const mode = agentRuntimeMode(AOS_MATCHFORGE_ENABLED);
  const base: MatchForgeResult = {
    agent: "QF-AOS-MatchForge",
    mode,
    agent_status: mode === "disabled" ? "Disabled" : "Active (suggestions only)",
    suggested_vendors: [],
    ranking_reason: "",
    assignment_ready: false,
    human_review_required: true,
    auto_assignment_enabled: AOS_AUTO_ASSIGNMENT_ENABLED, // false in this phase
    reason: "",
    error: null,
  };
  if (mode === "disabled") {
    return { ...base, reason: "MatchForge is disabled by feature flag." };
  }
  try {
    const leadCity = String(lead.city ?? "").trim().toLowerCase();
    const leadService = String(lead.service ?? "").trim().toLowerCase();
    const leadArea = String(lead.area ?? "").trim().toLowerCase();

    const eligible = vendors.filter((v) => {
      const disabled = v.is_active === false || ["suspended", "rejected", "disabled", "inactive"].includes(String(v.status ?? "").toLowerCase());
      if (disabled) return false; // disabled vendors never receive leads
      const cityMatch = !leadCity || String(v.city ?? "").trim().toLowerCase() === leadCity;
      const categoryMatch = !leadService || (v.service_categories ?? []).some((c) => String(c).toLowerCase().includes(leadService) || leadService.includes(String(c).toLowerCase()));
      return cityMatch && categoryMatch;
    });

    const ranked = eligible
      .map((v) => {
        let score = 50;
        const reasons: string[] = [];
        if (String(v.status ?? "").toLowerCase() === "approved") { score += 12; reasons.push("verified"); }
        const credits = Number(v.remaining_credits ?? 0);
        if (credits > 0) { score += 12; reasons.push("has credits"); }
        // Paid-priority placeholder: credits as a proxy until a paid flag exists.
        if (credits >= 10) { score += 6; reasons.push("paid priority (placeholder)"); }
        const rating = Number(v.rating ?? 0);
        if (rating > 0) { score += Math.min(12, rating * 2.4); reasons.push(`rating ${rating}`); }
        if (leadArea && (v.areas_covered ?? []).some((a) => String(a).toLowerCase().includes(leadArea))) { score += 8; reasons.push("area match"); }
        return {
          vendor_id: v.id,
          vendor_name: v.business_name || "Unnamed vendor",
          score: clamp(Math.round(score), 0, 100),
          reason: reasons.join(", ") || "city/category match",
        } satisfies MatchForgeSuggestion;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3); // one lead → max 3 vendors

    return {
      ...base,
      suggested_vendors: ranked,
      ranking_reason: "Ranked by verified status, remaining credits, paid priority (placeholder), rating, and area match. Disabled vendors excluded. Capped at 3.",
      assignment_ready: ranked.length > 0,
      human_review_required: true,
      reason: ranked.length
        ? `${ranked.length} vendor suggestion(s). Suggestions only — no lead was sent and no assignment was created (auto-assignment is OFF).`
        : "No eligible vendors matched. No assignment created.",
    };
  } catch (error) {
    return { ...base, reason: "MatchForge failed; safe fallback applied.", error: errMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// 4. LeadFlow — preparation / preview only (no side effects)
// ---------------------------------------------------------------------------
export interface LeadFlowResult {
  agent: "QF-AOS-LeadFlow";
  mode: AosAgentMode;
  agent_status: string;
  assignment_status: "preview_only" | "disabled";
  whatsapp_status: "disabled";
  credit_deduction_status: "disabled";
  audit_log_preview: string;
  reason: string;
  error?: string | null;
}

export function runLeadFlow(lead: CRMLead, match?: MatchForgeResult): LeadFlowResult {
  const mode = agentRuntimeMode(AOS_LEADFLOW_ENABLED);
  const base: LeadFlowResult = {
    agent: "QF-AOS-LeadFlow",
    mode,
    agent_status: mode === "disabled" ? "Disabled" : "Preview only (rule-based)",
    assignment_status: mode === "disabled" ? "disabled" : "preview_only",
    whatsapp_status: "disabled",
    credit_deduction_status: "disabled",
    audit_log_preview: "",
    reason: "",
    error: null,
  };
  if (mode === "disabled") {
    return { ...base, reason: "LeadFlow is disabled by feature flag." };
  }
  try {
    const suggestionCount = match?.suggested_vendors.length ?? lead.assigned_vendor_count ?? 0;
    // Hard guarantees regardless of any other state.
    const whatsappAllowed = AOS_WHATSAPP_SENDING_ENABLED; // false
    const creditAllowed = AOS_CREDIT_DEDUCTION_ENABLED; // false
    const autoAssign = AOS_AUTO_ASSIGNMENT_ENABLED; // false
    return {
      ...base,
      audit_log_preview: `Would record: lead ${lead.id} preview with ${suggestionCount} vendor suggestion(s). No assignment, no message, no charge.`,
      reason: `Preview only. WhatsApp ${whatsappAllowed ? "ON" : "disabled"}, credit deduction ${creditAllowed ? "ON" : "disabled"}, auto-assignment ${autoAssign ? "ON" : "disabled"}. Nothing was sent or charged.`,
    };
  } catch (error) {
    return { ...base, reason: "LeadFlow failed; safe fallback applied.", error: errMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// 5. OpsBrief — read-only daily report
// ---------------------------------------------------------------------------
export interface OpsBriefReport {
  agent: "QF-AOS-OpsBrief";
  mode: AosAgentMode;
  agent_status: string;
  total_leads: number;
  hot: number;
  warm: number;
  cold: number;
  weak: number;
  assigned: number;
  unassigned: number;
  nurture: number;
  follow_ups_due: number;
  top_service: string;
  top_area: string;
  agent_health: Array<{ agent: string; status: string }>;
  recommended_actions: string[];
  generated_label: string;
  error?: string | null;
}

export function runOpsBrief(leads: CRMLead[], vendorCount = 0): OpsBriefReport {
  const mode = agentRuntimeMode(AOS_OPSBRIEF_ENABLED);
  const base: OpsBriefReport = {
    agent: "QF-AOS-OpsBrief",
    mode,
    agent_status: mode === "disabled" ? "Disabled" : "Active (read-only report)",
    total_leads: 0,
    hot: 0, warm: 0, cold: 0, weak: 0,
    assigned: 0, unassigned: 0, nurture: 0, follow_ups_due: 0,
    top_service: "Not enough data",
    top_area: "Not enough data",
    agent_health: [],
    recommended_actions: [],
    generated_label: "Rule-based · read-only · not auto-sent",
    error: null,
  };
  if (mode === "disabled") {
    return { ...base, reason: "OpsBrief is disabled." } as OpsBriefReport;
  }
  try {
    const quality = { hot: 0, warm: 0, cold: 0, weak: 0 };
    let assigned = 0;
    let nurture = 0;
    let followUpsDue = 0;
    const serviceCounts = new Map<string, number>();
    const areaCounts = new Map<string, number>();
    const now = Date.now();

    leads.forEach((lead) => {
      const lens = runLeadLens(lead);
      quality[lens.lead_quality] += 1;
      if ((lead.assigned_vendor_count ?? 0) > 0 || lead.status === "assigned") assigned += 1;
      if (lead.status === "nurture_later") nurture += 1;
      if (lead.next_follow_up_date) {
        const due = new Date(lead.next_follow_up_date).getTime();
        if (!Number.isNaN(due) && due <= now) followUpsDue += 1;
      }
      const svc = String(lead.service ?? "").trim();
      if (svc && svc !== "Not set") serviceCounts.set(svc, (serviceCounts.get(svc) ?? 0) + 1);
      const area = String(lead.area ?? "").trim();
      if (area && area !== "Not set") areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
    });

    const topOf = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Not enough data";

    const agent_health = [
      { agent: "QF-AOS-LeadLens", status: agentRuntimeMode(AOS_LEADLENS_ENABLED) },
      { agent: "QF-AOS-TrustShield", status: agentRuntimeMode(AOS_TRUSTSHIELD_ENABLED) },
      { agent: "QF-AOS-MatchForge", status: agentRuntimeMode(AOS_MATCHFORGE_ENABLED) },
      { agent: "QF-AOS-LeadFlow", status: AOS_LEADFLOW_ENABLED ? "preview" : "disabled" },
      { agent: "QF-AOS-OpsBrief", status: agentRuntimeMode(AOS_OPSBRIEF_ENABLED) },
    ];

    const recommended_actions: string[] = [];
    if (quality.hot > 0) recommended_actions.push(`Prioritize ${quality.hot} hot lead(s) for fast follow-up.`);
    if (followUpsDue > 0) recommended_actions.push(`${followUpsDue} follow-up(s) are due — review the CRM calendar.`);
    if (leads.length - assigned > 0) recommended_actions.push(`${leads.length - assigned} unassigned lead(s) await manual vendor review (no auto-assignment).`);
    if (!recommended_actions.length) recommended_actions.push("No urgent actions detected from rule-based review.");

    return {
      ...base,
      total_leads: leads.length,
      hot: quality.hot, warm: quality.warm, cold: quality.cold, weak: quality.weak,
      assigned, unassigned: leads.length - assigned, nurture, follow_ups_due: followUpsDue,
      top_service: topOf(serviceCounts),
      top_area: topOf(areaCounts),
      agent_health: agent_health.map((a) => ({ agent: a.agent, status: String(a.status) })),
      recommended_actions,
    };
  } catch (error) {
    return { ...base, error: errMessage(error) };
  }
}

function errMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
