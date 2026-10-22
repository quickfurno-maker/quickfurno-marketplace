import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {evaluateVerifiedCapture,evaluateRefundProposal,reconcileSettlement,financeTimeline} from "../../../lib/payments/financeV2Pay3.mjs";
const secret="pay3-synthetic-offline";
const expected={provider:"razorpay",providerMode:"test",merchantAccountId:"sandbox",providerOrderId:"order_demo",
  orderId:"11111111-1111-4111-8111-111111111111",currency:"INR",expectedAmountSubunits:9999};
function webhook(patch={},mode="test"){
 const payment={id:"pay_synthetic",order_id:"order_demo",currency:"INR",status:"captured",amount:9999,...patch};
 const rawBody=JSON.stringify({event:"payment.captured",payload:{payment:{entity:payment}}});
 return {rawBody,signature:createHmac("sha256",secret).update(rawBody).digest("hex"),webhookSecret:secret,
  eventId:"evt_pay3_12345",providerMode:mode,merchantAccountId:"sandbox"};
}
test("PAY3B verified synthetic capture yields journal only, never credits",()=>{
 const r=evaluateVerifiedCapture({expected,webhook:webhook()});
 assert.equal(r.capturedSubunits,9999);assert.equal(r.creditActivationAllowed,false);
 assert.equal(r.decision,"JOURNAL_AND_VERIFY_WITH_PROVIDER");
 assert.equal(JSON.stringify(r).includes(secret),false);
});
test("PAY3B rejects wrong mode, amount, order, currency and status",()=>{
 assert.throws(()=>evaluateVerifiedCapture({expected,webhook:webhook({amount:10000})}),/CAPTURE_MISMATCH/);
 assert.throws(()=>evaluateVerifiedCapture({expected,webhook:webhook({order_id:"other"})}),/CAPTURE_MISMATCH/);
 assert.throws(()=>evaluateVerifiedCapture({expected,webhook:webhook({currency:"USD"})}),/CAPTURE_MISMATCH/);
 assert.throws(()=>evaluateVerifiedCapture({expected,webhook:webhook({status:"authorized"})}),/CAPTURE_MISMATCH/);
 assert.throws(()=>evaluateVerifiedCapture({expected,webhook:webhook({},"live")}),/MERCHANT_MODE_MISMATCH/);
});
const refund=()=>({providerMode:"test",merchantAccountId:"sandbox",orderId:"order_local",
 paymentId:"pay_1",requestedBy:"requester",approvedBy:"different-reviewer",approverAal2:true,
 approvalReference:"review-1",capturedSubunits:10000,requestedSubunits:2000,
 existingRefunds:[{state:"pending",amountSubunits:3000,providerMode:"test",
 merchantAccountId:"sandbox",paymentId:"pay_1"}]});
test("PAY3C reserves pending refunds in cumulative cap without provider writes",()=>{
 const p=evaluateRefundProposal(refund());
 assert.equal(p.remainingSubunits,5000);
 assert.equal(p.gatewayExecutionAllowed,false);assert.equal(p.creditReversalAllowed,false);
});
test("PAY3C fails closed for self-review, overrefund, cross mode and overflow",()=>{
 assert.throws(()=>evaluateRefundProposal({...refund(),approvedBy:"requester"}),/APPROVAL_REQUIRED/);
 assert.throws(()=>evaluateRefundProposal({...refund(),requestedSubunits:8000}),/EXCEEDS_CAPTURE/);
 assert.throws(()=>evaluateRefundProposal({...refund(),existingRefunds:[{...refund().existingRefunds[0],providerMode:"live"}]}),/CONTEXT_MISMATCH/);
 assert.throws(()=>evaluateRefundProposal({...refund(),capturedSubunits:Number.MAX_SAFE_INTEGER+1}),/AMOUNT_INVALID/);
});
const settlement=()=>({providerMode:"test",merchantAccountId:"sandbox",settlementId:"setl_123",
 grossSubunits:100000,refundSubunits:10000,feeSubunits:2000,taxOnFeeSubunits:360,
 adjustmentSubunits:-100,bankDepositSubunits:87540});
test("PAY3D settlement math is paise-only and never certifies actual deposit",()=>{
 const r=reconcileSettlement(settlement());
 assert.equal(r.calculatedNetSubunits,87540);assert.equal(r.state,"AMOUNT_MATCH_ONLY");
 assert.equal(r.bankStatementVerified,false);
 assert.equal(reconcileSettlement({...settlement(),bankDepositSubunits:87539}).discrepancySubunits,-1);
});
test("PAY3D rejects negatives, nonintegral money and underflow",()=>{
 assert.throws(()=>reconcileSettlement({...settlement(),feeSubunits:2.5}),/AMOUNT_INVALID/);
 assert.throws(()=>reconcileSettlement({...settlement(),refundSubunits:200000}),/NET_INVALID/);
});
test("PAY3A rejects cross-mode timeline and sorts immutable metadata",()=>{
 const events=[{kind:"refund",reference:"rf",occurredAt:"2026-10-22T10:00:00Z",amountSubunits:100,providerMode:"test"},
 {kind:"capture",reference:"cp",occurredAt:"2026-10-22T09:00:00Z",amountSubunits:500,providerMode:"test"}];
 const rows=financeTimeline({providerMode:"test",orderId:"local",events});
 assert.deepEqual(rows.map(r=>r.kind),["capture","refund"]);
 assert.equal(Object.isFrozen(rows[0]),true);
 assert.throws(()=>financeTimeline({providerMode:"test",orderId:"local",events:[{...events[0],providerMode:"live"}]}),/EVENT_INVALID/);
});
