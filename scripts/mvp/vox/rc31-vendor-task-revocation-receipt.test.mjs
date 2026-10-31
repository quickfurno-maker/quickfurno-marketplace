import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
// Compiled REAL route + REAL verifiedScopedStaff + REAL vendorCrmService.
// Only Supabase Auth/PostgREST is replaced by an in-memory fake. No network.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const output=resolve(root,"test-results/rc31-vendor-task-bundle.mjs");
await build({entryPoints:[resolve(root,"app/api/vox/v1/vendor-task/route.ts")],
 bundle:true,platform:"node",target:"node20",format:"esm",logLevel:"silent",outfile:output,
 external:["node:*"],
 plugins:[{name:"rc31-mocks",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"noop",namespace:"rc31"}));
  b.onResolve({filter:/(^|\/)lib\/supabase$/},()=>({path:"supabase",namespace:"rc31"}));
  b.onLoad({filter:/.*/,namespace:"rc31"},a=>({loader:"js",contents:a.path==="noop"?"":`
export async function verifySupabaseBearerUser(){return globalThis.__rc31.authUser}
export function adminClient(){return globalThis.__rc31.client}
`}));
 }}]});
const route=await import(pathToFileURL(output).href);
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const U=id(1),TEAM=id(2),CITY=id(3),VENDOR=id(4),ZONE=id(5),NONCE=id(6);
const now=()=>Math.floor(Date.now()/1000);
const jwt="h."+Buffer.from(JSON.stringify({sub:U,aal:"aal2",iat:now()-30,exp:now()+600,
 is_anonymous:false,pad:"x".repeat(120)})).toString("base64url")+".s";

function fakeClient(state){
 return {from(table){
  const f={filters:[],mode:"read",payload:null};
  const run=()=>{
   state.reads.push(table);
   state.onRead?.(table,state.reads.filter(t=>t===table).length);
   let rows=(state.tables[table]??[]).filter(r=>f.filters.every(p=>p(r)));
   return rows;
  };
  const b={
   select(){return b},limit(){return b},
   eq(c,v){f.filters.push(r=>r[c]===v);return b},
   is(c,v){f.filters.push(r=>r[c]===v);return b},
   in(c,v){f.filters.push(r=>v.includes(r[c]));return b},
   insert(row){f.mode="insert";f.payload=row;return b},
   async maybeSingle(){return {data:run()[0]??null,error:null}},
   async single(){
    if(f.mode==="insert"){
     state.inserts.push(f.payload);
     const rows=state.tables[table]??(state.tables[table]=[]);
     if(rows.some(r=>r.idempotency_key===f.payload.idempotency_key))
      return {data:null,error:{code:"23505",message:"duplicate"}};
     const row={id:id(100+rows.length),...f.payload};rows.push(row);
     return {data:{id:row.id},error:null};
    }
    return {data:run()[0]??null,error:null};
   },
   then(res,rej){return Promise.resolve({data:run(),error:null}).then(res,rej)},
  };
  return b;
 }};
}
function setup(role="vendor_success_agent"){
 const future=new Date(Date.now()+3600000).toISOString();
 const state={reads:[],inserts:[],onRead:null,tables:{
  profiles:[{id:U,role:null,is_active:true}],
  vox_staff_memberships_v1:[{auth_user_id:U,team_id:TEAM,staff_role:role,is_active:true,revoked_at:null,expires_at:future}],
  vox_staff_teams_v1:[{id:TEAM,city_id:CITY,is_active:true}],
  cities:[{id:CITY,is_active:true}],
  vox_staff_object_scopes_v1:[{auth_user_id:U,scope_kind:"vendor",object_id:VENDOR,expires_at:future,revoked_at:null}],
  vendors:[{id:VENDOR,service_zone_id:ZONE}],
  marketplace_service_zones:[{id:ZONE,city_id:CITY,is_active:true}],
  vendor_crm_tasks:[],
 }};
 globalThis.__rc31={state,client:fakeClient(state),
  authUser:{id:U,app_metadata:{qf_principal:"vox_staff",vox_role:role,admin_role:null}}};
 process.env.VOX_VENDOR_CRM_TASKS_ENABLED="staging";
 delete process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED;
 return state;
}
const STABLE_DUE=new Date(Date.now()+86400000).toISOString();
const body=(over={})=>({vendorId:VENDOR,nonce:NONCE,taskType:"general",title:"Follow up on documents",
 priority:"medium",dueAt:STABLE_DUE,...over});
const post=(b=body())=>route.POST(new Request("http://t/api/vox/v1/vendor-task",{method:"POST",
 headers:{"content-type":"application/json",authorization:"Bearer "+jwt},body:JSON.stringify(b)}));
const taskTable=s=>s.tables.vendor_crm_tasks??s.tables[Object.keys(s.tables).find(k=>/task/.test(k)&&k!=="vendor_crm_tasks")];

test("authorized request creates exactly one task: 201 created:true",async()=>{
 const s=setup();
 const r=await post();const j=await r.json();
 assert.equal(r.status,201);assert.equal(j.ok,true);assert.equal(j.created,true);
 assert.equal(s.inserts.length,1);assert.equal(s.inserts[0].created_by,U);
 assert.equal(s.inserts[0].vendor_id,VENDOR);
});
test("exact replay returns the same task with 200 created:false and no second insert",async()=>{
 const s=setup();
 const first=await (await post()).json();
 const r=await post();const j=await r.json();
 assert.equal(r.status,200);assert.equal(j.created,false);assert.equal(j.taskId,first.taskId);
 assert.equal(s.inserts.length,1);
});
test("same nonce with different details is a 409 conflict, never a new row",async()=>{
 const s=setup();
 await post();
 const r=await post(body({title:"A completely different title"}));
 assert.equal(r.status,409);assert.equal((await r.json()).error,"IDEMPOTENCY_CONFLICT");
 assert.equal(s.inserts.length,1);
});
test("vendor grant revoked after initial auth but before CRM write: denied, no insert",async()=>{
 const s=setup();
 // Fire revocation on the vendor-zone lookup (after initial auth, before write).
 s.onRead=(t)=>{if(t==="marketplace_service_zones")
  s.tables.vox_staff_object_scopes_v1[0].revoked_at=new Date().toISOString();};
 const r=await post();
 assert.equal(r.status,403);assert.equal((await r.json()).error,"SCOPE_DENIED");
 assert.equal(s.inserts.length,0);
});
test("membership revoked between initial auth and CRM write: denied, no insert",async()=>{
 const s=setup();
 s.onRead=(t)=>{if(t==="marketplace_service_zones")
  s.tables.vox_staff_memberships_v1[0].is_active=false;};
 const r=await post();
 assert.equal(r.status,403);assert.equal(s.inserts.length,0);
});
test("city disabled or team moved to another city before CRM write: denied, no insert",async()=>{
 for(const mutate of [s=>{s.tables.cities[0].is_active=false},
   s=>{s.tables.vox_staff_teams_v1[0].city_id=id(9);s.tables.cities.push({id:id(9),is_active:true})}]){
  const s=setup();
  s.onRead=(t)=>{if(t==="marketplace_service_zones")mutate(s);};
  const r=await post();
  assert.equal(r.status,403);assert.equal(s.inserts.length,0);
 }
});
test("revoked actor cannot read back an existing task through an idempotent replay",async()=>{
 const s=setup();
 await post();
 s.tables.vox_staff_object_scopes_v1[0].revoked_at=new Date().toISOString();
 const r=await post();
 assert.ok([400,403].includes(r.status),"revocation must deny, not replay");
 assert.equal(JSON.stringify(await r.json()).includes("taskId"),false);
 assert.equal(s.inserts.length,1);
});
test("revoked before initial auth, unassigned vendor, and wrong-city vendor are all denied",async()=>{
 let s=setup();s.tables.vox_staff_object_scopes_v1[0].revoked_at=new Date().toISOString();
 assert.equal((await post()).status,400);assert.equal(s.inserts.length,0);
 s=setup();s.tables.marketplace_service_zones[0].city_id=id(9);
 assert.equal((await post()).status,403);assert.equal(s.inserts.length,0);
 s=setup("team_leader");
 assert.equal((await post()).status,403);assert.equal(s.inserts.length,0);
});
test("feature gate default-off performs no reads or writes",async()=>{
 const s=setup();delete process.env.VOX_VENDOR_CRM_TASKS_ENABLED;
 const r=await post();
 assert.equal(r.status,503);assert.equal(s.reads.length,0);assert.equal(s.inserts.length,0);
});
