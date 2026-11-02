/**
 * UI-04 T5: source availability and official EOD handoff. A source-status
 * preview is not an employee performance total. Real submission requires
 * already-reviewed four-source sealed transactions and independent TL ACK.
 */
import {submitVerifiedFourSourceEod,
 acknowledgeIndependentFourSourceEod} from "./f1OfficialEodTransitions.mjs";
import {requiredAttributableSources} from "./l9FourSourceEodEvidence.mjs";
const error=reason=>Object.freeze({ok:false,reason,official:false,
 canSubmit:false,canAcknowledge:false,providerMessagesSent:0});
export function classifyFourSourceEodStatus(status){
 if(!status||status.ok!==true||
  status.schema!=="qf.vox.staff.eod.source-status.v1"||
  status.mode!=="READ_ONLY"||
  status.source!=="CORE_CANONICAL_SOURCE_OBSERVATIONS"||
  status.completeness!=="INCOMPLETE_NO_SIGNED_ALL_SOURCE_WATERMARKS"||
  status.allSourceReady!==false||status.rollup!==null||
  status.actionsEnabled!==false||status.canExport!==false||
  status.providerMessagesSent!==0||status.canSubmit!==false||
  !Array.isArray(status.sources)||status.sources.length!==4)
  return error("TRUSTED_CORE_SOURCE_STATUS_REQUIRED");
 const seen=new Set(),statuses=[];
 for(const s of status.sources){
  if(!s||!requiredAttributableSources.includes(s.source)||
   seen.has(s.source)||!["AVAILABLE","NO_GRANTED_OBJECTS",
     "UNAVAILABLE","GRANT_UNVERIFIED"].includes(s.readiness)||
   !["CORE_WORK_ONLY","NOT_PROVEN"].includes(s.eventProvenance))
   return error("UNVERIFIED_EOD_SOURCE_STATUS");
  seen.add(s.source);
  statuses.push(Object.freeze({source:s.source,readiness:s.readiness,
   provenance:s.eventProvenance}));
 }
 return Object.freeze({ok:true,
  schema:"qf.vox.ui04.eod-readiness.v1",mode:"READ_ONLY",
  sources:Object.freeze(statuses),official:false,
  canSubmit:false,canAcknowledge:false,rollup:null,
  requiresFourSignedWatermarks:true,providerMessagesSent:0});
}
/** Handoff is entirely Core-side, without a browser handler. */
export async function requestOfficialEodAfterSourceCertification(args={}){
 const result=await submitVerifiedFourSourceEod(args);
 if(!result.ok||result.official!==true||
  result.state!=="PENDING_REVIEW"||result.providerMessagesSent!==0)
  return error(result.reason||"FOUR_SOURCE_OFFICIAL_RECEIPT_MISSING");
 return Object.freeze({...result,canAcknowledge:false,
  requiresIndependentLeader:true,requiresHumanReview:true,
  automaticReviewApproved:false});
}
export async function requestIndependentEodAcknowledgement(args={}){
 const result=await acknowledgeIndependentFourSourceEod(args);
 if(!result.ok||result.official!==true||
  result.state!=="ACKNOWLEDGED"||result.providerMessagesSent!==0)
  return error(result.reason||"INDEPENDENT_AAL2_ACK_REQUIRED");
 return Object.freeze({...result,requiresRecordedHumanReviewer:true,
  automaticReviewApproved:false});
}
