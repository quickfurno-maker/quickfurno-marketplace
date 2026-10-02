import { adminClient } from "../lib/supabase";
import { fail, ok, type Result } from "../lib/errors";
import { MAX_CANONICAL_CANDIDATE_POOL } from "../lib/marketplace/canonicalAssignmentContract";
import { executeCanonicalAssignment } from "./canonicalAssignmentAuthority";
import { evaluateVendorsForLead, type LeadForMatching } from "./leadMatchingEngine";
import { deriveAosBadLeadRecoveryRecommendation } from "../lib/aos/v2/badLeadRecoveryRecommendation";

export type BadLeadRecoveryAction = "restore_credit" | "replace" | "restore_credit_and_replace" | "reject";

type RecoveryRpcResult = {
  status?: string;
  reason_code?: string | null;
  lead_id?: string;
  original_assignment_id?: string;
  credit_restoration_approval_id?: string | null;
  replacement_request_id?: string | null;
};

export async function recommendBadLeadRecovery(
  reportId: string,
  recommendation: "none" | Exclude<BadLeadRecoveryAction, "reject">,
): Promise<Result<{ reportId: string; recommendation: string }>> {
  try {
    const { data, error } = await adminClient().rpc("qf_recommend_bad_lead_recovery_v1", {
      p_report_id: reportId,
      p_recommendation: recommendation,
    });
    if (error) throw error;
    const row = (data ?? {}) as RecoveryRpcResult & { recommendation?: string };
    if (row.status !== "applied") {
      return { ok:false, code:String(row.reason_code ?? "RECOVERY_RECOMMENDATION_REFUSED"), error:"Recovery recommendation was refused." };
    }
    return ok({ reportId, recommendation });
  } catch (error) {
    return fail(error);
  }
}

export async function generateBadLeadRecoveryRecommendation(
  reportId: string,
): Promise<Result<{ reportId: string; recommendation: string }>> {
  try {
    const { data, error } = await adminClient()
      .from("bad_lead_reports")
      .select("reason_code,report_type")
      .eq("id", reportId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok:false, code:"REPORT_NOT_FOUND", error:"Bad-lead report not found." };
    const recommendation = deriveAosBadLeadRecoveryRecommendation(data.reason_code ?? data.report_type);
    return recommendBadLeadRecovery(reportId, recommendation);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Human-governed V4 recovery. The database call invalidates the original
 * assignment and applies an approved credit restoration exactly once. When a
 * replacement was approved, this service asks the EXISTING MatchCore for a
 * fresh ranked pool and sends that list to the sole canonical assignment RPC.
 */
export async function applyBadLeadRecovery(
  reportId: string,
  action: BadLeadRecoveryAction,
  actorId: string,
): Promise<Result<{
  reportId: string;
  action: BadLeadRecoveryAction;
  replacementStatus: "not_requested" | "assigned" | "pending_no_eligible_vendor";
  replacementAssignmentId: string | null;
}>> {
  try {
    if (!reportId || !actorId) return { ok:false, code:"VALIDATION", error:"Report and admin actor are required." };

    if (action !== "reject") {
      // This is the explicit human review decision. Keeping it separate from the
      // credit/replacement RPC is safe: an approved report with no recovery
      // mutation is conservative and can be retried.
      const { error: reviewError } = await adminClient()
        .from("bad_lead_reports")
        .update({ status:"Approved", reviewed_by:actorId, reviewed_at:new Date().toISOString(), updated_at:new Date().toISOString() })
        .eq("id", reportId);
      if (reviewError) throw reviewError;
    }

    const { data, error } = await adminClient().rpc("qf_apply_bad_lead_recovery_v1", {
      p_report_id: reportId,
      p_actor_id: actorId,
      p_action: action,
    });
    if (error) throw error;
    const recovery = (data ?? {}) as RecoveryRpcResult;
    if (recovery.status !== "applied" && recovery.status !== "already_applied") {
      return { ok:false, code:String(recovery.reason_code ?? "RECOVERY_REFUSED"), error:"Recovery action was refused." };
    }

    const replacementRequestId = recovery.replacement_request_id ?? null;
    const leadId = recovery.lead_id ?? null;

    if (action === "restore_credit") {
      const now = new Date().toISOString();
      const { error: projectionError } = await adminClient()
        .from("bad_lead_reports")
        .update({ credit_restored:true, recovery_status:"applied", recovery_applied_at:now, updated_at:now })
        .eq("id", reportId);
      if (projectionError) throw projectionError;
      return ok({ reportId, action, replacementStatus:"not_requested", replacementAssignmentId:null });
    }
    if (action === "reject" || !replacementRequestId || !leadId) {
      return ok({ reportId, action, replacementStatus:"not_requested", replacementAssignmentId:null });
    }

    if (action === "restore_credit_and_replace") {
      const { error: creditProjectionError } = await adminClient()
        .from("bad_lead_reports")
        .update({ credit_restored:true, updated_at:new Date().toISOString() })
        .eq("id", reportId);
      if (creditProjectionError) throw creditProjectionError;
    }

    const { data: lead, error: leadError } = await adminClient()
      .from("leads")
      .select("id,name,phone,city,area,service_required,category,subcategory,budget,timeline,message,latitude,longitude,location_source,google_place_id,service_zone_id,location_verification_status,share_consent,is_duplicate")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) throw leadError;
    if (!lead) return { ok:false, code:"LEAD_NOT_FOUND", error:"Lead is no longer available for replacement." };

    const evaluation = await evaluateVendorsForLead(lead as LeadForMatching);
    if (!evaluation.ok) return evaluation;

    const candidateVendorIds = evaluation.data.eligible
      .map((vendor) => vendor.id)
      .slice(0, MAX_CANONICAL_CANDIDATE_POOL);

    if (candidateVendorIds.length === 0) {
      return ok({ reportId, action, replacementStatus:"pending_no_eligible_vendor", replacementAssignmentId:null });
    }

    const assignment = await executeCanonicalAssignment({
      leadId,
      mode:"replacement",
      candidateVendorIds,
      operationScope:`bad-lead-recovery:${reportId}`,
      actorKind:"admin",
      actorId,
      replacementRequestId,
      reasonCode:"human_approved_bad_lead_recovery",
    });
    if (!assignment.ok) return assignment;

    const replacementAssignmentId = assignment.data.assigned[0]?.assignment_id ?? null;
    if (!replacementAssignmentId) {
      return ok({ reportId, action, replacementStatus:"pending_no_eligible_vendor", replacementAssignmentId:null });
    }

    const finalized = await adminClient().rpc("qf_finalize_replacement_request_v1", {
      p_replacement_request_id: replacementRequestId,
      p_replacement_assignment_id: replacementAssignmentId,
      p_actor_id: actorId,
    });
    if (finalized.error) throw finalized.error;
    const finalStatus = String((finalized.data as Record<string, unknown> | null)?.status ?? "");
    if (finalStatus !== "applied" && finalStatus !== "already_applied") {
      return { ok:false, code:"REPLACEMENT_FINALIZE_REFUSED", error:"Replacement assignment was created but could not be linked to the recovery request." };
    }

    return ok({ reportId, action, replacementStatus:"assigned", replacementAssignmentId });
  } catch (error) {
    return fail(error);
  }
}
