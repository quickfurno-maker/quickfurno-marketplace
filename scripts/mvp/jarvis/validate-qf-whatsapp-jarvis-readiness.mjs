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
  QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN_V1,
  parseQfjWhatsAppReplyRequest,
} from "../../../lib/jarvis/whatsAppReplyContract.ts";
import { isConsentControlMessage } from "../../../lib/communication/inboundConsentCommandInput.ts";
import { resolveWhatsAppConciergeRouting } from "../../../lib/communication/whatsAppConciergeRouting.ts";
import {
  QF_CONCIERGE_ACTIONS,
  buildQuickFurnoConciergeMenu,
} from "../../../lib/jarvis/whatsAppExperience.ts";
import { buildMetaInteractivePayload } from "../../../lib/communication/providers/metaWhatsAppInteractive.ts";

const read = (p) => fs.readFileSync(p, "utf8");
const migration = read("supabase/migrations/20260918120000_whatsapp_conversational_jarvis_foundation.sql");
const callbackReplayMigration = read("supabase/migrations/20260918180500_jarvis_whatsapp_callback_replay_receipts.sql");
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
await test("reply outbox idempotency converges only on exact proposal identity", () => {
  assert.match(conversationService, /select\("id,conversation_id,provider_account_id,proposal_source,proposal_id,expected_revision,body_digest"\)/);
  assert.match(conversationService, /existing\.conversation_id === input\.conversationId/);
  assert.match(conversationService, /existing\.provider_account_id === conversation\.provider_account_id/);
  assert.match(conversationService, /existing\.proposal_source === input\.source/);
  assert.match(conversationService, /existing\.proposal_id === input\.proposalId/);
  assert.match(conversationService, /Number\(existing\.expected_revision\) === input\.expectedRevision/);
  assert.match(conversationService, /existing\.body_digest === digest/);
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
await test("Jarvis reply contracts cannot select phone, provider account, WABA or token", () => {
  const base = {
    protocol: "qfj.whatsapp.reply", caller: "qf-jarvis", audience: "quickfurno-core",
    requestId: crypto.randomUUID(), issuedAt: new Date().toISOString(), conversationId: crypto.randomUUID(),
    expectedRevision: 3, proposalId: "proposal.1", idempotencyKey: "a".repeat(64),
  };
  const v1 = { ...base, version: 1, body: "Hello" };
  const v2 = {
    ...base, version: 2, actor: "RIYA",
    experience: { version: 1, actor: "RIYA", kind: "text", body: "Hello" },
  };
  assert.ok(parseQfjWhatsAppReplyRequest(v1));
  assert.ok(parseQfjWhatsAppReplyRequest(v2));
  for (const field of ["phoneNumberId","providerAccountId","wabaId","accessToken","to"]) {
    assert.equal(parseQfjWhatsAppReplyRequest({ ...v1, [field]: "x" }), null);
    assert.equal(parseQfjWhatsAppReplyRequest({ ...v2, [field]: "x" }), null);
  }
});
await test("Jarvis reply route is signed and feature-gated off by default", () => {
  assert.equal(QFJ_WHATSAPP_REPLY_PATH, "/api/internal/jarvis/whatsapp-reply");
  assert.equal(QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN_V1, "qfj.whatsapp.reply.http.sig.v1");
  assert.equal(QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN, "qfj.whatsapp.reply.http.sig.v2");
  assert.match(replyRoute, /QF_JARVIS_WHATSAPP_ENABLED/);
  assert.match(replyRoute, /policy\.mode !== "active"/);
  assert.match(replyRoute, /verifyQfjSignedRequestSignature/);
  assert.match(replyRoute, /providerAuthority: "quickfurno-core"/);
});

await test("Jarvis callback replay identity is claimed before queueing and finalized after", () => {
  assert.match(callbackReplayMigration, /create table public\.communication_jarvis_callback_receipts/);
  assert.match(callbackReplayMigration, /request_id uuid primary key/);
  assert.match(callbackReplayMigration, /outbox_id uuid references public\.communication_conversation_outbox/);
  assert.doesNotMatch(callbackReplayMigration, /outbox_id uuid not null/);
  assert.match(callbackReplayMigration, /finalized_at timestamptz/);
  assert.match(callbackReplayMigration, /communication_jarvis_callback_receipt_finalize_chk/);
  assert.match(callbackReplayMigration, /alter table public\.communication_jarvis_callback_receipts enable row level security/);
  assert.match(callbackReplayMigration, /revoke all on public\.communication_jarvis_callback_receipts from public,anon,authenticated/);
  assert.match(callbackReplayMigration, /grant select,insert,update on public\.communication_jarvis_callback_receipts to service_role/);
  assert.match(conversationService, /claimJarvisWhatsAppReplyReceipt/);
  assert.match(conversationService, /finalizeJarvisWhatsAppReplyReceipt/);
  assert.match(conversationService, /error\.code !== "23505"/);
  assert.match(conversationService, /prior\.request_digest !== requestDigest/);
  assert.match(conversationService, /prior\.idempotency_key !== input\.idempotencyKey/);
  assert.match(conversationService, /status: "resume"/);
  const claimAt = replyRoute.indexOf("await claimJarvisWhatsAppReplyReceipt");
  const queuedAt = replyRoute.indexOf("await queueJarvisConversationReply");
  const finalizeAt = replyRoute.indexOf("await finalizeJarvisWhatsAppReplyReceipt");
  assert.ok(claimAt >= 0 && queuedAt > claimAt && finalizeAt > queuedAt);
  assert.match(replyRoute, /status: claim\.reason === "replay" \? "replay_rejected" : "request_id_conflict"/);
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
await test("concierge routes exact clients/vendors and explicit prospects deterministically", () => {
  const base = { messageType: "text", contentMinimized: { text: "hello" }, isNewConversation: true };
  const client = resolveWhatsAppConciergeRouting({ ...base, identityConfidence: "exact", principalType: "client" });
  const vendor = resolveWhatsAppConciergeRouting({ ...base, identityConfidence: "exact", principalType: "vendor" });
  const prospect = resolveWhatsAppConciergeRouting({ ...base, identityConfidence: "unknown", principalType: null, contentMinimized: { text: "I want to become a supplier" } });
  assert.equal(client.assignedActor, "RIYA");
  assert.equal(client.subjectType, "client");
  assert.equal(vendor.assignedActor, "ANISHA");
  assert.equal(vendor.subjectType, "vendor");
  assert.equal(prospect.assignedActor, "AAROHI");
  assert.equal(prospect.subjectType, "prospect");
});
await test("unknown greeting receives system-owned Concierge menu without Jarvis turn", () => {
  const routed = resolveWhatsAppConciergeRouting({
    identityConfidence: "unknown", principalType: null, messageType: "text",
    contentMinimized: { text: "Hi" }, isNewConversation: true,
  });
  assert.equal(routed.assignedActor, "SYSTEM");
  assert.equal(routed.jarvisEnabled, false);
  assert.equal(routed.suppressJarvisTurn, true);
  assert.equal(routed.systemExperience?.kind, "menu");
});
await test("unverified existing-vendor request cannot acquire Anisha", () => {
  const routed = resolveWhatsAppConciergeRouting({
    identityConfidence: "unknown", principalType: null, messageType: "button_reply",
    contentMinimized: { replyId: QF_CONCIERGE_ACTIONS.VENDOR }, isNewConversation: true,
  });
  assert.equal(routed.assignedActor, "SYSTEM");
  assert.notEqual(routed.assignedActor, "ANISHA");
  assert.equal(routed.suppressJarvisTurn, true);
});
await test("human request enters takeover and suppresses Jarvis", () => {
  const routed = resolveWhatsAppConciergeRouting({
    identityConfidence: "unknown", principalType: null, messageType: "text",
    contentMinimized: { text: "talk to a person" }, isNewConversation: true,
  });
  assert.equal(routed.assignedActor, "HUMAN");
  assert.equal(routed.humanTakeover, true);
  assert.equal(routed.state, "HUMAN");
  assert.equal(routed.jarvisEnabled, false);
});

await test("premium Concierge renders a bounded Meta list payload", () => {
  const experience = buildQuickFurnoConciergeMenu();
  const payload = buildMetaInteractivePayload("+919999999999", {
    heading: experience.heading,
    body: experience.body,
    actions: experience.actions,
    menuButtonText: "View options",
  }, "wamid.reply");
  assert.equal(payload.type, "interactive");
  assert.equal(payload.context.message_id, "wamid.reply");
  assert.equal(payload.interactive.type, "list");
  assert.equal(payload.interactive.action.sections[0].rows.length, 4);
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
