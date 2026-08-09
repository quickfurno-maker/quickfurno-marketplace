"use client";
// ============================================================================
// QF-MVP-30.2 — Vendor CRM directory (admin-only, client shell).
// Renders the server-paged, server-filtered directory. Filters/search/paging
// live in the URL, so every fetch runs server-side behind the admin guard —
// this component never touches the database or any service-role credential.
// Core facts (verification/enabled/credits) are shown READ-ONLY; there is no
// package/credit editing action here.
// ============================================================================

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { PageHeader, Toolbar, SelectFilter, DataTable, StatusBadge, EmptyState, SecondaryButton } from "../AdminPrimitives";
import type { VendorCrmDirectoryResult, VendorCrmDirectoryRow } from "@/services/vendorCrmService";
import { VENDOR_CRM_ONBOARDING_STAGES, VENDOR_CRM_RELATIONSHIP_STATUSES } from "@/lib/crm/vendorCrmContracts";

type Query = Record<string, string | undefined>;

/**
 * Display-only threshold for the directory's "Low" credit hint. The authoritative
 * warning threshold lives in automation_policy_configs and is enforced server-side
 * by QF-MVP-50.3; this is a read-only visual cue and grants no authority.
 */
const LOW_CREDIT_THRESHOLD = 3;

/** Human labels for the active-filter chips. Keys match the URL query params. */
const FILTER_LABELS: Record<string, string> = {
  search: "Search",
  category: "Category",
  city: "City",
  verification: "Verification",
  enabled: "Enabled",
  onboarding_stage: "Stage",
  relationship_status: "Relationship",
  tagId: "Tag",
  taskState: "Tasks",
};

export function VendorCrmDirectory({
  result, query, tags, error,
}: {
  result: VendorCrmDirectoryResult;
  query: Query;
  tags: { id: string; name: string }[];
  error: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query.search ?? "");

  function apply(next: Record<string, string | undefined>) {
    const sp = new URLSearchParams(params?.toString() ?? "");
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "" || v === "All") sp.delete(k); else sp.set(k, v);
    }
    if (!("page" in next)) sp.set("page", "1"); // any filter change resets to page 1
    startTransition(() => router.push(`/admin/vendor-crm?${sp.toString()}`));
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const selectVal = (k: string, fallback = "All") => query[k] ?? fallback;

  const columns = [
    {
      header: "Vendor", cell: (r: VendorCrmDirectoryRow) => (
        <a href={`/admin/vendor-crm/${r.vendor_id}`} className="block min-w-0">
          <span className="font-semibold text-slate-900">{r.business_name || "Unnamed vendor"}</span>
          <span className="block text-xs text-slate-500">{[r.owner_name, r.city].filter(Boolean).join(" · ") || "—"}</span>
        </a>
      ),
    },
    { header: "Verification", cell: (r: VendorCrmDirectoryRow) => <StatusBadge value={r.status ?? "—"} /> },
    { header: "Enabled", cell: (r: VendorCrmDirectoryRow) => <StatusBadge value={r.is_active === false ? "Disabled" : "Active"} /> },
    {
      header: "Credits",
      cell: (r: VendorCrmDirectoryRow) => {
        const remaining = Number(r.remaining_credits ?? 0);
        const low = remaining <= LOW_CREDIT_THRESHOLD;
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className={`tabular-nums ${low ? "font-semibold text-rose-700" : "text-slate-700"}`}>
              {remaining}/{r.total_credits ?? 0}
            </span>
            {low ? (
              <span className="rounded border border-rose-200 bg-rose-50 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                Low
              </span>
            ) : null}
          </span>
        );
      },
    },
    { header: "Stage", cell: (r: VendorCrmDirectoryRow) => <StatusBadge value={r.onboarding_stage ?? "—"} /> },
    { header: "Relationship", cell: (r: VendorCrmDirectoryRow) => <StatusBadge value={r.relationship_status ?? "—"} /> },
    { header: "Tags", cell: (r: VendorCrmDirectoryRow) => r.active_tags.length ? <span className="text-xs text-slate-600">{r.active_tags.map((t) => t.name).join(", ")}</span> : <span className="text-slate-300">—</span> },
    { header: "Tasks", cell: (r: VendorCrmDirectoryRow) => <span className="text-xs">{r.open_task_count} open{r.overdue_task_count ? ` · ${r.overdue_task_count} overdue` : ""}</span> },
    { header: "Next follow-up", cell: (r: VendorCrmDirectoryRow) => <span className="text-xs text-slate-600">{fmt(r.next_follow_up_at)}</span> },
    { header: "Primary contact", cell: (r: VendorCrmDirectoryRow) => <span className="text-xs text-slate-600">{r.primary_contact_name ?? "—"}</span> },
    { header: "", cell: (r: VendorCrmDirectoryRow) => <a href={`/admin/vendor-crm/${r.vendor_id}`} className="text-xs font-semibold text-emerald-700 hover:underline">View</a> },
  ];

  const hasActiveFilter = ["search", "category", "city", "verification", "enabled", "onboarding_stage", "relationship_status", "tagId", "taskState"].some((k) => query[k]);

  const activeFilters = Object.keys(FILTER_LABELS)
    .filter((key) => query[key])
    .map((key) => {
      const raw = query[key] as string;
      let value = raw;
      if (key === "enabled") value = raw === "true" ? "Enabled" : "Disabled";
      if (key === "taskState") value = raw === "open" ? "Open" : "Overdue";
      if (key === "tagId") value = tags.find((t) => t.id === raw)?.name ?? raw;
      return { key, label: FILTER_LABELS[key], value };
    });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Vendor CRM"
        description="Internal vendor relationship directory — Core facts read-only, CRM enrichment editable. Founder/admin only."
        meta={<StatusBadge value={`${result.total} vendors`} />}
      />

      {/* Enter submits the search — previously the input only responded to the
          button, which made the field feel dead to keyboard users. */}
      <div onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); apply({ search }); } }}>
      <Toolbar
        query={search}
        setQuery={setSearch}
        placeholder="Search business, owner or phone…"
        action={<SecondaryButton onClick={() => apply({ search })}>Search</SecondaryButton>}
        filters={
          <div className="flex flex-wrap gap-2">
            <SelectFilter label="Verification" value={selectVal("verification")} options={["All", "Pending", "Approved", "Rejected", "Suspended"]} onChange={(v) => apply({ verification: v })} />
            <SelectFilter label="Enabled" value={query.enabled === "true" ? "Enabled" : query.enabled === "false" ? "Disabled" : "All"} options={["All", "Enabled", "Disabled"]} onChange={(v) => apply({ enabled: v === "Enabled" ? "true" : v === "Disabled" ? "false" : undefined })} />
            <SelectFilter label="Stage" value={selectVal("onboarding_stage")} options={["All", ...VENDOR_CRM_ONBOARDING_STAGES]} onChange={(v) => apply({ onboarding_stage: v })} />
            <SelectFilter label="Relationship" value={selectVal("relationship_status")} options={["All", ...VENDOR_CRM_RELATIONSHIP_STATUSES]} onChange={(v) => apply({ relationship_status: v })} />
            <SelectFilter label="Tag" value={tags.find((t) => t.id === query.tagId)?.name ?? "All"} options={["All", ...tags.map((t) => t.name)]} onChange={(name) => apply({ tagId: tags.find((t) => t.name === name)?.id })} />
            <SelectFilter label="Tasks" value={query.taskState === "open" ? "Open" : query.taskState === "overdue" ? "Overdue" : "All"} options={["All", "Open", "Overdue"]} onChange={(v) => apply({ taskState: v === "Open" ? "open" : v === "Overdue" ? "overdue" : undefined })} />
            {hasActiveFilter ? <SecondaryButton onClick={() => startTransition(() => router.push("/admin/vendor-crm"))}>Reset</SecondaryButton> : null}
          </div>
        }
      />
      </div>

      {activeFilters.length ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Filtered by</span>
          {activeFilters.map(({ key, label, value }) => (
            <button
              key={key}
              type="button"
              onClick={() => { if (key === "search") setSearch(""); apply({ [key]: undefined }); }}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 outline-none transition hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-4 focus-visible:ring-slate-200"
            >
              <span className="text-slate-500">{label}:</span>
              <span className="max-w-[12rem] truncate">{value}</span>
              <span aria-hidden="true" className="text-slate-400">×</span>
              <span className="sr-only">Remove {label} filter</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <EmptyState title="Could not load the directory" message={error} />
      ) : result.rows.length === 0 ? (
        <EmptyState title="No vendors match" message={hasActiveFilter ? "No vendors match the current filters. Reset to see everyone." : "No vendors exist yet. Vendors created in the marketplace will appear here."} />
      ) : (
        <>
          <div aria-busy={pending}>
            <DataTable columns={columns} rows={result.rows} emptyTitle="No vendors match" emptyMessage="Adjust filters to see more." />
          </div>
          {/* Boundary pages previously rendered enabled buttons that silently did
              nothing. They are now genuinely disabled so the control never lies. */}
          <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
            <span aria-live="polite">
              Page {result.page} of {totalPages} · {result.total} total
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={result.page <= 1}
                onClick={() => apply({ page: String(result.page - 1) })}
                className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition hover:border-slate-300 focus-visible:ring-4 focus-visible:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-slate-200"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={result.page >= totalPages}
                onClick={() => apply({ page: String(result.page + 1) })}
                className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition hover:border-slate-300 focus-visible:ring-4 focus-visible:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-slate-200"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}
