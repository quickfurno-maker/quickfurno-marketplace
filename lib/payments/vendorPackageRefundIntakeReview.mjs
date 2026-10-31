// RC35 Finance: bounded reviewer action over a quarantined refund intake event.
// Records ONE immutable reviewer decision through an injected review RPC. It
// never mutates credits, orders or wallets and never calls a provider; refund
// and credit revocation stay human/owner-policy actions outside this module.
import {isRefundIntakeEventType} from "./vendorPackageRefundIntake.mjs";
import {reconcileRefundAgainstCreditEvidence} from "./vendorPackageRefundReconciliationReview.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const REFUND_REVIEW_DECISIONS=Object.freeze(
 ["escalated_for_policy_decision","evidence_matched_for_human_authorization"]);
const REFUND=/^rfnd_[A-Za-z0-9]{4,64}$/;
const fail=(reason,retrySafe=false)=>Object.freeze({ok:false,reason,retrySafe,
 creditMutation:false,refundAllowed:false});

/**
 * options.refundBound (RC37): the receipt is bound to the provider refund id,
 * not only to the webhook event id. refund.created/processed/failed events of
 * ONE refund then share a single immutable review (qf_review_..._v3), so a
 * second event can never obtain a different decision. Requires envelope.refundId.
 */
export function createRefundIntakeReviewer(callRpc,options={}){
 const refundBound=options?.refundBound===true;
 if(typeof callRpc!=="function")throw TypeError("REFUND_REVIEW_RPC_REQUIRED");
 return Object.freeze({
  /**
   * input: {envelope, reviewerId, decision, vendorId?, creditLedger?, refundEvidence?}
   * "evidence_matched..." requires matching read-only credit/refund evidence
   * for the SAME payment and provider mode; its credit count is informational.
   */
  async review(input){
   if(!input||typeof input!=="object"||!input.envelope||input.envelope.ok!==true||
      !isRefundIntakeEventType(input.envelope.eventType)||
      typeof input.reviewerId!=="string"||!UUID.test(input.reviewerId)||
      !REFUND_REVIEW_DECISIONS.includes(input.decision))
    return fail("REFUND_REVIEW_INPUT_INVALID");
   const {envelope,reviewerId,decision}=input;
   if(refundBound&&(typeof envelope.refundId!=="string"||!REFUND.test(envelope.refundId)||
      typeof envelope.paymentId!=="string"))return fail("REFUND_REVIEW_REFUND_ID_REQUIRED");
   let credits=null;
   if(decision==="evidence_matched_for_human_authorization"){
    const e=input.refundEvidence;
    const match=reconcileRefundAgainstCreditEvidence({vendorId:input.vendorId,
     creditLedger:input.creditLedger,refundEvidence:e});
    if(!match.ok)return fail(match.reason);
    if(e.paymentId!==envelope.paymentId||e.providerMode!==envelope.providerMode)
     return fail("REFUND_REVIEW_EVIDENCE_PAYMENT_MISMATCH");
    credits=match.reviewableCredits;
   }else if(input.creditLedger!==undefined||input.refundEvidence!==undefined)
    return fail("REFUND_REVIEW_INPUT_INVALID");
   let response;
   // Identical retries are idempotent in PostgreSQL, so an unknown COMMIT is
   // reported as retry-safe and never as success.
   try{
    const base={p_event_id:envelope.eventId,p_provider_mode:envelope.providerMode,
     p_body_sha256:envelope.bodySha256,p_reviewer_id:reviewerId,
     p_decision:decision,p_reviewable_credits:credits};
    response=refundBound
     ?await callRpc("qf_review_vendor_package_refund_intake_v3",
       {...base,p_refund_id:envelope.refundId,p_payment_id:envelope.paymentId})
     :await callRpc("qf_review_vendor_package_refund_intake_v2",base);
   }catch{return fail("REFUND_REVIEW_UNCONFIRMED",true)}
   const r=response&&!response.error?response.data:null;
   if(!r||typeof r!=="object"||Array.isArray(r)||r.event_id!==envelope.eventId||
      r.provider_mode!==envelope.providerMode)
    return fail(response?.error?"REFUND_REVIEW_REJECTED":"REFUND_REVIEW_UNCONFIRMED",!response?.error);
   if(refundBound&&r.status!=="review_conflict"&&r.refund_id!==envelope.refundId)
    return fail("REFUND_REVIEW_RECEIPT_INVALID");
   if(r.status==="review_conflict")return fail("REFUND_REVIEW_CONFLICT");
   if(r.status!=="reviewed"||r.decision!==decision||
      (r.reviewable_credits??null)!==credits)return fail("REFUND_REVIEW_RECEIPT_INVALID");
   return Object.freeze({ok:true,reason:"REFUND_REVIEW_RECORDED",decision,
    reviewableCredits:credits,creditMutation:false,refundAllowed:false});
  }
 });
}
