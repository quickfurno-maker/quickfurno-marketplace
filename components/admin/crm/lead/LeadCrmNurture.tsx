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

/**
 * READ-ONLY filtered view of leads whose Core status contains "nurture".
 *
 * There is no nurture automation behind this tab: no sequence, no campaign, no
 * scheduled message, no n8n, no provider. It is a saved filter over the leads
 * already loaded, and the banner says so rather than implying dormant machinery.
 */
export function Nurture({ rows, onSelect }: { rows: CrmRow[]; onSelect: (row: CrmRow) => void }) {
  const nurtureRows = rows.filter((row) => String(row.lead.status ?? "").toLowerCase().includes("nurture"));
  return (
    <div className="space-y-3">
    <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
      Read-only view of leads whose status is marked for nurture. No automated sequence, campaign or message is
      scheduled or sent from this screen.
    </p>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lead detail drawer
// ---------------------------------------------------------------------------
