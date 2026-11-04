import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hasVendorRegistrationConsent,
  isValidOptionalGstin,
  normalizeOptionalGstin,
  VENDOR_REGISTRATION_PRIVACY_REVISION,
} from "../../../lib/vendors/vendorSignupPolicy.ts";

const read=(path)=>readFileSync(join(process.cwd(),path),"utf8");
const form=read("components/VendorRegisterForm.tsx");
const action=read("app/actions.ts");
const service=read("services/vendorService.ts");
const types=read("lib/types.ts");
const migration=read("supabase/migrations/20261104090000_vendor_registration_consent_receipt.sql");

test("S1 optional GSTIN: blank accepted, normalized valid value accepted, invalid refused",()=>{
  for(const blank of ["",null,undefined,"  "])assert.equal(isValidOptionalGstin(blank),true);
  for(const valid of ["27ABCDE1234F1Z5"," 27abcde1234f1z5 ","29AAAAA0000A1Z5"])
    assert.equal(isValidOptionalGstin(valid),true,valid);
  for(const invalid of ["27ABCDE1234F1Z","27ABCDE1234F1Z51","123456789012345","27ABCDE1234F1Y5","27ABCDE1234F1Z0junk"])
    assert.equal(isValidOptionalGstin(invalid),false,invalid);
  assert.equal(normalizeOptionalGstin(" 27abcde1234f1z5 "),"27ABCDE1234F1Z5");
});

test("S2 only genuine explicit boolean consent permits signup",()=>{
  assert.equal(hasVendorRegistrationConsent(true),true);
  for(const nope of [false,null,undefined,"true",1,{},[]])assert.equal(hasVendorRegistrationConsent(nope),false);
});

test("S3 active signup wizard shows optional GST and separate privacy consent",()=>{
  assert.match(form,/GSTIN \(optional\)/);
  assert.match(form,/registrationConsent: false/);
  assert.match(form,/if \(!f\.registrationConsent\)/);
  assert.match(form,/registration_consent_accepted: f\.registrationConsent/);
  assert.match(form,/href="\/privacy"/);
  assert.match(form,/identity verification is required before approval|Identity verification is required before approval/);
  assert.match(form,/Aadhaar verification is voluntary/);
});

test("S4 client and server both reject missing notice or invalid GST",()=>{
  assert.match(form,/isValidOptionalGstin\(f\.gstNumber\)/);
  assert.match(action,/if \(!hasVendorRegistrationConsent\(input\.registration_consent_accepted\)\)/);
  assert.match(action,/if \(!isValidOptionalGstin\(input\.gst_number\)\)/);
  assert.ok(action.indexOf("if (!hasVendorRegistrationConsent(input.registration_consent_accepted))")<
    action.indexOf("db.auth.admin.createUser("),"no Auth account should be created before consent validation");
  assert.match(service,/if \(!hasVendorRegistrationConsent\(input\.registration_consent_accepted\)\)/);
  assert.match(service,/if \(!isValidOptionalGstin\(input\.gst_number\)\)/);
  assert.match(types,/registration_consent_accepted\?: boolean/);
});

test("S5 inserted application has single-row consent receipt, inactive Pending, no billing",()=>{
  assert.match(service,/registration_consent_version: VENDOR_REGISTRATION_PRIVACY_REVISION/);
  assert.match(service,/registration_consent_accepted_at: new Date\(\)\.toISOString\(\)/);
  assert.match(service,/gst_number: normalizeOptionalGstin\(input\.gst_number\) \|\| null/);
  assert.match(service,/status: "Pending"/);
  assert.match(service,/verification_status: "Pending"/);
  assert.match(service,/paid_status: "Unpaid"/);
  assert.match(service,/is_active: false/);
  assert.match(service,/accepting_leads: false/);
  assert.match(service,/public_visibility: false/);
  assert.equal(typeof VENDOR_REGISTRATION_PRIVACY_REVISION,"string");
});

test("S6 migration is additive, requires RLS and never invents legacy consent",()=>{
  assert.match(migration,/add column if not exists registration_consent_version text/);
  assert.match(migration,/add column if not exists registration_consent_accepted_at timestamptz/);
  assert.match(migration,/QF_VENDOR_CONSENT_RLS_REQUIRED/);
  const executable=migration.split("\n").filter(line=>!line.trimStart().startsWith("--")).join("\n");
  assert.doesNotMatch(executable,/^\s*(?:update\s|delete\s+from|truncate\s|insert\s+into|drop\s+table|grant\s)/im);
});

test("S7 no PAN or raw Aadhaar number/document upload in public registration",()=>{
  const publicPaths=[form,read("components/VendorApplicationForm.tsx"),service,types];
  for(const src of publicPaths){
    assert.doesNotMatch(src,/\bPAN(?:\s+card|\s+number|\s+upload|\s+verification)\b|pan_number|pan_upload|pan_card/i);
    assert.doesNotMatch(src,/aadhaar[_-]?(?:number|image|photo|file|upload)\s*:/i);
  }
});

test("S8 only one mounted active vendor signup wizard; no duplicate workflow",()=>{
  const portal=read("app/vendor/page.tsx");
  const redirect=read("app/vendors/register/page.tsx");
  assert.match(portal,/VendorPortal/);
  assert.match(redirect,/redirect\("\/vendor\?mode=signup"\)/);
  // The unmounted legacy component remains compatible with the strengthened
  // canonical public submission action if another route ever imports it.
  const legacy=read("components/VendorApplicationForm.tsx");
  assert.match(legacy,/registration_consent_accepted: form\.registrationConsent/);
  assert.match(legacy,/gst_number: normalizeOptionalGstin\(form\.gstNumber\)/);
});
