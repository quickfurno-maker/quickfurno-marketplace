import test from "node:test";import assert from "node:assert/strict";
import {runApprovedStagingOutboxCycles as run}
 from "../../../worker/voxInternalNotificationSupervisor.mjs";
import {candidateRpcNames as n}
 from "../../../contracts/vox/notificationOutboxWorker.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const gates={portal:"staging",workActions:"staging",notificationWorker:"staging"};
const valid=()=>({kind:"CORE_TRUSTED_DEPLOYMENT_ATTESTATION",
 environment:"staging",scope:"STAFF_INTERNAL_OUTBOX_ONLY",
 independentReviewsVerified:true,signedReleaseDigestVerified:true,
 schemaInstalledAndReviewed:true,expiresAtMs:Date.now()+60000});
const setup=()=>{
 let claimCount=0,approvals=0;const observations=[];
 const rpc=async(name)=>{
  if(name===n.claim){claimCount++;return {data:[{
   job_id:id(100+claimCount),work_event_id:id(200+claimCount),
   lease_token:id(300+claimCount),attempt:1}]};}
  if(name===n.process)return {data:[{job_id:id(100+claimCount),internal_records:1}]};
  throw Error("NO_EXTERNAL_API");
 };
 const args={environment:"staging",featureGates:gates,
  verifyDeploymentAuthority:async()=>{approvals++;return valid();},
  rpc,workerId:id(1),emitObservation:async e=>observations.push(e),
  shouldContinue:async()=>true,maxCycles:3,maxJobs:2};
 return {args,observations,get claims(){return claimCount;},
  get authorizations(){return approvals;}};
};
test("supervisor demands bounded approved staging, never production",async()=>{
 const f=setup();
 for(const args of [{environment:"production"},{maxCycles:21},
  {shouldContinue:null},{rpc:null},{maxJobs:0}]){
  assert.equal((await run({...f.args,...args})).ok,false);
 }
 assert.equal(f.claims,0);
});
test("bounded three cycles each separately rechecks authorization",async()=>{
 const f=setup();const r=await run(f.args);
 assert.equal(r.ok,true);assert.equal(r.cycles,3);
 assert.equal(r.totalInternalRecords,3);assert.equal(r.totalExternalMessagesSent,0);
 assert.equal(f.claims,3);assert.equal(f.authorizations,3);
 assert.equal(f.observations.length,3);
});
test("fresh revocation stops third claim; never continues on stale approval",async()=>{
 const f=setup();let count=0;
 const r=await run({...f.args,verifyDeploymentAuthority:async()=>{
  count++;return {...valid(),independentReviewsVerified:count<3};
 }});
 assert.equal(r.ok,false);assert.equal(r.cycles,2);
 assert.equal(f.claims,2);assert.equal(r.totalExternalMessagesSent,0);
});
test("graceful stop avoids further Core requests",async()=>{
 const f=setup();const r=await run({...f.args,
  shouldContinue:async i=>i<1});
 assert.equal(r.ok,true);assert.equal(r.cycles,1);
 assert.equal(f.claims,1);
});
test("invalid receipt prevents next batch regardless of telemetry outcome",async()=>{
 const f=setup();const r=await run({...f.args,rpc:async(name)=>{
  if(name===n.claim)return {data:[{job_id:id(3),
   work_event_id:id(4),lease_token:id(5),attempt:1}]};
  return {data:[{job_id:id(99),internal_records:99}]};
 }});
 assert.equal(r.ok,false);assert.equal(r.cycles,0);
 assert.equal(r.totalExternalMessagesSent,0);
});
