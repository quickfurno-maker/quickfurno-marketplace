#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const PROTOCOL = 'qf.release.phase15.v1';
const STATE_PROTOCOL = 'qf.release.state.v1';
const SHA = /^[a-f0-9]{40}$/u;
const RELEASE_ID = /^[a-z0-9][a-z0-9._-]{7,127}$/u;
const DIGEST_REF = /^ghcr\.io\/quickfurno-maker\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/u;
const DB_POLICIES = new Set([
  'NONE',
  'SOURCE_ONLY',
  'EXPAND_COMPATIBLE',
  'CONTRACT_REQUIRES_MAINTENANCE',
]);
const ROLE_REPOSITORY = Object.freeze({
  'quickfurno-runtime': 'ghcr.io/quickfurno-maker/quickfurno-marketplace',
  'jarvis-os': 'ghcr.io/quickfurno-maker/qf-jarvis-os',
  'jarvis-gateway': 'ghcr.io/quickfurno-maker/qf-jarvis-gateway',
  'jarvis-worker': 'ghcr.io/quickfurno-maker/qf-jarvis-worker',
  agni: 'ghcr.io/quickfurno-maker/qf-agni',
});
const REQUIRED_ROLES = Object.freeze({
  QUICKFURNO: Object.freeze(['quickfurno-runtime']),
  JARVIS: Object.freeze(['jarvis-os', 'jarvis-gateway', 'jarvis-worker']),
  AGNI: Object.freeze(['agni']),
});

function die(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    die(label + '_object_required');
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    die(label + '_keys_invalid:' + actual.join(','));
  }
}

function option(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0) {
    if (required) die('missing_' + name.replace(/^--/u, ''));
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) die('invalid_' + name.replace(/^--/u, ''));
  return value;
}

function repeated(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) die('invalid_' + name.replace(/^--/u, ''));
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function validateManifest(input, expectedSystem, promotable = false) {
  const manifest = object(input, 'manifest');
  exactKeys(
    manifest,
    [
      'protocol',
      'releaseId',
      'system',
      'sourceSha',
      'images',
      'database',
      'compatibility',
      'rollout',
      'provenance',
      'createdAt',
    ],
    'manifest',
  );

  if (manifest.protocol !== PROTOCOL) die('manifest_protocol_invalid');
  if (typeof manifest.releaseId !== 'string' || !RELEASE_ID.test(manifest.releaseId)) {
    die('manifest_release_id_invalid');
  }
  if (!Object.hasOwn(REQUIRED_ROLES, manifest.system)) die('manifest_system_invalid');
  if (expectedSystem && manifest.system !== expectedSystem) die('manifest_system_mismatch');
  if (typeof manifest.sourceSha !== 'string' || !SHA.test(manifest.sourceSha)) {
    die('manifest_source_sha_invalid');
  }

  if (!Array.isArray(manifest.images)) die('manifest_images_invalid');
  const expectedRoles = REQUIRED_ROLES[manifest.system];
  if (manifest.images.length !== expectedRoles.length) die('manifest_image_count_invalid');
  const seenRoles = new Set();
  const seenRefs = new Set();
  for (const value of manifest.images) {
    const image = object(value, 'image');
    exactKeys(image, ['role', 'ref', 'sourceSha'], 'image');
    if (!expectedRoles.includes(image.role)) die('manifest_image_role_invalid:' + image.role);
    if (seenRoles.has(image.role)) die('manifest_image_role_duplicate:' + image.role);
    seenRoles.add(image.role);
    if (typeof image.ref !== 'string' || !DIGEST_REF.test(image.ref)) {
      die('manifest_image_ref_invalid:' + image.role);
    }
    const expectedRepository = ROLE_REPOSITORY[image.role] + '@sha256:';
    if (!image.ref.startsWith(expectedRepository)) {
      die('manifest_image_repository_invalid:' + image.role);
    }
    if (seenRefs.has(image.ref)) die('manifest_image_ref_duplicate');
    seenRefs.add(image.ref);
    if (image.sourceSha !== manifest.sourceSha) die('manifest_image_source_sha_mismatch:' + image.role);
  }
  for (const role of expectedRoles) {
    if (!seenRoles.has(role)) die('manifest_image_role_missing:' + role);
  }

  const database = object(manifest.database, 'database');
  exactKeys(database, ['productionMigration', 'rollbackSafe', 'migrationId'], 'database');
  if (!DB_POLICIES.has(database.productionMigration)) die('manifest_database_policy_invalid');
  if (typeof database.rollbackSafe !== 'boolean') die('manifest_database_rollback_safe_invalid');
  if (
    database.migrationId !== null &&
    (typeof database.migrationId !== 'string' ||
      database.migrationId.length < 1 ||
      database.migrationId.length > 128)
  ) {
    die('manifest_database_migration_id_invalid');
  }

  const compatibility = object(manifest.compatibility, 'compatibility');
  exactKeys(compatibility, ['crossSystemHttp', 'minPeerSchema'], 'compatibility');
  const expectedCompatibility = manifest.system === 'AGNI' ? 'NOT_APPLICABLE' : 'V0_V1_ROLLING';
  if (compatibility.crossSystemHttp !== expectedCompatibility) {
    die('manifest_cross_system_compatibility_invalid');
  }
  if (
    !Number.isSafeInteger(compatibility.minPeerSchema) ||
    compatibility.minPeerSchema < 0 ||
    compatibility.minPeerSchema > 99
  ) {
    die('manifest_min_peer_schema_invalid');
  }

  const rollout = object(manifest.rollout, 'rollout');
  exactKeys(
    rollout,
    ['strategy', 'retainPreviousMinutes', 'requireHumanApproval', 'automaticProductionApply'],
    'rollout',
  );
  if (rollout.strategy !== 'BLUE_GREEN') die('manifest_rollout_strategy_invalid');
  if (
    !Number.isSafeInteger(rollout.retainPreviousMinutes) ||
    rollout.retainPreviousMinutes < 10 ||
    rollout.retainPreviousMinutes > 1440
  ) {
    die('manifest_retain_previous_invalid');
  }
  if (rollout.requireHumanApproval !== true) die('manifest_human_approval_required');
  if (rollout.automaticProductionApply !== false) die('manifest_auto_production_forbidden');

  const provenance = object(manifest.provenance, 'provenance');
  exactKeys(provenance, ['builder', 'signature', 'sbom', 'buildProvenance'], 'provenance');
  if (provenance.builder !== 'github-actions') die('manifest_builder_invalid');
  if (provenance.signature !== 'sigstore-keyless') die('manifest_signature_invalid');
  if (provenance.sbom !== 'spdx-json') die('manifest_sbom_invalid');
  if (provenance.buildProvenance !== 'github-attestations') die('manifest_provenance_invalid');

  if (typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) {
    die('manifest_created_at_invalid');
  }

  if (promotable) {
    if (!database.rollbackSafe) die('manifest_not_rollback_safe');
    if (database.productionMigration === 'CONTRACT_REQUIRES_MAINTENANCE') {
      die('manifest_requires_maintenance');
    }
  }

  return manifest;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function makeManifest(args) {
  const system = option(args, '--system');
  if (!Object.hasOwn(REQUIRED_ROLES, system)) die('create_system_invalid');
  const sourceSha = option(args, '--sha');
  if (!SHA.test(sourceSha)) die('create_sha_invalid');
  const releaseId = option(args, '--release-id');
  const dbPolicy = option(args, '--db-policy', false) ?? 'SOURCE_ONLY';
  if (!DB_POLICIES.has(dbPolicy)) die('create_db_policy_invalid');
  const retainPreviousMinutes = Number(option(args, '--retain-minutes', false) ?? '60');
  const migrationId = option(args, '--migration-id', false) ?? null;
  const createdAt = option(args, '--created-at', false) ?? new Date().toISOString();
  const imageArgs = repeated(args, '--image');
  const images = imageArgs.map((entry) => {
    const split = entry.indexOf('=');
    if (split < 1) die('create_image_invalid');
    return Object.freeze({
      role: entry.slice(0, split),
      ref: entry.slice(split + 1),
      sourceSha,
    });
  });
  const manifest = {
    protocol: PROTOCOL,
    releaseId,
    system,
    sourceSha,
    images,
    database: {
      productionMigration: dbPolicy,
      rollbackSafe: true,
      migrationId,
    },
    compatibility: {
      crossSystemHttp: system === 'AGNI' ? 'NOT_APPLICABLE' : 'V0_V1_ROLLING',
      minPeerSchema: system === 'AGNI' ? 0 : 1,
    },
    rollout: {
      strategy: 'BLUE_GREEN',
      retainPreviousMinutes,
      requireHumanApproval: true,
      automaticProductionApply: false,
    },
    provenance: {
      builder: 'github-actions',
      signature: 'sigstore-keyless',
      sbom: 'spdx-json',
      buildProvenance: 'github-attestations',
    },
    createdAt,
  };
  return validateManifest(manifest, system, false);
}

function stateOrBootstrap(value) {
  if (value === null) {
    return {
      protocol: STATE_PROTOCOL,
      activeSlot: null,
      currentReleaseId: null,
      currentSourceSha: null,
      currentManifestSha256: null,
      previousSlot: null,
      previousReleaseId: null,
      previousSourceSha: null,
      previousManifestSha256: null,
    };
  }
  const state = object(value, 'state');
  exactKeys(
    state,
    [
      'protocol',
      'activeSlot',
      'currentReleaseId',
      'currentSourceSha',
      'currentManifestSha256',
      'previousSlot',
      'previousReleaseId',
      'previousSourceSha',
      'previousManifestSha256',
    ],
    'state',
  );
  if (state.protocol !== STATE_PROTOCOL) die('state_protocol_invalid');
  for (const key of ['activeSlot', 'previousSlot']) {
    if (state[key] !== null && state[key] !== 'blue' && state[key] !== 'green') {
      die('state_slot_invalid:' + key);
    }
  }
  return state;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'create') {
    const out = option(args, '--out');
    const manifest = makeManifest(args);
    await writeFile(out, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    console.log('PHASE15_RELEASE_CREATED ' + out);
    return;
  }

  if (command === 'validate') {
    const path = option(args, '--manifest');
    const expectedSystem = option(args, '--system', false);
    const promotable = args.includes('--promotable');
    const manifest = validateManifest(await readJson(path), expectedSystem, promotable);
    console.log(
      'PHASE15_RELEASE_VALID ' +
        manifest.system +
        ' ' +
        manifest.sourceSha +
        ' images=' +
        manifest.images.length,
    );
    return;
  }

  if (command === 'plan') {
    const path = option(args, '--manifest');
    const statePath = option(args, '--state', false);
    const manifestText = await readFile(path, 'utf8');
    const manifest = validateManifest(JSON.parse(manifestText), option(args, '--system', false), true);
    let prior = null;
    if (statePath) {
      try {
        prior = await readJson(statePath);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
      }
    }
    const state = stateOrBootstrap(prior);
    const targetSlot = state.activeSlot === 'blue' ? 'green' : 'blue';
    const plan = {
      protocol: 'qf.release.plan.v1',
      system: manifest.system,
      releaseId: manifest.releaseId,
      sourceSha: manifest.sourceSha,
      manifestSha256: createHash('sha256').update(manifestText).digest('hex'),
      activeSlot: state.activeSlot,
      targetSlot,
      retainPreviousMinutes: manifest.rollout.retainPreviousMinutes,
      productionMigration: manifest.database.productionMigration,
      rollbackSafe: manifest.database.rollbackSafe,
    };
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  die('usage: phase15-release.mjs <create|validate|plan> ...');
}

main().catch((error) => {
  console.error('PHASE15_RELEASE_REFUSED ' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
