import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {composeAuthorizedCoreWorkspace}
 from "../../../contracts/vox/ui04RouteFusion.mjs";

const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const request=new Request("https://core.quickfurno.invalid/api/vox/v1/ui04-workspace",{
 method:"GET",headers:{authorization:"Bearer test-not-real"}
});
const scope={userId:id(1),teamId:id(2),cityId:id(3),
 currentAal:"aal2",canReadContent:true,canMutate:false,
 role:"support_agent",verifiedDepartments:["client_success"]};
const flags={work:"staging",client:"staging",portal:"staging",
 grants:"staging",departments:"staging"};
const work={ok:true,schema:"qf.vox.work.queue.preview.v1",
 mode:"READ_ONLY",actionsEnabled:false,items:[{
 workItemId:id(4),kind:"vendor",state:"ASSIGNED",revision:2,
 updatedAt:"2026-10-17T11:00:00Z",assignedToMe:true,
 canClaim:false,canTransition:false
}]};
const client={ok:true,schema:"qf.vox.client.case.source-readiness.v1",
 mode:"READ_ONLY",canReadTranscript:false,canSendReply:false,
 canTakeover:false,items:[{conversationId:id(5),
 clientProjectId:id(6),agent:"RIYA",caseState:"PAUSED",
 revision:3,lastUpdated:"2026-10-17T11:20:00Z",
 googleLocationVerified:true,currentCityVerified:true,readOnly:true,
 canReadTranscript:false,canSendReply:false,canTakeover:false}]};
const result=(value,status=200,headers={})=>Response.json(value,{status,
 headers:{"cache-control":"private, no-store, max-age=0",...headers}});
function params(){
 let reads=0,proofs=[];
 const a={request,scope,featureGates:flags,
  verifyCurrentScope:async()=>true,
  readWorkHandler:async()=>{reads++;return result(work)},
  readClientHandler:async()=>{reads++;return result(client)},
  verifyCurrentObjectGrant:async v=>{proofs.push(v);return true}};
 return {a,get reads(){return reads},get proofs(){return proofs}};
}
test("T2 real two-reader fusion verifies source receipts and each object",async()=>{
 const fixture=params(),x=await composeAuthorizedCoreWorkspace(fixture.a);
 assert.equal(x.ok,true);assert.equal(x.items.length,2);
 assert.equal(x.actionsEnabled,false);assert.equal(x.stageCertified,false);
 assert.equal(x.items[0].subjectKind,"client");
 assert.equal(x.items[1].subjectKind,"vendor");
 assert.equal(x.providerMessagesSent,0);
 assert.equal(fixture.reads,2);
 assert.equal(fixture.proofs.length,2);
 assert.equal(fixture.proofs[0].expectedRevision,2);
 assert.equal(fixture.proofs[1].expectedProjectId,id(6));
});
test("T2 all missing or malformed activation flags deny BEFORE source reads",async()=>{
 for(const prop of Object.keys(flags)){
  const x=params();const f={...flags,[prop]:"off"};
  const result=await composeAuthorizedCoreWorkspace({...x.a,featureGates:f});
  assert.equal(result.ok,false);assert.equal(result.status,503);
  assert.equal(x.reads,0);
 }
});
test("T2 foreign paths, query parameters and methods rejected before reads",async()=>{
 const candidates=[
  new Request(request.url+"?teamId="+id(20)),
  new Request(request.url,{method:"POST"}),
  new Request(request.url+"#client")
 ];
 for(const one of candidates){
  const x=params(),r=await composeAuthorizedCoreWorkspace({...x.a,request:one});
  assert.equal(r.ok,false);assert.equal(r.status,400);
  assert.equal(x.reads,0);
 }
});
test("T2 client role/department and revoked Staff AAL2 deny before reads",async()=>{
 const patched=[
  {scope:{...scope,currentAal:"aal1"}},
  {scope:{...scope,role:"acquisition_agent"}},
  {scope:{...scope,verifiedDepartments:["vendor_success"]}},
  {scope:{...scope,canMutate:true}}
 ];
 for(const change of patched){
  const x=params(),r=await composeAuthorizedCoreWorkspace({...x.a,...change});
  assert.equal(r.ok,false);assert.equal(x.reads,0);
 }
});
test("T2 both Core read handlers must accept bearer; no partial leaked queue",async()=>{
 for(const field of ["readWorkHandler","readClientHandler"]){
  for(const status of [403,404,503]){
   const x=params(),r=await composeAuthorizedCoreWorkspace({
    ...x.a,[field]:async()=>result({ok:false,error:"DENIED"},status)});
   assert.equal(r.ok,false);assert.equal(r.items.length,0);
   assert.equal(r.status,status===403?403:503);
  }
 }
});
test("T2 malformed, oversized, unsigned or cacheable source payload denied",async()=>{
 const bad=[
  Response.json(work,{headers:{"cache-control":"public, max-age=60"}}),
  new Response(JSON.stringify(work),{status:200,headers:{
   "cache-control":"no-store","content-type":"text/plain"}}),
  new Response("{bad json",{status:200,headers:{
   "cache-control":"no-store","content-type":"application/json"}}),
  result({...work,items:[{...work.items[0],revision:-1}]}),
  result({...work,items:new Array(2000).fill(work.items[0])})
 ];
 for(const response of bad){
  const x=params(),r=await composeAuthorizedCoreWorkspace({
   ...x.a,readWorkHandler:async()=>response});
  assert.equal(r.ok,false);assert.equal(r.items.length,0);
 }
});
test("T2 revocation, source verification and object scope exceptions fail closed",async()=>{
 for(const patch of [
  {verifyCurrentScope:async()=>false},
  {verifyCurrentScope:async()=>{throw Error("offline")}},
  {verifyCurrentObjectGrant:async()=>false},
  {verifyCurrentObjectGrant:async()=>{throw Error("revoked")}},
  {readClientHandler:async()=>{throw Error("source unavailable")}}
 ]){
  const x=params(),r=await composeAuthorizedCoreWorkspace({...x.a,...patch});
  assert.equal(r.ok,false);assert.equal(r.items.length,0);
 }
});
test("T2 forged reader PII is not projected into workstation metadata",async()=>{
 const x=params(),r=await composeAuthorizedCoreWorkspace({
  ...x.a,
  readClientHandler:async()=>result({...client,
   items:[{...client.items[0],phone:"+919888888888",
    transcript:"PRIVATE_CHAT",staffPassword:"TOP_SECRET"}]})});
 assert.equal(r.ok,true);
 const serialized=JSON.stringify(r);
 for(const secret of ["PRIVATE_CHAT","TOP_SECRET","+919888888888","transcript"])
  assert.equal(serialized.includes(secret),false);
});
test("T2 route is server-only, strictly gated and all mutations return 405",()=>{
 const path=new URL("../../../app/api/vox/v1/ui04-workspace/route.ts",import.meta.url);
 const source=readFileSync(path,"utf8");
 assert.match(source,/import "server-only"/);
 assert.match(source,/VOX_UI04_WORKSPACE_READ_ENABLED/);
 assert.match(source,/getVerifiedScopedStaff\(bearer\)/);
 assert.match(source,/getVerifiedScopedStaff\(bearer\)/);
 assert.match(source,/readWorkHandler:readWork/);
 assert.match(source,/readClientHandler:readClients/);
 assert.match(source,/verifyCurrentObjectGrant:object/);
 assert.match(source,/const reject=\(\)=>send\(\{ok:false,error:"READ_ONLY"\},405\)/);
 for(const method of ["POST","PUT","PATCH","DELETE"])
  assert.match(source,new RegExp("export const "+method+"=reject"));
 assert.doesNotMatch(source,/auth\.admin\.createUser|\.insert\(|\.update\(|whatsapp\.send|fetch\(/);
});
