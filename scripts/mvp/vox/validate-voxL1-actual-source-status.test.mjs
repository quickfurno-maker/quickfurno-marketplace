import test from "node:test";import assert from "node:assert/strict";
import {projectActualStaffSourceStatus as project} from "../../../contracts/vox/actualEodSourceStatus.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={userId:id(1),teamId:id(2),cityId:id(3),role:"support_agent",canReadContent:true,canMutate:false};
const sources=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const observations=()=>sources.map(source=>({source,readerState:"NO_GRANTED_OBJECTS",
 currentScopeVerified:true,eventProvenance:source==="CORE_WORK_LEDGER"?"CORE_WORK_ONLY":"NOT_PROVEN"}));
const run=(obs=observations(),s=scope)=>project({scope:s,observations:obs,businessDate:"2026-10-16"});
test("four actual Core source readers are reported, never certified total",()=>{
 const r=run();assert.equal(r.ok,true);assert.equal(r.sources.length,4);
 assert.equal(r.allSourceReady,false);assert.equal(r.rollup,null);
 assert.equal(r.canSubmit,false);assert.equal(r.providerMessagesSent,0);
});
test("a reachable external object does not invent employee activity event",()=>{
 const o=observations();o[1].readerState="AVAILABLE";
 const r=run(o);assert.equal(r.ok,true);assert.equal(r.sources[1].eventProvenance,"NOT_PROVEN");
 assert.equal(r.rollup,null);
});
test("reject privileged reviewer, revoked city and wrong scope",()=>{
 for(const x of [{...scope,canReadContent:false},{...scope,canMutate:true},
 {...scope,cityId:"BAD"},{...scope,userId:"NOT_CURRENT"}]){
  assert.equal(run(observations(),x).ok,false);
 }
});
test("duplicate, unknown, missing or cross-source rows rejected",()=>{
 const o=observations();o[1]={...o[0]};
 assert.equal(run(o).ok,false);
 const unknown=observations();unknown[0].source="JARVIS_ANY";
 assert.equal(run(unknown).ok,false);
 assert.equal(run(observations().slice(1)).ok,false);
});
test("agent provenance cannot be forged by claiming an audited watermark",()=>{
 const o=observations();o[2].eventProvenance="CORE_WORK_ONLY";
 assert.equal(run(o).ok,false);
 const extra=observations();extra[1].phone="PRIVATE";
 assert.equal(run(extra).ok,false);
});
test("reader state AVAILABLE requires independent Core exact scope",()=>{
 const o=observations();o[1].readerState="AVAILABLE";o[1].currentScopeVerified=false;
 assert.equal(run(o).ok,false);
});
test("unavailable and grant-unverified remain explicit, not zero counts",()=>{
 const o=observations();o[1].readerState="UNAVAILABLE";o[3].readerState="GRANT_UNVERIFIED";
 const r=run(o);assert.equal(r.ok,true);assert.equal(r.sources[1].readiness,"UNAVAILABLE");
 assert.equal(r.sources[3].readiness,"GRANT_UNVERIFIED");
 assert.equal(r.rollup,null);assert.equal(r.totalKnown,undefined);
});
test("source route remains GET only and independently feature gated",async()=>{
 const {readFileSync}=await import("node:fs");
 const t=readFileSync(new URL("../../../app/api/vox/v1/eod-source-status/route.ts",import.meta.url),"utf8");
 assert.match(t,/getVerifiedScopedStaff/);
 assert.match(t,/VOX_EOD_SOURCE_READINESS_ENABLED/);
 assert.match(t,/export function POST\(\)/);
 assert.doesNotMatch(t,/sendWhatsapp\(|service_role\s*:/i);
});