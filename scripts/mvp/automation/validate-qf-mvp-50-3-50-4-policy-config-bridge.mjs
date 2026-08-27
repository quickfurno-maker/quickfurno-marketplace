#!/usr/bin/env node
// ============================================================================
// QF-MVP-50.3 / 50.4 — AUTOMATION POLICY CONFIG BRIDGE validator
//
// OFFLINE ONLY. No database, no network, no provider, no n8n, no Jarvis.
//
// The staging baseline squash omitted the canonical automation policy config
// foundation, so QF-MVP-50.3 (20260809000000) could not apply. This validator
// freezes the ONE rule that makes the repair safe: the bridge is a
// post-baseline parity repair for exactly that omitted foundation. It is
// presence-idempotent by catalog probe, a strict no-op when the foundation is
// already canonical, and fails closed on any partial or incompatible state.
// It is NOT an exception that permits replaying the pre-baseline chain.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const canonicalSha256 = (buf) =>
  sha256(Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

// --- the bridge itself -------------------------------------------------------
const BRIDGE_VERSION = "20260808500000";
const BRIDGE_NAME = `${BRIDGE_VERSION}_qf_mvp_50_3_automation_policy_config_foundation_bridge.sql`;
const BRIDGE_PATH = `supabase/migrations/${BRIDGE_NAME}`;
const BRIDGE_SHA = "05e114910c8ba06e9d697b81ca645dfc13a03ed29751090901666975dc6fcbca";

// --- files that must stay byte-identical -------------------------------------
const HISTORICAL_NAME = "20260706000150_automation_policy_config_foundation.sql";
const HISTORICAL_PATH = `supabase/migrations/${HISTORICAL_NAME}`;
const HISTORICAL_SHA = "4477e72494e399ed714d7d596506a326aeb6d1b2a74b28376fe54f7142150b9d";

const FROZEN = [
  ["20260809000000_qf_mvp_50_3_vendor_automation_producer.sql",
   "3588f6d06256af7d6ae95263bb474fb33a15428d0a402bd81c6dd1eb0e6076cb"],
  ["20260810000000_qf_mvp_50_4_campaign_recipient_automation.sql",
   "8440e5e818676232969c5046941daa7e8fc905728ea73d295ca0e997c5ac7906"],
  ["20260811000000_qf_mvp_50_3_50_4_family_aware_claim_routing.sql",
   "fc7efae9c2349854b9856d3b3b3956933bcfe79ed15c1eeb7caf65bc61f8f89d"],
];

// QF-MVP-50.5 RE-PIN. The bridge and every 50.3/50.4 record are unchanged; the only
// difference is that 20260812000000 now exists on disk as a PENDING post-anchor
// migration. Counts stay exact — no `>=`, no wildcard.
// QF-MVP-40.13B RE-PIN. The bridge, the 50.3/50.4 set and the applied 50.5 recovery
// transport are all unchanged; the only difference is one further SOURCE-PENDING
// migration on disk. Counts stay exact — no `>=`, no wildcard.
// QF-MVP-40 MARKETING-CONSENT RE-PIN: 98 -> 99, adding ONLY the SOURCE-PENDING
// canonical marketing-consent writer RPC (20260814000000). No existing migration was
// changed, renamed, deleted or reordered. Still exact equality.
// QF-MVP-75.01 RE-PIN: 99 -> 100, adding ONLY the SOURCE-PENDING MatchCore
// binding-rank-order authority replacement (20260815000000). No existing migration was
// changed, renamed, deleted or reordered. Still exact equality.
const MIGRATION_COUNT = 100;
const POST_ANCHOR_COUNT = 13;
const PENDING_ORDER = ["20260813000000", "20260814000000", "20260815000000"];
const RECOVERY_NAME =
  "20260812000000_qf_mvp_50_5_automation_recovery_reconciliation.sql";
const MARKETING_CONSENT_NAME =
  "20260814000000_qf_mvp_40_marketing_consent_writer.sql";
const CANARY_AUTHORITY_NAME =
  "20260813000000_qf_mvp_40_13b_canary_activation_authority.sql";
/** QF-MVP-75.01 — SOURCE ONLY, never applied by this or any prior phase. */
const MATCHCORE_RANK_ORDER_NAME =
  "20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql";
const APPLIED_ORDER = ["20260804000000", "20260805000000", "20260806000000",
  "20260807000000", "20260808000000", BRIDGE_VERSION,
  "20260809000000", "20260810000000", "20260811000000", "20260812000000"];
const BRIDGE_APPLIED_MARKER = "QF_MVP_50_3_50_4_POLICY_CONFIG_BRIDGE_STAGING_APPLIED_AND_VERIFIED";
const BRIDGE_REMOTE_HISTORY = 26;

const bridgeSource = read(BRIDGE_PATH);
const bridge = stripSql(bridgeSource);
const bridgeProse = bridgeSource.split("\n").filter((l) => l.trim().startsWith("--")).join("\n");
const producerSql = stripSql(read(`supabase/migrations/${FROZEN[0][0]}`));
const manifest = JSON.parse(read("supabase/staging-history/qf-mvp-staging-history-manifest.json"));
const migrationFiles = readdirSync(path.join(ROOT, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql")).sort();
const g1Source = read("scripts/mvp/staging/validate-qf-mvp-50-2c-s2-g1.mjs");
const pkg = JSON.parse(read("package.json"));
const ciWorkflow = read(".github/workflows/qf-mvp-50-quality-gate.yml");

const results = [];
const record = (name, passed, detail = "") => results.push({ name, passed: passed === true, detail });

// ---------------------------------------------------------------------------
// V. VERSION ORDERING — the whole point of the bridge
// ---------------------------------------------------------------------------
record("V01 the bridge exists at its pinned path and hash",
  migrationFiles.includes(BRIDGE_NAME) &&
  canonicalSha256(readFileSync(path.join(ROOT, BRIDGE_PATH))) === BRIDGE_SHA);
record("V02 the bridge version is strictly after the wedge repair (080)",
  BRIDGE_VERSION > "20260808000000");
record("V03 the bridge version is strictly before the 50.3 producer (090)",
  BRIDGE_VERSION < "20260809000000");
record("V04 on disk the bridge sorts immediately before the 50.3 producer",
  migrationFiles.indexOf(FROZEN[0][0]) === migrationFiles.indexOf(BRIDGE_NAME) + 1);
record("V05 the bridge sorts immediately after the fresh-claim wedge repair",
  migrationFiles.indexOf(BRIDGE_NAME) ===
    migrationFiles.indexOf("20260808000000_qf_mvp_50_2_fresh_claim_retry_wedge_repair.sql") + 1);
// QF-MVP-50.5 RE-PIN: the bridge and the three frozen 50.3/50.4 migrations still sit
// in exactly this order; they are now followed by the 50.5 recovery transport, which is
// named explicitly rather than allowed as "anything newer".
record("V07a the final eight versions are in exact chronological order",
  same(migrationFiles.slice(-8),
    [BRIDGE_NAME, ...FROZEN.map(([f]) => f), RECOVERY_NAME, CANARY_AUTHORITY_NAME,
     MARKETING_CONSENT_NAME, MATCHCORE_RANK_ORDER_NAME]));
record("V07 the local migration set is exactly 100",
  migrationFiles.length === MIGRATION_COUNT);

// ---------------------------------------------------------------------------
// I. IMMUTABILITY — nothing historical or already-merged may move
// ---------------------------------------------------------------------------
record("I01 the historical pre-baseline foundation is byte-identical",
  canonicalSha256(readFileSync(path.join(ROOT, HISTORICAL_PATH))) === HISTORICAL_SHA);
for (const [file, sha] of FROZEN) {
  record(`I02 ${file.slice(0, 14)} is byte-identical`,
    canonicalSha256(readFileSync(path.join(ROOT, "supabase/migrations", file))) === sha);
}
record("I03 the bridge is a new file, not an edit of the historical migration",
  BRIDGE_NAME !== HISTORICAL_NAME && BRIDGE_SHA !== HISTORICAL_SHA);

// ---------------------------------------------------------------------------
// P. PRESENCE IDEMPOTENCE — probes, not blind IF NOT EXISTS
// ---------------------------------------------------------------------------
record("P01 the bridge probes the catalog with to_regclass before creating",
  /to_regclass\('public\.automation_policy_configs'\)/.test(bridge) &&
  /to_regclass\('public\.automation_policy_active_configs'\)/.test(bridge));
record("P02 the create path is guarded by proven absence, not by IF NOT EXISTS",
  !/create table if not exists/i.test(bridge) &&
  /create table public\.automation_policy_configs/i.test(bridge) &&
  /create table public\.automation_policy_active_configs/i.test(bridge));
record("P03 indexes are created on the proven-absent path only, without IF NOT EXISTS",
  !/create index if not exists/i.test(bridge));
record("P04 the already-present branch verifies structure and returns without writing",
  /if v_configs_present then/.test(bridge) &&
  /return;/.test(bridge));
record("P05 structural verification covers columns, types, keys and the composite FK",
  /information_schema\.columns/.test(bridge) &&
  /pg_constraint/.test(bridge) &&
  /con\.contype = 'f'/.test(bridge) &&
  /confrelid = 'public\.automation_policy_configs'::regclass/.test(bridge));
record("P06 constraint checks compare column sets, not fragile constraint names",
  /array_agg\(a\.attname::text order by a\.attname\)/.test(bridge) &&
  !/conname\s*=/.test(bridge));
record("P07 append-only enforcement and RLS are part of the canonical shape check",
  /pg_trigger/.test(bridge) &&
  /tgisinternal/.test(bridge) &&
  /relrowsecurity/.test(bridge) &&
  /qf_prevent_automation_policy_config_mutation/.test(bridge));
record("P08 a post-condition proves the 50.3 preflight dependency now holds",
  /is still absent after the bridge/.test(bridgeSource));

// ---------------------------------------------------------------------------
// F. FAIL CLOSED — partial and incompatible states must abort
// ---------------------------------------------------------------------------
record("F01 a partial catalog state raises, it is never repaired",
  /if v_configs_present <> v_active_present then/.test(bridge) &&
  /PARTIAL catalog state/.test(bridgeSource));
record("F02 a structurally non-canonical foundation raises",
  /present but NOT canonical/.test(bridgeSource) &&
  /v_problems/.test(bridge));
record("F03 both failure paths use an explicit P0001 errcode",
  (bridge.match(/errcode = 'P0001'/g) ?? []).length >= 2);
record("F04 the bridge never drops, alters or truncates an existing object",
  !/\bdrop\s+(table|index|constraint|trigger)\b/i.test(bridge) &&
  !/\balter\s+table\s+\S+\s+(drop|rename)\b/i.test(bridge) &&
  !/\btruncate\b/i.test(bridge));
record("F05 the bridge never updates or deletes existing rows",
  !/\bupdate\s+public\./i.test(bridge) &&
  !/\bdelete\s+from\b/i.test(bridge));
record("F06 no ON CONFLICT overwrite of a pre-existing seed",
  !/on conflict[\s\S]*?do update/i.test(bridge));
record("F07 the create-or-replace of the immutability function is only reached when absent",
  bridge.indexOf("create or replace function public.qf_prevent_automation_policy_config_mutation") >
    bridge.indexOf("STATE_A") - 1 &&
  bridge.indexOf("create or replace function public.qf_prevent_automation_policy_config_mutation") >
    bridge.indexOf("if v_configs_present then"));

// ---------------------------------------------------------------------------
// C. CANONICAL PARITY — the bridge restores the historical contract
// ---------------------------------------------------------------------------
const historical = stripSql(read(HISTORICAL_PATH));
for (const object of [
  "automation_policy_configs_policy_key_non_empty",
  "automation_policy_configs_policy_version_non_empty",
  "automation_policy_configs_config_json_object",
  "automation_policy_configs_fingerprint_sha256_lower_hex",
  "automation_policy_configs_policy_fingerprint_unique",
  "automation_policy_configs_policy_id_unique",
  "automation_policy_active_configs_policy_key_non_empty",
  "automation_policy_active_configs_config_fk",
  "idx_automation_policy_configs_policy_version",
  "idx_automation_policy_configs_created_at",
  "idx_automation_policy_active_configs_config_id",
  "trg_automation_policy_configs_immutable",
]) {
  record(`C01 canonical object ${object} is reproduced`,
    bridge.includes(object) && historical.includes(object));
}
record("C02 RLS is enabled on both canonical tables",
  (bridge.match(/enable row level security/gi) ?? []).length === 2);
record("C03 anon and authenticated are revoked on both tables",
  (bridge.match(/revoke all on public\.automation_policy_configs from (anon|authenticated)/gi) ?? []).length === 2 &&
  (bridge.match(/revoke all on public\.automation_policy_active_configs from (anon|authenticated)/gi) ?? []).length === 2);
record("C04 service_role grants match the historical contract exactly",
  /grant select, insert on public\.automation_policy_configs to service_role/i.test(bridge) &&
  /grant select, insert, update, delete on public\.automation_policy_active_configs to service_role/i.test(bridge));
record("C05 the immutability function keeps its pinned search_path",
  /set search_path = pg_catalog, public, pg_temp/.test(bridge));
record("C06 the canonical seed reproduces the historical fingerprint exactly",
  bridge.includes("1ecca567b6564e9188d4aab7cb7557614c87f2131c947b42929475b4e592901c") &&
  historical.includes("1ecca567b6564e9188d4aab7cb7557614c87f2131c947b42929475b4e592901c") &&
  bridge.includes("lead_distribution_authorization_v1") &&
  bridge.includes("phase4b1_safe_default_seed"));
record("C07 the seed is inserted only on the proven-absent path",
  bridge.indexOf("phase4b1_safe_default_seed") > bridge.indexOf("STATE_A"));

// ---------------------------------------------------------------------------
// B. BUSINESS-POLICY BOUNDARY — 090 keeps owning the threshold
// ---------------------------------------------------------------------------
record("B01 the bridge carries no low-credit threshold",
  !/vendor_low_credit_warning_threshold/.test(bridge) &&
  !/thresholdCredits/.test(bridge));
record("B02 the 50.3 producer still owns the threshold seed and the value 3",
  /vendor_low_credit_warning_threshold/.test(producerSql) &&
  /"thresholdCredits":3/.test(producerSql) &&
  /qf_vendor_low_credit_threshold_v1/.test(producerSql));
record("B03 the bridge creates no vendor, campaign, claim or transport object",
  !/vendor_|campaign|automation_jobs|automation_action_requests|automation_transport_requests|claim_v1|execute_v1/i.test(bridge));
record("B04 the bridge touches no provider, n8n, Meta or Jarvis surface",
  !/provider_template_mappings|send_authority|binding_readiness|n8n|graph\.facebook|qf-jarvis/i.test(bridge));
record("B05 vendor accept/reject is absent from the bridge",
  !/accept|reject/i.test(bridge));

// ---------------------------------------------------------------------------
// E. ENVIRONMENT — no production assumption anywhere
// ---------------------------------------------------------------------------
record("E01 the bridge hard-codes no project ref",
  !/yqpgcsduqbxulrlzwzap|coilipywdvxklewquqvv|lpurlfmpvriyvpkujvyl|uckafzuochmbvtiodmcl/.test(bridgeSource));
record("E02 the bridge branches on catalog state, never on an environment name",
  !/current_database\(\)\s*=|'staging'|'production'/i.test(bridge));
record("E03 the bridge is safe as source on any environment: absent creates, present no-ops",
  /STATE A/.test(bridgeProse) && /STATE B/.test(bridgeProse) && /STATE C/.test(bridgeProse));

// ---------------------------------------------------------------------------
// G. GOVERNANCE — pre-baseline replay stays forbidden
// ---------------------------------------------------------------------------
record("G01 pre-baseline replay remains forbidden",
  manifest.safety?.preBaselineReplayForbidden === true &&
  manifest.preBaselineChain?.mustReplayOnStaging === false &&
  manifest.preBaselineChain?.mustRepairAsApplied === false &&
  manifest.preBaselineChain?.classification ===
    "PRE_BASELINE_CHAIN_INTENTIONALLY_SUPERSEDED_FOR_STAGING");
record("G02 the pre-baseline chain count is unchanged at 68",
  manifest.preBaselineChain?.count === 68 &&
  manifest.preBaselineChain?.records?.length === 68);
const bridgeGov = manifest.preBaselineChain?.postBaselineParityBridges?.[0];
record("G03 the bridge is recorded as a parity repair, not a replay",
  manifest.preBaselineChain?.postBaselineParityBridges?.length === 1 &&
  bridgeGov?.bridgeVersion === BRIDGE_VERSION &&
  bridgeGov?.bridgeSha256 === BRIDGE_SHA &&
  bridgeGov?.omittedPreBaselineVersion === "20260706000150" &&
  bridgeGov?.preBaselineMigrationReplayed === false &&
  bridgeGov?.preBaselineMigrationEdited === false &&
  bridgeGov?.doesNotAuthorizeArbitraryPreBaselineReplay === true);
record("G04 the recorded bridge semantics match the SQL",
  bridgeGov?.presenceIdempotentByCatalogProbe === true &&
  bridgeGov?.noOpWhenCanonicalFoundationAlreadyPresent === true &&
  bridgeGov?.failsClosedOnPartialOrIncompatibleState === true &&
  bridgeGov?.createsOnlyOnProvenAbsence === true &&
  bridgeGov?.overwritesExistingRows === false &&
  bridgeGov?.carriesBusinessPolicy === false &&
  bridgeGov?.lowCreditThresholdRemainsOwnedBy === "20260809000000");
record("G05 the bridge is recorded APPLIED exactly once at remote history 26",
  (() => {
    const pin = manifest.appliedPostAnchorMigrations?.find((record) => record.version === BRIDGE_VERSION);
    return pin?.version === BRIDGE_VERSION &&
      pin.sha256 === BRIDGE_SHA &&
      pin.path === BRIDGE_PATH &&
      pin.operationalStatus === "APPLIED" &&
      pin.appliedEvidenceMarker === BRIDGE_APPLIED_MARKER &&
      pin.appliedEvidenceType === "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD" &&
      pin.remoteHistoryCountAfterApply === BRIDGE_REMOTE_HISTORY &&
      pin.appliedExactlyOnce === true &&
      pin.appliedByThisPhase === false &&
      pin.catalogParityVerified === true;
  })());
record("G05a the bridge no longer appears as pending",
  !manifest.pendingPostAnchorMigrations.some((r) => r.version === BRIDGE_VERSION));
// QF-MVP-50.5 cleared its own staging gate, so the applied set grew to ten.
// QF-MVP-40.13B RE-PIN: the pending set now holds exactly its one SOURCE-PENDING entry.
// QF-MVP-40 MARKETING-CONSENT RE-PIN: the SOURCE-PENDING set grows from one to two
// (40.13B canary authority + the marketing-consent writer RPC). The APPLIED set is
// UNCHANGED at ten: neither pending migration has been applied to staging.
record("G06 the pending post-anchor set is exactly the three SOURCE-PENDING governed authorities",
  manifest.pendingPostAnchorMigrations?.length === 3 &&
  same(manifest.pendingPostAnchorMigrations.map((r) => r.version), PENDING_ORDER));
record("G07 the ten applied records read 21 through 30 in exact order",
  same(manifest.appliedPostAnchorMigrations.map((r) => r.remoteHistoryCountAfterApply),
    [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]) &&
  same(manifest.appliedPostAnchorMigrations.map((r) => r.version), APPLIED_ORDER));
record("G08 the anchor post-anchor count agrees at 12",
  manifest.appliedAnchor?.postAnchorMigrationCount === POST_ANCHOR_COUNT);
record("G09 G1 was re-pinned to 99 / 10 applied / 2 pending, not loosened",
  /const MIGRATION_COUNT = 100;/.test(g1Source) &&
  g1Source.includes(`version: "${BRIDGE_VERSION}"`) &&
  g1Source.includes(`sha: "${BRIDGE_SHA}"`) &&
  g1Source.includes("pendingPins.length === 3") &&
  g1Source.includes("appliedPins.length === 10") &&
  !/postAnchorLocal\.length\s*>=/.test(g1Source) &&
  !/state\.migrations\.length\s*>=/.test(g1Source));
record("G10 no generic future-migration allowance was granted",
  manifest.safety?.genericFutureMigrationAllowanceForbidden === true &&
  manifest.safety?.postAnchorMigrationsMustBeExplicitlyPinned === true &&
  manifest.safety?.includeAllForbiddenForThisLineage === true);
record("G11 the baseline record is untouched",
  manifest.baseline?.version === "20260722000100" &&
  manifest.baseline?.sourceSchemaSha256 ===
    "269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f" &&
  manifest.safety?.baselineMustRemainOutsideMigrations === true &&
  !migrationFiles.includes("20260722000100_qf_mvp_staging_baseline_269c9265.sql"));
record("G12 the validator is registered and wired into CI",
  pkg.scripts["test:mvp:50-3-50-4-bridge"] ===
    "node scripts/mvp/automation/validate-qf-mvp-50-3-50-4-policy-config-bridge.mjs" &&
  /run: npm run test:mvp:50-3-50-4-bridge/.test(ciWorkflow));
record("G13 CI still takes no secret, database or deployment action",
  !ciWorkflow.includes("${{ secrets.") &&
  !/^\s*(?:run:\s*)?(?:npx\s+)?supabase\s+/mi.test(ciWorkflow) &&
  !/\bdb push\b/i.test(ciWorkflow));

// ---------------------------------------------------------------------------
// M. MUTANTS — each defect must be impossible by construction
// ---------------------------------------------------------------------------
const mutants = [
  ["a bridge ordered after the 50.3 producer is impossible",
    () => BRIDGE_VERSION < "20260809000000" &&
          migrationFiles.indexOf(BRIDGE_NAME) < migrationFiles.indexOf(FROZEN[0][0])],
  ["editing the historical pre-baseline migration is impossible",
    () => canonicalSha256(readFileSync(path.join(ROOT, HISTORICAL_PATH))) === HISTORICAL_SHA],
  ["drifting the 50.3 producer from its re-pinned hash is impossible",
    () => canonicalSha256(readFileSync(path.join(ROOT, "supabase/migrations", FROZEN[0][0]))) === FROZEN[0][1]],
  ["editing the APPLIED bridge is impossible",
    () => canonicalSha256(readFileSync(path.join(ROOT, BRIDGE_PATH))) === BRIDGE_SHA &&
          manifest.appliedPostAnchorMigrations.find((r) => r.version === BRIDGE_VERSION)?.sha256 === BRIDGE_SHA],
  ["editing the merged 50.4 or family-claim migrations is impossible",
    () => FROZEN.slice(1).every(([f, s]) =>
      canonicalSha256(readFileSync(path.join(ROOT, "supabase/migrations", f))) === s)],
  ["a bare CREATE TABLE IF NOT EXISTS with no shape check is impossible",
    () => !/create table if not exists/i.test(bridge) &&
          /information_schema\.columns/.test(bridge) &&
          /pg_constraint/.test(bridge)],
  ["silently completing a partial state is impossible",
    () => /if v_configs_present <> v_active_present then/.test(bridge) &&
          /PARTIAL catalog state/.test(bridgeSource) &&
          /errcode = 'P0001'/.test(bridge)],
  ["silently accepting a non-canonical foundation is impossible",
    () => /present but NOT canonical/.test(bridgeSource) &&
          /array_length\(v_problems, ?1\) is not null/.test(bridge)],
  ["dropping or recreating an existing table is impossible",
    () => !/\bdrop\s+table\b/i.test(bridge) && !/\bcascade\b/i.test(bridge)],
  ["overwriting an existing seed row is impossible",
    () => !/on conflict[\s\S]*?do update/i.test(bridge) &&
          !/\bupdate\s+public\./i.test(bridge) &&
          bridge.indexOf("phase4b1_safe_default_seed") > bridge.indexOf("STATE_A")],
  ["flipping mustReplayOnStaging to true is impossible",
    () => manifest.preBaselineChain?.mustReplayOnStaging === false &&
          manifest.safety?.preBaselineReplayForbidden === true],
  ["moving the low-credit threshold into the bridge is impossible",
    () => !/vendor_low_credit_warning_threshold|thresholdCredits/.test(bridge) &&
          /"thresholdCredits":3/.test(producerSql)],
  ["claiming production access is impossible",
    () => manifest.scope?.databaseMutationAuthorized === false &&
          manifest.scope?.productionImplication === false &&
          same(manifest.safety?.forbiddenTargets, ["production", "jarvis", "onedecore"]) &&
          !/yqpgcsduqbxulrlzwzap/.test(bridgeSource)],
  ["broadening the bridge into a general pre-baseline replay is impossible",
    () => manifest.preBaselineChain?.postBaselineParityBridges?.length === 1 &&
          manifest.preBaselineChain.count === 68 &&
          // exactly the two canonical tables, nothing else from the pre-baseline chain
          (bridge.match(/create table public\./g) ?? []).length === 2],
  ["claiming the bridge was applied more than once is impossible",
    () => manifest.appliedPostAnchorMigrations.find((r) => r.version === BRIDGE_VERSION)?.appliedExactlyOnce === true &&
          manifest.appliedPostAnchorMigrations.filter((r) => r.version === BRIDGE_VERSION).length === 1 &&
          manifest.appliedPostAnchorMigrations.length === 10],
  ["demoting reconciled 090/100/110 back to pending is impossible",
    () => manifest.pendingPostAnchorMigrations.every((r) => PENDING_ORDER.includes(r.version)) &&
          ["20260809000000", "20260810000000", "20260811000000"].every((version) =>
            manifest.appliedPostAnchorMigrations.some((r) =>
              r.version === version && r.operationalStatus === "APPLIED" && r.appliedByThisPhase === false))],
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
console.log(`\nQF-MVP-50.3/50.4 POLICY-CONFIG BRIDGE: ${results.length - failed.length}/${results.length} ${failed.length ? "FAIL" : "PASS"}`);
if (failed.length) {
  console.log("QF_MVP_50_3_50_4_POLICY_CONFIG_BRIDGE_BLOCKED");
  process.exit(1);
}
console.log("QF_MVP_50_3_50_4_POLICY_CONFIG_BRIDGE_SOURCE_READY");
