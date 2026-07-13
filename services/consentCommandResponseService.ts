// ============================================================================
// QuickFurno — services/consentCommandResponseService.ts   (Phase 5F-D4-C, server-only)
//
// THE ENQUEUE PATH for consent-command acknowledgements (STOP / START / HELP).
//
// WHAT CHANGED IN D4-C. D4-B sent the acknowledgement INLINE, awaited inside the Meta webhook request. Once
// the templates are seeded that becomes a real outbound HTTP call to Meta inside the request Meta is waiting
// on — a slow provider then pushes the response past Meta's tolerance and Meta REDELIVERS. This service now
// does exactly one thing: it persists ONE DURABLE INTENT and returns. It sends nothing.
//
// WHAT THIS SERVICE NO LONGER DOES — and must never do again:
//   • it does NOT call D2-C          (the worker re-evaluates consent immediately before dispatch);
//   • it does NOT construct CommunicationService;
//   • it does NOT call a provider;
//   • it does NOT dispatch, schedule or invoke a worker;
//   • it does NOT return plaintext, ciphertext, nonce, auth tag, key id or destination hash.
//
// WHAT IT STILL GUARANTEES (the D4-B evidence contract, unchanged):
//   • only a real STOP/START/HELP with an ELIGIBLE authoritative disposition is ever enqueued;
//   • a REPLAYED command produces ZERO intents;
//   • the acknowledgement type and template are DERIVED from the command, never supplied;
//   • the plaintext destination is re-derived in REQUEST MEMORY from the already-verified payload, and its
//     hash must EXACTLY equal the persisted hash, or nothing is enqueued;
//   • the D4-B idempotency key is the fence: `idempotency_key UNIQUE` means a webhook REPLAY can never
//     create a second intent.
//
// AUTHORITY. D2-D remains the sole STOP/START writer; D2-C remains the sole consent decision authority; D2-E
// remains the sole inbound command integrator. This service reads their COMPLETED results and writes one
// delivery intent. It writes no consent state and interprets no suppression.
//
// BEST-EFFORT, NON-AUTHORITATIVE. Failure to enqueue NEVER rolls back, weakens or alters the completed
// consent command, and never changes the webhook's response.
//
// PRIVACY. The plaintext exists only in request memory. It leaves this process ONLY as an AES-256-GCM
// ciphertext, AAD-bound to the one intent it belongs to, expiring with it, purged on terminalization. No
// plaintext phone, raw payload, message body, provider secret or database error ever escapes.
// ============================================================================

import { randomUUID } from "crypto";

import { adminClient } from "../lib/supabase";
import { hashPhoneE164 } from "../lib/communication/phone";
import { normalizeMetaInboundWebhook } from "../lib/communication/providers/metaWhatsAppInbound";
import {
  AAD_SCHEMA_VERSION,
  canonicalAckAad,
  deriveAckExpiry,
  isValidAckAadFields,
  type AckAadFields,
} from "../lib/communication/consentAckIntent";
import { sealAckDestination } from "../lib/communication/consentAckDestinationSeal";
import {
  deriveProviderEventId,
  mapAdapterProviderToConsentProvider,
} from "../lib/communication/inboundConsentCommandInput";
import {
  ACK_CHANNEL,
  ACK_DESTINATION_SOURCE,
  CONSENT_ACK_TYPES,
  deriveConsentAckPlan,
  type AckCommand,
  type AckRejectReasonValue,
  type ConsentAckPlan,
  type ConsentCommandEvidence,
} from "../lib/communication/consentCommandResponse";

// ----------------------------------------------------------------------------
// Public input — ONLY verified, already-processed facts
// ----------------------------------------------------------------------------
/** The minimal shape of one D1-B processed item this service reads. */
export interface AckPersistedItem {
  readonly message: { readonly providerMessageId: string; readonly messageType: string };
  readonly receipt: {
    readonly inboundMessageId: string;
    readonly provider: string;
    readonly providerMessageId: string;
    readonly destinationHash: string;
    readonly receivedAt: string;
  };
}

/** The minimal shape of one D2-E COMPLETED command result this service reads. */
export interface AckCommandItem {
  readonly inboundMessageId: string;
  readonly command: string | null;
  readonly disposition: string;
  readonly replayed: boolean;
}

export interface ConsentCommandResponseInput {
  /** The ALREADY-VERIFIED, ALREADY-PARSED Meta payload. This service verifies nothing. */
  readonly payload: Record<string, unknown>;
  readonly webhookReceiptId: string | null;
  /** D1-B's durably-persisted items (the SUCCESSFUL persistence result). */
  readonly persisted: readonly AckPersistedItem[];
  /** D2-E's COMPLETED per-item command results. For STOP/START the D2-D writer result already exists. */
  readonly commands: readonly AckCommandItem[];
}

// ----------------------------------------------------------------------------
// Public output — sanitized. Never a phone, ciphertext, key id, hash, payload or DB error.
// ----------------------------------------------------------------------------
export type AckEnqueueOutcome =
  | "enqueued"
  | "duplicate"                 // the idempotency key already exists → safe no-op (a replay, or a retry)
  | "not_a_command"
  | "ineligible_disposition"
  | "replayed"
  | "invalid_evidence"
  | "destination_mismatch"
  | "provider_message_mismatch"
  | "unsupported_channel"
  | "receipt_not_found"         // STOP/START with no authoritative D2-D receipt → never enqueued
  | "seal_unavailable"          // encryption not configured / malformed → fail closed, consent untouched
  | "enqueue_failed";

export interface AckEnqueueItemResult {
  readonly inboundMessageId: string;
  readonly ackType: string | null;
  readonly outcome: AckEnqueueOutcome;
}

export interface ConsentCommandResponseResult {
  readonly candidates: number;
  readonly enqueued: number;
  readonly duplicates: number;
  readonly skipped: number;
  readonly failed: number;
  readonly items: readonly AckEnqueueItemResult[];
}

/** ALWAYS `ok: true`. Enqueue is BEST-EFFORT: it can never fail the inbound consent-command flow. */
export interface ConsentCommandResponseOutcome {
  readonly ok: true;
  readonly result: ConsentCommandResponseResult;
}

// ----------------------------------------------------------------------------
// Injectable collaborators
// ----------------------------------------------------------------------------
export interface AckIntentRow {
  readonly id: string;
  readonly idempotency_key: string;
  readonly consent_command_receipt_id: string | null;
  readonly inbound_message_id: string;
  readonly ack_type: string;
  readonly command: string;
  readonly authoritative_disposition: string;
  readonly provider: string;
  readonly canonical_provider_message_hash: string;
  readonly destination_hash: string;
  readonly sealed_destination_ciphertext: string;
  readonly sealed_destination_nonce: string;
  readonly sealed_destination_auth_tag: string;
  readonly encryption_key_id: string;
  readonly aad_schema_version: number;
  readonly received_at: string;
  readonly expires_at: string;
}

export type InsertIntentResult = "inserted" | "duplicate" | "failed";

export interface ConsentCommandResponseDeps {
  /**
   * Resolve the AUTHORITATIVE D2-D consent-command receipt for a STOP/START.
   * HELP writes no consent state (D2-D policy P3) and therefore has NO receipt — the receipts table only
   * accepts normalized_command in ('stop','start') — so HELP resolves to `null` WITHOUT a lookup.
   * A STOP/START whose receipt cannot be found is NEVER enqueued: the intent must bind to a real result.
   */
  readonly resolveReceiptId: (q: {
    readonly provider: string;
    readonly providerMessageId: string;
    readonly channel: string;
    /** The command being enqueued. The receipt MUST have written this exact command. */
    readonly normalizedCommand: string;
  }) => Promise<string | null>;
  /** Conflict-safe single-intent insert. A unique-key collision is a DUPLICATE, never an error. */
  readonly insertIntent: (row: AckIntentRow) => Promise<InsertIntentResult>;
  /** Seal the destination. Production binds AES-256-GCM with the environment key set. */
  readonly seal: typeof sealAckDestination;
}

export function defaultConsentCommandResponseDeps(): ConsentCommandResponseDeps {
  return {
    async resolveReceiptId({ provider, providerMessageId, channel, normalizedCommand }) {
      const db = adminClient();
      const { data, error } = await db
        .from("communication_consent_command_receipts")
        .select("id")
        // The unique key is (provider, provider_message_id, channel) — an EXACT lookup, never an
        // arbitrary first match. `normalized_command` is pinned too, so a STOP can never bind to a
        // START's authoritative receipt (or vice versa): a mismatch simply resolves to null.
        .eq("provider", provider)
        .eq("provider_message_id", providerMessageId)
        .eq("channel", channel)
        .eq("normalized_command", normalizedCommand)
        .maybeSingle();
      if (error) throw error;                     // caller converts to a CLOSED outcome; nothing leaks
      return (data?.id as string | undefined) ?? null;
    },

    async insertIntent(row) {
      const db = adminClient();
      const { error } = await db.from("communication_consent_ack_intents").insert(row);
      if (!error) return "inserted";
      // 23505 = unique_violation on idempotency_key → a replay or a concurrent webhook. Safe no-op.
      if ((error as { code?: string }).code === "23505") return "duplicate";
      return "failed";                            // the raw error NEVER escapes this module
    },

    seal: sealAckDestination,
  };
}

// ----------------------------------------------------------------------------
// Orchestration
// ----------------------------------------------------------------------------
const REJECT_TO_OUTCOME: Readonly<Record<AckRejectReasonValue, AckEnqueueOutcome>> = Object.freeze({
  NOT_A_COMMAND: "not_a_command",
  INELIGIBLE_DISPOSITION: "ineligible_disposition",
  REPLAYED_COMMAND: "replayed",
  INVALID_EVIDENCE: "invalid_evidence",
  DESTINATION_HASH_MISMATCH: "destination_mismatch",
  PROVIDER_MESSAGE_MISMATCH: "provider_message_mismatch",
  UNSUPPORTED_CHANNEL: "unsupported_channel",
});

const isAckCommand = (v: unknown): v is AckCommand => v === "stop" || v === "start" || v === "help";

/**
 * Persist AT MOST ONE durable acknowledgement intent per inbound command, then return. Sends NOTHING.
 * ALWAYS `ok: true` — a failure here can never turn a successful consent command into a webhook error.
 */
export async function enqueueConsentCommandResponses(
  input: ConsentCommandResponseInput,
  deps: ConsentCommandResponseDeps = defaultConsentCommandResponseDeps()
): Promise<ConsentCommandResponseOutcome> {
  const items: AckEnqueueItemResult[] = [];
  let enqueued = 0;
  let duplicates = 0;
  let failed = 0;

  const commands = Array.isArray(input?.commands) ? input.commands : [];
  const persisted = Array.isArray(input?.persisted) ? input.persisted : [];

  // Re-derive the sender destination IN REQUEST MEMORY, from the already-verified payload, using the SAME
  // pure normalizer D1-B used. This is the ONLY moment the plaintext exists. It leaves this process only as
  // an AAD-bound ciphertext — which is why D1-B's privacy contract needs no change.
  const normalized = normalizeMetaInboundWebhook(input?.payload ?? {});
  const plaintextByWamid = new Map<string, string>();
  for (const n of normalized) {
    if (n.ok) plaintextByWamid.set(n.message.providerMessageId, n.senderPhoneE164);
  }
  const persistedById = new Map<string, AckPersistedItem>();
  for (const p of persisted) {
    if (p?.receipt?.inboundMessageId) persistedById.set(p.receipt.inboundMessageId, p);
  }

  for (const cmd of commands) {
    if (!isAckCommand(cmd?.command)) continue;    // unsupported text / non-text is never answered

    const inboundMessageId = typeof cmd.inboundMessageId === "string" ? cmd.inboundMessageId : "";
    const item = persistedById.get(inboundMessageId);
    const push = (ackType: string | null, outcome: AckEnqueueOutcome): void => {
      items.push({ inboundMessageId, ackType, outcome });
    };

    if (!item) { push(null, "invalid_evidence"); failed++; continue; }

    // ── THE PROVIDER VOCABULARY BRIDGE ──────────────────────────────────────────────────────────────────
    // D1-B's receipt speaks the ADAPTER vocabulary: provider `meta_whatsapp_cloud`, and the RAW wamid.
    // D2-D's authoritative receipt speaks the CONSENT vocabulary: provider `meta_whatsapp`, and the
    // sha256 of that wamid (a raw wamid is base64 — it contains `+ / =` and cannot satisfy D2-D's
    // `^[A-Za-z0-9._:-]{1,200}$` fence). We must translate BOTH, or the intent could never be bound to the
    // authoritative receipt that D2-D actually wrote. The mapping is the existing CLOSED allowlist: an
    // unmapped adapter provider is REJECTED, never passed through.
    const consentProvider = mapAdapterProviderToConsentProvider(item.receipt.provider);
    if (!consentProvider) { push(null, "invalid_evidence"); failed++; continue; }
    const canonicalProviderMessageHash = deriveProviderEventId(item.receipt.providerMessageId);

    const evidence: ConsentCommandEvidence = {
      inboundMessageId,
      webhookReceiptId: input.webhookReceiptId ?? null,
      provider: consentProvider,
      providerMessageId: canonicalProviderMessageHash,   // the sha256 digest D2-E gave D2-D — never the wamid
      channel: ACK_CHANNEL,
      destinationHash: item.receipt.destinationHash,
      command: cmd.command,
      disposition: cmd.disposition,
      replayed: cmd.replayed,
      receivedAt: item.receipt.receivedAt,
    };

    // The plaintext is needed ONLY to seal the destination. Its hash MUST equal the persisted hash.
    const plaintext = plaintextByWamid.get(item.message.providerMessageId);
    let observedHash = "";
    if (typeof plaintext === "string" && plaintext !== "") {
      try { observedHash = hashPhoneE164(plaintext); } catch { observedHash = ""; }
    }

    // THE ONE GATE. Replay, ineligible disposition, evidence mismatch and channel are all rejected here.
    const planned = deriveConsentAckPlan(evidence, {
      destinationHash: observedHash,
      providerMessageId: canonicalProviderMessageHash,
    });
    if (!planned.ok) { push(null, REJECT_TO_OUTCOME[planned.reason]); continue; }

    const outcome = await enqueueOne(planned.plan, plaintext as string, deps);
    push(planned.plan.ackType, outcome);
    if (outcome === "enqueued") enqueued++;
    else if (outcome === "duplicate") duplicates++;
    else failed++;
  }

  const skipped = items.length - enqueued - duplicates - failed;
  return {
    ok: true,
    result: { candidates: items.length, enqueued, duplicates, skipped, failed, items },
  };
}

/**
 * Build and insert ONE durable intent. Order matters:
 *   1. resolve the AUTHORITATIVE receipt (STOP/START must have one; HELP has none by design);
 *   2. GENERATE THE INTENT UUID — before sealing, because the AAD binds to it;
 *   3. derive expiry from the PERSISTED received_at;
 *   4. seal the destination under that exact AAD;
 *   5. insert, conflict-safe.
 */
async function enqueueOne(
  plan: ConsentAckPlan,
  plaintextDestination: string,
  deps: ConsentCommandResponseDeps
): Promise<AckEnqueueOutcome> {
  const ev = plan.evidence;

  // 1) The authoritative D2-D receipt. HELP writes nothing, so it has no receipt and never looks one up.
  let receiptId: string | null = null;
  if (ev.command === "stop" || ev.command === "start") {
    try {
      receiptId = await deps.resolveReceiptId({
        provider: ev.provider,
        providerMessageId: ev.providerMessageId,
        channel: ev.channel,
        // EXACT COMMAND BINDING. A STOP acknowledgement may only bind to the receipt of a STOP.
        normalizedCommand: ev.command,
      });
    } catch {
      return "enqueue_failed";                 // DB error: closed outcome, nothing leaks, consent untouched
    }
    // An acknowledgement must bind to a REAL authoritative result for THIS command. A missing receipt — or
    // one written for the OTHER command — yields no intent at all.
    if (!receiptId) return "receipt_not_found";
  }

  // 2) The intent id is generated FIRST — the AAD binds the ciphertext to this exact row.
  const intentId = randomUUID();

  // 3) Expiry from the PERSISTED capture time: STOP/START +15 min, HELP +24 h.
  const expiresAt = deriveAckExpiry(ev.command, ev.receivedAt);
  if (!expiresAt) return "invalid_evidence";

  // 4) Seal. The AAD makes the ciphertext non-transplantable to any other intent.
  const aadFields: AckAadFields = {
    schemaVersion: AAD_SCHEMA_VERSION,
    intentId,
    consentCommandReceiptId: receiptId,
    inboundMessageId: ev.inboundMessageId,
    canonicalProviderMessageHash: ev.providerMessageId,
    destinationHash: plan.destinationHash,
    ackType: plan.ackType,
    expiresAt,
  };
  if (!isValidAckAadFields(aadFields)) return "invalid_evidence";

  // The AAD canonicalizes the expiry to an INSTANT, so the bytes are identical to the ones the WORKER will
  // rebuild from Postgres's `timestamptz` rendering. An unparseable expiry fails closed.
  const aad = canonicalAckAad(aadFields);
  if (!aad) return "invalid_evidence";

  const sealed = deps.seal(plaintextDestination, aad);
  if (!sealed.ok) return "seal_unavailable";   // not configured / malformed → fail closed. Consent stands.

  // 5) Insert. A unique collision on the idempotency key is a REPLAY — a safe no-op, never an error.
  const row: AckIntentRow = {
    id: intentId,
    idempotency_key: plan.idempotencyKey,
    consent_command_receipt_id: receiptId,
    inbound_message_id: ev.inboundMessageId,
    ack_type: plan.ackType,
    command: ev.command,
    authoritative_disposition: ev.disposition,
    provider: ev.provider,
    canonical_provider_message_hash: ev.providerMessageId,
    destination_hash: plan.destinationHash,
    sealed_destination_ciphertext: sealed.value.ciphertext,
    sealed_destination_nonce: sealed.value.nonce,
    sealed_destination_auth_tag: sealed.value.authTag,
    encryption_key_id: sealed.value.keyId,
    aad_schema_version: AAD_SCHEMA_VERSION,
    received_at: ev.receivedAt,
    expires_at: expiresAt,
  };

  let inserted: InsertIntentResult;
  try {
    inserted = await deps.insertIntent(row);
  } catch {
    return "enqueue_failed";
  }
  if (inserted === "duplicate") return "duplicate";
  if (inserted === "failed") return "enqueue_failed";
  return "enqueued";
}

/** The three acknowledgement types, re-exported for boundary tests. They are NOT in the D3-B registry. */
export const ACK_MESSAGE_TYPES = CONSENT_ACK_TYPES;
export { ACK_DESTINATION_SOURCE };
