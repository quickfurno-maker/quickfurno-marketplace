import {
  type Lead,
  type LeadClarificationRequest,
  type Snapshot,
  type Vendor,
} from "../../adminTypes";
import {
  computeLeadSignals,
} from "@/lib/crm/adapters/leadAdapter";
import {
  type LeadScoringSignals,
} from "@/lib/crm/types";
import { type BadgeTone, type CrmPriority, type CrmStatusBucket, type PreferredBadge, type QualityBadge, type CrmRow, type QuickFilter, type Kpi, type DrawerClarificationQuestion } from "./leadCrmTypes";

export function digitsOnly(value?: string | null): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function waNumber(digits: string): string {
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

export function computePriority(lead: Lead, signals: LeadScoringSignals): CrmPriority {
  if (lead.is_duplicate) return "duplicate";
  const qualityClass = String(lead.lead_quality_class ?? "").toUpperCase();
  if (qualityClass === "A+" || qualityClass === "A") return "hot";
  if (qualityClass === "B") return "warm";
  if (qualityClass === "C") return "weak";
  if (qualityClass === "D") return "spam";
  const status = String(lead.status ?? "").toLowerCase();
  if (/spam|bad|invalid|junk/.test(status)) return "spam";
  if (signals.looks_like_test_name || (signals.blank_requirement && !signals.has_valid_phone)) return "weak";
  if (signals.has_budget && signals.has_urgency && signals.has_valid_phone) return "hot";
  if (signals.has_valid_phone && (signals.has_service || signals.has_budget || signals.has_area)) return "warm";
  return "cold";
}

export function statusBucket(lead: Lead, assignedCount: number): CrmStatusBucket {
  const s = String(lead.status ?? "").toLowerCase();
  if (lead.is_duplicate || s.includes("duplicate")) return "duplicate";
  if (/spam|bad|invalid|junk|rejected quality/.test(s) || String(lead.lead_quality_class ?? "").toUpperCase() === "D") return "spam";
  if (s.includes("won") || s.includes("convert")) return "won";
  if (s.includes("lost")) return "lost";
  if (s.includes("quotation")) return "quotation";
  if (s.includes("site")) return "site_visit";
  if (s.includes("contact")) return "contacted";
  if (s.includes("assign") || assignedCount > 0) return "assigned";
  return "new";
}

export function leadQualityBadge(lead: Lead): QualityBadge {
  if (lead.is_duplicate) return { label: "Duplicate", tone: "violet" };
  const action = String(lead.lead_quality_recommended_action ?? "").toLowerCase();
  const hardBlock = String(lead.lead_quality_hard_block_reason ?? "").toLowerCase();
  if (action.includes("consent_required") || hardBlock.includes("share_consent")) {
    return { label: "No Consent", tone: "amber" };
  }
  const qualityClass = String(lead.lead_quality_class ?? "").toUpperCase();
  if (qualityClass === "A+") return { label: "A+ Hot", tone: "rose" };
  if (qualityClass === "A") return { label: "A Verified", tone: "emerald" };
  if (qualityClass === "B") return { label: "B Clarification", tone: "amber" };
  if (qualityClass === "C") return { label: "C Weak", tone: "slate" };
  if (qualityClass === "D") return { label: "D Reject/Spam", tone: "rose" };
  return null;
}

export function preferredBadge(lead: Lead, assignedCount: number): PreferredBadge {
  if (String(lead.lead_intent ?? "").toLowerCase() !== "preferred_vendor") return null;
  const status = String(lead.preferred_vendor_status ?? "").toLowerCase();
  if (status.includes("assigned") || (status === "" && assignedCount > 0)) {
    return { label: "Preferred vendor assigned", tone: "emerald" };
  }
  if (status.includes("no_credit") || status.includes("no credit") || status.includes("fallback")) {
    return { label: "No credit / fallback needed", tone: "amber" };
  }
  if (status.includes("pending") || status.includes("not_eligible") || status.includes("not eligible") || status.includes("review")) {
    return { label: "Admin review", tone: "rose" };
  }
  return { label: "Client selected vendor", tone: "blue" };
}

export function isToday(value?: string | null): boolean {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  return d.toDateString() === new Date().toDateString();
}

export function followUpDue(value?: string | null): boolean {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getTime() <= now.getTime() || d.toDateString() === now.toDateString();
}

export function buildRows(data: Snapshot): CrmRow[] {
  const leads = data.leads ?? [];
  const clarificationByLead = latestClarificationByLead(data.leadClarificationRequests ?? []);
  const phoneFrequency = new Map<string, number>();
  leads.forEach((lead) => {
    const d = digitsOnly(lead.phone);
    if (d) phoneFrequency.set(d, (phoneFrequency.get(d) ?? 0) + 1);
  });

  return leads
    .filter((lead) => lead && lead.id)
    .map((lead) => {
      const assignments = lead.lead_assignments ?? [];
      const assignedCount = new Set(assignments.map((a) => String(a.vendor_id ?? "")).filter(Boolean)).size;
      const signals = computeLeadSignals(lead, phoneFrequency);
      const phoneDigits = digitsOnly(lead.phone);
      return {
        lead,
        id: lead.id,
        name: lead.name || "Unnamed lead",
        phone: lead.phone || "",
        phoneDigits,
        city: lead.city || "Not set",
        area: lead.locality || lead.area || "",
        service: lead.service_required || lead.category || "Not set",
        budget: lead.budget || "Not set",
        timeline: lead.timeline || "Not set",
        source: lead.source || "Unknown",
        intent: String(lead.lead_intent ?? "general_auto_match"),
        isPreferred: String(lead.lead_intent ?? "").toLowerCase() === "preferred_vendor",
        preferredBadge: preferredBadge(lead, assignedCount),
        qualityBadge: leadQualityBadge(lead),
        latestClarification: clarificationByLead.get(lead.id) ?? null,
        assignedCount,
        assignments,
        priority: computePriority(lead, signals),
        bucket: statusBucket(lead, assignedCount),
        statusLabel: lead.status || "New",
        createdAt: lead.created_at ?? null,
        followUp: lead.follow_up_date ?? null,
        signals,
      };
    });
}

export function countByField(rows: CrmRow[], pick: (row: CrmRow) => string): Array<{ label: string; value: number }> {
  const map = new Map<string, number>();
  rows.forEach((row) => {
    const key = pick(row) || "Unknown";
    map.set(key, (map.get(key) ?? 0) + 1);
  });
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

export function latestClarificationByLead(rows: LeadClarificationRequest[]): Map<string, LeadClarificationRequest> {
  const map = new Map<string, LeadClarificationRequest>();
  rows.forEach((request) => {
    const leadId = String(request.lead_id ?? "");
    if (!leadId || map.has(leadId)) return;
    map.set(leadId, request);
  });
  return map;
}

export function clarificationLabel(row: CrmRow): string {
  const status = row.latestClarification?.status ?? row.lead.clarification_status;
  const missingCount = row.lead.clarification_missing_fields?.length ?? row.latestClarification?.missing_fields?.length ?? 0;
  if (!status && !row.lead.clarification_required) return "Not prepared";
  return `${String(status ?? "required").replace(/_/g, " ")}${missingCount ? ` (${missingCount})` : ""}`;
}

// Phase 1.6 — compact status badge for the lead list/table and drawer header.
export function clarificationBadge(row: CrmRow): { label: string; tone: BadgeTone } {
  const status = String(row.latestClarification?.status ?? row.lead.clarification_status ?? "").toLowerCase();
  if (status === "completed_upgraded") return { label: "Clarified - Review", tone: "emerald" };
  if (status === "completed_still_incomplete") return { label: "Still Incomplete", tone: "rose" };
  if (status === "preview_prepared" || status === "preview_sent") return { label: "B Clarification", tone: "amber" };
  if (!status && !row.lead.clarification_required) return { label: "Not prepared", tone: "slate" };
  return { label: clarificationLabel(row), tone: row.lead.clarification_required ? "amber" : "slate" };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function buildKpis(rows: CrmRow[]): Kpi[] {
  const count = (fn: (r: CrmRow) => boolean) => rows.filter(fn).length;
  return [
    { key: "total", label: "Total leads", value: rows.length, helper: "All captured leads", tone: "indigo" },
    { key: "new_today", label: "New today", value: count((r) => isToday(r.createdAt)), helper: "Created today", tone: "emerald" },
    { key: "hot", label: "Hot leads", value: count((r) => r.priority === "hot"), helper: "Budget + urgency + valid phone", tone: "rose" },
    { key: "unassigned", label: "Unassigned", value: count((r) => r.assignedCount === 0 && !["won", "lost", "spam", "duplicate"].includes(r.bucket)), helper: "No vendor yet", tone: "amber" },
    { key: "assigned", label: "Assigned", value: count((r) => r.assignedCount > 0), helper: "At least one vendor", tone: "emerald" },
    { key: "vendor_selected", label: "Vendor-selected", value: count((r) => r.isPreferred), helper: "Client picked a vendor", tone: "indigo" },
    { key: "follow_ups", label: "Follow-ups due", value: count((r) => followUpDue(r.followUp)), helper: "Due or overdue", tone: "amber" },
    { key: "site_visit", label: "Site visits", value: count((r) => r.bucket === "site_visit"), helper: "Scheduled", tone: "indigo" },
    { key: "won", label: "Won", value: count((r) => r.bucket === "won"), helper: "Converted", tone: "emerald" },
    { key: "lost", label: "Lost", value: count((r) => r.bucket === "lost"), helper: "Closed lost", tone: "rose" },
    { key: "spam_dup", label: "Spam / duplicate", value: count((r) => r.bucket === "spam" || r.bucket === "duplicate"), helper: "Flagged low quality", tone: "slate" },
  ];
}


export function passesQuickFilter(row: CrmRow, filter: QuickFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "new_today": return isToday(row.createdAt);
    case "hot": return row.priority === "hot";
    case "unassigned": return row.assignedCount === 0 && !["won", "lost", "spam", "duplicate"].includes(row.bucket);
    case "assigned": return row.assignedCount > 0;
    case "vendor_selected": return row.isPreferred;
    case "site_visit": return row.bucket === "site_visit";
    case "won": return row.bucket === "won";
    case "lost": return row.bucket === "lost";
    case "spam_dup": return row.bucket === "spam" || row.bucket === "duplicate";
    default: return true;
  }
}


export function groupByLead<T extends { lead_id?: string | null }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  rows.forEach((row) => {
    const key = String(row.lead_id ?? "");
    if (!key) return;
    const current = map.get(key) ?? [];
    current.push(row);
    map.set(key, current);
  });
  return map;
}

export function questionOptions(question: Record<string, unknown>): string {
  const options = Array.isArray(question.options) ? question.options : [];
  const labels = options.map((option) => {
    if (typeof option === "string") return option;
    if (option && typeof option === "object" && "label" in option) return String((option as { label?: unknown }).label ?? "");
    return "";
  }).filter(Boolean);
  return labels.join(", ") || "Free text";
}

// Phase 1.6 — normalise the stored questions_json into a typed shape the drawer
// answer form can render (single_choice → <select>, free_text_later → text input).

export function normalizeClarificationQuestions(
  raw: Array<Record<string, unknown>> | null | undefined,
): DrawerClarificationQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const options = Array.isArray(record.options) ? record.options : [];
    return {
      key: String(record.key ?? `question_${index}`),
      text: String(record.text ?? "Question"),
      type: String(record.type ?? "single_choice"),
      options: options
        .map((option) => {
          if (typeof option === "string") return { value: option, label: option };
          if (option && typeof option === "object") {
            const o = option as { value?: unknown; label?: unknown };
            return { value: String(o.value ?? o.label ?? ""), label: String(o.label ?? o.value ?? "") };
          }
          return { value: "", label: "" };
        })
        .filter((option) => option.value),
    };
  });
}

export function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
