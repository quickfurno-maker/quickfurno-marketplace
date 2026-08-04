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
const TARGET_VERSION = "20260803000000";
const TARGET_SHA = "77d2bb1162e0522b061f36df787d94c2dad4f0ceeff3e4a07c8946cd4e1d56ca";

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
      sha256: sha256(bytes),
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
  check("direct migration count is 87", state.migrations.length === 87, `actual=${state.migrations.length}`);
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
  check("target manifest identity is exact", manifest.pendingTarget?.version === TARGET_VERSION && manifest.pendingTarget?.name === "qf_mvp_50_2c_lead_communication_recipient" && manifest.pendingTarget?.path === TARGET_PATH);
  check("target source exists and SHA is exact", state.targetExists && state.targetSha === TARGET_SHA && manifest.pendingTarget?.sha256 === TARGET_SHA);
  check("target is newest local migration", newestVersion === TARGET_VERSION);
  check("target has no newer local migration", validMigrations.filter((record) => record.version > TARGET_VERSION).length === 0 && manifest.pendingTarget?.newerLocalMigrationCount === 0);
  check("target operational status is PENDING", manifest.pendingTarget?.operationalStatus === "PENDING" && manifest.pendingTarget?.remoteVersionStatusAtL3 === "ABSENT");
  check("target documentation points to imported S1 evidence", manifest.pendingTarget?.documentationStatus === "SOURCE_CONTROLLED_PREFLIGHT_IMPORTED_BY_G1" && manifest.pendingTarget?.preflightEvidencePath === S1_PATH);
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
  check("target SQL remains unchanged by exact hash", state.targetSha === TARGET_SHA);
  check("package script is exact", state.packageJson.scripts?.["test:mvp:50-2c-s2-g1"] === "node scripts/mvp/staging/validate-qf-mvp-50-2c-s2-g1.mjs");
  const expectedCiBlock = /- name: QF-MVP-50\.2C validator\s+run: npm run test:mvp:50-2c\s+- name: QF-MVP-50\.2C-S2-G1 staging history governance\s+run: npm run test:mvp:50-2c-s2-g1/;
  check("CI G1 step is exact and immediately follows 50.2C", expectedCiBlock.test(state.workflow));
  check("CI exact-head checkout remains", state.workflow.includes("ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}") && state.workflow.includes("fetch-depth: 0") && state.workflow.includes("Verify exact checked-out SHA"));
  check("CI Node 24 and install remain", state.workflow.includes("node-version: '24'") && state.workflow.includes("run: npm ci"));
  const existingGates = ["QF-MVP-40.4 template catalogue", "QF-MVP-40.10A Meta template contract", "QF-MVP-40.10B Wave 1 readiness", "QF-MVP-40.11 inactive mapping readiness", "QF-MVP-40.12-R1 business template bindings", "QF-MVP-50.1A validator", "QF-MVP-50.1B validator", "QF-MVP-50.1C validator", "QF-MVP-50.2A validator", "QF-MVP-50.2B validator", "QF-MVP-50.2C validator", "Typecheck", "Build"];
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
    ["target inserted into postBaselineApplied", (state) => { state.manifest.postBaselineApplied.push({ version: TARGET_VERSION }); }],
    ["target SHA changed", (state) => { state.manifest.pendingTarget.sha256 = "a".repeat(64); }],
    ["newer fake migration added", (state) => { state.migrations.push({ filename: "20260901000000_fake.sql", version: "20260901000000", name: "fake", sha256: "b".repeat(64), malformed: false }); }],
    ["baseline copied into migrations", (state) => { state.migrations.push({ filename: `${BASELINE_VERSION}_qf_mvp_staging_baseline_269c9265.sql`, version: BASELINE_VERSION, name: "qf_mvp_staging_baseline_269c9265", sha256: BASELINE_SHA, malformed: false }); }],
    ["one resolved remote digest changed", (state) => { state.manifest.postBaselineApplied.find((record) => record.version === "20260728001600").remoteOrderedStatementDigestSha256 = "c".repeat(64); }],
    ["deployment blocker semantics corrupted", (state) => { state.manifest.postBaselineApplied[0].deploymentBlocker = true; }],
    ["S1 evidence path removed", (state) => { state.manifest.pendingTarget.preflightEvidencePath = ""; }],
    ["S1 old vocabulary includes lead", (state) => { state.s1 = state.s1.replace("\n`lead` was absent.", "\n- `lead`\n\n`lead` was absent."); }],
    ["governance permits include-all", (state) => { state.governance = state.governance.replace("`--include-all` is forbidden for this lineage", "`--include-all` is permitted for this lineage"); }],
    ["CI G1 step removed", (state) => { state.workflow = state.workflow.replace(/\n\s+- name: QF-MVP-50\.2C-S2-G1 staging history governance\s+run: npm run test:mvp:50-2c-s2-g1\s*/m, "\n"); }],
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
