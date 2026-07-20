// ============================================================================
// Phase 8B-1B-C — Inbound & Webhook Provider-Account Binding harness.
//
// Stage 1 (pure core): inboundProviderAccountAttribution decision + metaWebhookAccountIdentity extractor,
//   proven NON-DIVERGENT from the FROZEN decideCallbackIdentity gate.
// Stage 2 (inbound persistence binding): drives the REAL services/inboundWhatsAppMessageService.ts through
//   its real DB adapters with a recording fake client, proving receipt/inbound binding, read-first
//   duplicate/legacy-NULL/mismatch handling, no reassignment, no second row, ack-inheritance surface,
//   no resolver call, and sanitized logging.
// ============================================================================

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";

const ROOT = process.cwd();
const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const ATTR_SRC = "lib/communication/inboundProviderAccountAttribution.ts";
const EXTRACT_SRC = "lib/communication/providers/metaWebhookAccountIdentity.ts";
const GATE_SRC = "lib/communication/providers/metaCallbackIdentity.ts";
const OWNERSHIP_SRC = "lib/communication/providers/providerAccountOwnership.ts";
const SERVICE_SRC = "services/inboundWhatsAppMessageService.ts";
const COMM_SRC = "services/communicationService.ts";
const WH_SRC = "services/metaWhatsAppWebhookService.ts";
const ACK_SRC = "services/consentCommandResponseService.ts";

// A swappable holder so the stubbed adminClient returns the current test's fake client.
const COMM_HOLDER = { client: () => { throw new Error("no fake comm client set"); } };

function compile(files, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  const tsconfigPath = resolve(ROOT, `.phase8b1bc-tsc-${Math.random().toString(36).slice(2, 10)}.json`);
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: true, jsx: "preserve",
      outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] }, lib: ["ES2021", "DOM"],
    },
    files,
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  finally { rmSync(tsconfigPath, { force: true }); }
  return outDir;
}

function loadPure(outDir) {
  const req = createRequire(`${outDir}/`);
  return {
    Attr: req(`./${ATTR_SRC.replace(/\.ts$/, ".js")}`),
    Extract: req(`./${EXTRACT_SRC.replace(/\.ts$/, ".js")}`),
    Gate: req(`./${GATE_SRC.replace(/\.ts$/, ".js")}`),
  };
}

// Load the inbound service with `../lib/supabase` stubbed (its adminClient must NEVER run — every real
// adapter is called with an explicit fake client instead).
function loadService(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const orig = Module._load;
  const throwingSupabase = { adminClient: () => { throw new Error("real Supabase must never run in the 8B-1B-C harness"); } };
  Module._load = function (request, parent, isMain) {
    if (request === "../lib/supabase" || request.endsWith("/lib/supabase")) return throwingSupabase;
    return orig.call(this, request, parent, isMain);
  };
  try { return req(`./${SERVICE_SRC.replace(/\.ts$/, ".js")}`); }
  finally { Module._load = orig; }
}

// Load communicationService with `../lib/supabase` stubbed to the SWAPPABLE fake (COMM_HOLDER).
function loadComm(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const orig = Module._load;
  const supa = { adminClient: () => COMM_HOLDER.client() };
  Module._load = function (request, parent, isMain) {
    if (request === "../lib/supabase" || request.endsWith("/lib/supabase")) return supa;
    return orig.call(this, request, parent, isMain);
  };
  try { return req(`./${COMM_SRC.replace(/\.ts$/, ".js")}`); }
  finally { Module._load = orig; }
}

// Load the webhook orchestration with `../lib/supabase` stubbed (every collaborator is injected).
function loadWebhook(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const orig = Module._load;
  const supa = { adminClient: () => { throw new Error("real Supabase must never run in the 8B-1B-C webhook harness"); } };
  Module._load = function (request, parent, isMain) {
    if (request === "../lib/supabase" || request.endsWith("/lib/supabase")) return supa;
    return orig.call(this, request, parent, isMain);
  };
  try { return req(`./${WH_SRC.replace(/\.ts$/, ".js")}`); }
  finally { Module._load = orig; }
}

// Load the consent-ack enqueue path with `../lib/supabase` stubbed THROWING — every collaborator is
// injected, so a real client call would be a bug. The pure phone hasher and Meta normalizer are taken from
// the SAME build so the evidence gate is satisfied for real, not by fixture coincidence.
function loadAck(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const orig = Module._load;
  const supa = { adminClient: () => { throw new Error("real Supabase must never run in the 8B-1B-C ack harness"); } };
  Module._load = function (request, parent, isMain) {
    if (request === "../lib/supabase" || request.endsWith("/lib/supabase")) return supa;
    return orig.call(this, request, parent, isMain);
  };
  try {
    return {
      Ack: req(`./${ACK_SRC.replace(/\.ts$/, ".js")}`),
      phone: req("./lib/communication/phone.js"),
      norm: req("./lib/communication/providers/metaWhatsAppInbound.js"),
    };
  } finally { Module._load = orig; }
}

// ── test registries ──────────────────────────────────────────────────────
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ── fixtures ────────────────────────────────────────────────────────────
const WABA = "22220000456";
const PHONE = "15550000123";
const OTHER = "99990000999";
const EXPECTED = { wabaId: WABA, phoneNumberId: PHONE };
const ACC_A = "11111111-1111-4111-8111-111111111111";
const ACC_B = "22222222-2222-4222-8222-222222222222";
const PRINCIPAL = "33333333-3333-4333-8333-333333333333";
const HEX64 = "a".repeat(64);

function messagesPayload(wabaId, phoneId, extraChanges = []) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: wabaId, changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneId } } }, ...extraChanges] }],
  };
}
function templatePayload(wabaId) {
  return { object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field: "message_template_status_update", value: {} }] }] };
}
const acct = (id) => ({ id, provider_key: "meta_whatsapp_cloud", channel: "whatsapp", business_account_reference: WABA, phone_number_reference: PHONE });

const uuid = () => "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

// A recording fake PostgREST client modelling the two tables the inbound service touches. Inserted rows
// gain the DB defaults the validators require (a UUID id + a timestamptz received_at).
function makeFakeClient() {
  const receipts = [];
  const inbound = [];
  const inserts = { receipts: [], inbound: [] };
  const updates = [];
  const table = (rows, name) => {
    const state = { op: null, row: null, filters: {}, sel: null };
    const run = () => {
      const matches = rows.filter((r) => Object.entries(state.filters).every(([c, v]) => (r[c] ?? null) === v));
      if (state.op === "update") for (const r of matches) Object.assign(r, state.row);
      return matches;
    };
    const b = {
      insert(row) {
        state.op = "insert";
        const stored = { id: uuid(), duplicate_count: 0, received_at: "2026-07-18T00:00:00Z", ...row };
        rows.push(stored);
        inserts[name].push({ ...row });
        state.row = stored;
        return b;
      },
      update(u) { state.op = "update"; state.row = u; if (name === "receipts") updates.push({ table: name, set: u }); return b; },
      select(sel) { state.sel = sel; return b; },
      eq(c, v) { state.filters[c] = v; return b; },
      is(c, v) { state.filters[c] = v; return b; },
      limit() { return Promise.resolve().then(() => ({ data: run(), error: null })); },
      single() { return Promise.resolve().then(() => (state.op === "insert" ? { data: state.row, error: null } : { data: run()[0] ?? null, error: null })); },
      then(onF, onR) { return Promise.resolve().then(() => ({ data: run(), error: null })).then(onF, onR); },
    };
    return b;
  };
  const client = () => ({ from: (t) => (t === "communication_webhook_receipts" ? table(receipts, "receipts") : table(inbound, "inbound")) });
  return { client, receipts, inbound, inserts, updates };
}

// Deps that use the REAL adapters with a fake client; normalize + resolveIdentity are simple fakes (no DB).
function serviceDeps(S, fk, messageId = "wamid.ABC") {
  return {
    normalize: () => [{ ok: true, senderPhoneE164: "+15551230000", message: {
      provider: "meta_whatsapp_cloud", providerMessageId: messageId, senderHash: HEX64, senderMasked: "+1555***0000",
      messageType: "text", contentMinimized: { body: "hi" }, providerOccurredAt: null,
    } }],
    resolveIdentity: async () => ({ ok: true, identity: { confidence: "exact", principalType: "client", principalId: PRINCIPAL } }),
    createOrResolveReceipt: (rb, p, acc) => S.createOrResolveReceiptViaDb(rb, p, acc, fk.client),
    persistInboundRow: (row) => S.persistInboundRowViaDb(row, fk.client),
    readStoredInbound: (row) => S.readStoredInboundViaDb(row, fk.client),
    finalizeReceipt: (id, st, r) => S.finalizeReceiptViaDb(id, st, r, fk.client),
  };
}
// Seed a durable inbound row (as if a prior delivery persisted it) with a chosen stored account.
function seedInbound(fk, messageId, storedAccount) {
  fk.inbound.push({
    id: uuid(), provider: "meta_whatsapp_cloud", provider_message_id: messageId, sender_hash: HEX64,
    resolved_principal_type: "client", resolved_principal_id: PRINCIPAL, identity_confidence: "exact",
    message_type: "text", content_minimized: { body: "hi" }, provider_occurred_at: null,
    received_at: "2026-07-18T00:00:00Z", provider_account_id: storedAccount,
  });
}

// ── functional checks (Stage 1: pure) ───────────────────────────────────
let P;
check("1-6. decision mapping preserves ALL six resolver outcomes distinctly", () => {
  const d = (o) => P.Attr.decideInboundAttribution(o);
  assert(d({ kind: "owned", account: acct(ACC_A) }).kind === "owned" && d({ kind: "owned", account: acct(ACC_A) }).accountId === ACC_A, "owned → bind exact id");
  assert(d({ kind: "query_error" }).kind === "retry", "query_error → retry (503)");
  for (const o of [{ kind: "not_found" }, { kind: "ambiguous", count: 2 }, { kind: "waba_mismatch", account: acct("x") }, { kind: "invalid_input" }]) {
    assert(d(o).kind === "rejected", `${o.kind} → rejected`);
  }
});
check("7-9. query_error is retryable infra and is NEVER not_found; rejected codes are distinct", () => {
  assert(P.Attr.decideInboundAttribution({ kind: "query_error" }).code === P.Attr.INBOUND_ATTRIBUTION_FAILURE.LOOKUP_FAILED, "query_error → LOOKUP_FAILED");
  const codes = new Set(["not_found", "ambiguous", "waba_mismatch", "invalid_input"].map((k) => P.Attr.decideInboundAttribution({ kind: k, count: 2, account: acct("x") }).code));
  assert(codes.size === 4, "four DISTINCT rejection codes");
});
check("10-12. no id/secret/token/phone leaks in any reason or code", () => {
  for (const o of [{ kind: "not_found" }, { kind: "ambiguous", count: 9 }, { kind: "waba_mismatch", account: acct("secret-acc-id") }, { kind: "invalid_input" }, { kind: "query_error" }]) {
    const s = JSON.stringify(P.Attr.decideInboundAttribution(o));
    assert(!s.includes("secret-acc-id") && !s.includes(WABA) && !s.includes(PHONE) && !s.includes("+"), "no id/waba/phone leak");
  }
});
check("13-16. extractor pulls entry.id + value.metadata.phone_number_id from messages changes", () => {
  const e = P.Extract.extractMetaWebhookAccountIdentity(messagesPayload(WABA, PHONE));
  assert(e.kind === "phone_identity" && e.wabaId === WABA && e.phoneNumberId === PHONE, "extracts exact ids from payload (never env)");
  assert(P.Extract.extractMetaWebhookAccountIdentity(templatePayload(WABA)).kind === "no_identity", "template-only → no phone identity");
  assert(P.Extract.extractMetaWebhookAccountIdentity({ object: "x" }).kind === "no_identity", "foreign root → no_identity");
});
check("17-19. extractor NEVER first-rows conflicting identities", () => {
  assert(P.Extract.extractMetaWebhookAccountIdentity(messagesPayload(WABA, PHONE, [{ field: "messages", value: { metadata: { phone_number_id: OTHER } } }])).kind === "no_identity", "conflict → no_identity");
  assert(P.Extract.extractMetaWebhookAccountIdentity(messagesPayload("not-numeric", PHONE)).kind === "no_identity", "malformed waba → no_identity");
  assert(P.Extract.extractMetaWebhookAccountIdentity({ object: "whatsapp_business_account", entry: [{ id: 22220000456, changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE } } }] }] }).kind === "no_identity", "numeric waba never coerced");
});
check("20-27. EQUIVALENCE: authorized-messages gate ⟺ extractor yields EXACTLY the validated identity", () => {
  const suite = [
    messagesPayload(WABA, PHONE), messagesPayload(WABA, PHONE, [{ field: "message_template_status_update", value: {} }]),
    messagesPayload(OTHER, PHONE), messagesPayload(WABA, OTHER), messagesPayload("bad", PHONE),
    templatePayload(WABA), templatePayload(OTHER), { object: "whatsapp_business_account", entry: [] }, { object: "not_wa" },
    messagesPayload(WABA, PHONE, [{ field: "messages", value: { metadata: { phone_number_id: OTHER } } }]),
  ];
  for (const p of suite) {
    const gate = P.Gate.decideCallbackIdentity(p, EXPECTED);
    const ex = P.Extract.extractMetaWebhookAccountIdentity(p);
    if (gate.kind === "authorized" && gate.classes.includes("messages")) {
      assert(ex.kind === "phone_identity" && ex.wabaId === EXPECTED.wabaId && ex.phoneNumberId === EXPECTED.phoneNumberId, "extractor == gate-validated identity (no divergence)");
    }
    if (ex.kind === "phone_identity") {
      assert(P.Gate.decideCallbackIdentity(p, { wabaId: ex.wabaId, phoneNumberId: ex.phoneNumberId }).kind === "authorized", "extracted identity is authorized by the gate");
    }
  }
});
check("28-30. extractor and gate share the SINGLE frozen grammar constant (cannot drift)", () => {
  const raw = readFileSync(EXTRACT_SRC, "utf8");
  const code = raw.split("\n").filter((l) => { const t = l.trim(); return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")); }).join("\n");
  assert(/import\s*\{\s*META_CALLBACK_ID_GRAMMAR\s*\}\s*from\s*"\.\/metaCallbackIdentity"/.test(code), "imports the frozen grammar constant");
  assert(!/\[0-9\]\{1,64\}/.test(code), "never restates the numeric grammar literal");
  assert(!/process\.env|resolveWebhookIdentityConfig/.test(code), "never reads env / expected identity");
});

// ── functional checks (Stage 2: inbound persistence binding) ────────────
let S;
check("31-33. NEW owned message: receipt insert AND inbound insert receive the SAME provider_account_id; read-back returns it", async () => {
  const fk = makeFakeClient();
  const out = await S.handleInboundWhatsAppMessages({ rawBody: "{}", payload: messagesPayload(WABA, PHONE), providerAccountId: ACC_A }, serviceDeps(S, fk));
  assert(out.ok === true, "owned message persists");
  assert(fk.inserts.receipts.length === 1 && fk.inserts.receipts[0].provider_account_id === ACC_A, "RECEIPT insert bound to the account");
  assert(fk.inserts.inbound.length === 1 && fk.inserts.inbound[0].provider_account_id === ACC_A, "INBOUND insert bound to the SAME account");
  assert(out.result.processed.length === 1 && out.result.processed[0].receipt.providerAccountId === ACC_A, "read-back returns provider_account_id (ack-inheritance surface)");
  assert(out.result.messagesPersisted === 1, "counted as persisted");
});
check("34. missing/invalid providerAccountId FAILS CLOSED — zero receipt/inbound writes", async () => {
  const fk = makeFakeClient();
  const out = await S.handleInboundWhatsAppMessages({ rawBody: "{}", payload: messagesPayload(WABA, PHONE) }, serviceDeps(S, fk));
  assert(out.ok === false && out.code === "inbound_provider_account_required", "no account → fail closed");
  assert(fk.inserts.receipts.length === 0 && fk.inserts.inbound.length === 0, "ZERO writes without an approved account");
});
check("35. DUPLICATE (same account) preserves the original bound account; no second inbound row", async () => {
  const fk = makeFakeClient();
  seedInbound(fk, "wamid.ABC", ACC_A);
  const out = await S.handleInboundWhatsAppMessages({ rawBody: "{}", payload: messagesPayload(WABA, PHONE), providerAccountId: ACC_A }, serviceDeps(S, fk));
  assert(out.result.messagesDuplicate === 1 && out.result.messagesPersisted === 0, "duplicate, not a fresh insert");
  assert(fk.inserts.inbound.length === 0, "NO second inbound row created");
  assert(out.result.processed[0].receipt.providerAccountId === ACC_A, "stored account preserved");
});
check("36. DUPLICATE legacy NULL remains NULL (never upgraded)", async () => {
  const fk = makeFakeClient();
  seedInbound(fk, "wamid.ABC", null);
  const out = await S.handleInboundWhatsAppMessages({ rawBody: "{}", payload: messagesPayload(WABA, PHONE), providerAccountId: ACC_A }, serviceDeps(S, fk));
  assert(out.result.messagesDuplicate === 1, "legacy row is a duplicate");
  assert(fk.inserts.inbound.length === 0, "NO second inbound row created for the legacy row");
  assert(out.result.processed[0].receipt.providerAccountId === null, "legacy NULL stays NULL (not upgraded)");
});
check("37. REDELIVERY with a DIFFERENT proposed account NEVER reassigns; no second row; deterministic conflict", async () => {
  const fk = makeFakeClient();
  seedInbound(fk, "wamid.ABC", ACC_A);
  const out = await S.handleInboundWhatsAppMessages({ rawBody: "{}", payload: messagesPayload(WABA, PHONE), providerAccountId: ACC_B }, serviceDeps(S, fk));
  assert(fk.inserts.inbound.length === 0, "NO second inbound row under the new account");
  assert(fk.inbound.length === 1 && fk.inbound[0].provider_account_id === ACC_A, "stored account UNCHANGED (never reassigned)");
  assert(out.result.messagesRejected === 1 && out.result.messagesPersisted === 0 && out.result.messagesDuplicate === 0, "deterministic conflict → rejected, no persist");
  assert(out.result.processed.length === 0, "a conflicting message is not surfaced downstream");
});
check("38-40. STATIC: no UPDATE of provider_account_id; no ownership resolver import; sanitized logs only", () => {
  const src = readFileSync(SERVICE_SRC, "utf8");
  const code = src.split("\n").filter((l) => { const t = l.trim(); return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")); }).join("\n");
  assert(!/\.update\([^)]*provider_account_id/.test(code), "provider_account_id is NEVER written by an UPDATE (bind-at-insert only)");
  assert(!/resolveOwningProviderAccount|inboundProviderAccountAttribution|metaWebhookAccountIdentity|communicationProviderRuntimeService/.test(code), "the inbound service NEVER resolves ownership (the webhook layer is the sole resolver caller)");
  // Every console.* call passes ONLY a fixed sanitized string — never an id/phone/waba/account interpolation.
  const logs = code.match(/console\.\w+\([^;]*\)/g) || [];
  for (const l of logs) assert(!/\$\{|provider_account_id|phone_number_id|wabaId|sender|accountId/.test(l), `log must be sanitized: ${l.slice(0, 60)}`);
});

// ── functional checks (Stage 2B: delivery-event + valid-receipt binding via processWebhook) ─────────
let C;
function fakeProvider() {
  return {
    providerKey: "meta_whatsapp_cloud", channel: "whatsapp",
    verifyWebhookSignature: (_rb, s) => s === "valid",
    deriveWebhookEventId: () => "evt-1",
    normalizeWebhook: () => [{ providerMessageId: "wamid.X", providerEventId: "devt-1", normalizedEventType: "delivered", occurredAt: "2026-07-18T00:00:00Z", sanitizedMetadata: {} }],
  };
}
function fakeCommClient({ messageStatus = "sent" } = {}) {
  const receipts = [];
  const messages = [{ id: uuid(), provider: "meta_whatsapp_cloud", provider_message_id: "wamid.X", status: messageStatus, channel: "whatsapp", created_at: "2026-07-18T00:00:00Z" }];
  const events = [];
  const inserts = { receipts: [], events: [] };
  const updates = { messages: [], receipts: [] };
  const key = (t) => (t === "communication_webhook_receipts" ? "receipts" : t === "communication_messages" ? "messages" : "events");
  const from = (t) => {
    const rows = t === "communication_webhook_receipts" ? receipts : t === "communication_messages" ? messages : events;
    const state = { op: null, row: null, filters: {} };
    const run = () => {
      const m = rows.filter((r) => Object.entries(state.filters).every(([c, v]) => (r[c] ?? null) === v));
      if (state.op === "update") { for (const r of m) Object.assign(r, state.row); updates[key(t)].push({ ...state.row }); }
      return m;
    };
    const b = {
      insert(row) { state.op = "insert"; const stored = { id: uuid(), duplicate_count: 0, received_at: "2026-07-18T00:00:00Z", ...row }; rows.push(stored); if (t !== "communication_messages") inserts[key(t)].push({ ...row }); state.row = stored; return b; },
      update(u) { state.op = "update"; state.row = u; return b; },
      select() { return b; }, eq(c, v) { state.filters[c] = v; return b; }, is(c, v) { state.filters[c] = v; return b; }, order() { return b; },
      limit() { return Promise.resolve().then(() => ({ data: run(), error: null })); },
      single() { return Promise.resolve().then(() => (state.op === "insert" ? { data: state.row, error: null } : { data: run()[0] ?? null, error: null })); },
      then(onF, onR) { return Promise.resolve().then(() => ({ data: run(), error: null })).then(onF, onR); },
    };
    return b;
  };
  return { client: () => ({ from }), receipts, messages, events, inserts, updates };
}
function seedReceipt(account) {
  return { id: uuid(), provider: "meta_whatsapp_cloud", provider_event_id: "evt-1", payload_hash: "ph", signature_valid: true, processing_status: "processed", duplicate_count: 0, provider_account_id: account };
}
async function runWebhook(opts = {}) {
  // Use `in` so an EXPLICIT `undefined` (the missing-account test) is not masked by a default.
  const signature = "signature" in opts ? opts.signature : "valid";
  const providerAccountId = "providerAccountId" in opts ? opts.providerAccountId : ACC_A;
  const seed = "seed" in opts ? opts.seed : undefined;
  const messageStatus = opts.messageStatus ?? "sent";
  const fk = fakeCommClient({ messageStatus });
  if ("seed" in opts) fk.receipts.push(seedReceipt(seed));
  COMM_HOLDER.client = fk.client;
  const svc = new C.CommunicationService(fakeProvider(), {}, null, {});
  const res = await svc.processWebhook("{}", signature, "secret", providerAccountId);
  return { res, fk };
}

check("41-42. valid delivery callback: the receipt AND every delivery event are bound to the SAME account", async () => {
  const { res, fk } = await runWebhook({ providerAccountId: ACC_A });
  assert(res.ok === true && res.data.processingStatus === "processed", "valid delivery is processed");
  assert(fk.inserts.receipts.length === 1 && fk.inserts.receipts[0].provider_account_id === ACC_A, "the VALID receipt is bound to the account");
  assert(fk.inserts.events.length === 1 && fk.inserts.events.every((e) => e.provider_account_id === ACC_A), "EVERY delivery event is bound to the SAME account");
});
check("43. missing/malformed account on a valid delivery callback → fail closed, ZERO receipt & ZERO event writes", async () => {
  const { res, fk } = await runWebhook({ providerAccountId: undefined });
  assert(res.ok === false, "fails closed");
  assert(fk.inserts.receipts.length === 0 && fk.inserts.events.length === 0, "zero valid-receipt and zero delivery-event writes");
});
check("44-45. invalid-signature receipt is NULL and NEVER requires an account; zero delivery events", async () => {
  const { res, fk } = await runWebhook({ signature: "invalid", providerAccountId: undefined });
  assert(res.ok === false, "invalid signature rejected");
  assert(fk.inserts.receipts.length === 1 && (fk.inserts.receipts[0].provider_account_id ?? null) === null, "invalid-signature receipt is provider_account_id = NULL");
  assert(fk.inserts.events.length === 0, "invalid-signature processing creates ZERO delivery events");
});
check("46. same-account duplicate is idempotent: no second receipt, no delivery event, stored account preserved", async () => {
  const { res, fk } = await runWebhook({ providerAccountId: ACC_A, seed: ACC_A });
  assert(res.ok === true && res.data.duplicate === true, "idempotent duplicate");
  assert(fk.inserts.receipts.length === 0 && fk.inserts.events.length === 0, "no second receipt / no delivery event");
  assert(fk.receipts[0].provider_account_id === ACC_A, "stored account preserved (never UPDATEd)");
});
check("47. legacy-NULL duplicate stays NULL and creates no bound duplicate", async () => {
  const { res, fk } = await runWebhook({ providerAccountId: ACC_A, seed: null });
  assert(res.ok === true && res.data.duplicate === true, "legacy row is an idempotent duplicate");
  assert(fk.inserts.receipts.length === 0 && fk.inserts.events.length === 0, "no second (account-bound) row");
  assert(fk.receipts[0].provider_account_id === null, "legacy NULL preserved (not upgraded)");
});
check("48-49. cross-account redelivery: rejected BEFORE writes; zero receipt/event writes; ZERO lifecycle mutation; never reassigned", async () => {
  const { res, fk } = await runWebhook({ providerAccountId: ACC_B, seed: ACC_A });
  assert(res.ok === true && res.data.processingStatus === "rejected", "deterministic conflict rejection");
  assert(fk.inserts.receipts.length === 0 && fk.inserts.events.length === 0, "zero new receipt/event writes");
  assert(fk.updates.messages.length === 0, "ZERO message-lifecycle mutation");
  assert(fk.receipts[0].provider_account_id === ACC_A, "stored account UNCHANGED (never reassigned)");
});
check("50-52. STATIC: no UPDATE of provider_account_id; no ownership resolver import/call; sanitized logs", () => {
  const src = readFileSync(COMM_SRC, "utf8");
  const code = src.split("\n").filter((l) => { const t = l.trim(); return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")); }).join("\n");
  // The ONLY provider_account_id UPDATE is the pre-existing 8B-1B-B OUTBOUND CAS on communication_messages
  // (guarded by status=dispatching + provider_account_id IS NULL). This substep's delivery/receipt binding
  // is INSERT-ONLY, so the count stays EXACTLY 1 — no new UPDATE path was introduced.
  const upd = (code.replace(/\n/g, " ").match(/\.update\(\{[^}]*?provider_account_id[^}]*?\}\)/g) || []);
  assert(upd.length === 1, `exactly one provider_account_id UPDATE (the outbound CAS) — the delivery/receipt binding adds none (found ${upd.length})`);
  assert(/is\("provider_account_id", null\)/.test(code), "that sole UPDATE is the CAS guarded on provider_account_id IS NULL (never a reassignment)");
  assert(!/resolveOwningProviderAccount/.test(code), "CommunicationService NEVER imports/calls resolveOwningProviderAccount");
  const logs = code.match(/console\.\w+\([^;]*\)/g) || [];
  for (const l of logs) assert(!/\$\{|provider_account_id|phone_number_id|wabaId|accountId|payload_hash/.test(l), `log must be sanitized: ${l.slice(0, 60)}`);
});

// ── functional checks (Stage 2C: webhook orchestration — resolve ONCE before any effect) ────────────
let W;
process.env.WHATSAPP_APP_SECRET = "harness-app-secret";
process.env.WHATSAPP_WABA_ID = WABA;
process.env.WHATSAPP_PHONE_NUMBER_ID = PHONE;
const APP_SECRET = "harness-app-secret";
function sigFor(rawBody) {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(Buffer.from(rawBody, "utf8")).digest("hex");
}
const change = (value) => ({ field: "messages", value: { metadata: { phone_number_id: PHONE }, ...value } });
const envelope = (changes, wabaId = WABA) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: wabaId, changes }] });
const MSG = (id) => ({ id, from: "15551230000", type: "text", text: { body: "hi" }, timestamp: "1750000000" });
const STAT = (id) => ({ id, status: "delivered", timestamp: "1750000000", recipient_id: "15551230000" });
const inboundBody = (n = 1) => envelope([change({ messages: Array.from({ length: n }, (_, i) => MSG(`wamid.${i}`)) })]);
const deliveryBody = (n = 1) => envelope([change({ statuses: Array.from({ length: n }, (_, i) => STAT(`wamid.${i}`)) })]);
const templateBody = () => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: WABA, changes: [{ field: "message_template_status_update", value: { event: "APPROVED" } }] }] });

const OWNED = { kind: "owned", account: { id: ACC_A, provider_key: "meta_whatsapp_cloud", channel: "whatsapp", business_account_reference: WABA, phone_number_reference: PHONE } };
function whDeps(over = {}) {
  const calls = [], resolverInputs = [], threaded = { inbound: [], delivery: [] };
  const d = {
    isWebhookProcessingEnabled: async () => { calls.push("gate"); return over.enabled !== false; },
    resolveOwnership: async (input) => {
      calls.push("resolve"); resolverInputs.push(input);
      if (over.resolverThrows) throw new Error("resolver blew up");
      return over.ownership ?? OWNED;
    },
    handleInbound: async (input) => {
      calls.push("inbound"); threaded.inbound.push(input.providerAccountId);
      return { ok: true, result: { receiptId: "r1", receiptDuplicate: false, messagesSeen: 1, messagesPersisted: 1, messagesDuplicate: 0, messagesRejected: 0, identityExact: 1, identityAmbiguous: 0, identityUnknown: 0, processed: [] } };
    },
    processDelivery: async (args) => { calls.push("delivery"); threaded.delivery.push(args.providerAccountId); return { ok: true, data: { duplicate: false } }; },
    recordIgnored: async () => { calls.push("ignored"); },
    processCommands: async () => { calls.push("commands"); return { ok: true, result: { items: [] } }; },
    enqueueAcks: async () => { calls.push("acks"); },
  };
  return { d, calls, resolverInputs, threaded };
}
async function runWh(rawBody, over = {}, badSig = false) {
  const h = whDeps(over);
  const out = await W.handleMetaWhatsAppWebhookPost({ rawBody, signature: badSig ? "sha256=" + "0".repeat(64) : sigFor(rawBody) }, h.d);
  return { out, ...h };
}
const EFFECTS = ["inbound", "delivery", "ignored", "commands", "acks"];
const noEffects = (calls) => EFFECTS.every((e) => !calls.includes(e));

check("53-55. authorized INBOUND resolves EXACTLY ONCE, BEFORE any effect, and threads the exact account", async () => {
  const { out, calls, resolverInputs, threaded } = await runWh(inboundBody(1));
  assert(out.status === 200 && out.result === "inbound_processed", `inbound processed (got ${JSON.stringify(out)})`);
  assert(calls.filter((c) => c === "resolve").length === 1, "resolver called EXACTLY once per envelope");
  assert(calls.indexOf("resolve") < calls.indexOf("inbound"), "resolution completes BEFORE the first effect-bearing write");
  assert(threaded.inbound[0] === ACC_A, "the exact owned account id is threaded to handleInboundWhatsAppMessages");
  assert(resolverInputs[0].phoneNumberReference === PHONE && resolverInputs[0].expectedWabaId === WABA, "resolver input is the PAYLOAD identity");
  assert(resolverInputs[0].providerKey === "meta_whatsapp_cloud" && resolverInputs[0].channel === "whatsapp", "exact provider/channel");
});
check("56-57. authorized DELIVERY resolves EXACTLY ONCE, BEFORE the write, and threads the exact account", async () => {
  const { out, calls, threaded } = await runWh(deliveryBody(1));
  assert(out.status === 200 && out.result === "delivery_processed", `delivery processed (got ${JSON.stringify(out)})`);
  assert(calls.filter((c) => c === "resolve").length === 1, "resolver called EXACTLY once");
  assert(calls.indexOf("resolve") < calls.indexOf("delivery"), "resolution BEFORE processWebhook");
  assert(threaded.delivery[0] === ACC_A, "the exact owned account id is threaded to processWebhook");
});
check("58. query_error → 503 with ZERO receipt/inbound/delivery/consent/ack effects", async () => {
  const { out, calls } = await runWh(inboundBody(1), { ownership: { kind: "query_error" } });
  assert(out.status === 503 && out.code === "provider_account_lookup_failed", `503 retryable (got ${JSON.stringify(out)})`);
  assert(noEffects(calls), "ZERO effect-bearing calls");
});
check("59. a THROWN resolver is infrastructure → 503, never 'continue unbound'", async () => {
  const { out, calls } = await runWh(inboundBody(1), { resolverThrows: true });
  assert(out.status === 503, "throw → 503");
  assert(noEffects(calls), "ZERO effects after a resolver throw");
});
check("60-63. not_found / ambiguous / waba_mismatch / invalid_input → generic 200, ZERO effects", async () => {
  for (const ownership of [{ kind: "not_found" }, { kind: "ambiguous", count: 2 }, { kind: "waba_mismatch", account: OWNED.account }, { kind: "invalid_input" }]) {
    const { out, calls } = await runWh(inboundBody(1), { ownership });
    assert(out.status === 200 && out.result === "acknowledged_unowned_provider_account", `${ownership.kind} → generic 200`);
    assert(noEffects(calls), `${ownership.kind} → ZERO effects`);
  }
});
check("64. INVALID signature: zero resolver calls, zero effects, existing 401 posture", async () => {
  const { out, calls } = await runWh(inboundBody(1), {}, /*badSig*/ true);
  assert(out.status === 401 && out.code === "invalid_signature", "existing invalid-signature posture");
  assert(!calls.includes("resolve"), "ZERO resolver calls on an invalid signature");
  assert(noEffects(calls), "ZERO effects");
});
check("65-66. WABA-only template callback: zero resolver calls, existing ignored-receipt posture (account NULL)", async () => {
  const { out, calls } = await runWh(templateBody());
  assert(out.status === 200 && out.result === "acknowledged_ignored", `existing ignored posture (got ${JSON.stringify(out)})`);
  assert(!calls.includes("resolve"), "a WABA-only callback NEVER reaches the resolver");
  assert(calls.includes("ignored"), "the existing ignored-receipt flow still runs (provider_account_id stays NULL — it is never passed)");
  assert(!calls.includes("inbound") && !calls.includes("delivery"), "no inbound/delivery effect");
});
check("67-68. multi-message and multi-status envelopes resolve ONCE — never per message/event", async () => {
  const a = await runWh(inboundBody(3));
  assert(a.calls.filter((c) => c === "resolve").length === 1, "3 messages → still exactly ONE resolution");
  const b = await runWh(deliveryBody(3));
  assert(b.calls.filter((c) => c === "resolve").length === 1, "3 statuses → still exactly ONE resolution");
});
check("69-70. runtime gate precedes resolution; foreign identity still rejected with zero resolution", async () => {
  const g = await runWh(inboundBody(1), { enabled: false });
  assert(g.out.status === 503 && g.out.code === "webhook_processing_disabled", "runtime gate posture unchanged");
  assert(!g.calls.includes("resolve") && noEffects(g.calls), "disabled runtime resolves nothing and writes nothing");
  const body = envelope([change({ messages: [MSG("wamid.0")] })], OTHER); // foreign WABA
  const f = await runWh(body);
  assert(f.out.status === 200 && f.out.result === "rejected_foreign_identity", "existing identity-gate behavior unchanged");
  assert(!f.calls.includes("resolve") && noEffects(f.calls), "a rejected identity never reaches the resolver");
});
check("71-72. STATIC: resolver input is payload-derived (never env); logs sanitized", () => {
  const src = readFileSync(WH_SRC, "utf8");
  const code = src.split("\n").filter((l) => { const t = l.trim(); return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")); }).join("\n");
  assert(/phoneNumberReference: identity\.phoneNumberId/.test(code) && /expectedWabaId: identity\.wabaId/.test(code),
    "the resolver input comes from the PAYLOAD extractor (identity.*), never from the env identity config");
  assert(!/resolveWebhookIdentityConfig\(\)[\s\S]{0,200}resolveOwnership/.test(code), "the env identity config is never used as ownership evidence");
  const logs = code.match(/console\.\w+\([^;]*\)/g) || [];
  for (const l of logs) assert(!/\$\{|phoneNumberId|wabaId|accountId|payload|appSecret|token/.test(l), `log must be sanitized: ${l.slice(0, 70)}`);
});

// ── mutations (each must be KILLED) ─────────────────────────────────────
const pureMuts = [];
const svcMuts = [];
function pmut(name, from, to, scenario) { pureMuts.push({ name, file: ATTR_SRC, from, to, scenario }); }
function pmutE(name, from, to, scenario) { pureMuts.push({ name, file: EXTRACT_SRC, from, to, scenario }); }
function smut(name, from, to, scenario) { svcMuts.push({ name, file: SERVICE_SRC, from, to, scenario }); }

pmut("MAP-1. query_error collapsed into a deterministic rejection (loses 503 retry)",
  'case "query_error":\n      return {\n        kind: "retry",', 'case "query_error":\n      return rejected(INBOUND_ATTRIBUTION_FAILURE.NOT_FOUND); if (false) {\n        return {\n        kind: "retry",',
  (b) => b.Attr.decideInboundAttribution({ kind: "query_error" }).kind === "retry");
pmut("MAP-2. ambiguous promoted to owned via first-row",
  'case "ambiguous":\n      return rejected(INBOUND_ATTRIBUTION_FAILURE.AMBIGUOUS);', 'case "ambiguous":\n      return { kind: "owned", accountId: "first" };',
  (b) => b.Attr.decideInboundAttribution({ kind: "ambiguous", count: 2 }).kind === "rejected");
pmutE("EXT-1. extractor first-rows a conflicting messages identity",
  "if (!sawMessages || conflict || found === null)", "if (!sawMessages || false || found === null)",
  (b) => b.Extract.extractMetaWebhookAccountIdentity(messagesPayload(WABA, PHONE, [{ field: "messages", value: { metadata: { phone_number_id: OTHER } } }])).kind === "no_identity");
pmutE("EXT-2. extractor coerces a numeric (non-string) id",
  'return typeof v === "string" && v.length > 0 ? v : null;', 'return v != null ? String(v) : null;',
  (b) => b.Extract.extractMetaWebhookAccountIdentity({ object: "whatsapp_business_account", entry: [{ id: 22220000456, changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE } } }] }] }).kind === "no_identity");

smut("SVC-1. receipt binding omitted",
  ".insert({ ...naturalKey, processing_status: \"verified\", provider_account_id: providerAccountId })",
  ".insert({ ...naturalKey, processing_status: \"verified\" })",
  async (S2) => { const fk = makeFakeClient(); await S2.handleInboundWhatsAppMessages({ rawBody: "{}", payload: messagesPayload(WABA, PHONE), providerAccountId: ACC_A }, serviceDeps(S2, fk)); return fk.inserts.receipts[0]?.provider_account_id === ACC_A; });
smut("SVC-2. inbound binding omitted",
  "processing_status: processingStatusFor(identity.confidence),\n    // Phase 8B-1B-C: bind the already-approved owning account at INSERT. Only an OWNED callback reaches here.\n    provider_account_id: providerAccountId,",
  "processing_status: processingStatusFor(identity.confidence),\n    provider_account_id: null,",
  async (S2) => { const fk = makeFakeClient(); await S2.handleInboundWhatsAppMessages({ rawBody: "{}", payload: messagesPayload(WABA, PHONE), providerAccountId: ACC_A }, serviceDeps(S2, fk)); return fk.inserts.inbound[0]?.provider_account_id === ACC_A; });
smut("SVC-3. read-back account ignored (context account dropped)",
  "providerAccountId: providerAccountIdRaw as string | null,", "providerAccountId: null as string | null,",
  async (S2) => { const fk = makeFakeClient(); seedInbound(fk, "wamid.ABC", ACC_A); const out = await S2.handleInboundWhatsAppMessages({ rawBody: "{}", payload: messagesPayload(WABA, PHONE), providerAccountId: ACC_A }, serviceDeps(S2, fk)); return out.result.processed[0]?.receipt.providerAccountId === ACC_A; });
smut("SVC-4. redelivery account OVERWRITES the stored account (reassignment)",
  "if (stored !== null && stored !== providerAccountId) return { kind: \"conflict\" };",
  "if (stored !== null && stored !== providerAccountId) return { kind: existingRow ? \"duplicate\" : \"created\", context };",
  async (S2) => { const fk = makeFakeClient(); seedInbound(fk, "wamid.ABC", ACC_A); const out = await S2.handleInboundWhatsAppMessages({ rawBody: "{}", payload: messagesPayload(WABA, PHONE), providerAccountId: ACC_B }, serviceDeps(S2, fk)); return out.result.messagesRejected === 1 && fk.inbound[0].provider_account_id === ACC_A; });
smut("SVC-5. legacy NULL upgraded to the new account (surfaces the request's account instead of the stored one)",
  "providerAccountId: persistedRow.providerAccountId,",
  "providerAccountId: providerAccountId,",
  async (S2) => { const fk = makeFakeClient(); seedInbound(fk, "wamid.ABC", null); const out = await S2.handleInboundWhatsAppMessages({ rawBody: "{}", payload: messagesPayload(WABA, PHONE), providerAccountId: ACC_A }, serviceDeps(S2, fk)); return out.result.processed[0]?.receipt.providerAccountId === null; });
smut("SVC-6. read-first removed → a second row is inserted under a different account",
  "if (read.kind === \"present\") return classifyStoredInbound(read.context, providerAccountId, /*existingRow*/ true);",
  "if (read.kind === \"present\" && false) return classifyStoredInbound(read.context, providerAccountId, /*existingRow*/ true);",
  async (S2) => { const fk = makeFakeClient(); seedInbound(fk, "wamid.ABC", ACC_A); await S2.handleInboundWhatsAppMessages({ rawBody: "{}", payload: messagesPayload(WABA, PHONE), providerAccountId: ACC_B }, serviceDeps(S2, fk)); return fk.inserts.inbound.length === 0; });

const commMuts = [];
function cmut(name, from, to, scenario) { commMuts.push({ name, file: COMM_SRC, from, to, scenario }); }

cmut("DEL-1. valid receipt binding omitted",
  "signature_valid: true,\n        processing_status: \"verified\",\n        provider_account_id: providerAccountId,",
  "signature_valid: true,\n        processing_status: \"verified\",",
  async (C2) => { C = C2; const { fk } = await runWebhook({ providerAccountId: ACC_A }); return fk.inserts.receipts[0]?.provider_account_id === ACC_A; });
cmut("DEL-2. delivery-event binding omitted",
  "sanitized_metadata: event.sanitizedMetadata,\n        provider_account_id: providerAccountId,",
  "sanitized_metadata: event.sanitizedMetadata,",
  async (C2) => { C = C2; const { fk } = await runWebhook({ providerAccountId: ACC_A }); return fk.inserts.events[0]?.provider_account_id === ACC_A; });
cmut("DEL-3. invalid-signature receipt bound to an account",
  "signature_valid: false,\n          processing_status: \"rejected\",\n          failure_reason_sanitized: \"INVALID_WEBHOOK_SIGNATURE\",",
  "signature_valid: false,\n          processing_status: \"rejected\",\n          failure_reason_sanitized: \"INVALID_WEBHOOK_SIGNATURE\",\n          provider_account_id: providerAccountId,",
  async (C2) => { C = C2; const { fk } = await runWebhook({ signature: "invalid", providerAccountId: ACC_A }); return (fk.inserts.receipts[0]?.provider_account_id ?? null) === null; });
cmut("DEL-4. missing provider account allowed on a valid delivery callback",
  "if (typeof providerAccountId !== \"string\" || !PROVIDER_ACCOUNT_ID_SHAPE.test(providerAccountId)) {\n        return fail(commError(\"PROVIDER_ACCOUNT_ATTRIBUTION_REQUIRED\"));\n      }",
  "if (false) {\n        return fail(commError(\"PROVIDER_ACCOUNT_ATTRIBUTION_REQUIRED\"));\n      }",
  async (C2) => { C = C2; const { res } = await runWebhook({ providerAccountId: undefined }); return res.ok === false; });
cmut("DEL-5. legacy NULL upgraded during redelivery",
  "duplicate_count: (receipt.duplicate_count ?? 0) + 1,\n        last_duplicate_at: new Date().toISOString(),",
  "duplicate_count: (receipt.duplicate_count ?? 0) + 1,\n        last_duplicate_at: new Date().toISOString(),\n        provider_account_id: \"upgraded\",",
  async (C2) => { C = C2; const { fk } = await runWebhook({ providerAccountId: ACC_A, seed: null }); return fk.receipts[0].provider_account_id === null; });
cmut("DEL-6. cross-account redelivery inserts a SECOND receipt row",
  "if (row.signature_valid && boundAccount !== null) {\n      const existing = await this.findExistingReceipt(row);",
  "if (false) {\n      const existing = await this.findExistingReceipt(row);",
  async (C2) => { C = C2; const { fk } = await runWebhook({ providerAccountId: ACC_B, seed: ACC_A }); return fk.inserts.receipts.length === 0; });
cmut("DEL-7. cross-account redelivery mutates message lifecycle",
  "if (conflict) {",
  "if (false) {",
  async (C2) => { C = C2; const { fk } = await runWebhook({ providerAccountId: ACC_B, seed: ACC_A }); return fk.updates.messages.length === 0; });
cmut("DEL-8. the proposed account OVERWRITES the stored account (reassignment)",
  "if (stored !== null && stored !== boundAccount) return { receipt: existing, duplicate: false, conflict: true };\n        await this.incrementReceiptDuplicateCount(existing); // same account, or legacy NULL (preserved)",
  "if (stored !== null && stored !== boundAccount) { existing.provider_account_id = boundAccount; return { receipt: existing, duplicate: true, conflict: false }; }\n        await this.incrementReceiptDuplicateCount(existing); // same account, or legacy NULL (preserved)",
  async (C2) => { C = C2; const { fk } = await runWebhook({ providerAccountId: ACC_B, seed: ACC_A }); return fk.receipts[0].provider_account_id === ACC_A; });
cmut("DEL-9. ownership resolution introduced inside CommunicationService (must not compile)",
  "const boundAccount = row.provider_account_id ?? null;",
  "const boundAccount = (resolveOwningProviderAccount(), row.provider_account_id) ?? null;",
  async () => false);


const whMuts = [];
function wmut(name, from, to, scenario) { whMuts.push({ name, file: WH_SRC, from, to, scenario }); }

wmut("WH-1. ownership fence skipped entirely (resolution no longer precedes writes)",
  "    const bound = await resolveEnvelopeProviderAccount(payload, deps);",
  "    const bound = { kind: \"owned\", accountId: null } as never;",
  async (W2) => { W = W2; const { calls, threaded } = await runWh(inboundBody(1)); return calls.includes("resolve") && threaded.inbound[0] === ACC_A; });
wmut("WH-2. resolver called PER MESSAGE instead of once per envelope",
  "    const bound = await resolveEnvelopeProviderAccount(payload, deps);",
  "    await resolveEnvelopeProviderAccount(payload, deps);\n    const bound = await resolveEnvelopeProviderAccount(payload, deps);",
  async (W2) => { W = W2; const { calls } = await runWh(inboundBody(3)); return calls.filter((c) => c === "resolve").length === 1; });
wmut("WH-4. a DETERMINISTIC non-owned outcome is allowed to persist unbound",
  "    if (bound.kind !== \"owned\") return bound.outcome;",
  "    if (bound.kind !== \"owned\" && false) return bound.outcome;",
  async (W2) => { W = W2; const { calls } = await runWh(inboundBody(1), { ownership: { kind: "not_found" } }); return noEffects(calls); });
wmut("WH-5. query_error collapsed into the generic 200 posture",
  "    return { kind: \"blocked\", outcome: { status: 503, code: \"provider_account_lookup_failed\" } };",
  "    return { kind: \"blocked\", outcome: { status: 200, result: \"acknowledged_unowned_provider_account\" } };",
  async (W2) => { W = W2; const { out } = await runWh(inboundBody(1), { ownership: { kind: "query_error" } }); return out.status === 503; });
wmut("WH-6. query_error writes an ignored receipt before returning 503",
  "    console.warn(\"[webhook.provider_account_lookup_failed] the owning provider account could not be resolved; nothing was persisted (retryable).\");",
  "    await deps.recordIgnored(\"\", payload, \"ignored_unknown\");",
  async (W2) => { W = W2; const { calls } = await runWh(inboundBody(1), { ownership: { kind: "query_error" } }); return noEffects(calls); });
wmut("WH-11. a resolver EXCEPTION is caught and processing continues unbound",
  "    ownership = { kind: \"query_error\" };",
  "    ownership = { kind: \"owned\", account: { id: \"forged\", provider_key: \"x\", channel: \"whatsapp\", business_account_reference: null, phone_number_reference: null } };",
  async (W2) => { W = W2; const { out, calls } = await runWh(inboundBody(1), { resolverThrows: true }); return out.status === 503 && noEffects(calls); });

wmut("WH-3. env identity used as ownership evidence instead of the payload",
  "phoneNumberReference: identity.phoneNumberId,",
  "phoneNumberReference: process.env.WHATSAPP_PHONE_NUMBER_ID as string,",
  async () => { const code = readFileSync(WH_SRC, "utf8"); return /phoneNumberReference: identity\.phoneNumberId/.test(code) && !/process\.env\.WHATSAPP_PHONE_NUMBER_ID/.test(code); });
wmut("WH-8. a WABA-only template callback reaches the resolver",
  "classification === MetaWebhookClassification.DELIVERY_STATUS ||",
  "true ||",
  async (W2) => { W = W2; const { out, calls } = await runWh(templateBody()); return out.result === "acknowledged_ignored" && calls.includes("ignored"); });
wmut("WH-10. the owned account is NOT threaded to the delivery processing",
  "providerAccountId: providerAccountId as string,",
  "providerAccountId: \"\" as string,",
  async (W2) => { W = W2; const { threaded } = await runWh(deliveryBody(1)); return threaded.delivery[0] === ACC_A; });
wmut("WH-12. the runtime processing gate no longer precedes resolution",
  "const enabled = await deps.isWebhookProcessingEnabled(META_WHATSAPP_CLOUD_PROVIDER_KEY, CHANNEL);",
  "const enabled = true; void deps;",
  async (W2) => { W = W2; const { out, calls } = await runWh(inboundBody(1), { enabled: false }); return out.code === "webhook_processing_disabled" && !calls.includes("resolve"); });

wmut("WH-7. the deterministic non-owned branch still runs consent/ack processing",
  "    if (bound.kind !== \"owned\") return bound.outcome;",
  "    if (bound.kind !== \"owned\") { await deps.processCommands([]); return bound.outcome; }",
  async (W2) => { W = W2; const { calls } = await runWh(inboundBody(1), { ownership: { kind: "not_found" } }); return noEffects(calls); });
// ============================================================================
// Stage 2D — consent acknowledgement intent ACCOUNT INHERITANCE.
//
// The acknowledgement inherits `PersistedInboundContext.providerAccountId` (surfaced on the persisted
// receipt) and NOTHING else: not the webhook envelope decision, not env identity, not a fresh ownership
// resolution, not a provider-accounts query, not a redelivery's proposed account.
// ============================================================================
let A;
const ACK_INBOUND_ID = "44444444-4444-4444-8444-444444444444";
const ACK_RECEIPT_ID = "55555555-5555-4555-8555-555555555555";
const ACK_WAMID = "wamid.ack1";
// The AAD binds the ciphertext to the authoritative D2-D receipt, whose id must be a real UUID (or null for HELP).
const ACK_D2D_RECEIPT_ID = "66666666-6666-4666-8666-666666666666";

/**
 * Static assertions must read CODE, not prose. This module's own doc comments legitimately NAME the things
 * the ack path must never do ("never a fresh resolveOwningProviderAccount result", "never a
 * communication_provider_accounts query") — matching those would assert on the documentation instead of the
 * implementation. Strip comments first so every static proof is about real code.
 */
const codeOf = (file) => readFileSync(file, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const ackEnvelope = () => JSON.parse(envelope([change({
  messages: [{ id: ACK_WAMID, from: "15551230000", type: "text", text: { body: "STOP" }, timestamp: "1750000000" }],
})]));

/** `storedAccount` is the value the DURABLE inbound row carries. `omitAccount` simulates an integrity gap. */
function ackInput(opts = {}) {
  const { storedAccount = ACC_A, omitAccount = false, command = "stop", disposition = "stop_applied",
          replayed = false, persistedEmpty = false } = opts;
  const payload = ackEnvelope();
  // Derive the destination hash with the SAME pure normalizer + hasher the service uses, so the evidence
  // gate passes for real rather than by fixture coincidence.
  const norm = A.norm.normalizeMetaInboundWebhook(payload).find((n) => n.ok);
  const destinationHash = A.phone.hashPhoneE164(norm.senderPhoneE164);
  const receipt = {
    inboundMessageId: ACK_INBOUND_ID, provider: "meta_whatsapp_cloud", providerMessageId: ACK_WAMID,
    destinationHash, receivedAt: "2026-07-18T00:00:00.000Z",
  };
  if (!omitAccount) receipt.providerAccountId = storedAccount;
  return {
    payload, webhookReceiptId: ACK_RECEIPT_ID,
    persisted: persistedEmpty ? [] : [{ message: { providerMessageId: ACK_WAMID, messageType: "text" }, receipt }],
    commands: [{ inboundMessageId: ACK_INBOUND_ID, command, disposition, replayed }],
  };
}
function ackDeps(over = {}) {
  const calls = [], inserted = [];
  const d = {
    resolveReceiptId: async () => { calls.push("receipt"); return "receipt_id" in over ? over.receipt_id : ACK_D2D_RECEIPT_ID; },
    insertIntent: async (row) => { calls.push("insert"); inserted.push(row); return over.insertResult ?? "inserted"; },
    readStoredIntent: async () => { calls.push("read"); return over.stored ?? { kind: "absent" }; },
    seal: () => ({ ok: true, value: { ciphertext: "c", nonce: "n", authTag: "t", keyId: "k" } }),
  };
  return { d, calls, inserted };
}
async function runAck(opts = {}, over = {}) {
  const h = ackDeps(over);
  const out = await A.Ack.enqueueConsentCommandResponses(ackInput(opts), h.d);
  return { out, res: out.result, item: out.result.items[0], ...h };
}

check("73-74. a NEW bound inbound row creates ONE ack intent carrying the EXACT stored account", async () => {
  const { item, inserted, res } = await runAck({ storedAccount: ACC_A });
  assert(item.outcome === "enqueued", `enqueued (got ${item.outcome})`);
  assert(inserted.length === 1, "exactly ONE intent inserted");
  assert(inserted[0].provider_account_id === ACC_A, "the intent carries the stored account VERBATIM");
  assert(res.enqueued === 1 && res.failed === 0, "counted as enqueued");
});
check("75. the ack account comes from the PERSISTED CONTEXT, not the envelope/env identity", async () => {
  // The envelope + env in this harness are bound to ACC_A/PHONE; the STORED row says ACC_B. The stored row wins.
  const { inserted } = await runAck({ storedAccount: ACC_B });
  assert(inserted[0].provider_account_id === ACC_B, "the STORED inbound account is the sole authority");
  const code = codeOf(ACK_SRC);
  assert(!/process\.env\.WHATSAPP/.test(code), "the ack path never reads env provider identity");
});
check("76-77. the ack path resolves ownership ZERO times and never queries provider accounts", async () => {
  const code = codeOf(ACK_SRC);
  assert(!/resolveOwningProviderAccount/.test(code), "no ownership resolver in the ack path");
  assert(!/communication_provider_accounts/.test(code), "no communication_provider_accounts query");
  const { d } = ackDeps();
  assert(!("resolveOwnership" in d), "the ack deps expose NO resolver at all");
});
check("78. a SAME-ACCOUNT duplicate uses the stored account and stays idempotent", async () => {
  const { item, inserted } = await runAck({ storedAccount: ACC_A }, { stored: { kind: "present", providerAccountId: ACC_A } });
  assert(item.outcome === "duplicate", `duplicate (got ${item.outcome})`);
  assert(inserted.length === 0, "NO second intent inserted");
});
// C8B-1B-D6 Wave 2A-R1 REPLACED checks 79-81. They previously asserted that an UNBOUND (legacy-NULL)
// inbound row inherited NULL and was ENQUEUED — the Class L runtime gap (readiness verdict
// RUNTIME_GAP_FOUND). Binding is now mandatory: an unbound parent fails closed before any acknowledgement
// work, so no unbound intent can be created. The "never upgraded" guarantee is preserved and in fact
// strengthened — the path no longer even reaches the stored-row read.
check("79-80. an UNBOUND (legacy-NULL) inbound row fails closed and inserts NOTHING", async () => {
  const fresh = await runAck({ storedAccount: null });
  assert(fresh.item.outcome === "provider_account_context_missing",
    `an unbound parent fails closed (got ${fresh.item.outcome})`);
  assert(fresh.inserted.length === 0, "ZERO intents inserted for an unbound parent");
  const dup = await runAck({ storedAccount: null }, { stored: { kind: "present", providerAccountId: null } });
  assert(dup.item.outcome === "provider_account_context_missing", "a redelivery is refused identically");
  assert(dup.inserted.length === 0, "still no insert");
});
check("81. an unbound redelivery can NEVER upgrade a stored intent — it never reaches the read", async () => {
  // The inbound row is unbound but an intent already exists bound to ACC_A. Pre-Wave-2A-R1 this produced a
  // provider_account_conflict; now the account fence fires FIRST, so the stored row is never even consulted.
  const { item, inserted, calls } = await runAck({ storedAccount: null }, { stored: { kind: "present", providerAccountId: ACC_A } });
  assert(item.outcome === "provider_account_context_missing", `fail-closed (got ${item.outcome})`);
  assert(inserted.length === 0, "no upgrade, no reassignment, no second row");
  assert(!calls.includes("read") && !calls.includes("receipt"), "the stored row is never read and no receipt is looked up");
});
check("81b. a BOUND parent whose stored intent belongs to another account is still a conflict", async () => {
  // The conflict path itself is unchanged — it is now reached only with a genuinely bound parent.
  const { item, inserted } = await runAck({ storedAccount: ACC_B }, { stored: { kind: "present", providerAccountId: ACC_A } });
  assert(item.outcome === "provider_account_conflict", `conflict (got ${item.outcome})`);
  assert(inserted.length === 0, "no upgrade, no reassignment, no second row");
});
check("82. MISSING/undefined persisted account context fails closed BEFORE any ack work", async () => {
  const { item, inserted, calls, res } = await runAck({ omitAccount: true });
  assert(item.outcome === "provider_account_context_missing", `fail-closed (got ${item.outcome})`);
  assert(inserted.length === 0, "ZERO intent writes");
  assert(!calls.includes("read") && !calls.includes("receipt"), "no receipt lookup and no intent read either");
  assert(res.enqueued === 0 && res.failed === 1, "counted as a failure, never as a success");
});
check("83. a message never surfaced downstream (cross-account conflict) yields ZERO ack work", async () => {
  const { item, inserted, calls } = await runAck({ persistedEmpty: true });
  assert(item.outcome === "invalid_evidence", `no persisted evidence → no ack (got ${item.outcome})`);
  assert(inserted.length === 0 && !calls.includes("read"), "zero consent-ack processing and zero intents");
});
check("84-85. an EXISTING different-account intent is rejected without update or second insert", async () => {
  const { item, inserted } = await runAck({ storedAccount: ACC_A }, { stored: { kind: "present", providerAccountId: ACC_B } });
  assert(item.outcome === "provider_account_conflict", `conflict (got ${item.outcome})`);
  assert(inserted.length === 0, "never a second intent under another provider account");
  const code = codeOf(ACK_SRC);
  assert(!/\.update\(/.test(code), "the ack path contains NO update() at all — the column is bind-at-insert only");
});
check("86. the GLOBAL acknowledgement idempotency key/constraint is unchanged", async () => {
  const { inserted } = await runAck({ storedAccount: ACC_A });
  assert(typeof inserted[0].idempotency_key === "string" && inserted[0].idempotency_key.length > 0,
    "the intent still carries the derived global idempotency key");
  const code = codeOf(ACK_SRC);
  assert(/\.eq\("idempotency_key", idempotencyKey\)/.test(code), "the read-back keys off the SAME global key");
  assert(/code\?: string \}\)\.code === "23505"/.test(code), "the unique-violation fence is still the replay guard");
});
check("87. STOP / START / HELP command semantics are unchanged", async () => {
  const stop = await runAck({ command: "stop", disposition: "stop_applied" });
  const start = await runAck({ command: "start", disposition: "start_applied" });
  const help = await runAck({ command: "help", disposition: "help_acknowledged" });
  for (const [n, r] of [["stop", stop], ["start", start], ["help", help]]) {
    assert(r.item.outcome === "enqueued", `${n} still enqueues (got ${r.item.outcome})`);
    assert(r.inserted[0].command === n && r.inserted[0].ack_type, `${n} keeps its derived ack type`);
  }
  assert(help.calls.includes("receipt") === false, "HELP still resolves NO consent receipt");
  const ineligible = await runAck({ command: "stop", disposition: "stop_failed" });
  assert(ineligible.item.outcome === "ineligible_disposition", "ineligible dispositions are still rejected");
  const replayed = await runAck({ replayed: true });
  assert(replayed.item.outcome === "replayed" && replayed.inserted.length === 0, "replays still produce ZERO intents");
});
check("88-89. ack logs and outcomes stay sanitized; no second acknowledgement on duplicate/conflict", async () => {
  const code = codeOf(ACK_SRC);
  const logs = code.match(/console\.\w+\([^;]*\)/g) || [];
  for (const l of logs) {
    assert(!/\$\{|provider_account_id|phone_number_id|wabaId|accountId|idempotencyKey|destination/.test(l),
      `log must be sanitized: ${l.slice(0, 70)}`);
  }
  for (const stored of [{ kind: "present", providerAccountId: ACC_A }, { kind: "present", providerAccountId: ACC_B }]) {
    const { inserted } = await runAck({ storedAccount: ACC_A }, { stored });
    assert(inserted.length === 0, "neither a duplicate nor a conflict ever enqueues a second acknowledgement");
  }
});

const ackMuts = [];
function amut(name, from, to, scenario) { ackMuts.push({ name, file: ACK_SRC, from, to, scenario }); }

amut("ACK-1. the intent is written WITHOUT the inherited account",
  "provider_account_id: providerAccountId,",
  "provider_account_id: null,",
  async (A2) => { A = A2; const { inserted } = await runAck({ storedAccount: ACC_A }); return inserted[0]?.provider_account_id === ACC_A; });
amut("ACK-2. env identity is used instead of the persisted inbound context",
  "const inherited = inheritPersistedAccount(item.receipt);",
  "const inherited = { kind: \"inherited\", value: (process.env.WHATSAPP_PHONE_NUMBER_ID ?? null) } as const;",
  async (A2) => { A = A2; const { inserted } = await runAck({ storedAccount: ACC_B }); return inserted[0]?.provider_account_id === ACC_B; });
amut("ACK-3. the ack path resolves ownership again",
  "import { randomUUID } from \"crypto\";",
  "import { randomUUID } from \"crypto\";\nimport { resolveOwningProviderAccount } from \"./communicationProviderRuntimeService\";\nvoid resolveOwningProviderAccount;",
  async () => !/resolveOwningProviderAccount/.test(codeOf(ACK_SRC)));
amut("ACK-4. the ack path queries communication_provider_accounts",
  ".from(\"communication_consent_ack_intents\")",
  ".from(\"communication_provider_accounts\")",
  async () => !/communication_provider_accounts/.test(codeOf(ACK_SRC)));
amut("ACK-5. undefined context is collapsed into a legacy NULL",
  "  return { kind: \"missing\" };",
  "  return { kind: \"inherited\", value: null };",
  async (A2) => { A = A2; const { item, inserted } = await runAck({ omitAccount: true }); return item.outcome === "provider_account_context_missing" && inserted.length === 0; });
amut("ACK-6. a stored legacy NULL is treated as matching any account (silent upgrade)",
  "  if (storedAccountId === inheritedAccountId) return \"duplicate\";",
  "  if (storedAccountId === inheritedAccountId || storedAccountId === null) return \"duplicate\";",
  async (A2) => { A = A2; const { item } = await runAck({ storedAccount: ACC_A }, { stored: { kind: "present", providerAccountId: null } }); return item.outcome === "provider_account_conflict"; });
amut("ACK-7. a duplicate ack re-inserts (overwriting the bound account)",
  "  if (existing.kind === \"present\") return classifyStoredIntent(existing.providerAccountId, providerAccountId);",
  "  if (existing.kind === \"present\") { await deps.insertIntent(row); return \"duplicate\"; }",
  async (A2) => { A = A2; const { inserted } = await runAck({ storedAccount: ACC_A }, { stored: { kind: "present", providerAccountId: ACC_A } }); return inserted.length === 0; });
amut("ACK-8. a cross-account existing intent falls through and inserts a SECOND row",
  "  if (existing.kind === \"present\") return classifyStoredIntent(existing.providerAccountId, providerAccountId);",
  "  if (existing.kind === \"present\" && existing.providerAccountId === providerAccountId) return \"duplicate\";",
  async (A2) => { A = A2; const { item, inserted } = await runAck({ storedAccount: ACC_A }, { stored: { kind: "present", providerAccountId: ACC_B } }); return item.outcome === "provider_account_conflict" && inserted.length === 0; });
amut("ACK-9. a conflict is still counted/reported as an enqueued acknowledgement",
  "    if (outcome === \"enqueued\") enqueued++;",
  "    if (outcome === \"enqueued\" || outcome === \"provider_account_conflict\") enqueued++;",
  async (A2) => { A = A2; const { res } = await runAck({ storedAccount: ACC_A }, { stored: { kind: "present", providerAccountId: ACC_B } }); return res.enqueued === 0; });
amut("ACK-10. a command whose inbound row was never surfaced still reaches ack processing",
  "    if (!item) { push(null, \"invalid_evidence\"); failed++; continue; }",
  "    if (!item) { push(null, \"invalid_evidence\"); failed++; }",
  async (A2) => { A = A2; try { const { inserted } = await runAck({ persistedEmpty: true }); return inserted.length === 0; } catch { return false; } });
amut("ACK-11. an UPDATE path for provider_account_id is introduced",
  ".eq(\"idempotency_key\", idempotencyKey)",
  ".update({ provider_account_id: null }).eq(\"idempotency_key\", idempotencyKey)",
  async () => !/\.update\(/.test(codeOf(ACK_SRC)));
amut("ACK-12. the stored read-back is ignored before inserting",
  "  const existing = await readStoredIntent(deps, plan.idempotencyKey);",
  "  const existing = { kind: \"absent\" } as const;",
  async (A2) => { A = A2; const { item, inserted } = await runAck({ storedAccount: ACC_A }, { stored: { kind: "present", providerAccountId: ACC_B } }); return item.outcome === "provider_account_conflict" && inserted.length === 0; });
amut("ACK-13. the conflict log leaks the stored account identity",
  "    \"provider account than the stored inbound row; it was left unchanged and nothing was enqueued.\"",
  "    `provider account ${storedAccountId} than the stored inbound row (${inheritedAccountId}).`",
  async () => {
    const logs = codeOf(ACK_SRC).match(/console\.\w+\([^;]*\)/g) || [];
    return logs.every((l) => !/\$\{/.test(l));
  });

// ── execute ──────────────────────────────────────────────────────────────
const LOADERS = {
  [ATTR_SRC]: { files: [ATTR_SRC, EXTRACT_SRC, GATE_SRC, OWNERSHIP_SRC], load: loadPure },
  [EXTRACT_SRC]: { files: [ATTR_SRC, EXTRACT_SRC, GATE_SRC, OWNERSHIP_SRC], load: loadPure },
  [SERVICE_SRC]: { files: [SERVICE_SRC], load: loadService },
  [COMM_SRC]: { files: [COMM_SRC], load: loadComm },
  [WH_SRC]: { files: [WH_SRC], load: loadWebhook },
  [ACK_SRC]: { files: [ACK_SRC], load: loadAck },
};
async function runMutations(list, label) {
  console.log(`\nRunning ${label} mutations...\n`);
  let killed = 0, survived = 0, infra = 0;
  for (const m of list) {
    const p = resolve(ROOT, m.file);
    const cur = readFileSync(p, "utf8");
    if (!cur.includes(m.from)) { console.log(`INFRA    ${m.name} (anchor)`); infra++; continue; }
    const dir = mkdtempSync(join(tmpdir(), "phase8b1bc-mut-"));
    try {
      writeFileSync(p, cur.replace(m.from, m.to));
      let build;
      const { files, load } = LOADERS[m.file];
      try { compile(files, dir); build = load(dir); }
      catch { console.log(`KILLED   ${m.name} (compile)`); killed++; continue; }
      const stillCorrect = await m.scenario(build);
      if (stillCorrect) { console.log(`SURVIVED ${m.name}`); survived++; }
      else { console.log(`KILLED   ${m.name}`); killed++; }
    } finally { writeFileSync(p, cur); rmSync(dir, { recursive: true, force: true }); }
  }
  return { killed, survived, infra };
}

async function run() {
  console.log("Running Phase 8B-1B-C checks...\n");
  let passed = 0, failed = 0;
  const pureDir = mkdtempSync(join(tmpdir(), "phase8b1bc-pure-"));
  const svcDir = mkdtempSync(join(tmpdir(), "phase8b1bc-svc-"));
  const commDir = mkdtempSync(join(tmpdir(), "phase8b1bc-comm-"));
  const whDir = mkdtempSync(join(tmpdir(), "phase8b1bc-wh-"));
  const ackDir = mkdtempSync(join(tmpdir(), "phase8b1bc-ack-"));
  try {
    compile([ATTR_SRC, EXTRACT_SRC, GATE_SRC, OWNERSHIP_SRC], pureDir); P = loadPure(pureDir);
    compile([SERVICE_SRC], svcDir); S = loadService(svcDir);
    compile([COMM_SRC], commDir); C = loadComm(commDir);
    compile([WH_SRC], whDir); W = loadWebhook(whDir);
    compile([ACK_SRC], ackDir); A = loadAck(ackDir);
    for (const c of checks) {
      try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
      catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
    }
  } finally { for (const d of [pureDir, svcDir, commDir, whDir, ackDir]) rmSync(d, { recursive: true, force: true }); }

  const pm = await runMutations(pureMuts, "pure");
  const sm = await runMutations(svcMuts, "inbound-service");
  const cm = await runMutations(commMuts, "delivery-service");
  const wm = await runMutations(whMuts, "webhook-orchestration");
  const am = await runMutations(ackMuts, "consent-ack-inheritance");

  const killed = pm.killed + sm.killed + cm.killed + wm.killed + am.killed, survived = pm.survived + sm.survived + cm.survived + wm.survived + am.survived, infra = pm.infra + sm.infra + cm.infra + wm.infra + am.infra;
  const mutTotal = pureMuts.length + svcMuts.length + commMuts.length + whMuts.length + ackMuts.length;
  const total = passed + killed, totalFail = failed + survived + infra;
  console.log(`\nSummary: ${total} passed, ${totalFail} failed (functional: ${passed}/${checks.length}, mutation killed: ${killed}/${mutTotal}, survived: ${survived}, infra: ${infra}).`);
  process.exit(totalFail > 0 ? 1 : 0);
}
run();
