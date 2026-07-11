// ============================================================================
// QuickFurno — services/metaWhatsAppWebhookService.ts  (Phase 5F-B, server-only)
//
// Orchestrates the Meta WhatsApp Cloud webhook in a strict FAIL-CLOSED order:
//   signature header → server config → raw-body signature verification →
//   runtime webhook-processing gate → JSON parse → classification →
//   (delivery) CommunicationService lifecycle | (known non-delivery) safe ack.
//
// Never logs raw body / phone / WhatsApp id / token / signature / App Secret /
// message content. JSON is NEVER parsed before the signature is verified. Inbound /
// template / account payloads are classified and acknowledged only — no lifecycle
// mutation, no outbound send, no n8n, no Jarvis. Delivery de-duplication + forward-
// only lifecycle are reused from CommunicationService (Phase 5B protections).
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
    // Phase 5F-D1-B: the ALREADY-VERIFIED inbound payload is durably CAPTURED (normalize →
    // resolve identity → persist minimized rows, idempotent on the provider message id). NO
    // reply, NO consent mutation, NO STOP/START/HELP handling, NO domain event, NO outbox, NO
    // n8n, NO Jarvis/AI, NO conversation/24h-window. On a real persistence failure the webhook
    // returns 500 so Meta retries (a retry makes progress via the per-message unique fence); a
    // deterministic all-rejected batch is acknowledged so Meta does not retry forever.
    const inbound = await handleInboundWhatsAppMessages({ rawBody: input.rawBody, payload });
    if (!inbound.ok) return { status: 500, code: "inbound_processing_failed" };
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
