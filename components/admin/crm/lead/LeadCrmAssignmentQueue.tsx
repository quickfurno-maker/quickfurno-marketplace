"use client";

// ============================================================================
// C-PERF2: server-paged queue visibility (20/page) with LIVE counts. This
// surface never runs matching, triggers an assignment, deducts a credit or
// notifies a vendor — queue policy stays entirely in Core.
// ============================================================================

import {
  DataTable,
  NoteBar,
  StatCard,
  StatusBadge,
} from "../../AdminPrimitives";
import { Pagination } from "../../Pagination";
import {
  type LeadAssignmentQueueRow,
} from "../../adminTypes";
import {
  formatDate,
  formatNumber,
} from "../../adminUtils";

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

export function AssignmentQueue({
  result,
  counts,
  isPending,
  onPageChange,
}: {
  result: { rows: LeadAssignmentQueueRow[]; page: number; pageSize: number; total: number };
  counts: { total: number; active: number; resolved: number; dueNow: number };
  isPending: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="space-y-4" aria-busy={isPending}>
      <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Queue rows" value={formatNumber(counts.total)} helper="All queue entries (live count)" icon="distribution" tone="indigo" />
        <StatCard label="Active" value={formatNumber(counts.active)} helper="Not yet resolved (live count)" icon="distribution" tone="amber" />
        <StatCard label="Resolved" value={formatNumber(counts.resolved)} helper="Completed (live count)" icon="distribution" tone="emerald" />
        <StatCard label="Due now" value={formatNumber(counts.dueNow)} helper="Retry time reached (live count)" icon="notifications" tone="rose" />
      </section>
      <NoteBar>
        Visibility only. Matching, assignment, credit deduction and vendor notification are performed by Core — nothing
        on this screen triggers them.
      </NoteBar>

      <DataTable
        rows={result.rows}
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

      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        noun="queue rows"
        isPending={isPending}
        onPageChange={onPageChange}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vendor Response (vendor_status on assignments + delivery logs)
// ---------------------------------------------------------------------------
