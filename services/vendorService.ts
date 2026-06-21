// ============================================================================
// QuickFurno — services/vendorService.ts
// Vendor registration, dashboard data, lead status updates, bad-lead reports.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { appError, type Result, ok, fail } from "../lib/errors";
import { logSupabaseInsertError } from "../lib/supabaseLogging";
import type {
  VendorRegistrationInput, VendorDashboardStats, VendorLeadStatus,
} from "../lib/types";

/** Public vendor registration. Always lands as Pending + not visible. */
export async function registerVendor(input: VendorRegistrationInput): Promise<Result<{ id: string }>> {
  try {
    if (!input.business_name?.trim() || !input.phone?.trim() || !input.city?.trim()) {
      throw appError("VALIDATION");
    }
    const { data, error } = await adminClient()
      .from("vendors")
      .insert({
        business_name: input.business_name,
        owner_name: input.owner_name ?? null,
        phone: input.phone,
        email: input.email ?? null,
        city: input.city,
        areas_covered: input.areas_covered ?? [],
        covers_full_city: input.covers_full_city ?? false,
        service_categories: input.service_categories ?? [],
        experience: input.experience ?? null,
        portfolio_urls: input.portfolio_urls ?? [],
        profile_image_url: input.profile_image_url ?? null,
        gst_number: input.gst_number ?? null,
        message: input.message ?? null,
        user_id: input.user_id ?? null,
        status: "Pending",
        public_visibility: false,
      })
      .select("id")
      .single();
    if (error) {
      logSupabaseInsertError("vendors", error, {
        has_user_id: Boolean(input.user_id),
        has_email: Boolean(input.email),
        service_count: input.service_categories?.length ?? 0,
        area_count: input.areas_covered?.length ?? 0,
      });
      throw error;
    }
    return ok({ id: data.id });
  } catch (e) {
    return fail(e);
  }
}

/** Recompute and persist a vendor's public visibility (approved+active+credits+pack). */
export async function updateVendorVisibility(vendorId: string): Promise<Result<null>> {
  try {
    const { error } = await adminClient().rpc("update_vendor_visibility", { p_vendor_id: vendorId });
    if (error) throw error;
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function getVendorDashboardStats(vendorId: string): Promise<Result<VendorDashboardStats>> {
  try {
    const db = adminClient();
    const [vendor, assignments, reports] = await Promise.all([
      db.from("vendors").select("total_credits, remaining_credits").eq("id", vendorId).single(),
      db.from("lead_assignments").select("vendor_status").eq("vendor_id", vendorId),
      db.from("bad_lead_reports").select("id", { count: "exact", head: true }).eq("vendor_id", vendorId),
    ]);
    if (vendor.error) throw vendor.error;

    const rows = assignments.data ?? [];
    const count = (s: VendorLeadStatus) => rows.filter((r: { vendor_status: string }) => r.vendor_status === s).length;

    return ok({
      total_credits: vendor.data.total_credits,
      remaining_credits: vendor.data.remaining_credits,
      total_leads: rows.length,
      won: count("Won"),
      lost: count("Lost"),
      in_progress: rows.length - count("Won") - count("Lost"),
      bad_lead_reports: reports.count ?? 0,
    });
  } catch (e) {
    return fail(e);
  }
}

/** Leads assigned to a vendor, newest first, with the (now permitted) client contact. */
export async function getVendorAssignedLeads(vendorId: string): Promise<Result<unknown[]>> {
  try {
    const { data, error } = await adminClient()
      .from("lead_assignments")
      .select(`
        id, assigned_at, assignment_type, vendor_status, is_bad_lead_reported,
        lead:leads ( id, name, phone, city, area, service_required, budget, property_type, timeline, message, created_at )
      `)
      .eq("vendor_id", vendorId)
      .order("assigned_at", { ascending: false });
    if (error) throw error;
    return ok(data ?? []);
  } catch (e) {
    return fail(e);
  }
}

/** Vendor updates their pipeline status for a lead + logs it to the timeline. */
export async function updateVendorLeadStatus(
  assignmentId: string, status: VendorLeadStatus, notes?: string
): Promise<Result<null>> {
  try {
    const db = adminClient();
    const { data: a, error: aErr } = await db
      .from("lead_assignments").select("id, vendor_id").eq("id", assignmentId).single();
    if (aErr || !a) throw appError("UNKNOWN");

    const { error: upErr } = await db
      .from("lead_assignments").update({ vendor_status: status }).eq("id", assignmentId);
    if (upErr) throw upErr;

    const { error: statusErr } = await db.from("lead_status_updates").insert({
      lead_assignment_id: assignmentId, vendor_id: a.vendor_id, status, notes: notes ?? null,
    });
    if (statusErr) {
      logSupabaseInsertError("lead_status_updates", statusErr, {
        assignment_id: assignmentId,
        vendor_id: a.vendor_id,
        status,
      });
      throw statusErr;
    }
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

/** Report a bad lead — only within app_settings.bad_lead_report_window_hours. */
export async function reportBadLead(
  assignmentId: string, reason: string, description?: string
): Promise<Result<{ id: string }>> {
  try {
    const db = adminClient();

    const { data: a, error: aErr } = await db
      .from("lead_assignments").select("id, vendor_id, assigned_at").eq("id", assignmentId).single();
    if (aErr || !a) throw appError("UNKNOWN");

    const { data: windowH } = await db.rpc("get_setting_int", {
      p_key: "bad_lead_report_window_hours", p_default: 24,
    });
    const ageHours = (Date.now() - new Date(a.assigned_at).getTime()) / 36e5;
    if (ageHours > Number(windowH ?? 24)) throw appError("REPORT_WINDOW_CLOSED");

    const { data, error } = await db
      .from("bad_lead_reports")
      .insert({
        lead_assignment_id: assignmentId, vendor_id: a.vendor_id,
        reason, description: description ?? null, status: "Pending",
      })
      .select("id")
      .single();
    if (error) {
      logSupabaseInsertError("bad_lead_reports", error, {
        assignment_id: assignmentId,
        vendor_id: a.vendor_id,
        has_description: Boolean(description),
      });
      throw error;
    }

    await db.from("lead_assignments").update({ is_bad_lead_reported: true }).eq("id", assignmentId);
    return ok({ id: data.id });
  } catch (e) {
    return fail(e);
  }
}
