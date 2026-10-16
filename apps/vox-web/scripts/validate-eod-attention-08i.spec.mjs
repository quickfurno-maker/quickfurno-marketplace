import test,{beforeEach} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import vm from "node:vm";
import ts from "typescript";
const app=resolve(import.meta.dirname,".."),read=f=>readFileSync(resolve(app,f),"utf8");
const FIXED_DAY="2026-10-16";
const COUNTS={claims:1,starts:2,completions:3,blocks:4,
 approvalRequests:5,externalWaits:6,resumptions:7};
const valid=()=>({ok:true,schema:"qf.vox.eod.core-work.partial.v1",
 mode:"READ_ONLY",actionsEnabled:false,businessDate:FIXED_DAY,
 source:"CORE_WORK_LEDGER_ONLY",completeness:"PARTIAL_UNVERIFIED_TOTAL",
 sourceWatermark:"UNAVAILABLE",eventsIncluded:9,counts:{...COUNTS},
 canSubmit:false,canAcknowledge:false,canExport:false,providerMessagesSent:0});
const flags={};
const state={token:"FAKE_AAL2",base:"https://staging-core.quickfurno.in",
 status:200,payload:valid(),authCalls:0,fetchCalls:[]};
class FixedDate extends Date {
 constructor(...args){super(...(args.length?args:["2026-10-16T09:00:00Z"]));}
 static now(){return Date.parse("2026-10-16T09:00:00Z");}
}
const ctx=vm.createContext({process:{env:flags},Date:FixedDate,Intl,URL,
 AbortSignal,fetch:async(url,options)=>{
  state.fetchCalls.push({url,options});
  return {ok:state.status>=200&&state.status<300,status:state.status,
   json:async()=>state.payload};
 }});
const code=ts.transpileModule(read("lib/eod.ts"),{compilerOptions:{
 target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext
}}).outputText;
const mod=new vm.SourceTextModule(code,{context:ctx,identifier:"vox08i-eod"});
const stubs=new Map([
 ["server-only",{}],
 ["./auth",{verifiedMfaSession:async()=>{state.authCalls++;return state.token;}}],
 ["./core",{origin:()=>state.base}]
]);
await mod.link(importName=>{
 const e=stubs.get(importName);
 if(!e)throw Error("UNEXPECTED_WEB_IMPORT:"+importName);
 return new vm.SyntheticModule(Object.keys(e),function(){
  for(const [k,v] of Object.entries(e))this.setExport(k,v);
 },{context:ctx,identifier:importName});
});
await mod.evaluate();
const fetchEod=mod.namespace.fetchStaffEodPreview;
const toggleNames=["VOX_STAFF_PORTAL_ENABLED","VOX_TEAM_WORKSPACE_ENABLED",
 "VOX_EOD_PREVIEW_UI_ENABLED"];
function reset(){
 Object.keys(flags).forEach(k=>delete flags[k]);
 toggleNames.forEach(k=>flags[k]="staging");flags.VOX_STAFF_VIEW_MODE="scoped";
 state.token="FAKE_AAL2";state.base="https://staging-core.quickfurno.in";
 state.status=200;state.payload=valid();state.authCalls=0;state.fetchCalls=[];
}
beforeEach(reset);
test("all user-interface staging flags OFF individually stop Auth and Core request",async()=>{
 for(const key of toggleNames){
  flags[key]="off";const out=await fetchEod();
  assert.equal(out.ok,false);assert.equal(out.status,503);
  assert.equal(state.authCalls,0);assert.equal(state.fetchCalls.length,0);
  flags[key]="staging";
 }
});
test("owner and invalid Staff view modes cannot get daily employee reports",async()=>{
 for(const mode of ["owner","auditor",null,""]){
  flags.VOX_STAFF_VIEW_MODE=mode;
  const out=await fetchEod();assert.equal(out.ok,false);
  assert.equal(out.status,503);assert.equal(state.fetchCalls.length,0);
 }
});
test("missing verified MFA never reaches Core",async()=>{
 state.token=null;const out=await fetchEod();
 assert.equal(out.status,401);assert.equal(state.fetchCalls.length,0);
});
test("pinned Core origin is required and never derived from browser",async()=>{
 state.base=null;const out=await fetchEod();
 assert.equal(out.status,503);assert.equal(state.fetchCalls.length,0);
});
test("uses only existing Staff AAL2 session with private no-store Core GET",async()=>{
 const out=await fetchEod();assert.equal(out.ok,true);
 assert.equal(out.mode,"READ_ONLY");
 assert.equal(out.completeness,"PARTIAL_UNVERIFIED_TOTAL");
 assert.equal(out.businessDate,FIXED_DAY);
 assert.deepEqual({...out.counts},COUNTS);
 assert.equal(out.eventsIncluded,9);assert.equal(out.canSubmit,false);
 assert.equal(out.canExport,false);assert.equal(out.providerMessagesSent,0);
 assert.equal(state.fetchCalls.length,1);
 const call=state.fetchCalls[0];
 assert.equal(call.url,"https://staging-core.quickfurno.in/api/vox/v1/eod-preview");
 assert.equal(call.options.method,"GET");assert.equal(call.options.cache,"no-store");
 assert.equal(call.options.redirect,"error");
 assert.equal(call.options.headers.authorization,"Bearer FAKE_AAL2");
});
test("Core 403 stays forbidden; Core 500 fails closed",async()=>{
 for(const code of [401,403,500]){
  state.status=code;
  const out=await fetchEod();assert.equal(out.ok,false);
  assert.equal(out.status,code===500?503:code);
 }
});
test("reject unexpected fields, PII, fake complete source, or provider send",async()=>{
 for(const x of [
  {...valid(),extra:"PII_LEAK"},
  {...valid(),phone:"9999999999"},
  {...valid(),completeness:"COMPLETE"},
  {...valid(),source:"AAROHI"},
  {...valid(),actionsEnabled:true},
  {...valid(),canSubmit:true},
  {...valid(),canAcknowledge:true},
  {...valid(),providerMessagesSent:1},
  {...valid(),sourceWatermark:"FAKE_ID"},
 ]){
  state.payload=x;const out=await fetchEod();
  assert.equal(out.status,503,JSON.stringify(x).slice(0,80));
 }
});
test("reject noninteger or overflow counts, duplicate or missing fixed counter",async()=>{
 for(const counts of [
  {...COUNTS,claims:-1},{...COUNTS,starts:1.5},
  {...COUNTS,blocks:101},
  {...COUNTS,customerNames:3},
  {...COUNTS,approvalRequests:undefined},
  {...COUNTS,completions:NaN},
 ]){
  state.payload={...valid(),counts};
  assert.equal((await fetchEod()).status,503);
 }
});
test("reject stale IST date and event overflow instead of pretending total",async()=>{
 for(const body of [
  {...valid(),businessDate:"2026-10-15"},
  {...valid(),businessDate:"INVALID"},
  {...valid(),eventsIncluded:101},
  {...valid(),eventsIncluded:-1}
 ]){
  state.payload=body;assert.equal((await fetchEod()).status,503);
 }
});
test("Core response 200 without expected object fails closed",async()=>{
 for(const body of [null,[],true,"ok",{ok:true},valid().counts]){
  state.payload=body;
  const out=await fetchEod();assert.equal(out.status,503);
 }
});
test("Staff UI only renders sanitized aggregates; no browser bearer or Core URL",()=>{
 const page=read("app/team/daily-report/page.tsx");
 const api=read("app/api/eod-preview/route.ts");
 const core=read("lib/eod.ts");
 const home=read("app/team/page.tsx");
 assert.match(page,/fetchStaffEodPreview/);
 assert.match(page,/Partial Core work ledger only/);
 assert.match(page,/No activity figures are shown/);
 assert.match(page,/r\.counts\[m\.key\]/);
 assert.match(home,/href:"\/team\/daily-report"/);
 assert.match(core,/verifiedMfaSession/);
 assert.match(core,/origin\(\)/);
 assert.match(api,/fetchStaffEodPreview/);
 for(const verb of ["POST","PUT","PATCH","DELETE"])assert.ok(
  api.includes("export function "+verb+"(){return safeJson({ok:false,error:\"READ_ONLY\"},405);}"));
 assert.doesNotMatch(page,/access_token|SUPABASE_SERVICE_ROLE_KEY|staging-core\.quickfurno/);
});
const attentionCode=ts.transpileModule(read("lib/attention.ts"),{compilerOptions:{
 target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext
}}).outputText;
const attention=new vm.SourceTextModule(attentionCode,{context:ctx,identifier:"attention"});
await attention.link(()=>{throw Error("ATTENTION_NO_IMPORTS_ALLOWED")});
await attention.evaluate();
const project=attention.namespace.projectStaffAttention;
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const row=(n,state)=>({workItemId:uuid(n),kind:"prospect",state,revision:1,
 updatedAt:"2026-10-16T08:00:00Z",assignedToMe:state!=="NEW"});
test("attention uses bounded already-verified Core queue, no invented notifications",()=>{
 const result=project(["DONE","NEW","WAITING_EXTERNAL","WAITING_APPROVAL","BLOCKED"]
  .map((s,i)=>row(i+1,s)));
 assert.equal(result.ok,true);assert.equal(result.deliveredNotifications,0);
 assert.equal(result.totalKnown,false);
 assert.equal(result.completeness,"BOUNDED_NOT_TOTAL");
 assert.deepEqual(Array.from(result.items.map(x=>x.state)),
  ["BLOCKED","WAITING_APPROVAL","WAITING_EXTERNAL","NEW"]);
});
test("attention rejects forged, duplicate, excessive, foreign or invalid rows",()=>{
 for(const rows of [
  Array.from({length:26},(_,i)=>row(i+1,"BLOCKED")),
  [row(1,"BLOCKED"),row(1,"BLOCKED")],
  [{...row(1,"BLOCKED"),kind:"client"}],
  [{...row(1,"NEW"),assignedToMe:true}],
  [{...row(1,"BLOCKED"),revision:-1}],
  [{...row(1,"BLOCKED"),updatedAt:"fake-date"}],
  [{...row(1,"BLOCKED"),workItemId:"bad"}]
 ])assert.equal(project(rows).ok,false);
});
test("attention UI never claims delivered notification and always uses Core queue",()=>{
 const s=read("app/team/attention/page.tsx");
 assert.match(s,/fetchStaffWorkQueuePreview/);
 assert.match(s,/projectStaffAttention/);
 assert.match(s,/not.*delivered/);
 assert.match(s,/queue\.status===403/);
 assert.match(s,/No attention items appear/);
 assert.match(read("app/team/page.tsx"),/href:"\/team\/attention"/);
});
