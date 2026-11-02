import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const service=readFileSync(new URL("../../../services/badLeadRecoveryService.ts",import.meta.url),"utf8");
const admin=readFileSync(new URL("../../../app/actions.ts",import.meta.url),"utf8");
const policy=readFileSync(new URL("../../../lib/vox/creditOnlyBadLeadPolicy.mjs",import.meta.url),"utf8");
test("bad-lead compensation public TypeScript surface has no replacement action",()=>{
 assert.match(service,/export type BadLeadRecoveryAction="restore_credit"\|"reject";/);
 assert.match(service,/replacementStatus:"not_requested";/);
 assert.doesNotMatch(service,/export type BadLeadRecoveryAction=.*replace/);
 assert.match(service,/if\(!isAllowedBadLeadRecoveryAction\(action\)\)return policyDenied\(\)/);
 assert.match(policy,/action==="restore_credit"\|\|action==="reject"/);
 const boundary=admin.split("export const adminApplyBadLeadRecovery = async")[1]
  ?.split("export const adminAddVendorLeadReportComment")[0]??"";
 assert.match(boundary,/if\(action!=="restore_credit"&&action!=="reject"\)/);
});
test("money and replacement effects cannot be accepted as canonical restoration",()=>{
 assert.match(service,/r\.cash_refunded_minor_units!==0/);
 assert.match(service,/r\.lead_credits_restored!==\(r\.status==="applied"\?1:0\)/);
 assert.match(service,/r\.replacement_assignment_id!=null/);
 assert.match(service,/r\.monetary_refund_id!=null/);
 assert.match(service,/RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/);
});