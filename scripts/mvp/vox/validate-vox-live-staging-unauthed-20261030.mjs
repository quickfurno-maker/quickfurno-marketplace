import assert from "node:assert/strict";

const ORIGIN="https://staging-core.quickfurno.in";
const mode=process.argv.includes("--post-deploy")?"post":"pre";
const protectedGet=[
 ["/livez",200],["/readyz",200],
 ["/api/vox/v1/overview",401],
 ["/api/vox/v1/aos-health",403],
 ["/api/vox/v1/owner-studio-simulate?workflowKey=client_journey",403],
 ...["acquisition","vendor360","desk","my-work"].map(x=>["/api/vox/v1/"+x,503]),
 ["/api/vox/v1/studio-simulate?workflowKey=client_journey",503],
 ...["staff-directory","staff-review-queue","owner-approval-queue"].map(x=>["/api/vox/v1/"+x,503]),
 ...["work-queue","staff-capability-catalog"].map(x=>["/api/vox/v1/"+x,mode==="post"?503:404]),
];
let count=0;
async function request(path,expected,headers={}){
 const url=new URL(path,ORIGIN);
 assert.equal(url.origin,ORIGIN);
 const response=await fetch(url,{method:"GET",headers,redirect:"manual",signal:AbortSignal.timeout(5500),cache:"no-store"});
 const text=await response.text();
 assert.equal(response.status,expected,path+" expected "+expected+" got "+response.status);
 assert.ok(text.length<25000,path+" returned oversized response");
 assert.doesNotMatch(text,/(SUPABASE_SERVICE_ROLE_KEY|BEGIN PRIVATE KEY|Bearer eyJ|api_secret)/i,path+" leaked credentials");
 if(response.status>=400&&response.status!==404){
  assert.match(response.headers.get("content-type")||"",/application\/json/,path+" protected response should be JSON");
 }
 console.log("PASS",response.status,path);count++;
}
for(const [path,expected] of protectedGet)await request(path,expected);
for(const [path,expected] of [
 ["/api/vox/v1/overview",401],
 ["/api/vox/v1/aos-health",403],
 ["/api/vox/v1/owner-studio-simulate?workflowKey=client_journey",403]
])await request(path,expected,{authorization:"Bearer malformed.invalid.jwt"});
console.log("VOX_LIVE_STAGING_UNAUTH_NEGATIVE_MATRIX_PASS "+count+"/"+count+" mode="+mode);
