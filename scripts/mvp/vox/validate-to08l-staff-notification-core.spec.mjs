import test,{beforeEach} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={userId:id(1),teamId:id(2),cityId:id(3),role:"support_agent",
 canReadContent:true,canMutate:false};
const flags={};
const state={scope:{...scope},authCalls:0,calls:[],error:null,rows:[]};
const known=(n,revision=0)=>({
 notification_id:id(n),event_kind:"BLOCK",revision,
 created_time:"2026-10-16T08:00:00Z"
});
const fixed=new Date("2026-10-16T08:00:00Z");
const context=vm.createContext({process:{env:flags},Response,Request,URL,Date});
const src=readFileSync(new URL("../../../app/api/vox/v1/staff-notifications/route.ts",import.meta.url),"utf8");
const transpiled=ts.transpileModule(src,{compilerOptions:{
 module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022
}}).outputText;
const mod=new vm.SourceTextModule(transpiled,{context,identifier:"CORE08L_ROUTE"});
const fakeDB=()=>({
 rpc(name,params){
  state.calls.push({name,params});
  return Promise.resolve({data:state.rows,error:state.error});
 }
});
const mocks=new Map([
 ["server-only",{}],
 ["@/lib/supabase",{adminClient:fakeDB}],
 ["@/services/vox/verifiedScopedStaff",{
  getVerifiedScopedStaff:async token=>{
   state.authCalls++;
   return token==="Bearer OFFLINE_AAL2"?state.scope:null;
  }
 }]
]);
await mod.link(spec=>{
 const entries=mocks.get(spec);if(!entries)throw Error("UNKNOWN_IMPORT:"+spec);
 return new vm.SyntheticModule(Object.keys(entries),function(){
  for(const [k,v] of Object.entries(entries))this.setExport(k,v);
 },{context,identifier:spec});
});
await mod.evaluate();
const api=mod.namespace;
const req=(path="/api/vox/v1/staff-notifications")=>new Request(
 "https://staging-core.quickfurno.in"+path,{
 headers:{authorization:"Bearer OFFLINE_AAL2"}
});
const post=(body)=>new Request("https://staging-core.quickfurno.in/api/vox/v1/staff-notifications",{
 method:"POST",headers:{authorization:"Bearer OFFLINE_AAL2",
 "content-type":"application/json"},body:JSON.stringify(body)
});
beforeEach(()=>{
 Object.keys(flags).forEach(k=>delete flags[k]);
 flags.VOX_STAFF_GRANTS_ENABLED="staging";
 flags.VOX_DEPARTMENT_ENFORCEMENT_ENABLED="staging";
 flags.VOX_STAFF_WORK_NOTIFICATIONS_ENABLED="staging";
 Object.assign(state,{scope:{...scope},authCalls:0,calls:[],error:null,
  rows:[known(44),known(45,1)]});
});
test("feature and Staff permission flags default fail-closed before Auth/RPC",async()=>{
 for(const flag of ["VOX_STAFF_GRANTS_ENABLED","VOX_DEPARTMENT_ENFORCEMENT_ENABLED",
  "VOX_STAFF_WORK_NOTIFICATIONS_ENABLED"]){
  flags[flag]="off";
  const r=await api.GET(req());assert.equal(r.status,503);
  assert.equal(state.calls.length,0);assert.equal(state.authCalls,0);
  flags[flag]="staging";
 }
});
test("authenticated current-staff Core inbox is a bounded partial feed, never push delivery",async()=>{
 const response=await api.GET(req());assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.ok,true);
 assert.equal(body.records.length,2);assert.equal(body.unreadInWindow,1);
 assert.equal(body.totalKnown,false);assert.equal(body.unreadTotalKnown,false);
 assert.equal(body.pushDeliveriesVerified,0);assert.equal(body.providerMessagesSent,0);
 assert.equal(body.records[0].read,false);assert.equal(body.records[1].read,true);
 assert.equal(state.calls[0].name,"qf_vox_staff_notification_inbox_v1");
 assert.equal(state.calls[0].params.p_actor,scope.userId);
 assert.equal(response.headers.get("cache-control"),"private, no-store, max-age=0");
});
test("Core GET cannot take a browser team, person, historical or city filter",async()=>{
 const r=await api.GET(req("/api/vox/v1/staff-notifications?recipientId="+id(99)));
 assert.equal(r.status,400);assert.equal(state.calls.length,0);assert.equal(state.authCalls,0);
});
test("no MFA or impersonated Admin bypasses the current Staff scope",async()=>{
 state.scope=null;
 assert.equal((await api.GET(req())).status,403);
 state.scope={...scope,role:"admin"};
 assert.equal((await api.GET(req())).status,403);
 state.scope={...scope,canMutate:true};
 assert.equal((await api.GET(req())).status,403);
 state.scope={...scope,canReadContent:false};
 assert.equal((await api.GET(req())).status,403);
 assert.equal(state.calls.length,0);
});
test("an excessive inbox refuses to fabricate a lower unread total",async()=>{
 state.rows=Array.from({length:26},(_,k)=>known(100+k));
 const r=await api.GET(req());assert.equal(r.status,503);
 assert.equal((await r.json()).error,"INBOX_WINDOW_UNVERIFIED");
});
test("duplicate, bad event, fake revision, malformed timestamps are denied",async()=>{
 for(const rows of [
  [known(1),known(1)],
  [{...known(1),event_kind:"WHATSAPP"}],
  [{...known(1),revision:2}],
  [{...known(1),notification_id:id(99).replace("4000","0000")}],
  [{...known(1),created_time:"invalid"}],
  [{...known(1),created_time:null}]
 ]){
  state.rows=rows;
  const r=await api.GET(req());assert.equal(r.status,503);
 }
});
test("read action uses exact verified actor and only nonce + event ID",async()=>{
 state.rows=[{notification_id:id(44),new_revision:1,
  read_time:"2026-10-16T08:00:00Z"}];
 const r=await api.POST(post({notificationId:id(44),expectedRevision:0,nonce:id(60)}));
 assert.equal(r.status,200);
 const body=await r.json();assert.equal(body.pushDeliveryNotClaimed,true);
 assert.equal(body.providerMessagesSent,0);
 assert.equal(state.calls[0].name,"qf_vox_staff_notification_mark_read_v1");
 assert.deepEqual(JSON.parse(JSON.stringify(state.calls[0].params)),{
  p_actor:scope.userId,p_notification:id(44),p_nonce:id(60),
  p_expected_revision:0
 });
});
test("no browser-controlled recipient, vendor, team, event or role is ever passed",async()=>{
 const extra=[{recipientId:id(9)},{teamId:id(2)},{eventId:id(1)},
  {actor:id(7)},{kind:"SMS"},{expectedRevision:1}];
 for(const value of extra){
  const payload={notificationId:id(44),expectedRevision:0,nonce:id(60),...value};
  const r=await api.POST(post(payload));assert.equal(r.status,400);
 }
 assert.equal(state.calls.length,0);assert.equal(state.authCalls,0);
});
test("failed RPC, forged receipt, stale action are always denied or unverifiable",async()=>{
 const cmd={notificationId:id(44),expectedRevision:0,nonce:id(60)};
 state.error={code:"DENIED"};
 assert.equal((await api.POST(post(cmd))).status,409);
 state.error=null;state.rows=[{notification_id:id(40),new_revision:1,
  read_time:"2026-10-16T08:00:00Z"}];
 assert.equal((await api.POST(post(cmd))).status,503);
});
test("only POST may update a read receipt, other methods are always 405",async()=>{
 for(const verb of ["PUT","PATCH","DELETE"]){
  const res=api[verb]();assert.equal(res.status,405);
 }
 assert.equal(state.calls.length,0);
});
test("route source has no message delivery, source mutation or service credentials",()=>{
 assert.match(src,/getVerifiedScopedStaff/);
 assert.match(src,/VOX_STAFF_WORK_NOTIFICATIONS_ENABLED/);
 assert.match(src,/qf_vox_staff_notification_inbox_v1/);
 assert.match(src,/qf_vox_staff_notification_mark_read_v1/);
 assert.doesNotMatch(src,/sendWhatsApp|sendPush|publishSms|SUPABASE_SERVICE_ROLE_KEY|\.insert\(/);
});
