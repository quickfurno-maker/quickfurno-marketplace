#!/usr/bin/env node
/**
 * QF-MVP-20.5A — Offline validator for the profiles privilege + admin_role cleanup.
 *
 * Entirely offline. Reads files and hashes them. No socket, process, env or DB.
 *
 * Grades the real 20.5A migration, the SELECT-only verifier, the runtime cleanup
 * and the docs against the locked authority contract: least-privilege base-table
 * grants on public.profiles (authenticated SELECT only; anon/PUBLIC nothing;
 * service_role bootstrap preserved), no role-escalation surface, RLS preserved,
 * own-row policy boundaries preserved, the profiles.admin_role drift removed
 * safely (idempotent DROP + proven no dependency), no admin inference and no new
 * auth-trigger admin branch, and no owner-binding / assignment / package / credit
 * / lead scope creep.
 *
 * Usage:  node scripts/mvp/auth/validate-qf-mvp-20-5a.mjs
 * Exit 0 = PASS, exit 1 = FAIL. Fails closed on ambiguous parsing.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATION = "supabase/migrations/20260723001000_qf_mvp_profiles_privilege_admin_role_cleanup.sql";
const VERIFIER = "supabase/staging-verification/verify_qf_mvp_20_5a.sql";
const DOC = "docs/QF-MVP-20-5A-PROFILES-PRIVILEGE-ADMIN-ROLE-CLEANUP.md";
const BOARD = "docs/QF-MVP-EXECUTION-BOARD.md";
const RUNTIME_TYPES = "components/admin/adminTypes.ts";
const RUNTIME_VIEW = "components/admin/AdminSectionPage.tsx";
const SELF = "scripts/mvp/auth/validate-qf-mvp-20-5a.mjs";

/** Applied/reviewed and immutable — 20.5A must not have edited any of them. */
const LOCKED = [
  { file: "supabase/migrations/20260620000001_create_tables.sql", sha256: "ab03c500be5e873677cc558d23c0641fcd5072ad4ad52bed8fcfe92d6165edbc" },
  { file: "supabase/migrations/20260620000002_rls_policies.sql", sha256: "f266be5b9d9a9165e7bea12f84ce773aa51aea1e2d22fec9b43a1a031319df60" },
  { file: "supabase/migrations/20260621000006_superadmin_foundation.sql", sha256: "d5e1adfddaa3d30ebad148dcaf8291d75da5b9594d359b13fd84345a08c488ae" },
  { file: "supabase/migrations/20260723000700_qf_mvp_auth_user_onboarding_trigger.sql", sha256: "8fb3c28c2c0e776d88d3c8163a895c5e108cb84b89ac95f41b86a521f50daecd" },
  { file: "supabase/migrations/20260723000900_qf_mvp_credit_ledger_reconciliation_exception_register.sql", sha256: "75b6faf2f7ed52007b79b9036dd5998f00eb67d88e62ffa34b3d9d1343c5039d" },
];

const results = [];
let failed = false;
function record(name, ok, detail) { results.push({ name, ok, detail }); if (!ok) failed = true; }
function read(rel) { return readFileSync(path.join(ROOT, rel), "utf8"); }
function sha256(t) { return createHash("sha256").update(t, "utf8").digest("hex"); }

/* SQL tokenizer: comments + string literals removed (structural code), plus the
 * dollar-quoted bodies collected separately. */
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
const FINANCIAL_TABLES = ["vendors", "vendor_packages", "lead_assignments", "vendor_credit_logs", "leads"];

/* ===========================================================================
 * MIGRATION EVALUATOR
 * ========================================================================= */
export function evaluateMigration(sql, label = "20.5A") {
  const findings = [];
  const add = (rule, detail) => findings.push({ rule, detail });
  let tok, text;
  try { tok = tokenize(sql, label); } catch (e) { add("G00_parse", e.message); return findings; }
  try { text = stripComments(sql, label); } catch (e) { add("G00_parse", e.message); return findings; }
  const exec = norm(text);              // comments removed, literals kept
  const execNoBodies = norm(tok.code);  // comments + literals + $bodies removed
  const bodies = tok.bodies.map(norm).join("\n");

  // -- G01 authenticated is granted SELECT on profiles -----------------------
  if (!/grant\s+select\s+on\s+table\s+public\.profiles\s+to\s+authenticated/.test(exec)) {
    add("G01_authenticated_select_present", "authenticated is not granted SELECT on profiles");
  }

  // -- G02 authenticated granted nothing broader than SELECT -----------------
  //     any grant to authenticated whose privilege list includes a non-SELECT
  //     verb (or ALL) is an over-grant / escalation surface.
  for (const m of exec.matchAll(/grant\s+([a-z, ]+?)\s+on\s+table\s+public\.profiles\s+to\s+([a-z, ]+)/g)) {
    const privs = m[1].split(",").map((s) => s.trim());
    const roles = m[2].split(",").map((s) => s.trim());
    if (roles.includes("authenticated")) {
      for (const p of privs) if (p !== "select") add("G02_authenticated_not_broader", `authenticated granted '${p}' (only SELECT is proven)`);
    }
  }
  // explicit belt: no authenticated write/DDL privilege anywhere
  for (const v of ["insert", "update", "delete", "truncate", "references", "trigger", "maintain", "all", "all privileges"]) {
    if (new RegExp(`grant\\s+[a-z, ]*\\b${v}\\b[a-z, ]*\\s+on\\s+table\\s+public\\.profiles\\s+to\\s+[a-z, ]*authenticated`).test(exec)) {
      add(v === "insert" ? "G05_no_authenticated_insert" : "G02_authenticated_not_broader", `authenticated granted ${v}`);
    }
  }

  // -- G03 no anon / PUBLIC privilege granted, and both are revoked ----------
  for (const r of ["anon", "public"]) {
    if (new RegExp(`grant\\s+[a-z, ]+\\s+on\\s+table\\s+public\\.profiles\\s+to\\s+[a-z, ]*\\b${r}\\b`).test(exec)) {
      add("G03_no_untrusted_privilege", `grants a profiles privilege to ${r}`);
    }
    if (!new RegExp(`revoke\\s+all\\s+privileges\\s+on\\s+table\\s+public\\.profiles\\s+from\\s+[a-z, ]*\\b${r}\\b`).test(exec)) {
      add("G03_no_untrusted_privilege", `does not revoke ALL from ${r}`);
    }
  }
  // authenticated write privileges must be revoked (deterministic reset)
  if (!/revoke\s+all\s+privileges\s+on\s+table\s+public\.profiles\s+from\s+[a-z, ]*authenticated/.test(exec)) {
    add("G02_authenticated_not_broader", "does not revoke ALL from authenticated before granting SELECT");
  }

  // -- G06 RLS preserved (never disabled) -----------------------------------
  if (/disable\s+row\s+level\s+security/.test(exec)) add("G06_rls_preserved", "disables RLS on a table");
  if (!/alter\s+table\s+public\.profiles\s+enable\s+row\s+level\s+security/.test(exec)) {
    add("G06_rls_preserved", "does not (re)assert RLS enabled on profiles");
  }

  // -- G07 admin_role drift removed safely (idempotent DROP, not blind) ------
  if (!/alter\s+table\s+public\.profiles\s+drop\s+column\s+if\s+exists\s+admin_role/.test(exec)) {
    add("G07_admin_role_dropped", "does not drop profiles.admin_role with DROP COLUMN IF EXISTS");
  }
  if (/drop\s+column\s+admin_role\b/.test(exec) && !/drop\s+column\s+if\s+exists\s+admin_role/.test(exec)) {
    add("G07_admin_role_dropped", "blind DROP COLUMN admin_role (missing IF EXISTS / dependency safety)");
  }

  // -- G08 no admin inference from metadata/email/phone/client input --------
  if (/(raw_user_meta_data|user_metadata|raw_app_meta_data|app_metadata)\b[\s\S]{0,40}(admin|role|superadmin)/.test(exec)
      || /(email|phone)\b[\s\S]{0,30}(=\s*'admin'|admin_role|is_admin\s*=)/.test(exec)) {
    add("G08_no_admin_inference", "derives admin/role from metadata/email/phone");
  }

  // -- G09 no new auth-trigger admin branch / trigger rewrite ---------------
  if (/create\s+(or\s+replace\s+)?trigger\s+on_auth_user_created/.test(exec)
      || /create\s+or\s+replace\s+function\s+public\.handle_new_user/.test(exec)) {
    add("G09_no_auth_trigger_change", "recreates the auth trigger / handle_new_user (D contract is out of scope)");
  }

  // -- G10 does not re-add admin_role (as column or authority) --------------
  //     Scan STRUCTURAL code (literals + $verify$ body removed) minus the DROP,
  //     so the DROP statement and the self-check's error-message strings that
  //     legitimately name admin_role do not false-trip this rule.
  if (/add\s+column\s+(if\s+not\s+exists\s+)?admin_role/.test(exec)) add("G10_no_readd_admin_role", "re-adds an admin_role column");
  const structuralNoDrop = execNoBodies.replace(/drop\s+column\s+if\s+exists\s+admin_role/g, "");
  if (/\badmin_role\b/.test(structuralNoDrop)) add("G10_no_readd_admin_role", "references admin_role in a live (non-DROP) statement");

  // -- G11 no owner binding -------------------------------------------------
  if (/alter\s+table\s+public\.leads\s+add\s+column\s+(if\s+not\s+exists\s+)?(client_account_id|user_id|created_by)\b/.test(exec)) {
    add("G11_no_owner_binding", "adds an owner-binding column on leads");
  }

  // -- G12 no assignment/package/credit/lead mutation -----------------------
  for (const t of FINANCIAL_TABLES) {
    if (new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?${t}\\b`).test(execNoBodies)) {
      add("G12_no_financial_scope", `mutates public.${t}`);
    }
  }
  // no user-role rewrite
  if (/update\s+(public\.)?profiles\s+set\b/.test(execNoBodies)) add("G12_no_financial_scope", "rewrites profiles rows");

  // -- G13 no broad / default-privilege change ------------------------------
  if (/\balter\s+default\s+privileges\b/.test(exec)) add("G13_no_broad_priv", "ALTER DEFAULT PRIVILEGES");
  if (/\b(grant|revoke)\b[^;]*\bon\s+(all\s+(tables|functions|routines)|schema)\b/.test(exec)) add("G13_no_broad_priv", "broad ON ALL / ON SCHEMA");
  if (/\bgrant\s+all\b[^;]*\bto\s+[a-z, ]*(anon|authenticated|public)\b/.test(exec)) add("G13_no_broad_priv", "GRANT ALL to an untrusted role");

  // -- G14 self-verification present, catalog-based -------------------------
  if (!/do\s+\$verify\$/.test(sql)) add("G14_self_verification", "no self-verification block");
  if (/pg_get_functiondef|prosrc\b|routine_definition/.test(bodies)) add("G14_self_verification", "lexical assertion over function source");
  for (const marker of ["has_table_privilege", "relrowsecurity", "admin_role"]) {
    if (!new RegExp(marker).test(bodies)) add("G14_self_verification", `self-verification does not check ${marker}`);
  }

  // -- G15 schema/ACL only: no DML ------------------------------------------
  for (const [re, why] of [
    [/(^|;)\s*insert\s+into\b/, "INSERT"],
    [/(^|;)\s*update\s+[a-z0-9_."]+\s+set\b/, "UPDATE"],
    [/(^|;)\s*delete\s+from\b/, "DELETE"],
    [/\bmerge\s+into\b/, "MERGE"],
    [/\bselect\b[\s\S]*?\binto\s+[a-z]/, "SELECT INTO"],
  ]) if (re.test(execNoBodies)) add("G15_no_dml", why);

  // -- G16 self-verify asserts the role-escalation surface is closed --------
  if (!/has_table_privilege\(\s*'authenticated'[^)]*'update'/.test(bodies)
      && !/'update'[\s\S]{0,80}authenticated/.test(bodies)) {
    add("G16_escalation_selfcheck", "self-verification does not assert authenticated lacks UPDATE (escalation proof)");
  }

  // -- G17 service_role keeps EXACTLY SELECT + INSERT + UPDATE ---------------
  for (const need of ["select", "insert", "update"]) {
    if (!new RegExp(`grant\\s+[a-z, ]*\\b${need}\\b[a-z, ]*\\s+on\\s+table\\s+public\\.profiles\\s+to\\s+[a-z, ]*service_role`).test(exec)) {
      add("G17_service_role_preserved", `does not grant ${need} to service_role (admin bootstrap)`);
    }
  }

  // -- G19 service_role least privilege: no DELETE / TRUNCATE / REFERENCES /
  //        TRIGGER / MAINTAIN / ALL over-grant, deterministic revoke, and a
  //        self-verification that proves the DELETE absence. ------------------
  for (const bad of ["delete", "truncate", "references", "trigger", "maintain", "all", "all privileges"]) {
    if (new RegExp(`grant\\s+[a-z, ]*\\b${bad}\\b[a-z, ]*\\s+on\\s+table\\s+public\\.profiles\\s+to\\s+[a-z, ]*service_role`).test(exec)) {
      add("G19_service_role_no_delete", `grants ${bad} to service_role (over-privilege)`);
    }
  }
  if (!/revoke\s+all\s+privileges\s+on\s+table\s+public\.profiles\s+from\s+[a-z, ]*service_role/.test(exec)) {
    add("G19_service_role_no_delete", "does not deterministically revoke ALL from service_role before granting");
  }
  if (!/has_table_privilege\(\s*'service_role'[^)]*'delete'/.test(bodies)) {
    add("G19_service_role_no_delete", "self-verification does not assert service_role lacks DELETE");
  }

  // -- G18 hygiene: no txn control / history write / secret -----------------
  if (/(^|;|\s)(begin|commit|rollback)\s*(;|$)/.test(execNoBodies)) add("G18_hygiene", "explicit transaction control");
  if (/supabase_migrations|schema_migrations/.test(exec)) add("G18_hygiene", "touches migration-history tables");
  if (/https?:\/\/|service_role_key|sb_secret|eyj[a-z0-9]/i.test(exec)) add("G18_hygiene", "URL/credential token");

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
  for (const marker of ["profiles", "has_table_privilege", "authenticated", "admin_role", "relrowsecurity",
    "profiles self read", "is_admin", "on_auth_user_created", "service_role", "credit_ledger_reconciliation_exceptions"]) {
    if (!new RegExp(marker).test(exec)) add("V02_required_assertions", `verifier never asserts on ${marker}`);
  }
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
    actual === item.sha256 ? actual.slice(0, 16) : `expected ${item.sha256}, got ${actual}`);
}

/* ===========================================================================
 * 2. Real migration zero findings + fixtures
 * ========================================================================= */
const migRaw = read(MIGRATION);
const migSha = sha256(migRaw);
const realFindings = evaluateMigration(migRaw, "20260723001000");
record("02 real migration has zero findings", realFindings.length === 0,
  realFindings.length === 0 ? "least-privilege grants, admin_role dropped, no escalation surface"
    : realFindings.map((f) => `${f.rule}: ${f.detail}`).join(" | "));
record("03 migration path is the locked candidate identity",
  MIGRATION === "supabase/migrations/20260723001000_qf_mvp_profiles_privilege_admin_role_cleanup.sql", MIGRATION);

const FIXTURES = [
  { id: "A", rule: "G01_authenticated_select_present", why: "the authenticated SELECT grant is removed",
    mutate: (s) => s.replace("grant select on table public.profiles to authenticated;", "-- removed") },
  { id: "B", rule: "G02_authenticated_not_broader", why: "authenticated is granted UPDATE",
    mutate: (s) => s.replace("grant select on table public.profiles to authenticated;",
      "grant select on table public.profiles to authenticated;\ngrant update on table public.profiles to authenticated;") },
  { id: "C", rule: "G05_no_authenticated_insert", why: "authenticated is granted INSERT",
    mutate: (s) => `${s}\ngrant insert on table public.profiles to authenticated;\n` },
  { id: "D", rule: "G03_no_untrusted_privilege", why: "anon is granted SELECT",
    mutate: (s) => `${s}\ngrant select on table public.profiles to anon;\n` },
  { id: "E", rule: "G03_no_untrusted_privilege", why: "the anon revoke is removed",
    mutate: (s) => s.replace("revoke all privileges on table public.profiles from anon;", "-- removed") },
  { id: "F", rule: "G06_rls_preserved", why: "RLS is disabled",
    mutate: (s) => `${s}\nalter table public.profiles disable row level security;\n` },
  { id: "G", rule: "G07_admin_role_dropped", why: "the admin_role DROP is removed",
    mutate: (s) => s.replace("alter table public.profiles drop column if exists admin_role;", "-- removed") },
  { id: "H", rule: "G07_admin_role_dropped", why: "the DROP is blind (no IF EXISTS)",
    mutate: (s) => s.replace("alter table public.profiles drop column if exists admin_role;", "alter table public.profiles drop column admin_role;") },
  { id: "I", rule: "G08_no_admin_inference", why: "admin is inferred from user_metadata",
    mutate: (s) => `${s}\nupdate x set role = case when raw_user_meta_data ->> 'admin_role' is not null then 'admin' end;\n` },
  { id: "J", rule: "G09_no_auth_trigger_change", why: "the auth trigger is recreated",
    mutate: (s) => `${s}\ncreate or replace function public.handle_new_user() returns trigger as $x$ begin return new; end; $x$ language plpgsql;\n` },
  { id: "K", rule: "G10_no_readd_admin_role", why: "an admin_role column is re-added",
    mutate: (s) => `${s}\nalter table public.profiles add column admin_role text;\n` },
  { id: "L", rule: "G11_no_owner_binding", why: "an owner-binding column is added",
    mutate: (s) => `${s}\nalter table public.leads add column client_account_id uuid;\n` },
  { id: "M", rule: "G12_no_financial_scope", why: "vendor_credit_logs is mutated",
    mutate: (s) => `${s}\nupdate public.vendor_credit_logs set credits_delta = 0;\n` },
  { id: "N", rule: "G13_no_broad_priv", why: "ALTER DEFAULT PRIVILEGES is added",
    mutate: (s) => `${s}\nalter default privileges in schema public grant select on tables to authenticated;\n` },
  { id: "O", rule: "G14_self_verification", why: "the self-verification block is removed",
    mutate: (s) => s.replace(/do \$verify\$[\s\S]*\$verify\$;/, "-- verify removed\n") },
  { id: "P", rule: "G15_no_dml", why: "a data insert is added",
    mutate: (s) => `${s}\ninsert into public.profiles (id) values (gen_random_uuid());\n` },
  { id: "Q", rule: "G16_escalation_selfcheck", why: "the authenticated-no-UPDATE self-check is removed",
    mutate: (s) => s.replace(/or has_table_privilege\('authenticated', v_rel, 'UPDATE'\)\n/, "") },
  { id: "R", rule: "G17_service_role_preserved", why: "the service_role grant is removed",
    mutate: (s) => s.replace("grant select, insert, update on table public.profiles to service_role;", "-- removed") },
  { id: "S", rule: "G18_hygiene", why: "transaction control is added",
    mutate: (s) => `begin;\n${s}\ncommit;\n` },
  { id: "T", rule: "G12_no_financial_scope", why: "profiles roles are rewritten",
    mutate: (s) => `${s}\nupdate public.profiles set role = 'admin';\n` },
  { id: "U", rule: "G19_service_role_no_delete", why: "service_role is granted DELETE",
    mutate: (s) => s.replace("grant select, insert, update on table public.profiles to service_role;",
      "grant select, insert, update, delete on table public.profiles to service_role;") },
  { id: "V", rule: "G19_service_role_no_delete", why: "the deterministic service_role revoke is removed",
    mutate: (s) => s.replace("revoke all privileges on table public.profiles from service_role;\n", "") },
  { id: "W", rule: "G19_service_role_no_delete", why: "the self-check for service_role DELETE absence is removed",
    mutate: (s) => s.replace(/if has_table_privilege\('service_role', v_rel, 'DELETE'\)/, "if false and has_table_privilege('service_role', v_rel, 'xDELETE')") },
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
record("05 every enforced migration rule has a fixture", (() => {
  const covered = new Set(FIXTURES.map((f) => f.rule));
  const declared = [...new Set([...read(SELF).matchAll(/add\("(G\d\d_[a-z0-9_]+)"/g)].map((m) => m[1]))]
    .filter((r) => !["G00_parse"].includes(r));
  const missing = declared.filter((r) => !covered.has(r));
  return missing.length === 0 ? true : missing;
})() === true, "every enforced migration rule is exercised");

/* ===========================================================================
 * 3. Verifier
 * ========================================================================= */
const verRaw = read(VERIFIER);
const verSha = sha256(verRaw);
const verFindings = evaluateVerifier(verRaw, "verify_20_5a");
record("06 real verifier has zero findings", verFindings.length === 0,
  verFindings.length === 0 ? "SELECT-only, asserts the full contract" : verFindings.map((f) => `${f.rule}: ${f.detail}`).join(" | "));
const VER_FIXTURES = [
  { id: "VF1", rule: "V01_select_only", why: "verifier performs DML", mutate: (s) => `update public.profiles set role='admin';\n${s}` },
  { id: "VF2", rule: "V02_required_assertions", why: "the admin_role-absent assertion is removed", mutate: (s) => s.replace(/admin_role/g, "removed_col") },
  { id: "VF3", rule: "V02_required_assertions", why: "the has_table_privilege assertions are removed", mutate: (s) => s.replace(/has_table_privilege/g, "removed_fn") },
];
for (const fx of VER_FIXTURES) {
  const mutated = fx.mutate(verRaw);
  const changed = mutated !== verRaw;
  const f = changed ? evaluateVerifier(mutated, `vf-${fx.id}`) : [];
  const tripped = f.some((x) => x.rule === fx.rule);
  record(`07 verifier fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "MUTATION WAS A NO-OP" : tripped ? `tripped (${f.length})` : `did NOT trip; ${f.map((x) => x.rule).join(",") || "none"}`);
}
record("08 verifier row count >= 20", (verRaw.match(/^select\s+\d+/gim) || []).length >= 20,
  `${(verRaw.match(/^select\s+\d+/gim) || []).length} rows`);

/* ===========================================================================
 * 4. Runtime cleanup: no live profiles.admin_role column reference remains
 * ========================================================================= */
const typesRaw = read(RUNTIME_TYPES);
record("09 profiles type has no admin_role field", !/\n\s*admin_role\s*\??\s*:/.test(typesRaw),
  /\n\s*admin_role\s*\??\s*:/.test(typesRaw) ? "adminTypes still declares admin_role" : "removed");
const viewRaw = read(RUNTIME_VIEW);
record("10 admin view reads no profile.admin_role", !/profile\.admin_role/.test(viewRaw),
  /profile\.admin_role/.test(viewRaw) ? "AdminSectionPage still reads profile.admin_role" : "removed");

/* ===========================================================================
 * 5. Documentation
 * ========================================================================= */
const doc = read(DOC).toLowerCase();
const board = read(BOARD).toLowerCase();
record("11 auth doc records the privilege + admin_role decision",
  doc.includes("20.5a") && doc.includes("admin_role")
    && (doc.includes("select only") || doc.includes("select-only") || doc.includes("authenticated"))
    && (doc.includes("escalation") || doc.includes("no update")),
  "auth doc updated with the privilege + admin_role decision");
record("12 board records 20.5A generated-not-applied + next preflight",
  board.includes("20.5a") && (board.includes("not applied") || board.includes("unapplied")) && board.includes("preflight"),
  "board updated");

/* ===========================================================================
 * Report
 * ========================================================================= */
const passed = results.filter((r) => r.ok).length;
console.log("== QF-MVP-20.5A profiles privilege + admin_role validator ==");
console.log(`migration : ${MIGRATION}`);
console.log(`mig SHA   : ${migSha}`);
console.log(`verifier  : ${VERIFIER}`);
console.log(`ver SHA   : ${verSha}`);
console.log("");
for (const r of results) { console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`); if (!r.ok) console.log(`         ${r.detail}`); }
console.log("");
console.log(`checks: ${passed} passed, ${results.length - passed} failed (of ${results.length})`);
console.log(`fixtures: ${FIXTURES.length} migration + ${VER_FIXTURES.length} verifier one-defect mutations`);
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
