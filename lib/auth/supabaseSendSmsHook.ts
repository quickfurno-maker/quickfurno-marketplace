// ============================================================================
// QuickFurno — lib/auth/supabaseSendSmsHook.ts   (server-only)
//
// Standard Webhooks verification + a NARROW parser/validator for the Supabase
// "Send SMS" HTTP Auth Hook event. This is the trust boundary for the client
// WhatsApp OTP login path: nothing in the payload is trusted until the Standard
// Webhooks signature has been verified against the RAW request body.
//
// WHY THE OFFICIAL LIBRARY
//   Signature crypto is never hand-rolled here. The `standardwebhooks` package is
//   the one verification authority — the same primitive Supabase signs with. We
//   only wrap it: normalize the secret, feed it the raw body + the three
//   `webhook-*` headers, and treat any thrown WebhookVerificationError as a
//   rejection. The verifier is injectable (a registry, mirroring the Phase 5B
//   provider registry) so the boundary is testable without weakening the crypto.
//
// LOGGING RULE (enforced by never returning these): this module never logs — and
// callers must never log — the raw body, the OTP, the phone, the hook secret, the
// signature, or any access/refresh token.
// ============================================================================

import { Webhook } from "standardwebhooks";
import { normalizePhoneE164 } from "../communication/phone";
import { isUuidShaped, normalizeAuthProvidedPhone } from "../identity/clientOtp";

// ----------------------------------------------------------------------------
// Standard Webhooks headers
// ----------------------------------------------------------------------------
export const WEBHOOK_ID_HEADER = "webhook-id";
export const WEBHOOK_TIMESTAMP_HEADER = "webhook-timestamp";
export const WEBHOOK_SIGNATURE_HEADER = "webhook-signature";

export interface StandardWebhookHeaders {
  readonly webhookId: string;
  readonly webhookTimestamp: string;
  readonly webhookSignature: string;
}

/**
 * Collect the three required Standard Webhooks headers from a case-insensitive
 * header accessor (e.g. `req.headers.get`). Returns null when any is absent/blank
 * — a missing signature header must be rejected, never treated as "unsigned ok".
 */
export function collectStandardWebhookHeaders(
  getHeader: (name: string) => string | null | undefined
): StandardWebhookHeaders | null {
  const webhookId = (getHeader(WEBHOOK_ID_HEADER) ?? "").trim();
  const webhookTimestamp = (getHeader(WEBHOOK_TIMESTAMP_HEADER) ?? "").trim();
  const webhookSignature = (getHeader(WEBHOOK_SIGNATURE_HEADER) ?? "").trim();
  if (!webhookId || !webhookTimestamp || !webhookSignature) return null;
  return { webhookId, webhookTimestamp, webhookSignature };
}

// ----------------------------------------------------------------------------
// Body size ceiling
// ----------------------------------------------------------------------------
/** A Send SMS hook body is a few hundred bytes. 16 KiB is a generous ceiling. */
export const MAX_HOOK_BODY_BYTES = 16 * 1024;

/** BYTE-length ceiling (never character length — a multibyte body can exceed the
 *  byte limit while staying under the character count). */
export function isWithinHookBodyCeiling(rawBody: string): boolean {
  if (typeof rawBody !== "string") return false;
  return Buffer.byteLength(rawBody, "utf8") <= MAX_HOOK_BODY_BYTES;
}

// ----------------------------------------------------------------------------
// Bounded body reader — enforce the ceiling BEFORE unbounded buffering
// ----------------------------------------------------------------------------
export type BoundedBodyResult =
  | { readonly ok: true; readonly rawBody: string }
  | { readonly ok: false; readonly reason: "oversized_body" | "read_failed" };

/** The minimal request surface the bounded reader needs. */
export interface BoundedBodySource {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly headers: { get(name: string): string | null };
  /** Fallback when no stream is exposed (small/empty bodies only). */
  text?(): Promise<string>;
}

/**
 * Read the request body under a strict byte ceiling.
 *
 *   1. If Content-Length is present and exceeds the limit, reject BEFORE reading.
 *   2. Otherwise stream the body, counting BYTES, and reject the moment the count
 *      exceeds the limit — this protects against a chunked / missing-Content-Length
 *      body that would otherwise buffer unboundedly.
 *   3. The accepted bytes are decoded to the EXACT raw string used for Standard
 *      Webhooks verification. The payload is NOT normalized, reserialized, or
 *      parsed here — JSON parsing happens only AFTER the signature is verified.
 */
export async function readBoundedRawBody(
  source: BoundedBodySource,
  maxBytes: number = MAX_HOOK_BODY_BYTES
): Promise<BoundedBodyResult> {
  const declared = Number(source.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "oversized_body" };
  }

  const stream = source.body;
  if (!stream) {
    // No stream exposed: fall back to text() (empty / very small bodies only).
    const text = source.text ? await source.text() : "";
    if (Buffer.byteLength(text, "utf8") > maxBytes) return { ok: false, reason: "oversized_body" };
    return { ok: true, rawBody: text };
  }

  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            /* best effort — we are rejecting anyway */
          }
          return { ok: false, reason: "oversized_body" };
        }
        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      }
    }
  } catch {
    return { ok: false, reason: "read_failed" };
  }

  return { ok: true, rawBody: Buffer.concat(chunks).toString("utf8") };
}

// ----------------------------------------------------------------------------
// Secret loading — server-only environment variable
// ----------------------------------------------------------------------------
/**
 * The server-only environment variable holding the Send SMS hook secret(s).
 *
 * FORMAT: NEWLINE-delimited (one secret per line). A comma is NOT a valid
 * delimiter because the Supabase hook-secret representation `v1,whsec_<base64>`
 * itself contains a comma; splitting on it would corrupt the secret. Newlines
 * never appear inside a valid secret representation, so the format is
 * unambiguous. Blank lines are ignored, each line is trimmed, and duplicates are
 * de-duplicated (so a repeated secret is tried once, never ambiguously twice).
 *
 * Rotation: put the current and previous secret on separate lines; verification
 * succeeds if ANY configured secret validates.
 *
 * Documented only — Phase 5D does NOT create or modify any .env file.
 */
export const SEND_SMS_HOOK_SECRETS_ENV = "SEND_SMS_HOOK_SECRETS";

/**
 * Parse the configured secrets. Returns a de-duplicated, order-preserving list.
 * An empty list means "not configured" and the caller fails closed.
 */
export function loadSendSmsHookSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env[SEND_SMS_HOOK_SECRETS_ENV];
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const secrets: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue; // blank lines are not secrets
    if (seen.has(trimmed)) continue; // duplicates are collapsed
    seen.add(trimmed);
    secrets.push(trimmed);
  }
  return secrets;
}

/**
 * Supabase issues the secret as `v1,whsec_<base64>`. The `standardwebhooks`
 * library strips a leading `whsec_` itself, so we only strip the `v1,` version
 * marker; a bare `whsec_...` or raw base64 secret passes through untouched.
 */
export function normalizeHookSecret(secret: string): string {
  return secret.startsWith("v1,") ? secret.slice(3) : secret;
}

// ----------------------------------------------------------------------------
// Signature verifier — injectable registry over the official library
// ----------------------------------------------------------------------------
export type SendSmsHookVerificationResult =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false };

export interface SendSmsHookSignatureVerifier {
  readonly verifierKey: string;
  /**
   * Verify `rawBody` against the `webhook-*` headers using one of `secrets`.
   * Returns the verified (parsed) payload on success, or `{ ok: false }` on ANY
   * failure. Implementations must never log the secret, signature, or body.
   */
  verify(
    rawBody: string,
    headers: StandardWebhookHeaders,
    secrets: string[]
  ): SendSmsHookVerificationResult;
}

/** The production verifier: the official Standard Webhooks primitive, nothing more. */
export class StandardWebhooksSignatureVerifier implements SendSmsHookSignatureVerifier {
  readonly verifierKey = "standard_webhooks";

  verify(
    rawBody: string,
    headers: StandardWebhookHeaders,
    secrets: string[]
  ): SendSmsHookVerificationResult {
    for (const secret of secrets) {
      try {
        const wh = new Webhook(normalizeHookSecret(secret));
        const payload = wh.verify(rawBody, {
          "webhook-id": headers.webhookId,
          "webhook-timestamp": headers.webhookTimestamp,
          "webhook-signature": headers.webhookSignature,
        });
        return { ok: true, payload };
      } catch {
        // Wrong secret (rotation) or a forged/expired signature. Try the next
        // secret. The thrown error is discarded — it must never be logged.
      }
    }
    return { ok: false };
  }
}

let activeSendSmsHookVerifier: SendSmsHookSignatureVerifier = new StandardWebhooksSignatureVerifier();

export function getActiveSendSmsHookVerifier(): SendSmsHookSignatureVerifier {
  return activeSendSmsHookVerifier;
}

export function setActiveSendSmsHookVerifier(verifier: SendSmsHookSignatureVerifier): void {
  activeSendSmsHookVerifier = verifier;
}

// ----------------------------------------------------------------------------
// Narrow payload parser/validator
// ----------------------------------------------------------------------------
export const SendSmsHookParseError = {
  NOT_AN_OBJECT: "not_an_object",
  MISSING_USER: "missing_user",
  INVALID_USER_ID: "invalid_user_id",
  INVALID_PHONE: "invalid_phone",
  MISSING_SMS: "missing_sms",
  INVALID_OTP: "invalid_otp",
} as const;

export type SendSmsHookParseErrorValue =
  (typeof SendSmsHookParseError)[keyof typeof SendSmsHookParseError];

/**
 * The verified event, in request memory only. `otp` is an opaque short
 * authentication secret — it flows straight to the CommunicationService provider
 * call and is never persisted, hashed, logged, or placed in metadata.
 */
export interface SupabaseSendSmsHookEvent {
  readonly authUserId: string;
  readonly phoneE164: string;
  readonly otp: string;
}

export type SendSmsHookParseResult =
  | { readonly ok: true; readonly event: SupabaseSendSmsHookEvent }
  | { readonly ok: false; readonly reason: SendSmsHookParseErrorValue };

/** Bounds only — never inspects OTP content. */
const OTP_MAX_LENGTH = 16;

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Validate an ALREADY-VERIFIED Send SMS hook payload and extract exactly the
 * three fields the flow needs. Never call this on an unverified payload.
 *
 * Required shape:
 *   { user: { id: <uuid>, phone: <e.164 digits> }, sms: { otp: <opaque> } }
 */
export function parseSendSmsHookEvent(payload: unknown): SendSmsHookParseResult {
  const root = asObject(payload);
  if (!root) return { ok: false, reason: SendSmsHookParseError.NOT_AN_OBJECT };

  const user = asObject(root.user);
  if (!user) return { ok: false, reason: SendSmsHookParseError.MISSING_USER };

  if (!isUuidShaped(user.id)) return { ok: false, reason: SendSmsHookParseError.INVALID_USER_ID };
  const authUserId = (user.id as string).trim();

  // Supabase stores the phone as bare E.164 digits; normalize through the ONE
  // canonical helper. A number that will not normalize is rejected — the OTP is
  // never dispatched to a guessed country.
  const phone = normalizeAuthProvidedPhone(typeof user.phone === "string" ? user.phone : null);
  if (!phone.ok) return { ok: false, reason: SendSmsHookParseError.INVALID_PHONE };

  const sms = asObject(root.sms);
  if (!sms) return { ok: false, reason: SendSmsHookParseError.MISSING_SMS };

  const otpRaw = sms.otp;
  if (typeof otpRaw !== "string") return { ok: false, reason: SendSmsHookParseError.INVALID_OTP };
  const otp = otpRaw.trim();
  if (otp.length === 0 || otp.length > OTP_MAX_LENGTH) {
    return { ok: false, reason: SendSmsHookParseError.INVALID_OTP };
  }

  return { ok: true, event: { authUserId, phoneE164: phone.e164, otp } };
}

/** Convenience guard re-export so callers can normalize a phone consistently. */
export { normalizePhoneE164 };
