import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {readFileSync} from "node:fs";
// Compiled REAL route + REAL verifiedScopedStaff. Supabase is an in-memory fake
// whose rpc() mimics the candidate SQL's error contract. SQL concurrency is
// proven separately by validate-vox-rc32-core-vendor-task-atomic-pg17.ps1.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const output=resolve(root,"test-results/rc39-vendor-task-no-fallback-bundle.mjs");
await build({entryPoints:[resolve(root,"app/api/vox/v1/vendor-task/route.ts")],
 bundle:true,platform:"node",target:"node20",format:"esm",logLevel:"silent",outfile:output,
 external:["node:*"],
 plugins:[{name:"rc39-mocks",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"noop",namespace:"rc39"}));
  b.onResolve({filter:/(^|\/)lib\/supabase$/},()=>({path:"supabase",namespace:"rc39"}));
  b.onLoad({filter:/.*/,namespace:"rc39"},a=>({loader:"js",contents:a.path==="noop"?"":`
export async function verifySupabaseBearerUser(){return globalThis.__rc39.authUser}
export function adminClient(){return globalThis.__rc39.client}
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
 globalThis.__rc39={client:fakeClient(state),
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

const WRITE_TABLES=["vendors","vendor_tasks","vendor_crm_tasks","marketplace_service_zones"];
const gone=s=>assert.equal(s.reads.some(t=>WRITE_TABLES.includes(t)),false,"no vendor/task table access");
test("atomic happy path: AAL2 scoped Staff, exact RPC args, receipt echoed, no vendor table access",async()=>{
 const s=setup(()=>({data:[{task_id:id(100),created:true}],error:null}));
 const r=await post();const j=await r.json();
 assert.equal(r.status,201);assert.equal(j.ok,true);assert.equal(j.taskId,id(100));assert.equal(j.created,true);
 assert.equal(s.rpcCalls.length,1);assert.equal(s.rpcCalls[0].name,"qf_vox_core_vendor_task_atomic_candidate_v1");
 assert.equal(s.rpcCalls[0].args.p_actor,U);assert.equal(s.rpcCalls[0].args.p_vendor,VENDOR);
 assert.equal(s.inserts,0);gone(s);
});
test("invalid receipt shapes fail closed with 503 and no fallback write",async()=>{
 for(const data of [null,[],{},[{task_id:"nope",created:true}],[{task_id:id(1),created:1}],
   [{task_id:id(100),created:true},{task_id:id(101),created:true}]]){
  const s=setup(()=>({data,error:null}));
  const r=await post();const t=await r.text();
  assert.equal(r.status,503);assert.equal(t.includes("taskId"),false);
  assert.equal(s.rpcCalls.length,1);assert.equal(s.inserts,0);gone(s);
 }
});
test("RPC unavailable never falls back to a direct write",async()=>{
 const s=setup(()=>({data:null,error:{code:"PGRST202",message:"function missing"}}));
 const r=await post();
 assert.equal(r.status,503);assert.equal(s.inserts,0);gone(s);
});
test("revoked Staff is denied before the RPC",async()=>{
 const s=setup();s.tables.vox_staff_memberships_v1[0].is_active=false;
 const r=await post();
 assert.ok([400,403].includes(r.status));assert.equal(s.rpcCalls.length,0);gone(s);
});
test("missing or non-staging flag: 503 before header, auth, body or RPC",async()=>{
 for(const flag of ["VOX_VENDOR_CRM_TASKS_ENABLED","VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED"])
  for(const v of [undefined,"","true","production","Staging"]){
   const s=setup();
   if(v===undefined)delete process.env[flag];else process.env[flag]=v;
   const r=await route.POST(new Request("http://t/x",{method:"POST",body:"{"}));
   assert.equal(r.status,503);assert.equal((await r.json()).error,"VENDOR_TASKS_DISABLED");
   assert.equal(s.rpcCalls.length,0);assert.equal(s.reads.length,0);
  }
});
test("source: no legacy fallback, literal dual staging gates",()=>{
 const code=readFileSync(resolve(root,"app/api/vox/v1/vendor-task/route.ts"),"utf8");
 assert.equal((code.match(/VOX_VENDOR_CRM_TASKS_ENABLED!=="staging"/g)??[]).length,1);
 assert.equal((code.match(/VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED!=="staging"/g)??[]).length,1);
 assert.equal(/vendorCrmService|createVendorTask|\.from\(|\.insert\(|\.update\(/.test(code),false);
});
