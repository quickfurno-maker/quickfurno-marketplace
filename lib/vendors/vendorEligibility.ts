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

const ACTIVE_PACKAGE_STATUSES = new Set(["active", "trial"]);

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
  for (const key of ["package_status", "subscription_status"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim().toLowerCase();
  }
  return "none";
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

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
