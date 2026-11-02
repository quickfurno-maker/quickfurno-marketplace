import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdirSync,readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
// RC38 Core closure: compiled REAL route + REAL verifiedScopedStaff + REAL contract.
// Supabase and bearer verification are traps/fakes that record every touch.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const routePath="app/api/vox/v1/vendor-task-transition/route.ts";
const output=resolve(root,"test-results/rc38-vendor-task-transition-bundle.mjs");
await build({entryPoints:[resolve(root,routePath)],
 bundle:true,platform:"node",target:"node20",format:"esm",logLevel:"silent",outfile:output,
 external:["node:*"],
 plugins:[{name:"rc38-mocks",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"noop",namespace:"rc38"}));
  b.onResolve({filter:/(^|\/)lib\/supabase$/},()=>({path:"supabase",namespace:"rc38"}));
  b.onLoad({filter:/.*/,namespace:"rc38"},a=>({loader:"js",contents:a.path==="noop"?"":`
export async function verifySupabaseBearerUser(){globalThis.__rc38.touch("auth");return globalThis.__rc38.authUser}
export function adminClient(){globalThis.__rc38.touch("adminClient");return globalThis.__rc38.client}
`}));
 }}]});
const route=await import(pathToFileURL(output).href);
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const U=id(1),TEAM=id(2),CITY=id(3),VENDOR=id(4),TASK=id(6);
const RPC="qf_vox_core_vendor_task_transition_atomic_candidate_v1";
const RECEIPT="c".repeat(64);
const now=()=>Math.floor(Date.now()/1000);
const jwt=(aal="aal2")=>"h."+Buffer.from(JSON.stringify({sub:U,aal,iat:now()-30,exp:now()+600,
 is_anonymous:false,pad:"x".repeat(120)})).toString("base64url")+".s";
const FLAGS=["VOX_VENDOR_CRM_TASKS_ENABLED","VOX_VENDOR_TASK_TRANSITIONS_ENABLED","VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED"];
function setup(flags=["staging","staging","staging"]){
 const future=new Date(Date.now()+3600000).toISOString();
 const st={touches:[],tableReads:[],rpcs:[],updates:[],rpcResult:null,tables:{
  profiles:[{id:U,role:null,is_active:true}],
  vox_staff_memberships_v1:[{auth_user_id:U,team_id:TEAM,staff_role:"vendor_success_agent",is_active:true,revoked_at:null,expires_at:future}],
  vox_staff_teams_v1:[{id:TEAM,city_id:CITY,is_active:true}],
  cities:[{id:CITY,is_active:true}],
  vox_staff_object_scopes_v1:[{auth_user_id:U,scope_kind:"vendor",object_id:VENDOR,expires_at:future,revoked_at:null}],
 }};
 st.touch=k=>st.touches.push(k);
 st.client={
  rpc(fn,args){st.rpcs.push({fn,args});
   return Promise.resolve(st.rpcResult??{data:[{task_id:args.p_task,
    task_status:args.p_action==="complete"?"done":"cancelled",replayed:false,receipt:RECEIPT}],error:null});},
  from(table){
   st.tableReads.push(table);
   const f=[];
   const rows=()=>(st.tables[table]??[]).filter(r=>f.every(p=>p(r)));
   const b={select(){return b},limit(){return b},
    eq(c,v){f.push(r=>r[c]===v);return b},is(c,v){f.push(r=>r[c]===v);return b},
    in(c,v){f.push(r=>v.includes(r[c]));return b},
    update(){st.updates.push(table);throw new Error("direct write forbidden")},
    insert(){st.updates.push(table);throw new Error("direct write forbidden")},
    upsert(){st.updates.push(table);throw new Error("direct write forbidden")},
    delete(){st.updates.push(table);throw new Error("direct write forbidden")},
    async maybeSingle(){return {data:rows()[0]??null,error:null}},
    then(res,rej){return Promise.resolve({data:rows(),error:null}).then(res,rej)}};
   return b;
  }};
 globalThis.__rc38={touch:st.touch,client:st.client,
  authUser:{id:U,app_metadata:{qf_principal:"vox_staff",vox_role:"vendor_success_agent",admin_role:null}}};
 FLAGS.forEach((k,i)=>{if(flags[i]===undefined)delete process.env[k];else process.env[k]=flags[i]});
 delete process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED;
 return st;
}
const complete=(o={})=>({taskId:TASK,action:"complete",result:"Documents received and verified",...o});
const post=(b=complete(),token=jwt())=>route.POST(new Request("http://t/api/vox/v1/vendor-task-transition",{
 method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify(b)}));

// Request double that records every header/body/auth-surface access.
function spyRequest(){
 const log=[];
 const headers={get(k){log.push("header:"+k);return null}};
 return {log,req:{headers,text(){log.push("body");return Promise.resolve("{}")},
  json(){log.push("body");return Promise.resolve({})}}};
}

test("all three exact 'staging' flags are required: every other combination 503s before header/Auth/body/DB access",async()=>{
 const vals=[undefined,"","staging","true","1","on","Staging"," staging","staging "];
 let checked=0;
 for(const a of vals)for(const b of vals)for(const c of vals){
  if(a==="staging"&&b==="staging"&&c==="staging")continue;
  const st=setup([a,b,c]);
  const spy=spyRequest();
  const r=await route.POST(spy.req);
  assert.equal(r.status,503,JSON.stringify([a,b,c]));
  assert.equal((await r.json()).error,"VENDOR_TASKS_DISABLED");
  assert.deepEqual(spy.log,[],"request touched before gates: "+JSON.stringify([a,b,c]));
  assert.deepEqual(st.touches,[]);assert.equal(st.rpcs.length,0);
  assert.equal(st.tableReads.length,0);assert.equal(st.updates.length,0);
  checked++;
 }
 assert.equal(checked,9**3-1);
});
test("the absent atomic flag - the old weak-CAS trigger - is now a hard 503 with the task untouched",async()=>{
 const st=setup(["staging","staging",undefined]);
 const r=await post();
 assert.equal(r.status,503);assert.equal(st.touches.length,0);
 assert.equal(st.rpcs.length,0);assert.equal(st.updates.length,0);assert.equal(st.tableReads.length,0);
});
test("positive: all gates on, AAL2 staff completes via the RPC with verified scope; 201 + receipt",async()=>{
 const st=setup();
 const r=await post();const j=await r.json();
 assert.equal(r.status,201);assert.deepEqual(j,{ok:true,taskId:TASK,status:"done",replayed:false,
  receipt:RECEIPT,authority:"quickfurno-core-vendor-crm",scope:"ASSIGNED_VENDOR_ONLY"});
 assert.equal(st.rpcs.length,1);assert.equal(st.rpcs[0].fn,RPC);
 assert.deepEqual(st.rpcs[0].args,{p_actor:U,p_team:TEAM,p_city:CITY,p_role:"vendor_success_agent",
  p_task:TASK,p_action:"complete",p_result:"Documents received and verified"});
 assert.equal(st.updates.length,0);
 for(const t of ["vendor_tasks","vendors","marketplace_service_zones"])assert.equal(st.tableReads.includes(t),false,t);
});
test("positive: operations_manager cancel replays as 200 with null result",async()=>{
 const st=setup();
 st.tables.vox_staff_memberships_v1[0].staff_role="operations_manager";
 globalThis.__rc38.authUser.app_metadata.vox_role="operations_manager";
 st.rpcResult={data:[{task_id:TASK,task_status:"cancelled",replayed:true,receipt:RECEIPT}],error:null};
 const r=await post({taskId:TASK,action:"cancel"});
 assert.equal(r.status,200);assert.equal((await r.json()).replayed,true);
 assert.equal(st.rpcs[0].args.p_role,"operations_manager");assert.equal(st.rpcs[0].args.p_result,null);
});
test("negative: AAL1, missing bearer, wrong role and out-of-contract input never reach the RPC",async()=>{
 let st=setup();assert.equal((await post(complete(),jwt("aal1"))).status,403);assert.equal(st.rpcs.length,0);
 st=setup();
 const nb=await route.POST(new Request("http://t/x",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
 assert.equal(nb.status,403);assert.equal(st.rpcs.length,0);
 st=setup();st.tables.vox_staff_memberships_v1[0].staff_role="auditor";
 assert.equal((await post()).status,403);assert.equal(st.rpcs.length,0);
 for(const b of [complete({extra:1}),complete({action:"reopen"}),complete({vendorId:VENDOR}),complete({status:"done"})]){
  st=setup();assert.equal((await post(b)).status,400);assert.equal(st.rpcs.length,0);
 }
 st=setup();assert.equal((await post(complete({result:"y".repeat(700)}))).status,413);assert.equal(st.rpcs.length,0);
});
test("negative: every RPC failure/malformed result fails closed and never falls back to a table write",async()=>{
 const cases=[
  [{data:null,error:{message:"Could not find the function public."+RPC}},503],
  [{data:null,error:{message:"permission denied for function"}},503],
  [{data:null,error:{message:"VOX_VENDOR_TASK_STATE_CONFLICT"}},409],
  [{data:null,error:{message:"VOX_CORE_TASK_STAFF_NOT_CURRENT"}},403],
  [{data:[],error:null},503],[{data:null,error:null},503],
  [{data:[{task_id:id(99),task_status:"done",replayed:false,receipt:RECEIPT}],error:null},503],
  [{data:[{task_id:TASK,task_status:"done",replayed:false,receipt:"nothex"}],error:null},503]];
 for(const [res,status] of cases){
  const st=setup();st.rpcResult=res;
  const r=await post();assert.equal(r.status,status,JSON.stringify(res));
  assert.equal(st.rpcs.length,1,"exactly one RPC attempt, no retry via another path");
  assert.equal(st.updates.length,0);
  for(const t of ["vendor_tasks","vendors","marketplace_service_zones"])assert.equal(st.tableReads.includes(t),false,t);
 }
 const st=setup();st.client.rpc=()=>{throw new Error("secret net")};
 const r=await post();assert.equal(r.status,503);assert.equal((await r.text()).includes("secret"),false);
 assert.equal(st.updates.length,0);
});
test("source: no fallback write path remains; flag read is a strict literal; gate precedes Auth and body",()=>{
 const src=readFileSync(resolve(root,routePath),"utf8");
 const code=src.replace(/^\s*\/\/.*$/gm,"");
 assert.equal(/\.from\(|\.update\(|\.insert\(|\.upsert\(|\.delete\(|\.in\(|\.eq\(/.test(code),false);
 assert.equal(/vendor_tasks|"vendors"|marketplace_service_zones|SELECT|ACTIVE/.test(code),false);
 assert.equal(/ATOMIC_RPC_ENABLED\s*(!==|===)\s*(undefined|"")|atomic\s*!==/.test(code),false);
 assert.equal((code.match(/VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED==="staging"/g)??[]).length,1);
 assert.equal((code.match(/VOX_VENDOR_CRM_TASKS_ENABLED==="staging"/g)??[]).length,1);
 assert.equal((code.match(/VOX_VENDOR_TASK_TRANSITIONS_ENABLED==="staging"/g)??[]).length,1);
 const gate=code.indexOf("if(!gatesOn())");
 assert.ok(gate>0);
 for(const m of ["request.headers","getVerifiedScopedStaff(","request.text(","adminClient()"])
  assert.ok(code.indexOf(m,code.indexOf("export async function POST"))>gate,m);
 assert.equal((code.match(/\.rpc\(/g)??[]).length,1);
 assert.match(code,/rpc\(ATOMIC_RPC,/);
});
test("RC38 installs no SQL and turns on no flag: no migration/manifest, no workflow or env file enables flags",()=>{
 for(const dir of ["supabase/migrations","ops/vox/sql-candidates"]){
  let files=[];try{files=readdirSync(resolve(root,dir))}catch{}
  assert.equal(files.some(f=>/rc3[78].*vendor_task_transition|vendor_task_transition.*atomic/.test(f)),false,dir);
 }
 for(const f of [".env.example",".env.local.example"]){
  let t="";try{t=readFileSync(resolve(root,f),"utf8")}catch{}
  assert.equal(/^\s*VOX_VENDOR_TASK_(ATOMIC_RPC|TRANSITIONS)_ENABLED\s*=\s*staging/m.test(t),false,f);
 }
});
