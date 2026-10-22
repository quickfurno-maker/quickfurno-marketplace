/**
 * PAY-1: pure normalized bank reference contract, source-only/feature gated.
 * A submitted UTR is NOT verified bank settlement; do not mint credits here.
 */
export function normalizeManualBankReference(method,reference){
 const rail=String(method??"").trim().toLowerCase();
 if(!rail||rail==="razorpay"||rail==="online"||rail==="online_future")
  throw new Error("MANUAL_PAYMENT_RAIL_INVALID");
 const needsExternalProof=/(^upi$|bank|neft|imps|rtgs|transfer)/i.test(rail);
 const token=String(reference??"").trim().toUpperCase();
 if(needsExternalProof&&!token)throw new Error("MANUAL_BANK_REFERENCE_REQUIRED");
 if(token&&!/^[A-Z0-9][A-Z0-9/_-]{5,63}$/.test(token))
  throw new Error("MANUAL_BANK_REFERENCE_INVALID");
 return {method:rail,reference:token||null,needsBankStatementVerification:needsExternalProof};
}
