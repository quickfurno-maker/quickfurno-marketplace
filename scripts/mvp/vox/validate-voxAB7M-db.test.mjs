import test from "node:test";import assert from "node:assert/strict";
import {inspectAb7mStagingDatabase as check,ab7mPinnedStagingCatalog as catalog}
 from "../../../contracts/vox/ab7mDatabaseReleaseAssessment.mjs";
const now=Date.now();
const spec=()=>({...catalog,environment:"staging",projectRef:"uckafzuochmbvtiodmcl",
 readAtMs:now-1000,now,installedVoxTables:0,stagingAppliedMigrations:86,
 authUsers:1,verifiedMfaFactors:0,quarantinedFoundationCount:7,candidateSqlCount:23,
 stagingOnlyVersionIds:31,repoOnlyVersionIds:107});
test("AB7M actual staging catalog compatibility never authorizes migration",()=>{
 const r=check(spec());assert.equal(r.ok,true);assert.equal(r.sourceSchemaCompatible,true);
 assert.equal(r.canApplyMigrations,false);assert.equal(r.releaseAuthorized,false);
 assert.equal(r.migrationSemanticMappingComplete,false);
});
test("AB7M schema hash drift, partially installed managed tables and stale readings fail closed",()=>{
 for(const patch of [{columns:"a"}, {installedVoxTables:1},
  {readAtMs:now-90000},{projectRef:"yqpgcsduqbxulrlzwzap"},
  {stagingOnlyVersionIds:30},{authUsers:2},{verifiedMfaFactors:1}]){
  const r=check({...spec(),...patch});assert.equal(r.ok,false,r.reason);
  assert.equal(r.canInstall,false);
 }
});
test("AB7M claimed review and restore signoffs cannot bypass historical migration mapping",()=>{
 const r=check({...spec(),currentAclsReviewed:true,rollbackRestoreApproved:true});
 assert.equal(r.ok,true);assert.equal(r.canInstall,false);
 assert.equal(r.rollbackAuthorized,false);
});
