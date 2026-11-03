import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const tmp=mkdtempSync(join(tmpdir(),"vox-owner-bff-"));
const out=join(tmp,"web-core.mjs");
await build({entryPoints:[resolve(root,"lib/core.ts")],outfile:out,
 platform:"node",format:"esm",bundle:true,target:"node24",logLevel:"silent",
 plugins:[{name:"owner-web-mfa-mock",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"mock"}));
  b.onResolve({filter:/^\.\/auth$/},()=>({path:"auth",namespace:"mock"}));
  b.onLoad({filter:/.*/,namespace:"mock"},a=>({
   loader:"js",contents:a.path==="auth"?
    "export async function verifiedMfaSession(){return globalThis.__ownerBffToken;}":""
  }));
 }}]});
const core=await import(pathToFileURL(out).href);
const oldFetch=globalThis.fetch;
const keys=["VOX_STAFF_PORTAL_ENABLED","VOX_STAFF_VIEW_MODE","VOX_OWNER_WORKSPACES_ENABLED","VOX_OWNER_WORKSPACES_STAGE","VOX_CORE_ORIGIN"];
const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
const ID="22222222-2222-4222-8222-222222222222";
const payloads={
 vendor360:{vendors:[{vendorId:ID,businessName:"Studio",status:"Approved",verificationStatus:"Verified",locationVerification:"pending",active:false}],crm:[],tasks:[]},
 acquisition:{prospects:[{id:ID,businessName:"Business",stage:"interested",priority:"A",nextAction:"call",humanTakeover:false,doNotContact:false}],tasks:[]},
 desk:{support:[{threadId:ID,state:"open",priority:"high",ageBand:"NOT_CONFIGURED"}],humanInbox:[]}
};
const setup=()=>{
 process.env.VOX_STAFF_PORTAL_ENABLED="staging";
 process.env.VOX_STAFF_VIEW_MODE="owner";
 process.env.VOX_OWNER_WORKSPACES_ENABLED="staging";
 process.env.VOX_OWNER_WORKSPACES_STAGE="private";
 process.env.VOX_CORE_ORIGIN="https://staging-core.quickfurno.in";
 globalThis.__ownerBffToken="valid-supabase-test-token";
};
const mock=(kind,override=null,status=200)=>{
 const calls=[];globalThis.fetch=async (url,options)=>{
  calls.push({url,options});
  return new Response(JSON.stringify(override??{ok:true,view:{
   schema:"qf.vox.owner."+kind+".v1",owner:"quickfurno-core",readOnly:true,
   actionsEnabled:false,...payloads[kind]}}),{status});
 };
 return calls;
};
test("Owner vendor/acquisition/desk use Owner-only Core endpoint and do not call Staff APIs",async()=>{
 for(const kind of ["vendor360","acquisition","desk"]){
  setup();const calls=mock(kind);
  const r=kind==="desk"?await core.fetchScopedServiceDesk():await core.fetchScopedCrm(kind);
  assert.equal(r.ok,true);assert.equal(calls.length,1);
  assert.equal(calls[0].url,"https://staging-core.quickfurno.in/api/vox/v1/owner-workspaces?kind="+kind);
  assert.equal(calls[0].options.headers.authorization,"Bearer valid-supabase-test-token");
  assert.equal(calls[0].options.cache,"no-store");
  assert.equal(calls[0].options.redirect,"error");
 }
});
test("Owner workspace gate and missing MFA both stop before Core fetch",async()=>{
 setup();const calls=mock("vendor360");
 delete process.env.VOX_OWNER_WORKSPACES_ENABLED;
 assert.equal((await core.fetchScopedCrm("vendor360")).status,503);
 assert.equal(calls.length,0);
 setup();globalThis.__ownerBffToken=null;
 assert.equal((await core.fetchScopedServiceDesk()).status,401);
 assert.equal(calls.length,0);
});
test("Untrusted, malformed, oversized Core payloads and spoofed vendor IDs fail closed",async()=>{
 setup();
 const bad=[
  {ok:true,view:{schema:"other",owner:"quickfurno-core",readOnly:true,actionsEnabled:false,...payloads.vendor360}},
  {ok:true,view:{schema:"qf.vox.owner.vendor360.v1",owner:"quickfurno-core",readOnly:true,actionsEnabled:false,vendors:Array(13).fill(payloads.vendor360.vendors[0]),crm:[],tasks:[]}},
  {ok:true,view:{schema:"qf.vox.owner.vendor360.v1",owner:"quickfurno-core",readOnly:true,actionsEnabled:false,vendors:[{...payloads.vendor360.vendors[0],vendorId:"forged"}],crm:[],tasks:[]}},
  {ok:true,view:{schema:"qf.vox.owner.vendor360.v1",owner:"quickfurno-core",readOnly:true,actionsEnabled:true,...payloads.vendor360}}
 ];
 for(const value of bad){
  const calls=mock("vendor360",value);
  assert.equal((await core.fetchScopedCrm("vendor360")).status,503);
  assert.equal(calls.length,1);
 }
});
test("Owner cannot redirect BFF to an arbitrary Core host",async()=>{
 setup();const calls=mock("acquisition");
 process.env.VOX_CORE_ORIGIN="https://attacker.example";
 assert.equal((await core.fetchScopedCrm("acquisition")).status,503);
 assert.equal(calls.length,0);
});
test("Staff-scoped mode retains its unchanged Core route",async()=>{
 setup();process.env.VOX_STAFF_VIEW_MODE="scoped";
 const calls=[];globalThis.fetch=async(url,options)=>{
  calls.push(url);
  return new Response(JSON.stringify({ok:true,view:{
   schema:"qf.vox.vendor360.reuse.v1",owner:"quickfurno-core",readOnly:true,
   vendors:[],crm:[],tasks:[]}}),{status:200});
 };
 const r=await core.fetchScopedCrm("vendor360");
 assert.equal(r.ok,true);
 assert.deepEqual(calls,["https://staging-core.quickfurno.in/api/vox/v1/vendor360"]);
});
test("Restore global fetch and feature flags",()=>{
 globalThis.fetch=oldFetch;delete globalThis.__ownerBffToken;
 for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;
 rmSync(tmp,{recursive:true,force:true});
});
