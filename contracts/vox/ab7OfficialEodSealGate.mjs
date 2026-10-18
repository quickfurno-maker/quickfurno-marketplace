/**
 * AB7D official EOD publication must rely on a fresh atomic Core signed
 * FOUR-SOURCE snapshot + independent TL decision, never a preview card.
 * This returns a proposal for the official Core publication ledger only.
 */
const NAMES=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=reason=>Object.freeze({ok:false,reason,official:false,published:false});
export async function prepareOfficialEodPublication({
 report,sourceSeals,teamLeader,nonce,
 verifyPinnedSourceSignatures,verifyCurrentReportDb,
 verifyCurrentTlAal2,verifyImmutableIndependentAck
}={}){
 if(!report||!UUID.test(report.id??"")||
  !UUID.test(report.staffUserId??"")||!UUID.test(report.teamId??"")||
  !UUID.test(report.cityId??"")||!UUID.test(nonce??"")||
  !Number.isSafeInteger(report.revision)||report.revision<2||
  report.state!=="INDEPENDENTLY_ACKNOWLEDGED"||
  report.official!==false||!/^\d{4}-\d{2}-\d{2}$/.test(report.businessDate??"")||
  !Array.isArray(sourceSeals)||sourceSeals.length!==4||
  sourceSeals.map(x=>x?.source).sort().join("|")!==NAMES.slice().sort().join("|")||
  !sourceSeals.every(x=>x?.signatureVerified===true&&
    /^[a-f0-9]{64}$/.test(x.sha256??"")&&
    x.staffUserId===report.staffUserId&&x.teamId===report.teamId&&
    x.cityId===report.cityId&&x.businessDate===report.businessDate)||
  !teamLeader||!UUID.test(teamLeader.id??"")||
  teamLeader.id===report.staffUserId||teamLeader.role!=="team_leader"||
  teamLeader.currentAal!=="aal2"||teamLeader.teamId!==report.teamId||
  teamLeader.cityId!==report.cityId||
  report.reviewerId!==teamLeader.id||
  typeof verifyPinnedSourceSignatures!=="function"||
  typeof verifyCurrentReportDb!=="function"||
  typeof verifyCurrentTlAal2!=="function"||
  typeof verifyImmutableIndependentAck!=="function")
  return deny("FOUR_SIGNED_SOURCES_AND_INDEPENDENT_TL_REQUIRED");
 try{
  if(await verifyPinnedSourceSignatures({report,sourceSeals})!==true||
   await verifyCurrentReportDb(report)!==true||
   await verifyCurrentTlAal2(teamLeader)!==true||
   await verifyImmutableIndependentAck({report,teamLeader})!==true)
   return deny("CURRENT_SIGNED_EOD_OR_TL_REVOKED");
  return Object.freeze({ok:true,schema:"qf.vox.ab7d.official-eod-publication-proposal.v1",
   reportId:report.id,revision:report.revision,nonce,
   requiredSourceCount:4,state:"PENDING_ATOMIC_CORE_PUBLICATION",
   requireDbSameTxSealAndTlRecheck:true,
   official:false,published:false,providerMessagesSent:0});
 }catch{return deny("OFFICIAL_EOD_PROOF_UNAVAILABLE");}
}
