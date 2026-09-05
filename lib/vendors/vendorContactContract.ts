// ============================================================================
// QuickFurno — lib/vendors/vendorContactContract.ts   (PURE)
//
// QF-MVP-80.16C — what counts as a usable QuickFurno vendor contact number.
//
// WHY THIS EXISTS
// Vendor registration validated a contact number by LENGTH alone, so a value
// like `2234567890` was accepted, stored, and then could never be reached by
// the WhatsApp lead-alert path — the vendor was charged for assignments whose
// notification was structurally undeliverable. "Ten digits" was never the rule.
//
// This states the rule ONCE, purely, so the server authority
// (`services/vendorService.ts`) and the live registration form agree with the
// notification lane's own expectation by construction rather than by comment.
//
// SCOPE, deliberately narrow
//   * It describes the STORED shape — ten bare digits — and does not convert to
//     E.164. Storage canonicalisation is a separate, larger change.
//   * It is not a communication contract. `lib/communication/phone.ts` remains
//     strict for client, lead, admin and OTP traffic, where a bare national
//     number is genuinely ambiguous and must stay rejected.
// ============================================================================

/**
 * An Indian mobile number as QuickFurno stores it: exactly ten digits, and the
 * first is 6-9. The same expression the live enquiry form, the lead-quality
 * gate and the vendor destination adapter already use.
 */
export const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;

/**
 * True only for a value that is already exactly the stored shape.
 *
 * It deliberately does NOT clean its input: callers strip non-digits first, so
 * that the decision to discard characters is made where it is visible, not
 * hidden inside a validator that would happily accept `+91 98765 43210` and
 * silently reinterpret it.
 */
export function isValidIndianMobile(value: unknown): boolean {
  return typeof value === "string" && INDIAN_MOBILE_RE.test(value);
}
