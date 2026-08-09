// ============================================================================
// QuickFurno — services/adminDirectoryService.ts
// C-PERF1: bounded, server-paged admin reads.
//
// This module replaces the "broad snapshot" pattern for the highest-traffic
// admin surfaces. Every loader here:
//   * bounds the row read AT THE QUERY (20/page directories, ≤10 previews,
//     ≤50 thin aggregate samples) — never fetch-then-slice;
//   * pairs loaded rows with accurate count(head) totals;
//   * applies search/filters SERVER-SIDE over the full dataset;
//   * sanitizes user input before it reaches PostgREST filter grammar.
//
// READ-ONLY: nothing in this file mutates business state.
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

/** Statuses that close a lead — a closed lead is never "unassigned work". */
const CLOSED_LEAD_STATUSES = ["Converted", "Won", "Lost", "Duplicate", "Spam", "Invalid"];
const NOT_CLOSED_OR = `status.is.null,status.not.in.(${CLOSED_LEAD_STATUSES.join(",")})`;

/** Lead directory rows embed their assignments (needed by every consumer:
 *  assigned-count column, drawer timeline, CRM bucket derivation). The base
 *  row keeps select("*"): the drawer renders ~20 lead fields and the table is
 *  bounded to 20 rows, so a narrow projection would save little and risk
 *  silently dropping drawer fields. */
const LEAD_ROW_SELECT = "*, lead_assignments(id, vendor_id, vendor_status, assignment_type, assigned_at)";

/** Thin projection used ONLY for bounded aggregate samples (pipeline,
 *  distribution donuts, hot/unassigned sample KPIs). */
const LEAD_SAMPLE_SELECT =
  "id, status, city, source, service_required, category, is_duplicate, lead_quality_class, lead_priority, lead_quality_score, created_at, lead_assignments(id)";

/** Bounded thin sample size for dashboard aggregates. This is NOT a list —
 *  nothing renders 50 rows; the sample only feeds "latest 50"-labelled
 *  aggregate visuals, exactly like the previous 50-row snapshot did but with
 *  ~1/10th of the columns. */
const DASHBOARD_SAMPLE_SIZE = 50;

// ---------------------------------------------------------------------------
// P0-A — Dashboard-specific loader
// ---------------------------------------------------------------------------

export async function getAdminCommandCenterData(): Promise<Result<Row>> {
  try {
    const db = adminClient();

    const [{ stats, paidPaymentRowsAll }, recentLeads, leadSample, recentVendors, creditWatch, recentPayments, packages] =
      await Promise.all([
        collectAdminKpiStats(db),
        safeAggregateRows(
          "dashboard.recentLeads",
          db.from("leads").select(LEAD_ROW_SELECT).order("created_at", { ascending: false }).limit(ADMIN_EMBEDDED_PANEL_LIMIT),
        ),
        safeAggregateRows(
          "dashboard.leadSample",
          db.from("leads").select(LEAD_SAMPLE_SELECT).order("created_at", { ascending: false }).limit(DASHBOARD_SAMPLE_SIZE),
        ),
        safeAggregateRows(
          "dashboard.recentVendors",
          db.from("vendors").select("*").order("created_at", { ascending: false }).limit(4),
        ),
        // Lowest balances first: this IS the credit-watch list.
        safeAggregateRows(
          "dashboard.creditWatch",
          db.from("vendors").select("*").order("remaining_credits", { ascending: true, nullsFirst: false }).limit(5),
        ),
        safeAggregateRows(
          "dashboard.recentPayments",
          db.from("payments").select("id, amount, vendor_id, package_id, payment_status, created_at").order("created_at", { ascending: false }).limit(4),
        ),
        // Small config table — needed complete for package-name resolution.
        safeAggregateRows("dashboard.packages", db.from("packages").select("*").order("lead_count", { ascending: true })),
      ]);

    return ok({
      stats,
      generatedAt: new Date().toISOString(),
      meta: {
        sampleSize: leadSample.length,
        previewLimit: ADMIN_EMBEDDED_PANEL_LIMIT,
        totals: { total_leads: stats.total_leads, total_vendors: stats.total_vendors },
      },
      recentLeads,
      leadSample,
      vendors: recentVendors,
      creditWatch,
      payments: recentPayments,
      // Column-only projection over ALL paid payments (amount, created_at,
      // package_id) — powers truthful revenue-by-package over the full ledger.
      paidPayments: paidPaymentRowsAll,
      packages,
    });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// P0-B — Leads directory (server-paged)
// ---------------------------------------------------------------------------

export type AdminLeadsQuery = {
  page?: unknown;
  search?: string;
  city?: string;
  category?: string;
  status?: string;
  source?: string;
  /** Filters the STORED leads.lead_priority value (server-side). Blank stored
   *  priorities do not match — this is a real-field filter, not the derived
   *  display label. */
  priority?: string;
};

function applyLeadFilters(q: any, query: AdminLeadsQuery) {
  const search = sanitizeSearchTerm(query.search);
  if (search) {
    q = q.or(
      ["name", "phone", "city", "service_required", "category", "status", "source"]
        .map((column) => `${column}.ilike.*${search}*`)
        .join(","),
    );
  }
  const city = sanitizeFilterValue(query.city);
  if (city && city !== "All") q = q.eq("city", city);

  const category = sanitizeFilterValue(query.category);
  if (category && category !== "All") q = q.or(`service_required.eq."${category}",category.eq."${category}"`);

  const status = sanitizeFilterValue(query.status);
  if (status && status !== "All") q = q.eq("status", status);

  const source = sanitizeFilterValue(query.source);
  if (source && source !== "All") {
    // Legacy rows may carry a null source; the UI has always presented those
    // as "Website", so the Website filter must include them.
    q = source === "Website" ? q.or("source.is.null,source.eq.Website") : q.eq("source", source);
  }

  const priority = sanitizeFilterValue(query.priority);
  if (priority && priority !== "All") q = q.ilike("lead_priority", priority);

  return q;
}

/** Server-side mirror of the UI's isHotLead() heuristic, expressed over the
 *  authoritative stored fields only. */
const HOT_LEAD_OR =
  "lead_priority.ilike.*hot*,lead_priority.ilike.*high*,lead_quality_score.gte.70,status.ilike.*interested*,status.ilike.*quotation*";

/** Count of open leads with zero vendor assignments, evaluated in the
 *  database via a left-join null filter. Returns null (not 0) when the
 *  embedded filter is unavailable so callers can HIDE the figure instead of
 *  displaying a false zero. */
async function countUnassignedLeads(db: any): Promise<number | null> {
  try {
    const { count, error } = await db
      .from("leads")
      .select("id, lead_assignments!left(id)", { count: "exact", head: true })
      .is("lead_assignments", null)
      .or(NOT_CLOSED_OR);
    if (error) {
      console.warn("[admin directory] unassigned count unavailable", { message: error.message });
      return null;
    }
    return count ?? 0;
  } catch {
    return null;
  }
}

export async function getAdminLeadsDirectory(query: AdminLeadsQuery): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const page = boundPage(query.page);
    const { from, to } = pageRange(page);

    const [rowsRes, filteredCount, totalAll, hotCount, unassignedCount, cities, categories] = await Promise.all([
      applyLeadFilters(db.from("leads").select(LEAD_ROW_SELECT), query)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
      safeCount("leads.filtered", applyLeadFilters(head(db.from("leads")), query)),
      safeCount("leads.all", head(db.from("leads"))),
      safeCount("leads.hot", head(db.from("leads")).or(HOT_LEAD_OR)),
      countUnassignedLeads(db),
      // Reference vocabularies (source of truth per Phase 14B/14C) — small
      // config tables, names only.
      safeAggregateRows("cities.active", db.from("cities").select("name").eq("is_active", true).order("name", { ascending: true })),
      safeAggregateRows("categories.active", db.from("service_categories").select("name").eq("is_active", true).order("name", { ascending: true })),
    ]);

    if (rowsRes.error) throw rowsRes.error;

    const result: DirectoryPage<Row> = {
      rows: rowsRes.data ?? [],
      page,
      pageSize: ADMIN_DIRECTORY_PAGE_SIZE,
      total: filteredCount,
    };

    // Bounded bad-lead review block: the latest ≤10 reports plus ONLY the
    // comments / assignments / vendors / leads those reports reference.
    const badReports = await safeAggregateRows(
      "leads.badReports",
      db.from("bad_lead_reports").select("*").order("created_at", { ascending: false }).limit(ADMIN_EMBEDDED_PANEL_LIMIT),
    );
    const reportIds = badReports.map((r) => String(r.id)).filter(Boolean);
    const assignmentIds = [...new Set(badReports.map((r) => String(r.lead_assignment_id ?? "")).filter(Boolean))];
    const reportVendorIds = [...new Set(badReports.map((r) => String(r.vendor_id ?? "")).filter(Boolean))];

    const [badLeadReportComments, reportAssignments] = await Promise.all([
      reportIds.length
        ? safeAggregateRows(
            "leads.badReportComments",
            db.from("bad_lead_report_comments").select("*").in("report_id", reportIds).order("created_at", { ascending: true }).limit(60),
          )
        : Promise.resolve([]),
      assignmentIds.length
        ? safeAggregateRows("leads.reportAssignments", db.from("lead_assignments").select("*").in("id", assignmentIds))
        : Promise.resolve([]),
    ]);

    const reportLeadIds = [...new Set(reportAssignments.map((a) => String(a.lead_id ?? "")).filter(Boolean))];
    const [reportVendors, reportLeads] = await Promise.all([
      reportVendorIds.length
        ? safeAggregateRows("leads.reportVendors", db.from("vendors").select("id, business_name, city, status").in("id", reportVendorIds))
        : Promise.resolve([]),
      reportLeadIds.length
        ? safeAggregateRows("leads.reportLeads", db.from("leads").select("id, name, phone, city, service_required, category, status").in("id", reportLeadIds))
        : Promise.resolve([]),
    ]);

    return ok({
      result,
      totals: { all: totalAll, hot: hotCount, unassigned: unassignedCount },
      filterOptions: {
        cities: cities.map((c) => String(c.name ?? "")).filter(Boolean),
        categories: categories.map((c) => String(c.name ?? "")).filter(Boolean),
      },
      badLeadReview: {
        badReports,
        badLeadReportComments,
        assignments: reportAssignments,
        vendors: reportVendors,
        leads: reportLeads,
      },
    });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// P0-C — Lead CRM Inbox (server-paged)
// ---------------------------------------------------------------------------

export type CrmInboxQuery = {
  page?: unknown;
  search?: string;
  city?: string;
  service?: string;
  source?: string;
  /** Stored quality classification (lead_quality_class) — real field. */
  quality?: string;
  intent?: string;
  quick?: string;
};

function applyCrmInboxFilters(q: any, query: CrmInboxQuery) {
  const search = sanitizeSearchTerm(query.search);
  if (search) {
    q = q.or(
      ["name", "phone", "city", "service_required", "category", "status", "source"]
        .map((column) => `${column}.ilike.*${search}*`)
        .join(","),
    );
  }
  const city = sanitizeFilterValue(query.city);
  if (city && city !== "All") q = q.eq("city", city);

  const service = sanitizeFilterValue(query.service);
  if (service && service !== "All") q = q.or(`service_required.eq."${service}",category.eq."${service}"`);

  const source = sanitizeFilterValue(query.source);
  if (source && source !== "All") {
    q = source === "Website" ? q.or("source.is.null,source.eq.Website") : q.eq("source", source);
  }

  // Quality filter over the STORED classification. "Unclassified" means no
  // stored class — the derived display priority may still label such rows.
  const quality = sanitizeFilterValue(query.quality);
  if (quality && quality !== "All") {
    if (quality === "Unclassified") q = q.is("lead_quality_class", null);
    else q = q.eq("lead_quality_class", quality);
  }

  const intent = sanitizeFilterValue(query.intent);
  if (intent === "Preferred vendor") q = q.eq("lead_intent", "preferred_vendor");
  else if (intent === "General auto-match") q = q.or("lead_intent.is.null,lead_intent.neq.preferred_vendor");

  // Quick filters — each maps to authoritative stored fields. The bucket-based
  // ones mirror statusBucket()'s status patterns.
  const quick = sanitizeFilterValue(query.quick);
  switch (quick) {
    case "new_today": {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      q = q.gte("created_at", today.toISOString());
      break;
    }
    case "hot":
      q = q.in("lead_quality_class", ["A+", "A"]);
      break;
    case "unassigned":
      q = q.is("lead_assignments", null).or(NOT_CLOSED_OR).or("is_duplicate.is.null,is_duplicate.eq.false");
      break;
    case "assigned":
      q = q.not("lead_assignments", "is", null);
      break;
    case "vendor_selected":
      q = q.eq("lead_intent", "preferred_vendor");
      break;
    case "site_visit":
      q = q.ilike("status", "*site*");
      break;
    case "won":
      q = q.or("status.ilike.*won*,status.ilike.*convert*");
      break;
    case "lost":
      q = q.ilike("status", "*lost*");
      break;
    case "spam_dup":
      q = q.or(
        "is_duplicate.eq.true,lead_quality_class.eq.D,status.ilike.*spam*,status.ilike.*bad*,status.ilike.*invalid*,status.ilike.*junk*,status.ilike.*duplicate*",
      );
      break;
    default:
      break;
  }
  return q;
}

/** CRM Inbox needs a left-joined embed so unassigned/assigned quick filters
 *  can be evaluated in the database. */
const CRM_ROW_SELECT = "*, lead_assignments!left(id, vendor_id, vendor_status, assignment_type, assigned_at)";

export async function getCrmInboxPage(query: CrmInboxQuery): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const page = boundPage(query.page);
    const { from, to } = pageRange(page);

    const [rowsRes, total] = await Promise.all([
      applyCrmInboxFilters(db.from("leads").select(CRM_ROW_SELECT), query)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
      safeCount("crm.inbox.filtered", applyCrmInboxFilters(db.from("leads").select("id, lead_assignments!left(id)", { count: "exact", head: true }), query)),
    ]);

    if (rowsRes.error) throw rowsRes.error;
    const leads = rowsRes.data ?? [];

    // Related clarification state for THIS PAGE's leads only.
    const leadIds = leads.map((lead: Row) => String(lead.id)).filter(Boolean);
    const clarifications = leadIds.length
      ? await safeAggregateRows(
          "crm.inbox.clarifications",
          db
            .from("lead_clarification_requests")
            .select("*")
            .in("lead_id", leadIds)
            .order("created_at", { ascending: false })
            .limit(60),
        )
      : [];

    const result: DirectoryPage<Row> = { rows: leads, page, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total };
    return ok({ result, clarifications });
  } catch (e) {
    return fail(e);
  }
}

/** On-demand drawer context for ONE lead — replaces the old pattern of
 *  eagerly shipping 100-row global log tables to the browser. Also resolves
 *  the vendor identities referenced by this lead's assignments (bounded IN
 *  lookup — never a full vendor directory fetch, never N+1). */
export async function getAdminLeadContext(leadId: string): Promise<Result<Row>> {
  try {
    const id = sanitizeFilterValue(leadId);
    if (!id) return ok({ deliveryLogs: [], notificationLogs: [], vendors: [] });
    const db = adminClient();
    const [deliveryLogs, notificationLogs, assignments] = await Promise.all([
      safeAggregateRows(
        "lead.context.delivery",
        db.from("lead_delivery_logs").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(ADMIN_DIRECTORY_PAGE_SIZE),
      ),
      safeAggregateRows(
        "lead.context.notifications",
        db.from("client_notification_logs").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(ADMIN_DIRECTORY_PAGE_SIZE),
      ),
      safeAggregateRows(
        "lead.context.assignments",
        db.from("lead_assignments").select("vendor_id").eq("lead_id", id).limit(ADMIN_DIRECTORY_PAGE_SIZE),
      ),
    ]);
    const vendorIds = [
      ...new Set([
        ...assignments.map((a) => String(a.vendor_id ?? "")),
        ...deliveryLogs.map((l) => String(l.vendor_id ?? "")),
      ].filter(Boolean)),
    ];
    const vendors = vendorIds.length
      ? await safeAggregateRows(
          "lead.context.vendors",
          db.from("vendors").select("id, business_name, city, status").in("id", vendorIds),
        )
      : [];
    return ok({ deliveryLogs, notificationLogs, vendors });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// P0-D — Vendors directory (server-paged)
// ---------------------------------------------------------------------------

export type AdminVendorsQuery = {
  page?: unknown;
  search?: string;
  city?: string;
  category?: string;
  status?: string;
  /** Filters the STORED vendors.package_status value (server-side). */
  packageStatus?: string;
};

function applyVendorFilters(q: any, query: AdminVendorsQuery) {
  const search = sanitizeSearchTerm(query.search);
  if (search) {
    q = q.or(
      ["business_name", "owner_name", "phone", "city", "status"]
        .map((column) => `${column}.ilike.*${search}*`)
        .join(","),
    );
  }
  const city = sanitizeFilterValue(query.city);
  if (city && city !== "All") q = q.eq("city", city);

  const category = sanitizeFilterValue(query.category);
  if (category && category !== "All") q = q.contains("service_categories", [category]);

  const status = sanitizeFilterValue(query.status);
  if (status && status !== "All") q = q.eq("status", status);

  const packageStatus = sanitizeFilterValue(query.packageStatus).toLowerCase();
  if (packageStatus && packageStatus !== "all") {
    // The UI normalizes a blank stored package_status to "none".
    if (packageStatus === "none") q = q.is("package_status", null);
    else q = q.ilike("package_status", packageStatus);
  }
  return q;
}

export async function getAdminVendorsDirectory(query: AdminVendorsQuery): Promise<Result<Row>> {
  try {
    const db = adminClient();
    const page = boundPage(query.page);
    const { from, to } = pageRange(page);

    const [rowsRes, filteredCount, totalAll, approvedCount, pendingCount, lowBalanceCount, cities, categories, marketplaceSettings, profileChangeRequests, supportThreads] =
      await Promise.all([
        applyVendorFilters(db.from("vendors").select("*"), query)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
        safeCount("vendors.filtered", applyVendorFilters(head(db.from("vendors")), query)),
        safeCount("vendors.all", head(db.from("vendors"))),
        safeCount("vendors.approved", head(db.from("vendors")).eq("status", "Approved")),
        safeCount("vendors.pending", head(db.from("vendors")).eq("status", "Pending")),
        safeCount("vendors.lowbalance", head(db.from("vendors")).lte("remaining_credits", 3)),
        safeAggregateRows("cities.active", db.from("cities").select("name").eq("is_active", true).order("name", { ascending: true })),
        safeAggregateRows("categories.active", db.from("service_categories").select("name").eq("is_active", true).order("name", { ascending: true })),
        safeAggregateRows("marketplace.settings", db.from("marketplace_runtime_settings").select("*").order("key", { ascending: true })),
        // Embedded moderation panels — pending/open work only, ≤10 each.
        safeAggregateRows(
          "vendors.profileChanges",
          db.from("vendor_profile_change_requests").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(ADMIN_EMBEDDED_PANEL_LIMIT),
        ),
        safeAggregateRows(
          "vendors.supportThreads",
          db.from("vendor_support_threads").select("*").neq("status", "closed").order("updated_at", { ascending: false }).limit(ADMIN_EMBEDDED_PANEL_LIMIT),
        ),
      ]);

    if (rowsRes.error) throw rowsRes.error;

    // Messages only for the ≤10 open threads shown (bounded), plus thin
    // vendor-name rows for the moderation panels — the vendors referenced by
    // requests/threads are usually NOT on the current directory page.
    const threadIds = supportThreads.map((t) => String(t.id)).filter(Boolean);
    const panelVendorIds = [
      ...new Set(
        [...profileChangeRequests, ...supportThreads].map((row) => String(row.vendor_id ?? "")).filter(Boolean),
      ),
    ];
    const [supportMessages, panelVendors] = await Promise.all([
      threadIds.length
        ? safeAggregateRows(
            "vendors.supportMessages",
            db.from("vendor_support_messages").select("*").in("thread_id", threadIds).order("created_at", { ascending: true }).limit(100),
          )
        : Promise.resolve([]),
      panelVendorIds.length
        ? safeAggregateRows("vendors.panelVendors", db.from("vendors").select("id, business_name, city, status").in("id", panelVendorIds))
        : Promise.resolve([]),
    ]);

    const result: DirectoryPage<Row> = {
      rows: rowsRes.data ?? [],
      page,
      pageSize: ADMIN_DIRECTORY_PAGE_SIZE,
      total: filteredCount,
    };

    return ok({
      result,
      totals: { all: totalAll, approved: approvedCount, pending: pendingCount, lowBalance: lowBalanceCount },
      filterOptions: {
        cities: cities.map((c) => String(c.name ?? "")).filter(Boolean),
        categories: categories.map((c) => String(c.name ?? "")).filter(Boolean),
      },
      marketplaceSettings,
      profileChangeRequests,
      supportThreads,
      supportMessages,
      panelVendors,
    });
  } catch (e) {
    return fail(e);
  }
}
