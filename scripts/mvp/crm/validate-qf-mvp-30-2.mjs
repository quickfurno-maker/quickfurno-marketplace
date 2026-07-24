#!/usr/bin/env node
/**
 * QF-MVP-30.2 — offline validator for the Vendor CRM directory + combined profile.
 *
 * Static, offline (reads the real implementation files). Enforces the locked
 * security/architecture contract: server-only CRM access, no client service-role
 * leakage, no Core-table mutation, append-only notes, archive-not-hard-delete,
 * server-derived actor, bounded pagination, admin-guarded routes, no
 * vendor_public_v / migration / audit_logs-dependency / segment / campaign /
 * owner-binding scope. Real files are graded directly; fixtures mutate copies.
 *
 * Usage:  node scripts/mvp/crm/validate-qf-mvp-30-2.mjs   (exit 0 = PASS)
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SERVICE = "services/vendorCrmService.ts";
const ACTIONS = "app/actions/vendorCrmActions.ts";
const GUARD = "lib/crm/crmAuth.ts";
const VALIDATION = "lib/crm/vendorCrmValidation.ts";
const DIR_PAGE = "app/admin/vendor-crm/page.tsx";
const PROFILE_PAGE = "app/admin/vendor-crm/[vendorId]/page.tsx";
const DIR_UI = "components/admin/crm/VendorCrmDirectory.tsx";
const PROFILE_UI = "components/admin/crm/VendorCrmProfile.tsx";
const SELF = "scripts/mvp/crm/validate-qf-mvp-30-2.mjs";
const CLIENT_FILES = [DIR_UI, PROFILE_UI];

const LOCKED = [
  { file: "supabase/migrations/20260723001100_qf_mvp_vendor_crm_foundation.sql", sha256: "9212f746f0eb90a0be281b9b31c34e3c4ea19466d5d09c9e29f11bafb969ed34" },
];

const results = [];
let failed = false;
const record = (name, ok, detail) => { results.push({ name, ok, detail }); if (!ok) failed = true; };
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const CORE_TABLES = ["vendors", "leads", "lead_assignments", "vendor_packages", "vendor_package_orders",
  "vendor_credit_logs", "packages", "communication_consent_events", "communication_suppressions", "profiles"];

/* ===========================================================================
 * SERVICE evaluator (the server-only CRM boundary)
 * ========================================================================= */
export function evaluateService(rawSrc, label = "service") {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  // resolve `const CRM_X = "table"` so from(CRM_X) matches like from("table").
  let src = rawSrc;
  for (const m of rawSrc.matchAll(/const\s+(CRM_[A-Z_]+)\s*=\s*["']([a-z_]+)["']/g)) {
    src = src.split(`from(${m[1]})`).join(`from("${m[2]}")`);
  }
  // S01 server-only marker + service-role client
  if (!/import\s+["']server-only["']/.test(src)) add("S01_server_only", "missing `import \"server-only\"`");
  if (!/adminClient\(\)/.test(src)) add("S01_server_only", "does not use the service_role adminClient");
  // S02 no Core-table mutation (insert/update/delete/upsert on any Core table)
  for (const t of CORE_TABLES) {
    if (new RegExp(`from\\(["']${t}["']\\)[\\s\\S]{0,120}?\\.(insert|update|delete|upsert)\\b`).test(src)) add("S02_no_core_mutation", `mutates Core table ${t}`);
  }
  // S03 notes append-only: a create method, and NO note update/delete method
  if (!/from\(["']vendor_internal_notes["']\)[\s\S]{0,120}?\.insert\b/.test(src)) add("S03_notes_append_only", "no createVendorNote insert");
  if (/from\(["']vendor_internal_notes["']\)[\s\S]{0,120}?\.(update|delete)\b/.test(src)) add("S03_notes_append_only", "notes are updated/deleted (must be append-only)");
  if (/updateVendorNote|deleteVendorNote|editVendorNote/.test(src)) add("S03_notes_append_only", "a note update/delete method exists");
  // S04 no hard delete on any CRM table (archive via lifecycle only)
  for (const t of ["vendor_internal_notes", "vendor_crm_profiles", "vendor_contacts", "vendor_tags", "vendor_tag_assignments", "vendor_tasks"]) {
    if (new RegExp(`from\\(["']${t}["']\\)[\\s\\S]{0,120}?\\.delete\\(`).test(src)) add("S04_no_hard_delete", `hard-deletes ${t}`);
  }
  // S05 bounded pagination (uses the validated query with the MAX cap)
  if (!/validateDirectoryQuery/.test(src)) add("S05_bounded_pagination", "directory read does not use validateDirectoryQuery");
  if (!/\.range\(/.test(src)) add("S05_bounded_pagination", "directory read is not server-paged (.range)");
  // S06 actor is a parameter, never from request/body
  if (/actor\s*=\s*(input|body|req|request|params)\b/.test(src)) add("S06_actor_from_session", "actor derived from request input");
  // S07 no unrelated migration-006 dependency
  if (/from\(["'](audit_logs|admin_notifications|lead_internal_notes|lead_timeline_events)["']\)/.test(src)) add("S07_no_006_dependency", "depends on an omitted migration-006 table");
  // S08 no segment/campaign / vendor_public_v / owner-binding
  if (/vendor_segments|vendor_campaigns|vendor_campaign_|vendor_engagement_events/.test(src)) add("S08_no_scope_creep", "references a segment/campaign table");
  if (/vendor_public_v/.test(src)) add("S08_no_scope_creep", "touches vendor_public_v");
  return f;
}

/* ===========================================================================
 * CLIENT evaluator (no service-role leakage into the browser bundle)
 * ========================================================================= */
export function evaluateClient(src, label = "client") {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  if (!/^\s*["']use client["']/.test(src)) add("C01_use_client", "not marked \"use client\"");
  if (/adminClient|serverClient|["']server-only["']|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE/.test(src)) add("C02_no_service_role", "imports/uses server-only or service-role code");
  // a VALUE import from the server-only service leaks it into the client bundle;
  // `import type` is erased at build and is safe.
  if (/^\s*import\s+(?!type\b)[^;]*from\s+["'][^"']*services\/vendorCrmService["']/m.test(src)) add("C02_no_service_role", "value-imports the server-only CRM service directly");
  if (/createClient\(|@supabase\/supabase-js/.test(src)) add("C02_no_service_role", "instantiates a Supabase client in a client component");
  return f;
}

/* ===========================================================================
 * 1. Locked migration unchanged (no new/edited migration)
 * ========================================================================= */
for (const item of LOCKED) {
  const actual = sha256(read(item.file));
  record(`01 migration unchanged :: ${item.file}`, actual === item.sha256, actual === item.sha256 ? actual.slice(0, 16) : `changed: ${actual}`);
}
record("02 no migration newer than 20260723001100", (() => {
  const files = readdirSync(path.join(ROOT, "supabase/migrations")).filter((x) => x.endsWith(".sql"));
  return files.every((x) => x <= "20260723001100_zzz");
})(), "no CRM-runtime phase migration added");

/* ===========================================================================
 * 2. Files exist
 * ========================================================================= */
for (const file of [SERVICE, ACTIONS, GUARD, VALIDATION, DIR_PAGE, PROFILE_PAGE, DIR_UI, PROFILE_UI]) {
  record(`03 present :: ${file}`, existsSync(path.join(ROOT, file)), file);
}

/* ===========================================================================
 * 3. Service — zero findings + fixtures
 * ========================================================================= */
const serviceSrc = read(SERVICE);
const svcFindings = evaluateService(serviceSrc);
record("04 service has zero findings", svcFindings.length === 0, svcFindings.map((x) => `${x.rule}: ${x.detail}`).join(" | ") || "server-only, no Core writes, notes append-only, no hard delete, bounded");

const SVC_FIX = [
  { id: "A", rule: "S02_no_core_mutation", why: "service updates a Core table", mutate: (s) => `${s}\nexport async function bad(){ return db().from("vendors").update({is_active:true}); }\n` },
  { id: "B", rule: "S03_notes_append_only", why: "a note update is added", mutate: (s) => `${s}\nexport async function badNote(id){ return db().from("vendor_internal_notes").update({note:"x"}).eq("id",id); }\n` },
  { id: "C", rule: "S04_no_hard_delete", why: "a CRM hard-delete is added", mutate: (s) => `${s}\nexport async function badDel(id){ return db().from("vendor_tasks").delete().eq("id",id); }\n` },
  { id: "D", rule: "S01_server_only", why: "the server-only marker is removed", mutate: (s) => s.replace('import "server-only";', "// removed") },
  { id: "E", rule: "S07_no_006_dependency", why: "an audit_logs dependency is added", mutate: (s) => `${s}\nexport async function audit(){ return db().from("audit_logs").insert({}); }\n` },
  { id: "F", rule: "S08_no_scope_creep", why: "a campaign table is referenced", mutate: (s) => `${s}\nexport async function camp(){ return db().from("vendor_campaigns").select("*"); }\n` },
  { id: "G", rule: "S05_bounded_pagination", why: "the range/pagination is removed", mutate: (s) => s.replace(/\.range\([^)]*\)/, ".limit(100000)") },
];
for (const fx of SVC_FIX) {
  const mutated = fx.mutate(serviceSrc); const changed = mutated !== serviceSrc;
  const ff = changed ? evaluateService(mutated, `fx-${fx.id}`) : [];
  const tripped = ff.some((x) => x.rule === fx.rule);
  record(`05 service fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped, !changed ? "NO-OP" : tripped ? "tripped" : ff.map((x) => x.rule).join(",") || "none");
}
record("06 every enforced service rule has a fixture", (() => {
  const covered = new Set(SVC_FIX.map((x) => x.rule));
  const declared = [...new Set([...read(SELF).matchAll(/add\("(S\d\d_[a-z0-9_]+)"/g)].map((m) => m[1]))].filter((r) => !["S06_actor_from_session"].includes(r));
  const missing = declared.filter((r) => !covered.has(r));
  return missing.length === 0 ? true : missing;
})() === true, "every service rule exercised (S06 is a pattern-only guard)");

/* ===========================================================================
 * 4. Client components — no service-role leakage + fixtures
 * ========================================================================= */
for (const cf of CLIENT_FILES) {
  const ff = evaluateClient(read(cf), cf);
  record(`07 client clean :: ${cf}`, ff.length === 0, ff.map((x) => `${x.rule}: ${x.detail}`).join(" | ") || "use client, no service-role");
}
const CLIENT_FIX = [
  { id: "CF1", rule: "C02_no_service_role", why: "client imports adminClient", mutate: (s) => s.replace('"use client";', '"use client";\nimport { adminClient } from "@/lib/supabase";') },
  { id: "CF2", rule: "C02_no_service_role", why: "client imports the CRM service", mutate: (s) => s.replace('"use client";', '"use client";\nimport { listVendorCrmDirectory } from "@/services/vendorCrmService";') },
];
const dirUi = read(DIR_UI);
for (const fx of CLIENT_FIX) {
  const mutated = fx.mutate(dirUi); const changed = mutated !== dirUi;
  const ff = changed ? evaluateClient(mutated, `cfx-${fx.id}`) : [];
  record(`08 client fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && ff.some((x) => x.rule === fx.rule), !changed ? "NO-OP" : ff.some((x) => x.rule === fx.rule) ? "tripped" : "none");
}

/* ===========================================================================
 * 5. Guard, actions, routes, UI states
 * ========================================================================= */
const guardSrc = read(GUARD);
record("09 guard requires admin + Superadmin, throws UNAUTHORIZED",
  /app_metadata\?\.admin_role/.test(guardSrc) && /from\("profiles"\)[\s\S]{0,60}?role/.test(guardSrc)
    && /role\s*!==\s*["']admin["']/.test(guardSrc) && /adminRole\s*!==\s*["']Superadmin["']/.test(guardSrc)
    && /throw appError\("UNAUTHORIZED"\)/.test(guardSrc)
    && !/user_metadata\s*(\?\.|\.|\[)/.test(guardSrc), // never READ user_metadata (a comment mentioning it is fine)
  "reads profiles.role + app_metadata.admin_role; requires admin+Superadmin; throws UNAUTHORIZED");

const actionsSrc = read(ACTIONS);
record("10 every action is guarded by requireCrmAdmin", /requireCrmAdmin\(\)/.test(actionsSrc) && (actionsSrc.match(/export async function/g) || []).length >= 10 && !/export async function \w+[\s\S]{0,200}crm\.\w+\([^)]*\bactorId\b/.test(actionsSrc.replace(/run\(/g, "")), "actions run through requireCrmAdmin");
record("11 actions derive actor from session (run helper), not input", /const actor = await requireCrmAdmin\(\)/.test(actionsSrc) && /actor\.id/.test(actionsSrc), "actor.id from guard");

for (const [pg, label] of [[DIR_PAGE, "directory"], [PROFILE_PAGE, "profile"]]) {
  const s = read(pg);
  record(`12 route admin-guarded :: ${label}`, /getAdminSession\(\)/.test(s) && /isSuperadmin/.test(s) && /redirect\(/.test(s) && !/adminClient/.test(s), "getAdminSession + isSuperadmin redirect");
}
record("13 directory UI has empty + error states", /EmptyState/.test(dirUi) && /error/.test(dirUi), "EmptyState + error");
record("14 profile UI has empty state + notes append-only (no edit/delete control)", (() => {
  const p = read(PROFILE_UI);
  return /EmptyState/.test(p) && /append-only/i.test(p) && !/crmUpdateNote|crmDeleteNote|Delete note|Edit note/.test(p);
})(), "notes append-only, empty state");
record("15 validation bounds page size + rejects unknown keys", (() => {
  const v = read(VALIDATION);
  return /CRM_DIRECTORY_MAX_PAGE_SIZE/.test(v) && /Math\.min\(/.test(v) && /rejectUnknownKeys/.test(v);
})(), "MAX page + Math.min + rejectUnknownKeys");

/* ===========================================================================
 * 6. Docs
 * ========================================================================= */
const board = read("docs/QF-MVP-EXECUTION-BOARD.md").toLowerCase();
const bp = read("docs/QF-MVP-30-VENDOR-CRM-BLUEPRINT.md").toLowerCase();
record("16 board + blueprint record 30.2 directory/profile", board.includes("30.2") && bp.includes("30.2") && (bp.includes("directory") || bp.includes("combined")), "docs updated");

/* ===========================================================================
 * Report
 * ========================================================================= */
const passed = results.filter((r) => r.ok).length;
console.log("== QF-MVP-30.2 Vendor CRM directory + profile validator ==");
for (const r of results) { console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`); if (!r.ok) console.log(`         ${r.detail}`); }
console.log("");
console.log(`checks: ${passed} passed, ${results.length - passed} failed (of ${results.length})`);
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
