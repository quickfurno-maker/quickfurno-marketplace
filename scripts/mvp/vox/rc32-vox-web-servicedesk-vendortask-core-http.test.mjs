import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

// RC32 e-qa: compiles the genuine VOX Web service-desk and vendor-task routes
// together with the genuine lib/auth.ts (real AAL2 logic) and lib/core.ts.
// Only Supabase Auth (@supabase/ssr), next/headers and outbound fetch are fake;
// the fake Core enforces Core's documented 201/200/409 idempotency contract.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const fakes={
 "server-only":"",
 "next/headers":"export async function cookies(){return {getAll:()=>[],set(){}}}",
 "@supabase/ssr":"export function createServerClient(){const f=()=>globalThis.__rc32.auth;"+
  "return {auth:{getUser:async()=>f().user,getSession:async()=>f().session,"+
  "mfa:{getAuthenticatorAssuranceLevel:async()=>f().aal}}}}",
};
async function compile(entry,name){
 const outfile=resolve(root,"test-results/"+name);
 await build({entryPoints:[resolve(root,entry)],bundle:true,platform:"node",format:"esm",
  target:"node20",outfile,logLevel:"silent",plugins:[{name:"rc32-fakes",setup(b){
   b.onResolve({filter:/^(server-only|next\/headers|@supabase\/ssr)$/},a=>({path:a.path,namespace:"rc32"}));
   b.onLoad({filter:/.*/,namespace:"rc32"},a=>({loader:"js",contents:fakes[a.path]}));
  }}]});
 return import(pathToFileURL(outfile).href);
}
const desk=await compile("apps/vox-web/app/api/service-desk/route.ts","rc32-web-service-desk.mjs");
const task=await compile("apps/vox-web/app/api/vendor-task/route.ts","rc32-web-vendor-task.mjs");

const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const VENDOR=id(2),NONCE=id(9),THREAD=id(5),CONV=id(6),TASK=id(3),TOKEN="staff-access-token";
const ORIGIN="http://127.0.0.1:3107";
const originalFetch=globalThis.fetch;
const oldEnv={...process.env};
const ENV_KEYS=["VOX_STAFF_PORTAL_ENABLED","VOX_STAFF_VIEW_MODE","VOX_CORE_ORIGIN",
 "VOX_VENDOR_TASK_UI_ENABLED","VOX_EXPECTED_ORIGIN","VOX_SUPABASE_URL","VOX_SUPABASE_PUBLISHABLE_KEY"];
test.after(()=>{globalThis.fetch=originalFetch;
 for(const k of ENV_KEYS){if(oldEnv[k]===undefined)delete process.env[k];else process.env[k]=oldEnv[k];}});

function authState({aal="aal2",user=true,sessionUser="u1"}={}){
 return {user:user?{data:{user:{id:"u1"}},error:null}:{data:{user:null},error:{message:"x"}},
  session:{data:{session:{user:{id:sessionUser},access_token:TOKEN}}},
  aal:{data:{currentLevel:aal},error:null}};
}
function setup({auth={},core}={}){
 process.env.VOX_STAFF_PORTAL_ENABLED="staging";
 process.env.VOX_STAFF_VIEW_MODE="scoped";
 process.env.VOX_VENDOR_TASK_UI_ENABLED="staging";
 process.env.VOX_CORE_ORIGIN="https://staging-core.quickfurno.in/";
 process.env.VOX_EXPECTED_ORIGIN=ORIGIN;
 process.env.VOX_SUPABASE_URL="http://auth.invalid";
 process.env.VOX_SUPABASE_PUBLISHABLE_KEY="fake";
 const state={auth:authState(auth),requests:[]};
 globalThis.__rc32=state;
 globalThis.fetch=async(url,opts)=>{state.requests.push({url:String(url),opts});return core(String(url),opts,state);};
 return state;
}
const post=(body,{origin=ORIGIN,host="127.0.0.1:3107",type="application/json"}={})=>
 new Request(ORIGIN+"/api/vendor-task",{method:"POST",
  headers:{origin,host,"content-type":type},
  body:typeof body==="string"?body:JSON.stringify(body)});
const taskBody=(over={})=>({vendorId:VENDOR,nonce:NONCE,taskType:"FOLLOW_UP",title:"Call vendor",
 priority:"NORMAL",dueAt:"2026-11-01T10:00:00.000Z",...over});
const deskView=(over={})=>({schema:"qf.vox.service.desk.v1",mode:"READ_ONLY",
 support:[{threadId:THREAD,state:"OPEN",priority:"HIGH",ageBand:"<1h",
  customerPhone:"+919999999999",messageText:"PII-LEAK"}],
 humanInbox:[{conversationId:CONV,lane:"ANISHA",serviceWindow:"OPEN",email:"pii@x.in"}],...over});
const deskCore=view=>async()=>Response.json({ok:true,view},{status:200});

test("service desk: real AAL2 gate, scoped fetch, PII dropped, Core call pinned",async()=>{
 const s=setup({core:deskCore(deskView())});
 const r=await desk.GET();assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.view.support[0].threadId,THREAD);
 assert.equal(body.view.support[0].canClose,false);
 assert.equal(body.view.humanInbox[0].lane,"ANISHA");
 assert.equal(body.view.humanInbox[0].canReply,false);
 const text=JSON.stringify(body);
 for(const leak of ["PII-LEAK","+919999999999","pii@x.in","customerPhone","email"])
  assert.equal(text.includes(leak),false,leak);
 assert.equal(s.requests[0].url,"https://staging-core.quickfurno.in/api/vox/v1/desk");
 assert.equal(s.requests[0].opts.headers.authorization,"Bearer "+TOKEN);
 assert.equal(s.requests[0].opts.redirect,"error");
 assert.ok(s.requests[0].opts.signal instanceof AbortSignal,"timeout signal present");
});
test("service desk: aal1, no user, or mismatched session never reach Core",async()=>{
 for(const auth of [{aal:"aal1"},{user:false},{sessionUser:"someone-else"}]){
  const s=setup({auth,core:deskCore(deskView())});
  const r=await desk.GET();assert.equal(r.status,401);
  assert.equal((await r.json()).error,"MFA_REQUIRED");
  assert.equal(s.requests.length,0);
 }
});
test("service desk: Core 403 preserved, other failures collapse to 503",async()=>{
 for(const [status,want] of [[403,403],[500,503],[401,503]]){
  setup({core:async()=>Response.json({secret:"core-body"},{status})});
  const r=await desk.GET();assert.equal(r.status,want);
  const t=await r.text();assert.equal(t.includes("core-body"),false);
  assert.equal(JSON.parse(t).error,"STAFF_DESK_UNAVAILABLE");
 }
});
test("service desk: timeout/abort and network errors become 503",async()=>{
 setup({core:async(u,o)=>new Promise((_,rej)=>{
  o.signal.addEventListener("abort",()=>rej(o.signal.reason));})});
 // The genuine AbortSignal.timeout(3500) is honoured; shorten the timer for test speed.
 const orig=AbortSignal.timeout;
 AbortSignal.timeout=()=>orig.call(AbortSignal,20);
 try{const r=await desk.GET();assert.equal(r.status,503);
  assert.equal((await r.json()).error,"STAFF_DESK_UNAVAILABLE");}
 finally{AbortSignal.timeout=orig;}
 setup({core:async()=>{throw new TypeError("fetch failed")}});
 assert.equal((await desk.GET()).status,503);
});
test("service desk: invalid schema, non-read-only, oversize and non-JSON rejected",async()=>{
 for(const core of [
  deskCore(deskView({schema:"other"})),deskCore(deskView({mode:"WRITE"})),
  deskCore(deskView({support:"x"})),deskCore(deskView({humanInbox:null})),
  deskCore(deskView({support:Array.from({length:13},()=>({threadId:THREAD}))})),
  async()=>Response.json({ok:false,view:deskView()}),
  async()=>Response.json({ok:true}),
  async()=>new Response("<html>",{status:200}),
 ]){
  setup({core});const r=await desk.GET();assert.equal(r.status,503);
  assert.match((await r.json()).error,/^(UNTRUSTED_DESK_RESPONSE|STAFF_DESK_UNAVAILABLE)$/);
 }
 // malformed rows are neutralised, not trusted
 setup({core:deskCore(deskView({support:[{threadId:"not-a-uuid",state:"A\u0000B"}],
  humanInbox:[{conversationId:CONV,lane:"EVIL",serviceWindow:"x"}]}))});
 const b=await (await desk.GET()).json();
 assert.equal(b.view.support[0].threadId,null);
 assert.equal(b.view.support[0].state,"A B");
 assert.equal(b.view.humanInbox[0].lane,"UNKNOWN");
 assert.equal(b.view.humanInbox[0].serviceWindow,"CLOSED_OR_UNKNOWN");
});
test("service desk: disabled flags and unpinned origin block Core; no mutations",async()=>{
 setup({core:deskCore(deskView())});
 process.env.VOX_STAFF_VIEW_MODE="off";
 assert.equal((await desk.GET()).status,503);
 const s=setup({core:deskCore(deskView())});
 process.env.VOX_CORE_ORIGIN="https://evil.example.com/";
 assert.equal((await (await desk.GET()).json()).error,"CORE_NOT_CONFIGURED");
 assert.equal(s.requests.length,0);
 for(const v of ["POST","PATCH","DELETE"]){
  const r=desk[v]();assert.equal(r.status,405);
  assert.equal((await r.json()).error,"CORE_APPROVAL_REQUIRED");
 }
 assert.equal(s.requests.length,0);
});

// Fake Core vendor-task: mirrors Core's contract (201 create, 200 exact replay,
// 409 same nonce with a different payload, 403 out-of-scope).
function taskCore({deny=false}={}){
 const store=new Map();
 return async(url,opts)=>{
  assert.equal(url,"https://staging-core.quickfurno.in/api/vox/v1/vendor-task");
  assert.equal(opts.method,"POST");
  if(deny)return Response.json({ok:false,error:"SCOPE_DENIED"},{status:403});
  const b=JSON.parse(opts.body);const prior=store.get(b.nonce);
  if(prior){
   if(JSON.stringify(prior.b)!==JSON.stringify(b))return Response.json({ok:false,error:"IDEMPOTENCY_CONFLICT"},{status:409});
   return Response.json({ok:true,taskId:prior.id,created:false},{status:200});
  }
  const rec={b,id:id(100+store.size)};store.set(b.nonce,rec);
  return Response.json({ok:true,taskId:rec.id,created:true},{status:201});
 };
}
test("vendor-task: Web->Core idempotency create, replay, conflict end to end",async()=>{
 const s=setup({core:taskCore()});
 let r=await task.POST(post(taskBody()));assert.equal(r.status,201);
 let b=await r.json();assert.equal(b.created,true);assert.equal(b.approval,"INTERNAL_TASK_ONLY");
 const first=b.taskId;
 r=await task.POST(post(taskBody()));assert.equal(r.status,200);
 b=await r.json();assert.equal(b.created,false);assert.equal(b.taskId,first);
 r=await task.POST(post(taskBody({title:"Different"})));assert.equal(r.status,409);
 assert.equal((await r.json()).error,"CORE_TASK_IDEMPOTENCY_CONFLICT");
 assert.equal(s.requests.length,3);
 assert.equal(s.requests[0].opts.headers.authorization,"Bearer "+TOKEN);
 assert.deepEqual(JSON.parse(s.requests[0].opts.body),taskBody());
});
test("vendor-task: Web gates (origin, content-type, schema, size) stop before Core",async()=>{
 const s=setup({core:taskCore()});
 const cases=[
  [post(taskBody(),{origin:"https://evil.example.com"}),403,"ORIGIN_DENIED"],
  [post(taskBody(),{host:"evil.example.com"}),403,"ORIGIN_DENIED"],
  [post(taskBody(),{type:"text/plain"}),415,"INVALID_CONTENT_TYPE"],
  [post(taskBody({extra:1})),400,"INVALID_TASK"],
  [post(taskBody({vendorId:"nope"})),400,"INVALID_TASK"],
  [post(taskBody({nonce:"nope"})),400,"INVALID_TASK"],
  [post(taskBody({title:"x".repeat(121)})),400,"INVALID_TASK"],
  [post("[]"),400,"INVALID_BODY"],
  [post("{bad json"),503,"CORE_TASK_UNAVAILABLE"],
  [post(JSON.stringify(taskBody({title:"y".repeat(900)}))),413,"PAYLOAD_TOO_LARGE"],
 ];
 for(const [req,status,error] of cases){
  const r=await task.POST(req);assert.equal(r.status,status,error);
  assert.equal((await r.json()).error,error);
 }
 assert.equal(s.requests.length,0);
});
test("vendor-task: MFA, disabled flag, Core 403/400 and invalid receipts",async()=>{
 let s=setup({auth:{aal:"aal1"},core:taskCore()});
 let r=await task.POST(post(taskBody()));assert.equal(r.status,401);
 assert.equal((await r.json()).error,"MFA_REQUIRED");assert.equal(s.requests.length,0);
 s=setup({core:taskCore()});delete process.env.VOX_VENDOR_TASK_UI_ENABLED;
 r=await task.POST(post(taskBody()));assert.equal(r.status,503);
 assert.equal((await r.json()).error,"TASK_WRITE_DISABLED");assert.equal(s.requests.length,0);
 setup({core:taskCore({deny:true})});
 r=await task.POST(post(taskBody()));assert.equal(r.status,403);
 assert.equal((await r.json()).error,"CORE_TASK_REJECTED");
 setup({core:async()=>Response.json({ok:false},{status:400})});
 assert.equal((await task.POST(post(taskBody()))).status,400);
 // Receipts Web must not trust: wrong id, ok:false, 202 status, non-JSON
 for(const core of [
  async()=>Response.json({ok:true,taskId:"bad"},{status:201}),
  async()=>Response.json({ok:false,taskId:TASK},{status:201}),
  async()=>Response.json({ok:true,taskId:TASK},{status:202}),
  async()=>new Response("nope",{status:201}),
 ]){
  setup({core});r=await task.POST(post(taskBody()));assert.equal(r.status,503);
 }
 setup({core:async()=>{throw new TypeError("fetch failed")}});
 r=await task.POST(post(taskBody()));assert.equal(r.status,503);
 assert.equal((await r.json()).error,"CORE_TASK_UNAVAILABLE");
});
test("vendor-task: non-POST verbs are rejected without calling Core",async()=>{
 const s=setup({core:taskCore()});
 for(const v of ["GET","PATCH","DELETE"]){
  const r=task[v]();assert.equal(r.status,405);
 }
 assert.equal(s.requests.length,0);
});
