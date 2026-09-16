import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  QFJ_CORE_DECISION_PROTOCOL,
  buildQfjCoreDecisionResponse,
  canonicalQfjJson,
  parseQfjCoreDecisionCommand,
  parseSerializedQfjCoreDecisionCommand,
} from "../../../lib/jarvis/coreDecisionContract.ts";
import {
  QFJ_CORE_DECISION_PATH,
  QFJ_CORE_DECISION_SIGNING_DOMAIN,
  parseQfjVerificationKeys,
  qfjCoreDecisionSigningInput,
  rawQfjBodyDigest,
  verifyQfjCoreDecisionSignature,
} from "../../../lib/jarvis/coreDecisionAuth.ts";
import { resolveQfJarvisRuntimePolicy } from "../../../lib/jarvis/runtimePolicy.ts";
import { decideJarvisCoreCommand } from "../../../services/jarvisCoreDecisionService.ts";
import {
  QFJ_RIYA_INGRESS_PATH,
  QFJ_RIYA_INGRESS_SIGNING_DOMAIN,
  buildQfjPrivateRiyaIngressRequest,
  parseQfjPrivateRiyaIngressResponse,
  qfjRiyaIngressSigningInput,
  signQfjPrivateRiyaIngressBody,
} from "../../../lib/jarvis/privateRiyaIngressContract.ts";
import { sendRiyaWebTurn } from "../../../services/jarvisRiyaWebGatewayService.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) { passed += 1; console.log(`PASS ${name}`); }
  else { failed += 1; console.error(`FAIL ${name}`); }
}

const now = "2026-09-15T06:00:00.000Z";
const command = Object.freeze({
  protocol: QFJ_CORE_DECISION_PROTOCOL,
  commandId: "conv-1-prop-1-r7",
  idempotencyKey: "0123456789abcdef0123456789abcdef",
  correlationId: "corr-1",
  proposalId: "prop-1",
  proposalVersion: 1,
  conversationId: "conv-1",
  expectedRevision: 7,
  proposalDigest: "abcdef0123456789abcdef0123456789",
  assignedActor: "RIYA",
  partyType: "CLIENT",
  proposalKind: "REPLY",
  structuredIntent: Object.freeze({ taskClass: "RESPONSE_GENERATION", replyKind: "REPLY", behaviourVersion: "v1" }),
  policyRevision: "policy.rev.1",
  evaluationRef: "evref-riya01",
  citations: Object.freeze([{ knowledgeId: "knowledge.1", version: 1, source: "qf-core-safe", digest: "12345678abcdef00" }]),
  proposedReplyBody: "Namaste, I can help with your interior requirement.",
  createdAt: now,
});
const serialized = canonicalQfjJson(command);

check("01 exact qfj.core.decision v2 identity", QFJ_CORE_DECISION_PROTOCOL.name === "qfj.core.decision" && QFJ_CORE_DECISION_PROTOCOL.version === 2 && QFJ_CORE_DECISION_PROTOCOL.contractDigest === "c0de0002");
check("02 valid command parses", parseQfjCoreDecisionCommand(command).ok === true);
check("03 serialized command parses", parseSerializedQfjCoreDecisionCommand(serialized).ok === true);
check("04 unknown command key is refused", parseQfjCoreDecisionCommand({ ...command, surprise: true }).ok === false);
check("05 protocol drift is refused", parseQfjCoreDecisionCommand({ ...command, protocol: { ...command.protocol, version: 3 } }).ok === false);
check("06 Riya cannot claim vendor scope", parseQfjCoreDecisionCommand({ ...command, partyType: "VENDOR" }).ok === false);
check("07 Anisha vendor scope parses", parseQfjCoreDecisionCommand({ ...command, assignedActor: "ANISHA", partyType: "VENDOR" }).ok === true);
check("08 Aarohi prospect wire remains parseable", parseQfjCoreDecisionCommand({ ...command, assignedActor: "AAROHI", partyType: "PROSPECT", structuredIntent: { requiresCoreConsentRevalidation: true } }).ok === true);
check("09 body bound reply requires text", parseQfjCoreDecisionCommand({ ...command, proposedReplyBody: null }).ok === false);
check("10 non-reply must not smuggle body", parseQfjCoreDecisionCommand({ ...command, proposalKind: "NO_ACTION" }).ok === false);
check("11 valid no-action uses null body", parseQfjCoreDecisionCommand({ ...command, proposalKind: "NO_ACTION", proposedReplyBody: null }).ok === true);
check("12 invalid JSON is refused", parseSerializedQfjCoreDecisionCommand("{").ok === false);

const keys = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" });
const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" });
const keyId = "qfj-test-key-1";
const raw = Buffer.from(serialized, "utf8");
const coreSigInput = qfjCoreDecisionSigningInput({ commandId: command.commandId, createdAt: command.createdAt, keyId, bodyDigest: rawQfjBodyDigest(raw) });
const signature = crypto.sign(null, Buffer.from(coreSigInput, "utf8"), keys.privateKey).toString("base64url");
const keyRing = parseQfjVerificationKeys(JSON.stringify([{ keyId, publicKeyPem }]));
check("13 public verification key parses", Array.isArray(keyRing) && keyRing.length === 1);
check("14 private key is refused from verification config", parseQfjVerificationKeys(JSON.stringify([{ keyId, publicKeyPem: privateKeyPem }])) === null);
check("15 valid Jarvis signature verifies", keyRing !== null && verifyQfjCoreDecisionSignature({ rawBody: raw, command, keyId, signature, keys: keyRing, now }));
check("16 one-byte body tamper fails signature", keyRing !== null && !verifyQfjCoreDecisionSignature({ rawBody: Buffer.concat([raw, Buffer.from(" ")]), command, keyId, signature, keys: keyRing, now }));
check("17 unknown key id fails signature", keyRing !== null && !verifyQfjCoreDecisionSignature({ rawBody: raw, command, keyId: "other", signature, keys: keyRing, now }));
check("18 stale command fails signature", keyRing !== null && !verifyQfjCoreDecisionSignature({ rawBody: raw, command, keyId, signature, keys: keyRing, now: "2026-09-15T06:02:00.000Z" }));
check("19 core decision HTTP path is fixed", QFJ_CORE_DECISION_PATH === "/api/internal/jarvis/core-decision");
check("20 signing domain is versioned", QFJ_CORE_DECISION_SIGNING_DOMAIN === "qfj.core.decision.http.sig.v1");

const off = resolveQfJarvisRuntimePolicy({});
const shadow = resolveQfJarvisRuntimePolicy({ QF_JARVIS_MODE: "shadow", QF_JARVIS_CORE_DECISION_ENABLED: "true", QF_JARVIS_RIYA_ENABLED: "true" });
const active = resolveQfJarvisRuntimePolicy({ QF_JARVIS_MODE: "active", QF_JARVIS_CORE_DECISION_ENABLED: "true", QF_JARVIS_RIYA_ENABLED: "true" });
const invalidMode = resolveQfJarvisRuntimePolicy({ QF_JARVIS_MODE: "banana", QF_JARVIS_CORE_DECISION_ENABLED: "true" });
check("21 runtime defaults globally off", off.mode === "off" && off.coreDecisionEnabled === false && off.riyaEnabled === false);
check("22 invalid runtime mode fails to off", invalidMode.mode === "off");
const offDecision = await decideJarvisCoreCommand({ command, policy: off, decidedAt: now });
check("23 off mode cannot authorize", offDecision.outcome === "CORE_UNAVAILABLE");
const shadowDecision = await decideJarvisCoreCommand({ command, policy: shadow, decidedAt: now });
check("24 shadow mode cannot authorize", shadowDecision.outcome === "HUMAN_REVIEW_REQUIRED");
const activeNoAuthorizer = await decideJarvisCoreCommand({ command, policy: active, decidedAt: now });
check("25 active mode without Core authorizer cannot authorize", activeNoAuthorizer.outcome === "CORE_UNAVAILABLE");
const activeAccepted = await decideJarvisCoreCommand({ command, policy: active, decidedAt: now, authorizer: async () => ({ outcome: "ACCEPTED", reason: "core_policy_accepted" }) });
check("26 only injected Core authorizer can ACCEPT", activeAccepted.outcome === "ACCEPTED" && activeAccepted.reason === "core_policy_accepted");
const aarohiDecision = await decideJarvisCoreCommand({ command: { ...command, assignedActor: "AAROHI", partyType: "PROSPECT" }, policy: active, decidedAt: now, authorizer: async () => ({ outcome: "ACCEPTED", reason: "bad" }) });
check("27 Phase 60 cannot activate Aarohi Core authority", aarohiDecision.outcome === "HUMAN_REVIEW_REQUIRED" || aarohiDecision.outcome === "REJECTED");
const response = buildQfjCoreDecisionResponse(command, "REJECTED", "core_policy_rejected", now);
check("28 response echoes proposal digest", response.proposalDigest === command.proposalDigest && response.boundRevision === command.expectedRevision);

const riyaReq = buildQfjPrivateRiyaIngressRequest({ requestId: "req-1", issuedAt: now, tenantId: "quickfurno", conversationId: "conv-1", messageId: "msg-1", receivedAt: now, webTurnRef: "webturn:1", subjectRef: "client:1", normalizedText: "Need a 2 BHK interior quote" });
const riyaBody = Buffer.from(JSON.stringify(riyaReq), "utf8");
const riyaSig = signQfjPrivateRiyaIngressBody({ rawBody: riyaBody, requestId: riyaReq.requestId, issuedAt: riyaReq.issuedAt, keyId, privateKeyPem });
const riyaInput = qfjRiyaIngressSigningInput({ requestId: riyaReq.requestId, issuedAt: riyaReq.issuedAt, keyId, bodyDigest: crypto.createHash("sha256").update(riyaBody).digest("base64url") });
check("29 Riya ingress path exact", QFJ_RIYA_INGRESS_PATH === "/internal/v1/riya/web-turn");
check("30 Riya signing domain exact", QFJ_RIYA_INGRESS_SIGNING_DOMAIN === "qfj.riya.web.ingress.sig.v1");
check("31 QuickFurno Riya signature independently verifies", crypto.verify(null, Buffer.from(riyaInput, "utf8"), keys.publicKey, Buffer.from(riyaSig, "base64url")));
check("32 browser authority field cannot enter Riya request builder", !Object.prototype.hasOwnProperty.call(riyaReq, "dataClass") && !Object.prototype.hasOwnProperty.call(riyaReq, "consent"));

const wireResponse = { protocol: "qfj.riya.web.ingress", version: 1, requestId: "req-1", tenantId: "quickfurno", conversationId: "conv-1", messageId: "msg-1", disposition: "PROCESSED", reason: null, authorizedReply: { version: 1, proposalId: "prop-1", boundRevision: 7, proposalKind: "REPLY", replyBody: "Authorized response" } };
check("33 valid minimal Riya response parses", parseQfjPrivateRiyaIngressResponse(wireResponse)?.authorizedReply?.replyBody === "Authorized response");
check("34 extra Riya response key refused", parseQfjPrivateRiyaIngressResponse({ ...wireResponse, model: "forbidden" }) === null);
let disabledCalls = 0;
const gatewayOff = await sendRiyaWebTurn({ policy: off, config: { baseUrl: "https://jarvis.internal/", keyId, privateKeyPem, httpPost: async () => { disabledCalls += 1; throw new Error("must not call"); } }, request: { requestId: "req-1", issuedAt: now, tenantId: "quickfurno", conversationId: "conv-1", messageId: "msg-1", receivedAt: now, webTurnRef: "webturn:1", normalizedText: "hello" } });
check("35 gateway off means zero network calls", !gatewayOff.ok && gatewayOff.reason === "disabled" && disabledCalls === 0);
const gatewayPolicy = resolveQfJarvisRuntimePolicy({ QF_JARVIS_MODE: "shadow", QF_JARVIS_RIYA_ENABLED: "true", QF_JARVIS_RIYA_WEB_TURN_ENABLED: "true" });
let calls = 0;
let observedHeaders = null;
const gatewayOk = await sendRiyaWebTurn({ policy: gatewayPolicy, config: { baseUrl: "https://jarvis.internal/", keyId, privateKeyPem, httpPost: async (_url, init) => { calls += 1; observedHeaders = init.headers; return { status: 200, text: async () => JSON.stringify(wireResponse) }; } }, request: { requestId: "req-1", issuedAt: now, tenantId: "quickfurno", conversationId: "conv-1", messageId: "msg-1", receivedAt: now, webTurnRef: "webturn:1", normalizedText: "hello" } });
check("36 enabled gateway calls exactly once", gatewayOk.ok && calls === 1);
check("37 gateway sends only signed private headers", observedHeaders !== null && typeof observedHeaders["x-qfj-key-id"] === "string" && typeof observedHeaders["x-qfj-signature"] === "string");
const badIdentity = await sendRiyaWebTurn({ policy: gatewayPolicy, config: { baseUrl: "https://jarvis.internal/", keyId, privateKeyPem, httpPost: async () => ({ status: 200, text: async () => JSON.stringify({ ...wireResponse, messageId: "other" }) }) }, request: { requestId: "req-1", issuedAt: now, tenantId: "quickfurno", conversationId: "conv-1", messageId: "msg-1", receivedAt: now, webTurnRef: "webturn:1", normalizedText: "hello" } });
check("38 gateway rejects response identity mismatch", !badIdentity.ok && badIdentity.reason === "invalid_response");
let badBaseCalls = 0;
const badBaseResult = await sendRiyaWebTurn({ policy: gatewayPolicy, config: { baseUrl: "http://example.com/", keyId, privateKeyPem, httpPost: async () => { badBaseCalls += 1; return { status: 200, text: async () => "{}" }; } }, request: { requestId: "req-2", issuedAt: now, tenantId: "quickfurno", conversationId: "conv-1", messageId: "msg-2", receivedAt: now, webTurnRef: "webturn:2" } });
check("39 public plaintext Jarvis URL is refused before network", !badBaseResult.ok && badBaseResult.reason === "unavailable" && badBaseCalls === 0);

const routeCode = fs.readFileSync(path.join(root, "app/api/internal/jarvis/core-decision/route.ts"), "utf8");
const serviceCode = fs.readFileSync(path.join(root, "services/jarvisCoreDecisionService.ts"), "utf8");
const gatewayCode = fs.readFileSync(path.join(root, "services/jarvisRiyaWebGatewayService.ts"), "utf8");
const authorizerCode = fs.readFileSync(path.join(root, "services/jarvisProductionCoreAuthorizer.ts"), "utf8");
const all = `${routeCode}\n${serviceCode}\n${gatewayCode}`;
check("40 Jarvis integration has no Supabase client", !/adminClient|createClient|SUPABASE_SERVICE_ROLE_KEY/.test(all));
check("41 Jarvis integration has no n8n execution path", !/callN8n|n8nTool|execute-client|execute-vendor|execute-campaign/.test(all));
check("42 Jarvis integration has no provider credential", !/META_ACCESS_TOKEN|WHATSAPP_TOKEN|GROQ_API_KEY|NARA_API_KEY/.test(all));
check("43 Core route injects only the bounded production authorizer", /authorizer\s*:\s*authorizeJarvisCoreCommand/.test(routeCode) && /proposalKind === "NO_ACTION"/.test(authorizerCode) && /reply_authority_not_activated/.test(authorizerCode) && !/proposalKind === "REPLY"[\s\S]{0,160}ACCEPTED/.test(authorizerCode));
check("44 no direct Jarvis database authority", !/adminClient|supabase|\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(/i.test(all));

console.log(`RESULT ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
