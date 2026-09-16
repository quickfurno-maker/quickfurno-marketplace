import type { QfjPrivateRiyaIngressRequestV1 } from "../lib/jarvis/privateRiyaIngressContract";
import { resolveQfJarvisOutboundConfig } from "../lib/jarvis/outboundConfig";
import { resolveQfJarvisRuntimePolicy } from "../lib/jarvis/runtimePolicy";
import { sendRiyaWebTurn, type JarvisRiyaGatewayResult } from "./jarvisRiyaWebGatewayService";

export type ConfiguredJarvisRiyaGatewayResult =
  | JarvisRiyaGatewayResult
  | { readonly ok: false; readonly reason: "not_configured" | "invalid_config" };

export async function sendConfiguredRiyaWebTurn(
  request: Omit<QfjPrivateRiyaIngressRequestV1, "protocol" | "version" | "caller" | "audience">,
): Promise<ConfiguredJarvisRiyaGatewayResult> {
  const policy = resolveQfJarvisRuntimePolicy();
  if (policy.mode === "off" || !policy.riyaEnabled || !policy.riyaWebTurnEnabled) {
    return { ok: false, reason: "disabled" };
  }
  const resolved = resolveQfJarvisOutboundConfig();
  if (!resolved.ok) return resolved;
  return sendRiyaWebTurn({ policy, config: resolved.config, request });
}
