import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdirSync,readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

// RC34 e-qa: Staff session dead-end. A Staff user without a verified AAL2
// session who opens any /team/** page was told to "sign in" but offered only
// "Return to Team Operations" -> "Return to VOX" -> splash -> sign-in. The
// pages now link /login directly on 401 (and only on 401).
//
// Compiles the genuine VOX Web pages and BFF routes with the genuine
// lib/auth.ts (real AAL2 logic), lib/core.ts, lib/workTransitions.ts,
// lib/staffNotifications.ts and lib/teamWorkflow.ts. Only Supabase Auth
// (@supabase/ssr), next/headers, next/link, next/navigation and outbound fetch
// are test doubles. The auth double is NOT a managed identity provider: no
// real Supabase, MFA enrolment, Core, DB, provider or network is touched.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const web=resolve(root,"apps/vox-web");
const fakes={
 "server-only":"",
 "next/headers":"export async function cookies(){return {getAll:()=>[],set(){}}}",
 "next/navigation":"export function useRouter(){return {refresh(){}}}",
 "next/link":"import {createElement} from 'react';"+
  "export default function Link({href,children,...p}){return createElement('a',{href,...p},children)}",
 "@supabase/ssr":"export function createServerClient(){const f=()=>globalThis.__rc34.auth;"+
  "return {auth:{getUser:async()=>f().user,getSession:async()=>f().session,"+
  "mfa:{getAuthenticatorAssuranceLevel:async()=>f().aal}}}}",
};
async function compile(entry,name){
 const outfile=resolve(root,"test-results/"+name);
 const stdin=typeof entry==="string"?undefined:{contents:entry.contents,resolveDir:web,loader:"tsx"};
 await build({...(stdin?{stdin}:{entryPoints:[resolve(root,entry)]}),
  bundle:true,platform:"node",format:"esm",target:"node20",outfile,logLevel:"silent",
  jsx:"automatic",loader:{".css":"empty"},
  banner:{js:"import {createRequire as __cr} from 'node:module';const require=__cr(import.meta.url);"},
  plugins:[{name:"rc34-fakes",setup(b){
   b.onResolve({filter:/^(server-only|next\/headers|next\/link|next\/navigation|@supabase\/ssr)$/},
    a=>({path:a.path,namespace:"rc34"}));
   b.onLoad({filter:/.*/,namespace:"rc34"},a=>({loader:"js",contents:fakes[a.path],resolveDir:web}));
  }}]});
 return import(pathToFileURL(outfile).href);
}
const render=(page)=>compile({contents:
 `import Page from "./app/${page}/page.tsx";`+
 `import {renderToStaticMarkup} from "react-dom/server";`+
 `export async function render(props){return renderToStaticMarkup(await Page(props))}`},
 "rc34-web-page-"+page.replace(/[^a-z]/gi,"-")+".mjs").then(m=>m.render);

const PAGES=["team","team/work-queue","team/attention","team/notifications","team/chat",
 "team/daily-report","team/eod-reviews","team/eod-submissions","team/admin/staff"];
const pages={};
for(const p of PAGES)pages[p]=await render(p);
const transitions=await compile("apps/vox-web/app/api/work-transitions/route.ts","rc34-web-work-transitions.mjs");
const notices=await compile("apps/vox-web/app/api/staff-notifications/route.ts","rc34-web-staff-notifications.mjs");
const chat=await compile("apps/vox-web/app/api/team-chat/route.ts","rc34-web-team-chat.mjs");

const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const ITEM=id(1),NOTICE=id(2),NONCE=id(3),TOKEN="staff-access-token";
const ORIGIN="http://127.0.0.1:3107";
const originalFetch=globalThis.fetch;
const oldEnv={...process.env};
const FLAGS=["VOX_STAFF_PORTAL_ENABLED","VOX_TEAM_WORKSPACE_ENABLED","VOX_WORK_QUEUE_UI_ENABLED",
 "VOX_WORK_ACTIONS_UI_ENABLED","VOX_WORK_ACTIONS_ENABLED","VOX_STAFF_NOTIFICATIONS_UI_ENABLED",
 "VOX_TEAM_CHAT_UI_ENABLED","VOX_EOD_PREVIEW_UI_ENABLED","VOX_EOD_SUBMIT_UI_ENABLED",
 "VOX_EOD_TL_REVIEW_UI_ENABLED","VOX_MULTI_DEPARTMENT_UI_ENABLED",
 "VOX_ADMIN_STAFF_DIRECTORY_UI_ENABLED","VOX_ADMIN_STAFF_TEAM_PICKER_UI_ENABLED"];
const ENV_KEYS=[...FLAGS,"VOX_STAFF_VIEW_MODE","VOX_CORE_ORIGIN","VOX_EXPECTED_ORIGIN",
 "VOX_SUPABASE_URL","VOX_SUPABASE_PUBLISHABLE_KEY"];
test.after(()=>{globalThis.fetch=originalFetch;
 for(const k of ENV_KEYS){if(oldEnv[k]===undefined)delete process.env[k];else process.env[k]=oldEnv[k];}});

function authState({aal="aal2",user=true,sessionUser="u1"}={}){
 return {user:user?{data:{user:{id:"u1"}},error:null}:{data:{user:null},error:{message:"x"}},
  session:{data:{session:{user:{id:sessionUser},access_token:TOKEN}}},
  aal:{data:{currentLevel:aal},error:null}};
}
function setup({auth={},core=async()=>{throw new TypeError("fetch failed")}}={}){
 for(const k of FLAGS)process.env[k]="staging";
 process.env.VOX_STAFF_VIEW_MODE="dual";
 process.env.VOX_CORE_ORIGIN="https://staging-core.quickfurno.in/";
 process.env.VOX_EXPECTED_ORIGIN=ORIGIN;
 process.env.VOX_SUPABASE_URL="http://auth.invalid";
 process.env.VOX_SUPABASE_PUBLISHABLE_KEY="fake";
 const state={auth:authState(auth),requests:[]};
 globalThis.__rc34=state;
 globalThis.fetch=async(url,opts)=>{state.requests.push({url:String(url),opts});return core(String(url),opts,state);};
 return state;
}
const LOGIN='href="/login"';

// ---- UI: 401 must offer sign-in; nothing else may ------------------------
test("every Staff page offers /login when the AAL2 session is missing",async()=>{
 for(const [label,auth] of [["AAL1",{aal:"aal1"}],["no user",{user:false}],["session mismatch",{sessionUser:"other"}]]){
  for(const p of PAGES){
   const s=setup({auth,core:async()=>Response.json({secret:"leak"})});
   const html=await pages[p]({});
   assert.ok(html.includes(LOGIN),p+" ("+label+") has no direct sign-in link");
   assert.equal(html.includes("leak"),false);
   assert.equal(s.requests.length,0,p+" ("+label+") must not call Core without a verified session");
  }
 }
});
test("403 / disabled / unavailable states never claim a sign-in problem",async()=>{
 for(const p of PAGES){
  for(const core of [async()=>Response.json({secret:"leak"},{status:403}),
   async()=>Response.json({secret:"leak"},{status:500}),
   async()=>{throw new TypeError("fetch failed")}]){
   setup({core});
   const html=await pages[p]({});
   assert.equal(html.includes(LOGIN),false,p+" shows sign-in for a non-401 state");
   assert.equal(html.includes("leak"),false);
  }
  setup();for(const k of FLAGS)delete process.env[k];
  assert.equal((await pages[p]({})).includes(LOGIN),false,p+" disabled gate");
 }
});
const queue=(over={})=>({ok:true,schema:"qf.vox.work.queue.preview.v1",mode:"READ_ONLY",
 actionsEnabled:false,boundedWindow:true,completeness:"BOUNDED_NOT_TOTAL",
 items:[{workItemId:ITEM,kind:"vendor",state:"NEW",revision:0,updatedAt:"2026-10-31T05:00:00.000Z",
  assignedToMe:false,canClaim:false,canTransition:false}],...over});
const inbox=(over={})=>({ok:true,schema:"qf.vox.staff.work-notifications.inbox.v1",mode:"READ_ONLY",
 origin:"CORE_PERSISTED_WORK_EVENTS",boundedWindow:true,totalKnown:false,unreadTotalKnown:false,
 pushDeliveriesVerified:0,providerMessagesSent:0,unreadInWindow:1,
 records:[{notificationId:NOTICE,eventKind:"CLAIM",revision:0,createdAt:"2026-10-31T05:00:00.000Z",read:false}],
 ...over});
test("healthy verified pages render Core rows and no sign-in prompt",async()=>{
 const s=setup({core:async(url)=>{
  const path=new URL(url).pathname;
  if(path==="/api/vox/v1/work-queue")return Response.json(queue());
  if(path==="/api/vox/v1/staff-notifications")return Response.json(inbox());
  throw new Error("UNEXPECTED_CORE_PATH "+path);}});
 const q=await pages["team/work-queue"]({});
 assert.match(q,/Work item 00000000/);assert.equal(q.includes(LOGIN),false);
 const n=await pages["team/notifications"]({});
 assert.match(n,/Core work claimed/);assert.match(n,/Mark as read/);assert.equal(n.includes(LOGIN),false);
 assert.ok(s.requests.every(r=>r.opts.headers.authorization==="Bearer "+TOKEN&&r.opts.redirect==="error"));
 // a Core-rejected queue (no scope) must stay a neutral lock, not a login loop
 setup({core:async()=>Response.json({},{status:403})});
 const locked=await pages["team/work-queue"]({});
 assert.match(locked,/currently locked/);assert.equal(locked.includes(LOGIN),false);
});

// ---- BFF -> Core HTTP: the 401 the client forms now handle ----------------
const post=(route,body,{origin=ORIGIN,host="127.0.0.1:3107",type="application/json"}={})=>
 route.POST(new Request(ORIGIN+"/x",{method:"POST",headers:{origin,host,"content-type":type},
  body:typeof body==="string"?body:JSON.stringify(body)}));
const cmd=(over={})=>({action:"CLAIM",itemId:ITEM,expectedRevision:0,nonce:NONCE,reason:"",...over});
const workReceipt=(over={})=>({ok:true,schema:"qf.vox.work.transaction.receipt.v1",workItemId:ITEM,
 newState:"ASSIGNED",revision:1,providerMessagesSent:0,affectsVendorLeadMatching:false,...over});
test("work-transitions BFF: verified happy path is pinned; denials are mapped without Core bodies",async()=>{
 const s=setup({core:async()=>Response.json(workReceipt())});
 const ok=await post(transitions,cmd());
 assert.equal(ok.status,200);assert.equal((await ok.json()).providerMessagesSent,0);
 assert.equal(s.requests[0].url,"https://staging-core.quickfurno.in/api/vox/v1/work-transitions");
 assert.equal(s.requests[0].opts.method,"POST");
 assert.equal(s.requests[0].opts.headers.authorization,"Bearer "+TOKEN);
 assert.equal(s.requests[0].opts.redirect,"error");
 assert.deepEqual(JSON.parse(s.requests[0].opts.body),cmd());
 // Core status -> BFF status (cross-role 403, stale revision 409, expired 401)
 for(const [core,want] of [[401,401],[403,403],[409,409],[500,503],[502,503]]){
  setup({core:async()=>Response.json({secret:"other-team-item"},{status:core})});
  const r=await post(transitions,cmd());assert.equal(r.status,want);
  const t=await r.text();assert.equal(t.includes("other-team-item"),false);
  assert.equal(JSON.parse(t).error,"CORE_WORK_ACTION_NOT_VERIFIED");
 }
});
test("work-transitions BFF: missing session is a 401 the client can act on, with no Core call",async()=>{
 for(const auth of [{aal:"aal1"},{user:false},{sessionUser:"other"}]){
  const s=setup({auth,core:async()=>Response.json(workReceipt())});
  const r=await post(transitions,cmd());
  assert.equal(r.status,401);assert.equal((await r.json()).error,"STAFF_MFA_REQUIRED");
  assert.equal(s.requests.length,0);
 }
});
test("work-transitions BFF: gates and forged receipts are rejected",async()=>{
 let s=setup({core:async()=>Response.json(workReceipt())});
 const cases=[
  [cmd(),{origin:"https://evil.example.com"},403,"ORIGIN_DENIED"],
  [cmd(),{host:"evil.example.com"},403,"ORIGIN_DENIED"],
  [cmd(),{type:"text/plain"},415,"JSON_REQUIRED"],
  [cmd({action:"DELETE"}),{},400,"INVALID_WORK_COMMAND"],
  [cmd({itemId:"../x"}),{},400,"INVALID_WORK_COMMAND"],
  [{...cmd(),extra:1},{},400,"INVALID_WORK_COMMAND"],
  [cmd({action:"BLOCK",reason:"short"}),{},400,"INVALID_WORK_COMMAND"],
  ["{bad",{},400,"INVALID_JSON"]];
 for(const [body,opt,status,error] of cases){
  const r=await post(transitions,body,opt);assert.equal(r.status,status,String(error));
  assert.equal((await r.json()).error,error);
 }
 assert.equal(s.requests.length,0);
 for(const bad of [workReceipt({workItemId:id(99)}),workReceipt({revision:2}),workReceipt({newState:"DONE"}),
  workReceipt({providerMessagesSent:1}),workReceipt({affectsVendorLeadMatching:true}),workReceipt({extra:1})]){
  setup({core:async()=>Response.json(bad)});
  const r=await post(transitions,cmd());assert.equal(r.status,503);
  assert.equal((await r.json()).error,"UNTRUSTED_CORE_WORK_RECEIPT");
 }
 setup({core:async()=>Response.json(workReceipt())});
 delete process.env.VOX_WORK_ACTIONS_ENABLED;
 assert.equal((await post(transitions,cmd())).status,503);
 assert.equal(transitions.GET().status,405);
});
const readReceipt=(over={})=>({ok:true,schema:"qf.vox.staff.work-notifications.read-receipt.v1",
 notificationId:NOTICE,revision:1,readAt:"2026-10-31T05:01:00.000Z",providerMessagesSent:0,
 pushDeliveryNotClaimed:true,staffPrivilegesChanged:false,...over});
test("staff-notifications BFF: scoped, 401 without session, forged receipts rejected",async()=>{
 const s=setup({core:async()=>Response.json(readReceipt())});
 const ok=await post(notices,{notificationId:NOTICE,nonce:NONCE});
 assert.equal(ok.status,200);
 assert.equal(s.requests[0].url,"https://staging-core.quickfurno.in/api/vox/v1/staff-notifications");
 assert.deepEqual(JSON.parse(s.requests[0].opts.body),{notificationId:NOTICE,nonce:NONCE,expectedRevision:0});
 for(const auth of [{aal:"aal1"},{user:false}]){
  const d=setup({auth,core:async()=>Response.json(readReceipt())});
  const r=await post(notices,{notificationId:NOTICE,nonce:NONCE});
  assert.equal(r.status,401);assert.equal(d.requests.length,0);
 }
 for(const [core,want] of [[401,401],[403,403],[409,409],[500,503]]){
  setup({core:async()=>Response.json({secret:"other-staff"},{status:core})});
  const r=await post(notices,{notificationId:NOTICE,nonce:NONCE});assert.equal(r.status,want);
  assert.equal((await r.text()).includes("other-staff"),false);
 }
 for(const bad of [readReceipt({notificationId:id(77)}),readReceipt({pushDeliveryNotClaimed:false}),
  readReceipt({staffPrivilegesChanged:true}),readReceipt({providerMessagesSent:1}),readReceipt({revision:0})]){
  setup({core:async()=>Response.json(bad)});
  const r=await post(notices,{notificationId:NOTICE,nonce:NONCE});
  assert.equal(r.status,503);assert.equal((await r.json()).error,"UNVERIFIED_READ_RECEIPT");
 }
 setup({core:async()=>Response.json(readReceipt())});
 for(const [body,opt,status] of [
  [{notificationId:NOTICE,nonce:NONCE},{origin:"https://evil.example.com"},403],
  [{notificationId:NOTICE,nonce:NONCE},{type:"text/plain"},415],
  [{notificationId:"x",nonce:NONCE},{},400],
  [{notificationId:NOTICE,nonce:NONCE,staffId:id(5)},{},400]])
  assert.equal((await post(notices,body,opt)).status,status);
});
test("team-chat BFF: missing session answers 401 and never reaches Core",async()=>{
 for(const auth of [{aal:"aal1"},{user:false}]){
  const s=setup({auth,core:async()=>Response.json({ok:true})});
  const r=await post(chat,{body:"hi",nonce:NONCE});
  assert.equal(r.status,401);assert.equal((await r.json()).error,"MFA_REQUIRED");
  assert.equal(s.requests.length,0);
 }
});

// ---- client forms: source contract (no DOM available in this runner) -------
test("client forms check for 401 before parsing the body and link to /login",()=>{
 for(const f of ["team/chat/ChatComposer.tsx","team/notifications/MarkRead.tsx","team/work-queue/WorkActionControl.tsx"]){
  const src=readFileSync(resolve(web,"app",f),"utf8");
  const i401=src.search(/\.status===401\)\{setExpired\(true\)/),iJson=src.indexOf(".json()");
  assert.ok(i401>0&&i401<iJson,f+" must handle 401 before .json()");
  if(f==="team/work-queue/WorkActionControl.tsx")
   assert.match(src,/href=\{withReturn\("\/login","\/team\/work-queue"\)\}/);
  else assert.match(src,/href="\/login"/);
 }
});
