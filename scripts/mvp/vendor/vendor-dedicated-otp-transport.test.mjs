import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {renderWhatsAppTemplateComponents} from "../../../lib/communication/providers/whatsappTemplateBinding.ts";
import {
  prepareVendorOtpProviderEnv,hasValidVendorAccountIdentity,
  isApprovedVendorAutomation,isApprovedVendorOtpBinding,
  VENDOR_OTP_PROVIDER_TEMPLATE_ID,VENDOR_OTP_PROVIDER_KEY,deliverVendorWhatsappOtp,
  AUTH_OTP_COPY_CODE_MAPPING_SCHEMA,hasCanonicalOtpCopyCodeBinding,
} from "../../../lib/communication/vendorWhatsappOtpTransport.ts";

const E=Object.freeze({
  QF_RUNTIME_ENV:"staging",
  QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED:"staging",
  QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED:"staging",
  QF_VENDOR_AUTH_LANE_ISOLATION_MODE:"staging",
  QF_VENDOR_OTP_REQUEST_MODE:"staging",
  QF_VENDOR_REAL_OTP_CANARY_APPROVED:"staging",
  QF_VENDOR_META_QUALITY_RATING:"GREEN",
  QF_VENDOR_TRUSTED_WHATSAPP_PROVIDER:"meta_whatsapp_cloud",
  WHATSAPP_WABA_ID:"27861262223494153",
  WHATSAPP_PHONE_NUMBER_ID:"1333595106493545",
  WHATSAPP_ACCESS_TOKEN:"CLIENT_TOKEN_"+"c".repeat(49),
  WHATSAPP_VENDOR_ACCESS_TOKEN:"VENDOR_TOKEN_"+"v".repeat(49),
  WHATSAPP_VENDOR_WABA_ID:"1569174604351612",
  WHATSAPP_VENDOR_PHONE_NUMBER_ID:"1088396637681784",
  WHATSAPP_VENDOR_GRAPH_API_VERSION:"v26.0",
  WHATSAPP_VENDOR_AUTH_HTTP_TIMEOUT_MS:"3000",
});
const gateRow=Object.freeze({ok:true,providerAccountId:"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"});
const msg=Object.freeze({
 phoneE164:"+919999999999",otp:"123456",
 authUserId:"aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb",
 signedWebhookId:"msg-test-01",
 deadline:{remainingNetworkBudgetMs:()=>3500,totalBudgetMs:5000,responseReserveMs:750},
});
const goodBinding={
 template_key:"vendor_login_otp",provider_key:VENDOR_OTP_PROVIDER_KEY,
 channel:"whatsapp",provider_template_id:VENDOR_OTP_PROVIDER_TEMPLATE_ID,
 provider_template_name:"qf_vendor_auth_otp",language:"en",provider_category:"authentication",
 approval_status:"approved",is_active:true,
 variables_schema:AUTH_OTP_COPY_CODE_MAPPING_SCHEMA,
};
const goodAutomation={
 automation_key:"vendor_login_otp",lane:"authentication",channel:"whatsapp",
 provider_required:VENDOR_OTP_PROVIDER_KEY,template_key:"vendor_login_otp",
 readiness_status:"active",is_operationally_enabled:true,
};
const goodAccount={
 provider_key:VENDOR_OTP_PROVIDER_KEY,channel:"whatsapp",
 business_account_reference:"1569174604351612",
 phone_number_reference:"1088396637681784",
 readiness_status:"provider_ready",
 configuration_status:"complete",phone_number_status:"connected",
 webhook_status:"verified",billing_status:"active",
 health_status:"healthy",business_verification_status:"verified",
};
function fake(status="accepted",extra={}){
 const calls=[];
 const deps={
  gate:async()=>gateRow,
  send:async(intent,deadline,env)=>{
    calls.push({intent,deadline,env});
    return {ok:true,status,provider:VENDOR_OTP_PROVIDER_KEY,providerAccountId:gateRow.providerAccountId,...extra};
  },
 };
 return {calls,deps};
}
test("F7-01 fixed vendor credential and sender selects independent Meta",()=>{
 const r=prepareVendorOtpProviderEnv(E);
 assert.equal(r.ok,true);
 assert.equal(r.providerEnv.WHATSAPP_PROVIDER_MODE,"meta_cloud");
 assert.equal(r.providerEnv.WHATSAPP_WABA_ID,E.WHATSAPP_VENDOR_WABA_ID);
 assert.equal(r.providerEnv.WHATSAPP_PHONE_NUMBER_ID,E.WHATSAPP_VENDOR_PHONE_NUMBER_ID);
 assert.equal(r.providerEnv.WHATSAPP_ACCESS_TOKEN,E.WHATSAPP_VENDOR_ACCESS_TOKEN);
 assert.notEqual(r.providerEnv.WHATSAPP_ACCESS_TOKEN,E.WHATSAPP_ACCESS_TOKEN);
});
test("F7-02 provider name, template ID and category match vendor WABA",()=>{
 assert.equal(VENDOR_OTP_PROVIDER_TEMPLATE_ID,"1640977640737783");
 assert.equal(isApprovedVendorOtpBinding(goodBinding),true);
 assert.equal(isApprovedVendorAutomation(goodAutomation),true);
 assert.equal(hasValidVendorAccountIdentity(goodAccount),true);
});
for(const [field,value] of Object.entries({
 QF_RUNTIME_ENV:"production",
 QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED:"off",
 QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED:"off",
 QF_VENDOR_AUTH_LANE_ISOLATION_MODE:"off",
 QF_VENDOR_OTP_REQUEST_MODE:"off",
 QF_VENDOR_REAL_OTP_CANARY_APPROVED:"off",
 QF_VENDOR_META_QUALITY_RATING:"RED",
 WHATSAPP_VENDOR_WABA_ID:"27861262223494153",
 WHATSAPP_VENDOR_PHONE_NUMBER_ID:"1333595106493545",
 WHATSAPP_WABA_ID:"1569174604351612",
 WHATSAPP_PHONE_NUMBER_ID:"1088396637681784",
 WHATSAPP_VENDOR_GRAPH_API_VERSION:"vBAD",
 WHATSAPP_VENDOR_AUTH_HTTP_TIMEOUT_MS:"9000",
 QF_VENDOR_TRUSTED_WHATSAPP_PROVIDER:"meta_whatsapp",
})){
 test("F7 blocking incorrect "+field,()=>{
  const r=prepareVendorOtpProviderEnv({...E,[field]:value});
  assert.equal(r.ok,false);
 });
}
test("F7 no credential in vendor env denies",()=>{
 assert.equal(prepareVendorOtpProviderEnv({...E,WHATSAPP_VENDOR_ACCESS_TOKEN:""}).ok,false);
});
test("F7 cannot share exact credential even if sender IDs are distinct",()=>{
 assert.equal(prepareVendorOtpProviderEnv({...E,WHATSAPP_VENDOR_ACCESS_TOKEN:E.WHATSAPP_ACCESS_TOKEN}).ok,false);
});
for(const [field,value] of Object.entries({
 provider_template_id:"1461908172056162",
 provider_template_name:"qf_client_auth_otp",
 provider_category:"utility",template_key:"client_login_otp",
 channel:"sms",provider_key:"meta_whatsapp",language:"hi",
 approval_status:"pending",is_active:false,
})){
 test("F7 mapping refuses "+field,()=>{
  assert.equal(isApprovedVendorOtpBinding({...goodBinding,[field]:value}),false);
 });
}
for(const [field,value] of Object.entries({
 automation_key:"client_login_otp",lane:"business",channel:"sms",
 template_key:"client_login_otp",provider_required:"meta_whatsapp",
 readiness_status:"wiring_pending",is_operationally_enabled:false,
})){
 test("F7 automation refuses "+field,()=>{
  assert.equal(isApprovedVendorAutomation({...goodAutomation,[field]:value}),false);
 });
}
for(const [field,value] of Object.entries({
 business_account_reference:"2920988211610262",
 phone_number_reference:"1333595106493545",
 readiness_status:"disabled",
 configuration_status:"partial",phone_number_status:"flagged",
 webhook_status:"pending",billing_status:"unknown",
 health_status:"degraded",business_verification_status:"rejected",
 provider_key:"meta_whatsapp",channel:"sms",
})){
 test("F7 provider-account refuses "+field,()=>{
  assert.equal(hasValidVendorAccountIdentity({...goodAccount,[field]:value}),false);
 });
}
test("F7-allow valid signed vendor evidence builds only vendor intent",async()=>{
 const {calls,deps}=fake();
 const res=await deliverVendorWhatsappOtp(msg,E,deps);
 assert.deepEqual(res,{kind:"delivered",dispatchAttempted:true});
 assert.equal(calls.length,1);
 const {intent,env,deadline}=calls[0];
 assert.equal(deadline,msg.deadline);
 assert.equal(intent.type,"vendor_login_otp");
 assert.equal(intent.template_key,"vendor_login_otp");
 assert.equal(intent.channel,"whatsapp");
 assert.equal(intent.lane,"authentication");
 assert.equal(intent.recipient_type,"vendor");
 assert.equal(intent.destination_source.destination,msg.phoneE164);
 assert.equal(intent.variables.otp,msg.otp);
 assert.equal(intent.entity_type,"auth_user");
 assert.equal(intent.entity_id,msg.authUserId);
 assert.equal(intent.correlation_id,msg.signedWebhookId);
 assert.equal(intent.idempotency_key,"vendor_login_otp:"+msg.signedWebhookId);
 assert.equal(intent.scheduled_at,null);
 assert.equal(env.WHATSAPP_PHONE_NUMBER_ID,"1088396637681784");
 assert.notEqual(env.WHATSAPP_ACCESS_TOKEN,E.WHATSAPP_ACCESS_TOKEN);
});
test("F7 staging canary gate missing: zero gate reads and zero sends",async()=>{
 const {calls,deps}=fake();
 const res=await deliverVendorWhatsappOtp(msg,{...E,QF_VENDOR_REAL_OTP_CANARY_APPROVED:""},deps);
 assert.equal(res.kind,"service_unavailable");assert.equal(res.dispatchAttempted,false);
 assert.equal(calls.length,0);
});
test("F7 absent or unapproved DB gate: no send",async()=>{
 const {calls,deps}=fake();
 const res=await deliverVendorWhatsappOtp(msg,E,{...deps,gate:async()=>({ok:false})});
 assert.equal(res.kind,"service_unavailable");assert.equal(calls.length,0);
});
test("F7 DB gate outage: no send",async()=>{
 const {calls,deps}=fake();
 const res=await deliverVendorWhatsappOtp(msg,E,{...deps,gate:async()=>{throw Error("db down")}});
 assert.equal(res.kind,"service_unavailable");assert.equal(calls.length,0);
});
test("F7 no provider account receipt refuses success",async()=>{
 const {deps}=fake("accepted",{providerAccountId:"bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb"});
 const r=await deliverVendorWhatsappOtp(msg,E,deps);
 assert.equal(r.kind,"delivery_failed");
});
test("F7 mock provider response refuses success",async()=>{
 const {deps}=fake("accepted",{provider:"mock"});
 const r=await deliverVendorWhatsappOtp(msg,E,deps);
 assert.equal(r.kind,"delivery_failed");
});
test("F7 provider outcome unknown never retries or SMS",async()=>{
 const {calls,deps}=fake("outcome_unknown");
 const r=await deliverVendorWhatsappOtp(msg,E,deps);
 assert.equal(r.kind,"delivery_uncertain");assert.equal(calls.length,1);
});
test("F7 network exception parks uncertain without implicit fallback",async()=>{
 let calls=0;
 const r=await deliverVendorWhatsappOtp(msg,E,{gate:async()=>gateRow,
  send:async()=>{calls++;throw Error("ambiguous POST")}});
 assert.equal(r.kind,"delivery_uncertain");assert.equal(calls,1);
});
test("F7 provider rejection is terminal no retries",async()=>{
 const {calls,deps}=fake("failed");
 const r=await deliverVendorWhatsappOtp(msg,E,deps);
 assert.equal(r.kind,"delivery_failed");assert.equal(calls.length,1);
});
test("F7 blank/malformed OTP denied pre-provider",async()=>{
 const {calls,deps}=fake();
 const r=await deliverVendorWhatsappOtp({...msg,otp:"abc"},E,deps);
 assert.equal(r.dispatchAttempted,false);assert.equal(calls.length,0);
});
test("F7 spent signed Hook budget rejects before provider",async()=>{
 const {calls,deps}=fake();
 const r=await deliverVendorWhatsappOtp({...msg,deadline:{remainingNetworkBudgetMs:()=>100}},E,deps);
 assert.equal(r.dispatchAttempted,false);assert.equal(calls.length,0);
});
test("F7 static Hook accepts only signed vendor purpose, never anonymous",()=>{
 const s=readFileSync("services/supabaseSendSmsHookService.ts","utf8");
 const v=s.indexOf('if (signedPurpose === "vendor_login")');
 const claim=s.indexOf("await claimSignedAuthOtpPurpose(");
 const vendor=s.indexOf("await deliverVendorWhatsappOtp(");
 const client=s.indexOf("await deliverClientLoginOtp(");
 assert.ok(claim>0&&v>claim&&vendor>v&&client>vendor);
 assert.match(s,/getActiveSendSmsHookVerifier\(\)\.verify/);
 assert.match(s,/canUseSignedClientOtpDispatch/);
});
test("F7 static vendor adapter cannot use SMS, requeues or client orchestrator",()=>{
 const s=readFileSync("services/anishaWhatsappOtpDeliveryService.ts","utf8");
 assert.doesNotMatch(s,/deliverClientLoginOtp\(/);
 assert.doesNotMatch(s,/createRuntimeSmsProvider\(/);
 assert.match(s,/createRuntimeCommunicationService\(vendorEnv\)/);
 assert.match(s,/authDeadline:deadline/);
});

test("F7 verification accepts real Meta Cloud provider identity, not legacy alias",()=>{
 const signup=readFileSync("app/api/vendor/onboarding/complete/route.ts","utf8");
 const returning=readFileSync("services/returningWhatsappVendorLoginService.ts","utf8");
 const evidence=readFileSync("services/vendorOtpEvidenceReadService.ts","utf8");
 assert.match(signup,/return p==="meta_whatsapp_cloud" \? p : null/);
 assert.match(returning,/QF_VENDOR_TRUSTED_WHATSAPP_PROVIDER === "meta_whatsapp_cloud"/);
 assert.match(returning,/vendorWhatsappReturningModeEnabled\(\) \? "meta_whatsapp_cloud" : null/);
 assert.match(evidence,/\.eq\("provider", providerRequired\)/);
});
test("F7 exact vendor Meta provider row and green quality must both be verified",()=>{
 assert.equal(prepareVendorOtpProviderEnv({...E,QF_VENDOR_META_QUALITY_RATING:"RED"}).ok,false);
 assert.equal(prepareVendorOtpProviderEnv({...E,QF_VENDOR_META_QUALITY_RATING:"GREEN"}).ok,true);
 assert.equal(hasValidVendorAccountIdentity({...goodAccount,health_status:"degraded"}),false);
});
test("F7 no Provider metadata can activate by being merely Connected",()=>{
 const misleading={...goodAccount,readiness_status:"disabled",webhook_status:"pending",health_status:"unknown"};
 assert.equal(hasValidVendorAccountIdentity(misleading),false);
});

test("F7 Copy Code body and URL button use the SAME OTP source",()=>{
 assert.equal(hasCanonicalOtpCopyCodeBinding(AUTH_OTP_COPY_CODE_MAPPING_SCHEMA),true);
 assert.equal(isApprovedVendorOtpBinding(goodBinding),true);
});
test("F7 old empty placeholder binding cannot ever activate vendor OTP",()=>{
 assert.equal(hasCanonicalOtpCopyCodeBinding({bindingVersion:1,bindings:[]}),false);
 assert.equal(isApprovedVendorOtpBinding({...goodBinding,variables_schema:{bindingVersion:1,bindings:[]}}),false);
});
test("F7 mismatched or altered OTP button schema fails closed",()=>{
 const valid=AUTH_OTP_COPY_CODE_MAPPING_SCHEMA;
 for(const bad of [
  {...valid,bindings:[valid.bindings[0]]},
  {...valid,bindings:[valid.bindings[0],{...valid.bindings[1],sourceKey:"other"}]},
  {...valid,bindings:[valid.bindings[0],{...valid.bindings[1],buttonIndex:1}]},
  {...valid,bindings:[valid.bindings[0],{...valid.bindings[1],buttonSubType:"quick_reply"}]},
  {...valid,profile:"STANDARD_TEXT"},
 ]){
  assert.equal(hasCanonicalOtpCopyCodeBinding(bad),false);
 }
});
test("F7 vendor OTP evidence pins account ID and rejects client WABA receipts",()=>{
 const s=readFileSync("services/vendorOtpEvidenceReadService.ts","utf8");
 assert.match(s,/hasValidVendorAccountIdentity\(accounts\[0\]\)/);
 assert.match(s,/\.eq\("provider_account_id", vendorAccountId\)/);
 assert.match(s,/row\.provider_account_id !== vendorAccountId/);
 assert.match(s,/providerRequired !== VENDOR_OTP_PROVIDER_KEY/);
});

test("F7 approved Copy Code schema renders body and URL button with matching OTP",()=>{
 const result=renderWhatsAppTemplateComponents(AUTH_OTP_COPY_CODE_MAPPING_SCHEMA,{otp:"123456"});
 assert.equal(result.ok,true);
 assert.deepEqual(result.components,[
  {type:"body",parameters:[{type:"text",text:"123456"}]},
  {type:"button",sub_type:"url",index:"0",parameters:[{type:"text",text:"123456"}]},
 ]);
});
test("F7 Copy Code render denies extra variables and unsupported broken URL binding",()=>{
 const schema=AUTH_OTP_COPY_CODE_MAPPING_SCHEMA;
 assert.equal(renderWhatsAppTemplateComponents(schema,{otp:"123456",other:"7"}).ok,false);
 assert.equal(renderWhatsAppTemplateComponents({
  ...schema,bindings:[schema.bindings[0],{...schema.bindings[1],buttonSubType:"quick_reply"}],
 },{otp:"123456"}).ok,false);
});
