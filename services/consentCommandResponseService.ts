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
    /**
     * Phase 8B-1B-C — THE SOLE ACCOUNT AUTHORITY for the acknowledgement intent.
     *
     * This is `PersistedInboundContext.providerAccountId`: the account STORED on the durable
     * `communication_inbound_messages` row, read back after persistence. The acknowledgement INHERITS it.
     * It is never the webhook envelope's decision, never an env WABA/phone value, never a fresh
     * `resolveOwningProviderAccount` result, never a `communication_provider_accounts` query, and never a
     * redelivery's proposed account. This service resolves ownership ZERO times.
     *
     * The type stays `string | null` because a historical LEGACY (pre-binding) inbound row can still be
     * read back carrying null — the database column is nullable and no backfill was performed.
     *
     * Phase 8B-1B-D6 Wave 2A-R1: a null is NO LONGER inherited. It is treated exactly like an omitted or
     * malformed value — an integrity failure that fails closed before any intent is written, yielding
     * `provider_account_context_missing`. See `inheritPersistedAccount`.
     */
    readonly providerAccountId: string | null;
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
  // Phase 8B-1B-C. The persisted inbound row carried no usable account context.
  // Phase 8B-1B-D6 Wave 2A-R1 WIDENED this outcome to cover an UNBOUND (null) parent as well as an omitted
  // or malformed one. In every case it is an integrity failure: ZERO intents are written and ownership is
  // never re-resolved.
  | "provider_account_context_missing"
  // Phase 8B-1B-C. An intent already exists under this idempotency key but is bound to a DIFFERENT account
  // than the stored inbound row. The existing row is authoritative: never updated, never reassigned, and no
  // second intent is inserted or acknowledged.
  | "provider_account_conflict"
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
  /**
   * Phase 8B-1B-C: INHERITED verbatim from the persisted inbound row. Bound at INSERT, never UPDATEd.
   * Phase 8B-1B-D6 Wave 2A-R1: NON-NULLABLE — an insert row carrying a null account is now
   * unconstructable. This is the type-level form of the future
   * `communication_consent_ack_intents_provider_account_required_check`.
   */
  readonly provider_account_id: string;
}

export type InsertIntentResult = "inserted" | "duplicate" | "failed";

/**
 * Phase 8B-1B-C — the read-back of an ALREADY-EXISTING intent under a given idempotency key.
 * `providerAccountId` is that row's STORED binding; `null` is a real legacy value, not an absence.
 */
export type StoredIntentRead =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly providerAccountId: string | null }
  | { readonly kind: "error" };

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
  /**
   * Phase 8B-1B-C — read back an existing intent by its GLOBAL idempotency key.
   *
   * The idempotency key and its UNIQUE constraint are UNCHANGED: they remain the replay fence. This read
   * exists only to CLASSIFY an already-existing row's account binding so a cross-account redelivery yields a
   * deterministic conflict instead of silently reusing another account's acknowledgement. It never writes.
   */
  readonly readStoredIntent: (idempotencyKey: string) => Promise<StoredIntentRead>;
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

    async readStoredIntent(idempotencyKey) {
      const db = adminClient();
      const { data, error } = await db
        .from("communication_consent_ack_intents")
        .select("provider_account_id")
        // EXACT lookup on the unique idempotency key — never a first-row / limit(1) selection.
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (error) return { kind: "error" };         // the raw error NEVER escapes this module
      if (!data) return { kind: "absent" };
      const raw = (data as { provider_account_id?: string | null }).provider_account_id ?? null;
      return { kind: "present", providerAccountId: raw };
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

/** Phase 8B-1B-C. The stored-account shape. Used to reject a malformed inherited value, never to derive one. */
const ACCOUNT_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Phase 8B-1B-C — INHERIT the account from the persisted inbound row. This is a READ, not a resolution.
 *
 * Phase 8B-1B-D6 Wave 2A-R1 — BINDING IS NOW MANDATORY (Class L closed).
 *
 * This function previously treated a stored `null` as a legitimate inheritance ("legacy pre-binding row")
 * and returned it as a SUCCESS, which let `enqueueOne` insert an acknowledgement intent with
 * `provider_account_id = NULL`. That is the Class L runtime gap. An acknowledgement intent must never be
 * written unless its persisted parent inbound message carries a proven owner, so a stored `null` is now
 * treated exactly like an absent or malformed value: an INTEGRITY FAILURE that fails closed.
 *
 * The three inputs and their single outcome each:
 *   • a valid UUID  → inherited VERBATIM (never re-derived, never substituted);
 *   • `null`        → missing (Wave 2A-R1: no longer a success);
 *   • absent / undefined / malformed → missing (unchanged).
 *
 * `value` is `string`, NOT `string | null`. The invariant is carried by the type system: it is not
 * possible to construct an `inherited` result — and therefore not possible to build an insert row —
 * carrying a null account. Re-widening this type is a compile-time-visible regression.
 *
 * Ownership is NEVER resolved here. This function performs no query, reads no environment value, and has
 * no default or fallback account. Its only input is the persisted row it is handed.
 */
type InheritedAccount =
  | { readonly kind: "inherited"; readonly value: string }
  | { readonly kind: "missing" };

function inheritPersistedAccount(receipt: AckPersistedItem["receipt"]): InheritedAccount {
  // Read through a widened view: a runtime caller can omit the field even though the contract requires it.
  const raw = (receipt as { providerAccountId?: string | null } | undefined)?.providerAccountId;
  if (typeof raw === "string" && ACCOUNT_ID_SHAPE.test(raw)) return { kind: "inherited", value: raw };
  // null (unbound parent) / undefined / absent / malformed → fail closed. There is NO success branch for a
  // parent that carries no proven owner.
  return { kind: "missing" };
}

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

    // ── THE ACCOUNT-INHERITANCE FENCE (Phase 8B-1B-C; tightened by 8B-1B-D6 Wave 2A-R1) ────────────────
    // Read the STORED account off the persisted inbound row BEFORE any acknowledgement work. An unbound
    // (null), missing or malformed value is an integrity failure: no receipt lookup, no seal, no insert.
    // Wave 2A-R1 closed the former "legacy null is inherited" success branch — binding is now MANDATORY.
    // Ownership is NEVER resolved here — this service holds no resolver and queries no accounts table.
    const inherited = inheritPersistedAccount(item.receipt);
    if (inherited.kind === "missing") {
      console.warn(
        "[consent_ack.provider_account_context_missing] a persisted inbound row carried no usable stored " +
        "account context; no acknowledgement intent was written."
      );
      push(null, "provider_account_context_missing");
      failed++;
      continue;
    }

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

    const outcome = await enqueueOne(planned.plan, plaintext as string, inherited.value, deps);
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
  /**
   * Phase 8B-1B-C: the INHERITED stored account, read verbatim off the persisted inbound row. Never
   * re-derived here.
   * Phase 8B-1B-D6 Wave 2A-R1: NON-NULLABLE. An unbound parent fails closed upstream in
   * `inheritPersistedAccount` and never reaches this function, so no unbound intent can be built.
   */
  providerAccountId: string,
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
    // BOUND AT INSERT to the stored inbound account. There is no UPDATE path for this column anywhere.
    provider_account_id: providerAccountId,
  };

  // READ-FIRST (Phase 8B-1B-C). The idempotency key is still the fence, but a bare insert can only tell us
  // "a row exists" — not WHICH account owns it. A redelivery attributed to a different account must not
  // silently count as this account's acknowledgement, so we classify the existing row first.
  const existing = await readStoredIntent(deps, plan.idempotencyKey);
  if (existing.kind === "error") return "enqueue_failed";
  if (existing.kind === "present") return classifyStoredIntent(existing.providerAccountId, providerAccountId);

  let inserted: InsertIntentResult;
  try {
    inserted = await deps.insertIntent(row);
  } catch {
    return "enqueue_failed";
  }
  if (inserted === "failed") return "enqueue_failed";
  if (inserted === "duplicate") {
    // A concurrent webhook won the unique key between our read and our insert. Re-read and classify the row
    // that actually landed — the winner is authoritative and is never updated or reassigned.
    const raced = await readStoredIntent(deps, plan.idempotencyKey);
    if (raced.kind === "error") return "enqueue_failed";
    if (raced.kind === "present") return classifyStoredIntent(raced.providerAccountId, providerAccountId);
    return "duplicate";
  }
  return "enqueued";
}

/** Never throws: a read failure is a CLOSED outcome, never an unbound continue. */
async function readStoredIntent(
  deps: ConsentCommandResponseDeps,
  idempotencyKey: string
): Promise<StoredIntentRead> {
  try {
    return await deps.readStoredIntent(idempotencyKey);
  } catch {
    return { kind: "error" };
  }
}

/**
 * The EXISTING row wins, always. The same account is an idempotent duplicate — no second intent, no second
 * acknowledgement. A different account is a deterministic conflict: the stored binding is preserved exactly
 * as-is, never upgraded, never reassigned.
 *
 * `storedAccountId` REMAINS nullable and must stay so: the database column is still nullable, and a row
 * written before Wave 2A-R1 may legitimately be read back carrying null. `inheritedAccountId` is now always
 * a real account, so a stored null can no longer compare equal to it — such a row is reported as a conflict
 * and left untouched. That is the intended outcome: an unbound historical intent is never "upgraded" into a
 * bound one, and no second intent is inserted alongside it.
 */
function classifyStoredIntent(
  storedAccountId: string | null,
  inheritedAccountId: string
): AckEnqueueOutcome {
  if (storedAccountId === inheritedAccountId) return "duplicate";
  console.warn(
    "[consent_ack.provider_account_conflict] an existing acknowledgement intent is bound to a different " +
    "provider account than the stored inbound row; it was left unchanged and nothing was enqueued."
  );
  return "provider_account_conflict";
}

/** The three acknowledgement types, re-exported for boundary tests. They are NOT in the D3-B registry. */
export const ACK_MESSAGE_TYPES = CONSENT_ACK_TYPES;
export { ACK_DESTINATION_SOURCE };
