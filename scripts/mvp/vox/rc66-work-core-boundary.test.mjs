import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const src=resolve(root,"app/api/vox/v1/work-transitions/route.ts");
const dir=mkdtempSync(join(tmpdir(),"rc66-work-route-"));
const out=join(dir,"route.mjs");
await build({entryPoints:[src],outfile:out,bundle:true,platform:"node",
 format:"esm",target:"node24",logLevel:"silent",plugins:[{
 name:"local-work-boundary",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"server",namespace:"stub"}));
  b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:"db",namespace:"stub"}));
  b.onResolve({filter:/^@\/services\/vox\/verifiedScopedStaff$/},()=>({path:"staff",namespace:"stub"}));
  b.onLoad({filter:/.*/,namespace:"stub"},a=>({loader:"js",contents:
   a.path==="db"?"export const adminClient=()=>({rpc:(...a)=>globalThis.__rc66Core.rpc(...a)});":
   a.path==="staff"?"export const getVerifiedScopedStaff=(auth)=>globalThis.__rc66Core.verify(auth);":""}));
  b.onLoad({filter:/work-transitions[\\/]route\.ts$/},a=>({loader:"ts",
   contents:readFileSync(a.path,"utf8")
    .replace("STAFF_PREFLIGHT_TIMEOUT_MS=1500","STAFF_PREFLIGHT_TIMEOUT_MS=25")
    .replace("WORK_RPC_TIMEOUT_MS=4000","WORK_RPC_TIMEOUT_MS=25")}));
 }
}]});
const api=await import(pathToFileURL(out).href);
const ID="11111111-1111-4111-8111-111111111111";
const NONCE="22222222-2222-4222-8222-222222222222";
const body={action:"CLAIM",itemId:ID,nonce:NONCE,expectedRevision:1,reason:""};
const keys=["VOX_STAFF_READ_ENABLED","VOX_STAFF_GRANTS_ENABLED",
 "VOX_DEPARTMENT_ENFORCEMENT_ENABLED","VOX_WORK_ACTIONS_ENABLED"];
function enable(){for(const k of keys)process.env[k]="staging";}
function request(data=body){return new Request("https://local.test/api/vox/v1/work-transitions",{
 method:"POST",headers:{authorization:"Bearer local", "content-type":"application/json"},
 body:JSON.stringify(data)})}
function world(){
 let sql=0,auth=0;
 globalThis.__rc66Core={verify:async()=>{auth++;return {userId:ID,role:"operations_manager",
  canMutate:false,verifiedDepartments:["service_support"]}},
  rpc:async()=>{sql++;return {data:[{work_item_id:ID,new_state:"ASSIGNED",new_revision:2}],error:null}}};
 return {get sql(){return sql},get auth(){return auth}};
}
test("feature flags remain fail-closed before any Auth or SQL",async()=>{
 for(const k of keys)delete process.env[k];
 const w=world(),r=await api.POST(request());assert.equal(r.status,503);
 assert.equal(w.auth,0);assert.equal(w.sql,0);
});
test("hung or rejected Staff identity is bounded and cannot reach mutation",async()=>{
 enable();let w=world();globalThis.__rc66Core.verify=async()=>new Promise(()=>{});
 let r=await api.POST(request());assert.equal(r.status,503);
 assert.equal((await r.json()).error,"WORK_STAFF_AUTH_TIMEOUT");assert.equal(w.sql,0);
 w=world();globalThis.__rc66Core.verify=async()=>null;
 r=await api.POST(request());assert.equal(r.status,403);assert.equal(w.sql,0);
});
test("valid neutral Staff obtains only the exact canonical work state and no external send",async()=>{
 enable();const w=world(),r=await api.POST(request());
 assert.equal(r.status,200);const v=await r.json();
 assert.equal(v.workItemId,ID);assert.equal(v.newState,"ASSIGNED");
 assert.equal(v.providerMessagesSent,0);assert.equal(v.affectsVendorLeadMatching,false);
 assert.equal(w.sql,1);assert.equal(w.auth,2);
});
test("hung, thrown, error, missing and forged SQL receipts remain UNKNOWN",async()=>{
 enable();
 for(const mode of ["hang","throw","error","empty","forged","wrong-state"]){
  const w=world();
  globalThis.__rc66Core.rpc=async()=>{
   if(mode==="hang")return new Promise(()=>{});
   if(mode==="throw")throw Error("private database error");
   if(mode==="error")return {data:null,error:{message:"private"}};
   if(mode==="empty")return {data:[],error:null};
   if(mode==="forged")return {data:[{work_item_id:ID,new_state:"ASSIGNED",new_revision:9}],error:null};
   return {data:[{work_item_id:ID,new_state:"DONE",new_revision:2}],error:null};
  };
  const r=await api.POST(request());assert.equal(r.status,503,mode);
  const v=await r.json();
  assert.equal(v.error,"WORK_TRANSITION_OUTCOME_UNKNOWN",mode);
  assert.equal(v.committed,null);assert.equal(v.retrySameNonceOnly,true);
  assert.equal(JSON.stringify(v).includes("private"),false);
  assert.equal(w.auth,1);
 }
});
test("post-commit Staff AAL2 and scope are reverified before reporting success",async()=>{
 enable();
 for(const mode of ["revoked","role-change","team-change","scope-change","hang","throw"]){
  const w=world();let round=0;
  globalThis.__rc66Core.verify=async()=>{
   round++;
   if(round===1)return {userId:ID,role:"operations_manager",teamId:ID,
    cityId:ID,canMutate:false,canReadContent:true,vendorIds:[ID]};
   if(mode==="hang")return new Promise(()=>{});
   if(mode==="throw")throw Error("private staff record");
   if(mode==="revoked")return null;
   const out={userId:ID,role:"operations_manager",teamId:ID,cityId:ID,
    canMutate:false,canReadContent:true,vendorIds:[ID]};
   if(mode==="role-change")out.role="support_agent";
   if(mode==="team-change")out.teamId=NONCE;
   if(mode==="scope-change")out.vendorIds=[];
   return out;
  };
  const response=await api.POST(request());
  assert.equal(response.status,503,mode);
  const reply=await response.json();
  assert.equal(reply.error,"WORK_TRANSITION_OUTCOME_UNKNOWN",mode);
  assert.equal(reply.committed,null);
  assert.equal(reply.retrySameNonceOnly,true);
  assert.equal(JSON.stringify(reply).includes("private"),false);
  assert.equal(round,2);assert.equal(w.sql,1);
 }
});

test("forged original action, revision and nonce rejected before Auth",async()=>{
 enable();const w=world();
 for(const payload of [{...body,actorId:ID},{...body,expectedRevision:-1},
   {...body,nonce:"bad"},{...body,reason:"untrimmed "}])
  assert.equal((await api.POST(request(payload))).status,400);
 assert.equal(w.auth,0);assert.equal(w.sql,0);
});
process.on("exit",()=>rmSync(dir,{recursive:true,force:true}));
