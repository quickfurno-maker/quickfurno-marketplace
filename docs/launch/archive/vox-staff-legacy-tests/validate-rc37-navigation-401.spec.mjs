// RC37: Owner/Staff navigation dead ends and Core 401 handling on Vendor 360,
// Acquisition, Service Desk and Finance. Source checks always run; compiled
// HTTP checks run against a real loopback `next start` when a production build
// exists. No managed URLs, credentials or provider network are used.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {spawn} from "node:child_process";
import {safeReturnPath,withReturn} from "../lib/returnTo.mjs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");

test("every Staff/Owner screen return path survives the login allow-list",()=>{
 const orderId="0b6f1c1e-5f0e-4a58-9d3a-6f2f4a7a9c11";
 for(const p of ["/vendor360","/acquisition","/service-desk","/finance","/finance/"+orderId])
  assert.equal(safeReturnPath(p),p,p);
 assert.equal(withReturn("/login","/finance/"+orderId),
  "/login?next="+encodeURIComponent("/finance/"+orderId));
 assert.equal(withReturn("/login","/finance/../api/auth"),"/login");
});

test("Core 401 maps to MFA_REQUIRED/401 (never 503) for finance, CRM, desk and vendor task",()=>{
 const src=read("../lib/core.ts");
 const fn=(name,next)=>{const a=src.indexOf("export async function "+name);
  assert.ok(a>=0,name);const b=src.indexOf("export ",a+10);return src.slice(a,b<0?undefined:b);};
 for(const name of ["fetchOwnerFinancePreview","fetchOwnerFinanceOrderDetail",
   "fetchScopedServiceDesk","fetchScopedCrm","submitScopedVendorTask"]){
  const body=fn(name);
  assert.match(body,/\.status===401/,name+" must inspect Core 401");
  assert.match(body,/status:401,error:"MFA_REQUIRED"/,name);
 }
 // 403 stays 403 and a Core body is never forwarded on rejection.
 assert.match(fn("fetchScopedCrm"),/r\.status===403\?403:503/);
 assert.match(fn("fetchOwnerFinancePreview"),/r\.status===403\?403:503/);
});

test("sign-in links on protected screens carry their own return path; 403 is not a login loop",()=>{
 assert.match(read("../app/vendor360/page.tsx"),/withReturn\("\/login","\/vendor360"\)/);
 assert.match(read("../app/finance/page.tsx"),/withReturn\("\/login","\/finance"\)/);
 assert.match(read("../app/finance/[orderId]/page.tsx"),/withReturn\("\/login","\/finance\/"\+orderId\)/);
 for(const [f,path] of [["../app/acquisition/page.tsx","/acquisition"],
   ["../app/service-desk/page.tsx","/service-desk"]]){
  const s=read(f);
  assert.match(s,new RegExp("r\\.status===401\\?<Link href=\\{withReturn\\(\"/login\",\""+path+"\"\\)\\}"),f);
  assert.match(s,/Back to Mission Control/,f);
  assert.doesNotMatch(s,/<Link href="\/login">/,f);
 }
 const tc=read("../app/vendor360/components/TaskCreator.tsx");
 assert.match(tc,/r\.status===401/);
 assert.match(tc,/withReturn\("\/login","\/vendor360"\)/);
});

test("task creator stays behind its existing flag and adds no new capability",()=>{
 assert.match(read("../app/vendor360/page.tsx"),/VOX_VENDOR_TASK_UI_ENABLED==="staging"\?<TaskCreator/);
});

const built=existsSync(new URL("../.next/BUILD_ID",import.meta.url));
test("compiled HTTP: unauthenticated protected screens offer sign-in with return path",
 {skip:!built&&"requires `npm run build`"},async()=>{
 const port=3193;
 const env={...process.env,NODE_ENV:"production",
  VOX_STAFF_PORTAL_ENABLED:"staging",VOX_STAFF_VIEW_MODE:"scoped",
  VOX_FINANCE_READ_UI_ENABLED:"staging",VOX_FINANCE_DETAIL_READ_UI_ENABLED:"staging",
  VOX_EXPECTED_ORIGIN:"http://127.0.0.1:"+port};
 for(const k of ["VOX_SUPABASE_URL","VOX_SUPABASE_PUBLISHABLE_KEY","VOX_CORE_ORIGIN",
  "DATABASE_URL","SUPABASE_SERVICE_ROLE_KEY"])delete env[k];
 const fix=u=>decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:)/,"$1");
 const cwd=fix(new URL("..",import.meta.url));
 const local=new URL("../node_modules/next/dist/bin/next",import.meta.url);
 const bin=existsSync(local)?fix(local):fix(new URL("../../../node_modules/next/dist/bin/next",import.meta.url));
 const server=spawn(process.execPath,[bin,"start","-H","127.0.0.1","-p",String(port)],
  {cwd,env,stdio:"ignore"});
 try{
  const base="http://127.0.0.1:"+port;
  let up=false;
  for(let i=0;i<60&&!up;i++){
   try{up=(await fetch(base+"/login",{signal:AbortSignal.timeout(1500)})).status===200;}
   catch{await new Promise(r=>setTimeout(r,500));}
  }
  assert.ok(up,"server did not start");
  const get=async p=>{const r=await fetch(base+p,{redirect:"manual",signal:AbortSignal.timeout(8000)});
   return {status:r.status,body:await r.text(),headers:r};};
  const orderId="0b6f1c1e-5f0e-4a58-9d3a-6f2f4a7a9c11";
  const cases=[["/vendor360","/vendor360",/Verified Staff MFA is required/],
   ["/finance","/finance",/Verified Owner session required/],
   ["/finance/"+orderId,"/finance/"+orderId,/Verified Owner session required/],
   ["/acquisition","/acquisition",/Acquisition unavailable/],
   ["/service-desk","/service-desk",/Service Desk unavailable/]];
  for(const [path,next,text] of cases){
   const r=await get(path);
   assert.equal(r.status,200,path);
   assert.match(r.body,text,path);
   assert.ok(r.body.includes('href="/login?next='+encodeURIComponent(next)+'"'),path+" sign-in return link");
   assert.doesNotMatch(r.body,/Bearer |service_role|eyJ[A-Za-z0-9_-]{10}/,path);
   assert.match(r.headers.headers.get("cache-control")??"",/no-store|no-cache|max-age=0/,path);
   // Protected data and the task form are never present without a session.
   assert.doesNotMatch(r.body,/Create internal task|Order preview/,path);
  }
  // The advertised return path round-trips through login without a hostile target.
  const login=await get("/login?next="+encodeURIComponent("/finance/"+orderId));
  assert.equal(login.status,200);
  assert.match(login.body,/Welcome back/);
  // BFF: unauthenticated vendor task is refused, never a 2xx and never a body leak.
  const post=await fetch(base+"/api/vendor-task",{method:"POST",
   headers:{"content-type":"application/json",origin:base,host:"127.0.0.1:"+port},
   body:JSON.stringify({vendorId:orderId,nonce:orderId,taskType:"general",
    title:"Call about site verification",priority:"low",dueAt:new Date().toISOString()}),
   signal:AbortSignal.timeout(8000)});
  assert.ok([401,503].includes(post.status),"unauthenticated task write status "+post.status);
  assert.doesNotMatch(await post.text(),/Bearer |service_role/);
 }finally{server.kill();}
});
