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

/** Executable SQL only: strip comments AND single-quoted literals. */
const execSql = (src) => src.replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''");

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
record("05 migration version is monotonic and collision-free", (() => {
  const files = readdirSync(path.join(ROOT, "supabase/migrations")).filter((x) => x.endsWith(".sql")).sort();
  const mine = "20260723001300_qf_mvp_vendor_campaign_foundation.sql";
  return files[files.length - 1] === mine
    && files.filter((x) => x.startsWith("20260723001300")).length === 1;
})(), "20260723001300 is the highest and appears once");

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

// -- approval fail-closed matrix ---------------------------------------------
const approvalBase = {
  prepared_segment_version: 3, prepared_segment_fingerprint: FP,
  prepared_template_version: "1.0.0", prepared_template_category: "marketing",
  prepared_recipient_count: 2, snapshot_fingerprint: prepared?.snapshot_fingerprint ?? FP,
  current_segment_status: "active", current_segment_version: 3, current_segment_fingerprint: FP,
  current_template_version: "1.0.0", current_template_category: "marketing",
  current_template_readiness: "provider_ready",
  actual_member_count: 2, actual_snapshot_fingerprint: prepared?.snapshot_fingerprint ?? FP,
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
 * Report
 * ========================================================================= */
const passed = results.filter((r) => r.ok).length;
console.log("== QF-MVP-30.4A vendor campaign foundation validator ==");
for (const r of results) { console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`); if (!r.ok) console.log(`         ${r.detail}`); }
console.log("");
console.log(`checks: ${passed} passed, ${results.length - passed} failed (of ${results.length})`);
console.log(`fixtures: ${MIG_FIX.length} migration + ${CON_FIX.length} contract one-defect mutations`);
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
