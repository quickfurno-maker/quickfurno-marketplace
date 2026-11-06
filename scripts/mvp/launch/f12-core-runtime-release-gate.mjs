/**
 * F12 immutable two-sender Staging upgrade decision.
 * Inputs are sanitized observations, NEVER tokens, OTP, customer data, secrets.
 * Source-only evaluator: no fetch, DB query, file mutation or send capability.
 * The only verdict is HOLD, regardless of synthetic truthy input.
 */
export const CONTRACT=Object.freeze({
  client:{waba:"27861262223494153",phone:"1333595106493545"},
  vendor:{waba:"1569174604351612",phone:"1088396637681784"},
  oldVendorWaba:"2920988211610262",
  knownStaleImage:"qf-core-staging:09b9d7a4",
  expectedCoreHost:"staging-core.quickfurno.in",
  requiredNames:Object.freeze([
    "WHATSAPP_ACCESS_TOKEN","WHATSAPP_WABA_ID","WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_VENDOR_ACCESS_TOKEN","WHATSAPP_VENDOR_WABA_ID",
    "WHATSAPP_VENDOR_PHONE_NUMBER_ID","WHATSAPP_APP_SECRET",
    "WHATSAPP_WEBHOOK_VERIFY_TOKEN","SEND_SMS_HOOK_SECRETS",
  ]),
});
export function recognizeDefaultSender(waba,phone){
  if(waba===CONTRACT.client.waba&&phone===CONTRACT.client.phone)return "RIYA_CLIENT";
  if(waba===CONTRACT.vendor.waba&&phone===CONTRACT.vendor.phone)return "ANISHA_VENDOR";
  if(waba===CONTRACT.oldVendorWaba&&phone===CONTRACT.vendor.phone)return "STALE_VENDOR_WABA";
  if(!waba||!phone)return "UNCONFIGURED";
  return "UNRECOGNIZED_OR_MISMATCHED";
}
export function auditStagingCoreRuntime(observation={}){
  const errors=[];
  const e=observation&&typeof observation==="object"&&!Array.isArray(observation)?observation:{};
  if(e.networkExecuted!==true)errors.push("STAGING_HOST_INSPECTION_NOT_EXECUTED");
  if(e.containerName!=="qf-core-staging")errors.push("UNEXPECTED_CONTAINER_IDENTITY");
  if(typeof e.imageTag!=="string"||e.imageTag.trim()==="")
    errors.push("STAGING_IMAGE_UNVERIFIED");
  else if(e.imageTag===CONTRACT.knownStaleImage)
    errors.push("STAGING_IMAGE_STALE_OCT30");
  const vars=Array.isArray(e.envNames)?e.envNames.filter(x=>typeof x==="string"):[];
  const set=new Set(vars);
  for(const name of CONTRACT.requiredNames)if(!set.has(name))
    errors.push("RUNTIME_ENV_MISSING_"+name);
  const sender=typeof e.deployedDefaultSender==="string"?e.deployedDefaultSender:"UNVERIFIED";
  if(sender!=="RIYA_CLIENT")errors.push("DEFAULT_SENDER_NOT_RIYA_CLIENT");
  if(sender==="STALE_VENDOR_WABA")errors.push("OLD_VENDOR_WABA_PAIRED_WITH_ANISHA_PHONE");
  const clientOK=sender==="RIYA_CLIENT";
  const vendorPairVerified=e.vendorPairExact===true;
  if(!vendorPairVerified)errors.push("SEPARATE_ANISHA_SENDER_NOT_INSTALLED");
  if(e.coreCallbackHost!==CONTRACT.expectedCoreHost)
    errors.push("CORE_CALLBACK_HOST_NOT_VERIFIED");
  if(e.metaGetHttp!==403||e.metaGetTls!==0)
    errors.push("META_GET_APPLICATION_BOUNDARY_NOT_VERIFIED");
  if(e.authHookGetHttp!==405||e.authHookGetTls!==0)
    errors.push("SUPABASE_HOOK_POST_ONLY_BOUNDARY_NOT_VERIFIED");
  if(e.actualMetaRegisteredCallbackVerified!==true)
    errors.push("META_REGISTERED_CALLBACK_URI_UNVERIFIED");
  if(e.actualSupabaseAuthHookUriVerified!==true)
    errors.push("SUPABASE_REGISTERED_AUTH_HOOK_URI_UNVERIFIED");
  if(e.signedWebhookEndToEndVerified!==true)
    errors.push("SIGNED_CALLBACK_END_TO_END_NOT_PROVEN");
  if(e.vendorMetaQuality!=="GREEN")
    errors.push("VENDOR_META_QUALITY_NOT_VERIFIED_GREEN");
  if(e.consentAndOtpDeviceReceiptVerified!==true)
    errors.push("CONSENTED_DEVICE_OTP_NOT_PROVEN");
  if(e.priorProtectedCICleared!==true)
    errors.push("CROSS_PHASE_PROTECTED_CI_NOT_CLEARED");
  if(e.ownerStageGo!==true)
    errors.push("OWNER_STAGING_RELEASE_GO_NOT_RECORDED");
  return Object.freeze({
    schema:"quickfurno.f12.staging-core-runtime-attestation.v1",
    mode:"READ_ONLY",
    releaseVerdict:"HOLD",
    maySendOtp:false,
    mayApproveVendor:false,
    mayDeployProduction:false,
    expectedClient:"Riya",
    expectedVendor:"Anisha",
    currentlyObservedDefaultSender:sender,
    clientIdentityInstalled:clientOK,
    vendorIdentityInstalled:vendorPairVerified,
    directCoreIngressCompatible:e.metaGetHttp===403&&e.metaGetTls===0&&e.authHookGetHttp===405&&e.authHookGetTls===0,
    imageTag:typeof e.imageTag==="string"?e.imageTag:"UNKNOWN",
    blockers:Object.freeze([...new Set(errors)]),
  });
}
if(process.argv[1]?.endsWith("f12-core-runtime-release-gate.mjs") &&
    process.argv.includes("--stdin")){
  let source="";
  for await (const part of process.stdin){
    source+=part;
    if(source.length>20000)throw Error("F12_SANITIZED_OBSERVATION_TOO_LARGE");
  }
  let parsed;
  try{parsed=JSON.parse(source)}catch{parsed={}}
  console.log(JSON.stringify(auditStagingCoreRuntime(parsed)));
}
