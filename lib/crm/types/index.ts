// ============================================================================
// QuickFurno CRM foundation types (Phase 3)
// Safe, mock-friendly types for the superadmin CRM module.
// No live AI, WhatsApp, lead distribution, or credit deduction is implied here.
// TODO(crm): map these to real Supabase crm_* tables once migration is applied.
// ============================================================================

export type CRMLeadStatus =
  | "new"
  | "qualified"
  | "spam_review"
  | "vendor_matching"
  | "assigned"
  | "vendor_contact_pending"
  | "client_contacted"
  | "site_visit_scheduled"
  | "quotation_sent"
  | "won"
  | "lost"
  | "nurture_later"
  | "invalid"
  | "duplicate";

export type CRMLeadPriority = "hot" | "warm" | "cold" | "weak" | "spam";

export type CRMNurtureStage =
  | "nurture_3_days"
  | "nurture_7_days"
  | "nurture_15_days"
  | "nurture_30_days"
  | "nurture_60_days"
  | "nurture_90_days"
  | "nurture_6_months"
  | "nurture_1_year"
  | "custom_nurture_date"
  | "future_project"
  | "not_ready_now"
  | "reopen_later";

export type CRMNurtureReason =
  | "possession_later"
  | "budget_later"
  | "comparing_vendors"
  | "call_after_few_months"
  | "renovation_later"
  | "not_ready_now"
  | "future_project"
  | "other";

// Lead source / marketing attribution fields prepared for future capture.
export interface LeadAttribution {
  source?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  landing_page?: string | null;
  referrer?: string | null;
  device_type?: string | null;
}

// Privacy-preserving scoring signals derived from the raw lead by the adapter.
// These are booleans/coarse flags only — NO raw phone, email, or message text —
// so AOS agents can score leads without the PII reaching the client bundle.
export interface LeadScoringSignals {
  has_valid_phone: boolean;
  has_service: boolean;
  has_city: boolean;
  has_area: boolean;
  has_budget: boolean;
  has_urgency: boolean;
  has_requirement_detail: boolean;
  high_project_value: boolean;
  looks_like_test_name: boolean;
  blank_requirement: boolean;
  duplicate_phone: boolean;
}

export interface CRMLead {
  id: string;
  lead_id?: string | null;
  client_name: string;
  // Masked phone only. Never store/show the full client phone in list/table views.
  phone_masked: string;
  email_masked?: string | null;
  service?: string | null;
  subcategory?: string | null;
  city?: string | null;
  area?: string | null;
  budget?: string | null;
  priority: CRMLeadPriority;
  status: CRMLeadStatus;
  source?: string | null;
  assigned_vendor_count?: number | null;
  assigned_to?: string | null;
  owner?: string | null;
  created_at?: string | null;
  next_follow_up_date?: string | null;

  // Nurture scheduling. Custom dates may be scheduled beyond 2 months.
  nurture_stage?: CRMNurtureStage | null;
  nurture_reason?: CRMNurtureReason | null;
  nurture_follow_up_date?: string | null;
  nurture_custom_date_enabled?: boolean | null;
  last_activity_at?: string | null;

  attribution?: LeadAttribution;
  // Derived rule-based scoring signals (populated by the lead adapter).
  signals?: LeadScoringSignals;
  metadata?: Record<string, unknown>;
}

export type CRMActivityType =
  | "lead_created"
  | "status_change"
  | "note_added"
  | "task_created"
  | "call_logged"
  | "whatsapp_logged"
  | "vendor_assigned"
  | "nurture_scheduled"
  | "follow_up_scheduled";

export interface CRMActivity {
  id: string;
  lead_id: string;
  activity_type: CRMActivityType;
  summary: string;
  actor?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown>;
}

export type CRMTaskStatus = "open" | "due_today" | "overdue" | "completed" | "snoozed";

export interface CRMTask {
  id: string;
  lead_id: string;
  title: string;
  task_type?: string | null;
  due_date?: string | null;
  owner?: string | null;
  status: CRMTaskStatus;
  created_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CRMNote {
  id: string;
  lead_id: string;
  note: string;
  author?: string | null;
  is_internal?: boolean;
  created_at?: string | null;
}

export interface CRMSource {
  id: string;
  source: string;
  channel?: string | null;
  leads: number;
  hot_leads?: number;
  assigned_leads?: number;
  won_leads?: number;
  created_at?: string | null;
}

export type CRMCalendarEventType =
  | "client_call"
  | "vendor_call"
  | "site_visit"
  | "quotation_followup"
  | "nurture_followup"
  | "complaint_followup"
  | "renewal_followup";

export type CRMCalendarEventStatus = "scheduled" | "due" | "overdue" | "done" | "cancelled";

export interface CRMCalendarEvent {
  id: string;
  lead_id?: string | null;
  title: string;
  event_type: CRMCalendarEventType;
  scheduled_at: string;
  owner?: string | null;
  status: CRMCalendarEventStatus;
  notes?: string | null;
  // TODO(google-calendar): map to Google Calendar event id once integrated.
  google_calendar_event_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CRMFollowUpSchedule {
  id: string;
  lead_id: string;
  follow_up_type: "follow_up" | "nurture";
  scheduled_date: string;
  preset?: string | null;
  custom_date_enabled?: boolean;
  reason?: CRMNurtureReason | null;
  owner?: string | null;
  status: "scheduled" | "due" | "overdue" | "done";
  created_at?: string | null;
}

// Nurture preset buttons shown in the CRM nurture queue UI.
export interface NurturePreset {
  key: string;
  label: string;
  days: number | null; // null = custom date picker
}

export const nurturePresets: NurturePreset[] = [
  { key: "nurture_3_days", label: "3 days", days: 3 },
  { key: "nurture_7_days", label: "7 days", days: 7 },
  { key: "nurture_15_days", label: "15 days", days: 15 },
  { key: "nurture_30_days", label: "30 days", days: 30 },
  { key: "nurture_60_days", label: "60 days", days: 60 },
  { key: "nurture_90_days", label: "90 days", days: 90 },
  { key: "nurture_6_months", label: "6 months", days: 182 },
  { key: "nurture_1_year", label: "1 year", days: 365 },
  { key: "custom_nurture_date", label: "Custom date", days: null },
];

export const crmNurtureReasons: CRMNurtureReason[] = [
  "possession_later",
  "budget_later",
  "comparing_vendors",
  "call_after_few_months",
  "renovation_later",
  "not_ready_now",
  "future_project",
  "other",
];

// Lightweight client-side validation for nurture scheduling.
// Returns null when valid, otherwise a human-readable error string.
export function validateNurtureSchedule(input: {
  nurture_follow_up_date?: string | null;
  nurture_custom_date_enabled?: boolean | null;
  nurture_reason?: CRMNurtureReason | null;
}): string | null {
  if (!input.nurture_follow_up_date) {
    return "A nurture follow-up date is required.";
  }
  const target = new Date(input.nurture_follow_up_date);
  if (Number.isNaN(target.getTime())) {
    return "Nurture follow-up date is invalid.";
  }
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (target.getTime() < startOfToday.getTime()) {
    return "Nurture follow-up date must be a future date.";
  }
  if (input.nurture_custom_date_enabled && !input.nurture_reason) {
    return "A nurture reason is required when a custom date is selected.";
  }
  return null;
}

// Overdue when a follow-up/nurture date is before today.
export function isFollowUpOverdue(date?: string | null): boolean {
  if (!date) return false;
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return target.getTime() < startOfToday.getTime();
}
