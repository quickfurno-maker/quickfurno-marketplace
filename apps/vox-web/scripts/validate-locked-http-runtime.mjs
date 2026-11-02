// VOX: executable production-build HTTP smoke test for the *unconfigured* shell.
// A real loopback server is required. It never uses managed URLs or credentials.
// This is not authenticated Staging E2E and never authorizes release activation.
import assert from "node:assert/strict";
const base=new URL(process.env.VOX_TEST_LOOPBACK_URL??"http://127.0.0.1:3107");
if(base.protocol!=="http:"||!["127.0.0.1","localhost"].includes(base.hostname)||
   base.username||base.password||base.pathname!=="/"||base.search||base.hash)
 throw Error("VOX_SMOKE_LOOPBACK_ONLY");
for(const key of ["DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY",
  "RAZORPAY_LIVE_KEY_SECRET"]){
 if(process.env[key])throw Error("VOX_SMOKE_MANAGED_CREDENTIAL_DENIED_"+key);
}
let pass=0;
async function check(path,status,bodyMatch){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),8000);
 try{
  const r=await fetch(new URL(path,base),{
   method:"GET",redirect:"manual",signal:controller.signal,
   headers:{"accept":"text/html,application/json"}});
  const body=await r.text();
  assert.equal(r.status,status,path+" HTTP status");
  assert.match(body,bodyMatch,path+" protected state");
  assert.doesNotMatch(body,/Bearer eyJ[a-zA-Z0-9_-]{10}|service_role_key/i,
   path+" leaked privileged credentials");
  pass++;
  console.log("PASS "+path+" HTTP "+status);
 }finally{clearTimeout(timeout)}
}
await check("/",200,/VOX is being prepared/);
await check("/operations",200,/Operations unavailable/);
await check("/vendor360",200,/Vendor 360 unavailable/);
await check("/finance",200,/Finance[\s\S]{0,450}unavailable|unavailable[\s\S]{0,450}Finance/i);
for(const path of ["/api/overview","/api/vendor360","/api/service-desk",
                    "/api/action-intents"]){
 await check(path,503,/disabled|unavailable|not enabled|NOT_ENABLED|STAFF|LOCKED/i);
}
console.log("VOX_LOOPBACK_UNCONFIGURED_HTTP_PASS checks="+pass+
 " managed_environment_touched=false release_hold=true");
