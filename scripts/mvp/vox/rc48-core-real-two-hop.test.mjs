// Actual Web BFF -> actual pinned Core route -> compiled atomic RPC adapter.
// Only GoTrue identity and SQL backend are test doubles. The real production
// Core route is always hard OFF and never performs a database operation.
import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const tmp=mkdtempSync(join(tmpdir(),"vox-rc48-two-hop-"));
const C="11111111-1111-4111-8111-111111111111",N="22222222-2222-4222-8222-222222222222";
const U="33333333-3333-4333-8333-333333333333";
const state={actor:{userId:U,teamId:U,cityId:U,aal:"aal2",expiresAtMs:Date.now()+120000},
 token:"test-staff-token",auth:0,sql:0,fetches:0,reply:null};
const record={nonce:N,conversation_id:C,action:"PAUSE_AI",previous_revision:2,
 new_revision:3,state:"PAUSED",replayed:false,consent_scope:"transactional",
 consent_policy_version:"qf-consent-v1",consent_reason:"transactional_no_consent_objection",
 event_id:"55555555-5555-4555-8555-555555555555",receipt_sha256:"a".repeat(64),
 provider_messages_sent:0};
state.reply={...record};
const flags=["VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED","VOX_STAFF_GRANTS_ENABLED",
 "VOX_DEPARTMENT_ENFORCEMENT_ENABLED","VOX_STAFF_PORTAL_ENABLED","VOX_TEAM_WORKSPACE_ENABLED"];
function gate(on){for(const k of flags)on?process.env[k]="staging":delete process.env[k];
 process.env.VOX_STAFF_VIEW_MODE="scoped";}
const source=resolve(root,"app/api/vox/v1/core/conversation-operator/route.ts");
async function core(install){
 const outfile=join(tmp,install?"installed.mjs":"production.mjs");
 await build({entryPoints:[source],outfile,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
  plugins:[{name:"core-boundary",setup(b){
   b.onResolve({filter:/^server-only$/},()=>({path:"empty",namespace:"fake"}));
   b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:"db",namespace:"fake"}));
   b.onResolve({filter:/^@\/services\/vox\/verifiedStaffBearer$/},()=>({path:"auth",namespace:"fake"}));
   b.onResolve({filter:/^@\//},a=>({path:resolve(root,a.path.slice(2))+".ts"}));
   b.onLoad({filter:/.*/,namespace:"fake"},a=>({loader:"js",contents:a.path==="db"?
    "export const adminClient=()=>({rpc:async(fn,args)=>{globalThis.__rc48.sql++;globalThis.__rc48.fn=fn;globalThis.__rc48.args=args;return {data:[globalThis.__rc48.reply],error:null}}});":
    a.path==="auth"?
    "export const verifyVoxOperationsStaffBearer=async()=>{globalThis.__rc48.auth++;return globalThis.__rc48.actor;};":""}));
   b.onLoad({filter:/app[\\/]api[\\/]vox[\\/]v1[\\/]core[\\/]conversation-operator[\\/]route\.ts$/},a=>({
    loader:"ts",contents:install?readFileSync(a.path,"utf8").replace(
     "RC42_ATOMIC_CONVERSATION_RPC_INSTALLED=false as const",
     "RC42_ATOMIC_CONVERSATION_RPC_INSTALLED=true as const"):readFileSync(a.path,"utf8")
   }));
  }}]});
 return import(pathToFileURL(outfile).href);
}
globalThis.__rc48=state;
const prod=await core(false),sim=await core(true);
const webfile=resolve(root,"apps/vox-web/app/api/conversation-control/route.ts");
const webOut=join(tmp,"web.mjs");
await build({entryPoints:[webfile],outfile:webOut,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"web-boundary",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"empty",namespace:"fake"}));
  b.onResolve({filter:/^\.\/?\.?\/.*\/lib\/auth$|^\.\/auth$/},()=>({path:"auth",namespace:"fake"}));
  b.onResolve({filter:/^\.\/core$/},()=>({path:"core",namespace:"fake"}));
  b.onLoad({filter:/.*/,namespace:"fake"},a=>({loader:"js",contents:a.path==="auth"?
   "export const allowedOrigin=()=>true;export const safeJson=(data,status)=>Response.json(data,{status});export const verifiedMfaSession=async()=>globalThis.__rc48.token;":
   a.path==="core"?
   "export const origin=()=>\"https://staging-core.quickfurno.in\";":""}));
 }}]});
const web=await import(pathToFileURL(webOut).href);
const cmd={conversationId:C,nonce:N,expectedRevision:2,action:"PAUSE_AI"};
const webRequest=(value=cmd)=>new Request("https://vox.local.test/api/conversation-control",{
 method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(value)});
const oldFetch=globalThis.fetch;
function reset(){gate(true);state.auth=0;state.sql=0;state.fetches=0;
 state.actor={userId:U,teamId:U,cityId:U,aal:"aal2",expiresAtMs:Date.now()+120000};
 state.token="test-staff-token";state.reply={...record};}
let target=prod;
globalThis.fetch=async(url,opts)=>{
 state.fetches++;
 assert.equal(url,"https://staging-core.quickfurno.in/api/vox/v1/core/conversation-operator");
 assert.equal(opts.headers.authorization,"Bearer test-staff-token");
 return target.POST(new Request(url,{method:opts.method,headers:opts.headers,body:opts.body}));
};
test("actual production hard-OFF Core never reaches auth or SQL via Web",async()=>{
 reset();target=prod;
 assert.equal((await web.POST(webRequest())).status,503);
 assert.equal(state.sql,0);assert.equal(state.auth,0);assert.equal(state.fetches,1);
});
test("two-hop simulated approved path checks current AAL2 twice, binds atomic args, no send",async()=>{
 reset();target=sim;
 const r=await web.POST(webRequest());assert.equal(r.status,200);
 const body=await r.json();assert.equal(body.ok,true);
 assert.equal(body.providerMessagesSent,0);assert.equal(body.newRevision,3);
 assert.equal(state.auth,2);assert.equal(state.sql,1);assert.equal(state.fetches,1);
 assert.equal(state.fn,"qf_vox_rc41_core_conversation_operator_atomic_candidate_v1");
 assert.equal(state.args.p_actor,U);assert.equal(state.args.p_nonce,N);
 assert.equal(state.args.p_conversation,C);assert.equal(state.args.p_expected_revision,2);
});
test("revoked Staff authority refuses before SQL mutation at Core",async()=>{
 reset();target=sim;state.actor=null;
 const r=await web.POST(webRequest());assert.equal(r.status,403);
 assert.equal(state.sql,0);assert.equal(state.auth,1);
});
test("mismatched native SQL receipt never becomes Web success",async()=>{
 reset();target=sim;state.reply={...record,provider_messages_sent:1};
 const r=await web.POST(webRequest());assert.equal(r.status,503);
 assert.equal(state.sql,1);
});
process.on("exit",()=>{globalThis.fetch=oldFetch;delete globalThis.__rc48;
 rmSync(tmp,{recursive:true,force:true});});
