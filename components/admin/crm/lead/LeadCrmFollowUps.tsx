"use client";

import { DataTable, EmptyState, StatusBadge } from "../../AdminPrimitives";
import { formatDate, formatNumber } from "../../adminUtils";
import { PRIORITY_TONE, type CrmRow } from "./leadCrmTypes";
import { cap, followUpDue } from "./leadCrmUtils";

/**
 * Follow-ups grouped by real `follow_up_date` only.
 *
 * There is no task model behind this view: nothing is scheduled, completed or
 * persisted here. It reports the follow-up dates already stored on leads, which
 * is why "Not scheduled" is shown as a plain count rather than as an actionable
 * queue — creating a follow-up is not a capability this phase has.
 */
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isTodayDate(value?: string | null): boolean {
  if (!value) return false;
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return false;
  return t >= startOfToday() && t < startOfToday() + 86_400_000;
}

export function FollowUps({ rows, onSelect }: { rows: CrmRow[]; onSelect: (row: CrmRow) => void }) {
  const scheduled = rows
    .filter((row) => row.followUp)
    .sort((a, b) => new Date(a.followUp ?? 0).getTime() - new Date(b.followUp ?? 0).getTime());

  const today = scheduled.filter((row) => isTodayDate(row.followUp));
  const overdue = scheduled.filter((row) => followUpDue(row.followUp) && !isTodayDate(row.followUp));
  const upcoming = scheduled.filter((row) => !followUpDue(row.followUp) && !isTodayDate(row.followUp));
  const unscheduled = rows.length - scheduled.length;

  const groups: Array<{ key: string; title: string; hint: string; rows: CrmRow[]; urgent: boolean }> = [
    { key: "overdue", title: "Overdue", hint: "Follow-up date has passed", rows: overdue, urgent: true },
    { key: "today", title: "Today", hint: "Due today", rows: today, urgent: true },
    { key: "upcoming", title: "Upcoming", hint: "Scheduled for a future date", rows: upcoming, urgent: false },
  ];

  if (!scheduled.length) {
    return (
      <EmptyState
        title="No scheduled follow-ups"
        message={`No lead currently has a follow-up date. ${formatNumber(rows.length)} leads are loaded. Scheduling follow-ups is not available in this phase.`}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill label="Overdue" value={overdue.length} urgent={overdue.length > 0} />
        <Pill label="Today" value={today.length} urgent={today.length > 0} />
        <Pill label="Upcoming" value={upcoming.length} urgent={false} />
        <Pill label="Not scheduled" value={unscheduled} urgent={false} />
      </div>

      {groups.map((group) =>
        group.rows.length ? (
          <section key={group.key} aria-labelledby={`fu-${group.key}`}>
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h3 id={`fu-${group.key}`} className="text-sm font-semibold tracking-tight text-slate-950">
                {group.title}
              </h3>
              <span className="text-xs text-slate-500">
                {group.hint} · {formatNumber(group.rows.length)}
              </span>
              {group.urgent ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                  Needs action
                </span>
              ) : null}
            </div>
            <DataTable
              rows={group.rows}
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

      {unscheduled > 0 ? (
        <p className="text-xs text-slate-500">
          {formatNumber(unscheduled)} loaded lead{unscheduled === 1 ? " has" : "s have"} no follow-up date. Scheduling
          follow-ups is not available in this phase.
        </p>
      ) : null}
    </div>
  );
}

function Pill({ label, value, urgent }: { label: string; value: number; urgent: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
        urgent ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-600"
      }`}
    >
      {label}
      <span className="tabular-nums">{formatNumber(value)}</span>
    </span>
  );
}
