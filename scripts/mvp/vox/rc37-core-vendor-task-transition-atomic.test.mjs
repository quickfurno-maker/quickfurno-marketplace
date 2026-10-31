import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdirSync,readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
// Compiled REAL route + REAL verifiedScopedStaff + REAL contract. Only Supabase
// is an in-memory fake; its rpc() records calls and returns scripted results.
// The executed DB proof is validate-vox-rc37-core-vendor-task-transition-atomic-pg17.ps1.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const output=resolve(root,"test-results/rc37-vendor-task-transition-bundle.mjs");
await build({entryPoints:[resolve(root,"app/api/vox/v1/vendor-task-transition/route.ts")],
 bundle:true,platform:"node",target:"node20",format:"esm",logLevel:"silent",outfile:output,
 external:["node:*"],
 plugins:[{name:"rc37-mocks",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"noop",namespace:"rc37"}));
  b.onResolve({filter:/(^|\/)lib\/supabase$/},()=>({path:"supabase",namespace:"rc37"}));
  b.onLoad({filter:/.*/,namespace:"rc37"},a=>({loader:"js",contents:a.path==="noop"?"":`
export async function verifySupabaseBearerUser(){return globalThis.__rc37.authUser}
export function adminClient(){return globalThis.__rc37.client}
`}));
 }}]});
const route=await import(pathToFileURL(output).href);
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const U=id(1),TEAM=id(2),CITY=id(3),VENDOR=id(4),ZONE=id(5),TASK=id(6);
const RPC="qf_vox_core_vendor_task_transition_atomic_candidate_v1";
const RECEIPT="a".repeat(64);
const now=()=>Math.floor(Date.now()/1000);
const jwt=()=>"h."+Buffer.from(JSON.stringify({sub:U,aal:"aal2",iat:now()-30,exp:now()+600,
 is_anonymous:false,pad:"x".repeat(120)})).toString("base64url")+".s";
function fakeClient(state){
 return {
  rpc(fn,args){
   state.rpcs.push({fn,args});
   const r=state.rpcResult??{data:[{task_id:args.p_task,task_status:args.p_action==="complete"?"done":"cancelled",replayed:false,receipt:RECEIPT}],error:null};
   return Promise.resolve(r);
  },
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
function setup(atomic="staging"){
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
 globalThis.__rc37={client:fakeClient(state),
  authUser:{id:U,app_metadata:{qf_principal:"vox_staff",vox_role:"vendor_success_agent",admin_role:null}}};
 process.env.VOX_VENDOR_CRM_TASKS_ENABLED="staging";
 process.env.VOX_VENDOR_TASK_TRANSITIONS_ENABLED="staging";
 delete process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED;
 if(atomic===null)delete process.env.VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED;
 else process.env.VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED=atomic;
 return state;
}
const complete=(o={})=>({taskId:TASK,action:"complete",result:"Documents received and verified",...o});
const post=(b=complete())=>route.POST(new Request("http://t/api/vox/v1/vendor-task-transition",{
 method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+jwt()},body:JSON.stringify(b)}));

test("atomic ON: complete uses only the RPC with verified actor/team/city/role; 201 + receipt",async()=>{
 const s=setup();
 const r=await post();const j=await r.json();
 assert.equal(r.status,201);assert.equal(j.replayed,false);assert.equal(j.status,"done");
 assert.equal(j.receipt,RECEIPT);
 assert.equal(s.rpcs.length,1);assert.equal(s.rpcs[0].fn,RPC);
 assert.deepEqual(s.rpcs[0].args,{p_actor:U,p_team:TEAM,p_city:CITY,p_role:"vendor_success_agent",
  p_task:TASK,p_action:"complete",p_result:"Documents received and verified"});
 assert.equal(s.updates.length,0);assert.equal(s.reads.includes("vendor_tasks"),false);
});
test("atomic ON: cancel passes a null result; replay is 200",async()=>{
 const s=setup();
 s.rpcResult={data:[{task_id:TASK,task_status:"cancelled",replayed:true,receipt:RECEIPT}],error:null};
 const r=await post({taskId:TASK,action:"cancel"});
 assert.equal(r.status,200);assert.equal((await r.json()).replayed,true);
 assert.equal(s.rpcs[0].args.p_action,"cancel");assert.equal(s.rpcs[0].args.p_result,null);
});
test("atomic ON: DB error codes map to 403/409/400 with no provider detail",async()=>{
 const cases=[["VOX_CORE_TASK_STAFF_NOT_CURRENT",403,"SCOPE_DENIED"],
  ["VOX_CORE_TASK_TEAM_OR_CITY_NOT_CURRENT",403,"SCOPE_DENIED"],
  ["VOX_CORE_TASK_VENDOR_GRANT_NOT_CURRENT",403,"SCOPE_DENIED"],
  ["VOX_CORE_TASK_VENDOR_CITY_DENIED",403,"VENDOR_CITY_DENIED"],
  ["VOX_VENDOR_TASK_STATE_CONFLICT",409,"TASK_STATE_CONFLICT"],
  ["VOX_CORE_TASK_TRANSITION_INPUT_DENIED",400,"INVALID_TRANSITION"],
  ["deadlock detected secret-detail",503,"VENDOR_TASK_UNAVAILABLE"]];
 for(const [msg,status,error] of cases){
  const s=setup();s.rpcResult={data:null,error:{code:"P0001",message:msg+" secret-detail"}};
  const r=await post();const t=await r.text();
  assert.equal(r.status,status,msg);assert.equal(JSON.parse(t).error,error,msg);
  assert.equal(t.includes("secret-detail"),false,msg);
 }
});
test("atomic ON: an RPC error NEVER falls back to the weak CAS",async()=>{
 for(const result of [{data:null,error:{message:"function does not exist"}},
   {data:null,error:{message:"VOX_VENDOR_TASK_STATE_CONFLICT"}}]){
  const s=setup();s.rpcResult=result;
  const r=await post();
  assert.ok([409,503].includes(r.status));
  assert.equal(s.updates.length,0);assert.equal(s.reads.includes("vendor_tasks"),false);
  assert.equal(s.tables.vendor_tasks[0].status,"open");
 }
});
test("atomic ON: malformed RPC rows fail closed",async()=>{
 const bad=[{data:[],error:null},{data:null,error:null},
  {data:[{task_id:id(99),task_status:"done",replayed:false,receipt:RECEIPT}],error:null},
  {data:[{task_id:TASK,task_status:"cancelled",replayed:false,receipt:RECEIPT}],error:null},
  {data:[{task_id:TASK,task_status:"done",replayed:"no",receipt:RECEIPT}],error:null},
  {data:[{task_id:TASK,task_status:"done",replayed:false,receipt:"short"}],error:null},
  {data:[{task_id:TASK,task_status:"done",replayed:false,receipt:RECEIPT},{task_id:TASK,task_status:"done",replayed:false,receipt:RECEIPT}],error:null}];
 for(const r of bad){
  const s=setup();s.rpcResult=r;
  const res=await post();assert.equal(res.status,503,JSON.stringify(r));
  assert.equal(s.updates.length,0);
 }
});
test("atomic gate default OFF keeps the legacy CAS path and never calls the RPC",async()=>{
 for(const v of [null,""]){
  const s=setup(v);
  assert.equal((await post()).status,201);
  assert.equal(s.rpcs.length,0);assert.equal(s.updates.length,1);
 }
});
test("atomic gate misconfiguration fails closed (no RPC, no CAS)",async()=>{
 for(const v of ["true","1","on","required","Staging"," staging"]){
  const s=setup(v);
  const r=await post();assert.equal(r.status,503,v);
  assert.equal(s.rpcs.length,0);assert.equal(s.updates.length,0);
  assert.equal(s.reads.includes("vendor_tasks"),false);
 }
});
test("atomic ON does not bypass the base gates, AAL or role checks",async()=>{
 let s=setup();delete process.env.VOX_VENDOR_TASK_TRANSITIONS_ENABLED;
 assert.equal((await post()).status,503);assert.equal(s.rpcs.length,0);
 s=setup();delete process.env.VOX_VENDOR_CRM_TASKS_ENABLED;
 assert.equal((await post()).status,503);assert.equal(s.rpcs.length,0);
 s=setup();s.tables.vox_staff_memberships_v1[0].staff_role="auditor";
 assert.equal((await post()).status,403);assert.equal(s.rpcs.length,0);
 s=setup();
 const r=await route.POST(new Request("http://t/x",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
 assert.equal(r.status,403);assert.equal(s.rpcs.length,0);
});
test("atomic ON: invalid input and oversize payload never reach the RPC",async()=>{
 for(const b of [complete({extra:1}),complete({action:"reopen"}),complete({result:"short"}),
   {taskId:TASK,action:"cancel",result:"not allowed here"},complete({vendorId:VENDOR})]){
  const s=setup();assert.equal((await post(b)).status,400);assert.equal(s.rpcs.length,0);
 }
 const s=setup();assert.equal((await post(complete({result:"y".repeat(700)}))).status,413);
 assert.equal(s.rpcs.length,0);
});
test("atomic ON: a thrown rpc fails closed with 503",async()=>{
 setup();
 globalThis.__rc37.client={rpc(){throw new Error("secret network detail")},from:()=>{throw new Error("no reads expected")}};
 const r=await post();const t=await r.text();
 assert.equal(r.status,503);assert.equal(t.includes("secret"),false);
});

const sqlPath="ops/vox/rc37-review-candidates/20261031020000_vox_rc37_core_vendor_task_transition_atomic_candidate.sql";
const sql=readFileSync(resolve(root,sqlPath),"utf8");
const code=sql.replace(/^--.*$/gm,"");
test("candidate SQL: review-only location, security invoker, locks before write, replay gated",()=>{
 assert.match(sqlPath,/^ops\/vox\/rc37-review-candidates\//);
 assert.match(sql,/security invoker set search_path=''/);
 for(const t of ["vox_staff_memberships_v1","vox_staff_teams_v1","vox_staff_object_scopes_v1","marketplace_service_zones"])
  assert.match(code,new RegExp(`public\\.${t}[\\s\\S]*?for share`));
 assert.match(code,/public\.vendor_tasks t where t\.id=p_task for update/);
 const upd=code.indexOf("update public.vendor_tasks");
 for(const marker of ["STAFF_NOT_CURRENT","TEAM_OR_CITY_NOT_CURRENT","VENDOR_GRANT_NOT_CURRENT","VENDOR_CITY_DENIED","for update"])
  assert.ok(code.indexOf(marker)<upd,marker);
 assert.match(code,/updated_by=p_actor/);
 assert.match(code,/VOX_VENDOR_TASK_STATE_CONFLICT/);
 assert.match(code,/sha256\(/);
 assert.match(code,/revoke all on function[\s\S]*from public,anon,authenticated/);
 assert.match(code,/grant execute on function[\s\S]*to service_role/);
 assert.equal(/insert into|delete from|truncate|CORE_CONVERSATION|consent|vendor_credits|create (role|table)|alter (role|table)/i.test(code),false);
 assert.match(sql,/^begin;/m);assert.match(sql,/^commit;/m);
});
test("route names exactly the reviewed RPC and the candidate defines that function",()=>{
 const src=readFileSync(resolve(root,"app/api/vox/v1/vendor-task-transition/route.ts"),"utf8");
 assert.ok(src.includes(`"${RPC}"`));
 assert.ok(sql.includes(`public.${RPC}(`));
 assert.equal((src.match(/\.rpc\(/g)??[]).length,1);
});
test("no candidate SQL is installed as a migration or pinned in a manifest",()=>{
 for(const dir of ["supabase/migrations","ops/vox/sql-candidates"]){
  let files=[];try{files=readdirSync(resolve(root,dir))}catch{}
  assert.equal(files.some(f=>f.includes("rc37_core_vendor_task_transition")),false,dir);
 }
});
