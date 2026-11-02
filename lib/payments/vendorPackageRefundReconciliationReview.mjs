// Joins two independently supplied READ-ONLY finance evidence families.
// No provider API, DB writes, payouts, refunds or credit authority.
// Evidence provenance, capture and settlement must be verified externally.
import {assessVendorPackageRefundEvidence} from "./vendorPackageRefundEvidence.mjs";
import {reviewVendorPackageCreditLedger} from "./vendorPackageCreditLedgerReview.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=(reason)=>Object.freeze({ok:false,reason,refundAllowed:false,
 creditRevocationAllowed:false,requiresHumanReview:true});
export function reconcileRefundAgainstCreditEvidence(input){
 if(!input||typeof input!=="object"||Array.isArray(input)||
    Object.keys(input).sort().join("|")!==["creditLedger","refundEvidence","vendorId"].sort().join("|")||
    !UUID.test(input.vendorId))return deny("FINANCE_RECONCILIATION_INPUT_INVALID");
 const {creditLedger,refundEvidence,vendorId}=input;
 if(!creditLedger||creditLedger.vendorId!==vendorId||
    !refundEvidence||creditLedger.orderId!==refundEvidence.localOrderId)
  return deny("FINANCE_RECONCILIATION_ORDER_VENDOR_MISMATCH");
 const ledger=reviewVendorPackageCreditLedger(creditLedger);
 if(!ledger.ok)return deny("FINANCE_CREDIT_LEDGER_"+ledger.reason);
 if(refundEvidence.creditsGranted!==creditLedger.creditsGranted||
    refundEvidence.creditsRemaining!==creditLedger.creditsRemaining||
    refundEvidence.creditsConsumed!==creditLedger.creditsGranted-creditLedger.creditsRemaining)
  return deny("FINANCE_REFUND_CREDIT_TOTAL_MISMATCH");
 const refund=assessVendorPackageRefundEvidence(refundEvidence);
 if(!refund.ok)return deny("FINANCE_REFUND_"+refund.reason);
 if(refund.reversibleCredits!==ledger.reversibleCreditsForHumanReview)
  return deny("FINANCE_REVIEW_REVERSIBLE_TOTAL_MISMATCH");
 return Object.freeze({ok:true,reason:"FINANCE_MATCHED_EVIDENCE_REQUIRES_HUMAN_AUTHORIZATION",
  orderId:creditLedger.orderId,vendorId,reviewableCredits:ledger.reversibleCreditsForHumanReview,
  refundAllowed:false,creditRevocationAllowed:false,requiresHumanReview:true,
  providerSettlementIndependentlyCertified:false});
}
