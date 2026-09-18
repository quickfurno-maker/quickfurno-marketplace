import { NextResponse } from "next/server";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import { QFJ_KEY_ID_HEADER, QFJ_SIGNATURE_HEADER, verifyQfjSignedRequestSignature } from "@/lib/jarvis/signedRequestAuth";
import {
  QFJ_WHATSAPP_TURN_MATERIAL_PATH,
  QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
  QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN,
  parseQfjWhatsAppTurnMaterialRequest,
} from "@/lib/jarvis/whatsAppTurnMaterialContract";
import { resolveQfJarvisRuntimePolicy } from "@/lib/jarvis/runtimePolicy";
import { readJarvisWhatsAppTurnMaterial } from "@/services/conversationalWhatsAppService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 4_096;
const reply = (status: number, body: unknown) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  const policy = resolveQfJarvisRuntimePolicy();
  if (policy.mode !== "active" || process.env.QF_JARVIS_WHATSAPP_ENABLED?.trim().toLowerCase() !== "true") {
    return reply(503, { error: "service_unavailable" });
  }
  let raw: Uint8Array;
  try { raw = new Uint8Array(await request.arrayBuffer()); }
  catch { return reply(400, { error: "invalid_request" }); }
  if (raw.byteLength < 2 || raw.byteLength > MAX_BODY_BYTES) return reply(413, { error: "invalid_request" });

  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(raw).toString("utf8")); }
  catch { return reply(400, { error: "invalid_request" }); }
  const parsed = parseQfjWhatsAppTurnMaterialRequest(decoded);
  if (!parsed) return reply(400, { error: "invalid_request" });

  const keys = parseQfjVerificationKeys(process.env.QF_JARVIS_CORE_VERIFICATION_KEYS_JSON);
  if (!keys) return reply(503, { error: "service_unavailable" });
  const authenticated = verifyQfjSignedRequestSignature({
    rawBody: raw,
    domain: QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN,
    path: QFJ_WHATSAPP_TURN_MATERIAL_PATH,
    requestId: parsed.requestId,
    issuedAt: parsed.issuedAt,
    keyId: request.headers.get(QFJ_KEY_ID_HEADER),
    signature: request.headers.get(QFJ_SIGNATURE_HEADER),
    keys,
    now: new Date().toISOString(),
  });
  if (!authenticated) return reply(401, { error: "authentication_failed" });
  const material = await readJarvisWhatsAppTurnMaterial({
    conversationId: parsed.conversationId,
    inboundMessageId: parsed.inboundMessageId,
    expectedRevision: parsed.expectedRevision,
  });
  if (!material.ok) {
    const status = material.reason === "conversation_not_found" || material.reason === "inbound_message_mismatch" ? 404
      : material.reason === "conversation_not_sendable" || material.reason === "stale_revision" ? 409
      : 503;
    return reply(status, {
      protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
      version: 1,
      requestId: parsed.requestId,
      status: material.reason,
    });
  }

  return reply(200, {
    protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
    version: 1,
    requestId: parsed.requestId,
    conversationId: parsed.conversationId,
    inboundMessageId: parsed.inboundMessageId,
    conversationRevision: parsed.expectedRevision,
    assignedActor: material.value.assignedActor,
    subjectType: material.value.subjectType,
    tenantId: material.value.tenantId,
    dataClass: material.value.dataClass,
    ...(material.value.subjectRef === undefined ? {} : { subjectRef: material.value.subjectRef }),
    receivedAt: material.value.receivedAt,
    ...(material.value.normalizedText === undefined ? {} : { normalizedText: material.value.normalizedText }),
  });
}