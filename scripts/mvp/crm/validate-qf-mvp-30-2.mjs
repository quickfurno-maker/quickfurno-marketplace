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
 * Mostly static, but section 5b EXECUTES the real search sanitizer, so the `.ts`
 * resolution hook must be registered.
 *
 * Usage:  npm run test:crm:30-2                                  (exit 0 = PASS)
 *   or:   node --import ./scripts/mvp/loader/register.mjs \
 *              scripts/mvp/crm/validate-qf-mvp-30-2.mjs
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
  // S09 the directory search must never be interpolated raw into PostgREST or()
  // grammar: the value must be sanitized upstream AND double-quoted in the filter.
  for (const m of src.matchAll(/\.or\(\s*`([^`]*)`/g)) {
    const expr = m[1];
    if (/ilike\.%\$\{/.test(expr)) add("S09_safe_search", "interpolates the search term into an UNQUOTED ilike value");
    if (/\$\{/.test(expr) && !/ilike\."%\$\{/.test(expr)) add("S09_safe_search", "or() interpolates a value that is not double-quoted");
  }
  if (/\.or\(/.test(src) && !/sanitizeDirectorySearch|validateDirectoryQuery/.test(src)) {
    add("S09_safe_search", "builds an or() filter without the sanitized/validated query");
  }
  return f;
}

/* ===========================================================================
 * ROUTE evaluator (no raw exception text may reach the rendered admin UI)
 * ========================================================================= */
export function evaluateRoute(src, label = "route") {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  // R01 a raw exception/DB message must never become the rendered error state.
  if (/\berror\s*=\s*[^;]*\.message/.test(src)) add("R01_no_raw_route_error", "assigns a raw exception message to the rendered error state");
  if (/\b(e|err|error)\s+instanceof\s+Error\s*\?\s*\1\.message/.test(src)) add("R01_no_raw_route_error", "renders e.message when the throwable is an Error");
  // the rendered value must be a fixed constant declared in the module.
  if (!/const\s+CRM_[A-Z_]*LOAD_ERROR\s*=\s*$/m.test(src) && !/const\s+CRM_[A-Z_]*LOAD_ERROR\s*=/.test(src)) {
    add("R01_no_raw_route_error", "no fixed CRM_*_LOAD_ERROR constant is declared");
  }
  // R02 the route module must not touch `.message` AT ALL — not to render it and
  // not to log it. A blanket ban is used deliberately: a narrower "inside a
  // console call" pattern is defeated by any nested parenthesis, e.g.
  // `console.error(x, (e as Error).message)`.
  if (/\.message\b/.test(src)) add("R02_no_message_logging", "references the raw error message field");
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
/* QF-MVP-30.3A CORRECTION.
 * This slot previously asserted globally that NO migration may exist after
 * 20260723001100. That was only ever true before QF-MVP-30.3 and would break
 * every future phase — a later phase legitimately adds its own migration.
 * It is replaced by the PHASE-SCOPED invariant that actually matters here:
 * QF-MVP-30.2 is a runtime/UI phase, so it must own no migration of its own and
 * must not depend on segment/campaign objects. The 30.1B foundation hash is
 * asserted separately by check 01. */
record("02a required 30.1B foundation migration still present", (() => {
  const files = readdirSync(path.join(ROOT, "supabase/migrations")).filter((x) => x.endsWith(".sql"));
  return files.includes("20260723001100_qf_mvp_vendor_crm_foundation.sql");
})(), "the CRM foundation migration this phase runs on top of exists");

record("02b QF-MVP-30.2 owns no migration of its own", (() => {
  const dir = path.join(ROOT, "supabase/migrations");
  // A migration "belongs to" 30.2 only if it DECLARES that phase as its own in
  // its header banner (`-- QF-MVP-30.2 — ...`). A prose cross-reference in a
  // later migration's comments is not ownership.
  const declaresPhase302 = /^--\s*QF-MVP-30\.2\b/m;
  return readdirSync(dir).filter((x) => x.endsWith(".sql"))
    .every((f) => !declaresPhase302.test(readFileSync(path.join(dir, f), "utf8")));
})(), "30.2 is runtime/UI only — no migration declares itself part of it");

record("02c later-phase migrations do not break this validator", (() => {
  // Regression guard for the corrected rule: a legitimate LATER migration (e.g.
  // the QF-MVP-30.3 segment foundation) must not fail QF-MVP-30.2. Simulated on
  // a synthetic file list so the assertion holds whether or not 30.3 has landed.
  const simulated = ["20260723001100_qf_mvp_vendor_crm_foundation.sql",
    "20260723001200_qf_mvp_vendor_segment_foundation.sql", "20270101000000_some_future_phase.sql"];
  const foundationPresent = simulated.includes("20260723001100_qf_mvp_vendor_crm_foundation.sql");
  const oldCeilingWouldHaveFailed = !simulated.every((x) => x <= "20260723001100_zzz");
  return foundationPresent && oldCeilingWouldHaveFailed;
})(), "the removed ceiling would have failed on a valid later migration; the phase-scoped rule does not");

record("02d QF-MVP-30.2 runtime does not depend on segment/campaign objects", (() => {
  const surface = [SERVICE, ACTIONS, GUARD, VALIDATION, DIR_PAGE, PROFILE_PAGE, DIR_UI, PROFILE_UI]
    .map((f) => read(f)).join("\n");
  return !/\b(vendor_segments|vendor_segment_memberships|vendor_segment_members|vendor_campaigns|vendor_campaign_audiences|vendor_campaign_events|vendor_engagement_events)\b/.test(surface);
})(), "no 30.2 runtime file references a segment/campaign/membership object");

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
  { id: "H", rule: "S09_safe_search", why: "the search term is interpolated unquoted into or()", mutate: (s) => s.replace(/`business_name\.ilike\."%\$\{q\.search\}%"[^`]*`/, "`business_name.ilike.%${q.search}%,owner_name.ilike.%${q.search}%`") },
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
/* -- QF-MVP-30.2C1 defect 2: no raw exception text in a rendered route error -- */
for (const [pg, label] of [[DIR_PAGE, "directory"], [PROFILE_PAGE, "profile"]]) {
  const ff = evaluateRoute(read(pg), label);
  record(`12b route error state is safe :: ${label}`, ff.length === 0,
    ff.map((x) => `${x.rule}: ${x.detail}`).join(" | ") || "fixed CRM_*_LOAD_ERROR constant; no e.message rendered or logged");
}
const ROUTE_FIX = [
  { id: "RF1", rule: "R01_no_raw_route_error", why: "the route renders e.message again",
    mutate: (s) => s.replace(/error = CRM_[A-Z_]*LOAD_ERROR;/, 'error = e instanceof Error ? e.message : "x";') },
  { id: "RF2", rule: "R02_no_message_logging", why: "the diagnostic log leaks the raw message",
    mutate: (s) => s.replace(/code: err\?\.code \?\? "UNKNOWN",/, 'code: err?.code ?? "UNKNOWN", detail: (e as Error).message,') },
];
const dirPageSrc = read(DIR_PAGE);
for (const fx of ROUTE_FIX) {
  const mutated = fx.mutate(dirPageSrc); const changed = mutated !== dirPageSrc;
  const ff = changed ? evaluateRoute(mutated, `rfx-${fx.id}`) : [];
  const tripped = ff.some((x) => x.rule === fx.rule);
  record(`12c route fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "NO-OP" : tripped ? "tripped" : ff.map((x) => x.rule).join(",") || "none");
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
 * 5b. BEHAVIOURAL tests — the real sanitizer, executed (QF-MVP-30.2C1 defect 1)
 *
 * Imported through Node's native `.ts` type-stripping (see
 * scripts/mvp/loader/register.mjs). vendorCrmValidation.ts is pure — no DB, no
 * server-only import — so it can be executed directly here.
 * ========================================================================= */
const { sanitizeDirectorySearch, CRM_SEARCH_MAX_LENGTH, validateDirectoryQuery } =
  await import("../../../lib/crm/vendorCrmValidation.ts");

/** The filter expression the service builds, so we assert on the real shape. */
const buildOr = (term) =>
  `business_name.ilike."%${term}%",owner_name.ilike."%${term}%",phone.ilike."%${term}%"`;
/** An or() expression is intact when it has exactly 3 terms and 6 quotes. */
const orIsIntact = (expr) =>
  (expr.match(/ilike\./g) || []).length === 3 && (expr.match(/"/g) || []).length === 6;

const SEARCH_CASES = [
  { id: "T1  ordinary business name survives", input: "Sharma Interiors", expect: (out) => out === "Sharma Interiors" },
  { id: "T2  digits, spaces and hyphens survive", input: "A-1 Modular 24", expect: (out) => out === "A-1 Modular 24" },
  { id: "T3  apostrophe / period / plus / at survive", input: "O'Brien Co. +91 a@b", expect: (out) => out === "O'Brien Co. +91 a@b" },
  { id: "T4  comma cannot inject a second filter", input: 'x,is_active.eq.true', expect: (out) => !out.includes(",") && orIsIntact(buildOr(out)) },
  { id: "T5  parentheses cannot open a filter group", input: "x,or(status.eq.approved)", expect: (out) => !/[(),]/.test(out) && orIsIntact(buildOr(out)) },
  { id: "T6  double quote cannot break out of the quoted value", input: 'x"y', expect: (out) => !out.includes('"') && orIsIntact(buildOr(out)) },
  { id: "T7  backslash cannot escape the closing quote", input: 'x\\"y', expect: (out) => !/["\\]/.test(out) && orIsIntact(buildOr(out)) },
  { id: "T8  percent cannot become an uncontrolled wildcard", input: "100%", expect: (out) => !out.includes("%") },
  { id: "T9  underscore cannot become a single-char wildcard", input: "a_b", expect: (out) => !out.includes("_") },
  { id: "T10 asterisk cannot become a PostgREST wildcard", input: "a*b", expect: (out) => !out.includes("*") },
  { id: "T11 excessive length is bounded", input: "z".repeat(5000), expect: (out) => out !== null && out.length === CRM_SEARCH_MAX_LENGTH },
  { id: "T12 empty input is null, not an empty filter", input: "", expect: (out) => out === null },
  { id: "T13 whitespace-only input is null", input: "   \t  ", expect: (out) => out === null },
  { id: "T14 fully-stripped input is null, never an empty match-all", input: "(),%_*\"\\", expect: (out) => out === null },
  { id: "T15 control characters are removed", input: "a\u0000b\u200Bc", expect: (out) => !/\p{C}/u.test(out) },
  { id: "T16 non-string input is rejected", input: { toString: () => "x,y" }, expect: (out) => out === null },
  { id: "T17 Unicode letters remain usable (Devanagari)", input: "शर्मा इंटीरियर", expect: (out) => out === "शर्मा इंटीरियर" },
  { id: "T18 Unicode letters remain usable (Latin accents)", input: "Café Móveis", expect: (out) => out === "Café Móveis" },
  { id: "T19 newline cannot split the filter expression", input: "a\nis_active.eq.true", expect: (out) => !/[\r\n]/.test(out) },
  { id: "T20 the built or() stays exactly 3 quoted terms", input: 'a",x.eq.1,"b', expect: (out) => orIsIntact(buildOr(out)) },
];
for (const c of SEARCH_CASES) {
  let out, ok, detail;
  try { out = sanitizeDirectorySearch(c.input); ok = c.expect(out); detail = JSON.stringify(out); }
  catch (e) { ok = false; detail = `threw: ${e.name}`; }
  record(`17 search sanitizer :: ${c.id}`, ok === true, detail);
}
record("18 sanitizer is wired into validateDirectoryQuery", (() => {
  const q = validateDirectoryQuery({ search: 'x,is_active.eq.true', page: 1, pageSize: 25 });
  return typeof q.search === "string" && !/[,()"\\%_*]/.test(q.search);
})(), "validateDirectoryQuery returns a sanitized search term");
record("19 page size stays hard-bounded after the correction", (() => {
  const q = validateDirectoryQuery({ pageSize: 100000 });
  return q.pageSize <= 100 && q.page >= 1;
})(), "pageSize clamped, page floored");

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
