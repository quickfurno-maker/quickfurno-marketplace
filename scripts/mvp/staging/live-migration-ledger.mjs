import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
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
// Seven historical 2026-10-14 VOX foundations are PINNED source evidence but
// QUARANTINED, never deployable as active Supabase migrations. The historical
// extension remains immutable; only the live-filesystem projection excludes
// exactly these seven reviewed versions. A missing archive, hash drift or
// reappearance in supabase/migrations is a hard failure, not a silent skip.
const QUARANTINED_VOX_DIGESTS = Object.freeze({
  '20261014010000':'a5d0da20590b178b5e0aaff5045fe9957e367f9396baea4e86222bcc7d076c4c',
  '20261014020000':'4f7bb561c4aa7203e11a69672017fe97447a95a6c59ada5c8cfe24ffdd1ad166',
  '20261014030000':'1a556c638b9dfe038bdb9cf951e4ee4689c362e5632789c1b97edcd86439184a',
  '20261014040000':'fb68eec0f7a7ee2ea097461522aba7fbe3d239c112fc3ccffedbfbb68659934e',
  '20261014050000':'b1423c1135891610ee6e55709fc088598678f8ee59a58fd9d80f732f481fe7e9',
  '20261014060000':'6484c66d9eec6ca699414ec97fc50962e22b685949d280ce3c2d2aeb21fa8dfb',
  '20261014070000':'454fb0c07ca7589962eddaffa0001a9a2a7562a3304d70da8e091a0499918f01',
});
export const QUARANTINED_VOX_EXTENSIONS = Object.freeze(
  POST_G1_EXTENSION_RECORDS.filter(record => record.version in QUARANTINED_VOX_DIGESTS),
);
if(QUARANTINED_VOX_EXTENSIONS.length!==7)throw new Error('quarantine-pin-count-drift');
for(const record of QUARANTINED_VOX_EXTENSIONS){
  const version=record.version;
  if(record.canonicalSha256!==QUARANTINED_VOX_DIGESTS[version] ||
     record.filename!==`${version}_${record.name}.sql` ||
     record.path!==`supabase/migrations/${record.filename}`)
    throw new Error('quarantine-migration-metadata-drift:'+version);
  const source=path.join(ROOT,'ops/vox/quarantined-migrations/legacy-20261014',record.filename);
  if(!existsSync(source) || existsSync(path.join(ROOT,'supabase/migrations',record.filename)))
    throw new Error('quarantine-file-placement-drift:'+version);
  const canonical=readFileSync(source,'utf8').replace(/\r\n?/g,'\n');
  if(createHash('sha256').update(canonical).digest('hex')!==QUARANTINED_VOX_DIGESTS[version])
    throw new Error('quarantine-source-hash-drift:'+version);
}
export const ACTIVE_POST_G1_EXTENSION_RECORDS = Object.freeze(
  POST_G1_EXTENSION_RECORDS.filter(record=>!(record.version in QUARANTINED_VOX_DIGESTS)),
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
  ACTIVE_POST_G1_EXTENSION_RECORDS.length;

export const EXPECTED_POST_RECONCILIATION_ADDITIONS =
  EXPECTED_LIVE_MIGRATION_COUNT - RECONCILIATION_MIGRATION_COUNT;

export function extendLegacyVersions(legacyVersions) {
  const versions = [
    ...legacyVersions.filter((version) => !SUPERSEDED_LEGACY_VERSIONS.includes(version)),
    ...ACTIVE_POST_G1_EXTENSION_RECORDS.map(record=>record.version),
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
    ...ACTIVE_POST_G1_EXTENSION_RECORDS.map(record=>record.filename),
  ].sort();
  if (new Set(filenames).size !== filenames.length) {
    throw new Error("overlapping-live-migration-filename-pin");
  }
  return filenames;
}
