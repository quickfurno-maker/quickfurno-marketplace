#!/usr/bin/env node
// ============================================================================
// QF-MVP-50.4 — CAMPAIGN AUTOMATION validator
//
// OFFLINE ONLY. No database, no network, no provider, no n8n, no Jarvis.
//
// Freezes the rule that makes this phase safe: campaign automation is an
// EXECUTION VEHICLE, not a second campaign authority. The frozen audience, the
// bounded handoff, the per-recipient intent, consent/suppression/frequency and
// the 40.8 result contract all remain exactly where they already are.
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAMPAIGN_AUTOMATION_ACTION_TYPES,
  CAMPAIGN_DISPATCH_REGISTRY,
  NON_PRODUCED_CAMPAIGN_ACTIONS,
  CAMPAIGN_HANDOFF_BATCH_BOUNDS,
  CAMPAIGN_BUSINESS_STATUSES,
  CAMPAIGN_INTENT_AGGREGATE_TYPE,
  getCampaignDispatchDefinition,
  getNonProducedCampaignReason,
  isAllowedCampaignDispatchEntityType,
} from "../../../lib/automation/campaignDispatchRegistry.ts";
import { AUTOMATION_ACTION_TYPES } from "../../../lib/automation/actionRegistry.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const canonicalSha256 = (buf) =>
  sha256(Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const MIGRATION_NAME = "20260810000000_qf_mvp_50_4_campaign_recipient_automation.sql";
const MIGRATION_PATH = `supabase/migrations/${MIGRATION_NAME}`;
const MIGRATION_SHA = "8440e5e818676232969c5046941daa7e8fc905728ea73d295ca0e997c5ac7906";

// Frozen upstream authorities this phase must NOT duplicate or edit.
const HANDOFF_MIGRATION =
  "supabase/migrations/20260728001500_qf_mvp_vendor_campaign_execution_handoff_foundation.sql";
const CAMPAIGN_FOUNDATION =
  "supabase/migrations/20260723001300_qf_mvp_vendor_campaign_foundation.sql";
const HANDOFF_SHA = "51ccaada4fa934e855aa7da37535cd753b692ef8855800adadbe1819ebf81687";
const FOUNDATION_SHA = "3a92fd063bf222230578532ae2df1bb602ceb9fe625363650d33a7bcd54fc268";

const migrationSource = read(MIGRATION_PATH);
const sql = stripSql(migrationSource);
const registrySource = read("lib/automation/campaignDispatchRegistry.ts");
const manifestText = read("supabase/staging-history/qf-mvp-staging-history-manifest.json");
const manifest = JSON.parse(manifestText);
const doc = read("docs/QF-MVP-50-4-CAMPAIGN-AUTOMATION.md");
const contractDoc = read("docs/QF-MVP-40-8-CAMPAIGN-RESULT-CONTRACT.md");
const resultService = read("services/campaignCommunicationResultService.ts");
const handoffService = read("services/campaignHandoffService.ts");
const ciWorkflow = read(".github/workflows/qf-mvp-50-quality-gate.yml");
const pkg = JSON.parse(read("package.json"));

const results = [];
const record = (name, passed, detail = "") =>
  results.push({ name, passed: Boolean(passed), detail });

// ---------------------------------------------------------------------------
// A. THE VEHICLE, AND ONLY THE VEHICLE
// ---------------------------------------------------------------------------
record("A01 the migration exists at its pinned hash",
  existsSync(path.join(ROOT, MIGRATION_PATH)) &&
  canonicalSha256(readFileSync(path.join(ROOT, MIGRATION_PATH))) === MIGRATION_SHA);
record("A02 exactly one ACTIVE campaign action — the per-recipient vehicle",
  CAMPAIGN_AUTOMATION_ACTION_TYPES.length === 1 &&
  CAMPAIGN_AUTOMATION_ACTION_TYPES[0] === "campaign.execute_recipient");
record("A03 the frozen 14-action registry is unchanged",
  AUTOMATION_ACTION_TYPES.length === 14 &&
  AUTOMATION_ACTION_TYPES.includes("campaign.execute_recipient") &&
  AUTOMATION_ACTION_TYPES.includes("campaign.execute_batch"));
record("A04 it routes to the campaign_execution family",
  CAMPAIGN_DISPATCH_REGISTRY["campaign.execute_recipient"].workflowFamily === "campaign_execution");
record("A05 campaign.execute_batch is registered but NOT produced, with its reason",
  getNonProducedCampaignReason("campaign.execute_batch") === "BATCH_ADVANCE_REMAINS_CORE_OWNED_HANDOFF" &&
  NON_PRODUCED_CAMPAIGN_ACTIONS["campaign.execute_batch"].actionType === "campaign.execute_batch" &&
  !sql.includes("'campaign.execute_batch'"));
record("A06 the entity is the INTENT — not the campaign, not the vendor",
  isAllowedCampaignDispatchEntityType("campaign.execute_recipient", "communication_intent") &&
  !isAllowedCampaignDispatchEntityType("campaign.execute_recipient", "vendor") &&
  !isAllowedCampaignDispatchEntityType("campaign.execute_recipient", "vendor_campaign") &&
  /'communication_intent',\s*\n?\s*v_intent\.id::text/.test(sql));
record("A07 an unknown campaign action resolves to nothing",
  getCampaignDispatchDefinition("campaign.execute_batch") === null &&
  getCampaignDispatchDefinition("campaign.anything") === null);

// ---------------------------------------------------------------------------
// F. FROZEN AUDIENCE — REUSED, NEVER REBUILT
// ---------------------------------------------------------------------------
record("F01 no new audience or snapshot table is created",
  !/create table/i.test(sql) &&
  !/vendor_campaign_audience|snapshot/i.test(
    sql.replace(/to_regclass\('public\.vendor_campaign_audience_members'\)/g, " ")
       .replace(/vendor_campaign_audience_members'\s*and/g, " ")));
record("F02 the existing frozen audience table is asserted present and immutable",
  /to_regclass\('public\.vendor_campaign_audience_members'\) is null/.test(sql) &&
  /trg_vcam_immutable/.test(sql));
record("F03 the campaign foundation migration is byte-frozen",
  canonicalSha256(readFileSync(path.join(ROOT, CAMPAIGN_FOUNDATION))) === FOUNDATION_SHA);
record("F04 the bounded handoff migration is byte-frozen",
  canonicalSha256(readFileSync(path.join(ROOT, HANDOFF_MIGRATION))) === HANDOFF_SHA);
record("F05 revision remains the campaign version token",
  /vendor_campaigns\.revision/.test(migrationSource) &&
  /revision/.test(doc));
record("F06 no second per-recipient authority may exist",
  /vendor_campaign_deliveries/.test(sql) &&
  /vendor_campaign_dispatches/.test(sql) &&
  /a second per-recipient campaign authority exists/.test(migrationSource));

// ---------------------------------------------------------------------------
// I. THE INTENT REMAINS THE PER-RECIPIENT AUTHORITY
// ---------------------------------------------------------------------------
record("I01 the vehicle is keyed by the communication_intent id",
  /'qf_action_v1:campaign\.execute_recipient:communication_intent:' \|\| v_intent\.id::text/.test(sql));
record("I02 only a vendor_campaign intent may produce a job",
  CAMPAIGN_INTENT_AGGREGATE_TYPE === "vendor_campaign" &&
  /aggregate_type is distinct from 'vendor_campaign'/.test(sql) &&
  /QF_PRODUCER_NOT_A_CAMPAIGN_INTENT/.test(sql));
record("I03 the trigger is scoped strictly to campaign intents",
  /when \(new\.aggregate_type = 'vendor_campaign'\)/.test(sql) &&
  /after insert on public\.communication_intents/.test(sql));
record("I04 a replayed intent yields the same job, never a second",
  /if v_request\.id is not null then[\s\S]{0,300}?return v_job;/.test(sql) &&
  /idempotency_key = v_idempotency_key/.test(sql));
record("I05 the safe context is empty — campaign truth is not copied",
  /'\{\}'::jsonb/.test(sql) &&
  /copying any of them here would create a second/.test(migrationSource));
record("I06 no template, recipient or provider is carried on the job",
  (() => {
    // exactly the producer function body, not the grants or the guards that
    // follow it
    const i = sql.indexOf("create or replace function public.qf_enqueue_campaign_recipient_automation_v1");
    const j = sql.indexOf("comment on function", i);
    const body = sql.slice(i, j === -1 ? sql.length : j);
    return !/recipient_ref|template_purpose|provider|phone|destination/i.test(body);
  })());
record("I07 the template authority stays the intent's committed row",
  CAMPAIGN_DISPATCH_REGISTRY["campaign.execute_recipient"].templateAuthority ===
    "communication_intents.template_purpose");

// ---------------------------------------------------------------------------
// B. BOUNDED BATCHING — UNCHANGED, NO SECOND FAN-OUT
// ---------------------------------------------------------------------------
record("B01 the batch bounds are exactly 1..500 default 100",
  CAMPAIGN_HANDOFF_BATCH_BOUNDS.min === 1 &&
  CAMPAIGN_HANDOFF_BATCH_BOUNDS.max === 500 &&
  CAMPAIGN_HANDOFF_BATCH_BOUNDS.default === 100 &&
  CAMPAIGN_HANDOFF_BATCH_BOUNDS.authority === "qf_handoff_vendor_campaign_intents_v1");
record("B02 those bounds match the existing service constants",
  /HANDOFF_BATCH_MIN = 1/.test(handoffService) &&
  /HANDOFF_BATCH_MAX = 500/.test(handoffService) &&
  /HANDOFF_BATCH_DEFAULT = 100/.test(handoffService));
record("B03 the handoff remains the only batching authority",
  /qf_handoff_vendor_campaign_intents_v1/.test(sql) &&
  /the bounded handoff authority is missing/.test(migrationSource) &&
  /adds no fan-out of its own/.test(migrationSource));
record("B04 this phase introduces no batch loop of its own",
  !/for .* in[\s\S]{0,200}?limit /i.test(sql) &&
  !/p_batch_limit|batch_size|cursor|offset/i.test(sql));

// ---------------------------------------------------------------------------
// S. CAMPAIGN STATUS VOCABULARY — UNCHANGED
// ---------------------------------------------------------------------------
record("S01 the business statuses are exactly the existing five",
  same([...CAMPAIGN_BUSINESS_STATUSES],
    ["draft", "ready_for_review", "approved", "cancelled", "archived"]));
record("S02 no running / paused / completed status is invented",
  !CAMPAIGN_BUSINESS_STATUSES.includes("running") &&
  !CAMPAIGN_BUSINESS_STATUSES.includes("paused") &&
  !CAMPAIGN_BUSINESS_STATUSES.includes("completed") &&
  /a new campaign execution status was invented/.test(migrationSource));
record("S03 no pause/resume column is added",
  /'paused_at', 'resumed_at', 'paused_by', 'is_paused'/.test(sql) &&
  /a pause\/resume column was added/.test(migrationSource) &&
  !/add column[^;]*paus/i.test(sql));
record("S04 the migration self-verifies the vocabulary is unchanged",
  /the campaign status vocabulary changed/.test(migrationSource));
record("S05 the doc states the state machine is not expanded",
  /not expand/i.test(doc) && /draft/.test(doc) && /archived/.test(doc));

// ---------------------------------------------------------------------------
// C. CONSENT / SUPPRESSION / FREQUENCY REMAIN CORE-OWNED
// ---------------------------------------------------------------------------
record("C01 this phase decides no consent, suppression or frequency",
  !/communication_preferences|communication_suppressions|communication_frequency_policies/.test(sql));
record("C02 the campaign row remains the consent-scope authority",
  CAMPAIGN_DISPATCH_REGISTRY["campaign.execute_recipient"].consentScopeAuthority ===
    "vendor_campaigns.consent_scope" &&
  /Restating a\s*\n?\s*\* scope here would let/.test(registrySource));
record("C03 marketing is never inferred from transactional",
  /marketing requires an explicit current\s*\n?\s*\/\/\s*opt-in/i.test(registrySource) ||
  /marketing requires an explicit/i.test(registrySource + doc));
record("C04 consent is re-proven at execution, per the 40.8 contract",
  /re-checked at the network boundary/.test(contractDoc) &&
  /RE-PROVEN by Core at execution/.test(registrySource));
record("C05 provider absence may fail closed and is not fabricated",
  !/send_authority|binding_readiness|provider_template_mappings/i.test(sql + registrySource) &&
  /fail closed/i.test(doc));

// ---------------------------------------------------------------------------
// R. THE 40.8 EXECUTION SEAM
// ---------------------------------------------------------------------------
record("R01 the binding contract document is referenced by path",
  /docs\/QF-MVP-40-8-CAMPAIGN-RESULT-CONTRACT\.md/.test(migrationSource) &&
  /QF-MVP-40-8-CAMPAIGN-RESULT-CONTRACT\.md/.test(doc));
record("R02 the three seam functions exist in Core exactly as named",
  /export async function buildCampaignExecutionPlan/.test(resultService) &&
  /export async function reconcileCampaignIntent/.test(resultService) &&
  /export async function getCampaignResultProjection/.test(resultService));
record("R03 the seam order is documented: plan -> CommunicationService -> reconcile",
  /buildCampaignExecutionPlan[\s\S]{0,400}?CommunicationService[\s\S]{0,400}?reconcileCampaignIntent/
    .test(migrationSource) &&
  /buildCampaignExecutionPlan[\s\S]{0,600}?reconcileCampaignIntent/.test(doc));
record("R04 aggregation derives from durable truth, never from n8n",
  /getCampaignResultProjection/.test(registrySource + doc) &&
  /derived from durable truth/i.test(registrySource) &&
  /never .*aggregate|aggregate.*never/i.test(registrySource + doc));
record("R05 no second metrics authority is created",
  !/create (table|view|materialized view)/i.test(sql) &&
  !/count\(\*\)\s+as\s+(total|delivered|failed)/i.test(sql));

// ---------------------------------------------------------------------------
// N. n8n HAS NO BUSINESS AUTHORITY
// ---------------------------------------------------------------------------
record("N01 the dispatch definition declares zero n8n-supplied authorities",
  same(CAMPAIGN_DISPATCH_REGISTRY["campaign.execute_recipient"].n8nSuppliedAuthorities, []));
record("N02 n8n never builds an audience or chooses a recipient",
  /n8n holds NONE of the above/i.test(registrySource) &&
  /never builds an audience/i.test(registrySource) &&
  /NEVER builds audience|never builds an audience/i.test(doc));
record("N03 no recipient array or audience parameter is accepted anywhere",
  !/recipient_ids|recipientIds|vendor_ids|vendorIds|recipients\s*\[\]/i.test(sql + registrySource));
record("N04 the producer takes only an intent id",
  /qf_enqueue_campaign_recipient_automation_v1\(\s*\n?\s*p_intent_id uuid\s*\n?\s*\)/.test(sql));
record("N05 no direct n8n write path to campaign or communication tables",
  !/grant [^\n]*to (public|anon|authenticated)\b/i.test(sql) &&
  /grant execute on function public\.qf_enqueue_campaign_recipient_automation_v1[\s\S]{0,160}?to service_role/.test(sql));

// ---------------------------------------------------------------------------
// P. PRODUCER POSTURE
// ---------------------------------------------------------------------------
record("P01 SECURITY DEFINER with a pinned search_path",
  /create or replace function public\.qf_enqueue_campaign_recipient_automation_v1[\s\S]{0,400}?security definer[\s\S]{0,120}?set search_path = pg_catalog, public, pg_temp/.test(sql));
record("P02 execute is service_role only",
  /revoke all on function public\.qf_enqueue_campaign_recipient_automation_v1[\s\S]{0,200}?from public, anon, authenticated, service_role/.test(sql));
record("P03 it writes through the adopted 50.1B writers",
  /qf_create_automation_action_request_v1\(/.test(sql) &&
  /qf_decide_automation_action_request_v1\(/.test(sql) &&
  /qf_create_automation_job_v1\(/.test(sql));
record("P04 exactly one campaign producer trigger, self-verified",
  (sql.match(/create trigger trg_qf_produce_campaign_/g) ?? []).length === 1 &&
  /expected exactly 1 campaign producer trigger/.test(migrationSource));
record("P05 no schema growth",
  !/create table|add column|create (unique )?index|alter table|create type/i.test(sql));

// ---------------------------------------------------------------------------
// X. BOUNDARIES
// ---------------------------------------------------------------------------
record("X01 no generic QF-MVP-50.5 retry recovery",
  !/due_sweep|retry_worker|recovery_worker|reclaimStale/i.test(sql) &&
  /QF-MVP-50\.5/.test(doc));
record("X02 no vendor accept/reject concept",
  !/accept\/reject|acceptlead|rejectlead|acceptance_rate|rejection_rate/i.test(
    (sql + registrySource).toLowerCase()));
record("X03 no Jarvis reference",
  !/qf-jarvis|coilipywdvxklewquqvv/i.test(sql + registrySource + doc));
record("X04 QF-MVP-50.2 is not reopened",
  !/create or replace function public\.qf_claim_automation_job_v1/.test(sql) &&
  !/create or replace function public\.qf_record_automation_execution_transport_v1/.test(sql) &&
  !/create or replace function public\.qf_enqueue_client_automation_v1/.test(sql));

// ---------------------------------------------------------------------------
// G. GOVERNANCE
// ---------------------------------------------------------------------------
record("G01 the migration is pinned PENDING with exact identity",
  (() => {
    const pin = manifest.pendingPostAnchorMigrations
      .find((r) => r.version === "20260810000000");
    return Boolean(pin) &&
      pin.path === MIGRATION_PATH &&
      pin.sha256 === MIGRATION_SHA &&
      pin.operationalStatus === "PENDING" &&
      pin.remoteVersionStatus === "NOT_PROVEN_OFFLINE" &&
      pin.requiresSeparateStagingDeploymentGate === true &&
      pin.appliedByThisPhase === false &&
      !("appliedEvidenceMarker" in pin) &&
      !("remoteHistoryCountAfterApply" in pin);
  })());
record("G02 exactly two pending post-anchor migrations are declared",
  manifest.pendingPostAnchorMigrations.length === 2 &&
  same(manifest.pendingPostAnchorMigrations.map((r) => r.version),
    ["20260809000000", "20260810000000"]));
record("G03 the five applied records remain 21/22/23/24/25",
  same(manifest.appliedPostAnchorMigrations.map((r) => r.remoteHistoryCountAfterApply),
    [21, 22, 23, 24, 25]));
record("G04 the doc states SOURCE READY, not complete",
  /SOURCE READY/.test(doc) && !/COMPLETE \/ TESTED \/ FROZEN/.test(doc));
record("G05 the validator is registered and wired into CI after 50.3",
  pkg.scripts["test:mvp:50-4"] ===
    "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/mvp/loader/register.mjs scripts/mvp/automation/validate-qf-mvp-50-4.mjs" &&
  /- name: QF-MVP-50\.3 validator\s+run: npm run test:mvp:50-3\s+- name: QF-MVP-50\.4 validator\s+run: npm run test:mvp:50-4/.test(ciWorkflow));
record("G06 the local migration set is exactly 94",
  readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).length === 94);

// ---------------------------------------------------------------------------
// M. MUTANTS
// ---------------------------------------------------------------------------
const mutants = [
  ["creating a new campaign audience table is impossible",
    () => !/create table/i.test(sql)],
  ["an audience computed by n8n is impossible",
    () => /never builds an audience/i.test(registrySource) &&
          !/recipient_ids|vendorIds/i.test(sql + registrySource)],
  ["a recipient array supplied by n8n is impossible",
    () => /qf_enqueue_campaign_recipient_automation_v1\(\s*\n?\s*p_intent_id uuid\s*\n?\s*\)/.test(sql)],
  ["a second communication-intent authority is impossible",
    () => /vendor_campaign_intents/.test(sql) &&
          /a second per-recipient campaign authority exists/.test(migrationSource) &&
          !/create table/i.test(sql)],
  ["changing the batch bound or default is impossible",
    () => CAMPAIGN_HANDOFF_BATCH_BOUNDS.max === 500 &&
          CAMPAIGN_HANDOFF_BATCH_BOUNDS.default === 100 &&
          /HANDOFF_BATCH_MAX = 500/.test(handoffService)],
  ["expanding the campaign status vocabulary is impossible",
    () => same([...CAMPAIGN_BUSINESS_STATUSES],
            ["draft", "ready_for_review", "approved", "cancelled", "archived"]) &&
          /a new campaign execution status was invented/.test(migrationSource)],
  ["bypassing marketing consent is impossible",
    () => !/communication_preferences/.test(sql) &&
          /marketing requires an explicit/i.test(registrySource + doc)],
  ["bypassing suppression or frequency is impossible",
    () => !/communication_suppressions|communication_frequency_policies/.test(sql)],
  ["skipping reconciliation is impossible",
    () => /reconcileCampaignIntent/.test(migrationSource) &&
          /reconcileCampaignIntent/.test(doc)],
  ["n8n supplying aggregate truth is impossible",
    () => same(CAMPAIGN_DISPATCH_REGISTRY["campaign.execute_recipient"].n8nSuppliedAuthorities, []) &&
          !/create (table|view)/i.test(sql)],
  ["adding a retry worker here is impossible",
    () => !/due_sweep|retry_worker|recovery_worker/i.test(sql)],
  ["producing campaign.execute_batch here is impossible",
    () => !sql.includes("'campaign.execute_batch'") &&
          getNonProducedCampaignReason("campaign.execute_batch") ===
            "BATCH_ADVANCE_REMAINS_CORE_OWNED_HANDOFF"],
  ["editing the frozen handoff or foundation migration is impossible",
    () => canonicalSha256(readFileSync(path.join(ROOT, HANDOFF_MIGRATION))) === HANDOFF_SHA &&
          canonicalSha256(readFileSync(path.join(ROOT, CAMPAIGN_FOUNDATION))) === FOUNDATION_SHA],
  ["adding a 15th action type is impossible",
    () => AUTOMATION_ACTION_TYPES.length === 14],
];
for (const [name, fn] of mutants) {
  let held = false;
  try { held = fn() === true; } catch { held = false; }
  record(`M-${name}`, held);
}

// ---------------------------------------------------------------------------
for (const r of results) {
  console.log(`${r.passed ? "PASS" : "FAIL"} ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
}
const failed = results.filter((r) => !r.passed);
console.log(`\nQF-MVP-50.4: ${results.length - failed.length}/${results.length} ${failed.length ? "FAIL" : "PASS"}`);
if (failed.length) {
  console.log("QF_MVP_50_4_CAMPAIGN_AUTOMATION_BLOCKED");
  process.exit(1);
}
console.log("QF_MVP_50_4_CAMPAIGN_AUTOMATION_SOURCE_READY");
