import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorizeReturningVendorSession, maySendReturningVendorOtp } from "../../../lib/vendors/vendorReturningLoginPolicy.ts";

const auth = "11111111-1111-4111-8111-111111111111";
const vendor = "22222222-2222-4222-8222-222222222222";
const member = "88888888-8888-4888-8888-888888888888";
const other = "44444444-4444-4444-8444-444444444444";
const phone = "+919876543210";
const decision = {kind:"resume_existing",vendorId:vendor};
const access = {ok:true,context:{
  authUserId:auth,vendorId:vendor,vendorDashboardUserId:member,
  role:"owner",membershipStatus:"active",
}};
const allow = (options={})=>authorizeReturningVendorSession({
  verifiedAuthUserId:auth,verifiedPhoneE164:phone,
  otpDecision:decision,vendorAccess:access,...options,
});
const src = p=>readFileSync(p,"utf8");
const request = src("app/api/vendor/auth/login/request-otp/route.ts");
const verify = src("app/api/vendor/auth/login/verify-otp/route.ts");
const service = src("services/returningWhatsappVendorLoginService.ts");
const ui = src("components/vendor/VendorWhatsappLoginForm.tsx");

test("L01 trusted existing owner gets only canonical vendor access",()=>{
  assert.deepEqual(allow(),{ok:true,vendorId:vendor,authUserId:auth});
});
test("L02 signup create_pending cannot be a login",()=>{
  assert.deepEqual(allow({otpDecision:{kind:"create_pending",authUserId:auth,mobile10:"9876543210"}}),{ok:false});
});
test("L03 unverified, repair or duplicate ownership never enters vendor dashboard",()=>{
  for (const otpDecision of [
    {kind:"deny",reason:"unverified"},
    {kind:"owner_repair_required",vendorId:vendor,reason:"inactive_membership"},
  ]) assert.deepEqual(allow({otpDecision}),{ok:false});
});
test("L04 forged vendor ID in decision never adopts another business",()=>{
  assert.deepEqual(allow({otpDecision:{kind:"resume_existing",vendorId:other}}),{ok:false});
});
test("L05 forged role/profile principal cannot be used as vendor identity",()=>{
  assert.deepEqual(allow({vendorAccess:{...access,context:{...access.context,authUserId:other}}}),{ok:false});
});
test("L06 missing/denied vendor mapping fails closed",()=>{
  assert.deepEqual(allow({vendorAccess:{ok:false,reason:"no_vendor_mapping"}}),{ok:false});
});
test("L07 inactive, suspended, invited or revoked owner memberships cannot log in",()=>{
  for(const membershipStatus of ["suspended","revoked","invited","unknown","ACTIVE",""]){
    assert.deepEqual(allow({vendorAccess:{ok:true,context:{...access.context,membershipStatus}}}),{ok:false},membershipStatus);
  }
});
test("L08 non-owner vendor access cannot be used as fresh signup-owner login",()=>{
  for(const role of ["staff","team_leader","admin","",null]){
    assert.deepEqual(allow({vendorAccess:{ok:true,context:{...access.context,role}}}),{ok:false},String(role));
  }
});
test("L09 bogus signed principal/phone/membership ID fails closed",()=>{
  assert.deepEqual(allow({verifiedAuthUserId:"not-signed"}),{ok:false});
  assert.deepEqual(allow({verifiedPhoneE164:"+91911111111x"}),{ok:false});
  assert.deepEqual(allow({vendorAccess:{ok:true,context:{...access.context,vendorDashboardUserId:"fake"}}}),{ok:false});
});
test("L10 returning request is non-enumerating, cannot auto-create or SMS fallback",()=>{
  assert.match(request,/shouldCreateUser:\s*false/);
  assert.match(request,/coordinateVendorOtpRequest/);
  assert.match(request,/reserveAuthOtpPurpose/);
  assert.match(request,/deliveryConfirmed:false/);
  assert.match(request,/OTP_REQUEST_ACCEPTED/);
  assert.match(request,/ORIGIN_REQUIRED/);
  assert.doesNotMatch(request,/channel:\s*["']sms/);
  assert.doesNotMatch(request,/adminClient\(\).*auth/);
});
test("L11 verify does not trust request user/vendor/role and rate limits attempts",()=>{
  assert.match(verify,/Object\.keys\(body\)\.sort\(\)\.join\(","\)!=="mobile,token"/);
  assert.match(verify,/allowPublicMutation/);
  assert.match(verify,/VENDOR_WHATSAPP_LOGIN_FAILED/);
  assert.match(verify,/redirectTo:"\/vendor\/dashboard"/);
  assert.doesNotMatch(verify,/body\.vendorId|body\.user_id|body\.role/);
});
test("L12 Supabase authenticates, read-only mapping rechecked and local denial invalidates",()=>{
  assert.match(service,/verifyVendorSignupWhatsappOtp/);
  assert.match(service,/resolveVendorAccess\(verified\.authUserId\)/);
  assert.match(service,/authorizeReturningVendorSession/);
  assert.match(service,/sb\.auth\.getUser/);
  assert.match(service,/invalidateLocalSession\(sb\)/);
  assert.match(service,/QF_RUNTIME_ENV === "staging"/);
  assert.match(service,/QF_VENDOR_RETURNING_LOGIN_MODE === "staging"/);
  assert.doesNotMatch(service,/grantCredits|activateVendor|createVendor|admin\.auth\./);
});
test("L13 UI cannot claim delivery, resists non-digit OTP and hides legacy credentials",()=>{
  assert.match(ui,/deliveryConfirmed !== false/);
  assert.match(ui,/replace\(\/\[\^0-9\]\/g/);
  assert.match(ui,/VENDOR_LOGIN_VERIFIED/);
  assert.match(ui,/If this number is eligible/);
  assert.match(ui,/Pending applications/);
  assert.doesNotMatch(ui,/signInWithOtp\(|verifyOtp\(|service_role|sessionStorage/);
});
test("L14 existing legacy password login still available but not used for WhatsApp signup",()=>{
  const portal=src("components/vendor/VendorPortal.tsx");
  assert.match(portal,/VendorWhatsappLoginForm/);
  assert.match(portal,/legacyPasswordLogin/);
  assert.match(portal,/LoginForm/);
  assert.match(portal,/New Vendor Signup/);
});

const preflight = {
  mobile10:"9876543210",
  vendors:[{id:vendor,user_id:auth,phone:"9876543210"}],
  memberships:[{id:member,user_id:auth,vendor_id:vendor,role:"owner",status:"active"}],
  profile:{role:"vendor"},
  clientAccounts:[],
};

test("L15 eligible existing vendor owner may request returning OTP without business activation",()=>{
  assert.equal(maySendReturningVendorOtp(preflight),true);
});

test("L16 unknown/unlinked phones cannot trigger provider OTP",()=>{
  assert.equal(maySendReturningVendorOtp({...preflight,vendors:[]}),false);
  assert.equal(maySendReturningVendorOtp({...preflight,vendors:[{...preflight.vendors[0],phone:"9999999999"}]}),false);
  assert.equal(maySendReturningVendorOtp({...preflight,clientAccounts:[{id:other}]}),false);
});

test("L17 suspended, foreign or nonowner membership denied before WhatsApp send",()=>{
  for(const override of [
    {status:"suspended"},{status:"invited"},{status:"revoked"},
    {role:"staff"},{vendor_id:other},{user_id:other},
  ]){
    assert.equal(maySendReturningVendorOtp({
      ...preflight,memberships:[{...preflight.memberships[0],...override}],
    }),false,JSON.stringify(override));
  }
});

test("L18 failed, missing or duplicate service role reads fail closed",()=>{
  for(const fixture of [
    {vendors:null},{memberships:null},{clientAccounts:null},
    {profile:null},{vendors:[...preflight.vendors,...preflight.vendors]},
    {memberships:[...preflight.memberships,...preflight.memberships]},
    {profile:{role:"client"}},
  ])assert.equal(maySendReturningVendorOtp({...preflight,...fixture}),false);
});

test("L19 request preflight happens before Auth send but preserves public non-enumeration",()=>{
  assert.match(request,/eligibleReturningVendorPhone/);
  assert.match(request,/reserveVendorPurpose:[^]*?eligibleReturningVendorPhone/);
  assert.match(request,/shouldCreateUser:\s*false/);
  assert.match(request,/deliveryConfirmed:false/);
  assert.doesNotMatch(request,/VENDOR_NOT_FOUND|PHONE_HAS_VENDOR/);
});
