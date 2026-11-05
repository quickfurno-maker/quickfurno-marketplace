import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync("app/api/vox/v1/owner-vendor-signup-status/route.ts","utf8");
const code=source.replace(/\/\*[\s\S]*?\*\//g," ").replace(/^\s*\/\/.*$/gm,"");

test("O1 Owner AAL2 and explicit staging flag fail closed",()=>{
  assert.match(code,/VOX_OWNER_VENDOR_SIGNUP_STATUS_READ_ENABLED !== "staging"/);
  assert.match(code,/await verifyVoxOwnerBearer\(request\.headers\.get\("authorization"\)\)/);
  assert.match(code,/OWNER_AAL2_REQUIRED/);
  assert.match(code,/currentOwner!==owner/);
  assert.match(code,/OWNER_SESSION_REVOKED/);
  assert.match(code,/cache-control":"private, no-store, max-age=0/);
});
test("O2 at most one query ID and bounded Core lookup, no enumeration",()=>{
  assert.match(code,/searchParams\.getAll\("vendorId"\)/);
  assert.match(code,/url\.searchParams\.size !== 1/);
  assert.match(code,/\.eq\("id",ids\[0\]\)\.maybeSingle\(\)/);
  assert.match(code,/\.eq\("vendor_id",ids\[0\]\)\.limit\(2\)/);
  assert.match(code,/\.eq\("id",authUserId\)\.limit\(2\)/);
  assert.match(code,/members\.data\.length>1/);
  assert.match(code,/profiles\.data\.length>1/);
});
test("O3 only readiness RPC and server-known principal establish repair status",()=>{
  assert.match(code,/qf_vendor_verification_case_ready/);
  assert.match(code,/member\.user_id===authUserId/);
  assert.match(code,/profile\.role==="vendor"/);
  assert.match(code,/ownerRepairRequired/);
  assert.match(code,/readyForCoreApproval/);
  assert.doesNotMatch(code,/qf_register_pending_vendor_atomic|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
});
test("O4 no private evidence identifiers or raw contact fields are queried",()=>{
  assert.doesNotMatch(code,/\b(aadhaar|pan_number|password|otp|private_storage_key|processor_reference|document_url|phone_e164|whatsapp_number)\b/i);
  assert.doesNotMatch(code,/\.storage\.|\.download\(|getPublicUrl\(/);
  assert.match(code,/canApprove:false,canActivate:false,canMutate:false,canViewPrivateEvidence:false/);
});
test("O5 every write method is denied, no staff lane",()=>{
  for(const verb of ["POST","PUT","PATCH","DELETE"]){
    assert.ok(code.includes(`export function ${verb}(): Response`),verb);
  }
  assert.doesNotMatch(code,/verifyVoxStaff|verifyVoxTeamLeader|\bStaffRole\b/);
});
