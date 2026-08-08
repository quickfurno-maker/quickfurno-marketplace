#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MANIFEST_PATH = "supabase/staging-history/qf-mvp-staging-history-manifest.json";
const BASELINE_PATH = "supabase/staging-baseline/20260722000100_qf_mvp_staging_baseline_269c9265.sql";
const TARGET_PATH = "supabase/migrations/20260803000000_qf_mvp_50_2c_lead_communication_recipient.sql";
const S1_PATH = "docs/QF-MVP-50-2C-S1-STAGING-PREFLIGHT-EVIDENCE.md";
const GOVERNANCE_PATH = "docs/QF-MVP-50-2C-S2-STAGING-HISTORY-GOVERNANCE.md";
const README_PATH = "supabase/staging-baseline/README.md";
const APPLICATION_REPORT_PATH = "docs/QF-MVP-20-STAGING-BASELINE-APPLICATION-RESULTS.md";
const WORKFLOW_PATH = ".github/workflows/qf-mvp-50-quality-gate.yml";

const BASELINE_VERSION = "20260722000100";
const BASELINE_SHA = "101ac82c7840eec8802155fec4d4a18cba445447b7d773aaf168417f737aa33c";
const HISTORICAL_SHA = "920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81";
// QF-MVP-50.2D-R1 — the 50.2C target is now the frozen APPLIED anchor.
const TARGET_VERSION = "20260803000000";
const TARGET_SHA = "77d2bb1162e0522b061f36df787d94c2dad4f0ceeff3e4a07c8946cd4e1d56ca";
const APPLIED_EVIDENCE_MARKER = "QF_MVP_50_2C_S2_D2_R1_STAGING_MIGRATION_APPLIED_AND_VERIFIED";

// QF-MVP-50.2-R2-APPLIED-TRUTH — RE-PIN, NEVER LOOSEN.
//
// History of this rule:
//   original          "20260803000000 must forever be the newest local migration"
//   QF-MVP-50.2D-R1   exactly ONE post-anchor migration, hash-pinned, PENDING
//   QF-MVP-50.2E-R1   exactly TWO post-anchor migrations: 20260804000000 APPLIED
//                     (remote history 21), 20260805000000 PENDING
//   QF-MVP-50.2E-S2-G1 exactly TWO post-anchor migrations, BOTH APPLIED, in exact
//                     order, each hash-pinned by version/name/path/hash and each
//                     carrying its own imported owner-reviewed evidence marker and
//                     exact remote-history count. ZERO pending remain.
//   QF-MVP-50.2-FINAL-CLOSURE-R2
//                     adds 20260806000000 as a THIRD post-anchor migration,
//                     hash-pinned and PENDING.
//   QF-MVP-50.2-R2-APPLIED-TRUTH
//                     exactly THREE post-anchor migrations, ALL APPLIED, in exact
//                     order, at remote history 21 / 22 / 23. ZERO pending remain.
//                     20260806000000 was applied exactly once to QuickFurno
//                     staging by an external owner-reviewed execution; this
//                     source phase imports that record and applies nothing.
//   QF-MVP-50.2-EXECUTE-V1-REPAIR
//                     exactly FOUR post-anchor migrations: the three above stay
//                     APPLIED at 21 / 22 / 23, and 20260807000000 (the execute_v1
//                     ambiguity repair) is added hash-pinned and PENDING until
//                     its own staging gate. Exactly ONE pending remains.
//
// Every applied status here is IMPORTED owner-reviewed external execution
// evidence. G1 performs no database access and re-proves none of it itself.
//
// This is NOT a relaxation to "anything newer is fine". There is no `>=`, no
// wildcard and no version-greater-than allowance: a ninth post-anchor migration,
// a renamed candidate, a hash-drifted candidate, a missing candidate, an
// out-of-order set, any new PENDING entry, a demoted applied record, a forged
// marker and a wrong remote-history count all still fail closed.
const POST_ANCHOR_APPLIED = [
  {
    version: "20260804000000",
    name: "qf_mvp_50_2d_automation_transport_completion_route",
    sha: "043f1e3bbe261aef516ca35b54eb3e1c339d21d6b0c55c77f1d138eb502fa2c2",
    marker: "QF_MVP_50_2D_S2_STAGING_MIGRATION_APPLIED_AND_VERIFIED",
    remoteHistory: 21,
    phase: "QF-MVP-50.2D",
  },
  {
    version: "20260805000000",
    name: "qf_mvp_50_2e_automation_transport_client_execution_route",
    sha: "9a8a29975e18135b96e7be7d4510104033c5de00cf080df5dab4326e3891250b",
    marker: "QF_MVP_50_2E_S2_STAGING_MIGRATION_APPLIED_AND_VERIFIED",
    remoteHistory: 22,
    phase: "QF-MVP-50.2E",
  },
  {
    version: "20260806000000",
    name: "qf_mvp_50_2_atomic_client_automation_producer",
    sha: "ce947a6f8d7dd42d2851f6c99eba4bf2ef39308b8d85ff876260d575185a3cfb",
    marker: "QF_MVP_50_2_FINAL_R2_STAGING_MIGRATION_APPLIED_AND_VERIFIED",
    remoteHistory: 23,
    phase: "QF-MVP-50.2-FINAL-CLOSURE-R2",
  },
  {
    version: "20260807000000",
    name: "qf_mvp_50_2_execute_v1_reservation_ambiguity_repair",
    sha: "c36171fe851968c5e42477c048d535c563676f3d44e020d41fd5abcff1dacee5",
    marker: "QF_MVP_50_2_EXECUTE_V1_REPAIR_STAGING_APPLIED_AND_VERIFIED",
    remoteHistory: 24,
    phase: "QF-MVP-50.2-EXECUTE-V1-REPAIR",
  },
  {
    version: "20260808000000",
    name: "qf_mvp_50_2_fresh_claim_retry_wedge_repair",
    sha: "8b798bb3c5db5d91f988d92cec3705237db08c753ae5018d09dccc09ff0240aa",
    marker: "QF_MVP_50_2_RETRY_WEDGE_STAGING_APPLIED_AND_VERIFIED",
    remoteHistory: 25,
    phase: "QF-MVP-50.2-FRESH-CLAIM-WEDGE-REPAIR",
  },
].map((m) => ({
  ...m,
  filename: `${m.version}_${m.name}.sql`,
  path: `supabase/migrations/${m.version}_${m.name}.sql`,
}));

// QF-MVP-50.2-FRESH-CLAIM-WEDGE-REPAIR adds exactly ONE new pending post-anchor
// migration: the successor that excludes retry_scheduled from the ordinary
// fresh-work claim selector. The four applied records above are untouched;
// this one stays PENDING until its own staging gate.
// QF-MVP-50.3 / 50.4 add exactly TWO new pending post-anchor migrations: the
// vendor automation producer and the campaign recipient execution vehicle. The
// five applied records above are untouched; both of these stay PENDING until
// their own staging gate.
const POST_ANCHOR_PENDING = [
  {
    version: "20260808500000",
    name: "qf_mvp_50_3_automation_policy_config_foundation_bridge",
    sha: "05e114910c8ba06e9d697b81ca645dfc13a03ed29751090901666975dc6fcbca",
    phase: "QF-MVP-50.3-50.4-POLICY-CONFIG-BRIDGE",
  },
  {
    version: "20260809000000",
    name: "qf_mvp_50_3_vendor_automation_producer",
    sha: "a4b94ac6df39caa71ef9adcb8f40eb19850d425f3724c82fc4a7bc979ed8fb11",
    phase: "QF-MVP-50.3",
  },
  {
    version: "20260810000000",
    name: "qf_mvp_50_4_campaign_recipient_automation",
    sha: "8440e5e818676232969c5046941daa7e8fc905728ea73d295ca0e997c5ac7906",
    phase: "QF-MVP-50.4",
  },
  {
    version: "20260811000000",
    name: "qf_mvp_50_3_50_4_family_aware_claim_routing",
    sha: "fc7efae9c2349854b9856d3b3b3956933bcfe79ed15c1eeb7caf65bc61f8f89d",
    phase: "QF-MVP-50.3/50.4-FAMILY-AWARE-CLAIM",
  },
].map((m) => ({ ...m, filename: `${m.version}_${m.name}.sql`, path: `supabase/migrations/${m.version}_${m.name}.sql` }));

const POST_ANCHOR_ORDER = [...POST_ANCHOR_APPLIED, ...POST_ANCHOR_PENDING].map((m) => m.version);
const POST_ANCHOR_ALL = [...POST_ANCHOR_APPLIED, ...POST_ANCHOR_PENDING];
const APPLIED_EVIDENCE_TYPE = "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD";
const MIGRATION_COUNT = 96;

const APPROVED_COMMON = [
  "20260723000100", "20260723000200", "20260723000300", "20260723000400",
  "20260723000500", "20260723000600", "20260723000700", "20260723000800",
  "20260723000900", "20260723001000", "20260723001100", "20260723001200",
  "20260723001300", "20260723001400", "20260728001500", "20260728001600",
  "20260801110000", "20260801152049",
];

const L3_RESOLVED = {
  "20260723001200": {
    byteProvenance: "UNAVAILABLE",
    remoteStatementCount: 1,
    digest: "21a8f22417ca9e895590ce2411544f3667660cdc74eefa3f46032c7eb9f07b00",
  },
  "20260723001300": {
    byteProvenance: "UNAVAILABLE",
    remoteStatementCount: 1,
    digest: "0ac1ee093c4fbeb9bbb1e8b19551f614c3dba2970c168f3e58edc5753f18d405",
  },
  "20260728001500": {
    byteProvenance: "REPRESENTATION_EQUIVALENT",
    remoteStatementCount: 1,
    digest: "459a9698a31318759bf6ff605050224136e5dddf4c216646a46823b01177be52",
  },
  "20260728001600": {
    byteProvenance: "EXACT",
    remoteStatementCount: 1,
    digest: "4823948c3389f094a88ddbf177db5dae3e90b0812447266ee42885ed4b25688f",
  },
  "20260801110000": {
    byteProvenance: "UNAVAILABLE",
    remoteStatementCount: 79,
    digest: "c37232cbc2a041fd58bd7d8cefc4ff3a0e27ce3c415d0d03c33e0b2fe60856e4",
  },
  "20260801152049": {
    byteProvenance: "UNAVAILABLE",
    remoteStatementCount: 1,
    digest: "d5a6a68f267af3ca55822a347211292224ad73a21551720bc128786a56349b72",
  },
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function canonicalMigrationSourceBytes(buffer) {
  const canonicalText = buffer
    .toString("utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  return Buffer.from(canonicalText, "utf8");
}
const canonicalMigrationSourceSha256 = (buffer) => sha256(canonicalMigrationSourceBytes(buffer));
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8");
const clone = (value) => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function walk(relativeDirectory) {
  const absoluteDirectory = path.join(ROOT, relativeDirectory);
  if (!existsSync(absoluteDirectory)) return [];
  const found = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) found.push(...walk(relativePath));
    if (entry.isFile()) found.push(relativePath);
  }
  return found.sort();
}

function loadState() {
  const manifestText = read(MANIFEST_PATH);
  const migrationFiles = readdirSync(path.join(ROOT, "supabase/migrations"), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const migrations = migrationFiles.map((filename) => {
    const match = /^(\d{14})_(.+)\.sql$/.exec(filename);
    const bytes = readFileSync(path.join(ROOT, "supabase/migrations", filename));
    return {
      filename,
      version: match?.[1] ?? null,
      name: match?.[2] ?? null,
      sha256: canonicalMigrationSourceSha256(bytes),
      malformed: !match,
    };
  });

  return {
    manifest: JSON.parse(manifestText),
    migrations,
    baselineExists: existsSync(path.join(ROOT, BASELINE_PATH)),
    baselineSha: sha256(readFileSync(path.join(ROOT, BASELINE_PATH))),
    targetExists: existsSync(path.join(ROOT, TARGET_PATH)),
    targetSha: sha256(readFileSync(path.join(ROOT, TARGET_PATH))),
    targetCanonicalSha: canonicalMigrationSourceSha256(readFileSync(path.join(ROOT, TARGET_PATH))),
    // One on-disk record per pinned post-anchor migration, keyed by version, so
    // every SHA assertion below stays an exact per-migration identity check.
    postAnchorOnDisk: Object.fromEntries(POST_ANCHOR_ALL.map((m) => {
      const full = path.join(ROOT, m.path);
      const present = existsSync(full);
      return [m.version, {
        exists: present,
        sha: present ? sha256(readFileSync(full)) : null,
        canonicalSha: present ? canonicalMigrationSourceSha256(readFileSync(full)) : null,
      }];
    })),
    s1Exists: existsSync(path.join(ROOT, S1_PATH)),
    s1: read(S1_PATH),
    governance: read(GOVERNANCE_PATH),
    readme: read(README_PATH),
    applicationReport: read(APPLICATION_REPORT_PATH),
    packageJson: JSON.parse(read("package.json")),
    workflow: read(WORKFLOW_PATH),
    stagingHistoryFiles: walk("supabase/staging-history"),
    governanceFiles: [MANIFEST_PATH, S1_PATH, GOVERNANCE_PATH, README_PATH, APPLICATION_REPORT_PATH]
      .map((file) => ({ file, text: read(file) })),
  };
}

function validateState(state) {
  const results = [];
  const check = (name, passed, detail = "") => results.push({ name, passed: Boolean(passed), detail });
  const manifest = state.manifest;
  const validMigrations = state.migrations.filter((record) => !record.malformed);
  const versions = validMigrations.map((record) => record.version);
  const duplicates = [...new Set(versions.filter((version, index) => versions.indexOf(version) !== index))];
  const preBaseline = validMigrations.filter((record) => record.version < BASELINE_VERSION);
  const postByVersion = new Map(manifest.postBaselineApplied.map((record) => [record.version, record]));
  const localByVersion = new Map(validMigrations.map((record) => [record.version, record]));
  const expectedPreRecords = preBaseline.map(({ version, filename, sha256: hash }) => ({ version, filename, sha256: hash }));
  const newestVersion = [...versions].sort().at(-1);

  check("manifest parses with manifestVersion=1", manifest.manifestVersion === 1);
  check("manifest scope is source-only G1", manifest.scope?.phase === "QF-MVP-50.2C-S2-G1" && manifest.scope?.databaseMutationAuthorized === false);
  check("migration source hash policy exists", typeof manifest.migrationSourceHashPolicy === "object" && manifest.migrationSourceHashPolicy !== null);
  check("migration source hash algorithm is sha256", manifest.migrationSourceHashPolicy?.algorithm === "sha256");
  check("migration source canonicalization is UTF8_LINE_ENDINGS_TO_LF", manifest.migrationSourceHashPolicy?.canonicalization === "UTF8_LINE_ENDINGS_TO_LF");
  check("migration source hash scope is exact", manifest.migrationSourceHashPolicy?.scope === "supabase/migrations/*.sql");
  check("migration source hash policy preserves BOM", manifest.migrationSourceHashPolicy?.preserveBom === true);
  check("migration source hash policy preserves final-newline state", manifest.migrationSourceHashPolicy?.preserveFinalNewlineState === true);
  check("migration source hash policy preserves all non-line-ending bytes", manifest.migrationSourceHashPolicy?.preserveAllNonLineEndingBytes === true);
  const lfFixture = Buffer.from("SELECT 1;\n-- x\n", "utf8");
  const crlfFixture = Buffer.from("SELECT 1;\r\n-- x\r\n", "utf8");
  const loneCrFixture = Buffer.from("SELECT 1;\r-- x\r", "utf8");
  check("canonical migration hash equates LF and CRLF", canonicalMigrationSourceSha256(lfFixture) === canonicalMigrationSourceSha256(crlfFixture));
  check("canonical migration hash equates LF and lone CR", canonicalMigrationSourceSha256(lfFixture) === canonicalMigrationSourceSha256(loneCrFixture));
  check("canonical migration hash preserves non-line-ending changes", canonicalMigrationSourceSha256(Buffer.from("SELECT 1", "utf8")) !== canonicalMigrationSourceSha256(Buffer.from("SELECT 2", "utf8")));
  check("canonical migration hash preserves final-newline presence", canonicalMigrationSourceSha256(Buffer.from("SELECT 1\n", "utf8")) !== canonicalMigrationSourceSha256(Buffer.from("SELECT 1", "utf8")));
  check("canonical migration hash preserves UTF-8 BOM", canonicalMigrationSourceSha256(Buffer.from("\ufeffSELECT 1\n", "utf8")) !== canonicalMigrationSourceSha256(Buffer.from("SELECT 1\n", "utf8")));
  check("staging environment identity is exact", manifest.environment?.name === "QuickFurno Staging" && manifest.environment?.projectRef === "uckafzuochmbvtiodmcl");
  check("forbidden project refs are exact", same(manifest.environment?.forbiddenProjectRefs, {
    production: "yqpgcsduqbxulrlzwzap", jarvis: "coilipywdvxklewquqvv", onedecore: "lpurlfmpvriyvpkujvyl",
  }));
  check("baseline source path exists", state.baselineExists && manifest.baseline?.sourcePath === BASELINE_PATH);
  check("baseline tracked SHA is exact", state.baselineSha === BASELINE_SHA && manifest.baseline?.trackedSourceSha256 === BASELINE_SHA);
  check("baseline source-schema SHA is preserved", manifest.baseline?.sourceSchemaSha256 === "269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f");
  check("baseline Git blob and revision count are exact", manifest.baseline?.gitBlobSha === "65e56c0419a986cc14a5abcfb184dd4a82625630" && manifest.baseline?.contentRevisionCount === 1);
  check("historical checksum and correction status are exact", manifest.baseline?.historicalDocumentedSha256 === HISTORICAL_SHA && manifest.baseline?.historicalDocumentedShaStatus === "DOCUMENTATION_ERROR_UNREPRODUCIBLE");
  check("baseline remote statement identity is exact", manifest.baseline?.remoteStatementCount === 821 && manifest.baseline?.remoteOrderedStatementDigestSha256 === "231e163068b0608aa53f09d97ded9c85f6b69d37d07ccd15de07d2c8c2aab581");
  check("baseline remains undiscoverable by migration chain", manifest.baseline?.migrationChainDiscoverable === false && manifest.baseline?.normalDbPushMustNeverDiscoverBaseline === true && !manifest.baseline?.sourcePath.startsWith("supabase/migrations/"));
  check("external apply-workspace bytes are recorded unavailable", manifest.baseline?.externalApplyWorkspaceBytesRetained === false);
  check("baseline version is absent under migrations", !state.migrations.some((record) => record.version === BASELINE_VERSION));
  check(`direct migration count is ${MIGRATION_COUNT}`, state.migrations.length === MIGRATION_COUNT, `actual=${state.migrations.length}`);
  check("migration filenames are all well formed", state.migrations.every((record) => !record.malformed));
  check("migration timestamps have no duplicates", duplicates.length === 0, duplicates.join(","));
  check("pre-baseline source count is 68", preBaseline.length === 68, `actual=${preBaseline.length}`);
  check("pre-baseline manifest count is 68", manifest.preBaselineChain?.count === 68 && manifest.preBaselineChain?.records?.length === 68);
  check("pre-baseline manifest records exactly match source", same(manifest.preBaselineChain?.records, expectedPreRecords));
  check("pre-baseline classification is exact", manifest.preBaselineChain?.classification === "PRE_BASELINE_CHAIN_INTENTIONALLY_SUPERSEDED_FOR_STAGING" && manifest.preBaselineChain?.semanticRole === "HISTORICAL_SOURCE_CHAIN_NOT_REMOTE_LEDGER_ENTRIES");
  check("pre-baseline replay/repair/history insertion all fail closed", manifest.preBaselineChain?.mustReplayOnStaging === false && manifest.preBaselineChain?.mustRepairAsApplied === false && manifest.preBaselineChain?.mustInsertIntoRemoteHistory === false);
  check("post-baseline set is exactly the approved 18", same(manifest.postBaselineApplied.map((record) => record.version), APPROVED_COMMON));
  check("all 18 post-baseline source files and hashes match", APPROVED_COMMON.every((version) => {
    const local = localByVersion.get(version);
    const recorded = postByVersion.get(version);
    return local && recorded && recorded.filename === local.filename && recorded.name === local.name && recorded.localSha256 === local.sha256;
  }));
  check("all 18 ledger/semantic classifications are proven", manifest.postBaselineApplied.every((record) => record.ledgerApplication === "PROVEN" && record.semanticApplication === "PROVEN"));
  check("all 18 deployment blockers are false", manifest.postBaselineApplied.every((record) => record.deploymentBlocker === false));
  check("six L3 remote counts/digests/byte classifications are exact", Object.entries(L3_RESOLVED).every(([version, expected]) => {
    const record = postByVersion.get(version);
    return record?.byteProvenance === expected.byteProvenance
      && record?.remoteStatementCount === expected.remoteStatementCount
      && record?.remoteOrderedStatementDigestSha256 === expected.digest;
  }));
  check("other 12 rows do not invent remote statement metadata", manifest.postBaselineApplied
    .filter((record) => !L3_RESOLVED[record.version])
    .every((record) => !("remoteStatementCount" in record) && !("remoteOrderedStatementDigestSha256" in record) && !("byteProvenance" in record)));
  check("anchor manifest identity is exact", manifest.appliedAnchor?.version === TARGET_VERSION && manifest.appliedAnchor?.name === "qf_mvp_50_2c_lead_communication_recipient" && manifest.appliedAnchor?.path === TARGET_PATH);
  check("anchor source exists and raw/canonical SHA are exact", state.targetExists && state.targetSha === TARGET_SHA && state.targetCanonicalSha === TARGET_SHA && manifest.appliedAnchor?.sha256 === TARGET_SHA);
  check("anchor operational status is APPLIED with imported D2-R1 evidence", manifest.appliedAnchor?.operationalStatus === "APPLIED" && manifest.appliedAnchor?.appliedEvidenceMarker === APPLIED_EVIDENCE_MARKER && manifest.appliedAnchor?.appliedEvidenceType === "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD" && manifest.appliedAnchor?.remoteHistoryCountAfterApply === 20 && manifest.appliedAnchor?.appliedExactlyOnce === true);
  check("anchor L3 observation is preserved as historical, not rewritten", manifest.appliedAnchor?.remoteVersionStatusAtL3 === "ABSENT");
  check("anchor documentation points to imported S1 evidence", manifest.appliedAnchor?.documentationStatus === "SOURCE_CONTROLLED_PREFLIGHT_IMPORTED_BY_G1" && manifest.appliedAnchor?.preflightEvidencePath === S1_PATH);
  check("anchor is present exactly once under migrations", validMigrations.filter((record) => record.version === TARGET_VERSION).length === 1);
  check("superseded pendingTarget block is gone", manifest.pendingTarget === undefined);

  // --- QF-MVP-50.2-R2-APPLIED-TRUTH post-anchor pin: exactly three, ALL APPLIED
  const postAnchorLocal = validMigrations.filter((record) => record.version > TARGET_VERSION);
  const appliedPins = Array.isArray(manifest.appliedPostAnchorMigrations) ? manifest.appliedPostAnchorMigrations : null;
  const pendingPins = Array.isArray(manifest.pendingPostAnchorMigrations) ? manifest.pendingPostAnchorMigrations : null;

  check("exactly nine local migrations are newer than the anchor", postAnchorLocal.length === 9, `actual=${postAnchorLocal.length}`);
  check("the nine post-anchor migrations appear in exact pinned order", same(postAnchorLocal.map((record) => record.version), POST_ANCHOR_ORDER));
  check("anchor records the same post-anchor count", manifest.appliedAnchor?.postAnchorMigrationCount === 9);
  check("manifest declares exactly five APPLIED post-anchor migrations", appliedPins !== null && appliedPins.length === 5, `actual=${appliedPins?.length}`);
  check("the applied records appear in exact pinned order", same(appliedPins?.map((record) => record.version), POST_ANCHOR_APPLIED.map((m) => m.version)));
  // Exactly ONE pending record: the execute_v1 repair, hash-pinned like every
  // other post-anchor migration. A missing key, a second pending entry and a
  // silently emptied list all fail closed.
  check("exactly four PENDING post-anchor migrations are declared", pendingPins !== null && pendingPins.length === 4, `actual=${pendingPins?.length}`);
  check("the pending records are in exact pinned order after the applied ones", same(pendingPins?.map((r) => r.version), POST_ANCHOR_PENDING.map((m) => m.version)));

  for (const expected of POST_ANCHOR_PENDING) {
    const label = `${expected.phase} ${expected.version}`;
    const local = postAnchorLocal.find((record) => record.version === expected.version);
    const pin = pendingPins?.find((record) => record.version === expected.version);
    const disk = state.postAnchorOnDisk?.[expected.version];
    check(`${label}: local migration is exactly the pinned version/name/file`,
      local?.version === expected.version && local?.name === expected.name && local?.filename === expected.filename);
    check(`${label}: manifest entry matches the pinned identity`,
      pin?.version === expected.version && pin?.name === expected.name && pin?.path === expected.path && pin?.phase === expected.phase);
    check(`${label}: source exists and raw/canonical SHA are exact`,
      disk?.exists === true && disk?.sha === expected.sha && disk?.canonicalSha === expected.sha);
    check(`${label}: manifest SHA equals the on-disk SHA`,
      pin?.sha256 === expected.sha && pin?.sha256 === local?.sha256);
    check(`${label}: is PENDING, needs its own gate, not applied by this phase`,
      pin?.operationalStatus === "PENDING" && pin?.requiresSeparateStagingDeploymentGate === true && pin?.appliedByThisPhase === false);
    check(`${label}: remote status is not fabricated offline`,
      pin?.remoteVersionStatus === "NOT_PROVEN_OFFLINE");
    check(`${label}: claims no applied evidence`,
      !("appliedEvidenceMarker" in (pin ?? {})) && !("remoteHistoryCountAfterApply" in (pin ?? {})));
  }

  // Per-migration exact identity, hash, evidence and remote-history assertions.
  for (const expected of POST_ANCHOR_APPLIED) {
    const label = `${expected.phase} ${expected.version}`;
    const local = postAnchorLocal.find((record) => record.version === expected.version);
    const pin = appliedPins?.find((record) => record.version === expected.version);
    const disk = state.postAnchorOnDisk?.[expected.version];

    check(`${label}: local migration is exactly the pinned version/name/file`,
      local?.version === expected.version && local?.name === expected.name && local?.filename === expected.filename);
    check(`${label}: manifest entry matches the pinned identity`,
      pin?.version === expected.version && pin?.name === expected.name && pin?.path === expected.path && pin?.phase === expected.phase);
    check(`${label}: source exists and raw/canonical SHA are exact`,
      disk?.exists === true && disk?.sha === expected.sha && disk?.canonicalSha === expected.sha);
    check(`${label}: manifest SHA equals the on-disk SHA`,
      pin?.sha256 === expected.sha && pin?.sha256 === local?.sha256);
    check(`${label}: recorded APPLIED with its own imported owner-reviewed marker`,
      pin?.operationalStatus === "APPLIED" && pin?.appliedEvidenceMarker === expected.marker && pin?.appliedEvidenceType === APPLIED_EVIDENCE_TYPE);
    check(`${label}: remote history after apply is exactly ${expected.remoteHistory}`,
      pin?.remoteHistoryCountAfterApply === expected.remoteHistory);
    check(`${label}: applied exactly once and not by the phase that pinned it`,
      pin?.appliedExactlyOnce === true && pin?.appliedByThisPhase === false);
    check(`${label}: absent from the pending list`,
      !pendingPins?.some((record) => record.version === expected.version));
    check(`${label}: claims no un-proven offline remote status`,
      !("remoteVersionStatus" in (pin ?? {})));
  }

  check("the five applied markers are all distinct",
    new Set(POST_ANCHOR_APPLIED.map((m) => m.marker)).size === 5 &&
    new Set((appliedPins ?? []).map((record) => record.appliedEvidenceMarker)).size === 5);
  check("the five remote-history counts are exactly 21, 22, 23, 24, 25 in ascending order",
    same((appliedPins ?? []).map((record) => record.remoteHistoryCountAfterApply), [21, 22, 23, 24, 25]));
  check("G1 still claims no database access of its own", manifest.evidence?.g1PerformsDatabaseAccess === false);
  check("newest local migration is the newest pinned post-anchor migration", newestVersion === POST_ANCHOR_ORDER[POST_ANCHOR_ORDER.length - 1]);
  check("no generic future-migration allowance is granted", manifest.safety?.genericFutureMigrationAllowanceForbidden === true && manifest.safety?.postAnchorMigrationsMustBeExplicitlyPinned === true && manifest.safety?.postAnchorMigrationsRequireOwnStagingGate === true);
  check("S1 evidence file exists", state.s1Exists);
  check("S1 provenance and historical main are exact", state.s1.includes("IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD") && state.s1.includes("Not generated by G1") && state.s1.includes("e511166119703c6044a73d4629a031a6685a3415"));
  check("S1 project and target identity are exact", state.s1.includes("QuickFurno Staging") && state.s1.includes("uckafzuochmbvtiodmcl") && state.s1.includes(TARGET_SHA));
  check("S1 ledger count and prerequisites are exact", state.s1.includes("Remote ledger count: `19`") && state.s1.includes("`20260801110000`: present") && state.s1.includes("`20260801152049`: present") && state.s1.includes("Target `20260803000000`: `0` rows / absent"));
  check("S1 relation and column identity are exact", state.s1.includes("Relation OID: `17826`") && state.s1.includes("attribute number: `5`") && state.s1.includes("Base type: `text`") && state.s1.includes("Nullability: `NOT NULL`") && state.s1.includes("Default: none"));
  check("S1 constraint identity is exact", state.s1.includes("exactly `1`") && state.s1.includes("communication_messages_recipient_type_check") && state.s1.includes("Constraint key: `{5}`") && state.s1.includes("Constraint validated: `true`"));
  const vocabularyBlock = state.s1.match(/The accepted old vocabulary was exactly:\s*([\s\S]*?)\n`lead` was absent\./)?.[1] ?? "";
  const observedVocabulary = [...vocabularyBlock.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
  check("S1 old vocabulary is exactly five values with lead absent", same(observedVocabulary, ["client", "vendor", "admin", "integration", "system"]));
  check("S1 row/RLS/policy/trigger invariants are exact", state.s1.includes("row count: `0`") && state.s1.includes("RLS: enabled") && state.s1.includes("Policies: `0`") && state.s1.includes("User triggers: `0`"));
  check("S1 blockers and simulation result are exact", state.s1.includes("Enum/domain rejection: none") && state.s1.includes("Dependent view/rule blocker: none") && state.s1.includes("Inbound foreign keys: `3`") && state.s1.includes("blockers: none") && state.s1.includes("Migration simulation: PASS"));
  check("S1 carries explicit fresh-preflight warning", state.s1.includes("not a substitute for fresh last-moment preflight") && state.s1.includes("exact deployment set contains only `20260803000000`"));
  check("governance forbids replay and mass repair", state.governance.includes("**No replay:**") && state.governance.includes("**No mass repair:**"));
  check("governance forbids baseline revert and copy", state.governance.includes("**No baseline revert or copy:**"));
  check("governance forbids include-all", state.governance.includes("`--include-all` is forbidden for this lineage") && !/include-all.{0,30}(?:permitted|allowed|authorized)/i.test(state.governance));
  check("governance forbids normal full-repository db push", state.governance.includes("ordinary full-repository `db push` is not an authorized target-deployment mechanism"));
  check("README checksum correction is present", state.readme.includes("G1 checksum provenance correction") && state.readme.includes(BASELINE_SHA) && state.readme.includes("DOCUMENTATION_ERROR_UNREPRODUCIBLE"));
  check("application-report checksum correction is present", state.applicationReport.includes("Checksum provenance correction — QF-MVP-50.2C-S2-G1") && state.applicationReport.includes(BASELINE_SHA) && state.applicationReport.includes("40/40"));
  const correctionText = `${state.readme}\n${state.applicationReport}`;
  check("corrections do not positively bind external bytes to 101ac", !/external[^.\n]{0,160}(?:byte-identical|hash(?:es|ed)? to)[^.\n]{0,100}101ac/i.test(correctionText));
  check("staging-history directory contains no SQL", state.stagingHistoryFiles.every((file) => !file.toLowerCase().endsWith(".sql")));
  const credentialPatterns = [
    /sbp_[A-Za-z0-9_-]{8,}/,
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    /SUPABASE_ACCESS_TOKEN\s*[:=]\s*["']?[A-Za-z0-9_-]{8,}/i,
    /SUPABASE_DB_PASSWORD\s*[:=]\s*["']?\S{8,}/i,
    /postgres(?:ql)?:\/\//i,
  ];
  check("governance artifacts contain no credential-like values", state.governanceFiles.every(({ text }) => credentialPatterns.every((pattern) => !pattern.test(text))));
  check("manifest and documents authorize no production deployment", manifest.scope?.productionImplication === false && !state.governanceFiles.some(({ text }) => /production deployment (?:is )?(?:authorized|approved)/i.test(text)));
  check("anchor SQL remains unchanged by exact hash", state.targetSha === TARGET_SHA);
  check("package script is exact", state.packageJson.scripts?.["test:mvp:50-2c-s2-g1"] === "node scripts/mvp/staging/validate-qf-mvp-50-2c-s2-g1.mjs");
  const expectedCiBlock = /- name: QF-MVP-50\.2C validator\s+run: npm run test:mvp:50-2c\s+- name: QF-MVP-50\.2C-S2-G1 staging history governance\s+run: npm run test:mvp:50-2c-s2-g1\s+- name: QF-MVP-50\.2D validator\s+run: npm run test:mvp:50-2d/;
  check("CI G1 step follows 50.2C and is immediately followed by the 50.2D gate", expectedCiBlock.test(state.workflow));
  check("CI exact-head checkout remains", state.workflow.includes("ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}") && state.workflow.includes("fetch-depth: 0") && state.workflow.includes("Verify exact checked-out SHA"));
  check("CI Node 24 and install remain", state.workflow.includes("node-version: '24'") && state.workflow.includes("run: npm ci"));
  const existingGates = ["QF-MVP-40.4 template catalogue", "QF-MVP-40.10A Meta template contract", "QF-MVP-40.10B Wave 1 readiness", "QF-MVP-40.11 inactive mapping readiness", "QF-MVP-40.12-R1 business template bindings", "QF-MVP-50.1A validator", "QF-MVP-50.1B validator", "QF-MVP-50.1C validator", "QF-MVP-50.2A validator", "QF-MVP-50.2B validator", "QF-MVP-50.2C validator", "QF-MVP-50.2D validator", "Typecheck", "Build"];
  check("all existing CI gates remain", existingGates.every((gate) => state.workflow.includes(`- name: ${gate}`)));
  check("CI adds no secrets, Supabase command, database command, or deployment", !state.workflow.includes("${{ secrets.") && !/^\s*(?:run:\s*)?(?:npx\s+)?supabase\s+/mi.test(state.workflow) && !/\bdb push\b/i.test(state.workflow) && !/^\s*run:.*\bdeploy\b/mi.test(state.workflow));
  check("manifest safety rules are all fail closed", manifest.safety?.baselineMustRemainOutsideMigrations === true && manifest.safety?.preBaselineReplayForbidden === true && manifest.safety?.preBaselineMassRepairAsAppliedForbidden === true && manifest.safety?.baselineRemoteRowRevertForbidden === true && manifest.safety?.includeAllForbiddenForThisLineage === true && manifest.safety?.ordinaryFullRepositoryDbPushAuthorizedForTarget === false && manifest.safety?.targetRequiresFreshPreflight === true && manifest.safety?.targetRequiresExactOneTargetDryRun === true && manifest.safety?.targetRequiresIsolatedVersionPreservingDesign === true && manifest.safety?.targetRequiresIndependentPostApplyVerification === true);
  check("manifest evidence records accepted L3 and imported S1", manifest.evidence?.acceptedL3Decision === "L3_DESIGN_A" && manifest.evidence?.importedS1EvidenceType === "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD" && manifest.evidence?.importedS1EvidencePath === S1_PATH && manifest.evidence?.g1PerformsDatabaseAccess === false);

  return { results, failures: results.filter((result) => !result.passed) };
}

function runMutants(pristineState) {
  const cases = [
    ["baseline SHA changed", (state) => { state.baselineSha = "0".repeat(64); }],
    ["920a status restored as valid", (state) => { state.manifest.baseline.historicalDocumentedShaStatus = "VALID"; }],
    ["one pre-baseline version omitted", (state) => { state.manifest.preBaselineChain.records.pop(); }],
    ["one pre-baseline SHA changed", (state) => { state.manifest.preBaselineChain.records[0].sha256 = "f".repeat(64); }],
    ["anchor inserted into postBaselineApplied", (state) => { state.manifest.postBaselineApplied.push({ version: TARGET_VERSION }); }],
    ["anchor SHA changed", (state) => { state.manifest.appliedAnchor.sha256 = "a".repeat(64); }],
    ["anchor demoted back to PENDING without evidence", (state) => { state.manifest.appliedAnchor.operationalStatus = "PENDING"; }],
    ["anchor applied-evidence marker forged", (state) => { state.manifest.appliedAnchor.appliedEvidenceMarker = "QF_MVP_FAKE_MARKER"; }],
    ["newer fake migration added", (state) => { state.migrations.push({ filename: "20260901000000_fake.sql", version: "20260901000000", name: "fake", sha256: "b".repeat(64), malformed: false }); }],
    // --- QF-MVP-50.2E-S2-G1 post-anchor pin strength: BOTH APPLIED ------------
    ["50.2E left PENDING", (state) => {
      const [e] = state.manifest.appliedPostAnchorMigrations.splice(1, 1);
      state.manifest.pendingPostAnchorMigrations.push({ ...e, operationalStatus: "PENDING", remoteVersionStatus: "NOT_PROVEN_OFFLINE" });
    }],
    ["50.2E applied but marker missing", (state) => { delete state.manifest.appliedPostAnchorMigrations[1].appliedEvidenceMarker; }],
    ["50.2E marker forged", (state) => { state.manifest.appliedPostAnchorMigrations[1].appliedEvidenceMarker = "QF_MVP_FAKE_50_2E_MARKER"; }],
    ["50.2E marker copied from 50.2D", (state) => { state.manifest.appliedPostAnchorMigrations[1].appliedEvidenceMarker = POST_ANCHOR_APPLIED[0].marker; }],
    ["50.2E remote history 21 instead of 22", (state) => { state.manifest.appliedPostAnchorMigrations[1].remoteHistoryCountAfterApply = 21; }],
    ["50.2E remote history 23", (state) => { state.manifest.appliedPostAnchorMigrations[1].remoteHistoryCountAfterApply = 23; }],
    ["50.2E manifest SHA drift", (state) => { state.manifest.appliedPostAnchorMigrations[1].sha256 = "e".repeat(64); }],
    ["50.2E on-disk SHA drift", (state) => { state.postAnchorOnDisk["20260805000000"].sha = "d".repeat(64); state.postAnchorOnDisk["20260805000000"].canonicalSha = "d".repeat(64); }],
    ["50.2E appliedExactlyOnce false", (state) => { state.manifest.appliedPostAnchorMigrations[1].appliedExactlyOnce = false; }],
    ["50.2E evidence type changed", (state) => { state.manifest.appliedPostAnchorMigrations[1].appliedEvidenceType = "SELF_ASSERTED"; }],
    ["50.2E claimed applied by this source phase", (state) => { state.manifest.appliedPostAnchorMigrations[1].appliedByThisPhase = true; }],
    ["50.2E fabricated offline remote status field", (state) => { state.manifest.appliedPostAnchorMigrations[1].remoteVersionStatus = "PRESENT"; }],
    ["50.2E migration renamed", (state) => {
      const record = state.migrations.find((m) => m.version === "20260805000000");
      record.name = "qf_mvp_50_2e_renamed";
      record.filename = "20260805000000_qf_mvp_50_2e_renamed.sql";
    }],
    ["50.2E migration missing from disk", (state) => {
      state.migrations = state.migrations.filter((m) => m.version !== "20260805000000");
      state.postAnchorOnDisk["20260805000000"].exists = false;
    }],
    ["a new pending entry silently added", (state) => { state.manifest.pendingPostAnchorMigrations.push({ version: "20260812000000", name: "ninth", path: "supabase/migrations/20260812000000_ninth.sql", sha256: "f".repeat(64), phase: "QF-MVP-50.2F", operationalStatus: "PENDING", remoteVersionStatus: "NOT_PROVEN_OFFLINE", requiresSeparateStagingDeploymentGate: true, appliedByThisPhase: false }); }],
    ["the pending list key deleted entirely instead of emptied", (state) => { delete state.manifest.pendingPostAnchorMigrations; }],
    ["a ninth applied post-anchor migration", (state) => { state.manifest.appliedPostAnchorMigrations.push(clone(state.manifest.appliedPostAnchorMigrations[2])); }],
    ["a ninth post-anchor migration on disk", (state) => { state.migrations.push({ filename: "20260812000000_ninth.sql", version: "20260812000000", name: "ninth", sha256: "c".repeat(64), malformed: false }); }],

    // --- QF-MVP-50.2-R2-APPLIED-TRUTH: the newly imported APPLIED record ------
    ["R2 producer left PENDING", (state) => {
      const r2 = state.manifest.appliedPostAnchorMigrations.pop();
      state.manifest.pendingPostAnchorMigrations.push({
        version: r2.version, name: r2.name, path: r2.path, sha256: r2.sha256, phase: r2.phase,
        operationalStatus: "PENDING", remoteVersionStatus: "NOT_PROVEN_OFFLINE",
        requiresSeparateStagingDeploymentGate: true, appliedByThisPhase: false,
      });
    }],
    ["R2 producer demoted to PENDING in place", (state) => { state.manifest.appliedPostAnchorMigrations[2].operationalStatus = "PENDING"; }],
    ["R2 remote history 22 instead of 23", (state) => { state.manifest.appliedPostAnchorMigrations[2].remoteHistoryCountAfterApply = 22; }],
    ["R2 remote history 24 instead of 23", (state) => { state.manifest.appliedPostAnchorMigrations[2].remoteHistoryCountAfterApply = 24; }],
    ["R2 remote history missing", (state) => { delete state.manifest.appliedPostAnchorMigrations[2].remoteHistoryCountAfterApply; }],
    ["R2 marker missing", (state) => { delete state.manifest.appliedPostAnchorMigrations[2].appliedEvidenceMarker; }],
    ["R2 marker forged", (state) => { state.manifest.appliedPostAnchorMigrations[2].appliedEvidenceMarker = "QF_MVP_FAKE_R2_MARKER"; }],
    ["R2 marker copied from 50.2E", (state) => { state.manifest.appliedPostAnchorMigrations[2].appliedEvidenceMarker = POST_ANCHOR_APPLIED[1].marker; }],
    ["R2 evidence type self-asserted", (state) => { state.manifest.appliedPostAnchorMigrations[2].appliedEvidenceType = "SELF_ASSERTED"; }],
    ["R2 claimed applied by this source phase", (state) => { state.manifest.appliedPostAnchorMigrations[2].appliedByThisPhase = true; }],
    ["R2 appliedExactlyOnce false", (state) => { state.manifest.appliedPostAnchorMigrations[2].appliedExactlyOnce = false; }],
    ["R2 manifest SHA drift", (state) => { state.manifest.appliedPostAnchorMigrations[2].sha256 = "9".repeat(64); }],
    ["R2 on-disk SHA drift", (state) => { state.postAnchorOnDisk["20260806000000"].sha = "9".repeat(64); state.postAnchorOnDisk["20260806000000"].canonicalSha = "9".repeat(64); }],
    ["R2 fabricated offline remote status field", (state) => { state.manifest.appliedPostAnchorMigrations[2].remoteVersionStatus = "PRESENT"; }],
    ["R2 migration renamed", (state) => {
      const record = state.migrations.find((m) => m.version === "20260806000000");
      record.name = "qf_mvp_50_2_renamed_producer";
      record.filename = "20260806000000_qf_mvp_50_2_renamed_producer.sql";
    }],
    ["R2 migration missing from disk", (state) => {
      state.migrations = state.migrations.filter((m) => m.version !== "20260806000000");
      state.postAnchorOnDisk["20260806000000"].exists = false;
    }],
    ["R2 also listed as pending", (state) => { state.manifest.pendingPostAnchorMigrations.push(clone(state.manifest.appliedPostAnchorMigrations[2])); }],

    // --- QF-MVP-50.2-EXECUTE-V1-REPAIR: the 070 applied record ---------------
    ["070 execute repair left PENDING", (state) => {
      const [e] = state.manifest.appliedPostAnchorMigrations.splice(3, 1);
      state.manifest.pendingPostAnchorMigrations.push({ ...e, operationalStatus: "PENDING", remoteVersionStatus: "NOT_PROVEN_OFFLINE" });
    }],
    ["070 demoted to PENDING in place", (state) => { state.manifest.appliedPostAnchorMigrations[3].operationalStatus = "PENDING"; }],
    ["070 remote history 23 instead of 24", (state) => { state.manifest.appliedPostAnchorMigrations[3].remoteHistoryCountAfterApply = 23; }],
    ["070 remote history 25 instead of 24", (state) => { state.manifest.appliedPostAnchorMigrations[3].remoteHistoryCountAfterApply = 25; }],
    ["070 marker missing", (state) => { delete state.manifest.appliedPostAnchorMigrations[3].appliedEvidenceMarker; }],
    ["070 marker forged", (state) => { state.manifest.appliedPostAnchorMigrations[3].appliedEvidenceMarker = "QF_MVP_FAKE_070_MARKER"; }],
    ["070 evidence type self-asserted", (state) => { state.manifest.appliedPostAnchorMigrations[3].appliedEvidenceType = "SELF_ASSERTED"; }],
    ["070 claimed applied by this source phase", (state) => { state.manifest.appliedPostAnchorMigrations[3].appliedByThisPhase = true; }],
    ["070 appliedExactlyOnce false", (state) => { state.manifest.appliedPostAnchorMigrations[3].appliedExactlyOnce = false; }],
    ["070 manifest SHA drift", (state) => { state.manifest.appliedPostAnchorMigrations[3].sha256 = "7".repeat(64); }],
    ["070 on-disk SHA drift", (state) => { state.postAnchorOnDisk["20260807000000"].sha = "7".repeat(64); state.postAnchorOnDisk["20260807000000"].canonicalSha = "7".repeat(64); }],
    ["070 fabricated offline remote status field", (state) => { state.manifest.appliedPostAnchorMigrations[3].remoteVersionStatus = "PRESENT"; }],
    ["070 migration missing from disk", (state) => {
      state.migrations = state.migrations.filter((m) => m.version !== "20260807000000");
      state.postAnchorOnDisk["20260807000000"].exists = false;
    }],

    // --- QF-MVP-50.2-FRESH-CLAIM-WEDGE-REPAIR: the 080 applied record --------
    ["080 wedge repair left PENDING", (state) => {
      const [e] = state.manifest.appliedPostAnchorMigrations.splice(4, 1);
      state.manifest.pendingPostAnchorMigrations.push({ ...e, operationalStatus: "PENDING", remoteVersionStatus: "NOT_PROVEN_OFFLINE" });
    }],
    ["080 demoted to PENDING in place", (state) => { state.manifest.appliedPostAnchorMigrations[4].operationalStatus = "PENDING"; }],
    ["080 remote history 24 instead of 25", (state) => { state.manifest.appliedPostAnchorMigrations[4].remoteHistoryCountAfterApply = 24; }],
    ["080 remote history 26 instead of 25", (state) => { state.manifest.appliedPostAnchorMigrations[4].remoteHistoryCountAfterApply = 26; }],
    ["080 marker missing", (state) => { delete state.manifest.appliedPostAnchorMigrations[4].appliedEvidenceMarker; }],
    ["080 marker forged", (state) => { state.manifest.appliedPostAnchorMigrations[4].appliedEvidenceMarker = "QF_MVP_FAKE_080_MARKER"; }],
    ["080 evidence type self-asserted", (state) => { state.manifest.appliedPostAnchorMigrations[4].appliedEvidenceType = "SELF_ASSERTED"; }],
    ["080 claimed applied by this source phase", (state) => { state.manifest.appliedPostAnchorMigrations[4].appliedByThisPhase = true; }],
    ["080 appliedExactlyOnce false", (state) => { state.manifest.appliedPostAnchorMigrations[4].appliedExactlyOnce = false; }],
    ["080 manifest SHA drift", (state) => { state.manifest.appliedPostAnchorMigrations[4].sha256 = "8".repeat(64); }],
    ["080 on-disk SHA drift", (state) => { state.postAnchorOnDisk["20260808000000"].sha = "8".repeat(64); state.postAnchorOnDisk["20260808000000"].canonicalSha = "8".repeat(64); }],
    ["080 fabricated offline remote status field", (state) => { state.manifest.appliedPostAnchorMigrations[4].remoteVersionStatus = "PRESENT"; }],
    ["080 migration missing from disk", (state) => {
      state.migrations = state.migrations.filter((m) => m.version !== "20260808000000");
      state.postAnchorOnDisk["20260808000000"].exists = false;
    }],
    ["50.2D demoted back to PENDING", (state) => { state.manifest.appliedPostAnchorMigrations[0].operationalStatus = "PENDING"; }],
    ["50.2D marker forged", (state) => { state.manifest.appliedPostAnchorMigrations[0].appliedEvidenceMarker = "QF_MVP_FAKE_APPLIED_MARKER"; }],
    ["50.2D remote history changed from 21", (state) => { state.manifest.appliedPostAnchorMigrations[0].remoteHistoryCountAfterApply = 20; }],
    ["50.2D manifest SHA changed", (state) => { state.manifest.appliedPostAnchorMigrations[0].sha256 = "a".repeat(64); }],
    ["50.2D on-disk SHA drift", (state) => { state.postAnchorOnDisk["20260804000000"].sha = "b".repeat(64); state.postAnchorOnDisk["20260804000000"].canonicalSha = "b".repeat(64); }],
    ["50.2D missing from disk", (state) => {
      state.migrations = state.migrations.filter((m) => m.version !== "20260804000000");
      state.postAnchorOnDisk["20260804000000"].exists = false;
    }],
    ["applied post-anchor list emptied", (state) => { state.manifest.appliedPostAnchorMigrations = []; }],
    ["an applied post-anchor also listed as pending", (state) => { state.manifest.pendingPostAnchorMigrations.push(clone(state.manifest.appliedPostAnchorMigrations[1])); }],
    ["post-anchor order swapped", (state) => { state.manifest.appliedPostAnchorMigrations.reverse(); }],
    ["post-anchor count understated", (state) => { state.manifest.appliedAnchor.postAnchorMigrationCount = 1; }],
    ["generic future-migration allowance granted", (state) => { state.manifest.safety.genericFutureMigrationAllowanceForbidden = false; }],
    ["CI 50.2D gate removed", (state) => { state.workflow = state.workflow.replace(/\n\s+- name: QF-MVP-50\.2D validator\s+run: npm run test:mvp:50-2d\s*/m, "\n"); }],
    ["baseline copied into migrations", (state) => { state.migrations.push({ filename: `${BASELINE_VERSION}_qf_mvp_staging_baseline_269c9265.sql`, version: BASELINE_VERSION, name: "qf_mvp_staging_baseline_269c9265", sha256: BASELINE_SHA, malformed: false }); }],
    ["one resolved remote digest changed", (state) => { state.manifest.postBaselineApplied.find((record) => record.version === "20260728001600").remoteOrderedStatementDigestSha256 = "c".repeat(64); }],
    ["deployment blocker semantics corrupted", (state) => { state.manifest.postBaselineApplied[0].deploymentBlocker = true; }],
    ["S1 evidence path removed", (state) => { state.manifest.appliedAnchor.preflightEvidencePath = ""; }],
    ["S1 old vocabulary includes lead", (state) => { state.s1 = state.s1.replace("\n`lead` was absent.", "\n- `lead`\n\n`lead` was absent."); }],
    ["governance permits include-all", (state) => { state.governance = state.governance.replace("`--include-all` is forbidden for this lineage", "`--include-all` is permitted for this lineage"); }],
    ["CI G1 step removed", (state) => { state.workflow = state.workflow.replace(/\n\s+- name: QF-MVP-50\.2C-S2-G1 staging history governance\s+run: npm run test:mvp:50-2c-s2-g1\s*/m, "\n"); }],
    ["migration hash policy canonicalization changed to raw bytes", (state) => { state.manifest.migrationSourceHashPolicy.canonicalization = "RAW_BYTES"; }],
    ["one canonical pre-baseline SHA changed to raw CRLF hash", (state) => {
      state.manifest.preBaselineChain.records.find((record) => record.version === "20260620000003").sha256 = "e8c7f0f7eec2fd2108189fc462deeb70025c88f2ef2ae760dcc83b77451d5fb9";
    }],
  ];

  return cases.map(([name, mutate]) => {
    const mutant = clone(pristineState);
    mutate(mutant);
    const rejected = validateState(mutant).failures.length > 0;
    return { name, rejected };
  });
}

const state = loadState();
const validation = validateState(state);
const mutants = runMutants(state);

for (const [index, result] of validation.results.entries()) {
  const detail = result.detail ? ` (${result.detail})` : "";
  console.log(`${result.passed ? "PASS" : "FAIL"} ${String(index + 1).padStart(2, "0")} ${result.name}${detail}`);
}
for (const [index, mutant] of mutants.entries()) {
  console.log(`${mutant.rejected ? "PASS" : "FAIL"} M${String(index + 1).padStart(2, "0")} reject mutant: ${mutant.name}`);
}

const mutantFailures = mutants.filter((mutant) => !mutant.rejected);
console.log(`SUMMARY assertions=${validation.results.length} passed=${validation.results.length - validation.failures.length} failed=${validation.failures.length} mutants=${mutants.length} mutants_rejected=${mutants.length - mutantFailures.length}`);

if (validation.failures.length || mutantFailures.length) process.exit(1);
