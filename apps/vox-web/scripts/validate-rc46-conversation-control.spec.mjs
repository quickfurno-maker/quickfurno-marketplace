// Actual VOX BFF + actual server-only Core adapter compiled with the same
// TypeScript VM harness used by the Staff app. No root-workspace dependencies.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const app=resolve(import.meta.dirname,"..");
const C="11111111-1111-4111-8111-111111111111";
const N="22222222-2222-4222-8222-222222222222";
const cmd={conversationId:C,expectedRevision:2,action:"PAUSE_AI",nonce:N};
const original={ok:true,state:"PAUSED",action:"PAUSE_AI",nonce:N,
 conversationId:C,previousRevision:2,newRevision:3,replayed:false,
 receiptSha256:"a".repeat(64),providerMessagesSent:0,mode:"ATOMIC_NO_PROVIDER_SEND"};
const flags=["VOX_STAFF_PORTAL_ENABLED","VOX_TEAM_WORKSPACE_ENABLED",
 "VOX_STAFF_GRANTS_ENABLED","VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED",
 "VOX_DEPARTMENT_ENFORCEMENT_ENABLED"];
const state={allowed:true,token:"mock-staff-aal2",origin:"https://staging-core.quickfurno.in",
 auth:0,calls:[],status:200,receipt:{...original}};
const env={};
const ctx=vm.createContext({Request,Response,URL,AbortSignal,
 process:{env},fetch:async(url,options)=>{
  state.calls.push({url,options});
  return Response.json(state.receipt,{status:state.status});
 }});
async function load(path,imports){
 const source=readFileSync(resolve(app,path),"utf8");
 const code=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod=new vm.SourceTextModule(code,{context:ctx,identifier:path});
 await mod.link(name=>{
  const record=imports[name];
  if(!record)throw Error("UNEXPECTED_CONVERSATION_IMPORT:"+name);
  return new vm.SyntheticModule(Object.keys(record),function(){
   for(const [k,v] of Object.entries(record))this.setExport(k,v);
  },{context:ctx,identifier:name});
 });
 await mod.evaluate();return mod.namespace;
}
const adapter=await load("lib/conversationControl.ts",{
 "server-only":{},
 "./auth":{verifiedMfaSession:async()=>{state.auth++;return state.token;}},
 "./core":{origin:()=>state.origin}
});
const api=await load("app/api/conversation-control/route.ts",{
 "../../../lib/auth":{
  allowedOrigin:()=>state.allowed,
  safeJson:(value,status)=>Response.json(value,{status})
 },
 "../../../lib/conversationControl":{
  submitConversationControl:adapter.submitConversationControl
 }
});
const gate=(on)=>{for(const flag of flags)on?env[flag]="staging":delete env[flag];
 env.VOX_STAFF_VIEW_MODE="scoped";};
function reset(){
 gate(true);state.allowed=true;state.token="mock-staff-aal2";
 state.origin="https://staging-core.quickfurno.in";state.auth=0;
 state.calls=[];state.status=200;state.receipt={...original};
}
function request(value=cmd){return new Request("https://localhost/api/conversation-control",{
 method:"POST",headers:{"content-type":"application/json"},
 body:JSON.stringify(value)
});}
test("route holds before authorization when flags are disabled",async()=>{
 reset();gate(false);
 assert.equal((await api.POST(request())).status,503);
 assert.equal(state.auth,0);assert.equal(state.calls.length,0);
});
test("CSRF failure and injected command arguments stop before Core",async()=>{
 reset();state.allowed=false;
 assert.equal((await api.POST(request())).status,403);
 state.allowed=true;
 for(const value of [{...cmd,actorId:C},{...cmd,expectedRevision:-1},
  {...cmd,action:"SEND_WHATSAPP"},{...cmd,nonce:"forged"}]){
  assert.equal((await api.POST(request(value))).status,400);
 }
 assert.equal(state.auth,0);assert.equal(state.calls.length,0);
});
test("missing verified Staff AAL2 never reaches Core",async()=>{
 reset();state.token=null;
 assert.equal((await api.POST(request())).status,401);
 assert.equal(state.calls.length,0);
});
test("approved native Core POST forwards exact command and MFA bearer",async()=>{
 reset();const res=await api.POST(request());
 assert.equal(res.status,200);
 const v=await res.json();
 assert.equal(v.ok,true);assert.equal(v.providerMessagesSent,0);
 assert.equal(v.receiptSha256,"a".repeat(64));assert.equal(v.nonce,cmd.nonce);
 assert.equal(state.calls.length,1);
 const c=state.calls[0];
 assert.equal(c.url,"https://staging-core.quickfurno.in/api/vox/v1/core/conversation-operator");
 assert.equal(c.options.method,"POST");assert.equal(c.options.cache,"no-store");
 assert.equal(c.options.redirect,"error");
 assert.equal(c.options.headers.authorization,"Bearer mock-staff-aal2");
 assert.deepEqual(JSON.parse(c.options.body),cmd);
});
test("Core rejection and forged receipts cannot become confirmed actions",async()=>{
 reset();state.status=503;
 assert.equal((await api.POST(request())).status,503);
 state.status=200;
 for(const fake of [{...original,providerMessagesSent:1},
  {...original,state:"HUMAN"},{...original,nonce:C},
  {...original,receiptSha256:"corrupt"},{...original,mode:"PUBLISH"},
  {...original,extraMoneyRefunded:1}]){
  state.receipt=fake;
  assert.equal((await api.POST(request())).status,503);
 }
});
test("genuine department-enforcement gate must be active before any Staff auth",async()=>{
 reset();delete env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED;
 assert.equal((await api.POST(request())).status,503);
 assert.equal(state.auth,0);assert.equal(state.calls.length,0);
});
test("human takeover accepts only HUMAN state and exact Core-authorized revision",async()=>{
 reset();
 const c={...cmd,action:"TAKEOVER"};
 state.receipt={...original,action:"TAKEOVER",state:"HUMAN"};
 const accepted=await api.POST(request(c));
 assert.equal(accepted.status,200);
 assert.equal((await accepted.json()).state,"HUMAN");
 assert.equal(state.calls.length,1);
 assert.deepEqual(JSON.parse(state.calls[0].options.body),c);
});
test("nonce replay proves zero outbound sends without forging a new commit",async()=>{
 reset();state.receipt={...original,replayed:true};
 const result=await api.POST(request());
 assert.equal(result.status,200);
 const reply=await result.json();
 assert.equal(reply.replayed,true);assert.equal(reply.providerMessagesSent,0);
 assert.equal(reply.newRevision,3);
});
test("Staff form preserves nonce across ambiguous retries, no provider send",()=>{
 const source=readFileSync(resolve(app,
  "app/team/conversation-control/ConversationControl.tsx"),"utf8");
 const page=readFileSync(resolve(app,"app/team/conversation-control/page.tsx"),"utf8");
 assert.match(source,/pending\.current\.nonce/);
 assert.match(source,/crypto\.randomUUID\(\)/);
 assert.match(source,/providerMessagesSent/);
 assert.match(source,/v\.receiptSha256\.slice\(0,16\)/);
 assert.match(source,/v\.nonce!==pending\.current\?\.nonce/);
 assert.match(source,/if\(!v\.replayed\)setRevision/);
 assert.match(page,/VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED==="staging"/);
 assert.doesNotMatch(source,/sendWhatsApp|razorpay|adminClient/);
});
test("all unsupported HTTP methods fail closed",()=>{
 for(const verb of ["GET","PUT","PATCH","DELETE"])
  assert.equal(api[verb]().status,405);
});
