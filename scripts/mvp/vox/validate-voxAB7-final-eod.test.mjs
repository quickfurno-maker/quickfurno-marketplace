import test from "node:test";import assert from "node:assert/strict";
import {prepareOfficialEodPublication as prepare} from "../../../contracts/vox/ab7OfficialEodSealGate.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const source=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const report={id:id(1),staffUserId:id(2),teamId:id(3),cityId:id(4),
 businessDate:"2026-10-17",revision:2,state:"INDEPENDENTLY_ACKNOWLEDGED",
 official:false,reviewerId:id(5)};
const teamLeader={id:id(5),role:"team_leader",currentAal:"aal2",
 teamId:id(3),cityId:id(4)};
const sourceSeals=source.map(x=>({source:x,signatureVerified:true,sha256:"a".repeat(64),
 staffUserId:id(2),teamId:id(3),cityId:id(4),businessDate:"2026-10-17"}));
const opts=()=>({report,sourceSeals,teamLeader,nonce:id(6),
 verifyPinnedSourceSignatures:async()=>true,verifyCurrentReportDb:async()=>true,
 verifyCurrentTlAal2:async()=>true,verifyImmutableIndependentAck:async()=>true});
test("AB7D official EOD requires authentic four-source TL-reviewed proposal only",async()=>{
 const r=await prepare(opts());assert.equal(r.ok,true,r.reason);
 assert.equal(r.official,false);assert.equal(r.published,false);
 assert.equal(r.state,"PENDING_ATOMIC_CORE_PUBLICATION");
});
test("AB7D missing/duplicated signature, changed report, self review deny",async()=>{
 const patches=[{sourceSeals:sourceSeals.slice(0,3)},
  {sourceSeals:[sourceSeals[0],sourceSeals[0],sourceSeals[2],sourceSeals[3]]},
  {sourceSeals:sourceSeals.map((x,i)=>i?x:{...x,signatureVerified:false})},
  {report:{...report,official:true}},
  {report:{...report,reviewerId:id(2)}},
  {teamLeader:{...teamLeader,currentAal:"aal1"}},
  {teamLeader:{...teamLeader,id:id(2)}},
  {report:{...report,revision:1}}];
 for(const p of patches)assert.equal((await prepare({...opts(),...p})).ok,false);
});
test("AB7D current database, pinned signatures and reviewer failures deny",async()=>{
 for(const key of ["verifyPinnedSourceSignatures","verifyCurrentReportDb",
  "verifyCurrentTlAal2","verifyImmutableIndependentAck"]){
  assert.equal((await prepare({...opts(),[key]:async()=>false})).ok,false);
  assert.equal((await prepare({...opts(),[key]:async()=>{throw Error("outage")}})).ok,false);
 }
});
