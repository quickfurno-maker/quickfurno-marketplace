import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5F-D1-B — verified WhatsApp inbound PERSISTENCE wiring + per-message idempotency +
 * fail-safe identity persistence.
 *
 * The orchestration is driven with injected coarse fakes (normalizer, identity resolver,
 * receipt/row persistence, finalization) so no database is touched; the REAL DB adapters
 * (`persistInboundRowViaDb`, `createOrResolveReceiptViaDb`) are exercised with a fake PostgREST
 * client to prove idempotent unique-conflict handling and equality-filter safety. Webhook
 * freeze + boundary checks are static. Mutations edit the REAL source and must be caught.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const TS_FILES = [
  "lib/errors.ts",
  "lib/communication/phone.ts",
  "lib/communication/dbErrors.ts",
  "lib/communication/providers/providerError.ts",
  "lib/communication/providers/providerOutcome.ts",
  "lib/communication/providers/whatsappProvider.ts",
  "lib/communication/providers/metaWhatsAppWebhook.ts",
  "lib/communication/providers/metaWhatsAppInbound.ts",
];

function compileTo(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  const tsconfigPath = resolve(`${outDir}.tsconfig.json`);
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: true, jsx: "preserve",
      outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] }, lib: ["ES2021", "DOM"],
    },
    files: TS_FILES,
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  finally { rmSync(tsconfigPath, { force: true }); }
  return outDir;
}

const SERVICE_SRC = "services/inboundWhatsAppMessageService.ts";
const WEBHOOK_SVC_SRC = "services/metaWhatsAppWebhookService.ts";
const WEBHOOK_ROUTE_SRC = "app/api/webhooks/whatsapp/meta/route.ts";
const COMM_SERVICE_SRC = "services/communicationService.ts";
const RESOLVER_SRC = "services/inboundIdentityResolutionService.ts";
const NORMALIZER_SRC = "lib/communication/providers/metaWhatsAppInbound.ts";
const DOC_D1B = "docs/QF-WhatsApp-Inbound-Persistence-Phase-5F-D1-B.md";

function transpileService(outDir) {
  const tsconfigPath = resolve(`${outDir}.svc.tsconfig.json`);
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: false, isolatedModules: true,
      outDir, rootDir: ".", types: [], noResolve: true,
    },
    files: [SERVICE_SRC],
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  catch { /* expected noResolve diagnostics */ }
  finally { rmSync(tsconfigPath, { force: true }); }
  if (!existsSync(resolve(outDir, "services/inboundWhatsAppMessageService.js"))) throw new Error("service did not transpile");
}

function stubModules(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const original = Module._load;
  const STUBS = {
    "../lib/supabase": { adminClient: () => { throw new Error("real Supabase must never run in the D1-B harness"); } },
    "./inboundIdentityResolutionService": { resolveInboundSenderIdentity: () => { throw new Error("real resolver must never run"); } },
    "../lib/communication/providers/metaCloudWhatsAppProvider": { META_WHATSAPP_CLOUD_PROVIDER_KEY: "meta_whatsapp_cloud" },
  };
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return original.apply(this, [request, parent, isMain]);
  };
  return req;
}

function wireBuild(outDir) {
  const req = stubModules(outDir);
  return {
    Service: req("./services/inboundWhatsAppMessageService.js"),
    Inbound: req("./lib/communication/providers/metaWhatsAppInbound.js"),
  };
}

const readF = (f) => readFileSync(f, "utf8");
const readCode = (p) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const MAIN_DIR = resolve(".phase5fd1b-build-main");
compileTo(MAIN_DIR);
transpileService(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// FIXTURES
// ============================================================================
const WA_ID = "919812345678";
const E164 = "+919812345678";
const PHONE_NUMBER_ID = "111222333444";

function envelope(...messages) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15550000000", phone_number_id: PHONE_NUMBER_ID },
      contacts: [{ profile: { name: "Priya Sharma" }, wa_id: WA_ID }],
      messages,
    } }] }],
  };
}
const textMsg = (over = {}) => ({ from: WA_ID, id: "wamid.X", timestamp: "1700000000", type: "text", text: { body: "Hi" }, ...over });
const RAW = (payload) => JSON.stringify(payload);

const idExact = (type = "client", id = "prin-1") => ({ confidence: "exact", principalType: type, principalId: id, candidateCount: 1 });
const idAmbiguous = () => ({ confidence: "ambiguous", principalType: null, principalId: null, candidateCount: 2 });
const idUnknown = () => ({ confidence: "unknown", principalType: null, principalId: null, candidateCount: 0 });

// ── Phase 8B-1B-C: the OWNED provider account these positive fixtures prove ownership against ──────────
// A real UUID: the service fails closed on anything that is not one. Ownership is an INPUT to this service
// (the webhook resolves it); this harness therefore supplies it rather than imitating a second resolver.
const ACCOUNT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const OTHER_ACCOUNT_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

/** Project an INSERT row into the VALIDATED durable projection the read-first bind reads back. */
const storedContextFrom = (row, providerAccountId) => ({
  id: `11111111-0000-4000-8000-${String(row.provider_message_id).replace(/\W/g, "").slice(-12).padStart(12, "0")}`,
  provider: row.provider,
  providerMessageId: row.provider_message_id,
  senderHash: row.sender_hash,
  identityConfidence: row.identity_confidence,
  principalType: row.resolved_principal_type,
  principalId: row.resolved_principal_id,
  messageType: row.message_type,
  contentMinimized: row.content_minimized,
  providerOccurredAt: row.provider_occurred_at,
  receivedAt: "2026-07-18T00:00:00.000Z",
  providerAccountId,
});

function makeDeps(over = {}) {
  const calls = { normalizes: [], identities: [], receipts: [], persists: [], finalizes: [], reads: [] };
  const persisted = over.persistedWamids ?? new Set();
  const failOnce = new Set(over.failWamids ?? []);
  // The DURABLE row model the read-first bind consults. Pre-seed it to model an already-stored row
  // (`over.storedRows`: wamid → provider_account_id, where NULL models a legacy pre-binding row).
  const stored = new Map();
  // An ALREADY-PERSISTED wamid is, by definition, an already-stored durable row: it must be visible to the
  // read-first authority, or a redelivery would look "absent" and the bind could never classify it.
  for (const w of persisted) stored.set(w, { wamid: w, providerAccountId: ACCOUNT_ID });
  for (const [wamid, acct] of Object.entries(over.storedRows ?? {})) {
    stored.set(wamid, { wamid, providerAccountId: acct === undefined ? ACCOUNT_ID : acct });
  }
  return {
    calls,
    persisted,
    stored,
    normalize: over.normalize ?? ((payload) => { calls.normalizes.push(payload); return M.Inbound.normalizeMetaInboundWebhook(payload); }),
    // Phase 5F-D1-B reliability: the resolver returns a discriminated OUTCOME. `over.resolution`
    // injects a raw outcome (e.g. an operational failure); `over.identity` is wrapped ok:true.
    resolveIdentity: over.resolveIdentity ?? (async ({ senderPhoneE164 }) => { calls.identities.push(senderPhoneE164); return over.resolution ?? { ok: true, identity: over.identity ?? idUnknown() }; }),
    // Phase 8B-1B-C: the receipt is BOUND at insert. The fake echoes the account it was asked to bind, so a
    // test that omits/changes it is visible rather than silently absorbed.
    createOrResolveReceipt: over.createOrResolveReceipt ?? (async (rawBody, payload, providerAccountId) => {
      calls.receipts.push({ rawBody, payload, providerAccountId });
      return over.receipt ?? { ok: true, receiptId: "receipt-1", duplicate: false, providerAccountId };
    }),
    persistInboundRow: over.persistInboundRow ?? (async (row) => {
      calls.persists.push(row);
      const w = row.provider_message_id;
      if (failOnce.has(w)) { failOnce.delete(w); return "failed"; }
      // Either way the row now EXISTS durably, so the read-first authority must be able to see it. A row that
      // already existed keeps its STORED account; a new row lands bound to the account the service asked for.
      const dup = persisted.has(w);
      persisted.add(w);
      if (!stored.has(w)) stored.set(w, { wamid: w, providerAccountId: row.provider_account_id ?? null });
      return dup ? "duplicate" : "created";
    }),
    // Phase 8B-1B-C READ-FIRST authority. Account-agnostic lookup by (provider, provider_message_id),
    // returning the VALIDATED durable projection — never the in-flight row.
    readStoredInbound: over.readStoredInbound ?? (async (row) => {
      calls.reads.push(row);
      if (over.readError) return { kind: "error" };
      const hit = stored.get(row.provider_message_id);
      if (!hit) return { kind: "absent" };
      return { kind: "present", context: storedContextFrom(row, hit.providerAccountId) };
    }),
    finalizeReceipt: over.finalizeReceipt ?? (async (receiptId, status, reason) => { calls.finalizes.push({ receiptId, status, reason }); }),
  };
}
const runInbound = (payload, over = {}) => {
  const deps = makeDeps(over);
  // Phase 8B-1B-C: an effect-bearing inbound callback carries its ALREADY-PROVEN owning account. Tests that
  // prove the fail-closed posture pass `providerAccountId: null/undefined/<malformed>` explicitly.
  const providerAccountId = "providerAccountId" in over ? over.providerAccountId : ACCOUNT_ID;
  return M.Service.handleInboundWhatsAppMessages({ rawBody: RAW(payload), payload, providerAccountId }, deps)
    .then((r) => ({ r, deps }));
};

/** A minimal chainable fake PostgREST client for the REAL DB adapters. `behavior(state)` returns {data,error}. */
function fakeClient(behavior) {
  const makeBuilder = () => {
    const state = { table: null, op: null, row: null, updates: null, filters: {} };
    const b = {
      _state: state,
      insert(row) { state.op = "insert"; state.row = row; return b; },
      update(obj) { state.op = "update"; state.updates = obj; return b; },
      select() { if (!state.op) state.op = "select"; return b; },
      eq(col, val) { state.filters[col] = val; return b; },
      // Defer `behavior` into a microtask so a throwing behavior becomes an async REJECTION
      // (as a real PostgREST call would), never a synchronous throw out of `.then`.
      single() { return Promise.resolve().then(() => behavior(state)); },
      limit() { return Promise.resolve().then(() => behavior(state)); },
      then(onF, onR) { return Promise.resolve().then(() => behavior(state)).then(onF, onR); },
    };
    return b;
  };
  const client = () => ({ from: (table) => { const b = makeBuilder(); b._state.table = table; return b; } });
  return client;
}

async function captureConsole(fn) {
  const methods = ["log", "error", "warn", "info", "debug"];
  const orig = {}; let buffer = "";
  for (const m of methods) { orig[m] = console[m]; console[m] = (...a) => { buffer += a.map((x) => (typeof x === "string" ? x : safeStringify(x))).join(" ") + "\n"; }; }
  try { const value = await fn(); return { value, buffer }; } finally { for (const m of methods) console[m] = orig[m]; }
}

// ============================================================================
// WEBHOOK SECURITY REGRESSION (1-6) — static on the verified webhook service
// ============================================================================
check("1-6. verified order preserved; INBOUND is the only newly wired branch", () => {
  const src = readF(WEBHOOK_SVC_SRC);
  const iSig = src.indexOf("verifyMetaWebhookSignature(");
  const iGate = src.indexOf("isWebhookProcessingEnabled(");
  const iParse = src.indexOf("safeParse(input.rawBody)");
  const iClassify = src.indexOf("classifyMetaWebhook(payload)");
  assert(iSig > 0 && iGate > 0 && iParse > 0 && iClassify > 0, "all steps present");
  assert(iSig < iParse, "1. signature verification precedes JSON parse");
  assert(iGate < iParse && iGate < iClassify, "2. runtime gate precedes parse/classification");
  assert(iParse < iClassify, "parse precedes classify");
  // 3. delivery status still on CommunicationService.processWebhook.
  //
  // PHASE 8A widened this window: the delivery branch now binds an explicit FAIL-CLOSED consent enforcer
  // to the CommunicationService it constructs (defence in depth — the object can no longer send even if a
  // future edit called a send method on it). The SEMANTIC property is unchanged and is what is asserted:
  // DELIVERY_STATUS still constructs a CommunicationService and still hands the raw body to processWebhook,
  // with nothing but that construction in between.
  //
  // PHASE 8B-1B-C moved the CommunicationService construction behind dependency injection: the classified
  // branch now calls `deps.processDelivery(...)`, and `defaultMetaWebhookDeps()` is what constructs the
  // service and hands the raw body to processWebhook. The SEMANTIC property under test is unchanged and is
  // still asserted end to end: DELIVERY_STATUS reaches processWebhook via a CommunicationService that is
  // constructed with the fail-closed enforcer, with nothing but that construction in between, and neither
  // hop sends or dispatches anything.
  const iDelivery = src.indexOf("DELIVERY_STATUS");
  const iRoute = src.indexOf("deps.processDelivery(", iDelivery);
  assert(iDelivery > 0 && iRoute > iDelivery, "3a. DELIVERY_STATUS still routes to the delivery processor");
  const iConstruct = src.indexOf("new CommunicationService(");
  const iProcess = src.indexOf("service.processWebhook(", iConstruct);
  assert(iConstruct > 0 && iProcess > iConstruct,
    "3. delivery-status path unchanged: DELIVERY_STATUS → construct CommunicationService → processWebhook");
  // The construction still binds the Phase 8A fail-closed outbound consent enforcer (defence in depth).
  assert(/new CommunicationService\([^)]*createFailClosedOutboundConsentEnforcer\(\)/.test(src),
    "3. the constructed CommunicationService still binds the FAIL-CLOSED consent enforcer");
  // Nothing between the classified delivery branch and the processWebhook hand-off may send or dispatch.
  const deliveryBranch = src.slice(iDelivery, iRoute) + src.slice(iConstruct, iProcess);
  assert(!/\.send\(|dispatchMessage\(|dispatchPersistedMessage\(/.test(deliveryBranch),
    "3. the delivery branch still performs NO send or dispatch");
  // 4. unknown still ignored_unknown.
  // 8B-1B-C: the ignored-receipt writer is now reached through the injected `recordIgnored` collaborator.
  // The property is unchanged: UNKNOWN still records an `ignored_unknown` receipt and nothing else.
  assert(/UNKNOWN[\s\S]{0,300}deps\.recordIgnored\(input\.rawBody, payload, "ignored_unknown"\)/.test(src), "4. unknown path unchanged");
  // 5. template/account still ignored_non_delivery (the trailing fallback).
  assert(/deps\.recordIgnored\(input\.rawBody, payload, "ignored_non_delivery"\)/.test(src), "5. template/account ignored path unchanged");
  // 6. INBOUND_MESSAGE is the ONLY newly wired classification → the D1-B service, NOT ignored.
  assert(/INBOUND_MESSAGE\)\s*\{[\s\S]{0,900}deps\.handleInbound\(/.test(src), "6. INBOUND_MESSAGE routes to the D1-B service");
  assert(!/INBOUND_MESSAGE[\s\S]{0,300}deps\.recordIgnored/.test(src), "INBOUND_MESSAGE no longer falls through to ignored_non_delivery");
  // The comment listing the ignored fallback no longer names inbound_message.
  assert(/template_status \/ account_status/.test(src), "the ignored fallback comment names only template/account");
});

// ============================================================================
// INBOUND NORMALIZATION HANDOFF (7-12)
// ============================================================================
check("7-8. a valid payload reaches the D1-A normalizer; multiple messages all processed", async () => {
  const { r, deps } = await runInbound(envelope(textMsg({ id: "wamid.A" }), textMsg({ id: "wamid.B" })), { identity: idUnknown() });
  assert(deps.calls.normalizes.length === 1, "the normalizer was invoked once");
  assert(r.ok && r.result.messagesSeen === 2 && r.result.messagesPersisted === 2, "both messages persisted");
  assert(deps.calls.persists.length === 2, "two rows persisted");
});

check("9-11. deterministic rejections create no row and never block a valid sibling", async () => {
  const { r, deps } = await runInbound(envelope(
    textMsg({ id: undefined }),              // MISSING_MESSAGE_ID
    textMsg({ id: "wamid.C", from: "bad" }), // SENDER_NOT_NORMALIZABLE
    textMsg({ id: "wamid.D" }),              // valid
  ));
  assert(r.ok, "the batch completes");
  assert(r.result.messagesRejected === 2, "two deterministic rejections");
  assert(r.result.messagesPersisted === 1, "one valid message still persisted");
  assert(deps.calls.persists.length === 1 && deps.calls.persists[0].provider_message_id === "wamid.D", "only the valid message created a row");
});

check("12. the raw payload never becomes content_minimized (real normalizer)", async () => {
  const { deps } = await runInbound(envelope(textMsg({ id: "wamid.E", text: { body: "hello" } })));
  const row = deps.calls.persists[0];
  const rendered = safeStringify(row);
  assert(!rendered.includes(WA_ID) && !rendered.includes("Priya Sharma") && !rendered.includes("messaging_product"), "no raw wa_id/profile/envelope in the row");
  assert(safeStringify(row.content_minimized) === JSON.stringify({ text: "hello" }), "content is minimized");
});

// ============================================================================
// IDENTITY PERSISTENCE (13-18)
// ============================================================================
check("13-14. exact client / vendor persist exact + principal", async () => {
  const c = await runInbound(envelope(textMsg({ id: "wamid.CL" })), { identity: idExact("client", "client-9") });
  const rc = c.deps.calls.persists[0];
  assert(rc.identity_confidence === "exact" && rc.resolved_principal_type === "client" && rc.resolved_principal_id === "client-9" && rc.processing_status === "identity_resolved", "exact client row");
  const v = await runInbound(envelope(textMsg({ id: "wamid.VN" })), { identity: idExact("vendor", "vendor-9") });
  const rv = v.deps.calls.persists[0];
  assert(rv.resolved_principal_type === "vendor" && rv.resolved_principal_id === "vendor-9", "exact vendor row");
});

check("15-17. ambiguous / unknown / cross-type persist a NULL principal pair", async () => {
  for (const [identity, conf, ps] of [[idAmbiguous(), "ambiguous", "identity_ambiguous"], [idUnknown(), "unknown", "identity_unknown"]]) {
    const { deps } = await runInbound(envelope(textMsg({ id: `wamid.${conf}` })), { identity });
    const row = deps.calls.persists[0];
    assert(row.identity_confidence === conf && row.resolved_principal_type === null && row.resolved_principal_id === null && row.processing_status === ps, `${conf} → null pair`);
  }
  // A cross-type conflict presents to the service as an ambiguous identity → null pair.
  const { deps } = await runInbound(envelope(textMsg({ id: "wamid.XT" })), { identity: idAmbiguous() });
  assert(deps.calls.persists[0].resolved_principal_id === null, "cross-type conflict → null principal");
});

check("18. a resolver that (buggily) returns ambiguous WITH a principal is stripped to null", async () => {
  // buildInboundRow must never carry a principal on a non-exact identity, even if handed one.
  const row = M.Service.buildInboundRow(
    { provider: "meta_whatsapp_cloud", providerMessageId: "wamid.Z", senderHash: "a".repeat(64), senderMasked: "+91******5678", messageType: "text", contentMinimized: { text: "x" }, providerOccurredAt: null, providerContext: { phoneNumberId: null } },
    { confidence: "ambiguous", principalType: "client", principalId: "should-not-persist", candidateCount: 2 },
    "receipt-1"
  );
  assert(row.resolved_principal_type === null && row.resolved_principal_id === null, "non-exact principal stripped");
});

// ============================================================================
// ROW PRIVACY (19-25)
// ============================================================================
check("19-25. the insert row carries only hashed/masked identity + minimized content", async () => {
  const { deps } = await runInbound(envelope(textMsg({ id: "wamid.P" })), { identity: idExact("client", "c1") });
  const row = deps.calls.persists[0];
  const keys = Object.keys(row);
  assert(!keys.includes("senderPhoneE164") && !keys.includes("phone_e164") && !keys.includes("wa_id"), "19-20. no plaintext sender columns");
  assert(typeof row.sender_hash === "string" && /^[0-9a-f]{64}$/.test(row.sender_hash) && typeof row.sender_masked === "string", "21. sender_hash/masked only");
  const rendered = safeStringify(row);
  assert(!rendered.includes(E164) && !rendered.includes(WA_ID), "no plaintext phone anywhere in the row");
  assert(!/app_?secret|access_?token|signature|Authorization|Bearer/i.test(rendered), "24-25. no secret/signature");
  assert(!rendered.includes("messaging_product") && !rendered.includes("contacts"), "23. no raw provider envelope");
});

// ============================================================================
// PER-MESSAGE IDEMPOTENCY (26-31)  (orchestration + real adapter)
// ============================================================================
check("26-27. first wamid inserts; a redelivery of the same wamid creates no second row", async () => {
  const persisted = new Set();
  const first = await runInbound(envelope(textMsg({ id: "wamid.DUP" })), { persistedWamids: persisted });
  assert(first.r.result.messagesPersisted === 1, "first created");
  const second = await runInbound(envelope(textMsg({ id: "wamid.DUP" })), { persistedWamids: persisted });
  assert(second.r.result.messagesPersisted === 0 && second.r.result.messagesDuplicate === 1, "redelivery is idempotent duplicate");
  assert(persisted.size === 1, "exactly one durable row");
});

check("28-29. the REAL adapter: fence conflict → duplicate; unrelated error → failed (not swallowed)", async () => {
  const created = await M.Service.persistInboundRowViaDb({ provider: "meta_whatsapp_cloud", provider_message_id: "w1" }, fakeClient(() => ({ error: null })));
  assert(created === "created", "success → created");
  const dup = await M.Service.persistInboundRowViaDb({ provider_message_id: "w1" }, fakeClient(() => ({ error: { code: "23505", constraint: "uq_comm_inbound_account_message" } })));
  assert(dup === "duplicate", "our fence conflict → duplicate");
  const other = await M.Service.persistInboundRowViaDb({ provider_message_id: "w1" }, fakeClient(() => ({ error: { code: "23505", constraint: "some_other_unique" } })));
  assert(other === "failed", "29. an UNRELATED unique violation is NOT swallowed");
  const fk = await M.Service.persistInboundRowViaDb({ provider_message_id: "w1" }, fakeClient(() => ({ error: { code: "23503" } })));
  assert(fk === "failed", "a non-unique error → failed");
});

check("30-31. overlapping batches A/B then B/C yield exactly A/B/C; no fabricated id", async () => {
  const persisted = new Set();
  const b1 = await runInbound(envelope(textMsg({ id: "wamid.A" }), textMsg({ id: "wamid.B" })), { persistedWamids: persisted });
  const b2 = await runInbound(envelope(textMsg({ id: "wamid.B" }), textMsg({ id: "wamid.C" })), { persistedWamids: persisted });
  assert([...persisted].sort().join(",") === "wamid.A,wamid.B,wamid.C", "exactly A,B,C durable");
  assert(b2.r.result.messagesPersisted === 1 && b2.r.result.messagesDuplicate === 1, "B duplicate, C created");
  // A message with no id is never fabricated into an identity.
  const noId = await runInbound(envelope(textMsg({ id: undefined })));
  assert(noId.r.result.messagesRejected === 1 && noId.deps.calls.persists.length === 0, "missing id → rejected, no row");
});

// ============================================================================
// RECEIPT RETRY SAFETY (32-38)
// ============================================================================
check("32-33. receipt created and linked; a duplicate receipt reuses the existing id", async () => {
  const { deps } = await runInbound(envelope(textMsg({ id: "wamid.R" })), { receipt: { ok: true, receiptId: "rid-7", duplicate: false } });
  assert(deps.calls.persists[0].webhook_receipt_id === "rid-7", "row linked to the receipt id");
  const dup = await runInbound(envelope(textMsg({ id: "wamid.R2" })), { receipt: { ok: true, receiptId: "rid-7", duplicate: true } });
  assert(dup.r.result.receiptDuplicate === true && dup.deps.calls.persists[0].webhook_receipt_id === "rid-7", "duplicate reuses the id");
});

check("34. a DUPLICATE receipt does NOT skip per-message processing", async () => {
  const persisted = new Set(); // B not yet durable
  const { r, deps } = await runInbound(envelope(textMsg({ id: "wamid.B" })), { receipt: { ok: true, receiptId: "rid-8", duplicate: true }, persistedWamids: persisted });
  assert(deps.calls.persists.length === 1 && r.result.messagesPersisted === 1, "the message was still evaluated and persisted on a duplicate receipt");
});

check("35-38. partial failure → 500; retry makes progress → processed 200; no message lost", async () => {
  const persisted = new Set();
  // First attempt: A ok, B fails once.
  const first = await runInbound(envelope(textMsg({ id: "wamid.A" }), textMsg({ id: "wamid.B" })), { persistedWamids: persisted, failWamids: ["wamid.B"] });
  assert(first.r.ok === false, "35. a real persistence failure returns ok:false (→ webhook 500)");
  assert(first.deps.calls.finalizes.some((f) => f.status === "failed"), "receipt finalized failed");
  assert(persisted.has("wamid.A") && !persisted.has("wamid.B"), "A durable, B not yet");
  // Retry same payload: A duplicate, B now inserts.
  const retry = await runInbound(envelope(textMsg({ id: "wamid.A" }), textMsg({ id: "wamid.B" })), { persistedWamids: persisted });
  assert(retry.r.ok === true, "37. retry succeeds (→ webhook 200)");
  assert(retry.r.result.messagesDuplicate === 1 && retry.r.result.messagesPersisted === 1, "36. A duplicate + B inserts");
  assert(retry.deps.calls.finalizes.some((f) => f.status === "processed"), "receipt finalized processed on retry");
  assert(persisted.has("wamid.A") && persisted.has("wamid.B"), "38. no message permanently lost");
});

// ============================================================================
// RECEIPT STATUS (39-44)
// ============================================================================
check("39-42. rejected/processed/duplicate/mixed all ACK 200 with the right receipt status", async () => {
  const rej = await runInbound(envelope(textMsg({ id: undefined }), textMsg({ id: "wamid.q", from: "bad" })));
  assert(rej.r.ok && rej.deps.calls.finalizes[0].status === "rejected", "39. all deterministic rejections → rejected");
  const ok1 = await runInbound(envelope(textMsg({ id: "wamid.ok" })));
  assert(ok1.r.ok && ok1.deps.calls.finalizes[0].status === "processed", "40. valid → processed");
  const persisted = new Set(["wamid.d"]);
  const dup = await runInbound(envelope(textMsg({ id: "wamid.d" })), { persistedWamids: persisted });
  assert(dup.r.ok && dup.deps.calls.finalizes[0].status === "processed", "41. all duplicates → processed");
  const mixed = await runInbound(envelope(textMsg({ id: undefined }), textMsg({ id: "wamid.mx" })));
  assert(mixed.r.ok && mixed.r.result.messagesPersisted === 1 && mixed.r.result.messagesRejected === 1 && mixed.deps.calls.finalizes[0].status === "processed", "42. mixed → processed");
});

check("43-44. a real DB failure → failed + ok:false with a sanitized, stable reason", async () => {
  const { r, deps } = await runInbound(envelope(textMsg({ id: "wamid.f" })), { persistInboundRow: async () => "failed" });
  assert(r.ok === false, "43. real failure → ok:false (→ 500)");
  const fin = deps.calls.finalizes.find((f) => f.status === "failed");
  assert(fin && /^[a-z_]+$/.test(fin.reason) && !fin.reason.includes(WA_ID), "44. sanitized, stable reason code");
});

// ============================================================================
// RACE / DUPLICATE + ADAPTER (58-61)
// ============================================================================
check("58. two workers on the same wamid → one row (adapter conflict is idempotent)", async () => {
  // Simulate: first insert succeeds, the racing second sees the fence conflict.
  let inserted = false;
  const client = fakeClient((state) => {
    if (state.op === "insert" && state.table === "communication_inbound_messages") {
      if (inserted) return { error: { code: "23505", constraint: "uq_comm_inbound_account_message" } };
      inserted = true; return { error: null };
    }
    return { data: null, error: null };
  });
  const a = await M.Service.persistInboundRowViaDb({ provider_message_id: "race" }, client);
  const b = await M.Service.persistInboundRowViaDb({ provider_message_id: "race" }, client);
  assert(a === "created" && b === "duplicate", "one created, one idempotent duplicate");
});

check("59. a duplicate_count update failure does not corrupt the correctness path", async () => {
  // Receipt insert conflicts; findExisting returns a row; the diagnostic update THROWS.
  const client = fakeClient((state) => {
    if (state.op === "insert") return { error: { code: "23505", constraint: "uq_comm_webhook_receipt_provider_event" } };
    if (state.op === "select") return { data: [{ id: "rid-x", duplicate_count: 3 }] };
    if (state.op === "update") throw new Error("diagnostic update failed");
    return { data: null, error: null };
  });
  const res = await M.Service.createOrResolveReceiptViaDb("raw", envelope(textMsg()), ACCOUNT_ID, client);
  assert(res.ok === true && res.receiptId === "rid-x" && res.duplicate === true, "still resolves the receipt despite the count failure");
});

check("60. receipt resolution failure fails closed (ok:false → 500)", async () => {
  // Conflict but NO existing row found → cannot obtain a usable receipt → fail closed.
  const noExisting = fakeClient((state) => {
    if (state.op === "insert") return { error: { code: "23505", constraint: "uq_comm_webhook_receipt_provider_event" } };
    if (state.op === "select") return { data: [] };
    return { data: null, error: null };
  });
  const r1 = await M.Service.createOrResolveReceiptViaDb("raw", envelope(textMsg()), ACCOUNT_ID, noExisting);
  assert(r1.ok === false, "no existing receipt → ok:false");
  const nonUnique = fakeClient((state) => (state.op === "insert" ? { error: { code: "08006" } } : { data: null, error: null }));
  const r2 = await M.Service.createOrResolveReceiptViaDb("raw", envelope(textMsg()), ACCOUNT_ID, nonUnique);
  assert(r2.ok === false, "a non-unique DB error → ok:false");
  // The orchestrator turns an unusable receipt into ok:false without persisting.
  const orch = await runInbound(envelope(textMsg({ id: "wamid.x" })), { createOrResolveReceipt: async () => ({ ok: false }) });
  assert(orch.r.ok === false && orch.deps.calls.persists.length === 0, "orchestration fails closed with no rows");
});

check("61. the receipt lookup uses ONLY equality filters — no interpolated PostgREST OR", async () => {
  let sawEventFilter = false;
  const client = fakeClient((state) => {
    if (state.op === "insert") return { error: { code: "23505", constraint: "uq_comm_webhook_receipt_provider_event" } };
    if (state.op === "select") {
      // The filter object must be built from .eq() only — never a raw `or=` string.
      assert(typeof state.filters.provider === "string" && typeof state.filters.signature_valid === "boolean", "scoped by equality");
      if (state.filters.provider_event_id) sawEventFilter = true;
      return { data: [{ id: "rid-eq", duplicate_count: 0 }] };
    }
    return { data: null, error: null };
  });
  const res = await M.Service.createOrResolveReceiptViaDb("raw", envelope(textMsg()), ACCOUNT_ID, client);
  assert(res.ok && res.receiptId === "rid-eq" && sawEventFilter, "resolved via equality filters incl. provider_event_id");
  const src = readCode(SERVICE_SRC);
  assert(!/\.or\(/.test(src), "the service never uses a PostgREST .or() filter");
});

// ============================================================================
// IDENTITY-LOOKUP FAILURE vs DURABLE UNKNOWN (reliability correction)
// ============================================================================
check("R1-R3. zero candidates → UNKNOWN row 200; one → EXACT 200; multiple → AMBIGUOUS 200 (successful lookups)", async () => {
  const unk = await runInbound(envelope(textMsg({ id: "wamid.U" })), { resolution: { ok: true, identity: idUnknown() } });
  assert(unk.r.ok && unk.deps.calls.persists[0].identity_confidence === "unknown", "R1. successful zero-candidate → durable UNKNOWN row, 200");
  const ex = await runInbound(envelope(textMsg({ id: "wamid.EX" })), { resolution: { ok: true, identity: idExact("client", "c1") } });
  assert(ex.r.ok && ex.deps.calls.persists[0].identity_confidence === "exact", "R2. one candidate → EXACT row, 200");
  const am = await runInbound(envelope(textMsg({ id: "wamid.AM" })), { resolution: { ok: true, identity: idAmbiguous() } });
  assert(am.r.ok && am.deps.calls.persists[0].identity_confidence === "ambiguous", "R3. multiple → AMBIGUOUS row, 200");
});

check("R4-R10. an operational lookup failure → no row, receipt failed, ok:false, sanitized code, no raw error", async () => {
  // A resolver ok:false (any failing finder) and a THROWING resolver both fail closed, retryably.
  for (const over of [
    { resolution: { ok: false, code: "IDENTITY_LOOKUP_FAILED" } },
    { resolveIdentity: async () => { throw new Error("db unavailable: SQLSTATE 08006 connection reset by peer"); } },
  ]) {
    const { r, deps } = await runInbound(envelope(textMsg({ id: "wamid.LF" })), over);
    assert(r.ok === false, "R4-6. lookup failure → ok:false (webhook 500)");
    assert(deps.calls.persists.length === 0, "R7. NOT persisted");
    assert(r.result.identityUnknown === 0 && r.result.messagesPersisted === 0, "R7. never counted/persisted as identity_unknown");
    const fin = deps.calls.finalizes.find((f) => f.status === "failed");
    assert(fin && fin.reason === "identity_lookup_failed", "receipt finalized failed with a stable code");
    assert(r.code === "identity_lookup_failed" && /^[a-z_]+$/.test(r.code), "R8. exposes only a stable sanitized code");
    const rendered = safeStringify({ code: r.code, reason: fin.reason });
    assert(!/SQLSTATE|connection reset|db unavailable|error|exception|stack/i.test(rendered), "R9-10. no raw DB error returned or persisted");
  }
});

check("R11-R13. partial batch: A persists, B lookup fails → 500; retry → A dup + B persists → processed 200", async () => {
  const B_E164 = "+919800000000";
  const payload = envelope(textMsg({ id: "wamid.A", from: WA_ID }), textMsg({ id: "wamid.B", from: "919800000000" }));
  const persisted = new Set();
  let bFailedOnce = false;
  const resolveIdentity = async ({ senderPhoneE164 }) => {
    if (senderPhoneE164 === B_E164 && !bFailedOnce) { bFailedOnce = true; return { ok: false, code: "IDENTITY_LOOKUP_FAILED" }; }
    return { ok: true, identity: idUnknown() };
  };
  const first = await runInbound(payload, { persistedWamids: persisted, resolveIdentity });
  assert(first.r.ok === false && first.r.code === "identity_lookup_failed", "R11. first attempt fails (B lookup failed)");
  assert(persisted.has("wamid.A") && !persisted.has("wamid.B"), "R11. A persisted; B NOT persisted (never as unknown)");
  const retry = await runInbound(payload, { persistedWamids: persisted, resolveIdentity });
  assert(retry.r.ok === true && retry.r.result.messagesDuplicate === 1 && retry.r.result.messagesPersisted === 1, "R12. retry: A duplicate + B created");
  assert(persisted.has("wamid.B") && retry.deps.calls.finalizes.some((f) => f.status === "processed"), "R12-13. B persisted on retry; receipt processed");
});

// ============================================================================
// BOUNDARIES (45-57) — static + git
// ============================================================================
check("45-53. no consent / command / event / n8n / send / AI / conversation / window", () => {
  const src = readCode(SERVICE_SRC);
  assert(!/communication_preferences|communication_suppressions|consent/i.test(src), "45. no consent read/write");
  assert(!/\bSTOP\b|\bSTART\b|\bUNSUBSCRIBE\b|opt_out|opt_in/.test(src), "46. no STOP/START command handling");
  assert(!/domain_events|outbox_events|emitEvent|dispatchEvent/i.test(src), "47-48. no domain/outbox event");
  assert(!/\bn8n\b/i.test(src), "49. no n8n");
  assert(!/CommunicationService|sendTemplateMessage|sendAuthenticationMessage|sendResolvedAuthenticationSms|sendResolvedTemplate|\.send\(/.test(src), "50. no send method");
  assert(!/\bjarvis\b|openai|anthropic|\bllm\b|ai_reply/i.test(src), "51. no AI/Jarvis");
  assert(!/communication_conversations|conversation_id|last_inbound_at|24.?hour|service_window|human_handoff/i.test(src), "52-53. no conversation / 24h-window");
});

check("54-57. no new API route, no migration, no env, no Meta activation", () => {
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
  for (const p of dirty) {
    assert(!/^app\/api\/.*route\.ts$|^pages\/api\//.test(p), `54. no API route added (${p})`);
    assert(!p.startsWith("supabase/migrations"), `55. no migration (${p})`);
    assert(!/\.env/.test(p), `56. no env change (${p})`);
  }
  const src = readCode(SERVICE_SRC) + readCode(WEBHOOK_SVC_SRC);
  assert(!/webhook_processing_enabled\s*=|activation_status\s*=|outbound_enabled\s*=|is_operationally_enabled\s*=/.test(src), "57. no Meta/runtime activation");
});

check("wiring: the d1b script + doc exist; the webhook route is unchanged", () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:d1b"] === "node scripts/phase5f-d1b-whatsapp-inbound-persistence-harness.mjs", "d1b wired");
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
  assert(!dirty.includes(WEBHOOK_ROUTE_SRC), "24. the webhook route is unchanged");

  // ── PHASE 8A history (PRESERVED) → PHASE 8B-1A service AUTHORITY TRANSFER ────────────────────────────
  //
  // HISTORY (kept as the pre-8B-1A record, not the active baseline): Phase 8A made the consent enforcer a
  // REQUIRED constructor argument; the previous guard proved the webhook service, minus ONLY that authorized
  // Phase 8A delta, was byte-identical to the Phase 7 authority form (b0d40819). D1-B's concern was — and
  // remains — that INBOUND PERSISTENCE is unaffected and NO send path is reachable from the webhook.
  //
  // Phase 8B-1A legitimately RESTRUCTURES the service (production byte entry + gated string wrapper +
  // NON-exported downstream stage + callback-identity gate). That reverse-the-8A-delta byte-identity therefore
  // no longer holds and is REPLACED — not deleted — by a fixed Phase 8B-1A service BYTE-FREEZE against Commit 1,
  // plus the extended semantic proofs below. The Phase 7/8A authority commit is kept here as history.
  //
  // PHASE 8B-1A → PHASE 8B-1B-C AUTHORITY TRANSFER (this record REPLACES the active baseline; the 8B-1A
  // record below is PRESERVED as history and still asserted against its own commit).
  //
  // Phase 8B-1B-C legitimately restructures the webhook service again: an effect-bearing INBOUND_MESSAGE or
  // DELIVERY_STATUS callback must now PROVE exact provider-account ownership before any receipt, inbound,
  // delivery, consent-command or acknowledgement effect. The service gained dependency-injected collaborators
  // (`MetaWebhookDeps` / `defaultMetaWebhookDeps()`), a resolve-ONCE-per-envelope ownership fence
  // (`resolveEnvelopeProviderAccount`) placed AFTER the signature/identity/runtime gates and BEFORE every
  // write, and threading of the proven account into inbound persistence and delivery processing.
  //
  // D1-B's concern is unchanged and still proven below: inbound persistence is unaffected in kind, and NO
  // send path is reachable from the webhook. Reviewed and committed as e742bb14 (Stage 2F).
  const PHASE_8A_AUTHORITY_BASE = "b0d40819c655df7e68135b52b5435941f793fc36"; // pre-8B-1A history (recorded, not the active baseline)
  const PHASE_8B1A_AUTHORITY_BASE = "95c5e969ce585fd435019fdb17265ece6fdb9c1d";
  const PHASE_8B1A_IMPLEMENTATION_HEAD = "fe10c2c70691809952f53c7244b8d3b5cb1a150d";
  const PHASE_8B1A_SERVICE_BLOB = "454bb9195e68e481c190f8aa12ef1c19a09b8936"; // 8B-1A history (recorded, not the active baseline)
  const PHASE_8B1BC_IMPLEMENTATION_HEAD = "e742bb149b635f63b00975fa93be0a5fc14a2e24";
  const PHASE_8B1BC_SERVICE_BLOB = "58250b722b147f3673dedf37e5f3346dad17b03d";

  // The Phase 7/8A history commit still exists; the Phase 8B-1A commits exist; base → implementation head →
  // HEAD ancestry (FIXED endpoints, never a moving HEAD).
  for (const sha of [PHASE_8A_AUTHORITY_BASE, PHASE_8B1A_AUTHORITY_BASE, PHASE_8B1A_IMPLEMENTATION_HEAD, PHASE_8B1BC_IMPLEMENTATION_HEAD]) {
    assert(execFileSync("git", ["cat-file", "-t", sha], { encoding: "utf8" }).trim() === "commit", `the commit ${sha.slice(0, 12)} must exist`);
  }
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1A_AUTHORITY_BASE, PHASE_8B1A_IMPLEMENTATION_HEAD]); // throws if not
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1A_IMPLEMENTATION_HEAD, "HEAD"]);                   // throws if not
  // The transfer is FORWARD-ONLY: the 8B-1A implementation head must be an ancestor of the 8B-1B-C one, and
  // that one an ancestor of HEAD. FIXED endpoints throughout — never a moving HEAD as a baseline.
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1A_IMPLEMENTATION_HEAD, PHASE_8B1BC_IMPLEMENTATION_HEAD]); // throws if not
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1BC_IMPLEMENTATION_HEAD, "HEAD"]);                        // throws if not

  // THE ACTIVE SERVICE BYTE-FREEZE — Commit 1 resolves the service to its reviewed blob, and the on-disk service
  // is byte-identical to it. A future dirty OR committed service edit fails until another EXPLICIT authority
  // transfer. (This replaces the obsolete reverse-8A-delta byte-identity assertion.)
  // HISTORY (preserved, still enforced against its OWN commit): Phase 8B-1A Commit 1 resolves the webhook
  // service to the blob that was reviewed at that time. This record is never rewritten by a later transfer.
  const commit1ServiceBlob = execFileSync("git", ["rev-parse", `${PHASE_8B1A_IMPLEMENTATION_HEAD}:${WEBHOOK_SVC_SRC}`], { encoding: "utf8" }).trim();
  assert(commit1ServiceBlob === PHASE_8B1A_SERVICE_BLOB, `Commit 1 must resolve the webhook service to its reviewed blob (got ${commit1ServiceBlob.slice(0, 12)})`);

  // THE ACTIVE SERVICE BYTE-FREEZE (Phase 8B-1B-C). The reviewed implementation commit resolves the service
  // to its approved blob, and the on-disk service is byte-identical to it. Enforcement is UNWEAKENED: any
  // later edit — dirty OR committed — fails until the next EXPLICIT authority transfer.
  const c8b1bcServiceBlob = execFileSync("git", ["rev-parse", `${PHASE_8B1BC_IMPLEMENTATION_HEAD}:${WEBHOOK_SVC_SRC}`], { encoding: "utf8" }).trim();
  assert(c8b1bcServiceBlob === PHASE_8B1BC_SERVICE_BLOB,
    `the C8B-1B-C implementation commit must resolve the webhook service to its reviewed blob (got ${c8b1bcServiceBlob.slice(0, 12)})`);
  const onDiskServiceBlob = execFileSync("git", ["hash-object", WEBHOOK_SVC_SRC], { encoding: "utf8" }).trim();
  assert(onDiskServiceBlob === PHASE_8B1BC_SERVICE_BLOB,
    `the webhook service is not byte-identical to its Phase 8B-1B-C baseline (commit ${PHASE_8B1BC_IMPLEMENTATION_HEAD.slice(0, 12)}). ` +
    `A change — dirty OR committed — requires an EXPLICIT AUTHORITY TRANSFER (on-disk ${onDiskServiceBlob.slice(0, 12)} != pinned ${PHASE_8B1BC_SERVICE_BLOB.slice(0, 12)}).`);

  // The webhook's use of CommunicationService is still exactly one operation, and still no send.
  const hook = readCode(WEBHOOK_SVC_SRC);
  const ops = [...hook.matchAll(/service\.([A-Za-z]+)\(/g)].map((m) => m[1]);
  assert(ops.length > 0 && ops.every((o) => o === "processWebhook"),
    `processWebhook remains the ONLY CommunicationService operation (got [${ops.join(", ")}])`);
  assert(!/\.send\(|dispatchMessage\(|dispatchPersistedMessage\(|createRuntimeCommunicationService/.test(hook),
    "no outbound send call, dispatch, or sending-service factory was added to the webhook");
  // No consent DECISION is made during webhook persistence — only a fail-closed enforcer is BOUND.
  assert(!/decideCommunicationConsent|createOutboundConsentEnforcer\b/.test(hook),
    "the webhook makes NO consent decision and never binds the real consent authority");

  // ── PHASE 8B-1A — the webhook's identity-gated shape, proven from the (comment-stripped) service source ──
  // The production byte entry is EXPORTED; the historical public symbol is a UTF-8 STRING WRAPPER delegating
  // DIRECTLY to it, with NO independent (weaker) verification/parse/identity/downstream path.
  assert(/export async function handleMetaWhatsAppWebhookPostBytes\(\s*input:/.test(hook), "handleMetaWhatsAppWebhookPostBytes is exported (the production byte entry)");
  const wrapper = (hook.match(/export function handleMetaWhatsAppWebhookPost\(\s*input:[\s\S]*?\): Promise<[^>]*> \{[\s\S]*?\n\}/) || [""])[0];
  assert(wrapper, "the historical public handleMetaWhatsAppWebhookPost wrapper is present");
  assert(/new TextEncoder\(\)\.encode\(input\.rawBody\)/.test(wrapper) && /handleMetaWhatsAppWebhookPostBytes\(\s*\{/.test(wrapper), "the historical wrapper encodes UTF-8 bytes and delegates to the byte entry");
  assert(!/verifyMetaWebhookSignature|safeParse|decideCallbackIdentity|isWebhookProcessingEnabled|processVerifiedExpectedMetaWebhook/.test(wrapper), "the historical wrapper has NO independent verification/parse/identity/downstream path");
  // The downstream lifecycle stage is NON-exported (route-unreachable), with exactly one internal call site.
  assert(/(^|\n)\s*async function processVerifiedExpectedMetaWebhook\(/.test(hook) && !/export\s+(async\s+)?function\s+processVerifiedExpectedMetaWebhook/.test(hook), "processVerifiedExpectedMetaWebhook is NON-exported");
  assert((hook.match(/processVerifiedExpectedMetaWebhook\(/g) || []).length === 2, "processVerifiedExpectedMetaWebhook has exactly its definition + ONE internal call site (no bypass caller)");
  // ORDER within the byte entry: strict byte-signature verification precedes UTF-8 decode; decode + parse
  // precede identity; identity config + decision precede the downstream call; and a rejected / unsupported
  // identity RETURNS before the downstream (before inbound persistence).
  const be = (hook.match(/export async function handleMetaWhatsAppWebhookPostBytes\(\s*input:[\s\S]*?\): Promise<[^>]*> \{[\s\S]*?\n\}/) || [""])[0];
  const at = (s) => { const i = be.indexOf(s); assert(i >= 0, `byte-entry anchor missing: ${s}`); return i; };
  const iVerify = at("verifyMetaWebhookSignatureBytes(input.rawBytes");
  const iDecode = at("META_UTF8_DECODER.decode(input.rawBytes)");
  const iParse = at("safeParse(decoded)");
  const iIdCfg = at("resolveWebhookIdentityConfig()");
  const iDecide = at("decideCallbackIdentity(payload");
  const iReject = at("rejected_foreign_identity");
  const iUnsupported = at("acknowledged_unsupported_identity_shape");
  const iDownstream = at("return processVerifiedExpectedMetaWebhook(");
  assert(iVerify < iDecode, "strict byte signature verification precedes UTF-8 decode");
  assert(iDecode < iParse && iParse < iIdCfg, "decode + parse precede identity configuration");
  assert(iIdCfg < iDecide && iDecide < iDownstream, "identity config + decision precede the downstream call (before the runtime DB gate)");
  assert(iReject < iDownstream && iUnsupported < iDownstream, "rejected / unsupported identity returns BEFORE the downstream (before inbound persistence)");
  // The runtime DB gate + inbound persistence live in the NON-exported downstream — reached ONLY after the
  // identity gate. Neither appears in the byte entry, so there is no direct production identity bypass.
  assert(!be.includes("isWebhookProcessingEnabled") && !be.includes("handleInboundWhatsAppMessages"), "the runtime DB gate + handleInboundWhatsAppMessages are NOT in the byte entry — reached only via the downstream, after authorized identity");
  assert(/isWebhookProcessingEnabled\(/.test(hook) && /handleInboundWhatsAppMessages\(/.test(hook), "the runtime DB gate + handleInboundWhatsAppMessages exist in the downstream stage");
  // The pure normalizer is unchanged (reused). The identity RESOLVER is modified by this D1-B
  // reliability correction (operational IDENTITY_LOOKUP_FAILED ≠ durable UNKNOWN), so it is expected
  // in the delta and not asserted byte-unchanged here.
  assert(!dirty.includes(NORMALIZER_SRC), "the D1-A normalizer is unchanged (reused)");
  for (const f of [SERVICE_SRC, DOC_D1B]) assert(existsSync(f), `${f} exists`);
  const doc = readF(DOC_D1B);
  for (const topic of [
    /verification order.*preserved|preserves.*verification/i, /only\b[\s\S]{0,20}INBOUND_MESSAGE/i, /receipt.*per-message|different responsibilit/i,
    /do not blindly short-circuit|does not.*short-circuit/i, /wamid/i, /partial.*retry|retry model/i, /identity mapping/i,
    /minimiz/i, /no plaintext sender/i, /no reply/i, /no consent/i, /no command/i, /no.*event|no outbox/i, /no n8n/i,
    /no AI|no Jarvis/i, /no conversation/i, /Meta remains disabled/i,
  ]) assert(topic.test(doc), `doc covers ${topic}`);
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutationChecks = [];
function tsMutation(name, edits, scenario) { mutationChecks.push({ name, kind: "ts", edits: edits.map(([file, from, to]) => ({ file, from, to })), scenario }); }
function srcMutation(name, file, from, to, scenario) { mutationChecks.push({ name, kind: "src", edits: [{ file, from, to }], scenario }); }

tsMutation("MUT A: a duplicate receipt short-circuits the whole payload",
  [[SERVICE_SRC, "  // 3) Per-message processing. A DUPLICATE receipt does NOT skip this loop", "  if (receipt.duplicate) return { ok: true, result };\n  // 3) Per-message processing. A DUPLICATE receipt does NOT skip this loop"]],
  async (mm) => {
    // Partial-progress: receipt duplicate but B not yet durable → the skip loses B forever.
    const persisted = new Set();
    const deps = makeDeps({ receipt: { ok: true, receiptId: "r", duplicate: true }, persistedWamids: persisted });
    await mm.Service.handleInboundWhatsAppMessages({ rawBody: "x", payload: envelope(textMsg({ id: "wamid.B" })), providerAccountId: ACCOUNT_ID }, deps);
    return deps.calls.persists.length === 0; // the message was skipped
  });

tsMutation("MUT B: a per-message unique conflict is treated as fatal",
  [[SERVICE_SRC, '    if (isInboundDuplicateViolation(error)) return "duplicate";', '    if (isInboundDuplicateViolation(error)) return "failed";']],
  async (mm) => {
    const out = await mm.Service.persistInboundRowViaDb({ provider_message_id: "w" }, fakeClient(() => ({ error: { code: "23505", constraint: "uq_comm_inbound_account_message" } })));
    return out === "failed"; // an idempotent duplicate was wrongly treated as a failure
  });

tsMutation("MUT C: all DB errors are swallowed as duplicates",
  [[SERVICE_SRC, '    if (isInboundDuplicateViolation(error)) return "duplicate";\n    return "failed";', '    return "duplicate";']],
  async (mm) => {
    const out = await mm.Service.persistInboundRowViaDb({ provider_message_id: "w" }, fakeClient(() => ({ error: { code: "23503" } })));
    return out === "duplicate"; // an unrelated error was swallowed as a duplicate success
  });

tsMutation("MUT D: senderPhoneE164 is added to the insert row",
  [[SERVICE_SRC, "    provider: message.provider,", "    provider: message.provider,\n    senderPhoneE164: (message as any).senderPhoneE164,"]],
  (mm) => {
    const row = mm.Service.buildInboundRow(
      { provider: "meta_whatsapp_cloud", providerMessageId: "w", senderHash: "a".repeat(64), senderMasked: "m", messageType: "text", contentMinimized: {}, providerOccurredAt: null, providerContext: { phoneNumberId: null } },
      { confidence: "unknown", principalType: null, principalId: null, candidateCount: 0 }, "r");
    return Object.prototype.hasOwnProperty.call(row, "senderPhoneE164"); // a plaintext-phone key leaked into the row
  });

tsMutation("MUT E: an ambiguous identity is allowed to carry a principal",
  [[SERVICE_SRC, "    resolved_principal_type: isExact ? identity.principalType : null,\n    resolved_principal_id: isExact ? identity.principalId : null,", "    resolved_principal_type: identity.principalType,\n    resolved_principal_id: identity.principalId,"]],
  (mm) => {
    const row = mm.Service.buildInboundRow(
      { provider: "meta_whatsapp_cloud", providerMessageId: "w", senderHash: "a".repeat(64), senderMasked: "m", messageType: "text", contentMinimized: {}, providerOccurredAt: null, providerContext: { phoneNumberId: null } },
      { confidence: "ambiguous", principalType: "vendor", principalId: "v", candidateCount: 2 }, "r");
    return row.resolved_principal_id === "v"; // ambiguous carried a principal
  });

tsMutation("MUT F: an unknown identity is allowed to carry a principal",
  [[SERVICE_SRC, "    resolved_principal_type: isExact ? identity.principalType : null,\n    resolved_principal_id: isExact ? identity.principalId : null,", "    resolved_principal_type: identity.principalType,\n    resolved_principal_id: identity.principalId,"]],
  (mm) => {
    const row = mm.Service.buildInboundRow(
      { provider: "meta_whatsapp_cloud", providerMessageId: "w", senderHash: "a".repeat(64), senderMasked: "m", messageType: "text", contentMinimized: {}, providerOccurredAt: null, providerContext: { phoneNumberId: null } },
      { confidence: "unknown", principalType: "client", principalId: "c", candidateCount: 0 }, "r");
    return row.resolved_principal_id === "c"; // unknown carried a principal
  });

srcMutation("MUT G: INBOUND_MESSAGE still falls through to ignored_non_delivery",
  WEBHOOK_SVC_SRC,
  "    const inbound = await deps.handleInbound({",
  '    await recordIgnoredReceipt(input.rawBody, payload, "ignored_non_delivery");\n    return { status: 200, result: "acknowledged_ignored" };',
  () => !/INBOUND_MESSAGE\)\s*\{[\s\S]{0,900}deps\.handleInbound\(/.test(readF(WEBHOOK_SVC_SRC)));

srcMutation("MUT H: a send call is introduced into the inbound service",
  SERVICE_SRC,
  "  return { ok: true, result };\n}\n\nfunction safe(",
  "  await (globalThis).__svc.sendTemplateMessage();\n  return { ok: true, result };\n}\n\nfunction safe(",
  () => /sendTemplateMessage\(|\.send\(/.test(readCode(SERVICE_SRC)));

srcMutation("MUT I: a domain_events / outbox write is introduced",
  SERVICE_SRC,
  'from("communication_inbound_messages").insert(row)',
  'from("domain_events").insert(row)',
  () => /from\("domain_events"\)|from\("outbox_events"\)/.test(readCode(SERVICE_SRC)));

srcMutation("MUT J: a consent mutation is introduced",
  SERVICE_SRC,
  "  return { ok: true, result };\n}\n\nfunction safe(",
  '  await (globalThis).__db.from("communication_suppressions").insert({});\n  return { ok: true, result };\n}\n\nfunction safe(',
  () => /communication_suppressions|communication_preferences/.test(readCode(SERVICE_SRC)));

tsMutation("MUT K: a duplicate receipt causes the message loop to be skipped (early return)",
  [[SERVICE_SRC, "  let failureReason: string | null = null;\n  for (const item of normalized) {", "  let failureReason: string | null = null;\n  if (receipt.duplicate) return { ok: true, result };\n  for (const item of normalized) {"]],
  async (mm) => {
    const persisted = new Set();
    const deps = makeDeps({ receipt: { ok: true, receiptId: "r", duplicate: true }, persistedWamids: persisted });
    await mm.Service.handleInboundWhatsAppMessages({ rawBody: "x", payload: envelope(textMsg({ id: "wamid.B" })), providerAccountId: ACCOUNT_ID }, deps);
    return deps.calls.persists.length === 0;
  });

tsMutation("MUT L: a message id is fabricated when the wamid is missing",
  [[NORMALIZER_SRC,
    "    const providerMessageId = readString(m, \"id\");\n    if (!providerMessageId) {",
    "    const providerMessageId = readString(m, \"id\") ?? `fab-${readString(m, \"from\")}`;\n    if (!providerMessageId) {"]],
  async () => {
    // The D1-B service, fed a fabricated-id normalizer, would persist a row for an id-less message.
    const persisted = new Set();
    const deps = makeDeps({ persistedWamids: persisted });
    await M.Service.handleInboundWhatsAppMessages({ rawBody: "x", payload: envelope(textMsg({ id: undefined })), providerAccountId: ACCOUNT_ID }, deps);
    // With the REAL (unmutated) build here, this stays rejected; the mutation is proven load-bearing
    // via suiteGoesRed (the normalizer's own d1a guard) — but assert the fabrication marker if present.
    return deps.calls.persists.some((r) => typeof r.provider_message_id === "string" && r.provider_message_id.startsWith("fab-"));
  });

// ---- Reliability-correction mutations (operational failure ≠ durable UNKNOWN) --------------
tsMutation("MUT M: the identity-failure catch is downgraded to a durable UNKNOWN",
  [[SERVICE_SRC, "      resolution = { ok: false, code: IDENTITY_LOOKUP_FAILED };", '      resolution = { ok: true, identity: { confidence: "unknown", principalType: null, principalId: null, candidateCount: 0 } };']],
  async (mm) => {
    const deps = makeDeps({ resolveIdentity: async () => { throw new Error("db down"); } });
    const r = await mm.Service.handleInboundWhatsAppMessages({ rawBody: "x", payload: envelope(textMsg({ id: "wamid.M" })), providerAccountId: ACCOUNT_ID }, deps);
    return r.ok === true && deps.calls.persists.length > 0; // a thrown lookup became a persisted UNKNOWN
  });

tsMutation("MUT N: a failed resolution is persisted as identity_unknown instead of skipped",
  [[SERVICE_SRC,
    '      failureReason = failureReason ?? "identity_lookup_failed";\n      continue;',
    '      result = { ...result, identityUnknown: result.identityUnknown + 1 };\n      await deps.persistInboundRow(buildInboundRow(item.message, { confidence: "unknown", principalType: null, principalId: null, candidateCount: 0 }, receiptId));\n      continue;']],
  async (mm) => {
    const deps = makeDeps({ resolution: { ok: false, code: "IDENTITY_LOOKUP_FAILED" } });
    await mm.Service.handleInboundWhatsAppMessages({ rawBody: "x", payload: envelope(textMsg({ id: "wamid.N" })), providerAccountId: ACCOUNT_ID }, deps);
    return deps.calls.persists.length > 0 && deps.calls.persists[0].identity_confidence === "unknown"; // infra failure persisted as unknown
  });

tsMutation("MUT O: an identity-lookup failure is acknowledged with ok:true (HTTP 200)",
  [[SERVICE_SRC, "    return { ok: false, code: failureReason, result };", "    return { ok: true, result };"]],
  async (mm) => {
    const deps = makeDeps({ resolution: { ok: false, code: "IDENTITY_LOOKUP_FAILED" } });
    const r = await mm.Service.handleInboundWhatsAppMessages({ rawBody: "x", payload: envelope(textMsg({ id: "wamid.O" })), providerAccountId: ACCOUNT_ID }, deps);
    return r.ok === true; // a retryable failure was wrongly acked
  });

tsMutation("MUT P: a raw error field is exposed as the sanitized failure reason",
  [[SERVICE_SRC, '      failureReason = failureReason ?? "identity_lookup_failed";', "      failureReason = failureReason ?? resolution.detail;"]],
  async (mm) => {
    const deps = makeDeps({ resolution: { ok: false, code: "IDENTITY_LOOKUP_FAILED", detail: "SQLSTATE 08006 connection reset by peer" } });
    const r = await mm.Service.handleInboundWhatsAppMessages({ rawBody: "x", payload: envelope(textMsg({ id: "wamid.P" })), providerAccountId: ACCOUNT_ID }, deps);
    const fin = deps.calls.finalizes.find((f) => f.status === "failed");
    return /SQLSTATE|connection reset/i.test(String(fin && fin.reason)) || /SQLSTATE|connection reset/i.test(String(r.code)); // raw error leaked
  });

tsMutation("MUT Q: a duplicate receipt skips per-message processing on retry (loses a failed-identity message)",
  [[SERVICE_SRC, "  for (const item of normalized) {\n    if (!item.ok) {", "  for (const item of normalized) {\n    if (receipt.duplicate) continue;\n    if (!item.ok) {"]],
  async (mm) => {
    // Retry of a batch whose B previously failed identity lookup: the duplicate receipt must STILL
    // process B. With the per-message skip, B is never persisted.
    const deps = makeDeps({ receipt: { ok: true, receiptId: "r", duplicate: true }, persistedWamids: new Set() });
    await mm.Service.handleInboundWhatsAppMessages({ rawBody: "x", payload: envelope(textMsg({ id: "wamid.B" })), providerAccountId: ACCOUNT_ID }, deps);
    return deps.calls.persists.length === 0; // the message was skipped on the duplicate receipt
  });

// ============================================================================
// RUNNER
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-D1-B inbound persistence checks...\n");
  for (const c of checks) { try { await c.fn(); console.log(`PASS ${c.name}`); passed++; } catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; } }
  return { passed, failed };
}
async function suiteGoesRed() { for (const c of checks) { try { await c.fn(); } catch { return true; } } return false; }
async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5F-D1-B mutation tests...\n");
  for (const mut of mutationChecks) {
    const mutDir = resolve(`.phase5fd1b-mut-${mutationChecks.indexOf(mut)}`);
    const originals = new Map();
    for (const edit of mut.edits) { const p = resolve(edit.file); if (!originals.has(p)) originals.set(p, readFileSync(p, "utf8")); }
    try {
      for (const edit of mut.edits) { const p = resolve(edit.file); const cur = readFileSync(p, "utf8"); if (!cur.includes(edit.from)) throw new Error(`anchor not found in ${edit.file}`); writeFileSync(p, cur.replace(edit.from, edit.to)); }
      let violation = false;
      if (mut.kind === "ts") {
        let mm;
        try { compileTo(mutDir); transpileService(mutDir); } catch { console.log(`PASS ${mut.name} (rejected at compile time)`); passed++; continue; }
        mm = wireBuild(mutDir);
        violation = await mut.scenario(mm);
      } else { violation = await mut.scenario(); }
      if (!violation) violation = await suiteGoesRed();
      if (violation) { console.log(`PASS ${mut.name}`); passed++; } else { console.log(`FAIL ${mut.name} (guard did not prove load-bearing)`); failed++; }
    } catch (e) { console.log(`FAIL ${mut.name}`); console.error(e); failed++; }
    finally { for (const [p, original] of originals) writeFileSync(p, original); rmSync(mutDir, { recursive: true, force: true }); }
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
