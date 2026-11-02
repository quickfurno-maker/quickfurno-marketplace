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
 auth:0,calls:[],status:200,transportFailure:false,receipt:{...original},
 discovery:{ok:true,schema:"qf.vox.conversation.candidates.v1",mode:"READ_ONLY",
 actionsEnabled:false,conversations:[{id:C,revision:2,state:"OPEN",
 allowedActions:["PAUSE_AI","TAKEOVER"]}]}};
const env={};
const ctx=vm.createContext({Request,Response,URL,AbortSignal,
 process:{env},fetch:async(url,options)=>{
  state.calls.push({url,options});
  if(state.transportFailure)throw Error("simulated Core transport lost after POST");
  return Response.json(String(url).endsWith("/conversation-candidates")?
    state.discovery:state.receipt,{status:state.status});
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
const discovery=await load("app/api/conversation-candidates/route.ts",{
 "../../../lib/auth":{safeJson:(value,status)=>Response.json(value,{status})},
 "../../../lib/conversationControl":{fetchConversationCandidates:adapter.fetchConversationCandidates}
});
const gate=(on)=>{for(const flag of flags)on?env[flag]="staging":delete env[flag];
 env.VOX_STAFF_VIEW_MODE="scoped";};
function reset(){
 gate(true);state.allowed=true;state.token="mock-staff-aal2";
 state.origin="https://staging-core.quickfurno.in";state.auth=0;
 state.calls=[];state.status=200;state.transportFailure=false;state.receipt={...original};
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
test("BFF timeout exceeds Core atomic RPC timeout so verified 504 can be observed",()=>{
 const src=readFileSync(resolve(app,"lib/conversationControl.ts"),"utf8");
 assert.match(src,/signal:AbortSignal.timeout\(6500\)/);
 const ui=readFileSync(resolve(app,"app/team/conversation-control/ConversationControl.tsx"),"utf8");
 assert.match(ui,/setUncertain\(true\)/);
 assert.match(ui,/disabled=\{busy\|\|uncertain\}/);
 assert.match(ui,/v.error==="CORE_OUTCOME_UNKNOWN"/);
 assert.match(ui,/pending.current=null;setUncertain\(false\)/);
 assert.match(ui,/Do not assume rollback/);
});
test("HTTP 200 without canonical receipt is UNKNOWN, not a failed transaction",async()=>{
 reset();state.status=200;
 for(const forged of [null,{},[],{...original,nonce:C},
  {...original,providerMessagesSent:1},
  {...original,receiptSha256:"invalid"}]){
  state.receipt=forged;
  const response=await api.POST(request());
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.error,"CORE_OUTCOME_UNKNOWN");
  assert.equal(body.committed,null);
  assert.equal(body.retrySameNonceOnly,true);
  assert.equal(body.ok,false);
 }
 assert.equal(state.calls.length,6);
 for(const call of state.calls)assert.equal(JSON.parse(call.options.body).nonce,N);
});
test("Core 504 and 503 cannot be mistaken for rollback or trigger a new nonce",async()=>{
 reset();
 for(const status of [504,503]){
  state.status=status;
  const r=await api.POST(request());
  assert.equal(r.status,status);
  const body=await r.json();
  assert.equal(body.ok,false);
  assert.equal(body.error,"CORE_OUTCOME_UNKNOWN");
  assert.equal(body.committed,null);
  assert.equal(body.retrySameNonceOnly,true);
 }
 assert.equal(state.calls.length,2);
 for(const call of state.calls)assert.equal(JSON.parse(call.options.body).nonce,N);
});
test("Core 403 after Staff revocation retains unknown SQL outcome and exact nonce",async()=>{
 reset();state.status=403;
 state.receipt={ok:false,error:"STAFF_SCOPE_REVOKED_DURING_RPC",
  committed:null,commitState:"unknown",retrySameNonceOnly:true,
  providerMessagesSent:0};
 const res=await api.POST(request());assert.equal(res.status,403);
 const body=await res.json();
 assert.equal(body.error,"CORE_OUTCOME_UNKNOWN");
 assert.equal(body.committed,null);assert.equal(body.retrySameNonceOnly,true);
 assert.equal(state.calls.length,1);
 assert.equal(JSON.parse(state.calls[0].options.body).nonce,N);
});
test("Web loss of Core response never confirms rollback or invents a nonce",async()=>{
 reset();state.transportFailure=true;
 const r=await api.POST(request());
 assert.equal(r.status,503);
 const body=await r.json();
 assert.equal(body.committed,null);assert.equal(body.retrySameNonceOnly,true);
 assert.equal(body.error,"CORE_OUTCOME_UNKNOWN");
 assert.equal(state.calls.length,1);
 assert.equal(JSON.parse(state.calls[0].options.body).nonce,N);
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
test("authorized bounded Core conversation hints are read-only and strict",async()=>{
 reset();
 const r=await discovery.GET(new Request("https://localhost/api/conversation-candidates"));
 assert.equal(r.status,200);
 const body=await r.json();assert.equal(body.actionsEnabled,false);
 assert.deepEqual(body.conversations[0],{id:C,revision:2,state:"OPEN",
  allowedActions:["PAUSE_AI","TAKEOVER"]});
 assert.equal(state.calls.length,1);
 assert.match(state.calls[0].url,/\/core\/conversation-candidates$/);
 for(const method of ["POST","PUT","PATCH","DELETE"])
  assert.equal(discovery[method]().status,405);
});
test("forged candidate lists, unscoped calls and filters do not expose list",async()=>{
 reset();
 state.discovery={...state.discovery,actionsEnabled:true};
 assert.equal((await discovery.GET(new Request("https://localhost/api/conversation-candidates"))).status,503);
 state.discovery={...state.discovery,actionsEnabled:false,conversations:[{id:C,revision:2,state:"PAUSED",
  allowedActions:["PAUSE_AI","TAKEOVER"]}]};
 assert.equal((await discovery.GET(new Request("https://localhost/api/conversation-candidates"))).status,503);
 state.token=null;
 assert.equal((await discovery.GET(new Request("https://localhost/api/conversation-candidates"))).status,401);
 assert.equal((await discovery.GET(new Request("https://localhost/api/conversation-candidates?anything=1"))).status,400);
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
