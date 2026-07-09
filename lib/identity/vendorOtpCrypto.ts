// ============================================================================
// QuickFurno — Identity Foundation: vendor OTP + reset-grant cryptography
// (Phase 5E)
//
// PURE cryptography for QuickFurno-managed VENDOR challenges. No database, no
// Supabase client, no network, no clock-dependent logic beyond nothing at all.
//
// TWO DIFFERENT SECRETS, TWO DIFFERENT HASHES — deliberately:
//
//   1. The six-digit OTP has a 10^6 search space. A plain SHA-256 of it is
//      trivially brute-forced offline if `verification_challenges` ever leaks, so
//      it is hashed with HMAC-SHA-256 under a SERVER-ONLY PEPPER that never
//      touches the database. The HMAC message is additionally BOUND to the
//      challenge context (id | purpose | dashboard identity | destination hash),
//      so a hash captured for one challenge/purpose/identity/number can never be
//      replayed against another.
//
//   2. The reset grant token carries 32 bytes of `crypto.randomBytes` entropy.
//      Brute force is infeasible, so a plain SHA-256 is sufficient and no pepper
//      is required — which is what lets a grant be looked up by hash.
//
// NEVER: `Math.random`, plaintext OTP persistence, plaintext grant persistence,
// pepper in logs / metadata / errors / the database / a communication intent.
// ============================================================================

import crypto from "crypto";

// ----------------------------------------------------------------------------
// Server-only pepper configuration
// ----------------------------------------------------------------------------
/**
 * The server-only environment variable holding the vendor OTP pepper(s).
 *
 * FORMAT: `current_pepper|previous_pepper` — PIPE-delimited, current FIRST.
 * A newline is additionally accepted as an operator-friendly separator. A COMMA
 * is never a separator: a pepper is opaque secret material and may legitimately
 * contain one.
 *
 * ROTATION CONTRACT:
 *   • the FIRST (primary) pepper creates every new challenge hash;
 *   • ALL configured peppers may VERIFY a pending challenge, so challenges
 *     issued under the previous pepper stay verifiable for their (short) TTL.
 * Once every pre-rotation challenge has expired, drop the previous pepper.
 *
 * An empty/absent configuration means "not configured" and every caller FAILS
 * CLOSED — no OTP is generated, hashed, verified, or dispatched.
 *
 * Documented only. Phase 5E does NOT create or modify any .env file.
 */
export const VENDOR_AUTH_OTP_PEPPERS_ENV = "VENDOR_AUTH_OTP_PEPPERS";

/** Whole-pepper separators. Deliberately EXCLUDES the comma — see above. */
const PEPPER_SEPARATORS = /[|\r\n]+/;

/**
 * Parse the configured peppers into a de-duplicated, order-preserving list.
 * `[0]` is the primary. An empty list means "not configured".
 *
 * The returned values are secret. Never log, audit, persist, or return them to a
 * caller; they exist only to be fed to `hashVendorOtp`.
 */
export function loadVendorOtpPeppers(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env[VENDOR_AUTH_OTP_PEPPERS_ENV];
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const peppers: string[] = [];
  for (const candidate of raw.split(PEPPER_SEPARATORS)) {
    const trimmed = candidate.trim();
    if (trimmed.length === 0) continue; // empty segments are not peppers
    if (seen.has(trimmed)) continue; // exact duplicates are collapsed
    seen.add(trimmed);
    peppers.push(trimmed);
  }
  return peppers;
}

/** The pepper that creates NEW hashes. Null when nothing is configured. */
export function primaryVendorOtpPepper(peppers: readonly string[]): string | null {
  return peppers.length > 0 ? peppers[0] : null;
}

// ----------------------------------------------------------------------------
// OTP generation
// ----------------------------------------------------------------------------
export const VENDOR_OTP_DIGITS = 6;
const VENDOR_OTP_UPPER_BOUND = 10 ** VENDOR_OTP_DIGITS; // exclusive

/**
 * A cryptographically random six-digit OTP, LEADING ZEROS PRESERVED ("004271" is
 * as likely as "904271"). `crypto.randomInt` draws from the CSPRNG with rejection
 * sampling, so the distribution is uniform and unpredictable.
 *
 * The returned value lives in request memory only: it goes to the provider call
 * and into the HMAC, and nowhere else. `Math.random` is never used.
 */
export function generateVendorOtp(): string {
  const value = crypto.randomInt(0, VENDOR_OTP_UPPER_BOUND);
  return String(value).padStart(VENDOR_OTP_DIGITS, "0");
}

/** Shape-only guard. Never inspects the value's correctness — the HMAC does. */
export function isPlausibleVendorOtp(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{6}$/.test(value.trim());
}

// ----------------------------------------------------------------------------
// Contextual OTP hashing (HMAC-SHA-256 under a server-only pepper)
// ----------------------------------------------------------------------------
/**
 * Everything the OTP hash is bound to. Change ANY field and the hash no longer
 * matches, which is what makes a captured hash non-transferable across
 * challenges, purposes, vendor dashboard identities, and destination numbers.
 */
export interface VendorOtpHashContext {
  readonly challengeId: string;
  readonly purpose: string;
  readonly vendorDashboardUserId: string;
  readonly destinationHash: string;
}

/** The separator is safe: uuids, purposes and hex digests never contain `|`. */
const HMAC_FIELD_SEPARATOR = "|";

/**
 * Build the canonical HMAC message. Exported so the harness can prove every
 * context field genuinely participates, rather than trusting a comment.
 *
 * Any field containing the separator would make the encoding ambiguous, so that
 * is rejected loudly rather than silently producing a colliding message.
 */
export function buildVendorOtpHashMessage(context: VendorOtpHashContext, otp: string): string {
  const fields = [
    context.challengeId,
    context.purpose,
    context.vendorDashboardUserId,
    context.destinationHash,
    otp,
  ];
  for (const field of fields) {
    if (typeof field !== "string" || field.length === 0) {
      throw new Error("VENDOR_OTP_HASH_CONTEXT_INCOMPLETE");
    }
    if (field.includes(HMAC_FIELD_SEPARATOR)) {
      throw new Error("VENDOR_OTP_HASH_CONTEXT_AMBIGUOUS");
    }
  }
  return fields.join(HMAC_FIELD_SEPARATOR);
}

/**
 * HMAC-SHA-256(pepper, contextual message) as lowercase hex.
 *
 * NOT a plain SHA-256 of the OTP: without the pepper an attacker holding the
 * database can enumerate all 10^6 codes offline in milliseconds.
 */
export function hashVendorOtp(
  context: VendorOtpHashContext,
  otp: string,
  pepper: string
): string {
  if (typeof pepper !== "string" || pepper.length === 0) {
    throw new Error("VENDOR_OTP_PEPPER_MISSING");
  }
  const message = buildVendorOtpHashMessage(context, otp);
  return crypto.createHmac("sha256", pepper).update(message).digest("hex");
}

/** A 64-char lowercase hex digest. */
const HEX_SHA256 = /^[a-f0-9]{64}$/;

/** Constant-time hex-digest comparison. Unequal lengths fail without leaking. */
export function timingSafeHexEqual(a: string, b: string): boolean {
  if (!HEX_SHA256.test(a) || !HEX_SHA256.test(b)) return false;
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify a submitted OTP against the stored hash, trying EVERY configured pepper
 * so a challenge issued before a rotation still verifies.
 *
 * Every pepper is evaluated (no short-circuit) and the comparison is
 * constant-time, so neither the number of peppers tried nor the position of the
 * matching one is observable from timing. An empty pepper list fails closed.
 */
export function verifyVendorOtp(
  context: VendorOtpHashContext,
  otp: string,
  storedOtpHash: string,
  peppers: readonly string[]
): boolean {
  if (!isPlausibleVendorOtp(otp)) return false;
  if (!HEX_SHA256.test(storedOtpHash)) return false;
  if (peppers.length === 0) return false; // not configured → never verifies

  let matched = false;
  for (const pepper of peppers) {
    let candidate: string;
    try {
      candidate = hashVendorOtp(context, otp.trim(), pepper);
    } catch {
      continue; // a malformed pepper/context never authenticates anything
    }
    // Deliberately no short-circuit: every pepper is compared.
    if (timingSafeHexEqual(storedOtpHash, candidate)) matched = true;
  }
  return matched;
}

// ----------------------------------------------------------------------------
// Reset grant token (high entropy → plain SHA-256 is sufficient)
// ----------------------------------------------------------------------------
/** 32 CSPRNG bytes = 256 bits. base64url-encodes to exactly 43 characters. */
export const RESET_GRANT_TOKEN_BYTES = 32;
export const RESET_GRANT_TOKEN_LENGTH = 43;

const RESET_GRANT_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * A single-use reset grant token. Returned to the caller EXACTLY ONCE, right
 * after a successful OTP verification, and never logged, audited, placed in
 * metadata or a correlation id, sent over WhatsApp, or persisted in plaintext.
 */
export function generateResetGrantToken(): string {
  return crypto.randomBytes(RESET_GRANT_TOKEN_BYTES).toString("base64url");
}

/**
 * The ONLY representation that reaches the database. Plain SHA-256 is safe here
 * precisely because the pre-image carries 256 bits of entropy — unlike the OTP.
 */
export function hashResetGrantToken(token: string): string {
  if (!isPlausibleResetGrantToken(token)) throw new Error("RESET_GRANT_TOKEN_MALFORMED");
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Shape-only guard, applied before the token is hashed. Never logs the value. */
export function isPlausibleResetGrantToken(value: unknown): value is string {
  return typeof value === "string" && RESET_GRANT_TOKEN_SHAPE.test(value);
}

/** UUID shape guard for challenge ids arriving from a caller. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidShaped(value: unknown): value is string {
  return typeof value === "string" && UUID_SHAPE.test(value.trim());
}
