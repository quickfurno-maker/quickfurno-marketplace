/** PAY-3 Final B/C human casework packet gates. No side effects or provider actions. */
import {normalizeManualBankReference} from "./financeV2ManualReference.mjs";
const HEX64=/^[0-9a-f]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const clean=x=>typeof x==="string"&&x.length>0&&x.length<=128&&x.trim()===x;
const no=code=>{throw Error("FINANCE_"+code)};
export function evaluateManualBankReceiptReview(input){
 if(!input||!UUID.test(input.paymentId)||!UUID.test(input.requesterId)||
  !UUID.test(input.reviewerId)||input.requesterId===input.reviewerId||
  input.reviewerAal2!==true||!UUID.test(input.approvalReference)||
  !clean(input.receivingAccountRef)||!HEX64.test(input.bankStatementSha256))
   no("MANUAL_REVIEW_UNTRUSTED");
 const reference=normalizeManualBankReference(input.method,input.utr);
 if(reference.needsBankStatementVerification!==true||!reference.reference)
  no("MANUAL_UTR_REQUIRED");
 if(!pos(input.recordedAmountSubunits)||!pos(input.bankLineAmountSubunits))
  no("MANUAL_AMOUNT_INVALID");
 if(input.bankStatementMatched!==true||
    input.recordedAmountSubunits!==input.bankLineAmountSubunits||
    input.bankLineReference!==reference.reference||
    input.bankLineReceivingAccount!==input.receivingAccountRef)
  no("MANUAL_BANK_EVIDENCE_MISMATCH");
 return Object.freeze({paymentId:input.paymentId,reference:reference.reference,
  evidenceHash:input.bankStatementSha256,amountSubunits:input.bankLineAmountSubunits,
  decision:"DUAL_REVIEW_EVIDENCE_ONLY",paidStatusChangeAllowed:false,
  walletCreditAllowed:false});
}
export function evaluateConsumedCreditRefundSafety(input){
 if(!input||!UUID.test(input.orderId)||!pos(input.creditsPurchased)||
  !Number.isSafeInteger(input.creditsConsumed)||input.creditsConsumed<0||
  input.creditsConsumed>input.creditsPurchased||
  !Number.isSafeInteger(input.creditsRemaining)||input.creditsRemaining<0||
  input.creditsConsumed+input.creditsRemaining>input.creditsPurchased)
   no("CREDIT_HISTORY_UNTRUSTED");
 return Object.freeze({
  orderId:input.orderId,creditsPurchased:input.creditsPurchased,
  consumed:input.creditsConsumed,remaining:input.creditsRemaining,
  disposition:input.creditsConsumed>0?"OWNER_POLICY_REQUIRED":"REVIEW_REFUND_ELIGIBILITY",
  automaticCreditClawbackAllowed:false,automaticProviderRefundAllowed:false
 });
}
export function evaluateBankSettlementProof(input){
 if(!input||!["test","live"].includes(input.providerMode)||
  !clean(input.providerSettlementId)||!clean(input.bankReference)||
  !HEX64.test(input.statementSha256)||!UUID.test(input.submittedBy)||
  !UUID.test(input.verifiedBy)||input.submittedBy===input.verifiedBy||
  input.reviewerAal2!==true||
  !Number.isSafeInteger(input.providerDeclaredNetSubunits)||
  !Number.isSafeInteger(input.ledgerCalculatedNetSubunits)||
  !Number.isSafeInteger(input.bankDepositedSubunits)||
  input.providerDeclaredNetSubunits<0||input.ledgerCalculatedNetSubunits<0||
  input.bankDepositedSubunits<0)no("BANK_SETTLEMENT_EVIDENCE_INVALID");
 const matches=input.providerDeclaredNetSubunits===input.ledgerCalculatedNetSubunits&&
  input.bankDepositedSubunits===input.ledgerCalculatedNetSubunits;
 return Object.freeze({providerSettlementId:input.providerSettlementId,
  providerMode:input.providerMode,bankReference:input.bankReference,
  state:matches?"THREE_WAY_AMOUNT_MATCH":"THREE_WAY_DISCREPANCY",
  releaseAllowed:false,bankVerifiedAmountOnly:matches,
  revenueRecognitionCertified:false});
}
