// ============================================================================
// QuickFurno — lib/communication/providers/metaWhatsAppInbound.ts  (Phase 5F-D1-A)
//
// PURE Meta WhatsApp Cloud INBOUND-message normalization: an already-VERIFIED,
// already-PARSED webhook payload → a provider-neutral, MINIMIZED normalized inbound
// message array. Foundation only — nothing calls this from the live webhook yet.
//
// PURITY CONTRACT (proven by the D1-A harness)
//   No signature verification (the caller already verified), no env, no database, no
//   network, no logging, no clock source (`Date.now`/timers), no randomness, no consent
//   mutation, no send, and no event emission. It reuses the ONE canonical phone helper
//   (`phone.ts`); it never re-implements normalization or hashing.
//
// SECRECY / MINIMIZATION
//   The raw provider payload is NEVER returned. No access token, app secret, signature,
//   authorization header, credentialled URL, contacts/profile object, or unrelated
//   provider metadata is exposed. The plaintext sender phone exists in the result ONLY
//   as a sibling `senderPhoneE164` field, explicitly marked REQUEST-MEMORY-ONLY for the
//   D1-B identity lookup — it is never part of the persistable `message` object, and must
//   never be logged or written to an inbound row.
//
// IDENTITY OF A MESSAGE
//   The provider's own message id (`wamid`) is REQUIRED. It is never fabricated and never
//   derived from phone + text + timestamp. A message lacking a usable id, or a sender that
//   cannot be canonicalized, is returned as a structured, safe REJECTION — never persisted.
// ============================================================================

import {
  hashPhoneE164,
  maskPhoneE164,
  normalizePhoneE164,
} from "../phone";

export const META_WHATSAPP_INBOUND_PROVIDER = "meta_whatsapp_cloud" as const;

/** The provider-neutral inbound message-type subset supported in Phase 5F-D1. */
export const InboundMessageType = {
  TEXT: "text",
  BUTTON_REPLY: "button_reply",
  LIST_REPLY: "list_reply",
  IMAGE: "image",
  DOCUMENT: "document",
  AUDIO: "audio",
  VIDEO: "video",
  LOCATION: "location",
  CONTACT: "contact",
  REACTION: "reaction",
  UNSUPPORTED: "unsupported",
} as const;
export type InboundMessageTypeValue = (typeof InboundMessageType)[keyof typeof InboundMessageType];

/** A message that cannot be safely persisted is rejected with one of these reasons. */
export const InboundNormalizationRejectReason = {
  /** No usable provider message id. Never fabricated. */
  MISSING_MESSAGE_ID: "MISSING_MESSAGE_ID",
  /** The sender identity could not be canonicalized. Never persisted, never logged. */
  SENDER_NOT_NORMALIZABLE: "SENDER_NOT_NORMALIZABLE",
} as const;
export type InboundNormalizationRejectReasonValue =
  (typeof InboundNormalizationRejectReason)[keyof typeof InboundNormalizationRejectReason];

/** Safe, non-sender provider context for future correlation. */
export interface InboundProviderContext {
  /** The BUSINESS's own WhatsApp phone-number id (never the sender). */
  readonly phoneNumberId: string | null;
}

/**
 * A normalized inbound message. This object is PERSISTABLE: it contains NO plaintext
 * sender phone (only `senderHash`/`senderMasked`) and NO raw provider payload.
 */
export interface NormalizedInboundMessage {
  readonly provider: typeof META_WHATSAPP_INBOUND_PROVIDER;
  readonly providerMessageId: string;
  readonly senderHash: string;
  readonly senderMasked: string;
  readonly messageType: InboundMessageTypeValue;
  readonly contentMinimized: Record<string, unknown>;
  readonly providerOccurredAt: string | null;
  readonly providerContext: InboundProviderContext;
}

export type NormalizedInboundResult =
  | {
      readonly ok: true;
      readonly message: NormalizedInboundMessage;
      /**
       * REQUEST-MEMORY ONLY. The canonical sender E.164, provided solely for the D1-B
       * identity lookup. It is a SIBLING of `message` (never inside it) and must NEVER
       * be logged or written to an inbound row.
       */
      readonly senderPhoneE164: string;
    }
  | {
      readonly ok: false;
      readonly reason: InboundNormalizationRejectReasonValue;
      /** Present only when a usable id exists (i.e. not for MISSING_MESSAGE_ID). */
      readonly providerMessageId: string | null;
    };

// ----------------------------------------------------------------------------
// Small pure readers (never throw; never log)
// ----------------------------------------------------------------------------
function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (typeof v === "string" && v.trim() !== "") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
/** An allowlisted, identifier-shaped provider type string, or null. */
function safeProviderType(value: unknown): string | null {
  return typeof value === "string" && /^[a-z_]{1,32}$/.test(value) ? value : null;
}
/** Convert a Meta unix-seconds timestamp (provided, not the clock) to ISO, or null. */
function providerTimestampToIso(value: unknown): string | null {
  const raw = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const iso = new Date(raw * 1000);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

// ----------------------------------------------------------------------------
// Content minimization — per type, MINIMAL and PII-conservative
// ----------------------------------------------------------------------------
function minimizeMedia(media: Record<string, unknown> | null, extra: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!media) return out;
  const mediaId = readString(media, "id");
  if (mediaId) out.mediaId = mediaId; // operational reference to fetch later — not a URL, not a token
  const mimeType = readString(media, "mime_type");
  if (mimeType) out.mimeType = mimeType;
  for (const field of extra) {
    const v = readString(media, field);
    if (v) out[field] = v;
  }
  return out;
}

/**
 * Map a raw Meta message object to (messageType, contentMinimized). Never returns the raw
 * payload, a URL, a token, a full contact card, or precise location coordinates.
 */
function classifyAndMinimize(m: Record<string, unknown>): { type: InboundMessageTypeValue; content: Record<string, unknown> } {
  const type = readString(m, "type");

  if (type === "text") {
    const body = readString(asObject(m.text) ?? {}, "body");
    return { type: InboundMessageType.TEXT, content: body ? { text: body } : {} };
  }

  if (type === "interactive") {
    const interactive = asObject(m.interactive);
    const iType = interactive ? readString(interactive, "type") : null;
    if (interactive && iType === "button_reply") {
      const br = asObject(interactive.button_reply) ?? {};
      const content: Record<string, unknown> = {};
      const id = readString(br, "id");
      const title = readString(br, "title");
      if (id) content.replyId = id;
      if (title) content.title = title;
      return { type: InboundMessageType.BUTTON_REPLY, content };
    }
    if (interactive && iType === "list_reply") {
      const lr = asObject(interactive.list_reply) ?? {};
      const content: Record<string, unknown> = {};
      const id = readString(lr, "id");
      const title = readString(lr, "title");
      const description = readString(lr, "description");
      if (id) content.replyId = id;
      if (title) content.title = title;
      if (description) content.description = description;
      return { type: InboundMessageType.LIST_REPLY, content };
    }
    return { type: InboundMessageType.UNSUPPORTED, content: { providerType: "interactive" } };
  }

  // Legacy template quick-reply button → provider-neutral button_reply.
  if (type === "button") {
    const b = asObject(m.button) ?? {};
    const content: Record<string, unknown> = {};
    const payload = readString(b, "payload");
    const text = readString(b, "text");
    if (payload) content.replyId = payload;
    if (text) content.title = text;
    return { type: InboundMessageType.BUTTON_REPLY, content };
  }

  if (type === "image") return { type: InboundMessageType.IMAGE, content: minimizeMedia(asObject(m.image), ["caption"]) };
  if (type === "document") return { type: InboundMessageType.DOCUMENT, content: minimizeMedia(asObject(m.document), ["filename", "caption"]) };
  if (type === "audio") return { type: InboundMessageType.AUDIO, content: minimizeMedia(asObject(m.audio), []) };
  if (type === "video") return { type: InboundMessageType.VIDEO, content: minimizeMedia(asObject(m.video), ["caption"]) };

  // CONSERVATIVE: sensitive personal data is NOT persisted merely because Meta supplies it.
  // A location's precise coordinates and a contact card's names/numbers are dropped in D1-A;
  // only a presence marker (and a contact count) survives.
  if (type === "location") return { type: InboundMessageType.LOCATION, content: { received: true } };
  if (type === "contacts") {
    const count = Array.isArray(m.contacts) ? m.contacts.length : 0;
    return { type: InboundMessageType.CONTACT, content: { received: true, count } };
  }

  if (type === "reaction") {
    const r = asObject(m.reaction) ?? {};
    const content: Record<string, unknown> = {};
    const emoji = readString(r, "emoji");
    const target = readString(r, "message_id");
    if (emoji) content.emoji = emoji;
    if (target) content.targetMessageId = target;
    return { type: InboundMessageType.REACTION, content };
  }

  // Anything else (sticker, order, system, unknown, …) is safely classified as unsupported,
  // carrying only an allowlisted identifier-shaped provider type — never arbitrary content.
  const safeType = safeProviderType(type);
  return { type: InboundMessageType.UNSUPPORTED, content: safeType ? { providerType: safeType } : {} };
}

// ----------------------------------------------------------------------------
// The normalizer
// ----------------------------------------------------------------------------
function forEachInboundMessage(
  payload: Record<string, unknown>,
  fn: (message: Record<string, unknown>, value: Record<string, unknown>) => void
): void {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray((entry as { changes?: unknown })?.changes) ? (entry as { changes: unknown[] }).changes : [];
    for (const change of changes) {
      const c = asObject(change);
      if (!c || c.field !== "messages") continue;
      const value = asObject(c.value);
      if (!value || !Array.isArray(value.messages)) continue;
      for (const raw of value.messages) {
        const m = asObject(raw);
        if (m) fn(m, value);
      }
    }
  }
}

/**
 * Normalize an already-verified, already-parsed Meta webhook payload into a provider-neutral
 * inbound message array. Supports MULTIPLE inbound messages in one webhook; each is normalized
 * INDEPENDENTLY and never influences another's identity. Delivery-status, template-status and
 * account-status payloads carry no `messages[]` and therefore yield an empty array — they are
 * owned by their existing paths, never treated as inbound user messages.
 */
export function normalizeMetaInboundWebhook(payload: unknown): NormalizedInboundResult[] {
  const p = asObject(payload);
  if (!p || p.object !== "whatsapp_business_account") return [];

  const results: NormalizedInboundResult[] = [];
  forEachInboundMessage(p, (m, value) => {
    // 1) A usable provider message id is REQUIRED. Never fabricated.
    const providerMessageId = readString(m, "id");
    if (!providerMessageId) {
      results.push({ ok: false, reason: InboundNormalizationRejectReason.MISSING_MESSAGE_ID, providerMessageId: null });
      return;
    }

    // 2) The sender must canonicalize through the ONE canonical helper. A WhatsApp `from` is a
    // wa_id (digits, no '+'); prefix '+' then normalize. A malformed sender fails SAFELY and its
    // plaintext value is never surfaced.
    const from = readString(m, "from");
    const normalized = from ? normalizePhoneE164(`+${from}`) : { ok: false as const };
    if (!normalized.ok) {
      results.push({ ok: false, reason: InboundNormalizationRejectReason.SENDER_NOT_NORMALIZABLE, providerMessageId });
      return;
    }
    const senderPhoneE164 = normalized.e164;

    // 3) Minimize the content and derive the safe, non-sender provider context.
    const { type, content } = classifyAndMinimize(m);
    const metadata = asObject(value.metadata);

    results.push({
      ok: true,
      senderPhoneE164, // REQUEST-MEMORY ONLY sibling — never inside `message`, never logged/persisted
      message: {
        provider: META_WHATSAPP_INBOUND_PROVIDER,
        providerMessageId,
        senderHash: hashPhoneE164(senderPhoneE164),
        senderMasked: maskPhoneE164(senderPhoneE164),
        messageType: type,
        contentMinimized: content,
        providerOccurredAt: providerTimestampToIso(m.timestamp),
        providerContext: { phoneNumberId: metadata ? readString(metadata, "phone_number_id") : null },
      },
    });
  });
  return results;
}
