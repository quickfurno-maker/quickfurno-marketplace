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

/** The sanitized processing result. Every field is a count or an id — never PII. */
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
}

export function defaultInboundWhatsAppDeps(): InboundWhatsAppDeps {
  return {
    normalize: normalizeMetaInboundWebhook,
    resolveIdentity: (input) => resolveInboundSenderIdentity(input),
    createOrResolveReceipt: (rawBody, payload) => createOrResolveReceiptViaDb(rawBody, payload),
    persistInboundRow: (row) => persistInboundRowViaDb(row),
    finalizeReceipt: (receiptId, status, reason) => finalizeReceiptViaDb(receiptId, status, reason),
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

    const outcome = await deps.persistInboundRow(buildInboundRow(item.message, identity, receiptId));
    if (outcome === "created") result = { ...result, messagesPersisted: result.messagesPersisted + 1 };
    else if (outcome === "duplicate") result = { ...result, messagesDuplicate: result.messagesDuplicate + 1 };
    else failureReason = failureReason ?? "inbound_persist_failed"; // a real (non-idempotency) db error
  }

  // 4) Finalize the receipt (best-effort; a finalize/count failure never corrupts correctness).
  //    A real processing failure (identity infra OR persistence) → receipt failed, ok:false, → 500.
  //    Already-persisted messages in the batch are NEVER rolled back; a retry idempotently resumes.
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
