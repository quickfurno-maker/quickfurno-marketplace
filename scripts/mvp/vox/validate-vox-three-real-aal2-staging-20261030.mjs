import assert from "node:assert/strict";
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
function claims(token){
 const parts=token.split(".");
 if(parts.length!==3)throw Error("INVALID_SESSION_FORMAT");
 const payload=JSON.parse(Buffer.from(parts[1],"base64url").toString("utf8"));
 if(payload?.aal!=="aal2"||typeof payload?.sub!=="string")throw Error("REQUIRES_GENUINE_AAL2");
 return {sub:payload.sub,exp:payload.exp};
}
const actor=tokens.map(claims);
assert.equal(new Set(actor.map(x=>x.sub)).size,3,"REAL_DISTINCT_PRINCIPALS_REQUIRED");
assert.ok(actor.every(x=>Number.isFinite(x.exp)&&x.exp>Math.floor(Date.now()/1000)+60),"SESSION_EXPIRING");
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
