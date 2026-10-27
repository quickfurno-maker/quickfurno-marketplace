/** No deployment or scheduler. Validates exact bounded internal-only launch
 * and never treats advisory AGNI data or OAuth push as release authority.
 */
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const deny=reason=>Object.freeze({ok:false,reason,canStart:false,
 outboundMessagingEnabled:false,actualWorkerStarted:false});
export async function authorizeAb7iInternalWorker({
 environment,enabled=false,workerId,releaseSha256,dbSchemaSha256,
 operatorAal2Proof,independentReleaseProof,
 verifyCurrentSignedOwnerGate,verifySchemaFingerprint,verifyNoProviders,
 now=Date.now()
}={}){
 if(environment!=="staging"||enabled!==true||
  !uuid.test(workerId??"")||
  !/^[a-f0-9]{64}$/.test(releaseSha256??"")||
  !/^[a-f0-9]{64}$/.test(dbSchemaSha256??"")||
  !Number.isSafeInteger(now)||now<=0||
  ![verifyCurrentSignedOwnerGate,verifySchemaFingerprint,verifyNoProviders].every(x=>typeof x==="function"))
  return deny("SIGNED_STAGING_INTERNAL_ONLY");
 try{
  if(operatorAal2Proof?.verified!==true||
   independentReleaseProof?.verified!==true||
   operatorAal2Proof.subjectId===independentReleaseProof.subjectId||
   !uuid.test(operatorAal2Proof.subjectId??"")||
   !uuid.test(independentReleaseProof.subjectId??"")||
   independentReleaseProof.releaseSha256!==releaseSha256||
   independentReleaseProof.schemaSha256!==dbSchemaSha256||
   independentReleaseProof.expiresAtMs<=now||
   independentReleaseProof.issuedAtMs>now||
   now-independentReleaseProof.issuedAtMs>900000)
   return deny("CURRENT_INDEPENDENT_WORKER_AUTHORITY_REQUIRED");
  if(await verifyCurrentSignedOwnerGate()!==true||
   await verifySchemaFingerprint(dbSchemaSha256)!==true||
   await verifyNoProviders()!==true)
   return deny("CORE_SCHEMA_OR_PROVIDER_ISOLATION_NOT_PROVEN");
  return Object.freeze({ok:true,canStart:false,
   eligibleForSeparateDeploymentReview:true,
   maxJobsPerCycle:5,maxConcurrentCycles:1,
   manualRecoveryRequired:true,externalMessagingEnabled:false,
   outboundMessagingEnabled:false,actualWorkerStarted:false,
   providerDeliveryVerified:false,productionCertified:false});
 }catch{return deny("WORKER_AUTHORITY_UNAVAILABLE");}
}
