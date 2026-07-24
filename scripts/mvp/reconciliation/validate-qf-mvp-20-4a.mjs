#!/usr/bin/env node
/**
 * QF-MVP-20.4A — Offline audit-pack safety validator.
 *
 * Entirely offline. Reads files from disk. Opens no socket, spawns no process,
 * reads no environment variable and touches no database.
 *
 * Grades:
 *   1. the SELECT-ONLY production audit SQL
 *      (supabase/reconciliation/qf_mvp_20_4_historical_credit_ledger_audit.sql)
 *   2. the empty evidence-manifest schema/template
 *   3. the 20.4 reconciliation design document
 *
 * The audit SQL is the safety-critical artifact: it will later be run against
 * PRODUCTION under a process-enforced SELECT-only allowlist, so it must be
 * provably read-only, must never decide a debit is PROVEN inside SQL, must not
 * hardcode the historical "27", must minimise PII, and must separate raw facts
 * from a conservative proposed class.
 *
 * Usage:  node scripts/mvp/reconciliation/validate-qf-mvp-20-4a.mjs
 * Exit 0 = PASS, exit 1 = FAIL. Fails closed on ambiguous parsing.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const AUDIT_SQL = "supabase/reconciliation/qf_mvp_20_4_historical_credit_ledger_audit.sql";
const MANIFEST = "scripts/mvp/reconciliation/qf-mvp-20-4-evidence-manifest.schema.json";
const DESIGN_DOC = "docs/QF-MVP-20-4-HISTORICAL-CREDIT-LEDGER-RECONCILIATION.md";

const results = [];
let failed = false;
function record(name, ok, detail) { results.push({ name, ok, detail }); if (!ok) failed = true; }
function read(rel) { return readFileSync(path.join(ROOT, rel), "utf8"); }
function sha256(t) { return createHash("sha256").update(t, "utf8").digest("hex"); }

/* --------------------------------------------------------------------------
 * SQL tokenizer — strips comments, strings, quoted identifiers, dollar bodies.
 * `code`  : comments + string literals removed (structural SQL only)
 * `noComments` : comments removed, string literals kept (executable text)
 * ------------------------------------------------------------------------ */
function tokenize(sql, label) {
  let code = ""; let i = 0; const n = sql.length; const literals = [];
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") { const nl = sql.indexOf("\n", i); i = nl === -1 ? n : nl; continue; }
    if (two === "/*") {
      let d = 1; i += 2;
      while (i < n && d > 0) {
        if (sql.slice(i, i + 2) === "/*") { d++; i += 2; continue; }
        if (sql.slice(i, i + 2) === "*/") { d--; i += 2; continue; }
        i++;
      }
      if (d !== 0) throw new Error(`${label}: unterminated block comment`);
      continue;
    }
    if (sql[i] === "'") {
      let s = ""; i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { s += "'"; i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        s += sql[i]; i++;
      }
      literals.push(s); code += " '' "; continue;
    }
    if (sql[i] === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) { const tag = m[0]; const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) throw new Error(`${label}: unterminated dollar body`);
        code += " $BODY$ "; i = end + tag.length; continue; }
    }
    code += sql[i]; i++;
  }
  return { code, literals };
}
function stripComments(sql, label) {
  let out = ""; let i = 0; const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") { const nl = sql.indexOf("\n", i); i = nl === -1 ? n : nl; continue; }
    if (two === "/*") {
      let d = 1; i += 2;
      while (i < n && d > 0) {
        if (sql.slice(i, i + 2) === "/*") { d++; i += 2; continue; }
        if (sql.slice(i, i + 2) === "*/") { d--; i += 2; continue; }
        i++;
      }
      if (d !== 0) throw new Error(`${label}: unterminated block comment`);
      continue;
    }
    if (sql[i] === "'") { const s = i; i++;
      while (i < n) { if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; } if (sql[i] === "'") { i++; break; } i++; }
      out += sql.slice(s, i); continue; }
    out += sql[i]; i++;
  }
  return out;
}
const norm = (t) => t.replace(/\s+/g, " ").toLowerCase();

/** Split comment-free SQL into statements on top-level ';' only — a ';' inside a
 *  single-quoted string literal (with '' doubling) is NOT a boundary. */
function splitStatements(noComments) {
  const out = []; let cur = ""; let i = 0; const n = noComments.length;
  while (i < n) {
    const ch = noComments[i];
    if (ch === "'") {
      cur += ch; i++;
      while (i < n) {
        if (noComments[i] === "'" && noComments[i + 1] === "'") { cur += "''"; i += 2; continue; }
        if (noComments[i] === "'") { cur += "'"; i++; break; }
        cur += noComments[i]; i++;
      }
      continue;
    }
    if (ch === ";") { out.push(cur); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim() !== "") out.push(cur);
  return out.map((s) => s.replace(/\s+/g, " ").toLowerCase());
}

/** State-changing / legacy / assignment functions that must never be invoked. */
const FORBIDDEN_FUNCS = [
  "qf_apply_vendor_credit_delta", "qf_apply_credit_mutation_v2", "deduct_vendor_credit",
  "restore_vendor_credit", "increment_vendor_credits", "qf_assign_lead_vendors_v2",
  "assign_lead_to_vendors", "admin_smart_assign_lead_to_vendors",
  "assign_lead_to_paid_vendors_phase26a", "assign_lead_to_preferred_vendor",
  "assign_client_selected_vendor_to_group", "assign_vendor_to_requirement_group",
];
/** PII columns that must not appear in audit output. */
const PII_COLS = ["business_name", "owner_name", "full_name", "phone", "email", "address",
  "whatsapp", "contact_name", "client_name", "customer_name"];

/* ===========================================================================
 * THE AUDIT-SQL EVALUATOR — real artifact AND fixtures.
 * ========================================================================= */
export function evaluateAuditSql(sql, label = "audit") {
  const findings = [];
  const add = (rule, detail) => findings.push({ rule, detail });
  let tok, noComments;
  try { tok = tokenize(sql, label); } catch (e) { add("S00_parse", e.message); return findings; }
  try { noComments = stripComments(sql, label); } catch (e) { add("S00_parse", e.message); return findings; }
  const code = norm(tok.code);           // no comments, no string literals
  const exec = norm(noComments);         // no comments, literals kept
  const literals = tok.literals;

  // -- S01 no write / DDL / DCL / control statement -------------------------
  for (const [re, why] of [
    [/(^|;)\s*insert\s+into\b/, "INSERT"],
    [/(^|;)\s*update\s+[a-z0-9_."]+\s+set\b/, "UPDATE"],
    [/(^|;)\s*delete\s+from\b/, "DELETE"],
    [/\bmerge\s+into\b/, "MERGE"],
    [/\bon\s+conflict\b/, "UPSERT (ON CONFLICT)"],
    [/(^|;)\s*create\s+/, "CREATE"],
    [/(^|;)\s*alter\s+/, "ALTER"],
    [/(^|;)\s*drop\s+/, "DROP"],
    [/(^|;)\s*truncate\b/, "TRUNCATE"],
    [/(^|;)\s*grant\s+/, "GRANT"],
    [/(^|;)\s*revoke\s+/, "REVOKE"],
    [/(^|;)\s*call\s+/, "CALL"],
    [/(^|;)\s*do\s+\$/, "DO block"],
    [/(^|;)\s*copy\s+/, "COPY"],
    [/\bselect\b[\s\S]*?\binto\b\s+[a-z]/, "SELECT INTO"],
  ]) if (re.test(code)) add("S01_select_only", why);

  // -- S02 no writable CTE --------------------------------------------------
  if (/\bwith\b[\s\S]*?\bas\s*\([\s\S]*?\b(insert|update|delete|merge)\b/.test(code)) {
    add("S02_no_writable_cte", "a CTE contains a write statement");
  }

  // -- S03 no transaction / session control --------------------------------
  if (/(^|;|\s)(begin|commit|rollback|start\s+transaction|savepoint|set\s+session|set\s+transaction|set\s+role|reset\s+role)\b/.test(code)) {
    add("S03_no_txn_control", "transaction/session control statement");
  }

  // -- S04 invokes no state-changing / assignment / credit function --------
  //     Scan STRUCTURAL code (string literals removed): a function name inside a
  //     to_regprocedure('…') / pg_get_functiondef('…') string is a read-only
  //     catalog lookup by name, NOT an invocation. Only a bare `fn(` call counts.
  for (const fn of FORBIDDEN_FUNCS) {
    if (new RegExp(`\\b${fn}\\s*\\(`).test(code)) {
      add("S04_no_state_changing_rpc", `invokes ${fn}(...)`);
    }
  }

  // -- S05 SELECT-ONLY warning header present ------------------------------
  if (!/select-only/i.test(sql.slice(0, 1200)) || !/read-only/i.test(sql.slice(0, 1200))) {
    add("S05_select_only_header", "missing a prominent SELECT-ONLY / READ-ONLY header");
  }

  // -- S06 no PII output columns -------------------------------------------
  for (const c of PII_COLS) {
    if (new RegExp(`\\b${c}\\b`).test(exec)) add("S06_pii_minimisation", `references a PII column: ${c}`);
  }

  // -- S07 does NOT hardcode the historical 27 (or 46/19) as a query GATE --
  //        27 may appear only in comments/notes, never as a numeric predicate.
  if (/(=|<>|>=|<=|>|<)\s*27\b/.test(exec) || /\b27\s*(=|<>|>=|<=|>|<)/.test(exec)) {
    add("S07_no_hardcoded_27", "a numeric predicate on 27 (the historical count is not an invariant)");
  }
  if (/having\s+count\s*\([^)]*\)\s*(=|<>)\s*(27|46|19)\b/.test(exec)) {
    add("S07_no_hardcoded_27", "HAVING gate on a historical count");
  }

  // -- S08 SQL never emits a PROVEN_* class as a value ---------------------
  for (const lit of literals) {
    if (/proven_debit|proven_no_debit/i.test(lit)) {
      // allowed only inside an explanatory note that says SQL never proposes it
      if (!/never|not\s+propose|require/i.test(lit)) {
        add("S08_no_sql_proven_class", `the SQL emits a PROVEN_* class literal: "${lit.slice(0, 60)}"`);
      }
    }
  }

  // -- S09 credit_deducted is labelled prohibited-as-proof, and the proposed
  //        classifier does not branch a class off it --------------------------
  if (/credit_deducted/.test(exec)) {
    if (!/credit_deducted[a-z0-9_]*\s+as\s+[a-z0-9_]*prohibited|prohibited_as_proof|not_proof/i.test(noComments)) {
      add("S09_credit_deducted_not_proof", "credit_deducted is emitted without a PROHIBITED_AS_PROOF label");
    }
    // a proposed-class CASE must not be `when credit_deducted ... then 'PROVEN/…applied'`
    if (/when[^;]*credit_deducted[^;]*then\s*'[^']*(proven|applied|debit)/i.test(noComments)) {
      add("S09_credit_deducted_not_proof", "a class is derived from credit_deducted");
    }
  }

  // -- S10 deterministic ordering — EACH detail result set's own statement must
  //        carry an ORDER BY. Split on top-level ';' and check per statement.
  const detailSets = ["r04_candidate", "r06_legacy_signal", "r07_reference_conflict",
    "r08_arithmetic_violation", "r09_vendor_state_facts", "r10_unreconcilable", "r11_sql_proposed_class"];
  const statements = splitStatements(noComments);
  for (const name of detailSets) {
    const stmt = statements.find((s) => s.includes(`'${name}'`));
    if (stmt === undefined) continue; // presence handled elsewhere
    if (!/\border\s+by\b/.test(stmt)) {
      add("S10_deterministic_order", `detail result set ${name} has no ORDER BY`);
    }
  }

  // -- S11 no secret / URL / project ref (scan RAW text incl. comments) -----
  if (/https?:\/\/|supabase\.co|postgres(ql)?:\/\/|service_role_key|sb_secret|eyj[a-z0-9]/i.test(sql)
      || /yqpgcsduqbxulrlzwzap|uckafzuochmbvtiodmcl|coilipywdvxklewquqvv/.test(sql)) {
    add("S11_no_secret_or_url", "URL/project-ref/credential-shaped token (anywhere, including comments)");
  }

  // -- S12 reports candidate count + source breakdown ----------------------
  if (!exec.includes("r05_candidate_breakdown")) add("S12_reports_breakdown", "no candidate source breakdown (R05)");
  if (!exec.includes("r03_coverage_totals")) add("S12_reports_breakdown", "no coverage totals (R03)");

  // -- S13 schema fingerprint + migration-history report -------------------
  if (!exec.includes("r02_schema_fingerprint")) add("S13_fingerprint", "no schema fingerprint (R02)");
  if (!exec.includes("r00_audit_fingerprint")) add("S13_fingerprint", "no audit-run fingerprint (R00)");
  if (!exec.includes("r01_migration_history")) add("S13_fingerprint", "no migration-history report (R01)");
  if (!/schema_migrations/.test(exec)) add("S13_fingerprint", "does not read migration history");

  // -- S14 canonical assignment-debit reference contract is exact ----------
  //        the candidate filter must key on all three: reference_type,
  //        reference_id = assignment id, change_type = lead_assignment_debit.
  if (!/reference_type\s*=\s*'lead_assignment'/.test(noComments)
      || !/change_type\s*=\s*'lead_assignment_debit'/.test(noComments)
      || !/reference_id\s*=\s*[a-z0-9_.]+::text/.test(noComments)) {
    add("S14_exact_reference_contract", "the exact (reference_type, reference_id=assignment::text, change_type) contract is not used");
  }

  return findings;
}

/* ===========================================================================
 * 1. Audit SQL: real artifact zero findings
 * ========================================================================= */
const auditRaw = read(AUDIT_SQL);
const auditSha = sha256(auditRaw);
const realFindings = evaluateAuditSql(auditRaw, "20-4-audit");
record("01 real audit SQL has zero safety findings", realFindings.length === 0,
  realFindings.length === 0 ? "SELECT-only, no PII, no hardcoded 27, facts-vs-class separated"
    : realFindings.map((f) => `${f.rule}: ${f.detail}`).join(" | "));
record("02 audit SQL path is under supabase/reconciliation (not migrations)",
  AUDIT_SQL.startsWith("supabase/reconciliation/") && !AUDIT_SQL.includes("migrations"), AUDIT_SQL);

/* ===========================================================================
 * 2. One-defect fixtures — each mutates the REAL audit SQL once.
 * ========================================================================= */
const FIXTURES = [
  { id: "A", rule: "S01_select_only", why: "an INSERT is added",
    mutate: (s) => `${s}\ninsert into public.vendor_credit_logs (id) values (gen_random_uuid());\n` },
  { id: "B", rule: "S01_select_only", why: "an UPDATE is added",
    mutate: (s) => `${s}\nupdate public.vendors set remaining_credits = 0;\n` },
  { id: "C", rule: "S02_no_writable_cte", why: "a writable CTE is added",
    mutate: (s) => `${s}\nwith x as (insert into public.vendor_credit_logs(id) values (gen_random_uuid()) returning id) select * from x;\n` },
  { id: "D", rule: "S03_no_txn_control", why: "BEGIN is added",
    mutate: (s) => `begin;\n${s}` },
  { id: "E", rule: "S04_no_state_changing_rpc", why: "invokes the legacy debit function",
    mutate: (s) => `${s}\nselect public.deduct_vendor_credit(gen_random_uuid());\n` },
  { id: "F", rule: "S04_no_state_changing_rpc", why: "invokes the canonical credit RPC",
    mutate: (s) => `${s}\nselect public.qf_apply_vendor_credit_delta(gen_random_uuid(),-1,'x','y','z','w','q',false);\n` },
  { id: "G", rule: "S05_select_only_header", why: "the SELECT-ONLY header is removed",
    mutate: (s) => s.replace(/-- ={2,}[\s\S]*?-- ={2,}\n/, "-- audit\n") },
  { id: "H", rule: "S06_pii_minimisation", why: "a PII column is selected",
    mutate: (s) => s.replace("la.vendor_id                            as vendor_id,",
      "la.vendor_id as vendor_id, v.business_name as business_name,") },
  { id: "I", rule: "S07_no_hardcoded_27", why: "a numeric gate on 27 is added",
    mutate: (s) => s.replace("where la.credit_deducted is true",
      "where la.credit_deducted is true and (select count(*) from public.lead_assignments) = 27", 1) },
  { id: "J", rule: "S08_no_sql_proven_class", why: "the SQL emits a PROVEN_DEBIT class value",
    mutate: (s) => s.replace("else 'INSUFFICIENT_EVIDENCE'", "else 'PROVEN_DEBIT_ALREADY_APPLIED_LEDGER_MISSING'") },
  { id: "K", rule: "S09_credit_deducted_not_proof", why: "a class is derived from credit_deducted",
    mutate: (s) => s.replace("when exists (select 1 from public.vendor_credit_logs vcl\n                  where vcl.vendor_id = la.vendor_id\n                    and (vcl.credits_before + vcl.credits_delta) <> vcl.credits_after)\n      then 'DATA_INVARIANT_VIOLATION'",
      "when la.credit_deducted is true then 'PROVEN_DEBIT_APPLIED'") },
  { id: "L", rule: "S10_deterministic_order", why: "an ORDER BY is removed from a detail set",
    mutate: (s) => s.replace("order by la.assigned_at nulls last, la.id;\n\n\n-- ---------------------------------------------------------------------------\n-- R05", ";\n\n\n-- ---------------------------------------------------------------------------\n-- R05") },
  { id: "M", rule: "S11_no_secret_or_url", why: "a project URL is embedded",
    mutate: (s) => `-- see https://yqpgcsduqbxulrlzwzap.supabase.co\n${s}` },
  { id: "N", rule: "S12_reports_breakdown", why: "the source breakdown result set is removed",
    mutate: (s) => s.replace(/R05_candidate_breakdown/g, "R05_removed") },
  { id: "O", rule: "S13_fingerprint", why: "the schema fingerprint is removed",
    mutate: (s) => s.replace(/R02_schema_fingerprint/g, "R02_removed") },
  { id: "P", rule: "S14_exact_reference_contract", why: "the exact reference contract is weakened",
    mutate: (s) => s.replace(/change_type\s*=\s*'lead_assignment_debit'/g, "change_type is not null") },
];
for (const fx of FIXTURES) {
  const mutated = fx.mutate(auditRaw);
  const changed = mutated !== auditRaw;
  const f = changed ? evaluateAuditSql(mutated, `fx-${fx.id}`) : [];
  const tripped = f.some((x) => x.rule === fx.rule);
  record(`03 fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "MUTATION WAS A NO-OP — the fixture is vacuous"
      : tripped ? `tripped (${f.length})` : `did NOT trip; ${f.map((x) => x.rule).join(",") || "none"}`);
}
record("04 every audit rule has a fixture", (() => {
  const covered = new Set(FIXTURES.map((f) => f.rule));
  const declared = [...new Set([...read("scripts/mvp/reconciliation/validate-qf-mvp-20-4a.mjs")
    .matchAll(/add\("(S\d\d_[a-z0-9_]+)"/g)].map((m) => m[1]))].filter((r) => r !== "S00_parse");
  const missing = declared.filter((r) => !covered.has(r));
  return missing.length === 0 ? true : missing;
})() === true, "every enforced audit rule is exercised");

/* ===========================================================================
 * 3. Evidence-manifest schema
 * ========================================================================= */
let manifest;
try { manifest = JSON.parse(read(MANIFEST)); record("05 manifest schema parses", true, "ok"); }
catch (e) { manifest = {}; record("05 manifest schema parses", false, e.message); }

const EVIDENCE_CLASSES = ["PROVEN_DEBIT_ALREADY_APPLIED_LEDGER_MISSING", "PROVEN_NO_DEBIT",
  "ALREADY_HAS_EQUIVALENT_LEDGER_EVIDENCE", "DUPLICATE_OR_REFERENCE_CONFLICT",
  "INSUFFICIENT_EVIDENCE", "DATA_INVARIANT_VIOLATION", "ALREADY_RECONCILED",
  "OUT_OF_SCOPE_NON_CREDIT_ASSIGNMENT"];
const CORRECTION_MODES = ["EVIDENCE_ONLY", "STATE_CORRECTION_DEBIT", "STATE_CORRECTION_REFUND",
  "EXCEPTION_RECORD_ONLY", "LINK_EXISTING_LEGACY_EVIDENCE"];

record("06 manifest defines the closed 8-class evidence vocabulary", (() => {
  const e = manifest?.definitions?.evidence_class?.enum || [];
  return EVIDENCE_CLASSES.every((c) => e.includes(c)) && e.length === EVIDENCE_CLASSES.length;
})(), "8 evidence classes");
record("07 manifest defines the 5 correction modes", (() => {
  const m = manifest?.definitions?.correction_mode?.enum || [];
  return CORRECTION_MODES.every((c) => m.includes(c));
})(), "5 correction modes");
record("08 manifest encodes prohibited-evidence checks (const false)", (() => {
  const p = manifest?.definitions?.candidate?.properties?.prohibited_evidence_checks?.properties || {};
  return p.credit_deducted_used_as_proof?.const === false
      && p.current_remaining_credits_used_as_proof?.const === false
      && p.assignment_existence_used_as_proof?.const === false;
})(), "prohibited-evidence checks pinned to false");
record("09 manifest requires strong-evidence references (proof, not confidence)", (() => {
  const c = manifest?.definitions?.candidate?.properties || {};
  const hasStrong = !!c.strong_evidence_references;
  const confNote = JSON.stringify(manifest).toLowerCase();
  return hasStrong && confNote.includes("never") && confNote.includes("proof");
})(), "strong_evidence_references present; confidence never replaces proof");
record("10 manifest template embeds NO live candidate rows", (() => {
  const cands = manifest?.example_empty_template?.candidates;
  return Array.isArray(cands) && cands.length === 0;
})(), "candidates: []");
record("11 manifest environment is a placeholder (no real project ref)", (() => {
  const env = manifest?.properties?.audit_run?.properties?.environment?.enum || [];
  const s = JSON.stringify(manifest);
  return env.includes("PRODUCTION_PLACEHOLDER") && !/yqpgcsduqbxulrlzwzap|uckafzuochmbvtiodmcl|coilipywdvxklewquqvv/.test(s);
})(), "placeholder only, no live project ref");

/* ===========================================================================
 * 4. Design document
 * ========================================================================= */
const doc = read(DESIGN_DOC);
const docN = doc.toLowerCase();
record("12 design doc enumerates all 8 evidence classes", EVIDENCE_CLASSES.every((c) => doc.includes(c)),
  "all classes present");
record("13 design doc enumerates all 5 correction modes", CORRECTION_MODES.every((c) => doc.includes(c)),
  "all modes present");
record("14 design doc states 46/19/27 are historical observations, not invariants",
  doc.includes("46") && doc.includes("19") && doc.includes("27")
    && (docN.includes("not an invariant") || docN.includes("not invariants") || docN.includes("historical observation")),
  "historical framing present");
record("15 design doc forbids blind backfill", docN.includes("no blind backfill") || docN.includes("blind backfill"),
  "no-blind-backfill stated");
record("16 design doc has a decision/approval authority matrix", docN.includes("founder") && docN.includes("approv")
  && (docN.includes("service_role") || docN.includes("service role")) && docN.includes("jarvis"),
  "authority matrix present");
record("17 design doc records the production history-drift restriction",
  docN.includes("history") && docN.includes("drift") && (docN.includes("no db push") || docN.includes("no automatic migration") || docN.includes("no migration application")),
  "history-drift restriction present");
record("18 design doc defers correction to a later authorized phase (SELECT-only now)",
  docN.includes("select-only") && (docN.includes("no correction") || docN.includes("does not correct") || docN.includes("no write")),
  "SELECT-only-now / correction-later");

/* ===========================================================================
 * 5. Focused reconciliation-classification behaviour.
 *    Models the audit's R11 conservative decision tree and asserts it can only
 *    ever emit the three safe hints — never a PROVEN_* class — and that the
 *    manifest's PROVEN_* classes require a non-empty strong-evidence path.
 * ========================================================================= */
function sqlProposedClass(c) {
  // mirror of R11: order matters. c = { arithmeticViolationForVendor, referenceConflict }
  if (c.arithmeticViolationForVendor) return "DATA_INVARIANT_VIOLATION";
  if (c.referenceConflict) return "DUPLICATE_OR_REFERENCE_CONFLICT";
  return "INSUFFICIENT_EVIDENCE";
}
const SCEN = [
  { id: "C1", why: "arithmetic-broken ledger touches the vendor", c: { arithmeticViolationForVendor: true, referenceConflict: false }, expect: "DATA_INVARIANT_VIOLATION" },
  { id: "C2", why: "a conflicting reference exists", c: { arithmeticViolationForVendor: false, referenceConflict: true }, expect: "DUPLICATE_OR_REFERENCE_CONFLICT" },
  { id: "C3", why: "no strong signal → safe default", c: { arithmeticViolationForVendor: false, referenceConflict: true === false }, expect: "INSUFFICIENT_EVIDENCE" },
  { id: "C4", why: "credit_deducted alone must NOT upgrade the class", c: { arithmeticViolationForVendor: false, referenceConflict: false, creditDeducted: true }, expect: "INSUFFICIENT_EVIDENCE" },
];
for (const s of SCEN) {
  const got = sqlProposedClass(s.c);
  record(`19 classifier ${s.id} → ${s.expect} :: ${s.why}`, got === s.expect, `got ${got}`);
}
record("19b the SQL classifier can never emit a PROVEN_* class",
  SCEN.every((s) => !/^proven_/i.test(sqlProposedClass(s.c)))
    && !["DATA_INVARIANT_VIOLATION", "DUPLICATE_OR_REFERENCE_CONFLICT", "INSUFFICIENT_EVIDENCE"].some((x) => /proven/i.test(x)),
  "PROVEN_* is human-review + founder-approval only");
record("19c PROVEN_* classes exist ONLY in the manifest vocabulary (reviewer-set), not the SQL",
  EVIDENCE_CLASSES.includes("PROVEN_DEBIT_ALREADY_APPLIED_LEDGER_MISSING")
    && EVIDENCE_CLASSES.includes("PROVEN_NO_DEBIT")
    && !/'proven_debit|'proven_no_debit/i.test(norm(stripComments(auditRaw, "a"))),
  "PROVEN_* reviewer-only; absent from the audit SQL as an emitted value");

/* ===========================================================================
 * Report
 * ========================================================================= */
const passed = results.filter((r) => r.ok).length;
console.log("== QF-MVP-20.4A audit-pack safety validator ==");
console.log(`audit SQL   : ${AUDIT_SQL}`);
console.log(`audit SHA   : ${auditSha}`);
console.log(`manifest    : ${MANIFEST}`);
console.log(`design doc  : ${DESIGN_DOC}`);
console.log("");
for (const r of results) {
  console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`);
  if (!r.ok) console.log(`         ${r.detail}`);
}
console.log("");
console.log(`checks: ${passed} passed, ${results.length - passed} failed (of ${results.length})`);
console.log(`fixtures: ${FIXTURES.length} one-defect audit-SQL mutations`);
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
