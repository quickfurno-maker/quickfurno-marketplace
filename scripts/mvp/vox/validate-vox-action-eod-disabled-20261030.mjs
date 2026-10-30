import assert from "node:assert/strict";
const ORIGIN="https://staging-core.quickfurno.in";
const post=process.argv.includes("--post-deploy");
const cases=[
 {path:"/livez",method:"GET",expected:200},
 {path:"/readyz",method:"GET",expected:200},
 {path:"/api/vox/v1/overview",method:"GET",expected:401},
 {path:"/api/vox/v1/aos-health",method:"GET",expected:403},
 {path:"/api/vox/v1/owner-studio-simulate?workflowKey=client_journey",method:"GET",expected:403},
 ...["/api/vox/v1/work-transitions"].flatMap(path=>[
  {path,method:"GET",expected:post?405:404},
  {path,method:"POST",expected:post?503:404}]),
 ...["/api/vox/v1/eod-preview","/api/vox/v1/eod-source-status"].flatMap(path=>[
  {path,method:"GET",expected:post?503:404},
  {path,method:"POST",expected:post?405:404}]),
];
let passed=0;
for(const c of cases){
 const uri=new URL(c.path,ORIGIN);
 assert.equal(uri.origin,ORIGIN);
 const response=await fetch(uri,{method:c.method,redirect:"manual",cache:"no-store",
  headers:{"x-vox-internal-qa":"readiness-negative-only"},
  signal:AbortSignal.timeout(6500)});
 const responseBody=await response.text();
 assert.equal(response.status,c.expected,c.method+" "+c.path+" expected "+c.expected+" got "+response.status);
 assert.ok(responseBody.length<25000);
 assert.doesNotMatch(responseBody,/SUPABASE_SERVICE_ROLE_KEY|BEGIN PRIVATE KEY|Bearer eyJ/i);
 console.log("PASS",c.method,c.path,response.status);
 passed++;
}
console.log("VOX_ACTION_EOD_DISABLED_STAGING_HTTP_PASS "+passed+"/"+passed+" post="+post);
