#!/usr/bin/env node
/**
 * QF-MVP-30.5C1 — offline validator for the campaign handoff + frequency policy
 * application integration.
 *
 * Grades the REAL application artefacts (services, server actions, UI, routes)
 * against the committed database contract, with mutation controls proving each
 * protection is load-bearing.
 *
 * Offline: no database, no network, no provider. Usage: npm run test:crm:30-5c1
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const has = (p) => existsSync(path.join(ROOT, p));

const HANDOFF_SVC = "services/campaignHandoffService.ts";
const POLICY_SVC = "services/communicationFrequencyPolicyService.ts";
const ACTIONS = "app/actions/campaignHandoffActions.ts";
const PANEL = "components/admin/crm/campaigns/CampaignHandoffPanel.tsx";
const POLICY_UI = "components/admin/crm/policies/FrequencyPolicyManager.tsx";
const POLICY_PAGE = "app/admin/vendor-crm/frequency-policies/page.tsx";
const CAMPAIGN_PAGE = "app/admin/vendor-crm/campaigns/[campaignId]/page.tsx";
const MIG_1500 = "supabase/migrations/20260728001500_qf_mvp_vendor_campaign_execution_handoff_foundation.sql";
const MIG_1600 = "supabase/migrations/20260728001600_qf_mvp_frequency_policy_history_hardening.sql";

/** Strip // and /* *\/ comments so prohibition scans grade real code, not prose. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/^\s*\/\/.*$/, "").replace(/([^:"'`])\/\/.*$/, "$1"))
    .join("\n");
}

const results = [];
const record = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

for (const f of [HANDOFF_SVC, POLICY_SVC, ACTIONS, PANEL, POLICY_UI, POLICY_PAGE]) {
  if (!has(f)) { console.log(`RESULT: FAIL — missing artefact: ${f}`); process.exit(1); }
}

const svc = read(HANDOFF_SVC);
const svcCode = codeOnly(svc);
const pol = read(POLICY_SVC);
const polCode = codeOnly(pol);
const act = read(ACTIONS);
const actCode = codeOnly(act);
const panel = read(PANEL);
const panelCode = codeOnly(panel);
const polUi = read(POLICY_UI);
const polUiCode = codeOnly(polUi);
const page = read(CAMPAIGN_PAGE);

/* === 1. server-only boundary and secret handling ========================= */
for (const [f, src] of [[HANDOFF_SVC, svc], [POLICY_SVC, pol]]) {
  record(`01 ${f} is server-only`, /^import "server-only";/m.test(src));
  record(`02 ${f} uses the shared service_role adminClient, not a raw URL/key`,
    /from "\.\.\/lib\/supabase"/.test(src)
    && !/SUPABASE_SERVICE_ROLE_KEY|process\.env\.[A-Z_]*URL|createClient\(/.test(codeOnly(src)));
}
record("03 no client component imports a server-only service",
  !/services\/(campaignHandoffService|communicationFrequencyPolicyService)/.test(panelCode)
  && !/services\/(campaignHandoffService|communicationFrequencyPolicyService)/.test(polUiCode),
  "the UI reaches the database only through server actions");
record("04 client components carry no service-role or database credential",
  !/SERVICE_ROLE|service_role|SUPABASE_SERVICE|postgres:\/\//i.test(panelCode + polUiCode));
record("05 the browser never writes to the policy table directly",
  !/from\(["']communication_frequency_policies["']\)/.test(panelCode + polUiCode));

/* === 2. operator authorisation ========================================== */
record("06 actions use the EXISTING strongest admin boundary, no new role",
  /requireCrmAdmin/.test(actCode) && !/createRole|new role|isVendor|vendorSession/i.test(actCode));
record("07 EVERY exported action runs through the guarded runner",
  (() => {
    const bodies = [...act.matchAll(/export async function (\w+)\([^)]*\)\s*\{([\s\S]*?)\n\}/g)];
    return bodies.length >= 5 && bodies.every(([, , body]) => /return run\(/.test(body));
  })(),
  "no action may reach a service without requireCrmAdmin");
record("08 the actor id is derived from the session, never from input",
  /const actor = await requireCrmAdmin\(\);[\s\S]{0,120}fn\(actor\.id\)/.test(actCode)
  && !/actorId:\s*input|input\.actorId|input\?\.actorId/.test(actCode));
record("09 the policy route is superadmin-gated",
  /getAdminSession/.test(read(POLICY_PAGE)) && /isSuperadmin/.test(read(POLICY_PAGE))
  && /redirect\("\/admin\/login\?error=unauthorized"\)/.test(read(POLICY_PAGE)));

/* === 3. the handoff service wraps the COMMITTED RPC ====================== */
record("10 the exact committed RPC is called, not a duplicate implementation",
  /\.rpc\("qf_handoff_vendor_campaign_intents_v1"/.test(svcCode));
record("11 only the five parameters the RPC accepts are supplied",
  (() => {
    const call = /\.rpc\("qf_handoff_vendor_campaign_intents_v1", \{([\s\S]*?)\}\)/.exec(svcCode);
    if (!call) return false;
    const keys = [...call[1].matchAll(/(p_[a-z_]+):/g)].map((m) => m[1]).sort();
    return JSON.stringify(keys) === JSON.stringify(
      ["p_actor_id", "p_batch_limit", "p_campaign_id", "p_expected_revision", "p_idempotency_key"]);
  })());
record("12 no destination, aggregate type, policy id, fingerprint or consent result is sent",
  !/p_destination|p_aggregate|p_policy_id|p_fingerprint|p_consent|p_suppress|destination_hash/.test(svcCode),
  "the RPC signature cannot accept them, so bypass is impossible rather than discouraged");
record("13 the batch limit is bounded before it reaches the database",
  /HANDOFF_BATCH_MIN|BATCH_LIMIT_OUT_OF_RANGE/.test(svcCode)
  && /HANDOFF_BATCH_MAX = 500/.test(svcCode));
record("14 deterministic RPC codes map to typed application results",
  [
    "FREQUENCY_POLICY_NOT_CONFIGURED", "FREQUENCY_POLICY_AMBIGUOUS", "CAMPAIGN_NOT_APPROVED",
    "CAMPAIGN_CANCELLED", "CAMPAIGN_ARCHIVED", "SEGMENT_EVIDENCE_MISMATCH",
    "TEMPLATE_FINGERPRINT_MISMATCH", "REVISION_MISMATCH", "BATCH_LIMIT_OUT_OF_RANGE",
  ].every((c) => svc.includes(c)));
record("15 an unrecognised code never reaches the browser verbatim",
  /hasOwnProperty\.call\(HANDOFF_CODE_MESSAGES, code\)[\s\S]{0,80}: "HANDOFF_FAILED"/.test(svcCode));
record("16 created/existing/excluded/examined reconciliation is preserved",
  /const accounted = counts\.created \+ counts\.existing \+ counts\.skippedConsent/.test(svcCode)
  && /reconciled: accounted === counts\.considered/.test(svcCode));
record("17 the service returns counts only — no destination PII",
  !/\bphone\b|\bemail\b|recipient_ref|business_name/.test(
    svcCode.slice(svcCode.indexOf("export type HandoffCounts"))));

/* === 4. provider-neutral, no network ==================================== */
{
  const all = svcCode + polCode + actCode + panelCode + polUiCode;
  const usage = [
    /\bfetch\s*\(/, /axios|node-fetch|got\(/, /graph\.facebook|api\.whatsapp|https?:\/\/[a-z]/i,
    /provider_message_id|dispatched_at|delivered_at/, /n8n|webhook/i,
  ].filter((re) => re.test(all));
  record("18 no provider, network or delivery surface anywhere in the integration",
    usage.length === 0, usage.map(String).join(" | ") || "clean");
}
{
  // Grade CONTROLS, not words. The panel legitimately explains that it does not
  // send, and that a later phase must re-check before dispatch; that prose must
  // not be mistaken for a send button.
  const controls = [
    ...panelCode.matchAll(/onClick=\{([^}]*)\}/g),
    ...panelCode.matchAll(/<(?:Primary|Secondary)Button[^>]*>([^<]*)</g),
  ].map((m) => m[1]);
  const sendish = controls.filter((c) => /\b(send|dispatch|resend|retry|deliver)\b/i.test(c));
  record("19 no send / dispatch / test-send CONTROL exists", sendish.length === 0,
    sendish.join(" | ") || "controls are authorise/refresh only");
}
record("20 intent status is never overridden from the admin surface",
  !/status:\s*["'](pending|claimed|dispatched|delivered|failed|uncertain)["']/.test(svcCode + actCode)
  && !/\.update\(\{[^}]*status/.test(svcCode));

/* === 5. approval and handoff stay separate ============================== */
record("21 approval does NOT trigger handoff",
  !/handoffCampaignIntents|campaignHandoff\(/.test(
    read("services/vendorCampaignService.ts") + read("app/actions/vendorCampaignActions.ts")),
  "no approval path references the handoff service or action");
record("22 the handoff panel renders ONLY for an approved campaign",
  /campaign\.status === "approved" \?[\s\S]{0,200}CampaignHandoffPanel/.test(page));
record("23 readiness is fail-closed on status AND on active policy",
  /canHandOff: isApproved && hasActivePolicy/.test(svcCode));
record("24 the control is disabled while blocked",
  /const blocked = !ready\?\.canHandOff/.test(panelCode)
  && /blocked \|\| busy \? undefined : runHandoff/.test(panelCode));
record("25 repeated client submission is latched, with the database as final authority",
  /inFlight/.test(panelCode) && /uq_communication_intents_idempotency/.test(panel));

/* === 6. frequency policy operator path ================================== */
record("26 policy history can be listed including retired rows",
  /export async function listFrequencyPolicies/.test(polCode)
  && !/\.eq\("is_active", true\)[\s\S]{0,80}listFrequencyPolicies/.test(polCode));
record("27 a NEW explicit version can be published",
  /export async function createFrequencyPolicy/.test(polCode));
record("28 retirement uses the ONLY permitted transition",
  /export async function retireFrequencyPolicy/.test(polCode)
  && /is_active: false/.test(polCode) && /\.eq\("is_active", true\)/.test(polCode));
record("29 there is NO update/edit path for a published policy",
  !/export async function (updateFrequencyPolicy|editFrequencyPolicy)/.test(polCode));
{
  // Grade PATHS, not words: the module documents that the database refuses
  // DELETE and TRUNCATE, and that explanation must not read as an implementation.
  const paths = [
    /\.delete\s*\(/,                      // a PostgREST delete call
    /\.rpc\(\s*["'][^"']*truncate/i,      // a truncate helper
    /\btruncate\s+table\b/i,              // raw SQL
    /is_active:\s*true[\s\S]{0,120}\.update\(/, // reactivation
    /\.update\(\s*\{[^}]*is_active:\s*true/,    // reactivation, other order
  ].filter((re) => re.test(polCode));
  record("30 there is NO delete, truncate or reactivate PATH", paths.length === 0,
    paths.map(String).join(" | ") || "migration 1600 refuses all three at the database anyway");
}
record("31 the duplicate-active refusal is surfaced as guidance",
  /=== "23505"[\s\S]{0,60}POLICY_DUPLICATE_ACTIVE/.test(polCode));
record("32 the history-immutability refusal is surfaced as guidance",
  /=== "23514"[\s\S]{0,60}POLICY_HISTORY_IMMUTABLE/.test(polCode));
record("33 bounds mirror the committed CHECK constraints",
  /POLICY_MAX_PER_WINDOW_LIMIT = 1000/.test(polCode) && /POLICY_MAX_HOURS = 8760/.test(polCode));
record("34 every policy field is validated with no fallback value",
  /if \(v === null \|\| v === undefined \|\| v === ""\) throw policyError\(code\)/.test(polCode)
  && !/\?\?\s*(1|7|24|30|100|168)\b/.test(polCode));

/* === 7. NO DEFAULT POLICY =============================================== */
record("35 the service supplies no default threshold, window or interval",
  !/maxPerWindow\s*[:=]\s*\d/.test(polCode)
  && !/windowHours\s*[:=]\s*\d/.test(polCode)
  && !/minIntervalHours\s*[:=]\s*\d/.test(polCode));
record("36 the form starts empty — no prefilled business number",
  /const EMPTY_FORM = \{[\s\S]*?channel: "", scope: "", maxPerWindow: "", windowHours: "", minIntervalHours: "",/.test(polUiCode));
record("37 example text is a placeholder only, never a submitted value",
  /placeholder="e\.g\./.test(polUi)
  && !/value=\{["']\d/.test(polUiCode)
  && !/defaultValue=/.test(polUiCode));
record("38 the action forwards only operator-supplied fields",
  /maxPerWindow: input\?\.maxPerWindow/.test(actCode)
  && !/maxPerWindow: input\?\.maxPerWindow \?\?/.test(actCode));

/* === 8. intent visibility boundary ====================================== */
record("39 intent visibility selects status and time only — never a destination",
  /\.from\("communication_intents"\)[\s\S]{0,120}\.select\("status, created_at"\)/.test(svcCode));
record("40 the visibility scope is pinned to this campaign aggregate",
  /\.eq\("aggregate_type", "vendor_campaign"\)[\s\S]{0,60}\.eq\("aggregate_id", id\)/.test(svcCode));
{
  const buttons = [...panelCode.matchAll(/<(?:Primary|Secondary)Button[^>]*>([\s\S]*?)<\//g)]
    .map((m) => m[1].replace(/\{[^}]*\}/g, " "));
  record("41 no provider send/retry BUTTON is rendered",
    buttons.every((b) => !/\b(retry|resend|send|dispatch)\b/i.test(b)),
    buttons.map((b) => b.trim()).filter(Boolean).join(" | "));
}
{
  // A destination VALUE would be read off a row (`.phone`, `.email`,
  // `recipient_ref`, `destination_hash`). The literal "email" as a CHANNEL name,
  // and the label "unusable destination" on an exclusion count, are not
  // destinations and must not be treated as PII leaks.
  const reads = /\.(phone|email|destination|destination_hash|recipient_ref)\b|["']destination_hash["']|["']recipient_ref["']/;
  record("42 no destination VALUE is read or rendered in the UI",
    !reads.test(panelCode) && !reads.test(polUiCode),
    "channel names and exclusion labels are not destinations");
}

/* === 9. mutation controls — each protection load-bearing ================= */
const mutated = (src, find) => src.replace(find, "") !== src;
record("M1 removing requireCrmAdmin changes the action module (load-bearing)",
  mutated(actCode, /requireCrmAdmin/) && /requireCrmAdmin/.test(actCode));
record("M2 exposing a service-role client in the UI would be caught",
  !/service_role|SERVICE_ROLE/i.test(panelCode + polUiCode)
  && /server-only/.test(svc) && /server-only/.test(pol));
record("M3 auto-handoff on approval would be caught",
  !/handoff/i.test(codeOnly(read("app/actions/vendorCampaignActions.ts"))));
record("M4 bypassing the no-policy result would be caught",
  /FREQUENCY_POLICY_NOT_CONFIGURED/.test(svcCode)
  && mutated(svcCode, /hasActivePolicy/) && /canHandOff: isApproved && hasActivePolicy/.test(svcCode));
record("M5 permitting a historical policy edit would be caught",
  !/export async function updateFrequencyPolicy/.test(polCode)
  && /POLICY_HISTORY_IMMUTABLE/.test(polCode));
record("M6 adding DELETE or reactivation would be caught",
  !/\.delete\(\)/.test(polCode + actCode)
  && read(MIG_1600).includes("trg_cfp_no_delete")
  && read(MIG_1600).includes("cannot be re-activated"));
record("M7 adding a provider/network call would be caught",
  !/\bfetch\s*\(/.test(svcCode + polCode + actCode + panelCode + polUiCode));
record("M8 rendering raw destination PII would be caught",
  !/\bphone\b|destination_hash/.test(panelCode + polUiCode));

/* === 10. the database contract this integration relies on =============== */
record("43 migration 1500 still defines the handoff RPC",
  read(MIG_1500).includes("qf_handoff_vendor_campaign_intents_v1"));
record("44 migration 1600 still protects policy history",
  read(MIG_1600).includes("trg_cfp_history_immutable")
  && read(MIG_1600).includes("trg_cfp_no_truncate"));
record("45 no migration was added or edited by this phase",
  !has("supabase/migrations/20260728001700_.sql"),
  "30.5C1 is application integration only");

/* === report ============================================================= */
const failed = results.filter((r) => !r.ok);
console.log("== QF-MVP-30.5C1 campaign handoff application integration validator ==");
for (const r of results) {
  console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`);
  if (!r.ok && r.detail) console.log(`         ${r.detail}`);
}
console.log("");
console.log(`checks: ${results.length - failed.length} passed, ${failed.length} failed (of ${results.length})`);
console.log("mutants: 8 (admin guard, client service-role, auto-handoff, no-policy bypass,");
console.log("            historical edit, delete/reactivate, provider call, destination PII)");
console.log("offline: no database, no network, no provider call");
console.log(`RESULT: ${failed.length ? "FAIL" : "PASS"}`);
process.exit(failed.length ? 1 : 0);
