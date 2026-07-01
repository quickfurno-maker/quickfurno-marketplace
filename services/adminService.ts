// ============================================================================
// QuickFurno — services/adminService.ts
// Admin dashboard metrics, vendor moderation, bad-lead resolution.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { appError, type Result, ok, fail } from "../lib/errors";
import type { AdminDashboardStats } from "../lib/types";

const head = (q: any) => q.select("id", { count: "exact", head: true });

type AdminPackageInput = {
  name: string;
  lead_count: number;
  total_price: number;
  validity_days: number;
  is_active?: boolean;
};

type AdminNameInput = {
  name: string;
  is_active?: boolean;
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function startOfDay(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date = new Date()) {
  const next = startOfDay(date);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function safeDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sumNumbers<T>(rows: T[], mapper: (row: T) => unknown) {
  return rows.reduce((sum, row) => sum + Number(mapper(row) ?? 0), 0);
}

function topValue<T>(rows: T[], mapper: (row: T) => unknown) {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const value = String(mapper(row) ?? "").trim();
    if (!value) return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Not enough data";
}

async function bestEffortSelect(table: string, select = "*") {
  const { data, error } = await adminClient().from(table).select(select).order("created_at", { ascending: false });
  if (error) {
    console.warn(`[admin snapshot] ${table} unavailable`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}

async function recordAuditLog(action: string, entityType: string, entityId?: string, metadata: Record<string, unknown> = {}) {
  try {
    const { error } = await adminClient().from("audit_logs").insert({
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      metadata,
    });
    if (error) throw error;
  } catch (error) {
    console.info("[audit log] audit_logs table not available yet", {
      action,
      entityType,
      entityId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

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

export async function getSuperadminSnapshot(): Promise<Result<Record<string, unknown>>> {
  try {
    const db = adminClient();
    const warnings: string[] = [];

    async function safeSelect<T>(label: string, query: PromiseLike<{ data: T[] | null; error: any }>, fallback?: PromiseLike<{ data: T[] | null; error: any }>) {
      const result = await query;
      if (!result.error) return result.data ?? [];

      if (fallback) {
        const fallbackResult = await fallback;
        if (!fallbackResult.error) {
          warnings.push(`${label}: primary query unavailable; loaded fallback columns.`);
          return fallbackResult.data ?? [];
        }
        warnings.push(`${label}: ${fallbackResult.error.message}`);
        return [];
      }

      warnings.push(`${label}: ${result.error.message}`);
      return [];
    }

    const [
      leads,
      vendors,
      packages,
      payments,
      vendorPackages,
      vendorPackageOrders,
      assignments,
      categories,
      cities,
      badReports,
      settings,
      profiles,
      marketplaceSettings,
      freeVendorInterests,
      leadAssignmentQueue,
      autoAssignmentLogs,
    ] = await Promise.all([
      safeSelect("leads", db.from("leads").select("*, lead_assignments(id, vendor_id, vendor_status, assignment_type, assigned_at)").order("created_at", { ascending: false }), db.from("leads").select("*").order("created_at", { ascending: false })),
      safeSelect("vendors", db.from("vendors").select("*").order("created_at", { ascending: false })),
      safeSelect("packages", db.from("packages").select("*").order("lead_count", { ascending: true })),
      safeSelect("payments", db.from("payments").select("*").order("created_at", { ascending: false })),
      safeSelect("vendor_packages", db.from("vendor_packages").select("*").order("purchase_date", { ascending: false })),
      safeSelect("vendor_package_orders", db.from("vendor_package_orders").select("*").order("created_at", { ascending: false })),
      safeSelect("lead_assignments", db.from("lead_assignments").select("*").order("assigned_at", { ascending: false })),
      safeSelect("service_categories", db.from("service_categories").select("*").order("name", { ascending: true })),
      safeSelect("cities", db.from("cities").select("*").order("name", { ascending: true })),
      safeSelect("bad_lead_reports", db.from("bad_lead_reports").select("*").order("created_at", { ascending: false })),
      safeSelect("app_settings", db.from("app_settings").select("*").order("key", { ascending: true })),
      safeSelect("profiles", db.from("profiles").select("id, created_at, full_name, phone, role, is_active").order("created_at", { ascending: false })),
      safeSelect("marketplace_runtime_settings", db.from("marketplace_runtime_settings").select("*").order("key", { ascending: true })),
      safeSelect("free_vendor_profile_interests", db.from("free_vendor_profile_interests").select("*").order("created_at", { ascending: false })),
      safeSelect("lead_assignment_queue", db.from("lead_assignment_queue").select("*").order("created_at", { ascending: false })),
      safeSelect("lead_auto_assignment_logs", db.from("lead_auto_assignment_logs").select("*").order("created_at", { ascending: false })),
    ]);

    const leadRows = leads;
    const vendorRows = vendors;
    const packageRows = packages;
    const paymentRows = payments;
    const vendorPackageRows = vendorPackages;
    const vendorPackageOrderRows = vendorPackageOrders;
    const assignmentRows = assignments;
    const categoryRows = categories;
    const cityRows = cities;
    const badReportRows = badReports;
    const profileRows = profiles;

    const now = new Date();
    const today = startOfDay(now);
    const week = startOfWeek(now);
    const month = startOfMonth(now);
    const paidPayments = paymentRows.filter((payment: any) => payment.payment_status === "Paid");
    const monthPayments = paidPayments.filter((payment: any) => {
      const date = safeDate(payment.created_at);
      return date ? date >= month : false;
    });
    const assignedLeads = leadRows.filter((lead: any) =>
      ["Assigned", "Contacted", "Site Visit Scheduled", "Quotation Sent", "Converted", "Won"].includes(lead.status)
    );
    const convertedLeads = leadRows.filter((lead: any) => ["Converted", "Won"].includes(lead.status));
    const activeVendors = vendorRows.filter((vendor: any) => vendor.is_active && ["Approved", "Active"].includes(vendor.status));
    const paidVendorIds = new Set(vendorPackageRows.filter((row: any) => row.payment_status === "Paid" || row.status === "Active").map((row: any) => row.vendor_id));
    const expiredVendors = vendorRows.filter((vendor: any) => vendor.status === "Suspended" || vendor.remaining_credits <= 0);
    const pendingFollowUps = leadRows.filter((lead: any) => ["New", "Verified", "Assigned", "Contacted"].includes(lead.status)).length;

    const stats = {
      total_leads: leadRows.length,
      leads_today: leadRows.filter((lead: any) => {
        const date = safeDate(lead.created_at);
        return date ? date >= today : false;
      }).length,
      leads_this_week: leadRows.filter((lead: any) => {
        const date = safeDate(lead.created_at);
        return date ? date >= week : false;
      }).length,
      leads_this_month: leadRows.filter((lead: any) => {
        const date = safeDate(lead.created_at);
        return date ? date >= month : false;
      }).length,
      assigned_leads: assignedLeads.length,
      duplicate_leads: leadRows.filter((lead: any) => lead.is_duplicate || lead.status === "Duplicate").length,
      total_vendors: vendorRows.length,
      approved_vendors: vendorRows.filter((vendor: any) => vendor.status === "Approved").length,
      active_vendors: activeVendors.length,
      paid_vendors: paidVendorIds.size,
      pending_vendors: vendorRows.filter((vendor: any) => vendor.status === "Pending").length,
      expired_vendors: expiredVendors.length,
      total_revenue: sumNumbers(paidPayments, (payment: any) => payment.amount),
      revenue_this_month: sumNumbers(monthPayments, (payment: any) => payment.amount),
      pending_payments: paymentRows.filter((payment: any) => payment.payment_status === "Pending").length,
      low_balance_vendors: vendorRows.filter((vendor: any) => Number(vendor.remaining_credits ?? 0) <= 3).length,
      active_cities: cityRows.filter((city: any) => city.is_active).length,
      top_category: topValue(leadRows, (lead: any) => lead.service_required),
      top_city: topValue(leadRows, (lead: any) => lead.city),
      pending_followups: pendingFollowUps,
      conversion_rate: leadRows.length ? Math.round((convertedLeads.length / leadRows.length) * 100) : 0,
      lead_distribution_success_rate: leadRows.length ? Math.round((assignedLeads.length / leadRows.length) * 100) : 0,
      leads_distributed: assignmentRows.length,
      remaining_vendor_credits: sumNumbers(vendorRows, (vendor: any) => vendor.remaining_credits),
      bad_lead_reports_pending: badReportRows.filter((report: any) => report.status === "Pending").length,
    };

    return ok({
      stats,
      leads: leadRows,
      vendors: vendorRows,
      packages: packageRows,
      payments: paymentRows,
      vendorPackages: vendorPackageRows,
      vendorPackageOrders: vendorPackageOrderRows,
      assignments: assignmentRows,
      categories: categoryRows,
      cities: cityRows,
      badReports: badReportRows,
      settings,
      profiles: profileRows,
      marketplaceSettings,
      freeVendorInterests,
      leadAssignmentQueue,
      autoAssignmentLogs,
      generatedAt: new Date().toISOString(),
      warnings,
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
    await recordAuditLog("lead.status_updated", "lead", leadId, { status });
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
    await recordAuditLog("vendor.status_updated", "vendor", vendorId, { status });
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export const approveVendor = (id: string) => setVendorStatus(id, "Approved");
export const rejectVendor = (id: string) => setVendorStatus(id, "Rejected");
export const suspendVendor = (id: string) => setVendorStatus(id, "Suspended");

export async function createPackage(input: AdminPackageInput): Promise<Result<{ id: string }>> {
  try {
    const name = input.name?.trim();
    const leadCount = Number(input.lead_count);
    const totalPrice = Number(input.total_price);
    const validityDays = Number(input.validity_days);

    if (!name || !Number.isFinite(leadCount) || leadCount <= 0 || !Number.isFinite(totalPrice) || totalPrice < 0 || !Number.isFinite(validityDays) || validityDays <= 0) {
      throw appError("VALIDATION");
    }

    const { data, error } = await adminClient()
      .from("packages")
      .insert({
        name,
        lead_count: Math.round(leadCount),
        price_per_lead: Math.round((totalPrice / leadCount) * 100) / 100,
        total_price: totalPrice,
        display_price: totalPrice,
        validity_days: Math.round(validityDays),
        is_active: input.is_active ?? true,
      })
      .select("id")
      .single();
    if (error) throw error;
    await recordAuditLog("package.created", "package", data.id, { name, lead_count: leadCount, total_price: totalPrice });
    return ok({ id: data.id });
  } catch (e) {
    return fail(e);
  }
}

export async function setPackageActive(id: string, isActive: boolean): Promise<Result<null>> {
  try {
    const { error } = await adminClient().from("packages").update({ is_active: isActive }).eq("id", id);
    if (error) throw error;
    await recordAuditLog(isActive ? "package.enabled" : "package.disabled", "package", id);
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function createCategory(input: AdminNameInput): Promise<Result<{ id: string }>> {
  try {
    const name = input.name?.trim();
    if (!name) throw appError("VALIDATION");
    const { data, error } = await adminClient()
      .from("service_categories")
      .insert({ name, slug: slugify(name), is_active: input.is_active ?? true })
      .select("id")
      .single();
    if (error) throw error;
    await recordAuditLog("category.created", "service_category", data.id, { name });
    return ok({ id: data.id });
  } catch (e) {
    return fail(e);
  }
}

export async function setCategoryActive(id: string, isActive: boolean): Promise<Result<null>> {
  try {
    const { error } = await adminClient().from("service_categories").update({ is_active: isActive }).eq("id", id);
    if (error) throw error;
    await recordAuditLog(isActive ? "category.enabled" : "category.disabled", "service_category", id);
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function createCity(input: AdminNameInput): Promise<Result<{ id: string }>> {
  try {
    const name = input.name?.trim();
    if (!name) throw appError("VALIDATION");
    const { data, error } = await adminClient()
      .from("cities")
      .insert({ name, slug: slugify(name), is_active: input.is_active ?? true })
      .select("id")
      .single();
    if (error) throw error;
    await recordAuditLog("city.created", "city", data.id, { name });
    return ok({ id: data.id });
  } catch (e) {
    return fail(e);
  }
}

export async function setCityActive(id: string, isActive: boolean): Promise<Result<null>> {
  try {
    const { error } = await adminClient().from("cities").update({ is_active: isActive }).eq("id", id);
    if (error) throw error;
    await recordAuditLog(isActive ? "city.enabled" : "city.disabled", "city", id);
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

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
