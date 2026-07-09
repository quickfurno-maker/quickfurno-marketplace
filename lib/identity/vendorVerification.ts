// ============================================================================
// QuickFurno — Identity Foundation: vendor challenge contracts (Phase 5E)
//
// PURE contracts shared by BOTH vendor auth challenge purposes (WhatsApp identity
// verification and password reset): lifetimes, rate limits, the communication
// delivery attestation rule, and the sanitized failure vocabulary.
//
// No Supabase client, no network, no OTP generation (see vendorOtpCrypto.ts), no
// challenge persistence (see services/vendorAuthChallengeService.ts).
//
// THREE VENDOR SECURITY CONCERNS STAY DISTINCT (never merge them):
//   • vendor LOGIN                = Supabase Auth + vendor_dashboard_users mapping
//   • vendor WHATSAPP VERIFICATION = purpose-bound challenge + phone_e164 binding
//   • vendor PASSWORD RESET        = purpose-bound challenge + single-use grant
// A vendor may log in while phone_verified is false. Verification is never a
// login credential, and a reset grant is never a session.
// ============================================================================

import { VerificationPurpose, type VerificationPurposeValue } from "./verification";

// ----------------------------------------------------------------------------
// Lifetimes and rate limits (server-side, persisted history only)
// ----------------------------------------------------------------------------
/** How long an issued OTP challenge stays usable. */
export const VENDOR_OTP_TTL_MS = 10 * 60 * 1000;

/** Wrong-OTP attempts before the challenge is LOCKED (terminal). */
export const VENDOR_OTP_MAX_ATTEMPTS = 5;

/** Minimum wait between two challenge issuances for one identity + purpose. */
export const VENDOR_CHALLENGE_COOLDOWN_MS = 60 * 1000;

/** Rolling-window issuance ceilings per (vendor dashboard identity, purpose). */
export const VENDOR_CHALLENGES_PER_HOUR = 5;
export const VENDOR_CHALLENGES_PER_DAY = 12;
export const VENDOR_RATE_WINDOW_HOUR_MS = 60 * 60 * 1000;
export const VENDOR_RATE_WINDOW_DAY_MS = 24 * 60 * 60 * 1000;

/** How long a single-use password reset grant stays claimable. */
export const RESET_GRANT_TTL_MS = 10 * 60 * 1000;

export const VendorRateLimitScope = {
  COOLDOWN: "cooldown",
  HOURLY: "hourly",
  DAILY: "daily",
} as const;

export type VendorRateLimitScopeValue =
  (typeof VendorRateLimitScope)[keyof typeof VendorRateLimitScope];

export type VendorRateLimitDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly scope: VendorRateLimitScopeValue };

/**
 * Evaluate the issuance rate limits against PERSISTED challenge history. Pure:
 * the caller supplies the `created_at` timestamps it read from the database, so a
 * browser counter can never influence the decision.
 */
export function evaluateChallengeRateLimit(
  createdAtIsoList: readonly string[],
  nowMs: number = Date.now()
): VendorRateLimitDecision {
  let withinCooldown = 0;
  let withinHour = 0;
  let withinDay = 0;

  for (const iso of createdAtIsoList) {
    const created = Date.parse(iso);
    if (Number.isNaN(created)) continue;
    const age = nowMs - created;
    if (age < 0) continue; // a future-dated row never relaxes a limit
    if (age < VENDOR_CHALLENGE_COOLDOWN_MS) withinCooldown += 1;
    if (age < VENDOR_RATE_WINDOW_HOUR_MS) withinHour += 1;
    if (age < VENDOR_RATE_WINDOW_DAY_MS) withinDay += 1;
  }

  if (withinCooldown > 0) return { ok: false, scope: VendorRateLimitScope.COOLDOWN };
  if (withinHour >= VENDOR_CHALLENGES_PER_HOUR) return { ok: false, scope: VendorRateLimitScope.HOURLY };
  if (withinDay >= VENDOR_CHALLENGES_PER_DAY) return { ok: false, scope: VendorRateLimitScope.DAILY };
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Challenge expiry (authentication safety never depends on a cleanup job)
// ----------------------------------------------------------------------------
/** True when a challenge's `expires_at` has passed. Unparseable → treated expired. */
export function isChallengeExpired(expiresAtIso: string, nowMs: number = Date.now()): boolean {
  const expires = Date.parse(expiresAtIso);
  if (Number.isNaN(expires)) return true; // fail closed
  return expires <= nowMs;
}

/** The `expires_at` a freshly issued challenge carries. */
export function challengeExpiryIso(nowMs: number = Date.now()): string {
  return new Date(nowMs + VENDOR_OTP_TTL_MS).toISOString();
}

/** The `expires_at` a freshly issued reset grant carries. */
export function resetGrantExpiryIso(nowMs: number = Date.now()): string {
  return new Date(nowMs + RESET_GRANT_TTL_MS).toISOString();
}

// ----------------------------------------------------------------------------
// Communication delivery attestation
// ----------------------------------------------------------------------------
/**
 * The `communication_messages.entity_type` every vendor auth OTP message carries.
 * The ledger row is bound to the CHALLENGE, not to a vendor or a phone number.
 */
export const VENDOR_CHALLENGE_ENTITY_TYPE = "verification_challenge";

/**
 * Lifecycle states that count as a successful WhatsApp delivery. Any earlier or
 * failed state (queued, dispatching, failed, retry_scheduled, dead_letter,
 * cancelled) can NEVER attest a verification.
 */
export const VENDOR_ATTESTATION_SUCCESS_STATUSES: readonly string[] = Object.freeze([
  "accepted",
  "sent",
  "delivered",
  "read",
]);

export function isVendorAttestationSuccessStatus(status: unknown): boolean {
  return typeof status === "string" && VENDOR_ATTESTATION_SUCCESS_STATUSES.includes(status);
}

/**
 * An attestation may not outlive the challenge it delivered. Using the OTP TTL
 * keeps the two windows aligned: a message older than the code it carried cannot
 * prove this attempt.
 */
export const VENDOR_ATTESTATION_MAX_AGE_MS = VENDOR_OTP_TTL_MS;

/** True when `createdAt` is recent enough (and not implausibly future) to attest. */
export function isVendorAttestationFresh(createdAt: string, nowMs: number = Date.now()): boolean {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  if (created > nowMs + 60 * 1000) return false; // small clock-skew tolerance
  return nowMs - created <= VENDOR_ATTESTATION_MAX_AGE_MS;
}

// ----------------------------------------------------------------------------
// One generic public failure per flow (never enumerating, never diagnostic)
// ----------------------------------------------------------------------------
export const VENDOR_WHATSAPP_VERIFY_FAILED_CODE = "VENDOR_WHATSAPP_VERIFY_FAILED";
export const VENDOR_WHATSAPP_VERIFY_FAILED_MESSAGE =
  "We could not verify that code. Please try again.";

export const VENDOR_WHATSAPP_REQUEST_FAILED_CODE = "VENDOR_WHATSAPP_REQUEST_FAILED";
export const VENDOR_WHATSAPP_REQUEST_FAILED_MESSAGE =
  "We could not start WhatsApp verification. Please try again.";

// ----------------------------------------------------------------------------
// Sanitized audit classifications (never returned to a caller)
// ----------------------------------------------------------------------------
export const VendorVerificationFailureClassification = {
  NOT_AUTHENTICATED: "not_authenticated",
  NO_VENDOR_ACCESS: "no_vendor_access",
  INVALID_PHONE: "invalid_phone",
  /** A bare national number: we refuse to guess a country code. */
  AMBIGUOUS_LOCAL_PHONE: "ambiguous_local_phone",
  SERVICE_UNAVAILABLE: "service_unavailable",
  PEPPER_NOT_CONFIGURED: "pepper_not_configured",
  RATE_LIMITED: "rate_limited",
  /** The atomic issuance authority refused (lineage/membership/purpose/other). */
  ISSUE_FAILED: "issue_failed",
  DISPATCH_FAILED: "dispatch_failed",
  /** Provider accepted the OTP but the challenge→ledger link could not be written. */
  LINKAGE_FAILED: "linkage_failed",
  CHALLENGE_NOT_FOUND: "challenge_not_found",
  CHALLENGE_OWNERSHIP_MISMATCH: "challenge_ownership_mismatch",
  PURPOSE_MISMATCH: "purpose_mismatch",
  CHALLENGE_NOT_PENDING: "challenge_not_pending",
  CHALLENGE_EXPIRED: "challenge_expired",
  CHALLENGE_LOCKED: "challenge_locked",
  DESTINATION_MISMATCH: "destination_mismatch",
  INVALID_OTP_SHAPE: "invalid_otp_shape",
  OTP_REJECTED: "otp_rejected",
  ATTESTATION_MISSING: "attestation_missing",
  PHONE_OWNERSHIP_CONFLICT: "phone_ownership_conflict",
  CONSUME_FAILED: "consume_failed",
} as const;

export type VendorVerificationFailureClassificationValue =
  (typeof VendorVerificationFailureClassification)[keyof typeof VendorVerificationFailureClassification];

// ----------------------------------------------------------------------------
// Sanitized success shape returned to the authenticated vendor
// ----------------------------------------------------------------------------
/** Carries no OTP, no hash, no pepper, and no plaintext phone — only a mask. */
export interface VendorWhatsappVerificationResult {
  readonly vendorDashboardUserId: string;
  readonly vendorId: string;
  readonly authUserId: string;
  readonly phoneMasked: string;
  readonly phoneVerified: true;
  readonly whatsappOtpEnabled: true;
  readonly whatsappVerifiedAt: string;
  /** False when the success audit write failed; the verification still happened. */
  readonly auditRecorded: boolean;
}

/** Public, non-secret handle returned by a verification REQUEST. */
export interface VendorChallengeIssued {
  readonly ok: true;
  readonly challengeId: string;
  readonly expiresAt: string;
  readonly phoneMasked: string;
}

/** The purposes this module governs. Re-exported so callers use one vocabulary. */
export const VENDOR_AUTH_PURPOSES: readonly VerificationPurposeValue[] = Object.freeze([
  VerificationPurpose.VENDOR_WHATSAPP_VERIFY,
  VerificationPurpose.VENDOR_PASSWORD_RESET,
]);
