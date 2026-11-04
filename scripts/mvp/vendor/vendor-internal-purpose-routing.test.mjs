import test from "node:test";
import assert from "node:assert/strict";
import { routeVerifiedSignedOtp } from "../../../lib/identity/authOtpPurposeRouter.ts";
import { decideVerifiedVendorSignup } from "../../../lib/vendors/vendorVerifiedSignupDecision.ts";
const ID="00000000-0000-4000-8000-000000000001";
const VID="10000000-0000-4000-8000-000000000001";
const event=()=>({authUserId:ID,phoneE164:"+919876543210",otp:"123456",verifiedWebhookId:"verified-hook-id",signatureVerified:true});
const mock=(claimed)=>{const calls=[];return {calls,dependencies:{
 claim:async()=>{calls.push("claim");return claimed;},
 allowClient:async()=>{calls.push("gate-client");return true;},
 allowVendor:async()=>{calls.push("gate-vendor");return true;},
 dispatchClient:async()=>{calls.push("send-client");return true;},
 dispatchVendor:async()=>{calls.push("send-vendor");return true;},
}};};
test("R1 client OTP only traverses client lane",async()=>{const m=mock("client_login");assert.deepEqual(await routeVerifiedSignedOtp(event(),m.dependencies),{kind:"dispatched",purpose:"client_login"});assert.deepEqual(m.calls,["claim","gate-client","send-client"]);});
test("R2 vendor OTP only traverses vendor WhatsApp lane",async()=>{const m=mock("vendor_login");assert.deepEqual(await routeVerifiedSignedOtp(event(),m.dependencies),{kind:"dispatched",purpose:"vendor_login"});assert.deepEqual(m.calls,["claim","gate-vendor","send-vendor"]);});
test("R3 a missing or unknown reservation never defaults to client",async()=>{for(const p of [null,"", "vendor_password_reset","unknown"]){const m=mock(p);assert.equal((await routeVerifiedSignedOtp(event(),m.dependencies)).kind,"blocked");assert.deepEqual(m.calls,["claim"]);}});
test("R4 unsigned or malformed webhook cannot claim or dispatch",async()=>{for(const delta of [{signatureVerified:false},{phoneE164:"9876543210"},{authUserId:"not-uuid"},{verifiedWebhookId:""},{otp:"not-an-otp"}]){const m=mock("vendor_login");assert.equal((await routeVerifiedSignedOtp({...event(),...delta},m.dependencies)).kind,"blocked");assert.deepEqual(m.calls,[]);}});
test("R5 vendor gate denied or failed means no transport and no client fallback",async()=>{const m=mock("vendor_login");m.dependencies.allowVendor=async()=>{m.calls.push("gate-vendor");return false;};assert.equal((await routeVerifiedSignedOtp(event(),m.dependencies)).kind,"blocked");assert.deepEqual(m.calls,["claim","gate-vendor"]);});
test("R6 uncertain provider outcome or claim exception never triggers alternate channel",async()=>{const m=mock("vendor_login");m.dependencies.dispatchVendor=async()=>{m.calls.push("send-vendor");throw Error("provider unknown");};assert.equal((await routeVerifiedSignedOtp(event(),m.dependencies)).kind,"blocked");assert.deepEqual(m.calls,["claim","gate-vendor","send-vendor"]);});
const proof=()=>({authUserId:ID,authPhoneE164:"+919876543210",submittedMobile:"9876543210",phoneConfirmedAt:"2026-11-04T10:00:00.000Z",serverOtpAdmission:"admitted",existingClientAccount:false,existingProfileRole:null,existingVendorLink:null});
test("R7 verified neutral phone principal can start one Pending application",()=>{assert.deepEqual(decideVerifiedVendorSignup(proof()),{kind:"create_pending",authUserId:ID,mobile10:"9876543210"});assert.deepEqual(decideVerifiedVendorSignup({...proof(),submittedMobile:"+919876543210"}),{kind:"create_pending",authUserId:ID,mobile10:"9876543210"});});
test("R8 verified phone evidence cannot be faked by an unverified session",()=>{for(const p of [null,"denied"]){assert.equal(decideVerifiedVendorSignup({...proof(),serverOtpAdmission:p}).kind,"deny");}assert.equal(decideVerifiedVendorSignup({...proof(),phoneConfirmedAt:null}).kind,"deny");assert.equal(decideVerifiedVendorSignup({...proof(),authPhoneE164:"+919876543211"}).kind,"deny");});
test("R9 client role, existing client account or unknown lookup fails closed",()=>{for(const delta of [{existingClientAccount:true},{existingClientAccount:null},{existingProfileRole:"admin"},{existingProfileRole:"client"},{existingVendorLink:undefined}])assert.equal(decideVerifiedVendorSignup({...proof(),...delta}).kind,"deny");});
test("R10 duplicate registration resumes only the exact same Auth/vendor/phone",()=>{const same={authUserId:ID,vendorId:VID,phone:"9876543210"};assert.deepEqual(decideVerifiedVendorSignup({...proof(),existingVendorLink:same}),{kind:"resume_existing",vendorId:VID});for(const delta of [{authUserId:"00000000-0000-4000-8000-000000000002"},{vendorId:"wrong"},{phone:"9999999999"}])assert.equal(decideVerifiedVendorSignup({...proof(),existingVendorLink:{...same,...delta}}).kind,"deny");});
