import { NextResponse } from "next/server";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import { QFJ_ACTION_REQUEST_PATH, QFJ_ACTION_REQUEST_SIGNING_DOMAIN, parseQfjActionRequest } from "@/lib/jarvis/actionRequestContract";
import { QFJ_KEY_ID_HEADER, QFJ_SIGNATURE_HEADER, verifyQfjSignedRequestSignature } from "@/lib/jarvis/signedRequestAuth";
import { resolveQfJarvisRuntimePolicy } from "@/lib/jarvis/runtimePolicy";
import { submitJarvisRecommendation } from "@/services/jarvisRecommendationService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 12_288;
const reply = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  let raw: Uint8Array; try { raw = new Uint8Array(await request.arrayBuffer()); } catch { return reply(400, { error: "invalid_request" }); }
  if (raw.byteLength < 2 || raw.byteLength > MAX_BODY_BYTES) return reply(413, { error: "invalid_request" });
  let parsedJson: unknown; try { parsedJson = JSON.parse(Buffer.from(raw).toString("utf8")); } catch { return reply(400, { error: "invalid_request" }); }
  const parsed = parseQfjActionRequest(parsedJson); if (!parsed) return reply(400, { error: "invalid_request" });
  const keys = parseQfjVerificationKeys(process.env.QF_JARVIS_CORE_VERIFICATION_KEYS_JSON); if (!keys) return reply(503, { error: "service_unavailable" });
  const ok = verifyQfjSignedRequestSignature({ rawBody: raw, domain: QFJ_ACTION_REQUEST_SIGNING_DOMAIN, path: QFJ_ACTION_REQUEST_PATH, requestId: parsed.requestId, issuedAt: parsed.issuedAt,
    keyId: request.headers.get(QFJ_KEY_ID_HEADER), signature: request.headers.get(QFJ_SIGNATURE_HEADER), keys, now: new Date().toISOString() });
  if (!ok) return reply(401, { error: "authentication_failed" });
  const result = await submitJarvisRecommendation({ request: parsed, policy: resolveQfJarvisRuntimePolicy() });
  if (!result.ok) return reply(result.reason === "agent_paused" ? 403 : 503, { protocol: "qfj.action.request", version: 1, requestId: parsed.requestId, status: result.reason });
  return reply(202, { protocol: "qfj.action.request", version: 1, requestId: parsed.requestId, recommendationId: result.recommendation.recommendationId,
    recommendationState: result.recommendation.actionState, authorized: false, automationRequestId: null, jobCreated: false });
}