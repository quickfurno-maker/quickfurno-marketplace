import test from "node:test";import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const tmp=mkdtempSync(join(tmpdir(),"rc43-eod-real-route-"));
const source=resolve(root,"app/api/vox/v1/eod-atomic-review/route.ts");
async function compile(installed){
 const dest=join(tmp,installed?"test-installed.mjs":"production.mjs");
 await build({entryPoints:[source],outfile:dest,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"eod-stubs",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"fake"}));
  b.onResolve({filter:/^@\/services\/vox\/verifiedStaffBearer$/},()=>({path:"owner",namespace:"fake"}));
  b.onResolve({filter:/^@\/services\/vox\/rc41SignedEodReviewSnapshot$/},()=>({path:"review",namespace:"fake"}));
  b.onResolve({filter:/^@\//},a=>({path:resolve(root,a.path.slice(2))+".ts"}));
  b.onLoad({filter:/.*/,namespace:"fake"},a=>({loader:"js",contents:a.path==="owner"?
    "export function verifyVoxOwnerBearer(h){return globalThis.__rc43Eod.owner(h);}":
    a.path==="review"?
    "export function verifyRc41PendingEodViaRpc(){globalThis.__rc43Eod.reviewCalls++;throw Error('unexpected');}":""}));
  b.onLoad({filter:/app[\\/]api[\\/]vox[\\/]v1[\\/]eod-atomic-review[\\/]route\.ts$/},a=>({
   loader:"ts",contents:installed?
   readFileSync(a.path,"utf8").replace("RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED=false as const",
    "RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED=true as const"):readFileSync(a.path,"utf8")
  }));
 }}]});
 return import(pathToFileURL(dest).href);
}
const prod=await compile(false),sim=await compile(true);
const U="11111111-1111-4111-8111-111111111111",V="22222222-2222-4222-8222-222222222222",H="a".repeat(64);
const url="https://localhost/api/vox/v1/eod-atomic-review?intentId="+U+"&subjectId="+V+"&expectedReceiptSha256="+H;
const request=(owner="Bearer owner")=>new Request(url,{headers:{authorization:owner,
 "x-vox-team-leader-authorization":"Bearer independent-leader"}});
const key="VOX_RC42_EOD_ATOMIC_REVIEW_ENABLED",dep="VOX_DEPARTMENT_ENFORCEMENT_ENABLED";
function flags(on){on?(process.env[key]=process.env[dep]="staging"):(delete process.env[key],delete process.env[dep]);}
function world(id=U){const calls={ownerCalls:0,reviewCalls:0};globalThis.__rc43Eod={
 ...calls,owner:async()=>{globalThis.__rc43Eod.ownerCalls++;return id;}};return globalThis.__rc43Eod;}
test("production route hard OFF regardless of environment, no Auth or EOD read",async()=>{
 for(const enabled of [false,true]){
  flags(enabled);const v=world();const r=await prod.GET(request());
  assert.equal(r.status,503);assert.equal(v.ownerCalls,0);assert.equal(v.reviewCalls,0);
  assert.equal((await r.json()).publicationAuthorized,false);
 }
 assert.equal(prod.RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED,false);
});
test("test-only reviewed install also requires staging flags before Auth",async()=>{
 flags(false);const v=world();assert.equal((await sim.GET(request())).status,503);
 assert.equal(v.ownerCalls,0);assert.equal(v.reviewCalls,0);
});
test("Owner AAL2 reject before reader and never publish an official EOD",async()=>{
 flags(true);
 let v=world(null),r=await sim.GET(request());
 assert.equal(r.status,403);assert.equal(v.ownerCalls,1);assert.equal(v.reviewCalls,0);
 v=world(U);r=await sim.GET(request());const b=await r.json();
 assert.equal(r.status,503);assert.equal(b.publicationAuthorized,false);
 assert.equal(b.providerMessagesSent,0);assert.equal(v.ownerCalls,1);assert.equal(v.reviewCalls,0);
});
test("hung real Owner MFA check times out before any EOD reader or reviewer",async()=>{
 flags(true);
 const w=world();
 globalThis.__rc43Eod.owner=async()=>{w.ownerCalls++;return new Promise(()=>{});};
 const start=Date.now(),r=await sim.GET(request());
 assert.ok(Date.now()-start<2500);assert.equal(r.status,503);
 const body=await r.json();
 assert.equal(body.error,"OWNER_AUTH_TIMEOUT");assert.equal(body.approved,false);
 assert.equal(body.publicationAuthorized,false);assert.equal(body.providerMessagesSent,0);
 assert.equal(w.ownerCalls,1);assert.equal(w.reviewCalls,0);
});
test("all mutations rejected even with simulated installed reader",async()=>{
 for(const mod of [prod,sim])for(const verb of ["POST","PUT","PATCH","DELETE"]){
  assert.equal((await mod[verb]()).status,405);
 }
});
process.on("exit",()=>rmSync(tmp,{recursive:true,force:true}));
