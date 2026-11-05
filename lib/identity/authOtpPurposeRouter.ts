/**
 * Pure routing contract for the already-existing signed Supabase Send SMS Hook.
 * The HTTP handler MUST verify the raw Standard Webhooks signature before
 * constructing a VerifiedSignedSmsEvent. This file has no provider imports and
 * performs zero messaging/network operations; injected handlers are test doubles
 * until the separate client/vendor Auth Hook integration is reviewed.
 *
 * Only the server-side atomic phone-purpose reservation is authoritative.
 * NEVER infer purpose from user_metadata, browser input or client role claims.
 */
export type VerifiedOtpPurpose = "client_login" | "vendor_login";
export interface VerifiedSignedSmsEvent {
  readonly authUserId: string;
  readonly phoneE164: string;
  /** Supabase Auth-issued code. Transient memory only: never log or persist. */
  readonly otp: string;
  readonly verifiedWebhookId: string;
  /** Set solely by the raw-body signature verifier, not an incoming JSON field. */
  readonly signatureVerified: boolean;
}
export type OtpRouteOutcome =
  | { readonly kind: "dispatched"; readonly purpose: VerifiedOtpPurpose }
  | { readonly kind: "blocked"; readonly reason: "unauthenticated_hook" | "invalid_event" | "unreserved" | "disabled_or_failed" };
export interface OtpPurposeRouterDependencies {
  /** Signed hook claim from qf_claim_auth_otp_purpose. Null means NO DELIVERY. */
  readonly claim: (event: VerifiedSignedSmsEvent) => Promise<VerifiedOtpPurpose | null>;
  /** Existing client lane; never substitute this for vendor OTP. */
  readonly dispatchClient: (event: VerifiedSignedSmsEvent) => Promise<boolean>;
  /** Separate vendor Authentication template and WhatsApp-only lane. */
  readonly dispatchVendor: (event: VerifiedSignedSmsEvent) => Promise<boolean>;
  /** Independent provider/template/automation gate for each purpose. */
  readonly allowClient: () => Promise<boolean>;
  readonly allowVendor: () => Promise<boolean>;
}
const INDIAN_E164 = /^\+91[6-9]\d{9}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEBHOOK_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const OTP = /^\d{6,8}$/;

export async function routeVerifiedSignedOtp(
  event: VerifiedSignedSmsEvent,
  deps: OtpPurposeRouterDependencies
): Promise<OtpRouteOutcome> {
  if (event?.signatureVerified !== true)
    return { kind: "blocked", reason: "unauthenticated_hook" };
  if (!UUID.test(event.authUserId) || !INDIAN_E164.test(event.phoneE164) ||
      !WEBHOOK_ID.test(event.verifiedWebhookId) || !OTP.test(event.otp)) {
    return { kind: "blocked", reason: "invalid_event" };
  }
  try {
    const purpose = await deps.claim(event);
    if (purpose !== "client_login" && purpose !== "vendor_login") {
      return { kind: "blocked", reason: "unreserved" };
    }
    if (purpose === "client_login") {
      if (!(await deps.allowClient())) return { kind: "blocked", reason: "disabled_or_failed" };
      if (!(await deps.dispatchClient(event))) return { kind: "blocked", reason: "disabled_or_failed" };
      return { kind: "dispatched", purpose };
    }
    // Absolutely no implicit SMS fallback in the vendor route. A vendor OTP
    // never calls the client-specific orchestrator or client template.
    if (!(await deps.allowVendor())) return { kind: "blocked", reason: "disabled_or_failed" };
    if (!(await deps.dispatchVendor(event))) return { kind: "blocked", reason: "disabled_or_failed" };
    return { kind: "dispatched", purpose };
  } catch {
    // An uncertain claim/provider outcome is never retried or sent elsewhere.
    return { kind: "blocked", reason: "disabled_or_failed" };
  }
}
