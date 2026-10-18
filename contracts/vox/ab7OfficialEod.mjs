/**
 * AB7D signed EOD prepare/submit boundary.
 * Requires completed four-source Ed25519 and Core DB-grant proof, then
 * an atomic Core receipt that re-checks each sealed source in one transaction.
 * No official EOD can be inferred from a bare checksum or provisional card.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=reason=>Object.freeze({ok:false,reason,official:false,
 acknowledged:false,providerMessagesSent:0});
export async function submitAb7FourSourceEod({
 actor,reportId,nonce,businessDate,signedFourSourceProof,
 verifyCurrentStaffAal2,verifyFourCurrentDbSourceSeals,
 atomicCoreSubmission
}={}){
 if(!actor||actor.aal!=="aal2"||actor.isNeutralStaff!==true||
  !UUID.test(String(actor.userId))||!UUID.test(String(actor.teamId))||
  !UUID.test(String(actor.cityId))||!UUID.test(String(reportId))||
  !UUID.test(String(nonce))||
  !/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate))||
  !signedFourSourceProof||signedFourSourceProof.ok!==true||
  signedFourSourceProof.schema!=="qf.vox.ab3.signed-four-source-review-readiness.v1"||
  signedFourSourceProof.signatureVerifiedForAllFour!==true||
  signedFourSourceProof.sourceCount!==4||
  signedFourSourceProof.businessDate!==businessDate||
  signedFourSourceProof.official!==false||
  !Array.isArray(signedFourSourceProof.sources)||
  signedFourSourceProof.sources.length!==4||
  typeof verifyCurrentStaffAal2!=="function"||
  typeof verifyFourCurrentDbSourceSeals!=="function"||
  typeof atomicCoreSubmission!=="function")
  return deny("SIGNED_COMPLETE_FOUR_SOURCE_PROOF_REQUIRED");
 try{
  if(await verifyCurrentStaffAal2({actor})!==true||
   await verifyFourCurrentDbSourceSeals({
    actor,businessDate,sources:signedFourSourceProof.sources
   })!==true)
   return deny("CURRENT_CLOSED_SOURCE_OR_STAFF_REVOKED");
  const receipt=await atomicCoreSubmission({
   reportId,nonce,actorId:actor.userId,teamId:actor.teamId,
   cityId:actor.cityId,businessDate,
   sources:signedFourSourceProof.sources,
   requireFourOriginalSources:true,
   requireSourceChecksumSnapshotDbRecheck:true,
   requireCurrentActorAal2AndGrants:true,
   requireOneUseNonce:true,
   state:"SUBMITTED_AWAITING_INDEPENDENT_TL"
  });
  if(!receipt||receipt.reportId!==reportId||
   receipt.nonce!==nonce||
   receipt.state!=="SUBMITTED_AWAITING_INDEPENDENT_TL"||
   receipt.sourcesRecheckedInTransaction!==4||
   receipt.staffRecheckedInTransaction!==true||
   receipt.uniqueNonceConsumedInTransaction!==true||
   receipt.persisted!==true||receipt.official!==false||
   receipt.independentTlAcknowledged!==false)
   return deny("CORE_ATOMIC_EOD_RECEIPT_UNVERIFIED");
  return Object.freeze({ok:true,reportId,
   state:"SUBMITTED_AWAITING_INDEPENDENT_TL",
   official:false,acknowledged:false,providerMessagesSent:0,
   requiresIndependentTeamLeaderAal2:true});
 }catch{return deny("EOD_ATOMIC_SUBMISSION_UNAVAILABLE_OR_DUPLICATE");}
}
export async function acknowledgeAb7Eod({
 reportId,staffUserId,teamLeader,expectedRevision,decision,
 verifyCurrentTlAal2,verifyCurrentReportUnchanged,atomicCoreTlAck
}={}){
 if(!UUID.test(String(reportId))||!UUID.test(String(staffUserId))||
  !teamLeader||!UUID.test(String(teamLeader.userId))||
  teamLeader.userId===staffUserId||
  teamLeader.aal!=="aal2"||teamLeader.role!=="team_leader"||
  !Number.isSafeInteger(expectedRevision)||expectedRevision<1||
  !["ACKNOWLEDGE","REJECT"].includes(decision)||
  typeof verifyCurrentTlAal2!=="function"||
  typeof verifyCurrentReportUnchanged!=="function"||
  typeof atomicCoreTlAck!=="function")
  return deny("INDEPENDENT_TL_REPORT_REVIEW_REQUIRED");
 try{
  if(await verifyCurrentTlAal2({teamLeader,reportId})!==true||
   await verifyCurrentReportUnchanged({reportId,expectedRevision})!==true)
   return deny("CURRENT_REPORT_REVIEW_REVOKED");
  const receipt=await atomicCoreTlAck({
   reportId,reviewerId:teamLeader.userId,expectedRevision,decision,
   requireIndependentTlRecheck:true,
   requireReportSourceSealsRecheck:true,
   requireOriginalActorDifferent:true
  });
  if(!receipt||receipt.reportId!==reportId||
   receipt.reviewerId!==teamLeader.userId||
   receipt.revision!==expectedRevision+1||
   receipt.decision!==decision||
   receipt.tlRecheckedInTransaction!==true||
   receipt.sourcesRecheckedInTransaction!==4||
   receipt.actorDistinctRecheckedInTransaction!==true||
   receipt.providerMessagesSent!==0)
   return deny("INDEPENDENT_TL_ACK_RECEIPT_UNVERIFIED");
  return Object.freeze({ok:true,reportId,
   state:decision==="ACKNOWLEDGE"?"INDEPENDENTLY_ACKNOWLEDGED":"REJECTED",
   official:decision==="ACKNOWLEDGE",
   acknowledged:decision==="ACKNOWLEDGE",providerMessagesSent:0,
   certifiedForProduction:false});
 }catch{return deny("TL_ACK_ATOMIC_STORE_UNAVAILABLE");}
}
