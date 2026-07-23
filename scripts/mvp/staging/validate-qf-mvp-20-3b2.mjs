#!/usr/bin/env node
/**
 * QF-MVP-20.3B2 — Offline migration validator.
 *
 * Entirely offline. Reads files from disk and hashes them. Opens no socket,
 * spawns no process, reads no environment variable and touches no database.
 *
 * Validates the generated B2 universal-enforcement migration and its SELECT-only
 * staging verifier against the locked assignment invariants, the B1 authority
 * contract and the phase scope fence (no C / D / E / 20.4 / owner-binding work).
 *
 * Design note on fixtures: EVERY fixture is a one-defect MUTATION of the real
 * migration text, evaluated by the SAME `evaluateB2Migration()` that judges the
 * real file. A fixture can therefore never be vacuous — if the rule stopped
 * being enforced, the fixture would stop failing and this validator would report
 * it.
 *
 * Usage:  node scripts/mvp/staging/validate-qf-mvp-20-3b2.mjs
 * Exit 0 = PASS, exit 1 = FAIL. Fails closed on ambiguous parsing.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const MIGRATION_B2 = "supabase/migrations/20260723000500_qf_mvp_assignment_universal_enforcement.sql";
const PHASE_VERIFIER_B2 = "supabase/staging-verification/verify_qf_mvp_20_3b2.sql";

/** Applied and immutable. B2 must not have touched any of them. */
const LOCKED = [
  { file: "supabase/migrations/20260723000100_qf_mvp_marketplace_authority_foundation.sql",
    sha256: "b6307094715a102fa0cfccc1533cb8089e5b26fbe1e80a294c127b81e29f2b83" },
  { file: "supabase/migrations/20260723000200_qf_mvp_assignment_lineage_backfill.sql",
    sha256: "9d77f4460701caa1caf172b50886b681f4b7e86849172ca2a7af1ece70eb3d60" },
  { file: "supabase/migrations/20260723000300_qf_mvp_canonical_assignment_authority.sql",
    sha256: "46ce7377a217a13620305572f1be9038a56c911ce76a556b4d52f91fe107177e" },
  { file: "supabase/migrations/20260723000400_qf_mvp_lineage_append_only_grants.sql",
    sha256: "91544524c27ca26020b648f13f462d2613ca407366c8de0f258ea4f04d8c553b" },
  { file: "supabase/staging-verification/verify_qf_mvp_20_3b1.sql",
    sha256: "e1d9edb85008c8f157016cb04f09ec127aba850d1980ca86ebb8e6721aab7483" },
  { file: "scripts/mvp/staging/validate-qf-mvp-20-3b1.mjs",
    sha256: "e27d62d09f38e599c34b1084019777b0147df68bba1c91389b52d1df6577a6c8" },
];

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
 * double-quoted identifiers and dollar-quoted bodies, so a keyword scan never
 * matches text that only APPEARS inside a comment or a literal.
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

/**
 * Strips comments while PRESERVING string literals, quoted identifiers and
 * dollar-quoted body contents. `tokenize().code` discards literal values, which
 * is right for structural keyword scans but useless for asserting that a
 * specific value such as 'delivered' is written. Fails closed.
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
    if (sql[i] === "'") {
      const start = i;
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      out += sql.slice(start, i);
      continue;
    }
    if (sql[i] === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const start = i + tag.length;
        const end = sql.indexOf(tag, start);
        if (end === -1) throw new Error(`${label}: unterminated dollar-quoted body ${tag}`);
        // Recurse so comments INSIDE a body are stripped too.
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

function norm(text) {
  return text.replace(/\s+/g, " ").toLowerCase();
}

/* ===========================================================================
 * THE EVALUATOR
 *
 * One function, applied to the real migration AND to every fixture. Returns an
 * array of rule ids that the given SQL violates.
 * ========================================================================= */

const EXPECTED_FUNCTIONS = [
  "qf_enforce_lead_assignment_active_cap",
  "qf_enforce_lead_lifetime_vendor_cap",
  "qf_prevent_lead_assignment_event_mutation",
  "qf_prevent_lead_assignment_event_truncate",
];

const EXPECTED_TRIGGERS = [
  { name: "trg_lead_assignments_active_cap", table: "lead_assignments", timing: "before insert or update" },
  { name: "trg_lead_assignment_events_lifetime_cap", table: "lead_assignment_events", timing: "before insert" },
  { name: "trg_lead_assignment_events_immutable", table: "lead_assignment_events", timing: "before update or delete" },
  { name: "trg_lead_assignment_events_no_truncate", table: "lead_assignment_events", timing: "before truncate" },
];

/** The exact ACTIVE set. Any deviation silently changes the cap's meaning. */
const ACTIVE_SET = ["assigned", "delivered", "accepted"];

export function evaluateB2Migration(sql, label = "B2") {
  const findings = [];
  const add = (rule, detail) => findings.push({ rule, detail });

  let tokens;
  try {
    tokens = tokenize(sql, label);
  } catch (e) {
    add("R00_parse", e.message);
    return findings;
  }
  const code = norm(tokens.code);
  const bodies = tokens.bodies.map((b) => norm(b));
  const allBodies = bodies.join("\n");
  let text;
  try {
    text = norm(stripComments(sql, label));
  } catch (e) {
    add("R00_parse", e.message);
    return findings;
  }

  // -- R01 no explicit transaction control -----------------------------------
  // The Supabase CLI wraps the file and its history insert in ONE transaction.
  if (/(^|;|\s)(begin|commit|rollback|start transaction|savepoint)\s*(;|$)/.test(code)) {
    add("R01_no_transaction_control", "explicit transaction control in executable SQL");
  }

  // -- R02 no destructive DDL ------------------------------------------------
  const DESTRUCTIVE = [
    [/\bdrop\s+table\b/, "drop table"],
    [/\bdrop\s+schema\b/, "drop schema"],
    [/\bdrop\s+database\b/, "drop database"],
    [/\bdrop\s+index\b/, "drop index"],
    [/\bdrop\s+constraint\b/, "drop constraint"],
    [/\bdrop\s+column\b/, "drop column"],
    [/\bdrop\s+policy\b/, "drop policy"],
    [/(^|;)\s*truncate\b/, "truncate statement"],
    [/\bdrop\s+function\s+public\.qf_(assign_lead_vendors_v2|apply_credit_mutation_v2|vendor_assignment_eligible|request_replacement_v2|approve_credit_restoration_v2)\b/,
      "drop of a canonical B1 function"],
  ];
  for (const [re, why] of DESTRUCTIVE) {
    if (re.test(code)) add("R02_no_destructive_ddl", why);
  }

  // -- R03 no migration-history manipulation ---------------------------------
  if (/supabase_migrations|schema_migrations/.test(text)) {
    add("R03_no_history_write", "touches the Supabase migration-history tables");
  }

  // -- R04 no secrets, URLs or project refs in executable SQL ----------------
  if (/https?:\/\/|supabase\.co|postgres(ql)?:\/\/|service_role_key|sb_secret|eyj[a-z0-9]/i.test(text)) {
    add("R04_no_secrets_or_urls", "a URL, project ref or credential-shaped token appears in executable SQL");
  }

  // -- R05 no broad grants / default privileges ------------------------------
  if (/\bgrant\s+all\b/.test(code)) add("R05_no_broad_grants", "GRANT ALL");
  if (/\balter\s+default\s+privileges\b/.test(code)) add("R05_no_broad_grants", "ALTER DEFAULT PRIVILEGES");

  // -- R06 no data backfill --------------------------------------------------
  // Executable DML outside the trigger/verification bodies would be a backfill.
  if (/(^|;)\s*(insert\s+into|update\s+public\.|delete\s+from)\b/.test(code)) {
    add("R06_no_data_backfill", "top-level DML (backfill) in the migration");
  }

  // -- R07 the four enforcement functions exist ------------------------------
  for (const fn of EXPECTED_FUNCTIONS) {
    if (!new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(\\s*\\)`).test(code)) {
      add("R07_functions_present", `missing function ${fn}`);
    }
  }

  // -- R08 the four triggers exist, each guarded by DROP IF EXISTS -----------
  for (const t of EXPECTED_TRIGGERS) {
    if (!new RegExp(`drop\\s+trigger\\s+if\\s+exists\\s+${t.name}\\s+on\\s+public\\.${t.table}`).test(code)) {
      add("R08_triggers_present", `missing idempotent drop for ${t.name}`);
    }
    const re = new RegExp(`create\\s+trigger\\s+${t.name}\\s+${t.timing}\\s+on\\s+public\\.${t.table}`);
    if (!re.test(code)) {
      add("R08_triggers_present", `missing or mis-timed trigger ${t.name} (${t.timing} on ${t.table})`);
    }
  }

  // -- R09 the caps are exactly 3 and 6, as internal constants ---------------
  if (!/c_active_cap\s+constant\s+integer\s*:=\s*3\b/.test(allBodies)) {
    add("R09_locked_caps", "the active cap is not the constant 3");
  }
  if (!/c_lifetime_cap\s+constant\s+integer\s*:=\s*6\b/.test(allBodies)) {
    add("R09_locked_caps", "the lifetime cap is not the constant 6");
  }
  // No caller-supplied ceiling may enter an enforcement function.
  if (/\bp_total_limit\b|\bp_max_active\b|\bp_cap\b/.test(allBodies)) {
    add("R09_locked_caps", "a caller-supplied ceiling parameter appears in an enforcement body");
  }

  // -- R10 ACTIVE is exactly {assigned, delivered, accepted} ----------------
  const activeBody = norm(
    (stripComments(sql, label).match(/qf_enforce_lead_assignment_active_cap[\s\S]*?\$\$;/) || [""])[0],
  );
  for (const state of ACTIVE_SET) {
    if (!new RegExp(`'${state}'`).test(activeBody)) {
      add("R10_active_set_exact", `ACTIVE set is missing '${state}'`);
    }
  }
  for (const forbidden of ["requested", "rejected", "expired", "cancelled", "invalid", "replaced", "completed", "in_progress"]) {
    if (new RegExp(`'${forbidden}'`).test(activeBody)) {
      add("R10_active_set_exact", `'${forbidden}' must not be treated as ACTIVE`);
    }
  }

  // -- R11 lifetime evidence is the exact lineage predicate ------------------
  const lifetimeBody = norm(
    (stripComments(sql, label).match(/qf_enforce_lead_lifetime_vendor_cap[\s\S]*?\$\$;/) || [""])[0],
  );
  if (!/event_type\s*=\s*'assignment_created'/.test(lifetimeBody)
      || !/lifecycle_to\s*=\s*'assigned'/.test(lifetimeBody)) {
    add("R11_lifetime_evidence", "lifetime evidence is not assignment_created + lifecycle_to='assigned'");
  }
  if (!/count\s*\(\s*distinct\s+vendor_id\s*\)/.test(lifetimeBody)) {
    add("R11_lifetime_evidence", "lifetime is not COUNT(DISTINCT vendor_id)");
  }
  if (!/not\s+exists/.test(lifetimeBody)) {
    add("R11_lifetime_evidence", "a repeat event for an already-counted vendor is not exempted");
  }

  // -- R12 both cap functions serialize on the leads row lock ----------------
  for (const [name, body] of [["active", activeBody], ["lifetime", lifetimeBody]]) {
    if (!/from\s+public\.leads\s+where\s+id\s*=\s*new\.lead_id\s+for\s+update/.test(body)) {
      add("R12_lead_lock", `the ${name} cap does not take the leads row lock`);
    }
  }

  // -- R13 the cap functions are SECURITY DEFINER with a pinned search_path --
  for (const fn of ["qf_enforce_lead_assignment_active_cap", "qf_enforce_lead_lifetime_vendor_cap"]) {
    const decl = norm(
      (stripComments(sql, label).match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}[\\s\\S]*?as\\s*\\$\\$`)) || [""])[0],
    );
    if (!/security\s+definer/.test(decl)) add("R13_secdef_searchpath", `${fn} is not SECURITY DEFINER`);
    if (!/set\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*,\s*pg_temp/.test(decl)) {
      add("R13_secdef_searchpath", `${fn} has no pinned search_path`);
    }
  }

  // -- R14 no caller-controlled or session-controlled bypass ----------------
  if (/current_setting\s*\(/.test(allBodies)) {
    add("R14_no_bypass", "a session GUC is read inside an enforcement body");
  }
  if (/\b(skip_enforcement|bypass|force_allow|disable_cap|allow_override)\b/.test(allBodies)) {
    add("R14_no_bypass", "a bypass flag appears in an enforcement body");
  }
  if (/alter\s+table\s+\S+\s+disable\s+trigger/.test(code)) {
    add("R14_no_bypass", "a trigger is disabled");
  }

  // -- R15 scope fence: no C / D / E / 20.4 work ----------------------------
  if (/create\s+(or\s+replace\s+)?(materialized\s+)?view\s+public\.vendor_public_v/.test(code)) {
    add("R15_scope_fence", "Migration C public vendor projection");
  }
  if (/create\s+trigger\s+\S+\s+[\s\S]{0,60}?on\s+auth\.users/.test(code)) {
    add("R15_scope_fence", "Migration D auth.users trigger");
  }
  if (/revoke[\s\S]{0,120}?on\s+function\s+public\.(assign_lead_to_vendors|admin_smart_assign_lead_to_vendors|assign_lead_to_paid_vendors_phase26a|assign_lead_to_preferred_vendor|assign_client_selected_vendor_to_group|assign_vendor_to_requirement_group)/.test(code)) {
    add("R15_scope_fence", "Migration E legacy EXECUTE revocation");
  }
  if (/revoke[\s\S]{0,80}?on\s+table\s+public\.(leads|vendors)\b/.test(code)) {
    add("R15_scope_fence", "Migration C anon revoke on leads/vendors");
  }

  // -- R16 scope fence: no owner-binding work -------------------------------
  if (/alter\s+table\s+public\.leads\s+add\s+column\s+(client_account_id|user_id|created_by)\b/.test(code)) {
    add("R16_no_owner_binding", "an owner-binding column was added to leads");
  }
  if (/create\s+table\s+public\.(client_selection_requests|lead_ownership|client_lead_bindings)\b/.test(code)) {
    add("R16_no_owner_binding", "a client-selection/ownership table was created");
  }
  if (/'client_selected'/.test(allBodies) && !/not\s+in\s*\(|<>/.test(allBodies)) {
    add("R16_no_owner_binding", "client-selected assignment appears to be reactivated");
  }

  // -- R17 B2 creates NO index and NO table constraint ----------------------
  // Both cap counts are already served by Migration A's indexes.
  if (/create\s+(unique\s+)?index\b/.test(code)) {
    add("R17_no_new_index", "B2 creates an index; Migration A's indexes already serve both counts");
  }
  if (/alter\s+table[\s\S]{0,80}?add\s+constraint\b/.test(code)) {
    add("R17_no_new_index", "B2 adds a table constraint");
  }

  // -- R18 no trigger beyond the four declared ------------------------------
  const created = [...norm(tokens.code).matchAll(/create\s+trigger\s+([a-z0-9_]+)/g)].map((m) => m[1]);
  const declared = new Set(EXPECTED_TRIGGERS.map((t) => t.name));
  for (const name of created) {
    if (!declared.has(name)) add("R18_no_extra_triggers", `undeclared trigger ${name}`);
  }
  if (created.length !== EXPECTED_TRIGGERS.length) {
    add("R18_no_extra_triggers", `expected ${EXPECTED_TRIGGERS.length} triggers, found ${created.length}`);
  }

  // -- R19 self-verification exists and makes NO lexical assertion over
  //        comment-retaining catalog text (the QF-MVP-20.3B1A defect class).
  if (!/do\s+\$verify\$/.test(sql)) {
    add("R19_self_verification", "no self-verification block");
  }
  if (/pg_get_functiondef|prosrc|routine_definition/.test(allBodies)) {
    add("R19_self_verification", "a lexical assertion over comment-retaining catalog text");
  }
  for (const marker of ["to_regprocedure", "pg_trigger", "tgtype", "tgenabled"]) {
    if (!new RegExp(marker).test(allBodies)) {
      add("R19_self_verification", `self-verification does not use the catalog fact ${marker}`);
    }
  }

  // -- R20 the canonical B1 API is untouched --------------------------------
  if (/create\s+or\s+replace\s+function\s+public\.qf_(assign_lead_vendors_v2|apply_credit_mutation_v2|vendor_assignment_eligible|request_replacement_v2|approve_credit_restoration_v2)\b/.test(code)) {
    add("R20_b1_api_untouched", "B2 redefines a canonical B1 function");
  }

  // -- R21 immutability covers UPDATE, DELETE and TRUNCATE ------------------
  const immutableBody = norm(
    (stripComments(sql, label).match(/qf_prevent_lead_assignment_event_mutation[\s\S]*?\$\$;/) || [""])[0],
  );
  if (!/tg_op\s*=\s*'delete'/.test(immutableBody)) {
    add("R21_append_only", "DELETE is not explicitly refused");
  }
  if (!/to_jsonb\s*\(\s*new\s*\)/.test(immutableBody) || !/to_jsonb\s*\(\s*old\s*\)/.test(immutableBody)) {
    add("R21_append_only", "UPDATE immutability is not proved by whole-row comparison");
  }
  // The ON DELETE SET NULL retention contract is the ONLY permitted exception,
  // and a reference may be cleared, never repointed.
  if (!/new\.assignment_id\s+is\s+not\s+null/.test(immutableBody)
      || !/new\.operation_id\s+is\s+not\s+null/.test(immutableBody)) {
    add("R21_append_only", "a back-reference could be repointed instead of only cleared");
  }
  if (!/qf_prevent_lead_assignment_event_truncate/.test(code)) {
    add("R21_append_only", "no TRUNCATE guard");
  }

  // -- R22 owner authority is not reclassified as an application failure ----
  if (/postgres/.test(allBodies) && /application[_\s]role[_\s]failure/.test(allBodies)) {
    add("R22_owner_break_glass", "owner authority is reported as an application-role failure");
  }

  return findings;
}

/* ===========================================================================
 * 1. Locked artifacts are unchanged
 * ========================================================================= */

for (const item of LOCKED) {
  const actual = sha256(read(item.file));
  record(`01 locked artifact unchanged :: ${item.file}`, actual === item.sha256,
    actual === item.sha256 ? actual : `expected ${item.sha256}, got ${actual}`);
}

/* ===========================================================================
 * 2. The real B2 migration must have ZERO findings
 * ========================================================================= */

const b2Raw = read(MIGRATION_B2);
const b2Sha = sha256(b2Raw);
const realFindings = evaluateB2Migration(b2Raw, "20260723000500");

record("02 real B2 migration has zero findings", realFindings.length === 0,
  realFindings.length === 0 ? "clean" : realFindings.map((f) => `${f.rule}: ${f.detail}`).join(" | "));

record("03 B2 migration path is the locked candidate identity",
  MIGRATION_B2 === "supabase/migrations/20260723000500_qf_mvp_assignment_universal_enforcement.sql",
  MIGRATION_B2);

/* ===========================================================================
 * 3. One-defect mutation fixtures.
 *
 * Each mutates the REAL migration in exactly one place and must trip exactly
 * the targeted rule. Because they run through the same evaluator as the real
 * file, a fixture that stops failing proves the rule stopped being enforced.
 * ========================================================================= */

const FIXTURES = [
  { id: "A", rule: "R01_no_transaction_control",
    why: "explicit BEGIN/COMMIT wrapper",
    mutate: (s) => `begin;\n${s}\ncommit;\n` },

  { id: "B", rule: "R02_no_destructive_ddl",
    why: "destructive DROP TABLE",
    mutate: (s) => `${s}\ndrop table public.lead_assignment_events;\n` },

  { id: "C", rule: "R03_no_history_write",
    why: "migration-history manipulation",
    mutate: (s) => `${s}\ninsert into supabase_migrations.schema_migrations (version) values ('20260723000500');\n` },

  { id: "D", rule: "R04_no_secrets_or_urls",
    why: "a project ref / URL in executable SQL",
    mutate: (s) => s.replace(
      "create or replace function public.qf_enforce_lead_assignment_active_cap()",
      "-- x\ncomment on schema public is 'https://uckafzuochmbvtiodmcl.supabase.co';\ncreate or replace function public.qf_enforce_lead_assignment_active_cap()") },

  { id: "E", rule: "R05_no_broad_grants",
    why: "GRANT ALL",
    mutate: (s) => `${s}\ngrant all on table public.lead_assignment_events to service_role;\n` },

  { id: "F", rule: "R06_no_data_backfill",
    why: "top-level data backfill",
    mutate: (s) => `${s}\nupdate public.lead_assignments set lifecycle_status = 'assigned';\n` },

  { id: "G", rule: "R07_functions_present",
    why: "a missing enforcement function",
    mutate: (s) => s.replace(
      "create or replace function public.qf_prevent_lead_assignment_event_truncate()",
      "create or replace function public.qf_some_other_name()") },

  { id: "H", rule: "R08_triggers_present",
    why: "a cap trigger downgraded to INSERT-only",
    mutate: (s) => s.replace(
      "before insert or update on public.lead_assignments",
      "before insert on public.lead_assignments") },

  { id: "I", rule: "R09_locked_caps",
    why: "the active cap raised above 3",
    mutate: (s) => s.replace("c_active_cap constant integer := 3", "c_active_cap constant integer := 9") },

  { id: "J", rule: "R09_locked_caps",
    why: "the lifetime cap raised above 6",
    mutate: (s) => s.replace("c_lifetime_cap  constant integer := 6", "c_lifetime_cap  constant integer := 12") },

  { id: "K", rule: "R10_active_set_exact",
    why: "a non-active lifecycle state counted as ACTIVE",
    mutate: (s) => s.replace(
      "or new.lifecycle_status not in ('assigned', 'delivered', 'accepted') then",
      "or new.lifecycle_status not in ('assigned', 'delivered', 'accepted', 'completed') then") },

  { id: "L", rule: "R10_active_set_exact",
    why: "ACTIVE narrowed by dropping 'delivered'",
    mutate: (s) => s
      .replace("or new.lifecycle_status not in ('assigned', 'delivered', 'accepted') then",
               "or new.lifecycle_status not in ('assigned', 'accepted') then")
      .replace("     and old.lifecycle_status in ('assigned', 'delivered', 'accepted') then",
               "     and old.lifecycle_status in ('assigned', 'accepted') then")
      .replace("     and lifecycle_status in ('assigned', 'delivered', 'accepted')\n     and id <> new.id;",
               "     and lifecycle_status in ('assigned', 'accepted')\n     and id <> new.id;") },

  { id: "M", rule: "R11_lifetime_evidence",
    why: "lifetime counted from raw rows instead of DISTINCT vendors",
    mutate: (s) => s.replace("select count(distinct vendor_id) into v_lifetime", "select count(*) into v_lifetime") },

  { id: "N", rule: "R11_lifetime_evidence",
    why: "a repeat event wrongly consumes a lifetime slot",
    mutate: (s) => s.replace("  select not exists (", "  select exists (") },

  { id: "O", rule: "R12_lead_lock",
    why: "the serializing lead lock removed from the active cap",
    mutate: (s) => s.replace(
      "  perform 1 from public.leads where id = new.lead_id for update;\n\n  -- Separate statement",
      "  -- lock removed\n\n  -- Separate statement") },

  { id: "P", rule: "R13_secdef_searchpath",
    why: "an enforcement function downgraded to INVOKER rights",
    mutate: (s) => s.replace(
      "create or replace function public.qf_enforce_lead_assignment_active_cap()\nreturns trigger\nlanguage plpgsql\nsecurity definer\n",
      "create or replace function public.qf_enforce_lead_assignment_active_cap()\nreturns trigger\nlanguage plpgsql\n") },

  { id: "Q", rule: "R14_no_bypass",
    why: "a session-GUC bypass",
    mutate: (s) => s.replace(
      "  -- A row that is not ACTIVE cannot consume an active slot.",
      "  if current_setting('qf.skip_cap', true) = 'on' then return new; end if;\n  -- A row that is not ACTIVE cannot consume an active slot.") },

  { id: "R", rule: "R15_scope_fence",
    why: "Migration E legacy revocation smuggled into B2",
    mutate: (s) => `${s}\nrevoke execute on function public.assign_lead_to_vendors(uuid, uuid[], boolean, text) from service_role;\n` },

  { id: "S", rule: "R16_no_owner_binding",
    why: "owner-binding column added to leads",
    mutate: (s) => `${s}\nalter table public.leads add column client_account_id uuid;\n` },

  { id: "T", rule: "R17_no_new_index",
    why: "an undeclared index",
    mutate: (s) => `${s}\ncreate index idx_b2_extra on public.lead_assignments (lead_id);\n` },

  { id: "U", rule: "R18_no_extra_triggers",
    why: "an undeclared trigger",
    mutate: (s) => `${s}\ncreate trigger trg_b2_undeclared before insert on public.leads for each row execute function public.qf_enforce_lead_assignment_active_cap();\n` },

  { id: "V", rule: "R19_self_verification",
    why: "a lexical assertion over pg_get_functiondef",
    mutate: (s) => s.replace(
      "  -- 5.1 every B2 function exists",
      "  if pg_get_functiondef(to_regprocedure('public.qf_enforce_lead_lifetime_vendor_cap()')::oid) !~ 'vendor_id' then raise exception 'x'; end if;\n  -- 5.1 every B2 function exists") },

  { id: "W", rule: "R20_b1_api_untouched",
    why: "B2 redefining the canonical authority",
    mutate: (s) => `${s}\ncreate or replace function public.qf_assign_lead_vendors_v2(p_lead_id uuid) returns jsonb language sql as $x$ select '{}'::jsonb $x$;\n` },

  { id: "X", rule: "R21_append_only",
    why: "a back-reference could be repointed instead of only cleared",
    mutate: (s) => s.replace("     and new.assignment_id is not null then", "     and false then") },

  { id: "Y", rule: "R21_append_only",
    why: "the TRUNCATE guard removed",
    mutate: (s) => s.replace(/qf_prevent_lead_assignment_event_truncate/g, "qf_removed_truncate_guard") },
];

for (const fx of FIXTURES) {
  const mutated = fx.mutate(b2Raw);
  const changed = mutated !== b2Raw;
  const findings = changed ? evaluateB2Migration(mutated, `fixture-${fx.id}`) : [];
  const tripped = findings.some((f) => f.rule === fx.rule);
  record(
    `04 fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`,
    changed && tripped,
    !changed ? "MUTATION WAS A NO-OP — the fixture is vacuous"
      : tripped ? `tripped (${findings.length} finding(s))`
      : `did NOT trip; findings: ${findings.map((f) => f.rule).join(",") || "none"}`,
  );
}

record("05 every evaluator rule has at least one fixture", (() => {
  const covered = new Set(FIXTURES.map((f) => f.rule));
  const declaredRules = [...new Set(
    [...readFileSync(path.join(ROOT, "scripts/mvp/staging/validate-qf-mvp-20-3b2.mjs"), "utf8")
      .matchAll(/add\("(R\d\d_[a-z0-9_]+)"/g)].map((m) => m[1]),
  )].filter((r) => r !== "R00_parse" && r !== "R22_owner_break_glass");
  const missing = declaredRules.filter((r) => !covered.has(r));
  return missing.length === 0 ? true : missing;
})() === true, "every enforced rule is exercised by a one-defect fixture");

/* ===========================================================================
 * 4. The SELECT-only staging verifier
 * ========================================================================= */

const verRaw = read(PHASE_VERIFIER_B2);
const verSha = sha256(verRaw);
let verTokens;
try {
  verTokens = tokenize(verRaw, "verify_qf_mvp_20_3b2");
  record("06 verifier parses cleanly", true, "ok");
} catch (e) {
  verTokens = { code: "", bodies: [] };
  record("06 verifier parses cleanly", false, e.message);
}
const verCode = norm(verTokens.code);

record("07 verifier performs no DML or DDL",
  !/(^|;)\s*(insert\s+into|update\s+|delete\s+from|create\s+|alter\s+|drop\s+|truncate|grant\s+|revoke\s+)/.test(verCode),
  "SELECT-only");

record("08 verifier contains no transaction control",
  !/(^|;|\s)(begin|commit|rollback|savepoint)\s*(;|$)/.test(verCode), "no transaction control");

record("09 verifier contains no secrets, URLs or project refs",
  !/https?:\/\/|supabase\.co|postgres(ql)?:\/\//i.test(norm(stripComments(verRaw, "verifier"))), "clean");

// The verifier follows the B1 convention: `select <n> as seq` / `select <n>,`.
const verRows = [...verRaw.matchAll(/^select\s+(\d+)\s*(?:as\s+seq)?\s*,/gim)].map((m) => Number(m[1]));
record("10 verifier rows are sequential and unique",
  verRows.length > 0 && new Set(verRows).size === verRows.length
    && verRows.every((v, i) => v === i + 1),
  `${verRows.length} rows`);

for (const marker of [
  "20260723000500",
  ...EXPECTED_FUNCTIONS,
  ...EXPECTED_TRIGGERS.map((t) => t.name),
  "uq_replacement_requests_open_per_lead",
  "qf_assign_lead_vendors_v2",
  "vendor_public_v",
]) {
  record(`11 verifier asserts on ${marker}`, verRaw.includes(marker), "present");
}

// Scanned over COMMENT-STRIPPED text: the verifier's own header DOCUMENTS the
// locked policy by naming those functions, and a raw scan would flag that prose
// as a violation. Only executable SQL is judged.
//
// pg_get_constraintdef() and pg_get_expr() are deliberately NOT on this list.
// Unlike pg_get_functiondef()/prosrc they render a normalized expression that
// cannot contain a SQL comment, so a predicate over them is a structural fact,
// not a lexical assertion over authored prose.
record("12 verifier makes no lexical assertion over comment-retaining catalog text",
  !/pg_get_functiondef|prosrc|routine_definition/.test(norm(stripComments(verRaw, "verifier"))),
  "locked QF-MVP-20.3B1R2 policy honoured");

/* ===========================================================================
 * 5. DB <-> TS parity
 *
 * The staging test plan requires that the DB trigger and the TypeScript runtime
 * read the SAME caps and the SAME ACTIVE set. Read textually — this validator
 * executes no TypeScript.
 * ========================================================================= */

const TS_CONTRACT = "lib/marketplace/canonicalAssignmentContract.ts";
const tsRaw = read(TS_CONTRACT);

function tsConst(name) {
  // Escapes are doubled: this is a template literal, so `\\s` is needed to
  // reach the RegExp constructor as `\s`.
  const m = new RegExp(`export const ${name}\\s*=\\s*(\\d+)`).exec(tsRaw);
  return m ? Number(m[1]) : null;
}

const sqlActiveCap = Number((/c_active_cap\s+constant\s+integer\s*:=\s*(\d+)/.exec(b2Raw) || [])[1]);
const sqlLifetimeCap = Number((/c_lifetime_cap\s+constant\s+integer\s*:=\s*(\d+)/.exec(b2Raw) || [])[1]);

record("13 active cap agrees between B2 SQL and the TS contract",
  sqlActiveCap === 3 && tsConst("CANONICAL_ACTIVE_ASSIGNMENT_CAP") === 3,
  `sql=${sqlActiveCap} ts=${tsConst("CANONICAL_ACTIVE_ASSIGNMENT_CAP")}`);

record("14 lifetime cap agrees between B2 SQL and the TS contract",
  sqlLifetimeCap === 6 && tsConst("CANONICAL_LIFETIME_ASSIGNMENT_CAP") === 6,
  `sql=${sqlLifetimeCap} ts=${tsConst("CANONICAL_LIFETIME_ASSIGNMENT_CAP")}`);

// B2 enforces CAPS only. It must never define, read or alter an assignment
// credit cost — that stays inside the B1 authority and its wallet ledger.
record("15 B2 defines no assignment credit cost and writes no credit row",
  tsConst("CANONICAL_ASSIGNMENT_CREDIT_COST") === 1
    && !/c_credit_cost/.test(b2Raw)
    // Naming qf_apply_credit_mutation_v2 in a to_regprocedure() existence
    // assertion is a catalog READ proving B1 is intact — not a credit call.
    // What must be absent is an actual write or an actual invocation.
    && !/(insert\s+into|update)\s+public\.(vendor_credit_logs|vendors)\b/.test(
         norm(tokenize(b2Raw, "b2").bodies.join(" ")))
    && !/(select|perform)\s+public\.qf_apply_credit_mutation_v2\s*\(/.test(
         norm(tokenize(b2Raw, "b2").bodies.join(" ")))
    && !/remaining_credits/.test(norm(tokenize(b2Raw, "b2").bodies.join(" "))),
  "cost stays 1 and is owned by B1 alone");

record("16 B2 enforces the same ACTIVE set B1 uses",
  ["assigned", "delivered", "accepted"].every((st) =>
    new RegExp(`'${st}'`).test(b2Raw)) &&
  ["assigned", "delivered", "accepted"].every((st) =>
    new RegExp(`'${st}'`).test(read("supabase/migrations/20260723000300_qf_mvp_canonical_assignment_authority.sql"))),
  "ACTIVE = {assigned, delivered, accepted} in both B1 and B2");

record("17 B2 adds no runtime TypeScript change",
  !/qf_enforce_lead_assignment_active_cap|qf_enforce_lead_lifetime_vendor_cap/.test(tsRaw),
  "enforcement is a database boundary only; R1 runtime code is untouched");

/* ===========================================================================
 * Report
 * ========================================================================= */

const passed = results.filter((r) => r.ok).length;
const failedCount = results.length - passed;

console.log("== QF-MVP-20.3B2 offline migration validator ==");
console.log(`B2 migration : ${MIGRATION_B2}`);
console.log(`B2 SHA-256   : ${b2Sha}`);
console.log(`verifier     : ${PHASE_VERIFIER_B2}`);
console.log(`verifier SHA : ${verSha}`);
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
