import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {dirname,resolve,join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const dir=mkdtempSync(join(tmpdir(),"rc80-work-"));
const out=join(dir,"route.mjs");
await build({entryPoints:[resolve(root,"app/api/vox/v1/work-transitions/route.ts")],
 outfile:out,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"rc80-core-stubs",setup(b){
  b.onResolve({filter:/^(server-only|@\/lib\/supabase|@\/services\/vox\/verifiedScopedStaff)$/},
   a=>({path:a.path,namespace:"fake"}));
  b.onLoad({filter:/.*/,namespace:"fake"},a=>({loader:"js",contents:
   a.path==="server-only"?"":a.path==="@/lib/supabase"?
    'export const adminClient=()=>({rpc:async(name,params)=>{ const s=globalThis.__rc80Work; s.dbCalls++;s.rpc={name,params};return {data:[{work_item_id:s.itemId,new_state:"ASSIGNED",new_revision:1}],error:null}; }});':
    'export const getVerifiedScopedStaff=async()=>{const s=globalThis.__rc80Work;return s.scopes[s.authCalls++]??null;};'
  }));
 }}]});
const api=await import(pathToFileURL(out).href);
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
for(const flag of ["VOX_STAFF_READ_ENABLED","VOX_STAFF_GRANTS_ENABLED",
 "VOX_DEPARTMENT_ENFORCEMENT_ENABLED","VOX_WORK_ACTIONS_ENABLED"])
 process.env[flag]="staging";
const scope=(departments=["service_support"])=>({
 userId:uuid(1),teamId:uuid(2),cityId:uuid(3),role:"support_agent",
 canMutate:false,canReadContent:true,
 prospectIds:[],vendorIds:[uuid(5)],supportThreadIds:[],conversationIds:[],
 verifiedDepartments:departments
});
const post=rev=>new Request("https://staging-core.quickfurno.in/api/vox/v1/work-transitions",{
 method:"POST",headers:{"content-type":"application/json",authorization:"Bearer TEST_ONLY"},
 body:JSON.stringify({action:"CLAIM",itemId:uuid(4),expectedRevision:rev,nonce:uuid(6),reason:""})
});
const reset=(a,b)=>{globalThis.__rc80Work={scopes:[a,b],itemId:uuid(4),authCalls:0,dbCalls:0};};

test("same verified Staff actor, department pack and object grants confirm exact original nonce",async()=>{
 reset(scope(),scope());
 const r=await api.POST(post(0));
 assert.equal(r.status,200);
 const b=await r.json();
 assert.equal(b.nonce,uuid(6));assert.equal(b.revision,1);
 assert.equal(b.providerMessagesSent,0);assert.equal(globalThis.__rc80Work.dbCalls,1);
 assert.equal(globalThis.__rc80Work.authCalls,2);
});
test("post-write department substitution with identical object IDs is UNKNOWN",async()=>{
 reset(scope(["service_support"]),scope(["vendor_success"]));
 const r=await api.POST(post(0)),b=await r.json();
 assert.equal(r.status,503);assert.equal(b.error,"WORK_TRANSITION_OUTCOME_UNKNOWN");
 assert.equal(b.retrySameNonceOnly,true);assert.equal(b.committed,null);
 assert.equal(globalThis.__rc80Work.dbCalls,1);assert.equal(globalThis.__rc80Work.authCalls,2);
});
test("missing verified department proof after mutation can never certify success",async()=>{
 reset(scope(),{...scope(),verifiedDepartments:undefined});
 const r=await api.POST(post(0));
 assert.equal(r.status,503);assert.equal(globalThis.__rc80Work.dbCalls,1);
});
test("post-write role revocation also reports uncertain original command",async()=>{
 reset(scope(),{...scope(),role:"auditor"});
 const r=await api.POST(post(0));
 assert.equal(r.status,503);assert.equal(globalThis.__rc80Work.dbCalls,1);
});
test("int4 revision overflow is denied before Auth or SQL",async()=>{
 reset(scope(),scope());
 const r=await api.POST(post(2147483647));
 assert.equal(r.status,400);assert.equal(globalThis.__rc80Work.authCalls,0);
 assert.equal(globalThis.__rc80Work.dbCalls,0);
});
process.on("exit",()=>rmSync(dir,{recursive:true,force:true}));