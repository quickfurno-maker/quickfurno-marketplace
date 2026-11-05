import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requiresVendorVerificationEvidence } from "../../../lib/vendors/vendorDocumentApprovalGate.ts";
const service=readFileSync("services/vendorAdminService.ts","utf8");
test("D1 approval, activation and lead acceptance require verified evidence",()=>{
  for(const action of ["approve","activate","activate_leads"])
    assert.equal(requiresVendorVerificationEvidence(action),true,action);
});
test("D2 suspension, deactivation, rejection and pausing remain available",()=>{
  for(const action of ["reject","suspend","deactivate","pause_leads",null,undefined,{}])
    assert.equal(requiresVendorVerificationEvidence(action),false,String(action));
});
test("D3 Core checks private service-role RPC before mutating vendor row",()=>{
  const fn=service.slice(service.indexOf("export async function setVendorStatusAction("),service.indexOf("// CREDITS (manual only"));
  const required=fn.indexOf("requiresVendorVerificationEvidence(action)");
  const rpc=fn.indexOf('"qf_vendor_verification_case_ready"');
  const mutation=fn.indexOf('db.from("vendors").update(update)');
  assert.ok(required>0 && rpc>required && mutation>rpc);
  assert.match(fn,/verificationError \|\| verified !== true/);
  assert.match(fn,/code: "VENDOR_VERIFICATION_REQUIRED"/);
  assert.match(fn,/if \(!actor\) return/);
});
test("D4 verification RPC never publishes, assigns, sends OTP or changes credits",()=>{
  const section=service.slice(service.indexOf('if (requiresVendorVerificationEvidence(action))'),service.indexOf('let update: Record<string, unknown>'));
  assert.doesNotMatch(section,/lead_assignments|remaining_credits|sendMessage|createUser|\.insert\(/);
});
