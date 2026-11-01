import { adminClient } from "../lib/supabase";
import { fail, ok, type Result } from "../lib/errors";
import { deriveAosBadLeadRecoveryRecommendation } from "../lib/aos/v2/badLeadRecoveryRecommendation";
import { isAllowedBadLeadRecoveryAction } from "../lib/vox/creditOnlyBadLeadPolicy.mjs";

/** Historical type retained for existing server action / UI compatibility.
 * Runtime rejects replace / restore_credit_and_replace under the new policy. */
export type BadLeadRecoveryAction="restore_credit"|"replace"|"restore_credit_and_replace"|"reject";
type RecoveryRpcResult={
 status?:string;reason_code?:string|null;
 original_assignment_id?:string;credit_restoration_approval_id?:string|null;
 lead_credits_restored?:number;cash_refunded_minor_units?:number;
 automatic_replacement_created?:boolean;replacement_assignment_id?:string|null;
 monetary_refund_id?:string|null
};
const blocked=<T>(code:string,error:string):Result<T>=>({ok:false,code,error});
// RC43 owner-controlled release constant. An environment flag alone MUST NOT
// activate a real canonical vendor credit mutation before DBA/AppSec + recovery GO.
export const RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const policyDenied=<T>()=>blocked<T>("BAD_LEAD_CREDIT_ONLY_POLICY",
 "A verified bad lead receives one lead credit, never money or a replacement assignment.");

export async function recommendBadLeadRecovery(
 reportId:string,recommendation:"none"|Exclude<BadLeadRecoveryAction,"reject">
):Promise<Result<{reportId:string;recommendation:string}>>{
 if(!UUID.test(reportId||""))return blocked("VALIDATION","Valid bad-lead report is required.");
 if(recommendation!=="none"&&recommendation!=="restore_credit")return policyDenied();
 try{
  const {data,error}=await adminClient().rpc("qf_recommend_bad_lead_recovery_v1",{
   p_report_id:reportId,p_recommendation:recommendation
  });
  if(error)throw error;
  const row=(data??{}) as RecoveryRpcResult;
  if(row.status!=="applied")return blocked(String(row.reason_code??"RECOVERY_RECOMMENDATION_REFUSED"),
   "Recovery recommendation was refused.");
  if((row.lead_credits_restored!==undefined&&row.lead_credits_restored!==0)||
     (row.cash_refunded_minor_units!==undefined&&row.cash_refunded_minor_units!==0)||
     row.automatic_replacement_created===true||row.replacement_assignment_id!=null||
     row.monetary_refund_id!=null)
   return blocked("RECOMMENDATION_RESPONSE_INVALID","Recommendation cannot execute a credit, replacement or refund.");
  return ok({reportId,recommendation});
 }catch(e){return fail(e);}
}

export async function generateBadLeadRecoveryRecommendation(
 reportId:string
):Promise<Result<{reportId:string;recommendation:string}>>{
 if(!UUID.test(reportId||""))return blocked("VALIDATION","Valid bad-lead report is required.");
 try{
  const {data,error}=await adminClient().from("bad_lead_reports")
   .select("reason_code,report_type").eq("id",reportId).maybeSingle();
  if(error)throw error;
  if(!data)return blocked("REPORT_NOT_FOUND","Bad-lead report not found.");
  const recommendation=deriveAosBadLeadRecoveryRecommendation(data.reason_code??data.report_type);
  // Never let an advisor authorize automatic replacement or any money movement.
  if(recommendation!=="none"&&recommendation!=="restore_credit")return policyDenied();
  return recommendBadLeadRecovery(reportId,recommendation);
 }catch(e){return fail(e);}
}

/** RC42 credit-only handoff. The old report-scoped V1 has no global per-original-
 * assignment uniqueness, so it is NOT used for a credit restoration. Only the
 * reviewed atomic RPC may grant exactly one canonical LEAD credit. Its SQL is
 * presently an UNINSTALLED review candidate; default-off returns HOLD.
 */
export async function applyBadLeadRecovery(
 reportId:string,action:BadLeadRecoveryAction,actorId:string
):Promise<Result<{
 reportId:string;action:BadLeadRecoveryAction;
 replacementStatus:"not_requested"|"assigned"|"pending_no_eligible_vendor";
 replacementAssignmentId:string|null;
 restorationStatus?:"applied"|"already_applied"|"rejected";
 originalAssignmentId?:string;
 creditRestorationApprovalId?:string;
 leadCreditsRestored?:0|1;
}>>{
 if(!UUID.test(reportId||"")||!UUID.test(actorId||""))
  return blocked("VALIDATION","Report and verified administrator are required.");
 if(!isAllowedBadLeadRecoveryAction(action))return policyDenied();
 try{
  if(action==="restore_credit"){
   if(!RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED ||
      process.env.QF_VOX_BAD_LEAD_CREDIT_ONLY_ATOMIC_ENABLED!=="staging")
    return blocked("CREDIT_ONLY_ATOMIC_NOT_APPROVED",
     "Reviewed atomic one-credit-per-assignment authority is not installed.");
   const {data,error}=await adminClient().rpc(
    "qf_vox_rc42_bad_lead_credit_only_atomic_candidate_v1",{
     p_report_id:reportId,p_actor_id:actorId
    });
   if(error)throw error;
   const r=(data??{}) as RecoveryRpcResult;
   if(r.status!=="applied"&&r.status!=="already_applied")
    return blocked(String(r.reason_code??"CREDIT_ONLY_RECOVERY_REFUSED"),
     "Lead-credit restoration was denied by canonical authority.");
   // V2 returns 0 on replay, 1 on first restoration and never money or replacement.
   // The SQL authority must identify the ORIGINAL consumed assignment and
   // the unique canonical approval on both first application and replay.
   // A mere {status:"applied",lead_credits_restored:1} is not proof.
   if(r.cash_refunded_minor_units!==0||r.lead_credits_restored!==(r.status==="applied"?1:0)||
      !UUID.test(r.original_assignment_id??"")||
      !UUID.test(r.credit_restoration_approval_id??"")||
      (r.automatic_replacement_created===true)||r.replacement_assignment_id!=null||
      r.monetary_refund_id!=null||
      (r.status==="applied"&&r.automatic_replacement_created!==false))
    return blocked("CREDIT_ONLY_RESPONSE_INVALID","Credit-only result failed safe contract.");
   return ok({reportId,action,replacementStatus:"not_requested",
    replacementAssignmentId:null,originalAssignmentId:r.original_assignment_id,
    creditRestorationApprovalId:r.credit_restoration_approval_id??undefined,
    leadCreditsRestored:r.status==="applied"?1:0,
    restorationStatus:r.status});
  }
  // Existing reject path never restores credits, pays money or assigns a lead.
  const {data,error}=await adminClient().rpc("qf_apply_bad_lead_recovery_v1",{
   p_report_id:reportId,p_actor_id:actorId,p_action:"reject"
  });
  if(error)throw error;
  const r=(data??{}) as RecoveryRpcResult;
  if(r.status!=="applied"&&r.status!=="already_applied")
   return blocked(String(r.reason_code??"RECOVERY_REJECT_REFUSED"),"Rejection was refused.");
  // A human rejection must not be reported successful from a response
  // claiming any cash, lead credits or a new assignment.
  if((r.lead_credits_restored!==undefined&&r.lead_credits_restored!==0)||
     (r.cash_refunded_minor_units!==undefined&&r.cash_refunded_minor_units!==0)||
     r.automatic_replacement_created===true||r.replacement_assignment_id!=null||
     r.monetary_refund_id!=null)
   return blocked("REJECT_RESPONSE_INVALID","Unexpected financial or replacement effect in rejection receipt.");
  return ok({reportId,action,replacementStatus:"not_requested",replacementAssignmentId:null});
 }catch(e){return fail(e);}
}
