import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=(path)=>readFileSync(path,"utf8");
const reader=source("services/vendorOtpEvidenceReadService.ts");
const executableReader=reader.replace(/\/\*[\s\S]*?\*\//g," ").replace(/^\s*\/\/.*$/gm,"");
const privateService=source("services/authOtpPurposeReservationService.ts");
const sql=source("supabase/migrations/20261104140000_vendor_private_otp_and_verification_foundation.sql");

test("E1 evidence inspection is server-only, staging opt-in, and read-only",()=>{
  assert.match(reader,/import "server-only"/);
  assert.match(reader,/QF_VENDOR_OTP_EVIDENCE_READ_ENABLED !== "staging"/);
  assert.match(reader,/await serverClient\(\)/);
  assert.match(reader,/await sb\.auth\.getUser\(\)/);
  assert.match(reader,/user\.phone !== expectedPhoneE164/);
  assert.doesNotMatch(reader,/\.signInWithOtp\(|\.verifyOtp\(|\.createUser\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.sendMessage\(/);
});
test("E2 purpose receipt is a HMAC + Auth principal matched, signed hook claim",()=>{
  assert.match(privateService,/createHmac\("sha256", secret\)/);
  assert.match(privateService,/qf_read_claimed_vendor_auth_otp_purpose/);
  assert.match(privateService,/p_phone_digest: digest/);
  assert.match(privateService,/p_auth_user_id: authUserId/);
  assert.match(privateService,/row\.purpose !== "vendor_login"/);
  assert.match(privateService,/row\.state !== "claimed"/);
  assert.match(privateService,/row\.auth_user_id !== authUserId/);
  assert.match(privateService,/row\.phone_digest !== digest/);
  assert.match(reader,/await readClaimedVendorOtpPurpose\(expectedPhoneE164, user\.id\)/);
  assert.doesNotMatch(reader,/user_metadata|app_metadata|body\.authUserId/);
});
test("E3 only a unique vendor WhatsApp message bound to the same webhook/provider qualifies",()=>{
  for(const term of [
    '.eq("message_type", "vendor_login_otp")',
    '.eq("lane", "authentication")',
    '.eq("channel", "whatsapp")',
    '.eq("recipient_type", "vendor")',
    '.eq("entity_type", "auth_user")',
    '.eq("entity_id", user.id)',
    '.eq("destination_hash", destinationHash)',
    '.eq("provider", providerRequired)',
    '.eq("correlation_id", claim.verifiedWebhookId)',
    '.limit(2)',
    'data.length !== 1',
  ]) assert.ok(reader.includes(term),term);
  assert.match(reader,/\["mock", "fake", "test", "development", "local"\]/);
  assert.match(reader,/row\.provider !== providerRequired/);
  assert.match(reader,/row\.correlation_id !== claim\.verifiedWebhookId/);
});
test("E4 private receipt RPC cannot be invoked from an anon or authenticated session",()=>{
  assert.match(sql,/create or replace function public\.qf_read_claimed_vendor_auth_otp_purpose/);
  assert.match(sql,/security definer set search_path=pg_catalog/);
  assert.match(sql,/r\.purpose='vendor_login'/);
  assert.match(sql,/r\.state='claimed'/);
  assert.match(sql,/r\.auth_user_id=p_auth_user_id/);
  assert.match(sql,/r\.phone_digest=p_phone_digest/);
  assert.match(sql,/revoke all on function public\.qf_read_claimed_vendor_auth_otp_purpose\(text,uuid\)\s+from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.qf_read_claimed_vendor_auth_otp_purpose\(text,uuid\) to service_role/);
});
test("E5 read path cannot independently establish vendor OTP possession or enroll a business",()=>{
  assert.doesNotMatch(executableReader,/evaluateVendorOtpAdmission\(|decideVerifiedVendorSignup\(|reconcileVerifiedVendorOwnership\(/);
  assert.doesNotMatch(executableReader,/registerVendor\(|vendor_dashboard_users|\.rpc\(|\bcredits\b|\bactivate_leads\b/);
});
