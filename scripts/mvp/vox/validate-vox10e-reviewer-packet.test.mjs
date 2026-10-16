import test from "node:test";import assert from "node:assert/strict";
import {summarizeVox10eReviewerPacket as summary,REQUIRED_VOX10E_GATES}
 from "../../../contracts/vox/reviewerEvidencePacket.mjs";
const s="a".repeat(64),b="b".repeat(64);
const run=o=>summary({sourceSha:s,stagingSnapshotSha:b,...o});
test("nine independent human & staging gates in one packet",()=>{
 const r=run();assert.equal(r.ok,true);assert.equal(r.gateCount,9);
 assert.equal(r.gates.length,9);assert.equal(r.productionPermitted,false);
 assert.equal(r.humanReviewersEngaged,false);
});
test("even all source evidence hashes never mint human approval",()=>{
 const obs=REQUIRED_VOX10E_GATES.map(gate=>({
  gate,observationStatus:"SOURCE_TEST_ONLY",evidenceSha:s
 }));
 const r=run({observations:obs});
 assert.equal(r.ok,true);
 assert.equal(r.gates.every(x=>x.sourceEvidencePresent),true);
 assert.equal(r.protectedStagingPermitted,false);
 assert.equal(r.humanAttestationsVerified,false);
 assert.equal(r.canonicalSqlApproved,false);
});
test("forged signed or approved status is rejected",()=>{
 for(const state of ["APPROVED","SIGNED","GO","PRODUCTION"]){
  assert.equal(run({observations:[{gate:REQUIRED_VOX10E_GATES[0],
   observationStatus:state,evidenceSha:null}]}).ok,false);
 }
});
test("duplicate gate fails rather than masking a failed reviewer",()=>{
 const x={gate:REQUIRED_VOX10E_GATES[0],observationStatus:"BLOCKED",evidenceSha:null};
 assert.equal(run({observations:[x,x]}).ok,false);
});
test("unexpected owner signatures or tokens rejected",()=>{
 for(const obj of [
  {gate:"OWNER_SELF_APPROVAL",observationStatus:"SOURCE_TEST_ONLY",evidenceSha:s},
  {gate:REQUIRED_VOX10E_GATES[0],observationStatus:"NOT_STARTED",
   evidenceSha:null,signer:"SELF"},
  {gate:REQUIRED_VOX10E_GATES[0],observationStatus:"NOT_STARTED",
   evidenceSha:"not-a-hash"},
 ]){
  assert.equal(run({observations:[obj]}).ok,false);
 }
});
test("source and staging backup must have SHA256 hashes",()=>{
 assert.equal(summary().ok,false);
 assert.equal(run({sourceSha:"BAD"}).ok,false);
 assert.equal(run({stagingSnapshotSha:"SECRET"}).ok,false);
});
test("no false owner/DBA signature or replay token disclosed",()=>{
 const r=run();
 assert.equal(r.approvalCannotBeGeneratedByThisTool,true);
 const body=JSON.stringify(r);
 for(const needle of ["privateKey","accessToken","service_role",
  "reviewerEmail","signatureValue","userPhone"])
  assert.equal(body.includes(needle),false);
});
