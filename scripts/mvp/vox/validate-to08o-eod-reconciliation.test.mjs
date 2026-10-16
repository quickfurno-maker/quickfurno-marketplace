import test from "node:test";
import assert from "node:assert/strict";
import {reconcileStaffEodEvidence as project,EOD_SOURCES}
 from "../../../contracts/vox/allSourceEodEvidence.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const date="2026-10-16",now=Date.parse("2026-10-17T08:00:00Z");
const ctx={userId:id(1),teamId:id(2),cityId:id(3),
 role:"support_agent",canReadContent:true,canMutate:false,
 prospectIds:[id(4)],vendorIds:[id(5)],
 supportThreadIds:[id(6)],conversationIds:[id(7)]};
const kinds=["vendor","prospect","support_thread","conversation"];
const ids=[id(5),id(4),id(6),id(7)];
const evt=(source,n)=>({
 id:id(n+100),source,actorId:ctx.userId,teamId:ctx.teamId,
 cityId:ctx.cityId,subjectKind:kinds[n],subjectId:ids[n],
 workItemId:id(20+n),eventType:"COMPLETED",revision:1,
 occurredAt:"2026-10-16T09:00:00.000Z"
});
const source=(name,n,complete=true)=>({
 source:name,
 sourceWatermark:complete?{
  watermarkId:id(50+n),completeThrough:"2026-10-16T18:30:00.000Z",
  readerVersion:"core-reader-v1",origin:"CORE_VERIFIED_READER"
 }:null,
 readerProof:{trust:"CORE_SERVER_READ_ONLY",teamId:ctx.teamId,
  cityId:ctx.cityId,staffId:ctx.userId,scopeRevision:2,
  committedAt:"2026-10-17T07:59:00.000Z"},
 events:[evt(name,n)]
});
const all=()=>EOD_SOURCES.map((s,n)=>source(s,n));
const run=(sources=all(),context=ctx)=>project({sources,context,businessDate:date,now});
test("all four timely source assertions produce only NOT AUDITED rollup",()=>{
 const r=run();assert.equal(r.ok,true);
 assert.equal(r.schema,"qf.vox.eod.multi-source.provenance.v2");
 assert.equal(r.completeness,"COVERAGE_ASSERTED_NOT_AUDITED");
 assert.equal(r.eventsVerified,4);assert.equal(r.rollup.completed,4);
 assert.equal(r.canSubmit,false);assert.equal(r.canAcknowledge,false);
 assert.equal(r.canApproveFinalBusinessReport,false);
 assert.equal(r.requiresSignedSourceReaders,true);
 assert.equal(r.providerMessagesSent,0);
});
test("missing source returns null rollup never invented whole-business sum",()=>{
 for(const ix of [0,1,2,3]){
  const s=all();s.splice(ix,1);
  const r=run(s);
  assert.equal(r.ok,true);assert.equal(r.completeness,"INCOMPLETE_OR_UNVERIFIED");
  assert.equal(r.rollup,null);
  assert.equal(r.sourceCount,3);assert.equal(r.evidenceBySource.length,4);
 }
});
test("stale or missing watermark cannot claim complete or numbers",()=>{
 for(const ix of [0,1,2,3]){
  const s=all();s[ix].sourceWatermark=null;
  assert.equal(run(s).rollup,null);
  const stale=all();stale[ix].sourceWatermark.completeThrough="2026-10-16T17:00:00Z";
  assert.equal(run(stale).completeness,"INCOMPLETE_OR_UNVERIFIED");
 }
});
test("reject malicious extra payload and unexpected transcript/PII fields",()=>{
 for(const extra of [{phone:"111"},{transcript:"private"},{clientName:"X"}]){
  const s=all();s[0].events[0]={...s[0].events[0],...extra};
  assert.equal(run(s).ok,false);
 }
});
test("reject foreign team/city/actor and ungranted source objects",()=>{
 for(const field of ["teamId","cityId","actorId","subjectId"]){
  const s=all();s[0].events[0][field]=id(999);
  assert.equal(run(s).ok,false);
 }
});
test("duplicate source, duplicate event and work revision fail closed",()=>{
 const dup=all();dup.push(source("CORE_WORK_LEDGER",0));
 assert.equal(run(dup).ok,false);
 const s=all();s[0].events.push({...s[0].events[0]});
 assert.equal(run(s).error,"UNVERIFIED_EOD_EVENT");
});
test("reject unsupported agent event, forged Core reader and stale source proof",()=>{
 const s=all();s[3].events[0].eventType="WHATSAPP_SENT";
 assert.equal(run(s).ok,false);
 const t=all();t[1].readerProof.trust="CLIENT_ASSERTION";
 assert.equal(run(t).error,"SOURCE_IDENTITY_OR_AUTHORITY_NOT_PROVEN");
 const z=all();z[0].readerProof.scopeRevision=0;
 assert.equal(run(z).ok,false);
});
test("Riya event cannot impersonate conversation scoped grant",()=>{
 const s=all();s[3].events[0].subjectKind="prospect";
 assert.equal(run(s).error,"REVOKED_OR_FOREIGN_EOD_SUBJECT");
 const other={...ctx,conversationIds:[]};
 assert.equal(run(all(),other).ok,false);
});
test("reject future watermark and impossible date / delayed older reports",()=>{
 const s=all();s[0].sourceWatermark.completeThrough="2026-10-20T18:30:00Z";
 assert.equal(run(s).rollup,null);
 assert.equal(project({context:ctx,sources:[],businessDate:"2026-02-30",now}).ok,false);
 assert.equal(project({context:ctx,sources:[],businessDate:"2026-10-10",now}).ok,false);
});
test("reject incorrect staff roles, missing grants, duplicate grant IDs",()=>{
 for(const c of [{...ctx,role:"team_leader"},
  {...ctx,canMutate:true},{...ctx,canReadContent:false},
  {...ctx,vendorIds:[id(5),id(5)]}]){
  assert.equal(run(all(),c).ok,false);
 }
});
test("reject oversized event windows instead of truncating",()=>{
 const s=all();
 s[0].events=Array.from({length:101},(_,i)=>({
  ...evt("CORE_WORK_LEDGER",0),id:id(1000+i),revision:i+1
 }));
 assert.equal(run(s).ok,false);
});
test("no valid events but complete source coverage does not authorize submission",()=>{
 const s=all();s.forEach(x=>{x.events=[]});
 const r=run(s);assert.equal(r.ok,true);
 assert.equal(r.rollup.completed,0);assert.equal(r.canSubmit,false);
 assert.equal(r.canExport,false);
});
