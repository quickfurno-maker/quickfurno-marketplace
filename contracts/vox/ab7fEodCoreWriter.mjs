/** AB7F real durable EOD Core candidate RPC with verified four-source TL proof.
 * The report is pending Owner release, NOT official published.
 */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=reason=>({ok:false,reason,persisted:false,official:false,published:false});
export async function persistIndependentlyReviewedEod({
 environment,enabled=false,staffId,teamLeaderId,teamId,cityId,
 businessDate,nonce,sourceDigest,
 verifyPinnedFourSignatures,verifyCurrentIndependentTlAal2,
 verifyCurrentCoreSources,rpc
}={}){
 if(environment!=="staging"||enabled!==true||
  ![staffId,teamLeaderId,teamId,cityId,nonce].every(x=>
   typeof x==="string"&&uuid.test(x))||staffId===teamLeaderId||
  !/^\d{4}-\d{2}-\d{2}$/.test(businessDate??"")||
  !/^[a-f0-9]{64}$/.test(sourceDigest??"")||
  ![verifyPinnedFourSignatures,verifyCurrentIndependentTlAal2,
    verifyCurrentCoreSources,rpc].every(x=>typeof x==="function"))
  return deny("CURRENT_FOUR_SIGNED_SOURCE_PROOF_REQUIRED");
 const intent={staffId,teamLeaderId,teamId,cityId,businessDate,nonce,sourceDigest};
 try{
  if(await verifyPinnedFourSignatures(intent)!==true||
   await verifyCurrentIndependentTlAal2(intent)!==true||
   await verifyCurrentCoreSources(intent)!==true)
   return deny("CURRENT_EOD_SIGNATURE_OR_REVIEW_REVOKED");
  const response=await rpc("qf_vox_ab7f_four_source_eod_atomic_candidate_v1",{
   p_staff:staffId,p_tl:teamLeaderId,p_team:teamId,p_city:cityId,
   p_day:businessDate,p_nonce:nonce,p_source_digest:sourceDigest
  });
  if(response?.error||!Array.isArray(response?.data)||response.data.length!==1)
   return deny("CORE_EOD_ATOMIC_RECEIPT_UNVERIFIED");
  const x=response.data[0];
  if(!x||!uuid.test(x.report_id??"")||x.receipt_nonce!==nonce||
   x.source_count!==4||
   x.report_state!=="TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE"||
   x.published!==false||
   Object.keys(x).sort().join("|")!==
    "published|receipt_nonce|report_id|report_state|source_count")
   return deny("CORE_EOD_ATOMIC_RECEIPT_MISMATCH");
  return Object.freeze({ok:true,persisted:true,reportId:x.report_id,
   state:x.report_state,official:false,published:false,
   sourceCount:4,requiresOwnerRelease:true,productionCertified:false});
 }catch{return deny("EOD_ATOMIC_TRANSPORT_OUTCOME_UNKNOWN");}
}
