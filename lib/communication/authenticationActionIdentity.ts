// ============================================================================
// QuickFurno — lib/communication/authenticationActionIdentity.ts  (Phase 5F-C1)
//
// The DETERMINISTIC, DOMAIN-SEPARATED identity of ONE authentication delivery action.
//
// WHY A HASH AND NOT A SHAPE CHECK
//   An earlier revision stored the raw authoritative action id and constrained it with
//   `^[A-Za-z0-9_.:-]{1,128}$`. That pattern happily accepts `483920` and
//   `919876543210` — it never structurally prevented an OTP or a phone number from
//   being persisted as the action identity. A blacklist can never prove that negative.
//   So the ledger stores a SHA-256 digest instead: a 64-character lowercase hex string
//   is, by construction, not an OTP, not a phone number, and not a raw payload.
//
// WHAT THIS VALUE IS
//   A stable, non-secret IDENTIFIER derived only from an authoritative SERVER-SIDE
//   action identifier. It is deterministic: the same action always derives the same id,
//   so a replay of one verified action is idempotent, while two distinct login actions
//   by the same user derive different ids.
//
// WHAT THIS VALUE IS NOT
//   Not an OTP hash. Not a phone hash. Not a destination identity. Not an
//   authentication proof. Not a password-reset token. It authorizes nothing, and
//   possessing it grants nothing.
//
// SECURITY OF THE DERIVATION
//   Domain separation ("qf-auth-action:v1"), then the auth flow, then the source kind,
//   then the authoritative id — each separated by a NUL byte, which the source id may
//   never contain. So no two distinct (flow, source kind, id) triples can ever collide
//   by concatenation ambiguity.
//
//   There is deliberately NO HMAC key, NO salt, NO clock, NO environment access and NO
//   randomness: this is stable identifier derivation, not authentication and not
//   confidentiality. A keyed construction would make the id unreproducible across a key
//   rotation, and would imply a secrecy property this value does not have and must not
//   be relied upon for.
//
// The input NEVER comes from an OTP, a phone number, a destination hash, a password, a
// session token, an access token, a provider credential, or a raw request body.
// ============================================================================

import crypto from "crypto";
import { KNOWN_AUTH_FLOWS, type AuthFlowValue } from "../identity/authTransport";

/** Bumping this deliberately re-derives every action id (a new identity namespace). */
export const AUTH_ACTION_ID_DOMAIN = "qf-auth-action:v1";
export const AUTH_ACTION_ID_ALGORITHM = "sha256";
/** SHA-256 rendered as lowercase hex — exactly 64 characters. */
export const AUTH_ACTION_ID_PATTERN = /^[0-9a-f]{64}$/;
export const AUTH_ACTION_ID_LENGTH = 64;

/** The NUL separator. An authoritative id may never contain a control character. */
const FIELD_SEPARATOR = "\0";

/**
 * The CLOSED vocabulary of places an authoritative action identifier may come from.
 * Anything else is not an authentication action and cannot derive an identity.
 */
export const AuthActionSourceKind = {
  /** The SIGNATURE-VERIFIED Supabase Standard Webhooks `webhook-id`. */
  SUPABASE_WEBHOOK: "supabase_webhook",
  /** A server-created `verification_challenges.id`. */
  VERIFICATION_CHALLENGE: "verification_challenge",
} as const;

export type AuthActionSourceKindValue =
  (typeof AuthActionSourceKind)[keyof typeof AuthActionSourceKind];

export const KNOWN_AUTH_ACTION_SOURCE_KINDS: readonly AuthActionSourceKindValue[] =
  Object.freeze(Object.values(AuthActionSourceKind));

export function isAuthActionSourceKind(value: unknown): value is AuthActionSourceKindValue {
  return typeof value === "string" && (KNOWN_AUTH_ACTION_SOURCE_KINDS as string[]).includes(value);
}

// ----------------------------------------------------------------------------
// The branded identity
// ----------------------------------------------------------------------------
declare const authenticationActionIdBrand: unique symbol;

/**
 * A 64-character lowercase hex SHA-256 action identity. The brand means a caller cannot
 * hand a raw webhook id, a challenge id, an OTP, or a phone number to a service that
 * expects an action identity: it must go through {@link deriveAuthenticationActionId}
 * or be validated by {@link asAuthenticationActionId}.
 */
export type AuthenticationActionId = string & { readonly [authenticationActionIdBrand]: true };

export function isAuthenticationActionId(value: unknown): value is AuthenticationActionId {
  return typeof value === "string" && AUTH_ACTION_ID_PATTERN.test(value);
}

/** Validate an already-derived identity. Returns null for anything malformed. */
export function asAuthenticationActionId(value: unknown): AuthenticationActionId | null {
  return isAuthenticationActionId(value) ? value : null;
}

// ----------------------------------------------------------------------------
// Derivation
// ----------------------------------------------------------------------------
export const AuthActionIdentityError = {
  UNKNOWN_AUTH_FLOW: "AUTH_ACTION_UNKNOWN_AUTH_FLOW",
  UNKNOWN_SOURCE_KIND: "AUTH_ACTION_UNKNOWN_SOURCE_KIND",
  INVALID_SOURCE_ID: "AUTH_ACTION_INVALID_SOURCE_ID",
} as const;

export type AuthActionIdentityErrorValue =
  (typeof AuthActionIdentityError)[keyof typeof AuthActionIdentityError];

export interface AuthenticationActionIdentityInput {
  readonly authFlow: AuthFlowValue;
  readonly sourceKind: AuthActionSourceKindValue;
  /**
   * The authoritative SERVER-SIDE action identifier:
   *   • `supabase_webhook`       — the `webhook-id` of a SIGNATURE-VERIFIED hook request.
   *                                Never an arbitrary browser-supplied value.
   *   • `verification_challenge` — a server-created `verification_challenges.id`.
   * Never an OTP, phone, destination, password, token, credential, or request body.
   */
  readonly authoritativeActionId: string;
}

/** Printable ASCII, no space, no control character (so no NUL can forge a separator). */
const SOURCE_ID_PATTERN = /^[\x21-\x7e]{1,256}$/;

function reject(code: AuthActionIdentityErrorValue): never {
  // Carries only a stable code — never the offending value, which could be sensitive.
  const error = new Error(code);
  error.name = "AuthActionIdentityError";
  throw error;
}

/**
 * PURE. Derive the deterministic action identity. No clock, no randomness, no
 * environment, no key. The same (flow, source kind, authoritative id) always yields the
 * same 64-character lowercase hex digest; any difference in any field yields a different
 * one, because the fields are domain-separated by a byte the source id cannot contain.
 */
export function deriveAuthenticationActionId(
  input: AuthenticationActionIdentityInput
): AuthenticationActionId {
  if (!(KNOWN_AUTH_FLOWS as readonly string[]).includes(input.authFlow)) {
    reject(AuthActionIdentityError.UNKNOWN_AUTH_FLOW);
  }
  if (!isAuthActionSourceKind(input.sourceKind)) {
    reject(AuthActionIdentityError.UNKNOWN_SOURCE_KIND);
  }
  const sourceId = typeof input.authoritativeActionId === "string" ? input.authoritativeActionId.trim() : "";
  if (!SOURCE_ID_PATTERN.test(sourceId)) {
    reject(AuthActionIdentityError.INVALID_SOURCE_ID);
  }

  const canonical = [AUTH_ACTION_ID_DOMAIN, input.authFlow, input.sourceKind, sourceId].join(
    FIELD_SEPARATOR
  );
  return crypto
    .createHash(AUTH_ACTION_ID_ALGORITHM)
    .update(canonical, "utf8")
    .digest("hex") as AuthenticationActionId;
}

/** Non-throwing variant for boundaries that must fail closed rather than raise. */
export function tryDeriveAuthenticationActionId(
  input: AuthenticationActionIdentityInput
): AuthenticationActionId | null {
  try {
    return deriveAuthenticationActionId(input);
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Convenience derivations — the ONLY authoritative sources this phase recognises
// ----------------------------------------------------------------------------

/**
 * `client_login_otp`. `verifiedWebhookId` MUST come from the signature-verified server
 * side of the Supabase Send SMS hook (the `webhook-id` header of a request whose
 * Standard Webhooks signature already validated). A browser-supplied webhook id is
 * never authority.
 */
export function deriveClientLoginActionId(verifiedWebhookId: string): AuthenticationActionId {
  return deriveAuthenticationActionId({
    authFlow: "client_login_otp",
    sourceKind: AuthActionSourceKind.SUPABASE_WEBHOOK,
    authoritativeActionId: verifiedWebhookId,
  });
}

/** `vendor_whatsapp_verify` — a server-created `verification_challenges.id`. */
export function deriveVendorWhatsAppVerifyActionId(challengeId: string): AuthenticationActionId {
  return deriveAuthenticationActionId({
    authFlow: "vendor_whatsapp_verify",
    sourceKind: AuthActionSourceKind.VERIFICATION_CHALLENGE,
    authoritativeActionId: challengeId,
  });
}

/** `vendor_password_reset` — a server-created `verification_challenges.id`. */
export function deriveVendorPasswordResetActionId(challengeId: string): AuthenticationActionId {
  return deriveAuthenticationActionId({
    authFlow: "vendor_password_reset",
    sourceKind: AuthActionSourceKind.VERIFICATION_CHALLENGE,
    authoritativeActionId: challengeId,
  });
}
