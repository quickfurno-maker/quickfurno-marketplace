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
import { AUTOMATION_ACTION_TYPES, getWorkflowFamilyForAction } from "../../../lib/automation/actionRegistry.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const canonicalSha256 = (buf) =>
  sha256(Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const MIGRATION_NAME = "20260809000000_qf_mvp_50_3_vendor_automation_producer.sql";
const MIGRATION_PATH = `supabase/migrations/${MIGRATION_NAME}`;
const MIGRATION_SHA = "3588f6d06256af7d6ae95263bb474fb33a15428d0a402bd81c6dd1eb0e6076cb";

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

const CLAIM_MIGRATION_NAME =
  "20260811000000_qf_mvp_50_3_50_4_family_aware_claim_routing.sql";
const CLAIM_MIGRATION_PATH = `supabase/migrations/${CLAIM_MIGRATION_NAME}`;
const CLAIM_MIGRATION_SHA = "fc7efae9c2349854b9856d3b3b3956933bcfe79ed15c1eeb7caf65bc61f8f89d";
const claimMigrationSource = read(CLAIM_MIGRATION_PATH);
const claimSql = stripSql(claimMigrationSource);
const claimRouteSource = read("app/api/internal/automation/n8n/claim/route.ts");
const transportServiceSource = read("services/automationTransportService.ts");
const transportTypesSource = read("lib/automation/transportTypes.ts");

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
record("G01 the migration is forensically reconciled APPLIED with exact identity",
  (() => {
    const pin = manifest.appliedPostAnchorMigrations
      .find((r) => r.version === "20260809000000");
    return Boolean(pin) &&
      pin.path === MIGRATION_PATH &&
      pin.sha256 === MIGRATION_SHA &&
      pin.operationalStatus === "APPLIED" &&
      pin.appliedEvidenceType === "IMPORTED_FOUNDER_ACKNOWLEDGED_EXISTING_STAGING_STATE" &&
      pin.remoteHistoryCountAfterApply === 27 &&
      pin.appliedExactlyOnce === true &&
      pin.appliedByThisPhase === false &&
      pin.catalogParityVerified === true &&
      pin.forensicClassification === "APPLIED_RECORDED_CATALOG_MATCHES_CURRENT_SOURCE" &&
      pin.applyExecutorProvenance === "UNKNOWN";
  })());
record("G02 the ten applied post-anchor records read 21 through 30",
  same(manifest.appliedPostAnchorMigrations.map((r) => r.remoteHistoryCountAfterApply),
    [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]));
record("G03 no stale pending status or fabricated executor for this migration",
  (() => {
    const pin = manifest.appliedPostAnchorMigrations.find((r) => r.version === "20260809000000");
    return Boolean(pin) &&
      pin.operationalStatus === "APPLIED" &&
      pin.remoteHistoryCountAfterApply === 27 &&
      pin.applyExecutorProvenance === "UNKNOWN" &&
      !("remoteVersionStatus" in pin) &&
      !manifest.pendingPostAnchorMigrations.some((r) => r.version === "20260809000000");
  })());
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
// QF-MVP-50.5 RE-PIN: 96 -> 97, adding only the 50.5 recovery transport migration.
record("G09 the local migration set is exactly 97",
  readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).length === 97);

// ---------------------------------------------------------------------------
// V. CHECK 9.6 REGRESSION - the vendor AVAILABILITY toggle is not accept/reject
//
// public.vendors.accepting_leads means "this vendor is currently open to new
// leads". It was created by the pre-baseline migration
// 20260706000140_vendor_accepting_leads.sql, is embedded in the staging
// baseline, and is load-bearing in preferred/manual assignment, the credit
// wallet RPC, the canonical assignment authority and the public projection.
// It is NOT per-lead acceptance, rejection, decline, vendor decision state or
// an acceptance workflow.
//
// The guard grammar below is PARSED OUT OF THE MIGRATION rather than restated,
// so these cases can never silently drift from the SQL that actually runs.
// ---------------------------------------------------------------------------
const guardBlock = (() => {
  // Anchored in the RAW source: the 9.6 label lives in a comment, and `sql` is
  // comment-stripped. Bounded to the 9.6 if-block so nothing else leaks in.
  const start = migrationSource.indexOf("9.6 no vendor accept/reject state");
  if (start === -1) return "";
  const end = migrationSource.indexOf("end if;", start);
  return end === -1 ? migrationSource.slice(start) : migrationSource.slice(start, end + "end if;".length);
})();
const guardPatterns = [...guardBlock.matchAll(/column_name ilike '([^']+)'/g)].map((m) => m[1]);
const guardExactNames = (() => {
  const m = guardBlock.match(/column_name in \(([^)]*)\)/);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
})();
const guardExemption = (() => {
  const m = guardBlock.match(/and not \(\s*table_name = '([^']+)'\s*and column_name = '([^']+)'\s*\)/);
  return m ? { table: m[1], column: m[2] } : null;
})();
const BACKSLASH = String.fromCharCode(92);
const escapeLiteral = (x) => x.replace(/[^A-Za-z0-9_]/g, (ch) => BACKSLASH + ch);
const likeToRe = (p) => new RegExp("^" + p.split("%").map(escapeLiteral).join(".*") + "$", "i");
// Faithful mirror of the SQL predicate: pattern/name match AND NOT the exemption.
const guardAborts = (table, column) => {
  const matched = guardPatterns.some((p) => likeToRe(p).test(column)) ||
    guardExactNames.includes(column);
  if (!matched) return false;
  if (guardExemption && table === guardExemption.table && column === guardExemption.column) return false;
  return true;
};

record("V01 the guard grammar was parsed from the migration",
  guardPatterns.length === 4 && guardExactNames.length === 2 && guardExemption !== null);
record("V02 the exemption is exactly public.vendors.accepting_leads",
  guardExemption?.table === "vendors" && guardExemption?.column === "accepting_leads");
record("V03 exactly one exemption exists - no allowlist",
  (guardBlock.match(/and not \(/g) ?? []).length === 1 &&
  !/table_name in \(/.test(guardBlock) &&
  !/column_name not in \(/.test(guardBlock));

// A. the availability toggle must NOT abort
record("V04 (A) vendors.accepting_leads does not abort the migration",
  guardAborts("vendors", "accepting_leads") === false);

// B. every other accept/reject-style lead column must still abort
for (const [tbl, col] of [
  ["vendors", "lead_accepted"],
  ["vendors", "lead_rejected"],
  ["vendors", "lead_accepted_at"],
  ["vendors", "acceptance_rate"],
  ["vendors", "rejection_rate"],
  ["lead_assignments", "accept_lead"],
  ["lead_assignments", "reject_lead"],
  ["lead_assignments", "lead_rejection_reason"],
  ["lead_assignments", "lead_acceptance_status"],
]) {
  record(`V05 (B) ${tbl}.${col} still aborts`, guardAborts(tbl, col) === true);
}

// C. the exemption must be EXACT in both dimensions
record("V06 (C) accepting_leads on any other table still aborts",
  guardAborts("lead_assignments", "accepting_leads") === true &&
  guardAborts("vendor_crm_profiles", "accepting_leads") === true);
record("V07 (C) a decision column on vendors still aborts",
  guardAborts("vendors", "lead_accepted") === true &&
  guardAborts("vendors", "accept_lead_decision") === true);
record("V08 (C) the guard was not removed and still raises",
  /9\.6 no vendor accept\/reject state/.test(migrationSource) &&
  /a vendor accept\/reject column exists/.test(migrationSource) &&
  /errcode = 'P0001'/.test(guardBlock));
record("V09 (C) no broad vendors-wide accept/lead exemption exists",
  !/table_name = 'vendors'\s*\)/.test(guardBlock) &&
  !/column_name ilike '%accept%lead%'\s*\)\s*$/.test(guardBlock) &&
  guardAborts("vendors", "lead_accepted") === true);

// D. availability semantics preserved, no accept/reject surface introduced
record("V10 (D) the migration documents the availability-toggle distinction",
  /VENDOR AVAILABILITY/i.test(migrationSource) &&
  /20260706000140_vendor_accepting_leads\.sql/.test(migrationSource) &&
  /NOT per-lead\s*\n?--?\s*acceptance/i.test(migrationSource.replace(/\r/g, "")));
record("V11 (D) the migration never writes or alters accepting_leads",
  !/alter table[^;]*accepting_leads/i.test(sql) &&
  !/update\s+public\.vendors/i.test(sql) &&
  !/drop column[^;]*accepting_leads/i.test(sql));
record("V12 (D) no accept/reject action, state or endpoint is introduced",
  !/vendor\.(accept|reject)/i.test(sql + registrySource) &&
  !/accept_lead|reject_lead|lead_accepted|lead_rejected/i.test(registrySource) &&
  !/acceptance_workflow|decline/i.test(sql));
record("V13 (D) governance records the availability-toggle distinction",
  manifest.safety?.vendorAcceptRejectPermanentlyAbsent === true &&
  manifest.safety?.vendorAvailabilityToggleIsNotAcceptReject?.column ===
    "public.vendors.accepting_leads" &&
  manifest.safety.vendorAvailabilityToggleIsNotAcceptReject.semantics ===
    "VENDOR_AVAILABILITY_ONLY" &&
  manifest.safety.vendorAvailabilityToggleIsNotAcceptReject
    .guardStillAbortsOnEveryOtherMatch === true);
record("V14 the 090 pin records the correction and the superseded hash",
  (() => {
    const pin = manifest.appliedPostAnchorMigrations.find((r) => r.version === "20260809000000");
    return pin?.sha256 === MIGRATION_SHA &&
      pin.supersededSourceSha256 ===
        "a4b94ac6df39caa71ef9adcb8f40eb19850d425f3724c82fc4a7bc979ed8fb11" &&
      pin.sourceCorrection === "SELF_VERIFICATION_9_6_VENDOR_AVAILABILITY_TOGGLE_EXEMPTION";
  })());

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
// K. SHARED FAMILY-AWARE CLAIM ROUTING (QF-MVP-50.3/50.4)
//
// The claim was FAMILY-BLIND: family was derived only AFTER an irreversible
// claim, so one executor could permanently strand another family's job. These
// assertions freeze the prevention.
// ---------------------------------------------------------------------------
record("K01 the family-aware claim migration exists at its pinned hash",
  existsSync(path.join(ROOT, CLAIM_MIGRATION_PATH)) &&
  canonicalSha256(readFileSync(path.join(ROOT, CLAIM_MIGRATION_PATH))) === CLAIM_MIGRATION_SHA);
record("K02 the historical claim migrations are byte-frozen",
  canonicalSha256(readFileSync(path.join(ROOT,
    "supabase/migrations/20260801152049_qf_mvp_automation_transport_replay_guard.sql")))
    === "28405567e2dd1370db4ccf58526701ca2713adbe19188838f16a510eb8128257" &&
  canonicalSha256(readFileSync(path.join(ROOT,
    "supabase/migrations/20260808000000_qf_mvp_50_2_fresh_claim_retry_wedge_repair.sql")))
    === "8b798bb3c5db5d91f988d92cec3705237db08c753ae5018d09dccc09ff0240aa");
record("K03 the LEGACY claim keeps its exact signature and is now client-fenced",
  /create or replace function public\.qf_claim_automation_job_v1\(p_worker_id text\)/.test(claimSql) &&
  /qf_automation_action_workflow_family_v1\(r\.action_type\)\s*\n?\s*= 'client_whatsapp'/.test(claimSql));
record("K04 the legacy claim still has the frozen fresh-pending semantics",
  /j\.status = 'pending'/.test(claimSql) &&
  /j\.available_at <= now\(\)/.test(claimSql) &&
  /j\.attempt_count < j\.max_attempts/.test(claimSql) &&
  /for update skip locked/.test(claimSql));
record("K05 retry_scheduled remains excluded from every claim selector",
  !/j\.status = 'retry_scheduled'/.test(claimSql) &&
  !/j\.next_retry_at <= now\(\)/.test(claimSql));
/** The family-aware claim function body only — not the trailing self-verification
 *  block, which legitimately probes wildcard / multi-family / null inputs in
 *  order to prove they are refused. */
const familyClaimFn = (() => {
  const i = claimSql.indexOf("create or replace function public.qf_claim_automation_job_for_family_v1");
  const j = claimSql.indexOf("comment on function", i);
  return i === -1 ? "" : claimSql.slice(i, j === -1 ? claimSql.length : j);
})();
record("K06 the family-aware claim takes EXACTLY ONE family",
  /p_worker_id text,\s*\n?\s*p_workflow_family text/.test(familyClaimFn) &&
  // one scalar family: no array type, no plural parameter
  !/text\[\]/.test(familyClaimFn) &&
  !/p_workflow_families/.test(claimSql));
record("K07 the family vocabulary is closed and fails closed",
  /p_workflow_family not in\s*\n?\s*\('client_whatsapp', 'vendor_whatsapp', 'campaign_execution'\)/.test(familyClaimFn) &&
  /AUTOMATION_CLAIM_WORKFLOW_FAMILY_INVALID/.test(familyClaimFn) &&
  // no wildcard / any escape hatch inside the executable selector
  !/'all'|'\*'|'any'/i.test(familyClaimFn));
record("K08 no caller-supplied action allowlist is accepted anywhere",
  !/p_action_types|p_action_allowlist|actionTypes\s*:/i.test(claimSql + claimRouteSource + transportServiceSource));
record("K09 the family comes from durable action truth, not the caller",
  /from public\.automation_action_requests r\s*\n?\s*where r\.id = j\.action_request_id/.test(claimSql) &&
  /qf_automation_action_workflow_family_v1\(r\.action_type\)/.test(claimSql));
record("K10 the SQL action->family map matches the frozen registry exactly",
  (() => {
    const pairs = [...claimSql.matchAll(/when '([a-z_]+\.[a-z_]+)'\s*then '([a-z_]+)'/g)]
      .map((m) => [m[1], m[2]]);
    if (pairs.length !== 14) return false;
    if (new Set(pairs.map((p) => p[0])).size !== 14) return false;
    return pairs.every(([action, family]) =>
      AUTOMATION_ACTION_TYPES.includes(action) &&
      getWorkflowFamilyForAction(action) === family);
  })());
record("K11 an unknown action maps to NULL and never defaults to a family",
  /else null/.test(claimSql) &&
  /an unknown action must map to NULL/.test(claimMigrationSource));
record("K12 the transport wrapper keeps route identity claim_v1 — no claim_v2",
  /route_key <> 'claim_v1'/.test(claimSql) &&
  !/claim_v2/.test(claimSql + claimRouteSource + transportServiceSource));
record("K13 family is bound into the signed identity via the canonical body hash",
  /body_sha256 is distinct from p_body_sha256/.test(claimSql) &&
  /workflowFamily/.test(transportTypesSource) &&
  /body_sha256 carries the declared family/.test(claimMigrationSource));
record("K14 a same-requestId changed-family call conflicts",
  /AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT/.test(claimSql) &&
  /cannot inherit this identity/.test(claimMigrationSource));
record("K15 the one-claim-per-job uniqueness is UNCHANGED",
  !/drop index[^;]*uq_automation_transport_requests_claim_job/i.test(claimSql) &&
  /claim uniqueness must not be weakened/.test(claimMigrationSource));
record("K16 NO release / unclaim / recovery semantics were added",
  !/processing'\s*->\s*'pending|set status = 'pending'/.test(claimSql) &&
  !/\bdelete from\b|due_sweep|reclaimStale|retry_worker|unclaim|release_claim/i.test(
    claimSql.replace(/a claim release path was introduced/g, " ")
            .replace(/recovery semantics must remain QF-MVP-50\.5/g, " ")
            .replace(/v_def ~ 'delete from'/g, " ")
            .replace(/v_def ~ 'due_sweep'/g, " ")));
record("K17 the claim route accepts EXACTLY the legacy and family shapes",
  /keys\.length === 3/.test(claimRouteSource) &&
  /keys\.length === 4/.test(claimRouteSource) &&
  /keys\[3\] === "workflowFamily"/.test(claimRouteSource) &&
  /AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID/.test(claimRouteSource));
record("K18 the route dispatches legacy -> client-only, family -> family-aware",
  /"workflowFamily" in parsed\.body/.test(claimRouteSource) &&
  /claimAutomationJobForFamilyN8nTransport/.test(claimRouteSource) &&
  /claimAutomationJobForN8nTransport/.test(claimRouteSource));
record("K19 the route validates the family against the closed vocabulary",
  /isClaimableWorkflowFamily\(value\.workflowFamily\)/.test(claimRouteSource) &&
  /AUTOMATION_CLAIM_WORKFLOW_FAMILY_INVALID/.test(claimRouteSource));
record("K20 both claim paths share one row-interpretation, so they cannot drift",
  /function interpretClaimRow/.test(transportServiceSource) &&
  (transportServiceSource.match(/interpretClaimRow\(/g) ?? []).length >= 3);
record("K21 the client workflow JSON is byte-unchanged",
  canonicalSha256(readFileSync(path.join(ROOT,
    "automation/n8n/QF-MVP-50-02-Client-Whatsapp-Executor.50.2E-selfhost-env.workflow.json")))
    === "79716cd979aedaaa06aced84d843cad3ca15b47580bbbed8f85175b8c916dad4");
record("K22 the claim migration is forensically reconciled APPLIED with exact identity",
  (() => {
    const pin = manifest.appliedPostAnchorMigrations
      .find((r) => r.version === "20260811000000");
    return Boolean(pin) &&
      pin.path === CLAIM_MIGRATION_PATH &&
      pin.sha256 === CLAIM_MIGRATION_SHA &&
      pin.operationalStatus === "APPLIED" &&
      pin.remoteHistoryCountAfterApply === 29 &&
      pin.appliedExactlyOnce === true &&
      pin.appliedByThisPhase === false &&
      pin.catalogParityVerified === true &&
      pin.applyExecutorProvenance === "UNKNOWN";
  })());

const claimMutants = [
  ["removing the family predicate is impossible",
    () => /qf_automation_action_workflow_family_v1\(r\.action_type\)/.test(claimSql) &&
          (claimSql.match(/qf_automation_action_workflow_family_v1\(r\.action_type\)/g) ?? []).length >= 2],
  ["making the legacy claim all-family again is impossible",
    () => /= 'client_whatsapp'/.test(claimSql) &&
          /the legacy claim is not client-fenced/.test(claimMigrationSource)],
  ["accepting a family array is impossible",
    () => !/text\[\]/.test(familyClaimFn) && !/p_workflow_families/.test(claimSql)],
  ["accepting a wildcard family is impossible",
    () => /p_workflow_family not in/.test(claimSql) &&
          /a wildcard family was accepted/.test(claimMigrationSource)],
  ["accepting a caller action allowlist is impossible",
    () => !/p_action_types|p_action_allowlist/i.test(claimSql + claimRouteSource)],
  ["omitting family from the body hash is impossible",
    () => /keys\[3\] === "workflowFamily"/.test(claimRouteSource) &&
          /body_sha256 is distinct from p_body_sha256/.test(claimSql)],
  ["mapping an action to the wrong family is impossible",
    () => {
      const pairs = [...claimSql.matchAll(/when '([a-z_]+\.[a-z_]+)'\s*then '([a-z_]+)'/g)];
      return pairs.length === 14 &&
        pairs.every((m) => getWorkflowFamilyForAction(m[1]) === m[2]);
    }],
  ["an unknown action falling back to a family is impossible",
    () => /else null/.test(claimSql)],
  ["reintroducing retry_scheduled to a claim selector is impossible",
    () => !/j\.status = 'retry_scheduled'/.test(claimSql)],
  ["weakening one-claim-per-job uniqueness is impossible",
    () => !/drop index[^;]*claim_job/i.test(claimSql)],
  ["adding a release or recovery path is impossible",
    () => !/set status = 'pending'/.test(claimSql) &&
          !/unclaim|release_claim/i.test(claimSql)],
  ["changing the client workflow JSON is impossible",
    () => canonicalSha256(readFileSync(path.join(ROOT,
            "automation/n8n/QF-MVP-50-02-Client-Whatsapp-Executor.50.2E-selfhost-env.workflow.json")))
            === "79716cd979aedaaa06aced84d843cad3ca15b47580bbbed8f85175b8c916dad4"],
];
for (const [name, fn] of claimMutants) {
  let held = false;
  try { held = fn() === true; } catch { held = false; }
  record(`MK-${name}`, held);
}


// ---------------------------------------------------------------------------
// V. VENDOR EXECUTOR — route, service, reproofs, workflow
// ---------------------------------------------------------------------------
const vendorRoute = read("app/api/internal/automation/n8n/execute-vendor/route.ts");
const vendorService = read("services/automationVendorExecutionService.ts");
const familyContract = read("lib/automation/familyExecutionContract.ts");
const vendorWorkflowSource = read("automation/n8n/QF-MVP-50-03-Vendor-Whatsapp-Executor.workflow.json");
const vendorWorkflow = JSON.parse(vendorWorkflowSource);
const vendorWorkflowText = JSON.stringify(vendorWorkflow);

record("V01 the vendor execute route exists at its exact path",
  /N8N_EXECUTE_VENDOR_ROUTE_PATH/.test(vendorRoute) &&
  /"\/api\/internal\/automation\/n8n\/execute-vendor"/.test(read("lib/automation/transportTypes.ts")));
record("V02 it reuses the frozen signed transport verification",
  /verifyN8nToCoreRequest/.test(vendorRoute) &&
  /buildSignedCoreResponseHeaders/.test(vendorRoute) &&
  /path: N8N_EXECUTE_VENDOR_ROUTE_PATH/.test(vendorRoute));
record("V03 it reuses execute_v1 — there is no execute_v2",
  /route: "execute_v1"/.test(vendorRoute) &&
  !/execute_v2/.test(vendorRoute + vendorService + familyContract));
record("V04 the request body is EXACTLY the five identity keys",
  (() => {
    const m = familyContract.match(/N8N_FAMILY_EXECUTE_REQUEST_KEYS = Object\.freeze\(\[([\s\S]*?)\]/);
    if (!m) return false;
    const keys = [...m[1].matchAll(/"([a-zA-Z]+)"/g)].map((x) => x[1]);
    return same(keys, ["attemptId", "jobId", "requestId", "transportVersion", "workerId"]);
  })() &&
  /keys\.length !== N8N_FAMILY_EXECUTE_REQUEST_KEYS\.length/.test(familyContract));
record("V05 no business field is accepted in the execute request",
  !/recipient|phone|template|provider|consent|workflowFamily/i.test(
    familyContract.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")));
record("V06 the route rejects a requestId or worker mismatch",
  /AUTOMATION_TRANSPORT_REQUEST_ID_MISMATCH/.test(vendorRoute) &&
  /AUTOMATION_TRANSPORT_WORKER_NOT_AUTHORIZED/.test(vendorRoute));
record("V07 the service fences the family to vendor_whatsapp",
  /VENDOR_EXECUTION_WORKFLOW_FAMILY = "vendor_whatsapp"/.test(vendorService) &&
  /envelope\.workflowFamily !== VENDOR_EXECUTION_WORKFLOW_FAMILY/.test(vendorService) &&
  /AUTOMATION_EXECUTION_WORKFLOW_FAMILY_MISMATCH/.test(vendorService));
record("V08 a foreign-family job is refused WITHOUT being finalized",
  /leaves the attempt owned and open for its real executor/.test(vendorService));
record("V09 ownership and current-attempt proof come first",
  vendorService.indexOf("proveCurrentAutomationAttemptOwnership") <
    vendorService.indexOf("recordClientExecutionTransportIdentity"));
record("V10 durable communication evidence is read BEFORE reserving",
  // compare CALL sites; the import line naturally appears first
  vendorService.indexOf("readCommunicationEvidence(idempotencyKey)") <
    vendorService.indexOf("await recordClientExecutionTransportIdentity("));
record("V11 the execute_v1 reservation is the frozen shared one",
  /recordClientExecutionTransportIdentity/.test(vendorService) &&
  /AUTOMATION_EXECUTION_RESERVATION_REFUSED/.test(vendorService));
record("V12 lead_offer reproof re-reads the assignment and its vendor",
  /case "vendor\.lead_offer":[\s\S]{0,700}?from\("lead_assignments"\)[\s\S]{0,400}?row\.vendor_id !== facts\.vendorId/.test(vendorService));
record("V13 response_reminder requires vendor_status still exactly 'New'",
  /case "vendor\.response_reminder":[\s\S]{0,1200}?row\.vendor_status !== "New"/.test(vendorService) &&
  /resp2h/.test(vendorService) && /resp24h/.test(vendorService));
record("V14 onboarding reproof requires onboarding_stage still 'new'",
  /case "vendor\.onboarding_reminder":[\s\S]{0,700}?row\.onboarding_stage !== "new"/.test(vendorService));
record("V15 package reproof requires the exact source expiry identity",
  /case "vendor\.package_expiry_warning":[\s\S]{0,1600}?formatExpiryStamp\(row\.package_expires_at\) !== stamp/.test(vendorService) &&
  /row\.package_status !== "active"/.test(vendorService));
record("V16 low-credit reproof reads the policy config, never a literal",
  /VENDOR_LOW_CREDIT_THRESHOLD_POLICY_KEY/.test(vendorService) &&
  /readLowCreditThreshold/.test(vendorService) &&
  /row\.remaining_credits > threshold/.test(vendorService) &&
  // no hard-coded numeric threshold anywhere in the executor
  !/remaining_credits\s*(<=|<|>=|>)\s*\d/.test(vendorService) &&
  !/thresholdCredits\s*[:=]\s*\d/.test(vendorService));
record("V17 an unconfigured threshold is a terminal non-send, not an assumed 3",
  /threshold === null[\s\S]{0,160}?QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE/.test(vendorService) &&
  /never an assumed 3/.test(vendorService));
record("V18 every stale reproof is a pre-communication no-send",
  (vendorService.match(/QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE/g) ?? []).length >= 8 &&
  /PRE-COMMUNICATION no-send/.test(vendorService));
record("V19 vendor.document_reminder can never be executed",
  /getNonProducibleVendorReason\(envelope\.actionType\)/.test(vendorService) &&
  /AUTOMATION_EXECUTION_VENDOR_ACTION_NOT_PRODUCIBLE/.test(vendorService));
record("V20 Core owns recipient, consent, template and provider",
  /resolveVendorFacts/.test(vendorService) &&
  /RECIPIENT_REFERENCE_DESTINATION/.test(vendorService) &&
  /createRuntimeCommunicationService/.test(vendorService) &&
  /recipient_type: "vendor"/.test(vendorService));
record("V21 an assignment-scoped action resolves its vendor THROUGH the assignment",
  /entityType === "lead_assignment"[\s\S]{0,500}?vendorId = row\.vendor_id/.test(vendorService));
record("V22 the frozen four-state result partition is preserved",
  /orchestrationState: "execution_recorded"/.test(vendorService) &&
  /orchestrationState: "communication_pending"/.test(vendorService) &&
  /orchestrationState: "attempt_finalized"/.test(vendorService) &&
  /orchestrationState: "rejected"/.test(vendorRoute));
record("V23 executorReference is emitted only for execution_recorded",
  /orchestrationState: "execution_recorded",\s*\n\s*replayed,\s*\n\s*executorReference: evidence\.id/.test(vendorService) &&
  !/communication_pending",[\s\S]{0,120}?executorReference/.test(vendorService));
record("V24 the vendor workflow ships INACTIVE",
  vendorWorkflow.active === false);
record("V25 the vendor workflow claims exactly one family: vendor_whatsapp",
  /workflowFamily = 'vendor_whatsapp'/.test(vendorWorkflowText) &&
  /workflowFamily === 'vendor_whatsapp'/.test(vendorWorkflowText) &&
  !/'campaign_execution'|'client_whatsapp'/.test(vendorWorkflowText));
record("V26 its execute body carries exactly the five keys",
  /transportVersion: 1, requestId, workerId, jobId, attemptId/.test(vendorWorkflowText));
record("V27 it posts to the vendor execute route",
  vendorWorkflowText.includes("/api/internal/automation/n8n/execute-vendor") &&
  !vendorWorkflowText.includes("/api/internal/automation/n8n/execute-client"));
record("V28 it completes only when Core says completionReady",
  /completionReady: state === 'execution_recorded'/.test(vendorWorkflowText) &&
  /IF — Completion Ready/.test(vendorWorkflowText));
record("V29 it has no provider node and writes no business row",
  !/whatsAppApi|metaApi|httpRequest.*graph\.facebook|supabase/i.test(vendorWorkflowText));
record("V30 the vendor workflow contains no accept/reject semantics",
  // `rejected` is the FROZEN orchestration state and `Reject Unverified ...` is
  // the frozen signature-refusal node family. Neither is a vendor decision, so
  // this checks the identifier-level phrases that WOULD be one.
  (() => {
    const text = vendorWorkflowText.toLowerCase();
    return !ACCEPT_REJECT_PHRASES.some((p) => text.includes(p)) &&
      !/accept[ _-]?(this )?lead|decline[ _-]?(this )?lead|respond yes/i.test(vendorWorkflowText);
  })());
record("V31 the graph is structurally the proven client executor",
  vendorWorkflow.nodes.length === 52 &&
  Object.keys(vendorWorkflow.connections).length === 44);

const vendorExecMutants = [
  ["removing the vendor family check is impossible",
    () => /envelope\.workflowFamily !== VENDOR_EXECUTION_WORKFLOW_FAMILY/.test(vendorService)],
  ["executing a client or campaign job on the vendor route is impossible",
    () => /AUTOMATION_EXECUTION_WORKFLOW_FAMILY_MISMATCH/.test(vendorService)],
  ["hard-coding the low-credit threshold in the executor is impossible",
    () => !/remaining_credits\s*(<=|<|>=|>)\s*\d/.test(vendorService) &&
          /readLowCreditThreshold/.test(vendorService)],
  ["sending after a package renewal is impossible",
    () => /formatExpiryStamp\(row\.package_expires_at\) !== stamp/.test(vendorService)],
  ["reminding when vendor_status is not New is impossible",
    () => /row\.vendor_status !== "New"/.test(vendorService)],
  ["reminding after onboarding progressed is impossible",
    () => /row\.onboarding_stage !== "new"/.test(vendorService)],
  ["executing vendor.document_reminder is impossible",
    () => /AUTOMATION_EXECUTION_VENDOR_ACTION_NOT_PRODUCIBLE/.test(vendorService)],
  ["a vendor accept/reject concept in the executor is impossible",
    () => !/acceptlead|rejectlead|vendor_accept|vendor_reject|acceptance_rate|rejection_rate/i
            .test(vendorService.toLowerCase())],
  ["n8n supplying phone, template or provider is impossible",
    () => !/recipient|phone|template|provider/i.test(
      familyContract.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " "))],
  ["completing on communication_pending is impossible",
    () => /completionReady: state === 'execution_recorded'/.test(vendorWorkflowText)],
  ["shipping the vendor workflow active is impossible",
    () => vendorWorkflow.active === false],
];
for (const [name, fn] of vendorExecMutants) {
  let held = false;
  try { held = fn() === true; } catch { held = false; }
  record(`MV-${name}`, held);
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
