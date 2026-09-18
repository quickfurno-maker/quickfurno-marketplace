import type { WhatsAppInteractiveMessage } from "./whatsappProvider";

function toMetaRecipient(e164: string): string {
  return e164.startsWith("+") ? e164.slice(1) : e164;
}

export function buildMetaInteractivePayload(
  toE164: string,
  message: WhatsAppInteractiveMessage,
  replyToProviderMessageId?: string | null,
): Record<string, unknown> {
  const actions = [...message.actions];
  const interactive: Record<string, unknown> = {
    type: actions.length <= 3 ? "button" : "list",
    body: { text: message.body.trim() },
  };
  if (message.heading) interactive.header = { type: "text", text: message.heading.trim() };
  if (actions.length <= 3) {
    interactive.action = {
      buttons: actions.map((action) => ({
        type: "reply",
        reply: { id: action.id, title: action.title },
      })),
    };
  } else {    interactive.action = {
      button: (message.menuButtonText ?? "View options").trim(),
      sections: [{
        title: "QuickFurno",
        rows: actions.map((action) => ({
          id: action.id,
          title: action.title,
          ...(action.description ? { description: action.description } : {}),
        })),
      }],
    };
  }
  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toMetaRecipient(toE164),
    type: "interactive",
    interactive,
  };
  if (replyToProviderMessageId) payload.context = { message_id: replyToProviderMessageId };
  return payload;
}