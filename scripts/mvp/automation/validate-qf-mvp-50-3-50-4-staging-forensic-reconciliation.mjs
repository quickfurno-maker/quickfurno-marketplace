#!/usr/bin/env node
// QF-MVP-50.3 / 50.4 staging forensic reconciliation gate.
// OFFLINE ONLY: no database, network, provider, n8n or deployment access.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalSha256 = (buffer) => sha256(Buffer.from(
  buffer.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
  "utf8",
));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const clone = (value) => structuredClone(value);

const MANIFEST_PATH = "supabase/staging-history/qf-mvp-staging-history-manifest.json";
const EVIDENCE_PATH = "docs/QF-MVP-50-3-50-4-STAGING-FORENSIC-RECONCILIATION.md";
const VENDOR_DOC_PATH = "docs/QF-MVP-50-3-VENDOR-WORKFLOWS.md";
const CAMPAIGN_DOC_PATH = "docs/QF-MVP-50-4-CAMPAIGN-AUTOMATION.md";
const CI_PATH = ".github/workflows/qf-mvp-50-quality-gate.yml";
const SCRIPT_NAME = "test:mvp:50-3-50-4-forensic";
const SCRIPT_COMMAND =
  "node scripts/mvp/automation/validate-qf-mvp-50-3-50-4-staging-forensic-reconciliation.mjs";
const CLASSIFICATION = "APPLIED_RECORDED_CATALOG_MATCHES_CURRENT_SOURCE";
const FORENSIC_EVIDENCE_TYPE = "IMPORTED_FOUNDER_ACKNOWLEDGED_EXISTING_STAGING_STATE";
const UNKNOWN_PROVENANCE = "UNKNOWN";
// QF-MVP-40.13B RE-PIN. The forensic truth this gate certifies — the APPLIED records at
// remote history 21..30, with UNKNOWN executor provenance for the reconciled three — is
// completely unchanged. The only difference is that one further migration
// (20260813000000, the canary activation authority) now exists on disk as SOURCE-PENDING.
const MIGRATION_COUNT = 98;
// QF-MVP-50.5 STAGING GATE RE-PIN: this version is no longer pending. It cleared
// its own staging gate at remote history 30 and is now the newest APPLIED record.
const RECOVERY_VERSION = "20260812000000";
const RECOVERY_FILENAME =
  "20260812000000_qf_mvp_50_5_automation_recovery_reconciliation.sql";
/** QF-MVP-40.13B — SOURCE ONLY, never applied by this or any prior phase. */
const CANARY_AUTHORITY_FILENAME =
  "20260813000000_qf_mvp_40_13b_canary_activation_authority.sql";

const EXPECTED_APPLIED = [
  ["20260804000000", 21],
  ["20260805000000", 22],
  ["20260806000000", 23],
  ["20260807000000", 24],
  ["20260808000000", 25],
  ["20260808500000", 26],
  ["20260809000000", 27],
  ["20260810000000", 28],
  ["20260811000000", 29],
  ["20260812000000", 30],
];

const FORENSIC_MIGRATIONS = [
  {
    version: "20260808500000",
    filename: "20260808500000_qf_mvp_50_3_automation_policy_config_foundation_bridge.sql",
    sha: "05e114910c8ba06e9d697b81ca645dfc13a03ed29751090901666975dc6fcbca",
    statementCount: 2,
    statementDigest: "fe792b5a2046efba35f972706a37e1342c21c974066127bb2670ba9a8cb2cb3d",
    marker: "QF_MVP_50_3_50_4_POLICY_CONFIG_BRIDGE_STAGING_APPLIED_AND_VERIFIED",
    evidenceType: "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD",
  },
  {
    version: "20260809000000",
    filename: "20260809000000_qf_mvp_50_3_vendor_automation_producer.sql",
    sha: "3588f6d06256af7d6ae95263bb474fb33a15428d0a402bd81c6dd1eb0e6076cb",
    statementCount: 23,
    statementDigest: "6808ff0f9f74c1f904974885662b0d75dfa9e82756f38fb0b7bec62a5481c520",
    marker: "QF_MVP_50_3_STAGING_FORENSIC_RECONCILIATION_APPLIED",
    evidenceType: FORENSIC_EVIDENCE_TYPE,
  },
  {
    version: "20260810000000",
    filename: "20260810000000_qf_mvp_50_4_campaign_recipient_automation.sql",
    sha: "8440e5e818676232969c5046941daa7e8fc905728ea73d295ca0e997c5ac7906",
    statementCount: 9,
    statementDigest: "92eceaf49e7a976909b8155d0376884d6f9be7a895f68b21e544f0b860bc9f50",
    marker: "QF_MVP_50_4_STAGING_FORENSIC_RECONCILIATION_APPLIED",
    evidenceType: FORENSIC_EVIDENCE_TYPE,
  },
  {
    version: "20260811000000",
    filename: "20260811000000_qf_mvp_50_3_50_4_family_aware_claim_routing.sql",
    sha: "fc7efae9c2349854b9856d3b3b3956933bcfe79ed15c1eeb7caf65bc61f8f89d",
    statementCount: 18,
    statementDigest: "4bc79fb75c34058d91955a79d4fc67eeafe590923b6a31dc9d6c521fc793e8ea",
    marker: "QF_MVP_50_3_50_4_FAMILY_CLAIM_STAGING_FORENSIC_RECONCILIATION_APPLIED",
    evidenceType: FORENSIC_EVIDENCE_TYPE,
  },
].map((migration) => ({
  ...migration,
  path: `supabase/migrations/${migration.filename}`,
}));

function loadState() {
  const migrationFiles = readdirSync(path.join(ROOT, "supabase/migrations"))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  return {
    manifest: JSON.parse(read(MANIFEST_PATH)),
    evidenceExists: existsSync(path.join(ROOT, EVIDENCE_PATH)),
    evidence: read(EVIDENCE_PATH),
    vendorDoc: read(VENDOR_DOC_PATH),
    campaignDoc: read(CAMPAIGN_DOC_PATH),
    ci: read(CI_PATH),
    pkg: JSON.parse(read("package.json")),
    migrationFiles,
    sourceHashes: Object.fromEntries(FORENSIC_MIGRATIONS.map((migration) => [
      migration.version,
      canonicalSha256(readFileSync(path.join(ROOT, migration.path))),
    ])),
    claimMigration: read(FORENSIC_MIGRATIONS.at(-1).path),
  };
}

function validateState(state) {
  const results = [];
  const check = (name, passed) => results.push({ name, passed: passed === true });
  const { manifest } = state;
  const applied = Array.isArray(manifest.appliedPostAnchorMigrations)
    ? manifest.appliedPostAnchorMigrations
    : [];
  const pending = Array.isArray(manifest.pendingPostAnchorMigrations)
    ? manifest.pendingPostAnchorMigrations
    : null;

  check("migration count is exactly 98", state.migrationFiles.length === MIGRATION_COUNT);
  check("the exact final four forensic migration filenames are frozen, followed only by the applied 50.5 migration and the pinned SOURCE-PENDING 40.13B authority",
    same(state.migrationFiles.slice(-6),
      [...FORENSIC_MIGRATIONS.map((migration) => migration.filename), RECOVERY_FILENAME,
       CANARY_AUTHORITY_FILENAME]));
  check("all four accepted source hashes are exact",
    FORENSIC_MIGRATIONS.every((migration) => state.sourceHashes[migration.version] === migration.sha));

  check("the applied post-anchor set is exactly ten in order",
    same(applied.map((record) => record.version), EXPECTED_APPLIED.map(([version]) => version)));
  check("the remote-history counts are exactly 21 through 30",
    same(applied.map((record) => record.remoteHistoryCountAfterApply),
      EXPECTED_APPLIED.map(([, history]) => history)));
  check("the manifest pending set is exactly the SOURCE-PENDING 40.13B authority",
    pending !== null && pending.length === 1 &&
    pending[0].version === "20260813000000" &&
    pending[0].operationalStatus === "PENDING" &&
    pending[0].requiresSeparateStagingDeploymentGate === true);
  check("the 50.5 recovery migration is APPLIED at remote history 30 by its own phase",
    (() => {
      const pin = applied.find((record) => record.version === RECOVERY_VERSION);
      return pin?.operationalStatus === "APPLIED" &&
        pin.remoteHistoryCountAfterApply === 30 &&
        pin.appliedByThisPhase === true &&
        pin.appliedExactlyOnce === true &&
        !("remoteVersionStatus" in pin);
    })());
  check("no forensic applied record was demoted into the pending set",
    pending !== null &&
    EXPECTED_APPLIED.every(([version]) => !pending.some((r) => r.version === version)));
  check("the anchor post-anchor count equals the ten applied records plus the one SOURCE-PENDING authority",
    manifest.appliedAnchor?.postAnchorMigrationCount === EXPECTED_APPLIED.length + 1);

  for (const expected of FORENSIC_MIGRATIONS) {
    const pin = applied.find((record) => record.version === expected.version);
    check(`${expected.version} has exact applied identity and hash`,
      pin?.path === expected.path && pin?.sha256 === expected.sha && pin?.operationalStatus === "APPLIED");
    check(`${expected.version} is recorded once and never attributed to this phase`,
      pin?.appliedExactlyOnce === true && pin?.appliedByThisPhase === false &&
      applied.filter((record) => record.version === expected.version).length === 1);
    check(`${expected.version} retains its truthful evidence marker and type`,
      pin?.appliedEvidenceMarker === expected.marker && pin?.appliedEvidenceType === expected.evidenceType);
    check(`${expected.version} retains exact ledger statement evidence`,
      pin?.remoteStatementCount === expected.statementCount &&
      pin?.remoteOrderedStatementDigestSha256 === expected.statementDigest);
    check(`${expected.version} is catalog-matched and provenance remains unknown`,
      pin?.catalogParityVerified === true &&
      pin?.forensicClassification === CLASSIFICATION &&
      pin?.applyExecutorProvenance === UNKNOWN_PROVENANCE &&
      pin?.migrationHistoryTimestampAvailable === false &&
      pin?.evidencePath === EVIDENCE_PATH);
    check(`${expected.version} carries no stale pending-only status fields`,
      !("remoteVersionStatus" in (pin ?? {})) &&
      !("requiresSeparateStagingDeploymentGate" in (pin ?? {})));
  }

  check("090 correction lineage and exact availability exemption remain pinned", (() => {
    const pin = applied.find((record) => record.version === "20260809000000");
    return pin?.supersededSourceSha256 ===
      "a4b94ac6df39caa71ef9adcb8f40eb19850d425f3724c82fc4a7bc979ed8fb11" &&
      pin?.sourceCorrection === "SELF_VERIFICATION_9_6_VENDOR_AVAILABILITY_TOGGLE_EXEMPTION";
  })());

  check("the durable forensic evidence document exists", state.evidenceExists);
  check("evidence pins the project, 29-row history and all four classifications",
    state.evidence.includes("uckafzuochmbvtiodmcl") &&
    state.evidence.includes("exactly 29 rows") &&
    FORENSIC_MIGRATIONS.every((migration) =>
      state.evidence.includes(`| \`${migration.version}\``)) &&
    (state.evidence.match(new RegExp(CLASSIFICATION, "g")) ?? []).length >= 4);
  check("evidence keeps executor provenance explicitly unknown",
    state.evidence.includes("`APPLY_EXECUTOR_PROVENANCE: UNKNOWN`") &&
    !/APPLY_EXECUTOR_PROVENANCE:\s*(?!UNKNOWN\b)[A-Z0-9_-]+/.test(state.evidence));
  check("evidence makes no false database-apply or write claim",
    state.evidence.includes("`STAGING_DB_WRITES_BY_THIS_PHASE: 0`") &&
    state.evidence.includes("`MIGRATIONS_APPLIED_BY_THIS_PHASE: 0`") &&
    state.evidence.includes("This phase did not apply, reapply, repair or remove anything") &&
    !/STAGING_DB_WRITES_BY_THIS_PHASE:\s*[1-9]|MIGRATIONS_APPLIED_BY_THIS_PHASE:\s*[1-9]/.test(state.evidence));
  check("n8n certification and provider activation remain explicitly unearned",
    state.evidence.includes("`N8N_CERTIFICATION_PERFORMED: NO`") &&
    state.evidence.includes("`PROVIDER_ACTIVATION_PERFORMED: NO`") &&
    state.evidence.includes("`WHATSAPP_MESSAGES_SENT: 0`") &&
    !/N8N_CERTIFICATION_PERFORMED:\s*YES|PROVIDER_ACTIVATION_PERFORMED:\s*YES/.test(state.evidence));
  check("QF-MVP-50.5 remains unstarted and absent from the accepted claim migration",
    state.evidence.includes("`QF_MVP_50_5_STARTED: NO`") &&
    !/create\s+or\s+replace\s+function\s+public\.[^(]*(?:due_?sweep|stale_?lease|retry_?recovery|dead_?letter)/i
      .test(state.claimMigration));
  check("vendor accept/reject remains permanently absent",
    state.vendorDoc.includes("Vendor accept/reject remains **permanently absent**") &&
    state.vendorDoc.includes("vendors.accepting_leads") &&
    manifest.safety?.vendorAcceptRejectPermanentlyAbsent === true &&
    manifest.safety?.vendorAvailabilityToggleIsNotAcceptReject?.semantics === "VENDOR_AVAILABILITY_ONLY" &&
    !/vendor accept\/reject (?:is|becomes) (?:enabled|supported|active)/i.test(state.vendorDoc));
  check("50.3 and 50.4 remain source-ready but not staging-certified",
    /SOURCE READY/.test(state.vendorDoc) && /not staging certified/i.test(state.vendorDoc) &&
    /SOURCE READY/.test(state.campaignDoc) && /not staging certified/i.test(state.campaignDoc) &&
    state.vendorDoc.includes("orchestration certification without migration apply") &&
    state.campaignDoc.includes("orchestration certification without migration apply"));

  check("the validator is registered and wired into the offline CI gate",
    state.pkg.scripts?.[SCRIPT_NAME] === SCRIPT_COMMAND &&
    /- name: QF-MVP-50\.3\/50\.4 staging forensic reconciliation\s+run: npm run test:mvp:50-3-50-4-forensic/.test(state.ci));
  check("CI introduces no secret, database, provider or deployment operation",
    !state.ci.includes("${{ secrets.") &&
    !/^\s*(?:run:\s*)?(?:npx\s+)?supabase\s+/mi.test(state.ci) &&
    !/\bdb push\b/i.test(state.ci) &&
    !/^\s*run:.*\bdeploy\b/mi.test(state.ci));

  return { results, failures: results.filter((result) => !result.passed) };
}

function runMutants(pristine) {
  const cases = [
    ...["20260809000000", "20260810000000", "20260811000000"].map((version) => [
      `${version} demoted back to pending`,
      (state) => {
        const index = state.manifest.appliedPostAnchorMigrations.findIndex((record) => record.version === version);
        const [record] = state.manifest.appliedPostAnchorMigrations.splice(index, 1);
        state.manifest.pendingPostAnchorMigrations.push({ ...record, operationalStatus: "PENDING" });
      },
    ]),
    ["appliedByThisPhase invented", (state) => {
      state.manifest.appliedPostAnchorMigrations.find((record) =>
        record.version === "20260810000000").appliedByThisPhase = true;
    }],
    ["known executor invented", (state) => {
      state.manifest.appliedPostAnchorMigrations.find((record) =>
        record.version === "20260809000000").applyExecutorProvenance = "SUPABASE_CLI";
    }],
    ["accepted source hash changed", (state) => {
      state.sourceHashes["20260811000000"] = "0".repeat(64);
    }],
    ["remote history count changed", (state) => {
      state.manifest.appliedPostAnchorMigrations.find((record) =>
        record.version === "20260811000000").remoteHistoryCountAfterApply = 30;
    }],
    ["ledger statement digest changed", (state) => {
      state.manifest.appliedPostAnchorMigrations.find((record) =>
        record.version === "20260810000000").remoteOrderedStatementDigestSha256 = "f".repeat(64);
    }],
    ["n8n certification falsely claimed", (state) => {
      state.evidence = state.evidence.replace("N8N_CERTIFICATION_PERFORMED: NO", "N8N_CERTIFICATION_PERFORMED: YES");
    }],
    ["provider readiness falsely claimed", (state) => {
      state.evidence = state.evidence.replace("PROVIDER_ACTIVATION_PERFORMED: NO", "PROVIDER_ACTIVATION_PERFORMED: YES");
    }],
    ["database apply falsely attributed to this phase", (state) => {
      state.evidence = state.evidence.replace("MIGRATIONS_APPLIED_BY_THIS_PHASE: 0", "MIGRATIONS_APPLIED_BY_THIS_PHASE: 3");
    }],
    ["QF-MVP-50.5 recovery introduced", (state) => {
      state.claimMigration += "\ncreate or replace function public.qf_due_sweep() returns void language sql as $$ select $$;";
    }],
    ["vendor accept/reject semantics enabled", (state) => {
      state.vendorDoc += "\nVendor accept/reject is enabled.\n";
    }],
    ["pending list removed instead of empty", (state) => {
      delete state.manifest.pendingPostAnchorMigrations;
    }],
    ["forensic evidence type forged as owner-reviewed execution", (state) => {
      state.manifest.appliedPostAnchorMigrations.find((record) =>
        record.version === "20260809000000").appliedEvidenceType =
        "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD";
    }],
  ];

  return cases.map(([name, mutate]) => {
    const mutant = clone(pristine);
    mutate(mutant);
    return { name, rejected: validateState(mutant).failures.length > 0 };
  });
}

const state = loadState();
const validation = validateState(state);
const mutants = runMutants(state);

for (const [index, result] of validation.results.entries()) {
  console.log(`${result.passed ? "PASS" : "FAIL"} ${String(index + 1).padStart(2, "0")} ${result.name}`);
}
for (const [index, mutant] of mutants.entries()) {
  console.log(`${mutant.rejected ? "PASS" : "FAIL"} M${String(index + 1).padStart(2, "0")} reject mutant: ${mutant.name}`);
}

const mutantFailures = mutants.filter((mutant) => !mutant.rejected);
console.log(`SUMMARY assertions=${validation.results.length} passed=${validation.results.length - validation.failures.length} failed=${validation.failures.length} mutants=${mutants.length} mutants_rejected=${mutants.length - mutantFailures.length}`);
if (validation.failures.length || mutantFailures.length) process.exit(1);
