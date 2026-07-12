// ============================================================================
// QuickFurno — services/metaWhatsAppWebhookService.ts  (Phase 5F-B, server-only)
//
// Orchestrates the Meta WhatsApp Cloud webhook in a strict FAIL-CLOSED order:
//   signature header → server config → raw-body signature verification →
//   runtime webhook-processing gate → JSON parse → classification →
//   (delivery) CommunicationService lifecycle | (inbound) persist then process |
//   (known non-delivery) safe ack.
//
// INBOUND MESSAGES (Phase 5F-D1-B → 5F-D2-E). An inbound payload is no longer merely
// acknowledged. It is:
//   1. durably PERSISTED FIRST by D1-B (the row is the provider-event record of record);
//   2. then handed to the D2-E orchestrator, which interprets ONLY a complete TEXT command
//      token (STOP / START / HELP); HELP, unsupported text and non-text never reach a writer.
//   3. D2-D remains the SOLE writer of STOP/START consent state, behind that orchestrator.
// This service holds NO consent policy, performs NO consent mutation, calls NO RPC, never
// imports the D2-D writer, and never consults D2-C (send authorization is not a concern here).
// It SENDS NOTHING — not even a HELP acknowledgement — and touches no n8n and no Jarvis.
//
// Never logs raw body / phone / WhatsApp id / token / signature / App Secret /
// message content. JSON is NEVER parsed before the signature is verified. Template /
// account payloads are classified and acknowledged only — no lifecycle mutation, no
// outbound send, no n8n, no Jarvis. Delivery de-duplication + forward-only lifecycle are
// reused from CommunicationService (Phase 5B protections).
// ============================================================================

import { adminClient } from "../lib/supabase";
import { CommunicationService } from "./communicationService";
import { isWebhookProcessingEnabled } from "./communicationProviderRuntimeService";
import {
  resolveWebhookSignatureConfig,
  resolveWebhookVerifyConfig,
  webhookSignatureToRuntime,
} from "../lib/communication/providers/metaCloudWhatsAppConfig";
import {
  MetaCloudWhatsAppProvider,
  META_WHATSAPP_CLOUD_PROVIDER_KEY,
} from "../lib/communication/providers/metaCloudWhatsAppProvider";
import { FetchHttpTransport } from "../lib/communication/httpTransport";
import {
  classifyMetaWebhook,
  deriveMetaWebhookEventId,
  metaWebhookPayloadHash,
  verifyMetaWebhookSignature,
  MetaWebhookClassification,
} from "../lib/communication/providers/metaWhatsAppWebhook";
import { handleInboundWhatsAppMessages } from "./inboundWhatsAppMessageService";
import { processInboundConsentCommands } from "./inboundConsentCommandService";

const CHANNEL = "whatsapp";

export type MetaWebhookPostOutcome =
  | {
      readonly status: 200;
      readonly result:
        | "delivery_processed"
        | "duplicate"
        | "acknowledged_ignored"
        | "acknowledged_unknown"
        // Phase 5F-D1-B — verified INBOUND_MESSAGE capture outcomes.
        | "inbound_processed"
        | "inbound_duplicate"
        | "inbound_acknowledged_rejected";
    }
  | { readonly status: 400 | 401 | 403 | 500 | 503; readonly code: string };

function safeParse(rawBody: string): Record<string, unknown> | null {
  if (typeof rawBody !== "string" || rawBody.trim() === "") return null;
  try {
    const v: unknown = JSON.parse(rawBody);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort ignored-receipt record for a verified but not-processed payload (a
 * known non-delivery class, or an unknown-but-verified structure). Records only the
 * safe `ignored` status + a sanitized reason — NEVER the raw inbound message content.
 */
async function recordIgnoredReceipt(
  rawBody: string,
  payload: Record<string, unknown>,
  reason: "ignored_non_delivery" | "ignored_unknown"
): Promise<void> {
  try {
    await adminClient()
      .from("communication_webhook_receipts")
      .insert({
        provider: META_WHATSAPP_CLOUD_PROVIDER_KEY,
        provider_event_id: deriveMetaWebhookEventId(payload),
        payload_hash: metaWebhookPayloadHash(rawBody),
        signature_valid: true,
        processing_status: "ignored",
        failure_reason_sanitized: reason,
      });
  } catch {
    /* best effort — a duplicate simply means we have already acknowledged it */
  }
}

/**
 * Handle a verified Meta webhook POST. `signature` is the raw `X-Hub-Signature-256`
 * header value. Fails closed at every step. POST needs ONLY the app secret for
 * signature verification — never the access token or `outbound_enabled`.
 */
export async function handleMetaWhatsAppWebhookPost(input: {
  readonly rawBody: string;
  readonly signature: string | null;
}): Promise<MetaWebhookPostOutcome> {
  // Step 2 — a signature header is required.
  if (!input.signature) return { status: 401, code: "missing_signature" };

  // Step 3 — server POST-signature config (app secret ONLY; no access token needed).
  const sigConfig = resolveWebhookSignatureConfig();
  if (!sigConfig.ok) return { status: 503, code: "provider_not_configured" };
  const appSecret = sigConfig.config.appSecret;

  // Step 4 — verify the signature against the EXACT raw body, before any JSON parse.
  if (!verifyMetaWebhookSignature(input.rawBody, input.signature, appSecret)) {
    return { status: 401, code: "invalid_signature" };
  }

  // Step 5 — runtime webhook-processing gate (independent of outbound_enabled).
  const enabled = await isWebhookProcessingEnabled(META_WHATSAPP_CLOUD_PROVIDER_KEY, CHANNEL);
  if (!enabled) return { status: 503, code: "webhook_processing_disabled" };

  // Step 6 — parse (now safe: signature verified).
  const payload = safeParse(input.rawBody);
  if (!payload) return { status: 400, code: "unparseable" };

  // Step 7 — classify.
  const classification = classifyMetaWebhook(payload);

  // Step 8 — delivery status is processed; everything else is safely acknowledged.
  if (classification === MetaWebhookClassification.DELIVERY_STATUS) {
    // A webhook-only provider carrying just the app secret — sending is impossible.
    const provider = new MetaCloudWhatsAppProvider(webhookSignatureToRuntime({ appSecret }), new FetchHttpTransport());
    const service = new CommunicationService(provider);
    const res = await service.processWebhook(input.rawBody, input.signature, appSecret);
    if (!res.ok) return { status: 500, code: "processing_failed" };
    return { status: 200, result: res.data.duplicate ? "duplicate" : "delivery_processed" };
  }

  if (classification === MetaWebhookClassification.UNKNOWN) {
    // Verified but unrecognised structure — NEVER guess a lifecycle effect. Record an
    // ignored-unknown receipt and ACKNOWLEDGE (200); no mutation, no send, no n8n.
    await recordIgnoredReceipt(input.rawBody, payload, "ignored_unknown");
    return { status: 200, result: "acknowledged_unknown" };
  }

  if (classification === MetaWebhookClassification.INBOUND_MESSAGE) {
    // Phase 5F-D1-B — PERSIST FIRST. The already-verified payload is durably CAPTURED (normalize →
    // resolve identity → persist minimized rows, idempotent on the provider message id). A real
    // persistence failure returns 500 so Meta retries (the per-message unique fence makes a retry make
    // progress); a deterministic all-rejected batch is acknowledged so Meta does not retry forever.
    const inbound = await handleInboundWhatsAppMessages({ rawBody: input.rawBody, payload });
    if (!inbound.ok) return { status: 500, code: "inbound_processing_failed" };

    // Phase 5F-D2-E — THEN INTERPRET. Persistence has already succeeded, so a durable row exists for
    // every message below, and `processed` is derived from those PERSISTED rows (never from this
    // request's transient normalization — a redelivery must never overwrite the stored record).
    //
    // Command processing runs SYNCHRONOUSLY here. This webhook re-reads no raw body, holds no consent
    // policy, mutates no consent state, calls no RPC, and sends nothing. It knows ONLY the orchestrator;
    // the D2-D writer, the RPC and the policy all stay behind that boundary, and D2-C is never consulted.
    //
    // A RETRYABLE command failure → 500 → Meta retries the whole verified path, which is CONVERGENT:
    // D1-B's unique fence makes re-persistence idempotent and D2-D's receipt makes the re-write a replay.
    // DETERMINISTIC outcomes (HELP / unsupported / non-text / a rejected or conflicting command) are
    // ACKNOWLEDGED below — the persisted row is their durable record, and retrying could never help.
    const commands = await processInboundConsentCommands(inbound.result.processed);
    if (!commands.ok) return { status: 500, code: "inbound_command_processing_failed" };

    const r = inbound.result;
    if (r.messagesPersisted === 0 && r.messagesDuplicate === 0 && r.messagesRejected > 0) {
      return { status: 200, result: "inbound_acknowledged_rejected" };
    }
    if (r.messagesPersisted === 0 && r.messagesDuplicate > 0) {
      return { status: 200, result: "inbound_duplicate" };
    }
    return { status: 200, result: "inbound_processed" };
  }

  // template_status / account_status — later phases own these. Acknowledge safely: NO lifecycle
  // mutation, NO outbound send, NO n8n, NO Jarvis.
  await recordIgnoredReceipt(input.rawBody, payload, "ignored_non_delivery");
  return { status: 200, result: "acknowledged_ignored" };
}

/** Resolve the server-only webhook verify token — needs ONLY the verify token. */
export function getWebhookVerifyToken(): string | null {
  const res = resolveWebhookVerifyConfig();
  return res.ok ? res.config.webhookVerifyToken : null;
}
