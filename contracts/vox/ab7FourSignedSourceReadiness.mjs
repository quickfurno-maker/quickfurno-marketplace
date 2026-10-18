/**
 * AB-7D four-source CLOSED IST DAY signing preparation.
 * Signs only canonical Core native source rows with a pinned separate signer.
 * Source keys remain protected; this is NOT an official report or TL approval.
 */
import {createHash,createPrivateKey,sign,verify,createPublicKey} from "node:crypto";
import {canonicalAb3EodSeal} from "./ab3SignedEodReadiness.mjs";
const SOURCES=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=reason=>Object.freeze({ok:false,reason,official:false,
 sourceCount:0,providerMessagesSent:0});
export async function prepareAb7FourSignedSources({
 scope,businessDate,rowsBySource,privateKeysBySource,publicKeysBySource,
 verifyCurrentStaff,verifyExactSourceEvent,now=Date.now()
}={}){
 if(!scope||![scope.userId,scope.teamId,scope.cityId].every(x=>
  typeof x==="string"&&UUID.test(x))||
  scope.currentAal!=="aal2"||scope.canReadContent!==true||
  scope.canMutate!==false||!/^\d{4}-\d{2}-\d{2}$/.test(businessDate??"")||
  !Number.isSafeInteger(now)||now<=0||
  !rowsBySource||!privateKeysBySource||!publicKeysBySource||
  Object.keys(rowsBySource).sort().join("|")!==SOURCES.slice().sort().join("|")||
  Object.keys(privateKeysBySource).sort().join("|")!==SOURCES.slice().sort().join("|")||
  Object.keys(publicKeysBySource).sort().join("|")!==SOURCES.slice().sort().join("|")||
  typeof verifyCurrentStaff!=="function"||
  typeof verifyExactSourceEvent!=="function")
  return deny("FOUR_TRUSTED_NATIVE_SIGNERS_REQUIRED");
 const start=Date.parse(businessDate+"T00:00:00+05:30"),end=start+86400000;
 if(!Number.isFinite(start)||end>now||
  new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",
   year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(start))
   !==businessDate)
  return deny("IST_DAY_NOT_CLOSED");
 try{
  if(await verifyCurrentStaff(scope)!==true)return deny("STAFF_REVOKED");
  const signatures=[];
  for(const source of SOURCES){
   const events=rowsBySource[source];
   if(!Array.isArray(events)||events.length>1000)
    return deny("SOURCE_EVENTS_UNBOUNDED");
   const seen=new Set(),order=[];
   for(const row of events){
    if(!row||typeof row!=="object"||Array.isArray(row)||
     Object.keys(row).sort().join("|")!==
      "actorId|cityId|eventId|eventKind|occurredAt|revision|source|subjectId|teamId"||
     row.source!==source||
     ![row.actorId,row.cityId,row.eventId,row.subjectId,row.teamId]
      .every(x=>typeof x==="string"&&UUID.test(x))||
     row.actorId!==scope.userId||row.cityId!==scope.cityId||
     row.teamId!==scope.teamId||seen.has(row.eventId)||
     !Number.isSafeInteger(row.revision)||row.revision<1||
     typeof row.eventKind!=="string"||
     !/^[A-Z_]{3,32}$/.test(row.eventKind)||
     !Number.isFinite(Date.parse(row.occurredAt))||
     Date.parse(row.occurredAt)<start||Date.parse(row.occurredAt)>=end||
     await verifyExactSourceEvent({row,source,scope})!==true)
     return deny("ORIGINAL_SOURCE_OR_GRANT_UNVERIFIED");
    seen.add(row.eventId);
    order.push(row);
   }
   order.sort((a,b)=>a.eventId.localeCompare(b.eventId));
   const digest=createHash("sha256").update(JSON.stringify(order)).digest("hex");
   const payload={
    schema:"qf.vox.ab3.source-eod-seal.v1",
    source,staffId:scope.userId,teamId:scope.teamId,cityId:scope.cityId,
    businessDate,eventCount:order.length,
    lastRevision:order.length?Math.max(...order.map(x=>x.revision)):0,
    sourceSha256:digest,issuedAtMs:now,expiresAtMs:now+30000
   };
   const key=createPrivateKey(privateKeysBySource[source]);
   const sig=sign(null,Buffer.from(canonicalAb3EodSeal(payload)),
    key).toString("base64url");
   const valid=verify(null,Buffer.from(canonicalAb3EodSeal(payload)),
    createPublicKey(publicKeysBySource[source]),
    Buffer.from(sig,"base64url"));
   if(!valid)return deny("PINNED_SOURCE_KEY_MISMATCH");
   signatures.push(Object.freeze({payload,signature:sig}));
  }
  if(await verifyCurrentStaff(scope)!==true)return deny("STAFF_SCOPE_CHANGED");
  return Object.freeze({ok:true,official:false,
   schema:"qf.vox.ab7d.four-signed-source-readiness.v1",
   sourceCount:4,evidence:Object.freeze(signatures),
   requiresIndependentTlAal2:true,requiresAtomicCoreEodSubmission:true,
   providerMessagesSent:0});
 }catch{return deny("TRUSTED_SOURCE_SIGNER_UNAVAILABLE");}
}
