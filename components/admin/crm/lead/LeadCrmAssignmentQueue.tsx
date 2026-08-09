"use client";

import {
  DataTable,
  NoteBar,
  StatCard,
  StatusBadge,
} from "../../AdminPrimitives";
import {
  type Assignment,
  type Lead,
  type LeadAssignmentQueueRow,
  type Vendor,
} from "../../adminTypes";
import {
  formatDate,
  formatNumber,
} from "../../adminUtils";
import {
  followUpDue,
} from "./leadCrmUtils";

/**
 * Operational VISIBILITY over lead_assignment_queue. This surface never runs
 * matching, triggers an assignment, deducts a credit or notifies a vendor —
 * queue policy stays entirely in Core.
 */
const QUEUE_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  in_progress: "In progress",
  resolved: "Resolved",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Humanise a snake_case Core code without hiding an unknown value. */
function humanise(value?: string | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  return raw.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function AssignmentQueue({ queue }: { queue: LeadAssignmentQueueRow[] }) {
  const active = queue.filter((row) => (row.queue_status ?? "queued") !== "resolved");
  return (
    <div className="space-y-4">
      <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Queue rows" value={formatNumber(queue.length)} helper="All queue entries" icon="distribution" tone="indigo" />
        <StatCard label="Active" value={formatNumber(active.length)} helper="Not yet resolved" icon="distribution" tone="amber" />
        <StatCard label="Resolved" value={formatNumber(queue.length - active.length)} helper="Completed" icon="distribution" tone="emerald" />
        <StatCard label="Due now" value={formatNumber(active.filter((r) => followUpDue(r.next_retry_at)).length)} helper="Retry time reached" icon="notifications" tone="rose" />
      </section>
      <NoteBar>
        Visibility only. Matching, assignment, credit deduction and vendor notification are performed by Core — nothing
        on this screen triggers them.
      </NoteBar>

      <DataTable
        rows={queue}
        density="compact"
        getRowKey={(row, index) => String(row.id ?? index)}
        emptyTitle="Assignment queue is empty"
        emptyMessage="Queued leads awaiting delayed fill or vendor availability will appear here."
        columns={[
          { header: "Lead", cell: (row) => <span className="font-mono text-xs">{String(row.lead_id).slice(0, 8)}</span> },
          { header: "City / Category", cell: (row) => <span className="whitespace-nowrap">{[row.city, row.category].filter(Boolean).join(" · ") || "—"}</span> },
          { header: "Status", cell: (row) => <StatusBadge value={QUEUE_STATUS_LABEL[String(row.queue_status ?? "queued")] ?? humanise(row.queue_status)} /> },
          { header: "Reason", cell: (row) => <span className="text-xs text-slate-600">{humanise(row.queue_reason)}</span> },
          { header: "Selected", cell: (row) => <StatusBadge value={`${(row.selected_vendor_ids ?? []).length}/${row.required_vendor_count ?? 3}`} tone="slate" /> },
          { header: "Attempts", cell: (row) => formatNumber(row.matching_attempt_count ?? 0) },
          { header: "Next retry", cell: (row) => <span className="whitespace-nowrap">{row.next_retry_at ? formatDate(row.next_retry_at) : "—"}</span> },
          { header: "Created", cell: (row) => <span className="whitespace-nowrap">{formatDate(row.created_at)}</span> },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vendor Response (vendor_status on assignments + delivery logs)
// ---------------------------------------------------------------------------
