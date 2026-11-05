import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=readFileSync("services/vendorSignupOtpVerificationService.ts","utf8");
const code=source.replace(/\/\*[\s\S]*?\*\//g," ").replace(/^\s*\/\/.*$/gm,"");
const position=(text)=>source.indexOf(text);

test("V1 vendor OTP verifier has no public route and is operationally OFF by default",()=>{
  assert.match(source,/import "server-only"/);
  assert.match(source,/QF_VENDOR_OTP_VERIFY_MODE !== "staging"/);
  assert.match(source,/resolveApprovedProvider: async \(\) => null/);
  assert.match(source,/!approvedProvider\.trim\(\)/);
  assert.doesNotMatch(source,/process\.env\.[A-Z_]+\s*!==\s*"production"/);
});

test("V2 code possession comes from request-scoped Supabase Auth, not browser claims",()=>{
  assert.match(source,/await serverClient\(\)/);
  assert.match(source,/await sb\.auth\.verifyOtp\(\{/);
  assert.match(source,/type: "sms"/);
  assert.match(source,/await sb\.auth\.getUser\(\)/);
  assert.match(source,/user\.id !== verified\.user\.id/);
  assert.match(source,/user\.phone !== phoneE164/);
  assert.ok(position("await sb.auth.verifyOtp") < position("await sb.auth.getUser()"));
  assert.doesNotMatch(code,/\.auth\.admin\.|\.signInWithPassword\(|user_metadata|app_metadata/);
});

test("V3 missing, mismatched or cross-lane proof kills the authenticated local session",()=>{
  assert.match(source,/authAttempted = true/);
  assert.match(source,/await invalidateLocalSession\(sb\)/);
  assert.match(source,/inspectVendorSignupOwnershipFromCurrentSession\(mobile10\)/);
  assert.match(source,/inspectVendorOtpEvidenceForCurrentSession\(phoneE164, approvedProvider\)/);
  assert.match(source,/ownership\.unsignedEvidence\.existingClientAccount !== false/);
  assert.match(source,/evaluateVendorOtpAdmission\(\{/);
  assert.match(source,/if \(!admission\.admitted\) return await deny\(\)/);
  assert.match(source,/if \(decision\.kind === "deny"\) return await deny\(\)/);
  assert.ok(position("if (!admission.admitted)") < position("serverOtpAdmission: \"admitted\""));
});

test("V4 no unverified token or trusted Auth identity is returned or persisted",()=>{
  assert.match(source,/VENDOR_SIGNUP_OTP_VERIFY_FAILED/);
  assert.doesNotMatch(source,/console\.(log|info|error|warn)|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.sendMessage\(|\.rpc\(/);
  assert.doesNotMatch(source,/token:\s*input\.token\s*,?\s*\/\//);
  assert.match(source,/return \{ ok: true, authUserId: user\.id, mobile10, decision \}/);
  assert.match(source,/DB-atomic controller must/);
});

test("V5 the OTP session is never sufficient to approve, charge or match vendors",()=>{
  for(const forbidden of ["accepting_leads: true","status: \"Approved\"","remaining_credits","paid_status: \"Paid\"","approveVendor(","activate_leads("])
    assert.equal(source.includes(forbidden),false,forbidden);
});
