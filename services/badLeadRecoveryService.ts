import { adminClient } from "../lib/supabase";
import { fail, ok, type Result } from "../lib/errors";
import { deriveAosBadLeadRecoveryRecommendation } from "../lib/aos/v2/badLeadRecoveryRecommendation";
import { isAllowedBadLeadRecoveryAction } from "../lib/vox/creditOnlyBadLeadPolicy.mjs";

/** Only one vendor LEAD credit restoration or a human rejection is supported.
 * Historical replacement actions are rejected at runtime as untrusted input. */
export type BadLeadRecoveryAction="restore_credit"|"reject";
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
// Rejection also mutates canonical recovery state. Release it only after a
// separately reviewed Staging installation; never by environment flag alone.
export const RC82_BAD_LEAD_REJECTION_RPC_INSTALLED=false as const;
// Canonical RPC transport cannot hand browser callers arbitrary reason text,
// objects or backend diagnostics masquerading as an application error code.
const knownRefusal=(s:unknown)=>["blocked","denied","refused","rejected"].includes(String(s));
const safeReason=(v:unknown,fallback:string)=>typeof v==="string"&&
 /^[A-Z][A-Z0-9_]{2,63}$/.test(v)?v:fallback;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const policyDenied=<T>()=>blocked<T>("BAD_LEAD_CREDIT_ONLY_POLICY",
 "A verified bad lead receives one lead credit, never money or a replacement assignment.");
// Credit may have committed even when the RPC response is lost. The same
// report must be reconciled against its ORIGINAL assignment before any retry.
const uncertainCredit=<T>()=>blocked<T>("CREDIT_OUTCOME_UNKNOWN",
 "Lead-credit outcome is uncertain. Reconcile this exact bad-lead report before retry; never issue another credit.");
// A lost canonical credit receipt may follow a committed one-credit transaction.
// This limits HTTP waiting; it NEVER retries the RPC or declares rollback.
const CREDIT_RPC_TIMEOUT_MS=4000;
// Rejection also changes canonical report state. A lost receipt is not proof
// of rollback; never invite another contradictory decision automatically.
const REJECT_RPC_TIMEOUT_MS=4000;
// A recommendation mutates human-review metadata, even though it MUST never
// grant a lead credit or cash. Lost write receipts require reconciliation.
const RECOMMEND_RPC_TIMEOUT_MS=3000;
const uncertainRecommendation=<T>()=>blocked<T>("RECOMMEND_OUTCOME_UNKNOWN",
 "Recommendation state may have changed. Reconcile the exact report before another recommendation.");
const uncertainReject=<T>()=>blocked<T>("REJECT_OUTCOME_UNKNOWN",
 "Rejection outcome is uncertain. Reconcile the exact report before another decision.");

export async function recommendBadLeadRecovery(
 reportId:string,recommendation:"none"|"restore_credit"
):Promise<Result<{reportId:string;recommendation:string}>>{
 if(!UUID.test(reportId||""))return blocked("VALIDATION","Valid bad-lead report is required.");
 if(recommendation!=="none"&&recommendation!=="restore_credit")return policyDenied();
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const result=await Promise.race([
   Promise.resolve(adminClient().rpc("qf_recommend_bad_lead_recovery_v1",{
    p_report_id:reportId,p_recommendation:recommendation
   })).then(value=>({timedOut:false as const,value})),
   new Promise<{timedOut:true}>(resolve=>{
    timer=setTimeout(()=>resolve({timedOut:true}),RECOMMEND_RPC_TIMEOUT_MS);
   })
  ]);
  if(result.timedOut)return uncertainRecommendation();
  const {data,error}=result.value;
  if(error||!data||typeof data!=="object"||Array.isArray(data))
   return uncertainRecommendation();
  const row=data as RecoveryRpcResult;
  if(row.status!=="applied"){
   if(!knownRefusal(row.status))return uncertainRecommendation();
   return blocked(safeReason(row.reason_code,"RECOVERY_RECOMMENDATION_REFUSED"),
    "Recovery recommendation was refused.");
  }
  if((row.lead_credits_restored!==undefined&&row.lead_credits_restored!==0)||
     (row.cash_refunded_minor_units!==undefined&&row.cash_refunded_minor_units!==0)||
     row.automatic_replacement_created===true||row.replacement_assignment_id!=null||
     row.monetary_refund_id!=null)
   return blocked("RECOMMENDATION_RESPONSE_INVALID","Recommendation cannot execute a credit, replacement or refund.");
  return ok({reportId,recommendation});
 }catch{return uncertainRecommendation();}
 finally{if(timer!==undefined)clearTimeout(timer);}
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
 replacementStatus:"not_requested";
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
   let creditTimer:ReturnType<typeof setTimeout>|undefined;
   let data:unknown,error:unknown;
   try{
    const result=await Promise.race([
     Promise.resolve(adminClient().rpc(
      "qf_vox_rc42_bad_lead_credit_only_atomic_candidate_v1",{
       p_report_id:reportId,p_actor_id:actorId
      })).then(value=>({timedOut:false as const,value})),
     new Promise<{timedOut:true}>(resolve=>{
      creditTimer=setTimeout(()=>resolve({timedOut:true}),CREDIT_RPC_TIMEOUT_MS);
     })
    ]);
    if(result.timedOut)return uncertainCredit();
    ({data,error}=result.value);
   }finally{if(creditTimer!==undefined)clearTimeout(creditTimer);}
   if(error)return uncertainCredit();
   const r=(data??{}) as RecoveryRpcResult;
   if(r.status!=="applied"&&r.status!=="already_applied"){
    if(!knownRefusal(r.status))return uncertainCredit();
    return blocked(safeReason(r.reason_code,"CREDIT_ONLY_RECOVERY_REFUSED"),
     "Lead-credit restoration was denied by canonical authority.");
   }
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
    return uncertainCredit();
   return ok({reportId,action,replacementStatus:"not_requested",
    replacementAssignmentId:null,originalAssignmentId:r.original_assignment_id,
    creditRestorationApprovalId:r.credit_restoration_approval_id??undefined,
    leadCreditsRestored:r.status==="applied"?1:0,
    restorationStatus:r.status});
  }
  // A reject can still commit a financial-equivalent decision. Keep the old
  // report-scoped reject writer disabled until its SQL/authorization review.
  if(!RC82_BAD_LEAD_REJECTION_RPC_INSTALLED ||
     process.env.QF_VOX_BAD_LEAD_REJECT_RPC_ENABLED!=="staging")
   return blocked("BAD_LEAD_REJECTION_NOT_APPROVED",
    "Canonical bad-lead rejection is awaiting reviewed Staging installation.");
  // Existing reject path never restores credits, pays money or assigns a lead.
  let rejectTimer:ReturnType<typeof setTimeout>|undefined;
  let rejectResult:{data:unknown;error:unknown};
  try{
   const reply=await Promise.race([
    Promise.resolve(adminClient().rpc("qf_apply_bad_lead_recovery_v1",{
     p_report_id:reportId,p_actor_id:actorId,p_action:"reject"
    })).then(value=>({timedOut:false as const,value})),
    new Promise<{timedOut:true}>(resolve=>{
     rejectTimer=setTimeout(()=>resolve({timedOut:true}),REJECT_RPC_TIMEOUT_MS);
    })
   ]);
   if(reply.timedOut)return uncertainReject();
   rejectResult=reply.value;
  }finally{if(rejectTimer!==undefined)clearTimeout(rejectTimer);}
  const {data,error}=rejectResult;
  if(error||!data||typeof data!=="object"||Array.isArray(data))
   return uncertainReject();
  const r=data as RecoveryRpcResult;
  if(r.status!=="applied"&&r.status!=="already_applied"){
   if(!knownRefusal(r.status))return uncertainReject();
   return blocked(safeReason(r.reason_code,"RECOVERY_REJECT_REFUSED"),"Rejection was refused.");
  }
  // A human rejection must not be reported successful from a response
  // claiming any cash, lead credits or a new assignment.
  // Absence of the zero-effect fields is NOT proof of zero effects. The
  // disabled legacy rejection writer cannot be approved based on omissions.
  if(r.lead_credits_restored!==0||r.cash_refunded_minor_units!==0||
     r.automatic_replacement_created!==false||r.replacement_assignment_id!=null||
     r.monetary_refund_id!=null)
   return uncertainReject();
  return ok({reportId,action,replacementStatus:"not_requested",replacementAssignmentId:null});
 }catch(e){
  if(action==="restore_credit"&&RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED&&
     process.env.QF_VOX_BAD_LEAD_CREDIT_ONLY_ATOMIC_ENABLED==="staging")
   return uncertainCredit();
  if(action==="reject")return uncertainReject();
  return fail(e);
 }
}
