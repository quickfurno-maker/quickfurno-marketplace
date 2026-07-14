import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5F-D2-E — inbound WhatsApp consent-command INTEGRATION.
 *
 * The D2-E orchestrator + the pure input builder are transpiled with a STUBBED Supabase and a STUBBED
 * D2-D writer, then driven against a FAITHFUL in-memory reference of the frozen D2-D writer contract
 * (`simWriter`) — including its REAL input fences (provider allowlist, `^[A-Za-z0-9._:-]{1,200}$`
 * identifier regex, strict RFC3339, HEX64 destination, UUID shapes) and its receipt-based replay/conflict.
 *
 * That reference is what makes the two load-bearing seams provable:
 *   • a RAW Meta wamid containing `+` / `/` / `=` is REJECTED by D2-D's own fence, while its SHA-256
 *     digest is ACCEPTED — so the hashing is not cosmetic, it is what prevents a silently-dropped STOP;
 *   • `meta_whatsapp_cloud` is REJECTED by D2-D's provider allowlist, while the explicitly-mapped
 *     `meta_whatsapp` is ACCEPTED.
 *
 * The REAL D1-B service is also driven (with a fake PostgREST client) to prove persistence-before-command
 * ordering, duplicate row-id resolution, and retryable-vs-deterministic failure propagation.
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
  "lib/communication/consentCommand.ts",
  "lib/communication/inboundConsentCommandInput.ts",
];

const BUILDER_SRC = "lib/communication/inboundConsentCommandInput.ts";
const ORCH_SRC = "services/inboundConsentCommandService.ts";
const D1B_SRC = "services/inboundWhatsAppMessageService.ts";
const WEBHOOK_SVC_SRC = "services/metaWhatsAppWebhookService.ts";
const WEBHOOK_ROUTE_SRC = "app/api/webhooks/whatsapp/meta/route.ts";
const WRITER_SRC = "services/communicationConsentWriterService.ts";
const COMMAND_SRC = "lib/communication/consentCommand.ts";
const D2C_SVC_SRC = "services/communicationConsentDecisionService.ts";
const HARNESS_SRC = "scripts/phase5f-d2e-inbound-consent-integration-harness.mjs";
const DOC_SRC = "docs/QF-Inbound-Consent-Integration-Phase-5F-D2-E.md";
const D2D_MIGRATION = "supabase/migrations/20260712000300_communication_consent_command_writer_rpc.sql";

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

/** Transpile the two SERVICES in isolation (noResolve) — their imports are stubbed or already emitted. */
function transpileServices(outDir) {
  const tsconfigPath = resolve(`${outDir}.svc.tsconfig.json`);
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: false, isolatedModules: true,
      outDir, rootDir: ".", types: [], noResolve: true,
    },
    files: [ORCH_SRC, D1B_SRC],
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  catch { /* expected noResolve diagnostics */ }
  finally { rmSync(tsconfigPath, { force: true }); }
  for (const f of ["services/inboundConsentCommandService.js", "services/inboundWhatsAppMessageService.js"]) {
    if (!existsSync(resolve(outDir, f))) throw new Error(`${f} did not transpile`);
  }
}

/** The stubbed D2-D writer. Tests inject their own `writeCommand`; the DEFAULT binding must never run. */
const WRITER_STUB = {
  writeConsentCommand: async () => { throw new Error("the real D2-D writer must never run in the D2-E harness"); },
};

function wireBuild(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const original = Module._load;
  const STUBS = {
    "../lib/supabase": { adminClient: () => { throw new Error("real Supabase must never run in the D2-E harness") } },
    "./inboundIdentityResolutionService": { resolveInboundSenderIdentity: () => { throw new Error("real resolver must never run") } },
    "../lib/communication/providers/metaCloudWhatsAppProvider": { META_WHATSAPP_CLOUD_PROVIDER_KEY: "meta_whatsapp_cloud" },
    "./communicationConsentWriterService": WRITER_STUB,
  };
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return original.apply(this, [request, parent, isMain]);
  };
  return {
    Orch: req("./services/inboundConsentCommandService.js"),
    Input: req("./lib/communication/inboundConsentCommandInput.js"),
    Command: req("./lib/communication/consentCommand.js"),
    D1B: req("./services/inboundWhatsAppMessageService.js"),
    Inbound: req("./lib/communication/providers/metaWhatsAppInbound.js"),
  };
}

const readF = (f) => readFileSync(f, "utf8");
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }
function gitDirty() {
  return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })
    .split("\n").map((l) => l.slice(3).trim()).filter(Boolean).map((p) => p.replace(/\\/g, "/"))
    .filter((p) => !p.startsWith(".phase5fd2e"));
}
const gitFiles = (args) => execFileSync("git", args, { encoding: "utf8" })
  .split("\n").map((s) => s.trim()).filter(Boolean).map((p) => p.replace(/\\/g, "/"));
function headSha() { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
const subjectOf = (sha) => execFileSync("git", ["log", "-1", "--format=%s", sha], { encoding: "utf8" }).trim();
function commitExists(sha) {
  try { execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "pipe" }); return true; } catch { return false; }
}
function isAncestor(a, b) {
  if (!commitExists(a) || !commitExists(b)) return false;
  try { execFileSync("git", ["merge-base", "--is-ancestor", a, b], { stdio: "pipe" }); return true; } catch { return false; }
}

// ----------------------------------------------------------------------------
// D2-E PHASE BOUNDARY — FROZEN AUDITED HISTORICAL RANGE
//
// D2-E is implemented, corrected and AUDITED. Its phase scope is therefore a FIXED slice of history:
//
//     94b8c15 (D2-E base)  ..  56e8f51 (the audited FINAL, CORRECTED D2-E implementation commit)
//
// The historical audit inspects ONLY that range. It NEVER uses the current HEAD as the end of the file or
// commit range, because a HEAD-relative boundary is self-invalidating the moment anything is appended:
//   • THIS freeze commit is a harness/docs maintenance commit, not a D2-E implementation commit;
//   • a future PR MERGE commit carries a merge subject;
//   • every LATER phase legitimately adds its own commits and files.
// None of those may re-open a frozen audit.
//
// WHAT IS PROVEN:
//   1. the base is an ancestor of the audited head        → the audited range is real and measurable;
//   2. the audited head is an ancestor of the current HEAD → this checkout CONTAINS the whole audited phase;
//   3. the delta base..audited-head is EXACTLY the approved seven files;
//   4. every NON-MERGE IMPLEMENTATION commit INSIDE the range carries a "Phase 5F-D2-E:" subject.
// A failure of either ancestry proof is a SCOPE VIOLATION, not a warning.
//
// CURRENT-WORKTREE PROTECTION IS A SEPARATE CONCERN (`validateD2EWorktree` + its own check). Dirty files
// are NEVER unioned into the frozen historical delta. See the protected/released lists below.
// ----------------------------------------------------------------------------
const D2E_BASE = "94b8c1522269635cdbbe53fb6d11ea2bf91b05a9"; // the merged D2-D post-merge harness stabilization
const D2E_HEAD = "56e8f5193eb1be5d24ece3ec00822608b7f50057"; // the audited FINAL, CORRECTED D2-E implementation
const D2E_SUBJECT = /^Phase 5F-D2-E:/;

const D2E_EXPECTED_FILES = [
  "docs/QF-Inbound-Consent-Integration-Phase-5F-D2-E.md",
  "lib/communication/inboundConsentCommandInput.ts",
  "package.json",
  "scripts/phase5f-d2e-inbound-consent-integration-harness.mjs",
  "services/inboundConsentCommandService.ts",
  "services/inboundWhatsAppMessageService.ts",
  "services/metaWhatsAppWebhookService.ts",
];
/** Files D2-E must NEVER touch (the frozen consent authorities + the D1-A/D2-D substrate). */
const D2E_FORBIDDEN_FILES = [
  WRITER_SRC, COMMAND_SRC, "lib/communication/consentPolicy.ts", D2C_SVC_SRC, D2D_MIGRATION,
  WEBHOOK_ROUTE_SRC, "lib/communication/providers/metaWhatsAppInbound.ts",
  "scripts/phase5f-d2d-consent-command-writer-harness.mjs",
  "scripts/phase5f-d1b-whatsapp-inbound-persistence-harness.mjs",
  "scripts/phase5f-d2c-consent-decision-authority-harness.mjs",
];

/**
 * The D2-E-OWNED consent-integration AUTHORITY files. An uncommitted edit to either must fail D2-E — they
 * are the phase's own contract surface (the provider map, the SHA-256 event identity, the timestamp rules,
 * the HELP/unsupported short-circuit, the retryable/deterministic split).
 */
const D2E_PROTECTED_FILES = [BUILDER_SRC, ORCH_SRC];

/**
 * DELIBERATELY RELEASED from worktree protection — a dirty one of these is NOT a D2-E violation:
 *   • services/inboundWhatsAppMessageService.ts (D1-B)   — a shared FUTURE integration seam;
 *   • services/metaWhatsAppWebhookService.ts             — a shared FUTURE integration seam;
 *   • package.json                                        — future phases must be able to add their scripts;
 *   • the D2-E harness + document                         — this maintenance surface itself;
 *   • any new future-phase file                           — a later phase must not re-open this audit.
 *
 * Releasing them from DIRTY-FILE protection removes NO functional or boundary coverage: the D1-B and
 * webhook behaviour is still fully asserted by this harness's functional checks (persist-before-command
 * ordering, persisted-row authority, duplicate/replay, the webhook's import boundary, and D1-B's
 * consent-agnosticism), and by their own phase harnesses.
 */
const D2E_RELEASED_SEAMS = [D1B_SRC, WEBHOOK_SVC_SRC, "package.json", HARNESS_SRC, DOC_SRC];

/**
 * PURE. The FROZEN historical delta must be EXACTLY the approved seven files, and must touch nothing
 * forbidden. `anchorsProven` carries the ancestry result: without it the range is not measurable, so the
 * whole scope claim is meaningless — a violation, not a warning.
 */
function validateD2EScope(files, anchorsProven) {
  const problems = [];
  if (!anchorsProven) problems.push(`the frozen D2-E range ${D2E_BASE}..${D2E_HEAD} is not measurable (anchor ancestry unproven)`);
  const set = new Set(files);
  if (files.length !== D2E_EXPECTED_FILES.length) problems.push(`expected ${D2E_EXPECTED_FILES.length} files, got ${files.length} [${files.join(", ")}]`);
  for (const f of D2E_EXPECTED_FILES) if (!set.has(f)) problems.push(`missing approved D2-E file: ${f}`);
  for (const f of files) if (!D2E_EXPECTED_FILES.includes(f)) problems.push(`unexpected file in the frozen D2-E delta: ${f}`);
  for (const f of files) {
    if (D2E_FORBIDDEN_FILES.includes(f)) problems.push(`D2-E must not modify the frozen file: ${f}`);
    if (/^supabase\/migrations\//.test(f)) problems.push(`D2-E must add no migration: ${f}`);
    if (/(^|\/)\.env(\.|$)/.test(f)) problems.push(`D2-E must change no env file: ${f}`);
    if (/(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(f)) problems.push(`D2-E must change no lockfile: ${f}`);
    if (/(^|\/)(app|pages)\/api\//.test(f)) problems.push(`D2-E must change no API route: ${f}`);
  }
  return problems;
}

/**
 * PURE. Subjects are validated ONLY for NON-MERGE IMPLEMENTATION commits INSIDE the frozen range. The
 * freeze maintenance commit, future merge commits and future-phase commits lie outside it and are never
 * passed here.
 */
function validateD2ESubjects(messages) {
  const problems = [];
  for (const m of messages) {
    if (!D2E_SUBJECT.test(m)) problems.push(`a D2-E implementation commit carries a non-D2-E subject: '${String(m).slice(0, 60)}'`);
  }
  return problems;
}

/** PURE. The two ancestry proofs that make the frozen range meaningful (and prove HEAD contains it). */
function validateD2EAnchors({ baseIsAncestorOfHead, headIsAncestorOfCurrent }) {
  const problems = [];
  if (!baseIsAncestorOfHead) problems.push(`the D2-E base ${D2E_BASE} is not an ancestor of the audited head ${D2E_HEAD} — the audited range is not real`);
  if (!headIsAncestorOfCurrent) problems.push(`the audited D2-E head ${D2E_HEAD} is not an ancestor of the current HEAD — this checkout does not contain the complete audited D2-E phase`);
  return problems;
}

/**
 * PURE. Current-worktree safety, kept STRICTLY separate from the frozen historical scope: an uncommitted
 * edit to a D2-E-owned AUTHORITY file is a violation; a released seam, the maintenance surface, and any
 * future-phase file are not.
 */
function validateD2EWorktree(dirty) {
  const problems = [];
  for (const f of dirty) {
    if (D2E_PROTECTED_FILES.includes(f)) problems.push(`a protected D2-E authority file has uncommitted changes: ${f}`);
  }
  return problems;
}

/**
 * The FROZEN historical D2-E delta: base..auditedHead ONLY. NEVER HEAD-relative, NEVER unioned with the
 * worktree. `--no-merges` makes the subject check what it claims to be: IMPLEMENTATION commits only.
 */
function d2eFrozenRange(base = D2E_BASE, head = D2E_HEAD) {
  const baseIsAncestorOfHead = isAncestor(base, head);
  const headIsAncestorOfCurrent = isAncestor(head, headSha());
  const anchorsProven = baseIsAncestorOfHead && headIsAncestorOfCurrent;
  const commits = anchorsProven ? gitFiles(["rev-list", "--no-merges", `${base}..${head}`]) : [];
  const messages = commits.map(subjectOf);
  const files = anchorsProven ? gitFiles(["diff", "--name-only", `${base}..${head}`]) : [];
  const perCommit = commits.map((c) => gitFiles(["diff-tree", "--no-commit-id", "--name-only", "-r", c]));
  return { baseIsAncestorOfHead, headIsAncestorOfCurrent, anchorsProven, commits, messages, files, perCommit };
}

/** Commits AFTER the audited head: this freeze commit, any PR merge, and every later phase. Out of scope. */
const postAuditCommits = () => (isAncestor(D2E_HEAD, headSha()) ? gitFiles(["rev-list", `${D2E_HEAD}..HEAD`]) : []);

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function has(re, s, msg) { assert(re.test(s), msg); }
function hasNot(re, s, msg) { assert(!re.test(s), msg); }

const MAIN_DIR = resolve(".phase5fd2e-build-main");
compileTo(MAIN_DIR);
transpileServices(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// FAITHFUL IN-MEMORY REFERENCE OF THE FROZEN D2-D WRITER CONTRACT
// (its REAL input fences + receipt replay/conflict — copied from the D2-D source of truth)
// ============================================================================
const D2D_PROVIDERS = ["meta_whatsapp", "exotel_sms", "system"];
const D2D_IDENT = /^[A-Za-z0-9._:-]{1,200}$/;            // the fence a raw wamid can violate
const D2D_HEX64 = /^[0-9a-f]{64}$/;
const D2D_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const D2D_EVENT_TYPE = /^[A-Za-z0-9._:-]{1,64}$/;
const D2D_RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

const newWriterStore = () => ({ receipts: [], calls: [], failWith: null, throwOnce: false });

/** Mirrors `writeConsentCommand` — including the validation that would DROP a raw wamid. */
function simWriter(store) {
  return async (input) => {
    store.calls.push(input);
    if (store.throwOnce) { store.throwOnce = false; throw new Error("db down: SQLSTATE 08006 connection reset by peer"); }
    if (store.failWith) return { ok: false, code: store.failWith };

    // --- the REAL D2-D input fences ---
    if (!input || input.channel !== "whatsapp") return { ok: false, code: "INVALID_WRITER_INPUT" };
    if (!["stop", "start", "help", "unsupported"].includes(input.command)) return { ok: false, code: "INVALID_WRITER_INPUT" };
    if (!D2D_HEX64.test(input.destinationHash || "")) return { ok: false, code: "INVALID_WRITER_INPUT" };
    if (!["exact", "ambiguous", "unknown"].includes(input.identityConfidence)) return { ok: false, code: "INVALID_WRITER_INPUT" };
    if (input.identityConfidence === "exact") {
      const p = input.principal;
      if (!p || !["client", "vendor", "admin"].includes(p.type) || !D2D_UUID.test(p.id || "")) return { ok: false, code: "INVALID_WRITER_INPUT" };
    } else if (input.principal !== null) return { ok: false, code: "INVALID_WRITER_INPUT" };
    if (!D2D_PROVIDERS.includes(input.provider)) return { ok: false, code: "INVALID_WRITER_INPUT" };
    if (!D2D_IDENT.test(input.providerMessageId || "")) return { ok: false, code: "INVALID_WRITER_INPUT" };
    if (!D2D_EVENT_TYPE.test(input.sourceEventType || "")) return { ok: false, code: "INVALID_WRITER_INPUT" };
    if (input.inboundMessageId !== null && !D2D_UUID.test(input.inboundMessageId || "")) return { ok: false, code: "INVALID_WRITER_INPUT" };
    if (!D2D_RFC3339.test(input.occurredAt || "")) return { ok: false, code: "INVALID_WRITER_INPUT" };

    // HELP / unsupported never reach the RPC (defence in depth — D2-E must short-circuit before here).
    if (input.command === "help") return { ok: true, result: "help_acknowledged", replayed: false, scopeResults: [], eventIds: [], suppressionIds: [] };
    if (input.command === "unsupported") return { ok: true, result: "unsupported_command", replayed: false, scopeResults: [], eventIds: [], suppressionIds: [] };

    // --- receipt-based replay / conflict, keyed exactly as D2-D keys it ---
    const key = `${input.provider}|${input.providerMessageId}|${input.channel}`;
    const found = store.receipts.find((r) => r.key === key);
    if (found) {
      if (found.command !== input.command || found.destinationHash !== input.destinationHash) {
        return { ok: false, code: "WRITER_CONFLICT" };
      }
      return { ok: true, result: found.result, replayed: true, scopeResults: [], eventIds: [], suppressionIds: [] };
    }
    const result = input.command === "stop" ? "stop_applied" : "start_no_reversible_stop";
    store.receipts.push({ key, command: input.command, destinationHash: input.destinationHash, result });
    return { ok: true, result, replayed: false, scopeResults: [], eventIds: [], suppressionIds: [] };
  };
}

// ============================================================================
// FIXTURES
// ============================================================================
const HASH = "a".repeat(64);
const UUID = "11111111-2222-4333-8444-555555555555";
const UUID_B = "99999999-8888-4777-8666-555555555555"; // a DIFFERENT principal (the redelivery's identity B)
const ROW_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ROW_UUID_2 = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const OCCURRED = "2026-07-11T10:30:00.000Z";
const RECEIVED = "2026-07-12T00:00:00.000Z";
/** A REAL-shaped wamid: `wamid.` + base64, including the `+`, `/` and `=` D2-D's fence rejects. */
const WAMID_BASE64 = "wamid.HBgMOTE5ODEyMzQ1Njc4FQIAEhgg+aB/cD3E4F5g6H7i8J9k0L1m2N3o4P5q6R7s8T9=";
const WAMID_PLAIN = "wamid.HBgMOTE5ODEyMzQ1Njc4FQIAEhggABCDEF0123456789";

const msg = (over = {}) => ({
  provider: "meta_whatsapp_cloud",
  providerMessageId: WAMID_PLAIN,
  senderHash: HASH,
  senderMasked: "+91******5678",
  messageType: "text",
  contentMinimized: { text: "STOP" },
  providerOccurredAt: OCCURRED,
  providerContext: { phoneNumberId: "111222333" },
  ...over,
});
const rcpt = (over = {}) => ({
  inboundMessageId: ROW_UUID,
  provider: "meta_whatsapp_cloud",
  providerMessageId: WAMID_PLAIN,
  duplicate: false,
  destinationHash: HASH,
  identityConfidence: "unknown",
  principalType: null,
  principalId: null,
  receivedAt: RECEIVED,
  providerOccurredAt: OCCURRED,
  ...over,
});
const candidate = (m = {}, r = {}) => {
  const message = msg(m);
  return { message, receipt: rcpt({ providerMessageId: message.providerMessageId, ...r }) };
};

const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function makeDeps(store, over = {}) {
  return {
    normalize: over.normalize ?? M.Command.normalizeConsentCommand,
    writeCommand: over.writeCommand ?? simWriter(store),
  };
}
const runOrch = (candidates, store = newWriterStore(), over = {}) =>
  M.Orch.processInboundConsentCommands(candidates, makeDeps(store, over)).then((r) => ({ r, store }));

// ============================================================================
// 3-6. PROVIDER MAPPING + SHA-256 PROVIDER EVENT IDENTITY
// ============================================================================
check("3. provider mapping is EXPLICIT and CLOSED (meta_whatsapp_cloud → meta_whatsapp)", () => {
  const map = M.Input.mapAdapterProviderToConsentProvider;
  assert(map("meta_whatsapp_cloud") === "meta_whatsapp", "the adapter key maps to the consent-domain key");
  for (const unknown of ["meta_whatsapp", "twilio", "exotel_sms", "system", "", "META_WHATSAPP_CLOUD", null, undefined, 42, {}]) {
    assert(map(unknown) === null, `an unmapped key is REJECTED, never passed through: ${safeStringify(unknown)}`);
  }
  // The D2-D allowlist is NOT widened: the raw adapter key is not something D2-D accepts.
  assert(!D2D_PROVIDERS.includes("meta_whatsapp_cloud"), "D2-D never accepts the raw adapter key");
  assert(D2D_PROVIDERS.includes("meta_whatsapp"), "D2-D accepts the mapped key");
});

check("4. the provider event id is the LOWERCASE SHA-256 HEX of the original wamid (64 chars)", () => {
  const d = M.Input.deriveProviderEventId(WAMID_PLAIN);
  assert(/^[0-9a-f]{64}$/.test(d), "lowercase hex, exactly 64 chars");
  assert(d === sha256hex(WAMID_PLAIN), "it is exactly sha256(wamid), not a truncation/salt/other digest");
  assert(M.Input.deriveProviderEventId(WAMID_PLAIN) === d, "deterministic: the same wamid always yields the same identity");
  assert(d !== WAMID_PLAIN, "the raw wamid is never passed through as the identity");
});

check("5. changing ONE character of the wamid changes the digest", () => {
  const a = M.Input.deriveProviderEventId("wamid.AAAA1");
  const b = M.Input.deriveProviderEventId("wamid.AAAA2");
  assert(a !== b, "a one-character difference yields a different provider event id");
  assert(M.Input.deriveProviderEventId(WAMID_BASE64) !== M.Input.deriveProviderEventId(`${WAMID_BASE64}x`), "distinct wamids never collide onto one identity");
});

check("6. a raw wamid with + / = is REJECTED by D2-D, but its digest is ACCEPTED (the whole point)", async () => {
  // The raw wamid genuinely violates the frozen D2-D identifier fence…
  assert(/[+/=]/.test(WAMID_BASE64), "the fixture really contains +, / or =");
  assert(!D2D_IDENT.test(WAMID_BASE64), "a raw base64 wamid VIOLATES the D2-D identifier fence");
  // …so passing it raw to the writer would be a DETERMINISTIC INVALID_WRITER_INPUT — a silently dropped STOP.
  const store = newWriterStore();
  const raw = await simWriter(store)({
    channel: "whatsapp", command: "stop", destinationHash: HASH, identityConfidence: "unknown", principal: null,
    provider: "meta_whatsapp", providerMessageId: WAMID_BASE64, sourceEventType: "whatsapp.inbound.command",
    inboundMessageId: ROW_UUID, occurredAt: OCCURRED,
  });
  assert(raw.ok === false && raw.code === "INVALID_WRITER_INPUT", "the RAW wamid would be dropped by D2-D");
  // …while the real D2-E path hashes it and D2-D accepts it.
  const { r, store: s2 } = await runOrch([candidate({ providerMessageId: WAMID_BASE64 })]);
  assert(r.ok === true && r.result.items[0].disposition === "stop_applied", "the hashed identity is ACCEPTED and the STOP is applied");
  assert(D2D_IDENT.test(s2.calls[0].providerMessageId), "what reached D2-D satisfies its fence");
  assert(s2.calls[0].providerMessageId === sha256hex(WAMID_BASE64), "it is the digest of the ORIGINAL wamid");
  assert(!safeStringify(s2.calls[0]).includes(WAMID_BASE64), "the raw wamid NEVER reaches the D2-D receipt");
});

// ============================================================================
// 7-8. TIMESTAMP CONTRACT
// ============================================================================
check("7. a valid provider timestamp is used as occurredAt", async () => {
  const { store } = await runOrch([candidate({}, { providerOccurredAt: OCCURRED, receivedAt: RECEIVED })]);
  assert(store.calls[0].occurredAt === new Date(OCCURRED).toISOString(), "the provider instant is used verbatim (ISO-normalized)");
  assert(store.calls[0].occurredAt !== RECEIVED, "it did not silently fall back");
});

check("8. C. an absent/invalid provider timestamp falls back to receivedAt (never drops, never rolls over)", async () => {
  const INVALID = [
    null, undefined, "", "not-a-date", 42, {},
    "2026-07-11",                    // date-only
    "2026-07-11T10:30:00",           // timezone-less
    "07/11/2026",                    // locale
    "2026-02-31T10:30:00Z",          // IMPOSSIBLE CALENDAR DAY (Date.parse would roll to 3 March)
    "2026-02-30T00:00:00Z",          // impossible day
    "2027-02-29T00:00:00Z",          // 2027 is not a leap year
    "2026-13-01T00:00:00Z",          // month 13
    "2026-00-10T00:00:00Z",          // month 0
    "2026-01-00T00:00:00Z",          // day 0
    "2026-01-01T24:00:00Z",          // hour 24 (Date.parse would roll to the next midnight)
    "2026-01-01T10:60:00Z",          // minute 60
    "2026-01-01T10:30:60Z",          // second 60
    "2026-01-01T10:30:00+25:00",     // invalid offset hour
    "2026-01-01T10:30:00+05:99",     // invalid offset minute
  ];
  for (const bad of INVALID) {
    // the strict validator rejects it outright…
    assert(M.Input.isStrictRfc3339(bad) === false, `strictly invalid: ${safeStringify(bad)}`);
    assert(M.Input.toStrictIsoInstant(bad) === null, `never normalized into another date: ${safeStringify(bad)}`);
    // …and the command still lands, using the received-at fallback.
    const { r, store } = await runOrch([candidate({}, { providerOccurredAt: bad, receivedAt: RECEIVED })]);
    assert(store.calls.length === 1, `the command is still written for providerOccurredAt=${safeStringify(bad)}`);
    assert(store.calls[0].occurredAt === new Date(RECEIVED).toISOString(), "occurredAt fell back to the received-at time");
    assert(D2D_RFC3339.test(store.calls[0].occurredAt), "the fallback is strict RFC3339");
    assert(r.ok === true && r.result.items[0].disposition === "stop_applied", "the STOP is applied, never dropped");
  }
  // The rollover trap explicitly: an impossible date must NEVER become a different real date.
  assert(Number.isFinite(Date.parse("2026-02-31T10:30:00Z")), "Date.parse ALONE would accept 2026-02-31 (the trap)");
  assert(new Date("2026-02-31T10:30:00Z").toISOString().startsWith("2026-03-03"), "…and would silently roll it to 3 March");
  assert(M.Input.toStrictIsoInstant("2026-02-31T10:30:00Z") === null, "the strict validator refuses to roll it over");
  const rolled = await runOrch([candidate({}, { providerOccurredAt: "2026-02-31T10:30:00Z", receivedAt: RECEIVED })]);
  assert(!rolled.store.calls[0].occurredAt.startsWith("2026-03-03"), "an impossible date is NEVER rewritten into March");
  assert(rolled.store.calls[0].occurredAt === new Date(RECEIVED).toISOString(), "it fell back instead");

  // VALID forms are still accepted (including a real leap day and a real offset).
  for (const good of ["2026-07-11T10:30:00Z", "2026-07-11T10:30:00.123456Z", "2024-02-29T00:00:00Z", "2026-07-11T10:30:00+05:30", "2026-07-11T10:30:00-08:00"]) {
    assert(M.Input.isStrictRfc3339(good) === true, `strictly valid: ${good}`);
  }

  // Both unusable → fail closed, and NEVER fabricate an instant.
  const { r } = await runOrch([candidate({}, { providerOccurredAt: null, receivedAt: "nonsense" })]);
  assert(r.ok === true && r.result.items[0].disposition === "input_not_buildable", "both unusable → deterministic, not fabricated");
  assert(M.Input.resolveOccurredAt(null, "nonsense") === null, "resolveOccurredAt fabricates nothing");
  assert(M.Input.resolveOccurredAt("2026-02-31T00:00:00Z", "2026-02-31T00:00:00Z") === null, "two impossible dates fabricate nothing");
});

// ============================================================================
// 9, 12-14. ELIGIBILITY + THE WRITER IS NEVER CALLED FOR HELP/UNSUPPORTED/NON-TEXT
// ============================================================================
check("9. ONLY text is command-eligible", () => {
  assert(M.Input.isCommandEligible(msg({ messageType: "text" })) === true, "text is eligible");
  for (const t of ["button_reply", "list_reply", "image", "document", "audio", "video", "location", "contact", "reaction", "unsupported"]) {
    assert(M.Input.isCommandEligible(msg({ messageType: t })) === false, `${t} is NOT command-eligible`);
    assert(M.Input.readCommandToken(msg({ messageType: t, contentMinimized: { text: "STOP" } })) === null, `${t} yields no command token even if it carries text`);
  }
});

check("12. HELP never calls the writer (and sends nothing)", async () => {
  for (const body of ["HELP", "help", "INFO", " Help "]) {
    const { r, store } = await runOrch([candidate({ contentMinimized: { text: body } })]);
    assert(store.calls.length === 0, `HELP ('${body}') NEVER reaches the writer`);
    assert(r.ok === true && r.result.helpAcknowledged === 1, "help_acknowledged");
    assert(r.result.items[0].disposition === "help_acknowledged" && r.result.items[0].command === "help", "sanitized help outcome");
    assert(r.result.writerInvocations === 0, "no writer invocation counted");
  }
});

check("13. unsupported text never calls the writer", async () => {
  for (const body of ["please stop texting", "STOP.", "hello", "", "stahp", "🚫", "restart"]) {
    const { r, store } = await runOrch([candidate({ contentMinimized: { text: body } })]);
    assert(store.calls.length === 0, `unsupported ('${body}') NEVER reaches the writer`);
    assert(r.ok === true && r.result.unsupported === 1 && r.result.items[0].disposition === "unsupported_command", "sanitized unsupported outcome");
  }
});

check("14. a non-text message never calls the writer (no interpretation at all)", async () => {
  for (const t of ["button_reply", "list_reply", "image", "location", "reaction", "unsupported"]) {
    // even a button whose replyId literally says STOP is NOT a typed command
    const { r, store } = await runOrch([candidate({ messageType: t, contentMinimized: { replyId: "STOP", text: "STOP" } })]);
    assert(store.calls.length === 0, `${t} NEVER reaches the writer`);
    assert(r.ok === true && r.result.skippedNotEligible === 1, `${t} skipped`);
    assert(r.result.items[0].disposition === "not_command_eligible" && r.result.items[0].command === null, "no command was even inferred");
  }
});

// ============================================================================
// 10-11. STOP / START CALL THE WRITER EXACTLY ONCE, AFTER PERSISTENCE
// ============================================================================
check("10. STOP calls the D2-D writer EXACTLY ONCE with the adapted input", async () => {
  const { r, store } = await runOrch([candidate({ contentMinimized: { text: "STOP" } })]);
  assert(store.calls.length === 1, "the writer is called exactly once");
  const c = store.calls[0];
  assert(c.command === "stop" && c.channel === "whatsapp", "stop on the whatsapp channel");
  assert(c.provider === "meta_whatsapp", "the MAPPED provider reaches D2-D");
  assert(c.providerMessageId === sha256hex(WAMID_PLAIN), "the hashed provider event identity");
  assert(c.inboundMessageId === ROW_UUID, "the durable D1-B row UUID is carried");
  assert(c.destinationHash === HASH && c.sourceEventType === "whatsapp.inbound.command", "destination + provenance");
  assert(r.ok === true && r.result.items[0].disposition === "stop_applied" && r.result.writerInvocations === 1, "stop_applied");
  for (const w of ["STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "stop"]) {
    const s = newWriterStore();
    await runOrch([candidate({ contentMinimized: { text: w } })], s);
    assert(s.calls.length === 1 && s.calls[0].command === "stop", `'${w}' → one stop write`);
  }
});

check("11. START calls the D2-D writer EXACTLY ONCE", async () => {
  const { r, store } = await runOrch([candidate({ contentMinimized: { text: "START" } })]);
  assert(store.calls.length === 1 && store.calls[0].command === "start", "exactly one start write");
  assert(r.ok === true && r.result.items[0].disposition === "start_no_reversible_stop", "the writer's own result is passed through verbatim");
  for (const w of ["UNSTOP", "SUBSCRIBE", "start"]) {
    const s = newWriterStore();
    await runOrch([candidate({ contentMinimized: { text: w } })], s);
    assert(s.calls.length === 1 && s.calls[0].command === "start", `'${w}' → one start write`);
  }
});

// ============================================================================
// 18. DUPLICATE DELIVERY → D2-D REPLAY (the same wamid → the same identity → the stored outcome)
// ============================================================================
check("18. a redelivered message replays through D2-D (no second effect), never a conflict", async () => {
  const store = newWriterStore();
  const first = await runOrch([candidate({ contentMinimized: { text: "STOP" } })], store);
  // the SAME wamid, now flagged as a D1-B duplicate — it is deliberately RE-PROCESSED
  const second = await runOrch([candidate({ contentMinimized: { text: "STOP" } }, { duplicate: true })], store);
  assert(first.r.result.items[0].replayed === false, "the first delivery applies");
  assert(second.r.ok === true && second.r.result.items[0].replayed === true, "the redelivery REPLAYS");
  assert(second.r.result.items[0].disposition === "stop_applied", "the ORIGINAL stored outcome is returned");
  assert(store.receipts.length === 1, "exactly one D2-D receipt — no second effect");
  assert(store.calls.length === 2 && store.calls[0].providerMessageId === store.calls[1].providerMessageId, "the identity is stable across deliveries");
  assert(second.r.result.replayed === 1 && second.r.result.applied === 0, "counted as a replay, not a fresh application");
});

// ============================================================================
// 20-21. FAILURE SEMANTICS — RETRYABLE vs DETERMINISTIC
// ============================================================================
check("20. WRITER_TRANSACTION_FAILED is RETRYABLE (→ webhook 500)", async () => {
  const store = newWriterStore(); store.failWith = "WRITER_TRANSACTION_FAILED";
  const { r } = await runOrch([candidate()], store);
  assert(r.ok === false, "the batch is retryable");
  assert(r.code === M.Orch.COMMAND_WRITE_UNAVAILABLE, "a stable sanitized retryable code");
  assert(r.result.items[0].retryable === true && r.result.items[0].disposition === "writer_unavailable", "the item is retryable");
  // a THROWN dependency error is retryable too, and is sanitized
  const t = newWriterStore(); t.throwOnce = true;
  const thrown = await runOrch([candidate()], t);
  assert(thrown.r.ok === false && thrown.r.code === M.Orch.COMMAND_WRITE_UNAVAILABLE, "a thrown dependency error is retryable + sanitized");
});

check("21. INVALID/CONFLICT/INTEGRITY are DETERMINISTIC — handled, never retried", async () => {
  const map = {
    INVALID_WRITER_INPUT: "writer_rejected_input",
    WRITER_CONFLICT: "writer_conflict",
    WRITER_INTEGRITY_VIOLATION: "writer_integrity_violation",
    UNSUPPORTED_POLICY_VERSION: "writer_unsupported_policy_version",
  };
  for (const [code, disposition] of Object.entries(map)) {
    const store = newWriterStore(); store.failWith = code;
    const { r } = await runOrch([candidate()], store);
    assert(r.ok === true, `${code} is DETERMINISTIC → the webhook acknowledges (no retry storm)`);
    assert(r.result.items[0].retryable === false && r.result.items[0].disposition === disposition, `${code} → ${disposition}`);
    assert(r.result.deterministicFailures === 1, `${code} counted as a deterministic failure`);
  }
  // A REAL conflict through the reference writer: the same event id bound to a different command.
  const store = newWriterStore();
  await runOrch([candidate({ contentMinimized: { text: "STOP" } })], store);
  const conflict = await runOrch([candidate({ contentMinimized: { text: "START" } })], store);
  assert(conflict.r.ok === true && conflict.r.result.items[0].disposition === "writer_conflict", "same event id, different command → deterministic conflict, acknowledged");
});

check("BATCH. any retryable item makes the webhook retryable; deterministic/no-op items never do", async () => {
  // deterministic + no-op only → handled  (each message carries its OWN wamid; the receipt tracks it)
  const ok = await runOrch([
    candidate({ providerMessageId: "wamid.h", contentMinimized: { text: "HELP" } }),
    candidate({ providerMessageId: "wamid.i", messageType: "image", contentMinimized: {} }),
    candidate({ providerMessageId: "wamid.u", contentMinimized: { text: "hello" } }),
  ]);
  assert(ok.r.ok === true, "a batch of no-ops is handled");
  assert(ok.r.result.helpAcknowledged === 1 && ok.r.result.skippedNotEligible === 1 && ok.r.result.unsupported === 1, "each no-op is classified");
  // one retryable item poisons the whole batch (and every item is still attempted)
  const store = newWriterStore(); store.failWith = "WRITER_TRANSACTION_FAILED";
  const bad = await runOrch([
    candidate({ providerMessageId: "wamid.h", contentMinimized: { text: "HELP" } }),
    candidate({ providerMessageId: "wamid.s", contentMinimized: { text: "STOP" } }),
  ], store);
  assert(bad.r.ok === false && bad.r.code === M.Orch.COMMAND_WRITE_UNAVAILABLE, "one retryable item → the batch is retryable");
  assert(bad.r.result.items.length === 2 && bad.r.result.helpAcknowledged === 1, "every item is still attempted");

  // A receipt that does NOT describe its message is never silently reconciled — it is DETERMINISTIC.
  const mismatched = await runOrch([{ message: msg({ providerMessageId: "wamid.a" }), receipt: rcpt({ providerMessageId: "wamid.b" }) }]);
  assert(mismatched.r.ok === true && mismatched.r.result.items[0].disposition === "input_not_buildable", "a receipt/message mismatch is rejected before the writer");
});

// ============================================================================
// IDENTITY / PRINCIPAL
// ============================================================================
check("IDENTITY. a principal is carried ONLY on an EXACT identity; ambiguous/unknown pass null", async () => {
  const exact = await runOrch([candidate({}, { identityConfidence: "exact", principalType: "client", principalId: UUID })]);
  assert(exact.store.calls[0].principal.type === "client" && exact.store.calls[0].principal.id === UUID, "exact carries the principal");
  for (const conf of ["ambiguous", "unknown"]) {
    const { r, store } = await runOrch([candidate({}, { identityConfidence: conf })]);
    assert(store.calls[0].principal === null, `${conf} passes a NULL principal`);
    assert(r.ok === true && r.result.items[0].disposition === "stop_applied", `${conf} still applies the STOP (suppression is destination-based)`);
  }
  // a principal smuggled onto a non-exact identity is REJECTED, never forwarded
  const smuggled = await runOrch([candidate({}, { identityConfidence: "unknown", principalType: "client", principalId: UUID })]);
  assert(smuggled.store.calls.length === 0 && smuggled.r.result.items[0].disposition === "input_not_buildable", "a non-exact principal is rejected before the writer");
});

// ============================================================================
// 17, 19. D1-B: DURABLE ROW ID (insert + duplicate) AND RETRYABLE PERSISTENCE FAILURE
// ============================================================================
/** A minimal chainable fake PostgREST client, matching the D1-B adapter's usage. */
function fakeClient(behavior) {
  const make = () => {
    const state = { table: null, op: null, row: null, filters: {} };
    const b = {
      insert(row) { state.op = "insert"; state.row = row; return b; },
      update(o) { state.op = "update"; state.updates = o; return b; },
      select() { if (!state.op) state.op = "select"; return b; },
      eq(c, v) { state.filters[c] = v; return b; },
      single() { return Promise.resolve().then(() => behavior(state)); },
      limit() { return Promise.resolve().then(() => behavior(state)); },
      then(f, r) { return Promise.resolve().then(() => behavior(state)).then(f, r); },
    };
    return b;
  };
  return () => ({ from: (t) => { const b = make(); b.table = t; return b; } });
}

const WA_ID = "919812345678";
const envelope = (...messages) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: { phone_number_id: "111222333" },
    contacts: [{ profile: { name: "Priya Sharma" }, wa_id: WA_ID }],
    messages,
  } }] }],
});
/** The unix-seconds timestamp Meta would send for exactly `OCCURRED` (so the persisted instant is OCCURRED). */
const OCCURRED_UNIX = String(Date.parse(OCCURRED) / 1000);
const textMsg = (over = {}) => ({ from: WA_ID, id: WAMID_PLAIN, timestamp: OCCURRED_UNIX, type: "text", text: { body: "STOP" }, ...over });

/** A DURABLE row exactly as PostgREST would return it (the authority for all downstream context). */
const storedRow = (over = {}) => ({
  id: ROW_UUID,
  provider: "meta_whatsapp_cloud",
  provider_message_id: WAMID_PLAIN,
  sender_hash: HASH,
  resolved_principal_type: null,
  resolved_principal_id: null,
  identity_confidence: "unknown",
  message_type: "text",
  content_minimized: { text: "STOP" },
  provider_occurred_at: OCCURRED,
  received_at: RECEIVED,
  ...over,
});

function d1bDeps(over = {}) {
  const calls = { persists: [], resolves: [], finalizes: [] };
  const persisted = over.persisted ?? new Set();
  // The DURABLE store: keyed by the unique fence, written ONCE on first insert and never overwritten
  // by a redelivery — exactly like the real table.
  const store = over.store ?? new Map();
  return {
    calls, store,
    deps: {
      normalize: (payload) => M.Inbound.normalizeMetaInboundWebhook(payload),
      resolveIdentity: over.resolveIdentity ?? (async () => ({ ok: true, identity: { confidence: "unknown", principalType: null, principalId: null, candidateCount: 0 } })),
      createOrResolveReceipt: async () => ({ ok: true, receiptId: "receipt-1", duplicate: false }),
      persistInboundRow: over.persistInboundRow ?? (async (row) => {
        calls.persists.push(row);
        if (over.failPersist) return "failed";
        const key = `${row.provider}|${row.provider_message_id}`;
        if (store.has(key)) return "duplicate";                 // the fence: the ORIGINAL row stands
        store.set(key, storedRow({
          provider: row.provider,
          provider_message_id: row.provider_message_id,
          sender_hash: row.sender_hash,
          identity_confidence: row.identity_confidence,
          resolved_principal_type: row.resolved_principal_type,
          resolved_principal_id: row.resolved_principal_id,
          message_type: row.message_type,
          content_minimized: row.content_minimized,
          provider_occurred_at: row.provider_occurred_at,
          ...(over.storedOver ?? {}),
        }));
        persisted.add(row.provider_message_id);
        return "created";
      }),
      resolvePersistedInboundContext: over.resolvePersistedInboundContext ?? (async (row) => {
        calls.resolves.push(row);
        const key = `${row.provider}|${row.provider_message_id}`;
        const raw = store.get(key);
        if (!raw) return null;
        // Go through the REAL validator, exactly as the production adapter does.
        return M.D1B.validatePersistedInboundRow(raw, { provider: row.provider, providerMessageId: row.provider_message_id });
      }),
      finalizeReceipt: async (id, status, reason) => { calls.finalizes.push({ id, status, reason }); },
    },
  };
}
const runD1B = (payload, over = {}) => {
  const d = d1bDeps(over);
  return M.D1B.handleInboundWhatsAppMessages({ rawBody: JSON.stringify(payload), payload }, d.deps)
    .then((r) => ({ r, calls: d.calls, store: d.store }));
};

check("17. B1-B2. context comes FROM THE PERSISTED ROW; a duplicate returns the SAME durable UUID", async () => {
  const store = new Map();
  const first = await runD1B(envelope(textMsg()), { store });
  const second = await runD1B(envelope(textMsg()), { store });
  assert(first.r.ok && first.r.result.messagesPersisted === 1, "first inserts");
  assert(second.r.ok && second.r.result.messagesDuplicate === 1, "redelivery is an idempotent duplicate");
  const a = first.r.result.processed[0].receipt;
  const b = second.r.result.processed[0].receipt;
  assert(a.inboundMessageId === ROW_UUID && b.inboundMessageId === ROW_UUID, "both carry the DURABLE row UUID");
  assert(a.inboundMessageId === b.inboundMessageId, "the SAME row id on the insert and the duplicate path");
  assert(a.duplicate === false && b.duplicate === true, "insert vs duplicate is reported honestly");
  // B1: even the INSERT path reads its context back from the stored row (not from the in-flight object).
  assert(first.calls.resolves.length === 1, "the insert path also resolves the persisted row");
  assert(a.receivedAt === RECEIVED && a.providerOccurredAt === OCCURRED, "the PERSISTED timestamps are used");

  // The REAL adapter: exactly one VALID row → its projection; anything else → null (never invented).
  const fence = { provider: "meta_whatsapp_cloud", provider_message_id: WAMID_PLAIN };
  const one = await M.D1B.resolvePersistedInboundContextViaDb(fence, fakeClient(() => ({ data: [storedRow()], error: null })));
  assert(one && one.id === ROW_UUID && one.contentMinimized.text === "STOP", "exactly one row → its validated projection");
  const none = await M.D1B.resolvePersistedInboundContextViaDb(fence, fakeClient(() => ({ data: [], error: null })));
  assert(none === null, "zero rows → null, NEVER a fabricated row");
  const many = await M.D1B.resolvePersistedInboundContextViaDb(fence, fakeClient(() => ({ data: [storedRow(), storedRow({ id: ROW_UUID_2 })], error: null })));
  assert(many === null, "a violated fence (multi-row) → null, NEVER a guess — and never .single()/.limit()");
  const err = await M.D1B.resolvePersistedInboundContextViaDb(fence, fakeClient(() => ({ data: null, error: { code: "08006" } })));
  assert(err === null, "a db error → null (the caller fails closed)");
  // Equality filters only, and no cardinality-concealing modifiers — asserted on the RESOLVER ITSELF
  // (the pre-existing receipt adapter legitimately uses .single()/.limit(); this is not about that).
  const src = readF(D1B_SRC);
  const start = src.indexOf("export async function resolvePersistedInboundContextViaDb");
  assert(start > 0, "the resolver exists");
  const body = src.slice(start, src.indexOf("\n}", start));
  hasNot(/\.single\(|\.maybeSingle\(|\.limit\(/, body, "the resolver never conceals cardinality (no single/maybeSingle/limit)");
  has(/\.eq\("provider", row\.provider\)[\s\S]{0,120}\.eq\("provider_message_id", row\.provider_message_id\)/, body, "equality filters on the unique fence only");
  has(/rows\.length !== 1/, body, "exactly one row is required");
  has(/validatePersistedInboundRow/, body, "the row is validated before it is trusted");
});

check("B7. a malformed / zero / multi persisted row is RETRYABLE and never reaches D2-D", async () => {
  const fence = { provider: "meta_whatsapp_cloud", providerMessageId: WAMID_PLAIN };
  const malformed = [
    ["bad uuid", storedRow({ id: "not-a-uuid" })],
    ["fence provider mismatch", storedRow({ provider: "other" })],
    ["fence wamid mismatch", storedRow({ provider_message_id: "wamid.other" })],
    ["uppercase hash", storedRow({ sender_hash: "A".repeat(64) })],
    ["short hash", storedRow({ sender_hash: "abc" })],
    ["open confidence", storedRow({ identity_confidence: "maybe" })],
    ["exact without principal", storedRow({ identity_confidence: "exact" })],
    ["exact with bad principal id", storedRow({ identity_confidence: "exact", resolved_principal_type: "client", resolved_principal_id: "nope" })],
    ["exact with bad principal type", storedRow({ identity_confidence: "exact", resolved_principal_type: "root", resolved_principal_id: UUID })],
    ["unknown WITH a principal", storedRow({ identity_confidence: "unknown", resolved_principal_type: "client", resolved_principal_id: UUID })],
    ["partial principal pair", storedRow({ identity_confidence: "exact", resolved_principal_type: "client", resolved_principal_id: null })],
    ["unusable message type", storedRow({ message_type: "TEXT!" })],
    ["content is an array", storedRow({ content_minimized: [] })],
    ["content is null", storedRow({ content_minimized: null })],
    ["content is a string", storedRow({ content_minimized: "text" })],
    ["occurred_at not a string", storedRow({ provider_occurred_at: 1752230000 })],
    ["occurred_at malformed", storedRow({ provider_occurred_at: "2026-07-11" })],
    ["received_at missing", storedRow({ received_at: null })],
    ["received_at malformed", storedRow({ received_at: "07/12/2026" })],
    ["row is null", null],
    ["row is an array", []],
  ];
  for (const [name, raw] of malformed) {
    assert(M.D1B.validatePersistedInboundRow(raw, fence) === null, `a malformed durable row is NOT evidence: ${name}`);
  }
  // …and an EXACT row with a valid principal IS accepted.
  const good = M.D1B.validatePersistedInboundRow(storedRow({ identity_confidence: "exact", resolved_principal_type: "client", resolved_principal_id: UUID }), fence);
  assert(good && good.principalType === "client" && good.principalId === UUID, "a valid exact row is accepted");
  // A malformed durable row must make the whole webhook RETRYABLE (never a silent downstream drop).
  const bad = await runD1B(envelope(textMsg()), { storedOver: { sender_hash: "nope" } });
  assert(bad.r.ok === false && bad.r.code === "inbound_persisted_row_unresolved", "a malformed durable row → retryable");
  assert(bad.r.result.processed.length === 0, "nothing reaches D2-D from a malformed row");
});

check("19. persistence failure (and an unresolvable persisted row) is RETRYABLE", async () => {
  const fail = await runD1B(envelope(textMsg()), { failPersist: true });
  assert(fail.r.ok === false && fail.r.code === "inbound_persist_failed", "a real persistence failure → retryable");
  assert(fail.r.result.processed.length === 0, "nothing is handed downstream from a failed persistence");
  const unresolved = await runD1B(envelope(textMsg()), { resolvePersistedInboundContext: async () => null });
  assert(unresolved.r.ok === false && unresolved.r.code === "inbound_persisted_row_unresolved", "an unresolvable durable row → retryable");
  const threw = await runD1B(envelope(textMsg()), { resolvePersistedInboundContext: async () => { throw new Error("db down: SQLSTATE 08006"); } });
  assert(threw.r.ok === false && threw.r.code === "inbound_persisted_row_unresolved", "a THROWN resolver error → retryable, sanitized");
  assert(!safeStringify(threw.r).includes("SQLSTATE"), "no raw db error leaks");
});

// ============================================================================
// CORRECTION B — THE PERSISTED ROW OUTRANKS THE REDELIVERY (identity + content)
// ============================================================================
check("B3-B5. a REDELIVERY can never overwrite the stored facts (stored STOP + identity A wins over START + identity B)", async () => {
  const store = new Map();

  // 1) The ORIGINAL delivery: a text command equivalent to STOP, resolving to identity A (an EXACT client).
  const identityA = { ok: true, identity: { confidence: "exact", principalType: "client", principalId: UUID, candidateCount: 1 } };
  const original = await runD1B(envelope(textMsg({ text: { body: "STOP" } })), { store, resolveIdentity: async () => identityA });
  assert(original.r.ok && original.r.result.messagesPersisted === 1, "the original message is persisted");
  const stored = original.r.result.processed[0];
  assert(stored.message.contentMinimized.text === "STOP" && stored.receipt.principalId === UUID, "the stored row holds STOP + identity A");

  // 2) The REDELIVERY: the SAME wamid, but now carrying START and resolving to identity B (a vendor).
  const identityB = { ok: true, identity: { confidence: "exact", principalType: "vendor", principalId: UUID_B, candidateCount: 1 } };
  const redelivered = await runD1B(envelope(textMsg({ text: { body: "START" } })), { store, resolveIdentity: async () => identityB });
  assert(redelivered.r.ok && redelivered.r.result.messagesDuplicate === 1, "the redelivery is a duplicate");
  const dup = redelivered.r.result.processed[0];

  // 3) The downstream candidate MUST still carry the STORED facts — not the redelivery's.
  assert(dup.receipt.inboundMessageId === stored.receipt.inboundMessageId, "the same durable UUID");
  assert(dup.message.contentMinimized.text === "STOP", "B4: the STORED content wins — NOT the redelivery's START");
  assert(dup.message.messageType === "text", "the STORED message type wins");
  assert(dup.receipt.identityConfidence === "exact" && dup.receipt.principalType === "client" && dup.receipt.principalId === UUID,
    "B3: the STORED identity A wins — NOT the freshly-resolved identity B");
  assert(dup.receipt.principalId !== UUID_B, "the redelivery's identity B never leaks downstream");
  assert(dup.receipt.destinationHash === stored.receipt.destinationHash, "the STORED destination hash wins");
  assert(dup.receipt.providerOccurredAt === stored.receipt.providerOccurredAt, "the STORED occurrence time wins");
  assert(dup.receipt.receivedAt === stored.receipt.receivedAt, "the STORED capture time wins");

  // 4) …and what D2-D is actually asked to write is the STORED command, not the redelivered one.
  const store2 = newWriterStore();
  const { r } = await runOrch([{ message: dup.message, receipt: dup.receipt }], store2);
  assert(store2.calls.length === 1 && store2.calls[0].command === "stop", "D2-D is asked to apply the STORED stop, never the redelivered start");
  assert(store2.calls[0].principal.type === "client" && store2.calls[0].principal.id === UUID, "the STORED principal reaches D2-D");
  assert(r.ok === true, "handled");
});

check("ORDER. persistence STRICTLY precedes command processing (D1-B context feeds D2-E)", async () => {
  const { r } = await runD1B(envelope(textMsg()));
  assert(r.ok && r.result.processed.length === 1, "D1-B emits the per-message context only AFTER persisting");
  const { message, receipt } = r.result.processed[0];
  assert(receipt.inboundMessageId === ROW_UUID, "the durable row id already exists when the command runs");
  // …and that exact context is what D2-E consumes.
  const { store } = await runOrch([{ message, receipt }]);
  assert(store.calls.length === 1 && store.calls[0].inboundMessageId === ROW_UUID, "the persisted row id reaches D2-D");
  assert(store.calls[0].providerMessageId === sha256hex(WAMID_PLAIN), "the hashed identity of the persisted wamid reaches D2-D");
  // The webhook seam: persistence, then the ok-gate, then commands — in that SOURCE order.
  const src = readF(WEBHOOK_SVC_SRC);
  const iPersist = src.indexOf("handleInboundWhatsAppMessages(");
  const iOkGate = src.indexOf('if (!inbound.ok) return { status: 500');
  const iCommand = src.indexOf("processInboundConsentCommands(");
  assert(iPersist > 0 && iOkGate > 0 && iCommand > 0, "all three steps are present");
  assert(iPersist < iOkGate, "the persistence call precedes its ok-gate");
  assert(iOkGate < iCommand, "commands run ONLY after persistence returned ok (the gate is between them)");
  // …and nothing re-enters the command path before the gate.
  assert(src.slice(iPersist, iOkGate).indexOf("processInboundConsentCommands(") === -1, "no command processing before the ok-gate");
});

// ============================================================================
// 22. PRIVACY — nothing sensitive escapes
// ============================================================================
check("22. no raw phone / message body / destination hash / SQL error / stack in any outcome", async () => {
  const BODY = "STOP";
  const outcomes = [];
  const s1 = newWriterStore();
  outcomes.push((await runOrch([candidate({ contentMinimized: { text: BODY } })], s1)).r);
  outcomes.push((await runOrch([candidate({ contentMinimized: { text: "please stop texting me now" } })])).r);
  outcomes.push((await runOrch([candidate({ contentMinimized: { text: "HELP" } })])).r);
  const s2 = newWriterStore(); s2.failWith = "WRITER_TRANSACTION_FAILED";
  outcomes.push((await runOrch([candidate()], s2)).r);
  const s3 = newWriterStore(); s3.throwOnce = true;
  outcomes.push((await runOrch([candidate()], s3)).r);

  for (const o of outcomes) {
    const rendered = safeStringify(o);
    assert(!rendered.includes(HASH), "no destination hash echoed");
    assert(!rendered.includes(WA_ID) && !rendered.includes("+919812345678"), "no plaintext phone");
    assert(!rendered.includes("please stop texting me now"), "no raw message body");
    assert(!/SQLSTATE|connection reset|db down|stack|Error:|at Object\./i.test(rendered), "no raw db error / SQLSTATE / stack");
    assert(!rendered.includes(WAMID_BASE64), "no raw base64 wamid");
  }
  // The BUILDER never returns the body or the raw destination either.
  const rejected = M.Input.buildInboundConsentCommandInput("stop", msg({ messageType: "image" }), rcpt());
  assert(rejected.ok === false && safeStringify(rejected) === safeStringify({ ok: false, reason: "NOT_COMMAND_ELIGIBLE" }), "a rejection is a bare sanitized reason code");
});

// ============================================================================
// 15-16, 24. BOUNDARIES — D2-C never touched; the webhook never imports the writer
// ============================================================================
check("15. D2-C is NEVER imported or invoked (it is a SEND-authorization authority, not a command one)", () => {
  for (const f of [ORCH_SRC, BUILDER_SRC, WEBHOOK_SVC_SRC, D1B_SRC]) {
    const code = stripTs(readF(f));
    hasNot(/communicationConsentDecisionService|decideCommunicationConsent/, code, `${f} does not import/invoke D2-C`);
    hasNot(/CommunicationConsentDecision|ConsentDisposition/, code, `${f} does not use the D2-C contract`);
  }
});

check("16. the webhook imports ONLY the D2-E orchestrator — never the D2-D writer", () => {
  const code = stripTs(readF(WEBHOOK_SVC_SRC));
  hasNot(/communicationConsentWriterService|writeConsentCommand/, code, "the webhook NEVER imports the D2-D writer");
  hasNot(/apply_communication_consent_command/, code, "the webhook never calls the RPC");
  // PRECISE: reject the actual forbidden NORMALIZER — its exact module path (static or dynamic) and its
  // symbol — not any identifier that merely CONTAINS the substring "consentCommand". The broad matcher
  // also rejected legitimate modules whose names begin with it (e.g. `./consentCommandResponseService`),
  // which normalize nothing. The guarantee is unchanged and the failure message is unchanged.
  hasNot(/["']\.\.\/lib\/communication\/consentCommand["']|normalizeConsentCommand/, code, "the webhook never normalizes a command itself");
  hasNot(/communication_preferences|communication_suppressions/, code, "the webhook never touches consent tables");
  has(/import \{ processInboundConsentCommands \} from "\.\/inboundConsentCommandService"/, readF(WEBHOOK_SVC_SRC), "it imports the orchestrator only");
  // A CLOSED ALLOWLIST of the consent-facing MODULES the webhook may import (checked on the module
  // specifiers, not the binding names — `processInboundConsentCommands` legitimately contains "Consent").
  //   • ./inboundConsentCommandService   — the D2-E inbound command orchestrator;
  //   • ./consentCommandResponseService  — the D4-B evidence-bound acknowledgement orchestrator.
  // Nothing else. The D2-D writer, the D2-C decision authority and the D2-D normalizer all remain
  // rejected (by this allowlist AND by the explicit guards above), so no consent authority can be
  // smuggled into the webhook under a new name.
  //   • ./outboundConsentEnforcementService — PHASE 8A, and ONLY for the fail-closed factory (proven at
  //     the SYMBOL level below). The webhook builds a CommunicationService for DELIVERY RECEIPTS; binding
  //     an enforcer that can never allow NARROWS its blast radius rather than widening its authority.
  const ALLOWED_CONSENT_MODULES = ["./inboundConsentCommandService", "./consentCommandResponseService", "./outboundConsentEnforcementService"];
  const specifiers = [...readF(WEBHOOK_SVC_SRC).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  const consentSpecifiers = specifiers.filter((s) => /consent/i.test(s));
  const unapproved = consentSpecifiers.filter((s) => !ALLOWED_CONSENT_MODULES.includes(s));
  assert(unapproved.length === 0,
    `only the approved consent orchestrators may be imported by the webhook (got [${unapproved.join(", ")}])`);
  assert(consentSpecifiers.includes("./inboundConsentCommandService"),
    "the D2-E orchestrator must still be imported");
  const enforcementSymbols = [...readF(WEBHOOK_SVC_SRC).matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/outboundConsentEnforcementService"/g)]
    .flatMap((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean));
  assert(enforcementSymbols.every((s) => s === "createFailClosedOutboundConsentEnforcer"),
    `the webhook may import ONLY the fail-closed enforcer (got [${enforcementSymbols.join(", ")}])`);
  hasNot(/createOutboundConsentEnforcer\b/, code, "the webhook NEVER binds the REAL consent authority");
});

check("24. the existing D1-B / D2-C / D2-D boundaries stay green", () => {
  // D1-B remains CONSENT-AGNOSTIC (its own harness enforces this too — we assert it here as well).
  const d1b = stripTs(readF(D1B_SRC));
  hasNot(/consent/i, d1b, "D1-B contains no consent reference");
  hasNot(/\bSTOP\b|\bSTART\b|\bUNSUBSCRIBE\b|opt_out|opt_in/, d1b, "D1-B contains no command literal");
  hasNot(/communicationConsentWriterService|writeConsentCommand|inboundConsentCommandService/, d1b, "D1-B imports no consent module");
  // D2-D + D2-C production files are byte-unchanged in this worktree.
  const dirty = gitDirty();
  for (const f of [WRITER_SRC, COMMAND_SRC, "lib/communication/consentPolicy.ts", D2C_SVC_SRC, D2D_MIGRATION]) {
    assert(!dirty.includes(f), `${f} must be unchanged by D2-E`);
  }
  // The orchestrator is the SOLE writer touchpoint, and it calls the writer — it never re-implements it.
  const orch = stripTs(readF(ORCH_SRC));
  has(/writeConsentCommand\(input\)/, orch, "the orchestrator delegates to the D2-D writer");
  hasNot(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/, orch, "the orchestrator performs NO direct db write");
  hasNot(/adminClient/, orch, "the orchestrator holds no db client");
  hasNot(/sendTemplateMessage|sendAuthenticationMessage|\.send\(|graph\.facebook|\bn8n\b/i, orch, "no send / Meta / n8n");
  // The pure builder really is pure. (`.update(` is deliberately NOT probed: `createHash().update()` is a
  // HASH update, not a database write — the database surface is `.from(`/`.insert(`/`.rpc(`/adminClient.)
  const builder = stripTs(readF(BUILDER_SRC));
  hasNot(/adminClient|supabase|fetch\(|console\.|Date\.now\(|Math\.random/i, builder, "the builder is PURE (no db/network/log/clock/randomness)");
  hasNot(/\.from\(|\.insert\(|\.upsert\(|\.delete\(|\.rpc\(/, builder, "the builder performs no database operation");
  hasNot(/writeConsentCommand|apply_communication_consent_command/, builder, "the builder never writes consent state");
});

// ============================================================================
// 1-2, 23. PHASE SCOPE + ANCESTRY
// ============================================================================
check("F1-F6, 23. FROZEN audited range: exact anchors, both ancestry proofs, seven files, D2-E subjects", () => {
  // F1-F2: the anchors are the EXACT approved base and audited corrected-implementation head.
  assert(D2E_BASE === "94b8c1522269635cdbbe53fb6d11ea2bf91b05a9", "F1. the approved D2-E base");
  assert(D2E_HEAD === "56e8f5193eb1be5d24ece3ec00822608b7f50057", "F2. the audited corrected D2-E head");

  const fr = d2eFrozenRange();
  // F3-F4: both ancestry proofs. A failure of either is a SCOPE VIOLATION, not a warning.
  const anchorProblems = validateD2EAnchors(fr);
  assert(anchorProblems.length === 0, anchorProblems.join(" | "));
  assert(fr.baseIsAncestorOfHead === true, "F3. base is an ancestor of the audited head");
  assert(fr.headIsAncestorOfCurrent === true, "F4. the audited head is an ancestor of the current HEAD");
  assert(fr.commits.length >= 1, "the frozen range contains at least one implementation commit");

  // F6: subjects are validated ONLY for the NON-MERGE implementation commits INSIDE the frozen range.
  const subjectProblems = validateD2ESubjects(fr.messages);
  assert(subjectProblems.length === 0, subjectProblems.join(" | "));

  // The frozen delta is cumulative WITHIN the range: it must cover every file touched by EVERY commit in
  // it (an eighth file added by a LATER correction commit inside the range must not be invisible).
  const frozen = new Set(fr.files);
  for (const files of fr.perCommit) {
    for (const f of files) assert(frozen.has(f), `the frozen delta must cover every in-range commit's files (missing ${f})`);
  }
  // F5 + 23: EXACTLY the approved seven, nothing forbidden. The worktree is NOT unioned in.
  const problems = validateD2EScope(fr.files, fr.anchorsProven);
  assert(problems.length === 0, `frozen D2-E scope violation: ${problems.join(" | ")}`);
});

check("F13. the historical range is measured against D2E_HEAD, NEVER the current HEAD", () => {
  const fr = d2eFrozenRange();
  // Post-audit history (this freeze commit, a future PR merge, later phases) must be OUTSIDE the range.
  for (const c of postAuditCommits()) {
    assert(!fr.commits.includes(c), `a post-audit commit leaked into the frozen range: ${c.slice(0, 8)}`);
  }
  // The frozen file list must equal the real base..audited-head delta — never a base..HEAD delta.
  const frozenDelta = gitFiles(["diff", "--name-only", `${D2E_BASE}..${D2E_HEAD}`]);
  assert(JSON.stringify([...fr.files].sort()) === JSON.stringify([...frozenDelta].sort()), "the frozen delta IS base..audited-head");
  // …and the harness source must not compute the historical range from HEAD.
  const src = readF(HARNESS_SRC);
  hasNot(/diff", "--name-only", `\$\{D2E_BASE\}\.\.HEAD`/, src, "the historical delta is never base..HEAD");
  has(/rev-list", "--no-merges", `\$\{base\}\.\.\$\{head\}`/, src, "commits come from base..head with --no-merges");
});

check("F14-F21. current-worktree protection is SEPARATE: authorities protected, seams released", () => {
  // The live worktree must not be editing a D2-E authority file.
  const problems = validateD2EWorktree(gitDirty());
  assert(problems.length === 0, `protected-file worktree violation: ${problems.join(" | ")}`);
  // F14-F15: each D2-E-owned authority file trips it.
  assert(validateD2EWorktree([BUILDER_SRC]).length > 0, "F14. a dirty input builder is caught");
  assert(validateD2EWorktree([ORCH_SRC]).length > 0, "F15. a dirty orchestrator is caught");
  assert(validateD2EWorktree([BUILDER_SRC, ORCH_SRC]).length === 2, "both authorities are caught together");
  // F16-F19, F21: the released seams + the maintenance surface are ALLOWED, individually and together.
  for (const f of D2E_RELEASED_SEAMS) assert(validateD2EWorktree([f]).length === 0, `a released file must be allowed: ${f}`);
  assert(validateD2EWorktree([D1B_SRC, WEBHOOK_SVC_SRC]).length === 0, "F18. D1-B + the webhook dirty TOGETHER are allowed");
  assert(validateD2EWorktree(["package.json"]).length === 0, "F19. a dirty package.json is allowed (future phase scripts)");
  assert(validateD2EWorktree([HARNESS_SRC, DOC_SRC]).length === 0, "F21. harness/doc maintenance edits are allowed");
  // F20: future-phase files are allowed — a later phase must never re-open the frozen D2-E audit.
  assert(validateD2EWorktree([
    "services/inboundConsentAcknowledgementService.ts",
    "lib/communication/outboundConsentAck.ts",
    "scripts/phase5f-d2f-consent-ack-harness.mjs",
    "docs/QF-Consent-Ack-Phase-5F-D2-F.md",
    "supabase/migrations/20260801000000_future.sql",
  ]).length === 0, "F20. future-phase files are not D2-E worktree violations");
  // A realistic future-phase pre-commit worktree must leave D2-E green.
  assert(validateD2EWorktree([D1B_SRC, WEBHOOK_SVC_SRC, "package.json", "services/futureThing.ts"]).length === 0,
    "a realistic future-phase worktree does not trip D2-E");
});

check("WIRING. the d2e script + doc exist and the doc covers the contract", () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:d2e"] === "node scripts/phase5f-d2e-inbound-consent-integration-harness.mjs", "d2e script wired");
  for (const f of [BUILDER_SRC, ORCH_SRC, HARNESS_SRC, DOC_SRC]) assert(existsSync(f), `${f} exists`);
  const doc = readF(DOC_SRC);
  for (const topic of [
    /integration seam/i, /meta_whatsapp_cloud/, /meta_whatsapp\b/, /SHA-?256/i, /wamid/i,
    /fallback/i, /receivedAt|received.at/i, /persistence.*before.*command|persist.*first/i,
    /duplicate/i, /replay/i, /deterministic/i, /retryable/i, /HELP/, /no outbound|sends nothing/i,
    /D2-C/, /Meta remains disabled|no Meta activation/i, /no (new )?migration|no SQL/i, /n8n/i,
    /privacy/i, /rollback/i,
    // ---- the post-audit historical freeze (tests + docs only) ----
    /94b8c1522269635cdbbe53fb6d11ea2bf91b05a9/, /56e8f5193eb1be5d24ece3ec00822608b7f50057/,
    /frozen/i, /ancestry|ancestor/i, /non-merge|--no-merges/i, /merge commit/i,
    /worktree/i, /protected/i, /released/i, /tests-and-docs only|tests only|changes no production/i,
  ]) has(topic, doc, `doc covers ${topic}`);
  // The doc must no longer claim the range is unfrozen.
  hasNot(/not frozen yet|NOT FROZEN YET/i, doc, "the doc no longer claims the historical range is unfrozen");
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutationChecks = [];
function srcMutation(name, file, from, to, scenario) { mutationChecks.push({ name, kind: "src", edits: [{ file, from, to }], scenario }); }
function fnMutation(name, scenario) { mutationChecks.push({ name, kind: "fn", scenario }); }

/** Rebuild from the mutated sources and re-drive the scenario. */
async function withMutatedBuild(fn) {
  const dir = resolve(`.phase5fd2e-mut-${Math.random().toString(36).slice(2, 8)}`);
  try {
    compileTo(dir);
    transpileServices(dir);
    return await fn(wireBuild(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

srcMutation("MUT A: the provider mapping is bypassed (the raw adapter key reaches D2-D)", BUILDER_SRC,
  "  const provider = mapAdapterProviderToConsentProvider(message.provider);\n  if (!provider) return reject(CommandInputRejectReason.UNMAPPED_PROVIDER);",
  "  const provider = message.provider;",
  () => withMutatedBuild(async (mm) => {
    const store = newWriterStore();
    const r = await mm.Orch.processInboundConsentCommands([candidate()], { normalize: mm.Command.normalizeConsentCommand, writeCommand: simWriter(store) });
    // D2-D would REJECT meta_whatsapp_cloud → the STOP is silently dropped.
    return store.calls[0]?.provider === "meta_whatsapp_cloud" || r.result.items[0].disposition !== "stop_applied";
  }));

srcMutation("MUT B: the RAW wamid is used as the provider event id (a base64 wamid would be dropped)", BUILDER_SRC,
  "      providerMessageId: deriveProviderEventId(message.providerMessageId),",
  "      providerMessageId: message.providerMessageId,",
  () => withMutatedBuild(async (mm) => {
    const store = newWriterStore();
    const r = await mm.Orch.processInboundConsentCommands([candidate({ providerMessageId: WAMID_BASE64 })], { normalize: mm.Command.normalizeConsentCommand, writeCommand: simWriter(store) });
    // the raw base64 wamid violates D2-D's fence → INVALID_WRITER_INPUT → a silently dropped STOP
    return r.result.items[0].disposition !== "stop_applied";
  }));

srcMutation("MUT C: the digest is truncated (identity collisions become possible)", BUILDER_SRC,
  '  return createHash("sha256").update(providerMessageId, "utf8").digest("hex");',
  '  return createHash("sha256").update(providerMessageId, "utf8").digest("hex").slice(0, 8);',
  () => withMutatedBuild(async (mm) => !/^[0-9a-f]{64}$/.test(mm.Input.deriveProviderEventId(WAMID_PLAIN))));

srcMutation("MUT D: the timestamp fallback is removed (a missing provider time DROPS the command)", BUILDER_SRC,
  "  return toStrictIsoInstant(providerOccurredAt) ?? toStrictIsoInstant(receivedAt);",
  "  return toStrictIsoInstant(providerOccurredAt);",
  () => withMutatedBuild(async (mm) => {
    const store = newWriterStore();
    const r = await mm.Orch.processInboundConsentCommands([candidate({}, { providerOccurredAt: null })], { normalize: mm.Command.normalizeConsentCommand, writeCommand: simWriter(store) });
    return store.calls.length === 0 && r.result.items[0].disposition === "input_not_buildable";
  }));

srcMutation("MUT E: eligibility is widened beyond text (a button reply becomes a command)", BUILDER_SRC,
  "  return !!message && message.messageType === COMMAND_ELIGIBLE_MESSAGE_TYPE;",
  "  return !!message;",
  () => withMutatedBuild(async (mm) => {
    const store = newWriterStore();
    await mm.Orch.processInboundConsentCommands([candidate({ messageType: "button_reply", contentMinimized: { text: "STOP" } })], { normalize: mm.Command.normalizeConsentCommand, writeCommand: simWriter(store) });
    return store.calls.length > 0; // a non-text message reached the writer
  }));

srcMutation("MUT F: HELP is routed through the writer (the short-circuit is removed)", ORCH_SRC,
  '    if (command === "help") {',
  '    if (false) {',
  () => withMutatedBuild(async (mm) => {
    const store = newWriterStore();
    await mm.Orch.processInboundConsentCommands([candidate({ contentMinimized: { text: "HELP" } })], { normalize: mm.Command.normalizeConsentCommand, writeCommand: simWriter(store) });
    return store.calls.length > 0; // HELP reached the writer
  }));

srcMutation("MUT G: unsupported text is routed through the writer", ORCH_SRC,
  '    if (command === "unsupported") {',
  '    if (false) {',
  () => withMutatedBuild(async (mm) => {
    const store = newWriterStore();
    await mm.Orch.processInboundConsentCommands([candidate({ contentMinimized: { text: "hello there" } })], { normalize: mm.Command.normalizeConsentCommand, writeCommand: simWriter(store) });
    return store.calls.length > 0;
  }));

srcMutation("MUT H: a non-text message is no longer skipped", ORCH_SRC,
  "    if (!message || !receipt || !isCommandEligible(message)) {",
  "    if (!message || !receipt) {",
  () => withMutatedBuild(async (mm) => {
    const store = newWriterStore();
    const r = await mm.Orch.processInboundConsentCommands([candidate({ messageType: "image", contentMinimized: { text: "STOP" } })], { normalize: mm.Command.normalizeConsentCommand, writeCommand: simWriter(store) });
    return store.calls.length > 0 || r.result.skippedNotEligible === 0;
  }));

srcMutation("MUT I: WRITER_TRANSACTION_FAILED is treated as DETERMINISTIC (a real STOP would be lost)", ORCH_SRC,
  '    if (outcome.code === "WRITER_TRANSACTION_FAILED") {',
  "    if (false) {",
  () => withMutatedBuild(async (mm) => {
    const store = newWriterStore(); store.failWith = "WRITER_TRANSACTION_FAILED";
    const r = await mm.Orch.processInboundConsentCommands([candidate()], { normalize: mm.Command.normalizeConsentCommand, writeCommand: simWriter(store) });
    return r.ok === true; // acknowledged instead of retried → the STOP is lost
  }));

srcMutation("MUT J: a DETERMINISTIC writer failure is treated as retryable (an infinite retry storm)", ORCH_SRC,
  "    const disposition = DETERMINISTIC_WRITER_FAILURES[outcome.code] ?? \"writer_integrity_violation\";\n    result = { ...result, deterministicFailures: result.deterministicFailures + 1 };\n    push({ inboundMessageId, command, disposition, replayed: false, retryable: false });",
  "    retryableCode = retryableCode ?? COMMAND_WRITE_UNAVAILABLE;\n    push({ inboundMessageId, command, disposition: \"writer_conflict\", replayed: false, retryable: true });",
  () => withMutatedBuild(async (mm) => {
    const store = newWriterStore(); store.failWith = "WRITER_CONFLICT";
    const r = await mm.Orch.processInboundConsentCommands([candidate()], { normalize: mm.Command.normalizeConsentCommand, writeCommand: simWriter(store) });
    return r.ok === false; // a deterministic conflict would now retry forever
  }));

srcMutation("MUT K: the writer is called for a non-exact identity carrying a principal", BUILDER_SRC,
  "  } else if (receipt.principalType !== null || receipt.principalId !== null) {\n    return reject(CommandInputRejectReason.INVALID_IDENTITY);\n  }",
  "  }",
  () => withMutatedBuild(async (mm) => {
    const store = newWriterStore();
    await mm.Orch.processInboundConsentCommands([candidate({}, { identityConfidence: "unknown", principalType: "client", principalId: UUID })], { normalize: mm.Command.normalizeConsentCommand, writeCommand: simWriter(store) });
    return store.calls.length > 0; // a smuggled principal reached the writer
  }));

srcMutation("MUT L: D1-B GUESSES a row when the unique fence resolves to multiple rows", D1B_SRC,
  "    const rows = (data ?? []) as unknown[];\n    if (rows.length !== 1) return null;",
  "    const rows = (data ?? []) as unknown[];\n    if (rows.length === 0) return null;",
  () => withMutatedBuild(async (mm) => {
    const many = await mm.D1B.resolvePersistedInboundContextViaDb(
      { provider: "meta_whatsapp_cloud", provider_message_id: WAMID_PLAIN },
      fakeClient(() => ({ data: [storedRow(), storedRow({ id: ROW_UUID_2 })], error: null })));
    return many !== null; // it guessed a row instead of failing closed on a violated fence
  }));

srcMutation("MUT M: an unresolvable durable row is SWALLOWED instead of failing closed", D1B_SRC,
  '    if (!persistedRow) { failureReason = failureReason ?? "inbound_persisted_row_unresolved"; continue; }',
  "    if (!persistedRow) { continue; }",
  () => withMutatedBuild(async (mm) => {
    const { deps } = d1bDeps({ resolvePersistedInboundContext: async () => null });
    const payload = envelope(textMsg());
    const r = await mm.D1B.handleInboundWhatsAppMessages({ rawBody: JSON.stringify(payload), payload }, deps);
    return r.ok === true; // acknowledged with no downstream context → the command is silently lost
  }));

// ---- CORRECTION B: the persisted row must OUTRANK the in-flight redelivery -------------------
srcMutation("MUT S: duplicate context is rebuilt from the TRANSIENT redelivery (the pre-correction defect)", D1B_SRC,
  `    processed.push({
      message: {
        provider: persistedRow.provider,
        providerMessageId: persistedRow.providerMessageId,
        messageType: persistedRow.messageType,
        contentMinimized: persistedRow.contentMinimized,
        providerOccurredAt: persistedRow.providerOccurredAt,
      },
      receipt: {
        inboundMessageId: persistedRow.id,
        provider: persistedRow.provider,
        providerMessageId: persistedRow.providerMessageId,
        duplicate: outcome === "duplicate",
        destinationHash: persistedRow.senderHash,
        identityConfidence: persistedRow.identityConfidence,
        principalType: persistedRow.principalType,
        principalId: persistedRow.principalId,
        receivedAt: persistedRow.receivedAt,
        providerOccurredAt: persistedRow.providerOccurredAt,
      },
    });`,
  `    processed.push({
      message: {
        provider: row.provider,
        providerMessageId: row.provider_message_id,
        messageType: row.message_type,
        contentMinimized: row.content_minimized,
        providerOccurredAt: row.provider_occurred_at,
      },
      receipt: {
        inboundMessageId: persistedRow.id,
        provider: row.provider,
        providerMessageId: row.provider_message_id,
        duplicate: outcome === "duplicate",
        destinationHash: row.sender_hash,
        identityConfidence: row.identity_confidence,
        principalType: row.resolved_principal_type,
        principalId: row.resolved_principal_id,
        receivedAt: persistedRow.receivedAt,
        providerOccurredAt: row.provider_occurred_at,
      },
    });`,
  () => withMutatedBuild(async (mm) => {
    const store = new Map();
    const idA = { ok: true, identity: { confidence: "exact", principalType: "client", principalId: UUID, candidateCount: 1 } };
    const idB = { ok: true, identity: { confidence: "exact", principalType: "vendor", principalId: UUID_B, candidateCount: 1 } };
    const run = async (body, resolveIdentity) => {
      const { deps } = d1bDeps({ store, resolveIdentity: async () => resolveIdentity });
      const payload = envelope(textMsg({ text: { body } }));
      return mm.D1B.handleInboundWhatsAppMessages({ rawBody: JSON.stringify(payload), payload }, deps);
    };
    await run("STOP", idA);
    const dup = await run("START", idB);
    const c = dup.result.processed[0];
    // The redelivery's START / identity B would now leak downstream instead of the stored STOP / identity A.
    return c.message.contentMinimized.text === "START" || c.receipt.principalId === UUID_B;
  }));

// ---- CORRECTION C: the strict calendar validator must not degrade to Date.parse ---------------
srcMutation("MUT T: the timestamp validator degrades to Date.parse (an impossible date silently ROLLS OVER)", BUILDER_SRC,
  "export function toStrictIsoInstant(value: unknown): string | null {\n  if (!isStrictRfc3339(value)) return null;\n  const t = Date.parse(value as string);",
  "export function toStrictIsoInstant(value: unknown): string | null {\n  if (typeof value !== \"string\") return null;\n  const t = Date.parse(value as string);",
  () => withMutatedBuild(async (mm) => {
    // 2026-02-31 would be rolled into 3 March instead of falling back to received-at.
    const rolled = mm.Input.toStrictIsoInstant("2026-02-31T10:30:00Z");
    return typeof rolled === "string" && rolled.startsWith("2026-03-03");
  }));

// The explicit range checks and the setUTC ROUND-TRIP are DEFENCE IN DEPTH: either one alone still
// rejects an impossible calendar value, so a load-bearing mutation must remove BOTH. (That redundancy is
// the point — a single edit can never re-open the rollover hole.) Each mutation below proves the PAIR.
const ROUND_TRIP_EDIT = {
  file: BUILDER_SRC,
  from: "  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day\n      || d.getUTCHours() !== hour || d.getUTCMinutes() !== minute || d.getUTCSeconds() !== second) return false;",
  to: "  if (false) return false;",
};

mutationChecks.push({
  name: "MUT U: BOTH the calendar-day check AND the round-trip removed (2026-02-31 would roll to 3 March)",
  kind: "src",
  edits: [
    { file: BUILDER_SRC, from: "  if (day < 1 || day > daysInMonth(year, month)) return false;   // 2026-02-31 dies here", to: "  if (day < 1 || day > 31) return false;" },
    ROUND_TRIP_EDIT,
  ],
  scenario: () => withMutatedBuild(async (mm) => {
    if (mm.Input.isStrictRfc3339("2026-02-31T10:30:00Z") !== true) return false;
    // …and it would then be silently NORMALIZED into a different real date.
    return mm.Input.toStrictIsoInstant("2026-02-31T10:30:00Z")?.startsWith("2026-03-03") === true;
  }),
});

mutationChecks.push({
  name: "MUT V: BOTH the time-range check AND the round-trip removed (24:00:00 would roll to the next day)",
  kind: "src",
  edits: [
    { file: BUILDER_SRC, from: "  if (hour > 23 || minute > 59 || second > 59) return false;      // 24:00:00 dies here", to: "  if (hour > 99) return false;" },
    ROUND_TRIP_EDIT,
  ],
  scenario: () => withMutatedBuild(async (mm) => mm.Input.isStrictRfc3339("2026-01-01T24:00:00Z") === true),
});

// …and each fence ALONE still holds when the other is removed (proving the redundancy is real, not dead).
srcMutation("MUT U2: the round-trip alone still rejects an impossible date when the day check is removed", BUILDER_SRC,
  "  if (day < 1 || day > daysInMonth(year, month)) return false;   // 2026-02-31 dies here",
  "  if (day < 1 || day > 31) return false;",
  () => withMutatedBuild(async (mm) => mm.Input.isStrictRfc3339("2026-02-31T10:30:00Z") === false));

srcMutation("MUT V2: the day check alone still rejects an impossible date when the round-trip is removed", BUILDER_SRC,
  ROUND_TRIP_EDIT.from, ROUND_TRIP_EDIT.to,
  () => withMutatedBuild(async (mm) => mm.Input.isStrictRfc3339("2026-02-31T10:30:00Z") === false
    && mm.Input.isStrictRfc3339("2026-01-01T24:00:00Z") === false));

srcMutation("MUT W: the UTC-offset range check is removed (+25:00 becomes acceptable)", BUILDER_SRC,
  "    if (offsetHour > 23 || offsetMinute > 59) return false;       // an invalid offset dies here",
  "    if (offsetHour > 99) return false;",
  () => withMutatedBuild(async (mm) => mm.Input.isStrictRfc3339("2026-01-01T10:30:00+25:00") === true));

srcMutation("MUT N: the webhook processes commands BEFORE persistence is confirmed (the ok-gate is removed)", WEBHOOK_SVC_SRC,
  '    if (!inbound.ok) return { status: 500, code: "inbound_processing_failed" };',
  "",
  () => {
    const src = readF(WEBHOOK_SVC_SRC);
    const iOkGate = src.indexOf('if (!inbound.ok) return { status: 500');
    const iCommand = src.indexOf("processInboundConsentCommands(");
    // With the gate gone, commands would run on an UNCONFIRMED persistence result.
    return iOkGate === -1 || iOkGate > iCommand;
  });

srcMutation("MUT O: a retryable command failure no longer 500s the webhook", WEBHOOK_SVC_SRC,
  '    if (!commands.ok) return { status: 500, code: "inbound_command_processing_failed" };',
  "",
  () => !/if \(!commands\.ok\) return \{ status: 500/.test(readF(WEBHOOK_SVC_SRC)));

// ---- FROZEN-RANGE FREEZE mutations -----------------------------------------------------------
fnMutation("MUT P: F11. an EIGHTH file inside the frozen historical range is rejected",
  () => ["services/other.ts", ".env.local", "app/api/consent/route.ts", "supabase/migrations/20260713000000_x.sql",
    "services/communicationConsentWriterService.ts", "lib/communication/consentCommand.ts",
    "services/communicationConsentDecisionService.ts", "package-lock.json"]
    .every((f) => validateD2EScope([...D2E_EXPECTED_FILES, f], true).length > 0));

fnMutation("MUT Q: F10. a MISSING approved file in the frozen range is rejected",
  () => D2E_EXPECTED_FILES.every((f) => validateD2EScope(D2E_EXPECTED_FILES.filter((x) => x !== f), true).length > 0)
     && validateD2EScope(D2E_EXPECTED_FILES, true).length === 0); // …and the honest seven still pass

fnMutation("MUT R: an unmeasurable frozen range (anchor ancestry unproven) is rejected",
  () => validateD2EScope(D2E_EXPECTED_FILES, false).length > 0
     && validateD2EAnchors({ baseIsAncestorOfHead: false, headIsAncestorOfCurrent: true }).length > 0
     && validateD2EAnchors({ baseIsAncestorOfHead: true, headIsAncestorOfCurrent: false }).length > 0
     && validateD2EAnchors({ baseIsAncestorOfHead: true, headIsAncestorOfCurrent: true }).length === 0);

fnMutation("MUT X: F7. a WRONG base fails (base not an ancestor of the audited head)",
  () => {
    // A real-but-wrong base: the audited head itself is not an ancestor of itself's parent chain start.
    const swapped = d2eFrozenRange(D2E_HEAD, D2E_BASE); // 56e8f51 is NOT an ancestor of 94b8c15
    if (swapped.baseIsAncestorOfHead !== false || swapped.anchorsProven !== false) return false;
    if (validateD2EAnchors(swapped).length === 0) return false;
    // A non-existent base must also fail closed rather than yield a vacuously-empty range.
    const bogus = d2eFrozenRange("0".repeat(40), D2E_HEAD);
    return bogus.anchorsProven === false && bogus.files.length === 0
        && validateD2EScope(bogus.files, bogus.anchorsProven).length > 0;
  });

fnMutation("MUT Y: F8-F9. a WRONG audited head fails, and a head not contained by HEAD fails",
  () => {
    // A non-existent audited head must fail closed (never a silently-empty, vacuously-passing range).
    const bogus = d2eFrozenRange(D2E_BASE, "0".repeat(40));
    if (bogus.anchorsProven || bogus.commits.length !== 0 || bogus.files.length !== 0) return false;
    if (validateD2EAnchors(bogus).length === 0) return false;
    if (validateD2EScope(bogus.files, bogus.anchorsProven).length === 0) return false;
    // A head NOT contained by the current HEAD is a scope violation…
    if (validateD2EAnchors({ baseIsAncestorOfHead: true, headIsAncestorOfCurrent: false }).length === 0) return false;
    // …and the REAL repository genuinely satisfies containment.
    return isAncestor(D2E_HEAD, headSha()) === true;
  });

fnMutation("MUT Z: F12. a non-D2-E implementation subject INSIDE the frozen range is rejected",
  () => validateD2ESubjects(["Phase 5F-D2-E: integrate inbound WhatsApp consent commands", "wip: tweak"]).length > 0
     && validateD2ESubjects(["Phase 5F-D2-F: next phase"]).length > 0
     && validateD2ESubjects(["Merge pull request #4 from quickfurno-maker/phase/x"]).length > 0
     && validateD2ESubjects(["Phase 5F-D2-E: freeze the audited historical range"]).length === 0
     // …and the REAL in-range subjects all pass.
     && validateD2ESubjects(d2eFrozenRange().messages).length === 0);

fnMutation("MUT AA: F6/F13. merge + post-audit commits are EXCLUDED from the frozen range",
  () => {
    const fr = d2eFrozenRange();
    // Every in-range commit is a NON-MERGE implementation commit…
    for (const c of fr.commits) {
      const parents = execFileSync("git", ["rev-list", "--parents", "-n", "1", c], { encoding: "utf8" }).trim().split(/\s+/);
      if (parents.length > 2) return false; // a merge commit slipped into the subject-checked set
    }
    // …and nothing after the audited head is inside it (this freeze commit, a future merge, later phases).
    const post = postAuditCommits();
    if (post.some((c) => fr.commits.includes(c))) return false;
    // If the boundary regressed to base..HEAD, THIS maintenance commit would appear in-range once made.
    return fr.commits.length >= 1 && validateD2ESubjects(fr.messages).length === 0;
  });

// ---- CURRENT-WORKTREE protection: REAL on-disk dirty-file proofs -------------------------------
/** Genuinely edit files on disk, prove they are dirty, run the validation, and ALWAYS restore. */
function withDirtyFiles(files, fn) {
  const originals = new Map();
  try {
    for (const f of files) {
      const p = resolve(f);
      originals.set(p, readFileSync(p, "utf8"));
      writeFileSync(p, `${readFileSync(p, "utf8")}\n// d2e-freeze-dirty-probe\n`);
    }
    const dirty = gitDirty();
    if (!files.every((f) => dirty.includes(f))) return { dirty, proven: false };
    return { dirty, proven: true, result: fn(dirty) };
  } finally {
    for (const [p, original] of originals) writeFileSync(p, original);
  }
}

fnMutation("MUT AB: F14-F15. a REALLY dirty input builder / orchestrator FAILS worktree protection",
  () => {
    const builder = withDirtyFiles([BUILDER_SRC], (d) => validateD2EWorktree(d));
    if (!builder.proven || builder.result.length === 0) return false;
    const orch = withDirtyFiles([ORCH_SRC], (d) => validateD2EWorktree(d));
    if (!orch.proven || orch.result.length === 0) return false;
    const both = withDirtyFiles([BUILDER_SRC, ORCH_SRC], (d) => validateD2EWorktree(d));
    if (!both.proven || both.result.length < 2) return false;
    // …and the files are RESTORED (the worktree is clean of the probe afterwards).
    return validateD2EWorktree(gitDirty()).length === 0;
  });

fnMutation("MUT AC: F16-F19. a REALLY dirty D1-B / webhook / package.json is ALLOWED",
  () => {
    const d1b = withDirtyFiles([D1B_SRC], (d) => validateD2EWorktree(d));
    if (!d1b.proven || d1b.result.length !== 0) return false;                 // F16
    const hook = withDirtyFiles([WEBHOOK_SVC_SRC], (d) => validateD2EWorktree(d));
    if (!hook.proven || hook.result.length !== 0) return false;               // F17
    const both = withDirtyFiles([D1B_SRC, WEBHOOK_SVC_SRC], (d) => validateD2EWorktree(d));
    if (!both.proven || both.result.length !== 0) return false;               // F18
    const pkg = withDirtyFiles(["package.json"], (d) => validateD2EWorktree(d));
    if (!pkg.proven || pkg.result.length !== 0) return false;                 // F19
    return validateD2EWorktree(gitDirty()).length === 0;                      // restored
  });

fnMutation("MUT AD: F20-F21. future-phase files + the maintenance surface are ALLOWED",
  () => {
    // The frozen historical scope is NEVER unioned with the worktree, so a future-phase file can never
    // re-open it; and the maintenance surface (this harness + its doc) is explicitly releasable.
    const future = ["services/futurePhaseService.ts", "scripts/phase5f-d2f-harness.mjs", "docs/QF-Future.md"];
    if (validateD2EWorktree(future).length !== 0) return false;
    if (validateD2EWorktree([HARNESS_SRC, DOC_SRC]).length !== 0) return false;
    // …and a future-phase file is STILL rejected if smuggled INTO the frozen historical delta.
    return future.every((f) => validateD2EScope([...D2E_EXPECTED_FILES, f], true).length > 0);
  });

// ============================================================================
// RUNNER
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-D2-E inbound consent-command integration checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}
async function suiteGoesRed() { for (const c of checks) { try { await c.fn(); } catch { return true; } } return false; }

async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5F-D2-E mutation tests...\n");
  for (const mut of mutationChecks) {
    if (mut.kind === "fn") {
      try {
        const caught = await mut.scenario();
        if (caught) { console.log(`PASS ${mut.name}`); passed++; }
        else { console.log(`FAIL ${mut.name} (guard not load-bearing)`); failed++; }
      } catch (e) { console.log(`FAIL ${mut.name}`); console.error(e); failed++; }
      continue;
    }
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
      catch { violation = true; /* the mutation broke the build/behaviour → it was load-bearing */ }
      if (!violation) violation = await suiteGoesRed();
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
const passed = functional.passed + mutations.passed;
const failed = functional.failed + mutations.failed;
console.log(`\nSummary: ${passed} passed, ${failed} failed (functional: ${functional.passed}/${functional.passed + functional.failed}, mutation: ${mutations.passed}/${mutations.passed + mutations.failed}).`);
process.exit(failed > 0 ? 1 : 0);
