// PAY-4C0 B: audit of existing source contracts only. No access grants.
export const securityReviewChecklist=Object.freeze([
 "Owner uses existing Core Superadmin with verified AAL2",
 "Staff uses Core Auth and approved VOX team and vendor scope",
 "Finance read grant has independent approver, expiry and revocation check",
 "Finance case approval is evidence-only, not refund or wallet execution",
 "Service role never reaches browser or NEXT_PUBLIC variables",
 "Candidate SQL security definer functions have reviewed search_path and revoked PUBLIC execute",
 "Every Finance table enforces RLS; sensitive views are invoker and service role scoped",
 "Independent AppSec still must sign the exact source and Staging privileges"
]);
export function classifyFinanceReview({ownerAal2,staffAal2,financeGrantVerified,
 vendorScopeVerified,reviewerIndependent,appsecSignatureVerified}={}){
 const checks={ownerAal2:ownerAal2===true,staffAal2:staffAal2===true,
  financeGrantVerified:financeGrantVerified===true,
  vendorScopeVerified:vendorScopeVerified===true,
  reviewerIndependent:reviewerIndependent===true,
  appsecSignatureVerified:appsecSignatureVerified===true};
 return Object.freeze({checks,sourceReviewReady:Object.values(checks).every(Boolean),
  grantsIssued:false,financialActionAllowed:false,stagingApproval:false,
  independentAppSecRequired:true});
}
