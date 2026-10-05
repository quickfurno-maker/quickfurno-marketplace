import { NextResponse } from "next/server";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import {
  QFJ_KEY_ID_HEADER,
  QFJ_SIGNATURE_HEADER,
  verifyQfjSignedRequestSignature,
} from "@/lib/jarvis/signedRequestAuth";
import {
  QFJ_WHATSAPP_CONVERSATION_CONTEXT_PATH,
  QFJ_WHATSAPP_CONVERSATION_CONTEXT_PROTOCOL,
  QFJ_WHATSAPP_CONVERSATION_CONTEXT_SIGNING_DOMAIN,
  QFJ_WHATSAPP_CONVERSATION_CONTEXT_VERSION,
  parseQfjWhatsAppConversationContextRequest,
} from "@/lib/jarvis/whatsAppConversationContextContract";
import { resolveQfJarvisRuntimePolicy } from "@/lib/jarvis/runtimePolicy";
import { readJarvisWhatsAppConversationContext } from "@/services/conversationalWhatsAppService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 4_096;
const reply = (status: number, body: unknown) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
export async function POST(request: Request): Promise<Response> {
  const policy = resolveQfJarvisRuntimePolicy();
  if (
    policy.mode !== "active" ||
    process.env.QF_JARVIS_WHATSAPP_ENABLED?.trim().toLowerCase() !== "true"
  ) return reply(503, { error: "service_unavailable" });

  let raw: Uint8Array;
  try { raw = new Uint8Array(await request.arrayBuffer()); }
  catch { return reply(400, { error: "invalid_request" }); }
  if (raw.byteLength < 2 || raw.byteLength > MAX_BODY_BYTES) {
    return reply(413, { error: "invalid_request" });
  }

  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(raw).toString("utf8")); }
  catch { return reply(400, { error: "invalid_request" }); }
  const parsed = parseQfjWhatsAppConversationContextRequest(decoded);
  if (!parsed) return reply(400, { error: "invalid_request" });

  const keys = parseQfjVerificationKeys(process.env.QF_JARVIS_CORE_VERIFICATION_KEYS_JSON);
  if (!keys) return reply(503, { error: "service_unavailable" });
  const authenticated = verifyQfjSignedRequestSignature({
    rawBody: raw,
    domain: QFJ_WHATSAPP_CONVERSATION_CONTEXT_SIGNING_DOMAIN,
    path: QFJ_WHATSAPP_CONVERSATION_CONTEXT_PATH,
    requestId: parsed.requestId,
    issuedAt: parsed.issuedAt,
    keyId: request.headers.get(QFJ_KEY_ID_HEADER),
    signature: request.headers.get(QFJ_SIGNATURE_HEADER),
    keys, requestHeaders: request.headers, now: new Date().toISOString(),
  });
  if (!authenticated) return reply(401, { error: "authentication_failed" });

  const result = await readJarvisWhatsAppConversationContext({
    tenantId: parsed.tenantId,
    conversationId: parsed.conversationId,
    inboundMessageId: parsed.inboundMessageId,
    expectedRevision: parsed.expectedRevision,
  });
  if (!result.ok) {
    const status =
      result.reason === "stale_revision" ? 409 :
      result.reason === "conversation_not_found" || result.reason === "inbound_message_mismatch"
        ? 404 : 503;
    return reply(status, {
      protocol: QFJ_WHATSAPP_CONVERSATION_CONTEXT_PROTOCOL,
      version: QFJ_WHATSAPP_CONVERSATION_CONTEXT_VERSION,
      requestId: parsed.requestId,
      status: result.reason,
    });
  }
  return reply(200, {
    protocol: QFJ_WHATSAPP_CONVERSATION_CONTEXT_PROTOCOL,
    version: QFJ_WHATSAPP_CONVERSATION_CONTEXT_VERSION,
    requestId: parsed.requestId,
    tenantId: parsed.tenantId,
    conversationId: parsed.conversationId,
    revision: parsed.expectedRevision,
    inboundMessageId: parsed.inboundMessageId,
    context: result.value,
  });
}
