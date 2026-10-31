import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
// Compiled REAL route + REAL verifiedScopedStaff + REAL vendorCrmService.
// Only Supabase is an in-memory fake. The atomic RPC SQL stays uninstalled; its
// error/result contract is mimicked here and proven separately by the PG17 .ps1.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const output=resolve(root,"test-results/rc34-vendor-task-result-integrity-bundle.mjs");
await build({entryPoints:[resolve(root,"app/api/vox/v1/vendor-task/route.ts")],
 bundle:true,platform:"node",target:"node20",format:"esm",logLevel:"silent",outfile:output,
 external:["node:*"],
 plugins:[{name:"rc34-mocks",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"noop",namespace:"rc34"}));
  b.onResolve({filter:/(^|\/)lib\/supabase$/},()=>({path:"supabase",namespace:"rc34"}));
  b.onLoad({filter:/.*/,namespace:"rc34"},a=>({loader:"js",contents:a.path==="noop"?"":`
export async function verifySupabaseBearerUser(){return globalThis.__rc34.authUser}
export function adminClient(){return globalThis.__rc34.client}
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
  rpc(name,args){state.rpcCalls.push({name,args});return Promise.resolve(state.rpcImpl(name,args))},
  from(table){
   state.reads.push(table);
   if(table==="marketplace_service_zones"&&state.onZoneRead)state.onZoneRead();
   const f=[];
   const rows=()=>(state.tables[table]??[]).filter(r=>f.every(p=>p(r)));
   const b={select(){return b},limit(){return b},
    eq(c,v){f.push(r=>r[c]===v);return b},is(c,v){f.push(r=>r[c]===v);return b},
    in(c,v){f.push(r=>v.includes(r[c]));return b},
    async maybeSingle(){return {data:rows()[0]??null,error:null}},
    async single(){return state.pendingInsert},
    insert(row){
     state.inserts++;
     const rid=state.insertId??id(100+state.inserts);
     (state.tables[table]??=[]).push({...row,id:rid});
     state.pendingInsert={data:{id:rid},error:null};
     return b;
    },
    then(res,rej){return Promise.resolve({data:rows(),error:null}).then(res,rej)}};
   return b;
  }};
}
function setup(over={}){
 const future=new Date(Date.now()+3600000).toISOString();
 const state={reads:[],inserts:0,rpcCalls:[],tables:{
  profiles:[{id:U,role:null,is_active:true}],
  vox_staff_memberships_v1:[{auth_user_id:U,team_id:TEAM,staff_role:"vendor_success_agent",is_active:true,revoked_at:null,expires_at:future}],
  vox_staff_teams_v1:[{id:TEAM,city_id:CITY,is_active:true}],
  cities:[{id:CITY,is_active:true}],
  vox_staff_object_scopes_v1:[{auth_user_id:U,scope_kind:"vendor",object_id:VENDOR,expires_at:future,revoked_at:null}],
  vendors:[{id:VENDOR,service_zone_id:ZONE}],
  marketplace_service_zones:[{id:ZONE,city_id:CITY,is_active:true}],
  vendor_tasks:[],
 },rpcImpl:()=>({data:[{task_id:id(100),created:true}],error:null}),...over};
 globalThis.__rc34={client:fakeClient(state),
  authUser:{id:U,app_metadata:{qf_principal:"vox_staff",vox_role:"vendor_success_agent",admin_role:null}}};
 process.env.VOX_VENDOR_CRM_TASKS_ENABLED="staging";
 delete process.env.VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED;
 delete process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED;
 return state;
}
const DUE=new Date(Date.now()+86400000).toISOString();
const body=(over={})=>({vendorId:VENDOR,nonce:NONCE,taskType:"general",title:"Follow up on documents",
 priority:"medium",dueAt:DUE,...over});
const post=(b=body())=>route.POST(new Request("http://t/api/vox/v1/vendor-task",{method:"POST",
 headers:{"content-type":"application/json",authorization:"Bearer "+jwt},body:JSON.stringify(b)}));

test("RPC path: forged / malformed receipt rows fail closed and are never echoed",async()=>{
 const forged=[
  [{task_id:"not-a-uuid",created:true}],
  [{task_id:"<script>alert(1)</script>",created:false}],
  [{task_id:id(100)+"-extra",created:true}],
  [{task_id:id(100),created:true},{task_id:id(101),created:true}],
  [{task_id:id(100),created:"true"}],
  [{task_id:null,created:true}],
 ];
 for(const data of forged){
  const s=setup({rpcImpl:()=>({data,error:null})});
  process.env.VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED="staging";
  const r=await post();const t=await r.text();
  assert.equal(r.status,503,JSON.stringify(data));
  assert.equal(JSON.parse(t).error,"VENDOR_TASK_UNAVAILABLE");
  assert.equal(t.includes("taskId"),false);
  assert.equal(t.includes("script"),false);
  assert.equal(s.inserts,0);
 }
});
test("RPC path: valid UUID receipt is accepted (201 create / 200 replay)",async()=>{
 for(const [created,status] of [[true,201],[false,200]]){
  setup({rpcImpl:()=>({data:[{task_id:id(100),created}],error:null})});
  process.env.VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED="staging";
  const r=await post();const j=await r.json();
  assert.equal(r.status,status);assert.equal(j.taskId,id(100));assert.equal(j.created,created);
 }
});
test("legacy path: create 201 then exact replay 200 with the same id, one insert",async()=>{
 const s=setup();
 const a=await post();const aj=await a.json();
 assert.equal(a.status,201);assert.equal(aj.created,true);
 const b=await post();const bj=await b.json();
 assert.equal(b.status,200);assert.equal(bj.created,false);assert.equal(bj.taskId,aj.taskId);
 assert.equal(s.inserts,1);
 const c=await post(body({title:"A completely different title"}));
 assert.equal(c.status,409);assert.equal((await c.json()).error,"IDEMPOTENCY_CONFLICT");
 assert.equal(s.inserts,1);
});
test("legacy path: non-UUID id returned by the store is not echoed",async()=>{
 const s=setup({insertId:"forged-id"});
 const r=await post();const t=await r.text();
 assert.equal(r.status,503);assert.equal(t.includes("forged-id"),false);
 assert.equal(t.includes("taskId"),false);
});
test("legacy path: grant revoked mid-flight denies creation AND replay with no task id",async()=>{
 const s=setup();
 assert.equal((await post()).status,201);
 assert.equal(s.inserts,1);
 // Revoke the vendor grant after the first authority read (during zone lookup).
 s.onZoneRead=()=>{s.tables.vox_staff_object_scopes_v1[0].revoked_at=new Date().toISOString()};
 const r=await post();const t=await r.text();
 assert.ok([400,403].includes(r.status),String(r.status));
 assert.equal(t.includes("taskId"),false);
 assert.equal(s.inserts,1);
});
test("legacy path: staff membership revoked mid-flight denies replay",async()=>{
 const s=setup();
 assert.equal((await post()).status,201);
 let calls=0;
 s.onZoneRead=()=>{if(++calls>=1)s.tables.vox_staff_memberships_v1[0].is_active=false};
 const r=await post();const t=await r.text();
 assert.equal(r.status,403);assert.equal(t.includes("taskId"),false);
 assert.equal(s.inserts,1);
});
test("another actor's idempotency row is never replayed to this actor",async()=>{
 const s=setup();
 const key=(await (async()=>{await post();return s.tables.vendor_tasks[0].idempotency_key})());
 s.tables.vendor_tasks[0].created_by=id(77);
 const r=await post();const t=await r.text();
 assert.equal(r.status,409);assert.equal(t.includes("taskId"),false);
 assert.match(key,/^vox-[0-9a-f]{64}$/);
});
