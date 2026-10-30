// RC19 Finance V2: conservative refund review, never refund execution.
// Facts must be independently reconciled; no inferred counts or provider truth.
// This module has no network/DB side effects, no API route, no money authority.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INT=n=>Number.isSafeInteger(n)&&n>=0;
const deny=(reason)=>Object.freeze({ok:false,reason,refundAllowed:false,
 reversibleCredits:0,requiresHumanReview:true});
export function assessVendorPackageRefundEvidence(e){
 if(!e||typeof e!=="object"||Array.isArray(e)||
    Object.keys(e).sort().join("|")!==[
      "activationStatus","creditsConsumed","creditsGranted","creditsRemaining",
      "ledgerReconciled","localOrderId","paymentCaptured","paymentId",
      "paymentRefunded","providerMode","providerReconciled","refundPending",
      "vendorAssignmentReconciled"
    ].sort().join("|"))return deny("REFUND_EVIDENCE_INCOMPLETE");
 if(!UUID.test(e.localOrderId)||typeof e.paymentId!=="string"||
    !/^pay_[A-Za-z0-9]{4,64}$/.test(e.paymentId)||
    !["test","live"].includes(e.providerMode))
   return deny("REFUND_PAYMENT_IDENTITY_INVALID");
 if(e.paymentCaptured!==true||e.providerReconciled!==true||
    e.ledgerReconciled!==true||e.vendorAssignmentReconciled!==true)
   return deny("REFUND_EVIDENCE_UNRECONCILED");
 if(e.paymentRefunded===true)return deny("REFUND_ALREADY_RECORDED");
 if(e.refundPending===true)return deny("REFUND_ATTEMPT_IN_FLIGHT");
 if(e.paymentRefunded!==false||e.refundPending!==false||
    e.activationStatus!=="activated")return deny("REFUND_LIFECYCLE_UNVERIFIED");
 if(!INT(e.creditsGranted)||e.creditsGranted===0||
    !INT(e.creditsConsumed)||!INT(e.creditsRemaining)||
    e.creditsConsumed+e.creditsRemaining!==e.creditsGranted)
   return deny("REFUND_CREDIT_LEDGER_INCONSISTENT");
 if(e.creditsConsumed>0)
   return deny("REFUND_CONSUMED_CREDITS_REQUIRE_POLICY_DECISION");
 // This is only a risk-free eligibility REVIEW: actual refund must be signed
 // by an independent human, use provider's exact captured payment/mode, and
 // atomically revoke unconsumed credits with the right accounting ledger.
 return Object.freeze({ok:true,reason:"READY_FOR_INDEPENDENT_REFUND_REVIEW",
  refundAllowed:false,reversibleCredits:e.creditsRemaining,
  requiresHumanReview:true});
}
