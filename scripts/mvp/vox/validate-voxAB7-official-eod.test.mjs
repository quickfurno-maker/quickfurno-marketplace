import test from "node:test";import assert from "node:assert/strict";
import {submitAb7FourSourceEod as submit,acknowledgeAb7Eod as ack}
 from "../../../contracts/vox/ab7OfficialEod.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const actor={userId:id(1),teamId:id(2),cityId:id(3),aal:"aal2",isNeutralStaff:true};
const day="2026-10-17";
const names=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
function input(){return {actor,reportId:id(4),nonce:id(5),businessDate:day,
 signedFourSourceProof:{ok:true,schema:"qf.vox.ab3.signed-four-source-review-readiness.v1",
  signatureVerifiedForAllFour:true,sourceCount:4,businessDate:day,
  official:false,sources:names.map(source=>({source}))},
 verifyCurrentStaffAal2:async()=>true,
 verifyFourCurrentDbSourceSeals:async()=>true,
 atomicCoreSubmission:async x=>({persisted:true,reportId:x.reportId,
  nonce:x.nonce,state:x.state,sourcesRecheckedInTransaction:4,
  staffRecheckedInTransaction:true,uniqueNonceConsumedInTransaction:true,
  official:false,independentTlAcknowledged:false})};}
test("AB7D four signed sources submit only to pending independent TL",async()=>{
 const x=await submit(input());assert.equal(x.ok,true);
 assert.equal(x.official,false);assert.equal(x.acknowledged,false);
});
test("AB7D missing signed source, revoked actor and missing DB seal deny",async()=>{
 const base=input();
 for(const patch of [
  {actor:{...actor,aal:"aal1"}},
  {signedFourSourceProof:{...base.signedFourSourceProof,sourceCount:3}},
  {signedFourSourceProof:{...base.signedFourSourceProof,signatureVerifiedForAllFour:false}},
  {verifyCurrentStaffAal2:async()=>false},
  {verifyFourCurrentDbSourceSeals:async()=>false}
 ]){
  const x=await submit({...base,...patch});assert.equal(x.ok,false);
 }
});
test("AB7D forged Core receipt cannot label EOD official",async()=>{
 const base=input(),old=base.atomicCoreSubmission;
 for(const p of [
  {sourcesRecheckedInTransaction:3},{official:true},
  {independentTlAcknowledged:true},{uniqueNonceConsumedInTransaction:false}
 ]){
  const r=await submit({...base,atomicCoreSubmission:async x=>({...await old(x),...p})});
  assert.equal(r.ok,false);
 }
});
function review(){return {reportId:id(4),staffUserId:id(1),
 teamLeader:{userId:id(6),aal:"aal2",role:"team_leader"},
 expectedRevision:1,decision:"ACKNOWLEDGE",
 verifyCurrentTlAal2:async()=>true,
 verifyCurrentReportUnchanged:async()=>true,
 atomicCoreTlAck:async x=>({reportId:x.reportId,
  reviewerId:x.reviewerId,revision:x.expectedRevision+1,
  decision:x.decision,tlRecheckedInTransaction:true,
  sourcesRecheckedInTransaction:4,actorDistinctRecheckedInTransaction:true,
  providerMessagesSent:0})};}
test("AB7D distinct TL ACK receipt marks report independently reviewed",async()=>{
 const r=await ack(review());assert.equal(r.ok,true);
 assert.equal(r.acknowledged,true);assert.equal(r.providerMessagesSent,0);
});
test("AB7D self-review/stale revision/current TL revocation denied",async()=>{
 const x=review();
 for(const p of [
  {teamLeader:{...x.teamLeader,userId:id(1)}},
  {expectedRevision:0},
  {verifyCurrentTlAal2:async()=>false},
  {verifyCurrentReportUnchanged:async()=>false}
 ]){
  assert.equal((await ack({...x,...p})).ok,false);
 }
});
