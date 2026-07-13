// ============================================================================
// QuickFurno — lib/communication/consentAckIntent.ts   (Phase 5F-D4-C, pure module)
//
// The durable acknowledgement-intent CONTRACT: statuses, expiry, the canonical AAD, and the closed
// worker outcome vocabulary. PURE: no I/O, no database, no network, no crypto, no logging, no environment.
//
// The AAD (below) is the integrity binding for the sealed destination. It is what makes a ciphertext
// non-transplantable: move it to another intent, another receipt, another inbound message, another
// provider-event, another destination hash, another acknowledgement type or another expiry, and the AEAD
// open FAILS. That is the whole point — the worker can only ever address the destination that this exact
// authoritative command came from.
// ============================================================================

import { ACK_WINDOW_MS, type AckCommand, type ConsentAckTypeValue } from "./consentCommandResponse";

// ----------------------------------------------------------------------------
// Status machine (closed)
// ----------------------------------------------------------------------------
export const AckIntentStatus = {
  PENDING: "pending",
  CLAIMED: "claimed",
  DISPATCHING: "dispatching",
  SENT: "sent",
  SUPPRESSED: "suppressed",
  EXPIRED: "expired",
  FAILED: "failed",
  UNCERTAIN: "uncertain",
} as const;
export type AckIntentStatusValue = (typeof AckIntentStatus)[keyof typeof AckIntentStatus];

export const ACK_INTENT_STATUSES: readonly AckIntentStatusValue[] = Object.freeze([
  "pending", "claimed", "dispatching", "sent", "suppressed", "expired", "failed", "uncertain",
]);

/** Every terminal transition PURGES the sealed destination. There is no path out of a terminal status. */
export const ACK_TERMINAL_STATUSES: readonly AckIntentStatusValue[] = Object.freeze([
  "sent", "suppressed", "expired", "failed", "uncertain",
]);

export const isTerminalAckStatus = (s: unknown): s is AckIntentStatusValue =>
  typeof s === "string" && (ACK_TERMINAL_STATUSES as readonly string[]).includes(s);

/** AT MOST ONE provider attempt, ever. */
export const MAX_PROVIDER_ATTEMPTS = 1;
/** The worker never claims more than this in one batch. */
export const ACK_CLAIM_BATCH_MAX = 25;
/** Lease before a claim is considered stale. Only a PRE-ATTEMPT claim is ever reclaimed. */
export const ACK_CLAIM_STALE_LEASE_MS = 2 * 60 * 1000;

// ----------------------------------------------------------------------------
// Bounded provider timeout + stale-dispatch recovery threshold (reviewed constants)
// ----------------------------------------------------------------------------
/**
 * The provider send is awaited through a BOUNDED timeout. On expiry the outcome is UNKNOWABLE, so it becomes
 * TERMINAL `uncertain`.
 *
 * HONEST LIMITATION: this timeout does NOT cancel the underlying provider request — the existing
 * CommunicationService/provider path exposes no cancellation. The HTTP call may still complete at Meta after
 * we have stopped waiting. What at-most-once guarantees is that **QuickFurno never attempts it again**:
 * `provider_attempt_count` is already 1, the row terminalizes `uncertain`, and the claim RPC can never
 * return it.
 */
export const PROVIDER_ATTEMPT_TIMEOUT_MS = 60 * 1000;         // 60 seconds

/** The minimum gap between the provider timeout and stale-dispatch recovery. */
export const RECOVERY_SAFETY_MARGIN_MS = 60 * 1000;           // 60 seconds

/**
 * A `dispatching` row is only recovered to terminal `uncertain` after this long. It MUST exceed the provider
 * timeout plus the safety margin, so recovery can never terminalize an attempt that the worker is still
 * legitimately waiting on.
 */
export const STALE_DISPATCH_RECOVERY_MS = 180 * 1000;         // 180 seconds

/** The invariant, asserted at module load: a mis-set constant must not be silently shippable. */
export function recoveryThresholdIsSafe(
  recoveryMs: number = STALE_DISPATCH_RECOVERY_MS,
  timeoutMs: number = PROVIDER_ATTEMPT_TIMEOUT_MS,
  marginMs: number = RECOVERY_SAFETY_MARGIN_MS
): boolean {
  return recoveryMs > timeoutMs + marginMs;
}
if (!recoveryThresholdIsSafe()) {
  throw new Error("STALE_DISPATCH_RECOVERY_MS must exceed PROVIDER_ATTEMPT_TIMEOUT_MS + RECOVERY_SAFETY_MARGIN_MS");
}

/** Sanitized maintenance counts. Never a row, hash, ciphertext or key id. */
export interface AckMaintenanceResult {
  readonly expired: number;
  readonly recoveredUncertain: number;
}

// ----------------------------------------------------------------------------
// Expiry — derived from D1-B's PERSISTED received_at, never from a wall clock
// ----------------------------------------------------------------------------
/**
 * STOP/START expire after 15 minutes, HELP after 24 hours — the same windows D4-B's rate-limit bucket uses,
 * so an intent can never outlive the bucket that deduplicates it. An expired intent is NEVER sent: telling a
 * user "your STOP was processed" an hour later is worse than saying nothing.
 */
export function deriveAckExpiry(command: AckCommand, receivedAtIso: string): string | null {
  const ms = Date.parse(receivedAtIso);
  if (!Number.isFinite(ms)) return null;
  const windowMs = ACK_WINDOW_MS[command];
  if (typeof windowMs !== "number") return null;
  return new Date(ms + windowMs).toISOString();
}

// ----------------------------------------------------------------------------
// THE CANONICAL AAD
// ----------------------------------------------------------------------------
/** Bump ONLY with a reviewed migration: an older ciphertext will no longer open under a new version. */
export const AAD_SCHEMA_VERSION = 1;

/** Every field the sealed destination is bound to. All are required; none is caller-selectable. */
export interface AckAadFields {
  readonly schemaVersion: number;
  readonly intentId: string;
  readonly consentCommandReceiptId: string | null; // null for HELP — it has no authoritative receipt
  readonly inboundMessageId: string;
  readonly canonicalProviderMessageHash: string;
  readonly destinationHash: string;
  readonly ackType: ConsentAckTypeValue;
  readonly expiresAt: string;
}

/**
 * A FIXED-ORDER, LENGTH-PREFIXED serialization. Deliberately NOT `JSON.stringify` of an object: object key
 * order is an implementation detail, and two different field sets could otherwise serialize identically.
 * Here every element is prefixed with its UTF-8 byte length, so no value can be smuggled across a boundary
 * (a destination hash cannot be split into "…hash" + "ackType", etc.).
 *
 * Changing ANY field changes the AAD, and the AEAD open then fails. That is the required behaviour.
 *
 * ── THE EXPIRY IS BOUND AS AN INSTANT, NEVER AS TEXT ────────────────────────────────────────────────
 * The intent is sealed in the enqueue with a JavaScript `toISOString()` string
 * (`2026-07-13T10:15:00.000Z`), but the WORKER rebuilds this AAD from what POSTGRES returns for a
 * `timestamptz` (`2026-07-13T10:15:00+00:00`, sometimes with microseconds). Those are the SAME INSTANT but
 * DIFFERENT BYTES. Binding the raw text would make every legitimate acknowledgement fail to decrypt.
 *
 * So the expiry is canonicalized HERE, inside the shared function — never at a caller — to its decimal Unix
 * epoch milliseconds. Every equivalent representation therefore produces byte-identical AAD, while a
 * genuinely different instant (even by 1 ms) still changes it. An unparseable timestamp returns `null`:
 * FAIL CLOSED, and the offending value is never echoed back.
 */
export function canonicalAckAad(fields: AckAadFields): string | null {
  const expiresAtMs = Date.parse(fields?.expiresAt as string);
  if (!Number.isFinite(expiresAtMs)) return null;   // fail closed; the supplied value is never exposed

  const parts: readonly string[] = [
    "qf.consent_ack.v" + String(fields.schemaVersion),
    fields.intentId,
    fields.consentCommandReceiptId ?? "-",          // explicit HELP-null marker, distinct from ""
    fields.inboundMessageId,
    fields.canonicalProviderMessageHash,
    fields.destinationHash,
    fields.ackType,
    String(expiresAtMs),                            // CANONICAL INSTANT — not the caller's text
  ];
  // length-prefixed, pipe-joined: `8:abcdefgh|3:xyz|…`
  return parts.map((p) => `${Buffer.byteLength(p, "utf8")}:${p}`).join("|");
}

/** Structural validation of the AAD field set. A malformed binding is never sealed and never opened. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;

export function isValidAckAadFields(f: unknown): f is AckAadFields {
  if (!f || typeof f !== "object") return false;
  const a = f as AckAadFields;
  if (!Number.isInteger(a.schemaVersion) || a.schemaVersion < 1) return false;
  if (typeof a.intentId !== "string" || !UUID.test(a.intentId)) return false;
  if (a.consentCommandReceiptId !== null && (typeof a.consentCommandReceiptId !== "string" || !UUID.test(a.consentCommandReceiptId))) return false;
  if (typeof a.inboundMessageId !== "string" || !UUID.test(a.inboundMessageId)) return false;
  if (typeof a.canonicalProviderMessageHash !== "string" || !HEX64.test(a.canonicalProviderMessageHash)) return false;
  if (typeof a.destinationHash !== "string" || !HEX64.test(a.destinationHash)) return false;
  if (typeof a.ackType !== "string" || (a.ackType as string) === "") return false;
  if (typeof a.expiresAt !== "string" || !Number.isFinite(Date.parse(a.expiresAt))) return false;
  return true;
}

// ----------------------------------------------------------------------------
// Closed worker outcomes — sanitized; never a phone, ciphertext, key id or DB error
// ----------------------------------------------------------------------------
export type AckWorkerOutcome =
  | "sent"
  | "suppressed"
  | "expired"
  | "seal_failed"          // missing/unknown key, malformed envelope, AEAD failure, AAD mismatch
  | "destination_mismatch" // the opened destination does not hash to the bound destination_hash
  | "evidence_invalid"
  | "authority_unavailable"
  | "attempt_not_reserved" // another worker won the single attempt — this worker sends nothing
  | "send_failed"
  | "uncertain";           // reserved the attempt, then the outcome was unknowable. NEVER resent.

/** Which worker outcomes are terminal, and what status each terminalizes to. */
export const OUTCOME_TO_TERMINAL_STATUS: Readonly<Record<AckWorkerOutcome, AckIntentStatusValue | null>> =
  Object.freeze({
    sent: "sent",
    suppressed: "suppressed",
    expired: "expired",
    seal_failed: "failed",
    destination_mismatch: "failed",
    evidence_invalid: "failed",
    authority_unavailable: "failed",
    attempt_not_reserved: null,   // no transition: the winner owns the row
    send_failed: "failed",
    uncertain: "uncertain",
  });

export interface AckWorkerItemResult {
  readonly intentId: string;
  readonly ackType: string;
  readonly outcome: AckWorkerOutcome;
}

export interface AckWorkerBatchResult {
  readonly claimed: number;
  readonly sent: number;
  readonly suppressed: number;
  readonly expired: number;
  readonly failed: number;
  readonly uncertain: number;
  readonly items: readonly AckWorkerItemResult[];
}
