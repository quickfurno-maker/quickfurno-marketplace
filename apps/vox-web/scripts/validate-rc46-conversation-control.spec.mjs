import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const tmp=mkdtempSync(join(tmpdir(),"vox-rc46-operator-"));
const out=join(tmp,"operator.mjs");
await build({entryPoints:[resolve(root,"app/api/conversation-control/route.ts")],
 outfile:out,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"staff-and-core-mocks",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"empty",namespace:"stub"}));
  b.onResolve({filter:/^(?:\.\/auth|\.\.\/\.\.\/\.\.\/lib\/auth)$/},()=>({path:"auth",namespace:"stub"}));
  b.onResolve({filter:/^\.\/core$/},()=>({path:"core",namespace:"stub"}));
  b.onLoad({filter:/.*/,namespace:"stub"},a=>({loader:"js",
   contents:a.path==="auth"?
    "export const allowedOrigin=()=>globalThis.__rc46.allowed; export const safeJson=(v,s)=>Response.json(v,{status:s}); export const verifiedMfaSession=()=>{globalThis.__rc46.auth++;return globalThis.__rc46.token;}":
    a.path==="core"?"export const origin=()=>globalThis.__rc46.origin;":""}));
 }}]});
const api=await import(pathToFileURL(out).href);
const C="11111111-1111-4111-8111-111111111111",N="22222222-2222-4222-8222-222222222222";
const cmd={conversationId:C,expectedRevision:2,action:"PAUSE_AI",nonce:N};
const receipt={ok:true,state:"PAUSED",action:"PAUSE_AI",nonce:N,
 conversationId:C,previousRevision:2,newRevision:3,replayed:false,
 receiptSha256:"a".repeat(64),providerMessagesSent:0,mode:"ATOMIC_NO_PROVIDER_SEND"};
const flags=["VOX_STAFF_PORTAL_ENABLED","VOX_TEAM_WORKSPACE_ENABLED",
 "VOX_STAFF_GRANTS_ENABLED","VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED"];
const state={allowed:true,token:"mock-staff-aal2",origin:"https://staging-core.quickfurno.in",
 auth:0,calls:[],status:200,receipt};
globalThis.__rc46=state;
const oldFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 state.calls.push({url,options});
 return Response.json(state.receipt,{status:state.status});
};
const gate=(on)=>{for(const f of flags)on?process.env[f]="staging":delete process.env[f];
 process.env.VOX_STAFF_VIEW_MODE="scoped";};
function reset(){gate(true);state.allowed=true;state.token="mock-staff-aal2";
 state.origin="https://staging-core.quickfurno.in";state.auth=0;state.calls=[];
 state.status=200;state.receipt={...receipt};}
const request=(value=cmd)=>new Request("https://localhost/api/conversation-control",{
 method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(value)});
test("real web BFF holds before authorization when flags disabled",async()=>{
 reset();gate(false);assert.equal((await api.POST(request())).status,503);
 assert.equal(state.auth,0);assert.equal(state.calls.length,0);
});
test("untrusted origin and malicious arguments stop before Core",async()=>{
 reset();state.allowed=false;assert.equal((await api.POST(request())).status,403);
 state.allowed=true;
 for(const invalid of [{...cmd,actorId:C},{...cmd,expectedRevision:-1},
  {...cmd,action:"SEND_WHATSAPP"},{...cmd,nonce:"forged"}]){
  assert.equal((await api.POST(request(invalid))).status,400);
 }
 assert.equal(state.auth,0);assert.equal(state.calls.length,0);
});
test("Staff AAL2 missing never reaches Core",async()=>{
 reset();state.token=null;assert.equal((await api.POST(request())).status,401);
 assert.equal(state.calls.length,0);
});
test("native Core POST forwards only nonce, revision, action, conversation with MFA bearer",async()=>{
 reset();const res=await api.POST(request());assert.equal(res.status,200,JSON.stringify(await res.clone().json()));
 const v=await res.json();assert.equal(v.ok,true);assert.equal(v.providerMessagesSent,0);
 assert.equal(state.calls.length,1);
 const c=state.calls[0];
 assert.equal(c.url,"https://staging-core.quickfurno.in/api/vox/v1/core/conversation-operator");
 assert.equal(c.options.method,"POST");assert.equal(c.options.cache,"no-store");
 assert.equal(c.options.redirect,"error");
 assert.equal(c.options.headers.authorization,"Bearer mock-staff-aal2");
 assert.deepEqual(JSON.parse(c.options.body),cmd);
});
test("Core rejects and forged receipts never become confirmed actions",async()=>{
 reset();state.status=503;assert.equal((await api.POST(request())).status,503);
 state.status=200;
 for(const fake of [{...receipt,providerMessagesSent:1},{...receipt,state:"HUMAN"},
  {...receipt,nonce:C},{...receipt,receiptSha256:"corrupt"},
  {...receipt,mode:"PUBLISH"},{...receipt,extraMoneyRefunded:1}]){
  state.receipt=fake;assert.equal((await api.POST(request())).status,503);
 }
});
test("web controls include replay-safe nonce and no provider sends",()=>{
 const s=readFileSync(resolve(root,"app/team/conversation-control/ConversationControl.tsx"),"utf8");
 const page=readFileSync(resolve(root,"app/team/conversation-control/page.tsx"),"utf8");
 assert.match(s,/pending\.current\.nonce/);
 assert.match(s,/crypto\.randomUUID\(\)/);
 assert.match(s,/providerMessagesSent/);
 assert.match(page,/VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED==="staging"/);
 assert.doesNotMatch(s,/sendWhatsApp|razorpay|adminClient/);
});
test("all other HTTP methods fail closed",()=>{
 for(const v of ["GET","PUT","PATCH","DELETE"])
  assert.equal(api[v]().status,405);
});
process.on("exit",()=>{globalThis.fetch=oldFetch;rmSync(tmp,{recursive:true,force:true});});
