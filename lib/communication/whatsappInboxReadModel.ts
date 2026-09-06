// ============================================================================
// QuickFurno — lib/communication/whatsappInboxReadModel.ts   (PURE)
//
// QF-MVP-82A — the decision half of the unified WhatsApp inbox.
//
// THE INBOX IS A DERIVED READ MODEL, NOT A NEW AUTHORITY.
//   Inbound truth stays in `communication_inbound_messages`. Outbound truth
//   stays in `communication_messages`, with its delivery lifecycle. Nothing here
//   moves a row between them, rewrites one as the other, or introduces a third
//   canonical conversation table. This file only decides how those two existing
//   authorities are GROUPED, ORDERED and DISPLAYED.
//
// GROUPING IS BY DURABLE HASH, NEVER BY GUESSWORK.
//   Conversations are keyed on the canonical contact hash the platform already
//   stores — `communication_messages.destination_hash` outbound and
//   `communication_inbound_messages.sender_hash` inbound — partitioned by the
//   owning provider account. Time proximity, masked-number similarity and name
//   similarity are NOT identity and are never used to group.
//
// THE HASH NEVER LEAVES THE SERVER.
//   The browser receives only an opaque, deterministic conversation id derived
//   from (namespace, contact hash). That id is a stable handle, not a capability:
//   access is controlled by the Superadmin session, never by id secrecy.
//
// EXACT PRINCIPALS ENRICH; THEY DO NOT GROUP.
//   An unknown or ambiguous contact still forms a conversation. Where a single
//   exact principal is proved it becomes the participant; where two conflicting
//   exact principals appear on one hash, this model reports an identity conflict
//   rather than picking one.
//
// PURE, AND CLIENT-SAFE. No database, no client, no network, no fetch, no send,
// no I/O — and deliberately NO Node builtin, because the browser components
// import these vocabularies and presentation rules directly. Deriving the
// conversation key needs a hash, so it lives in the server-only sibling
// whatsappInboxConversationKey.ts: the browser never computes a key, it only
// ever receives one.
// ============================================================================

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

export const InboxDirection = Object.freeze({ INBOUND: "inbound", OUTBOUND: "outbound" } as const);
export type InboxDirectionValue = (typeof InboxDirection)[keyof typeof InboxDirection];

/** How a bubble should be drawn. Never raw provider vocabulary. */
export const InboxDisplayKind = Object.freeze({
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
  TEMPLATE: "template",
  AUTHENTICATION: "authentication",
} as const);
export type InboxDisplayKindValue = (typeof InboxDisplayKind)[keyof typeof InboxDisplayKind];

/** Delivery presentation. A restatement of the canonical lifecycle, never a second machine. */
export const InboxDeliveryTone = Object.freeze({
  PENDING: "pending",
  ACCEPTED: "accepted",
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  FAILED: "failed",
  RETRY_PENDING: "retry_pending",
  CANCELLED: "cancelled",
  UNKNOWN: "unknown",
} as const);
export type InboxDeliveryToneValue = (typeof InboxDeliveryTone)[keyof typeof InboxDeliveryTone];

export const InboxParticipantKind = Object.freeze({
  CLIENT: "client",
  VENDOR: "vendor",
  ADMIN: "admin",
  UNKNOWN: "unknown",
  CONFLICT: "conflict",
} as const);
export type InboxParticipantKindValue = (typeof InboxParticipantKind)[keyof typeof InboxParticipantKind];

/** Bounds. A bubble is readable, not a document; a preview is one line. */
export const INBOX_MAX_BUBBLE_TEXT = 2000;
export const INBOX_MAX_PREVIEW_TEXT = 140;

// ---------------------------------------------------------------------------
// Delivery lifecycle -> presentation
// ---------------------------------------------------------------------------

/**
 * The ONLY mapping from the canonical outbound lifecycle to a tick. `delivered`
 * is never shown as `read`: they are different facts and the operator uses the
 * difference.
 */
export function inboxDeliveryTone(status: string | null | undefined): InboxDeliveryToneValue {
  switch (status) {
    case "queued":
    case "dispatching":
      return InboxDeliveryTone.PENDING;
    case "accepted":
      return InboxDeliveryTone.ACCEPTED;
    case "sent":
      return InboxDeliveryTone.SENT;
    case "delivered":
      return InboxDeliveryTone.DELIVERED;
    case "read":
      return InboxDeliveryTone.READ;
    case "failed":
    case "dead_letter":
      return InboxDeliveryTone.FAILED;
    case "retry_scheduled":
      return InboxDeliveryTone.RETRY_PENDING;
    case "cancelled":
      return InboxDeliveryTone.CANCELLED;
    default:
      return InboxDeliveryTone.UNKNOWN;
  }
}

/** Operator-facing label for a tone. Closed set; never a raw status string. */
export function inboxDeliveryLabel(tone: InboxDeliveryToneValue): string {
  switch (tone) {
    case InboxDeliveryTone.PENDING: return "Pending";
    case InboxDeliveryTone.ACCEPTED: return "Accepted";
    case InboxDeliveryTone.SENT: return "Sent";
    case InboxDeliveryTone.DELIVERED: return "Delivered";
    case InboxDeliveryTone.READ: return "Read";
    case InboxDeliveryTone.FAILED: return "Failed";
    case InboxDeliveryTone.RETRY_PENDING: return "Retry pending";
    case InboxDeliveryTone.CANCELLED: return "Cancelled";
    default: return "Unknown";
  }
}

// ---------------------------------------------------------------------------
// Safe text
// ---------------------------------------------------------------------------

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const readText = (o: Record<string, unknown>, key: string): string | null => {
  const v = o[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
};

/**
 * Bounds a string for display. It does NOT escape or strip: the value is handed
 * to React as a text child, which escapes it, and stripping would quietly alter
 * a real customer message. Control characters are removed because they can
 * corrupt a terminal or a log line, never to sanitize markup.
 */
export function boundInboxText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (cleaned.trim() === "") return null;
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}

/** One-line preview: no newlines, hard length bound. */
export function boundInboxPreview(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const single = value.replace(/\s+/g, " ").trim();
  return boundInboxText(single, INBOX_MAX_PREVIEW_TEXT);
}

// ---------------------------------------------------------------------------
// Inbound presentation
// ---------------------------------------------------------------------------

export interface InboxPresentation {
  readonly displayKind: InboxDisplayKindValue;
  /** The primary bubble line. Never raw JSON, never a payload. */
  readonly displayText: string | null;
  /** A secondary line (caption, filename, description). */
  readonly secondaryText: string | null;
}

/**
 * Renders the MINIMIZED inbound content. It reads only the keys D1-A actually
 * persists and invents nothing: a location has no coordinates here because none
 * were ever stored, and a contact card has no names or numbers for the same
 * reason. No media is fetched; a media message is a labelled placeholder plus
 * whatever safe caption or filename the minimizer kept.
 */
export function presentInboundMessage(input: {
  readonly messageType: string | null | undefined;
  readonly contentMinimized: unknown;
}): InboxPresentation {
  const c = asRecord(input?.contentMinimized);
  const K = InboxDisplayKind;
  const text = (k: string) => boundInboxText(readText(c, k), INBOX_MAX_BUBBLE_TEXT);

  switch (input?.messageType) {
    case "text":
      return { displayKind: K.TEXT, displayText: text("text"), secondaryText: null };
    case "button_reply":
      return { displayKind: K.BUTTON_REPLY, displayText: text("title") ?? "Button reply", secondaryText: null };
    case "list_reply":
      return { displayKind: K.LIST_REPLY, displayText: text("title") ?? "List reply", secondaryText: text("description") };
    case "image":
      return { displayKind: K.IMAGE, displayText: "Image received", secondaryText: text("caption") };
    case "document":
      return { displayKind: K.DOCUMENT, displayText: "Document received", secondaryText: text("filename") ?? text("caption") };
    case "audio":
      return { displayKind: K.AUDIO, displayText: "Audio received", secondaryText: null };
    case "video":
      return { displayKind: K.VIDEO, displayText: "Video received", secondaryText: text("caption") };
    case "location":
      // D1-A stores a presence marker only. There is nothing to place on a map.
      return { displayKind: K.LOCATION, displayText: "Location received", secondaryText: null };
    case "contact": {
      const count = typeof c.count === "number" && Number.isFinite(c.count) && c.count > 0 ? c.count : null;
      return {
        displayKind: K.CONTACT,
        displayText: "Contact received",
        secondaryText: count === null ? null : `${count} contact${count === 1 ? "" : "s"}`,
      };
    }
    case "reaction": {
      const emoji = boundInboxText(readText(c, "emoji"), 16);
      return { displayKind: K.REACTION, displayText: emoji === null ? "Reaction received" : `Reacted ${emoji}`, secondaryText: null };
    }
    default:
      return { displayKind: K.UNSUPPORTED, displayText: "Unsupported WhatsApp message", secondaryText: null };
  }
}

// ---------------------------------------------------------------------------
// Outbound presentation
// ---------------------------------------------------------------------------

/**
 * Outbound rows do NOT store a provider-rendered body, so this never fabricates
 * a sentence. It states what the platform actually knows: which approved
 * template was sent. Authentication messages carry a secret, so their template
 * is named and their content is never reconstructed — the OTP is not in this
 * model, and could not be printed even if a caller asked.
 */
export function presentOutboundMessage(input: {
  readonly templateKey: string | null | undefined;
  readonly lane: string | null | undefined;
}): InboxPresentation {
  const template = typeof input?.templateKey === "string" && input.templateKey.trim() !== "" ? input.templateKey.trim() : null;
  if (input?.lane === "authentication") {
    return {
      displayKind: InboxDisplayKind.AUTHENTICATION,
      displayText: "Authentication message",
      secondaryText: template === null ? null : `Template · ${template}`,
    };
  }
  return {
    displayKind: InboxDisplayKind.TEMPLATE,
    displayText: template === null ? "Template message" : humanizeTemplateKey(template),
    secondaryText: template === null ? null : `Template · ${template}`,
  };
}

/** `lead_assignment_alert` -> `Lead assignment alert`. Presentation only. */
export function humanizeTemplateKey(templateKey: string): string {
  const words = templateKey.replace(/[_\-.]+/g, " ").trim();
  if (words === "") return "Template message";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// The unified event
// ---------------------------------------------------------------------------

export interface InboxEventView {
  readonly conversationId: string;
  readonly eventId: string;
  readonly direction: InboxDirectionValue;
  readonly occurredAt: string;
  readonly displayKind: InboxDisplayKindValue;
  readonly displayText: string | null;
  readonly secondaryText: string | null;
  /** Outbound only. Inbound carries no delivery lifecycle of its own. */
  readonly deliveryTone: InboxDeliveryToneValue | null;
  readonly deliveryLabel: string | null;
  readonly templateKey: string | null;
  readonly identityConfidence: string | null;
  readonly failureCode: string | null;
  readonly failureReasonSanitized: string | null;
}

/**
 * Inbound events happen when the PROVIDER says they happened, falling back to
 * our receipt time when that is absent or unparsable. Outbound events happen
 * when the row was created. Browser clock time is never involved.
 */
export function inboxEffectiveOccurredAt(input: {
  readonly direction: InboxDirectionValue;
  readonly providerOccurredAt?: string | null;
  readonly receivedAt?: string | null;
  readonly createdAt?: string | null;
}): string | null {
  const usable = (v: unknown): string | null =>
    typeof v === "string" && v !== "" && Number.isFinite(Date.parse(v)) ? v : null;
  if (input?.direction === InboxDirection.INBOUND) {
    return usable(input.providerOccurredAt) ?? usable(input.receivedAt);
  }
  return usable(input?.createdAt);
}

/**
 * Deterministic ordering: time ascending, then a fixed direction tie-break, then
 * the source row id. Two events with identical timestamps therefore always sort
 * the same way, in every process and on every page.
 */
export function compareInboxEvents(a: InboxEventView, b: InboxEventView): number {
  const ta = Date.parse(a.occurredAt);
  const tb = Date.parse(b.occurredAt);
  if (ta !== tb) return ta - tb;
  if (a.direction !== b.direction) return a.direction === InboxDirection.INBOUND ? -1 : 1;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Participant identity
// ---------------------------------------------------------------------------

export interface InboxPrincipalEvidence {
  readonly principalType: string | null;
  readonly principalId: string | null;
}

export interface InboxParticipantVerdict {
  readonly kind: InboxParticipantKindValue;
  readonly principalType: string | null;
  readonly principalId: string | null;
  readonly conflict: boolean;
}

/**
 * Folds every EXACT principal seen on one conversation into a verdict. One
 * distinct principal enriches the conversation; none leaves it unknown but
 * perfectly valid; two different ones are a conflict this model refuses to
 * resolve by picking the newest or the most frequent.
 */
export function resolveInboxParticipant(evidence: readonly InboxPrincipalEvidence[]): InboxParticipantVerdict {
  const seen = new Map<string, InboxPrincipalEvidence>();
  for (const e of evidence ?? []) {
    const type = typeof e?.principalType === "string" ? e.principalType : null;
    const id = typeof e?.principalId === "string" ? e.principalId : null;
    if (type === null || id === null || type === "" || id === "") continue;
    seen.set(`${type}:${id}`, { principalType: type, principalId: id });
  }
  if (seen.size === 0) {
    return { kind: InboxParticipantKind.UNKNOWN, principalType: null, principalId: null, conflict: false };
  }
  if (seen.size > 1) {
    return { kind: InboxParticipantKind.CONFLICT, principalType: null, principalId: null, conflict: true };
  }
  const only = [...seen.values()][0];
  const kind =
    only.principalType === "client" ? InboxParticipantKind.CLIENT :
    only.principalType === "vendor" ? InboxParticipantKind.VENDOR :
    only.principalType === "admin" ? InboxParticipantKind.ADMIN :
    InboxParticipantKind.UNKNOWN;
  return { kind, principalType: only.principalType, principalId: only.principalId, conflict: false };
}

/** Proven name, else the masked number, else an honest unknown. Never a full phone. */
export function inboxParticipantDisplayName(input: {
  readonly verdict: InboxParticipantVerdict;
  readonly provenName?: string | null;
  readonly maskedDestination?: string | null;
}): string {
  if (input?.verdict?.conflict === true) return "Identity conflict — review required";
  const proven = boundInboxText(input?.provenName ?? null, 120);
  if (proven !== null) return proven;
  const masked = boundInboxText(input?.maskedDestination ?? null, 40);
  if (masked !== null) return masked;
  return "Unknown WhatsApp contact";
}

// ---------------------------------------------------------------------------
// Needs reply — derived, never a persisted unread flag
// ---------------------------------------------------------------------------

/**
 * DERIVED from the conversation's own latest event. QF-MVP-82A stores no read
 * state anywhere, so this is deliberately called "needs reply" and not "unread":
 * there is no read-state authority to be wrong about.
 */
export function inboxNeedsReply(lastDirection: InboxDirectionValue | null | undefined): boolean {
  return lastDirection === InboxDirection.INBOUND;
}

// ---------------------------------------------------------------------------
// Conversation summary
// ---------------------------------------------------------------------------

export interface InboxConversationView {
  readonly conversationId: string;
  readonly displayName: string;
  readonly participantKind: InboxParticipantKindValue;
  readonly principalType: string | null;
  readonly principalId: string | null;
  readonly maskedDestination: string | null;
  readonly identityConfidence: string | null;
  readonly lastActivityAt: string;
  readonly lastDirection: InboxDirectionValue;
  readonly preview: string | null;
  readonly needsReply: boolean;
  readonly hasFailure: boolean;
  readonly providerAccountLabel: string | null;
}

/** Newest conversation first, then the opaque id so equal timestamps are stable. */
export function compareInboxConversations(a: InboxConversationView, b: InboxConversationView): number {
  const ta = Date.parse(a.lastActivityAt);
  const tb = Date.parse(b.lastActivityAt);
  if (ta !== tb) return tb - ta;
  return a.conversationId < b.conversationId ? -1 : a.conversationId > b.conversationId ? 1 : 0;
}

/** The filters the operator can apply. Closed set. */
export const InboxFilter = Object.freeze({
  ALL: "all",
  CLIENTS: "clients",
  VENDORS: "vendors",
  UNKNOWN: "unknown",
  NEEDS_REPLY: "needs_reply",
  FAILED: "failed",
} as const);
export type InboxFilterValue = (typeof InboxFilter)[keyof typeof InboxFilter];

export function parseInboxFilter(raw: unknown): InboxFilterValue {
  const values = Object.values(InboxFilter) as readonly string[];
  return typeof raw === "string" && values.includes(raw) ? (raw as InboxFilterValue) : InboxFilter.ALL;
}

/** Pure predicate, so the filter means exactly the same thing wherever it runs. */
export function inboxConversationMatchesFilter(
  conversation: InboxConversationView,
  filter: InboxFilterValue,
): boolean {
  switch (filter) {
    case InboxFilter.CLIENTS: return conversation.participantKind === InboxParticipantKind.CLIENT;
    case InboxFilter.VENDORS: return conversation.participantKind === InboxParticipantKind.VENDOR;
    case InboxFilter.UNKNOWN:
      return conversation.participantKind === InboxParticipantKind.UNKNOWN ||
        conversation.participantKind === InboxParticipantKind.CONFLICT;
    case InboxFilter.NEEDS_REPLY: return conversation.needsReply;
    case InboxFilter.FAILED: return conversation.hasFailure;
    default: return true;
  }
}
