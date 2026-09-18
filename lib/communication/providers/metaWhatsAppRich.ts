import type {
  WhatsAppContactMessage,
  WhatsAppLocationMessage,
  WhatsAppMediaMessage,
} from "./whatsappProvider";

function toMetaRecipient(e164: string): string {
  return e164.startsWith("+") ? e164.slice(1) : e164;
}

function withContext(
  payload: Record<string, unknown>,
  replyToProviderMessageId?: string | null,
): Record<string, unknown> {
  if (replyToProviderMessageId) payload.context = { message_id: replyToProviderMessageId };
  return payload;
}

export function buildMetaMediaPayload(
  toE164: string,
  message: WhatsAppMediaMessage,
  replyToProviderMessageId?: string | null,
): Record<string, unknown> {
  const media: Record<string, unknown> = { id: message.mediaId.trim() };
  if (message.caption) media.caption = message.caption.trim();
  if (message.filename) media.filename = message.filename.trim();
  return withContext({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toMetaRecipient(toE164),
    type: message.kind,
    [message.kind]: media,
  }, replyToProviderMessageId);
}

export function buildMetaLocationPayload(
  toE164: string,
  message: WhatsAppLocationMessage,
  replyToProviderMessageId?: string | null,
): Record<string, unknown> {
  return withContext({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toMetaRecipient(toE164),
    type: "location",
    location: {
      latitude: message.latitude,
      longitude: message.longitude,
      ...(message.name ? { name: message.name.trim() } : {}),
      ...(message.address ? { address: message.address.trim() } : {}),
    },
  }, replyToProviderMessageId);
}

export function buildMetaContactPayload(
  toE164: string,
  message: WhatsAppContactMessage,
  replyToProviderMessageId?: string | null,
): Record<string, unknown> {
  return withContext({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toMetaRecipient(toE164),
    type: "contacts",
    contacts: [{
      name: {
        formatted_name: message.formattedName.trim(),
        ...(message.firstName ? { first_name: message.firstName.trim() } : {}),
        ...(message.lastName ? { last_name: message.lastName.trim() } : {}),
      },
      phones: message.phones.map((entry) => ({
        phone: entry.phone,
        ...(entry.type ? { type: entry.type } : {}),
      })),
    }],
  }, replyToProviderMessageId);
}

export function buildMetaReadReceiptPayload(
  providerMessageId: string,
  typing: boolean,
): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    status: "read",
    message_id: providerMessageId.trim(),
    ...(typing ? { typing_indicator: { type: "text" } } : {}),
  };
}
