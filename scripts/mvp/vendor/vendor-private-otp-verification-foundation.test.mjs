import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {
  AUTH_OTP_PURPOSE, AUTH_OTP_PHONE_RE,
  isAuthOtpPhone, isAuthOtpPurpose,
  isAuthOtpReservationDigest, parseClaimedAuthOtpPurpose,
} from "../../../lib/identity/authOtpPurposePolicy.ts";
const source=(name)=>readFileSync(join(process.cwd(),name),"utf8");
const service=source("services/authOtpPurposeReservationService.ts");
const migration=source("supabase/migrations/20261104140000_vendor_private_otp_and_verification_foundation.sql");

test("P1 vendor and client OTP purposes are distinct with no default/fallback",()=>{
  assert.notEqual(AUTH_OTP_PURPOSE.VENDOR_LOGIN,AUTH_OTP_PURPOSE.CLIENT_LOGIN);
  assert.equal(parseClaimedAuthOtpPurpose(AUTH_OTP_PURPOSE.VENDOR_LOGIN),"vendor_login");
  assert.equal(parseClaimedAuthOtpPurpose(AUTH_OTP_PURPOSE.CLIENT_LOGIN),"client_login");
  for(const x of [null,undefined,"",true,"vendor","client_login_otp","vendor_login_otp",{},[]]) {
    assert.equal(parseClaimedAuthOtpPurpose(x),null);
  }
});
test("P2 Indian E.164 input and HMAC phone digest contract are narrow",()=>{
  assert.ok(isAuthOtpPhone("+919876543210"));
  for(const phone of ["9876543210","919876543210","+19876543210","+910876543210","+9198765432100"])
    assert.equal(isAuthOtpPhone(phone),false,phone);
  assert.ok(AUTH_OTP_PHONE_RE instanceof RegExp);
  assert.ok(isAuthOtpPurpose("vendor_login"));
  assert.equal(isAuthOtpPurpose("vendor_password_reset"),false);
  assert.ok(isAuthOtpReservationDigest("a".repeat(64)));
  assert.equal(isAuthOtpReservationDigest("9876543210"),false);
  assert.match(service,/createHmac\("sha256", secret\)/);
  assert.match(service,/QF_AUTH_OTP_PURPOSE_HMAC_KEY_BASE64/);
  assert.match(service,/secret\.length < 32/);
  assert.doesNotMatch(service,/console\.(log|error|warn)/);
});
test("P3 reservation and claim use service-role RPCs and fail closed on missing schema",()=>{
  assert.match(service,/adminClient\(\)\.rpc/);
  for(const rpc of ["qf_reserve_auth_otp_purpose","qf_claim_auth_otp_purpose","qf_release_auth_otp_purpose"])
    assert.ok(service.includes(rpc),rpc);
  assert.match(service,/return null; \/\/ missing migration/);
  assert.match(service,/return error \? null : parseClaimedAuthOtpPurpose\(data\)/);
  assert.doesNotMatch(service,/\.signInWithOtp\(|\.verifyOtp\(|\.sendMessage\(/);
});
test("P4 pending migration grants no browser execution or private evidence access",()=>{
  assert.match(migration,/create schema if not exists qf_vendor_private/);
  assert.match(migration,/revoke all on schema qf_vendor_private from public, anon, authenticated/);
  assert.match(migration,/revoke all on all tables in schema qf_vendor_private from public,anon,authenticated/);
  assert.match(migration,/revoke all on function public\.qf_claim_auth_otp_purpose/);
  assert.match(migration,/grant execute on function public\.qf_claim_auth_otp_purpose[^;]* to service_role/s);
  assert.match(migration,/auth_otp_purpose_reservations/);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/verified_webhook_id/);
});
test("P5 verification requires consent, independent identity and office evidence and Owner decision",()=>{
  for(const type of ["verification_cases","verification_consents","verification_evidence","verification_decisions"])
    assert.match(migration,new RegExp("create table if not exists qf_vendor_private\\."+type));
  assert.match(migration,/consent\.revoked_at is null/);
  assert.match(migration,/identity_doc\.evidence_type='identity_attestation'/);
  assert.match(migration,/office_doc\.evidence_type='office_proof'/);
  assert.match(migration,/decision\.action='approve'/);
  assert.match(migration,/verification_decisions_immutable/);
  assert.match(migration,/check \(method in \('aadhaar_offline','passport','driving_licence','voter_id','other_approved'\)\)/);
});
test("P6 no migration grants external registration, sends, credits or approvals",()=>{
  assert.doesNotMatch(migration,/grant\s+(?:all|execute|select|insert)\s+on\s+(?:function|table)[^;]+\s+to\s+(?:anon|authenticated)\s*;/i);
  assert.doesNotMatch(migration,/insert\s+into\s+public\.vendors|update\s+public\.vendors|insert\s+into\s+public\.lead_assignments/i);
  assert.doesNotMatch(migration,/^\s*create\s+policy\s+/im);
});
