// ============================================================================
// QuickFurno — lib/vendors/vendorAutomaticEligibility.ts
// Phase 4 (credit-wallet): THE canonical "can this approved vendor receive an
// automatic enquiry?" decision. ZERO dependencies (self-contained normalizers) so
// it is importable standalone for harness testing and safe on client + server.
//
// Deliberately SIMPLE and free of package/paid_status:
//   approved account + active + accepting_leads + remaining_credits >= cost.
// City and category compatibility are applied SEPARATELY by the matcher. This MUST
// stay identical to the PostgreSQL assignment-RPC gate (migration
// 20260706000142_credit_wallet_assignment_rpc.sql).
//
// The small normalizers below mirror the stable contracts in vendorEligibility.ts
// (status / active / credits); kept inline so this module has no imports.
// ============================================================================

/** For initial production, one successfully assigned enquiry costs one credit. */
export const LEAD_CREDIT_COST = 1;

export type VendorAutomaticLeadEligibilityReason =
  | "vendor_not_approved"
  | "vendor_suspended"
  | "vendor_inactive"
  | "not_accepting_leads"
  | "no_credits";

export interface VendorAutomaticLeadEligibility {
  eligible: boolean;
  reasons: VendorAutomaticLeadEligibilityReason[];
  /** Normalized account status: pending | approved | suspended | rejected. */
  accountStatus: string;
  isActive: boolean;
  acceptingLeads: boolean;
  credits: number;
  creditCost: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** pending | approved | suspended | rejected (mirrors vendorEligibility.normalizeStatus). */
function normalizeStatus(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "approved" || text === "active") return "approved";
  if (text === "rejected") return "rejected";
  if (text === "suspended") return "suspended";
  if (text === "pending" || text === "") return "pending";
  return text;
}

/** Active flag, first available alias; defaults to true. */
function normalizeActive(row: Record<string, unknown>): boolean {
  for (const key of ["is_active", "active", "enabled", "visibility_enabled"]) {
    if (key in row && row[key] !== null && row[key] !== undefined) {
      return row[key] === true || row[key] === "true" || row[key] === 1;
    }
  }
  return true;
}

/** Credit balance, first available alias; defaults to 0. */
function normalizeCredits(row: Record<string, unknown>): number {
  for (const key of ["remaining_credits", "lead_credits", "credits", "credit_balance"]) {
    if (key in row && row[key] !== null && row[key] !== undefined) {
      const num = Number(row[key]);
      if (Number.isFinite(num)) return num;
    }
  }
  return 0;
}

/**
 * Temporary availability for NEW enquiries. Defaults to TRUE when the column is
 * absent/null so existing production delivery is never silently stopped. Distinct
 * from is_active / package_status / public_visibility.
 */
export function normalizeAcceptingLeads(row: Record<string, unknown> | null | undefined): boolean {
  const record = isRecord(row) ? row : {};
  const value = record.accepting_leads;
  if (value === undefined || value === null) return true;
  return value === true || value === "true" || value === 1;
}

/**
 * Canonical automatic lead-assignment eligibility (commercial/operational only).
 * NOT gated on paid_status, package_status, package expiry, vendor_packages rows,
 * or public_visibility. City/category are the matcher's separate responsibility.
 */
export function evaluateVendorAutomaticLeadEligibility(
  vendor: Record<string, unknown> | null | undefined,
  options: { creditCost?: number } = {},
): VendorAutomaticLeadEligibility {
  const row = isRecord(vendor) ? vendor : {};
  const accountStatus = normalizeStatus(row.status); // pending | approved | suspended | rejected | (other)
  const isActive = normalizeActive(row);
  const acceptingLeads = normalizeAcceptingLeads(row);
  const credits = normalizeCredits(row);
  const creditCost = Number.isFinite(options.creditCost) && Number(options.creditCost) > 0 ? Number(options.creditCost) : LEAD_CREDIT_COST;

  const reasons: VendorAutomaticLeadEligibilityReason[] = [];
  if (accountStatus === "suspended") reasons.push("vendor_suspended");
  else if (accountStatus !== "approved") reasons.push("vendor_not_approved"); // pending / rejected / unknown
  if (!isActive) reasons.push("vendor_inactive");
  if (!acceptingLeads) reasons.push("not_accepting_leads");
  if (credits < creditCost) reasons.push("no_credits");

  return { eligible: reasons.length === 0, reasons, accountStatus, isActive, acceptingLeads, credits, creditCost };
}
