import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  deriveJarvisNormalizedText,
  normalizeMetaInboundWebhook,
} from "../../../lib/communication/providers/metaWhatsAppInbound.ts";
import { buildMetaInteractivePayload } from "../../../lib/communication/providers/metaWhatsAppInteractive.ts";
import {
  buildMetaContactPayload,
  buildMetaLocationPayload,
  buildMetaMediaPayload,
  buildMetaReadReceiptPayload,
} from "../../../lib/communication/providers/metaWhatsAppRich.ts";
import { resolveWhatsAppConciergeRouting } from "../../../lib/communication/whatsAppConciergeRouting.ts";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS", name);
  } catch (error) {
    failed += 1;
    console.error("FAIL", name, error instanceof Error ? error.message : String(error));
  }
}

function payloadFor(message) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "waba-1",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: "123456" },
          messages: [{
            from: "919999999999",
            id: "wamid.essential-1",
            timestamp: "1789756800",
            ...message,
          }],
        },
      }],
    }],
  };
}

await test("text, button and list replies remain first-class", () => {
  const text = normalizeMetaInboundWebhook(payloadFor({ type: "text", text: { body: "Hello" } }))[0];
  assert.equal(text.ok, true);
  assert.equal(text.message.messageType, "text");
  assert.equal(text.message.contentMinimized.text, "Hello");

  const button = normalizeMetaInboundWebhook(payloadFor({
    type: "interactive",
    interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes" } },
  }))[0];
  assert.equal(button.ok, true);
  assert.equal(button.message.messageType, "button_reply");
  assert.equal(button.message.contentMinimized.replyId, "yes");

  const list = normalizeMetaInboundWebhook(payloadFor({
    type: "interactive",
    interactive: { type: "list_reply", list_reply: { id: "row-1", title: "Option", description: "Detail" } },
  }))[0];
  assert.equal(list.ok, true);
  assert.equal(list.message.messageType, "list_reply");
  assert.equal(list.message.contentMinimized.replyId, "row-1");
});

await test("all essential inbound media types are normalized without raw URLs", () => {
  for (const [type, body] of [
    ["image", { id: "m-image", mime_type: "image/jpeg", caption: "Need this style" }],
    ["document", { id: "m-doc", mime_type: "application/pdf", filename: "brief.pdf", caption: "Project brief" }],
    ["audio", { id: "m-audio", mime_type: "audio/ogg" }],
    ["video", { id: "m-video", mime_type: "video/mp4", caption: "Reference" }],
    ["sticker", { id: "m-sticker", mime_type: "image/webp", animated: true }],
  ]) {
    const result = normalizeMetaInboundWebhook(payloadFor({ type, [type]: body }))[0];
    assert.equal(result.ok, true);
    assert.equal(result.message.messageType, type);
    assert.equal(result.message.contentMinimized.mediaId, body.id);
    assert.equal("url" in result.message.contentMinimized, false);
    assert.equal("link" in result.message.contentMinimized, false);
  }
});

await test("location and contacts are accepted but precise personal data stays minimized", () => {
  const location = normalizeMetaInboundWebhook(payloadFor({
    type: "location",
    location: { latitude: 18.5204, longitude: 73.8567, name: "Private place", address: "Exact address" },
  }))[0];
  assert.equal(location.ok, true);
  assert.deepEqual(location.message.contentMinimized, { received: true });

  const contacts = normalizeMetaInboundWebhook(payloadFor({
    type: "contacts",
    contacts: [{ name: { formatted_name: "Private Person" }, phones: [{ phone: "+919999999999" }] }],
  }))[0];
  assert.equal(contacts.ok, true);
  assert.equal(contacts.message.messageType, "contact");
  assert.deepEqual(contacts.message.contentMinimized, { received: true, count: 1 });
});

await test("orders, reactions and system events are explicitly classified", () => {
  const order = normalizeMetaInboundWebhook(payloadFor({
    type: "order",
    order: { catalog_id: "catalog-1", product_items: [{ product_retailer_id: "sku-1" }, { product_retailer_id: "sku-2" }] },
  }))[0];
  assert.equal(order.ok, true);
  assert.equal(order.message.messageType, "order");
  assert.equal(order.message.contentMinimized.itemCount, 2);

  const reaction = normalizeMetaInboundWebhook(payloadFor({
    type: "reaction", reaction: { emoji: "👍", message_id: "wamid.previous" },
  }))[0];
  assert.equal(reaction.ok, true);
  assert.equal(reaction.message.messageType, "reaction");

  const system = normalizeMetaInboundWebhook(payloadFor({
    type: "system", system: { type: "user_changed_number", body: "must-not-persist" },
  }))[0];
  assert.equal(system.ok, true);
  assert.equal(system.message.messageType, "system");
  assert.equal("body" in system.message.contentMinimized, false);
});

await test("thread reply and click-to-whatsapp referral context are bounded and minimized", () => {
  const result = normalizeMetaInboundWebhook(payloadFor({
    type: "text",
    text: { body: "Interested" },
    context: { message_id: "wamid.parent", forwarded: true, frequently_forwarded: true },
    referral: {
      source_type: "ad",
      source_id: "ad-123",
      source_url: "https://secret.example/path",
      headline: "Do not persist",
      body: "Do not persist",
    },
  }))[0];
  assert.equal(result.ok, true);
  assert.equal(result.message.contentMinimized.replyToProviderMessageId, "wamid.parent");
  assert.equal(result.message.contentMinimized.forwarded, true);
  assert.equal(result.message.contentMinimized.frequentlyForwarded, true);
  assert.equal(result.message.contentMinimized.referralPresent, true);
  assert.equal(result.message.contentMinimized.referralSourceType, "ad");
  assert.equal(result.message.contentMinimized.referralSourceId, "ad-123");
  assert.equal("source_url" in result.message.contentMinimized, false);
  assert.equal("headline" in result.message.contentMinimized, false);
});

await test("Jarvis text derivation never claims unseen attachment content", () => {
  assert.equal(deriveJarvisNormalizedText("text", { text: "hello" }), "hello");
  assert.equal(deriveJarvisNormalizedText("button_reply", { title: "Continue" }), "Continue");
  const image = deriveJarvisNormalizedText("image", { caption: "Need something like this" });
  assert.match(image, /content not inspected/);
  assert.match(image, /Need something like this/);
  assert.equal(deriveJarvisNormalizedText("image", { mediaId: "m1" }), null);
  assert.equal(deriveJarvisNormalizedText("audio", { mediaId: "m2" }), null);
});

await test("reply buttons and lists render through Meta interactive payloads", () => {
  const buttons = buildMetaInteractivePayload("+919999999999", {
    body: "Choose",
    actions: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
  });
  assert.equal(buttons.type, "interactive");
  assert.equal(buttons.interactive.type, "button");

  const list = buildMetaInteractivePayload("+919999999999", {
    body: "Choose",
    actions: Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, title: `A${i}` })),
  });
  assert.equal(list.interactive.type, "list");
});

await test("rich outbound payloads use provider media ids, structured location and contacts", () => {
  const media = buildMetaMediaPayload("+919999999999", {
    kind: "image", mediaId: "media-123", caption: "Reference",
  }, "wamid.parent");
  assert.equal(media.type, "image");
  assert.equal(media.image.id, "media-123");
  assert.equal("link" in media.image, false);
  assert.equal(media.context.message_id, "wamid.parent");

  const location = buildMetaLocationPayload("+919999999999", {
    latitude: 18.5204, longitude: 73.8567, name: "QuickFurno",
  });
  assert.equal(location.type, "location");
  assert.equal(location.location.latitude, 18.5204);

  const contact = buildMetaContactPayload("+919999999999", {
    formattedName: "QuickFurno Support",
    phones: [{ phone: "+919999999998", type: "WORK" }],
  });
  assert.equal(contact.type, "contacts");
  assert.equal(contact.contacts[0].phones[0].type, "WORK");
});

await test("read receipt and typing indicator payloads match the Cloud API control shape", () => {
  const read = buildMetaReadReceiptPayload("wamid.inbound", false);
  assert.deepEqual(read, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: "wamid.inbound",
  });
  const typing = buildMetaReadReceiptPayload("wamid.inbound", true);
  assert.equal(typing.status, "read");
  assert.equal(typing.typing_indicator.type, "text");
});

await test("non-text routing never creates a blank AI turn", () => {
  const clientAudio = resolveWhatsAppConciergeRouting({
    identityConfidence: "exact",
    principalType: "client",
    messageType: "audio",
    contentMinimized: { mediaId: "m1" },
  });
  assert.equal(clientAudio.assignedActor, "RIYA");
  assert.equal(clientAudio.suppressJarvisTurn, true);
  assert.equal(clientAudio.systemExperience?.kind, "confirmation");

  const clientImageCaption = resolveWhatsAppConciergeRouting({
    identityConfidence: "exact",
    principalType: "client",
    messageType: "image",
    contentMinimized: { mediaId: "m1", caption: "Need this style" },
  });
  assert.equal(clientImageCaption.assignedActor, "RIYA");
  assert.equal(clientImageCaption.suppressJarvisTurn, false);

  const reaction = resolveWhatsAppConciergeRouting({
    identityConfidence: "exact",
    principalType: "vendor",
    messageType: "reaction",
    contentMinimized: { emoji: "👍" },
  });
  assert.equal(reaction.assignedActor, "ANISHA");
  assert.equal(reaction.suppressJarvisTurn, true);
  assert.equal(reaction.systemExperience, undefined);

  const unknownLocation = resolveWhatsAppConciergeRouting({
    identityConfidence: "unknown",
    principalType: null,
    messageType: "location",
    contentMinimized: { received: true },
  });
  assert.equal(unknownLocation.assignedActor, "SYSTEM");
  assert.equal(unknownLocation.suppressJarvisTurn, true);
  assert.ok(unknownLocation.systemExperience);
});

await test("production adapter exposes presence and rich capabilities while forbidding arbitrary media links", () => {
  const provider = read("lib/communication/providers/metaCloudWhatsAppProvider.ts");
  const rich = read("lib/communication/providers/metaWhatsAppRich.ts");
  const gateway = read("services/jarvisWhatsAppGatewayService.ts");
  const conversational = read("services/conversationalWhatsAppService.ts");

  for (const method of [
    "sendMediaMessage", "sendLocationMessage", "sendContactMessage",
    "markInboundRead", "markInboundReadWithTyping",
  ]) assert.match(provider, new RegExp(`async ${method}\\(`));

  assert.doesNotMatch(rich, /\blink\s*:/);
  assert.match(gateway, /signalConversationalWhatsAppPresence/);
  assert.match(conversational, /evaluateMetaOutboundGateForMessage/);
  assert.match(conversational, /source === "SYSTEM"/);
});

console.log(`SUMMARY assertions=${passed + failed} passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
