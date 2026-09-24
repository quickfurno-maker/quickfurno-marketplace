import { NextResponse } from "next/server";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import {
  QFJ_KEY_ID_HEADER,
  QFJ_SIGNATURE_HEADER,
  verifyQfjSignedRequestSignature,
} from "@/lib/jarvis/signedRequestAuth";
import {
  QFJ_WHATSAPP_MEDIA_CONTENT_PATH,
  QFJ_WHATSAPP_MEDIA_CONTENT_SIGNING_DOMAIN,
  QFJ_WHATSAPP_MEDIA_CONVERSATION_ID_HEADER,
  QFJ_WHATSAPP_MEDIA_ID_HEADER,
  QFJ_WHATSAPP_MEDIA_INBOUND_ID_HEADER,
  QFJ_WHATSAPP_MEDIA_KIND_HEADER,
  QFJ_WHATSAPP_MEDIA_REQUEST_ID_HEADER,
  QFJ_WHATSAPP_MEDIA_REVISION_HEADER,
  QFJ_WHATSAPP_MEDIA_SHA256_HEADER,
  parseQfjWhatsAppMediaContentRequest,
} from "@/lib/jarvis/whatsAppMediaContentContract";
import { resolveQfJarvisRuntimePolicy } from "@/lib/jarvis/runtimePolicy";
import { resolveConversationalMetaConfig } from "@/lib/communication/providers/metaCloudWhatsAppConfig";
import { fetchMetaWhatsAppMediaContent } from "@/lib/communication/providers/metaWhatsAppMediaContent";
import { readJarvisWhatsAppTurnMaterial } from "@/services/conversationalWhatsAppService";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 4_096;

const json = (status: number, body: unknown) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

function failureStatus(reason: string): number {
  if (reason === "conversation_not_found" || reason === "inbound_message_mismatch") return 404;
  if (reason === "stale_revision") return 409;
  return 503;
}

export async function POST(request: Request): Promise<Response> {
  const policy = resolveQfJarvisRuntimePolicy();
  if (
    policy.mode !== "active" ||
    process.env.QF_JARVIS_WHATSAPP_ENABLED?.trim().toLowerCase() !== "true" ||
    process.env.QF_JARVIS_WHATSAPP_MEDIA_ENABLED?.trim().toLowerCase() !== "true"
  ) {
    return json(503, { error: "service_unavailable" });
  }

  let raw: Uint8Array;
  try { raw = new Uint8Array(await request.arrayBuffer()); }
  catch { return json(400, { error: "invalid_request" }); }
  if (raw.byteLength < 2 || raw.byteLength > MAX_BODY_BYTES) {
    return json(413, { error: "invalid_request" });
  }

  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(raw).toString("utf8")); }
  catch { return json(400, { error: "invalid_request" }); }
  const parsed = parseQfjWhatsAppMediaContentRequest(decoded);
  if (!parsed) return json(400, { error: "invalid_request" });

  const keys = parseQfjVerificationKeys(process.env.QF_JARVIS_CORE_VERIFICATION_KEYS_JSON);
  if (!keys) return json(503, { error: "service_unavailable" });
  const authenticated = verifyQfjSignedRequestSignature({
    rawBody: raw,
    domain: QFJ_WHATSAPP_MEDIA_CONTENT_SIGNING_DOMAIN,
    path: QFJ_WHATSAPP_MEDIA_CONTENT_PATH,
    requestId: parsed.requestId,
    issuedAt: parsed.issuedAt,
    keyId: request.headers.get(QFJ_KEY_ID_HEADER),
    signature: request.headers.get(QFJ_SIGNATURE_HEADER),
    keys,
    now: new Date().toISOString(),
  });
  if (!authenticated) return json(401, { error: "authentication_failed" });

  const material = await readJarvisWhatsAppTurnMaterial({
    tenantId: parsed.tenantId,
    conversationId: parsed.conversationId,
    inboundMessageId: parsed.inboundMessageId,
    expectedRevision: parsed.expectedRevision,
  });
  if (!material.ok) {
    return json(failureStatus(material.reason), { error: material.reason });
  }
  if (
    material.value.jarvisAllowed !== true ||
    material.value.subjectStatus !== "clear" ||
    material.value.humanTakeover ||
    material.value.aiPaused ||
    material.value.cancelled
  ) {
    return json(409, { error: "media_not_authorized" });
  }

  const attachment = material.value.inbound.attachment;
  if (
    !attachment ||
    attachment.mediaId !== parsed.mediaId ||
    attachment.kind !== parsed.mediaKind
  ) {
    return json(404, { error: "media_binding_mismatch" });
  }

  const meta = resolveConversationalMetaConfig();
  if (!meta.ok) return json(503, { error: "provider_unavailable" });
  const content = await fetchMetaWhatsAppMediaContent({
    mediaId: parsed.mediaId,
    mediaKind: parsed.mediaKind,
    ...(attachment.mimeType === undefined ? {} : { expectedMimeType: attachment.mimeType }),
  }, meta.config);
  if (!content.ok) {
    if (content.reason === "media_too_large") return json(413, { error: content.reason });
    if (
      content.reason === "mime_mismatch" ||
      content.reason === "digest_mismatch" ||
      content.reason === "untrusted_media_url" ||
      content.reason === "provider_invalid"
    ) {
      return json(502, { error: "provider_invalid" });
    }
    return json(503, { error: "provider_unavailable" });
  }

  return new Response(Buffer.from(content.bytes), {
    status: 200,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": content.mimeType,
      "content-length": String(content.bytes.byteLength),
      [QFJ_WHATSAPP_MEDIA_REQUEST_ID_HEADER]: parsed.requestId,
      [QFJ_WHATSAPP_MEDIA_CONVERSATION_ID_HEADER]: parsed.conversationId,
      [QFJ_WHATSAPP_MEDIA_INBOUND_ID_HEADER]: parsed.inboundMessageId,
      [QFJ_WHATSAPP_MEDIA_REVISION_HEADER]: String(parsed.expectedRevision),
      [QFJ_WHATSAPP_MEDIA_ID_HEADER]: parsed.mediaId,
      [QFJ_WHATSAPP_MEDIA_KIND_HEADER]: parsed.mediaKind,
      [QFJ_WHATSAPP_MEDIA_SHA256_HEADER]: content.sha256,
    },
  });
}
