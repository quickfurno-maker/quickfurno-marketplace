"use client";

import { useMemo, useState } from "react";
import {
  ActionMenu,
  DataTable,
  SelectFilter,
  StatusBadge,
  Toolbar,
} from "../../AdminPrimitives";
import {
  formatDate,
  formatNumber,
  includesQuery,
  uniqueOptions,
} from "../../adminUtils";
import { PRIORITY_TONE, QUICK_FILTER_LABEL, type CrmRow, type QuickFilter } from "./leadCrmTypes";
import {
  waNumber,
  preferredBadge,
  followUpDue,
  clarificationBadge,
  passesQuickFilter,
  cap,
} from "./leadCrmUtils";

export function LeadInbox({
  rows,
  quickFilter,
  setQuickFilter,
  onSelect,
  onUpdateStatus,
  onAssign,
  onScheduleFollowUp,
  isPending,
}: {
  rows: CrmRow[];
  quickFilter: QuickFilter;
  setQuickFilter: (f: QuickFilter) => void;
  onSelect: (row: CrmRow) => void;
  onUpdateStatus: (leadId: string, status: string) => void;
  onAssign: (row: CrmRow) => void;
  onScheduleFollowUp: (row: CrmRow) => void;
  isPending: boolean;
}) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("All");
  const [service, setService] = useState("All");
  const [priority, setPriority] = useState("All");
  const [source, setSource] = useState("All");
  const [intent, setIntent] = useState("All");

  const filtered = useMemo(() => rows.filter((row) => {
    return passesQuickFilter(row, quickFilter)
      && includesQuery([row.name, row.phone, row.city, row.area, row.service, row.statusLabel, row.source, row.priority, row.qualityBadge?.label], query)
      && (city === "All" || row.city === city)
      && (service === "All" || row.service === service)
      && (priority === "All" || row.priority === priority.toLowerCase())
      && (source === "All" || row.source === source)
      && (intent === "All" || (intent === "Preferred vendor" ? row.isPreferred : !row.isPreferred));
  }), [rows, quickFilter, query, city, service, priority, source, intent]);

  return (
    <div className="space-y-4">
      <div className="sticky top-2 z-20">
        <Toolbar
          query={query}
          setQuery={setQuery}
          placeholder="Search name, phone, city, service, status…"
          filters={
            <>
              <SelectFilter label="City" value={city} onChange={setCity} options={uniqueOptions(rows.map((r) => r.city))} />
              <SelectFilter label="Service" value={service} onChange={setService} options={uniqueOptions(rows.map((r) => r.service))} />
              <SelectFilter label="Priority" value={priority} onChange={setPriority} options={["All", "Hot", "Warm", "Cold", "Weak", "Spam", "Duplicate"]} />
              <SelectFilter label="Source" value={source} onChange={setSource} options={uniqueOptions(rows.map((r) => r.source))} />
              <SelectFilter label="Intent" value={intent} onChange={setIntent} options={["All", "Preferred vendor", "General auto-match"]} />
            </>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-500">Showing {formatNumber(filtered.length)} of {formatNumber(rows.length)}</span>
        {quickFilter !== "all" ? (
          <button
            type="button"
            onClick={() => setQuickFilter("all")}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700"
          >
            {QUICK_FILTER_LABEL[quickFilter]} <span aria-hidden>✕</span>
          </button>
        ) : null}
        {isPending ? <span className="text-slate-400">Saving…</span> : null}
      </div>

      <DataTable
        rows={filtered}
        emptyTitle="No leads match this view"
        emptyMessage="Adjust the filters, clear the quick filter, or wait for new lead submissions."
        columns={[
          { header: "Priority", cell: (row) => <StatusBadge value={cap(row.priority)} tone={PRIORITY_TONE[row.priority]} /> },
          { header: "Quality", cell: (row) => row.qualityBadge
            ? <StatusBadge value={row.qualityBadge.label} tone={row.qualityBadge.tone} />
            : <StatusBadge value="Not scored" tone="slate" /> },
          { header: "Clarification", cell: (row) => { const b = clarificationBadge(row); return <StatusBadge value={b.label} tone={b.tone} />; } },
          { header: "Client", cell: (row) => (
            <div className="min-w-40">
              <p className="font-semibold text-slate-900">{row.name}</p>
              {row.preferredBadge ? <div className="mt-1"><StatusBadge value={row.preferredBadge.label} tone={row.preferredBadge.tone} /></div> : null}
            </div>
          ) },
          { header: "Phone", cell: (row) => row.phoneDigits
            ? <a href={`tel:${row.phoneDigits}`} className="font-mono text-sm text-emerald-700 hover:underline">{row.phone}</a>
            : <span className="text-slate-400">Not set</span> },
          { header: "City / Area", cell: (row) => <span className="whitespace-nowrap">{[row.area, row.city].filter((v) => v && v !== "Not set").join(", ") || row.city}</span> },
          { header: "Service", cell: (row) => <span className="whitespace-nowrap">{row.service}</span> },
          { header: "Budget", cell: (row) => row.budget },
          { header: "Timeline", cell: (row) => row.timeline },
          { header: "Source", cell: (row) => <StatusBadge value={row.source} /> },
          { header: "Intent", cell: (row) => <StatusBadge value={row.isPreferred ? "Preferred" : "Auto-match"} tone={row.isPreferred ? "violet" : "slate"} /> },
          { header: "Vendors", cell: (row) => <StatusBadge value={`${row.assignedCount}/3`} tone={row.assignedCount > 0 ? "emerald" : "amber"} /> },
          { header: "Status", cell: (row) => <StatusBadge value={row.statusLabel} /> },
          { header: "Created", cell: (row) => <span className="whitespace-nowrap">{formatDate(row.createdAt)}</span> },
          { header: "Next follow-up", cell: (row) => row.followUp
            ? <StatusBadge value={formatDate(row.followUp)} tone={followUpDue(row.followUp) ? "rose" : "slate"} />
            : <span className="text-slate-400">—</span> },
          { header: "Actions", cell: (row) => (
            <div className="flex items-center gap-1.5">
              {row.phoneDigits ? (
                <>
                  <a href={`tel:${row.phoneDigits}`} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50" title="Call client">Call</a>
                  <a href={`https://wa.me/${waNumber(row.phoneDigits)}`} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100" title="Open WhatsApp">WA</a>
                </>
              ) : null}
              <ActionMenu
                actions={[
                  { label: "View details", onClick: () => onSelect(row) },
                  { label: "Mark contacted", onClick: () => onUpdateStatus(row.id, "Contacted") },
                  { label: "Mark converted", onClick: () => onUpdateStatus(row.id, "Converted") },
                  { label: "Mark lost", onClick: () => onUpdateStatus(row.id, "Lost") },
                  { label: "Mark spam", onClick: () => onUpdateStatus(row.id, "Spam") },
                  { label: "Assign vendor", onClick: () => onAssign(row) },
                  { label: "Schedule follow-up", onClick: () => onScheduleFollowUp(row) },
                ]}
              />
            </div>
          ) },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Board
// ---------------------------------------------------------------------------
