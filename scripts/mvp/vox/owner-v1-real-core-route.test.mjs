import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join,dirname} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const temp=mkdtempSync(join(tmpdir(),"vox-owner-v1-"));
const output=join(temp,"route.mjs");
await build({entryPoints:[resolve(root,"app/api/vox/v1/owner-workspaces/route.ts")],
 outfile:output,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"owner-mock",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"mock"}));
  b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:"supabase",namespace:"mock"}));
  b.onResolve({filter:/^@\/services\/vox\/verifiedStaffBearer$/},()=>({path:"verified",namespace:"mock"}));
  b.onResolve({filter:/^@\//},a=>({path:resolve(root,a.path.slice(2))}));
  b.onLoad({filter:/.*/,namespace:"mock"},a=>({
   loader:"js",contents:a.path==="verified"?
   "export async function verifyVoxOwnerBearer(){return globalThis.__ownerV1.nextOwner()}":
   a.path==="supabase"?"export function adminClient(){return globalThis.__ownerV1.db()}":""
  }));
 }}]});
const route=await import(pathToFileURL(output).href);
const OWNER="11111111-1111-4111-8111-111111111111";
const VENDOR="22222222-2222-4222-8222-222222222222";
const PROSPECT="33333333-3333-4333-8333-333333333333";
const CASE="44444444-4444-4444-8444-444444444444";
const TASK="55555555-5555-4555-8555-555555555555";
const original={enabled:process.env.VOX_OWNER_WORKSPACES_ENABLED,stage:process.env.VOX_OWNER_WORKSPACES_STAGE};
function flags(on){
 if(on){process.env.VOX_OWNER_WORKSPACES_ENABLED="staging";process.env.VOX_OWNER_WORKSPACES_STAGE="private";}
 else{delete process.env.VOX_OWNER_WORKSPACES_ENABLED;delete process.env.VOX_OWNER_WORKSPACES_STAGE;}
}
process.on("exit",()=>{for(const [key,val] of Object.entries({VOX_OWNER_WORKSPACES_ENABLED:original.enabled,VOX_OWNER_WORKSPACES_STAGE:original.stage})){if(val===undefined)delete process.env[key];else process.env[key]=val;}rmSync(temp,{recursive:true,force:true});});
const records={
 vendors:[{id:VENDOR,business_name:"Studio",status:"Approved",verification_status:"Verified",is_active:false,created_at:"2026-11-01T00:00:00Z",phone:"SECRET"}],
 vendor_crm_profiles:[{vendor_id:VENDOR,onboarding_stage:"enrolled",relationship_status:"active"}],
 vendor_tasks:[{id:TASK,vendor_id:VENDOR,title:"Call",status:"open"}],
 aarohi_prospects:[{id:PROSPECT,business_name:"Prospect",prospect_stage:"interested",priority_band:"A",next_action_type:"call",do_not_contact:false,human_takeover:false}],
 aarohi_tasks:[{id:TASK,prospect_id:PROSPECT,task_type:"call",status:"open",due_at:"2026-11-04T00:00:00Z"}],
 vendor_support_threads:[{id:CASE,status:"open",priority:"high"}],
 communication_conversations:[{id:CASE,subject_type:"vendor",state:"HUMAN",human_takeover:true,service_window_expires_at:"2027-01-01T00:00:00Z",raw_message:"SECRET"}]
};
function mock({owners=[OWNER,OWNER],fail=null,rows=records}={}){
 let verified=0;const reads=[];
 globalThis.__ownerV1={
  nextOwner:async()=>owners[verified++]??null,
  db:()=>({from(table){
   assert.ok(Object.hasOwn(rows,table),"unexpected query "+table);
   const query={select(columns){
    assert.doesNotMatch(columns,/phone|raw_message|provider|payment|credit/i);
    reads.push({table,columns});return query;
   },order(){return query;},in(_field,values){assert.ok(values.length>0);return query;},
   eq(){return query;},
   async limit(n){assert.equal(n,12);return fail===table?{data:null,error:{code:"FAIL"}}:{data:rows[table],error:null};}};
   return query;
  }})
 };
 return {reads,get authChecks(){return verified;}};
}
const req=(kind="vendor360")=>new Request("https://staging-core.quickfurno.in/api/vox/v1/owner-workspaces?kind="+kind,{headers:{authorization:"Bearer mock"}});
test("default is disabled: no authentication or queries",async()=>{
 flags(false);const m=mock();const r=await route.GET(req());
 assert.equal(r.status,503);assert.equal(m.authChecks,0);assert.equal(m.reads.length,0);
});
test("strict kind filter and absent Owner reject before Core reads",async()=>{
 flags(true);const m=mock();
 assert.equal((await route.GET(req("other"))).status,400);
 assert.equal((await route.GET(new Request(req().url+"&kind=desk"))).status,400);
 assert.equal(m.reads.length,0);
 const no=mock({owners:[null]});assert.equal((await route.GET(req())).status,403);
 assert.equal(no.reads.length,0);
});
test("real Owner route returns bounded, PII-free Vendor and Acquisition views",async()=>{
 flags(true);
 for(const kind of ["vendor360","acquisition"]){
  const m=mock();const r=await route.GET(req(kind));assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.view.schema,"qf.vox.owner."+kind+".v1");
  assert.equal(body.view.readOnly,true);assert.equal(body.view.actionsEnabled,false);
  assert.equal(m.authChecks,2);assert.doesNotMatch(JSON.stringify(body),/SECRET|phone|raw_message/);
  assert.match(r.headers.get("cache-control"),/no-store/);
  assert.equal(r.headers.get("vary"),"Authorization");
  assert.equal(m.reads.length,kind==="vendor360"?3:2);
 }
});
test("real Owner Desk shows only HUMAN metadata, no provider send",async()=>{
 flags(true);const m=mock();const res=await route.GET(req("desk"));
 assert.equal(res.status,200);const x=await res.json();
 assert.equal(x.view.humanInbox.length,1);assert.equal(x.view.support.length,1);
 assert.equal(x.view.humanInbox[0].canReply,false);
 assert.equal(m.reads.length,2);
 assert.doesNotMatch(JSON.stringify(x),/SECRET|raw_message/);
});
test("expired/revoked Owner after read gets no payload",async()=>{
 flags(true);const m=mock({owners:[OWNER,null]});
 const r=await route.GET(req("acquisition"));assert.equal(r.status,403);
 assert.equal((await r.json()).error,"OWNER_AUTH_REVOKED_DURING_READ");
 assert.equal(m.authChecks,2);
});
test("database faults fail closed without fabricating empty records",async()=>{
 flags(true);mock({fail:"vendor_tasks"});const r=await route.GET(req());
 assert.equal(r.status,503);assert.equal((await r.json()).error,"OWNER_VENDOR_READ_UNAVAILABLE");
});
test("all writes are forbidden",()=>{
 const m=mock();
 for(const verb of ["POST","PUT","PATCH","DELETE"]){
  assert.equal(route[verb]().status,405);
 }
 assert.equal(m.reads.length,0);
});
