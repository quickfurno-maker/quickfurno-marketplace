// ============================================================================
// QuickFurno — lib/leads/indianMobile.ts   (PURE, ZERO DEPENDENCIES)
//
// QF-MVP-50.8 — the ONE definition of "an Indian mobile in national form".
//
// WHY THIS IS ITS OWN FILE. The full lead-capture contract
// (`lib/leads/leadContactContract.ts`) delegates its international branch to
// `lib/communication/phone.ts`, which imports Node's `crypto` for destination
// hashing. The public enquiry forms run in the BROWSER and need only this
// national shape, so importing the full contract there would drag a Node core
// module into the client bundle for the sake of one regular expression.
//
// Splitting the smallest pure part out is what keeps the rule SHARED rather
// than copied: `LeadFunnel`, `ClientEnquiryModal`, the lead destination adapter
// and the server capture authority all point at the constant below, so a future
// change to the accepted shape cannot move one of them without moving all.
//
// This file must never gain an import. If it needs one, the thing that needs it
// belongs in the contract module instead.
// ============================================================================

/**
 * An Indian mobile in national form: exactly ten digits, the first 6-9.
 *
 * Deliberately NOT a cleaner. It does not strip spaces, hyphens or a `+91`
 * prefix — a value qualifies only if it ALREADY is this shape, so the decision
 * to discard characters is always made somewhere a reader can see it.
 */
export const INDIAN_LEAD_MOBILE_RE = /^[6-9]\d{9}$/;

/** True only for a string that is already exactly the national shape above. */
export function isIndianLeadMobile(value: unknown): boolean {
  return typeof value === "string" && INDIAN_LEAD_MOBILE_RE.test(value);
}
