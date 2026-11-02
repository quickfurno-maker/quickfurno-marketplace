import test from "node:test";
import assert from "node:assert/strict";
import {readPendingTimeCommand,savePendingTimeCommand,clearPendingTimeCommand}
 from "../../../apps/vox-web/lib/vo03PendingStaffTime.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const cmd={action:"TASK_START",nonce:id(1),expectedRevision:4,workItemId:id(2)};
const receipt={schema:"qf.vox.staff.time.receipt.v1",nonce:id(1),revision:5,
 eventId:id(3),occurredAt:"2026-11-03T01:00:00.000Z",
 providerMessagesSent:0,moneyMinorUnits:0,productionCertified:false};
function store(){
 const m=new Map();
 return {getItem:k=>m.has(k)?m.get(k):null,
 setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};
}
test("VO3 original timer command survives tab reload, no new nonce minted",()=>{
 const s=store();
 assert.equal(savePendingTimeCommand(s,cmd),true);
 assert.deepEqual(readPendingTimeCommand(s).pending,cmd);
 assert.equal(savePendingTimeCommand(s,cmd),true);
 assert.deepEqual(readPendingTimeCommand(s).pending,cmd);
});
test("VO3 pending command rejects another work item, action or nonce",()=>{
 const s=store();savePendingTimeCommand(s,cmd);
 for(const changed of [{...cmd,action:"TASK_STOP"},{...cmd,workItemId:id(99)},
  {...cmd,nonce:id(20)},{...cmd,expectedRevision:5}]){
  assert.equal(savePendingTimeCommand(s,changed),false);
  assert.equal(clearPendingTimeCommand(s,changed,receipt),false);
 }
 assert.deepEqual(readPendingTimeCommand(s).pending,cmd);
});
test("VO3 no browser-derived clock, role, money or external send fields",()=>{
 const s=store();
 for(const data of [{...cmd,elapsedMs:6000},{...cmd,actorId:id(2)},
  {...cmd,serverAt:"2026-11-03"},{...cmd,role:"team_leader"},
  {...cmd,moneyMinorUnits:1},{...cmd,externalMessagesSent:1}]){
  assert.equal(savePendingTimeCommand(s,data),false);
 }
});
test("VO3 only exact validated Core receipt clears a pending timer",()=>{
 const s=store();savePendingTimeCommand(s,cmd);
 for(const bad of [{...receipt,nonce:id(22)},{...receipt,revision:4},
  {...receipt,providerMessagesSent:1},{...receipt,productionCertified:true},
  {...receipt,moneyMinorUnits:1},{...receipt,eventId:"x"},
  {...receipt,unknown:true}]){
  assert.equal(clearPendingTimeCommand(s,cmd,bad),false);
  assert.deepEqual(readPendingTimeCommand(s).pending,cmd);
 }
 assert.equal(clearPendingTimeCommand(s,cmd,receipt),true);
 assert.equal(readPendingTimeCommand(s).pending,null);
});
test("VO3 unavailable, broken or untrusted storage fails closed",()=>{
 const s={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
 assert.equal(savePendingTimeCommand(s,cmd),false);
 assert.equal(clearPendingTimeCommand(s,cmd,receipt),false);
 assert.equal(readPendingTimeCommand(null).available,false);
 assert.equal(readPendingTimeCommand({getItem:()=>"{broken"}).available,false);
});
test("VO3 attendance command omits work item and retains its own nonce",()=>{
 const s=store(),clock={action:"CLOCK_IN",nonce:id(5),expectedRevision:0};
 assert.equal(savePendingTimeCommand(s,clock),true);
 assert.deepEqual(readPendingTimeCommand(s).pending,clock);
 assert.equal(savePendingTimeCommand(s,{...clock,workItemId:id(6)}),false);
});
