import { execFileSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Phase 8B-1B-B — OUTBOUND PROVIDER-ACCOUNT ATTRIBUTION harness.
 *
 * THE INVARIANT UNDER TEST:
 *
 *     A Meta provider request may occur ONLY AFTER the message has been durably bound to the
 *     exact communication_provider_accounts.id owning the runtime identity used for that request.
 *
 *     UNPROVEN OR UNBOUND PROVIDER ACCOUNT = ZERO PROVIDER CALLS.
 *
 * The decisive evidence is ORDERING, not presence: the Supabase stub records `providerCallCount`
 * AT THE MOMENT the binding UPDATE is observed. A correct implementation binds while the counter
 * is still 0 and calls the provider exactly once afterwards. Moving the send earlier — or dropping
 * a CAS predicate, or treating a zero-row update as success — changes that recorded order and is
 * killed behaviourally, not by a source string.
 *
 * The stub HONOURS the query: `.eq("id")`, `.eq("status","dispatching")` and
 * `.is("provider_account_id", null)` are applied to a seeded row, so a dropped predicate really
 * matches (or fails to match) different rows. There is no live Supabase, no provider network and
 * no credential anywhere in this harness.
 *
 * The mutation runner classifies each mutation killed / survived / infra_fail. An INFRASTRUCTURE
 * failure (missing anchor, compile, import, scenario exception, non-boolean) is NEVER a kill —
 * four self-tests assert exactly that.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const ATTR_SRC = "lib/communication/outboundProviderAccountAttribution.ts";
const COMM_SRC = "services/communicationService.ts";
const RUNTIME_SRC = "services/runtimeCommunicationService.ts";
const TYPES_SRC = "lib/communication/types.ts";
const ENTRY_FILES = [ATTR_SRC, COMM_SRC, RUNTIME_SRC];

// ============================================================================
// QF-MVP-40.1-R2 — CRASH-SAFE MUTATION GUARD
//
// THE RISK THIS CLOSES. `evaluateMutation` rewrites REAL product files and relies
// on a `finally` to put them back. `finally` covers a throw, an assertion failure
// and a TypeScript failure — but NOT a signal. A tool timeout sent SIGTERM during
// a run and left a FORGED OWNERSHIP implementation
// (`resolveOwnership: async () => ({kind:"owned", account:{id:"forged-account"…}})`)
// committed to nothing but sitting in services/runtimeCommunicationService.ts,
// plus `.phase8b1bb-build-main/` and a `.phase8b1bb-mut-N.tsconfig.json`.
// A corrupted product file surviving a test run is far worse than a failed test.
//
// WHY SIGNAL HANDLERS ALONE ARE NOT ENOUGH. This harness spends most of its life
// inside synchronous execFileSync(tsc); Node cannot service a signal while the
// event loop is blocked, and nothing at all runs under SIGKILL. So the originals
// are ALSO written to a sidecar OUTSIDE the repository before any mutation, and
// every run begins by replaying a sidecar left by an interrupted predecessor.
// Recovery therefore does not depend on this process getting to run any code.
//
// Originals are captured as EXACT BYTES (Buffer, never a utf8 round-trip) with
// the file mode, so a restored file is byte- and mode-identical.
// ============================================================================
const RECOVERY_DIR = join(tmpdir(), "qf-phase8b1bb-recovery");
const RECOVERY_MANIFEST = join(RECOVERY_DIR, "manifest.json");
const ARTIFACT_PREFIX = ".phase8b1bb-";

const MUTATION_BACKUPS = new Map();   // absolute path -> { bytes: Buffer, mode: number }
let cleanupDone = false;
/** Reported separately from the test verdict, so recovery never masks a result. */
const recoveryReport = { recoveredFiles: 0, sweptArtifacts: 0, restoreFailures: 0 };

const sidecarNameFor = (abs) => abs.replace(/[^A-Za-z0-9]/g, "_") + ".bak";

function rememberOriginal(absPath) {
  if (MUTATION_BACKUPS.has(absPath)) return;
  const bytes = readFileSync(absPath);
  const mode = statSync(absPath).mode;
  MUTATION_BACKUPS.set(absPath, { bytes, mode });
  try {
    mkdirSync(RECOVERY_DIR, { recursive: true });
    writeFileSync(join(RECOVERY_DIR, sidecarNameFor(absPath)), bytes);
    const manifest = existsSync(RECOVERY_MANIFEST)
      ? JSON.parse(readFileSync(RECOVERY_MANIFEST, "utf8")) : {};
    manifest[absPath] = { sidecar: sidecarNameFor(absPath), mode };
    writeFileSync(RECOVERY_MANIFEST, JSON.stringify(manifest, null, 2));
  } catch (e) {
    // A sidecar we cannot write is a safety regression, not a detail.
    throw new Error(`Cannot write mutation recovery sidecar for ${absPath}: ${e && e.message}`);
  }
}

function restoreOne(absPath) {
  const backup = MUTATION_BACKUPS.get(absPath);
  if (!backup) return;
  try {
    writeFileSync(absPath, backup.bytes);   // exact bytes
    chmodSync(absPath, backup.mode);        // exact mode
  } catch (e) {
    recoveryReport.restoreFailures += 1;
    console.error(`RESTORE FAILED for ${absPath}: ${e && e.message}`);
  }
}

/** Remove only artefacts THIS harness creates; never a broad delete. */
function sweepOwnArtifacts() {
  try {
    for (const f of readdirSync(process.cwd())) {
      if (!f.startsWith(ARTIFACT_PREFIX)) continue;
      try { rmSync(resolve(f), { recursive: true, force: true }); recoveryReport.sweptArtifacts += 1; }
      catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

function clearRecoveryState() {
  try { rmSync(RECOVERY_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
}

/** Idempotent; safe from finally, a signal handler and process exit. */
function restoreAllAndCleanup() {
  if (cleanupDone) return;
  cleanupDone = true;
  for (const p of MUTATION_BACKUPS.keys()) restoreOne(p);
  sweepOwnArtifacts();
  clearRecoveryState();
}

/** Replay a sidecar left by an interrupted predecessor, BEFORE mutating anything. */
function recoverFromPreviousRun() {
  if (!existsSync(RECOVERY_MANIFEST)) return;
  let manifest = {};
  try { manifest = JSON.parse(readFileSync(RECOVERY_MANIFEST, "utf8")); } catch { manifest = {}; }
  for (const [absPath, meta] of Object.entries(manifest)) {
    const sidecar = join(RECOVERY_DIR, meta.sidecar);
    if (!existsSync(sidecar) || !existsSync(absPath)) continue;
    const original = readFileSync(sidecar);
    if (!readFileSync(absPath).equals(original)) {
      writeFileSync(absPath, original);
      if (typeof meta.mode === "number") { try { chmodSync(absPath, meta.mode); } catch { /* best effort */ } }
      recoveryReport.recoveredFiles += 1;
      console.error(`RECOVERED ${absPath} from an interrupted previous run.`);
    }
  }
  // A manifest proves a previous run of THIS harness was interrupted, so its
  // orphaned build/tsconfig artefacts are ours to clear.
  sweepOwnArtifacts();
  clearRecoveryState();
}

process.on("exit", restoreAllAndCleanup);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(sig, () => {
    restoreAllAndCleanup();
    console.error(`\n${sig} received — source files restored and artefacts removed before exit.`);
    process.exit(130);
  });
}
process.on("uncaughtException", (e) => {
  restoreAllAndCleanup();
  console.error("uncaughtException — source files restored.", e);
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  restoreAllAndCleanup();
  console.error("unhandledRejection — source files restored.", e);
  process.exit(1);
});

// Self-heal a killed predecessor, then snapshot every mutable target up front so
// restoration never depends on how far this run got.
recoverFromPreviousRun();
for (const rel of [ATTR_SRC, COMM_SRC, RUNTIME_SRC, TYPES_SRC]) {
  const abs = resolve(rel);
  if (existsSync(abs)) rememberOriginal(abs);
}

const ACCOUNT_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ACCOUNT_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const IDENTITY = Object.freeze({
  providerKey: "meta_whatsapp_cloud",
  channel: "whatsapp",
  phoneNumberReference: "106540352242922",
  expectedWabaId: "102290129340398",
});

function compileTo(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  const tsconfigPath = resolve(`${outDir}.tsconfig.json`);
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: true, jsx: "preserve",
      outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] }, lib: ["ES2021", "DOM"],
    },
    files: ENTRY_FILES,
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  finally { rmSync(tsconfigPath, { force: true }); }
  return outDir;
}

function wireBuild(outDir) {
  const req = createRequire(`${outDir}/`);
  return {
    req,
    Attr: req("./lib/communication/outboundProviderAccountAttribution.js"),
    Comm: req("./services/communicationService.js"),
    Runtime: req("./services/runtimeCommunicationService.js"),
    Supabase: req("./lib/supabase.js"),
    Ownership: req("./services/communicationProviderRuntimeService.js"),
  };
}

// ============================================================================
// REGISTRY + SOURCE HELPERS
// ============================================================================
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const readF = (f) => readFileSync(resolve(f), "utf8");
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
const commCode = () => stripTs(readF(COMM_SRC));
const runtimeCode = () => stripTs(readF(RUNTIME_SRC));

// ============================================================================
// WORLD: recording + predicate-honouring Supabase stub, provider counter, net guard
// ============================================================================
const world = {
  row: null,
  providerCalls: 0,
  bindOrder: [],        // providerCalls sampled at each binding UPDATE
  updates: [],          // every update payload + filters
  ownership: null,
  ownershipInputs: [],
  ownershipThrows: false,
  bindError: false,
  readError: false,
  fetches: 0,
};
function resetWorld(over = {}) {
  world.row = over.row === undefined
    ? { id: "msg-1", status: "dispatching", provider_account_id: null, lane: "business", max_attempts: 5 }
    : over.row;
  world.providerCalls = 0; world.bindOrder = []; world.updates = [];
  world.ownership = over.ownership ?? { kind: "owned", account: { id: ACCOUNT_A } };
  world.ownershipInputs = []; world.ownershipThrows = over.ownershipThrows ?? false;
  world.bindError = over.bindError ?? false; world.readError = over.readError ?? false;
}

function matches(filters) {
  const r = world.row;
  if (!r) return false;
  for (const [op, col, val] of filters) {
    if (op === "eq" && r[col] !== val) return false;
    if (op === "is" && !(r[col] === null || r[col] === undefined) && val === null) return false;
  }
  return true;
}

function installStubs(build) {
  build.Supabase.adminClient = () => ({
    from(table) {
      const st = { table, filters: [], payload: null, action: "select" };
      const qb = {
        update(p) { st.action = "update"; st.payload = p; return qb; },
        select() { return qb; },
        insert() { st.action = "insert"; return qb; },
        eq(c, v) { st.filters.push(["eq", c, v]); return qb; },
        is(c, v) { st.filters.push(["is", c, v]); return qb; },
        limit() { return qb; },
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then(res) { return Promise.resolve(exec()).then(res); },
      };
      function exec() {
        if (st.action === "update" && "provider_account_id" in (st.payload ?? {})) {
          // THE BINDING UPDATE — record the provider-call count AT THIS INSTANT.
          world.bindOrder.push(world.providerCalls);
          world.updates.push({ filters: st.filters, payload: st.payload });
          if (world.bindError) return { data: null, error: { message: "bind boom" } };
          if (!matches(st.filters)) return { data: [], error: null };
          world.row = { ...world.row, ...st.payload };
          return { data: [{ id: world.row.id }], error: null };
        }
        if (st.action === "update") {
          world.updates.push({ filters: st.filters, payload: st.payload });
          if (!matches(st.filters)) return { data: [], error: null };
          world.row = { ...world.row, ...st.payload };
          return { data: [world.row], error: null };
        }
        if (world.readError) return { data: null, error: { message: "read boom" } };
        return { data: world.row ? [{ ...world.row }] : [], error: null };
      }
      return qb;
    },
  });
}

/**
 * The ownership resolver INJECTED through the attribution dependency — exactly as the production
 * factory injects the frozen `resolveOwningProviderAccount`. It records the EXACT identity handed to
 * it (proving the caller passes provider/channel/phone/WABA) and returns the injected outcome. Its
 * own resolution behaviour is 8B-1B-A's harness; here we prove the CALLER's fence.
 */
async function harnessResolver(input) {
  world.ownershipInputs.push(input);
  if (world.ownershipThrows) throw new Error("resolver exploded");
  return world.ownership;
}
const harnessDependency = () => ({ identity: { ...IDENTITY }, resolveOwnership: harnessResolver });

const realFetch = globalThis.fetch;
globalThis.fetch = () => { world.fetches++; return Promise.reject(new Error("network must not be called")); };
function restoreFetch() { globalThis.fetch = realFetch; }

/** An approved_provider_mapping adapter whose send increments the provider counter. */
function metaAdapter() {
  return {
    providerKey: "meta_whatsapp_cloud",
    channel: "whatsapp",
    templateResolutionMode: "approved_provider_mapping",
    async sendResolvedTemplate() {
      world.providerCalls++;
      return { accepted: true, provider: "meta_whatsapp_cloud", providerMessageId: "wamid.X",
        normalizedStatus: "sent", errorCode: null, errorMessage: null, retryable: false,
        outcomeCertainty: "accepted" };
    },
    async sendTemplateMessage() { world.providerCalls++; return { accepted: true, provider: "meta_whatsapp_cloud", providerMessageId: "wamid.X", normalizedStatus: "sent", errorCode: null, errorMessage: null, retryable: false, outcomeCertainty: "accepted" }; },
    async sendAuthenticationMessage() { world.providerCalls++; return { accepted: true, provider: "meta_whatsapp_cloud", providerMessageId: "wamid.X", normalizedStatus: "sent", errorCode: null, errorMessage: null, retryable: false, outcomeCertainty: "accepted" }; },
    async healthCheck() { return { healthy: true }; },
  };
}
const coordinator = { async prepareInitialOutbound() { return { ok: true, resolved: { name: "t", language: "en" }, fingerprint: "f" }; },
  async prepareFinalOutbound() { return { ok: true, resolved: { name: "t", language: "en" }, fingerprint: "f" }; } };
const allowConsent = { async authorize() { return { kind: "allow" }; } };

/** Drive the private pre-network fence exactly as callProvider does. `attribution === undefined`
 *  uses the default injected dependency; pass an explicit value (incl. null) to override it. */
async function runFence(build, opts = {}) {
  const attribution = "attribution" in opts ? opts.attribution : harnessDependency();
  const svc = new build.Comm.CommunicationService(metaAdapter(), undefined, coordinator, allowConsent, attribution);
  const decision = await svc.bindOutboundProviderAccount({ id: "msg-1" });
  if (decision.kind === "proceed") await metaAdapter().sendResolvedTemplate();
  return decision;
}

const MAIN_DIR = resolve(".phase8b1bb-build-main");
compileTo(MAIN_DIR);
const M = wireBuild(MAIN_DIR);
installStubs(M);

// ----------------------------------------------------------------------------
// A. PURE ATTRIBUTION VOCABULARY
// ----------------------------------------------------------------------------
check("A1-12. pure mapping: every ownership outcome maps to a closed decision; query_error is retryable infra and never not_found; ambiguous never owned", () => {
  const A = M.Attr;
  assert(A.decideFromOwnership({ kind: "owned", account: { id: ACCOUNT_A } }).kind === "proceed", "owned → proceed");
  assert(A.decideFromOwnership({ kind: "owned", account: { id: ACCOUNT_A } }).accountId === ACCOUNT_A, "owned carries the exact account id");
  for (const [k, code, retryable] of [
    ["not_found", "PROVIDER_ACCOUNT_NOT_FOUND", false],
    ["ambiguous", "PROVIDER_ACCOUNT_AMBIGUOUS", false],
    ["waba_mismatch", "PROVIDER_ACCOUNT_WABA_MISMATCH", false],
    ["invalid_input", "PROVIDER_ACCOUNT_IDENTITY_INVALID", false],
    ["query_error", "PROVIDER_ACCOUNT_LOOKUP_FAILED", true],
  ]) {
    const d = A.decideFromOwnership({ kind: k, count: 2 });
    assert(d.kind === "blocked" && d.code === code, `${k} → ${code}`);
    assert(d.retryable === retryable, `${k} retryable=${retryable}`);
  }
  assert(A.decideFromOwnership({ kind: "query_error" }).code !== "PROVIDER_ACCOUNT_NOT_FOUND", "query_error is NEVER not_found");
  assert(A.decideFromOwnership({ kind: "ambiguous" }).kind !== "proceed", "ambiguous is NEVER owned");
  assert(A.decideFromBinding({ kind: "bound" }, ACCOUNT_A).kind === "proceed", "bound → proceed");
  assert(A.decideFromBinding({ kind: "same_account" }, ACCOUNT_A).kind === "proceed", "same_account → proceed");
  assert(A.decideFromBinding({ kind: "mismatch" }, ACCOUNT_A).preserveRow === true, "mismatch preserves the row");
  assert(A.decideFromBinding({ kind: "conflict" }, ACCOUNT_A).preserveRow === true, "conflict preserves the row");
  assert(A.decideFromBinding({ kind: "error" }, ACCOUNT_A).retryable === true, "bind error is retryable infra");
  // no secret vocabulary
  const src = readF(ATTR_SRC);
  for (const bad of ["accessToken", "appSecret", "verifyToken", "process.env"]) {
    assert(!src.includes(bad), `the pure module never references ${bad}`);
  }
});

check("A13-20. dependency validation: complete dep usable; missing identity/resolver, blank/non-string identity all fail closed", () => {
  const A = M.Attr;
  const full = { identity: { ...IDENTITY }, resolveOwnership: harnessResolver };
  assert(A.isUsableAttributionDependency(full) === true, "a complete dependency (identity + resolver) is usable");
  assert(A.isUsableAttributionDependency(null) === false, "null fails closed");
  assert(A.isUsableAttributionDependency(undefined) === false, "undefined fails closed");
  assert(A.isUsableAttributionDependency({}) === false, "no identity/resolver fails closed");
  assert(A.isUsableAttributionDependency({ identity: { ...IDENTITY } }) === false, "a MISSING resolveOwnership fails closed");
  assert(A.isUsableAttributionDependency({ identity: { ...IDENTITY }, resolveOwnership: "x" }) === false, "a non-callable resolveOwnership fails closed");
  assert(A.isUsableAttributionDependency({ resolveOwnership: harnessResolver }) === false, "a missing identity fails closed");
  for (const k of ["providerKey", "channel", "phoneNumberReference", "expectedWabaId"]) {
    assert(A.isUsableAttributionDependency({ identity: { ...IDENTITY, [k]: "" }, resolveOwnership: harnessResolver }) === false, `blank ${k} fails closed`);
    assert(A.isUsableAttributionDependency({ identity: { ...IDENTITY, [k]: "   " }, resolveOwnership: harnessResolver }) === false, `whitespace ${k} fails closed`);
    assert(A.isUsableAttributionDependency({ identity: { ...IDENTITY, [k]: 7 }, resolveOwnership: harnessResolver }) === false, `non-string ${k} fails closed`);
  }
  assert(A.attributionUnavailable().code === "PROVIDER_ACCOUNT_ATTRIBUTION_UNAVAILABLE", "unavailable code");
  assert(A.attributionUnavailable().retryable === false, "unavailable is definitive");
});

// ----------------------------------------------------------------------------
// B. THE PRE-NETWORK FENCE (behavioural)
// ----------------------------------------------------------------------------
check("B1-4. owned + NULL row: the exact account is CAS-bound, binding is observed while providerCalls===0, then exactly one provider call", async () => {
  resetWorld();
  const d = await runFence(M);
  assert(d.kind === "proceed" && d.accountId === ACCOUNT_A, "owned proceeds with the exact account id");
  assert(world.row.provider_account_id === ACCOUNT_A, "the exact account id is persisted");
  assert(world.bindOrder.length === 1 && world.bindOrder[0] === 0, `binding observed while providerCalls===0 (got ${JSON.stringify(world.bindOrder)})`);
  assert(world.providerCalls === 1, "exactly one provider call, AFTER binding");
});

check("B5-9. the binding CAS is constrained by id + status=dispatching + provider_account_id IS NULL, and sets only the resolved id", async () => {
  resetWorld();
  await runFence(M);
  const u = world.updates.find((x) => "provider_account_id" in x.payload);
  assert(u, "a binding update occurred");
  const f = JSON.stringify(u.filters);
  assert(f.includes('["eq","id","msg-1"]'), `CAS constrains id (got ${f})`);
  assert(f.includes('["eq","status","dispatching"]'), `CAS constrains status=dispatching (got ${f})`);
  assert(f.includes('["is","provider_account_id",null]'), `CAS constrains provider_account_id IS NULL (got ${f})`);
  assert(u.payload.provider_account_id === ACCOUNT_A, "sets the resolved account id");
});

check("B10-13. exact identity reaches the FROZEN resolver: provider key, channel, phone reference and expected WABA", async () => {
  resetWorld();
  await runFence(M);
  assert(world.ownershipInputs.length === 1, "the resolver is called exactly once");
  const i = world.ownershipInputs[0];
  assert(i.providerKey === IDENTITY.providerKey, "exact provider key");
  assert(i.channel === IDENTITY.channel, "exact channel");
  assert(i.phoneNumberReference === IDENTITY.phoneNumberReference, "exact phone-number reference");
  assert(i.expectedWabaId === IDENTITY.expectedWabaId, "exact expected WABA");
});

check("B14-20. every non-owned ownership outcome ⇒ ZERO provider calls and no binding write", async () => {
  for (const [k, code] of [
    ["not_found", "PROVIDER_ACCOUNT_NOT_FOUND"],
    ["ambiguous", "PROVIDER_ACCOUNT_AMBIGUOUS"],
    ["waba_mismatch", "PROVIDER_ACCOUNT_WABA_MISMATCH"],
    ["invalid_input", "PROVIDER_ACCOUNT_IDENTITY_INVALID"],
    ["query_error", "PROVIDER_ACCOUNT_LOOKUP_FAILED"],
  ]) {
    resetWorld({ ownership: { kind: k, count: 2 } });
    const d = await runFence(M);
    assert(d.kind === "blocked" && d.code === code, `${k} → ${code}`);
    assert(world.providerCalls === 0, `${k}: ZERO provider calls`);
    assert(world.bindOrder.length === 0, `${k}: no binding write`);
    assert(world.row.provider_account_id === null, `${k}: row stays unbound`);
  }
  // query_error is INFRASTRUCTURE (retryable), the definitive ones are not
  resetWorld({ ownership: { kind: "query_error" } });
  assert((await runFence(M)).retryable === true, "query_error is retryable infrastructure");
  resetWorld({ ownership: { kind: "not_found" } });
  assert((await runFence(M)).retryable === false, "not_found is definitive");
});

check("B21-24. same-account idempotent retry proceeds without rewrite; cross-account retry fails closed with zero provider calls and no reassignment", async () => {
  // same account already bound → CAS matches zero rows → re-read classifies same_account
  resetWorld({ row: { id: "msg-1", status: "dispatching", provider_account_id: ACCOUNT_A, lane: "business", max_attempts: 5 } });
  const same = await runFence(M);
  assert(same.kind === "proceed", "same-account retry proceeds");
  assert(world.row.provider_account_id === ACCOUNT_A, "same-account binding is not rewritten");
  assert(world.providerCalls === 1, "same-account retry sends exactly once");
  // different account → mismatch, never reassign
  resetWorld({ row: { id: "msg-1", status: "dispatching", provider_account_id: ACCOUNT_B, lane: "business", max_attempts: 5 } });
  const diff = await runFence(M);
  assert(diff.kind === "blocked" && diff.code === "PROVIDER_ACCOUNT_MISMATCH", "cross-account → PROVIDER_ACCOUNT_MISMATCH");
  assert(world.row.provider_account_id === ACCOUNT_B, "the existing account is NEVER reassigned");
  assert(world.providerCalls === 0, "cross-account retry: ZERO provider calls");
  assert(diff.preserveRow === true, "mismatch preserves the row");
});

check("B25-28. CAS zero rows (status moved) ⇒ conflict, zero provider calls, no fallback mutation, row preserved", async () => {
  resetWorld({ row: { id: "msg-1", status: "failed", provider_account_id: null, lane: "business", max_attempts: 5 } });
  const d = await runFence(M);
  assert(d.kind === "blocked" && d.code === "PROVIDER_ACCOUNT_BIND_CONFLICT", "status moved → BIND_CONFLICT");
  assert(world.providerCalls === 0, "conflict: ZERO provider calls");
  assert(world.row.status === "failed" && world.row.provider_account_id === null, "the conflicting row is preserved untouched");
  assert(d.preserveRow === true, "conflict preserves the row");
  const wrote = world.updates.filter((u) => u.payload && "provider_account_id" in u.payload && u.payload.provider_account_id !== null);
  assert(wrote.length === 1, "only the guarded CAS attempt was issued — no unconstrained fallback update");
});

check("B29-31. binding database error / resolver throw ⇒ infrastructure failure, zero provider calls", async () => {
  resetWorld({ bindError: true });
  const b = await runFence(M);
  assert(b.kind === "blocked" && b.code === "PROVIDER_ACCOUNT_BIND_FAILED", "bind DB error → BIND_FAILED");
  assert(b.retryable === true, "bind error is retryable infrastructure");
  assert(world.providerCalls === 0, "bind error: ZERO provider calls");
  resetWorld({ ownershipThrows: true });
  const t = await runFence(M);
  assert(t.kind === "blocked", "a thrown resolver fails closed");
  assert(world.providerCalls === 0, "resolver throw: ZERO provider calls");
});

check("B32-36. missing dependency / missing resolver / malformed identity ⇒ ZERO provider calls and no ownership query", async () => {
  for (const [label, dep] of [
    ["missing dependency", null],
    ["missing resolveOwnership", { identity: { ...IDENTITY } }],
    ["empty identity", { identity: {}, resolveOwnership: harnessResolver }],
    ["blank phone", { identity: { ...IDENTITY, phoneNumberReference: "" }, resolveOwnership: harnessResolver }],
    ["non-string WABA", { identity: { ...IDENTITY, expectedWabaId: 7 }, resolveOwnership: harnessResolver }],
  ]) {
    resetWorld();
    const d = await runFence(M, { attribution: dep });
    assert(d.kind === "blocked" && d.code === "PROVIDER_ACCOUNT_ATTRIBUTION_UNAVAILABLE", `${label} → UNAVAILABLE`);
    assert(world.providerCalls === 0, `${label}: ZERO provider calls`);
    assert(world.ownershipInputs.length === 0, `${label}: malformed input NEVER produces an ownership query`);
    assert(world.bindOrder.length === 0, `${label}: no binding write`);
  }
});

check("B36-38. ownership is readiness-AGNOSTIC: a disabled/unhealthy/historical account still binds and sends", async () => {
  resetWorld({ ownership: { kind: "owned", account: { id: ACCOUNT_A, readiness_status: "disabled", health_status: "unhealthy" } } });
  const d = await runFence(M);
  assert(d.kind === "proceed", "a disabled/unhealthy owner still binds");
  assert(world.row.provider_account_id === ACCOUNT_A, "the disabled owner's exact id is bound");
  assert(world.providerCalls === 1, "readiness is not the ownership classifier");
});

check("B39-41. zero network; the binding re-read proves exactly one row BEFORE indexing (never a positional pick among many)", async () => {
  assert(world.fetches === 0, "the fence made ZERO network calls");
  const code = commCode();
  const bind = code.slice(code.indexOf("private async applyProviderAccountBinding"));
  // A single-row read may legitimately index [0] — but ONLY after proving there is exactly one row.
  const guard = bind.indexOf("rows.length !== 1");
  const index = bind.indexOf("rows[0]");
  assert(guard > 0 && index > 0 && guard < index, "the exactly-one-row guard precedes the row read (no first-row pick)");
  assert(/\.limit\(2\)/.test(bind), "the re-read is bounded so a second row is detectable rather than silently ignored");
});

// ----------------------------------------------------------------------------
// C. RUNTIME IDENTITY COHERENCE
// ----------------------------------------------------------------------------
check("C1-10. the runtime factory snapshots env once, projects a NON-SECRET identity + injects the FROZEN resolver from the SAME selection; mock/override carry none; CommunicationService never imports the runtime service", () => {
  const code = runtimeCode();
  assert(/Object\.freeze\(\{ \.\.\.env \}\)/.test(code), "the environment is snapshotted exactly once");
  assert(/resolveRuntimeWhatsAppContext\(envSnapshot\)/.test(code), "selection uses the snapshot");
  assert(/getMetaOutboundCoordinator\(envSnapshot\)/.test(code), "the coordinator uses the SAME snapshot");
  assert(/phoneNumberReference: selection\.config\.phoneNumberId/.test(code), "the identity comes from the SAME selection that built the provider");
  assert(/expectedWabaId: selection\.config\.wabaId/.test(code), "the expected WABA comes from the same selection");
  // the EXACT frozen resolver is injected — the only ownership authority production ever wires
  assert(/import \{ resolveOwningProviderAccount \} from "\.\/communicationProviderRuntimeService"/.test(code), "the factory imports the frozen resolveOwningProviderAccount");
  assert(/resolveOwnership: resolveOwningProviderAccount/.test(code), "the factory injects resolveOwnership: resolveOwningProviderAccount into the dependency");
  for (const bad of ["accessToken", "appSecret", "verifyToken"]) {
    assert(!new RegExp(`attribution[\\s\\S]{0,400}${bad}`).test(code), `the attribution identity never carries ${bad}`);
  }
  const ctx = M.Runtime.resolveRuntimeWhatsAppContext({ WHATSAPP_PROVIDER_MODE: "mock" });
  assert(ctx.ok && ctx.data.attribution === null, "a mock adapter needs no attribution dependency");
  // OVERRIDE (test injection): the provider wins, but an approved_provider_mapping override projects
  // attribution ONLY from a coherent Meta env; a mock override / an identity-less override carries none.
  assert(/if \(override\) return ok\(\{ provider: override, attribution: overrideAttribution\(override, env\) \}\)/.test(code), "an override delegates attribution to overrideAttribution(override, env)");
  const metaEnv = { WHATSAPP_PROVIDER_MODE: "meta_cloud", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "111222333", WHATSAPP_WABA_ID: "444555666", WHATSAPP_APP_SECRET: "s", WHATSAPP_WEBHOOK_VERIFY_TOKEN: "v", WHATSAPP_GRAPH_API_VERSION: "v19.0", WHATSAPP_HTTP_TIMEOUT_MS: "5000", WHATSAPP_AUTH_HTTP_TIMEOUT_MS: "3000" };
  try {
    M.Comm.setActiveWhatsAppProvider({ providerKey: "mock", channel: "whatsapp", templateResolutionMode: "internal_template" });
    assert(M.Runtime.resolveRuntimeWhatsAppContext(metaEnv).data.attribution === null, "a mock override needs no attribution");
    M.Comm.setActiveWhatsAppProvider({ providerKey: "meta_whatsapp_cloud", channel: "whatsapp", templateResolutionMode: "approved_provider_mapping" });
    const bound = M.Runtime.resolveRuntimeWhatsAppContext(metaEnv).data.attribution;
    assert(bound && bound.identity.phoneNumberReference === "111222333" && bound.identity.expectedWabaId === "444555666" && typeof bound.resolveOwnership === "function", "an approved_provider_mapping override binds attribution from a coherent Meta env");
    assert(!("accessToken" in bound.identity), "the override attribution identity carries no access token");
    assert(M.Runtime.resolveRuntimeWhatsAppContext({}).data.attribution === null, "an approved_provider_mapping override with NO Meta env fails closed (null attribution)");
  } finally { M.Comm.clearWhatsAppProviderOverride(); }
  // CommunicationService MUST NOT import the runtime service — the resolver arrives only via injection
  assert(!/communicationProviderRuntimeService/.test(commCode()), "CommunicationService never imports the runtime service");
  assert(/dep\.resolveOwnership\(/.test(commCode()), "the fence calls the INJECTED resolver, not a direct import");
});

check("C9-10. CommunicationService normalizes a malformed dependency to null and never exposes a mutable global setter", () => {
  const code = commCode();
  assert(/isUsableAttributionDependency\(accountAttribution\) \? accountAttribution : null/.test(code), "a malformed dependency is normalized to null, never trusted");
  assert(!/setAccountAttribution|setOutboundAttribution/.test(code), "no mutable global attribution setter exists");
});

// ----------------------------------------------------------------------------
// D. ORDERING / STRUCTURE / SCOPE
// ----------------------------------------------------------------------------
check("D1-6. the fence sits AFTER final preparation and BEFORE sendResolvedTemplate; conflicts bypass the id-only failure update; idempotency untouched", () => {
  const code = commCode();
  const prep = code.indexOf("prepareFinalOutbound");
  const fence = code.indexOf("bindOutboundProviderAccount(message)");
  const send = code.indexOf("this.provider.sendResolvedTemplate(");
  assert(prep > 0 && fence > prep, "attribution runs AFTER final preparation");
  assert(send > fence, "attribution runs BEFORE sendResolvedTemplate");
  assert(/ATTRIBUTION_FAILURE\.BIND_CONFLICT[\s\S]{0,200}return fail\(commError\(result\.errorCode\)\)/.test(code), "a bind conflict returns a safe closed error WITHOUT an id-only mutation");
  assert(!/onConflict|\.upsert\(/.test(code), "no upsert / conflict target is introduced");
  assert(/isUniqueViolationOn\(insertError, "idempotency_key"\)/.test(code), "global idempotency_key behaviour is unchanged");
  assert(/readonly provider_account_id\?: string \| null;/.test(readF(TYPES_SRC)), "CommunicationMessage carries the optional provider_account_id");
});

// SUPERSEDED BY C8B-1B-C. This check previously asserted that delivery events / receipts carried NO
// account binding — a forward BOUNDARY statement describing where Phase 8B-1B-B deliberately stopped.
// C8B-1B-C is the phase that binds those surfaces, so that claim has reached its expiry and is retired.
// What 8B-1B-B still owns — and what is asserted here — is that the OUTBOUND attribution layer neither
// performs nor depends on inbound/delivery ownership resolution.
check("D7-9. the OUTBOUND attribution layer neither resolves nor infers inbound/delivery ownership", () => {
  const code = commCode();

  // 1. Outbound attribution is unchanged: the pre-network bind still runs between preparation and send.
  assert(/bindOutboundProviderAccount\(message\)/.test(code), "the outbound pre-network bind is intact");

  // 2-4. CommunicationService NEVER resolves provider ownership. Inbound/delivery binding is only ever the
  //      account its CALLER already proved and supplied — the service cannot invent or look one up.
  assert(!/resolveOwningProviderAccount/.test(code), "CommunicationService never resolves provider ownership");
  assert(!/communication_provider_accounts/.test(code), "CommunicationService never queries the provider-accounts table");
  assert(!/process\.env\.WHATSAPP/.test(code), "CommunicationService never infers an account from the environment");
  assert(/processWebhook\([\s\S]{0,400}providerAccountId/.test(code), "delivery binding comes from an EXPLICITLY SUPPLIED providerAccountId");

  // 5. An invalid-signature receipt is recorded WITHOUT an account and never requires one.
  const receiptIdx = code.indexOf("recordReceipt");
  const receiptBlock = code.slice(receiptIdx, receiptIdx + 1400);
  assert(/signature_valid/.test(receiptBlock), "the receipt writer still distinguishes signature validity");
  assert(/provider_account_id: (boundAccount|row\.provider_account_id)/.test(receiptBlock) || /provider_account_id/.test(receiptBlock),
    "the receipt writer carries the account explicitly rather than deriving one");

  // 6. NO backfill and NO reassignment: the only provider_account_id UPDATE in the file remains the
  //    8B-1B-B outbound compare-and-set, guarded by `is("provider_account_id", null)` — unbound→bound only.
  const updates = code.match(/\.update\(\s*\{[^}]*provider_account_id[^}]*\}/g) || [];
  assert(updates.length === 1, `exactly ONE provider_account_id UPDATE (the outbound CAS) may exist, found ${updates.length}`);
  assert(/is\("provider_account_id", null\)/.test(code), "that CAS is still guarded to an unbound row — never a reassignment or backfill");
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutations = [];
function mutate(name, edits, scenario) { mutations.push({ name, edits, scenario }); }
let seq = 0;
async function suiteGoesRed() { for (const c of checks) { try { await c.fn(); } catch { return true; } } return false; }

async function evaluateMutation(mut) {
  const tsTouched = mut.edits.some((e) => e[0].endsWith(".ts"));
  const dir = resolve(`.phase8b1bb-mut-${seq++}`);
  const originals = new Map();
  for (const e of mut.edits) {
    const p = resolve(e[0]);
    if (!originals.has(p)) originals.set(p, readFileSync(p, "utf8"));
    // Byte-exact + sidecar backup, so a signal between here and the finally
    // still leaves a recoverable original on disk.
    rememberOriginal(p);
  }
  try {
    for (const e of mut.edits) {
      const p = resolve(e[0]);
      const cur = readFileSync(p, "utf8");
      if (!cur.includes(e[1])) return "infra_fail:anchor";
      writeFileSync(p, cur.replace(e[1], e[2]));
    }
    let mm = M;
    if (tsTouched) {
      let out;
      try { out = compileTo(dir); } catch { return "infra_fail:compile"; }
      try { mm = wireBuild(out); installStubs(mm); } catch { return "infra_fail:import"; }
    }
    let detected;
    try { detected = await mut.scenario(mm); } catch { return "infra_fail:scenario_threw"; }
    if (typeof detected !== "boolean") return "infra_fail:non_boolean";
    if (detected) return "killed";
    return (await suiteGoesRed()) ? "killed" : "survived";
  } finally {
    // Fast path: restore from the byte-exact backup, not the utf8 string, so mode
    // and bytes are preserved. restoreAllAndCleanup() remains the backstop for
    // signal / uncaughtException exits, and the next run's sidecar replay is the
    // backstop for SIGKILL.
    for (const p of originals.keys()) restoreOne(p);
    rmSync(dir, { recursive: true, force: true });
    installStubs(M);
  }
}

// --- ORDER: the provider must never precede the binding ---------------------
mutate("ORD-1. the provider is called BEFORE the binding fence (send-then-attribute)",
  [[COMM_SRC, "      const attribution = await this.bindOutboundProviderAccount(message);", "      const _early = await this.provider.sendResolvedTemplate(destination, prepared.resolved, sourceVariables, { lane });\n      const attribution = await this.bindOutboundProviderAccount(message);"]],
  () => { const c = commCode(); return c.indexOf("this.provider.sendResolvedTemplate(") < c.indexOf("bindOutboundProviderAccount(message)"); });

mutate("ORD-2. the pre-network fence is removed entirely",
  [[COMM_SRC, "      const attribution = await this.bindOutboundProviderAccount(message);\n      if (attribution.kind === \"blocked\") {\n        return this.attributionFailure(attribution);\n      }", ""]],
  async () => { const c = commCode(); return !/bindOutboundProviderAccount\(message\)/.test(c); });

mutate("ORD-3. the fence result is discarded, so a BLOCKED outcome no longer stops the dispatch",
  [[COMM_SRC, "      const attribution = await this.bindOutboundProviderAccount(message);", "      await this.bindOutboundProviderAccount(message);\n      const attribution = ((): OutboundAttributionDecision => ({ kind: \"proceed\", accountId: \"skipped\" }))();"]],
  () => !/const attribution = await this\.bindOutboundProviderAccount\(message\);/.test(commCode()));

// --- ACCOUNT VALUE ---------------------------------------------------------
mutate("VAL-1. the resolved account id is replaced with a constant",
  [[COMM_SRC, "    const outcome = await this.applyProviderAccountBinding(message.id, decided.accountId);", "    const outcome = await this.applyProviderAccountBinding(message.id, \"00000000-0000-4000-8000-000000000000\");"]],
  async (mm) => { resetWorld(); await runFence(mm); return world.row.provider_account_id !== ACCOUNT_A; });

mutate("VAL-2. the binding persists a different account id than the resolver returned",
  [[COMM_SRC, "        .update({ provider_account_id: accountId, updated_at: new Date().toISOString() })", "        .update({ provider_account_id: accountId + \"-x\", updated_at: new Date().toISOString() })"]],
  async (mm) => { resetWorld(); await runFence(mm); return world.row.provider_account_id !== ACCOUNT_A; });

mutate("VAL-3. provider_account_id is omitted from the update payload",
  [[COMM_SRC, "        .update({ provider_account_id: accountId, updated_at: new Date().toISOString() })", "        .update({ updated_at: new Date().toISOString() })"]],
  async (mm) => { resetWorld(); await runFence(mm); return world.row.provider_account_id !== ACCOUNT_A; });

// --- CAS PREDICATES --------------------------------------------------------
mutate("CAS-1. the id predicate is dropped",
  [[COMM_SRC, "        .eq(\"id\", messageId)\n        .eq(\"status\", \"dispatching\")\n        .is(\"provider_account_id\", null)", "        .eq(\"status\", \"dispatching\")\n        .is(\"provider_account_id\", null)"]],
  async (mm) => { resetWorld(); await runFence(mm); const u = world.updates.find((x) => "provider_account_id" in x.payload); return !JSON.stringify(u.filters).includes('["eq","id"'); });

mutate("CAS-2. the status=dispatching predicate is dropped",
  [[COMM_SRC, "        .eq(\"status\", \"dispatching\")\n        .is(\"provider_account_id\", null)", "        .is(\"provider_account_id\", null)"]],
  async (mm) => { resetWorld({ row: { id: "msg-1", status: "failed", provider_account_id: null, lane: "business", max_attempts: 5 } }); const d = await runFence(mm); return d.kind === "proceed" || world.providerCalls > 0; });

mutate("CAS-3. the provider_account_id IS NULL guard is dropped (permits reassignment)",
  [[COMM_SRC, "        .is(\"provider_account_id\", null)\n        .select(\"id\")", "        .select(\"id\")"]],
  async (mm) => { resetWorld({ row: { id: "msg-1", status: "dispatching", provider_account_id: ACCOUNT_B, lane: "business", max_attempts: 5 } }); await runFence(mm); return world.row.provider_account_id !== ACCOUNT_B; });

mutate("CAS-4. a zero-row CAS is treated as success",
  [[COMM_SRC, "      if ((data ?? []).length === 1) return { kind: \"bound\" };", "      if ((data ?? []).length !== 99) return { kind: \"bound\" };"]],
  async (mm) => { resetWorld({ row: { id: "msg-1", status: "failed", provider_account_id: null, lane: "business", max_attempts: 5 } }); const d = await runFence(mm); return d.kind === "proceed" || world.providerCalls > 0; });

mutate("CAS-5. a cross-account row is no longer identified as a MISMATCH",
  [[COMM_SRC, "      if (row.provider_account_id != null && row.provider_account_id !== accountId) return { kind: \"mismatch\" };", "      if (false) return { kind: \"mismatch\" };"]],
  async (mm) => { resetWorld({ row: { id: "msg-1", status: "dispatching", provider_account_id: ACCOUNT_B, lane: "business", max_attempts: 5 } }); const d = await runFence(mm); return d.kind !== "blocked" || d.code !== "PROVIDER_ACCOUNT_MISMATCH" || world.providerCalls > 0; });

// --- OUTCOME MAPPING -------------------------------------------------------
mutate("MAP-1. query_error is collapsed into not_found",
  [[ATTR_SRC, "    case \"query_error\":\n      return blocked(ATTRIBUTION_FAILURE.LOOKUP_FAILED, true);", "    case \"query_error\":\n      return blocked(ATTRIBUTION_FAILURE.NOT_FOUND, false);"]],
  (mm) => mm.Attr.decideFromOwnership({ kind: "query_error" }).code === "PROVIDER_ACCOUNT_NOT_FOUND");

mutate("MAP-2. ambiguous is promoted to owned (first row)",
  [[ATTR_SRC, "    case \"ambiguous\":\n      return blocked(ATTRIBUTION_FAILURE.AMBIGUOUS, false);", "    case \"ambiguous\":\n      return { kind: \"proceed\", accountId: \"first-row\" };"]],
  (mm) => mm.Attr.decideFromOwnership({ kind: "ambiguous" }).kind === "proceed");

mutate("MAP-3. query_error retry classification is flipped to definitive",
  [[ATTR_SRC, "      return blocked(ATTRIBUTION_FAILURE.LOOKUP_FAILED, true);", "      return blocked(ATTRIBUTION_FAILURE.LOOKUP_FAILED, false);"]],
  (mm) => mm.Attr.decideFromOwnership({ kind: "query_error" }).retryable === false);

mutate("MAP-4. a bind error is downgraded to definitive (loses safe retry)",
  [[ATTR_SRC, "    case \"error\":\n      return blocked(ATTRIBUTION_FAILURE.BIND_FAILED, true);", "    case \"error\":\n      return blocked(ATTRIBUTION_FAILURE.BIND_FAILED, false);"]],
  (mm) => mm.Attr.decideFromBinding({ kind: "error" }, ACCOUNT_A).retryable === false);

mutate("MAP-5. a conflict no longer preserves the row",
  [[ATTR_SRC, "      return blocked(ATTRIBUTION_FAILURE.BIND_CONFLICT, false, true);", "      return blocked(ATTRIBUTION_FAILURE.BIND_CONFLICT, false, false);"]],
  (mm) => mm.Attr.decideFromBinding({ kind: "conflict" }, ACCOUNT_A).preserveRow === false);

// --- DEPENDENCY / IDENTITY -------------------------------------------------
// BOTH identity-validation layers are load-bearing together: the constructor normalizes a malformed
// dependency to null AND the fence re-validates. Weakening either alone is caught by the other, so a
// meaningful mutation must remove both — proving the pair, not a single redundant check.
mutate("DEP-1. BOTH identity-validation layers are weakened to a null check (a malformed identity reaches the resolver)",
  [[COMM_SRC, "    if (!isUsableAttributionDependency(dep)) return attributionUnavailable();", "    if (!dep) return attributionUnavailable();"],
   [COMM_SRC, "    this.accountAttribution = isUsableAttributionDependency(accountAttribution) ? accountAttribution : null;", "    this.accountAttribution = accountAttribution;"]],
  async (mm) => { resetWorld(); const d = await runFence(mm, { attribution: { identity: { ...IDENTITY, phoneNumberReference: "" }, resolveOwnership: harnessResolver } }); return world.ownershipInputs.length > 0 || d.kind === "proceed"; });

mutate("DEP-4. the dependency validator stops requiring a callable resolveOwnership",
  [[ATTR_SRC, '  if (typeof dep.resolveOwnership !== "function") return false;\n', ""]],
  (mm) => mm.Attr.isUsableAttributionDependency({ identity: { ...IDENTITY } }) === true);

mutate("DEP-2. a malformed dependency is trusted instead of normalized",
  [[COMM_SRC, "    this.accountAttribution = isUsableAttributionDependency(accountAttribution) ? accountAttribution : null;", "    this.accountAttribution = accountAttribution;"]],
  async (mm) => { resetWorld(); const d = await runFence(mm, { attribution: { identity: { ...IDENTITY, phoneNumberReference: "" } } }); return world.ownershipInputs.length > 0 || d.kind === "proceed"; });

mutate("DEP-3. the identity is re-read from process.env instead of the injected snapshot",
  [[COMM_SRC, "        providerKey: dep.identity.providerKey,", "        providerKey: process.env.WHATSAPP_PROVIDER_KEY ?? dep.identity.providerKey,"]],
  () => { const c = commCode(); return /process\.env/.test(c.slice(c.indexOf("private async bindOutboundProviderAccount"), c.indexOf("private async applyProviderAccountBinding"))); });

// --- IDENTITY FILTERS ------------------------------------------------------
for (const [n, field, anchor] of [
  ["FIL-1", "provider key", "      providerKey: dep.identity.providerKey,"],
  ["FIL-2", "channel", "      channel: dep.identity.channel,"],
  ["FIL-3", "phone-number reference", "      phoneNumberReference: dep.identity.phoneNumberReference,"],
  ["FIL-4", "expected WABA", "      expectedWabaId: dep.identity.expectedWabaId,"],
]) {
  mutate(`${n}. the exact ${field} is weakened to a constant`,
    [[COMM_SRC, anchor, anchor.replace(/dep\.identity\.\w+/, '"weakened"')]],
    async (mm) => { resetWorld(); await runFence(mm); const i = world.ownershipInputs[0] ?? {}; return Object.values(i).includes("weakened"); });
}

// --- RUNTIME COHERENCE -----------------------------------------------------
mutate("RUN-1. the factory stops injecting the attribution identity",
  [[RUNTIME_SRC, "      consentEnforcer,\n      context.data.attribution\n    )", "      consentEnforcer\n    )"]],
  () => !/context\.data\.attribution/.test(runtimeCode()));

mutate("RUN-2. the identity is taken from a FRESH env read instead of the selection snapshot",
  [[RUNTIME_SRC, "        phoneNumberReference: selection.config.phoneNumberId,", "        phoneNumberReference: process.env.WHATSAPP_PHONE_NUMBER_ID ?? selection.config.phoneNumberId,"]],
  () => /process\.env\.WHATSAPP_PHONE_NUMBER_ID/.test(runtimeCode()));

mutate("RUN-3. the env snapshot is dropped (provider and identity may diverge)",
  [[RUNTIME_SRC, "  const envSnapshot = Object.freeze({ ...env });", "  const envSnapshot = env;"]],
  () => !/Object\.freeze\(\{ \.\.\.env \}\)/.test(runtimeCode()));

mutate("RUN-4. a secret is leaked into the attribution identity",
  [[RUNTIME_SRC, "        expectedWabaId: selection.config.wabaId,", "        expectedWabaId: selection.config.wabaId,\n        accessToken: selection.config.accessToken,"]],
  () => /attribution[\s\S]{0,400}accessToken/.test(runtimeCode()));

const FORGED_RESOLVER = "resolveOwnership: async () => ({ kind: \"owned\" as const, account: { id: \"forged-account\", provider_key: \"x\", channel: \"whatsapp\", business_account_reference: null, phone_number_reference: null } }),";
const countFrozenResolver = () => (runtimeCode().match(/resolveOwnership: resolveOwningProviderAccount,/g) || []).length;
// BOTH injection sites (the selection path AND the override path) must wire the frozen resolver — there
// are exactly two. Replacing EITHER with an always-owned fake drops the count and is killed.
mutate("RUN-5. the SELECTION-path factory injects an ALWAYS-OWNED fake resolver instead of the frozen authority",
  [[RUNTIME_SRC, "      resolveOwnership: resolveOwningProviderAccount,", "      " + FORGED_RESOLVER]],
  () => countFrozenResolver() !== 2);

mutate("RUN-6. the OVERRIDE-path factory injects an ALWAYS-OWNED fake resolver instead of the frozen authority",
  [[RUNTIME_SRC, "    resolveOwnership: resolveOwningProviderAccount,\n  };", "    " + FORGED_RESOLVER + "\n  };"]],
  () => countFrozenResolver() !== 2);

// --- CONFLICT ROUTING ------------------------------------------------------
mutate("RTE-1. a bind conflict is routed through the id-only recordDispatchFailure",
  [[COMM_SRC, "          return fail(commError(result.errorCode));", "          return await this.recordDispatchFailure(claimed, currentAttempt, result);"]],
  () => !/ATTRIBUTION_FAILURE\.BIND_CONFLICT[\s\S]{0,200}return fail\(commError\(result\.errorCode\)\)/.test(commCode()));

// ============================================================================
// EXECUTE
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 8B-1B-B outbound provider-account attribution checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}
async function runInfraSelfTests() {
  let passed = 0, failed = 0;
  console.log("\nRunning mutation-runner infrastructure self-tests...\n");
  const cases = [
    ["INFRA-A missing anchor → infra_fail:anchor", { edits: [[ATTR_SRC, "ANCHOR_DOES_NOT_EXIST_9f2", "x"]], scenario: () => true }, "infra_fail:anchor"],
    ["INFRA-B compile failure → infra_fail:compile", { edits: [[ATTR_SRC, "export function decideFromOwnership(", "export function decideFromOwnership(((("]], scenario: () => true }, "infra_fail:compile"],
    ["INFRA-C import/load failure → infra_fail:import", { edits: [[ATTR_SRC, "const NON_EMPTY = /\\S/;", "const _boom: string = (() => { throw new Error(\"synthetic load failure\"); })();\nconst NON_EMPTY = /\\S/;"]], scenario: () => true }, "infra_fail:import"],
    ["INFRA-D scenario exception → infra_fail:scenario_threw", { edits: [[ATTR_SRC, "const NON_EMPTY = /\\S/;", "const NON_EMPTY = /\\S/; /* probe */"]], scenario: () => { throw new Error("unrelated"); } }, "infra_fail:scenario_threw"],
  ];
  for (const [name, mut, expected] of cases) {
    let status;
    try { status = await evaluateMutation(mut); } catch (e) { status = `threw:${e.message}`; }
    const ok = status === expected;
    console.log(`${ok ? "PASS" : "FAIL"} ${name} (got ${status})`);
    ok ? passed++ : failed++;
  }
  return { passed, failed };
}
async function runMutations() {
  let killed = 0, survived = 0, infra = 0;
  console.log("\nRunning Phase 8B-1B-B guard mutations...\n");
  for (const mut of mutations) {
    const s = await evaluateMutation(mut);
    if (s === "killed") { console.log(`KILLED   ${mut.name}`); killed++; }
    else if (s === "survived") { console.log(`SURVIVED ${mut.name}`); survived++; }
    else { console.log(`INFRA    ${mut.name} (${s})`); infra++; }
  }
  return { killed, survived, infra };
}

const functional = await runFunctional();
const infraSelf = await runInfraSelfTests();
const mutants = await runMutations();
rmSync(MAIN_DIR, { recursive: true, force: true });
restoreFetch();

const fPass = functional.passed + infraSelf.passed;
const fFail = functional.failed + infraSelf.failed;
const mFail = mutants.survived + mutants.infra;
const passed = fPass + mutants.killed;
const failed = fFail + mFail;
// Recovery is reported SEPARATELY from the verdict: a clean recovery must never
// look like a passing test, and a restore failure must never be hidden by one.
console.log(`\nRecovery: ${recoveryReport.recoveredFiles} file(s) recovered from an interrupted run, ` +
  `${recoveryReport.sweptArtifacts} artefact(s) swept, ${recoveryReport.restoreFailures} restore failure(s).`);
console.log(`Summary: ${passed} passed, ${failed} failed ` +
  `(functional: ${fPass}/${fPass + fFail}, mutation killed: ${mutants.killed}/${mutations.length}, ` +
  `survived: ${mutants.survived}, infra: ${mutants.infra}).`);
// A restore failure is a harness failure even when every assertion passed.
process.exit(failed > 0 || recoveryReport.restoreFailures > 0 ? 1 : 0);
