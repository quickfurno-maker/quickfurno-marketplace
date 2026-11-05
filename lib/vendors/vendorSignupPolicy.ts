/** Strictly optional GSTIN at vendor signup. Presence is NOT a verified GST status. */
export const VENDOR_REGISTRATION_PRIVACY_REVISION = "2026-11-04-v1";

/** Format-only check; owner must verify GSTIN against the official GST portal. */
const GSTIN_FORMAT = /^(?:0[1-9]|[12][0-9]|3[0-8]|97)[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

export function normalizeOptionalGstin(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function isValidOptionalGstin(value: unknown): boolean {
  const normalized = normalizeOptionalGstin(value);
  return !normalized || GSTIN_FORMAT.test(normalized);
}

/** Only an explicit affirmative checkbox is consent; never a truthy string. */
export function hasVendorRegistrationConsent(value: unknown): value is true {
  return value === true;
}
