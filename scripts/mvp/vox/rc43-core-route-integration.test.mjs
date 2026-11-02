import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const tmp=mkdtempSync(join(tmpdir(),"vox-rc43-core-route-"));
const source=resolve(root,"app/api/vox/v1/core/conversation-operator/route.ts");
async function compile(install){
 const file=join(tmp,install?"installed-route.mjs":"production-route.mjs");
 await build({entryPoints:[source],outfile:file,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
  plugins:[{name:"mock-auth-db",setup(b){
   b.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"mock"}));
   b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:"supabase",namespace:"mock"}));
   b.onResolve({filter:/^@\/services\/vox\/verifiedStaffBearer$/},()=>({path:"verified",namespace:"mock"}));
   b.onResolve({filter:/^@\//},a=>{const f=resolve(root,a.path.slice(2));return {path:f+".ts"};});
   b.onLoad({filter:/.*/,namespace:"mock"},a=>({loader:"js",contents:
    a.path==="supabase"?"export function adminClient(){return {rpc:(fn,args)=>globalThis.__rc43Core.rpc(fn,args)}};":
    a.path==="verified"?"export const verifyVoxOperationsStaffBearer=(h)=>globalThis.__rc43Core.verify(h);":""
   }));
   b.onLoad({filter:/app[\\/]api[\\/]vox[\\/]v1[\\/]core[\\/]conversation-operator[\\/]route\.ts$/},a=>({
    loader:"ts",contents:install?
      readFileSync(a.path,"utf8").replace("RC42_ATOMIC_CONVERSATION_RPC_INSTALLED=false as const",
       "RC42_ATOMIC_CONVERSATION_RPC_INSTALLED=true as const"):readFileSync(a.path,"utf8")
   }));
  }}]});
 return import(pathToFileURL(file).href);
}
const prod=await compile(false),sim=await compile(true);
const C="11111111-1111-4111-8111-111111111111",N="22222222-2222-4222-8222-222222222222";
const U="33333333-3333-4333-8333-333333333333";
const actor={userId:U,teamId:U,cityId:U,aal:"aal2",expiresAtMs:Date.now()+120000};
const cmd={conversationId:C,nonce:N,expectedRevision:2,action:"PAUSE_AI"};
const receipt={nonce:N,conversation_id:C,action:"PAUSE_AI",previous_revision:2,
 new_revision:3,state:"PAUSED",replayed:false,consent_scope:"transactional",
 consent_policy_version:"qf-consent-v1",
 consent_reason:"transactional_no_consent_objection",
 event_id:"55555555-5555-4555-8555-555555555555",
 receipt_sha256:"a".repeat(64),provider_messages_sent:0};
const flags=["VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED","VOX_STAFF_GRANTS_ENABLED",
 "VOX_DEPARTMENT_ENFORCEMENT_ENABLED"];
const gate=(on)=>flags.forEach(k=>on?process.env[k]="staging":delete process.env[k]);
const request=(value=cmd)=>new Request("https://localhost/api/vox/v1/core/conversation-operator",{
 method:"POST",headers:{"content-type":"application/json","authorization":"Bearer test"},
 body:JSON.stringify(value)});
function world(verified=actor){
 const calls={auth:0,sql:0};
 globalThis.__rc43Core={verify:async()=>{calls.auth++;return verified;},
 rpc:async(fn,args)=>{calls.sql++;assert.equal(fn,"qf_vox_rc41_core_conversation_operator_atomic_candidate_v1");
 assert.equal(args.p_actor,U);return {data:[receipt],error:null};}};
 return calls;
}
test("real production route ignores every feature flag while installation unreviewed",async()=>{
 for(const on of [false,true]){
  gate(on);const calls=world();
  const r=await prod.POST(request());
  assert.equal(r.status,503);assert.equal(calls.auth,0);assert.equal(calls.sql,0);
 }
 assert.equal(prod.RC42_ATOMIC_CONVERSATION_RPC_INSTALLED,false);
});
test("test-only installed route still requires all staging guards before any auth",async()=>{
 gate(false);const calls=world();
 assert.equal((await sim.POST(request())).status,503);
 assert.equal(calls.auth,0);assert.equal(calls.sql,0);
});
test("test-only installed route enforces real actor preflight and serialized SQL argument binding",async()=>{
 gate(true);const calls=world();
 const r=await sim.POST(request());
 assert.equal(r.status,200);assert.equal((await r.json()).providerMessagesSent,0);
 // Route preflight + handler preflight + post-RPC live Staff re-verification.
 assert.equal(calls.auth,3);assert.equal(calls.sql,1);
});
test("revoked AAL2, malformed input and forged role never reach core authority",async()=>{
 gate(true);
 let calls=world(null);assert.equal((await sim.POST(request())).status,403);
 assert.equal(calls.auth,1);assert.equal(calls.sql,0);
 calls=world();assert.equal((await sim.POST(request({...cmd,actorId:U}))).status,400);
 assert.equal(calls.sql,0);
});
test("actual installed Core route rejects a hung GoTrue preflight before SQL",async()=>{
 gate(true);
 const calls=world();
 globalThis.__rc43Core.verify=async()=>{calls.auth++;return new Promise(()=>{});};
 const start=Date.now();
 const r=await sim.POST(request());
 assert.ok(Date.now()-start<2500);assert.equal(r.status,503);
 const b=await r.json();assert.equal(b.error,"CURRENT_STAFF_AUTH_TIMEOUT");
 assert.equal(calls.auth,1);assert.equal(calls.sql,0);
});
test("all non-POST HTTP methods are closed in both production and simulated route",async()=>{
 for(const mod of [prod,sim])for(const verb of ["GET","PUT","PATCH","DELETE"]){
  const r=await mod[verb]();assert.equal(r.status,405);
 }
});
process.on("exit",()=>rmSync(tmp,{recursive:true,force:true}));
