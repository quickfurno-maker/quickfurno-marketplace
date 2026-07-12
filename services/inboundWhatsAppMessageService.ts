// ============================================================================
// QuickFurno — services/inboundWhatsAppMessageService.ts   (Phase 5F-D1-B, server-only)
//
// Durably CAPTURES already-verified Meta WhatsApp inbound messages. It is the callee of the
// verified Meta webhook orchestration boundary (services/metaWhatsAppWebhookService.ts): the
// CALLER has ALREADY read the bounded raw body, required the signature header, verified the
// HMAC-SHA256 over the exact raw body, required the runtime webhook-processing gate, parsed
// the JSON, and classified the payload as INBOUND_MESSAGE. THIS SERVICE VERIFIES NOTHING —
// it only captures.
//
// WHAT IT DOES: normalize (D1-A) → resolve identity (D1-A) → persist minimized rows, idempotent
// on the provider message id → best-effort receipt lifecycle → sanitized outcome.
//
// WHAT IT NEVER DOES: reply, send WhatsApp, mutate consent, process STOP/START/HELP, emit
// domain_events, enqueue outbox_events, call n8n, invoke Jarvis/AI, create conversations, or
// implement 24h-window policy. It captures only.
//
// TWO DE-DUPLICATION AUTHORITIES, DIFFERENT JOBS
//   • The whole-payload webhook RECEIPT is replay/monitoring metadata. A duplicate receipt is
//     REUSED — it NEVER short-circuits per-message processing. Doing so would permanently lose
//     a message that failed to persist on a prior attempt (A ok, B failed → Meta retries → a
//     blind receipt-duplicate return would drop B forever).
//   • The FINAL per-message correctness authority is the DB unique fence
//     `uq_comm_inbound_provider_message (provider, provider_message_id)`. A conflict on it is
//     an IDEMPOTENT DUPLICATE SUCCESS (no second row); any OTHER db error is a real failure.
//
// PARTIAL-BATCH RETRY. There is no cross-table transaction and no new RPC. Retry safety comes
// only from: durable receipt identity + the exact provider wamid + the unique fence +
// deterministic normalization + idempotent unique-conflict handling. So: first attempt A
// inserted, B db-error → receipt failed → 500; retry: A conflicts (duplicate success), B
// inserts → receipt processed → 200. No message is ever permanently lost.
// ============================================================================

import { adminClient } from "../lib/supabase";
import { isUniqueViolationOn } from "../lib/communication/dbErrors";
import { META_WHATSAPP_CLOUD_PROVIDER_KEY } from "../lib/communication/providers/metaCloudWhatsAppProvider";
import {
  deriveMetaWebhookEventId,
  metaWebhookPayloadHash,
} from "../lib/communication/providers/metaWhatsAppWebhook";
import {
  normalizeMetaInboundWebhook,
  type NormalizedInboundMessage,
  type NormalizedInboundResult,
} from "../lib/communication/providers/metaWhatsAppInbound";
import {
  IDENTITY_LOOKUP_FAILED,
  resolveInboundSenderIdentity,
  type InboundIdentityResolutionOutcome,
  type InboundIdentityResult,
} from "./inboundIdentityResolutionService";

/** The exact per-message unique fence name (matches the live D1-A schema). */
export const INBOUND_UNIQUE_FENCE = "uq_comm_inbound_provider_message";

/** The columns the live D1-A table accepts. NO plaintext sender phone / raw payload exists. */
export interface InboundInsertRow {
  readonly provider: string;
  readonly provider_message_id: string;
  readonly webhook_receipt_id: string | null;
  readonly sender_hash: string;
  readonly sender_masked: string;
  readonly resolved_principal_type: string | null;
  readonly resolved_principal_id: string | null;
  readonly identity_confidence: string;
  readonly message_type: string;
  readonly content_minimized: Record<string, unknown>;
  readonly provider_occurred_at: string | null;
  readonly processing_status: string;
}

/** A single per-message persistence outcome. */
export type InboundRowOutcome = "created" | "duplicate" | "failed";

/** Resolve-or-create result for the whole-payload receipt. */
export type ReceiptResolution =
  | { readonly ok: true; readonly receiptId: string; readonly duplicate: boolean }
  | { readonly ok: false };

/**
 * THE DURABLE ROW IS THE AUTHORITY.
 *
 * Every field below is read back from the PERSISTED `communication_inbound_messages` row — never from the
 * in-flight normalization of the request that happened to reach us. This matters on a REDELIVERY: the
 * unique fence means the ORIGINAL row wins, and a redelivered envelope whose body or identity differs
 * (a provider replay quirk, a re-resolved principal, a changed payload) must NEVER be able to overwrite,
 * contradict, or "refresh" what was durably captured. The stored row is the record of what actually
 * arrived; the redelivery is only a signal to look it up.
 *
 * `duplicate` distinguishes a freshly-inserted row from one that already existed. BOTH carry the SAME
 * durable id and the SAME stored facts, because both are read back through the same fence.
 */
export interface InboundPersistenceReceipt {
  readonly inboundMessageId: string;
  readonly provider: string;
  readonly providerMessageId: string;
  readonly duplicate: boolean;
  /** The PERSISTED `sender_hash`. Never a plaintext phone. */
  readonly destinationHash: string;
  readonly identityConfidence: string;
  readonly principalType: string | null;
  readonly principalId: string | null;
  /** The PERSISTED `received_at` — the durable capture time, not this request's clock. */
  readonly receivedAt: string;
  readonly providerOccurredAt: string | null;
}

/**
 * The message facts as DURABLY STORED (not as re-normalized from this request's envelope).
 *
 * `contentMinimized` is the same MINIMIZED content D1-A persisted; for a text message it carries the
 * message body. It is an INTERNAL, synchronous hand-off to the command layer — it is never logged, never
 * placed in a public/error outcome, and never returned to the provider. (`InboundPersistenceReceipt`, by
 * contrast, is body-free.)
 */
export interface PersistedInboundMessage {
  readonly provider: string;
  readonly providerMessageId: string;
  readonly messageType: string;
  readonly contentMinimized: Record<string, unknown>;
  readonly providerOccurredAt: string | null;
}

/** A durably-persisted inbound message paired with its sanitized persistence context. */
export interface InboundProcessedMessage {
  readonly message: PersistedInboundMessage;
  readonly receipt: InboundPersistenceReceipt;
}

/**
 * The validated projection of ONE durable row: the minimum authoritative fields the downstream layer
 * needs. Every field has been checked against the schema's own invariants before it is trusted.
 */
export interface PersistedInboundContext {
  readonly id: string;
  readonly provider: string;
  readonly providerMessageId: string;
  readonly senderHash: string;
  readonly identityConfidence: string;
  readonly principalType: string | null;
  readonly principalId: string | null;
  readonly messageType: string;
  readonly contentMinimized: Record<string, unknown>;
  readonly providerOccurredAt: string | null;
  readonly receivedAt: string;
}

/** The sanitized processing result. Every field is a count, an id, or a minimized message — never PII. */
export interface InboundProcessingResult {
  readonly receiptId: string | null;
  readonly receiptDuplicate: boolean;
  readonly messagesSeen: number;
  readonly messagesPersisted: number;
  readonly messagesDuplicate: number;
  readonly messagesRejected: number;
  readonly identityExact: number;
  readonly identityAmbiguous: number;
  readonly identityUnknown: number;
  /** Durably-stored messages + their sanitized context, in webhook order. Never a rejected message. */
  readonly processed: readonly InboundProcessedMessage[];
}

export type InboundServiceOutcome =
  | { readonly ok: true; readonly result: InboundProcessingResult }
  /**
   * A REAL processing failure (an operational identity-lookup failure, or a persistence failure —
   * NOT a duplicate): the webhook must return 500 so Meta retries. `code` is a stable, sanitized
   * identifier (never a raw DB error, phone, or message content).
   */
  | { readonly ok: false; readonly code: string; readonly result: InboundProcessingResult };

// ----------------------------------------------------------------------------
// Injectable collaborators — production defaults bind the real read/write boundary
// ----------------------------------------------------------------------------
export interface InboundWhatsAppDeps {
  readonly normalize: (payload: Record<string, unknown>) => NormalizedInboundResult[];
  readonly resolveIdentity: (input: { readonly senderPhoneE164: string }) => Promise<InboundIdentityResolutionOutcome>;
  readonly createOrResolveReceipt: (rawBody: string, payload: Record<string, unknown>) => Promise<ReceiptResolution>;
  readonly persistInboundRow: (row: InboundInsertRow) => Promise<InboundRowOutcome>;
  readonly finalizeReceipt: (receiptId: string, status: string, reason?: string) => Promise<void>;
  /**
   * OPTIONAL. Read back the DURABLE row through the unique fence and return its VALIDATED projection.
   * Production ALWAYS binds it (see `defaultInboundWhatsAppDeps`); it is optional purely so a caller that
   * injects a partial dependency set — and therefore wants no downstream context — keeps the original
   * capture-only contract. When bound, a row that cannot be resolved to EXACTLY ONE VALID durable row is
   * a RETRYABLE failure: nothing is ever invented, and the transient in-flight row is never substituted.
   */
  readonly resolvePersistedInboundContext?: (row: InboundInsertRow) => Promise<PersistedInboundContext | null>;
}

export function defaultInboundWhatsAppDeps(): InboundWhatsAppDeps {
  return {
    normalize: normalizeMetaInboundWebhook,
    resolveIdentity: (input) => resolveInboundSenderIdentity(input),
    createOrResolveReceipt: (rawBody, payload) => createOrResolveReceiptViaDb(rawBody, payload),
    persistInboundRow: (row) => persistInboundRowViaDb(row),
    finalizeReceipt: (receiptId, status, reason) => finalizeReceiptViaDb(receiptId, status, reason),
    resolvePersistedInboundContext: (row) => resolvePersistedInboundContextViaDb(row),
  };
}

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------
const emptyResult = (): InboundProcessingResult => ({
  receiptId: null,
  receiptDuplicate: false,
  messagesSeen: 0,
  messagesPersisted: 0,
  messagesDuplicate: 0,
  messagesRejected: 0,
  identityExact: 0,
  identityAmbiguous: 0,
  identityUnknown: 0,
  processed: [],
});

/** The processing_status a resolved identity maps to. */
function processingStatusFor(confidence: string): string {
  if (confidence === "exact") return "identity_resolved";
  if (confidence === "ambiguous") return "identity_ambiguous";
  return "identity_unknown";
}

/**
 * Map a valid normalized message + its identity to the durable row. The plaintext sender phone
 * (`senderPhoneE164`) is NEVER read here — only `senderHash`/`senderMasked`. A principal is
 * carried ONLY on an EXACT identity: ambiguous/unknown ALWAYS get a null pair, mirroring the
 * schema CHECK, so a resolver bug can never smuggle a principal onto a non-exact row.
 */
export function buildInboundRow(
  message: NormalizedInboundMessage,
  identity: InboundIdentityResult,
  receiptId: string | null
): InboundInsertRow {
  const isExact = identity.confidence === "exact";
  return {
    provider: message.provider,
    provider_message_id: message.providerMessageId,
    webhook_receipt_id: receiptId,
    sender_hash: message.senderHash,
    sender_masked: message.senderMasked,
    resolved_principal_type: isExact ? identity.principalType : null,
    resolved_principal_id: isExact ? identity.principalId : null,
    identity_confidence: identity.confidence,
    message_type: message.messageType,
    content_minimized: message.contentMinimized,
    provider_occurred_at: message.providerOccurredAt,
    processing_status: processingStatusFor(identity.confidence),
  };
}

// ----------------------------------------------------------------------------
// The orchestration
// ----------------------------------------------------------------------------
/**
 * Capture an already-verified, already-parsed Meta INBOUND_MESSAGE payload. Returns a
 * sanitized outcome; `ok:false` means a REAL persistence failure (→ webhook 500 → Meta retry).
 */
export async function handleInboundWhatsAppMessages(
  input: { readonly rawBody: string; readonly payload: Record<string, unknown> },
  deps: InboundWhatsAppDeps = defaultInboundWhatsAppDeps()
): Promise<InboundServiceOutcome> {
  // 1) Deterministic normalization of EVERY message in the webhook.
  const normalized = deps.normalize(input.payload);
  const counts = { ...emptyResult(), messagesSeen: normalized.length };

  // 2) Resolve or create the whole-payload receipt. A failure to obtain a usable receipt fails
  //    CLOSED (→ 500), so the webhook is retried rather than acking a partially-captured batch.
  const receipt = await deps.createOrResolveReceipt(input.rawBody, input.payload);
  if (!receipt.ok) return { ok: false, code: "inbound_receipt_unavailable", result: counts };
  const receiptId = receipt.receiptId;
  let result: InboundProcessingResult = { ...counts, receiptId, receiptDuplicate: receipt.duplicate };

  const processed: InboundProcessedMessage[] = [];

  // 3) Per-message processing. A DUPLICATE receipt does NOT skip this loop — the per-message
  //    unique fence is the correctness authority, so re-processing a redelivery is idempotent.
  //    The FIRST stable failure reason (retryable) wins; every message is still attempted.
  let failureReason: string | null = null;
  for (const item of normalized) {
    if (!item.ok) {
      // DETERMINISTIC rejection (missing id / non-normalizable sender). NO row, NO fabricated id,
      // NO raw phone/content surfaced, and NOT a retryable failure. Continue with the batch.
      result = { ...result, messagesRejected: result.messagesRejected + 1 };
      continue;
    }

    // Identity resolution uses the REQUEST-MEMORY-ONLY sender phone (never persisted/logged). An
    // OPERATIONAL lookup failure (or a thrown dependency) is NOT durable UNKNOWN: the message is
    // NOT persisted, and the batch becomes a RETRYABLE failure so a retry can resolve it correctly.
    let resolution: InboundIdentityResolutionOutcome;
    try {
      resolution = await deps.resolveIdentity({ senderPhoneE164: item.senderPhoneE164 });
    } catch {
      resolution = { ok: false, code: IDENTITY_LOOKUP_FAILED };
    }
    if (!resolution.ok) {
      // Never fabricate identity_unknown from an infrastructure failure. Do NOT persist.
      failureReason = failureReason ?? "identity_lookup_failed";
      continue;
    }
    const identity: InboundIdentityResult = resolution.identity;
    if (identity.confidence === "exact") result = { ...result, identityExact: result.identityExact + 1 };
    else if (identity.confidence === "ambiguous") result = { ...result, identityAmbiguous: result.identityAmbiguous + 1 };
    else result = { ...result, identityUnknown: result.identityUnknown + 1 };

    const row = buildInboundRow(item.message, identity, receiptId);
    const outcome = await deps.persistInboundRow(row);
    if (outcome === "created") result = { ...result, messagesPersisted: result.messagesPersisted + 1 };
    else if (outcome === "duplicate") result = { ...result, messagesDuplicate: result.messagesDuplicate + 1 };
    else {
      failureReason = failureReason ?? "inbound_persist_failed"; // a real (non-idempotency) db error
      continue;
    }

    // THE PERSISTED ROW IS THE AUTHORITY — for a fresh INSERT and for a DUPLICATE alike.
    //
    // We read the durable row back through the unique fence and derive ALL downstream context from it.
    // We deliberately do NOT reuse `item.message` (this request's freshly-normalized envelope) or
    // `identity` (this request's freshly-resolved principal): on a REDELIVERY those describe the RETRY,
    // not what was durably captured. If a redelivered envelope carried different content or resolved to a
    // different principal, trusting it would let a later replay silently contradict the stored record.
    //
    // Resolution is attempted only when the adapter is bound (production always binds it). Nothing is ever
    // invented: zero rows, multiple rows, a malformed row, or a db error all yield null → a RETRYABLE
    // failure, so a retry can resolve it correctly rather than dropping the message downstream.
    if (!deps.resolvePersistedInboundContext) continue;
    let persistedRow: PersistedInboundContext | null;
    try { persistedRow = await deps.resolvePersistedInboundContext(row); }
    catch { persistedRow = null; }
    if (!persistedRow) { failureReason = failureReason ?? "inbound_persisted_row_unresolved"; continue; }
    processed.push({
      message: {
        provider: persistedRow.provider,
        providerMessageId: persistedRow.providerMessageId,
        messageType: persistedRow.messageType,
        contentMinimized: persistedRow.contentMinimized,
        providerOccurredAt: persistedRow.providerOccurredAt,
      },
      receipt: {
        inboundMessageId: persistedRow.id,
        provider: persistedRow.provider,
        providerMessageId: persistedRow.providerMessageId,
        duplicate: outcome === "duplicate",
        destinationHash: persistedRow.senderHash,
        identityConfidence: persistedRow.identityConfidence,
        principalType: persistedRow.principalType,
        principalId: persistedRow.principalId,
        receivedAt: persistedRow.receivedAt,
        providerOccurredAt: persistedRow.providerOccurredAt,
      },
    });
  }
  result = { ...result, processed };

  // 4) Finalize the receipt (best-effort; a finalize/count failure never corrupts correctness).
  //    A real processing failure (identity infra OR persistence OR an unresolvable row id) → receipt
  //    failed, ok:false, → 500. Already-persisted messages are NEVER rolled back; a retry idempotently
  //    resumes via the per-message unique fence.
  if (failureReason) {
    await safe(deps.finalizeReceipt(receiptId, "failed", failureReason));
    return { ok: false, code: failureReason, result };
  }
  if (result.messagesPersisted === 0 && result.messagesDuplicate === 0 && result.messagesRejected > 0) {
    // Every message was a DETERMINISTIC rejection: ack it (200) rather than retry forever.
    await safe(deps.finalizeReceipt(receiptId, "rejected", "inbound_deterministic_rejected"));
    return { ok: true, result };
  }
  await safe(deps.finalizeReceipt(receiptId, "processed"));
  return { ok: true, result };
}

function safe(p: Promise<unknown>): Promise<void> {
  return p.then(() => undefined, () => undefined);
}

// ----------------------------------------------------------------------------
// Real DB adapters (exported for testing with an injectable client)
// ----------------------------------------------------------------------------
type DbClient = typeof adminClient;

/**
 * Insert one minimized inbound row. A unique conflict on the per-message fence is an IDEMPOTENT
 * DUPLICATE SUCCESS (no second row, no reply, no event). Any OTHER db error is a real failure —
 * an unrelated unique violation is NOT swallowed blindly (the exact fence name is checked).
 */
export async function persistInboundRowViaDb(row: InboundInsertRow, client: DbClient = adminClient): Promise<InboundRowOutcome> {
  try {
    const { error } = await client().from("communication_inbound_messages").insert(row);
    if (!error) return "created";
    if (isUniqueViolationOn(error, INBOUND_UNIQUE_FENCE)) return "duplicate";
    return "failed";
  } catch (e) {
    if (isUniqueViolationOn(e, INBOUND_UNIQUE_FENCE)) return "duplicate";
    return "failed";
  }
}

// ----------------------------------------------------------------------------
// The DURABLE-ROW resolver (the authority for all downstream context)
// ----------------------------------------------------------------------------
/** The exact columns the downstream layer needs. Nothing more is read — no masked phone, no raw payload. */
export const PERSISTED_CONTEXT_COLUMNS =
  "id, provider, provider_message_id, sender_hash, resolved_principal_type, resolved_principal_id, " +
  "identity_confidence, message_type, content_minimized, provider_occurred_at, received_at";

const ROW_UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROW_HEX64 = /^[0-9a-f]{64}$/;                 // lowercase, exactly as the schema CHECK requires
const ROW_MESSAGE_TYPE = /^[a-z_]{1,32}$/;
const ROW_PRINCIPAL_TYPES: readonly string[] = ["client", "vendor", "admin"];
const ROW_CONFIDENCES: readonly string[] = ["exact", "ambiguous", "unknown"];
/**
 * A timezone-qualified RFC3339 instant — the EXACT shape PostgREST emits for a `timestamptz`, and the
 * exact shape the downstream layer will accept. Shape only: the calendar/range round-trip is applied
 * downstream. Deliberately IDENTICAL to that downstream shape, so a row whose timestamp the downstream
 * layer could not use is caught HERE as a RETRYABLE malformed row, rather than surviving to become a
 * DETERMINISTIC drop later.
 */
const ROW_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Validate ONE durable row against the schema's OWN invariants before any of it is trusted. A row that
 * disagrees with the schema is NOT evidence — it is returned as null (→ a RETRYABLE failure), never
 * repaired, never partially accepted, and never substituted with the in-flight values.
 *
 * `fence` is the (provider, provider_message_id) pair we queried by: the row MUST be the row we asked
 * for, so a mis-filtered or mis-joined result can never masquerade as the durable record.
 *
 * Exported pure so it can be proven directly.
 */
export function validatePersistedInboundRow(
  raw: unknown,
  fence: { readonly provider: string; readonly providerMessageId: string }
): PersistedInboundContext | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const id = r.id;
  if (typeof id !== "string" || !ROW_UUID_SHAPE.test(id)) return null;

  const provider = r.provider;
  const providerMessageId = r.provider_message_id;
  if (typeof provider !== "string" || provider !== fence.provider) return null;
  if (typeof providerMessageId !== "string" || providerMessageId !== fence.providerMessageId) return null;

  const senderHash = r.sender_hash;
  if (typeof senderHash !== "string" || !ROW_HEX64.test(senderHash)) return null;

  const identityConfidence = r.identity_confidence;
  if (typeof identityConfidence !== "string" || !ROW_CONFIDENCES.includes(identityConfidence)) return null;

  // The COMPLETE identity invariant, mirroring the schema CHECK: exact ⟺ both principal fields present;
  // ambiguous/unknown ⟹ both null. A partially-populated pair matches neither branch and is rejected.
  const principalType = r.resolved_principal_type ?? null;
  const principalId = r.resolved_principal_id ?? null;
  if (identityConfidence === "exact") {
    if (typeof principalType !== "string" || !ROW_PRINCIPAL_TYPES.includes(principalType)) return null;
    if (typeof principalId !== "string" || !ROW_UUID_SHAPE.test(principalId)) return null;
  } else if (principalType !== null || principalId !== null) {
    return null;
  }

  const messageType = r.message_type;
  if (typeof messageType !== "string" || !ROW_MESSAGE_TYPE.test(messageType)) return null;

  const contentMinimized = r.content_minimized;
  if (!contentMinimized || typeof contentMinimized !== "object" || Array.isArray(contentMinimized)) return null;

  const providerOccurredAt = r.provider_occurred_at ?? null;
  if (providerOccurredAt !== null && (typeof providerOccurredAt !== "string" || !ROW_INSTANT.test(providerOccurredAt))) return null;

  // `received_at` is NOT NULL in the schema — a row without a usable capture time is not trustworthy.
  const receivedAt = r.received_at;
  if (typeof receivedAt !== "string" || !ROW_INSTANT.test(receivedAt)) return null;

  return {
    id,
    provider,
    providerMessageId,
    senderHash,
    identityConfidence,
    principalType: identityConfidence === "exact" ? (principalType as string) : null,
    principalId: identityConfidence === "exact" ? (principalId as string) : null,
    messageType,
    contentMinimized: contentMinimized as Record<string, unknown>,
    providerOccurredAt: providerOccurredAt as string | null,
    receivedAt,
  };
}

/**
 * Read back the DURABLE row through the unique fence (provider, provider_message_id) and return its
 * VALIDATED projection. Used for BOTH the insert path and the duplicate path, so the durable row — never
 * the in-flight redelivery — is the single authority for everything downstream.
 *
 * Equality filters ONLY (a provider-supplied id is never spliced into PostgREST filter syntax), and NO
 * `.single()`/`.limit()` — cardinality is PRESERVED so an impossible multi-row result is VISIBLE rather
 * than silently collapsed to the first row.
 *
 *   • exactly one VALID row → its projection (the SAME row for insert and duplicate);
 *   • zero rows             → not durably there; NEVER invent one;
 *   • more than one row     → the fence is violated; NEVER guess which is authoritative;
 *   • a malformed row       → not evidence; NEVER repair it;
 *   • a db error            → unknown; NEVER assume.
 * All four return null, and the caller turns that into a RETRYABLE failure.
 */
export async function resolvePersistedInboundContextViaDb(
  row: InboundInsertRow,
  client: DbClient = adminClient
): Promise<PersistedInboundContext | null> {
  try {
    const { data, error } = await client()
      .from("communication_inbound_messages")
      .select(PERSISTED_CONTEXT_COLUMNS)
      .eq("provider", row.provider)
      .eq("provider_message_id", row.provider_message_id);
    if (error) return null;
    const rows = (data ?? []) as unknown[];
    if (rows.length !== 1) return null;
    return validatePersistedInboundRow(rows[0], {
      provider: row.provider,
      providerMessageId: row.provider_message_id,
    });
  } catch {
    return null;
  }
}

/**
 * Insert the whole-payload receipt as `verified`, letting the receipt unique indexes decide a
 * duplicate. On conflict the EXISTING receipt is found (equality filters only — a provider-
 * supplied event id is NEVER spliced into PostgREST filter syntax) and its diagnostic
 * `duplicate_count` is bumped best-effort. A receipt that cannot be created or resolved to a
 * usable id fails CLOSED.
 */
export async function createOrResolveReceiptViaDb(
  rawBody: string,
  payload: Record<string, unknown>,
  client: DbClient = adminClient
): Promise<ReceiptResolution> {
  const row = {
    provider: META_WHATSAPP_CLOUD_PROVIDER_KEY,
    provider_event_id: deriveMetaWebhookEventId(payload),
    payload_hash: metaWebhookPayloadHash(rawBody),
    signature_valid: true,
    processing_status: "verified",
  };
  try {
    const { data, error } = await client()
      .from("communication_webhook_receipts")
      .insert(row)
      .select("id, duplicate_count")
      .single();
    if (!error && data) return { ok: true, receiptId: String((data as { id: string }).id), duplicate: false };
    if (error && isUniqueViolationOn(error, "comm_webhook_receipt")) {
      const existing = await findExistingReceipt(row, client);
      if (!existing) return { ok: false };
      await safe(
        client()
          .from("communication_webhook_receipts")
          .update({ duplicate_count: (existing.duplicate_count ?? 0) + 1, last_duplicate_at: new Date().toISOString() })
          .eq("id", existing.id) as unknown as Promise<unknown>
      );
      return { ok: true, receiptId: String(existing.id), duplicate: true };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

interface ExistingReceipt { readonly id: string; readonly duplicate_count: number | null }

/** Find the receipt a unique violation collided with, using ONLY equality filters. */
async function findExistingReceipt(
  row: { provider: string; provider_event_id: string | null; payload_hash: string; signature_valid: boolean },
  client: DbClient
): Promise<ExistingReceipt | null> {
  const scoped = () =>
    client()
      .from("communication_webhook_receipts")
      .select("id, duplicate_count")
      .eq("provider", row.provider)
      .eq("signature_valid", row.signature_valid);

  if (row.provider_event_id) {
    const byEvent = await scoped().eq("provider_event_id", row.provider_event_id).limit(1);
    const hit = ((byEvent.data ?? []) as ExistingReceipt[])[0];
    if (hit) return hit;
  }
  const byPayload = await scoped().eq("payload_hash", row.payload_hash).limit(1);
  return ((byPayload.data ?? []) as ExistingReceipt[])[0] ?? null;
}

/** Best-effort receipt finalization. Never a correctness input. */
export async function finalizeReceiptViaDb(receiptId: string, status: string, reason?: string, client: DbClient = adminClient): Promise<void> {
  const updates: Record<string, unknown> = { processing_status: status, processed_at: new Date().toISOString() };
  if (reason) updates.failure_reason_sanitized = reason;
  await safe(client().from("communication_webhook_receipts").update(updates).eq("id", receiptId) as unknown as Promise<unknown>);
}
