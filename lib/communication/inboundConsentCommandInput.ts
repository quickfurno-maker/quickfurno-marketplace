// ============================================================================
// QuickFurno — lib/communication/inboundConsentCommandInput.ts   (Phase 5F-D2-E, pure module)
//
// The ONE place that turns a VERIFIED, ALREADY-PERSISTED inbound WhatsApp message + its sanitized D1-B
// persistence receipt into the narrow input the frozen D2-D writer accepts. It is a PURE module: no I/O,
// no database, no network, no logging, no clock, no randomness, no env. It DECIDES nothing about consent —
// it only ADAPTS an inbound fact to the D2-D contract. QuickFurno Core (D2-D) remains the sole authority.
//
// WHY IT EXISTS — three contract seams between D1-A/D1-B and D2-D that must be crossed WITHOUT weakening
// the frozen D2-D validation (the D2-D migration is already applied to production and is immutable):
//
//   1. PROVIDER VOCABULARY. D1-A/D1-B persist the ADAPTER key `meta_whatsapp_cloud`. D2-D's TypeScript
//      allowlist AND its live SQL CHECK accept only `meta_whatsapp` / `exotel_sms` / `system`. So the two
//      vocabularies are bridged by ONE EXPLICIT, CLOSED map. It is never a prefix trim, never a widening
//      of the D2-D allowlist, and an unmapped provider is REJECTED (never passed through).
//
//   2. PROVIDER EVENT IDENTITY. A Meta `wamid` is `wamid.` + BASE64, whose alphabet includes `+`, `/` and
//      `=`. D2-D's identifier fence — in TypeScript AND in the applied SQL — is `^[A-Za-z0-9._:-]{1,200}$`,
//      which excludes all three. A raw wamid carrying one would be rejected as INVALID_WRITER_INPUT: a
//      DETERMINISTIC failure that would silently drop a real STOP. So the durable provider-event identity
//      is the LOWERCASE SHA-256 HEX DIGEST of the ORIGINAL wamid: 64 chars, always inside the fence, TOTAL
//      and DETERMINISTIC (1:1), so D2-D's receipt idempotency, replay and conflict detection are preserved
//      EXACTLY. The literal wamid is never sent to D2-D; it stays on the D1-B inbound row, which the
//      receipt reaches through `inboundMessageId`.
//
//   3. OCCURRENCE TIME. `providerOccurredAt` is nullable (Meta may omit/garble `timestamp`), but D2-D
//      REQUIRES a strict timezone-qualified RFC3339 instant. A missing/invalid provider time therefore
//      falls back to the server receive time rather than dropping the command — dropping a STOP is far
//      worse than an approximate occurrence time. This is REPLAY-SAFE: D2-D's replay/conflict binding is
//      (provider, provider_message_id, channel) → destination_hash + command + policy_version, and
//      `occurred_at` is NOT part of that comparison, so a retry that derives a different fallback instant
//      still replays cleanly and returns the ORIGINAL stored outcome.
//
// PRIVACY. Nothing here logs. The raw message body is read ONLY to produce the closed command token
// upstream; it is never returned, never stored, and never placed in an outcome. No plaintext phone, no
// destination hash, no raw provider payload, no database error and no stack ever leaves this module — a
// rejection carries a stable, sanitized reason code only.
// ============================================================================

import { createHash } from "node:crypto";
import type { NormalizedConsentCommand } from "./consentCommand";

// ----------------------------------------------------------------------------
// Provider vocabulary bridge (EXPLICIT + CLOSED)
// ----------------------------------------------------------------------------
/** The D1-A/D1-B adapter/transport provider key (what the inbound row stores). */
export const META_WHATSAPP_ADAPTER_PROVIDER = "meta_whatsapp_cloud" as const;
/** The D2-D consent-domain provider key (what the writer + the applied SQL CHECK accept). */
export const META_WHATSAPP_CONSENT_PROVIDER = "meta_whatsapp" as const;

/**
 * The ONLY adapter → consent-domain provider mapping. A CLOSED allowlist: an unknown adapter key maps to
 * null and the build is REJECTED. This never widens the D2-D provider allowlist — it only translates a
 * key D2-D already accepts.
 */
const PROVIDER_MAP: Readonly<Record<string, string>> = Object.freeze({
  [META_WHATSAPP_ADAPTER_PROVIDER]: META_WHATSAPP_CONSENT_PROVIDER,
});

/** Map an adapter provider key to its consent-domain key, or null when unmapped. Pure + total. */
export function mapAdapterProviderToConsentProvider(adapterProvider: unknown): string | null {
  if (typeof adapterProvider !== "string") return null;
  return Object.prototype.hasOwnProperty.call(PROVIDER_MAP, adapterProvider) ? PROVIDER_MAP[adapterProvider] : null;
}

// ----------------------------------------------------------------------------
// Provider event identity (SHA-256 of the ORIGINAL wamid)
// ----------------------------------------------------------------------------
/**
 * The PERMANENT D2-D provider-event identity for a Meta inbound message: lowercase SHA-256 hex of the
 * ORIGINAL wamid, exactly 64 characters. Deterministic and total, so the same wamid ALWAYS yields the same
 * identity (preserving D2-D receipt idempotency/replay) and a wamid containing `+`, `/` or `=` is carried
 * safely without weakening D2-D's identifier fence. Never truncated, never salted, never reversible.
 */
export function deriveProviderEventId(providerMessageId: string): string {
  return createHash("sha256").update(providerMessageId, "utf8").digest("hex");
}

// ----------------------------------------------------------------------------
// Occurrence time (strict RFC3339, with a documented server-clock fallback)
// ----------------------------------------------------------------------------
/**
 * STRICT, timezone-qualified, CALENDAR-VALID RFC3339 — deliberately equivalent to the frozen D2-D
 * contract, because D2-D re-validates the same thing in TypeScript AND in SQL. Anything this accepts must
 * be something D2-D will accept; anything it rejects must fall back rather than be smuggled through.
 *
 * `Date.parse` alone is NOT sufficient and is never relied upon: it is lenient and will happily ROLL OVER
 * an impossible calendar date (`2026-02-31T10:30:00Z` → 3 March; `2026-01-01T24:00:00Z` → next midnight).
 * Normalizing such a value into a DIFFERENT real date would silently rewrite when a consent command
 * occurred. So the real calendar is checked explicitly, and a `setUTC*` ROUND-TRIP proves no rollover
 * happened before the value is trusted.
 */
const RFC3339_TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * True only for a well-formed, timezone-qualified, real calendar instant. Rejects: a date-only or
 * timezone-less value, a locale format, an impossible day (`2026-02-31`), an out-of-range time
 * (`24:00:00`, `:60`), and an out-of-range UTC offset. Pure + total; never throws.
 */
export function isStrictRfc3339(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const m = RFC3339_TS.exec(value);
  if (!m) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const hour = Number(m[4]), minute = Number(m[5]), second = Number(m[6]);
  if (year < 1 || month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;   // 2026-02-31 dies here
  if (hour > 23 || minute > 59 || second > 59) return false;      // 24:00:00 dies here
  const millis = m[7] ? Number((m[7] + "000").slice(0, 3)) : 0;
  // ROUND-TRIP: prove the components survive unchanged — i.e. nothing silently rolled over.
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, millis);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day
      || d.getUTCHours() !== hour || d.getUTCMinutes() !== minute || d.getUTCSeconds() !== second) return false;
  if (m[8] !== "Z") {
    const offsetHour = Number(m[10]), offsetMinute = Number(m[11]);
    if (offsetHour > 23 || offsetMinute > 59) return false;       // an invalid offset dies here
  }
  return true;
}

/**
 * Normalize a candidate instant to a strict ISO-8601 UTC string, or null when it is not a REAL instant.
 * An invalid calendar value is NEVER normalized into another date — it is rejected so the caller falls
 * back, exactly as if it had been absent.
 */
export function toStrictIsoInstant(value: unknown): string | null {
  if (!isStrictRfc3339(value)) return null;
  const t = Date.parse(value as string);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

/**
 * The occurrence time D2-D is given: the PROVIDER's time when it is a valid instant, else the SERVER
 * receive time. Returns null only when BOTH are unusable (then the build fails closed rather than
 * fabricating an instant).
 */
export function resolveOccurredAt(providerOccurredAt: unknown, receivedAt: unknown): string | null {
  return toStrictIsoInstant(providerOccurredAt) ?? toStrictIsoInstant(receivedAt);
}

// ----------------------------------------------------------------------------
// Command eligibility (conservative: TEXT only)
// ----------------------------------------------------------------------------
/** The ONLY command-eligible inbound message type. A button/list reply is NOT a typed command. */
export const COMMAND_ELIGIBLE_MESSAGE_TYPE = "text" as const;

/** Structural view of the minimized inbound message (D1-A `NormalizedInboundMessage` satisfies this). */
export interface CommandCandidateMessage {
  readonly provider: string;
  readonly providerMessageId: string;
  readonly messageType: string;
  readonly contentMinimized: Record<string, unknown>;
  readonly providerOccurredAt: string | null;
}

/** Structural view of the D1-B persistence receipt (`InboundPersistenceReceipt` satisfies this). */
export interface CommandPersistenceReceipt {
  readonly inboundMessageId: string;
  readonly provider: string;
  readonly providerMessageId: string;
  readonly duplicate: boolean;
  readonly destinationHash: string;
  readonly identityConfidence: string;
  readonly principalType: string | null;
  readonly principalId: string | null;
  readonly receivedAt: string;
  readonly providerOccurredAt: string | null;
}

/** ONLY a text message can carry a typed command. Everything else is skipped, never interpreted. */
export function isCommandEligible(message: CommandCandidateMessage): boolean {
  return !!message && message.messageType === COMMAND_ELIGIBLE_MESSAGE_TYPE;
}

/**
 * The raw command token of a text message — the value handed to the PURE D2-D normalizer, which is the
 * only thing allowed to interpret it. Never logged, never returned in an outcome, never persisted here.
 */
export function readCommandToken(message: CommandCandidateMessage): string | null {
  if (!isCommandEligible(message)) return null;
  const body = message.contentMinimized?.text;
  return typeof body === "string" ? body : null;
}

// ----------------------------------------------------------------------------
// The built D2-D writer input (structurally EXACTLY `ConsentWriterInput`)
// ----------------------------------------------------------------------------
export type ConsentChannel = "whatsapp";
export type ConsentPrincipalType = "client" | "vendor" | "admin";
export type ConsentIdentityConfidence = "exact" | "ambiguous" | "unknown";

export interface BuiltConsentCommandInput {
  readonly channel: ConsentChannel;
  readonly command: NormalizedConsentCommand;
  readonly destinationHash: string;
  readonly identityConfidence: ConsentIdentityConfidence;
  readonly principal: { readonly type: ConsentPrincipalType; readonly id: string } | null;
  readonly provider: string;
  /** The SHA-256 digest of the original wamid — NEVER the raw wamid. */
  readonly providerMessageId: string;
  readonly sourceEventType: string;
  /** The durable D1-B inbound row UUID (persistence precedes command processing, so it always exists). */
  readonly inboundMessageId: string;
  readonly occurredAt: string;
}

/** Stable, sanitized rejection reasons. They carry no phone, no body, no hash and no database detail. */
export const CommandInputRejectReason = {
  NOT_COMMAND_ELIGIBLE: "NOT_COMMAND_ELIGIBLE",
  RECEIPT_MESSAGE_MISMATCH: "RECEIPT_MESSAGE_MISMATCH",
  UNMAPPED_PROVIDER: "UNMAPPED_PROVIDER",
  MISSING_PROVIDER_MESSAGE_ID: "MISSING_PROVIDER_MESSAGE_ID",
  INVALID_INBOUND_MESSAGE_ID: "INVALID_INBOUND_MESSAGE_ID",
  INVALID_DESTINATION_HASH: "INVALID_DESTINATION_HASH",
  INVALID_IDENTITY: "INVALID_IDENTITY",
  UNRESOLVABLE_OCCURRED_AT: "UNRESOLVABLE_OCCURRED_AT",
} as const;
export type CommandInputRejectReasonValue =
  (typeof CommandInputRejectReason)[keyof typeof CommandInputRejectReason];

export type BuildCommandInputOutcome =
  | { readonly ok: true; readonly input: BuiltConsentCommandInput }
  | { readonly ok: false; readonly reason: CommandInputRejectReasonValue };

/** The event-type provenance stamped on every inbound command. Identifier-shaped for the D2-D fence. */
export const INBOUND_COMMAND_SOURCE_EVENT_TYPE = "whatsapp.inbound.command" as const;

const HEX64 = /^[0-9a-f]{64}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRINCIPAL_TYPES: readonly string[] = ["client", "vendor", "admin"];
const CONFIDENCES: readonly string[] = ["exact", "ambiguous", "unknown"];

/**
 * Build the D2-D writer input for ONE already-persisted inbound message. Pure + total: every failure is a
 * stable sanitized reason, never a throw and never a partially-formed input.
 *
 * `command` is ALREADY normalized by the pure D2-D normalizer upstream — raw text NEVER reaches here.
 * The caller must only ever pass `stop` / `start`; HELP and unsupported short-circuit before this point
 * and never reach the writer.
 */
export function buildInboundConsentCommandInput(
  command: NormalizedConsentCommand,
  message: CommandCandidateMessage,
  receipt: CommandPersistenceReceipt
): BuildCommandInputOutcome {
  const reject = (reason: CommandInputRejectReasonValue): BuildCommandInputOutcome => ({ ok: false, reason });

  if (!message || !receipt) return reject(CommandInputRejectReason.NOT_COMMAND_ELIGIBLE);
  if (!isCommandEligible(message)) return reject(CommandInputRejectReason.NOT_COMMAND_ELIGIBLE);

  // The receipt must describe THIS message. A mismatched pair is never silently reconciled.
  if (typeof message.providerMessageId !== "string" || message.providerMessageId === "") {
    return reject(CommandInputRejectReason.MISSING_PROVIDER_MESSAGE_ID);
  }
  if (receipt.providerMessageId !== message.providerMessageId || receipt.provider !== message.provider) {
    return reject(CommandInputRejectReason.RECEIPT_MESSAGE_MISMATCH);
  }

  const provider = mapAdapterProviderToConsentProvider(message.provider);
  if (!provider) return reject(CommandInputRejectReason.UNMAPPED_PROVIDER);

  if (typeof receipt.inboundMessageId !== "string" || !UUID_SHAPE.test(receipt.inboundMessageId)) {
    return reject(CommandInputRejectReason.INVALID_INBOUND_MESSAGE_ID);
  }
  if (typeof receipt.destinationHash !== "string" || !HEX64.test(receipt.destinationHash)) {
    return reject(CommandInputRejectReason.INVALID_DESTINATION_HASH);
  }
  if (!CONFIDENCES.includes(receipt.identityConfidence)) return reject(CommandInputRejectReason.INVALID_IDENTITY);

  // A principal is carried ONLY on an EXACT identity — mirroring the D1-A schema invariant and the D2-D
  // input fence. Ambiguous/unknown ALWAYS pass a null principal; a resolver bug can never smuggle one in.
  let principal: BuiltConsentCommandInput["principal"] = null;
  if (receipt.identityConfidence === "exact") {
    const type = receipt.principalType;
    const id = receipt.principalId;
    if (typeof type !== "string" || !PRINCIPAL_TYPES.includes(type)) return reject(CommandInputRejectReason.INVALID_IDENTITY);
    if (typeof id !== "string" || !UUID_SHAPE.test(id)) return reject(CommandInputRejectReason.INVALID_IDENTITY);
    principal = { type: type as ConsentPrincipalType, id };
  } else if (receipt.principalType !== null || receipt.principalId !== null) {
    return reject(CommandInputRejectReason.INVALID_IDENTITY);
  }

  const occurredAt = resolveOccurredAt(receipt.providerOccurredAt, receipt.receivedAt);
  if (!occurredAt) return reject(CommandInputRejectReason.UNRESOLVABLE_OCCURRED_AT);

  return {
    ok: true,
    input: {
      channel: "whatsapp",
      command,
      destinationHash: receipt.destinationHash,
      identityConfidence: receipt.identityConfidence as ConsentIdentityConfidence,
      principal,
      provider,
      // The SHA-256 digest of the ORIGINAL wamid — never the raw wamid.
      providerMessageId: deriveProviderEventId(message.providerMessageId),
      sourceEventType: INBOUND_COMMAND_SOURCE_EVENT_TYPE,
      inboundMessageId: receipt.inboundMessageId,
      occurredAt,
    },
  };
}
