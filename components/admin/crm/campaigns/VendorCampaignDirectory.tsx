"use client";
// ============================================================================
// QF-MVP-30.4C — campaign directory (admin-only, client shell).
//
// Renders the server-paged, server-filtered campaign list. Status filter and
// paging live in the URL, so every fetch runs server-side behind the admin guard
// — this component never touches the database or any service-role credential.
//
// There is NO send control, NO dispatch control and NO delete control here, and
// there will not be one until the QF-MVP-30.5 fail-closed frequency gate exists.
// ============================================================================

import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, DataTable, StatusBadge, SelectFilter, SecondaryButton, EmptyState } from "../../AdminPrimitives";
import type { VendorCampaignListResult, VendorCampaignRow } from "@/services/vendorCampaignService";

const STATUS_OPTIONS = ["All", "draft", "ready_for_review", "approved", "cancelled", "archived"];
const STATUS_TONE: Record<string, "emerald" | "amber" | "slate" | "blue"> = {
  approved: "emerald", ready_for_review: "amber", draft: "blue",
  cancelled: "slate", archived: "slate",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", ready_for_review: "Ready for review", approved: "Approved",
  cancelled: "Cancelled", archived: "Archived",
};

export function VendorCampaignDirectory({
  result, query, error,
}: {
  result: VendorCampaignListResult;
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
    router.push(`/admin/vendor-crm/campaigns?${sp.toString()}`);
  };

  const totalPages = Math.max(1, Math.ceil(result.total / Math.max(1, result.pageSize)));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vendor campaigns"
        description="Deterministic campaigns over saved segments. Approval authorises a frozen audience — it never sends."
      />

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Approval is not a send.</strong> Approving a campaign authorises an already-frozen
        audience for later execution. Nothing is dispatched here, no message is rendered and no
        provider is contacted. No campaign may send until QF-MVP-30.5 adds a fail-closed frequency
        gate.
      </div>

      {error ? (
        <EmptyState title="Campaigns unavailable" message={error} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SelectFilter
              label="Status"
              value={query.status ?? "All"}
              onChange={(v) => setParam("status", v)}
              options={STATUS_OPTIONS}
            />
            <SecondaryButton onClick={() => router.push("/admin/vendor-crm/campaigns/new")}>
              New campaign
            </SecondaryButton>
          </div>

          <DataTable<VendorCampaignRow>
            columns={[
              {
                header: "Campaign",
                cell: (c) => (
                  <button
                    onClick={() => router.push(`/admin/vendor-crm/campaigns/${c.id}`)}
                    className="text-left font-semibold text-emerald-700 hover:underline"
                  >
                    {c.name}
                  </button>
                ),
              },
              {
                header: "Status",
                cell: (c) => <StatusBadge value={STATUS_LABEL[c.status] ?? c.status} tone={STATUS_TONE[c.status]} />,
              },
              { header: "Purpose", cell: (c) => c.purpose.replace(/_/g, " ") },
              { header: "Consent scope", cell: (c) => c.consent_scope },
              {
                header: "Frozen audience",
                cell: (c) => (
                  <span className="tabular-nums">
                    {c.prepared_recipient_count === null
                      ? "—"
                      : `${c.prepared_recipient_count} (rev ${c.prepared_snapshot_revision ?? "—"})`}
                  </span>
                ),
              },
              { header: "Updated", cell: (c) => new Date(c.updated_at).toLocaleString() },
            ]}
            rows={result.rows}
            emptyTitle="No campaigns yet"
            emptyMessage="Create a campaign over a saved segment to freeze and review an audience."
          />

          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              {result.total} campaign{result.total === 1 ? "" : "s"} · page {result.page} of {totalPages}
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
