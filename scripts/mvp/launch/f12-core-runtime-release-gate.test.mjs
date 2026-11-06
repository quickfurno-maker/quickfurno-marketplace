import test from "node:test";
import assert from "node:assert/strict";
import {CONTRACT,recognizeDefaultSender,auditStagingCoreRuntime} from "./f12-core-runtime-release-gate.mjs";
const good={
  networkExecuted:true,containerName:"qf-core-staging",
  imageTag:"qf-core-staging:new-code-revision",
  envNames:[...CONTRACT.requiredNames],
  deployedDefaultSender:"RIYA_CLIENT",vendorPairExact:true,
  coreCallbackHost:"staging-core.quickfurno.in",
  metaGetHttp:403,metaGetTls:0,authHookGetHttp:405,authHookGetTls:0,
  actualMetaRegisteredCallbackVerified:true,
  actualSupabaseAuthHookUriVerified:true,
  signedWebhookEndToEndVerified:true,
  vendorMetaQuality:"GREEN",
  consentAndOtpDeviceReceiptVerified:true,
  priorProtectedCICleared:true,ownerStageGo:true,
};
test("F12-01 known old vendor WABA+Anisha phone is stale, not a valid sender",()=>{
 assert.equal(recognizeDefaultSender(CONTRACT.oldVendorWaba,CONTRACT.vendor.phone),"STALE_VENDOR_WABA");
});
test("F12-02 exact separate Riya WABA+phone accepted as client identity",()=>{
 assert.equal(recognizeDefaultSender(CONTRACT.client.waba,CONTRACT.client.phone),"RIYA_CLIENT");
});
test("F12-03 exact separate Anisha WABA+phone identifiable",()=>{
 assert.equal(recognizeDefaultSender(CONTRACT.vendor.waba,CONTRACT.vendor.phone),"ANISHA_VENDOR");
});
test("F12-04 swapping Riya WABA and Anisha phone rejected",()=>{
 assert.equal(recognizeDefaultSender(CONTRACT.client.waba,CONTRACT.vendor.phone),"UNRECOGNIZED_OR_MISMATCHED");
});
test("F12-05 empty identity rejected",()=>{
 assert.equal(recognizeDefaultSender("",""),"UNCONFIGURED");
});
test("F12-06 stale deployment image flagged",()=>{
 const r=auditStagingCoreRuntime({...good,imageTag:CONTRACT.knownStaleImage});
 assert.ok(r.blockers.includes("STAGING_IMAGE_STALE_OCT30"));
});
test("F12-07 actual observed stale default account pairing is blocked",()=>{
 const r=auditStagingCoreRuntime({...good,deployedDefaultSender:"STALE_VENDOR_WABA"});
 assert.ok(r.blockers.includes("OLD_VENDOR_WABA_PAIRED_WITH_ANISHA_PHONE"));
 assert.ok(r.blockers.includes("DEFAULT_SENDER_NOT_RIYA_CLIENT"));
});
test("F12-08 vendor env missing fails closed",()=>{
 const r=auditStagingCoreRuntime({...good,envNames:good.envNames.filter(x=>!x.startsWith("WHATSAPP_VENDOR_")),vendorPairExact:false});
 assert.ok(r.blockers.includes("SEPARATE_ANISHA_SENDER_NOT_INSTALLED"));
 assert.ok(r.blockers.some(x=>x==="RUNTIME_ENV_MISSING_WHATSAPP_VENDOR_ACCESS_TOKEN"));
});
test("F12-09 Supabase hook signing secret missing fails",()=>{
 const r=auditStagingCoreRuntime({...good,envNames:good.envNames.filter(x=>x!=="SEND_SMS_HOOK_SECRETS")});
 assert.ok(r.blockers.includes("RUNTIME_ENV_MISSING_SEND_SMS_HOOK_SECRETS"));
});
test("F12-10 Meta app signature secret missing fails",()=>{
 const r=auditStagingCoreRuntime({...good,envNames:good.envNames.filter(x=>x!=="WHATSAPP_APP_SECRET")});
 assert.ok(r.blockers.includes("RUNTIME_ENV_MISSING_WHATSAPP_APP_SECRET"));
});
test("F12-11 direct Core 403/405 means application boundaries only",()=>{
 const r=auditStagingCoreRuntime({...good,actualMetaRegisteredCallbackVerified:false,actualSupabaseAuthHookUriVerified:false});
 assert.equal(r.directCoreIngressCompatible,true);
 assert.ok(r.blockers.includes("META_REGISTERED_CALLBACK_URI_UNVERIFIED"));
 assert.ok(r.blockers.includes("SUPABASE_REGISTERED_AUTH_HOOK_URI_UNVERIFIED"));
});
test("F12-12 wrong HTTP boundary denies",()=>{
 const r=auditStagingCoreRuntime({...good,metaGetHttp:302});
 assert.equal(r.directCoreIngressCompatible,false);
 assert.ok(r.blockers.includes("META_GET_APPLICATION_BOUNDARY_NOT_VERIFIED"));
});
test("F12-13 wrong auth hook HTTP status denies",()=>{
 const r=auditStagingCoreRuntime({...good,authHookGetHttp:302});
 assert.ok(r.blockers.includes("SUPABASE_HOOK_POST_ONLY_BOUNDARY_NOT_VERIFIED"));
});
test("F12-14 TLS not verified denies callback ingress",()=>{
 const r=auditStagingCoreRuntime({...good,metaGetTls:60});
 assert.equal(r.directCoreIngressCompatible,false);
});
test("F12-15 vendor quality RED denies",()=>{
 const r=auditStagingCoreRuntime({...good,vendorMetaQuality:"RED"});
 assert.ok(r.blockers.includes("VENDOR_META_QUALITY_NOT_VERIFIED_GREEN"));
});
test("F12-16 missing signed webhook E2E proof denies",()=>{
 const r=auditStagingCoreRuntime({...good,signedWebhookEndToEndVerified:false});
 assert.ok(r.blockers.includes("SIGNED_CALLBACK_END_TO_END_NOT_PROVEN"));
});
test("F12-17 protected CI review still needed",()=>{
 const r=auditStagingCoreRuntime({...good,priorProtectedCICleared:false});
 assert.ok(r.blockers.includes("CROSS_PHASE_PROTECTED_CI_NOT_CLEARED"));
});
test("F12-18 actual Owner Staging GO absent holds",()=>{
 const r=auditStagingCoreRuntime({...good,ownerStageGo:false});
 assert.ok(r.blockers.includes("OWNER_STAGING_RELEASE_GO_NOT_RECORDED"));
});
test("F12-19 even all-green fabricated fixture never grants OTP",()=>{
 const r=auditStagingCoreRuntime(good);
 assert.equal(r.releaseVerdict,"HOLD");assert.equal(r.maySendOtp,false);
 assert.equal(r.mayApproveVendor,false);assert.equal(r.mayDeployProduction,false);
});
test("F12-20 empty input remains fail closed",()=>{
 const r=auditStagingCoreRuntime();
 assert.equal(r.releaseVerdict,"HOLD");
 assert.ok(r.blockers.includes("STAGING_HOST_INSPECTION_NOT_EXECUTED"));
});
test("F12-21 untrusted malformed runtime evidence never sets GO",()=>{
 for(const e of [null,false,[],42,"ready"]){const r=auditStagingCoreRuntime(e);assert.equal(r.mayDeployProduction,false)}
});
test("F12-22 exact keys for both sender pairs never overlap",()=>{
 assert.notEqual(CONTRACT.client.waba,CONTRACT.vendor.waba);
 assert.notEqual(CONTRACT.client.phone,CONTRACT.vendor.phone);
});
