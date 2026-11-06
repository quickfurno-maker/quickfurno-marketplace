/**
 * F11: pure external callback provenance decision. NO NETWORK and NO SEND.
 * This is an operator evidence contract, not a production Access configuration.
 * It does not treat a 2xx/403/405 HTTP result as signed delivery proof.
 */
export const F11_CALLBACK_ROUTES=Object.freeze([
  Object.freeze({owner:"meta",path:"/api/webhooks/whatsapp/meta",
    methods:Object.freeze(["GET","POST"]),signature:"WHATSAPP_APP_SECRET + GET verify token"}),
  Object.freeze({owner:"supabase",path:"/api/auth/hooks/supabase-send-sms",
    methods:Object.freeze(["POST"]),signature:"SEND_SMS_HOOK_SECRETS / Standard Webhooks"}),
]);
export const F11_OWNER_PROTECTED="/api/vox/v1/owner-whatsapp-launch-readiness";
export const F11_DECISION_HOLD="HOLD";

function safeUrl(input){
 if(typeof input!=="string"||input.length>2048)return null;
 try{
  const u=new URL(input);
  if(u.protocol!=="https:"||!u.hostname||u.username||u.password||
     u.search||u.hash||u.port||u.pathname.endsWith("/"))return null;
  return u;
 }catch{return null;}
}
export function isExactProviderCallbackUrl(input,owner){
 const u=safeUrl(input),match=F11_CALLBACK_ROUTES.find(x=>x.owner===owner);
 return Boolean(u&&match&&u.pathname===match.path);
}
export function isCloudflareAccessRedirect(status,location){
 if(![301,302,303,307,308].includes(status)||typeof location!=="string")return false;
 try{
  const u=new URL(location);
  return u.protocol==="https:" &&
   (u.hostname.endsWith(".cloudflareaccess.com")||
    u.pathname.startsWith("/cdn-cgi/access/"));
 }catch{return false;}
}
export function assessF11CallbackEvidence(input={}){
 const blockers=[];
 const supabaseValid=isExactProviderCallbackUrl(input.supabaseHookUrl,"supabase");
 const metaValid=isExactProviderCallbackUrl(input.metaCallbackUrl,"meta");
 if(!supabaseValid)blockers.push("SUPABASE_CONFIGURED_CALLBACK_UNVERIFIED");
 if(!metaValid)blockers.push("META_CONFIGURED_CALLBACK_UNVERIFIED");
 const observed=Array.isArray(input.observed)?input.observed:[];
 for(const owner of ["supabase","meta"]){
  const row=observed.filter(x=>x?.owner===owner);
  if(row.length!==1){
   blockers.push(owner.toUpperCase()+"_PERIMETER_EVIDENCE_MISSING");
   continue;
  }
  const probe=row[0];
  if(isCloudflareAccessRedirect(probe.status,probe.location))
   blockers.push(owner.toUpperCase()+"_CLOUDFLARE_ACCESS_INTERCEPTED");
  else if(!Number.isInteger(probe.status)||probe.status<100||probe.status>599)
   blockers.push(owner.toUpperCase()+"_PERIMETER_STATUS_INVALID");
  else blockers.push(owner.toUpperCase()+"_SIGNED_ORIGIN_STILL_UNVERIFIED");
 }
 if(input.vendorQuality!=="GREEN")
  blockers.push("VENDOR_QUALITY_NOT_VERIFIED_GREEN");
 if(input.separateRuntimeSecretsVerified!==true)
  blockers.push("TWO_ISOLATED_STAGING_SECRET_SETS_UNVERIFIED");
 if(input.signedSupabaseHookVerified!==true)
  blockers.push("SIGNED_SUPABASE_AUTH_HOOK_NOT_LIVE_CERTIFIED");
 if(input.signedMetaCallbacksVerified!==true)
  blockers.push("SIGNED_META_INBOUND_CALLBACKS_NOT_LIVE_CERTIFIED");
 if(input.consentAndHandsetVerified!==true)
  blockers.push("CONSENTED_OTP_AND_PROVIDER_RECEIPT_NOT_VERIFIED");
 if(input.stagingOwnerApproved!==true)
  blockers.push("STAGING_OWNER_APPROVAL_PENDING");
 // Even a fully populated operator object cannot override the strictly
 // independent go/no-go decision in a source-only test. External evidence must
 // be collected, reviewed and signed by Owner in a separate controlled phase.
 return Object.freeze({
  schema:"quickfurno.f11.callback-readiness.v1",
  verdict:F11_DECISION_HOLD,
  maySendOtp:false,
  mayDeployProduction:false,
  sourceOnly:true,
  blockers:Object.freeze([...new Set(blockers)]),
 });
}
