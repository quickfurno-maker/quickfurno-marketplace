import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {assessVendorPackageRefundEvidence} from "../../../lib/payments/vendorPackageRefundEvidence.mjs";

const UUID="00000000-0000-4000-8000-000000000001";
const complete={localOrderId:UUID,paymentId:"pay_12345678",providerMode:"test",
 paymentCaptured:true,providerReconciled:true,ledgerReconciled:true,
 vendorAssignmentReconciled:true,paymentRefunded:false,refundPending:false,
 activationStatus:"activated",creditsGranted:10,creditsConsumed:0,creditsRemaining:10};
test("unconsumed, independently reconciled credits allow human REVIEW but never a refund",()=>{
 const result=assessVendorPackageRefundEvidence(complete);
 assert.equal(result.ok,true);
 assert.equal(result.reason,"READY_FOR_INDEPENDENT_REFUND_REVIEW");
 assert.equal(result.reversibleCredits,10);
 assert.equal(result.refundAllowed,false);
 assert.equal(result.requiresHumanReview,true);
});
test("partial or total usage never permits automatic refund",()=>{
 for(const consumed of [1,3,10]){
  const x=assessVendorPackageRefundEvidence({...complete,creditsConsumed:consumed,creditsRemaining:10-consumed});
  assert.equal(x.ok,false);
  assert.equal(x.reason,"REFUND_CONSUMED_CREDITS_REQUIRE_POLICY_DECISION");
  assert.equal(x.refundAllowed,false);
 }
});
test("unverified provider, inflight refund, ledger inconsistency, wrong mode and absent keys deny",()=>{
 const variants=[
  {...complete,paymentCaptured:false},{...complete,providerReconciled:false},
  {...complete,ledgerReconciled:false},{...complete,vendorAssignmentReconciled:false},
  {...complete,paymentRefunded:true},{...complete,refundPending:true},
  {...complete,creditsRemaining:9},{...complete,creditsGranted:"10"},
  {...complete,providerMode:"unknown"},{...complete,paymentId:""},
  {...complete,localOrderId:"not-uuid"},{...complete,creditsConsumed:-1},
  {...complete,activationStatus:"not_activated"},null,{},[],
 ];
 for(const item of variants)assert.equal(assessVendorPackageRefundEvidence(item).refundAllowed,false);
 for(const item of variants)assert.equal(assessVendorPackageRefundEvidence(item).ok,false);
});
test("refund policy module has no provider, ledger write or payout route",()=>{
 const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
 const source=readFileSync(resolve(root,"lib/payments/vendorPackageRefundEvidence.mjs"),"utf8");
 assert.doesNotMatch(source,/await |fetch\(|\.rpc\(|\.insert\(|\.update\(|createRefund\(/);
 assert.match(source,/requiresHumanReview:true/);
 assert.match(source,/refundAllowed:false/);
});
