// ============================================================================
// QuickFurno — services/metaWhatsAppWebhookService.ts  (Phase 5F-B → 8B-1A, server-only)
//
// Orchestrates the Meta WhatsApp Cloud webhook in a strict FAIL-CLOSED order.
//
// PHASE 8B-1A — the PRODUCTION entry point is `handleMetaWhatsAppWebhookPostBytes`, and the
// HISTORICAL public symbol `handleMetaWhatsAppWebhookPost` is now the GATED compatibility
// string wrapper that delegates directly to it. Their order is:
//   signature header → signature config → exact byte grammar + HMAC over the EXACT bytes →
//   fatal UTF-8 decode → JSON parse → identity config → CALLBACK-IDENTITY GATE →
//   runtime webhook-processing DB gate → downstream classification / processing.
// The identity gate runs BEFORE the runtime DB gate and before every downstream effect: a
// foreign / mixed / malformed / unprovable callback terminates with ZERO effects and creates
// NO rejection receipt. The classification / lifecycle work lives in the NON-EXPORTED
// `processVerifiedExpectedMetaWebhook`, reached ONLY after the identity authority authorizes,
// so no exported or route-reachable function can process a callback without the identity gate.
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
import { createFailClosedOutboundConsentEnforcer } from "./outboundConsentEnforcementService";
import { isWebhookProcessingEnabled } from "./communicationProviderRuntimeService";
import {
  resolveWebhookIdentityConfig,
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
  decideCallbackIdentity,
  deriveMetaWebhookEventId,
  metaWebhookPayloadHash,
  verifyMetaWebhookSignature,
  verifyMetaWebhookSignatureBytes,
  MetaWebhookClassification,
} from "../lib/communication/providers/metaWhatsAppWebhook";
import { handleInboundWhatsAppMessages } from "./inboundWhatsAppMessageService";
import { processInboundConsentCommands } from "./inboundConsentCommandService";
import { enqueueConsentCommandResponses } from "./consentCommandResponseService";

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
        | "inbound_acknowledged_rejected"
        // Phase 8B-1A — callback-identity gate terminal outcomes (both ZERO-effect).
        | "rejected_foreign_identity"
        | "acknowledged_unsupported_identity_shape";
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
 * Phase 8B-1A — the NON-EXPORTED downstream stage: the runtime webhook-processing DB gate
 * (step 9) and the existing classification / lifecycle work (step 10). It is reached ONLY
 * from `handleMetaWhatsAppWebhookPostBytes`, and ONLY after the callback-identity authority
 * has AUTHORIZED the callback. It is not exported and is not route-reachable, so no caller
 * can process a callback without the identity gate. The signature has already been verified
 * over the exact bytes and the payload has already been parsed by the byte entry point.
 */
async function processVerifiedExpectedMetaWebhook(input: {
  readonly rawBody: string;
  readonly signature: string;
  readonly appSecret: string;
}): Promise<MetaWebhookPostOutcome> {
  const appSecret = input.appSecret;

  // Defence-in-depth re-verification: the byte entry already proved the signature over the EXACT bytes;
  // this re-checks it over the decoded string through the SAME single authority before any lifecycle work.
  if (!verifyMetaWebhookSignature(input.rawBody, input.signature, appSecret)) {
    return { status: 401, code: "invalid_signature" };
  }

  // Step 9 — runtime webhook-processing gate (AFTER identity authorization; independent of outbound_enabled).
  const enabled = await isWebhookProcessingEnabled(META_WHATSAPP_CLOUD_PROVIDER_KEY, CHANNEL);
  if (!enabled) return { status: 503, code: "webhook_processing_disabled" };

  // Step 10 — parse + classify.
  const payload = safeParse(input.rawBody);
  if (!payload) return { status: 400, code: "unparseable" };
  const classification = classifyMetaWebhook(payload);

  // Step 8 — delivery status is processed; everything else is safely acknowledged.
  if (classification === MetaWebhookClassification.DELIVERY_STATUS) {
    // A webhook-only provider carrying just the app secret — sending is impossible.
    const provider = new MetaCloudWhatsAppProvider(webhookSignatureToRuntime({ appSecret }), new FetchHttpTransport());
    // PHASE 8A — this service processes DELIVERY RECEIPTS and never sends, but it must be SAFE BY
    // CONSTRUCTION rather than safe by usage: it is bound to the FAIL-CLOSED enforcer, so if a future edit
    // ever called a send method on it, the send would be blocked instead of silently skipping consent.
    // (The two `undefined`s keep the existing provider-resolver and coordinator defaults.)
    const service = new CommunicationService(
      provider,
      undefined,
      undefined,
      createFailClosedOutboundConsentEnforcer()
    );
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

    // Phase 5F-D4-C — DURABLE ENQUEUE, strictly AFTER the authoritative command flow has COMPLETED.
    //
    // Order: verified webhook → D1-B persist → D2-E command (→ D2-D write for STOP/START) → THEN this.
    // It is reached only once `commands.ok` is true, so for STOP/START the writer result already exists;
    // an acknowledgement intent can never precede the authoritative write.
    //
    // THIS SENDS NOTHING. D4-B awaited the provider call here, which — once the templates are seeded — would
    // put a real outbound HTTP call to Meta INSIDE the request Meta is waiting on, and a slow provider would
    // push us past Meta's tolerance and trigger REDELIVERY. So the webhook now only persists ONE DURABLE
    // INTENT and returns. A Core-owned worker claims it later, re-evaluates D2-C, and dispatches.
    // No provider call, no CommunicationService, no worker invocation, no background promise, no n8n.
    //
    // It is BEST-EFFORT and NON-AUTHORITATIVE. A failed insert, an absent encryption key, a duplicate or a
    // throw must NEVER turn a successful consent command into an error — so it is wrapped, its result is
    // deliberately discarded, and the webhook returns exactly the outcome the inbound command flow produced.
    try {
      await enqueueConsentCommandResponses({
        payload,
        webhookReceiptId: inbound.result.receiptId,
        persisted: inbound.result.processed,
        commands: commands.result.items,
      });
    } catch {
      /* the acknowledgement intent is never authoritative — the consent command already stands */
    }

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

// Fatal UTF-8 decoder — throws on ANY invalid byte sequence. Applied ONLY after the
// signature has been proven over the exact bytes (Phase 8B-1A, step 4).
const META_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

/**
 * Phase 8B-1A — the PRODUCTION byte entry point and the SINGLE authoritative pipeline.
 * The Next route reads the exact request bytes and enters HERE; the callback-identity
 * gate runs BEFORE the runtime DB gate and before ANY database call, receipt write,
 * message mutation, inbound persistence, consent processing, response-intent enqueue,
 * provider-state effect, or provider/network call.
 *
 * Order (the shared authoritative pipeline):
 *   1. signature header presence
 *   2. signature configuration (app secret only)
 *   3. exact byte grammar + HMAC over the EXACT bytes
 *   4. fatal UTF-8 decode (only after the signature is proven)
 *   5. JSON parse
 *   6. identity configuration (WABA id + phone-number id only)
 *   7. pure identity authority (closed union)
 *   8. identity rejection OR unsupported acknowledgement — both terminal, ZERO effects
 *   9. runtime webhook-processing DB gate + 10. existing downstream classification /
 *      processing — reached ONLY for an authorized callback, via the proven downstream.
 *
 * A foreign / mixed / malformed / unprovable identity terminates at step 8 with zero
 * effects. There is NO identity-exempt path to the downstream in production: the route
 * only ever calls this function, and this function only calls the downstream after the
 * identity gate has authorized the callback.
 */
export async function handleMetaWhatsAppWebhookPostBytes(input: {
  readonly rawBytes: Uint8Array;
  readonly signature: string | null;
}): Promise<MetaWebhookPostOutcome> {
  // Step 1 — a signature header is required.
  if (!input.signature) return { status: 401, code: "missing_signature" };

  // Step 2 — server POST-signature config (app secret ONLY).
  const sigConfig = resolveWebhookSignatureConfig();
  if (!sigConfig.ok) return { status: 503, code: "provider_not_configured" };

  // Step 3 — exact grammar + HMAC over the EXACT bytes, before any decode or parse.
  if (!verifyMetaWebhookSignatureBytes(input.rawBytes, input.signature, sigConfig.config.appSecret)) {
    return { status: 401, code: "invalid_signature" };
  }

  // Step 4 — fatal UTF-8 decode (safe now: the bytes are proven). Invalid UTF-8 → 400.
  let decoded: string;
  try {
    decoded = META_UTF8_DECODER.decode(input.rawBytes);
  } catch {
    return { status: 400, code: "bad_request" };
  }

  // Step 5 — parse (safe now: signature verified).
  const payload = safeParse(decoded);
  if (!payload) return { status: 400, code: "unparseable" };

  // Step 6 — callback-identity config (WABA id + phone-number id ONLY).
  const idConfig = resolveWebhookIdentityConfig();
  if (!idConfig.ok) return { status: 503, code: "provider_not_configured" };

  // Step 7 — pure identity authority.
  const identity = decideCallbackIdentity(payload, idConfig.config);

  // Step 8 — identity rejection OR unsupported acknowledgement. BOTH terminate here,
  // BEFORE the runtime DB gate and before any downstream effect: ZERO database calls,
  // ZERO receipt writes, ZERO message mutations, ZERO inbound persistence, ZERO consent
  // processing, ZERO response-intent enqueue, ZERO provider-state effects, ZERO network.
  // Phase 8B-1A creates NO rejection receipt. The public response stays generic (200).
  if (identity.kind === "rejected") {
    return { status: 200, result: "rejected_foreign_identity" };
  }
  if (identity.kind === "unsupported") {
    return { status: 200, result: "acknowledged_unsupported_identity_shape" };
  }

  // Steps 9 + 10 — authorized: enter the NON-EXPORTED downstream (runtime DB gate + existing
  // classification / processing) with the already-verified signature and already-parsed
  // payload. `identity.classes` is intentionally not narrowed here — Phase 8B-1A does not
  // bind provider-account (deferred to Phase 8B-1B).
  return processVerifiedExpectedMetaWebhook({
    rawBody: decoded,
    signature: input.signature,
    appSecret: sigConfig.config.appSecret,
  });
}

/**
 * Phase 8B-1A — the COMPATIBILITY string wrapper, kept under the HISTORICAL public name so
 * every existing importer/caller of `handleMetaWhatsAppWebhookPost` is now GATED. It encodes
 * the raw STRING to its EXACT UTF-8 bytes and delegates DIRECTLY to the production byte entry
 * point — it holds no separate verification, decode, parse, identity, or downstream path. For
 * equivalent valid UTF-8 input it produces the same decision as the byte entry point. This is
 * NOT an identity-exempt legacy path: the only path to the downstream is through the gate.
 */
export function handleMetaWhatsAppWebhookPost(input: {
  readonly rawBody: string;
  readonly signature: string | null;
}): Promise<MetaWebhookPostOutcome> {
  return handleMetaWhatsAppWebhookPostBytes({
    rawBytes: new TextEncoder().encode(input.rawBody),
    signature: input.signature,
  });
}

/** Resolve the server-only webhook verify token — needs ONLY the verify token. */
export function getWebhookVerifyToken(): string | null {
  const res = resolveWebhookVerifyConfig();
  return res.ok ? res.config.webhookVerifyToken : null;
}
