import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WHATSAPP_AUTH_LANE_IDENTITIES as ids,
  WHATSAPP_AUTH_LANE_TEMPLATES as templates,
  requiredWhatsappLaneForOtpPurpose as lane,
  isExactWhatsappSenderForLane as match,
  canUseSignedClientOtpDispatch as clientDispatch,
  mustEnforceSignedAuthLaneIsolation as enforce,
} from "../../../lib/identity/whatsappAuthLaneIsolation.ts";

const client=ids.client;
const vendor=ids.vendor;
test("D01 Riya client phone and WABA are exact independent known assets",()=>{
  assert.deepEqual(client,{wabaId:"27861262223494153",phoneNumberId:"1333595106493545"});
});
test("D02 Anisha vendor phone and WABA are exact independent known assets",()=>{
  assert.deepEqual(vendor,{wabaId:"1569174604351612",phoneNumberId:"1088396637681784"});
});
test("D03 no shared WABA or phone-number ID",()=>{
  assert.notEqual(client.wabaId,vendor.wabaId);
  assert.notEqual(client.phoneNumberId,vendor.phoneNumberId);
});
test("D04 exact sender identity accepted only on its lane",()=>{
  assert.equal(match("client",client),true);
  assert.equal(match("vendor",vendor),true);
});
test("D05 vendor identity never accepted as Riya client",()=>{
  assert.equal(match("client",vendor),false);
});
test("D06 client identity never accepted as Anisha vendor",()=>{
  assert.equal(match("vendor",client),false);
});
test("D07 swapped and mixed phone/WABA fail closed",()=>{
  for(const laneName of ["client","vendor"]){
    const a=ids[laneName]; const b=ids[laneName==="client"?"vendor":"client"];
    assert.equal(match(laneName,{wabaId:a.wabaId,phoneNumberId:b.phoneNumberId}),false);
    assert.equal(match(laneName,{wabaId:b.wabaId,phoneNumberId:a.phoneNumberId}),false);
  }
});
test("D08 empty/invalid/unbounded provider IDs fail closed",()=>{
  for(const input of [null,undefined,{wabaId:"",phoneNumberId:""},{wabaId:"0",phoneNumberId:"1"},
    {wabaId:"27861262223494153x",phoneNumberId:client.phoneNumberId},
    {wabaId:client.wabaId,phoneNumberId:"1088396637681784"}]){
    assert.equal(match("client",input),false);
  }
});
test("D09 only privately claimed fixed purposes map to lanes",()=>{
  assert.equal(lane("client_login"),"client");
  assert.equal(lane("vendor_login"),"vendor");
});
test("D10 no purpose or attacker-picked purpose never defaults to client",()=>{
  for(const p of [null,undefined,"", "unknown", "vendor", "client", "admin", "VENDOR_LOGIN"]){
    assert.equal(lane(p),null);
  }
});
test("D11 vendor signed purpose cannot dispatch through client Hook",()=>{
  assert.equal(clientDispatch("vendor_login",client),false);
});
test("D12 even a client purpose cannot send through Anisha sender",()=>{
  assert.equal(clientDispatch("client_login",vendor),false);
});
test("D13 only signed client purpose and client sender may use legacy Riya Hook",()=>{
  assert.equal(clientDispatch("client_login",client),true);
});
test("D14 fail closed if signed purpose claim is missing",()=>{
  assert.equal(clientDispatch(null,client),false);
});
test("D15 wrong template name cannot silently become an opposite-lane template",()=>{
  assert.equal(templates.client,"qf_client_auth_otp");
  assert.equal(templates.vendor,"qf_vendor_auth_otp");
  assert.notEqual(templates.client,templates.vendor);
});
test("D16 default live client Hook retains its existing behavior",()=>{
  assert.equal(enforce({}),false);
  assert.equal(enforce({QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED:""}),false);
});
test("D17 any attempt to activate shared vendor Hook activates isolation",()=>{
  assert.equal(enforce({QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED:"staging"}),true);
  assert.equal(enforce({QF_VENDOR_AUTH_LANE_ISOLATION_MODE:"staging"}),true);
});
test("D18 actual signed Hook checks before invoking client dispatcher",()=>{
  const source=readFileSync("services/supabaseSendSmsHookService.ts","utf8");
  const first=source.indexOf("mustEnforceSignedAuthLaneIsolation(process.env)");
  const claim=source.indexOf("await claimSignedAuthOtpPurpose(",first);
  const gate=source.indexOf("canUseSignedClientOtpDispatch(signedPurpose",first);
  const dispatch=source.indexOf("await deliverClientLoginOtp(",first);
  assert.ok(first>=0 && claim>first && gate>claim && dispatch>gate);
  const cut=source.slice(gate,dispatch);
  assert.match(cut,/SendSmsHookOutcomeKind\.SERVICE_UNAVAILABLE/);
  assert.match(cut,/dispatchAttempted:\s*false/);
  assert.match(cut,/WHATSAPP_WABA_ID/);
  assert.match(cut,/WHATSAPP_PHONE_NUMBER_ID/);
});
test("D19 original Client/Riya OTP orchestrator is not replaced",()=>{
  const source=readFileSync("services/supabaseSendSmsHookService.ts","utf8");
  assert.match(source,/buildClientLoginOtpIntent/);
  assert.match(source,/evaluateClientLoginOtpGate/);
  assert.match(source,/deliverClientLoginOtp/);
});
test("D20 vendor OTP request remains disabled without external provider certification",()=>{
  const source=readFileSync("app/api/vendor/onboarding/request-otp/route.ts","utf8");
  assert.match(source,/QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED==="staging"/);
  assert.match(source,/QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED==="staging"/);
  assert.match(source,/deliveryConfirmed:false/);
});
