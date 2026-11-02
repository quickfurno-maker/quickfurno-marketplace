import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const actions=readFileSync(new URL("../../../app/actions.ts",import.meta.url),"utf8");
const service=readFileSync(new URL("../../../services/badLeadRecoveryService.ts",import.meta.url),"utf8");
const post=readFileSync(new URL("../../../services/vox/rc65PostCreditOwnerAuthority.ts",import.meta.url),"utf8");
test("public bad-lead credit decision rejects obsolete replacement before owner session and SQL",()=>{
 const part=actions.split("export const adminApplyBadLeadRecovery = async (")[1]
  ?.split("export const adminAddVendorLeadReportComment")[0]??"";
 for(const term of ['action!=="restore_credit"&&action!=="reject"',
  'return fail(appError("VALIDATION"))','serverClient()',
  'badLeadRecovery.applyBadLeadRecovery(reportId, action, actor)'])
  assert.ok(part.includes(term),term);
 assert.ok(part.indexOf('action!=="restore_credit"')<part.indexOf("serverClient()"));
 assert.ok(part.indexOf('return fail(appError("VALIDATION"))')<part.indexOf("applyBadLeadRecovery("));
});
test("credit recommendation public and service signatures only expose none or one-credit restoration",()=>{
 assert.match(service,/reportId:string,recommendation:"none"\|"restore_credit"/);
 assert.match(post,/type Action="restore_credit"\|"reject";/);
 assert.doesNotMatch(post,/type Action=.*replace/);
 assert.match(service,/if\(!isAllowedBadLeadRecoveryAction\(action\)\)return policyDenied\(\)/);
 assert.match(service,/RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/);
});