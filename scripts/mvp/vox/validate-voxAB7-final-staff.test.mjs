import test from "node:test";
import assert from "node:assert/strict";
import {executeReviewedStaffAccessFence as run} from "../../../contracts/vox/ab7StaffRevocationExecution.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const owner={id:id(1),aal:"aal2",coreRole:"superadmin"};
const reviewer={id:id(2),aal:"aal2",voxRole:"team_leader",teamId:id(4),cityId:id(5)};
const target={id:id(3),teamId:id(4),cityId:id(5),revision:3};
const review={decisionId:id(8),action:"SUSPEND",state:"APPROVED",
 ownerId:id(1),reviewerId:id(2),targetId:id(3),expectedRevision:3,
 nonce:id(9),signaturesVerified:true};
function spec(){const calls=[];return {...{enabled:true,environment:"staging",
 owner,reviewer,target,review,nonce:id(9),
 verifyCurrentOwnerAal2:async()=>true,verifyCurrentTlAal2:async()=>true,
 verifyImmutableDecision:async()=>true,
 atomicCoreRevoke:async i=>{calls.push(i);return {
  decisionId:i.decisionId,targetId:i.targetId,nonce:i.nonce,
  revision:i.expectedRevision+1,state:"SUSPENDED",
  membershipRevoked:true,departmentCapabilitiesRevoked:true,objectScopesRevoked:true,
  auditedAtomically:true,currentReviewRechecked:true,oneUseNonceConsumed:true,
  authProviderSessionsInvalidated:false};}},calls};}
test("AB7A explicit stage gate denies before any Core call",async()=>{
 for(const patch of [{enabled:false},{environment:"production"},
  {review:{...review,signaturesVerified:false}},
  {reviewer:{...reviewer,id:owner.id}},
  {reviewer:{...reviewer,aal:"aal1"}},
  {target:{...target,revision:4}}]){
  const s=spec();const r=await run({...s,...patch});
  assert.equal(r.ok,false);assert.equal(s.calls.length,0);
 }
});
test("AB7A independently reviewed suspension fences Core but NOT GoTrue sessions",async()=>{
 const s=spec(),r=await run(s);assert.equal(r.ok,true);
 assert.equal(s.calls.length,1);assert.equal(r.accessRevocationVerified,true);
 assert.equal(r.authSessionsInvalidated,false);
 assert.equal(r.state,"CORE_ACCESS_SUSPENDED_AUTH_RECONCILIATION_PENDING");
});
test("AB7A current owner, TL, decision all rechecked; outage denies",async()=>{
 for(const k of ["verifyCurrentOwnerAal2","verifyCurrentTlAal2",
  "verifyImmutableDecision"]){
  const s=spec();
  assert.equal((await run({...s,[k]:async()=>false})).ok,false);
  assert.equal(s.calls.length,0);
 }
});
test("AB7A incomplete partial DB or forged Auth-session claims never passes",async()=>{
 for(const p of [{objectScopesRevoked:false},{authProviderSessionsInvalidated:true},
  {oneUseNonceConsumed:false},{currentReviewRechecked:false},{revision:5}]){
  const s=spec(),fn=s.atomicCoreRevoke;
  const r=await run({...s,atomicCoreRevoke:async i=>({...await fn(i),...p})});
  assert.equal(r.ok,false);assert.equal(r.authSessionsInvalidated,false);
 }
});
