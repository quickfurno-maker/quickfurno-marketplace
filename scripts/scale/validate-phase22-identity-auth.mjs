#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

const contractText = await read("contracts/qfj-phase22-identity-auth-v1.json");
const contract = JSON.parse(contractText);
const snapshot = JSON.parse(
  await read("docs/scale/phase22-live-auth-snapshot.json"),
);
const manifest = JSON.parse(
  await read("docs/scale/phase22-auth-callsite-manifest.json"),
);
const migration = await read(
  "supabase/migrations/20261006113720_phase22_identity_portability.sql",
);
const provider = await read("lib/identity/providerIdentity.ts");
const directory = await read("lib/identity/identityDirectory.ts");
const service = await read("services/identityDirectoryService.ts");
const grantSuperadmin = await read("scripts/grant-superadmin.mjs");
const adr = await read(
  "docs/decisions/ADR-0200-identity-auth-provider-portability.md",
);

check("canonical Phase22 contract", () =>
  assert.equal(contract.contract, "qfj.phase22.identity-auth.v1"),
);
check("exact Phase21 QuickFurno baseline", () =>
  assert.equal(
    contract.phase21Baselines.quickfurno,
    "07ffcb1c59170ddd183575797b324cc063eeb71e",
  ),
);
check("live auth inventory captured without PII", () => {
  assert.equal(snapshot.auth.users, 9);
  assert.equal(snapshot.auth.identities, 9);
  assert.equal(snapshot.auth.activeSessions, 19);
  assert.equal(snapshot.auth.mfaFactors, 0);
  assert.equal(snapshot.containsProviderSubjects, false);
});
check("stable principal and provider link schema exists", () => {
  for (const token of [
    "create table if not exists public.identity_principals",
    "create table if not exists public.identity_provider_identities",
    "create table if not exists public.identity_business_bindings",
    "create table if not exists public.identity_admin_roles",
  ])
    assert.ok(migration.includes(token), token);
});
check("existing business ids are not rewritten", () => {
  assert.doesNotMatch(
    migration,
    /update\s+public\.(profiles|vendors|client_accounts|vendor_dashboard_users)\b/iu,
  );
  assert.doesNotMatch(
    migration,
    /alter\s+table\s+public\.(profiles|vendors|client_accounts|vendor_dashboard_users)\s+(?:drop|alter)\s+column/iu,
  );
});
check("current auth.users FKs and RLS are intentionally preserved", () => {
  assert.equal(
    contract.identityModel.existingAuthUserForeignKeysRewritten,
    false,
  );
  assert.equal(contract.identityModel.existingRlsRulesRewritten, false);
  assert.equal(snapshot.coupling.publicForeignKeysToAuthUsers, 5);
  assert.equal(snapshot.coupling.publicPoliciesUsingAuthUid, 7);
});
check("provider identity tables are server only", () => {
  for (const table of [
    "identity_principals",
    "identity_provider_identities",
    "identity_business_bindings",
    "identity_admin_roles",
  ]) {
    assert.ok(
      migration.includes(
        "revoke all on public." + table + " from public, anon, authenticated",
      ),
    );
  }
});
check("security-definer helpers are locked down", () => {
  assert.match(migration, /set search_path = pg_catalog, public, pg_temp/);
  assert.match(
    migration,
    /revoke all on function public\.qf_sync_identity_business_binding\(\) from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke all on function public\.handle_new_user\(\) from public, anon, authenticated/,
  );
});
check("user metadata cannot grant privilege", () => {
  assert.doesNotMatch(
    migration,
    /raw_user_meta_data\s*->>\s*'(?:role|admin_role|qf_principal)'/u,
  );
  assert.equal(contract.authority.providerUserMetadataAuthorization, false);
});
check("provider claims cannot grant authorization", () => {
  assert.equal(contract.authority.providerClaimsAuthorization, false);
  assert.match(service, /identity_admin_roles/);
  assert.doesNotMatch(service, /app_metadata|user_metadata/u);
  assert.match(service, /vendor_dashboard_users/);
  assert.match(service, /client_accounts/);
  assert.match(service, /profiles/);
});
check("legacy Superadmin authority is copied once into Core", () => {
  assert.match(migration, /raw_app_meta_data\s*->>\s*'admin_role'/u);
  assert.match(migration, /insert into public\.identity_admin_roles/);
  assert.match(grantSuperadmin, /identity_admin_roles/);
  assert.match(grantSuperadmin, /legacy coexistence/);
});
check("provider adapter validates identity evidence only", () => {
  assert.match(provider, /providerClaimsGrantAuthorization: false/);
  assert.match(directory, /resolveMappedPrincipal/);
  assert.match(directory, /PROVIDER_IDENTITY_NOT_MAPPED/);
  assert.match(directory, /PRINCIPAL_NOT_ACTIVE/);
});
check("provider cutover requires reauthentication", () => {
  assert.equal(
    contract.cutover.existingProviderSessionsAcceptedAfterProviderCutover,
    false,
  );
  assert.equal(contract.cutover.reauthenticationRequired, true);
  assert.equal(contract.cutover.refreshTokensNeverBridgedAcrossProviders, true);
  assert.match(provider, /requireReauthenticationAfterProviderCutover: true/);
});
check("password, MFA and recovery migration are fail-closed", () => {
  assert.equal(contract.cutover.passwordHashPortabilityAssumed, false);
  assert.equal(contract.cutover.mfaEnrollmentPortabilityAssumed, false);
  assert.equal(
    contract.cutover
      .unsupportedPasswordMigrationRequiresResetOrVerifiedProviderMigration,
    true,
  );
  assert.equal(
    contract.cutover.mfaReenrollmentRequiredWhenProviderCannotImportFactors,
    true,
  );
});
check("runtime provider coupling is inventoried", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.files.length > 0);
  assert.ok(manifest.totals.getUser > 0);
  assert.equal(manifest.classification.userMetadata, "NEVER_AUTHORIZATION");
});
check("Phase20 portability ADR is honored", () => {
  assert.match(adr, /Do not mass-rewrite existing business IDs/);
  assert.match(adr, /Authorization remains Core-owned/);
});
check("production remains unchanged in Phase22", () => {
  for (const key of [
    "productionDatabaseMigrationPerformed",
    "productionAuthProviderCutoverPerformed",
    "productionSessionInvalidationPerformed",
    "productionPasswordMigrationPerformed",
    "productionMfaMigrationPerformed",
    "productionTrafficCutoverPerformed",
    "agniAuthorityExpanded",
  ])
    assert.equal(contract.productionBoundary[key], false, key);
});
check("exit gate requires alternate IdP proof", () => {
  assert.equal(contract.certification.alternateTestProviderRequired, true);
  assert.equal(
    contract.certification.sameStablePrincipalAcrossProvidersRequired,
    true,
  );
  assert.equal(
    contract.certification.sameCoreBusinessRecordAcrossProvidersRequired,
    true,
  );
});
check("Phase23 is exact next step", () =>
  assert.match(contract.exit.nextPhase, /Phase 23/),
);

const sha = createHash("sha256").update(contractText).digest("hex");
console.log(
  "QuickFurno Phase22 " +
    (process.exitCode ? "FAILED" : "PASS") +
    " (" +
    passed +
    "/19) contractSha256=" +
    sha,
);
if (process.exitCode) process.exit(process.exitCode);
