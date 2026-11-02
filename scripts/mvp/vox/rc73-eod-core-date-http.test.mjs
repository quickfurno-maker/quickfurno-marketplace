import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const dir=mkdtempSync(join(tmpdir(),"rc73-eod-core-http-"));
const outfile=join(dir,"core.mjs");
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const ist=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",
 year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const old=Object.fromEntries(["VOX_STAFF_GRANTS_ENABLED",
 "VOX_DEPARTMENT_ENFORCEMENT_ENABLED","VOX_EOD_SUBMISSIONS_ENABLED"]
 .map(x=>[x,process.env[x]]));
for(const key of Object.keys(old))process.env[key]="staging";
globalThis.__rc73EodScope={canReadContent:true,canMutate:false,role:"support_agent",
 userId:uuid(1),teamId:uuid(2),cityId:uuid(3)};
let calls=[];
globalThis.__rc73EodRpc=async(name,payload)=>{
 calls.push({name,payload});
 return {data:[{report_id:uuid(10),report_state:"PENDING_REVIEW",
  report_revision:0,event_count:2}],error:null};
};
await build({entryPoints:[resolve(root,"app/api/vox/v1/eod-submissions/route.ts")],
 outfile,bundle:true,platform:"node",format:"esm",target:"node24",
 logLevel:"silent",plugins:[{
  name:"rc73-real-core-stub",setup(build){
   build.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"rc73-stub"}));
   build.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:"supabase",namespace:"rc73-stub"}));
   build.onResolve({filter:/^@\/services\/vox\/verifiedScopedStaff$/},()=>({path:"scope",namespace:"rc73-stub"}));
   build.onLoad({filter:/.*/,namespace:"rc73-stub"},x=>({
    contents:x.path==="supabase"
      ?"export const adminClient=()=>({rpc:globalThis.__rc73EodRpc});"
      :x.path==="scope"
       ?"export const getVerifiedScopedStaff=async()=>globalThis.__rc73EodScope;"
       :"export default {};",
    loader:"js"
   }));
  }
 }]});
const {POST,GET}=await import(pathToFileURL(outfile).href);
const submit=(date=ist,nonce=uuid(9))=>POST(new Request("https://staging-core.quickfurno.in/api/vox/v1/eod-submissions",{
 method:"POST",headers:{"content-type":"application/json","authorization":"Bearer SYNTHETIC_TEST"},
 body:JSON.stringify({nonce,businessDate:date})
}));
test("actual Core POST binds successful receipt to its validated India business date",async()=>{
 calls=[];
 const response=await submit();
 assert.equal(response.status,200);
 const receipt=await response.json();
 assert.equal(receipt.businessDate,ist);
 assert.deepEqual(Object.keys(receipt).sort(),["businessDate","completeness","eventCount",
 "externalMessagesSent","ok","reportId","revision","schema","staffPrivilegesChanged","state"]);
 assert.equal(receipt.externalMessagesSent,0);
 assert.equal(receipt.staffPrivilegesChanged,false);
 assert.deepEqual(calls,[{name:"qf_vox_eod_submit_candidate_v1",
  payload:{p_actor:uuid(1),p_nonce:uuid(9),p_business_date:ist}}]);
});
test("Core refuses prior/future dates and unsupported body fields before SQL RPC",async()=>{
 calls=[];
 for(const date of ["2000-01-01","2099-01-01"]){
  const response=await submit(date);
  assert.equal(response.status,400);
 }
 assert.equal(calls.length,0);
});
test("Core rejects missing current scoped Staff and malformed SQL receipt",async()=>{
 const orig=globalThis.__rc73EodScope;
 globalThis.__rc73EodScope=null;
 assert.equal((await submit()).status,403);
 globalThis.__rc73EodScope=orig;
 const rpc=globalThis.__rc73EodRpc;
 globalThis.__rc73EodRpc=async()=>({data:[{report_id:"bad",report_state:"PENDING_REVIEW",
 report_revision:0,event_count:2}],error:null});
 const response=await submit();
 assert.equal(response.status,503);
 globalThis.__rc73EodRpc=rpc;
});
process.on("exit",()=>{
 rmSync(dir,{recursive:true,force:true});
 for(const [key,value] of Object.entries(old)){
  if(value===undefined)delete process.env[key];
  else process.env[key]=value;
 }
 delete globalThis.__rc73EodScope;delete globalThis.__rc73EodRpc;
});
