import test from "node:test";
import assert from "node:assert/strict";
import {auditFinal2FeatureGates} from "./validate-vox-final2-feature-gates.mjs";
const rows=auditFinal2FeatureGates();
test("required features are inventoried explicitly, including unimplemented Finance",()=>{
 assert.equal(rows.length,11);
 assert.equal(new Set(rows.map(x=>x.feature)).size,11);
 assert.equal(rows.find(x=>x.feature==="VOX Finance")?.sourceStatus,"SOURCE_ROUTE_MISSING");
});
test("every enumerated route with source uses verified auth and no-store",()=>{
 for(const r of rows.filter(x=>x.sourcePresent)){
  assert.equal(r.verifiedAuthInSource,true,r.feature);
  assert.equal(r.noStoreInSource,true,r.feature);
 }
});
test("all features remain unaccepted in managed Staging and Production",()=>{
 for(const r of rows){
  assert.equal(r.managedStagingAccepted,false);
  assert.equal(r.productionReady,false);
  assert.notEqual(r.sourceStatus,"ACTIVATED");
 }
});
test("official EOD remains hard-off in source",()=>{
 const r=rows.find(x=>x.feature==="Official EOD");
 assert.equal(r.activationHardOff,true);
 assert.equal(r.sourceStatus,"HARD_OFF_SOURCE_ONLY");
});
test("mutating Staff paths have explicit reviewed flags",()=>{
 const sensitive=["Staff work transitions","Internal staff chat","Staff permissions"];
 for(const feature of sensitive){
  const r=rows.find(x=>x.feature===feature);
  assert.equal(r.sourcePresent,true,feature);
  assert.ok(r.requiredFlags.length>0,feature);
 }
});
