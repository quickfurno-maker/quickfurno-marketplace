import test from "node:test";import assert from "node:assert/strict";
import {inspectAb7InAppOutbox as inspect}
 from "../../../contracts/vox/ab7InAppOutboxAdvisory.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-18T08:30:00Z");
const viewer={role:"superadmin",currentAal:"aal2"};
const rows=[
 {id:id(1),state:"PENDING",attempts:1,sourceVerified:true,
  nextAttemptAt:new Date(now-120000).toISOString(),leaseUntil:null},
 {id:id(2),state:"LEASED",attempts:3,sourceVerified:true,
  nextAttemptAt:new Date(now-200000).toISOString(),
  leaseUntil:new Date(now-1000).toISOString()},
 {id:id(3),state:"DEAD_LETTER",attempts:5,sourceVerified:true,
  nextAttemptAt:new Date(now-1000).toISOString(),leaseUntil:null}
];
const args=()=>({enabled:true,viewer,rows,now,
 verifyCurrentOwner:async()=>true,verifyCurrentSource:async()=>true});
test("AB7E advisories identify stalled queue but NEVER start worker",async()=>{
 const x=await inspect(args());assert.equal(x.ok,true);
 assert.equal(x.overdue,1);assert.equal(x.staleLease,1);
 assert.equal(x.states.DEAD_LETTER,1);
 assert.equal(x.needsManualReview,true);
 assert.equal(x.runAuthorized,false);assert.equal(x.providerMessagesSent,0);
});
test("AB7E denied when flag off, viewer revoked or non-MFA",async()=>{
 for(const patch of [
  {enabled:false},{viewer:{role:"superadmin",currentAal:"aal1"}},
  {viewer:{role:"team_leader",currentAal:"aal2"}},
  {verifyCurrentOwner:async()=>false}
 ])assert.equal((await inspect({...args(),...patch})).ok,false);
});
test("AB7E duplicate, forged state, unknown transport rows cause global denial",async()=>{
 const scenarios=[
  [...rows,rows[0]],
  [{...rows[0],sourceVerified:false}],
  [{...rows[0],state:"WHATSAPP_PENDING"}],
  [{...rows[0],phone:"private"}],
  [{...rows[1],leaseUntil:null}],
  [{...rows[2],attempts:7}]
 ];
 for(const v of scenarios){
  const x=await inspect({...args(),rows:v});assert.equal(x.ok,false);
  assert.equal(x.providerMessagesSent,0);
 }
});
test("AB7E source revocation and owner change during evaluation deny",async()=>{
 assert.equal((await inspect({...args(),
  verifyCurrentSource:async()=>false})).ok,false);
 let n=0;assert.equal((await inspect({...args(),
  verifyCurrentOwner:async()=>++n===1})).ok,false);
});
