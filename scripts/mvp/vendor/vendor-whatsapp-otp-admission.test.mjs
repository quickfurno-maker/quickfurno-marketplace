import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateVendorOtpAdmission,
  VENDOR_OTP_MESSAGE_TYPE,
  VENDOR_OTP_AUTH_MAX_AGE_MS,
} from "../../../lib/identity/vendorWhatsappOtpAdmission.ts";

const now = Date.parse("2026-11-04T11:45:00.000Z");
const good = () => ({
  authUserId: "00000000-0000-4000-8000-000000000111",
  authPhoneE164: "+919876543210",
  phoneConfirmedAt: new Date(now - 60_000).toISOString(),
  expectedPhoneE164: "+919876543210",
  existingProfileRole: null,
  delivery: {
    authUserId: "00000000-0000-4000-8000-000000000111",
    phoneE164: "+919876543210",
    messageType: VENDOR_OTP_MESSAGE_TYPE,
    channel: "whatsapp",
    status: "delivered",
    verifiedWebhookId: "wh_1",
    deliveredAt: new Date(now - 30_000).toISOString(),
  },
  nowMs: now,
});
const rejection = (change, reason) =>
  assert.deepEqual(evaluateVendorOtpAdmission({...good(), ...change}),{admitted:false,reason});

test("A1 allows only fresh verified vendor WhatsApp delivery bound to verified Auth user",()=>{
  assert.deepEqual(evaluateVendorOtpAdmission(good()),{admitted:true});
  assert.equal(VENDOR_OTP_AUTH_MAX_AGE_MS,600000);
});
test("A2 rejects missing or mismatched Supabase phone claims",()=>{
  rejection({expectedPhoneE164:"9876543210"},"invalid_phone");
  rejection({authPhoneE164:"+919876543211"},"phone_mismatch");
  rejection({authUserId:""},"phone_mismatch");
  rejection({phoneConfirmedAt:null},"phone_unconfirmed");
});
test("A3 never upgrades existing client/admin/other principal from phone possession",()=>{
  for(const existingProfileRole of ["client","admin","superadmin","integration","staff"])
    rejection({existingProfileRole},"privileged_or_conflicting_role");
  assert.deepEqual(evaluateVendorOtpAdmission({...good(),existingProfileRole:"vendor"}),{admitted:true});
});
test("A4 requires server-proven webhook delivery, not a browser checkbox",()=>{
  rejection({delivery:null},"no_verified_delivery");
  rejection({delivery:{...good().delivery,verifiedWebhookId:""}},"no_verified_delivery");
  rejection({delivery:{...good().delivery,authUserId:"other"}},"delivery_subject_mismatch");
  rejection({delivery:{...good().delivery,phoneE164:"+919876543211"}},"delivery_subject_mismatch");
});
test("A5 never allows the existing client-login OTP channel to prove vendor signup",()=>{
  rejection({delivery:{...good().delivery,messageType:"client_login_otp"}},"not_vendor_whatsapp_otp");
  rejection({delivery:{...good().delivery,channel:"sms"}},"not_vendor_whatsapp_otp");
});
test("A6 blocks in-progress, failed or unproved OTP delivery",()=>{
  for(const status of ["queued","pending","failed","cancelled","outcome_unknown"])
    rejection({delivery:{...good().delivery,status}},"not_proven_delivered");
});
test("A7 enforces short delivery freshness; no stale replay/future attestation",()=>{
  rejection({delivery:{...good().delivery,deliveredAt:new Date(now-600001).toISOString()}},"stale_delivery");
  rejection({delivery:{...good().delivery,deliveredAt:new Date(now+31000).toISOString()}},"stale_delivery");
  rejection({delivery:{...good().delivery,deliveredAt:"not-a-date"}},"stale_delivery");
});
