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

export interface VendorOtpAdmissionEvidence {
  /** The signed-in Auth user's identifier, obtained only from verifyOtp/getUser. */
  authUserId: string;
  authPhoneE164: string | null;
  phoneConfirmedAt: string | null;
  expectedPhoneE164: string;
  /** Existing canonical profiles.role; null means neutral, not privileged. */
  existingProfileRole: string | null;
  /** Server-only ledger lookup, NOT a value sent by the public signup form. */
  delivery: {
    authUserId: string;
    phoneE164: string;
    messageType: string;
    channel: string;
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
  | "not_proven_delivered" | "stale_delivery";

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
  if (role !== null && role !== "vendor") {
    return { admitted: false, reason: "privileged_or_conflicting_role" };
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
  if (!DELIVERED.has(delivery.status)) {
    return { admitted: false, reason: "not_proven_delivered" };
  }
  const at = Date.parse(delivery.deliveredAt);
  if (!Number.isFinite(ev.nowMs) || !Number.isFinite(at) ||
      at > ev.nowMs + 30_000 || ev.nowMs - at > VENDOR_OTP_AUTH_MAX_AGE_MS) {
    return { admitted: false, reason: "stale_delivery" };
  }
  return { admitted: true };
}
