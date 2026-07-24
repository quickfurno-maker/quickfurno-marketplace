#!/usr/bin/env node
/**
 * QF-MVP-20.3D — Offline migration validator.
 *
 * Entirely offline. Reads files from disk and hashes them. Opens no socket,
 * spawns no process, reads no environment variable and touches no database.
 *
 * Grades the real Migration D (auth-user onboarding trigger), its SELECT-only
 * verifier, and the repository's onboarding posture, against the frozen D
 * contract.
 *
 * The single most important rule here is R08: the profile `role` must be a
 * TRUSTED CONSTANT and must never be derived from raw_user_meta_data. The
 * original repository function used `coalesce(new.raw_user_meta_data->>'role',
 * 'vendor')`, which would let any anonymous signup self-assign 'admin' and
 * unlock every is_admin() RLS policy. This validator makes that regression
 * impossible to reintroduce silently.
 *
 * Usage:  node scripts/mvp/staging/validate-qf-mvp-20-3d.mjs
 * Exit 0 = PASS, exit 1 = FAIL. Fails closed on ambiguous parsing.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const MIGRATION_D = "supabase/migrations/20260723000700_qf_mvp_auth_user_onboarding_trigger.sql";
const PHASE_VERIFIER_D = "supabase/staging-verification/verify_qf_mvp_20_3d.sql";

/** Applied/reviewed and immutable. D must not have touched any of them. */
const LOCKED = [
  { file: "supabase/migrations/20260723000100_qf_mvp_marketplace_authority_foundation.sql",
    sha256: "b6307094715a102fa0cfccc1533cb8089e5b26fbe1e80a294c127b81e29f2b83" },
  { file: "supabase/migrations/20260723000200_qf_mvp_assignment_lineage_backfill.sql",
    sha256: "9d77f4460701caa1caf172b50886b681f4b7e86849172ca2a7af1ece70eb3d60" },
  { file: "supabase/migrations/20260723000300_qf_mvp_canonical_assignment_authority.sql",
    sha256: "46ce7377a217a13620305572f1be9038a56c911ce76a556b4d52f91fe107177e" },
  { file: "supabase/migrations/20260723000400_qf_mvp_lineage_append_only_grants.sql",
    sha256: "91544524c27ca26020b648f13f462d2613ca407366c8de0f258ea4f04d8c553b" },
  { file: "supabase/migrations/20260723000500_qf_mvp_assignment_universal_enforcement.sql",
    sha256: "d13703553663271172cfdcedc5e9be8374e7e9c1d225d2c67816fce837450cf3" },
  { file: "supabase/migrations/20260723000600_qf_mvp_public_projection_privilege_hardening.sql",
    sha256: "0d3d871b0c6ab9de8d82eeb8499437f1f40a8a6c81561cf41cb8ade60b464da2" },
  { file: "supabase/staging-verification/verify_qf_mvp_20_3c.sql",
    sha256: "1f7bf9a511eb77f37578ef92771fdddf85cd2aa0522ac4648a7041b56586a980" },
  { file: "scripts/mvp/staging/validate-qf-mvp-20-3c.mjs",
    sha256: "d632aa2584976cce1ac6058e782ac1910675c3cbaa70ccf6f30593f9c2c3725d" },
];

const results = [];
let failed = false;
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed = true;
}
function read(rel) { return readFileSync(path.join(ROOT, rel), "utf8"); }
function sha256(text) { return createHash("sha256").update(text, "utf8").digest("hex"); }

/* --------------------------------------------------------------------------
 * SQL tokenizer — strips comments, strings, quoted identifiers, dollar bodies.
 * Fails closed on an unterminated construct.
 * ------------------------------------------------------------------------ */
function tokenize(sql, label) {
  let code = ""; const bodies = []; let i = 0; const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") { const nl = sql.indexOf("\n", i); i = nl === -1 ? n : nl; continue; }
    if (two === "/*") {
      let depth = 1; i += 2;
      while (i < n && depth > 0) {
        if (sql.slice(i, i + 2) === "/*") { depth++; i += 2; continue; }
        if (sql.slice(i, i + 2) === "*/") { depth--; i += 2; continue; }
        i++;
      }
      if (depth !== 0) throw new Error(`${label}: unterminated block comment`);
      continue;
    }
    if (sql[i] === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      code += " '' "; continue;
    }
    if (sql[i] === '"') {
      let id = ""; i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') { id += '"'; i += 2; continue; }
        if (sql[i] === '"') { i++; break; }
        id += sql[i]; i++;
      }
      code += ` "${id}" `; continue;
    }
    if (sql[i] === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0]; const start = i + tag.length;
        const end = sql.indexOf(tag, start);
        if (end === -1) throw new Error(`${label}: unterminated dollar body ${tag}`);
        bodies.push(sql.slice(start, end)); code += " $BODY$ "; i = end + tag.length; continue;
      }
    }
    code += sql[i]; i++;
  }
  return { code, bodies };
}

/** Strip comments only; preserve strings and dollar-body contents. */
function stripComments(sql, label) {
  let out = ""; let i = 0; const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") { const nl = sql.indexOf("\n", i); i = nl === -1 ? n : nl; continue; }
    if (two === "/*") {
      let depth = 1; i += 2;
      while (i < n && depth > 0) {
        if (sql.slice(i, i + 2) === "/*") { depth++; i += 2; continue; }
        if (sql.slice(i, i + 2) === "*/") { depth--; i += 2; continue; }
        i++;
      }
      if (depth !== 0) throw new Error(`${label}: unterminated block comment`);
      continue;
    }
    if (sql[i] === "'") {
      const s = i; i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      out += sql.slice(s, i); continue;
    }
    if (sql[i] === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0]; const start = i + tag.length;
        const end = sql.indexOf(tag, start);
        if (end === -1) throw new Error(`${label}: unterminated dollar body ${tag}`);
        out += tag + stripComments(sql.slice(start, end), label) + tag;
        i = end + tag.length; continue;
      }
    }
    out += sql[i]; i++;
  }
  return out;
}

const norm = (t) => t.replace(/\s+/g, " ").toLowerCase();

/* Reused defect-class detectors from the B2R1 / CVR1 corrections. */
const NAME_COLS = ["attname", "relname", "proname", "tgname", "nspname", "conname", "polname"];
function findNameArrayDefects(stripped) {
  const out = []; const re = /array_agg\s*\(/gi; let m;
  while ((m = re.exec(stripped)) !== null) {
    let d = 0, i = m.index + m[0].length - 1, s = i + 1;
    for (; i < stripped.length; i++) {
      if (stripped[i] === "(") d++;
      else if (stripped[i] === ")") { d--; if (d === 0) break; }
    }
    if (d !== 0) continue;
    const el = stripped.slice(s, i).split(/\border\s+by\b/i)[0];
    const c = (el.match(/\b[a-z_][a-z0-9_]*\.([a-z_]+)\b/i) || [])[1];
    if (!c || !NAME_COLS.includes(c.toLowerCase())) continue;
    if (/::\s*(text|varchar)\b/i.test(el)) continue;
    out.push(`array_agg over catalog name column "${c}" not cast to text (name[] vs text[])`);
  }
  return out;
}
function findAsymmetricArrayComparisons(stripped) {
  const out = []; const re = /=\s*array\s*\[/gi; let m;
  while ((m = re.exec(stripped)) !== null) {
    const lhs = stripped.slice(Math.max(0, m.index - 400), m.index);
    if (!/array_agg\s*\(/i.test(lhs)) continue;
    out.push("array_agg(...) compared with a raw hand-ordered ARRAY literal");
  }
  return out;
}

/* ===========================================================================
 * THE EVALUATOR — one function, applied to the real migration AND fixtures.
 * ========================================================================= */

const FN = "handle_new_user";
const TRG = "on_auth_user_created";
/** The frozen insert column list. */
const INSERT_COLS = ["id", "full_name", "phone", "role"];
/** The ONLY metadata keys the trigger may read (non-privileged display text). */
const ALLOWED_META_KEYS = ["full_name", "phone"];
/** Privileged concepts that must never be sourced from metadata. */
const FORBIDDEN_META_KEYS = [
  "role", "admin", "admin_role", "is_admin", "superadmin", "verified",
  "verification_status", "package", "package_status", "paid", "paid_status",
  "credits", "remaining_credits", "total_credits", "status", "approved",
];

export function evaluateDMigration(sql, label = "D") {
  const findings = [];
  const add = (rule, detail) => findings.push({ rule, detail });

  let tokens, text;
  try { tokens = tokenize(sql, label); } catch (e) { add("R00_parse", e.message); return findings; }
  try { text = stripComments(sql, label); } catch (e) { add("R00_parse", e.message); return findings; }
  const code = norm(tokens.code);
  const stripped = norm(text);
  const bodies = tokens.bodies.map(norm).join("\n");

  // Isolate the function body (comment-stripped) — the security-critical region.
  const fnMatch = text.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${FN}\\s*\\(\\s*\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`, "i"));
  const fnBody = fnMatch ? norm(fnMatch[1]) : "";
  // Declaration header (between CREATE FUNCTION and the body opener).
  const fnDecl = norm((text.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${FN}[\\s\\S]*?as\\s*\\$\\$`, "i")) || [""])[0]);

  // -- R01 no explicit transaction control -----------------------------------
  if (/(^|;|\s)(begin|commit|rollback|start transaction|savepoint)\s*(;|$)/.test(code)) {
    // `begin` opens the plpgsql body too, so only flag it OUTSIDE dollar bodies.
    add("R01_no_transaction_control", "explicit transaction control in executable SQL");
  }

  // -- R02 no destructive DDL, and no data backfill --------------------------
  for (const [re, why] of [
    [/\bdrop\s+table\b/, "drop table"],
    [/\bdrop\s+schema\b/, "drop schema"],
    [/\bdrop\s+database\b/, "drop database"],
    [/\bdrop\s+policy\b/, "drop policy"],
    [/\bdrop\s+function\b/, "drop function"],
    [/(^|;)\s*truncate\b/, "truncate"],
    [/\balter\s+table\s+[a-z_."]*auth\./, "ALTER on the auth schema"],
    [/\bdelete\s+from\b/, "delete"],
  ]) if (re.test(code)) add("R02_no_destructive", why);

  // -- R03 no migration-history write ----------------------------------------
  if (/supabase_migrations|schema_migrations/.test(stripped)) {
    add("R03_no_history_write", "touches the migration-history tables");
  }

  // -- R04 no secrets / URLs / project refs ----------------------------------
  if (/https?:\/\/|supabase\.co|postgres(ql)?:\/\/|service_role_key|sb_secret|eyj[a-z0-9]/i.test(stripped)) {
    add("R04_no_secrets_or_urls", "URL, project ref or credential-shaped token in executable SQL");
  }

  // -- R05 no broad grants / default privileges ------------------------------
  if (/\bgrant\s+all\b/.test(code)) add("R05_no_broad_grants", "GRANT ALL");
  if (/\balter\s+default\s+privileges\b/.test(code)) add("R05_no_broad_grants", "ALTER DEFAULT PRIVILEGES");

  // -- R06 the onboarding function is defined, zero-argument -----------------
  if (!new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${FN}\\s*\\(\\s*\\)`).test(code)) {
    add("R06_function_present", `missing create or replace function public.${FN}()`);
  }
  if (!fnMatch) add("R06_function_present", "could not isolate the function body");

  // -- R07 exactly one auth.users trigger, AFTER INSERT FOR EACH ROW ---------
  if (!new RegExp(`drop\\s+trigger\\s+if\\s+exists\\s+${TRG}\\s+on\\s+auth\\.users`).test(code)) {
    add("R07_trigger_present", "missing idempotent drop guard for the trigger");
  }
  if (!new RegExp(`create\\s+trigger\\s+${TRG}\\s+after\\s+insert\\s+on\\s+auth\\.users\\s+for\\s+each\\s+row`).test(code)) {
    add("R07_trigger_present", `missing or mis-timed trigger ${TRG} (must be AFTER INSERT ... FOR EACH ROW on auth.users)`);
  }
  if (/\bbefore\s+insert\s+on\s+auth\.users/.test(code)) {
    add("R07_trigger_present", "BEFORE INSERT on auth.users (profiles.id FKs auth.users, so it must be AFTER)");
  }
  if (/\bon\s+auth\.users[\s\S]{0,40}?\b(update|delete|truncate)\b/.test(code)) {
    add("R07_trigger_present", "the auth trigger fires on UPDATE/DELETE (password reset must not re-run onboarding)");
  }
  const created = [...code.matchAll(/create\s+trigger\s+([a-z0-9_]+)/g)].map((m) => m[1]);
  if (created.length !== 1 || created[0] !== TRG) {
    add("R07_trigger_present", `expected exactly one trigger (${TRG}), found ${JSON.stringify(created)}`);
  }

  // -- R08 THE CRITICAL RULE: role is a trusted CONSTANT, never metadata -----
  if (fnBody) {
    // Any metadata read that feeds the role is a privilege-escalation vector.
    if (/raw_user_meta_data\s*->>\s*'role'/.test(fnBody)
        || /raw_app_meta_data\s*->>\s*'role'/.test(fnBody)) {
      add("R08_role_is_trusted_constant",
        "role is derived from raw_user_meta_data — this is the self-signup admin escalation vector");
    }
    if (!/'vendor'/.test(fnBody)) {
      add("R08_role_is_trusted_constant", "the constant non-privileged role 'vendor' is not present");
    }
    if (/'admin'/.test(fnBody)) {
      add("R08_role_is_trusted_constant", "the function references the privileged role 'admin'");
    }
  }

  // -- R09 metadata allowlist: only non-privileged display keys --------------
  if (fnBody) {
    const keys = [...fnBody.matchAll(/raw_user_meta_data\s*->>\s*'([a-z_]+)'/g)].map((m) => m[1]);
    for (const k of keys) {
      if (!ALLOWED_META_KEYS.includes(k)) {
        add("R09_metadata_allowlist", `metadata key '${k}' is read but is not in the allowlist [${ALLOWED_META_KEYS}]`);
      }
      if (FORBIDDEN_META_KEYS.includes(k)) {
        add("R09_metadata_allowlist", `PRIVILEGED metadata key '${k}' is read from signup metadata`);
      }
    }
    // Wholesale JSON copy (no ->> extraction) is forbidden.
    if (/raw_user_meta_data\s*(,|\)|$)/.test(fnBody) || /values[\s\S]{0,200}?new\.raw_user_meta_data\s*[,)]/.test(fnBody)) {
      add("R09_metadata_allowlist", "the metadata JSON appears to be copied wholesale");
    }
  }

  // -- R10 explicit insert column list, into profiles only ------------------
  if (fnBody) {
    const ins = fnBody.match(/insert\s+into\s+public\.profiles\s*\(([^)]*)\)/);
    if (!ins) {
      add("R10_explicit_columns", "no explicit `insert into public.profiles (...)` column list");
    } else {
      const cols = ins[1].split(",").map((c) => c.trim());
      if (JSON.stringify(cols) !== JSON.stringify(INSERT_COLS)) {
        add("R10_explicit_columns", `insert columns ${JSON.stringify(cols)} != frozen ${JSON.stringify(INSERT_COLS)}`);
      }
    }
  }

  // -- R11 idempotent, never overwriting ------------------------------------
  if (fnBody) {
    if (!/on\s+conflict\s*\(\s*id\s*\)\s*do\s+nothing/.test(fnBody)) {
      add("R11_idempotent_no_overwrite", "missing ON CONFLICT (id) DO NOTHING");
    }
    if (/on\s+conflict[\s\S]{0,40}?do\s+update/.test(fnBody)) {
      add("R11_idempotent_no_overwrite", "DO UPDATE would overwrite an established profile");
    }
    if (/\bupdate\s+public\.profiles\b/.test(fnBody)) {
      add("R11_idempotent_no_overwrite", "the function UPDATEs profiles");
    }
  }

  // -- R12 SECURITY DEFINER + pinned search_path ----------------------------
  if (fnDecl) {
    if (!/security\s+definer/.test(fnDecl)) {
      add("R12_secdef_searchpath", "the function is not SECURITY DEFINER (required: the auth service has no rights on profiles)");
    }
    if (!/set\s+search_path\s*=\s*[^;]*pg_catalog/.test(fnDecl)) {
      add("R12_secdef_searchpath", "search_path is not pinned with pg_catalog");
    }
  }
  if (fnBody && /execute\s+format|execute\s+'/.test(fnBody)) {
    add("R12_secdef_searchpath", "dynamic SQL inside a SECURITY DEFINER function");
  }

  // -- R13 EXECUTE posture: not a callable escalation API --------------------
  if (!new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${FN}\\s*\\(\\s*\\)\\s+from\\s+[^;]*public`).test(code)) {
    add("R13_execute_posture", "EXECUTE is not revoked from PUBLIC");
  }
  for (const role of ["anon", "authenticated"]) {
    if (!new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${FN}\\s*\\(\\s*\\)\\s+from\\s+[^;]*${role}`).test(code)) {
      add("R13_execute_posture", `EXECUTE is not revoked from ${role}`);
    }
  }
  if (!new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${FN}\\s*\\(\\s*\\)\\s+to\\s+service_role`).test(code)) {
    add("R13_execute_posture", "service_role EXECUTE is not preserved");
  }

  // -- R14 creates no privileged business state -----------------------------
  for (const tbl of ["vendors", "vendor_credit_logs", "lead_assignments", "assignment_operations",
                     "communication_intents", "client_accounts", "vendor_dashboard_users",
                     "credit_restoration_approvals", "replacement_requests"]) {
    if (new RegExp(`insert\\s+into\\s+public\\.${tbl}\\b`).test(stripped)
        || new RegExp(`update\\s+public\\.${tbl}\\b`).test(stripped)) {
      add("R14_no_privileged_state", `the migration writes public.${tbl}`);
    }
  }

  // -- R15 scope fence: no E / 20.4 / owner binding -------------------------
  if (/revoke[\s\S]{0,120}?on\s+function\s+public\.(assign_lead_to_vendors|admin_smart_assign_lead_to_vendors|assign_lead_to_paid_vendors_phase26a|assign_lead_to_preferred_vendor|assign_client_selected_vendor_to_group|assign_vendor_to_requirement_group)/.test(code)) {
    add("R15_scope_fence", "Migration E legacy-RPC EXECUTE revocation in D");
  }
  if (/alter\s+table\s+public\.leads\s+add\s+column\s+(client_account_id|user_id|created_by)\b/.test(code)) {
    add("R15_scope_fence", "owner-binding column added to leads");
  }
  if (/create\s+(or\s+replace\s+)?view\s+public\.vendor_public_v/.test(code)) {
    add("R15_scope_fence", "D redefines the Migration C projection");
  }

  // -- R16 no historical backfill of existing auth users --------------------
  if (/insert\s+into\s+public\.profiles[\s\S]{0,200}?\bselect\b[\s\S]{0,200}?auth\.users/.test(stripped)) {
    add("R16_no_backfill", "the migration backfills profiles from existing auth.users");
  }
  if (/\bfrom\s+auth\.users\b/.test(stripped) && !/pg_trigger|pg_class|pg_namespace/.test(stripped)) {
    add("R16_no_backfill", "the migration selects from auth.users outside catalog verification");
  }

  // -- R17 self-verification present and free of prior defect classes -------
  if (!/do\s+\$verify\$/.test(sql)) add("R17_self_verification", "no self-verification block");
  if (/pg_get_functiondef|prosrc\b|routine_definition/.test(bodies)) {
    add("R17_self_verification", "lexical assertion over comment-retaining catalog text");
  }
  for (const f of findNameArrayDefects(text)) add("R17_self_verification", f);
  for (const f of findAsymmetricArrayComparisons(text)) add("R17_self_verification", f);
  for (const marker of ["to_regprocedure", "pg_trigger", "tgtype"]) {
    if (!new RegExp(marker).test(bodies)) {
      add("R17_self_verification", `self-verification does not use the catalog fact ${marker}`);
    }
  }

  // -- R18 A/A2/B1/G/B2/C surfaces are not redefined -------------------------
  if (/create\s+or\s+replace\s+function\s+public\.qf_(assign_lead_vendors_v2|apply_credit_mutation_v2|enforce_lead_assignment_active_cap|enforce_lead_lifetime_vendor_cap|prevent_lead_assignment_event_mutation|prevent_lead_assignment_event_truncate)\b/.test(code)) {
    add("R18_prior_phases_untouched", "D redefines a B1/B2 function");
  }
  if (/create\s+trigger\s+trg_lead_assignment/.test(code)) {
    add("R18_prior_phases_untouched", "D creates a B2 enforcement trigger");
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
 * 2. The real D migration must have ZERO findings
 * ========================================================================= */
const dRaw = read(MIGRATION_D);
const dSha = sha256(dRaw);
const realFindings = evaluateDMigration(dRaw, "20260723000700");
record("02 real D migration has zero findings", realFindings.length === 0,
  realFindings.length === 0 ? "clean" : realFindings.map((f) => `${f.rule}: ${f.detail}`).join(" | "));

record("03 D migration path is the locked candidate identity",
  MIGRATION_D === "supabase/migrations/20260723000700_qf_mvp_auth_user_onboarding_trigger.sql", MIGRATION_D);

/* ===========================================================================
 * 3. One-defect mutation fixtures — each mutates the REAL migration once.
 * ========================================================================= */
const FIXTURES = [
  { id: "A", rule: "R01_no_transaction_control", why: "BEGIN/COMMIT wrapper",
    mutate: (s) => `begin;\n${s}\ncommit;\n` },
  { id: "B", rule: "R02_no_destructive", why: "drop table",
    mutate: (s) => `${s}\ndrop table public.profiles;\n` },
  { id: "C", rule: "R03_no_history_write", why: "history write",
    mutate: (s) => `${s}\ninsert into supabase_migrations.schema_migrations(version) values('20260723000700');\n` },
  { id: "D", rule: "R04_no_secrets_or_urls", why: "project ref in SQL",
    mutate: (s) => s.replace("create or replace function public.handle_new_user()",
      "comment on schema public is 'https://uckafzuochmbvtiodmcl.supabase.co';\ncreate or replace function public.handle_new_user()") },
  { id: "E", rule: "R05_no_broad_grants", why: "GRANT ALL",
    mutate: (s) => `${s}\ngrant all on table public.profiles to authenticated;\n` },
  { id: "F", rule: "R06_function_present", why: "function renamed away",
    mutate: (s) => s.replace("create or replace function public.handle_new_user()",
      "create or replace function public.some_other_onboarding()") },
  { id: "G", rule: "R07_trigger_present", why: "BEFORE INSERT instead of AFTER",
    mutate: (s) => s.replace("after insert on auth.users", "before insert on auth.users") },
  { id: "H", rule: "R07_trigger_present", why: "a second auth trigger",
    mutate: (s) => `${s}\ncreate trigger on_auth_user_created_extra after insert on auth.users for each row execute function public.handle_new_user();\n` },
  // THE critical regression: reintroduce the metadata-derived role.
  { id: "I", rule: "R08_role_is_trusted_constant", why: "role reverted to raw_user_meta_data (admin escalation)",
    mutate: (s) => s.replace("    'vendor'\n", "    coalesce(new.raw_user_meta_data ->> 'role', 'vendor')\n") },
  { id: "J", rule: "R09_metadata_allowlist", why: "a privileged metadata key is read",
    mutate: (s) => s.replace("new.raw_user_meta_data ->> 'phone',",
      "new.raw_user_meta_data ->> 'phone',\n    -- x\n    new.raw_user_meta_data ->> 'admin_role',") },
  { id: "K", rule: "R10_explicit_columns", why: "insert column list changed",
    mutate: (s) => s.replace("insert into public.profiles (id, full_name, phone, role)",
      "insert into public.profiles (id, full_name, phone, role, is_active)") },
  { id: "L", rule: "R11_idempotent_no_overwrite", why: "DO UPDATE overwrites an existing profile",
    mutate: (s) => s.replace("on conflict (id) do nothing", "on conflict (id) do update set role = excluded.role") },
  { id: "M", rule: "R12_secdef_searchpath", why: "SECURITY DEFINER removed",
    mutate: (s) => s.replace("language plpgsql\nsecurity definer\n", "language plpgsql\n") },
  { id: "N", rule: "R13_execute_posture", why: "anon EXECUTE not revoked",
    mutate: (s) => s.replace("revoke all on function public.handle_new_user() from public, anon, authenticated;",
      "revoke all on function public.handle_new_user() from public;") },
  { id: "O", rule: "R14_no_privileged_state", why: "creates vendor business state",
    mutate: (s) => `${s}\ninsert into public.vendors (id, business_name, phone, city) values (gen_random_uuid(), 'x', 'y', 'z');\n` },
  { id: "P", rule: "R15_scope_fence", why: "Migration E revocation smuggled in",
    mutate: (s) => `${s}\nrevoke execute on function public.assign_lead_to_vendors(uuid, uuid[], boolean, text) from service_role;\n` },
  { id: "Q", rule: "R16_no_backfill", why: "historical backfill of existing auth users",
    mutate: (s) => `${s}\ninsert into public.profiles (id, role) select u.id, 'vendor' from auth.users u on conflict do nothing;\n` },
  { id: "R", rule: "R17_self_verification", why: "functiondef regex reintroduced",
    mutate: (s) => s.replace("  -- 4.1 the onboarding function exists",
      "  if pg_get_functiondef(v_fn) !~ 'vendor' then raise exception 'x'; end if;\n  -- 4.1 the onboarding function exists") },
  { id: "S", rule: "R18_prior_phases_untouched", why: "redefines the canonical B1 authority",
    mutate: (s) => `${s}\ncreate or replace function public.qf_assign_lead_vendors_v2(p_lead_id uuid) returns jsonb language sql as $x$ select '{}'::jsonb $x$;\n` },
];

for (const fx of FIXTURES) {
  const mutated = fx.mutate(dRaw);
  const changed = mutated !== dRaw;
  const findings = changed ? evaluateDMigration(mutated, `fixture-${fx.id}`) : [];
  const tripped = findings.some((f) => f.rule === fx.rule);
  record(`04 fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "MUTATION WAS A NO-OP — the fixture is vacuous"
      : tripped ? `tripped (${findings.length} finding(s))`
      : `did NOT trip; findings: ${findings.map((f) => f.rule).join(",") || "none"}`);
}

record("05 every evaluator rule has at least one fixture", (() => {
  const covered = new Set(FIXTURES.map((f) => f.rule));
  const declared = [...new Set([...read("scripts/mvp/staging/validate-qf-mvp-20-3d.mjs")
    .matchAll(/add\("(R\d\d_[a-z0-9_]+)"/g)].map((m) => m[1]))].filter((r) => r !== "R00_parse");
  const missing = declared.filter((r) => !covered.has(r));
  return missing.length === 0 ? true : missing;
})() === true, "every enforced rule is exercised by a one-defect fixture");

/* ===========================================================================
 * 4. The SELECT-only staging verifier
 * ========================================================================= */
const verRaw = read(PHASE_VERIFIER_D);
const verSha = sha256(verRaw);
let verTokens;
try { verTokens = tokenize(verRaw, "verify_d"); record("06 verifier parses cleanly", true, "ok"); }
catch (e) { verTokens = { code: "", bodies: [] }; record("06 verifier parses cleanly", false, e.message); }
const verCode = norm(verTokens.code);
const verStripped = stripComments(verRaw, "verifier");

record("07 verifier performs no DML or DDL",
  !/(^|;)\s*(insert\s+into|update\s+|delete\s+from|create\s+|alter\s+|drop\s+|truncate|grant\s+|revoke\s+)/.test(verCode),
  "SELECT-only");
record("07b verifier never inserts a test auth user",
  !/insert\s+into\s+auth\.users/i.test(verStripped), "no auth user created by the verifier");
record("07c verifier is free of the prior array defect classes",
  findNameArrayDefects(verStripped).length === 0 && findAsymmetricArrayComparisons(verStripped).length === 0,
  "type-safe and symmetric");
record("08 verifier has no transaction control",
  !/(^|;|\s)(begin|commit|rollback|savepoint)\s*(;|$)/.test(verCode), "clean");
record("09 verifier has no secrets/URLs",
  !/https?:\/\/|supabase\.co|postgres(ql)?:\/\//i.test(norm(verStripped)), "clean");

const verRows = [...verRaw.matchAll(/^select\s+(\d+)\s*(?:as\s+seq)?\s*,/gim)].map((m) => Number(m[1]));
record("10 verifier rows are sequential and unique",
  verRows.length > 0 && new Set(verRows).size === verRows.length && verRows.every((v, i) => v === i + 1),
  `${verRows.length} rows`);

for (const marker of ["20260723000700", FN, TRG, "auth", "users", "tgtype",
  "qf_assign_lead_vendors_v2", "vendor_public_v", "trg_lead_assignment_events_immutable"]) {
  record(`11 verifier asserts on ${marker}`, verRaw.includes(marker), "present");
}
record("12 verifier makes no lexical assertion over function source",
  !/pg_get_functiondef|prosrc\b|routine_definition/.test(norm(verStripped)), "clean");

/* ===========================================================================
 * 5. Repository onboarding posture (runtime compatibility)
 * ========================================================================= */
const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", ".vercel", "out"]);
const EXT = /\.(ts|tsx|mjs|js|jsx)$/;
function walk(dir, acc = []) {
  let entries; try { entries = readdirSync(path.join(ROOT, dir)); } catch { return acc; }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const rel = path.join(dir, e);
    let st; try { st = statSync(path.join(ROOT, rel)); } catch { continue; }
    if (st.isDirectory()) walk(rel, acc);
    else if (EXT.test(e)) acc.push(rel.split(path.sep).join("/"));
  }
  return acc;
}
const runtimeFiles = ["app", "services", "lib", "components"].flatMap((d) => walk(d));
const stripTs = (src) => {
  let out = "", i = 0; const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);
    if (two === "//") { const nl = src.indexOf("\n", i); i = nl === -1 ? n : nl; continue; }
    if (two === "/*") { const e = src.indexOf("*/", i + 2); i = e === -1 ? n : e + 2; continue; }
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) { if (src[j] === "\\") { j += 2; continue; } if (src[j] === c) { j++; break; } j++; }
      out += src.slice(i, j); i = j; continue;
    }
    out += c; i++;
  }
  return out;
};

// The trigger is the SOLE writer of profiles on the signup path: no runtime
// module may insert/upsert it, or it would race the trigger.
const profileWriters = runtimeFiles.filter((f) => {
  const c = stripTs(read(f));
  return /from\(\s*["'`]profiles["'`]\s*\)[\s\S]{0,80}?\.(insert|upsert)/.test(c);
});
record("13 no runtime module inserts/upserts profiles (no race with the trigger)",
  profileWriters.length === 0, `writers: ${JSON.stringify(profileWriters)}`);

// No runtime module may send a privileged role in signup metadata.
const metaRoleSenders = runtimeFiles.filter((f) => {
  const c = stripTs(read(f));
  return /user_metadata\s*:\s*\{[^}]*role\s*:\s*["'`]admin["'`]/.test(c);
});
record("14 no runtime module requests an admin role via signup metadata",
  metaRoleSenders.length === 0, `senders: ${JSON.stringify(metaRoleSenders)}`);

// No "use client" module may hold the service-role client/key.
const clientComponents = runtimeFiles.filter((f) => /^\s*["'`]use client["'`]/m.test(read(f)));
const leaking = clientComponents.filter((f) => {
  const c = stripTs(read(f));
  return /\badminClient\b/.test(c) || /SUPABASE_SERVICE_ROLE_KEY/.test(c);
});
record("15 no \"use client\" module holds the service-role client or key",
  leaking.length === 0, `leaking: ${JSON.stringify(leaking)}`);

/* ===========================================================================
 * Report
 * ========================================================================= */
const passed = results.filter((r) => r.ok).length;
console.log("== QF-MVP-20.3D offline migration validator ==");
console.log(`D migration : ${MIGRATION_D}`);
console.log(`D SHA-256   : ${dSha}`);
console.log(`verifier    : ${PHASE_VERIFIER_D}`);
console.log(`verifier SHA: ${verSha}`);
console.log("");
for (const r of results) {
  console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`);
  if (!r.ok) console.log(`         ${r.detail}`);
}
console.log("");
console.log(`checks: ${passed} passed, ${results.length - passed} failed (of ${results.length})`);
console.log(`fixtures: ${FIXTURES.length} one-defect mutations, all derived from the real migration`);
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
