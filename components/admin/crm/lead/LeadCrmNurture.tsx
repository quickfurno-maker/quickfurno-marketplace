"use client";

import {
  DataTable,
  StatusBadge,
} from "../../AdminPrimitives";
import {
  type Lead,
} from "../../adminTypes";
import {
  formatDate,
} from "../../adminUtils";
import { PRIORITY_TONE, type CrmRow } from "./leadCrmTypes";
import {
  cap,
} from "./leadCrmUtils";

export function Nurture({ rows, onSelect }: { rows: CrmRow[]; onSelect: (row: CrmRow) => void }) {
  const nurtureRows = rows.filter((row) => String(row.lead.status ?? "").toLowerCase().includes("nurture"));
  return (
    <DataTable
      rows={nurtureRows}
      emptyTitle="No nurture leads"
      emptyMessage="Leads marked for nurture will appear here. Automated nurture sequences are not enabled in this phase."
      columns={[
        { header: "Client", cell: (row) => <button type="button" onClick={() => onSelect(row)} className="font-semibold text-emerald-700 hover:underline">{row.name}</button> },
        { header: "Service", cell: (row) => row.service },
        { header: "City", cell: (row) => row.city },
        { header: "Priority", cell: (row) => <StatusBadge value={cap(row.priority)} tone={PRIORITY_TONE[row.priority]} /> },
        { header: "Status", cell: (row) => <StatusBadge value={row.statusLabel} /> },
        { header: "Follow-up", cell: (row) => row.followUp ? formatDate(row.followUp) : "—" },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Lead detail drawer
// ---------------------------------------------------------------------------
