/**
 * Pure, server-oriented purpose contract for Supabase's ONE phone Auth hook.
 * Purpose is NEVER supplied by or trusted from a signed hook's user_metadata.
 * A signed hook must claim an already-reserved, unique phone-digest purpose.
 */
export const AUTH_OTP_PURPOSE = Object.freeze({
  CLIENT_LOGIN: "client_login",
  VENDOR_LOGIN: "vendor_login",
} as const);
export type AuthOtpPurpose =
  (typeof AUTH_OTP_PURPOSE)[keyof typeof AUTH_OTP_PURPOSE];

export const AUTH_OTP_RESERVATION_TTL_SECONDS = 180;
export const AUTH_OTP_PHONE_RE = /^\+91[6-9]\d{9}$/;
export const AUTH_OTP_HEX_DIGEST_RE = /^[0-9a-f]{64}$/;

export function isAuthOtpPhone(value: unknown): value is string {
  return typeof value === "string" && AUTH_OTP_PHONE_RE.test(value);
}
export function isAuthOtpPurpose(value: unknown): value is AuthOtpPurpose {
  return value === AUTH_OTP_PURPOSE.CLIENT_LOGIN || value === AUTH_OTP_PURPOSE.VENDOR_LOGIN;
}
export function isAuthOtpReservationDigest(value: unknown): value is string {
  return typeof value === "string" && AUTH_OTP_HEX_DIGEST_RE.test(value);
}

/** An empty, invalid or unknown claim is never treated as a default client OTP. */
export function parseClaimedAuthOtpPurpose(value: unknown): AuthOtpPurpose | null {
  return isAuthOtpPurpose(value) ? value : null;
}
