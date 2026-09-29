import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const EXTENSION_PATH = path.join(
  ROOT,
  "supabase/staging-history/qf-post-g1-migration-ledger-20260929.json",
);

export const LEGACY_G1_MIGRATION_COUNT = 119;
export const RECONCILIATION_MIGRATION_COUNT = 102;

const extension = JSON.parse(readFileSync(EXTENSION_PATH, "utf8"));
if (
  extension?.manifestVersion !== 1 ||
  extension?.purpose !== "POST_G1_EXPLICIT_MIGRATION_PIN_EXTENSION" ||
  extension?.databaseMutationAuthorized !== false ||
  extension?.productionDeploymentAuthorized !== false ||
  extension?.safety?.exactPinsRequired !== true ||
  extension?.safety?.unlistedMigrationForbidden !== true ||
  extension?.safety?.hashDriftForbidden !== true
) {
  throw new Error("invalid-post-g1-migration-extension");
}

export const POST_G1_EXTENSION_RECORDS = Object.freeze(
  (extension.records ?? []).map((record) => Object.freeze({ ...record })),
);
export const SUPERSEDED_LEGACY_VERSIONS = Object.freeze(
  (extension.supersededLegacyPins ?? []).map((record) => record.legacyVersion),
);
export const POST_G1_EXTENSION_VERSIONS = Object.freeze(
  POST_G1_EXTENSION_RECORDS.map((record) => record.version),
);
export const POST_G1_EXTENSION_FILENAMES = Object.freeze(
  POST_G1_EXTENSION_RECORDS.map((record) => record.filename),
);

if (
  new Set(POST_G1_EXTENSION_VERSIONS).size !== POST_G1_EXTENSION_VERSIONS.length ||
  new Set(SUPERSEDED_LEGACY_VERSIONS).size !== SUPERSEDED_LEGACY_VERSIONS.length
) {
  throw new Error("duplicate-post-g1-migration-pin");
}

export const EXPECTED_LIVE_MIGRATION_COUNT =
  LEGACY_G1_MIGRATION_COUNT -
  SUPERSEDED_LEGACY_VERSIONS.length +
  POST_G1_EXTENSION_RECORDS.length;

export const EXPECTED_POST_RECONCILIATION_ADDITIONS =
  EXPECTED_LIVE_MIGRATION_COUNT - RECONCILIATION_MIGRATION_COUNT;

export function extendLegacyVersions(legacyVersions) {
  const versions = [
    ...legacyVersions.filter((version) => !SUPERSEDED_LEGACY_VERSIONS.includes(version)),
    ...POST_G1_EXTENSION_VERSIONS,
  ].sort();
  if (new Set(versions).size !== versions.length) {
    throw new Error("overlapping-live-migration-pin");
  }
  return versions;
}

export function extendLegacyFilenames(legacyFilenames) {
  const filenames = [
    ...legacyFilenames.filter(
      (filename) =>
        !SUPERSEDED_LEGACY_VERSIONS.some((version) => filename.startsWith(`${version}_`)),
    ),
    ...POST_G1_EXTENSION_FILENAMES,
  ].sort();
  if (new Set(filenames).size !== filenames.length) {
    throw new Error("overlapping-live-migration-filename-pin");
  }
  return filenames;
}
