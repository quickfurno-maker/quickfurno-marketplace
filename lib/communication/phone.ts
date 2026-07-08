// ============================================================================
// QuickFurno — lib/communication/phone.ts
//
// The ONE canonical phone normalization helper for the communication core.
// Every destination hash and every destination mask is derived from the value
// produced here, so two logically identical numbers always hash identically.
//
// Deliberate non-goals (security review, Phase 5B):
//   • NO country guessing. A bare national number ("9876543210") is REJECTED
//     rather than silently prefixed with a default country code — guessing
//     would let a formatting slip route an OTP to the wrong country.
//   • NO plaintext persistence. Callers hash/mask the normalized value; the
//     normalized value itself is never written to communication_messages.
// ============================================================================

import crypto from "crypto";
import { AppError } from "../errors";

/** Shortest total digit count we accept for an international number. */
export const E164_MIN_DIGITS = 8;
/** E.164 hard limit: country code + national number never exceeds 15 digits. */
export const E164_MAX_DIGITS = 15;

export type PhoneNormalizationErrorCode =
  | "PHONE_EMPTY"
  | "PHONE_MISSING_COUNTRY_CODE"
  | "PHONE_INVALID_CHARACTERS"
  | "PHONE_INVALID_COUNTRY_CODE"
  | "PHONE_TOO_SHORT"
  | "PHONE_TOO_LONG";

export type PhoneNormalization =
  | { readonly ok: true; readonly e164: string }
  | { readonly ok: false; readonly code: PhoneNormalizationErrorCode };

const PHONE_ERROR_MESSAGES: Record<PhoneNormalizationErrorCode, string> = {
  PHONE_EMPTY: "Phone number is empty.",
  PHONE_MISSING_COUNTRY_CODE:
    "Phone number must be international (start with '+' or '00'). Local numbers are never assumed to belong to a default country.",
  PHONE_INVALID_CHARACTERS: "Phone number contains characters that are not digits or safe formatting.",
  PHONE_INVALID_COUNTRY_CODE: "Phone number country code must not start with 0.",
  PHONE_TOO_SHORT: `Phone number has fewer than ${E164_MIN_DIGITS} digits.`,
  PHONE_TOO_LONG: `Phone number has more than ${E164_MAX_DIGITS} digits.`,
};

/**
 * Formatting characters that carry no information and are safe to strip:
 * ASCII/Unicode spaces, hyphen-likes, parentheses, dots and slashes.
 * (  no-break space, ‐-― dashes, − minus sign.)
 */
const SAFE_FORMATTING_CHARACTERS = /[\s ().\/‐-―−-]/g;

export function phoneNormalizationError(code: PhoneNormalizationErrorCode): AppError {
  return new AppError(code, PHONE_ERROR_MESSAGES[code]);
}

/**
 * Normalize any safely-formatted international phone number to canonical E.164
 * (`+` followed by 8–15 digits). Accepts `+91 98765-43210`, `+91 (98765) 43210`
 * and `0091 98765 43210`; rejects anything that would require guessing a
 * country code. Pure and deterministic — no I/O, no clock, no randomness.
 */
export function normalizePhoneE164(raw: string | null | undefined): PhoneNormalization {
  if (typeof raw !== "string") return { ok: false, code: "PHONE_EMPTY" };

  const stripped = raw.replace(SAFE_FORMATTING_CHARACTERS, "");
  if (stripped.length === 0) return { ok: false, code: "PHONE_EMPTY" };

  let digits: string;
  if (stripped.startsWith("+")) {
    digits = stripped.slice(1);
  } else if (stripped.startsWith("00")) {
    // International call prefix — an explicit country code follows.
    digits = stripped.slice(2);
  } else {
    return { ok: false, code: "PHONE_MISSING_COUNTRY_CODE" };
  }

  if (digits.length === 0) return { ok: false, code: "PHONE_EMPTY" };
  if (!/^[0-9]+$/.test(digits)) return { ok: false, code: "PHONE_INVALID_CHARACTERS" };
  if (digits.startsWith("0")) return { ok: false, code: "PHONE_INVALID_COUNTRY_CODE" };
  if (digits.length < E164_MIN_DIGITS) return { ok: false, code: "PHONE_TOO_SHORT" };
  if (digits.length > E164_MAX_DIGITS) return { ok: false, code: "PHONE_TOO_LONG" };

  return { ok: true, e164: `+${digits}` };
}

/** True when `raw` already is (or normalizes to) a canonical E.164 number. */
export function isNormalizablePhone(raw: string | null | undefined): boolean {
  return normalizePhoneE164(raw).ok;
}

/**
 * Normalize then SHA-256 hash. Logically identical numbers always produce the
 * same hash. Throws `AppError` on an invalid number — callers that must degrade
 * gracefully should call {@link normalizePhoneE164} first.
 */
export function hashPhoneE164(raw: string): string {
  const normalized = normalizePhoneE164(raw);
  if (!normalized.ok) throw phoneNormalizationError(normalized.code);
  return crypto.createHash("sha256").update(normalized.e164).digest("hex");
}

/**
 * Normalize then mask for display/audit: keeps the country code and the last
 * four digits (`+919876543210` → `+91******3210`). Throws on invalid input.
 */
export function maskPhoneE164(raw: string): string {
  const normalized = normalizePhoneE164(raw);
  if (!normalized.ok) throw phoneNormalizationError(normalized.code);

  const digits = normalized.e164.slice(1);
  if (digits.length <= 4) return "****";

  const last4 = digits.slice(-4);
  // Everything beyond the trailing 10 national digits is treated as the country
  // code. Never reveals more than the leading country code + trailing 4 digits.
  const countryCodeLength = digits.length - 10;
  const prefix = countryCodeLength > 0 ? `+${digits.slice(0, countryCodeLength)}` : "";
  return `${prefix}******${last4}`;
}
