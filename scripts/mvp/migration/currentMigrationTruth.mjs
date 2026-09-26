import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MANIFEST_PATH = path.join(ROOT, "supabase/staging-history/qf-mvp-staging-history-manifest.json");
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const canonicalBytes = (buffer) =>
  Buffer.from(buffer.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");

export function getCurrentMigrationTruth() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const current = manifest.currentPhase1Reconciliation;
  if (!current || current.phase !== "QF-PHASE1-MIGRATION-RECONCILIATION-20260926") {
    throw new Error("current Phase-1 migration reconciliation is missing");
  }
  return { manifest, current };
}

export function validateCurrentMigrationTree() {
  const { manifest, current } = getCurrentMigrationTruth();
  const source = current.source;
  const canonical = source.canonicalMigrations ?? [];
  const excluded = source.worktreeInProgressExcludedMigrations ?? [];
  const expectedFiles = [...canonical.map((x) => x.filename), ...excluded.map((x) => x.filename)].sort();
  const actualFiles = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const checks = [];
  const check = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });
  check("manifest filesystem count matches", source.filesystemMigrationCount === actualFiles.length,
    `manifest=${source.filesystemMigrationCount} actual=${actualFiles.length}`);
  check("manifest canonical count matches records", source.canonicalMigrationCount === canonical.length);
  check("exact migration filename set matches manifest", JSON.stringify(actualFiles) === JSON.stringify(expectedFiles));
  const allVersions = actualFiles.map((name) => /^(\d{14})_.+\.sql$/.exec(name)?.[1] ?? null);
  check("all migration filenames are well formed", allVersions.every(Boolean));
  check("all migration versions are unique", new Set(allVersions).size === allVersions.length);
  check("canonical and excluded sets do not overlap",
    !canonical.some((c) => excluded.some((e) => e.filename === c.filename || e.version === c.version)));
  for (const record of canonical) {
    const bytes = readFileSync(path.join(MIGRATIONS_DIR, record.filename));
    check(`canonical source hash ${record.version}`, sha256(canonicalBytes(bytes)) === record.sha256, record.filename);
  }
  check("excluded worktree migrations are deployment-forbidden",
    excluded.length === 3 && excluded.every((x) => x.deploymentAuthorized === false));
  const retired = current.retiredNeverAppliedSourceVersions ?? [];
  check("retired unapplied versions are absent from runnable migration directory",
    retired.every((x) => !allVersions.includes(x.version)));
  const forward = current.phase1ForwardDeployments ?? [];
  check("both Phase-1 forward deployments are canonical and applied to both environments",
    forward.length === 2 && forward.every((x) =>
      canonical.some((c) => c.version === x.version) &&
      x.appliedToStaging === true && x.appliedToProduction === true &&
      x.databaseRepairUsed === false));
  const phase2 = manifest.currentPhase2StagingParity;
  const latestStagingHistoryCount = phase2?.stagingHistory?.historyCount
    ?? current.remoteHistory?.staging?.historyCount;
  check("remote history reconciliation snapshots are internally consistent",
    Number.isInteger(latestStagingHistoryCount) &&
    latestStagingHistoryCount >= current.remoteHistory?.staging?.historyCount &&
    current.remoteHistory?.production?.historyCount > 0 &&
    (phase2 == null || phase2.productionReadOnly === true));
  if (phase2) {
    check("Phase-2 staging parity record is complete",
      phase2.status === "CORE_PRODUCTION_REHEARSAL_PARITY_COMPLETE" &&
      phase2.stagingHistory?.parityMigrations?.length === 7 &&
      phase2.coreParity?.canonicalFunctionFingerprintsMatchProduction === true &&
      phase2.coreParity?.canonicalTableShapesMatchProduction === true &&
      phase2.coreParity?.rlsPolicyDefinitionsMatchProduction === true);
    check("Phase-2 staging external-send safety remains closed",
      phase2.safety?.whatsappOutboundEnabled === false &&
      phase2.safety?.whatsappWebhookProcessingEnabled === false &&
      phase2.safety?.productionWritesPerformed === false &&
      phase2.safety?.externalMessagesSent === false);
  }
  check("migration repair/include-all/full-repo push were not used",
    current.safety?.migrationRepairUsed === false &&
    current.safety?.includeAllUsed === false &&
    current.safety?.fullRepositoryDbPushUsed === false);
  return {
    ok: checks.every((x) => x.ok),
    checks,
    canonicalCount: canonical.length,
    excludedCount: excluded.length,
    totalCount: actualFiles.length,
    manifest,
    current,
  };
}

export const CURRENT_MIGRATION_TREE = validateCurrentMigrationTree();
