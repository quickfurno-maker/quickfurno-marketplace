import test from "node:test";
import assert from "node:assert/strict";
import {readCertifiedFourSourceEod as read,sourceEventChecksum,
 signEodReaderWatermark} from "../../../contracts/vox/f1CertifiedFourSourceEod.mjs";
import {requiredAttributableSources as sources}
 from "../../../contracts/vox/l9FourSourceEodEvidence.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={userId:id(1),teamId:id(2),cityId:id(3),currentAal:"aal2",
 canReadContent:true,canMutate:false};
const date="2026-10-17",start=Date.parse(date+"T00:00:00+05:30");
const now=start+86400000+3600000,secret="VOX_F1_SYNTHETIC_SIGNING_KEY_NOT_FOR_STAGING_USE_ONLY";
const signedAt=new Date(now-1000).toISOString();
const event=(n=50,patch={})=>({id:id(n),source:"CORE_WORK_LEDGER",
 actor_id:scope.userId,team_id:scope.teamId,city_id:scope.cityId,
 object_id:id(n+100),revision:1,event_kind:"START",
 occurred_at:new Date(start+1000).toISOString(),subject_kind:"vendor",
 subject_id:id(88),...patch});
const fixture=(events=[event()])=>{
 const marks=sources.map(source=>{
  const local=events.filter(e=>e.source===source);
  const row={source,actor_id:scope.userId,team_id:scope.teamId,
   city_id:scope.cityId,business_date:date,
   cursor_start:new Date(start).toISOString(),
   cursor_end:new Date(start+86400000).toISOString(),
   event_checksum:sourceEventChecksum(local),signed_at:signedAt};
  return {...row,signature:signEodReaderWatermark({row,secret})};
 });
 return {events,marks};
};
function db({events,marks}){
 return {from(table){
  let clauses=[];
  const chain={select(){return chain;},eq(k,v){clauses.push([k,"eq",v]);return chain;},
   gte(k,v){clauses.push([k,"gte",v]);return chain;},
   lt(k,v){clauses.push([k,"lt",v]);return chain;},
   limit(n){
    const set=table==="vox_staff_source_events_candidate_v1"?events:marks;
    return Promise.resolve({data:set.filter(x=>clauses.every(([k,op,v])=>
      op==="eq"?x[k]===v:op==="gte"?x[k]>=v:x[k]<v)).slice(0,n),error:null});
   }};
  return chain;
 }};
}
const run=(f=fixture(),more={})=>read({db:db(f),scope,businessDate:date,
 secret,now,verifyCurrentScope:async()=>true,
 verifyExactObjectGrant:async()=>true,...more});
test("real Core DB-style readers and HMAC watermarks -> bounded, not submitted",async()=>{
 const r=await run();assert.equal(r.ok,true);assert.equal(r.rollup.totalEvents,1);
 assert.equal(r.proof,"CORE_HMAC_SIGNED_DB_WATERMARKS_AND_LIVE_GRANTS");
 assert.equal(r.canSubmit,false);assert.equal(r.providerMessagesSent,0);
});
test("full day cannot be certified until the IST day closes",async()=>{
 const r=await run(fixture(),{now:start+3600000});
 assert.equal(r.ok,false);assert.equal(r.reason,"IST_BUSINESS_DAY_NOT_CLOSED");
});
test("empty four signed sources is a verified zero, missing one is UNKNOWN",async()=>{
 assert.equal((await run(fixture([]))).rollup.totalEvents,0);
 const f=fixture();f.marks.pop();
 const r=await run(f);assert.equal(r.ok,false);assert.equal(r.rollup,null);
});
test("signature tampering, post-signing new event and stale source denied",async()=>{
 let f=fixture();f.marks[0].signature="f".repeat(64);
 assert.equal((await run(f)).ok,false);
 f=fixture();f.events.push(event(51));
 assert.equal((await run(f)).ok,false);
 f=fixture();f.marks[0].signed_at=new Date(now-400000).toISOString();
 assert.equal((await run(f)).ok,false);
});
test("revoked staff/object, AAL1, absent source schema deny",async()=>{
 assert.equal((await run(fixture(),{verifyCurrentScope:async()=>false})).ok,false);
 assert.equal((await run(fixture(),{verifyExactObjectGrant:async()=>false})).ok,false);
 assert.equal((await run(fixture(),{scope:{...scope,currentAal:"aal1"}})).ok,false);
 assert.equal((await run(fixture(),{db:{from(){throw Error("NO_VOX_SCHEMA");}}})).ok,false);
});
test("duplicate revision, foreign actor and unsupported source cannot pass",async()=>{
 const dupe=fixture([event(),event(51,{object_id:id(150),revision:1})]);
 assert.equal((await run(dupe)).ok,false);
 const foreign=fixture([event(50,{actor_id:id(77)})]);
 assert.equal((await run(foreign)).ok,false);
 const unsupported=fixture([event(50,{source:"EXTERNAL_ANY"})]);
 assert.equal((await run(unsupported)).ok,false);
});
test("never silently truncate > 1000 event or 4 watermark set",async()=>{
 const items=Array.from({length:1001},(_,i)=>event(500+i));
 const r=await run(fixture(items));assert.equal(r.ok,false);
 const f=fixture();f.marks.push({...f.marks[0]});
 assert.equal((await run(f)).ok,false);
});
