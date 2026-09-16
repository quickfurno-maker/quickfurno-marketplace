import { randomUUID } from "node:crypto";
import { resolveQfJarvisRuntimePolicy } from "../../../lib/jarvis/runtimePolicy.ts";
import { resolveQfJarvisOutboundConfig } from "../../../lib/jarvis/outboundConfig.ts";
import { sendConfiguredRiyaWebTurn } from "../../../services/jarvisRiyaConfiguredGatewayService.ts";

const policy = resolveQfJarvisRuntimePolicy();
if (policy.mode !== "shadow") {
  console.error("JARVIS_PROBE_REFUSED: QF_JARVIS_MODE must be shadow");
  process.exit(2);
}
if (!policy.riyaEnabled || !policy.riyaWebTurnEnabled || policy.actionProposalEnabled) {
  console.error("JARVIS_PROBE_REFUSED: Riya/web-turn must be enabled and action proposals must remain disabled");
  process.exit(2);
}
const config = resolveQfJarvisOutboundConfig();
if (!config.ok) {
  console.error(`JARVIS_PROBE_REFUSED: outbound_${config.reason}`);
  process.exit(2);
}

const now = new Date().toISOString();
const id = randomUUID();
const result = await sendConfiguredRiyaWebTurn({
  requestId: id,
  issuedAt: now,
  tenantId: "quickfurno",
  conversationId: `handshake-${id}`,
  messageId: `probe-${id}`,
  receivedAt: now,
  webTurnRef: `shadow-probe:${id}`,
});

if (!result.ok) {
  console.error(`JARVIS_PROBE_FAILED: ${result.reason}`);
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  protocol: result.response.protocol,
  disposition: result.response.disposition,
  reason: result.response.reason,
  authorizedReplyPresent: result.response.authorizedReply !== null,
}));
