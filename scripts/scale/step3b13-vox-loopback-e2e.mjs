// 3B13 actual loopback Next.js production-mode negative HTTP E2E.
// No external endpoints, managed databases, privileged sessions, or test data writes.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const WEB=resolve(ROOT,"apps/vox-web");
const BIN=resolve(WEB,"node_modules/next/dist/bin/next");
const PORT=3713, BASE="http://127.0.0.1:"+PORT;
const built=resolve(WEB,".next/BUILD_ID");
assert.ok(existsSync(BIN)&&existsSync(built),"First run isolated VOX Web production build; no dev/synthetic substitute");
const permitted=["PATH","Path","SystemRoot","windir","TEMP","TMP","APPDATA","LOCALAPPDATA","USERPROFILE"];
const env=Object.fromEntries(permitted.filter(k=>typeof process.env[k]==="string").map(k=>[k,process.env[k]]));
Object.assign(env,{NODE_ENV:"production",VOX_DEMO_PREVIEW:"off",
  VOX_STAFF_PORTAL_ENABLED:"off",VOX_TEAM_WORKSPACE_ENABLED:"off",
  VOX_STAFF_VIEW_MODE:"off",VOX_FINANCE_PAY4B_SEARCH_UI_ENABLED:"off",
  VOX_OPERATIONAL_DECISIONS_ENABLED:"off",VOX_EOD_PREVIEW_UI_ENABLED:"off"});
let output="";
const child=spawn(process.execPath,[BIN,"start","--hostname","127.0.0.1","--port",String(PORT)],{
 cwd:WEB,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
const log=d=>{if(output.length<5000)output+=String(d).slice(0,1000)};
child.stdout.on("data",log);child.stderr.on("data",log);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,init={}){return fetch(BASE+path,{redirect:"manual",signal:AbortSignal.timeout(5000),...init});}
try{
 let started=false;
 for(let i=0;i<55;i++){
  if(child.exitCode!==null)throw Error("Next exited "+child.exitCode+": "+output.slice(-1500));
  try{const r=await call("/api/health");if(r.status===200){started=true;break}}catch{}
  await wait(400);
 }
 assert.ok(started,"Next did not expose locked /api/health: "+output.slice(-1500));
 const checks=[
  {path:"/api/health",status:[200],body:/source-shell-only/},
  {path:"/",status:[200],body:/VOX is being prepared\./},
  {path:"/preview/staff-management",status:[404],body:/404|not found|could not be found/i},
  {path:"/team/admin/staff",status:[200],body:/Staff setup not available|Sign in using your verified MFA session/},
  {path:"/api/finance-orders",status:[503],body:/FINANCE_ORDERS_UNAVAILABLE/},
  {path:"/api/overview",status:[401,403,503],body:/"ok":false/},
  {path:"/api/action-intents",method:"POST",status:[403],body:/ORIGIN_DENIED/},
  {path:"/api/overview",method:"POST",status:[405],body:/READ_ONLY/},
 ];
 for(const c of checks){
  const r=await call(c.path,c.method?{method:c.method,headers:{"content-type":"application/json"},body:"{}"}:{});
  const body=await r.text();
  assert.ok(c.status.includes(r.status),c.path+" "+r.status+" "+body.slice(0,120));
  assert.match(body,c.body,c.path+" response guard mismatch");
  assert.doesNotMatch(body,/service_role|eyJ[A-Za-z0-9_-]{50}|BEGIN PRIVATE KEY/,
    c.path+" unexpected sensitive content");
  console.log("PASS "+(c.method??"GET")+" "+c.path+" -> "+r.status);
 }
 console.log("STEP3B13_REAL_LOOPBACK_NEXT_PRODUCTION_FAIL_CLOSED "+checks.length+"/"+checks.length+" PASS");
}finally{
 child.kill();
 await wait(700);
 console.log("VOX_LOOPBACK_PROCESS_STOP_REQUESTED");
}
