// ============================================================================
// QuickFurno — Identity Foundation: vendor password reset contracts (Phase 5E)
//
// PURE contracts for the three-step vendor password reset:
//   request (public, non-enumerating) → verify OTP (issues a grant) → complete.
//
// AUTHORITY BOUNDARIES (never merged)
//   • Supabase Auth is the ONLY password mutation authority. QuickFurno never
//     hashes a password, never writes auth.users, never touches
//     encrypted_password, and never uses generateLink as a second reset path.
//   • OTP verification authorizes a single-use RESET GRANT. It is NOT a login and
//     it establishes NO session. A completed reset does not sign anyone in — the
//     vendor must log in normally afterwards.
//
// The password never enters this module's persistence, logs, audit metadata, or
// error messages. Only its SHAPE is checked, and only before Supabase Auth runs.
// ============================================================================

// ----------------------------------------------------------------------------
// Public, deliberately non-enumerating request response
// ----------------------------------------------------------------------------
/**
 * The single outward status for EVERY reset request: unknown identifier, unknown
 * vendor mapping, inactive membership, unverified WhatsApp phone, WhatsApp OTP
 * disabled, a successful dispatch, and a provider refusal after an eligible
 * request all return exactly this. Nothing about account existence leaks.
 */
export const VENDOR_PASSWORD_RESET_REQUEST_STATUS = "request_received" as const;

export interface VendorPasswordResetRequestResponse {
  readonly ok: true;
  readonly status: typeof VENDOR_PASSWORD_RESET_REQUEST_STATUS;
  /**
   * An opaque handle the client passes to the verify step.
   *
   * For an ELIGIBLE request this is the real challenge id. For every ineligible
   * request it is a freshly generated, UNPERSISTED uuid — so the two responses
   * are byte-shape identical and a caller cannot learn whether an account exists.
   * Verifying against an unpersisted reference fails exactly like a wrong OTP.
   */
  readonly reference: string;
}

/** Build the one response every reset request returns. */
export function vendorPasswordResetRequestReceived(
  reference: string
): VendorPasswordResetRequestResponse {
  return Object.freeze({
    ok: true as const,
    status: VENDOR_PASSWORD_RESET_REQUEST_STATUS,
    reference,
  });
}

// ----------------------------------------------------------------------------
// One generic public failure for verify + complete
// ----------------------------------------------------------------------------
export const VENDOR_PASSWORD_RESET_FAILED_CODE = "VENDOR_PASSWORD_RESET_FAILED";
export const VENDOR_PASSWORD_RESET_FAILED_MESSAGE =
  "We could not complete that password reset. Please start again.";

// ----------------------------------------------------------------------------
// Sanitized audit classifications (never returned to a caller)
// ----------------------------------------------------------------------------
export const VendorPasswordResetFailureClassification = {
  INVALID_IDENTIFIER: "invalid_identifier",
  /** Two dashboard rows matched one identifier — never pick a winner. */
  AMBIGUOUS_IDENTITY: "ambiguous_identity",
  NO_VENDOR_MAPPING: "no_vendor_mapping",
  MEMBERSHIP_NOT_ACTIVE: "membership_not_active",
  NO_AUTH_USER: "no_auth_user",
  /** phone_e164 / phone_verified / whatsapp_otp_enabled / whatsapp_verified_at. */
  WHATSAPP_NOT_VERIFIED: "whatsapp_not_verified",
  WHATSAPP_OTP_DISABLED: "whatsapp_otp_disabled",
  SERVICE_UNAVAILABLE: "service_unavailable",
  PEPPER_NOT_CONFIGURED: "pepper_not_configured",
  RATE_LIMITED: "rate_limited",
  /** The atomic issuance authority refused (non-rate-limit reason). */
  CHALLENGE_ISSUE_FAILED: "challenge_issue_failed",
  DISPATCH_FAILED: "dispatch_failed",
  /** Provider accepted the OTP but the challenge→ledger link could not be written. */
  LINKAGE_FAILED: "linkage_failed",
  CHALLENGE_NOT_FOUND: "challenge_not_found",
  PURPOSE_MISMATCH: "purpose_mismatch",
  CHALLENGE_NOT_PENDING: "challenge_not_pending",
  CHALLENGE_EXPIRED: "challenge_expired",
  OTP_REJECTED: "otp_rejected",
  ATTESTATION_MISSING: "attestation_missing",
  GRANT_ISSUE_FAILED: "grant_issue_failed",
  INVALID_GRANT_TOKEN_SHAPE: "invalid_grant_token_shape",
  INVALID_PASSWORD_SHAPE: "invalid_password_shape",
  /** Not found, already consumed, revoked, or expired — indistinguishable outward. */
  GRANT_NOT_CLAIMABLE: "grant_not_claimable",
  /** Supabase Admin rejected the update. The grant stays consumed (burned). */
  AUTH_UPDATE_REJECTED: "auth_update_rejected",
  LOOKUP_FAILED: "lookup_failed",
} as const;

export type VendorPasswordResetFailureClassificationValue =
  (typeof VendorPasswordResetFailureClassification)[keyof typeof VendorPasswordResetFailureClassification];

// ----------------------------------------------------------------------------
// Narrow password preflight policy
// ----------------------------------------------------------------------------
/**
 * A PREFLIGHT shape check only, applied before Supabase Auth is called. Supabase
 * remains the final password authority (its own minimum length, leaked-password
 * checks, and policy configuration all still apply).
 *
 * The upper bound is 72 bytes because bcrypt silently truncates beyond that: a
 * longer password would give the user a false sense of strength.
 *
 * NOTHING about a rejected password is recorded — not its length, not its
 * content, not a strength score.
 */
export const VENDOR_PASSWORD_MIN_LENGTH = 8;
export const VENDOR_PASSWORD_MAX_BYTES = 72;

export type PasswordPolicyFailure =
  | "not_a_string"
  | "blank"
  | "too_short"
  | "too_long";

export type PasswordPolicyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: PasswordPolicyFailure };

/**
 * Validate the SHAPE of a proposed password. Never logs, never persists, never
 * returns any part of the value.
 */
export function checkVendorPasswordPolicy(password: unknown): PasswordPolicyResult {
  if (typeof password !== "string") return { ok: false, failure: "not_a_string" };
  if (password.trim().length === 0) return { ok: false, failure: "blank" };
  if (password.length < VENDOR_PASSWORD_MIN_LENGTH) return { ok: false, failure: "too_short" };
  // Byte length, not character count: a multibyte password can pass a char check
  // and still be truncated by bcrypt.
  if (Buffer.byteLength(password, "utf8") > VENDOR_PASSWORD_MAX_BYTES) {
    return { ok: false, failure: "too_long" };
  }
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Result shapes
// ----------------------------------------------------------------------------
/**
 * The plaintext grant token is returned EXACTLY ONCE, here, in request memory.
 * It is never logged, audited, placed in metadata or a correlation id, sent over
 * WhatsApp, or persisted — only its SHA-256 hash reaches the database.
 */
export interface VendorPasswordResetGrantIssued {
  readonly grantToken: string;
  readonly expiresAt: string;
}

/** A completed reset. Deliberately carries NO session and NO tokens. */
export interface VendorPasswordResetCompleted {
  readonly vendorId: string;
  readonly vendorDashboardUserId: string;
  /** Always true: the caller must now log in normally. No auto sign-in happens. */
  readonly loginRequired: true;
  readonly auditRecorded: boolean;
}
