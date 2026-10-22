import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";import path from "node:path";
import {validateFinanceCaseRequest,validateFinanceCaseDecision} from "../../../lib/payments/financeV2Pay4aCase.mjs";
const root=path.resolve(import.meta.dirname,"../../..");
const file=x=>readFileSync(path.join(root,x),"utf8");
const u=n=>"10000000-0000-4000-8000-"+String(n).padStart(12,"0");
const req=()=>({orderId:u(1),clientRequestId:u(2),caseKind:"REFUND_POLICY_REVIEW",
 requestedAmountSubunits:2300,evidenceSha256:"a".repeat(64)});
test("PAY4A strict case request is evidence-only, rejects surprise browser fields",()=>{
 assert.equal(validateFinanceCaseRequest(req()).financialExecutionAllowed,false);
 assert.throws(()=>validateFinanceCaseRequest({...req(),isPaid:true}),/INVALID/);
 assert.throws(()=>validateFinanceCaseRequest({...req(),requestedAmountSubunits:1.5}),/INVALID/);
 assert.throws(()=>validateFinanceCaseRequest({...req(),evidenceSha256:"bad"}),/INVALID/);
});
test("PAY4A independent case review not a financial approval",()=>{
 const x=validateFinanceCaseDecision({caseId:u(1),reviewReference:u(2),
  decision:"APPROVED_FOR_FURTHER_CHECKS",reasonCode:"FURTHER_CHECKS_REQUIRED"});
 assert.equal(x.financialExecutionAllowed,false);
 assert.throws(()=>validateFinanceCaseDecision({...x,financialExecutionAllowed:true}),/INVALID/);
});
test("PAY4A all case writes OFF without feature flags and AAL2",()=>{
 const staff=file("app/api/vox/v1/finance-case/route.ts");
 const review=file("app/api/vox/v1/finance-case-review/route.ts");
 const scope=file("services/financeV2Scope.ts");
 const scheduler=file("app/api/internal/finance-pay4a-canary/route.ts");
 assert.match(staff,/FINANCE_V2_PAY4A_CASE_WRITES_ENABLED!=="staging"/);
 assert.match(staff,/financeStaffAllowed\(fresh,vendor\)/);
 assert.match(review,/verifyVoxOwnerBearer\(bearer\)/);
 assert.match(scope,/VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"/);
 assert.match(scheduler,/FINANCE_V2_PAY4A_CRON_ENABLED!=="staging"/);
 assert.match(scheduler,/timingSafeEqual/);
 assert.doesNotMatch(staff+/\n/+review,/qf_activate_vendor_package_order_v2|qf_credit|razorpay\.com/);
});
