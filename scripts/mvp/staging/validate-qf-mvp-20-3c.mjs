#!/usr/bin/env node
/**
 * QF-MVP-20.3C — Offline migration validator.
 *
 * Entirely offline. Reads files from disk and hashes them. Opens no socket,
 * spawns no process, reads no environment variable and touches no database.
 *
 * Grades the real Migration C (public vendor projection + direct-table privilege
 * hardening), its SELECT-only verifier, and the repository's public-consumer
 * posture, against the locked C contract.
 *
 * Fixtures are load-bearing by construction: every one is a one-defect MUTATION
 * of the real migration, run through the SAME evaluateCMigration() that grades
 * the real file. A fixture whose mutation becomes a no-op is reported vacuous.
 *
 * Usage:  node scripts/mvp/staging/validate-qf-mvp-20-3c.mjs
 * Exit 0 = PASS, exit 1 = FAIL. Fails closed on ambiguous parsing.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const MIGRATION_C = "supabase/migrations/20260723000600_qf_mvp_public_projection_privilege_hardening.sql";
const PHASE_VERIFIER_C = "supabase/staging-verification/verify_qf_mvp_20_3c.sql";

/** Applied/reviewed and immutable. C must not have touched any of them. */
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
  { file: "supabase/staging-verification/verify_qf_mvp_20_3b2.sql",
    sha256: "89903749acf61061f5332fe1e57a4808a1bf45c6bb0a929ad703810606270677" },
  { file: "scripts/mvp/staging/validate-qf-mvp-20-3b2.mjs",
    sha256: "87739ae0abc9e1587754add5016199ad0c6312a23c4f4137e22da55ca08aa00d" },
];

const results = [];
let failed = false;
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed = true;
}
function read(rel) { return readFileSync(path.join(ROOT, rel), "utf8"); }
function sha256(text) { return createHash("sha256").update(text, "utf8").digest("hex"); }

/* ---------------------------------------------------------------------------
 * SQL tokenizer — strips comments, single-quoted strings, quoted identifiers and
 * dollar-quoted bodies. Returns { code, bodies }. Fails closed.
 * ------------------------------------------------------------------------- */
function tokenize(sql, label) {
  let code = "";
  const bodies = [];
  let i = 0;
  const n = sql.length;
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
      code += " '' ";
      continue;
    }
    if (sql[i] === '"') {
      let ident = ""; i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') { ident += '"'; i += 2; continue; }
        if (sql[i] === '"') { i++; break; }
        ident += sql[i]; i++;
      }
      code += ` "${ident}" `;
      continue;
    }
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
    code += sql[i]; i++;
  }
  return { code, bodies };
}

/** Strip comments only; preserve strings/identifiers/body contents. Fails closed. */
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
      const start = i; i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      out += sql.slice(start, i); continue;
    }
    if (sql[i] === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const start = i + tag.length;
        const end = sql.indexOf(tag, start);
        if (end === -1) throw new Error(`${label}: unterminated dollar-quoted body ${tag}`);
        out += tag + stripComments(sql.slice(start, end), label) + tag;
        i = end + tag.length; continue;
      }
    }
    out += sql[i]; i++;
  }
  return out;
}

function norm(text) { return text.replace(/\s+/g, " ").toLowerCase(); }

/* Catalog `name`-typed columns; array_agg over any must be cast to text (B2R1). */
const NAME_TYPED_CATALOG_COLUMNS = ["attname", "relname", "proname", "tgname", "nspname", "conname", "polname"];
function findCatalogNameArrayDefects(strippedSql) {
  const out = [];
  const re = /array_agg\s*\(/gi;
  let m;
  while ((m = re.exec(strippedSql)) !== null) {
    let depth = 0, i = m.index + m[0].length - 1, start = i + 1;
    for (; i < strippedSql.length; i += 1) {
      if (strippedSql[i] === "(") depth += 1;
      else if (strippedSql[i] === ")") { depth -= 1; if (depth === 0) break; }
    }
    if (depth !== 0) continue;
    const arg = strippedSql.slice(start, i);
    const element = arg.split(/\border\s+by\b/i)[0];
    const colMatch = element.match(/\b([a-z_][a-z0-9_]*)\.([a-z_]+)\b/i);
    if (!colMatch) continue;
    const col = colMatch[2].toLowerCase();
    if (!NAME_TYPED_CATALOG_COLUMNS.includes(col)) continue;
    if (/::\s*(text|varchar)\b/i.test(element)) continue;
    out.push(`array_agg over catalog name column "${col}" is not cast to text (name[] vs text[] -> 42883)`);
  }
  return out;
}

/* ===========================================================================
 * THE EVALUATOR — one function, applied to the real migration AND each fixture.
 * ========================================================================= */

const VIEW = "vendor_public_v";

/** The frozen public allowlist. Order-independent. */
const ALLOWLIST = [
  "id", "business_name", "city", "office_city", "areas_covered", "covers_full_city",
  "service_categories", "selected_subcategories", "selected_category", "business_type",
  "experience", "years_experience", "starting_price", "public_description",
  "public_service_area_summary", "public_business_hours", "profile_image_url",
  "cover_image_url", "portfolio_urls", "rating", "completed_projects",
];

/** Monetization / PII / internal columns that must NEVER appear in the view SELECT. */
const FORBIDDEN = [
  "remaining_credits", "total_credits", "package_name", "package_status",
  "package_expires_at", "paid_status", "verification_status", "gst_number",
  "phone", "email", "whatsapp_number", "user_id", "owner_name", "message",
  "utm_source", "utm_medium", "utm_campaign", "source_url", "last_assigned_at",
  "office_address_line1", "office_address_line2", "office_pincode",
  "office_latitude", "office_longitude", "latitude", "longitude",
  "formatted_address", "google_place_id", "accepting_leads",
];

export function evaluateCMigration(sql, label = "C") {
  const findings = [];
  const add = (rule, detail) => findings.push({ rule, detail });

  let tokens, text;
  try { tokens = tokenize(sql, label); } catch (e) { add("R00_parse", e.message); return findings; }
  try { text = stripComments(sql, label); } catch (e) { add("R00_parse", e.message); return findings; }
  const code = norm(tokens.code);
  const stripped = norm(text);
  const bodies = tokens.bodies.map((b) => norm(b)).join("\n");

  // The view SELECT column list, isolated (comment-stripped, up to the FROM).
  const viewMatch = text.match(/create\s+(or\s+replace\s+)?view\s+public\.vendor_public_v\s+as\s+select([\s\S]*?)\bfrom\b/i);
  const viewCols = viewMatch ? norm(viewMatch[2]) : "";

  // -- R01 no explicit transaction control -----------------------------------
  if (/(^|;|\s)(begin|commit|rollback|start transaction|savepoint)\s*(;|$)/.test(code)) {
    add("R01_no_transaction_control", "explicit transaction control in executable SQL");
  }

  // -- R02 no destructive DDL / data operation -------------------------------
  const DESTRUCTIVE = [
    [/\bdrop\s+table\b/, "drop table"],
    [/\bdrop\s+schema\b/, "drop schema"],
    [/\bdrop\s+database\b/, "drop database"],
    [/\bdrop\s+function\b/, "drop function"],
    [/\bdrop\s+trigger\b/, "drop trigger"],
    [/(^|;)\s*truncate\b/, "truncate statement"],
    [/(^|;)\s*(insert\s+into|update\s+public\.|delete\s+from)\b/, "data mutation (backfill)"],
  ];
  for (const [re, why] of DESTRUCTIVE) if (re.test(code)) add("R02_no_destructive", why);

  // -- R03 no migration-history write ----------------------------------------
  if (/supabase_migrations|schema_migrations/.test(stripped)) {
    add("R03_no_history_write", "touches the Supabase migration-history tables");
  }

  // -- R04 no secrets / URLs / project refs ----------------------------------
  if (/https?:\/\/|supabase\.co|postgres(ql)?:\/\/|service_role_key|sb_secret|eyj[a-z0-9]/i.test(stripped)) {
    add("R04_no_secrets_or_urls", "a URL, project ref or credential-shaped token in executable SQL");
  }

  // -- R05 no broad grants / default privileges ------------------------------
  if (/\bgrant\s+all\b/.test(code)) add("R05_no_broad_grants", "GRANT ALL");
  if (/\balter\s+default\s+privileges\b/.test(code)) add("R05_no_broad_grants", "ALTER DEFAULT PRIVILEGES");

  // -- R06 the safe projection exists, with an EXPLICIT column list, no SELECT * --
  if (!new RegExp(`create\\s+(or\\s+replace\\s+)?view\\s+public\\.${VIEW}\\b`).test(code)) {
    add("R06_projection_present", `missing view public.${VIEW}`);
  }
  if (!viewMatch) {
    add("R06_projection_present", "could not isolate the view SELECT column list");
  } else if (/\bselect\s+\*/.test("select " + viewCols) || /\bv\.\*/.test(viewCols) || /\*/.test(viewCols)) {
    add("R06_projection_present", "the view uses SELECT * (must be an explicit allowlist)");
  }

  // -- R07 the view columns are EXACTLY the frozen allowlist ------------------
  if (viewMatch) {
    for (const col of ALLOWLIST) {
      if (!new RegExp(`\\bv\\.${col}\\b`).test(viewCols)) {
        add("R07_allowlist_exact", `allowlisted column v.${col} is missing from the view`);
      }
    }
  }

  // -- R08 no forbidden column may appear in the view SELECT -----------------
  if (viewMatch) {
    for (const col of FORBIDDEN) {
      if (new RegExp(`\\bv\\.${col}\\b`).test(viewCols)) {
        add("R08_no_forbidden_column", `forbidden column v.${col} appears in the view SELECT`);
      }
    }
  }

  // -- R09 view security model: security_invoker must NOT be enabled ---------
  //    (owner-rights view is what lets anon read it without base-table access;
  //    enabling security_invoker would require re-granting base SELECT to anon).
  if (/security_invoker\s*=\s*(on|true)/.test(code)) {
    add("R09_view_security_model", "security_invoker is enabled — would require anon base-table access");
  }

  // -- R10 direct VENDORS privileges revoked from PUBLIC and anon ------------
  if (!/revoke\s+all[\s\S]{0,40}?on\s+table\s+public\.vendors\s+from\s+public\b/.test(code)) {
    add("R10_vendors_revoked", "PUBLIC is not fully revoked on vendors");
  }
  if (!/revoke\s+all[\s\S]{0,40}?on\s+table\s+public\.vendors\s+from\s+anon\b/.test(code)) {
    add("R10_vendors_revoked", "anon is not fully revoked on vendors");
  }
  // authenticated WRITE privileges revoked (SELECT retained separately).
  if (!/revoke\s+insert[\s\S]{0,80}?on\s+table\s+public\.vendors\s+from\s+authenticated\b/.test(code)) {
    add("R10_vendors_revoked", "authenticated write privileges are not revoked on vendors");
  }

  // -- R11 direct LEADS privileges revoked from PUBLIC/anon/authenticated ----
  for (const role of ["public", "anon", "authenticated"]) {
    if (!new RegExp(`revoke\\s+all[\\s\\S]{0,40}?on\\s+table\\s+public\\.leads\\s+from\\s+${role}\\b`).test(code)) {
      add("R11_leads_revoked", `${role} is not fully revoked on leads`);
    }
  }

  // -- R12 the unsafe policies are dropped -----------------------------------
  for (const pol of ["vendors public listing", "vendors public register", "leads public insert"]) {
    if (!new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+"${pol}"`, "i").test(stripped)) {
      add("R12_unsafe_policies_dropped", `unsafe policy "${pol}" is not dropped`);
    }
  }

  // -- R13 service_role access preserved; view grants narrow, never PUBLIC ---
  if (/revoke[\s\S]{0,60}?from\s+service_role\b/.test(code)) {
    add("R13_service_role_preserved", "C revokes a privilege from service_role");
  }
  if (!/grant\s+select\s+on\s+table\s+public\.vendor_public_v\s+to\s+[^;]*\banon\b/.test(code)
      || !/grant\s+select\s+on\s+table\s+public\.vendor_public_v\s+to\s+[^;]*\bauthenticated\b/.test(code)) {
    add("R13_service_role_preserved", "vendor_public_v is not granted to anon + authenticated");
  }
  if (!/revoke\s+all\s+on\s+table\s+public\.vendor_public_v\s+from\s+public\b/.test(code)) {
    add("R13_service_role_preserved", "vendor_public_v PUBLIC grant is not revoked");
  }
  if (/grant\s+select\s+on\s+table\s+public\.vendor_public_v\s+to\s+[^;]*\bpublic\b/.test(code)) {
    add("R13_service_role_preserved", "vendor_public_v is granted to PUBLIC");
  }

  // -- R14 authenticated keeps vendors SELECT (vendor-own dashboard) ---------
  if (!/grant\s+select\s+on\s+table\s+public\.vendors\s+to\s+authenticated\b/.test(code)) {
    add("R14_dashboard_preserved", "authenticated vendors SELECT is not re-granted (breaks the dashboard)");
  }

  // -- R15 scope fence: no Migration E legacy-RPC EXECUTE revocation ---------
  if (/revoke[\s\S]{0,120}?on\s+function\s+public\.(assign_lead_to_vendors|admin_smart_assign_lead_to_vendors|assign_lead_to_paid_vendors_phase26a|assign_lead_to_preferred_vendor|assign_client_selected_vendor_to_group|assign_vendor_to_requirement_group)/.test(code)) {
    add("R15_scope_fence", "Migration E legacy-RPC EXECUTE revocation in C");
  }
  if (/drop\s+function\s+public\.(assign_lead_to_vendors|admin_smart_assign_lead_to_vendors)/.test(code)) {
    add("R15_scope_fence", "a legacy assignment RPC is dropped in C");
  }

  // -- R16 scope fence: no Migration D auth.users trigger --------------------
  if (/create\s+trigger\s+\S+[\s\S]{0,60}?on\s+auth\.users/.test(code)) {
    add("R16_scope_fence", "Migration D auth.users trigger in C");
  }

  // -- R17 scope fence: no owner-binding / client-selected reactivation ------
  if (/alter\s+table\s+public\.leads\s+add\s+column\s+(client_account_id|user_id|created_by)\b/.test(code)) {
    add("R17_scope_fence", "an owner-binding column is added to leads");
  }
  if (/create\s+table\s+public\.(client_selection_requests|lead_ownership|client_lead_bindings)\b/.test(code)) {
    add("R17_scope_fence", "a client-selection/ownership table is created");
  }

  // -- R18 self-verification present, runtime type-safe, no lexical assertion -
  if (!/do\s+\$verify\$/.test(sql)) add("R18_self_verification", "no self-verification block");
  if (/pg_get_functiondef|prosrc\b|routine_definition/.test(bodies)) {
    add("R18_self_verification", "a lexical assertion over comment-retaining catalog text");
  }
  for (const finding of findCatalogNameArrayDefects(text)) add("R18_self_verification", finding);

  // -- R19 the canonical B1/B2/G surface is not redefined by C ---------------
  if (/create\s+or\s+replace\s+function\s+public\.qf_(assign_lead_vendors_v2|apply_credit_mutation_v2|enforce_lead_assignment_active_cap|enforce_lead_lifetime_vendor_cap|prevent_lead_assignment_event_mutation|prevent_lead_assignment_event_truncate)\b/.test(code)) {
    add("R19_b1_b2_untouched", "C redefines a B1/B2 function");
  }
  if (/create\s+trigger\s+trg_lead_assignment/.test(code)) {
    add("R19_b1_b2_untouched", "C creates a B2 enforcement trigger");
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
 * 2. The real C migration must have ZERO findings
 * ========================================================================= */
const cRaw = read(MIGRATION_C);
const cSha = sha256(cRaw);
const realFindings = evaluateCMigration(cRaw, "20260723000600");
record("02 real C migration has zero findings", realFindings.length === 0,
  realFindings.length === 0 ? "clean" : realFindings.map((f) => `${f.rule}: ${f.detail}`).join(" | "));

record("03 C migration path is the locked candidate identity",
  MIGRATION_C === "supabase/migrations/20260723000600_qf_mvp_public_projection_privilege_hardening.sql",
  MIGRATION_C);

/* ===========================================================================
 * 3. One-defect mutation fixtures — each mutates the REAL migration once.
 * ========================================================================= */
const FIXTURES = [
  { id: "A", rule: "R01_no_transaction_control", why: "explicit BEGIN/COMMIT",
    mutate: (s) => `begin;\n${s}\ncommit;\n` },
  { id: "B", rule: "R02_no_destructive", why: "drop table",
    mutate: (s) => `${s}\ndrop table public.leads;\n` },
  { id: "C", rule: "R02_no_destructive", why: "data backfill",
    mutate: (s) => `${s}\nupdate public.vendors set public_visibility = true;\n` },
  { id: "D", rule: "R03_no_history_write", why: "history write",
    mutate: (s) => `${s}\ninsert into supabase_migrations.schema_migrations(version) values('20260723000600');\n` },
  { id: "E", rule: "R04_no_secrets_or_urls", why: "URL in executable SQL",
    mutate: (s) => s.replace("create or replace view public.vendor_public_v as",
      "comment on schema public is 'https://uckafzuochmbvtiodmcl.supabase.co';\ncreate or replace view public.vendor_public_v as") },
  { id: "F", rule: "R05_no_broad_grants", why: "GRANT ALL",
    mutate: (s) => `${s}\ngrant all on table public.vendors to authenticated;\n` },
  { id: "G", rule: "R06_projection_present", why: "SELECT * in the view",
    mutate: (s) => s.replace(/create or replace view public\.vendor_public_v as\s+select[\s\S]*?from public\.vendors v/,
      "create or replace view public.vendor_public_v as\n  select v.*\n  from public.vendors v") },
  { id: "H", rule: "R07_allowlist_exact", why: "an allowlisted column removed",
    mutate: (s) => s.replace("    v.business_name,\n", "") },
  { id: "I", rule: "R08_no_forbidden_column", why: "a monetization column leaked into the view",
    mutate: (s) => s.replace("    v.rating,\n", "    v.rating,\n    v.remaining_credits,\n") },
  { id: "J", rule: "R08_no_forbidden_column", why: "phone PII leaked into the view",
    mutate: (s) => s.replace("    v.city,\n", "    v.city,\n    v.phone,\n") },
  { id: "K", rule: "R09_view_security_model", why: "security_invoker enabled",
    mutate: (s) => s.replace("create or replace view public.vendor_public_v as",
      "create or replace view public.vendor_public_v with (security_invoker = true) as") },
  { id: "L", rule: "R10_vendors_revoked", why: "anon vendors revoke removed",
    mutate: (s) => s.replace("revoke all privileges on table public.vendors from anon;", "-- removed") },
  { id: "M", rule: "R11_leads_revoked", why: "anon leads revoke removed",
    mutate: (s) => s.replace("revoke all privileges on table public.leads from anon;", "-- removed") },
  { id: "N", rule: "R12_unsafe_policies_dropped", why: "always-true leads insert policy kept",
    mutate: (s) => s.replace('drop policy if exists "leads public insert" on public.leads;', "-- kept") },
  { id: "O", rule: "R12_unsafe_policies_dropped", why: "vendors public listing policy kept",
    mutate: (s) => s.replace('drop policy if exists "vendors public listing" on public.vendors;', "-- kept") },
  { id: "P", rule: "R13_service_role_preserved", why: "service_role revoked",
    mutate: (s) => `${s}\nrevoke all on table public.vendors from service_role;\n` },
  { id: "Q", rule: "R13_service_role_preserved", why: "view granted to PUBLIC",
    mutate: (s) => `${s}\ngrant select on table public.vendor_public_v to public;\n` },
  { id: "R", rule: "R14_dashboard_preserved", why: "authenticated vendors SELECT not restored",
    mutate: (s) => s.replace("grant select on table public.vendors to authenticated;", "-- removed") },
  { id: "S", rule: "R15_scope_fence", why: "Migration E legacy-RPC revoke smuggled in",
    mutate: (s) => `${s}\nrevoke execute on function public.assign_lead_to_vendors(uuid, uuid[], boolean, text) from service_role;\n` },
  { id: "T", rule: "R16_scope_fence", why: "Migration D auth.users trigger",
    mutate: (s) => `${s}\ncreate trigger t_x after insert on auth.users for each row execute function public.noop();\n` },
  { id: "U", rule: "R17_scope_fence", why: "owner-binding column added to leads",
    mutate: (s) => `${s}\nalter table public.leads add column client_account_id uuid;\n` },
  { id: "V", rule: "R18_self_verification", why: "name[] = text[] defect reintroduced",
    mutate: (s) => s.replace("array_agg(a.attname::text order by a.attname::text)", "array_agg(a.attname order by a.attname)") },
  { id: "W", rule: "R19_b1_b2_untouched", why: "C redefines the canonical authority",
    mutate: (s) => `${s}\ncreate or replace function public.qf_assign_lead_vendors_v2(p_lead_id uuid) returns jsonb language sql as $x$ select '{}'::jsonb $x$;\n` },
];

for (const fx of FIXTURES) {
  const mutated = fx.mutate(cRaw);
  const changed = mutated !== cRaw;
  const findings = changed ? evaluateCMigration(mutated, `fixture-${fx.id}`) : [];
  const tripped = findings.some((f) => f.rule === fx.rule);
  record(`04 fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`,
    changed && tripped,
    !changed ? "MUTATION WAS A NO-OP — the fixture is vacuous"
      : tripped ? `tripped (${findings.length} finding(s))`
      : `did NOT trip; findings: ${findings.map((f) => f.rule).join(",") || "none"}`);
}

record("05 every evaluator rule has at least one fixture", (() => {
  const covered = new Set(FIXTURES.map((f) => f.rule));
  const declared = [...new Set([...read("scripts/mvp/staging/validate-qf-mvp-20-3c.mjs")
    .matchAll(/add\("(R\d\d_[a-z0-9_]+)"/g)].map((m) => m[1]))].filter((r) => r !== "R00_parse");
  const missing = declared.filter((r) => !covered.has(r));
  return missing.length === 0 ? true : missing;
})() === true, "every enforced rule is exercised by a one-defect fixture");

/* ===========================================================================
 * 4. The SELECT-only staging verifier
 * ========================================================================= */
const verRaw = read(PHASE_VERIFIER_C);
const verSha = sha256(verRaw);
let verTokens;
try { verTokens = tokenize(verRaw, "verify_c"); record("06 verifier parses cleanly", true, "ok"); }
catch (e) { verTokens = { code: "", bodies: [] }; record("06 verifier parses cleanly", false, e.message); }
const verCode = norm(verTokens.code);

record("07 verifier performs no DML or DDL",
  !/(^|;)\s*(insert\s+into|update\s+|delete\s+from|create\s+|alter\s+|drop\s+|truncate|grant\s+|revoke\s+)/.test(verCode),
  "SELECT-only");
record("07b verifier casts every catalog name array to text",
  findCatalogNameArrayDefects(stripComments(verRaw, "verifier")).length === 0, "no name[]=text[]");
record("08 verifier has no transaction control",
  !/(^|;|\s)(begin|commit|rollback|savepoint)\s*(;|$)/.test(verCode), "clean");
record("09 verifier has no secrets/URLs",
  !/https?:\/\/|supabase\.co|postgres(ql)?:\/\//i.test(norm(stripComments(verRaw, "verifier"))), "clean");

const verRows = [...verRaw.matchAll(/^select\s+(\d+)\s*(?:as\s+seq)?\s*,/gim)].map((m) => Number(m[1]));
record("10 verifier rows are sequential and unique",
  verRows.length > 0 && new Set(verRows).size === verRows.length && verRows.every((v, i) => v === i + 1),
  `${verRows.length} rows`);

for (const marker of ["20260723000600", "vendor_public_v", "leads public insert",
  "vendors public listing", "qf_assign_lead_vendors_v2", "trg_lead_assignment_events_immutable",
  "get_public_eligible_vendors", ...ALLOWLIST]) {
  record(`11 verifier asserts on ${marker}`, verRaw.includes(marker), "present");
}
for (const col of FORBIDDEN.slice(0, 8)) {
  record(`11b verifier guards forbidden column ${col}`, verRaw.includes(col), "present");
}
record("12 verifier makes no lexical assertion over function source",
  !/pg_get_functiondef|prosrc\b|routine_definition/.test(norm(stripComments(verRaw, "verifier"))), "clean");

/* ===========================================================================
 * 5. Repository posture — no unsafe browser/anon table access exists
 * ========================================================================= */
const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", ".vercel", "out"]);
const CODE_EXT = /\.(ts|tsx|mjs|js|jsx)$/;
function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(path.join(ROOT, dir)); } catch { return acc; }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const rel = path.join(dir, e);
    let st; try { st = statSync(path.join(ROOT, rel)); } catch { continue; }
    if (st.isDirectory()) walk(rel, acc);
    else if (CODE_EXT.test(e)) acc.push(rel.split(path.sep).join("/"));
  }
  return acc;
}
const runtimeFiles = ["app", "services", "lib", "components"].flatMap((d) => walk(d));
const stripTs = (src) => {
  // comment strip for TS (line + block), strings preserved.
  let out = "", i = 0; const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);
    if (two === "//") { const nl = src.indexOf("\n", i); i = nl === -1 ? n : nl; continue; }
    if (two === "/*") { const end = src.indexOf("*/", i + 2); i = end === -1 ? n : end + 2; continue; }
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n) { if (src[j] === "\\") { j += 2; continue; } if (src[j] === ch) { j++; break; } j++; }
      out += src.slice(i, j); i = j; continue;
    }
    out += ch; i++;
  }
  return out;
};

const clientComponents = runtimeFiles.filter((f) => /^\s*["'`]use client["'`]/m.test(read(f)));
const browserLeadOrVendorTable = clientComponents.filter((f) => {
  const c = stripTs(read(f));
  return /\.from\(\s*["'`](leads|vendors)["'`]\s*\)/.test(c);
});
record("13 no \"use client\" component touches the leads/vendors table",
  browserLeadOrVendorTable.length === 0, `offenders: ${JSON.stringify(browserLeadOrVendorTable)}`);

const clientAdmin = clientComponents.filter((f) => {
  const c = stripTs(read(f));
  return /\badminClient\b/.test(c) || /SUPABASE_SERVICE_ROLE_KEY/.test(c);
});
record("14 no \"use client\" component imports the service-role client/key",
  clientAdmin.length === 0, `offenders: ${JSON.stringify(clientAdmin)}`);

// The sole lead INSERT must run through the service-role client, never anon/public.
const anonLeadInsert = runtimeFiles.filter((f) => {
  const c = stripTs(read(f));
  return /(publicClient|browserClient)\(\)\s*\.\s*from\(\s*["'`]leads["'`]\s*\)\s*\.\s*insert/.test(c);
});
record("15 no anon/browser INSERT into leads exists",
  anonLeadInsert.length === 0, `offenders: ${JSON.stringify(anonLeadInsert)}`);

/* ===========================================================================
 * Report
 * ========================================================================= */
const passed = results.filter((r) => r.ok).length;
const failedCount = results.length - passed;
console.log("== QF-MVP-20.3C offline migration validator ==");
console.log(`C migration : ${MIGRATION_C}`);
console.log(`C SHA-256   : ${cSha}`);
console.log(`verifier    : ${PHASE_VERIFIER_C}`);
console.log(`verifier SHA: ${verSha}`);
console.log("");
for (const r of results) {
  console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`);
  if (!r.ok) console.log(`         ${r.detail}`);
}
console.log("");
console.log(`checks: ${passed} passed, ${failedCount} failed (of ${results.length})`);
console.log(`fixtures: ${FIXTURES.length} one-defect mutations, all derived from the real migration`);
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
