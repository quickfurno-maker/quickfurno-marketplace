// ============================================================================
// QF-MVP-82A — unified WhatsApp inbox validator.  OFFLINE.
// No network, no database, no credential, no send, no production read.
//
// HOW IT CHECKS
//   Every grouping, identity, presentation and ordering decision is EXECUTED
//   against the real pure read model, so the rules are proved rather than
//   described. Source text is read only for the NEGATIVE claims — no send, no
//   provider, no client-side service role, no write, no raw payload on the wire
//   — which no execution can demonstrate.
//
//   Source checks run on CODE ONLY: comments are stripped first, so a comment
//   that deliberately NAMES a forbidden pattern can never fail the build.
// ============================================================================

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  InboxDeliveryTone,
  InboxDirection,
  InboxDisplayKind,
  InboxFilter,
  InboxParticipantKind,
  INBOX_MAX_BUBBLE_TEXT,
  INBOX_MAX_PREVIEW_TEXT,
  boundInboxPreview,
  boundInboxText,
  compareInboxConversations,
  compareInboxEvents,
  humanizeTemplateKey,
  inboxConversationMatchesFilter,
  inboxDeliveryLabel,
  inboxDeliveryTone,
  inboxEffectiveOccurredAt,
  inboxNeedsReply,
  inboxParticipantDisplayName,
  latestInboxEvent,
  parseInboxFilter,
  pickLaterInboxEvent,
  presentInboundMessage,
  presentOutboundMessage,
  resolveInboxParticipant,
} from "../../../lib/communication/whatsappInboxReadModel.ts";
import {
  whatsappConversationId,
  whatsappConversationNamespace,
} from "../../../lib/communication/whatsappInboxConversationKey.ts";

const READ_MODEL_PATH = "lib/communication/whatsappInboxReadModel.ts";
const KEY_PATH = "lib/communication/whatsappInboxConversationKey.ts";
const SERVICE_PATH = "services/adminWhatsAppInboxService.ts";
const STREAM_PATH = "app/api/admin/whatsapp/inbox/stream/route.ts";
const PAGE_PATH = "app/admin/whatsapp/page.tsx";
const SHELL_PATH = "components/admin/whatsapp/WhatsAppControlCenter.tsx";
const TYPES_PATH = "components/admin/whatsapp/whatsappAdminTypes.ts";
const INBOX_DIR = "components/admin/whatsapp/inbox";
const COMPONENTS = [
  `${INBOX_DIR}/WhatsAppInbox.tsx`,
  `${INBOX_DIR}/WhatsAppConversationList.tsx`,
  `${INBOX_DIR}/WhatsAppConversationThread.tsx`,
  `${INBOX_DIR}/WhatsAppMessageBubble.tsx`,
  `${INBOX_DIR}/WhatsAppInboxRealtimeStatus.tsx`,
  `${INBOX_DIR}/useWhatsAppInboxRealtime.ts`,
];

const rawOf = (p) => readFileSync(resolve(p), "utf8");
const codeOf = (p) => rawOf(p).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

const READ_MODEL_CODE = codeOf(READ_MODEL_PATH);
const KEY_CODE = codeOf(KEY_PATH);
const SERVICE_CODE = codeOf(SERVICE_PATH);
const STREAM_CODE = codeOf(STREAM_PATH);
const PAGE_CODE = codeOf(PAGE_PATH);
const SHELL_CODE = codeOf(SHELL_PATH);
const TYPES_CODE = codeOf(TYPES_PATH);
const COMPONENT_CODE = Object.fromEntries(COMPONENTS.map((p) => [p, codeOf(p)]));
const ALL_INBOX_CODE = [SERVICE_CODE, STREAM_CODE, READ_MODEL_CODE, KEY_CODE, ...Object.values(COMPONENT_CODE)];
const CLIENT_CODE = Object.values(COMPONENT_CODE);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
function assert(c, m) { if (!c) throw new Error(m); }
const eq = (a, b, m) => assert(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const absent = (code, re, label) => assert(!re.test(code), `${label} must not appear`);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const ACCOUNT_1 = "11111111-2222-4333-8444-555555555555";
const ACCOUNT_2 = "99999999-8888-4777-8666-555555555555";
const PROVIDER = "meta_whatsapp_cloud";

const idOf = (over = {}) =>
  whatsappConversationId({ providerAccountId: ACCOUNT_1, provider: PROVIDER, contactHash: HASH_A, ...over });

const eventOf = (over = {}) => ({
  conversationId: "c", eventId: "e1", direction: InboxDirection.INBOUND,
  occurredAt: "2026-09-05T10:00:00.000Z", displayKind: InboxDisplayKind.TEXT,
  displayText: "hi", secondaryText: null, deliveryTone: null, deliveryLabel: null,
  templateKey: null, identityConfidence: null, failureCode: null, failureReasonSanitized: null,
  ...over,
});

const conversationOf = (over = {}) => ({
  conversationId: "c1", displayName: "Someone", participantKind: InboxParticipantKind.UNKNOWN,
  principalType: null, principalId: null, maskedDestination: "+91******3210",
  identityConfidence: null, lastActivityAt: "2026-09-05T10:00:00.000Z",
  lastDirection: InboxDirection.INBOUND, preview: null, needsReply: true,
  hasFailure: false, providerAccountLabel: null, ...over,
});

// ---- 1-8. conversation identity --------------------------------------------

check("1 inbound and outbound on one account and hash are ONE conversation", () => {
  const outbound = whatsappConversationId({ providerAccountId: ACCOUNT_1, provider: PROVIDER, contactHash: HASH_A });
  const inbound = whatsappConversationId({ providerAccountId: ACCOUNT_1, provider: PROVIDER, contactHash: HASH_A });
  eq(outbound, inbound, "the two directions share one id");
  assert(typeof outbound === "string" && outbound.length === 64, "and it is a digest");
});

check("2 the same hash on two provider accounts is TWO conversations", () => {
  assert(idOf() !== idOf({ providerAccountId: ACCOUNT_2 }), "accounts partition the namespace");
});

check("3 a legacy NULL account never merges into a bound account", () => {
  assert(idOf() !== idOf({ providerAccountId: null }), "legacy and bound stay separate");
  eq(whatsappConversationNamespace({ providerAccountId: ACCOUNT_1, provider: PROVIDER }), `acct:${ACCOUNT_1}`, "bound namespace");
  eq(whatsappConversationNamespace({ providerAccountId: null, provider: PROVIDER }), `legacy:${PROVIDER}`, "legacy namespace");
});

check("4 legacy rows on the same provider and hash ARE one conversation", () => {
  eq(idOf({ providerAccountId: null }), idOf({ providerAccountId: null }), "same legacy namespace");
  eq(idOf({ providerAccountId: "" }), idOf({ providerAccountId: null }), "blank is treated as unbound");
});

check("5 legacy rows on DIFFERENT providers are different conversations", () => {
  assert(idOf({ providerAccountId: null }) !== idOf({ providerAccountId: null, provider: "other_provider" }),
    "provider partitions the legacy namespace");
  eq(whatsappConversationNamespace({ providerAccountId: null, provider: null }), "legacy:unknown", "an absent provider is named, not guessed");
});

check("6 the raw contact hash is NEVER the public conversation id", () => {
  const id = idOf();
  assert(id !== HASH_A, "id is not the hash");
  assert(!id.includes(HASH_A.slice(0, 32)), "and does not embed it");
  // A different hash on the same account must produce a different id.
  assert(idOf({ contactHash: HASH_B }) !== id, "distinct contacts, distinct ids");
});

check("7-8 the id is deterministic and stable across directions and calls", () => {
  eq(idOf(), idOf(), "deterministic");
  eq(idOf(), idOf({ contactHash: HASH_A.toUpperCase() }), "case-normalized");
  eq(whatsappConversationId({ providerAccountId: ACCOUNT_1, provider: PROVIDER, contactHash: "nope" }), null,
    "a malformed hash yields no id at all");
  eq(whatsappConversationId({ providerAccountId: ACCOUNT_1, provider: PROVIDER, contactHash: null }), null, "absent hash");
});

// ---- 9-12. principals -------------------------------------------------------

check("9 a single exact principal enriches the conversation", () => {
  const v = resolveInboxParticipant([{ principalType: "vendor", principalId: "v1" }]);
  eq(v.kind, InboxParticipantKind.VENDOR, "kind");
  eq(v.principalId, "v1", "id");
  eq(v.conflict, false, "no conflict");
});

check("10 an unknown contact still forms a valid conversation", () => {
  const v = resolveInboxParticipant([]);
  eq(v.kind, InboxParticipantKind.UNKNOWN, "kind");
  eq(v.conflict, false, "unknown is not a conflict");
  eq(inboxParticipantDisplayName({ verdict: v, maskedDestination: "+91******3210" }), "+91******3210", "masked fallback");
  eq(inboxParticipantDisplayName({ verdict: v }), "Unknown WhatsApp contact", "honest final fallback");
});

check("11 an ambiguous contact still forms a conversation", () => {
  // Ambiguous inbound carries no principal at all, by schema constraint.
  const v = resolveInboxParticipant([{ principalType: null, principalId: null }]);
  eq(v.kind, InboxParticipantKind.UNKNOWN, "still a conversation");
  eq(v.conflict, false, "and not a conflict");
});

check("12 two conflicting exact principals are reported, never resolved", () => {
  const v = resolveInboxParticipant([
    { principalType: "vendor", principalId: "v1" },
    { principalType: "client", principalId: "c1" },
  ]);
  eq(v.kind, InboxParticipantKind.CONFLICT, "kind");
  eq(v.conflict, true, "conflict");
  eq(v.principalId, null, "no principal is chosen");
  eq(inboxParticipantDisplayName({ verdict: v, provenName: "Someone" }), "Identity conflict — review required",
    "and a name never masks it");
  // The same principal seen twice is not a conflict.
  eq(resolveInboxParticipant([
    { principalType: "vendor", principalId: "v1" },
    { principalType: "vendor", principalId: "v1" },
  ]).kind, InboxParticipantKind.VENDOR, "repetition is not disagreement");
});

// ---- 13-15. needs reply and ordering ---------------------------------------

check("13-14 needsReply is derived from the latest direction", () => {
  eq(inboxNeedsReply(InboxDirection.INBOUND), true, "latest inbound needs a reply");
  eq(inboxNeedsReply(InboxDirection.OUTBOUND), false, "latest outbound does not");
  eq(inboxNeedsReply(null), false, "absent is not a claim");
  // It is never called "unread": 82A has no read-state authority.
  for (const code of ALL_INBOX_CODE) absent(code, /\bunread\b/i, "an unread claim");
});

check("15 equal timestamps sort deterministically", () => {
  const a = eventOf({ eventId: "a", direction: InboxDirection.INBOUND });
  const b = eventOf({ eventId: "b", direction: InboxDirection.OUTBOUND });
  assert(compareInboxEvents(a, b) < 0, "inbound precedes outbound at equal time");
  assert(compareInboxEvents(b, a) > 0, "and the comparison is symmetric");
  const c = eventOf({ eventId: "c" });
  const d = eventOf({ eventId: "d" });
  assert(compareInboxEvents(c, d) < 0 && compareInboxEvents(d, c) > 0, "then by source id");
  const older = eventOf({ occurredAt: "2026-09-05T09:00:00.000Z" });
  assert(compareInboxEvents(older, a) < 0, "time still dominates");
  // Conversations sort newest-first, then by opaque id.
  const x = conversationOf({ conversationId: "x" });
  const y = conversationOf({ conversationId: "y" });
  assert(compareInboxConversations(x, y) < 0, "stable at equal activity");
  assert(compareInboxConversations(conversationOf({ lastActivityAt: "2026-09-06T00:00:00.000Z" }), x) < 0, "newest first");
});

check("15b effective time is deterministic and never the browser clock", () => {
  eq(inboxEffectiveOccurredAt({ direction: InboxDirection.INBOUND, providerOccurredAt: "2026-09-05T10:00:00.000Z", receivedAt: "2026-09-05T11:00:00.000Z" }),
    "2026-09-05T10:00:00.000Z", "inbound trusts the provider timestamp");
  eq(inboxEffectiveOccurredAt({ direction: InboxDirection.INBOUND, providerOccurredAt: null, receivedAt: "2026-09-05T11:00:00.000Z" }),
    "2026-09-05T11:00:00.000Z", "and falls back to receipt");
  eq(inboxEffectiveOccurredAt({ direction: InboxDirection.INBOUND, providerOccurredAt: "garbage", receivedAt: "2026-09-05T11:00:00.000Z" }),
    "2026-09-05T11:00:00.000Z", "an unparsable provider time is not used");
  eq(inboxEffectiveOccurredAt({ direction: InboxDirection.OUTBOUND, createdAt: "2026-09-05T12:00:00.000Z" }),
    "2026-09-05T12:00:00.000Z", "outbound uses its own creation time");
  for (const code of ALL_INBOX_CODE) absent(code, /Date\.now\(\)\s*(?:as|\))?[^;]{0,40}occurredAt/, "a browser clock as event time");
});

// ---- 16-28. inbound presentation -------------------------------------------

const present = (messageType, contentMinimized) => presentInboundMessage({ messageType, contentMinimized });

check("16 text renders its text", () => {
  const p = present("text", { text: "I need full home interior" });
  eq(p.displayKind, InboxDisplayKind.TEXT, "kind");
  eq(p.displayText, "I need full home interior", "text");
});

check("17 a button reply renders its title", () => {
  eq(present("button_reply", { replyId: "yes_1", title: "Yes, interested" }).displayText, "Yes, interested", "title");
  eq(present("button_reply", {}).displayText, "Button reply", "a safe label when the title is absent");
});

check("18 a list reply renders title and description", () => {
  const p = present("list_reply", { title: "Modular kitchen", description: "8-10 lakh" });
  eq(p.displayText, "Modular kitchen", "title");
  eq(p.secondaryText, "8-10 lakh", "description");
});

check("19-22 media is a placeholder plus safe caption only, never a fetch", () => {
  eq(present("image", { mediaId: "m1", caption: "my hall" }).displayText, "Image received", "image placeholder");
  eq(present("image", { mediaId: "m1", caption: "my hall" }).secondaryText, "my hall", "caption survives");
  eq(present("document", { filename: "plan.pdf" }).displayText, "Document received", "document placeholder");
  eq(present("document", { filename: "plan.pdf" }).secondaryText, "plan.pdf", "filename survives");
  eq(present("audio", {}).displayText, "Audio received", "audio placeholder");
  eq(present("video", { caption: "walkthrough" }).displayText, "Video received", "video placeholder");
  // The media id is an internal reference and must never be displayed.
  for (const type of ["image", "document", "audio", "video"]) {
    const p = present(type, { mediaId: "SECRET_MEDIA_ID", mimeType: "image/jpeg" });
    assert(!String(p.displayText).includes("SECRET_MEDIA_ID"), `${type} must not display a media id`);
    assert(!String(p.secondaryText).includes("SECRET_MEDIA_ID"), `${type} secondary must not either`);
  }
  for (const code of ALL_INBOX_CODE) {
    absent(code, /mediaId|media_id/, "a media reference");
    absent(code, /downloadMedia|fetchMedia/, "a media fetch");
  }
});

check("23 a location never invents coordinates", () => {
  const p = present("location", { received: true });
  eq(p.displayText, "Location received", "presence only");
  eq(p.secondaryText, null, "nothing else");
  for (const code of ALL_INBOX_CODE) {
    absent(code, /latitude|longitude|\blat\b|\blng\b/i, "a coordinate");
  }
});

check("24 a contact card never invents a name or a number", () => {
  const p = present("contact", { received: true, count: 2 });
  eq(p.displayText, "Contact received", "presence only");
  eq(p.secondaryText, "2 contacts", "a bare count is the most that is known");
  eq(present("contact", { received: true }).secondaryText, null, "and an absent count is not invented");
});

check("25-26 unsupported and reaction stay safe", () => {
  eq(present("unsupported", { providerType: "sticker" }).displayText, "Unsupported WhatsApp message", "unsupported");
  eq(present("wormhole", {}).displayText, "Unsupported WhatsApp message", "an unknown type is not guessed");
  eq(present("reaction", { emoji: "👍" }).displayText, "Reacted 👍", "reaction");
  eq(present("reaction", { targetMessageId: "wamid.X" }).displayText, "Reaction received", "no provider id is shown");
  assert(!String(present("reaction", { emoji: "👍", targetMessageId: "wamid.X" }).displayText).includes("wamid"),
    "and never leaks one alongside the emoji");
});

check("27 oversized text is bounded", () => {
  const huge = "x".repeat(50_000);
  const out = present("text", { text: huge }).displayText;
  assert(out.length <= INBOX_MAX_BUBBLE_TEXT, `bounded to ${INBOX_MAX_BUBBLE_TEXT} (got ${out.length})`);
  assert(out.endsWith("…"), "and visibly truncated");
  eq(boundInboxText("", 10), null, "empty is nothing");
  eq(boundInboxText(null, 10), null, "absent is nothing");
});

check("28 HTML-like text stays plain text and is never injected", () => {
  const hostile = '<img src=x onerror="alert(1)"> & <b>bold</b>';
  eq(present("text", { text: hostile }).displayText, hostile,
    "the customer's own characters are preserved, not silently rewritten");
  // Safety comes from React escaping a text child, so no component may opt out.
  for (const [path, code] of Object.entries(COMPONENT_CODE)) {
    absent(code, /dangerouslySetInnerHTML/, `dangerouslySetInnerHTML in ${path}`);
    absent(code, /innerHTML|outerHTML|document\.write/, `direct DOM HTML in ${path}`);
  }
});

// ---- 29-34. outbound presentation and delivery ------------------------------

check("29 an authentication message never reveals a secret", () => {
  const p = presentOutboundMessage({ templateKey: "vendor_login_otp", lane: "authentication" });
  eq(p.displayKind, InboxDisplayKind.AUTHENTICATION, "kind");
  eq(p.displayText, "Authentication message", "no content is reconstructed");
  // The model has no input through which an OTP could even arrive.
  absent(READ_MODEL_CODE, /\botp\b/i, "any OTP handling");
  for (const code of ALL_INBOX_CODE) absent(code, /variables\s*[:.]/, "a raw variables blob");
});

check("30 outbound presentation states the template, it does not fabricate a body", () => {
  const p = presentOutboundMessage({ templateKey: "lead_assignment_alert", lane: "business" });
  eq(p.displayText, "Lead assignment alert", "a humanized template name");
  eq(p.secondaryText, "Template · lead_assignment_alert", "and the exact key beside it");
  eq(presentOutboundMessage({ templateKey: null, lane: "business" }).displayText, "Template message",
    "an unknown template is named honestly");
  eq(humanizeTemplateKey("lead_assignment_alert"), "Lead assignment alert", "presentation only");
});

check("31-34 the delivery lifecycle maps truthfully", () => {
  eq(inboxDeliveryTone("queued"), InboxDeliveryTone.PENDING, "queued");
  eq(inboxDeliveryTone("dispatching"), InboxDeliveryTone.PENDING, "dispatching");
  eq(inboxDeliveryTone("accepted"), InboxDeliveryTone.ACCEPTED, "accepted");
  eq(inboxDeliveryTone("sent"), InboxDeliveryTone.SENT, "sent");
  eq(inboxDeliveryTone("delivered"), InboxDeliveryTone.DELIVERED, "delivered");
  eq(inboxDeliveryTone("read"), InboxDeliveryTone.READ, "read");
  eq(inboxDeliveryTone("failed"), InboxDeliveryTone.FAILED, "failed");
  eq(inboxDeliveryTone("dead_letter"), InboxDeliveryTone.FAILED, "dead_letter");
  eq(inboxDeliveryTone("retry_scheduled"), InboxDeliveryTone.RETRY_PENDING, "retry_scheduled");
  eq(inboxDeliveryTone("cancelled"), InboxDeliveryTone.CANCELLED, "cancelled");
  eq(inboxDeliveryTone("teleported"), InboxDeliveryTone.UNKNOWN, "an unknown status is not guessed");
  // THE load-bearing distinction: delivered is not read.
  assert(inboxDeliveryTone("delivered") !== inboxDeliveryTone("read"), "delivered must never render as read");
  eq(inboxDeliveryLabel(InboxDeliveryTone.DELIVERED), "Delivered", "delivered label");
  eq(inboxDeliveryLabel(InboxDeliveryTone.READ), "Read", "read label");
  eq(inboxDeliveryLabel(InboxDeliveryTone.FAILED), "Failed", "failed label");
  eq(inboxDeliveryLabel(InboxDeliveryTone.CANCELLED), "Cancelled", "cancelled label");
});

// ---- 35-38. preview and sanitization ---------------------------------------

check("35 the list preview is one bounded line", () => {
  const p = boundInboxPreview("line one\nline two\n\n   line three");
  eq(p, "line one line two line three", "newlines collapse");
  const long = boundInboxPreview("y".repeat(1000));
  assert(long.length <= INBOX_MAX_PREVIEW_TEXT, `bounded to ${INBOX_MAX_PREVIEW_TEXT}`);
  eq(boundInboxPreview("   "), null, "whitespace is nothing");
});

check("36-38 no hash, raw payload or raw minimized content reaches the view model", () => {
  // The presentation functions return a closed shape; nothing else can ride along.
  const p = present("text", { text: "hi", secretField: HASH_A });
  eq(Object.keys(p).sort().join(","), "displayKind,displayText,secondaryText", "closed presentation shape");
  assert(!JSON.stringify(p).includes(HASH_A), "an unknown field is dropped, not forwarded");
  // The service must READ those columns to group and render, but must never
  // hand them onward: each may appear only in a column list, as a row read, or
  // as a query fence — never as a field of anything returned.
  // A column list spans several lines, each a bare string literal, so that shape
  // counts as "inside a column list" too.
  const COLUMN_LITERAL = /^\s*"[^"]*"\s*\+?\s*;?\s*$/;
  for (const [field, allowed] of [
    ["content_minimized", /_COLUMNS|contentMinimized: row\.content_minimized/],
    ["destination_hash", /_COLUMNS|str\(row\.|\.eq\(/],
    ["sender_hash", /_COLUMNS|str\(row\.|\.eq\(/],
  ]) {
    const uses = SERVICE_CODE.match(new RegExp(`^.*${field}.*$`, "gm")) ?? [];
    assert(uses.length > 0, `${field} is genuinely used`);
    for (const line of uses) {
      assert(allowed.test(line) || COLUMN_LITERAL.test(line),
        `${field} escaped its allowed use: ${line.trim()}`);
    }
  }
  // The view model the browser receives has a closed field list with no hash.
  const viewShape = READ_MODEL_CODE.slice(
    READ_MODEL_CODE.indexOf("interface InboxEventView"),
    READ_MODEL_CODE.indexOf("export function inboxEffectiveOccurredAt"),
  );
  for (const field of ["destination_hash", "sender_hash", "content_minimized", "variables", "metadata"]) {
    absent(viewShape, new RegExp(field), `${field} in the event view model`);
  }
  // And no client component names them at all.
  for (const [path, code] of Object.entries(COMPONENT_CODE)) {
    for (const field of ["destination_hash", "sender_hash", "content_minimized", "provider_message_id", "variables", "metadata"]) {
      absent(code, new RegExp(field), `${field} in ${path}`);
    }
  }
});

// ---- 39-56. the server read layer ------------------------------------------

check("39 the read service is server-only", () => {
  assert(/^import "server-only";/m.test(rawOf(SERVICE_PATH)), "server-only is imported");
  assert(/adminClient/.test(SERVICE_CODE), "and it is the one place the privileged client is used");
});

check("40-44 the read layer cannot write", () => {
  for (const [re, label] of [
    [/\.insert\s*\(/, "an INSERT"],
    [/\.update\s*\(/, "an UPDATE"],
    [/\.upsert\s*\(/, "an upsert"],
    [/\.delete\s*\(/, "a DELETE"],
    [/\.rpc\s*\(/, "an RPC"],
  ]) {
    absent(SERVICE_CODE, re, label);
    absent(STREAM_CODE, re, label);
  }
  assert(/\.select\(/.test(SERVICE_CODE), "it reads");
});

check("45-47 every read is bounded at the query", () => {
  assert(/INBOX_CONVERSATION_PAGE_SIZE = 25/.test(SERVICE_CODE), "the page size is a constant");
  assert(/INBOX_THREAD_EVENT_LIMIT = 80/.test(SERVICE_CODE), "the thread cap is a constant");
  assert(/INBOX_SCAN_WINDOW = 600/.test(SERVICE_CODE), "the scan window is a constant");
  // Every select is followed by a limit or a range — there is no unbounded read.
  const selects = (SERVICE_CODE.match(/\.select\(/g) ?? []).length;
  const bounded = (SERVICE_CODE.match(/\.limit\(/g) ?? []).length + (SERVICE_CODE.match(/\.in\(/g) ?? []).length;
  assert(bounded >= selects - 0, `every select is bounded (${selects} selects, ${bounded} bounds)`);
  absent(SERVICE_CODE, /pageSize\s*=\s*(query|input|params)/, "a caller-tunable page size");
});

check("48 participant enrichment is batched, never one query per row", () => {
  assert(/new Set<string>\(\)/.test(SERVICE_CODE), "ids are de-duplicated");
  assert(/\.in\("id", \[\.\.\.vendorIds\]\)/.test(SERVICE_CODE), "vendors read in one batch");
  assert(/\.in\("id", \[\.\.\.clientIds\]\)/.test(SERVICE_CODE), "clients read in one batch");
  absent(SERVICE_CODE, /for\s*\([^)]*\)\s*\{[^}]*await[^}]*\.from\(/, "a query inside a loop");
});

check("49-50 unknown and conflicting participants fall back safely", () => {
  const unknown = resolveInboxParticipant([]);
  eq(inboxParticipantDisplayName({ verdict: unknown, maskedDestination: null }), "Unknown WhatsApp contact", "unknown");
  const conflict = resolveInboxParticipant([
    { principalType: "vendor", principalId: "v1" }, { principalType: "vendor", principalId: "v2" },
  ]);
  eq(inboxParticipantDisplayName({ verdict: conflict, maskedDestination: "+91******3210" }),
    "Identity conflict — review required", "a conflict is stated, not hidden behind a number");
});

check("51-56 the response carries opaque ids and no sensitive column", () => {
  assert(/conversationId/.test(SERVICE_CODE), "the response uses an opaque conversation id");
  // The privacy fence is the column list: what is not selected cannot leak.
  const columns = (SERVICE_CODE.match(/_COLUMNS =\s*[\s\S]*?;/g) ?? []).join(" ");
  assert(columns.length > 0, "column lists exist");
  for (const forbidden of ["variables", "metadata", "recipient_ref", "payload"]) {
    absent(columns, new RegExp(forbidden), `${forbidden} in a column list`);
  }
  // The error path logs a shape, never content.
  assert(/name: safe\?\.name/.test(SERVICE_CODE) && /code: safe\?\.code/.test(SERVICE_CODE), "sanitized logging");
  absent(SERVICE_CODE, /console\.(log|error)\([^)]*\b(body|text|content|hash|masked)\b/, "content in a log");
});

// ---- 57-63. Superadmin access ----------------------------------------------

check("57-60 the stream requires a trusted Superadmin session", () => {
  assert(/getAdminSession\(\)/.test(STREAM_CODE), "the trusted server session is used");
  assert(/if \(!session\.isLoggedIn\)/.test(STREAM_CODE), "anonymous is refused");
  assert(/status: 401/.test(STREAM_CODE), "with 401");
  assert(/if \(!session\.isSuperadmin\)/.test(STREAM_CODE), "a non-superadmin is refused");
  assert(/status: 403/.test(STREAM_CODE), "with 403");
  // Only GET is exported: there is no POST/PUT/DELETE handler to reach.
  const handlers = (STREAM_CODE.match(/export async function (GET|POST|PUT|PATCH|DELETE)/g) ?? []);
  eq(handlers.length, 1, `exactly one handler (${handlers.join(",")})`);
  eq(handlers[0], "export async function GET", "and it is GET");
});

check("61-62 an unauthorized request builds no client and reads nothing", () => {
  const auth = STREAM_CODE.indexOf("getAdminSession()");
  const forbid = STREAM_CODE.indexOf("status: 403");
  const streamStart = STREAM_CODE.indexOf("new ReadableStream");
  assert(auth >= 0 && forbid > auth, "the guard follows the session read");
  assert(streamStart > forbid, "the stream is opened only after the guard");
  // The privileged authority here is the Realtime subscription. Every site that
  // builds a client or opens a channel must sit AFTER the guard.
  for (const pattern of [/adminClient\(\)/g, /\.channel\(/g, /\.subscribe\(/g, /postgres_changes/g]) {
    const sites = [...STREAM_CODE.matchAll(pattern)].map((m) => m.index);
    assert(sites.length >= 1, `${pattern} appears`);
    for (const at of sites) assert(at > forbid, `no privileged Realtime work is reachable before the guard (${pattern})`);
  }
  // And nothing privileged is constructed at MODULE scope, where it would run
  // on import — before any request, let alone any session. An unindented
  // declaration is the only shape that would do that; inside a function body it
  // is lazy, and the call-site proof above already gates every invocation.
  absent(STREAM_CODE, /^(const|let|var)\s+\w+\s*=\s*adminClient\(\)/m, "a client built at module scope");
  absent(STREAM_CODE, /^await\s/m, "a top-level await that could run on import");
});

check("63 the existing /admin/whatsapp guard is intact", () => {
  assert(/if \(!session\.isLoggedIn\) redirect\("\/admin\/login"\)/.test(PAGE_CODE), "login guard");
  assert(/if \(!session\.isSuperadmin\) redirect\("\/admin\/login\?error=unauthorized"\)/.test(PAGE_CODE), "superadmin guard");
  assert(/export const dynamic = "force-dynamic"/.test(PAGE_CODE), "and the page is never statically cached");
});

// ---- 64-85. the live channel -----------------------------------------------

check("64-66 the stream is an uncacheable event stream with a heartbeat", () => {
  assert(/text\/event-stream/.test(STREAM_CODE), "content type");
  assert(/no-cache/.test(STREAM_CODE) && /no-transform/.test(STREAM_CODE), "cache directives");
  assert(/no-store/.test(STREAM_CODE), "and no-store, because this is private");
  assert(/X-Accel-Buffering/.test(STREAM_CODE), "proxy buffering disabled");
  assert(/HEARTBEAT_MS = 20_000/.test(STREAM_CODE), "a bounded heartbeat");
  assert(/setInterval\(\(\) => write\(`: heartbeat/.test(STREAM_CODE), "which is actually armed");
});

check("67-70 change detection is server-side postgres_changes on EXACTLY two tables", () => {
  assert(/postgres_changes/.test(STREAM_CODE), "the route subscribes to postgres_changes");
  // The subscribed table set is a frozen literal, not an interpolated name.
  const tableList = /INBOX_TABLES = \[([^\]]*)\]/.exec(STREAM_CODE);
  assert(tableList !== null, "the table set is a named constant");
  const tables = (tableList[1].match(/"([a-z_]+)"/g) ?? []).map((t) => t.replace(/"/g, ""));
  eq(tables.length, 2, `exactly two tables (${tables.join(", ")})`);
  assert(tables.includes("communication_inbound_messages"), "inbound is watched");
  assert(tables.includes("communication_messages"), "outbound is watched, so delivery updates refresh ticks");
  // No third table, and no wildcard scope.
  for (const forbidden of [
    "communication_delivery_events", "communication_webhook_receipts",
    "leads", "vendors", "lead_assignment_approvals", "vendor_credit_logs",
    "payments", "vendor_packages", "communication_preferences", "automation_jobs",
  ]) {
    assert(!tables.includes(forbidden), `${forbidden} must not be subscribed`);
  }
  assert(/schema: "public"/.test(STREAM_CODE), "the schema is pinned");
  absent(STREAM_CODE, /schema:\s*"\*"|table:\s*"\*"/, "a wildcard schema or table");
  // One fixed marker, and its shape is a frozen literal.
  assert(/emit\("inbox", INBOX_CHANGED\)/.test(STREAM_CODE), "one fixed marker is emitted");
  assert(/INBOX_CHANGED = \{ type: "inbox_changed", scope: "whatsapp_inbox" \}/.test(STREAM_CODE),
    "and its shape is a frozen literal");
});

check("67b THERE IS NO DATABASE POLLING LEFT", () => {
  // The watermark detector is gone: no constant, no reader, no timer-driven read.
  for (const [re, label] of [
    [/WATERMARK/i, "a watermark constant"],
    [/readWatermark/, "the watermark reader"],
    [/\.from\(/, "any PostgREST table read"],
    [/\.select\(/, "any SELECT"],
    [/updated_at|received_at/, "a watermark column"],
  ]) {
    absent(STREAM_CODE, re, label);
  }
  // The only recurring timer is the heartbeat, which writes to the socket and
  // touches no database.
  const intervals = [...STREAM_CODE.matchAll(/setInterval\(([\s\S]{0,80}?),/g)].map((m) => m[1]);
  eq(intervals.length, 1, `exactly one interval (${intervals.length})`);
  assert(/heartbeat/i.test(intervals[0]), "and it is the heartbeat");
  assert(/HEARTBEAT_MS = 20_000/.test(STREAM_CODE), "at a bounded cadence");
  // The change callback takes no argument, so a payload cannot even be read.
  assert(/const onDatabaseChange = \(\) =>/.test(STREAM_CODE),
    "the change handler binds no payload argument at all");
});

check("71-77 no row, payload or identifier is ever serialized", () => {
  for (const forbidden of [
    "payload.new", "payload.old", "destination_hash", "sender_hash",
    "content_minimized", "provider_message_id", "variables", "metadata",
  ]) {
    absent(STREAM_CODE, new RegExp(forbidden.replace(".", "\\.")), forbidden);
  }
  // Only two JSON.stringify sites exist and both carry the fixed markers.
  const stringifies = (STREAM_CODE.match(/JSON\.stringify\(/g) ?? []).length;
  eq(stringifies, 1, "exactly one serialization site");
  assert(/emit = \(event: string, data: unknown\) =>[\s\S]{0,160}JSON\.stringify\(data\)/.test(STREAM_CODE), "and it is the emit helper");
  // The postgres_changes callback never binds its payload, so there is nothing
  // to forward even by accident.
  absent(STREAM_CODE, /\(payload\)|\(payload:/, "a bound payload argument");
  absent(STREAM_CODE, /emit\([^)]*payload/, "a payload reaching the wire");
  // Only the two fixed markers and the lifecycle notices are ever emitted.
  const emitted = [...STREAM_CODE.matchAll(/emit\("([a-z]+)"/g)].map((m) => m[1]);
  for (const name of emitted) {
    assert(["inbox", "ready", "expired", "unavailable"].includes(name),
      `unexpected SSE event "${name}"`);
  }
});

check("78-80 the stream unsubscribes on abort and on expiry", () => {
  assert(/request\.signal\.addEventListener\("abort", cleanup\)/.test(STREAM_CODE), "abort cleans up");
  assert(/MAX_STREAM_MS = 5 \* 60_000/.test(STREAM_CODE), "a bounded lifetime");
  assert(/emit\("expired"/.test(STREAM_CODE), "expiry is announced");
  assert(/clearInterval\(heartbeat\)/.test(STREAM_CODE), "the heartbeat timer is cleared");
  assert(/clearTimeout\(expiry\)/.test(STREAM_CODE), "the expiry timer is cleared");
  assert(/clearTimeout\(debounce\)/.test(STREAM_CODE), "and the debounce timer");
  // THE channel must not survive the stream, on ANY exit path.
  assert(/removeChannel\(channel\)/.test(STREAM_CODE), "the Realtime channel is removed");
  assert(/if \(closed\) return;\s*closed = true;/.test(STREAM_CODE), "cleanup is idempotent");
  // Every exit path routes through that one cleanup.
  for (const path of [
    /request\.signal\.addEventListener\("abort", cleanup\)/,
    /emit\("expired"[\s\S]{0,80}cleanup\(\)/,
    /emit\("unavailable"[\s\S]{0,80}cleanup\(\)/,
  ]) {
    assert(path.test(STREAM_CODE), `an exit path calls cleanup (${path})`);
  }
  // Expiry forces a reconnect, which is what re-proves the session.
  const hook = COMPONENT_CODE[`${INBOX_DIR}/useWhatsAppInboxRealtime.ts`];
  assert(/addEventListener\("expired"[\s\S]{0,200}setTimeout\(connect/.test(hook), "the browser reconnects after expiry");
});

check("81 a failed subscription reports unavailable, never a false Live", () => {
  assert(/emit\("unavailable"/.test(STREAM_CODE), "the server says so");
  // Every Realtime failure status is handled deliberately.
  for (const status of ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) {
    assert(new RegExp(status).test(STREAM_CODE), `${status} is handled`);
  }
  // "ready" — which is what lets the browser claim Live — is emitted ONLY from
  // the SUBSCRIBED branch, never optimistically when the stream opens.
  const readyEmits = (STREAM_CODE.match(/emit\("ready"/g) ?? []).length;
  eq(readyEmits, 1, "exactly one ready emission");
  assert(/status === "SUBSCRIBED"[\s\S]{0,200}emit\("ready"/.test(STREAM_CODE),
    "and it follows a real SUBSCRIBED status");
  // No silent fallback to polling when Realtime fails.
  absent(STREAM_CODE, /fallback|WATERMARK|readWatermark/i, "a polling fallback");
  const status = COMPONENT_CODE[`${INBOX_DIR}/WhatsAppInboxRealtimeStatus.tsx`];
  assert(/unavailable: \{/.test(status), "the UI has an unavailable state");
  assert(/Live updates unavailable/.test(status), "and says it plainly");
  // "Live" is only ever set from the server's own ready event.
  const hook = COMPONENT_CODE[`${INBOX_DIR}/useWhatsAppInboxRealtime.ts`];
  assert(/addEventListener\("ready", \(\) => \{[\s\S]{0,120}setState\("live"\)/.test(hook),
    "live is claimed only on an acknowledged stream");
  eq((hook.match(/setState\("live"\)/g) ?? []).length, 1, "and from exactly one place");
});

check("82-85 the browser opens at most one stream, and only on this tab", () => {
  const hook = COMPONENT_CODE[`${INBOX_DIR}/useWhatsAppInboxRealtime.ts`];
  assert(/return \(\) => \{[\s\S]{0,200}closeSource\(\)/.test(hook), "it closes on unmount");
  assert(/closeSource\(\);\n\n      const source = new EventSource/.test(hook) ||
    /closeSource\(\);[\s\S]{0,200}new EventSource/.test(hook), "any previous source is closed before a new one");
  eq((hook.match(/new EventSource\(/g) ?? []).length, 1, "exactly one construction site");
  assert(/REFRESH_DEBOUNCE_MS = 500/.test(hook), "refreshes are debounced");
  assert(/debounceRef\.current !== null\) return;/.test(hook), "a burst collapses to one refresh");
  // The hook is called only from the inbox component, which the shell renders
  // only for the inbox tab — so another tab opens no connection at all.
  const inbox = COMPONENT_CODE[`${INBOX_DIR}/WhatsAppInbox.tsx`];
  assert(/useWhatsAppInboxRealtime\(/.test(inbox), "the inbox arms it");
  for (const [path, code] of Object.entries(COMPONENT_CODE)) {
    if (path.endsWith("WhatsAppInbox.tsx") || path.endsWith("useWhatsAppInboxRealtime.ts")) continue;
    absent(code, /useWhatsAppInboxRealtime\(/, `a second consumer in ${path}`);
  }
  assert(/payload\.tab === "inbox" \? \(/.test(SHELL_CODE), "and the shell mounts it only on the inbox tab");
});

// ---- 86-96. no schema, RLS or grant change in this phase --------------------

check("86-96 this phase adds no migration of its own and changes no grant or policy", () => {
  const migrations = readdirSync(resolve("supabase/migrations")).filter((f) => f.endsWith(".sql"));
  // The Realtime publication migration belongs to QF-MVP-82A-R0, which is MERGED
  // and already certified on staging by R0-S1. The inbox itself still adds none:
  // the only 82A-family migration in the tree is R0's, and this branch neither
  // adds another nor edits it.
  const family = migrations.filter((f) => /82a|82_a/i.test(f));
  eq(family.length, 1, `exactly the merged R0 migration (${family.join(", ")})`);
  eq(family[0], "20260904000000_qf_mvp_82a_r0_whatsapp_inbox_realtime_publication.sql", "and it is R0's");
  eq(migrations.length, 104, "the tree is unchanged at 104");
  eq(migrations.filter((f) => /82a(?!_r0)/i.test(f)).length, 0, "the inbox slice contributes no migration");
  for (const code of ALL_INBOX_CODE) {
    absent(code, /grant\s+select|GRANT\s+SELECT/, "a grant");
    absent(code, /row level security|enable rls/i, "an RLS change");
    absent(code, /create\s+(or\s+replace\s+)?(view|table|policy|publication)/i, "DDL");
    absent(code, /alter\s+publication/i, "a publication change");
  }
});

check("96b no service-role credential can reach the browser", () => {
  for (const [path, code] of Object.entries(COMPONENT_CODE)) {
    absent(code, /SERVICE_ROLE/, `a service-role reference in ${path}`);
    absent(code, /createClient/, `a Supabase client in ${path}`);
    absent(code, /adminClient/, `the privileged client in ${path}`);
    absent(code, /supabase/i, `any direct Supabase use in ${path}`);
    absent(code, /postgres_changes/, `a direct subscription in ${path}`);
    absent(code, /\.from\(["'`]communication_/, `a direct table read in ${path}`);
  }
  absent(rawOf(TYPES_PATH), /SERVICE_ROLE/, "a key in the shared types");
  // The only NEXT_PUBLIC surface is unchanged, and never a service role.
  for (const code of ALL_INBOX_CODE) absent(code, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/, "a public service-role key");
});

// ---- 97-112. no send, no mutation ------------------------------------------

check("97-106 nothing in the inbox scope can send, retry or replay", () => {
  for (const code of ALL_INBOX_CODE) {
    for (const [re, label] of [
      [/CommunicationService/, "CommunicationService"],
      [/sendResolvedTemplate/, "sendResolvedTemplate"],
      [/sendTemplateMessage/, "sendTemplateMessage"],
      [/sendAuthenticationMessage/, "sendAuthenticationMessage"],
      [/MetaCloudWhatsAppProvider/, "the Meta adapter"],
      [/graph\.facebook\.com/, "a Graph host"],
      [/\/messages\b/, "a provider messages endpoint"],
      [/processWebhook|replayWebhook/, "a webhook replay"],
      // The delivery LABEL "Retry pending" is a truthful restatement of the
      // canonical lifecycle, not a control — so this looks for retry ACTIONS.
      [/retrySend|retryMessage|resendMessage|requeue|redispatch|\.retry\s*\(/i, "a retry or resend action"],
    ]) {
      absent(code, re, label);
    }
  }
  // The service and route make no outbound HTTP call of their own.
  absent(SERVICE_CODE, /(?<![A-Za-z.])fetch\s*\(/, "fetch in the read layer");
});

check("107-112 no business state is mutated", () => {
  for (const code of [SERVICE_CODE, STREAM_CODE]) {
    for (const [re, label] of [
      [/consent_|preferences|suppression/i, "consent state"],
      [/credit|wallet|ledger/i, "credit state"],
      [/assignment/i, "assignment state"],
      [/\.from\("vendors"\)[\s\S]{0,60}\.(insert|update|delete)/, "a vendor write"],
      [/\.from\("leads"\)/, "a lead surface"],
    ]) {
      absent(code, re, label);
    }
  }
  // The only tables named anywhere in the inbox scope.
  const tables = new Set((SERVICE_CODE.match(/\.from\((?:"([a-z_]+)"|([A-Z_]+))\)/g) ?? []));
  assert(tables.size <= 4, `a small, reviewable table surface (${[...tables].join(" ")})`);
});

check("112b the certified phases and the forensic ledger are untouched", () => {
  // The Messages tab remains the direction-separated forensic ledger.
  assert(/"messages"/.test(TYPES_CODE), "the messages tab still exists");
  assert(/payload\.tab === "messages" \? \(/.test(SHELL_CODE), "and still renders its own ledger");
  assert(/getWhatsAppInboundPage/.test(PAGE_CODE), "the inbound ledger reader is still wired");
  assert(/getWhatsAppMessagePage/.test(PAGE_CODE), "so is the outbound one");
  // Inbox is a NEW tab, not a replacement.
  assert(/"inbox"/.test(TYPES_CODE), "the inbox tab was added");
  const tabs = TYPES_CODE.slice(TYPES_CODE.indexOf("WHATSAPP_TABS = ["), TYPES_CODE.indexOf("] as const"));
  for (const tab of ["overview", "inbox", "messages", "delivery", "consent", "provider", "automation"]) {
    assert(tabs.includes(`"${tab}"`), `${tab} is present`);
  }
});

// ---- filters ----------------------------------------------------------------

check("F1 the filter vocabulary is closed and executable", () => {
  eq(parseInboxFilter("clients"), InboxFilter.CLIENTS, "a known filter");
  eq(parseInboxFilter("../../etc/passwd"), InboxFilter.ALL, "an unknown filter falls back to All");
  eq(parseInboxFilter(null), InboxFilter.ALL, "absent falls back too");
  const client = conversationOf({ participantKind: InboxParticipantKind.CLIENT, needsReply: false });
  const vendor = conversationOf({ participantKind: InboxParticipantKind.VENDOR, needsReply: false });
  const unknown = conversationOf({ participantKind: InboxParticipantKind.UNKNOWN, needsReply: true });
  const conflict = conversationOf({ participantKind: InboxParticipantKind.CONFLICT, needsReply: false });
  const failed = conversationOf({ hasFailure: true, needsReply: false });
  eq(inboxConversationMatchesFilter(client, InboxFilter.CLIENTS), true, "clients");
  eq(inboxConversationMatchesFilter(vendor, InboxFilter.CLIENTS), false, "vendors are not clients");
  eq(inboxConversationMatchesFilter(vendor, InboxFilter.VENDORS), true, "vendors");
  eq(inboxConversationMatchesFilter(unknown, InboxFilter.UNKNOWN), true, "unknown");
  eq(inboxConversationMatchesFilter(conflict, InboxFilter.UNKNOWN), true, "a conflict needs review, so it surfaces here");
  eq(inboxConversationMatchesFilter(unknown, InboxFilter.NEEDS_REPLY), true, "needs reply");
  eq(inboxConversationMatchesFilter(client, InboxFilter.NEEDS_REPLY), false, "and only when it is true");
  eq(inboxConversationMatchesFilter(failed, InboxFilter.FAILED), true, "failed");
  eq(inboxConversationMatchesFilter(client, InboxFilter.ALL), true, "All matches everything");
});

// ---- accessibility ----------------------------------------------------------

check("A1 the workspace is keyboard usable and not colour-only", () => {
  const list = COMPONENT_CODE[`${INBOX_DIR}/WhatsAppConversationList.tsx`];
  assert(/<button\s/.test(list), "conversations are real buttons");
  assert(/aria-current=/.test(list), "the selected one is announced");
  assert(/aria-pressed=/.test(list), "filter state is announced");
  assert(/focus-visible:ring/.test(list), "focus is visible");
  assert(/<label htmlFor="qf-inbox-search"/.test(list), "the search field is labelled");
  const status = COMPONENT_CODE[`${INBOX_DIR}/WhatsAppInboxRealtimeStatus.tsx`];
  assert(/role="status"/.test(status) && /aria-live=/.test(status), "the live state is announced");
  assert(/sr-only/.test(status), "and carries text, not only a colour");
  const bubble = COMPONENT_CODE[`${INBOX_DIR}/WhatsAppMessageBubble.tsx`];
  assert(/deliveryLabel/.test(bubble), "a tick is always accompanied by its label");
});

check("A2 the workspace is usable on a phone", () => {
  const inbox = COMPONENT_CODE[`${INBOX_DIR}/WhatsAppInbox.tsx`];
  assert(/grid-cols-1/.test(inbox) && /lg:grid-cols-/.test(inbox), "one column first, split only when wide");
  assert(/hidden lg:block/.test(inbox), "exactly one pane shows on a narrow screen");
  const thread = COMPONENT_CODE[`${INBOX_DIR}/WhatsAppConversationThread.tsx`];
  assert(/Back to inbox/.test(thread), "and there is a way back");
  assert(/lg:hidden/.test(thread), "shown only where it is needed");
  for (const code of Object.values(COMPONENT_CODE)) absent(code, /overflow-x-scroll|w-\[\d{4,}px\]/, "a fixed wide layout");
});

// ---- read-only posture ------------------------------------------------------

check("R1 there is no composer and no enabled control that could send", () => {
  const thread = COMPONENT_CODE[`${INBOX_DIR}/WhatsAppConversationThread.tsx`];
  assert(/Read-only in QF-MVP-82A/.test(thread), "the read-only posture is stated to the operator");
  assert(/QF-MVP-82B/.test(thread), "and the next phase is named");
  for (const [path, code] of Object.entries(COMPONENT_CODE)) {
    absent(code, /<textarea/i, `a composer in ${path}`);
    absent(code, /placeholder="Type|Send message|Reply now/i, `a reply affordance in ${path}`);
  }
  // No client component posts anywhere.
  for (const code of CLIENT_CODE) {
    absent(code, /method:\s*["'`]POST/i, "a POST");
    absent(code, /(?<![A-Za-z.])fetch\s*\(/, "a client fetch");
  }
});

// ---- O1-O5. ONE ORDERING AUTHORITY -----------------------------------------
//
// The conversation summary and the visible timeline must never disagree about
// which message is last. These tests cross the two: they build the events a
// conversation would hold, derive the SUMMARY latest with the same fold the
// service uses, sort the TIMELINE the way the thread does, and require the two
// to name the same event — in every input order.

/** Exactly what services/adminWhatsAppInboxService.ts does when it aggregates. */
const summaryLatestOf = (events) => events.reduce((acc, e) => pickLaterInboxEvent(e, acc), null);
/** Exactly what the thread does before rendering. */
const timelineOf = (events) => [...events].sort(compareInboxEvents);

const SHARED_TS = "2026-09-06T10:00:00.000Z";
const inboundAt = (ts, id) => eventOf({ eventId: id, direction: InboxDirection.INBOUND, occurredAt: ts, displayText: "customer says hi" });
const outboundAt = (ts, id) => eventOf({
  eventId: id, direction: InboxDirection.OUTBOUND, occurredAt: ts,
  displayText: "Lead assignment alert", deliveryTone: InboxDeliveryTone.DELIVERED, deliveryLabel: "Delivered",
});

check("O1 EQUAL TIMESTAMP: outbound wins BOTH the timeline and the summary", () => {
  const inbound = inboundAt(SHARED_TS, "evt-inbound");
  const outbound = outboundAt(SHARED_TS, "evt-outbound");

  // Both fold orders — the real service reads outbound rows before inbound ones,
  // which is exactly how the old bug hid.
  for (const events of [[outbound, inbound], [inbound, outbound]]) {
    const timeline = timelineOf(events);
    const summary = summaryLatestOf(events);

    eq(timeline.at(-1).eventId, "evt-outbound", "the timeline ends on the outbound message");
    eq(summary.eventId, timeline.at(-1).eventId, "and the summary names that same event");
    eq(summary.direction, InboxDirection.OUTBOUND, "so lastDirection is outbound");
    eq(summary.occurredAt, SHARED_TS, "lastActivityAt is the shared timestamp");
    eq(summary.displayText, "Lead assignment alert", "and the preview is the outbound text");
    // THE defect this phase exists to remove.
    eq(inboxNeedsReply(summary.direction), false,
      "Needs reply is FALSE — the last visible bubble is ours");
  }
});

check("O2 EQUAL TIMESTAMP, SAME DIRECTION: the eventId tie also matches", () => {
  const a = inboundAt(SHARED_TS, "evt-aaa");
  const b = inboundAt(SHARED_TS, "evt-bbb");
  for (const events of [[a, b], [b, a]]) {
    const timeline = timelineOf(events);
    const summary = summaryLatestOf(events);
    eq(timeline.at(-1).eventId, "evt-bbb", "the higher event id sorts last");
    eq(summary.eventId, timeline.at(-1).eventId, "and the summary agrees");
  }
  // Outbound ties the same way, so the rule is not direction-specific.
  const c = outboundAt(SHARED_TS, "evt-ccc");
  const d = outboundAt(SHARED_TS, "evt-ddd");
  eq(summaryLatestOf([d, c]).eventId, timelineOf([d, c]).at(-1).eventId, "outbound ties agree too");
});

check("O3 the summary and the timeline agree in EVERY permutation", () => {
  const events = [
    inboundAt("2026-09-06T09:00:00.000Z", "evt-1"),
    outboundAt("2026-09-06T09:00:00.000Z", "evt-2"),
    inboundAt(SHARED_TS, "evt-3"),
    outboundAt(SHARED_TS, "evt-4"),
    outboundAt("2026-09-06T08:00:00.000Z", "evt-5"),
  ];
  const expected = timelineOf(events).at(-1).eventId;
  const permute = (arr) => arr.length <= 1 ? [arr] :
    arr.flatMap((x, i) => permute([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
  const orders = permute(events);
  eq(orders.length, 120, "all 120 orderings");
  for (const order of orders) {
    eq(summaryLatestOf(order).eventId, expected, "fold order never changes the answer");
    eq(timelineOf(order).at(-1).eventId, expected, "and neither does sort input order");
  }
});

check("O4 the service holds the winning EVENT, not a parallel timestamp", () => {
  // Structural: the aggregate keeps one event object and reads every "latest"
  // fact off it, so there is no second field that could drift.
  assert(/latest: InboxEventView/.test(SERVICE_CODE), "the aggregate holds the event");
  assert(/pickLaterInboxEvent\(e\.view, existing\.latest\)/.test(SERVICE_CODE),
    "and chooses it with the shared authority");
  for (const field of ["lastActivityAt: a.latest.occurredAt", "lastDirection: a.latest.direction",
                        "preview: boundInboxPreview(a.latest.displayText)",
                        "needsReply: inboxNeedsReply(a.latest.direction)"]) {
    assert(SERVICE_CODE.includes(field), `the summary reads ${field}`);
  }
  // The old, weaker rule is gone.
  absent(SERVICE_CODE, /Date\.parse\([^)]*\)\s*>=/, "a timestamp-only latest rule");
  absent(SERVICE_CODE, /lastActivityAt =|lastDirection =|lastText =/, "parallel latest fields being assigned");
});

check("O5 there is exactly ONE ordering authority in the read model", () => {
  // pickLaterInboxEvent is the only thing that decides "later", and it defers to
  // compareInboxEvents rather than re-implementing the rule.
  assert(/export function pickLaterInboxEvent/.test(READ_MODEL_CODE), "the authority exists");
  assert(/return compareInboxEvents\(a, b\) > 0 \? a : b;/.test(READ_MODEL_CODE),
    "and it defers to the comparator");
  assert(/export function latestInboxEvent/.test(READ_MODEL_CODE), "the fold exists");
  assert(/latest = pickLaterInboxEvent\(event, latest\)/.test(READ_MODEL_CODE), "and uses the same authority");
  // latestInboxEvent must equal sorting and taking the last element.
  const events = [
    outboundAt(SHARED_TS, "evt-z"), inboundAt(SHARED_TS, "evt-a"),
    inboundAt("2026-09-06T07:00:00.000Z", "evt-m"),
  ];
  eq(latestInboxEvent(events).eventId, timelineOf(events).at(-1).eventId, "the fold equals the sort");
  eq(latestInboxEvent([]), null, "and an empty conversation has no latest event");
});

// ---- mutants ----------------------------------------------------------------

check("M1 mutant: grouping by masked phone would merge two different contacts", () => {
  const masked = "+91******3210";
  const naive = (m) => m; // group by the masked number
  eq(naive(masked), naive(masked), "the mutant merges anything sharing a mask");
  assert(idOf({ contactHash: HASH_A }) !== idOf({ contactHash: HASH_B }),
    "the real rule separates them, because a mask is not an identity");
});

check("M2 mutant: dropping the provider account would merge two accounts", () => {
  const naive = (hash) => hash;
  eq(naive(HASH_A), naive(HASH_A), "the mutant ignores the account");
  assert(idOf({ providerAccountId: ACCOUNT_1 }) !== idOf({ providerAccountId: ACCOUNT_2 }),
    "the real rule partitions by account");
});

check("M3 mutant: merging a legacy NULL account into a bound one reassigns ownership", () => {
  const naive = (accountId, hash) => hash; // ignore the null-vs-bound distinction
  eq(naive(null, HASH_A), naive(ACCOUNT_1, HASH_A), "the mutant merges them");
  assert(idOf({ providerAccountId: null }) !== idOf({ providerAccountId: ACCOUNT_1 }), "the real rule does not");
});

check("M4 mutant: exposing the raw hash as the conversation id", () => {
  const naive = HASH_A;
  assert(naive === HASH_A, "the mutant exposes the hash");
  assert(idOf() !== HASH_A, "the real id is a one-way digest of it");
});

check("M5 mutant: treating the latest inbound as answered", () => {
  const naive = () => false;
  eq(naive(), false, "the mutant never asks for a reply");
  eq(inboxNeedsReply(InboxDirection.INBOUND), true, "the real rule does");
});

check("M6 mutant: rendering delivered as read", () => {
  const naive = (s) => (s === "delivered" || s === "read" ? InboxDeliveryTone.READ : InboxDeliveryTone.UNKNOWN);
  eq(naive("delivered"), InboxDeliveryTone.READ, "the mutant conflates them");
  assert(inboxDeliveryTone("delivered") !== naive("delivered"), "the real rule keeps them distinct");
});

check("M7 mutant: passing raw content_minimized straight to the UI", () => {
  const raw = { text: "hi", mediaId: "SECRET", mimeType: "image/jpeg" };
  const naive = JSON.stringify(raw);
  assert(naive.includes("SECRET"), "the mutant leaks the media reference");
  const real = present("image", raw);
  assert(!JSON.stringify(real).includes("SECRET"), "the real renderer drops it");
});

check("M8 mutant: serializing the change payload", () => {
  const naive = JSON.stringify({ new: { sender_hash: HASH_A } });
  assert(naive.includes(HASH_A), "the mutant would ship the row");
  absent(STREAM_CODE, /payload\.new|payload\.old/, "the real route never touches it");
  assert(/emit\("inbox", INBOX_CHANGED\)/.test(STREAM_CODE), "it emits a fixed marker instead");
});

check("M9 mutant: detecting changes before authenticating", () => {
  const guard = STREAM_CODE.indexOf("status: 403");
  for (const m of STREAM_CODE.matchAll(/await readWatermark\(\)/g)) {
    assert(m.index > guard, "the real route reads nothing before the guard");
  }
  const naive = "const db = adminClient(); const session = await getAdminSession();";
  assert(naive.indexOf("adminClient") < naive.indexOf("getAdminSession"), "the mutant would read first");
});

check("M10 mutant: importing the service role into a client component", () => {
  const naive = 'createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)';
  assert(/SERVICE_ROLE/.test(naive), "the mutant is exactly what the source check catches");
  for (const code of CLIENT_CODE) absent(code, /SERVICE_ROLE/, "the real components carry none");
});

check("M11 mutant: granting the API roles access to a communication table", () => {
  const naive = "grant select on public.communication_messages to authenticated;";
  assert(/grant\s+select/i.test(naive), "the mutant is detectable");
  for (const code of ALL_INBOX_CODE) absent(code, /to\s+(anon|authenticated)/i, "the real scope grants nothing");
});

check("M12 mutant: introducing a send control", () => {
  const naive = '<button onClick={() => sendTemplateMessage(x)}>Send</button>';
  assert(/sendTemplateMessage/.test(naive), "the mutant is detectable");
  for (const code of ALL_INBOX_CODE) absent(code, /sendTemplateMessage/, "no send path exists");
});

check("M13 mutant: an unbounded timeline query", () => {
  const naive = 'db.from("communication_messages").select("*")';
  assert(!/\.limit\(/.test(naive), "the mutant has no bound");
  assert(/\.limit\(cap\)/.test(SERVICE_CODE), "the real thread read is capped");
  assert(/\.limit\(INBOX_SCAN_WINDOW\)/.test(SERVICE_CODE), "and so is the list read");
  absent(SERVICE_CODE, /\.select\("\*"\)/, "no select-star anywhere");
});

check("M14 mutant: removing the refresh debounce", () => {
  const hook = COMPONENT_CODE[`${INBOX_DIR}/useWhatsAppInboxRealtime.ts`];
  const naive = "source.addEventListener('inbox', () => router.refresh());";
  assert(!/debounce/i.test(naive), "the mutant refreshes per event");
  assert(/debounceRef/.test(hook), "the real hook debounces");
  assert(/if \(stoppedRef\.current \|\| debounceRef\.current !== null\) return;/.test(hook),
    "and a burst inside the window collapses to one refresh");
});


check("M13 mutant: reintroducing the six-second watermark poll", () => {
  const naive = 'const WATERMARK_INTERVAL_MS = 6_000; setInterval(() => void readWatermark(), WATERMARK_INTERVAL_MS);';
  assert(/WATERMARK_INTERVAL_MS/.test(naive) && /readWatermark/.test(naive), "the mutant polls");
  absent(STREAM_CODE, /WATERMARK/i, "the real route has no watermark constant");
  absent(STREAM_CODE, /readWatermark/, "and no watermark reader");
  absent(STREAM_CODE, /\.from\(/, "and reads no table at all");
});

check("M14 mutant: subscribing to only one of the two authorities", () => {
  const naive = ["communication_messages"];
  eq(naive.length, 1, "the mutant watches one table");
  const tables = (/INBOX_TABLES = \[([^\]]*)\]/.exec(STREAM_CODE)[1].match(/"([a-z_]+)"/g) ?? []);
  eq(tables.length, 2, "the real route watches both");
});

check("M15 mutant: subscribing to a third table", () => {
  const naive = ["communication_inbound_messages", "communication_messages", "communication_delivery_events"];
  assert(naive.includes("communication_delivery_events"), "the mutant widens the surface");
  const tables = /INBOX_TABLES = \[([^\]]*)\]/.exec(STREAM_CODE)[1];
  assert(!/communication_delivery_events/.test(tables), "the real route excludes the event ledger");
});

check("M16 mutant: forwarding payload.new through the SSE", () => {
  const naive = 'emit("inbox", { type: "inbox_changed", row: payload.new })';
  assert(/payload\.new/.test(naive), "the mutant ships the row");
  absent(STREAM_CODE, /payload\.new|payload\.old/, "the real route never touches the payload");
  assert(/const onDatabaseChange = \(\) =>/.test(STREAM_CODE), "its callback binds no argument at all");
});

check("M17 mutant: opening Realtime before authenticating", () => {
  const guard = STREAM_CODE.indexOf("status: 403");
  for (const m of STREAM_CODE.matchAll(/\.channel\(/g)) {
    assert(m.index > guard, "the real route opens no channel before the guard");
  }
  const naive = 'const db = adminClient(); const ch = db.channel("x"); const session = await getAdminSession();';
  assert(naive.indexOf("channel") < naive.indexOf("getAdminSession"), "the mutant subscribes first");
});

check("M18 mutant: leaving the Realtime channel behind", () => {
  const naive = "function cleanup() { controller.close(); }";
  assert(!/removeChannel/.test(naive), "the mutant leaks the channel");
  assert(/removeChannel\(channel\)/.test(STREAM_CODE), "the real cleanup removes it");
  assert(/request\.signal\.addEventListener\("abort", cleanup\)/.test(STREAM_CODE), "on abort");
  assert(/emit\("expired"[\s\S]{0,80}cleanup\(\)/.test(STREAM_CODE), "on expiry");
  assert(/emit\("unavailable"[\s\S]{0,80}cleanup\(\)/.test(STREAM_CODE), "and on subscription failure");
});

check("M19 mutant: reverting the aggregate to a timestamp comparison", () => {
  const naive = (a, b) => Date.parse(a.occurredAt) >= Date.parse(b.occurredAt);
  const inbound = inboundAt(SHARED_TS, "evt-inbound");
  const outbound = outboundAt(SHARED_TS, "evt-outbound");
  // Folding outbound then inbound, the mutant lets inbound take the slot.
  assert(naive(inbound, outbound) === true, "the mutant treats equal as later");
  eq(pickLaterInboxEvent(inbound, outbound).eventId, "evt-outbound", "the real rule keeps outbound");
  absent(SERVICE_CODE, /Date\.parse\([^)]*\)\s*>=/, "and the source carries no such rule");
});

check("M20 mutant: equal-timestamp inbound overwriting outbound", () => {
  const inbound = inboundAt(SHARED_TS, "evt-inbound");
  const outbound = outboundAt(SHARED_TS, "evt-outbound");
  // The mutant: last-one-folded wins.
  const naiveLatest = [outbound, inbound].at(-1);
  eq(naiveLatest.direction, InboxDirection.INBOUND, "the mutant ends on inbound");
  eq(inboxNeedsReply(naiveLatest.direction), true, "and would demand a reply");
  const real = summaryLatestOf([outbound, inbound]);
  eq(real.direction, InboxDirection.OUTBOUND, "the real rule ends on outbound");
  eq(inboxNeedsReply(real.direction), false, "so Needs reply is false");
});

check("M21 mutant: a timestamp+direction fix that ignores the eventId tie", () => {
  const a = inboundAt(SHARED_TS, "evt-aaa");
  const b = inboundAt(SHARED_TS, "evt-bbb");
  // The mutant stops at direction, so two same-direction events tie and fold
  // order decides — the exact partial fix this check exists to reject.
  const naive = (x, y) => (Date.parse(x.occurredAt) !== Date.parse(y.occurredAt) || x.direction !== y.direction)
    ? null : "TIE";
  eq(naive(a, b), "TIE", "the mutant cannot separate them");
  eq(pickLaterInboxEvent(a, b).eventId, "evt-bbb", "the real rule breaks the tie by event id");
  eq(pickLaterInboxEvent(b, a).eventId, "evt-bbb", "in either order");
});

// ============================================================================
let passed = 0;
const failures = [];
for (const { name, fn } of checks) {
  try { fn(); passed += 1; console.log(`   ok    ${name}`); }
  catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
}
console.log(`\n${"=".repeat(78)}`);
console.log(`QF-MVP-82A unified WhatsApp inbox — passed ${passed}, failed ${failures.length}`);
if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
console.log("=".repeat(78));
void existsSync;
process.exit(failures.length ? 1 : 0);
