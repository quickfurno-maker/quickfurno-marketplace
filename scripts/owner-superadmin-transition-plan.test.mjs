import test from "node:test";
import assert from "node:assert/strict";
import {planOwnerTransition,simulateTransitionFailure,TRANSITION_SEQUENCE,REQUIRED_SHA} from "./owner-superadmin-transition-plan.mjs";
const owner="11111111-1111-4111-8111-111111111111";
const dba="22222222-2222-4222-8222-222222222222";
const appsec="33333333-3333-4333-8333-333333333333";
function fixture(){return {
 project:"uckafzuochmbvtiodmcl",phase22Sha256:REQUIRED_SHA,phase22InstalledInManagedStaging:true,
 owner:{id:owner,email:"quickfurno@gmail.com",emailVerified:true,providerMappingActive:true,principalActive:true,coreProfileActive:true},
 legacy:{superadminCount:1,retirementPlanApproved:true,sessionRevocationPlanned:true,breakGlassRecoveryPlanned:true},
 backup:{archiveHashVerified:true,isolatedRestorePassed:true,managedRollbackApproved:true},
 ownerApproval:{approved:true,project:"uckafzuochmbvtiodmcl",sha:REQUIRED_SHA},
 reviews:{DBA:{approved:true,sha:REQUIRED_SHA,actorId:dba,decisionId:"dba-001"},AppSec:{approved:true,sha:REQUIRED_SHA,actorId:appsec,decisionId:"appsec-001"}},
 capturedAt:"2026-10-23T08:59:00Z",identityStateEpoch:42,approvalStateEpoch:42,replayId:"unique-review-run-002",
}}
test("even fully populated synthetic evidence cannot authorize managed writes",()=>{
 const r=planOwnerTransition(fixture());assert.equal(r.failures.length,0);
 assert.equal(r.readyForIndependentExecutionDesignReview,true);
 assert.equal(r.authorizedToExecute,false);assert.equal(r.actualManagedMutation,false);
 assert.equal(r.crossSystemTransactionCertified,false);assert.equal(r.releaseStatus,"HOLD");
});
test("actual current missing managed Phase22 blocks",()=>{const v=fixture();v.phase22InstalledInManagedStaging=false;assert.ok(planOwnerTransition(v).failures.includes("MANAGED_PHASE22_NOT_INSTALLED"))});
test("forged or wrong account blocks",()=>{for(const patch of [{email:"fraud@example.com"},{emailVerified:false},{id:"invalid"}]){const v=fixture();Object.assign(v.owner,patch);assert.equal(planOwnerTransition(v).readyForIndependentExecutionDesignReview,false)}});
test("missing provider, principal and profile block",()=>{for(const k of ["providerMappingActive","principalActive","coreProfileActive"]){const v=fixture();v.owner[k]=false;assert.equal(planOwnerTransition(v).authorizedToExecute,false);assert.ok(planOwnerTransition(v).failures.length)}});
test("missing retirement or session cleanup blocks",()=>{for(const k of ["retirementPlanApproved","sessionRevocationPlanned","breakGlassRecoveryPlanned"]){const v=fixture();v.legacy[k]=false;assert.equal(planOwnerTransition(v).readyForIndependentExecutionDesignReview,false)}});
test("stale or future snapshot blocks",()=>{for(const time of ["2026-10-20T00:00:00Z","2026-10-24T00:00:00Z","bogus"]){const v=fixture();v.capturedAt=time;assert.ok(planOwnerTransition(v).failures.includes("EVIDENCE_FRESHNESS_REQUIRED"))}});
test("cross-env or source hash mismatch fail",()=>{for(const k of ["project","phase22Sha256"]){const v=fixture();v[k]="other";assert.equal(planOwnerTransition(v).readyForIndependentExecutionDesignReview,false)}});
test("independent two-person review fails for same actor",()=>{const v=fixture();v.reviews.AppSec.actorId=dba;assert.ok(planOwnerTransition(v).failures.includes("SEPARATE_REVIEWER_IDENTITIES_REQUIRED"))});
test("reviewer cannot be the owner",()=>{const v=fixture();v.reviews.DBA.actorId=owner;assert.ok(planOwnerTransition(v).failures.includes("REVIEWER_CANNOT_BE_TARGET_OWNER"))});
test("missing owner scope permission blocks",()=>{const v=fixture();v.ownerApproval.sha="wrong";assert.ok(planOwnerTransition(v).failures.includes("OWNER_EXACT_SCOPE_APPROVAL_REQUIRED"))});
test("stale authority revision blocks",()=>{const v=fixture();v.approvalStateEpoch=41;assert.ok(planOwnerTransition(v).failures.includes("STALE_IDENTITY_STATE"))});
test("restore not approved blocks even if archive restores",()=>{const v=fixture();v.backup.managedRollbackApproved=false;assert.ok(planOwnerTransition(v).failures.includes("BACKUP_AND_MANAGED_ROLLBACK_GATE"))});
test("review signature fields missing deny",()=>{for(const area of ["DBA","AppSec"]){const v=fixture();v.reviews[area].decisionId=null;assert.equal(planOwnerTransition(v).readyForIndependentExecutionDesignReview,false)}});
test("fault at every step never automatically rolls back or grants",()=>{for(let i=0;i<TRANSITION_SEQUENCE.length;i++){const r=simulateTransitionFailure({faultAt:TRANSITION_SEQUENCE[i],completedSteps:TRANSITION_SEQUENCE.slice(0,i)});assert.equal(r.automaticRollbackExecuted,false);assert.equal(r.stopAndEscalate,true);assert.equal(r.liveMutation,false);assert.equal(r.releaseStatus,"HOLD")}});
test("post role-write failure requires explicit compensation",()=>{const v=simulateTransitionFailure({faultAt:"ENROLL_AND_VERIFY_REAL_AAL2",completedSteps:TRANSITION_SEQUENCE.slice(0,7)});assert.ok(v.requiredCompensation.includes("REVOKE_SESSIONS"))});
test("unknown faults never imply success",()=>{const v=simulateTransitionFailure({faultAt:"UNKNOWN"});assert.equal(v.faultAt,"UNKNOWN_FAULT");assert.equal(v.stopAndEscalate,true)});

test("replayed transition reference fails closed before any review is actionable",()=>{
 const v=fixture();
 const r=planOwnerTransition(v,"2026-10-23T09:00:00.000Z",[v.replayId]);
 assert.ok(r.failures.includes("REPLAY_REFERENCE_ALREADY_USED"));
 assert.equal(r.readyForIndependentExecutionDesignReview,false);
 assert.equal(r.authorizedToExecute,false);
});
