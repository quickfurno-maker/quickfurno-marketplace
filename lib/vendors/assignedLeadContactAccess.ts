// ============================================================================
// QuickFurno — lib/vendors/assignedLeadContactAccess.ts   (QF-MVP-80.15C)
//
// PER-ASSIGNMENT contact entitlement for the vendor dashboard.
//
// WHY THIS EXISTS
// The canonical assignment authority (public.qf_assign_lead_vendors_v2) charges
// exactly ONE wallet credit at ASSIGNMENT TIME and, in the same transaction,
// writes a mandatory ledger debit — if the debit does not apply, the authority
// raises and the assignment never commits. So a committed canonical assignment
// row IS a receipt.
//
// The vendor dashboard, however, decided contact visibility from MUTABLE CURRENT
// vendor state (package expiry, package/paid classification, current wallet
// balance). That let an already-paid lead be hidden later:
//
//   • the vendor's package lapsed after the assignment was charged, or
//   • the assignment itself spent the vendor's last credit (1 -> 0), so the very
//     debit that paid for the lead made the lead unreadable.
//
// Neither is defensible: the entitlement was purchased, and current wallet or
// package state cannot retroactively revoke a completed purchase.
//
// WHAT THIS MODULE DOES — and deliberately does not do
//   • It decides contact access for ONE assignment the vendor already owns.
//   • It NEVER grants access to a lead the vendor was not assigned. The caller
//     supplies the assignment; the assignment IS the scope.
//   • It does NOT touch NEW-assignment eligibility. Matching, ranking, caps,
//     credit cost and the wallet debit are unchanged and live elsewhere
//     (evaluateVendorAutomaticLeadEligibility / qf_vendor_assignment_eligible /
//     qf_assign_lead_vendors_v2).
//   • Account safety gates are NOT weakened: a vendor who is pending, rejected,
//     suspended or inactive is denied regardless of any receipt.
//   • A row WITHOUT canonical evidence gets the pre-existing behaviour exactly.
//     Legacy rows fail closed to the old helper — this never widens them.
//
// WHY operation_id + credit_deducted IS SUFFICIENT (verified against the LIVE
// production function, not just the migration):
//   • qf_assign_lead_vendors_v2 inserts lead_assignments with credit_deducted
//     hardcoded `true` and operation_id set to the authority-derived operation.
//   • The ledger debit runs in the same transaction; a non-'applied' result
//     raises P0001 and rolls the assignment back. There is no compensating write.
//   • The six legacy assignment RPCs never reference operation_id at all, so
//     they cannot mint this evidence.
//   • No application code inserts into lead_assignments — every app-side write is
//     an UPDATE of vendor_status / is_bad_lead_reported.
// Therefore a non-null operation_id together with credit_deducted = true can only
// have come from the canonical authority, and reading those two columns avoids an
// N+1 ledger lookup per row.
//
// PURE: no I/O, no clock, no randomness, no database access. Safe on the server
// and in the browser bundle.
// ============================================================================
import {
  evaluateVendorContactAccessEligibility,
  normalizeActive,
  normalizeStatus,
  type VendorLeadAssignmentSettings,
} from "./vendorEligibility";

/** Which rule actually decided. Recorded so a denial is explainable. */
export type AssignedLeadContactBasis =
  | "account_blocked"
  | "canonical_assignment"
  | "legacy_helper";

export type AssignedLeadContactReason =
  | "vendor_not_approved"
  | "vendor_suspended"
  | "vendor_inactive"
  | "legacy_assignment_not_entitled";

export interface AssignedLeadContactAccess {
  /** The ONLY field a caller should act on. */
  readonly contactAllowed: boolean;
  readonly basis: AssignedLeadContactBasis;
  readonly reasonCode: AssignedLeadContactReason | null;
  /** True when this row carried canonical assignment-time debit evidence. */
  readonly canonicalEvidence: boolean;
}

/**
 * The two columns the canonical authority writes. Shaped loosely because the
 * row arrives from PostgREST; anything unexpected is treated as ABSENT.
 */
export interface AssignmentEntitlementRow {
  readonly operation_id?: unknown;
  readonly credit_deducted?: unknown;
}

/**
 * Canonical assignment-time debit evidence.
 *
 * Both halves are required. `credit_deducted` alone is not enough — legacy RPCs
 * set it too — and `operation_id` alone is not enough because the contract is
 * "an operation that charged", not merely "an operation". Anything missing,
 * blank or of the wrong type is NOT evidence: this fails closed.
 */
export function hasCanonicalAssignmentDebitEvidence(
  assignment: AssignmentEntitlementRow | null | undefined,
): boolean {
  if (!assignment || typeof assignment !== "object") return false;
  const operationId = (assignment as { operation_id?: unknown }).operation_id;
  const creditDeducted = (assignment as { credit_deducted?: unknown }).credit_deducted;
  const hasOperation = typeof operationId === "string" && operationId.trim().length > 0;
  // Strictly `true`. A string "true", 1, or null is not a debit receipt.
  return hasOperation && creditDeducted === true;
}

/**
 * Account-level safety. Unchanged from the pre-existing contract: only an
 * approved AND active vendor may ever see client contact. A receipt does not
 * override this — a suspended vendor stays blocked even on a lead they paid for.
 */
export function isVendorAccountContactEligible(
  vendor: Record<string, unknown> | null | undefined,
): boolean {
  return accountDenyReason(vendor) === null;
}

function accountDenyReason(
  vendor: Record<string, unknown> | null | undefined,
): AssignedLeadContactReason | null {
  const row = vendor && typeof vendor === "object" ? vendor : {};
  const status = normalizeStatus((row as { status?: unknown }).status);
  if (status === "suspended") return "vendor_suspended";
  if (status !== "approved") return "vendor_not_approved"; // pending / rejected / unknown
  if (!normalizeActive(row as Record<string, unknown>)) return "vendor_inactive";
  return null;
}

/**
 * Decide contact access for ONE assignment this vendor owns.
 *
 * Ownership is the CALLER's responsibility and is enforced upstream by
 * requireVendorOwner() plus the `.eq("vendor_id", vendorId)` scope on the query.
 * This function is given an assignment that already belongs to the vendor; it
 * never widens the set of visible leads, only decides contact on one of them.
 *
 * Order matters:
 *   1. account blocked            -> deny, always
 *   2. canonical debit evidence   -> allow, ignoring current package/balance
 *   3. otherwise                  -> the pre-existing helper decides, unchanged
 */
export function evaluateAssignedLeadContactAccess(
  vendor: Record<string, unknown> | null | undefined,
  assignment: AssignmentEntitlementRow | null | undefined,
  settings: VendorLeadAssignmentSettings | Record<string, unknown> | null | undefined = {},
): AssignedLeadContactAccess {
  const canonicalEvidence = hasCanonicalAssignmentDebitEvidence(assignment);

  const denied = accountDenyReason(vendor);
  if (denied) {
    return { contactAllowed: false, basis: "account_blocked", reasonCode: denied, canonicalEvidence };
  }

  if (canonicalEvidence) {
    // The purchase already happened. Current package expiry, current package /
    // paid classification and the CURRENT wallet balance (including 0 after this
    // very assignment spent the last credit) are all irrelevant here.
    return { contactAllowed: true, basis: "canonical_assignment", reasonCode: null, canonicalEvidence };
  }

  // No receipt on this row: behave EXACTLY as before this phase.
  const legacy = evaluateVendorContactAccessEligibility(vendor, settings);
  return {
    contactAllowed: legacy.eligible,
    basis: "legacy_helper",
    reasonCode: legacy.eligible ? null : "legacy_assignment_not_entitled",
    canonicalEvidence,
  };
}
