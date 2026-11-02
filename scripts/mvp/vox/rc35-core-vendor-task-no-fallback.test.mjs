import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdirSync,readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
// Focused proof that vendor-task has NO non-atomic service-role fallback: the
// native RPC is the only writer and both staging gates precede Auth and body.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const routePath=resolve(root,"app/api/vox/v1/vendor-task/route.ts");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const output=resolve(root,"test-results/rc35-vendor-task-no-fallback-bundle.mjs");
await build({entryPoints:[routePath],bundle:true,platform:"node",target:"node20",
 format:"esm",logLevel:"silent",outfile:output,external:["node:*"],
 plugins:[{name:"rc35-mocks",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"noop",namespace:"rc35"}));
  b.onResolve({filter:/(^|\/)lib\/supabase$/},()=>({path:"supabase",namespace:"rc35"}));
  b.onLoad({filter:/.*/,namespace:"rc35"},a=>({loader:"js",contents:a.path==="noop"?"":`
export async function verifySupabaseBearerUser(){globalThis.__rc35.authCalls++;return globalThis.__rc35.authUser}
export function adminClient(){return globalThis.__rc35.client}
`}));
 }}]});
const route=await import(pathToFileURL(output).href);
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const U=id(1),TEAM=id(2),CITY=id(3),VENDOR=id(4),ZONE=id(5),NONCE=id(6);
const now=()=>Math.floor(Date.now()/1000);
const jwt="h."+Buffer.from(JSON.stringify({sub:U,aal:"aal2",iat:now()-30,exp:now()+600,
 is_anonymous:false,pad:"x".repeat(120)})).toString("base64url")+".s";
function setup(rpcImpl){
 const future=new Date(Date.now()+3600000).toISOString();
 const state={reads:[],inserts:0,rpcCalls:[],authCalls:0,tables:{
  profiles:[{id:U,role:null,is_active:true}],
  vox_staff_memberships_v1:[{auth_user_id:U,team_id:TEAM,staff_role:"vendor_success_agent",is_active:true,revoked_at:null,expires_at:future}],
  vox_staff_teams_v1:[{id:TEAM,city_id:CITY,is_active:true}],
  cities:[{id:CITY,is_active:true}],
  vox_staff_object_scopes_v1:[{auth_user_id:U,scope_kind:"vendor",object_id:VENDOR,expires_at:future,revoked_at:null}],
  vendors:[{id:VENDOR,service_zone_id:ZONE}],
  marketplace_service_zones:[{id:ZONE,city_id:CITY,is_active:true}],
 }};
 state.rpcImpl=rpcImpl??(()=>({data:[{task_id:id(100),created:true}],error:null}));
 globalThis.__rc35={authCalls:0,
  authUser:{id:U,app_metadata:{qf_principal:"vox_staff",vox_role:"vendor_success_agent",admin_role:null}},
  client:{
   rpc(name,args){state.rpcCalls.push({name,args});return Promise.resolve(state.rpcImpl(name,args))},
   from(table){
    state.reads.push(table);
    const f=[];
    const b={select(){return b},limit(){return b},
     eq(c,v){f.push(r=>r[c]===v);return b},is(c,v){f.push(r=>r[c]===v);return b},
     in(c,v){f.push(r=>v.includes(r[c]));return b},
     async maybeSingle(){return {data:(state.tables[table]??[]).filter(r=>f.every(p=>p(r)))[0]??null,error:null}},
     insert(){state.inserts++;throw new Error("direct insert forbidden")},
     upsert(){state.inserts++;throw new Error("direct upsert forbidden")},
     update(){state.inserts++;throw new Error("direct update forbidden")},
     then(res,rej){return Promise.resolve({data:(state.tables[table]??[]).filter(r=>f.every(p=>p(r))),error:null}).then(res,rej)}};
    return b;
   }}};
 // Auth counter lives on the shared global so the mocked verifier can bump it.
 Object.defineProperty(state,"authCalls",{get:()=>globalThis.__rc35.authCalls});
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

test("source: no service-role fallback, no vendorCrmService, no direct table writes",()=>{
 const src=readFileSync(routePath,"utf8");
 assert.equal(/vendorCrmService/.test(src),false);
 assert.equal(/createVendorTask/.test(src),false);
 assert.equal(/\.from\(/.test(src),false);
 assert.equal(/\.(insert|upsert|update|delete)\(/.test(src),false);
 assert.equal(/marketplace_service_zones|vendor_tasks/.test(src),false);
 assert.equal((src.match(/\.rpc\(/g)??[]).length,1);
 assert.match(src,/VOX_VENDOR_CRM_TASKS_ENABLED/);
 assert.match(src,/VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED/);
 // Gate check must be the first statement of POST, before headers/Auth/body.
 const post=src.slice(src.indexOf("export async function POST"));
 assert.ok(post.indexOf("gatesOn()")<post.indexOf("request.headers"));
 assert.ok(post.indexOf("gatesOn()")<post.indexOf("getVerifiedScopedStaff"));
 assert.ok(post.indexOf("gatesOn()")<post.indexOf("request.text"));
});
test("negative: either gate off => 503 before headers, Auth, body, RPC or any table",async()=>{
 for(const flag of ["VOX_VENDOR_CRM_TASKS_ENABLED","VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED"])
  for(const v of [undefined,"","staging ","STAGING","true"]){
   const s=setup();
   if(v===undefined)delete process.env[flag];else process.env[flag]=v;
   // A request whose headers and body throw if touched proves nothing is read.
   const trap=()=>{throw new Error("request accessed before gates")};
   const req={get headers(){return trap()},text:trap,json:trap};
   const r=await route.POST(req);const j=await r.json();
   assert.equal(r.status,503);assert.equal(j.error,"VENDOR_TASKS_DISABLED");
   assert.equal(s.rpcCalls.length,0);assert.equal(s.reads.length,0);
   assert.equal(s.authCalls,0);assert.equal(s.inserts,0);
  }
});
test("negative: RPC failure never falls back to a direct write",async()=>{
 for(const impl of [
   ()=>({data:null,error:{code:"PGRST202",message:"Could not find the function"}}),
   ()=>({data:null,error:{code:"42501",message:"permission denied"}}),
   ()=>{throw new Error("network down")},
   ()=>({data:[{task_id:id(1),created:true},{task_id:id(2),created:true}],error:null})]){
  const s=setup(impl);
  const r=await post();const j=await r.json();
  assert.equal(r.status,503);assert.equal(j.error,"VENDOR_TASK_UNAVAILABLE");
  assert.equal(s.rpcCalls.length,1);assert.equal(s.inserts,0);
  assert.equal(s.reads.includes("vendor_tasks"),false);
 }
});
test("positive: both gates staging => exactly one native RPC, no direct write or task-table access",async()=>{
 const s=setup();
 const r=await post();const j=await r.json();
 assert.equal(r.status,201);assert.equal(j.ok,true);assert.equal(j.taskId,id(100));assert.equal(j.created,true);
 assert.equal(s.rpcCalls.length,1);
 assert.equal(s.rpcCalls[0].name,"qf_vox_core_vendor_task_atomic_candidate_v1");
 assert.equal(s.inserts,0);
 assert.equal(s.reads.includes("vendor_tasks"),false);
 // The legacy path's post-hoc vendor/zone rechecks must be gone; the RPC
 // transaction owns that verification.
 assert.equal(s.reads.some(t=>["vendor_tasks","marketplace_service_zones"].includes(t)),false);
});
