#!/usr/bin/env node
/**
 * QF-MVP-30.1B — offline validator for the Vendor CRM foundation.
 *
 * Entirely offline (files + hashes only; no socket/env/DB). Grades the real
 * migration, the SELECT-only verifier, the contract manifest, the added runtime
 * contract file and the docs against the locked foundation contract: one
 * canonical append-only notes authority (vendor_internal_notes, evolved in
 * place), server-only access (PUBLIC/anon/authenticated zero, service_role
 * minimal, no DELETE/TRUNCATE), evidence-preserving RESTRICT vendor FKs, no
 * Core-truth duplicate columns, no segment/campaign tables, no owner binding,
 * and no vendor_public_v change.
 *
 * Usage:  node scripts/mvp/crm/validate-qf-mvp-30-1b.mjs   (exit 0 = PASS)
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATION = "supabase/migrations/20260723001100_qf_mvp_vendor_crm_foundation.sql";
const VERIFIER = "supabase/staging-verification/verify_qf_mvp_30_1b.sql";
const MANIFEST = "scripts/mvp/crm/qf-mvp-30-1b-foundation-contract.json";
const RUNTIME = "lib/crm/vendorCrmContracts.ts";
const BLUEPRINT = "docs/QF-MVP-30-VENDOR-CRM-BLUEPRINT.md";
const BOARD = "docs/QF-MVP-EXECUTION-BOARD.md";
const SELF = "scripts/mvp/crm/validate-qf-mvp-30-1b.mjs";

/** Applied/reviewed and immutable — 30.1B must not have edited any of them. */
const LOCKED = [
  { file: "supabase/migrations/20260621000006_superadmin_foundation.sql", sha256: "d5e1adfddaa3d30ebad148dcaf8291d75da5b9594d359b13fd84345a08c488ae" },
  { file: "supabase/migrations/20260723000700_qf_mvp_auth_user_onboarding_trigger.sql", sha256: "8fb3c28c2c0e776d88d3c8163a895c5e108cb84b89ac95f41b86a521f50daecd" },
  { file: "supabase/migrations/20260723000900_qf_mvp_credit_ledger_reconciliation_exception_register.sql", sha256: "75b6faf2f7ed52007b79b9036dd5998f00eb67d88e62ffa34b3d9d1343c5039d" },
  { file: "supabase/migrations/20260723001000_qf_mvp_profiles_privilege_admin_role_cleanup.sql", sha256: "5cf12b726b40aea6cac1d7f97eb2b289d6a46db39f9adc197249a37939a16592" },
];

const PROHIBITED = ["is_verified", "verification_status", "verified", "is_enabled", "city", "service_area",
  "service_areas", "areas_covered", "service_categories", "categories", "package", "package_name",
  "package_status", "package_expires_at", "plan", "credits", "total_credits", "remaining_credits",
  "credit_balance", "eligibility", "is_eligible", "assignment_eligibility", "consent", "consent_status",
  "is_suppressed", "suppression", "suppressed", "communication_authorization"];
const CRM_TABLES = ["vendor_crm_profiles", "vendor_contacts", "vendor_tags", "vendor_tag_assignments", "vendor_tasks", "vendor_internal_notes"];

const results = [];
let failed = false;
const record = (name, ok, detail) => { results.push({ name, ok, detail }); if (!ok) failed = true; };
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");

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

/* ===========================================================================
 * MIGRATION EVALUATOR
 * ========================================================================= */
export function evaluateMigration(sql, label = "30.1B") {
  const findings = [];
  const add = (rule, detail) => findings.push({ rule, detail });
  let tok, text;
  try { tok = tokenize(sql, label); } catch (e) { add("F00_parse", e.message); return findings; }
  try { text = stripComments(sql, label); } catch (e) { add("F00_parse", e.message); return findings; }
  const exec = norm(text);              // comments removed, literals + $bodies kept
  const code = norm(tok.code);          // comments + literals + $bodies removed
  const bodies = tok.bodies.map(norm).join("\n");

  // -- F01 creates the foundation + evolves the notes authority --------------
  for (const t of ["vendor_crm_profiles", "vendor_contacts", "vendor_tags", "vendor_tag_assignments", "vendor_tasks"]) {
    if (!new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?public\\.${t}\\b`).test(exec)) add("F01_creates_foundation", `missing create ${t}`);
  }
  if (!/alter\s+table\s+public\.vendor_internal_notes\s+add\s+column/.test(exec)) add("F01_creates_foundation", "does not evolve vendor_internal_notes");

  // -- F02 no rival vendor_notes table (single notes authority) --------------
  if (/create\s+table\s+(if\s+not\s+exists\s+)?public\.vendor_notes\b/.test(exec)) add("F02_single_notes_authority", "creates a rival public.vendor_notes table");

  // -- F03 no destructive vendor_internal_notes loss ------------------------
  if (/drop\s+table\s+(if\s+exists\s+)?public\.vendor_internal_notes\b/.test(exec)) add("F03_no_notes_data_loss", "drops the notes table");
  if (/(^|;)\s*delete\s+from\s+(public\.)?vendor_internal_notes\b/.test(code)) add("F03_no_notes_data_loss", "deletes note rows");
  if (/alter\s+table\s+public\.vendor_internal_notes\s+rename/.test(exec)) add("F03_no_notes_data_loss", "renames the notes table/column (breakage risk)");
  if (/alter\s+table\s+public\.vendor_internal_notes\s+drop\s+column\s+(if\s+exists\s+)?note\b/.test(exec)) add("F03_no_notes_data_loss", "drops the note body column");

  // -- F04 evidence-preserving vendor FKs (no CRM->vendors CASCADE) ----------
  if (/references\s+public\.vendors\s*\(id\)\s+on\s+update\s+restrict\s+on\s+delete\s+cascade/.test(exec)
      || /references\s+public\.vendors\b[^,]*on\s+delete\s+cascade/.test(exec)) {
    add("F04_no_vendor_cascade", "a CRM->vendors FK uses ON DELETE CASCADE");
  }

  // -- F25 vendor_internal_notes presence-idempotent two-path bootstrap ------
  //     staging omits the whole migration-006 set, so the table is ABSENT on
  //     staging and PRESENT on production: the migration must CREATE IF NOT
  //     EXISTS (legacy base shape) BEFORE any dependent ALTER, and converge both
  //     paths to one contract (created_by SET NULL, vendor RESTRICT, legacy
  //     policy dropped).
  {
    const iCreate = exec.search(/create\s+table\s+if\s+not\s+exists\s+public\.vendor_internal_notes\b/);
    const iAlter = exec.search(/alter\s+table\s+public\.vendor_internal_notes\b/);
    if (iCreate === -1) add("F25_notes_bootstrap", "missing CREATE TABLE IF NOT EXISTS for vendor_internal_notes");
    else if (iAlter !== -1 && iCreate > iAlter) add("F25_notes_bootstrap", "CREATE occurs after an ALTER that would fail when the table is absent");
    const m = /create\s+table\s+if\s+not\s+exists\s+public\.vendor_internal_notes\s*\(([\s\S]*?)\)\s*;/.exec(exec);
    const block = m ? m[1] : "";
    if (iCreate !== -1 && !/primary\s+key/.test(block)) add("F25_notes_bootstrap", "bootstrap CREATE lacks a primary key");
    if (iCreate !== -1 && !/note\s+text\s+not\s+null/.test(block)) add("F25_notes_bootstrap", "bootstrap CREATE lacks note text not null (legacy base shape)");
    if (!/vin_created_by_fk\s+foreign\s+key\s*\(\s*created_by\s*\)[^;]*on\s+delete\s+set\s+null/.test(exec)) add("F25_notes_bootstrap", "notes created_by FK is not ON DELETE SET NULL");
    if (!/vin_vendor_fk\s+foreign\s+key\s*\(\s*vendor_id\s*\)[^;]*on\s+delete\s+restrict/.test(exec)) add("F25_notes_bootstrap", "notes vendor FK is not ON DELETE RESTRICT");
    if (!/drop\s+policy\s+if\s+exists\s+"vendor notes admin all"/.test(exec)) add("F25_notes_bootstrap", "does not drop the legacy authenticated notes policy");
  }

  // -- F26 self-verification proves the notes FINAL contract (path-agnostic) --
  if (!/supersedes_note_id/.test(bodies)) add("F26_notes_selfverify", "self-verification does not assert the notes final column set");
  if (!/'vendor notes admin all'/.test(bodies)) add("F26_notes_selfverify", "self-verification does not assert the legacy notes policy is absent");

  // -- F05 no Core-truth duplicate columns in CRM tables --------------------
  //     scan each create-table column block + the notes ADD COLUMN list.
  for (const col of PROHIBITED) {
    // a column definition line "  <col>  <type>" (word-boundaried), excluding
    // the prohibited-list literal in the self-verify body (bodies).
    const re = new RegExp(`(^|,|\\()\\s*${col}\\s+(uuid|text|integer|boolean|numeric|timestamptz|jsonb|text\\[\\])`, "m");
    if (re.test(text)) add("F05_no_core_truth_columns", `CRM column duplicates Core truth: ${col}`);
  }

  // -- F06 no segment/campaign tables ---------------------------------------
  for (const t of ["vendor_segments", "vendor_campaigns", "vendor_campaign_audiences", "vendor_campaign_events", "vendor_engagement_events"]) {
    if (new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?public\\.${t}\\b`).test(exec)) add("F06_no_segment_campaign", `creates ${t}`);
  }

  // -- F07 no PUBLIC/anon privilege; both revoked ---------------------------
  for (const r of ["public", "anon"]) {
    if (new RegExp(`grant\\s+[a-z, ]+\\s+on\\s+table\\s+public\\.[a-z_]+\\s+to\\s+[a-z, ]*\\b${r}\\b`).test(exec)) add("F07_no_untrusted_grant", `grants to ${r}`);
  }
  for (const t of CRM_TABLES) {
    if (!new RegExp(`revoke\\s+all\\s+privileges\\s+on\\s+table\\s+public\\.${t}\\s+from\\s+[^;]*public\\b`).test(exec)) add("F07_no_untrusted_grant", `${t}: does not revoke ALL from public`);
    if (!new RegExp(`revoke\\s+all\\s+privileges\\s+on\\s+table\\s+public\\.${t}\\s+from\\s+[^;]*\\banon\\b`).test(exec)) add("F07_no_untrusted_grant", `${t}: does not revoke ALL from anon`);
  }

  // -- F08 no generic authenticated grant; revoked --------------------------
  if (/grant\s+[a-z, ]+\s+on\s+table\s+public\.[a-z_]+\s+to\s+[a-z, ]*authenticated/.test(exec)) add("F08_no_authenticated_grant", "grants a CRM table to authenticated");
  for (const t of CRM_TABLES) {
    if (!new RegExp(`revoke\\s+all\\s+privileges\\s+on\\s+table\\s+public\\.${t}\\s+from\\s+[^;]*authenticated`).test(exec)) add("F08_no_authenticated_grant", `${t}: does not revoke ALL from authenticated`);
  }

  // -- F10 service_role least privilege -------------------------------------
  for (const bad of ["delete", "truncate", "references", "trigger", "maintain", "all"]) {
    if (new RegExp(`grant\\s+[a-z, ]*\\b${bad}\\b[a-z, ]*\\s+on\\s+table\\s+public\\.[a-z_]+\\s+to\\s+[a-z, ]*service_role`).test(exec)) add("F10_service_role_minimal", `grants ${bad} to service_role`);
  }
  if (/grant\s+[a-z, ]*\bupdate\b[a-z, ]*\s+on\s+table\s+public\.vendor_internal_notes\s+to\s+[a-z, ]*service_role/.test(exec)) add("F10_service_role_minimal", "service_role granted UPDATE on the append-only notes authority");

  // -- F11 RLS enabled on all six -------------------------------------------
  for (const t of CRM_TABLES) {
    if (!new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`).test(exec)) add("F11_rls_enabled", `${t}: RLS not enabled`);
  }

  // -- F12 notes immutability triggers + functions --------------------------
  if (!/before\s+update\s+or\s+delete\s+on\s+public\.vendor_internal_notes/.test(exec)) add("F12_notes_immutable", "missing BEFORE UPDATE|DELETE notes trigger");
  if (!/before\s+truncate\s+on\s+public\.vendor_internal_notes/.test(exec)) add("F12_notes_immutable", "missing BEFORE TRUNCATE notes trigger");

  // -- F14 tag normalization + active-assignment uniqueness -----------------
  if (!/unique\s*\(\s*normalized_name\s*\)/.test(exec)) add("F14_tag_uniqueness", "vendor_tags.normalized_name not UNIQUE");
  if (!/create\s+unique\s+index[^;]*vendor_tag_assignments\s*\(\s*vendor_id\s*,\s*tag_id\s*\)\s*where\s+removed_at\s+is\s+null/.test(exec)) add("F14_tag_uniqueness", "no partial-unique active tag assignment");

  // -- F15 profile one-per-vendor -------------------------------------------
  if (!/primary\s+key\s*\(\s*vendor_id\s*\)/.test(exec)) add("F15_profile_uniqueness", "vendor_crm_profiles PK is not vendor_id");

  // -- F16 safe primary-contact uniqueness (partial) ------------------------
  if (!/create\s+unique\s+index[^;]*vendor_contacts\s*\(\s*vendor_id\s*\)\s*where\s+is_primary\s+and\s+is_active/.test(exec)) add("F16_primary_contact_uniqueness", "no partial-unique active primary contact");

  // -- F17 task status/type/idempotency -------------------------------------
  if (!/check\s*\(\s*task_type\s+in\s*\(/.test(exec)) add("F17_task_contract", "no task_type CHECK");
  if (!/check\s*\(\s*status\s+in\s*\(/.test(exec)) add("F17_task_contract", "no task status CHECK");
  if (!/create\s+unique\s+index[^;]*vendor_tasks\s*\(\s*idempotency_key\s*\)\s*where\s+idempotency_key\s+is\s+not\s+null/.test(exec)) add("F17_task_contract", "no task idempotency partial-unique");

  // -- F18 no AI/score/arbitrary-SQL fields ---------------------------------
  for (const bad of ["ai_score", "score", "ranking", "rank_score", "embedding", "rule_sql", "raw_sql", "sql_rule"]) {
    if (new RegExp(`(^|,|\\()\\s*${bad}\\s+(uuid|text|integer|boolean|numeric|jsonb|vector)`, "m").test(text)) add("F18_no_ai_or_sql_rule", `speculative/AI/SQL column: ${bad}`);
  }

  // -- F19 no vendor_public_v modification ----------------------------------
  if (/(create|alter|drop)\s+(or\s+replace\s+)?view\s+(if\s+exists\s+)?public\.vendor_public_v/.test(exec)) add("F19_public_projection_unchanged", "modifies vendor_public_v");

  // -- F20 no owner binding -------------------------------------------------
  if (/alter\s+table\s+public\.leads\s+add\s+column\s+(if\s+not\s+exists\s+)?(client_account_id|user_id|created_by)\b/.test(exec)) add("F20_no_owner_binding", "adds an owner-binding column on leads");

  // -- F21 no broad / default-privilege change ------------------------------
  if (/\balter\s+default\s+privileges\b/.test(exec)) add("F21_no_broad_priv", "ALTER DEFAULT PRIVILEGES");
  if (/\b(grant|revoke)\b[^;]*\bon\s+(all\s+(tables|functions|routines)|schema)\b/.test(exec)) add("F21_no_broad_priv", "broad ON ALL / ON SCHEMA");

  // -- F23 self-verification present, catalog-based -------------------------
  if (!/do\s+\$verify\$/.test(sql)) add("F23_self_verification", "no self-verification block");
  if (/pg_get_functiondef|prosrc\b|routine_definition/.test(bodies)) add("F23_self_verification", "lexical assertion over function source");
  for (const marker of ["has_table_privilege", "relrowsecurity", "confdeltype"]) {
    if (!new RegExp(marker).test(bodies)) add("F23_self_verification", `self-verification does not check ${marker}`);
  }

  // -- F24 no Core DML / no txn / no history write / no secret --------------
  for (const t of ["vendors", "vendor_packages", "vendor_credit_logs", "lead_assignments", "leads", "profiles"]) {
    if (new RegExp(`(^|;)\\s*(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?${t}\\b`).test(code)) add("F24_no_core_mutation", `mutates Core table ${t}`);
  }
  if (/(^|;|\s)(begin|commit|rollback)\s*(;|$)/.test(code)) add("F24_no_core_mutation", "explicit transaction control");
  if (/supabase_migrations|schema_migrations/.test(exec)) add("F24_no_core_mutation", "touches migration-history tables");
  if (/https?:\/\/|service_role_key|sb_secret|eyj[a-z0-9]/i.test(exec)) add("F24_no_core_mutation", "URL/credential token");

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
  if (/(^|;)\s*(insert\s+into|update\s+[a-z0-9_."]+\s+set|delete\s+from|create\s+|alter\s+|drop\s+|truncate|grant\s+|revoke\s+|call\s+|do\s+\$|copy\s+)/.test(code)) add("V01_select_only", "verifier performs DML/DDL/DCL/DO");
  if (/(^|;|\s)(begin|commit|rollback|savepoint)\s*(;|$)/.test(code)) add("V01_select_only", "transaction control");
  for (const m of ["vendor_internal_notes", "vendor_crm_profiles", "vendor_notes", "has_table_privilege",
    "trg_vin_immutable", "confdeltype", "normalized_name", "uq_vendor_tag_active", "idempotency_key",
    "vendor_public_v", "vendor_segments"]) {
    if (!new RegExp(m).test(exec)) add("V02_required_assertions", `verifier never asserts on ${m}`);
  }
  const rows = [...sql.matchAll(/^select\s+(\d+)\s*(?:as\s+seq)?\s*,/gim)].map((m) => Number(m[1]));
  if (!(rows.length > 0 && new Set(rows).size === rows.length && rows.every((v, i) => v === i + 1))) add("V03_stable_rows", `rows not contiguous 1..N (${rows.length})`);
  return findings;
}

/* ===========================================================================
 * 1. Locked artifacts unchanged
 * ========================================================================= */
for (const item of LOCKED) {
  const actual = sha256(read(item.file));
  record(`01 locked artifact unchanged :: ${item.file}`, actual === item.sha256, actual === item.sha256 ? actual.slice(0, 16) : `expected ${item.sha256}, got ${actual}`);
}

/* ===========================================================================
 * 2. Real migration zero findings + fixtures
 * ========================================================================= */
const migRaw = read(MIGRATION);
const migSha = sha256(migRaw);
const realFindings = evaluateMigration(migRaw, "20260723001100");
record("02 real migration has zero findings", realFindings.length === 0, realFindings.length === 0 ? "server-only, single notes authority, RESTRICT vendor FKs, no Core copy" : realFindings.map((f) => `${f.rule}: ${f.detail}`).join(" | "));
record("03 migration path is the locked candidate identity", MIGRATION === "supabase/migrations/20260723001100_qf_mvp_vendor_crm_foundation.sql", MIGRATION);

const FIX = [
  { id: "A", rule: "F02_single_notes_authority", why: "a rival vendor_notes table is created", mutate: (s) => `${s}\ncreate table public.vendor_notes (id uuid primary key);\n` },
  { id: "B", rule: "F03_no_notes_data_loss", why: "the notes table is dropped", mutate: (s) => `${s}\ndrop table if exists public.vendor_internal_notes;\n` },
  { id: "C", rule: "F04_no_vendor_cascade", why: "a CRM->vendors FK uses CASCADE", mutate: (s) => s.replace("constraint vco_vendor_fk foreign key (vendor_id)\n    references public.vendors (id) on update restrict on delete restrict,", "constraint vco_vendor_fk foreign key (vendor_id)\n    references public.vendors (id) on update restrict on delete cascade,") },
  { id: "D", rule: "F05_no_core_truth_columns", why: "a Core-truth duplicate column is added", mutate: (s) => s.replace("  budget_band                 text,", "  budget_band                 text,\n  remaining_credits           integer,") },
  { id: "E", rule: "F06_no_segment_campaign", why: "a campaign table is created", mutate: (s) => `${s}\ncreate table public.vendor_campaigns (id uuid primary key);\n` },
  { id: "F", rule: "F07_no_untrusted_grant", why: "anon is granted access", mutate: (s) => `${s}\ngrant select on table public.vendor_tasks to anon;\n` },
  { id: "G", rule: "F07_no_untrusted_grant", why: "a public revoke is removed", mutate: (s) => s.replace("revoke all privileges on table public.vendor_tasks           from public, anon, authenticated, service_role;", "-- removed") },
  { id: "H", rule: "F08_no_authenticated_grant", why: "authenticated is granted access", mutate: (s) => `${s}\ngrant select on table public.vendor_crm_profiles to authenticated;\n` },
  { id: "I", rule: "F10_service_role_minimal", why: "service_role granted DELETE", mutate: (s) => `${s}\ngrant delete on table public.vendor_tasks to service_role;\n` },
  { id: "J", rule: "F10_service_role_minimal", why: "service_role granted UPDATE on append-only notes", mutate: (s) => `${s}\ngrant update on table public.vendor_internal_notes to service_role;\n` },
  { id: "K", rule: "F11_rls_enabled", why: "RLS enable on a table is removed", mutate: (s) => s.replace("alter table public.vendor_tasks             enable row level security;", "-- removed") },
  { id: "L", rule: "F12_notes_immutable", why: "the notes immutability trigger is removed", mutate: (s) => s.replace(/create trigger trg_vin_immutable\n  before update or delete on public\.vendor_internal_notes\n  for each row execute function public\.qf_prevent_vendor_note_mutation\(\);\n/, "") },
  { id: "M", rule: "F14_tag_uniqueness", why: "the active tag-assignment unique index is removed", mutate: (s) => s.replace(/create unique index if not exists uq_vendor_tag_active\n  on public\.vendor_tag_assignments \(vendor_id, tag_id\) where removed_at is null;\n/, "") },
  { id: "N", rule: "F15_profile_uniqueness", why: "the profile vendor_id PK is weakened", mutate: (s) => s.replace("constraint vcp_pkey primary key (vendor_id),", "constraint vcp_pkey primary key (vendor_id, onboarding_stage),") },
  { id: "O", rule: "F16_primary_contact_uniqueness", why: "the active-primary-contact unique index is removed", mutate: (s) => s.replace(/create unique index if not exists uq_vendor_contacts_active_primary\n  on public\.vendor_contacts \(vendor_id\) where is_primary and is_active;\n/, "") },
  { id: "P", rule: "F17_task_contract", why: "the task idempotency unique index is removed", mutate: (s) => s.replace(/create unique index if not exists uq_vendor_tasks_idempotency\n  on public\.vendor_tasks \(idempotency_key\) where idempotency_key is not null;\n/, "") },
  { id: "Q", rule: "F18_no_ai_or_sql_rule", why: "an AI score column is added", mutate: (s) => s.replace("  budget_band                 text,", "  budget_band                 text,\n  ai_score                    numeric,") },
  { id: "R", rule: "F19_public_projection_unchanged", why: "vendor_public_v is altered", mutate: (s) => `${s}\ncreate or replace view public.vendor_public_v as select 1;\n` },
  { id: "S", rule: "F20_no_owner_binding", why: "an owner-binding column is added", mutate: (s) => `${s}\nalter table public.leads add column client_account_id uuid;\n` },
  { id: "T", rule: "F21_no_broad_priv", why: "ALTER DEFAULT PRIVILEGES is added", mutate: (s) => `${s}\nalter default privileges in schema public grant select on tables to authenticated;\n` },
  { id: "U", rule: "F23_self_verification", why: "the self-verification block is removed", mutate: (s) => s.replace(/do \$verify\$[\s\S]*\$verify\$;/, "-- verify removed\n") },
  { id: "V", rule: "F24_no_core_mutation", why: "a Core table is mutated", mutate: (s) => `${s}\nupdate public.vendors set is_active = true;\n` },
  { id: "W", rule: "F25_notes_bootstrap", why: "the create-if-absent bootstrap is removed",
    mutate: (s) => s.replace(/create table if not exists public\.vendor_internal_notes \([\s\S]*?created_by uuid\n\);\n/, "") },
  { id: "X", rule: "F25_notes_bootstrap", why: "an ALTER precedes the create (order defect)",
    mutate: (s) => s.replace("create table if not exists public.vendor_internal_notes (\n  id ",
      "alter table public.vendor_internal_notes add column if not exists zzz int;\ncreate table if not exists public.vendor_internal_notes (\n  id ") },
  { id: "Y", rule: "F25_notes_bootstrap", why: "the absent-path base shape omits note not null",
    mutate: (s) => s.replace("  note       text        not null,\n", "  note       text,\n") },
  { id: "Z", rule: "F25_notes_bootstrap", why: "created_by FK becomes CASCADE (history loss)",
    mutate: (s) => s.replace("add constraint vin_created_by_fk foreign key (created_by)\n  references public.profiles (id) on update restrict on delete set null;",
      "add constraint vin_created_by_fk foreign key (created_by)\n  references public.profiles (id) on update restrict on delete cascade;") },
  { id: "AA", rule: "F25_notes_bootstrap", why: "the legacy authenticated policy drop is removed",
    mutate: (s) => s.replace('drop policy if exists "vendor notes admin all" on public.vendor_internal_notes;', "-- removed") },
  { id: "BB", rule: "F26_notes_selfverify", why: "the absent-path notes final-contract self-check is removed",
    mutate: (s) => s.replace(/-- 9\.6b[\s\S]*?the legacy authenticated notes policy is still present\.';\n  end if;\n/, "") },
];
for (const fx of FIX) {
  const mutated = fx.mutate(migRaw); const changed = mutated !== migRaw;
  const f = changed ? evaluateMigration(mutated, `fx-${fx.id}`) : [];
  const tripped = f.some((x) => x.rule === fx.rule);
  record(`04 fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped, !changed ? "MUTATION NO-OP (vacuous)" : tripped ? `tripped (${f.length})` : `did NOT trip; ${f.map((x) => x.rule).join(",") || "none"}`);
}
record("05 every enforced migration rule has a fixture", (() => {
  const covered = new Set(FIX.map((f) => f.rule));
  const declared = [...new Set([...read(SELF).matchAll(/add\("(F\d\d_[a-z0-9_]+)"/g)].map((m) => m[1]))].filter((r) => !["F00_parse", "F01_creates_foundation"].includes(r));
  const missing = declared.filter((r) => !covered.has(r));
  return missing.length === 0 ? true : missing;
})() === true, "every enforced migration rule is exercised");

/* ===========================================================================
 * 3. Verifier
 * ========================================================================= */
const verRaw = read(VERIFIER);
const verFindings = evaluateVerifier(verRaw, "verify_30_1b");
record("06 real verifier has zero findings", verFindings.length === 0, verFindings.length === 0 ? "SELECT-only, asserts the full contract" : verFindings.map((f) => `${f.rule}: ${f.detail}`).join(" | "));
const VFIX = [
  { id: "VF1", rule: "V01_select_only", why: "verifier performs DML", mutate: (s) => `update public.vendor_tasks set status='done';\n${s}` },
  { id: "VF2", rule: "V02_required_assertions", why: "the rival-notes assertion is removed", mutate: (s) => s.replace(/vendor_notes/g, "removed_tbl") },
  { id: "VF3", rule: "V02_required_assertions", why: "the FK-restrict assertion is removed", mutate: (s) => s.replace(/confdeltype/g, "removed_col") },
];
for (const fx of VFIX) {
  const mutated = fx.mutate(verRaw); const changed = mutated !== verRaw;
  const f = changed ? evaluateVerifier(mutated, `vf-${fx.id}`) : [];
  const tripped = f.some((x) => x.rule === fx.rule);
  record(`07 verifier fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped, !changed ? "MUTATION NO-OP" : tripped ? `tripped (${f.length})` : `did NOT trip; ${f.map((x) => x.rule).join(",") || "none"}`);
}
record("08 verifier row count >= 20", (verRaw.match(/^select\s+\d+/gim) || []).length >= 20, `${(verRaw.match(/^select\s+\d+/gim) || []).length} rows`);

/* ===========================================================================
 * 4. Runtime contract file — no service-role / env / browser leakage
 * ========================================================================= */
const rt = read(RUNTIME);
record("09 runtime contract has no service-role/env/browser leakage", !/SERVICE_ROLE|process\.env|createBrowserClient|createClient\(/.test(rt) && !/adminClient|\.rpc\(/.test(rt), "pure constants, no client/secret");

/* ===========================================================================
 * 5. Contract manifest
 * ========================================================================= */
let man; try { man = JSON.parse(read(MANIFEST)); record("10 manifest parses", true, "ok"); } catch (e) { man = {}; record("10 manifest parses", false, e.message); }
record("11 manifest freezes access model + canonical notes + zero-row + no campaign", (() => {
  const s = JSON.stringify(man);
  return man?.access_model === "A_SERVER_ONLY" && man?.canonical_notes_authority === "public.vendor_internal_notes"
    && Array.isArray(man?.expected_zero_rows_new_tables) && man.expected_zero_rows_new_tables.length === 5
    && Array.isArray(man?.not_created_out_of_scope) && man.not_created_out_of_scope.includes("public.vendor_campaigns")
    && Array.isArray(man?.prohibited_core_truth_columns) && man.prohibited_core_truth_columns.includes("remaining_credits")
    && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s);
})(), "access A + canonical notes + 5 zero-row tables + no-campaign + prohibited cols + no UUID");
record("11b manifest freezes the two-path notes bootstrap (both start states)", (() => {
  const ss = man?.supported_start_states;
  return man?.notes_bootstrap_mode === "CREATE_IF_ABSENT_THEN_CONVERGE"
    && Array.isArray(ss) && ss.includes("ABSENT") && ss.includes("LEGACY_MINIMAL")
    && man?.lossless_existing_row_preservation === true
    && man?.no_second_notes_authority === true
    && man?.no_note_content_rewrite === true;
})(), "notes_bootstrap_mode + supported_start_states[ABSENT,LEGACY_MINIMAL] + lossless flags");

/* ===========================================================================
 * 6. Docs
 * ========================================================================= */
const bp = read(BLUEPRINT).toLowerCase();
const board = read(BOARD).toLowerCase();
record("12 blueprint records the canonical notes decision (evolve vendor_internal_notes)", bp.includes("vendor_internal_notes") && (bp.includes("evolve") || bp.includes("in place") || bp.includes("canonical notes")), "notes decision recorded");
record("13 board records 30.1B generated-not-applied + next preflight", board.includes("30.1b") && (board.includes("not applied") || board.includes("unapplied") || board.includes("generated")) && board.includes("preflight"), "board updated");

/* ===========================================================================
 * Report
 * ========================================================================= */
const passed = results.filter((r) => r.ok).length;
console.log("== QF-MVP-30.1B Vendor CRM foundation validator ==");
console.log(`migration : ${MIGRATION}`);
console.log(`mig SHA   : ${migSha}`);
console.log("");
for (const r of results) { console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`); if (!r.ok) console.log(`         ${r.detail}`); }
console.log("");
console.log(`checks: ${passed} passed, ${results.length - passed} failed (of ${results.length})`);
console.log(`fixtures: ${FIX.length} migration + ${VFIX.length} verifier one-defect mutations`);
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
