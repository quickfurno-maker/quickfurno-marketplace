// ============================================================================
// QuickFurno — Phase 13B: Shared Vendor Eligibility Helper
//
// ONE source of truth for "is this vendor eligible for a lead preview?". Used by
// the admin Vendors page (badge), the Lead Distribution eligibility checker, and
// the Phase 13 Lead Assignment Approval Preview service so they always agree.
//
// PURE + dependency-free: safe to import from BOTH client and server code. It
// performs NO database access, NO network calls, and has NO side effects.
//
// It normalizes loosely-shaped vendor rows: column names vary across the schema
// history, so we read the first available alias rather than hardcoding one.
//
// Eligibility (when ALL are true):
//   - status === 'approved'
//   - active flag is true
//   - package status is 'active' or 'trial'
//   - credits > 0
//   - (only when a lead context is given) city AND category match
// ============================================================================

export type VendorEligibilityReason =
  | "Pending approval"
  | "Rejected"
  | "Suspended"
  | "Inactive"
  | "No active package"
  | "No credits"
  | "City/category mismatch";

export interface VendorEligibilityContext {
  /** When provided, city + category match are required for eligibility. */
  leadCity?: string | null;
  leadCategory?: string | null;
}

export interface VendorEligibility {
  eligible: boolean;
  reasons: string[];
  status: string;
  isActive: boolean;
  packageStatus: string;
  credits: number;
  cityMatch: boolean;
  categoryMatch: boolean;
}

export type VendorLeadAssignmentRejectReason =
  | "free_unpaid_vendor_not_eligible_for_assignment"
  | "package_expired"
  | "no_credits"
  | "city_mismatch"
  | "category_mismatch"
  | "subcategory_mismatch"
  | "vendor_inactive"
  | "vendor_pending_approval"
  | "vendor_suspended";

export interface VendorLeadAssignmentEligibility {
  eligible: boolean;
  reasons: string[];
  packageStatus: string;
  credits: number;
  visibilityType?: string;
}

export interface VendorLeadAssignmentSettings {
  allow_trial_vendors_for_assignment?: boolean | null;
}

const ACTIVE_PACKAGE_STATUSES = new Set(["active", "trial"]);
const PAID_STATUSES = new Set(["paid", "active", "premium", "priority"]);
const TRIAL_STATUSES = new Set(["trial"]);
const FREE_OR_UNPAID_STATUSES = new Set(["", "none", "free", "unpaid", "inactive", "expired", "cancelled", "canceled"]);
const INTERIOR_SUBCATEGORIES = new Set(["interior designers", "carpenters", "modular factory", "premium interiors"]);

/**
 * Evaluate a vendor's eligibility for a lead preview. `vendor` is any record
 * shaped like a Supabase vendors row; unknown/missing fields fall back safely.
 */
export function evaluateVendorEligibility(
  vendor: Record<string, unknown> | null | undefined,
  context: VendorEligibilityContext = {},
): VendorEligibility {
  const row = isRecord(vendor) ? vendor : {};

  const status = normalizeStatus(row.status);
  const isActive = normalizeActive(row);
  const packageStatus = normalizePackageStatus(row);
  const credits = normalizeCredits(row);

  const hasLeadContext = Boolean(context.leadCity) || Boolean(context.leadCategory);
  const cityMatch = context.leadCity ? textEquals(row.city, context.leadCity) : true;
  const categoryMatch = context.leadCategory
    ? toStringArray(row.service_categories).some((category) => textEquals(category, context.leadCategory))
    : true;

  const reasons: string[] = [];
  if (status === "pending") reasons.push("Pending approval");
  else if (status === "rejected") reasons.push("Rejected");
  else if (status === "suspended") reasons.push("Suspended");
  else if (status !== "approved") reasons.push("Pending approval");

  if (!isActive) reasons.push("Inactive");
  if (!ACTIVE_PACKAGE_STATUSES.has(packageStatus)) reasons.push("No active package");
  if (credits <= 0) reasons.push("No credits");
  if (hasLeadContext && (!cityMatch || !categoryMatch)) reasons.push("City/category mismatch");

  return {
    eligible: reasons.length === 0,
    reasons,
    status,
    isActive,
    packageStatus,
    credits,
    cityMatch,
    categoryMatch,
  };
}

/**
 * Phase 25A assignment eligibility. This is stricter than the legacy preview
 * helper: free/unpaid vendors are always ineligible, and trials require the
 * runtime switch plus credits.
 */
export function evaluateVendorLeadAssignmentEligibility(
  vendor: Record<string, unknown> | null | undefined,
  lead: Record<string, unknown> | null | undefined,
  settings: VendorLeadAssignmentSettings | Record<string, unknown> | null | undefined = {},
): VendorLeadAssignmentEligibility {
  const row = isRecord(vendor) ? vendor : {};
  const leadRow = isRecord(lead) ? lead : {};
  const reasons: VendorLeadAssignmentRejectReason[] = [];

  const status = normalizeStatus(row.status);
  const isActive = normalizeActive(row);
  const packageStatus = normalizePackageStatus(row);
  const credits = normalizeCredits(row);
  const paidStatus = normalizePaidStatus(row);
  const allowTrial = readBooleanSetting(settings, "allow_trial_vendors_for_assignment", false);
  const visibilityType = classifyVendorCommercialType(row);

  if (status === "suspended") reasons.push("vendor_suspended");
  else if (status !== "approved") reasons.push("vendor_pending_approval");
  if (!isActive) reasons.push("vendor_inactive");

  const isTrial = visibilityType === "trial";
  const isPaid = visibilityType === "paid";
  const isFreeOrUnpaid = !isPaid && !isTrial;

  if (isFreeOrUnpaid) reasons.push("free_unpaid_vendor_not_eligible_for_assignment");
  if (isTrial && !allowTrial) reasons.push("free_unpaid_vendor_not_eligible_for_assignment");
  if (packageStatus === "expired" || isPackageDateExpired(row.package_expires_at)) reasons.push("package_expired");
  if (credits <= 0) reasons.push("no_credits");

  const leadCity = firstText(leadRow.city, leadRow.office_city);
  const leadCategory = firstText(leadRow.category, leadRow.service_required, leadRow.service_category);
  const leadSubcategory = firstText(leadRow.subcategory, leadRow.selected_subcategory);
  const vendorCity = firstText(row.city, row.office_city);
  const vendorCategories = collectVendorCategories(row);

  if (leadCity && vendorCity && !textEquals(vendorCity, leadCity)) reasons.push("city_mismatch");
  if (leadCategory && !categoryMatches(vendorCategories, leadCategory, leadSubcategory)) reasons.push("category_mismatch");
  if (leadSubcategory && !subcategoryMatches(vendorCategories, leadSubcategory)) reasons.push("subcategory_mismatch");

  return {
    eligible: reasons.length === 0,
    reasons: uniqueStrings(reasons),
    packageStatus,
    credits,
    visibilityType: visibilityType === "free" ? (paidStatus || "free") : visibilityType,
  };
}

// ---------------------------------------------------------------------------
// Phase 26A-2E: client-selected (vendor-profile) eligibility.
// For a vendor the CLIENT explicitly picked, an active package is NOT required —
// remaining_credits > 0 is the paid-access signal. Approved + Verified + active +
// not suspended + (public_visibility if present) + credits > 0. PURE, no I/O.
// ---------------------------------------------------------------------------
export type ClientSelectedVendorReason =
  | "not_approved"
  | "suspended"
  | "inactive"
  | "not_verified"
  | "not_visible"
  | "no_credits";

export interface ClientSelectedVendorEligibility {
  eligible: boolean;
  reasonCode: ClientSelectedVendorReason | null;
  reason: string | null;
  credits: number;
  /** Paid + credits but no package row — surface as an admin audit warning. */
  packageMissingButCredits: boolean;
}

const CLIENT_SELECTED_REASON_LABEL: Record<ClientSelectedVendorReason, string> = {
  not_approved: "not approved",
  suspended: "suspended",
  inactive: "inactive",
  not_verified: "not verified",
  not_visible: "profile not public",
  no_credits: "no credits",
};

const BAD_VERIFICATION = new Set(["pending", "rejected", "unverified", "not verified", "failed", "in review"]);

export function evaluateClientSelectedVendorEligibility(
  vendor: Record<string, unknown> | null | undefined,
): ClientSelectedVendorEligibility {
  const row = isRecord(vendor) ? vendor : {};
  const status = normalizeStatus(row.status);
  const isActive = normalizeActive(row);
  const credits = normalizeCredits(row);
  const rawPackageStatus = typeof row.package_status === "string" ? row.package_status.trim().toLowerCase() : "";

  // Verification: block only when it EXPLICITLY says not-verified; absent = ok.
  const verificationRaw = typeof row.verification_status === "string" ? row.verification_status.trim().toLowerCase() : "";
  const verificationBad = verificationRaw.length > 0 && BAD_VERIFICATION.has(verificationRaw);

  // Public visibility: block only when the field EXISTS and is explicitly false.
  const hasVisibilityField = "public_visibility" in row && row.public_visibility !== null && row.public_visibility !== undefined;
  const notVisible = hasVisibilityField && (row.public_visibility === false || row.public_visibility === "false" || row.public_visibility === 0);

  let reasonCode: ClientSelectedVendorReason | null = null;
  if (status === "suspended") reasonCode = "suspended";
  else if (status !== "approved") reasonCode = "not_approved";
  else if (!isActive) reasonCode = "inactive";
  else if (verificationBad) reasonCode = "not_verified";
  else if (notVisible) reasonCode = "not_visible";
  else if (credits <= 0) reasonCode = "no_credits";

  // Admin audit signal (never a blocker): the vendor has credits but no active
  // package row — package_status is none/expired/missing/empty. paid_status is
  // irrelevant here; credits are the paid-access signal for a client pick.
  const packageInactive =
    rawPackageStatus === "" ||
    rawPackageStatus === "none" ||
    rawPackageStatus === "missing" ||
    rawPackageStatus === "expired";
  const packageMissingButCredits = credits > 0 && packageInactive;

  return {
    eligible: reasonCode === null,
    reasonCode,
    reason: reasonCode ? CLIENT_SELECTED_REASON_LABEL[reasonCode] : null,
    credits,
    packageMissingButCredits,
  };
}

/** Normalized vendor status: pending | approved | rejected | suspended. */
export function normalizeStatus(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "approved" || text === "active") return "approved";
  if (text === "rejected") return "rejected";
  if (text === "suspended") return "suspended";
  if (text === "pending" || text === "") return "pending";
  return text;
}

/** Active flag, reading the first available alias. Defaults to true. */
export function normalizeActive(row: Record<string, unknown>): boolean {
  for (const key of ["is_active", "active", "enabled", "visibility_enabled"]) {
    if (key in row && row[key] !== null && row[key] !== undefined) {
      return row[key] === true || row[key] === "true" || row[key] === 1;
    }
  }
  return true;
}

/** Package status, reading the first available alias. Defaults to 'none'. */
export function normalizePackageStatus(row: Record<string, unknown>): string {
  for (const key of ["package_status", "subscription_status", "paid_status"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim().toLowerCase();
  }
  return "none";
}

export function normalizePaidStatus(row: Record<string, unknown>): string {
  for (const key of ["paid_status", "payment_status", "subscription_status"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim().toLowerCase();
  }
  return "";
}

/** Credit balance, reading the first available alias. Defaults to 0. */
export function normalizeCredits(row: Record<string, unknown>): number {
  for (const key of ["remaining_credits", "lead_credits", "credits", "credit_balance"]) {
    if (key in row && row[key] !== null && row[key] !== undefined) {
      const num = Number(row[key]);
      if (Number.isFinite(num)) return num;
    }
  }
  return 0;
}

/** Short human label for the eligibility badge. */
export function eligibilityLabel(result: VendorEligibility): string {
  return result.eligible ? "Eligible for lead preview" : "Not eligible";
}

function textEquals(a: unknown, b: unknown): boolean {
  const left = typeof a === "string" ? a.trim().toLowerCase() : "";
  const right = typeof b === "string" ? b.trim().toLowerCase() : "";
  return left.length > 0 && left === right;
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function classifyVendorCommercialType(row: Record<string, unknown>): "paid" | "trial" | "free" {
  const packageStatus = normalizePackageStatus(row);
  const paidStatus = normalizePaidStatus(row);
  if (packageStatus === "active" || PAID_STATUSES.has(paidStatus)) return "paid";
  if (packageStatus === "trial" || TRIAL_STATUSES.has(paidStatus)) return "trial";
  if (FREE_OR_UNPAID_STATUSES.has(packageStatus) || FREE_OR_UNPAID_STATUSES.has(paidStatus)) return "free";
  return "free";
}

function collectVendorCategories(row: Record<string, unknown>): string[] {
  return uniqueStrings([
    ...toStringArray(row.service_categories),
    ...toStringArray(row.selected_subcategories),
    firstText(row.category, row.selected_category),
    firstText(row.subcategory, row.selected_subcategory),
  ].filter((value): value is string => Boolean(value)));
}

function categoryMatches(vendorCategories: string[], leadCategory: string, leadSubcategory?: string | null): boolean {
  if (vendorCategories.length === 0) return false;
  const leadKey = normalizeCategoryKey(leadCategory);
  const leadSubKey = leadSubcategory ? normalizeCategoryKey(leadSubcategory) : "";

  return vendorCategories.some((category) => {
    const key = normalizeCategoryKey(category);
    if (key === leadKey) return true;
    if (leadKey === "interior" && INTERIOR_SUBCATEGORIES.has(key)) return true;
    if (INTERIOR_SUBCATEGORIES.has(leadKey) && (key === "interior" || key === leadKey)) return true;
    if (leadSubKey && key === leadSubKey) return true;
    return false;
  });
}

function subcategoryMatches(vendorCategories: string[], leadSubcategory: string): boolean {
  const leadKey = normalizeCategoryKey(leadSubcategory);
  return vendorCategories.some((category) => normalizeCategoryKey(category) === leadKey);
}

function normalizeCategoryKey(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (INTERIOR_SUBCATEGORIES.has(text)) return text;
  if (text === "interior" || text === "interiors") return "interior";
  if (text === "sofa") return "sofa";
  if (text === "painter") return "painter";
  if (text === "civil work" || text === "civil") return "civil work";
  return text;
}

function isPackageDateExpired(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() < Date.now();
}

function readBooleanSetting(
  settings: VendorLeadAssignmentSettings | Record<string, unknown> | null | undefined,
  key: string,
  fallback: boolean,
): boolean {
  if (!isRecord(settings)) return fallback;
  const value = settings[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return fallback;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}
