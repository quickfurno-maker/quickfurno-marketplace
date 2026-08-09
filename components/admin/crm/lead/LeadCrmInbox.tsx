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
  isPending,
}: {
  rows: CrmRow[];
  quickFilter: QuickFilter;
  setQuickFilter: (f: QuickFilter) => void;
  onSelect: (row: CrmRow) => void;
  onUpdateStatus: (leadId: string, status: string) => void;
  onAssign: (row: CrmRow) => void;
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
          {
            header: "Lead",
            cell: (row) => (
              <div className="min-w-[13rem]">
                <button
                  type="button"
                  onClick={() => onSelect(row)}
                  className="rounded text-left font-semibold text-slate-900 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-slate-300"
                >
                  {row.name}
                </button>
                <p className="mt-0.5 font-mono text-xs text-slate-500">{row.phone}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <StatusBadge value={row.source} tone="slate" />
                  {row.preferredBadge ? <StatusBadge value={row.preferredBadge.label} tone={row.preferredBadge.tone} /> : null}
                </div>
              </div>
            ),
          },
          {
            header: "Requirement",
            cell: (row) => (
              <div className="min-w-[10rem]">
                <p className="font-medium text-slate-800">{row.service}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {[row.budget, row.timeline].filter((v) => v && v !== "Not set").join(" · ") || "No budget / timeline"}
                </p>
              </div>
            ),
          },
          {
            header: "Location",
            cell: (row) => (
              <span className="whitespace-nowrap text-slate-700">
                {[row.area, row.city].filter((v) => v && v !== "Not set").join(", ") || row.city}
              </span>
            ),
          },
          {
            header: "Quality",
            cell: (row) => (
              <div className="flex flex-col gap-1">
                <StatusBadge value={cap(row.priority)} tone={PRIORITY_TONE[row.priority]} />
                {row.qualityBadge ? <StatusBadge value={row.qualityBadge.label} tone={row.qualityBadge.tone} /> : null}
              </div>
            ),
          },
          { header: "Stage", cell: (row) => <StatusBadge value={row.statusLabel} /> },
          {
            header: "Clarification",
            cell: (row) => {
              const b = clarificationBadge(row);
              return <StatusBadge value={b.label} tone={b.tone} />;
            },
          },
          {
            header: "Assignment",
            cell: (row) => (
              <StatusBadge
                value={row.assignedCount === 0 ? "Unassigned" : `${row.assignedCount} vendor${row.assignedCount === 1 ? "" : "s"}`}
                tone={row.assignedCount === 0 ? "amber" : "emerald"}
              />
            ),
          },
          {
            header: "Follow-up",
            cell: (row) =>
              row.followUp ? (
                <StatusBadge
                  value={followUpDue(row.followUp) ? `Due ${formatDate(row.followUp)}` : formatDate(row.followUp)}
                  tone={followUpDue(row.followUp) ? "rose" : "slate"}
                />
              ) : (
                <span className="text-slate-400">None</span>
              ),
          },
          { header: "Created", cell: (row) => <span className="whitespace-nowrap text-slate-600">{formatDate(row.createdAt)}</span> },
          {
            header: "Actions",
            cell: (row) => (
              <div className="flex items-center gap-1.5">
                {row.phoneDigits ? (
                  <>
                    <a
                      href={`tel:${row.phoneDigits}`}
                      aria-label={`Call ${row.name}`}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-300"
                    >
                      Call
                    </a>
                    <a
                      href={`https://wa.me/${waNumber(row.phoneDigits)}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open WhatsApp chat with ${row.name}`}
                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 outline-none transition hover:bg-emerald-100 focus-visible:ring-2 focus-visible:ring-emerald-300"
                    >
                      WA
                    </a>
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
                  ]}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Board
// ---------------------------------------------------------------------------
