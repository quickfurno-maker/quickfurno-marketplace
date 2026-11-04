/**
 * Vendor WhatsApp OTP admission contract.
 *
 * Fail-closed PURE guard for future server-only vendor OTP verifier. Callers
 * MUST provide evidence read from Supabase Auth verifyOtp + the protected
 * communication ledger; NEVER use a browser-claimed "verified" flag.
 * This does not send OTP, establish a session or enable a provider.
 */
export const VENDOR_OTP_MESSAGE_TYPE = "vendor_login_otp" as const;
export const VENDOR_OTP_AUTH_MAX_AGE_MS = 10 * 60 * 1000;
const INDIAN_E164 = /^\+91[6-9]\d{9}$/;
const DELIVERED = new Set(["accepted", "sent", "delivered", "read"]);
const CLAIM_DIGEST = /^[0-9a-f]{64}$/;
const WEBHOOK_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const UNTRUSTED_PROVIDERS = new Set(["mock", "test", "fake", "local", "development"]);

/**
 * Claimed purpose, loaded from the private signed Auth Hook reservation by a
 * server-only credential. A browser cannot assert or manufacture this.
 */
export interface VendorOtpPurposeClaim {
  readonly purpose: string;
  readonly state: string;
  readonly authUserId: string;
  readonly phoneDigest: string;
  readonly verifiedWebhookId: string;
  readonly createdAt: string;
}


export interface VendorOtpAdmissionEvidence {
  /** The signed-in Auth user's identifier, obtained only from verifyOtp/getUser. */
  authUserId: string;
  authPhoneE164: string | null;
  phoneConfirmedAt: string | null;
  expectedPhoneE164: string;
  /** Server-generated HMAC phone digest, NEVER a browser/body-supplied hash. */
  expectedPhoneDigest: string;
  /** Provider key selected by the independently enabled server runtime gate. */
  expectedProvider: string;
  /** Server-side proof a SIGNED hook claimed vendor_login (not client_login). */
  purposeClaim: VendorOtpPurposeClaim | null;
  /** Existing canonical profiles.role; null means neutral, not privileged. */
  existingProfileRole: string | null;
  /** A client_accounts row is a separate client identity even if profile role is neutral. */
  existingClientAccount: boolean;
  /** Server-only ledger lookup, NOT a value sent by the public signup form. */
  delivery: {
    authUserId: string;
    phoneE164: string;
    messageType: string;
    channel: string;
    provider: string;
    status: string;
    verifiedWebhookId: string;
    deliveredAt: string;
  } | null;
  nowMs: number;
}

export type VendorOtpAdmissionReason =
  | "invalid_phone" | "phone_mismatch" | "phone_unconfirmed"
  | "privileged_or_conflicting_role" | "no_verified_delivery"
  | "delivery_subject_mismatch" | "not_vendor_whatsapp_otp"
  | "not_proven_delivered" | "stale_delivery"
  | "untrusted_provider" | "purpose_claim_missing" | "purpose_claim_mismatch"
  | "delivery_provider_mismatch";

export function evaluateVendorOtpAdmission(
  ev: VendorOtpAdmissionEvidence,
): { admitted: true } | { admitted: false; reason: VendorOtpAdmissionReason } {
  const phone = ev.expectedPhoneE164;
  if (!INDIAN_E164.test(phone)) return { admitted: false, reason: "invalid_phone" };
  if (!ev.authUserId || ev.authPhoneE164 !== phone) {
    return { admitted: false, reason: "phone_mismatch" };
  }
  if (!ev.phoneConfirmedAt || !Number.isFinite(Date.parse(ev.phoneConfirmedAt))) {
    return { admitted: false, reason: "phone_unconfirmed" };
  }
  const role = ev.existingProfileRole?.trim().toLowerCase() || null;
  // Require an explicit negative server-side client_accounts lookup. Unknown is
  // NOT equivalent to absent, so an unavailable role resolver fails closed.
  if (ev.existingClientAccount !== false || (role !== null && role !== "vendor")) {
    return { admitted: false, reason: "privileged_or_conflicting_role" };
  }
  // Provider attestation must be bound to the independently enabled
  // operational adapter. A historical mock/test row never authorizes signup.
  const provider = ev.expectedProvider?.trim();
  if (!provider || UNTRUSTED_PROVIDERS.has(provider.toLowerCase())) {
    return { admitted: false, reason: "untrusted_provider" };
  }

  // Supabase phone confirmation alone (even with a matching message) cannot
  // distinguish an existing CLIENT OTP from a new VENDOR OTP. The signed hook
  // must have consumed an atomic vendor-purpose reservation for this HMAC
  // destination and the precise Auth principal.
  const claim = ev.purposeClaim;
  if (!claim) return { admitted: false, reason: "purpose_claim_missing" };
  const claimedAt = Date.parse(claim.createdAt);
  if (!CLAIM_DIGEST.test(ev.expectedPhoneDigest) ||
      !WEBHOOK_ID.test(claim.verifiedWebhookId) ||
      claim.purpose !== "vendor_login" || claim.state !== "claimed" ||
      claim.authUserId !== ev.authUserId ||
      claim.phoneDigest !== ev.expectedPhoneDigest ||
      !Number.isFinite(ev.nowMs) || !Number.isFinite(claimedAt) ||
      claimedAt > ev.nowMs + 30_000 ||
      ev.nowMs - claimedAt > VENDOR_OTP_AUTH_MAX_AGE_MS) {
    return { admitted: false, reason: "purpose_claim_mismatch" };
  }

  const delivery = ev.delivery;
  if (!delivery || !delivery.verifiedWebhookId) {
    return { admitted: false, reason: "no_verified_delivery" };
  }
  if (delivery.authUserId !== ev.authUserId || delivery.phoneE164 !== phone) {
    return { admitted: false, reason: "delivery_subject_mismatch" };
  }
  if (delivery.messageType !== VENDOR_OTP_MESSAGE_TYPE || delivery.channel !== "whatsapp") {
    return { admitted: false, reason: "not_vendor_whatsapp_otp" };
  }
  if (delivery.provider !== provider) {
    return { admitted: false, reason: "delivery_provider_mismatch" };
  }
  if (delivery.verifiedWebhookId !== claim.verifiedWebhookId) {
    return { admitted: false, reason: "purpose_claim_mismatch" };
  }
  if (!DELIVERED.has(delivery.status)) {
    return { admitted: false, reason: "not_proven_delivered" };
  }
  const at = Date.parse(delivery.deliveredAt);
  if (!Number.isFinite(ev.nowMs) || !Number.isFinite(at) ||
      at > ev.nowMs + 30_000 || ev.nowMs - at > VENDOR_OTP_AUTH_MAX_AGE_MS ||
      at < claimedAt - 30_000) {
    return { admitted: false, reason: "stale_delivery" };
  }
  return { admitted: true };
}
