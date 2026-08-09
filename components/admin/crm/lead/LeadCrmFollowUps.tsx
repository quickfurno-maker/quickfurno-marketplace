"use client";

// ============================================================================
// C-PERF2: follow-ups arrive as server-grouped bounded rows (≤20 per group,
// ordered by follow_up_date) with LIVE group counts — the tab no longer
// depends on a preloaded lead array. There is still no task model here:
// nothing is scheduled, completed or persisted from this view.
// ============================================================================

import { DataTable, EmptyState, StatusBadge } from "../../AdminPrimitives";
import { formatDate, formatNumber } from "../../adminUtils";
import { PRIORITY_TONE, type CrmRow } from "./leadCrmTypes";
import { cap } from "./leadCrmUtils";

export type FollowUpGroups = { overdue: CrmRow[]; today: CrmRow[]; upcoming: CrmRow[] };
export type FollowUpCounts = { overdue: number; today: number; upcoming: number; unscheduled: number };

export function FollowUps({
  groups,
  counts,
  groupLimit,
  loading,
  onSelect,
}: {
  groups: FollowUpGroups;
  counts: FollowUpCounts;
  groupLimit: number;
  loading: boolean;
  onSelect: (row: CrmRow) => void;
}) {
  const scheduledTotal = counts.overdue + counts.today + counts.upcoming;

  const sections: Array<{ key: string; title: string; hint: string; rows: CrmRow[]; total: number; urgent: boolean }> = [
    { key: "overdue", title: "Overdue", hint: "Follow-up date has passed", rows: groups.overdue, total: counts.overdue, urgent: true },
    { key: "today", title: "Today", hint: "Due today", rows: groups.today, total: counts.today, urgent: true },
    { key: "upcoming", title: "Upcoming", hint: "Scheduled for a future date", rows: groups.upcoming, total: counts.upcoming, urgent: false },
  ];

  if (!scheduledTotal && !loading) {
    return (
      <EmptyState
        title="No scheduled follow-ups"
        message={`No lead currently has a follow-up date (${formatNumber(counts.unscheduled)} without one). Scheduling follow-ups is not available in this phase.`}
      />
    );
  }

  return (
    <div className="space-y-4" aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill label="Overdue" value={counts.overdue} urgent={counts.overdue > 0} />
        <Pill label="Today" value={counts.today} urgent={counts.today > 0} />
        <Pill label="Upcoming" value={counts.upcoming} urgent={false} />
        <Pill label="Not scheduled" value={counts.unscheduled} urgent={false} />
      </div>

      {sections.map((group) =>
        group.rows.length ? (
          <section key={group.key} aria-labelledby={`fu-${group.key}`}>
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h3 id={`fu-${group.key}`} className="text-sm font-semibold tracking-tight text-slate-950">
                {group.title}
              </h3>
              <span className="text-xs text-slate-500">
                {group.hint} · {formatNumber(group.total)}
                {group.total > group.rows.length ? ` (showing first ${formatNumber(group.rows.length)})` : ""}
              </span>
              {group.urgent ? (
                <span className="rounded-[var(--qfa-radius-xs)] border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                  Needs action
                </span>
              ) : null}
            </div>
            <DataTable
              rows={group.rows}
              density="compact"
              getRowKey={(row: CrmRow) => row.id}
              emptyTitle="None"
              emptyMessage=""
              columns={[
                {
                  header: "Client",
                  cell: (row: CrmRow) => (
                    <button
                      type="button"
                      onClick={() => onSelect(row)}
                      className="rounded font-semibold text-slate-900 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-slate-300"
                    >
                      {row.name}
                    </button>
                  ),
                },
                { header: "Service", cell: (row: CrmRow) => row.service },
                { header: "City", cell: (row: CrmRow) => row.city },
                { header: "Priority", cell: (row: CrmRow) => <StatusBadge value={cap(row.priority)} tone={PRIORITY_TONE[row.priority]} /> },
                { header: "Status", cell: (row: CrmRow) => <StatusBadge value={row.statusLabel} /> },
                {
                  header: "Assignment",
                  cell: (row: CrmRow) => (
                    <StatusBadge
                      value={row.assignedCount === 0 ? "Unassigned" : `${row.assignedCount} vendor${row.assignedCount === 1 ? "" : "s"}`}
                      tone={row.assignedCount === 0 ? "amber" : "slate"}
                    />
                  ),
                },
                {
                  header: "Follow-up",
                  cell: (row: CrmRow) => (
                    <span className="whitespace-nowrap font-medium text-slate-700">{formatDate(row.followUp)}</span>
                  ),
                },
              ]}
            />
          </section>
        ) : null,
      )}

      {counts.unscheduled > 0 ? (
        <p className="text-xs text-slate-500">
          {formatNumber(counts.unscheduled)} lead{counts.unscheduled === 1 ? " has" : "s have"} no follow-up date (live
          count). Scheduling follow-ups is not available in this phase.
        </p>
      ) : null}
    </div>
  );
}

function Pill({ label, value, urgent }: { label: string; value: number; urgent: boolean }) {
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-[var(--qfa-radius-sm)] border px-2 text-xs font-semibold ${
        urgent ? "border-amber-200 bg-amber-50 text-amber-900" : "border-[color:var(--qfa-line)] bg-white text-slate-600"
      }`}
    >
      {label}
      <span className="tabular-nums">{formatNumber(value)}</span>
    </span>
  );
}
