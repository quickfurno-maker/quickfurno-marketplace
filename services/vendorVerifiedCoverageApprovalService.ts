// Vendor OS V3 — canonical, fail-closed same-city coverage finalizer.
import "server-only";
import { adminClient } from "@/lib/supabase";
import { appError, fail, ok, type Result } from "@/lib/errors";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function approveVendorVerifiedCoverageChangeRequest(requestId: string, actorId: string, notes?: string): Promise<Result<{id:string;status:string}>> {
  try {
    if (!UUID.test(requestId) || !UUID.test(actorId) || (notes ?? "").length>2000) throw appError("VALIDATION");
    const { data, error } = await adminClient().rpc("qf_approve_vendor_verified_coverage_v1", {
      p_request_id: requestId, p_admin_id: actorId, p_notes: notes?.trim() || null,
    });
    if (error) throw error;
    if (!data || data.status!=="approved" || data.reviewed_by!==actorId || data.request_type!=="service_coverage_change") throw appError("UNKNOWN");
    return ok(data as {id:string;status:string});
  } catch (error) { return fail(error); }
}