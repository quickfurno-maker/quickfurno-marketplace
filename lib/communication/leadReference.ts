// ============================================================================
// QuickFurno — lib/communication/leadReference.ts
//
// The ONE derivation of the customer-visible `lead_reference` transport value.
//
// WHY THIS MODULE EXISTS
//   `public.leads` has no `reference` column. The value bound to the
//   `lead_reference` BusinessSourceKey has always been DERIVED from the lead id,
//   and until QF-MVP-80.13A that formula lived inline in exactly one place
//   (services/automationClientExecutionService.ts, the client lane). The vendor
//   lead-assignment lane needs the same value for the same lead.
//
//   Two inline copies of a formula are two references for one lead the moment
//   either is edited — a client told "QF-1A2B3C4D" and a vendor told something
//   else about the same job. So the formula is stated once, here, and both lanes
//   import it. There is deliberately no second derivation anywhere.
//
// PROPERTIES
//   * DETERMINISTIC — the same lead id always yields the same reference, in any
//     process, with no storage and no clock.
//   * NON-PII — it carries no name, phone, address, city or service text, and
//     the raw internal UUID is never placed in a customer-visible message.
//   * FAIL-CLOSED — anything that is not a lead id yields null. A caller that
//     cannot derive a reference must refuse to send, never substitute one.
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The stable human-facing prefix. Changing it changes every future reference. */
export const LEAD_REFERENCE_PREFIX = "QF-";

/** Hex characters of the lead id carried into the reference. */
export const LEAD_REFERENCE_SIGNIFICANT_CHARS = 8;

/**
 * Derive the customer-visible reference for a lead, or null when the input is
 * not a lead id. Never throws, never invents, never falls back.
 */
export function deriveLeadReference(leadId: unknown): string | null {
  if (typeof leadId !== "string" || !UUID_RE.test(leadId)) return null;
  return (
    LEAD_REFERENCE_PREFIX +
    leadId.replace(/-/g, "").slice(0, LEAD_REFERENCE_SIGNIFICANT_CHARS).toUpperCase()
  );
}
