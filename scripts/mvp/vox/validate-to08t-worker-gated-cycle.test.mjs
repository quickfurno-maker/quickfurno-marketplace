import test from "node:test";
import assert from "node:assert/strict";
import {runVoxInternalNotificationCycle as cycle}
 from "../../../worker/voxInternalNotificationCycle.mjs";
import {candidateRpcNames as names}
 from "../../../contracts/vox/notificationOutboxWorker.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-16T11:00:00Z");
const on={portal:"staging",workActions:"staging",notificationWorker:"staging"};
const proof=()=>({kind:"CORE_TRUSTED_DEPLOYMENT_ATTESTATION",
 environment:"staging",scope:"STAFF_INTERNAL_OUTBOX_ONLY",
 independentReviewsVerified:true,signedReleaseDigestVerified:true,
 schemaInstalledAndReviewed:true,expiresAtMs:now+60000});
const inputs=()=>{
 const calls=[],logs=[];
 const rpc=async(name,params)=>{
  calls.push({name,params});
  if(name===names.claim)return {data:[{
   job_id:id(3),work_event_id:id(4),lease_token:id(5),attempt:1
  }]};
  if(name===names.process)return {data:[{job_id:id(3),internal_records:2}]};
  return {error:{code:"NEVER_CALL"}};
 };
 const spec={environment:"staging",featureGates:on,
  verifyDeploymentAuthority:async()=>proof(),rpc,
  workerId:id(1),now,emitObservation:async e=>logs.push(e),maxJobs:2};
 return {spec,calls,logs};
};
test("disabled without feature gates; never contacts Core DB",async()=>{
 const f=inputs();
 for(const env of ["production","dev","local",undefined]){
  const out=await cycle({...f.spec,environment:env});
  assert.equal(out.status,"NOT_ACTIVATED_OR_NOT_STAGING");
 }
 for(const gates of [
  {...on,notificationWorker:"off"},
  {...on,workActions:"disabled"},
  {...on,portal:"off"},
  {...on,ownerOverride:true}
 ]){
  const out=await cycle({...f.spec,featureGates:gates});
  assert.equal(out.ok,false);
 }
 assert.equal(f.calls.length,0);assert.equal(f.logs.length,0);
});
test("missing signed reviewer verifier or Core RPC interface fails closed",async()=>{
 const f=inputs();
 for(const prop of ["verifyDeploymentAuthority","rpc","emitObservation"]){
  const x={...f.spec,[prop]:undefined};
  assert.equal((await cycle(x)).status,"TRUSTED_CORE_DEPLOYMENT_INTERFACE_REQUIRED");
 }
 assert.equal(f.calls.length,0);
});
test("rejected, expired or fabricated attestation never starts queue",async()=>{
 for(const change of [
  {independentReviewsVerified:false},
  {signedReleaseDigestVerified:false},
  {schemaInstalledAndReviewed:false},
  {environment:"production"},
  {scope:"PROVIDER_MESSAGES"},
  {expiresAtMs:now-1},
  {expiresAtMs:now+3600000},
  {isOwner:true}
 ]){
  const f=inputs();
  const out=await cycle({...f.spec,verifyDeploymentAuthority:async()=>({
   ...proof(),...change
  })});
  assert.equal(out.ok,false);
  assert.equal(out.status,"INDEPENDENT_RELEASE_AUTHORITY_REQUIRED");
  assert.equal(f.calls.length,0);
 }
});
test("approval resolver outage must not claim work",async()=>{
 const f=inputs();
 const out=await cycle({...f.spec,verifyDeploymentAuthority:async()=>{
  throw Error("external reviewer evidence not available");
 }});
 assert.equal(out.status,"SIGNED_RELEASE_PROOF_UNAVAILABLE");
 assert.equal(f.calls.length,0);
});
test("bounded valid fixture executes one internal Core-only claim/process",async()=>{
 const f=inputs();
 const out=await cycle(f.spec);
 assert.equal(out.ok,true);
 assert.equal(out.source,"CORE_INTERNAL_WORK_ONLY");
 assert.equal(out.jobsClaimed,1);
 assert.equal(out.jobsProcessed,1);
 assert.equal(out.internalRecords,2);
 assert.equal(out.externalMessagesSent,0);
 assert.equal(out.pushDeliveriesVerified,0);
 assert.equal(out.releaseCertified,false);
 assert.equal(f.calls.length,2);
 assert.equal(f.calls[0].name,names.claim);
 assert.equal(f.calls[1].name,names.process);
 assert.equal(f.logs.length,1);
 assert.deepEqual(f.logs[0],out);
});
test("even approved fixture may only ask for ten bounded jobs",async()=>{
 for(const n of [0,11,-1,1.25]){
  const f=inputs();
  assert.equal((await cycle({...f.spec,maxJobs:n})).status,
   "TRUSTED_CORE_DEPLOYMENT_INTERFACE_REQUIRED");
  assert.equal(f.calls.length,0);
 }
});
test("a malformed Core processing response never results in false delivery",async()=>{
 const f=inputs();
 const rpc=async(name)=>{
  if(name===names.claim)return {data:[{job_id:id(3),
   work_event_id:id(4),lease_token:id(5),attempt:1}]};
  return {data:[{job_id:id(99),internal_records:100}]};
 };
 const out=await cycle({...f.spec,rpc});
 assert.equal(out.ok,false);
 assert.equal(out.status,"PARTIAL_UNVERIFIED");
 assert.equal(out.internalRecords,0);
 assert.equal(out.externalMessagesSent,0);
});
test("observability failures never roll back or double-process DB jobs",async()=>{
 const f=inputs();
 const out=await cycle({...f.spec,emitObservation:async()=>{
  throw Error("AGNI down");
 }});
 assert.equal(out.jobsProcessed,1);
 assert.equal(f.calls.length,2);
 assert.equal(out.ok,true);
});
test("no scheduled timer, WhatsApp, push or credentials in source",async()=>{
 const {readFileSync}=await import("node:fs");
 const f=readFileSync(new URL("../../../worker/voxInternalNotificationCycle.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(f,/setInterval\(|setTimeout\(|sendWhatsApp\(|sendPush\(|SERVICE_ROLE_KEY|NEXT_PUBLIC_/);
});
