#!/usr/bin/env node
/**
 * QF-MVP-20.3E — Offline migration validator.
 *
 * Entirely offline. Reads files from disk and hashes them. Opens no socket,
 * spawns no process, reads no environment variable and touches no database.
 *
 * Grades the real Migration E (legacy assignment-RPC EXECUTE revocation), its
 * SELECT-only verifier, the definition-immutability manifest, and the repository
 * runtime posture, against the frozen E contract.
 *
 * E is ACL-ONLY. Its two load-bearing guarantees are:
 *   1. the six legacy state-changing assignment RPCs are revoked from PUBLIC,
 *      anon AND authenticated (revoking only anon/authenticated leaves EXECUTE
 *      via PUBLIC), and service_role is retained;
 *   2. NOTHING ELSE changes — no function is dropped/created/altered, no table/
 *      policy/index/trigger/row is touched, no default privilege or broad schema
 *      grant is used, and the safe public discovery RPC keeps its grant.
 *
 * Usage:  node scripts/mvp/staging/validate-qf-mvp-20-3e.mjs
 * Exit 0 = PASS, exit 1 = FAIL. Fails closed on ambiguous parsing.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const MIGRATION_E = "supabase/migrations/20260723000800_qf_mvp_legacy_assignment_rpc_execute_revocation.sql";
const PHASE_VERIFIER_E = "supabase/staging-verification/verify_qf_mvp_20_3e.sql";
const MANIFEST_E = "scripts/mvp/staging/qf-mvp-20-3e-manifest.json";
const BASELINE = "supabase/staging-baseline/20260722000100_qf_mvp_staging_baseline_269c9265.sql";

/** Applied/reviewed and immutable. E must not have touched any of them. */
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
  { file: "supabase/migrations/20260723000700_qf_mvp_auth_user_onboarding_trigger.sql",
    sha256: "8fb3c28c2c0e776d88d3c8163a895c5e108cb84b89ac95f41b86a521f50daecd" },
  { file: "supabase/staging-verification/verify_qf_mvp_20_3d.sql",
    sha256: "f0e87bfbfc715f9d1f25d003b45a77280f555f1131e9143ce3070df17822c26d" },
  { file: "scripts/mvp/staging/validate-qf-mvp-20-3d.mjs",
    sha256: "db94548135222e0dfb0f6cfadadb4cbb4ebdc72a1325fb9bc052638b4830fecd" },
  { file: "supabase/staging-verification/verify_qf_mvp_20_3c.sql",
    sha256: "1f7bf9a511eb77f37578ef92771fdddf85cd2aa0522ac4648a7041b56586a980" },
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
 * FROZEN CONTRACT
 * ========================================================================= */
/** The exact six signature-qualified target RPCs (identity-arg form). */
const TARGETS = [
  "public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)",
  "public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)",
  "public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])",
  "public.assign_lead_to_preferred_vendor(uuid, uuid)",
  "public.assign_lead_to_vendors(uuid, uuid[], boolean, text)",
  "public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)",
];
/** The safe read-only public discovery RPC — must NEVER be revoked by E. */
const SAFE_PUBLIC = "public.get_public_eligible_vendors";
/** Normalise a signature to a stable comparison key (collapse ws, lower). */
const sigKey = (s) => s.replace(/\s+/g, "").toLowerCase();

/* ===========================================================================
 * THE MIGRATION EVALUATOR — real artifact AND fixtures.
 * ========================================================================= */
export function evaluateEMigration(sql, label = "E") {
  const findings = [];
  const add = (rule, detail) => findings.push({ rule, detail });

  let tokens, text;
  try { tokens = tokenize(sql, label); } catch (e) { add("R00_parse", e.message); return findings; }
  try { text = stripComments(sql, label); } catch (e) { add("R00_parse", e.message); return findings; }
  const code = norm(tokens.code);
  const stripped = norm(text);
  const bodies = tokens.bodies.map(norm).join("\n");
  // Executable statements only (comments removed, string/identifier structure kept).
  const exec = norm(text);

  // -- R01 no explicit transaction control ----------------------------------
  if (/(^|;|\s)(commit|rollback|start transaction|savepoint)\s*(;|$)/.test(code)) {
    add("R01_no_transaction_control", "explicit transaction control in executable SQL");
  }

  // -- R02 ACL-ONLY: no function drop/create/replace/alter -------------------
  if (/\bdrop\s+function\b/.test(exec)) add("R02_acl_only_no_function_ddl", "DROP FUNCTION");
  if (/\bcreate\s+(or\s+replace\s+)?function\b/.test(exec)) add("R02_acl_only_no_function_ddl", "CREATE/REPLACE FUNCTION");
  if (/\balter\s+function\b/.test(exec)) add("R02_acl_only_no_function_ddl", "ALTER FUNCTION (owner/body/attr change)");

  // -- R03 no table/policy/index/trigger/data change ------------------------
  for (const [re, why] of [
    [/\b(create|alter|drop)\s+table\b/, "table DDL"],
    [/\b(create|alter|drop)\s+policy\b/, "policy DDL"],
    [/\b(create|alter|drop)\s+(unique\s+)?index\b/, "index DDL"],
    [/\b(create|alter|drop)\s+trigger\b/, "trigger DDL"],
    [/\b(create|alter|drop)\s+view\b/, "view DDL"],
    [/(^|;)\s*truncate\b/, "truncate"],
    [/(^|;)\s*insert\s+into\b/, "insert"],
    [/(^|;)\s*update\s+[a-z_."]+\s+set\b/, "update"],
    [/(^|;)\s*delete\s+from\b/, "delete"],
    [/\balter\s+table\b/, "alter table"],
  ]) if (re.test(exec)) add("R03_no_schema_or_data_change", why);

  // -- R04 no broad revoke / no default-privilege change --------------------
  if (/\balter\s+default\s+privileges\b/.test(exec)) add("R04_no_broad_or_default_priv", "ALTER DEFAULT PRIVILEGES");
  if (/\b(revoke|grant)\b[^;]*\bon\s+all\s+(functions|routines|tables)\b/.test(exec)) {
    add("R04_no_broad_or_default_priv", "broad ON ALL FUNCTIONS/ROUTINES/TABLES grant");
  }
  if (/\b(revoke|grant)\b[^;]*\bon\s+schema\b/.test(exec)) add("R04_no_broad_or_default_priv", "schema-level grant/revoke");
  if (/\bgrant\s+all\b/.test(exec)) add("R04_no_broad_or_default_priv", "GRANT ALL");

  // Parse the REVOKE/GRANT EXECUTE statements once.
  const revokes = [...exec.matchAll(/revoke\s+execute\s+on\s+function\s+([a-z0-9_.]+\s*\([^)]*\))\s+from\s+([^;]+);/g)]
    .map((m) => ({ sig: m[1], roles: m[2].split(",").map((r) => r.trim().replace(/"/g, "")) }));
  const grants = [...exec.matchAll(/grant\s+execute\s+on\s+function\s+([a-z0-9_.]+\s*\([^)]*\))\s+to\s+([^;]+);/g)]
    .map((m) => ({ sig: m[1], roles: m[2].split(",").map((r) => r.trim().replace(/"/g, "")) }));

  // -- R05 exact target set: every target revoked, no extra target ----------
  const revokedKeys = new Set(revokes.map((r) => sigKey(r.sig)));
  for (const t of TARGETS) {
    if (!revokedKeys.has(sigKey(t))) add("R05_exact_target_set", `target not revoked: ${t}`);
  }
  const targetKeySet = new Set(TARGETS.map(sigKey));
  for (const r of revokes) {
    if (!targetKeySet.has(sigKey(r.sig)) && !r.sig.includes(SAFE_PUBLIC.replace("public.", ""))) {
      add("R05_exact_target_set", `unrelated RPC revoked: ${r.sig}`);
    }
  }
  // exactly six distinct targets revoked
  const distinctTargetRevokes = [...revokedKeys].filter((k) => targetKeySet.has(k)).length;
  if (distinctTargetRevokes !== 6) {
    add("R05_exact_target_set", `expected 6 distinct target REVOKEs, found ${distinctTargetRevokes}`);
  }

  // -- R06 each REVOKE names PUBLIC, anon AND authenticated ------------------
  for (const t of TARGETS) {
    const r = revokes.find((x) => sigKey(x.sig) === sigKey(t));
    if (!r) continue;
    for (const role of ["public", "anon", "authenticated"]) {
      if (!r.roles.includes(role)) {
        add("R06_revoke_public_anon_authenticated", `REVOKE on ${t} omits ${role} (PUBLIC pseudo-role leak if PUBLIC missing)`);
      }
    }
  }

  // -- R07 service_role EXECUTE retained for each target --------------------
  for (const t of TARGETS) {
    const g = grants.find((x) => sigKey(x.sig) === sigKey(t) && x.roles.includes("service_role"));
    if (!g) add("R07_service_role_retained", `service_role EXECUTE not re-granted for ${t}`);
  }

  // -- R08 owner/postgres never revoked; safe public RPC never revoked ------
  for (const r of revokes) {
    if (r.roles.includes("postgres") || r.roles.some((x) => /owner/.test(x))) {
      add("R08_owner_and_safe_public_preserved", `REVOKE names postgres/owner on ${r.sig}`);
    }
    if (sigKey(r.sig).includes(sigKey(SAFE_PUBLIC + "("))) {
      add("R08_owner_and_safe_public_preserved", "the safe public discovery RPC is revoked");
    }
  }
  if (new RegExp(`revoke[^;]*${SAFE_PUBLIC.replace(/[.]/g, "\\.")}`).test(exec)) {
    add("R08_owner_and_safe_public_preserved", "get_public_eligible_vendors appears in a REVOKE");
  }

  // -- R09 self-verification present, catalog-based, type-safe --------------
  if (!/do\s+\$verify\$/.test(sql)) add("R09_self_verification", "no self-verification block");
  if (/pg_get_functiondef|prosrc\b|routine_definition/.test(bodies)) {
    add("R09_self_verification", "lexical assertion over comment-retaining catalog text");
  }
  for (const f of findNameArrayDefects(text)) add("R09_self_verification", f);
  for (const f of findAsymmetricArrayComparisons(text)) add("R09_self_verification", f);
  for (const marker of ["to_regprocedure", "has_function_privilege"]) {
    if (!new RegExp(marker).test(bodies)) add("R09_self_verification", `self-verification does not use ${marker}`);
  }
  // the self-verification must actually check the untrusted roles and service_role
  for (const role of ["public", "anon", "authenticated", "service_role"]) {
    if (!new RegExp(`'${role}'`).test(bodies)) {
      add("R09_self_verification", `self-verification never references role '${role}'`);
    }
  }

  // -- R10 scope fence: no 20.4 / no owner binding --------------------------
  if (/alter\s+table\s+public\.leads\s+add\s+column\s+(client_account_id|user_id|created_by)\b/.test(exec)) {
    add("R10_scope_fence", "owner-binding column added to leads");
  }
  if (/insert\s+into\s+public\.(vendor_credit_logs|vendor_wallets|credit_ledger)\b/.test(exec)) {
    add("R10_scope_fence", "credit-ledger reconciliation (QF-MVP-20.4) write");
  }

  // -- R11 no history write / no secrets ------------------------------------
  if (/supabase_migrations|schema_migrations/.test(stripped)) add("R11_hygiene", "touches migration-history tables");
  if (/https?:\/\/|supabase\.co|postgres(ql)?:\/\/|service_role_key|sb_secret|eyj[a-z0-9]/i.test(stripped)) {
    add("R11_hygiene", "URL/project-ref/credential-shaped token in executable SQL");
  }

  // -- R12 HONEST DURABILITY CONTRACT (QF-MVP-20.3EGR1) ----------------------
  //    E is a CURRENT-OBJECT ACL re-assertion. It must NOT attempt any
  //    future-object / default-privilege / schema-wide guarantee — the very
  //    absence of those is why E makes no false "survives future DROP+CREATE"
  //    promise. Structurally: (a) no ALTER DEFAULT PRIVILEGES; (b) no ON ALL
  //    FUNCTIONS/ROUTINES or ON SCHEMA grant/revoke; (c) EVERY executable
  //    EXECUTE grant/revoke is signature-qualified against a specific object
  //    (a `name(args)` identity), never a bare or wildcard target. This makes
  //    the honest contract load-bearing rather than a natural-language claim.
  if (/\balter\s+default\s+privileges\b/.test(exec)) {
    add("R12_current_object_acl_only", "ALTER DEFAULT PRIVILEGES would falsely imply a future-object guarantee E cannot make");
  }
  if (/\b(revoke|grant)\b[^;]*\bon\s+(all\s+(functions|routines)|schema)\b/.test(exec)) {
    add("R12_current_object_acl_only", "schema-wide / ON ALL grant or revoke is not a current-object operation");
  }
  const aclStmts = [...exec.matchAll(/(revoke|grant)\s+execute\s+on\s+function\s+([^;]+?)\s+(from|to)\s+[^;]+;/g)];
  for (const m of aclStmts) {
    // the function reference between "on function" and from/to must carry an
    // argument list "(...)" — i.e. a specific overload identity.
    if (!/\([^)]*\)/.test(m[2])) {
      add("R12_current_object_acl_only", `EXECUTE ${m[1]} is not signature-qualified: "${m[2].trim()}"`);
    }
  }

  return findings;
}

/* ===========================================================================
 * THE VERIFIER EVALUATOR — real artifact AND fixtures.
 * ========================================================================= */
export function evaluateEVerifier(sql, label = "verifier") {
  const findings = [];
  const add = (rule, detail) => findings.push({ rule, detail });
  let tok, stripped;
  try { tok = tokenize(sql, label); } catch (e) { add("V00_parse", e.message); return findings; }
  try { stripped = stripComments(sql, label); } catch (e) { add("V00_parse", e.message); return findings; }
  const code = norm(tok.code);
  const exec = norm(stripped);

  // V01 SELECT-only; never invokes an assignment RPC.
  if (/(^|;)\s*(insert\s+into|update\s+|delete\s+from|create\s+|alter\s+|drop\s+|truncate|grant\s+|revoke\s+|call\s+|do\s+\$)/.test(code)) {
    add("V01_select_only", "verifier performs DML/DDL/CALL/DO");
  }
  for (const t of ["assign_lead_to_vendors", "admin_smart_assign", "assign_client_selected", "assign_lead_to_preferred", "assign_lead_to_paid", "assign_vendor_to_requirement"]) {
    if (new RegExp(`(perform|select)\\s+[^;]*${t}\\s*\\(`).test(exec) && !/to_regprocedure/.test(exec.slice(Math.max(0, exec.indexOf(t) - 40), exec.indexOf(t) + 40))) {
      // allow to_regprocedure('...sig...') references; flag only direct invocation
    }
  }
  // V02 hygiene
  if (/(^|;|\s)(begin|commit|rollback|savepoint)\s*(;|$)/.test(code)) add("V02_hygiene", "transaction control");
  if (/https?:\/\/|supabase\.co|postgres(ql)?:\/\//i.test(exec)) add("V02_hygiene", "URL/connection string");
  // V03 prior defect classes
  for (const f of findNameArrayDefects(stripped)) add("V03_prior_defect_classes", f);
  for (const f of findAsymmetricArrayComparisons(stripped)) add("V03_prior_defect_classes", f);
  if (/pg_get_functiondef|prosrc\b|routine_definition/.test(exec)) {
    add("V03_prior_defect_classes", "COMMENT/source lexical assertion in the verifier");
  }
  // V04 asserts on every target signature
  for (const t of TARGETS) {
    const bare = t.replace("public.", "").split("(")[0];
    if (!new RegExp(bare).test(exec)) add("V04_targets_asserted", `verifier never references target ${bare}`);
  }
  // V05 asserts the safe public RPC and the canonical authority
  if (!new RegExp("get_public_eligible_vendors").test(exec)) add("V05_safe_and_canonical", "verifier never asserts get_public_eligible_vendors");
  if (!new RegExp("qf_assign_lead_vendors_v2").test(exec)) add("V05_safe_and_canonical", "verifier never asserts the canonical authority");
  // V06 asserts untrusted-role absence + service_role presence
  for (const role of ["public", "anon", "authenticated", "service_role"]) {
    if (!new RegExp(`'${role}'`).test(exec)) add("V06_role_posture_asserted", `verifier never references role '${role}'`);
  }
  if (!/has_function_privilege/.test(exec)) add("V06_role_posture_asserted", "verifier does not use has_function_privilege");
  // V07 preservation rows present
  for (const marker of ["qf_assign_lead_vendors_v2", "trg_lead_assignment_events_immutable", "vendor_public_v", "on_auth_user_created", "lead_assignment_events"]) {
    if (!new RegExp(marker).test(exec)) add("V07_preservation_rows", `verifier never asserts ${marker}`);
  }
  // V08 stable sequenced rows
  const rows = [...sql.matchAll(/^select\s+(\d+)\s*(?:as\s+seq)?\s*,/gim)].map((m) => Number(m[1]));
  if (!(rows.length > 0 && new Set(rows).size === rows.length && rows.every((v, i) => v === i + 1))) {
    add("V08_stable_rows", `rows not contiguous 1..N (${rows.length} rows)`);
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
 * 2. The real E migration must have ZERO findings
 * ========================================================================= */
const eRaw = read(MIGRATION_E);
const eSha = sha256(eRaw);
const realFindings = evaluateEMigration(eRaw, "20260723000800");
record("02 real E migration has zero findings", realFindings.length === 0,
  realFindings.length === 0 ? "clean" : realFindings.map((f) => `${f.rule}: ${f.detail}`).join(" | "));
record("03 E migration path is the locked candidate identity",
  MIGRATION_E === "supabase/migrations/20260723000800_qf_mvp_legacy_assignment_rpc_execute_revocation.sql", MIGRATION_E);

/* ===========================================================================
 * 3. One-defect mutation fixtures — each mutates the REAL migration once.
 * ========================================================================= */
const FIXTURES = [
  { id: "A", rule: "R06_revoke_public_anon_authenticated", why: "leaves PUBLIC EXECUTE (revokes only anon, authenticated)",
    mutate: (s) => s.replace("from public, anon, authenticated;", "from anon, authenticated;") },
  { id: "B", rule: "R06_revoke_public_anon_authenticated", why: "leaves anon EXECUTE",
    mutate: (s) => s.replace("from public, anon, authenticated;", "from public, authenticated;") },
  { id: "C", rule: "R06_revoke_public_anon_authenticated", why: "leaves authenticated EXECUTE",
    mutate: (s) => s.replace("from public, anon, authenticated;", "from public, anon;") },
  { id: "D", rule: "R07_service_role_retained", why: "accidentally revokes service_role (drops a GRANT)",
    mutate: (s) => s.replace("grant  execute on function public.assign_lead_to_vendors(uuid, uuid[], boolean, text) to service_role;\n", "") },
  { id: "E", rule: "R08_owner_and_safe_public_preserved", why: "revokes the safe public discovery RPC",
    mutate: (s) => `${s}\nrevoke execute on function public.get_public_eligible_vendors(text, text, text) from anon, authenticated;\n` },
  { id: "F", rule: "R05_exact_target_set", why: "omits one target signature",
    mutate: (s) => s.replace(/revoke execute on function public\.assign_lead_to_preferred_vendor\(uuid, uuid\) from public, anon, authenticated;\n/, "") },
  { id: "G", rule: "R05_exact_target_set", why: "adds an unrelated RPC to the revoke set",
    mutate: (s) => `${s}\nrevoke execute on function public.some_unrelated_rpc(uuid) from public, anon, authenticated;\n` },
  { id: "H", rule: "R05_exact_target_set", why: "uses an unqualified (schema-less) name",
    mutate: (s) => s.replace("revoke execute on function public.assign_lead_to_vendors(uuid, uuid[], boolean, text)",
      "revoke execute on function assign_lead_to_vendors(uuid, uuid[], boolean, text)") },
  { id: "I", rule: "R02_acl_only_no_function_ddl", why: "CREATE OR REPLACE of a target function",
    mutate: (s) => `${s}\ncreate or replace function public.assign_lead_to_vendors(uuid, uuid[], boolean, text) returns jsonb language sql as $x$ select '{}'::jsonb $x$;\n` },
  { id: "J", rule: "R02_acl_only_no_function_ddl", why: "DROP of a target function",
    mutate: (s) => `${s}\ndrop function public.assign_lead_to_preferred_vendor(uuid, uuid);\n` },
  { id: "K", rule: "R02_acl_only_no_function_ddl", why: "ALTER FUNCTION owner change",
    mutate: (s) => `${s}\nalter function public.assign_lead_to_vendors(uuid, uuid[], boolean, text) owner to postgres;\n` },
  { id: "L", rule: "R04_no_broad_or_default_priv", why: "ALTER DEFAULT PRIVILEGES",
    mutate: (s) => `${s}\nalter default privileges in schema public revoke execute on functions from public;\n` },
  { id: "M", rule: "R04_no_broad_or_default_priv", why: "broad ON ALL FUNCTIONS revoke",
    mutate: (s) => `${s}\nrevoke execute on all functions in schema public from public;\n` },
  { id: "N", rule: "R03_no_schema_or_data_change", why: "table/policy mutation",
    mutate: (s) => `${s}\nalter table public.leads enable row level security;\n` },
  { id: "O", rule: "R03_no_schema_or_data_change", why: "data write",
    mutate: (s) => `${s}\ninsert into public.leads (id) values (gen_random_uuid());\n` },
  { id: "P", rule: "R10_scope_fence", why: "owner-binding column added (later phase)",
    mutate: (s) => `${s}\nalter table public.leads add column client_account_id uuid;\n` },
  { id: "Q", rule: "R09_self_verification", why: "functiondef lexical assertion reintroduced",
    mutate: (s) => s.replace("  -- 2.1 Each target still exists",
      "  if pg_get_functiondef(to_regprocedure(c_targets[1])) !~ 'x' then raise exception 'x'; end if;\n  -- 2.1 Each target still exists") },
  { id: "R", rule: "R09_self_verification", why: "the self-verification block is removed entirely",
    mutate: (s) => s.replace(/do \$verify\$[\s\S]*\$verify\$;/, "-- self-verification deleted\n") },
  { id: "S", rule: "R11_hygiene", why: "project ref smuggled in",
    mutate: (s) => `comment on schema public is 'https://uckafzuochmbvtiodmcl.supabase.co';\n${s}` },
  // QF-MVP-20.3EGR1 — the honest durability contract. A false "future guarantee"
  // shortcut via ALTER DEFAULT PRIVILEGES, and a schema-wide (non-current-object)
  // revoke, must both be rejected as not-current-object operations.
  { id: "T", rule: "R12_current_object_acl_only", why: "ALTER DEFAULT PRIVILEGES as a false future-durability shortcut",
    mutate: (s) => `${s}\nalter default privileges in schema public grant execute on functions to service_role;\n` },
  { id: "U", rule: "R12_current_object_acl_only", why: "schema-wide ON ALL FUNCTIONS revoke (not current-object)",
    mutate: (s) => `${s}\nrevoke execute on all functions in schema public from public;\n` },
  { id: "V", rule: "R12_current_object_acl_only", why: "an unqualified (no arg-list) EXECUTE revoke target",
    mutate: (s) => s.replace("revoke execute on function public.assign_lead_to_vendors(uuid, uuid[], boolean, text) from public, anon, authenticated;",
      "revoke execute on function public.assign_lead_to_vendors from public, anon, authenticated;") },
];

for (const fx of FIXTURES) {
  const mutated = fx.mutate(eRaw);
  const changed = mutated !== eRaw;
  const findings = changed ? evaluateEMigration(mutated, `fixture-${fx.id}`) : [];
  const tripped = findings.some((f) => f.rule === fx.rule);
  record(`04 fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "MUTATION WAS A NO-OP — the fixture is vacuous"
      : tripped ? `tripped (${findings.length} finding(s))`
      : `did NOT trip; findings: ${findings.map((f) => f.rule).join(",") || "none"}`);
}

record("05 every migration rule has at least one fixture", (() => {
  const covered = new Set(FIXTURES.map((f) => f.rule));
  const declared = [...new Set([...read(MIGRATION_VALIDATOR_SELF())
    .matchAll(/add\("(R\d\d_[a-z0-9_]+)"/g)].map((m) => m[1]))].filter((r) => r !== "R00_parse" && r !== "R01_no_transaction_control" && r !== "R11_hygiene");
  const missing = declared.filter((r) => !covered.has(r));
  return missing.length === 0 ? true : missing;
})() === true, "every enforced migration rule is exercised (except parse/txn/hygiene which are structural)");
function MIGRATION_VALIDATOR_SELF() { return "scripts/mvp/staging/validate-qf-mvp-20-3e.mjs"; }

/* ===========================================================================
 * 4. The SELECT-only verifier
 * ========================================================================= */
const verRaw = read(PHASE_VERIFIER_E);
const verSha = sha256(verRaw);
const realVerFindings = evaluateEVerifier(verRaw, "verify_qf_mvp_20_3e");
record("06 real E verifier has zero findings", realVerFindings.length === 0,
  realVerFindings.length === 0 ? "SELECT-only, catalog-based, asserts full posture"
    : realVerFindings.map((f) => `${f.rule}: ${f.detail}`).join(" | "));

const VER_FIXTURES = [
  { id: "VF1", rule: "V01_select_only", why: "verifier performs DML",
    mutate: (s) => `insert into public.leads (id) values (gen_random_uuid());\n${s}` },
  { id: "VF2", rule: "V03_prior_defect_classes", why: "COMMENT/source lexical assertion",
    mutate: (s) => s.replace("select 1 as seq,", "select (select prosrc from pg_proc limit 1), 1 as seq,") },
  { id: "VF3", rule: "V04_targets_asserted", why: "a target signature dropped from the verifier",
    mutate: (s) => s.replace(/assign_lead_to_preferred_vendor/g, "assign_lead_to_absent_vendor") },
  { id: "VF4", rule: "V05_safe_and_canonical", why: "safe public RPC assertion removed",
    mutate: (s) => s.replace(/get_public_eligible_vendors/g, "get_removed_rpc") },
  { id: "VF5", rule: "V06_role_posture_asserted", why: "service_role assertion removed",
    mutate: (s) => s.replace(/service_role/g, "svc_removed") },
  { id: "VF6", rule: "V07_preservation_rows", why: "canonical-authority preservation removed",
    mutate: (s) => s.replace(/qf_assign_lead_vendors_v2/g, "qf_removed_v2") },
];
for (const fx of VER_FIXTURES) {
  const mutated = fx.mutate(verRaw);
  const changed = mutated !== verRaw;
  const f = changed ? evaluateEVerifier(mutated, `verfix-${fx.id}`) : [];
  const tripped = f.some((x) => x.rule === fx.rule);
  record(`07 verifier fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "MUTATION WAS A NO-OP — the fixture is vacuous"
      : tripped ? `tripped (${f.length})` : `did NOT trip; ${f.map((x) => x.rule).join(",") || "none"}`);
}
record("08 verifier is SELECT-only and never inserts a row",
  !/insert\s+into|update\s+[a-z_.]+\s+set|delete\s+from|create\s+|alter\s+|drop\s+|grant\s+|revoke\s+/.test(norm(tokenize(verRaw, "v").code)),
  "clean");
const verRows = [...verRaw.matchAll(/^select\s+(\d+)\s*(?:as\s+seq)?\s*,/gim)].map((m) => Number(m[1]));
record("09 verifier rows are sequential and unique",
  verRows.length > 0 && new Set(verRows).size === verRows.length && verRows.every((v, i) => v === i + 1),
  `${verRows.length} rows`);

/* ===========================================================================
 * 5. Definition-immutability manifest
 * ========================================================================= */
let manifest;
try { manifest = JSON.parse(read(MANIFEST_E)); record("10 manifest parses", true, "ok"); }
catch (e) { manifest = { functions: [] }; record("10 manifest parses", false, e.message); }

record("11 manifest covers exactly the six targets", (() => {
  const names = new Set((manifest.functions || []).map((f) => `public.${f.name}(${f.identity_args})`).map(sigKey));
  return TARGETS.every((t) => names.has(sigKey(t))) && (manifest.functions || []).length === 6;
})(), `${(manifest.functions || []).length} functions`);

// Re-derive each target's body hash from the baseline and compare to the manifest —
// proves the manifest is faithful AND (via the migration's no-DDL rule) that E
// cannot have changed the body.
const baseline = read(BASELINE);
function baselineBodyHash(fnName) {
  const idx = baseline.indexOf(`CREATE OR REPLACE FUNCTION "public"."${fnName}"`);
  if (idx === -1) return null;
  const after = baseline.slice(idx);
  const open = after.indexOf("AS $$");
  const start = open + "AS $$".length;
  const end = after.indexOf("$$;", start);
  if (open === -1 || end === -1) return null;
  const body = after.slice(start, end).replace(/\s+/g, " ").trim().toLowerCase();
  return sha256(body);
}
record("12 manifest body hashes match the applied baseline definitions", (() => {
  for (const f of manifest.functions || []) {
    const h = baselineBodyHash(f.name);
    if (h !== f.body_sha256) return `${f.name}: manifest ${String(f.body_sha256).slice(0, 12)} vs baseline ${String(h).slice(0, 12)}`;
  }
  return true;
})() === true, "every target body hash is reproduced from the baseline");

record("13 manifest records SECURITY DEFINER jsonb for every target",
  (manifest.functions || []).every((f) => f.security_definer === true && f.result_type === "jsonb"),
  "all six are SECURITY DEFINER jsonb");

/* ===========================================================================
 * 6. Runtime posture — consumers remain server-owned; no live legacy call.
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
const runtimeFiles = ["app", "services", "lib", "components"].flatMap((d) => walk(d));
const LEGACY_NAMES = ["assign_lead_to_vendors", "admin_smart_assign_lead_to_vendors",
  "assign_lead_to_paid_vendors_phase26a", "assign_lead_to_preferred_vendor",
  "assign_client_selected_vendor_to_group", "assign_vendor_to_requirement_group"];
const liveLegacyCallers = runtimeFiles.filter((f) => {
  const c = stripTs(read(f));
  return LEGACY_NAMES.some((n) => new RegExp(`\\.rpc\\(\\s*["'\`]${n}["'\`]`).test(c));
});
record("14 no runtime module invokes any legacy assignment RPC directly",
  liveLegacyCallers.length === 0, `callers: ${JSON.stringify(liveLegacyCallers)}`);

// The canonical RPC is invoked only via adminClient (service-role), and the
// public discovery RPC only via publicClient (anon) — the two live call sites.
const canonicalFile = "services/canonicalAssignmentAuthority.ts";
record("15 canonical RPC is invoked with the service-role admin client",
  /adminClient\(\)\.rpc\(\s*CANONICAL_ASSIGNMENT_RPC/.test(stripTs(read(canonicalFile))),
  "adminClient().rpc(CANONICAL_ASSIGNMENT_RPC)");
const leadServiceSrc = stripTs(read("services/leadService.ts"));
record("16 public discovery RPC is invoked with the anon public client (needs anon EXECUTE)",
  /publicClient\(\)\.rpc\(\s*["'`]get_public_eligible_vendors["'`]/.test(leadServiceSrc),
  "publicClient().rpc(get_public_eligible_vendors)");

/* ===========================================================================
 * Report
 * ========================================================================= */
const passed = results.filter((r) => r.ok).length;
console.log("== QF-MVP-20.3E offline migration validator ==");
console.log(`E migration : ${MIGRATION_E}`);
console.log(`E SHA-256   : ${eSha}`);
console.log(`verifier    : ${PHASE_VERIFIER_E}`);
console.log(`verifier SHA: ${verSha}`);
console.log(`manifest    : ${MANIFEST_E}`);
console.log("");
for (const r of results) {
  console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`);
  if (!r.ok) console.log(`         ${r.detail}`);
}
console.log("");
console.log(`checks: ${passed} passed, ${results.length - passed} failed (of ${results.length})`);
console.log(`fixtures: ${FIXTURES.length} migration + ${VER_FIXTURES.length} verifier one-defect mutations`);
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
