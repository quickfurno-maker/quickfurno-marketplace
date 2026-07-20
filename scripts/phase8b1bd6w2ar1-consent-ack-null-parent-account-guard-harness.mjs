import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/**
 * Phase 8B-1B-D6 WAVE 2A-R1 — consent-acknowledgement NULL-parent provider-account guard.
 *
 * THE INVARIANT UNDER TEST:
 *
 *     A consent acknowledgement intent must NEVER be inserted unless its persisted parent inbound
 *     message carries a non-NULL provider_account_id.
 *
 * THE GAP THIS CLOSES (Class L). `inheritPersistedAccount` previously returned
 *
 *     raw === null  →  { kind: "inherited", value: null }
 *
 * i.e. an unbound parent was a SUCCESS, and `enqueueOne` went on to insert a row with
 * provider_account_id = NULL and report it as `enqueued`. Wave 2A-R1 makes a stored null fail
 * closed, exactly like an absent or malformed value.
 *
 * EVIDENCE MODEL. This harness does not trust comments or names.
 *   • BEHAVIOURAL proofs transpile the REAL service and execute it with injected dependencies,
 *     counting actual insert attempts. A zero-insert claim is measured, never asserted.
 *   • STATIC proofs run over EXECUTABLE SOURCE ONLY — comments and string literals are stripped
 *     first, because the file legitimately *discusses* null, legacy rows and resolvers in prose.
 *   • MUTATIONS rewrite executable source and must be KILLED. A deliberate comment-only mutation
 *     must SURVIVE, so a suite that trivially fails everything cannot pose as a suite that detects
 *     everything.
 *
 * NO NETWORK, NO DATABASE, NO SUPABASE, NO CREDENTIALS. `../lib/supabase` is stubbed to throw, so
 * a reintroduced real client call fails loudly rather than silently reaching out.
 */

const SVC_SRC = "services/consentCommandResponseService.ts";
const HARNESS_SELF = "scripts/phase8b1bd6w2ar1-consent-ack-null-parent-account-guard-harness.mjs";
const MIGRATIONS_DIR = "supabase/migrations";
const EXPECTED_BASE = "fc639cf5b86f10b3fa3c814684b97c42b578322a";
const MISSING_OUTCOME = "provider_account_context_missing";

const tsc = resolve("node_modules/typescript/bin/tsc");

// ----------------------------------------------------------------------------
// Executable-source extraction. Strips // and /* */ comments and the CONTENTS of string
// literals / template literals, so a static check can never be satisfied — or fooled — by prose.
// ----------------------------------------------------------------------------
function stripNonCode(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (src.startsWith("//", i)) {
      const j = src.indexOf("\n", i);
      i = j < 0 ? n : j;
    } else if (src.startsWith("/*", i)) {
      const j = src.indexOf("*/", i);
      i = j < 0 ? n : j + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === quote) break;
        j += 1;
      }
      out += quote + quote;          // collapse the literal, keep the token shape
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

const squash = (s) => s.replace(/\s+/g, " ").trim();

/** Strip comments but PRESERVE string literals — needed when a check must read a literal like "inherited". */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (src.startsWith("//", i)) {
      const j = src.indexOf("\n", i);
      i = j < 0 ? n : j;
    } else if (src.startsWith("/*", i)) {
      const j = src.indexOf("*/", i);
      i = j < 0 ? n : j + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === quote) break;
        j += 1;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// STRING-CARRIED EVIDENCE DETECTORS (C8B-1B-D6 Wave 2A-R1 evidence repair)
//
// WHY THESE EXIST. The independent audit of PR #16 found that two static checks could not fail:
// they searched `stripNonCode(src)` — which collapses every string literal to `""` — for evidence
// that ONLY EVER APPEARS INSIDE A STRING LITERAL (a Supabase table name, a module specifier). The
// text was erased before the test, so both assertions were constant-true. An injected
// `.from("communication_provider_accounts")` and an injected resolver `import` were both accepted.
//
// THE RULE THAT PREVENTS A REPEAT: when the evidence for a check is carried by a STRING LITERAL,
// the check MUST read `stripComments()` (comments removed, string literals PRESERVED) and MUST NOT
// read `stripNonCode()`. Use `stripNonCode()` only for evidence carried by identifiers/syntax.
// ----------------------------------------------------------------------------

const ACCOUNTS_TABLE = "communication_provider_accounts";
const RESOLVER_MODULE = "communicationProviderRuntimeService";

/**
 * INVARIANT A (deliberately, not B): no direct QUERY CALL targeting the provider-accounts table.
 *
 * A is what the ownership rule actually forbids — re-resolving an account by querying the table.
 * B ("no executable reference to the table string anywhere") would be broader than the governance
 * record requires and would fire on a harmless log string, so it is NOT adopted. The rule is not
 * silently broadened; see the negative controls in `stringEvidenceChecks()`.
 *
 * Matches `.from("…")` with any quote style, arbitrary whitespace/newlines, optional chaining in
 * either position (`?.from(`, `.from?.(`), and any preceding chain such as `.schema("public")`.
 */
const ACCOUNTS_TABLE_QUERY_RE = new RegExp(
  String.raw`\??\.\s*from\s*(?:\?\.)?\s*\(\s*(["'\`])\s*` + ACCOUNTS_TABLE + String.raw`\s*\1\s*\)`
);

/**
 * The prohibited resolver module reached through ANY specifier-bearing form:
 *   import x from "…";  import "…";  require("…");  import("…")
 * A bare local identifier that merely resembles the name is NOT a module import and must not fire.
 */
const RESOLVER_IMPORT_RE = new RegExp(
  String.raw`(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)(["'\`])[^"'\`]*` +
  RESOLVER_MODULE + String.raw`[^"'\`]*\1`
);

/** The two repaired predicates, exported as pure functions so self-tests can prove they can FAIL. */
const queriesAccountsTable = (src) => ACCOUNTS_TABLE_QUERY_RE.test(stripComments(src));
const importsResolverModule = (src) => RESOLVER_IMPORT_RE.test(stripComments(src));

/** The executable body of `inheritPersistedAccount`, brace-matched. Comments removed, strings kept. */
function inheritBody(src) {
  const code = stripComments(src);
  const start = code.indexOf("function inheritPersistedAccount");
  if (start < 0) return "";
  const open = code.indexOf("{", start);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return squash(code.slice(open + 1, i));
    }
  }
  return "";
}

// ============================================================================
// FIXTURES
// ============================================================================
const WA_ID = "919812345678";
const E164 = "+919812345678";
const DEST_HASH = createHash("sha256").update(E164).digest("hex");
const WAMID = "wamid.HBgMOTE5ODEyMzQ1Njc4FQIAEhggABCDEF0123456789";
const CANONICAL_PMID = createHash("sha256").update(WAMID).digest("hex");
const ROW_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CMD_RECEIPT_ID = "99999999-8888-4777-8666-555555555555";
const RECEIVED = "2026-07-13T10:00:00.000Z";
const ADAPTER_PROVIDER = "meta_whatsapp_cloud";

/** The account the persisted parent row is bound to. The intent must inherit EXACTLY this. */
const PARENT_ACCOUNT = "0f9c1a2b-3d4e-4f50-8a6b-7c8d9e0f1a2b";
/** A different account, used to prove the intent never receives a substituted owner. */
const OTHER_ACCOUNT = "11111111-2222-4333-8444-555555555555";

const envelope = (...messages) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "1234567890", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: { phone_number_id: "111222333" },
    messages,
  } }] }],
});

const textMessage = (body) => ({
  id: WAMID,
  from: WA_ID,
  timestamp: "1768298400",
  type: "text",
  text: { body },
});

/** One persisted item. `account` is spliced in per-case; `omit` models a total absence. */
function persistedItem({ account, omit = false }) {
  const receipt = {
    inboundMessageId: ROW_ID,
    provider: ADAPTER_PROVIDER,
    providerMessageId: WAMID,
    destinationHash: DEST_HASH,
    receivedAt: RECEIVED,
  };
  if (!omit) receipt.providerAccountId = account;
  return { message: { providerMessageId: WAMID, messageType: "text" }, receipt };
}

const commandItem = () => ({
  inboundMessageId: ROW_ID,
  command: "stop",
  disposition: "stop_applied",
  replayed: false,
});

// ============================================================================
// BUILD — transpile the real service and load it with a throwing Supabase stub
// ============================================================================
function transpileService(outDir) {
  // The tsconfig MUST live at the repo root: `files` is repo-relative and is resolved relative to
  // the tsconfig's own directory, not the cwd.
  const tsconfigPath = resolve(".qf-w2ar1.svc.tsconfig.json");
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: false, isolatedModules: true,
      // NO `noResolve`: tsc must follow the service's imports so its lib dependencies are emitted
      // alongside it and the loaded module can actually run.
      outDir, rootDir: ".", types: [],
    },
    files: [SVC_SRC],
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  catch { /* resolution diagnostics are expected; emission is what matters */ }
  finally { rmSync(tsconfigPath, { force: true }); }
  const built = resolve(outDir, "services/consentCommandResponseService.js");
  if (!existsSync(built)) throw new Error("service did not transpile");
  return outDir;
}

function loadService(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const original = Module._load;
  const STUBS = {
    "../lib/supabase": {
      adminClient: () => { throw new Error("real Supabase must never run in the W2A-R1 harness"); },
    },
  };
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return original.apply(this, [request, parent, isMain]);
  };
  try {
    return req("./services/consentCommandResponseService.js");
  } finally {
    Module._load = original;
  }
}

/**
 * Dependency spy. Records every insert attempt and every read, and proves — by construction —
 * that no resolver, environment read or default-account lookup exists: this object is the ONLY
 * outside world the service is given, and `adminClient` throws.
 */
function makeDeps({ stored = { kind: "absent" }, insertResult = "inserted" } = {}) {
  const calls = { insert: [], readStored: 0, resolveReceipt: 0, seal: 0 };
  return {
    calls,
    deps: {
      resolveReceiptId: async () => { calls.resolveReceipt += 1; return CMD_RECEIPT_ID; },
      insertIntent: async (row) => { calls.insert.push(row); return insertResult; },
      readStoredIntent: async () => { calls.readStored += 1; return stored; },
      seal: () => {
        calls.seal += 1;
        return { ok: true, value: { ciphertext: "Y2lwaGVy", nonce: "bm9uY2UxMjM0NTY", authTag: "YXV0aFRhZzEyMzQ1Njc4", keyId: "k1" } };
      },
    },
  };
}

async function runCase(Svc, { account, omit = false, stored, insertResult, body = "STOP" }) {
  const { deps, calls } = makeDeps({ stored, insertResult });
  const out = await Svc.enqueueConsentCommandResponses({
    payload: envelope(textMessage(body)),
    persisted: [persistedItem({ account, omit })],
    commands: [commandItem()],
  }, deps);
  return { out, calls };
}

// ============================================================================
// RUNNER STATE
// ============================================================================
const results = [];
const add = (name, ok, detail = "") => results.push({ name, ok: ok === true, detail });

// ============================================================================
// BEHAVIOURAL PROOFS
// ============================================================================
async function behaviouralChecks(Svc) {
  // ── 1. A valid parent account is inherited EXACTLY, and the intent receives it ────────────────
  {
    const { out, calls } = await runCase(Svc, { account: PARENT_ACCOUNT });
    const item = out?.result?.items?.[0];
    add("B1.1 valid parent account → enqueued", item?.outcome === "enqueued", `got ${item?.outcome}`);
    add("B1.2 exactly one INSERT attempted", calls.insert.length === 1, `got ${calls.insert.length}`);
    add("B1.3 inserted provider_account_id === the parent account",
      calls.insert[0]?.provider_account_id === PARENT_ACCOUNT,
      `got ${calls.insert[0]?.provider_account_id}`);
    add("B1.4 the inserted account is NOT a substituted/other account",
      calls.insert[0]?.provider_account_id !== OTHER_ACCOUNT);
    add("B1.5 the inserted row binds the persisted parent message",
      calls.insert[0]?.inbound_message_id === ROW_ID);
    add("B1.6 counted as enqueued, not failed",
      out?.result?.enqueued === 1 && out?.result?.failed === 0,
      `enqueued=${out?.result?.enqueued} failed=${out?.result?.failed}`);
  }

  // ── 2. NULL parent account → provider_account_context_missing, ZERO inserts ───────────────────
  {
    const { out, calls } = await runCase(Svc, { account: null });
    const item = out?.result?.items?.[0];
    add("B2.1 NULL parent account → provider_account_context_missing",
      item?.outcome === MISSING_OUTCOME, `got ${item?.outcome}`);
    add("B2.2 NULL parent account → ZERO insert attempts",
      calls.insert.length === 0, `got ${calls.insert.length}`);
    add("B2.3 NULL parent account → no intent was ever read back",
      calls.readStored === 0, `got ${calls.readStored}`);
    add("B2.4 NULL parent account → no receipt lookup (fence fires first)",
      calls.resolveReceipt === 0, `got ${calls.resolveReceipt}`);
    add("B2.5 NULL parent account → no destination seal",
      calls.seal === 0, `got ${calls.seal}`);
    add("B2.6 NULL parent account → counted as failed, never enqueued",
      out?.result?.enqueued === 0 && out?.result?.failed === 1,
      `enqueued=${out?.result?.enqueued} failed=${out?.result?.failed}`);
    add("B2.7 NULL parent account is NOT reported as a duplicate",
      out?.result?.duplicates === 0);
  }

  // ── 3. Absent / undefined / malformed → unchanged fail-closed behaviour ───────────────────────
  for (const [label, kase] of [
    ["absent property", { omit: true }],
    ["explicit undefined", { account: undefined }],
    ["malformed (not a uuid)", { account: "not-a-uuid" }],
    ["malformed (empty string)", { account: "" }],
    ["malformed (wrong type)", { account: 12345 }],
    ["malformed (uuid-ish but short)", { account: "0f9c1a2b-3d4e-4f50-8a6b" }],
  ]) {
    const { out, calls } = await runCase(Svc, kase);
    const item = out?.result?.items?.[0];
    add(`B3 ${label} → ${MISSING_OUTCOME}`, item?.outcome === MISSING_OUTCOME, `got ${item?.outcome}`);
    add(`B3 ${label} → ZERO insert attempts`, calls.insert.length === 0, `got ${calls.insert.length}`);
  }

  // ── 4. The webhook response contract is unchanged: ALWAYS ok:true ─────────────────────────────
  {
    const ok = [];
    for (const kase of [{ account: PARENT_ACCOUNT }, { account: null }, { omit: true }, { account: "bad" }]) {
      const { out } = await runCase(Svc, kase);
      ok.push(out?.ok === true);
    }
    add("B4.1 every case still returns ok:true (webhook contract unchanged)", ok.every(Boolean));
  }
  {
    const { out } = await runCase(Svc, { account: null });
    add("B4.2 a fenced item still reports its inboundMessageId",
      out?.result?.items?.[0]?.inboundMessageId === ROW_ID);
    add("B4.3 candidates is still counted for a fenced item",
      out?.result?.candidates === 1, `got ${out?.result?.candidates}`);
  }

  // ── 5. Duplicate / idempotent behaviour is unchanged for a BOUND parent ───────────────────────
  {
    const { out, calls } = await runCase(Svc, {
      account: PARENT_ACCOUNT,
      stored: { kind: "present", providerAccountId: PARENT_ACCOUNT },
    });
    add("B5.1 an existing intent under the same account → duplicate",
      out?.result?.items?.[0]?.outcome === "duplicate", `got ${out?.result?.items?.[0]?.outcome}`);
    add("B5.2 duplicate → no second INSERT", calls.insert.length === 0, `got ${calls.insert.length}`);
  }
  {
    const { out, calls } = await runCase(Svc, {
      account: PARENT_ACCOUNT,
      stored: { kind: "present", providerAccountId: OTHER_ACCOUNT },
    });
    add("B5.3 an existing intent under a DIFFERENT account → provider_account_conflict",
      out?.result?.items?.[0]?.outcome === "provider_account_conflict",
      `got ${out?.result?.items?.[0]?.outcome}`);
    add("B5.4 conflict → the stored row is left alone (no INSERT)",
      calls.insert.length === 0, `got ${calls.insert.length}`);
  }
  {
    // A historical UNBOUND stored intent can still be read back (the column is still nullable).
    // It must be reported as a conflict and never "upgraded" — and never joined by a second row.
    const { out, calls } = await runCase(Svc, {
      account: PARENT_ACCOUNT,
      stored: { kind: "present", providerAccountId: null },
    });
    add("B5.5 a stored UNBOUND intent → conflict, never upgraded",
      out?.result?.items?.[0]?.outcome === "provider_account_conflict",
      `got ${out?.result?.items?.[0]?.outcome}`);
    add("B5.6 a stored UNBOUND intent → no second INSERT",
      calls.insert.length === 0, `got ${calls.insert.length}`);
  }
  {
    const { out } = await runCase(Svc, { account: PARENT_ACCOUNT, insertResult: "duplicate",
      stored: { kind: "absent" } });
    add("B5.7 a raced unique collision is still handled (not a crash)",
      out?.ok === true && typeof out?.result?.items?.[0]?.outcome === "string");
  }

  // ── 6. Mixed batch: a fenced item must not suppress a legitimate sibling ──────────────────────
  {
    const { deps, calls } = makeDeps();
    const SECOND_ROW = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const second = persistedItem({ account: PARENT_ACCOUNT });
    second.receipt.inboundMessageId = SECOND_ROW;
    const out = await Svc.enqueueConsentCommandResponses({
      payload: envelope(textMessage("STOP")),
      persisted: [persistedItem({ account: null }), second],
      commands: [commandItem(), { ...commandItem(), inboundMessageId: SECOND_ROW }],
    }, deps);
    const outcomes = (out?.result?.items ?? []).map((i) => i.outcome);
    add("B6.1 the unbound item is fenced", outcomes.includes(MISSING_OUTCOME));
    add("B6.2 the bound sibling still enqueues", outcomes.includes("enqueued"));
    add("B6.3 exactly one INSERT for the bound sibling only",
      calls.insert.length === 1 && calls.insert[0]?.provider_account_id === PARENT_ACCOUNT,
      `inserts=${calls.insert.length}`);
    add("B6.4 no inserted row carries a null account",
      calls.insert.every((r) => typeof r.provider_account_id === "string" && r.provider_account_id.length > 0));
  }
}

// ============================================================================
// STATIC PROOFS — executable source only
// ============================================================================
function staticChecks(src) {
  const code = stripNonCode(src);
  const flat = squash(code);

  // 1 — there is NO successful inherited-null branch anywhere in executable code.
  add("S1.1 no `inherited` result is constructed with a null value",
    !/kind\s*:\s*""\s*,\s*value\s*:\s*null/.test(flat) && !/value\s*:\s*null\s*,\s*kind/.test(flat));
  add("S1.2 no `raw === null` shortcut returns a value-carrying result",
    !/raw\s*===\s*null\s*\)?\s*return\s*\{\s*kind\s*:\s*""\s*,\s*value/.test(flat));
  add("S1.3 the InheritedAccount value type is `string`, not `string | null`",
    /kind\s*:\s*""\s*;\s*readonly\s+value\s*:\s*string\s*\}/.test(flat)
    && !/readonly\s+value\s*:\s*string\s*\|\s*null/.test(flat));

  // 1b — THE GUARD ITSELF. The single success return must be gated by exactly the typeof+shape
  // conjunction. This is the check that kills a bypass written as `raw === null || (...)` returning
  // `value: raw`, which carries no literal `null` and would slip past a value-shaped check.
  const body = inheritBody(src);
  const successGuards = [...body.matchAll(
    /if\s*\(((?:[^()]|\([^()]*\))*)\)\s*return\s*\{\s*kind\s*:\s*"inherited"/g)].map((m) => m[1]);
  add("S1.4 exactly ONE success return exists in inheritPersistedAccount",
    successGuards.length === 1, `found ${successGuards.length}`);
  const guard = successGuards[0] ?? "";
  add("S1.5 the success guard requires typeof raw === \"string\"",
    /typeof\s+raw\s*===\s*"string"/.test(guard), guard);
  add("S1.6 the success guard requires the account-shape test",
    /ACCOUNT_ID_SHAPE\s*\.\s*test\s*\(\s*raw\s*\)/.test(guard), guard);
  add("S1.7 the success guard contains NO disjunction (no `||` bypass)",
    guard.length > 0 && !guard.includes("||"), guard);
  add("S1.8 the success guard mentions no null comparison",
    guard.length > 0 && !/null/.test(guard), guard);
  add("S1.9 the function body performs no `raw === null` / `raw == null` comparison",
    !/raw\s*===?\s*null/.test(body) && !/null\s*===?\s*raw/.test(body), body.slice(0, 160));

  // 2 — the insert row type cannot carry a null account.
  add("S2.1 AckIntentRow.provider_account_id is non-nullable",
    /readonly\s+provider_account_id\s*:\s*string\s*;/.test(flat)
    && !/readonly\s+provider_account_id\s*:\s*string\s*\|\s*null\s*;/.test(flat));
  add("S2.2 enqueueOne takes a non-nullable account",
    /providerAccountId\s*:\s*string\s*,/.test(flat)
    && !/providerAccountId\s*:\s*string\s*\|\s*null\s*,/.test(flat));

  // 3 — the fence still fails closed and still emits the existing outcome.
  add("S3.1 the missing branch is still checked before any work",
    /inherited\.kind\s*===\s*""/.test(flat));
  add("S3.2 the existing provider_account_context_missing outcome is still used",
    src.includes(MISSING_OUTCOME));
  add("S3.3 inheritPersistedAccount still exists and is still called",
    /function\s+inheritPersistedAccount/.test(code) && /inheritPersistedAccount\s*\(/.test(code));

  // 4 — NO re-resolution of ownership, in executable code.
  // These are IDENTIFIER/SYNTAX-carried, so `code` (stripNonCode) is the correct view for them.
  const forbidden = [
    ["resolveOwningProviderAccount", /resolveOwningProviderAccount\s*\(/],
    ["process.env access", /process\s*\.\s*env/],
    ["fetchProviderAccount", /fetchProviderAccount\s*\(/],
    ["a DEFAULT_/FALLBACK_ account constant", /(DEFAULT|FALLBACK)_[A-Z_]*ACCOUNT/],
    ["a nullish-coalescing account fallback", /providerAccountId\s*\?\?/],
    ["an OR account fallback", /providerAccountId\s*\|\|/],
  ];
  for (const [label, re] of forbidden) {
    add(`S4 no ${label} in executable source`, !re.test(code));
  }

  // ── STRING-CARRIED EVIDENCE (repaired: reads stripComments, NOT stripNonCode) ──────────────────
  // The two checks below replace the vacuous ones the independent audit found. Their evidence lives
  // inside string literals, so they must never read `code`/`flat`.
  add(`S4.7 the service issues no direct ${ACCOUNTS_TABLE} query`, !queriesAccountsTable(src));
  add("S4.8 the service imports no provider-account resolver module", !importsResolverModule(src));

  // 5 — the five RPC lifecycle paths are untouched by this change.
  const RPCS = [
    "qf_claim_consent_ack_intents",
    "qf_reserve_consent_ack_provider_attempt",
    "qf_terminalize_consent_ack_intent",
    "qf_expire_consent_ack_intents",
    "qf_recover_stale_dispatching_consent_ack_intents",
  ];
  const worker = readFileSync(resolve("services/consentAckWorkerService.ts"), "utf8");
  for (const rpc of RPCS) {
    add(`S5 worker still calls ${rpc}`, worker.includes(rpc));
  }
  add("S5.6 the worker still issues NO generic table update",
    !/\.update\s*\(/.test(stripNonCode(worker)));
  add("S5.7 the worker does not write provider_account_id",
    !/provider_account_id/.test(stripNonCode(worker)));

  // 6 — no generic update of the column was introduced in the service either.
  add("S6.1 the service issues no .update() on the ack-intents table",
    !/\.update\s*\(/.test(code));
}

// ============================================================================
// SELF-TESTS FOR THE STRING-CARRIED CHECKS (C8B-1B-D6 Wave 2A-R1 evidence repair)
//
// A check may not claim load-bearing status unless an executable self-test proves it REJECTS a
// violating sample. These feed each repaired predicate synthetic sources and require the exact
// verdict — positives must fail, negative controls must pass. If a predicate is ever replaced with
// a constant-pass implementation, every POSITIVE row below flips and this section goes red.
// ============================================================================
function stringEvidenceSelfTests() {
  // ---- POSITIVES: each MUST be detected ------------------------------------------------------
  const queryPositives = {
    "double quote": `const { data } = await adminClient().from("${ACCOUNTS_TABLE}").select("id");`,
    "single quote": `const { data } = await adminClient().from('${ACCOUNTS_TABLE}').select('id');`,
    "template literal": "const { data } = await adminClient().from(`" + ACCOUNTS_TABLE + "`).select(`id`);",
    "multiline formatting": `const { data } = await adminClient()\n  .from(\n    "${ACCOUNTS_TABLE}"\n  )\n  .select("id");`,
    "schema().from() chain": `await adminClient().schema("public").from("${ACCOUNTS_TABLE}").select("id");`,
    "optional chaining": `await adminClient()?.from?.("${ACCOUNTS_TABLE}")?.select("id");`,
    "extra inner whitespace": `await adminClient().from(  "${ACCOUNTS_TABLE}"  ).select("id");`,
  };
  for (const [label, sample] of Object.entries(queryPositives)) {
    add(`ST1 direct accounts-table query is DETECTED — ${label}`, queriesAccountsTable(sample) === true);
  }

  const importPositives = {
    "static named import": `import { resolveOwningProviderAccount } from "./${RESOLVER_MODULE}";`,
    "side-effect import": `import "./${RESOLVER_MODULE}";`,
    "require()": `const r = require("./${RESOLVER_MODULE}");`,
    "dynamic import()": `const r = await import("./${RESOLVER_MODULE}");`,
    "single-quoted specifier": `import { x } from './${RESOLVER_MODULE}';`,
    "multiline import": `import {\n  resolveOwningProviderAccount,\n} from "../services/${RESOLVER_MODULE}";`,
  };
  for (const [label, sample] of Object.entries(importPositives)) {
    add(`ST2 prohibited resolver import is DETECTED — ${label}`, importsResolverModule(sample) === true);
  }

  // ---- NEGATIVE CONTROLS: each MUST NOT be detected -------------------------------------------
  // These encode INVARIANT A: a direct QUERY CALL is forbidden; a mere mention is not.
  const queryNegatives = {
    "table name only in a line comment": `// never query ${ACCOUNTS_TABLE} here\nconst x = 1;`,
    "table name only in a block comment": `/* ${ACCOUNTS_TABLE} is owned elsewhere */\nconst x = 1;`,
    "table name only in a test description": `check("must not touch ${ACCOUNTS_TABLE}", () => {});`,
    "table name in a harmless log string": `console.warn("ownership lives in ${ACCOUNTS_TABLE}");`,
    "an unrelated table is queried": `await adminClient().from("communication_inbound_messages").select("id");`,
    "a similarly-prefixed table is queried": `await adminClient().from("${ACCOUNTS_TABLE}_audit").select("id");`,
  };
  for (const [label, sample] of Object.entries(queryNegatives)) {
    add(`ST3 no false positive — ${label}`, queriesAccountsTable(sample) === false);
  }

  const importNegatives = {
    "resolver name only in a comment": `// we never import ${RESOLVER_MODULE}\nconst x = 1;`,
    "resolver name only in a test label": `check("does not import ${RESOLVER_MODULE}", () => {});`,
    "an unrelated module is imported": `import { adminClient } from "../lib/supabase";`,
    "a local identifier of a similar name": `const ${RESOLVER_MODULE}Stub = { resolve: () => null };`,
  };
  for (const [label, sample] of Object.entries(importNegatives)) {
    add(`ST4 no false positive — ${label}`, importsResolverModule(sample) === false);
  }

  // ---- ANTI-VACUITY: the predicates must not be constant in EITHER direction -------------------
  // A constant-pass implementation makes every ST1/ST2 row fail; a constant-fail one makes every
  // ST3/ST4 row fail. These two rows additionally assert non-constancy directly, so the property is
  // stated as evidence rather than only implied by the rows above.
  add("ST5 the accounts-query predicate is non-constant (rejects and accepts)",
    queriesAccountsTable(`await x.from("${ACCOUNTS_TABLE}")`) === true
    && queriesAccountsTable("const x = 1;") === false);
  add("ST6 the resolver-import predicate is non-constant (rejects and accepts)",
    importsResolverModule(`import "./${RESOLVER_MODULE}";`) === true
    && importsResolverModule("const x = 1;") === false);

  // ---- REGRESSION GUARD: neither check may read the string-erasing view ------------------------
  // This is the defect class itself, asserted directly against this harness's own source.
  const selfSrc = readFileSync(resolve(HARNESS_SELF), "utf8");
  const detectorBlock = selfSrc.slice(
    selfSrc.indexOf("const queriesAccountsTable"),
    selfSrc.indexOf("/** The executable body of `inheritPersistedAccount`"));
  add("ST7 the repaired predicates read stripComments, never stripNonCode",
    detectorBlock.includes("stripComments(src)") && !detectorBlock.includes("stripNonCode"));
}

// ============================================================================
// SCOPE PROOFS — R1 is runtime-only
// ============================================================================
function scopeChecks() {
  // The Wave 2A-R2 migration must NOT exist yet.
  const migrations = execFileSync("git", ["ls-files", MIGRATIONS_DIR], { encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean);
  const w1 = "supabase/migrations/20260720000100_communication_delivery_event_provider_account_required.sql";
  add("SC1.1 the Wave 1 migration is still present and untouched", migrations.includes(w1));
  const ackConstraintMigrations = migrations.filter((m) =>
    /consent_ack_intent.*provider_account|provider_account.*consent_ack_intent/i.test(m));
  add("SC1.2 NO Wave 2A-R2 ack-intent constraint migration exists yet",
    ackConstraintMigrations.length === 0, ackConstraintMigrations.join(", "));

  // Nothing in this branch adds a CHECK/trigger on the ack-intents table.
  const changed = execFileSync("git", ["diff", "--name-only", `${EXPECTED_BASE}..HEAD`], { encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean);
  add("SC2.1 no migration file changed in this branch",
    !changed.some((f) => f.startsWith(MIGRATIONS_DIR)), changed.join(", "));
  add("SC2.2 the only runtime file changed is the consent-command response service",
    changed.filter((f) => f.startsWith("services/")).every((f) => f === SVC_SRC),
    changed.filter((f) => f.startsWith("services/")).join(", "));
  add("SC2.3 no lib/ runtime file changed", !changed.some((f) => f.startsWith("lib/")));
  add("SC2.4 no app/ route changed", !changed.some((f) => f.startsWith("app/")));
  add("SC2.5 no package/dependency file changed",
    !changed.some((f) => /^package(-lock)?\.json$/.test(f)));
  add("SC2.6 no environment file changed", !changed.some((f) => /\.env/.test(f)));

  // The branch point must be exactly fc639cf.
  let base = "";
  try {
    base = execFileSync("git", ["merge-base", "HEAD", EXPECTED_BASE], { encoding: "utf8" }).trim();
  } catch { /* reported below */ }
  add("SC3.1 the branch point is exactly fc639cf", base === EXPECTED_BASE, `got ${base}`);

  // No stray Supabase CLI state.
  add("SC4.1 supabase/.temp is absent", !existsSync(resolve("supabase/.temp")));
}

// ============================================================================
// MUTATIONS — each must be KILLED by the static suite
// ============================================================================
const MUTATIONS = [
  { name: "M1 restore NULL as inherited success", expect: "killed",
    mutate: (s) => s.replace(
      'if (typeof raw === "string" && ACCOUNT_ID_SHAPE.test(raw)) return { kind: "inherited", value: raw };',
      'if (raw === null) return { kind: "inherited", value: null };\n  if (typeof raw === "string" && ACCOUNT_ID_SHAPE.test(raw)) return { kind: "inherited", value: raw };') },

  { name: "M2 re-widen the InheritedAccount value type to string | null", expect: "killed",
    mutate: (s) => s.replace(
      '| { readonly kind: "inherited"; readonly value: string }',
      '| { readonly kind: "inherited"; readonly value: string | null }') },

  { name: "M3 re-widen AckIntentRow.provider_account_id to nullable", expect: "killed",
    mutate: (s) => s.replace(
      "readonly provider_account_id: string;",
      "readonly provider_account_id: string | null;") },

  { name: "M4 re-widen enqueueOne's account parameter to nullable", expect: "killed",
    mutate: (s) => s.replace("  providerAccountId: string,", "  providerAccountId: string | null,") },

  { name: "M5 convert the missing result back into an inherited null", expect: "killed",
    mutate: (s) => s.replace(
      "  return { kind: \"missing\" };\n}",
      "  return { kind: \"inherited\", value: null };\n}") },

  { name: "M6 allow the flow to continue after a missing result", expect: "killed",
    mutate: (s) => s.replace('if (inherited.kind === "missing") {', "if (false) {") },

  { name: "M7 add a raw-null OR bypass", expect: "killed",
    mutate: (s) => s.replace(
      'if (typeof raw === "string" && ACCOUNT_ID_SHAPE.test(raw)) return { kind: "inherited", value: raw };',
      'if (raw === null || (typeof raw === "string" && ACCOUNT_ID_SHAPE.test(raw))) return { kind: "inherited", value: raw };') },

  { name: "M8 add an environment fallback", expect: "killed",
    mutate: (s) => s.replace(
      "  const raw = (receipt as { providerAccountId?: string | null } | undefined)?.providerAccountId;",
      "  const raw = (receipt as { providerAccountId?: string | null } | undefined)?.providerAccountId ?? process.env.DEFAULT_PROVIDER_ACCOUNT_ID;") },

  { name: "M9 add a default-account constant fallback", expect: "killed",
    mutate: (s) => s.replace(
      "const ACCOUNT_ID_SHAPE =",
      "const DEFAULT_PROVIDER_ACCOUNT = \"00000000-0000-4000-8000-000000000000\";\nconst ACCOUNT_ID_SHAPE =") },

  { name: "M10 reintroduce a resolver lookup", expect: "killed",
    mutate: (s) => s.replace(
      "function inheritPersistedAccount(",
      "async function reresolve(x: unknown) { return resolveOwningProviderAccount(x as never); }\nfunction inheritPersistedAccount(") },

  { name: "M11 add a nullish-coalescing account fallback at the insert site", expect: "killed",
    mutate: (s) => s.replace(
      "    provider_account_id: providerAccountId,",
      "    provider_account_id: providerAccountId ?? null,") },

  // ── M13 family (C8B-1B-D6 Wave 2A-R1 evidence repair) ────────────────────────────────────────
  // The independent audit's finding F3: M10 covers only a NAMED resolver. Querying the accounts
  // table DIRECTLY was an uncovered bypass, and the check nominally guarding it was vacuous.
  //
  // Each variant substitutes an account for an unbound parent — production-reachable, semantically
  // capable of account substitution, NOT dead code and NOT a comment. Quote-format variants exist
  // so the repaired detector cannot be gamed by changing quoting or line breaks.
  ...[
    ["a", "double quote", `adminClient().from("communication_provider_accounts").select("id")`],
    ["b", "single quote", `adminClient().from('communication_provider_accounts').select('id')`],
    ["c", "template literal", "adminClient().from(`communication_provider_accounts`).select(`id`)"],
    ["d", "multiline", `adminClient()\n      .from(\n        "communication_provider_accounts"\n      )\n      .select("id")`],
    ["e", "schema().from() chain", `adminClient().schema("public").from("communication_provider_accounts").select("id")`],
  ].map(([id, label, query]) => ({
    name: `M13${id} direct provider-accounts query substitutes an account (${label})`,
    expect: "killed",
    mutate: (s) => s.replace(
      '  if (typeof raw === "string" && ACCOUNT_ID_SHAPE.test(raw)) return { kind: "inherited", value: raw };',
      `  if (raw === undefined || raw === null) {\n` +
      `    const { data } = await ${query};\n` +
      `    if (data && data[0]) return { kind: "inherited", value: data[0].id as string };\n` +
      `  }\n` +
      '  if (typeof raw === "string" && ACCOUNT_ID_SHAPE.test(raw)) return { kind: "inherited", value: raw };'),
  })),

  { name: "M12 permit a generic provider_account_id update in the service", expect: "killed",
    mutate: (s) => s.replace(
      "    async insertIntent(row) {",
      "    async touchAccount(id: string) { const db = adminClient(); await db.from(\"communication_consent_ack_intents\").update({ provider_account_id: null }).eq(\"id\", id); },\n    async insertIntent(row) {") },

  // SELF-TESTS ---------------------------------------------------------------
  // A comment-only edit changes nothing executable and MUST survive. If it is reported killed,
  // the static suite is reading prose and every other kill is suspect.
  { name: "S1 comment-only edit (must SURVIVE)", expect: "survived",
    mutate: (s) => s.replace("// Read through a widened view", "// Read via a widened view") },
  // A prose mention of the forbidden words must ALSO survive — proving S4 reads code, not comments.
  { name: "S2 prose mentioning process.env and a resolver (must SURVIVE)", expect: "survived",
    mutate: (s) => s.replace(
      "function inheritPersistedAccount(",
      "// NOTE: this function never calls resolveOwningProviderAccount( and never reads process.env.\nfunction inheritPersistedAccount(") },
];

// ============================================================================
// RUNNER
// ============================================================================
const raw = readFileSync(resolve(SVC_SRC), "utf8");

console.log("Phase 8B-1B-D6 Wave 2A-R1 - consent-ack NULL-parent provider-account guard harness\n");
console.log(`Runtime file under test: ${SVC_SRC}\n`);

const outDir = mkdtempSync(resolve(tmpdir(), "qf-w2ar1-"));
let Svc;
try {
  transpileService(outDir);
  Svc = loadService(outDir);
} catch (e) {
  console.log(`FATAL  could not build the service under test: ${e.message}`);
  process.exit(1);
}

await behaviouralChecks(Svc);
staticChecks(raw);
stringEvidenceSelfTests();
scopeChecks();

let passed = 0, failed = 0;
for (const r of results) {
  if (r.ok) { console.log(`PASS  ${r.name}`); passed += 1; }
  else { console.log(`FAIL  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`); failed += 1; }
}

console.log("\n--- mutation tests (static suite re-run against mutated executable source) ---\n");
let killed = 0, survived = 0, infra = 0;
for (const mut of MUTATIONS) {
  let status;
  try {
    const mutated = mut.mutate(raw);
    if (mutated === raw) {
      status = "infra_fail";                 // anchor missed — never counts as a kill
    } else {
      const before = results.length;
      staticChecks(mutated);
      const after = results.splice(before);  // isolate this mutation's results
      status = after.some((r) => !r.ok) ? "killed" : "survived";
    }
  } catch {
    status = "infra_fail";
  }
  const ok = status === mut.expect;
  if (status === "infra_fail") { console.log(`INFRA ${mut.name}`); infra += 1; failed += 1; }
  else if (status === "killed") { console.log(`${ok ? "KILLED   " : "KILLED*  "}${mut.name}`); killed += 1; if (!ok) failed += 1; }
  else { console.log(`${ok ? "SURVIVED " : "SURVIVED*"} ${mut.name}`); survived += 1; if (!ok) failed += 1; }
}

const expectedKills = MUTATIONS.filter((m) => m.expect === "killed").length;
console.log(`\nchecks: ${passed} passed, ${failed} failed, 0 skipped`);
console.log(`mutations: ${killed} killed, ${survived} survived, ${infra} infra_fail (expected kills: ${expectedKills})`);
rmSync(outDir, { recursive: true, force: true });
console.log(failed === 0 ? "\nHARNESS GREEN" : "\nHARNESS RED");
process.exit(failed > 0 ? 1 : 0);
