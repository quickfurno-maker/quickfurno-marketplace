import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessWhatsappStagingReadiness} from "../../../lib/communication/whatsappStagingReadiness.ts";

const client={id:"aaaaaaaa-1111-2222-3333-444444444444",provider_key:"meta_whatsapp_cloud",
 channel:"whatsapp",business_account_reference:"27861262223494153",phone_number_reference:"1333595106493545",
 account_alias:"riya_client",readiness_status:"disabled",configuration_status:"pending",
 health_status:"unknown",webhook_status:"pending",billing_status:"unknown"};
const vendor={id:"bbbbbbbb-1111-2222-3333-444444444444",provider_key:"meta_whatsapp_cloud",
 channel:"whatsapp",business_account_reference:"1569174604351612",phone_number_reference:"1088396637681784",
 account_alias:"core",readiness_status:"disabled",configuration_status:"partial",
 health_status:"unknown",webhook_status:"pending",billing_status:"unknown"};
const mapping=(key,name,id)=>({template_key:key,provider_key:"meta_whatsapp_cloud",
 channel:"whatsapp",provider_template_id:id,provider_template_name:name,
 approval_status:"approved",is_active:false});
const good={
 accounts:[client,vendor],
 runtimePolicies:[{provider_key:"meta_whatsapp_cloud",channel:"whatsapp",
   activation_status:"disabled",outbound_enabled:false,webhook_processing_enabled:false}],
 mappings:[mapping("client_login_otp","qf_client_auth_otp","1793889608370870"),
   mapping("vendor_login_otp","qf_vendor_auth_otp","1640977640737783")],
 automations:[{automation_key:"client_login_otp",is_operationally_enabled:false},
   {automation_key:"vendor_login_otp",is_operationally_enabled:false}],
};
const check=s=>assessWhatsappStagingReadiness(s);
test("F9-01 exact dormant Staging snapshot passes two-WABA identity inventory",()=>{
 const r=check(good);assert.equal(r.twoSenderInventoryValid,true);assert.equal(r.dormantConfigValid,true);
});
test("F9-02 dormant does not equal permission to send or approve",()=>{
 const r=check(good);assert.equal(r.releaseVerdict,"HOLD");assert.equal(r.canSendOtp,false);
 assert.equal(r.canApproveVendor,false);assert.equal(r.mode,"READ_ONLY");
});
test("F9-03 missing independent quality and device receipts always block GO",()=>{
 const r=check(good);assert.ok(r.blockers.includes("vendor_meta_quality_red_or_unverified"));
 assert.ok(r.blockers.includes("consented_handset_delivery_unverified"));
 assert.ok(r.blockers.includes("signed_runtime_hook_unverified"));
 assert.ok(r.blockers.includes("external_owner_go_required"));
});
test("F9-04 app-level inactive policy is explicit",()=>assert.ok(check(good).blockers.includes("runtime_messaging_inactive")));
test("F9-05 exact client and vendor role status is displayed without user data",()=>{
 const r=check(good);assert.deepEqual(r.clients,{lane:"client",accountRegistered:true,readiness:"disabled"});
 assert.deepEqual(r.vendors,{lane:"vendor",accountRegistered:true,readiness:"disabled"});
});
for(const [name,bad] of [
 ["client has vendor phone",{...client,phone_number_reference:vendor.phone_number_reference}],
 ["client has vendor WABA",{...client,business_account_reference:vendor.business_account_reference}],
 ["vendor has client phone",{...vendor,phone_number_reference:client.phone_number_reference}],
 ["vendor has client WABA",{...vendor,business_account_reference:client.business_account_reference}],
 ["vendor unknown WABA",{...vendor,business_account_reference:"9999999999999999"}],
 ["vendor unknown phone",{...vendor,phone_number_reference:"9999999999999999"}],
]){
 test("F9 identity fails on "+name,()=>{const a=bad.id===client.id?[bad,vendor]:[client,bad];
   const r=check({...good,accounts:a});assert.equal(r.twoSenderInventoryValid,false);
   assert.equal(r.canSendOtp,false);assert.equal(r.releaseVerdict,"HOLD");});
}
test("F9-12 third unexpected provider account refuses inventory",()=>{
 const r=check({...good,accounts:[...good.accounts,{...vendor,id:"cccccccc-1111-2222-3333-444444444444"}]});
 assert.equal(r.twoSenderInventoryValid,false);
 assert.ok(r.blockers.includes("unexpected_provider_account_rows"));
});
test("F9-13 missing a provider account fails closed",()=>{
 const r=check({...good,accounts:[client]});
 assert.equal(r.twoSenderInventoryValid,false);assert.ok(r.blockers.includes("missing_or_mixed_vendor_account"));
});
test("F9-14 absent policy denies even if mappings appear approved",()=>{
 const r=check({...good,runtimePolicies:[]});
 assert.equal(r.dormantConfigValid,false);assert.ok(r.blockers.includes("runtime_policy_unavailable"));
});
test("F9-15 unexpected outbound enablement demands investigation instead of GO",()=>{
 const r=check({...good,runtimePolicies:[{...good.runtimePolicies[0],outbound_enabled:true}]});
 assert.equal(r.dormantConfigValid,false);assert.ok(r.blockers.includes("unexpected_runtime_activation"));assert.equal(r.canSendOtp,false);
});
test("F9-16 unexpected webhook enablement remains HOLD",()=>{
 const r=check({...good,runtimePolicies:[{...good.runtimePolicies[0],webhook_processing_enabled:true}]});
 assert.ok(r.blockers.includes("unexpected_runtime_activation"));assert.equal(r.releaseVerdict,"HOLD");
});
test("F9-17 wrong vendor template ID cannot be accepted as correct mapping",()=>{
 const wrong={...good.mappings[1],provider_template_id:"1461908172056162"};
 const r=check({...good,mappings:[good.mappings[0],wrong]});
 assert.ok(r.blockers.includes("vendor_otp_mapping_missing_or_mismatched"));assert.equal(r.dormantConfigValid,false);
});
test("F9-18 provider mapping marked active unexpectedly is NOT considered dormant",()=>{
 const r=check({...good,mappings:[good.mappings[0],{...good.mappings[1],is_active:true}]});
 assert.ok(r.blockers.includes("unexpected_otp_mapping_activation"));assert.equal(r.dormantConfigValid,false);
});
test("F9-19 missing client template is detected",()=>{
 const r=check({...good,mappings:[good.mappings[1]]});
 assert.ok(r.blockers.includes("client_otp_mapping_missing_or_mismatched"));
});
test("F9-20 vendor automation enabled unexpectedly is detected",()=>{
 const r=check({...good,automations:[good.automations[0],{...good.automations[1],is_operationally_enabled:true}]});
 assert.ok(r.blockers.includes("unexpected_otp_automation_activation"));assert.equal(r.dormantConfigValid,false);
});
test("F9-21 no automation rows never silently default to green",()=>{
 const r=check({...good,automations:[]});
 assert.ok(r.blockers.includes("vendor_otp_automation_missing"));
 assert.ok(r.blockers.includes("client_otp_automation_missing"));
});
test("F9-22 apparently healthy accounts never prove external Meta quality",()=>{
 const accounts=good.accounts.map(a=>({...a,health_status:"healthy",billing_status:"active",webhook_status:"verified"}));
 const r=check({...good,accounts});
 assert.equal(r.releaseVerdict,"HOLD");
 assert.ok(r.blockers.includes("vendor_meta_quality_red_or_unverified"));
});
test("F9-23 read-only route is behind staging-only flag and AAL2 Owner verification",()=>{
 const src=readFileSync("app/api/vox/v1/owner-whatsapp-launch-readiness/route.ts","utf8");
 const flags=src.indexOf('VOX_OWNER_WHATSAPP_READINESS_ENABLED!=="staging"');
 const owner=src.indexOf("await verifyVoxOwnerBearer(");
 const db=src.indexOf("const db=adminClient()",owner);
 assert.ok(flags>=0&&owner>flags&&db>owner);
 assert.match(src,/const fresh=await verifyVoxOwnerBearer/);
 assert.match(src,/if\(fresh!==owner\)return forbidden\(\)/);
 assert.match(src,/private, no-store/);
});
test("F9-24 owner route has no side-effecting verbs or Meta sender",()=>{
 const src=readFileSync("app/api/vox/v1/owner-whatsapp-launch-readiness/route.ts","utf8");
 for(const verb of ["POST","PUT","PATCH","DELETE"])assert.match(src,new RegExp("export function "+verb+"\\("));
 for(const forbidden of [".insert(",".update(",".delete(",".upsert(","fetch(","deliverClientLoginOtp","deliverVendorWhatsappOtp"])assert.equal(src.includes(forbidden),false);
 assert.match(src,/assessWhatsappStagingReadiness\(/);
});
