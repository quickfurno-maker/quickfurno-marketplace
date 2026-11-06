/**
 * Vendor OTP initiation coordination, PURE dependency injection only.
 *
 * This module is not an endpoint, Auth client or provider adapter. No runtime
 * caller is wired until BOTH client/vendor signed Auth Hook branches are
 * independently certified. Crucially, Supabase Auth is not asked to generate
 * an OTP unless an explicit vendor-only operational gate, abuse controls AND
 * the atomic phone/purpose reservation have all succeeded.
 *
 * A successful signInWithOtp request means "initiated", NOT "verified" or
 * "WhatsApp delivered". The existing protected delivery ledger and Supabase
 * verifyOtp/getUser must independently prove possession before signup.
 */
export type VendorOtpRequestOutcome =
  | { readonly kind: "initiated" }
  | { readonly kind: "blocked"; readonly reason:
    "invalid_phone" | "gate_closed" | "rate_limited" |
    "reservation_conflict" | "auth_rejected" | "outcome_uncertain" };

export interface VendorOtpRequestDependencies {
  /** Must check the vendor-specific OFF-by-default runtime switch. */
  readonly vendorGate: () => Promise<boolean>;
  /** Bounded pre-Auth controls must use a server-generated privacy-safe key. */
  readonly abuseAllowed: (phoneE164: string) => Promise<boolean>;
  /** Server-only atomic reservation, purpose is NEVER taken from the browser. */
  readonly reserveVendorPurpose: (phoneE164: string, purpose: "vendor_login") => Promise<boolean>;
  /**
   * Supabase Auth phone signInWithOtp, without channel=whatsapp or SMS fallback.
   * "uncertain" and throws are terminal for this request; the reservation must
   * expire naturally rather than permitting a second potentially delivered OTP.
   */
  readonly initiateSupabaseOtp: (phoneE164: string) => Promise<"initiated" | "rejected" | "uncertain">;
}
const PHONE = /^\+91[6-9]\d{9}$/;

/** No transport, session, user creation, or provider call in this module. */
export async function coordinateVendorOtpRequest(
  phoneE164: string,
  deps: VendorOtpRequestDependencies,
): Promise<VendorOtpRequestOutcome> {
  if (typeof phoneE164 !== "string" || !PHONE.test(phoneE164))
    return { kind: "blocked", reason: "invalid_phone" };

  try {
    if (!(await deps.vendorGate()))
      return { kind: "blocked", reason: "gate_closed" };
    if (!(await deps.abuseAllowed(phoneE164)))
      return { kind: "blocked", reason: "rate_limited" };
    if (!(await deps.reserveVendorPurpose(phoneE164, "vendor_login")))
      return { kind: "blocked", reason: "reservation_conflict" };

    // Never fall back to SMS, client_login, or a second reservation if the Auth
    // request has an uncertain outcome or raises a transport error.
    const result = await deps.initiateSupabaseOtp(phoneE164);
    if (result === "initiated") return { kind: "initiated" };
    if (result === "rejected") return { kind: "blocked", reason: "auth_rejected" };
    return { kind: "blocked", reason: "outcome_uncertain" };
  } catch {
    // Fail closed; even if the failure occurred before the reservation, do NOT
    // blind-retry. If after it, leave the lease intact until its bounded expiry.
    return { kind: "blocked", reason: "outcome_uncertain" };
  }
}
