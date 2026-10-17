import test,{beforeEach} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {canReadWriteTeamInternalChat} from "../../../contracts/vox/teamChatEligibility.mjs";
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={userId:uuid(1),teamId:uuid(2),cityId:uuid(3),role:"support_agent",
 canMutate:false,canReadContent:true,verifiedDepartments:["service_support"],
 prospectIds:[],vendorIds:[],supportThreadIds:[]};
const date="2026-10-16";
class FixedDate extends Date{
 constructor(...args){super(...(args.length?args:["2026-10-16T08:00:00.000Z"]));}
 static now(){return Date.parse("2026-10-16T08:00:00.000Z");}
}
const flags={};
const state={scope:{...scope},authCalls:0,calls:[],rpcData:[],rpcError:null,tables:{}};
const reset=()=>{
 Object.keys(flags).forEach(k=>delete flags[k]);
 for(const n of ["VOX_STAFF_GRANTS_ENABLED","VOX_DEPARTMENT_ENFORCEMENT_ENABLED",
 "VOX_EOD_SUBMISSIONS_ENABLED","VOX_EOD_TL_REVIEW_ENABLED","VOX_STAFF_TEAM_CHAT_ENABLED"])
  flags[n]="staging";
 state.scope={...scope};state.authCalls=0;state.calls=[];state.rpcError=null;
 state.rpcData=[];state.tables={
  vox_staff_eod_reports_candidate_v1:[{id:uuid(4),staff_id:uuid(5),team_id:scope.teamId,
   city_id:scope.cityId,business_date:date,event_count:1,state:"PENDING_REVIEW",
   revision:0,completeness:"PARTIAL_UNVERIFIED_TOTAL",source:"CORE_WORK_LEDGER_ONLY",
   created_at:"2026-10-16T05:00:00Z"}],
  vox_staff_team_messages_candidate_v1:[{id:uuid(6),team_id:scope.teamId,
   city_id:scope.cityId,sender_id:scope.userId,body:"Staff-only hello",
   created_at:"2026-10-16T05:00:00Z"}]
 };
};
reset();
const db=()=>({
 from(table){
  let rows=state.tables[table]??[],filters=[],limit=999;
  return {
   select(){return this;},
   eq(k,v){filters.push(x=>x[k]===v);return this;},
   neq(k,v){filters.push(x=>x[k]!==v);return this;},
   order(){return this;},
   limit(n){limit=n;return this;},
   then(done,fail){state.calls.push({type:"read",table,limit});
    return Promise.resolve({error:null,data:rows.filter(x=>filters.every(f=>f(x))).slice(0,limit)}).then(done,fail);}
  };
 },
 rpc(name,params){
  state.calls.push({type:"rpc",name,params});
  return Promise.resolve({data:state.rpcData,error:state.rpcError});
 }
});
const ctx=vm.createContext({process:{env:flags},Date:FixedDate,Intl,URL,
 Response,Request});
async function load(relative,short){
 const source=readFileSync(new URL("../../../app/api/vox/v1/"+relative+"/route.ts",import.meta.url),"utf8");
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,
  target:ts.ScriptTarget.ES2022}}).outputText;
 const m=new vm.SourceTextModule(js,{context:ctx,identifier:"route-"+short});
 const imports=new Map([
  ["server-only",{}],
  ["@/contracts/vox/teamChatEligibility.mjs",{canReadWriteTeamInternalChat}],
  ["@/lib/supabase",{adminClient:db}],
  ["@/services/vox/verifiedScopedStaff",{
   getVerifiedScopedStaff:async hdr=>{state.authCalls++;return hdr==="Bearer TEST_ONLY"?state.scope:null;}
  }]
 ]);
 await m.link(spec=>{const v=imports.get(spec);
  if(!v)throw Error("UNKNOWN_IMPORT_"+spec);
  return new vm.SyntheticModule(Object.keys(v),function(){
   for(const [k,val] of Object.entries(v))this.setExport(k,val);
  },{context:ctx,identifier:spec+"-"+short});
 });
 await m.evaluate();return m.namespace;
}
const submits=await load("eod-submissions","submit");
const reviews=await load("eod-reviews","review");
const chat=await load("staff-chat","chat");
const get=(p)=>new Request("https://staging-core.quickfurno.in/api/vox/v1/"+p,{
 headers:{authorization:"Bearer TEST_ONLY"}});
const post=(p,body)=>new Request("https://staging-core.quickfurno.in/api/vox/v1/"+p,{
 method:"POST",headers:{authorization:"Bearer TEST_ONLY",
 "content-type":"application/json"},body:JSON.stringify(body)});
beforeEach(reset);
test("all three Core route families disabled without independent flags and never query",async()=>{
 for(const name of ["VOX_EOD_SUBMISSIONS_ENABLED","VOX_EOD_TL_REVIEW_ENABLED",
   "VOX_STAFF_TEAM_CHAT_ENABLED"]){
  flags[name]="off";
  const ns=name==="VOX_EOD_SUBMISSIONS_ENABLED"?submits:
   name==="VOX_EOD_TL_REVIEW_ENABLED"?reviews:chat;
  const p=ns===submits?"eod-submissions":ns===reviews?"eod-reviews":"staff-chat";
  const r=await ns.GET(get(p));
  assert.equal(r.status,503);assert.equal(state.calls.length,0);
  assert.equal(state.authCalls,0);flags[name]="staging";
 }
});
test("employee partial EOD POST uses Core SQL events only, no client counts",async()=>{
 state.rpcData=[{report_id:uuid(4),report_state:"PENDING_REVIEW",
  report_revision:0,event_count:2}];
 const r=await submits.POST(post("eod-submissions",{businessDate:date,nonce:uuid(44)}));
 assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.completeness,"PARTIAL_UNVERIFIED_TOTAL");
 assert.equal(body.externalMessagesSent,0);
 assert.equal(body.staffPrivilegesChanged,false);
 assert.equal(state.calls[0].name,"qf_vox_eod_submit_candidate_v1");
 assert.equal(state.calls[0].params.p_actor,scope.userId);
 assert.equal(state.calls[0].params.p_business_date,date);
});
test("EOD rejects forged role/city/count fields and prior business day before Auth",async()=>{
 for(const extra of [{actor:uuid(99)},{teamId:uuid(99)},{eventCount:9},{counts:{claims:10}}]){
  const r=await submits.POST(post("eod-submissions",{businessDate:date,nonce:uuid(44),...extra}));
  assert.equal(r.status,400);
 }
 assert.equal((await submits.POST(post("eod-submissions",{
   businessDate:"2026-10-15",nonce:uuid(44)}))).status,400);
 assert.equal(state.calls.length,0);assert.equal(state.authCalls,0);
});
test("EOD denies AAL1, Team Leader and invalid RPC without fabricated receipt",async()=>{
 state.scope=null;
 assert.equal((await submits.POST(post("eod-submissions",{businessDate:date,nonce:uuid(44)}))).status,403);
 state.scope={...scope,role:"team_leader"};
 assert.equal((await submits.POST(post("eod-submissions",{businessDate:date,nonce:uuid(44)}))).status,403);
 state.scope={...scope};state.rpcError={code:"DENIED"};
 assert.equal((await submits.POST(post("eod-submissions",{businessDate:date,nonce:uuid(44)}))).status,409);
});
test("Staff cannot claim official complete report, read history only exact own rows",async()=>{
 state.tables.vox_staff_eod_reports_candidate_v1[0].staff_id=scope.userId;
 const r=await submits.GET(get("eod-submissions"));assert.equal(r.status,200);
 const doc=await r.json();
 assert.equal(doc.completeness,"PARTIAL_UNVERIFIED_TOTAL");
 assert.equal(doc.records.length,1);assert.equal(doc.totalKnown,false);
 assert.equal(JSON.stringify(doc).includes(scope.userId),false);
});
test("independent TL GET only exact team, excludes itself and PII",async()=>{
 state.scope={...scope,role:"team_leader"};
 const r=await reviews.GET(get("eod-reviews"));
 assert.equal(r.status,200);
 const payload=await r.json();
 assert.equal(payload.pending.length,1);
 assert.equal(payload.pending[0].staffRef,"STAFF-"+uuid(5).slice(0,8));
 assert.equal(payload.actionsRequireCurrentCoreRpc,true);
 assert.equal(JSON.stringify(payload).includes(uuid(5)),false);
});
test("only TL can review and SQL must revalidate independent human actor",async()=>{
 state.scope={...scope,role:"team_leader"};
 state.rpcData=[{report_id:uuid(4),report_state:"ACKNOWLEDGED",report_revision:1}];
 let r=await reviews.POST(post("eod-reviews",{reportId:uuid(4),
  expectedRevision:0,nonce:uuid(50),decision:"ACKNOWLEDGED"}));
 assert.equal(r.status,200);assert.equal((await r.json()).providerMessagesSent,0);
 assert.equal(state.calls[0].name,"qf_vox_eod_review_candidate_v1");
 assert.equal(state.calls[0].params.p_actor,scope.userId);
 state.scope={...scope,role:"support_agent"};
 r=await reviews.POST(post("eod-reviews",{reportId:uuid(4),
  expectedRevision:0,nonce:uuid(50),decision:"ACKNOWLEDGED"}));
 assert.equal(r.status,403);
});
test("TL review denies forged reviewer, target, authority, stale revision",async()=>{
 state.scope={...scope,role:"team_leader"};
 for(const extra of [{reviewerId:uuid(9)},{staffId:uuid(5)},{cityId:uuid(3)}]){
  assert.equal((await reviews.POST(post("eod-reviews",{
   reportId:uuid(4),expectedRevision:0,nonce:uuid(50),
   decision:"REJECTED",...extra}))).status,400);
 }
 assert.equal((await reviews.POST(post("eod-reviews",{
  reportId:uuid(4),expectedRevision:1,nonce:uuid(50),
  decision:"ACKNOWLEDGED"}))).status,400);
});
test("chat GET only current team, bounded and never external send",async()=>{
 const r=await chat.GET(get("staff-chat"));assert.equal(r.status,200);
 const doc=await r.json();
 assert.equal(doc.externalMessagesSent,0);
 assert.equal(doc.totalKnown,false);assert.equal(doc.messages.length,1);
 assert.equal(doc.messages[0].isMine,true);
 assert.equal(JSON.stringify(doc).includes(scope.userId),false);
});
test("Team Leader team-chat uses separate current grant flag without client access",async()=>{
 state.scope={...scope,role:"team_leader",canReadContent:false,
  verifiedDepartments:[]};
 flags.VOX_TL_INTERNAL_CHAT_ENABLED="off";
 assert.equal((await chat.GET(get("staff-chat"))).status,403);
 flags.VOX_TL_INTERNAL_CHAT_ENABLED="staging";
 const result=await chat.GET(get("staff-chat"));
 assert.equal(result.status,200);
 assert.equal(state.scope.canReadContent,false);
 assert.equal((await result.json()).externalMessagesSent,0);
});
test("chat POST derives actor and team from verified Core, receipt internal-only",async()=>{
 state.rpcData=[{message_id:uuid(66),created_time:"2026-10-16T09:00:00Z"}];
 const r=await chat.POST(post("staff-chat",{body:"Team update",nonce:uuid(70)}));
 assert.equal(r.status,201);
 const result=await r.json();
 assert.equal(result.effect,"INTERNAL_TEAM_MESSAGE_ONLY");
 assert.equal(result.externalMessagesSent,0);
 assert.equal(state.calls[0].params.p_team,scope.teamId);
 assert.equal(state.calls[0].params.p_actor,scope.userId);
});
test("chat forbidden recipients, agent sends, controls, tampered content and oversized",async()=>{
 for(const payload of [
 {body:"hi",nonce:uuid(8),recipientId:uuid(9)},
 {body:"hi",nonce:uuid(8),channel:"WHATSAPP"},
 {body:"hi",nonce:uuid(8),senderId:uuid(9)},
 {body:" ",nonce:uuid(8)},
 {body:" bad",nonce:uuid(8)},
 {body:"bad\ntext",nonce:uuid(8)},
 {body:"a".repeat(501),nonce:uuid(8)},
 ]){
  assert.equal((await chat.POST(post("staff-chat",payload))).status,400);
 }
 assert.equal(state.calls.length,0);assert.equal(state.authCalls,0);
});
test("chat denies unverified, admin/auditor, and failed stored procedure",async()=>{
 state.scope=null;
 assert.equal((await chat.POST(post("staff-chat",{body:"ok",nonce:uuid(90)}))).status,403);
 state.scope={...scope,role:"auditor"};
 assert.equal((await chat.POST(post("staff-chat",{body:"ok",nonce:uuid(90)}))).status,403);
 state.scope={...scope};state.rpcError={code:"DENIED"};
 assert.equal((await chat.POST(post("staff-chat",{body:"ok",nonce:uuid(90)}))).status,409);
});
test("all new mutating verbs that are not reviewed POST return 405",async()=>{
 for(const m of [submits,reviews,chat]){
  for(const op of ["PUT","PATCH","DELETE"]){
   const r=m[op]();assert.equal(r.status,405);
  }
 }
 assert.equal(state.calls.length,0);
});
test("no Core service_role secret or browser-supplied authority in handler source",()=>{
 for(const name of ["eod-submissions","eod-reviews","staff-chat"]){
  const src=readFileSync(new URL("../../../app/api/vox/v1/"+name+"/route.ts",import.meta.url),"utf8");
  assert.match(src,/getVerifiedScopedStaff/);
  assert.match(src,/VOX_STAFF_GRANTS_ENABLED/);
  assert.match(src,/VOX_DEPARTMENT_ENFORCEMENT_ENABLED/);
  assert.doesNotMatch(src,/SUPABASE_SERVICE_ROLE_KEY|sendWhatsApp|\bfetch\(/);
 }
});
