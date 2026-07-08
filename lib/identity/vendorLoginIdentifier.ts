// ============================================================================
// QuickFurno — Identity Foundation: vendor login identifier (Phase 5C)
//
// Canonicalizes the identifier a vendor types into the login form, and produces
// the deterministic, non-reversible hash used for FAILED-login audit correlation
// when no auth user id is known.
//
// SECURITY RULES ENCODED HERE
//   • A raw login identifier is NEVER persisted. Only `hashVendorLoginIdentifier`
//     output reaches auth_security_events.
//   • Phone numbers reuse the Phase 5B canonical E.164 normalization, so a phone
//     identifier hash is byte-identical to the Phase 5B `destination_hash` for
//     the same number — audit rows correlate across phases for free.
//   • Local/ambiguous phone numbers are REJECTED. No country code is ever
//     guessed: a slipped digit must not authenticate a different country's user.
//   • Passwords never enter this module.
// ============================================================================

import crypto from "crypto";
import { normalizePhoneE164 } from "../communication/phone";

export type VendorLoginIdentifierKind = "email" | "phone";

export interface VendorLoginIdentifier {
  readonly kind: VendorLoginIdentifierKind;
  /** Comparison form: lowercased+trimmed email, or canonical E.164 phone. */
  readonly canonical: string;
}

export const VendorLoginIdentifierError = {
  LOGIN_IDENTIFIER_EMPTY: "LOGIN_IDENTIFIER_EMPTY",
  LOGIN_IDENTIFIER_INVALID_EMAIL: "LOGIN_IDENTIFIER_INVALID_EMAIL",
  /** A bare national number. We refuse to guess which country it belongs to. */
  LOGIN_IDENTIFIER_AMBIGUOUS_LOCAL_PHONE: "LOGIN_IDENTIFIER_AMBIGUOUS_LOCAL_PHONE",
  LOGIN_IDENTIFIER_INVALID_PHONE: "LOGIN_IDENTIFIER_INVALID_PHONE",
} as const;

export type VendorLoginIdentifierErrorCode =
  (typeof VendorLoginIdentifierError)[keyof typeof VendorLoginIdentifierError];

export type VendorLoginIdentifierNormalization =
  | { readonly ok: true; readonly identifier: VendorLoginIdentifier }
  | { readonly ok: false; readonly code: VendorLoginIdentifierErrorCode };

/** RFC-length cap; conservative shape check. Supabase Auth is the real authority. */
const MAX_EMAIL_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A 64-char lowercase hex SHA-256 digest. */
const IDENTIFIER_HASH_SHAPE = /^[a-f0-9]{64}$/;

/**
 * Which identifier style the user typed. An `@` means email; everything else is
 * treated as a phone attempt (and must then normalize to E.164 or be rejected).
 */
export function classifyVendorLoginIdentifier(raw: string): VendorLoginIdentifierKind | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed === "") return null;
  return trimmed.includes("@") ? "email" : "phone";
}

/**
 * Canonicalize an email for comparison: trim + lowercase.
 *
 * Deliberately does NOT strip dots or `+tags` — that is Gmail-specific folding
 * and would silently merge distinct identities on other providers.
 */
function normalizeEmail(raw: string): VendorLoginIdentifierNormalization {
  const canonical = raw.trim().toLowerCase();
  if (canonical.length === 0) {
    return { ok: false, code: VendorLoginIdentifierError.LOGIN_IDENTIFIER_EMPTY };
  }
  if (canonical.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(canonical)) {
    return { ok: false, code: VendorLoginIdentifierError.LOGIN_IDENTIFIER_INVALID_EMAIL };
  }
  return { ok: true, identifier: { kind: "email", canonical } };
}

function normalizePhone(raw: string): VendorLoginIdentifierNormalization {
  const normalized = normalizePhoneE164(raw);
  if (normalized.ok) {
    return { ok: true, identifier: { kind: "phone", canonical: normalized.e164 } };
  }
  if (normalized.code === "PHONE_EMPTY") {
    return { ok: false, code: VendorLoginIdentifierError.LOGIN_IDENTIFIER_EMPTY };
  }
  if (normalized.code === "PHONE_MISSING_COUNTRY_CODE") {
    // "9876543210" could belong to any country. Refuse rather than assume one.
    return { ok: false, code: VendorLoginIdentifierError.LOGIN_IDENTIFIER_AMBIGUOUS_LOCAL_PHONE };
  }
  return { ok: false, code: VendorLoginIdentifierError.LOGIN_IDENTIFIER_INVALID_PHONE };
}

/**
 * Normalize whatever the vendor typed into a canonical, comparable identifier.
 * Pure and deterministic — no clock, no randomness, no I/O.
 */
export function normalizeVendorLoginIdentifier(
  raw: string | null | undefined
): VendorLoginIdentifierNormalization {
  if (typeof raw !== "string") {
    return { ok: false, code: VendorLoginIdentifierError.LOGIN_IDENTIFIER_EMPTY };
  }
  const kind = classifyVendorLoginIdentifier(raw);
  if (kind === null) {
    return { ok: false, code: VendorLoginIdentifierError.LOGIN_IDENTIFIER_EMPTY };
  }
  return kind === "email" ? normalizeEmail(raw) : normalizePhone(raw);
}

/**
 * Deterministic, non-reversible audit correlation hash of a CANONICAL identifier.
 * Equivalent inputs (`  Vendor@Example.COM `, `+91 98765 43210`) always produce
 * the same digest; the raw identifier is never stored.
 */
export function hashVendorLoginIdentifier(identifier: VendorLoginIdentifier): string {
  return crypto.createHash("sha256").update(identifier.canonical).digest("hex");
}

/** Convenience: normalize then hash. Returns null when the identifier is invalid. */
export function hashRawVendorLoginIdentifier(raw: string | null | undefined): string | null {
  const normalized = normalizeVendorLoginIdentifier(raw);
  return normalized.ok ? hashVendorLoginIdentifier(normalized.identifier) : null;
}

/** Guard used before anything is written to an audit `destination_hash` column. */
export function isVendorLoginIdentifierHash(value: unknown): boolean {
  return typeof value === "string" && IDENTIFIER_HASH_SHAPE.test(value);
}
