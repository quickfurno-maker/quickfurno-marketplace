// ============================================================================
// QuickFurno — services/adminAuditService.ts
// Phase 26A-2: read-mostly admin audit layer for lead matching, delivery,
// preview messages, bad-lead report review, and package-order auditing.
//
// Safety rules enforced here:
//   - No credit refunds, goodwill credits, or extra deductions — review
//     actions only update status/notes/comments.
//   - No WhatsApp sends. Preview logs are read as-is.
//   - Package orders are read-only (audit), never approved/rejected.
// Server-only: uses adminClient via guarded server actions.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { appError, fail, isMissingRelationError, ok, type Result } from "../lib/errors";

export const BAD_LEAD_REVIEW_STATUSES = [
  "Under Review",
  "Valid",
  "Invalid",
  "Resolved",
  "Rejected",
] as const;

export type BadLeadReviewStatus = (typeof BAD_LEAD_REVIEW_STATUSES)[number];

export type LeadMatchingAuditDetails = {
  lead: Record<string, unknown> | null;
  runs: Array<Record<string, unknown>>;
  deliveryLogs: Array<Record<string, unknown>>;
  clientNotifications: Array<Record<string, unknown>>;
  assignments: Array<Record<string, unknown>>;
};

const DEFAULT_LIST_LIMIT = 100;

function clampLimit(limit?: number) {
  const value = Number(limit ?? DEFAULT_LIST_LIMIT);
  if (!Number.isFinite(value)) return DEFAULT_LIST_LIMIT;
  return Math.min(500, Math.max(1, Math.round(value)));
}

/** Latest matching runs with safe lead context for the audit table. */
export async function listLeadMatchingRuns(limit?: number): Promise<Result<Array<Record<string, unknown>>>> {
  try {
    const { data, error } = await adminClient()
      .from("lead_matching_runs")
      .select("*, lead:leads(id, name, city, area, service_required, category, status)")
      .order("created_at", { ascending: false })
      .limit(clampLimit(limit));
    if (error) throw error;
    return ok((data ?? []) as Array<Record<string, unknown>>);
  } catch (e) {
    return fail(e);
  }
}

/** Delivery + WhatsApp-preview log rows with lead/vendor names. */
export async function listLeadDeliveryLogs(limit?: number): Promise<Result<Array<Record<string, unknown>>>> {
  try {
    const { data, error } = await adminClient()
      .from("lead_delivery_logs")
      .select("*, lead:leads(id, name, city, service_required), vendor:vendors(id, business_name)")
      .order("created_at", { ascending: false })
      .limit(clampLimit(limit));
    if (error) throw error;
    return ok((data ?? []) as Array<Record<string, unknown>>);
  } catch (e) {
    return fail(e);
  }
}

/** Client-facing preview notification logs (assigned-vendors / waiting). */
export async function listClientNotificationLogs(limit?: number): Promise<Result<Array<Record<string, unknown>>>> {
  try {
    const { data, error } = await adminClient()
      .from("client_notification_logs")
      .select("*, lead:leads(id, name, city, service_required)")
      .order("created_at", { ascending: false })
      .limit(clampLimit(limit));
    if (error) throw error;
    return ok((data ?? []) as Array<Record<string, unknown>>);
  } catch (e) {
    return fail(e);
  }
}

/** Everything the admin needs to audit one lead's matching end to end. */
export async function getLeadMatchingAuditDetails(leadId: string): Promise<Result<LeadMatchingAuditDetails>> {
  try {
    if (!leadId?.trim()) throw appError("VALIDATION");
    const db = adminClient();
    const [lead, runs, deliveryLogs, clientNotifications, assignments] = await Promise.all([
      db.from("leads").select("id, name, phone, city, area, service_required, category, subcategory, budget, timeline, status, share_consent, is_duplicate, created_at").eq("id", leadId).maybeSingle(),
      db.from("lead_matching_runs").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
      db.from("lead_delivery_logs").select("*, vendor:vendors(id, business_name)").eq("lead_id", leadId).order("created_at", { ascending: false }),
      db.from("client_notification_logs").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
      db.from("lead_assignments").select("*, vendor:vendors(id, business_name)").eq("lead_id", leadId).order("assigned_at", { ascending: false }),
    ]);
    if (lead.error) throw lead.error;
    if (runs.error) throw runs.error;
    if (deliveryLogs.error) throw deliveryLogs.error;
    if (clientNotifications.error) throw clientNotifications.error;
    if (assignments.error) throw assignments.error;

    return ok({
      lead: (lead.data as Record<string, unknown> | null) ?? null,
      runs: (runs.data ?? []) as Array<Record<string, unknown>>,
      deliveryLogs: (deliveryLogs.data ?? []) as Array<Record<string, unknown>>,
      clientNotifications: (clientNotifications.data ?? []) as Array<Record<string, unknown>>,
      assignments: (assignments.data ?? []) as Array<Record<string, unknown>>,
    });
  } catch (e) {
    return fail(e);
  }
}

/** Bad-lead reports with vendor/lead context and their comment trail. */
export async function listVendorLeadReports(limit?: number): Promise<Result<Array<Record<string, unknown>>>> {
  try {
    const db = adminClient();
    const { data, error } = await db
      .from("bad_lead_reports")
      .select("*, vendor:vendors(id, business_name), assignment:lead_assignments(id, lead_id, credit_deducted, lead:leads(id, name, city, service_required))")
      .order("created_at", { ascending: false })
      .limit(clampLimit(limit));
    if (error) throw error;

    const reports = (data ?? []) as Array<Record<string, unknown>>;
    const reportIds = reports.map((report) => String(report.id)).filter(Boolean);
    let commentsByReport = new Map<string, Array<Record<string, unknown>>>();
    if (reportIds.length > 0) {
      const { data: comments, error: commentsError } = await db
        .from("bad_lead_report_comments")
        .select("*")
        .in("report_id", reportIds)
        .order("created_at", { ascending: true });
      if (commentsError) {
        // Pre-migration-029 databases have no comments table; degrade gracefully.
        console.warn("[admin audit] bad_lead_report_comments unavailable", { code: commentsError.code, message: commentsError.message });
      } else {
        commentsByReport = (comments ?? []).reduce((map, comment: Record<string, unknown>) => {
          const key = String(comment.report_id ?? "");
          const list = map.get(key) ?? [];
          list.push(comment);
          map.set(key, list);
          return map;
        }, new Map<string, Array<Record<string, unknown>>>());
      }
    }

    return ok(reports.map((report) => ({
      ...report,
      comments: commentsByReport.get(String(report.id)) ?? [],
    })));
  } catch (e) {
    return fail(e);
  }
}

/**
 * Review-only status update. Never touches credits: no refund, no goodwill
 * credit, no extra deduction. Records reviewer + notes for the audit trail.
 */
export async function updateVendorLeadReportStatus(
  reportId: string,
  input: { status: string; adminNotes?: string | null },
  reviewedBy: string,
): Promise<Result<null>> {
  try {
    if (!reportId?.trim()) throw appError("VALIDATION");
    const status = BAD_LEAD_REVIEW_STATUSES.find((allowed) => allowed === input.status?.trim());
    if (!status) throw appError("VALIDATION");

    const update: Record<string, unknown> = {
      status,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const notes = input.adminNotes?.trim();
    if (notes) update.admin_notes = notes;

    const db = adminClient();
    const { data: report, error } = await db
      .from("bad_lead_reports")
      .update(update)
      .eq("id", reportId)
      .select("id, lead_assignment_id")
      .single();
    if (error) throw error;

    // Parity with the legacy approve flow: a Valid report flags the assignment
    // for reporting. Informational only — no credit is refunded.
    if (status === "Valid" && report?.lead_assignment_id) {
      await db.from("lead_assignments").update({ is_bad_lead_reported: true }).eq("id", report.lead_assignment_id);
    }
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

/** Append an admin comment to a report's audit trail. */
export async function addVendorLeadReportComment(
  reportId: string,
  comment: string,
  senderId: string,
  isInternal = false,
): Promise<Result<{ id: string }>> {
  try {
    const text = comment?.trim();
    if (!reportId?.trim() || !text) throw appError("VALIDATION");

    const { data, error } = await adminClient()
      .from("bad_lead_report_comments")
      .insert({
        report_id: reportId,
        sender_type: "admin",
        sender_id: senderId,
        comment: text,
        is_internal: isInternal,
      })
      .select("id")
      .single();
    if (error) throw error;
    return ok({ id: String(data.id) });
  } catch (e) {
    return fail(e);
  }
}

/** Vendor package orders, read-only. Admin audits; never approves/rejects. */
export async function listPackageOrdersAuditOnly(limit?: number): Promise<Result<Array<Record<string, unknown>>>> {
  try {
    const { data, error } = await adminClient()
      .from("vendor_package_orders")
      .select("*, vendor:vendors(id, business_name)")
      .order("created_at", { ascending: false })
      .limit(clampLimit(limit));
    if (error) {
      // Package-order tracking is optional: if the table has not been created
      // yet, degrade to an empty audit list instead of breaking the admin panel.
      if (isMissingRelationError(error)) {
        console.info("[admin audit] vendor_package_orders table not available yet; returning empty audit list.");
        return ok([]);
      }
      throw error;
    }
    return ok((data ?? []) as Array<Record<string, unknown>>);
  } catch (e) {
    return fail(e);
  }
}
