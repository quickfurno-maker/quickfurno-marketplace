/**
 * Registration documentation is separate from phone possession and payment.
 * Fail-closed policy for Owner status transitions, not a replacement for the
 * database assignment authority. Safety-negative actions stay available.
 */
export const VENDOR_DOCUMENT_GATED_ACTIONS = Object.freeze([
  "approve", "activate", "activate_leads",
] as const);
export function requiresVendorVerificationEvidence(action: unknown): boolean {
  return typeof action === "string" &&
    (VENDOR_DOCUMENT_GATED_ACTIONS as readonly string[]).includes(action);
}
