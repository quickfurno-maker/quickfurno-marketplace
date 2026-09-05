// ============================================================================
// QuickFurno — Vendor Leads view model (QF-UI-V2-02)
//
// PURE presentation logic over rows the Leads page ALREADY loads via
// vendorLeads(). No I/O, no DB access, no writes, no new service, no new query.
//
// THE SECURITY-RELEVANT PART OF THIS FILE IS buildVendorLeadViews().
// The Leads board filters and expands rows in the browser, so every row it
// renders crosses the server/client boundary and lands in the RSC payload.
// The raw assignment row carries the client's phone and email; a spread of it
// would ship those to every vendor whose contact access is blocked, even with
// the markup hidden. So the raw row is NEVER spread: each field is copied
// explicitly, and `phone` is populated only for a row the SERVICE already
// marked entitled. Email is never copied at all — the pre-V2 page never
// displayed it, and this redesign does not widen what is shown.
//
// QF-MVP-80.15C — the gate is PER ROW, not per vendor. Contact entitlement is
// decided per assignment by evaluateAssignedLeadContactAccess() in
// services/vendorService.ts, which already stripped `phone` from every
// unentitled row before this model ever sees it. `row.contact_allowed` is that
// verdict travelling with its own row; this file re-enforces the consequence so
// a future caller cannot reintroduce the leak by handing over an unsanitized
// row. A mixed list is normal: one lead's contact may be visible while the next
// one's is not.
// ============================================================================
import type { VendorLeadStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

/**
 * The statuses a vendor may SET. Exactly the pre-V2 list — no Accepted /
 * Rejected / Declined / Cancelled, because no such assignment semantics exist:
 * a vendor cannot accept, reject or decline an already assigned lead.
 *
 * "Won" is deliberately absent. It is a legacy value that still exists in
 * VendorLeadStatus and in stored data (services/vendorService.ts counts it), so
 * it is DISPLAYED wherever it occurs and counted with Converted, but it is not
 * offered as a new choice.
 */
export const SETTABLE_LEAD_STATUSES: readonly VendorLeadStatus[] = [
  "New",
  "Contacted",
  "Follow-up Needed",
  "Site Visit Scheduled",
  "Quotation Sent",
  "Converted",
  "Lost",
];

/** Open statuses — still needing vendor work. */
export const ACTIVE_LEAD_STATUSES: readonly VendorLeadStatus[] = [
  "New",
  "Contacted",
  "Follow-up Needed",
  "Site Visit Scheduled",
  "Quotation Sent",
];

/** Converted and its legacy synonym, which real rows still carry. */
export const CONVERTED_LEAD_STATUSES: readonly VendorLeadStatus[] = ["Converted", "Won"];

export type VendorLeadStatusGroup = "active" | "converted" | "lost";

export function statusGroup(status: VendorLeadStatus): VendorLeadStatusGroup {
  if (CONVERTED_LEAD_STATUSES.includes(status)) return "converted";
  if (status === "Lost") return "lost";
  return "active";
}

// ---------------------------------------------------------------------------
// Assignment source
// ---------------------------------------------------------------------------
export type VendorLeadSourceTone = "client" | "auto" | "recovery" | "admin";

export interface VendorLeadSource {
  label: string;
  tone: VendorLeadSourceTone;
}

/**
 * How this lead reached the vendor. Meanings are carried over verbatim from the
 * pre-V2 page (Phase 26A-2D): prefer assignment_source, fall back to the legacy
 * assignment_type.
 */
export function assignmentSourceBadge(
  source: string | null | undefined,
  type: string | null | undefined,
): VendorLeadSource | null {
  const s = (source ?? "").toLowerCase();
  if (s === "client_selected_vendor") return { label: "Client selected your profile", tone: "client" };
  if (s === "auto_fill" || s === "auto_assigned") return { label: "QuickFurno matched this lead", tone: "auto" };
  if (s.includes("recovery")) return { label: "Recovery assignment", tone: "recovery" };
  if (s.startsWith("manual") || s === "admin_assigned") return { label: "Admin assigned", tone: "admin" };

  const t = (type ?? "").toLowerCase();
  if (t === "client_selected") return { label: "Client selected your profile", tone: "client" };
  if (t === "auto_assigned") return { label: "QuickFurno matched this lead", tone: "auto" };
  if (t === "admin_assigned") return { label: "Admin assigned", tone: "admin" };
  return null;
}

// ---------------------------------------------------------------------------
// Rows in / views out
// ---------------------------------------------------------------------------

/** The shape vendorLeads() returns. Read only — never forwarded as-is. */
export interface VendorLeadRawRow {
  id: string;
  assigned_at: string | null;
  assignment_type: string | null;
  assignment_source: string | null;
  vendor_status: VendorLeadStatus;
  is_bad_lead_reported: boolean | null;
  /**
   * Per-assignment contact entitlement, decided server-side. Anything other than
   * a literal `true` is treated as "not entitled" — this fails closed.
   */
  contact_allowed?: boolean | null;
  lead: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    city: string;
    area: string | null;
    service_required: string;
    budget: string | null;
    property_type: string | null;
    timeline: string | null;
    message: string | null;
    created_at: string | null;
  } | null;
}

/**
 * What the client board is allowed to see. Note what is NOT here: no email
 * under any condition, and no phone unless contact access was proven.
 */
export interface VendorLeadView {
  id: string;
  status: VendorLeadStatus;
  group: VendorLeadStatusGroup;
  assignedAt: string | null;
  assignedAgo: string | null;
  isReported: boolean;
  source: VendorLeadSource | null;
  name: string;
  service: string;
  city: string;
  area: string | null;
  place: string;
  budget: string | null;
  propertyType: string | null;
  timeline: string | null;
  message: string | null;
  /** Null whenever contact access is not allowed for THIS assignment. */
  phone: string | null;
  /** Whether this specific assignment's client contact may be shown. */
  contactAllowed: boolean;
  /** Lowercased haystack for local search. Name / service / area / city ONLY. */
  searchText: string;
}

const text = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Build the client-safe view models.
 *
 * Entitlement is NOT decided here and deliberately cannot be: each row arrives
 * carrying the server's own per-assignment verdict in `contact_allowed`. This
 * function only enforces the consequence, and it enforces it strictly — a row
 * whose flag is missing, null or anything other than `true` loses its phone even
 * if one is somehow present on the raw row.
 */
export function buildVendorLeadViews(
  rows: VendorLeadRawRow[],
  options: { now?: number } = {},
): VendorLeadView[] {
  const now = options.now ?? Date.now();
  const views: VendorLeadView[] = [];

  for (const row of rows) {
    const lead = row.lead;
    if (!lead) continue;

    const name = text(lead.name) ?? "Client";
    const service = text(lead.service_required) ?? "Requirement";
    const city = text(lead.city) ?? "";
    const area = text(lead.area);
    const place = [area, city].filter(Boolean).join(", ");
    const status = (row.vendor_status || "New") as VendorLeadStatus;
    // Strictly `true`. Missing/null/"true"/1 are all NOT entitlement.
    const contactAllowed = row.contact_allowed === true;

    views.push({
      id: row.id,
      status,
      group: statusGroup(status),
      assignedAt: row.assigned_at,
      assignedAgo: formatRelativeTime(row.assigned_at, now),
      isReported: row.is_bad_lead_reported === true,
      source: assignmentSourceBadge(row.assignment_source, row.assignment_type),
      name,
      service,
      city,
      area,
      place: place || city || "Not set",
      budget: text(lead.budget),
      propertyType: text(lead.property_type),
      timeline: text(lead.timeline),
      message: text(lead.message),
      // The single gate, per row. `lead.phone` is read here and nowhere else.
      phone: contactAllowed ? text(lead.phone) : null,
      contactAllowed,
      searchText: [name, service, area, city].filter(Boolean).join(" ").toLowerCase(),
    });
  }

  return views;
}

/** Compact "3h ago" / "5d ago" label. Coarse on purpose — this is not a feed. */
export function formatRelativeTime(value: string | null | undefined, now: number = Date.now()): string | null {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return null;
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 0) return null;
  if (minutes < 60) return "Just now";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ---------------------------------------------------------------------------
// Summary + filters — presentation only, over already-loaded rows.
// No count here is invented: each is a length of a filtered array.
// ---------------------------------------------------------------------------
export interface VendorLeadSummary {
  total: number;
  fresh: number;
  followUp: number;
  converted: number;
}

export function summarizeLeads(views: VendorLeadView[]): VendorLeadSummary {
  return {
    total: views.length,
    fresh: views.filter((v) => v.status === "New").length,
    followUp: views.filter((v) => v.status === "Follow-up Needed").length,
    // Converted counts its legacy synonym too, so the number matches the list.
    converted: views.filter((v) => v.group === "converted").length,
  };
}

export type VendorLeadFilterKey =
  | "all"
  | "active"
  | "New"
  | "Contacted"
  | "Follow-up Needed"
  | "Site Visit Scheduled"
  | "Quotation Sent"
  | "converted"
  | "Lost";

export interface VendorLeadFilterOption {
  key: VendorLeadFilterKey;
  label: string;
  count: number;
}

function matchesFilter(view: VendorLeadView, key: VendorLeadFilterKey): boolean {
  if (key === "all") return true;
  if (key === "active") return view.group === "active";
  if (key === "converted") return view.group === "converted";
  return view.status === key;
}

const FILTER_LABELS: { key: VendorLeadFilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "New", label: "New" },
  { key: "Contacted", label: "Contacted" },
  { key: "Follow-up Needed", label: "Follow-up" },
  { key: "Site Visit Scheduled", label: "Site visit" },
  { key: "Quotation Sent", label: "Quotation" },
  { key: "converted", label: "Converted" },
  { key: "Lost", label: "Lost" },
];

/**
 * "All" and "Active" always show; a status chip appears only when at least one
 * loaded lead has it. Filtering to a bucket that cannot contain anything is
 * noise, and on a phone the chip row has to stay short.
 */
export function buildFilterOptions(views: VendorLeadView[]): VendorLeadFilterOption[] {
  return FILTER_LABELS.map((entry) => ({
    ...entry,
    count: views.filter((view) => matchesFilter(view, entry.key)).length,
  })).filter((entry) => entry.key === "all" || entry.key === "active" || entry.count > 0);
}

/** Local, in-memory filtering. No query, no request, no new index. */
export function applyLeadFilter(
  views: VendorLeadView[],
  key: VendorLeadFilterKey,
  query: string,
): VendorLeadView[] {
  const needle = query.trim().toLowerCase();
  return views.filter(
    (view) => matchesFilter(view, key) && (needle.length === 0 || view.searchText.includes(needle)),
  );
}

// ---------------------------------------------------------------------------
// Feedback banners driven by the existing ?lead= search param contract.
// ---------------------------------------------------------------------------
export type VendorLeadFeedbackTone = "ok" | "error";

export interface VendorLeadFeedback {
  tone: VendorLeadFeedbackTone;
  message: string;
}

export function readLeadFeedback(param: string | undefined): VendorLeadFeedback | null {
  switch (param) {
    case "status-updated":
      return { tone: "ok", message: "Lead status updated." };
    case "bad-lead-submitted":
      return {
        tone: "ok",
        message:
          "Report submitted for admin review. Lead credit is not refunded automatically.",
      };
    case "failed":
    case "report-failed":
      return {
        tone: "error",
        message: "That action did not go through. Please check the details and try again.",
      };
    case "no-vendor":
      return { tone: "error", message: "We could not find your vendor profile for that action." };
    default:
      return null;
  }
}
