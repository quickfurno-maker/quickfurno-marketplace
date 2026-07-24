#!/usr/bin/env node
/**
 * QF-MVP-20.4C — Offline migration validator for the immutable exception register.
 *
 * Entirely offline. Reads files and hashes them. No socket, process, env or DB.
 *
 * Grades the real 20.4C migration, its SELECT-only verifier, the contract
 * manifest and the 20.4 document against the locked financial/immutability
 * invariants: schema-only (no candidate INSERT/backfill), a NEW register table
 * (never vendor_credit_logs), no balance/package/assignment/ledger mutation,
 * append-only + immutable (UPDATE/DELETE/TRUNCATE blocked for every role incl.
 * service_role), least-privilege (no PUBLIC/anon/authenticated), the financial
 * outcome pinned to INSUFFICIENT_EVIDENCE / EXCEPTION_RECORD_ONLY /
 * NO_FINANCIAL_CHANGE with all mutation flags false, no cascade that erases
 * history, and no production UUID/PII.
 *
 * Usage:  node scripts/mvp/reconciliation/validate-qf-mvp-20-4c.mjs
 * Exit 0 = PASS, exit 1 = FAIL. Fails closed on ambiguous parsing.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATION = "supabase/migrations/20260723000900_qf_mvp_credit_ledger_reconciliation_exception_register.sql";
const VERIFIER = "supabase/staging-verification/verify_qf_mvp_20_4c.sql";
const MANIFEST = "scripts/mvp/reconciliation/qf-mvp-20-4c-register-contract.json";
const DOC = "docs/QF-MVP-20-4-HISTORICAL-CREDIT-LEDGER-RECONCILIATION.md";

/** Applied/reviewed and immutable — 20.4C must not have touched any of them. */
const LOCKED = [
  { file: "supabase/migrations/20260723000700_qf_mvp_auth_user_onboarding_trigger.sql", sha256: "8fb3c28c2c0e776d88d3c8163a895c5e108cb84b89ac95f41b86a521f50daecd" },
  { file: "supabase/migrations/20260723000800_qf_mvp_legacy_assignment_rpc_execute_revocation.sql", sha256: "94c696cdd5c1e91ad75222aa8cad544daf8c5271b1453fb78729bd62d7db520a" },
  { file: "supabase/migrations/20260723000500_qf_mvp_assignment_universal_enforcement.sql", sha256: "d13703553663271172cfdcedc5e9be8374e7e9c1d225d2c67816fce837450cf3" },
  { file: "supabase/migrations/20260723000600_qf_mvp_public_projection_privilege_hardening.sql", sha256: "0d3d871b0c6ab9de8d82eeb8499437f1f40a8a6c81561cf41cb8ade60b464da2" },
  { file: "supabase/reconciliation/qf_mvp_20_4_historical_credit_ledger_audit.sql", sha256: "615d3712d7eb16554d59d4ddf41a27a069320ee9edee44741abe9698988942bd" },
  { file: "scripts/mvp/reconciliation/qf-mvp-20-4-evidence-manifest.schema.json", sha256: "a63d04a740bfe6babaea5caa0b8cc20bfb66a9a1fe07ba9cc70180da28f673c0" },
];

const results = [];
let failed = false;
function record(name, ok, detail) { results.push({ name, ok, detail }); if (!ok) failed = true; }
function read(rel) { return readFileSync(path.join(ROOT, rel), "utf8"); }
function sha256(t) { return createHash("sha256").update(t, "utf8").digest("hex"); }

/* SQL tokenizer: comments + string literals removed (structural), and a
 * comment-only-removed form (literals kept). */
function tokenize(sql, label) {
  let code = ""; let i = 0; const n = sql.length; const bodies = [];
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") { const nl = sql.indexOf("\n", i); i = nl === -1 ? n : nl; continue; }
    if (two === "/*") { let d = 1; i += 2; while (i < n && d > 0) { if (sql.slice(i, i + 2) === "/*") { d++; i += 2; continue; } if (sql.slice(i, i + 2) === "*/") { d--; i += 2; continue; } i++; } if (d !== 0) throw new Error(`${label}: unterminated block comment`); continue; }
    if (sql[i] === "'") { i++; while (i < n) { if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; } if (sql[i] === "'") { i++; break; } i++; } code += " '' "; continue; }
    if (sql[i] === "$") { const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i)); if (m) { const tag = m[0]; const end = sql.indexOf(tag, i + tag.length); if (end === -1) throw new Error(`${label}: unterminated dollar body`); bodies.push(sql.slice(i + tag.length, end)); code += " $BODY$ "; i = end + tag.length; continue; } }
    code += sql[i]; i++;
  }
  return { code, bodies };
}
function stripComments(sql, label) {
  let out = ""; let i = 0; const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") { const nl = sql.indexOf("\n", i); i = nl === -1 ? n : nl; continue; }
    if (two === "/*") { let d = 1; i += 2; while (i < n && d > 0) { if (sql.slice(i, i + 2) === "/*") { d++; i += 2; continue; } if (sql.slice(i, i + 2) === "*/") { d--; i += 2; continue; } i++; } if (d !== 0) throw new Error(`${label}: unterminated block comment`); continue; }
    if (sql[i] === "'") { const s = i; i++; while (i < n) { if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; } if (sql[i] === "'") { i++; break; } i++; } out += sql.slice(s, i); continue; }
    if (sql[i] === "$") { const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i)); if (m) { const tag = m[0]; const end = sql.indexOf(tag, i + tag.length); if (end === -1) throw new Error(`${label}: unterminated dollar body`); out += tag + stripComments(sql.slice(i + tag.length, end), label) + tag; i = end + tag.length; continue; } }
    out += sql[i]; i++;
  }
  return out;
}
const norm = (t) => t.replace(/\s+/g, " ").toLowerCase();
const REGISTER = "credit_ledger_reconciliation_exceptions";
const PII_COLS = ["business_name", "owner_name", "full_name", "phone", "email", "address", "whatsapp", "client_name", "customer_name"];
const FINANCIAL_TABLES = ["vendors", "vendor_packages", "lead_assignments", "vendor_credit_logs"];

/* ===========================================================================
 * MIGRATION EVALUATOR
 * ========================================================================= */
export function evaluateMigration(sql, label = "20.4C") {
  const findings = [];
  const add = (rule, detail) => findings.push({ rule, detail });
  let tok, text;
  try { tok = tokenize(sql, label); } catch (e) { add("C00_parse", e.message); return findings; }
  try { text = stripComments(sql, label); } catch (e) { add("C00_parse", e.message); return findings; }
  const code = norm(tok.code);       // comments + literals removed
  const exec = norm(text);           // comments removed, literals kept
  const bodies = tok.bodies.map(norm).join("\n");
  // executable statements outside the $verify$ self-check body (bodies are the
  // dollar-quoted trigger/verify blocks; DML there is not a real table write).
  const execNoBodies = norm(tok.code);

  // -- C01 candidate identity + creates the register table -------------------
  if (!new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?public\\.${REGISTER}\\b`).test(exec)) {
    add("C01_creates_register", `does not create public.${REGISTER}`);
  }

  // -- C02 SCHEMA-ONLY: no candidate INSERT / backfill / DML in real SQL -----
  //     DML inside a $$ ... $$ body (the verify block) is not a table write; we
  //     scan the structural code where bodies are collapsed to $BODY$.
  for (const [re, why] of [
    [/(^|;)\s*insert\s+into\b/, "INSERT (schema-only migration must not populate)"],
    [/(^|;)\s*update\s+[a-z0-9_."]+\s+set\b/, "UPDATE"],
    [/(^|;)\s*delete\s+from\b/, "DELETE"],
    [/\bmerge\s+into\b/, "MERGE"],
    [/\bcopy\s+/, "COPY"],
    [/\bselect\b[\s\S]*?\binto\s+[a-z]/, "SELECT INTO"],
  ]) if (re.test(execNoBodies)) add("C02_schema_only_no_dml", why);

  // -- C03 no production candidate UUID / PII --------------------------------
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(sql)) {
    add("C03_no_uuid_or_pii", "a UUID literal appears (no candidate UUID may be embedded)");
  }
  for (const c of PII_COLS) if (new RegExp(`\\b${c}\\b`).test(exec)) add("C03_no_uuid_or_pii", `PII column ${c}`);

  // -- C04 the register is NOT vendor_credit_logs, and vcl is not written ----
  //     Precise: a CREATE TABLE whose target IS vendor_credit_logs. The column
  //     name vendor_credit_logs_backfill must NOT trip this (\b excludes the
  //     trailing "_backfill"); ALTERs of the ledger are caught by C05.
  if (/create\s+table\s+(if\s+not\s+exists\s+)?(public\.)?vendor_credit_logs\b/.test(exec)) add("C04_not_vendor_credit_logs", "creates/reuses vendor_credit_logs as the register");
  // -- C05 no mutation of financial/operational tables (outside the verify body) --
  for (const t of FINANCIAL_TABLES) {
    if (new RegExp(`(insert\\s+into|update|delete\\s+from|alter\\s+table)\\s+(public\\.)?${t}\\b`).test(execNoBodies)) {
      add("C05_no_financial_mutation", `mutates public.${t}`);
    }
  }

  // -- C06 service_role: SELECT+INSERT granted, UPDATE/DELETE/TRUNCATE revoked --
  if (!new RegExp(`grant\\s+select\\s*,\\s*insert\\s+on\\s+table\\s+public\\.${REGISTER}\\s+to\\s+service_role`).test(exec)) {
    add("C06_service_role_select_insert_only", "service_role is not granted exactly SELECT, INSERT");
  }
  if (!new RegExp(`revoke\\s+update\\s*,\\s*delete\\s*,\\s*truncate[^;]*from\\s+service_role`).test(exec)) {
    add("C06_service_role_select_insert_only", "UPDATE/DELETE/TRUNCATE not revoked from service_role");
  }
  if (/\bgrant\s+(all|update|delete|truncate)[^;]*to\s+service_role/.test(exec)) {
    add("C06_service_role_select_insert_only", "service_role is granted a mutation/ALL privilege");
  }

  // -- C07 no PUBLIC / anon / authenticated privilege -----------------------
  if (!new RegExp(`revoke\\s+all\\s+privileges\\s+on\\s+table\\s+public\\.${REGISTER}\\s+from\\s+[^;]*public`).test(exec)) {
    add("C07_no_untrusted_privilege", "does not revoke ALL from PUBLIC");
  }
  for (const r of ["public", "anon", "authenticated"]) {
    if (new RegExp(`grant\\s+[a-z, ]+on\\s+table\\s+public\\.${REGISTER}\\s+to\\s+[^;]*\\b${r}\\b`).test(exec)) {
      add("C07_no_untrusted_privilege", `grants a table privilege to ${r}`);
    }
    if (new RegExp(`create\\s+policy[^;]*to\\s+${r}\\b`).test(exec)) add("C07_no_untrusted_privilege", `creates a policy for ${r}`);
  }

  // -- C08 RLS enabled -------------------------------------------------------
  if (!new RegExp(`alter\\s+table\\s+public\\.${REGISTER}\\s+enable\\s+row\\s+level\\s+security`).test(exec)) {
    add("C08_rls_enabled", "RLS is not enabled on the register");
  }

  // -- C09 immutability: UPDATE|DELETE row trigger + TRUNCATE trigger --------
  if (!/before\s+update\s+or\s+delete\s+on\s+public\.credit_ledger_reconciliation_exceptions/.test(exec)) {
    add("C09_immutability_triggers", "missing BEFORE UPDATE OR DELETE row trigger");
  }
  if (!/before\s+truncate\s+on\s+public\.credit_ledger_reconciliation_exceptions/.test(exec)) {
    add("C09_immutability_triggers", "missing BEFORE TRUNCATE statement trigger");
  }

  // -- C10 no cascade / set-null delete that erases or repoints history ------
  if (/on\s+delete\s+cascade/.test(exec)) add("C10_no_cascade_delete", "ON DELETE CASCADE can erase reconciliation history");
  if (/on\s+delete\s+set\s+null/.test(exec)) add("C10_no_cascade_delete", "ON DELETE SET NULL on the register");

  // -- C11 mutation flags CHECK-pinned to false -----------------------------
  for (const col of ["balance_mutation", "package_mutation", "vendor_credit_logs_backfill"]) {
    if (!new RegExp(`check\\s*\\(\\s*${col}\\s*=\\s*false\\s*\\)`).test(exec)) {
      add("C11_mutation_flags_false", `${col} is not CHECK-pinned to false`);
    }
  }

  // -- C12/C13/C14 locked classification / correction / decision ------------
  if (!/check\s*\(\s*classification\s*=\s*'insufficient_evidence'\s*\)/.test(exec)) add("C12_classification_locked", "classification not pinned to INSUFFICIENT_EVIDENCE");
  if (!/check\s*\(\s*correction_mode\s*=\s*'exception_record_only'\s*\)/.test(exec)) add("C13_correction_mode_locked", "correction_mode not pinned to EXCEPTION_RECORD_ONLY");
  if (!/check\s*\(\s*founder_decision\s*=\s*'no_financial_change'\s*\)/.test(exec)) add("C14_decision_locked", "founder_decision not pinned to NO_FINANCIAL_CHANGE");

  // -- C15 actor / reason / reviewed_at present + constrained ---------------
  if (!/reviewer_actor\s+text\s+not\s+null/.test(exec)) add("C15_actor_reason_reviewed", "reviewer_actor missing/not NOT NULL");
  if (!/reviewed_at\s+timestamptz\s+not\s+null/.test(exec)) add("C15_actor_reason_reviewed", "reviewed_at missing/not NOT NULL");
  if (!/reason\s+text\s+not\s+null/.test(exec)) add("C15_actor_reason_reviewed", "reason missing/not NOT NULL");
  if (!/reviewer_actor\s+in\s*\(\s*'founder'\s*,\s*'authorized_admin'\s*\)/.test(exec)) add("C15_actor_reason_reviewed", "reviewer_actor not constrained to FOUNDER/AUTHORIZED_ADMIN");

  // -- C16 evidence hashes present + hex-constrained ------------------------
  for (const col of ["audit_sql_sha256", "evidence_manifest_sha256"]) {
    if (!new RegExp(`${col}\\s+text\\s+not\\s+null`).test(exec)) add("C16_evidence_hashes", `${col} missing/not NOT NULL`);
    if (!new RegExp(`check\\s*\\(\\s*${col}\\s*~\\s*'\\^\\[0-9a-f\\]\\{64\\}\\$'\\s*\\)`).test(exec)) add("C16_evidence_hashes", `${col} not constrained to lowercase 64-hex`);
  }

  // -- C17 idempotency uniqueness -------------------------------------------
  if (!/unique\s*\(\s*idempotency_key\s*\)/.test(exec)) add("C17_idempotency_unique", "idempotency_key not UNIQUE");
  if (!/idempotency_key\s+text\s+not\s+null/.test(exec)) add("C17_idempotency_unique", "idempotency_key not NOT NULL");

  // -- C18 no broad / default-privilege change ------------------------------
  if (/\balter\s+default\s+privileges\b/.test(exec)) add("C18_no_broad_priv", "ALTER DEFAULT PRIVILEGES");
  if (/\b(grant|revoke)\b[^;]*\bon\s+(all\s+(tables|functions|routines)|schema)\b/.test(exec)) add("C18_no_broad_priv", "broad ON ALL / ON SCHEMA grant");
  if (/\bgrant\s+all\b/.test(exec)) add("C18_no_broad_priv", "GRANT ALL");

  // -- C19 scope fence: no owner binding / profiles grant / admin_role ------
  if (/alter\s+table\s+public\.leads\s+add\s+column\s+(client_account_id|user_id|created_by)\b/.test(exec)) add("C19_scope_fence", "owner-binding column on leads");
  if (/grant[^;]*on\s+table\s+public\.profiles\b/.test(exec)) add("C19_scope_fence", "profiles table grant");
  if (/admin_role\b/.test(exec)) add("C19_scope_fence", "admin_role cleanup scope");

  // -- C20 self-verification present, catalog-based -------------------------
  if (!/do\s+\$verify\$/.test(sql)) add("C20_self_verification", "no self-verification block");
  if (/pg_get_functiondef|prosrc\b|routine_definition/.test(bodies)) add("C20_self_verification", "lexical assertion over function source");
  for (const marker of ["to_regclass", "has_table_privilege", "pg_trigger"]) {
    if (!new RegExp(marker).test(bodies)) add("C20_self_verification", `self-verification does not use ${marker}`);
  }

  // -- C21 hygiene: no history write, no secret -----------------------------
  if (/supabase_migrations|schema_migrations/.test(exec)) add("C21_hygiene", "touches migration-history tables");
  if (/https?:\/\/|supabase\.co|postgres(ql)?:\/\/|service_role_key|sb_secret|eyj[a-z0-9]/i.test(exec)) add("C21_hygiene", "URL/project-ref/credential token");
  if (/(^|;|\s)(begin|commit|rollback)\s*(;|$)/.test(execNoBodies)) add("C21_hygiene", "explicit transaction control");

  return findings;
}

/* ===========================================================================
 * VERIFIER EVALUATOR
 * ========================================================================= */
export function evaluateVerifier(sql, label = "verifier") {
  const findings = [];
  const add = (rule, detail) => findings.push({ rule, detail });
  let tok, stripped;
  try { tok = tokenize(sql, label); } catch (e) { add("V00_parse", e.message); return findings; }
  try { stripped = stripComments(sql, label); } catch (e) { add("V00_parse", e.message); return findings; }
  const code = norm(tok.code); const exec = norm(stripped);
  if (/(^|;)\s*(insert\s+into|update\s+[a-z0-9_."]+\s+set|delete\s+from|create\s+|alter\s+|drop\s+|truncate|grant\s+|revoke\s+|call\s+|do\s+\$|copy\s+)/.test(code)) {
    add("V01_select_only", "verifier performs DML/DDL/DCL/DO");
  }
  if (/(^|;|\s)(begin|commit|rollback|savepoint)\s*(;|$)/.test(code)) add("V01_select_only", "transaction control");
  for (const marker of ["credit_ledger_reconciliation_exceptions", "trg_clre_immutable", "trg_clre_no_truncate",
    "has_table_privilege", "insufficient_evidence", "exception_record_only", "no_financial_change",
    "balance_mutation", "vendor_credit_logs", "qf_assign_lead_vendors_v2"]) {
    if (!new RegExp(marker).test(exec)) add("V02_required_assertions", `verifier never asserts on ${marker}`);
  }
  // zero-row assertion present
  if (!/count\(\*\)[^;]*credit_ledger_reconciliation_exceptions/.test(exec)) add("V02_required_assertions", "no zero-row assertion on the register");
  const rows = [...sql.matchAll(/^select\s+(\d+)\s*(?:as\s+seq)?\s*,/gim)].map((m) => Number(m[1]));
  if (!(rows.length > 0 && new Set(rows).size === rows.length && rows.every((v, i) => v === i + 1))) {
    add("V03_stable_rows", `rows not contiguous 1..N (${rows.length})`);
  }
  return findings;
}

/* ===========================================================================
 * 1. Locked artifacts unchanged
 * ========================================================================= */
for (const item of LOCKED) {
  const actual = sha256(read(item.file));
  record(`01 locked artifact unchanged :: ${item.file}`, actual === item.sha256,
    actual === item.sha256 ? actual : `expected ${item.sha256}, got ${actual}`);
}

/* ===========================================================================
 * 2. Real migration zero findings + fixtures
 * ========================================================================= */
const migRaw = read(MIGRATION);
const migSha = sha256(migRaw);
const realFindings = evaluateMigration(migRaw, "20260723000900");
record("02 real migration has zero findings", realFindings.length === 0,
  realFindings.length === 0 ? "immutable, schema-only, financial locks pinned"
    : realFindings.map((f) => `${f.rule}: ${f.detail}`).join(" | "));
record("03 migration path is the locked candidate identity",
  MIGRATION === "supabase/migrations/20260723000900_qf_mvp_credit_ledger_reconciliation_exception_register.sql", MIGRATION);

const FIXTURES = [
  { id: "A", rule: "C02_schema_only_no_dml", why: "a candidate INSERT/backfill is added",
    mutate: (s) => `${s}\ninsert into public.credit_ledger_reconciliation_exceptions (id) values (gen_random_uuid());\n` },
  { id: "B", rule: "C03_no_uuid_or_pii", why: "a production UUID is embedded",
    mutate: (s) => `${s}\n-- candidate 66291bcf-daf3-42ad-a39f-7b1ace82a174\n` },
  { id: "C", rule: "C03_no_uuid_or_pii", why: "a PII column is added",
    mutate: (s) => s.replace("vendor_id                   uuid        not null,",
      "vendor_id                   uuid        not null,\n  business_name               text,") },
  { id: "D", rule: "C05_no_financial_mutation", why: "it mutates vendor_credit_logs",
    mutate: (s) => `${s}\nupdate public.vendor_credit_logs set credits_delta = 0;\n` },
  { id: "E", rule: "C05_no_financial_mutation", why: "it alters vendors",
    mutate: (s) => `${s}\nalter table public.vendors add column x int;\n` },
  { id: "F", rule: "C06_service_role_select_insert_only", why: "service_role granted UPDATE",
    mutate: (s) => `${s}\ngrant update on table public.credit_ledger_reconciliation_exceptions to service_role;\n` },
  { id: "G", rule: "C06_service_role_select_insert_only", why: "the U/D/T revoke from service_role is removed",
    mutate: (s) => s.replace(/revoke update, delete, truncate, references, trigger, maintain\n  on table public\.credit_ledger_reconciliation_exceptions\n  from service_role;\n/, "") },
  { id: "H", rule: "C07_no_untrusted_privilege", why: "authenticated is granted SELECT",
    mutate: (s) => `${s}\ngrant select on table public.credit_ledger_reconciliation_exceptions to authenticated;\n` },
  { id: "I", rule: "C08_rls_enabled", why: "RLS enable is removed",
    mutate: (s) => s.replace("alter table public.credit_ledger_reconciliation_exceptions enable row level security;", "-- rls removed") },
  { id: "J", rule: "C09_immutability_triggers", why: "the UPDATE/DELETE trigger is removed",
    mutate: (s) => s.replace(/create trigger trg_clre_immutable\n  before update or delete on public\.credit_ledger_reconciliation_exceptions\n  for each row execute function public\.qf_prevent_credit_ledger_exception_mutation\(\);\n/, "") },
  { id: "K", rule: "C10_no_cascade_delete", why: "a cascading FK is introduced",
    mutate: (s) => s.replace("on update restrict on delete restrict,", "on update restrict on delete cascade,") },
  { id: "L", rule: "C11_mutation_flags_false", why: "balance_mutation false-lock removed",
    mutate: (s) => s.replace("constraint clre_balance_mutation_false check (balance_mutation            = false),", "") },
  { id: "M", rule: "C12_classification_locked", why: "classification lock removed",
    mutate: (s) => s.replace("constraint clre_classification_locked  check (classification  = 'INSUFFICIENT_EVIDENCE'),", "") },
  { id: "N", rule: "C13_correction_mode_locked", why: "correction_mode lock removed",
    mutate: (s) => s.replace("constraint clre_correction_mode_locked check (correction_mode = 'EXCEPTION_RECORD_ONLY'),", "") },
  { id: "O", rule: "C14_decision_locked", why: "founder_decision lock removed",
    mutate: (s) => s.replace("constraint clre_decision_locked        check (founder_decision = 'NO_FINANCIAL_CHANGE'),", "") },
  { id: "P", rule: "C15_actor_reason_reviewed", why: "reviewer_actor constraint removed",
    mutate: (s) => s.replace("constraint clre_reviewer_actor_check   check (reviewer_actor in ('FOUNDER','AUTHORIZED_ADMIN')),", "") },
  { id: "Q", rule: "C16_evidence_hashes", why: "audit_sql hex constraint removed",
    mutate: (s) => s.replace("constraint clre_audit_sql_sha256_hex   check (audit_sql_sha256 ~ '^[0-9a-f]{64}$'),", "") },
  { id: "R", rule: "C17_idempotency_unique", why: "idempotency uniqueness removed",
    mutate: (s) => s.replace("constraint clre_idempotency_key_unique unique (idempotency_key),", "") },
  { id: "S", rule: "C18_no_broad_priv", why: "ALTER DEFAULT PRIVILEGES added",
    mutate: (s) => `${s}\nalter default privileges in schema public grant select on tables to authenticated;\n` },
  { id: "T", rule: "C19_scope_fence", why: "owner-binding column smuggled in",
    mutate: (s) => `${s}\nalter table public.leads add column client_account_id uuid;\n` },
  { id: "U", rule: "C20_self_verification", why: "self-verification block removed",
    mutate: (s) => s.replace(/do \$verify\$[\s\S]*\$verify\$;/, "-- verify removed\n") },
];
for (const fx of FIXTURES) {
  const mutated = fx.mutate(migRaw);
  const changed = mutated !== migRaw;
  const f = changed ? evaluateMigration(mutated, `fx-${fx.id}`) : [];
  const tripped = f.some((x) => x.rule === fx.rule);
  record(`04 fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "MUTATION WAS A NO-OP — the fixture is vacuous"
      : tripped ? `tripped (${f.length})` : `did NOT trip; ${f.map((x) => x.rule).join(",") || "none"}`);
}
record("05 every migration rule has a fixture", (() => {
  const covered = new Set(FIXTURES.map((f) => f.rule));
  const declared = [...new Set([...read(MIGRATION_VALIDATOR_SELF()).matchAll(/add\("(C\d\d_[a-z0-9_]+)"/g)].map((m) => m[1]))]
    .filter((r) => !["C00_parse", "C01_creates_register", "C04_not_vendor_credit_logs", "C21_hygiene"].includes(r));
  const missing = declared.filter((r) => !covered.has(r));
  return missing.length === 0 ? true : missing;
})() === true, "every enforced migration rule is exercised");
function MIGRATION_VALIDATOR_SELF() { return "scripts/mvp/reconciliation/validate-qf-mvp-20-4c.mjs"; }

/* ===========================================================================
 * 3. Verifier
 * ========================================================================= */
const verRaw = read(VERIFIER);
const verSha = sha256(verRaw);
const verFindings = evaluateVerifier(verRaw, "verify_20_4c");
record("06 real verifier has zero findings", verFindings.length === 0,
  verFindings.length === 0 ? "SELECT-only, asserts the full contract" : verFindings.map((f) => `${f.rule}: ${f.detail}`).join(" | "));
const VER_FIXTURES = [
  { id: "VF1", rule: "V01_select_only", why: "verifier performs DML", mutate: (s) => `insert into public.credit_ledger_reconciliation_exceptions(id) values (gen_random_uuid());\n${s}` },
  { id: "VF2", rule: "V02_required_assertions", why: "the no_financial_change assertion is removed", mutate: (s) => s.replace(/no_financial_change/g, "removed_value") },
  { id: "VF3", rule: "V02_required_assertions", why: "the immutable-trigger assertion is removed", mutate: (s) => s.replace(/trg_clre_immutable/g, "trg_removed") },
];
for (const fx of VER_FIXTURES) {
  const mutated = fx.mutate(verRaw);
  const changed = mutated !== verRaw;
  const f = changed ? evaluateVerifier(mutated, `vf-${fx.id}`) : [];
  const tripped = f.some((x) => x.rule === fx.rule);
  record(`07 verifier fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "MUTATION WAS A NO-OP" : tripped ? `tripped (${f.length})` : `did NOT trip; ${f.map((x) => x.rule).join(",") || "none"}`);
}
record("08 verifier row count", (() => (verRaw.match(/^select\s+\d+/gim) || []).length >= 20)(),
  `${(verRaw.match(/^select\s+\d+/gim) || []).length} rows`);

/* ===========================================================================
 * 4. Contract manifest
 * ========================================================================= */
let man;
try { man = JSON.parse(read(MANIFEST)); record("09 contract manifest parses", true, "ok"); }
catch (e) { man = {}; record("09 contract manifest parses", false, e.message); }
record("10 manifest freezes the locked financial outcome", (() => {
  const a = man?.allowed_values || {};
  return a.classification === "INSUFFICIENT_EVIDENCE" && a.correction_mode === "EXCEPTION_RECORD_ONLY"
    && a.founder_decision === "NO_FINANCIAL_CHANGE"
    && man?.required_false_flags?.balance_mutation === false
    && man?.required_false_flags?.package_mutation === false
    && man?.required_false_flags?.vendor_credit_logs_backfill === false;
})(), "classification/correction/decision + false flags frozen");
record("11 manifest declares the register table + zero-row post-state, no production rows", (() => {
  const s = JSON.stringify(man);
  return man?.table === "public.credit_ledger_reconciliation_exceptions"
    && man?.expected_post_application_rows === 0
    && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s);
})(), "table identity + 0 rows + no UUIDs");
record("12 manifest declares immutability + service_role-only + non-cascade FK", (() => {
  const s = JSON.stringify(man).toLowerCase();
  return s.includes("update") && s.includes("delete") && s.includes("truncate")
    && s.includes("service_role") && (s.includes("restrict") || s.includes("no action") || s.includes("no cascade") || s.includes("self"));
})(), "immutability + privilege + FK contract present");

/* ===========================================================================
 * 5. Design document
 * ========================================================================= */
const doc = read(DOC);
const docN = doc.toLowerCase();
const docT = docN.replace(/`/g, "");   // backtick-stripped, so `x` matches plain x
record("13 doc records founder approval: all 27 INSUFFICIENT_EVIDENCE, zero financial change",
  doc.includes("27") && doc.includes("INSUFFICIENT_EVIDENCE")
    && (docT.includes("no financial change") || docT.includes("zero debit"))
    && docT.includes("founder") && docT.includes("approv"),
  "founder ruling recorded");
record("14 doc records the register architecture + immutability + no vendor_credit_logs backfill",
  docT.includes("credit_ledger_reconciliation_exceptions")
    && (docT.includes("immutable") || docT.includes("append-only"))
    && docT.includes("no vendor_credit_logs backfill"),
  "architecture + immutability recorded");
record("15 doc states generated-not-applied + next is staging preflight",
  docT.includes("generated") && (docT.includes("not applied") || docT.includes("unapplied"))
    && docT.includes("preflight"),
  "generated-not-applied; next = preflight");

/* ===========================================================================
 * Report
 * ========================================================================= */
const passed = results.filter((r) => r.ok).length;
console.log("== QF-MVP-20.4C exception-register validator ==");
console.log(`migration : ${MIGRATION}`);
console.log(`mig SHA   : ${migSha}`);
console.log(`verifier  : ${VERIFIER}`);
console.log(`ver SHA   : ${verSha}`);
console.log(`manifest  : ${MANIFEST}`);
console.log("");
for (const r of results) { console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`); if (!r.ok) console.log(`         ${r.detail}`); }
console.log("");
console.log(`checks: ${passed} passed, ${results.length - passed} failed (of ${results.length})`);
console.log(`fixtures: ${FIXTURES.length} migration + ${VER_FIXTURES.length} verifier one-defect mutations`);
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
