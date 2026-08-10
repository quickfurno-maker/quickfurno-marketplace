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
import {
  Blank,
  DataTable,
  EmptyState,
  FilterChip,
  Muted,
  NoteBar,
  ProgressBar,
  SecondaryButton,
  SelectFilter,
  StatusBadge,
  Toolbar,
} from "../AdminPrimitives";
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
      header: "Vendor",
      cell: (r: VendorCrmDirectoryRow) => (
        <a href={`/admin/vendor-crm/${r.vendor_id}`} className="qfa-focus block min-w-[11rem] max-w-[16rem] rounded">
          <span className="block truncate text-[13px] font-semibold text-slate-950 underline-offset-2 hover:underline">
            {r.business_name || "Unnamed vendor"}
          </span>
          <span className="block truncate text-[11px] text-slate-500">
            {[r.owner_name, r.city].filter(Boolean).join(" · ") || <Blank />}
          </span>
        </a>
      ),
    },
    {
      header: "Account",
      cell: (r: VendorCrmDirectoryRow) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge value={r.status ?? "Unknown"} />
          <StatusBadge value={r.is_active === false ? "Disabled" : "Enabled"} tone={r.is_active === false ? "rose" : "slate"} />
        </span>
      ),
    },
    {
      header: "Credits",
      cell: (r: VendorCrmDirectoryRow) => {
        const remaining = Number(r.remaining_credits ?? 0);
        const total = Number(r.total_credits ?? 0);
        const low = remaining <= LOW_CREDIT_THRESHOLD;
        const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((remaining / total) * 100))) : 0;
        return (
          <span className="block w-24">
            <span className="flex items-baseline justify-between gap-1.5">
              <span className={`text-[13px] tabular-nums ${low ? "font-bold text-rose-700" : "font-semibold text-slate-800"}`}>
                {remaining}
                <span className="font-normal text-slate-400">/{total}</span>
              </span>
              {low ? (
                <span className="rounded-[var(--qfa-radius-xs)] border border-rose-200 bg-rose-50 px-1 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                  Low
                </span>
              ) : null}
            </span>
            {total > 0 ? (
              <span className="mt-1 block">
                <ProgressBar value={pct} tone={low ? "rose" : pct >= 40 ? "emerald" : "amber"} />
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      header: "CRM stage",
      cell: (r: VendorCrmDirectoryRow) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge value={r.onboarding_stage ?? "Not set"} />
          <Muted>{r.relationship_status ?? "No relationship set"}</Muted>
        </span>
      ),
    },
    {
      header: "Tags",
      cell: (r: VendorCrmDirectoryRow) =>
        r.active_tags.length ? (
          <span className="flex max-w-[12rem] flex-wrap gap-1">
            {r.active_tags.slice(0, 3).map((t) => (
              <StatusBadge key={t.id ?? t.name} value={t.name} tone="slate" />
            ))}
            {r.active_tags.length > 3 ? <Muted>+{r.active_tags.length - 3}</Muted> : null}
          </span>
        ) : (
          <Blank />
        ),
    },
    {
      header: "Tasks",
      cell: (r: VendorCrmDirectoryRow) => {
        if (!r.open_task_count && !r.overdue_task_count) return <Blank />;
        return (
          <span className="flex flex-col items-start gap-0.5">
            <span className="text-[13px] font-semibold tabular-nums text-slate-800">{r.open_task_count} open</span>
            {r.overdue_task_count ? (
              <span className="rounded-[var(--qfa-radius-xs)] border border-amber-200 bg-amber-50 px-1 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                {r.overdue_task_count} overdue
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      header: "Next follow-up",
      cell: (r: VendorCrmDirectoryRow) =>
        r.next_follow_up_at ? <span className="whitespace-nowrap text-[13px] text-slate-700">{fmt(r.next_follow_up_at)}</span> : <Blank />,
    },
    {
      header: "Primary contact",
      cell: (r: VendorCrmDirectoryRow) =>
        r.primary_contact_name ? <span className="truncate text-[13px] text-slate-700">{r.primary_contact_name}</span> : <Blank />,
    },
    {
      header: "",
      className: "text-right",
      cell: (r: VendorCrmDirectoryRow) => (
        <a
          href={`/admin/vendor-crm/${r.vendor_id}`}
          aria-label={`Open ${r.business_name || "vendor"} CRM profile`}
          className="qfa-focus inline-flex h-8 items-center rounded-[var(--qfa-radius-sm)] border border-[color:var(--qfa-line)] bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-[color:var(--qfa-line-strong)] hover:bg-slate-50"
        >
          View
        </a>
      ),
    },
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
    <div className="flex flex-col gap-2.5">
      {/* AdminShell already titles this page "Vendor CRM" and prints its
          description, so this is a context line rather than a second header. */}
      <NoteBar>
        <strong className="font-semibold text-slate-800">{result.total} vendors.</strong> Core facts (verification,
        enabled, credits) are read-only here; CRM enrichment is editable on the profile. No package or credit change is
        performed from this screen.
      </NoteBar>

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
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Filtered by</span>
          {activeFilters.map(({ key, label, value }) => (
            <FilterChip
              key={key}
              label={label}
              value={value}
              onRemove={() => { if (key === "search") setSearch(""); apply({ [key]: undefined }); }}
            />
          ))}
        </div>
      ) : null}

      {error ? (
        <div role="alert"><EmptyState title="Could not load the directory" message={error} /></div>
      ) : result.rows.length === 0 ? (
        <EmptyState title="No vendors match" message={hasActiveFilter ? "No vendors match the current filters. Reset to see everyone." : "No vendors exist yet. Vendors created in the marketplace will appear here."} />
      ) : (
        <>
          <div aria-busy={pending} className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <DataTable
              columns={columns}
              rows={result.rows}
              density="compact"
              getRowKey={(row) => row.vendor_id}
              emptyTitle="No vendors match"
              emptyMessage="Adjust filters to see more."
            />
          </div>
          {/* Boundary pages previously rendered enabled buttons that silently did
              nothing. They are now genuinely disabled so the control never lies. */}
          <nav aria-label="Vendor CRM pagination" className="flex items-center justify-between gap-3 text-[13px] text-slate-500">
            <span aria-live="polite">
              Page {result.page} of {totalPages} · {result.total} total
            </span>
            <div className="flex gap-1.5">
              <SecondaryButton size="sm" aria-label="Previous page of vendors" disabled={result.page <= 1} onClick={() => apply({ page: String(result.page - 1) })}>
                Previous
              </SecondaryButton>
              <SecondaryButton size="sm" aria-label="Next page of vendors" disabled={result.page >= totalPages} onClick={() => apply({ page: String(result.page + 1) })}>
                Next
              </SecondaryButton>
            </div>
          </nav>
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
