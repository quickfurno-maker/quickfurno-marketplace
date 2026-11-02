// RC35: Staff session recovery. Unit + source checks always run; the compiled
// HTTP checks run against a real `next start` loopback server when a production
// build exists (.next/BUILD_ID) and never touch managed URLs or credentials.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {spawn} from "node:child_process";
import {safeReturnPath,withReturn} from "../lib/returnTo.mjs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");

test("safeReturnPath accepts only bounded same-origin staff paths",()=>{
 for(const ok of ["/team/command-center","/team","/operations","/team/eod-reviews"])
  assert.equal(safeReturnPath(ok),ok);
 for(const bad of ["//evil.com","/\\evil.com","https://evil.com","javascript:alert(1)",
  "/team/../api/auth","/team/%2e%2e","/team?x=1","/team#x","/login","/api/overview",
  "/team/"+"a".repeat(120),"team/command-center","",null,undefined,42,{},"/TEAM",
  "/team/a/b/c/d","/team\n/x"])
  assert.equal(safeReturnPath(bad),null,String(bad));
 assert.equal(safeReturnPath(["/team","/x"]),"/team");
 assert.equal(withReturn("/mfa","/team/command-center"),"/mfa?next=%2Fteam%2Fcommand-center");
 assert.equal(withReturn("/mfa","https://evil.com"),"/mfa");
});

test("Core 401 is mapped to 401 without forwarding any body; 403/5xx unchanged",()=>{
 const src=read("../lib/core.ts");
 const fn=src.slice(src.indexOf("export async function fetchStaffWorkQueuePreview"));
 const block=fn.slice(0,fn.indexOf("const data:unknown"));
 assert.match(block,/response\.status===401\?401:response\.status===403\?403:503/);
 assert.match(block,/error:response\.status===401\?"MFA_REQUIRED"/);
 assert.doesNotMatch(block,/response\.(text|json)\(/);
});

test("login and MFA carry only a sanitized return path",()=>{
 for(const f of ["../app/login/page.tsx","../app/mfa/page.tsx"])
  assert.match(read(f),/safeReturnPath\(\(await searchParams\)\.next\)/);
 assert.match(read("../app/login/form.tsx"),/withReturn\("\/mfa", next\)/);
 assert.match(read("../app/mfa/form.tsx"),/safeReturnPath\(next\)\?\?"\/operations"/);
 assert.match(read("../app/team/command-center/page.tsx"),/withReturn\("\/login","\/team\/command-center"\)/);
});

const built=existsSync(new URL("../.next/BUILD_ID",import.meta.url));
test("compiled HTTP: command center offers sign-in, login/MFA never navigate to hostile next",{skip:!built&&"requires `npm run build`"},async()=>{
 const port=3191;
 const env={...process.env,NODE_ENV:"production",
  VOX_STAFF_PORTAL_ENABLED:"staging",VOX_STAFF_VIEW_MODE:"scoped",
  VOX_WORK_QUEUE_UI_ENABLED:"staging",VOX_EXPECTED_ORIGIN:"http://127.0.0.1:"+port};
 for(const k of ["VOX_SUPABASE_URL","VOX_SUPABASE_PUBLISHABLE_KEY","VOX_CORE_ORIGIN",
  "DATABASE_URL","SUPABASE_SERVICE_ROLE_KEY"])delete env[k];
 const cwd=new URL("..",import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1");
 const nextBin=new URL("../node_modules/next/dist/bin/next",import.meta.url);
 const bin=existsSync(nextBin)?nextBin.pathname.replace(/^\/([A-Za-z]:)/,"$1"):
  new URL("../../../node_modules/next/dist/bin/next",import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1");
 const server=spawn(process.execPath,[decodeURIComponent(bin),"start","-H","127.0.0.1","-p",String(port)],
  {cwd:decodeURIComponent(cwd),env,stdio:"ignore"});
 try{
  const base="http://127.0.0.1:"+port;
  let up=false;
  for(let i=0;i<60&&!up;i++){
   try{up=(await fetch(base+"/login",{signal:AbortSignal.timeout(1500)})).status===200;}
   catch{await new Promise(r=>setTimeout(r,500));}
  }
  assert.ok(up,"server did not start");
  const get=async p=>{const r=await fetch(base+p,{redirect:"manual",signal:AbortSignal.timeout(8000)});return {status:r.status,body:await r.text(),headers:r.headers};};

  const cc=await get("/team/command-center");
  assert.equal(cc.status,200);
  assert.match(cc.body,/Sign in again to continue/);
  assert.match(cc.body,/href="\/login\?next=%2Fteam%2Fcommand-center"/);
  assert.match(cc.body,/role="status"/);
  assert.doesNotMatch(cc.body,/Bearer |service_role|eyJ[A-Za-z0-9_-]{10}/);

  const login=await get("/login?next=%2Fteam%2Fcommand-center");
  assert.equal(login.status,200);
  assert.match(login.body,/Welcome back/);
  for(const hostile of ["//evil.com","https://evil.com","/team/..%2fapi","javascript:alert(1)"]){
   for(const page of ["/login","/mfa"]){
    const r=await get(page+"?next="+encodeURIComponent(hostile));
    assert.equal(r.status,200,page+" "+hostile);
    // Next.js may serialize the incoming query string in the RSC stream;
    // prohibit hostile *navigation targets*, not literal request echo.
    assert.doesNotMatch(r.body,/\b(?:href|action)="(?:(?:https?:)?\/\/evil\.com|javascript:)/i,page+" unsafe navigation "+hostile);
    assert.notEqual(r.headers.get("location"),hostile,page+" unsafe redirect "+hostile);
   }
  }
  assert.equal((await get("/mfa?next=%2Fteam%2Fcommand-center")).status,200);
  assert.match(cc.headers.get("cache-control")??"",/no-store/);
 }finally{server.kill();}
});
