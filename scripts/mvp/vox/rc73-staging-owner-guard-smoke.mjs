#!/usr/bin/env node
// Real Staging loopback HTTP proof: UNAUTHENTICATED GET requests only.
// Caller must execute on approved Staging host; never pass JWT/cookies,
// query or private data. Denial does not certify authenticated Owner actions.
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
const SAFE_PORTS=new Set(["3323","3324","3325"]);
const PATHS=Object.freeze(["/","/login","/mfa","/mfa/enroll",
 "/operations","/vendor360","/api/auth/mfa"]);
const bad=()=>{throw Error("RC73_OWNER_READONLY_PROBE_INVALID_OR_EXPOSED");};
export async function validateOwnerAccessGuard(base,request){
 if(typeof base!=="string"||typeof request!=="function")bad();
 let u;
 try{u=new URL(base);}catch{bad();}
 if(u.protocol!=="http:"||u.hostname!=="127.0.0.1"||
    !SAFE_PORTS.has(u.port)||u.pathname!=="/"||u.search||u.hash||u.username||u.password)bad();
 const results=[];
 for(const path of PATHS){
  const response=await request(u.origin+path,{
   method:"GET",redirect:"manual",cache:"no-store",
   signal:AbortSignal.timeout(3500),
   headers:{accept:"text/html,application/json"}
  });
  if(response.status!==403)bad();
  results.push({path,status:403});
 }
 return {schema:"qf.vox.rc73.staging-owner-unauthenticated-denial.v1",
  checks:results.length,results,identityBypass:false,
  authenticatedOwnerVerified:false,mutations:false,
  financialOperations:false,providerMessaging:false,
  officialEod:false,releaseGo:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||!SAFE_PORTS.has(process.argv[2]))bad();
  const result=await validateOwnerAccessGuard(
   "http://127.0.0.1:"+process.argv[2]+"/",fetch);
  console.log(JSON.stringify(result,null,2));
  console.log("RC73_STAGING_OWNER_READ_ONLY_GUARD_PASS_RELEASE_HOLD");
 }catch{
  console.error("RC73_STAGING_OWNER_GUARD_FAILED");
  process.exitCode=1;
 }
}
