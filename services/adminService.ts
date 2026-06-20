// ============================================================================
// QuickFurno — services/adminService.ts
// Admin dashboard metrics, vendor moderation, bad-lead resolution.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { appError, type Result, ok, fail } from "../lib/errors";
import type { AdminDashboardStats } from "../lib/types";

const head = (q: any) => q.select("id", { count: "exact", head: true });

export async function getAdminDashboardStats(): Promise<Result<AdminDashboardStats>> {
  try {
    const db = adminClient();
    const [
      leads, assigned, duplicates, vendors, approved, pending, active,
      distributed, badPending, paidPayments, creditRows,
    ] = await Promise.all([
      head(db.from("leads")),
      head(db.from("leads")).eq("status", "Assigned"),
      head(db.from("leads")).eq("is_duplicate", true),
      head(db.from("vendors")),
      head(db.from("vendors")).eq("status", "Approved"),
      head(db.from("vendors")).eq("status", "Pending"),
      head(db.from("vendors")).eq("is_active", true).eq("status", "Approved"),
      head(db.from("lead_assignments")),
      head(db.from("bad_lead_reports")).eq("status", "Pending"),
      db.from("payments").select("amount").eq("payment_status", "Paid"),
      db.from("vendors").select("remaining_credits"),
    ]);

    const revenue = (paidPayments.data ?? []).reduce((s: number, r: { amount?: number }) => s + Number(r.amount ?? 0), 0);
    const credits = (creditRows.data ?? []).reduce((s: number, r: { remaining_credits?: number }) => s + Number(r.remaining_credits ?? 0), 0);

    return ok({
      total_leads: leads.count ?? 0,
      assigned_leads: assigned.count ?? 0,
      duplicate_leads: duplicates.count ?? 0,
      total_vendors: vendors.count ?? 0,
      approved_vendors: approved.count ?? 0,
      pending_vendors: pending.count ?? 0,
      active_vendors: active.count ?? 0,
      total_revenue: revenue,
      leads_distributed: distributed.count ?? 0,
      remaining_vendor_credits: credits,
      bad_lead_reports_pending: badPending.count ?? 0,
    });
  } catch (e) {
    return fail(e);
  }
}

export async function getAllLeads(): Promise<Result<unknown[]>> {
  try {
    const { data, error } = await adminClient()
      .from("leads")
      .select("*, lead_assignments(id, vendor_id, vendor_status, assignment_type)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ok(data ?? []);
  } catch (e) {
    return fail(e);
  }
}

/** Admin sets a lead's workflow status (New/Verified/Assigned/Contacted/Converted/Bad Lead…). */
export async function updateLeadStatus(leadId: string, status: string): Promise<Result<null>> {
  try {
    const { error } = await adminClient().from("leads").update({ status }).eq("id", leadId);
    if (error) throw error;
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function getAllVendors(): Promise<Result<unknown[]>> {
  try {
    const { data, error } = await adminClient()
      .from("vendors").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return ok(data ?? []);
  } catch (e) {
    return fail(e);
  }
}

async function setVendorStatus(vendorId: string, status: string): Promise<Result<null>> {
  try {
    const db = adminClient();
    const { error } = await db.from("vendors").update({ status }).eq("id", vendorId);
    if (error) throw error;
    // visibility depends on status — recompute
    await db.rpc("update_vendor_visibility", { p_vendor_id: vendorId });
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export const approveVendor = (id: string) => setVendorStatus(id, "Approved");
export const rejectVendor = (id: string) => setVendorStatus(id, "Rejected");
export const suspendVendor = (id: string) => setVendorStatus(id, "Suspended");

/** Approve a bad-lead report → restore 1 credit, flag the assignment. */
export async function approveBadLeadReport(reportId: string, decision?: string): Promise<Result<null>> {
  try {
    const db = adminClient();
    const { data: r, error } = await db
      .from("bad_lead_reports").select("id, vendor_id, lead_assignment_id, status").eq("id", reportId).single();
    if (error || !r) throw appError("UNKNOWN");
    if (r.status !== "Pending") return ok(null); // idempotent

    const { error: rpcErr } = await db.rpc("restore_vendor_credit", { p_vendor_id: r.vendor_id });
    if (rpcErr) throw rpcErr;

    await db.from("bad_lead_reports").update({
      status: "Approved", credit_restored: true, admin_decision: decision ?? "Credit restored.",
    }).eq("id", reportId);

    await db.from("lead_assignments").update({ is_bad_lead_reported: true }).eq("id", r.lead_assignment_id);
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function rejectBadLeadReport(reportId: string, decision?: string): Promise<Result<null>> {
  try {
    const { error } = await adminClient()
      .from("bad_lead_reports")
      .update({ status: "Rejected", admin_decision: decision ?? "Report rejected." })
      .eq("id", reportId);
    if (error) throw error;
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

/** Pending bad-lead reports with vendor + lead context for the review queue. */
export async function getPendingBadLeadReports(): Promise<Result<unknown[]>> {
  try {
    const { data, error } = await adminClient()
      .from("bad_lead_reports")
      .select(`
        id, created_at, reason, description, status,
        vendor:vendors ( business_name ),
        assignment:lead_assignments ( lead:leads ( name, service_required, city ) )
      `)
      .eq("status", "Pending")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ok(data ?? []);
  } catch (e) {
    return fail(e);
  }
}
