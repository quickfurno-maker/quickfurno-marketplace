// PAY-4A case intake and reviewer schema, audit-only; never executes payments.
const U=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const H=/^[0-9a-f]{64}$/;
const R=/^[A-Z_]{3,64}$/;
function invalid(){throw Error("FINANCE_CASE_INVALID");}
export function validateFinanceCaseRequest(x){
 if(!x||Object.keys(x).sort().join(",")!=="caseKind,clientRequestId,evidenceSha256,orderId,requestedAmountSubunits"||
 !U.test(x.orderId)||!U.test(x.clientRequestId)||
 !["MANUAL_RECEIPT_REVIEW","REFUND_POLICY_REVIEW"].includes(x.caseKind)||
 !Number.isSafeInteger(x.requestedAmountSubunits)||x.requestedAmountSubunits<=0||
 !H.test(x.evidenceSha256))invalid();
 return Object.freeze({orderId:x.orderId,clientRequestId:x.clientRequestId,
  caseKind:x.caseKind,requestedAmountSubunits:x.requestedAmountSubunits,
  evidenceSha256:x.evidenceSha256,financialExecutionAllowed:false});
}
export function validateFinanceCaseDecision(x){
 if(!x||Object.keys(x).sort().join(",")!=="caseId,decision,reasonCode,reviewReference"||
 !U.test(x.caseId)||!U.test(x.reviewReference)||
 !["APPROVED_FOR_FURTHER_CHECKS","REJECTED"].includes(x.decision)||
 !R.test(x.reasonCode))invalid();
 return Object.freeze({...x,financialExecutionAllowed:false});
}
