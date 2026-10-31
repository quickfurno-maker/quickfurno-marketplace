import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdirSync,readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
// Compiled REAL vendorCrmService; only the Supabase client is an in-memory fake.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const output=resolve(root,"test-results/rc32-vendor-crm-service-bundle.mjs");
await build({entryPoints:[resolve(root,"services/vendorCrmService.ts")],
 bundle:true,platform:"node",target:"node20",format:"esm",logLevel:"silent",outfile:output,
 external:["node:*"],
 plugins:[{name:"rc32-mocks",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"noop",namespace:"rc32"}));
  b.onResolve({filter:/(^|\/)lib\/supabase$/},()=>({path:"supabase",namespace:"rc32"}));
  b.onLoad({filter:/.*/,namespace:"rc32"},a=>({loader:"js",contents:a.path==="noop"?"":
   "export function adminClient(){return globalThis.__rc32.client}"}));
 }}]});
const svc=await import(pathToFileURL(output).href);
const V="00000000-0000-4000-8000-000000000004";
function fake(state){
 return {from(table){
  const b={};
  for(const m of ["select","eq","in","is","lt","or","contains","ilike","order","range"])
   b[m]=()=>b;
  b.then=(res,rej)=>{
   const error=state.fail?.[table]?{code:"XX000",message:"secret provider detail"}:null;
   const data=error?null:(state.tables[table]??[]);
   return Promise.resolve({data,error,count:data?.length??0}).then(res,rej);
  };
  return b;
 }};
}
const setup=(fail={})=>{
 const state={fail,tables:{
  vendors:[{id:V,business_name:"Acme",created_at:"2026-01-01"}],
  vendor_tasks:[{vendor_id:V,status:"open",due_at:null}],
 }};
 globalThis.__rc32={client:fake(state)};return state;
};

test("directory projection counts open tasks from the batch read",async()=>{
 setup();
 const r=await svc.listVendorCrmDirectory({});
 assert.equal(r.rows[0].open_task_count,1);
});
for(const table of ["vendor_tasks","vendor_crm_profiles","vendor_tag_assignments","vendor_contacts"]){
 test(`directory fails closed when ${table} batch read errors (no silent zero counts)`,async()=>{
  setup({[table]:true});
  await assert.rejects(()=>svc.listVendorCrmDirectory({}),e=>{
   assert.equal(e.name,"VendorCrmReadError");
   assert.equal(e.code,"XX000");
   assert.equal(/secret provider detail/.test(e.message),false);
   return true;
  });
 });
}
test("task-state filter failure does not return an empty directory as success",async()=>{
 setup({vendor_tasks:true});
 await assert.rejects(()=>svc.listVendorCrmDirectory({task_state:"overdue",taskState:"overdue"}));
});

// Static contract of the uninstalled atomic writer (executed proof: the PG17 .ps1).
const sql=readFileSync(resolve(root,"ops/vox/sql-candidates/20261031010000_vox_rc32_core_vendor_task_atomic_candidate.sql"),"utf8");
test("atomic writer SQL locks authority rows and gates replay",()=>{
 assert.match(sql,/security invoker set search_path=''/);
 for(const t of ["vox_staff_memberships_v1","vox_staff_teams_v1","vox_staff_object_scopes_v1","marketplace_service_zones"])
  assert.match(sql,new RegExp(`public\\.${t}[\\s\\S]*?for share`));
 assert.match(sql,/on conflict \(idempotency_key\) where idempotency_key is not null do nothing/);
 assert.ok(sql.indexOf("VENDOR_GRANT_NOT_CURRENT")<sql.indexOf("insert into public.vendor_tasks"));
 assert.match(sql,/VOX_VENDOR_TASK_IDEMPOTENCY_CONFLICT/);
 assert.match(sql,/revoke all on function[\s\S]*from public,anon,authenticated/);
 assert.match(sql,/to service_role/);
 const code=sql.replace(/^--.*$/gm,"");
 assert.equal(/CORE_CONVERSATION|consent|vendor_credits|insert into public\.vendors/i.test(code),false);
});
