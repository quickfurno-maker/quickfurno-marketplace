/** F9 loopback-only compiled Next smoke: no DB, Meta, WhatsApp, OTP, staff or credentials. */
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import net from "node:net";
import {setTimeout as delay} from "node:timers/promises";

const HOST="127.0.0.1";
const env={...process.env,NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1"};
for(const n of Object.keys(env)){
 if(/SUPABASE|GOOGLE|META_|WHATSAPP|RAZORPAY|STRIPE|TWILIO|CLOUDFLARE|RESEND|SENDGRID|VOX_OWNER_WHATSAPP_READINESS_ENABLED/i.test(n))delete env[n];
}
env.NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:9";
env.NEXT_PUBLIC_SUPABASE_ANON_KEY="qf-local-smoke-nonfunctional-public-key";
const port=await new Promise((resolve,reject)=>{
 const s=net.createServer();s.once("error",reject);
 s.listen(0,HOST,()=>{const a=s.address();s.close(()=>resolve(a.port))});
});
const base=`http://${HOST}:${port}`;
const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H",HOST,"-p",String(port)],{
 cwd:process.cwd(),env,stdio:["ignore","pipe","pipe"],windowsHide:true,
});
let output="";
child.stdout.on("data",b=>{output=(output+b.toString()).slice(-2000)});
child.stderr.on("data",b=>{output=(output+b.toString()).slice(-2000)});
try{
 let ready=false;
 for(let i=0;i<70;i++){
  if(child.exitCode!==null)break;
  try{
   const r=await fetch(base+"/api/vox/v1/owner-whatsapp-launch-readiness",{
    signal:AbortSignal.timeout(1500),redirect:"manual"});
   if(r.status===503){ready=true;break}
  }catch{}
  await delay(350);
 }
 assert.ok(ready,"Next local route did not become 503. "+output);
 const route="/api/vox/v1/owner-whatsapp-launch-readiness";
 for(const [method,code,label] of [
  ["GET",503,"OWNER_WHATSAPP_READINESS_DISABLED"],
  ["POST",405,"READ_ONLY"],
  ["PUT",405,"READ_ONLY"],
  ["PATCH",405,"READ_ONLY"],
  ["DELETE",405,"READ_ONLY"],
 ]){
  const r=await fetch(base+route,{method,redirect:"manual",signal:AbortSignal.timeout(4500)});
  assert.equal(r.status,code,`Unexpected ${method} status`);
  const raw=await r.text();
  assert.match(raw,new RegExp(label));
  assert.equal(r.headers.get("cache-control"),"private, no-store, max-age=0");
  assert.equal(r.headers.get("x-content-type-options"),"nosniff");
  console.log("PASS F9 compiled Owner endpoint "+method+" = "+code);
 }
 console.log("F9_LOOPBACK_NO_SEND_PASS checks=5 no_credentials=true no_provider_sends=true production_unchanged=true");
}catch(e){
 console.error("F9_LOOPBACK_NO_SEND_FAIL",String(e).slice(0,550));process.exitCode=1;
}finally{child.kill()}
