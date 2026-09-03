// ============================================================================
// QuickFurno — Vendor Overview derivation model (QF-UI-V2-01)
//
// PURE presentation logic over data the Overview page ALREADY loads
// (getMyVendor + vendorDashboard + vendorLeads). No I/O, no DB access, no
// writes, no new service. Every number the Overview shows must come from here
// so it is auditable and provably derived from real loaded rows.
//
// Deliberately NOT modelled here, because no honest source exists:
//   - response rate (the removed KPI computed (total - in_progress) / total,
//     which measures CRM progress, not responsiveness)
//   - revenue / earnings / conversion rate / ranking / views / impressions
//   - an "accepting leads" self-toggle (no authorised vendor-side mutation)
// ============================================================================
import type { VendorLeadStatus, VendorProfileSummary } from "@/lib/types";

export interface VendorOverviewLead {
  id: string;
  assigned_at: string;
  assignment_type: string;
  vendor_status: VendorLeadStatus;
  is_bad_lead_reported: boolean;
  lead: {
    id: string;
    name: string;
    phone?: string | null;
    city: string;
    area: string | null;
    service_required: string;
    budget: string | null;
    property_type: string | null;
    timeline: string | null;
    message: string | null;
    created_at: string;
  } | null;
}

/**
 * Statuses that still need vendor work. "Converted" and "Lost" are terminal CRM
 * states, so they are excluded — everything else is open follow-up.
 */
export const ACTIVE_LEAD_STATUSES: readonly VendorLeadStatus[] = [
  "New",
  "Contacted",
  "Follow-up Needed",
  "Site Visit Scheduled",
  "Quotation Sent",
];

/** Lower number = surfaces higher in "Needs your attention". */
const ATTENTION_RANK: Partial<Record<VendorLeadStatus, number>> = {
  New: 0,
  "Follow-up Needed": 1,
  "Site Visit Scheduled": 2,
  "Quotation Sent": 3,
  Contacted: 4,
};

export function isActiveLeadStatus(status: VendorLeadStatus | null | undefined): boolean {
  return Boolean(status) && ACTIVE_LEAD_STATUSES.includes(status as VendorLeadStatus);
}

/** Count of loaded assignments still needing work. Derived, never fabricated. */
export function countActiveLeads(leads: VendorOverviewLead[]): number {
  return leads.filter((assignment) => isActiveLeadStatus(assignment.vendor_status)).length;
}

/** Count of loaded assignments in one specific CRM state. */
export function countByStatus(leads: VendorOverviewLead[], status: VendorLeadStatus): number {
  return leads.filter((assignment) => assignment.vendor_status === status).length;
}

/**
 * The handful of assignments worth acting on right now: open statuses only,
 * ordered by urgency then most recently assigned. This is a SHORTLIST of the
 * Leads page, never a replacement for it.
 */
export function selectAttentionLeads(leads: VendorOverviewLead[], limit = 4): VendorOverviewLead[] {
  return leads
    .filter((assignment) => assignment.lead && isActiveLeadStatus(assignment.vendor_status))
    .slice()
    .sort((a, b) => {
      const rankA = ATTENTION_RANK[a.vendor_status] ?? 9;
      const rankB = ATTENTION_RANK[b.vendor_status] ?? 9;
      if (rankA !== rankB) return rankA - rankB;
      return timestamp(b.assigned_at) - timestamp(a.assigned_at);
    })
    .slice(0, limit);
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Coarse "assigned N ago" label. Deliberately hour/day granularity only — the
 * assignment timestamp is real, but minute-level precision would imply a live
 * feed this page does not have. Rendered server-side, so no hydration drift.
 */
export function formatAssignedAgo(value: string | null | undefined, now: number = Date.now()): string | null {
  const then = timestamp(value);
  if (!then) return null;
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 0) return null;
  if (minutes < 60) return "assigned less than an hour ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `assigned ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `assigned ${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `assigned ${months} month${months === 1 ? "" : "s"} ago`;
}

// ---------------------------------------------------------------------------
// Profile completion — DETERMINISTIC presentation logic only.
//
// Exactly these fields, each worth exactly one point, no weighting. The result
// is rendered and never written back to the database. 100% is reachable only
// when every listed field is present.
// ---------------------------------------------------------------------------
export interface VendorProfileField {
  key: string;
  label: string;
  present: (vendor: VendorProfileSummary) => boolean;
}

const hasText = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

export const VENDOR_PROFILE_FIELDS: readonly VendorProfileField[] = [
  { key: "business_name", label: "Business name", present: (v) => hasText(v.business_name) },
  { key: "owner_name", label: "Owner name", present: (v) => hasText(v.owner_name) },
  {
    key: "contact_number",
    label: "Phone / WhatsApp number",
    present: (v) => hasText(v.whatsapp_number) || hasText(v.phone),
  },
  { key: "email", label: "Email address", present: (v) => hasText(v.email) },
  { key: "city", label: "City", present: (v) => hasText(v.city) },
  {
    key: "areas_covered",
    label: "Areas covered",
    present: (v) => Array.isArray(v.areas_covered) && v.areas_covered.some(hasText),
  },
  {
    key: "category",
    label: "Service category",
    present: (v) =>
      hasText(v.selected_category) ||
      (Array.isArray(v.service_categories) && v.service_categories.some(hasText)),
  },
  { key: "business_type", label: "Business type", present: (v) => hasText(v.business_type) },
  { key: "office_address", label: "Business address", present: (v) => hasText(v.office_address_line1) },
];

export interface VendorProfileCompletion {
  present: number;
  total: number;
  /** Whole percent of present/total. Reaches 100 only when nothing is missing. */
  percent: number;
  missing: VendorProfileField[];
  complete: boolean;
}

export function evaluateProfileCompletion(vendor: VendorProfileSummary): VendorProfileCompletion {
  const missing = VENDOR_PROFILE_FIELDS.filter((field) => !field.present(vendor));
  const total = VENDOR_PROFILE_FIELDS.length;
  const present = total - missing.length;
  return {
    present,
    total,
    percent: total === 0 ? 0 : Math.round((present / total) * 100),
    missing: missing.slice(),
    complete: missing.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Lead-access state — one honest read of the vendor row + credit balance.
//
// This REPLACES the old repeating status tiles and the separate "Lead access"
// card. It reports state; it never changes it. Vendors have no authorised
// self-service toggle for any of these fields.
// ---------------------------------------------------------------------------
export type VendorAccessTone = "ok" | "pending" | "warn" | "blocked";

export interface VendorAccessAction {
  label: string;
  href: string;
}

export interface VendorAccessState {
  tone: VendorAccessTone;
  headline: string;
  detail: string;
  actions: VendorAccessAction[];
}

/** Threshold at which remaining credits are surfaced as "running low". */
export const LOW_CREDIT_THRESHOLD = 3;

const PROFILE_HREF = "/vendor/dashboard/profile";
const PACKAGE_HREF = "/vendor/dashboard/package";
const SUPPORT_HREF = "/vendor/dashboard/support";
const LEADS_HREF = "/vendor/dashboard/leads";

export function isVendorVerified(vendor: VendorProfileSummary): boolean {
  return vendor.verification_status === "Verified" || vendor.status === "Approved";
}

export function isVendorPaid(vendor: VendorProfileSummary): boolean {
  return (vendor.paid_status ?? "Unpaid") === "Paid";
}

/**
 * Contact-visibility rule for the Overview.
 *
 * UNCHANGED from the pre-V2 Overview on purpose: approved + not explicitly
 * inactive + paid. The redesign must not widen who can see a client's number,
 * so this predicate is carried over verbatim rather than re-derived.
 */
export function canViewClientContact(vendor: VendorProfileSummary): boolean {
  return vendor.status === "Approved" && vendor.is_active !== false && isVendorPaid(vendor);
}

export function deriveAccessState(
  vendor: VendorProfileSummary,
  remainingCredits: number,
): VendorAccessState {
  if (!isVendorVerified(vendor)) {
    return {
      tone: "pending",
      headline: "Profile under review",
      detail:
        "Our team is verifying your business details. Lead access switches on once your profile is approved.",
      actions: [
        { label: "Review my profile", href: PROFILE_HREF },
        { label: "Contact support", href: SUPPORT_HREF },
      ],
    };
  }

  if (vendor.is_active === false) {
    return {
      tone: "blocked",
      headline: "Account is inactive",
      detail: "Your account is currently inactive, so new enquiries are not being matched to you.",
      actions: [{ label: "Contact support", href: SUPPORT_HREF }],
    };
  }

  if (!isVendorPaid(vendor)) {
    return {
      tone: "warn",
      headline: "Approved — package not active yet",
      detail:
        "Your profile is approved. Activate a package to start receiving matched enquiries and to see client contact details.",
      actions: [
        { label: "View packages", href: PACKAGE_HREF },
        { label: "Contact support", href: SUPPORT_HREF },
      ],
    };
  }

  if (remainingCredits <= 0) {
    return {
      tone: "warn",
      headline: "No lead credits left",
      detail: "New enquiries cannot be assigned to you until you recharge your lead credits.",
      actions: [{ label: "Recharge credits", href: PACKAGE_HREF }],
    };
  }

  if (remainingCredits <= LOW_CREDIT_THRESHOLD) {
    return {
      tone: "warn",
      headline: "Lead credits running low",
      detail: `Only ${remainingCredits} lead credit${remainingCredits === 1 ? "" : "s"} left. Recharge to keep receiving matched enquiries without a gap.`,
      actions: [{ label: "Recharge credits", href: PACKAGE_HREF }],
    };
  }

  return {
    tone: "ok",
    headline: "Active and receiving leads",
    detail:
      "Your profile is approved and your package is active. Matched enquiries are being assigned to you.",
    actions: [{ label: "View all leads", href: LEADS_HREF }],
  };
}

/** The status rows shown inside the access panel. Every value is a real field. */
export interface VendorAccessFact {
  label: string;
  value: string;
  tone: VendorAccessTone;
}

export function deriveAccessFacts(
  vendor: VendorProfileSummary,
  remainingCredits: number,
): VendorAccessFact[] {
  const verified = isVendorVerified(vendor);
  const paid = isVendorPaid(vendor);
  const active = vendor.is_active !== false;
  return [
    {
      label: "Verification",
      value: verified ? "Verified" : vendor.verification_status || vendor.status || "Under review",
      tone: verified ? "ok" : "pending",
    },
    { label: "Package", value: vendor.paid_status || "Unpaid", tone: paid ? "ok" : "warn" },
    { label: "Account", value: active ? "Active" : "Inactive", tone: active ? "ok" : "blocked" },
    {
      label: "Public profile",
      value: vendor.public_visibility ? "Visible to clients" : "Hidden from clients",
      tone: vendor.public_visibility ? "ok" : "pending",
    },
    {
      label: "Lead credits",
      value: String(remainingCredits),
      tone: remainingCredits <= LOW_CREDIT_THRESHOLD ? "warn" : "ok",
    },
  ];
}

/** Comma-joined non-empty text, or an em dash. Used for areas / categories. */
export function joinOrDash(values: (string | null | undefined)[] | null | undefined): string {
  if (!Array.isArray(values)) return "—";
  const cleaned = values.filter(hasText).map((value) => (value as string).trim());
  return cleaned.length > 0 ? cleaned.join(", ") : "—";
}

export function textOrDash(value: string | null | undefined): string {
  return hasText(value) ? (value as string).trim() : "—";
}
