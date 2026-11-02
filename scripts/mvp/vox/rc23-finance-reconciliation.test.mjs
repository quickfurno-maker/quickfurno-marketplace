import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {reconcileRefundAgainstCreditEvidence as review} from "../../../lib/payments/vendorPackageRefundReconciliationReview.mjs";
const orderId="00000000-0000-4000-8000-000000000011";
const vendorId="00000000-0000-4000-8000-000000000012";
const evidence={localOrderId:orderId,paymentId:"pay_TEST987654",
 providerMode:"test",paymentCaptured:true,providerReconciled:true,
 ledgerReconciled:true,vendorAssignmentReconciled:true,paymentRefunded:false,
 refundPending:false,activationStatus:"activated",creditsGranted:4,
 creditsConsumed:0,creditsRemaining:4};
const ledger={orderId,vendorId,creditsGranted:4,creditsRemaining:4,ledgerDebits:[]};
const input={vendorId,creditLedger:ledger,refundEvidence:evidence};
test("exact same-order accounting permits only human review, never provider or ledger mutation",()=>{
 const r=review(input);
 assert.equal(r.ok,true);
 assert.equal(r.reviewableCredits,4);
 assert.equal(r.refundAllowed,false);
 assert.equal(r.creditRevocationAllowed,false);
 assert.equal(r.requiresHumanReview,true);
 assert.equal(r.providerSettlementIndependentlyCertified,false);
});
test("cross-vendor, cross-order, mismatched totals, consumed credits and duplicate debits deny",()=>{
 const cases=[
 {...input,vendorId:"00000000-0000-4000-8000-000000000090"},
 {...input,refundEvidence:{...evidence,localOrderId:"00000000-0000-4000-8000-000000000091"}},
 {...input,refundEvidence:{...evidence,creditsGranted:5}},
 {...input,refundEvidence:{...evidence,creditsConsumed:1}},
 {...input,refundEvidence:{...evidence,paymentRefunded:true}},
 {...input,refundEvidence:{...evidence,providerReconciled:false}},
 {...input,creditLedger:{...ledger,creditsRemaining:3}},
 {...input,creditLedger:{...ledger,creditsRemaining:2,ledgerDebits:[
  {orderId,vendorId,leadId:"00000000-0000-4000-8000-000000000031",credits:1},
  {orderId,vendorId,leadId:"00000000-0000-4000-8000-000000000031",credits:1}]}},
 {...input,extra:true},null,[],{}
 ];
 for(const c of cases){
  const r=review(c);
  assert.equal(r.ok,false,JSON.stringify(c)?.slice(0,70));
  assert.equal(r.refundAllowed,false);
  assert.equal(r.creditRevocationAllowed,false);
 }
});
test("finance review code has no external or DB write authority",()=>{
 const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
 const s=readFileSync(resolve(root,"lib/payments/vendorPackageRefundReconciliationReview.mjs"),"utf8");
 assert.doesNotMatch(s,/\bfetch\s*\(|\.rpc\(|\.insert\(|\.update\(|executeRefund\(|createRefund\(/);
 assert.match(s,/providerSettlementIndependentlyCertified:false/);
});
