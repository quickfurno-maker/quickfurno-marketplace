import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {sourceVersions,evaluateStagingCatalogObservation,runP4LocalSnapshot} from "./p4-staging-catalog-readonly-reconciliation.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const source=JSON.parse(readFileSync(resolve(root,"docs/vox/QF-P4-READONLY-STAGING-CATALOG-OBSERVATION-20261105.json"),"utf8"));
const clone=()=>structuredClone(source);
test("P4-DB1 real read-only observed 86 Staging migrations and seven missing",()=>{
 const r=runP4LocalSnapshot();
 assert.equal(r.observedAppliedMigrationCount,86);
 assert.equal(r.observedLatestAppliedVersion,"20261013144901");
 assert.equal(r.stagedVendorVersionsPresent,0);
 assert.deepEqual(r.vendorVersionAbsences,sourceVersions);
 assert.equal(r.releaseDecision,"HOLD");
 assert.equal(r.canInstall,false);
 assert.equal(r.canDeploy,false);
 assert.equal(r.liveDatabaseModified,false);
});
test("P4-DB2 private vendor bucket and owner/private Core RPC unobserved, release HOLD",()=>{
 const r=runP4LocalSnapshot();
 assert.equal(r.bucketObserved,false);
 assert.equal(r.ownerVendorRpcObserved,false);
 for(const reason of ["STAGING_PRIVATE_VENDOR_BUCKET_NOT_OBSERVED","STAGING_VENDOR_PRIVATE_AND_OWNER_RPC_NOT_OBSERVED","NO_SIGNED_STAGING_BACKUP_ISOLATED_RESTORE"])
  assert.ok(r.blockers.includes(reason));
 assert.equal(source.observations.publicNonRlsTableCount,0);
 assert.equal(source.signedProviderAttestation,false);
});
test("P4-DB3 tampered or re-ordered migration version capture fails closed",()=>{
 for(const row of [
  (x)=>x.observations.sevenRequiredVersions.reverse(),
  (x)=>x.observations.sevenRequiredVersions[0].version="20260101000000",
  (x)=>x.observations.sevenRequiredVersions.push(x.observations.sevenRequiredVersions[0]),
  (x)=>x.signedProviderAttestation=true,
  (x)=>x.canDeploy=true,
  (x)=>x.managementActionsPerformed.push("deploy"),
 ]){
  const c=clone();row(c);
  assert.throws(()=>evaluateStagingCatalogObservation(c),/P4_/);
 }
});
test("P4-DB4 even a hypothetical full ledger/bucket snapshot does not approve install",()=>{
 const c=clone();
 c.observations.sevenRequiredVersions.forEach(x=>x.applied=true);
 c.observations.verificationBucketCount=1;
 c.observations.vendorPrivateOrVoxFunctions=14;
 const r=evaluateStagingCatalogObservation(c);
 assert.equal(r.stagedVendorVersionsPresent,7);
 assert.equal(r.canInstall,false);
 assert.equal(r.canDeploy,false);
 assert.equal(r.releaseDecision,"HOLD");
 assert.ok(r.blockers.includes("NO_SEPARATE_OWNER_STAGING_GO"));
});
test("P4-DB5 observation script is pure source read, no mutation, no Supabase tools",()=>{
 const code=readFileSync(resolve(root,"scripts/mvp/vendor/p4-staging-catalog-readonly-reconciliation.mjs"),"utf8");
 assert.match(code,/validatePinnedVendorPendingFiles/);
 assert.match(code,/READ_ONLY/);
 assert.doesNotMatch(code,/execute_sql|apply_migration|createClient\(|fetch\(|spawnSync\(|INSERT INTO|DELETE FROM|UPDATE\s+public/);
});

test("P4-DB6 repeatable Staging catalog SQL is transaction read-only and metadata-only",()=>{
 const sql=readFileSync(resolve(root,"ops/vendor/p4-staging-readonly-catalog-20261105.sql"),"utf8");
 const statements=sql.split("\n").filter(line=>!line.trim().startsWith("--")).join("\n");
 assert.match(statements,/BEGIN TRANSACTION READ ONLY;/);
 assert.match(statements,/ROLLBACK;/);
 assert.match(statements,/supabase_migrations\.schema_migrations/);
 assert.match(statements,/pg_catalog\.pg_class/);
 assert.match(statements,/storage\.buckets/);
 assert.doesNotMatch(statements,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|VACUUM)\s+/i);
 assert.doesNotMatch(statements,/\bauth\.users\b|\bpayments\b|\bvendor_leads\b/i);
});
