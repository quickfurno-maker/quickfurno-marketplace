// Step 3B5: pure, SOURCE-ONLY identity-transition decision and fault catalogue.
// No Supabase client, no Auth API, no secrets, no execution or approval fabrication.
export const TRANSITION_SEQUENCE=Object.freeze([
 "LOCK_ADMISSION_AND_RECHECK_OWNER",
 "VERIFY_MANAGED_PHASE22_AND_PROVIDER_PRINCIPAL",
 "VERIFY_INDEPENDENT_DBA_AND_APPSEC_DECISIONS",
 "VERIFY_OWNER_EXACT_SCOPE_AND_ROLLBACK_APPROVAL",
 "CHECK_LEGACY_SUPERADMIN_AND_SESSION_REVOCATION_PLAN",
 "PREPARE_DURABLE_CORE_ROLE_TRANSITION",
 "PREPARE_LEGACY_COMPATIBILITY_CLAIMS",
 "ENROLL_AND_VERIFY_REAL_AAL2",
 "REVOKE_LEGACY_PLACEHOLDER_AFTER_REPLACEMENT_PROVEN",
 "VERIFY_AUDIT_TRAIL_AND_RELEASE_HOLD",
]);
export const REQUIRED_SHA="6F53E1781E4D2BD277645ED17B2EB635BE70F1D2C4DF7525CD176DFB0C2F28BA";
const email="quickfurno@gmail.com";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function planOwnerTransition(evidence={},clock="2026-10-23T09:00:00.000Z",previousReplayIds=[]){
 const errors=[];
 const deny=(condition,code)=>{if(!condition)errors.push(code);};
 deny(evidence.project==="uckafzuochmbvtiodmcl","STAGING_PROJECT_NOT_PINNED");
 deny(evidence.phase22Sha256===REQUIRED_SHA,"PHASE22_SHA_NOT_PINNED");
 deny(evidence.phase22InstalledInManagedStaging===true,"MANAGED_PHASE22_NOT_INSTALLED");
 deny(evidence.owner?.email===email&&uuid.test(evidence.owner?.id||"")&&evidence.owner?.emailVerified===true,"EXISTING_VERIFIED_OWNER_REQUIRED");
 deny(evidence.owner?.providerMappingActive===true&&evidence.owner?.principalActive===true,"ACTIVE_OWNER_PRINCIPAL_REQUIRED");
 deny(evidence.owner?.coreProfileActive===true,"ACTIVE_OWNER_CORE_PROFILE_REQUIRED");
 deny(evidence.legacy?.superadminCount===1&&evidence.legacy?.retirementPlanApproved===true,"LEGACY_ADMIN_RETIREMENT_GATE");
 deny(evidence.legacy?.sessionRevocationPlanned===true&&evidence.legacy?.breakGlassRecoveryPlanned===true,"SESSION_AND_BREAK_GLASS_GATE");
 deny(evidence.backup?.archiveHashVerified===true&&evidence.backup?.isolatedRestorePassed===true&&evidence.backup?.managedRollbackApproved===true,"BACKUP_AND_MANAGED_ROLLBACK_GATE");
 deny(evidence.ownerApproval?.project===evidence.project&&evidence.ownerApproval?.sha===REQUIRED_SHA&&evidence.ownerApproval?.approved===true,"OWNER_EXACT_SCOPE_APPROVAL_REQUIRED");
 const reviewerNames=new Set();
 for(const area of ["DBA","AppSec"]){
  const r=evidence.reviews?.[area];
  deny(r?.approved===true&&r?.sha===REQUIRED_SHA&&uuid.test(r?.actorId||"")&&r?.decisionId,"INDEPENDENT_"+area.toUpperCase()+"_REVIEW_REQUIRED");
  if(r?.actorId)reviewerNames.add(r.actorId);
 }
 deny(reviewerNames.size===2,"SEPARATE_REVIEWER_IDENTITIES_REQUIRED");
 deny(!reviewerNames.has(evidence.owner?.id),"REVIEWER_CANNOT_BE_TARGET_OWNER");
 deny(evidence.identityStateEpoch===evidence.approvalStateEpoch&&Number.isInteger(evidence.identityStateEpoch)&&evidence.identityStateEpoch>=0,"STALE_IDENTITY_STATE");
 const now=Date.parse(clock),issued=Date.parse(evidence.capturedAt||"");
 deny(Number.isFinite(now)&&Number.isFinite(issued)&&issued<=now&&now-issued<=15*60*1000,"EVIDENCE_FRESHNESS_REQUIRED");
 deny(evidence.replayId&&/^[a-z0-9-]{12,100}$/i.test(evidence.replayId),"UNIQUE_REPLAY_REFERENCE_REQUIRED");
 deny(Array.isArray(previousReplayIds)&&!previousReplayIds.includes(evidence.replayId),"REPLAY_REFERENCE_ALREADY_USED");
 // Even perfect proposed evidence never approves an actual multi-system write.
 // The operator must use a separately reviewed, signed, rollback-capable implementation.
 const response={
   schema:"qf.owner.transition.dry-run.v1",
   phase22Source:REQUIRED_SHA,
   plannedSteps:TRANSITION_SEQUENCE,
   failures:Object.freeze([...new Set(errors)]),
   readyForIndependentExecutionDesignReview:errors.length===0,
   actualManagedMutation:false,
   ownerRoleGranted:false,
   independentSignoffAuthenticated:false,
   crossSystemTransactionCertified:false,
   authorizedToExecute:false,
   releaseStatus:"HOLD",
 };
 return Object.freeze(response);
}
export function simulateTransitionFailure({faultAt,completedSteps=[]}={}){
 const i=TRANSITION_SEQUENCE.indexOf(faultAt);
 const done=completedSteps.filter(s=>TRANSITION_SEQUENCE.indexOf(s)>=0);
 const rollbackNeeded=done.some(s=>TRANSITION_SEQUENCE.indexOf(s)>=5);
 return Object.freeze({
  schema:"qf.owner.transition.fault.v1",
  faultAt:i>=0?faultAt:"UNKNOWN_FAULT",
  stopAndEscalate:true,
  forbidRetryWithoutFreshEvidence:true,
  requiredCompensation:rollbackNeeded?["REVOKE_SESSIONS","VERIFY_DURABLE_ROLE_AND_COMPATIBILITY_CLAIMS","RECONCILE_AUDIT_EVENTS","REVALIDATE_ORIGINAL_LEGACY_ADMIN_STATE"]:[],
  automaticRollbackExecuted:false,
  liveMutation:false,
  releaseStatus:"HOLD",
 });
}
