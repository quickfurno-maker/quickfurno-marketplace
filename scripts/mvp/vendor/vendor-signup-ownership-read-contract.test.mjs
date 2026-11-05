import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("services/vendorSignupOwnershipReadService.ts", "utf8");

test("O13 ownership inspection must prove signed current-session Auth subject", () => {
  assert.match(service, /import "server-only"/);
  assert.match(service, /await serverClient\(\)/);
  assert.match(service, /await sb\.auth\.getUser\(\)/);
  assert.match(service, /user\.phone !== "\+91" \+ mobile10/);
  assert.doesNotMatch(service, /getSession\(|decodeJwt\(|jwtDecode|user_metadata\./);
});
test("O14 all ownership authorities queried server-side and ambiguity rejected", () => {
  for (const table of ["profiles","client_accounts","vendors","vendor_dashboard_users"])
    assert.ok(service.includes('db.from("' + table + '")'),table);
  assert.match(service, /\.eq\("phone",mobile10\)\.limit\(2\)/);
  assert.match(service, /\.eq\("user_id",user\.id\)\.limit\(2\)/);
  assert.match(service, /client\.data\.length > 1 \|\| byUser\.data\.length > 1/);
  assert.match(service, /!Array\.isArray\(client\.data\)/);
});
test("O15 signed phone confirmation is not treated as vendor OTP admission", () => {
  assert.match(service, /Omit<VerifiedVendorSignupEvidence, "serverOtpAdmission">/);
  assert.doesNotMatch(service, /serverOtpAdmission: "admitted"/);
  assert.match(service, /phoneConfirmedAt: user\.phone_confirmed_at \?\? null/);
});
test("O16 inspection never writes Auth, profiles, vendors or memberships", () => {
  for(const forbidden of [/\.insert\(/,/\.update\(/,/\.upsert\(/,/\.delete\(/,/\.signInWithOtp\(/,/\.verifyOtp\(/,/\.createUser\(/,/\.sendMessage\(/,/\.rpc\(/])
    assert.doesNotMatch(service,forbidden);
});
