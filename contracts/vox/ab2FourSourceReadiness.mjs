/**
 * AB-2 four-source Staff event seal gate. This is preparation for the
 * existing F1 official EOD transaction, never itself an official report.
 * Each seal must come from the original canonical source DB and an
 * independently checked current Staff grant. No legacy text attribution.
 */
const SOURCES=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=x=>typeof x==="string"&&UUID.test(x);
const HASH=/^[a-f0-9]{64}$/;
const deny=reason=>Object.freeze({ok:false,reason,
 eligibleForOfficialSubmission:false,official:false,
 sourceCount:0,providerMessagesSent:0});
export async function attestAb2FourSourceReviewWindow({
 scope,businessDate,sourceSeals,verifyCurrentStaff,
 verifyDbSourceSeal,verifyExactSourceObjectGrants,now=Date.now()
}={}){
 if(!scope||!id(scope.userId)||!id(scope.teamId)||!id(scope.cityId)||
  scope.currentAal!=="aal2"||scope.canReadContent!==true||
  scope.canMutate!==false||
  typeof businessDate!=="string"||
  !/^\d{4}-\d\d-\d\d$/.test(businessDate)||
  new Date(businessDate+"T00:00:00Z").toISOString().slice(0,10)!==businessDate||
  !Array.isArray(sourceSeals)||sourceSeals.length!==4||
  !Number.isSafeInteger(now)||now<=0||
  typeof verifyCurrentStaff!=="function"||
  typeof verifyDbSourceSeal!=="function"||
  typeof verifyExactSourceObjectGrants!=="function")
  return deny("CURRENT_FOUR_SOURCE_WINDOW_REQUIRED");
 const seen=new Set(),sealed=[];
 try{
  if(await verifyCurrentStaff({scope,businessDate})!==true)
   return deny("STAFF_SCOPE_REVOKED");
  for(const row of sourceSeals){
   if(!row||!SOURCES.includes(row.source)||seen.has(row.source)||
    !id(row.staffId)||row.staffId!==scope.userId||
    !id(row.cityId)||row.cityId!==scope.cityId||
    !id(row.teamId)||row.teamId!==scope.teamId||
    row.businessDate!==businessDate||
    !Number.isSafeInteger(row.eventCount)||row.eventCount<0||
    !Number.isSafeInteger(row.lastRevision)||row.lastRevision<0||
    typeof row.sourceSha256!=="string"||!HASH.test(row.sourceSha256)||
    row.attributableStaffOnly!==true||
    row.watermarkSignatureVerified!==true||
    row.currentGrantProvenanceVerified!==true)
    return deny("SOURCE_PROVENANCE_OR_SIGNATURE_UNVERIFIED");
   if(await verifyDbSourceSeal({source:row.source,scope,businessDate,
    sha256:row.sourceSha256,eventCount:row.eventCount,
    lastRevision:row.lastRevision})!==true||
    await verifyExactSourceObjectGrants({source:row.source,scope,businessDate,
     lastRevision:row.lastRevision})!==true)
    return deny("SOURCE_SEAL_OR_OBJECT_GRANT_REVOKED");
   seen.add(row.source);
   sealed.push(Object.freeze({source:row.source,
    eventCount:row.eventCount,sourceSha256:row.sourceSha256,
    lastRevision:row.lastRevision}));
  }
  if(seen.size!==4||await verifyCurrentStaff({scope,businessDate})!==true)
   return deny("FOUR_SOURCE_WINDOW_CHANGED");
  sealed.sort((a,b)=>SOURCES.indexOf(a.source)-SOURCES.indexOf(b.source));
  return Object.freeze({ok:true,
   schema:"qf.vox.ab2.four-source-review-readiness.v1",
   mode:"REVIEW_CANDIDATE_ONLY",businessDate,
   sourceCount:4,sources:Object.freeze(sealed),
   eligibleForOfficialSubmission:false,official:false,
   requiresCoreAtomicSnapshotRecheck:true,
   requiresIndependentTeamLeaderAal2:true,
   providerMessagesSent:0});
 }catch{return deny("FOUR_SOURCE_VERIFICATION_UNAVAILABLE");}
}
