import test from "node:test";import assert from "node:assert/strict";
import {submitVerifiedFourSourceEod as submit}
 from "../../../contracts/vox/f1OfficialEodTransitions.mjs";
import {sourceEventChecksum,signEodReaderWatermark}
 from "../../../contracts/vox/f1CertifiedFourSourceEod.mjs";
import {requiredAttributableSources as sources}
 from "../../../contracts/vox/l9FourSourceEodEvidence.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={userId:id(1),teamId:id(2),cityId:id(3),
 currentAal:"aal2",canReadContent:true,canMutate:false};
const businessDate="2026-10-15",start=Date.parse(businessDate+"T00:00:00+05:30");
const now=start+86400000+60000,secret="F1_SYNTHETIC_SIGNING_KEY_NEVER_INSTALL_000000";
const event={id:id(4),source:"CRM_AAROHI",actor_id:id(1),team_id:id(2),
 city_id:id(3),object_id:id(5),revision:1,event_kind:"FOLLOW_UP",
 occurred_at:new Date(start+1000).toISOString(),
 subject_kind:"prospect",subject_id:id(6)};
const fixtures=()=>{
 const events=[event],marks=sources.map(source=>{
  const rows=events.filter(e=>e.source===source);
  const r={source,actor_id:id(1),team_id:id(2),city_id:id(3),
   business_date:businessDate,cursor_start:new Date(start).toISOString(),
   cursor_end:new Date(start+86400000).toISOString(),
   event_checksum:sourceEventChecksum(rows),
   signed_at:new Date(now-5000).toISOString()};
  return {...r,signature:signEodReaderWatermark({row:r,secret})};
 });
 return {events,marks};
};
const db=f=>({from(table){
 const t=table==="vox_staff_source_events_candidate_v1"?f.events:f.marks;
 const clauses=[];
 const b={select(){return b;},eq(k,v){clauses.push([k,"eq",v]);return b;},
  gte(k,v){clauses.push([k,"gte",v]);return b;},
  lt(k,v){clauses.push([k,"lt",v]);return b;},
  limit(n){return Promise.resolve({error:null,
   data:t.filter(x=>clauses.every(([k,op,v])=>op==="eq"?x[k]===v:
    op==="gte"?x[k]>=v:x[k]<v)).slice(0,n)});}};
 return b;
}});
const make=()=>{
 const f=fixtures();let commits=0;
 const args={db:db(f),scope,businessDate,secret,nonce:id(7),now,
 verifyCurrentScope:async()=>true,verifyExactObjectGrant:async()=>true,
 commitRecheckedSnapshot:async s=>{commits++;return {
  reportId:id(8),state:"PENDING_REVIEW",revision:0,
  eventCount:s.expectedTotal,sourcesSealed:4,
  staffGrantsRecheckedInTransaction:true,
  snapshotRecheckedInTransaction:true,nonceConsumedInTransaction:true};}};
 return {f,args,get commits(){return commits;}};
};
test("all four sealed windows and DB-checked receipt allow official proposal",async()=>{
 const x=make(),r=await submit(x.args);
 assert.equal(r.ok,true);assert.equal(r.official,true);
 assert.equal(r.eventCount,1);assert.equal(r.state,"PENDING_REVIEW");
 assert.equal(r.providerMessagesSent,0);assert.equal(x.commits,1);
});
test("source absence, revoked grant and falsified event block DB commit",async()=>{
 for(const change of [
  x=>x.f.marks.pop(),
  x=>x.f.events.push({...event,id:id(30)}),
  x=>{x.args.verifyExactObjectGrant=async()=>false;},
  x=>{x.args.verifyCurrentScope=async()=>false;}
 ]){
  const x=make();change(x);const r=await submit(x.args);
  assert.equal(r.ok,false);assert.equal(x.commits,0);
 }
});
test("unverified SQL receipt cannot authorize official total",async()=>{
 for(const change of [{sourcesSealed:3},
  {nonceConsumedInTransaction:false},{staffGrantsRecheckedInTransaction:false},
  {snapshotRecheckedInTransaction:false},{eventCount:42}]){
  const x=make();x.args.commitRecheckedSnapshot=async s=>({
   reportId:id(8),state:"PENDING_REVIEW",revision:0,
   eventCount:s.expectedTotal,sourcesSealed:4,
   staffGrantsRecheckedInTransaction:true,
   snapshotRecheckedInTransaction:true,nonceConsumedInTransaction:true,...change});
  assert.equal((await submit(x.args)).ok,false);
 }
});
