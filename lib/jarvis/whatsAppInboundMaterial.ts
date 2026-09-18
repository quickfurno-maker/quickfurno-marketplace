import { deriveJarvisNormalizedText } from "../communication/providers/metaWhatsAppInbound";

export const QF_WHATSAPP_INBOUND_MATERIAL_VERSION = 1 as const;

export type QfWhatsAppInboundMessageType =
  | "text" | "button_reply" | "list_reply"
  | "image" | "document" | "audio" | "video" | "sticker"
  | "location" | "contact" | "reaction" | "order" | "system" | "unsupported";

export interface QfWhatsAppInboundMaterialV1 {
  readonly version: 1;
  readonly messageType: QfWhatsAppInboundMessageType;
  readonly normalizedText?: string;
  readonly attachment?: {
    readonly kind: "image" | "document" | "audio" | "video" | "sticker";
    readonly mediaId: string;
    readonly mimeType?: string;
    readonly caption?: string;
    readonly filename?: string;
  };
  readonly selection?: {
    readonly id?: string;
    readonly title?: string;
    readonly description?: string;
  };
  readonly replyContext?: { readonly providerMessageId: string };
  readonly referral?: { readonly sourceType?: string; readonly sourceId?: string };
  readonly reaction?: { readonly emoji?: string; readonly targetProviderMessageId?: string };
  readonly order?: { readonly itemCount: number; readonly catalogId?: string };
  readonly forwarded?: boolean;
  readonly frequentlyForwarded?: boolean;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return v ? v.slice(0, max) : undefined;
}

function messageType(value: unknown): QfWhatsAppInboundMessageType {
  const allowed: readonly string[] = [
    "text","button_reply","list_reply","image","document","audio","video","sticker",
    "location","contact","reaction","order","system","unsupported",
  ];
  return typeof value === "string" && allowed.includes(value)
    ? value as QfWhatsAppInboundMessageType
    : "unsupported";
}

export function deriveQfWhatsAppInboundMaterial(input: {
  readonly messageType: unknown;
  readonly contentMinimized: Record<string, unknown> | null | undefined;
}): QfWhatsAppInboundMaterialV1 {
  const type = messageType(input.messageType);
  const c = input.contentMinimized && typeof input.contentMinimized === "object" && !Array.isArray(input.contentMinimized)
    ? input.contentMinimized
    : {};
  const normalizedText = deriveJarvisNormalizedText(type, c) ?? undefined;

  const mediaId = text(c.mediaId, 256);
  const mimeType = text(c.mimeType, 128);
  const caption = text(c.caption, 1024);
  const filename = text(c.filename, 240);
  const attachment = ["image","document","audio","video","sticker"].includes(type) && mediaId
    ? Object.freeze({
        kind: type as NonNullable<QfWhatsAppInboundMaterialV1["attachment"]>["kind"],
        mediaId,
        ...(mimeType ? { mimeType } : {}),
        ...(caption ? { caption } : {}),
        ...(filename ? { filename } : {}),
      })
    : undefined;

  const id = text(c.replyId, 200);
  const title = text(c.title, 240);
  const description = text(c.description, 240);
  const selection = (type === "button_reply" || type === "list_reply") && (id || title || description)
    ? Object.freeze({
        ...(id ? { id } : {}),
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
      })
    : undefined;

  const replyTo = text(c.replyToProviderMessageId, 512);
  const replyContext = replyTo ? Object.freeze({ providerMessageId: replyTo }) : undefined;

  const referral = c.referralPresent === true
    ? Object.freeze({
        ...(text(c.referralSourceType, 40) ? { sourceType: text(c.referralSourceType, 40) } : {}),
        ...(text(c.referralSourceId, 128) ? { sourceId: text(c.referralSourceId, 128) } : {}),
      })
    : undefined;

  const reaction = type === "reaction"
    ? Object.freeze({
        ...(text(c.emoji, 32) ? { emoji: text(c.emoji, 32) } : {}),
        ...(text(c.targetMessageId, 512) ? { targetProviderMessageId: text(c.targetMessageId, 512) } : {}),
      })
    : undefined;

  let order: QfWhatsAppInboundMaterialV1["order"];
  if (type === "order") {
    const itemCount = typeof c.itemCount === "number" && Number.isFinite(c.itemCount)
      ? Math.max(0, Math.min(100, Math.trunc(c.itemCount)))
      : 0;
    const catalogId = text(c.catalogId, 128);
    order = Object.freeze({ itemCount, ...(catalogId ? { catalogId } : {}) });
  }

  return Object.freeze({
    version: 1,
    messageType: type,
    ...(normalizedText ? { normalizedText } : {}),
    ...(attachment ? { attachment } : {}),
    ...(selection ? { selection } : {}),
    ...(replyContext ? { replyContext } : {}),
    ...(referral && Object.keys(referral).length ? { referral } : {}),
    ...(reaction && Object.keys(reaction).length ? { reaction } : {}),
    ...(order ? { order } : {}),
    ...(c.forwarded === true ? { forwarded: true } : {}),
    ...(c.frequentlyForwarded === true ? { frequentlyForwarded: true } : {}),
  });
}
