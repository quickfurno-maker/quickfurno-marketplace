import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assess} from "./check-to04c-schema-readiness.mjs";
const evidence=JSON.parse(readFileSync(new URL("../../../ops/vox/certification/TO04C-LIVE-SCHEMA-EVIDENCE.json",import.meta.url),"utf8"));
test("real source snapshot is metadata only and cannot self-certify",()=>{
 assert.equal(evidence.includesUserRows,false);
 assert.equal(evidence.releaseAuthorization,false);
 assert.equal(evidence.reviewState,"UNREVIEWED_RELEASE_HOLD");
 assert.equal(evidence.environments.staging.migrationCount,86);
 assert.equal(evidence.environments.production.migrationCount,86);
 assert.equal(evidence.migrationComparison.sharedVersionIds,34);
 assert.equal(evidence.migrationComparison.stagingOnlyVersionIds,52);
 assert.equal(evidence.migrationComparison.productionOnlyVersionIds,52);
});
test("six canonical Core tables have required fields, ten VOX tables absent",()=>{
 for(const env of ["staging","production"]){
  const x=evidence.environments[env];
  assert.equal(x.observedPresent.length,6);
  assert.equal(x.missingRequiredTables.length,10);
  for(const table of ["vendors","cities","aarohi_prospects","marketplace_service_zones","vendor_support_threads","profiles"])
   assert.ok(x.observedPresent.includes(table));
  for(const table of ["vox_staff_teams_v1","vox_staff_memberships_v1","vox_staff_department_capabilities_v1",
    "vox_work_items_candidate_v1"])
   assert.ok(x.missingRequiredTables.includes(table));
 }
});
test("release gate refuses absent VOX schema, DBA and security approval",()=>{
 const result=assess(evidence);
 assert.equal(result.ready,false);
 for(const blocker of ["STAGING_VOX_SCHEMA_MISSING","DBA_RESTORE_APPROVAL_MISSING",
   "SECURITY_ADVISORIES_UNREVIEWED","REAL_AAL2_STAGING_MISSING"])
  assert.ok(result.blockers.includes(blocker),blocker);
});
test("fabricated or partial evidence is never acceptable",()=>{
 assert.equal(assess({...evidence,schema:"unknown"}).ready,false);
 assert.equal(assess({...evidence,environments:null}).ready,false);
 assert.equal(assess({...evidence,requiredTables:[evidence.requiredTables[0]]}).ready,false);
 const forged=structuredClone(evidence);
 forged.environments.staging.missingRequiredTables=[];
 assert.equal(assess(forged).ready,false);
});
