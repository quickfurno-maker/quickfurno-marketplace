import test from "node:test";
import assert from "node:assert/strict";
import {loadPendingTl,savePendingTl,clearPendingTl,validTlIntent}
 from "../../../apps/vox-web/lib/vo05PendingTlAssignment.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const intent={itemId:id(1),targetStaffId:id(2),nonce:id(3),
 expectedRevision:0,reason:"Team allocation"};
const receipt={ok:true,schema:"qf.vox.tl.assignment.receipt.v1",
 itemId:id(1),targetStaffId:id(2),nonce:id(3),revision:1,
 externalMessagesSent:0,vendorAssignmentsChanged:0,moneyMinorUnits:0};
const store=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,
 setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
test("original Team Leader nonce recovered across reload; conflicting intent locked",()=>{
 const s=store();assert.equal(savePendingTl(s,intent),true);
 assert.deepEqual(loadPendingTl(s).pending,intent);
 assert.equal(savePendingTl(s,intent),true);
 for(const next of [{...intent,nonce:id(7)},{...intent,targetStaffId:id(8)},
  {...intent,itemId:id(9)},{...intent,expectedRevision:1}]){
  assert.equal(savePendingTl(s,next),false);
  assert.equal(clearPendingTl(s,next,receipt),false);
 }
 assert.deepEqual(loadPendingTl(s).pending,intent);
});
test("Only exact Core receipt can unlock; no invented money or provider sends",()=>{
 const s=store();savePendingTl(s,intent);
 const bad=[{...receipt,ok:false},{...receipt,nonce:id(88)},
  {...receipt,targetStaffId:id(9)},{...receipt,revision:0},
  {...receipt,moneyMinorUnits:1},{...receipt,externalMessagesSent:1},
  {...receipt,vendorAssignmentsChanged:1},{...receipt,madeUp:true}];
 for(const x of bad){
  assert.equal(clearPendingTl(s,intent,x),false);
  assert.deepEqual(loadPendingTl(s).pending,intent);
 }
 assert.equal(clearPendingTl(s,intent,receipt),true);
 assert.equal(loadPendingTl(s).pending,null);
});
test("TL browser never chooses actor/team/city or marketplace credit",()=>{
 for(const changes of [{actorId:id(12)},{teamId:id(13)},
  {cityId:id(14)},{vendorLeadId:id(15)},{money:500},
  {reason:"spaces  "},{reason:"line\nbreak"},{nonce:"bad"},
  {expectedRevision:2147483647}]){
  assert.equal(validTlIntent({...intent,...changes}),false);
 }
 assert.equal(loadPendingTl(null).available,false);
 assert.equal(savePendingTl(null,intent),false);
 assert.equal(loadPendingTl({getItem:()=>"{broken"}).available,false);
});
