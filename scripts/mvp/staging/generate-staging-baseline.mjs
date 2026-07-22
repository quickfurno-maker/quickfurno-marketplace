#!/usr/bin/env node
// ============================================================================
// QF-MVP-20.2B — Deterministic staging-baseline generator (OFFLINE)
//
// Transforms the pinned production public-schema dump into a STAGING-ONLY
// baseline: preserves schema-definition statements, strips ownership/grants/
// role statements, rejects any top-level data mutation or destructive
// statement, injects a safe search_path into the six SECURITY INVOKER helpers
// that lack one, and appends an explicit least-privilege grant block from a
// reviewed manifest. No network. No database. No secrets. No wall-clock.
//
// Output is byte-for-byte identical for identical inputs.
// ============================================================================
import fs from "node:fs";
import crypto from "node:crypto";

const GENERATOR_VERSION = "qf-mvp-20.2b/1";
const BASELINE_IDENTITY = "qf_mvp_staging_baseline_269c9265";
const BASELINE_INSTANT = "2026-07-22T00:00:00Z"; // fixed — never wall-clock
const REQUIRED_SOURCE_SHA256 =
  "269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f";
const PRODUCTION_REF = "yqpgcsduqbxulrlzwzap";
const STAGING_REF = "uckafzuochmbvtiodmcl";

// Reviewed inventory (QF-MVP-20.2A audit) — embedded as the canonical target.
// Semantic catalog counts (pg_constraint / pg_class), reconciled from the
// QF-MVP-20.2A audit. The audit's "47 unique / 178 check" were text-pattern
// line counts; the true catalog values are: unique CONSTRAINTS = 15 and unique
// INDEXES = 32 (15+32 = the audit's 47); check CONSTRAINTS below.
const EXPECT = Object.freeze({
  tables: 62, functions: 39, security_definer: 33, policies: 67,
  rls_enabled: 62, primary_keys: 62, foreign_keys: 69, unique_constraints: 15,
  check_constraints: 169, indexes: 180, triggers: 0, views: 0,
});

// The six SECURITY INVOKER helpers that lack an explicit search_path (audit §10).
const SEARCH_PATH_INJECT = new Set([
  "communication_consent_receipt_results_valid",
  "communication_consent_receipt_scope_result_valid",
  "qf_lead_vendor_parent_group_compatible",
  "qf_norm_text",
  "qf_normalize_category_label",
  "qf_parent_category_group",
]);

// ---- CLI -------------------------------------------------------------------
function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
function die(msg, code = 1) {
  console.error(`[generate-staging-baseline] ERROR: ${msg}`);
  process.exit(code);
}

const inputPath = arg("--input");
const outputPath = arg("--output");
const grantsPath = arg("--grants");
if (!inputPath || !outputPath || !grantsPath)
  die("usage: --input <schema.sql> --output <baseline.sql> --grants <manifest.json>");

// ---- Source-evidence gate --------------------------------------------------
const source = fs.readFileSync(inputPath, "utf8"); // content read; SHA is over raw bytes
const sourceSha = crypto.createHash("sha256").update(fs.readFileSync(inputPath)).digest("hex");
if (sourceSha !== REQUIRED_SOURCE_SHA256)
  die(`source SHA256 mismatch: got ${sourceSha}, require ${REQUIRED_SOURCE_SHA256}`);

// ---- SQL-aware top-level statement tokenizer -------------------------------
// Handles: line comments (--), nested block comments (/* */), single-quoted
// strings ('' escaping + E'' backslash), double-quoted identifiers ("" escaping),
// and dollar-quoted bodies with arbitrary tags ($$ / $tag$). Splits ONLY on
// top-level semicolons. Never a naive split.
function tokenize(sql) {
  const statements = [];
  let buf = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const c2 = sql[i + 1];

    // line comment
    if (c === "-" && c2 === "-") {
      while (i < n && sql[i] !== "\n") buf += sql[i++];
      continue;
    }
    // block comment (nested)
    if (c === "/" && c2 === "*") {
      let depth = 0;
      do {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; buf += "/*"; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; buf += "*/"; i += 2; }
        else buf += sql[i++];
      } while (i < n && depth > 0);
      continue;
    }
    // double-quoted identifier
    if (c === '"') {
      buf += c; i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') { buf += '""'; i += 2; continue; }
        if (sql[i] === '"') { buf += '"'; i++; break; }
        buf += sql[i++];
      }
      continue;
    }
    // single-quoted string (E-string aware)
    if (c === "'") {
      const isEString = /[eE]$/.test(buf.trimEnd()) && /(^|[^a-zA-Z0-9_])[eE]$/.test(buf.replace(/\s+$/, ""));
      buf += c; i++;
      while (i < n) {
        if (isEString && sql[i] === "\\" && i + 1 < n) { buf += sql[i] + sql[i + 1]; i += 2; continue; }
        if (sql[i] === "'" && sql[i + 1] === "'") { buf += "''"; i += 2; continue; }
        if (sql[i] === "'") { buf += "'"; i++; break; }
        buf += sql[i++];
      }
      continue;
    }
    // dollar-quoted body
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        buf += tag; i += tag.length;
        const end = sql.indexOf(tag, i);
        if (end === -1) { buf += sql.slice(i); i = n; }
        else { buf += sql.slice(i, end) + tag; i = end + tag.length; }
        continue;
      }
    }
    // top-level statement terminator
    if (c === ";") {
      buf += c;
      const t = buf.trim();
      if (t) statements.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += c; i++;
  }
  if (buf.trim()) statements.push(buf);
  return statements;
}

// strip leading comments/whitespace, return uppercased head for classification
function head(stmt) {
  let s = stmt;
  // drop leading comments / whitespace
  // (safe: classification head never sits inside a string in these DDL stmts)
  s = s.replace(/^\s+/, "");
  while (true) {
    if (s.startsWith("--")) { s = s.replace(/^--[^\n]*\n?/, ""); s = s.replace(/^\s+/, ""); continue; }
    if (s.startsWith("/*")) { const e = s.indexOf("*/"); s = e >= 0 ? s.slice(e + 2) : ""; s = s.replace(/^\s+/, ""); continue; }
    break;
  }
  return s.slice(0, 200).toUpperCase().replace(/\s+/g, " ");
}

const REJECT_LEADING = [
  /^COPY\b/, /^INSERT\b/, /^UPDATE\b/, /^DELETE\b/, /^MERGE\b/, /^TRUNCATE\b/,
  /^DROP\s+(DATABASE|SCHEMA|TABLE|FUNCTION|POLICY|ROLE)\b/,
  /^CREATE\s+ROLE\b/, /^ALTER\s+ROLE\b/, /^DROP\s+ROLE\b/,
  /^CREATE\s+(SERVER|USER\s+MAPPING|EXTENSION)\b/, /^COPY\b/,
];
const REJECT_CONTAINS = [/\bDBLINK\b/, /\bPOSTGRES_FDW\b/];
const REMOVE = [
  /^GRANT\b/, /^REVOKE\b/, /^ALTER\s+DEFAULT\s+PRIVILEGES\b/,
  /^SET\s+ROLE\b/, /^RESET\s+ROLE\b/,
  /^SET\s+SESSION\s+AUTHORIZATION\b/, /^RESET\s+SESSION\s+AUTHORIZATION\b/,
];

// Check the FULL statement (not the truncated head): long-signature
// ALTER FUNCTION ... OWNER TO would otherwise escape a head-only test.
function isOwnerStmt(stmt) {
  const s = stmt.replace(/^\s+/, "");
  return /^ALTER\s+/i.test(s) && /\sOWNER\s+TO\s/i.test(stmt);
}

// ---- Transform -------------------------------------------------------------
const statements = tokenize(source);
const kept = [];
let removedOwner = 0, removedGrant = 0, removedRevoke = 0, removedDefault = 0, removedRole = 0;
let injected = 0;
const fnSignatures = new Map(); // name -> "(...arg list...)" (Postgres-accepted, from dump grant lines)
const tableNames = [];         // ordered list of public base tables

for (const stmt of statements) {
  const h = head(stmt);
  if (!h) continue;

  for (const re of REJECT_LEADING) if (re.test(h)) die(`top-level prohibited statement rejected: "${h.slice(0, 60)}…"`);
  for (const re of REJECT_CONTAINS) if (re.test(h)) die(`external-connection statement rejected: "${h.slice(0, 60)}…"`);

  // Capture authoritative function signatures from the (to-be-removed) grant lines.
  const sigM = /ON FUNCTION "public"\."([a-z_0-9]+)"(\([^;]*?\))\s+(?:TO|FROM)\b/i.exec(stmt);
  if (sigM && !fnSignatures.has(sigM[1])) fnSignatures.set(sigM[1], sigM[2].replace(/\s+/g, " ").trim());

  if (isOwnerStmt(stmt)) { removedOwner++; continue; }
  if (/^GRANT\b/.test(h)) { removedGrant++; continue; }
  if (/^REVOKE\b/.test(h)) { removedRevoke++; continue; }
  if (/^ALTER\s+DEFAULT\s+PRIVILEGES\b/.test(h)) { removedDefault++; continue; }
  if (REMOVE.some((re) => re.test(h))) { removedRole++; continue; }

  // Capture base-table names (order preserved).
  const tblM = /^CREATE TABLE (?:IF NOT EXISTS )?"public"\."([a-z_0-9]+)"/i.exec(stmt.replace(/^\s+/, ""));
  if (tblM) tableNames.push(tblM[1]);

  // search_path injection for the six invoker helpers lacking one
  let out = stmt;
  const fnMatch = /^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+"PUBLIC"\."([A-Z_0-9]+)"/.exec(h);
  if (fnMatch) {
    const fname = fnMatch[2].toLowerCase();
    if (SEARCH_PATH_INJECT.has(fname) && !/SET\s+"?SEARCH_PATH"?/.test(h.toUpperCase()) && !/SET\s+"search_path"/i.test(stmt)) {
      // insert a safe search_path clause immediately before the body-opening ` AS $`
      const bodyAt = stmt.search(/\n?\s*AS\s+\$/);
      if (bodyAt === -1) die(`cannot locate body for search_path injection in ${fname}`);
      out = stmt.slice(0, bodyAt) + `\n    SET "search_path" TO 'pg_catalog', 'public'` + stmt.slice(bodyAt);
      injected++;
    }
  }
  kept.push(out);
}

if (injected !== SEARCH_PATH_INJECT.size)
  die(`search_path injection count ${injected} != expected ${SEARCH_PATH_INJECT.size}`);

// ---- Count what we kept (semantic, per-statement classification) -----------
const lead = (s) => s.replace(/^\s+/, "");
const isTableStmt = (s) => /^CREATE TABLE /.test(lead(s));
const isFnStmt = (s) => /^CREATE (OR REPLACE )?FUNCTION /.test(lead(s));
const isAddConstraint = (s) => /^ALTER TABLE /.test(lead(s)) && /ADD CONSTRAINT/.test(s);
const isIndexStmt = (s) => /^CREATE (UNIQUE )?INDEX /.test(lead(s));

const actual = {
  tables: kept.filter(isTableStmt).length,
  functions: kept.filter(isFnStmt).length,
  security_definer: kept.filter((s) => isFnStmt(s) && /SECURITY DEFINER/.test(s)).length,
  policies: kept.filter((s) => /^CREATE POLICY /.test(lead(s))).length,
  rls_enabled: kept.filter((s) => /ENABLE ROW LEVEL SECURITY/.test(s)).length,
  primary_keys: kept.filter((s) => isAddConstraint(s) && /PRIMARY KEY/.test(s)).length,
  foreign_keys: kept.filter((s) => isAddConstraint(s) && /FOREIGN KEY/.test(s)).length,
  // Semantic constraint counts: CHECK only inside CREATE TABLE + ADD CONSTRAINT
  // (never CREATE FUNCTION bodies, never CREATE POLICY's WITH CHECK).
  unique_constraints: kept.filter((s) => isAddConstraint(s) && /\bUNIQUE\b/.test(s)).length,
  check_constraints:
    kept.filter((s) => isAddConstraint(s) && /\bCHECK\b/.test(s)).length +
    kept.filter(isTableStmt).reduce((a, s) => a + (s.match(/CHECK \(/g)?.length ?? 0), 0),
  indexes: kept.filter(isIndexStmt).length,
  unique_indexes: kept.filter((s) => /^CREATE UNIQUE INDEX /.test(lead(s))).length,
  triggers: kept.filter((s) => /^CREATE (CONSTRAINT )?TRIGGER /i.test(lead(s))).length,
  views: kept.filter((s) => /^CREATE (OR REPLACE )?(MATERIALIZED )?VIEW /i.test(lead(s))).length,
};

const mismatches = Object.entries(EXPECT).filter(([k, v]) => actual[k] !== v);
if (mismatches.length)
  die(`emitted object counts disagree with reviewed inventory: ` +
    mismatches.map(([k, v]) => `${k} expected ${v} got ${actual[k]}`).join("; ") +
    ` | full=${JSON.stringify(actual)}`);

// ---- Build the explicit least-privilege grant block from the manifest ------
const manifest = JSON.parse(fs.readFileSync(grantsPath, "utf8"));
function q(id) { return `"${id}"`; }
function role(r) { return r === "PUBLIC" ? "PUBLIC" : q(r); }
if (fnSignatures.size !== EXPECT.functions)
  die(`derived ${fnSignatures.size} function signatures, expected ${EXPECT.functions}`);
if (tableNames.length !== EXPECT.tables)
  die(`derived ${tableNames.length} table names, expected ${EXPECT.tables}`);

const fnOverride = new Map((manifest.function_policy.overrides ?? []).map((o) => [o.name, o]));
const tblOverride = new Map((manifest.table_policy.overrides ?? []).map((o) => [o.name, o]));
const fnDefault = manifest.function_policy.default;
const tblDefault = manifest.table_policy.default;

const grantLines = [];
grantLines.push("-- ---------------------------------------------------------------------------");
grantLines.push("-- Explicit least-privilege grants (rules from staging-baseline-grants.json,");
grantLines.push("-- signatures derived from the pinned source). NOT copied from production.");
grantLines.push("-- No blanket GRANT ALL to anon/authenticated; no default-privilege grants for");
grantLines.push("-- anon/authenticated. Every mutation RPC is service_role-only. anon receives");
grantLines.push("-- NO table access and NO monetization reads.");
grantLines.push("-- ---------------------------------------------------------------------------");
grantLines.push(`GRANT USAGE ON SCHEMA ${q("public")} TO ${manifest.schema_usage.roles.map(q).join(", ")};`);
grantLines.push("");
grantLines.push("-- Functions (all 39): default-deny to PUBLIC/anon/authenticated; explicit allow-list.");
for (const name of [...fnSignatures.keys()].sort()) {
  const sig = fnSignatures.get(name);
  const ref = `${q("public")}.${q(name)}${sig}`;
  const ov = fnOverride.get(name);
  const grantTo = ov?.grant_execute ?? fnDefault.grant_execute;
  grantLines.push(`REVOKE ALL ON FUNCTION ${ref} FROM ${fnDefault.revoke_from.map(role).join(", ")};`);
  if (grantTo?.length) grantLines.push(`GRANT EXECUTE ON FUNCTION ${ref} TO ${grantTo.map(q).join(", ")};`);
}
grantLines.push("");
grantLines.push("-- Tables (all 62): default-deny to PUBLIC/anon/authenticated; service_role operational.");
for (const name of [...tableNames].sort()) {
  const ref = `${q("public")}.${q(name)}`;
  const ov = tblOverride.get(name);
  const grants = ov?.grants ?? tblDefault.grants;
  grantLines.push(`REVOKE ALL ON TABLE ${ref} FROM ${tblDefault.revoke_from.map(role).join(", ")};`);
  for (const g of grants ?? [])
    grantLines.push(`GRANT ${g.privileges.join(", ")} ON TABLE ${ref} TO ${g.roles.map(q).join(", ")};`);
}

// ---- Header + preflight ----------------------------------------------------
const header = `-- ============================================================================
-- QF-MVP-20 STAGING BASELINE — DO NOT APPLY TO PRODUCTION
-- ============================================================================
-- Identity           : ${BASELINE_IDENTITY}
-- Generator          : ${GENERATOR_VERSION}
-- Baseline instant   : ${BASELINE_INSTANT} (fixed; not wall-clock)
-- Source schema      : production public schema (schema-only)
-- Source SHA256      : ${REQUIRED_SOURCE_SHA256}
-- Production ref      : ${PRODUCTION_REF}   <-- PROHIBITED apply target
-- Staging ref         : ${STAGING_REF}   <-- the ONLY permitted apply target
--
-- * Reconstructs the reviewed current public schema for STAGING only.
-- * Production table DATA is EXCLUDED (schema-only source; zero rows).
-- * Production ownership, grants, and default privileges are NOT reproduced;
--   an explicit least-privilege grant block is appended instead.
-- * The four public/anon assignment RPC blockers are service_role-only here.
-- * This file lives OUTSIDE supabase/migrations INTENTIONALLY so that
--   'supabase db push' can never discover or apply it.
-- * MUST NEVER be applied to production ${PRODUCTION_REF}.
-- * Applied under one controlled identity (${BASELINE_IDENTITY}) in QF-MVP-20.2C.
-- ============================================================================

-- Restore-session settings (schema-definition only; functions precede their
-- referenced tables, hence check_function_bodies=false — proven-safe pg_dump order).
`;

const preflight = `
-- ---------------------------------------------------------------------------
-- Staging preflight: abort unless the target is an EMPTY QuickFurno-free
-- Supabase project with the managed prerequisites present. No secrets read.
-- ---------------------------------------------------------------------------
DO $qf_preflight$
BEGIN
  IF (SELECT count(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE') > 0 THEN
    RAISE EXCEPTION 'ABORT: public schema already has base tables; baseline expects an EMPTY project.';
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'ABORT: auth.users not found; managed Auth schema is required.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gen_random_uuid') THEN
    RAISE EXCEPTION 'ABORT: gen_random_uuid() not available; enable it before applying.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'ABORT: managed roles anon/authenticated/service_role must all exist.';
  END IF;
END
$qf_preflight$;
`;

const summary = `
-- ---------------------------------------------------------------------------
-- Reviewed object inventory (QF-MVP-20.2A) reproduced by this baseline:
--   tables=${EXPECT.tables} functions=${EXPECT.functions} security_definer=${EXPECT.security_definer}
--   policies=${EXPECT.policies} rls_enabled=${EXPECT.rls_enabled} indexes=${EXPECT.indexes}
--   primary_keys=${EXPECT.primary_keys} foreign_keys=${EXPECT.foreign_keys}
--   unique_constraints=${EXPECT.unique_constraints} check_constraints=${EXPECT.check_constraints}
--   triggers=${EXPECT.triggers} views=${EXPECT.views}
-- Removed from source: owner=${removedOwner} grant=${removedGrant} revoke=${removedRevoke} default_priv=${removedDefault} role/session=${removedRole}
-- search_path injected into ${injected} SECURITY INVOKER helper(s).
-- ---------------------------------------------------------------------------
`;

const body = kept.join("\n") + "\n";
const output =
  header + "\n" +
  preflight + "\n" +
  summary + "\n" +
  "-- === Reviewed schema-definition statements (ownership/grants stripped) ===\n" +
  body + "\n" +
  grantLines.join("\n") + "\n" +
  `\n-- End of ${BASELINE_IDENTITY}. STAGING ONLY. NEVER apply to ${PRODUCTION_REF}.\n`;

fs.writeFileSync(outputPath, output, "utf8");
const outSha = crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex");
console.log(`[generate-staging-baseline] OK`);
console.log(`  source_sha256   = ${sourceSha}`);
console.log(`  output          = ${outputPath}`);
console.log(`  output_sha256   = ${outSha}`);
console.log(`  counts          = ${JSON.stringify(actual)}`);
console.log(`  removed         = owner:${removedOwner} grant:${removedGrant} revoke:${removedRevoke} default:${removedDefault} role:${removedRole}`);
console.log(`  search_path_inj = ${injected}`);
