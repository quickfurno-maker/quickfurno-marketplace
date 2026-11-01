import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const temp=mkdtempSync(join(tmpdir(),"vox-rc50-conversation-"));
const outfile=join(temp,"route.mjs");
await build({entryPoints:[resolve(root,"app/api/vox/v1/core/conversation-candidates/route.ts")],
 outfile,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"verified-scoped-test",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"empty",namespace:"test"}));
  b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:"supabase",namespace:"test"}));
  b.onResolve({filter:/^@\/services\/vox\/verifiedScopedStaff$/},()=>({path:"scope",namespace:"test"}));
  b.onResolve({filter:/^@\/contracts\/vox\/canonicalZoneGate.mjs$/},
   ()=>({path:resolve(root,"contracts/vox/canonicalZoneGate.mjs")}));
  b.onLoad({filter:/.*/,namespace:"test"},a=>({loader:"js",contents:
   a.path==="supabase"?"export const adminClient=()=>globalThis.__rc50.db;":
   a.path==="scope"?"export const getVerifiedScopedStaff=async()=>{globalThis.__rc50.auth++;return globalThis.__rc50.scope;};":""}));
 }}]});
const api=await import(pathToFileURL(outfile).href);
const ids=Array.from({length:6},(_,i)=>"00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"));
const [city,zone,vendor,convo,other,staff]=ids;
const env=["VOX_STAFF_READ_ENABLED","VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED",
 "VOX_STAFF_GRANTS_ENABLED","VOX_DEPARTMENT_ENFORCEMENT_ENABLED"];
const flags=on=>env.forEach(k=>on?process.env[k]="staging":delete process.env[k]);
const state={auth:0,scope:null,db:null,queries:[],rows:{},revokeDuringRead:false};
globalThis.__rc50=state;
const q=(table)=>{
 const ops=[];state.queries.push({table,ops});
 const chain={
  select:(...args)=>{ops.push(["select",...args]);return chain;},
  in:(...args)=>{ops.push(["in",...args]);return chain;},
  eq:(...args)=>{ops.push(["eq",...args]);return chain;},
  order:(...args)=>{ops.push(["order",...args]);return chain;},
  limit:(...args)=>{ops.push(["limit",...args]);return chain;},
  then:(resolve,reject)=>{
   if(table==="communication_conversations"&&state.revokeDuringRead)state.scope=null;
   return Promise.resolve({data:state.rows[table]??[],error:null}).then(resolve,reject);
  }
 };return chain;
};
const baseScope={role:"operations_manager",canReadContent:true,cityId:city,teamId:staff,
 conversationIds:[convo],vendorIds:[vendor]};
function reset(){
 flags(true);state.auth=0;state.queries=[];state.scope={...baseScope};
 state.revokeDuringRead=false;
 state.db={from:q};
 state.rows={vendors:[{id:vendor,service_zone_id:zone}],
  marketplace_service_zones:[{id:zone,city_id:city,is_active:true}],
  communication_conversations:[{id:convo,subject_id:vendor,
   subject_type:"vendor",tenant_id:"quickfurno",channel:"whatsapp",
   human_takeover:false,assigned_actor:"ANISHA",revision:4,state:"OPEN"}]};
}
const req=()=>new Request("https://core.test/api/vox/v1/core/conversation-candidates",
 {headers:{authorization:"Bearer fake-test-token"}});
test("default-OFF denies before Staff read or DB, all mutation methods forbidden",async()=>{
 reset();flags(false);assert.equal((await api.GET(req())).status,503);
 assert.equal(state.auth,0);assert.equal(state.queries.length,0);
 for(const method of ["POST","PUT","PATCH","DELETE"])
  assert.equal(api[method]().status,405);
});
test("only current Operations Manager with exact scope may discover",async()=>{
 reset();state.scope={...baseScope,role:"support_agent"};
 assert.equal((await api.GET(req())).status,403);
 assert.equal(state.queries.length,0);
 reset();state.scope=null;
 assert.equal((await api.GET(req())).status,403);
});
test("Core returns bounded exact vendor-only revision hints, not write permission",async()=>{
 reset();const res=await api.GET(req());assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.mode,"READ_ONLY");assert.equal(data.actionsEnabled,false);
 assert.deepEqual(data.conversations,[{id:convo,revision:4,state:"OPEN",
  allowedActions:["PAUSE_AI","TAKEOVER"]}]);
 assert.equal(JSON.stringify(data).includes("subject_id"),false);
 const read=state.queries.find(x=>x.table==="communication_conversations").ops;
 assert.ok(read.some(x=>x[0]==="in"&&x[1]==="id"&&x[2][0]===convo));
 assert.ok(read.some(x=>x[0]==="in"&&x[1]==="subject_id"&&x[2][0]===vendor));
 assert.ok(read.some(x=>x[0]==="eq"&&x[1]==="tenant_id"&&x[2]==="quickfurno"));
});
test("foreign vendor city grants never expose a conversation",async()=>{
 reset();state.rows.marketplace_service_zones=[{id:zone,city_id:other,is_active:true}];
 const res=await api.GET(req());
 assert.equal(res.status,503);assert.equal(state.queries.some(x=>x.table==="communication_conversations"),false);
});
test("forged row or non-current revision fails closed",async()=>{
 reset();state.rows.communication_conversations[0].id=other;
 assert.equal((await api.GET(req())).status,503);
 reset();state.rows.communication_conversations[0].revision=2147483647;
 assert.equal((await api.GET(req())).status,503);
});
test("Staff scope revoked during asynchronous Core reads cannot return current choices",async()=>{
 reset();state.revokeDuringRead=true;
 const res=await api.GET(req());
 assert.equal(res.status,403);
 assert.equal(state.auth,2);
});
test("PAUSED conversation allows only human takeover in selection hint",async()=>{
 reset();state.rows.communication_conversations[0].state="PAUSED";
 const res=await api.GET(req());assert.equal(res.status,200);
 const body=await res.json();
 assert.deepEqual(body.conversations[0].allowedActions,["TAKEOVER"]);
});
process.on("exit",()=>{delete globalThis.__rc50;rmSync(temp,{recursive:true,force:true});});
