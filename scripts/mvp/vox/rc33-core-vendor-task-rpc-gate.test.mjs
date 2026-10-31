import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
// Compiled REAL route + REAL verifiedScopedStaff. Supabase is an in-memory fake
// whose rpc() mimics the candidate SQL's error contract. SQL concurrency is
// proven separately by validate-vox-rc32-core-vendor-task-atomic-pg17.ps1.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const output=resolve(root,"test-results/rc33-vendor-task-rpc-bundle.mjs");
await build({entryPoints:[resolve(root,"app/api/vox/v1/vendor-task/route.ts")],
 bundle:true,platform:"node",target:"node20",format:"esm",logLevel:"silent",outfile:output,
 external:["node:*"],
 plugins:[{name:"rc33-mocks",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"noop",namespace:"rc33"}));
  b.onResolve({filter:/(^|\/)lib\/supabase$/},()=>({path:"supabase",namespace:"rc33"}));
  b.onLoad({filter:/.*/,namespace:"rc33"},a=>({loader:"js",contents:a.path==="noop"?"":`
export async function verifySupabaseBearerUser(){return globalThis.__rc33.authUser}
export function adminClient(){return globalThis.__rc33.client}
`}));
 }}]});
const route=await import(pathToFileURL(output).href);
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const U=id(1),TEAM=id(2),CITY=id(3),VENDOR=id(4),ZONE=id(5),NONCE=id(6);
const now=()=>Math.floor(Date.now()/1000);
const jwt="h."+Buffer.from(JSON.stringify({sub:U,aal:"aal2",iat:now()-30,exp:now()+600,
 is_anonymous:false,pad:"x".repeat(120)})).toString("base64url")+".s";
function fakeClient(state){
 return {
  rpc(name,args){
   state.rpcCalls.push({name,args});
   return Promise.resolve(state.rpcImpl(name,args));
  },
  from(table){
   state.reads.push(table);
   const f=[];
   const b={select(){return b},limit(){return b},
    eq(c,v){f.push(r=>r[c]===v);return b},is(c,v){f.push(r=>r[c]===v);return b},
    in(c,v){f.push(r=>v.includes(r[c]));return b},
    async maybeSingle(){return {data:(state.tables[table]??[]).filter(r=>f.every(p=>p(r)))[0]??null,error:null}},
    insert(){state.inserts++;throw new Error("direct insert must not happen on RPC path")},
    then(res,rej){return Promise.resolve({data:(state.tables[table]??[]).filter(r=>f.every(p=>p(r))),error:null}).then(res,rej)}};
   return b;
  }};
}
function setup(rpcImpl){
 const future=new Date(Date.now()+3600000).toISOString();
 const keys=new Map();
 const state={reads:[],inserts:0,rpcCalls:[],tables:{
  profiles:[{id:U,role:null,is_active:true}],
  vox_staff_memberships_v1:[{auth_user_id:U,team_id:TEAM,staff_role:"vendor_success_agent",is_active:true,revoked_at:null,expires_at:future}],
  vox_staff_teams_v1:[{id:TEAM,city_id:CITY,is_active:true}],
  cities:[{id:CITY,is_active:true}],
  vox_staff_object_scopes_v1:[{auth_user_id:U,scope_kind:"vendor",object_id:VENDOR,expires_at:future,revoked_at:null}],
  vendors:[{id:VENDOR,service_zone_id:ZONE}],
  marketplace_service_zones:[{id:ZONE,city_id:CITY,is_active:true}],
 }};
 // Default: replay-aware RPC fake (201 then 200; different title => conflict).
 state.rpcImpl=rpcImpl??((n,a)=>{
  const prior=keys.get(a.p_idempotency_key);
  if(!prior){keys.set(a.p_idempotency_key,{title:a.p_title,tid:id(100)});
   return {data:[{task_id:id(100),created:true}],error:null};}
  if(prior.title!==a.p_title)
   return {data:null,error:{code:"P0001",message:"VOX_VENDOR_TASK_IDEMPOTENCY_CONFLICT"}};
  return {data:[{task_id:prior.tid,created:false}],error:null};
 });
 globalThis.__rc33={client:fakeClient(state),
  authUser:{id:U,app_metadata:{qf_principal:"vox_staff",vox_role:"vendor_success_agent",admin_role:null}}};
 process.env.VOX_VENDOR_CRM_TASKS_ENABLED="staging";
 process.env.VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED="staging";
 delete process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED;
 return state;
}
const DUE=new Date(Date.now()+86400000).toISOString();
const body=(over={})=>({vendorId:VENDOR,nonce:NONCE,taskType:"general",title:"Follow up on documents",
 priority:"medium",dueAt:DUE,...over});
const post=(b=body())=>route.POST(new Request("http://t/api/vox/v1/vendor-task",{method:"POST",
 headers:{"content-type":"application/json",authorization:"Bearer "+jwt},body:JSON.stringify(b)}));

test("RPC path: 201 create, 200 replay, 409 conflict; single atomic call each, no direct insert",async()=>{
 const s=setup();
 const a=await post();const aj=await a.json();
 assert.equal(a.status,201);assert.equal(aj.created,true);
 const b=await post();const bj=await b.json();
 assert.equal(b.status,200);assert.equal(bj.created,false);assert.equal(bj.taskId,aj.taskId);
 const c=await post(body({title:"A completely different title"}));
 assert.equal(c.status,409);assert.equal((await c.json()).error,"IDEMPOTENCY_CONFLICT");
 assert.equal(s.rpcCalls.length,3);assert.equal(s.inserts,0);
 const args=s.rpcCalls[0].args;
 assert.equal(s.rpcCalls[0].name,"qf_vox_core_vendor_task_atomic_candidate_v1");
 assert.equal(args.p_actor,U);assert.equal(args.p_team,TEAM);assert.equal(args.p_city,CITY);
 assert.match(args.p_idempotency_key,/^vox-[0-9a-f]{64}$/);
});
test("RPC authority denials map to 403 and never leak a task id",async()=>{
 for(const m of ["VOX_CORE_TASK_VENDOR_GRANT_NOT_CURRENT","VOX_CORE_TASK_STAFF_NOT_CURRENT",
   "VOX_CORE_TASK_TEAM_OR_CITY_NOT_CURRENT","VOX_CORE_TASK_VENDOR_CITY_DENIED"]){
  setup(()=>({data:null,error:{code:"P0001",message:m}}));
  const r=await post();const t=await r.text();
  assert.equal(r.status,403);assert.equal(t.includes("taskId"),false);
 }
});
test("RPC missing / unauthorized / malformed result fails closed with 503, no fallback insert",async()=>{
 for(const impl of [
   ()=>({data:null,error:{code:"PGRST202",message:"Could not find the function public.qf_vox_core_vendor_task_atomic_candidate_v1"}}),
   ()=>({data:null,error:{code:"42501",message:"permission denied for function"}}),
   ()=>({data:[],error:null}),
   ()=>({data:[{task_id:5,created:"yes"}],error:null})]){
  const s=setup(impl);
  const r=await post();const j=await r.json();
  assert.equal(r.status,503);assert.equal(j.error,"VENDOR_TASK_UNAVAILABLE");
  assert.equal(s.inserts,0);
  assert.equal(JSON.stringify(j).includes("function"),false);
 }
});
test("gate default OFF never calls the RPC (legacy path retained)",async()=>{
 for(const v of [undefined,"","true","1","production"]){
  const s=setup();
  if(v===undefined)delete process.env.VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED;
  else process.env.VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED=v;
  await post().catch(()=>{});
  assert.equal(s.rpcCalls.length,0);
 }
});
test("pre-RPC checks still deny: unassigned vendor never reaches the RPC",async()=>{
 const s=setup();
 const r=await post(body({vendorId:id(9)}));
 assert.equal(r.status,400);assert.equal(s.rpcCalls.length,0);
});
test("revoked actor is denied before the RPC (Auth/Core authority)",async()=>{
 const s=setup();
 s.tables.vox_staff_memberships_v1[0].is_active=false;
 const r=await post();
 assert.ok([400,403].includes(r.status));assert.equal(s.rpcCalls.length,0);
});
