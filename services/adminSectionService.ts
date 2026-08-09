// ============================================================================
// QuickFurno — services/adminSectionService.ts
// C-PERF2: section-scoped admin loaders.
//
// Every remaining Admin V2 route gets ONLY the data it renders — the broad
// every-table snapshot is no longer called by any normal Admin V2 route.
// All loaders follow the locked policy (lib/adminPaging.ts):
//   * 20 rows/page for full directories, ≤10 for embedded panels;
//   * count(head) totals independent of loaded rows;
//   * related lookups via IN(current-page ids) — never full-directory fetches
//     and never per-row N+1 queries;
//   * bounded "latest N" samples only where server grouping is impractical,
//     always labelled by the consuming UI.
//
// READ-ONLY: nothing here mutates business state.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { type Result, ok, fail } from "../lib/errors";
import {
  ADMIN_DIRECTORY_PAGE_SIZE,
  ADMIN_EMBEDDED_PANEL_LIMIT,
  boundPage,
  pageRange,
  sanitizeFilterValue,
  sanitizeSearchTerm,
  type DirectoryPage,
} from "../lib/adminPaging";
import { collectAdminKpiStats, safeAggregateRows, safeCount } from "./adminService";

type Row = Record<string, any>;

const head = (q: any) => q.select("id", { count: "exact", head: true });

/** Thin identity rows for related-name resolution (IN current-page ids). */
async function vendorIdentities(db: any, ids: string[]): Promise<Row[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  return safeAggregateRows(
    "section.vendorIdentities",
    db.from("vendors").select("id, business_name, city, status").in("id", unique),
  );
}

async function leadIdentities(db: any, ids: string[]): Promise<Row[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  return safeAggregateRows(
    "section.leadIdentities",
    db.from("leads").select("id, name, phone, city, service_required, category, status, created_at").in("id", unique),
  );
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export type AdminPaymentsQuery = { page?: unknown; status?: string; search?: string };

function applyPaymentFilters(q: any, query: AdminPaymentsQuery) {
  const status = sanitizeFilterValue(query.status);
  if (status && status !== "All") q = q.eq("payment_status", status);
  const search = sanitizeSearchTerm(query.search);
  if (search) q = q.or(["transaction_id", "payment_method"].map((c) => `${c}.ilike.*${search}*`).join(","));
  return q;
}

export async function getAdminPaymentsPage(query: AdminPaymentsQuery): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const page = boundPage(query.page);
    const { from, to } = pageRange(page);

    const [rowsRes, filteredCount, paidCount, pendingCount, expiredVendors, paidAgg, packages] = await Promise.all([
      applyPaymentFilters(db.from("payments").select("*"), query)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
      safeCount("payments.filtered", applyPaymentFilters(head(db.from("payments")), query)),
      safeCount("payments.paid", head(db.from("payments")).eq("payment_status", "Paid")),
      safeCount("payments.pending", head(db.from("payments")).eq("payment_status", "Pending")),
      safeCount("vendors.expired", head(db.from("vendors")).or("status.eq.Suspended,remaining_credits.lte.0")),
      // Accurate revenue: column-only projection over ALL paid payments.
      safeAggregateRows("payments.paidAgg", db.from("payments").select("amount, created_at").eq("payment_status", "Paid")),
      safeAggregateRows("packages.all", db.from("packages").select("id, name")),
    ]);
    if (rowsRes.error) throw rowsRes.error;

    const rows = rowsRes.data ?? [];
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const totalRevenue = paidAgg.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
    const revenueThisMonth = paidAgg
      .filter((r) => { const d = new Date(r.created_at ?? 0); return !Number.isNaN(d.getTime()) && d >= monthStart; })
      .reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

    const result: DirectoryPage<Row> = { rows, page, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total: filteredCount };
    const vendors = await vendorIdentities(db, rows.map((r: Row) => String(r.vendor_id ?? "")));

    return ok({
      result,
      totals: { totalRevenue, revenueThisMonth, paidCount, pendingCount, expiredVendors },
      vendors,
      packages,
    });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Vendor Subscriptions (two paged tables)
// ---------------------------------------------------------------------------

export type AdminSubscriptionsQuery = { page?: unknown; ordersPage?: unknown };

export async function getAdminSubscriptionsPage(query: AdminSubscriptionsQuery): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const subs = pageRange(boundPage(query.page));
    const orders = pageRange(boundPage(query.ordersPage));

    const [subsRes, subsCount, ordersRes, ordersCount, lowBalance, expiredVendors, notActivated, packages] = await Promise.all([
      db.from("vendor_packages").select("*").order("purchase_date", { ascending: false }).order("id", { ascending: true }).range(subs.from, subs.to),
      safeCount("subs.total", head(db.from("vendor_packages"))),
      db.from("vendor_package_orders").select("*").order("created_at", { ascending: false }).order("id", { ascending: true }).range(orders.from, orders.to),
      safeCount("orders.total", head(db.from("vendor_package_orders"))),
      safeCount("vendors.lowbalance", head(db.from("vendors")).lte("remaining_credits", 3)),
      safeCount("vendors.expired", head(db.from("vendors")).or("status.eq.Suspended,remaining_credits.lte.0")),
      safeCount("orders.notActivated", head(db.from("vendor_package_orders")).or("activation_status.is.null,activation_status.neq.activated")),
      safeAggregateRows("packages.all", db.from("packages").select("id, name")),
    ]);
    if (subsRes.error) throw subsRes.error;
    if (ordersRes.error) throw ordersRes.error;

    const subRows = subsRes.data ?? [];
    const orderRows = ordersRes.data ?? [];
    const vendors = await vendorIdentities(db, [
      ...subRows.map((r: Row) => String(r.vendor_id ?? "")),
      ...orderRows.map((r: Row) => String(r.vendor_id ?? "")),
    ]);

    return ok({
      subscriptions: { rows: subRows, page: boundPage(query.page), pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total: subsCount },
      orders: { rows: orderRows, page: boundPage(query.ordersPage), pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total: ordersCount },
      totals: { lowBalance, expiredVendors, notActivated },
      vendors,
      packages,
    });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Config sections: Packages / Categories / Cities / Settings
// ---------------------------------------------------------------------------

export async function getAdminPackagesPage(): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const [packages, paidAgg] = await Promise.all([
      // Small config table: complete read is required (cards + management).
      safeAggregateRows("packages.all", db.from("packages").select("*").order("lead_count", { ascending: true })),
      safeAggregateRows("payments.paidAgg", db.from("payments").select("amount").eq("payment_status", "Paid")),
    ]);
    const totalRevenue = paidAgg.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
    return ok({ packages, totalRevenue });
  } catch (e) {
    return fail(e);
  }
}

export async function getAdminCategoriesPage(): Promise<Result<Row>> {
  try {
    const db = adminClient();
    // Complete config read: the category manager renders the parent/child
    // hierarchy, which requires the full (small) reference set.
    const categories = await safeAggregateRows(
      "categories.all",
      db.from("service_categories").select("*").order("name", { ascending: true }),
    );
    return ok({ categories });
  } catch (e) {
    return fail(e);
  }
}

export async function getAdminCitiesPage(): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const cities = await safeAggregateRows("cities.all", db.from("cities").select("*").order("name", { ascending: true }));
    return ok({ cities });
  } catch (e) {
    return fail(e);
  }
}

export async function getAdminSettingsPage(): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const [settings, marketplaceSettings] = await Promise.all([
      safeAggregateRows("settings.app", db.from("app_settings").select("*").order("key", { ascending: true })),
      safeAggregateRows("settings.marketplace", db.from("marketplace_runtime_settings").select("*").order("key", { ascending: true })),
    ]);
    return ok({ settings, marketplaceSettings });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Notifications (derived alerts — no notifications table exists yet)
// ---------------------------------------------------------------------------

export async function getAdminNotificationsPage(): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const [recentLeads, lowCreditVendors] = await Promise.all([
      safeAggregateRows(
        "notifications.leads",
        db.from("leads").select("id, name, created_at").order("created_at", { ascending: false }).limit(ADMIN_EMBEDDED_PANEL_LIMIT),
      ),
      safeAggregateRows(
        "notifications.vendors",
        db.from("vendors").select("id, business_name, remaining_credits, created_at").lte("remaining_credits", 3).order("created_at", { ascending: false }).limit(ADMIN_EMBEDDED_PANEL_LIMIT),
      ),
    ]);
    return ok({ recentLeads, lowCreditVendors });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Admin Users
// ---------------------------------------------------------------------------

export async function getAdminUsersPage(query: { page?: unknown }): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const page = boundPage(query.page);
    const { from, to } = pageRange(page);
    const [rowsRes, total] = await Promise.all([
      db.from("profiles")
        .select("id, created_at, full_name, role, is_active")
        .eq("role", "admin")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
      safeCount("profiles.admin", head(db.from("profiles")).eq("role", "admin")),
    ]);
    if (rowsRes.error) throw rowsRes.error;
    return ok({ result: { rows: rowsRes.data ?? [], page, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total } });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Audit Logs (real bounded viewer over audit_logs)
// ---------------------------------------------------------------------------

export type AdminAuditLogsQuery = { page?: unknown; search?: string };

export async function getAdminAuditLogsPage(query: AdminAuditLogsQuery): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const page = boundPage(query.page);
    const { from, to } = pageRange(page);
    const search = sanitizeSearchTerm(query.search);

    let rowsQ = db.from("audit_logs").select("id, created_at, action, entity_type, entity_id");
    let countQ = head(db.from("audit_logs"));
    if (search) {
      const or = ["action", "entity_type", "entity_id"].map((c) => `${c}.ilike.*${search}*`).join(",");
      rowsQ = rowsQ.or(or);
      countQ = countQ.or(or);
    }
    const [rowsRes, total] = await Promise.all([
      rowsQ.order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to),
      safeCount("audit.total", countQ),
    ]);
    if (rowsRes.error) {
      // Table may not exist yet on this environment — honest empty state.
      return ok({ result: { rows: [], page: 1, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total: 0 }, unavailable: true });
    }
    return ok({ result: { rows: rowsRes.data ?? [], page, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total }, unavailable: false });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Reports + Analytics (narrow contracts)
// ---------------------------------------------------------------------------

/** Thin latest-N lead sample used by report/analytics breakdowns — always
 *  labelled "latest N" by the consuming UI. */
const ANALYTICS_SAMPLE_SIZE = 50;
const ANALYTICS_LEAD_COLUMNS =
  "id, status, city, locality, area, source, utm_source, service_required, category, is_duplicate, lead_quality_class, lead_priority, lead_quality_score, lead_intent, created_at, follow_up_date, lead_assignments(id, vendor_id)";

export async function getAdminReportsPage(): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const leadSample = await safeAggregateRows(
      "reports.leadSample",
      db.from("leads").select("id, status, city, source, service_required, category").order("created_at", { ascending: false }).limit(ANALYTICS_SAMPLE_SIZE),
    );
    return ok({ leadSample });
  } catch (e) {
    return fail(e);
  }
}

export async function getAdminAnalyticsPage(): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const [{ stats }, leads, vendors, assignmentAgg] = await Promise.all([
      collectAdminKpiStats(db),
      safeAggregateRows(
        "analytics.leads",
        db.from("leads").select(ANALYTICS_LEAD_COLUMNS).order("created_at", { ascending: false }).limit(ANALYTICS_SAMPLE_SIZE),
      ),
      safeAggregateRows(
        "analytics.vendors",
        db.from("vendors").select("id, business_name, owner_name, city, status, is_active, remaining_credits, service_categories, areas_covered, created_at").order("created_at", { ascending: false }).limit(ANALYTICS_SAMPLE_SIZE),
      ),
      // Column-only projection (two ids per row) for assigned-lead counts.
      safeAggregateRows(
        "analytics.assignments",
        db.from("lead_assignments").select("vendor_id, lead_id").order("assigned_at", { ascending: false }).limit(500),
      ),
    ]);
    return ok({ stats, leads, vendors, assignments: assignmentAgg });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// CRM base + active-tab loaders
// ---------------------------------------------------------------------------

export async function getAdminCrmBase(): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const [cities, categories] = await Promise.all([
      safeAggregateRows("crm.cities", db.from("cities").select("id, name, is_active").order("name", { ascending: true })),
      safeAggregateRows("crm.categories", db.from("service_categories").select("id, name, is_active, parent_id").order("name", { ascending: true })),
    ]);
    return ok({ cities, categories });
  } catch (e) {
    return fail(e);
  }
}

export type CrmTabKey =
  | "overview"
  | "pipeline"
  | "followups"
  | "queue"
  | "vendor_activity"
  | "sources"
  | "nurture";

/** statusBucket()'s status patterns expressed as server conditions. */
const BUCKET_OR: Record<string, string> = {
  won: "status.ilike.*won*,status.ilike.*convert*",
  lost: "status.ilike.*lost*",
  quotation: "status.ilike.*quotation*",
  site_visit: "status.ilike.*site*",
  contacted: "status.ilike.*contact*",
  spam_dup:
    "is_duplicate.eq.true,lead_quality_class.eq.D,status.ilike.*spam*,status.ilike.*bad*,status.ilike.*invalid*,status.ilike.*junk*,status.ilike.*duplicate*",
};

const CRM_TAB_ROW_SELECT = "*, lead_assignments!left(id, vendor_id, vendor_status, assignment_type, assigned_at)";

function endOfTodayIso(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}
function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getCrmTabData(tab: CrmTabKey, pageInput?: unknown): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const page = boundPage(pageInput);
    const { from, to } = pageRange(page);

    if (tab === "overview") {
      // Real database-wide counts, mirroring the Inbox quick-filter semantics.
      const [total, newToday, hot, unassigned, assigned, vendorSelected, followUps, siteVisit, won, lost, spamDup] =
        await Promise.all([
          safeCount("crm.total", head(db.from("leads"))),
          safeCount("crm.newToday", head(db.from("leads")).gte("created_at", startOfTodayIso())),
          safeCount("crm.hot", head(db.from("leads")).in("lead_quality_class", ["A+", "A"])),
          (async () => {
            try {
              const { count, error } = await db
                .from("leads")
                .select("id, lead_assignments!left(id)", { count: "exact", head: true })
                .is("lead_assignments", null)
                .or("status.is.null,status.not.in.(Converted,Won,Lost,Duplicate,Spam,Invalid)");
              return error ? null : count ?? 0;
            } catch { return null; }
          })(),
          (async () => {
            try {
              const { count, error } = await db
                .from("leads")
                .select("id, lead_assignments!left(id)", { count: "exact", head: true })
                .not("lead_assignments", "is", null);
              return error ? null : count ?? 0;
            } catch { return null; }
          })(),
          safeCount("crm.vendorSelected", head(db.from("leads")).eq("lead_intent", "preferred_vendor")),
          safeCount("crm.followups", head(db.from("leads")).not("follow_up_date", "is", null).lte("follow_up_date", endOfTodayIso())),
          safeCount("crm.siteVisit", head(db.from("leads")).ilike("status", "*site*")),
          safeCount("crm.won", head(db.from("leads")).or(BUCKET_OR.won)),
          safeCount("crm.lost", head(db.from("leads")).or(BUCKET_OR.lost)),
          safeCount("crm.spamDup", head(db.from("leads")).or(BUCKET_OR.spam_dup)),
        ]);
      return ok({ counts: { total, newToday, hot, unassigned, assigned, vendorSelected, followUps, siteVisit, won, lost, spamDup } });
    }

    if (tab === "pipeline") {
      // Real per-stage counts + a labelled latest-N sample for the lane cards.
      const [contacted, siteVisit, quotation, won, lost, spamDup, total, sample] = await Promise.all([
        safeCount("pipe.contacted", head(db.from("leads")).or(BUCKET_OR.contacted)),
        safeCount("pipe.site", head(db.from("leads")).or(BUCKET_OR.site_visit)),
        safeCount("pipe.quotation", head(db.from("leads")).or(BUCKET_OR.quotation)),
        safeCount("pipe.won", head(db.from("leads")).or(BUCKET_OR.won)),
        safeCount("pipe.lost", head(db.from("leads")).or(BUCKET_OR.lost)),
        safeCount("pipe.spamDup", head(db.from("leads")).or(BUCKET_OR.spam_dup)),
        safeCount("pipe.total", head(db.from("leads"))),
        safeAggregateRows(
          "pipe.sample",
          db.from("leads").select(CRM_TAB_ROW_SELECT).order("created_at", { ascending: false }).limit(ANALYTICS_SAMPLE_SIZE),
        ),
      ]);
      return ok({ stageCounts: { contacted, site_visit: siteVisit, quotation, won, lost, spam: spamDup, total }, sample });
    }

    if (tab === "followups") {
      const nowStart = startOfTodayIso();
      const nowEnd = endOfTodayIso();
      const groupLimit = ADMIN_DIRECTORY_PAGE_SIZE;
      const [overdueRes, todayRes, upcomingRes, overdueCount, todayCount, upcomingCount, unscheduledCount] = await Promise.all([
        db.from("leads").select(CRM_TAB_ROW_SELECT).not("follow_up_date", "is", null).lt("follow_up_date", nowStart).order("follow_up_date", { ascending: true }).limit(groupLimit),
        db.from("leads").select(CRM_TAB_ROW_SELECT).gte("follow_up_date", nowStart).lte("follow_up_date", nowEnd).order("follow_up_date", { ascending: true }).limit(groupLimit),
        db.from("leads").select(CRM_TAB_ROW_SELECT).gt("follow_up_date", nowEnd).order("follow_up_date", { ascending: true }).limit(groupLimit),
        safeCount("fu.overdue", head(db.from("leads")).not("follow_up_date", "is", null).lt("follow_up_date", nowStart)),
        safeCount("fu.today", head(db.from("leads")).gte("follow_up_date", nowStart).lte("follow_up_date", nowEnd)),
        safeCount("fu.upcoming", head(db.from("leads")).gt("follow_up_date", nowEnd)),
        safeCount("fu.unscheduled", head(db.from("leads")).is("follow_up_date", null)),
      ]);
      return ok({
        overdue: overdueRes.data ?? [],
        today: todayRes.data ?? [],
        upcoming: upcomingRes.data ?? [],
        counts: { overdue: overdueCount, today: todayCount, upcoming: upcomingCount, unscheduled: unscheduledCount },
        groupLimit,
      });
    }

    if (tab === "queue") {
      const [rowsRes, total, active, dueNow] = await Promise.all([
        db.from("lead_assignment_queue").select("*").order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to),
        safeCount("queue.total", head(db.from("lead_assignment_queue"))),
        safeCount("queue.active", head(db.from("lead_assignment_queue")).neq("queue_status", "resolved")),
        safeCount("queue.due", head(db.from("lead_assignment_queue")).neq("queue_status", "resolved").lte("next_retry_at", new Date().toISOString())),
      ]);
      if (rowsRes.error) throw rowsRes.error;
      return ok({ result: { rows: rowsRes.data ?? [], page, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total }, counts: { total, active, resolved: Math.max(0, total - active), dueNow } });
    }

    if (tab === "vendor_activity") {
      const [logsRes, logsTotal, statusAgg, contactShared, creditDeducted] = await Promise.all([
        db.from("lead_delivery_logs").select("*").order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to),
        safeCount("activity.logs", head(db.from("lead_delivery_logs"))),
        // Column-only projection: vendor progress distribution over all
        // assignments (single small column, bounded defensively).
        safeAggregateRows("activity.status", db.from("lead_assignments").select("vendor_status").limit(2000)),
        safeCount("activity.contact", head(db.from("lead_delivery_logs")).eq("contact_shared", true)),
        safeCount("activity.credit", head(db.from("lead_delivery_logs")).eq("credit_deducted", true)),
      ]);
      if (logsRes.error) throw logsRes.error;
      const rows = logsRes.data ?? [];
      const vendors = await vendorIdentities(db, rows.map((r: Row) => String(r.vendor_id ?? "")));
      return ok({
        result: { rows, page, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total: logsTotal },
        progressAgg: statusAgg,
        counts: { logsTotal, contactShared, creditDeducted },
        vendors,
      });
    }

    if (tab === "sources") {
      const sample = await safeAggregateRows(
        "sources.sample",
        db.from("leads").select(ANALYTICS_LEAD_COLUMNS).order("created_at", { ascending: false }).limit(ANALYTICS_SAMPLE_SIZE),
      );
      return ok({ sample });
    }

    // nurture
    const [rowsRes, total] = await Promise.all([
      db.from("leads").select(CRM_TAB_ROW_SELECT).ilike("status", "*nurture*").order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to),
      safeCount("nurture.total", head(db.from("leads")).ilike("status", "*nurture*")),
    ]);
    if (rowsRes.error) throw rowsRes.error;
    return ok({ result: { rows: rowsRes.data ?? [], page, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total } });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Lead Distribution — active-tab loaders
// ---------------------------------------------------------------------------

export type DistributionTabKey =
  | "queue"
  | "manual"
  | "matching-audit"
  | "delivery"
  | "preview-messages"
  | "approval"
  | "eligibility";

/** Open leads with zero assignments (bounded). Falls back to [] if the
 *  embedded-null filter is unavailable in this environment. */
async function openUnassignedLeads(db: any, limit: number): Promise<Row[]> {
  try {
    const { data, error } = await db
      .from("leads")
      .select("*, lead_assignments!left(id, vendor_id, vendor_status, assignment_type, assigned_at)")
      .is("lead_assignments", null)
      .or("status.is.null,status.not.in.(Converted,Won,Lost,Duplicate,Spam,Invalid)")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("[distribution] unassigned lead query unavailable", { message: error.message });
      return [];
    }
    return data ?? [];
  } catch {
    return [];
  }
}

export async function getLeadDistributionTab(tab: DistributionTabKey, pageInput?: unknown): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const page = boundPage(pageInput);
    const { from, to } = pageRange(page);

    if (tab === "queue") {
      const [queueRes, queueTotal, matchedPreview, autoLogs, autoLogsTotal, freeInterests, freeInterestsTotal, unassigned] =
        await Promise.all([
          db.from("lead_assignment_queue").select("*").order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to),
          safeCount("dist.queue", head(db.from("lead_assignment_queue"))),
          safeCount("dist.matched", head(db.from("lead_assignment_queue")).eq("queue_status", "matched_preview")),
          safeAggregateRows("dist.autoLogs", db.from("lead_auto_assignment_logs").select("*").order("created_at", { ascending: false }).limit(ADMIN_EMBEDDED_PANEL_LIMIT)),
          safeCount("dist.autoLogs.total", head(db.from("lead_auto_assignment_logs"))),
          safeAggregateRows("dist.interests", db.from("free_vendor_profile_interests").select("*").order("created_at", { ascending: false }).limit(ADMIN_EMBEDDED_PANEL_LIMIT)),
          safeCount("dist.interests.total", head(db.from("free_vendor_profile_interests"))),
          openUnassignedLeads(db, 8),
        ]);
      if (queueRes.error) throw queueRes.error;
      const queueRows = queueRes.data ?? [];
      const suggestedCount = await safeCount("dist.suggested", head(db.from("lead_auto_assignment_logs")).eq("status", "auto_suggested"));

      const leadIds = [
        ...queueRows.map((r: Row) => String(r.lead_id ?? "")),
        ...autoLogs.map((r: Row) => String(r.lead_id ?? "")),
      ];
      const vendorIds = [
        ...queueRows.flatMap((r: Row) => (Array.isArray(r.selected_vendor_ids) ? r.selected_vendor_ids.map(String) : [])),
        ...autoLogs.flatMap((r: Row) => (Array.isArray(r.selected_vendor_ids) ? r.selected_vendor_ids.map(String) : [])),
        ...freeInterests.map((r: Row) => String(r.vendor_id ?? "")),
      ];
      const [leads, vendors] = await Promise.all([leadIdentities(db, leadIds), vendorIdentities(db, vendorIds)]);

      return ok({
        queue: { rows: queueRows, page, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total: queueTotal },
        counts: { queueTotal, matchedPreview, suggestedCount, autoLogsTotal, freeInterestsTotal },
        autoLogs,
        freeInterests,
        unassignedLeads: unassigned,
        leads,
        vendors,
      });
    }

    if (tab === "manual") {
      // Bounded working set: latest open unassigned + latest matching runs for
      // topping-up context. The panel labels this as a bounded working set.
      const [workingLeads, matchingRuns] = await Promise.all([
        openUnassignedLeads(db, ADMIN_DIRECTORY_PAGE_SIZE),
        safeAggregateRows("manual.runs", db.from("lead_matching_runs").select("*").order("created_at", { ascending: false }).limit(60)),
      ]);
      return ok({ leads: workingLeads, matchingRuns });
    }

    if (tab === "matching-audit") {
      const [runsRes, total] = await Promise.all([
        db.from("lead_matching_runs").select("*").order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to),
        safeCount("audit.runs", head(db.from("lead_matching_runs"))),
      ]);
      if (runsRes.error) throw runsRes.error;
      const rows = runsRes.data ?? [];
      const [leads, vendors] = await Promise.all([
        leadIdentities(db, rows.map((r: Row) => String(r.lead_id ?? ""))),
        vendorIdentities(db, rows.flatMap((r: Row) => (Array.isArray(r.selected_vendor_ids) ? r.selected_vendor_ids.map(String) : []))),
      ]);
      return ok({ result: { rows, page, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total }, leads, vendors });
    }

    if (tab === "delivery") {
      const [logsRes, total] = await Promise.all([
        db.from("lead_delivery_logs").select("*").order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to),
        safeCount("audit.delivery", head(db.from("lead_delivery_logs"))),
      ]);
      if (logsRes.error) throw logsRes.error;
      const rows = logsRes.data ?? [];
      const [leads, vendors] = await Promise.all([
        leadIdentities(db, rows.map((r: Row) => String(r.lead_id ?? ""))),
        vendorIdentities(db, rows.map((r: Row) => String(r.vendor_id ?? ""))),
      ]);
      return ok({ result: { rows, page, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total }, leads, vendors });
    }

    if (tab === "preview-messages") {
      const [clientLogs, clientTotal, vendorPrevRes, vendorPrevTotal] = await Promise.all([
        safeAggregateRows("preview.client", db.from("client_notification_logs").select("*").order("created_at", { ascending: false }).limit(ADMIN_DIRECTORY_PAGE_SIZE)),
        safeCount("preview.client.total", head(db.from("client_notification_logs"))),
        db.from("lead_delivery_logs").select("*").eq("delivery_channel", "whatsapp_preview").order("created_at", { ascending: false }).limit(ADMIN_DIRECTORY_PAGE_SIZE),
        safeCount("preview.vendor.total", head(db.from("lead_delivery_logs")).eq("delivery_channel", "whatsapp_preview")),
      ]);
      const vendorPreviewLogs = vendorPrevRes.error ? [] : vendorPrevRes.data ?? [];
      const leadIds = [
        ...clientLogs.map((r: Row) => String(r.lead_id ?? "")),
        ...vendorPreviewLogs.map((r: Row) => String(r.lead_id ?? "")),
      ];
      const vendorIds = vendorPreviewLogs.map((r: Row) => String(r.vendor_id ?? ""));
      const [leads, vendors] = await Promise.all([leadIdentities(db, leadIds), vendorIdentities(db, vendorIds)]);
      return ok({ clientLogs, vendorPreviewLogs, totals: { clientTotal, vendorPrevTotal }, leads, vendors });
    }

    if (tab === "approval") {
      // Selector working set: latest open unassigned leads, bounded + labelled.
      const leads = await openUnassignedLeads(db, ADMIN_DIRECTORY_PAGE_SIZE);
      return ok({ leads });
    }

    // eligibility — reference vocabularies only; vendors are fetched per city.
    const [cities, categories] = await Promise.all([
      safeAggregateRows("elig.cities", db.from("cities").select("id, name, is_active").order("name", { ascending: true })),
      safeAggregateRows("elig.categories", db.from("service_categories").select("id, name, is_active, parent_id").order("name", { ascending: true })),
    ]);
    return ok({ cities, categories });
  } catch (e) {
    return fail(e);
  }
}

/** Vendors in one city for the eligibility checker — bounded and counted. */
export async function getVendorsForEligibility(cityInput: string): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const city = sanitizeFilterValue(cityInput);
    if (!city) return ok({ vendors: [], total: 0 });
    const [rowsRes, total] = await Promise.all([
      db.from("vendors").select("*").ilike("city", city).order("created_at", { ascending: false }).limit(50),
      safeCount("elig.vendors", head(db.from("vendors")).ilike("city", city)),
    ]);
    if (rowsRes.error) throw rowsRes.error;
    return ok({ vendors: rowsRes.data ?? [], total });
  } catch (e) {
    return fail(e);
  }
}
