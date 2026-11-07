import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {
 prepareVendorOtpProviderEnv, deliverVendorWhatsappOtp,
 isApprovedRedVendorOtpCanary, isApprovedRedVendorOtpRecipient,
} from "../../../lib/communication/vendorWhatsappOtpTransport.ts";
const PHONE="+919999999999";
const HASH=createHash("sha256").update(PHONE,"utf8").digest("hex");
const expiresIn=ms=>new Date(Date.now()+ms).toISOString().replace(/\.\d{3}Z$/,"Z");
const ENV=Object.freeze({
 QF_RUNTIME_ENV:"staging",
 QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED:"staging",
 QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED:"staging",
 QF_VENDOR_AUTH_LANE_ISOLATION_MODE:"staging",
 QF_VENDOR_OTP_REQUEST_MODE:"staging",
 QF_VENDOR_REAL_OTP_CANARY_APPROVED:"staging",
 QF_VENDOR_META_QUALITY_RATING:"RED",
 QF_VENDOR_META_PHONE_STATUS:"CONNECTED",
 QF_VENDOR_RED_CANARY_APPROVED:"staging",
 QF_VENDOR_RED_CANARY_PHONE_SHA256:HASH,
 QF_VENDOR_TRUSTED_WHATSAPP_PROVIDER:"meta_whatsapp_cloud",
 WHATSAPP_WABA_ID:"27861262223494153",
 WHATSAPP_PHONE_NUMBER_ID:"1333595106493545",
 WHATSAPP_ACCESS_TOKEN:"CLIENT_"+"c".repeat(50),
 WHATSAPP_VENDOR_ACCESS_TOKEN:"VENDOR_"+"v".repeat(50),
 WHATSAPP_VENDOR_WABA_ID:"1569174604351612",
 WHATSAPP_VENDOR_PHONE_NUMBER_ID:"1088396637681784",
 WHATSAPP_VENDOR_GRAPH_API_VERSION:"v26.0",
 WHATSAPP_VENDOR_AUTH_HTTP_TIMEOUT_MS:"3000",
});
const good=()=>({...ENV,QF_VENDOR_RED_CANARY_UTC_EXPIRES_AT:expiresIn(5*60*1000)});
const input=(phoneE164=PHONE)=>({phoneE164,otp:"123456",
 authUserId:"aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb",
 signedWebhookId:"f16-test-signed-only",
 deadline:{remainingNetworkBudgetMs:()=>3500,totalBudgetMs:5000,responseReserveMs:750}});
function deps(){
 const calls={gate:0,send:0};
 return {calls,impl:{
  gate:async()=>{calls.gate++;return {ok:true,providerAccountId:"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}},
  send:async()=>{calls.send++;return {ok:true,status:"accepted",provider:"meta_whatsapp_cloud",providerAccountId:"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}},
 }};
}
test("F16-01 RED default denial",()=>assert.equal(prepareVendorOtpProviderEnv({...ENV,QF_VENDOR_RED_CANARY_APPROVED:undefined}).ok,false));
test("F16-02 explicit CONNECTED RED canary preflight",()=>{
 const e=good();assert.equal(isApprovedRedVendorOtpCanary(e),true);assert.equal(prepareVendorOtpProviderEnv(e).ok,true);
});
test("F16-03 production, wrong status, missing/invalid authorization deny",()=>{
 for(const [k,v] of [["QF_RUNTIME_ENV","production"],["QF_VENDOR_META_PHONE_STATUS","FLAGGED"],
  ["QF_VENDOR_META_PHONE_STATUS","RESTRICTED"],["QF_VENDOR_META_PHONE_STATUS",undefined],
  ["QF_VENDOR_RED_CANARY_APPROVED","true"],["QF_VENDOR_RED_CANARY_APPROVED",undefined],
  ["QF_VENDOR_RED_CANARY_PHONE_SHA256","f".repeat(63)],
  ["QF_VENDOR_RED_CANARY_UTC_EXPIRES_AT",undefined]])
   assert.equal(isApprovedRedVendorOtpCanary({...good(),[k]:v}),false,k);
});
test("F16-04 expired, future over 15 minutes, non UTC timestamps deny",()=>{
 for(const val of [expiresIn(-1000),expiresIn(20*60*1000),"2026-11-07T10:00:00+05:30","not-a-date"])
  assert.equal(isApprovedRedVendorOtpCanary({...good(),QF_VENDOR_RED_CANARY_UTC_EXPIRES_AT:val}),false,val);
});
test("F16-05 GREEN path unchanged",()=>assert.equal(prepareVendorOtpProviderEnv({...ENV,QF_VENDOR_META_QUALITY_RATING:"GREEN",QF_VENDOR_RED_CANARY_APPROVED:undefined}).ok,true));
test("F16-06 YELLOW/UNKNOWN cannot silently pass",()=>{
 for(const value of ["YELLOW","UNVERIFIED","",undefined])
  assert.equal(prepareVendorOtpProviderEnv({...good(),QF_VENDOR_META_QUALITY_RATING:value}).ok,false);
});
test("F16-07 wrong recipient denies before DB or sends",async()=>{
 const d=deps(),ret=await deliverVendorWhatsappOtp(input("+918888888888"),good(),d.impl);
 assert.equal(ret.kind,"service_unavailable");assert.equal(d.calls.gate,0);assert.equal(d.calls.send,0);
});
test("F16-08 exact recipient still depends on DB gate and sender",async()=>{
 const d=deps(),ret=await deliverVendorWhatsappOtp(input(),good(),d.impl);
 assert.equal(ret.kind,"delivered");assert.equal(d.calls.gate,1);assert.equal(d.calls.send,1);
});
test("F16-09 DB gate denial still blocks",async()=>{
 const d=deps();d.impl.gate=async()=>{d.calls.gate++;return {ok:false}};
 const ret=await deliverVendorWhatsappOtp(input(),good(),d.impl);
 assert.equal(ret.kind,"service_unavailable");assert.equal(d.calls.send,0);
});
test("F16-10 distinct vendor/client sender and tokens mandatory",()=>{
 const e=good();for(const bad of [
  {WHATSAPP_VENDOR_ACCESS_TOKEN:e.WHATSAPP_ACCESS_TOKEN},
  {WHATSAPP_VENDOR_WABA_ID:e.WHATSAPP_WABA_ID},
  {WHATSAPP_VENDOR_PHONE_NUMBER_ID:e.WHATSAPP_PHONE_NUMBER_ID},
  {WHATSAPP_WABA_ID:e.WHATSAPP_VENDOR_WABA_ID},
  {WHATSAPP_VENDOR_ACCESS_TOKEN:undefined},
 ])assert.equal(prepareVendorOtpProviderEnv({...e,...bad}).ok,false);
});
test("F16-11 Meta rejection remains a failed delivery",async()=>{
 const d=deps();d.impl.send=async()=>{d.calls.send++;return {ok:false,status:"rejected"}};
 const ret=await deliverVendorWhatsappOtp(input(),good(),d.impl);
 assert.equal(ret.kind,"delivery_failed");assert.equal(d.calls.send,1);
});
test("F16-12 phone hash must exactly match",()=>{
 const e=good();assert.equal(isApprovedRedVendorOtpRecipient(e,PHONE),true);
 assert.equal(isApprovedRedVendorOtpRecipient({...e,QF_VENDOR_RED_CANARY_PHONE_SHA256:"0".repeat(64)},PHONE),false);
 assert.equal(isApprovedRedVendorOtpRecipient(e,"+15555555555"),false);
});
