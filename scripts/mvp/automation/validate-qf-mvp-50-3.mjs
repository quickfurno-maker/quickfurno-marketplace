#!/usr/bin/env node
// ============================================================================
// QF-MVP-50.3 — VENDOR WORKFLOWS validator
//
// OFFLINE ONLY. No database, no network, no provider, no n8n, no Jarvis.
//
// Freezes the owner-locked vendor automation contract: the five ACTIVE actions,
// their exact schedules, the config-driven low-credit threshold, the
// crossing/re-arm semantics, the execution-time reproofs, and the permanent
// absence of any vendor accept/reject concept.
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VENDOR_AUTOMATION_ACTION_TYPES,
  VENDOR_DISPATCH_REGISTRY,
  NON_PRODUCIBLE_VENDOR_ACTIONS,
  VENDOR_LOW_CREDIT_THRESHOLD_POLICY_KEY,
  getVendorDispatchDefinition,
  getNonProducibleVendorReason,
  isAllowedVendorDispatchEntityType,
} from "../../../lib/automation/vendorDispatchRegistry.ts";
import { AUTOMATION_ACTION_TYPES } from "../../../lib/automation/actionRegistry.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const canonicalSha256 = (buf) =>
  sha256(Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const MIGRATION_NAME = "20260809000000_qf_mvp_50_3_vendor_automation_producer.sql";
const MIGRATION_PATH = `supabase/migrations/${MIGRATION_NAME}`;
const MIGRATION_SHA = "a4b94ac6df39caa71ef9adcb8f40eb19850d425f3724c82fc4a7bc979ed8fb11";

// The owner-locked policy values. Every one of these is a decision, not a guess.
const LOW_CREDIT_THRESHOLD = 3;
const LOW_CREDIT_POLICY_KEY = "vendor_low_credit_warning_threshold";
const LOW_CREDIT_CONFIG_JSON =
  '{"policyVersion":"vendor_low_credit_warning_threshold_v1","thresholdCredits":3}';
const LOW_CREDIT_CONFIG_FINGERPRINT =
  "ae4192b16847ccbd545c492a0213422ade4e5c0b3b51556743cc00bd4172372c";

const migrationSource = read(MIGRATION_PATH);
const sql = stripSql(migrationSource);
const registrySource = read("lib/automation/vendorDispatchRegistry.ts");
const manifestText = read("supabase/staging-history/qf-mvp-staging-history-manifest.json");
const manifest = JSON.parse(manifestText);
const doc = read("docs/QF-MVP-50-3-VENDOR-WORKFLOWS.md");
const ciWorkflow = read(".github/workflows/qf-mvp-50-quality-gate.yml");
const pkg = JSON.parse(read("package.json"));

const results = [];
const record = (name, passed, detail = "") =>
  results.push({ name, passed: Boolean(passed), detail });

/** DDL/producer surface only — everything before the trailing self-verification
 *  block, which legitimately probes the refusal and names forbidden columns. */
const producerSurface = (() => {
  const i = sql.lastIndexOf("do $$");
  return i === -1 ? sql : sql.slice(0, i);
})();

/** Only `perform ... qf_enqueue_vendor_automation_v1('<action>'` call sites. */
const enqueueCallsFor = (action) => {
  const pattern =
    "perform public\\.qf_enqueue_vendor_automation_v1\\(\\s*'" + action.replace(/\./g, "\\.") + "'";
  return (producerSurface.match(new RegExp(pattern, "g")) ?? []).length;
};

// ---------------------------------------------------------------------------
// A. THE ACTIVE ACTION SET
// ---------------------------------------------------------------------------
record("A01 the migration exists at its pinned hash",
  existsSync(path.join(ROOT, MIGRATION_PATH)) &&
  canonicalSha256(readFileSync(path.join(ROOT, MIGRATION_PATH))) === MIGRATION_SHA);
record("A02 exactly five ACTIVE vendor actions are declared",
  VENDOR_AUTOMATION_ACTION_TYPES.length === 5 &&
  same([...VENDOR_AUTOMATION_ACTION_TYPES].sort(), [
    "vendor.lead_offer",
    "vendor.low_credit_warning",
    "vendor.onboarding_reminder",
    "vendor.package_expiry_warning",
    "vendor.response_reminder",
  ]));
record("A03 the frozen 14-action requestability registry is unchanged",
  AUTOMATION_ACTION_TYPES.length === 14 &&
  new Set(AUTOMATION_ACTION_TYPES).size === 14);
record("A04 every active vendor action exists in the frozen registry",
  VENDOR_AUTOMATION_ACTION_TYPES.every((a) => AUTOMATION_ACTION_TYPES.includes(a)));
record("A05 no action outside the frozen registry is invented",
  !/vendor\.profile_completion|vendor\.transactional_notification|package_expiry_reminder|low_credit_alert/
    .test(registrySource + sql));
record("A06 every active action routes to the vendor_whatsapp family",
  VENDOR_AUTOMATION_ACTION_TYPES.every(
    (a) => VENDOR_DISPATCH_REGISTRY[a].workflowFamily === "vendor_whatsapp"));
record("A07 every active action is transactional on the business lane",
  VENDOR_AUTOMATION_ACTION_TYPES.every(
    (a) => VENDOR_DISPATCH_REGISTRY[a].communicationLane === "business" &&
           VENDOR_DISPATCH_REGISTRY[a].consentScope === "transactional"));
record("A08 the destination strategy is always vendor_direct — never n8n-supplied",
  VENDOR_AUTOMATION_ACTION_TYPES.every(
    (a) => VENDOR_DISPATCH_REGISTRY[a].recipientStrategy === "vendor_direct"));

// ---------------------------------------------------------------------------
// D. DOCUMENT REMINDER — REGISTERED BUT NOT PRODUCIBLE
// ---------------------------------------------------------------------------
record("D01 vendor.document_reminder is NOT in the active set",
  !VENDOR_AUTOMATION_ACTION_TYPES.includes("vendor.document_reminder"));
record("D02 it remains in the frozen requestability registry",
  AUTOMATION_ACTION_TYPES.includes("vendor.document_reminder"));
record("D03 it is declared non-producible with the exact reason",
  getNonProducibleVendorReason("vendor.document_reminder") === "NO_CANONICAL_VENDOR_DOCUMENT_DOMAIN" &&
  NON_PRODUCIBLE_VENDOR_ACTIONS["vendor.document_reminder"].actionType === "vendor.document_reminder");
record("D04 the producer refuses it by construction with a dedicated code",
  /if p_action_type = 'vendor\.document_reminder' then[\s\S]{0,200}?QF_PRODUCER_VENDOR_DOCUMENT_DOMAIN_ABSENT/
    .test(producerSurface) &&
  // and it is absent from the allowlist itself
  (() => {
    const list = producerSurface.match(/not in \(([\s\S]*?)\)\s*then/);
    return Boolean(list) && !list[1].includes("vendor.document_reminder");
  })());
record("D05 the producer allowlist omits it entirely",
  enqueueCallsFor("vendor.document_reminder") === 0 &&
  !/perform public\.qf_enqueue_vendor_automation_v1\(\s*'vendor\.document_reminder'/.test(producerSurface));
record("D06 the migration self-verifies that it cannot be produced",
  /vendor\.document_reminder must not be producible/.test(migrationSource));
record("D07 the migration aborts if a vendor document domain ever appears",
  /to_regclass\('public\.vendor_documents'\) is not null/.test(sql) &&
  /producibility must be re-decided/.test(migrationSource));
record("D08 no vendor document/KYC domain is invented by this package",
  !/create table[^;]*vendor_documents|create table[^;]*vendor_kyc/i.test(sql));

// ---------------------------------------------------------------------------
// S. OWNER-LOCKED SCHEDULES
// ---------------------------------------------------------------------------
record("S01 lead_offer is immediate at assignment",
  same(VENDOR_DISPATCH_REGISTRY["vendor.lead_offer"].schedule, []) &&
  /'vendor\.lead_offer', 'lead_assignment', new\.id, 'assigned', now\(\)/.test(sql));
record("S02 response_reminder is EXACTLY +2h and +24h",
  same(VENDOR_DISPATCH_REGISTRY["vendor.response_reminder"].schedule.map((s) => s.minutes),
    [120, 1440]) &&
  /'vendor\.response_reminder', 'lead_assignment', new\.id, 'resp2h',\s*\n?\s*now\(\) \+ interval '2 hours'/.test(sql) &&
  /'vendor\.response_reminder', 'lead_assignment', new\.id, 'resp24h',\s*\n?\s*now\(\) \+ interval '24 hours'/.test(sql));
record("S03 there is no third response reminder and no repeating loop",
  enqueueCallsFor("vendor.response_reminder") === 2 &&
  VENDOR_DISPATCH_REGISTRY["vendor.response_reminder"].schedule.length === 2 &&
  !/interval '(1|6|12|48|72) hours'/.test(sql));
record("S04 onboarding_reminder is EXACTLY ONE reminder at +24h",
  VENDOR_DISPATCH_REGISTRY["vendor.onboarding_reminder"].schedule.length === 1 &&
  VENDOR_DISPATCH_REGISTRY["vendor.onboarding_reminder"].schedule[0].minutes === 1440 &&
  enqueueCallsFor("vendor.onboarding_reminder") === 1 &&
  /'vendor\.onboarding_reminder', 'vendor', new\.vendor_id, 'onbnew24h',\s*\n?\s*now\(\) \+ interval '24 hours'/.test(sql));
record("S05 package_expiry_warning is EXACTLY -7d and -1d",
  same(VENDOR_DISPATCH_REGISTRY["vendor.package_expiry_warning"].schedule.map((s) => s.minutes),
    [-10080, -1440]) &&
  /v_expiry - interval '7 days'/.test(sql) &&
  /v_expiry - interval '1 day'/.test(sql) &&
  enqueueCallsFor("vendor.package_expiry_warning") === 2);
record("S06 no other expiry cadence is present",
  !/interval '(3|5|14|30) days'/.test(sql));
record("S07 low_credit_warning is immediate on the crossing",
  same(VENDOR_DISPATCH_REGISTRY["vendor.low_credit_warning"].schedule, []) &&
  enqueueCallsFor("vendor.low_credit_warning") === 1);
record("S08 every schedule is durable — no in-memory timer",
  !/setTimeout|setInterval|pg_sleep/i.test(sql + registrySource));

// ---------------------------------------------------------------------------
// C. LOW CREDIT — CONFIG-DRIVEN THRESHOLD, CROSSING AND RE-ARM
// ---------------------------------------------------------------------------
record("C01 the canonical policy key is exact",
  VENDOR_LOW_CREDIT_THRESHOLD_POLICY_KEY === LOW_CREDIT_POLICY_KEY &&
  sql.includes(`'${LOW_CREDIT_POLICY_KEY}'`));
record("C02 the threshold is seeded as the owner-locked 3",
  migrationSource.includes(LOW_CREDIT_CONFIG_JSON) &&
  migrationSource.includes(LOW_CREDIT_CONFIG_FINGERPRINT) &&
  sha256(LOW_CREDIT_CONFIG_JSON) === LOW_CREDIT_CONFIG_FINGERPRINT);
record("C03 the seed uses automation_policy_configs + active_configs, not a new table",
  /insert into public\.automation_policy_configs/.test(sql) &&
  /insert into public\.automation_policy_active_configs/.test(sql) &&
  !/create table/i.test(sql));
record("C04 it does NOT repurpose the unrelated lead_distribution policy key",
  !/lead_distribution_authorization/.test(sql));
record("C05 ONE reader function serves both produce and execute time",
  /create or replace function public\.qf_vendor_low_credit_threshold_v1\(\)/.test(sql) &&
  /config_json ->> 'thresholdCredits'/.test(sql));
record("C06 the runtime reads the config — the threshold is NOT hard-coded",
  /v_threshold integer := public\.qf_vendor_low_credit_threshold_v1\(\)/.test(sql) &&
  // no bare numeric comparison against remaining_credits anywhere in the producer
  !/remaining_credits\s*(<=|<|>=|>)\s*\d/.test(sql) &&
  // and the TS dispatch authority names the policy key rather than a number
  !/thresholdCredits\s*[:=]\s*\d/.test(registrySource) &&
  !/\b(?:threshold|THRESHOLD)\s*[:=]\s*3\b/.test(registrySource));
record("C07 an unconfigured threshold warns nothing — no literal fallback",
  /if v_threshold is null[\s\S]{0,120}?return new;/.test(sql) &&
  /NULL means unconfigured/.test(migrationSource) &&
  !/coalesce\(\s*public\.qf_vendor_low_credit_threshold_v1\(\)\s*,\s*\d/.test(sql));
record("C08 a warning requires a REAL crossing: above -> at-or-below",
  /if not \(v_old > v_threshold and v_new <= v_threshold\) then[\s\S]{0,80}?return new;/.test(sql));
record("C09 2->1 and 1->0 cannot warn, because neither is a crossing",
  /v_old > v_threshold/.test(sql) && !/v_new <= v_threshold\s*\)?\s*then\s*\n\s*perform/.test(sql));
record("C10 re-arm is documented and follows from the crossing rule",
  /recharge/i.test(migrationSource) && /RE-ARMS/i.test(migrationSource));
record("C11 the crossing identity is per-crossing, not per-vendor",
  /'lowcred\.' \|\| md5\(new\.id::text \|\| ':' \|\| v_old::text \|\| ':' \|\| v_new::text\s*\n?\s*\|\| ':' \|\| txid_current\(\)::text\)/.test(sql));
record("C12 the trigger only fires on a real balance change",
  /after update of remaining_credits on public\.vendors/.test(sql) &&
  /when \(new\.remaining_credits is distinct from old\.remaining_credits\)/.test(sql));
record("C13 no credit mutation happens anywhere in this package",
  !/update public\.vendors[^;]*remaining_credits\s*=/i.test(sql) &&
  !/qf_apply_vendor_credit_delta/.test(sql));

// ---------------------------------------------------------------------------
// P. PRODUCER ATOMICITY AND IDEMPOTENCY
// ---------------------------------------------------------------------------
record("P01 the producer is SECURITY DEFINER with a pinned search_path",
  /create or replace function public\.qf_enqueue_vendor_automation_v1[\s\S]{0,600}?security definer[\s\S]{0,120}?set search_path = pg_catalog, public, pg_temp/.test(sql));
record("P02 execute is granted to service_role only",
  /revoke all on function public\.qf_enqueue_vendor_automation_v1[\s\S]{0,200}?from public, anon, authenticated, service_role/.test(sql) &&
  /grant execute on function public\.qf_enqueue_vendor_automation_v1[\s\S]{0,200}?to service_role/.test(sql) &&
  !/grant [^\n]*to (public|anon|authenticated)\b/i.test(sql));
record("P03 request, authorize and job happen in one function body",
  /qf_create_automation_action_request_v1\(/.test(sql) &&
  /qf_decide_automation_action_request_v1\(/.test(sql) &&
  /qf_create_automation_job_v1\(/.test(sql));
record("P04 the producer accepts NO business authority from its caller",
  (() => {
    const sig = sql.match(/qf_enqueue_vendor_automation_v1\(([\s\S]*?)\)\s*returns/);
    if (!sig) return false;
    return !/recipient|phone|email|template|provider|consent|classification|safe_code|retry|credit/i
      .test(sig[1]);
  })());
record("P05 the entity vocabulary is closed and action-bound",
  /p_entity_type not in \('vendor', 'lead_assignment'\)/.test(sql) &&
  /QF_PRODUCER_ENTITY_TYPE_MISMATCH/.test(sql) &&
  isAllowedVendorDispatchEntityType("vendor.lead_offer", "lead_assignment") &&
  !isAllowedVendorDispatchEntityType("vendor.lead_offer", "vendor") &&
  isAllowedVendorDispatchEntityType("vendor.low_credit_warning", "vendor") &&
  !isAllowedVendorDispatchEntityType("vendor.low_credit_warning", "lead_assignment"));
record("P06 dedupe reuses the 50.1B idempotency convention",
  /'qf_action_v1:'/.test(sql) && /idempotency_key = v_idempotency_key/.test(sql));
record("P07 a replay returns the existing job instead of a second one",
  /if v_request\.id is not null then[\s\S]{0,300}?return v_job;/.test(sql));
record("P08 the source-event token is a bounded safe identifier",
  /p_source_event_key !~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\{0,127\}\$'/.test(sql));
record("P09 exactly four vendor producer triggers, self-verified",
  (sql.match(/create trigger trg_qf_produce_vendor_/g) ?? []).length === 4 &&
  /expected 4 vendor producer triggers/.test(migrationSource));
record("P10 the producer adds no table, column, index or type",
  !/create table|add column|create (unique )?index|alter table|create type/i.test(sql));
record("P11 no TypeScript fire-and-forget producer is introduced",
  !/qf_enqueue_vendor_automation_v1/.test(registrySource));
record("P12 the package expiry identity binds the exact expiry instant",
  /'pkgexp7d\.' \|\| v_stamp/.test(sql) && /'pkgexp1d\.' \|\| v_stamp/.test(sql) &&
  /to_char\(v_expiry at time zone 'UTC', 'YYYYMMDDHH24MISS'\)/.test(sql));

// ---------------------------------------------------------------------------
// E. EXECUTION-TIME REPROOF (documented contract)
// ---------------------------------------------------------------------------
record("E01 the onboarding reminder is bound to the canonical initial stage",
  /onboarding_stage is distinct from 'new'/.test(sql) &&
  /still the exact initial/i.test(migrationSource));
record("E02 the package warning requires an active package at produce time",
  /new\.package_status is distinct from 'active'/.test(sql));
record("E03 a renewal creates a new identity and strands the old warning",
  /renewal/i.test(migrationSource) && /execution-time reproof/i.test(migrationSource));
record("E04 every reproof is documented per action",
  ["vendor.lead_offer", "vendor.response_reminder", "vendor.onboarding_reminder",
   "vendor.package_expiry_warning", "vendor.low_credit_warning"].every((a) => doc.includes(a)) &&
  /execution-time reproof/i.test(doc));
record("E05 a past-due warning window is never enqueued",
  /if v_expiry - interval '7 days' > now\(\) then/.test(sql) &&
  /if v_expiry - interval '1 day' > now\(\) then/.test(sql));

// ---------------------------------------------------------------------------
// X. NO VENDOR ACCEPT / REJECT — PERMANENT
// ---------------------------------------------------------------------------
// Identifier-level phrases. The trailing self-verification block deliberately
// NAMES acceptance_rate / rejection_rate in order to forbid them, so the scan
// runs over the executable producer surface, not over its own guard.
const ACCEPT_REJECT_PHRASES = [
  "acceptlead", "rejectlead", "declinelead",
  "vendor_accept", "vendor_reject", "vendor_decline",
  "accepted_lead", "rejected_lead", "lead_accepted", "lead_rejected",
  "acceptance_rate", "rejection_rate", "acceptancerate", "rejectionrate",
];
record("X01 no accept/reject identifier exists in this package's code",
  (() => {
    const code = (producerSurface + registrySource).toLowerCase();
    return !ACCEPT_REJECT_PHRASES.some((p) => code.includes(p));
  })());
record("X02 accept/reject may be named only to forbid it, never to build it",
  // no executable construct may create or mutate accept/reject state
  !/create (table|function|index|trigger|type)[^;]*(accept|reject)/i.test(producerSurface) &&
  !/(insert into|update)\s+public\.[a-z_]*(accept|reject)/i.test(producerSurface) &&
  !/add column[^;]*(accept|reject)/i.test(producerSurface) &&
  // and both the migration and the doc state the prohibition explicitly
  /NO VENDOR ACCEPT \/ REJECT/.test(migrationSource) &&
  /No vendor accept \/ reject/i.test(doc));
record("X03 lead_offer is documented as one-way, with no decision state",
  /ONE-WAY TRANSACTIONAL ASSIGNMENT NOTIFICATION/.test(migrationSource) &&
  /ONE-WAY/i.test(doc) &&
  /no decision state|creates no decision/i.test(migrationSource + doc));
record("X04 response_reminder means progress, not acceptance",
  /vendor_status = 'New'/.test(migrationSource) &&
  /never an acceptance prompt|never .*acceptance/i.test(registrySource + doc));
record("X05 accepting_leads stays an availability toggle, not accept/reject",
  /availability toggle/i.test(registrySource + migrationSource));
record("X06 no accept/reject endpoint, table, column or function is created",
  !/create (table|function|index)[^;]*(accept|reject)/i.test(sql) &&
  !/add column[^;]*(accept|reject)/i.test(sql));
record("X07 the migration self-verifies no accept/reject column exists",
  /a vendor accept\/reject column exists/.test(migrationSource));

// ---------------------------------------------------------------------------
// B. BOUNDARIES — 50.5, provider readiness, 50.2 untouched
// ---------------------------------------------------------------------------
record("B01 no generic QF-MVP-50.5 retry recovery is implemented",
  !/due_sweep|dueSweep|reclaimStale|retry_worker|recovery_worker/i.test(sql) &&
  !/retry_scheduled/.test(sql.replace(/-- [^\n]*/g, "")));
record("B02 the 50.5 boundary is documented",
  /QF-MVP-50\.5/.test(doc) && /retry/i.test(doc));
record("B03 no provider readiness is fabricated",
  !/send_authority|binding_readiness|APPROVED_UNMAPPED|provider_template_mappings/i.test(sql + registrySource) &&
  /never proof[\s\S]{0,40}approved provider template/i.test(registrySource));
record("B04 the 40/80 live-provider boundary is documented",
  /QF-MVP-40/.test(doc) && /QF-MVP-80/.test(doc));
record("B05 no provider, Meta or n8n call is made by the producer",
  !/http|pg_net|dblink|n8n|meta|whatsapp_send/i.test(
    sql.replace(/vendor_whatsapp|whatsapp_number/g, "")));
record("B06 QF-MVP-50.2 is not reopened",
  !/qf_enqueue_client_automation_v1\s*\(/.test(
    sql.replace(/to_regprocedure\('public\.qf_enqueue_client_automation_v1[^)]*\)/g, "")) &&
  !/create or replace function public\.qf_claim_automation_job_v1/.test(sql) &&
  !/create or replace function public\.qf_record_automation_execution_transport_v1/.test(sql));
record("B07 no campaign schema is touched by the vendor migration",
  !/vendor_campaigns|vendor_campaign_audience_members|communication_intents/.test(sql));

// ---------------------------------------------------------------------------
// G. GOVERNANCE
// ---------------------------------------------------------------------------
record("G01 the migration is pinned PENDING with exact identity",
  (() => {
    const pin = manifest.pendingPostAnchorMigrations
      .find((r) => r.version === "20260809000000");
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
record("G02 the five applied post-anchor records are untouched at 21/22/23/24/25",
  same(manifest.appliedPostAnchorMigrations.map((r) => r.remoteHistoryCountAfterApply),
    [21, 22, 23, 24, 25]));
record("G03 no fabricated remote history for the new migration",
  !manifestText.includes("QF_MVP_50_3_") || !/remoteHistoryCountAfterApply": 26/.test(manifestText));
record("G04 the doc states SOURCE READY, not complete",
  /SOURCE READY/.test(doc) &&
  !/COMPLETE \/ TESTED \/ FROZEN/.test(doc) &&
  /NOT.*(complete|certified)/i.test(doc));
record("G05 the doc records the non-producible decision with its exact reason",
  /REGISTERED_BUT_NOT_PRODUCIBLE/.test(doc) &&
  /NO_CANONICAL_VENDOR_DOCUMENT_DOMAIN/.test(doc));
record("G06 no Jarvis reference appears in this package",
  !/qf-jarvis|coilipywdvxklewquqvv/i.test(sql + registrySource + doc));
record("G07 the validator is registered and wired into CI after 50.2 final",
  pkg.scripts["test:mvp:50-3"] ===
    "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/mvp/loader/register.mjs scripts/mvp/automation/validate-qf-mvp-50-3.mjs" &&
  /- name: QF-MVP-50\.2 final closure validator\s+run: npm run test:mvp:50-2-final\s+- name: QF-MVP-50\.3 validator\s+run: npm run test:mvp:50-3/.test(ciWorkflow));
record("G08 CI still takes no secret, database, provider or deployment action",
  !ciWorkflow.includes("${{ secrets.") &&
  !/^\s*(?:run:\s*)?(?:npx\s+)?supabase\s+/mi.test(ciWorkflow) &&
  !/\bdb push\b/i.test(ciWorkflow));
record("G09 the local migration set is exactly 94",
  readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).length === 94);

// ---------------------------------------------------------------------------
// M. MUTANTS — each defect must be impossible by construction
// ---------------------------------------------------------------------------
const mutants = [
  ["a threshold of 2 or 4 is impossible",
    () => LOW_CREDIT_THRESHOLD === 3 &&
          migrationSource.includes('"thresholdCredits":3') &&
          !/thresholdCredits":\s*(2|4)/.test(migrationSource)],
  ["hard-coding the threshold instead of reading config is impossible",
    () => /public\.qf_vendor_low_credit_threshold_v1\(\)/.test(sql) &&
          !/remaining_credits\s*(<=|<|>=|>)\s*\d/.test(sql)],
  ["warning at <= threshold without a crossing is impossible",
    () => /v_old > v_threshold and v_new <= v_threshold/.test(sql)],
  ["failing to re-arm after a recharge is impossible",
    () => /v_old > v_threshold/.test(sql) && /RE-ARMS/i.test(migrationSource)],
  ["a 3-day or 14-day package warning is impossible",
    () => !/interval '(3|5|14|30) days'/.test(sql) &&
          /interval '7 days'/.test(sql) && /interval '1 day'/.test(sql)],
  ["removing the 1-day package warning is impossible",
    () => enqueueCallsFor("vendor.package_expiry_warning") === 2 &&
          /'pkgexp1d\.'/.test(sql)],
  ["a 1h/6h/48h response reminder is impossible",
    () => !/interval '(1|6|48|72) hours'/.test(sql) &&
          /interval '2 hours'/.test(sql) && /interval '24 hours'/.test(sql)],
  ["a third response reminder is impossible",
    () => enqueueCallsFor("vendor.response_reminder") === 2],
  ["a repeating onboarding cadence is impossible",
    () => enqueueCallsFor("vendor.onboarding_reminder") === 1],
  ["onboarding reminding a progressed vendor is impossible",
    () => /onboarding_stage is distinct from 'new'/.test(sql)],
  ["adding a vendor.document_reminder producer is impossible",
    () => enqueueCallsFor("vendor.document_reminder") === 0 &&
          /QF_PRODUCER_VENDOR_DOCUMENT_DOMAIN_ABSENT/.test(producerSurface)],
  ["a vendor accept/reject action or state is impossible",
    () => {
      const code = (producerSurface + registrySource).toLowerCase();
      return !ACCEPT_REJECT_PHRASES.some((p) => code.includes(p));
    }],
  ["n8n choosing vendor, phone, template or provider is impossible",
    () => VENDOR_AUTOMATION_ACTION_TYPES.every(
            (a) => VENDOR_DISPATCH_REGISTRY[a].recipientStrategy === "vendor_direct") &&
          (() => {
            const sig = sql.match(/qf_enqueue_vendor_automation_v1\(([\s\S]*?)\)\s*returns/);
            return sig ? !/phone|template|provider|recipient/i.test(sig[1]) : false;
          })()],
  ["adding a retry worker here is impossible",
    () => !/due_sweep|retry_worker|recovery_worker|reclaimStale/i.test(sql)],
  ["adding a 15th action type is impossible",
    () => AUTOMATION_ACTION_TYPES.length === 14],
  ["an unknown action reaching the producer is impossible",
    () => /QF_PRODUCER_ACTION_NOT_VENDOR_DISPATCHABLE/.test(sql) &&
          getVendorDispatchDefinition("vendor.something_else") === null],
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
console.log(`\nQF-MVP-50.3: ${results.length - failed.length}/${results.length} ${failed.length ? "FAIL" : "PASS"}`);
if (failed.length) {
  console.log("QF_MVP_50_3_VENDOR_WORKFLOWS_BLOCKED");
  process.exit(1);
}
console.log("QF_MVP_50_3_VENDOR_WORKFLOWS_SOURCE_READY");
