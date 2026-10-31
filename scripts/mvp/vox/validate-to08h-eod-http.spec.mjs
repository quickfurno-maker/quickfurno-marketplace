// VOX-08H isolated in-memory execution of the REAL TypeScript route body.
// Auth/DB are deliberate test stubs: NEVER classify as real Supabase MFA E2E.
import test,{beforeEach} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {selectCurrentEodReferences,verifyCurrentEodCanonicalProof}
 from "../../../contracts/vox/currentEodCanonicalProof.mjs";
import {projectCurrentCoreWorkEod}
 from "../../../contracts/vox/coreWorkEodPreview.mjs";
import {unchangedAuthorizedStaffScope}
 from "../../../contracts/vox/rc1CurrentStaffScope.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const SCOPE={userId:id(1),teamId:id(2),cityId:id(3),role:"support_agent",
 canReadContent:true,canMutate:false,prospectIds:[id(10)],vendorIds:[id(11)],
 supportThreadIds:[id(12)],verifiedDepartments:[],conversationIds:[]};
const DAILY="2026-10-16";
const FLAG_NAMES=["VOX_STAFF_READ_ENABLED","VOX_STAFF_GRANTS_ENABLED","VOX_DEPARTMENT_ENFORCEMENT_ENABLED",
 "VOX_WORK_QUEUE_READ_ENABLED","VOX_EOD_PREVIEW_ENABLED"];
class FixedDate extends Date {
 constructor(...args){super(...(args.length?args:["2026-10-16T10:00:00.000Z"]));}
 static now(){return Date.parse("2026-10-16T10:00:00.000Z");}
}
const data=()=>({
 vox_work_events_candidate_v1:[{id:id(44),work_item_id:id(33),actor_id:SCOPE.userId,
  event_type:"START",from_revision:1,to_revision:2,created_at:"2026-10-16T07:00:00Z"}],
 vox_work_items_candidate_v1:[{id:id(33),team_id:SCOPE.teamId,city_id:SCOPE.cityId,
  source_kind:"support_thread",source_id:id(12),related_vendor_id:id(11),revision:2}],
 aarohi_prospects:[],
 vendors:[{id:id(11),service_zone_id:id(21)}],
 marketplace_service_zones:[{id:id(21),city_id:SCOPE.cityId,is_active:true}],
 vendor_support_threads:[{id:id(12),vendor_id:id(11)}]
});
const state={scope:{...SCOPE},tables:data(),calls:[],flags:{},fails:new Set(),authCalls:0};
function reset(){
 state.scope={...SCOPE};state.tables=data();state.calls=[];state.fails=new Set();
 state.authCalls=0;state.flags=Object.fromEntries(FLAG_NAMES.map(x=>[x,"staging"]));
}
function fakeDB(){
 return {from(table){
  let rows=state.tables[table],filters=[],ordering=null,cap=null;
  if(!Array.isArray(rows))throw Error("UNEXPECTED_SOURCE_TABLE");
  return {
   select(){return this;},
   eq(key,val){filters.push(row=>row[key]===val);return this;},
   in(key,vals){filters.push(row=>vals.includes(row[key]));return this;},
   gte(key,val){filters.push(row=>row[key]>=val);return this;},
   lt(key,val){filters.push(row=>row[key]<val);return this;},
   is(key,val){filters.push(row=>row[key]===val);return this;},
   order(key,{ascending}={}){ordering={key,ascending};return this;},
   limit(n){cap=n;return this;},
   then(onFulfilled,onRejected){
    state.calls.push({table,cap,filters:filters.length});
    if(state.fails.has(table))return Promise.resolve({data:null,error:{code:"OFFLINE_MOCK"}}).then(onFulfilled,onRejected);
    let selected=rows.filter(r=>filters.every(fn=>fn(r)));
    if(ordering)selected=selected.sort((a,b)=>ordering.ascending?
      String(a[ordering.key]).localeCompare(String(b[ordering.key])):
      String(b[ordering.key]).localeCompare(String(a[ordering.key])));
    if(cap!==null)selected=selected.slice(0,cap);
    return Promise.resolve({data:selected,error:null}).then(onFulfilled,onRejected);
   }
  };
 }};
}
const env=new Proxy({}, {get(_target,key){return state.flags[key]},set(_target,key,val){
 state.flags[key]=val;return true;
}});
const ctx=vm.createContext({process:{env},URL,Response,Request,Date:FixedDate,Intl});
const src=readFileSync(new URL("../../../app/api/vox/v1/eod-preview/route.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(src,{compilerOptions:{
 module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022
}}).outputText;
const route=new vm.SourceTextModule(compiled,{context:ctx,identifier:"VOX08H_REAL_ROUTE_SOURCE"});
const exportsBySpecifier=new Map([
 ["server-only",{}],
 ["@/lib/supabase",{adminClient:fakeDB}],
 ["@/services/vox/verifiedScopedStaff",{
  getVerifiedScopedStaff:async header=>{
   state.authCalls++;
   return header==="Bearer TEST_ONLY" ? state.scope : null;
  }
 }],
 ["@/contracts/vox/coreWorkEodPreview.mjs",{projectCurrentCoreWorkEod}],
 ["@/contracts/vox/rc1CurrentStaffScope.mjs",{unchangedAuthorizedStaffScope}],
 ["@/contracts/vox/currentEodCanonicalProof.mjs",{
  selectCurrentEodReferences,verifyCurrentEodCanonicalProof
 }]
]);
await route.link(specifier=>{
 const e=exportsBySpecifier.get(specifier);
 if(!e)throw Error("UNEXPECTED_REAL_ROUTE_IMPORT:"+specifier);
 return new vm.SyntheticModule(Object.keys(e),function(){
  for(const [k,val] of Object.entries(e))this.setExport(k,val);
 },{context:ctx,identifier:specifier});
});
await route.evaluate();
const api=route.namespace;
const request=(path="/api/vox/v1/eod-preview",header="Bearer TEST_ONLY")=>
 new Request("https://staging-core.quickfurno.in"+path,{headers:{authorization:header}});
beforeEach(reset);
test("all four staging-only feature flags are required before Auth or database",async()=>{
 for(const name of FLAG_NAMES){
  state.flags[name]="off";
  const r=await api.GET(request());
  assert.equal(r.status,503);assert.equal((await r.json()).error,"EOD_PREVIEW_DISABLED");
  assert.equal(state.authCalls,0);assert.equal(state.calls.length,0);
  state.flags[name]="staging";
 }
});
test("genuine route function returns ONLY partial self EOD from mocked verified Core inputs",async()=>{
 const response=await api.GET(request());
 assert.equal(response.status,200);
 const doc=await response.json();
 assert.equal(doc.ok,true);assert.equal(doc.businessDate,DAILY);
 assert.equal(doc.completeness,"PARTIAL_UNVERIFIED_TOTAL");
 assert.equal(doc.source,"CORE_WORK_LEDGER_ONLY");
 assert.equal(doc.counts.starts,1);
 assert.equal(doc.eventsIncluded,1);
 assert.equal(doc.canSubmit,false);assert.equal(doc.canExport,false);
 assert.equal(doc.providerMessagesSent,0);assert.equal(doc.actionsEnabled,false);
 assert.equal(doc.sourceWatermark,"UNAVAILABLE");
 assert.equal(response.headers.get("cache-control"),"private, no-store, max-age=0");
 for(const secret of [SCOPE.userId,id(11),id(12),"vendor_id","phone","reason"])
  assert.equal(JSON.stringify(doc).includes(secret),false);
 assert.deepEqual(state.calls.map(x=>x.table),[
  "vox_work_events_candidate_v1","vox_work_items_candidate_v1",
  "vendors","marketplace_service_zones","vendor_support_threads"
 ]);
 assert.equal(state.calls[0].cap,101);
});
test("GET rejects client date/city overrides without touching Auth",async()=>{
 const r=await api.GET(request("/api/vox/v1/eod-preview?date=2025-01-01&city=foreign"));
 assert.equal(r.status,400);assert.equal(state.calls.length,0);
 assert.equal(state.authCalls,0);
});
test("AAL1, revoked or foreign Staff cannot reach the Core database",async()=>{
 for(const bad of [null,{...SCOPE,canReadContent:false},
  {...SCOPE,canMutate:true},{...SCOPE,role:"team_leader"}]){
  state.scope=bad;
  const r=await api.GET(request());assert.equal(r.status,403);
  assert.equal(state.calls.length,0);
 }
 const r=await api.GET(request("/api/vox/v1/eod-preview","Bearer INVALID"));
 assert.equal(r.status,403);
});
test("101 real actor events return 503, NEVER a silent first-page 'total'",async()=>{
 state.tables.vox_work_events_candidate_v1=Array.from({length:101},(_,n)=>({
  id:id(n+600),work_item_id:id(33),actor_id:SCOPE.userId,
  event_type:"START",from_revision:n,to_revision:n+1,created_at:"2026-10-16T07:00:00Z"
 }));
 const r=await api.GET(request());
 assert.equal(r.status,503);
 assert.equal((await r.json()).error,"EOD_EVENT_WINDOW_UNVERIFIED");
 assert.deepEqual(state.calls.map(x=>x.table),["vox_work_events_candidate_v1"]);
});
test("a foreign-city event source cannot be counted, and no canonical objects are read",async()=>{
 state.tables.vox_work_items_candidate_v1[0].city_id=id(98);
 const r=await api.GET(request());
 assert.equal(r.status,503);assert.equal((await r.json()).error,"EOD_CORE_WORK_SCOPE_UNVERIFIED");
 assert.deepEqual(state.calls.map(x=>x.table),[
  "vox_work_events_candidate_v1","vox_work_items_candidate_v1"]);
});
test("revoked vendor or support thread grants reject before further canonical SELECTs",async()=>{
 for(const mutated of [{vendorIds:[]},{supportThreadIds:[]}]){
  state.scope={...SCOPE,...mutated};state.calls=[];
  const r=await api.GET(request());
  assert.equal(r.status,403);assert.equal((await r.json()).error,"EOD_OBJECT_SCOPE_DENIED");
  assert.equal(state.calls.length,2);
 }
});
test("inactive service zone, foreign support vendor and missing vendor all 503",async()=>{
 for(const tableMutation of [
  t=>{t.marketplace_service_zones[0].is_active=false;},
  t=>{t.vendor_support_threads[0].vendor_id=id(99);},
  t=>{t.vendors=[];}
 ]){
  state.tables=data();state.calls=[];tableMutation(state.tables);
  const r=await api.GET(request());
  assert.equal(r.status,503);
  assert.equal((await r.json()).error,"EOD_CANONICAL_PROOF_DENIED");
 }
});
test("malformed repeat work-row proof cannot leak a partial report",async()=>{
 state.tables.vox_work_items_candidate_v1.push({...state.tables.vox_work_items_candidate_v1[0]});
 const r=await api.GET(request());assert.equal(r.status,503);
 assert.equal((await r.json()).error,"EOD_CORE_WORK_SCOPE_UNVERIFIED");
});
test("staging not installed and failed source reads return 503 rather than guessed counts",async()=>{
 for(const table of ["vox_work_events_candidate_v1","vox_work_items_candidate_v1",
  "vendors","marketplace_service_zones","vendor_support_threads"]){
  state.fails=new Set([table]);state.calls=[];
  const r=await api.GET(request());
  assert.equal(r.status,503,"table "+table);
 }
});
test("empty work event ledger is safely partial and needs no source table reads",async()=>{
 state.tables.vox_work_events_candidate_v1=[];
 const r=await api.GET(request());assert.equal(r.status,200);
 const doc=await r.json();assert.equal(doc.eventsIncluded,0);
 assert.equal(doc.completeness,"PARTIAL_UNVERIFIED_TOTAL");
 assert.deepEqual(state.calls.map(x=>x.table),["vox_work_events_candidate_v1"]);
});
test("unrelated actor and next-day events never enter another Staff EOD",async()=>{
 state.tables.vox_work_events_candidate_v1=[
  {...data().vox_work_events_candidate_v1[0],actor_id:id(8)},
  {...data().vox_work_events_candidate_v1[0],id:id(48),created_at:"2026-10-16T19:00:00Z"}
 ];
 const r=await api.GET(request());assert.equal(r.status,200);
 const doc=await r.json();assert.equal(doc.eventsIncluded,0);
});
test("real route POST PUT PATCH DELETE always 405 even with staging flags ON",async()=>{
 for(const verb of ["POST","PUT","PATCH","DELETE"]){
  const r=api[verb]();assert.equal(r.status,405);
  assert.equal((await r.json()).error,"READ_ONLY");
 }
 assert.equal(state.calls.length,0);
});
