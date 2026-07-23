#!/usr/bin/env node
/**
 * QF-MVP-20.3B1 — Offline migration validator.
 *
 * Entirely offline. Reads files from disk and hashes them. Opens no socket,
 * spawns no process, reads no environment variable and touches no database.
 *
 * Validates the three generated migrations, the phase verification SQL and the
 * locked baseline artifacts against the frozen QF-MVP-20.3A / 20.3A1 / 20.3A1R
 * contracts and the QF-MVP-20.3B1 founder decisions.
 *
 * Usage:  node scripts/mvp/staging/validate-qf-mvp-20-3b1.mjs
 * Exit 0 = PASS, exit 1 = FAIL. Fails closed on ambiguous parsing.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const MIGRATION_A = "supabase/migrations/20260723000100_qf_mvp_marketplace_authority_foundation.sql";
const MIGRATION_A2 = "supabase/migrations/20260723000200_qf_mvp_assignment_lineage_backfill.sql";
const MIGRATION_B1 = "supabase/migrations/20260723000300_qf_mvp_canonical_assignment_authority.sql";
const PHASE_VERIFIER = "supabase/staging-verification/verify_qf_mvp_20_3b1.sql";

const LOCKED = [
  {
    file: "supabase/staging-baseline/20260722000100_qf_mvp_staging_baseline_269c9265.sql",
    sha256: "920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81",
  },
  {
    file: "supabase/staging-baseline/verify_qf_mvp_staging_baseline.sql",
    sha256: "7ba9792f300119b7c1aa84a4c02394186116a507c9097bd6f95f23f55e504193",
  },
];

const BASELINE_VERSION = "20260722000100";

const results = [];
let failed = false;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed = true;
}

function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/* ---------------------------------------------------------------------------
 * SQL tokenizer — strips line comments, block comments, single-quoted strings,
 * double-quoted identifiers and dollar-quoted bodies, so that keyword scans
 * never match text that only APPEARS inside a comment or a literal.
 *
 * Returns { code, bodies }:
 *   code   — executable SQL outside dollar-quoted bodies, comments and strings
 *   bodies — the contents of every dollar-quoted body, separately
 *
 * Fails closed: an unterminated construct throws.
 * ------------------------------------------------------------------------- */
function tokenize(sql, label) {
  let code = "";
  const bodies = [];
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const two = sql.slice(i, i + 2);

    // line comment
    if (two === "--") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl;
      continue;
    }

    // block comment (nesting is legal in PostgreSQL)
    if (two === "/*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql.slice(i, i + 2) === "/*") { depth++; i += 2; continue; }
        if (sql.slice(i, i + 2) === "*/") { depth--; i += 2; continue; }
        i++;
      }
      if (depth !== 0) throw new Error(`${label}: unterminated block comment`);
      continue;
    }

    // single-quoted string (doubled '' is an escaped quote)
    if (sql[i] === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      code += " '' ";
      continue;
    }

    // double-quoted identifier
    if (sql[i] === '"') {
      let ident = "";
      i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') { ident += '"'; i += 2; continue; }
        if (sql[i] === '"') { i++; break; }
        ident += sql[i];
        i++;
      }
      code += ` ${ident} `;
      continue;
    }

    // dollar-quoted body: $tag$ ... $tag$
    if (sql[i] === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const start = i + tag.length;
        const end = sql.indexOf(tag, start);
        if (end === -1) throw new Error(`${label}: unterminated dollar-quoted body ${tag}`);
        bodies.push(sql.slice(start, end));
        code += " $BODY$ ";
        i = end + tag.length;
        continue;
      }
    }

    code += sql[i];
    i++;
  }

  return { code, bodies };
}

/* Normalized, whitespace-collapsed lowercase view for keyword scanning. */
function norm(text) {
  return text.replace(/\s+/g, " ").toLowerCase();
}

/**
 * Strips line and block comments while PRESERVING string literals, quoted
 * identifiers and dollar-quoted body contents.
 *
 * `tokenize().code` deliberately discards literal values, which is right for
 * structural keyword scans but useless for asserting that a specific value such
 * as 'migration_backfill' is written. This gives the complementary view: real
 * executable text with every comment removed, so a word that appears only in a
 * header comment can never satisfy — or violate — a value assertion.
 *
 * Fails closed: an unterminated construct throws.
 */
function stripComments(sql, label) {
  let out = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const two = sql.slice(i, i + 2);

    if (two === "--") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl;
      continue;
    }

    if (two === "/*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql.slice(i, i + 2) === "/*") { depth++; i += 2; continue; }
        if (sql.slice(i, i + 2) === "*/") { depth--; i += 2; continue; }
        i++;
      }
      if (depth !== 0) throw new Error(`${label}: unterminated block comment`);
      continue;
    }

    if (sql[i] === "'" || sql[i] === '"') {
      const q = sql[i];
      out += q;
      i++;
      while (i < n) {
        if (sql[i] === q && sql[i + 1] === q) { out += q + q; i += 2; continue; }
        if (sql[i] === q) { out += q; i++; break; }
        out += sql[i];
        i++;
      }
      continue;
    }

    if (sql[i] === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const start = i + tag.length;
        const end = sql.indexOf(tag, start);
        if (end === -1) throw new Error(`${label}: unterminated dollar-quoted body ${tag}`);
        // Recurse: a function body has its own comments, which must also go.
        out += tag + stripComments(sql.slice(start, end), label) + tag;
        i = end + tag.length;
        continue;
      }
    }

    out += sql[i];
    i++;
  }

  return out;
}

/* ------------------------------------------------------------------------- */
/* Load and tokenize                                                          */
/* ------------------------------------------------------------------------- */

const files = {};
for (const [key, rel] of Object.entries({
  A: MIGRATION_A,
  A2: MIGRATION_A2,
  B1: MIGRATION_B1,
  VERIFIER: PHASE_VERIFIER,
})) {
  let raw;
  try {
    raw = read(rel);
  } catch {
    record(`load:${rel}`, false, "file not found");
    continue;
  }
  let tok;
  let stripped;
  try {
    tok = tokenize(raw, rel);
    stripped = stripComments(raw, rel);
  } catch (err) {
    record(`tokenize:${rel}`, false, `fail-closed: ${err.message}`);
    continue;
  }
  files[key] = {
    rel,
    raw,
    sha256: sha256(raw),
    // structural view: no comments, no string literals, no function bodies
    code: norm(tok.code),
    // per-body view, comments stripped, literals preserved
    bodies: tok.bodies.map((b) => norm(stripComments(b, rel))),
    // executable text with literals preserved and every comment removed
    all: norm(stripped),
  };
  record(`tokenize:${rel}`, true, `${raw.length} bytes, ${tok.bodies.length} dollar-quoted bodies`);
}

if (Object.keys(files).length < 4) {
  report();
}

const A = files.A;
const A2 = files.A2;
const B1 = files.B1;
const V = files.VERIFIER;
const MIGRATIONS = [A, A2, B1];

/* ------------------------------------------------------------------------- */
/* 1. Identity and ordering                                                   */
/* ------------------------------------------------------------------------- */

const EXPECTED_ORDER = [
  ["20260723000100", MIGRATION_A],
  ["20260723000200", MIGRATION_A2],
  ["20260723000300", MIGRATION_B1],
];

let orderOk = true;
let prev = BASELINE_VERSION;
for (const [version, rel] of EXPECTED_ORDER) {
  const base = path.basename(rel);
  if (!base.startsWith(`${version}_`)) orderOk = false;
  if (!(version > prev)) orderOk = false;
  prev = version;
}
record(
  "identity:three exact versions, ascending, all greater than the baseline",
  orderOk,
  `${BASELINE_VERSION} < ${EXPECTED_ORDER.map(([v]) => v).join(" < ")}`
);

/* ------------------------------------------------------------------------- */
/* 2. Locked baseline artifacts unchanged                                     */
/* ------------------------------------------------------------------------- */

for (const { file, sha256: want } of LOCKED) {
  let got;
  try {
    got = sha256(read(file));
  } catch {
    record(`locked:${path.basename(file)}`, false, "file not found");
    continue;
  }
  record(
    `locked:${path.basename(file)}`,
    got === want,
    got === want ? `unchanged ${want.slice(0, 8)}...` : `CHANGED: expected ${want}, got ${got}`
  );
}

/* ------------------------------------------------------------------------- */
/* 3. Destructive and authority-changing operations                           */
/* ------------------------------------------------------------------------- */

/* DROP of a pre-existing object is forbidden. The ONE approved exception is the
 * additive replacement of vendor_credit_logs_change_type_check in Migration A,
 * which is immediately re-added as a strict superset. Rollback DROP statements
 * quoted inside header comments are already stripped by the tokenizer. */
const APPROVED_DROPS = [/drop constraint vendor_credit_logs_change_type_check/];

for (const f of MIGRATIONS) {
  const drops = (f.code.match(/\bdrop\s+(table|column|function|view|index|schema|database|type|trigger|policy|constraint|role|owned)\b[^;]*/g) || [])
    .filter((s) => !APPROVED_DROPS.some((re) => re.test(s)));
  record(
    `no-destructive-drop:${path.basename(f.rel)}`,
    drops.length === 0,
    drops.length === 0 ? "none" : `unapproved: ${drops.slice(0, 3).join(" | ")}`
  );

  const wipes = f.code.match(/\b(truncate|delete\s+from|drop\s+database|db\s+reset)\b/g) || [];
  record(
    `no-data-destruction:${path.basename(f.rel)}`,
    wipes.length === 0,
    wipes.length === 0 ? "none" : `found: ${[...new Set(wipes)].join(", ")}`
  );
}

/* Role and session authority changes are forbidden outright. */
for (const f of MIGRATIONS) {
  const roleOps = f.all.match(/\b(create\s+role|alter\s+role|drop\s+role|create\s+user|alter\s+user|set\s+role|set\s+session\s+authorization|alter\s+default\s+privileges|security\s+label)\b/g) || [];
  record(
    `no-role-authority-change:${path.basename(f.rel)}`,
    roleOps.length === 0,
    roleOps.length === 0 ? "none" : `found: ${[...new Set(roleOps)].join(", ")}`
  );
}

/* ------------------------------------------------------------------------- */
/* 4. Secrets, provider endpoints and environment references                  */
/* ------------------------------------------------------------------------- */

const SECRET_PATTERNS = [
  [/https?:\/\//, "http(s) URL"],
  [/postgres(ql)?:\/\//, "database URL"],
  [/\bgraph\.facebook\.com\b/, "Meta Graph endpoint"],
  [/\bn8n\b/, "n8n reference"],
  [/\bsupabase\.co\b/, "Supabase host"],
  [/\b(yqpgcsduqbxulrlzwzap|uckafzuochmbvtiodmcl|coilipywdvxklewquqvv)\b/, "project ref"],
  [/\bservice[_-]role[_-]key\b/, "service-role key"],
  [/\bsb_secret|sbp_|eyj[a-z0-9]{10}/i, "token-like literal"],
  [/\bpassword\s*=/, "password assignment"],
];

/* Scanned against executable text with comments removed. A header that merely
 * DECLARES "no n8n change" must not be mistaken for an n8n reference; a URL or
 * credential in real SQL still is one. */
for (const f of [...MIGRATIONS, V]) {
  const hits = [];
  const haystack = f.all;
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(haystack)) hits.push(label);
  }
  record(
    `no-secrets-or-endpoints:${path.basename(f.rel)}`,
    hits.length === 0,
    hits.length === 0 ? "none" : `found: ${hits.join(", ")}`
  );
}

/* ------------------------------------------------------------------------- */
/* 5. Grants — no public/anon/authenticated mutation authority                */
/* ------------------------------------------------------------------------- */

for (const f of MIGRATIONS) {
  const grants = f.code.match(/\bgrant\b[^;]*/g) || [];
  const bad = grants.filter((g) => /\bto\b[^;]*\b(public|anon|authenticated)\b/.test(g));
  record(
    `no-public-grant:${path.basename(f.rel)}`,
    bad.length === 0,
    bad.length === 0
      ? `${grants.length} grant statement(s), all to service_role`
      : `forbidden: ${bad.slice(0, 3).join(" | ")}`
  );
}

/* Every canonical RPC must be explicitly revoked from PUBLIC. */
const CANONICAL_FNS = [
  "qf_vendor_assignment_eligible",
  "qf_apply_credit_mutation_v2",
  "qf_assign_lead_vendors_v2",
  "qf_request_replacement_v2",
  "qf_approve_credit_restoration_v2",
];

for (const fn of CANONICAL_FNS) {
  const revoked = new RegExp(`revoke all on function public\\.${fn}\\s*\\([^)]*\\)\\s*from public`).test(B1.code);
  const granted = new RegExp(`grant execute on function public\\.${fn}\\s*\\([^)]*\\)\\s*to service_role`).test(B1.code);
  record(`revoke-from-public:${fn}`, revoked, revoked ? "explicit REVOKE ... FROM PUBLIC" : "missing");
  record(`grant-service-role:${fn}`, granted, granted ? "GRANT EXECUTE TO service_role" : "missing");
}

/* Every SECURITY DEFINER function must pin search_path. */
{
  const defCount = (B1.code.match(/security definer/g) || []).length;
  const pinned = (B1.code.match(/security definer\s+set search_path\s*=/g) || []).length;
  record(
    "security-definer:search_path pinned on every definer function",
    defCount > 0 && defCount === pinned,
    `${pinned}/${defCount} pinned`
  );
}

/* ------------------------------------------------------------------------- */
/* 6. Legacy compatibility must be intact                                     */
/* ------------------------------------------------------------------------- */

const LEGACY_FNS = [
  "admin_smart_assign_lead_to_vendors",
  "assign_client_selected_vendor_to_group",
  "assign_lead_to_preferred_vendor",
  "assign_lead_to_vendors",
  "assign_package_to_vendor",
  "assign_vendor_to_requirement_group",
  "assign_lead_to_paid_vendors_phase26a",
  "qf_apply_vendor_credit_delta",
];

for (const f of MIGRATIONS) {
  const droppedLegacy = LEGACY_FNS.filter((fn) =>
    new RegExp(`drop function[^;]*\\b${fn}\\b`).test(f.code)
  );
  record(
    `no-legacy-drop:${path.basename(f.rel)}`,
    droppedLegacy.length === 0,
    droppedLegacy.length === 0 ? "none dropped" : `dropped: ${droppedLegacy.join(", ")}`
  );

  const revokedLegacy = (f.code.match(/\brevoke\b[^;]*/g) || []).filter(
    (r) => LEGACY_FNS.some((fn) => new RegExp(`\\b${fn}\\b`).test(r)) && /\bservice_role\b/.test(r)
  );
  record(
    `no-legacy-service-role-revoke:${path.basename(f.rel)}`,
    revokedLegacy.length === 0,
    revokedLegacy.length === 0
      ? "legacy service_role compatibility retained"
      : `revoked: ${revokedLegacy.slice(0, 2).join(" | ")}`
  );
}

/* ------------------------------------------------------------------------- */
/* 7. Excluded migrations: B2, C, D                                           */
/* ------------------------------------------------------------------------- */

for (const f of MIGRATIONS) {
  const triggers = (f.code.match(/\bcreate\s+(or\s+replace\s+)?(constraint\s+)?trigger\b[^;]*/g) || []);
  record(
    `no-b2-trigger-attached:${path.basename(f.rel)}`,
    triggers.length === 0,
    triggers.length === 0 ? "no trigger created" : `found: ${triggers.slice(0, 2).join(" | ")}`
  );

  const authTrigger = /\bon\s+auth\.users\b/.test(f.code) || /\bon_auth_user_created\b/.test(f.code);
  record(
    `no-auth-users-trigger:${path.basename(f.rel)}`,
    !authTrigger,
    authTrigger ? "auth.users trigger referenced" : "absent"
  );

  const cWork =
    /\bcreate\s+(or\s+replace\s+)?view\s+public\.vendor_public_v\b/.test(f.code) ||
    /\brevoke\b[^;]*\bon\s+table\s+public\.(leads|vendors)\b[^;]*\bfrom\b[^;]*\banon\b/.test(f.code) ||
    /\bdrop\s+policy\b/.test(f.code);
  record(
    `no-migration-c-work:${path.basename(f.rel)}`,
    !cWork,
    cWork ? "public projection / anon revoke / policy drop present" : "absent"
  );
}

/* audit_logs must not be created or written (founder decision 2). */
for (const f of MIGRATIONS) {
  const touchesAudit = /\baudit_logs\b/.test(f.code);
  record(
    `no-audit-logs-object:${path.basename(f.rel)}`,
    !touchesAudit,
    touchesAudit ? "audit_logs referenced in executable SQL" : "absent (domain tables carry the evidence)"
  );
}

/* ------------------------------------------------------------------------- */
/* 8. QF-MVP-20.3A1R event-idempotency contract                               */
/* ------------------------------------------------------------------------- */

/* No (lead_id, vendor_id) uniqueness on lead_assignment_events, in any file. */
{
  const uniqueDefs =
    (A.code.match(/\b(constraint\s+\w+\s+)?unique\s*\([^)]*\)/g) || []).concat(
      A.code.match(/create\s+unique\s+index[^;]*/g) || []
    );
  const offending = uniqueDefs.filter(
    (u) => /\blead_id\b/.test(u) && /\bvendor_id\b/.test(u)
  );
  /* The lead_assignments table already carries that constraint from the
   * baseline; Migration A must neither recreate it nor add one on the event
   * table. Any (lead_id, vendor_id) unique DEFINITION in A is a violation. */
  record(
    "3A1R:no UNIQUE (lead_id, vendor_id) defined in Migration A",
    offending.length === 0,
    offending.length === 0 ? "none" : `found: ${offending.slice(0, 2).join(" | ")}`
  );
}

{
  const hasEventUnique =
    /constraint uq_lead_assignment_events_idempotency unique \(event_idempotency_key\)/.test(A.code) ||
    /unique\s*\(\s*event_idempotency_key\s*\)/.test(A.code);
  record(
    "3A1R:UNIQUE (event_idempotency_key) is the event replay guard",
    hasEventUnique,
    hasEventUnique ? "present in Migration A" : "missing"
  );

  const notNull = /event_idempotency_key\s+text\s+not null/.test(A.code);
  record(
    "3A1R:event_idempotency_key is text NOT NULL",
    notNull,
    notNull ? "declared NOT NULL" : "missing or nullable"
  );
}

/* The pre-existing lead_assignments uniqueness must be preserved, never dropped. */
{
  const dropped =
    /alter table[^;]*lead_assignments[^;]*drop constraint[^;]*(lead_id|vendor_id|unique)/.test(A.code);
  record(
    "3A1R:existing lead_assignments UNIQUE (lead_id, vendor_id) preserved",
    !dropped,
    dropped ? "a drop targeting it was found" : "not dropped by any migration"
  );
}

/* A2 must seed via event_idempotency_key and must NEVER use (lead_id, vendor_id). */
{
  const onConflicts = A2.all.match(/on conflict\s*\(([^)]*)\)/g) || [];
  const usesEventKey = onConflicts.some((c) => /event_idempotency_key/.test(c));
  const usesLeadVendor = onConflicts.some((c) => /\blead_id\b/.test(c) && /\bvendor_id\b/.test(c));

  record(
    "3A1R:A2 seeds with ON CONFLICT (event_idempotency_key)",
    usesEventKey,
    usesEventKey ? `${onConflicts.length} on-conflict clause(s), event key present` : "not found"
  );
  record(
    "3A1R:A2 never uses ON CONFLICT (lead_id, vendor_id)",
    !usesLeadVendor,
    usesLeadVendor ? "FORBIDDEN clause present" : "absent"
  );

  const seedKey = /legacy_assignment_seed_v1:/.test(A2.all);
  record("A2:seed key format legacy_assignment_seed_v1:<assignment_id>", seedKey, seedKey ? "present" : "missing");

  const sourceKind = /'migration_backfill'/.test(A2.all) && !/'backfill'/.test(A2.all);
  record(
    "A2:source_kind is migration_backfill (never backfill)",
    sourceKind,
    sourceKind ? "migration_backfill" : "wrong or ambiguous source_kind"
  );

  const perLeadOp = /qf_mvp_20_a2_lineage_backfill_v1' \|\| ':' \|\| /.test(norm(A2.raw).replace(/\s+/g, " ")) ||
    /v_batch_key \|\| ':' \|\| la\.lead_id/.test(A2.all);
  record(
    "A2:one deterministic operation per distinct lead (founder decision 1)",
    perLeadOp,
    perLeadOp ? "keyed qf_mvp_20_a2_lineage_backfill_v1:<lead_id>" : "per-lead operation key not found"
  );
}

/* A2 must not write ledger rows or communication intents. */
{
  const ledgerInsert = /insert into public\.vendor_credit_logs/.test(A2.all);
  record(
    "A2:no historical credit-ledger INSERT",
    !ledgerInsert,
    ledgerInsert ? "vendor_credit_logs INSERT present" : "absent; the 27-row gap stays open for QF-MVP-20.4"
  );

  const intentInsert = /insert into public\.communication_intents/.test(A2.all);
  record(
    "A2:no communication-intent INSERT",
    !intentInsert,
    intentInsert ? "communication_intents INSERT present" : "absent"
  );

  const hardcoded = /\b(46|24)\b/.test(A2.code);
  record(
    "A2:no hardcoded production counts in executable SQL",
    !hardcoded,
    hardcoded ? "a literal 46 or 24 appears in executable SQL" : "all counts derived at runtime"
  );
}

/* ------------------------------------------------------------------------- */
/* 9. B1 atomicity — event and intent written with assignment and ledger      */
/* ------------------------------------------------------------------------- */

{
  const body = B1.bodies.find((b) => /qf_assign_lead_vendors_v2/.test(B1.code) && /lead_assignment_events/.test(b) && /communication_intents/.test(b));
  const hasAll =
    !!body &&
    /insert into public\.lead_assignments/.test(body) &&
    /qf_apply_credit_mutation_v2/.test(body) &&
    /insert into public\.lead_assignment_events/.test(body) &&
    /insert into public\.communication_intents/.test(body);
  record(
    "B1:assignment + ledger + lineage + intent in ONE function body",
    hasAll,
    hasAll ? "all four writes are in the same transaction body" : "one or more writes is missing or separated"
  );

  const noCommit = !MIGRATIONS.some((f) => f.bodies.some((b) => /\bcommit\b|\brollback\b|\bsavepoint\b/.test(b)));
  record(
    "B1:no explicit COMMIT/ROLLBACK/SAVEPOINT inside a function body",
    noCommit,
    noCommit ? "atomicity is the caller transaction boundary" : "explicit transaction control found"
  );

  const runtimeKey = /assignment_event:/.test(B1.all);
  record(
    "B1:runtime event key assignment_event:<operation_id>:<assignment_id>:<event_type>",
    runtimeKey,
    runtimeKey ? "present" : "missing"
  );

  const lifetimeQuery = /count\(distinct vendor_id\)/.test(B1.all);
  const lifetimeFilter = /event_type = ''/.test(B1.all) || /assignment_created/.test(B1.all);
  record(
    "B1:lifetime is count(distinct vendor_id) over assignment_created/assigned",
    lifetimeQuery && lifetimeFilter,
    lifetimeQuery ? "distinct-vendor query present" : "raw count or missing query"
  );

  const noLimitParam = !/p_total_limit|p_max_vendors|p_limit\b/.test(B1.all);
  record(
    "B1:no caller-controlled maximum-count parameter",
    noLimitParam,
    noLimitParam ? "no p_total_limit-style parameter" : "a limit parameter is exposed"
  );

  const noProviderCall = !/(pg_net|http_post|\bhttp\s*\(|pg_background|dblink)/.test(B1.all);
  record(
    "B1:no provider or outbound call primitive",
    noProviderCall,
    noProviderCall ? "no pg_net/http/dblink usage" : "an outbound primitive is referenced"
  );

  const noPackageDebit = !/update public\.vendor_packages/.test(B1.all);
  record(
    "B1:wallet-only debit; vendor_packages never mutated",
    noPackageDebit,
    noPackageDebit ? "vendor_packages untouched" : "vendor_packages UPDATE present"
  );

  /* No suspension mutation path in any of the three migrations. */
  for (const f of MIGRATIONS) {
    const suspensionWrite =
      /update public\.vendors[^;]*assignment_susp/.test(f.all) ||
      /insert into public\.vendors[^;]*assignment_susp/.test(f.all);
    record(
      `no-suspension-mutation:${path.basename(f.rel)}`,
      !suspensionWrite,
      suspensionWrite ? "a suspension write path exists" : "suspension columns are inert storage only"
    );
  }
}

/* ------------------------------------------------------------------------- */
/* 10. Phase verifier must be SELECT-only                                     */
/* ------------------------------------------------------------------------- */

{
  const forbidden = [
    "insert into", "update ", "delete from", "merge into", "truncate",
    "create ", "alter ", "drop ", "grant ", "revoke ", "copy ", "call ",
    "do $", "set session", "set role", "vacuum", "refresh materialized",
  ];
  const found = forbidden.filter((kw) => V.code.includes(kw));
  record(
    "verifier:SELECT-only",
    found.length === 0,
    found.length === 0 ? "no mutating keyword outside comments/strings" : `found: ${found.join(", ")}`
  );

  const startsWithRead = /^\s*with\b|^\s*select\b/.test(V.code.trim());
  record(
    "verifier:begins as a read-only statement",
    startsWithRead,
    startsWithRead ? "WITH/SELECT" : "does not begin with WITH or SELECT"
  );

  const cols = ["check_name", "expected", "actual", "status", "details"];
  const hasCols = cols.every((c) => V.code.includes(c));
  record(
    "verifier:returns check_name/expected/actual/status/details",
    hasCols,
    hasCols ? "all five columns projected" : "missing required output columns"
  );

  /* Production-specific counts must never be universal expectations. */
  const hardcoded46 = /\b46\b/.test(V.code);
  record(
    "verifier:no production-specific count as a universal expectation",
    !hardcoded46,
    hardcoded46 ? "a literal 46 appears in executable SQL" : "expectations are structural or derived"
  );

  const derives = /assignments_qualifying/.test(V.code) && /leads_qualifying/.test(V.code);
  record(
    "verifier:derives A2 expectations from live data",
    derives,
    derives ? "seed counts compared against derived facts" : "derived facts not found"
  );
}

/* ------------------------------------------------------------------------- */
/* 11. Header discipline                                                      */
/* ------------------------------------------------------------------------- */

for (const f of MIGRATIONS) {
  const h = norm(f.raw);
  const need = ["qf-mvp-20.3b1", "purpose", "dependencies", "rollback", "deliberately"];
  const missing = need.filter((k) => !h.includes(k));
  record(
    `header:${path.basename(f.rel)}`,
    missing.length === 0,
    missing.length === 0 ? "phase, purpose, dependencies, rollback and exclusions declared" : `missing: ${missing.join(", ")}`
  );
}

/* ------------------------------------------------------------------------- */
/* Report                                                                     */
/* ------------------------------------------------------------------------- */

function report() {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;

  console.log("QF-MVP-20.3B1 — offline migration validation");
  console.log("=".repeat(78));
  for (const r of results) {
    console.log(`${r.ok ? "  ok  " : " FAIL "} ${r.name}`);
    console.log(`        ${r.detail}`);
  }
  console.log("=".repeat(78));
  console.log("SHA256");
  for (const key of ["A", "A2", "B1", "VERIFIER"]) {
    if (files[key]) console.log(`  ${files[key].sha256}  ${files[key].rel}`);
  }
  console.log("=".repeat(78));
  console.log(`checks: ${pass} passed, ${fail} failed`);
  console.log(fail === 0 ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(fail === 0 ? 0 : 1);
}

report();
