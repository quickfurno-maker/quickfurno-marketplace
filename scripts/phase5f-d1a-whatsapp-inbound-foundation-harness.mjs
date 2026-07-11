import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5F-D1-A — WhatsApp inbound data foundation + pure normalizer + fail-safe identity.
 *
 * Foundation only: the live webhook is FROZEN (INBOUND_MESSAGE stays ignored/acknowledged),
 * nothing here is wired into it, no SMS/consent/event/send occurs, and the migration is
 * prepared but NOT applied. The pure normalizer is exercised directly; the identity resolver
 * is transpiled with a stubbed Supabase and driven by injected candidate finders.
 *
 * Mutation tests edit the REAL source (or the migration), recompile, and assert the
 * vulnerability appears, restoring every file byte-identically afterwards.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const TS_FILES = [
  "lib/errors.ts",
  "lib/communication/phone.ts",
  "lib/communication/providers/metaWhatsAppInbound.ts",
];

function compileTo(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  const tsconfigPath = resolve(`${outDir}.tsconfig.json`);
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          module: "commonjs", target: "ES2020", moduleResolution: "node",
          skipLibCheck: true, esModuleInterop: true, strict: true, jsx: "preserve",
          outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] }, lib: ["ES2021", "DOM"],
        },
        files: TS_FILES,
      },
      null,
      2
    )
  );
  try {
    execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" });
  } finally {
    rmSync(tsconfigPath, { force: true });
  }
  return outDir;
}

const NORMALIZER_SRC = "lib/communication/providers/metaWhatsAppInbound.ts";
const RESOLVER_SRC = "services/inboundIdentityResolutionService.ts";
const WEBHOOK_SVC_SRC = "services/metaWhatsAppWebhookService.ts";
const WEBHOOK_ROUTE_SRC = "app/api/webhooks/whatsapp/meta/route.ts";
const COMM_SERVICE_SRC = "services/communicationService.ts";
const MIGRATION_SRC = "supabase/migrations/20260711000100_whatsapp_inbound_message_foundation.sql";
const DOC_D1A = "docs/QF-WhatsApp-Inbound-Foundation-Phase-5F-D1-A.md";

/** Transpile the identity resolver ALONE; its Supabase import is satisfied by a require() stub. */
function transpileResolver(outDir) {
  const tsconfigPath = resolve(`${outDir}.resolver.tsconfig.json`);
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          module: "commonjs", target: "ES2020", moduleResolution: "node",
          skipLibCheck: true, esModuleInterop: true, strict: false, isolatedModules: true,
          outDir, rootDir: ".", types: [], noResolve: true,
        },
        files: [RESOLVER_SRC],
      },
      null,
      2
    )
  );
  try {
    execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" });
  } catch {
    /* expected: noResolve diagnostics. Emit still happened. */
  } finally {
    rmSync(tsconfigPath, { force: true });
  }
  if (!existsSync(resolve(outDir, "services/inboundIdentityResolutionService.js"))) {
    throw new Error("the identity resolver did not transpile");
  }
}

function stubSupabase(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "../lib/supabase") {
      return { adminClient: () => { throw new Error("real Supabase must never run in the D1-A harness"); } };
    }
    return original.apply(this, [request, parent, isMain]);
  };
  return req;
}

function wireBuild(outDir) {
  const req = stubSupabase(outDir);
  return {
    Inbound: req("./lib/communication/providers/metaWhatsAppInbound.js"),
    Resolver: req("./services/inboundIdentityResolutionService.js"),
    Phone: req("./lib/communication/phone.js"),
  };
}

const readF = (f) => readFileSync(f, "utf8");
/** SQL with `-- ...` comments stripped, for column/constraint assertions on the real DDL. */
const readSqlCode = (f) => readF(f).replace(/--[^\n]*/g, "");
const readCode = (p) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }

// ============================================================================
// REGISTRY
// ============================================================================
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const MAIN_DIR = resolve(".phase5fd1a-build-main");
compileTo(MAIN_DIR);
transpileResolver(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// FIXTURES — obviously fake wa_ids and numbers
// ============================================================================
const WA_ID = "919812345678";            // digits only, as Meta delivers `from`
const E164 = "+919812345678";
const PHONE_NUMBER_ID = "111222333444";  // the BUSINESS number id (not the sender)
const WAMID = "wamid.HBgMOTE5ABC123DEF456";

const HASH = () => M.Phone.hashPhoneE164(E164);
const MASK = () => M.Phone.maskPhoneE164(E164);

function envelope(...messages) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA_ID",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550000000", phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: "Priya Sharma" }, wa_id: WA_ID }],
          messages,
        },
      }],
    }],
  };
}
const textMsg = (over = {}) => ({ from: WA_ID, id: WAMID, timestamp: "1700000000", type: "text", text: { body: "Hello there" }, ...over });

const normalize = (payload) => M.Inbound.normalizeMetaInboundWebhook(payload);

// ============================================================================
// NORMALIZATION (1-20)
// ============================================================================
check("1. one valid text message normalizes", () => {
  const r = normalize(envelope(textMsg()));
  assert(r.length === 1 && r[0].ok === true, "one ok result");
  assert(r[0].message.messageType === "text" && r[0].message.contentMinimized.text === "Hello there", "text minimized");
});

check("2. multiple messages in one webhook normalize independently", () => {
  const r = normalize(envelope(
    textMsg({ id: "wamid.A" }),
    textMsg({ id: "wamid.B", type: "reaction", reaction: { message_id: "wamid.A", emoji: "👍" }, text: undefined }),
  ));
  assert(r.length === 2 && r[0].ok && r[1].ok, "two independent results");
  assert(r[0].message.providerMessageId === "wamid.A" && r[1].message.providerMessageId === "wamid.B", "distinct ids");
  assert(r[0].message.messageType === "text" && r[1].message.messageType === "reaction", "distinct types");
});

check("3. the exact provider message id is preserved", () => {
  const r = normalize(envelope(textMsg({ id: WAMID })));
  assert(r[0].ok && r[0].message.providerMessageId === WAMID, "wamid preserved verbatim");
});

check("4-5. a missing provider message id fails safely and is never fabricated", () => {
  const r = normalize(envelope(textMsg({ id: undefined })));
  assert(r.length === 1 && r[0].ok === false && r[0].reason === "MISSING_MESSAGE_ID", "rejected");
  assert(r[0].providerMessageId === null, "no id present");
  // No fabricated id derives from phone/text/timestamp.
  assert(!safeStringify(r[0]).includes(WA_ID) && !safeStringify(r[0]).includes("1700000000"), "no fabricated id from phone/timestamp");
});

check("6-9. sender canonicalizes; hash is sha256(canonical E.164); masked uses the helper", () => {
  const r = normalize(envelope(textMsg()));
  assert(r[0].ok && r[0].senderPhoneE164 === E164, "canonical E.164 (request-memory sibling)");
  assert(r[0].message.senderHash === HASH() && /^[0-9a-f]{64}$/.test(r[0].message.senderHash), "sha256 of canonical E.164");
  assert(r[0].message.senderMasked === MASK(), "masked via the canonical helper");
});

check("7. a malformed sender fails safely, without surfacing the plaintext value", () => {
  const bad = normalize(envelope(textMsg({ from: "not-a-number" })));
  assert(bad[0].ok === false && bad[0].reason === "SENDER_NOT_NORMALIZABLE", "rejected");
  assert(bad[0].providerMessageId === WAMID, "the id is kept for idempotency");
  assert(!safeStringify(bad[0]).includes("not-a-number"), "the malformed plaintext value never surfaces");
});

check("10. text content is minimized (only the body)", () => {
  const r = normalize(envelope(textMsg({ text: { body: "STOP please" } })));
  assert(safeStringify(r[0].message.contentMinimized) === JSON.stringify({ text: "STOP please" }), "only the text body");
});

check("11. button reply is minimized to a provider-neutral id + title", () => {
  const r = normalize(envelope({ from: WA_ID, id: WAMID, timestamp: "1700000000", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "opt_yes", title: "Yes" } } }));
  assert(r[0].message.messageType === "button_reply", "button_reply");
  assert(r[0].message.contentMinimized.replyId === "opt_yes" && r[0].message.contentMinimized.title === "Yes", "id+title");
});

check("12. list reply is minimized to id + title + optional description", () => {
  const r = normalize(envelope({ from: WA_ID, id: WAMID, timestamp: "1700000000", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "row_1", title: "Kitchen", description: "Modular kitchen" } } }));
  assert(r[0].message.messageType === "list_reply", "list_reply");
  const c = r[0].message.contentMinimized;
  assert(c.replyId === "row_1" && c.title === "Kitchen" && c.description === "Modular kitchen", "id+title+description");
});

check("13-15. media is minimized to safe operational references only", () => {
  const img = normalize(envelope({ from: WA_ID, id: WAMID, timestamp: "1700000000", type: "image", image: { id: "media-1", mime_type: "image/jpeg", sha256: "deadbeef", caption: "photo" } }));
  assert(img[0].message.messageType === "image" && img[0].message.contentMinimized.mediaId === "media-1" && img[0].message.contentMinimized.mimeType === "image/jpeg", "image mediaId+mime");
  assert(img[0].message.contentMinimized.caption === "photo" && img[0].message.contentMinimized.sha256 === undefined, "caption kept, provider sha256 dropped");
  const doc = normalize(envelope({ from: WA_ID, id: WAMID, timestamp: "1700000000", type: "document", document: { id: "media-2", mime_type: "application/pdf", filename: "quote.pdf" } }));
  assert(doc[0].message.contentMinimized.mediaId === "media-2" && doc[0].message.contentMinimized.filename === "quote.pdf", "document mediaId+filename");
  const aud = normalize(envelope({ from: WA_ID, id: WAMID, timestamp: "1700000000", type: "audio", audio: { id: "media-3", mime_type: "audio/ogg" } }));
  assert(aud[0].message.messageType === "audio" && aud[0].message.contentMinimized.mediaId === "media-3", "audio mediaId");
  const vid = normalize(envelope({ from: WA_ID, id: WAMID, timestamp: "1700000000", type: "video", video: { id: "media-4", mime_type: "video/mp4", caption: "clip" } }));
  assert(vid[0].message.messageType === "video" && vid[0].message.contentMinimized.mediaId === "media-4" && vid[0].message.contentMinimized.caption === "clip", "video mediaId+caption");
});

check("16. location is minimized CONSERVATIVELY (no coordinates)", () => {
  const r = normalize(envelope({ from: WA_ID, id: WAMID, timestamp: "1700000000", type: "location", location: { latitude: 19.07, longitude: 72.87, name: "Home", address: "12 MG Rd" } }));
  assert(r[0].message.messageType === "location", "location");
  assert(safeStringify(r[0].message.contentMinimized) === JSON.stringify({ received: true }), "only a presence marker — no lat/long/name/address");
});

check("17. contact is minimized CONSERVATIVELY (no cards)", () => {
  const r = normalize(envelope({ from: WA_ID, id: WAMID, timestamp: "1700000000", type: "contacts", contacts: [{ name: { formatted_name: "Someone" }, phones: [{ phone: "+911111111111" }] }] }));
  assert(r[0].message.messageType === "contact" && r[0].message.contentMinimized.received === true && r[0].message.contentMinimized.count === 1, "presence + count only");
  assert(!safeStringify(r[0]).includes("Someone") && !safeStringify(r[0]).includes("1111111111"), "no names/numbers from the card");
});

check("18. reaction is minimized to emoji + target message id", () => {
  const r = normalize(envelope({ from: WA_ID, id: WAMID, timestamp: "1700000000", type: "reaction", reaction: { message_id: "wamid.TARGET", emoji: "❤️" } }));
  assert(r[0].message.messageType === "reaction" && r[0].message.contentMinimized.emoji === "❤️" && r[0].message.contentMinimized.targetMessageId === "wamid.TARGET", "emoji+target");
});

check("19. an unsupported message stays safely classified", () => {
  const sticker = normalize(envelope({ from: WA_ID, id: WAMID, timestamp: "1700000000", type: "sticker", sticker: { id: "s1" } }));
  assert(sticker[0].message.messageType === "unsupported" && sticker[0].message.contentMinimized.providerType === "sticker", "sticker → unsupported/providerType");
  const weird = normalize(envelope({ from: WA_ID, id: WAMID, timestamp: "1700000000", type: "NOT AN IDENTIFIER!!", x: 1 }));
  assert(weird[0].message.messageType === "unsupported" && weird[0].message.contentMinimized.providerType === undefined, "an unsafe type string is not stored");
});

check("20. the raw provider payload is never returned in the PERSISTABLE message", () => {
  const r = normalize(envelope(textMsg()));
  // The persistable `message` object (never the request-memory sibling) must carry no raw payload.
  const rendered = safeStringify(r[0].message);
  assert(!rendered.includes(WA_ID), "the raw wa_id / sender digits never appear in the persistable message");
  assert(!rendered.includes("Priya Sharma") && !rendered.includes("messaging_product"), "no contacts/profile object, no raw envelope");
  // Only the safe business phone_number_id appears (never the sender).
  assert(r[0].message.providerContext.phoneNumberId === PHONE_NUMBER_ID, "safe non-sender correlation id only");
  // The plaintext phone lives ONLY on the documented request-memory sibling.
  assert(r[0].senderPhoneE164 === E164, "the plaintext phone lives only on the request-memory sibling");
});

// ============================================================================
// PURITY + SECRECY (21-28) — static on the normalizer source
// ============================================================================
check("21-28. the normalizer is pure and secret-free", () => {
  const src = readF(NORMALIZER_SRC);
  const code = readCode(NORMALIZER_SRC);
  assert(!/adminClient|from\(["']|\.rpc\(|createClient|supabase/i.test(code), "no DB access"); // 21
  assert(!/process\.env|process\[/.test(code), "no env access"); // 22
  assert(!/fetch\(|https?:|XMLHttpRequest|require\(["']node:|net\.|dns\./.test(code), "no network"); // 23
  assert(!/console\./.test(code), "no console/logging"); // 24
  assert(!/appSecret|app_secret|access_?token|\bsignature\b|Authorization|Bearer/i.test(code), "no signature/secret/token references"); // 25
  assert(!/communication_preferences|communication_suppressions|consent|opt_out/i.test(code), "no consent mutation"); // 26
  assert(!/sendResolvedAuthenticationSms|sendAuthenticationMessage|\.send\(|CommunicationService/.test(code), "no send call"); // 27
  assert(!/domain_events|outbox_events|emitEvent|dispatchEvent|n8n/i.test(code), "no event emission"); // 28
  // No clock/randomness source (a provider TIMESTAMP conversion via `new Date(provided)` is fine).
  assert(!/Date\.now|performance\.now|hrtime|Math\.random|randomBytes|randomUUID/.test(code), "no clock/randomness source");
  // The only import is the canonical phone helper — normalization is never re-implemented.
  assert(/from "\.\.\/phone"/.test(src) && !/normaliz.*replace|new RegExp/.test(code), "reuses the canonical phone helper only");
});

// ============================================================================
// IDENTITY (29-40) — pure resolution via injected candidate finders
// ============================================================================
const clientCand = (id = "client-1") => ({ principalType: "client", principalId: id });
const vendorCand = (id) => ({ principalType: "vendor", principalId: id });
function idDeps(over = {}) {
  return {
    findClientCandidates: over.findClientCandidates ?? (async () => over.clients ?? []),
    findVendorCandidates: over.findVendorCandidates ?? (async () => over.vendors ?? []),
    findAdminCandidates: over.findAdminCandidates ?? (async () => over.admins ?? []),
  };
}
// Phase 5F-D1-B: the resolver returns a discriminated OUTCOME. A SUCCESSFUL lookup (ok:true)
// carries a durable identity; these behavioural checks all use successful lookups, so unwrap
// `.identity` here. The operational IDENTITY_LOOKUP_FAILED case is exercised in check 41.
const resolve1 = async (over, phone = E164) => {
  const out = await M.Resolver.resolveInboundSenderIdentity({ senderPhoneE164: phone }, idDeps(over));
  assert(out.ok === true, `resolution succeeded (got ${safeStringify(out)})`);
  return out.identity;
};

check("29. one client candidate → EXACT", async () => {
  const r = await resolve1({ clients: [clientCand("client-1")] });
  assert(r.confidence === "exact" && r.principalType === "client" && r.principalId === "client-1" && r.candidateCount === 1, `got ${safeStringify(r)}`);
});
check("30. one vendor candidate → EXACT", async () => {
  const r = await resolve1({ vendors: [vendorCand("vendor-1")] });
  assert(r.confidence === "exact" && r.principalType === "vendor" && r.principalId === "vendor-1", `got ${safeStringify(r)}`);
});
check("31. no candidate → UNKNOWN", async () => {
  const r = await resolve1({});
  assert(r.confidence === "unknown" && r.principalId === null && r.candidateCount === 0, `got ${safeStringify(r)}`);
});
check("32. two vendors → AMBIGUOUS", async () => {
  const r = await resolve1({ vendors: [vendorCand("vendor-1"), vendorCand("vendor-2")] });
  assert(r.confidence === "ambiguous" && r.principalId === null && r.candidateCount === 2, `got ${safeStringify(r)}`);
});
check("33. client + vendor cross-type conflict → AMBIGUOUS", async () => {
  const r = await resolve1({ clients: [clientCand("client-1")], vendors: [vendorCand("vendor-1")] });
  assert(r.confidence === "ambiguous" && r.principalType === null && r.principalId === null, `got ${safeStringify(r)}`);
});
check("34-35. ambiguous and unknown results carry no principal id", async () => {
  assert((await resolve1({ vendors: [vendorCand("a"), vendorCand("b")] })).principalId === null, "ambiguous → null");
  assert((await resolve1({})).principalId === null, "unknown → null");
});
check("36. an exact result carries exactly one principal", async () => {
  const r = await resolve1({ clients: [clientCand("only")] });
  assert(r.confidence === "exact" && r.principalId === "only" && r.candidateCount === 1, "exactly one");
});
check("37. no first-row-win: duplicate provable rows of the SAME principal dedupe to EXACT", async () => {
  // The same vendor returned twice (e.g. two rows) is ONE provable principal → EXACT, not ambiguous.
  const r = await resolve1({ vendors: [vendorCand("vendor-1"), vendorCand("vendor-1")] });
  assert(r.confidence === "exact" && r.principalId === "vendor-1", `dedupe by identity → ${safeStringify(r)}`);
  // But two DISTINCT vendors are never collapsed to the first.
  const r2 = await resolve1({ vendors: [vendorCand("v1"), vendorCand("v2")] });
  assert(r2.confidence === "ambiguous", "distinct principals are never first-row-won");
});
check("38. no arbitrary client-over-vendor priority", async () => {
  const r = await resolve1({ clients: [clientCand("c")], vendors: [vendorCand("v")] });
  assert(r.confidence === "ambiguous", "a client is never silently preferred over a vendor");
});
check("39. a lead phone match is not a candidate source (no authenticated client from a lead)", () => {
  const code = readCode(RESOLVER_SRC);
  assert(!/\bfrom\(["']leads["']\)|\.from\("leads"\)|leads\b/.test(code) || !/findLeadCandidates/.test(code), "the resolver never queries leads as a principal source");
  assert(!/leads/i.test(readCode(RESOLVER_SRC).replace(/\/\/.*/g, "")), "no lead table is a candidate source");
});
check("40. a malformed sender phone → UNKNOWN, no principal", async () => {
  for (const bad of ["not-a-phone", "12", "", "0091"]) {
    const r = await resolve1({ clients: [clientCand("c")] }, bad);
    assert(r.confidence === "unknown" && r.principalId === null, `${bad} → ${r.confidence}`);
  }
});

check("ID-FAIL. a candidate-source read failure → IDENTITY_LOOKUP_FAILED, never durable UNKNOWN", async () => {
  for (const finder of ["findClientCandidates", "findVendorCandidates", "findAdminCandidates"]) {
    const out = await M.Resolver.resolveInboundSenderIdentity({ senderPhoneE164: E164 }, idDeps({ [finder]: async () => { throw new Error("db unavailable: connection reset by peer"); } }));
    assert(out.ok === false && out.code === "IDENTITY_LOOKUP_FAILED", `${finder} throw → ${safeStringify(out)}`);
    assert(!safeStringify(out).includes("db unavailable") && !safeStringify(out).includes("connection reset"), "no raw DB error is exposed");
  }
  // A SUCCESSFUL zero-candidate lookup remains a durable UNKNOWN (ok:true) — the distinction is explicit.
  const zero = await M.Resolver.resolveInboundSenderIdentity({ senderPhoneE164: E164 }, idDeps({}));
  assert(zero.ok === true && zero.identity.confidence === "unknown", "zero candidates → durable UNKNOWN");
});

// ============================================================================
// SCHEMA STATIC CHECKS (41-54) — on the prepared migration DDL
// ============================================================================
check("41-54. the migration is additive, private, idempotent, and mutation-free", () => {
  const sql = readSqlCode(MIGRATION_SRC);
  assert(/create table if not exists public\.communication_inbound_messages/.test(sql), "creates the inbound table");
  // 41-44 additive only: no ALTER on an existing table, no DROP, no TRUNCATE, no outbound change.
  assert(!/alter table\s+public\.(communication_messages|communication_webhook_receipts|communication_preferences|communication_suppressions|domain_events|outbox_events)/i.test(sql), "no ALTER of an existing table"); // 44
  assert(!/drop\s+table/i.test(sql), "no DROP TABLE"); // 42
  assert(!/truncate/i.test(sql), "no TRUNCATE"); // 43
  const alters = sql.match(/alter table/gi) ?? [];
  assert(alters.length === 1, "the only ALTER is `enable row level security` on the new table"); // 41 additive
  // 45 idempotency, 48 no plaintext sender, 49 sender_hash constraint.
  assert(/create unique index[^;]*uq_comm_inbound_provider_message[\s\S]*?\(\s*provider\s*,\s*provider_message_id\s*\)/.test(sql), "unique(provider, provider_message_id)"); // 45
  assert(!/\b(phone_e164|wa_id|msisdn|sender_phone|phone_number)\b\s+text/i.test(sql), "no plaintext sender-phone column"); // 48
  assert(/sender_hash\s+text\s+not null\s+check\s*\(\s*sender_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'\s*\)/.test(sql), "sender_hash NOT NULL + sha256-hex CHECK"); // 49
  // 46-47 RLS + no browser policy.
  assert(/enable row level security/i.test(sql), "RLS enabled"); // 46
  assert(!/create policy/i.test(sql), "no browser RLS policy"); // 47
  // 50-51 service-role-only grants, no DELETE.
  assert(/grant select, insert, update on public\.communication_inbound_messages to service_role/.test(sql), "service-role select/insert/update only"); // 50
  assert(!/grant[^;]*\b(delete|truncate)\b/i.test(sql), "no DELETE/TRUNCATE grant"); // 51
  assert(!/grant[^;]*to\s+(anon|authenticated)/i.test(sql), "no anon/authenticated grant");
  // 52-54 no trigger that sends / mutates consent / calls n8n.
  assert(!/create trigger|create or replace function/i.test(sql), "no trigger/function"); // 52
  assert(!/communication_preferences|communication_suppressions|consent/i.test(sql), "no consent reference"); // 53
  assert(!/domain_events|outbox_events|n8n|http|net\./i.test(sql), "no event/n8n/network reference"); // 54
  // The receipt FK is ON DELETE SET NULL (history outlives a receipt).
  assert(/webhook_receipt_id\s+uuid\s+references public\.communication_webhook_receipts\(id\)\s+on delete set null/.test(sql), "receipt FK = ON DELETE SET NULL");
});

// ============================================================================
// SCHEMA INTEGRITY (D1-A hardening) — NOT NULL idempotency authority + COMPLETE identity
// ============================================================================
check("I1. provider + provider_message_id are NOT NULL and uniquely fenced", () => {
  const sql = readSqlCode(MIGRATION_SRC);
  // A NULL provider or provider_message_id must never be persistable (the idempotency authority).
  assert(/\bprovider\s+text\s+not null/i.test(sql), "provider is NOT NULL"); // 1
  assert(/\bprovider_message_id\s+text\s+not null/i.test(sql), "provider_message_id is NOT NULL"); // 2
  assert(/create unique index[^;]*uq_comm_inbound_provider_message[\s\S]*?\(\s*provider\s*,\s*provider_message_id\s*\)/i.test(sql), "unique(provider, provider_message_id)"); // 3
  // The id is a raw provider value: its column carries NO DB-side default/derivation, so it is
  // never fabricated from phone/text/payload-hash/timestamp/sender-hash/receipt-id at the DB level.
  assert(!/provider_message_id\s+text[^,\n]*\b(default|generated|coalesce|md5|concat)\b/i.test(sql), "provider_message_id has no DB-side default/derivation");
});

check("I2. the COMPLETE identity invariant is enforced by a stable CHECK (both branches)", () => {
  const sql = readSqlCode(MIGRATION_SRC);
  const c = sql.replace(/\s+/g, " ");
  assert(/constraint chk_comm_inbound_identity_confidence_principal/i.test(sql), "a stable, descriptive CHECK holds the invariant");
  // EXACT ⟺ BOTH principal fields present (forbids exact+null-type, exact+null-id, exact+both-null,
  // and — via the two-branch shape — any partially-populated pair). Covers tests 4,5,6,11.
  assert(/identity_confidence = 'exact' and resolved_principal_type is not null and resolved_principal_id is not null/i.test(c),
    "exact requires BOTH principal type AND id (complete pair)");
  // AMBIGUOUS/UNKNOWN ⟹ BOTH principal fields NULL. Covers tests 7,8,9,10.
  assert(/identity_confidence in \('ambiguous', 'unknown'\) and resolved_principal_type is null and resolved_principal_id is null/i.test(c),
    "ambiguous/unknown forbid BOTH principal fields");
});

// ============================================================================
// PHASE BOUNDARIES (55-64)
// ============================================================================
check("55-64. no wiring, no activation, no env, no new route (D1-A boundaries; webhook owned by D1-B)", () => {
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
  // 55-57: the webhook ROUTE and CommunicationService are UNCHANGED. (Phase 5F-D1-B legitimately
  // wires the INBOUND_MESSAGE branch of the webhook SERVICE, and its RELIABILITY correction updates
  // the identity RESOLVER to distinguish an operational IDENTITY_LOOKUP_FAILED from a durable
  // UNKNOWN — so neither the webhook service nor the resolver is asserted byte-unchanged here. The
  // pure normalizer — the other D1-A deliverable — remains byte-unchanged, reused by D1-B.)
  for (const f of [WEBHOOK_ROUTE_SRC, COMM_SERVICE_SRC, NORMALIZER_SRC]) {
    assert(!dirty.includes(f), `${f} must be unchanged`);
  }
  // 58-61: consent/suppression/event tables untouched (no migration references them; none dirty).
  for (const p of dirty) {
    assert(!/\.env/.test(p), `no env file changed (${p})`); // 64
    assert(!/^app\/api\/.*route\.ts$|^pages\/api\//.test(p), `no API route added (${p})`); // 62
  }
  // 63 no Meta activation: the migration enables nothing and the new code activates nothing.
  const migration = readF(MIGRATION_SRC);
  assert(!/is_operationally_enabled|webhook_processing_enabled|outbound_enabled|activation_status\s*=/.test(migration), "no provider/webhook activation");
});

check("wiring: the d1a script exists, earlier scripts unchanged, the doc is complete and honest", () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:d1a"] === "node scripts/phase5f-d1a-whatsapp-inbound-foundation-harness.mjs", "d1a wired");
  assert(pkg.scripts["test:phase5f:b"] === "node scripts/phase5f-b-whatsapp-cloud-api-harness.mjs", "5F-B unchanged");
  for (const f of [NORMALIZER_SRC, RESOLVER_SRC, MIGRATION_SRC, DOC_D1A]) assert(existsSync(f), `${f} exists`);
  const doc = readF(DOC_D1A);
  for (const topic of [
    /inbound.*separate.*outbound|separate.*communication_messages/i, /verification is reused/i,
    /ignored|acknowledg/i, /provider[- ]message[- ]id/i, /idempoten/i, /sender.*hash/i, /minimiz/i,
    /EXACT/i, /AMBIGUOUS/i, /UNKNOWN/i, /lead.*not.*authenticated|lead.*not.*client/i,
    /no consent/i, /no reply/i, /no n8n/i, /no domain event/i, /no outbox/i,
    /migration.*not applied|prepared but not applied/i, /D1-B/i, /live schema verif/i,
  ]) assert(topic.test(doc), `doc covers ${topic}`);
  for (const forbidden of [/Meta is (now )?live/i, /webhook processing is enabled/i, /inbound is (now )?wired/i, /consent (was|is) (updated|mutated)/i]) {
    assert(!forbidden.test(doc), `doc must not claim ${forbidden}`);
  }
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutationChecks = [];
function tsMutation(name, edits, scenario) { mutationChecks.push({ name, kind: "ts", edits: edits.map(([file, from, to]) => ({ file, from, to })), scenario }); }
function srcMutation(name, file, from, to, scenario) { mutationChecks.push({ name, kind: "src", edits: [{ file, from, to }], scenario }); }

tsMutation("MUT A: the provider-message-id requirement is removed",
  [[NORMALIZER_SRC,
    "    if (!providerMessageId) {\n      results.push({ ok: false, reason: InboundNormalizationRejectReason.MISSING_MESSAGE_ID, providerMessageId: null });\n      return;\n    }",
    "    if (false) {\n      results.push({ ok: false, reason: InboundNormalizationRejectReason.MISSING_MESSAGE_ID, providerMessageId: null });\n      return;\n    }"]],
  (mm) => {
    const r = mm.Inbound.normalizeMetaInboundWebhook(envelope(textMsg({ id: undefined })));
    return r.length === 1 && r[0].ok === true; // a message with no id was accepted
  });

tsMutation("MUT B: a fallback message id is fabricated from sender + timestamp",
  [[NORMALIZER_SRC,
    "    const providerMessageId = readString(m, \"id\");",
    "    const providerMessageId = readString(m, \"id\") ?? `fabricated-${readString(m, \"from\")}-${readString(m, \"timestamp\")}`;"]],
  (mm) => {
    const r = mm.Inbound.normalizeMetaInboundWebhook(envelope(textMsg({ id: undefined })));
    return r.some((x) => x.ok && typeof x.message.providerMessageId === "string" && x.message.providerMessageId.startsWith("fabricated-"));
  });

srcMutation("MUT C: a plaintext sender-phone column is added to the inbound schema",
  MIGRATION_SRC,
  "  sender_masked             text,",
  "  sender_phone_e164         text,\n  sender_masked             text,",
  () => /\b(sender_phone_e164|phone_e164|wa_id|msisdn)\b\s+text/i.test(readSqlCode(MIGRATION_SRC)));

tsMutation("MUT D: identity uses first-row-win instead of AMBIGUOUS",
  [[RESOLVER_SRC,
    "  return { ok: true, identity: { confidence: InboundIdentityConfidence.AMBIGUOUS, principalType: null, principalId: null, candidateCount: unique.length } };",
    "  return { ok: true, identity: { confidence: InboundIdentityConfidence.EXACT, principalType: unique[0].principalType, principalId: unique[0].principalId, candidateCount: unique.length } };"]],
  async (mm) => {
    const r = await mm.Resolver.resolveInboundSenderIdentity({ senderPhoneE164: E164 }, idDeps({ vendors: [vendorCand("v1"), vendorCand("v2")] }));
    return r.ok && r.identity.confidence === "exact"; // two distinct principals collapsed to the first
  });

tsMutation("MUT E: identity silently prefers a client over a vendor",
  [[RESOLVER_SRC,
    "  if (unique.length === 0) return { ok: true, identity: unknown() };",
    "  const preferred = unique.find((x) => x.principalType === InboundPrincipalType.CLIENT);\n  if (preferred) return { ok: true, identity: { confidence: InboundIdentityConfidence.EXACT, principalType: preferred.principalType, principalId: preferred.principalId, candidateCount: unique.length } };\n  if (unique.length === 0) return { ok: true, identity: unknown() };"]],
  async (mm) => {
    const r = await mm.Resolver.resolveInboundSenderIdentity({ senderPhoneE164: E164 }, idDeps({ clients: [clientCand("c")], vendors: [vendorCand("v")] }));
    return r.ok && r.identity.confidence === "exact" && r.identity.principalType === "client"; // client preferred over an equal vendor conflict
  });

tsMutation("MUT R (reliability): a candidate-source read failure collapses to durable UNKNOWN",
  [[RESOLVER_SRC,
    "    return { ok: false, code: IDENTITY_LOOKUP_FAILED };",
    "    return { ok: true, identity: unknown() };"]],
  async (mm) => {
    const out = await mm.Resolver.resolveInboundSenderIdentity({ senderPhoneE164: E164 }, idDeps({ findClientCandidates: async () => { throw new Error("db down"); } }));
    return out.ok === true && out.identity.confidence === "unknown"; // an infra failure became durable UNKNOWN
  });

tsMutation("MUT F: the raw provider message is returned in the normalized content",
  [[NORMALIZER_SRC,
    "    const { type, content } = classifyAndMinimize(m);",
    "    const { type } = classifyAndMinimize(m);\n    const content = m;"]],
  (mm) => {
    const r = mm.Inbound.normalizeMetaInboundWebhook(envelope(textMsg()));
    // The raw message carries the sender wa_id digits — a minimized content never does.
    return r.some((x) => x.ok && safeStringify(x.message.contentMinimized).includes(WA_ID));
  });

srcMutation("MUT G: D1-A wires the normalizer into the live webhook service",
  WEBHOOK_SVC_SRC,
  "import { adminClient } from \"../lib/supabase\";",
  "import { adminClient } from \"../lib/supabase\";\nimport { normalizeMetaInboundWebhook } from \"../lib/communication/providers/metaWhatsAppInbound\";",
  () => /metaWhatsAppInbound|normalizeMetaInboundWebhook/.test(readCode(WEBHOOK_SVC_SRC)));

// ---- D1-A schema-integrity hardening mutations (migration DDL) --------------
const exactBranchGone = () =>
  !/identity_confidence = 'exact' and resolved_principal_type is not null and resolved_principal_id is not null/i.test(readSqlCode(MIGRATION_SRC).replace(/\s+/g, " "));
const nonExactBranchGone = () =>
  !/identity_confidence in \('ambiguous', 'unknown'\) and resolved_principal_type is null and resolved_principal_id is null/i.test(readSqlCode(MIGRATION_SRC).replace(/\s+/g, " "));

srcMutation("MUT H (integrity): provider_message_id loses NOT NULL",
  MIGRATION_SRC,
  "  provider_message_id       text not null,",
  "  provider_message_id       text,",
  () => !/\bprovider_message_id\s+text\s+not null/i.test(readSqlCode(MIGRATION_SRC)));

srcMutation("MUT I (integrity): the unique (provider, provider_message_id) fence is removed",
  MIGRATION_SRC,
  "create unique index if not exists uq_comm_inbound_provider_message",
  "create index if not exists uq_comm_inbound_provider_message",
  () => !/create unique index[^\n;]*uq_comm_inbound_provider_message/i.test(readSqlCode(MIGRATION_SRC)));

srcMutation("MUT J (integrity): EXACT identity allowed with BOTH principal fields null",
  MIGRATION_SRC,
  "      (identity_confidence = 'exact'\n         and resolved_principal_type is not null\n         and resolved_principal_id is not null)",
  "      (identity_confidence = 'exact')",
  exactBranchGone);

srcMutation("MUT K (integrity): EXACT identity allowed with only a principal TYPE (no id)",
  MIGRATION_SRC,
  "         and resolved_principal_type is not null\n         and resolved_principal_id is not null)",
  "         and resolved_principal_type is not null)",
  exactBranchGone);

srcMutation("MUT L (integrity): EXACT identity allowed with only a principal ID (no type)",
  MIGRATION_SRC,
  "      (identity_confidence = 'exact'\n         and resolved_principal_type is not null\n         and resolved_principal_id is not null)",
  "      (identity_confidence = 'exact'\n         and resolved_principal_id is not null)",
  exactBranchGone);

srcMutation("MUT M (integrity): AMBIGUOUS/UNKNOWN identity allowed to carry a principal",
  MIGRATION_SRC,
  "      or (identity_confidence in ('ambiguous', 'unknown')\n         and resolved_principal_type is null\n         and resolved_principal_id is null)",
  "      or (identity_confidence in ('ambiguous', 'unknown'))",
  nonExactBranchGone);

// ============================================================================
// RUNNER
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-D1-A WhatsApp inbound foundation checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}
async function suiteGoesRed() { for (const c of checks) { try { await c.fn(); } catch { return true; } } return false; }
async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5F-D1-A mutation tests...\n");
  for (const mut of mutationChecks) {
    const mutDir = resolve(`.phase5fd1a-mut-${mutationChecks.indexOf(mut)}`);
    const originals = new Map();
    for (const edit of mut.edits) { const p = resolve(edit.file); if (!originals.has(p)) originals.set(p, readFileSync(p, "utf8")); }
    try {
      for (const edit of mut.edits) {
        const p = resolve(edit.file);
        const cur = readFileSync(p, "utf8");
        if (!cur.includes(edit.from)) throw new Error(`anchor not found in ${edit.file}`);
        writeFileSync(p, cur.replace(edit.from, edit.to));
      }
      let violation = false;
      if (mut.kind === "ts") {
        let mm;
        try { compileTo(mutDir); transpileResolver(mutDir); } catch { console.log(`PASS ${mut.name} (rejected at compile time)`); passed++; continue; }
        mm = wireBuild(mutDir);
        violation = await mut.scenario(mm);
      } else {
        violation = await mut.scenario();
      }
      if (!violation) violation = await suiteGoesRed();
      if (violation) { console.log(`PASS ${mut.name}`); passed++; }
      else { console.log(`FAIL ${mut.name} (guard did not prove load-bearing)`); failed++; }
    } catch (e) {
      console.log(`FAIL ${mut.name}`); console.error(e); failed++;
    } finally {
      for (const [p, original] of originals) writeFileSync(p, original);
      rmSync(mutDir, { recursive: true, force: true });
    }
  }
  return { passed, failed };
}

const functional = await runFunctional();
const mutations = await runMutations();
rmSync(MAIN_DIR, { recursive: true, force: true });
const passed = functional.passed + mutations.passed;
const failed = functional.failed + mutations.failed;
console.log(`\nSummary: ${passed} passed, ${failed} failed (functional: ${functional.passed}/${functional.passed + functional.failed}, mutation: ${mutations.passed}/${mutations.passed + mutations.failed}).`);
process.exit(failed > 0 ? 1 : 0);
