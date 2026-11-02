import test,{beforeEach} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const flags={};
const state={token:"ISOLATED_AAL2",origin:"https://staging-core.quickfurno.in",
 payload:null,status:200,requests:[],authChecks:0};
const notif=(n,read=false)=>({notificationId:id(n),eventKind:"BLOCK",revision:read?1:0,
 createdAt:"2026-10-16T10:00:00Z",read});
const list=()=>({ok:true,schema:"qf.vox.staff.work-notifications.inbox.v1",
 mode:"READ_ONLY",origin:"CORE_PERSISTED_WORK_EVENTS",boundedWindow:true,
 totalKnown:false,unreadTotalKnown:false,pushDeliveriesVerified:0,
 providerMessagesSent:0,unreadInWindow:1,records:[notif(2),notif(3,true)]});
const receipt=()=>({ok:true,schema:"qf.vox.staff.work-notifications.read-receipt.v1",
 notificationId:id(2),revision:1,readAt:"2026-10-16T10:00:00Z",
 providerMessagesSent:0,pushDeliveryNotClaimed:true,staffPrivilegesChanged:false});
const context=vm.createContext({process:{env:flags},Date,URL,Intl,AbortSignal,
 fetch:async(url,options)=>{
  state.requests.push({url,options});
  return {ok:state.status<400,status:state.status,
   json:async()=>state.payload??(options.method==="GET"?list():receipt())};
 }});
const src=readFileSync(new URL("../lib/staffNotifications.ts",import.meta.url),"utf8");
const code=ts.transpileModule(src,{compilerOptions:{
 target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext
}}).outputText;
const mod=new vm.SourceTextModule(code,{context,identifier:"STAFF_NOTIFY_WEB"});
const deps=new Map([["server-only",{}],
 ["./auth",{verifiedMfaSession:async()=>{state.authChecks++;return state.token;}}],
 ["./core",{origin:()=>state.origin}]]);
await mod.link(spec=>{
 const exports=deps.get(spec);if(!exports)throw Error("UNEXPECTED_DEPENDENCY:"+spec);
 return new vm.SyntheticModule(Object.keys(exports),function(){
  for(const [k,v] of Object.entries(exports))this.setExport(k,v);
 },{context,identifier:spec});
});
await mod.evaluate();
const api=mod.namespace;
beforeEach(()=>{
 Object.keys(flags).forEach(x=>delete flags[x]);
 flags.VOX_STAFF_PORTAL_ENABLED="staging";
 flags.VOX_TEAM_WORKSPACE_ENABLED="staging";
 flags.VOX_STAFF_VIEW_MODE="scoped";
 flags.VOX_STAFF_NOTIFICATIONS_UI_ENABLED="staging";
 Object.assign(state,{token:"ISOLATED_AAL2",origin:"https://staging-core.quickfurno.in",
  payload:null,status:200,requests:[],authChecks:0});
});
test("four browser stage gates must be explicitly enabled before Auth or fetch",async()=>{
 for(const key of ["VOX_STAFF_PORTAL_ENABLED","VOX_TEAM_WORKSPACE_ENABLED",
  "VOX_STAFF_NOTIFICATIONS_UI_ENABLED"]){
  flags[key]="off";
  const r=await api.fetchStaffNotifications();
  assert.equal(r.status,503);assert.equal(state.authChecks,0);
  assert.equal(state.requests.length,0);flags[key]="staging";
 }
 flags.VOX_STAFF_VIEW_MODE="owner";
 assert.equal((await api.fetchStaffNotifications()).status,503);
});
test("verified Staff AAL2 and pinned Core origin required",async()=>{
 state.token=null;
 assert.equal((await api.fetchStaffNotifications()).status,401);
 assert.equal(state.requests.length,0);
 state.token="ISOLATED_AAL2";state.origin=null;
 assert.equal((await api.fetchStaffNotifications()).status,503);
 assert.equal(state.requests.length,0);
});
test("private inbox strictly reflects Core persisted events without claiming push",async()=>{
 const r=await api.fetchStaffNotifications();assert.equal(r.ok,true);
 assert.equal(r.mode,"IN_APP_ONLY");assert.equal(r.unreadTotalKnown,false);
 assert.equal(r.totalKnown,false);assert.equal(r.unreadInWindow,1);
 assert.equal(r.pushDeliveriesVerified,0);
 assert.equal(r.records[0].eventKind,"BLOCK");
 assert.equal(state.requests.length,1);
 const call=state.requests[0];
 assert.equal(call.url,"https://staging-core.quickfurno.in/api/vox/v1/staff-notifications");
 assert.equal(call.options.method,"GET");
 assert.equal(call.options.cache,"no-store");
 assert.equal(call.options.redirect,"error");
 assert.equal(call.options.headers.authorization,"Bearer ISOLATED_AAL2");
});
test("unexpected PII, fake unread totals, deliveries and fake complete window denied",async()=>{
 const base=list();
 for(const value of [
  {...base,phone:"1234"},
  {...base,unreadTotalKnown:true},
  {...base,totalKnown:true},
  {...base,pushDeliveriesVerified:1},
  {...base,providerMessagesSent:1},
  {...base,unreadInWindow:2},
  {...base,records:[{...notif(2),customerName:"private"}]},
  {...base,records:[{...notif(2),read:true}]},
  {...base,records:[notif(2),notif(2)]},
  {...base,records:Array.from({length:26},(_,i)=>notif(i+10))}
 ]){
  state.payload=value;
  assert.equal((await api.fetchStaffNotifications()).status,503);
 }
});
test("notification ID and one-use nonce only for read receipts",async()=>{
 const r=await api.markStaffNotificationRead(id(2),id(55));
 assert.equal(r.ok,true);assert.equal(r.pushDeliveryNotClaimed,true);
 const req=state.requests[0];assert.equal(req.options.method,"POST");
 assert.deepEqual(JSON.parse(req.options.body),{
  notificationId:id(2),nonce:id(55),expectedRevision:0
 });
});
test("invalid read ID, forged receipt, fabricated push or extra content denied",async()=>{
 assert.equal((await api.markStaffNotificationRead("bad",id(44))).status,400);
 assert.equal((await api.markStaffNotificationRead(id(2),"bad")).status,400);
 for(const x of [
  {...receipt(),notificationId:id(8)},
  {...receipt(),pushDeliveryNotClaimed:false},
  {...receipt(),providerMessagesSent:1},
  {...receipt(),role:"admin"},
  {...receipt(),revision:0}
 ]){
  state.payload=x;
  assert.equal((await api.markStaffNotificationRead(id(2),id(55))).status,503);
 }
});
test("Core forbidden and stale state cannot become positive receipts",async()=>{
 for(const status of [401,403,409,500]){
  state.status=status;
  const r=await api.fetchStaffNotifications();
  assert.equal(r.ok,false);assert.equal(r.status,status===500?503:status);
 }
});
test("browser BFF requires Origin+Host CSRF and cannot choose recipient",()=>{
 const file=readFileSync(new URL("../app/api/staff-notifications/route.ts",import.meta.url),"utf8");
 assert.match(file,/allowedOrigin\(request\)/);
 assert.match(file,/Object\.keys\(body\)\.sort\(\)/);
 assert.match(file,/FILTER_DENIED/);
 assert.match(file,/METHOD_NOT_ALLOWED/);
 assert.doesNotMatch(file,/serviceRoleKey|SUPABASE_SERVICE_ROLE_KEY|sendPush|sendWhatsApp/);
});
test("Staff page is server-auth, bounded and calls only read receipt from UI",()=>{
 const page=readFileSync(new URL("../app/team/notifications/page.tsx",import.meta.url),"utf8");
 const ui=readFileSync(new URL("../app/team/notifications/MarkRead.tsx",import.meta.url),"utf8");
 const home=readFileSync(new URL("../app/team/page.tsx",import.meta.url),"utf8");
 assert.match(page,/fetchStaffNotifications/);
 assert.match(page,/unreadInWindow/);
 assert.match(page,/not the total unread/);
 assert.match(page,/Notification inbox is locked/);
 assert.match(home,/href:"\/team\/notifications"/);
 assert.match(ui,/\/api\/staff-notifications/);
 assert.match(ui,/crypto\.randomUUID\(\)/);
 assert.doesNotMatch(page,/clientPhone|access_token|service_role/);
});
