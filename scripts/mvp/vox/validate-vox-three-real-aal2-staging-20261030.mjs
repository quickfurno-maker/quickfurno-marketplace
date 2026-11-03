import assert from "node:assert/strict";
import {preflightThreeRealAal2} from "../../../contracts/vox/realAal2StagingPreflight.mjs";
// MANUAL protected Staging UAT, only after real AAL2 and scoped Staff grants.
// Supply bearer tokens through an approved local secret-injection mechanism.
// Never paste tokens into chats, GitHub, Notion, command line flags or logs.
const ORIGIN="https://staging-core.quickfurno.in";
const names=["OWNER","TEAM_LEADER","STAFF"];
const tokens=names.map(n=>process.env["VOX_QA_"+n+"_BEARER"]);
if(tokens.some(t=>typeof t!=="string"||t.length<80)){
 console.error("BLOCKED_MISSING_GENUINE_AAL2_SESSION");
 process.exit(2);
}
// Local JWT decoding is only a preflight: actual bearer verification must be
// performed by the protected Staging Core, not inferred from these claims.
try{
 preflightThreeRealAal2(tokens,{
  expectedIssuer:process.env.VOX_QA_STAGING_AUTH_ISSUER
 });
}catch{
 console.error("BLOCKED_THREE_REAL_AAL2_PREFLIGHT");
 process.exit(2);
}
let tests=0;
async function check(who,path,expected){
 const url=new URL(path,ORIGIN);assert.equal(url.origin,ORIGIN);
 const response=await fetch(url,{method:"GET",headers:{authorization:"Bearer "+tokens[who]},cache:"no-store",redirect:"manual",signal:AbortSignal.timeout(5500)});
 if(typeof expected==="number")assert.equal(response.status,expected,who+":"+path);
 else assert.ok(expected.includes(response.status),who+":"+path+" status "+response.status);
 const body=await response.text();assert.ok(body.length<25000,"oversized response");
 // No user data or tokens printed. Sensitive payload discarded immediately.
 tests++;console.log("PASS",names[who],path,response.status);
}
await check(0,"/api/vox/v1/overview",200);
await check(0,"/api/vox/v1/aos-health",200);
await check(0,"/api/vox/v1/owner-studio-simulate?workflowKey=client_journey",200);
await check(0,"/api/vox/v1/staff-directory",200);
await check(0,"/api/vox/v1/owner-approval-queue",200);
await check(1,"/api/vox/v1/staff-review-queue",200);
await check(2,"/api/vox/v1/work-queue",200);
await check(1,"/api/vox/v1/owner-approval-queue",[401,403]);
await check(2,"/api/vox/v1/owner-approval-queue",[401,403]);
await check(0,"/api/vox/v1/staff-review-queue",[401,403]);
await check(2,"/api/vox/v1/overview",[401,403]);
console.log("VOX_THREE_REAL_PRINCIPAL_AAL2_STAGING_UAT_PASS "+tests+"/"+tests);
