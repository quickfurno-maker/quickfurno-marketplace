import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5F-D2-D — controlled transactional communication-consent WRITER.
 *
 * The writer service is transpiled with a STUBBED Supabase (adminClient throws) and driven through an
 * INJECTED RPC dependency + injected clock. The RPC's transaction, fixed-order locking, receipt-based
 * replay/conflict, effective-activity expiry and evidence↔projection atomicity live in the SECURITY
 * DEFINER SQL; the harness exercises the writer end-to-end against a FAITHFUL in-memory reference
 * implementation of that SQL (`simApplyRawJson`) and independently asserts the SQL's invariants
 * statically on the real migration source. Mutations edit the real writer (recompiled) or the real SQL.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const TS_FILES = ["lib/communication/consentPolicy.ts", "lib/communication/consentCommand.ts"];
const WRITER_SRC = "services/communicationConsentWriterService.ts";
const COMMAND_SRC = "lib/communication/consentCommand.ts";
const POLICY_SRC = "lib/communication/consentPolicy.ts";
const MIGRATION_SRC = "supabase/migrations/20260712000300_communication_consent_command_writer_rpc.sql";
const DOC_SRC = "docs/QF-Consent-Command-Writer-Phase-5F-D2-D.md";
const D2C_SVC_SRC = "services/communicationConsentDecisionService.ts";
const WEBHOOK_SVC_SRC = "services/metaWhatsAppWebhookService.ts";

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

function transpileService(outDir) {
  const tsconfigPath = resolve(`${outDir}.svc.tsconfig.json`);
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: false, isolatedModules: true,
      outDir, rootDir: ".", types: [], noResolve: true,
    },
    files: [WRITER_SRC],
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  catch { /* expected noResolve diagnostics */ }
  finally { rmSync(tsconfigPath, { force: true }); }
  if (!existsSync(resolve(outDir, "services/communicationConsentWriterService.js"))) throw new Error("writer did not transpile");
}

function wireBuild(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const original = Module._load;
  const STUBS = {
    "../lib/supabase": { adminClient: () => { throw new Error("real Supabase must never run in the D2-D harness"); } },
  };
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return original.apply(this, [request, parent, isMain]);
  };
  return {
    Service: req("./services/communicationConsentWriterService.js"),
    Command: req("./lib/communication/consentCommand.js"),
  };
}

const readF = (f) => readFileSync(f, "utf8");
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const writerCode = () => stripTs(readF(WRITER_SRC));
const sqlCode = () => stripSql(readF(MIGRATION_SRC));
function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }
function gitDirty() {
  return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })
    .split("\n").map((l) => l.slice(3).trim()).filter(Boolean).map((p) => p.replace(/\\/g, "/"))
    .filter((p) => !p.startsWith(".phase5fd2d"));
}

// ----------------------------------------------------------------------------
// D2-D PHASE BOUNDARY — TWO-MODE (pre-commit worktree | post-commit historical delta)
// ----------------------------------------------------------------------------
const D2D_BASE = "c05b123b5ffb9a25e2dee125ae2f77b9cbad6ada"; // Phase 5F-D2-C — the D2-D base/parent
const D2D_EXPECTED_FILES = [
  "docs/QF-Consent-Command-Writer-Phase-5F-D2-D.md",
  "lib/communication/consentCommand.ts",
  "package.json",
  "scripts/phase5f-d2d-consent-command-writer-harness.mjs",
  "services/communicationConsentWriterService.ts",
  "supabase/migrations/20260712000300_communication_consent_command_writer_rpc.sql",
];

/**
 * Validate a CUMULATIVE D2-D file set (base..HEAD, plus any uncommitted worktree files). `baseIsAncestor`
 * proves the delta is measured from the real D2-D base — a rebase/force-push that detaches the base makes
 * the whole scope claim meaningless, so it is a scope violation, not a warning.
 */
function validateD2DScope(files, baseIsAncestor) {
  const problems = [];
  if (!baseIsAncestor) problems.push(`the D2-D base ${D2D_BASE} is not an ancestor of HEAD — the cumulative delta is not measurable`);
  const set = new Set(files);
  if (files.length !== D2D_EXPECTED_FILES.length) problems.push(`expected ${D2D_EXPECTED_FILES.length} files, got ${files.length} [${files.join(", ")}]`);
  for (const f of D2D_EXPECTED_FILES) if (!set.has(f)) problems.push(`missing approved D2-D file: ${f}`);
  for (const f of files) if (!D2D_EXPECTED_FILES.includes(f)) problems.push(`unexpected file in the cumulative D2-D delta: ${f}`);
  for (const f of files) {
    if (/(^|\/)\.env(\.|$)/.test(f)) problems.push(`D2-D must change no env file: ${f}`);
    if (/(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(f)) problems.push(`D2-D must change no lockfile: ${f}`);
    if (/(^|\/)(app|pages)\/api\//.test(f)) problems.push(`D2-D must introduce no API route: ${f}`);
    if (/webhook/i.test(f)) problems.push(`D2-D must modify no webhook file: ${f}`);
    if (/^services\//.test(f) && f !== WRITER_SRC) problems.push(`D2-D must introduce/modify no unrelated service: ${f}`);
    if (f === D2C_SVC_SRC || /communicationConsentDecisionService/.test(f)) problems.push(`D2-D must not modify the D2-C service: ${f}`);
  }
  const migrations = files.filter((f) => f.startsWith("supabase/migrations/"));
  if (migrations.length !== 1 || migrations[0] !== MIGRATION_SRC) problems.push(`D2-D must ADD exactly its own migration: [${migrations.join(", ")}]`);
  return problems;
}

function headSha() { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
const gitFiles = (args) => execFileSync("git", args, { encoding: "utf8" })
  .split("\n").map((s) => s.trim()).filter(Boolean).map((p) => p.replace(/\\/g, "/"));

/**
 * The REAL cumulative D2-D delta: every file changed by base..HEAD (ALL correction commits, not just the
 * first one — a seventh file smuggled into a later correction commit MUST be caught), unioned with the
 * uncommitted worktree so an in-flight correction cannot escape the approved six either.
 */
function d2dCumulativeDelta() {
  let baseIsAncestor = true;
  try { execFileSync("git", ["merge-base", "--is-ancestor", D2D_BASE, "HEAD"], { stdio: "pipe" }); }
  catch { baseIsAncestor = false; }
  const commits = baseIsAncestor ? gitFiles(["rev-list", `${D2D_BASE}..HEAD`]) : [];
  const messages = commits.map((c) => execFileSync("git", ["log", "-1", "--format=%s", c], { encoding: "utf8" }).trim());
  const cumulative = baseIsAncestor ? gitFiles(["diff", "--name-only", `${D2D_BASE}..HEAD`]) : [];
  // Per-commit deltas — used to PROVE the cumulative list is not merely the first commit's file list.
  const perCommit = commits.map((c) => gitFiles(["diff-tree", "--no-commit-id", "--name-only", "-r", c]));
  const union = [...new Set([...cumulative, ...gitDirty()])];
  return { baseIsAncestor, commits, messages, cumulative, perCommit, union };
}

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function has(re, s, msg) { assert(re.test(s), msg); }
function hasNot(re, s, msg) { assert(!re.test(s), msg); }

const MAIN_DIR = resolve(".phase5fd2d-build-main");
compileTo(MAIN_DIR);
transpileService(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// IN-MEMORY REFERENCE RPC (faithful mirror of apply_communication_consent_command)
// ============================================================================
let uuidCounter = 0;
function simUuid() { uuidCounter++; return `11111111-1111-4111-8111-${uuidCounter.toString(16).padStart(12, "0")}`; }
const SIM_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const SIM_IDENT = /^[A-Za-z0-9._:-]{1,200}$/;
const SIM_PROVIDERS = ["meta_whatsapp", "exotel_sms", "system"];
const SIM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIM_OUTCOMES = ["suppression_created", "user_stop_already_active", "stronger_suppression_preserved",
  "user_stop_reversed", "no_reversible_user_stop"];
const SIM_SCOPE_ORDER = ["marketing", "transactional"];
const ms = (iso) => new Date(iso).getTime();

/**
 * Mirrors public.communication_consent_receipt_scope_result_valid(jsonb, text) EXACTLY. Positional:
 * `scope` is the scope REQUIRED at that index. An absent id key is invalid (as in SQL, where `->` on a
 * missing key yields NULL and the typeof test coalesces to false).
 */
function simScopeResultValid(item, scope) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  if (item.scope !== scope) return false;
  if (!SIM_OUTCOMES.includes(item.outcome)) return false;
  if (!("event_id" in item) || !("suppression_id" in item)) return false;
  const ev = item.event_id, su = item.suppression_id;
  const evNull = ev === null, suNull = su === null;
  if (!evNull && (typeof ev !== "string" || !SIM_UUID.test(ev))) return false;
  if (!suNull && (typeof su !== "string" || !SIM_UUID.test(su))) return false;
  switch (item.outcome) {
    case "suppression_created":
    case "user_stop_reversed": return !evNull && !suNull;
    case "user_stop_already_active":
    case "stronger_suppression_preserved": return evNull && !suNull;
    case "no_reversible_user_stop": return evNull && suNull;
    default: return false;
  }
}
/** Mirrors public.communication_consent_receipt_results_valid(jsonb) EXACTLY. */
function simReceiptResultsValid(sr) {
  return Array.isArray(sr) && sr.length === 2
    && simScopeResultValid(sr[0], SIM_SCOPE_ORDER[0])
    && simScopeResultValid(sr[1], SIM_SCOPE_ORDER[1]);
}

function newStore() { return { events: [], suppressions: [], receipts: [], failOn: null }; }

/** Map the writer's camelCase ConsentCommandRpcArgs → the RPC's p_* params (mirrors the prod adapter). */
function toP(a) {
  return {
    p_policy_version: a.policyVersion, p_channel: a.channel, p_command: a.command,
    p_destination_hash: a.destinationHash, p_principal_type: a.principalType, p_principal_id: a.principalId,
    p_provider: a.provider, p_provider_message_id: a.providerMessageId, p_source_event_type: a.sourceEventType,
    p_source_event_id: a.sourceEventId, p_inbound_message_id: a.inboundMessageId,
    p_occurred_at: a.occurredAt, p_received_at: a.receivedAt,
    p_correlation_id: a.correlationId, p_causation_id: a.causationId,
  };
}

/** Reference implementation returning the RPC's snake_case jsonb (or throwing to model a rollback). */
function simApplyRawJson(store, a) {
  if (a.p_policy_version !== "qf-consent-v1") return { ok: false, code: "UNSUPPORTED_POLICY_VERSION" };
  if (!a.p_channel || !["whatsapp", "sms", "rcs"].includes(a.p_channel)
      || !["stop", "start"].includes(a.p_command)
      || !/^[0-9a-f]{64}$/.test(a.p_destination_hash || "")
      || !SIM_PROVIDERS.includes(a.p_provider)
      || !SIM_IDENT.test(a.p_provider_message_id || "")
      || !SIM_IDENT.test(a.p_source_event_id || "")
      || !SIM_TS.test(a.p_occurred_at || "") || !SIM_TS.test(a.p_received_at || "")
      || (a.p_correlation_id != null && !SIM_IDENT.test(a.p_correlation_id))
      || (a.p_causation_id != null && !SIM_IDENT.test(a.p_causation_id))) {
    return { ok: false, code: "INVALID_WRITER_INPUT" };
  }
  const evaluatedAt = a.p_received_at;
  const scopes = ["marketing", "transactional"];
  // 4. receipt-based replay / conflict / integrity. The FULL binding is destination + command +
  // POLICY VERSION + structurally valid scope_results; integrity is checked FIRST (a malformed receipt
  // is never a comparable outcome), and the SQL — not the TypeScript normalizer — is the authority.
  const receipt = store.receipts.find((r) => r.provider === a.p_provider && r.provider_message_id === a.p_provider_message_id && r.channel === a.p_channel);
  if (receipt) {
    if (receipt.normalized_command == null || receipt.destination_hash == null || receipt.policy_version == null
        || !simReceiptResultsValid(receipt.scope_results))
      return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };
    if (receipt.normalized_command !== a.p_command || receipt.destination_hash !== a.p_destination_hash
        || receipt.policy_version !== a.p_policy_version)
      return { ok: false, code: "WRITER_CONFLICT" };
    return { ok: true, replayed: true, scope_results: JSON.parse(JSON.stringify(receipt.scope_results)) };
  }
  // 5-9. fresh — build effects into buffers; commit atomically
  const newEvents = []; const newSupps = []; const updates = []; const scope_results = [];
  const decisions = [];
  for (const scope of scopes) {
    let active = store.suppressions.find((s) => s.destination_hash === a.p_destination_hash && s.channel === a.p_channel && s.scope === scope && s.is_active === true);
    if (active && active.expires_at != null && ms(active.expires_at) <= ms(evaluatedAt)) {
      // expired physical row → immutable system-action expiry event + deactivate → no effective suppression
      const eid = simUuid();
      newEvents.push({ id: eid, provider: null, provider_message_id: null, channel: a.p_channel, evidence_type: "system_action",
        target_type: "suppression", scope, action: "unsuppress", reason: "system", metadata_sanitized: { sys: "suppression_expiry" } });
      updates.push({ id: active.id, deactivated_at: evaluatedAt, eid });
      active = null;
    }
    let outcome;
    if (a.p_command === "stop") outcome = !active ? "suppression_created" : active.reason === "user_stop" ? "user_stop_already_active" : "stronger_suppression_preserved";
    else outcome = !active ? "no_reversible_user_stop" : active.reason === "user_stop" ? "user_stop_reversed" : "stronger_suppression_preserved";
    decisions.push({ scope, outcome, active });
  }
  const meta = { nc: a.p_command };
  if (a.p_correlation_id != null) meta.corr = a.p_correlation_id;
  if (a.p_causation_id != null) meta.caus = a.p_causation_id;
  meta.rcv = a.p_received_at;
  for (const d of decisions) {
    if (d.outcome === "suppression_created") {
      if (store.failOn === "evidence") throw new Error("inject evidence failure");
      const eid = simUuid(); const sid = simUuid();
      if (store.failOn === "projection") throw new Error("inject projection failure");
      newEvents.push({ id: eid, provider: a.p_provider, provider_message_id: a.p_provider_message_id, channel: a.p_channel,
        evidence_type: "inbound_command", target_type: "suppression", scope: d.scope, action: "suppress", reason: "user_stop",
        metadata_sanitized: JSON.parse(JSON.stringify(meta)) });
      newSupps.push({ id: sid, destination_hash: a.p_destination_hash, channel: a.p_channel, scope: d.scope, reason: "user_stop",
        is_active: true, suppressed_at: evaluatedAt, expires_at: null, deactivated_at: null, last_event_id: eid });
      scope_results.push({ scope: d.scope, outcome: d.outcome, event_id: eid, suppression_id: sid });
    } else if (d.outcome === "user_stop_reversed") {
      const eid = simUuid();
      newEvents.push({ id: eid, provider: a.p_provider, provider_message_id: a.p_provider_message_id, channel: a.p_channel,
        evidence_type: "inbound_command", target_type: "suppression", scope: d.scope, action: "unsuppress", reason: "user_start",
        metadata_sanitized: JSON.parse(JSON.stringify(meta)) });
      updates.push({ id: d.active.id, deactivated_at: evaluatedAt, eid });
      scope_results.push({ scope: d.scope, outcome: d.outcome, event_id: eid, suppression_id: d.active.id });
    } else {
      scope_results.push({ scope: d.scope, outcome: d.outcome, event_id: null, suppression_id: d.active ? d.active.id : null });
    }
  }
  if (store.failOn === "scope2" && scope_results.some((s) => s.event_id)) throw new Error("inject one-scope partial failure");
  if (store.failOn === "receipt") throw new Error("inject receipt failure");
  // ck_consent_command_receipt_scope_results — the DB CHECK constraint: a malformed receipt row can
  // never be INSERTED (a constraint violation aborts the whole transaction, like any other failure).
  if (!simReceiptResultsValid(scope_results)) throw new Error("receipt CHECK constraint violation");
  // commit atomically (receipt + evidence + projection all-or-nothing)
  store.events.push(...newEvents); store.suppressions.push(...newSupps);
  for (const u of updates) { const s = store.suppressions.find((x) => x.id === u.id); s.is_active = false; s.deactivated_at = u.deactivated_at; s.last_event_id = u.eid; }
  store.receipts.push({ provider: a.p_provider, provider_message_id: a.p_provider_message_id, channel: a.p_channel,
    destination_hash: a.p_destination_hash, normalized_command: a.p_command, policy_version: a.p_policy_version,
    scope_results: JSON.parse(JSON.stringify(scope_results)) });
  return { ok: true, replayed: false, scope_results };
}

// ============================================================================
// FIXTURES
// ============================================================================
const HASH = "a".repeat(64);
const HASH_B = "b".repeat(64);
const UUID = "11111111-2222-4333-8444-555555555555";
const UUID_B = "99999999-8888-4777-8666-555555555555"; // a DIFFERENT valid UUID (alias-conflict fixture)
const OCCURRED = "2026-07-11T10:30:00.000Z";
const NOW = () => new Date("2026-07-12T00:00:00.000Z");
const EXPIRED = "2026-06-01T00:00:00.000Z"; // before NOW → expired
const FUTURE = "2026-09-01T00:00:00.000Z";  // after NOW → effective
let pmidCounter = 0;
const nextPmid = () => `wamid.${(pmidCounter++).toString().padStart(6, "0")}`;

function input(command, over = {}) {
  return {
    channel: "whatsapp", command, destinationHash: HASH, identityConfidence: "exact",
    principal: { type: "client", id: UUID }, provider: "meta_whatsapp", providerMessageId: nextPmid(),
    sourceEventType: "whatsapp.inbound.command", inboundMessageId: null, occurredAt: OCCURRED, ...over,
  };
}
function makeDeps(store, over = {}) {
  const calls = { rpc: 0 };
  return {
    calls,
    now: over.now ?? NOW,
    applyConsentCommand: over.applyConsentCommand ?? (async (args) => {
      calls.rpc++;
      if (over.rpcThrows) throw new Error("db down: SQLSTATE 08006 connection reset by peer");
      return M.Service.normalizeRpcResult(simApplyRawJson(store, toP(args)));
    }),
  };
}
async function run(inp, store = newStore(), over = {}) {
  const deps = makeDeps(store, over);
  const r = await M.Service.writeConsentCommand(inp, deps);
  return { r, deps, store };
}
const suppScope = (store, scope) => store.suppressions.filter((s) => s.scope === scope && s.is_active);
const activeSupps = (store) => store.suppressions.filter((s) => s.is_active);
function pushSupp(store, scope, reason, over = {}) {
  store.suppressions.push({ id: simUuid(), destination_hash: HASH, channel: "whatsapp", scope, reason, is_active: true, suppressed_at: OCCURRED, expires_at: null, deactivated_at: null, ...over });
}
function seedUserStop(store, scopes = ["marketing", "transactional"], reason = "user_stop", over = {}) {
  for (const scope of scopes) pushSupp(store, scope, reason, over);
}

// ============================================================================
// NORMALIZER (1)
// ============================================================================
check("1. normalizeConsentCommand: allowlist-only, complete-token, conservative", () => {
  const n = M.Command.normalizeConsentCommand;
  for (const w of ["STOP", "stop", " Stop ", "STOPALL", "unsubscribe", "CANCEL", "end", "QUIT"]) assert(n(w) === "stop", `stop: ${w}`);
  for (const w of ["START", "unstop", "SUBSCRIBE"]) assert(n(w) === "start", `start: ${w}`);
  for (const w of ["HELP", "info"]) assert(n(w) === "help", `help: ${w}`);
  for (const w of ["", "   ", "STOP please", "please stop", "STOP.", "stahp", "restart", "helper", "s t o p", "🚫", null, undefined, 42, {}])
    assert(n(w) === "unsupported", `unsupported: ${safeStringify(w)}`);
});

// ============================================================================
// INPUT VALIDATION (2)
// ============================================================================
check("2. invalid input → INVALID_WRITER_INPUT, and NO RPC call", async () => {
  const bad = [
    input("stop", { destinationHash: "xyz" }), input("stop", { destinationHash: "A".repeat(64) }),
    input("stop", { channel: "email" }), input("bogus"),
    input("stop", { identityConfidence: "exact", principal: null }),
    input("stop", { identityConfidence: "ambiguous", principal: { type: "client", id: UUID } }),
    input("stop", { principal: { type: "client", id: "not-a-uuid" } }),
    input("stop", { provider: "twilio" }), input("stop", { providerMessageId: "" }),
    input("stop", { providerMessageId: "has space" }), input("stop", { sourceEventType: "bad type!!" }),
    input("stop", { inboundMessageId: "not-a-uuid" }), input("stop", { occurredAt: "2026-07-11T10:30:00" }),
    input("stop", { occurredAt: "2026-07-11" }), input("stop", { occurredAt: "2026-02-29T00:00:00Z" }),
    input("stop", { correlationId: "x".repeat(201) }), input("stop", { correlationId: "has space" }),
  ];
  for (const inp of bad) {
    const { r, deps } = await run(inp);
    assert(r.ok === false && r.code === "INVALID_WRITER_INPUT", `invalid → INVALID_WRITER_INPUT: ${safeStringify(inp).slice(0, 70)}`);
    assert(deps.calls.rpc === 0, "no RPC for invalid input");
  }
});

// ============================================================================
// STOP (3-7b)
// ============================================================================
check("3. STOP creates marketing + transactional user_stop suppressions atomically + a receipt", async () => {
  const { r, store } = await run(input("stop"));
  assert(r.ok && r.result === "stop_applied" && r.replayed === false, "stop_applied");
  assert(r.scopeResults.length === 2 && r.scopeResults.every((s) => s.outcome === "suppression_created"), "both created");
  assert(suppScope(store, "marketing").length === 1 && suppScope(store, "transactional").length === 1, "one active per scope");
  assert(store.events.length === 2 && store.receipts.length === 1, "two evidence rows + one receipt");
});
check("4. STOP preserves authentication/global (never created)", async () => {
  const { store } = await run(input("stop"));
  assert(store.suppressions.every((s) => s.scope === "marketing" || s.scope === "transactional"), "no global/authentication");
});
check("5. STOP idempotent — redelivered event is a stable replay, no duplicate effect", async () => {
  const store = newStore(); const inp = input("stop");
  const a = await run(inp, store); const b = await run(inp, store);
  assert(a.r.result === "stop_applied" && a.r.replayed === false, "first applies");
  assert(b.r.result === "stop_applied" && b.r.replayed === true, "second replays");
  assert(activeSupps(store).length === 2 && store.events.length === 2 && store.receipts.length === 1, "no dup effect");
});
check("6. concurrent identical STOP → one authoritative, one replay", async () => {
  const store = newStore(); const inp = input("stop");
  const [a, b] = [await run(inp, store), await run(inp, store)];
  assert([a, b].filter((x) => x.r.replayed).length === 1 && activeSupps(store).length === 2, "one authoritative");
});
check("7. STOP preserves a stronger suppression; mixed stronger/missing still stop_applied", async () => {
  const store = newStore(); pushSupp(store, "marketing", "complaint");
  const { r } = await run(input("stop"), store);
  assert(r.ok && r.result === "stop_applied", "stop_applied");
  assert(r.scopeResults.find((s) => s.scope === "marketing").outcome === "stronger_suppression_preserved", "complaint preserved");
  assert(r.scopeResults.find((s) => s.scope === "transactional").outcome === "suppression_created", "transactional created");
  assert(suppScope(store, "marketing")[0].reason === "complaint", "not weakened");
});
check("7b. STOP when both already user_stop-active → stop_already_effective, receipt written", async () => {
  const store = newStore(); seedUserStop(store);
  const { r } = await run(input("stop"), store);
  assert(r.ok && r.result === "stop_already_effective", "already effective");
  assert(store.events.length === 0 && store.receipts.length === 1, "no evidence, receipt written");
});

// ============================================================================
// START (8-14)
// ============================================================================
check("8. START reverses both user_stop scopes → start_applied", async () => {
  const store = newStore(); seedUserStop(store);
  const { r } = await run(input("start"), store);
  assert(r.ok && r.result === "start_applied", "start_applied");
  assert(activeSupps(store).length === 0 && store.suppressions.every((s) => s.deactivated_at !== null), "deactivated");
  assert(store.events.every((e) => e.action === "unsuppress" && e.reason === "user_start"), "unsuppress evidence");
});
check("9. START reverses one, preserves stronger in the other → start_partially_applied", async () => {
  const store = newStore(); pushSupp(store, "marketing", "user_stop"); pushSupp(store, "transactional", "provider_block");
  const { r } = await run(input("start"), store);
  assert(r.ok && r.result === "start_partially_applied", "partial");
  assert(suppScope(store, "transactional")[0].reason === "provider_block", "provider_block preserved");
});
check("10-12. START never clears a stronger suppression (any restrictive reason)", async () => {
  for (const reason of ["provider_block", "hard_bounce", "complaint", "admin", "legal", "abuse", "unspecified"]) {
    const store = newStore(); seedUserStop(store, ["marketing", "transactional"], reason);
    const { r } = await run(input("start"), store);
    assert(r.ok && r.result === "start_blocked_by_stronger_suppression", `${reason} → blocked`);
    assert(activeSupps(store).length === 2 && store.events.length === 0, `${reason} not cleared`);
  }
});
check("13. START with no active suppression → start_no_reversible_stop (no mutation)", async () => {
  const { r, store } = await run(input("start"));
  assert(r.ok && r.result === "start_no_reversible_stop", "no_reversible");
  assert(store.events.length === 0 && activeSupps(store).length === 0, "nothing written");
});
check("14. START never creates a preference / marketing opt-in", async () => {
  const store = newStore(); seedUserStop(store);
  await run(input("start"), store);
  assert(store.preferences === undefined, "no preference store");
  hasNot(/communication_preferences/, writerCode(), "writer never references preferences");
  hasNot(/marketing_opt|opt_in|\ballowed\b/i, writerCode(), "writer never creates opt-in");
});

// ============================================================================
// HELP / UNSUPPORTED (15-17)
// ============================================================================
check("15-16. HELP → help_acknowledged, NO RPC, NO evidence/projection/receipt", async () => {
  const { r, deps, store } = await run(input("help"));
  assert(r.ok && r.result === "help_acknowledged" && r.scopeResults.length === 0, "help_acknowledged");
  assert(deps.calls.rpc === 0 && store.events.length === 0 && store.suppressions.length === 0 && store.receipts.length === 0, "no side effects");
});
check("17. unsupported → unsupported_command, NO RPC, NO mutation", async () => {
  const { r, deps, store } = await run(input("unsupported"));
  assert(r.ok && r.result === "unsupported_command", "unsupported_command");
  assert(deps.calls.rpc === 0 && store.events.length === 0 && store.receipts.length === 0, "no side effects");
});

// ============================================================================
// IDENTITY & PREFERENCE (18-19)
// ============================================================================
check("18. ambiguous/unknown identity → suppression works, no principal passed", async () => {
  for (const conf of ["ambiguous", "unknown"]) {
    let captured = null; const store = newStore();
    const { r } = await run(input("stop", { identityConfidence: conf, principal: null }), store, {
      applyConsentCommand: async (args) => { captured = args; return M.Service.normalizeRpcResult(simApplyRawJson(store, toP(args))); },
    });
    assert(r.ok && r.result === "stop_applied", `${conf} applies`);
    assert(captured.principalType === null && captured.principalId === null, `${conf} passes no principal`);
  }
});
check("19. exact identity is suppression-only too — no preference write", async () => {
  const { store } = await run(input("stop", { identityConfidence: "exact", principal: { type: "vendor", id: UUID } }));
  assert(store.preferences === undefined && store.suppressions.length === 2, "suppressions only");
});

// ============================================================================
// TRANSACTIONAL ROLLBACK (20-22)
// ============================================================================
check("20-22. any failure rolls back the ENTIRE command (evidence / projection / one-scope)", async () => {
  for (const failOn of ["evidence", "projection", "scope2", "receipt"]) {
    const store = newStore(); store.failOn = failOn;
    const { r } = await run(input("stop"), store);
    assert(r.ok === false && r.code === "WRITER_TRANSACTION_FAILED", `${failOn} → WRITER_TRANSACTION_FAILED`);
    assert(store.events.length === 0 && store.suppressions.length === 0 && store.receipts.length === 0, `${failOn} → no partial state`);
  }
});

// ============================================================================
// TIMESTAMP & MISSING IDENTITY FAIL-CLOSED (23-24)
// ============================================================================
check("23. malformed timestamp fails closed (TS) with no RPC; RPC re-validates independently", async () => {
  const { r, deps } = await run(input("stop", { occurredAt: "07/11/2026" }));
  assert(r.ok === false && r.code === "INVALID_WRITER_INPUT" && deps.calls.rpc === 0, "TS rejects, no RPC");
  const direct = simApplyRawJson(newStore(), { p_policy_version: "qf-consent-v1", p_channel: "whatsapp", p_command: "stop",
    p_destination_hash: HASH, p_provider: "meta_whatsapp", p_provider_message_id: "x", p_source_event_id: "x",
    p_occurred_at: "2026-07-11T10:30:00", p_received_at: "2026-07-12T00:00:00Z" });
  assert(direct.ok === false && direct.code === "INVALID_WRITER_INPUT", "RPC mirror rejects timezone-less occurred_at");
});
check("24. missing provider event identity fails closed", async () => {
  const { r, deps } = await run(input("stop", { providerMessageId: "" }));
  assert(r.ok === false && r.code === "INVALID_WRITER_INPUT" && deps.calls.rpc === 0, "missing id → INVALID, no RPC");
});

// ============================================================================
// REPLAY / CONFLICT / RECEIPT INTEGRITY (25-27)
// ============================================================================
check("25. same provider event + same command → stable replay (replayed=true)", async () => {
  const store = newStore(); seedUserStop(store); const inp = input("start");
  const a = await run(inp, store); const b = await run(inp, store);
  assert(a.r.result === "start_applied" && b.r.result === "start_applied" && b.r.replayed === true, "stable replay");
});
check("26. same provider event + different command → WRITER_CONFLICT", async () => {
  const store = newStore(); const pmid = nextPmid();
  await run(input("stop", { providerMessageId: pmid }), store);
  const start = await run(input("start", { providerMessageId: pmid }), store);
  assert(start.r.ok === false && start.r.code === "WRITER_CONFLICT", "different command → conflict");
});
check("27. invalid/incomplete stored receipt → WRITER_INTEGRITY_VIOLATION", async () => {
  const store = newStore(); const inp = input("stop");
  await run(inp, store);
  store.receipts[0].scope_results = [store.receipts[0].scope_results[0]]; // corrupt: only one scope
  const { r } = await run(inp, store);
  assert(r.ok === false && r.code === "WRITER_INTEGRITY_VIOLATION", "incomplete receipt → integrity");
});

// ============================================================================
// PRIVACY (28)
// ============================================================================
check("28. no destination hash / raw error / SQLSTATE / stack in any outcome", async () => {
  const outcomes = [
    (await run(input("stop"))).r,
    (await run(input("start"), (() => { const s = newStore(); seedUserStop(s); return s; })())).r,
    (await run(input("help"))).r,
    (await run(input("stop"), newStore(), { rpcThrows: true })).r,
  ];
  for (const o of outcomes) {
    const rendered = safeStringify(o);
    assert(!rendered.includes(HASH), "no destination hash echoed");
    assert(!/SQLSTATE|connection reset|db down|stack|Error:/i.test(rendered), "no raw DB error / SQLSTATE / stack");
  }
  const fail = (await run(input("stop"), newStore(), { rpcThrows: true })).r;
  assert(fail.ok === false && fail.code === "WRITER_TRANSACTION_FAILED", "thrown RPC → sanitized failure");
});

// ============================================================================
// NO-OP REPLAY / CONFLICT + CROSS-DESTINATION (38-42)  [numbered as required scenarios]
// ============================================================================
check("38. no-op STOP replay (both already user_stop) → replayed=true, stable result", async () => {
  const store = newStore(); seedUserStop(store); const inp = input("stop");
  const a = await run(inp, store); const b = await run(inp, store);
  assert(a.r.result === "stop_already_effective" && a.r.replayed === false, "first no-op");
  assert(b.r.result === "stop_already_effective" && b.r.replayed === true, "second replays the no-op");
  assert(store.events.length === 0, "still no evidence");
});
check("39. no-op STOP then START on the same provider message → WRITER_CONFLICT", async () => {
  const store = newStore(); seedUserStop(store); const pmid = nextPmid();
  const stop = await run(input("stop", { providerMessageId: pmid }), store);
  assert(stop.r.result === "stop_already_effective", "no-op stop recorded a receipt");
  const start = await run(input("start", { providerMessageId: pmid }), store);
  assert(start.r.ok === false && start.r.code === "WRITER_CONFLICT", "reused event, different command → conflict");
});
check("40. no-op START replay (no active suppression) → replayed=true", async () => {
  const store = newStore(); const inp = input("start");
  const a = await run(inp, store); const b = await run(inp, store);
  assert(a.r.result === "start_no_reversible_stop" && a.r.replayed === false, "first no-op");
  assert(b.r.result === "start_no_reversible_stop" && b.r.replayed === true, "second replays");
});
check("41. same provider message + different destination → WRITER_CONFLICT", async () => {
  const store = newStore(); const pmid = nextPmid();
  await run(input("stop", { providerMessageId: pmid, destinationHash: HASH }), store);
  const other = await run(input("stop", { providerMessageId: pmid, destinationHash: HASH_B }), store);
  assert(other.r.ok === false && other.r.code === "WRITER_CONFLICT", "different destination on same event → conflict");
});
check("42. concurrent same provider event with different command/destination → one wins, other conflicts", async () => {
  const store = newStore(); const pmid = nextPmid();
  const first = await run(input("stop", { providerMessageId: pmid }), store);
  const second = await run(input("start", { providerMessageId: pmid, destinationHash: HASH_B }), store);
  assert(first.r.ok === true && second.r.ok === false && second.r.code === "WRITER_CONFLICT", "deterministic conflict");
});

// ============================================================================
// EFFECTIVE-ACTIVITY / EXPIRY (43-46)
// ============================================================================
check("43. expired user_stop followed by STOP → fresh suppression + system expiry evidence", async () => {
  const store = newStore(); seedUserStop(store, ["marketing", "transactional"], "user_stop", { expires_at: EXPIRED });
  const { r } = await run(input("stop"), store);
  assert(r.ok && r.result === "stop_applied" && r.scopeResults.every((s) => s.outcome === "suppression_created"), "fresh created after expiry");
  assert(store.events.filter((e) => e.evidence_type === "system_action" && e.reason === "system").length === 2, "two system expiry events");
  assert(store.events.filter((e) => e.action === "suppress" && e.reason === "user_stop").length === 2, "two fresh suppress events");
  assert(activeSupps(store).length === 2 && activeSupps(store).every((s) => s.expires_at === null), "fresh effective user_stop");
});
check("44. expired STRONGER suppression followed by STOP → fresh user_stop, old expired deactivated", async () => {
  const store = newStore(); seedUserStop(store, ["marketing", "transactional"], "provider_block", { expires_at: EXPIRED });
  const { r } = await run(input("stop"), store);
  assert(r.ok && r.result === "stop_applied" && r.scopeResults.every((s) => s.outcome === "suppression_created"), "fresh created");
  assert(store.suppressions.filter((s) => s.reason === "provider_block" && s.is_active === false && s.deactivated_at !== null).length === 2, "expired stronger deactivated w/ evidence");
  assert(store.events.filter((e) => e.evidence_type === "system_action").length === 2, "system expiry evidence");
});
check("45. expired user_stop followed by START → NOT treated as reversible → no_reversible_stop", async () => {
  const store = newStore(); seedUserStop(store, ["marketing", "transactional"], "user_stop", { expires_at: EXPIRED });
  const { r } = await run(input("start"), store);
  assert(r.ok && r.result === "start_no_reversible_stop", "expired row not a reversible active STOP");
  assert(store.events.filter((e) => e.evidence_type === "system_action").length === 2, "expiry evidence appended");
  assert(store.events.filter((e) => e.reason === "user_start").length === 0, "no user_start reversal evidence");
  assert(activeSupps(store).length === 0, "expired rows deactivated");
});
check("46. replay returns the EXACT original stored ids even after later state changes", async () => {
  const store = newStore(); const pmid = nextPmid();
  const first = await run(input("stop", { providerMessageId: pmid }), store);
  const original = JSON.stringify(first.r.scopeResults.map((s) => [s.eventId, s.suppressionId]));
  // later state churn: deactivate everything + add unrelated fresh suppressions
  store.suppressions.forEach((s) => { s.is_active = false; s.deactivated_at = NOW().toISOString(); });
  pushSupp(store, "marketing", "user_stop"); pushSupp(store, "transactional", "user_stop");
  const replay = await run(input("stop", { providerMessageId: pmid }), store);
  assert(replay.r.replayed === true, "replayed");
  assert(JSON.stringify(replay.r.scopeResults.map((s) => [s.eventId, s.suppressionId])) === original, "stored ids returned verbatim, not re-derived");
});

// ============================================================================
// normalizeRpcResult HARDENING (47) + DIRECT-RPC VALIDATION (48-49)
// ============================================================================
check("47. normalizeRpcResult: strict two-scope shape + outcome/id consistency", () => {
  const N = M.Service.normalizeRpcResult;
  const ok2 = { ok: true, replayed: false, scope_results: [
    { scope: "marketing", outcome: "suppression_created", event_id: UUID, suppression_id: UUID },
    { scope: "transactional", outcome: "no_reversible_user_stop", event_id: null, suppression_id: null }] };
  assert(N(ok2).ok === true, "valid two-scope");
  assert(N({ ok: true, replayed: false, scope_results: [] }).code === "WRITER_INTEGRITY_VIOLATION", "zero scopes");
  assert(N({ ok: true, replayed: false, scope_results: [ok2.scope_results[0]] }).code === "WRITER_INTEGRITY_VIOLATION", "one scope");
  assert(N({ ok: true, replayed: false, scope_results: [ok2.scope_results[0], ok2.scope_results[0]] }).code === "WRITER_INTEGRITY_VIOLATION", "duplicate marketing");
  assert(N({ ok: true, replayed: false, scope_results: [ok2.scope_results[1], ok2.scope_results[0]] }).code === "WRITER_INTEGRITY_VIOLATION", "wrong order (transactional first)");
  assert(N({ ok: true, replayed: "yes", scope_results: ok2.scope_results }).code === "WRITER_INTEGRITY_VIOLATION", "non-boolean replayed");
  // outcome/id contradictions
  assert(N({ ok: true, replayed: false, scope_results: [{ scope: "marketing", outcome: "suppression_created", event_id: null, suppression_id: UUID }, ok2.scope_results[1]] }).code === "WRITER_INTEGRITY_VIOLATION", "created without eventId");
  assert(N({ ok: true, replayed: false, scope_results: [{ scope: "marketing", outcome: "user_stop_already_active", event_id: UUID, suppression_id: UUID }, ok2.scope_results[1]] }).code === "WRITER_INTEGRITY_VIOLATION", "already_active with eventId");
  assert(N({ ok: true, replayed: false, scope_results: [{ scope: "marketing", outcome: "no_reversible_user_stop", event_id: null, suppression_id: UUID }, ok2.scope_results[1]] }).code === "WRITER_INTEGRITY_VIOLATION", "no_reversible with suppressionId");
  assert(N(null).code === "WRITER_INTEGRITY_VIOLATION", "null");
  assert(N({ ok: false, code: "WRITER_CONFLICT" }).code === "WRITER_CONFLICT", "conflict preserved");
  assert(N({ ok: false, code: "haxx" }).code === "WRITER_INTEGRITY_VIOLATION", "unknown code → integrity");

  // ---- ID-KEY PRESENCE (an ABSENT key is NOT an explicit null) ----------------------------------
  const T_NULL = { scope: "transactional", outcome: "no_reversible_user_stop", event_id: null, suppression_id: null };
  const two = (m) => ({ ok: true, replayed: false, scope_results: [m, T_NULL] });
  // absent event_id / suppression_id key — even for an outcome whose ids are BOTH null — is rejected:
  // a truncated row must never masquerade as a legitimate "no id for this outcome" result.
  assert(N(two({ scope: "marketing", outcome: "no_reversible_user_stop", suppression_id: null })).code === "WRITER_INTEGRITY_VIOLATION", "absent event_id key");
  assert(N(two({ scope: "marketing", outcome: "no_reversible_user_stop", event_id: null })).code === "WRITER_INTEGRITY_VIOLATION", "absent suppression_id key");
  assert(N(two({ scope: "marketing", outcome: "no_reversible_user_stop" })).code === "WRITER_INTEGRITY_VIOLATION", "both id keys absent");
  assert(N({ ok: true, replayed: false, scope_results: [
    { scope: "marketing", outcome: "no_reversible_user_stop", event_id: null, suppression_id: null },
    { scope: "transactional", outcome: "no_reversible_user_stop", suppression_id: null }] }).code === "WRITER_INTEGRITY_VIOLATION", "absent key in the SECOND scope too");
  // explicit null REMAINS valid where the outcome permits null
  assert(N(two({ scope: "marketing", outcome: "no_reversible_user_stop", event_id: null, suppression_id: null })).ok === true, "explicit null valid for no_reversible_user_stop");
  assert(N(two({ scope: "marketing", outcome: "user_stop_already_active", event_id: null, suppression_id: UUID })).ok === true, "explicit null eventId valid for already_active");
  // ---- ALIAS CONSISTENCY (camelCase + snake_case must agree) ------------------------------------
  assert(N(two({ scope: "marketing", outcome: "suppression_created", event_id: UUID, eventId: UUID, suppression_id: UUID, suppressionId: UUID })).ok === true, "matching aliases accepted");
  assert(N(two({ scope: "marketing", outcome: "suppression_created", event_id: UUID, eventId: UUID_B, suppression_id: UUID, suppressionId: UUID })).code === "WRITER_INTEGRITY_VIOLATION", "conflicting event_id aliases");
  assert(N(two({ scope: "marketing", outcome: "suppression_created", event_id: UUID, suppression_id: UUID, suppressionId: UUID_B })).code === "WRITER_INTEGRITY_VIOLATION", "conflicting suppression_id aliases");
  assert(N(two({ scope: "marketing", outcome: "user_stop_already_active", event_id: null, eventId: UUID, suppression_id: UUID })).code === "WRITER_INTEGRITY_VIOLATION", "null vs UUID aliases conflict");
  // camelCase ALONE is accepted (the alias exists) — presence, not naming, is what is enforced
  assert(N(two({ scope: "marketing", outcome: "suppression_created", eventId: UUID, suppressionId: UUID })).ok === true, "camelCase-only aliases accepted");
  // ---- the sanitized output contract is preserved: ONLY the four allowlisted fields survive -------
  const clean = N(two({ scope: "marketing", outcome: "suppression_created", event_id: UUID, suppression_id: UUID, raw_row: { phone: "+919999999999" }, sql: "boom" }));
  assert(clean.ok === true, "extra properties do not break normalization");
  assert(JSON.stringify(clean.scopeResults[0]) === JSON.stringify({ scope: "marketing", outcome: "suppression_created", eventId: UUID, suppressionId: UUID }), "only allowlisted fields are copied");
  assert(!safeStringify(clean).includes("919999999999") && !safeStringify(clean).includes("boom"), "no raw row / unexpected property leaks");
});
check("48. direct RPC: arbitrary provider rejected", () => {
  const base = { p_policy_version: "qf-consent-v1", p_channel: "whatsapp", p_command: "stop", p_destination_hash: HASH,
    p_provider_message_id: "wamid.1", p_source_event_id: "wamid.1", p_occurred_at: OCCURRED, p_received_at: "2026-07-12T00:00:00Z" };
  assert(simApplyRawJson(newStore(), { ...base, p_provider: "twilio" }).code === "INVALID_WRITER_INPUT", "twilio rejected");
  assert(simApplyRawJson(newStore(), { ...base, p_provider: "meta_whatsapp" }).ok === true, "meta_whatsapp accepted");
});
check("49. direct RPC: raw/free-form identifier rejected", () => {
  const base = { p_policy_version: "qf-consent-v1", p_channel: "whatsapp", p_command: "stop", p_destination_hash: HASH,
    p_provider: "meta_whatsapp", p_occurred_at: OCCURRED, p_received_at: "2026-07-12T00:00:00Z" };
  assert(simApplyRawJson(newStore(), { ...base, p_provider_message_id: "hi there\n<b>", p_source_event_id: "x" }).code === "INVALID_WRITER_INPUT", "whitespace/control in provider_message_id rejected");
  assert(simApplyRawJson(newStore(), { ...base, p_provider_message_id: "x", p_source_event_id: "STOP the promo now" }).code === "INVALID_WRITER_INPUT", "free-form source_event_id rejected");
  assert(simApplyRawJson(newStore(), { ...base, p_provider_message_id: "x", p_source_event_id: "x", p_correlation_id: "has space" }).code === "INVALID_WRITER_INPUT", "free-form correlation_id rejected");
});

// ============================================================================
// RECEIPT BINDING + SQL-SIDE STRUCTURAL VALIDATION (51-62)
//
// The stored receipt is the SOLE source of a replayed outcome, so its binding and its structure are a
// security boundary. Every case below is asserted TWICE: through the writer (the user-visible contract)
// AND against the RAW RPC json (simApplyRawJson, which bypasses normalizeRpcResult entirely) — proving
// the SQL layer itself rejects it and the TypeScript normalizer is a second fence, not the only one.
// ============================================================================
/** The p_* args for the SAME provider event as `inp` (the redelivery the RPC must classify). */
const rpcArgsFor = (inp, command) => toP({
  policyVersion: "qf-consent-v1", channel: inp.channel, command, destinationHash: inp.destinationHash,
  principalType: null, principalId: null, provider: inp.provider, providerMessageId: inp.providerMessageId,
  sourceEventType: inp.sourceEventType, sourceEventId: inp.providerMessageId, inboundMessageId: null,
  occurredAt: inp.occurredAt, receivedAt: NOW().toISOString(), correlationId: null, causationId: null,
});
/** Apply one fresh command, CORRUPT the stored receipt, then redeliver the SAME provider event. */
async function redeliverWithReceipt(mutate, over = {}) {
  const store = newStore();
  if (over.seed) over.seed(store);
  const command = over.command ?? "stop";
  const inp = input(command);
  const first = await run(inp, store);
  assert(first.r.ok === true && store.receipts.length === 1, "setup: the fresh command wrote exactly one receipt");
  mutate(store.receipts[0], store);
  return { viaWriter: (await run(inp, store)).r, raw: simApplyRawJson(store, rpcArgsFor(inp, command)) };
}
function assertCode(x, code, msg) {
  assert(x.viaWriter.ok === false && x.viaWriter.code === code, `${msg}: writer → ${code} (got ${safeStringify(x.viaWriter)})`);
  assert(x.raw.ok === false && x.raw.code === code, `${msg}: the RPC ITSELF returns ${code} — not the TS normalizer (got ${safeStringify(x.raw)})`);
}
const integrity = (x, msg) => assertCode(x, "WRITER_INTEGRITY_VIOLATION", msg);

check("51. exact binding match (provider+message+channel+destination+command+policy) → stable replay", async () => {
  const store = newStore(); const inp = input("stop");
  const a = await run(inp, store);
  const b = await run(inp, store);
  const rec = store.receipts[0];
  assert(rec.policy_version === "qf-consent-v1" && rec.destination_hash === HASH && rec.normalized_command === "stop", "receipt binds destination + command + policy");
  assert(b.r.replayed === true && JSON.stringify(b.r.scopeResults) === JSON.stringify(a.r.scopeResults), "exact binding → stable replay of the original result");
  const raw = simApplyRawJson(store, rpcArgsFor(inp, "stop"));
  assert(raw.ok === true && raw.replayed === true, "the RPC itself replays an exactly-bound receipt");
});
check("52. receipt POLICY-VERSION mismatch → WRITER_CONFLICT (policy comparison is load-bearing)", async () => {
  for (const stale of ["qf-consent-v0", "qf-consent-v2", "other"]) {
    const x = await redeliverWithReceipt((r) => { r.policy_version = stale; });
    assertCode(x, "WRITER_CONFLICT", `stored policy '${stale}' ≠ p_policy_version`);
  }
});
check("53. missing/null stored policy version → WRITER_INTEGRITY_VIOLATION", async () => {
  integrity(await redeliverWithReceipt((r) => { r.policy_version = null; }), "null stored policy version");
  integrity(await redeliverWithReceipt((r) => { delete r.policy_version; }), "missing stored policy version");
});
check("54. duplicate marketing receipt scopes → WRITER_INTEGRITY_VIOLATION", async () => {
  const x = await redeliverWithReceipt((r) => { r.scope_results = [r.scope_results[0], JSON.parse(JSON.stringify(r.scope_results[0]))]; });
  integrity(x, "two marketing items");
});
check("55. transactional-first receipt (wrong scope order) → WRITER_INTEGRITY_VIOLATION", async () => {
  const x = await redeliverWithReceipt((r) => { r.scope_results = [r.scope_results[1], r.scope_results[0]]; });
  integrity(x, "transactional at index 0");
});
check("56. invalid event UUID in the receipt → WRITER_INTEGRITY_VIOLATION", async () => {
  for (const bad of ["not-a-uuid", "", "11111111-1111-4111-8111", "'; drop table x; --", 42, {}])
    integrity(await redeliverWithReceipt((r) => { r.scope_results[0].event_id = bad; }), `event_id = ${safeStringify(bad)}`);
});
check("57. invalid suppression UUID in the receipt → WRITER_INTEGRITY_VIOLATION", async () => {
  for (const bad of ["not-a-uuid", "1234", true])
    integrity(await redeliverWithReceipt((r) => { r.scope_results[0].suppression_id = bad; }), `suppression_id = ${safeStringify(bad)}`);
});
check("58. contradictory suppression_created ids → WRITER_INTEGRITY_VIOLATION", async () => {
  integrity(await redeliverWithReceipt((r) => { r.scope_results[0].event_id = null; }), "created without an event_id");
  integrity(await redeliverWithReceipt((r) => { r.scope_results[0].suppression_id = null; }), "created without a suppression_id");
  integrity(await redeliverWithReceipt((r) => { delete r.scope_results[0].event_id; }), "created with the event_id key absent");
});
check("59. contradictory user_stop_already_active ids → WRITER_INTEGRITY_VIOLATION", async () => {
  const seed = (store) => seedUserStop(store); // STOP over an existing user_stop → user_stop_already_active
  const base = await redeliverWithReceipt((r) => { assert(r.scope_results[0].outcome === "user_stop_already_active", "setup: already-active outcome"); }, { seed });
  assert(base.viaWriter.ok === true && base.viaWriter.replayed === true, "an intact already-active receipt still replays");
  integrity(await redeliverWithReceipt((r) => { r.scope_results[0].event_id = UUID; }, { seed }), "already-active with an event_id");
  integrity(await redeliverWithReceipt((r) => { r.scope_results[0].suppression_id = null; }, { seed }), "already-active without a suppression_id");
});
check("60. contradictory no_reversible_user_stop ids → WRITER_INTEGRITY_VIOLATION", async () => {
  const over = { command: "start" }; // START with nothing active → no_reversible_user_stop (both ids null)
  integrity(await redeliverWithReceipt((r) => { r.scope_results[0].suppression_id = UUID; }, over), "no_reversible with a suppression_id");
  integrity(await redeliverWithReceipt((r) => { r.scope_results[0].event_id = UUID; r.scope_results[0].suppression_id = UUID; }, over), "no_reversible with both ids");
});
check("61. malformed two-item receipt → WRITER_INTEGRITY_VIOLATION", async () => {
  const malformed = [
    ["item is a string", (r) => { r.scope_results[1] = "transactional"; }],
    ["item is an array", (r) => { r.scope_results[1] = []; }],
    ["item is null", (r) => { r.scope_results[1] = null; }],
    ["outcome outside the closed vocabulary", (r) => { r.scope_results[0].outcome = "suppression_deleted"; }],
    ["outcome missing", (r) => { delete r.scope_results[0].outcome; }],
    ["scope outside the closed vocabulary", (r) => { r.scope_results[0].scope = "global"; }],
    ["scope missing", (r) => { delete r.scope_results[1].scope; }],
    ["suppression_id key absent", (r) => { delete r.scope_results[1].suppression_id; }],
    ["scope_results not an array", (r) => { r.scope_results = { scope: "marketing" }; }],
    ["scope_results is null", (r) => { r.scope_results = null; }],
    ["three items", (r) => { r.scope_results = [...r.scope_results, r.scope_results[1]]; }],
    ["one item", (r) => { r.scope_results = [r.scope_results[0]]; }],
    ["empty array", (r) => { r.scope_results = []; }],
    ["scope_results is a JSON string", (r) => { r.scope_results = "marketing"; }],
    ["scope_results is a JSON number", (r) => { r.scope_results = 2; }],
    ["scope_results is a JSON boolean", (r) => { r.scope_results = true; }],
  ];
  for (const [name, mutate] of malformed) integrity(await redeliverWithReceipt(mutate), name);

  // The validator is FAIL-CLOSED for EVERY JSON type: it returns false — it never throws (in SQL,
  // jsonb_array_length RAISES on a non-array, which is why the type guard is a CASE, not an `and`).
  for (const v of [null, undefined, {}, { a: 1 }, "str", "", 0, 2, 42, true, false, [], [1], [1, 2, 3], [{}, {}]]) {
    let out;
    try { out = simReceiptResultsValid(v); }
    catch (e) { throw new Error(`the validator must not throw on ${safeStringify(v)} (it threw ${e.message})`); }
    assert(out === false, `non-conforming JSON must return exactly false, not ${safeStringify(out)} (input ${safeStringify(v)})`);
  }
  // ...and a well-formed two-item array still returns exactly true.
  assert(simReceiptResultsValid([
    { scope: "marketing", outcome: "suppression_created", event_id: UUID, suppression_id: UUID },
    { scope: "transactional", outcome: "no_reversible_user_stop", event_id: null, suppression_id: null },
  ]) === true, "a well-formed receipt result still validates");
});
check("62. a corrupted receipt NEVER replays and NEVER re-applies the command (fail closed, no mutation)", async () => {
  const store = newStore(); const inp = input("stop");
  await run(inp, store);
  const before = JSON.stringify({ e: store.events, s: store.suppressions });
  store.receipts[0].scope_results[0].event_id = "not-a-uuid";
  const { r } = await run(inp, store);
  assert(r.ok === false && r.code === "WRITER_INTEGRITY_VIOLATION", "fails closed");
  assert(JSON.stringify({ e: store.events, s: store.suppressions }) === before, "no evidence / projection change on a corrupted receipt");
  assert(store.receipts.length === 1, "no second receipt written");
});

// ============================================================================
// STATIC SQL INVARIANTS (30-33 + receipt/lock/expiry)
// ============================================================================
check("30. receipt table + RPC least-privilege SECURITY DEFINER + service_role-only", () => {
  const sql = sqlCode();
  has(/create table if not exists public\.communication_consent_command_receipts/i, sql, "receipt table added");
  has(/constraint uq_consent_command_receipt unique \(provider, provider_message_id, channel\)/i, sql, "receipt unique key");
  has(/grant select, insert on public\.communication_consent_command_receipts to service_role/i, sql, "receipt service_role grant");
  hasNot(/grant (delete|update)[\s\S]*communication_consent_command_receipts/i, sql, "receipt has no delete/update grant");
  has(/security\s+definer/i, sql, "security definer");
  has(/set\s+search_path\s*=\s*pg_catalog,\s*public/i, sql, "fixed safe search_path");
  has(/revoke\s+all\s+on\s+function[\s\S]*from\s+public/i, sql, "revoke from public");
  has(/revoke\s+all\s+on\s+function[\s\S]*from\s+anon/i, sql, "revoke from anon");
  has(/revoke\s+all\s+on\s+function[\s\S]*from\s+authenticated/i, sql, "revoke from authenticated");
  has(/grant\s+execute\s+on\s+function[\s\S]*to\s+service_role/i, sql, "grant execute to service_role");
  hasNot(/execute\s+format|execute\s+'|execute\s+"/i, sql, "no dynamic SQL");
});
check("31. RPC append-only + suppression-only + P1 scope-bounded", () => {
  const sql = sqlCode();
  hasNot(/update\s+public\.communication_consent_events|delete\s+from\s+public\.communication_consent_events/i, sql, "never UPDATE/DELETE evidence");
  hasNot(/(insert\s+into|update|delete\s+from|from|join)\s+public\.communication_preferences/i, sql, "never touches communication_preferences (P2)");
  has(/array\[\s*'marketing'\s*,\s*'transactional'\s*\]/i, sql, "scope set is exactly marketing + transactional");
  hasNot(/'authentication'|'global'/i, sql, "never global / authentication (P1)");
  hasNot(/sendTemplateMessage|graph\.facebook|whatsAppCloud|\.send\(|n8n/i, sql, "no send / Meta / n8n");
});
check("32. RPC guards: START reverses ONLY user_stop; conflict + receipt-integrity + rollback", () => {
  const sql = sqlCode();
  has(/'no_reversible_user_stop'\s*;\s*elsif\s+v_active_reason\s*=\s*'user_stop'\s+then\s+v_outcome\s*:=\s*'user_stop_reversed'/i, sql, "START reversal guarded by reason = user_stop");
  has(/v_r_cmd\s+is\s+distinct\s+from\s+p_command\s+or\s+v_r_dest\s+is\s+distinct\s+from\s+p_destination_hash[\s\S]*?WRITER_CONFLICT/i, sql, "command/destination conflict detection");
  has(/not\s+public\.communication_consent_receipt_results_valid\(v_r_scope\)[\s\S]{0,200}?WRITER_INTEGRITY_VIOLATION/i, sql, "receipt-integrity guard");
  has(/for\s+update/i, sql, "row locking (FOR UPDATE)");
  has(/exception\s*\n?\s*when\s+unique_violation\s+then/i, sql, "unique-violation → sanitized conflict, rollback");
});
check("33. RPC re-validates strict RFC3339 + provider allowlist + bounded identifiers", () => {
  const sql = sqlCode();
  has(/c_rfc3339/i, sql, "strict RFC3339 regex present");
  has(/p_occurred_at::timestamptz/i, sql, "calendar-valid cast");
  has(/p_provider\s+not\s+in\s*\(\s*'meta_whatsapp',\s*'exotel_sms',\s*'system'\s*\)/i, sql, "provider allowlist matches TS");
  has(/c_ident\s+constant\s+text\s*:=\s*'\^\[A-Za-z0-9\._:-\]\{1,200\}\$'/i, sql, "bounded identifier regex");
  for (const f of ["p_provider_message_id", "p_source_event_id", "p_correlation_id", "p_causation_id"]) has(new RegExp(`${f}[\\s\\S]{0,40}!~ c_ident`, "i"), sql, `${f} bounded-validated`);
  has(/UNSUPPORTED_POLICY_VERSION/i, sql, "fixed policy-version fence");
});
check("34. effective-activity expiry: guard + system-action evidence + fixed lock order + verbatim replay", () => {
  const sql = sqlCode();
  has(/v_active_expires\s+is\s+not\s+null\s+and\s+v_active_expires\s*<=\s*v_evaluated_at/i, sql, "effective-activity expiry guard");
  has(/'unsuppress',\s*'active',\s*'inactive',\s*'system',\s*'system',\s*'system_action'/i, sql, "system-action expiry evidence");
  // fixed lock order: provider-event ('evt|') advisory lock BEFORE destination ('dst|')
  const evtIdx = sql.indexOf("'evt|'");
  const dstIdx = sql.indexOf("'dst|'");
  assert(evtIdx > 0 && dstIdx > evtIdx, "provider-event lock acquired before destination lock");
  // replay returns the stored scope_results verbatim (does not re-derive from current rows)
  has(/'replayed',\s*true,\s*'scope_results',\s*v_r_scope/i, sql, "replay returns stored v_r_scope verbatim");
});

check("63. SQL: the receipt replay binding includes the stored POLICY VERSION", () => {
  const sql = sqlCode();
  has(/select\s+destination_hash,\s*normalized_command,\s*policy_version,\s*scope_results\s+into\s+v_r_dest,\s*v_r_cmd,\s*v_r_policy,\s*v_r_scope/i, sql,
    "the receipt lookup SELECTS the stored policy_version");
  has(/v_r_cmd\s+is\s+null\s+or\s+v_r_dest\s+is\s+null\s+or\s+v_r_policy\s+is\s+null[\s\S]{0,240}?WRITER_INTEGRITY_VIOLATION/i, sql,
    "missing/null stored policy version → WRITER_INTEGRITY_VIOLATION");
  has(/or\s+v_r_policy\s+is\s+distinct\s+from\s+p_policy_version[\s\S]{0,200}?WRITER_CONFLICT/i, sql,
    "stored policy version ≠ p_policy_version → WRITER_CONFLICT");
  // integrity is decided BEFORE conflict: a malformed receipt is never a comparable outcome
  assert(sql.indexOf("v_r_policy is null") < sql.indexOf("v_r_policy is distinct from p_policy_version"),
    "the integrity guard precedes the conflict comparison");
});
check("64. SQL: stored scope_results are FULLY validated in SQL before replay (not only in TypeScript)", () => {
  const sql = sqlCode();
  has(/create or replace function public\.communication_consent_receipt_results_valid\(p_results jsonb\)/i, sql, "the results validator exists");
  has(/create or replace function public\.communication_consent_receipt_scope_result_valid\(/i, sql, "the per-item validator exists");
  // FAIL-CLOSED TYPE GUARD: jsonb_array_length RAISES on a non-array, and SQL does not guarantee that
  // `and` short-circuits — so the guard MUST be an explicit CASE, never boolean evaluation order.
  has(/case jsonb_typeof\(p_results\)\s*when 'array' then/i, sql, "explicit CASE type guard on the results value");
  hasNot(/jsonb_typeof\(p_results\)\s*=\s*'array'\s*and\s+jsonb_array_length/i, sql, "never relies on `and` short-circuiting to protect jsonb_array_length");
  has(/case when jsonb_array_length\(p_results\) = 2/i, sql, "the length test lives INSIDE the array branch");
  assert(sql.indexOf("when 'array' then") < sql.indexOf("jsonb_array_length("), "jsonb_array_length is reachable only from the 'array' branch");
  assert((sql.match(/jsonb_array_length\(/g) || []).length === 1, "jsonb_array_length is called exactly once (only under the guard)");
  has(/when 'array' then[\s\S]{0,320}?else false\s*end/i, sql, "a non-array JSON value (null/object/string/number/boolean) and SQL NULL → false");
  has(/communication_consent_receipt_scope_result_valid\(p_results\s*->\s*0,\s*'marketing'\)/i, sql, "item 0 scope = marketing");
  has(/communication_consent_receipt_scope_result_valid\(p_results\s*->\s*1,\s*'transactional'\)/i, sql, "item 1 scope = transactional");
  has(/case jsonb_typeof\(p_item\)\s*when 'object' then/i, sql, "each item is guarded to a JSON object by an explicit CASE");
  has(/\(p_item\s*->>\s*'outcome'\)\s*in\s*\(\s*'suppression_created',\s*'user_stop_already_active',\s*'stronger_suppression_preserved',\s*'user_stop_reversed',\s*'no_reversible_user_stop'\)/i, sql,
    "closed outcome vocabulary");
  for (const f of ["event_id", "suppression_id"]) {
    has(new RegExp(`jsonb_typeof\\(p_item -> '${f}'\\) in \\('string', 'null'\\)`, "i"), sql, `${f} is a JSON string or JSON null`);
    has(new RegExp(`\\(p_item ->> '${f}'\\) ~\\* '\\^\\[0-9a-f\\]\\{8\\}-\\[0-9a-f\\]\\{4\\}-\\[0-9a-f\\]\\{4\\}-\\[0-9a-f\\]\\{4\\}-\\[0-9a-f\\]\\{12\\}\\$'`, "i"), sql, `${f} must be a valid UUID`);
  }
  // outcome ⟷ id consistency, one closed rule per outcome
  const consistency = [
    ["suppression_created", "string", "string"], ["user_stop_reversed", "string", "string"],
    ["user_stop_already_active", "null", "string"], ["stronger_suppression_preserved", "null", "string"],
    ["no_reversible_user_stop", "null", "null"],
  ];
  for (const [outcome, ev, su] of consistency) {
    has(new RegExp(`when '${outcome}'\\s+then jsonb_typeof\\(p_item -> 'event_id'\\) = '${ev}'\\s+and jsonb_typeof\\(p_item -> 'suppression_id'\\) = '${su}'`, "i"), sql,
      `${outcome} → event_id ${ev}, suppression_id ${su}`);
  }
  // default-deny: the arm CLOSING the consistency CASE must be `else false` (pinned to the last WHEN arm,
  // so the outer `else false` of the item guard cannot stand in for it)
  has(/and jsonb_typeof\(p_item -> 'suppression_id'\) = 'null'\s*else false\s*end/i, sql, "an unknown outcome is invalid (default-deny)");
  // A NULL is NOT false: `if not NULL then` never fires, so a NULL-returning validator would let a
  // malformed receipt replay. Both validators must coalesce to false.
  has(/select coalesce\(\s*case jsonb_typeof\(p_results\)/i, sql, "the results validator returns false, never NULL");
  has(/select coalesce\(\s*case jsonb_typeof\(p_item\)/i, sql, "the item validator returns false, never NULL");
});
check("65. SQL: a malformed receipt row cannot be INSERTED (CHECK constraint), and the RPC still re-validates", () => {
  const sql = sqlCode();
  has(/constraint ck_consent_command_receipt_scope_results check \(\s*octet_length\(scope_results::text\) <= 4096\s*and public\.communication_consent_receipt_results_valid\(scope_results\)\)/i, sql,
    "the receipt CHECK constraint enforces the validator");
  const enforced = (sql.match(/communication_consent_receipt_results_valid\(scope_results\)/gi) || []).length;
  assert(enforced === 2, `the CHECK is declared inline AND added idempotently (expected 2 enforcement sites, got ${enforced})`);
  has(/not\s+public\.communication_consent_receipt_results_valid\(v_r_scope\)/i, sql, "the RPC re-validates defensively before replay");
  has(/revoke all on function public\.communication_consent_receipt_results_valid\(jsonb\) from public/i, sql, "validator least-privilege");
});

// ============================================================================
// STATIC WRITER INVARIANTS + BOUNDARIES (35-36)
// ============================================================================
check("35. writer is read/derive-only, sends nothing, wires nothing", () => {
  const code = writerCode();
  hasNot(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/, code, "no direct table write");
  hasNot(/sendTemplateMessage|sendAuthenticationMessage|CommunicationService|\.send\(/, code, "no send integration");
  hasNot(/graph\.facebook|whatsAppCloud|\bn8n\b|emitEvent/i, code, "no Meta/n8n wiring");
  hasNot(/metaWhatsAppWebhookService|route\.ts|webhook/i, code, "no webhook/route import");
  has(/adminClient\(\)\.rpc\("apply_communication_consent_command"/, code, "single RPC touchpoint");
  has(/CONSENT_POLICY_VERSION/, code, "policy version from code");
  hasNot(/policyVersion:\s*input/, code, "policyVersion never from input");
});
check("36. D2-C stays read-only + unchanged; webhook does not import the writer", () => {
  const d2c = stripTs(readF(D2C_SVC_SRC));
  hasNot(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/, d2c, "D2-C remains read-only");
  const webhook = stripTs(readF(WEBHOOK_SVC_SRC));
  hasNot(/communicationConsentWriterService|writeConsentCommand/, webhook, "webhook does not import the writer");
});

// ============================================================================
// PHASE BOUNDARY (37) + WIRING/DOC (50)
// ============================================================================
check("37. two-mode phase boundary (pre-commit worktree | post-commit CUMULATIVE base..HEAD delta)", () => {
  if (headSha() === D2D_BASE) {
    // PRE-COMMIT: no D2-D commit exists yet — the worktree IS the whole delta (base is trivially HEAD).
    const problems = validateD2DScope(gitDirty(), true);
    assert(problems.length === 0, `pre-commit D2-D delta violation: ${problems.join(" | ")}`);
    return;
  }
  const { baseIsAncestor, commits, messages, cumulative, perCommit, union } = d2dCumulativeDelta();
  assert(baseIsAncestor, `the D2-D base ${D2D_BASE} must be an ancestor of HEAD`);
  assert(commits.length >= 1, "HEAD must be ahead of the D2-D base");
  // EVERY commit in the cumulative range is D2-D work — no foreign commit rides along.
  for (const m of messages) assert(/^Phase 5F-D2-D:/.test(m), `every commit after the base must be 'Phase 5F-D2-D:' (got '${m.slice(0, 60)}')`);
  // The delta is CUMULATIVE, not first-commit-only: it must cover every file touched by EVERY commit in
  // the range. (A seventh file added by a LATER correction commit is invisible to a first-commit check.)
  const cum = new Set(cumulative);
  for (const files of perCommit) {
    for (const f of files) assert(cum.has(f), `the cumulative delta must cover every commit's files (missing ${f})`);
  }
  // ...and the uncommitted worktree is folded in, so an in-flight correction cannot escape the six either.
  const problems = validateD2DScope(union, baseIsAncestor);
  assert(problems.length === 0, `cumulative D2-D scope violation: ${problems.join(" | ")}`);
});
check("50. wiring: script + policy reuse + doc topics", () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:d2d"] === "node scripts/phase5f-d2d-consent-command-writer-harness.mjs", "d2d script wired");
  has(/CONSENT_POLICY_VERSION = "qf-consent-v1"/, readF(POLICY_SRC), "policy constant reused");
  for (const f of [COMMAND_SRC, WRITER_SRC, MIGRATION_SRC, DOC_SRC]) assert(existsSync(f), `${f} exists`);
  const doc = readF(DOC_SRC);
  for (const topic of [
    /QuickFurno Core/i, /STOP/, /START/, /HELP/, /help_acknowledged/, /marketing.*transactional/i,
    /suppression-only|no preference/i, /receipt/i, /idempoten/i, /replay/i, /conflict/i,
    /expir|effective activity/i, /lock/i, /transaction/i, /read.only|D2-C/i, /Meta.*disabled/i,
    /migration.history|drift/i, /not auto-applied|do not apply/i, /privacy|hash/i, /authentication|OTP/i,
    /policy[_ ]version/i, /CHECK constraint/i, /outcome ⟷ id consistency|outcome.*id consistency/i,
    /validated \*\*in SQL\*\*|in SQL, not only in TypeScript/i, /IMMUTABLE/,
    /fail-closed type guard/i, /jsonb_array_length/, /explicitly present|absent key is never/i,
  ]) has(topic, doc, `doc covers ${topic}`);
  // The doc must describe the migration's ACTUAL contents: 1 receipt table + 2 validator functions +
  // 1 SECURITY DEFINER RPC — and must NOT claim it adds only a function or changes no table.
  has(/one new\*\* processing\/idempotency \*\*receipt table|\*\*one new\*\*.*receipt table/i, doc, "doc: one new receipt table");
  has(/\*\*two new IMMUTABLE\*\*.*validator functions/i, doc, "doc: two new validator functions");
  has(/\*\*one new SECURITY DEFINER\*\*.*writer RPC/i, doc, "doc: one new SECURITY DEFINER writer RPC");
  has(/does not alter any pre-existing consent table, column, enum or index/i, doc, "doc: alters no pre-existing consent table/column/enum/index");
  hasNot(/additive \(one\s*\n?`create or replace function` \+ grants; no table/i, doc, "doc no longer claims 'one function, no table change'");
  // ...and the doc's claim is TRUE of the real migration source.
  const sql = sqlCode();
  assert((sql.match(/create table if not exists public\./gi) || []).length === 1, "the migration adds exactly one table");
  assert((sql.match(/create or replace function public\./gi) || []).length === 3, "the migration adds exactly three functions (2 validators + 1 RPC)");
  hasNot(/alter table public\.communication_(consent_events|suppressions|preferences)\b/i, sql, "no DDL against a pre-existing consent table");
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutationChecks = [];
function tsMutation(name, from, to, scenario) { mutationChecks.push({ name, kind: "ts", edits: [{ file: WRITER_SRC, from, to }], scenario }); }
function srcMutation(name, file, from, to, scenario) { mutationChecks.push({ name, kind: "src", edits: [{ file, from, to }], scenario }); }
function fnMutation(name, scenario) { mutationChecks.push({ name, kind: "fn", scenario }); }

tsMutation("MUT A: STOP aggregation always reports already-effective",
  'const changed = scopeResults.some((s) => s.outcome === "suppression_created");',
  'const changed = false && scopeResults.some((s) => s.outcome === "suppression_created");',
  async (mm) => { const { r } = await runW(mm, input("stop")); return r.ok && r.result !== "stop_applied"; });

tsMutation("MUT B: START collapses partial to applied",
  'if (reversed && stronger) return "start_partially_applied";',
  'if (reversed && stronger) return "start_applied";',
  async (mm) => { const store = newStore(); pushSupp(store, "marketing", "user_stop"); pushSupp(store, "transactional", "provider_block");
    const { r } = await runW(mm, input("start"), store); return r.ok && r.result !== "start_partially_applied"; });

tsMutation("MUT C: HELP routed through the RPC (short-circuit removed)",
  'if (input.command === "help") return success("help_acknowledged", false, []);',
  'if (false) return success("help_acknowledged", false, []);',
  async (mm) => { const { r, deps } = await runW(mm, input("help")); return deps.calls.rpc > 0 || !(r.ok && r.result === "help_acknowledged"); });

tsMutation("MUT D: unsupported routed through the RPC (short-circuit removed)",
  'if (input.command === "unsupported") return success("unsupported_command", false, []);',
  'if (false) return success("unsupported_command", false, []);',
  async (mm) => { const { r, deps } = await runW(mm, input("unsupported")); return deps.calls.rpc > 0 || !(r.ok && r.result === "unsupported_command"); });

tsMutation("MUT E: writer swallows an RPC failure as success",
  "if (rpc.ok === false) return failure(rpc.code);",
  'if (rpc.ok === false) return success("stop_applied", false, []);',
  async (mm) => { const store = newStore(); const pmid = nextPmid();
    await runW(mm, input("stop", { providerMessageId: pmid }), store);
    const { r } = await runW(mm, input("start", { providerMessageId: pmid }), store);
    return !(r.ok === false && r.code === "WRITER_CONFLICT"); });

tsMutation("MUT F: writer echoes the destination hash",
  "return success(result, rpc.replayed, rpc.scopeResults);",
  "return { ...success(result, rpc.replayed, rpc.scopeResults), destinationHash: input.destinationHash };",
  async (mm) => { const { r } = await runW(mm, input("stop")); return safeStringify(r).includes(HASH); });

tsMutation("MUT G: destination-hash validation dropped (invalid input reaches the RPC)",
  'if (typeof input.destinationHash !== "string" || !HEX64.test(input.destinationHash)) return false;',
  "if (false) return false;",
  async (mm) => { const { deps } = await runW(mm, input("stop", { destinationHash: "xyz" })); return deps.calls.rpc > 0; });

tsMutation("MUT H: strict-timestamp validation dropped (malformed occurredAt reaches the RPC)",
  'if (typeof input.occurredAt !== "string" || !isStrictRfc3339(input.occurredAt)) return false;',
  "if (false) return false;",
  async (mm) => { const { deps } = await runW(mm, input("stop", { occurredAt: "2026-07-11T10:30:00" })); return deps.calls.rpc > 0; });

// ---- normalizeRpcResult hardening mutations -------------------------------------------------
tsMutation("MUT I: normalizeRpcResult drops the exactly-two-scope check",
  "if (!Array.isArray(rawScopes) || rawScopes.length !== SCOPE_ORDER.length) return { ok: false, code: \"WRITER_INTEGRITY_VIOLATION\" };",
  "if (!Array.isArray(rawScopes)) return { ok: false, code: \"WRITER_INTEGRITY_VIOLATION\" };",
  async (mm) => mm.Service.normalizeRpcResult({ ok: true, replayed: false, scope_results: [{ scope: "marketing", outcome: "no_reversible_user_stop", event_id: null, suppression_id: null }] }).ok === true);

tsMutation("MUT J: normalizeRpcResult drops the boolean-replayed check",
  'if (d.ok !== true || typeof d.replayed !== "boolean") return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };',
  'if (d.ok !== true) return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };',
  async (mm) => mm.Service.normalizeRpcResult({ ok: true, replayed: "yes", scope_results: [
    { scope: "marketing", outcome: "no_reversible_user_stop", event_id: null, suppression_id: null },
    { scope: "transactional", outcome: "no_reversible_user_stop", event_id: null, suppression_id: null }] }).ok === true);

tsMutation("MUT K: normalizeRpcResult drops outcome/id consistency",
  "if (needsEvent ? eventId === null : eventId !== null) return { ok: false, code: \"WRITER_INTEGRITY_VIOLATION\" };",
  "if (false) return { ok: false, code: \"WRITER_INTEGRITY_VIOLATION\" };",
  async (mm) => mm.Service.normalizeRpcResult({ ok: true, replayed: false, scope_results: [
    { scope: "marketing", outcome: "suppression_created", event_id: null, suppression_id: UUID },
    { scope: "transactional", outcome: "no_reversible_user_stop", event_id: null, suppression_id: null }] }).ok === true);

tsMutation("MUT L: normalizeRpcResult drops the deterministic-order/scope check",
  "if (scope !== SCOPE_ORDER[i]) return { ok: false, code: \"WRITER_INTEGRITY_VIOLATION\" };",
  "if (false) return { ok: false, code: \"WRITER_INTEGRITY_VIOLATION\" };",
  async (mm) => mm.Service.normalizeRpcResult({ ok: true, replayed: false, scope_results: [
    { scope: "marketing", outcome: "no_reversible_user_stop", event_id: null, suppression_id: null },
    { scope: "marketing", outcome: "no_reversible_user_stop", event_id: null, suppression_id: null }] }).ok === true);

// ---- SQL source mutations (static guards) ---------------------------------------------------
srcMutation("MUT M: RPC scope set widened to include 'global'", MIGRATION_SRC,
  "array['marketing', 'transactional']; -- P1",
  "array['marketing', 'transactional', 'global']; -- P1",
  () => /'global'/i.test(sqlCode()));

srcMutation("MUT N: START reversal loses its user_stop guard", MIGRATION_SRC,
  "elsif v_active_reason = 'user_stop' then v_outcome := 'user_stop_reversed';",
  "elsif true then v_outcome := 'user_stop_reversed';",
  () => !/'no_reversible_user_stop'\s*;\s*elsif\s+v_active_reason\s*=\s*'user_stop'\s+then\s+v_outcome\s*:=\s*'user_stop_reversed'/i.test(sqlCode()));

srcMutation("MUT O: RPC gains a communication_preferences write", MIGRATION_SRC,
  "  -- ── 10. SANITIZED RESULT",
  "  insert into public.communication_preferences (id) values (gen_random_uuid());\n  -- ── 10. SANITIZED RESULT",
  () => /(insert\s+into|update|from)\s+public\.communication_preferences/i.test(sqlCode()));

srcMutation("MUT P: RPC command/destination conflict detection removed", MIGRATION_SRC,
  "    if v_r_cmd is distinct from p_command\n       or v_r_dest is distinct from p_destination_hash\n       or v_r_policy is distinct from p_policy_version then",
  "    if false then",
  () => !/v_r_cmd\s+is\s+distinct\s+from\s+p_command\s+or\s+v_r_dest\s+is\s+distinct\s+from\s+p_destination_hash/i.test(sqlCode()));

srcMutation("MUT Q: effective-activity expiry guard removed", MIGRATION_SRC,
  "if found and v_active_expires is not null and v_active_expires <= v_evaluated_at then",
  "if false then",
  () => !/v_active_expires\s+is\s+not\s+null\s+and\s+v_active_expires\s*<=\s*v_evaluated_at/i.test(sqlCode()));

srcMutation("MUT R: lock order swapped (destination before provider-event)", MIGRATION_SRC,
  "  perform pg_advisory_xact_lock(hashtextextended('evt|' || p_provider || '|' || p_provider_message_id || '|' || p_channel, 0));\n  perform pg_advisory_xact_lock(hashtextextended('dst|' || p_destination_hash || '|' || p_channel, 0));",
  "  perform pg_advisory_xact_lock(hashtextextended('dst|' || p_destination_hash || '|' || p_channel, 0));\n  perform pg_advisory_xact_lock(hashtextextended('evt|' || p_provider || '|' || p_provider_message_id || '|' || p_channel, 0));",
  () => { const sql = sqlCode(); const e = sql.indexOf("'evt|'"); const d = sql.indexOf("'dst|'"); return !(e > 0 && d > e); });

srcMutation("MUT S: RPC provider allowlist widened", MIGRATION_SRC,
  "or p_provider is null or p_provider not in ('meta_whatsapp', 'exotel_sms', 'system')",
  "or p_provider is null or p_provider not in ('meta_whatsapp', 'exotel_sms', 'system', 'twilio')",
  () => /'twilio'/i.test(sqlCode()));

srcMutation("MUT T: RPC bounded-identifier regex loosened", MIGRATION_SRC,
  "c_ident constant text := '^[A-Za-z0-9._:-]{1,200}$';",
  "c_ident constant text := '^.{0,4000}$';",
  () => !/c_ident\s+constant\s+text\s*:=\s*'\^\[A-Za-z0-9\._:-\]\{1,200\}\$'/i.test(sqlCode()));

srcMutation("MUT U: receipt write removed", MIGRATION_SRC,
  "    insert into public.communication_consent_command_receipts (\n      provider, provider_message_id, channel, destination_hash, normalized_command, policy_version, scope_results\n    ) values (\n      p_provider, p_provider_message_id, p_channel, p_destination_hash, p_command, p_policy_version, v_scope_results\n    );",
  "    perform 1;",
  () => !/insert into public\.communication_consent_command_receipts/i.test(sqlCode()));

srcMutation("MUT V: replay re-derives ids instead of returning the stored receipt", MIGRATION_SRC,
  "return jsonb_build_object('ok', true, 'replayed', true, 'scope_results', v_r_scope);",
  "return jsonb_build_object('ok', true, 'replayed', true, 'scope_results', v_scope_results);",
  () => !/'replayed',\s*true,\s*'scope_results',\s*v_r_scope/i.test(sqlCode()));

srcMutation("MUT W: RPC security definer weakened to invoker", MIGRATION_SRC,
  "security definer", "security invoker",
  () => !/security\s+definer/i.test(sqlCode()));

srcMutation("MUT X: receipt public-revoke removed", MIGRATION_SRC,
  "revoke all on table public.communication_consent_command_receipts from public;",
  "revoke all on table public.communication_consent_command_receipts from public_removed;",
  () => !/revoke all on table public\.communication_consent_command_receipts from public;/i.test(sqlCode()));

// ---- receipt POLICY BINDING + SQL-side structural validation mutations ----------------------
srcMutation("MUT AB: the receipt lookup stops selecting the stored policy_version", MIGRATION_SRC,
  "  select destination_hash, normalized_command, policy_version, scope_results\n    into v_r_dest, v_r_cmd, v_r_policy, v_r_scope",
  "  select destination_hash, normalized_command, scope_results\n    into v_r_dest, v_r_cmd, v_r_scope",
  () => !/select\s+destination_hash,\s*normalized_command,\s*policy_version,\s*scope_results/i.test(sqlCode()));

srcMutation("MUT AC: the receipt POLICY-VERSION comparison is removed (a stale-policy receipt would replay)", MIGRATION_SRC,
  "       or v_r_policy is distinct from p_policy_version then",
  "       or false then",
  () => !/or\s+v_r_policy\s+is\s+distinct\s+from\s+p_policy_version/i.test(sqlCode()));

srcMutation("MUT AD: the missing-stored-policy integrity guard is removed", MIGRATION_SRC,
  "    if v_r_cmd is null or v_r_dest is null or v_r_policy is null",
  "    if v_r_cmd is null or v_r_dest is null",
  () => !/v_r_policy\s+is\s+null/i.test(sqlCode()));

srcMutation("MUT AE: the RPC defers scope_results validation to TypeScript (no SQL check before replay)", MIGRATION_SRC,
  "       or not public.communication_consent_receipt_results_valid(v_r_scope) then",
  "       or false then",
  () => !/not\s+public\.communication_consent_receipt_results_valid\(v_r_scope\)/i.test(sqlCode()));

srcMutation("MUT AF: the receipt SCOPE-ORDER validation is removed (duplicate / transactional-first passes)", MIGRATION_SRC,
  "               then public.communication_consent_receipt_scope_result_valid(p_results -> 0, 'marketing')\n                and public.communication_consent_receipt_scope_result_valid(p_results -> 1, 'transactional')",
  "               then true",
  () => !/communication_consent_receipt_scope_result_valid\(p_results\s*->\s*1,\s*'transactional'\)/i.test(sqlCode()));

srcMutation("MUT AG: the receipt UUID validation is removed (an arbitrary id string would replay)", MIGRATION_SRC,
  "        and (jsonb_typeof(p_item -> 'event_id') = 'null'\n             or (p_item ->> 'event_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')\n        and (jsonb_typeof(p_item -> 'suppression_id') = 'null'\n             or (p_item ->> 'suppression_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')",
  "        and true",
  () => !/\(p_item ->> 'event_id'\) ~\*/i.test(sqlCode()) || !/\(p_item ->> 'suppression_id'\) ~\*/i.test(sqlCode()));

srcMutation("MUT AH: the suppression_created outcome/ID consistency rule is removed", MIGRATION_SRC,
  "              when 'suppression_created'            then jsonb_typeof(p_item -> 'event_id') = 'string'\n                                                     and jsonb_typeof(p_item -> 'suppression_id') = 'string'",
  "              when 'suppression_created'            then true",
  () => !/when 'suppression_created'\s+then jsonb_typeof\(p_item -> 'event_id'\) = 'string'/i.test(sqlCode()));

srcMutation("MUT AI: the user_stop_already_active outcome/ID consistency rule is removed", MIGRATION_SRC,
  "              when 'user_stop_already_active'       then jsonb_typeof(p_item -> 'event_id') = 'null'\n                                                     and jsonb_typeof(p_item -> 'suppression_id') = 'string'",
  "              when 'user_stop_already_active'       then true",
  () => !/when 'user_stop_already_active'\s+then jsonb_typeof\(p_item -> 'event_id'\) = 'null'/i.test(sqlCode()));

srcMutation("MUT AJ: the outcome/ID consistency default-deny is opened (an unknown outcome would replay)", MIGRATION_SRC,
  "              else false\n            end\n      else false",
  "              else true\n            end\n      else false",
  () => !/and jsonb_typeof\(p_item -> 'suppression_id'\) = 'null'\s*else false\s*end/i.test(sqlCode()));

srcMutation("MUT AK: the receipt CHECK constraint no longer enforces the validator", MIGRATION_SRC,
  "  constraint ck_consent_command_receipt_scope_results check (\n    octet_length(scope_results::text) <= 4096\n    and public.communication_consent_receipt_results_valid(scope_results))",
  "  constraint ck_consent_command_receipt_scope_results check (\n    octet_length(scope_results::text) <= 4096)",
  () => (sqlCode().match(/communication_consent_receipt_results_valid\(scope_results\)/gi) || []).length !== 2);

// CORRECTION 1 — the fail-closed JSON type guard must NOT degrade to boolean evaluation order.
srcMutation("MUT AL: the results type guard degrades to `and` (jsonb_array_length could RAISE on a non-array)", MIGRATION_SRC,
  "  select coalesce(\n    case jsonb_typeof(p_results)\n      when 'array' then\n        case when jsonb_array_length(p_results) = 2\n               then public.communication_consent_receipt_scope_result_valid(p_results -> 0, 'marketing')\n                and public.communication_consent_receipt_scope_result_valid(p_results -> 1, 'transactional')\n             else false\n        end\n      else false\n    end,",
  "  select coalesce(\n    jsonb_typeof(p_results) = 'array'\n    and jsonb_array_length(p_results) = 2\n    and public.communication_consent_receipt_scope_result_valid(p_results -> 0, 'marketing')\n    and public.communication_consent_receipt_scope_result_valid(p_results -> 1, 'transactional'),",
  () => !/case jsonb_typeof\(p_results\)\s*when 'array' then/i.test(sqlCode())
     || /jsonb_typeof\(p_results\)\s*=\s*'array'\s*and\s+jsonb_array_length/i.test(sqlCode()));

srcMutation("MUT AM: the item type guard no longer requires a JSON object (a non-object item would validate)", MIGRATION_SRC,
  "    case jsonb_typeof(p_item)\n      when 'object' then",
  "    case jsonb_typeof(p_item)\n      when 'array' then",
  () => !/case jsonb_typeof\(p_item\)\s*when 'object' then/i.test(sqlCode()));

// Both coalesce wrappers gone → a missing key inside the object branch yields NULL, and `if not NULL`
// falls through, so a malformed receipt would REPLAY. Only removing BOTH breaks it — hence one mutation.
mutationChecks.push({
  name: "MUT AN: BOTH validator coalesce guards removed (the validator could return NULL, not false)",
  kind: "src",
  edits: [
    { file: MIGRATION_SRC, from: "  select coalesce(\n    case jsonb_typeof(p_results)", to: "  select (\n    case jsonb_typeof(p_results)" },
    { file: MIGRATION_SRC, from: "  select coalesce(\n    case jsonb_typeof(p_item)", to: "  select (\n    case jsonb_typeof(p_item)" },
  ],
  scenario: () => !/select coalesce\(\s*case jsonb_typeof\(p_results\)/i.test(sqlCode())
              && !/select coalesce\(\s*case jsonb_typeof\(p_item\)/i.test(sqlCode()),
});

// CORRECTION 2 — the TypeScript boundary must independently require the id keys to be PRESENT.
tsMutation("MUT AO: normalizeRpcResult coerces an ABSENT id key to null and ignores alias conflicts",
  `function readIdField(s: Record<string, unknown>, snake: string, camel: string): string | null | typeof ID_INVALID {
  const hasSnake = Object.prototype.hasOwnProperty.call(s, snake);
  const hasCamel = Object.prototype.hasOwnProperty.call(s, camel);
  if (!hasSnake && !hasCamel) return ID_INVALID;                            // absent → never becomes null
  if (hasSnake && hasCamel && !Object.is(s[snake], s[camel])) return ID_INVALID; // aliases disagree
  const v = hasSnake ? s[snake] : s[camel];
  if (v === null) return null;                                              // explicit null stays null
  if (typeof v !== "string" || !UUID_SHAPE.test(v)) return ID_INVALID;
  return v;
}`,
  `function readIdField(s: Record<string, unknown>, snake: string, camel: string): string | null | typeof ID_INVALID {
  const v = (s[camel] ?? s[snake]) ?? null;
  if (v === null) return null;
  if (typeof v !== "string" || !UUID_SHAPE.test(v)) return ID_INVALID;
  return v;
}`,
  async (mm) => {
    const N = mm.Service.normalizeRpcResult;
    const T = { scope: "transactional", outcome: "no_reversible_user_stop", event_id: null, suppression_id: null };
    // an ABSENT event_id key must NOT be read as an explicit null for a null-permitting outcome
    const absent = N({ ok: true, replayed: false, scope_results: [{ scope: "marketing", outcome: "no_reversible_user_stop", suppression_id: null }, T] });
    // contradictory aliases must NOT be silently resolved to one of them
    const conflict = N({ ok: true, replayed: false, scope_results: [
      { scope: "marketing", outcome: "suppression_created", event_id: UUID, eventId: UUID_B, suppression_id: UUID, suppressionId: UUID }, T] });
    return absent.ok === true || conflict.ok === true;
  });

fnMutation("MUT Y: a seventh file added by ANY later cumulative correction commit is rejected",
  () => {
    // a 7th file anywhere in base..HEAD (env, route, webhook, unrelated service, second migration, other)
    const smuggled = ["services/somethingElse.ts", ".env.local", "app/api/consent/route.ts",
      "services/metaWhatsAppWebhookService.ts", "supabase/migrations/20260713000000_other.sql", "lib/random.ts"];
    return smuggled.every((f) => validateD2DScope([...D2D_EXPECTED_FILES, f], true).length > 0);
  });
fnMutation("MUT Z: a cumulative delta modifying the D2-C service is rejected",
  () => validateD2DScope([...D2D_EXPECTED_FILES, D2C_SVC_SRC], true).length > 0
     && validateD2DScope(D2D_EXPECTED_FILES.filter((f) => f !== WRITER_SRC).concat(D2C_SVC_SRC), true).length > 0);
fnMutation("MUT AA: a D2-D base that is NOT an ancestor of HEAD is rejected (the delta is unmeasurable)",
  () => validateD2DScope(D2D_EXPECTED_FILES, false).length > 0
     && validateD2DScope(D2D_EXPECTED_FILES, true).length === 0); // ...and the honest six still pass

// ============================================================================
// RUNNER
// ============================================================================
async function runW(mm, inp, store = newStore(), over = {}) {
  const calls = { rpc: 0 };
  const deps = {
    now: over.now ?? NOW,
    applyConsentCommand: over.applyConsentCommand ?? (async (args) => { calls.rpc++; if (over.rpcThrows) throw new Error("db down"); return mm.Service.normalizeRpcResult(simApplyRawJson(store, toP(args))); }),
  };
  const r = await mm.Service.writeConsentCommand(inp, deps);
  return { r, deps: { calls }, store };
}
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-D2-D consent command writer checks...\n");
  for (const c of checks) { try { await c.fn(); console.log(`PASS ${c.name}`); passed++; } catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; } }
  return { passed, failed };
}
async function suiteGoesRed() { for (const c of checks) { try { await c.fn(); } catch { return true; } } return false; }
async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5F-D2-D mutation tests...\n");
  for (const mut of mutationChecks) {
    if (mut.kind === "fn") {
      try { const caught = await mut.scenario(); if (caught) { console.log(`PASS ${mut.name}`); passed++; } else { console.log(`FAIL ${mut.name} (guard not load-bearing)`); failed++; } }
      catch (e) { console.log(`FAIL ${mut.name}`); console.error(e); failed++; }
      continue;
    }
    const mutDir = resolve(`.phase5fd2d-mut-${mutationChecks.indexOf(mut)}`);
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
