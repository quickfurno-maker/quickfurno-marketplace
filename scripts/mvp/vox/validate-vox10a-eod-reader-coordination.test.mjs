import test from "node:test";import assert from "node:assert/strict";
import {gatherStaffEodSources as gather} from "../../../contracts/vox/fourSourceEodCoordinator.mjs";
import {EOD_SOURCES} from "../../../contracts/vox/allSourceEodEvidence.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-17T05:00:00Z");
const scope={userId:id(1),teamId:id(2),cityId:id(3),
 role:"support_agent",canReadContent:true,canMutate:false,
 prospectIds:[],vendorIds:[],supportThreadIds:[],conversationIds:[]};
const proof=s=>({source:s,events:[],sourceWatermark:null,
 readerProof:{trust:"CORE_SERVER_READ_ONLY",staffId:scope.userId,
  teamId:scope.teamId,cityId:scope.cityId,scopeRevision:1,
  committedAt:"2026-10-17T04:59:00Z"}});
const run=(readSource,context=scope)=>gather({
 context,businessDate:"2026-10-16",now,readSource});
test("requires current grant and real injected Core reader",async()=>{
 assert.equal((await gather()).ok,false);
 assert.equal((await run(null)).ok,false);
 assert.equal((await run(async()=>proof("CORE_WORK_LEDGER"),
 {...scope,canMutate:true})).ok,false);
});
test("all four reader streams still cannot certify all-source EOD",async()=>{
 const seen=[];
 const r=await run(async x=>{seen.push(x);return proof(x.source)});
 assert.equal(r.ok,true);assert.equal(r.sourcesClaimed,4);
 assert.deepEqual(new Set(seen.map(x=>x.source)),new Set(EOD_SOURCES));
 assert.equal(r.rollup,null);assert.equal(r.allSourceTotalCertified,false);
 assert.equal(r.canSubmit,false);assert.equal(r.canExport,false);
 assert.equal(r.providerMessagesSent,0);
 assert.equal(r.completeness,"INCOMPLETE_OR_UNVERIFIED");
});
test("missing CRM or agent reader never creates a false zero-total",async()=>{
 for(const unavailable of EOD_SOURCES){
  const r=await run(async x=>{
   if(x.source===unavailable)throw Error("UPSTREAM_MISSING");
   return proof(x.source);
  });
  assert.equal(r.ok,true);
  assert.equal(r.sourcesClaimed,3);
  assert.equal(r.rollup,null);
  assert.equal(r.sourceStatus.find(x=>x.source===unavailable).status,"READER_UNAVAILABLE");
 }
});
test("reader may not claim another source, Staff, team or city",async()=>{
 for(const changed of [
  {source:"CRM_AAROHI"},
  {readerProof:{...proof("CORE_WORK_LEDGER").readerProof,staffId:id(98)}},
  {readerProof:{...proof("CORE_WORK_LEDGER").readerProof,cityId:id(99)}},
  {readerProof:{...proof("CORE_WORK_LEDGER").readerProof,teamId:id(99)}},
  {customerPhone:"SECRET"}
 ]){
  const r=await run(async x=>x.source==="CORE_WORK_LEDGER"?
   {...proof(x.source),...changed}:proof(x.source));
  assert.equal(r.ok,false);
  assert.equal(r.rollup,null);
 }
});
test("bad source watermark can't become signed reader or official report",async()=>{
 const r=await run(async x=>({
  ...proof(x.source),
  sourceWatermark:{watermarkId:id(40),completeThrough:"2026-10-16T18:30:00Z",
   readerVersion:"fake",origin:"CORE_VERIFIED_READER"}
 }));
 assert.equal(r.ok,true);
 assert.equal(r.completeness,"FOUR_SOURCE_ASSERTIONS_NOT_AUDITED");
 assert.equal(r.rollup,null);
 assert.equal(r.requiresSignedReaders,true);
});
test("overbound events and unexpected PII are rejected",async()=>{
 const r=await run(async x=>({
  ...proof(x.source),
  events:x.source==="CORE_WORK_LEDGER"?
   Array.from({length:101},()=>({phone:"private"})):[]
 }));
 assert.equal(r.ok,false);
});
test("no mutation or provider send exposed",async()=>{
 const r=await run(async x=>proof(x.source));
 const text=JSON.stringify(r);
 assert.equal(text.includes("providerToken"),false);
 assert.equal(text.includes("clientId"),false);
 assert.equal(r.canAcknowledge,false);
});
