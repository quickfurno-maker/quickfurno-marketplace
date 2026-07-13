import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5F-D4-C — DURABLE ASYNCHRONOUS consent-command acknowledgement delivery.
 *
 * Everything is driven through INJECTED fakes:
 *   • the intent store is an in-memory table that MODELS the migration's constraints (unique idempotency
 *     key, at-most-one provider attempt, compare-and-set claim/reservation, terminal purge);
 *   • D2-C is a fake `decide` — the real authority is never queried;
 *   • the runtime CommunicationService factory is faked and COUNTS provider sends, so "zero provider calls
 *     from the webhook" is PROVEN, not asserted;
 *   • Supabase is stubbed to throw if ever touched.
 *
 * The SQL is additionally audited STATICALLY: the migration text must actually contain the fences the
 * in-memory model assumes. A model that is safer than the schema would prove nothing.
 *
 * No Supabase connection, no provider, no real key, no migration execution. Every mutation is restored
 * byte-identically in a `finally`.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const TS_FILES = [
  "lib/errors.ts",
  "lib/communication/phone.ts",
  "lib/communication/types.ts",
  "lib/communication/providers/providerError.ts",
  "lib/communication/providers/providerOutcome.ts",
  "lib/communication/providers/whatsappProvider.ts",
  "lib/communication/providers/metaWhatsAppInbound.ts",
  "lib/communication/consentCommandResponse.ts",
  "lib/communication/consentAckIntent.ts",
  "lib/communication/consentAckDestinationSeal.ts",
  "lib/communication/inboundConsentCommandInput.ts",
  "lib/communication/outboundConsentScope.ts",
];

const MIGRATION_SRC = "supabase/migrations/20260713000100_communication_consent_ack_intents.sql";
const INTENT_SRC = "lib/communication/consentAckIntent.ts";
const SEAL_SRC = "lib/communication/consentAckDestinationSeal.ts";
const ENQUEUE_SRC = "services/consentCommandResponseService.ts";
const WORKER_SRC = "services/consentAckWorkerService.ts";
const ROUTE_SRC = "app/api/internal/process-consent-ack-intents/route.ts";
const WEBHOOK_SRC = "services/metaWhatsAppWebhookService.ts";
const REGISTRY_SRC = "lib/communication/outboundConsentScope.ts";
const HARNESS_SRC = "scripts/phase5f-d4c-consent-ack-async-harness.mjs";
const D4B_HARNESS_SRC = "scripts/phase5f-d4b-consent-command-response-harness.mjs";
const DOC_SRC = "docs/QF-Consent-Ack-Async-Phase-5F-D4-C.md";

/** Frozen authorities D4-C may call but must NEVER modify. */
const FROZEN = [
  "services/communicationConsentDecisionService.ts",
  "services/communicationConsentWriterService.ts",
  "services/inboundConsentCommandService.ts",
  "services/outboundConsentEnforcementService.ts",
  "lib/communication/outboundConsentScope.ts",
  "services/communicationService.ts",
  "services/runtimeCommunicationService.ts",
  "scripts/phase5f-d2e-inbound-consent-integration-harness.mjs",
];

/** The APPROVED D4-C scope — ELEVEN files. Anything else is a scope violation. */
const D4C_EXPECTED_FILES = [
  MIGRATION_SRC, INTENT_SRC, SEAL_SRC, WORKER_SRC, ROUTE_SRC, HARNESS_SRC, DOC_SRC,
  ENQUEUE_SRC, WEBHOOK_SRC, D4B_HARNESS_SRC, "package.json",
];

// ============================================================================
// BUILD
// ============================================================================
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

/** Transpile a SERVICE in isolation — its imports are stubbed or already emitted. */
function transpileFiles(outDir, files, expectJs) {
  const tsconfigPath = resolve(`${outDir}.svc-${Math.random().toString(36).slice(2, 7)}.tsconfig.json`);
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: false, isolatedModules: true,
      outDir, rootDir: ".", types: [], noResolve: true,
    },
    files,
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  catch { /* expected noResolve diagnostics */ }
  finally { rmSync(tsconfigPath, { force: true }); }
  for (const js of expectJs) {
    if (!existsSync(resolve(outDir, js))) throw new Error(`did not transpile: ${js}`);
  }
}

function wireBuild(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const original = Module._load;
  const STUBS = {
    "../lib/supabase": { adminClient: () => { throw new Error("real Supabase must never run in the D4-C harness"); } },
    "./communicationConsentDecisionService": {
      decideCommunicationConsent: () => { throw new Error("the real D2-C must never run in the D4-C harness"); },
    },
    "./runtimeCommunicationService": {
      createRuntimeCommunicationService: () => { throw new Error("the real runtime factory must never run"); },
    },
  };
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return original.apply(this, [request, parent, isMain]);
  };
  const built = {
    Intent: req("./lib/communication/consentAckIntent.js"),
    Seal: req("./lib/communication/consentAckDestinationSeal.js"),
    Pure: req("./lib/communication/consentCommandResponse.js"),
    Registry: req("./lib/communication/outboundConsentScope.js"),
    Enqueue: req("./services/consentCommandResponseService.js"),
    Worker: req("./services/consentAckWorkerService.js"),
  };
  Module._load = original;
  return built;
}

const readF = (f) => readFileSync(f, "utf8");
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "").replace(/\/\/.*$/gm, "");
const stripSql = (s) => s.replace(/^\s*--.*$/gm, "");
/** Column/constraint DDL only: `comment on ... is '...';` is prose, not schema. */
const sqlDdlOnly = (s) => stripSql(s).replace(/comment on [\s\S]*?;/gi, "");
function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }
function gitDirty() {
  return execFileSync("git", ["status", "--porcelain", "-uall"], { encoding: "utf8" })
    .split("\n").map((l) => l.slice(3).trim()).filter(Boolean).map((p) => p.replace(/\\/g, "/"))
    .filter((p) => !p.startsWith(".phase5fd4c"));
}

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function has(re, s, msg) { assert(re.test(s), msg); }
function hasNot(re, s, msg) { assert(!re.test(s), msg); }

const MAIN_DIR = resolve(".phase5fd4c-build-main");
compileTo(MAIN_DIR);
transpileFiles(MAIN_DIR, [ENQUEUE_SRC, WORKER_SRC], [
  "services/consentCommandResponseService.js",
  "services/consentAckWorkerService.js",
]);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// FIXTURES
// ============================================================================
const WA_ID = "919812345678";
const E164 = "+919812345678";
const OTHER_E164 = "+919800000001";
const DEST_HASH = createHash("sha256").update(E164).digest("hex");
const WAMID = "wamid.HBgMOTE5ODEyMzQ1Njc4FQIAEhggABCDEF0123456789";
const CANONICAL_PMID = createHash("sha256").update(WAMID).digest("hex");
const ROW_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const WEBHOOK_RECEIPT_ID = "11111111-2222-4333-8444-555555555555";
const CMD_RECEIPT_ID = "99999999-8888-4777-8666-555555555555";
const INTENT_ID = "12121212-3434-4565-8787-909090909090";
const RECEIVED = "2026-07-13T10:00:00.000Z";
const ADAPTER_PROVIDER = "meta_whatsapp_cloud";
const CONSENT_PROVIDER = "meta_whatsapp";

const KEY_ID = "ack-key-v1";
const KEY_B64 = randomBytes(32).toString("base64url");
const OTHER_KEY_ID = "ack-key-v0";
const OTHER_KEY_B64 = randomBytes(32).toString("base64url");
const ENV_OK = {
  QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID: KEY_ID,
  QF_CONSENT_ACK_DESTINATION_KEYS: JSON.stringify({ [KEY_ID]: KEY_B64, [OTHER_KEY_ID]: OTHER_KEY_B64 }),
};

const envelope = (...messages) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: { phone_number_id: "111222333" },
    messages,
  } }] }],
});
const textMsg = (over = {}) => ({ from: WA_ID, id: WAMID, timestamp: "1752400000", type: "text", text: { body: "STOP" }, ...over });

const persistedItem = (over = {}) => ({
  message: { providerMessageId: WAMID, messageType: "text", ...(over.message ?? {}) },
  receipt: {
    inboundMessageId: ROW_ID,
    provider: ADAPTER_PROVIDER,          // D1-B speaks the ADAPTER vocabulary
    providerMessageId: WAMID,            // …and stores the RAW wamid
    destinationHash: DEST_HASH,
    receivedAt: RECEIVED,
    ...(over.receipt ?? {}),
  },
});
const commandItem = (over = {}) => ({
  inboundMessageId: ROW_ID, command: "stop", disposition: "stop_applied", replayed: false, ...over,
});

const aadFor = (over = {}) => ({
  schemaVersion: 1,
  intentId: INTENT_ID,
  consentCommandReceiptId: CMD_RECEIPT_ID,
  inboundMessageId: ROW_ID,
  canonicalProviderMessageHash: CANONICAL_PMID,
  destinationHash: DEST_HASH,
  ackType: "consent_stop_acknowledgement",
  expiresAt: "2026-07-13T10:15:00.000Z",
  ...over,
});

// ----------------------------------------------------------------------------
// POSTGRES-FAITHFUL timestamptz rendering
//
// This is the single most important fidelity detail in this harness. A `timestamptz` does NOT come back out
// of Postgres/PostgREST as the JavaScript `toISOString()` string that went in: it comes back as
// `2026-07-13T10:15:00+00:00` (and may carry microseconds). Echoing the input byte-for-byte would make the
// model SAFER than the real database in exactly the dimension that matters — the AAD — and would hide a
// total decryption failure. So every timestamp the store hands back is rendered the way Postgres renders it.
// ----------------------------------------------------------------------------
function pgTimestamptz(iso, { micros = false } = {}) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const base = new Date(ms).toISOString();          // 2026-07-13T10:15:00.000Z
  const noZ = base.slice(0, -1);                    // 2026-07-13T10:15:00.000
  const [datetime, frac = "000"] = noZ.split(".");
  if (micros) return `${datetime}.${frac}000+00:00`;              // 2026-07-13T10:15:00.000000+00:00
  return frac === "000" ? `${datetime}+00:00` : `${datetime}.${frac}+00:00`;
}

// ----------------------------------------------------------------------------
// The IN-MEMORY INTENT STORE — models the migration's fences exactly
// ----------------------------------------------------------------------------
function makeStore(opts = {}) {
  const rows = new Map();      // id → row
  const byKey = new Map();     // idempotency_key → id
  const calls = { insert: 0, claim: 0, reserve: 0, terminalize: 0, expire: 0, recover: 0 };

  return {
    rows, byKey, calls,
    insert(row) {
      calls.insert++;
      if (byKey.has(row.idempotency_key)) return "duplicate";   // uq_consent_ack_intent_idempotency
      const stored = {
        ...row,
        // AS POSTGRES WOULD RETURN THEM — never the caller's JS strings.
        received_at: pgTimestamptz(row.received_at, opts),
        expires_at: pgTimestamptz(row.expires_at, opts),
        status: "pending", locked_by: null, locked_at: null, claim_count: 0,
        provider_attempt_count: 0, terminal_code: null, completed_at: null,
      };
      rows.set(row.id, stored);
      byKey.set(row.idempotency_key, row.id);
      return "inserted";
    },

    /** qf_expire_consent_ack_intents: EXPIRED pending/claimed → terminal `expired`, seals purged. */
    expire(nowMs = Date.now()) {
      calls.expire++;
      let n = 0;
      for (const row of rows.values()) {
        if (!["pending", "claimed"].includes(row.status)) continue;   // NEVER a dispatching row
        if (Date.parse(row.expires_at) > nowMs) continue;
        row.status = "expired";
        row.terminal_code = "expired";
        purge(row);
        n++;
      }
      return n;
    },

    /** qf_recover_stale_dispatching…: stale dispatching WITH attempt=1 → terminal `uncertain`, purged. */
    recoverStaleDispatching(staleAfterSeconds, nowMs = Date.now()) {
      calls.recover++;
      // STRICT: the invariant is recovery > timeout(60) + margin(60) = 120, so 120 itself is UNSAFE.
      // This must mirror the SQL floor (`p_stale_after <= interval '120 seconds'` raises) byte for byte.
      if (!(staleAfterSeconds > 120 && staleAfterSeconds <= 3600)) throw new Error("UNSAFE_RECOVERY_THRESHOLD");
      let n = 0;
      for (const row of rows.values()) {
        if (row.status !== "dispatching") continue;
        if (row.provider_attempt_count !== 1) continue;               // EXPLICIT attempted-row fence
        if (row.locked_at === null) continue;
        if (Date.parse(row.locked_at) >= nowMs - staleAfterSeconds * 1000) continue;
        row.status = "uncertain";
        row.terminal_code = "worker_crashed_after_attempt_reserved";
        purge(row);
        n++;
      }
      return n;                                                       // NEVER back to pending/claimed
    },
    /** qf_claim_consent_ack_intents: pending OR stale-claimed, unexpired, attempt=0. NEVER dispatching. */
    claim(workerId, limit, nowMs = Date.now(), staleMs = 2 * 60 * 1000) {
      calls.claim++;
      const out = [];
      for (const row of rows.values()) {
        if (out.length >= Math.min(limit, 25)) break;
        if (Date.parse(row.expires_at) <= nowMs) continue;             // never claim an expired intent
        if (row.provider_attempt_count !== 0) continue;                // never re-claim an attempted intent
        const isPending = row.status === "pending";
        const isStaleClaimed = row.status === "claimed" && row.locked_at !== null && Date.parse(row.locked_at) < nowMs - staleMs;
        if (!isPending && !isStaleClaimed) continue;                   // dispatching + terminal excluded
        row.status = "claimed";
        row.locked_by = workerId;
        row.locked_at = new Date(nowMs).toISOString();
        row.claim_count += 1;
        out.push({ ...row });
      }
      return out;
    },
    /** qf_reserve_consent_ack_provider_attempt: CAS claimed→dispatching AND 0→1, lease owner only. */
    reserve(intentId, workerId, nowMs = Date.now()) {
      calls.reserve++;
      const row = rows.get(intentId);
      if (!row) return false;
      if (row.status !== "claimed") return false;
      if (row.locked_by !== workerId) return false;
      if (row.provider_attempt_count !== 0) return false;
      if (Date.parse(row.expires_at) <= nowMs) return false;
      row.status = "dispatching";
      row.provider_attempt_count = 1;
      return true;
    },
    /** qf_terminalize_consent_ack_intent: terminal status + PURGE, same statement. */
    terminalize(intentId, status, code) {
      calls.terminalize++;
      const row = rows.get(intentId);
      if (!row) return false;
      if (!["pending", "claimed", "dispatching"].includes(row.status)) return false;  // terminal is immutable
      row.status = status;
      row.terminal_code = code;
      purge(row);
      return true;
    },
  };
}

/** The purge every terminal transition performs — in the same statement, in the migration. */
function purge(row) {
  row.sealed_destination_ciphertext = null;
  row.sealed_destination_nonce = null;
  row.sealed_destination_auth_tag = null;
  row.encryption_key_id = null;
  row.locked_by = null;
  row.locked_at = null;
  row.completed_at = new Date().toISOString();   // ck_ack_intent_completed_at_matches_status
}

/** Assert the migration's completed_at / status invariant on every row of a store. */
function assertCompletedAtInvariant(store) {
  const LIVE = ["pending", "claimed", "dispatching"];
  for (const row of store.rows.values()) {
    if (LIVE.includes(row.status)) {
      assert(row.completed_at === null, `live row (${row.status}) must have completed_at NULL`);
    } else {
      assert(row.completed_at !== null, `terminal row (${row.status}) must have completed_at NOT NULL`);
    }
  }
}

/**
 * The receipt table models the REAL unique key (provider, provider_message_id, channel) PLUS the
 * normalized_command that D2-D actually wrote. A lookup whose command does not match resolves to null —
 * exactly as the `.eq("normalized_command", …)` filter does.
 */
function receiptTable(writtenCommand = "stop") {
  return async ({ provider, providerMessageId, channel, normalizedCommand }) => {
    if (provider !== CONSENT_PROVIDER) return null;
    if (providerMessageId !== CANONICAL_PMID) return null;
    if (channel !== "whatsapp") return null;
    if (normalizedCommand !== writtenCommand) return null;   // STOP can never bind to a START receipt
    return CMD_RECEIPT_ID;
  };
}

/** The DEFAULT: D2-D wrote a receipt for whichever command was processed. R1 uses a MISMATCHED table. */
function receiptTableForAnyCommand() {
  return async ({ provider, providerMessageId, channel, normalizedCommand }) => {
    if (provider !== CONSENT_PROVIDER) return null;
    if (providerMessageId !== CANONICAL_PMID) return null;
    if (channel !== "whatsapp") return null;
    if (!["stop", "start"].includes(normalizedCommand)) return null;
    return CMD_RECEIPT_ID;
  };
}

function enqueueDeps(store, over = {}) {
  return {
    resolveReceiptId: over.resolveReceiptId ?? receiptTableForAnyCommand(),
    insertIntent: over.insertIntent ?? (async (row) => store.insert(row)),
    seal: over.seal ?? ((pt, aad) => M.Seal.sealAckDestination(pt, aad, ENV_OK)),
  };
}

async function runEnqueue(store, over = {}) {
  return M.Enqueue.enqueueConsentCommandResponses({
    payload: over.payload ?? envelope(textMsg(over.msgOver ?? {})),
    webhookReceiptId: WEBHOOK_RECEIPT_ID,
    persisted: over.persisted ?? [persistedItem(over.persistedOver ?? {})],
    commands: over.commands ?? [commandItem(over.commandOver ?? {})],
  }, enqueueDeps(store, over.deps ?? {}));
}

/** A fake CommunicationService that COUNTS sends and runs the REAL one-shot enforcer. */
function workerDeps(store, over = {}) {
  const sends = { count: 0, intents: [], enforcerCalls: 0, decideCalls: 0 };
  const decide = over.decide ?? (async () => ({ ok: true, disposition: "no_consent_objection" }));

  return {
    sends,
    deps: {
      expireIntents: over.expireIntents ?? (async () => store.expire(over.nowMs ?? Date.now())),
      recoverStaleDispatching: over.recoverStaleDispatching
        ?? (async (secs) => store.recoverStaleDispatching(secs, over.nowMs ?? Date.now())),
      claim: over.claim ?? (async (w, l) => store.claim(w, l, over.nowMs ?? Date.now())),
      reserveAttempt: over.reserveAttempt ?? (async (id, w) => store.reserve(id, w, over.nowMs ?? Date.now())),
      terminalize: over.terminalize ?? (async (id, s, c) => store.terminalize(id, s, c)),
      decide: async (input) => { sends.decideCalls++; return decide(input); },
      createService: over.createService ?? ((enforcer) => ({
        ok: true,
        data: {
          async send(intent) {
            sends.enforcerCalls++;
            const outcome = await enforcer.authorize({
              channel: intent.channel,
              messageType: intent.type,
              templateKey: intent.template_key,
              lane: intent.lane,
              destinationHash: createHash("sha256").update(intent.destination_source.destination).digest("hex"),
              destinationSource: "ephemeral_auth_destination",
              recipientType: intent.recipient_type,
              recipientId: intent.recipient_id,
            });
            if (outcome.kind !== "allow") return { ok: false, code: outcome.code };
            sends.count++;
            sends.intents.push(intent);
            if (over.sendThrows) throw new Error("provider exploded");
            return over.sendResult ?? { ok: true, data: { status: "accepted" } };
          },
        },
      })),
      now: () => new Date(over.nowMs ?? Date.now()),
      env: over.env ?? ENV_OK,
    },
  };
}

// ============================================================================
// A. ENQUEUE — the webhook writes ONE durable intent and sends NOTHING
// ============================================================================
check("A1. a successful STOP command enqueues EXACTLY ONE durable intent", async () => {
  const store = makeStore();
  const r = await runEnqueue(store);
  assert(r.ok === true, "enqueue is always ok:true (best-effort)");
  assert(r.result.enqueued === 1, `one intent enqueued (got ${safeStringify(r.result)})`);
  assert(store.rows.size === 1, "exactly one row");
  const row = [...store.rows.values()][0];
  assert(row.ack_type === "consent_stop_acknowledgement", "the ack type is DERIVED from the command");
  assert(row.command === "stop" && row.authoritative_disposition === "stop_applied", "the authoritative result is bound");
  assert(row.consent_command_receipt_id === CMD_RECEIPT_ID, "bound to the AUTHORITATIVE D2-D receipt");
  assert(row.inbound_message_id === ROW_ID, "bound to the persisted inbound message");
  assert(row.provider === CONSENT_PROVIDER, `the CONSENT-domain provider key is stored (got ${row.provider})`);
  assert(row.canonical_provider_message_hash === CANONICAL_PMID, "the CANONICAL sha256 identity is stored, not the wamid");
  assert(row.status === "pending" && row.provider_attempt_count === 0, "it starts pending with zero attempts");
});

check("A2. the enqueue path performs ZERO provider calls and constructs NO CommunicationService", () => {
  const code = stripTs(readF(ENQUEUE_SRC));
  hasNot(/createRuntimeCommunicationService|CommunicationService|dispatchPersistedMessage/, code, "the enqueue path never constructs a communication service");
  hasNot(/decideCommunicationConsent|deps\.decide/, code, "the enqueue path never calls D2-C (the WORKER re-evaluates it)");
  hasNot(/fetch\(|axios|https?:\/\//, code, "the enqueue path never calls a provider");
  hasNot(/processConsentAckIntents|consentAckWorkerService/, code, "the enqueue path never invokes the worker");
  hasNot(/setTimeout|setInterval|queueMicrotask|\.then\(/, code, "no in-memory background promise");
});

check("A3. STOP/START expiry is +15 minutes, HELP is +24 hours — from the PERSISTED received_at", async () => {
  for (const [cmd, disp, mins] of [["stop", "stop_applied", 15], ["start", "start_applied", 15], ["help", "help_acknowledged", 24 * 60]]) {
    const store = makeStore();
    await runEnqueue(store, {
      msgOver: { text: { body: cmd.toUpperCase() } },
      commandOver: { command: cmd, disposition: disp },
    });
    const row = [...store.rows.values()][0];
    assert(row, `${cmd}: an intent exists`);
    const delta = Date.parse(row.expires_at) - Date.parse(RECEIVED);
    assert(delta === mins * 60 * 1000, `${cmd}: expiry is +${mins}m (got ${delta}ms)`);
  }
});

check("A4. HELP binds NO consent receipt (D2-D writes nothing for HELP) and looks none up", async () => {
  const store = makeStore();
  let lookups = 0;
  await runEnqueue(store, {
    msgOver: { text: { body: "HELP" } },
    commandOver: { command: "help", disposition: "help_acknowledged" },
    deps: { resolveReceiptId: async () => { lookups++; return CMD_RECEIPT_ID; } },
  });
  const row = [...store.rows.values()][0];
  assert(row.consent_command_receipt_id === null, "HELP has NO authoritative receipt");
  assert(row.ack_type === "consent_help_response", "HELP derives the help response type");
  assert(lookups === 0, "HELP never even looks a receipt up");
});

check("A5. a STOP whose authoritative receipt is MISSING is NEVER enqueued", async () => {
  const store = makeStore();
  const r = await runEnqueue(store, { deps: { resolveReceiptId: async () => null } });
  assert(r.result.items[0].outcome === "receipt_not_found", `receipt_not_found (got ${safeStringify(r.result.items)})`);
  assert(store.rows.size === 0, "no intent may exist without a real authoritative result");
});

check("A6. a FAILED / ineligible command creates NO intent", async () => {
  for (const disp of ["writer_unavailable", "writer_integrity_violation", "start_blocked_by_stronger_suppression", "unsupported_command"]) {
    const store = makeStore();
    const r = await runEnqueue(store, { commandOver: { command: "stop", disposition: disp } });
    assert(store.rows.size === 0, `${disp}: no intent`);
    assert(r.result.items[0].outcome === "ineligible_disposition", `${disp}: ineligible`);
  }
});

check("A7. a REPLAYED command creates NO intent", async () => {
  const store = makeStore();
  const r = await runEnqueue(store, { commandOver: { replayed: true } });
  assert(r.result.items[0].outcome === "replayed", "replayed");
  assert(store.rows.size === 0, "a redelivered command produces zero new intents");
});

check("A8. a DUPLICATE idempotency key is a safe no-op — never a second intent, never an error", async () => {
  const store = makeStore();
  const first = await runEnqueue(store);
  const second = await runEnqueue(store);      // identical webhook, replayed
  assert(first.result.enqueued === 1, "first enqueues");
  assert(second.result.duplicates === 1 && second.result.enqueued === 0, `second is a duplicate (got ${safeStringify(second.result)})`);
  assert(second.ok === true, "a duplicate is never an error");
  assert(store.rows.size === 1, "still exactly ONE intent");
});

check("A9. a destination-hash mismatch blocks the enqueue", async () => {
  const store = makeStore();
  const r = await runEnqueue(store, { persistedOver: { receipt: { inboundMessageId: ROW_ID, provider: ADAPTER_PROVIDER, providerMessageId: WAMID, destinationHash: "f".repeat(64), receivedAt: RECEIVED } } });
  assert(r.result.items[0].outcome === "destination_mismatch", `destination_mismatch (got ${safeStringify(r.result.items)})`);
  assert(store.rows.size === 0, "no intent");
});

check("A10. a MISSING / MALFORMED encryption key fails CLOSED — no intent, consent untouched", async () => {
  for (const env of [{}, { QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID: KEY_ID }, { QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID: KEY_ID, QF_CONSENT_ACK_DESTINATION_KEYS: "{oops" }]) {
    const store = makeStore();
    const r = await runEnqueue(store, { deps: { seal: (pt, aad) => M.Seal.sealAckDestination(pt, aad, env) } });
    assert(r.result.items[0].outcome === "seal_unavailable", `seal_unavailable (got ${safeStringify(r.result.items)})`);
    assert(store.rows.size === 0, "no intent is ever stored unsealed");
    assert(r.ok === true, "…and the consent command is still untouched");
  }
});

check("A11. an insert failure NEVER escapes — enqueue stays ok:true and consent stands", async () => {
  const store = makeStore();
  const r = await runEnqueue(store, { deps: { insertIntent: async () => { throw new Error("SQLSTATE 08006 +919812345678"); } } });
  assert(r.ok === true, "still ok:true");
  assert(r.result.items[0].outcome === "enqueue_failed", "closed outcome");
  const rendered = safeStringify(r);
  hasNot(/SQLSTATE|08006|\+9198/, rendered, "no DB error and no phone leaks into the result");
});

check("A12. NO plaintext, ciphertext, nonce, tag, key id or destination hash appears in the RESULT", async () => {
  const store = makeStore();
  const r = await runEnqueue(store);
  const rendered = safeStringify(r);
  hasNot(new RegExp(E164.replace("+", "\\+")), rendered, "no plaintext phone");
  hasNot(new RegExp(WA_ID), rendered, "no wa_id");
  hasNot(new RegExp(DEST_HASH), rendered, "no destination hash");
  hasNot(new RegExp(KEY_ID), rendered, "no key id");
  hasNot(/ciphertext|nonce|auth_tag|authTag/i, rendered, "no envelope material");
});

check("A13. the PERSISTED row carries NO plaintext phone — only the sealed envelope", async () => {
  const store = makeStore();
  await runEnqueue(store);
  const row = [...store.rows.values()][0];
  const rendered = safeStringify(row);
  hasNot(new RegExp(E164.replace("+", "\\+")), rendered, "no plaintext phone in the row");
  hasNot(new RegExp(WA_ID), rendered, "no wa_id in the row");
  assert(typeof row.sealed_destination_ciphertext === "string" && row.sealed_destination_ciphertext.length > 0, "a ciphertext IS stored");
  assert(row.encryption_key_id === KEY_ID, "the key ID is recorded (the key itself is not)");
});

// ============================================================================
// B. THE SEAL — AES-256-GCM, AAD-bound, fail-closed
// ============================================================================
check("B1. AES-256-GCM round trip succeeds with the exact AAD", () => {
  const aad = M.Intent.canonicalAckAad(aadFor());
  const sealed = M.Seal.sealAckDestination(E164, aad, ENV_OK);
  assert(sealed.ok, "seals");
  const opened = M.Seal.openAckDestination(sealed.value, aad, ENV_OK);
  assert(opened.ok && opened.value === E164, `round trips (got ${safeStringify(opened)})`);
});

check("B2. the NONCE differs on every seal (never reused, never a counter)", () => {
  const aad = M.Intent.canonicalAckAad(aadFor());
  const nonces = new Set();
  const cts = new Set();
  for (let i = 0; i < 25; i++) {
    const s = M.Seal.sealAckDestination(E164, aad, ENV_OK);
    assert(s.ok, "seals");
    nonces.add(s.value.nonce);
    cts.add(s.value.ciphertext);
  }
  assert(nonces.size === 25, `25 distinct nonces (got ${nonces.size})`);
  assert(cts.size === 25, "…so 25 distinct ciphertexts for the same plaintext");
});

check("B3. changing ANY AAD field makes the open FAIL (the ciphertext is non-transplantable)", () => {
  const baseAad = M.Intent.canonicalAckAad(aadFor());
  const sealed = M.Seal.sealAckDestination(E164, baseAad, ENV_OK);
  assert(sealed.ok, "seals");

  const mutations = {
    "intent id": { intentId: "deadbeef-1111-4222-8333-444444444444" },
    "consent receipt id": { consentCommandReceiptId: "deadbeef-1111-4222-8333-444444444444" },
    "inbound message id": { inboundMessageId: "deadbeef-1111-4222-8333-444444444444" },
    "provider message hash": { canonicalProviderMessageHash: "a".repeat(64) },
    "destination hash": { destinationHash: "b".repeat(64) },
    "ack type": { ackType: "consent_help_response" },
    "expiry": { expiresAt: "2026-07-13T11:15:00.000Z" },
    "schema version": { schemaVersion: 2 },
  };
  for (const [name, over] of Object.entries(mutations)) {
    const tampered = M.Intent.canonicalAckAad(aadFor(over));
    const opened = M.Seal.openAckDestination(sealed.value, tampered, ENV_OK);
    assert(!opened.ok && opened.code === "SEAL_AUTH_FAILED", `changed ${name} must fail the AEAD (got ${safeStringify(opened)})`);
  }
});

check("B4. an UNKNOWN key id fails closed — it is never 'tried anyway' against the primary key", () => {
  const aad = M.Intent.canonicalAckAad(aadFor());
  const sealed = M.Seal.sealAckDestination(E164, aad, ENV_OK);
  const opened = M.Seal.openAckDestination({ ...sealed.value, keyId: "ack-key-v99" }, aad, ENV_OK);
  assert(!opened.ok && opened.code === "SEAL_KEY_UNKNOWN", `SEAL_KEY_UNKNOWN (got ${safeStringify(opened)})`);
});

check("B5. MISSING / MALFORMED key configuration fails closed", () => {
  const aad = M.Intent.canonicalAckAad(aadFor());
  const cases = [
    [{}, "SEAL_CONFIG_MISSING"],
    [{ QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID: KEY_ID }, "SEAL_CONFIG_MISSING"],
    [{ QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID: KEY_ID, QF_CONSENT_ACK_DESTINATION_KEYS: "not-json" }, "SEAL_CONFIG_MALFORMED"],
    [{ QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID: KEY_ID, QF_CONSENT_ACK_DESTINATION_KEYS: "[]" }, "SEAL_CONFIG_MALFORMED"],
    // WRONG KEY LENGTH — a 16-byte key is never padded up to 32.
    [{ QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID: KEY_ID, QF_CONSENT_ACK_DESTINATION_KEYS: JSON.stringify({ [KEY_ID]: randomBytes(16).toString("base64url") }) }, "SEAL_CONFIG_MALFORMED"],
    // PRIMARY KEY ABSENT from the key set.
    [{ QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID: "nope", QF_CONSENT_ACK_DESTINATION_KEYS: JSON.stringify({ [KEY_ID]: KEY_B64 }) }, "SEAL_PRIMARY_KEY_MISSING"],
  ];
  for (const [env, code] of cases) {
    const s = M.Seal.sealAckDestination(E164, aad, env);
    assert(!s.ok && s.code === code, `${code} expected (got ${safeStringify(s)})`);
  }
});

check("B6. a MALFORMED nonce / tag / ciphertext fails closed", () => {
  const aad = M.Intent.canonicalAckAad(aadFor());
  const sealed = M.Seal.sealAckDestination(E164, aad, ENV_OK);
  const bad = [
    ["nonce", { nonce: randomBytes(8).toString("base64url") }],       // wrong length
    ["auth tag", { authTag: randomBytes(8).toString("base64url") }],  // wrong length
    ["ciphertext", { ciphertext: "!!!not-base64url!!!" }],
    ["empty ciphertext", { ciphertext: "" }],
  ];
  for (const [name, over] of bad) {
    const opened = M.Seal.openAckDestination({ ...sealed.value, ...over }, aad, ENV_OK);
    assert(!opened.ok, `malformed ${name} must fail (got ${safeStringify(opened)})`);
    assert(opened.code === "SEAL_ENVELOPE_MALFORMED" || opened.code === "SEAL_AUTH_FAILED", `${name}: closed code`);
  }
});

check("B7. ROTATION: a NON-primary key in the active set still OPENS; retiring it makes the open fail", () => {
  const aad = M.Intent.canonicalAckAad(aadFor());
  // Seal under v0 as primary…
  const envV0 = { QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID: OTHER_KEY_ID, QF_CONSENT_ACK_DESTINATION_KEYS: ENV_OK.QF_CONSENT_ACK_DESTINATION_KEYS };
  const sealed = M.Seal.sealAckDestination(E164, aad, envV0);
  assert(sealed.ok && sealed.value.keyId === OTHER_KEY_ID, "sealed under the old key");
  // …rotate: v1 is primary, v0 is still ACTIVE → the old ciphertext still opens.
  const opened = M.Seal.openAckDestination(sealed.value, aad, ENV_OK);
  assert(opened.ok && opened.value === E164, "an active non-primary key still opens");
  assert(M.Seal.ackSealKeyIsActive(OTHER_KEY_ID, ENV_OK), "…and is reported ACTIVE, so it must not be retired yet");
  // …retire v0 while a ciphertext still references it → fail closed (never a wrong-key guess).
  const envRetired = { QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID: KEY_ID, QF_CONSENT_ACK_DESTINATION_KEYS: JSON.stringify({ [KEY_ID]: KEY_B64 }) };
  const gone = M.Seal.openAckDestination(sealed.value, aad, envRetired);
  assert(!gone.ok && gone.code === "SEAL_KEY_UNKNOWN", "a retired key fails closed");
  assert(!M.Seal.ackSealKeyIsActive(OTHER_KEY_ID, envRetired), "…and is reported inactive");
});

check("B8. the canonical AAD is LENGTH-PREFIXED and fixed-order — fields cannot be smuggled across boundaries", () => {
  const a = M.Intent.canonicalAckAad(aadFor({ ackType: "consent_stop_acknowledgement" }));
  const b = M.Intent.canonicalAckAad(aadFor({ ackType: "consent_help_response" }));
  assert(a !== b, "different fields ⇒ different AAD");
  has(/^\d+:/, a, "each element is length-prefixed");
  // Two DIFFERENT field sets must never collide by shifting a boundary.
  const x = M.Intent.canonicalAckAad(aadFor({ canonicalProviderMessageHash: "a".repeat(64), destinationHash: "b".repeat(64) }));
  const y = M.Intent.canonicalAckAad(aadFor({ canonicalProviderMessageHash: "a".repeat(64) + "b".repeat(32), destinationHash: "b".repeat(32) }));
  assert(x !== y, "a boundary shift cannot produce the same AAD");
  hasNot(/^\{|\}$/, a, "it is NOT unordered object serialization");
});

// ============================================================================
// C. THE WORKER — claim, re-evaluate D2-C, reserve ONE attempt, dispatch, purge
// ============================================================================
async function enqueueOne(store, over = {}) {
  const r = await runEnqueue(store, over);
  assert(r.result.enqueued === 1, `fixture enqueued (got ${safeStringify(r.result)})`);
  return [...store.rows.values()][0];
}

check("C1. the happy path SENDS once, terminalizes `sent`, and PURGES every sealed field", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const w = workerDeps(store);
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(out.result.sent === 1, `sent once (got ${safeStringify(out.result)})`);
  assert(w.sends.count === 1, "exactly ONE provider send");
  const row = [...store.rows.values()][0];
  assert(row.status === "sent", "terminal `sent`");
  assert(row.provider_attempt_count === 1, "exactly one attempt");
  assert(row.sealed_destination_ciphertext === null && row.sealed_destination_nonce === null
    && row.sealed_destination_auth_tag === null && row.encryption_key_id === null,
    "ALL sealed fields purged");
});

check("C2. the worker sends the EXACT derived intent — auth lane, whatsapp, ephemeral, neutral recipient", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const w = workerDeps(store);
  await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  const sent = w.sends.intents[0];
  assert(sent.lane === "authentication", "authentication lane (storage compatibility)");
  assert(sent.channel === "whatsapp", "whatsapp");
  assert(sent.type === "consent_stop_acknowledgement", "the derived ack type");
  assert(sent.template_key === "consent_stop_acknowledgement", "template key ≡ message type");
  assert(sent.recipient_type === "system" && sent.recipient_id === null, "neutral recipient, never a principal");
  assert(sent.destination_source.kind === "ephemeral_auth_destination", "ephemeral destination");
  assert(sent.destination_source.destination === E164, "…addressed to the OPENED destination");
  assert(sent.scheduled_at === null, "never scheduled");
  assert(safeStringify(sent.variables) === "{}", "no variables — the copy is fixed");
  const meta = safeStringify(sent.metadata);
  hasNot(new RegExp(E164.replace("+", "\\+")), meta, "no plaintext phone in the persisted metadata");
  hasNot(new RegExp(DEST_HASH), meta, "no destination hash in the metadata");
  hasNot(new RegExp(KEY_ID), meta, "no key id in the metadata");
});

check("C3. D2-C is RE-EVALUATED by the worker, with authentication/global-only semantics", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const seen = [];
  const w = workerDeps(store, { decide: async (input) => { seen.push(input); return { ok: true, disposition: "no_consent_objection" }; } });
  await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(seen.length === 1, `D2-C consulted exactly once (got ${seen.length})`);
  const i = seen[0];
  assert(i.channel === "whatsapp", "channel whatsapp");
  assert(i.scope === "authentication", "scope authentication (global-suppression-only)");
  assert(i.destinationHash === DEST_HASH, "the BOUND destination hash");
  assert(i.identityConfidence === "unknown", "identity confidence unknown — never upgraded");
  assert(i.principal === null, "principal null — an inbound sender is never claimed");
});

check("C4. a NEWLY-CREATED global suppression BLOCKS dispatch → terminal `suppressed`, purged", async () => {
  const store = makeStore();
  await enqueueOne(store);
  // The intent was enqueued while allowed; by dispatch time a global suppression has landed.
  const w = workerDeps(store, { decide: async () => ({ ok: true, disposition: "blocked" }) });
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(out.result.suppressed === 1, `suppressed (got ${safeStringify(out.result)})`);
  assert(w.sends.count === 0, "ZERO provider sends");
  const row = [...store.rows.values()][0];
  assert(row.status === "suppressed", "terminal `suppressed`");
  assert(row.sealed_destination_ciphertext === null && row.encryption_key_id === null, "sealed fields purged");
});

check("C5. a D2-C AUTHORITY FAILURE never becomes an allow", async () => {
  for (const decision of [
    async () => ({ ok: false, code: "AUTHORITY_LOOKUP_FAILED" }),
    async () => ({ ok: false, code: "CONSENT_AUTHORITY_INTEGRITY" }),
    async () => { throw new Error("db down"); },
    async () => ({ ok: true, disposition: "marketing_opted_in" }),   // an unexpected disposition
  ]) {
    const store = makeStore();
    await enqueueOne(store);
    const w = workerDeps(store, { decide: decision });
    const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    assert(w.sends.count === 0, "no provider send on an authority failure");
    assert(out.result.sent === 0, "never sent");
    const row = [...store.rows.values()][0];
    assert(row.status === "failed", `fails closed (got ${row.status})`);
  }
});

check("C6. an EXPIRED intent is NEVER sent — the sweep terminalizes it before delivery", async () => {
  const store = makeStore();
  const row0 = await enqueueOne(store);
  const afterExpiry = Date.parse(row0.expires_at) + 1000;
  const w = workerDeps(store, { nowMs: afterExpiry });
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(out.maintenance.expired === 1, `the sweep expired it (got ${safeStringify(out.maintenance)})`);
  assert(w.sends.count === 0, "ZERO provider sends");
  assert(w.sends.decideCalls === 0, "D2-C is not even consulted");
  const after = [...store.rows.values()][0];
  assert(after.status === "expired", "terminal `expired`");
  assert(after.sealed_destination_ciphertext === null, "sealed fields purged");
});

check("C6b. even if an expired row REACHES delivery, the worker refuses it", async () => {
  // Contrived: the sweep is disabled, so an expired row is handed straight to deliverOne.
  const store = makeStore();
  const row0 = await enqueueOne(store);
  const afterExpiry = Date.parse(row0.expires_at) + 1000;
  const w = workerDeps(store, {
    expireIntents: async () => 0,                                   // sweep disabled
    claim: async (wid) => store.claim(wid, 25, Date.parse(RECEIVED) + 1000),
    nowMs: afterExpiry,
  });
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(out.result.expired === 1, `deliverOne refuses it (got ${safeStringify(out.result)})`);
  assert(w.sends.count === 0, "ZERO provider sends");
  assert(w.sends.decideCalls === 0, "D2-C is not even consulted");
});

check("C7. the CLAIM never returns an expired intent", async () => {
  const store = makeStore();
  const row = await enqueueOne(store);
  const claimed = store.claim("w1", 25, Date.parse(row.expires_at) + 1);
  assert(claimed.length === 0, "an expired intent is never claimable");
});

check("C8. TWO concurrent workers ⇒ exactly ONE provider attempt", async () => {
  const store = makeStore();
  await enqueueOne(store);
  // Both workers see the SAME claimed row (a contrived worst case: the lease was handed to both).
  const claimedRow = store.claim("w1", 25)[0];
  const forBoth = async () => [{ ...claimedRow }];

  const w1 = workerDeps(store, { claim: forBoth });
  const w2 = workerDeps(store, { claim: forBoth });
  const [o1, o2] = await Promise.all([
    M.Worker.processConsentAckIntents({ workerId: "w1" }, w1.deps),
    M.Worker.processConsentAckIntents({ workerId: "w1" }, w2.deps),
  ]);
  const totalSends = w1.sends.count + w2.sends.count;
  assert(totalSends === 1, `exactly ONE provider send across both workers (got ${totalSends})`);
  const notReserved = [...o1.result.items, ...o2.result.items].filter((i) => i.outcome === "attempt_not_reserved");
  assert(notReserved.length === 1, "the loser reports attempt_not_reserved and sends nothing");
  const row = [...store.rows.values()][0];
  assert(row.provider_attempt_count === 1, "provider_attempt_count is 1, never 2");
});

check("C9. provider_attempt_count can NEVER exceed one — the reservation is compare-and-set", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const row = [...store.rows.values()][0];
  store.claim("w1", 25);
  assert(store.reserve(row.id, "w1") === true, "the first reservation wins");
  assert(store.reserve(row.id, "w1") === false, "a SECOND reservation by the same worker loses");
  assert(store.reserve(row.id, "w2") === false, "…and by another worker too");
  assert(row.provider_attempt_count === 1, "still exactly 1");
});

check("C10. a STALE PRE-ATTEMPT claim is recoverable; a DISPATCHING intent is NEVER reclaimed", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const row = [...store.rows.values()][0];

  // (a) claimed, crashed BEFORE reserving → reclaimable after the lease lapses.
  store.claim("dead-worker", 25);
  assert(row.status === "claimed" && row.provider_attempt_count === 0, "claimed, no attempt");
  const later = Date.now() + 3 * 60 * 1000;                       // lease is 2 minutes
  const reclaimed = store.claim("w2", 25, later);
  assert(reclaimed.length === 1 && reclaimed[0].locked_by === "w2", "a stale PRE-ATTEMPT claim is reclaimed");

  // (b) now it reserves the attempt and crashes → dispatching. It must NEVER be reclaimed.
  assert(store.reserve(row.id, "w2", later) === true, "reserves");
  assert(row.status === "dispatching" && row.provider_attempt_count === 1, "dispatching, attempt reserved");
  const muchLater = later + 60 * 60 * 1000;
  const again = store.claim("w3", 25, muchLater);
  assert(again.length === 0, "a DISPATCHING intent is NEVER reclaimed — that could double-send");
});

check("C11. a THROW after the attempt is reserved ⇒ terminal `uncertain`, never resent", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const w = workerDeps(store, { sendThrows: true });
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(out.result.uncertain === 1, `uncertain (got ${safeStringify(out.result)})`);
  const row = [...store.rows.values()][0];
  assert(row.status === "uncertain", "terminal `uncertain`");
  assert(row.provider_attempt_count === 1, "the attempt was consumed");
  assert(row.sealed_destination_ciphertext === null, "sealed fields purged — it can never be addressed again");

  // A SECOND worker run must not resend it.
  const w2 = workerDeps(store);
  const out2 = await M.Worker.processConsentAckIntents({ workerId: "w2" }, w2.deps);
  assert(out2.result.claimed === 0 && w2.sends.count === 0, "an uncertain intent is NEVER automatically resent");
});

check("C12. a DECRYPTION failure blocks with ZERO provider calls → terminal `failed`, purged", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const row = [...store.rows.values()][0];
  row.sealed_destination_ciphertext = randomBytes(24).toString("base64url");  // tampered
  const w = workerDeps(store);
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(out.result.items[0].outcome === "seal_failed", `seal_failed (got ${safeStringify(out.result.items)})`);
  assert(w.sends.count === 0, "ZERO provider calls");
  assert([...store.rows.values()][0].status === "failed", "terminal `failed`");
});

check("C13. a MISSING KEY at worker time blocks — no fallback destination, no guess", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const w = workerDeps(store, { env: {} });     // the key is gone
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(out.result.items[0].outcome === "seal_failed", "seal_failed");
  assert(w.sends.count === 0, "ZERO provider calls");
  assert([...store.rows.values()][0].status === "failed", "terminal `failed`");
});

check("C14. a DESTINATION-HASH MISMATCH after decryption blocks the send", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const row = [...store.rows.values()][0];
  // Re-seal a DIFFERENT number under the SAME AAD (an attacker with the key, or a corrupted write).
  const aad = M.Intent.canonicalAckAad({
    schemaVersion: 1, intentId: row.id, consentCommandReceiptId: row.consent_command_receipt_id,
    inboundMessageId: row.inbound_message_id, canonicalProviderMessageHash: row.canonical_provider_message_hash,
    destinationHash: row.destination_hash, ackType: row.ack_type, expiresAt: row.expires_at,
  });
  const resealed = M.Seal.sealAckDestination(OTHER_E164, aad, ENV_OK);
  assert(resealed.ok, "re-sealed a different destination");
  row.sealed_destination_ciphertext = resealed.value.ciphertext;
  row.sealed_destination_nonce = resealed.value.nonce;
  row.sealed_destination_auth_tag = resealed.value.authTag;

  const w = workerDeps(store);
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(out.result.items[0].outcome === "destination_mismatch", `destination_mismatch (got ${safeStringify(out.result.items)})`);
  assert(w.sends.count === 0, "the WRONG number is NEVER messaged");
  assert([...store.rows.values()][0].status === "failed", "terminal `failed`");
});

check("C15. EVERY terminal status purges the sealed fields", async () => {
  const cases = [
    ["sent", {}],
    ["suppressed", { decide: async () => ({ ok: true, disposition: "blocked" }) }],
    ["failed", { env: {} }],
    ["uncertain", { sendThrows: true }],
  ];
  for (const [expected, over] of cases) {
    const store = makeStore();
    await enqueueOne(store);
    const w = workerDeps(store, over);
    await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    const row = [...store.rows.values()][0];
    assert(row.status === expected, `${expected}: reached (got ${row.status})`);
    assert(row.sealed_destination_ciphertext === null, `${expected}: ciphertext purged`);
    assert(row.sealed_destination_nonce === null, `${expected}: nonce purged`);
    assert(row.sealed_destination_auth_tag === null, `${expected}: auth tag purged`);
    assert(row.encryption_key_id === null, `${expected}: key id purged`);
  }
  // …and `expired` (driven separately, since it needs a clock).
  const store = makeStore();
  const row0 = await enqueueOne(store);
  const w = workerDeps(store, {
    claim: async (wid) => store.claim(wid, 25, Date.parse(RECEIVED) + 1000),
    nowMs: Date.parse(row0.expires_at) + 1000,
  });
  await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  const row = [...store.rows.values()][0];
  assert(row.status === "expired", "expired: reached");
  assert(row.sealed_destination_ciphertext === null && row.encryption_key_id === null, "expired: purged");
});

check("C16. the one-shot enforcer is PRIVATE and cannot be reused", async () => {
  const code = stripTs(readF(WORKER_SRC));
  hasNot(/export\s+(function|const)\s+createOneShotAckEnforcer/, code, "the enforcer is NEVER exported");
  has(/let used = false/, code, "it is one-use");
  assert(M.Worker.createOneShotAckEnforcer === undefined, "…and is not reachable from the module surface");

  // Behavioural: a service that tries to send TWICE gets exactly one allow.
  const store = makeStore();
  await enqueueOne(store);
  let allows = 0;
  const w = workerDeps(store, {
    createService: (enforcer) => ({
      ok: true,
      data: {
        async send(intent) {
          const mk = () => ({
            channel: intent.channel, messageType: intent.type, templateKey: intent.template_key,
            lane: intent.lane, destinationHash: DEST_HASH, destinationSource: "ephemeral_auth_destination",
            recipientType: intent.recipient_type, recipientId: intent.recipient_id,
          });
          const a = await enforcer.authorize(mk());
          const b = await enforcer.authorize(mk());   // a SECOND send on one validated intent
          if (a.kind === "allow") allows++;
          if (b.kind === "allow") allows++;
          return { ok: true, data: { status: "accepted" } };
        },
      },
    }),
  });
  await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(allows === 1, `exactly ONE authorization from one intent (got ${allows})`);
});

// ============================================================================
// D. THE WEBHOOK — enqueue only, no provider, no worker
// ============================================================================
check("D1. the webhook ENQUEUES and never sends, dispatches, or runs the worker", () => {
  const code = stripTs(readF(WEBHOOK_SRC));
  has(/enqueueConsentCommandResponses/, code, "it calls the ENQUEUE path");
  hasNot(/processConsentCommandResponses/, code, "the old inline send is GONE");
  hasNot(/processConsentAckIntents|consentAckWorkerService/, code, "the webhook never runs the worker inline");
  hasNot(/setTimeout|setInterval|queueMicrotask/, code, "no in-memory background promise");
  hasNot(/n8n|jarvis/i, code, "no n8n, no Jarvis");
  // The DELIVERY-STATUS branch legitimately uses CommunicationService (Phase 5B lifecycle). The INBOUND
  // branch must not: it may persist, process the command and ENQUEUE — nothing else.
  const iInbound = code.indexOf("MetaWebhookClassification.INBOUND_MESSAGE");
  assert(iInbound > 0, "the INBOUND branch exists");
  const inbound = code.slice(iInbound);
  hasNot(/new CommunicationService|createRuntimeCommunicationService|service\.send\(/, inbound,
    "the INBOUND branch never constructs or calls CommunicationService");
  // …and the DELIVERY branch (which legitimately does) sits BEFORE it and is untouched.
  assert(code.indexOf("new CommunicationService") < iInbound, "CommunicationService is used only by the delivery branch");
});

check("D2. the enqueue is AFTER the completed command result, and a command failure prevents it", () => {
  const code = readF(WEBHOOK_SRC);
  const iCommands = code.indexOf("processInboundConsentCommands");
  const iGuard = code.indexOf("inbound_command_processing_failed");
  const iEnqueue = code.indexOf("await enqueueConsentCommandResponses(");
  assert(iCommands > 0 && iGuard > 0 && iEnqueue > 0, "all three exist");
  assert(iCommands < iGuard, "the command result is checked…");
  assert(iGuard < iEnqueue, "…and a FAILED command returns BEFORE the enqueue is reached");
  const iPersist = code.indexOf("handleInboundWhatsAppMessages");
  assert(iPersist > 0 && iPersist < iCommands, "persistence precedes command processing");
});

check("D3. the enqueue is wrapped — a throw can never change the webhook response", () => {
  const code = readF(WEBHOOK_SRC);
  const i = code.indexOf("await enqueueConsentCommandResponses(");
  const before = code.slice(Math.max(0, i - 400), i);
  has(/try\s*\{/, before, "the enqueue sits inside a try");
  const after = code.slice(i, i + 600);
  has(/\}\s*catch\s*\{/, after, "…with a catch that swallows");
});

// ============================================================================
// E. BOUNDARIES — D3-B exclusion, n8n/Jarvis absence, HELP no-write
// ============================================================================
check("E1. the three ack types remain ABSENT from the ordinary D3-B registry", () => {
  const reg = readF(REGISTRY_SRC);
  for (const t of M.Pure.CONSENT_ACK_TYPES) {
    hasNot(new RegExp(t), reg, `${t} must NOT be in the ordinary D3-B registry`);
  }
  // …and the ordinary resolver therefore DENIES them as UNCLASSIFIED_MESSAGE_TYPE.
  for (const t of M.Pure.CONSENT_ACK_TYPES) {
    assert(!M.Registry.REGISTERED_MESSAGE_TYPES.includes(t), `${t} is not a registered ordinary type`);
    const r = M.Registry.resolveOutboundConsentScope({ messageType: t, lane: "authentication", channel: "whatsapp" });
    assert(r.ok === false && r.reason === "UNCLASSIFIED_MESSAGE_TYPE",
      `ordinary D3-B must deny ${t} as UNCLASSIFIED_MESSAGE_TYPE (got ${safeStringify(r)})`);
  }
});

check("E2. HELP performs NO consent write anywhere in the D4-C path", () => {
  for (const f of [ENQUEUE_SRC, WORKER_SRC, ROUTE_SRC]) {
    const code = stripTs(readF(f));
    hasNot(/apply_communication_consent_command|writeConsentCommand|communicationConsentWriterService/, code, `${f} never writes consent`);
    hasNot(/communication_suppressions|communication_preferences|communication_consent_events/, code, `${f} never touches a consent table`);
  }
});

check("E3. n8n and Jarvis appear NOWHERE in the D4-C path", () => {
  for (const f of [ENQUEUE_SRC, WORKER_SRC, ROUTE_SRC, INTENT_SRC, SEAL_SRC, MIGRATION_SRC]) {
    const code = readF(f).replace(/^\s*(--|\/\/).*$/gm, "");
    hasNot(/n8n|jarvis/i, code, `${f} contains no n8n / Jarvis`);
  }
});

check("E4. the worker never imports a provider adapter directly", () => {
  const code = stripTs(readF(WORKER_SRC));
  hasNot(/providers\/meta|MetaCloudWhatsAppProvider|httpTransport|fetch\(/, code, "no direct provider access");
  has(/runtimeCommunicationService/, code, "it goes through the ordinary runtime factory");
});

check("E5. NO plaintext phone is ever logged", () => {
  for (const f of [ENQUEUE_SRC, WORKER_SRC, ROUTE_SRC, SEAL_SRC]) {
    const code = stripTs(readF(f));
    hasNot(/console\.(log|info|warn|error|debug)/, code, `${f} logs nothing at all`);
  }
});

// ============================================================================
// F. THE INTERNAL ROUTE
// ============================================================================
check("F1. the route requires a TIMING-SAFE cron secret and rejects missing/incorrect ones", () => {
  const code = stripTs(readF(ROUTE_SRC));
  has(/x-qf-cron-secret/, code, "the header");
  has(/QF_CRON_SECRET/, code, "the env var");
  // The COMPARISON ITSELF must be constant-time — an import alone proves nothing.
  has(/return timingSafeEqual\(a, b\);/, code, "the comparison is TIMING-SAFE");
  hasNot(/return provided === expected/, code, "…and never a short-circuiting string equality");
  has(/status:\s*401/, code, "401 on a bad secret");
  // An UNSET server secret must FAIL CLOSED — it never means 'allow everyone'.
  has(/if \(expected === ""\) return \{ ok: false/, code, "an unset server secret fails closed");
  hasNot(/if \(expected === ""\) return \{ ok: true/, code, "…and never opens the door");
  hasNot(/console\.(log|info|warn|error)/, code, "the secret is never logged");
});

check("F2. the route is POST-only", () => {
  const code = readF(ROUTE_SRC);
  has(/export async function POST/, code, "POST exists");
  has(/export async function GET[\s\S]*405/, code, "GET is 405");
});

check("F3. the route accepts NO caller-selected destination, intent, type, scope, provider or retry", () => {
  const code = stripTs(readF(ROUTE_SRC));
  for (const forbidden of [/destination/i, /intentId|intent_id/, /ackType|ack_type/, /scope/i, /recipient/i, /retry/i, /template/i]) {
    hasNot(forbidden, code, `the route must not accept ${forbidden}`);
  }
  has(/limit/, code, "the ONLY caller input is a bounded batch size");
  has(/Math\.min\(Math\.max\(/, code, "…and it is clamped");
});

check("F4. the route contains NO consent policy, decrypts nothing, and exposes no rows", () => {
  const code = stripTs(readF(ROUTE_SRC));
  hasNot(/decideCommunicationConsent|suppression|openAckDestination|createDecipheriv/, code, "no policy, no decryption");
  hasNot(/ciphertext|destination_hash|encryption_key_id/, code, "no envelope or hash is ever exposed");
  has(/claimed[\s\S]*sent[\s\S]*suppressed[\s\S]*expired[\s\S]*failed[\s\S]*uncertain/, code, "it returns SANITIZED counts only");
});

// ============================================================================
// G. THE MIGRATION — statically audited (the model must not be safer than the schema)
// ============================================================================
check("G1. the table, the closed statuses and the closed ack types", () => {
  const sql = stripSql(readF(MIGRATION_SRC));
  has(/create table if not exists public\.communication_consent_ack_intents/, sql, "the exact table name");
  for (const s of ["pending", "claimed", "dispatching", "sent", "suppressed", "expired", "failed", "uncertain"]) {
    has(new RegExp(`'${s}'`), sql, `status '${s}' exists`);
  }
  has(/status\s+text not null default 'pending'\s*\n?\s*check \(status in \([^)]*\)\)/m, sql, "status is a CLOSED check");
  for (const t of ["consent_stop_acknowledgement", "consent_start_acknowledgement", "consent_help_response"]) {
    has(new RegExp(`'${t}'`), sql, `ack type '${t}'`);
  }
  has(/check \(ack_type in \(/, sql, "ack_type is a CLOSED check");
});

check("G2. UNIQUE idempotency + at-most-one provider attempt", () => {
  const sql = stripSql(readF(MIGRATION_SRC));
  has(/constraint uq_consent_ack_intent_idempotency unique \(idempotency_key\)/, sql, "UNIQUE idempotency_key");
  has(/provider_attempt_count\s+integer not null default 0 check \(provider_attempt_count in \(0, 1\)\)/, sql, "attempt count constrained to 0 or 1");
});

check("G3. REAL foreign keys to the authoritative receipt and the inbound message", () => {
  const sql = stripSql(readF(MIGRATION_SRC));
  has(/consent_command_receipt_id\s+uuid references public\.communication_consent_command_receipts\(id\)/, sql, "FK → consent command receipts");
  has(/inbound_message_id\s+uuid not null references public\.communication_inbound_messages\(id\)/, sql, "FK → inbound messages");
  has(/constraint ck_ack_intent_receipt_binding check \(/, sql, "…and STOP/START must have one while HELP must not");
});

check("G4. NO plaintext phone, NO raw payload, NO secret-bearing generic JSON", () => {
  const sql = sqlDdlOnly(readF(MIGRATION_SRC));
  hasNot(/phone_e164|wa_id|msisdn|sender_phone|plaintext/i, sql, "no plaintext phone column");
  hasNot(/payload_json|raw_payload|webhook_payload|message_body|body\s+text/i, sql, "no raw payload / message body");
  hasNot(/secret|token|credential|access_token/i, sql, "no credential column");
  // The ONLY jsonb-free design: this table has no generic JSON bag at all.
  hasNot(/jsonb/i, sql, "no generic JSON payload column exists to smuggle a secret into");
});

check("G5. RLS on, privileges revoked, service-role only, safe SECURITY DEFINER search_path", () => {
  const sql = stripSql(readF(MIGRATION_SRC));
  has(/alter table public\.communication_consent_ack_intents enable row level security/, sql, "RLS enabled");
  for (const role of ["public", "anon", "authenticated"]) {
    has(new RegExp(`revoke all on table public\\.communication_consent_ack_intents from ${role}`), sql, `revoked from ${role}`);
  }
  hasNot(/create policy/i, sql, "NO anon/authenticated policy exists at all");
  const definers = sql.match(/security definer/g) ?? [];
  const paths = sql.match(/set search_path = pg_catalog, public, pg_temp/g) ?? [];
  assert(definers.length >= 5, `all 5 RPCs are SECURITY DEFINER (got ${definers.length})`);
  assert(paths.length >= definers.length, `every SECURITY DEFINER pins a safe search_path (${paths.length} vs ${definers.length})`);
});

check("G6. the CLAIM uses SKIP LOCKED, excludes dispatching/attempted/expired, and is bounded to 25", () => {
  const sql = stripSql(readF(MIGRATION_SRC));
  const fn = sql.slice(sql.indexOf("function public.qf_claim_consent_ack_intents"), sql.indexOf("function public.qf_reserve_consent_ack_provider_attempt"));
  has(/for update skip locked/, fn, "FOR UPDATE SKIP LOCKED");
  has(/c\.expires_at > now\(\)/, fn, "never claims an EXPIRED intent");
  has(/c\.provider_attempt_count = 0/, fn, "never claims an ATTEMPTED intent (so never a dispatching one)");
  has(/c\.status = 'pending'/, fn, "claims pending…");
  has(/c\.status = 'claimed' and c\.locked_at is not null and c\.locked_at < now\(\) - p_stale_lease/, fn, "…and STALE claimed only");
  hasNot(/'dispatching'/, fn, "'dispatching' is never claimable");
  has(/least\(greatest\(coalesce\(p_limit, 25\), 1\), 25\)/, fn, "bounded to 25");
  has(/interval '2 minutes'/, fn, "≈2-minute stale lease, explicit and bounded");
});

check("G7. the provider-attempt RESERVATION is compare-and-set", () => {
  const sql = stripSql(readF(MIGRATION_SRC));
  const fn = sql.slice(sql.indexOf("function public.qf_reserve_consent_ack_provider_attempt"), sql.indexOf("function public.qf_terminalize_consent_ack_intent"));
  has(/set status\s*= 'dispatching'/, fn, "claimed → dispatching");
  has(/provider_attempt_count = 1/, fn, "…and 0 → 1");
  has(/and status\s*= 'claimed'/, fn, "CAS on the prior status");
  has(/and locked_by\s*= trim\(p_worker_id\)/, fn, "…the lease owner only");
  has(/and provider_attempt_count = 0/, fn, "…and only when no attempt exists");
  has(/return v_updated = 1/, fn, "false ⇒ the caller must not call the provider");
});

check("G8. EVERY terminal transition purges ALL sealed fields, in the same statement", () => {
  const sql = stripSql(readF(MIGRATION_SRC));
  const purge = /sealed_destination_ciphertext = null,\s*sealed_destination_nonce\s*= null,\s*sealed_destination_auth_tag\s*= null,\s*encryption_key_id\s*= null/g;
  const found = sql.match(purge) ?? [];
  assert(found.length >= 3, `terminalize + expiry sweep + stale recovery all purge (got ${found.length})`);
  has(/constraint ck_ack_intent_terminal_is_purged check \(/, sql, "…and a terminal row carrying a sealed field cannot even be STORED");
  // The expiry sweep exists and never touches dispatching.
  const sweep = sql.slice(sql.indexOf("function public.qf_expire_consent_ack_intents"), sql.indexOf("function public.qf_recover_stale_dispatching_consent_ack_intents"));
  has(/where status in \('pending', 'claimed'\)/, sweep, "the expiry sweep never touches a DISPATCHING row");
  has(/expires_at <= now\(\)/, sweep, "…and only expired ones");
});

check("G9. a STALE DISPATCHING row becomes terminal `uncertain` — never pending, never claimed, never resent", () => {
  const sql = stripSql(readF(MIGRATION_SRC));
  const fn = sql.slice(sql.indexOf("function public.qf_recover_stale_dispatching_consent_ack_intents"));
  has(/where status = 'dispatching'/, fn, "it targets dispatching rows");
  has(/set status\s*= 'uncertain'/, fn, "…and terminalizes them UNCERTAIN");
  hasNot(/= 'pending'|= 'claimed'/, fn, "it NEVER returns them to pending/claimed");
});

check("G10. no EXISTING migration changed; the new migration is the only one added", () => {
  const dirty = gitDirty().filter((p) => p.startsWith("supabase/migrations/"));
  assert(dirty.length === 1 && dirty[0] === MIGRATION_SRC, `only the new migration may appear (got ${safeStringify(dirty)})`);
});

// ============================================================================
// H. SCOPE + FROZEN
// ============================================================================
check("H1. FROZEN authorities are byte-unchanged; the scope is exactly the approved 11 files", () => {
  const dirty = gitDirty();
  for (const f of FROZEN) assert(!dirty.includes(f), `a FROZEN authority must not change: ${f}`);
  for (const p of dirty) {
    assert(!/^app\/api\/(?!internal\/process-consent-ack-intents)/.test(p), `no other API route may change (${p})`);
    assert(!/\.env/.test(p), `no env file may change (${p})`);
    assert(!/^lib\/communication\/providers\//.test(p), `no provider adapter may change (${p})`);
    assert(!/package-lock\.json|yarn\.lock|pnpm-lock\.yaml/.test(p), `no lockfile may change (${p})`);
    assert(D4C_EXPECTED_FILES.includes(p), `file outside the approved D4-C scope: ${p}`);
  }
});

check("H2. NO acknowledgement template row is seeded, and NO SQL is executed", () => {
  const all = [readF(ENQUEUE_SRC), readF(WORKER_SRC), readF(ROUTE_SRC), readF(MIGRATION_SRC)].join("\n");
  hasNot(/insert into public\.communication_templates|insert into communication_templates/i, all, "no template seed");
  const code = [readF(ENQUEUE_SRC), readF(WORKER_SRC), readF(ROUTE_SRC)].join("\n");
  hasNot(/create table|alter table|drop table/i, code, "no DDL from application code");
});

check("H3. no real encryption key is created or committed", () => {
  for (const f of [SEAL_SRC, ENQUEUE_SRC, WORKER_SRC, ROUTE_SRC]) {
    const code = readF(f);
    hasNot(/randomBytes\(32\)\.toString/, code, `${f} never GENERATES a key`);
    const withoutIdentifiers = stripTs(code)
      .replace(/QF_[A-Z_]*/g, "")          // env var names
      .replace(/qf_[a-z_]*/g, "");         // RPC names (e.g. qf_recover_stale_dispatching_…)
    hasNot(/[A-Za-z0-9_-]{43,}={0,2}["']/, withoutIdentifiers, `${f} embeds no key-shaped literal`);
  }
  has(/no fallback[\s\S]{0,12}key/i, readF(SEAL_SRC), "the seal module documents that it has no default/fallback key");
});

// ============================================================================
// T. TIMESTAMP CANONICALIZATION — the AAD binds an INSTANT, never text
// ============================================================================
check("T1. `Z` and `+00:00` expiry forms produce byte-IDENTICAL AAD and both open", () => {
  const jsForm = "2026-07-13T10:15:00.000Z";
  const pgForm = "2026-07-13T10:15:00+00:00";
  assert(jsForm !== pgForm, "the two strings genuinely differ byte-for-byte");
  assert(Date.parse(jsForm) === Date.parse(pgForm), "…but describe the same instant");

  const aadJs = M.Intent.canonicalAckAad(aadFor({ expiresAt: jsForm }));
  const aadPg = M.Intent.canonicalAckAad(aadFor({ expiresAt: pgForm }));
  assert(aadJs === aadPg, "the canonical AAD is IDENTICAL across representations");

  // Seal the way the ENQUEUE does; open the way the WORKER does (from a Postgres value).
  const sealed = M.Seal.sealAckDestination(E164, aadJs, ENV_OK);
  const opened = M.Seal.openAckDestination(sealed.value, aadPg, ENV_OK);
  assert(opened.ok && opened.value === E164, `a PG-rendered expiry must still open (got ${safeStringify(opened)})`);
});

check("T2. the MICROSECOND Postgres form also opens", () => {
  const jsForm = "2026-07-13T10:15:00.000Z";
  const microForm = "2026-07-13T10:15:00.000000+00:00";
  const sealed = M.Seal.sealAckDestination(E164, M.Intent.canonicalAckAad(aadFor({ expiresAt: jsForm })), ENV_OK);
  const opened = M.Seal.openAckDestination(sealed.value, M.Intent.canonicalAckAad(aadFor({ expiresAt: microForm })), ENV_OK);
  assert(opened.ok && opened.value === E164, `microsecond form must open (got ${safeStringify(opened)})`);
});

check("T3. INSTANT equality is required — a 1-millisecond difference FAILS", () => {
  const sealed = M.Seal.sealAckDestination(E164, M.Intent.canonicalAckAad(aadFor({ expiresAt: "2026-07-13T10:15:00.000Z" })), ENV_OK);
  const off = M.Seal.openAckDestination(sealed.value, M.Intent.canonicalAckAad(aadFor({ expiresAt: "2026-07-13T10:15:00.001Z" })), ENV_OK);
  assert(!off.ok && off.code === "SEAL_AUTH_FAILED", `1ms drift must fail (got ${safeStringify(off)})`);
  // …so raw-string equality is NOT required, but instant equality IS.
  const same = M.Seal.openAckDestination(sealed.value, M.Intent.canonicalAckAad(aadFor({ expiresAt: "2026-07-13T10:15:00+00:00" })), ENV_OK);
  assert(same.ok, "a different STRING for the same INSTANT still opens");
});

check("T4. an INVALID expiry fails closed, and never echoes the supplied value", () => {
  for (const bad of ["not-a-date", "", "2026-13-45T99:99:99Z", null, undefined]) {
    const aad = M.Intent.canonicalAckAad(aadFor({ expiresAt: bad }));
    assert(aad === null, `invalid expiry ${safeStringify(bad)} ⇒ null (fail closed)`);
  }
  // The AAD helper never returns a string containing the offending value.
  assert(M.Intent.canonicalAckAad(aadFor({ expiresAt: "not-a-date" })) === null, "no partial AAD is produced");
});

check("T5. changing any OTHER AAD field still fails, even with a canonical expiry", () => {
  const sealed = M.Seal.sealAckDestination(E164, M.Intent.canonicalAckAad(aadFor()), ENV_OK);
  for (const [name, over] of Object.entries({
    "intent id": { intentId: "deadbeef-1111-4222-8333-444444444444" },
    "receipt id": { consentCommandReceiptId: "deadbeef-1111-4222-8333-444444444444" },
    "inbound id": { inboundMessageId: "deadbeef-1111-4222-8333-444444444444" },
    "provider hash": { canonicalProviderMessageHash: "a".repeat(64) },
    "destination hash": { destinationHash: "b".repeat(64) },
    "ack type": { ackType: "consent_help_response" },
    "schema version": { schemaVersion: 2 },
  })) {
    const opened = M.Seal.openAckDestination(sealed.value, M.Intent.canonicalAckAad(aadFor(over)), ENV_OK);
    assert(!opened.ok, `changed ${name} must still fail`);
  }
});

check("T6. END-TO-END: an intent sealed at enqueue OPENS in the worker after the PG round-trip", async () => {
  // The store renders timestamps exactly as Postgres does — this is the test that would have caught C-1.
  for (const micros of [false, true]) {
    const store = makeStore({ micros });
    await enqueueOne(store);
    const row = [...store.rows.values()][0];
    assert(/\+00:00$/.test(row.expires_at), `the store returns a PG-rendered expiry (got ${row.expires_at})`);
    const w = workerDeps(store);
    const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    assert(out.result.sent === 1, `micros=${micros}: the acknowledgement SENDS (got ${safeStringify(out.result)})`);
    assert(w.sends.intents[0].destination_source.destination === E164, "…to the correct destination");
  }
});

// ============================================================================
// N. MAINTENANCE — expiry sweep + stale-dispatch recovery are actually INVOKED
// ============================================================================
check("N1. the worker batch INVOKES the expiry sweep and the stale-dispatch recovery, before claiming", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const order = [];
  const w = workerDeps(store, {
    expireIntents: async () => { order.push("expire"); return store.expire(); },
    recoverStaleDispatching: async (s) => { order.push(`recover:${s}`); return store.recoverStaleDispatching(s); },
    claim: async (wid, l) => { order.push("claim"); return store.claim(wid, l); },
  });
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(store.calls.expire >= 1, "the expiry sweep RAN");
  assert(store.calls.recover >= 1, "the stale-dispatch recovery RAN");
  assert(order[0] === "expire" && order[1].startsWith("recover:") && order[2] === "claim",
    `maintenance precedes delivery (got ${order.join(",")})`);
  assert(order[1] === "recover:180", `the reviewed 180s threshold is passed EXPLICITLY (got ${order[1]})`);
  assert(out.maintenance && typeof out.maintenance.expired === "number", "sanitized maintenance counts are returned");
});

check("N2. the expiry sweep terminalizes expired rows and PURGES their seals", async () => {
  const store = makeStore();
  const row0 = await enqueueOne(store);
  const afterExpiry = Date.parse(row0.expires_at) + 1000;
  const w = workerDeps(store, { nowMs: afterExpiry });
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  const row = [...store.rows.values()][0];
  assert(row.status === "expired", `swept to terminal expired (got ${row.status})`);
  assert(row.sealed_destination_ciphertext === null && row.encryption_key_id === null, "seals purged by the sweep");
  assert(out.maintenance.expired === 1, `the sweep reports 1 (got ${safeStringify(out.maintenance)})`);
  assert(w.sends.count === 0, "ZERO provider calls from maintenance");
  assertCompletedAtInvariant(store);
});

check("N3. stale DISPATCHING (attempt=1) becomes terminal `uncertain`, purged — never pending/claimed", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const row = [...store.rows.values()][0];
  store.claim("dead", 25);
  store.reserve(row.id, "dead");
  assert(row.status === "dispatching" && row.provider_attempt_count === 1, "it is dispatching with the attempt reserved");

  const later = Date.now() + 200 * 1000;                    // past the 180s recovery threshold
  const w = workerDeps(store, { nowMs: later });
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(row.status === "uncertain", `recovered to terminal uncertain (got ${row.status})`);
  assert(row.sealed_destination_ciphertext === null, "seals purged");
  assert(out.maintenance.recoveredUncertain === 1, "the recovery reports 1");
  assert(w.sends.count === 0, "ZERO provider calls — recovery never re-attempts");
  assertCompletedAtInvariant(store);
});

check("N4. a stale DISPATCHING row with attempt=0 is NOT recovered by that RPC", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const row = [...store.rows.values()][0];
  // Contrived: dispatching but with NO attempt reserved. It is not an ambiguous provider outcome.
  row.status = "dispatching";
  row.provider_attempt_count = 0;
  row.locked_at = new Date(Date.now() - 300 * 1000).toISOString();
  const n = store.recoverStaleDispatching(180, Date.now());
  assert(n === 0, "attempt=0 is NOT recovered as uncertain");
  assert(row.status === "dispatching", "…and is left alone");
});

check("N5. recovery is NOT eligible before the threshold, and the threshold is SAFE", () => {
  const store = makeStore();
  const now = Date.now();
  // A dispatching row locked 100s ago is NOT yet recoverable (threshold is 180s).
  store.rows.set("x", { id: "x", status: "dispatching", provider_attempt_count: 1, locked_at: new Date(now - 100 * 1000).toISOString() });
  assert(store.recoverStaleDispatching(180, now) === 0, "not recovered before the threshold");
  store.rows.get("x").locked_at = new Date(now - 200 * 1000).toISOString();
  assert(store.recoverStaleDispatching(180, now) === 1, "…recovered after it");

  // THE INVARIANT: recovery > provider timeout + safety margin.
  assert(M.Intent.PROVIDER_ATTEMPT_TIMEOUT_MS === 60 * 1000, "provider timeout is 60s");
  assert(M.Intent.RECOVERY_SAFETY_MARGIN_MS === 60 * 1000, "safety margin is 60s");
  assert(M.Intent.STALE_DISPATCH_RECOVERY_MS === 180 * 1000, "recovery threshold is 180s");
  assert(M.Intent.recoveryThresholdIsSafe() === true, "180 > 60 + 60");
  assert(M.Intent.recoveryThresholdIsSafe(120, 60, 60) === false, "120 is NOT > 60 + 60 — rejected");
  assert(M.Intent.recoveryThresholdIsSafe(60, 60, 60) === false, "a threshold at/below the timeout is rejected");
  // The SQL floor refuses an unsafe threshold too.
  let threw = false;
  try { store.recoverStaleDispatching(60, now); } catch { threw = true; }
  assert(threw, "an unsafe threshold is refused (UNSAFE_RECOVERY_THRESHOLD)");
});

check("N6. a MAINTENANCE failure fails the batch CLOSED — nothing claimed, nothing sent, sanitized", async () => {
  for (const over of [
    { expireIntents: async () => { throw new Error("SQLSTATE 08006 +919812345678"); } },
    { recoverStaleDispatching: async () => { throw new Error("SQLSTATE 08006 +919812345678"); } },
  ]) {
    const store = makeStore();
    await enqueueOne(store);
    const w = workerDeps(store, over);
    const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    assert(out.ok === false, "the batch FAILS CLOSED");
    assert(store.calls.claim === 0, "nothing was claimed");
    assert(w.sends.count === 0, "nothing was sent");
    hasNot(/SQLSTATE|08006|\+9198/, safeStringify(out), "no DB error, no phone leaks");
  }
});

// ============================================================================
// O. BOUNDED PROVIDER TIMEOUT
// ============================================================================
check("O1. a HANGING provider send TIMES OUT ⇒ terminal `uncertain`, called once, never retried", async () => {
  const store = makeStore();
  await enqueueOne(store);
  let calls = 0;
  // A send that NEVER resolves. Without the bounded timeout the worker would hang for ever.
  // The timeout is injectable ONLY so this takes 25ms instead of 60s; production is always 60s (O3).
  const w = workerDeps(store, {
    providerTimeoutMs: 25,
    createService: () => ({ ok: true, data: { send: () => new Promise(() => { calls++; }) } }),
  });
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(out.result.uncertain === 1, `a timeout is TERMINAL uncertain (got ${safeStringify(out.result)})`);
  assert(calls === 1, `the provider was invoked exactly once (got ${calls})`);
  const row = [...store.rows.values()][0];
  assert(row.status === "uncertain", "terminal `uncertain`");
  assert(row.provider_attempt_count === 1, "the single attempt was consumed");
  assert(row.sealed_destination_ciphertext === null, "sealed fields purged");

  // …and it is NEVER retried by a later batch.
  const w2 = workerDeps(store);
  const out2 = await M.Worker.processConsentAckIntents({ workerId: "w2" }, w2.deps);
  assert(out2.result.claimed === 0 && w2.sends.count === 0, "a timed-out intent is NEVER retried");
});

check("O3. production uses the reviewed 60s timeout, and no retry mechanism exists anywhere", () => {
  assert(M.Intent.PROVIDER_ATTEMPT_TIMEOUT_MS === 60 * 1000, "the constant is 60s");
  const defaults = M.Worker.defaultConsentAckWorkerDeps;
  assert(typeof defaults === "function", "production deps exist");
  const code = stripTs(readF(WORKER_SRC));
  has(/withTimeout\(service\.data\.send\(intentToSend\), deps\.providerTimeoutMs\)/, code, "the send is bounded");
  has(/providerTimeoutMs: PROVIDER_ATTEMPT_TIMEOUT_MS/, code, "…and production binds the 60s constant");
  hasNot(/setInterval|redispatch|retryQueue|reschedul/i, code, "no retry scheduler / redispatch exists");
  hasNot(/scheduled_at:(?!\s*null)/, code, "the acknowledgement is never scheduled");
});

check("O2. a THROW after reservation ⇒ uncertain; the provider is called exactly ONCE and never again", async () => {
  const store = makeStore();
  await enqueueOne(store);
  let calls = 0;
  const w = workerDeps(store, {
    createService: () => ({ ok: true, data: { async send() { calls++; throw new Error("timeout"); } } }),
  });
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(out.result.uncertain === 1, `uncertain (got ${safeStringify(out.result)})`);
  assert(calls === 1, `the provider was called exactly once (got ${calls})`);
  const row = [...store.rows.values()][0];
  assert(row.status === "uncertain" && row.provider_attempt_count === 1, "terminal, attempt consumed");

  // A SECOND batch must not retry it.
  const w2 = workerDeps(store);
  const out2 = await M.Worker.processConsentAckIntents({ workerId: "w2" }, w2.deps);
  assert(out2.result.claimed === 0 && w2.sends.count === 0, "an uncertain intent is NEVER retried");
});

// ============================================================================
// R. RECEIPT COMMAND BINDING
// ============================================================================
check("R1. a STOP cannot bind to a START receipt, and a START cannot bind to a STOP receipt", async () => {
  // The receipt table wrote a START. A STOP acknowledgement must find NOTHING.
  const store = makeStore();
  const r = await runEnqueue(store, { deps: { resolveReceiptId: receiptTable("start") } });
  assert(r.result.items[0].outcome === "receipt_not_found", `STOP rejects a START receipt (got ${safeStringify(r.result.items)})`);
  assert(store.rows.size === 0, "no intent");

  // …and the converse.
  const store2 = makeStore();
  const r2 = await runEnqueue(store2, {
    msgOver: { text: { body: "START" } },
    commandOver: { command: "start", disposition: "start_applied" },
    deps: { resolveReceiptId: receiptTable("stop") },
  });
  assert(r2.result.items[0].outcome === "receipt_not_found", "START rejects a STOP receipt");
  assert(store2.rows.size === 0, "no intent");
});

check("R2. the receipt lookup pins provider, provider-message identity, channel AND command", () => {
  const code = stripTs(readF(ENQUEUE_SRC));
  has(/\.eq\("provider", provider\)/, code, "provider pinned");
  has(/\.eq\("provider_message_id", providerMessageId\)/, code, "provider-message identity pinned");
  has(/\.eq\("channel", channel\)/, code, "channel pinned");
  has(/\.eq\("normalized_command", normalizedCommand\)/, code, "COMMAND pinned");
  has(/maybeSingle\(\)/, code, "exact lookup — never an arbitrary first row");
  has(/normalizedCommand: ev\.command/, code, "…and the command passed is the one being enqueued");
});

check("R3. HELP performs NO receipt lookup and keeps a NULL receipt", async () => {
  const store = makeStore();
  let lookups = 0;
  await runEnqueue(store, {
    msgOver: { text: { body: "HELP" } },
    commandOver: { command: "help", disposition: "help_acknowledged" },
    deps: { resolveReceiptId: async () => { lookups++; return CMD_RECEIPT_ID; } },
  });
  assert(lookups === 0, "HELP never looks a receipt up");
  assert([...store.rows.values()][0].consent_command_receipt_id === null, "…and keeps a null receipt");
});

// ============================================================================
// Q. completed_at CONSISTENCY (static SQL + model)
// ============================================================================
check("Q1. the migration requires completed_at NOT NULL on terminal and NULL on live rows", () => {
  const sql = stripSql(readF(MIGRATION_SRC));
  has(/constraint ck_ack_intent_completed_at_matches_status check \(/, sql, "the constraint exists");
  has(/status in \('pending', 'claimed', 'dispatching'\) and completed_at is null/, sql, "live ⇒ completed_at NULL");
  has(/status in \('sent', 'suppressed', 'expired', 'failed', 'uncertain'\) and completed_at is not null/, sql, "terminal ⇒ completed_at NOT NULL");
  // Every terminal RPC sets completed_at, so the constraint is satisfiable.
  const terminalSetters = (sql.match(/completed_at\s*=\s*now\(\)/g) ?? []).length;
  assert(terminalSetters >= 3, `terminalize + expiry sweep + recovery all set completed_at (got ${terminalSetters})`);
});

check("Q2. every terminal outcome satisfies the completed_at invariant in the model", async () => {
  for (const over of [{}, { decide: async () => ({ ok: true, disposition: "blocked" }) }, { env: {} }, { sendThrows: true }]) {
    const store = makeStore();
    await enqueueOne(store);
    assertCompletedAtInvariant(store);                       // live ⇒ null
    const w = workerDeps(store, over);
    await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    assertCompletedAtInvariant(store);                       // terminal ⇒ not null
  }
});

check("Q3. the stale-dispatch recovery RPC requires provider_attempt_count = 1 EXPLICITLY", () => {
  const sql = stripSql(readF(MIGRATION_SRC));
  const fn = sql.slice(sql.indexOf("function public.qf_recover_stale_dispatching_consent_ack_intents"));
  has(/where status = 'dispatching'/, fn, "targets dispatching");
  has(/and provider_attempt_count = 1/, fn, "…and requires the attempt to have been RESERVED — explicitly");
  has(/p_stale_after <= interval '120 seconds'/, fn, "the SQL floor is STRICT — 120s itself is refused");
  hasNot(/p_stale_after < interval '120 seconds'/, fn, "…never the off-by-one `<` form");
  has(/UNSAFE_RECOVERY_THRESHOLD/, fn, "…with a closed error");
  has(/default interval '180 seconds'/, fn, "the default is the reviewed 180s");
});

// ============================================================================
// S. THE STRICT RECOVERY-THRESHOLD BOUNDARY  (SQL and model must agree exactly)
// ============================================================================
/** The SQL floor, transcribed from the migration and re-derived from its text on every run. */
function sqlRejectsThreshold(seconds) {
  const sql = stripSql(readF(MIGRATION_SRC));
  const fn = sql.slice(sql.indexOf("function public.qf_recover_stale_dispatching_consent_ack_intents"));
  const lower = fn.match(/p_stale_after\s*(<=?)\s*interval '(\d+) seconds'/);
  const upper = fn.match(/p_stale_after\s*(>=?)\s*interval '1 hour'/);
  assert(lower, "the SQL declares a lower recovery bound");
  assert(upper, "the SQL declares an upper recovery bound");
  const [, lowOp, lowVal] = lower;
  const [, highOp] = upper;
  const low = Number(lowVal);
  const rejectLow = lowOp === "<=" ? seconds <= low : seconds < low;
  const rejectHigh = highOp === ">=" ? seconds >= 3600 : seconds > 3600;
  return seconds === null || rejectLow || rejectHigh;
}

/** The model actually used by every worker/concurrency test in this suite. */
function modelRejectsThreshold(seconds) {
  const store = makeStore();
  try { store.recoverStaleDispatching(seconds, Date.now()); return false; }
  catch { return true; }
}

check("S1. the recovery threshold boundary is STRICT — 120s is REJECTED, 121s accepted", () => {
  // The invariant: recovery > provider timeout (60s) + safety margin (60s)  ⇒  strictly > 120s.
  const expected = {
    119: "reject",   // below the floor
    120: "reject",   // AT the floor — NOT safe: recovery must strictly exceed timeout + margin
    121: "accept",   // the first safe value
    180: "accept",   // the reviewed production threshold
    3600: "accept",  // exactly one hour — the SQL's inclusive upper bound
    3601: "reject",  // above one hour
  };
  for (const [secStr, want] of Object.entries(expected)) {
    const sec = Number(secStr);
    const sql = sqlRejectsThreshold(sec) ? "reject" : "accept";
    const model = modelRejectsThreshold(sec) ? "reject" : "accept";
    assert(sql === want, `SQL must ${want} ${sec}s (got ${sql})`);
    assert(model === want, `the MODEL must ${want} ${sec}s (got ${model})`);
    // A disagreement between the SQL and the model is itself a failure: the model would then be
    // testing a database that does not exist.
    assert(sql === model, `SQL and model DISAGREE at ${sec}s (sql=${sql}, model=${model})`);
  }
});

check("S2. the production caller supplies 180s, and the route cannot override it", () => {
  const worker = stripTs(readF(WORKER_SRC));
  has(/deps\.recoverStaleDispatching\(Math\.floor\(STALE_DISPATCH_RECOVERY_MS \/ 1000\)\)/, worker,
    "the worker passes the reviewed constant explicitly");
  assert(M.Intent.STALE_DISPATCH_RECOVERY_MS / 1000 === 180, "…which is 180 seconds");
  assert(M.Intent.recoveryThresholdIsSafe(120, 60, 60) === false, "120s is reported UNSAFE by the predicate");
  assert(M.Intent.recoveryThresholdIsSafe(121, 60, 60) === true, "121s is the first safe value");
  const route = stripTs(readF(ROUTE_SRC));
  hasNot(/stale|recovery|threshold|180/i, route, "the route cannot select a recovery threshold");
});

// ============================================================================
// P. POSTGRES TIMESTAMP RENDERING (was MUT 26 — an edit-less "mutation"; it is a FUNCTIONAL fact)
// ============================================================================
check("P1. the store renders timestamptz the way Postgres does (the H-3 fidelity that catches C-1)", () => {
  const pg = pgTimestamptz("2026-07-13T10:15:00.000Z");
  const micro = pgTimestamptz("2026-07-13T10:15:00.000Z", { micros: true });
  assert(pg === "2026-07-13T10:15:00+00:00", `+00:00 form (got ${pg})`);
  assert(pg !== "2026-07-13T10:15:00.000Z", "…and it is NOT the JavaScript string echoed back");
  assert(micro === "2026-07-13T10:15:00.000000+00:00", `microsecond form (got ${micro})`);
  assert(Date.parse(pg) === Date.parse("2026-07-13T10:15:00.000Z"), "…same instant, different bytes");
});

// ============================================================================
// L. LATE PROVIDER SETTLEMENT (the request may finish after we stopped waiting)
// ============================================================================
check("L1. a provider promise that REJECTS after the timeout causes no unhandled rejection", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const store = makeStore();
    await enqueueOne(store);
    let calls = 0;
    let rejectLate;
    const w = workerDeps(store, {
      providerTimeoutMs: 25,               // shortened; production is 60s (O3)
      createService: () => ({
        ok: true,
        data: {
          send: () => new Promise((_, reject) => { calls++; rejectLate = reject; }),
        },
      }),
    });
    const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);

    // 1-2) the timeout terminalized it as `uncertain`
    assert(out.result.uncertain === 1, `timeout ⇒ uncertain (got ${safeStringify(out.result)})`);
    const row = [...store.rows.values()][0];
    assert(row.status === "uncertain", "terminal `uncertain`");
    assert(row.provider_attempt_count === 1, "exactly one attempt");
    const terminalizeCallsBefore = store.calls.terminalize;

    // 3) …and NOW the original provider request finally rejects.
    rejectLate(new Error("meta 503: upstream connect error +919812345678"));
    await new Promise((r) => setTimeout(r, 60));   // let the rejection propagate

    // 4) no unhandled rejection
    assert(unhandled.length === 0, `no unhandledRejection (got ${unhandled.length}: ${unhandled.map(String).join("; ")})`);
    // 5) no SECOND terminalization
    assert(store.calls.terminalize === terminalizeCallsBefore, "no second terminalization");
    assert(row.status === "uncertain", "…the row is untouched");
    // 6) no second provider attempt
    assert(calls === 1, `the provider was invoked exactly once (got ${calls})`);
    assert(w.sends.count === 0, "…and no send was ever recorded as successful");
    // 7) no provider error detail escaped
    const rendered = safeStringify(out);
    hasNot(/503|upstream|\+9198/, rendered, "no provider error detail or phone leaks");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

check("L2. a provider promise that RESOLVES after the timeout is discarded, not acted upon", async () => {
  const store = makeStore();
  await enqueueOne(store);
  let resolveLate;
  const w = workerDeps(store, {
    providerTimeoutMs: 25,
    createService: () => ({
      ok: true,
      data: { send: () => new Promise((resolve) => { resolveLate = resolve; }) },
    }),
  });
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  assert(out.result.uncertain === 1, "timeout ⇒ uncertain");
  const before = store.calls.terminalize;

  // The provider actually SUCCEEDED — but far too late. It must not flip the terminal row to `sent`.
  resolveLate({ ok: true, data: { status: "accepted" } });
  await new Promise((r) => setTimeout(r, 60));

  const row = [...store.rows.values()][0];
  assert(row.status === "uncertain", "the terminal row stays `uncertain` — a late success never becomes `sent`");
  assert(store.calls.terminalize === before, "no second terminal transition");
  assert(row.sealed_destination_ciphertext === null, "…and the seal stays purged");
});

// ============================================================================
// MUTATIONS
// ============================================================================
/**
 * A mutation is only load-bearing if a REAL validator goes red. `checkFails()` re-runs an actual functional
 * check by name and requires it to THROW. This is what makes a mutation non-tautological: it is not enough
 * to observe that the source string we just deleted is gone.
 */
async function checkFails(namePrefix) {
  const c = checks.find((x) => x.name.startsWith(namePrefix));
  if (!c) throw new Error(`no such check: ${namePrefix}`);
  try { await c.fn(); return false; } catch { return true; }
}

const mutationChecks = [];
function srcMutation(name, file, from, to, scenario) { mutationChecks.push({ name, kind: "src", edits: [{ file, from, to }], scenario }); }
/** A PAIRED mutation: some guards are defended in depth, so proving one load-bearing needs both removed. */
function srcMutationN(name, edits, scenario) { mutationChecks.push({ name, kind: "src", edits, scenario }); }
function fnMutation(name, scenario) { mutationChecks.push({ name, kind: "fn", edits: [], scenario }); }

async function withMutatedBuild(fn) {
  const dir = resolve(`.phase5fd4c-mut-${Math.random().toString(36).slice(2, 8)}`);
  try {
    compileTo(dir);
    transpileFiles(dir, [ENQUEUE_SRC, WORKER_SRC], [
      "services/consentCommandResponseService.js",
      "services/consentAckWorkerService.js",
    ]);
    return await fn(wireBuild(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- Enqueue ordering + idempotency ------------------------------------------------------------
srcMutation("MUT 1: the webhook ENQUEUES BEFORE the command result is checked",
  WEBHOOK_SRC,
  `const commands = await processInboundConsentCommands(inbound.result.processed);
    if (!commands.ok) return { status: 500, code: "inbound_command_processing_failed" };`,
  `const commands = await processInboundConsentCommands(inbound.result.processed);`,
  // BEHAVIOURAL: rerun the REAL webhook-ordering validator against the MUTATED source. With the guard
  // gone, a FAILED consent command no longer returns before the enqueue — so ordering is violated.
  () => checkFails("D2."));

fnMutation("MUT 2: the UNIQUE idempotency fence is removed ⇒ a replay creates a SECOND intent", async () => {
  const store = makeStore();
  store.insert = function (row) {                    // the unique index is gone
    const stored = { ...row, status: "pending", locked_by: null, locked_at: null, claim_count: 0, provider_attempt_count: 0 };
    this.rows.set(row.id, stored);
    return "inserted";
  }.bind(store);
  await runEnqueue(store);
  await runEnqueue(store);
  return store.rows.size === 2;                      // the fence was load-bearing
});

srcMutation("MUT 3: the REPLAY guard is removed ⇒ a redelivered command is acknowledged again",
  "lib/communication/consentCommandResponse.ts",
  "if (evidence.replayed !== false) return reject(AckRejectReason.REPLAYED_COMMAND);",
  "if (false) return reject(AckRejectReason.REPLAYED_COMMAND);",
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    const r = await mm.Enqueue.enqueueConsentCommandResponses({
      payload: envelope(textMsg()), webhookReceiptId: WEBHOOK_RECEIPT_ID,
      persisted: [persistedItem()], commands: [commandItem({ replayed: true })],
    }, enqueueDeps(store));
    return r.result.enqueued === 1;                  // a REPLAY was enqueued
  }));

// ---- Claim / reservation atomicity ------------------------------------------------------------
fnMutation("MUT 4: the claim is NON-ATOMIC ⇒ two workers both send", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const row = [...store.rows.values()][0];
  const nonAtomic = async (wid) => { row.status = "claimed"; row.locked_by = wid; row.locked_at = new Date().toISOString(); return [{ ...row }]; };
  // …and the reservation stops being compare-and-set.
  const alwaysWins = async () => { row.provider_attempt_count = Math.min(row.provider_attempt_count + 1, 9); row.status = "dispatching"; return true; };
  const w1 = workerDeps(store, { claim: nonAtomic, reserveAttempt: alwaysWins });
  const w2 = workerDeps(store, { claim: nonAtomic, reserveAttempt: alwaysWins });
  await Promise.all([
    M.Worker.processConsentAckIntents({ workerId: "w1" }, w1.deps),
    M.Worker.processConsentAckIntents({ workerId: "w2" }, w2.deps),
  ]);
  return w1.sends.count + w2.sends.count === 2;      // DOUBLE SEND — the atomicity was load-bearing
});

fnMutation("MUT 5: a DISPATCHING intent is reclaimed ⇒ it is sent twice", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const row = [...store.rows.values()][0];
  store.claim("w1", 25);
  store.reserve(row.id, "w1");
  assert(row.status === "dispatching" && row.provider_attempt_count === 1, "it is dispatching");
  // The mutated claim ignores both the status and the attempt count.
  const reclaims = async (wid) => { row.status = "claimed"; row.locked_by = wid; row.provider_attempt_count = 0; return [{ ...row }]; };
  const w = workerDeps(store, { claim: reclaims });
  await M.Worker.processConsentAckIntents({ workerId: "w2" }, w.deps);
  return w.sends.count === 1;                        // a SECOND send of an already-attempted intent
});

fnMutation("MUT 6: provider_attempt_count is allowed above one ⇒ unbounded resend", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const row = [...store.rows.values()][0];
  store.reserve = function (id, wid) { const r = this.rows.get(id); r.status = "dispatching"; r.provider_attempt_count += 1; return true; }.bind(store);
  store.terminalize = function () { return true; }.bind(store);   // isolate the attempt fence from the purge
  let total = 0;
  for (let i = 0; i < 3; i++) {
    row.status = "claimed"; row.locked_by = "w1";
    const w = workerDeps(store, { claim: async () => [{ ...row, status: "claimed", locked_by: "w1", provider_attempt_count: 0 }] });
    await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    total += w.sends.count;
  }
  return total > 1 && row.provider_attempt_count > 1;  // the 0/1 constraint was load-bearing
});

// ---- D2-C ------------------------------------------------------------------------------------
srcMutation("MUT 7: the worker SKIPS the D2-C re-evaluation (a suppression landed after enqueue)",
  WORKER_SRC,
  `      let decision;
      try {
        decision = await deps.decide({`,
  `      let decision = { ok: true, disposition: "no_consent_objection" };
      try {
        if (false) decision = await deps.decide({`,
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    await enqueueOne(store);
    // D2-C says BLOCKED, but the worker no longer asks.
    const w = workerDeps(store, { decide: async () => ({ ok: true, disposition: "blocked" }) });
    const out = await mm.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    return out.result.sent === 1;                    // a SUPPRESSED user was messaged
  }));

srcMutation("MUT 8: a D2-C AUTHORITY FAILURE is mapped to an ALLOW (fail-open)",
  WORKER_SRC,
  `        if (decision.code === "AUTHORITY_LOOKUP_FAILED") return unavailable();
        return invalid();                 // integrity violation / invalid input / anything unexpected`,
  `        return { kind: "allow", scope: "authentication" };`,
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    await enqueueOne(store);
    const w = workerDeps(store, { decide: async () => ({ ok: false, code: "AUTHORITY_LOOKUP_FAILED" }) });
    const out = await mm.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    return out.result.sent === 1;                    // fail-OPEN
  }));

srcMutation("MUT 9: a GLOBAL suppression is converted to an ALLOW",
  WORKER_SRC,
  `      if (decision.disposition === "blocked") return denied();           // global suppression`,
  `      if (decision.disposition === "blocked") return { kind: "allow", scope: "authentication" };`,
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    await enqueueOne(store);
    const w = workerDeps(store, { decide: async () => ({ ok: true, disposition: "blocked" }) });
    const out = await mm.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    return out.result.sent === 1;
  }));

// ---- Crypto ----------------------------------------------------------------------------------
srcMutation("MUT 10: decryption FAILS OPEN (a fallback destination is used)",
  WORKER_SRC,
  `  if (!opened.ok) return "seal_failed";`,
  `  if (!opened.ok) { /* fail-open */ }`,
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    await enqueueOne(store);
    const row = [...store.rows.values()][0];
    row.sealed_destination_ciphertext = randomBytes(24).toString("base64url");
    const w = workerDeps(store);
    let threw = false;
    try {
      const out = await mm.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
      // Either it sent something (catastrophic) or it no longer reports the closed seal_failed outcome.
      return out.result.items[0]?.outcome !== "seal_failed";
    } catch { threw = true; }
    return threw;                                    // it no longer fails closed cleanly
  }));

srcMutation("MUT 11: an AEAD authentication failure is IGNORED (the open FAILS OPEN)",
  SEAL_SRC,
  `  } catch {
    // Wrong key, tampered ciphertext, or a DIFFERENT AAD. Indistinguishable by design — and all fatal.
    return fail("SEAL_AUTH_FAILED");
  }`,
  `  } catch {
    return { ok: true, value: "+919800000001" };
  }`,
  () => withMutatedBuild(async (mm) => {
    const aad = mm.Intent.canonicalAckAad(aadFor());
    const sealed = mm.Seal.sealAckDestination(E164, aad, ENV_OK);
    const tampered = { ...sealed.value, ciphertext: randomBytes(16).toString("base64url") };
    const opened = mm.Seal.openAckDestination(tampered, aad, ENV_OK);
    return opened.ok === true;                       // a TAMPERED ciphertext "opened" — fail-OPEN
  }));

srcMutationN("MUT 12: the AAD is DROPPED on both sides -> a ciphertext becomes TRANSPLANTABLE",
  [
    { file: SEAL_SRC, from: '    cipher.setAAD(Buffer.from(aad, "utf8"));', to: "    /* aad dropped */" },
    { file: SEAL_SRC, from: '    decipher.setAAD(Buffer.from(aad, "utf8"));', to: "    /* aad dropped */" },
  ],
  () => withMutatedBuild(async (mm) => {
    const sealAad = mm.Intent.canonicalAckAad(aadFor());
    const sealed = mm.Seal.sealAckDestination(E164, sealAad, ENV_OK);
    // A ciphertext sealed for THIS intent now opens under a DIFFERENT intent's AAD.
    const otherAad = mm.Intent.canonicalAckAad(aadFor({ intentId: "deadbeef-1111-4222-8333-444444444444" }));
    const opened = mm.Seal.openAckDestination(sealed.value, otherAad, ENV_OK);
    return opened.ok === true && opened.value === E164;
  }));

srcMutationN("MUT 13: BOTH destination-hash fences removed -> the WRONG number is messaged",
  [
    // The worker's own re-hash check...
    { file: WORKER_SRC, from: '  if (!hashesEqual(observedHash, intent.destination_hash)) return "destination_mismatch";', to: "  /* mismatch ignored */" },
    // ...AND the one-shot enforcer's binding. Defence in depth: BOTH must go for the send to land.
    { file: WORKER_SRC, from: "      if (input.destinationHash !== intent.destination_hash) return invalid();", to: "      /* binding ignored */" },
  ],
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    await enqueueOne(store);
    const row = [...store.rows.values()][0];
    const aad = mm.Intent.canonicalAckAad({
      schemaVersion: 1, intentId: row.id, consentCommandReceiptId: row.consent_command_receipt_id,
      inboundMessageId: row.inbound_message_id, canonicalProviderMessageHash: row.canonical_provider_message_hash,
      destinationHash: row.destination_hash, ackType: row.ack_type, expiresAt: row.expires_at,
    });
    const resealed = mm.Seal.sealAckDestination(OTHER_E164, aad, ENV_OK);
    row.sealed_destination_ciphertext = resealed.value.ciphertext;
    row.sealed_destination_nonce = resealed.value.nonce;
    row.sealed_destination_auth_tag = resealed.value.authTag;
    const w = workerDeps(store);
    await mm.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    return w.sends.count === 1 && w.sends.intents[0].destination_source.destination === OTHER_E164;
  }));

fnMutation("MUT 13b: the ENFORCER ALONE still blocks a wrong destination (defence in depth)", async () => {
  const store = makeStore();
  await enqueueOne(store);
  const row = [...store.rows.values()][0];
  const aad = M.Intent.canonicalAckAad({
    schemaVersion: 1, intentId: row.id, consentCommandReceiptId: row.consent_command_receipt_id,
    inboundMessageId: row.inbound_message_id, canonicalProviderMessageHash: row.canonical_provider_message_hash,
    destinationHash: row.destination_hash, ackType: row.ack_type, expiresAt: row.expires_at,
  });
  const resealed = M.Seal.sealAckDestination(OTHER_E164, aad, ENV_OK);
  row.sealed_destination_ciphertext = resealed.value.ciphertext;
  row.sealed_destination_nonce = resealed.value.nonce;
  row.sealed_destination_auth_tag = resealed.value.authTag;
  const w = workerDeps(store);
  const out = await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  return out.result.items[0].outcome === "destination_mismatch" && w.sends.count === 0;
});

// ---- Terminal purge --------------------------------------------------------------------------
fnMutation("MUT 14: terminalization RETAINS the ciphertext ⇒ a terminal row stays addressable", async () => {
  const store = makeStore();
  await enqueueOne(store);
  store.terminalize = function (id, status) {        // the purge is gone
    const row = this.rows.get(id);
    row.status = status;
    return true;
  }.bind(store);
  const w = workerDeps(store);
  await M.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
  const row = [...store.rows.values()][0];
  return row.status === "sent" && row.sealed_destination_ciphertext !== null;   // recoverable destination
});

// ---- Expiry ----------------------------------------------------------------------------------
srcMutation("MUT 15: the EXPIRY check is removed ⇒ a stale acknowledgement is sent",
  WORKER_SRC,
  `  if (Date.parse(intent.expires_at) <= deps.now().getTime()) return "expired";`,
  `  /* expiry ignored */`,
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    const row0 = await enqueueOne(store);
    const w = workerDeps(store, {
      // Isolate deliverOne's OWN expiry guard: the sweep (N2) and the SQL reservation fence (G7) are
      // proved separately, so both are relaxed here. With the worker's guard gone, nothing stops a stale send.
      expireIntents: async () => 0,
      claim: async (wid) => store.claim(wid, 25, Date.parse(RECEIVED) + 1000),
      reserveAttempt: async () => true,
      nowMs: Date.parse(row0.expires_at) + 60 * 60 * 1000,       // an hour late
    });
    const out = await mm.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    return out.result.sent === 1;                    // an EXPIRED acknowledgement was sent
  }));

// ---- Uncertain -------------------------------------------------------------------------------
// ---- Webhook boundary ------------------------------------------------------------------------
srcMutation("MUT 17: the worker is invoked INLINE from the webhook (the latency blocker returns)",
  WEBHOOK_SRC,
  "      await enqueueConsentCommandResponses({",
  '      await (await import("./consentAckWorkerService")).processConsentAckIntents({});\n      await enqueueConsentCommandResponses({',
  () => checkFails("D1."));          // the REAL webhook-separation check must go red

srcMutation("MUT 18: an ack type is ADDED to the ORDINARY D3-B registry (a reusable bypass)",
  REGISTRY_SRC,
  "const REGISTRY: Readonly<Record<string, RegistryEntry>> = Object.freeze({",
  'const REGISTRY: Readonly<Record<string, RegistryEntry>> = Object.freeze({\n  consent_stop_acknowledgement: { scope: "transactional", lane: "business" },',
  () => withMutatedBuild(async (mm) => {
    const r = mm.Registry.resolveOutboundConsentScope({
      messageType: "consent_stop_acknowledgement", lane: "business", channel: "whatsapp",
    });
    return r.ok === true || mm.Registry.REGISTERED_MESSAGE_TYPES.includes("consent_stop_acknowledgement");
  }));

srcMutation("MUT 19: the cron-secret comparison stops being TIMING-SAFE",
  ROUTE_SRC,
  "  return timingSafeEqual(a, b);",
  "  return provided === expected;",
  () => checkFails("F1."));

srcMutation("MUT 20: the route accepts a CALLER-SELECTED destination",
  ROUTE_SRC,
  "    const raw = (body as { limit?: unknown } | null)?.limit;",
  "    const destination = (body as { destination?: string } | null)?.destination;\n    const raw = (body as { limit?: unknown } | null)?.limit;",
  () => checkFails("F3."));

srcMutation("MUT 21: an UNSET cron secret allows everyone",
  ROUTE_SRC,
  '  if (expected === "") return { ok: false, message: "worker secret not configured" };',
  '  if (expected === "") return { ok: true };',
  () => checkFails("F1."));

srcMutation("MUT 22: the acknowledgement is routed through n8n",
  WORKER_SRC,
  "  const service = deps.createService(createOneShotAckEnforcer(intent, deps));",
  '  await fetch("https://n8n.example/webhook/ack", { method: "POST" });\n  const service = deps.createService(createOneShotAckEnforcer(intent, deps));',
  () => checkFails("E3."));

srcMutation("MUT 23: the ONE-SHOT restriction is removed (one intent authorizes a stream)",
  WORKER_SRC,
  "      if (used) return invalid();\n      used = true;",
  "      used = true;",
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    await enqueueOne(store);
    let allows = 0;
    const w = workerDeps(store, {
      createService: (enforcer) => ({
        ok: true,
        data: {
          async send(intent) {
            const mk = () => ({
              channel: intent.channel, messageType: intent.type, templateKey: intent.template_key,
              lane: intent.lane, destinationHash: DEST_HASH, destinationSource: "ephemeral_auth_destination",
              recipientType: intent.recipient_type, recipientId: intent.recipient_id,
            });
            for (let i = 0; i < 5; i++) {
              const o = await enforcer.authorize(mk());
              if (o.kind === "allow") allows++;
            }
            return { ok: true, data: { status: "accepted" } };
          },
        },
      }),
    });
    await mm.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    return allows > 1;
  }));

srcMutation("MUT 24: the PLAINTEXT phone is added to the persisted intent row",
  ENQUEUE_SRC,
  "    received_at: ev.receivedAt,",
  "    received_at: ev.receivedAt,\n    destination_plaintext: plaintextDestination,",
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    await mm.Enqueue.enqueueConsentCommandResponses({
      payload: envelope(textMsg()), webhookReceiptId: WEBHOOK_RECEIPT_ID,
      persisted: [persistedItem()], commands: [commandItem()],
    }, enqueueDeps(store));
    return safeStringify([...store.rows.values()][0]).includes(E164);
  }));

// ============================================================================
// C-1 / H-1 / M-1 / M-2 / M-3 / L-2 REGRESSION MUTATIONS
// ============================================================================
srcMutation("MUT 25: the AAD binds the RAW expiry STRING again (the C-1 blocker returns)",
  INTENT_SRC,
  `    String(expiresAtMs),                            // CANONICAL INSTANT — not the caller's text`,
  "    fields.expiresAt,",
  () => withMutatedBuild(async (mm) => {
    // With raw-text binding, a POSTGRES-rendered expiry no longer opens — every acknowledgement dies.
    const jsForm = "2026-07-13T10:15:00.000Z";
    const pgForm = "2026-07-13T10:15:00+00:00";
    const sealed = mm.Seal.sealAckDestination(E164, mm.Intent.canonicalAckAad(aadFor({ expiresAt: jsForm })), ENV_OK);
    const opened = mm.Seal.openAckDestination(sealed.value, mm.Intent.canonicalAckAad(aadFor({ expiresAt: pgForm })), ENV_OK);
    return opened.ok === false;                      // the cross-representation open FAILS
  }));

srcMutation("MUT 27: the EXPIRY SWEEP is removed from the worker batch",
  WORKER_SRC,
  "    const expired = await deps.expireIntents();",
  "    const expired = 0;",
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    const row0 = await enqueueOne(store);
    let swept = 0;
    const w = workerDeps(store, {
      expireIntents: async () => { swept++; return store.expire(); },
      nowMs: Date.parse(row0.expires_at) + 1000,        // the row IS expired
    });
    await mm.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    // The sweep never ran, so the expired row keeps its SEALED DESTINATION for ever.
    const row = [...store.rows.values()][0];
    return swept === 0 && row.status !== "expired" && row.sealed_destination_ciphertext !== null;
  }));

srcMutation("MUT 28: the STALE-DISPATCH RECOVERY is removed from the worker batch",
  WORKER_SRC,
  "    const recoveredUncertain = await deps.recoverStaleDispatching(Math.floor(STALE_DISPATCH_RECOVERY_MS / 1000));",
  "    const recoveredUncertain = 0;",
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    await enqueueOne(store);
    const row = [...store.rows.values()][0];
    store.claim("dead", 25);
    store.reserve(row.id, "dead");                     // crashed AFTER reserving → stuck dispatching
    let recovered = 0;
    const w = workerDeps(store, {
      recoverStaleDispatching: async (secs) => { recovered++; return store.recoverStaleDispatching(secs); },
      nowMs: Date.now() + 200 * 1000,
    });
    await mm.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    // Recovery never ran, so the stuck row keeps its SEALED DESTINATION for ever.
    return recovered === 0 && row.status === "dispatching" && row.sealed_destination_ciphertext !== null;
  }));

srcMutation("MUT 29: a MAINTENANCE failure no longer fails the batch closed",
  WORKER_SRC,
  "    return { ok: false, result: emptyBatch(), maintenance: { expired: 0, recoveredUncertain: 0 } };",
  "    maintenance = { expired: 0, recoveredUncertain: 0 };",
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    await enqueueOne(store);
    const w = workerDeps(store, { expireIntents: async () => { throw new Error("db down"); } });
    const out = await mm.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    // The sweep FAILED, yet the batch carried on and delivered anyway.
    return out.ok === true && w.sends.count === 1;
  }));

srcMutation("MUT 30: the recovery RPC drops its explicit provider_attempt_count = 1 fence",
  MIGRATION_SRC,
  "       and provider_attempt_count = 1\n",
  "",
  () => checkFails("Q3."));

srcMutation("MUT 31: the PROVIDER TIMEOUT is removed (a hanging send blocks for ever)",
  WORKER_SRC,
  "    result = await withTimeout(service.data.send(intentToSend), deps.providerTimeoutMs);",
  "    result = await service.data.send(intentToSend);",
  () => checkFails("O3."));

srcMutation("MUT 32: the RECOVERY THRESHOLD is lowered to the provider timeout (unsafe)",
  INTENT_SRC,
  "export const STALE_DISPATCH_RECOVERY_MS = 180 * 1000;         // 180 seconds",
  "export const STALE_DISPATCH_RECOVERY_MS = 60 * 1000;",
  () => withMutatedBuild(async (mm) => {
    // The module asserts the invariant at LOAD time, so an unsafe constant cannot even be imported.
    // If it somehow loaded, the safety predicate must at least report it unsafe.
    return mm.Intent.recoveryThresholdIsSafe() === false;
  }));

srcMutation("MUT 33: the SQL recovery floor is REMOVED entirely (any threshold can be passed)",
  MIGRATION_SRC,
  "     or p_stale_after <= interval '120 seconds'\n",
  "",
  // BEHAVIOURAL against the real SQL text: with no floor at all, even 60s — the provider timeout itself —
  // would be accepted, so recovery could terminalize an attempt still in flight.
  async () => {
    if (sqlRejectsThreshold(60) !== false) return false;   // the mutation did not actually remove the floor
    return await checkFails("S1.");                        // …and the real boundary validator must fail
  });

srcMutation("MUT 34: an UNCERTAIN outcome is AUTOMATICALLY RETRIED",
  WORKER_SRC,
  '    return "uncertain";\n  }\n\n  if (!result.ok) {',
  '    try { result = await service.data.send(intentToSend); } catch { return "send_failed"; }\n  }\n\n  if (!result.ok) {',
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    await enqueueOne(store);
    let calls = 0;
    const w = workerDeps(store, {
      createService: () => ({ ok: true, data: { async send() { calls++; throw new Error("timeout"); } } }),
    });
    await mm.Worker.processConsentAckIntents({ workerId: "w1" }, w.deps);
    return calls > 1;                                // the provider was called AGAIN after an ambiguity
  }));

srcMutation("MUT 35: the receipt lookup stops pinning normalized_command",
  ENQUEUE_SRC,
  '        .eq("normalized_command", normalizedCommand)\n',
  "",
  () => checkFails("R2."));

fnMutation("MUT 36: a receipt lookup that IGNORES the command lets a STOP bind a START receipt", async () => {
  const store = makeStore();
  const r = await runEnqueue(store, { deps: { resolveReceiptId: async () => CMD_RECEIPT_ID } });
  return r.result.enqueued === 1 && store.rows.size === 1;
});

srcMutation("MUT 37: the completed_at / status constraint is removed from the migration",
  MIGRATION_SRC,
  "  constraint ck_ack_intent_completed_at_matches_status check (",
  "  constraint ck_ack_intent_completed_at_matches_status_DISABLED check (true or ",
  () => checkFails("Q1."));

srcMutation("MUT 38: the SQL recovery floor reverts to `<` (120s becomes ACCEPTED — the M-2 blocker)",
  MIGRATION_SRC,
  "     or p_stale_after <= interval '120 seconds'",
  "     or p_stale_after < interval '120 seconds'",
  // BEHAVIOURAL against the real SQL text: the boundary validator must go red BECAUSE 120s is now accepted.
  async () => {
    const sqlNow = sqlRejectsThreshold(120) ? "reject" : "accept";
    if (sqlNow !== "accept") return false;          // the mutation did not actually loosen the floor
    return await checkFails("S1.");                  // …and the real boundary check must fail
  });

srcMutation("MUT 39: the HARNESS MODEL reverts to `>= 120` (it stops matching the SQL)",
  HARNESS_SRC,
  "      if (!(staleAfterSeconds > 120 && staleAfterSeconds <= 3600)) throw new Error(\"UNSAFE_RECOVERY_THRESHOLD\");",
  "      if (!(staleAfterSeconds >= 120 && staleAfterSeconds <= 3600)) throw new Error(\"UNSAFE_RECOVERY_THRESHOLD\");",
  // NOT a string assertion. We EXTRACT the mutated predicate and EVALUATE its real semantics at 120s, then
  // compare that against the REAL SQL floor read from the migration. The model would accept a threshold the
  // database refuses — precisely the silent SQL/model divergence that let the M-2 off-by-one hide. S1's
  // cross-check is the guard that catches it.
  () => {
    const m = readF(HARNESS_SRC).match(/if \(!\(staleAfterSeconds (>=?) 120 && staleAfterSeconds <= 3600\)\)/);
    if (!m) return false;                                              // the mutation did not apply
    const op = m[1];
    const modelRejects120 = op === ">" ? !(120 > 120) : !(120 >= 120); // evaluate the ACTUAL predicate
    const sqlRejects120 = sqlRejectsThreshold(120);
    return sqlRejects120 === true && modelRejects120 === false;        // SQL refuses it; the model allows it
  });

// ============================================================================
// RUNNER
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-D4-C consent-ack async checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}

async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5F-D4-C mutation tests...\n");
  for (const mut of mutationChecks) {
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
      try { violation = await mut.scenario(); }
      catch { violation = true; /* the mutation broke the build/behaviour → load-bearing */ }
      if (violation) { console.log(`PASS ${mut.name}`); passed++; }
      else { console.log(`FAIL ${mut.name} (guard did not prove load-bearing)`); failed++; }
    } catch (e) { console.log(`FAIL ${mut.name}`); console.error(e); failed++; }
    finally { for (const [p, original] of originals) writeFileSync(p, original); }
  }
  return { passed, failed };
}

const functional = await runFunctional();
const mutations = await runMutations();
rmSync(MAIN_DIR, { recursive: true, force: true });

const total = functional.passed + mutations.passed;
const totalFailed = functional.failed + mutations.failed;
console.log(`\nSummary: ${total} passed, ${totalFailed} failed (functional: ${functional.passed}/${checks.length}, mutation: ${mutations.passed}/${mutationChecks.length}).`);
process.exit(totalFailed === 0 ? 0 : 1);
