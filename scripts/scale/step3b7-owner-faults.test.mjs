import test from "node:test";
import assert from "node:assert/strict";
import {planOwnerTransition,simulateTransitionFailure,TRANSITION_SEQUENCE,REQUIRED_SHA}
 from "../owner-superadmin-transition-plan.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now="2026-10-23T09:00:00.000Z";
function evidence(){return {
 project:"uckafzuochmbvtiodmcl",phase22Sha256:REQUIRED_SHA,phase22InstalledInManagedStaging:true,
 owner:{id:id(1),email:"quickfurno@gmail.com",emailVerified:true,providerMappingActive:true,
 principalActive:true,coreProfileActive:true},
 legacy:{superadminCount:1,retirementPlanApproved:true,
 sessionRevocationPlanned:true,breakGlassRecoveryPlanned:true},
 backup:{archiveHashVerified:true,isolatedRestorePassed:true,managedRollbackApproved:true},
 ownerApproval:{approved:true,project:"uckafzuochmbvtiodmcl",sha:REQUIRED_SHA},
 reviews:{DBA:{approved:true,sha:REQUIRED_SHA,actorId:id(2),decisionId:"review-dba-synthetic"},
 AppSec:{approved:true,sha:REQUIRED_SHA,actorId:id(3),decisionId:"review-appsec-synthetic"}},
 capturedAt:"2026-10-23T08:59:00.000Z",identityStateEpoch:5,approvalStateEpoch:5,
 replayId:"synthetic-step3b7-transition-001"
};}
test("O1 fully synthetic reviewer approvals and Owner claims never unlock execution",()=>{
 const x=planOwnerTransition(evidence(),now);
 assert.equal(x.failures.length,0);assert.equal(x.readyForIndependentExecutionDesignReview,true);
 assert.equal(x.independentSignoffAuthenticated,false);assert.equal(x.actualManagedMutation,false);
 assert.equal(x.ownerRoleGranted,false);assert.equal(x.authorizedToExecute,false);
});
test("O2 protected managed Phase22 absent, stale/replay identity, owner change and reviewer overlap deny",()=>{
 const cases=[
 e=>e.phase22InstalledInManagedStaging=false,
 e=>e.owner.email="forged@example.com",
 e=>e.ownerApproval.sha="not-pinned",
 e=>e.approvalStateEpoch=4,
 e=>e.reviews.AppSec.actorId=e.reviews.DBA.actorId,
 e=>e.backup.managedRollbackApproved=false,
 e=>e.legacy.sessionRevocationPlanned=false
 ];
 for(const mutate of cases){const e=evidence();mutate(e);
  const x=planOwnerTransition(e,now);
  assert.ok(x.failures.length>0);assert.equal(x.authorizedToExecute,false);
 }
 const e=evidence();
 assert.ok(planOwnerTransition(e,now,[e.replayId]).failures.includes("REPLAY_REFERENCE_ALREADY_USED"));
});
test("O3 each of ten transition faults requires stop and manual escalation; no phantom rollback",()=>{
 assert.equal(TRANSITION_SEQUENCE.length,10);
 for(let i=0;i<TRANSITION_SEQUENCE.length;i++){
  const v=simulateTransitionFailure({faultAt:TRANSITION_SEQUENCE[i],
    completedSteps:TRANSITION_SEQUENCE.slice(0,i)});
  assert.equal(v.stopAndEscalate,true);assert.equal(v.automaticRollbackExecuted,false);
  assert.equal(v.liveMutation,false);assert.equal(v.releaseStatus,"HOLD");
 }
});
test("O4 post durable role preparation requires compensation, never assumes cross-system atomicity",()=>{
 const v=simulateTransitionFailure({faultAt:"ENROLL_AND_VERIFY_REAL_AAL2",
 completedSteps:["PREPARE_DURABLE_CORE_ROLE_TRANSITION","PREPARE_LEGACY_COMPATIBILITY_CLAIMS"]});
 assert.ok(v.requiredCompensation.includes("REVOKE_SESSIONS"));
 assert.ok(v.requiredCompensation.includes("VERIFY_DURABLE_ROLE_AND_COMPATIBILITY_CLAIMS"));
 assert.equal(v.automaticRollbackExecuted,false);
 assert.equal(planOwnerTransition(evidence(),now).crossSystemTransactionCertified,false);
});
