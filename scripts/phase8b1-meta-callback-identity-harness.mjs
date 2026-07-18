import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import crypto from "node:crypto";

/**
 * Phase 8B-1A — Meta CALLBACK-IDENTITY harness.
 *
 * Proves the production webhook enforces:
 *   VALID META HMAC + (FOREIGN | MIXED | MALFORMED | UNPROVABLE identity)
 *     = ZERO db calls / receipt writes / message mutations / inbound persistence /
 *       consent processing / response-intent enqueue / provider-state / network.
 *
 * It compiles the REAL modules (no network, no next/server), drives BOTH the production
 * byte entry point and the compatibility string wrapper, verifies the raw-byte reader,
 * the strict signature grammar, the pure closed-union identity authority, the identity
 * config, the whole-payload fail-closed policy and the pipeline chokepoint ordering, and
 * mutation-tests every security-critical boundary by editing the real files and asserting
 * red. The mutation runner FAILS (never passes) on syntax / compile / import / missing
 * anchor / unrelated exception / empty scenario.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

// Entry files; tsc resolves the full transitive graph (services, supabase, providers…).
const ENTRY_FILES = [
  "services/metaWhatsAppWebhookService.ts",
  "lib/communication/providers/metaCallbackIdentity.ts",
  "lib/communication/providers/metaWebhookRawBody.ts",
  "lib/communication/providers/metaCloudWhatsAppConfig.ts",
  "lib/communication/providers/metaWhatsAppWebhook.ts",
];

const CALLBACK_IDENTITY_SRC = "lib/communication/providers/metaCallbackIdentity.ts";
const WEBHOOK_LIB_SRC = "lib/communication/providers/metaWhatsAppWebhook.ts";
const CONFIG_SRC = "lib/communication/providers/metaCloudWhatsAppConfig.ts";
const WEBHOOK_SERVICE_SRC = "services/metaWhatsAppWebhookService.ts";
const RAW_BODY_SRC = "lib/communication/providers/metaWebhookRawBody.ts";
const ROUTE_SRC = "app/api/webhooks/whatsapp/meta/route.ts";

function compileTo(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  const tsconfigPath = resolve(`${outDir}.tsconfig.json`);
  writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        module: "commonjs", target: "ES2020", moduleResolution: "node",
        skipLibCheck: true, esModuleInterop: true, strict: true, jsx: "preserve",
        outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] }, lib: ["ES2021", "DOM"],
      },
      files: ENTRY_FILES,
    }, null, 2)
  );
  try {
    execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" });
  } finally {
    rmSync(tsconfigPath, { force: true });
  }
  return outDir;
}

function wireBuild(outDir) {
  const req = createRequire(`${outDir}/`);
  return {
    req,
    Service: req("./services/metaWhatsAppWebhookService.js"),
    Identity: req("./lib/communication/providers/metaCallbackIdentity.js"),
    RawBody: req("./lib/communication/providers/metaWebhookRawBody.js"),
    Config: req("./lib/communication/providers/metaCloudWhatsAppConfig.js"),
    Webhook: req("./lib/communication/providers/metaWhatsAppWebhook.js"),
    Supabase: req("./lib/supabase.js"),
  };
}

// ============================================================================
// REGISTRY + ASSERT
// ============================================================================
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ============================================================================
// COUNTING IN-MEMORY adminClient — every `.from()` is a DB CALL we count.
// ============================================================================
const DB_TABLES = [
  "communication_messages", "communication_webhook_receipts", "communication_delivery_events",
  "communication_provider_runtime_policies", "communication_inbound_messages",
  // Phase 8B-1B-C: ownership is proven against this table before any effect-bearing write.
  "communication_provider_accounts",
];
const db = {};
const counters = { dbCalls: 0, network: 0 };
function resetDb() { for (const t of DB_TABLES) db[t] = []; counters.dbCalls = 0; counters.network = 0; }
class QB {
  constructor(table) { this.table = table; this.filters = []; this.limitVal = null; this.action = "select"; this.data = null; }
  select() { return this; }
  order() { return this; }
  limit(n) { this.limitVal = n; return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  in(col, vals) { this.filters.push((row) => vals.includes(row[col])); return this; }
  insert(row) { this.action = "insert"; this.data = row; return this; }
  update(u) { this.action = "update"; this.data = u; return this; }
  maybeSingle() { return this.single(); }
  async single() { const { data, error } = await this.exec(); return { data: Array.isArray(data) ? (data[0] ?? null) : data, error }; }
  async exec() {
    let list = db[this.table] || (db[this.table] = []);
    if (this.action === "insert") {
      const rows = Array.isArray(this.data) ? this.data : [this.data];
      const inserted = [];
      for (const r of rows) { const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }; db[this.table].push(row); inserted.push(row); }
      return { data: Array.isArray(this.data) ? inserted : inserted[0], error: null };
    }
    if (this.action === "update") {
      let sel = list; for (const f of this.filters) sel = sel.filter(f);
      for (const item of sel) Object.assign(item, this.data);
      return { data: sel, error: null };
    }
    for (const f of this.filters) list = list.filter(f);
    if (this.limitVal !== null) list = list.slice(0, this.limitVal);
    return { data: list, error: null };
  }
  async then(res) { const { data, error } = await this.exec(); return res({ data, error }); }
}
function installDb(build) {
  build.Supabase.adminClient = () => ({ from: (t) => { counters.dbCalls++; return new QB(t); } });
}
// Phase 8B-1B-C: seed EXACTLY ONE owned account whose identity matches the PAYLOAD (entry.id +
// metadata.phone_number_id), so an authorized callback can prove ownership. Deliberately NOT seeded
// globally: every negative/foreign-identity test must keep resolving to a zero-row `not_found`.
const OWNED_ACCOUNT_ID = "cccccccc-3333-4333-8333-cccccccccccc";
function seedOwnedProviderAccount(over = {}) {
  db.communication_provider_accounts.push({
    id: over.id ?? OWNED_ACCOUNT_ID,
    provider_key: "meta_whatsapp_cloud",
    channel: "whatsapp",
    phone_number_reference: over.phoneNumberReference ?? PHONE,
    business_account_reference: over.businessAccountReference ?? WABA,
  });
}
function seedWebhookEnabled() {
  db.communication_provider_runtime_policies.push({
    provider_key: "meta_whatsapp_cloud", channel: "whatsapp", activation_status: "canary",
    outbound_enabled: false, webhook_processing_enabled: true, health_check_enabled: false,
  });
}

// A fetch that MUST NOT be called on any rejected/unsupported path.
const realFetch = globalThis.fetch;
function installFetchGuard() {
  globalThis.fetch = () => { counters.network++; return Promise.reject(new Error("network must not be called")); };
}
function restoreFetch() { globalThis.fetch = realFetch; }

// ============================================================================
// IDENTITY / SIGNATURE FIXTURES
// ============================================================================
const APP_SECRET = "APP_SECRET_VALUE";
const WABA = "102290129340398";
const PHONE = "106540352242922";
const OTHER_WABA = "900000000000001";
const OTHER_PHONE = "900000000000002";

function setIdentityEnv(over = {}) {
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_WABA_ID = WABA;
  process.env.WHATSAPP_PHONE_NUMBER_ID = PHONE;
  for (const [k, v] of Object.entries(over)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}
const enc = (s) => new TextEncoder().encode(s);
const sign = (build, bytesOrStr) => {
  const bytes = typeof bytesOrStr === "string" ? enc(bytesOrStr) : bytesOrStr;
  return "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(bytes).digest("hex");
};

const messagesEnvelope = (over = {}) => JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: over.wabaId ?? WABA, changes: [{ field: "messages", value: { metadata: over.metadata ?? { phone_number_id: PHONE }, messages: [{ id: "x" }] } }] }],
});
const templateEnvelope = (wabaId = WABA) => JSON.stringify({
  object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field: "message_template_status_update", value: { event: "APPROVED" } }] }],
});
const accountEnvelope = (wabaId = WABA) => JSON.stringify({
  object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field: "account_update", value: {} }] }],
});
const unsupportedEnvelope = () => JSON.stringify({
  object: "whatsapp_business_account", entry: [{ changes: [{ field: "weird", value: {} }] }],
});
const mixedEnvelope = () => JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    { id: WABA, changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE }, messages: [{ id: "x" }] } }] },
    { id: OTHER_WABA, changes: [{ field: "account_update", value: {} }] },
  ],
});

// ============================================================================
// MAIN BUILD
// ============================================================================
const MAIN_DIR = resolve(".phase8b1-build-main");
compileTo(MAIN_DIR);
const M = wireBuild(MAIN_DIR);
installDb(M);

// ----------------------------------------------------------------------------
// 1. RAW-BYTE READER — bounded, exact bytes, never decoded.
// ----------------------------------------------------------------------------
function streamSource(bytes, over = {}) {
  let sent = false;
  return {
    headers: { get: (n) => (n.toLowerCase() === "content-length" ? over.contentLength ?? null : null) },
    body: {
      getReader() {
        return {
          read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })),
          cancel: async () => {},
        };
      },
    },
  };
}
check("R1-6. reader returns EXACT bytes; honours content-length + streaming byte ceiling; never decodes", async () => {
  const R = M.RawBody;
  const payload = enc('{"object":"whatsapp_business_account"}');
  const ok = await R.readMetaWebhookRawBytes(streamSource(payload));
  assert(ok.ok && ok.rawBytes instanceof Uint8Array, "returns a Uint8Array");
  assert(Buffer.from(ok.rawBytes).equals(Buffer.from(payload)), "bytes are exact (byte-identical, undecoded)");
  // content-length pre-check rejects before reading
  const big = await R.readMetaWebhookRawBytes(streamSource(payload, { contentLength: String(R.META_MAX_WEBHOOK_BODY_BYTES + 1) }));
  assert(!big.ok && big.reason === "oversized_body", "content-length over the cap rejected");
  // streaming ceiling rejects a body with no content-length
  const huge = enc("x".repeat(64));
  const tiny = await R.readMetaWebhookRawBytes(streamSource(huge), 8);
  assert(!tiny.ok && tiny.reason === "oversized_body", "streaming byte ceiling enforced");
  // raw non-UTF-8 bytes survive intact (never decoded here)
  const rawBad = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
  const kept = await R.readMetaWebhookRawBytes(streamSource(rawBad));
  assert(kept.ok && Buffer.from(kept.rawBytes).equals(Buffer.from(rawBad)), "invalid-UTF-8 bytes preserved exactly");
});

// ----------------------------------------------------------------------------
// 2. STRICT SIGNATURE AUTHORITY — grammar, byte HMAC, 32-byte compare.
// ----------------------------------------------------------------------------
check("S1-9. exact grammar ^sha256=[0-9a-f]{64}$; HMAC over EXACT bytes; 32-byte timing-safe compare", () => {
  const W = M.Webhook;
  const bytes = enc('{"a":1}');
  const good = sign(M, bytes);
  assert(/^sha256=[0-9a-f]{64}$/.test(good), "test signature matches the grammar");
  assert(W.verifyMetaWebhookSignatureBytes(bytes, good, APP_SECRET) === true, "valid signature over exact bytes accepted");
  // grammar rejections BEFORE crypto
  assert(W.verifyMetaWebhookSignatureBytes(bytes, good.toUpperCase().replace("SHA256=", "sha256="), APP_SECRET) === false, "uppercase hex rejected by grammar");
  assert(W.verifyMetaWebhookSignatureBytes(bytes, "sha256=deadbeef", APP_SECRET) === false, "wrong length rejected by grammar");
  assert(W.verifyMetaWebhookSignatureBytes(bytes, good.slice("sha256=".length), APP_SECRET) === false, "missing prefix rejected");
  // crypto rejections
  assert(W.verifyMetaWebhookSignatureBytes(bytes, good, "WRONG_SECRET") === false, "wrong secret rejected");
  const flipped = new Uint8Array(bytes); flipped[0] ^= 0x01;
  assert(W.verifyMetaWebhookSignatureBytes(flipped, good, APP_SECRET) === false, "a single flipped byte rejects (HMAC over exact bytes)");
  // shape guards
  assert(W.verifyMetaWebhookSignatureBytes(bytes, good, "") === false, "empty secret fails closed");
  assert(W.verifyMetaWebhookSignatureBytes("not-bytes", good, APP_SECRET) === false, "non-Uint8Array body fails closed");
  assert(W.META_SIGNATURE_PATTERN.source === "^sha256=[0-9a-f]{64}$", "grammar constant is exactly ^sha256=[0-9a-f]{64}$");
});

// ----------------------------------------------------------------------------
// 3. IDENTITY CONFIG — WABA id + phone-number id ONLY, grammar-validated, names-only.
// ----------------------------------------------------------------------------
check("C1-6. identity config requires ONLY WABA + phone ids; grammar-validated; names-only errors; no token", () => {
  const C = M.Config;
  const ok = C.resolveWebhookIdentityConfig({ WHATSAPP_WABA_ID: WABA, WHATSAPP_PHONE_NUMBER_ID: PHONE });
  assert(ok.ok && ok.config.wabaId === WABA && ok.config.phoneNumberId === PHONE, "resolves with the two ids only (no token needed)");
  const miss = C.resolveWebhookIdentityConfig({});
  assert(!miss.ok && miss.missing.includes("WHATSAPP_WABA_ID") && miss.missing.includes("WHATSAPP_PHONE_NUMBER_ID"), "missing reports both names");
  const bad = C.resolveWebhookIdentityConfig({ WHATSAPP_WABA_ID: "WABA_x", WHATSAPP_PHONE_NUMBER_ID: "12ab" });
  assert(!bad.ok && bad.invalid.includes("WHATSAPP_WABA_ID") && bad.invalid.includes("WHATSAPP_PHONE_NUMBER_ID"), "non-numeric ids reported invalid");
  assert(JSON.stringify(bad).indexOf(APP_SECRET) === -1, "no secret value ever appears");
  const partial = C.resolveWebhookIdentityConfig({ WHATSAPP_WABA_ID: WABA });
  assert(!partial.ok && partial.missing.includes("WHATSAPP_PHONE_NUMBER_ID"), "phone id is required (partial fails closed)");
});

// ----------------------------------------------------------------------------
// 4. PURE IDENTITY UNION — field-specific rules, closed union, no display trust.
// ----------------------------------------------------------------------------
check("I1-14. closed-union authority: field-specific identity; foreign/malformed/unprovable/mixed reject; display never trusted", () => {
  const decide = M.Identity.decideCallbackIdentity;
  const exp = { wabaId: WABA, phoneNumberId: PHONE };
  // authorized — messages need WABA + phone
  const a = decide(JSON.parse(messagesEnvelope()), exp);
  assert(a.kind === "authorized" && a.classes.includes("messages"), "messages with exact WABA + phone authorized");
  // authorized — template/account need WABA only
  assert(decide(JSON.parse(templateEnvelope()), exp).kind === "authorized", "template with exact WABA authorized");
  assert(decide(JSON.parse(accountEnvelope()), exp).kind === "authorized", "account with exact WABA authorized");
  // foreign WABA / phone
  assert(decide(JSON.parse(messagesEnvelope({ wabaId: OTHER_WABA })), exp).reason === "foreign_waba", "foreign WABA rejected");
  assert(decide(JSON.parse(messagesEnvelope({ metadata: { phone_number_id: OTHER_PHONE } })), exp).reason === "foreign_phone_number", "foreign phone rejected");
  assert(decide(JSON.parse(templateEnvelope(OTHER_WABA)), exp).reason === "foreign_waba", "template foreign WABA rejected");
  // malformed
  assert(decide(JSON.parse(messagesEnvelope({ wabaId: "WABA_x" })), exp).reason === "malformed_waba", "malformed WABA rejected");
  assert(decide(JSON.parse(messagesEnvelope({ metadata: { phone_number_id: "12ab" } })), exp).reason === "malformed_phone_number", "malformed phone rejected");
  // unprovable (missing)
  const noEntryId = { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages: [{ id: "x" }] } }] }] };
  assert(decide(noEntryId, exp).reason === "unprovable_waba", "missing entry.id → unprovable WABA");
  assert(decide(JSON.parse(messagesEnvelope({ metadata: {} })), exp).reason === "unprovable_phone_number", "missing phone_number_id → unprovable phone");
  // NEVER trust display_phone_number: display matches, real phone_number_id is foreign → reject
  const displayTrap = JSON.parse(messagesEnvelope({ metadata: { display_phone_number: PHONE, phone_number_id: OTHER_PHONE } }));
  assert(decide(displayTrap, exp).reason === "foreign_phone_number", "display_phone_number is never trusted");
  // whole-payload fail-closed: one good + one foreign → rejected
  assert(decide(JSON.parse(mixedEnvelope()), exp).kind === "rejected", "mixed payload rejected wholesale (fail-closed)");
  // unsupported-only
  assert(decide(JSON.parse(unsupportedEnvelope()), exp).kind === "unsupported", "unsupported-only shape → unsupported");
  // malformed expected identity authorizes nothing
  assert(decide(JSON.parse(messagesEnvelope()), { wabaId: "x", phoneNumberId: "y" }).reason === "malformed_expected_identity", "malformed expected identity rejects");
});

// ----------------------------------------------------------------------------
// 5-8. PIPELINE + BYTE/STRING SHARED-PIPELINE PROOF + CHOKEPOINT (zero effects).
// ----------------------------------------------------------------------------
const bytesEntry = (rawStr, sig) => M.Service.handleMetaWhatsAppWebhookPostBytes({ rawBytes: enc(rawStr), signature: sig ?? sign(M, rawStr) });
// The HISTORICAL public symbol `handleMetaWhatsAppWebhookPost` is now the GATED compatibility string wrapper.
const stringEntry = (rawStr, sig) => M.Service.handleMetaWhatsAppWebhookPost({ rawBody: rawStr, signature: sig ?? sign(M, rawStr) });

check("P1-8. byte pipeline order: header/config/grammar/decode/parse/identity-config all fail closed in order", async () => {
  resetDb(); setIdentityEnv();
  // 1 missing header
  assert((await M.Service.handleMetaWhatsAppWebhookPostBytes({ rawBytes: enc("{}"), signature: null })).status === 401, "missing signature → 401");
  // 2 signature config absent → 503 (no app secret)
  setIdentityEnv({ WHATSAPP_APP_SECRET: undefined });
  assert((await bytesEntry(messagesEnvelope(), "sha256=" + "a".repeat(64))).status === 503, "no app secret → 503");
  setIdentityEnv();
  // 3 bad grammar → 401
  assert((await bytesEntry(messagesEnvelope(), "sha256=deadbeef")).status === 401, "bad signature grammar → 401");
  // 4 fatal UTF-8 decode AFTER a VALID signature over the exact bytes → 400 (never a 200 / never identity)
  const badUtf8 = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
  const badSig = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(badUtf8).digest("hex");
  const dbBefore = counters.dbCalls;
  const decodeRes = await M.Service.handleMetaWhatsAppWebhookPostBytes({ rawBytes: badUtf8, signature: badSig });
  assert(decodeRes.status === 400, "invalid UTF-8 (valid signature) → 400 at the fatal decode");
  assert(counters.dbCalls === dbBefore, "fatal decode failure touches no DB");
  // 5 unparseable JSON → 400
  assert((await bytesEntry("{not json")).status === 400, "unparseable JSON → 400");
  // 6 identity config absent → 503
  setIdentityEnv({ WHATSAPP_WABA_ID: undefined });
  assert((await bytesEntry(messagesEnvelope())).status === 503, "no identity config → 503");
  setIdentityEnv();
});

check("D1-4. AUTHORIZED identity reaches the downstream (DB IS touched) — expected-identity proof", async () => {
  // Phase 8B-1B-C: passing the identity gate is necessary but no longer sufficient — an effect-bearing
  // callback must also PROVE exact provider-account ownership. Seed the one account that owns this exact
  // payload identity (entry.id + metadata.phone_number_id); the ownership decision is still made by the
  // real resolver against the real query semantics, never short-circuited here.
  resetDb(); seedWebhookEnabled(); seedOwnedProviderAccount(); setIdentityEnv();
  const dbBefore = counters.dbCalls;
  // A WABA-only template callback carries no phone identity, so it stays on the unbound ignored path.
  const t = await bytesEntry(templateEnvelope());
  assert(t.status === 200 && t.result === "acknowledged_ignored", `authorized template → downstream ack, got ${JSON.stringify(t)}`);
  assert(counters.dbCalls > dbBefore, "authorized callback DOES reach the downstream DB gate + receipt");
  const inb = await bytesEntry(messagesEnvelope());
  assert(inb.status === 200 && inb.result === "inbound_acknowledged_rejected", `authorized inbound (incomplete msg) → downstream reject, got ${JSON.stringify(inb)}`);
  // The inbound row that DID land is bound to the owning account — never left unbound, never invented.
  for (const row of db.communication_inbound_messages) {
    assert(row.provider_account_id === OWNED_ACCOUNT_ID, "a persisted inbound row is BOUND to the owning account");
  }
});

check("D5. an authorized identity whose account is NOT owned produces ZERO effects (no env fallback)", async () => {
  // The identity gate passes (env matches the payload) but NO account row owns it. Environment identity
  // must never stand in for ownership: the callback is acknowledged generically with nothing persisted.
  resetDb(); seedWebhookEnabled(); setIdentityEnv();          // deliberately NO provider-account row
  const res = await bytesEntry(messagesEnvelope());
  assert(res.status === 200 && res.result === "acknowledged_unowned_provider_account",
    `unowned → generic 200, got ${JSON.stringify(res)}`);
  assert(db.communication_inbound_messages.length === 0, "ZERO inbound rows for an unowned callback");
  assert(db.communication_webhook_receipts.length === 0, "ZERO receipts for an unowned callback");
});

check("Z1-8. CHOKEPOINT: foreign/mixed/missing/malformed identity → ZERO db/receipt/downstream/network (both entries)", async () => {
  installFetchGuard();
  try {
    const foreignCases = [
      ["foreign WABA", messagesEnvelope({ wabaId: OTHER_WABA })],
      ["foreign phone", messagesEnvelope({ metadata: { phone_number_id: OTHER_PHONE } })],
      ["mixed payload", mixedEnvelope()],
      ["missing phone", messagesEnvelope({ metadata: {} })],
      ["malformed WABA", messagesEnvelope({ wabaId: "WABA_x" })],
    ];
    for (const [label, body] of foreignCases) {
      for (const [entryName, entry] of [["bytes", bytesEntry], ["string", stringEntry]]) {
        resetDb(); seedWebhookEnabled(); setIdentityEnv();
        const receiptsBefore = db.communication_webhook_receipts.length;
        const dbCallsAfterSeed = counters.dbCalls; // seeding pushed a row directly, not via adminClient
        const res = await entry(body);
        assert(res.status === 200 && res.result === "rejected_foreign_identity", `${label}/${entryName} → 200 rejected_foreign_identity, got ${JSON.stringify(res)}`);
        assert(counters.dbCalls === dbCallsAfterSeed, `${label}/${entryName}: ZERO db calls (got ${counters.dbCalls - dbCallsAfterSeed})`);
        assert(db.communication_webhook_receipts.length === receiptsBefore, `${label}/${entryName}: ZERO receipt writes`);
        assert(db.communication_messages.length === 0, `${label}/${entryName}: ZERO message mutations`);
        assert(counters.network === 0, `${label}/${entryName}: ZERO network calls`);
      }
    }
  } finally { restoreFetch(); }
});

check("U1-3. UNSUPPORTED-only identity shape → 200 acknowledged_unsupported_identity_shape with ZERO db/receipt", async () => {
  installFetchGuard();
  try {
    for (const [entryName, entry] of [["bytes", bytesEntry], ["string", stringEntry]]) {
      resetDb(); seedWebhookEnabled(); setIdentityEnv();
      const dbAfterSeed = counters.dbCalls;
      const res = await entry(unsupportedEnvelope());
      assert(res.status === 200 && res.result === "acknowledged_unsupported_identity_shape", `${entryName} unsupported → 200 ack, got ${JSON.stringify(res)}`);
      assert(counters.dbCalls === dbAfterSeed, `${entryName}: unsupported shape makes ZERO db calls`);
      assert(db.communication_webhook_receipts.length === 0, `${entryName}: unsupported shape writes ZERO receipts`);
      assert(counters.network === 0, `${entryName}: ZERO network`);
    }
  } finally { restoreFetch(); }
});

check("E1-4. byte entry ≡ string wrapper for equivalent valid UTF-8: SAME decision + SAME downstream branch", async () => {
  for (const body of [messagesEnvelope(), templateEnvelope(), messagesEnvelope({ wabaId: OTHER_WABA }), unsupportedEnvelope()]) {
    resetDb(); seedWebhookEnabled(); setIdentityEnv();
    const b = await bytesEntry(body);
    resetDb(); seedWebhookEnabled(); setIdentityEnv();
    const s = await stringEntry(body);
    assert(JSON.stringify(b) === JSON.stringify(s), `byte and string entries agree for ${body.slice(0, 40)} (byte ${JSON.stringify(b)} vs string ${JSON.stringify(s)})`);
  }
});

check("X1-3. NO compatibility bypass: the string wrapper enters the identity gate (a foreign identity is rejected)", async () => {
  installFetchGuard();
  try {
    resetDb(); seedWebhookEnabled(); setIdentityEnv();
    const dbAfterSeed = counters.dbCalls;
    const res = await stringEntry(messagesEnvelope({ wabaId: OTHER_WABA }));
    assert(res.status === 200 && res.result === "rejected_foreign_identity", "historical handleMetaWhatsAppWebhookPost foreign identity → rejected (no bypass)");
    assert(counters.dbCalls === dbAfterSeed && counters.network === 0, "historical symbol foreign identity → zero db + zero network");
    // The HISTORICAL public symbol delegates directly to the gated byte entry (source proof).
    const svc = readFileSync(WEBHOOK_SERVICE_SRC, "utf8");
    assert(/export function handleMetaWhatsAppWebhookPost\(\s*input:[\s\S]{0,600}return handleMetaWhatsAppWebhookPostBytes\(/.test(svc), "the historical symbol IS the gated wrapper delegating to the byte entry");
  } finally { restoreFetch(); }
});

check("O1-4. chokepoint ORDER: identity gate precedes the runtime DB gate; parse precedes identity; verify precedes decode", () => {
  const svc = readFileSync(WEBHOOK_SERVICE_SRC, "utf8");
  const verifyIdx = svc.indexOf("verifyMetaWebhookSignatureBytes(input.rawBytes");
  const decodeIdx = svc.indexOf("META_UTF8_DECODER.decode(input.rawBytes)");
  const parseIdx = svc.indexOf("safeParse(decoded)");
  const idCfgIdx = svc.indexOf("resolveWebhookIdentityConfig()");
  const decideIdx = svc.indexOf("decideCallbackIdentity(payload");
  const downstreamIdx = svc.indexOf("return processVerifiedExpectedMetaWebhook(");
  for (const [n, v] of Object.entries({ verifyIdx, decodeIdx, parseIdx, idCfgIdx, decideIdx, downstreamIdx })) assert(v > 0, `${n} present`);
  assert(verifyIdx < decodeIdx, "signature verified before the fatal decode");
  assert(decodeIdx < parseIdx, "decode before parse");
  assert(parseIdx < idCfgIdx && idCfgIdx < decideIdx, "parse + identity config before the identity authority");
  assert(decideIdx < downstreamIdx, "identity authority (and its terminal returns) precede the downstream (runtime DB gate)");
  // the identity returns are BEFORE the downstream call
  const rejectIdx = svc.indexOf('result: "rejected_foreign_identity"');
  const unsupportedIdx = svc.indexOf('result: "acknowledged_unsupported_identity_shape"');
  assert(rejectIdx > 0 && rejectIdx < downstreamIdx, "foreign rejection returns before the downstream");
  assert(unsupportedIdx > 0 && unsupportedIdx < downstreamIdx, "unsupported ack returns before the downstream");
});

check("N1-2. no rejection receipt created in 8B-1A; no plaintext identity/secret logging in the identity units", () => {
  const svc = readFileSync(WEBHOOK_SERVICE_SRC, "utf8");
  const gate = readFileSync(CALLBACK_IDENTITY_SRC, "utf8");
  // Phase 8B-1A creates NO rejection receipt: the reject/unsupported returns are not paired with an insert.
  assert(!/rejected_foreign_identity"[\s\S]{0,80}recordIgnoredReceipt|recordIgnoredReceipt[\s\S]{0,80}rejected_foreign_identity/.test(svc), "no rejection receipt on the foreign path");
  assert(!/console\.(log|error|warn|info)/.test(gate), "the identity gate unit never logs at all");
  {
    const svcLogs = svc.match(/console\.\w+\([^;]*\)/g) || [];
    for (const l of svcLogs) {
      assert(!/\$\{|\+\s*\w+(Id|Hash|Reference|Secret|Token)/.test(l),
        `webhook log must be a sanitized literal (no interpolation): ${l.slice(0, 70)}`);
      assert(!/wabaId|phone_number_id|phoneNumberId|accountId|provider_account_id|appSecret|verifyToken/.test(l),
        `webhook log must never name an identity/secret value: ${l.slice(0, 70)}`);
    }
  }
});

check("G1-3. the HISTORICAL symbol is the gated wrapper; the downstream stage is NON-EXPORTED; no exported downstream-only handler", () => {
  const exportsList = Object.keys(M.Service);
  assert(typeof M.Service.handleMetaWhatsAppWebhookPost === "function", "handleMetaWhatsAppWebhookPost is exported (the gated compatibility wrapper)");
  assert(typeof M.Service.handleMetaWhatsAppWebhookPostBytes === "function", "handleMetaWhatsAppWebhookPostBytes is exported (the production byte entry)");
  // The downstream classification / lifecycle stage must NOT be reachable as an export.
  assert(typeof M.Service.processVerifiedExpectedMetaWebhook === "undefined", "the downstream stage is not exported");
  assert(!exportsList.some((k) => /downstream|processVerified|processWebhookLifecycle|handleClassified/i.test(k)), `no downstream-only handler is exported (exports: ${exportsList.join(", ")})`);
  const svc = readFileSync(WEBHOOK_SERVICE_SRC, "utf8");
  assert(/async function processVerifiedExpectedMetaWebhook\(/.test(svc), "the downstream stage exists as an internal function");
  assert(!/export\s+(async\s+)?function\s+processVerifiedExpectedMetaWebhook/.test(svc), "the downstream stage is declared NON-EXPORTED");
});

check("G4-6. the route reads bytes with the Meta reader and invokes the byte entry point; it never calls the string wrapper", () => {
  const route = readFileSync(ROUTE_SRC, "utf8");
  assert(/readMetaWebhookRawBytes/.test(route) && /META_MAX_WEBHOOK_BODY_BYTES/.test(route), "route imports/uses the Meta raw-byte reader + ceiling");
  assert(/readMetaWebhookRawBytes\([\s\S]{0,80}META_MAX_WEBHOOK_BODY_BYTES/.test(route), "route reads bytes under the byte ceiling");
  assert(/handleMetaWhatsAppWebhookPostBytes\(\{[\s\S]{0,80}rawBytes/.test(route), "route invokes the byte entry point with the exact bytes");
  assert(!/handleMetaWhatsAppWebhookPost\(\{/.test(route.replace(/handleMetaWhatsAppWebhookPostBytes/g, "")), "route never calls the string wrapper directly");
});

check("SG1-16. BOTH signature functions enforce the SAME exact grammar + one crypto authority (no second accepted grammar)", () => {
  const W = M.Webhook;
  const body = '{"a":1}';
  const bytes = enc(body);
  const goodHex = crypto.createHmac("sha256", APP_SECRET).update(bytes).digest("hex"); // 64 lowercase hex
  const good = "sha256=" + goodHex;
  // the ONE valid signature is accepted by BOTH
  assert(W.verifyMetaWebhookSignatureBytes(bytes, good, APP_SECRET) === true, "bytes verifier accepts the valid signature");
  assert(W.verifyMetaWebhookSignature(body, good, APP_SECRET) === true, "string verifier accepts the valid signature");
  // a battery of malformed signatures — BOTH verifiers must reject EACH, identically.
  const rejects = [
    ["SHA256= prefix", "SHA256=" + goodHex],
    ["uppercase digest", "sha256=" + goodHex.toUpperCase()],
    ["non-hex digest", "sha256=" + "g".repeat(64)],
    ["short digest", "sha256=" + goodHex.slice(0, 32)],
    ["long digest", "sha256=" + goodHex + "ab"],
    ["leading whitespace", " sha256=" + goodHex],
    ["trailing whitespace", "sha256=" + goodHex + " "],
    ["comma-joined", "sha256=" + goodHex + ",sha256=" + goodHex],
    ["wrong algorithm", "sha1=" + goodHex],
    ["missing prefix", goodHex],
    ["empty", ""],
  ];
  for (const [label, sig] of rejects) {
    assert(W.verifyMetaWebhookSignatureBytes(bytes, sig, APP_SECRET) === false, `bytes verifier rejects: ${label}`);
    assert(W.verifyMetaWebhookSignature(body, sig, APP_SECRET) === false, `string verifier rejects: ${label}`);
  }
  // structural: the string verifier holds NO independent grammar/crypto — it delegates to the byte authority.
  const lib = readFileSync(WEBHOOK_LIB_SRC, "utf8");
  const stringFn = lib.slice(lib.indexOf("export function verifyMetaWebhookSignature("), lib.indexOf("export function computeMetaWebhookSignature"));
  assert(/verifyMetaWebhookSignatureBytes\(/.test(stringFn), "the string verifier delegates to the byte verifier");
  assert(!/startsWith\(/.test(stringFn) && !/createHmac\(/.test(stringFn) && !/digest\(/.test(stringFn), "the string verifier has NO independent startsWith / HMAC / digest");
});

check("B1-6. the raw-byte reader ceiling is EXACTLY 16 KiB (16384): 16384 accepted, 16385 rejected, content-length pre-check, chunked cap", async () => {
  const R = M.RawBody;
  assert(R.META_MAX_WEBHOOK_BODY_BYTES === 16 * 1024, `ceiling is exactly 16 KiB (got ${R.META_MAX_WEBHOOK_BODY_BYTES})`);
  const at = new Uint8Array(16384).fill(0x61);
  const over = new Uint8Array(16385).fill(0x61);
  // exactly 16,384 bytes accepted (single chunk)
  const ok = await R.readMetaWebhookRawBytes(streamSource(at));
  assert(ok.ok && ok.rawBytes.byteLength === 16384, "exactly 16384 bytes accepted");
  // 16,385 bytes rejected by the streaming cap
  const big = await R.readMetaWebhookRawBytes(streamSource(over));
  assert(!big.ok && big.reason === "oversized_body", "16385 bytes rejected");
  // Content-Length above 16384 rejected BEFORE consuming the stream
  let read = false;
  const clSource = {
    headers: { get: (n) => (n.toLowerCase() === "content-length" ? "16385" : null) },
    body: { getReader() { return { read: async () => { read = true; return { done: true }; }, cancel: async () => {} }; } },
  };
  const cl = await R.readMetaWebhookRawBytes(clSource);
  assert(!cl.ok && cl.reason === "oversized_body" && read === false, "Content-Length over 16384 rejected before the stream is consumed");
  // chunked input crossing the cap is rejected as soon as the limit is crossed
  const chunks = [new Uint8Array(10000).fill(0x62), new Uint8Array(10000).fill(0x62)];
  let idx = 0, cancelled = false;
  const chunkedSource = {
    headers: { get: () => null },
    body: { getReader() { return { read: async () => (idx < chunks.length ? { done: false, value: chunks[idx++] } : { done: true }), cancel: async () => { cancelled = true; } }; } },
  };
  const chunked = await R.readMetaWebhookRawBytes(chunkedSource);
  assert(!chunked.ok && chunked.reason === "oversized_body" && cancelled === true, "chunked body crossing 16384 rejected + stream cancelled");
  // a normal Meta-sized fixture is accepted
  const normal = await R.readMetaWebhookRawBytes(streamSource(enc(messagesEnvelope())));
  assert(normal.ok, "a normal Meta fixture remains accepted");
});

// ============================================================================
// MUTATIONS — every guard must be load-bearing. The runner FAILS on
// syntax/compile/import/missing-anchor/unrelated-exception/empty-scenario.
// ============================================================================
const mutations = [];
function mutate(name, edits, scenario) { mutations.push({ name, edits, scenario }); }

mutate("MUT: identity gate removed — the HISTORICAL WRAPPER now reaches the downstream on a foreign callback",
  [[WEBHOOK_SERVICE_SRC,
    '  if (identity.kind === "rejected") {\n    return { status: 200, result: "rejected_foreign_identity" };\n  }\n',
    '  if (identity.kind === "rejected" && false) {\n    return { status: 200, result: "rejected_foreign_identity" };\n  }\n']],
  async (mm) => {
    // Driven through the GATED compatibility wrapper: if the gate is removed, a foreign callback passed to
    // the historical `handleMetaWhatsAppWebhookPost` symbol now reaches the downstream (touches the DB gate).
    installDb(mm); resetDb(); seedWebhookEnabled(); setIdentityEnv();
    const dbAfterSeed = counters.dbCalls;
    const res = await mm.Service.handleMetaWhatsAppWebhookPost({ rawBody: messagesEnvelope({ wabaId: OTHER_WABA }), signature: sign(mm, messagesEnvelope({ wabaId: OTHER_WABA })) });
    return res.result !== "rejected_foreign_identity" || counters.dbCalls > dbAfterSeed;
  });

mutate("MUT: unsupported shape treated as authorized (reaches the downstream)",
  [[WEBHOOK_SERVICE_SRC,
    '  if (identity.kind === "unsupported") {\n    return { status: 200, result: "acknowledged_unsupported_identity_shape" };\n  }\n',
    '  if (identity.kind === "unsupported" && false) {\n    return { status: 200, result: "acknowledged_unsupported_identity_shape" };\n  }\n']],
  async (mm) => {
    installDb(mm); resetDb(); seedWebhookEnabled(); setIdentityEnv();
    const res = await mm.Service.handleMetaWhatsAppWebhookPostBytes({ rawBytes: enc(unsupportedEnvelope()), signature: sign(mm, unsupportedEnvelope()) });
    return res.result !== "acknowledged_unsupported_identity_shape";
  });

mutate("MUT: identity gate moved AFTER the runtime DB gate (downstream runs first)",
  [[WEBHOOK_SERVICE_SRC,
    "  const identity = decideCallbackIdentity(payload, idConfig.config);",
    // Stage 2C gave the downstream a required second parameter (`deps`). The injected call must pass it or
    // the mutation dies as a COMPILE error instead of proving its fence — the mutation still runs the
    // downstream BEFORE the identity gate, which is its original security intent.
    "  const identity = decideCallbackIdentity(payload, idConfig.config);\n  await processVerifiedExpectedMetaWebhook({ rawBody: decoded, signature: input.signature, appSecret: sigConfig.config.appSecret }, deps);"]],
  async (mm) => {
    installDb(mm); resetDb(); seedWebhookEnabled(); setIdentityEnv();
    const dbAfterSeed = counters.dbCalls;
    await mm.Service.handleMetaWhatsAppWebhookPostBytes({ rawBytes: enc(messagesEnvelope({ wabaId: OTHER_WABA })), signature: sign(mm, messagesEnvelope({ wabaId: OTHER_WABA })) });
    return counters.dbCalls > dbAfterSeed; // a foreign callback now touched the runtime DB gate (downstream)
  });

mutate("MUT: byte signature verification is skipped",
  [[WEBHOOK_LIB_SRC,
    "  if (!META_SIGNATURE_PATTERN.test(signature)) return false;\n  const providedDigest = Buffer.from(signature.slice(\"sha256=\".length), \"hex\"); // exactly 32 bytes",
    "  if (!META_SIGNATURE_PATTERN.test(signature)) return true;\n  const providedDigest = Buffer.from(signature.slice(\"sha256=\".length), \"hex\"); // exactly 32 bytes"]],
  (mm) => mm.Webhook.verifyMetaWebhookSignatureBytes(enc("{}"), "sha256=deadbeef", APP_SECRET) === true);

mutate("MUT: signature grammar loosened to accept uppercase hex",
  [[WEBHOOK_LIB_SRC, 'export const META_SIGNATURE_PATTERN = /^sha256=[0-9a-f]{64}$/;', 'export const META_SIGNATURE_PATTERN = /^sha256=[0-9a-fA-F]{64}$/;']],
  (mm) => {
    const bytes = enc("{}");
    const upper = ("sha256=" + crypto.createHmac("sha256", APP_SECRET).update(bytes).digest("hex")).replace("sha256=", "sha256=").toUpperCase().replace("SHA256=", "sha256=");
    return mm.Webhook.verifyMetaWebhookSignatureBytes(bytes, upper, APP_SECRET) === true; // uppercase now wrongly accepted
  });

mutate("MUT: the timing-safe digest compare is replaced with a permissive true",
  [[WEBHOOK_LIB_SRC, "  return crypto.timingSafeEqual(providedDigest, expectedDigest);", "  return providedDigest.length === expectedDigest.length ? true : false;"]],
  (mm) => mm.Webhook.verifyMetaWebhookSignatureBytes(enc("{}"), "sha256=" + "a".repeat(64), APP_SECRET) === true);

mutate("MUT: fatal UTF-8 decode softened (invalid bytes no longer fail closed)",
  [[WEBHOOK_SERVICE_SRC, 'const META_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });', 'const META_UTF8_DECODER = new TextDecoder("utf-8", { fatal: false });']],
  async (mm) => {
    installDb(mm); resetDb(); seedWebhookEnabled(); setIdentityEnv();
    // A raw 0xFF byte INSIDE an otherwise-valid account envelope string. With fatal decode it throws (400);
    // softened, it becomes U+FFFD, the JSON parses, and the (WABA-valid) account callback is acknowledged.
    const prefix = enc('{"object":"whatsapp_business_account","entry":[{"id":"' + WABA + '","changes":[{"field":"account_update","value":{"note":"');
    const suffix = enc('"}}]}]}');
    const bytes = new Uint8Array([...prefix, 0xff, ...suffix]);
    const sig = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(bytes).digest("hex");
    const res = await mm.Service.handleMetaWhatsAppWebhookPostBytes({ rawBytes: bytes, signature: sig });
    // Non-fatal decode no longer stops at step 4 (400): the invalid-UTF-8 body proceeds past the decode
    // (and is only caught downstream, where the decoded string no longer matches the byte signature → 401).
    return res.status !== 400;
  });

mutate("MUT: messages callbacks no longer require the phone-number identity (verdict neutered)",
  [[CALLBACK_IDENTITY_SRC,
    'const phoneVerdict = verdictForId(phoneId, expected.phoneNumberId, "phone_number");',
    'const phoneVerdict = verdictForId(expected.phoneNumberId, expected.phoneNumberId, "phone_number");']],
  (mm) => {
    const res = mm.Identity.decideCallbackIdentity(JSON.parse(messagesEnvelope({ metadata: { phone_number_id: OTHER_PHONE } })), { wabaId: WABA, phoneNumberId: PHONE });
    return res.kind === "authorized"; // a foreign phone now wrongly authorizes
  });

mutate("MUT: foreign WABA accepted (identity comparison neutered)",
  [[CALLBACK_IDENTITY_SRC, "  if (actual !== expected) return kind === \"waba\" ? \"foreign_waba\" : \"foreign_phone_number\";", "  if (actual !== expected && false) return kind === \"waba\" ? \"foreign_waba\" : \"foreign_phone_number\";"]],
  (mm) => mm.Identity.decideCallbackIdentity(JSON.parse(messagesEnvelope({ wabaId: OTHER_WABA })), { wabaId: WABA, phoneNumberId: PHONE }).kind === "authorized");

mutate("MUT: display_phone_number is trusted as the phone identity",
  [[CALLBACK_IDENTITY_SRC, 'const phoneId = metadata ? readIdString(metadata, "phone_number_id") : null;', 'const phoneId = metadata ? readIdString(metadata, "display_phone_number") : null;']],
  (mm) => {
    const trap = JSON.parse(messagesEnvelope({ metadata: { display_phone_number: PHONE, phone_number_id: OTHER_PHONE } }));
    return mm.Identity.decideCallbackIdentity(trap, { wabaId: WABA, phoneNumberId: PHONE }).kind === "authorized";
  });

mutate("MUT: whole-payload fail-closed weakened (a mixed foreign change stops poisoning the payload)",
  [[CALLBACK_IDENTITY_SRC, "        if (!firstReject) firstReject = wabaVerdict;\n        continue; // whole-payload fail-closed: a bad supported change poisons the payload", "        continue; // whole-payload fail-closed: a bad supported change poisons the payload"]],
  (mm) => mm.Identity.decideCallbackIdentity(JSON.parse(mixedEnvelope()), { wabaId: WABA, phoneNumberId: PHONE }).kind === "authorized");

mutate("MUT: identity config drops the phone-number requirement",
  [[CONFIG_SRC, '  const phoneNumberId = readIdVar(env, "WHATSAPP_PHONE_NUMBER_ID", missing, invalid);', '  const phoneNumberId = readIdVar(env, "WHATSAPP_PHONE_NUMBER_ID", [], invalid);']],
  (mm) => mm.Config.resolveWebhookIdentityConfig({ WHATSAPP_WABA_ID: WABA }).ok === true);

// --- CORRECTION mutations (Phase 8B-1A correction review) -----------------------------------
mutate("MUT: the downstream stage is EXPORTED (an identity-exempt handler becomes reachable)",
  [[WEBHOOK_SERVICE_SRC,
    "async function processVerifiedExpectedMetaWebhook(",
    "export async function processVerifiedExpectedMetaWebhook("]],
  (mm) => typeof mm.Service.processVerifiedExpectedMetaWebhook === "function");

mutate("MUT: the legacy startsWith string verifier is restored (a SECOND accepted grammar)",
  [[WEBHOOK_LIB_SRC,
    '  if (typeof rawBody !== "string") return false;\n  return verifyMetaWebhookSignatureBytes(Buffer.from(rawBody, "utf8"), signature, appSecret);',
    '  if (typeof rawBody !== "string") return false;\n  if (!signature.startsWith("sha256=")) return false;\n  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");\n  return signature.toLowerCase() === expected;']],
  (mm) => {
    // An UPPERCASE-hex signature the byte authority rejects (strict grammar) is now accepted by the
    // divergent string verifier → a second accepted grammar exists.
    const body = '{"a":1}';
    const upper = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(enc(body)).digest("hex").toUpperCase();
    return mm.Webhook.verifyMetaWebhookSignature(body, upper, APP_SECRET) === true &&
      mm.Webhook.verifyMetaWebhookSignatureBytes(enc(body), upper, APP_SECRET) === false;
  });

mutate("MUT: the string verifier bypasses the byte authority (returns true)",
  [[WEBHOOK_LIB_SRC,
    '  if (typeof rawBody !== "string") return false;\n  return verifyMetaWebhookSignatureBytes(Buffer.from(rawBody, "utf8"), signature, appSecret);',
    '  if (typeof rawBody !== "string") return false;\n  return true;']],
  (mm) => mm.Webhook.verifyMetaWebhookSignature("body", "sha256=deadbeef", APP_SECRET) === true);

mutate("MUT: the raw-body ceiling is widened back to 1 MiB",
  [[RAW_BODY_SRC, "export const META_MAX_WEBHOOK_BODY_BYTES = 16 * 1024;", "export const META_MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;"]],
  (mm) => mm.RawBody.META_MAX_WEBHOOK_BODY_BYTES !== 16 * 1024);

// ============================================================================
// EXECUTE
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 8B-1A Meta callback-identity checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}
async function suiteGoesRed() { for (const c of checks) { try { await c.fn(); } catch { return true; } } return false; }
async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 8B-1A mutation tests...\n");
  for (const mut of mutations) {
    const mutDir = resolve(`.phase8b1-mut-${mutations.indexOf(mut)}`);
    const originals = new Map();
    for (const edit of mut.edits) { const p = resolve(edit[0]); if (!originals.has(p)) originals.set(p, readFileSync(p, "utf8")); }
    try {
      for (const edit of mut.edits) {
        const p = resolve(edit[0]);
        const cur = readFileSync(p, "utf8");
        // EOL-TOLERANT ANCHORING. Anchors are authored with "\n", but a source file may be stored with
        // CRLF endings; a byte-literal match would then miss and the mutation would silently degrade into
        // an "anchor not found" failure instead of testing its fence. Re-express the anchor (and its
        // replacement) in the file's OWN dominant EOL so the mutation still targets the real code, and the
        // rewritten bytes keep the file's existing line-ending convention for a byte-exact restore.
        const fileEol = cur.includes("\r\n") ? "\r\n" : "\n";
        const toEol = (t) => (fileEol === "\n" ? t.replace(/\r\n/g, "\n") : t.replace(/\r?\n/g, "\r\n"));
        const from = toEol(edit[1]);
        const to = toEol(edit[2]);
        if (!cur.includes(from)) throw new Error(`anchor not found in ${edit[0]}`);
        writeFileSync(p, cur.replace(from, to));
      }
      // A syntax/compile/import failure is a MUTATION FAILURE (never a pass).
      compileTo(mutDir);
      const mm = wireBuild(mutDir);
      const detected = await mut.scenario(mm);
      if (typeof detected !== "boolean") throw new Error("scenario did not return a boolean (empty/invalid scenario)");
      let ok = detected;
      if (!ok) ok = await suiteGoesRed();
      if (ok) { console.log(`PASS ${mut.name}`); passed++; }
      else { console.log(`FAIL ${mut.name} (guard did not prove load-bearing)`); failed++; }
    } catch (e) {
      console.log(`FAIL ${mut.name} (${e.message})`); failed++;
    } finally {
      for (const [p, original] of originals) writeFileSync(p, original);
      rmSync(mutDir, { recursive: true, force: true });
      // restore the main build's DB shim on the (unchanged) main module graph
      installDb(M);
    }
  }
  return { passed, failed };
}

const functional = await runFunctional();
const mutationResults = await runMutations();
rmSync(MAIN_DIR, { recursive: true, force: true });
const passed = functional.passed + mutationResults.passed;
const failed = functional.failed + mutationResults.failed;
console.log(`\nSummary: ${passed} passed, ${failed} failed (functional: ${functional.passed}/${functional.passed + functional.failed}, mutation: ${mutationResults.passed}/${mutationResults.passed + mutationResults.failed}).`);
process.exit(failed > 0 ? 1 : 0);
