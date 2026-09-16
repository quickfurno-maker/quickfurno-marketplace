import crypto from "crypto";
import type { JarvisRiyaWebGatewayConfig } from "../../services/jarvisRiyaWebGatewayService";

const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export type QfJarvisOutboundConfigResult =
  | { readonly ok: true; readonly config: JarvisRiyaWebGatewayConfig }
  | { readonly ok: false; readonly reason: "not_configured" | "invalid_config" };

function validBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    return (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
      !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
  } catch { return false; }
}

export function resolveQfJarvisOutboundConfig(env: Readonly<Record<string, string | undefined>> = process.env): QfJarvisOutboundConfigResult {
  const baseUrl = env.QF_JARVIS_BASE_URL?.trim();
  const keyId = env.QF_JARVIS_SIGNING_KEY_ID?.trim();
  const privateKeyPem = env.QF_JARVIS_SIGNING_PRIVATE_KEY_PEM?.trim();
  if (!baseUrl && !keyId && !privateKeyPem) return { ok: false, reason: "not_configured" };
  if (!baseUrl || !keyId || !privateKeyPem) return { ok: false, reason: "invalid_config" };
  if (!KEY_ID.test(keyId) || !validBaseUrl(baseUrl) || !privateKeyPem.includes("PRIVATE KEY")) {
    return { ok: false, reason: "invalid_config" };
  }
  try {
    const key = crypto.createPrivateKey(privateKeyPem);
    if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") return { ok: false, reason: "invalid_config" };
  } catch {
    return { ok: false, reason: "invalid_config" };
  }
  return {
    ok: true,
    config: Object.freeze({ baseUrl, keyId, privateKeyPem, timeoutMs: 5000 }),
  };
}
