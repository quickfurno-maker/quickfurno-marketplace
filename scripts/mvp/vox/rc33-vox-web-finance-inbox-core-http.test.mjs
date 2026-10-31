import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

// RC33 e-qa: compiles the genuine VOX Web team-chat inbox route and the genuine
// Owner Finance pages with the genuine lib/auth.ts (real AAL2 logic), lib/core.ts
// and lib/teamWorkflow.ts. Only Supabase Auth (@supabase/ssr), next/headers,
// next/link and outbound fetch are fake; no live provider, DB or network.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const web=resolve(root,"apps/vox-web");
const fakes={
 "server-only":"",
 "next/headers":"export async function cookies(){return {getAll:()=>[],set(){}}}",
 "next/link":"import {createElement} from 'react';"+
  "export default function Link({href,children,...p}){return createElement('a',{href,...p},children)}",
 "@supabase/ssr":"export function createServerClient(){const f=()=>globalThis.__rc33.auth;"+
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
  plugins:[{name:"rc33-fakes",setup(b){
   b.onResolve({filter:/^(server-only|next\/headers|next\/link|@supabase\/ssr)$/},
    a=>({path:a.path,namespace:"rc33"}));
   b.onLoad({filter:/.*/,namespace:"rc33"},a=>({loader:"js",contents:fakes[a.path],resolveDir:web}));
  }}]});
 return import(pathToFileURL(outfile).href);
}
const chat=await compile("apps/vox-web/app/api/team-chat/route.ts","rc33-web-team-chat.mjs");
const render=(page)=>compile({contents:
 `import Page from "./app/${page}/page.tsx";`+
 `import {renderToStaticMarkup} from "react-dom/server";`+
 `export async function render(props){return renderToStaticMarkup(await Page(props))}`},
 "rc33-web-page-"+page.replace(/[^a-z]/gi,"-")+".mjs");
const financePage=(await render("finance")).render;
const orderPage=(await render("finance/[orderId]")).render;

const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const ORDER=id(7),OTHER_ORDER=id(8),NONCE=id(9),MSG=id(4),TOKEN="staff-access-token";
const ORIGIN="http://127.0.0.1:3107";
const originalFetch=globalThis.fetch;
const oldEnv={...process.env};
const ENV_KEYS=["VOX_STAFF_PORTAL_ENABLED","VOX_STAFF_VIEW_MODE","VOX_CORE_ORIGIN",
 "VOX_TEAM_WORKSPACE_ENABLED","VOX_TEAM_CHAT_UI_ENABLED","VOX_FINANCE_READ_UI_ENABLED",
 "VOX_FINANCE_DETAIL_READ_UI_ENABLED","VOX_FINANCE_ATTEMPTS_READ_UI_ENABLED",
 "VOX_EXPECTED_ORIGIN","VOX_SUPABASE_URL","VOX_SUPABASE_PUBLISHABLE_KEY"];
test.after(()=>{globalThis.fetch=originalFetch;
 for(const k of ENV_KEYS){if(oldEnv[k]===undefined)delete process.env[k];else process.env[k]=oldEnv[k];}});

function authState({aal="aal2",user=true,sessionUser="u1"}={}){
 return {user:user?{data:{user:{id:"u1"}},error:null}:{data:{user:null},error:{message:"x"}},
  session:{data:{session:{user:{id:sessionUser},access_token:TOKEN}}},
  aal:{data:{currentLevel:aal},error:null}};
}
function setup({auth={},core}={}){
 for(const k of ENV_KEYS)process.env[k]="staging";
 process.env.VOX_STAFF_VIEW_MODE="scoped";
 process.env.VOX_CORE_ORIGIN="https://staging-core.quickfurno.in/";
 process.env.VOX_EXPECTED_ORIGIN=ORIGIN;
 process.env.VOX_SUPABASE_URL="http://auth.invalid";
 process.env.VOX_SUPABASE_PUBLISHABLE_KEY="fake";
 const state={auth:authState(auth),requests:[]};
 globalThis.__rc33=state;
 globalThis.fetch=async(url,opts)=>{state.requests.push({url:String(url),opts});return core(String(url),opts,state);};
 return state;
}

// ---- inbox: team chat -----------------------------------------------------
const chatView=(over={})=>({ok:true,schema:"qf.vox.staff.team.chat.preview.v1",
 mode:"INTERNAL_ONLY",boundedWindow:true,totalKnown:false,externalMessagesSent:0,
 messages:[{messageId:MSG,staffRef:"STAFF-0123abcd",isMine:false,body:"Hello team",
  createdAt:"2026-10-31T05:00:00.000Z"}],...over});
const chatGet=()=>chat.GET(new Request(ORIGIN+"/api/team-chat"));
const chatPost=(body,{origin=ORIGIN,host="127.0.0.1:3107",type="application/json"}={})=>
 chat.POST(new Request(ORIGIN+"/api/team-chat",{method:"POST",
  headers:{origin,host,"content-type":type},
  body:typeof body==="string"?body:JSON.stringify(body)}));
const receipt=(over={})=>({ok:true,schema:"qf.vox.staff.team.chat.receipt.v1",messageId:MSG,
 createdAt:"2026-10-31T05:01:00.000Z",effect:"INTERNAL_TEAM_MESSAGE_ONLY",
 externalMessagesSent:0,agentConversationChanged:false,staffPrivilegesChanged:false,...over});

test("inbox: real AAL2 gate, scoped Core read, pinned request",async()=>{
 const s=setup({core:async()=>Response.json(chatView())});
 const r=await chatGet();assert.equal(r.status,200);
 const b=await r.json();
 assert.equal(b.messages[0].messageId,MSG);assert.equal(b.mode,"INTERNAL_ONLY");
 assert.equal(s.requests[0].url,"https://staging-core.quickfurno.in/api/vox/v1/staff-chat");
 assert.equal(s.requests[0].opts.headers.authorization,"Bearer "+TOKEN);
 assert.equal(s.requests[0].opts.redirect,"error");
 assert.ok(s.requests[0].opts.signal instanceof AbortSignal);
 for(const auth of [{aal:"aal1"},{user:false},{sessionUser:"someone-else"}]){
  const d=setup({auth,core:async()=>Response.json(chatView())});
  const x=await chatGet();assert.equal(x.status,401);
  assert.equal((await x.json()).error,"MFA_REQUIRED");assert.equal(d.requests.length,0);
 }
 const f=setup({core:async()=>Response.json(chatView())});
 assert.equal((await chat.GET(new Request(ORIGIN+"/api/team-chat?staff=other"))).status,400);
 assert.equal(f.requests.length,0);
});
test("inbox: cross-role IDOR - Core 403/409 denial surfaces without Core body",async()=>{
 for(const [status,want] of [[403,403],[409,409],[500,503],[401,401]]){
  setup({core:async()=>Response.json({secret:"other-staff-thread"},{status})});
  const r=await chatGet();assert.equal(r.status,want);
  const t=await r.text();assert.equal(t.includes("other-staff-thread"),false);
  assert.equal(JSON.parse(t).error,"CORE_SCOPE_DENIED_OR_STALE");
 }
 // Web cannot be steered to another staff member's inbox via body fields.
 const s=setup({core:async()=>Response.json(receipt(),{status:201})});
 const r=await chatPost({body:"hi",nonce:NONCE,staffId:id(55)});
 assert.equal(r.status,400);assert.equal((await r.json()).error,"INVALID_MESSAGE");
 assert.equal(s.requests.length,0);
});
test("inbox: bad Core responses are denied, never rendered",async()=>{
 const rows=[{messageId:MSG,staffRef:"STAFF-0123abcd",isMine:false,body:"ok",createdAt:"2026-10-31T05:00:00.000Z"}];
 for(const core of [
  async()=>Response.json(chatView({schema:"other"})),
  async()=>Response.json(chatView({mode:"EXTERNAL"})),
  async()=>Response.json(chatView({externalMessagesSent:1})),
  async()=>Response.json(chatView({totalKnown:true})),
  async()=>Response.json(chatView({extra:1})),
  async()=>Response.json(chatView({messages:Array.from({length:26},(_,i)=>({...rows[0],messageId:id(200+i)}))})),
  async()=>Response.json(chatView({messages:[rows[0],rows[0]]})),
  async()=>Response.json(chatView({messages:[{...rows[0],staffRef:"bob@example.com"}]})),
  async()=>Response.json(chatView({messages:[{...rows[0],body:"x\u0000y"}]})),
  async()=>Response.json(chatView({messages:[{...rows[0],phone:"+91999"}]})),
  async()=>Response.json([]),
  async()=>new Response("<html>",{status:200}),
  async()=>{throw new TypeError("fetch failed")},
 ]){
  setup({core});const r=await chatGet();assert.equal(r.status,503);
  assert.match((await r.json()).error,/^(INVALID_CHAT_SOURCE|INVALID_CHAT_ROW|INVALID_CORE_RESPONSE|CORE_UNAVAILABLE)$/);
 }
 setup({core:async()=>Response.json(chatView())});
 delete process.env.VOX_TEAM_CHAT_UI_ENABLED;
 assert.equal((await (await chatGet()).json()).error,"TEAM_CHAT_DISABLED");
 setup({core:async()=>Response.json(chatView())});
 process.env.VOX_CORE_ORIGIN="https://evil.example.com/";
 const r=await chatGet();assert.equal((await r.json()).error,"CORE_NOT_CONFIGURED");
});
test("inbox: send gates stop before Core; receipts are verified",async()=>{
 let s=setup({core:async()=>Response.json(receipt(),{status:201})});
 const cases=[
  [{body:"hi",nonce:NONCE},{origin:"https://evil.example.com"},403,"ORIGIN_DENIED"],
  [{body:"hi",nonce:NONCE},{host:"evil.example.com"},403,"ORIGIN_DENIED"],
  [{body:"hi",nonce:NONCE},{type:"text/plain"},415,"JSON_REQUIRED"],
  [{body:" hi",nonce:NONCE},{},400,"INVALID_MESSAGE"],
  [{body:"hi",nonce:"nope"},{},400,"INVALID_MESSAGE"],
  [{body:"x".repeat(501),nonce:NONCE},{},400,"INVALID_MESSAGE"],
  [{body:"x".repeat(1300),nonce:NONCE},{},413,"PAYLOAD_TOO_LARGE"],
  ["[]",{},400,"INVALID_PAYLOAD"],
  ["{bad",{},400,"INVALID_JSON"],
 ];
 for(const [body,opt,status,error] of cases){
  const r=await chatPost(body,opt);assert.equal(r.status,status,error);
  assert.equal((await r.json()).error,error);
 }
 assert.equal(s.requests.length,0);
 const r=await chatPost({body:"hi",nonce:NONCE});assert.equal(r.status,201);
 assert.equal((await r.json()).effect,"INTERNAL_TEAM_MESSAGE_ONLY");
 assert.deepEqual(JSON.parse(s.requests[0].opts.body),{body:"hi",nonce:NONCE});
 assert.equal(s.requests[0].opts.method,"POST");
 for(const bad of [receipt({externalMessagesSent:1}),receipt({agentConversationChanged:true}),
  receipt({staffPrivilegesChanged:true}),receipt({effect:"EXTERNAL"}),receipt({messageId:"x"}),receipt({extra:1})]){
  setup({core:async()=>Response.json(bad,{status:201})});
  const x=await chatPost({body:"hi",nonce:NONCE});assert.equal(x.status,503);
  assert.equal((await x.json()).error,"INVALID_CHAT_RECEIPT");
 }
 s=setup({auth:{aal:"aal1"},core:async()=>Response.json(receipt(),{status:201})});
 assert.equal((await chatPost({body:"hi",nonce:NONCE})).status,401);assert.equal(s.requests.length,0);
 for(const v of ["PUT","PATCH","DELETE"])assert.equal(chat[v]().status,405);
});

// ---- Owner Finance --------------------------------------------------------
const order=(over={})=>({orderId:ORDER,vendorRef:"VENDOR-0123abcd",currency:"INR",
 recordedOrderAmount:1500,creditsIncluded:10,orderStatus:"completed",paymentStatus:"paid",
 activationStatus:"activated",createdAt:"2026-10-15T06:00:00.000Z",...over});
const preview=(over={})=>({ok:true,schema:"qf.vox.finance.order-preview.v1",mode:"READ_ONLY",
 source:"vendor_package_orders",canRefund:false,canReconcile:false,canActivatePayments:false,
 hasProviderConfirmation:false,isCompleteHistory:false,orders:[order()],...over});
const detail=(over={},ord={})=>({ok:true,schema:"qf.vox.finance.order-detail.v1",mode:"READ_ONLY",
 detail:{providerConfirmed:false,isAttemptHistoryComplete:false,canRefund:false,canCapture:false,
  canGrantCredits:false,ledgerStatus:"NO_CORRELATED_PAYMENT_RECORD",ledger:null,
  order:{...order(),...ord},...over}});
const financeCore=(table)=>async(url)=>{
 const path=new URL(url).pathname;
 if(!(path in table))throw new Error("UNEXPECTED_CORE_PATH "+path);
 const v=table[path];return v instanceof Response?v:Response.json(v);
};
const owner=(ok)=>({"/api/vox/v1/finance":ok});

test("finance list: renders only verified Core rows with working detail links",async()=>{
 const s=setup({core:financeCore(owner(preview()))});
 const html=await financePage({searchParams:Promise.resolve({})});
 assert.match(html,new RegExp('href="/finance/'+ORDER+'"'));
 assert.match(html,/VENDOR-0123abcd/);assert.match(html,/₹1,500\.00/);
 assert.equal(s.requests[0].url,"https://staging-core.quickfurno.in/api/vox/v1/finance");
 assert.equal(s.requests[0].opts.headers.authorization,"Bearer "+TOKEN);
 assert.equal(s.requests[0].opts.redirect,"error");
 // filter links keep working and never produce an unknown state route
 const failed=await financePage({searchParams:Promise.resolve({state:"bogus"})});
 assert.match(failed,/aria-current="page"[^>]*>All recent/);
});
test("finance list: cross-role/no-session denial shows sign-in, not provider data",async()=>{
 for(const auth of [{aal:"aal1"},{user:false}]){
  const s=setup({auth,core:financeCore(owner(preview()))});
  const html=await financePage({searchParams:Promise.resolve({})});
  assert.match(html,/Verified Owner session required/);assert.match(html,/href="\/login"/);
  assert.equal(html.includes("VENDOR-0123abcd"),false);assert.equal(s.requests.length,0);
 }
 // Core 403 (a scoped, non-Owner staff role) must not reveal any record
 setup({core:financeCore(owner(Response.json({orders:[order()]},{status:403})))});
 const html=await financePage({searchParams:Promise.resolve({})});
 assert.match(html,/Finance preview unavailable/);
 assert.equal(html.includes("VENDOR-0123abcd"),false);assert.match(html,/href="\/operations"/);
});
test("finance list: bad Core responses are rejected whole",async()=>{
 for(const bad of [preview({schema:"other"}),preview({canRefund:true}),preview({canReconcile:true}),
  preview({hasProviderConfirmation:true}),preview({isCompleteHistory:true}),
  preview({source:"payments"}),preview({orders:Array.from({length:21},()=>order())}),
  preview({orders:[order({vendorRef:"bob@example.com"})]}),
  preview({orders:[order({orderId:"nope"})]}),preview({orders:[order({currency:"USD"})]}),
  preview({orders:[order({paymentStatus:"settled"})]}),
  preview({orders:[order({recordedOrderAmount:-1})]}),
  preview({orders:[order({createdAt:"never"})]}),[],"text"]){
  setup({core:financeCore(owner(bad))});
  const html=await financePage({searchParams:Promise.resolve({})});
  assert.match(html,/Finance preview unavailable/);
  assert.equal(html.includes("VENDOR-"),false);
 }
 setup({core:financeCore(owner(new Response("<html>",{status:200})))});
 assert.match(await financePage({searchParams:Promise.resolve({})}),/Finance preview unavailable/);
 setup({core:async()=>{throw new TypeError("fetch failed")}});
 assert.match(await financePage({searchParams:Promise.resolve({})}),/Finance preview unavailable/);
 const s=setup({core:financeCore(owner(preview()))});
 delete process.env.VOX_FINANCE_READ_UI_ENABLED;
 assert.match(await financePage({searchParams:Promise.resolve({})}),/Finance preview unavailable/);
 assert.equal(s.requests.length,0);
});
const detailTable=(d,attempts={ok:false})=>({
 ["/api/vox/v1/finance/order/"+ORDER]:d,
 ["/api/vox/v1/finance/order/"+ORDER+"/attempts"]:attempts});
test("finance detail: renders a verified order; IDOR to another order id is denied",async()=>{
 const s=setup({core:financeCore(detailTable(detail()))});
 const html=await orderPage({params:Promise.resolve({orderId:ORDER})});
 assert.match(html,/One order\./);assert.match(html,/VENDOR-0123abcd/);
 assert.match(html,/href="\/finance"/);
 assert.equal(s.requests[0].url,"https://staging-core.quickfurno.in/api/vox/v1/finance/order/"+ORDER);
 // Core answers a different order for the requested id (IDOR/mixup): rejected
 setup({core:financeCore({["/api/vox/v1/finance/order/"+OTHER_ORDER]:detail({},{orderId:ORDER})})});
 const bad=await orderPage({params:Promise.resolve({orderId:OTHER_ORDER})});
 assert.match(bad,/Order details unavailable/);assert.equal(bad.includes("VENDOR-0123abcd"),false);
 // path-traversal / malformed id never reaches Core
 const t=setup({core:financeCore(detailTable(detail()))});
 for(const orderId of ["../finance","nope",ORDER+"/attempts"]){
  const x=await orderPage({params:Promise.resolve({orderId})});
  assert.match(x,/Order details unavailable/);
 }
 assert.equal(t.requests.length,0);
});
test("finance detail: UX - missing MFA offers sign-in instead of a dead end",async()=>{
 for(const auth of [{aal:"aal1"},{user:false}]){
  const s=setup({auth,core:financeCore(detailTable(detail()))});
  const html=await orderPage({params:Promise.resolve({orderId:ORDER})});
  assert.match(html,/Verified Owner session required/);
  assert.match(html,/href="\/login"/);assert.match(html,/href="\/finance"/);
  assert.equal(s.requests.length,0);
 }
 // other failures keep the neutral card and do NOT claim a sign-in problem
 setup({core:financeCore(detailTable(Response.json({},{status:403})))});
 const html=await orderPage({params:Promise.resolve({orderId:ORDER})});
 assert.match(html,/Order details unavailable/);assert.equal(html.includes('href="/login"'),false);
});
test("finance detail: bad Core responses are rejected whole",async()=>{
 for(const bad of [detail({providerConfirmed:true}),detail({canRefund:true}),detail({canCapture:true}),
  detail({canGrantCredits:true}),detail({isAttemptHistoryComplete:true}),
  detail({ledgerStatus:"SETTLED"}),
  detail({ledgerStatus:"CORE_RECORDS_AGREE",ledger:null}),
  detail({ledger:{recordedPaymentId:ORDER,recordedAmount:1,recordedStatus:"Paid",recordedAt:"2026-10-15T06:00:00.000Z"}}),
  detail({ledgerStatus:"CORE_RECORDS_AGREE",ledger:{recordedPaymentId:OTHER_ORDER,recordedAmount:1,
   recordedStatus:"Paid",recordedAt:"2026-10-15T06:00:00.000Z"}}),
  detail({},{vendorRef:"bob@example.com"}),detail({},{currency:"USD"}),
  {...detail(),schema:"other"},{...detail(),mode:"WRITE"},{ok:false}]){
  setup({core:financeCore(detailTable(bad))});
  const html=await orderPage({params:Promise.resolve({orderId:ORDER})});
  assert.match(html,/Order details unavailable/);assert.equal(html.includes("VENDOR-0123abcd"),false);
 }
 // untrusted attempt evidence degrades only that panel
 setup({core:financeCore(detailTable(detail(),{ok:true,schema:"qf.vox.finance.attempt-evidence.v1",
  readOnly:true,isCompleteHistory:false,isProviderSettlementVerified:false,canReconcile:false,
  canRefund:true,canActivateCredits:false,events:[],eventCount:0}))});
 const html=await orderPage({params:Promise.resolve({orderId:ORDER})});
 assert.match(html,/One order\./);assert.match(html,/Attempt-event history is not enabled/);
});
