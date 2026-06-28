// ============================================================================
// QuickFurno CRM lead adapter (Phase 5)
// Safely maps existing public.leads rows (from the admin snapshot) into the
// CRMLead view model. READ-ONLY: this adapter performs no writes, no AI, no
// WhatsApp, no distribution, and no credit deduction.
//
// Existing lead table: public.leads (see services/adminService.ts snapshot).
// This adapter is defensive — every field has a safe fallback so it never throws
// if the live schema differs or columns are missing.
//
// Phone safety: list/table/card views must use `phone_masked` only. The raw
// phone is intentionally NOT carried into the CRMLead view model, so full client
// numbers never reach the CRM client bundle from here.
//
// TODO(crm-sync): once crm_* tables are applied, merge overlay rows (notes,
//   tasks, nurture schedule, owner) on top of these adapted leads.
// TODO(lead-status): wire real status updates through a guarded server action.
// TODO(aos-leadlens): attach LeadLens score instead of the "warm" fallback.
// TODO(aos-trustshield): attach TrustShield spam risk for spam_review routing.
// TODO(aos-matchforge): attach MatchForge vendor suggestions (max 3, no disabled).
// ============================================================================

import type { Lead } from "@/components/admin/adminTypes";
import { maskEmail, maskPhone } from "@/components/admin/adminUtils";
import type { CRMLead, CRMLeadPriority, CRMLeadStatus, LeadScoringSignals } from "@/lib/crm/types";

export type CRMLeadLoadState = "live" | "empty" | "failed";

const TEST_NAME_RE = /^(test|abc|xyz|asdf|asdfgh|demo|qwerty|aaa+|na|n\/?a|sample|dummy)\b/i;

// Compute privacy-preserving scoring signals from a raw lead. Booleans only —
// raw phone / email / message text never leave this function.
export function computeLeadSignals(lead: Lead, phoneFrequency?: Map<string, number>): LeadScoringSignals {
  const digits = String(lead.phone ?? "").replace(/\D/g, "");
  const has_valid_phone = digits.length >= 10 && digits.length <= 13 && !/^(0+|1234567890)$/.test(digits);
  const name = String(lead.name ?? "").trim();
  const looks_like_test_name = !name || name.length < 2 || TEST_NAME_RE.test(name);
  const message = String(lead.message ?? "").trim();
  const blank_requirement = message.length === 0;
  const has_requirement_detail = message.length >= 15;
  const timeline = String(lead.timeline ?? "").trim();
  const urgentText = /urgent|asap|immediat|this week|today|tomorrow|next week/i.test(message);
  const has_urgency = Boolean(timeline) || urgentText;
  const budget = String(lead.budget ?? "").trim();
  const has_budget = Boolean(budget) && budget.toLowerCase() !== "not set";
  const high_project_value =
    /lakh|lac|crore|\bcr\b|[5-9]\d{4,}|\d{6,}/i.test(budget) ||
    /large|full home|full house|villa|bungalow|duplex|4bhk|5bhk/i.test(`${lead.project_size ?? ""} ${message}`);
  const has_service = isFieldSet(lead.service_required || lead.category);
  const has_city = isFieldSet(lead.city);
  const has_area = isFieldSet(lead.locality || lead.area);
  const duplicate_phone = digits.length > 0 && (phoneFrequency?.get(digits) ?? 0) > 1;

  return {
    has_valid_phone,
    has_service,
    has_city,
    has_area,
    has_budget,
    has_urgency,
    has_requirement_detail,
    high_project_value,
    looks_like_test_name,
    blank_requirement,
    duplicate_phone,
  };
}

function isFieldSet(value?: string | null) {
  const v = String(value ?? "").trim().toLowerCase();
  return Boolean(v) && v !== "not set" && v !== "unknown";
}

// Map an existing lead's free-form status into a CRM status. Falls back to "new".
export function normalizeLeadStatus(raw?: string | null): CRMLeadStatus {
  const value = String(raw ?? "").toLowerCase().trim();
  if (!value) return "new";
  if (value.includes("won") || value.includes("convert")) return "won";
  if (value.includes("lost")) return "lost";
  if (value.includes("duplicate")) return "duplicate";
  if (value.includes("spam")) return "spam_review";
  if (value.includes("invalid")) return "invalid";
  if (value.includes("quotation")) return "quotation_sent";
  if (value.includes("site")) return "site_visit_scheduled";
  if (value.includes("contact")) return "client_contacted";
  if (value.includes("assign")) return "assigned";
  if (value.includes("qualif") || value.includes("verified")) return "qualified";
  if (value.includes("nurture")) return "nurture_later";
  if (value.includes("new")) return "new";
  return "new";
}

// Map an existing lead's priority into a CRM priority. Falls back to "warm".
export function normalizeLeadPriority(raw?: string | null): CRMLeadPriority {
  const value = String(raw ?? "").toLowerCase().trim();
  if (!value) return "warm";
  if (value.includes("hot") || value.includes("high")) return "hot";
  if (value.includes("cold") || value.includes("low")) return "cold";
  if (value.includes("spam")) return "spam";
  if (value.includes("weak")) return "weak";
  if (value.includes("warm") || value.includes("medium")) return "warm";
  return "warm";
}

// Source fallback: prefer the captured source, else mark as Unknown.
export function resolveLeadSource(raw?: string | null): string {
  const value = String(raw ?? "").trim();
  return value || "Unknown";
}

// Adapt a single existing lead row into the CRMLead view model (read-only).
// Optionally pass a phone-frequency map so duplicate-phone signals are accurate.
export function crmLeadAdapter(lead: Lead, phoneFrequency?: Map<string, number>): CRMLead {
  const city = lead.city || "Not set";
  const area = lead.locality || lead.area || "Not set";
  return {
    id: lead.id,
    lead_id: lead.id,
    client_name: lead.name || "Unnamed lead",
    // Masked only — full phone is never placed in the CRM view model.
    phone_masked: maskPhone(lead.phone),
    email_masked: maskEmail(lead.email),
    service: lead.service_required || lead.category || "Not set",
    category: lead.category || lead.service_required || "Not set",
    subcategory: lead.subcategory || "Not set",
    city,
    area,
    budget: lead.budget || "Not set",
    priority: normalizeLeadPriority(lead.lead_priority),
    status: normalizeLeadStatus(lead.status),
    source: resolveLeadSource(lead.source),
    assigned_vendor_count: lead.lead_assignments?.length ?? 0,
    owner: null, // TODO(crm-sync): owner comes from crm_leads overlay once applied.
    created_at: lead.created_at ?? null,
    // Real follow-up date if present, otherwise a safe placeholder (not scheduled).
    next_follow_up_date: lead.follow_up_date ?? null,
    nurture_stage: normalizeLeadStatus(lead.status) === "nurture_later" ? "reopen_later" : null,
    nurture_reason: null,
    nurture_follow_up_date: null,
    nurture_custom_date_enabled: false,
    last_activity_at: lead.updated_at || lead.created_at || null,
    attribution: {
      source: lead.source ?? null,
      utm_source: lead.utm_source ?? null,
      utm_medium: lead.utm_medium ?? null,
      utm_campaign: lead.utm_campaign ?? null,
      landing_page: lead.page_url ?? null,
    },
    signals: computeLeadSignals(lead, phoneFrequency),
  };
}

// Adapt many leads. Defensive: skips rows without an id. Builds a phone-frequency
// map first so duplicate-phone signals are accurate across the batch.
export function adaptCrmLeads(leads: Lead[] | null | undefined): CRMLead[] {
  if (!Array.isArray(leads)) return [];
  const valid = leads.filter((lead) => lead && lead.id);
  const phoneFrequency = new Map<string, number>();
  valid.forEach((lead) => {
    const digits = String(lead.phone ?? "").replace(/\D/g, "");
    if (digits) phoneFrequency.set(digits, (phoneFrequency.get(digits) ?? 0) + 1);
  });
  return valid.map((lead) => crmLeadAdapter(lead, phoneFrequency));
}

// Decide how the CRM should present the lead source:
// - "failed": snapshot errored, or the leads query failed and returned nothing
// - "empty":  query succeeded but there are genuinely no leads
// - "live":   real leads are available
export function resolveLeadLoadState(input: {
  error?: string | null;
  warnings?: string[];
  count: number;
}): CRMLeadLoadState {
  if (input.count > 0) return "live";
  if (input.error) return "failed";
  const leadWarning = (input.warnings ?? []).some((w) => w.toLowerCase().startsWith("leads:"));
  if (leadWarning) return "failed";
  return "empty";
}

// True when the leads query degraded to fallback columns (still usable data).
export function hasLeadFallbackWarning(warnings?: string[]): boolean {
  return (warnings ?? []).some(
    (w) => w.toLowerCase().startsWith("leads:") && w.toLowerCase().includes("fallback"),
  );
}
