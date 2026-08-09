// ============================================================================
// QuickFurno — services/adminService.ts
// Admin dashboard metrics, vendor moderation, bad-lead resolution.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { appError, type Result, ok, fail, isMissingRelationError } from "../lib/errors";
import type { AdminDashboardStats } from "../lib/types";

const head = (q: any) => q.select("id", { count: "exact", head: true });

// ── Admin snapshot row limits ──────────────────────────────────────────────
// The shared admin snapshot powers /admin/dashboard, /admin/crm and every
// /admin/[section] page. It returns only the LATEST rows per table so page load
// stays fast as leads/vendors/logs grow. Accurate KPI totals do NOT come from
// these limited arrays — they come from separate count(head) + tiny aggregate
// queries in getSuperadminSnapshot.
// TODO(pagination): move CRM + admin lists to server-side pagination + filters.
// This phase intentionally uses "latest N rows + accurate aggregate counts".
const DEFAULT_ADMIN_ROW_LIMIT = 50;
const LOG_ROW_LIMIT = 100;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const LARGE_LOG_ROW_LIMIT = 200; // reserved for future high-volume log views

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

// Count-only (head) query wrapper. Never throws: returns 0 if the table /
// filter is unavailable. Counts are accurate and independent of any row
// limits applied to loaded arrays.
export async function safeCount(label: string, query: PromiseLike<{ count: number | null; error: any }>): Promise<number> {
  try {
    const { count, error } = await query;
    if (error) {
      if (!isMissingRelationError(error)) console.warn(`[admin] count ${label} failed`, { message: error.message });
      return 0;
    }
    return count ?? 0;
  } catch {
    return 0;
  }
}

// Tiny column-only projection (no row limit) used only for accurate sums /
// distinct counts (e.g. amount, remaining_credits, vendor_id). Returns [] on
// error so KPI totals degrade gracefully.
export async function safeAggregateRows(label: string, query: PromiseLike<{ data: Array<Record<string, any>> | null; error: any }>): Promise<Array<Record<string, any>>> {
  try {
    const { data, error } = await query;
    if (error) {
      if (!isMissingRelationError(error)) console.warn(`[admin] aggregate ${label} failed`, { message: error.message });
      return [];
    }
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * C-PERF1: the accurate KPI block shared by the legacy snapshot AND the new
 * dashboard-specific loader. Every number here is a server-side count(head)
 * or a narrow column-only aggregate — none of them depend on any limited
 * row array, so they stay truthful at any database size.
 */
export async function collectAdminKpiStats(db: ReturnType<typeof adminClient>) {
  const now = new Date();
  const month = startOfMonth(now);
  const todayIso = startOfDay(now).toISOString();
  const weekIso = startOfWeek(now).toISOString();
  const monthIso = month.toISOString();

  const ASSIGNED_STATUSES = ["Assigned", "Contacted", "Site Visit Scheduled", "Quotation Sent", "Converted", "Won"];
  const FOLLOWUP_STATUSES = ["New", "Verified", "Assigned", "Contacted"];

  const [
    cTotalLeads, cLeadsToday, cLeadsWeek, cLeadsMonth,
    cAssignedLeads, cConvertedLeads, cDuplicateLeads, cPendingFollowups,
    cTotalVendors, cApprovedVendors, cActiveVendors, cPendingVendors,
    cLowBalanceVendors, cExpiredVendors, cPendingPayments, cBadReportsPending, cLeadsDistributed,
    cActiveCities,
  ] = await Promise.all([
    safeCount("leads.total", head(db.from("leads"))),
    safeCount("leads.today", head(db.from("leads")).gte("created_at", todayIso)),
    safeCount("leads.week", head(db.from("leads")).gte("created_at", weekIso)),
    safeCount("leads.month", head(db.from("leads")).gte("created_at", monthIso)),
    safeCount("leads.assigned", head(db.from("leads")).in("status", ASSIGNED_STATUSES)),
    safeCount("leads.converted", head(db.from("leads")).in("status", ["Converted", "Won"])),
    safeCount("leads.duplicate", head(db.from("leads")).or("is_duplicate.eq.true,status.eq.Duplicate")),
    safeCount("leads.followups", head(db.from("leads")).in("status", FOLLOWUP_STATUSES)),
    safeCount("vendors.total", head(db.from("vendors"))),
    safeCount("vendors.approved", head(db.from("vendors")).eq("status", "Approved")),
    safeCount("vendors.active", head(db.from("vendors")).eq("is_active", true).in("status", ["Approved", "Active"])),
    safeCount("vendors.pending", head(db.from("vendors")).eq("status", "Pending")),
    safeCount("vendors.lowbalance", head(db.from("vendors")).lte("remaining_credits", 3)),
    safeCount("vendors.expired", head(db.from("vendors")).or("status.eq.Suspended,remaining_credits.lte.0")),
    safeCount("payments.pending", head(db.from("payments")).eq("payment_status", "Pending")),
    safeCount("badreports.pending", head(db.from("bad_lead_reports")).eq("status", "Pending")),
    safeCount("assignments.total", head(db.from("lead_assignments"))),
    safeCount("cities.active", head(db.from("cities")).eq("is_active", true)),
  ]);

  const [paidPaymentRowsAll, vendorCreditRowsAll, paidPackageVendorRows] = await Promise.all([
    safeAggregateRows("payments.paid", db.from("payments").select("amount, created_at, package_id, payment_status").eq("payment_status", "Paid")),
    safeAggregateRows("vendors.credits", db.from("vendors").select("remaining_credits")),
    safeAggregateRows("vendor_packages.paid", db.from("vendor_packages").select("vendor_id").or("payment_status.eq.Paid,status.eq.Active")),
  ]);

  const totalRevenue = sumNumbers(paidPaymentRowsAll, (p) => p.amount);
  const revenueThisMonth = sumNumbers(
    paidPaymentRowsAll.filter((p) => { const d = safeDate(p.created_at); return d ? d >= month : false; }),
    (p) => p.amount,
  );
  const remainingVendorCredits = sumNumbers(vendorCreditRowsAll, (v) => v.remaining_credits);
  const paidVendors = new Set(paidPackageVendorRows.map((r) => r.vendor_id).filter(Boolean)).size;

  const stats = {
    total_leads: cTotalLeads,
    leads_today: cLeadsToday,
    leads_this_week: cLeadsWeek,
    leads_this_month: cLeadsMonth,
    assigned_leads: cAssignedLeads,
    duplicate_leads: cDuplicateLeads,
    total_vendors: cTotalVendors,
    approved_vendors: cApprovedVendors,
    active_vendors: cActiveVendors,
    paid_vendors: paidVendors,
    pending_vendors: cPendingVendors,
    expired_vendors: cExpiredVendors,
    total_revenue: totalRevenue,
    revenue_this_month: revenueThisMonth,
    pending_payments: cPendingPayments,
    low_balance_vendors: cLowBalanceVendors,
    active_cities: cActiveCities,
    pending_followups: cPendingFollowups,
    conversion_rate: cTotalLeads ? Math.round((cConvertedLeads / cTotalLeads) * 100) : 0,
    lead_distribution_success_rate: cTotalLeads ? Math.round((cAssignedLeads / cTotalLeads) * 100) : 0,
    leads_distributed: cLeadsDistributed,
    remaining_vendor_credits: remainingVendorCredits,
    bad_lead_reports_pending: cBadReportsPending,
  };

  return { stats, paidPaymentRowsAll };
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

    // A missing relation means an optional table's migration has not been
    // applied yet. That is expected, not an error, so we log it server-side and
    // return an empty set WITHOUT pushing a scary admin-facing warning.
    function noteUnavailable(label: string, error: { code?: string; message?: string }) {
      if (isMissingRelationError(error)) {
        console.info(`[admin snapshot] ${label} not available yet (relation missing); using empty set.`, { code: error.code });
        return;
      }
      warnings.push(`${label}: ${error.message}`);
    }

    async function safeSelect<T>(label: string, query: PromiseLike<{ data: T[] | null; error: any }>, fallback?: PromiseLike<{ data: T[] | null; error: any }>) {
      const result = await query;
      if (!result.error) return result.data ?? [];

      if (fallback) {
        const fallbackResult = await fallback;
        if (!fallbackResult.error) {
          warnings.push(`${label}: primary query unavailable; loaded fallback columns.`);
          return fallbackResult.data ?? [];
        }
        noteUnavailable(label, fallbackResult.error);
        return [];
      }

      noteUnavailable(label, result.error);
      return [];
    }

    const [
      leads,
      vendors,
      packages,
      payments,
      vendorPackages,
      vendorPackageOrders,
      vendorProfileChangeRequests,
      vendorNotifications,
      vendorSupportThreads,
      vendorSupportMessages,
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
      leadMatchingRuns,
      leadDeliveryLogs,
      clientNotificationLogs,
      leadClarificationRequests,
      badLeadReportComments,
    ] = await Promise.all([
      // Leads: latest N only (primary embeds each lead's assignments; fallback
      // drops the embed). Accurate lead totals come from count queries below.
      safeSelect("leads", db.from("leads").select("*, lead_assignments(id, vendor_id, vendor_status, assignment_type, assigned_at)").order("created_at", { ascending: false }).limit(DEFAULT_ADMIN_ROW_LIMIT), db.from("leads").select("*").order("created_at", { ascending: false }).limit(DEFAULT_ADMIN_ROW_LIMIT)),
      safeSelect("vendors", db.from("vendors").select("*").order("created_at", { ascending: false }).limit(DEFAULT_ADMIN_ROW_LIMIT)),
      // packages / categories / cities / settings are small config tables — unlimited.
      safeSelect("packages", db.from("packages").select("*").order("lead_count", { ascending: true })),
      safeSelect("payments", db.from("payments").select("*").order("created_at", { ascending: false }).limit(DEFAULT_ADMIN_ROW_LIMIT)),
      safeSelect("vendor_packages", db.from("vendor_packages").select("*").order("purchase_date", { ascending: false }).limit(DEFAULT_ADMIN_ROW_LIMIT)),
      safeSelect("vendor_package_orders", db.from("vendor_package_orders").select("*").order("created_at", { ascending: false }).limit(DEFAULT_ADMIN_ROW_LIMIT)),
      safeSelect("vendor_profile_change_requests", db.from("vendor_profile_change_requests").select("*").order("created_at", { ascending: false }).limit(DEFAULT_ADMIN_ROW_LIMIT)),
      safeSelect("vendor_notifications", db.from("vendor_notifications").select("*").order("created_at", { ascending: false }).limit(DEFAULT_ADMIN_ROW_LIMIT)),
      safeSelect("vendor_support_threads", db.from("vendor_support_threads").select("*").order("updated_at", { ascending: false }).limit(DEFAULT_ADMIN_ROW_LIMIT)),
      safeSelect("vendor_support_messages", db.from("vendor_support_messages").select("*").order("created_at", { ascending: false }).limit(LOG_ROW_LIMIT)),
      safeSelect("lead_assignments", db.from("lead_assignments").select("*").order("assigned_at", { ascending: false }).limit(LOG_ROW_LIMIT)),
      safeSelect("service_categories", db.from("service_categories").select("*").order("name", { ascending: true })),
      safeSelect("cities", db.from("cities").select("*").order("name", { ascending: true })),
      safeSelect("bad_lead_reports", db.from("bad_lead_reports").select("*").order("created_at", { ascending: false }).limit(DEFAULT_ADMIN_ROW_LIMIT)),
      safeSelect("app_settings", db.from("app_settings").select("*").order("key", { ascending: true })),
      safeSelect("profiles", db.from("profiles").select("id, created_at, full_name, phone, role, is_active").order("created_at", { ascending: false }).limit(DEFAULT_ADMIN_ROW_LIMIT)),
      safeSelect("marketplace_runtime_settings", db.from("marketplace_runtime_settings").select("*").order("key", { ascending: true })),
      safeSelect("free_vendor_profile_interests", db.from("free_vendor_profile_interests").select("*").order("created_at", { ascending: false }).limit(DEFAULT_ADMIN_ROW_LIMIT)),
      safeSelect("lead_assignment_queue", db.from("lead_assignment_queue").select("*").order("created_at", { ascending: false }).limit(DEFAULT_ADMIN_ROW_LIMIT)),
      safeSelect("lead_auto_assignment_logs", db.from("lead_auto_assignment_logs").select("*").order("created_at", { ascending: false }).limit(LOG_ROW_LIMIT)),
      safeSelect("lead_matching_runs", db.from("lead_matching_runs").select("*").order("created_at", { ascending: false }).limit(LOG_ROW_LIMIT)),
      safeSelect("lead_delivery_logs", db.from("lead_delivery_logs").select("*").order("created_at", { ascending: false }).limit(LOG_ROW_LIMIT)),
      safeSelect("client_notification_logs", db.from("client_notification_logs").select("*").order("created_at", { ascending: false }).limit(LOG_ROW_LIMIT)),
      safeSelect("lead_clarification_requests", db.from("lead_clarification_requests").select("*").order("created_at", { ascending: false }).limit(LOG_ROW_LIMIT)),
      safeSelect("bad_lead_report_comments", db.from("bad_lead_report_comments").select("*").order("created_at", { ascending: true }).limit(LOG_ROW_LIMIT)),
    ]);

    const leadRows = leads;
    const vendorRows = vendors;
    const packageRows = packages;
    const paymentRows = payments;
    const vendorPackageRows = vendorPackages;
    const vendorPackageOrderRows = vendorPackageOrders;
    const vendorProfileChangeRequestRows = vendorProfileChangeRequests;
    const vendorNotificationRows = vendorNotifications;
    const vendorSupportThreadRows = vendorSupportThreads;
    const vendorSupportMessageRows = vendorSupportMessages;
    const assignmentRows = assignments;
    const categoryRows = categories;
    const cityRows = cities;
    const badReportRows = badReports;
    const profileRows = profiles;

    // ── Accurate KPI totals (shared collector; count/aggregate queries) ──────
    const { stats: kpiStats } = await collectAdminKpiStats(db);
    const stats = {
      ...kpiStats,
      // top_category / top_city are a display hint derived from the latest limited
      // leads (NOT a KPI total) — documented as approximate.
      top_category: topValue(leadRows, (lead: any) => lead.service_required),
      top_city: topValue(leadRows, (lead: any) => lead.city),
    };

    const snapshotMeta = {
      generatedAt: new Date().toISOString(),
      leadsLimit: DEFAULT_ADMIN_ROW_LIMIT,
      vendorsLimit: DEFAULT_ADMIN_ROW_LIMIT,
      logsLimit: LOG_ROW_LIMIT,
      totals: { total_leads: stats.total_leads, total_vendors: stats.total_vendors },
      rowsLoaded: {
        leads: leadRows.length,
        vendors: vendorRows.length,
        payments: paymentRows.length,
        lead_assignments: assignmentRows.length,
        lead_assignment_queue: (leadAssignmentQueue as any[]).length,
        lead_auto_assignment_logs: (autoAssignmentLogs as any[]).length,
        lead_matching_runs: (leadMatchingRuns as any[]).length,
        lead_delivery_logs: (leadDeliveryLogs as any[]).length,
        client_notification_logs: (clientNotificationLogs as any[]).length,
        lead_clarification_requests: (leadClarificationRequests as any[]).length,
        free_vendor_profile_interests: (freeVendorInterests as any[]).length,
        bad_lead_reports: badReportRows.length,
      },
    };

    return ok({
      stats,
      snapshotMeta,
      leads: leadRows,
      vendors: vendorRows,
      packages: packageRows,
      payments: paymentRows,
      vendorPackages: vendorPackageRows,
      vendorPackageOrders: vendorPackageOrderRows,
      vendorProfileChangeRequests: vendorProfileChangeRequestRows,
      vendorNotifications: vendorNotificationRows,
      vendorSupportThreads: vendorSupportThreadRows,
      vendorSupportMessages: vendorSupportMessageRows,
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
      leadMatchingRuns,
      leadDeliveryLogs,
      clientNotificationLogs,
      leadClarificationRequests,
      badLeadReportComments,
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

/** Approve a bad-lead report. MVP does not auto-refund credits; any refund is a separate manual admin action. */
export async function approveBadLeadReport(reportId: string, decision?: string): Promise<Result<null>> {
  try {
    const db = adminClient();
    const { data: r, error } = await db
      .from("bad_lead_reports").select("id, vendor_id, lead_assignment_id, status").eq("id", reportId).single();
    if (error || !r) throw appError("UNKNOWN");
    if (r.status !== "Pending") return ok(null); // idempotent

    await db.from("bad_lead_reports").update({
      status: "Approved",
      credit_restored: false,
      admin_decision: decision ?? "Approved after admin review. Credit was not refunded automatically.",
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
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
      .update({
        status: "Rejected",
        admin_decision: decision ?? "Report rejected.",
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
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
