import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 8B-1B-A — provider-account BINDING (expand-only) harness  [V4].
 *
 * Proves the expand-only stage that gives every communication table a durable, nullable link to
 * the exact `communication_provider_accounts` row that OWNS it. Coverage:
 *
 *   • PURE ownership authority — readiness-AGNOSTIC, never first-row, fail-closed typed outcomes;
 *   • IDENTITY GRAMMAR — blank AND malformed identities (padding, control characters, over-length,
 *     wrong shape) are rejected before any query. Meta ids reuse the Phase 8B-1A grammar verbatim;
 *   • IDENTITY-ONLY PROJECTION — the resolver selects exactly id, provider_key, channel,
 *     business_account_reference, phone_number_reference. No eligibility column is ever RETRIEVED,
 *     so readiness-agnosticism is structural, not a promise;
 *   • BEHAVIOURAL resolver — driven end-to-end against a stubbed adminClient that RECORDS the query
 *     (table / select / eq-fields / eq-values / limit) and HONOURS it: it applies the recorded
 *     filters + limit to a seeded dataset of decoy accounts AND projects only the selected columns
 *     (never returning every fixture property). A resolver that drops a filter, alters a value,
 *     widens the limit, or changes the projection therefore observably breaks;
 *   • MALFORMED DB RESULTS — a non-array `data` (including null with no reported error) fails closed
 *     as query_error; only an actual empty array is not_found;
 *   • MIGRATION expand-only invariants + FAIL-CLOSED DDL — no IF NOT EXISTS / IF EXISTS drift masking.
 *
 * INVALID-SIGNATURE PRECISION (Stage A): the migration adds NO account-bound invalid-signature
 * uniqueness namespace, and the legacy rejected namespace applies ONLY where provider_account_id IS
 * NULL. The schema does NOT itself prevent application code from writing a non-null
 * provider_account_id onto an invalid-signature receipt — Phase 8B-1B-C must enforce that at
 * runtime. The same precision applies to WABA-only callbacks: Stage A defines no binding path.
 *
 * The mutation runner classifies each mutation killed / survived / infra_fail. An INFRASTRUCTURE
 * failure (missing anchor, compile failure, import failure, scenario exception, non-boolean scenario)
 * is NEVER counted as a killed mutation — it fails the harness. Four self-tests assert that.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const OWNERSHIP_SRC = "lib/communication/providers/providerAccountOwnership.ts";
const RUNTIME_SRC = "services/communicationProviderRuntimeService.ts";
const MIGRATION_SRC = "supabase/migrations/20260716000100_communication_provider_account_binding.sql";

const ENTRY_FILES = [OWNERSHIP_SRC, RUNTIME_SRC];

/** The EXACT projection ownership must select, in this exact order. */
const EXPECTED_SELECT = "id, provider_key, channel, business_account_reference, phone_number_reference";
const IDENTITY_COLUMNS = ["id", "provider_key", "channel", "business_account_reference", "phone_number_reference"];
const ELIGIBILITY_COLUMNS = [
  "readiness_status", "configuration_status", "business_verification_status",
  "phone_number_status", "webhook_status", "health_status", "billing_status",
];

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
    Ownership: req("./lib/communication/providers/providerAccountOwnership.js"),
    Runtime: req("./services/communicationProviderRuntimeService.js"),
    Supabase: req("./lib/supabase.js"),
    Gate: req("./lib/communication/providers/metaRuntimeGate.js"),
  };
}

// ============================================================================
// REGISTRY + ASSERT + SOURCE HELPERS
// ============================================================================
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const mig = () => readFileSync(resolve(MIGRATION_SRC), "utf8");
// Migration DDL with `--` line comments stripped — shape/negative assertions must inspect
// EXECUTABLE SQL only, never the descriptive header prose (which legitimately names the very
// drift-masking forms it forbids).
const stripSqlComments = (t) => t.split("\n").map((l) => { const i = l.indexOf("--"); return i === -1 ? l : l.slice(0, i); }).join("\n");
const migSql = () => stripSqlComments(mig());
const owfile = () => readFileSync(resolve(OWNERSHIP_SRC), "utf8");
const runtime = () => readFileSync(resolve(RUNTIME_SRC), "utf8");
const countOf = (text, re) => (text.match(re) || []).length;
const resolverBody = () => { const t = runtime(); return t.slice(t.indexOf("export async function resolveOwningProviderAccount")); };
// The resolver with `//` comments stripped. Structural assertions must inspect executable CODE
// only: the resolver legitimately NAMES the very forms it forbids (e.g. "(data ?? [])",
// ".maybeSingle()") in explanatory comments, and prose must never satisfy or defeat a guard.
const stripLineComments = (t) => t.split("\n").map((l) => { const i = l.indexOf("//"); return i === -1 ? l : l.slice(0, i); }).join("\n");
const resolverCode = () => stripLineComments(resolverBody());

// Seeded fixture rows model the REAL table (identity + eligibility columns). The stub projects
// only what the resolver selects, so eligibility columns exist but must never be returned.
const acct = (over = {}) => ({
  id: over.id ?? "acct-target",
  provider_key: over.provider_key ?? "meta_whatsapp_cloud",
  channel: over.channel ?? "whatsapp",
  business_account_reference: "business_account_reference" in over ? over.business_account_reference : "102290129340398",
  phone_number_reference: "phone_number_reference" in over ? over.phone_number_reference : "106540352242922",
  readiness_status: over.readiness_status ?? "ready",
  configuration_status: over.configuration_status ?? "complete",
  business_verification_status: over.business_verification_status ?? "verified",
  phone_number_status: over.phone_number_status ?? "connected",
  webhook_status: over.webhook_status ?? "subscribed",
  health_status: over.health_status ?? "healthy",
});
const TARGET = acct({ id: "acct-target" });
const DECOY_PROVIDER = acct({ id: "acct-decoy-provider", provider_key: "exotel_sms" });
const DECOY_CHANNEL = acct({ id: "acct-decoy-channel", channel: "sms" });
const DECOY_PHONE = acct({ id: "acct-decoy-phone", phone_number_reference: "999888777666555" });
const TWIN = acct({ id: "acct-twin" }); // identical identity to TARGET → broken-unique simulation
const FULL_SET = [TARGET, DECOY_PROVIDER, DECOY_CHANNEL, DECOY_PHONE];
const validInput = (over = {}) => ({
  providerKey: "meta_whatsapp_cloud", channel: "whatsapp", phoneNumberReference: "106540352242922", ...over,
});

// Control characters built from code points so this source stays clean ASCII text.
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const LF = String.fromCharCode(10);
const US = String.fromCharCode(31);

// ============================================================================
// RECORDING + FILTER-HONOURING + SELECT-HONOURING adminClient STUB.
// ============================================================================
const counters = { fromCalls: 0, fetch: 0, readinessCalls: 0, gateCalls: 0 };
const db = { rows: [] };
const rc = { error: null, mode: "resolve", hasRaw: false, raw: undefined };
const trace = { table: null, select: null, eqs: [], limit: null, maybeSingle: 0, single: 0 };
function seed(rows) { db.rows = rows; }
function setQuery(over = {}) {
  rc.error = over.error ?? null;
  rc.mode = over.mode ?? "resolve";
  rc.hasRaw = "raw" in over;
  rc.raw = over.raw;
}
function resetProbes() {
  counters.fromCalls = 0; counters.readinessCalls = 0; counters.gateCalls = 0;
  trace.table = null; trace.select = null; trace.eqs = []; trace.limit = null; trace.maybeSingle = 0; trace.single = 0;
}

/** Project a fixture row to EXACTLY the selected columns — the stub honours `.select(...)`. */
function project(row, sel) {
  if (typeof sel !== "string" || sel.trim() === "") throw new Error("stub: select() was never called with a column list");
  if (sel.trim() === "*") return { ...row }; // a real select('*') returns everything
  const cols = sel.split(",").map((c) => c.trim()).filter(Boolean);
  const out = {};
  for (const c of cols) {
    if (!(c in row)) throw new Error(`stub: selected column "${c}" does not exist on communication_provider_accounts`);
    out[c] = row[c];
  }
  return out;
}

function installResolverStubs(build) {
  build.Supabase.adminClient = () => ({
    from(table) {
      counters.fromCalls++;
      trace.table = table; trace.select = null; trace.eqs = []; trace.limit = null;
      const qb = {
        select(cols) { trace.select = cols; return qb; },
        eq(col, val) { trace.eqs.push([col, val]); return qb; },
        maybeSingle() { trace.maybeSingle++; throw new Error("ownership resolver must never call .maybeSingle()"); },
        single() { trace.single++; throw new Error("ownership resolver must never call .single()"); },
        limit(n) {
          trace.limit = n;
          if (rc.mode === "throwSync") throw new Error("synthetic synchronous DB throw");
          if (rc.mode === "reject") return Promise.reject(new Error("synthetic asynchronous DB rejection"));
          if (rc.error) return Promise.resolve({ data: null, error: rc.error });
          if (rc.hasRaw) return Promise.resolve({ data: rc.raw, error: null }); // malformed-result probe
          // HONOUR the query: apply the ACTUAL recorded filters + limit, then project to the
          // ACTUAL selected columns. Never return the whole fixture row.
          let rows = db.rows.filter((r) => trace.eqs.every(([c, v]) => r[c] === v));
          if (typeof n === "number") rows = rows.slice(0, n);
          return Promise.resolve({ data: rows.map((r) => project(r, trace.select)), error: null });
        },
      };
      return qb;
    },
  });
  // Eligibility spies: ownership resolution must never consult send-eligibility.
  const spy = (fn, counterKey) => {
    const original = build.Gate[fn];
    if (typeof original === "function") {
      build.Gate[fn] = (...args) => { counters[counterKey]++; return original(...args); };
    }
  };
  spy("evaluateProviderAccountReadiness", "readinessCalls");
  spy("evaluateMetaOutboundGate", "gateCalls");
}
const realFetch = globalThis.fetch;
globalThis.fetch = () => { counters.fetch++; return Promise.reject(new Error("network must not be called")); };
function restoreFetch() { globalThis.fetch = realFetch; }

// ============================================================================
// MAIN BUILD
// ============================================================================
const MAIN_DIR = resolve(".phase8b1ba-build-main");
compileTo(MAIN_DIR);
const M = wireBuild(MAIN_DIR);
installResolverStubs(M);

// ----------------------------------------------------------------------------
// O. PURE OWNERSHIP CLASSIFICATION
// ----------------------------------------------------------------------------
check("O1-10. classifyOwnership: 0→not_found, 1→owned, mismatch→waba_mismatch, >1→ambiguous (never first-row), readiness-agnostic", () => {
  const { classifyOwnership } = M.Ownership;
  assert(classifyOwnership([]).kind === "not_found", "empty result → not_found");
  const one = classifyOwnership([TARGET]);
  assert(one.kind === "owned" && one.account.id === "acct-target", "single row → owned with that account");
  assert(classifyOwnership([TARGET], "102290129340398").kind === "owned", "matching expected WABA → owned");
  const mm = classifyOwnership([TARGET], "900000000000001");
  assert(mm.kind === "waba_mismatch" && mm.account.id === "acct-target", "differing expected WABA → waba_mismatch");
  assert(classifyOwnership([acct({ business_account_reference: null })], "102290129340398").kind === "waba_mismatch", "null business ref vs expected WABA → waba_mismatch");
  const two = classifyOwnership([TARGET, TWIN]);
  assert(two.kind === "ambiguous" && two.count === 2, "two rows → ambiguous(2), not owned");
  assert(classifyOwnership([TARGET, TWIN, acct({ id: "c" })]).kind === "ambiguous", "three rows → ambiguous");
  assert(classifyOwnership([TARGET, TWIN], "102290129340398").kind === "ambiguous", "ambiguity decided before any WABA check");
  assert(classifyOwnership([acct({ readiness_status: "disabled", health_status: "unhealthy" })]).kind === "owned", "ownership ignores readiness/health");
  assert(classifyOwnership(null).kind === "query_error", "non-array input fails closed as query_error");
});

// ----------------------------------------------------------------------------
// V. INPUT VALIDATION — blank / type
// ----------------------------------------------------------------------------
check("V1-8. isValidOwnershipInput: valid accepted; blank provider/channel/phone rejected; blank supplied WABA rejected; non-object/non-string rejected", () => {
  const { isValidOwnershipInput } = M.Ownership;
  assert(isValidOwnershipInput(validInput()) === true, "complete input is valid");
  assert(isValidOwnershipInput(validInput({ expectedWabaId: "102290129340398" })) === true, "with a well-formed expected WABA is valid");
  assert(isValidOwnershipInput(validInput({ expectedWabaId: undefined })) === true, "expected WABA is optional");
  assert(isValidOwnershipInput(validInput({ providerKey: "" })) === false, "blank provider fails closed");
  assert(isValidOwnershipInput(validInput({ channel: "" })) === false, "blank channel fails closed");
  assert(isValidOwnershipInput(validInput({ phoneNumberReference: "" })) === false, "blank phone reference fails closed");
  assert(isValidOwnershipInput(validInput({ expectedWabaId: "" })) === false, "blank supplied WABA fails closed");
  assert(isValidOwnershipInput(validInput({ providerKey: 123 })) === false, "non-string field fails closed");
  assert(isValidOwnershipInput(null) === false, "null input fails closed");
  assert(isValidOwnershipInput(undefined) === false, "undefined input fails closed");
});

// ----------------------------------------------------------------------------
// MAL. MALFORMED IDENTITIES + grammar reuse
// ----------------------------------------------------------------------------
check("MAL1-16. malformed identities rejected: padded provider/channel/phone/WABA; control characters; malformed phone+WABA; oversized; Phase 8B-1A grammar reused, not redefined", () => {
  const { isValidOwnershipInput, OWNERSHIP_INTERNAL_ID_GRAMMAR } = M.Ownership;
  assert(isValidOwnershipInput(validInput({ providerKey: " meta_whatsapp_cloud" })) === false, "leading-padded provider key rejected (not trimmed)");
  assert(isValidOwnershipInput(validInput({ providerKey: "meta_whatsapp_cloud " })) === false, "trailing-padded provider key rejected (not trimmed)");
  assert(isValidOwnershipInput(validInput({ channel: " whatsapp" })) === false, "padded channel rejected");
  assert(isValidOwnershipInput(validInput({ channel: "whatsapp\t" })) === false, "tab-padded channel rejected");
  assert(isValidOwnershipInput(validInput({ phoneNumberReference: " 106540352242922" })) === false, "padded phone reference rejected");
  assert(isValidOwnershipInput(validInput({ phoneNumberReference: "106540352242922 " })) === false, "trailing-padded phone reference rejected");
  assert(isValidOwnershipInput(validInput({ expectedWabaId: " 102290129340398" })) === false, "padded expected WABA rejected");
  assert(isValidOwnershipInput(validInput({ providerKey: "meta" + NUL + "cloud" })) === false, "NUL control character in provider key rejected");
  assert(isValidOwnershipInput(validInput({ channel: "whats" + LF + "app" })) === false, "newline control character in channel rejected");
  assert(isValidOwnershipInput(validInput({ phoneNumberReference: "10654" + BEL + "0352242922" })) === false, "BEL control character in phone reference rejected");
  assert(isValidOwnershipInput(validInput({ expectedWabaId: "10229" + US + "0129340398" })) === false, "unit-separator control character in expected WABA rejected");
  assert(isValidOwnershipInput(validInput({ phoneNumberReference: "12ab" })) === false, "non-numeric phone reference rejected");
  assert(isValidOwnershipInput(validInput({ phoneNumberReference: "+919812345678" })) === false, "E.164-style phone reference rejected (Meta ids are opaque digits)");
  assert(isValidOwnershipInput(validInput({ expectedWabaId: "WABA_x" })) === false, "malformed expected WABA rejected");
  assert(isValidOwnershipInput(validInput({ providerKey: "a".repeat(65) })) === false, "oversized provider key rejected");
  assert(isValidOwnershipInput(validInput({ channel: "a".repeat(65) })) === false, "oversized channel rejected");
  assert(isValidOwnershipInput(validInput({ phoneNumberReference: "1".repeat(65) })) === false, "oversized phone reference rejected");
  assert(isValidOwnershipInput(validInput({ expectedWabaId: "1".repeat(65) })) === false, "oversized expected WABA rejected");
  assert(isValidOwnershipInput(validInput({ phoneNumberReference: "1".repeat(64) })) === true, "exactly 64 digits accepted (grammar boundary)");
  for (const v of ["meta_whatsapp_cloud", "exotel_sms", "mock_sms", "mock", "system", "whatsapp", "sms", "rcs"]) {
    assert(OWNERSHIP_INTERNAL_ID_GRAMMAR.test(v), `internal grammar accepts the real identifier ${v}`);
  }
  const src = owfile();
  assert(/import \{ META_CALLBACK_ID_GRAMMAR \} from "\.\/metaCallbackIdentity"/.test(src), "the Meta id grammar is IMPORTED from the Phase 8B-1A callback-identity authority");
  assert(!/=\s*\/\^\[0-9\]\{1,64\}\$\//.test(src), "no second/conflicting Meta-ID regex literal is defined in this module");
  assert(/META_CALLBACK_ID_GRAMMAR\.test\(/.test(src), "the imported Phase 8B-1A grammar is what actually validates Meta ids");
});

// ----------------------------------------------------------------------------
// PRJ. MINIMAL IDENTITY-ONLY PROJECTION (Correction 2)
// ----------------------------------------------------------------------------
check("PRJ1-8. ownership projection is IDENTITY-ONLY: exactly the 5 identity columns in exact order; no eligibility/secret column in the constant, the row type, or the returned account", async () => {
  const cols = M.Ownership.OWNING_PROVIDER_ACCOUNT_COLUMNS;
  assert(cols === EXPECTED_SELECT, `projection constant is exactly "${EXPECTED_SELECT}" (got "${cols}")`);
  assert(JSON.stringify(cols.split(",").map((c) => c.trim())) === JSON.stringify(IDENTITY_COLUMNS), "projection columns are exactly the 5 identity columns, in exact order");
  for (const bad of ELIGIBILITY_COLUMNS) assert(!cols.includes(bad), `projection never retrieves the eligibility column ${bad}`);
  for (const secret of ["token", "secret", "password", "credential"]) assert(!new RegExp(secret, "i").test(cols), `projection never selects a secret-like column (${secret})`);
  assert(!cols.includes("*"), "projection never selects '*'");
  // the ROW TYPE carries no eligibility field either
  const src = owfile();
  const iface = src.slice(src.indexOf("export interface OwningProviderAccountRow"), src.indexOf("}", src.indexOf("export interface OwningProviderAccountRow")));
  for (const bad of ELIGIBILITY_COLUMNS) assert(!iface.includes(bad), `OwningProviderAccountRow carries no ${bad} field`);
  for (const good of IDENTITY_COLUMNS) assert(iface.includes(good), `OwningProviderAccountRow carries ${good}`);
  // the RETURNED account object contains ONLY the identity columns (the stub honours select)
  resetProbes(); seed(FULL_SET); setQuery();
  const r = await M.Runtime.resolveOwningProviderAccount(validInput());
  assert(r.kind === "owned", "exact identity resolves owned");
  assert(JSON.stringify(Object.keys(r.account).sort()) === JSON.stringify([...IDENTITY_COLUMNS].sort()), `the resolved account exposes ONLY the identity columns (got ${JSON.stringify(Object.keys(r.account))})`);
  for (const bad of ELIGIBILITY_COLUMNS) assert(!(bad in r.account), `the resolved account never carries ${bad}`);
});

// ----------------------------------------------------------------------------
// RB. BEHAVIOURAL RESOLVER + EXACT QUERY TRACE
// ----------------------------------------------------------------------------
check("RB1-18. resolver behaviour + EXACT query semantics: table/select/filters/limit recorded; exact→owned; 0→not_found; >1→ambiguous; mismatch; disabled+unhealthy→owned; zero network/readiness/gate", async () => {
  const base = validInput();
  resetProbes(); seed(FULL_SET); setQuery();
  let r = await M.Runtime.resolveOwningProviderAccount(base);
  assert(r.kind === "owned" && r.account.id === "acct-target", `exact identity → owned(acct-target), got ${JSON.stringify(r)}`);
  assert(counters.fromCalls === 1, "exactly one DB query issued");
  assert(trace.table === "communication_provider_accounts", `queries communication_provider_accounts (got ${trace.table})`);
  assert(trace.select === EXPECTED_SELECT, `selects exactly "${EXPECTED_SELECT}" (got "${trace.select}")`);
  assert(JSON.stringify(trace.eqs) === JSON.stringify([
    ["provider_key", base.providerKey],
    ["channel", base.channel],
    ["phone_number_reference", base.phoneNumberReference],
  ]), `filters are exactly provider_key/channel/phone_number_reference with the input values (got ${JSON.stringify(trace.eqs)})`);
  assert(trace.eqs.length === 3, "no extra identity-altering predicate is applied");
  for (const [col] of trace.eqs) assert(!ELIGIBILITY_COLUMNS.includes(col), `no readiness/health/eligibility filter is applied (found ${col})`);
  assert(trace.limit === 2, `limit is exactly 2 (got ${trace.limit})`);
  assert(trace.maybeSingle === 0 && trace.single === 0, "neither .maybeSingle() nor .single() was attempted");
  assert(counters.readinessCalls === 0, "ZERO evaluateProviderAccountReadiness calls");
  assert(counters.gateCalls === 0, "ZERO evaluateMetaOutboundGate calls");
  // zero matches
  resetProbes(); seed(FULL_SET);
  assert((await M.Runtime.resolveOwningProviderAccount(validInput({ phoneNumberReference: "111111111111111" }))).kind === "not_found", "no matching row → not_found");
  // multiple matches → ambiguous
  resetProbes(); seed([TARGET, TWIN]);
  r = await M.Runtime.resolveOwningProviderAccount(base);
  assert(r.kind === "ambiguous" && r.count === 2, `two identical-identity rows → ambiguous(2), got ${JSON.stringify(r)}`);
  // WABA mismatch / match
  resetProbes(); seed(FULL_SET);
  assert((await M.Runtime.resolveOwningProviderAccount(validInput({ expectedWabaId: "900000000000001" }))).kind === "waba_mismatch", "expected-WABA mismatch → waba_mismatch");
  assert((await M.Runtime.resolveOwningProviderAccount(validInput({ expectedWabaId: "102290129340398" }))).kind === "owned", "matching expected WABA → owned");
  // readiness-agnostic: the underlying row is disabled/unhealthy, yet it still OWNS its identity
  resetProbes(); seed([acct({ id: "acct-disabled", readiness_status: "disabled" })]);
  assert((await M.Runtime.resolveOwningProviderAccount(base)).kind === "owned", "disabled account still resolves owned");
  seed([acct({ id: "acct-unhealthy", health_status: "unhealthy" })]);
  assert((await M.Runtime.resolveOwningProviderAccount(base)).kind === "owned", "unhealthy account still resolves owned");
  assert(counters.readinessCalls === 0 && counters.gateCalls === 0, "readiness-agnostic resolution consulted NO eligibility function");
  assert(counters.fetch === 0, "resolver made ZERO network calls");
});

// ----------------------------------------------------------------------------
// DBR. MALFORMED DATABASE RESPONSE (Correction 1)
// ----------------------------------------------------------------------------
check("DBR1-6. DB-result handling: []+no error→not_found; null+no error→query_error; object+no error→query_error; reported error→query_error; sync throw→query_error; rejection→query_error", async () => {
  const base = validInput();
  // 1. an ACTUAL empty array is the only not_found
  resetProbes(); seed(FULL_SET); setQuery();
  assert((await M.Runtime.resolveOwningProviderAccount(validInput({ phoneNumberReference: "111111111111111" }))).kind === "not_found", "[] + no error → not_found");
  // 2. null data with NO reported error is malformed → query_error (never not_found)
  resetProbes(); setQuery({ raw: null });
  assert((await M.Runtime.resolveOwningProviderAccount(base)).kind === "query_error", "null data + no error → query_error");
  // 3. a non-array object with no error → query_error
  resetProbes(); setQuery({ raw: { id: "acct-target" } });
  assert((await M.Runtime.resolveOwningProviderAccount(base)).kind === "query_error", "object data + no error → query_error");
  resetProbes(); setQuery({ raw: "not-an-array" });
  assert((await M.Runtime.resolveOwningProviderAccount(base)).kind === "query_error", "string data + no error → query_error");
  resetProbes(); setQuery({ raw: undefined });
  assert((await M.Runtime.resolveOwningProviderAccount(base)).kind === "query_error", "undefined data + no error → query_error");
  // 4. reported DB error
  resetProbes(); setQuery({ error: { message: "db boom" } });
  assert((await M.Runtime.resolveOwningProviderAccount(base)).kind === "query_error", "reported DB error → query_error");
  // 5. synchronous throw
  resetProbes(); setQuery({ mode: "throwSync" });
  assert((await M.Runtime.resolveOwningProviderAccount(base)).kind === "query_error", "synchronous throw → query_error");
  // 6. rejected query
  resetProbes(); setQuery({ mode: "reject" });
  assert((await M.Runtime.resolveOwningProviderAccount(base)).kind === "query_error", "rejected query → query_error");
  setQuery();
  // structural: the forbidden coalescing form must not exist in executable code
  const body = resolverCode();
  assert(!/data \?\? \[\]/.test(body), "the resolver never uses the (data ?? []) coalescing form");
  assert(/if \(!Array\.isArray\(data\)\) return \{ kind: "query_error" \};/.test(body), "the resolver fails closed on a non-array data result");
});

// ----------------------------------------------------------------------------
// P. OWNERSHIP MODULE SHAPE
// ----------------------------------------------------------------------------
check("P1-5. ownership module: closed 6-kind union; source proves no first-row pick / no readiness gating", () => {
  const src = owfile();
  for (const kind of ["owned", "not_found", "ambiguous", "waba_mismatch", "invalid_input", "query_error"]) {
    assert(new RegExp(`kind: "${kind}"`).test(src), `union carries the ${kind} outcome`);
  }
  const ambiguousIdx = src.indexOf('return { kind: "ambiguous"');
  const firstRowIdx = src.indexOf("const account = rows[0]");
  assert(ambiguousIdx > 0 && firstRowIdx > 0 && ambiguousIdx < firstRowIdx, "the ambiguous return precedes the single-row read (never a first-row pick)");
  const fnBody = src.slice(src.indexOf("export function classifyOwnership"));
  for (const bad of ELIGIBILITY_COLUMNS) assert(!fnBody.includes(bad), `classifyOwnership never consults ${bad}`);
});

// ----------------------------------------------------------------------------
// R. RESOLVER STRUCTURE
// ----------------------------------------------------------------------------
check("R1-10. resolver structure: exported, validate-first, .limit(2)/no maybeSingle, error+malformed+catch→query_error, classifyOwnership, identity-only projection, no process.env, no eligibility; send path untouched", () => {
  const body = resolverCode();
  assert(/export async function resolveOwningProviderAccount\(/.test(body), "the resolver is exported");
  const validateIdx = body.indexOf("isValidOwnershipInput(input)");
  const queryIdx = body.indexOf("adminClient()");
  assert(validateIdx > 0 && queryIdx > 0 && validateIdx < queryIdx, "input is validated before the DB query");
  assert(/return \{ kind: "invalid_input" \}/.test(body), "invalid input returns the typed invalid_input outcome");
  assert(/\.limit\(2\)/.test(body), "the resolver bounds the fetch with .limit(2)");
  assert(!/maybeSingle/.test(body), "the resolver never uses .maybeSingle()");
  assert(countOf(body, /return \{ kind: "query_error" \}/g) >= 3, "error, malformed-data and catch branches all return query_error");
  assert(/if \(error\) return \{ kind: "query_error" \}/.test(body), "a DB error returns query_error");
  assert(/catch \{[\s\S]*?return \{ kind: "query_error" \}/.test(body), "a thrown exception returns query_error");
  assert(/classifyOwnership\(/.test(body), "the resolver delegates the row-count/WABA decision to classifyOwnership");
  assert(/\.select\(OWNING_PROVIDER_ACCOUNT_COLUMNS\)/.test(body), "the resolver selects the explicit identity-only projection constant");
  assert(!/select\(\s*["'`]\*/.test(body), "the resolver never selects '*'");
  assert(!/token|secret|password|credential/i.test(body), "the resolver body references no secret-like identifier");
  assert(!/process\.env/.test(body), "the resolver never falls back to environment configuration");
  assert(!/evaluateProviderAccountReadiness\(|evaluateMetaOutboundGate\(/.test(body), "the resolver never calls a send-eligibility function");
  for (const bad of ELIGIBILITY_COLUMNS) assert(!body.includes(bad), `the resolver body never references ${bad}`);
  const full = runtime();
  assert(/export async function fetchProviderAccount\([\s\S]*?\.maybeSingle\(\)/.test(full), "the send-path fetchProviderAccount is unchanged (still .maybeSingle())");
  assert(/export async function evaluateMetaOutboundGateForMessage\(/.test(full), "the outbound send gate is preserved");
});

// ----------------------------------------------------------------------------
// M. MIGRATION
// ----------------------------------------------------------------------------
const BOUND_TABLES = [
  "communication_messages", "communication_delivery_events", "communication_webhook_receipts",
  "communication_inbound_messages", "communication_consent_ack_intents",
];
const PREDECESSOR_INDEXES = [
  "uq_comm_delivery_event_provider_event",
  "uq_comm_webhook_receipt_provider_event",
  "uq_comm_webhook_receipt_payload_verified",
  "uq_comm_webhook_receipt_payload_rejected",
  "uq_comm_inbound_provider_message",
];

check("M1-2. filename timestamp monotonic (> 20260713000100); only the five authorized tables altered; provider_accounts never altered", () => {
  assert(/20260716000100_/.test(MIGRATION_SRC) && 20260716000100 > 20260713000100, "migration timestamp is monotonic");
  const t = migSql();
  const altered = new Set([...t.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]));
  assert(altered.size === 5, `exactly five tables are altered (got ${[...altered].join(", ")})`);
  for (const tbl of BOUND_TABLES) assert(altered.has(tbl), `${tbl} is one of the altered tables`);
  assert(!/alter table public\.communication_provider_accounts/.test(t), "communication_provider_accounts is never altered");
  assert(!/create table/i.test(t) && !/drop table/i.test(t), "expand-only: no CREATE TABLE / DROP TABLE");
});

check("M3-4. five nullable provider_account_id FKs → provider_accounts(id) ON DELETE RESTRICT; no NOT NULL/DEFAULT/CHECK/TRIGGER/BACKFILL/SET NULL", () => {
  const t = migSql();
  assert(countOf(t, /add column provider_account_id uuid/g) === 5, "five provider_account_id columns are added");
  for (const tbl of BOUND_TABLES) {
    assert(new RegExp(`alter table public\\.${tbl}\\s*\\n\\s*add column provider_account_id uuid\\s*\\n\\s*references public\\.communication_provider_accounts\\(id\\) on delete restrict;`).test(t), `${tbl} gains a nullable FK to communication_provider_accounts(id) ON DELETE RESTRICT`);
  }
  assert(countOf(t, /references public\.communication_provider_accounts\(id\) on delete restrict/g) === 5, "all five FKs target communication_provider_accounts(id) with ON DELETE RESTRICT");
  assert(countOf(t, /on delete restrict/g) === 5, "exactly five ON DELETE RESTRICT clauses");
  assert(!/on delete cascade/i.test(t) && !/on delete set null/i.test(t), "no ON DELETE CASCADE / SET NULL");
  assert(!/provider_account_id uuid[^;]*not null/i.test(t), "no NOT NULL on the new column");
  assert(!/provider_account_id uuid[^;]*default/i.test(t), "no DEFAULT on the new column");
  assert(!/set not null/i.test(t), "no SET NOT NULL anywhere");
  assert(!/check\s*\([^)]*provider_account_id/i.test(t), "no CHECK constraint references provider_account_id");
  assert(!/create trigger/i.test(t), "no trigger is created");
  assert(!/update\s+public\.communication_\w+\s+set\s+provider_account_id/i.test(t), "no backfill UPDATE of provider_account_id");
  assert(!/insert\s+into/i.test(t), "no INSERT");
});

check("M5. messages KEEP idempotency + non-unique provider index; ADD account-scoped provider-message unique; business idempotency_key NOT account-scoped", () => {
  const t = migSql();
  assert(!/drop index[^;]*idempotency/i.test(t), "the messages idempotency authority is never dropped");
  assert(!/drop index[^;]*idx_communication_messages_provider_message/i.test(t), "the existing non-unique provider-message index is never dropped");
  assert(/create unique index uq_comm_message_account_provider_message\s*\n\s*on public\.communication_messages\(provider_account_id, provider_message_id\)\s*\n\s*where provider_account_id is not null and provider_message_id is not null;/.test(t), "an account-scoped (provider_account_id, provider_message_id) unique is added for messages");
  assert(!/communication_messages\(provider_account_id, idempotency_key\)/i.test(t), "the BUSINESS idempotency_key is NOT auto-scoped per account");
});

check("M6. delivery_events + inbound_messages: paired legacy(null)/bound(not null) uniques replace the old provider-scoped unique, no protection gap", () => {
  const t = migSql();
  assert(/uq_comm_delivery_event_provider_event_legacy[\s\S]*?provider, provider_event_id, provider_message_id, normalized_event_type[\s\S]*?where provider_event_id is not null and provider_account_id is null;/.test(t), "delivery legacy unique preserves the original predicate + provider_account_id is null");
  assert(/uq_comm_delivery_event_account_event[\s\S]*?provider_account_id, provider_event_id, provider_message_id, normalized_event_type[\s\S]*?where provider_event_id is not null and provider_account_id is not null;/.test(t), "delivery bound unique is account-scoped");
  assert(/uq_comm_inbound_provider_message_legacy[\s\S]*?communication_inbound_messages\(provider, provider_message_id\)[\s\S]*?where provider_account_id is null;/.test(t), "inbound legacy unique is provider-scoped, unbound rows only");
  assert(/uq_comm_inbound_account_message[\s\S]*?communication_inbound_messages\(provider_account_id, provider_message_id\)[\s\S]*?where provider_account_id is not null;/.test(t), "inbound bound unique is account-scoped");
  for (const [legacy, drop] of [
    ["uq_comm_delivery_event_provider_event_legacy", "drop index public.uq_comm_delivery_event_provider_event;"],
    ["uq_comm_inbound_provider_message_legacy", "drop index public.uq_comm_inbound_provider_message;"],
  ]) {
    assert(t.indexOf(legacy) < t.indexOf(drop) && t.indexOf(drop) > 0, `${legacy} is created before ${drop} (no window without protection), and the original IS dropped`);
  }
});

check("M7. webhook_receipts: valid-signature namespaces paired; NO account-bound invalid-signature namespace exists (Stage A declines one; it does not prevent a non-null write — 8B-1B-C enforces that at runtime)", () => {
  const t = migSql();
  assert(/uq_comm_webhook_receipt_provider_event_legacy[\s\S]*?where signature_valid and provider_event_id is not null and provider_account_id is null;/.test(t), "receipt provider_event legacy preserves its predicate, unbound rows only");
  assert(/uq_comm_webhook_receipt_account_event[\s\S]*?provider_account_id, provider_event_id[\s\S]*?where signature_valid and provider_event_id is not null and provider_account_id is not null;/.test(t), "receipt provider_event bound is account-scoped");
  assert(t.indexOf("uq_comm_webhook_receipt_provider_event_legacy") < t.indexOf("drop index public.uq_comm_webhook_receipt_provider_event;"), "receipt provider_event replacement precedes its drop");
  assert(/uq_comm_webhook_receipt_payload_verified_legacy[\s\S]*?where signature_valid and provider_account_id is null;/.test(t), "receipt payload_verified legacy preserves signature_valid, unbound rows only");
  assert(/uq_comm_webhook_receipt_payload_verified_account[\s\S]*?where signature_valid and provider_account_id is not null;/.test(t), "receipt payload_verified bound is account-scoped");
  assert(t.indexOf("uq_comm_webhook_receipt_payload_verified_legacy") < t.indexOf("drop index public.uq_comm_webhook_receipt_payload_verified;"), "receipt payload_verified replacement precedes its drop");
  assert(/uq_comm_webhook_receipt_payload_rejected_unbound[\s\S]*?where not signature_valid and provider_account_id is null;/.test(t), "the legacy rejected namespace applies ONLY where provider_account_id IS NULL");
  assert(!/not signature_valid and provider_account_id is not null/.test(t), "NO account-bound invalid-signature uniqueness namespace exists (Stage A declines one; runtime enforcement is Phase 8B-1B-C's responsibility)");
});

check("M8. idempotency authorities untouched: no ack idempotency drop; ack gains NO account-scoped UNIQUE (only a lookup index)", () => {
  const t = migSql();
  assert(!/drop index[^;]*uq_consent_ack_intent_idempotency/i.test(t), "the ack idempotency authority is never dropped");
  assert(!/create unique index[^;]*communication_consent_ack_intents/i.test(t), "ack_intents gains NO account-scoped UNIQUE in A");
  assert(/create index idx_comm_ack_intent_provider_account\s*\n\s*on public\.communication_consent_ack_intents\(provider_account_id\)\s*\n\s*where provider_account_id is not null;/.test(t), "ack_intents gains a plain account lookup index only");
});

check("M9. supporting account indexes exist exactly where a bound row falls outside every account-leading index (messages + delivery_events REQUIRED; inbound/receipts correctly omitted)", () => {
  const t = migSql();
  assert(/create index idx_comm_delivery_event_provider_account\s*\n\s*on public\.communication_delivery_events\(provider_account_id\)\s*\n\s*where provider_account_id is not null;/.test(t), "delivery_events has the plain partial account index on (provider_account_id) where provider_account_id is not null");
  assert(!/create unique index idx_comm_delivery_event_provider_account/.test(t), "the delivery_events account index is PLAIN (non-unique)");
  assert(/create index idx_communication_messages_provider_account\s*\n\s*on public\.communication_messages\(provider_account_id\)\s*\n\s*where provider_account_id is not null;/.test(t), "messages has the plain partial account index");
  assert(!/idx_comm_inbound_provider_account/.test(t), "inbound_messages gets NO redundant plain account index (its bound unique is account-leading and covers every bound row)");
  assert(!/idx_comm_webhook_receipt_provider_account/.test(t), "webhook_receipts gets NO redundant plain account index (payload_hash is NOT NULL, so the bound verified unique covers every bound valid-signature row)");
});

check("M10. FAIL CLOSED ON DRIFT: executable SQL contains no IF NOT EXISTS / IF EXISTS drift masking, and every predecessor authority is dropped unconditionally", () => {
  const t = migSql();
  assert(!/add column if not exists provider_account_id/i.test(t), "no ADD COLUMN IF NOT EXISTS provider_account_id");
  assert(!/create index if not exists/i.test(t), "no CREATE INDEX IF NOT EXISTS");
  assert(!/create unique index if not exists/i.test(t), "no CREATE UNIQUE INDEX IF NOT EXISTS");
  assert(!/drop index if exists/i.test(t), "no DROP INDEX IF EXISTS");
  assert(!/if not exists/i.test(t), "no IF NOT EXISTS anywhere in executable SQL");
  assert(!/if exists/i.test(t), "no IF EXISTS anywhere in executable SQL");
  for (const idx of PREDECESSOR_INDEXES) {
    assert(new RegExp(`drop index public\\.${idx};`).test(t), `predecessor ${idx} is dropped unconditionally (a missing authority must abort)`);
  }
  assert(countOf(t, /drop index public\./g) === 5, "exactly the five predecessor indexes are dropped");
});

// ============================================================================
// MUTATIONS + evaluateMutation
// ============================================================================
const mutations = [];
function mutate(name, edits, scenario) { mutations.push({ name, edits, scenario }); }
let mutSeq = 0;
async function suiteGoesRed() { for (const c of checks) { try { await c.fn(); } catch { return true; } } return false; }

async function evaluateMutation(mut) {
  const tsTouched = mut.edits.some((e) => e[0].endsWith(".ts"));
  const mutDir = resolve(`.phase8b1ba-mut-${mutSeq++}`);
  const originals = new Map();
  for (const edit of mut.edits) { const p = resolve(edit[0]); if (!originals.has(p)) originals.set(p, readFileSync(p, "utf8")); }
  try {
    for (const edit of mut.edits) {
      const p = resolve(edit[0]);
      const cur = readFileSync(p, "utf8");
      if (!cur.includes(edit[1])) return "infra_fail:anchor";
      writeFileSync(p, cur.replace(edit[1], edit[2]));
    }
    let mm = M;
    if (tsTouched) {
      let outDir;
      try { outDir = compileTo(mutDir); } catch { return "infra_fail:compile"; }
      try { mm = wireBuild(outDir); installResolverStubs(mm); } catch { return "infra_fail:import"; }
    }
    let detected;
    try { detected = await mut.scenario(mm); } catch { return "infra_fail:scenario_threw"; }
    if (typeof detected !== "boolean") return "infra_fail:non_boolean";
    if (detected) return "killed";
    return (await suiteGoesRed()) ? "killed" : "survived";
  } finally {
    for (const [p, original] of originals) writeFileSync(p, original);
    rmSync(mutDir, { recursive: true, force: true });
    setQuery(); installResolverStubs(M);
  }
}

// --- PURE MODULE -------------------------------------------------------------
mutate("OWN-1. classifyOwnership selects the first row on a >1 (ambiguous) result",
  [[OWNERSHIP_SRC, '  if (rows.length > 1) return { kind: "ambiguous", count: rows.length };', '  if (rows.length > 1 && false) return { kind: "ambiguous", count: rows.length };']],
  (mm) => mm.Ownership.classifyOwnership([TARGET, TWIN]).kind !== "ambiguous");

mutate("OWN-2. classifyOwnership treats a WABA mismatch as owned",
  [[OWNERSHIP_SRC, '  if (expectedWabaId !== undefined && account.business_account_reference !== expectedWabaId) {', '  if (expectedWabaId !== undefined && account.business_account_reference !== expectedWabaId && false) {']],
  (mm) => mm.Ownership.classifyOwnership([TARGET], "900000000000001").kind !== "waba_mismatch");

// --- MALFORMED DB RESULT (Correction 1) --------------------------------------
mutate("DBR-1. resolver restores the (data ?? []) coalescing form",
  [[RUNTIME_SRC, '    if (!Array.isArray(data)) return { kind: "query_error" };\n\n    return classifyOwnership(\n      data as OwningProviderAccountRow[],\n      input.expectedWabaId\n    );', '    return classifyOwnership((data ?? []) as unknown as OwningProviderAccountRow[], input.expectedWabaId);']],
  async (mm) => { resetProbes(); setQuery({ raw: null }); const r = await mm.Runtime.resolveOwningProviderAccount(validInput()); setQuery(); return r.kind !== "query_error"; });

mutate("DBR-2. resolver treats null data as an empty result",
  [[RUNTIME_SRC, '    if (!Array.isArray(data)) return { kind: "query_error" };', '    if (!Array.isArray(data)) return classifyOwnership([], input.expectedWabaId);']],
  async (mm) => { resetProbes(); setQuery({ raw: null }); const r = await mm.Runtime.resolveOwningProviderAccount(validInput()); setQuery(); return r.kind !== "query_error"; });

mutate("DBR-3. resolver treats malformed data as not_found",
  [[RUNTIME_SRC, '    if (!Array.isArray(data)) return { kind: "query_error" };', '    if (!Array.isArray(data)) return { kind: "not_found" };']],
  async (mm) => { resetProbes(); setQuery({ raw: { id: "x" } }); const r = await mm.Runtime.resolveOwningProviderAccount(validInput()); setQuery(); return r.kind !== "query_error"; });

mutate("RES-1. resolver treats a DB result error as not_found",
  [[RUNTIME_SRC, '    if (error) return { kind: "query_error" };', '    if (error) return { kind: "not_found" };']],
  async (mm) => { resetProbes(); setQuery({ error: { message: "boom" } }); const r = await mm.Runtime.resolveOwningProviderAccount(validInput()); setQuery(); return r.kind !== "query_error"; });

mutate("RES-2. resolver treats a thrown query exception as not_found",
  [[RUNTIME_SRC, '  } catch {\n    return { kind: "query_error" };\n  }', '  } catch {\n    return { kind: "not_found" };\n  }']],
  async (mm) => { resetProbes(); setQuery({ mode: "reject" }); const r = await mm.Runtime.resolveOwningProviderAccount(validInput()); setQuery(); return r.kind !== "query_error"; });

mutate("RES-3. resolver removes the invalid-input fail-closed guard (malformed identity reaches the DB)",
  [[RUNTIME_SRC, '  if (!isValidOwnershipInput(input)) return { kind: "invalid_input" };', '  if (!isValidOwnershipInput(input) && false) return { kind: "invalid_input" };']],
  async (mm) => { resetProbes(); seed(FULL_SET); setQuery(); const r = await mm.Runtime.resolveOwningProviderAccount(validInput({ phoneNumberReference: "12ab" })); return r.kind !== "invalid_input" || counters.fromCalls > 0; });

mutate("RES-4. resolver falls back to process.env",
  [[RUNTIME_SRC, '  if (!isValidOwnershipInput(input)) return { kind: "invalid_input" };\n  try {', '  if (!isValidOwnershipInput(input)) return { kind: "invalid_input" };\n  try {\n    if (process.env.OWNERSHIP_BYPASS === "1") return { kind: "query_error" };']],
  () => /process\.env/.test(resolverBody()));

// --- QUERY PREDICATE ---------------------------------------------------------
mutate("QRY-1. resolver drops the provider_key filter",
  [[RUNTIME_SRC, '      .eq("provider_key", input.providerKey)\n', '']],
  async (mm) => { resetProbes(); seed(FULL_SET); setQuery(); return (await mm.Runtime.resolveOwningProviderAccount(validInput())).kind !== "owned"; });

mutate("QRY-2. resolver drops the channel filter",
  [[RUNTIME_SRC, '      .eq("channel", input.channel)\n', '']],
  async (mm) => { resetProbes(); seed(FULL_SET); setQuery(); return (await mm.Runtime.resolveOwningProviderAccount(validInput())).kind !== "owned"; });

mutate("QRY-3. resolver drops the phone_number_reference filter",
  [[RUNTIME_SRC, '      .eq("phone_number_reference", input.phoneNumberReference)\n', '']],
  async (mm) => { resetProbes(); seed(FULL_SET); setQuery(); return (await mm.Runtime.resolveOwningProviderAccount(validInput())).kind !== "owned"; });

mutate("QRY-4. resolver replaces the phone value with a constant/default instead of the caller's identity",
  [[RUNTIME_SRC, '.eq("phone_number_reference", input.phoneNumberReference)', '.eq("phone_number_reference", "000000000000000")']],
  async (mm) => { resetProbes(); seed(FULL_SET); setQuery(); return (await mm.Runtime.resolveOwningProviderAccount(validInput())).kind !== "owned"; });

mutate("QRY-5. resolver narrows limit(2) to limit(1) (ambiguity becomes invisible)",
  [[RUNTIME_SRC, '      .limit(2);', '      .limit(1);']],
  async (mm) => { resetProbes(); seed([TARGET, TWIN]); setQuery(); return (await mm.Runtime.resolveOwningProviderAccount(validInput())).kind !== "ambiguous"; });

mutate("QRY-6. resolver renames a filter column (provider_key → provider)",
  [[RUNTIME_SRC, '.eq("provider_key", input.providerKey)', '.eq("provider", input.providerKey)']],
  async (mm) => { resetProbes(); seed(FULL_SET); setQuery(); return (await mm.Runtime.resolveOwningProviderAccount(validInput())).kind !== "owned"; });

mutate("QRY-7. resolver adds a readiness eligibility filter to ownership resolution",
  [[RUNTIME_SRC, '      .eq("phone_number_reference", input.phoneNumberReference)\n', '      .eq("phone_number_reference", input.phoneNumberReference)\n      .eq("readiness_status", "ready")\n']],
  async (mm) => { resetProbes(); seed(FULL_SET); setQuery(); await mm.Runtime.resolveOwningProviderAccount(validInput()); return trace.eqs.length !== 3 || trace.eqs.some(([c]) => ELIGIBILITY_COLUMNS.includes(c)); });

mutate("QRY-8. resolver adds a health eligibility filter to ownership resolution",
  [[RUNTIME_SRC, '      .eq("phone_number_reference", input.phoneNumberReference)\n', '      .eq("phone_number_reference", input.phoneNumberReference)\n      .eq("health_status", "healthy")\n']],
  async (mm) => { resetProbes(); seed(FULL_SET); setQuery(); await mm.Runtime.resolveOwningProviderAccount(validInput()); return trace.eqs.length !== 3 || trace.eqs.some(([c]) => ELIGIBILITY_COLUMNS.includes(c)); });

// --- PROJECTION (Correction 2) -----------------------------------------------
mutate("PRJ-1. readiness_status is added to the ownership projection",
  [[OWNERSHIP_SRC, '  "id, provider_key, channel, business_account_reference, phone_number_reference";', '  "id, provider_key, channel, business_account_reference, phone_number_reference, readiness_status";']],
  async (mm) => { resetProbes(); seed(FULL_SET); setQuery(); await mm.Runtime.resolveOwningProviderAccount(validInput()); return trace.select !== EXPECTED_SELECT; });

mutate("PRJ-2. health_status is added to the ownership projection",
  [[OWNERSHIP_SRC, '  "id, provider_key, channel, business_account_reference, phone_number_reference";', '  "id, provider_key, channel, business_account_reference, phone_number_reference, health_status";']],
  async (mm) => { resetProbes(); seed(FULL_SET); setQuery(); await mm.Runtime.resolveOwningProviderAccount(validInput()); return trace.select !== EXPECTED_SELECT; });

mutate("PRJ-3. the projection becomes select('*')",
  [[OWNERSHIP_SRC, '  "id, provider_key, channel, business_account_reference, phone_number_reference";', '  "*";']],
  async (mm) => { resetProbes(); seed(FULL_SET); setQuery(); const r = await mm.Runtime.resolveOwningProviderAccount(validInput()); return trace.select !== EXPECTED_SELECT || (r.kind === "owned" && "readiness_status" in r.account); });

mutate("PRJ-4. id is removed from the ownership projection",
  [[OWNERSHIP_SRC, '  "id, provider_key, channel, business_account_reference, phone_number_reference";', '  "provider_key, channel, business_account_reference, phone_number_reference";']],
  async (mm) => { resetProbes(); seed(FULL_SET); setQuery(); const r = await mm.Runtime.resolveOwningProviderAccount(validInput()); return trace.select !== EXPECTED_SELECT || (r.kind === "owned" && r.account.id === undefined); });

mutate("PRJ-5. business_account_reference is removed from the ownership projection",
  [[OWNERSHIP_SRC, '  "id, provider_key, channel, business_account_reference, phone_number_reference";', '  "id, provider_key, channel, phone_number_reference";']],
  async (mm) => { resetProbes(); seed(FULL_SET); setQuery(); const r = await mm.Runtime.resolveOwningProviderAccount(validInput({ expectedWabaId: "102290129340398" })); return trace.select !== EXPECTED_SELECT || r.kind !== "owned"; });

// --- IDENTITY GRAMMAR --------------------------------------------------------
mutate("GRM-1. internal identifier grammar widened to accept anything (padding/control characters)",
  [[OWNERSHIP_SRC, 'export const OWNERSHIP_INTERNAL_ID_GRAMMAR = /^[a-z][a-z0-9_]{0,63}$/;', 'export const OWNERSHIP_INTERNAL_ID_GRAMMAR = /^[\\s\\S]*$/;']],
  (mm) => mm.Ownership.isValidOwnershipInput(validInput({ providerKey: " meta_whatsapp_cloud" })) === true);

mutate("GRM-2. internal identifier grammar loses its length bound (oversized accepted)",
  [[OWNERSHIP_SRC, 'export const OWNERSHIP_INTERNAL_ID_GRAMMAR = /^[a-z][a-z0-9_]{0,63}$/;', 'export const OWNERSHIP_INTERNAL_ID_GRAMMAR = /^[a-z][a-z0-9_]*$/;']],
  (mm) => mm.Ownership.isValidOwnershipInput(validInput({ providerKey: "a".repeat(65) })) === true);

mutate("GRM-3. internal identifier check silently TRIMS instead of rejecting padding",
  [[OWNERSHIP_SRC, '  return typeof v === "string" && OWNERSHIP_INTERNAL_ID_GRAMMAR.test(v);', '  return typeof v === "string" && OWNERSHIP_INTERNAL_ID_GRAMMAR.test(v.trim());']],
  (mm) => mm.Ownership.isValidOwnershipInput(validInput({ providerKey: " meta_whatsapp_cloud " })) === true);

mutate("GRM-4. Meta id check bypasses the Phase 8B-1A grammar (malformed phone/WABA accepted)",
  [[OWNERSHIP_SRC, '  return typeof v === "string" && META_CALLBACK_ID_GRAMMAR.test(v);', '  return typeof v === "string" && v.length > 0;']],
  (mm) => mm.Ownership.isValidOwnershipInput(validInput({ phoneNumberReference: "12ab" })) === true);

mutate("GRM-5. the expectedWabaId grammar check is dropped",
  [[OWNERSHIP_SRC, '  if (input.expectedWabaId !== undefined && !isMetaId(input.expectedWabaId)) return false;', '  if (input.expectedWabaId !== undefined && !isMetaId(input.expectedWabaId) && false) return false;']],
  (mm) => mm.Ownership.isValidOwnershipInput(validInput({ expectedWabaId: "WABA_x" })) === true);

mutate("GRM-6. phone grammar rejection replaced by query execution (malformed identity is queried)",
  [[OWNERSHIP_SRC, '  if (!isMetaId(input.phoneNumberReference)) return false;', '  if (!isMetaId(input.phoneNumberReference) && false) return false;']],
  async (mm) => { resetProbes(); seed(FULL_SET); setQuery(); const r = await mm.Runtime.resolveOwningProviderAccount(validInput({ phoneNumberReference: "12ab" })); return r.kind !== "invalid_input" || counters.fromCalls > 0; });

// --- MIGRATION ---------------------------------------------------------------
mutate("SQL-1. one provider_account_id column is removed",
  [[MIGRATION_SRC, 'alter table public.communication_messages\n  add column provider_account_id uuid\n    references public.communication_provider_accounts(id) on delete restrict;\n\n', '']],
  () => countOf(migSql(), /add column provider_account_id uuid/g) !== 5);

mutate("SQL-2. one FK is removed (column kept, no REFERENCES)",
  [[MIGRATION_SRC, 'add column provider_account_id uuid\n    references public.communication_provider_accounts(id) on delete restrict;', 'add column provider_account_id uuid;']],
  () => countOf(migSql(), /references public\.communication_provider_accounts\(id\) on delete restrict/g) !== 5);

mutate("SQL-3. one FK target is changed away from communication_provider_accounts",
  [[MIGRATION_SRC, 'references public.communication_provider_accounts(id) on delete restrict;', 'references public.communication_messages(id) on delete restrict;']],
  () => countOf(migSql(), /references public\.communication_provider_accounts\(id\)/g) !== 5);

mutate("SQL-4. a FK ON DELETE RESTRICT is changed to CASCADE",
  [[MIGRATION_SRC, 'references public.communication_provider_accounts(id) on delete restrict;', 'references public.communication_provider_accounts(id) on delete cascade;']],
  () => { const t = migSql(); return countOf(t, /on delete restrict/g) !== 5 || /on delete cascade/i.test(t); });

mutate("SQL-5. an account-bound IS NOT NULL predicate is removed (delivery bound index)",
  [[MIGRATION_SRC, '  where provider_event_id is not null and provider_account_id is not null;', '  where provider_event_id is not null;']],
  () => !/uq_comm_delivery_event_account_event[\s\S]*?provider_account_id is not null/.test(migSql()));

mutate("SQL-6. a legacy IS NULL predicate is removed (delivery legacy index)",
  [[MIGRATION_SRC, '  where provider_event_id is not null and provider_account_id is null;', '  where provider_event_id is not null;']],
  () => !/uq_comm_delivery_event_provider_event_legacy[\s\S]*?provider_account_id is null/.test(migSql()));

mutate("SQL-7. provider-wide uniqueness is left applying to newly bound rows (original delivery unique not dropped)",
  [[MIGRATION_SRC, '\ndrop index public.uq_comm_delivery_event_provider_event;', '']],
  () => !/drop index public\.uq_comm_delivery_event_provider_event;/.test(migSql()));

mutate("SQL-8. communication_messages.idempotency_key is account-scoped",
  [[MIGRATION_SRC, '  where provider_account_id is not null and provider_message_id is not null;', '  where provider_account_id is not null and provider_message_id is not null;\ncreate unique index uq_comm_message_account_idempotency\n  on public.communication_messages(provider_account_id, idempotency_key)\n  where provider_account_id is not null;']],
  () => /communication_messages\(provider_account_id, idempotency_key\)/.test(migSql()));

mutate("SQL-9. acknowledgement-intent idempotency is account-scoped prematurely",
  [[MIGRATION_SRC,
    'create index idx_comm_ack_intent_provider_account\n  on public.communication_consent_ack_intents(provider_account_id)\n  where provider_account_id is not null;',
    'create unique index uq_comm_ack_intent_account_idempotency\n  on public.communication_consent_ack_intents(provider_account_id, idempotency_key)\n  where provider_account_id is not null;']],
  () => /create unique index[^;]*communication_consent_ack_intents/i.test(migSql()));

mutate("SQL-10. a historical UPDATE/backfill is introduced",
  [[MIGRATION_SRC, '-- 3e) communication_consent_ack_intents — nullable FK + account lookup index ONLY (added above).', "update public.communication_messages set provider_account_id = '00000000-0000-0000-0000-000000000000';\n-- 3e)"]],
  () => /update\s+public\.communication_\w+\s+set\s+provider_account_id/i.test(migSql()));

mutate("SQL-11. a DEFAULT provider_account_id is introduced",
  [[MIGRATION_SRC, 'add column provider_account_id uuid\n    references public.communication_provider_accounts(id) on delete restrict;', "add column provider_account_id uuid default '00000000-0000-0000-0000-000000000000'\n    references public.communication_provider_accounts(id) on delete restrict;"]],
  () => /provider_account_id uuid[^;]*default/i.test(migSql()));

mutate("SQL-12. a SET NOT NULL is introduced",
  [[MIGRATION_SRC, '-- 3e) communication_consent_ack_intents — nullable FK + account lookup index ONLY (added above).', 'alter table public.communication_messages alter column provider_account_id set not null;\n-- 3e)']],
  () => /set not null/i.test(migSql()));

mutate("SQL-13. a lifecycle CHECK is introduced",
  [[MIGRATION_SRC, '-- 3e) communication_consent_ack_intents — nullable FK + account lookup index ONLY (added above).', 'alter table public.communication_messages add constraint chk_msg_bound check (provider_account_id is not null);\n-- 3e)']],
  () => /check\s*\([^)]*provider_account_id/i.test(migSql()));

mutate("SQL-14. an account-bound invalid-signature uniqueness namespace is added",
  [[MIGRATION_SRC,
    'create unique index uq_comm_webhook_receipt_payload_rejected_unbound\n  on public.communication_webhook_receipts(provider, payload_hash)\n  where not signature_valid and provider_account_id is null;',
    'create unique index uq_comm_webhook_receipt_payload_rejected_unbound\n  on public.communication_webhook_receipts(provider, payload_hash)\n  where not signature_valid and provider_account_id is null;\ncreate unique index uq_comm_webhook_receipt_rejected_account\n  on public.communication_webhook_receipts(provider_account_id, payload_hash)\n  where not signature_valid and provider_account_id is not null;']],
  () => /not signature_valid and provider_account_id is not null/.test(migSql()));

mutate("SQL-15. a communication_provider_accounts column is added/altered",
  [[MIGRATION_SRC, '-- 3e) communication_consent_ack_intents — nullable FK + account lookup index ONLY (added above).', 'alter table public.communication_provider_accounts add column ownership_probe text;\n-- 3e)']],
  () => /alter table public\.communication_provider_accounts/.test(migSql()));

mutate("SQL-16. the delivery_events supporting account index is removed (bound rows with a NULL provider_event_id lose all account-leading coverage)",
  [[MIGRATION_SRC, 'create index idx_comm_delivery_event_provider_account\n  on public.communication_delivery_events(provider_account_id)\n  where provider_account_id is not null;\n', '']],
  () => !/idx_comm_delivery_event_provider_account/.test(migSql()));

// --- DRIFT MASKING (Correction 3) --------------------------------------------
mutate("SQL-17. ADD COLUMN IF NOT EXISTS drift masking is reintroduced",
  [[MIGRATION_SRC, '  add column provider_account_id uuid\n', '  add column if not exists provider_account_id uuid\n']],
  () => /add column if not exists provider_account_id/i.test(migSql()));

mutate("SQL-18. CREATE INDEX IF NOT EXISTS drift masking is reintroduced",
  [[MIGRATION_SRC, 'create index idx_communication_messages_provider_account', 'create index if not exists idx_communication_messages_provider_account']],
  () => /create index if not exists/i.test(migSql()));

mutate("SQL-19. CREATE UNIQUE INDEX IF NOT EXISTS drift masking is reintroduced",
  [[MIGRATION_SRC, 'create unique index uq_comm_message_account_provider_message', 'create unique index if not exists uq_comm_message_account_provider_message']],
  () => /create unique index if not exists/i.test(migSql()));

mutate("SQL-20. DROP INDEX IF EXISTS drift masking is reintroduced",
  [[MIGRATION_SRC, 'drop index public.uq_comm_delivery_event_provider_event;', 'drop index if exists public.uq_comm_delivery_event_provider_event;']],
  () => /drop index if exists/i.test(migSql()));

// ============================================================================
// EXECUTE
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 8B-1B-A (V4) provider-account binding checks...\n");
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
    ["INFRA-A missing source anchor → infra_fail:anchor", { edits: [[OWNERSHIP_SRC, "ANCHOR_THAT_DOES_NOT_EXIST_2f8a", "x"]], scenario: () => true }, "infra_fail:anchor"],
    ["INFRA-B compile failure → infra_fail:compile", { edits: [[OWNERSHIP_SRC, "export function classifyOwnership(", "export function classifyOwnership(((("]], scenario: () => true }, "infra_fail:compile"],
    ["INFRA-C import/load failure → infra_fail:import", { edits: [[OWNERSHIP_SRC, "function isInternalId(v: unknown): v is string {", 'const _loadBoom: string = (() => { throw new Error("synthetic load failure"); })();\nfunction isInternalId(v: unknown): v is string {']], scenario: () => true }, "infra_fail:import"],
    ["INFRA-D unrelated scenario exception → infra_fail:scenario_threw", { edits: [[OWNERSHIP_SRC, "function isInternalId(v: unknown): v is string {", "function isInternalId(v: unknown): v is string { /* probe */"]], scenario: () => { throw new Error("unrelated boom"); } }, "infra_fail:scenario_threw"],
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
  console.log("\nRunning Phase 8B-1B-A (V4) guard mutations...\n");
  for (const mut of mutations) {
    const status = await evaluateMutation(mut);
    if (status === "killed") { console.log(`KILLED   ${mut.name}`); killed++; }
    else if (status === "survived") { console.log(`SURVIVED ${mut.name}`); survived++; }
    else { console.log(`INFRA    ${mut.name} (${status})`); infra++; }
  }
  return { killed, survived, infra };
}

const functional = await runFunctional();
const infraSelf = await runInfraSelfTests();
const mutants = await runMutations();
rmSync(MAIN_DIR, { recursive: true, force: true });
restoreFetch();

const functionalPass = functional.passed + infraSelf.passed;
const functionalFail = functional.failed + infraSelf.failed;
const mutationFail = mutants.survived + mutants.infra;
const passed = functionalPass + mutants.killed;
const failed = functionalFail + mutationFail;
console.log(`\nSummary: ${passed} passed, ${failed} failed ` +
  `(functional: ${functionalPass}/${functionalPass + functionalFail}, ` +
  `mutation killed: ${mutants.killed}/${mutations.length}, survived: ${mutants.survived}, infra: ${mutants.infra}).`);
process.exit(failed > 0 ? 1 : 0);
