import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdirSync,readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
// Compiled REAL route + REAL verifiedScopedStaff + REAL contract. Only Supabase
// is an in-memory fake. RC38: the historical weak service-role CAS is gone; these
// tests prove the route reaches vendor data only through the atomic RPC and never
// reads or writes vendor_tasks/vendors/zones directly.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const output=resolve(root,"test-results/rc35-vendor-task-transition-bundle.mjs");
await build({entryPoints:[resolve(root,"app/api/vox/v1/vendor-task-transition/route.ts")],
 bundle:true,platform:"node",target:"node20",format:"esm",logLevel:"silent",outfile:output,
 external:["node:*"],
 plugins:[{name:"rc35-mocks",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"noop",namespace:"rc35"}));
  b.onResolve({filter:/(^|\/)lib\/supabase$/},()=>({path:"supabase",namespace:"rc35"}));
  b.onLoad({filter:/.*/,namespace:"rc35"},a=>({loader:"js",contents:a.path==="noop"?"":`
export async function verifySupabaseBearerUser(){return globalThis.__rc35.authUser}
export function adminClient(){return globalThis.__rc35.client}
`}));
 }}]});
const route=await import(pathToFileURL(output).href);
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const U=id(1),TEAM=id(2),CITY=id(3),VENDOR=id(4),ZONE=id(5),TASK=id(6);
const RECEIPT="b".repeat(64);
const now=()=>Math.floor(Date.now()/1000);
const jwt=(aal="aal2")=>"h."+Buffer.from(JSON.stringify({sub:U,aal,iat:now()-30,exp:now()+600,
 is_anonymous:false,pad:"x".repeat(120)})).toString("base64url")+".s";
function fakeClient(state){
 return {
  rpc(fn,args){state.rpcs.push({fn,args});
   return Promise.resolve(state.rpcResult??{data:[{task_id:args.p_task,
    task_status:args.p_action==="complete"?"done":"cancelled",replayed:false,receipt:RECEIPT}],error:null})},
  from(table){
  state.reads.push(table);
  const f=[];let patch=null;
  const rows=()=>(state.tables[table]??[]).filter(r=>f.every(p=>p(r)));
  const b={select(){return b},limit(){return b},
   eq(c,v){f.push(r=>r[c]===v);return b},is(c,v){f.push(r=>r[c]===v);return b},
   in(c,v){f.push(r=>v.includes(r[c]));return b},
   update(p){patch=p;state.updates.push({table,patch:p});return b},
   async maybeSingle(){return {data:rows()[0]??null,error:null}},
   then(res,rej){
    if(patch){const hit=rows();hit.forEach(r=>Object.assign(r,patch));
     return Promise.resolve({data:hit.map(r=>({id:r.id})),error:null}).then(res,rej);}
    return Promise.resolve({data:rows(),error:null}).then(res,rej);
   }};
  return b;
 }};
}
function setup(){
 const future=new Date(Date.now()+3600000).toISOString();
 const state={reads:[],updates:[],rpcs:[],tables:{
  profiles:[{id:U,role:null,is_active:true}],
  vox_staff_memberships_v1:[{auth_user_id:U,team_id:TEAM,staff_role:"vendor_success_agent",is_active:true,revoked_at:null,expires_at:future}],
  vox_staff_teams_v1:[{id:TEAM,city_id:CITY,is_active:true}],
  cities:[{id:CITY,is_active:true}],
  vox_staff_object_scopes_v1:[{auth_user_id:U,scope_kind:"vendor",object_id:VENDOR,expires_at:future,revoked_at:null}],
  vendors:[{id:VENDOR,service_zone_id:ZONE}],
  marketplace_service_zones:[{id:ZONE,city_id:CITY,is_active:true}],
  vendor_tasks:[{id:TASK,vendor_id:VENDOR,status:"open",completion_result:null,updated_by:null}],
 }};
 globalThis.__rc35={client:fakeClient(state),
  authUser:{id:U,app_metadata:{qf_principal:"vox_staff",vox_role:"vendor_success_agent",admin_role:null}}};
 process.env.VOX_VENDOR_CRM_TASKS_ENABLED="staging";
 process.env.VOX_VENDOR_TASK_TRANSITIONS_ENABLED="staging";
 process.env.VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED="staging";
 delete process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED;
 return state;
}
const complete=(o={})=>({taskId:TASK,action:"complete",result:"Documents received and verified",...o});
const post=(b=complete(),token=jwt())=>route.POST(new Request("http://t/api/vox/v1/vendor-task-transition",{
 method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify(b)}));
const task=s=>s.tables.vendor_tasks[0];

test("complete: 201 through the atomic RPC only; zero direct vendor table access or writes",async()=>{
 const s=setup();
 const a=await post();const aj=await a.json();
 assert.equal(a.status,201);assert.equal(aj.replayed,false);assert.equal(aj.status,"done");
 assert.equal(s.rpcs.length,1);assert.equal(s.updates.length,0);
 for(const t of ["vendor_tasks","vendors","marketplace_service_zones"])assert.equal(s.reads.includes(t),false,t);
 assert.equal(task(s).status,"open");
});
test("cancel: 201, replay 200, DB state conflict 409; the route itself never writes",async()=>{
 let s=setup();
 assert.equal((await post({taskId:TASK,action:"cancel"})).status,201);
 s=setup();s.rpcResult={data:[{task_id:TASK,task_status:"cancelled",replayed:true,receipt:RECEIPT}],error:null};
 assert.equal((await post({taskId:TASK,action:"cancel"})).status,200);
 s=setup();s.rpcResult={data:null,error:{message:"VOX_VENDOR_TASK_STATE_CONFLICT"}};
 const c=await post();assert.equal(c.status,409);
 assert.equal((await c.json()).error,"TASK_STATE_CONFLICT");
 assert.equal(s.updates.length,0);assert.equal(task(s).status,"open");
});
test("AAL1, missing bearer and non-eligible roles are denied before the RPC",async()=>{
 let s=setup();
 assert.equal((await post(complete(),jwt("aal1"))).status,403);
 assert.equal(s.rpcs.length,0);
 s=setup();
 const r=await route.POST(new Request("http://t/x",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
 assert.equal(r.status,403);assert.equal(s.rpcs.length,0);
 for(const role of ["auditor","support_agent"]){
  s=setup();s.tables.vox_staff_memberships_v1[0].staff_role=role;
  assert.equal((await post()).status,403,role);
  assert.equal(s.rpcs.length,0);assert.equal(s.updates.length,0);
 }
});
test("gates off and non-JSON are rejected before any read or RPC",async()=>{
 let s=setup();delete process.env.VOX_VENDOR_TASK_TRANSITIONS_ENABLED;
 assert.equal((await post()).status,503);
 process.env.VOX_VENDOR_TASK_TRANSITIONS_ENABLED="staging";
 delete process.env.VOX_VENDOR_CRM_TASKS_ENABLED;
 assert.equal((await post()).status,503);
 process.env.VOX_VENDOR_CRM_TASKS_ENABLED="staging";
 const r=await route.POST(new Request("http://t/x",{method:"POST",headers:{"content-type":"text/plain"},body:"x"}));
 assert.equal(r.status,415);assert.equal(s.reads.length,0);assert.equal(s.rpcs.length,0);
});
test("input contract: unknown keys, bad action, result rules and size are rejected before the RPC",async()=>{
 for(const b of [complete({extra:1}),complete({action:"reopen"}),complete({result:"short"}),
   complete({result:"x".repeat(301)}),complete({result:"bad\u0007control chars"}),
   complete({result:undefined}),{taskId:TASK,action:"cancel",result:"not allowed here"},
   complete({taskId:"nope"}),complete({status:"done"}),complete({vendorId:VENDOR})]){
  const s=setup();const r=await post(b);
  assert.equal(r.status,400,JSON.stringify(b));assert.equal(s.updates.length,0);assert.equal(s.rpcs.length,0);
 }
 const s=setup();
 assert.equal((await post(complete({result:"y".repeat(700)}))).status,413);assert.equal(s.rpcs.length,0);
});
test("store failure fails closed with no provider detail",async()=>{
 const s=setup();s.rpcResult={data:null,error:{code:"XX000",message:"secret"}};
 const r=await post();const t=await r.text();
 assert.equal(r.status,503);assert.equal(t.includes("secret"),false);assert.equal(task(s).status,"open");
});
test("static boundary: route/contract never touch consent, conversation, WhatsApp or credits; no table API at all",()=>{
 const src=["app/api/vox/v1/vendor-task-transition/route.ts","contracts/vox/vendorTaskTransitionInput.mjs"]
  .map(p=>readFileSync(resolve(root,p),"utf8").replace(/^\s*\/\/.*$/gm,"")).join("\n");
 assert.equal(/CORE_CONVERSATION|consent|whatsapp|vendor_credits|\.insert\(|\.delete\(/i.test(src),false);
 assert.deepEqual(src.match(/\.rpc\([^,]*/g)??[],[".rpc(ATOMIC_RPC"]);
 assert.equal(/\.from\(|\.update\(|\.upsert\(|ACTIVE|completion_result/.test(src.split("\n").filter(l=>!l.includes("p_result")).join("\n")),false);
 assert.match(src,/const ATOMIC_RPC="qf_vox_core_vendor_task_transition_atomic_candidate_v1"/);
});
