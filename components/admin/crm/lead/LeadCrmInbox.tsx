"use client";

// ============================================================================
// C-PERF1 — server-paged Lead CRM Inbox.
//
// The Inbox no longer filters a preloaded latest-50 array in the browser.
// It fetches 20 rows per page from the server (adminCrmInboxPage), where
// search/filters/quick-filters are applied over the FULL leads table, and the
// clarification state ships only for the rows on the current page. Detailed
// per-lead history stays on demand in the drawer (see CRMDashboard).
//
// Filter semantics (all server-side, real stored fields):
//   * Quality — leads.lead_quality_class (A+/A/B/C/D/Unclassified), replacing
//     the old derived-priority filter, which could not be evaluated globally.
//   * Intent — leads.lead_intent.
//   * Quick filters — created_at / quality class / assignment presence /
//     status patterns identical to statusBucket().
// Display-only labels (priority chips, badges) are still derived per row.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { adminCrmInboxPage } from "@/app/actions";
import {
  ActionMenu,
  DataTable,
  FilterChip,
  SelectFilter,
  StatusBadge,
  Toolbar,
} from "../../AdminPrimitives";
import { Pagination } from "../../Pagination";
import { formatDate } from "../../adminUtils";
import { emptySnapshot } from "../../adminTypes";
import { PRIORITY_TONE, QUICK_FILTER_LABEL, type CrmRow, type QuickFilter } from "./leadCrmTypes";
import {
  waNumber,
  followUpDue,
  clarificationBadge,
  buildRows,
  cap,
} from "./leadCrmUtils";

const QUALITY_OPTIONS = ["All", "A+", "A", "B", "C", "D", "Unclassified"];

export function LeadInbox({
  quickFilter,
  setQuickFilter,
  onSelect,
  onUpdateStatus,
  onAssign,
  isPending,
  filterOptions,
  reloadToken,
}: {
  quickFilter: QuickFilter;
  setQuickFilter: (f: QuickFilter) => void;
  onSelect: (row: CrmRow) => void;
  onUpdateStatus: (leadId: string, status: string) => void;
  onAssign: (row: CrmRow) => void;
  isPending: boolean;
  filterOptions: { cities: string[]; services: string[]; sources: string[] };
  /** Incremented by the parent after a successful mutation so the current
   *  page refetches without losing filters. */
  reloadToken: number;
}) {
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("All");
  const [service, setService] = useState("All");
  const [quality, setQuality] = useState("All");
  const [source, setSource] = useState("All");
  const [intent, setIntent] = useState("All");
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<CrmRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  // Debounce the search box before it becomes a server query.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft);
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  // Quick filter changes (from Overview cards or chips) reset paging.
  useEffect(() => {
    setPage(1);
  }, [quickFilter]);

  useEffect(() => {
    let cancelled = false;
    const seq = ++requestSeq.current;
    setLoading(true);
    (async () => {
      const result = await adminCrmInboxPage({ page, search, city, service, quality, source, intent, quick: quickFilter });
      if (cancelled || seq !== requestSeq.current) return;
      if (!result.ok) {
        setLoadError(result.error ?? "Could not load leads.");
        setRows([]);
        setTotal(0);
        setLoading(false);
        return;
      }
      const payload = result.data as {
        result: { rows: unknown[]; page: number; pageSize: number; total: number };
        clarifications: unknown[];
      };
      setLoadError(null);
      setRows(
        buildRows({
          ...emptySnapshot(),
          leads: payload.result.rows as any[],
          leadClarificationRequests: payload.clarifications as any[],
        }),
      );
      setTotal(payload.result.total);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [page, search, city, service, quality, source, intent, quickFilter, reloadToken]);

  const setFilter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  const activeSelects: Array<{ key: string; label: string; value: string; clear: () => void }> = [
    { key: "city", label: "City", value: city, clear: () => setFilter(setCity)("All") },
    { key: "service", label: "Service", value: service, clear: () => setFilter(setService)("All") },
    { key: "quality", label: "Quality", value: quality, clear: () => setFilter(setQuality)("All") },
    { key: "source", label: "Source", value: source, clear: () => setFilter(setSource)("All") },
    { key: "intent", label: "Intent", value: intent, clear: () => setFilter(setIntent)("All") },
  ].filter((f) => f.value !== "All");

  return (
    <div className="space-y-2.5" aria-busy={loading}>
      <div className="sticky top-2 z-20">
        <Toolbar
          query={searchDraft}
          setQuery={setSearchDraft}
          placeholder="Search name, phone, city, service, status…"
          filters={
            <>
              <SelectFilter label="City" value={city} onChange={setFilter(setCity)} options={["All", ...filterOptions.cities]} />
              <SelectFilter label="Service" value={service} onChange={setFilter(setService)} options={["All", ...filterOptions.services]} />
              <SelectFilter label="Quality" value={quality} onChange={setFilter(setQuality)} options={QUALITY_OPTIONS} />
              <SelectFilter label="Source" value={source} onChange={setFilter(setSource)} options={["All", ...filterOptions.sources]} />
              <SelectFilter label="Intent" value={intent} onChange={setFilter(setIntent)} options={["All", "Preferred vendor", "General auto-match"]} />
            </>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-slate-500">
          Search and filters cover the complete lead database. Quality filters the stored classification.
        </span>
        {quickFilter !== "all" ? (
          <FilterChip
            label="Quick filter"
            value={QUICK_FILTER_LABEL[quickFilter]}
            onRemove={() => setQuickFilter("all")}
          />
        ) : null}
        {activeSelects.map((filter) => (
          <FilterChip key={filter.key} label={filter.label} value={filter.value} onRemove={filter.clear} />
        ))}
        {isPending ? <span className="text-[11px] text-slate-400">Saving…</span> : null}
      </div>

      {loadError ? (
        <p className="rounded-[var(--qfa-radius)] border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          {loadError}
        </p>
      ) : null}

      <DataTable
        rows={rows}
        density="compact"
        getRowKey={(row) => row.id}
        emptyTitle={loading ? "Loading leads…" : "No leads match this view"}
        emptyMessage={loading ? "Fetching the current page from the server." : "Adjust the filters, clear the quick filter, or wait for new lead submissions."}
        columns={[
          {
            header: "Lead",
            cell: (row) => (
              <div className="min-w-[12rem]">
                <button
                  type="button"
                  onClick={() => onSelect(row)}
                  className="qfa-focus block max-w-full truncate rounded text-left text-[13px] font-semibold text-slate-950 underline-offset-2 hover:underline"
                >
                  {row.name}
                </button>
                <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{row.phone}</p>
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
              <div className="min-w-[9rem]">
                <p className="truncate text-[13px] font-medium text-slate-800">{row.service}</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  {[row.budget, row.timeline].filter((v) => v && v !== "Not set").join(" · ") || "No budget / timeline"}
                </p>
              </div>
            ),
          },
          {
            header: "Location",
            cell: (row) => (
              <span className="whitespace-nowrap text-[13px] text-slate-700">
                {[row.area, row.city].filter((v) => v && v !== "Not set").join(", ") || row.city}
              </span>
            ),
          },
          {
            header: "Quality",
            cell: (row) => (
              <div className="flex flex-col items-start gap-1">
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
          { header: "Created", cell: (row) => <span className="whitespace-nowrap text-[11px] text-slate-500">{formatDate(row.createdAt)}</span> },
          {
            header: "Actions",
            className: "text-right",
            cell: (row) => (
              <div className="flex items-center justify-end gap-1">
                {row.phoneDigits ? (
                  <>
                    <a
                      href={`tel:${row.phoneDigits}`}
                      aria-label={`Call ${row.name}`}
                      className="qfa-focus inline-flex h-8 items-center rounded-[var(--qfa-radius-sm)] border border-[color:var(--qfa-line)] bg-white px-2 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      Call
                    </a>
                    <a
                      href={`https://wa.me/${waNumber(row.phoneDigits)}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open WhatsApp chat with ${row.name}`}
                      className="qfa-focus inline-flex h-8 items-center rounded-[var(--qfa-radius-sm)] border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-100"
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

      <Pagination
        page={page}
        pageSize={20}
        total={total}
        noun="matching leads"
        isPending={loading}
        onPageChange={setPage}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Board
// ---------------------------------------------------------------------------
