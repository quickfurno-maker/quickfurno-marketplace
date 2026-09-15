import {
  QFJ_RIYA_INGRESS_PATH, QFJ_RIYA_KEY_ID_HEADER, QFJ_RIYA_SIGNATURE_HEADER,
  buildQfjPrivateRiyaIngressRequest, parseQfjPrivateRiyaIngressResponse, signQfjPrivateRiyaIngressBody,
  type QfjPrivateRiyaIngressRequestV1, type QfjPrivateRiyaIngressResponseV1,
} from "../lib/jarvis/privateRiyaIngressContract";
import { type QfJarvisRuntimePolicy } from "../lib/jarvis/runtimePolicy";

export interface QfjHttpResponse { readonly status: number; text(): Promise<string>; }
export type QfjHttpPost = (url: string, init: { method: "POST"; headers: Readonly<Record<string,string>>; body: string; signal: AbortSignal; redirect: "error" }) => Promise<QfjHttpResponse>;
export interface JarvisRiyaWebGatewayConfig { readonly baseUrl: string; readonly keyId: string; readonly privateKeyPem: string; readonly timeoutMs?: number; readonly httpPost?: QfjHttpPost; }
export type JarvisRiyaGatewayResult = { readonly ok: true; readonly response: QfjPrivateRiyaIngressResponseV1 } | { readonly ok: false; readonly reason: "disabled" | "unavailable" | "invalid_response" };

function endpoint(baseUrl: string): string {
  const url = new URL(baseUrl); const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("INVALID_JARVIS_BASE_URL");
  return new URL(QFJ_RIYA_INGRESS_PATH, url).toString();
}
const defaultHttpPost: QfjHttpPost = async (url, init) => fetch(url, init);

export async function sendRiyaWebTurn(args: {
  readonly policy: QfJarvisRuntimePolicy; readonly config: JarvisRiyaWebGatewayConfig;
  readonly request: Omit<QfjPrivateRiyaIngressRequestV1, "protocol" | "version" | "caller" | "audience">;
}): Promise<JarvisRiyaGatewayResult> {
  if (args.policy.mode === "off" || !args.policy.riyaEnabled || !args.policy.riyaWebTurnEnabled) return { ok: false, reason: "disabled" };
  const request = buildQfjPrivateRiyaIngressRequest(args.request); const body = JSON.stringify(request); const raw = Buffer.from(body, "utf8");
  const signature = signQfjPrivateRiyaIngressBody({ rawBody: raw, requestId: request.requestId, issuedAt: request.issuedAt, keyId: args.config.keyId, privateKeyPem: args.config.privateKeyPem });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), args.config.timeoutMs ?? 5_000);
  try {
    const response = await (args.config.httpPost ?? defaultHttpPost)(endpoint(args.config.baseUrl), { method: "POST", redirect: "error", signal: controller.signal,
      headers: { "content-type": "application/json", [QFJ_RIYA_KEY_ID_HEADER]: args.config.keyId, [QFJ_RIYA_SIGNATURE_HEADER]: signature }, body });
    if (response.status !== 200) return { ok: false, reason: "unavailable" };
    let parsed: unknown; try { parsed = JSON.parse(await response.text()); } catch { return { ok: false, reason: "invalid_response" }; }
    const wire = parseQfjPrivateRiyaIngressResponse(parsed); if (!wire) return { ok: false, reason: "invalid_response" };
    if (wire.requestId !== request.requestId || wire.tenantId !== request.tenantId || wire.conversationId !== request.conversationId || wire.messageId !== request.messageId) return { ok: false, reason: "invalid_response" };
    return { ok: true, response: wire };
  } catch { return { ok: false, reason: "unavailable" }; } finally { clearTimeout(timer); }
}
