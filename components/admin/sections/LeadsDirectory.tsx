"use client";

// ============================================================================
// C-PERF1 — server-paged Leads directory.
//
// Replaces the old client-filtered latest-50 LeadsPage. Search, filters and
// pagination now run SERVER-SIDE over the full leads table (20 rows/page,
// locked policy), with URL-backed state so back/forward and refresh preserve
// the view. Totals come from count queries, never from loaded-array length.
// Dark command-center visual system unchanged.
// ============================================================================

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { adminUpdateLeadStatus } from "@/app/actions";
import {
  ActionMenu,
  DataTable,
  SelectFilter,
  StatCard,
  StatusBadge,
  Toast,
  Toolbar,
} from "../AdminPrimitives";
import { Pagination } from "../Pagination";
import { type Lead, type LeadsDirectoryData, type Snapshot, emptySnapshot } from "../adminTypes";
import { formatDate, formatNumber, maskPhone } from "../adminUtils";
import { BadLeadReportsReviewPanel } from "../LeadMatchingAuditPanels";
import { Strong } from "./shared";
import { LeadDetailDrawer, LeadPriorityBadge, SourceBadge, leadStatuses } from "./LeadsSection";

type BadLeadReview = Pick<Snapshot, "badReports" | "badLeadReportComments" | "assignments" | "vendors" | "leads">;

const FILTER_KEYS = ["search", "city", "category", "status", "source", "priority"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

export function LeadsDirectory({
  data,
  badLeadReview,
  error,
}: {
  data: LeadsDirectoryData | null;
  badLeadReview: BadLeadReview | null;
  error?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Lead | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);

  const result = data?.result ?? { rows: [], page: 1, pageSize: 20, total: 0 };
  const totals = data?.totals ?? { all: 0, hot: 0, unassigned: null };

  const params = useMemo(() => {
    const out: Record<FilterKey, string> = { search: "", city: "All", category: "All", status: "All", source: "All", priority: "All" };
    FILTER_KEYS.forEach((key) => {
      const value = searchParams.get(key);
      if (value) out[key] = value;
    });
    return out;
  }, [searchParams]);

  // Local echo of the search box so typing stays instant; committed to the URL
  // (and therefore to the server query) after a short debounce.
  const [searchDraft, setSearchDraft] = useState(params.search);
  useEffect(() => setSearchDraft(params.search), [params.search]);

  const navigate = useCallback(
    (updates: Record<string, string | number | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === "" || value === "All" || (key === "page" && Number(value) <= 1)) next.delete(key);
        else next.set(key, String(value));
      });
      startTransition(() => {
        router.replace(`${pathname}${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
      });
    },
    [router, pathname, searchParams],
  );

  // Changing any filter resets to page 1 (locked pagination behaviour).
  const setFilter = useCallback((key: FilterKey, value: string) => navigate({ [key]: value, page: null }), [navigate]);

  useEffect(() => {
    if (searchDraft === params.search) return;
    const timer = window.setTimeout(() => setFilter("search", searchDraft), 350);
    return () => window.clearTimeout(timer);
  }, [searchDraft, params.search, setFilter]);

  function notify(message: string, tone: "success" | "error" | "info" = "info") {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 2800);
  }

  function runAction(title: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const actionResult = await action();
      if (!actionResult.ok) {
        notify(actionResult.error ?? `${title} failed.`, "error");
        return;
      }
      notify(`${title} completed.`, "success");
      router.refresh();
    });
  }

  const reviewData: Snapshot = useMemo(
    () => ({ ...emptySnapshot(), ...(badLeadReview ?? {}) }),
    [badLeadReview],
  );

  return (
    <div className="space-y-5" aria-busy={isPending}>
      {error ? (
        <div className="rounded-[var(--qfa-radius)] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          Leads could not be loaded: {error}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="All Leads" value={formatNumber(totals.all)} helper="Total in database (live count)" icon="leads" />
        <StatCard label="Hot Leads" value={formatNumber(totals.hot)} helper="High intent or scored (live count)" icon="notifications" tone="amber" />
        {totals.unassigned !== null ? (
          <StatCard label="Unassigned" value={formatNumber(totals.unassigned)} helper="Open, no vendor yet (live count)" icon="distribution" tone="rose" />
        ) : (
          <StatCard label="Unassigned" value="—" helper="Count unavailable right now" icon="distribution" tone="slate" />
        )}
        <StatCard label="Matching Filters" value={formatNumber(result.total)} helper="Across the whole database" icon="reports" tone="slate" />
      </section>

      <Toolbar
        query={searchDraft}
        setQuery={setSearchDraft}
        placeholder="Search name, phone, city, category, status, source…"
        filters={
          <>
            <SelectFilter label="City" value={params.city} onChange={(v) => setFilter("city", v)} options={["All", ...(data?.filterOptions.cities ?? [])]} />
            <SelectFilter label="Category" value={params.category} onChange={(v) => setFilter("category", v)} options={["All", ...(data?.filterOptions.categories ?? [])]} />
            <SelectFilter label="Status" value={params.status} onChange={(v) => setFilter("status", v)} options={leadStatuses} />
            <SelectFilter label="Priority" value={params.priority} onChange={(v) => setFilter("priority", v)} options={["All", "Hot", "High", "Normal", "Low"]} />
            <SelectFilter label="Source" value={params.source} onChange={(v) => setFilter("source", v)} options={["All", "Website", "WhatsApp", "Google Ads", "Referral", "Manual"]} />
          </>
        }
      />

      <p className="text-[11px] text-slate-500">
        Search and filters apply to the complete lead database. The Priority filter matches the stored lead priority field.
      </p>

      {badLeadReview ? <BadLeadReportsReviewPanel data={reviewData} notify={notify} runAction={runAction} /> : null}

      <DataTable
        rows={result.rows}
        density="compact"
        getRowKey={(lead) => lead.id}
        emptyTitle="No leads match this view"
        emptyMessage="Try a different search or filter, or wait for new public form submissions."
        columns={[
          { header: "Client", cell: (lead) => <Strong title={lead.name || "Unnamed lead"} subtitle={maskPhone(lead.phone)} /> },
          { header: "Requirement", cell: (lead) => <Strong title={lead.service_required || lead.category || "Not set"} subtitle={lead.city || "City not set"} /> },
          { header: "Budget", cell: (lead) => lead.budget || "Not set" },
          { header: "Priority", cell: (lead) => <LeadPriorityBadge lead={lead} /> },
          { header: "Source", cell: (lead) => <SourceBadge value={lead.source || "Website"} /> },
          { header: "Status", cell: (lead) => <StatusBadge value={lead.status || "New"} /> },
          { header: "Assigned", cell: (lead) => <StatusBadge value={`${formatNumber(lead.lead_assignments?.length ?? 0)} vendors`} tone={(lead.lead_assignments?.length ?? 0) > 0 ? "emerald" : "amber"} /> },
          { header: "Created", cell: (lead) => formatDate(lead.created_at) },
          {
            header: "Actions",
            cell: (lead) => (
              <ActionMenu
                actions={[
                  { label: "View lead", onClick: () => setSelected(lead) },
                  { label: "Mark contacted", onClick: () => runAction("Lead status update", () => adminUpdateLeadStatus(lead.id, "Contacted")) },
                ]}
              />
            ),
          },
        ]}
      />

      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        noun={result.total === totals.all ? "leads" : "matching leads"}
        isPending={isPending}
        onPageChange={(page) => navigate({ page })}
      />

      {selected ? <LeadDetailDrawer lead={selected} vendors={reviewData.vendors} onClose={() => setSelected(null)} /> : null}
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  );
}
