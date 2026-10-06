#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [contractText, recoverySchema, runbook, pitr, objects, phase15, phase16] = await Promise.all([
  read("contracts/qfj-phase17-dr-v1.json"),
  read("contracts/qfj-phase17-recovery-manifest-v1.schema.json"),
  read("docs/operations/phase17-backup-pitr-dr.md"),
  read("scripts/scale/certify-phase17-postgres-pitr.mjs"),
  read("scripts/scale/certify-phase17-object-restore.mjs"),
  read("scripts/scale/validate-phase15-cicd.mjs"),
  read("scripts/scale/validate-phase16-multihost-ha.mjs"),
]);

const c = JSON.parse(contractText);
const checks = [];
const add = (name, ok) => checks.push([name, Boolean(ok)]);

add("canonical Phase17 DR contract", c.contract === "qfj.dr.phase17.v1");
add("single authoritative write region is locked",
  c.strategy.authoritativeWriteRegions === 1 &&
  c.strategy.activeActiveTransactionalWrites === false);
add("production restore requires human approval",
  c.strategy.productionRestoreRequiresHumanApproval === true);
add("transactional RPO target is two minutes",
  c.postgres.productionTransactionRpoSeconds === 120);
add("transactional RTO target is one hour",
  c.postgres.productionTransactionRtoSeconds === 3600);
add("PITR is required before claiming production RPO",
  c.postgres.managedPitrRequiredToClaimTarget === true);
add("provider-independent logical backup is retained",
  c.postgres.logicalBackupIntervalHours <= 24 &&
  c.postgres.logicalBackupRetentionDays >= 30 &&
  c.postgres.logicalBackupOffsiteRequired === true);
add("future logical replication is explicitly recoverable",
  c.postgres.replicationSlotsRecreatedAfterRestore === true &&
  c.postgres.walRetentionAndSlotLagMustBeMonitoredBeforeCdc === true);
add("source object versioning is never assumed",
  c.objects.sourceProviderVersioningAssumed === false);
add("external object backup is versioned and checksum bound",
  c.objects.externalVersionedBackupRequired === true &&
  c.objects.contentHashManifestRequired === true &&
  c.objects.independentRestoreDrillRequired === true);
add("object RPO/RTO targets are bounded",
  c.objects.recoveryPointObjectiveSeconds <= 3600 &&
  c.objects.recoveryTimeObjectiveSeconds <= 14400);
add("Git/IaC and image digests are recovery authorities",
  c.sourceAndConfig.gitRemoteIsRecoverySource === true &&
  c.sourceAndConfig.hostLocalConfigAuthoritative === false &&
  c.sourceAndConfig.recoveryManifestPinsSourceShas === true &&
  c.sourceAndConfig.recoveryManifestPinsImageDigests === true);
add("recovery manifest schema pins sources, image digests and restore points",
  recoverySchema.includes('"const": "qfj.dr.recovery.phase17.v1"') &&
  recoverySchema.includes('"sourceSha"') &&
  recoverySchema.includes('"imageDigest"') &&
  recoverySchema.includes('"recoveryTargetAt"') &&
  recoverySchema.includes('"snapshotId"') &&
  !recoverySchema.toLowerCase().includes('"secretvalue"'));
add("signed image retention protects active rollback and DR releases",
  c.images.immutableDigestRequired === true &&
  c.images.signatureVerificationRequired === true &&
  c.images.minimumRetainedSignedReleases >= 10 &&
  c.images.minimumRetentionDays >= 90 &&
  c.images.activeOrRollbackReferencedImagesMustNeverBeGarbageCollected === true);
add("plaintext secret backup is forbidden",
  c.secrets.plaintextBackupForbidden === true &&
  c.secrets.valuesMustBeReissuedOrRotatedDuringRecovery === true);
add("AGNI lost replay state fails safe",
  c.agni.lostHostReplayStateMustNotBeBlindlyTrusted === true &&
  c.agni.actionAuthorityDisabledUntilOldCapabilitiesExpireOrKeysRotate === true &&
  c.agni.maximumCapabilityTtlSeconds === 600 &&
  c.agni.productionAuthorityAfterRestore === "READ_ONLY_RECOMMEND");
add("Phase17 makes no production mutation or cutover",
  c.phase17Safety.productionRestore === false &&
  c.phase17Safety.productionDatabaseMutation === false &&
  c.phase17Safety.productionTrafficCutover === false &&
  c.phase17Safety.productionSecretRotation === false &&
  c.phase17Safety.newAgniAuthority === false);

add("PITR certifier uses pinned PostgreSQL image and WAL archive",
  pitr.includes('postgres:16.4-bookworm') &&
  pitr.includes("archive_mode=on") &&
  pitr.includes("archive_command=") &&
  pitr.includes("pg_basebackup") &&
  pitr.includes("recovery_target_time"));
add("PITR certifier also proves logical backup restore",
  pitr.includes("pg_dump") &&
  pitr.includes("pg_restore") &&
  pitr.includes("PHASE17_LOGICAL_RESTORE_INCOMPLETE"));
add("object certifier uses immutable SHA-256 snapshot identity",
  objects.includes("createHash") &&
  objects.includes("snapshotId") &&
  objects.includes("PHASE17_SNAPSHOT_OVERWRITE_REFUSED") &&
  objects.includes("PHASE17_OBJECT_RESTORE_HASH_MISMATCH"));
add("runbook separates DB and Storage recovery",
  runbook.includes("Supabase Storage recovery") &&
  runbook.includes("does not provide bucket versioning") &&
  runbook.includes("object restore is tested independently"));
add("runbook forbids plaintext secret archives",
  runbook.includes("Plaintext secret backup") &&
  runbook.includes("reissue or rotate provider credentials"));
add("runbook preserves Phase15/16 recovery controls",
  runbook.includes("Phase 13 external-secret boundaries") &&
  runbook.includes("Phase 16 provider-neutral host bootstrap") &&
  runbook.includes("Cosign signature"));
add("prior immutable delivery and HA validators remain present",
  phase15.includes("release artifacts are digest-only") &&
  phase16.includes("production target requires an external redundant load balancer"));

for (const [name, ok] of checks) console.log((ok ? "PASS" : "FAIL") + " " + name);
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("QuickFurno Phase17 DR contract failed: " + failed.length + " check(s)");
  process.exit(1);
}
console.log("QuickFurno Phase17 DR contract PASS (" + checks.length + "/" + checks.length + ")");
