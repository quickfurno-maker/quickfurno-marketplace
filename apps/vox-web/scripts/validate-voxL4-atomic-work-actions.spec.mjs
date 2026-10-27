// Executes real Next TS BFF + real server-only Core adapter in a VM.
// Authentication and Core backend are synthetic: NOT staging E2E.
import test,{beforeEach} from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import {readFileSync} from "node:fs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const ITEM=id(10),NONCE=id(11);
const state={flags:{},token:"MOCK_SERVER_MFA_TOKEN",coreStatus:200,core:null,
 coreRequests:[],receivedAuth:0,originOkay:true,authDenied:false};
function reset(){
 state.flags={VOX_STAFF_PORTAL_ENABLED:"staging",VOX_TEAM_WORKSPACE_ENABLED:"staging",
  VOX_WORK_ACTIONS_UI_ENABLED:"staging",VOX_WORK_ACTIONS_ENABLED:"staging",
  VOX_STAFF_VIEW_MODE:"scoped"};
 state.token="MOCK_SERVER_MFA_TOKEN";state.coreStatus=200;state.coreRequests=[];
 state.receivedAuth=0;state.originOkay=true;state.authDenied=false;
 state.core={ok:true,schema:"qf.vox.work.transaction.receipt.v1",
  workItemId:ITEM,newState:"ASSIGNED",revision:4,providerMessagesSent:0,
  affectsVendorLeadMatching:false};
}
reset();
const ctx=vm.createContext({Request,Response,URL,AbortSignal,JSON,Number,
 process:{env:new Proxy({}, {get(_t,k){return state.flags[k]},
 set(_t,k,v){state.flags[k]=v;return true}})},
 fetch:async(url,options)=>{
  state.coreRequests.push({url,options});
  return Response.json(state.core,{status:state.coreStatus});
 }});
async function load(path,imports){
 const src=readFileSync(new URL(path,import.meta.url),"utf8");
 const transpiled=ts.transpileModule(src,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022
 }}).outputText;
 const mod=new vm.SourceTextModule(transpiled,{context:ctx,identifier:path});
 await mod.link(name=>{
  const mock=imports[name];
  if(!mock)throw Error("UNKNOWN_IMPORT:"+name);
  return new vm.SyntheticModule(Object.keys(mock),function(){
   for(const [k,v] of Object.entries(mock))this.setExport(k,v);
  },{context:ctx,identifier:name});
 });
 await mod.evaluate();return mod.namespace;
}
const adapter=await load("../lib/workTransitions.ts",{
 "server-only":{},
 "./auth":{verifiedMfaSession:async()=>{
  state.receivedAuth++;return state.authDenied?null:state.token;
 }},
 "./core":{origin:()=> "https://staging-core.quickfurno.in"}
});
const api=await load("../app/api/work-transitions/route.ts",{
 "../../../lib/auth":{
  allowedOrigin:()=>state.originOkay,
  safeJson:(body,status)=>Response.json(body,{status})
 },
 "../../../lib/workTransitions":{
  submitScopedWorkTransition:adapter.submitScopedWorkTransition
 }
});
const input=(action="CLAIM",reason="")=>({action,itemId:ITEM,expectedRevision:3,
 nonce:NONCE,reason});
const request=(body=input(),ctype="application/json")=>
 new Request("https://vox.quickfurno.in/api/work-transitions",{
  method:"POST",headers:{"content-type":ctype},
  body:JSON.stringify(body)
 });
beforeEach(reset);
test("all staging feature flags gate before Staff Auth or Core access",async()=>{
 for(const name of ["VOX_STAFF_PORTAL_ENABLED","VOX_TEAM_WORKSPACE_ENABLED",
  "VOX_WORK_ACTIONS_UI_ENABLED","VOX_WORK_ACTIONS_ENABLED","VOX_STAFF_VIEW_MODE"]){
  state.flags[name]="off";
  const r=await api.POST(request());
  assert.equal(r.status,503);
  assert.equal(state.receivedAuth,0);
  assert.equal(state.coreRequests.length,0);
  state.flags[name]=name==="VOX_STAFF_VIEW_MODE"?"scoped":"staging";
 }
});
test("cross-origin CSRF rejected before Supabase Auth and DB writes",async()=>{
 state.originOkay=false;
 assert.equal((await api.POST(request())).status,403);
 assert.equal(state.receivedAuth,0);
 assert.equal(state.coreRequests.length,0);
});
test("reject browser impersonation, scope choices, unknown action and forged revision",async()=>{
 const invalid=[{...input(),actorId:id(99)},{...input(),cityId:id(3)},
  {...input(),teamId:id(2)},{...input(),staffRole:"team_leader"},
  {...input(),action:"REASSIGN"},{...input(),reason:"unreviewed"},
  {...input(),expectedRevision:-1},{...input(),expectedRevision:2147483647},
  {...input(),nonce:"bad"},{...input(),itemId:"bad"}];
 for(const row of invalid)assert.equal((await api.POST(request(row))).status,400);
 assert.equal(state.coreRequests.length,0);
});
test("reject empty/short required reason, extra recipient and wrong content type",async()=>{
 for(const invalid of [
  input("COMPLETE","too short"),input("BLOCK","too short"),
  input("REQUEST_APPROVAL",""),{...input(),provider:"WHATSAPP"}]){
  assert.equal((await api.POST(request(invalid))).status,400);
 }
 assert.equal((await api.POST(request(input(),"text/plain"))).status,415);
 assert.equal(state.receivedAuth,0);
});
test("one actual Core atomic transition with server-only bearer and nonce",async()=>{
 const r=await api.POST(request());assert.equal(r.status,200);
 const data=await r.json();
 assert.equal(data.ok,true);assert.equal(data.workItemId,ITEM);
 assert.equal(data.revision,4);assert.equal(data.providerMessagesSent,0);
 assert.equal(state.receivedAuth,1);assert.equal(state.coreRequests.length,1);
 const call=state.coreRequests[0];
 assert.equal(call.url,"https://staging-core.quickfurno.in/api/vox/v1/work-transitions");
 assert.equal(call.options.headers.authorization,"Bearer MOCK_SERVER_MFA_TOKEN");
 assert.equal(call.options.cache,"no-store");assert.equal(call.options.redirect,"error");
 assert.deepEqual(JSON.parse(call.options.body),input());
});
test("STALE 409 and Core offline deny, without fallback actions",async()=>{
 state.coreStatus=409;
 assert.equal((await api.POST(request())).status,409);
 state.coreStatus=503;
 assert.equal((await api.POST(request())).status,503);
});
test("missing verified Staff MFA denies before Core access",async()=>{
 state.authDenied=true;
 assert.equal((await api.POST(request())).status,401);
 assert.equal(state.coreRequests.length,0);
});
test("Core extra PII, forged provider send, revision and state never become success",async()=>{
 const forged=[
  {providerMessagesSent:1},{revision:99},{newState:"DONE"},
  {workItemId:id(99)},{affectsVendorLeadMatching:true},{phone:"private"}
 ];
 for(const row of forged){
  state.core={ok:true,schema:"qf.vox.work.transaction.receipt.v1",
   workItemId:ITEM,newState:"ASSIGNED",revision:4,
   providerMessagesSent:0,affectsVendorLeadMatching:false,...row};
  assert.equal((await api.POST(request())).status,503);
 }
});
test("other 6 work commands require exact Core state + revision",async()=>{
 const expected=[
 ["START","IN_PROGRESS",""],["WAIT_EXTERNAL","WAITING_EXTERNAL",""],
 ["REQUEST_APPROVAL","WAITING_APPROVAL","Meaningful manager review needed"],
 ["BLOCK","BLOCKED","Waiting for exact site document"],
 ["RESUME","IN_PROGRESS",""],["COMPLETE","DONE","Verified resolution completed"]
 ];
 for(const [action,newState,reason] of expected){
  state.core={ok:true,schema:"qf.vox.work.transaction.receipt.v1",
   workItemId:ITEM,newState,revision:4,
   providerMessagesSent:0,affectsVendorLeadMatching:false};
  const r=await api.POST(request(input(action,reason)));
  assert.equal(r.status,200,action);
 }
});
test("forbidden verbs are read-only and do not bypass Core",()=>{
 for(const name of ["GET","PUT","PATCH","DELETE"]){
  assert.equal(api[name]().status,405);
 }
 assert.equal(state.coreRequests.length,0);
});
test("client transition forms use crypto nonce, same-origin and report Core receipts",()=>{
 const s=readFileSync(new URL("../app/team/work-queue/WorkActionControl.tsx",import.meta.url),"utf8");
 assert.match(s,/crypto.randomUUID/);
 assert.match(s,/credentials:"same-origin"/);
 assert.match(s,/expectedRevision:revision/);
 assert.match(s,/providerMessagesSent/);
 assert.doesNotMatch(s,/createClient\(|service_role|NEXT_PUBLIC_.*KEY/);
});
test("zero browser action when all flags OFF; only Core has authority",()=>{
 const s=readFileSync(new URL("../app/team/work-queue/page.tsx",import.meta.url),"utf8");
 for(const f of ["VOX_WORK_ACTIONS_UI_ENABLED","VOX_WORK_ACTIONS_ENABLED",
   "VOX_STAFF_PORTAL_ENABLED","VOX_TEAM_WORKSPACE_ENABLED"]){
  assert.equal(s.includes(f),true);
 }
 assert.match(s,/Actions locked/);
});
