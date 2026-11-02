import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const source=resolve(root,"app/api/vox/v1/official-eod-publish/route.ts");
const temp=mkdtempSync(join(tmpdir(),"rc64-eod-"));
async function compile(simulated){
 const out=join(temp,simulated?"test-installed.mjs":"production.mjs");
 await build({entryPoints:[source],outfile:out,bundle:true,platform:"node",
  format:"esm",target:"node24",logLevel:"silent",plugins:[{
  name:"eod-test-stubs",setup(b){
   b.onResolve({filter:/^server-only$/},()=>({path:"only",namespace:"fake"}));
   b.onResolve({filter:/^@\/services\/vox\/verifiedStaffBearer$/},()=>({path:"auth",namespace:"fake"}));
   b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:"db",namespace:"fake"}));
   b.onLoad({filter:/.*/,namespace:"fake"},a=>({loader:"js",contents:
    a.path==="auth"?"export const verifyVoxOwnerBearer=(x)=>globalThis.__rc64Eod.verify(x);":
    a.path==="db"?"export const adminClient=()=>({rpc:(...a)=>globalThis.__rc64Eod.rpc(...a)});":""}));
   b.onLoad({filter:/official-eod-publish[\\/]route\.ts$/},a=>{
    let contents=readFileSync(a.path,"utf8");
    if(simulated)contents=contents
     .replace("VERIFIED_APPROVAL_WRITER_INSTALLED=false as boolean",
      "VERIFIED_APPROVAL_WRITER_INSTALLED=true as boolean")
     .replace("EOD_OWNER_AUTH_TIMEOUT_MS=1500","EOD_OWNER_AUTH_TIMEOUT_MS=25")
     .replace("EOD_PUBLISH_RPC_TIMEOUT_MS=4000","EOD_PUBLISH_RPC_TIMEOUT_MS=25");
    return {loader:"ts",contents};
   });
  }}]});
 return import(pathToFileURL(out).href);
}
const prod=await compile(false),sim=await compile(true);
const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222";
const N="33333333-3333-4333-8333-333333333333",H="a".repeat(64);
const flags=["VOX_AB7G_EOD_PUBLISH_ENABLED","VOX_AB7G_SIGNED_OWNER_PROOF_ENABLED",
 "VOX_DEPARTMENT_ENFORCEMENT_ENABLED"];
function enable(){for(const k of flags)process.env[k]="staging";}
function request(body={reportId:A,teamLeaderId:B,nonce:N,sourceDigest:H}){
 return new Request("https://local.test/api/vox/v1/official-eod-publish",{
  method:"POST",headers:{"authorization":"Bearer Owner","content-type":"application/json"},
  body:JSON.stringify(body)});
}
function world(){
 let calls=0;
 globalThis.__rc64Eod={verify:async()=>A,rpc:async()=>{
  calls++;return {data:[{publication_report_id:A,publication_state:"OFFICIALLY_RELEASED_BY_OWNER",
   receipt_nonce:N,source_sha256:H}],error:null};
 }};
 return {get calls(){return calls}};
}
test("actual official EOD route is uninstalled even with env enabled",async()=>{
 enable();const w=world();const r=await prod.POST(request());
 assert.equal(r.status,503);assert.equal(w.calls,0);
 assert.equal((await r.json()).error,"VERIFIED_APPROVAL_WRITER_NOT_INSTALLED");
 assert.match(readFileSync(source,"utf8"),/VERIFIED_APPROVAL_WRITER_INSTALLED=false as boolean/);
});
test("test-only candidate refuses hung or missing Owner AAL2 before any SQL",async()=>{
 enable();let w=world();globalThis.__rc64Eod.verify=async()=>new Promise(()=>{});
 let res=await sim.POST(request());
 assert.equal(res.status,503);assert.equal((await res.json()).error,"EOD_OWNER_AUTH_TIMEOUT");
 assert.equal(w.calls,0);
 w=world();globalThis.__rc64Eod.verify=async()=>null;
 res=await sim.POST(request());assert.equal(res.status,403);assert.equal(w.calls,0);
});
test("lost, errored, malformed and timed-out publish RPCs never imply rollback or retry permission",async()=>{
 enable();for(const mode of ["throw","error","empty","wrong","hang"]){
  const w=world();globalThis.__rc64Eod.rpc=async()=>{
   if(mode==="throw")throw Error("private key");
   if(mode==="error")return {data:null,error:{message:"private"}};
   if(mode==="empty")return {data:[],error:null};
   if(mode==="wrong")return {data:[{publication_report_id:B}],error:null};
   return new Promise(()=>{});
  };
  const res=await sim.POST(request());
  assert.equal(res.status,503,mode);
  const body=await res.json();
  assert.equal(body.error,"OFFICIAL_EOD_OUTCOME_UNKNOWN",mode);
  assert.equal(body.publicationAuthorized,null,mode);
  assert.equal(body.retrySameNonceOnly,true,mode);
  assert.equal(JSON.stringify(body).includes("private"),false);
 }
});
test("successful SQL receipt requires the SAME current Owner again before HTTP success",async()=>{
 enable();
 for(const mode of ["revoked","different-owner","hang","throw"]){
  const w=world();let auth=0;
  globalThis.__rc64Eod.verify=async()=>{
   if(++auth===1)return A;
   if(mode==="revoked")return null;
   if(mode==="different-owner")return B;
   if(mode==="throw")throw Error("private auth detail");
   return new Promise(()=>{});
  };
  const res=await sim.POST(request());
  assert.equal(res.status,503,mode);
  const body=await res.json();
  assert.equal(body.error,"OFFICIAL_EOD_OUTCOME_UNKNOWN",mode);
  assert.equal(body.publicationAuthorized,null);
  assert.equal(body.retrySameNonceOnly,true);
  assert.equal(auth,2);assert.equal(w.calls,1);
 }
});
test("only an exact receipt plus reverified Owner may be accepted in test-only mode",async()=>{
 enable();const w=world(),res=await sim.POST(request());assert.equal(res.status,201);
 const body=await res.json();assert.equal(body.externalMessagesSent,0);
 assert.equal(w.calls,1);
});
process.on("exit",()=>rmSync(temp,{recursive:true,force:true}));
