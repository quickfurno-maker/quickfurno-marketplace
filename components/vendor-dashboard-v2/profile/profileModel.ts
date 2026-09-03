// ============================================================================
// QuickFurno — Vendor Profile view model (QF-UI-V2-03)
//
// PURE presentation logic over data the profile page ALREADY loads
// (getMyVendor + getVendorApprovedProfileSummary + listVendorProfileChangeRequests).
// No I/O, no DB access, no writes, no new service, no new query.
//
// AUTHORITY NOTE. Public profile changes are approval-only: a vendor creates a
// request, an admin approves it, and ONLY then does
// vendorProfileChangeService.mapApprovedChangesToVendorUpdate() touch the live
// vendors row. Nothing in this module or the components that use it writes a
// public field, and none of the limits below are enforcement — the server
// sanitizer in vendorProfileChangeService.ts remains the only authority. These
// constants exist so the UI can warn BEFORE a value is silently truncated.
// ============================================================================
import type { VendorApprovedProfileSummary, VendorProfileChangeRequest } from "@/services/vendorProfileChangeService";
import type { VendorProfileSummary } from "@/lib/types";

/**
 * Mirrors ALLOWED_CATEGORIES in vendorProfileChangeService.ts exactly. A value
 * outside this set is dropped server-side, so the UI must not offer one.
 */
export const ALLOWED_PROFILE_CATEGORIES: readonly string[] = [
  "Interior Designers",
  "Carpenters",
  "Modular Factory",
  "Premium Interiors",
  "Sofa",
  "Painter",
  "Civil Work",
];

/** Mirrors the server sanitizer's slice() lengths. Advisory in the UI only. */
export const PROFILE_LIMITS = {
  businessName: 100,
  description: 700,
  startingPrice: 80,
  businessHours: 140,
  serviceAreaSummary: 220,
  serviceLength: 80,
  maxServices: 12,
  maxPortfolio: 12,
  urlLength: 500,
} as const;

/**
 * Mirrors setSafeUrl()/setUrlArray(): a relative path or an http(s) URL, and
 * nothing else. Used to decide whether a value may be placed in an <img src>,
 * so a `javascript:` or `data:` value can never be previewed.
 */
export function isSafeMediaUrl(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return trimmed.startsWith("/") || /^https?:\/\//i.test(trimmed);
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const has = (value: unknown): boolean => text(value).length > 0;

// ---------------------------------------------------------------------------
// Current APPROVED public profile — what clients see right now.
// ---------------------------------------------------------------------------
export interface VendorPublicProfileValues {
  businessName: string;
  description: string;
  category: string;
  services: string[];
  startingPrice: string;
  businessHours: string;
  serviceAreaSummary: string;
  profileImageUrl: string;
  coverImageUrl: string;
  portfolioImageUrls: string[];
}

/**
 * The live approved values, with the same fallbacks the pre-V2 page used
 * (vendor row fills in where the public summary is empty).
 */
export function readApprovedProfile(
  summary: VendorApprovedProfileSummary | null,
  vendor: VendorProfileSummary,
): VendorPublicProfileValues {
  const services = (summary?.service_categories ?? vendor.service_categories ?? []).filter(has).map(text);
  return {
    businessName: text(summary?.business_name) || text(vendor.business_name),
    description: text(summary?.public_description),
    category:
      text(summary?.selected_category) || text(vendor.selected_category) || services[0] || "",
    services,
    startingPrice: text(summary?.starting_price),
    businessHours: text(summary?.public_business_hours),
    serviceAreaSummary:
      text(summary?.public_service_area_summary) ||
      (vendor.areas_covered ?? []).filter(has).map(text).join(", "),
    profileImageUrl: text(summary?.profile_image_url),
    coverImageUrl: text(summary?.cover_image_url),
    portfolioImageUrls: (summary?.portfolio_urls ?? []).filter(isSafeMediaUrl).map(text),
  };
}

// ---------------------------------------------------------------------------
// Public profile completion — UI ONLY, ten equal checks, never persisted.
// This is NOT verification status and NOT package eligibility.
// ---------------------------------------------------------------------------
export interface ProfileCompletionItem {
  key: string;
  label: string;
  done: boolean;
}

export interface ProfileCompletion {
  items: ProfileCompletionItem[];
  present: number;
  total: number;
  percent: number;
  complete: boolean;
  missing: ProfileCompletionItem[];
}

export function evaluatePublicProfileCompletion(values: VendorPublicProfileValues): ProfileCompletion {
  const items: ProfileCompletionItem[] = [
    { key: "name", label: "Business name", done: has(values.businessName) },
    { key: "description", label: "Description", done: has(values.description) },
    { key: "category", label: "Category", done: has(values.category) },
    { key: "services", label: "At least one service", done: values.services.length > 0 },
    { key: "price", label: "Starting price", done: has(values.startingPrice) },
    { key: "hours", label: "Business hours", done: has(values.businessHours) },
    { key: "area", label: "Service area summary", done: has(values.serviceAreaSummary) },
    { key: "photo", label: "Profile photo", done: has(values.profileImageUrl) },
    { key: "cover", label: "Cover photo", done: has(values.coverImageUrl) },
    { key: "portfolio", label: "At least one portfolio photo", done: values.portfolioImageUrls.length > 0 },
  ];
  const present = items.filter((item) => item.done).length;
  const total = items.length;
  return {
    items,
    present,
    total,
    percent: Math.round((present / total) * 100),
    complete: present === total,
    missing: items.filter((item) => !item.done),
  };
}

// ---------------------------------------------------------------------------
// Approval state.
//
// This describes the REQUEST, never the vendor's verification status — the two
// are separate and are never merged here.
//
// No "only one pending request" rule is asserted: the backend does not enforce
// one, so the UI must not invent that authority. Multiple pending requests are
// reported honestly instead of being blocked.
// ---------------------------------------------------------------------------
export type ProfileApprovalTone = "live" | "pending" | "rejected";

export interface ProfileApprovalState {
  tone: ProfileApprovalTone;
  title: string;
  detail: string;
  /** Most recent pending request, when there is one. */
  pending: VendorProfileChangeRequest | null;
  pendingCount: number;
  /** Most recent request overall, when it was rejected. */
  rejected: VendorProfileChangeRequest | null;
}

export function deriveApprovalState(requests: VendorProfileChangeRequest[]): ProfileApprovalState {
  const pendingRequests = requests.filter((request) => request.status === "pending");
  const latest = requests[0] ?? null;

  if (pendingRequests.length > 0) {
    const pending = pendingRequests[0];
    return {
      tone: "pending",
      title: pendingRequests.length > 1 ? "Changes under review" : "Changes under review",
      detail: `Submitted ${formatRequestDate(pending.created_at)}. Your current public profile stays live until QuickFurno approves these changes.`,
      pending,
      pendingCount: pendingRequests.length,
      rejected: null,
    };
  }

  if (latest && latest.status === "rejected") {
    return {
      tone: "rejected",
      title: "Changes need attention",
      detail:
        text(latest.rejection_reason) ||
        "Your last request was not approved. No reason was recorded — contact support if you need details.",
      pending: null,
      pendingCount: 0,
      rejected: latest,
    };
  }

  return {
    tone: "live",
    title: "Your public profile is live",
    detail: "Everything QuickFurno has approved is visible to clients right now.",
    pending: null,
    pendingCount: 0,
    rejected: null,
  };
}

/**
 * Human labels for the whitelisted proposed_changes keys. `proposed_changes` is
 * written by the server's sanitizeProfileInput(), so it can only ever hold
 * these ten keys — there is no admin-only field to accidentally expose.
 */
const PROPOSED_FIELD_LABELS: Record<string, string> = {
  public_business_name: "Business name",
  public_description: "Description",
  public_category: "Category",
  services_offered: "Services",
  starting_price: "Starting price",
  business_hours: "Business hours",
  service_area_summary: "Service area",
  profile_image_url: "Profile photo",
  cover_image_url: "Cover photo",
  portfolio_image_urls: "Portfolio photos",
};

export interface ProposedChangeSummary {
  label: string;
  value: string;
}

/** Compact, text-only summary of what a pending request proposes. */
export function summarizeProposedChanges(
  proposed: Record<string, unknown> | null | undefined,
): ProposedChangeSummary[] {
  if (!proposed || typeof proposed !== "object") return [];
  const out: ProposedChangeSummary[] = [];
  for (const [key, label] of Object.entries(PROPOSED_FIELD_LABELS)) {
    if (!(key in proposed)) continue;
    const raw = (proposed as Record<string, unknown>)[key];
    let value: string;
    if (Array.isArray(raw)) {
      const items = raw.filter((item) => typeof item === "string").map((item) => (item as string).trim());
      value = key === "portfolio_image_urls" ? `${items.length} photo${items.length === 1 ? "" : "s"}` : items.join(", ");
    } else {
      value = text(raw);
    }
    if (!value) continue;
    out.push({ label, value: value.length > 120 ? `${value.slice(0, 120)}…` : value });
  }
  return out;
}

export function formatRequestDate(value?: string | null): string {
  if (!value) return "recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

// ---------------------------------------------------------------------------
// Services text <-> chips.
//
// The server splits services_offered and portfolio_image_urls on newline OR
// comma (toArray in vendorProfileChangeService.ts). So a chip containing a
// comma would silently become two services on the server. The editor therefore
// splits on entry too, and serializes with newlines — the UI can never disagree
// with what the server will store.
// ---------------------------------------------------------------------------
export function splitListInput(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function serializeList(items: string[]): string {
  return items.join("\n");
}

// ---------------------------------------------------------------------------
// Result banners for the existing ?request= contract.
// ---------------------------------------------------------------------------
export type ProfileFeedbackTone = "ok" | "error";

export interface ProfileFeedback {
  tone: ProfileFeedbackTone;
  message: string;
}

export function readProfileFeedback(param: string | undefined): ProfileFeedback | null {
  switch (param) {
    case "submitted":
      return {
        tone: "ok",
        message: "Changes submitted for review. Your current public profile stays live until QuickFurno approves them.",
      };
    case "failed":
      return {
        tone: "error",
        message: "Profile changes could not be submitted. Check the form and try again.",
      };
    case "no-vendor":
      return { tone: "error", message: "We could not find your vendor profile for that action." };
    default:
      return null;
  }
}
