// QuickFurno vendor bad-lead remedy: a LEAD credit, never money.
// No direct replacement assignment, package refund, cash/wallet credit or payout.
// The canonical atomic database authority remains responsible for concurrency.
export const BAD_LEAD_CREDIT_ONLY_POLICY = Object.freeze({
 version:"qf.bad-lead.credit-only.v1",
 action:"restore_credit",
 credits:1,
 cashRefundAllowed:false,
 monetaryWalletCreditAllowed:false,
 automaticReplacementAllowed:false
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const freezeDecision=(status,reason,canApply=false)=>Object.freeze({
 status,reason,canApply,leadCredits:canApply?1:0,cashRefundAllowed:false,
 monetaryWalletCreditAllowed:false,automaticReplacementAllowed:false
});
/** Preflight only; never an authorization to mutate. Credit assignment exactly once
 * must be enforced by a DB unique key on original_assignment_id and a locked RPC.
 */
export function preflightBadLeadCreditOnly({report,assignment,actorId}={}){
 if(typeof actorId!=="string"||!UUID.test(actorId))return freezeDecision("blocked","VERIFIED_REVIEWER_REQUIRED");
 if(!report||!assignment||typeof report!=="object"||typeof assignment!=="object")
  return freezeDecision("blocked","ORIGINAL_ASSIGNMENT_REQUIRED");
 if(!UUID.test(String(report.id||""))||!UUID.test(String(report.vendor_id||""))||
    !UUID.test(String(report.lead_assignment_id||""))||
    report.vendor_id!==assignment.vendor_id||report.lead_assignment_id!==assignment.id)
  return freezeDecision("blocked","VENDOR_ASSIGNMENT_MISMATCH");
 if(report.recovery_status==="applied")
  return freezeDecision("already_applied","ORIGINAL_ASSIGNMENT_ALREADY_COMPENSATED");
 if(report.status!=="Approved"&&report.status!=="Valid")
  return freezeDecision("blocked","HUMAN_APPROVAL_REQUIRED");
 if(assignment.credit_deducted!==true)
  return freezeDecision("blocked","ORIGINAL_CREDIT_NOT_CONSUMED");
 if(assignment.lifecycle_status!=="assigned"&&assignment.lifecycle_status!=="delivered"&&
    assignment.lifecycle_status!=="accepted"&&assignment.lifecycle_status!=="invalid")
  return freezeDecision("blocked","ASSIGNMENT_NOT_RECOVERABLE");
 return freezeDecision("eligible_for_atomic_review","REQUIRES_DB_LOCKED_ONCE_PER_ASSIGNMENT",true);
}
export function isAllowedBadLeadRecoveryAction(action){
 return action==="restore_credit"||action==="reject";
}
