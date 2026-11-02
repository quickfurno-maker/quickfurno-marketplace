import test from "node:test";import assert from "node:assert/strict";
import {runAb7fCoreInternalWorker as run}
 from "../../../worker/voxAb7fIntegratedInternalWorker.mjs";
import {candidateRpcNames as names}
 from "../../../contracts/vox/notificationOutboxWorker.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.now();
const spec=()=>{const calls=[],agni=[];
 return {calls,agni,environment:"staging",enabled:true,now,workerId:id(1),
  featureGates:{portal:"staging",workActions:"staging",
   notificationWorker:"staging"},
  verifyCurrentOperatorAal2:async()=>true,
  verifyDeploymentAuthority:async()=>({
   kind:"CORE_TRUSTED_DEPLOYMENT_ATTESTATION",
   environment:"staging",scope:"STAFF_INTERNAL_OUTBOX_ONLY",
   independentReviewsVerified:true,signedReleaseDigestVerified:true,
   schemaInstalledAndReviewed:true,expiresAtMs:now+60000}),
  emitSanitizedAgniObservation:async x=>agni.push(x),
  rpc:async(name,p)=>{calls.push({name,p});
   if(name===names.claim)return {data:[{job_id:id(2),
    work_event_id:id(3),lease_token:id(4),attempt:1}]};
   if(name===names.process)return {data:[{job_id:id(2),internal_records:1}]};
   return {error:{code:"UNEXPECTED"}};}
 };
};
test("AB7F one signed Core-only transaction; sanitized AGNI read-only telemetry",async()=>{
 const x=spec(),r=await run(x);assert.equal(r.ok,true,r.reason);
 assert.equal(r.started,true);assert.equal(r.internalRecords,1);
 assert.equal(r.externalMessagesSent,0);assert.equal(x.calls.length,2);
 assert.equal(x.agni.length,1);assert.equal(x.agni[0].advisoryOnly,true);
 assert.equal(JSON.stringify(x.agni).includes("workerId"),false);
});
test("AB7F production/disabled/revoked cannot claim Core job",async()=>{
 for(const patch of [{enabled:false},{environment:"production"},
 {verifyCurrentOperatorAal2:async()=>false}]){
  const x=spec(),r=await run({...x,...patch});assert.equal(r.ok,false);
  assert.equal(x.calls.length,0);
 }
});
test("AB7F expired independent authority and ambiguous DB receipt cannot certify",async()=>{
 const x=spec();
 assert.equal((await run({...x,
 verifyDeploymentAuthority:async()=>({...await x.verifyDeploymentAuthority(),
  signedReleaseDigestVerified:false})})).ok,false);
 const y=spec(),r=await run({...y,
 rpc:async(name)=>name===names.claim?{data:[{job_id:id(2),
  work_event_id:id(3),lease_token:id(4),attempt:1}]}:{data:[]}});
 assert.equal(r.ok,false);assert.equal(r.externalMessagesSent,0);
});
