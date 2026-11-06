import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveWebhookIdentityRegistryConfig } from "../../../lib/communication/providers/metaCloudWhatsAppConfig.ts";
import { decideCallbackIdentityRegistry } from "../../../lib/communication/providers/metaCallbackIdentityRegistry.ts";
import { WHATSAPP_AUTH_LANE_IDENTITIES } from "../../../lib/communication/whatsappAuthLaneIsolation.ts";

const client = WHATSAPP_AUTH_LANE_IDENTITIES.client;
const vendor = WHATSAPP_AUTH_LANE_IDENTITIES.vendor;
const env = Object.freeze({
  WHATSAPP_WABA_ID:client.wabaId,
  WHATSAPP_PHONE_NUMBER_ID:client.phoneNumberId,
  WHATSAPP_VENDOR_WABA_ID:vendor.wabaId,
  WHATSAPP_VENDOR_PHONE_NUMBER_ID:vendor.phoneNumberId,
});
const conv = Object.freeze({wabaId:"123456789012345678",phoneNumberId:"987654321012345678"});
const withConv={...env,WHATSAPP_CONVERSATIONAL_WABA_ID:conv.wabaId,
  WHATSAPP_CONVERSATIONAL_PHONE_NUMBER_ID:conv.phoneNumberId};
function registry(e=env){const r=resolveWebhookIdentityRegistryConfig(e);assert.equal(r.ok,true);return r;}
function message(wabaId,phoneNumberId,display="not-a-trusted-id"){
  return {object:"whatsapp_business_account",entry:[{id:wabaId,
    changes:[{field:"messages",value:{metadata:{phone_number_id:phoneNumberId,
      display_phone_number:display},messages:[{id:"wamid-synthetic",type:"text"}]}}]}]};
}
test("F8-01 exact signed webhook registry includes Riya and Anisha without sharing identity",()=>{
 const r=registry();assert.deepEqual(r.identities,[client,vendor]);
 assert.notEqual(r.identities[0].wabaId,r.identities[1].wabaId);
 assert.notEqual(r.identities[0].phoneNumberId,r.identities[1].phoneNumberId);
});
test("F8-02 client-only config remains backward compatible",()=>{
 const e={WHATSAPP_WABA_ID:client.wabaId,WHATSAPP_PHONE_NUMBER_ID:client.phoneNumberId};
 assert.deepEqual(registry(e).identities,[client]);
});
test("F8-03 standalone conversational/Aarohi identity remains backwards-compatible",()=>{
 const e={WHATSAPP_WABA_ID:client.wabaId,WHATSAPP_PHONE_NUMBER_ID:client.phoneNumberId,
 WHATSAPP_CONVERSATIONAL_WABA_ID:conv.wabaId,WHATSAPP_CONVERSATIONAL_PHONE_NUMBER_ID:conv.phoneNumberId};
 assert.deepEqual(registry(e).identities,[client,conv]);
});
test("F8-04 separate optional third Aarohi identity coexists with Riya and Anisha",()=>{
 assert.deepEqual(registry(withConv).identities,[client,conv,vendor]);
});
test("F8-05 Riya callback authorized only with exact Client WABA+Phone ID",()=>{
 assert.equal(decideCallbackIdentityRegistry(message(client.wabaId,client.phoneNumberId),registry()).kind,"authorized");
});
test("F8-06 Anisha callback authorized only with exact Vendor WABA+Phone ID",()=>{
 assert.equal(decideCallbackIdentityRegistry(message(vendor.wabaId,vendor.phoneNumberId),registry()).kind,"authorized");
});
test("F8-07 third conversational callback authorized only when configured",()=>{
 assert.equal(decideCallbackIdentityRegistry(message(conv.wabaId,conv.phoneNumberId),registry(withConv)).kind,"authorized");
 assert.notEqual(decideCallbackIdentityRegistry(message(conv.wabaId,conv.phoneNumberId),registry()).kind,"authorized");
});
test("F8-08 Riya WABA cannot claim Anisha phone number",()=>{
 assert.equal(decideCallbackIdentityRegistry(message(client.wabaId,vendor.phoneNumberId),registry()).kind,"rejected");
});
test("F8-09 Anisha WABA cannot claim Riya phone number",()=>{
 assert.equal(decideCallbackIdentityRegistry(message(vendor.wabaId,client.phoneNumberId),registry()).kind,"rejected");
});
test("F8-10 foreign Meta WABA cannot claim a known sender",()=>{
 assert.equal(decideCallbackIdentityRegistry(message("123456789088888888",client.phoneNumberId),registry()).kind,"rejected");
 assert.equal(decideCallbackIdentityRegistry(message("123456789088888888",vendor.phoneNumberId),registry()).kind,"rejected");
});
test("F8-11 foreign Meta sender cannot impersonate either WABA",()=>{
 assert.equal(decideCallbackIdentityRegistry(message(client.wabaId,"123456789088888888"),registry()).kind,"rejected");
 assert.equal(decideCallbackIdentityRegistry(message(vendor.wabaId,"123456789088888888"),registry()).kind,"rejected");
});
test("F8-12 untrusted display number never authorizes a foreign phone id",()=>{
 assert.equal(decideCallbackIdentityRegistry(message(vendor.wabaId,client.phoneNumberId,"+91 93596 68469"),registry()).kind,"rejected");
});
test("F8-13 single callback envelope mixing Riya+Anisha is rejected as a whole",()=>{
 const r=registry();const c=message(client.wabaId,client.phoneNumberId);
 const v=message(vendor.wabaId,vendor.phoneNumberId);
 c.entry.push(v.entry[0]);
 assert.equal(decideCallbackIdentityRegistry(c,r).kind,"rejected");
});
test("F8-14 missing phone-number metadata cannot be inferred from WABA",()=>{
 const bad=message(vendor.wabaId,vendor.phoneNumberId);
 delete bad.entry[0].changes[0].value.metadata.phone_number_id;
 assert.equal(decideCallbackIdentityRegistry(bad,registry()).kind,"rejected");
});
test("F8-15 no vendor identity configured means vendor callbacks never authorized",()=>{
 const e={WHATSAPP_WABA_ID:client.wabaId,WHATSAPP_PHONE_NUMBER_ID:client.phoneNumberId};
 assert.notEqual(decideCallbackIdentityRegistry(message(vendor.wabaId,vendor.phoneNumberId),registry(e)).kind,"authorized");
});
for(const [name,bad] of [
 ["missing vendor WABA",{WHATSAPP_VENDOR_WABA_ID:""}],
 ["missing vendor Phone ID",{WHATSAPP_VENDOR_PHONE_NUMBER_ID:""}],
 ["Riya WABA mistakenly used for vendor",{WHATSAPP_VENDOR_WABA_ID:client.wabaId}],
 ["Riya phone mistakenly used for vendor",{WHATSAPP_VENDOR_PHONE_NUMBER_ID:client.phoneNumberId}],
 ["unknown vendor WABA",{WHATSAPP_VENDOR_WABA_ID:"123456789088888888"}],
 ["unknown vendor Phone ID",{WHATSAPP_VENDOR_PHONE_NUMBER_ID:"123456789088888888"}],
 ["invalid phone-number grammar",{WHATSAPP_VENDOR_PHONE_NUMBER_ID:"1088396637681784x"}],
 ["vendor pair shared as primary",{WHATSAPP_WABA_ID:vendor.wabaId,WHATSAPP_PHONE_NUMBER_ID:vendor.phoneNumberId}],
 ["primary/client phone swapped",{WHATSAPP_PHONE_NUMBER_ID:vendor.phoneNumberId}],
 ["primary/client WABA swapped",{WHATSAPP_WABA_ID:vendor.wabaId}],
 ["Aarohi shares vendor WABA",{WHATSAPP_CONVERSATIONAL_WABA_ID:vendor.wabaId,WHATSAPP_CONVERSATIONAL_PHONE_NUMBER_ID:conv.phoneNumberId}],
 ["Aarohi shares vendor sender",{WHATSAPP_CONVERSATIONAL_WABA_ID:conv.wabaId,WHATSAPP_CONVERSATIONAL_PHONE_NUMBER_ID:vendor.phoneNumberId}],
 ]){
 test("F8 deny "+name,()=>assert.equal(resolveWebhookIdentityRegistryConfig({...env,...bad}).ok,false));
}
test("F8-28 partial conversational config remains closed",()=>{
 assert.equal(resolveWebhookIdentityRegistryConfig({...env,WHATSAPP_CONVERSATIONAL_WABA_ID:conv.wabaId}).ok,false);
});
test("F8-29 repeated identical primary/conversational identity remains a single identity",()=>{
 const e={WHATSAPP_WABA_ID:client.wabaId,WHATSAPP_PHONE_NUMBER_ID:client.phoneNumberId,
 WHATSAPP_CONVERSATIONAL_WABA_ID:client.wabaId,WHATSAPP_CONVERSATIONAL_PHONE_NUMBER_ID:client.phoneNumberId};
 assert.deepEqual(registry(e).identities,[client]);
});
test("F8-30 prior same-WABA two-phone conversational behavior still supported",()=>{
 const e={WHATSAPP_WABA_ID:client.wabaId,WHATSAPP_PHONE_NUMBER_ID:client.phoneNumberId,
 WHATSAPP_CONVERSATIONAL_WABA_ID:client.wabaId,WHATSAPP_CONVERSATIONAL_PHONE_NUMBER_ID:conv.phoneNumberId};
 assert.deepEqual(registry(e).identities,[client,{wabaId:client.wabaId,phoneNumberId:conv.phoneNumberId}]);
});
test("F8-31 webhook dispatcher still verifies signature and binds provider account before effects",()=>{
 const source=readFileSync("services/metaWhatsAppWebhookService.ts","utf8");
 assert.match(source,/resolveWebhookIdentityRegistryConfig/);
 assert.match(source,/decideCallbackIdentityRegistry/);
 assert.match(source,/resolveEnvelopeProviderAccount/);
 assert.match(source,/verifyMetaWebhookSignatureBytes/);
 assert.match(source,/resolveOwningProviderAccount/);
});
test("F8-32 applied client inventory migration never enables Meta sends",()=>{
 const s=readFileSync("supabase/migrations/20261106120124_qf_f8_dormant_riya_client_provider_account.sql","utf8");
 assert.match(s,/1333595106493545/);
 assert.match(s,/27861262223494153/);
 assert.match(s,/1088396637681784/);
 assert.match(s,/'disabled','pending','unknown','connected','pending'/);
 assert.match(s,/outbound_enabled=false/);
 assert.match(s,/webhook_processing_enabled=false/);
 assert.match(s,/is_operationally_enabled=true/); // in deny-only EXISTS guard
 assert.doesNotMatch(s,/SET\s+(?:outbound_enabled|webhook_processing_enabled|is_operationally_enabled)\s*=\s*true/i);
});
