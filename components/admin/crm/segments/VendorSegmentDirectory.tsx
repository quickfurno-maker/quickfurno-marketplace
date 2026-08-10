"use client";
// ============================================================================
// QF-MVP-30.3C — deterministic segment directory (admin-only, client shell).
// Renders the server-paged, server-filtered segment list. Status filter and
// paging live in the URL, so every fetch runs server-side behind the admin
// guard — this component never touches the database or any service-role
// credential. A segment is a saved question: there is no send control here.
// ============================================================================

import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, DataTable, StatusBadge, SelectFilter, SecondaryButton, EmptyState } from "../../AdminPrimitives";
import { formatDateTime } from "../../adminUtils";
import type { VendorSegmentListResult, VendorSegmentRow } from "@/services/vendorSegmentService";

const STATUS_OPTIONS = ["All", "draft", "active", "archived"];
const STATUS_TONE: Record<string, "emerald" | "amber" | "slate"> = {
  active: "emerald", draft: "amber", archived: "slate",
};

export function VendorSegmentDirectory({
  result, query, error,
}: {
  result: VendorSegmentListResult;
  query: Record<string, string | undefined>;
  error: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const setParam = (key: string, value?: string) => {
    const sp = new URLSearchParams(params?.toString() ?? "");
    if (value === undefined || value === "" || value === "All") sp.delete(key);
    else sp.set(key, value);
    if (key !== "page") sp.delete("page");
    router.push(`/admin/vendor-crm/segments?${sp.toString()}`);
  };

  const totalPages = Math.max(1, Math.ceil(result.total / Math.max(1, result.pageSize)));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vendor segments"
        description="Deterministic saved rules over Core and CRM facts. A segment is a saved question — it is never permission to contact anyone."
      />

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Preview only — not communication authorization.</strong> Segments describe who matches
        a rule right now. Consent, suppression and send approval are decided separately at campaign
        time and are never inferred from a segment.
      </div>

      {error ? (
        <EmptyState title="Segments unavailable" message={error} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SelectFilter
              label="Status"
              value={query.status ?? "All"}
              onChange={(v) => setParam("status", v)}
              options={STATUS_OPTIONS}
            />
            <SecondaryButton onClick={() => router.push("/admin/vendor-crm/segments/new")}>
              New segment
            </SecondaryButton>
          </div>

          <DataTable<VendorSegmentRow>
            columns={[
              {
                header: "Segment",
                cell: (s) => (
                  <button
                    type="button"
                    onClick={() => router.push(`/admin/vendor-crm/segments/${s.id}`)}
                    className="qfa-focus inline-flex min-h-10 appearance-none items-center rounded border-0 bg-transparent p-0 text-left font-semibold text-emerald-700 hover:underline sm:min-h-0"
                  >
                    {s.name}
                  </button>
                ),
              },
              { header: "Status", cell: (s) => <StatusBadge value={s.status} tone={STATUS_TONE[s.status]} /> },
              { header: "Version", cell: (s) => <span className="tabular-nums">v{s.definition_version}</span> },
              {
                header: "Fingerprint",
                cell: (s) => (
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                    {s.definition_fingerprint.slice(0, 12)}…
                  </code>
                ),
              },
              { header: "Updated", cell: (s) => formatDateTime(s.updated_at) },
            ]}
            rows={result.rows}
            emptyTitle="No segments yet"
            emptyMessage="Create a deterministic segment to describe a vendor population."
          />

          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              {result.total} segment{result.total === 1 ? "" : "s"} · page {result.page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <SecondaryButton onClick={() => setParam("page", String(Math.max(1, result.page - 1)))}>
                Previous
              </SecondaryButton>
              <SecondaryButton onClick={() => setParam("page", String(Math.min(totalPages, result.page + 1)))}>
                Next
              </SecondaryButton>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
