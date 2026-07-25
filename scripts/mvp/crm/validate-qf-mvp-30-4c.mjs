#!/usr/bin/env node
/**
 * QF-MVP-30.4C — offline validator for the vendor campaign RUNTIME.
 *
 * Grades the real runtime artifacts (service, actions, routes, components, admin
 * nav) and EXECUTES the real pure audience planner. One-defect fixtures mutate
 * copies to prove each rule actually trips.
 *
 * The 30.4A foundation validator still owns the migration/contract/verifier
 * layer; this file adds the runtime layer on top of it and never restates it.
 *
 * WHY THE CONSENT AUTHORITY IS NOT EXECUTED HERE
 *   services/communicationConsentDecisionService.ts imports the Supabase client,
 *   and the MVP loader deliberately refuses to resolve Supabase/service modules
 *   (they perform I/O). So the authority is graded STATICALLY — its disposition
 *   vocabulary and its injected-dependency contract are read from its source and
 *   asserted against what the runtime relies on — while the batching boundary
 *   that feeds it is executed for real. A behavioural end-to-end consent proof
 *   belongs to the staging smoke, not to an offline gate.
 *
 * Section 8 executes `.ts` modules, so the type-stripping loader must be registered.
 *
 * Usage:  npm run test:crm:30-4c                                (exit 0 = PASS)
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SERVICE = "services/vendorCampaignService.ts";
const ACTIONS = "app/actions/vendorCampaignActions.ts";
const LIST_PAGE = "app/admin/vendor-crm/campaigns/page.tsx";
const EDIT_PAGE = "app/admin/vendor-crm/campaigns/[campaignId]/page.tsx";
const LIST_UI = "components/admin/crm/campaigns/VendorCampaignDirectory.tsx";
const EDIT_UI = "components/admin/crm/campaigns/VendorCampaignEditor.tsx";
const PLANNER = "lib/crm/campaignAudiencePlan.ts";
const CONTRACTS = "lib/crm/campaignContracts.ts";
const VALIDATION = "lib/crm/campaignValidation.ts";
const MIGRATION = "supabase/migrations/20260723001300_qf_mvp_vendor_campaign_foundation.sql";
const AUTHORITY = "services/communicationConsentDecisionService.ts";
const PHONE = "lib/communication/phone.ts";
const SEGMENT_SERVICE = "services/vendorSegmentService.ts";
const NAV = "components/admin/adminConfig.ts";
const CLIENT_FILES = [LIST_UI, EDIT_UI];

const results = [];
let failed = false;
const record = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) failed = true; };
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
/** Executable source only: strip line and block comments, so prose never scores. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/* ===========================================================================
 * SERVICE evaluator — the server-only campaign boundary
 * ========================================================================= */
export function evaluateService(src) {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  const exec = code(src);

  // W01 server-only placement.
  if (!/import\s+["']server-only["']/.test(src)) add("W01_server_only", "missing `import \"server-only\"`");
  if (!/adminClient\(\)/.test(exec)) add("W01_server_only", "does not use the service_role adminClient");

  // W02 no Core / foreign write of any kind. Reads are legitimate; writes are not.
  for (const t of ["vendors", "leads", "lead_assignments", "profiles", "packages",
    "vendor_credit_logs", "vendor_package_orders", "vendor_subscriptions",
    "communication_suppressions", "communication_preferences", "communication_templates",
    "communication_consent_events", "communication_messages", "communication_intents",
    "vendor_segments", "vendor_crm_profiles", "vendor_contacts", "vendor_tags",
    "vendor_tag_assignments", "vendor_internal_notes", "vendor_tasks"]) {
    if (new RegExp(`from\\(["']${t}["']\\)[\\s\\S]{0,200}?\\.(insert|update|upsert|delete)\\b`).test(exec)) {
      add("W02_no_foreign_write", `mutates ${t}`);
    }
  }
  // W03 no hard delete anywhere.
  if (/\.delete\(\)/.test(exec)) add("W03_no_hard_delete", "calls .delete()");
  if (/export async function \w*(delete|Delete|destroy|Destroy|purge|Purge)\w*/.test(exec)) {
    add("W03_no_hard_delete", "a delete method is exported");
  }
  // W04 the frozen audience is written ONLY by the prepare RPC.
  if (/from\(["']vendor_campaign_audience_members["']\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\b/.test(exec)) {
    add("W04_audience_rpc_only", "writes the frozen audience directly");
  }
  if (!/qf_prepare_vendor_campaign_v1/.test(exec)) add("W04_audience_rpc_only", "does not call the prepare RPC");
  if (!/qf_approve_vendor_campaign_v1/.test(exec)) add("W04_audience_rpc_only", "does not call the approve RPC");
  // the event log is append-only: insert is the only legal verb.
  if (/from\(["']vendor_campaign_events["']\)[\s\S]{0,160}?\.(update|upsert|delete)\b/.test(exec)) {
    add("W04_audience_rpc_only", "mutates the append-only event log");
  }

  // W05 no execution: no intent, no provider, no dispatch, no template render.
  for (const bad of ["communication_intents", "sendWhatsApp", "sendMessage", "dispatch",
    "providerAdapter", "whatsappCloud", "renderTemplate", "templateBody", "n8n"]) {
    if (new RegExp(`\\b${bad}\\b`, "i").test(exec)) add("W05_no_execution", `references ${bad}`);
  }
  if (/export async function \w*(send|Send|dispatch|Dispatch|execute|Execute)\w*/.test(exec)) {
    add("W05_no_execution", "an execution method is exported");
  }
  // W06 no frequency-policy claim — none exists (QF-MVP-30.5 gate).
  if (/frequency/i.test(exec)) add("W06_no_frequency_claim", "references a frequency authority");

  // W07 no plaintext destination is persisted or returned.
  if (/(insert|update)\(\{[\s\S]{0,400}?\bphone\b/.test(exec)) add("W07_no_destination_leak", "writes a phone column");
  if (/return[\s\S]{0,200}?\bphone:/.test(exec)) add("W07_no_destination_leak", "returns a phone field");
  if (/console\.[a-z]+\([\s\S]{0,120}?\bphone\b/.test(exec)) add("W07_no_destination_leak", "logs a phone");
  if (/select\(["'][^"']*\bphone\b[^"']*["']\)[\s\S]{0,400}?vendor_campaign/.test(exec)) {
    add("W07_no_destination_leak", "selects a phone into a campaign shape");
  }

  // W08 consent comes from the SOLE authority, with batched dependencies.
  if (!/decideCommunicationConsent/.test(exec)) add("W08_authority_reused", "does not call the consent authority");
  if (!/buildBatchConsentDeps/.test(exec)) add("W08_authority_reused", "does not inject batched dependencies");
  if (/defaultConsentDecisionDeps/.test(exec)) add("W08_authority_reused", "uses the per-call default deps (N+1)");
  // a second consent implementation is forbidden.
  if (/marketing_opted_in\s*[:=]|disposition\s*===\s*["']blocked["']/.test(exec)) {
    add("W08_authority_reused", "decides a disposition locally");
  }
  // the per-vendor loop must not perform I/O.
  if (/for\s*\(\s*const\s+\w+\s+of\s+vendorIds[\s\S]{0,900}?\bdb\(\)/.test(exec)) {
    add("W08_authority_reused", "queries the database inside the per-vendor loop");
  }

  // W09 the ONE canonical destination hasher, never a second implementation.
  if (!/hashPhoneE164/.test(exec)) add("W09_canonical_hash", "does not use the canonical hasher");
  if (/createHash\(/.test(exec)) add("W09_canonical_hash", "hashes locally instead of reusing hashPhoneE164");

  // W10 no raw DB error text escapes.
  if (/(error|e)\.message/.test(exec)) add("W10_safe_errors", "references a raw error message");
  if (/CampaignServiceError\([^)]*\berror\b/.test(exec)) add("W10_safe_errors", "wraps a raw DB error");

  // W11 every read is bounded and deterministically ordered.
  if (!/\.range\(/.test(exec)) add("W11_bounded_reads", "a list read is not server-paged (.range)");
  if (!/\.order\(["']id["']/.test(exec)) add("W11_bounded_reads", "no deterministic id tie-breaker");
  if (!/HELPER_SCAN_LIMIT/.test(exec)) add("W11_bounded_reads", "helper reads are unbounded");
  if (!/CANDIDATE_MAX_PAGES/.test(exec)) add("W11_bounded_reads", "candidate paging is unbounded");
  // a PostgREST select is a GET: an unchunked in() over a full audience would
  // build a several-hundred-KB URL and be rejected outright.
  if (!/BATCH_IN_SIZE/.test(exec)) add("W11_bounded_reads", "an in() batch is not chunked");
  if (/\.in\(["']destination_hash["'],\s*hashes\)/.test(exec)) add("W11_bounded_reads", "suppressions read the whole hash set in one in()");
  if (/\.in\(["'](id|principal_id)["'],\s*vendorIds\)/.test(exec)) add("W11_bounded_reads", "an id batch reads the whole audience in one in()");

  // W15 an OMITTED field keeps its value; an EXPLICIT null clears it. `??`
  // collapses the two, so a segment/template could never be de-selected.
  if (/input\.\w+\s*\?\?\s*current\./.test(exec)) {
    add("W15_explicit_clear", "a draft patch uses ?? and cannot distinguish null from omitted");
  }

  // W12 optimistic concurrency on every non-RPC transition.
  if (!/REVISION_MISMATCH/.test(exec)) add("W12_optimistic_concurrency", "no revision guard");
  if (!/\.eq\(["']revision["'],\s*current\.revision\)/.test(exec)) {
    add("W12_optimistic_concurrency", "an update does not predicate on the observed revision");
  }

  // W13 a return to draft must RETAIN the monotonic prepared snapshot pointer.
  if (/prepared_snapshot_revision:\s*null/.test(exec)) {
    add("W13_snapshot_revision_retained", "clears prepared_snapshot_revision, resetting snapshot numbering");
  }
  if (/prepared_snapshot_id:\s*null/.test(exec)) {
    add("W13_snapshot_revision_retained", "clears prepared_snapshot_id");
  }

  // W14 the segment engine is reused, never reimplemented.
  if (!/previewVendorSegment/.test(exec)) add("W14_segment_engine_reused", "does not use the segment engine");
  if (/planSegmentQuery|\.or\(\s*`/.test(exec)) add("W14_segment_engine_reused", "builds its own segment query");

  // W16 (QF-MVP-30.4C1) the runtime must supply a REAL template fingerprint.
  // Passing null was the exact pre-correction defect: prepared evidence carried
  // no template fingerprint at all, so approval could not detect catalog drift.
  if (/p_template_fingerprint:\s*null/.test(exec)) {
    add("W16_template_fingerprint_supplied", "passes a NULL template fingerprint to prepare");
  }
  if (!/fingerprintCommunicationTemplate/.test(exec)) {
    add("W16_template_fingerprint_supplied", "never computes the canonical template fingerprint");
  }
  if (!/p_template_fingerprint:\s*expectedTemplateFingerprint/.test(exec)) {
    add("W16_template_fingerprint_supplied", "does not pass the computed fingerprint as the expected value");
  }
  // the fingerprint is computed over the whole dispatch-critical field set, so
  // the read must select all of them rather than a convenient subset.
  if (!/TEMPLATE_FINGERPRINT_FIELDS/.test(exec)) {
    add("W16_template_fingerprint_supplied", "does not read the full dispatch-critical template field set");
  }

  return f;
}

/* ===========================================================================
 * ACTIONS evaluator
 * ========================================================================= */
export function evaluateActions(src) {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  if (!/^"use server";/m.test(src)) add("B01_use_server", "not marked \"use server\"");
  if (!/const actor = await requireCrmAdmin\(\)/.test(src)) add("B02_guarded", "actor is not derived from the guard");

  const exported = [...src.matchAll(/export async function (\w+)\(([\s\S]*?)\n\}/g)];
  for (const [, name, body] of exported) {
    if (!/\brun\(/.test(body)) add("B03_every_action_guarded", `${name} bypasses run()`);
  }
  if (exported.length < 10) add("B03_every_action_guarded", `only ${exported.length} actions found`);

  // no delete / send / dispatch / provider action may exist.
  if (/export async function \w*(Delete|Destroy|Send|Dispatch|Execute|Provider)\w*/i.test(src)) {
    add("B04_no_forbidden_action", "a delete/send/dispatch action is exported");
  }
  if (/adminClient|createClient|@supabase/.test(src)) add("B05_no_direct_db", "actions touch a DB client directly");
  // an actor id must never be accepted from the caller.
  if (/actor(Id)?\s*[:,)]\s*(input|params|args)\./.test(src)) add("B06_actor_never_from_input", "actor comes from input");
  return f;
}

/* ===========================================================================
 * ROUTE evaluator
 * ========================================================================= */
export function evaluateRoute(src) {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  if (!/getAdminSession\(\)/.test(src)) add("D01_admin_guarded", "no getAdminSession");
  if (!/isSuperadmin/.test(src)) add("D01_admin_guarded", "no isSuperadmin check");
  if (!/redirect\(/.test(src)) add("D01_admin_guarded", "no redirect on failure");
  if (/adminClient/.test(src)) add("D01_admin_guarded", "route uses the service-role client directly");
  if (/\.message\b/.test(src)) add("D02_safe_route_error", "references the raw error message field");
  if (!/const\s+CAMPAIGN_[A-Z_]*ERROR\s*=/.test(src)) add("D02_safe_route_error", "no fixed error constant");
  return f;
}

/* ===========================================================================
 * CLIENT evaluator
 * ========================================================================= */
export function evaluateClient(src) {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  if (!/^\s*["']use client["']/.test(src)) add("E01_use_client", "not marked \"use client\"");
  if (/adminClient|serverClient|["']server-only["']|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE/.test(src)) {
    add("E02_no_service_role", "imports/uses server-only or service-role code");
  }
  if (/^\s*import\s+(?!type\b)[^;]*from\s+["'][^"']*services\/vendorCampaignService["']/m.test(src)) {
    add("E02_no_service_role", "value-imports the server-only campaign service");
  }
  if (/createClient\(|@supabase\/supabase-js/.test(src)) add("E02_no_service_role", "instantiates a Supabase client");
  return f;
}

/* ===========================================================================
 * 1. Files exist, at the locked paths
 * ========================================================================= */
for (const file of [SERVICE, ACTIONS, LIST_PAGE, EDIT_PAGE, LIST_UI, EDIT_UI, PLANNER]) {
  record(`01 present :: ${file}`, existsSync(path.join(ROOT, file)), file);
}
record("02 exact routes are admin-scoped only", (() => {
  return existsSync(path.join(ROOT, LIST_PAGE)) && existsSync(path.join(ROOT, EDIT_PAGE))
    && !existsSync(path.join(ROOT, "app/campaigns"))
    && !existsSync(path.join(ROOT, "app/vendor/campaigns"))
    && !existsSync(path.join(ROOT, "app/api/campaigns"));
})(), "/admin/vendor-crm/campaigns only; no public, vendor or API surface");

/* ===========================================================================
 * 2. Service — zero findings + one-defect fixtures
 * ========================================================================= */
const serviceSrc = read(SERVICE);
const svcFindings = evaluateService(serviceSrc);
record("03 service has zero findings", svcFindings.length === 0,
  svcFindings.map((x) => `${x.rule}: ${x.detail}`).join(" | ")
  || "server-only, no foreign write, no delete, audience via RPC only, no execution, batched authority");

const SVC_FIX = [
  { id: "A", rule: "W02_no_foreign_write", why: "the service writes a Core table",
    mutate: (s) => `${s}\nexport async function bad() { return db().from("vendors").update({ is_active: true }); }\n` },
  { id: "B", rule: "W03_no_hard_delete", why: "a hard delete is added",
    mutate: (s) => `${s}\nexport async function badDel(id: string) { return db().from("vendor_campaigns").delete().eq("id", id); }\n` },
  { id: "C", rule: "W04_audience_rpc_only", why: "the frozen audience is written directly",
    mutate: (s) => `${s}\nexport async function badFreeze() { return db().from("vendor_campaign_audience_members").insert({}); }\n` },
  { id: "D", rule: "W05_no_execution", why: "a communication intent is created",
    mutate: (s) => `${s}\nexport async function badIntent() { return db().from("communication_intents").insert({}); }\n` },
  { id: "E", rule: "W06_no_frequency_claim", why: "a frequency check is claimed",
    mutate: (s) => `${s}\nexport function frequencyAllows() { return true; }\n` },
  { id: "F", rule: "W08_authority_reused", why: "the per-call default deps reintroduce the N+1",
    mutate: (s) => s.replace("}, deps);", "}, defaultConsentDecisionDeps());") },
  { id: "G", rule: "W09_canonical_hash", why: "a second hash implementation is introduced",
    mutate: (s) => s.replace("const hash = normalized.ok ? hashPhoneE164(v.phone as string) : null;",
      "const hash = normalized.ok ? createHash(\"sha256\").update(String(v.phone)).digest(\"hex\") : null;") },
  { id: "H", rule: "W10_safe_errors", why: "a raw DB message is surfaced",
    mutate: (s) => s.replace('if (error) throw serviceError("CAMPAIGN_PREPARE_FAILED");',
      'if (error) throw new CampaignServiceError("X", error.message);') },
  { id: "I", rule: "W13_snapshot_revision_retained", why: "a return to draft resets snapshot numbering",
    mutate: (s) => s.replace('.update({ status: "draft", revision: nextRevision, updated_by: actor })',
      '.update({ status: "draft", revision: nextRevision, updated_by: actor, prepared_snapshot_revision: null })') },
  { id: "J", rule: "W01_server_only", why: "the server-only marker is removed",
    mutate: (s) => s.replace('import "server-only";', "// removed") },
  { id: "K", rule: "W12_optimistic_concurrency", why: "the revision predicate is dropped",
    mutate: (s) => s.replace(/\.eq\("id", id\)\.eq\("revision", current\.revision\)/g, '.eq("id", id)') },
  { id: "S", rule: "W11_bounded_reads", why: "an evidence batch reads the whole audience in one in()",
    mutate: (s) => s.replace('.in("principal_id", batch)', '.in("principal_id", vendorIds)') },
  { id: "T", rule: "W15_explicit_clear", why: "a draft patch collapses null into omitted",
    mutate: (s) => s.replace("name: patched(input.name, current.name),", "name: input.name ?? current.name,") },
  { id: "U", rule: "W16_template_fingerprint_supplied", why: "the runtime reverts to passing a NULL template fingerprint",
    mutate: (s) => s.replace("p_template_fingerprint: expectedTemplateFingerprint,", "p_template_fingerprint: null,") },
  { id: "L", rule: "W07_no_destination_leak", why: "a phone is logged",
    mutate: (s) => s.replace("if (hash) hashes.push(hash);", "console.error(\"dbg\", v.phone);\n    if (hash) hashes.push(hash);") },
];
for (const fx of SVC_FIX) {
  const mutated = fx.mutate(serviceSrc);
  const changed = mutated !== serviceSrc;
  const ff = changed ? evaluateService(mutated) : [];
  const tripped = ff.some((x) => x.rule === fx.rule);
  record(`04 service fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "NO-OP (the anchor no longer exists)" : tripped ? "tripped" : ff.map((x) => x.rule).join(",") || "none");
}

/* ===========================================================================
 * 3. Actions + routes + client shells
 * ========================================================================= */
const actionsSrc = read(ACTIONS);
const actFindings = evaluateActions(actionsSrc);
record("05 actions have zero findings", actFindings.length === 0,
  actFindings.map((x) => `${x.rule}: ${x.detail}`).join(" | ")
  || "use server, every action guarded, no direct DB, no delete/send action");

const ACT_FIX = [
  { id: "M", rule: "B03_every_action_guarded", why: "an action bypasses the guard",
    mutate: (s) => `${s}\nexport async function campaignRogue(id: string) {\n  return campaigns.getVendorCampaign(id);\n}\n` },
  { id: "N", rule: "B04_no_forbidden_action", why: "a send action is exported",
    mutate: (s) => `${s}\nexport async function campaignSend(id: string) {\n  return run(() => campaigns.getVendorCampaign(id));\n}\n` },
  { id: "O", rule: "B05_no_direct_db", why: "an action touches a DB client",
    mutate: (s) => s.replace('import { revalidatePath } from "next/cache";',
      'import { revalidatePath } from "next/cache";\nimport { adminClient } from "@/lib/supabase";') },
];
for (const fx of ACT_FIX) {
  const mutated = fx.mutate(actionsSrc);
  const changed = mutated !== actionsSrc;
  const ff = changed ? evaluateActions(mutated) : [];
  const tripped = ff.some((x) => x.rule === fx.rule);
  record(`06 action fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "NO-OP" : tripped ? "tripped" : ff.map((x) => x.rule).join(",") || "none");
}

for (const [pg, label] of [[LIST_PAGE, "campaign directory"], [EDIT_PAGE, "campaign editor"]]) {
  const ff = evaluateRoute(read(pg));
  record(`07 route clean :: ${label}`, ff.length === 0,
    ff.map((x) => `${x.rule}: ${x.detail}`).join(" | ") || "admin-guarded, fixed error constant, no raw message");
}
const routeSrc = read(LIST_PAGE);
const ROUTE_FIX = [
  { id: "P", rule: "D02_safe_route_error", why: "the route renders e.message",
    mutate: (s) => s.replace(/error = CAMPAIGN_DIRECTORY_LOAD_ERROR;/, "error = (e as Error).message;") },
  { id: "Q", rule: "D01_admin_guarded", why: "the Superadmin check is removed",
    mutate: (s) => s.replace(/if \(!session\.isSuperadmin\) redirect\("\/admin\/login\?error=unauthorized"\);/, "") },
];
for (const fx of ROUTE_FIX) {
  const mutated = fx.mutate(routeSrc);
  const changed = mutated !== routeSrc;
  const ff = changed ? evaluateRoute(mutated) : [];
  const tripped = ff.some((x) => x.rule === fx.rule);
  record(`08 route fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "NO-OP" : tripped ? "tripped" : "none");
}

for (const cf of CLIENT_FILES) {
  const ff = evaluateClient(read(cf));
  record(`09 client clean :: ${cf}`, ff.length === 0,
    ff.map((x) => `${x.rule}: ${x.detail}`).join(" | ") || "use client, no service-role");
}
const listUi = read(LIST_UI);
const editUi = read(EDIT_UI);
record("10 client fixture R trips E02_no_service_role :: client value-imports the campaign service", (() => {
  const m = listUi.replace('"use client";', '"use client";\nimport { listVendorCampaigns } from "@/services/vendorCampaignService";');
  return evaluateClient(m).some((x) => x.rule === "E02_no_service_role");
})(), "tripped");

/* ===========================================================================
 * 4. UI invariants — approval is not a send
 * ========================================================================= */
record("11 both surfaces state that approval is not a send", (() => {
  const both = (listUi + editUi).toLowerCase();
  return both.split("approval is not a send").length - 1 >= 2;
})(), "explicit warning on the directory and the editor");
record("12 both surfaces name the QF-MVP-30.5 frequency gate", (() => {
  const both = (listUi + editUi).toLowerCase();
  return both.includes("qf-mvp-30.5") && both.includes("frequency");
})(), "the operator is told no campaign may send yet");
record("13 UI exposes no send / dispatch / delete control", (() => {
  const both = listUi + editUi;
  const forbiddenAction = /\b(campaignSend|campaignDispatch|campaignExecute|campaignDelete)\b/;
  const forbiddenButton = />\s*(Delete|Send|Send now|Test send|Dispatch|Execute)\s*</i;
  const forbiddenImport = /from\s+["'][^"']*(provider|whatsapp|n8n|communicationMessage)[^"']*["']/i;
  return !forbiddenAction.test(both) && !forbiddenButton.test(both) && !forbiddenImport.test(both);
})(), "archive/cancel are the only closing affordances");
record("14 the editor offers only closed vocabularies", (() => {
  return /CAMPAIGN_PURPOSES/.test(editUi) && /CAMPAIGN_CONSENT_SCOPES/.test(editUi)
    && /CAMPAIGN_CHANNELS/.test(editUi)
    && !/<input[^>]*placeholder=["'](purpose|scope|channel)/i.test(editUi);
})(), "purpose, scope and channel come from the locked contracts");
record("15 the editor renders no message body and no destination input", (() => {
  const forbidden = /<textarea|placeholder=["'][^"']*(phone|number|message|body)/i;
  return !forbidden.test(editUi) && !/template_body|renderTemplate|body\s*:/i.test(editUi);
})(), "a template is pinned by key/version, never composed here");
record("16 the frozen audience is shown without any destination column", (() => {
  const header = /header:\s*["'](Phone|Number|WhatsApp|Destination|Email)["']/i;
  return !header.test(editUi) && /consent_disposition/.test(editUi);
})(), "identity + enum consent evidence only");
record("17 the editor distinguishes segment CANDIDATES from the frozen audience", (() => {
  const t = editUi.toLowerCase();
  return t.includes("candidates, not the audience") && t.includes("frozen audience");
})(), "a preview is never presented as the audience");

/* ===========================================================================
 * 5. Admin navigation
 * ========================================================================= */
const navSrc = read(NAV);
record("18 admin nav exposes the campaign section", (() => {
  return /vendor-campaigns/.test(navSrc) && /\/admin\/vendor-crm\/campaigns/.test(navSrc)
    && /sections: \[[^\]]*"vendor-campaigns"/.test(navSrc);
})(), "listed in the Command Center group");
record("19 the segment section is still present (30.3C regression)", (() => {
  return /"vendor-segments"/.test(navSrc) && /\/admin\/vendor-crm\/segments/.test(navSrc);
})(), "the campaign entry did not displace the segment entry");

/* ===========================================================================
 * 6. No public / vendor exposure anywhere
 * ========================================================================= */
record("20 no public or vendor surface references a campaign object", (() => {
  const publicish = ["app/page.tsx", "app/enquiry/page.tsx"].filter((p) => existsSync(path.join(ROOT, p)));
  const joined = publicish.map(read).join("\n");
  return !/vendor_campaigns|vendorCampaignService|campaignPrepare|campaignApprove/.test(joined);
})(), "public entry points carry no campaign reference");
record("21 the segment service was not widened into a campaign writer", (() => {
  const s = code(read(SEGMENT_SERVICE));
  return !/vendor_campaigns|vendor_campaign_audience_members|qf_prepare_vendor_campaign_v1/.test(s);
})(), "30.3C boundary intact");

/* ===========================================================================
 * 7. STATIC alignment with authorities this runtime depends on
 * ========================================================================= */
const authoritySrc = read(AUTHORITY);
record("22 the runtime's includable dispositions exist in the authority", (() => {
  const contracts = read(CONTRACTS);
  const declared = [...contracts.matchAll(/INCLUDABLE_CONSENT_DISPOSITIONS = \[([\s\S]*?)\]/g)][0]?.[1] ?? "";
  const names = [...declared.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const union = [...authoritySrc.matchAll(/export type ConsentDisposition = ([^;]+);/g)][0]?.[1] ?? "";
  return names.length === 3 && names.every((n) => union.includes(`"${n}"`));
})(), "no invented disposition value");
record("23 'blocked' is a real authority value and is never includable", (() => {
  const union = [...authoritySrc.matchAll(/export type ConsentDisposition = ([^;]+);/g)][0]?.[1] ?? "";
  // bound the search to the array body: an unbounded scan would match the word
  // "blocked" anywhere later in the contracts file and pass for the wrong reason.
  const body = [...read(CONTRACTS).matchAll(/INCLUDABLE_CONSENT_DISPOSITIONS = \[([^\]]*)\]/g)][0]?.[1] ?? "MISSING";
  return union.includes('"blocked"') && body !== "MISSING" && !/blocked/.test(body);
})(), "the blocked case cannot be frozen into an audience");
record("24 the batched deps match the authority's injected-dependency contract", (() => {
  const planner = read(PLANNER);
  const iface = [...authoritySrc.matchAll(/export interface ConsentDecisionDeps \{([\s\S]*?)\n\}/g)][0]?.[1] ?? "";
  // TOP-LEVEL members only (2-space indent): the nested query-object literals
  // also declare `readonly` fields and would otherwise inflate the count.
  const methods = [...iface.matchAll(/^ {2}readonly (\w+)\s*[:(]/gm)].map((m) => m[1]);
  return methods.length === 3 && methods.every((m) => new RegExp(`\\b${m}\\b`).test(planner));
})(), "now / readSuppressions / readExactPreference are all supplied");
record("25 the authority requires a destination hash the runtime actually computes", (() => {
  const svc = code(serviceSrc);
  return /destinationHash:/.test(svc) && /hashPhoneE164/.test(svc)
    && /sha256/.test(read(PHONE)) && /identityConfidence:\s*["']exact["']/.test(svc);
})(), "sha256(canonical E.164) with an exact principal");
record("26 the prepare call passes exactly the migration's parameter names", (() => {
  const mig = read(MIGRATION);
  const sig = [...mig.matchAll(/create or replace function public\.qf_prepare_vendor_campaign_v1\(([\s\S]*?)\)\s*returns/g)][0]?.[1] ?? "";
  const params = [...sig.matchAll(/(p_\w+)\s+\w/g)].map((m) => m[1]);
  const call = [...serviceSrc.matchAll(/rpc\("qf_prepare_vendor_campaign_v1",\s*\{([\s\S]*?)\n\s*\}\)/g)][0]?.[1] ?? "";
  const passed = [...call.matchAll(/(p_\w+):/g)].map((m) => m[1]);
  return params.length === 11 && passed.length === 11
    && params.every((p) => passed.includes(p)) && passed.every((p) => params.includes(p));
})(), "11 parameters, exact names — a rename would silently pick a different overload");
record("27 the approve call passes exactly the migration's parameter names", (() => {
  const mig = read(MIGRATION);
  const sig = [...mig.matchAll(/create or replace function public\.qf_approve_vendor_campaign_v1\(([\s\S]*?)\)\s*returns/g)][0]?.[1] ?? "";
  const params = [...sig.matchAll(/(p_\w+)\s+\w/g)].map((m) => m[1]);
  const call = [...serviceSrc.matchAll(/rpc\("qf_approve_vendor_campaign_v1",\s*\{([\s\S]*?)\n\s*\}\)/g)][0]?.[1] ?? "";
  const passed = [...call.matchAll(/(p_\w+):/g)].map((m) => m[1]);
  return params.length === 4 && passed.length === 4 && params.every((p) => passed.includes(p));
})(), "4 parameters, exact names");
record("28 every failure code the runtime maps is a declared contract code", (() => {
  const contracts = read(CONTRACTS);
  const declared = new Set([...contracts.matchAll(/^\s*"([A-Z_]+)",$/gm)].map((m) => m[1]));
  const rpcCodes = [...read(MIGRATION).matchAll(/'code',\s*'([A-Z_]+)'/g)].map((m) => m[1]);
  const mapped = [...serviceSrc.matchAll(/^\s{2}([A-Z_]+):\s*"/gm)].map((m) => m[1]);
  // every code the RPCs can emit must be mapped to admin-facing text...
  const unmapped = rpcCodes.filter((c) => !mapped.includes(c));
  // ...and every mapped code is either a contract code or an explicit service code.
  const serviceOwn = ["CAMPAIGN_NAME_TAKEN", "CAMPAIGN_READ_FAILED", "CAMPAIGN_WRITE_FAILED",
    "CAMPAIGN_PREPARE_FAILED", "CAMPAIGN_APPROVE_FAILED"];
  const stray = mapped.filter((c) => !declared.has(c) && !serviceOwn.includes(c));
  return unmapped.length === 0 && stray.length === 0;
})(), "no RPC code falls through to generic text, no invented code");
record("29 the migration is unchanged by this phase", (() => {
  const mig = read(MIGRATION);
  return /grant select, insert on table public\.vendor_campaign_audience_members to service_role;/.test(mig)
    && !/grant[^;]*delete[^;]*vendor_campaign/i.test(mig);
})(), "append-only grant posture intact; 30.4C added no privilege");

/* ===========================================================================
 * 8. BEHAVIOURAL — the real audience planner, executed
 * ========================================================================= */
const plan = await import("../../../lib/crm/campaignAudiencePlan.ts");
const rules = await import("../../../lib/crm/campaignValidation.ts");
const contracts = await import("../../../lib/crm/campaignContracts.ts");
const {
  buildBatchConsentDeps, isIncludableDisposition, exclusionReasonFor,
  summarizeExclusions, orderPlannedRecipients, assertAudienceWithinBounds,
  INCLUDED_SUPPRESSION_REASON,
} = plan;
const { fingerprintCampaignSnapshot, validateCampaignRecipients } = rules;

const AT = new Date("2026-07-25T00:00:00.000Z");
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const supp = (over = {}) => ({
  id: UUID_A, destination_hash: "a".repeat(64), channel: "whatsapp", scope: "marketing",
  reason: "user_stop", policy_version: "1", is_active: true,
  expires_at: null, deactivated_at: null, ...over,
});
const pref = (over = {}) => ({
  id: UUID_B, principal_type: "vendor", principal_id: UUID_A, channel: "whatsapp",
  scope: "marketing", state: "allowed", policy_version: "1",
  consented_at: "2026-01-01T00:00:00.000Z", withdrawn_at: null, ...over,
});

record("30 marketing includes ONLY an explicit opt-in", (() => {
  return isIncludableDisposition("marketing_opted_in", "marketing")
    && !isIncludableDisposition("no_consent_objection", "marketing")
    && !isIncludableDisposition("unknown", "marketing")
    && !isIncludableDisposition("blocked", "marketing");
})(), "absence of objection is never marketing permission");
record("31 transactional additionally includes absence of objection", (() => {
  return isIncludableDisposition("no_consent_objection", "transactional")
    && isIncludableDisposition("unknown", "transactional")
    && !isIncludableDisposition("blocked", "transactional");
})(), "blocked is excluded in every scope");
record("32 an unknown disposition string is never includable", (() => {
  return !isIncludableDisposition("opted_in", "marketing")
    && !isIncludableDisposition("", "transactional")
    && !isIncludableDisposition("ALLOWED", "transactional");
})(), "the rule is an allow-list, not a deny-list");

const deps = buildBatchConsentDeps([supp()], [pref()], AT);
record("33 now() is the single frozen evaluation instant", deps.now() === AT && deps.now() === deps.now(),
  "no per-vendor clock read");
record("34 suppressions are keyed by destination hash and filtered by scope", async () => {
  const hit = await deps.readSuppressions({ destinationHash: "a".repeat(64), channel: "whatsapp", scopes: ["global", "marketing"] });
  const missScope = await deps.readSuppressions({ destinationHash: "a".repeat(64), channel: "whatsapp", scopes: ["global"] });
  const missHash = await deps.readSuppressions({ destinationHash: "b".repeat(64), channel: "whatsapp", scopes: ["global", "marketing"] });
  return hit.length === 1 && missScope.length === 0 && missHash.length === 0;
}, "exact-hash, in-scope only");
record("35 a mis-scoped channel row can never widen a decision", async () => {
  const d = buildBatchConsentDeps([supp({ channel: "sms" })], [], AT);
  const rows = await d.readSuppressions({ destinationHash: "a".repeat(64), channel: "whatsapp", scopes: ["global", "marketing"] });
  return rows.length === 0;
}, "the channel is re-checked inside the batch");
record("36 duplicate rows are PRESERVED so the authority can detect an integrity violation", async () => {
  const d = buildBatchConsentDeps([supp(), supp({ id: UUID_B })], [pref(), pref({ id: UUID_A })], AT);
  const s = await d.readSuppressions({ destinationHash: "a".repeat(64), channel: "whatsapp", scopes: ["global", "marketing"] });
  const p = await d.readExactPreference({ principalType: "vendor", principalId: UUID_A, channel: "whatsapp", scope: "marketing" });
  return s.length === 2 && p.length === 2;
}, "cardinality is never collapsed");
record("37 a NULL vocabulary field is projected as corruption, never repaired", async () => {
  const d = buildBatchConsentDeps([supp({ reason: null, policy_version: null })], [], AT);
  const rows = await d.readSuppressions({ destinationHash: "a".repeat(64), channel: "whatsapp", scopes: ["global", "marketing"] });
  return rows.length === 1 && rows[0].reason === "null" && rows[0].policy_version === "null";
}, "outside every closed vocabulary → the authority fails closed");
record("38 an inactive suppression is never handed to the authority", async () => {
  const d = buildBatchConsentDeps([supp({ is_active: false })], [], AT);
  const rows = await d.readSuppressions({ destinationHash: "a".repeat(64), channel: "whatsapp", scopes: ["global", "marketing"] });
  return rows.length === 0;
}, "is_active is re-checked inside the batch");
record("39 a preference is matched on the full principal/channel/scope tuple", async () => {
  const d = buildBatchConsentDeps([], [pref()], AT);
  const hit = await d.readExactPreference({ principalType: "vendor", principalId: UUID_A, channel: "whatsapp", scope: "marketing" });
  const wrongScope = await d.readExactPreference({ principalType: "vendor", principalId: UUID_A, channel: "whatsapp", scope: "transactional" });
  const wrongType = await d.readExactPreference({ principalType: "client", principalId: UUID_A, channel: "whatsapp", scope: "marketing" });
  return hit.length === 1 && wrongScope.length === 0 && wrongType.length === 0;
}, "no cross-principal or cross-scope bleed");

record("40 exclusion reasons follow a fixed precedence", (() => {
  const base = { hasUsableDestination: true, vendorEnabled: true, vendorVerified: true, disposition: "blocked", suppressed: false };
  return exclusionReasonFor({ ...base, hasUsableDestination: false }) === "missing_contact_channel"
    && exclusionReasonFor({ ...base, vendorEnabled: false }) === "vendor_disabled"
    && exclusionReasonFor({ ...base, vendorVerified: false }) === "vendor_unverified"
    && exclusionReasonFor({ ...base, suppressed: true }) === "suppressed"
    && exclusionReasonFor(base) === "consent_blocked";
})(), "destination → enabled → verified → suppressed → consent");
record("41 an exclusion summary is counts only, deterministically ordered", (() => {
  const s = summarizeExclusions(["suppressed", "consent_blocked", "suppressed", "duplicate"]);
  return JSON.stringify(s) === '{"consent_blocked":1,"duplicate":1,"suppressed":2}';
})(), "no vendor id, no free text, stable key order");
record("42 an unknown exclusion code is refused, not silently counted", (() => {
  try { summarizeExclusions(["not_a_reason"]); return false; } catch { return true; }
})(), "closed vocabulary");
record("43 every exclusion code the runtime can emit is in the contract vocabulary", (() => {
  const emitted = [...code(serviceSrc).matchAll(/exclusions\.push\("([a-z_]+)"\)/g)].map((m) => m[1]);
  return emitted.length >= 4
    && emitted.every((c) => contracts.CAMPAIGN_EXCLUSION_REASONS.includes(c));
})(), "the service can never build an unsummarizable exclusion");

const R = (id, over = {}) => ({
  vendor_id: id, consent_disposition: "marketing_opted_in",
  consent_reason_code: "preference_marketing_opted_in", consent_policy_version: "1",
  suppression_reason: INCLUDED_SUPPRESSION_REASON, ...over,
});
record("44 the frozen order is deterministic and independent of input order", (() => {
  const a = orderPlannedRecipients([R(UUID_B), R(UUID_A)]).map((r) => r.vendor_id);
  const b = orderPlannedRecipients([R(UUID_A), R(UUID_B)]).map((r) => r.vendor_id);
  return JSON.stringify(a) === JSON.stringify(b) && a[0] === UUID_A;
})(), "ascending vendor id");
record("45 the snapshot fingerprint is order-sensitive", (() => {
  const one = fingerprintCampaignSnapshot(validateCampaignRecipients([R(UUID_A), R(UUID_B)]));
  const two = fingerprintCampaignSnapshot(validateCampaignRecipients([R(UUID_B), R(UUID_A)]));
  return one !== two && /^[0-9a-f]{64}$/.test(one);
})(), "a reordered audience is a different snapshot");
record("46 ordering then fingerprinting is reproducible across runs", (() => {
  const f = () => fingerprintCampaignSnapshot(validateCampaignRecipients(orderPlannedRecipients([R(UUID_B), R(UUID_A)])));
  return f() === f();
})(), "no clock, no randomness in the frozen identity");
record("47 an included recipient always carries suppression_reason 'none'", (() => {
  return INCLUDED_SUPPRESSION_REASON === "none"
    && contracts.SUPPRESSION_REASONS.includes(INCLUDED_SUPPRESSION_REASON);
})(), "a suppressed principal is always excluded instead");
record("48 an over-large audience fails closed rather than truncating", (() => {
  try { assertAudienceWithinBounds(contracts.CAMPAIGN_MAX_AUDIENCE + 1); return false; }
  catch { return true; }
})(), `> ${contracts.CAMPAIGN_MAX_AUDIENCE} refuses`);
record("49 the boundary value is accepted", (() => {
  try { assertAudienceWithinBounds(contracts.CAMPAIGN_MAX_AUDIENCE); return true; } catch { return false; }
})(), "off-by-one guard");
record("50 the planner is pure and safely importable", (() => {
  const p = read(PLANNER);
  return !/import\s+["']server-only["']/.test(p) && !/adminClient|@supabase|createClient\(/.test(p)
    && !/Math\.random|Date\.now/.test(p);
})(), "no DB, no clock, no randomness");

/* ===========================================================================
 * 8b. QF-MVP-30.4C1 — SQL <-> TypeScript canonical fingerprint parity
 *
 * The DATABASE is authoritative: the runtime supplies each fingerprint only as
 * an EXPECTATION that the RPC independently recomputes and compares. That makes
 * parity load-bearing — a divergence would block every prepare — so it is proven
 * three ways: the field ORDER is read out of the migration and compared to the
 * TypeScript contract; the separator/header literals are compared; and pinned
 * GOLDEN VECTORS fix the exact bytes both sides must hash.
 *
 * Honest limit: Postgres is not executed here (the MVP loader refuses I/O
 * modules and no database is reachable offline). The SQL side of the golden
 * vectors is re-proved on staging by verify_qf_mvp_30_4c1.sql, which recomputes
 * the same literal streams with chr(30)/chr(31) and compares the same hashes.
 * ========================================================================= */
const HARDENING = "supabase/migrations/20260723001400_qf_mvp_vendor_campaign_evidence_hardening.sql";
record("54 the forward correction migration exists", existsSync(path.join(ROOT, HARDENING)), HARDENING);
const hardeningSrc = read(HARDENING);

/** Field order the SQL template fingerprint concatenates, in source order. */
const sqlTemplateFields = (src) => {
  const fn = /create or replace function public\.qf_communication_template_fingerprint_v1[\s\S]*?\n\$\$;/.exec(src)?.[0] ?? "";
  return [...fn.matchAll(/qf_canonical_text_field_v1\(\s*(?:case when )?t\.(\w+)/g)].map((m) => m[1]);
};
/** Field order the SQL snapshot fingerprint concatenates, in source order. */
const sqlSnapshotFields = (src) => {
  const fn = /create or replace function public\.qf_campaign_snapshot_fingerprint_v1[\s\S]*?\n\$\$;/.exec(src)?.[0] ?? "";
  const stream = /select 'qf-campaign-snapshot-v1'[\s\S]*?into v_canonical/.exec(fn)?.[0] ?? "";
  // the final field is followed by a comma (string_agg's delimiter argument),
  // so the trailing comma must be optional or the last field is silently lost.
  return [...stream.matchAll(/m\.(\w+)(?:::text)?,?\n/g)].map((m) => m[1]);
};

record("55 SQL and TypeScript agree on the template field ORDER", (() => {
  const sql = sqlTemplateFields(hardeningSrc);
  return sql.length === contracts.TEMPLATE_FINGERPRINT_FIELDS.length
    && sql.every((f, i) => f === contracts.TEMPLATE_FINGERPRINT_FIELDS[i]);
})(), `SQL order: ${sqlTemplateFields(hardeningSrc).join(", ")}`);

record("56 a divergent field order is DETECTED (parity is load-bearing)", (() => {
  const swapped = hardeningSrc.replace(
    "    || chr(31) || public.qf_canonical_text_field_v1(t.template_key)\n    || chr(31) || public.qf_canonical_text_field_v1(t.version)",
    "    || chr(31) || public.qf_canonical_text_field_v1(t.version)\n    || chr(31) || public.qf_canonical_text_field_v1(t.template_key)");
  if (swapped === hardeningSrc) return false;      // the anchor must still exist
  const sql = sqlTemplateFields(swapped);
  return !sql.every((f, i) => f === contracts.TEMPLATE_FINGERPRINT_FIELDS[i]);
})(), "swapping two SQL fields breaks the parity check");

record("57 SQL and TypeScript agree on the snapshot tuple ORDER", (() => {
  const sql = sqlSnapshotFields(hardeningSrc);
  const want = ["ordinal", "vendor_id", "consent_disposition", "consent_reason_code",
    "consent_policy_version", "suppression_reason"];
  return sql.length === want.length && sql.every((f, i) => f === want[i]);
})(), `SQL tuple: ${sqlSnapshotFields(hardeningSrc).join(", ")}`);

record("58 SQL and TypeScript agree on the header and separator literals", (() => {
  return hardeningSrc.includes(`'${contracts.SNAPSHOT_CANONICAL_HEADER}'`)
    && hardeningSrc.includes(`'${contracts.TEMPLATE_CANONICAL_HEADER}'`)
    && contracts.CANONICAL_RECORD_SEPARATOR.charCodeAt(0) === 30
    && contracts.CANONICAL_UNIT_SEPARATOR.charCodeAt(0) === 31
    && hardeningSrc.includes("chr(30)") && hardeningSrc.includes("chr(31)");
})(), "same version tags; RS=chr(30), US=chr(31)");

/* -- pinned golden vectors -------------------------------------------------
 * These exact hexes are also asserted by verify_qf_mvp_30_4c1.sql against the
 * SQL side. If either language's canonicalizer changes, one of the two fails. */
const GOLDEN_SNAPSHOT_HEX = "f6807a63ddd99798eb0e40857c23265a91d6ee1f6572f7eea187b2dc2095a2cd";
const GOLDEN_TEMPLATE_HEX = "d9af14ec95590c4650506133dc59b8855f2534ae653b6c34d8183fcb3bc5e308";
const gRow = (id, ordinal) => ({
  ordinal, vendor_id: id,
  consent_disposition: "marketing_opted_in",
  consent_reason_code: "preference_marketing_opted_in",
  consent_policy_version: "2026-07-01",
  suppression_reason: "none",
});
const GOLDEN_ROWS = [gRow(UUID_A, 0), gRow(UUID_B, 1)];
const GOLDEN_TEMPLATE = {
  template_key: "qf_parity_probe", version: "1.0.0", channel: "whatsapp",
  category: "marketing", language: "en", readiness_status: "provider_ready",
  is_active: true, provider_template_name: null, provider_template_id: null,
  description: "",
};

record("59 TypeScript reproduces the pinned SNAPSHOT golden vector",
  rules.fingerprintCampaignSnapshotRows(GOLDEN_ROWS) === GOLDEN_SNAPSHOT_HEX,
  rules.fingerprintCampaignSnapshotRows(GOLDEN_ROWS));
record("60 TypeScript reproduces the pinned TEMPLATE golden vector",
  rules.fingerprintCommunicationTemplate(GOLDEN_TEMPLATE) === GOLDEN_TEMPLATE_HEX,
  rules.fingerprintCommunicationTemplate(GOLDEN_TEMPLATE));
record("61 the staging verifier pins the SAME golden vectors", (() => {
  const v = read("supabase/staging-verification/verify_qf_mvp_30_4c1.sql");
  return v.includes(GOLDEN_SNAPSHOT_HEX) && v.includes(GOLDEN_TEMPLATE_HEX);
})(), "the SQL side is proved against identical bytes on staging");

record("62 the canonical field encoder distinguishes NULL from empty", (() => {
  return rules.canonicalTextField(null) === "-1:"
    && rules.canonicalTextField(undefined) === "-1:"
    && rules.canonicalTextField("") === "0:"
    && rules.canonicalTextField("ab") === "2:ab"
    // multi-byte: the prefix counts OCTETS, matching SQL octet_length()
    && rules.canonicalTextField("é") === "2:é";
})(), "length-prefixed, octet-counted, NULL never collides with empty");

record("63 reordered INPUT canonicalises to the same fingerprint", (() => {
  const a = rules.fingerprintCampaignSnapshotRows([gRow(UUID_A, 0), gRow(UUID_B, 1)]);
  const b = rules.fingerprintCampaignSnapshotRows([gRow(UUID_B, 1), gRow(UUID_A, 0)]);
  return a === b && a === GOLDEN_SNAPSHOT_HEX;
})(), "the stream is sorted by ordinal before hashing");

record("64 a different ordinal ASSIGNMENT is a different fingerprint", (() => {
  const swapped = rules.fingerprintCampaignSnapshotRows([gRow(UUID_A, 1), gRow(UUID_B, 0)]);
  return swapped !== GOLDEN_SNAPSHOT_HEX;
})(), "order is part of the frozen identity");

record("65 changed evidence changes the fingerprint", (() => {
  const changedVendor = rules.fingerprintCampaignSnapshotRows(
    [gRow("33333333-3333-4333-8333-333333333333", 0), gRow(UUID_B, 1)]);
  const changedEvidence = rules.fingerprintCampaignSnapshotRows(
    [{ ...gRow(UUID_A, 0), consent_disposition: "unknown" }, gRow(UUID_B, 1)]);
  return changedVendor !== GOLDEN_SNAPSHOT_HEX && changedEvidence !== GOLDEN_SNAPSHOT_HEX
    && changedVendor !== changedEvidence;
})(), "vendor identity and consent evidence are both inside the canonical input");

const throws = (fn) => { try { fn(); return false; } catch { return true; } };
record("66 sparse ordinals are REJECTED, not silently hashed",
  throws(() => rules.fingerprintCampaignSnapshotRows([gRow(UUID_A, 0), gRow(UUID_B, 5)])),
  "mirrors the SQL authority returning NULL");
record("67 duplicate ordinals are REJECTED",
  throws(() => rules.fingerprintCampaignSnapshotRows([gRow(UUID_A, 0), gRow(UUID_B, 0)])),
  "an ambiguous order has no fingerprint");
record("68 an empty set is REJECTED",
  throws(() => rules.fingerprintCampaignSnapshotRows([])), "no rows, no fingerprint");
record("69 an out-of-charset field is REJECTED", (() => {
  const bad = { ...gRow(UUID_A, 0), consent_reason_code: "has\u001fseparator" };
  return throws(() => rules.fingerprintCampaignSnapshotRows([bad]));
})(), "a separator inside a value could otherwise forge a tuple boundary");
record("70 an uppercase / non-canonical uuid is REJECTED", (() => {
  // UUID_A is digits-only, so .toUpperCase() on it would be a no-op and the
  // assertion would pass vacuously. Use a uuid that actually contains hex letters.
  const HEXY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const upper = HEXY.toUpperCase();
  return upper !== HEXY
    && !throws(() => rules.fingerprintCampaignSnapshotRows([{ ...gRow(HEXY, 0) }]))
    && throws(() => rules.fingerprintCampaignSnapshotRows([{ ...gRow(HEXY, 0), vendor_id: upper }]));
})(), "PostgreSQL renders uuid::text lowercase; the mirror must agree");

record("71 the template fingerprint changes when a dispatch-critical field changes", (() => {
  const changed = contracts.TEMPLATE_FINGERPRINT_FIELDS
    .filter((f) => f !== "is_active")
    .map((f) => rules.fingerprintCommunicationTemplate({ ...GOLDEN_TEMPLATE, [f]: "qf-mutated" }));
  const boolFlip = rules.fingerprintCommunicationTemplate({ ...GOLDEN_TEMPLATE, is_active: false });
  return changed.every((h) => h !== GOLDEN_TEMPLATE_HEX) && boolFlip !== GOLDEN_TEMPLATE_HEX
    && new Set([...changed, boolFlip]).size === contracts.TEMPLATE_FINGERPRINT_FIELDS.length;
})(), "every one of the 10 fields is genuinely inside the canonical input");

record("72 a NULL provider field is distinguishable from an empty one", (() => {
  const asNull = rules.fingerprintCommunicationTemplate({ ...GOLDEN_TEMPLATE, provider_template_name: null });
  const asEmpty = rules.fingerprintCommunicationTemplate({ ...GOLDEN_TEMPLATE, provider_template_name: "" });
  return asNull !== asEmpty && asNull === GOLDEN_TEMPLATE_HEX;
})(), "length prefixing keeps NULL and '' distinct");

record("73 the pure approval matrix mirrors the hardened SQL", (() => {
  const base = {
    prepared_segment_version: 1, prepared_segment_fingerprint: "a".repeat(64),
    prepared_template_version: "1.0.0", prepared_template_category: "marketing",
    prepared_template_fingerprint: GOLDEN_TEMPLATE_HEX,
    prepared_recipient_count: 2, snapshot_fingerprint: GOLDEN_SNAPSHOT_HEX,
    current_segment_status: "active", current_segment_version: 1,
    current_segment_fingerprint: "a".repeat(64),
    current_template_version: "1.0.0", current_template_category: "marketing",
    current_template_readiness: "provider_ready", current_template_fingerprint: GOLDEN_TEMPLATE_HEX,
    actual_member_count: 2, actual_snapshot_fingerprint: GOLDEN_SNAPSHOT_HEX,
    foreign_snapshot_rows: 0, ordinals_dense: true,
  };
  return rules.checkCampaignApproval(base) === null
    && rules.checkCampaignApproval({ ...base, prepared_template_fingerprint: null }) === "PREPARED_EVIDENCE_INCOMPLETE"
    && rules.checkCampaignApproval({ ...base, current_template_fingerprint: "b".repeat(64) }) === "TEMPLATE_FINGERPRINT_MISMATCH"
    && rules.checkCampaignApproval({ ...base, actual_snapshot_fingerprint: "b".repeat(64) }) === "SNAPSHOT_FINGERPRINT_MISMATCH"
    && rules.checkCampaignApproval({ ...base, foreign_snapshot_rows: 1 }) === "SNAPSHOT_OWNERSHIP_MISMATCH"
    && rules.checkCampaignApproval({ ...base, ordinals_dense: false }) === "SNAPSHOT_ORDINAL_INVALID";
})(), "every hardened SQL branch has a reachable pure-mirror equivalent");

record("74 every new failure code is in the closed contract vocabulary", (() => {
  return ["SNAPSHOT_ORDINAL_INVALID", "SNAPSHOT_OWNERSHIP_MISMATCH",
    "TEMPLATE_FINGERPRINT_MISMATCH", "TEMPLATE_FINGERPRINT_UNAVAILABLE"]
    .every((c) => contracts.CAMPAIGN_FAILURE_CODES.includes(c));
})(), "no invented code");

record("75 the runtime maps every new code to fixed admin text", (() => {
  return ["SNAPSHOT_ORDINAL_INVALID", "SNAPSHOT_OWNERSHIP_MISMATCH",
    "TEMPLATE_FINGERPRINT_MISMATCH", "TEMPLATE_FINGERPRINT_UNAVAILABLE"]
    .every((c) => new RegExp(`^\\s{2}${c}:\\s*"`, "m").test(serviceSrc));
})(), "no new code can fall through to a raw payload");

record("76 the review UI displays the frozen template fingerprint", (() => {
  return /prepared_template_fingerprint/.test(editUi) && /Template fingerprint/.test(editUi);
})(), "the evidence an approver relies on is visible");

/* ===========================================================================
 * 9. Enduring cross-phase regressions
 * ========================================================================= */
record("51 the campaign runtime is the ONLY new writer of campaign tables", (() => {
  const others = ["services/vendorSegmentService.ts", "services/vendorCrmService.ts"]
    .filter((p) => existsSync(path.join(ROOT, p))).map(read).join("\n");
  return !/from\(["']vendor_campaign/.test(others);
})(), "no other service touches a campaign table");
record("52 no API route exposes a campaign action", (() => {
  const apiDir = path.join(ROOT, "app/api");
  if (!existsSync(apiDir)) return true;
  const walk = (d) => readdirSync(d, { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(apiDir).filter((p) => /\.(ts|tsx)$/.test(p));
  return !files.some((p) => /vendorCampaignService|vendor_campaigns|qf_prepare_vendor_campaign_v1/
    .test(readFileSync(p, "utf8")));
})(), "campaign mutation is server-action only");
record("53 the pure contract/validation modules gained no runtime dependency", (() => {
  const joined = read(CONTRACTS) + read(VALIDATION) + read(PLANNER);
  return !/from\s+["'][^"']*(services\/|app\/|components\/|next\/)/.test(joined);
})(), "the 30.4A foundation stays offline-testable");

/* ===========================================================================
 * Report
 * ========================================================================= */
const resolved = [];
for (const r of results) {
  resolved.push({ ...r, ok: typeof r.ok === "function" ? await r.ok() : r.ok });
}
failed = resolved.some((r) => !r.ok);

const passed = resolved.filter((r) => r.ok).length;
console.log("== QF-MVP-30.4C vendor campaign runtime validator ==");
for (const r of resolved) {
  console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`);
  if (!r.ok) console.log(`         ${r.detail}`);
}
console.log("");
console.log(`checks: ${passed} passed, ${resolved.length - passed} failed (of ${resolved.length})`);
console.log(`fixtures: ${SVC_FIX.length} service + ${ACT_FIX.length} action + ${ROUTE_FIX.length} route + 1 client one-defect mutations`);
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
