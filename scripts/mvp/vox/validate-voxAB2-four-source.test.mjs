import test from "node:test";
import assert from "node:assert/strict";
import {attestAb2FourSourceReviewWindow as attest}
 from "../../../contracts/vox/ab2FourSourceReadiness.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={userId:id(1),teamId:id(2),cityId:id(3),
 currentAal:"aal2",canReadContent:true,canMutate:false};
const businessDate="2026-10-16";
const names=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const seals=names.map((source,i)=>({source,staffId:scope.userId,
 cityId:scope.cityId,teamId:scope.teamId,businessDate,
 eventCount:i+1,lastRevision:i+1,sourceSha256:String(i+1).repeat(64),
 attributableStaffOnly:true,watermarkSignatureVerified:true,
 currentGrantProvenanceVerified:true}));
const args=()=>({scope,businessDate,sourceSeals:seals,
 verifyCurrentStaff:async()=>true,verifyDbSourceSeal:async()=>true,
 verifyExactSourceObjectGrants:async()=>true,now:Date.parse("2026-10-17T14:00:00Z")});
test("AB2 complete source proof is only review candidate, never official EOD",async()=>{
 const r=await attest(args());assert.equal(r.ok,true);
 assert.equal(r.sourceCount,4);assert.equal(r.official,false);
 assert.equal(r.eligibleForOfficialSubmission,false);
 assert.equal(r.requiresCoreAtomicSnapshotRecheck,true);
 assert.equal(r.requiresIndependentTeamLeaderAal2,true);
});
test("AB2 requires every source and rejects duplicate/fake sources",async()=>{
 for(const sourceSeals of [seals.slice(0,3),
  [seals[0],seals[0],seals[1],seals[2]],
  [...seals.slice(0,3),{...seals[3],source:"UNTRUSTED"}]]){
  assert.equal((await attest({...args(),sourceSeals})).ok,false);
 }
});
test("AB2 cannot count AI/provider/historical non-attributed events as Staff",async()=>{
 for(const changed of [
  {attributableStaffOnly:false},
  {watermarkSignatureVerified:false},
  {currentGrantProvenanceVerified:false},
  {staffId:id(90)},{sourceSha256:"unsigned"},
  {eventCount:-1}
 ]){
  assert.equal((await attest({...args(),
   sourceSeals:[{...seals[0],...changed},...seals.slice(1)]})).ok,false);
 }
});
test("AB2 revoked grants or modified DB source seal denies entire EOD",async()=>{
 for(const key of ["verifyCurrentStaff","verifyDbSourceSeal",
  "verifyExactSourceObjectGrants"]){
  const r=await attest({...args(),[key]:async()=>false});
  assert.equal(r.ok,false);assert.equal(r.sourceCount,0);
 }
});
test("AB2 checks Staff grants both before and after all source proof",async()=>{
 let calls=0;
 const r=await attest({...args(),
  verifyCurrentStaff:async()=>++calls===1});
 assert.equal(calls,2);assert.equal(r.ok,false);
});
