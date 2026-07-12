import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5F-D2-D — controlled transactional communication-consent WRITER.
 *
 * The writer service is transpiled with a STUBBED Supabase (adminClient throws — real Supabase must
 * never run) and driven through an INJECTED RPC dependency + an INJECTED clock. The RPC's transaction,
 * locking, replay/conflict and evidence↔projection atomicity live in the SECURITY DEFINER SQL; the
 * harness exercises the writer end-to-end against a FAITHFUL in-memory reference implementation of that
 * SQL state machine (`simApplyRawJson`), and independently asserts the SQL's invariants statically on
 * the real migration source. Mutations edit the real writer (recompiled) or the real SQL and must be
 * caught, restoring every file byte-identically afterwards.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const TS_FILES = ["lib/communication/consentPolicy.ts", "lib/communication/consentCommand.ts"];
const WRITER_SRC = "services/communicationConsentWriterService.ts";
const COMMAND_SRC = "lib/communication/consentCommand.ts";
const POLICY_SRC = "lib/communication/consentPolicy.ts";
const MIGRATION_SRC = "supabase/migrations/20260712000300_communication_consent_command_writer_rpc.sql";
const DOC_SRC = "docs/QF-Consent-Command-Writer-Phase-5F-D2-D.md";
const HARNESS_SRC = "scripts/phase5f-d2d-consent-command-writer-harness.mjs";
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

/** PURE validator: exactly the six D2-D files + correct parent; its own migration only; no
 *  D2-C/D2-B service edit, no route/webhook/env/lockfile, no unrelated service. */
function validateD2DHistoricalDelta(files, parent) {
  const problems = [];
  const set = new Set(files);
  if (files.length !== D2D_EXPECTED_FILES.length) problems.push(`expected ${D2D_EXPECTED_FILES.length} files, got ${files.length} [${files.join(", ")}]`);
  for (const f of D2D_EXPECTED_FILES) if (!set.has(f)) problems.push(`missing approved D2-D file: ${f}`);
  for (const f of files) if (!D2D_EXPECTED_FILES.includes(f)) problems.push(`unexpected file in the D2-D delta: ${f}`);
  if (parent !== D2D_BASE) problems.push(`expected parent ${D2D_BASE}, got ${parent}`);
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
function d2dHistoricalCommit() {
  const revs = execFileSync("git", ["rev-list", "--first-parent", "--ancestry-path", `${D2D_BASE}..HEAD`], { encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean);
  if (revs.length === 0) throw new Error("D2-D historical commit unresolvable: HEAD is not ahead of the D2-D base on the first-parent chain");
  const commit = revs[revs.length - 1];
  const parent = execFileSync("git", ["rev-parse", `${commit}^`], { encoding: "utf8" }).trim();
  const files = execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", commit], { encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean).map((p) => p.replace(/\\/g, "/"));
  const message = execFileSync("git", ["log", "-1", "--format=%s", commit], { encoding: "utf8" }).trim();
  return { commit, parent, files, message };
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
const EVIDENCE_OUTCOMES = ["suppression_created", "user_stop_reversed"];

function newStore() { return { events: [], suppressions: [], failOn: null }; }

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
      || !a.p_provider || !a.p_provider_message_id
      || !SIM_TS.test(a.p_occurred_at || "") || !SIM_TS.test(a.p_received_at || "")) {
    return { ok: false, code: "INVALID_WRITER_INPUT" };
  }
  const scopes = ["marketing", "transactional"];
  const group = store.events.filter((e) => e.provider === a.p_provider && e.provider_message_id === a.p_provider_message_id
    && e.channel === a.p_channel && e.evidence_type === "inbound_command" && e.target_type === "suppression");
  if (group.length > 0) {
    const ncs = new Set(group.map((e) => e.metadata_sanitized.nc));
    const sos = new Set(group.map((e) => JSON.stringify(e.metadata_sanitized.so)));
    if (ncs.size > 1 || sos.size > 1) return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };
    const so = group[0].metadata_sanitized.so;
    const expected = Object.keys(so).filter((k) => EVIDENCE_OUTCOMES.includes(so[k])).sort();
    const actual = [...new Set(group.map((e) => e.scope))].sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };
    if (group[0].metadata_sanitized.nc !== a.p_command) return { ok: false, code: "WRITER_CONFLICT" };
    const scope_results = scopes.map((scope) => {
      const evt = group.find((e) => e.scope === scope);
      const supp = store.suppressions.filter((s) => s.destination_hash === a.p_destination_hash && s.channel === a.p_channel && s.scope === scope)
        .sort((x, y) => (y.suppressed_at || "").localeCompare(x.suppressed_at || ""))[0];
      return { scope, outcome: so[scope], event_id: evt ? evt.id : null, suppression_id: supp ? supp.id : null };
    });
    return { ok: true, replayed: true, scope_results };
  }
  // fresh — decide per scope
  const decisions = []; const outcomeMap = {};
  for (const scope of scopes) {
    const active = store.suppressions.find((s) => s.destination_hash === a.p_destination_hash && s.channel === a.p_channel && s.scope === scope && s.is_active === true);
    let outcome;
    if (a.p_command === "stop") outcome = !active ? "suppression_created" : active.reason === "user_stop" ? "user_stop_already_active" : "stronger_suppression_preserved";
    else outcome = !active ? "no_reversible_user_stop" : active.reason === "user_stop" ? "user_stop_reversed" : "stronger_suppression_preserved";
    decisions.push({ scope, outcome, active });
    outcomeMap[scope] = outcome;
  }
  const meta = { nc: a.p_command, so: outcomeMap };
  if (a.p_correlation_id != null) meta.corr = a.p_correlation_id;
  if (a.p_causation_id != null) meta.caus = a.p_causation_id;
  meta.rcv = a.p_received_at;
  // build effects into buffers; commit only if no injected failure (models the atomic transaction)
  const newEvents = []; const newSupps = []; const updates = []; const scope_results = [];
  for (const d of decisions) {
    if (d.outcome === "suppression_created") {
      if (store.failOn === "evidence") throw new Error("inject evidence failure");
      const eid = simUuid(); const sid = simUuid();
      if (store.failOn === "projection") throw new Error("inject projection failure");
      newEvents.push({ id: eid, provider: a.p_provider, provider_message_id: a.p_provider_message_id, channel: a.p_channel,
        evidence_type: "inbound_command", target_type: "suppression", scope: d.scope, action: "suppress", reason: "user_stop",
        metadata_sanitized: JSON.parse(JSON.stringify(meta)) });
      newSupps.push({ id: sid, destination_hash: a.p_destination_hash, channel: a.p_channel, scope: d.scope, reason: "user_stop",
        is_active: true, suppressed_at: a.p_received_at, deactivated_at: null, last_event_id: eid });
      scope_results.push({ scope: d.scope, outcome: d.outcome, event_id: eid, suppression_id: sid });
    } else if (d.outcome === "user_stop_reversed") {
      const eid = simUuid();
      newEvents.push({ id: eid, provider: a.p_provider, provider_message_id: a.p_provider_message_id, channel: a.p_channel,
        evidence_type: "inbound_command", target_type: "suppression", scope: d.scope, action: "unsuppress", reason: "user_start",
        metadata_sanitized: JSON.parse(JSON.stringify(meta)) });
      updates.push({ id: d.active.id, eid });
      scope_results.push({ scope: d.scope, outcome: d.outcome, event_id: eid, suppression_id: d.active.id });
    } else {
      scope_results.push({ scope: d.scope, outcome: d.outcome, event_id: null, suppression_id: d.active ? d.active.id : null });
    }
  }
  if (store.failOn === "scope2" && newEvents.length > 0) throw new Error("inject one-scope partial failure");
  store.events.push(...newEvents); store.suppressions.push(...newSupps);
  for (const u of updates) { const s = store.suppressions.find((x) => x.id === u.id); s.is_active = false; s.deactivated_at = a.p_received_at; s.last_event_id = u.eid; }
  return { ok: true, replayed: false, scope_results };
}

// ============================================================================
// FIXTURES
// ============================================================================
const HASH = "a".repeat(64);
const UUID = "11111111-2222-4333-8444-555555555555";
const OCCURRED = "2026-07-11T10:30:00.000Z";
const NOW = () => new Date("2026-07-12T00:00:00.000Z");
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
    input("stop", { destinationHash: "xyz" }),
    input("stop", { destinationHash: "A".repeat(64) }),
    input("stop", { channel: "email" }),
    input("bogus"),
    input("stop", { identityConfidence: "exact", principal: null }),
    input("stop", { identityConfidence: "ambiguous", principal: { type: "client", id: UUID } }),
    input("stop", { principal: { type: "client", id: "not-a-uuid" } }),
    input("stop", { provider: "twilio" }),
    input("stop", { providerMessageId: "" }),
    input("stop", { sourceEventType: "bad type!!" }),
    input("stop", { inboundMessageId: "not-a-uuid" }),
    input("stop", { occurredAt: "2026-07-11T10:30:00" }),   // timezone-less
    input("stop", { occurredAt: "2026-07-11" }),            // date-only
    input("stop", { occurredAt: "2026-02-29T00:00:00Z" }),  // impossible non-leap
    input("stop", { correlationId: "x".repeat(201) }),
  ];
  for (const inp of bad) {
    const { r, deps } = await run(inp);
    assert(r.ok === false && r.code === "INVALID_WRITER_INPUT", `invalid → INVALID_WRITER_INPUT: ${safeStringify(inp).slice(0, 70)}`);
    assert(deps.calls.rpc === 0, "no RPC for invalid input");
  }
});

// ============================================================================
// STOP (3-7)
// ============================================================================
check("3. STOP creates marketing + transactional user_stop suppressions atomically", async () => {
  const { r, store } = await run(input("stop"));
  assert(r.ok && r.result === "stop_applied" && r.replayed === false, "stop_applied");
  assert(r.scopeResults.length === 2 && r.scopeResults.every((s) => s.outcome === "suppression_created"), "both scopes created");
  assert(suppScope(store, "marketing").length === 1 && suppScope(store, "transactional").length === 1, "one active suppression per scope");
  assert(store.events.length === 2 && store.events.every((e) => e.action === "suppress" && e.reason === "user_stop"), "two suppress evidence rows");
  assert(r.eventIds.length === 2 && r.suppressionIds.length === 2, "aggregated ids");
});
check("4. STOP preserves authentication/global (never created)", async () => {
  const { store } = await run(input("stop"));
  assert(store.suppressions.every((s) => s.scope === "marketing" || s.scope === "transactional"), "no global/authentication suppression");
});
check("5. STOP is idempotent — a redelivered event is a stable replay, no duplicate effect", async () => {
  const store = newStore(); const inp = input("stop");
  const first = await run(inp, store);
  const second = await run(inp, store);
  assert(first.r.ok && first.r.result === "stop_applied" && first.r.replayed === false, "first applies");
  assert(second.r.ok && second.r.result === "stop_applied" && second.r.replayed === true, "second is a stable replay");
  assert(activeSupps(store).length === 2 && store.events.length === 2, "no duplicate suppression / evidence");
});
check("6. concurrent identical STOP → one authoritative state (serialized), duplicate replays", async () => {
  const store = newStore(); const inp = input("stop");
  const [a, b] = [await run(inp, store), await run(inp, store)];
  const replayCount = [a, b].filter((x) => x.r.replayed).length;
  assert(a.r.ok && b.r.ok && replayCount === 1, "exactly one authoritative, one replay");
  assert(activeSupps(store).length === 2, "no duplicate active suppression");
});
check("7. STOP preserves a stronger suppression; mixed stronger/missing still stop_applied", async () => {
  const store = newStore();
  store.suppressions.push({ id: simUuid(), destination_hash: HASH, channel: "whatsapp", scope: "marketing", reason: "complaint", is_active: true, suppressed_at: OCCURRED, deactivated_at: null });
  const { r } = await run(input("stop"), store);
  assert(r.ok && r.result === "stop_applied", "transactional created → stop_applied");
  const mkt = r.scopeResults.find((s) => s.scope === "marketing");
  const txn = r.scopeResults.find((s) => s.scope === "transactional");
  assert(mkt.outcome === "stronger_suppression_preserved", "marketing complaint preserved");
  assert(txn.outcome === "suppression_created", "transactional newly created");
  assert(suppScope(store, "marketing")[0].reason === "complaint", "stronger reason not weakened to user_stop");
});
check("7b. STOP when both scopes already user_stop-active → stop_already_effective (no new evidence)", async () => {
  const store = newStore(); const first = await run(input("stop"), store);
  assert(first.r.result === "stop_applied", "first applies");
  const { r } = await run(input("stop"), store); // different event id, already suppressed
  assert(r.ok && r.result === "stop_already_effective", "idempotent by state");
  assert(store.events.length === 2, "no additional evidence written");
});

// ============================================================================
// START (8-14)
// ============================================================================
function seedUserStop(store, scopes = ["marketing", "transactional"], reason = "user_stop") {
  for (const scope of scopes) store.suppressions.push({ id: simUuid(), destination_hash: HASH, channel: "whatsapp", scope, reason, is_active: true, suppressed_at: OCCURRED, deactivated_at: null });
}
check("8. START reverses both user_stop scopes → start_applied", async () => {
  const store = newStore(); seedUserStop(store);
  const { r } = await run(input("start"), store);
  assert(r.ok && r.result === "start_applied", "start_applied");
  assert(r.scopeResults.every((s) => s.outcome === "user_stop_reversed"), "both reversed");
  assert(activeSupps(store).length === 0, "both suppressions deactivated");
  assert(store.suppressions.every((s) => s.deactivated_at !== null), "deactivated_at set");
  assert(store.events.length === 2 && store.events.every((e) => e.action === "unsuppress" && e.reason === "user_start"), "unsuppress evidence");
});
check("9. START reverses one scope, preserves a stronger block in the other → start_partially_applied", async () => {
  const store = newStore(); seedUserStop(store, ["marketing"]);
  store.suppressions.push({ id: simUuid(), destination_hash: HASH, channel: "whatsapp", scope: "transactional", reason: "provider_block", is_active: true, suppressed_at: OCCURRED, deactivated_at: null });
  const { r } = await run(input("start"), store);
  assert(r.ok && r.result === "start_partially_applied", "start_partially_applied");
  assert(suppScope(store, "transactional")[0].reason === "provider_block", "provider_block preserved");
  assert(suppScope(store, "marketing").length === 0, "marketing user_stop reversed");
});
check("10-12. START never clears a stronger suppression (any restrictive reason)", async () => {
  for (const reason of ["provider_block", "hard_bounce", "complaint", "admin", "legal", "abuse", "unspecified"]) {
    const store = newStore(); seedUserStop(store, ["marketing", "transactional"], reason);
    const { r } = await run(input("start"), store);
    assert(r.ok && r.result === "start_blocked_by_stronger_suppression", `${reason} → blocked`);
    assert(activeSupps(store).length === 2 && store.suppressions.every((s) => s.reason === reason && s.is_active), `${reason} not cleared`);
    assert(store.events.length === 0, "no evidence written for a non-reversal");
  }
});
check("13. START with no active suppression → start_no_reversible_stop (no mutation)", async () => {
  const { r, store } = await run(input("start"));
  assert(r.ok && r.result === "start_no_reversible_stop", "no_reversible");
  assert(store.events.length === 0 && store.suppressions.length === 0, "nothing written");
});
check("14. START never creates a preference / marketing opt-in (suppression-only)", async () => {
  const store = newStore(); seedUserStop(store);
  const { r } = await run(input("start"), store);
  assert(r.ok, "ok");
  assert(store.preferences === undefined || store.preferences.length === 0, "no preference store touched");
  hasNot(/communication_preferences/, writerCode(), "writer never references communication_preferences");
  hasNot(/marketing_opt|opt_in|allowed/i, writerCode(), "writer never creates marketing opt-in");
});

// ============================================================================
// HELP / UNSUPPORTED (15-17)
// ============================================================================
check("15-16. HELP → help_acknowledged, NO RPC, NO evidence/projection", async () => {
  const { r, deps, store } = await run(input("help"));
  assert(r.ok && r.result === "help_acknowledged" && r.replayed === false, "help_acknowledged");
  assert(r.scopeResults.length === 0 && r.eventIds.length === 0 && r.suppressionIds.length === 0, "empty arrays");
  assert(deps.calls.rpc === 0 && store.events.length === 0 && store.suppressions.length === 0, "no RPC / no mutation");
});
check("17. unsupported → unsupported_command, NO RPC, NO mutation", async () => {
  const { r, deps, store } = await run(input("unsupported"));
  assert(r.ok && r.result === "unsupported_command", "unsupported_command");
  assert(r.scopeResults.length === 0, "empty arrays");
  assert(deps.calls.rpc === 0 && store.events.length === 0 && store.suppressions.length === 0, "no RPC / no mutation");
});

// ============================================================================
// IDENTITY & PREFERENCE (18-19)
// ============================================================================
check("18. ambiguous/unknown identity → suppression works, no principal passed, no preference", async () => {
  for (const conf of ["ambiguous", "unknown"]) {
    let capturedArgs = null;
    const store = newStore();
    const { r } = await run(input("stop", { identityConfidence: conf, principal: null }), store, {
      applyConsentCommand: async (args) => { capturedArgs = args; return M.Service.normalizeRpcResult(simApplyRawJson(store, toP(args))); },
    });
    assert(r.ok && r.result === "stop_applied", `${conf} STOP applies`);
    assert(capturedArgs.principalType === null && capturedArgs.principalId === null, `${conf} passes no principal`);
  }
});
check("19. exact identity is suppression-only too — no preference write (P2)", async () => {
  const { store } = await run(input("stop", { identityConfidence: "exact", principal: { type: "vendor", id: UUID } }));
  assert(store.preferences === undefined, "no preference store");
  assert(store.suppressions.length === 2, "only suppressions written");
});

// ============================================================================
// TRANSACTIONAL ROLLBACK (20-22)
// ============================================================================
check("20-22. any failure rolls back the ENTIRE command (evidence / projection / one-scope)", async () => {
  for (const failOn of ["evidence", "projection", "scope2"]) {
    const store = newStore(); store.failOn = failOn;
    const { r } = await run(input("stop"), store);
    assert(r.ok === false && r.code === "WRITER_TRANSACTION_FAILED", `${failOn} → WRITER_TRANSACTION_FAILED`);
    assert(store.events.length === 0 && store.suppressions.length === 0, `${failOn} → no partial state`);
  }
});

// ============================================================================
// TIMESTAMP & MISSING IDENTITY FAIL-CLOSED (23-24)
// ============================================================================
check("23. malformed timestamp fails closed (TS) with no RPC; RPC re-validates independently", async () => {
  const { r, deps } = await run(input("stop", { occurredAt: "07/11/2026" }));
  assert(r.ok === false && r.code === "INVALID_WRITER_INPUT" && deps.calls.rpc === 0, "TS rejects, no RPC");
  // the RPC mirror independently rejects a timezone-less value (direct-caller bypass protection)
  const direct = simApplyRawJson(newStore(), { p_policy_version: "qf-consent-v1", p_channel: "whatsapp", p_command: "stop",
    p_destination_hash: HASH, p_provider: "meta_whatsapp", p_provider_message_id: "x", p_occurred_at: "2026-07-11T10:30:00", p_received_at: "2026-07-12T00:00:00Z" });
  assert(direct.ok === false && direct.code === "INVALID_WRITER_INPUT", "RPC mirror rejects timezone-less occurred_at");
});
check("24. missing provider event identity fails closed", async () => {
  const { r, deps } = await run(input("stop", { providerMessageId: "" }));
  assert(r.ok === false && r.code === "INVALID_WRITER_INPUT" && deps.calls.rpc === 0, "missing provider message id → INVALID, no RPC");
});

// ============================================================================
// REPLAY / CONFLICT / INTEGRITY (25-27)
// ============================================================================
check("25. same provider event + same command → stable replay (replayed=true)", async () => {
  const store = newStore(); const inp = input("start"); seedUserStop(store);
  const a = await run(inp, store); const b = await run(inp, store);
  assert(a.r.result === "start_applied" && b.r.result === "start_applied", "same stable result");
  assert(b.r.replayed === true, "second is a replay");
});
check("26. same provider event + different command → WRITER_CONFLICT", async () => {
  const store = newStore(); const pmid = nextPmid();
  const stop = await run(input("stop", { providerMessageId: pmid }), store);
  assert(stop.r.result === "stop_applied", "stop first");
  const start = await run(input("start", { providerMessageId: pmid }), store);
  assert(start.r.ok === false && start.r.code === "WRITER_CONFLICT", "reused event with a different command → conflict");
});
check("27. partial replay group → WRITER_INTEGRITY_VIOLATION", async () => {
  const store = newStore(); const inp = input("stop");
  await run(inp, store);
  store.events.pop(); // corrupt: lose one of the two evidence rows of the group
  const { r } = await run(inp, store);
  assert(r.ok === false && r.code === "WRITER_INTEGRITY_VIOLATION", "a partially-present event group is an integrity violation");
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
  assert(fail.ok === false && fail.code === "WRITER_TRANSACTION_FAILED", "thrown RPC → sanitized transaction failure");
});

// ============================================================================
// normalizeRpcResult (29)
// ============================================================================
check("29. normalizeRpcResult: sanitizes shapes; unknown → integrity, error codes preserved", () => {
  const N = M.Service.normalizeRpcResult;
  assert(N({ ok: true, replayed: false, scope_results: [{ scope: "marketing", outcome: "suppression_created", event_id: null, suppression_id: null }] }).ok === true, "valid success");
  assert(N({ ok: false, code: "WRITER_CONFLICT" }).code === "WRITER_CONFLICT", "conflict preserved");
  assert(N(null).code === "WRITER_INTEGRITY_VIOLATION", "null → integrity");
  assert(N({ ok: true, scope_results: [{ scope: "bogus", outcome: "suppression_created" }] }).code === "WRITER_INTEGRITY_VIOLATION", "bad scope → integrity");
  assert(N({ ok: true, scope_results: [{ scope: "marketing", outcome: "nope" }] }).code === "WRITER_INTEGRITY_VIOLATION", "bad outcome → integrity");
  assert(N({ ok: false, code: "haxx" }).code === "WRITER_INTEGRITY_VIOLATION", "unknown code → integrity");
});

// ============================================================================
// STATIC SQL INVARIANTS (30-33)
// ============================================================================
check("30. RPC is a least-privilege SECURITY DEFINER with a fixed search_path + service_role-only", () => {
  const sql = sqlCode();
  has(/security\s+definer/i, sql, "security definer");
  has(/set\s+search_path\s*=\s*pg_catalog,\s*public/i, sql, "fixed safe search_path");
  has(/revoke\s+all\s+on\s+function[\s\S]*from\s+public/i, sql, "revoke from public");
  has(/revoke\s+all\s+on\s+function[\s\S]*from\s+anon/i, sql, "revoke from anon");
  has(/revoke\s+all\s+on\s+function[\s\S]*from\s+authenticated/i, sql, "revoke from authenticated");
  has(/grant\s+execute\s+on\s+function[\s\S]*to\s+service_role/i, sql, "grant execute to service_role");
  hasNot(/execute\s+format|execute\s+'|execute\s+"/i, sql, "no dynamic SQL");
});
check("31. RPC is append-only + suppression-only + P1 scope-bounded", () => {
  const sql = sqlCode();
  hasNot(/update\s+public\.communication_consent_events|delete\s+from\s+public\.communication_consent_events/i, sql, "never UPDATE/DELETE evidence");
  hasNot(/(insert\s+into|update|delete\s+from|from|join)\s+public\.communication_preferences/i, sql, "never touches communication_preferences (P2)");
  has(/array\[\s*'marketing'\s*,\s*'transactional'\s*\]/i, sql, "scope set is exactly marketing + transactional");
  hasNot(/'authentication'|'global'/i, sql, "never global / authentication (P1)");
  hasNot(/sendTemplateMessage|graph\.facebook|whatsAppCloud|\.send\(|n8n/i, sql, "no send / Meta / n8n in the RPC");
});
check("32. RPC guards: START reverses ONLY user_stop; conflict + integrity + transaction rollback present", () => {
  const sql = sqlCode();
  has(/'no_reversible_user_stop'\s*;\s*elsif\s+v_active_reason\s*=\s*'user_stop'\s+then\s+v_outcome\s*:=\s*'user_stop_reversed'/i, sql, "START reversal guarded by reason = user_stop");
  has(/v_existing_cmd\s+is\s+distinct\s+from\s+p_command[\s\S]*?WRITER_CONFLICT/i, sql, "command-conflict detection");
  has(/v_expected\s+is\s+distinct\s+from\s+v_actual[\s\S]*?WRITER_INTEGRITY_VIOLATION/i, sql, "partial-group integrity guard");
  has(/for\s+update/i, sql, "row locking (FOR UPDATE)");
  has(/pg_advisory_xact_lock/i, sql, "deterministic destination lock");
  has(/exception\s*\n?\s*when\s+unique_violation\s+then/i, sql, "unique-violation → sanitized conflict, subtransaction rollback");
});
check("33. RPC re-validates the strict RFC3339 timestamp contract (no cast bypass)", () => {
  const sql = sqlCode();
  has(/c_rfc3339/i, sql, "strict RFC3339 regex present");
  has(/\(0\[1-9\]\|1\[0-2\]\)/i, sql, "month range enforced in regex");
  has(/Z\|\[\+-\]/i, sql, "mandatory Z / ±offset enforced");
  has(/p_occurred_at::timestamptz/i, sql, "calendar-valid cast");
  has(/UNSUPPORTED_POLICY_VERSION/i, sql, "fixed policy-version fence");
});

// ============================================================================
// STATIC WRITER INVARIANTS + BOUNDARIES (34-35)
// ============================================================================
check("34. writer is read/derive-only, sends nothing, wires nothing", () => {
  const code = writerCode();
  hasNot(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/, code, "no direct table write (all mutation via the RPC)");
  hasNot(/sendTemplateMessage|sendAuthenticationMessage|CommunicationService|\.send\(/, code, "no send integration");
  hasNot(/graph\.facebook|whatsAppCloud|\bmeta\b.*enable|WHATSAPP_.*=|\bn8n\b|emitEvent/i, code, "no Meta/n8n/route wiring");
  hasNot(/metaWhatsAppWebhookService|route\.ts|webhook/i, code, "no webhook/route import");
  has(/adminClient\(\)\.rpc\("apply_communication_consent_command"/, code, "the single RPC is the only DB touchpoint");
  has(/CONSENT_POLICY_VERSION/, code, "policy version from code, never input");
  hasNot(/policyVersion:\s*input/, code, "policyVersion is never taken from input");
});
check("35. D2-C stays read-only + unchanged; webhook does not import the writer", () => {
  const d2c = stripTs(readF(D2C_SVC_SRC));
  hasNot(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/, d2c, "D2-C service remains read-only (no writes)");
  const webhook = stripTs(readF(WEBHOOK_SVC_SRC));
  hasNot(/communicationConsentWriterService|writeConsentCommand/, webhook, "webhook does not import the writer");
});

// ============================================================================
// PHASE BOUNDARY (36) + WIRING/DOC (37)
// ============================================================================
check("36. two-mode phase boundary (pre-commit worktree | post-commit historical D2-D delta)", () => {
  if (headSha() === D2D_BASE) {
    const problems = validateD2DHistoricalDelta(gitDirty(), D2D_BASE);
    assert(problems.length === 0, `pre-commit D2-D delta violation: ${problems.join(" | ")}`);
  } else {
    const { files, parent, message } = d2dHistoricalCommit();
    assert(/^Phase 5F-D2-D:/.test(message), `first commit after the base must be 'Phase 5F-D2-D:' (got '${message.slice(0, 60)}')`);
    const problems = validateD2DHistoricalDelta(files, parent);
    assert(problems.length === 0, `historical D2-D delta violation: ${problems.join(" | ")}`);
  }
});
check("37. wiring: script + policy reuse + doc topics", () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:d2d"] === "node scripts/phase5f-d2d-consent-command-writer-harness.mjs", "d2d script wired");
  has(/CONSENT_POLICY_VERSION = "qf-consent-v1"/, readF(POLICY_SRC), "policy constant reused");
  for (const f of [COMMAND_SRC, WRITER_SRC, MIGRATION_SRC, DOC_SRC]) assert(existsSync(f), `${f} exists`);
  const doc = readF(DOC_SRC);
  for (const topic of [
    /authority ownership|QuickFurno Core/i, /STOP/, /START/, /HELP/, /help_acknowledged/, /marketing.*transactional/i,
    /suppression-only|no preference|communication_preferences/i, /idempoten/i, /replay/i, /conflict/i,
    /transaction/i, /concurren/i, /row lock|FOR UPDATE|advisory/i, /read.only|D2-C/i, /Meta remains disabled|Meta.*disabled/i,
    /migration.history|drift/i, /not auto-applied|do not apply/i, /privacy|hash/i, /no send|sends nothing/i, /authentication|OTP/i,
  ]) has(topic, doc, `doc covers ${topic}`);
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
  async (mm) => {
    const store = newStore(); seedUserStop(store, ["marketing"]);
    store.suppressions.push({ id: simUuid(), destination_hash: HASH, channel: "whatsapp", scope: "transactional", reason: "provider_block", is_active: true, suppressed_at: OCCURRED, deactivated_at: null });
    const { r } = await runW(mm, input("start"), store); return r.ok && r.result !== "start_partially_applied";
  });

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
  async (mm) => {
    const store = newStore(); const pmid = nextPmid();
    await runW(mm, input("stop", { providerMessageId: pmid }), store);
    const { r } = await runW(mm, input("start", { providerMessageId: pmid }), store);
    return !(r.ok === false && r.code === "WRITER_CONFLICT");
  });

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

srcMutation("MUT I: RPC scope set widened to include 'global'", MIGRATION_SRC,
  "array['marketing', 'transactional']; -- P1",
  "array['marketing', 'transactional', 'global']; -- P1",
  () => /'global'/i.test(sqlCode()));

srcMutation("MUT J: START reversal loses its user_stop guard", MIGRATION_SRC,
  "elsif v_active_reason = 'user_stop' then\n          v_outcome := 'user_stop_reversed';",
  "elsif true then\n          v_outcome := 'user_stop_reversed';",
  () => !/'no_reversible_user_stop'\s*;\s*elsif\s+v_active_reason\s*=\s*'user_stop'\s+then\s+v_outcome\s*:=\s*'user_stop_reversed'/i.test(sqlCode()));

srcMutation("MUT K: RPC gains a communication_preferences write", MIGRATION_SRC,
  "return jsonb_build_object('ok', true, 'replayed', false, 'scope_results', v_scope_results);",
  "insert into public.communication_preferences (id) values (gen_random_uuid());\n  return jsonb_build_object('ok', true, 'replayed', false, 'scope_results', v_scope_results);",
  () => /communication_preferences/i.test(sqlCode()));

srcMutation("MUT L: RPC command-conflict detection removed", MIGRATION_SRC,
  "if v_existing_cmd is distinct from p_command then\n      return jsonb_build_object('ok', false, 'code', 'WRITER_CONFLICT');\n    end if;",
  "if false then\n      return jsonb_build_object('ok', false, 'code', 'WRITER_CONFLICT');\n    end if;",
  () => !/v_existing_cmd\s+is\s+distinct\s+from\s+p_command[\s\S]*?WRITER_CONFLICT/i.test(sqlCode()));

srcMutation("MUT M: RPC security definer weakened to invoker", MIGRATION_SRC,
  "security definer",
  "security invoker",
  () => !/security\s+definer/i.test(sqlCode()));

srcMutation("MUT N: RPC public-execute revoke removed", MIGRATION_SRC,
  "text, text, text, text, text, uuid, text, text, text, text, uuid, text, text, text, text) from public;",
  "text, text, text, text, text, uuid, text, text, text, text, uuid, text, text, text, text) from public_removed;",
  () => !/revoke\s+all\s+on\s+function[\s\S]*from\s+public;/i.test(sqlCode()));

fnMutation("MUT O: a seventh unrelated file in the D2-D delta is rejected",
  () => validateD2DHistoricalDelta([...D2D_EXPECTED_FILES, "services/somethingElse.ts"], D2D_BASE).length > 0);
fnMutation("MUT P: a missing approved D2-D file is rejected",
  () => validateD2DHistoricalDelta(D2D_EXPECTED_FILES.filter((f) => f !== WRITER_SRC), D2D_BASE).length > 0);
fnMutation("MUT Q: a D2-D delta with an extra/second migration is rejected",
  () => validateD2DHistoricalDelta([...D2D_EXPECTED_FILES, "supabase/migrations/x.sql"], D2D_BASE).length > 0);
fnMutation("MUT R: a D2-D delta that modifies the D2-C service is rejected",
  () => validateD2DHistoricalDelta([...D2D_EXPECTED_FILES, D2C_SVC_SRC], D2D_BASE).length > 0);
fnMutation("MUT S: an incorrect D2-D parent is rejected",
  () => validateD2DHistoricalDelta(D2D_EXPECTED_FILES, "0000000000000000000000000000000000000000").length > 0);

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
