"use client";

// ============================================================================
// QuickFurno — Phase 26A-2 admin audit panels.
// Read-mostly surfaces for lead matching runs, delivery logs, preview
// messages, and bad-lead report review. WhatsApp stays preview/log only;
// review actions never touch credits.
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import {
  adminAddVendorLeadReportComment,
  adminGetLeadMatchingAuditDetails,
  adminUpdateVendorLeadReportStatus,
} from "@/app/actions";
import {
  ActionMenu,
  DataTable,
  Drawer,
  SectionCard,
  SecondaryButton,
  StatCard,
  StatusBadge,
} from "./AdminPrimitives";
import type {
  BadLeadReportComment,
  BadReport,
  ClientNotificationLog,
  LeadDeliveryLog,
  LeadMatchingRun,
  Snapshot,
} from "./adminTypes";
import { formatDate, formatNumber, leadName, maskPhone, shortId, uniqueOptions, vendorName } from "./adminUtils";

// Human labels for engine/RPC skip and failure reasons shown to admins.
const matchReasonLabels: Record<string, string> = {
  vendor_pending_approval: "Not approved",
  vendor_suspended: "Suspended",
  vendor_inactive: "Inactive",
  free_unpaid_vendor_not_eligible_for_assignment: "No active package (free/unpaid)",
  package_expired: "No active package (expired)",
  no_credits: "No credits",
  city_mismatch: "City mismatch",
  category_mismatch: "Category mismatch",
  subcategory_mismatch: "Subcategory mismatch",
  service_area_mismatch: "Service area mismatch",
  max_vendor_cap_reached: "Max vendor cap reached",
  missing_share_consent: "No consent",
  duplicate_lead: "Duplicate lead",
  skipped_duplicate: "Duplicate lead",
  already_assigned: "Already received lead",
  no_eligible_paid_or_trial_vendors: "No eligible paid/trial vendors",
  no_eligible_vendors: "No eligible vendors",
};

function matchReasonLabel(reason: string): string {
  return matchReasonLabels[reason] ?? reason.replace(/_/g, " ");
}

function runStatusTone(status?: string | null): "emerald" | "amber" | "rose" | "slate" {
  const value = String(status ?? "").toLowerCase();
  if (value === "matched") return "emerald";
  if (value === "waiting" || value === "started") return "amber";
  if (value === "failed") return "rose";
  return "slate";
}

type Notify = (message: string, tone?: "success" | "error" | "info") => void;
type RunAction = (title: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;

// ----------------------------------------------------------------------------
// 1. Matching runs audit
// ----------------------------------------------------------------------------
export function MatchingRunsAuditPanel({ data, notify }: { data: Snapshot; notify: Notify }) {
  const runs = data.leadMatchingRuns ?? [];
  const [detailsLeadId, setDetailsLeadId] = useState<string | null>(null);

  const matchedCount = runs.filter((run) => run.run_status === "matched").length;
  const waitingCount = runs.filter((run) => run.run_status === "waiting").length;
  const failedOrSkipped = runs.filter((run) => run.run_status === "failed" || run.run_status === "skipped").length;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Matching Runs" value={formatNumber(runs.length)} helper="Latest automatic runs" icon="distribution" />
        <StatCard label="Matched" value={formatNumber(matchedCount)} helper="Delivered to vendor dashboards" icon="vendors" tone="emerald" />
        <StatCard label="Waiting / Queued" value={formatNumber(waitingCount)} helper="No eligible paid vendors yet" icon="notifications" tone="amber" />
        <StatCard label="Failed / Skipped" value={formatNumber(failedOrSkipped)} helper="Consent, duplicate, or errors" icon="reports" tone="rose" />
      </section>

      <SectionCard
        title="Automatic Matching Runs"
        description="Consent-gated auto matching audit. Dashboard delivery only — WhatsApp remains preview/log only."
      >
        <DataTable
          rows={runs}
          emptyTitle="No matching runs recorded"
          emptyMessage="Runs appear after consented enquiries trigger automatic matching (migration 027/028 required on the live DB)."
          columns={[
            { header: "Lead", cell: (run: LeadMatchingRun) => <LeadCell data={data} leadId={run.lead_id} /> },
            { header: "Status", cell: (run: LeadMatchingRun) => <StatusBadge value={run.run_status || "started"} tone={runStatusTone(run.run_status)} /> },
            { header: "Consent", cell: (run: LeadMatchingRun) => <StatusBadge value={run.consent_confirmed ? "Consented" : "No consent"} tone={run.consent_confirmed ? "emerald" : "rose"} /> },
            { header: "Eligible", cell: (run: LeadMatchingRun) => formatNumber(run.eligible_vendor_count ?? 0) },
            { header: "Matched", cell: (run: LeadMatchingRun) => formatNumber(run.selected_vendor_ids?.length ?? 0) },
            { header: "Delivered", cell: (run: LeadMatchingRun) => formatNumber(run.assigned_vendor_ids?.length ?? 0) },
            {
              header: "Failed",
              cell: (run: LeadMatchingRun) => {
                const failed = Math.max(0, (run.selected_vendor_ids?.length ?? 0) - (run.assigned_vendor_ids?.length ?? 0));
                return <StatusBadge value={formatNumber(failed)} tone={failed > 0 ? "rose" : "slate"} />;
              },
            },
            {
              header: "Reason",
              cell: (run: LeadMatchingRun) =>
                run.failure_reason
                  ? <span className="line-clamp-2 min-w-36 text-xs text-slate-500">{matchReasonLabel(run.failure_reason)}</span>
                  : <span className="text-xs text-slate-400">—</span>,
            },
            { header: "Created", cell: (run: LeadMatchingRun) => formatDate(run.created_at) },
            {
              header: "Actions",
              cell: (run: LeadMatchingRun) => (
                <SecondaryButton onClick={() => run.lead_id ? setDetailsLeadId(run.lead_id) : notify("Run has no lead id.", "error")}>
                  Match details
                </SecondaryButton>
              ),
            },
          ]}
        />
      </SectionCard>

      {detailsLeadId ? (
        <MatchReasonDetailsDrawer data={data} leadId={detailsLeadId} notify={notify} onClose={() => setDetailsLeadId(null)} />
      ) : null}
    </div>
  );
}

function LeadCell({ data, leadId }: { data: Snapshot; leadId?: string | null }) {
  const lead = data.leads.find((row) => row.id === leadId);
  if (!lead) {
    return (
      <div className="min-w-44">
        <p className="font-semibold text-slate-950">{shortId(leadId)}</p>
        <p className="mt-1 text-xs text-slate-500">Lead not in snapshot</p>
      </div>
    );
  }
  return (
    <div className="min-w-44">
      <p className="font-semibold text-slate-950">{lead.name || "Unnamed lead"}</p>
      <p className="mt-1 text-xs text-slate-500">
        {[lead.service_required || lead.category, [lead.area, lead.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || shortId(leadId)}
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 2. Per-lead match reason details (selected vs skipped, and why)
// ----------------------------------------------------------------------------
type AuditDetails = {
  lead: Record<string, any> | null;
  runs: Array<Record<string, any>>;
  deliveryLogs: Array<Record<string, any>>;
  clientNotifications: Array<Record<string, any>>;
  assignments: Array<Record<string, any>>;
};

function MatchReasonDetailsDrawer({
  data,
  leadId,
  notify,
  onClose,
}: {
  data: Snapshot;
  leadId: string;
  notify: Notify;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<AuditDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const result = await adminGetLeadMatchingAuditDetails(leadId);
      if (!active) return;
      if (!result.ok) {
        notify(result.error ?? "Could not load matching details.", "error");
        setDetails(null);
      } else {
        setDetails(result.data as AuditDetails);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [leadId, notify]);

  const latestRun = details?.runs?.[0] ?? null;
  const snapshot = (latestRun?.matching_snapshot ?? {}) as Record<string, any>;
  const selectedIds: string[] = Array.isArray(latestRun?.selected_vendor_ids) ? latestRun?.selected_vendor_ids : [];
  const assignedIds: string[] = Array.isArray(latestRun?.assigned_vendor_ids) ? latestRun?.assigned_vendor_ids : [];
  const eligible: Array<Record<string, any>> = Array.isArray(snapshot.eligible) ? snapshot.eligible : [];
  const skipped: Array<Record<string, any>> = Array.isArray(snapshot.skipped) ? snapshot.skipped : [];
  const skippedReasonCounts = (snapshot.skipped_reason_counts ?? {}) as Record<string, number>;
  const capReachedIds: string[] = Array.isArray(snapshot.max_vendor_cap_reached_vendor_ids) ? snapshot.max_vendor_cap_reached_vendor_ids : [];
  const rpcSkippedIds: string[] = Array.isArray(snapshot.assignment?.skipped) ? snapshot.assignment.skipped.map(String) : [];

  return (
    <Drawer title="Vendor Match Reason Details" subtitle={`Lead ${shortId(leadId)}`} onClose={onClose}>
      {loading ? (
        <p className="text-sm text-slate-500">Loading matching audit…</p>
      ) : !details ? (
        <p className="text-sm text-slate-500">Matching details are unavailable for this lead.</p>
      ) : (
        <div className="space-y-5">
          {details.lead ? (
            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="font-semibold text-slate-950">{details.lead.name || "Unnamed lead"} · {maskPhone(details.lead.phone)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {[details.lead.service_required || details.lead.category, [details.lead.area, details.lead.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge value={details.lead.share_consent ? "Consent given" : "No consent"} tone={details.lead.share_consent ? "emerald" : "rose"} />
                {details.lead.is_duplicate ? <StatusBadge value="Duplicate" tone="rose" /> : null}
                <StatusBadge value={details.lead.status || "New"} />
              </div>
            </article>
          ) : null}

          {latestRun ? (
            <article className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-950">Latest run</h3>
                <StatusBadge value={latestRun.run_status || "started"} tone={runStatusTone(latestRun.run_status)} />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {formatDate(latestRun.created_at)} · {formatNumber(latestRun.eligible_vendor_count ?? 0)} eligible
                {latestRun.failure_reason ? ` · ${matchReasonLabel(latestRun.failure_reason)}` : ""}
              </p>

              <h4 className="mt-4 text-xs font-semibold uppercase text-slate-500">Vendors selected ({selectedIds.length})</h4>
              <div className="mt-2 space-y-2">
                {selectedIds.length === 0 ? <p className="text-sm text-slate-500">No vendors were selected.</p> : selectedIds.map((vendorId) => {
                  const detail = eligible.find((row) => row.id === vendorId);
                  const delivered = assignedIds.includes(vendorId);
                  return (
                    <div key={vendorId} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-slate-900">{detail?.business_name || vendorName(data.vendors, vendorId)}</span>
                        <StatusBadge value={delivered ? "Delivered" : "Not delivered"} tone={delivered ? "emerald" : "rose"} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {detail
                          ? `Selected: ${detail.visibilityType} package · score ${detail.score} · ${formatNumber(detail.credits)} credits`
                          : "Selected by matching run"}
                      </p>
                    </div>
                  );
                })}
              </div>

              {capReachedIds.length > 0 ? (
                <>
                  <h4 className="mt-4 text-xs font-semibold uppercase text-slate-500">Eligible but over the 3-vendor cap</h4>
                  <p className="mt-1 text-sm text-slate-600">{capReachedIds.map((id) => vendorName(data.vendors, id)).join(", ")}</p>
                </>
              ) : null}

              <h4 className="mt-4 text-xs font-semibold uppercase text-slate-500">Vendors skipped ({skipped.length})</h4>
              {skipped.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">
                  {Object.keys(skippedReasonCounts).length > 0
                    ? "Skip details not stored for this run."
                    : "No skip reasons recorded for this run (older runs pre-date skip auditing)."}
                </p>
              ) : (
                <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                  {skipped.map((row) => (
                    <div key={String(row.vendor_id)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                      <p className="font-semibold text-slate-900">{row.business_name || vendorName(data.vendors, String(row.vendor_id))}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {(Array.isArray(row.reasons) ? row.reasons : []).map((reason: string) => matchReasonLabel(reason)).join(", ") || "Reason not recorded"}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {Object.keys(skippedReasonCounts).length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(skippedReasonCounts).map(([reason, count]) => (
                    <StatusBadge key={reason} value={`${matchReasonLabel(reason)}: ${formatNumber(count)}`} tone="slate" />
                  ))}
                </div>
              ) : null}

              {rpcSkippedIds.length > 0 ? (
                <p className="mt-3 text-xs text-slate-500">
                  Skipped during assignment (already received lead, credit race, or recheck failure): {rpcSkippedIds.map((id) => vendorName(data.vendors, id)).join(", ")}
                </p>
              ) : null}
            </article>
          ) : (
            <p className="text-sm text-slate-500">No matching runs recorded for this lead yet.</p>
          )}

          <article className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-950">Delivery & preview trail</h3>
            <div className="mt-3 space-y-2">
              {details.deliveryLogs.length === 0 ? <p className="text-sm text-slate-500">No delivery logs for this lead.</p> : details.deliveryLogs.map((log) => (
                <div key={String(log.id)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-900">{(log.vendor as any)?.business_name || vendorName(data.vendors, String(log.vendor_id))}</span>
                    <StatusBadge value={String(log.delivery_channel ?? "vendor_dashboard")} tone={log.delivery_channel === "whatsapp_preview" ? "blue" : "emerald"} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {String(log.delivery_status ?? "")} · contact {log.contact_shared ? "shared" : "not shared"} · credit {log.credit_deducted ? "deducted" : "not deducted"} · {formatDate(String(log.created_at ?? ""))}
                  </p>
                  {log.whatsapp_preview_message ? (
                    <p className="mt-2 rounded-lg bg-white px-2 py-1.5 text-xs text-slate-600">{String(log.whatsapp_preview_message)}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </article>
        </div>
      )}
    </Drawer>
  );
}

// ----------------------------------------------------------------------------
// 3. Delivery logs audit table
// ----------------------------------------------------------------------------
export function DeliveryLogsAuditPanel({ data }: { data: Snapshot }) {
  const logs = data.leadDeliveryLogs ?? [];
  const dashboardLogs = logs.filter((log) => log.delivery_channel !== "whatsapp_preview");

  return (
    <SectionCard
      title="Lead Delivery Logs"
      description="Every dashboard delivery with contact and credit flags. Credit is deducted only when a lead is delivered to a vendor dashboard."
    >
      <DataTable
        rows={dashboardLogs}
        emptyTitle="No delivery logs"
        emptyMessage="Dashboard deliveries will appear here after automatic matching assigns a lead."
        columns={[
          { header: "Lead", cell: (log: LeadDeliveryLog) => <LeadCell data={data} leadId={log.lead_id} /> },
          { header: "Vendor", cell: (log: LeadDeliveryLog) => vendorName(data.vendors, log.vendor_id) },
          { header: "Channel", cell: (log: LeadDeliveryLog) => <StatusBadge value={log.delivery_channel || "vendor_dashboard"} tone="emerald" /> },
          { header: "Status", cell: (log: LeadDeliveryLog) => <StatusBadge value={log.delivery_status || "pending"} tone={log.delivery_status === "delivered" ? "emerald" : "amber"} /> },
          { header: "Contact", cell: (log: LeadDeliveryLog) => <StatusBadge value={log.contact_shared ? "Revealed" : "Hidden"} tone={log.contact_shared ? "emerald" : "slate"} /> },
          { header: "Credit", cell: (log: LeadDeliveryLog) => <StatusBadge value={log.credit_deducted ? "Deducted" : "Not deducted"} tone={log.credit_deducted ? "amber" : "slate"} /> },
          { header: "Credit Log", cell: (log: LeadDeliveryLog) => log.credit_log_id ? shortId(log.credit_log_id) : "—" },
          { header: "Failure", cell: (log: LeadDeliveryLog) => log.failure_reason ? <span className="text-xs text-rose-600">{log.failure_reason}</span> : "—" },
          { header: "Created", cell: (log: LeadDeliveryLog) => formatDate(log.created_at) },
        ]}
      />
    </SectionCard>
  );
}

// ----------------------------------------------------------------------------
// 4. Preview message logs (client + vendor, WhatsApp preview only)
// ----------------------------------------------------------------------------
export function PreviewMessagesPanel({ data }: { data: Snapshot }) {
  const clientLogs = data.clientNotificationLogs ?? [];
  const vendorPreviewLogs = (data.leadDeliveryLogs ?? []).filter((log) => log.delivery_channel === "whatsapp_preview");

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Client Previews" value={formatNumber(clientLogs.length)} helper="Assigned-vendor previews" icon="notifications" tone="indigo" />
        <StatCard label="Vendor Previews" value={formatNumber(vendorPreviewLogs.length)} helper="Lead-delivered previews" icon="vendors" tone="emerald" />
        <StatCard label="Live WhatsApp Sent" value="0" helper="Preview/log only in this phase" icon="reports" tone="slate" />
        <StatCard label="Channel" value="whatsapp_preview" helper="No live sends until final phase" icon="automations" tone="amber" />
      </section>

      <SectionCard
        title="Client Assigned-Vendors Previews"
        description="What the client WILL receive on WhatsApp after live integration. Status preview_created means nothing was sent."
      >
        <DataTable
          rows={clientLogs}
          emptyTitle="No client preview logs"
          emptyMessage="Client previews are created when matching assigns vendors or parks a lead as waiting."
          columns={[
            { header: "Lead", cell: (log: ClientNotificationLog) => <LeadCell data={data} leadId={log.lead_id} /> },
            { header: "Type", cell: (log: ClientNotificationLog) => <StatusBadge value={log.notification_type || "assigned_vendors_preview"} tone={log.notification_type === "waiting_for_vendors_preview" ? "amber" : "emerald"} /> },
            { header: "Channel", cell: (log: ClientNotificationLog) => <StatusBadge value={log.channel || "dashboard_preview"} tone="blue" /> },
            { header: "Status", cell: (log: ClientNotificationLog) => <StatusBadge value={log.status || "preview_created"} tone="slate" /> },
            { header: "Vendors", cell: (log: ClientNotificationLog) => formatNumber(log.vendor_snapshot?.length ?? 0) },
            { header: "Message", cell: (log: ClientNotificationLog) => <span className="line-clamp-2 min-w-64 text-xs text-slate-600">{log.message || "No message"}</span> },
            { header: "WhatsApp", cell: (log: ClientNotificationLog) => <StatusBadge value={log.whatsapp_status || "preview_only"} tone="slate" /> },
            { header: "Created", cell: (log: ClientNotificationLog) => formatDate(log.created_at) },
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Vendor Lead-Delivered Previews"
        description="What each vendor WILL receive on WhatsApp after live integration. Full lead context stays inside the admin console."
      >
        <DataTable
          rows={vendorPreviewLogs}
          emptyTitle="No vendor preview logs"
          emptyMessage="Vendor WhatsApp previews are logged whenever a lead is delivered to a vendor dashboard."
          columns={[
            { header: "Lead", cell: (log: LeadDeliveryLog) => <LeadCell data={data} leadId={log.lead_id} /> },
            { header: "Vendor", cell: (log: LeadDeliveryLog) => vendorName(data.vendors, log.vendor_id) },
            { header: "Preview Message", cell: (log: LeadDeliveryLog) => <span className="line-clamp-3 min-w-72 text-xs text-slate-600">{log.whatsapp_preview_message || "No preview text"}</span> },
            { header: "Status", cell: (log: LeadDeliveryLog) => <StatusBadge value={log.delivery_status || "preview_created"} tone="slate" /> },
            { header: "WhatsApp", cell: (log: LeadDeliveryLog) => <StatusBadge value={log.whatsapp_status || "preview_only"} tone="slate" /> },
            { header: "Created", cell: (log: LeadDeliveryLog) => formatDate(log.created_at) },
          ]}
        />
      </SectionCard>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 5. Bad lead reports review (status workflow + comments; no credit changes)
// ----------------------------------------------------------------------------
const badLeadReviewStatuses = ["Under Review", "Valid", "Invalid", "Resolved", "Rejected"] as const;

export function BadLeadReportsReviewPanel({
  data,
  notify,
  runAction,
}: {
  data: Snapshot;
  notify: Notify;
  runAction: RunAction;
}) {
  const [statusFilter, setStatusFilter] = useState("All");
  const commentsByReport = useMemo(() => {
    const map = new Map<string, BadLeadReportComment[]>();
    (data.badLeadReportComments ?? []).forEach((comment) => {
      if (!comment.report_id) return;
      const list = map.get(comment.report_id) ?? [];
      list.push(comment);
      map.set(comment.report_id, list);
    });
    return map;
  }, [data.badLeadReportComments]);

  const reports = useMemo(
    () => data.badReports.filter((report) => statusFilter === "All" || String(report.status ?? "Pending") === statusFilter),
    [data.badReports, statusFilter],
  );
  const assignmentById = useMemo(
    () => new Map(data.assignments.map((assignment) => [assignment.id, assignment])),
    [data.assignments],
  );

  function updateStatus(report: BadReport, status: (typeof badLeadReviewStatuses)[number]) {
    const note = window.prompt(`Admin note for "${status}" (optional)`) ?? undefined;
    runAction(
      `Report marked ${status}`,
      () => adminUpdateVendorLeadReportStatus(report.id, { status, adminNotes: note?.trim() || undefined }),
    );
  }

  function addComment(report: BadReport) {
    const comment = window.prompt("Admin comment for this report");
    if (!comment?.trim()) {
      notify("Comment text is required.", "error");
      return;
    }
    runAction("Report comment added", () => adminAddVendorLeadReportComment(report.id, comment));
  }

  return (
    <SectionCard
      title="Bad Lead Reports Review"
      description="Manual admin review. Marking a report Valid/Invalid/Resolved never refunds, adds, or deducts credits — credit corrections stay a separate manual admin action."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {uniqueOptions(["Pending", "Under Review", "Valid", "Invalid", "Resolved", "Rejected", ...data.badReports.map((report) => report.status)]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setStatusFilter(option)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${statusFilter === option ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {option}
          </button>
        ))}
      </div>
      <DataTable
        rows={reports}
        emptyTitle="No bad-lead reports in this view"
        emptyMessage="Vendor bad-lead reports will appear here for manual admin review."
        columns={[
          {
            header: "Vendor / Lead",
            cell: (report: BadReport) => {
              const assignment = assignmentById.get(report.lead_assignment_id ?? "");
              return (
                <div className="min-w-44">
                  <p className="font-semibold text-slate-950">{vendorName(data.vendors, report.vendor_id)}</p>
                  <p className="mt-1 text-xs text-slate-500">{leadName(data.leads, assignment?.lead_id)} · {formatDate(report.created_at)}</p>
                </div>
              );
            },
          },
          { header: "Type", cell: (report: BadReport) => <StatusBadge value={report.report_type || report.reason || "Not set"} tone="amber" /> },
          {
            header: "Reason / Comment",
            cell: (report: BadReport) => (
              <div className="min-w-56 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">{report.report_reason || report.reason || "Not set"}</p>
                <p className="mt-1 line-clamp-2">{report.vendor_comment || report.description || "No vendor comment"}</p>
              </div>
            ),
          },
          {
            header: "Status",
            cell: (report: BadReport) => (
              <StatusBadge
                value={report.status || "Pending"}
                tone={report.status === "Valid" || report.status === "Resolved" ? "emerald" : report.status === "Invalid" || report.status === "Rejected" ? "rose" : "amber"}
              />
            ),
          },
          { header: "Credit", cell: (report: BadReport) => <StatusBadge value={report.credit_restored ? "Restored (manual)" : "No auto refund"} tone={report.credit_restored ? "emerald" : "slate"} /> },
          {
            header: "Admin Notes",
            cell: (report: BadReport) => (
              <div className="min-w-48 text-xs text-slate-600">
                <p className="line-clamp-2">{report.admin_notes || report.admin_decision || "—"}</p>
                {report.reviewed_at ? (
                  <p className="mt-1 text-slate-400">Reviewed {formatDate(report.reviewed_at)}{report.reviewed_by ? ` · ${shortId(report.reviewed_by)}` : ""}</p>
                ) : null}
              </div>
            ),
          },
          {
            header: "Comments",
            cell: (report: BadReport) => {
              const comments = commentsByReport.get(report.id) ?? [];
              if (comments.length === 0) return <span className="text-xs text-slate-400">None</span>;
              return (
                <div className="grid min-w-56 gap-1.5 text-xs text-slate-600">
                  {comments.slice(-2).map((comment) => (
                    <p key={comment.id} className="line-clamp-2 rounded-lg bg-slate-50 px-2 py-1">
                      <span className="font-semibold text-slate-800">{comment.sender_type === "admin" ? "Admin" : "Vendor"}:</span> {comment.comment}
                    </p>
                  ))}
                  {comments.length > 2 ? <p className="text-slate-400">+{comments.length - 2} more</p> : null}
                </div>
              );
            },
          },
          {
            header: "Actions",
            cell: (report: BadReport) => (
              <ActionMenu
                actions={[
                  ...badLeadReviewStatuses.map((status) => ({
                    label: `Mark ${status.toLowerCase()}`,
                    onClick: () => updateStatus(report, status),
                  })),
                  { label: "Add admin comment", onClick: () => addComment(report) },
                ]}
              />
            ),
          },
        ]}
      />
    </SectionCard>
  );
}
