import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const temp=mkdtempSync(join(tmpdir(),"vox-o1-client-web-"));
const output=join(temp,"core.mjs");
await build({entryPoints:[resolve(root,"lib/core.ts")],outfile:output,
 platform:"node",format:"esm",bundle:true,target:"node24",logLevel:"silent",
 plugins:[{name:"owner-web-auth",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"mock"}));
  b.onResolve({filter:/^\.\/auth$/},()=>({path:"auth",namespace:"mock"}));
  b.onLoad({filter:/.*/,namespace:"mock"},a=>({loader:"js",contents:
   a.path==="auth"?"export async function verifiedMfaSession(){return globalThis.__clientToken;}":""}));
 }}]});
const client=await import(pathToFileURL(output).href);
const names=["VOX_STAFF_PORTAL_ENABLED","VOX_STAFF_VIEW_MODE","VOX_OWNER_WORKSPACES_ENABLED",
 "VOX_OWNER_WORKSPACES_STAGE","VOX_CORE_ORIGIN"];
const prior=Object.fromEntries(names.map(k=>[k,process.env[k]]));
const originalFetch=globalThis.fetch;
const ID="22222222-2222-4222-8222-222222222222";
function on(){
 process.env.VOX_STAFF_PORTAL_ENABLED="staging";
 process.env.VOX_STAFF_VIEW_MODE="owner";
 process.env.VOX_OWNER_WORKSPACES_ENABLED="staging";
 process.env.VOX_OWNER_WORKSPACES_STAGE="private";
 process.env.VOX_CORE_ORIGIN="https://staging-core.quickfurno.in";
 globalThis.__clientToken="signed-token-for-unit-test";
}
function mock(rows=[{leadId:ID,state:"new",city:"Pune",category:"Kitchen",
 source:"Website",createdAt:"2026-11-03T10:00:00Z"}],override=null){
 const calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});
  return new Response(JSON.stringify(override??{ok:true,view:{
   schema:"qf.vox.owner.clients.v1",owner:"quickfurno-core",readOnly:true,
   actionsEnabled:false,recentOnly:true,totalCountKnown:false,leads:rows}}),{status:200});
 };
 return calls;
}
test("Owner Web BFF requires staging gates and MFA before Core access",async()=>{
 on();const calls=mock();delete process.env.VOX_OWNER_WORKSPACES_ENABLED;
 assert.equal((await client.fetchOwnerClientInbox()).status,503);
 assert.equal(calls.length,0);
 on();globalThis.__clientToken=null;
 assert.equal((await client.fetchOwnerClientInbox()).status,401);
 assert.equal(calls.length,0);
});
test("Owner Web client adapter uses only pinned Core metadata read path",async()=>{
 on();const calls=mock([{leadId:ID,state:"new",city:"Pune",category:"Interiors",
  source:"Website",createdAt:"2026-11-03T10:00:00Z"}]);
 const result=await client.fetchOwnerClientInbox();
 assert.equal(result.ok,true);assert.equal(result.view.leads.length,1);
 assert.equal(calls[0].url,"https://staging-core.quickfurno.in/api/vox/v1/owner-workspaces?kind=clients");
 assert.equal(calls[0].options.headers.authorization,"Bearer signed-token-for-unit-test");
 assert.equal(calls[0].options.cache,"no-store");
 assert.equal(calls[0].options.redirect,"error");
 assert.equal(result.view.actionsEnabled,false);
});
test("Owner Web rejects forged PII fields, IDs and fabricated complete-directory claims",async()=>{
 for(const malicious of [
  {ok:true,view:{schema:"qf.vox.owner.clients.v1",owner:"quickfurno-core",
   readOnly:true,actionsEnabled:false,recentOnly:true,totalCountKnown:false,
   leads:[{leadId:ID,city:"Pune",phone:"SECRET_PHONE"}]}},
  {ok:true,view:{schema:"qf.vox.owner.clients.v1",owner:"quickfurno-core",
   readOnly:true,actionsEnabled:false,recentOnly:true,totalCountKnown:false,
   leads:[{leadId:"untrusted"}]}},
  {ok:true,view:{schema:"qf.vox.owner.clients.v1",owner:"quickfurno-core",
   readOnly:true,actionsEnabled:false,recentOnly:false,totalCountKnown:true,leads:[]}},
  {ok:true,view:{schema:"qf.vox.owner.clients.v1",owner:"quickfurno-core",
   readOnly:true,actionsEnabled:false,recentOnly:true,totalCountKnown:false,
   leads:Array(13).fill({leadId:ID})}}
 ]){
  on();mock([],malicious);
  assert.equal((await client.fetchOwnerClientInbox()).status,503);
 }
});
test("Owner Web Core origin is strictly pinned",async()=>{
 on();const calls=mock();
 process.env.VOX_CORE_ORIGIN="https://attacker.example";
 assert.equal((await client.fetchOwnerClientInbox()).status,503);
 assert.equal(calls.length,0);
});
test("Restore flags and global fetch",()=>{
 globalThis.fetch=originalFetch;delete globalThis.__clientToken;
 for(const [key,value] of Object.entries(prior))if(value===undefined)delete process.env[key];else process.env[key]=value;
 rmSync(temp,{recursive:true,force:true});
});
