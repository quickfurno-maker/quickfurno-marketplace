"use client";

import {
  DataTable,
  StatusBadge,
} from "../../AdminPrimitives";
import {
  type Assignment,
} from "../../adminTypes";
import {
  formatDate,
} from "../../adminUtils";
import { PRIORITY_TONE, type CrmRow } from "./leadCrmTypes";
import {
  followUpDue,
  cap,
} from "./leadCrmUtils";

export function FollowUps({ rows, onSelect }: { rows: CrmRow[]; onSelect: (row: CrmRow) => void }) {
  const withFollowUp = rows
    .filter((row) => row.followUp)
    .sort((a, b) => new Date(a.followUp ?? 0).getTime() - new Date(b.followUp ?? 0).getTime());

  return (
    <DataTable
      rows={withFollowUp}
      emptyTitle="No scheduled follow-ups"
      emptyMessage="Leads with a follow_up_date will appear here. Scheduling new follow-ups is not enabled in this phase."
      columns={[
        { header: "Client", cell: (row) => <button type="button" onClick={() => onSelect(row)} className="font-semibold text-emerald-700 hover:underline">{row.name}</button> },
        { header: "Service", cell: (row) => row.service },
        { header: "City", cell: (row) => row.city },
        { header: "Priority", cell: (row) => <StatusBadge value={cap(row.priority)} tone={PRIORITY_TONE[row.priority]} /> },
        { header: "Status", cell: (row) => <StatusBadge value={row.statusLabel} /> },
        { header: "Follow-up", cell: (row) => <StatusBadge value={formatDate(row.followUp)} tone={followUpDue(row.followUp) ? "rose" : "slate"} /> },
        { header: "State", cell: (row) => <StatusBadge value={followUpDue(row.followUp) ? "Due / overdue" : "Upcoming"} tone={followUpDue(row.followUp) ? "amber" : "slate"} /> },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Assignment Queue (real lead_assignment_queue rows)
// ---------------------------------------------------------------------------
