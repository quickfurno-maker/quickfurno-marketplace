// ============================================================================
// QuickFurno — lib/vendors/vendorAutomaticEligibility.ts
// Phase 4 (credit-wallet): THE canonical "can this approved vendor receive an
// automatic enquiry?" decision. ZERO dependencies (self-contained normalizers) so
// it is importable standalone for harness testing and safe on client + server.
//
// Deliberately SIMPLE and free of package/paid_status:
//   approved account + active + accepting_leads + NOT assignment-suspended
//   + remaining_credits >= cost.
// City and category compatibility are applied SEPARATELY by the matcher. This MUST
// stay identical to the PostgreSQL assignment-RPC gate (migration
// 20260706000142_credit_wallet_assignment_rpc.sql).
//
// QF-MVP-75.01 — ALIGNMENT.
//   public.qf_vendor_assignment_eligible (migration 20260723000300) has enforced
//   the temporary ASSIGNMENT SUSPENSION window as a hard gate since QF-MVP-20.3B1,
//   while this module did not. The matcher could therefore rank a vendor the
//   authority was certain to reject, consuming a bounded candidate-pool slot and
//   surfacing only the authority's coarse `vendor_not_eligible`. The gate is
//   mirrored here so the automatic DECISION is explainable on its own; the
//   database keeps it as the enforcement backstop and remains the authority.
//   Package/paid_status are still NOT eligibility inputs — 75.01 introduces no
//   commercial priority into the automatic path.
//
// The small normalizers below mirror the stable contracts in vendorEligibility.ts
// (status / active / credits); kept inline so this module has no imports.
// ============================================================================

/** For initial production, one successfully assigned enquiry costs one credit. */
export const LEAD_CREDIT_COST = 1;

export type VendorAutomaticLeadEligibilityReason =
  | "vendor_not_approved"
  | "vendor_suspended"
  | "vendor_assignment_suspended"
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
  /**
   * QF-MVP-75.01: TRUE while the vendor sits inside an open assignment
   * suspension window. Distinct from `accountStatus === "suspended"`, which is a
   * permanent account state.
   */
  assignmentSuspended: boolean;
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

/** Milliseconds for a timestamp-ish value, or null when it cannot be read. */
function timestampMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * QF-MVP-75.01 — temporary ASSIGNMENT SUSPENSION window.
 *
 * Byte-for-byte mirror of the hard gate public.qf_vendor_assignment_eligible has
 * enforced since migration 20260723000300:
 *
 *   assignment_suspended_at is not null
 *   and (assignment_suspended_until is null or assignment_suspended_until > now())
 *
 * Before 75.01 this gate existed ONLY in the database. The automatic matcher
 * could therefore rank a suspended vendor into the candidate pool, burn one of
 * its bounded pool slots, and only discover the rejection as the authority's
 * deliberately coarse `vendor_not_eligible`. Aligning it here removes that
 * rank-then-reject drift; the database keeps the gate as its enforcement
 * backstop and remains the authority.
 *
 * A vendor whose suspension columns are ABSENT or NULL is never suspended, so an
 * un-migrated or never-suspended row behaves exactly as before.
 *
 * `nowMs` is injected rather than read from a clock so this module stays pure
 * and the offline suite can exercise both sides of the window boundary.
 */
export function isVendorAssignmentSuspended(
  row: Record<string, unknown> | null | undefined,
  nowMs: number,
): boolean {
  const record = isRecord(row) ? row : {};

  // No suspension recorded (column absent, or NULL) => never suspended.
  if (timestampMs(record.assignment_suspended_at) === null) return false;

  const rawUntil = record.assignment_suspended_until;
  // An open-ended suspension (no `until`) never lapses on its own.
  if (rawUntil === null || rawUntil === undefined) return true;

  const suspendedUntil = timestampMs(rawUntil);
  // A present-but-unreadable `until` fails CLOSED: an unreadable expiry is not
  // evidence that the suspension has lapsed.
  if (suspendedUntil === null) return true;

  // Strictly greater-than, exactly as the SQL gate compares against now().
  return suspendedUntil > nowMs;
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
  options: { creditCost?: number; nowMs?: number } = {},
): VendorAutomaticLeadEligibility {
  const row = isRecord(vendor) ? vendor : {};
  const accountStatus = normalizeStatus(row.status); // pending | approved | suspended | rejected | (other)
  const isActive = normalizeActive(row);
  const acceptingLeads = normalizeAcceptingLeads(row);
  const credits = normalizeCredits(row);
  const creditCost = Number.isFinite(options.creditCost) && Number(options.creditCost) > 0 ? Number(options.creditCost) : LEAD_CREDIT_COST;
  // QF-MVP-75.01: the ONLY clock read in this module, injectable so the pure
  // decision path and the offline suite stay deterministic.
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const assignmentSuspended = isVendorAssignmentSuspended(row, nowMs);

  const reasons: VendorAutomaticLeadEligibilityReason[] = [];
  if (accountStatus === "suspended") reasons.push("vendor_suspended");
  else if (accountStatus !== "approved") reasons.push("vendor_not_approved"); // pending / rejected / unknown
  if (!isActive) reasons.push("vendor_inactive");
  if (!acceptingLeads) reasons.push("not_accepting_leads");
  // QF-MVP-75.01: mirrors the pre-existing SQL hard gate so the matcher never
  // ranks a vendor the persistence authority is certain to reject.
  if (assignmentSuspended) reasons.push("vendor_assignment_suspended");
  if (credits < creditCost) reasons.push("no_credits");

  return {
    eligible: reasons.length === 0,
    reasons,
    accountStatus,
    isActive,
    acceptingLeads,
    assignmentSuspended,
    credits,
    creditCost,
  };
}
