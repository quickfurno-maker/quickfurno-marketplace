#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (p) => readFile(join(ROOT, p), "utf8");
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log("PASS " + name);
  } catch (error) {
    console.error("FAIL " + name + " - " + error.message);
    process.exitCode = 1;
  }
}

const contract = JSON.parse(
  await read("contracts/qfj-phase21-supabase-exit-v1.json"),
);
const snap = JSON.parse(
  await read("docs/scale/phase21-live-supabase-snapshot.json"),
);
const inventory = await read("docs/scale/phase21-supabase-exit-inventory.md");
const adr = await read(
  "docs/decisions/ADR-0200-identity-auth-provider-portability.md",
);
const exporter = await read("scripts/scale/export-phase21-supabase-pack.mjs");
const manifest = JSON.parse(
  await read("docs/scale/phase21-supabase-callsite-manifest.json"),
);
const migrations = (await readdir(join(ROOT, "supabase/migrations")))
  .filter((x) => x.endsWith(".sql"))
  .sort();

check("canonical Phase21 contract", () =>
  assert.equal(contract.contract, "qfj.phase21.supabase-exit.v1"),
);
check("Phase20 exact baseline retained", () =>
  assert.equal(
    contract.phase20Baselines.quickfurno,
    "997cef1bfddd6bfb9505c4ac42e2cc1e055bc880",
  ),
);
check("live QuickFurno catalog inventory", () => {
  assert.equal(snap.catalog.publicTables, 139);
  assert.equal(snap.catalog.publicPolicies, 75);
  assert.equal(snap.catalog.publicFunctions, 181);
});
check("live migration ledger captured", () => {
  assert.equal(snap.migrations.length, 83);
  assert.equal(snap.migrations.at(-1).version, "20261003093648");
});
check("catalog fingerprints captured", () =>
  assert.match(snap.catalog.fingerprints.columnsSha256, /^[0-9a-f]{64}$/),
);
check("Vault is classified and has zero public runtime refs", () => {
  const vault = snap.extensions.find((x) => x.name === "supabase_vault");
  assert.equal(vault.livePublicRuntimeReferences, 0);
  assert.match(vault.portability, /PROVIDER_SPECIFIC/);
});
check("storage has independent checksum migration contract", () => {
  const bucket = snap.storage[0];
  assert.equal(bucket.id, "vendor-media");
  assert.equal(bucket.objectCount, 0);
  assert.match(contract.providerSurfaceDisposition.storage, /SHA256/);
});
check("Realtime scope is explicit", () =>
  assert.deepEqual(snap.realtime.tables, [
    "public.communication_inbound_messages",
    "public.communication_messages",
  ]),
);
check("Auth exit stays Phase22", () => {
  assert.match(adr, /Phase 22/);
  assert.match(contract.providerSurfaceDisposition.auth, /PHASE22/);
});
check("sessions invalidate on provider cutover", () =>
  assert.match(contract.providerSurfaceDisposition.sessions, /REAUTHENTICATE/),
);
check("managed export uses supported split artifacts", () => {
  for (const required of [
    "--role-only",
    "--data-only",
    "--use-copy",
    "roles.sql",
    "schema.sql",
    "data.sql",
    "supabase@",
  ]) {
    assert.ok(exporter.includes(required), "missing " + required);
  }
});
check("managed raw pg_dump is forbidden", () =>
  assert.equal(
    contract.databaseExportContract.rawPgDumpOfManagedSupabaseForbidden,
    true,
  ),
);
check("production dumps cannot enter Git", () =>
  assert.equal(contract.databaseExportContract.dumpFilesForbiddenFromGit, true),
);
check("repository migration chain remains reconstruction source", () =>
  assert.ok(migrations.length >= 150),
);
check("production history equivalence is not inferred from filenames", () =>
  assert.match(inventory, /inventory-only prerequisite|migration history/i),
);
check("call-site manifest is classified", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.totals.files > 0);
  assert.match(manifest.classification.auth, /PHASE22/);
});
check("current compatibility assumptions are locked", () => {
  assert.equal(
    contract.currentSupabaseCompatibility.postgres17TargetRequired,
    true,
  );
  assert.equal(
    contract.currentSupabaseCompatibility
      .explicitDataApiGrantsRequiredForFutureTableExposure,
    true,
  );
  assert.equal(
    contract.currentSupabaseCompatibility
      .extensionVersionPinningAssumptionForbidden,
    true,
  );
});
check("no production mutation or cutover", () => {
  assert.equal(contract.certification.noProductionMutation, true);
  assert.equal(contract.exit.productionCutoverPerformed, false);
  assert.equal(contract.exit.productionDatabaseMigrated, false);
});
check("AGNI authority does not expand", () =>
  assert.equal(contract.exit.agniAuthorityExpanded, false),
);

const contractHash = createHash("sha256")
  .update(await read("contracts/qfj-phase21-supabase-exit-v1.json"))
  .digest("hex");
console.log(
  "QuickFurno Phase21 " +
    (process.exitCode ? "FAILED" : "PASS") +
    " (" +
    passed +
    "/19) contractSha256=" +
    contractHash,
);
if (process.exitCode) process.exit(process.exitCode);
