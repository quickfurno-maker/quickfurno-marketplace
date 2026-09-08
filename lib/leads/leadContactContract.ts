// ============================================================================
// QuickFurno — lib/leads/leadContactContract.ts   (PURE)
//
// QF-MVP-50.8 — what counts as a usable QuickFurno LEAD contact number.
//
// WHY THIS EXISTS
// `public.leads.phone` is raw contact text. Unlike `public.vendors`, it has no
// database CHECK constraint and its writer (`services/leadService.ts`) only
// asked that the field be non-empty, while the public form asked only that the
// value contain ten digits somewhere. So the lane that must eventually DIAL a
// lead had no contract to rely on, and `normalizePhoneE164` — correctly — will
// not guess a country code for a bare national number.
//
// Rather than let the resolver quietly invent `+91`, this module states the
// accepted lead-capture contract ONCE, so the server authority, the public form
// and the communication adapter agree by construction instead of by comment.
//
// THE CONTRACT. QuickFurno lead capture accepts exactly two things:
//   1. an Indian mobile in national form — `^[6-9]\d{9}$`, and
//   2. an explicitly international number that `normalizePhoneE164` accepts.
// No other bare local shape is accepted.
//
// This is an INDIA-MARKET rule that lives at the LEAD boundary. It is NOT a
// generic phone-normalization rule, and it must never be read as one:
//   * `lib/communication/phone.ts` stays globally strict. A bare national
//     number remains ambiguous for client, admin, OTP and every future channel.
//   * The country code is never inferred from city, source, UTM, digit count
//     after stripping characters, an admin claim, n8n, or provider data. It is
//     inferred from ONE thing: the value already being the exact national shape
//     this contract accepts.
//
// SCOPE, deliberately narrow
//   * It describes what may be ACCEPTED and what is preserved for STORAGE. It
//     does not canonicalise storage to E.164 — `public.check_duplicate_lead`
//     compares `phone` by exact equality, so rewriting the stored
//     representation would silently change duplicate detection. That is a
//     separate, separately governed change.
//   * It performs no repair. Nothing here strips characters to discover a
//     ten-digit number hiding inside a malformed one.
//
// PURE: no I/O, no clock, no randomness, no database, no provider.
// ============================================================================

import { normalizePhoneE164 } from "../communication/phone";
import { INDIAN_LEAD_MOBILE_RE } from "./indianMobile";

// Re-exported so server-side callers can take the whole contract from one
// import. The DEFINITION lives in the dependency-free module, because the
// browser forms need the shape without pulling `phone.ts` (and Node's `crypto`)
// into the client bundle.
export { INDIAN_LEAD_MOBILE_RE, isIndianLeadMobile } from "./indianMobile";

export type LeadContactRejectionCode =
  /** Absent, non-string, or whitespace only. */
  | "LEAD_CONTACT_EMPTY"
  /** Present, but neither an Indian national mobile nor a valid international number. */
  | "LEAD_CONTACT_NOT_ACCEPTED";

/** Which of the two accepted forms the value took. */
export type LeadContactShape = "indian_national" | "international";

export type LeadContactValidation =
  | {
      readonly ok: true;
      readonly shape: LeadContactShape;
      /**
       * The value to persist. Deliberately the TRIMMED INPUT, not an E.164
       * rewrite: `check_duplicate_lead` matches `phone` by exact equality, so
       * this contract validates without moving the storage representation.
       */
      readonly storage: string;
    }
  | { readonly ok: false; readonly code: LeadContactRejectionCode };

/**
 * Validate a captured lead contact number against the contract above and return
 * the exact value to store.
 *
 * The international branch is DELEGATED to `normalizePhoneE164` rather than
 * re-expressed here, so there is exactly one definition of "valid international
 * number" in the repository and this module cannot drift away from it.
 */
export function normalizeLeadContactForStorage(raw: unknown): LeadContactValidation {
  if (typeof raw !== "string") return { ok: false, code: "LEAD_CONTACT_EMPTY" };

  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, code: "LEAD_CONTACT_EMPTY" };

  // 1. The exact Indian national shape. No cleaning happens first: a value only
  //    qualifies if it ALREADY is ten digits starting 6-9, so `98765 43210` and
  //    `98-765-43210` are not silently repaired into a country-coded number.
  if (INDIAN_LEAD_MOBILE_RE.test(trimmed)) {
    return { ok: true, shape: "indian_national", storage: trimmed };
  }

  // 2. Anything else must carry its own country code and satisfy the canonical
  //    normalizer. Formatted international input (`+91 98765 43210`) is fine —
  //    the normalizer, not this module, decides what formatting is safe.
  if (normalizePhoneE164(trimmed).ok) {
    return { ok: true, shape: "international", storage: trimmed };
  }

  return { ok: false, code: "LEAD_CONTACT_NOT_ACCEPTED" };
}

/** Convenience predicate for form-level prechecks. The server stays authoritative. */
export function isAcceptedLeadContact(raw: unknown): boolean {
  return normalizeLeadContactForStorage(raw).ok;
}
