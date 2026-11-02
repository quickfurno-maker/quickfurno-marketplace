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
  if(link.ok&&reserved.receipt?.nonce===intent.nonce&&
   typeof reserved.receipt?.spaceName==="string"&&
   /^spaces\/[A-Za-z0-9_-]{2,128}$/.test(reserved.receipt.spaceName))
    return {ok:true,replayed:true,providerCalled:false,nonce:intent.nonce,
      joinUrl:link.joinUrl,spaceName:reserved.receipt.spaceName};
  return {ok:false,reason:"MEETING_NONCE_RECONCILIATION_REQUIRED",
   committed:null,retrySameNonceOnly:true,providerCalled:false};
 }
 if(reserved?.status!=="RESERVED")return deny("MEETING_NONCE_NOT_RESERVED");
 // From this point a lost response may hide a real provider-created space.
 let token;
 try{token=await deps.accessToken();}
 catch{return unknown();}
 if(typeof token!=="string"||token.length<10||token.length>4096||
    /[\r\n]/.test(token))return unknown();
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
