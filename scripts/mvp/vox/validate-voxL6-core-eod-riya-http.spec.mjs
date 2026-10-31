// Executes actual Core L1 and L2 GET TypeScript handlers in Node VM, with
// narrowly injected synthetic Supabase AAL2 contexts and current DB rows.
// NO real Auth, managed SQL, credentials, messages, or staging activity.
import test,{beforeEach} from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import {readFileSync} from "node:fs";
import {deriveCanonicalCityVendorIds} from "../../../contracts/vox/canonicalZoneGate.mjs";
import {projectActualStaffSourceStatus} from "../../../contracts/vox/actualEodSourceStatus.mjs";
import {projectScopedClientCaseList} from "../../../contracts/vox/verifiedClientCasePreview.mjs";
import {unchangedAuthorizedStaffScope} from "../../../contracts/vox/rc1CurrentStaffScope.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const state={flags:{},scope:null,rows:{},errors:{},queries:[],calls:0};
const scope=()=>({userId:id(1),teamId:id(2),cityId:id(3),role:"support_agent",
 canReadContent:true,canMutate:false,verifiedDepartments:["client_success"],
 prospectIds:[],vendorIds:[],supportThreadIds:[],conversationIds:[]});
function reset(){
 state.flags={VOX_STAFF_READ_ENABLED:"staging",VOX_STAFF_GRANTS_ENABLED:"staging",
  VOX_DEPARTMENT_ENFORCEMENT_ENABLED:"staging",
  VOX_EOD_PREVIEW_ENABLED:"staging",
  VOX_EOD_SOURCE_READINESS_ENABLED:"staging",
  VOX_RIYA_CLIENT_CASE_READ_ENABLED:"staging"};
 state.scope=scope();state.rows={};state.errors={};state.queries=[];state.calls=0;
}
reset();
function query(table){
 const ops=[];
 const builder={
  select(...v){ops.push(["select",...v]);return builder},
  eq(...v){ops.push(["eq",...v]);return builder},
  is(...v){ops.push(["is",...v]);return builder},
  gt(...v){ops.push(["gt",...v]);return builder},
  gte(...v){ops.push(["gte",...v]);return builder},
  lt(...v){ops.push(["lt",...v]);return builder},
  in(...v){ops.push(["in",...v]);return builder},
  limit(...v){ops.push(["limit",...v]);return builder},
  then(resolve,reject){
   state.queries.push({table,ops});
   return Promise.resolve({
    data:state.rows[table]??[],
    error:state.errors[table]??null
   }).then(resolve,reject);
  }
 };
 return builder;
}
const ctx=vm.createContext({Date,Intl,URL,Request,Response,Buffer,JSON,Number,Promise,
 process:{env:new Proxy({}, {get(_,key){return state.flags[key]},
 set(_,key,val){state.flags[key]=val;return true}})}});
async function route(path,exportName,moduleRef,projection){
 const src=readFileSync(new URL(path,import.meta.url),"utf8");
 const js=ts.transpileModule(src,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022
 }}).outputText;
 const mod=new vm.SourceTextModule(js,{context:ctx,identifier:path});
 const mocks={
  "@/lib/supabase":{adminClient:()=>{
   state.calls++;return {from:query};
  }},
  "@/services/vox/verifiedScopedStaff":{getVerifiedScopedStaff:async()=>{
   state.calls++;return state.scope;
  }},
  [moduleRef]:{[exportName]:projection},
  "@/contracts/vox/rc1CurrentStaffScope.mjs":{unchangedAuthorizedStaffScope}
 };
 if(path.includes("eod-source-status"))mocks["@/contracts/vox/canonicalZoneGate.mjs"]=
  {deriveCanonicalCityVendorIds};
 await mod.link(name=>{
  const fields=mocks[name];if(!fields)throw Error("UNDECLARED_IMPORT:"+name);
  return new vm.SyntheticModule(Object.keys(fields),function(){
   for(const [key,value] of Object.entries(fields))this.setExport(key,value);
  },{context:ctx,identifier:name});
 });
 await mod.evaluate();
 return mod.namespace;
}
const eod=await route(
 "../../../app/api/vox/v1/eod-source-status/route.ts",
 "projectActualStaffSourceStatus",
 "@/contracts/vox/actualEodSourceStatus.mjs",projectActualStaffSourceStatus);
const riya=await route(
 "../../../app/api/vox/v1/riya-client-cases/route.ts",
 "projectScopedClientCaseList",
 "@/contracts/vox/verifiedClientCasePreview.mjs",projectScopedClientCaseList);
const req=p=>new Request("https://core.quickfurno.in/api/vox/v1/"+p,{
 method:"GET",headers:{authorization:"Bearer test_only_aal2"}});
beforeEach(reset);
test("both real Core handlers default OFF before reading user or DB",async()=>{
 state.flags.VOX_EOD_SOURCE_READINESS_ENABLED="off";
 state.flags.VOX_RIYA_CLIENT_CASE_READ_ENABLED="off";
 assert.equal((await eod.GET(req("eod-source-status"))).status,503);
 assert.equal((await riya.GET(req("riya-client-cases"))).status,503);
 assert.equal(state.calls,0);assert.equal(state.queries.length,0);
});
test("real current AAL2 Staff Core scope required for both reads",async()=>{
 state.scope=null;
 assert.equal((await eod.GET(req("eod-source-status"))).status,403);
 assert.equal((await riya.GET(req("riya-client-cases"))).status,403);
 state.scope={...scope(),canReadContent:false};
 assert.equal((await eod.GET(req("eod-source-status"))).status,403);
 assert.equal((await riya.GET(req("riya-client-cases"))).status,403);
});
test("EOD actual Core reads report NO_GRANTED_OBJECTS, NEVER full daily total",async()=>{
 const r=await eod.GET(req("eod-source-status"));
 assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.ok,true);assert.equal(body.sources.length,4);
 assert.deepEqual(body.sources.map(x=>x.source),[
  "CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"]);
 assert.equal(body.allSourceReady,false);assert.equal(body.rollup,null);
 assert.equal(body.canSubmit,false);assert.equal(body.providerMessagesSent,0);
 assert.ok(state.queries.some(q=>q.table==="vox_work_events_candidate_v1"));
 assert.ok(!state.queries.some(q=>q.table==="communication_messages"));
});
test("Core EOD fails shut when source DB inaccessible or window overflows",async()=>{
 state.errors.vox_work_events_candidate_v1={code:"NO_GRANT"};
 assert.equal((await eod.GET(req("eod-source-status"))).status,503);
 reset();
 state.rows.vox_work_events_candidate_v1=Array.from({length:101},(_,k)=>({id:id(k+100)}));
 assert.equal((await eod.GET(req("eod-source-status"))).status,503);
});
test("EOD refuses unauthorized or wrong-city vendor resource, never broadens scope",async()=>{
 state.scope={...scope(),vendorIds:[id(8)]};
 state.rows.vendors=[{id:id(8),service_zone_id:id(9)}];
 state.rows.marketplace_service_zones=[{id:id(9),city_id:id(99),is_active:true}];
 assert.equal((await eod.GET(req("eod-source-status"))).status,403);
});
test("Riya denies missing separate reviewed client_success department",async()=>{
 state.scope={...scope(),verifiedDepartments:["service_support"]};
 assert.equal((await riya.GET(req("riya-client-cases"))).status,403);
 assert.equal(state.queries.length,0);
});
test("Riya route with zero current case grants never invents activity/actions",async()=>{
 const r=await riya.GET(req("riya-client-cases"));
 assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.ok,true);assert.deepEqual(body.items,[]);
 assert.equal(body.totalKnown,false);assert.equal(body.canSendReply,false);
 assert.equal(body.requiresFreshClientConsent,true);
});
test("Riya exact current grant, Google zone and client case GET is metadata only",async()=>{
 const tomorrow=new Date(Date.now()+86400000).toISOString();
 state.rows.vox_staff_object_scopes_v1=[{
  auth_user_id:id(1),scope_kind:"conversation",object_id:id(7),
  expires_at:tomorrow,revoked_at:null
 }];
 state.rows.communication_conversations=[{
  id:id(7),subject_type:"client",subject_id:id(5),assigned_actor:"RIYA",
  state:"OPEN",human_takeover:false,revision:3,
  updated_at:new Date().toISOString()
 }];
 state.rows.leads=[{id:id(5),service_zone_id:id(8),
  google_place_id:"ChIJ8AUExamplePlaceID",location_verification_status:"verified",
  latitude:18.53,longitude:73.85
 }];
 state.rows.marketplace_service_zones=[{id:id(8),city_id:id(3),is_active:true}];
 const r=await riya.GET(req("riya-client-cases"));
 assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.ok,true);assert.equal(body.items.length,1);
 assert.equal(body.items[0].revision,3);assert.equal(body.items[0].canTakeover,false);
 const serialized=JSON.stringify(body);
 for(const p of ["google_place_id","latitude","longitude","phone","message_body"]){
  assert.ok(!serialized.includes('"'+p+'"'),"LEAKED_"+p);
 }
});
test("Riya wrong-city/invalid Google project location returns denial",async()=>{
 const tomorrow=new Date(Date.now()+86400000).toISOString();
 state.rows.vox_staff_object_scopes_v1=[{auth_user_id:id(1),
  scope_kind:"conversation",object_id:id(7),expires_at:tomorrow,revoked_at:null}];
 state.rows.communication_conversations=[{id:id(7),
  subject_type:"client",subject_id:id(5),assigned_actor:"RIYA",
  state:"OPEN",human_takeover:false,revision:1,updated_at:new Date().toISOString()}];
 state.rows.leads=[{id:id(5),service_zone_id:id(8),
  google_place_id:"typed text",location_verification_status:"unverified",
  latitude:18.53,longitude:73.85}];
 state.rows.marketplace_service_zones=[{id:id(8),city_id:id(3),is_active:true}];
 assert.equal((await riya.GET(req("riya-client-cases"))).status,403);
});
test("Core API never accepts owner-supplied filters or mutation verbs",async()=>{
 for(const [mod,p] of [[eod,"eod-source-status"],[riya,"riya-client-cases"]]){
  assert.equal((await mod.GET(new Request("https://core.quickfurno.in/api/vox/v1/"+p+"?city="+id(99)))).status,400);
  for(const verb of ["POST","PATCH","PUT","DELETE"])assert.equal(mod[verb]().status,405);
 }
});
