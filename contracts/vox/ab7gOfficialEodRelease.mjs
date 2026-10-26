/** AB7G Owner-authenticated official publication receipt gate.
 * Cannot create independent reviewer attestation or sign keys.
 * Real immutable SQL publication requires separately written reviewed evidence.
 */
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const deny=reason=>Object.freeze({ok:false,reason,official:false});
export async function publishReviewedEod({
 environment,enabled=false,reportId,ownerId,teamLeaderId,nonce,
 sourceDigest,verifyCurrentOwnerAal2,
 verifyCurrentIndependentTlAal2,verifyPinnedApprovalAndSigner,
 verifyUnmodifiedNativeSources,rpc
}={}){
 if(environment!=="staging"||enabled!==true||
  ![reportId,ownerId,teamLeaderId,nonce].every(x=>typeof x==="string"&&uuid.test(x))||
  ownerId===teamLeaderId||!/^[a-f0-9]{64}$/.test(sourceDigest??"")||
  ![verifyCurrentOwnerAal2,verifyCurrentIndependentTlAal2,
   verifyPinnedApprovalAndSigner,verifyUnmodifiedNativeSources,rpc]
   .every(x=>typeof x==="function"))
  return deny("GOVERNED_EOD_RELEASE_DISABLED");
 const proof={reportId,ownerId,teamLeaderId,nonce,sourceDigest};
 try{
  if(await verifyCurrentOwnerAal2(proof)!==true||
   await verifyCurrentIndependentTlAal2(proof)!==true||
   await verifyPinnedApprovalAndSigner(proof)!==true||
   await verifyUnmodifiedNativeSources(proof)!==true)
   return deny("SIGNED_OWNER_RELEASE_EVIDENCE_MISSING");
  const r=await rpc("qf_vox_ab7g_official_eod_publish_candidate_v1",{
   p_report:reportId,p_owner:ownerId,p_tl:teamLeaderId,
   p_nonce:nonce,p_source_digest:sourceDigest
  });
  if(r?.error||!Array.isArray(r?.data)||r.data.length!==1)
   return deny("OFFICIAL_PUBLICATION_ATOMIC_RESULT_UNVERIFIED");
  const x=r.data[0];
  if(!x||Object.keys(x).sort().join("|")!==
    "publication_report_id|publication_state|receipt_nonce|source_sha256"||
    x.publication_report_id!==reportId||x.receipt_nonce!==nonce||
    x.source_sha256!==sourceDigest||
    x.publication_state!=="OFFICIALLY_RELEASED_BY_OWNER")
   return deny("OFFICIAL_PUBLICATION_RECEIPT_FORGED");
  return Object.freeze({ok:true,official:true,
   state:x.publication_state,reportId,nonce,
   productionCertified:false,providerMessagesSent:0});
 }catch{return deny("OFFICIAL_PUBLICATION_OUTCOME_UNKNOWN");}
}
