import { NextResponse } from "next/server";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import {
  QFJ_HANDSHAKE_PATH,
  QFJ_HANDSHAKE_SIGNING_DOMAIN,
  parseQfjHandshakeRequest,
} from "@/lib/jarvis/handshakeContract";
import { verifyQfjSignedRequestSignature, QFJ_KEY_ID_HEADER, QFJ_SIGNATURE_HEADER } from "@/lib/jarvis/signedRequestAuth";
import { resolveQfJarvisRuntimePolicy } from "@/lib/jarvis/runtimePolicy";
import { QFJ_CORE_DECISION_PROTOCOL } from "@/lib/jarvis/coreDecisionContract";
import { QFJ_CONTEXT_PROTOCOL, QFJ_CONTEXT_VERSION } from "@/lib/jarvis/contextContract";
import { QFJ_ACTION_REQUEST_PROTOCOL, QFJ_ACTION_REQUEST_VERSION } from "@/lib/jarvis/actionRequestContract";
import { QFJ_RIYA_INGRESS_PROTOCOL } from "@/lib/jarvis/privateRiyaIngressContract";
import { resolveQfJarvisOutboundConfig } from "@/lib/jarvis/outboundConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 4096;
const reply = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
export async function POST(request: Request): Promise<Response> {
  let raw: Uint8Array;
  try { raw = new Uint8Array(await request.arrayBuffer()); } catch { return reply(400, { error: "invalid_request" }); }
  if (raw.byteLength < 2 || raw.byteLength > MAX_BODY_BYTES) return reply(413, { error: "invalid_request" });
  let json: unknown;
  try { json = JSON.parse(Buffer.from(raw).toString("utf8")); } catch { return reply(400, { error: "invalid_request" }); }
  const parsed = parseQfjHandshakeRequest(json);
  if (!parsed) return reply(400, { error: "invalid_request" });

  const keys = parseQfjVerificationKeys(process.env.QF_JARVIS_CORE_VERIFICATION_KEYS_JSON);
  if (!keys) return reply(503, { error: "service_unavailable" });
  const authenticated = verifyQfjSignedRequestSignature({
    rawBody: raw, domain: QFJ_HANDSHAKE_SIGNING_DOMAIN, path: QFJ_HANDSHAKE_PATH,
    requestId: parsed.requestId, issuedAt: parsed.issuedAt,
    keyId: request.headers.get(QFJ_KEY_ID_HEADER), signature: request.headers.get(QFJ_SIGNATURE_HEADER),
    keys, now: new Date().toISOString(),
  });
  if (!authenticated) return reply(401, { error: "authentication_failed" });

  const policy = resolveQfJarvisRuntimePolicy();
  const outbound = resolveQfJarvisOutboundConfig();
  return reply(200, {
    protocol: "qfj.handshake",
    version: 1,
    requestId: parsed.requestId,
    status: policy.mode === "off" ? "SAFE_DISABLED" : "READY",
    mode: policy.mode,
    capabilities: {
      coreDecision: policy.coreDecisionEnabled,
      contextRead: policy.contextReadEnabled,
      recommendationIntake: policy.recommendationIntakeEnabled,
      riya: policy.riyaEnabled,
      anisha: policy.anishaEnabled,
      riyaWebTurn: policy.riyaWebTurnEnabled && outbound.ok,
      outboundConfigured: outbound.ok,
      actionProposals: policy.actionProposalEnabled,
    },
    protocols: {
      coreDecision: `${QFJ_CORE_DECISION_PROTOCOL.name}/v${QFJ_CORE_DECISION_PROTOCOL.version}/${QFJ_CORE_DECISION_PROTOCOL.contractDigest}`,
      contextRead: `${QFJ_CONTEXT_PROTOCOL}/v${QFJ_CONTEXT_VERSION}`,
      actionRequest: `${QFJ_ACTION_REQUEST_PROTOCOL}/v${QFJ_ACTION_REQUEST_VERSION}`,
      riyaWebIngress: `${QFJ_RIYA_INGRESS_PROTOCOL}/v1`,
    },
  });
}
