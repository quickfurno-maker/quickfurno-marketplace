// ============================================================================
// QuickFurno — services/adminWhatsAppInboxService.ts   (QF-MVP-82A, SERVER ONLY)
//
// The read layer behind the unified WhatsApp inbox.
//
// READ-ONLY BY CONSTRUCTION. There is no insert, update, upsert, delete or rpc
// call anywhere in this file, and no provider adapter, CommunicationService or
// transport is imported — so no code path here can send a message, retry one,
// replay a webhook, or mutate a lead, vendor, credit, assignment, consent
// record, template or runtime policy. It reads the two EXISTING authorities and
// renders what they already hold.
//
// NO NEW AUTHORITY. Inbound truth stays in communication_inbound_messages,
// outbound truth and its delivery lifecycle stay in communication_messages.
// Nothing is copied between them and no third conversation table exists; the
// conversation is computed, in memory, per request.
//
// THE CONTACT HASH STOPS HERE. `destination_hash` / `sender_hash` are what make
// grouping exact, so they are read — but they are never returned. Every
// conversation leaves this boundary as an OPAQUE id derived in the pure read
// model, and no response field carries a hash, a raw payload, a raw
// `content_minimized` object, a variables blob or a full phone number.
//
// BOUNDED, AND HONEST ABOUT ITS BOUND. The list is built from a fixed RECENT
// ACTIVITY WINDOW of each authority — never the whole table — and the payload
// reports that window so the UI can say so plainly rather than implying the list
// is the complete history. An open thread is a separate, targeted, capped read
// against the exact contact.
//
// FAIL-SOFT PROVISIONING. A missing relation is reported as a truthful
// NOT_PROVISIONED state rather than crashing the page or, far worse, rendering
// an empty inbox that reads as "no conversations".
// ============================================================================

import "server-only";

import { adminClient } from "../lib/supabase";
import { isMissingRelationError } from "../lib/errors";
import {
  InboxDirection,
  InboxFilter,
  boundInboxPreview,
  compareInboxConversations,
  compareInboxEvents,
  inboxConversationMatchesFilter,
  inboxDeliveryLabel,
  inboxDeliveryTone,
  inboxEffectiveOccurredAt,
  inboxNeedsReply,
  inboxParticipantDisplayName,
  presentInboundMessage,
  presentOutboundMessage,
  resolveInboxParticipant,
  type InboxConversationView,
  type InboxDirectionValue,
  type InboxEventView,
  type InboxFilterValue,
  type InboxPrincipalEvidence,
} from "../lib/communication/whatsappInboxReadModel";
import {
  whatsappConversationId,
  whatsappConversationNamespace,
} from "../lib/communication/whatsappInboxConversationKey";

const OUTBOUND_TABLE = "communication_messages";
const INBOUND_TABLE = "communication_inbound_messages";

/** Bounded by construction: no caller may request a larger page or "all". */
export const INBOX_CONVERSATION_PAGE_SIZE = 25;
/** One screen of history for an open thread. */
export const INBOX_THREAD_EVENT_LIMIT = 80;
/**
 * The recent-activity window the conversation list is built from, PER
 * AUTHORITY. This is the honest scope of the list, and the payload reports it so
 * the UI never implies more coverage than was actually read.
 */
export const INBOX_SCAN_WINDOW = 600;

export type InboxSectionState = "ok" | "fault" | "not_provisioned";

export interface WhatsAppInboxThread {
  readonly conversation: InboxConversationView;
  readonly events: readonly InboxEventView[];
  readonly hasOlder: boolean;
}

export interface WhatsAppInboxPayload {
  readonly conversations: readonly InboxConversationView[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly filter: InboxFilterValue;
  readonly search: string | null;
  readonly thread: WhatsAppInboxThread | null;
  readonly selectionOutOfWindow: boolean;
  /** How many rows per authority the list was built from. Reported, not hidden. */
  readonly scanWindow: number;
  /** True when the window was filled, so older conversations may exist beyond it. */
  readonly windowSaturated: boolean;
}

export interface InboxSection<T> {
  readonly state: InboxSectionState;
  readonly data: T;
}

const EMPTY_PAYLOAD = (filter: InboxFilterValue, search: string | null): WhatsAppInboxPayload => ({
  conversations: [], page: 1, pageSize: INBOX_CONVERSATION_PAGE_SIZE, total: 0,
  filter, search, thread: null, selectionOutOfWindow: false,
  scanWindow: INBOX_SCAN_WINDOW, windowSaturated: false,
});

/**
 * A read failure is logged as a SHAPE, never as content: no message body, no
 * hash, no masked number, no provider message id and no driver text — any of
 * which could carry customer data into a log aggregator.
 */
function logInboxReadFailure(scope: string, error: unknown) {
  const safe = error as { name?: string; code?: string } | null;
  console.error("[admin-whatsapp-inbox] read failed", {
    scope,
    name: safe?.name ?? "Error",
    code: safe?.code ?? "UNKNOWN",
  });
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

// ---------------------------------------------------------------------------
// Column lists — the privacy fence
//
// Neither list names destination_masked's plaintext counterpart (there is none),
// recipient_ref, variables or metadata. What is not selected cannot leak.
// ---------------------------------------------------------------------------

const OUTBOUND_COLUMNS =
  "id, created_at, provider, provider_account_id, destination_hash, destination_masked, " +
  "lane, template_key, status, failure_code, failure_reason_sanitized, recipient_type, recipient_id";

const INBOUND_COLUMNS =
  "id, received_at, provider_occurred_at, provider, provider_account_id, sender_hash, sender_masked, " +
  "message_type, content_minimized, processing_status, identity_confidence, " +
  "resolved_principal_type, resolved_principal_id, failure_reason_sanitized";

interface NormalizedEvent {
  readonly namespace: string;
  readonly contactHash: string;
  readonly providerAccountId: string | null;
  readonly provider: string | null;
  readonly contactMasked: string | null;
  readonly direction: InboxDirectionValue;
  readonly view: InboxEventView;
  readonly principal: InboxPrincipalEvidence;
  readonly isFailure: boolean;
}

// ---------------------------------------------------------------------------
// Normalization — the ONE place a stored row becomes a display event
// ---------------------------------------------------------------------------

function normalizeOutbound(row: Record<string, unknown>): NormalizedEvent | null {
  const contactHash = str(row.destination_hash);
  if (contactHash === null) return null;
  const providerAccountId = str(row.provider_account_id);
  const provider = str(row.provider);
  const namespace = whatsappConversationNamespace({ providerAccountId, provider });
  const conversationId = whatsappConversationId({ providerAccountId, provider, contactHash });
  if (conversationId === null) return null;

  const occurredAt = inboxEffectiveOccurredAt({
    direction: InboxDirection.OUTBOUND,
    createdAt: str(row.created_at),
  });
  if (occurredAt === null) return null;

  const status = str(row.status);
  const tone = inboxDeliveryTone(status);
  const presentation = presentOutboundMessage({ templateKey: str(row.template_key), lane: str(row.lane) });

  return {
    namespace, contactHash, providerAccountId, provider,
    contactMasked: str(row.destination_masked),
    direction: InboxDirection.OUTBOUND,
    principal: { principalType: str(row.recipient_type), principalId: str(row.recipient_id) },
    isFailure: status === "failed" || status === "dead_letter",
    view: {
      conversationId,
      eventId: String(row.id),
      direction: InboxDirection.OUTBOUND,
      occurredAt,
      displayKind: presentation.displayKind,
      displayText: presentation.displayText,
      secondaryText: presentation.secondaryText,
      deliveryTone: tone,
      deliveryLabel: inboxDeliveryLabel(tone),
      templateKey: str(row.template_key),
      identityConfidence: null,
      failureCode: str(row.failure_code),
      failureReasonSanitized: str(row.failure_reason_sanitized),
    },
  };
}

function normalizeInbound(row: Record<string, unknown>): NormalizedEvent | null {
  const contactHash = str(row.sender_hash);
  if (contactHash === null) return null;
  const providerAccountId = str(row.provider_account_id);
  const provider = str(row.provider);
  const namespace = whatsappConversationNamespace({ providerAccountId, provider });
  const conversationId = whatsappConversationId({ providerAccountId, provider, contactHash });
  if (conversationId === null) return null;

  const occurredAt = inboxEffectiveOccurredAt({
    direction: InboxDirection.INBOUND,
    providerOccurredAt: str(row.provider_occurred_at),
    receivedAt: str(row.received_at),
  });
  if (occurredAt === null) return null;

  // The raw minimized object is consumed HERE and never forwarded: what leaves
  // this function is presentation text the pure renderer produced.
  const presentation = presentInboundMessage({
    messageType: str(row.message_type),
    contentMinimized: row.content_minimized,
  });

  return {
    namespace, contactHash, providerAccountId, provider,
    contactMasked: str(row.sender_masked),
    direction: InboxDirection.INBOUND,
    principal: {
      principalType: str(row.resolved_principal_type),
      principalId: str(row.resolved_principal_id),
    },
    isFailure: false,
    view: {
      conversationId,
      eventId: String(row.id),
      direction: InboxDirection.INBOUND,
      occurredAt,
      displayKind: presentation.displayKind,
      displayText: presentation.displayText,
      secondaryText: presentation.secondaryText,
      deliveryTone: null,
      deliveryLabel: null,
      templateKey: null,
      identityConfidence: str(row.identity_confidence),
      failureCode: null,
      failureReasonSanitized: str(row.failure_reason_sanitized),
    },
  };
}

// ---------------------------------------------------------------------------
// Bounded reads
// ---------------------------------------------------------------------------

async function readRecentWindow(): Promise<{ events: NormalizedEvent[]; saturated: boolean }> {
  const db = adminClient();
  const [outbound, inbound] = await Promise.all([
    db.from(OUTBOUND_TABLE).select(OUTBOUND_COLUMNS)
      .eq("channel", "whatsapp")
      .order("created_at", { ascending: false })
      .limit(INBOX_SCAN_WINDOW),
    db.from(INBOUND_TABLE).select(INBOUND_COLUMNS)
      .order("received_at", { ascending: false })
      .limit(INBOX_SCAN_WINDOW),
  ]);
  if (outbound.error) throw outbound.error;
  if (inbound.error) throw inbound.error;

  const outRows = ((outbound.data ?? []) as unknown) as Record<string, unknown>[];
  const inRows = ((inbound.data ?? []) as unknown) as Record<string, unknown>[];

  const events: NormalizedEvent[] = [];
  for (const row of outRows) {
    const e = normalizeOutbound(row);
    if (e !== null) events.push(e);
  }
  for (const row of inRows) {
    const e = normalizeInbound(row);
    if (e !== null) events.push(e);
  }
  return {
    events,
    saturated: outRows.length >= INBOX_SCAN_WINDOW || inRows.length >= INBOX_SCAN_WINDOW,
  };
}

interface Aggregate {
  readonly namespace: string;
  readonly contactHash: string;
  readonly providerAccountId: string | null;
  readonly provider: string | null;
  conversationId: string;
  contactMasked: string | null;
  lastActivityAt: string;
  lastDirection: InboxDirectionValue;
  lastText: string | null;
  hasFailure: boolean;
  identityConfidence: string | null;
  readonly principals: InboxPrincipalEvidence[];
}

/**
 * Groups a window of events into conversations on (namespace, contact hash) —
 * the durable identity the platform already stores. Never on time proximity,
 * masked-number similarity or display name.
 */
function aggregate(events: readonly NormalizedEvent[]): Aggregate[] {
  const byKey = new Map<string, Aggregate>();
  for (const e of events) {
    const key = `${e.namespace}|${e.contactHash}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, {
        namespace: e.namespace,
        contactHash: e.contactHash,
        providerAccountId: e.providerAccountId,
        provider: e.provider,
        conversationId: e.view.conversationId,
        contactMasked: e.contactMasked,
        lastActivityAt: e.view.occurredAt,
        lastDirection: e.direction,
        lastText: e.view.displayText,
        hasFailure: e.isFailure,
        identityConfidence: e.view.identityConfidence,
        principals: [e.principal],
      });
      continue;
    }
    existing.principals.push(e.principal);
    existing.hasFailure = existing.hasFailure || e.isFailure;
    if (Date.parse(e.view.occurredAt) >= Date.parse(existing.lastActivityAt)) {
      existing.lastActivityAt = e.view.occurredAt;
      existing.lastDirection = e.direction;
      existing.lastText = e.view.displayText;
      if (e.contactMasked !== null) existing.contactMasked = e.contactMasked;
      if (e.view.identityConfidence !== null) existing.identityConfidence = e.view.identityConfidence;
    }
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// Participant enrichment — batched, never one query per conversation
// ---------------------------------------------------------------------------

interface ParticipantNames {
  readonly vendors: ReadonlyMap<string, string>;
  readonly clients: ReadonlyMap<string, string>;
}

const NO_NAMES: ParticipantNames = { vendors: new Map(), clients: new Map() };

/**
 * Two queries at most for a whole page, keyed by DISTINCT id. A failure to read
 * a display name is never fatal: the conversation falls back to its masked
 * number, which is always safe to show.
 */
async function loadParticipantNames(aggregates: readonly Aggregate[]): Promise<ParticipantNames> {
  const vendorIds = new Set<string>();
  const clientIds = new Set<string>();
  for (const a of aggregates) {
    const verdict = resolveInboxParticipant(a.principals);
    if (verdict.conflict || verdict.principalId === null) continue;
    if (verdict.principalType === "vendor") vendorIds.add(verdict.principalId);
    if (verdict.principalType === "client") clientIds.add(verdict.principalId);
  }
  if (vendorIds.size === 0 && clientIds.size === 0) return NO_NAMES;

  const vendors = new Map<string, string>();
  const clients = new Map<string, string>();
  try {
    const db = adminClient();
    const [vendorRes, clientRes] = await Promise.all([
      vendorIds.size === 0
        ? Promise.resolve({ data: [] as unknown[], error: null })
        : db.from("vendors").select("id, business_name").in("id", [...vendorIds]),
      clientIds.size === 0
        ? Promise.resolve({ data: [] as unknown[], error: null })
        : db.from("client_accounts").select("id, display_name").in("id", [...clientIds]),
    ]);
    for (const r of (vendorRes.data ?? []) as { id: string; business_name: string | null }[]) {
      const name = str(r.business_name);
      if (name !== null) vendors.set(r.id, name);
    }
    for (const r of (clientRes.data ?? []) as { id: string; display_name: string | null }[]) {
      const name = str(r.display_name);
      if (name !== null) clients.set(r.id, name);
    }
  } catch (error) {
    logInboxReadFailure("participants", error);
    return NO_NAMES;
  }
  return { vendors, clients };
}

function projectConversation(a: Aggregate, names: ParticipantNames): InboxConversationView {
  const verdict = resolveInboxParticipant(a.principals);
  const provenName =
    verdict.principalId === null ? null :
    verdict.principalType === "vendor" ? names.vendors.get(verdict.principalId) ?? null :
    verdict.principalType === "client" ? names.clients.get(verdict.principalId) ?? null :
    null;

  return {
    conversationId: a.conversationId,
    displayName: inboxParticipantDisplayName({ verdict, provenName, maskedDestination: a.contactMasked }),
    participantKind: verdict.kind,
    principalType: verdict.principalType,
    principalId: verdict.principalId,
    maskedDestination: a.contactMasked,
    identityConfidence: a.identityConfidence,
    lastActivityAt: a.lastActivityAt,
    lastDirection: a.lastDirection,
    preview: boundInboxPreview(a.lastText),
    needsReply: inboxNeedsReply(a.lastDirection),
    hasFailure: a.hasFailure,
    providerAccountLabel: null,
  };
}

// ---------------------------------------------------------------------------
// The open thread — a targeted, capped read for ONE contact
// ---------------------------------------------------------------------------

/**
 * Re-applies the conversation's own namespace at the query, so a thread can
 * never mix a legacy unbound row into a bound account's conversation, and can
 * never reach across two accounts that happen to share a contact.
 */
async function readThread(a: Aggregate, names: ParticipantNames): Promise<WhatsAppInboxThread> {
  const db = adminClient();
  // One extra row per side, purely to learn whether older history exists
  // without ever asking for the whole conversation.
  const cap = INBOX_THREAD_EVENT_LIMIT + 1;

  let outboundQuery = db
    .from(OUTBOUND_TABLE)
    .select(OUTBOUND_COLUMNS)
    .eq("channel", "whatsapp")
    .eq("destination_hash", a.contactHash);
  let inboundQuery = db
    .from(INBOUND_TABLE)
    .select(INBOUND_COLUMNS)
    .eq("sender_hash", a.contactHash);

  if (a.providerAccountId !== null) {
    outboundQuery = outboundQuery.eq("provider_account_id", a.providerAccountId);
    inboundQuery = inboundQuery.eq("provider_account_id", a.providerAccountId);
  } else {
    outboundQuery = outboundQuery.is("provider_account_id", null).eq("provider", a.provider);
    inboundQuery = inboundQuery.is("provider_account_id", null).eq("provider", a.provider);
  }

  const [outbound, inbound] = await Promise.all([
    outboundQuery.order("created_at", { ascending: false }).limit(cap),
    inboundQuery.order("received_at", { ascending: false }).limit(cap),
  ]);
  if (outbound.error) throw outbound.error;
  if (inbound.error) throw inbound.error;

  const events: InboxEventView[] = [];
  for (const row of ((outbound.data ?? []) as unknown) as Record<string, unknown>[]) {
    const e = normalizeOutbound(row);
    if (e !== null) events.push(e.view);
  }
  for (const row of ((inbound.data ?? []) as unknown) as Record<string, unknown>[]) {
    const e = normalizeInbound(row);
    if (e !== null) events.push(e.view);
  }

  events.sort(compareInboxEvents);
  const hasOlder = events.length > INBOX_THREAD_EVENT_LIMIT;
  // Keep the NEWEST window: a thread opens at the recent end, like every chat.
  const windowed = hasOlder ? events.slice(events.length - INBOX_THREAD_EVENT_LIMIT) : events;

  return { conversation: projectConversation(a, names), events: windowed, hasOlder };
}

// ---------------------------------------------------------------------------
// The one entry point the route uses
// ---------------------------------------------------------------------------

export interface WhatsAppInboxQuery {
  readonly page?: string | number | null;
  readonly filter?: string | null;
  readonly search?: string | null;
  readonly conversation?: string | null;
}

const boundInboxPage = (raw: unknown): number => {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? "1"), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.trunc(n), 10_000) : 1;
};

/** Only a hex id can be a conversation selector; anything else is ignored. */
const boundConversationId = (raw: unknown): string | null =>
  typeof raw === "string" && /^[0-9a-f]{64}$/.test(raw) ? raw : null;

const boundSearch = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, 64);
  return trimmed === "" ? null : trimmed;
};

export async function getWhatsAppInboxPage(
  query: WhatsAppInboxQuery = {},
): Promise<InboxSection<WhatsAppInboxPayload>> {
  const page = boundInboxPage(query.page);
  const filter = ((): InboxFilterValue => {
    const values = Object.values(InboxFilter) as readonly string[];
    return typeof query.filter === "string" && values.includes(query.filter)
      ? (query.filter as InboxFilterValue)
      : InboxFilter.ALL;
  })();
  const search = boundSearch(query.search);
  const selectedId = boundConversationId(query.conversation);

  try {
    const { events, saturated } = await readRecentWindow();
    const aggregates = aggregate(events);
    const names = await loadParticipantNames(aggregates);

    const all = aggregates
      .map((a) => ({ aggregate: a, view: projectConversation(a, names) }))
      .filter(({ view }) => inboxConversationMatchesFilter(view, filter))
      .filter(({ view }) =>
        search === null
          ? true
          // Search matches the MASKED contact or a proven display name — both
          // are already-safe values, and both are searched across the whole
          // window rather than only the visible page.
          : (view.maskedDestination ?? "").toLowerCase().includes(search.toLowerCase()) ||
            view.displayName.toLowerCase().includes(search.toLowerCase()),
      )
      .sort((x, y) => compareInboxConversations(x.view, y.view));

    const from = (page - 1) * INBOX_CONVERSATION_PAGE_SIZE;
    const pageSlice = all.slice(from, from + INBOX_CONVERSATION_PAGE_SIZE);

    let thread: WhatsAppInboxThread | null = null;
    let selectionOutOfWindow = false;
    if (selectedId !== null) {
      const target = aggregates.find((a) => a.conversationId === selectedId) ?? null;
      if (target === null) selectionOutOfWindow = true;
      else thread = await readThread(target, names);
    }

    return {
      state: "ok",
      data: {
        conversations: pageSlice.map(({ view }) => view),
        page,
        pageSize: INBOX_CONVERSATION_PAGE_SIZE,
        total: all.length,
        filter,
        search,
        thread,
        selectionOutOfWindow,
        scanWindow: INBOX_SCAN_WINDOW,
        windowSaturated: saturated,
      },
    };
  } catch (error) {
    logInboxReadFailure("inbox", error);
    return {
      state: isMissingRelationError(error) ? "not_provisioned" : "fault",
      data: EMPTY_PAYLOAD(filter, search),
    };
  }
}
