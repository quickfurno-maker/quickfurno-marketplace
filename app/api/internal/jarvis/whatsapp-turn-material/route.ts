import { NextResponse } from "next/server";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import {
  QFJ_SCALE_HEADERS,
  qfjCompatibilityResponseHeaders,
} from "@/lib/jarvis/scaleContract";
import { addMetric } from "@/lib/observability/runtime";
import { QFJ_KEY_ID_HEADER, QFJ_SIGNATURE_HEADER, verifyQfjSignedRequestSignature } from "@/lib/jarvis/signedRequestAuth";
import {
  QFJ_WHATSAPP_TURN_MATERIAL_PATH,
  QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
  QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN,
  QFJ_WHATSAPP_TURN_MATERIAL_VERSION,
  isQfjWhatsAppBoundTurnMaterialRequest,
  parseQfjWhatsAppTurnMaterialRequest,
} from "@/lib/jarvis/whatsAppTurnMaterialContract";
import { resolveQfJarvisRuntimePolicy } from "@/lib/jarvis/runtimePolicy";
import {
  readJarvisWhatsAppAuthorityState,
  readJarvisWhatsAppTurnMaterial,
  type JarvisWhatsAppAuthorityState,
} from "@/services/conversationalWhatsAppService";
import { readRiyaQualificationTurnMaterial } from "@/services/leadEnrichmentInboundService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 4_096;
const reply = (
  status: number,
  body: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
) =>
  NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", ...extraHeaders },
  });

function authorityResponse(requestId: string, value: JarvisWhatsAppAuthorityState) {
  return {
    protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
    version: QFJ_WHATSAPP_TURN_MATERIAL_VERSION,
    requestId,
    tenantId: value.tenantId,
    conversationId: value.conversationId,
    revision: value.revision,
    assignedActor: value.assignedActor,
    subjectType: value.subjectType,
    partyType: value.partyType,
    conversationState: value.conversationState,
    jarvisAllowed: value.jarvisAllowed,
    dataClass: value.dataClass,
    humanTakeover: value.humanTakeover,
    aiPaused: value.aiPaused,
    cancelled: value.cancelled,
    subjectStatus: value.subjectStatus,
    ...(value.subjectRef === undefined ? {} : { subjectRef: value.subjectRef }),
    observedAt: value.observedAt,
  };
}

export async function POST(request: Request): Promise<Response> {
  const policy = resolveQfJarvisRuntimePolicy();
  const genericEnabled = process.env.QF_JARVIS_WHATSAPP_ENABLED?.trim().toLowerCase() === "true";
  const qualificationEnabled =
    process.env.QF_JARVIS_RIYA_QUALIFICATION_ENABLED?.trim().toLowerCase() === "true";
  if (policy.mode !== "active" || (!genericEnabled && !qualificationEnabled)) {
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
    keys, requestHeaders: request.headers, now: new Date().toISOString(),
  });
  const receivedVersion = request.headers.get(QFJ_SCALE_HEADERS.version);
  const compatibilityMode =
    receivedVersion === null ? "legacy" : receivedVersion === "1" ? "current" : "unsupported";
  try {
    addMetric("qf.compatibility.requests", 1, {
      boundary: "qfj.scale.http",
      received_version: receivedVersion ?? "0",
      mode: compatibilityMode,
      result: authenticated ? "accepted" : "rejected",
    });
  } catch {
    // Compatibility telemetry is powerless; authentication remains authoritative.
  }
  if (!authenticated) return reply(401, { error: "authentication_failed" });
  const compatibilityHeaders = qfjCompatibilityResponseHeaders(
    compatibilityMode === "legacy" ? "legacy" : "current",
  );
  const compatReply = (status: number, body: unknown) =>
    reply(status, body, compatibilityHeaders);

  if (isQfjWhatsAppBoundTurnMaterialRequest(parsed)) {
    if (parsed.turnPurpose === "lead_qualification") {
      if (!qualificationEnabled || !parsed.qualificationRequestId) {
        return compatReply(503, { error: "service_unavailable" });
      }
      const qualification = await readRiyaQualificationTurnMaterial({
        tenantId: parsed.tenantId,
        conversationId: parsed.conversationId,
        inboundMessageId: parsed.inboundMessageId,
        expectedRevision: parsed.expectedRevision,
        qualificationRequestId: parsed.qualificationRequestId,
      });
      if (!qualification.ok) {
        return compatReply(qualification.reason === "stale_or_invalid" ? 409 : 503, {
          protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
          version: QFJ_WHATSAPP_TURN_MATERIAL_VERSION,
          requestId: parsed.requestId,
          status: qualification.reason,
        });
      }
      return compatReply(200, {
        protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
        version: QFJ_WHATSAPP_TURN_MATERIAL_VERSION,
        requestId: parsed.requestId,
        tenantId: "quickfurno",
        conversationId: qualification.value.conversationId,
        revision: qualification.value.revision,
        purpose: "lead_qualification",
        assignedActor: "RIYA",
        inboundMessageId: qualification.value.inboundMessageId,
        receivedAt: qualification.value.receivedAt,
        dataClass: "HOSTED_ALLOWED",
        qualification: {
          requestId: qualification.value.qualificationRequestId,
          target: qualification.value.target,
          questionText: qualification.value.questionText,
          allowedOptions: qualification.value.allowedOptions,
          answerText: qualification.value.answerText,
        },
      });
    }
    if (!genericEnabled) return compatReply(503, { error: "service_unavailable" });
    const material = await readJarvisWhatsAppTurnMaterial({
      tenantId: parsed.tenantId,
      conversationId: parsed.conversationId,
      inboundMessageId: parsed.inboundMessageId,
      expectedRevision: parsed.expectedRevision,
    });
    if (!material.ok) {
      const status = material.reason === "conversation_not_found" || material.reason === "inbound_message_mismatch" ? 404
        : material.reason === "stale_revision" ? 409
        : 503;
      return compatReply(status, {
        protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
        version: QFJ_WHATSAPP_TURN_MATERIAL_VERSION,
        requestId: parsed.requestId,
        status: material.reason,
      });
    }
    return compatReply(200, {
      ...authorityResponse(parsed.requestId, material.value),
      inboundMessageId: material.value.inboundMessageId,
      receivedAt: material.value.receivedAt,
      inbound: material.value.inbound,
      ...(material.value.normalizedText === undefined ? {} : { normalizedText: material.value.normalizedText }),
    });
  }

  const authority = await readJarvisWhatsAppAuthorityState({
    tenantId: parsed.tenantId,
    conversationId: parsed.conversationId,
  });
  if (!authority.ok) {
    const status = authority.reason === "conversation_not_found" ? 404 : 503;
    return compatReply(status, {
      protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
      version: QFJ_WHATSAPP_TURN_MATERIAL_VERSION,
      requestId: parsed.requestId,
      status: authority.reason,
    });
  }
  return compatReply(200, authorityResponse(parsed.requestId, authority.value));
}
