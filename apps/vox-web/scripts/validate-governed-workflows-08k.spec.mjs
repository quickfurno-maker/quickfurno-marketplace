import test,{beforeEach} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const fixed="2026-10-16";
class FixedDate extends Date{
 constructor(...args){super(...(args.length?args:["2026-10-16T08:00:00.000Z"]));}
 static now(){return Date.parse("2026-10-16T08:00:00.000Z");}
}
const flags={};
const state={token:"SIMULATED_AAL2",origin:"https://staging-core.quickfurno.in",
 status:200,payload:null,requests:[],authChecks:0};
const reply=(path,method)=>{
 if(path.endsWith("staff-chat")){
  return method==="POST"?{
   ok:true,schema:"qf.vox.staff.team.chat.receipt.v1",
   messageId:uuid(8),createdAt:"2026-10-16T08:00:00Z",
   effect:"INTERNAL_TEAM_MESSAGE_ONLY",externalMessagesSent:0,
   agentConversationChanged:false,staffPrivilegesChanged:false
  }:{ok:true,schema:"qf.vox.staff.team.chat.preview.v1",mode:"INTERNAL_ONLY",
   boundedWindow:true,totalKnown:false,externalMessagesSent:0,
   messages:[{messageId:uuid(8),staffRef:"STAFF-00000000",isMine:true,
    body:"Hello Core",createdAt:"2026-10-16T08:00:00Z"}]};
 }
 if(path.endsWith("eod-submissions")){
  return method==="POST"?{ok:true,schema:"qf.vox.eod.submission.receipt.v1",
   reportId:uuid(10),state:"PENDING_REVIEW",revision:0,eventCount:2,
   completeness:"PARTIAL_UNVERIFIED_TOTAL",externalMessagesSent:0,
   staffPrivilegesChanged:false}:{ok:true,schema:"qf.vox.eod.my-submissions.v1",
   mode:"READ_ONLY",completeness:"PARTIAL_UNVERIFIED_TOTAL",totalKnown:false,
   records:[{reportId:uuid(10),businessDate:fixed,eventCount:2,
    state:"PENDING_REVIEW",revision:0}]};
 }
 return method==="POST"?{ok:true,schema:"qf.vox.eod.tl.receipt.v1",
  reportId:uuid(10),state:"ACKNOWLEDGED",revision:1,source:"PARTIAL_CORE_WORK_ONLY",
  providerMessagesSent:0,staffPrivilegesChanged:false}:
  {ok:true,schema:"qf.vox.eod.tl.queue.v1",mode:"READ_ONLY",
   actionsRequireCurrentCoreRpc:true,totalKnown:false,
   pending:[{reportId:uuid(10),staffRef:"STAFF-00000000",businessDate:fixed,
    eventCount:2,revision:0,completeness:"PARTIAL_UNVERIFIED_TOTAL"}]};
};
const ctx=vm.createContext({process:{env:flags},Date:FixedDate,Intl,URL,
 AbortSignal,fetch:async(url,options)=>{
  state.requests.push({url,options});
  return {ok:state.status<400,status:state.status,
   json:async()=>state.payload??reply(url,options.method)};
 }});
const source=readFileSync(new URL("../lib/teamWorkflow.ts",import.meta.url),"utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,
 target:ts.ScriptTarget.ES2022}}).outputText;
const mod=new vm.SourceTextModule(code,{context:ctx,identifier:"teamWorkflow"});
const deps=new Map([["server-only",{}],
 ["./auth",{verifiedMfaSession:async()=>{state.authChecks++;return state.token;}}],
 ["./core",{origin:()=>state.origin}]]);
await mod.link(spec=>{
 const m=deps.get(spec);if(!m)throw Error("UNEXPECTED_IMPORT:"+spec);
 return new vm.SyntheticModule(Object.keys(m),function(){
  for(const [k,v] of Object.entries(m))this.setExport(k,v);
 },{context:ctx,identifier:spec});
});
await mod.evaluate();
const api=mod.namespace;
beforeEach(()=>{
 Object.keys(flags).forEach(k=>delete flags[k]);
 for(const flag of ["VOX_STAFF_PORTAL_ENABLED","VOX_TEAM_WORKSPACE_ENABLED",
  "VOX_TEAM_CHAT_UI_ENABLED","VOX_EOD_SUBMIT_UI_ENABLED",
  "VOX_EOD_TL_REVIEW_UI_ENABLED"])flags[flag]="staging";
 flags.VOX_STAFF_VIEW_MODE="scoped";
 Object.assign(state,{token:"SIMULATED_AAL2",
  origin:"https://staging-core.quickfurno.in",status:200,payload:null,
  requests:[],authChecks:0});
});
test("default-off Staff portal, team mode and per-feature flag prevent any fetch",async()=>{
 for(const flag of ["VOX_STAFF_PORTAL_ENABLED","VOX_TEAM_WORKSPACE_ENABLED",
  "VOX_TEAM_CHAT_UI_ENABLED"]){
  flags[flag]="off";
  const r=await api.fetchTeamChat();assert.equal(r.status,503);
  assert.equal(state.authChecks,0);assert.equal(state.requests.length,0);
  flags[flag]="staging";
 }
 flags.VOX_STAFF_VIEW_MODE="owner";
 assert.equal((await api.fetchMyEodSubmissions()).status,503);
 flags.VOX_STAFF_VIEW_MODE="scoped";
 flags.VOX_EOD_SUBMIT_UI_ENABLED="off";
 assert.equal((await api.submitMyPartialEod(uuid(20))).status,503);
 flags.VOX_EOD_TL_REVIEW_UI_ENABLED="off";
 assert.equal((await api.fetchTlEodQueue()).status,503);
});
test("unverified MFA and missing approved pinned Core origin fail before network",async()=>{
 state.token=null;
 assert.equal((await api.fetchTeamChat()).status,401);
 assert.equal(state.requests.length,0);
 state.token="SIMULATED_AAL2";state.origin=null;
 assert.equal((await api.fetchTeamChat()).status,503);
 assert.equal(state.requests.length,0);
});
test("private team chat GET returns only strictly verified 25-window",async()=>{
 const r=await api.fetchTeamChat();
 assert.equal(r.ok,true);assert.equal(r.mode,"INTERNAL_ONLY");
 assert.equal(r.totalKnown,false);assert.equal(r.messages[0].body,"Hello Core");
 assert.equal(state.requests.length,1);
 assert.equal(state.requests[0].url,"https://staging-core.quickfurno.in/api/vox/v1/staff-chat");
 assert.equal(state.requests[0].options.method,"GET");
 assert.equal(state.requests[0].options.cache,"no-store");
 assert.equal(state.requests[0].options.redirect,"error");
 assert.equal(state.requests[0].options.headers.authorization,"Bearer SIMULATED_AAL2");
});
test("chat rejects transcript/recipient additions and forged external delivery",async()=>{
 const b=reply("staff-chat","GET");
 for(const x of [
  {...b,phone:"1234"},{...b,totalKnown:true},
  {...b,externalMessagesSent:1},
  {...b,messages:[{...b.messages[0],recipientId:uuid(9)}]},
  {...b,messages:[{...b.messages[0],body:"control\ncharacter"}]},
  {...b,messages:[...b.messages,...b.messages]},
  {...b,messages:Array.from({length:26},()=>b.messages[0])}
 ]){
  state.payload=x;assert.equal((await api.fetchTeamChat()).status,503);
 }
});
test("chat POST admits only text and nonce and rejects provider-sends in receipt",async()=>{
 let r=await api.sendTeamChat("Internal update",uuid(20));
 assert.equal(r.ok,true);assert.equal(r.effect,"INTERNAL_TEAM_MESSAGE_ONLY");
 const payload=JSON.parse(state.requests[0].options.body);
 assert.deepEqual(payload,{body:"Internal update",nonce:uuid(20)});
 state.requests=[];state.payload={...reply("staff-chat","POST"),externalMessagesSent:1};
 r=await api.sendTeamChat("Internal update",uuid(20));
 assert.equal(r.status,503);
 for(const bad of ["", " a","x".repeat(501),"bad\ntext"])
  assert.equal((await api.sendTeamChat(bad,uuid(20))).status,400);
});
test("employee EOD POST derives India date and accepts only nonce",async()=>{
 const r=await api.submitMyPartialEod(uuid(21));
 assert.equal(r.ok,true);
 assert.equal(r.completeness,"PARTIAL_UNVERIFIED_TOTAL");
 const call=state.requests[0];
 assert.equal(call.options.method,"POST");
 assert.deepEqual(JSON.parse(call.options.body),{nonce:uuid(21),businessDate:fixed});
});
test("EOD GET strictly verifies partial-only count and row state",async()=>{
 assert.equal((await api.fetchMyEodSubmissions()).ok,true);
 const b=reply("eod-submissions","GET");
 for(const x of [
  {...b,complete:true},
  {...b,completeness:"COMPLETE"},
  {...b,records:[{...b.records[0],staffId:uuid(1)}]},
  {...b,records:[{...b.records[0],eventCount:101}]},
  {...b,records:[{...b.records[0],state:"ACKNOWLEDGED",revision:0}]}
 ]){
  state.payload=x;assert.equal((await api.fetchMyEodSubmissions()).status,503);
 }
});
test("TL pending queue bounded, strict and cannot claim full all-source totals",async()=>{
 const r=await api.fetchTlEodQueue();assert.equal(r.ok,true);
 assert.equal(r.pending.length,1);assert.equal(r.totalKnown,false);
 state.payload={...reply("eod-reviews","GET"),pending:Array.from({length:17},
  ()=>reply("eod-reviews","GET").pending[0])};
 assert.equal((await api.fetchTlEodQueue()).status,503);
});
test("TL action cannot accept target/team/role and checks receipt",async()=>{
 let r=await api.decideTlEod(uuid(10),uuid(22),"ACKNOWLEDGED");
 assert.equal(r.ok,true);
 assert.deepEqual(JSON.parse(state.requests[0].options.body),{
  reportId:uuid(10),nonce:uuid(22),decision:"ACKNOWLEDGED",expectedRevision:0});
 assert.equal((await api.decideTlEod(uuid(10),uuid(22),"APPROVED")).status,400);
 state.payload={...reply("eod-reviews","POST"),reportId:uuid(77)};
 assert.equal((await api.decideTlEod(uuid(10),uuid(22),"ACKNOWLEDGED")).status,503);
});
test("Core 403/409 and 5xx fail closed for all three transport families",async()=>{
 for(const code of [401,403,409,500]){
  state.status=code;
  const r=await api.fetchTeamChat();assert.equal(r.ok,false);
  assert.equal(r.status,code===500?503:code);
 }
});
test("web BFF POST requires pinned Origin, no browser-supplied target or impersonation",()=>{
 for(const route of ["team-chat","eod-submissions","eod-reviews"]){
  const text=readFileSync(new URL("../app/api/"+route+"/route.ts",import.meta.url),"utf8");
  assert.match(text,/allowedOrigin\(request\)/);
  assert.match(text,/request\.headers\.get\("content-type"\)/);
  assert.match(text,/Object\.keys\(v\)/);
  assert.match(text,/safeJson/);
  assert.match(text,/export function DELETE\(\)/);
  assert.doesNotMatch(text,/SUPABASE_SERVICE_ROLE_KEY|sendWhatsApp|clientPhone/);
 }
});
test("three operator pages are server scoped and never say full daily report",()=>{
 for(const name of ["chat","eod-submissions","eod-reviews"]){
  const text=readFileSync(new URL("../app/team/"+name+"/page.tsx",import.meta.url),"utf8");
  assert.match(text,/role="status"/);
  assert.match(text,/export const dynamic="force-dynamic"/);
  assert.match(text,/\.\.\/workflow\.css/);
 }
});
