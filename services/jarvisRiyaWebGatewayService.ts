import {
  QFJ_RIYA_INGRESS_PATH, QFJ_RIYA_KEY_ID_HEADER, QFJ_RIYA_SIGNATURE_HEADER,
  buildQfjPrivateRiyaIngressRequest, buildQfjPrivateRiyaQualificationIngressRequest,
  parseQfjPrivateRiyaIngressResponse, parseQfjPrivateRiyaQualificationIngressResponse,
  signQfjPrivateRiyaIngressBody,
  type QfjPrivateRiyaIngressRequestV1, type QfjPrivateRiyaIngressResponseV1,
  type QfjPrivateRiyaQualificationIngressRequestV2, type QfjPrivateRiyaQualificationIngressResponseV2,
} from "../lib/jarvis/privateRiyaIngressContract";
import { type QfJarvisRuntimePolicy } from "../lib/jarvis/runtimePolicy";
import {
  postJarvisScale,
  type QfjScaleHttpPost,
  type QfjScaleHttpResponse,
} from "./jarvisScaleTransport";

export type QfjHttpResponse = QfjScaleHttpResponse;
export type QfjHttpPost = QfjScaleHttpPost;
export interface JarvisRiyaWebGatewayConfig { readonly baseUrl: string; readonly keyId: string; readonly privateKeyPem: string; readonly timeoutMs?: number; readonly httpPost?: QfjHttpPost; }
export type JarvisRiyaGatewayResult = { readonly ok: true; readonly response: QfjPrivateRiyaIngressResponseV1 } | { readonly ok: false; readonly reason: "disabled" | "unavailable" | "invalid_response" };
export type JarvisRiyaQualificationGatewayResult = { readonly ok: true; readonly response: QfjPrivateRiyaQualificationIngressResponseV2 } | { readonly ok: false; readonly reason: "disabled" | "unavailable" | "invalid_response" };

function endpoint(baseUrl: string): string {
  const url = new URL(baseUrl); const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("INVALID_JARVIS_BASE_URL");
  return new URL(QFJ_RIYA_INGRESS_PATH, url).toString();
}

async function postRiyaRequest(args: {
  readonly config: JarvisRiyaWebGatewayConfig;
  readonly body: string;
  readonly signature: string;
  readonly requestId: string;
}) {
  return postJarvisScale({
    url: endpoint(args.config.baseUrl),
    path: QFJ_RIYA_INGRESS_PATH,
    body: args.body,
    keyId: args.config.keyId,
    privateKeyPem: args.config.privateKeyPem,
    actor: "RIYA",
    requestId: args.requestId,
    idempotencyKey: args.requestId,
    timeoutMs: args.config.timeoutMs,
    headers: {
      "content-type": "application/json",
      [QFJ_RIYA_KEY_ID_HEADER]: args.config.keyId,
      [QFJ_RIYA_SIGNATURE_HEADER]: args.signature,
    },
    httpPost: args.config.httpPost,
  });
}

export async function sendRiyaWebTurn(args: {
  readonly policy: QfJarvisRuntimePolicy; readonly config: JarvisRiyaWebGatewayConfig;
  readonly request: Omit<QfjPrivateRiyaIngressRequestV1, "protocol" | "version" | "caller" | "audience">;
}): Promise<JarvisRiyaGatewayResult> {
  if (args.policy.mode === "off" || !args.policy.riyaEnabled || !args.policy.riyaWebTurnEnabled) return { ok: false, reason: "disabled" };
  const request = buildQfjPrivateRiyaIngressRequest(args.request); const body = JSON.stringify(request); const raw = Buffer.from(body, "utf8");
  const signature = signQfjPrivateRiyaIngressBody({ rawBody: raw, requestId: request.requestId, issuedAt: request.issuedAt, keyId: args.config.keyId, privateKeyPem: args.config.privateKeyPem });
  const result = await postRiyaRequest({ config: args.config, body, signature, requestId: request.requestId });
  if (!result.ok || result.response.status !== 200) return { ok: false, reason: "unavailable" };
  let parsed: unknown; try { parsed = JSON.parse(await result.response.text()); } catch { return { ok: false, reason: "invalid_response" }; }
  const wire = parseQfjPrivateRiyaIngressResponse(parsed); if (!wire) return { ok: false, reason: "invalid_response" };
  if (wire.requestId !== request.requestId || wire.tenantId !== request.tenantId || wire.conversationId !== request.conversationId || wire.messageId !== request.messageId) return { ok: false, reason: "invalid_response" };
  return { ok: true, response: wire };
}

export async function sendRiyaQualificationInterpretation(args: {
  readonly policy: QfJarvisRuntimePolicy;
  readonly config: JarvisRiyaWebGatewayConfig;
  readonly request: Omit<QfjPrivateRiyaQualificationIngressRequestV2, "protocol" | "version" | "caller" | "audience">;
}): Promise<JarvisRiyaQualificationGatewayResult> {
  if (
    args.policy.mode !== "active" ||
    !args.policy.riyaEnabled ||
    !args.policy.riyaWebTurnEnabled ||
    !args.policy.riyaQualificationEnabled
  ) {
    return { ok: false, reason: "disabled" };
  }
  const request = buildQfjPrivateRiyaQualificationIngressRequest(args.request);
  const body = JSON.stringify(request);
  const raw = Buffer.from(body, "utf8");
  const signature = signQfjPrivateRiyaIngressBody({
    rawBody: raw,
    requestId: request.requestId,
    issuedAt: request.issuedAt,
    keyId: args.config.keyId,
    privateKeyPem: args.config.privateKeyPem,
  });
  const result = await postRiyaRequest({ config: args.config, body, signature, requestId: request.requestId });
  if (!result.ok || result.response.status !== 200) return { ok: false, reason: "unavailable" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await result.response.text());
  } catch {
    return { ok: false, reason: "invalid_response" };
  }
  const wire = parseQfjPrivateRiyaQualificationIngressResponse(parsed);
  if (!wire) return { ok: false, reason: "invalid_response" };
  if (
    wire.requestId !== request.requestId ||
    wire.tenantId !== request.tenantId ||
    wire.conversationId !== request.conversationId ||
    wire.messageId !== request.messageId
  ) {
    return { ok: false, reason: "invalid_response" };
  }
  return { ok: true, response: wire };
}
