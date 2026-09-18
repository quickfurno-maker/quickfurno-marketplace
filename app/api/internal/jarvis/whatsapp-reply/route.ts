import { NextResponse } from "next/server";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import { QFJ_KEY_ID_HEADER, QFJ_SIGNATURE_HEADER, verifyQfjSignedRequestSignature } from "@/lib/jarvis/signedRequestAuth";
import {
  QFJ_WHATSAPP_REPLY_PATH,
  QFJ_WHATSAPP_REPLY_PROTOCOL,
  parseQfjWhatsAppReplyRequest,
  qfjWhatsAppReplySigningDomain,
} from "@/lib/jarvis/whatsAppReplyContract";
import { resolveQfJarvisRuntimePolicy } from "@/lib/jarvis/runtimePolicy";
import { queueJarvisConversationReply } from "@/services/conversationalWhatsAppService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 8_192;
const reply = (status: number, body: unknown) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  const policy = resolveQfJarvisRuntimePolicy();
  if (policy.mode !== "active" || process.env.QF_JARVIS_WHATSAPP_ENABLED?.trim().toLowerCase() !== "true") {
    return reply(503, { error: "service_unavailable" });
  }

  let raw: Uint8Array;
  try { raw = new Uint8Array(await request.arrayBuffer()); } catch { return reply(400, { error: "invalid_request" }); }
  if (raw.byteLength < 2 || raw.byteLength > MAX_BODY_BYTES) return reply(413, { error: "invalid_request" });

  let parsedJson: unknown;
  try { parsedJson = JSON.parse(Buffer.from(raw).toString("utf8")); } catch { return reply(400, { error: "invalid_request" }); }
  const parsed = parseQfjWhatsAppReplyRequest(parsedJson);
  if (!parsed) return reply(400, { error: "invalid_request" });

  const keys = parseQfjVerificationKeys(process.env.QF_JARVIS_CORE_VERIFICATION_KEYS_JSON);
  if (!keys) return reply(503, { error: "service_unavailable" });
  const authenticated = verifyQfjSignedRequestSignature({
    rawBody: raw,
    domain: qfjWhatsAppReplySigningDomain(parsed.version),
    path: QFJ_WHATSAPP_REPLY_PATH,
    requestId: parsed.requestId,
    issuedAt: parsed.issuedAt,
    keyId: request.headers.get(QFJ_KEY_ID_HEADER),
    signature: request.headers.get(QFJ_SIGNATURE_HEADER),
    keys,
    now: new Date().toISOString(),
  });
  if (!authenticated) return reply(401, { error: "authentication_failed" });

  const queued = await queueJarvisConversationReply({
    conversationId: parsed.conversationId,
    expectedRevision: parsed.expectedRevision,
    proposalId: parsed.proposalId,
    idempotencyKey: parsed.idempotencyKey,
    ...(parsed.version === 1
      ? { body: parsed.body }
      : { actor: parsed.actor, experience: parsed.experience }),
  });
  if (!queued.ok) {
    const status = queued.reason === "stale_revision" ? 409
      : queued.reason === "service_window_closed" || queued.reason === "suppressed" || queued.reason === "conversation_not_sendable" ? 403
      : 503;
    return reply(status, {
      protocol: QFJ_WHATSAPP_REPLY_PROTOCOL,
      version: parsed.version,
      requestId: parsed.requestId,
      status: queued.reason,
    });
  }

  return reply(202, {
    protocol: QFJ_WHATSAPP_REPLY_PROTOCOL,
    version: parsed.version,
    requestId: parsed.requestId,
    status: "queued",
    outboxId: queued.value.outboxId,
    providerAuthority: "quickfurno-core",
  });
}
