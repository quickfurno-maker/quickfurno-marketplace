import {validateMeetingIntent,googleMeetJoinLink} from "../../contracts/vox/virtualOfficeMeeting.mjs";
const deny=(reason)=>({ok:false,reason,providerCalled:false});
const unknown=()=>({ok:false,reason:"MEETING_CREATION_OUTCOME_UNKNOWN",
 providerCalled:true,committed:null,retrySameNonceOnly:true});
/**
 * VO1 provider-backed adapter. Hard OFF without both independently reviewed
 * Staging installation and explicit activation. Never runs in Production.
 * The Core-owned reservation and verified actor/invitee set MUST be durable
 * and transactional before calling the provider.
 */
export async function createScopedMeet(input,deps={}){
 const valid=validateMeetingIntent(input);
 if(!valid.ok)return deny(valid.reason);
 if(deps.environment!=="staging"||deps.enabled?.()!==true||
  deps.installed?.()!==true)return deny("MEETING_PROVIDER_NOT_INSTALLED");
 if(typeof deps.verifyCurrentScope!=="function"||
  typeof deps.reserveOriginalNonce!=="function"||
  typeof deps.commitReceipt!=="function"||
  typeof deps.accessToken!=="function"||
  typeof deps.providerFetch!=="function")return deny("MEETING_CORE_AUTHORITY_NOT_INSTALLED");
 const intent=valid.intent;
 let verified;
 try{verified=await deps.verifyCurrentScope(intent);}
 catch{return deny("CURRENT_MEETING_SCOPE_UNAVAILABLE");}
 if(verified!==true)return deny("CURRENT_MEETING_SCOPE_DENIED");
 let reserved;
 try{reserved=await deps.reserveOriginalNonce(intent);}
 catch{return deny("MEETING_NONCE_RESERVATION_UNAVAILABLE");}
 if(reserved?.status==="REPLAY"){
  const link=googleMeetJoinLink(reserved.receipt?.joinUrl);
  if(!link.ok||reserved.receipt?.nonce!==intent.nonce||
   typeof reserved.receipt?.spaceName!=="string"||
   !/^spaces\/[A-Za-z0-9_-]{2,128}$/.test(reserved.receipt.spaceName))
    return {ok:false,reason:"MEETING_NONCE_RECONCILIATION_REQUIRED",
     committed:null,retrySameNonceOnly:true,providerCalled:false};
  // The original scoped grant may have been revoked while this prior meeting
  // existed. A nonce replay is NOT a perpetual right to disclose its join URL.
  try{
   if(await deps.verifyCurrentScope(intent)!==true)
    return deny("CURRENT_MEETING_SCOPE_DENIED");
  }catch{return deny("CURRENT_MEETING_SCOPE_UNAVAILABLE");}
  return {ok:true,replayed:true,providerCalled:false,nonce:intent.nonce,
   joinUrl:link.joinUrl,spaceName:reserved.receipt.spaceName};
 }
 // Reservation must be bound to the original request and a durable transaction.
 // Mere truthy RESERVED from a broken adapter must never trigger provider I/O.
 if(reserved?.status!=="RESERVED"||reserved.nonce!==intent.nonce||
    reserved.durable!==true)return deny("MEETING_NONCE_NOT_RESERVED");
 // Reserving a nonce may have involved a delayed transaction. Recheck the
 // actor and invitee grants before any Google API call, not only afterwards.
 try{
  if(await deps.verifyCurrentScope(intent)!==true)
   return deny("CURRENT_MEETING_SCOPE_DENIED");
 }catch{return deny("CURRENT_MEETING_SCOPE_UNAVAILABLE");}
 // From this point a lost response may hide a real provider-created space.
 let token;
 try{token=await deps.accessToken();}
 catch{return unknown();}
 if(typeof token!=="string"||token.length<10||token.length>4096||
    /[\r\n]/.test(token))return unknown();
 // OAuth token acquisition may block while a Staff member's team/invite
 // grant is revoked. Revalidate immediately before network I/O. The nonce
 // is already durable: failure here is a stopped/no-call operation; the
 // original reserved nonce must be reconciled, never silently replaced.
 try{
  if(await deps.verifyCurrentScope(intent)!==true)
   return deny("CURRENT_MEETING_SCOPE_DENIED");
 }catch{return deny("CURRENT_MEETING_SCOPE_UNAVAILABLE");}
 let response;
 try{
  response=await deps.providerFetch("https://meet.googleapis.com/v2/spaces",{
   method:"POST",
   headers:{authorization:"Bearer "+token,"content-type":"application/json"},
   body:"{}",
   signal:AbortSignal.timeout(8000)
  });
 }catch{return unknown();}
 if(!response?.ok)return unknown();
 let json;
 try{json=await response.json();}catch{return unknown();}
 const link=googleMeetJoinLink(json?.meetingUri);
 if(!link.ok||typeof json?.name!=="string"||
    !/^spaces\/[A-Za-z0-9_-]{2,128}$/.test(json.name))return unknown();
 const receipt={nonce:intent.nonce,joinUrl:link.joinUrl,spaceName:json.name};
 try{
  const persisted=await deps.commitReceipt(intent,receipt);
  if(persisted!==true)return unknown();
  // A second current authorization check prevents confirming a disclosed link
  // if an employee lost team/invite rights while the provider was processing.
  if(await deps.verifyCurrentScope(intent)!==true)return unknown();
 }catch{return unknown();}
 return {ok:true,replayed:false,providerCalled:true,...receipt};
}
