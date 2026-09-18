import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { decideCallbackIdentityRegistry } from "../../../lib/communication/providers/metaCallbackIdentityRegistry.ts";
import {
  resolveConversationalMetaConfig,
  resolveWebhookIdentityRegistryConfig,
} from "../../../lib/communication/providers/metaCloudWhatsAppConfig.ts";
import {
  sealConversationValue,
  openConversationValue,
} from "../../../lib/communication/conversationSeal.ts";
import {
  QFJ_WHATSAPP_REPLY_PATH,
  QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN,
  parseQfjWhatsAppReplyRequest,
} from "../../../lib/jarvis/whatsAppReplyContract.ts";
import { isConsentControlMessage } from "../../../lib/communication/inboundConsentCommandInput.ts";

const read = (p) => fs.readFileSync(p, "utf8");
const migration = read("supabase/migrations/20260918120000_whatsapp_conversational_jarvis_foundation.sql");
const conversationService = read("services/conversationalWhatsAppService.ts");
const gatewayService = read("services/jarvisWhatsAppGatewayService.ts");
const replyRoute = read("app/api/internal/jarvis/whatsapp-reply/route.ts");
const webhookService = read("services/metaWhatsAppWebhookService.ts");
const metaProviderSource = read("lib/communication/providers/metaCloudWhatsAppProvider.ts");

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed += 1; console.log("PASS", name); }
  catch (e) { console.error("FAIL", name); throw e; }
};

await test("core provider account is explicitly protected from Jarvis", () => {
  assert.match(migration, /account_alias='core'/);
  assert.match(migration, /account_role='transactional'/);
  assert.match(migration, /jarvis_access_mode='denied'/);
});
await test("conversational provider accounts are proposal-only, never Jarvis-owned", () => {
  assert.match(migration, /account_role in \('transactional','conversational'\)/);
  assert.match(migration, /jarvis_access_mode in \('denied','proposal_only'\)/);
  assert.match(migration, /jarvis_access_mode='denied' or account_role='conversational'/);
});
await test("conversation state owns service-window and takeover authority", () => {
  assert.match(migration, /service_window_expires_at timestamptz/);
  assert.match(migration, /human_takeover boolean not null default false/);
  assert.match(migration, /not \(jarvis_enabled and human_takeover\)/);
  assert.match(migration, /revision bigint not null default 0/);
});
await test("conversation destination and reply body are sealed, not plaintext columns", () => {
  assert.match(migration, /sealed_destination_ciphertext text not null/);
  assert.match(migration, /sealed_body_ciphertext text not null/);
  assert.doesNotMatch(migration, /destination_e164\s+text/i);
  assert.doesNotMatch(migration, /phone_e164\s+text/i);
  assert.doesNotMatch(migration, /reply_body\s+text/i);
});
await test("new conversation tables are browser-denied and service-role scoped", () => {
  assert.match(migration, /alter table public\.%I enable row level security/);
  assert.match(migration, /revoke all on public\.%I from public,anon,authenticated/);
  assert.match(migration, /grant select,insert,update on public\.communication_conversations to service_role/);
  assert.match(migration, /grant select,insert,update on public\.communication_conversation_outbox to service_role/);
});
await test("reply outbox is one-shot after a provider attempt", () => {
  assert.match(migration, /attempt_count integer not null default 0 check \(attempt_count between 0 and 1\)/);
  assert.match(conversationService, /outcome_unknown/);
  assert.doesNotMatch(conversationService, /retry_scheduled/);
});
await test("24 hour service window is Core-owned and enforced at queue and dispatch", () => {
  assert.match(conversationService, /24 \* 60 \* 60 \* 1000/);
  const occurrences = (conversationService.match(/service_window_closed/g) ?? []).length;
  assert.ok(occurrences >= 3);
});
await test("human takeover and optimistic revision are rechecked before send", () => {
  assert.match(conversationService, /conversation\.human_takeover/);
  assert.match(conversationService, /Number\(conversation\.revision\) !== Number\(claimed\.expected_revision\)/);
});
await test("suppression is checked before Jarvis queue and again before Meta send", () => {
  const occurrences = (conversationService.match(/activeSuppression\(/g) ?? []).length;
  assert.ok(occurrences >= 3);
});
await test("Jarvis reply contract cannot select phone, provider account, WABA or token", () => {
  const valid = {
    protocol: "qfj.whatsapp.reply", version: 1, caller: "qf-jarvis", audience: "quickfurno-core",
    requestId: crypto.randomUUID(), issuedAt: new Date().toISOString(), conversationId: crypto.randomUUID(),
    expectedRevision: 3, proposalId: "proposal.1", body: "Hello", idempotencyKey: "a".repeat(64),
  };
  assert.ok(parseQfjWhatsAppReplyRequest(valid));
  for (const field of ["phoneNumberId","providerAccountId","wabaId","accessToken","to"]) {
    assert.equal(parseQfjWhatsAppReplyRequest({ ...valid, [field]: "x" }), null);
  }
});
await test("Jarvis reply route is signed and feature-gated off by default", () => {
  assert.equal(QFJ_WHATSAPP_REPLY_PATH, "/api/internal/jarvis/whatsapp-reply");
  assert.equal(QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN, "qfj.whatsapp.reply.http.sig.v1");
  assert.match(replyRoute, /QF_JARVIS_WHATSAPP_ENABLED/);
  assert.match(replyRoute, /policy\.mode !== "active"/);
  assert.match(replyRoute, /verifyQfjSignedRequestSignature/);
  assert.match(replyRoute, /providerAuthority: "quickfurno-core"/);
});
await test("QuickFurno to Jarvis gateway carries conversation facts but no provider secrets", () => {
  assert.match(gatewayService, /QF_JARVIS_BASE_URL/);
  assert.match(gatewayService, /QF_JARVIS_SIGNING_PRIVATE_KEY_PEM/);
  assert.match(gatewayService, /normalizedText/);
  assert.doesNotMatch(gatewayService, /WHATSAPP_ACCESS_TOKEN/);
  assert.doesNotMatch(gatewayService, /WHATSAPP_APP_SECRET/);
  assert.doesNotMatch(gatewayService, /WHATSAPP_PHONE_NUMBER_ID/);
});
await test("multi-account callback gate admits either exact configured identity", () => {
  const p1 = { object:"whatsapp_business_account", entry:[{ id:"111", changes:[{ field:"messages", value:{ metadata:{ phone_number_id:"222" }}}]}]};
  const p2 = { object:"whatsapp_business_account", entry:[{ id:"111", changes:[{ field:"messages", value:{ metadata:{ phone_number_id:"333" }}}]}]};
  const registry = { identities:[{wabaId:"111",phoneNumberId:"222"},{wabaId:"111",phoneNumberId:"333"}] };
  assert.equal(decideCallbackIdentityRegistry(p1, registry).kind, "authorized");
  assert.equal(decideCallbackIdentityRegistry(p2, registry).kind, "authorized");
});
await test("mixed callback identities remain rejected", () => {
  const mixed = { object:"whatsapp_business_account", entry:[{ id:"111", changes:[
    { field:"messages", value:{ metadata:{ phone_number_id:"222" }}},
    { field:"messages", value:{ metadata:{ phone_number_id:"333" }}},
  ]}]};
  const registry = { identities:[{wabaId:"111",phoneNumberId:"222"},{wabaId:"111",phoneNumberId:"333"}] };
  assert.equal(decideCallbackIdentityRegistry(mixed, registry).kind, "rejected");
});
await test("webhook identity registry keeps existing single-account behavior when conversational vars absent", () => {
  const env = { WHATSAPP_WABA_ID:"111", WHATSAPP_PHONE_NUMBER_ID:"222" };
  const res = resolveWebhookIdentityRegistryConfig(env);
  assert.ok(res.ok);
  assert.equal(res.identities.length, 1);
});
await test("partial conversational webhook identity fails closed", () => {
  const env = { WHATSAPP_WABA_ID:"111", WHATSAPP_PHONE_NUMBER_ID:"222", WHATSAPP_CONVERSATIONAL_PHONE_NUMBER_ID:"333" };
  const res = resolveWebhookIdentityRegistryConfig(env);
  assert.equal(res.ok, false);
});
await test("conversational Meta config is separate from Core credentials", () => {
  const env = {
    WHATSAPP_CONVERSATIONAL_ACCESS_TOKEN:"token",
    WHATSAPP_CONVERSATIONAL_PHONE_NUMBER_ID:"333",
    WHATSAPP_CONVERSATIONAL_WABA_ID:"111",
    WHATSAPP_GRAPH_API_VERSION:"v26.0",
    WHATSAPP_AUTH_HTTP_TIMEOUT_MS:"3000",
    WHATSAPP_HTTP_TIMEOUT_MS:"10000",
  };
  const res = resolveConversationalMetaConfig(env);
  assert.ok(res.ok);
  assert.equal(res.config.phoneNumberId, "333");
});
await test("conversation AES-GCM seal round-trips and rejects wrong AAD", () => {
  const key = crypto.randomBytes(32).toString("base64url");
  const env = { QF_CONVERSATION_SEAL_PRIMARY_KEY_ID:"v1", QF_CONVERSATION_SEAL_KEYS:JSON.stringify({v1:key}) };
  const sealed = sealConversationValue("+919999999999", "aad-A", env);
  assert.ok(sealed.ok);
  const opened = openConversationValue(sealed.value, "aad-A", env);
  assert.ok(opened.ok);
  assert.equal(opened.value, "+919999999999");
  assert.equal(openConversationValue(sealed.value, "aad-B", env).ok, false);
});
await test("Meta adapter has a bounded text lane with optional reply context", () => {
  assert.match(metaProviderSource, /export function buildMetaTextPayload/);
  assert.match(metaProviderSource, /type: "text"/);
  assert.match(metaProviderSource, /payload\.context = \{ message_id: replyToProviderMessageId \}/);
  assert.match(metaProviderSource, /text\.length < 1 \|\| text\.length > 4096/);
  assert.match(metaProviderSource, /async sendTextMessage/);
});
await test("webhook service uses registry authority before downstream processing", () => {
  assert.match(webhookService, /resolveWebhookIdentityRegistryConfig/);
  assert.match(webhookService, /decideCallbackIdentityRegistry/);
});
await test("STOP START HELP are persisted controls but never Jarvis turns", () => {
  const candidate = (text) => ({
    provider: "meta_whatsapp_cloud", providerMessageId: "wamid.control", messageType: "text",
    contentMinimized: { text }, providerOccurredAt: null,
  });
  for (const text of ["STOP", " stop ", "START", "UNSTOP", "HELP", "INFO"]) {
    assert.equal(isConsentControlMessage(candidate(text)), true, text);
  }
  assert.equal(isConsentControlMessage(candidate("hello riya")), false);
  assert.equal(isConsentControlMessage({ ...candidate("STOP"), messageType: "button" }), false);
});
await test("proposal-only conversational accounts route new conversations to Riya", () => {
  assert.match(conversationService, /assigned_actor: account\.jarvis_access_mode === "proposal_only" \? "RIYA" : "AAROHI"/);
  assert.match(conversationService, /jarvis_enabled: account\.jarvis_access_mode === "proposal_only"/);
});
await test("conversation service gates Jarvis enqueue on consent, state, takeover and feature flags", () => {
  assert.match(conversationService, /input\.suppressJarvisTurn !== true[\s\S]{0,700}communication_jarvis_turn_outbox/);
  assert.match(conversationService, /conversation\.state === "OPEN"/);
  assert.match(conversationService, /conversation\.human_takeover !== true/);
  assert.match(conversationService, /QF_JARVIS_WHATSAPP_ENABLED/);
});
await test("conversation projection binds request-memory sender to the durable inbound row", () => {
  assert.match(conversationService, /select\("id,provider_account_id,provider_message_id,sender_hash,conversation_id"\)/);
  assert.match(conversationService, /durableInbound\.provider_account_id !== input\.providerAccountId/);
  assert.match(conversationService, /durableInbound\.provider_message_id !== input\.providerMessageId/);
  assert.match(conversationService, /durableInbound\.sender_hash !== requestDestinationHash/);
});
await test("Meta redelivery is idempotent once the durable inbound is linked", () => {
  assert.match(conversationService, /if \(durableInbound\.conversation_id\)[\s\S]{0,900}conversationId: linked\.id/);
  assert.match(conversationService, /last_inbound_provider_message_id === input\.providerMessageId/);
  assert.match(conversationService, /\.eq\("revision", existing\.revision\)/);
});
await test("migration never auto-labels multiple pre-existing Meta accounts as Core", () => {
  assert.match(migration, /having count\(\*\)=1/);
  assert.match(migration, /from sole_existing_meta_account as sole/);
});
await test("migration contains no Jarvis direct provider credential or send authority", () => {
  assert.doesNotMatch(migration, /access_token/i);
  assert.doesNotMatch(migration, /app_secret/i);
  assert.doesNotMatch(migration, /service_role_key/i);
});

console.log(`\nWhatsApp/Jarvis readiness: ${passed} passed, 0 failed.`);
