import test from "node:test";
import assert from "node:assert/strict";
import {prepareAb7StaffLifecycle as prepare}
 from "../../../contracts/vox/ab7StaffLifecycle.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const actor={id:id(1),aal:"aal2",coreRole:"superadmin"};
const reviewer={id:id(2),aal:"aal2",voxRole:"team_leader",teamId:id(4),cityId:id(5)};
const target={id:id(3),teamId:id(4),cityId:id(5),isNeutralStaff:true,
 isActive:true,revision:7};
function args(){return {operation:"SUSPEND",actor,reviewer,target,nonce:id(6),
 expectedRevision:7,verifyOwnerCurrentAal2:async()=>true,
 verifyIndependentReviewerCurrentAal2:async()=>true,
 verifyTargetCurrentMembership:async()=>true,
 queueAtomicPendingAction:async x=>({
  state:"PENDING_INDEPENDENT_REVIEW",targetStaffId:x.targetStaffId,
  nonce:x.nonce,expectedRevision:x.expectedRevision,persisted:true,
  grantsChanged:false,authSessionTerminated:false,
  coreGrantsRecheckedInTransaction:true,
  reviewerRecheckedInTransaction:true,nonceUniqueInTransaction:true})};}
test("AB7A valid independent suspension only queues a pending action",async()=>{
 const r=await prepare(args());assert.equal(r.ok,true);
 assert.equal(r.state,"PENDING_INDEPENDENT_REVIEW");
 assert.equal(r.accessRevoked,false);
 assert.equal(r.authSessionTerminated,false);
 assert.equal(r.grantsChanged,false);
});
test("AB7A rejects owner self review, revoked reviewer, stale target",async()=>{
 for(const patch of [
  {reviewer:{...reviewer,id:actor.id}},
  {reviewer:{...reviewer,aal:"aal1"}},
  {actor:{...actor,aal:"aal1"}},
  {target:{...target,revision:8}},
  {target:{...target,isNeutralStaff:false}},
  {target:{...target,isActive:false}},
  {operation:"CREATE_SUPERADMIN"},
  {expectedRevision:-1},
  {nonce:"user specified"}
 ]){
  assert.equal((await prepare({...args(),...patch})).ok,false);
 }
});
test("AB7A rejected current grants or no pending store never revokes",async()=>{
 for(const key of ["verifyOwnerCurrentAal2",
  "verifyIndependentReviewerCurrentAal2","verifyTargetCurrentMembership"]){
  const x=await prepare({...args(),[key]:async()=>false});
  assert.equal(x.ok,false);assert.equal(x.accessRevoked,false);
 }
 const store=await prepare({...args(),queueAtomicPendingAction:async()=>null});
 assert.equal(store.ok,false);
});
test("AB7A forged receipt claiming active grants fails",async()=>{
 const origin=args();
 for(const part of [
  {grantsChanged:true},{authSessionTerminated:true},
  {nonceUniqueInTransaction:false},
  {reviewerRecheckedInTransaction:false},
  {state:"EXECUTED"}
 ]){
  const original=origin.queueAtomicPendingAction;
  const x=await prepare({...origin,
   queueAtomicPendingAction:async y=>({...await original(y),...part})});
  assert.equal(x.ok,false);
 }
});
