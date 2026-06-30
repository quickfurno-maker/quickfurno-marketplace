"use client";

// ============================================================================
// QuickFurno — Phase 14: Assignment Ledger panels for the Lead Distribution page
//
// Read-only views over the Phase 13 preview ledger (lead_assignment_approvals):
//   - RecentAssignmentsPanel   → GET /api/admin/lead-assignments/recent
//   - FailedAssignmentsPanel    → GET /api/admin/lead-assignments/failed
//   - DistributionLogsPanel     → GET /api/admin/lead-assignments/logs
//   - detail drawer             → GET /api/admin/lead-assignments/[id]
//
// These never write, never assign, never notify, never call n8n. The side-effect
// badges are ALWAYS shown as disabled to make the preview-only contract obvious.
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import { DataTable, EmptyState, SecondaryButton, SectionCard, StatusBadge } from "./AdminPrimitives";
import { formatDate } from "./adminUtils";

interface VendorSnap {
  id: string;
  businessName: string | null;
  city: string | null;
  packageStatus: string;
  credits: number;
  paidStatus: string | null;
}

interface LedgerEntry {
  id: string;
  leadId: string;
  leadName: string | null;
  leadCity: string | null;
  leadCategory: string | null;
  leadBudget: string | null;
  selectedVendorIds: string[];
  selectedVendorCount: number;
  selectedVendorNames: string[];
  vendors: VendorSnap[];
  status: string;
  statusLabel: string;
  mode: string;
  aosEventEmitted: boolean;
  n8nWebhookCalled: boolean;
  n8nLabel: string;
  approvedBy: string | null;
  approvalSource: string;
  approvalNote: string | null;
  failureReason: string | null;
  isFailed: boolean;
  sideEffects: {
    whatsappSent: boolean;
    vendorNotified: boolean;
    creditsDeducted: boolean;
    leadAutoAssigned: boolean;
    n8nWebhookCalled: boolean;
  };
  createdAt: string | null;
  updatedAt: string | null;
}

interface LedgerDetail extends LedgerEntry {
  eventResponse: Record<string, unknown>;
}

interface LogEntry {
  id: string;
  createdAt: string | null;
  leadName: string | null;
  status: string;
  statusLabel: string;
  n8nWebhookCalled: boolean;
  approvedBy: string | null;
  approvalSource: string;
}

interface CreditLog {
  id: string;
  vendorId: string;
  changeType: string;
  creditsBefore: number;
  creditsDelta: number;
  creditsAfter: number;
  reason: string | null;
  updatedBy: string | null;
  createdAt: string | null;
}

type Notify = (message: string, tone?: "success" | "error" | "info") => void;

// ----------------------------------------------------------------------------
// Shared bits
// ----------------------------------------------------------------------------
function SafetyLegend() {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase text-emerald-800">Preview-only — side effects always disabled</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <StatusBadge value="WhatsApp: Disabled" tone="rose" />
        <StatusBadge value="Vendor notification: Disabled" tone="rose" />
        <StatusBadge value="Credits: Not deducted" tone="rose" />
        <StatusBadge value="Auto assignment: Disabled" tone="rose" />
      </div>
    </div>
  );
}

function N8nBadge({ called }: { called: boolean }) {
  return <StatusBadge value={called ? "n8n preview called" : "safe mock mode"} tone={called ? "emerald" : "slate"} />;
}

function StatusChip({ entry }: { entry: LedgerEntry }) {
  const tone = entry.status === "preview_sent_to_aos" ? "emerald" : entry.status === "cancelled" ? "rose" : "amber";
  return <StatusBadge value={entry.statusLabel} tone={tone} />;
}

function useLedgerFetch<T>(url: string, pick: (data: any) => T, notify: Notify, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 403) {
        notify("Superadmin access is required.", "error");
        return;
      }
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        notify(data?.error ?? "Could not load data.", "error");
        return;
      }
      setValue(pick(data));
    } catch {
      notify("Could not reach the server.", "error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  return { value, loading, reload: load };
}

// ----------------------------------------------------------------------------
// Recent Assignments
// ----------------------------------------------------------------------------
export function RecentAssignmentsPanel({ notify }: { notify: Notify }) {
  const { value: rows, loading, reload } = useLedgerFetch<LedgerEntry[]>(
    "/api/admin/lead-assignments/recent",
    (data) => (data.assignments ?? []) as LedgerEntry[],
    notify,
    [],
  );
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <SafetyLegend />
      <SectionCard
        title="Recent Assignments (preview ledger)"
        description="Records from lead_assignment_approvals saved by the Assignment Approval Preview. No real assignment is performed."
        action={<SecondaryButton onClick={() => void reload()}>{loading ? "Loading..." : "Refresh"}</SecondaryButton>}
      >
        <DataTable
          rows={rows}
          emptyTitle={loading ? "Loading recent assignments..." : "No assignment previews yet"}
          emptyMessage="Approve an assignment in the Assignment Approval Preview tab and it will appear here."
          columns={[
            { header: "Lead / Client", cell: (row) => <Strong title={row.leadName || "Unnamed lead"} subtitle={row.leadCity || "City not set"} /> },
            { header: "City", cell: (row) => row.leadCity || "Not set" },
            { header: "Category", cell: (row) => row.leadCategory || "Not set" },
            { header: "Vendors", cell: (row) => String(row.selectedVendorCount) },
            { header: "Vendor names", cell: (row) => <span className="line-clamp-2 min-w-44">{row.selectedVendorNames.length ? row.selectedVendorNames.join(", ") : `${row.selectedVendorCount} selected`}</span> },
            { header: "Status", cell: (row) => <StatusChip entry={row} /> },
            { header: "Mode", cell: (row) => <StatusBadge value={row.mode} tone="slate" /> },
            { header: "n8n webhook", cell: (row) => <N8nBadge called={row.n8nWebhookCalled} /> },
            { header: "Side effects", cell: () => <StatusBadge value="All disabled" tone="emerald" /> },
            { header: "Approved by", cell: (row) => row.approvedBy || "Superadmin" },
            { header: "Created", cell: (row) => formatDate(row.createdAt) },
            { header: "Details", cell: (row) => <SecondaryButton onClick={() => setDetailId(row.id)}>View details</SecondaryButton> },
          ]}
        />
      </SectionCard>
      {detailId ? <AssignmentDetailDrawer id={detailId} notify={notify} onClose={() => setDetailId(null)} /> : null}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Failed Assignments
// ----------------------------------------------------------------------------
export function FailedAssignmentsPanel({ notify }: { notify: Notify }) {
  const { value: rows, loading, reload } = useLedgerFetch<LedgerEntry[]>(
    "/api/admin/lead-assignments/failed",
    (data) => (data.assignments ?? []) as LedgerEntry[],
    notify,
    [],
  );

  return (
    <SectionCard
      title="Failed Assignments"
      description="Preview approvals that recorded a safe failure (cancelled, a failure reason, or an un-emitted AOS event)."
      action={<SecondaryButton onClick={() => void reload()}>{loading ? "Loading..." : "Refresh"}</SecondaryButton>}
    >
      {rows.length === 0 ? (
        <EmptyState
          title={loading ? "Checking for failed records..." : "No failed assignments"}
          message="Nothing has failed. Preview approvals save safely and emit the AOS event through the two-lock gate."
          compact
        />
      ) : (
        <DataTable
          rows={rows}
          emptyTitle="No failed assignments"
          emptyMessage="Nothing has failed."
          columns={[
            { header: "Lead / Client", cell: (row) => <Strong title={row.leadName || "Unnamed lead"} subtitle={row.leadCity || "City not set"} /> },
            { header: "Category", cell: (row) => row.leadCategory || "Not set" },
            { header: "Status", cell: (row) => <StatusChip entry={row} /> },
            { header: "Reason", cell: (row) => row.failureReason || (row.aosEventEmitted ? "—" : "AOS event not emitted") },
            { header: "n8n webhook", cell: (row) => <N8nBadge called={row.n8nWebhookCalled} /> },
            { header: "Created", cell: (row) => formatDate(row.createdAt) },
          ]}
        />
      )}
    </SectionCard>
  );
}

// ----------------------------------------------------------------------------
// Distribution Logs
// ----------------------------------------------------------------------------
export function DistributionLogsPanel({ notify }: { notify: Notify }) {
  const { value, loading, reload } = useLedgerFetch<{ logs: LogEntry[]; creditLogs: CreditLog[] }>(
    "/api/admin/lead-assignments/logs",
    (data) => ({ logs: (data.logs ?? []) as LogEntry[], creditLogs: (data.creditLogs ?? []) as CreditLog[] }),
    notify,
    { logs: [], creditLogs: [] },
  );

  return (
    <div className="space-y-4">
      <SectionCard
        title="Distribution Logs (read-only)"
        description="Assignment approval log lines from the preview ledger."
        action={<SecondaryButton onClick={() => void reload()}>{loading ? "Loading..." : "Refresh"}</SecondaryButton>}
      >
        <DataTable
          rows={value.logs}
          emptyTitle={loading ? "Loading logs..." : "No distribution logs yet"}
          emptyMessage="Approval log lines will appear here after an assignment preview is approved."
          columns={[
            { header: "Time", cell: (row) => formatDate(row.createdAt) },
            { header: "Lead", cell: (row) => row.leadName || "Unnamed lead" },
            { header: "Status", cell: (row) => <StatusBadge value={row.statusLabel} tone={row.status === "preview_sent_to_aos" ? "emerald" : row.status === "cancelled" ? "rose" : "amber"} /> },
            { header: "n8n webhook", cell: (row) => <N8nBadge called={row.n8nWebhookCalled} /> },
            { header: "Source", cell: (row) => <StatusBadge value={row.approvalSource} tone="slate" /> },
            { header: "Approved by", cell: (row) => row.approvedBy || "Superadmin" },
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Preview credit logs (read-only)"
        description="Credit log rows tagged as preview tests. The preview flow never deducts credits."
      >
        <DataTable
          rows={value.creditLogs}
          emptyTitle="No preview credit logs"
          emptyMessage="Assignment preview never changes credits, so this is normally empty."
          columns={[
            { header: "Time", cell: (row) => formatDate(row.createdAt) },
            { header: "Vendor", cell: (row) => row.vendorId },
            { header: "Type", cell: (row) => <StatusBadge value={row.changeType} tone="slate" /> },
            { header: "Change", cell: (row) => `${row.creditsBefore} → ${row.creditsAfter}` },
            { header: "By", cell: (row) => row.updatedBy || "—" },
          ]}
        />
      </SectionCard>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Detail drawer
// ----------------------------------------------------------------------------
function AssignmentDetailDrawer({ id, notify, onClose }: { id: string; notify: Notify; onClose: () => void }) {
  const [detail, setDetail] = useState<LedgerDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/admin/lead-assignments/${id}`, { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (!res.ok || !data?.ok) {
          notify(data?.error ?? "Could not load the assignment detail.", "error");
          onClose();
          return;
        }
        setDetail(data.assignment as LedgerDetail);
      } catch {
        if (active) {
          notify("Could not load the assignment detail.", "error");
          onClose();
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, notify, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-sm" onMouseDown={onClose}>
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-[#f6f8f5] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">Assignment preview detail</h2>
            <p className="mt-1 text-sm text-slate-500">{detail ? `Record ${detail.id.slice(0, 8)}` : "Loading..."}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Close</button>
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          {loading || !detail ? (
            <p className="text-sm text-slate-500">Loading assignment detail...</p>
          ) : (
            <>
              <SafetyLegend />

              <article className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-950">Lead</h3>
                <dl className="mt-3 grid gap-2 text-sm">
                  <Row label="Name" value={detail.leadName || "Not provided"} />
                  <Row label="City" value={detail.leadCity || "Not provided"} />
                  <Row label="Category" value={detail.leadCategory || "Not provided"} />
                  <Row label="Budget" value={detail.leadBudget || "Not provided"} />
                </dl>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-950">Approval</h3>
                  <div className="flex flex-wrap gap-2">
                    <StatusChip entry={detail} />
                    <N8nBadge called={detail.n8nWebhookCalled} />
                  </div>
                </div>
                <dl className="mt-3 grid gap-2 text-sm">
                  <Row label="Mode" value={detail.mode} />
                  <Row label="Approved by" value={detail.approvedBy || "Superadmin"} />
                  <Row label="Source" value={detail.approvalSource} />
                  <Row label="AOS event emitted" value={detail.aosEventEmitted ? "Yes" : "No"} />
                  <Row label="Note" value={detail.approvalNote || "—"} />
                  {detail.failureReason ? <Row label="Failure reason" value={detail.failureReason} /> : null}
                </dl>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-950">Selected vendors ({detail.selectedVendorCount})</h3>
                <div className="mt-3 space-y-2">
                  {detail.vendors.length ? detail.vendors.map((vendor) => (
                    <div key={vendor.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{vendor.businessName || vendor.id}</span>
                        <div className="flex flex-wrap gap-2">
                          <StatusBadge value={`Pkg: ${vendor.packageStatus}`} tone={vendor.packageStatus === "active" || vendor.packageStatus === "trial" ? "emerald" : "slate"} />
                          <StatusBadge value={`${vendor.credits} credits`} tone={vendor.credits > 0 ? "emerald" : "rose"} />
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{vendor.city || "City not set"}</p>
                    </div>
                  )) : detail.selectedVendorIds.length ? (
                    <p className="text-sm text-slate-500">Vendor IDs: {detail.selectedVendorIds.join(", ")}</p>
                  ) : (
                    <p className="text-sm text-slate-500">No vendor snapshot stored for this record.</p>
                  )}
                </div>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-950">Side effects</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Row label="WhatsApp" value="Disabled" />
                  <Row label="Vendor notification" value="Disabled" />
                  <Row label="Credits" value="Not deducted" />
                  <Row label="Auto assignment" value="Disabled" />
                </div>
              </article>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function Strong({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="min-w-44">
      <p className="font-semibold text-slate-950">{title}</p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
    </div>
  );
}
