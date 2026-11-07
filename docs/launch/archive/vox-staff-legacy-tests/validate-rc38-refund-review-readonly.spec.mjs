// RC38: Owner read-only refund intake status page. Source checks always run;
// compiled HTTP checks run against a real loopback `next start` when a
// production build exists. No managed URLs, credentials or provider network.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {spawn} from "node:child_process";
import {safeReturnPath,withReturn} from "../lib/returnTo.mjs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");

test("refund review page is status-only: no client code, forms, buttons or write call",()=>{
 const page=read("../app/finance/refund-review/page.tsx");
 assert.doesNotMatch(page,/"use client"|<button|<form|<input|method:\s*"POST"|fetch\(/i);
 assert.doesNotMatch(page,/paymentId|providerOrderId/);
 assert.match(page,/withReturn\("\/login","\/finance\/refund-review"\)/);
 assert.equal(safeReturnPath("/finance/refund-review"),"/finance/refund-review");
 assert.equal(withReturn("/login","/finance/refund-review"),
  "/login?next="+encodeURIComponent("/finance/refund-review"));
});

test("Core client is GET-only, double flag gated, strict and drops provider IDs",()=>{
 const src=read("../lib/core.ts");
 const a=src.indexOf("export async function fetchOwnerRefundIntakePreview");
 assert.ok(a>=0);
 const body=src.slice(a);
 assert.match(body,/VOX_FINANCE_REFUND_REVIEW_PREVIEW_UI_ENABLED!=="staging"/);
 assert.match(body,/VOX_FINANCE_READ_UI_ENABLED!=="staging"/);
 assert.match(body,/method:"GET"/);
 assert.doesNotMatch(body,/method:"(POST|PUT|PATCH|DELETE)"/);
 assert.match(body,/\.status===401|r\.status===401/);
 for(const k of ["canReview","canRefund","canRevokeCredits","isCompleteHistory"])
  assert.match(body,new RegExp(k+"!==false"));
 assert.doesNotMatch(body,/paymentId:|providerOrderId:/);
 assert.doesNotMatch(body,/console\./);
});

test("flag stays disabled by default and finance link is flag-gated",()=>{
 assert.match(read("../.env.example"),/^VOX_FINANCE_REFUND_REVIEW_PREVIEW_UI_ENABLED=disabled$/m);
 assert.match(read("../app/finance/page.tsx"),
  /VOX_FINANCE_REFUND_REVIEW_PREVIEW_UI_ENABLED==="staging"\?<>/);
});

test("work-queue session expiry returns to the work queue, not a bare login",()=>{
 const s=read("../app/team/work-queue/WorkActionControl.tsx");
 assert.match(s,/withReturn\("\/login","\/team\/work-queue"\)/);
 assert.doesNotMatch(s,/<Link href="\/login">/);
 assert.equal(safeReturnPath("/team/work-queue"),"/team/work-queue");
});

const built=existsSync(new URL("../.next/BUILD_ID",import.meta.url));
const fix=u=>decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:)/,"$1");
async function withServer(port,extra,fn){
 const env={...process.env,NODE_ENV:"production",VOX_STAFF_PORTAL_ENABLED:"staging",
  VOX_STAFF_VIEW_MODE:"owner",VOX_EXPECTED_ORIGIN:"http://127.0.0.1:"+port,...extra};
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

test("compiled HTTP: flag OFF shows a clear HOLD, no sign-in prompt, no actions",
 {skip:!built&&"requires `npm run build`"},()=>withServer(3194,{},async base=>{
 const r=await page(base,"/finance/refund-review");
 assert.equal(r.status,200);
 assert.match(r.body,/Refund review HOLD/);
 assert.match(r.body,/no refund, review or credit action/);
 assert.doesNotMatch(r.body,/<button|<form|Owner sign-in|Quarantined refund events/);
 assert.doesNotMatch(r.body,/Bearer |service_role|eyJ[A-Za-z0-9_-]{10}/);
 assert.match(r.cache,/no-store|no-cache|max-age=0/);
 const fin=await page(base,"/finance");
 assert.doesNotMatch(fin.body,/Refund intake status/);
}));

test("compiled HTTP: flag ON without a verified Owner session requires sign-in, never data",
 {skip:!built&&"requires `npm run build`"},()=>withServer(3195,
 {VOX_FINANCE_READ_UI_ENABLED:"staging",VOX_FINANCE_REFUND_REVIEW_PREVIEW_UI_ENABLED:"staging"},async base=>{
 const r=await page(base,"/finance/refund-review");
 assert.equal(r.status,200);
 assert.match(r.body,/Verified Owner session required/);
 assert.ok(r.body.includes('href="/login?next='+encodeURIComponent("/finance/refund-review")+'"'));
 assert.doesNotMatch(r.body,/<button|<form|Quarantined refund events|QUARANTINED/);
 assert.doesNotMatch(r.body,/Bearer |service_role|eyJ[A-Za-z0-9_-]{10}|pay_|order_/);
 assert.match(r.cache,/no-store|no-cache|max-age=0/);
}));
