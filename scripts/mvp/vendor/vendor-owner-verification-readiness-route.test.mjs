import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/vox/v1/owner-vendor-verification-readiness/route.ts", "utf8");

test("VOX-OWNER-V1 source view is explicitly staging-only and disabled by default", () => {
  assert.match(route, /process\.env\.VOX_OWNER_VENDOR_VERIFICATION_READ_ENABLED !== "staging"/);
  assert.match(route, /OWNER_VENDOR_REVIEW_DISABLED/);
  assert.match(route, /"cache-control": "private, no-store, max-age=0"/);
  assert.match(route, /"vary": "Authorization"/);
});
test("VOX-OWNER-V2 authenticates signed Owner AAL2 twice, never trusting a browser role", () => {
  assert.match(route, /verifyVoxOwnerBearer/);
  assert.match(route, /if \(!owner\) return respond\(/);
  assert.match(route, /freshOwner !== owner/);
  assert.equal((route.match(/await verifyVoxOwnerBearer\(/g) || []).length, 2);
});
test("VOX-OWNER-V3 strictly accepts one UUID and reads private Core readiness", () => {
  assert.match(route, /url\.searchParams\.size !== 1/);
  assert.match(route, /ids\.length !== 1/);
  assert.match(route, /UUID\.test\(ids\[0\]\)/);
  assert.match(route, /"qf_vendor_verification_case_ready"/);
  assert.match(route, /typeof ready !== "boolean"/);
  assert.match(route, /VERIFICATION_READ_UNAVAILABLE/);
});
test("VOX-OWNER-V4 no document disclosure, mutation, or activation surface", () => {
  assert.match(route, /canApprove: false, canReviewDocuments: false/);
  assert.match(route, /mode: "READ_ONLY"/);
  assert.doesNotMatch(route, /\.insert\(|\.update\(|\.delete\(|\.storage\.|\.signInWithOtp\(|\.verifyOtp\(/);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.ok(route.includes("export function " + method + "()"), method + " must be explicitly rejected");
  }
});
