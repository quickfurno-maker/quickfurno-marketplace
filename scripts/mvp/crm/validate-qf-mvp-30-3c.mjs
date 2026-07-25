#!/usr/bin/env node
/**
 * QF-MVP-30.3C — offline validator for the deterministic segment RUNTIME.
 *
 * Grades the real runtime artifacts (routes, actions, service, components, admin
 * nav) and EXECUTES the real query planner. One-defect fixtures prove each rule
 * actually trips. The 30.3A foundation validator is unchanged and still owns the
 * migration/AST/fingerprint contract — this file adds the runtime layer.
 *
 * Section 7 executes `.ts` modules, so the type-stripping loader must be registered.
 *
 * Usage:  npm run test:crm:30-3c                                 (exit 0 = PASS)
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SERVICE = "services/vendorSegmentService.ts";
const ACTIONS = "app/actions/vendorSegmentActions.ts";
const LIST_PAGE = "app/admin/vendor-crm/segments/page.tsx";
const EDIT_PAGE = "app/admin/vendor-crm/segments/[segmentId]/page.tsx";
const LIST_UI = "components/admin/crm/segments/VendorSegmentDirectory.tsx";
const EDIT_UI = "components/admin/crm/segments/VendorSegmentEditor.tsx";
const PLANNER = "lib/crm/segmentQueryPlan.ts";
const NAV = "components/admin/adminConfig.ts";
const SELF = "scripts/mvp/crm/validate-qf-mvp-30-3c.mjs";
const CLIENT_FILES = [LIST_UI, EDIT_UI];

const results = [];
let failed = false;
const record = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) failed = true; };
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

/* ===========================================================================
 * SERVICE evaluator — the server-only segment boundary
 * ========================================================================= */
export function evaluateService(src) {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  if (!/import\s+["']server-only["']/.test(src)) add("V01_server_only", "missing `import \"server-only\"`");
  if (!/adminClient\(\)/.test(src)) add("V01_server_only", "does not use the service_role adminClient");

  // V02 writes only vendor_segments — never Core, never another CRM table.
  for (const t of ["vendors", "leads", "lead_assignments", "profiles", "packages", "vendor_credit_logs",
    "vendor_package_orders", "communication_consent_events", "communication_suppressions",
    "vendor_crm_profiles", "vendor_contacts", "vendor_tags", "vendor_tag_assignments",
    "vendor_internal_notes", "vendor_tasks"]) {
    if (new RegExp(`from\\(["']${t}["']\\)[\\s\\S]{0,160}?\\.(insert|update|upsert|delete)\\b`).test(src)) {
      add("V02_no_foreign_write", `mutates ${t}`);
    }
  }
  // V03 no hard delete anywhere.
  if (/\.delete\(\)/.test(src)) add("V03_no_hard_delete", "calls .delete()");
  if (/deleteVendorSegment|removeVendorSegment|destroySegment/.test(src)) add("V03_no_hard_delete", "a delete method exists");

  // V04 no membership persistence — no vendor id written back into a segment row.
  if (/from\(["']vendor_segments["']\)[\s\S]{0,200}?(insert|update)[\s\S]{0,200}?vendor_id/.test(src)) {
    add("V04_no_membership_persistence", "writes a vendor_id into vendor_segments");
  }
  for (const t of ["vendor_segment_memberships", "vendor_segment_members", "vendor_campaigns",
    "vendor_campaign_audiences", "vendor_campaign_events", "vendor_engagement_events"]) {
    if (new RegExp(`from\\(["']${t}["']\\)`).test(src)) add("V04_no_membership_persistence", `touches ${t}`);
  }
  // V05 bounded preview + deterministic order with an id tie-breaker.
  if (!/\.range\(/.test(src)) add("V05_bounded_preview", "preview is not server-paged (.range)");
  if (!/boundPreviewPaging/.test(src)) add("V05_bounded_preview", "does not clamp paging through boundPreviewPaging");
  if (!/\.order\(["']id["']/.test(src)) add("V05_bounded_preview", "no deterministic id tie-breaker");
  if (!/SEGMENT_PRERESOLVE_MAX/.test(src)) add("V05_bounded_preview", "pre-resolution is not bounded");
  // V06 the filter expression comes from the locked planner, never hand-built here.
  if (!/planSegmentQuery/.test(src)) add("V06_locked_plan", "does not use the locked query planner");
  if (/\.or\(\s*`/.test(src)) add("V06_locked_plan", "builds a template-literal PostgREST expression inline");
  // V07 canonical definition/fingerprint are server-derived.
  if (!/normalizeSegmentDefinition/.test(src)) add("V07_server_canonical", "does not normalize through the locked parser");
  if (/input\.(definition_fingerprint|definition_version)/.test(src)) {
    add("V07_server_canonical", "accepts a client-supplied fingerprint/version");
  }
  // V08 no raw DB error text escapes.
  if (/throw new Error\(\s*(error|e)\.message/.test(src)) add("V08_safe_errors", "throws a raw DB message");
  if (/SegmentServiceError\([^)]*error\.message/.test(src)) add("V08_safe_errors", "wraps a raw DB message");
  // V09 no consent/suppression/campaign/provider authority.
  if (/consent|suppress|campaign|whatsapp|n8n|jarvis|provider_send/i.test(src.replace(/\/\/[^\n]*/g, ""))) {
    add("V09_no_authorization_scope", "references consent/suppression/campaign/provider scope");
  }
  return f;
}

/* ===========================================================================
 * ACTIONS evaluator
 * ========================================================================= */
export function evaluateActions(src) {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  if (!/^"use server";/m.test(src)) add("A01_use_server", "not marked \"use server\"");
  if (!/requireCrmAdmin\(\)/.test(src)) add("A02_guarded", "no requireCrmAdmin guard");
  if (!/const actor = await requireCrmAdmin\(\)/.test(src)) add("A02_guarded", "actor is not derived from the guard");
  // every exported action must route through the guarded run() helper.
  const exported = [...src.matchAll(/export async function (\w+)\(([\s\S]*?)\n\}/g)];
  for (const [, name, body] of exported) {
    if (name === "run") continue;
    if (!/\brun\(/.test(body)) add("A03_every_action_guarded", `${name} bypasses run()`);
  }
  if (exported.length < 6) add("A03_every_action_guarded", `only ${exported.length} actions found`);
  // no delete / campaign / send action may exist.
  if (/export async function \w*(Delete|Destroy|Send|Dispatch|Campaign)\w*/i.test(src)) {
    add("A04_no_forbidden_action", "a delete/send/campaign action is exported");
  }
  if (/adminClient|createClient/.test(src)) add("A05_no_direct_db", "actions touch a DB client directly");
  return f;
}

/* ===========================================================================
 * ROUTE evaluator
 * ========================================================================= */
export function evaluateRoute(src) {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  if (!/getAdminSession\(\)/.test(src)) add("R01_admin_guarded", "no getAdminSession");
  if (!/isSuperadmin/.test(src)) add("R01_admin_guarded", "no isSuperadmin check");
  if (!/redirect\(/.test(src)) add("R01_admin_guarded", "no redirect on failure");
  if (/adminClient/.test(src)) add("R01_admin_guarded", "route uses the service-role client directly");
  if (/\berror\s*=\s*[^;]*\.message/.test(src)) add("R02_safe_route_error", "renders a raw exception message");
  if (/\.message\b/.test(src)) add("R02_safe_route_error", "references the raw error message field");
  if (!/const\s+SEGMENT_[A-Z_]*ERROR\s*=/.test(src)) add("R02_safe_route_error", "no fixed error constant");
  return f;
}

/* ===========================================================================
 * CLIENT evaluator
 * ========================================================================= */
export function evaluateClient(src) {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  if (!/^\s*["']use client["']/.test(src)) add("C01_use_client", "not marked \"use client\"");
  if (/adminClient|serverClient|["']server-only["']|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE/.test(src)) {
    add("C02_no_service_role", "imports/uses server-only or service-role code");
  }
  if (/^\s*import\s+(?!type\b)[^;]*from\s+["'][^"']*services\/vendorSegmentService["']/m.test(src)) {
    add("C02_no_service_role", "value-imports the server-only segment service");
  }
  if (/createClient\(|@supabase\/supabase-js/.test(src)) add("C02_no_service_role", "instantiates a Supabase client");
  return f;
}

/* ===========================================================================
 * 1. Files exist
 * ========================================================================= */
for (const file of [SERVICE, ACTIONS, LIST_PAGE, EDIT_PAGE, LIST_UI, EDIT_UI, PLANNER]) {
  record(`01 present :: ${file}`, existsSync(path.join(ROOT, file)), file);
}
record("02 exact routes are the preflight-locked paths", (() => {
  return existsSync(path.join(ROOT, "app/admin/vendor-crm/segments/page.tsx"))
    && existsSync(path.join(ROOT, "app/admin/vendor-crm/segments/[segmentId]/page.tsx"))
    && !existsSync(path.join(ROOT, "app/segments"))
    && !existsSync(path.join(ROOT, "app/vendor/segments"));
})(), "/admin/vendor-crm/segments and /admin/vendor-crm/segments/[segmentId]; no public or vendor route");

/* ===========================================================================
 * 2. Service — zero findings + fixtures
 * ========================================================================= */
const serviceSrc = read(SERVICE);
const svcFindings = evaluateService(serviceSrc);
record("03 service has zero findings", svcFindings.length === 0,
  svcFindings.map((x) => `${x.rule}: ${x.detail}`).join(" | ") || "server-only, writes only vendor_segments, no delete, no membership, bounded, locked plan");

const SVC_FIX = [
  { id: "A", rule: "V02_no_foreign_write", why: "the service writes a Core table",
    mutate: (s) => `${s}\nexport async function bad(){ return db().from("vendors").update({is_active:true}); }\n` },
  { id: "B", rule: "V03_no_hard_delete", why: "a hard delete is added",
    mutate: (s) => `${s}\nexport async function badDel(id){ return db().from("vendor_segments").delete().eq("id",id); }\n` },
  { id: "C", rule: "V04_no_membership_persistence", why: "a membership table is written",
    mutate: (s) => `${s}\nexport async function badMem(){ return db().from("vendor_segment_memberships").insert({}); }\n` },
  // global: the service legitimately has TWO paged reads (list + preview), so a
  // single-occurrence replace would leave one .range() behind and not trip.
  { id: "D", rule: "V05_bounded_preview", why: "the preview range is removed",
    mutate: (s) => s.replace(/\.range\(from, from \+ pageSize - 1\)/g, ".limit(100000)") },
  { id: "E", rule: "V06_locked_plan", why: "an inline PostgREST expression is built",
    mutate: (s) => s.replace("const from = (page - 1) * pageSize;",
      "const from = (page - 1) * pageSize;\n  const rogue = db().from(\"vendors\").or(`business_name.ilike.%${(paging as any).q}%`);") },
  { id: "F", rule: "V01_server_only", why: "the server-only marker is removed",
    mutate: (s) => s.replace('import "server-only";', "// removed") },
  { id: "G", rule: "V07_server_canonical", why: "a client-supplied fingerprint is trusted",
    mutate: (s) => s.replace("definition_fingerprint: normalized.fingerprint,", "definition_fingerprint: input.definition_fingerprint,") },
];
for (const fx of SVC_FIX) {
  const mutated = fx.mutate(serviceSrc); const changed = mutated !== serviceSrc;
  const ff = changed ? evaluateService(mutated) : [];
  const tripped = ff.some((x) => x.rule === fx.rule);
  record(`04 service fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "NO-OP" : tripped ? "tripped" : ff.map((x) => x.rule).join(",") || "none");
}

/* ===========================================================================
 * 3. Actions + routes + client
 * ========================================================================= */
const actionsSrc = read(ACTIONS);
const actFindings = evaluateActions(actionsSrc);
record("05 actions have zero findings", actFindings.length === 0,
  actFindings.map((x) => `${x.rule}: ${x.detail}`).join(" | ") || "use server, guarded, no direct DB, no delete/send/campaign action");
const ACT_FIX = [
  { id: "H", rule: "A03_every_action_guarded", why: "an action bypasses the guard",
    mutate: (s) => `${s}\nexport async function segmentRogue(id: string) {\n  return segments.getVendorSegment(id);\n}\n` },
  { id: "I", rule: "A04_no_forbidden_action", why: "a send action is exported",
    mutate: (s) => `${s}\nexport async function segmentSendCampaign(id: string) {\n  return run(() => segments.getVendorSegment(id));\n}\n` },
];
for (const fx of ACT_FIX) {
  const mutated = fx.mutate(actionsSrc); const changed = mutated !== actionsSrc;
  const ff = changed ? evaluateActions(mutated) : [];
  record(`06 action fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`,
    changed && ff.some((x) => x.rule === fx.rule),
    !changed ? "NO-OP" : ff.some((x) => x.rule === fx.rule) ? "tripped" : ff.map((x) => x.rule).join(",") || "none");
}

for (const [pg, label] of [[LIST_PAGE, "segment directory"], [EDIT_PAGE, "segment editor"]]) {
  const ff = evaluateRoute(read(pg));
  record(`07 route clean :: ${label}`, ff.length === 0,
    ff.map((x) => `${x.rule}: ${x.detail}`).join(" | ") || "admin-guarded, fixed error constant, no raw message");
}
const routeSrc = read(LIST_PAGE);
const ROUTE_FIX = [
  { id: "J", rule: "R02_safe_route_error", why: "the route renders e.message",
    mutate: (s) => s.replace(/error = SEGMENT_DIRECTORY_LOAD_ERROR;/, 'error = (e as Error).message;') },
  { id: "K", rule: "R01_admin_guarded", why: "the Superadmin check is removed",
    mutate: (s) => s.replace(/if \(!session\.isSuperadmin\) redirect\("\/admin\/login\?error=unauthorized"\);/, "") },
];
for (const fx of ROUTE_FIX) {
  const mutated = fx.mutate(routeSrc); const changed = mutated !== routeSrc;
  const ff = changed ? evaluateRoute(mutated) : [];
  record(`08 route fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`,
    changed && ff.some((x) => x.rule === fx.rule),
    !changed ? "NO-OP" : ff.some((x) => x.rule === fx.rule) ? "tripped" : "none");
}

for (const cf of CLIENT_FILES) {
  const ff = evaluateClient(read(cf));
  record(`09 client clean :: ${cf}`, ff.length === 0,
    ff.map((x) => `${x.rule}: ${x.detail}`).join(" | ") || "use client, no service-role");
}
const listUi = read(LIST_UI);
record("10 client fixture L trips C02_no_service_role :: client imports the segment service", (() => {
  const m = listUi.replace('"use client";', '"use client";\nimport { listVendorSegments } from "@/services/vendorSegmentService";');
  return evaluateClient(m).some((x) => x.rule === "C02_no_service_role");
})(), "tripped");

/* ===========================================================================
 * 4. UI invariants — no send/delete control, explicit preview-only warning
 * ========================================================================= */
const editUi = read(EDIT_UI);
record("11 UI states preview-only / not communication authorization", (() => {
  const both = (listUi + editUi).toLowerCase();
  return both.includes("preview only") && both.includes("not communication authorization");
})(), "explicit warning present on both surfaces");
record("12 UI exposes no delete / send / campaign control", (() => {
  const both = listUi + editUi;
  // Target CONTROL AFFORDANCES, not prose — the preview-only warning legitimately
  // contains the words "send approval" and "never send authorization".
  const forbiddenAction = /\b(segmentDelete|segmentSend|segmentDispatch|segmentCampaign)\b/;
  const forbiddenButton = />\s*(Delete|Send|Test send|Dispatch|Create campaign)\s*</i;
  const forbiddenImport = /from\s+["'][^"']*(campaign|provider|whatsapp)[^"']*["']/i;
  return !forbiddenAction.test(both) && !forbiddenButton.test(both) && !forbiddenImport.test(both);
})(), "archive is the only removal affordance; no send/campaign control or import");
record("13 rule builder offers only closed field/operator choices", (() => {
  return /SEGMENT_FIELDS/.test(editUi) && /Object\.keys\(SEGMENT_FIELDS\)/.test(editUi)
    && /spec\?\.operators/.test(editUi)
    && !/<input[^>]*placeholder=["']field/i.test(editUi);
})(), "fields and operators come from the locked registry");
record("14 rule builder surfaces the locked bounds", (() => {
  return /SEGMENT_MAX_GROUPS/.test(editUi) && /SEGMENT_MAX_PREDICATES_PER_GROUP/.test(editUi)
    && /SEGMENT_MAX_PREDICATES_TOTAL/.test(editUi);
})(), "group/rule bounds are visible to the operator");

/* ===========================================================================
 * 5. Admin navigation
 * ========================================================================= */
const navSrc = read(NAV);
record("15 admin nav exposes the segment section", (() => {
  return /vendor-segments/.test(navSrc) && /\/admin\/vendor-crm\/segments/.test(navSrc)
    && /sections: \[[^\]]*"vendor-segments"/.test(navSrc);
})(), "listed in the Command Center group");

/* ===========================================================================
 * 6. No public/vendor exposure anywhere
 * ========================================================================= */
record("16 no public or vendor surface references a segment object", (() => {
  const publicish = ["app/page.tsx", "app/enquiry/page.tsx"].filter((p) => existsSync(path.join(ROOT, p)));
  const joined = publicish.map(read).join("\n");
  return !/vendor_segments|segmentPreview|vendorSegmentService/.test(joined);
})(), "public entry points carry no segment reference");

/* ===========================================================================
 * 7. BEHAVIOURAL — the real planner, executed
 * ========================================================================= */
const plan = await import("../../../lib/crm/segmentQueryPlan.ts");
const rules = await import("../../../lib/crm/segmentRuleValidation.ts");
const { planSegmentQuery, boundPreviewPaging, SEGMENT_PREVIEW_MAX_PAGE_SIZE, SEGMENT_PRERESOLVE_MAX } = plan;
const { normalizeSegmentDefinition, validateSegmentDefinition } = rules;

const AT = new Date("2026-07-25T00:00:00.000Z");
const def = (groups, combinator = "AND") => ({ schema_version: 1, combinator, groups });
const grp = (predicates, combinator = "AND") => ({ combinator, predicates });
const compile = (d) => {
  const n = normalizeSegmentDefinition(d);
  const p = planSegmentQuery(n.definition, AT);
  const resolved = new Map(p.preResolutions.map((x) => [x.key, ["11111111-1111-4111-8111-111111111111"]]));
  return { plan: p, expr: p.buildExpression(resolved) };
};

record("17 a core-only rule needs zero pre-resolutions", (() => {
  const { plan: p, expr } = compile(def([grp([{ field: "core.status", op: "in", value: ["Approved"] }])]));
  return p.preResolutions.length === 0 && expr === 'status.in.("Approved")';
})(), "single term, values quoted");
record("18 every core operator compiles to a fixed term shape", (() => {
  const cases = [
    [{ field: "core.is_active", op: "is_true" }, "is_active.is.true"],
    [{ field: "core.is_active", op: "is_false" }, "is_active.is.false"],
    [{ field: "core.remaining_credits", op: "lt", value: 5 }, "remaining_credits.lt.5"],
    [{ field: "core.total_credits", op: "between", value: [0, 9] }, "and(total_credits.gte.0,total_credits.lte.9)"],
    [{ field: "core.last_assigned_at", op: "is_null" }, "last_assigned_at.is.null"],
    [{ field: "core.city", op: "eq", value: "Pune" }, 'city.eq."Pune"'],
  ];
  return cases.every(([p, want]) => compile(def([grp([p])])).expr === want);
})(), "eq/is/lt/between/is_null all deterministic");
record("19 relative windows resolve from the single evaluatedAt", (() => {
  const { expr } = compile(def([grp([{ field: "core.created_at", op: "within_last_days", value: 30 }])]));
  return expr === 'created_at.gte."2026-06-25T00:00:00.000Z"';
})(), "no per-predicate now()");
record("20 array operators use the PostgREST array literal form", (() => {
  const a = compile(def([grp([{ field: "core.service_categories", op: "array_contains_any", value: ["Modular Kitchen"] }])])).expr;
  const b = compile(def([grp([{ field: "core.areas_covered", op: "array_contains_all", value: ["Kharadi"] }])])).expr;
  return a === 'service_categories.ov.{"Modular Kitchen"}' && b === 'areas_covered.cs.{"Kharadi"}';
})(), "ov / cs with quoted members");
record("21 a CRM predicate becomes exactly one batched pre-resolution", (() => {
  const { plan: p, expr } = compile(def([grp([{ field: "crm.onboarding_stage", op: "eq", value: "active" }])]));
  return p.preResolutions.length === 1 && p.preResolutions[0].relation === "vendor_crm_profiles"
    && expr === 'id.in.("11111111-1111-4111-8111-111111111111")';
})(), "no per-vendor lookup");
record("22 duplicate CRM predicates resolve once, not twice", (() => {
  const { plan: p } = compile(def([
    grp([{ field: "crm.onboarding_stage", op: "eq", value: "active" }]),
    grp([{ field: "crm.onboarding_stage", op: "eq", value: "active" }]),
  ], "OR"));
  return p.preResolutions.length === 1;
})(), "pre-resolutions are de-duplicated by key");
record("23 pre-resolution count is bounded by the AST, not by vendor count", (() => {
  const preds = ["crm.onboarding_stage", "crm.relationship_status", "crm.travel_radius_km", "crm.years_in_business"]
    .map((f, i) => f.includes("km") || f.includes("years")
      ? { field: f, op: "gte", value: i + 1 }
      : { field: f, op: "is_not_null" });
  const { plan: p } = compile(def([grp(preds)]));
  return p.preResolutions.length === preds.length && p.preResolutions.length <= 24;
})(), "one query per distinct CRM predicate — constant in vendor count");
record("24 a negated CRM predicate compiles to not.id.in", (() => {
  const { expr } = compile(def([grp([{ field: "crm.has_open_task", op: "is_false" }])]));
  return expr === 'not.id.in.("11111111-1111-4111-8111-111111111111")';
})(), "negation without a second query");
record("25 empty positive set matches nobody; empty negated set matches all", (() => {
  const n = normalizeSegmentDefinition(def([grp([{ field: "crm.has_open_task", op: "is_true" }])]));
  const p = planSegmentQuery(n.definition, AT);
  const pos = p.buildExpression(new Map(p.preResolutions.map((x) => [x.key, []])));
  const n2 = normalizeSegmentDefinition(def([grp([{ field: "crm.has_open_task", op: "is_false" }])]));
  const p2 = planSegmentQuery(n2.definition, AT);
  const neg = p2.buildExpression(new Map(p2.preResolutions.map((x) => [x.key, []])));
  return pos === "id.is.null" && neg === "id.not.is.null";
})(), "empty-set semantics are explicit, never a silent match-all");
record("26 group and top-level combinators nest deterministically", (() => {
  const { expr } = compile(def([
    grp([{ field: "core.is_active", op: "is_true" }, { field: "core.status", op: "eq", value: "Approved" }], "AND"),
    grp([{ field: "core.city", op: "eq", value: "Pune" }], "AND"),
  ], "OR"));
  return expr.startsWith("or(") && expr.includes("and(") && (expr.match(/and\(/g) || []).length >= 1;
})(), "or(and(...),...) shape");
record("27 the same canonical definition always compiles to the same expression", (() => {
  const a = compile(def([grp([{ field: "core.status", op: "in", value: ["Approved", "Pending"] }])])).expr;
  const b = compile(def([grp([{ field: "core.status", op: "in", value: ["Pending", "Approved"] }])])).expr;
  return a === b;
})(), "array ordering is canonicalized before planning");
record("28 an over-large pre-resolution fails closed", (() => {
  const n = normalizeSegmentDefinition(def([grp([{ field: "crm.has_open_task", op: "is_true" }])]));
  const p = planSegmentQuery(n.definition, AT);
  const huge = Array.from({ length: SEGMENT_PRERESOLVE_MAX + 1 }, (_, i) => `id-${i}`);
  try { p.buildExpression(new Map(p.preResolutions.map((x) => [x.key, huge]))); return false; }
  catch (e) { return e.name === "SegmentPlanError"; }
})(), "refuses rather than truncating silently");
record("29 planner rejects an invalid evaluatedAt", (() => {
  const n = normalizeSegmentDefinition(def([grp([{ field: "core.is_active", op: "is_true" }])]));
  try { planSegmentQuery(n.definition, new Date("nope")); return false; }
  catch (e) { return e.name === "SegmentPlanError"; }
})(), "no silent fallback to now()");

/* -- injection: nothing user-controlled can alter the expression grammar ---- */
const INJECTION_TOKENS = [
  'Approved,is_active.eq.true',
  'Approved") or ("1"="1',
  "Approved%",
  "Approved*",
  "Approved(1)",
  "Approved\\",
];
for (const tok of INJECTION_TOKENS) {
  record(`30 injection token rejected before planning :: ${JSON.stringify(tok).slice(0, 30)}`, (() => {
    try { validateSegmentDefinition(def([grp([{ field: "core.service_categories", op: "array_contains_any", value: [tok] }])])); return false; }
    catch (e) { return e.name === "SegmentValidationError"; }
  })(), "open-vocabulary values are charset-restricted");
}
record("31 a legitimate open-vocabulary token still works", (() => {
  const { expr } = compile(def([grp([{ field: "core.service_categories", op: "array_contains_any", value: ["Modular Kitchen & Wardrobe"] }])]));
  return expr === 'service_categories.ov.{"Modular Kitchen & Wardrobe"}';
})(), "ampersands, spaces and hyphens survive");
record("32 every compiled expression is free of unquoted grammar", (() => {
  const samples = [
    def([grp([{ field: "core.status", op: "in", value: ["Approved", "Pending"] }])]),
    def([grp([{ field: "core.city", op: "eq", value: "Pune" }, { field: "core.is_active", op: "is_true" }])]),
    def([grp([{ field: "crm.tag_id", op: "in", value: ["11111111-1111-4111-8111-111111111111"] }])]),
  ];
  return samples.every((d) => {
    const e = compile(d).expr;
    // every literal must sit inside double quotes or be a bare number/keyword.
    return !/\.(eq|in|gte|lte|lt|gt)\.[^"({\d]/.test(e);
  });
})(), "no bare string literal reaches the expression");

/* -- paging bounds ---------------------------------------------------------- */
record("33 preview paging is clamped to the locked maximum", (() => {
  const a = boundPreviewPaging(1, 100000);
  const b = boundPreviewPaging(-5, 0);
  const c = boundPreviewPaging(3, 10);
  return a.pageSize === SEGMENT_PREVIEW_MAX_PAGE_SIZE && b.page === 1 && b.pageSize === 25
    && c.page === 3 && c.pageSize === 10 && SEGMENT_PREVIEW_MAX_PAGE_SIZE === 100;
})(), "max 100, sane defaults");

/* -- prohibited inputs remain prohibited at runtime ------------------------- */
for (const [field, label] of [
  ["core.days_to_expiry", "package expiry"],
  ["core.consent_status", "consent"],
  ["core.is_suppressed", "suppression"],
  ["core.communication_authorization", "communication authorization"],
  ["core.campaign_eligibility", "campaign eligibility"],
  ["crm.contact_phone", "contact PII"],
  ["crm.note_body", "note content"],
  ["crm.ai_score", "AI score"],
]) {
  record(`34 runtime still refuses :: ${label}`, (() => {
    try { validateSegmentDefinition(def([grp([{ field, op: "eq", value: "x" }])])); return false; }
    catch (e) { return e.name === "SegmentValidationError"; }
  })(), field);
}

/* ===========================================================================
 * 8. Docs
 * ========================================================================= */
const bp = read("docs/QF-MVP-30-VENDOR-CRM-BLUEPRINT.md").toLowerCase();
const board = read("docs/QF-MVP-EXECUTION-BOARD.md").toLowerCase();
record("35 blueprint records the 30.3B application and the 30.3C runtime", (() => {
  return bp.includes("30.3b") && bp.includes("22/22") && bp.includes("30.3c")
    && bp.includes("/admin/vendor-crm/segments");
})(), "application + runtime recorded");
record("36 board records 30.3B applied and 30.3C implemented", (() => {
  return board.includes("30.3b") && board.includes("30.3c") && board.includes("vendor_segments");
})(), "execution board updated");

/* ===========================================================================
 * Report
 * ========================================================================= */
const passed = results.filter((r) => r.ok).length;
console.log("== QF-MVP-30.3C deterministic segment runtime validator ==");
for (const r of results) { console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`); if (!r.ok) console.log(`         ${r.detail}`); }
console.log("");
console.log(`checks: ${passed} passed, ${results.length - passed} failed (of ${results.length})`);
console.log(`fixtures: ${SVC_FIX.length} service + ${ACT_FIX.length} action + ${ROUTE_FIX.length} route + 1 client one-defect mutations`);
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
