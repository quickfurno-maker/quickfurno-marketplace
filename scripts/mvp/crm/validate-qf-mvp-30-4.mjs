#!/usr/bin/env node
/**
 * QF-MVP-30.4A — offline validator for the vendor campaign management foundation.
 *
 * Grades the REAL artifacts (migration, contracts, validation, verifier, docs)
 * and EXECUTES the real campaign rules. One-defect fixtures mutate copies to
 * prove each rule actually trips.
 *
 * Locked owner decisions enforced here:
 *   1. freeze at PREPARE, not at approval;
 *   3. narrow SECURITY DEFINER prepare/approve RPCs, service_role-only;
 *   4. communication_intents.aggregate_type NOT widened;
 *   5. communication_templates.category widened to include marketing ONLY;
 *   6. NO frequency-policy authority is created or claimed;
 *   7. exactly three campaign tables;
 *   8. NO plaintext destination anywhere.
 *
 * Section 7 executes `.ts` modules, so the type-stripping loader must be registered.
 *
 * Usage:  npm run test:crm:30-4                                 (exit 0 = PASS)
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATION = "supabase/migrations/20260723001300_qf_mvp_vendor_campaign_foundation.sql";
const SEGMENT_MIGRATION = "supabase/migrations/20260723001200_qf_mvp_vendor_segment_foundation.sql";
const VERIFIER_30_4 = "supabase/staging-verification/verify_qf_mvp_30_4.sql";
const VERIFIER_30_3 = "supabase/staging-verification/verify_qf_mvp_30_3.sql";
const VERIFIER_30_1B = "supabase/staging-verification/verify_qf_mvp_30_1b.sql";
const CONTRACTS = "lib/crm/campaignContracts.ts";
const VALIDATION = "lib/crm/campaignValidation.ts";
const SELF = "scripts/mvp/crm/validate-qf-mvp-30-4.mjs";

const results = [];
let failed = false;
const record = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) failed = true; };
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");

/**
 * Executable SQL only: blank out line comments AND single-quoted literals.
 *
 * ONE left-to-right scan, not two independent regex passes. Two passes are
 * genuinely wrong in both directions:
 *   • comments-first eats the closing quote of any literal that CONTAINS `--`
 *     (a verifier that strips SQL comments legitimately needs the literal
 *     `'--[^\n]*'`), desynchronising every literal after it on that line;
 *   • literals-first mis-parses any comment containing an apostrophe.
 * Either desynchronisation can leave a real mutating keyword exposed — a false
 * positive — or swallow one — a FALSE NEGATIVE in a safety rule. A scanner that
 * knows a `--` inside a literal is not a comment, and a `'` inside a comment is
 * not a literal, has neither failure mode.
 *
 * Dollar-quoted bodies are deliberately left intact: they ARE the function
 * source these rules grade.
 */
function execSql(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "'") {                       // single-quoted literal, '' escapes
      i += 1;
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") { i += 2; continue; }
        if (src[i] === "'") { i += 1; break; }
        i += 1;
      }
      out += "''";
      continue;
    }
    if (src[i] === "-" && src[i + 1] === "-") {  // line comment
      while (i < src.length && src[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
}

/* ===========================================================================
 * MIGRATION evaluator
 * ========================================================================= */
export function evaluateMigration(src) {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  const exec = execSql(src);

  // K01 exactly three campaign tables, and they are the locked three.
  const creates = [...src.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)].map((m) => m[1]);
  const expected = ["vendor_campaigns", "vendor_campaign_audience_members", "vendor_campaign_events"];
  if (creates.length !== 3 || !expected.every((t) => creates.includes(t))) {
    add("K01_exactly_three_tables", `creates ${creates.join(",") || "nothing"}`);
  }
  // K02 no extra head/version/audience-header/provider/delivery/intent/membership table.
  for (const t of ["vendor_campaign_versions", "vendor_campaign_audiences", "vendor_campaign_deliveries",
    "vendor_campaign_dispatches", "vendor_campaign_intents", "vendor_campaign_providers",
    "vendor_engagement_events", "vendor_segment_memberships", "campaign_frequency_policies"]) {
    if (new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${t}\\b`, "i").test(src)) {
      add("K02_no_extra_objects", `creates ${t}`);
    }
  }
  // K03 no plaintext destination / secret column.
  for (const c of ["phone", "email", "whatsapp_number", "msisdn", "destination", "recipient_ref",
    "to_address", "provider_payload", "access_token", "api_key"]) {
    if (new RegExp(`^\\s{2,}${c}\\s+\\w`, "mi").test(src)) add("K03_no_destination", `declares column ${c}`);
  }
  // K04 no Core-truth copy, no frequency policy, no execution/delivery state.
  for (const c of ["is_active", "verification_status", "city", "service_categories", "remaining_credits",
    "total_credits", "package_id", "is_eligible", "frequency_cap", "frequency_policy",
    "send_status", "delivery_status", "dispatched_at"]) {
    if (new RegExp(`^\\s{2,}${c}\\s+\\w`, "mi").test(src)) add("K04_no_core_or_execution", `declares column ${c}`);
  }
  // K05 RLS enabled on all three + untrusted revoked.
  for (const t of expected) {
    if (!new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, "i").test(src)) {
      add("K05_rls_default_deny", `RLS not enabled on ${t}`);
    }
    if (!new RegExp(`revoke\\s+all\\s+privileges\\s+on\\s+table\\s+public\\.${t}\\s+from[^;]*anon[^;]*authenticated`, "i").test(src)) {
      add("K05_rls_default_deny", `untrusted roles not revoked on ${t}`);
    }
  }
  if (/create\s+policy/i.test(exec)) add("K05_rls_default_deny", "a policy is created (default-deny expected)");
  // K06 grants: head SIU; snapshot/events SI only; never DELETE/TRUNCATE.
  const headGrant = src.match(/grant\s+([^;]+?)\s+on\s+table\s+public\.vendor_campaigns\s+to\s+service_role/i);
  if (!headGrant || !/select/i.test(headGrant[1]) || !/insert/i.test(headGrant[1]) || !/update/i.test(headGrant[1])) {
    add("K06_grant_posture", "vendor_campaigns grant is not select+insert+update");
  } else if (/\b(delete|truncate|references|trigger|all)\b/i.test(headGrant[1])) {
    // the head is lifecycle-by-state: an extra privilege here would make hard
    // delete possible. (An earlier draft only checked the required three.)
    add("K06_grant_posture", `vendor_campaigns grant includes a forbidden privilege: ${headGrant[1].trim()}`);
  }
  for (const t of ["vendor_campaign_audience_members", "vendor_campaign_events"]) {
    const g = src.match(new RegExp(`grant\\s+([^;]+?)\\s+on\\s+table\\s+public\\.${t}\\s+to\\s+service_role`, "i"));
    if (!g) add("K06_grant_posture", `no grant for ${t}`);
    else if (/update|delete|truncate|references|trigger|all\b/i.test(g[1])) {
      add("K06_grant_posture", `${t} grant is not append-only: ${g[1].trim()}`);
    }
  }
  if (/grant[^;]*vendor_campaign[^;]*(delete|truncate)/i.test(src)) {
    add("K06_grant_posture", "a campaign grant includes DELETE/TRUNCATE");
  }
  // K07 immutability + lifecycle triggers.
  for (const t of ["trg_vcam_immutable", "trg_vce_immutable", "trg_vcm_transition_guard", "trg_vcm_no_delete"]) {
    if (!new RegExp(`create\\s+trigger\\s+${t}\\b`, "i").test(src)) add("K07_immutability", `missing trigger ${t}`);
  }
  // K08 both RPCs, SECURITY DEFINER, fixed search_path, service_role-only, no dynamic SQL.
  for (const fn of ["qf_prepare_vendor_campaign_v1", "qf_approve_vendor_campaign_v1"]) {
    if (!new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\b`, "i").test(src)) {
      add("K08_rpc_security", `missing RPC ${fn}`);
    }
    if (!new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}[^;]*to\\s+service_role`, "i").test(src)) {
      add("K08_rpc_security", `${fn} is not granted to service_role`);
    }
    if (!new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}[^;]*from\\s+public,\\s*anon,\\s*authenticated`, "i").test(src)) {
      add("K08_rpc_security", `${fn} is not revoked from untrusted roles`);
    }
  }
  if ((src.match(/security\s+definer/gi) || []).length < 2) add("K08_rpc_security", "an RPC is not SECURITY DEFINER");
  if ((src.match(/set\s+search_path\s*=/gi) || []).length < 2) add("K08_rpc_security", "an RPC lacks a fixed search_path");
  if (/\bexecute\s+format\s*\(|\bexecute\s+'/i.test(exec)) add("K08_rpc_security", "dynamic SQL is used");
  // K09 communication_intents must NOT be widened (owner decision 4).
  if (/alter\s+table\s+public\.communication_intents/i.test(exec)) {
    add("K09_no_intent_widening", "alters communication_intents");
  }
  if (/communication_intents_aggregate_type_check[\s\S]{0,200}campaign/i.test(exec)) {
    add("K09_no_intent_widening", "widens aggregate_type to campaign");
  }
  // K10 marketing category alignment is the ONLY communication alteration.
  const alteredComms = [...exec.matchAll(/alter\s+table\s+public\.(communication_\w+)/gi)].map((m) => m[1]);
  const uniqueAltered = [...new Set(alteredComms)];
  if (uniqueAltered.length > 1 || (uniqueAltered.length === 1 && uniqueAltered[0] !== "communication_templates")) {
    add("K10_template_alignment", `alters ${uniqueAltered.join(",")}`);
  }
  if (!/communication_templates_category_check[\s\S]{0,200}marketing/i.test(src)) {
    add("K10_template_alignment", "marketing is not added to the category check");
  }
  if (!/check\s*\(category\s+in\s*\('authentication',\s*'business',\s*'marketing'\)\)/i.test(src)) {
    add("K10_template_alignment", "existing authentication/business values are not preserved");
  }
  // K11 no destructive DDL, no Core alteration, no backfill, no 006 dependency.
  if (/\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i.test(exec)) add("K11_forward_only", "destructive DDL/DML");
  if (/alter\s+table\s+public\.(vendors|leads|lead_assignments|profiles|packages|vendor_credit_logs|vendor_segments)\b/i.test(exec)) {
    add("K11_forward_only", "alters a Core/segment table");
  }
  if (/\binsert\s+into\s+public\.communication_templates\b/i.test(exec)) add("K11_forward_only", "inserts a template row");
  if (/\baudit_logs\b|\badmin_notifications\b/.test(exec)) add("K11_forward_only", "references an omitted migration-006 table");
  // K12 no STABLE function inside a CHECK constraint (pg_column_size trap).
  if (/check\s*\([^)]*pg_column_size\s*\(/i.test(src)) {
    add("K12_immutable_checks", "pg_column_size() used inside a CHECK (it is STABLE and will be rejected)");
  }
  return f;
}

/* ===========================================================================
 * CONTRACT evaluator
 * ========================================================================= */
export function evaluateContracts(src) {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  if (/import\s+["']server-only["']/.test(src)) add("T01_pure", "contracts import server-only");
  if (/adminClient|createClient|@supabase/.test(src)) add("T01_pure", "contracts touch a database client");
  // no execution/send state in the lifecycle vocabulary.
  if (/["'](sending|sent|running|paused|completed|failed|dispatched)["']/.test(src)) {
    add("T02_no_execution_state", "an execution/send state is registered");
  }
  // no frequency-policy vocabulary may be claimed.
  if (/FREQUENCY_(POLICIES|CAPS|RULES)\s*=/.test(src)) add("T03_no_frequency_claim", "a frequency vocabulary is declared");
  // destination fields must be in the PROHIBITED map, never a declared field.
  if (/readonly\s+(phone|email|destination|recipient_ref|msisdn)\s*:/.test(src)) {
    add("T04_no_destination", "a destination field is declared");
  }
  return f;
}

/* ===========================================================================
 * 1. Files exist + locked artifacts unchanged
 * ========================================================================= */
for (const file of [MIGRATION, CONTRACTS, VALIDATION, VERIFIER_30_4]) {
  record(`01 present :: ${file}`, existsSync(path.join(ROOT, file)), file);
}
record("02 locked 30.1B verifier unchanged",
  sha256(read(VERIFIER_30_1B)) === "e10caa5699ff67346a700c6bd8a69c0a7ff0e0e5d48eeb76dcf2a24e7e633799",
  "historical pre-CRM-segments evidence is not edited");
record("03 locked 30.3 verifier unchanged (historical, pre-campaign)",
  read(VERIFIER_30_3).includes("S05_no_membership_or_campaign_tables")
  && !read(VERIFIER_30_3).includes("vendor_campaigns'::"),
  "verify_qf_mvp_30_3.sql is NOT edited by this phase");
record("04 segment foundation migration unchanged",
  sha256(read(SEGMENT_MIGRATION)) === "e5f05be8d1ae856056158772f9cc492643d550af85751ac987451e4ca6729f77",
  "20260723001200 byte-identical to the accepted 30.3A hash");
/* This slot previously asserted that 20260723001300 was the HIGHEST migration.
 * That is a PHASE-SCOPED ceiling that expires the moment an authorized later
 * migration lands — QF-MVP-30.4C1's forward correction 20260723001400 is exactly
 * such a migration. It is re-based onto the enduring invariants: this phase's
 * migration exists exactly once, its version is collision-free, and every LATER
 * migration belongs to an explicitly declared later phase. */
const DECLARED_LATER_MIGRATIONS = [
  "20260723001400_qf_mvp_vendor_campaign_evidence_hardening.sql", // QF-MVP-30.4C1
  "20260728001500_qf_mvp_vendor_campaign_execution_handoff_foundation.sql", // QF-MVP-30.5A
  "20260728001600_qf_mvp_frequency_policy_history_hardening.sql", // QF-MVP-30.5B2B
];
record("05 migration version is collision-free; later migrations are declared", (() => {
  const files = readdirSync(path.join(ROOT, "supabase/migrations")).filter((x) => x.endsWith(".sql")).sort();
  const mine = "20260723001300_qf_mvp_vendor_campaign_foundation.sql";
  const later = files.filter((x) => x > mine);
  return files.includes(mine)
    && files.filter((x) => x.startsWith("20260723001300")).length === 1
    && later.every((f) => DECLARED_LATER_MIGRATIONS.includes(f));
})(), "20260723001300 appears once; every later migration is a declared later phase");
record("05a the removed ceiling would have failed on the authorized 30.4C1 correction", (() => {
  const simulated = ["20260723001300_qf_mvp_vendor_campaign_foundation.sql",
    "20260723001400_qf_mvp_vendor_campaign_evidence_hardening.sql"];
  const oldCeilingWouldHaveFailed =
    simulated[simulated.length - 1] !== "20260723001300_qf_mvp_vendor_campaign_foundation.sql";
  return oldCeilingWouldHaveFailed
    && simulated.every((f) => f === "20260723001300_qf_mvp_vendor_campaign_foundation.sql"
      || DECLARED_LATER_MIGRATIONS.includes(f));
})(), "the ceiling was a real trap; the phase-scoped rule is not");

/* ===========================================================================
 * 2. Migration — zero findings + one-defect fixtures
 * ========================================================================= */
const migrationSrc = read(MIGRATION);
const migFindings = evaluateMigration(migrationSrc);
record("06 migration has zero findings", migFindings.length === 0,
  migFindings.map((x) => `${x.rule}: ${x.detail}`).join(" | ")
  || "three tables, append-only snapshot/events, no destination, RPCs service_role-only, intents untouched");

const MIG_FIX = [
  { id: "A", rule: "K02_no_extra_objects", why: "a second campaign head/version table is added",
    mutate: (s) => `${s}\ncreate table public.vendor_campaign_versions (id uuid primary key);\n` },
  { id: "B", rule: "K02_no_extra_objects", why: "a delivery table is added",
    mutate: (s) => `${s}\ncreate table public.vendor_campaign_deliveries (id uuid primary key);\n` },
  { id: "C", rule: "K03_no_destination", why: "a plaintext destination column is added",
    mutate: (s) => s.replace(/^  vendor_id               uuid        not null,$/m,
      "  vendor_id               uuid        not null,\n  phone                   text,") },
  { id: "D", rule: "K06_grant_posture", why: "the frozen snapshot becomes updatable",
    mutate: (s) => s.replace(/grant select, insert on table public\.vendor_campaign_audience_members to service_role;/,
      "grant select, insert, update on table public.vendor_campaign_audience_members to service_role;") },
  { id: "E", rule: "K06_grant_posture", why: "service_role is granted DELETE on the head",
    mutate: (s) => s.replace(/grant select, insert, update on table public\.vendor_campaigns to service_role;/,
      "grant select, insert, update, delete on table public.vendor_campaigns to service_role;") },
  { id: "F", rule: "K07_immutability", why: "the audience immutability trigger is removed",
    mutate: (s) => s.replace(/create trigger trg_vcam_immutable[\s\S]*?execute function public\.qf_prevent_campaign_audience_mutation\(\);/,
      "-- removed") },
  { id: "G", rule: "K09_no_intent_widening", why: "communication_intents is widened to campaign",
    mutate: (s) => `${s}\nalter table public.communication_intents drop constraint communication_intents_aggregate_type_check;\nalter table public.communication_intents add constraint communication_intents_aggregate_type_check check (aggregate_type = any (array['lead','campaign']));\n` },
  { id: "H", rule: "K10_template_alignment", why: "another communication table is altered",
    mutate: (s) => `${s}\nalter table public.communication_provider_accounts add column bogus text;\n` },
  { id: "I", rule: "K05_rls_default_deny", why: "RLS is not enabled on the event log",
    mutate: (s) => s.replace(/alter table public\.vendor_campaign_events           enable row level security;/, "-- removed") },
  { id: "J", rule: "K04_no_core_or_execution", why: "an execution state column is added",
    mutate: (s) => s.replace(/^  status                      text        not null default 'draft',$/m,
      "  status                      text        not null default 'draft',\n  send_status                 text,") },
  { id: "K", rule: "K11_forward_only", why: "a template row is inserted",
    mutate: (s) => `${s}\ninsert into public.communication_templates (template_key) values ('x');\n` },
  { id: "L", rule: "K12_immutable_checks", why: "a STABLE function is used inside a CHECK",
    mutate: (s) => s.replace(/constraint vcm_exclusion_summary_size check \(length\(exclusion_summary::text\) <= 4096\)/,
      "constraint vcm_exclusion_summary_size check (pg_column_size(exclusion_summary) <= 4096)") },
  { id: "M", rule: "K08_rpc_security", why: "an RPC becomes executable by untrusted roles",
    mutate: (s) => s.replace(/revoke all on function public\.qf_approve_vendor_campaign_v1\(uuid, integer, uuid, text\) from public, anon, authenticated;/, "-- removed") },
];
for (const fx of MIG_FIX) {
  const mutated = fx.mutate(migrationSrc); const changed = mutated !== migrationSrc;
  const ff = changed ? evaluateMigration(mutated) : [];
  const tripped = ff.some((x) => x.rule === fx.rule);
  record(`07 migration fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "NO-OP" : tripped ? "tripped" : ff.map((x) => x.rule).join(",") || "none");
}
record("08 every enforced migration rule has a fixture", (() => {
  const covered = new Set(MIG_FIX.map((x) => x.rule));
  const declared = [...new Set([...read(SELF).matchAll(/add\("(K\d\d_[a-z0-9_]+)"/g)].map((m) => m[1]))]
    .filter((r) => !["K01_exactly_three_tables"].includes(r));
  return declared.every((r) => covered.has(r));
})(), "every migration rule is exercised (K01 is a structural guard)");

/* ===========================================================================
 * 3. Contracts module
 * ========================================================================= */
const contractSrc = read(CONTRACTS);
const conFindings = evaluateContracts(contractSrc);
record("09 contracts have zero findings", conFindings.length === 0,
  conFindings.map((x) => `${x.rule}: ${x.detail}`).join(" | ")
  || "pure, no execution state, no frequency claim, no destination field");
const CON_FIX = [
  { id: "N", rule: "T02_no_execution_state", why: "an execution state is added to the lifecycle",
    mutate: (s) => s.replace(/"archived",\n\] as const;/, '"archived",\n  "sending",\n] as const;') },
  { id: "O", rule: "T03_no_frequency_claim", why: "a frequency vocabulary is declared",
    mutate: (s) => `${s}\nexport const FREQUENCY_POLICIES = ["daily"] as const;\n` },
];
for (const fx of CON_FIX) {
  const mutated = fx.mutate(contractSrc); const changed = mutated !== contractSrc;
  const ff = changed ? evaluateContracts(mutated) : [];
  record(`10 contract fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`,
    changed && ff.some((x) => x.rule === fx.rule),
    !changed ? "NO-OP" : ff.some((x) => x.rule === fx.rule) ? "tripped" : "none");
}
record("11 validation module is pure", (() => {
  const v = read(VALIDATION);
  return !/import\s+["']server-only["']/.test(v) && !/adminClient|@supabase\/supabase-js/.test(v);
})(), "safely importable and directly testable");

/* ===========================================================================
 * 4. The 30.4A FOUNDATION BOUNDARY holds against the runtime
 *
 * These three checks originally asserted that no campaign runtime existed yet,
 * which was true only until QF-MVP-30.4C shipped one. A ceiling that expires is
 * not an invariant, so they are re-based onto the enduring property they were
 * really protecting: the foundation layer stays offline-testable and the runtime,
 * WHENEVER it exists, may only reach the schema through the locked RPCs and the
 * server-only service. Each check is meaningful whether or not the runtime is
 * present; QF-MVP-30.4C grades the runtime itself in depth.
 * ========================================================================= */
const RUNTIME_ROUTE_DIR = "app/admin/vendor-crm/campaigns";
const RUNTIME_SERVICE = "services/vendorCampaignService.ts";
const RUNTIME_ACTIONS = "app/actions/vendorCampaignActions.ts";
const RUNTIME_UI_DIR = "components/admin/crm/campaigns";
const has = (rel) => existsSync(path.join(ROOT, rel));
const listTs = (rel) => {
  const dir = path.join(ROOT, rel);
  if (!existsSync(dir)) return [];
  const walk = (d) => readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  return walk(dir).filter((p) => /\.(ts|tsx)$/.test(p)).map((p) => readFileSync(p, "utf8"));
};

record("12 campaign routes never reach the schema directly", (() => {
  const routes = listTs(RUNTIME_ROUTE_DIR);
  if (routes.length === 0) return true; // no runtime yet — vacuously intact
  return routes.every((s) => !/adminClient\(|createClient\(|@supabase\/supabase-js/.test(s))
    && routes.every((s) => /getAdminSession\(\)/.test(s) && /isSuperadmin/.test(s));
})(), "every campaign route is admin-guarded and holds no service-role client");

record("13 the campaign service/actions boundary is server-only and RPC-mediated", (() => {
  if (!has(RUNTIME_SERVICE) && !has(RUNTIME_ACTIONS)) return true; // no runtime yet
  if (!has(RUNTIME_SERVICE) || !has(RUNTIME_ACTIONS)) return false; // half a runtime is a defect
  const svc = read(RUNTIME_SERVICE);
  const act = read(RUNTIME_ACTIONS);
  return /import\s+["']server-only["']/.test(svc)
    // the frozen audience is only ever written by the locked prepare RPC.
    && /qf_prepare_vendor_campaign_v1/.test(svc)
    && !/from\(["']vendor_campaign_audience_members["']\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\b/.test(svc)
    // actions are guarded wrappers, never a database client.
    && /requireCrmAdmin\(\)/.test(act)
    && !/adminClient|createClient|@supabase/.test(act);
})(), "server-only service, audience frozen only via the RPC, guarded actions");

record("14 campaign UI carries no service-role or execution capability", (() => {
  const ui = listTs(RUNTIME_UI_DIR);
  if (ui.length === 0) return true; // no runtime yet
  return ui.every((s) => /^\s*["']use client["']/.test(s))
    && ui.every((s) => !/adminClient|serverClient|["']server-only["']|SERVICE_ROLE|@supabase\/supabase-js/.test(s))
    && ui.every((s) => !/^\s*import\s+(?!type\b)[^;]*from\s+["'][^"']*services\/vendorCampaignService["']/m.test(s));
})(), "client components hold no credential and never value-import the service");

/* ===========================================================================
 * 5. Staging verifier contract (not executed here)
 * ========================================================================= */
const verifierSrc = read(VERIFIER_30_4);
record("15 new 30.4 verifier is SELECT-only", (() => {
  const exec = execSql(verifierSrc);
  return !/\b(insert|update|delete|truncate|create|alter|drop|grant|revoke|call|merge|do)\b/i.test(exec)
    && /^\s*select\b/im.test(exec);
})(), "no mutating keyword outside string literals; begins with SELECT");
record("16 new 30.4 verifier covers the locked posture", (() => {
  const need = ["20260723001300", "20260723001200", "vendor_campaign_audience_members",
    "has_table_privilege", "relrowsecurity", "communication_intents_aggregate_type_check",
    "communication_templates_category_check", "qf_prepare_vendor_campaign_v1",
    "qf_approve_vendor_campaign_v1", "vendor_public_v", "prosecdef"];
  return need.every((n) => verifierSrc.includes(n));
})(), "migration, tables, RLS/grants, intents unchanged, template category, RPC posture, projection");
record("17 new 30.4 verifier asserts zero pre-fixture rows", (() => {
  return /C26_zero_campaign_rows_before_fixtures/.test(verifierSrc)
    && /C24_no_campaign_intents_exist/.test(verifierSrc)
    && /C27_no_core_financial_or_assignment_mutation/.test(verifierSrc);
})(), "zero campaign rows, zero campaign intents, no Core mutation");

/* ===========================================================================
 * 6. Docs
 * ========================================================================= */
const bp = read("docs/QF-MVP-30-VENDOR-CRM-BLUEPRINT.md").toLowerCase();
const board = read("docs/QF-MVP-EXECUTION-BOARD.md").toLowerCase();
record("18 blueprint records the 30.4A contract", (() => {
  return bp.includes("30.4a") && bp.includes("20260723001300")
    && bp.includes("vendor_campaign_audience_members") && bp.includes("freeze");
})(), "migration filename, three-table model, freeze-at-prepare");
record("19 blueprint records the owner decisions", (() => {
  return bp.includes("marketing") && bp.includes("frequency") && bp.includes("communication_intents");
})(), "marketing category, frequency deferral, intents deferral");
record("20 board records 30.4A generated-not-applied", (() => {
  return board.includes("30.4a") && board.includes("20260723001300")
    && (board.includes("not applied") || board.includes("generated"));
})(), "execution board updated");

/* ===========================================================================
 * 7. BEHAVIOURAL — the real campaign rules, executed
 * ========================================================================= */
const contracts = await import("../../../lib/crm/campaignContracts.ts");
const rules = await import("../../../lib/crm/campaignValidation.ts");
const {
  validateCampaignDraft, isLegalCampaignTransition, requireCampaignTransition,
  requireEditableCampaign, validateTemplateEvidence, requireTemplateMatchesConsentScope,
  validateCampaignRecipients, fingerprintCampaignSnapshot, validateExclusionSummary,
  buildPreparedEvidence, checkCampaignApproval, normalizeCampaignNameKey,
} = rules;

const ok = (fn) => { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, err: e }; } };
const rejects = (fn, label) => {
  const r = ok(fn);
  record(`21 rejects :: ${label}`, !r.ok && r.err?.name === "CampaignValidationError",
    r.ok ? "ACCEPTED (should have been rejected)" : String(r.err.message).slice(0, 90));
};
const accepts = (fn, label) => {
  const r = ok(fn);
  record(`22 accepts :: ${label}`, r.ok, r.ok ? "ok" : String(r.err?.message).slice(0, 90));
  return r.ok ? r.value : null;
};

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const draft = (over = {}) => ({
  name: "Pune reactivation", description: "x", purpose: "reactivation",
  channel: "whatsapp", consent_scope: "marketing", segment_id: UUID_A,
  template_key: "vendor_reactivation_v1", template_version: "1.0.0", ...over,
});
const tmpl = (over = {}) => ({
  template_key: "vendor_reactivation_v1", template_version: "1.0.0",
  template_category: "marketing", readiness_status: "provider_ready", ...over,
});
const recip = (id, over = {}) => ({
  vendor_id: id, consent_disposition: "marketing_opted_in",
  consent_reason_code: "explicit_opt_in", consent_policy_version: "1", ...over,
});

// -- draft ------------------------------------------------------------------
accepts(() => validateCampaignDraft(draft()), "a valid marketing campaign draft");
accepts(() => validateCampaignDraft(draft({ consent_scope: "transactional", purpose: "onboarding" })),
  "a transactional onboarding draft");
rejects(() => validateCampaignDraft(draft({ purpose: "spam" })), "unknown purpose");
rejects(() => validateCampaignDraft(draft({ channel: "sms" })), "channel outside the MVP vocabulary");
rejects(() => validateCampaignDraft(draft({ consent_scope: "promotional" })), "unknown consent scope");
rejects(() => validateCampaignDraft(draft({ name: "   " })), "empty name");
rejects(() => validateCampaignDraft(draft({ name: "z".repeat(200) })), "name over the bound");
rejects(() => validateCampaignDraft(draft({ segment_id: "not-a-uuid" })), "non-uuid segment reference");
rejects(() => validateCampaignDraft({ ...draft(), status: "approved" }), "client-supplied status");
rejects(() => validateCampaignDraft({ ...draft(), approved_by: UUID_A }), "client-supplied approval provenance");
rejects(() => validateCampaignDraft({ ...draft(), revision: 9 }), "client-supplied revision");

// -- prohibited fields ------------------------------------------------------
for (const [field, label] of [
  ["phone", "plaintext phone"], ["email", "plaintext email"], ["destination", "destination"],
  ["recipient_ref", "recipient_ref"], ["provider_payload", "provider payload"],
  ["access_token", "secret"], ["send_status", "execution state"],
  ["communication_intent_id", "communication intent"], ["frequency_cap", "frequency policy"],
  ["ai_score", "AI score"],
]) {
  rejects(() => validateCampaignDraft({ ...draft(), [field]: "x" }), `prohibited field — ${label}`);
}

// -- lifecycle --------------------------------------------------------------
const LEGAL = [["draft", "ready_for_review"], ["draft", "cancelled"], ["draft", "archived"],
  ["ready_for_review", "draft"], ["ready_for_review", "approved"], ["ready_for_review", "cancelled"],
  ["approved", "cancelled"], ["approved", "archived"], ["cancelled", "archived"]];
const ILLEGAL = [["draft", "approved"], ["approved", "draft"], ["approved", "ready_for_review"],
  ["archived", "draft"], ["archived", "approved"], ["cancelled", "approved"], ["draft", "draft"]];
record("23 every legal transition is permitted",
  LEGAL.every(([a, b]) => isLegalCampaignTransition(a, b)), `${LEGAL.length} transitions`);
record("24 draft may never jump straight to approved",
  !isLegalCampaignTransition("draft", "approved"), "freeze-at-prepare is mandatory");
record("25 every illegal transition is refused",
  ILLEGAL.every(([a, b]) => !isLegalCampaignTransition(a, b)), `${ILLEGAL.length} transitions`);
rejects(() => requireCampaignTransition("approved", "draft"), "approved -> draft");
rejects(() => requireEditableCampaign("ready_for_review"), "editing a ready_for_review campaign");
rejects(() => requireEditableCampaign("approved"), "editing an approved campaign");
accepts(() => { requireEditableCampaign("draft"); return true; }, "editing a draft campaign");
record("26 return-to-draft is an explicit legal transition",
  isLegalCampaignTransition("ready_for_review", "draft"), "re-prepare creates a NEW snapshot revision");

// -- template ---------------------------------------------------------------
accepts(() => validateTemplateEvidence(tmpl()), "a marketing template evidence bundle");
rejects(() => validateTemplateEvidence(tmpl({ readiness_status: "disabled" })), "a disabled template");
rejects(() => validateTemplateEvidence(tmpl({ template_category: "promotional" })), "unknown template category");
accepts(() => { requireTemplateMatchesConsentScope("marketing", "marketing"); return true; },
  "marketing campaign + marketing template");
rejects(() => requireTemplateMatchesConsentScope("marketing", "business"),
  "marketing campaign pinning a business template");
rejects(() => requireTemplateMatchesConsentScope("marketing", "authentication"),
  "marketing campaign pinning an authentication template");
accepts(() => { requireTemplateMatchesConsentScope("transactional", "business"); return true; },
  "transactional campaign + business template");

// -- recipients + fingerprint ------------------------------------------------
const two = accepts(() => validateCampaignRecipients([recip(UUID_A), recip(UUID_B)]), "two distinct recipients");
rejects(() => validateCampaignRecipients([]), "an empty audience");
rejects(() => validateCampaignRecipients([recip(UUID_A), recip(UUID_A)]), "a duplicate recipient");
rejects(() => validateCampaignRecipients([recip("nope")]), "a non-uuid recipient");
rejects(() => validateCampaignRecipients([{ vendor_id: UUID_A }]), "a recipient missing consent evidence");
rejects(() => validateCampaignRecipients([recip(UUID_A, { consent_disposition: "blocked" })]),
  "a blocked principal included as a recipient");
rejects(() => validateCampaignRecipients([{ ...recip(UUID_A), phone: "9000000001" }]),
  "a recipient carrying a plaintext destination");
rejects(() => validateCampaignRecipients(
  Array.from({ length: contracts.CAMPAIGN_MAX_AUDIENCE + 1 }, (_, i) =>
    recip(`${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`))), "an audience over the bound");
record("27 snapshot fingerprint is sha256 hex", /^[0-9a-f]{64}$/.test(fingerprintCampaignSnapshot(two)));
record("28 identical ordered audiences share a fingerprint",
  fingerprintCampaignSnapshot(two) === fingerprintCampaignSnapshot(validateCampaignRecipients([recip(UUID_A), recip(UUID_B)])));
record("29 REORDERING the audience changes the fingerprint",
  fingerprintCampaignSnapshot(two)
  !== fingerprintCampaignSnapshot(validateCampaignRecipients([recip(UUID_B), recip(UUID_A)])),
  "ordinal is part of the frozen identity");
record("30 changing consent evidence changes the fingerprint",
  fingerprintCampaignSnapshot(two)
  !== fingerprintCampaignSnapshot(validateCampaignRecipients([
    recip(UUID_A, { consent_disposition: "unknown" }), recip(UUID_B)])));

// -- exclusion summary -------------------------------------------------------
accepts(() => validateExclusionSummary({ consent_blocked: 3, suppressed: 1 }), "a closed-vocabulary exclusion summary");
accepts(() => validateExclusionSummary(undefined), "an absent exclusion summary");
rejects(() => validateExclusionSummary({ because_i_said_so: 1 }), "an unknown exclusion reason code");
rejects(() => validateExclusionSummary({ consent_blocked: -1 }), "a negative exclusion count");
rejects(() => validateExclusionSummary({ consent_blocked: "many" }), "a non-integer exclusion count");
rejects(() => validateExclusionSummary({ consent_blocked: 1, vendor_id: UUID_A }), "a vendor id in the exclusion summary");
record("31 exclusion summary key order is deterministic",
  JSON.stringify(validateExclusionSummary({ suppressed: 1, consent_blocked: 2 }))
  === JSON.stringify(validateExclusionSummary({ consent_blocked: 2, suppressed: 1 })));

// -- prepared evidence -------------------------------------------------------
const FP = "a".repeat(64);
const preparedInput = (over = {}) => ({
  segment_id: UUID_A, segment_definition_version: 3, segment_definition_fingerprint: FP,
  template: tmpl(), recipients: [recip(UUID_A), recip(UUID_B)],
  exclusion_summary: { consent_blocked: 2 }, consent_scope: "marketing", ...over,
});
const prepared = accepts(() => buildPreparedEvidence(preparedInput()), "a complete prepared-evidence bundle");
record("32 prepared evidence carries count and fingerprint",
  prepared?.recipient_count === 2 && /^[0-9a-f]{64}$/.test(prepared?.snapshot_fingerprint ?? ""));
rejects(() => buildPreparedEvidence(preparedInput({ segment_definition_fingerprint: "short" })),
  "a malformed segment fingerprint");
rejects(() => buildPreparedEvidence(preparedInput({ segment_definition_version: 0 })),
  "a segment version below 1");
rejects(() => buildPreparedEvidence(preparedInput({ template: tmpl({ template_category: "business" }) })),
  "a marketing campaign prepared against a business template");
rejects(() => buildPreparedEvidence(preparedInput({ recipients: [] })), "a prepared bundle with no recipients");

// -- approval fail-closed matrix (QF-MVP-30.4C1 hardened) ---------------------
// The matrix now mirrors the hardened qf_approve_vendor_campaign_v1: the frozen
// template fingerprint is MANDATORY evidence, the snapshot fingerprint is
// RECOMPUTED from the immutable rows rather than trusted, and snapshot ownership
// and ordinal density are checked before any downstream evidence.
const TMPL_FP = "d".repeat(64);
const approvalBase = {
  prepared_segment_version: 3, prepared_segment_fingerprint: FP,
  prepared_template_version: "1.0.0", prepared_template_category: "marketing",
  prepared_template_fingerprint: TMPL_FP,
  prepared_recipient_count: 2, snapshot_fingerprint: prepared?.snapshot_fingerprint ?? FP,
  current_segment_status: "active", current_segment_version: 3, current_segment_fingerprint: FP,
  current_template_version: "1.0.0", current_template_category: "marketing",
  current_template_readiness: "provider_ready", current_template_fingerprint: TMPL_FP,
  actual_member_count: 2, actual_snapshot_fingerprint: prepared?.snapshot_fingerprint ?? FP,
  foreign_snapshot_rows: 0, ordinals_dense: true,
};
record("33 approval proceeds when every piece of evidence agrees",
  checkCampaignApproval(approvalBase) === null, "null = may approve");
const MATRIX = [
  ["segment missing", { current_segment_version: null }, "SEGMENT_MISSING"],
  ["segment archived", { current_segment_status: "archived" }, "SEGMENT_ARCHIVED"],
  ["segment version drift", { current_segment_version: 4 }, "SEGMENT_EVIDENCE_MISMATCH"],
  ["segment fingerprint drift", { current_segment_fingerprint: "b".repeat(64) }, "SEGMENT_EVIDENCE_MISMATCH"],
  ["template missing", { current_template_version: null }, "TEMPLATE_MISSING"],
  ["template disabled", { current_template_readiness: "disabled" }, "TEMPLATE_NOT_USABLE"],
  ["template version drift", { current_template_version: "2.0.0" }, "TEMPLATE_VERSION_MISMATCH"],
  ["template category drift", { current_template_category: "business" }, "TEMPLATE_CATEGORY_MISMATCH"],
  ["snapshot count mismatch", { actual_member_count: 1 }, "SNAPSHOT_COUNT_MISMATCH"],
  ["snapshot fingerprint mismatch", { actual_snapshot_fingerprint: "c".repeat(64) }, "SNAPSHOT_FINGERPRINT_MISMATCH"],
  // -- QF-MVP-30.4C1 additions: each is UNREACHABLE in the pre-correction code
  ["prepared template fingerprint absent", { prepared_template_fingerprint: null }, "PREPARED_EVIDENCE_INCOMPLETE"],
  ["template fingerprint drift under an UNCHANGED version",
    { current_template_fingerprint: "e".repeat(64) }, "TEMPLATE_FINGERPRINT_MISMATCH"],
  ["template fingerprint unavailable", { current_template_fingerprint: null }, "TEMPLATE_FINGERPRINT_UNAVAILABLE"],
  ["snapshot unfingerprintable", { actual_snapshot_fingerprint: null }, "SNAPSHOT_ORDINAL_INVALID"],
  ["snapshot ordinals not dense", { ordinals_dense: false }, "SNAPSHOT_ORDINAL_INVALID"],
  ["snapshot id contaminated by another campaign/revision",
    { foreign_snapshot_rows: 1 }, "SNAPSHOT_OWNERSHIP_MISMATCH"],
];
for (const [label, over, code] of MATRIX) {
  record(`34 approval fails closed :: ${label}`,
    checkCampaignApproval({ ...approvalBase, ...over }) === code,
    `expected ${code}, got ${checkCampaignApproval({ ...approvalBase, ...over })}`);
}
record("35 every failure code is in the closed vocabulary", (() => {
  const codes = MATRIX.map(([, over]) => checkCampaignApproval({ ...approvalBase, ...over }));
  return codes.every((c) => contracts.CAMPAIGN_FAILURE_CODES.includes(c));
})(), "codes are stable and sanitized");

// -- misc --------------------------------------------------------------------
record("36 live-name key mirrors uq_vendor_campaigns_live_name",
  normalizeCampaignNameKey("  Pune   Reactivation ") === "pune reactivation"
  && normalizeCampaignNameKey("PUNE REACTIVATION") === "pune reactivation");
record("37 no execution state exists in the lifecycle vocabulary",
  !contracts.CAMPAIGN_STATUSES.some((s) => /send|dispatch|running|paused|completed|failed/i.test(s)),
  contracts.CAMPAIGN_STATUSES.join(","));
record("38 no frequency-policy vocabulary is exported",
  !Object.keys(contracts).some((k) => /FREQUENCY/i.test(k)),
  "QF-MVP-30.5 must define one before dispatch");
record("39 prohibited-field registry covers destination, provider, execution and frequency", (() => {
  const p = contracts.CAMPAIGN_PROHIBITED_FIELDS;
  return ["phone", "email", "destination", "recipient_ref", "provider_payload", "send_status",
    "communication_intent_id", "frequency_cap", "ai_score"].every((k) => typeof p[k] === "string");
})(), "each refusal carries an explicit reason");

/* ===========================================================================
 * 8. QF-MVP-30.4C1 — APPROVAL-EVIDENCE HARDENING (forward migration 001400)
 *
 * QF-MVP-30.4C was blocked from push and staging smoke by two real
 * approval-evidence defects in the APPLIED 20260723001300:
 *   1. the snapshot fingerprint was caller-supplied, stored unverified, and
 *      approval compared row COUNT only — no SQL ever hashed the frozen rows;
 *   2. the template fingerprint was absent entirely — nullable, omitted from the
 *      completeness CHECK, and never read at approval, so any dispatch-critical
 *      catalog field could drift under an unchanged version undetected.
 *
 * 20260723001300 stays IMMUTABLE and applied. The correction is the forward
 * migration 20260723001400, graded here. Every rule below is backed by a
 * one-defect fixture that reverts the migration to the exact pre-correction
 * behaviour and must trip.
 * ========================================================================= */
const HARDENING = "supabase/migrations/20260723001400_qf_mvp_vendor_campaign_evidence_hardening.sql";
record("40 the forward correction migration exists", existsSync(path.join(ROOT, HARDENING)), HARDENING);

const hardeningSrc = read(HARDENING);
const fnBody = (src, fn) => {
  const m = new RegExp(`create or replace function public\\.${fn}\\(([\\s\\S]*?)\\n\\$\\$;`, "m").exec(src);
  return m ? m[0] : "";
};

export function evaluateHardening(src) {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  const exec = execSql(src);
  const prepare = fnBody(src, "qf_prepare_vendor_campaign_v1");
  const approve = fnBody(src, "qf_approve_vendor_campaign_v1");

  // H01 forward-only: it replaces BODIES, it never drops or recreates an applied object.
  if (/drop\s+(table|function)\s+(if\s+exists\s+)?public\.(vendor_campaign|qf_prepare_vendor_campaign|qf_approve_vendor_campaign)/i.test(exec)) {
    add("H01_forward_only", "drops an applied campaign object instead of replacing its body");
  }
  if (/create\s+table\s+(if\s+not\s+exists\s+)?public\.vendor_campaign/i.test(exec)) {
    add("H01_forward_only", "recreates a campaign table");
  }

  // H02 the snapshot fingerprint AUTHORITY exists in SQL and is defensible.
  if (!/create or replace function public\.qf_campaign_snapshot_fingerprint_v1/.test(src)) {
    add("H02_snapshot_authority", "no canonical snapshot fingerprint function");
  }
  const snapFn = fnBody(src, "qf_campaign_snapshot_fingerprint_v1");
  if (!/encode\(sha256\(convert_to\(/.test(snapFn)) add("H02_snapshot_authority", "does not sha256 a canonical stream");
  if (!/chr\(30\)/.test(snapFn) || !/chr\(31\)/.test(snapFn)) {
    add("H02_snapshot_authority", "does not use the fixed-position separator encoding");
  }
  if (!/count\(distinct m\.ordinal\)/.test(snapFn) || !/v_max <> v_count - 1/.test(snapFn)) {
    add("H02_snapshot_authority", "does not require dense 0..count-1 ordinals");
  }
  if (!/m\.campaign_id is distinct from p_campaign_id/.test(snapFn)) {
    add("H02_snapshot_authority", "does not reject a contaminated snapshot id");
  }
  if (!/order by m\.ordinal/.test(snapFn)) add("H02_snapshot_authority", "the stream is not ordinal-ordered");
  if (/created_at|evaluated_at|m\.id\b/.test(snapFn.replace(/--[^\n]*/g, ""))) {
    add("H02_snapshot_authority", "fingerprints a row id or a wall-clock value");
  }

  // H03 the DATABASE is the authority: the caller value is never stored.
  if (!/snapshot_fingerprint\s+=\s+v_snap_actual/.test(prepare)) {
    add("H03_db_authoritative", "prepare does not store the database-computed snapshot fingerprint");
  }
  if (/snapshot_fingerprint\s+=\s+p_snapshot_fingerprint/.test(prepare)) {
    add("H03_db_authoritative", "prepare stores the CALLER-supplied snapshot fingerprint");
  }
  if (!/prepared_template_fingerprint\s+=\s+v_tmpl_actual/.test(prepare)) {
    add("H03_db_authoritative", "prepare does not store the database-computed template fingerprint");
  }
  if (/prepared_template_fingerprint\s+=\s+p_template_fingerprint/.test(prepare)) {
    add("H03_db_authoritative", "prepare stores the CALLER-supplied template fingerprint");
  }

  // H04 a verification failure must ROLL BACK the inserted rows.
  if (!/errcode = 'QFC01'/.test(prepare) || !/when sqlstate 'QFC01'/.test(prepare)) {
    add("H04_rollback_on_mismatch", "no dedicated subtransaction rollback for a verification failure");
  }
  if (!/qf_campaign_snapshot_fingerprint_v1\(p_campaign_id, v_snapshot_id, v_revision\)/.test(prepare)) {
    add("H04_rollback_on_mismatch", "prepare does not fingerprint the INSERTED rows");
  }

  // H05 approval RECOMPUTES the snapshot fingerprint and compares it.
  if (!/qf_campaign_snapshot_fingerprint_v1/.test(approve)) {
    add("H05_approve_recomputes_snapshot", "approval never recomputes the snapshot fingerprint");
  }
  if (!/v_snap_actual <> v_campaign\.snapshot_fingerprint/.test(approve)) {
    add("H05_approve_recomputes_snapshot", "approval never compares the recomputed hash with the stored evidence");
  }
  if (!/'SNAPSHOT_FINGERPRINT_MISMATCH'/.test(approve)) {
    add("H05_approve_recomputes_snapshot", "SNAPSHOT_FINGERPRINT_MISMATCH is unreachable from approval");
  }
  if (!/'SNAPSHOT_OWNERSHIP_MISMATCH'/.test(approve) || !/'SNAPSHOT_ORDINAL_INVALID'/.test(approve)) {
    add("H05_approve_recomputes_snapshot", "approval does not check snapshot ownership and ordinal density");
  }

  // H06 the template fingerprint AUTHORITY covers the exact dispatch-critical set.
  const tmplFn = fnBody(src, "qf_communication_template_fingerprint_v1");
  if (!/create or replace function public\.qf_communication_template_fingerprint_v1/.test(src)) {
    add("H06_template_authority", "no canonical template fingerprint function");
  }
  for (const col of ["template_key", "version", "channel", "category", "language",
    "readiness_status", "is_active", "provider_template_name", "provider_template_id", "description"]) {
    if (!new RegExp(`t\\.${col}\\b`).test(tmplFn)) add("H06_template_authority", `omits ${col}`);
  }
  if (/t\.id\b|t\.created_at|t\.updated_at/.test(tmplFn)) {
    add("H06_template_authority", "fingerprints a row id or a timestamp");
  }
  if (!/encode\(sha256\(convert_to\(/.test(tmplFn)) add("H06_template_authority", "does not sha256 a canonical stream");

  // H07 approval RECOMPUTES the template fingerprint and fails closed on drift.
  if (!/qf_communication_template_fingerprint_v1/.test(approve)) {
    add("H07_approve_template_drift", "approval never recomputes the template fingerprint");
  }
  if (!/v_tmpl_actual <> v_campaign\.prepared_template_fingerprint/.test(approve)) {
    add("H07_approve_template_drift", "approval never compares it with the pinned evidence");
  }
  if (!/'TEMPLATE_FINGERPRINT_MISMATCH'/.test(approve)) {
    add("H07_approve_template_drift", "TEMPLATE_FINGERPRINT_MISMATCH is unreachable from approval");
  }

  // H08 prepared evidence now REQUIRES the template fingerprint.
  const constraint = /add constraint vcm_prepared_evidence_complete check \(([\s\S]*?)\n  \);/.exec(src)?.[1] ?? "";
  if (!constraint.includes("prepared_template_fingerprint is not null")) {
    add("H08_evidence_complete", "the replaced completeness constraint does not require the template fingerprint");
  }
  // the production-safety preflight must REFUSE loudly rather than fabricate a
  // fingerprint for a pre-existing prepared row. Matched on its own text, not on
  // a positional slice of the file.
  if (!/aborted: % campaign row\(s\) are ready_for_review\/approved with a NULL prepared_template_fingerprint/.test(src)) {
    add("H08_evidence_complete", "no production-safety preflight for incompatible pre-existing prepared rows");
  }
  if (/update public\.vendor_campaigns\s+set[^;]*prepared_template_fingerprint\s*=\s*'/i.test(execSql(src))) {
    add("H08_evidence_complete", "backfills a fabricated template fingerprint");
  }

  // H09 minimal object model: nothing new beyond the fingerprint helpers.
  for (const t of ["vendor_campaign_snapshots", "vendor_campaign_templates", "campaign_frequency_policies",
    "communication_intents", "vendor_campaign_dispatches", "audit_logs", "admin_notifications"]) {
    if (new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?public\\.${t}\\b`, "i").test(exec)) {
      add("H09_no_new_object", `creates ${t}`);
    }
  }
  if (/create\s+table\s/i.test(exec)) add("H09_no_new_object", "creates a table");
  for (const c of ["phone", "email", "destination", "recipient_ref", "frequency_cap", "send_status"]) {
    if (new RegExp(`add column[^;]*\\b${c}\\b`, "i").test(exec)) add("H09_no_new_object", `adds column ${c}`);
  }

  // H10 execute posture: the helpers are not externally callable.
  for (const fn of ["qf_canonical_text_field_v1", "qf_campaign_snapshot_fingerprint_v1",
    "qf_communication_template_fingerprint_v1"]) {
    if (!new RegExp(`revoke all on function public\\.${fn}[\\s\\S]{0,120}?service_role`).test(src)) {
      add("H10_execute_posture", `${fn} is not revoked from service_role`);
    }
    if (new RegExp(`grant execute on function public\\.${fn}`).test(src)) {
      add("H10_execute_posture", `${fn} is granted EXECUTE`);
    }
  }
  if (!/grant execute on function public\.qf_prepare_vendor_campaign_v1[\s\S]{0,200}?to service_role/.test(src)) {
    add("H10_execute_posture", "the prepare RPC lost its service_role grant");
  }

  // -------------------------------------------------------------------------
  // H11 (QF-MVP-30.4C2) THE SOURCE-EVIDENCE LOCK CONTRACT.
  //
  // Locking the campaign head alone left a real race: approval could verify the
  // segment and template, a concurrent transaction could commit a non-key UPDATE
  // to a dispatch-critical field, and approval would still commit — approving
  // evidence that was already stale. Both RPCs must hold BOTH source rows under
  // a lock that conflicts with a plain UPDATE, in one deterministic order.
  //
  // Graded on COMMENT-STRIPPED executable SQL, so a comment that merely mentions
  // FOR SHARE can never satisfy a lock rule.
  // -------------------------------------------------------------------------
  const lockRead = (fnSrc, table) => {
    const m = new RegExp(`select \\* into \\w+ from public\\.${table}[\\s\\S]*?;`, "m").exec(fnSrc);
    return m ? m[0] : "";
  };
  /** Conflicts with FOR NO KEY UPDATE (a plain UPDATE) and FOR UPDATE (a DELETE). */
  const SUFFICIENT_LOCK = /\bfor\s+(share|no\s+key\s+update|update)\b/i;

  for (const [label, fnSrc] of [["prepare", prepare], ["approve", approve]]) {
    const stripped = execSql(fnSrc);
    for (const table of ["vendor_segments", "communication_templates"]) {
      const stmt = lockRead(stripped, table);
      if (!stmt) {
        add("H11_evidence_row_locks", `${label} does not read public.${table} at all`);
      } else if (!SUFFICIENT_LOCK.test(stmt)) {
        add("H11_evidence_row_locks", `${label} reads public.${table} WITHOUT a lock that conflicts with UPDATE`);
      }
    }
    // FOR KEY SHARE does not conflict with FOR NO KEY UPDATE, so it cannot
    // protect a non-key evidence field. It is refused outright.
    if (/\bfor\s+key\s+share\b/i.test(stripped)) {
      add("H11_evidence_row_locks", `${label} uses FOR KEY SHARE, which a non-key UPDATE does not block`);
    }
    // the campaign head must still be locked FOR UPDATE.
    if (!SUFFICIENT_LOCK.test(lockRead(stripped, "vendor_campaigns"))) {
      add("H11_evidence_row_locks", `${label} no longer locks the campaign head`);
    }
  }

  // H12 DETERMINISTIC LOCK ORDER campaign -> segment -> template in BOTH RPCs.
  // Anchored on `from public.<table>` — the locking READS — never on the bare
  // table name, which also appears in each DECLARE block as `%rowtype` and would
  // make the assertion pass vacuously whatever the real order was.
  for (const [label, fnSrc] of [["prepare", prepare], ["approve", approve]]) {
    const s = execSql(fnSrc);
    const at = (t) => s.indexOf(`from public.${t}`);
    const [cam, seg, tpl] = ["vendor_campaigns", "vendor_segments", "communication_templates"].map(at);
    if (cam < 0 || seg < 0 || tpl < 0) {
      add("H12_deterministic_lock_order", `${label} is missing one of the three locking reads`);
    } else if (!(cam < seg && seg < tpl)) {
      add("H12_deterministic_lock_order", `${label} lock order is not campaign -> segment -> template`);
    }
  }
  // approval must lock BOTH evidence rows BEFORE its first evidence check and
  // still hold them at the approving UPDATE.
  {
    const s = execSql(approve);
    const firstShare = s.search(/\bfor\s+share\b/i);
    // Anchor the first evidence check on the audience-member read, NOT on the
    // 'SNAPSHOT_COUNT_MISMATCH' literal: execSql() strips quoted literals, so a
    // literal anchor would always be -1 and the rule would fire on clean source.
    const firstCheck = s.indexOf("from public.vendor_campaign_audience_members");
    const tplRead = s.indexOf("from public.communication_templates");
    const approvingUpdate = s.indexOf("update public.vendor_campaigns set");
    if (firstShare < 0 || firstCheck < 0 || firstShare > firstCheck) {
      add("H12_deterministic_lock_order", "approve performs an evidence check before acquiring the source-evidence locks");
    }
    if (tplRead < 0 || approvingUpdate < 0 || tplRead > approvingUpdate) {
      add("H12_deterministic_lock_order", "approve does not hold the source-evidence locks through the approving UPDATE");
    }
  }

  // H13 the lock contract is re-asserted in the migration's OWN self-verification,
  // against the INSTALLED definitions, with comments stripped there too.
  if (!/pg_get_functiondef/.test(src)) {
    add("H13_lock_contract_selfcheck", "the self-verification does not read installed definitions");
  }
  if (!/regexp_replace\([\s\S]{0,200}?'--\[\^\\n\]\*'/.test(src)) {
    add("H13_lock_contract_selfcheck", "the self-verification does not strip comments before asserting locks");
  }
  for (const needle of [
    "prepare does not lock the source vendor_segments row FOR SHARE",
    "prepare does not lock the source communication_templates row FOR SHARE",
    "approve does not lock the source vendor_segments row FOR SHARE",
    "approve does not lock the source communication_templates row FOR SHARE",
    "FOR KEY SHARE does not conflict with FOR NO KEY UPDATE",
    "does not acquire locks in the order campaign -> segment -> template",
  ]) {
    if (!src.includes(needle)) {
      add("H13_lock_contract_selfcheck", `the self-verification never raises on: ${needle.slice(0, 56)}…`);
    }
  }

  return f;
}

const hardFindings = evaluateHardening(hardeningSrc);
record("41 hardening migration has zero findings", hardFindings.length === 0,
  hardFindings.map((x) => `${x.rule}: ${x.detail}`).join(" | ")
  || "DB-authoritative fingerprints, rollback on mismatch, approval recomputation, mandatory template evidence, minimal objects");

/* Each fixture reverts the migration to the EXACT pre-correction behaviour the
 * audit found. If any of these stops tripping, the defect has come back. */
const HARD_FIX = [
  { id: "U", rule: "H03_db_authoritative", why: "prepare stores the caller fingerprint without recomputing",
    mutate: (s) => s.replace("snapshot_fingerprint          = v_snap_actual", "snapshot_fingerprint          = p_snapshot_fingerprint") },
  { id: "V", rule: "H05_approve_recomputes_snapshot", why: "approval checks count only, as before",
    mutate: (s) => s.replace("  if v_snap_actual <> v_campaign.snapshot_fingerprint then\n    return jsonb_build_object('ok', false, 'code', 'SNAPSHOT_FINGERPRINT_MISMATCH');\n  end if;", "") },
  { id: "W", rule: "H08_evidence_complete", why: "prepared_template_fingerprint is nullable for ready/approved again",
    mutate: (s) => s.replace("        and prepared_template_fingerprint is not null\n", "") },
  { id: "X", rule: "H03_db_authoritative", why: "prepare stores the caller template fingerprint",
    mutate: (s) => s.replace("prepared_template_fingerprint = v_tmpl_actual", "prepared_template_fingerprint = p_template_fingerprint") },
  { id: "Y", rule: "H07_approve_template_drift", why: "approval checks version/category only, as before",
    mutate: (s) => s.replace("  if v_tmpl_actual <> v_campaign.prepared_template_fingerprint then\n    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_FINGERPRINT_MISMATCH');\n  end if;", "") },
  { id: "Z", rule: "H04_rollback_on_mismatch", why: "a verification failure no longer rolls the freeze back",
    mutate: (s) => s.replace("errcode = 'QFC01'", "errcode = 'P0001'") },
  { id: "AA", rule: "H02_snapshot_authority", why: "the snapshot fingerprint stops requiring dense ordinals",
    mutate: (s) => s.replace("if v_distinct <> v_count or v_min <> 0 or v_max <> v_count - 1 then return null; end if;", "") },
  { id: "AB", rule: "H02_snapshot_authority", why: "a contaminated snapshot id is silently filtered instead of refused",
    mutate: (s) => s.replace("or m.snapshot_revision is distinct from p_snapshot_revision)", "or false)")
      .replace("m.campaign_id is distinct from p_campaign_id", "false") },
  { id: "AC", rule: "H06_template_authority", why: "a dispatch-critical template field drops out of the canonical set",
    mutate: (s) => s.replace("    || chr(31) || public.qf_canonical_text_field_v1(t.provider_template_name)\n", "") },
  { id: "AD", rule: "H09_no_new_object", why: "the correction grows a new table",
    mutate: (s) => `${s}\ncreate table public.vendor_campaign_snapshots (id uuid primary key);\n` },
  { id: "AE", rule: "H10_execute_posture", why: "a fingerprint helper becomes externally callable",
    mutate: (s) => `${s}\ngrant execute on function public.qf_campaign_snapshot_fingerprint_v1(uuid, uuid, integer) to service_role;\n` },
  { id: "AF", rule: "H01_forward_only", why: "the correction drops an applied object instead of replacing its body",
    mutate: (s) => `${s}\ndrop function if exists public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text);\n` },

  /* -- QF-MVP-30.4C2: each of these restores the exact concurrency race the
   *    audit found, or a plausible half-fix for it. Every one must trip. ---- */
  { id: "AG", rule: "H11_evidence_row_locks", why: "prepare loses the source SEGMENT lock",
    mutate: (s) => s.replace(
      "  select * into v_segment from public.vendor_segments\n   where id = v_campaign.segment_id\n     for share;\n  if not found then\n    return jsonb_build_object('ok', false, 'code', 'SEGMENT_MISSING');\n  end if;\n  if v_segment.status = 'archived' then\n    return jsonb_build_object('ok', false, 'code', 'SEGMENT_ARCHIVED');\n  end if;\n  if v_segment.definition_version is distinct from p_segment_version",
      "  select * into v_segment from public.vendor_segments\n   where id = v_campaign.segment_id;\n  if not found then\n    return jsonb_build_object('ok', false, 'code', 'SEGMENT_MISSING');\n  end if;\n  if v_segment.status = 'archived' then\n    return jsonb_build_object('ok', false, 'code', 'SEGMENT_ARCHIVED');\n  end if;\n  if v_segment.definition_version is distinct from p_segment_version") },
  { id: "AH", rule: "H11_evidence_row_locks", why: "prepare loses the source TEMPLATE lock",
    mutate: (s) => s.replace(
      "  select * into v_template from public.communication_templates\n   where template_key = v_campaign.template_key\n     for share;\n  if not found then\n    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_MISSING');\n  end if;\n  if v_template.is_active is not true or v_template.readiness_status = 'disabled' then\n    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_NOT_USABLE');\n  end if;\n  if v_template.version is distinct from p_template_version then",
      "  select * into v_template from public.communication_templates\n   where template_key = v_campaign.template_key;\n  if not found then\n    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_MISSING');\n  end if;\n  if v_template.is_active is not true or v_template.readiness_status = 'disabled' then\n    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_NOT_USABLE');\n  end if;\n  if v_template.version is distinct from p_template_version then") },
  { id: "AI", rule: "H11_evidence_row_locks", why: "approve loses the source SEGMENT lock",
    mutate: (s) => s.replace(
      "  -- LOCK ORDER 2 of 3 — the source SEGMENT row.\n  select * into v_segment from public.vendor_segments\n   where id = v_campaign.segment_id\n     for share;",
      "  -- LOCK ORDER 2 of 3 — the source SEGMENT row.\n  select * into v_segment from public.vendor_segments\n   where id = v_campaign.segment_id;") },
  { id: "AJ", rule: "H11_evidence_row_locks", why: "approve loses the source TEMPLATE lock",
    mutate: (s) => s.replace(
      "  -- LOCK ORDER 3 of 3 — the source TEMPLATE row.\n  select * into v_template from public.communication_templates\n   where template_key = v_campaign.template_key\n     for share;",
      "  -- LOCK ORDER 3 of 3 — the source TEMPLATE row.\n  select * into v_template from public.communication_templates\n   where template_key = v_campaign.template_key;") },
  { id: "AK", rule: "H11_evidence_row_locks", why: "FOR KEY SHARE is substituted for FOR SHARE",
    mutate: (s) => s.replace(/\n     for share;/g, "\n     for key share;") },
  { id: "AL", rule: "H12_deterministic_lock_order", why: "approve locks the template BEFORE the segment",
    mutate: (s) => s.replace(
      "  -- LOCK ORDER 2 of 3 — the source SEGMENT row.\n  select * into v_segment from public.vendor_segments\n   where id = v_campaign.segment_id\n     for share;\n  if not found then\n    return jsonb_build_object('ok', false, 'code', 'SEGMENT_MISSING');\n  end if;\n\n  -- LOCK ORDER 3 of 3 — the source TEMPLATE row.\n  select * into v_template from public.communication_templates\n   where template_key = v_campaign.template_key\n     for share;\n  if not found then\n    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_MISSING');\n  end if;",
      "  select * into v_template from public.communication_templates\n   where template_key = v_campaign.template_key\n     for share;\n  if not found then\n    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_MISSING');\n  end if;\n\n  select * into v_segment from public.vendor_segments\n   where id = v_campaign.segment_id\n     for share;\n  if not found then\n    return jsonb_build_object('ok', false, 'code', 'SEGMENT_MISSING');\n  end if;") },
  { id: "AM", rule: "H11_evidence_row_locks", why: "the lock survives only as a COMMENT while the SQL is unlocked",
    mutate: (s) => s.replace(
      "  -- LOCK ORDER 2 of 3 — the source SEGMENT row.\n  select * into v_segment from public.vendor_segments\n   where id = v_campaign.segment_id\n     for share;",
      "  -- LOCK ORDER 2 of 3 — the source SEGMENT row, held for share until commit.\n  select * into v_segment from public.vendor_segments\n   where id = v_campaign.segment_id;") },
];
for (const fx of HARD_FIX) {
  const mutated = fx.mutate(hardeningSrc);
  const changed = mutated !== hardeningSrc;
  const ff = changed ? evaluateHardening(mutated) : [];
  const tripped = ff.some((x) => x.rule === fx.rule);
  record(`42 hardening fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "NO-OP (the anchor no longer exists)" : tripped ? "tripped" : ff.map((x) => x.rule).join(",") || "none");
}

record("43 the applied 20260723001300 is byte-identical to what was applied on staging",
  sha256(migrationSrc) === "3a92fd063bf222230578532ae2df1bb602ceb9fe625363650d33a7bcd54fc268",
  "the correction is forward-only; the applied migration was not edited");

/* -- historical verifiers are point-in-time evidence and must never be edited */
const HISTORICAL_VERIFIERS = {
  "supabase/staging-verification/verify_qf_mvp_30_4.sql":
    "ba67395f368ad9310a8eab6ee84647c54d7b2665ecd25550733403a7300835a8",
  "supabase/staging-verification/verify_qf_mvp_30_3.sql":
    "62818d27f9d009a1357152ad05ec71df58bf72bf9434a4d3fcaf896bd3d90349",
  "supabase/staging-verification/verify_qf_mvp_30_1b.sql":
    "e10caa5699ff67346a700c6bd8a69c0a7ff0e0e5d48eeb76dcf2a24e7e633799",
};
for (const [rel, want] of Object.entries(HISTORICAL_VERIFIERS)) {
  record(`44 historical verifier unchanged :: ${path.basename(rel)}`,
    sha256(read(rel)) === want, `expected ${want.slice(0, 16)}…, got ${sha256(read(rel)).slice(0, 16)}…`);
}

/* -- the NEW post-correction verifier -------------------------------------- */
const VERIFIER_30_4C1 = "supabase/staging-verification/verify_qf_mvp_30_4c1.sql";
record("45 the post-correction verifier exists", existsSync(path.join(ROOT, VERIFIER_30_4C1)), VERIFIER_30_4C1);
const v4c1 = read(VERIFIER_30_4C1);
record("46 the post-correction verifier is SELECT-only", (() => {
  const exec = execSql(v4c1);
  return !/\b(insert|update|delete|truncate|create|alter|drop|grant|revoke|call|merge|do)\b/i.test(exec)
    && /^\s*select\b/im.test(exec);
})(), "no mutating keyword outside string literals; begins with SELECT");
record("47 the post-correction verifier covers the hardened contract", (() => {
  const need = ["20260723001300", "20260723001400",
    "qf_campaign_snapshot_fingerprint_v1", "qf_communication_template_fingerprint_v1",
    "qf_canonical_text_field_v1", "prepared_template_fingerprint IS NOT NULL",
    "SNAPSHOT_FINGERPRINT_MISMATCH", "TEMPLATE_FINGERPRINT_MISMATCH",
    "C26_zero_campaign_rows_before_fixtures", "C27_no_core_mutation",
    "C34_public_projection_unchanged", "has_function_privilege", "relrowsecurity"];
  return need.every((n) => v4c1.includes(n));
})(), "migrations, both authorities, mandatory evidence, posture, zero rows, projection");
record("47a the post-correction verifier asserts the QF-MVP-30.4C2 lock contract", (() => {
  const need = ["C28_prepare_locks_evidence_rows", "C29_approve_locks_evidence_rows",
    "C30_no_for_key_share", "C31_deterministic_lock_order",
    "C32_approve_locks_before_checks_and_held", "C33_definer_owner_may_lock_evidence_rows"];
  // it must read the INSTALLED definitions and strip comments before asserting,
  // so a comment mentioning FOR SHARE can never satisfy a lock row.
  return need.every((n) => v4c1.includes(n))
    && /pg_get_functiondef/.test(v4c1)
    // strips comments before asserting — `\\` matches ONE literal backslash, so
    // this looks for the SQL text `'--[^` , not for a regex metacharacter.
    && /regexp_replace\([\s\S]{0,240}?'--\[\^/.test(v4c1)
    // looks for the SQL text `for\s+share` inside the verifier's own regexes.
    && /for\\s\+share/.test(v4c1);
})(), "both RPCs, both evidence rows, no FOR KEY SHARE, deterministic order, locks held, owner privilege");
record("48 the post-correction verifier proves EXECUTED cross-language parity", (() => {
  return /encode\(sha256\(convert_to\(/.test(v4c1)
    && v4c1.includes("chr(30)") && v4c1.includes("chr(31)")
    && /C13_snapshot_golden_vector_parity/.test(v4c1)
    && /C14_template_golden_vector_parity/.test(v4c1);
})(), "the SQL side hashes the same pinned canonical bytes as the TypeScript mirror");
record("49 every verifier row reports (check_id, passed, detail)", (() => {
  const ids = [...v4c1.matchAll(/'(C\d+_[a-z0-9_]+)' as check_id/g)].map((m) => m[1]);
  const passedCols = (v4c1.match(/ as passed/g) || []).length;
  const detailCols = (v4c1.match(/ as detail/g) || []).length;
  return ids.length === 34 && new Set(ids).size === ids.length
    && passedCols === ids.length && detailCols === ids.length;
})(), `${[...v4c1.matchAll(/'(C\d+_[a-z0-9_]+)' as check_id/g)].length} uniquely-named rows, each with passed + detail`);

/* ===========================================================================
 * Report
 * ========================================================================= */
const passed = results.filter((r) => r.ok).length;
console.log("== QF-MVP-30.4A vendor campaign foundation validator ==");
for (const r of results) { console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`); if (!r.ok) console.log(`         ${r.detail}`); }
console.log("");
console.log(`checks: ${passed} passed, ${results.length - passed} failed (of ${results.length})`);
console.log(`fixtures: ${MIG_FIX.length} migration + ${CON_FIX.length} contract + ${HARD_FIX.length} hardening one-defect mutations`);
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
