import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

// Compiles and executes the genuine VOX Web HTTP route and its genuine Core
// BFF parser. Only the already-verified MFA session and outbound HTTP
// transport are synthetic; no live provider, managed DB or network.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const output=resolve(root,"test-results/rc31-vox-web-vendor360-http.mjs");
mkdirSync(resolve(root,"test-results"),{recursive:true});
await build({entryPoints:[resolve(root,"apps/vox-web/app/api/vendor360/route.ts")],
 bundle:true,platform:"node",format:"esm",target:"node20",outfile:output,
 logLevel:"silent",plugins:[{name:"rc31-web-auth",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"noop",namespace:"rc31"}));
  b.onResolve({filter:/(?:^|\/)auth$/},()=>({path:"verified-auth",namespace:"rc31"}));
  b.onLoad({filter:/.*/,namespace:"rc31"},a=>({loader:"js",contents:a.path==="noop"?"":`
export async function verifiedMfaSession(){return globalThis.__rc31Web.token}
export function safeJson(payload,status=200){return Response.json(payload,{status,
 headers:{"cache-control":"private, no-store","x-content-type-options":"nosniff"}})}
`}));
 }}]});
const route=await import(pathToFileURL(output).href);
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const VENDOR=id(2),TASK=id(3),TOKEN="staff-aal2-synthetic";
const originalFetch=globalThis.fetch;
const oldEnv={...process.env};
test.after(()=>{globalThis.fetch=originalFetch;
 for(const k of ["VOX_STAFF_PORTAL_ENABLED","VOX_STAFF_VIEW_MODE","VOX_CORE_ORIGIN"]){
  if(oldEnv[k]===undefined)delete process.env[k];else process.env[k]=oldEnv[k];
 }
});
function setup({token=TOKEN,status=200,view=null}={}){
 process.env.VOX_STAFF_PORTAL_ENABLED="staging";
 process.env.VOX_STAFF_VIEW_MODE="scoped";
 process.env.VOX_CORE_ORIGIN="https://staging-core.quickfurno.in/";
 globalThis.__rc31Web={token,requests:[]};
 const data=view??{schema:"qf.vox.vendor360.reuse.v1",readOnly:true,
 owner:"quickfurno-core",
 vendors:[{vendorId:VENDOR,businessName:"Actual Vendor",status:"verified",
 verificationStatus:"approved",locationVerification:"verified",active:true,
 privateSecret:"do-not-leak"}],
 crm:[{vendorId:VENDOR,onboarding:"active",relationship:"engaged",phone:"private"}],
 tasks:[{id:TASK,vendorId:VENDOR,title:"Internal followup",status:"open",
 privateNotes:"do-not-leak"}]};
 globalThis.fetch=async(url,opts)=>{
  globalThis.__rc31Web.requests.push({url:String(url),opts});
  if(status!==200)return Response.json({ok:false,error:"DENIED"},{status});
  return Response.json({ok:true,view:data},{status:200});
 };
}
test("actual Vendor 360 Web route returns scoped Core-only fields",async()=>{
 setup();
 const r=await route.GET();assert.equal(r.status,200);
 const body=await r.json();assert.equal(body.ok,true);
 assert.equal(body.kind,"vendor360");
 assert.equal(body.view.vendors[0].vendorId,VENDOR);
 assert.equal(body.view.tasks[0].id,TASK);
 assert.equal(JSON.stringify(body).includes("do-not-leak"),false);
 assert.equal(JSON.stringify(body).includes("phone"),false);
 assert.equal(globalThis.__rc31Web.requests.length,1);
 const req=globalThis.__rc31Web.requests[0];
 assert.equal(req.url,"https://staging-core.quickfurno.in/api/vox/v1/vendor360");
 assert.equal(req.opts.method,"GET");
 assert.equal(req.opts.headers.authorization,"Bearer "+TOKEN);
 assert.equal(req.opts.cache,"no-store");
 assert.equal(req.opts.redirect,"error");
});
test("feature disabled and missing genuine MFA session both prevent Core calls",async()=>{
 setup();
 delete process.env.VOX_STAFF_PORTAL_ENABLED;
 let r=await route.GET();assert.equal(r.status,503);
 assert.equal((await r.json()).error,"STAFF_SCOPE_DISABLED");
 assert.equal(globalThis.__rc31Web.requests.length,0);
 setup({token:null});
 r=await route.GET();assert.equal(r.status,401);
 assert.equal((await r.json()).error,"MFA_REQUIRED");
 assert.equal(globalThis.__rc31Web.requests.length,0);
});
test("Core permission denial is preserved as HTTP 403 without leaking Core body",async()=>{
 setup({status:403});
 const r=await route.GET();assert.equal(r.status,403);
 const body=await r.json();
 assert.equal(body.ok,false);assert.equal(body.error,"CORE_SCOPE_DENIED_OR_UNAVAILABLE");
 assert.equal(globalThis.__rc31Web.requests.length,1);
});
test("invalid response schema, untrusted owner, and oversize lists cannot enter Web",async()=>{
 for(const override of [
  {schema:"not-core"},
  {owner:"untrusted"},
  {readOnly:false},
  {vendors:Array.from({length:13},()=>({vendorId:VENDOR}))}
 ]){
  setup({view:{schema:"qf.vox.vendor360.reuse.v1",readOnly:true,owner:"quickfurno-core",
   vendors:[],crm:[],tasks:[],...override}});
  const r=await route.GET();const body=await r.json();
  if(override.vendors){
   assert.equal(r.status,200);assert.deepEqual(body.view.vendors,[]);
  }else{
   assert.equal(r.status,503);assert.equal(body.error,"INVALID_CORE_SCHEMA");
  }
 }
});
test("Core origin is pinned, no arbitrary host or path allowed",async()=>{
 setup();process.env.VOX_CORE_ORIGIN="https://evil.example.com/";
 let r=await route.GET();assert.equal(r.status,503);
 assert.equal((await r.json()).error,"CORE_NOT_CONFIGURED");
 assert.equal(globalThis.__rc31Web.requests.length,0);
 setup();process.env.VOX_CORE_ORIGIN="https://staging-core.quickfurno.in/alternate";
 r=await route.GET();assert.equal(r.status,503);
 assert.equal(globalThis.__rc31Web.requests.length,0);
});
test("Vendor 360 Web cannot proxy mutations",async()=>{
 setup();
 assert.equal(route.DELETE,undefined,"Next.js handles an unexported DELETE as 405");
 for(const verb of ["POST","PATCH"]){
  const r=route[verb]();
  assert.equal(r.status,405);
  assert.equal((await r.json()).error,"CORE_APPROVAL_REQUIRED");
 }
 assert.equal(globalThis.__rc31Web.requests.length,0);
});
