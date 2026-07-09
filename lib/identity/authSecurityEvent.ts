// ============================================================================
// QuickFurno — Identity Foundation: auth/security event contracts (Phase 5A)
//
// Append-oriented authentication/security audit contract, kept SEPARATE from the
// Phase 4 business policy decision logs. Phase 5A establishes the contract +
// persistence readiness only; it does not emit every event yet.
//
// Security rule: security-event metadata must NEVER contain plaintext OTPs,
// passwords, reset tokens, access/refresh tokens, service-role keys, provider
// secrets, or full sensitive provider payloads. `sanitizeAuthSecurityMetadata`
// is the sanctioned way to build metadata and strips any secret-looking key.
// ============================================================================

import type { PrincipalTypeValue } from "./principal";
import type { VerificationPurposeValue } from "./verification";

/** Authentication/security event types the log is designed to carry. */
export const AuthSecurityEventType = {
  VENDOR_LOGIN_SUCCESS: "vendor.login_success",
  VENDOR_LOGIN_FAILED: "vendor.login_failed",
  VENDOR_WHATSAPP_VERIFICATION_REQUESTED: "vendor.whatsapp_verification_requested",
  VENDOR_WHATSAPP_VERIFIED: "vendor.whatsapp_verified",
  // Phase 5E — the two failure counterparts the existing vocabulary lacked. Both
  // carry ONLY a sanitized classification, a destination hash, and a challenge id;
  // never an OTP, OTP hash, pepper, password, grant token, or raw Auth error.
  VENDOR_WHATSAPP_VERIFICATION_FAILED: "vendor.whatsapp_verification_failed",
  VENDOR_PASSWORD_RESET_REQUESTED: "vendor.password_reset_requested",
  VENDOR_PASSWORD_RESET_OTP_FAILED: "vendor.password_reset_otp_failed",
  VENDOR_PASSWORD_RESET_FAILED: "vendor.password_reset_failed",
  VENDOR_PASSWORD_RESET_COMPLETED: "vendor.password_reset_completed",
  CLIENT_OTP_REQUESTED: "client.otp_requested",
  // Phase 5D — safe failure auditing for the client WhatsApp OTP login flow.
  // Both carry ONLY sanitized classifications + a destination hash; never an OTP,
  // token, raw phone, raw Auth error, hook body, signature, or session token.
  CLIENT_OTP_REQUEST_FAILED: "client.otp_request_failed",
  CLIENT_OTP_VERIFY_FAILED: "client.otp_verify_failed",
  CLIENT_LOGIN_SUCCESS: "client.login_success",
  AUTH_RATE_LIMIT_TRIGGERED: "auth.rate_limit_triggered",
  AUTH_CHALLENGE_EXPIRED: "auth.challenge_expired",
} as const;

export type AuthSecurityEventTypeValue =
  (typeof AuthSecurityEventType)[keyof typeof AuthSecurityEventType];

export const KNOWN_AUTH_SECURITY_EVENT_TYPES: readonly AuthSecurityEventTypeValue[] =
  Object.freeze(Object.values(AuthSecurityEventType));

export function isAuthSecurityEventType(value: unknown): value is AuthSecurityEventTypeValue {
  return (
    typeof value === "string" && (KNOWN_AUTH_SECURITY_EVENT_TYPES as string[]).includes(value)
  );
}

/**
 * Keys that must never appear in security-event metadata. Matches plaintext OTP,
 * password, reset/access/refresh tokens, secrets, provider keys, credentials, and
 * raw provider payloads (case-insensitive, dash/underscore tolerant).
 */
const FORBIDDEN_METADATA_KEY_PATTERN =
  /(^|[_-])(otp|password|passcode|pin|secret|token|refresh|access[_-]?token|service[_-]?role|api[_-]?key|apikey|authorization|auth[_-]?header|credential|provider[_-]?secret|provider[_-]?payload|plaintext|raw[_-]?payload|whatsapp[_-]?secret|bearer|session[_-]?token)($|[_-])/i;

export function isForbiddenSecurityMetadataKey(key: string): boolean {
  // Non-reversible hash references (e.g. otp_hash, destination_hash,
  // grant_token_hash) are permitted — only PLAINTEXT secrets are forbidden.
  if (/(^|[_-])hash$/i.test(key)) return false;
  return FORBIDDEN_METADATA_KEY_PATTERN.test(key);
}

/** True when any (possibly nested) key in the value looks like a secret. */
export function containsForbiddenSecurityKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenSecurityKey);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, nested]) => isForbiddenSecurityMetadataKey(key) || containsForbiddenSecurityKey(nested),
    );
  }
  return false;
}

/**
 * Return a sanitized deep copy of metadata with any secret-looking key removed
 * entirely (the value is never stored — not masked, dropped). Use this to build
 * `auth_security_events.metadata` before persistence. It never throws and always
 * returns a plain object.
 */
export function sanitizeAuthSecurityMetadata(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return sanitizeObject(input) as Record<string, unknown>;
}

function sanitizeObject(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isForbiddenSecurityMetadataKey(key)) continue; // drop secret-looking keys
    out[key] = sanitizeValue(nested);
  }
  return out;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    return sanitizeObject(value as Record<string, unknown>);
  }
  return value;
}

/**
 * Immutable auth security event contract mirroring public.auth_security_events.
 * Server-only. `principalId` / `actorUserId` are polymorphic identity references;
 * `metadata` must already be sanitized via `sanitizeAuthSecurityMetadata`.
 */
export interface AuthSecurityEvent {
  readonly id: string;
  readonly eventType: string;
  readonly principalType: PrincipalTypeValue | null;
  readonly principalId: string | null;
  readonly actorUserId: string | null;
  readonly purpose: VerificationPurposeValue | null;
  readonly correlationId: string | null;
  readonly destinationHash: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}
