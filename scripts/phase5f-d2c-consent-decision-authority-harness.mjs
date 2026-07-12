import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5F-D2-C — read-only communication-consent decision authority.
 *
 * The service is transpiled with a STUBBED Supabase (adminClient throws — real Supabase must never
 * run) and driven entirely through INJECTED read dependencies + an INJECTED clock. No production DB
 * is touched. Boundary checks are static on the real source; mutations edit the real service (or the
 * webhook) and must be caught, restoring every file byte-identically afterwards.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const TS_FILES = ["lib/communication/consentPolicy.ts"];
const SERVICE_SRC = "services/communicationConsentDecisionService.ts";
const POLICY_SRC = "lib/communication/consentPolicy.ts";
const WEBHOOK_SVC_SRC = "services/metaWhatsAppWebhookService.ts";
const DOC_SRC = "docs/QF-Consent-Decision-Authority-Phase-5F-D2-C.md";
const HARNESS_SRC = "scripts/phase5f-d2c-consent-decision-authority-harness.mjs";

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
    files: [SERVICE_SRC],
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  catch { /* expected noResolve diagnostics */ }
  finally { rmSync(tsconfigPath, { force: true }); }
  if (!existsSync(resolve(outDir, "services/communicationConsentDecisionService.js"))) throw new Error("service did not transpile");
}

function wireBuild(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const original = Module._load;
  const STUBS = {
    "../lib/supabase": { adminClient: () => { throw new Error("real Supabase must never run in the D2-C harness"); } },
  };
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return original.apply(this, [request, parent, isMain]);
  };
  return { Service: req("./services/communicationConsentDecisionService.js") };
}

const readF = (f) => readFileSync(f, "utf8");
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }
function gitDirty() {
  return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })
    .split("\n").map((l) => l.slice(3).trim()).filter(Boolean).map((p) => p.replace(/\\/g, "/"))
    .filter((p) => !p.startsWith(".phase5f")); // ignore this harness's own scratch build/mutation dirs
}

// ----------------------------------------------------------------------------
// D2-C PHASE BOUNDARY — TWO-MODE (pre-commit worktree | post-commit historical delta)
// A completed-phase harness validates WHAT THE PHASE INTRODUCED, never what the repo may contain
// forever. Pre-commit it checks the working tree; once committed it checks the D2-C commit's delta,
// so a later D2-D/D3 worktree never fails D2-C. (See the D2-B harness for the same principle.)
// ----------------------------------------------------------------------------
const D2C_BASE = "2606739ea849daecfef0a736b572e6406db8f925"; // Phase 5F-D2-B — the D2-C base/parent
const D2C_EXPECTED_FILES = [
  "docs/QF-Consent-Decision-Authority-Phase-5F-D2-C.md",
  "lib/communication/consentPolicy.ts",
  "package.json",
  "scripts/phase5f-d2b-consent-evidence-schema-harness.mjs",
  "scripts/phase5f-d2c-consent-decision-authority-harness.mjs",
  "services/communicationConsentDecisionService.ts",
];

/** PURE validator: exactly the six D2-C files + correct parent; no migration/env/lockfile/route/webhook/unrelated service. */
function validateD2CHistoricalDelta(files, parent) {
  const problems = [];
  const set = new Set(files);
  if (files.length !== D2C_EXPECTED_FILES.length) problems.push(`expected ${D2C_EXPECTED_FILES.length} files, got ${files.length} [${files.join(", ")}]`);
  for (const f of D2C_EXPECTED_FILES) if (!set.has(f)) problems.push(`missing approved D2-C file: ${f}`);
  for (const f of files) if (!D2C_EXPECTED_FILES.includes(f)) problems.push(`unexpected file in the D2-C delta: ${f}`);
  if (parent !== D2C_BASE) problems.push(`expected parent ${D2C_BASE}, got ${parent}`);
  for (const f of files) {
    if (/^supabase\/migrations\//.test(f)) problems.push(`D2-C must add no migration: ${f}`);
    if (/(^|\/)\.env(\.|$)/.test(f)) problems.push(`D2-C must change no env file: ${f}`);
    if (/(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(f)) problems.push(`D2-C must change no lockfile: ${f}`);
    if (/(^|\/)(app|pages)\/api\//.test(f)) problems.push(`D2-C must introduce no API route: ${f}`);
    if (/webhook/i.test(f)) problems.push(`D2-C must modify no webhook file: ${f}`);
    if (/^services\//.test(f) && f !== SERVICE_SRC) problems.push(`D2-C must introduce no unrelated service: ${f}`);
  }
  return problems;
}

function headSha() { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }

/**
 * Locate the historical D2-C commit: the first-parent child of the fixed D2-C base on the path to
 * HEAD. Fails LOUD when HEAD is not ahead of the base on the first-parent chain — it NEVER silently
 * falls back to worktree validation. A squash workflow that discards the D2-C commit needs harness
 * adaptation; normal chained commits / fast-forward / normal merge preserve reachability.
 */
function d2cHistoricalCommit() {
  const revs = execFileSync("git", ["rev-list", "--first-parent", "--ancestry-path", `${D2C_BASE}..HEAD`], { encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean);
  if (revs.length === 0) throw new Error("D2-C historical commit unresolvable: HEAD is not ahead of the D2-C base on the first-parent chain (chained history required)");
  const commit = revs[revs.length - 1]; // oldest on the ancestry path = the first child of the base
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

const MAIN_DIR = resolve(".phase5fd2c-build-main");
compileTo(MAIN_DIR);
transpileService(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// FIXTURES
// ============================================================================
const HASH = "a".repeat(64);
const UUID = "11111111-1111-1111-1111-111111111111";
const AT = new Date("2026-07-11T00:00:00.000Z");
const FUTURE_ISO = "2026-09-01T00:00:00.000Z"; // effective (not expired)
const PAST_ISO = "2026-06-01T00:00:00.000Z";   // expired
const POLICY = "qf-consent-v1";
// Valid UUIDs for DB-row ids (the service now validates row id shape as a second integrity fence).
const SUPP_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const SUPP_ID_B = "bbbbbbbb-2222-4222-8222-222222222222";
const PREF_ID = "cccccccc-3333-4333-8333-333333333333";
const PREF_ID_B = "dddddddd-4444-4444-8444-444444444444";

function input(scope, over = {}) {
  return {
    channel: "whatsapp", scope, destinationHash: HASH,
    identityConfidence: "exact", principal: { type: "client", id: UUID }, evaluatedAt: AT, ...over,
  };
}
const suppRow = (over = {}) => ({ id: SUPP_ID, scope: "global", reason: "user_stop", policy_version: POLICY, is_active: true, expires_at: null, deactivated_at: null, ...over });
const prefRow = (over = {}) => ({ id: PREF_ID, state: "allowed", policy_version: POLICY, consented_at: "2026-07-01T00:00:00.000Z", withdrawn_at: null, ...over });

function makeDeps(over = {}) {
  const calls = { suppressions: 0, preferences: 0 };
  return {
    calls,
    now: over.now ?? (() => AT),
    readSuppressions: over.readSuppressions ?? (async (q) => {
      calls.suppressions++;
      if (over.suppThrows) throw new Error("db down: SQLSTATE 08006 connection reset by peer");
      const rows = over.suppressions ?? [];
      // A faithful adapter honours the scopes filter (real adapter uses .in("scope", scopes)).
      return over.suppRaw ? rows : rows.filter((r) => q.scopes.includes(r.scope));
    }),
    readExactPreference: over.readExactPreference ?? (async () => {
      calls.preferences++;
      if (over.prefThrows) throw new Error("db down: SQLSTATE 08006 connection reset by peer");
      return over.preferences ?? [];
    }),
  };
}
async function runWith(Service, inp, over = {}) {
  const deps = makeDeps(over);
  const r = await Service.decideCommunicationConsent(inp, deps);
  return { r, deps };
}
const run = (inp, over = {}) => runWith(M.Service, inp, over);

// ============================================================================
// INPUT (1-7)
// ============================================================================
check("1. valid exact input decides (no throw)", async () => {
  const { r } = await run(input("marketing"));
  assert(r.ok === true && typeof r.disposition === "string", "valid input returns a success outcome");
});
check("2-7. invalid input is rejected BEFORE any DB access", async () => {
  const cases = [
    input("marketing", { destinationHash: "xyz" }),                                  // 2 bad hash
    input("marketing", { destinationHash: "A".repeat(64) }),                          // 2 uppercase hex not allowed
    input("marketing", { identityConfidence: "exact", principal: null }),             // 3 exact w/o principal
    input("marketing", { identityConfidence: "ambiguous", principal: { type: "client", id: UUID } }), // 4 ambiguous w/ principal
    input("marketing", { identityConfidence: "unknown", principal: { type: "client", id: UUID } }),   // 5 unknown w/ principal
    input("marketing", { principal: { type: "client", id: "not-a-uuid" } }),          // 6 bad uuid
    input("marketing", { evaluatedAt: new Date("nope") }),                            // 7 invalid date
    input("bogus"),                                                                    // bad scope
    input("marketing", { channel: "email" }),                                         // bad channel
  ];
  for (const inp of cases) {
    const { r, deps } = await run(inp);
    assert(r.ok === false && r.code === "INVALID_DECISION_INPUT", `invalid → INVALID_DECISION_INPUT: ${safeStringify(inp).slice(0, 60)}`);
    assert(deps.calls.suppressions === 0 && deps.calls.preferences === 0, "no DB access for invalid input");
  }
});

// ============================================================================
// SUPPRESSION (8-22)
// ============================================================================
check("8-10. active global suppression blocks marketing / transactional / authentication", async () => {
  for (const scope of ["marketing", "transactional", "authentication"]) {
    const { r } = await run(input(scope), { suppressions: [suppRow({ scope: "global", reason: "legal" })] });
    assert(r.ok && r.disposition === "blocked" && r.reasonCode === "global_suppression_active", `${scope} blocked by global`);
    assert(r.matchedSuppressionId === SUPP_ID && r.suppressionReason === "legal", "matched id + reason surfaced");
  }
});
check("11-13. marketing suppression blocks marketing only (not transactional/authentication)", async () => {
  const m = await run(input("marketing"), { suppressions: [suppRow({ scope: "marketing", reason: "user_stop" })] });
  assert(m.r.ok && m.r.disposition === "blocked" && m.r.reasonCode === "scope_suppression_active", "11. marketing blocked");
  const t = await run(input("transactional"), { suppressions: [suppRow({ scope: "marketing" })] });
  assert(t.r.ok && t.r.disposition !== "blocked", "12. marketing suppression does not block transactional");
  const a = await run(input("authentication"), { suppressions: [suppRow({ scope: "marketing" })] });
  assert(a.r.ok && a.r.disposition !== "blocked", "13. marketing suppression does not block authentication");
});
check("14-15. transactional suppression blocks transactional only", async () => {
  const t = await run(input("transactional"), { suppressions: [suppRow({ scope: "transactional" })] });
  assert(t.r.ok && t.r.disposition === "blocked" && t.r.reasonCode === "scope_suppression_active", "14. transactional blocked");
  const a = await run(input("authentication"), { suppressions: [suppRow({ scope: "transactional" })] });
  assert(a.r.ok && a.r.disposition !== "blocked", "15. transactional suppression does not block authentication");
});
check("16-17. expired suppression is ignored (global + exact scope)", async () => {
  const g = await run(input("marketing"), { suppressions: [suppRow({ scope: "global", expires_at: PAST_ISO })] });
  assert(g.r.ok && g.r.disposition !== "blocked", "16. expired global ignored");
  const s = await run(input("marketing"), { suppressions: [suppRow({ scope: "marketing", expires_at: PAST_ISO })] });
  assert(s.r.ok && s.r.disposition !== "blocked", "17. expired exact-scope ignored");
  // A future expiry is still effective.
  const eff = await run(input("marketing"), { suppressions: [suppRow({ scope: "global", expires_at: FUTURE_ISO })] });
  assert(eff.r.ok && eff.r.disposition === "blocked", "future-expiry global still blocks");
});
check("18. an inactive row returned by the active query → AUTHORITY_INTEGRITY_VIOLATION", async () => {
  const { r } = await run(input("marketing"), { suppRaw: true, suppressions: [suppRow({ scope: "global", is_active: false, deactivated_at: PAST_ISO })] });
  assert(r.ok === false && r.code === "AUTHORITY_INTEGRITY_VIOLATION", "inactive row is a second-fence integrity violation");
});
check("19. global wins over exact scope", async () => {
  const { r } = await run(input("marketing"), { suppressions: [suppRow({ id: SUPP_ID, scope: "global", reason: "admin" }), suppRow({ id: SUPP_ID_B, scope: "marketing", reason: "user_stop" })] });
  assert(r.ok && r.disposition === "blocked" && r.reasonCode === "global_suppression_active" && r.matchedSuppressionId === SUPP_ID, "global chosen, its id/reason returned");
});
check("20. a blocking suppression short-circuits the preference lookup", async () => {
  const { deps } = await run(input("marketing"), { suppressions: [suppRow({ scope: "global" })], preferences: [prefRow({ state: "allowed" })] });
  assert(deps.calls.preferences === 0, "preference is NOT read after a blocking suppression");
});
check("21. suppression DB failure → AUTHORITY_LOOKUP_FAILED", async () => {
  const { r } = await run(input("marketing"), { suppThrows: true });
  assert(r.ok === false && r.code === "AUTHORITY_LOOKUP_FAILED", "lookup failure is not collapsed");
});
check("22. duplicate same-scope suppression → AUTHORITY_INTEGRITY_VIOLATION", async () => {
  const { r } = await run(input("marketing"), { suppressions: [suppRow({ id: SUPP_ID, scope: "global" }), suppRow({ id: SUPP_ID_B, scope: "global" })] });
  assert(r.ok === false && r.code === "AUTHORITY_INTEGRITY_VIOLATION", "two active globals → integrity");
});

// ============================================================================
// PREFERENCE (23-33)
// ============================================================================
check("23-25. exact blocked preference blocks all scopes", async () => {
  for (const scope of ["marketing", "transactional", "authentication"]) {
    const { r } = await run(input(scope), { preferences: [prefRow({ state: "blocked", consented_at: null, withdrawn_at: "2026-07-02T00:00:00.000Z" })] });
    assert(r.ok && r.disposition === "blocked" && r.reasonCode === "preference_blocked" && r.matchedPreferenceId === PREF_ID, `${scope} blocked by preference`);
  }
});
check("26-28. exact allowed preference: marketing_opted_in / no_consent_objection x2", async () => {
  const m = await run(input("marketing"), { preferences: [prefRow({ state: "allowed" })] });
  assert(m.r.ok && m.r.disposition === "marketing_opted_in" && m.r.reasonCode === "preference_marketing_opted_in", "26. marketing opted in");
  const t = await run(input("transactional"), { preferences: [prefRow({ state: "allowed" })] });
  assert(t.r.ok && t.r.disposition === "no_consent_objection", "27. transactional no objection");
  const a = await run(input("authentication"), { preferences: [prefRow({ state: "allowed" })] });
  assert(a.r.ok && a.r.disposition === "no_consent_objection", "28. authentication no objection");
});
check("29-30. stale-policy allowed marketing → unknown; stale-policy blocked stays blocked", async () => {
  const m = await run(input("marketing"), { preferences: [prefRow({ state: "allowed", policy_version: "qf-consent-v0" })] });
  assert(m.r.ok && m.r.disposition === "unknown" && m.r.reasonCode === "preference_policy_version_mismatch", "29. stale allowed marketing → unknown");
  const b = await run(input("marketing"), { preferences: [prefRow({ state: "blocked", policy_version: "qf-consent-v0", consented_at: null, withdrawn_at: "2026-07-02T00:00:00.000Z" })] });
  assert(b.r.ok && b.r.disposition === "blocked", "30. stale blocked remains blocked");
});
check("31. preference DB failure → AUTHORITY_LOOKUP_FAILED", async () => {
  const { r } = await run(input("marketing"), { prefThrows: true });
  assert(r.ok === false && r.code === "AUTHORITY_LOOKUP_FAILED", "preference lookup failure not collapsed");
});
check("32. duplicate preference → AUTHORITY_INTEGRITY_VIOLATION", async () => {
  const { r } = await run(input("marketing"), { preferences: [prefRow({ id: PREF_ID }), prefRow({ id: PREF_ID_B })] });
  assert(r.ok === false && r.code === "AUTHORITY_INTEGRITY_VIOLATION", "two preferences → integrity");
});
check("33. contradictory preference timestamps → AUTHORITY_INTEGRITY_VIOLATION", async () => {
  const allowedBad = await run(input("marketing"), { preferences: [prefRow({ state: "allowed", consented_at: "2026-07-01T00:00:00.000Z", withdrawn_at: "2026-07-02T00:00:00.000Z" })] });
  assert(allowedBad.r.ok === false && allowedBad.r.code === "AUTHORITY_INTEGRITY_VIOLATION", "allowed+withdrawn → integrity");
  const blockedBad = await run(input("marketing"), { preferences: [prefRow({ state: "blocked", consented_at: "2026-07-01T00:00:00.000Z", withdrawn_at: null })] });
  assert(blockedBad.r.ok === false && blockedBad.r.code === "AUTHORITY_INTEGRITY_VIOLATION", "blocked+consented/no-withdrawn → integrity");
});

// ============================================================================
// DEFAULTS (34-42)
// ============================================================================
check("34-36. marketing default is UNKNOWN for exact-missing / ambiguous / unknown", async () => {
  const e = await run(input("marketing"), {});
  assert(e.r.ok && e.r.disposition === "unknown" && e.r.reasonCode === "no_marketing_preference", "34. exact missing → unknown");
  const a = await run(input("marketing", { identityConfidence: "ambiguous", principal: null }), {});
  assert(a.r.ok && a.r.disposition === "unknown" && a.r.reasonCode === "ambiguous_identity_no_marketing_authority", "35. ambiguous → unknown");
  assert(a.deps.calls.preferences === 0, "35. no preference read for ambiguous");
  const u = await run(input("marketing", { identityConfidence: "unknown", principal: null }), {});
  assert(u.r.ok && u.r.disposition === "unknown" && u.r.reasonCode === "unknown_identity_no_marketing_authority", "36. unknown → unknown");
});
check("37-39. authentication default is no_consent_objection for exact/ambiguous/unknown", async () => {
  const e = await run(input("authentication"), {});
  assert(e.r.ok && e.r.disposition === "no_consent_objection" && e.r.reasonCode === "authentication_no_consent_objection", "37. exact missing");
  const a = await run(input("authentication", { identityConfidence: "ambiguous", principal: null }), {});
  assert(a.r.ok && a.r.disposition === "no_consent_objection", "38. ambiguous");
  const u = await run(input("authentication", { identityConfidence: "unknown", principal: null }), {});
  assert(u.r.ok && u.r.disposition === "no_consent_objection", "39. unknown");
});
check("40-42. transactional default is no_consent_objection for exact/ambiguous/unknown", async () => {
  const e = await run(input("transactional"), {});
  assert(e.r.ok && e.r.disposition === "no_consent_objection" && e.r.reasonCode === "transactional_no_consent_objection", "40. exact missing");
  const a = await run(input("transactional", { identityConfidence: "ambiguous", principal: null }), {});
  assert(a.r.ok && a.r.disposition === "no_consent_objection", "41. ambiguous");
  const u = await run(input("transactional", { identityConfidence: "unknown", principal: null }), {});
  assert(u.r.ok && u.r.disposition === "no_consent_objection", "42. unknown");
});

// ============================================================================
// RE-CONSENT (43-50)
// ============================================================================
check("43-50. re-consent eligibility maps each suppression reason", async () => {
  const map = {
    user_stop: "self_service_allowed",
    provider_block: "provider_resolution_required",
    hard_bounce: "provider_resolution_required",
    complaint: "admin_only",
    admin: "admin_only",
    legal: "admin_only",
    abuse: "admin_only",
    unspecified: "admin_only",
  };
  for (const [reason, expected] of Object.entries(map)) {
    const { r } = await run(input("marketing"), { suppressions: [suppRow({ scope: "global", reason })] });
    assert(r.ok && r.disposition === "blocked" && r.reconsent === expected && r.suppressionReason === reason, `${reason} → ${expected}`);
  }
  // No active suppression → not_applicable.
  const clear = await run(input("marketing"), {});
  assert(clear.r.ok && clear.r.reconsent === "not_applicable", "no suppression → not_applicable");
});

// ============================================================================
// PRIVACY & BOUNDARIES (51-60)
// ============================================================================
check("51-52. no raw DB error and no destination hash in any result", async () => {
  const fail = await run(input("marketing"), { suppThrows: true });
  const rendered = safeStringify(fail.r);
  assert(!/SQLSTATE|connection reset|db down|Error|stack/i.test(rendered), "51. no raw DB error / SQLSTATE / stack");
  const outcomes = [
    (await run(input("marketing"), { suppressions: [suppRow({ scope: "global" })] })).r,
    (await run(input("marketing"), { preferences: [prefRow({ state: "allowed" })] })).r,
    (await run(input("authentication"), {})).r,
    fail.r,
  ];
  for (const o of outcomes) assert(!safeStringify(o).includes(HASH), "52. destination hash never echoed");
});
check("53-58. read-only, no writes, no integration; cardinality-preserving adapter (static source)", () => {
  const code = stripTs(readF(SERVICE_SRC));
  hasNot(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/, code, "53. no write/rpc method");
  hasNot(/from\(["']communication_consent_events["']\)/, code, "54. no communication_consent_events access");
  hasNot(/sendTemplateMessage|sendAuthenticationMessage|sendResolvedAuthenticationSms|sendResolvedTemplate|CommunicationService|\.send\(/, code, "56. no send integration");
  hasNot(/domain_events|outbox_events|\bn8n\b|emitEvent|dispatchEvent/i, code, "57. no event/outbox/n8n");
  hasNot(/\bjarvis\b|openai|anthropic|\bllm\b/i, code, "58. no AI/Jarvis");
  // The adapter preserves cardinality: NO .single()/.maybeSingle()/.limit() that would hide duplicates.
  hasNot(/\.single\(|\.maybeSingle\(|\.limit\(/, code, "adapter is cardinality-preserving (no single/maybeSingle/limit)");
  // 55: the webhook does not import/invoke the decision authority.
  const svc = stripTs(readF(WEBHOOK_SVC_SRC));
  hasNot(/communicationConsentDecisionService|decideCommunicationConsent/, svc, "55. the webhook does not import the decision authority");
});

check("59-60. two-mode phase boundary (pre-commit worktree | post-commit historical D2-C delta)", () => {
  if (headSha() === D2C_BASE) {
    // PRE-COMMIT: the D2-C commit does not exist yet — validate the WORKING-TREE delta is exactly six.
    const files = gitDirty();
    const problems = validateD2CHistoricalDelta(files, D2C_BASE);
    assert(problems.length === 0, `pre-commit D2-C delta violation: ${problems.join(" | ")}`);
  } else {
    // POST-COMMIT / FUTURE-PHASE: validate the D2-C COMMIT's delta, NOT the current worktree, so later
    // D2-D/D3 files never fail D2-C. Fails loud if the chained D2-C commit is unreachable.
    const { files, parent, message } = d2cHistoricalCommit();
    assert(/^Phase 5F-D2-C:/.test(message), `the first commit after the D2-C base must be 'Phase 5F-D2-C:' (got '${message.slice(0, 60)}')`);
    const problems = validateD2CHistoricalDelta(files, parent);
    assert(problems.length === 0, `historical D2-C delta violation: ${problems.join(" | ")}`);
  }
});

// ============================================================================
// WIRING + DOC
// ============================================================================
check("wiring: policy constant + script + doc present; policy version is a fixed code constant", async () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:d2c"] === "node scripts/phase5f-d2c-consent-decision-authority-harness.mjs", "d2c script wired");
  const policy = readF(POLICY_SRC);
  assert(/CONSENT_POLICY_VERSION = "qf-consent-v1"/.test(policy), "policy constant = qf-consent-v1");
  assert(/^[A-Za-z0-9._:-]{1,64}$/.test("qf-consent-v1"), "policy version satisfies the DB fence");
  hasNot(/process\.env|\brequest\b|payload/i, stripTs(policy), "policy version is never from env/request/payload (code, not comments)");
  for (const f of [POLICY_SRC, SERVICE_SRC, DOC_SRC]) assert(existsSync(f), `${f} exists`);
  const doc = readF(DOC_SRC);
  for (const topic of [
    /authority ownership|QuickFurno Core/i, /policy version/i, /input contract/i, /output contract/i,
    /no universal boolean|not one boolean/i, /suppression precedence/i, /read.time expiry|effective activity/i,
    /identity.confidence/i, /marketing default.deny|marketing.*deny/i, /authentication.*no.objection/i,
    /transactional.*no.objection/i, /policy.version mismatch/i, /re.consent/i, /infrastructure failure|AUTHORITY_LOOKUP_FAILED/i,
    /integrity|AUTHORITY_INTEGRITY_VIOLATION/i, /read.only/i, /privacy/i, /no integration/i, /no STOP\/START\/HELP|no STOP/i,
    /no writer/i, /no schema change|no migration/i, /migration.history/i, /Meta remains disabled|Meta.*disabled/i,
  ]) has(topic, doc, `doc covers ${topic}`);
});

// ============================================================================
// EDGE CASES — expiry boundary, DB-row integrity, immutable instant (61-75)
// ============================================================================
const AT_MS = AT.getTime();
const EXACT_ISO = new Date(AT_MS).toISOString(); // expires_at == evaluatedAt boundary

check("61. suppression expires_at == evaluatedAt → expired (does not block); +1ms still blocks", async () => {
  const eq = await run(input("marketing"), { suppressions: [suppRow({ scope: "global", expires_at: EXACT_ISO })] });
  assert(eq.r.ok && eq.r.disposition !== "blocked", "equal boundary is expired");
  const plus1 = await run(input("marketing"), { suppressions: [suppRow({ scope: "global", expires_at: new Date(AT_MS + 1).toISOString() })] });
  assert(plus1.r.ok && plus1.r.disposition === "blocked", "one ms in the future still blocks");
});
check("62-65. malformed suppression fields → AUTHORITY_INTEGRITY_VIOLATION (never silently expired)", async () => {
  const cases = [
    suppRow({ scope: "global", expires_at: "not-a-timestamp" }),                       // 62 malformed expires_at
    suppRow({ scope: "global", is_active: true, deactivated_at: "not-a-timestamp" }),   // 63 malformed deactivated_at
    suppRow({ scope: "global", id: "not-a-uuid" }),                                     // 64 malformed uuid
    suppRow({ scope: "global", policy_version: "bad version!!" }),                      // 65 malformed policy_version
    suppRow({ scope: "global", reason: "nonsense" }),                                   // out-of-vocab reason
    suppRow({ scope: "nonsense" }),                                                     // out-of-vocab scope
  ];
  for (const row of cases) {
    const { r } = await run(input("marketing"), { suppRaw: true, suppressions: [row] });
    assert(r.ok === false && r.code === "AUTHORITY_INTEGRITY_VIOLATION", `malformed suppression → integrity: ${safeStringify(row).slice(0, 70)}`);
  }
});
check("66-69. malformed preference fields → AUTHORITY_INTEGRITY_VIOLATION", async () => {
  const cases = [
    prefRow({ state: "allowed", consented_at: "not-a-timestamp" }),                    // 66 malformed consented_at
    prefRow({ state: "blocked", consented_at: null, withdrawn_at: "nope" }),           // 67 malformed withdrawn_at
    prefRow({ id: "not-a-uuid" }),                                                     // 68 malformed uuid
    prefRow({ policy_version: "bad version!!" }),                                       // 69 malformed policy_version
    prefRow({ state: "unknown" }),                                                     // out-of-vocab state
  ];
  for (const row of cases) {
    const { r } = await run(input("marketing"), { preferences: [row] });
    assert(r.ok === false && r.code === "AUTHORITY_INTEGRITY_VIOLATION", `malformed preference → integrity: ${safeStringify(row).slice(0, 70)}`);
  }
});
check("70-71. duplicate physically-active rows, one expired → integrity (checked before expiry)", async () => {
  const g = await run(input("marketing"), { suppressions: [suppRow({ id: SUPP_ID, scope: "global" }), suppRow({ id: SUPP_ID_B, scope: "global", expires_at: PAST_ISO })] });
  assert(g.r.ok === false && g.r.code === "AUTHORITY_INTEGRITY_VIOLATION", "70. two active globals (one expired) → integrity");
  const s = await run(input("marketing"), { suppressions: [suppRow({ id: SUPP_ID, scope: "marketing" }), suppRow({ id: SUPP_ID_B, scope: "marketing", expires_at: PAST_ISO })] });
  assert(s.r.ok === false && s.r.code === "AUTHORITY_INTEGRITY_VIOLATION", "71. two active exact-scope (one expired) → integrity");
});
check("72. a corrupt exact-scope row alongside a valid global → integrity (corruption not hidden)", async () => {
  const { r } = await run(input("marketing"), { suppRaw: true, suppressions: [suppRow({ id: SUPP_ID, scope: "global" }), suppRow({ id: SUPP_ID_B, scope: "marketing", expires_at: "garbage" })] });
  assert(r.ok === false && r.code === "AUTHORITY_INTEGRITY_VIOLATION", "the valid global must not hide the corrupt exact-scope row");
});
check("73. an invalid Date from the injected now() → INVALID_DECISION_INPUT, zero DB calls", async () => {
  const { r, deps } = await run(input("marketing", { evaluatedAt: undefined }), { now: () => new Date("nope") });
  assert(r.ok === false && r.code === "INVALID_DECISION_INPUT", "invalid injected clock fails closed");
  assert(deps.calls.suppressions === 0 && deps.calls.preferences === 0, "no DB call when the clock is invalid");
});
check("74. a dependency throwing a NON-Error value → AUTHORITY_LOOKUP_FAILED", async () => {
  const { r } = await run(input("marketing"), { readSuppressions: async () => { throw "a bare string"; } });
  assert(r.ok === false && r.code === "AUTHORITY_LOOKUP_FAILED", "a non-Error throw is still a lookup failure");
});
check("75. the evaluation instant is FROZEN across await boundaries (mutable clock)", async () => {
  let ticks = 0;
  const clockNow = () => new Date(AT_MS + (ticks++) * 60_000); // +1 minute per call
  const between = new Date(AT_MS + 30_000).toISOString();      // expires between tick0 and tick1
  const { r } = await run(input("marketing", { evaluatedAt: undefined }), { now: clockNow, suppressions: [suppRow({ scope: "global", expires_at: between })] });
  assert(r.ok && r.disposition === "blocked", "a frozen instant keeps a between-ticks suppression effective");
});

// ============================================================================
// PRODUCTION-ADAPTER RESPONSE NORMALIZER (76-80) — behavioral, no real Supabase
// ============================================================================
check("76-80. normalizeSupabaseReadResult preserves cardinality and prioritizes the error", () => {
  const N = M.Service.normalizeSupabaseReadResult;
  assert(JSON.stringify(N({ data: [{ id: 1 }, { id: 2 }], error: null })) === JSON.stringify([{ id: 1 }, { id: 2 }]), "76. data + null error → rows preserved");
  assert(JSON.stringify(N({ data: null, error: null })) === "[]", "77. null data + null error → empty array");
  let threw = false; try { N({ data: [{ id: 1 }], error: new Error("boom") }); } catch { threw = true; }
  assert(threw, "78. data + error → error takes precedence (throws)");
  assert(N({ data: [{ id: "x" }, { id: "x" }], error: null }).length === 2, "79. duplicate suppression rows preserved");
  assert(N({ data: [{ id: "p" }, { id: "p" }], error: null }).length === 2, "80. duplicate preference rows preserved");
});

// ============================================================================
// STRICT RFC3339 DB TIMESTAMPS (81-82) — through the real row validators
// ============================================================================
check("81. valid timezone-qualified RFC3339 timestamps accepted (suppression + preference rows)", async () => {
  const validFuture = [
    "2026-09-01T00:00:00Z",             // 1. Z, no fraction
    "2026-09-01T00:00:00.123Z",         // 2. Z, three fractional
    "2026-09-01T00:00:00.123456Z",      // 3. Z, six fractional
    "2026-09-01T00:00:00+05:30",        // 4. positive offset (→ 2026-08-31T18:30Z, still future)
    "2026-09-01T00:00:00-04:00",        // 5. negative offset
    "2026-09-01T00:00:00.123456-04:00", // 6. fraction + offset
    "2028-02-29T00:00:00Z",             // 7. valid leap day
  ];
  for (const ts of validFuture) {
    const { r } = await run(input("marketing"), { suppressions: [suppRow({ scope: "global", expires_at: ts })] });
    assert(r.ok === true && r.disposition === "blocked", `valid future expires_at accepted + effective: ${ts}`);
  }
  const p = await run(input("marketing"), { preferences: [prefRow({ state: "allowed", consented_at: "2026-07-01T00:00:00.123456Z" })] });
  assert(p.r.ok === true && p.r.disposition === "marketing_opted_in", "valid preference consented_at accepted");
  // 8. equality boundary preserved (covered by test 61); a valid past expires_at is accepted but expired.
  const past = await run(input("marketing"), { suppressions: [suppRow({ scope: "global", expires_at: "2026-06-01T00:00:00Z" })] });
  assert(past.r.ok === true && past.r.disposition !== "blocked", "valid past expires_at accepted (expired, not integrity)");
});
check("82. malformed timestamps → AUTHORITY_INTEGRITY_VIOLATION across all four DB timestamp columns", async () => {
  const malformed = [
    "2026-07-11T10:30:00",        // timezone-less
    "2026-07-11",                 // date-only
    "07/11/2026",                 // locale
    "2026-07-11 10:30:00Z",       // space instead of T
    "",                           // empty
    "   ",                        // whitespace
    "not-a-timestamp",            // arbitrary
    "2026-02-29T10:30:00Z",       // impossible non-leap Feb 29
    "2026-04-31T10:30:00Z",       // impossible Apr 31
    "2026-13-01T10:30:00Z",       // invalid month
    "2026-09-01T24:00:00Z",       // invalid hour
    "2026-09-01T10:60:00Z",       // invalid minute
    "2026-09-01T10:30:60Z",       // leap second rejected
    "2026-09-01T00:00:00+25:00",  // invalid offset hour
    "2026-09-01T00:00:00+05:99",  // invalid offset minute
    "2026-09-01T00:00:00Z extra", // trailing text
  ];
  // suppression.expires_at
  for (const ts of malformed) {
    const { r } = await run(input("marketing"), { suppRaw: true, suppressions: [suppRow({ scope: "global", expires_at: ts })] });
    assert(r.ok === false && r.code === "AUTHORITY_INTEGRITY_VIOLATION", `suppression.expires_at malformed → integrity: ${JSON.stringify(ts)}`);
    assert(Object.keys(r).length === 2, "the malformed value is never exposed in the result");
  }
  // preference.consented_at (locale + timezone-less)
  for (const ts of ["07/11/2026", "2026-07-11T10:30:00"]) {
    const { r } = await run(input("marketing"), { preferences: [prefRow({ state: "allowed", consented_at: ts })] });
    assert(r.ok === false && r.code === "AUTHORITY_INTEGRITY_VIOLATION", `preference.consented_at malformed → integrity: ${ts}`);
  }
  // preference.withdrawn_at (malformed offset) on a blocked preference
  const w = await run(input("marketing"), { preferences: [prefRow({ state: "blocked", consented_at: null, withdrawn_at: "2026-09-01T00:00:00+25:00" })] });
  assert(w.r.ok === false && w.r.code === "AUTHORITY_INTEGRITY_VIOLATION" && !JSON.stringify(w.r).includes("+25:00"), "preference.withdrawn_at malformed offset → integrity, value not exposed");
  // suppression.deactivated_at (date-only, non-null on an active row) → integrity
  const d = await run(input("marketing"), { suppRaw: true, suppressions: [suppRow({ scope: "global", is_active: true, deactivated_at: "2026-07-11" })] });
  assert(d.r.ok === false && d.r.code === "AUTHORITY_INTEGRITY_VIOLATION", "suppression.deactivated_at (date-only, active) → integrity");
  // a selected column silently missing (undefined) → integrity
  const u = await run(input("marketing"), { suppRaw: true, suppressions: [{ id: SUPP_ID, scope: "global", reason: "user_stop", policy_version: POLICY, is_active: true, deactivated_at: null }] });
  assert(u.r.ok === false && u.r.code === "AUTHORITY_INTEGRITY_VIOLATION", "missing (undefined) expires_at → integrity");
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutationChecks = [];
function tsMutation(name, edits, scenario) { mutationChecks.push({ name, kind: "ts", edits: edits.map(([f, from, to]) => ({ file: f, from, to })), scenario }); }
function srcMutation(name, file, from, to, scenario) { mutationChecks.push({ name, kind: "src", edits: [{ file, from, to }], scenario }); }
/** A pure-scenario mutation (no file edit, no git-dirty): scenario() returns true when the vulnerability is caught. */
function fnMutation(name, scenario) { mutationChecks.push({ name, kind: "fn", scenario }); }

tsMutation("MUT A: treat an expired suppression as active",
  [[SERVICE_SRC, "n.expiresAtMs === null || n.expiresAtMs > evaluatedAtMs", "n.expiresAtMs === null || true"]],
  async (mm) => { const { r } = await runWith(mm.Service, input("marketing"), { suppressions: [suppRow({ scope: "global", expires_at: PAST_ISO })] }); return r.ok && r.disposition === "blocked"; });

tsMutation("MUT B: ignore a global suppression",
  [[SERVICE_SRC, '  if (globalEff) return { kind: "blocked", id: globalEff.id, reason: globalEff.reason as ConsentSuppressionReason, reasonCode: "global_suppression_active" };', '  if (false) return { kind: "blocked", id: globalEff.id, reason: globalEff.reason as ConsentSuppressionReason, reasonCode: "global_suppression_active" };']],
  async (mm) => { const { r } = await runWith(mm.Service, input("marketing"), { suppressions: [suppRow({ scope: "global" })] }); return r.ok && r.disposition !== "blocked"; });

tsMutation("MUT C: evaluate preference before suppression",
  [[SERVICE_SRC, "  // 3) Suppression precedence FIRST.", "  const prefC = await loadExactPreference(input, deps);\n  if (prefC.kind === \"row\") return ok(derive(input, prefC.row));\n  // 3) Suppression precedence FIRST."]],
  async (mm) => { const { r } = await runWith(mm.Service, input("marketing"), { suppressions: [suppRow({ scope: "global" })], preferences: [prefRow({ state: "allowed" })] }); return r.ok && r.disposition === "marketing_opted_in"; });

tsMutation("MUT D: allow marketing without a trusted allowed preference",
  [[SERVICE_SRC, 'return { disposition: "unknown", reasonCode };', 'return { disposition: "marketing_opted_in", reasonCode };']],
  async (mm) => { const { r } = await runWith(mm.Service, input("marketing"), {}); return r.ok && r.disposition === "marketing_opted_in"; });

tsMutation("MUT E: block authentication when a preference is absent",
  [[SERVICE_SRC, 'if (scope === "authentication") return { disposition: "no_consent_objection", reasonCode: "authentication_no_consent_objection" };', 'if (scope === "authentication") return { disposition: "blocked", reasonCode: "authentication_no_consent_objection" };']],
  async (mm) => { const { r } = await runWith(mm.Service, input("authentication"), {}); return r.ok && r.disposition === "blocked"; });

tsMutation("MUT F: return marketing_opted_in for a stale policy version",
  [[SERVICE_SRC, 'return { disposition: "unknown", reasonCode: "preference_policy_version_mismatch", matchedPreferenceId: row.id };', 'return { disposition: "marketing_opted_in", reasonCode: "preference_policy_version_mismatch", matchedPreferenceId: row.id };']],
  async (mm) => { const { r } = await runWith(mm.Service, input("marketing"), { preferences: [prefRow({ state: "allowed", policy_version: "qf-consent-v0" })] }); return r.ok && r.disposition === "marketing_opted_in"; });

tsMutation("MUT G: select a principal preference for an ambiguous identity",
  [[SERVICE_SRC, 'if (input.identityConfidence !== "exact" || input.principal === null) return { kind: "none" };', 'if (false) return { kind: "none" };']],
  async (mm) => { const { deps } = await runWith(mm.Service, input("marketing", { identityConfidence: "ambiguous", principal: null }), { preferences: [prefRow({ state: "allowed" })] }); return deps.calls.preferences > 0; });

tsMutation("MUT H: collapse suppression DB failure to unknown",
  [[SERVICE_SRC, 'if (supp.kind === "lookup_failed") return fail("AUTHORITY_LOOKUP_FAILED");', 'if (supp.kind === "lookup_failed") return ok({ disposition: "unknown", reasonCode: "supp_fail" });']],
  async (mm) => { const { r } = await runWith(mm.Service, input("marketing"), { suppThrows: true }); return r.ok === true; });

tsMutation("MUT I: collapse preference DB failure to no_consent_objection",
  [[SERVICE_SRC, 'if (pref.kind === "lookup_failed") return fail("AUTHORITY_LOOKUP_FAILED");', 'if (pref.kind === "lookup_failed") return ok({ disposition: "no_consent_objection", reasonCode: "pref_fail" });']],
  async (mm) => { const { r } = await runWith(mm.Service, input("marketing"), { prefThrows: true }); return r.ok === true; });

tsMutation("MUT J: allow a marketing suppression to block authentication",
  [[SERVICE_SRC, 'return null; // authentication has NO exact suppression scope', 'return "marketing"; // authentication has NO exact suppression scope']],
  async (mm) => { const { r } = await runWith(mm.Service, input("authentication"), { suppressions: [suppRow({ scope: "marketing" })] }); return r.ok && r.disposition === "blocked"; });

tsMutation("MUT K: ignore an explicit blocked preference",
  [[SERVICE_SRC, 'if (row.state === "blocked") {\n      // A blocked preference blocks ALL scopes', 'if (false) {\n      // A blocked preference blocks ALL scopes']],
  async (mm) => { const { r } = await runWith(mm.Service, input("marketing"), { preferences: [prefRow({ state: "blocked", consented_at: null, withdrawn_at: "2026-07-02T00:00:00.000Z" })] }); return r.ok && r.disposition !== "blocked"; });

tsMutation("MUT L: fail to short-circuit the preference lookup after a suppression",
  [[SERVICE_SRC, 'if (supp.kind === "blocked") return ok({ disposition: "blocked", reasonCode: supp.reasonCode, matchedSuppressionId: supp.id, suppressionReason: supp.reason, reconsent: reconsentFor(String(supp.reason)) });', 'if (supp.kind === "blocked") { void ok({ disposition: "blocked", reasonCode: supp.reasonCode }); }']],
  async (mm) => { const { deps } = await runWith(mm.Service, input("marketing"), { suppressions: [suppRow({ scope: "global" })], preferences: [prefRow({ state: "allowed" })] }); return deps.calls.preferences > 0; });

tsMutation("MUT M: map user_stop to admin_only",
  [[SERVICE_SRC, 'if (reason === "user_stop") return "self_service_allowed";', 'if (reason === "user_stop") return "admin_only";']],
  async (mm) => { const { r } = await runWith(mm.Service, input("marketing"), { suppressions: [suppRow({ scope: "global", reason: "user_stop" })] }); return r.ok && r.reconsent === "admin_only"; });

tsMutation("MUT N: echo destinationHash in the result",
  [[SERVICE_SRC, "principalConfidence: input.identityConfidence,", "principalConfidence: input.identityConfidence, destinationHash: input.destinationHash,"]],
  async (mm) => { const { r } = await runWith(mm.Service, input("authentication"), {}); return safeStringify(r).includes(HASH); });

srcMutation("MUT O: introduce a write method into the authority",
  SERVICE_SRC,
  "  const supp = await evaluateSuppressions(input, evaluatedAtMs, deps);",
  '  if (input.destinationHash === "\\uffff") { await adminClient().from("communication_consent_events").insert({}); }\n  const supp = await evaluateSuppressions(input, evaluatedAtMs, deps);',
  () => /\.insert\(/.test(stripTs(readF(SERVICE_SRC))));

srcMutation("MUT P: integrate the authority into the webhook",
  WEBHOOK_SVC_SRC,
  'const CHANNEL = "whatsapp";',
  'const CHANNEL = "whatsapp";\nimport { decideCommunicationConsent } from "./communicationConsentDecisionService";',
  () => /decideCommunicationConsent/.test(stripTs(readF(WEBHOOK_SVC_SRC))));

// ---- Two-mode phase-boundary mutations (pure validator; NO git-dirty dependency) --------------
fnMutation("MUT Q: a seventh unrelated file in the D2-C delta is rejected",
  () => validateD2CHistoricalDelta([...D2C_EXPECTED_FILES, "services/somethingElse.ts"], D2C_BASE).length > 0);
fnMutation("MUT R: a missing approved D2-C file is rejected",
  () => validateD2CHistoricalDelta(D2C_EXPECTED_FILES.filter((f) => f !== SERVICE_SRC), D2C_BASE).length > 0);
fnMutation("MUT S: a historical D2-C delta that includes a migration is rejected",
  () => validateD2CHistoricalDelta([...D2C_EXPECTED_FILES.filter((f) => f !== DOC_SRC), "supabase/migrations/x.sql"], D2C_BASE).length > 0);
fnMutation("MUT T: a historical D2-C parent differing from the fixed base is rejected",
  () => validateD2CHistoricalDelta(D2C_EXPECTED_FILES, "0000000000000000000000000000000000000000").length > 0);
fnMutation("MUT U: a valid historical D2-C delta is accepted (future D2-D worktree files do not matter)",
  () => validateD2CHistoricalDelta(D2C_EXPECTED_FILES, D2C_BASE).length === 0);

// ---- New behavioral mutations (integrity + immutable instant + adapter) ------------------------
tsMutation("MUT V: a malformed suppression expires_at is ignored instead of an integrity failure",
  [[SERVICE_SRC, "  const exp = parseNullableTimestamp(r.expires_at);\n  if (!exp.ok) return null;", "  const exp = parseNullableTimestamp(r.expires_at);"]],
  async (mm) => { const { r } = await runWith(mm.Service, input("marketing"), { suppRaw: true, suppressions: [suppRow({ scope: "global", expires_at: "garbage" })] }); return !(r.ok === false && r.code === "AUTHORITY_INTEGRITY_VIOLATION"); });

tsMutation("MUT W: a malformed preference policy_version is treated as stale instead of integrity",
  [[SERVICE_SRC, '  if (r.state !== "allowed" && r.state !== "blocked") return null;\n  if (typeof r.policy_version !== "string" || !POLICY_VERSION_SHAPE.test(r.policy_version)) return null;', '  if (r.state !== "allowed" && r.state !== "blocked") return null;']],
  async (mm) => { const { r } = await runWith(mm.Service, input("marketing"), { preferences: [prefRow({ state: "allowed", policy_version: "bad!!" })] }); return !(r.ok === false && r.code === "AUTHORITY_INTEGRITY_VIOLATION"); });

tsMutation("MUT X: duplicate physically-active rows are only checked among EFFECTIVE rows (after expiry)",
  [[SERVICE_SRC, '  if (globals.length > 1) return { kind: "integrity" };\n  if (scoped.length > 1) return { kind: "integrity" };', '  if (globals.filter((n) => isEffective(n, evaluatedAtMs)).length > 1) return { kind: "integrity" };\n  if (scoped.filter((n) => isEffective(n, evaluatedAtMs)).length > 1) return { kind: "integrity" };']],
  async (mm) => { const { r } = await runWith(mm.Service, input("marketing"), { suppressions: [suppRow({ id: SUPP_ID, scope: "global" }), suppRow({ id: SUPP_ID_B, scope: "global", expires_at: PAST_ISO })] }); return r.ok === true && r.disposition === "blocked"; });

tsMutation("MUT Y: a valid global hides a corrupt exact-scope row (validation not applied to every row)",
  [[SERVICE_SRC, '    const n = validateSuppressionRow(r);\n    if (n === null) return { kind: "integrity" };\n    normalized.push(n);', '    const n = validateSuppressionRow(r);\n    if (n === null && r && r.scope === "global") return { kind: "integrity" };\n    if (n !== null) normalized.push(n);']],
  async (mm) => { const { r } = await runWith(mm.Service, input("marketing"), { suppRaw: true, suppressions: [suppRow({ id: SUPP_ID, scope: "global" }), suppRow({ id: SUPP_ID_B, scope: "marketing", expires_at: "garbage" })] }); return r.ok === true && r.disposition === "blocked"; });

tsMutation("MUT Z: the evaluation instant is re-read after await instead of frozen",
  [[SERVICE_SRC, "  const supp = await evaluateSuppressions(input, evaluatedAtMs, deps);", "  const supp = await evaluateSuppressions(input, (input.evaluatedAt ?? deps.now()).getTime(), deps);"]],
  async (mm) => {
    let ticks = 0; const clockNow = () => new Date(AT_MS + (ticks++) * 60_000);
    const between = new Date(AT_MS + 30_000).toISOString();
    const { r } = await runWith(mm.Service, input("marketing", { evaluatedAt: undefined }), { now: clockNow, suppressions: [suppRow({ scope: "global", expires_at: between })] });
    return r.ok === true && r.disposition !== "blocked"; // a re-read uses a later instant → expired → not blocked
  });

srcMutation("MUT AA: the production adapter adds .limit(1)",
  SERVICE_SRC,
  '.eq("is_active", true)\n        .in("scope", scopes as string[]);',
  '.eq("is_active", true)\n        .in("scope", scopes as string[])\n        .limit(1);',
  () => /\.limit\(/.test(stripTs(readF(SERVICE_SRC))));

tsMutation("MUT AB: the read normalizer ignores the error when data is present",
  [[SERVICE_SRC, "  if (res.error) throw res.error;\n  return res.data ? [...res.data] : [];", "  if (res.error && !res.data) throw res.error;\n  return res.data ? [...res.data] : [];"]],
  async (mm) => { let threw = false; try { mm.Service.normalizeSupabaseReadResult({ data: [{ id: 1 }], error: new Error("boom") }); } catch { threw = true; } return threw === false; });

tsMutation("MUT AC: weaken the timestamp validator back to Date.parse-only (drop the mandatory-timezone shape)",
  [[SERVICE_SRC, "  if (!m) return { ok: false };                               // not timezone-qualified RFC3339", "  { const _ms = Date.parse(v); if (Number.isFinite(_ms)) return { ok: true, ms: _ms }; return { ok: false }; }"]],
  async (mm) => { const { r } = await runWith(mm.Service, input("marketing"), { suppRaw: true, suppressions: [suppRow({ scope: "global", expires_at: "2026-07-11T10:30:00" })] }); return !(r.ok === false && r.code === "AUTHORITY_INTEGRITY_VIOLATION"); });

// ============================================================================
// RUNNER
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-D2-C consent decision authority checks...\n");
  for (const c of checks) { try { await c.fn(); console.log(`PASS ${c.name}`); passed++; } catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; } }
  return { passed, failed };
}
async function suiteGoesRed() { for (const c of checks) { try { await c.fn(); } catch { return true; } } return false; }
async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5F-D2-C mutation tests...\n");
  for (const mut of mutationChecks) {
    if (mut.kind === "fn") {
      try {
        const caught = await mut.scenario();
        if (caught) { console.log(`PASS ${mut.name}`); passed++; }
        else { console.log(`FAIL ${mut.name} (boundary guard did not prove load-bearing)`); failed++; }
      } catch (e) { console.log(`FAIL ${mut.name}`); console.error(e); failed++; }
      continue;
    }
    const mutDir = resolve(`.phase5fd2c-mut-${mutationChecks.indexOf(mut)}`);
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
