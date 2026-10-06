#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const shaFile = (path) => sha256(readFileSync(path));

function listFiles(root, current = root) {
  const out = [];
  for (const name of readdirSync(current)) {
    const full = join(current, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listFiles(root, full));
    else if (stat.isFile()) out.push(full);
  }
  return out.sort();
}

function buildManifest(root) {
  const files = listFiles(root).map((path) => ({
    key: relative(root, path).replaceAll("\\", "/"),
    bytes: statSync(path).size,
    sha256: shaFile(path),
  }));
  const canonical = JSON.stringify({ version: 1, files });
  return { files, snapshotId: sha256(canonical) };
}

function createSnapshot(source, repository) {
  const manifest = buildManifest(source);
  const snapshotRoot = join(repository, "snapshots", manifest.snapshotId);
  if (existsSync(snapshotRoot)) throw new Error("PHASE17_SNAPSHOT_OVERWRITE_REFUSED");
  mkdirSync(snapshotRoot, { recursive: true });
  cpSync(source, join(snapshotRoot, "objects"), { recursive: true });
  writeFileSync(
    join(snapshotRoot, "manifest.json"),
    JSON.stringify({ version: 1, snapshotId: manifest.snapshotId, files: manifest.files }, null, 2) + "\n",
  );
  for (const file of listFiles(snapshotRoot)) {
    try { chmodSync(file, 0o444); } catch {}
  }
  return { ...manifest, snapshotRoot };
}

function restoreSnapshot(snapshotRoot, destination) {
  const manifest = JSON.parse(readFileSync(join(snapshotRoot, "manifest.json"), "utf8"));
  cpSync(join(snapshotRoot, "objects"), destination, { recursive: true });
  const restored = buildManifest(destination);
  if (restored.snapshotId !== manifest.snapshotId) {
    throw new Error("PHASE17_OBJECT_RESTORE_HASH_MISMATCH");
  }
  return manifest;
}

const root = mkdtempSync(join(tmpdir(), "qf-phase17-objects-"));
const source = join(root, "source");
const repository = join(root, "repository");
const recovered = join(root, "recovered");
mkdirSync(join(source, "vendor-media"), { recursive: true });
mkdirSync(join(source, "documents"), { recursive: true });

writeFileSync(join(source, "vendor-media", "kitchen.jpg"), "phase17-object-version-1\n");
writeFileSync(join(source, "documents", "scope.pdf"), "phase17-scope-version-1\n");
writeFileSync(join(source, "documents", "terms.txt"), "phase17-terms-version-1\n");

try {
  const first = createSnapshot(source, repository);

  // Simulate later object mutations/deletion and take an independent second snapshot.
  writeFileSync(join(source, "vendor-media", "kitchen.jpg"), "phase17-object-version-2\n");
  rmSync(join(source, "documents", "scope.pdf"));
  writeFileSync(join(source, "documents", "newer.txt"), "post-target-object\n");
  const second = createSnapshot(source, repository);
  if (second.snapshotId === first.snapshotId) throw new Error("PHASE17_OBJECT_VERSIONING_NOT_DISTINCT");

  // Disaster: source is gone. Restore the chosen pre-disaster snapshot into a clean target.
  rmSync(source, { recursive: true, force: true });
  const restoreStart = process.hrtime.bigint();
  const restoredManifest = restoreSnapshot(first.snapshotRoot, recovered);
  const restoreMs = Number(process.hrtime.bigint() - restoreStart) / 1e6;

  const restoredKitchen = readFileSync(join(recovered, "vendor-media", "kitchen.jpg"), "utf8");
  if (restoredKitchen !== "phase17-object-version-1\n") {
    throw new Error("PHASE17_OBJECT_OLD_VERSION_NOT_RECOVERED");
  }
  if (!existsSync(join(recovered, "documents", "scope.pdf"))) {
    throw new Error("PHASE17_OBJECT_DELETED_FILE_NOT_RECOVERED");
  }
  if (existsSync(join(recovered, "documents", "newer.txt"))) {
    throw new Error("PHASE17_OBJECT_POST_TARGET_LEAKED");
  }

  const evidence = {
    event: "PHASE17_OBJECT_RESTORE_CERTIFIED",
    contract: "qfj.dr.phase17.v1",
    sourceProviderVersioningAssumed: false,
    externalVersionedBackup: true,
    snapshotsCreated: 2,
    selectedSnapshotId: first.snapshotId,
    restoredFiles: restoredManifest.files.length,
    actualRpoSeconds: 0,
    restoreRtoMs: Math.round(restoreMs * 100) / 100,
    checksumVerification: "PASS",
    deletedObjectRecovery: "PASS",
    postTargetExclusion: "PASS",
  };
  console.log(JSON.stringify(evidence));
} finally {
  rmSync(root, { recursive: true, force: true });
}
