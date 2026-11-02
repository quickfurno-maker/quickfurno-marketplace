import test from "node:test";
import assert from "node:assert/strict";
import {classifyVendorPackageRefundIntake} from "../../../lib/payments/vendorPackageRefundIntake.mjs";
import {buildRazorpayProviderEventEnvelope,inspectProviderEventClaim}
 from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {createRefundIntakeReviewer} from "../../../lib/payments/vendorPackageRefundIntakeReview.mjs";
const U="11111111-1111-4111-8111-111111111111";
const eventId="evt_RC36REFUND1234";
const paymentId="pay_RC36ABCDE";
const orderId="order_RC36ABCDE";
const refundId="rfnd_RC36ABCDE";
const hash="f".repeat(64);
const input={event:"refund.processed",payload:{refund:{entity:{id:refundId,payment_id:paymentId}},
 payment:{entity:{id:paymentId,order_id:orderId}}}};
const envelope=()=>buildRazorpayProviderEventEnvelope({
 eventId,providerMode:"test",bodySha256:hash,
 candidate:classifyVendorPackageRefundIntake(input)
});
test("signed refund identity has an exact immutable digest and no credit outcome",()=>{
 const v=classifyVendorPackageRefundIntake(input);
 assert.deepEqual({...v},{kind:"refund",eventName:"refund.processed",refundId,paymentId,providerOrderId:orderId});
 assert.equal(envelope().ok,true);
 assert.equal(buildRazorpayProviderEventEnvelope({
  eventId,providerMode:"test",bodySha256:hash,
  candidate:{kind:"refund",eventName:"refund.processed",paymentId,providerOrderId:orderId}}).ok,false);
 assert.equal(inspectProviderEventClaim({event_id:eventId,provider_mode:"test",
  status:"quarantined",last_error_code:"REFUND_REVIEW_REQUIRED"},envelope()).state,"quarantined");
 assert.equal(inspectProviderEventClaim({event_id:eventId,provider_mode:"test",
  status:"quarantined",last_error_code:"PAYMENT_REFUNDED"},envelope()).state,"invalid");
});
test("refund reviewer records one immutable escalation with no financial authority",async()=>{
 let count=0;
 const reviewer=createRefundIntakeReviewer(async(name,args)=>{
  count++;assert.equal(name,"qf_review_vendor_package_refund_intake_v2");
  assert.equal(args.p_body_sha256,hash);
  return {data:{event_id:eventId,provider_mode:"test",status:"reviewed",
   decision:"escalated_for_policy_decision",reviewable_credits:null}};
 });
 const item={envelope:{...envelope(),paymentId},reviewerId:U,
  decision:"escalated_for_policy_decision"};
 const result=await reviewer.review(item);
 assert.equal(result.ok,true);assert.equal(result.creditMutation,false);assert.equal(result.refundAllowed,false);
 assert.equal(count,1);
 assert.equal((await reviewer.review({...item,creditLedger:{}})).ok,false);
 assert.equal(count,1);
});
test("refund reviewer rejects forged, conflicting, and unknown-commit receipts",async()=>{
 const item={envelope:envelope(),reviewerId:U,decision:"escalated_for_policy_decision"};
 for(const response of [{error:{message:"denied"}},{data:{event_id:eventId,provider_mode:"test",status:"review_conflict"}},
  {data:{event_id:eventId,provider_mode:"test",status:"reviewed",decision:"escalated_for_policy_decision",reviewable_credits:5}}]){
  const r=await createRefundIntakeReviewer(async()=>response).review(item);
  assert.equal(r.ok,false);assert.equal(r.refundAllowed,false);
 }
 const unknown=await createRefundIntakeReviewer(async()=>{throw Error("COMMIT_UNCERTAIN")}).review(item);
 assert.equal(unknown.ok,false);assert.equal(unknown.retrySafe,true);
});
