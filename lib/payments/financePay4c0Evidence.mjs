// PAY-4C0 finance evidence packet review. This is NOT a bank verification adapter.
const H=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const money=n=>Number.isSafeInteger(n)&&n>=0;
const bad=reason=>Object.freeze({ok:false,reason,bankVerified:false,
 refundReleaseAllowed:false,markPaidAllowed:false,creditReversalAllowed:false});
export function reviewBankRefundEvidence(x){
 if(!x||!UUID.test(x.caseId)||!UUID.test(x.requesterId)||
  !UUID.test(x.reviewerId)||x.requesterId===x.reviewerId||
  !H.test(x.bankStatementSha256)||!H.test(x.providerStatementSha256)||
  !money(x.providerNetSubunits)||!money(x.bankNetSubunits)||
  !money(x.ledgerNetSubunits))return bad("EVIDENCE_SHAPE_INVALID");
 if(x.reviewerAal2!==true)return bad("INDEPENDENT_MFA_REQUIRED");
 if(x.providerNetSubunits!==x.bankNetSubunits||
  x.ledgerNetSubunits!==x.bankNetSubunits)
  return bad("BANK_AMOUNT_DISCREPANCY");
 if(x.bankOwnershipEvidenceConfirmed!==true)return bad("BANK_OWNERSHIP_UNVERIFIED");
 // Metadata, even consistent, does not establish authentic imported statements.
 return Object.freeze({ok:true,reason:"REVIEW_PACKET_CONSISTENT_ONLY",
  bankVerified:false,refundReleaseAllowed:false,markPaidAllowed:false,
  creditReversalAllowed:false,realBankImportRequired:true,
  externallyAttestedProviderProofRequired:true});
}
export function reviewConsumedCreditsForRefund({purchased,consumed,remaining,independentPolicyApproved}={}){
 if(!Number.isSafeInteger(purchased)||purchased<=0||
  !Number.isSafeInteger(consumed)||consumed<0||
  !Number.isSafeInteger(remaining)||remaining<0||
  consumed+remaining>purchased)return bad("CREDITS_UNTRUSTED");
 return Object.freeze({ok:true,requiresHumanPolicy:consumed>0,
  humanPolicyRecorded:independentPolicyApproved===true,
  refundExecutionAllowed:false,automaticClawbackAllowed:false,
  vendorCreditCorrectionAllowed:false});
}
