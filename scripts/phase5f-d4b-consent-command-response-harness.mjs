import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5F-D4-B — EVIDENCE-BOUND consent-command acknowledgements (STOP / START / HELP).
 *
 * UPDATED BY PHASE 5F-D4-C — the architecture changed from an INLINE webhook send to a DURABLE ENQUEUE.
 *
 * WHAT THIS SUITE STILL OWNS (unchanged guarantees, re-pointed at the enqueue path):
 *   • the closed three-type vocabulary and the derived template key;
 *   • the founder-ratified command/disposition eligibility;
 *   • the exact evidence binding (destination hash, provider-message identity, channel, inbound row);
 *   • REPLAY rejection;
 *   • the D3-B registry EXCLUSION (an acknowledgement type is never ordinary outbound traffic);
 *   • HELP writes no consent state;
 *   • plaintext privacy;
 *   • acknowledgement failure ISOLATION (it can never fail the consent command or the webhook);
 *   • the webhook ORDER: persist → completed command/writer result → acknowledgement.
 *
 * WHAT MOVED TO D4-C (scripts/phase5f-d4c-consent-ack-async-harness.mjs), because the code moved:
 *   • the ONE-SHOT evidence-bound enforcer  → it now lives in services/consentAckWorkerService.ts
 *     (D4-C C16, MUT 23);
 *   • the D2-C consultation, GLOBAL-suppression block and fail-closed authority handling → they are now
 *     RE-EVALUATED BY THE WORKER immediately before dispatch (D4-C C3, C4, C5, MUT 7, MUT 8, MUT 9);
 *   • provider rejection / timeout / unknown-outcome handling → D4-C C11 (terminal `uncertain`, never resent);
 *   • the missing-template / absent-provider fail-closed path → D4-C C13, C15.
 *   The ENQUEUE path deliberately does NONE of those things any more, and this suite PROVES that (B2).
 *
 * Everything is driven through INJECTED fakes. Supabase is stubbed to throw if ever touched; the intent
 * store is in-memory; no provider, no network, no real key. Mutations are restored byte-identically.
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

const PURE_SRC = "lib/communication/consentCommandResponse.ts";
const SVC_SRC = "services/consentCommandResponseService.ts";
const WORKER_SRC = "services/consentAckWorkerService.ts";
const WEBHOOK_SRC = "services/metaWhatsAppWebhookService.ts";
const REGISTRY_SRC = "lib/communication/outboundConsentScope.ts";
const HARNESS_SRC = "scripts/phase5f-d4b-consent-command-response-harness.mjs";
const DOC_SRC = "docs/QF-Consent-Command-Response-Phase-5F-D4-B.md";
const D4C_DOC_SRC = "docs/QF-Consent-Ack-Async-Phase-5F-D4-C.md";
const D2E_HARNESS_SRC = "scripts/phase5f-d2e-inbound-consent-integration-harness.mjs";

/** Frozen authorities D4-B may call but must NEVER modify. */
const FROZEN = [
  "services/communicationConsentDecisionService.ts",
  "services/communicationConsentWriterService.ts",
  "services/inboundConsentCommandService.ts",
  "services/outboundConsentEnforcementService.ts",
  "lib/communication/outboundConsentScope.ts",
  "services/communicationService.ts",
  "services/runtimeCommunicationService.ts",
  D2E_HARNESS_SRC,
];

// ── PHASE 8A — AN AUTHORITY TRANSFER, BOUNDED TO A FIXED HISTORICAL RANGE ──────────────────────────
//
// Identical reasoning to D4-C's H1 (see that harness for the full note). Phase 8A legitimately changes two
// files the Phase 7 freeze listed above; their AUTHORITY MOVES to the D3-B harness, which owns and proves
// the fail-closed consent properties. D4-B keeps proving everything else.
//
// THE RANGE IS CLOSED AT BOTH ENDS. An earlier version compared the authority base against the MOVING HEAD,
// which would have made every later phase's files fall inside the Phase 8A audit and fail D4-B forever.
// Both endpoints are now immutable SHAs; later commits sit outside the range and are simply not D4-B's
// business.
const PHASE_8A_AUTHORITY_BASE = "b0d40819c655df7e68135b52b5435941f793fc36";
const PHASE_8A_IMPLEMENTATION_HEAD = "c0fc5fb11ff1b0d228e8d58793bc4579a0c5d5e9";

/** The EXACT seven files the Phase 8A implementation commit may contain. Fixed for all time. */
const PHASE_8A_IMPLEMENTATION_FILES = [
  "services/communicationService.ts",
  "services/outboundConsentEnforcementService.ts",
  "services/metaWhatsAppWebhookService.ts",
  "scripts/phase5b-communication-core-harness.mjs",
  "scripts/phase5f-d3b-outbound-consent-enforcement-harness.mjs",
  "scripts/phase5f-d2e-inbound-consent-integration-harness.mjs",
  "scripts/phase5f-d1b-whatsapp-inbound-persistence-harness.mjs",
];

const PHASE_8A_RELEASED_SHARED_AUTHORITIES = [
  "services/communicationService.ts",
  "services/outboundConsentEnforcementService.ts",
];

/**
 * The D2-E harness is also released by Phase 8A — but NOT unguarded. It has always had a stronger guard
 * than a byte-freeze: `validateD2EHarnessDelta()` bounds its delta line-by-line against D4B_BASE, forbids
 * removing any check, and pins its check/assert counts. Phase 8A extends that validator (transformation C)
 * rather than bypassing it, so this file remains the most tightly bounded of them all.
 */
const PHASE_8A_RELEASED_DELTA_BOUNDED = [D2E_HARNESS_SRC];

/** Everything the Phase 7 freeze covered that Phase 8A did NOT release. Still byte-frozen in the worktree. */
const STILL_FROZEN = FROZEN.filter(
  (f) => !PHASE_8A_RELEASED_SHARED_AUTHORITIES.includes(f) && !PHASE_8A_RELEASED_DELTA_BOUNDED.includes(f)
);

/**
 * D4-B's OWN authorities — the ONLY worktree files it polices. It deliberately does NOT gatekeep arbitrary
 * future-phase files; that is each phase's own harness's job.
 */
const D4B_OWNED_AUTHORITIES = [SVC_SRC, PURE_SRC];

const FORBIDDEN_IN_PHASE_8A = [
  [/^supabase\/migrations\//, "a migration"],
  [/^app\/api\//, "an API route"],
  [/\.env/, "an environment file"],
  [/^lib\/communication\/providers\//, "a provider adapter/configuration"],
  [/package-lock\.json|yarn\.lock|pnpm-lock\.yaml/, "a lockfile"],
  [/^package\.json$/, "package.json"],
  [/^(Dockerfile|docker-compose|\.github\/|vercel\.json|ecosystem\.config)/, "a deployment file"],
];

/** The files changed in the FIXED Phase 8A range. Never reads HEAD, so later phases can never enter it. */
function phase8aRangeFiles() {
  return [...new Set(
    execFileSync("git", ["diff", "--name-only", `${PHASE_8A_AUTHORITY_BASE}..${PHASE_8A_IMPLEMENTATION_HEAD}`], { encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean).map((p) => p.replace(/\\/g, "/"))
  )];
}

/** MEMBERSHIP FIRST, forbidden categories SECOND — so an approved file can never be pre-rejected. */
function validatePhase8AHistoricalRange() {
  const files = phase8aRangeFiles();
  assert(files.length === 7, `the fixed Phase 8A range must contain EXACTLY 7 files (got ${files.length}: ${files.join(", ")})`);
  for (const p of files) {
    assert(PHASE_8A_IMPLEMENTATION_FILES.includes(p), `unexpected file in the fixed Phase 8A range: ${p}`);
  }
  for (const p of PHASE_8A_IMPLEMENTATION_FILES) {
    assert(files.includes(p), `expected Phase 8A file missing from the fixed range: ${p}`);
  }
  for (const p of files) {
    for (const [re, what] of FORBIDDEN_IN_PHASE_8A) {
      assert(!re.test(p), `${what} may never be part of the Phase 8A range (${p})`);
    }
  }
}

/** The APPROVED D4-C scope — ELEVEN files. */
const D4C_EXPECTED_FILES = [
  "supabase/migrations/20260713000100_communication_consent_ack_intents.sql",
  "lib/communication/consentAckIntent.ts",
  "lib/communication/consentAckDestinationSeal.ts",
  WORKER_SRC,
  "app/api/internal/process-consent-ack-intents/route.ts",
  "scripts/phase5f-d4c-consent-ack-async-harness.mjs",
  D4C_DOC_SRC,
  SVC_SRC, WEBHOOK_SRC, HARNESS_SRC, "package.json",
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

function transpileService(outDir) {
  const tsconfigPath = resolve(`${outDir}.svc.tsconfig.json`);
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: false, isolatedModules: true,
      outDir, rootDir: ".", types: [], noResolve: true,
    },
    files: [SVC_SRC],
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  catch { /* expected noResolve diagnostics */ }
  finally { rmSync(tsconfigPath, { force: true }); }
  if (!existsSync(resolve(outDir, "services/consentCommandResponseService.js"))) throw new Error("service did not transpile");
}

function wireBuild(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const original = Module._load;
  const STUBS = {
    "../lib/supabase": { adminClient: () => { throw new Error("real Supabase must never run in the D4-B harness"); } },
  };
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return original.apply(this, [request, parent, isMain]);
  };
  const built = {
    Pure: req("./lib/communication/consentCommandResponse.js"),
    Seal: req("./lib/communication/consentAckDestinationSeal.js"),
    Intent: req("./lib/communication/consentAckIntent.js"),
    Svc: req("./services/consentCommandResponseService.js"),
    Registry: req("./lib/communication/outboundConsentScope.js"),
    Phone: req("./lib/communication/phone.js"),
  };
  Module._load = original;
  return built;
}

const readF = (f) => readFileSync(f, "utf8");
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "").replace(/\/\/.*$/gm, "");
function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }
function gitDirty() {
  return execFileSync("git", ["status", "--porcelain", "-uall"], { encoding: "utf8" })
    .split("\n").map((l) => l.slice(3).trim()).filter(Boolean).map((p) => p.replace(/\\/g, "/"))
    .filter((p) => !p.startsWith(".phase5fd4b"));
}

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function has(re, s, msg) { assert(re.test(s), msg); }
function hasNot(re, s, msg) { assert(!re.test(s), msg); }

// ----------------------------------------------------------------------------
// THE D2-E HARNESS DELTA — BYTE-BOUNDED to the two approved transformations
// (Carried forward from D4-B. The D2-E harness is FROZEN in D4-C; if it is ever touched again, this
//  validator still bounds exactly what may change.)
// ----------------------------------------------------------------------------
const D4B_BASE = "8749050fb45b500d196746d10315878eb60219c4";
const D2E_EXPECTED_CHECKS = 31;                 // UNCHANGED by Phase 8A — no D2-E check was added or removed
const D2E_EXPECTED_ASSERTS = 166;               // 8A symbol guard + C8B-1B-C Stage 2E provider-account proofs (EXACT count, never a lower bound)

const A_OLD = 'hasNot(/consentCommand|normalizeConsentCommand/, code, "the webhook never normalizes a command itself");';
const A_NEW = 'hasNot(/["\']\\.\\.\\/lib\\/communication\\/consentCommand["\']|normalizeConsentCommand/, code, "the webhook never normalizes a command itself");';
const B_OLD_HEAD = 'assert(consentSpecifiers.length === 1 && consentSpecifiers[0] === "./inboundConsentCommandService",';
const B_NEW_UNAPPROVED = 'const unapproved = consentSpecifiers.filter((s) => !ALLOWED_CONSENT_MODULES.includes(s));';
const B_NEW_REQUIRE_D2E = 'assert(consentSpecifiers.includes("./inboundConsentCommandService"),';

// ── PHASE 8A — transformation C: the webhook may import the FAIL-CLOSED enforcer, and NOTHING else ──
// The allowlist gains ONE module. That alone would be a real widening, so the delta ALSO adds a
// SYMBOL-LEVEL guard: the only symbol importable from that module is `createFailClosedOutboundConsentEnforcer`
// (an enforcer with no code path that returns `allow`), and the REAL authority is explicitly forbidden.
// Net effect: the webhook's authority NARROWS. The exact-line bounding below still admits nothing else.
const B_NEW_ALLOWLIST = 'const ALLOWED_CONSENT_MODULES = ["./inboundConsentCommandService", "./consentCommandResponseService", "./outboundConsentEnforcementService"];';
const C_SYMBOLS_HEAD = 'const enforcementSymbols = [...readF(WEBHOOK_SVC_SRC).matchAll(/import\\s*\\{([^}]*)\\}\\s*from\\s*"\\.\\/outboundConsentEnforcementService"/g)]';
const C_SYMBOLS_TAIL = '.flatMap((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean));';
const C_SYMBOLS_ASSERT = 'assert(enforcementSymbols.every((s) => s === "createFailClosedOutboundConsentEnforcer"),';
const C_SYMBOLS_MSG = '`the webhook may import ONLY the fail-closed enforcer (got [${enforcementSymbols.join(", ")}])`);';
const C_NO_REAL_AUTHORITY = 'hasNot(/createOutboundConsentEnforcer\\b/, code, "the webhook NEVER binds the REAL consent authority");';
/** The consent modules the D2-E allowlist may contain after Phase 8A. Exactly these three, in this order. */
const D2E_ALLOWED_MODULES_AFTER_8A = [
  "./inboundConsentCommandService",
  "./consentCommandResponseService",
  "./outboundConsentEnforcementService",
];


// ── C8B-1B-C — D2-E HARNESS DELTA AUTHORITY TRANSFER (reviewed at implementation commit e742bb14) ──
// Stage 2E aligned the D2-E harness to the provider-account ownership prerequisite. The transfer is
// EXACT-LINE, exactly like Phase 8A above: every admitted line is listed verbatim, so an unrelated edit
// — even one mentioning providerAccountId or readStoredInbound — still fails as an unapproved line.
// Scope: D2E provider-account UUID fixtures; persisted inbound providerAccountId context; the
// readStoredInbound dependency and durable read-back; the discriminated read outcomes (present/absent/
// error, incl. thrown reads); read-before-insert and read-after-insert; the durable stored account
// remaining authoritative; the deps.handleInbound and deps.processCommands seams; the
// ownership-before-persistence-before-command ordering proof; the inbound_persisted_row_unresolved vs
// inbound_read_failed retry distinction; and the MUT L / MUT M / MUT S re-anchors.
const C8B1BC_D2E_APPROVED_FRAGMENTS = [
  "createOrResolveReceipt: async () => ({ ok: true, receiptId: \"receipt-1\", duplicate: false }),",
  "createOrResolveReceipt: async (_raw, _payload, providerAccountId) => ({ ok: true, receiptId: \"receipt-1\", duplicate: false, providerAccountId }),",
  "resolvePersistedInboundContext: over.resolvePersistedInboundContext ?? (async (row) => {",
  "readStoredInbound: over.readStoredInbound ?? (async (row) => {",
  "if (!raw) return null;",
  "if (!raw) return { kind: \"absent\" };",
  "return M.D1B.validatePersistedInboundRow(raw, { provider: row.provider, providerMessageId: row.provider_message_id });",
  "const context = M.D1B.validatePersistedInboundRow(raw, { provider: row.provider, providerMessageId: row.provider_message_id });",
  "return context ? { kind: \"present\", context } : { kind: \"error\" };",
  "const D2E_ACCOUNT_ID = \"dddddddd-4444-4444-8444-dddddddddddd\";",
  "return M.D1B.handleInboundWhatsAppMessages({ rawBody: JSON.stringify(payload), payload }, d.deps)",
  "return M.D1B.handleInboundWhatsAppMessages({ rawBody: JSON.stringify(payload), payload, providerAccountId: D2E_ACCOUNT_ID }, d.deps)",
  "assert(first.calls.resolves.length === 1, \"the insert path also resolves the persisted row\");",
  "assert(first.calls.resolves.length === 2, \"the insert path reads first AND reads its context back (read-first bind)\");",
  "assert(second.calls.resolves.length === 1, \"the duplicate path resolves the stored row without inserting\");",
  "assert(a.providerAccountId === b.providerAccountId, \"insert and duplicate surface the SAME stored account\");",
  "const one = await M.D1B.resolvePersistedInboundContextViaDb(fence, fakeClient(() => ({ data: [storedRow()], error: null })));",
  "assert(one && one.id === ROW_UUID && one.contentMinimized.text === \"STOP\", \"exactly one row → its validated projection\");",
  "const none = await M.D1B.resolvePersistedInboundContextViaDb(fence, fakeClient(() => ({ data: [], error: null })));",
  "assert(none === null, \"zero rows → null, NEVER a fabricated row\");",
  "const many = await M.D1B.resolvePersistedInboundContextViaDb(fence, fakeClient(() => ({ data: [storedRow(), storedRow({ id: ROW_UUID_2 })], error: null })));",
  "assert(many === null, \"a violated fence (multi-row) → null, NEVER a guess — and never .single()/.limit()\");",
  "const err = await M.D1B.resolvePersistedInboundContextViaDb(fence, fakeClient(() => ({ data: null, error: { code: \"08006\" } })));",
  "assert(err === null, \"a db error → null (the caller fails closed)\");",
  "const one = await M.D1B.readStoredInboundViaDb(fence, fakeClient(() => ({ data: [storedRow()], error: null })));",
  "assert(one.kind === \"present\" && one.context.id === ROW_UUID && one.context.contentMinimized.text === \"STOP\", \"exactly one row → its validated projection\");",
  "const none = await M.D1B.readStoredInboundViaDb(fence, fakeClient(() => ({ data: [], error: null })));",
  "assert(none.kind === \"absent\", \"zero rows → absent, NEVER a fabricated row\");",
  "const many = await M.D1B.readStoredInboundViaDb(fence, fakeClient(() => ({ data: [storedRow(), storedRow({ id: ROW_UUID_2 })], error: null })));",
  "assert(many.kind === \"error\", \"a violated fence (multi-row) → error, NEVER a guess — and never .single()/.limit()\");",
  "const err = await M.D1B.readStoredInboundViaDb(fence, fakeClient(() => ({ data: null, error: { code: \"08006\" } })));",
  "assert(err.kind === \"error\", \"a db error → error (the caller fails closed), never absence\");",
  "const malformed = await M.D1B.readStoredInboundViaDb(fence, fakeClient(() => ({ data: [storedRow({ id: \"not-a-uuid\" })], error: null })));",
  "assert(malformed.kind === \"error\", \"a MALFORMED durable row → error, never absence\");",
  "const start = src.indexOf(\"export async function resolvePersistedInboundContextViaDb\");",
  "const start = src.indexOf(\"export async function readStoredInboundViaDb\");",
  "has(/rows\\.length !== 1/, body, \"exactly one row is required\");",
  "has(/data\\.length === 0\\) return \\{ kind: \"absent\" \\}/, body, \"zero rows → absent, never a fabricated row\");",
  "has(/data\\.length > 1\\) return \\{ kind: \"error\" \\}/, body, \"more than one row → error, never a first-row guess\");",
  "has(/context \\? \\{ kind: \"present\", context \\} : \\{ kind: \"error\" \\}/, body, \"a malformed row → error, never absence\");",
  "const unresolved = await runD1B(envelope(textMsg()), { resolvePersistedInboundContext: async () => null });",
  "const unresolved = await runD1B(envelope(textMsg()), { readStoredInbound: async () => ({ kind: \"absent\" }) });",
  "const threw = await runD1B(envelope(textMsg()), { resolvePersistedInboundContext: async () => { throw new Error(\"db down: SQLSTATE 08006\"); } });",
  "assert(threw.r.ok === false && threw.r.code === \"inbound_persisted_row_unresolved\", \"a THROWN resolver error → retryable, sanitized\");",
  "assert(unresolved.r.result.processed.length === 0, \"nothing is handed downstream from an unresolvable row\");",
  "const readFailed = await runD1B(envelope(textMsg()), { readStoredInbound: async () => ({ kind: \"error\" }) });",
  "assert(readFailed.r.ok === false && readFailed.r.code === \"inbound_read_failed\", \"a read-back FAILURE → retryable, distinct from absence\");",
  "assert(readFailed.r.result.processed.length === 0, \"nothing is handed downstream from a failed read-back\");",
  "const threw = await runD1B(envelope(textMsg()), { readStoredInbound: async () => { throw new Error(\"db down: SQLSTATE 08006\"); } });",
  "assert(threw.r.ok === false && threw.r.code === \"inbound_read_failed\", \"a THROWN read error → retryable, sanitized\");",
  "const iPersist = src.indexOf(\"handleInboundWhatsAppMessages(\");",
  "const iPersist = src.indexOf(\"deps.handleInbound(\");",
  "const iCommand = src.indexOf(\"processInboundConsentCommands(\");",
  "const iCommand = src.indexOf(\"deps.processCommands(\");",
  "assert(src.slice(iPersist, iOkGate).indexOf(\"processInboundConsentCommands(\") === -1, \"no command processing before the ok-gate\");",
  "assert(src.slice(iPersist, iOkGate).indexOf(\"deps.processCommands(\") === -1, \"no command processing before the ok-gate\");",
  "const iOwnership = src.indexOf(\"resolveEnvelopeProviderAccount(\");",
  "assert(iOwnership > 0 && iOwnership < iPersist, \"provider-account ownership is resolved BEFORE inbound persistence\");",
  "hasNot(/consentCommand|normalizeConsentCommand/, code, \"the webhook never normalizes a command itself\");",
  "hasNot(/[\"']\\.\\.\\/lib\\/communication\\/consentCommand[\"']|normalizeConsentCommand/, code, \"the webhook never normalizes a command itself\");",
  "const ALLOWED_CONSENT_MODULES = [\"./inboundConsentCommandService\", \"./consentCommandResponseService\", \"./outboundConsentEnforcementService\"];",
  "assert(consentSpecifiers.length === 1 && consentSpecifiers[0] === \"./inboundConsentCommandService\",",
  "`the orchestrator must be the ONLY consent-related module the webhook imports (got [${consentSpecifiers.join(\", \")}])`);",
  "const unapproved = consentSpecifiers.filter((s) => !ALLOWED_CONSENT_MODULES.includes(s));",
  "assert(unapproved.length === 0,",
  "`only the approved consent orchestrators may be imported by the webhook (got [${unapproved.join(\", \")}])`);",
  "assert(consentSpecifiers.includes(\"./inboundConsentCommandService\"),",
  "\"the D2-E orchestrator must still be imported\");",
  "const enforcementSymbols = [...readF(WEBHOOK_SVC_SRC).matchAll(/import\\s*\\{([^}]*)\\}\\s*from\\s*\"\\.\\/outboundConsentEnforcementService\"/g)]",
  ".flatMap((m) => m[1].split(\",\").map((s) => s.trim()).filter(Boolean));",
  "assert(enforcementSymbols.every((s) => s === \"createFailClosedOutboundConsentEnforcer\"),",
  "`the webhook may import ONLY the fail-closed enforcer (got [${enforcementSymbols.join(\", \")}])`);",
  "hasNot(/createOutboundConsentEnforcer\\b/, code, \"the webhook NEVER binds the REAL consent authority\");",
  "\"    const rows = (data ?? []) as unknown[];\\n    if (rows.length !== 1) return null;\",",
  "\"    const rows = (data ?? []) as unknown[];\\n    if (rows.length === 0) return null;\",",
  "'    if (data.length > 1) return { kind: \"error\" };',",
  "'    if (data.length > 99) return { kind: \"error\" };',",
  "const many = await mm.D1B.resolvePersistedInboundContextViaDb(",
  "const many = await mm.D1B.readStoredInboundViaDb(",
  "return many !== null; // it guessed a row instead of failing closed on a violated fence",
  "return many.kind === \"present\"; // it guessed a row instead of failing closed on a violated fence",
  "'    if (!persistedRow) { failureReason = failureReason ?? \"inbound_persisted_row_unresolved\"; continue; }',",
  "\"    if (!persistedRow) { continue; }\",",
  "'  if (after.kind !== \"present\") return { kind: \"error\", reason: \"inbound_persisted_row_unresolved\" };',",
  "'  if (after.kind !== \"present\") return { kind: \"duplicate\", context: read as never };',",
  "const { deps } = d1bDeps({ resolvePersistedInboundContext: async () => null });",
  "const { deps } = d1bDeps({ readStoredInbound: async () => ({ kind: \"absent\" }) });",
  "const r = await mm.D1B.handleInboundWhatsAppMessages({ rawBody: JSON.stringify(payload), payload }, deps);",
  "const r = await mm.D1B.handleInboundWhatsAppMessages({ rawBody: JSON.stringify(payload), payload, providerAccountId: D2E_ACCOUNT_ID }, deps);",
  "`    processed.push({",
  "message: {",
  "provider: persistedRow.provider,",
  "providerMessageId: persistedRow.providerMessageId,",
  "messageType: persistedRow.messageType,",
  "contentMinimized: persistedRow.contentMinimized,",
  "providerOccurredAt: persistedRow.providerOccurredAt,",
  "},",
  "receipt: {",
  "inboundMessageId: persistedRow.id,",
  "duplicate: outcome === \"duplicate\",",
  "destinationHash: persistedRow.senderHash,",
  "identityConfidence: persistedRow.identityConfidence,",
  "principalType: persistedRow.principalType,",
  "principalId: persistedRow.principalId,",
  "receivedAt: persistedRow.receivedAt,",
  "});`,",
  "provider: row.provider,",
  "providerMessageId: row.provider_message_id,",
  "messageType: row.message_type,",
  "contentMinimized: row.content_minimized,",
  "providerOccurredAt: row.provider_occurred_at,",
  "destinationHash: row.sender_hash,",
  "identityConfidence: row.identity_confidence,",
  "principalType: row.resolved_principal_type,",
  "principalId: row.resolved_principal_id,",
  "\"    const persistedRow = bound.context; // the DURABLE row — never this request's in-flight envelope\",",
  "\"    const persistedRow = { ...bound.context, providerMessageId: row.provider_message_id, messageType: row.message_type, contentMinimized: row.content_minimized as Record<string, unknown>, providerOccurredAt: row.provider_occurred_at, senderHash: row.sender_hash, identityConfidence: row.identity_confidence, principalType: row.resolved_principal_type, principalId: row.resolved_principal_id };\",",
  "return mm.D1B.handleInboundWhatsAppMessages({ rawBody: JSON.stringify(payload), payload }, deps);",
  "return mm.D1B.handleInboundWhatsAppMessages({ rawBody: JSON.stringify(payload), payload, providerAccountId: D2E_ACCOUNT_ID }, deps);",
];

const countOf = (s, re) => (s.match(re) || []).length;

function validateD2EHarnessDelta() {
  const problems = [];
  const before = execFileSync("git", ["show", `${D4B_BASE}:${D2E_HARNESS_SRC}`], { encoding: "utf8" });
  const after = readF(D2E_HARNESS_SRC);

  if (after.includes(A_OLD)) problems.push("transformation A not applied: the broad normalizer guard is still present");
  if (!after.includes(A_NEW)) problems.push("transformation A missing: the precise normalizer guard is absent");
  if (after.includes(B_OLD_HEAD)) problems.push("transformation B not applied: the old single-module equality is still present");
  for (const [name, needle] of [["allowlist", B_NEW_ALLOWLIST], ["unapproved filter", B_NEW_UNAPPROVED], ["orchestrator requirement", B_NEW_REQUIRE_D2E]]) {
    if (!after.includes(needle)) problems.push(`transformation B missing its ${name}`);
  }

  const allow = after.match(/const ALLOWED_CONSENT_MODULES = \[([^\]]*)\];/);
  if (!allow) problems.push("the consent-module allowlist is not a literal array");
  else {
    const entries = allow[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    const expected = D2E_ALLOWED_MODULES_AFTER_8A;
    if (JSON.stringify(entries) !== JSON.stringify(expected)) {
      problems.push(`the allowlist must be exactly [${expected.join(", ")}] (got [${entries.join(", ")}])`);
    }
    if (/\*|\.\+|RegExp|startsWith|includes\(.*\/\)/.test(allow[1])) problems.push("the allowlist must contain no wildcard/regex/prefix");
  }

  // PHASE 8A — admitting the enforcement module is only safe BECAUSE the symbol-level guard is present.
  // If someone widens the allowlist and drops the symbol guard, the D2-E boundary silently reopens.
  for (const [name, needle] of [
    ["symbol extraction", C_SYMBOLS_HEAD],
    ["symbol assertion", C_SYMBOLS_ASSERT],
    ["real-authority prohibition", C_NO_REAL_AUTHORITY],
  ]) {
    if (!after.includes(needle)) problems.push(`Phase 8A transformation C missing its ${name}`);
  }

  const diff = execFileSync("git", ["diff", "--unified=0", D4B_BASE, "--", D2E_HARNESS_SRC], { encoding: "utf8" }).split("\n");
  const APPROVED_FRAGMENTS = [
    A_OLD, A_NEW, B_OLD_HEAD, B_NEW_ALLOWLIST, B_NEW_UNAPPROVED, B_NEW_REQUIRE_D2E,
    // PHASE 8A — transformation C, line by line. EXACT equality only: nothing else may ride along.
    C_SYMBOLS_HEAD, C_SYMBOLS_TAIL, C_SYMBOLS_ASSERT, C_SYMBOLS_MSG, C_NO_REAL_AUTHORITY,
    // The pre-Phase-8A allowlist line, so REMOVING it is an approved deletion.
    'const ALLOWED_CONSENT_MODULES = ["./inboundConsentCommandService", "./consentCommandResponseService"];',
    'consentSpecifiers[0] === "./inboundConsentCommandService"',
    "`the orchestrator must be the ONLY consent-related module the webhook imports (got [${consentSpecifiers.join(\", \")}])`);",
    'assert(unapproved.length === 0,',
    "`only the approved consent orchestrators may be imported by the webhook (got [${unapproved.join(\", \")}])`);",
    '"the D2-E orchestrator must still be imported");',
    ...C8B1BC_D2E_APPROVED_FRAGMENTS,
  ];
  for (const line of diff) {
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
    const code = line.slice(1).trim();
    if (code === "" || code.startsWith("//")) continue;
    // EXACT EQUALITY ONLY — substring/superstring matching would let arbitrary code ride along.
    if (APPROVED_FRAGMENTS.some((f) => code === f.trim())) continue;
    problems.push(`unrelated D2-E harness line changed: ${code.slice(0, 80)}`);
  }

  for (const line of diff) {
    if (!line.startsWith("-") || line.startsWith("---")) continue;
    if (/\bcheck\(/.test(line)) problems.push(`a check was REMOVED from the D2-E harness: ${line.trim().slice(0, 70)}`);
  }
  const MUT_RE = /srcMutation\(|fnMutation\(|mutationChecks\.push/g;
  const checksN = countOf(after, /\bcheck\(/g);
  const asserts = countOf(after, /\bassert\(/g);
  if (checksN !== D2E_EXPECTED_CHECKS) problems.push(`D2-E check count must be ${D2E_EXPECTED_CHECKS} (got ${checksN})`);
  if (asserts !== D2E_EXPECTED_ASSERTS) problems.push(`D2-E assertion count must be ${D2E_EXPECTED_ASSERTS} (got ${asserts})`);
  if (countOf(before, MUT_RE) !== countOf(after, MUT_RE)) problems.push("D2-E mutation accounting must be UNCHANGED");

  const guard = /\["'\]\\\.\\\.\\\/lib\\\/communication\\\/consentCommand\["'\]\|normalizeConsentCommand/;
  if (!guard.test(after)) problems.push("the precise guard no longer forbids the real normalizer module + symbol");

  return problems;
}

const MAIN_DIR = resolve(".phase5fd4b-build-main");
compileTo(MAIN_DIR);
transpileService(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// FIXTURES
// ============================================================================
const WA_ID = "919812345678";
const E164 = "+919812345678";
const DEST_HASH = createHash("sha256").update(E164).digest("hex");
const WAMID = "wamid.HBgMOTE5ODEyMzQ1Njc4FQIAEhggABCDEF0123456789";
const CANONICAL_PMID = createHash("sha256").update(WAMID).digest("hex");
const ROW_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RECEIPT_ID = "11111111-2222-4333-8444-555555555555";
const CMD_RECEIPT_ID = "99999999-8888-4777-8666-555555555555";
const RECEIVED = "2026-07-13T10:00:00.000Z";
const ADAPTER_PROVIDER = "meta_whatsapp_cloud";

const KEY_ID = "ack-key-v1";
const ENV_OK = {
  QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID: KEY_ID,
  QF_CONSENT_ACK_DESTINATION_KEYS: JSON.stringify({ [KEY_ID]: randomBytes(32).toString("base64url") }),
};

// Phase 8B-1A — DETERMINISTIC, grammar-valid (`^[0-9]{1,64}$`) callback identity for the identity gate the
// gated `handleMetaWhatsAppWebhookPost` now enters. Fixed numeric TEST-ONLY constants; no real WABA/phone id
// and no access token. `display_phone_number` is deliberately NOT used as identity.
const WEBHOOK_WABA_ID = "123456789012345";
const WEBHOOK_PHONE_NUMBER_ID = "111222333";
const envelope = (...messages) => ({
  object: "whatsapp_business_account",
  entry: [{ id: WEBHOOK_WABA_ID, changes: [{ field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: { phone_number_id: WEBHOOK_PHONE_NUMBER_ID },
    messages,
  } }] }],
});
const textMsg = (over = {}) => ({ from: WA_ID, id: WAMID, timestamp: "1752400000", type: "text", text: { body: "STOP" }, ...over });

// A NARROW, LOCAL mirror of the real closed-union `decideCallbackIdentity` — enough for D4-B's `messages`
// class only. It is NOT unconditional: it returns the real `authorized` shape ONLY for a whatsapp_business_account
// `messages` change whose entry.id === WEBHOOK_WABA_ID AND value.metadata.phone_number_id === WEBHOOK_PHONE_NUMBER_ID,
// and otherwise returns the real `rejected` / `unsupported` shapes. It reads no env, clock, network or DB.
// It never trusts `display_phone_number`. It exists only inside this harness so D4-B stays focused on its own
// persist → command → enqueue contract while still honouring the new identity precondition.
const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const idStr = (o, k) => (o && typeof o[k] === "string" && o[k].length > 0 ? o[k] : null);
function stubDecideCallbackIdentity(payload) {
  const root = asObj(payload);
  if (!root || root.object !== "whatsapp_business_account") return { kind: "unsupported" };
  const entries = Array.isArray(root.entry) ? root.entry : [];
  let sawSupported = false;
  let firstReject = null;
  for (const entryRaw of entries) {
    const entry = asObj(entryRaw);
    const entryId = entry ? idStr(entry, "id") : null;
    const changes = entry && Array.isArray(entry.changes) ? entry.changes : [];
    for (const changeRaw of changes) {
      const change = asObj(changeRaw);
      if (!change || change.field !== "messages") continue; // D4-B only exercises the messages class
      sawSupported = true;
      if (entryId !== WEBHOOK_WABA_ID) { firstReject = firstReject ?? { kind: "rejected", reason: entryId === null ? "unprovable_waba" : "foreign_waba" }; continue; }
      const value = change ? asObj(change.value) : null;
      const metadata = value ? asObj(value.metadata) : null;
      const phoneId = metadata ? idStr(metadata, "phone_number_id") : null;
      if (phoneId !== WEBHOOK_PHONE_NUMBER_ID) { firstReject = firstReject ?? { kind: "rejected", reason: phoneId === null ? "unprovable_phone_number" : "foreign_phone_number" }; continue; }
    }
  }
  if (firstReject) return firstReject;
  if (!sawSupported) return { kind: "unsupported" };
  return { kind: "authorized", classes: ["messages"] };
}

// Phase 8B-1B-C — the OWNING provider account proven by the webhook before any effect-bearing write, and
// carried on the DURABLE inbound row. The acknowledgement INHERITS this value; it never re-resolves
// ownership, never reads communication_provider_accounts, and never uses the envelope or environment.
// `ACK_ACCOUNT_B` models a DIFFERENT owner (cross-account conflict fixtures).
const ACK_ACCOUNT_ID = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";
const ACK_ACCOUNT_B = "ffffffff-6666-4666-8666-ffffffffffff";

const persistedItem = (over = {}) => ({
  message: { providerMessageId: WAMID, messageType: "text", ...(over.message ?? {}) },
  receipt: {
    inboundMessageId: ROW_ID,
    provider: ADAPTER_PROVIDER,
    providerMessageId: WAMID,
    destinationHash: DEST_HASH,
    receivedAt: RECEIVED,
    // The STORED account of the durable inbound row. `null` models a historical legacy (pre-binding) row;
    // OMITTING it entirely (via `omitProviderAccount`) models an integrity gap, which is NOT legacy null.
    ...(over.omitProviderAccount ? {} : { providerAccountId: ACK_ACCOUNT_ID }),
    ...(over.receipt ?? {}),
  },
});
const commandItem = (over = {}) => ({
  inboundMessageId: ROW_ID, command: "stop", disposition: "stop_applied", replayed: false, ...over,
});

function makeStore() {
  const rows = new Map();
  const byKey = new Map();
  return {
    rows, byKey,
    reads: [],
    // The GLOBAL idempotency key remains the unique fence — unchanged by 8B-1B-C.
    insert(row) {
      if (byKey.has(row.idempotency_key)) return "duplicate";
      rows.set(row.id, { ...row });
      byKey.set(row.idempotency_key, row.id);
      return "inserted";
    },
    // Phase 8B-1B-C read-first: classify an ALREADY-EXISTING intent's account binding. Read-only —
    // there is deliberately NO update path for provider_account_id anywhere in this fake.
    read(idempotencyKey) {
      this.reads.push(idempotencyKey);
      const id = byKey.get(idempotencyKey);
      if (id === undefined) return { kind: "absent" };
      const row = rows.get(id);
      return { kind: "present", providerAccountId: row.provider_account_id ?? null };
    },
    // Pre-seed an intent that already exists under a given account (or legacy NULL) without inserting
    // through the service — models a prior delivery or a historical row.
    seed(idempotencyKey, providerAccountId) {
      const id = `seeded-${byKey.size}`;
      rows.set(id, { id, idempotency_key: idempotencyKey, provider_account_id: providerAccountId });
      byKey.set(idempotencyKey, id);
    },
  };
}
function deps(store, over = {}) {
  return {
    resolveReceiptId: over.resolveReceiptId ?? (async () => CMD_RECEIPT_ID),
    insertIntent: over.insertIntent ?? (async (row) => store.insert(row)),
    readStoredIntent: over.readStoredIntent ?? (async (key) => store.read(key)),
    seal: over.seal ?? ((pt, aad) => M.Seal.sealAckDestination(pt, aad, ENV_OK)),
  };
}
async function runEnqueue(store, over = {}, mod = M) {
  return mod.Svc.enqueueConsentCommandResponses({
    payload: over.payload ?? envelope(textMsg(over.msgOver ?? {})),
    webhookReceiptId: RECEIPT_ID,
    persisted: over.persisted ?? [persistedItem(over.persistedOver ?? {})],
    commands: over.commands ?? [commandItem(over.commandOver ?? {})],
  }, deps(store, over.deps ?? {}));
}
const onlyRow = (store) => [...store.rows.values()][0];

// ============================================================================
// P. THE PURE CONTRACT (unchanged by D4-C)
// ============================================================================
check("P1. exactly three acknowledgement types; template key === message type", () => {
  const t = M.Pure.CONSENT_ACK_TYPES;
  assert(t.length === 3, `three types (got ${t.length})`);
  assert(t.includes("consent_stop_acknowledgement") && t.includes("consent_start_acknowledgement") && t.includes("consent_help_response"), "the exact three");
  for (const x of t) assert(M.Pure.ackTemplateKeyFor(x) === x, `template key ≡ message type for ${x}`);
});

check("P2. command eligibility is EXACTLY the founder-ratified set", () => {
  const eligible = {
    stop: ["stop_applied", "stop_already_effective"],
    start: ["start_applied", "start_partially_applied", "start_no_reversible_stop"],
    help: ["help_acknowledged"],
  };
  const ineligible = {
    stop: ["stop_failed", "writer_unavailable", "writer_integrity_violation", "unsupported_command"],
    start: ["start_blocked_by_stronger_suppression", "writer_unavailable", "writer_integrity_violation"],
    help: ["help_failed", "not_command_eligible"],
  };
  for (const [cmd, ds] of Object.entries(eligible)) for (const d of ds) {
    assert(M.Pure.isEligibleDisposition(cmd, d) === true, `${cmd}/${d} is eligible`);
  }
  for (const [cmd, ds] of Object.entries(ineligible)) for (const d of ds) {
    assert(M.Pure.isEligibleDisposition(cmd, d) === false, `${cmd}/${d} is NOT eligible`);
  }
});

check("P3. rate-limit windows are fixed (STOP/START 15m, HELP 24h) and keys carry no plaintext", () => {
  assert(M.Pure.ACK_WINDOW_MS.stop === 15 * 60 * 1000, "stop 15m");
  assert(M.Pure.ACK_WINDOW_MS.start === 15 * 60 * 1000, "start 15m");
  assert(M.Pure.ACK_WINDOW_MS.help === 24 * 60 * 60 * 1000, "help 24h");
  const k = M.Pure.deriveAckIdempotencyKey("consent_stop_acknowledgement", "stop", DEST_HASH, RECEIVED);
  assert(typeof k === "string" && k.startsWith("ack:consent_stop_acknowledgement:"), `shape (got ${k})`);
  hasNot(new RegExp(E164.replace("+", "\\+")), k, "no plaintext phone in the key");
  hasNot(new RegExp(WA_ID), k, "no wa_id in the key");
});

check("P4. the pure module is PURE (no I/O, db, env, clock, randomness)", () => {
  const code = stripTs(readF(PURE_SRC));
  hasNot(/require\(|import .* from ["'](?!\.)/, code, "no external imports");
  hasNot(/adminClient|supabase|fetch\(|process\.env|Math\.random|Date\.now\(\)|new Date\(\)/, code, "pure");
});

check("P5. the approved copy is fixed, link-free and opt-in-free", () => {
  const copy = M.Pure.APPROVED_ACK_COPY;
  assert(Object.keys(copy).length === 3, "exactly three");
  for (const [t, body] of Object.entries(copy)) {
    hasNot(/https?:\/\/|www\.|\{\{|\$\{/, body, `${t}: no links or variables`);
    hasNot(/off|discount|free|offer|sale|price/i, body, `${t}: no promotion`);
  }
});

check("E1. valid evidence derives a complete, non-caller-selectable plan", () => {
  const ev = {
    inboundMessageId: ROW_ID, webhookReceiptId: RECEIPT_ID, provider: "meta_whatsapp",
    providerMessageId: CANONICAL_PMID, channel: "whatsapp", destinationHash: DEST_HASH,
    command: "stop", disposition: "stop_applied", replayed: false, receivedAt: RECEIVED,
  };
  const r = M.Pure.deriveConsentAckPlan(ev, { destinationHash: DEST_HASH, providerMessageId: CANONICAL_PMID });
  assert(r.ok, `derives (got ${safeStringify(r)})`);
  assert(r.plan.ackType === "consent_stop_acknowledgement", "type DERIVED from the command");
  assert(r.plan.templateKey === "consent_stop_acknowledgement", "template DERIVED");
  assert(r.plan.lane === "authentication" && r.plan.channel === "whatsapp", "lane/channel fixed");
  assert(r.plan.recipientType === "system", "neutral recipient");
});

check("E2. every evidence mismatch REJECTS (hash, provider-message, channel, command, replay)", () => {
  const base = {
    inboundMessageId: ROW_ID, webhookReceiptId: RECEIPT_ID, provider: "meta_whatsapp",
    providerMessageId: CANONICAL_PMID, channel: "whatsapp", destinationHash: DEST_HASH,
    command: "stop", disposition: "stop_applied", replayed: false, receivedAt: RECEIVED,
  };
  const obs = { destinationHash: DEST_HASH, providerMessageId: CANONICAL_PMID };
  const cases = [
    ["DESTINATION_HASH_MISMATCH", base, { ...obs, destinationHash: "f".repeat(64) }],
    ["PROVIDER_MESSAGE_MISMATCH", base, { ...obs, providerMessageId: "a".repeat(64) }],
    ["UNSUPPORTED_CHANNEL", { ...base, channel: "sms" }, obs],
    ["NOT_A_COMMAND", { ...base, command: "unsupported" }, obs],
    ["REPLAYED_COMMAND", { ...base, replayed: true }, obs],
    ["INELIGIBLE_DISPOSITION", { ...base, disposition: "writer_unavailable" }, obs],
    ["INVALID_EVIDENCE", { ...base, inboundMessageId: "nope" }, obs],
  ];
  for (const [reason, ev, o] of cases) {
    const r = M.Pure.deriveConsentAckPlan(ev, o);
    assert(!r.ok && r.reason === reason, `${reason} (got ${safeStringify(r)})`);
  }
});

// ============================================================================
// A. THE ENQUEUE PATH — eligibility, evidence, replay, privacy
// ============================================================================
check("A1. STOP applied / already effective each produce ONE durable intent", async () => {
  for (const d of ["stop_applied", "stop_already_effective"]) {
    const store = makeStore();
    const r = await runEnqueue(store, { commandOver: { command: "stop", disposition: d } });
    assert(r.result.enqueued === 1, `${d}: enqueued`);
    assert(onlyRow(store).ack_type === "consent_stop_acknowledgement", `${d}: stop ack`);
  }
});

check("A2. START applied / partially applied / no-reversible-stop each produce ONE intent", async () => {
  for (const d of ["start_applied", "start_partially_applied", "start_no_reversible_stop"]) {
    const store = makeStore();
    const r = await runEnqueue(store, { msgOver: { text: { body: "START" } }, commandOver: { command: "start", disposition: d } });
    assert(r.result.enqueued === 1, `${d}: enqueued`);
    assert(onlyRow(store).ack_type === "consent_start_acknowledgement", `${d}: start ack`);
  }
});

check("A3. HELP produces ONE response intent, and NO consent write of any kind", async () => {
  const store = makeStore();
  const r = await runEnqueue(store, { msgOver: { text: { body: "HELP" } }, commandOver: { command: "help", disposition: "help_acknowledged" } });
  assert(r.result.enqueued === 1, "one intent");
  assert(onlyRow(store).ack_type === "consent_help_response", "help response");
  // The enqueue path has NO write capability at all.
  const code = stripTs(readF(SVC_SRC));
  hasNot(/apply_communication_consent_command|writeConsentCommand|communicationConsentWriterService/, code, "no writer");
  hasNot(/communication_suppressions|communication_preferences|communication_consent_events/, code, "no consent table");
  hasNot(/consented_at|withdrawn_at|state: "allowed"/, code, "no consent-state write");
});

check("A4. START blocked by a stronger suppression → ZERO intents", async () => {
  const store = makeStore();
  const r = await runEnqueue(store, { commandOver: { command: "start", disposition: "start_blocked_by_stronger_suppression" } });
  assert(r.result.items[0].outcome === "ineligible_disposition", "ineligible");
  assert(store.rows.size === 0, "telling a still-silenced user 'you're resumed' would be a lie");
});

check("A5. writer failures, unsupported text and non-text → ZERO intents", async () => {
  for (const over of [
    { commandOver: { disposition: "writer_unavailable" } },
    { commandOver: { disposition: "writer_integrity_violation" } },
    { commandOver: { command: "unsupported", disposition: "unsupported_command" } },
    { commandOver: { command: null, disposition: "not_command_eligible" } },
  ]) {
    const store = makeStore();
    await runEnqueue(store, over);
    assert(store.rows.size === 0, `no intent for ${safeStringify(over)}`);
  }
});

check("A6. a REPLAYED command produces ZERO new intents", async () => {
  const store = makeStore();
  const r = await runEnqueue(store, { commandOver: { replayed: true } });
  assert(r.result.items[0].outcome === "replayed", "replayed");
  assert(store.rows.size === 0, "zero intents");
});

check("A7. a destination-hash mismatch (payload vs persisted) → ZERO intents", async () => {
  const store = makeStore();
  const r = await runEnqueue(store, {
    persistedOver: { receipt: { inboundMessageId: ROW_ID, provider: ADAPTER_PROVIDER, providerMessageId: WAMID, destinationHash: "f".repeat(64), receivedAt: RECEIVED } },
  });
  assert(r.result.items[0].outcome === "destination_mismatch", "destination_mismatch");
  assert(store.rows.size === 0, "zero intents");
});

check("A8. missing persistence for a command → ZERO intents", async () => {
  const store = makeStore();
  const r = await runEnqueue(store, { persisted: [] });
  assert(r.result.items[0].outcome === "invalid_evidence", "invalid_evidence");
  assert(store.rows.size === 0, "zero intents");
});

check("A9. a DUPLICATE (replayed webhook) is a safe no-op — never a second intent", async () => {
  const store = makeStore();
  await runEnqueue(store);
  const second = await runEnqueue(store);
  assert(second.result.duplicates === 1 && second.result.enqueued === 0, `duplicate (got ${safeStringify(second.result)})`);
  assert(store.rows.size === 1, "still exactly ONE intent");
});

// ============================================================================
// Phase 8B-1B-C — ACKNOWLEDGEMENT ACCOUNT INHERITANCE
// The intent inherits PersistedInboundContext.providerAccountId and nothing else.
// ============================================================================
check("ACC1-ACC5. STOP and START intents inherit the STORED inbound account; zero ownership work", async () => {
  for (const [command, disposition] of [["stop", "stop_applied"], ["start", "start_applied"]]) {
    const store = makeStore();
    const r = await runEnqueue(store, { commandOver: { command, disposition } });
    assert(r.result.enqueued === 1, `${command}: one intent enqueued (got ${JSON.stringify(r.result.items)})`);
    const row = onlyRow(store);
    // ACC1/ACC2: the intent carries the stored account VERBATIM. ACC3: it equals the persisted inbound row's.
    assert(row.provider_account_id === ACK_ACCOUNT_ID, `${command}: intent inherits the STORED inbound account`);
    assert(row.provider_account_id === persistedItem().receipt.providerAccountId, `${command}: equals the persisted inbound row account`);
    assert(row.command === command, `${command}: command semantics unchanged`);
  }
  // ACC4/ACC5: acknowledgement creation resolves ownership ZERO times and never reads provider accounts.
  // The service holds no resolver at all, and names the accounts table nowhere in its CODE (comments stripped).
  const code = readF(SVC_SRC).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert(!/resolveOwningProviderAccount/.test(code), "the ack path performs NO ownership resolution");
  assert(!/communication_provider_accounts/.test(code), "the ack path NEVER queries communication_provider_accounts");
  assert(!/process\.env\.WHATSAPP/.test(code), "the ack path never reads environment provider identity");
  assert(!/\.update\(/.test(code), "the ack path contains NO update() — provider_account_id is bind-at-insert only");
});

check("ACC6-ACC8. duplicate preserves the original account; no second row; never reassigned", async () => {
  const store = makeStore();
  const first = await runEnqueue(store, {});
  assert(first.result.enqueued === 1, "first delivery enqueues one intent");
  const key = onlyRow(store).idempotency_key;
  const before = store.rows.size;
  // A redelivery of the SAME command: read-first finds the existing row under the SAME account → duplicate.
  const second = await runEnqueue(store, {});
  assert(second.result.duplicates === 1, `redelivery is an idempotent duplicate (got ${JSON.stringify(second.result.items)})`);
  assert(store.rows.size === before, "NO second intent row is inserted");
  assert(store.read(key).providerAccountId === ACK_ACCOUNT_ID, "the ORIGINAL account is preserved, never reassigned");
});

// C8B-1B-D6 Wave 2A-R1 REPLACED this check. It previously asserted the OPPOSITE — that a legacy-NULL
// inbound row still enqueued, yielding an intent with provider_account_id = NULL. That behaviour was the
// Class L runtime gap (readiness verdict RUNTIME_GAP_FOUND): an acknowledgement was written for a parent
// with no proven owner. Binding is now MANDATORY, so an unbound parent fails closed instead.
check("ACC9. an UNBOUND (legacy-NULL) inbound row fails closed and writes NO intent", async () => {
  const store = makeStore();
  const r = await runEnqueue(store, { persistedOver: { receipt: { providerAccountId: null } } });
  assert(r.result.items[0].outcome === "provider_account_context_missing",
    `an unbound parent fails closed (got ${JSON.stringify(r.result.items)})`);
  assert(r.result.enqueued === 0 && r.result.failed === 1, "counted as a failure, never as a success");
  assert(store.rows.size === 0, "ZERO intents written for an unbound parent");
  // A redelivery is equally refused — and still writes nothing.
  const again = await runEnqueue(store, { persistedOver: { receipt: { providerAccountId: null } } });
  assert(again.result.items[0].outcome === "provider_account_context_missing", "the redelivery is refused too");
  assert(store.rows.size === 0, "still ZERO intents after redelivery");
});

check("ACC10. MISSING/undefined account context fails closed — not treated as legacy NULL", async () => {
  const store = makeStore();
  const r = await runEnqueue(store, { persistedOver: { omitProviderAccount: true } });
  assert(r.result.items[0].outcome === "provider_account_context_missing", `fails closed (got ${JSON.stringify(r.result.items)})`);
  assert(r.result.enqueued === 0 && r.result.failed === 1, "counted as a failure, never a success");
  assert(store.rows.size === 0, "ZERO acknowledgement intents inserted");
  assert(store.reads.length === 0, "the fence trips BEFORE any intent read or write");
});

check("ACC11. a stored intent under a DIFFERENT account is a deterministic conflict — no update, no 2nd row", async () => {
  const store = makeStore();
  // Learn the global idempotency key, then reset the store and pre-seed that key under ANOTHER account.
  const probe = makeStore();
  await runEnqueue(probe, {});
  const key = onlyRow(probe).idempotency_key;
  store.seed(key, ACK_ACCOUNT_B);
  const before = store.rows.size;
  const r = await runEnqueue(store, {});
  assert(r.result.items[0].outcome === "provider_account_conflict", `deterministic conflict (got ${JSON.stringify(r.result.items)})`);
  assert(r.result.enqueued === 0, "ZERO acknowledgements enqueued on conflict");
  assert(store.rows.size === before, "ZERO second intent inserted under another account");
  assert(store.read(key).providerAccountId === ACK_ACCOUNT_B, "the EXISTING binding is preserved, never reassigned");
});

check("ACC12. a 23505 race re-reads the winner rather than assuming its own account", async () => {
  const store = makeStore();
  const probe = makeStore();
  await runEnqueue(probe, {});
  const key = onlyRow(probe).idempotency_key;
  // Read-first says absent, but the insert loses a race to a concurrent writer bound to a DIFFERENT account.
  let inserted = false;
  const r = await runEnqueue(store, {
    deps: {
      readStoredIntent: async (k) => (inserted ? store.read(k) : { kind: "absent" }),
      insertIntent: async () => { inserted = true; store.seed(key, ACK_ACCOUNT_B); return "duplicate"; },
    },
  });
  assert(r.result.items[0].outcome === "provider_account_conflict",
    `the race loser RE-READS and classifies the winner (got ${JSON.stringify(r.result.items)})`);
  assert(store.read(key).providerAccountId === ACK_ACCOUNT_B, "the winner's binding stands, unmodified");
});

check("A10. the enqueue is BEST-EFFORT — an insert failure never escapes and never leaks", async () => {
  const store = makeStore();
  const r = await runEnqueue(store, { deps: { insertIntent: async () => { throw new Error("SQLSTATE 08006 +919812345678"); } } });
  assert(r.ok === true, "always ok:true — the consent command already stands");
  assert(r.result.items[0].outcome === "enqueue_failed", "closed outcome");
  hasNot(/SQLSTATE|08006|\+9198/, safeStringify(r), "no DB error, no phone");
});

check("A11. NO plaintext destination in evidence, keys, metadata or results", async () => {
  const store = makeStore();
  const r = await runEnqueue(store);
  const rendered = safeStringify(r) + safeStringify(onlyRow(store));
  hasNot(new RegExp(E164.replace("+", "\\+")), rendered, "no plaintext phone anywhere");
  hasNot(new RegExp(WA_ID), rendered, "no wa_id anywhere");
});

check("A12. the RATE-LIMIT key is stable within the window and distinct per command", () => {
  const k1 = M.Pure.deriveAckIdempotencyKey("consent_stop_acknowledgement", "stop", DEST_HASH, RECEIVED);
  const k2 = M.Pure.deriveAckIdempotencyKey("consent_stop_acknowledgement", "stop", DEST_HASH, "2026-07-13T10:05:00.000Z");
  assert(k1 === k2, "same 15-minute bucket ⇒ same key");
  const kHelp = M.Pure.deriveAckIdempotencyKey("consent_help_response", "help", DEST_HASH, RECEIVED);
  assert(k1 !== kHelp, "a STOP ack never suppresses a later HELP response");
});

// ============================================================================
// B. BOUNDARIES
// ============================================================================
check("B1. the ORDINARY D3-B registry REJECTS all three acknowledgement types", () => {
  const reg = readF(REGISTRY_SRC);
  for (const t of M.Pure.CONSENT_ACK_TYPES) {
    hasNot(new RegExp(t), reg, `${t} must NOT be in the ordinary D3-B registry`);
    assert(!M.Registry.REGISTERED_MESSAGE_TYPES.includes(t), `${t} is not a registered ordinary type`);
    const r = M.Registry.resolveOutboundConsentScope({ messageType: t, lane: "authentication", channel: "whatsapp" });
    assert(r.ok === false && r.reason === "UNCLASSIFIED_MESSAGE_TYPE", `ordinary D3-B denies ${t} (got ${safeStringify(r)})`);
  }
});

check("B2. the ENQUEUE path decides nothing, sends nothing, and has no bypass capability", () => {
  const code = stripTs(readF(SVC_SRC));
  // D4-C moved every send-time decision to the WORKER. The enqueue path must have none of it.
  hasNot(/decideCommunicationConsent|deps\.decide/, code, "it never calls D2-C");
  hasNot(/createRuntimeCommunicationService|new CommunicationService|\.send\(/, code, "it never sends");
  hasNot(/fetch\(|axios|https?:\/\/[a-z]/, code, "no direct provider call");
  hasNot(/n8n|jarvis/i, code, "no n8n, no Jarvis");
  // NO BYPASS CAPABILITY of any shape.
  hasNot(/bypass|ignoreSuppression|forceSend|skipConsent|allowAnyway|override/i, code, "no bypass flag exists");
});

check("B3. only metaWhatsAppWebhookService is a PRODUCTION caller of the enqueue entry point", () => {
  const hits = execFileSync("git", ["grep", "-l", "enqueueConsentCommandResponses", "--", "*.ts", "*.tsx"], { encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean);
  const callers = hits.filter((f) => f !== SVC_SRC);
  assert(callers.length === 1 && callers[0] === WEBHOOK_SRC, `only the webhook calls it (got ${safeStringify(callers)})`);
});

check("B4. the webhook ENQUEUES after D2-E, and never fails the command flow", () => {
  const code = readF(WEBHOOK_SRC);
  const iPersist = code.indexOf("deps.handleInbound(");
  const iCommands = code.indexOf("deps.processCommands(");
  const iGuard = code.indexOf("inbound_command_processing_failed");
  const iEnqueue = code.indexOf("await deps.enqueueAcks(");
  assert(iPersist > 0 && iPersist < iCommands, "persist precedes command processing");
  assert(iCommands < iGuard && iGuard < iEnqueue, "a FAILED command returns BEFORE the enqueue");
  const before = code.slice(Math.max(0, iEnqueue - 400), iEnqueue);
  has(/try\s*\{/, before, "the enqueue sits inside a try");
  has(/\}\s*catch\s*\{/, code.slice(iEnqueue, iEnqueue + 600), "…with a catch that swallows");
  // The OLD inline send is gone, and the worker is never run inline.
  hasNot(/processConsentCommandResponses/, stripTs(code), "the inline send is GONE");
  hasNot(/processConsentAckIntents|consentAckWorkerService/, stripTs(code), "the worker never runs inline");
});

check("B5. Phase 8A authority transfer is BOUNDED; D4-B's own authorities stay frozen; no SQL/env/provider", () => {
  // 1) ANCESTRY. Both endpoints exist; base → implementation head → HEAD.
  for (const [sha, what] of [[PHASE_8A_AUTHORITY_BASE, "Phase 7 authority base"], [PHASE_8A_IMPLEMENTATION_HEAD, "Phase 8A implementation head"]]) {
    const t = execFileSync("git", ["cat-file", "-t", sha], { encoding: "utf8" }).trim();
    assert(t === "commit", `the ${what} commit must exist (got ${t})`);
  }
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8A_AUTHORITY_BASE, PHASE_8A_IMPLEMENTATION_HEAD]);
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8A_IMPLEMENTATION_HEAD, "HEAD"]);

  // 2) THE FIXED HISTORICAL RANGE — membership first, forbidden categories second. Never reads HEAD.
  validatePhase8AHistoricalRange();

  // 3) The release is NARROW: exactly two shared authorities, each of which genuinely WAS frozen.
  assert(PHASE_8A_RELEASED_SHARED_AUTHORITIES.length === 2, "exactly TWO shared authorities are released");
  for (const f of PHASE_8A_RELEASED_SHARED_AUTHORITIES) {
    assert(FROZEN.includes(f), `a released file must have genuinely BEEN frozen: ${f}`);
  }

  // 4) WORKTREE PROTECTION — narrow, and only over what D4-B owns. It does not police future-phase files.
  const dirty = gitDirty();
  for (const f of D4B_OWNED_AUTHORITIES) {
    assert(!dirty.includes(f), `a D4-B-owned authority must not change: ${f}`);
  }
  // ── C8B-1B-C RUNTIME BYTE-FREEZE (Part B hardening) ────────────────────────────────────────────────
  // The dirty-file authority above still applies. This ADDS an exact byte freeze so a COMMITTED edit is
  // caught too, not just an uncommitted one. Fixed literals throughout — never a moving HEAD.
  //
  // AUTHORITY SCOPE — this transfer covers ONLY: provider_account_id inheritance from the durable inbound
  // context; read-first duplicate/conflict handling; missing-context fail-closed behaviour; the 23505
  // stored-winner re-read; no reassignment or provider_account_id UPDATE; and no second ownership
  // resolution. Nothing else about the service is authorised by this record.
  //
  // ── C8B-1B-D6 WAVE 2A-R1 AUTHORITY TRANSFER ────────────────────────────────────────────────────────
  // The C8B-1B-C pin below is PRESERVED as the historical predecessor and is still verified against
  // history — its blob authority is never rewritten. What MOVED is the ON-DISK pin, which now points at
  // the Wave 2A-R1 successor.
  //
  // WHAT CHANGED, AND WHY THE PREDECESSOR PIN COULD NOT SIMPLY BE KEPT: C8B-1B-C's scope included
  // "explicit legacy NULL preservation" — a persisted parent inbound row with a NULL provider_account_id
  // was INHERITED as null and the acknowledgement intent was enqueued UNBOUND. The Wave 2A readiness audit
  // classified that as the Class L runtime gap (RUNTIME_GAP_FOUND). Wave 2A-R1 removes it: a stored NULL
  // now fails closed as `provider_account_context_missing`, exactly like an absent or malformed value.
  // Legacy-NULL preservation is therefore NO LONGER part of the authorised scope; the successor scope
  // REPLACES it with mandatory binding.
  const C8B1BC_IMPLEMENTATION_HEAD = "e742bb149b635f63b00975fa93be0a5fc14a2e24";
  const C8B1BC_ACK_SERVICE_BLOB = "13d79a44ae10708f42c3afffbe8695d9418e61f0";
  const W2AR1_IMPLEMENTATION_HEAD = "8a81dcd37e406f39c070a95c0c326732e5550cd2";
  const W2AR1_ACK_SERVICE_BLOB = "2cfe25f7a149d024cf42f761df30388b8b4d9528";
  for (const [sha, what] of [[C8B1BC_IMPLEMENTATION_HEAD, "C8B-1B-C"], [W2AR1_IMPLEMENTATION_HEAD, "C8B-1B-D6 Wave 2A-R1"]]) {
    assert(execFileSync("git", ["cat-file", "-t", sha], { encoding: "utf8" }).trim() === "commit",
      `the ${what} implementation commit ${sha.slice(0, 12)} must exist`);
  }
  // FORWARD-ONLY LINEAGE: base → predecessor → successor → HEAD. Each throws if violated.
  execFileSync("git", ["merge-base", "--is-ancestor", D4B_BASE, C8B1BC_IMPLEMENTATION_HEAD]);
  execFileSync("git", ["merge-base", "--is-ancestor", C8B1BC_IMPLEMENTATION_HEAD, W2AR1_IMPLEMENTATION_HEAD]);
  execFileSync("git", ["merge-base", "--is-ancestor", W2AR1_IMPLEMENTATION_HEAD, "HEAD"]);
  // HISTORICAL BLOB AUTHORITY — the predecessor's reviewed content is still pinned and must never drift.
  const predecessorAckBlob = execFileSync("git", ["rev-parse", `${C8B1BC_IMPLEMENTATION_HEAD}:${SVC_SRC}`], { encoding: "utf8" }).trim();
  assert(predecessorAckBlob === C8B1BC_ACK_SERVICE_BLOB,
    `the C8B-1B-C commit must still resolve ${SVC_SRC} to its historical blob (got ${predecessorAckBlob.slice(0, 12)})`);
  // SUCCESSOR BLOB AUTHORITY — the reviewed Wave 2A-R1 content.
  const reviewedAckBlob = execFileSync("git", ["rev-parse", `${W2AR1_IMPLEMENTATION_HEAD}:${SVC_SRC}`], { encoding: "utf8" }).trim();
  assert(reviewedAckBlob === W2AR1_ACK_SERVICE_BLOB,
    `the reviewed commit must resolve ${SVC_SRC} to its approved blob (got ${reviewedAckBlob.slice(0, 12)})`);
  // THE SUCCESSOR MUST GENUINELY DIFFER — a "transfer" onto an identical blob would be a no-op record.
  assert(W2AR1_ACK_SERVICE_BLOB !== C8B1BC_ACK_SERVICE_BLOB,
    "an authority transfer must move to a DIFFERENT reviewed blob");
  const onDiskAckBlob = execFileSync("git", ["hash-object", SVC_SRC], { encoding: "utf8" }).trim();
  assert(onDiskAckBlob === W2AR1_ACK_SERVICE_BLOB,
    `${SVC_SRC} is not byte-identical to its C8B-1B-D6 Wave 2A-R1 baseline (commit ${W2AR1_IMPLEMENTATION_HEAD.slice(0, 12)}). ` +
    `A change — dirty OR committed — requires an EXPLICIT AUTHORITY TRANSFER (on-disk ${onDiskAckBlob.slice(0, 12)} != pinned ${W2AR1_ACK_SERVICE_BLOB.slice(0, 12)}).`);
  // THE SUCCESSOR AUTHORITY MUST EXIST AS EXECUTABLE CODE — a transfer may not be left unbacked.
  const w2ar1Harness = "scripts/phase8b1bd6w2ar1-consent-ack-null-parent-account-guard-harness.mjs";
  assert(existsSync(w2ar1Harness), `the Wave 2A-R1 harness must exist: ${w2ar1Harness}`);
  const w2ar1Code = readF(w2ar1Harness)
    .split("\n").filter((l) => { const t = l.trim(); return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")); }).join("\n");
  has(/B2\.2 NULL parent account → ZERO insert attempts/, w2ar1Code, "the successor must assert the zero-insert proof");
  has(/S1\.9 the function body performs no/, w2ar1Code, "the successor must assert no raw-null comparison survives");
  // EXACT lower bound, measured against the reviewed successor (5 distinct zero-insert assertion sites:
  // the NULL-parent proof, the absent/undefined/malformed loop, and the three duplicate/conflict proofs).
  // Deleting any one of them drops below this floor and fails here — which is the point.
  assert((w2ar1Code.match(/calls\.insert\.length === 0/g) ?? []).length >= 5,
    "the zero-insert invariant must be asserted in executable successor check bodies");

  // ── C8B-1B-D6 WAVE 2A-R1 EVIDENCE-REPAIR FREEZE ────────────────────────────────────────────────
  // The independent audit of PR #16 found that the successor harness carried TWO checks that could
  // not fail: both searched a string-ERASING view for evidence that only exists inside string
  // literals, so an injected `.from("communication_provider_accounts")` and an injected resolver
  // import were accepted. Content assertions alone did not catch that — the checks were present,
  // they simply did nothing. So the successor is now pinned by EXACT BLOB as well as by content,
  // and the specific properties that were vacuous are asserted directly.
  // ── EXPLICIT AUTHORITY TRANSFER — QF-MVP-40.1-R ────────────────────────────────────────────────
  // The pin has moved TWICE since the evidence-repair freeze. Both hops were reviewed before the
  // pin was touched; neither relaxed a successor property.
  //
  //   2ab3a76e  (commit 32b640c, evidence repair — the originally frozen blob)
  //     ↓ commit 6fc9a92 "Phase 8B-1B-D6 Wave 2A-R2: add consent-ack account constraint"
  //   5c5f5ec9  Wave 2A-R2 TIGHTENED the successor's own scope fence: "NO Wave 2A-R2 ack-intent
  //             constraint migration exists yet" became "exactly one approved Wave 2A-R2 migration
  //             exists, matched by full path". An obsolete must-not-exist fence became an
  //             exact-identity invariant — strictly stronger, not weaker.
  //     ↓ QF-MVP-40.1-R (this task)
  //   3cc0b409  The successor's scope diff ended at a moving `HEAD`, so it re-asserted a HISTORICAL
  //             narrowness claim against every later phase and failed once QF-MVP-20/30 landed.
  //             Both range endpoints are now literal, and a new SC0.1 asserts the pinned end is a
  //             real ancestor of HEAD. No assertion was deleted, downgraded or made conditional.
  //
  // The anti-vacuity properties this freeze exists to protect are ALSO asserted directly below
  // (the string-PRESERVING detector block) and above (the zero-insert invariant count), so they
  // remain enforced by content regardless of the blob value.
  const W2AR1_HARNESS_BLOB = "3cc0b409ea9f63b5ed3e1ada475c5a4092061cfb";
  const onDiskW2AR1 = execFileSync("git", ["hash-object", w2ar1Harness], { encoding: "utf8" }).trim();
  assert(onDiskW2AR1 === W2AR1_HARNESS_BLOB,
    `${w2ar1Harness} is not byte-identical to its reviewed Wave 2A-R1 evidence-repair blob. ` +
    `A change — dirty OR committed — requires an EXPLICIT AUTHORITY TRANSFER ` +
    `(on-disk ${onDiskW2AR1.slice(0, 12)} != pinned ${W2AR1_HARNESS_BLOB.slice(0, 12)}).`);

  // THE ANTI-VACUITY RULE ITSELF. The two repaired predicates must read the string-PRESERVING view.
  // Reverting either to `stripNonCode` reintroduces the exact audited defect and fails here.
  const detectorBlock = readF(w2ar1Harness).slice(
    readF(w2ar1Harness).indexOf("const queriesAccountsTable"),
    readF(w2ar1Harness).indexOf("/** The executable body of `inheritPersistedAccount`"));
  assert(detectorBlock.length > 0, "the successor must define the string-carried evidence predicates");
  assert(detectorBlock.includes("stripComments(src)"),
    "the repaired predicates must read stripComments (string-preserving)");
  assert(!detectorBlock.includes("stripNonCode"),
    "the repaired predicates must NOT read stripNonCode — that is the audited vacuity defect");

  // The repaired checks and their self-tests must be present AS EXECUTABLE CODE.
  has(/S4\.7 the service issues no direct/, w2ar1Code, "the successor must assert the direct-query invariant");
  has(/S4\.8 the service imports no provider-account resolver module/, w2ar1Code, "the successor must assert the import invariant");
  // Each ST family must be registered as executable code. ST1/ST2 are POSITIVE self-tests (a
  // violating sample must be DETECTED), ST3/ST4 are negative controls, ST5/ST6 assert the predicates
  // are non-constant, ST7 is the anti-vacuity regression guard. Several are emitted from loops, so
  // the source registration count is smaller than the runtime check count — assert the families.
  for (const fam of ["ST1", "ST2", "ST3", "ST4", "ST5", "ST6", "ST7"]) {
    assert(new RegExp(`add\\(\`?"?${fam} `).test(w2ar1Code),
      `the successor must register the ${fam} string-evidence self-test`);
  }
  // The direct-query mutation family (audit finding F3) must exist and must be expected to be KILLED.
  const m13 = [...w2ar1Code.matchAll(/M13\$\{id\}|M13[a-e]/g)].length;
  assert(m13 > 0, "the successor must register the direct provider-accounts-query mutation (F3)");
  has(/ACCOUNTS_TABLE_QUERY_RE/, w2ar1Code, "the successor must define the direct-query detector");
  has(/RESOLVER_IMPORT_RE/, w2ar1Code, "the successor must define the resolver-import detector");
  for (const f of STILL_FROZEN) {
    assert(!dirty.includes(f), `a FROZEN authority must not change: ${f}`);
  }

  // 5) AUTHORITY-TRANSFER WIRING CHECK — the transferred-to authority must exist AS EXECUTABLE CODE.
  //    Line-oriented comment filtering: D3-B contains `/*` inside a string literal, so a block-comment regex
  //    would swallow the very registrations being checked. A registration quoted in a comment sits on a line
  //    starting with `//` or `*` and is dropped.
  const d3bCode = readF("scripts/phase5f-d3b-outbound-consent-enforcement-harness.mjs")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("*/"));
    })
    .join("\n");
  const registeredChecks = [...d3bCode.matchAll(/^\s*check\("P8A-(\d+[a-z]?)\./gm)].map((m) => m[1]);
  assert(registeredChecks.length >= 17, `D3-B must REGISTER the Phase 8A checks as executable code (found ${registeredChecks.length})`);
  for (const id of ["14", "15", "16", "17"]) {
    assert(registeredChecks.includes(id), `D3-B must register the P8A-${id} structural check`);
  }
  const registeredMutations = [...d3bCode.matchAll(/^\s*srcMutationN?\("(MUT \d+[a-z]?) \(8A\)/gm)].map((m) => m[1]);
  assert(registeredMutations.length >= 12, `D3-B must REGISTER the Phase 8A mutations as executable code (found ${registeredMutations.length})`);
  const zeroCallAssertions = (d3bCode.match(/providerCalls === 0/g) ?? []).length;
  assert(zeroCallAssertions >= 8, `the zero-provider-call invariant must be asserted in executable check bodies (found ${zeroCallAssertions})`);
  has(/expectCompileFailure/, d3bCode, "D3-B's mutation runner enforces the strict compile contract");

  // 6) The D2-E harness delta stays byte-bounded whenever it is touched.
  if (dirty.includes(D2E_HARNESS_SRC) || phase8aRangeFiles().includes(D2E_HARNESS_SRC)) {
    const problems = validateD2EHarnessDelta();
    assert(problems.length === 0, `D2-E harness change is out of bounds: ${problems.join(" | ")}`);
  }
  const all = [readF(PURE_SRC), readF(SVC_SRC)].join("\n");
  hasNot(/insert into|create table|alter table|communication_templates/i, all, "no SQL, no template seed");
});

check("B6. wiring: the d4b + d4c scripts and docs exist; the D4-C doc records the moved proofs", () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:d4b"] === "node scripts/phase5f-d4b-consent-command-response-harness.mjs", "d4b script");
  assert(pkg.scripts["test:phase5f:d4c"] === "node scripts/phase5f-d4c-consent-ack-async-harness.mjs", "d4c script");
  assert(existsSync(DOC_SRC) && existsSync(D4C_DOC_SRC), "both docs exist");
  const d4c = readF(D4C_DOC_SRC);
  has(/D4-B/, d4c, "the D4-C doc references D4-B");
  has(/one-shot|enforcer/i, d4c, "…and records where the one-shot enforcer moved");
});

// ============================================================================
// W. THE REAL WEBHOOK — behavioural, through the actual exported handler
// ============================================================================
function buildWebhook(over = {}) {
  const dir = resolve(`.phase5fd4b-wh-${Math.random().toString(36).slice(2, 8)}`);
  rmSync(dir, { recursive: true, force: true });
  const tsconfigPath = resolve(`${dir}.tsconfig.json`);
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: false, isolatedModules: true,
      outDir: dir, rootDir: ".", types: [], noResolve: true,
    },
    files: [WEBHOOK_SRC],
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  catch { /* expected noResolve diagnostics */ }
  finally { rmSync(tsconfigPath, { force: true }); }
  if (!existsSync(resolve(dir, "services/metaWhatsAppWebhookService.js"))) throw new Error("webhook did not transpile");

  const order = [];
  const calls = { persist: 0, commands: 0, enqueue: 0, ownershipResolutions: 0 };
  const inboundResult = over.inboundResult ?? {
    ok: true,
    result: {
      receiptId: RECEIPT_ID, receiptDuplicate: false, messagesSeen: 1, messagesPersisted: 1,
      messagesDuplicate: 0, messagesRejected: 0, identityExact: 0, identityAmbiguous: 0, identityUnknown: 1,
      processed: [persistedItem()],
    },
  };
  const commandsResult = over.commandsResult ?? {
    ok: true,
    result: { candidates: 1, skippedNotEligible: 0, helpAcknowledged: 0, unsupported: 0, writerInvocations: 1, applied: 1, replayed: 0, deterministicFailures: 0, items: [commandItem()] },
  };

  // PHASE 8A — the webhook now binds an explicit FAIL-CLOSED consent enforcer to the CommunicationService
  // it builds for delivery receipts. This isolated build compiles the webhook ALONE (`noResolve`), so the
  // enforcer module must be stubbed. The stub is deliberately minimal and SAFE BY CONSTRUCTION:
  //   • it exposes exactly the one symbol the webhook imports;
  //   • its enforcer can only ever answer `unavailable` — it has no branch that returns `allow`;
  //   • it makes no provider call, touches no Supabase, and imports no production infrastructure;
  //   • it COUNTS `authorize` calls, so "the webhook-only path never even consults consent" is PROVEN by a
  //     counter rather than assumed. (The webhook processes delivery receipts; it must never send, so it
  //     must never need an authorization either.)
  const consent = { authorizeCalls: 0 };
  const STUBS = {
    "../lib/supabase": { adminClient: () => { throw new Error("db must not be touched on the inbound branch"); } },
    "./communicationService": { CommunicationService: class {} },
    "./outboundConsentEnforcementService": {
      createFailClosedOutboundConsentEnforcer: () => ({
        authorize: async () => {
          consent.authorizeCalls++;
          return { kind: "unavailable", code: "CONSENT_AUTHORITY_UNAVAILABLE", retryable: true };
        },
      }),
    },
    // Phase 8B-1B-C — the webhook now proves provider-account OWNERSHIP before any effect-bearing write.
    // The resolver is stubbed to the ONE account that owns this fixture's exact payload identity; it is a
    // narrow conditional mirror of the real resolver, NOT an unconditional allow-all: a callback whose
    // phone/WABA do not match the fixture resolves to `not_found` and produces zero effects.
    "./communicationProviderRuntimeService": {
      isWebhookProcessingEnabled: async () => true,
      resolveOwningProviderAccount: async ({ phoneNumberReference, expectedWabaId }) => {
        calls.ownershipResolutions++;
        if (phoneNumberReference !== WEBHOOK_PHONE_NUMBER_ID) return { kind: "not_found" };
        if (expectedWabaId !== WEBHOOK_WABA_ID) return { kind: "waba_mismatch" };
        return {
          kind: "owned",
          account: {
            id: ACK_ACCOUNT_ID, provider_key: "meta_whatsapp_cloud", channel: "whatsapp",
            business_account_reference: WEBHOOK_WABA_ID, phone_number_reference: WEBHOOK_PHONE_NUMBER_ID,
          },
        };
      },
    },
    // The PURE payload identity extractor and the PURE closed attribution decision (Stage 1). They are
    // transpiled in isolation here (noResolve), so they are provided as faithful local mirrors.
    "../lib/communication/providers/metaWebhookAccountIdentity": {
      extractMetaWebhookAccountIdentity: (payload) => {
        const entries = payload && Array.isArray(payload.entry) ? payload.entry : [];
        let waba = null, phone = null, conflict = false;
        for (const e of entries) {
          const changes = e && Array.isArray(e.changes) ? e.changes : [];
          for (const c of changes) {
            if (!c || c.field !== "messages") continue;
            const md = c.value && typeof c.value === "object" ? c.value.metadata : null;
            const p = md && typeof md.phone_number_id === "string" ? md.phone_number_id : null;
            const w = typeof e.id === "string" ? e.id : null;
            if (p === null || w === null) continue;
            if (phone !== null && (phone !== p || waba !== w)) conflict = true;
            phone = p; waba = w;
          }
        }
        if (conflict || phone === null || waba === null) return { kind: "no_identity" };
        return { kind: "phone_identity", wabaId: waba, phoneNumberId: phone };
      },
    },
    "../lib/communication/inboundProviderAccountAttribution": {
      decideInboundAttribution: (ownership) => {
        if (ownership.kind === "owned") return { kind: "owned", accountId: ownership.account.id };
        if (ownership.kind === "query_error") return { kind: "retry", code: "LOOKUP_FAILED", reason: "lookup failed" };
        return { kind: "rejected", code: "NOT_FOUND", reason: "not owned" };
      },
    },
    "../lib/communication/providers/metaCloudWhatsAppConfig": {
      resolveWebhookSignatureConfig: () => ({ ok: true, config: { appSecret: "secret" } }),
      resolveWebhookVerifyConfig: () => ({ ok: true, config: { webhookVerifyToken: "t" } }),
      webhookSignatureToRuntime: () => ({}),
      // Phase 8B-1A — the identity gate resolves the expected identity here. TEST-ONLY: no env read, no
      // access token, no network/DB, no production secret; returns exactly the deterministic fixture ids.
      resolveWebhookIdentityConfig: () => ({ ok: true, config: { wabaId: WEBHOOK_WABA_ID, phoneNumberId: WEBHOOK_PHONE_NUMBER_ID } }),
    },
    "../lib/communication/providers/metaCloudWhatsAppProvider": {
      MetaCloudWhatsAppProvider: class {}, META_WHATSAPP_CLOUD_PROVIDER_KEY: "meta_whatsapp_cloud",
    },
    "../lib/communication/httpTransport": { FetchHttpTransport: class {} },
    "../lib/communication/providers/metaWhatsAppWebhook": {
      META_SIGNATURE_HEADER: "x-hub-signature-256",
      // The existing string verifier stub stays: the internal downstream defence-in-depth path still calls it.
      verifyMetaWebhookSignature: () => true,
      // Phase 8B-1A — the production service imports the byte verifier + identity authority via THIS re-export
      // module. D4-B is NOT the signature-authority harness, so the byte verifier deterministically accepts
      // its test invocation (the dedicated Phase 8B-1A harness owns strict grammar). The identity authority is
      // the NARROW, conditional local mirror — NOT an unconditional allow-all.
      verifyMetaWebhookSignatureBytes: () => true,
      decideCallbackIdentity: (payload) => stubDecideCallbackIdentity(payload),
      classifyMetaWebhook: () => "inbound_message",
      MetaWebhookClassification: {
        DELIVERY_STATUS: "delivery_status", INBOUND_MESSAGE: "inbound_message",
        TEMPLATE_STATUS: "template_status", ACCOUNT_STATUS: "account_status", UNKNOWN: "unknown",
      },
      deriveMetaWebhookEventId: () => "evt-1",
      metaWebhookPayloadHash: () => "h".repeat(64),
      verifyMetaWebhookGetChallenge: () => ({ ok: false }),
    },
    "./inboundWhatsAppMessageService": {
      handleInboundWhatsAppMessages: async () => { calls.persist++; order.push("persist"); return inboundResult; },
    },
    "./inboundConsentCommandService": {
      processInboundConsentCommands: async () => {
        calls.commands++;
        order.push("d2d_write");     // the AUTHORITATIVE write happens INSIDE the D2-E orchestrator
        order.push("commands");
        return commandsResult;
      },
    },
    "./consentCommandResponseService": {
      enqueueConsentCommandResponses: async () => {
        calls.enqueue++;
        order.push("enqueue");
        if (over.enqueueThrows) throw new Error("enqueue exploded: SQLSTATE 08006 +919812345678");
        return over.enqueueResult ?? { ok: true, result: { candidates: 1, enqueued: 1, duplicates: 0, skipped: 0, failed: 0, items: [] } };
      },
    },
  };

  const req = createRequire(`${dir}/`);
  const Module = req("module");
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return original.apply(this, [request, parent, isMain]);
  };
  const mod = req("./services/metaWhatsAppWebhookService.js");
  Module._load = original;
  return { mod, order, calls, consent, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const postWebhook = async (over = {}) => {
  const w = buildWebhook(over);
  try {
    const res = await w.mod.handleMetaWhatsAppWebhookPost({
      rawBody: JSON.stringify(envelope(textMsg())),
      signature: "sha256=deadbeef",
    });
    return { res, order: w.order, calls: w.calls, consent: w.consent };
  } finally { w.cleanup(); }
};

check("W-CONTROL. the real webhook reaches the INBOUND branch and ENQUEUES exactly once", async () => {
  const { res, calls, order } = await postWebhook();
  // The historical public symbol `handleMetaWhatsAppWebhookPost` (driven by postWebhook) now enters the GATED
  // pipeline: byte signature → decode → parse → identity gate → runtime gate → INBOUND persist/command/enqueue.
  assert(res.status === 200 && res.result === "inbound_processed", `200/inbound_processed (got ${safeStringify(res)})`);
  assert(calls.persist === 1 && calls.commands === 1 && calls.enqueue === 1, "persist, commands and enqueue each ran once");
  assert(order.join(",") === "persist,d2d_write,commands,enqueue", `order: ${order.join(",")}`);

  // ── Phase 8B-1A identity-precondition structural proof (D4-B does NOT own the identity implementation) ──
  // 1. the isolated identity stub is NOT unconditional — the EXACT fixture identity authorizes …
  const authorized = stubDecideCallbackIdentity(envelope(textMsg()));
  assert(authorized.kind === "authorized", `the fixture WABA+phone identity authorizes (got ${JSON.stringify(authorized)})`);
  // … a FOREIGN WABA does NOT return authorized …
  const foreignWaba = stubDecideCallbackIdentity({ object: "whatsapp_business_account", entry: [{ id: "999999999999999", changes: [{ field: "messages", value: { metadata: { phone_number_id: WEBHOOK_PHONE_NUMBER_ID } } }] }] });
  assert(foreignWaba.kind === "rejected" && foreignWaba.reason === "foreign_waba", `a foreign WABA is rejected, never authorized (got ${JSON.stringify(foreignWaba)})`);
  // … and a FOREIGN phone-number id does NOT return authorized (display_phone_number is never identity).
  const foreignPhone = stubDecideCallbackIdentity({ object: "whatsapp_business_account", entry: [{ id: WEBHOOK_WABA_ID, changes: [{ field: "messages", value: { metadata: { display_phone_number: WEBHOOK_PHONE_NUMBER_ID, phone_number_id: "999888777" } } }] }] });
  assert(foreignPhone.kind === "rejected" && foreignPhone.reason === "foreign_phone_number", `a foreign phone id is rejected, never authorized (got ${JSON.stringify(foreignPhone)})`);
  // 2. the PRODUCTION downstream stage remains NON-EXPORTED, and the historical public handler is the GATED wrapper.
  const svc = readF(WEBHOOK_SRC);
  assert(/async function processVerifiedExpectedMetaWebhook\(/.test(svc) && !/export\s+(async\s+)?function\s+processVerifiedExpectedMetaWebhook/.test(svc), "the production downstream stage is non-exported");
  assert(/export function handleMetaWhatsAppWebhookPost\(\s*input:[\s\S]{0,600}return handleMetaWhatsAppWebhookPostBytes\(/.test(svc), "the historical public handler is the gated compatibility wrapper");
});

check("W-8A. the webhook-only path NEVER consults consent and NEVER reaches a send path", async () => {
  // PHASE 8A. The webhook binds a fail-closed enforcer defensively — but a webhook that PROCESSES DELIVERY
  // RECEIPTS should never need an authorization at all. Prove the defence is dormant, not load-bearing:
  // `authorize` is never invoked on any webhook execution, so binding it changed no behaviour whatsoever.
  const inbound = await postWebhook();
  assert(inbound.consent.authorizeCalls === 0,
    `the inbound branch never consults consent (got ${inbound.consent.authorizeCalls})`);

  // …and it holds on a FAILING enqueue too, where the error path could otherwise wander somewhere new.
  const thrown = await postWebhook({ enqueueThrows: true });
  assert(thrown.consent.authorizeCalls === 0,
    `even a throwing enqueue never consults consent (got ${thrown.consent.authorizeCalls})`);

  // The webhook still reaches NO send path in source: no send, no dispatch, no runtime factory.
  const code = stripTs(readF(WEBHOOK_SRC));
  hasNot(/\.send\(|dispatchMessage\(|dispatchPersistedMessage\(|createRuntimeCommunicationService/, code,
    "the webhook never sends, dispatches, or builds a sending service");
  // The ONLY CommunicationService operation it performs remains processWebhook.
  const ops = [...code.matchAll(/service\.([A-Za-z]+)\(/g)].map((m) => m[1]);
  assert(ops.length > 0 && ops.every((o) => o === "processWebhook"),
    `processWebhook is the ONLY CommunicationService operation used (got [${ops.join(", ")}])`);
  // …and it binds the FAIL-CLOSED enforcer, never the real one and never an allow-all.
  has(/createFailClosedOutboundConsentEnforcer\(\)/, code, "it binds the FAIL-CLOSED enforcer");
  hasNot(/createOutboundConsentEnforcer\(/, code, "it never binds the REAL consent authority");
  hasNot(/allowAll|alwaysAllow|permitAll/i, code, "it never defines or imports an allow-all enforcer");
});

check("W-A. a THROWING enqueue leaves the HTTP status and body IDENTICAL to the control", async () => {
  const control = await postWebhook();
  const thrown = await postWebhook({ enqueueThrows: true });
  assert(thrown.calls.persist === 1 && thrown.calls.commands === 1, "persistence and command processing still ran");
  assert(safeStringify(thrown.res) === safeStringify(control.res), "the response is byte-identical");
  const rendered = safeStringify(thrown.res);
  hasNot(/SQLSTATE|exploded|enqueue|intent/i, rendered.replace(/inbound_processed/g, ""), "no enqueue internals leak");
  hasNot(/\+9198/, rendered, "no plaintext phone");
});

check("W-B. a FAILED / duplicate enqueue leaves the HTTP status and body IDENTICAL to the control", async () => {
  const control = await postWebhook();
  for (const outcome of ["enqueue_failed", "duplicate", "seal_unavailable", "receipt_not_found"]) {
    const r = await postWebhook({
      enqueueResult: { ok: true, result: { candidates: 1, enqueued: 0, duplicates: 0, skipped: 0, failed: 1, items: [{ inboundMessageId: ROW_ID, ackType: null, outcome }] } },
    });
    assert(safeStringify(r.res) === safeStringify(control.res), `${outcome}: identical to the control`);
    assert(!safeStringify(r.res).includes(outcome), `${outcome}: never leaks into the response`);
  }
});

check("W-C. when COMMAND PROCESSING fails, the enqueue is NEVER invoked", async () => {
  const { res, calls, order } = await postWebhook({ commandsResult: { ok: false, code: "inbound_command_write_unavailable", result: { items: [] } } });
  assert(calls.enqueue === 0, "the enqueue was NEVER called");
  assert(!order.includes("enqueue"), "…and never appears in the call order");
  assert(res.status === 500 && res.code === "inbound_command_processing_failed", "the existing failure outcome is unchanged");
});

check("W-D. order is persist → completed command/write → enqueue; a persist failure stops everything", async () => {
  const { order } = await postWebhook();
  const iP = order.indexOf("persist"), iW = order.indexOf("d2d_write"), iC = order.indexOf("commands"), iE = order.indexOf("enqueue");
  assert(iP === 0, "persistence is first");
  assert(iP < iW && iW < iE, "the AUTHORITATIVE write precedes the enqueue");
  assert(iC < iE, "the enqueue runs only after command processing COMPLETED");
  const failed = await postWebhook({ inboundResult: { ok: false, code: "inbound_persist_failed", result: { processed: [] } } });
  assert(failed.calls.commands === 0 && failed.calls.enqueue === 0, "a persistence failure invokes neither");
  assert(failed.res.status === 500 && failed.res.code === "inbound_processing_failed", "unchanged");
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutationChecks = [];
function srcMutation(name, file, from, to, scenario) { mutationChecks.push({ name, kind: "src", edits: [{ file, from, to }], scenario }); }
function fnMutation(name, scenario) { mutationChecks.push({ name, kind: "fn", edits: [], scenario }); }

async function withMutatedBuild(fn) {
  const dir = resolve(`.phase5fd4b-mut-${Math.random().toString(36).slice(2, 8)}`);
  try {
    compileTo(dir);
    transpileService(dir);
    return await fn(wireBuild(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

srcMutation("MUT 1: the webhook ENQUEUES BEFORE the command result is checked",
  WEBHOOK_SRC,
  `    const commands = await deps.processCommands(inbound.result.processed);
    if (!commands.ok) return { status: 500, code: "inbound_command_processing_failed" };`,
  `    const commands = await deps.processCommands(inbound.result.processed);`,
  // BEHAVIOURAL. `postWebhook` TRANSPILES AND RUNS the mutated production handler. With the guard gone, a
  // FAILED consent command no longer short-circuits, so the acknowledgement intent is enqueued for a command
  // that never committed — the exact ordering violation W-C exists to forbid.
  () => (async () => {
    const { calls, order } = await postWebhook({
      commandsResult: { ok: false, code: "inbound_command_write_unavailable", result: { items: [] } },
    });
    return calls.enqueue === 1 || order.includes("enqueue");   // the enqueue ran despite the command FAILING
  })());

srcMutation("MUT 2: an intent is enqueued WITHOUT an eligible authoritative result",
  PURE_SRC,
  "  if (!isEligibleDisposition(evidence.command, evidence.disposition)) {\n    return reject(AckRejectReason.INELIGIBLE_DISPOSITION);\n  }",
  "  if (false) {\n    return reject(AckRejectReason.INELIGIBLE_DISPOSITION);\n  }",
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    const r = await runEnqueue(store, { commandOver: { disposition: "writer_integrity_violation" } }, mm);
    return r.result.enqueued === 1;      // a FAILED write was acknowledged
  }));

srcMutation("MUT 3: the REPLAY guard is removed (a duplicate webhook re-acknowledges)",
  PURE_SRC,
  "if (evidence.replayed !== false) return reject(AckRejectReason.REPLAYED_COMMAND);",
  "if (false) return reject(AckRejectReason.REPLAYED_COMMAND);",
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    const r = await runEnqueue(store, { commandOver: { replayed: true } }, mm);
    return r.result.enqueued === 1;
  }));

srcMutation("MUT 4: the DESTINATION-HASH fence is removed (evidence stops describing this message)",
  PURE_SRC,
  "  if (typeof observed.destinationHash !== \"string\" || observed.destinationHash !== evidence.destinationHash) {\n    return reject(AckRejectReason.DESTINATION_HASH_MISMATCH);\n  }",
  "  if (false) {\n    return reject(AckRejectReason.DESTINATION_HASH_MISMATCH);\n  }",
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    const r = await runEnqueue(store, {
      persistedOver: { receipt: { inboundMessageId: ROW_ID, provider: ADAPTER_PROVIDER, providerMessageId: WAMID, destinationHash: "f".repeat(64), receivedAt: RECEIVED } },
    }, mm);
    return r.result.enqueued === 1;      // an intent bound to the WRONG destination
  }));

srcMutation("MUT 5: the PROVIDER-MESSAGE binding is REMOVED (evidence stops describing this message)",
  PURE_SRC,
  "  if (typeof observed.providerMessageId !== \"string\" || observed.providerMessageId !== evidence.providerMessageId) {\n    return reject(AckRejectReason.PROVIDER_MESSAGE_MISMATCH);\n  }",
  "  if (false) {\n    return reject(AckRejectReason.PROVIDER_MESSAGE_MISMATCH);\n  }",
  () => withMutatedBuild(async (mm) => {
    // BEHAVIOURAL: evidence for a DIFFERENT provider event is now accepted as describing this one.
    const ev = {
      inboundMessageId: ROW_ID, webhookReceiptId: RECEIPT_ID, provider: "meta_whatsapp",
      providerMessageId: CANONICAL_PMID, channel: "whatsapp", destinationHash: DEST_HASH,
      command: "stop", disposition: "stop_applied", replayed: false, receivedAt: RECEIVED,
    };
    const r = mm.Pure.deriveConsentAckPlan(ev, {
      destinationHash: DEST_HASH,
      providerMessageId: "f".repeat(64),        // a DIFFERENT provider event entirely
    });
    return r.ok === true;                       // the mismatch was accepted
  }));

srcMutation("MUT 6: the command→type mapping is broken (a STOP is answered with the START copy)",
  PURE_SRC,
  "  stop: ConsentAckType.STOP,",
  "  stop: ConsentAckType.START,",
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    await runEnqueue(store, {}, mm);
    const row = onlyRow(store);
    return row.ack_type === "consent_start_acknowledgement";   // a STOP answered with a START
  }));

srcMutation("MUT 7: the rate-limit idempotency key loses its window bucket",
  PURE_SRC,
  "  return `ack:${ackType}:${destinationHash}:${bucket}`;",
  "  return `ack:${ackType}:${destinationHash}:${Math.random()}`;",
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    await runEnqueue(store, {}, mm);
    await runEnqueue(store, {}, mm);   // an identical REPLAY
    return store.rows.size === 2;      // the unique fence no longer collides ⇒ a SECOND intent
  }));

srcMutation("MUT 8: HELP is given an eligible WRITE disposition (it would acknowledge an opt-in)",
  PURE_SRC,
  '  help: Object.freeze(["help_acknowledged"]),',
  '  help: Object.freeze(["help_acknowledged", "start_applied"]),',
  () => withMutatedBuild(async (mm) => {
    // BEHAVIOURAL: a HELP that somehow carries a WRITER disposition is now enqueued as if D2-D had run.
    if (mm.Pure.isEligibleDisposition("help", "start_applied") !== true) return false;
    const store = makeStore();
    const r = await runEnqueue(store, {
      msgOver: { text: { body: "HELP" } },
      commandOver: { command: "help", disposition: "start_applied" },
    }, mm);
    return r.result.enqueued === 1;             // HELP acknowledged a consent WRITE it never made
  }));

srcMutation("MUT 9: an acknowledgement type is ADDED to the ORDINARY D3-B registry (a reusable bypass)",
  REGISTRY_SRC,
  "const REGISTRY: Readonly<Record<string, RegistryEntry>> = Object.freeze({",
  'const REGISTRY: Readonly<Record<string, RegistryEntry>> = Object.freeze({\n  consent_stop_acknowledgement: { scope: "transactional", lane: "business" },',
  () => withMutatedBuild(async (mm) => {
    const r = mm.Registry.resolveOutboundConsentScope({ messageType: "consent_stop_acknowledgement", lane: "business", channel: "whatsapp" });
    return r.ok === true || mm.Registry.REGISTERED_MESSAGE_TYPES.includes("consent_stop_acknowledgement");
  }));

srcMutation("MUT 10: the COMMAND GATE is removed (a non-command message type is acknowledged)",
  PURE_SRC,
  "  if (evidence.command !== \"stop\" && evidence.command !== \"start\" && evidence.command !== \"help\") {\n    return reject(AckRejectReason.NOT_A_COMMAND);\n  }",
  "  if (false) {\n    return reject(AckRejectReason.NOT_A_COMMAND);\n  }",
  () => withMutatedBuild(async (mm) => {
    // BEHAVIOURAL: an arbitrary "command" now derives a plan instead of being rejected.
    const ev = {
      inboundMessageId: ROW_ID, webhookReceiptId: RECEIPT_ID, provider: "meta_whatsapp",
      providerMessageId: CANONICAL_PMID, channel: "whatsapp", destinationHash: DEST_HASH,
      command: "marketing_blast", disposition: "stop_applied", replayed: false, receivedAt: RECEIVED,
    };
    const r = mm.Pure.deriveConsentAckPlan(ev, { destinationHash: DEST_HASH, providerMessageId: CANONICAL_PMID });
    return r.ok === true || r.reason !== "NOT_A_COMMAND";
  }));

fnMutation("MUT 11: the ENQUEUE FAILURE is turned into a webhook error (it becomes authoritative)", async () => {
  // Behavioural: an enqueue that throws must not change the response. Proven by removing the catch.
  const p = resolve(WEBHOOK_SRC);
  const original = readFileSync(p, "utf8");
  try {
    writeFileSync(p, original.replace(
      "    } catch {\n      /* the acknowledgement intent is never authoritative — the consent command already stands */\n    }",
      "    } catch {\n      return { status: 500, code: \"enqueue_failed\" };\n    }"
    ));
    const thrown = await postWebhook({ enqueueThrows: true });
    return thrown.res.status === 500;    // a successful consent command became a 500
  } finally { writeFileSync(p, original); }
});

srcMutation("MUT 12: the PLAINTEXT phone is added to the persisted intent row",
  SVC_SRC,
  "    received_at: ev.receivedAt,",
  "    received_at: ev.receivedAt,\n    destination_plaintext: plaintextDestination,",
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    await runEnqueue(store, {}, mm);
    return safeStringify(onlyRow(store)).includes(E164);
  }));

srcMutation("MUT 13: the durable inbound-message binding is REMOVED from the evidence",
  PURE_SRC,
  "  if (typeof evidence.inboundMessageId !== \"string\" || !UUID_SHAPE.test(evidence.inboundMessageId)) {\n    return reject(AckRejectReason.INVALID_EVIDENCE);\n  }",
  "  if (false) {\n    return reject(AckRejectReason.INVALID_EVIDENCE);\n  }",
  () => withMutatedBuild(async (mm) => {
    // BEHAVIOURAL: an acknowledgement no longer has to point at a real persisted inbound row.
    const ev = {
      inboundMessageId: "not-a-uuid", webhookReceiptId: RECEIPT_ID, provider: "meta_whatsapp",
      providerMessageId: CANONICAL_PMID, channel: "whatsapp", destinationHash: DEST_HASH,
      command: "stop", disposition: "stop_applied", replayed: false, receivedAt: RECEIVED,
    };
    const r = mm.Pure.deriveConsentAckPlan(ev, { destinationHash: DEST_HASH, providerMessageId: CANONICAL_PMID });
    return r.ok === true;                       // an unbound acknowledgement was planned
  }));

srcMutation("MUT 14: the intent is SEALED with a CONSTANT (unbound) AAD — the ciphertext becomes portable",
  SVC_SRC,
  "  const sealed = deps.seal(plaintextDestination, aad);",
  '  const sealed = deps.seal(plaintextDestination, "static-aad");',
  () => withMutatedBuild(async (mm) => {
    // BEHAVIOURAL: the stored ciphertext is no longer bound to THIS intent — it opens under a constant,
    // so it could be transplanted onto any other intent.
    const store = makeStore();
    await runEnqueue(store, {}, mm);
    const row = onlyRow(store);
    const opened = mm.Seal.openAckDestination(
      {
        ciphertext: row.sealed_destination_ciphertext,
        nonce: row.sealed_destination_nonce,
        authTag: row.sealed_destination_auth_tag,
        keyId: row.encryption_key_id,
      },
      "static-aad",
      ENV_OK
    );
    return opened.ok === true && opened.value === E164;
  }));

srcMutation("MUT 15: an UNSEALABLE destination is stored anyway (fail-open encryption)",
  SVC_SRC,
  '  if (!sealed.ok) return "seal_unavailable";',
  "  if (!sealed.ok) { /* fail-open */ }",
  () => withMutatedBuild(async (mm) => {
    const store = makeStore();
    let threw = false;
    try {
      const r = await runEnqueue(store, { deps: { seal: () => ({ ok: false, code: "SEAL_CONFIG_MISSING" }) } }, mm);
      return r.result.items[0]?.outcome !== "seal_unavailable";
    } catch { threw = true; }
    return threw;
  }));

// ---- The D2-E harness delta must stay byte-bounded ----------------------------------------------
srcMutation("MUT 16: an UNRELATED line in the D2-E harness is changed (wholesale admission)",
  D2E_HARNESS_SRC,
  'hasNot(/apply_communication_consent_command/, code, "the webhook never calls the RPC");',
  'hasNot(/apply_communication_consent_command_MUTATED/, code, "the webhook never calls the RPC");',
  () => validateD2EHarnessDelta().some((p) => p.startsWith("unrelated D2-E harness line changed")));

srcMutation("MUT 17: a FOURTH consent-related module is admitted to the D2-E allowlist",
  D2E_HARNESS_SRC,
  B_NEW_ALLOWLIST,
  'const ALLOWED_CONSENT_MODULES = ["./inboundConsentCommandService", "./consentCommandResponseService", "./outboundConsentEnforcementService", "./communicationConsentWriterService"];',
  () => validateD2EHarnessDelta().some((p) => p.includes("the allowlist must be exactly")));

srcMutation("MUT 17b (8A): the D2-E SYMBOL guard is dropped while the enforcement module stays allowlisted",
  D2E_HARNESS_SRC,
  C_SYMBOLS_ASSERT,
  'assert(true,',
  // Admitting the enforcement MODULE is only safe because the SYMBOL guard confines it to the fail-closed
  // factory. Remove that guard and the webhook could import the REAL authority under an allowlisted module.
  () => validateD2EHarnessDelta().some((p) => p.includes("transformation C missing its symbol assertion")));

srcMutation("MUT 18: a D2-E check is REMOVED under cover of the approved correction",
  D2E_HARNESS_SRC,
  'hasNot(/communication_preferences|communication_suppressions/, code, "the webhook never touches consent tables");',
  "",
  () => validateD2EHarnessDelta().some((p) => p.includes("assertion count must be") || p.startsWith("unrelated D2-E harness line changed")));

// ============================================================================
// RUNNER
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-D4-B consent command response checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}

async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5F-D4-B mutation tests...\n");
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
      catch { violation = true; }
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
