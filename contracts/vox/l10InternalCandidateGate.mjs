// L10 internal evidence aggregation; source QA must NEVER become a
// human DBA/AppSec/TL authorization or protected staging deployment permit.
const REQUIRED=["coreTypes","webBuild","scopeNegative","riyaEvidence",
 "eodProvenance","outboxReplay","isolatedPg17","releaseHold"];
const deny=reason=>Object.freeze({ok:false,reason,
 internalCandidateComplete:false,reviewersEngaged:false,
 protectedStagingPermitted:false,productionPermitted:false});
export function assessInternalCandidateEvidence(evidence){
 if(!evidence||typeof evidence!=="object"||Array.isArray(evidence)||
   Object.keys(evidence).sort().join("|")!==REQUIRED.slice().sort().join("|"))
   return deny("EXACT_INTERNAL_EVIDENCE_REQUIRED");
 const missing=REQUIRED.filter(k=>evidence[k]!==true);
 // A boolean internal test result is only a local signal; this gate is
 // never used as a replacement for immutable independent signed evidence.
 if(missing.length)return Object.freeze({...deny("INTERNAL_EVIDENCE_INCOMPLETE"),
   missing:Object.freeze(missing)});
 return Object.freeze({ok:true,internalCandidateComplete:true,
  reviewerHandoffEligible:true,requiresIndependentDBA:true,
  requiresIndependentAppSec:true,requiresFirstTeamLeader:true,
  requiresProtectedStageAal2AndE2E:true,
  reviewersEngaged:false,protectedStagingPermitted:false,
  productionPermitted:false,providerMessagesSent:0});
}