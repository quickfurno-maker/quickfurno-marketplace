import test from "node:test";
import assert from "node:assert/strict";
import {previewAttributableFourSourceEod as preview,requiredAttributableSources}
 from "../../../contracts/vox/l9FourSourceEodEvidence.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const start=Date.parse("2026-10-15T18:30:00.000Z"),end=start+86400000;
const scope={userId:id(1),teamId:id(2),cityId:id(3),
 currentAal:"aal2",canReadContent:true,canMutate:false};
const event={id:id(31),actorId:id(1),teamId:id(2),cityId:id(3),
 objectId:id(45),revision:3,occurredAtMs:start+1000,kind:"FOLLOW_UP"};
const reading=source=>({source,cursorStartMs:start,cursorEndMs:end,events:[]});
const sources=requiredAttributableSources.map(reading);
const authorized={verifyCurrentScope:async()=>true,verifyReading:async()=>true};
const go=p=>preview({scope,businessDate:"2026-10-16",
 window:{startMs:start,endMs:end},readings:sources,...authorized,...p});
test("complete four mock source snapshots yield preview not official submission",async()=>{
 const r=await go({readings:sources.map((v,i)=>i? v:
  {...v,events:[event]})});
 assert.equal(r.ok,true);assert.equal(r.rollup.totalEvents,1);
 assert.equal(r.canSubmit,false);assert.equal(r.providerMessagesSent,0);
});
test("missing reader and incomplete cursor never imply zero-work performance",async()=>{
 assert.equal((await go({readings:sources.slice(1)})).rollup,null);
 assert.equal((await go({readings:sources.map((v,i)=>
  i===1?{...v,cursorEndMs:end-1}:v)})).ok,false);
});
test("cross-user, city, team, time, unknown action and replay denied",async()=>{
 for(const e of [{...event,actorId:id(99)},{...event,cityId:id(99)},
  {...event,teamId:id(99)},{...event,occurredAtMs:end},
  {...event,kind:"unsafe text!"}]){
  const r=await go({readings:sources.map((v,i)=>i? v:{...v,events:[e]})});
  assert.equal(r.ok,false);
 }
 assert.equal((await go({readings:sources.map((v,i)=>i===0||i===1?
  {...v,events:[event]}:v)})).ok,false);
});
test("current scope or independent verifier denial forbids rollup",async()=>{
 assert.equal((await go({scope:{...scope,currentAal:"aal1"}})).ok,false);
 assert.equal((await go({verifyCurrentScope:async()=>false})).ok,false);
 assert.equal((await go({verifyReading:async()=>false})).ok,false);
 assert.equal((await go({verifyReading:async()=>{throw Error("DB offline")}})).ok,false);
});
test("business day requires complete 24-hour UTC window, never short sampling",async()=>{
 assert.equal((await go({window:{startMs:start,endMs:end-5000}})).ok,false);
});
