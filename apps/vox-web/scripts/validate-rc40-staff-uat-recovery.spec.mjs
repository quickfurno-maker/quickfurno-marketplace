// RC40: Staff UAT route recovery. A 401 (no verified MFA) and a 403 (Core said
// no) must be shown separately; only a 401 offers sign-in and that sign-in must
// return to the screen the Staff member was on. Source checks always run;
// compiled HTTP checks run against a real loopback `next start` when a
// production build exists. No managed URLs, credentials or provider network.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {spawn} from "node:child_process";
import {safeReturnPath,withReturn} from "../lib/returnTo.mjs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");

const TEAM_PAGES=[
 ["../app/team/page.tsx","/team"],
 ["../app/team/attention/page.tsx","/team/attention"],
 ["../app/team/chat/page.tsx","/team/chat"],
 ["../app/team/daily-report/page.tsx","/team/daily-report"],
 ["../app/team/eod-submissions/page.tsx","/team/eod-submissions"],
 ["../app/team/eod-reviews/page.tsx","/team/eod-reviews"],
 ["../app/team/notifications/page.tsx","/team/notifications"],
 ["../app/team/work-queue/page.tsx","/team/work-queue"],
 ["../app/team/admin/staff/page.tsx","/team/admin/staff"]];

test("every Team screen with a Staff sign-in link passes its own return path",()=>{
 for(const [f,path] of TEAM_PAGES){
  assert.equal(safeReturnPath(path),path,path+" must pass the login allow-list");
  assert.ok(read(f).includes('<StaffSignInLink status={'),f);
  assert.match(read(f),new RegExp('returnTo="'+path+'"/>'),f);
 }
 assert.equal(withReturn("/login","/team/eod-reviews"),
  "/login?next="+encodeURIComponent("/team/eod-reviews"));
});

test("StaffSignInLink: 401 only, return-aware, never a bare login and never on 403",()=>{
 const s=read("../app/components/StaffSignInLink.tsx");
 assert.match(s,/status===401\?/);
 assert.match(s,/withReturn\("\/login",returnTo\)/);
 assert.doesNotMatch(s,/href="\/login"/);
 assert.doesNotMatch(s,/status===403/);
 assert.doesNotMatch(s,/fetch\(|"use client"/);
});

test("Service Desk shows 401 MFA, 403 forbidden and unavailable as separate states",()=>{
 const s=read("../app/service-desk/page.tsx");
 assert.match(s,/r\.status===401\?"Verified Staff MFA is required/);
 assert.match(s,/r\.status===403\?\s*"Your current Staff assignment/);
 assert.match(s,/currently unavailable\. No case or conversation was modified/);
 // The generic one-size-fits-all sentence is gone.
 assert.doesNotMatch(s,/AAL2 staff sign-in, an assigned Core vendor\/case/);
 // Only the 401 branch links to sign-in; everything else returns to Mission Control.
 assert.match(s,/r\.status===401\?<Link href=\{withReturn\("\/login","\/service-desk"\)\}>/);
 assert.match(s,/Back to Mission Control/);
});

test("Vendor 360, Finance refund review and EOD pages keep 401 and 403 copy distinct",()=>{
 const v=read("../app/vendor360/page.tsx");
 assert.match(v,/r\.status===401\?"Verified Staff MFA is required\."/);
 assert.match(v,/r\.status===403\?\s*"Your current Staff assignment does not authorize/);
 const f=read("../app/finance/refund-review/page.tsx");
 assert.match(f,/needsLogin\?"Verified Owner session required"/);
 assert.match(f,/forbidden\?"Owner finance access required"/);
 for(const p of ["../app/team/eod-submissions/page.tsx","../app/team/eod-reviews/page.tsx"]){
  const e=read(p);
  assert.match(e,/r\.status===401\?/,p);
  assert.match(e,/r\.status===403\?/,p);
 }
});

test("RC40 adds no write capability, flag activation or Staff identity",()=>{
 for(const p of ["../app/components/StaffSignInLink.tsx","../app/service-desk/page.tsx"]){
  assert.doesNotMatch(read(p),/method:\s*"(POST|PUT|PATCH|DELETE)"/,p);
 }
 const env=read("../.env.example");
 for(const k of ["VOX_FINANCE_REFUND_REVIEW_PREVIEW_UI_ENABLED"])
  assert.match(env,new RegExp("^"+k+"=disabled$","m"),k);
 assert.doesNotMatch(env,/^VOX_[A-Z_]*(CREDIT|REFUND_WRITE|EOD_PUBLISH)[A-Z_]*=staging$/m);
});

const built=existsSync(new URL("../.next/BUILD_ID",import.meta.url));
const fix=u=>decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:)/,"$1");
async function withServer(port,extra,fn){
 const env={...process.env,NODE_ENV:"production",VOX_STAFF_PORTAL_ENABLED:"staging",
  VOX_STAFF_VIEW_MODE:"scoped",VOX_EXPECTED_ORIGIN:"http://127.0.0.1:"+port,...extra};
 for(const k of ["VOX_SUPABASE_URL","VOX_SUPABASE_PUBLISHABLE_KEY","VOX_CORE_ORIGIN",
  "DATABASE_URL","SUPABASE_SERVICE_ROLE_KEY"])delete env[k];
 const local=new URL("../node_modules/next/dist/bin/next",import.meta.url);
 const bin=existsSync(local)?fix(local):fix(new URL("../../../node_modules/next/dist/bin/next",import.meta.url));
 const server=spawn(process.execPath,[bin,"start","-H","127.0.0.1","-p",String(port)],
  {cwd:fix(new URL("..",import.meta.url)),env,stdio:"ignore"});
 try{
  const base="http://127.0.0.1:"+port;
  let up=false;
  for(let i=0;i<60&&!up;i++){
   try{up=(await fetch(base+"/login",{signal:AbortSignal.timeout(1500)})).status===200;}
   catch{await new Promise(r=>setTimeout(r,500));}
  }
  assert.ok(up,"server did not start");
  await fn(base);
 }finally{server.kill();}
}
const page=async(base,p)=>{const r=await fetch(base+p,{redirect:"manual",signal:AbortSignal.timeout(8000)});
 return {status:r.status,body:await r.text(),cache:r.headers.get("cache-control")??""};};
const LEAK=/Bearer |service_role|eyJ[A-Za-z0-9_-]{10}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

test("compiled HTTP: unauthenticated Staff routes show 401 MFA recovery that returns to the same screen",
 {skip:!built&&"requires `npm run build`"},()=>withServer(3196,{
 VOX_TEAM_WORKSPACE_ENABLED:"staging",VOX_EOD_SUBMIT_UI_ENABLED:"staging",
 VOX_EOD_TL_REVIEW_UI_ENABLED:"staging"},async base=>{
 const cases=[
  ["/team/eod-submissions",/A verified Staff MFA session is required/],
  ["/team/eod-reviews",/Use your verified MFA session/],
  ["/service-desk",/Verified Staff MFA is required to open the Service Desk/],
  ["/vendor360",/Verified Staff MFA is required/]];
 for(const [path,text] of cases){
  const r=await page(base,path);
  assert.equal(r.status,200,path);
  assert.match(r.body,text,path);
  assert.ok(r.body.includes('href="/login?next='+encodeURIComponent(path)+'"'),path+" return link");
  // 403 and generic-outage wording must not appear for a plain 401.
  assert.doesNotMatch(r.body,/does not authorize|Core denied your current|Only a different current Core Team Leader|currently unavailable/,path);
  assert.doesNotMatch(r.body,LEAK,path);
  assert.doesNotMatch(r.body,/<textarea|<form/,path+" no action form without a session");
  assert.match(r.cache,/no-store|no-cache|max-age=0/,path);
 }
}));

test("compiled HTTP: disabled EOD routes say so, offer no sign-in loop and no actions",
 {skip:!built&&"requires `npm run build`"},()=>withServer(3197,{},async base=>{
 for(const path of ["/team/eod-submissions","/team/eod-reviews"]){
  const r=await page(base,path);
  assert.equal(r.status,200,path);
  assert.doesNotMatch(r.body,/Staff sign-in/,path);
  assert.doesNotMatch(r.body,/<textarea|<form|Acknowledge|Reject/,path);
  assert.doesNotMatch(r.body,LEAK,path);
  assert.match(r.cache,/no-store|no-cache|max-age=0/,path);
 }
 const sd=await page(base,"/service-desk");
 assert.match(sd.body,/Service Desk unavailable/);
 // The Service Desk itself still requires Staff AAL2 in this loopback fixture;
 // it must not mislabel missing authentication as a generic Core outage.
 assert.match(sd.body,/Verified Staff MFA is required to open the Service Desk/);
 assert.ok(sd.body.includes('href="/login?next=%2Fservice-desk"'));
 assert.doesNotMatch(sd.body,/currently unavailable\. No case or conversation was modified/);
 assert.doesNotMatch(sd.body,/does not authorize your current Staff assignment/);
}));
