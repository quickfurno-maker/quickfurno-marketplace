import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join,dirname} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {projectOwnerClientInbox} from "../../../services/vox/ownerWorkspaceProjection.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const temp=mkdtempSync(join(tmpdir(),"vox-o1-clients-"));
const output=join(temp,"route.mjs");
const ID="22222222-2222-4222-8222-222222222222";
const OWNER="11111111-1111-4111-8111-111111111111";
const source={id:ID,status:"new",city:"Pune",category:"Interiors",
 source:"Website",created_at:"2026-11-03T10:00:00Z",phone:"SECRET_PHONE",
 name:"SECRET_CLIENT",message:"SECRET_MESSAGE"};
const prior=Object.fromEntries(["VOX_OWNER_WORKSPACES_ENABLED","VOX_OWNER_WORKSPACES_STAGE"]
 .map(k=>[k,process.env[k]]));
process.on("exit",()=>{
 for(const [k,v] of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;
 rmSync(temp,{recursive:true,force:true});
});
test("Client projection uses only bounded metadata without names, contact details or matching actions",()=>{
 const view=projectOwnerClientInbox({leads:Array(20).fill(source)});
 assert.equal(view.schema,"qf.vox.owner.clients.v1");
 assert.equal(view.readOnly,true);assert.equal(view.actionsEnabled,false);
 assert.equal(view.recentOnly,true);assert.equal(view.totalCountKnown,false);
 assert.equal(view.leads.length,12);
 assert.deepEqual(Object.keys(view.leads[0]),["leadId","state","city","category","source","createdAt"]);
 assert.doesNotMatch(JSON.stringify(view),/SECRET|phone|message|matching|credit/i);
});
await build({entryPoints:[resolve(root,"app/api/vox/v1/owner-workspaces/route.ts")],
 outfile:output,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"owner-core-mocks",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"mock"}));
  b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:"supabase",namespace:"mock"}));
  b.onResolve({filter:/^@\/services\/vox\/verifiedStaffBearer$/},()=>({path:"verified",namespace:"mock"}));
  b.onResolve({filter:/^@\//},a=>({path:resolve(root,a.path.slice(2))}));
  b.onLoad({filter:/.*/,namespace:"mock"},a=>({loader:"js",contents:
   a.path==="verified"?"export async function verifyVoxOwnerBearer(){return globalThis.__voxO1.owner()}":
   a.path==="supabase"?"export function adminClient(){return globalThis.__voxO1.db()}":""}));
 }}]});
const route=await import(pathToFileURL(output).href);
const req=()=>new Request("https://staging-core.quickfurno.in/api/vox/v1/owner-workspaces?kind=clients",
 {headers:{authorization:"Bearer mock"}});
function setup({enabled=true,auth=OWNER,error=false}={}){
 if(enabled){process.env.VOX_OWNER_WORKSPACES_ENABLED="staging";
 process.env.VOX_OWNER_WORKSPACES_STAGE="private";}else{
 delete process.env.VOX_OWNER_WORKSPACES_ENABLED;delete process.env.VOX_OWNER_WORKSPACES_STAGE;}
 const calls=[];
 globalThis.__voxO1={owner:async()=>auth,db:()=>({from(table){
  assert.equal(table,"leads");
  const q={select(fields){
   assert.equal(fields,"id,status,city,category,source,created_at");
   calls.push(fields);return q;
  },order(){return q;},async limit(n){
   assert.equal(n,12);
   return error?{error:{code:"FAIL"},data:null}:{error:null,data:[source]};
  }};
  return q;
 }})};
 return calls;
}
test("Owner Client Core endpoint is disabled by default before Auth/DB",async()=>{
 const calls=setup({enabled:false});const r=await route.GET(req());
 assert.equal(r.status,503);assert.equal(calls.length,0);
});
test("Owner Client Core endpoint enforces AAL2 and no writes",async()=>{
 const calls=setup({auth:null});
 assert.equal((await route.GET(req())).status,403);assert.equal(calls.length,0);
 for(const method of ["POST","PATCH","PUT","DELETE"])
  assert.equal(route[method]().status,405);
});
test("Owner Client Core response is real Core metadata, not PII or total-count claims",async()=>{
 const calls=setup();
 const r=await route.GET(req());assert.equal(r.status,200);assert.equal(calls.length,1);
 const body=await r.json();assert.equal(body.view.leads.length,1);
 assert.equal(body.view.recentOnly,true);assert.equal(body.view.totalCountKnown,false);
 assert.doesNotMatch(JSON.stringify(body),/SECRET|phone|message/);
});
test("Owner Core failure fails closed, never invents an empty successful result",async()=>{
 setup({error:true});const r=await route.GET(req());assert.equal(r.status,503);
 assert.equal((await r.json()).error,"OWNER_CLIENT_READ_UNAVAILABLE");
});
