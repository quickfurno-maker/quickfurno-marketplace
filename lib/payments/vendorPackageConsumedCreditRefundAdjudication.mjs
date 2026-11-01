// RC40 Finance: PURE READ-ONLY consumed-credit refund adjudication handoff.
// Combines (1) a durable HMAC-verified refund identity row, (2) the matching
// order/vendor credit ledger snapshot, (3) provider mode and (4) a verified AAL2
// finance reviewer into bounded decision EVIDENCE for a human/policy owner.
// It performs no I/O, holds no clients, and can NEVER authorize a credit
// grant/revocation, a refund, or a provider call. No consumed-credit refund policy
// exists, so a fully verified case still ends in POLICY_APPROVAL_MISSING.
import {verifyDurableRefundIdentity} from "./vendorPackageRefundIdentityBinding.mjs";
import {reviewVendorPackageCreditLedger} from "./vendorPackageCreditLedgerReview.mjs";
import {authorizeRefundReviewer,FINANCE_REFUND_REVIEW_ROLES} from "./vendorPackageRefundReviewAuthority.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^[a-f0-9]{64}$/;
const ORDER=/^order_[A-Za-z0-9]{4,64}$/;
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const keysAre=(o,required,optional=[])=>{
 const k=Object.keys(o);
 return required.every(r=>k.includes(r))&&k.every(x=>required.includes(x)||optional.includes(x));
};
const NEVER=Object.freeze({refundAllowed:false,creditGrantAllowed:false,
 creditRevocationAllowed:false,providerCallAllowed:false,requiresHumanReview:true});
const result=(decision,reason,evidence=null)=>Object.freeze({ok:false,decision,reason,...NEVER,
 evidence:evidence&&Object.freeze(evidence)});
const deny=(reason,evidence)=>result("DENIED",reason,evidence);

/**
 * input: {identityRow, macKey, expected:{orderId,vendorId,providerOrderId,providerMode,bodySha256},
 *   requesterVendorId, ledger, reviewer, [approvedRoles], [now]}
 * `ok` is ALWAYS false: this module only produces evidence, never authority.
 */
export function adjudicateConsumedCreditRefundEvidence(input){
 if(!obj(input)||!keysAre(input,["identityRow","macKey","expected","requesterVendorId","ledger","reviewer"],
   ["approvedRoles","now"]))return deny("ADJUDICATION_INPUT_INVALID");
 const {identityRow,macKey,expected,requesterVendorId,ledger,reviewer}=input;
 const approvedRoles=input.approvedRoles??FINANCE_REFUND_REVIEW_ROLES;
 const now=input.now??Date.now();
 if(!obj(expected)||!keysAre(expected,["orderId","vendorId","providerOrderId","providerMode","bodySha256"])||
    !UUID.test(expected.orderId)||!UUID.test(expected.vendorId)||!ORDER.test(expected.providerOrderId)||
    !["test","live"].includes(expected.providerMode)||!SHA256.test(expected.bodySha256)||
    typeof requesterVendorId!=="string"||!UUID.test(requesterVendorId)||
    !obj(identityRow)||!obj(ledger)||!Number.isSafeInteger(now))
  return deny("ADJUDICATION_INPUT_INVALID");

 // 1. Immutable identity: any tampered bound field or MAC fails.
 if(!verifyDurableRefundIdentity(identityRow,macKey))return deny("REFUND_IDENTITY_MAC_INVALID");
 // 2. Digest / mode / order bindings against the independently supplied expectation.
 if(identityRow.body_sha256!==expected.bodySha256)return deny("REFUND_IDENTITY_DIGEST_MISMATCH");
 if(identityRow.provider_mode!==expected.providerMode)return deny("PROVIDER_MODE_MISMATCH");
 if(identityRow.provider_order_id!==expected.providerOrderId)return deny("PROVIDER_ORDER_MISMATCH");
 // 3. Tenant scope: requester, expected vendor and ledger must be one vendor/order.
 if(requesterVendorId!==expected.vendorId)return deny("VENDOR_SCOPE_MISMATCH");
 if(ledger.vendorId!==expected.vendorId)return deny("LEDGER_VENDOR_MISMATCH");
 if(ledger.orderId!==expected.orderId)return deny("LEDGER_ORDER_MISMATCH");
 // 4. Verified AAL2 reviewer (role set stays empty => fails closed until owner-approved).
 const auth=authorizeRefundReviewer(reviewer,approvedRoles,now);
 if(!auth.ok)return deny(auth.reason);
 // 5. Ledger reconciliation (duplicate lead charges, source/consumption mismatch).
 const review=reviewVendorPackageCreditLedger(ledger);
 const consumed=review.reason==="CREDIT_LEDGER_CONSUMED_REQUIRES_POLICY"||
  review.reason==="CREDIT_LEDGER_REVIEW_ONLY_UNCONSUMED";
 if(!consumed)return deny(review.reason);
 const consumedCredits=ledger.creditsGranted-ledger.creditsRemaining;
 return result("POLICY_APPROVAL_MISSING","POLICY_APPROVAL_MISSING",{
  reviewerId:auth.reviewerId,providerMode:identityRow.provider_mode,
  orderId:expected.orderId,vendorId:expected.vendorId,
  refundId:identityRow.refund_id,paymentId:identityRow.payment_id,
  providerOrderId:identityRow.provider_order_id,
  creditsGranted:ledger.creditsGranted,creditsRemaining:ledger.creditsRemaining,
  consumedCredits,verifiedDebitCount:ledger.ledgerDebits.length,
  ledgerReason:review.reason,identityVerified:true,policyApprovalPresent:false});
}
