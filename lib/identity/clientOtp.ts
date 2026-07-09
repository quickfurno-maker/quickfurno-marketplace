// ============================================================================
// QuickFurno — Identity Foundation: client WhatsApp OTP login contracts (Phase 5D)
//
// PURE contracts + helpers for the client login OTP request/verify flows. No
// Supabase client, no network, no OTP generation, no OTP storage. Supabase Auth
// owns OTP generation, validity, and verification; this module only shapes the
// request/verify surface and classifies failures for SANITIZED auditing.
//
// SECURITY RULES ENCODED HERE
//   • The OTP token is treated as an opaque short authentication secret. It is
//     never logged, never hashed/stored in QuickFurno, never placed in metadata,
//     an idempotency key, a correlation id, or a security event.
//   • Public responses do not enumerate whether a Supabase user exists.
//   • The only phone form that ever leaves this module is canonical E.164; a raw
//     phone is never returned in a public response.
// ============================================================================

import { normalizePhoneE164, type PhoneNormalization } from "../communication/phone";

// ----------------------------------------------------------------------------
// Public request response — deliberately non-enumerating
// ----------------------------------------------------------------------------
/**
 * The public status returned to an OTP requester. `OTP_REQUESTED` is returned for
 * BOTH an existing and a brand-new phone, and even when Supabase Auth returns an
 * error after we called it — so nothing about account existence leaks.
 */
export const ClientOtpRequestStatus = {
  /** signInWithOtp was invoked. Identical for existing and first-time numbers. */
  OTP_REQUESTED: "otp_requested",
  /** The phone was not a canonical international number (a format error, not enumeration). */
  INVALID_PHONE: "invalid_phone",
  /** The client login OTP path is not operationally enabled. A system state. */
  SERVICE_UNAVAILABLE: "service_unavailable",
} as const;

export type ClientOtpRequestStatusValue =
  (typeof ClientOtpRequestStatus)[keyof typeof ClientOtpRequestStatus];

export interface ClientOtpRequestResponse {
  /** True only for OTP_REQUESTED. Never reveals whether the account existed. */
  readonly ok: boolean;
  readonly status: ClientOtpRequestStatusValue;
}

// ----------------------------------------------------------------------------
// Internal audit classifications (never returned to an unauthenticated caller)
// ----------------------------------------------------------------------------
export const ClientOtpRequestFailureClassification = {
  INVALID_PHONE: "invalid_phone",
  SERVICE_UNAVAILABLE: "service_unavailable",
  /** signInWithOtp returned an error (raw Auth error is never persisted). */
  OTP_DISPATCH_REJECTED: "otp_dispatch_rejected",
} as const;

export type ClientOtpRequestFailureClassificationValue =
  (typeof ClientOtpRequestFailureClassification)[keyof typeof ClientOtpRequestFailureClassification];

export const ClientOtpVerifyFailureClassification = {
  INVALID_PHONE: "invalid_phone",
  INVALID_TOKEN_SHAPE: "invalid_token_shape",
  SERVICE_UNAVAILABLE: "service_unavailable",
  /** verifyOtp rejected the code (raw Auth error is never persisted). */
  OTP_REJECTED: "otp_rejected",
  /** verifyOtp returned no authenticated user. */
  NO_AUTH_USER: "no_auth_user",
  /** The Auth user's verified phone did not match the submitted phone. */
  AUTH_PHONE_MISMATCH: "auth_phone_mismatch",
  /** No matching recent QuickFurno WhatsApp communication attestation. */
  ATTESTATION_MISSING: "attestation_missing",
  /** A client identity conflict blocked provisioning. */
  IDENTITY_CONFLICT: "identity_conflict",
  /** The resolved/target client account is suspended or disabled. */
  ACCOUNT_NOT_ACTIVE: "account_not_active",
  /** A post-authentication lookup/provisioning failed unsafely. */
  PROVISIONING_FAILED: "provisioning_failed",
} as const;

export type ClientOtpVerifyFailureClassificationValue =
  (typeof ClientOtpVerifyFailureClassification)[keyof typeof ClientOtpVerifyFailureClassification];

// ----------------------------------------------------------------------------
// Public verify failure — one indistinguishable generic error
// ----------------------------------------------------------------------------
export const CLIENT_OTP_VERIFY_FAILED_CODE = "CLIENT_OTP_VERIFY_FAILED";
export const CLIENT_OTP_VERIFY_FAILED_MESSAGE = "We could not verify that code. Please try again.";

// ----------------------------------------------------------------------------
// Token handling — opaque short secret, never persisted
// ----------------------------------------------------------------------------
/** Supabase phone OTPs are short numeric-ish codes. Bounds only, never content. */
export const OTP_TOKEN_MIN_LENGTH = 4;
export const OTP_TOKEN_MAX_LENGTH = 12;

/**
 * Reject only empty/obviously malformed tokens before calling verifyOtp. This is
 * NOT a correctness check on the OTP (Supabase owns that) — it just avoids a
 * pointless round-trip and never inspects or records the value.
 */
export function isPlausibleOtpToken(token: unknown): token is string {
  if (typeof token !== "string") return false;
  const trimmed = token.trim();
  if (trimmed.length < OTP_TOKEN_MIN_LENGTH || trimmed.length > OTP_TOKEN_MAX_LENGTH) return false;
  return /^[0-9]+$/.test(trimmed);
}

// ----------------------------------------------------------------------------
// Phone helpers
// ----------------------------------------------------------------------------
/** UUID shape for a Supabase auth user id. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidShaped(value: unknown): value is string {
  return typeof value === "string" && UUID_SHAPE.test(value.trim());
}

/**
 * Normalize a phone that came back FROM Supabase Auth (verifyOtp's user.phone or
 * the Send SMS hook payload). Supabase stores the number as bare digits without a
 * leading '+', so a plain digit string is prefixed with '+' before it runs
 * through the ONE canonical E.164 normalizer. Anything already international
 * ('+...' / '00...') is normalized as-is. No country code is ever guessed.
 */
export function normalizeAuthProvidedPhone(raw: string | null | undefined): PhoneNormalization {
  if (typeof raw !== "string") return normalizePhoneE164(raw);
  const trimmed = raw.trim();
  if (trimmed !== "" && /^[0-9]+$/.test(trimmed)) {
    return normalizePhoneE164(`+${trimmed}`);
  }
  return normalizePhoneE164(trimmed);
}

// ----------------------------------------------------------------------------
// Attestation contract
// ----------------------------------------------------------------------------
/**
 * The communication lifecycle states that count as a successful WhatsApp delivery
 * for attestation. Any earlier/failed state (queued, dispatching, failed,
 * retry_scheduled, dead_letter, cancelled) can NEVER attest a login.
 */
export const ATTESTATION_SUCCESS_STATUSES: readonly string[] = Object.freeze([
  "accepted",
  "sent",
  "delivered",
  "read",
]);

export function isAttestationSuccessStatus(status: unknown): boolean {
  return typeof status === "string" && ATTESTATION_SUCCESS_STATUSES.includes(status);
}

/** How recent a communication attestation must be to belong to this login. */
export const ATTESTATION_MAX_AGE_MS = 15 * 60 * 1000;

/** True when `createdAt` is recent enough (and not in the future) to attest. */
export function isAttestationFresh(createdAt: string, nowMs: number = Date.now()): boolean {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  if (created > nowMs + 60 * 1000) return false; // small clock-skew tolerance
  return nowMs - created <= ATTESTATION_MAX_AGE_MS;
}
