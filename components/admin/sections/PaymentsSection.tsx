"use client";

// ============================================================================
// C-PERF2 — server-paged Payments directory (20/page, URL-backed state).
// KPI totals come from aggregate/count queries over the FULL payment ledger;
// vendor/package names resolve via bounded current-page IN lookups.
// ============================================================================

import { type ReactNode, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DataTable,
  SectionCard,
  SelectFilter,
  StatCard,
  StatusBadge,
  Toolbar,
} from "../AdminPrimitives";
import { Pagination } from "../Pagination";
import { type PackageRow, type Payment, type Vendor } from "../adminTypes";
import {
  formatDate,
  formatINR,
  formatNumber,
  packageName,
  shortId,
  vendorName,
} from "../adminUtils";
import { Strong } from "./shared";

export type AdminPaymentsPageData = {
  result: { rows: Payment[]; page: number; pageSize: number; total: number };
  totals: { totalRevenue: number; revenueThisMonth: number; paidCount: number; pendingCount: number; expiredVendors: number };
  vendors: Vendor[];
  packages: PackageRow[];
};

export function PaymentsPage({ data }: { data: AdminPaymentsPageData | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const result = data?.result ?? { rows: [], page: 1, pageSize: 20, total: 0 };
  const totals = data?.totals ?? { totalRevenue: 0, revenueThisMonth: 0, paidCount: 0, pendingCount: 0, expiredVendors: 0 };
  const status = searchParams.get("status") ?? "All";
  const urlSearch = searchParams.get("search") ?? "";
  const [searchDraft, setSearchDraft] = useState(urlSearch);
  useEffect(() => setSearchDraft(urlSearch), [urlSearch]);

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

  useEffect(() => {
    if (searchDraft === urlSearch) return;
    const timer = window.setTimeout(() => navigate({ search: searchDraft, page: null }), 350);
    return () => window.clearTimeout(timer);
  }, [searchDraft, urlSearch, navigate]);

  const vendorPool = useMemo(() => data?.vendors ?? [], [data?.vendors]);
  const packages = data?.packages ?? [];

  return (
    <div className="space-y-5" aria-busy={isPending}>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Revenue" value={formatINR(totals.totalRevenue)} helper={`${formatNumber(totals.paidCount)} paid payments (live)`} icon="payments" />
        <StatCard label="Monthly Revenue" value={formatINR(totals.revenueThisMonth)} helper="This month (live aggregate)" icon="reports" tone="emerald" />
        <StatCard label="Pending Collections" value={formatNumber(totals.pendingCount)} helper="Needs follow-up (live count)" icon="notifications" tone="amber" />
        <StatCard label="Renewal Risk" value={formatNumber(totals.expiredVendors)} helper="Expired vendors (live count)" icon="subscriptions" tone="rose" />
      </section>

      {/* Manual collection, invoice download and renewal follow-up have no
          implementation, so they are listed as scope rather than offered as
          controls. */}
      <SectionCard title="Not built yet" description="No collection, invoicing or renewal action is available from this page.">
        <ul className="grid gap-1.5 sm:grid-cols-3">
          {["Manual collection", "Invoice download", "Renewal follow-up"].map((item) => (
            <li key={item} className="flex items-center justify-between gap-2 text-[13px] text-slate-700">
              <span className="min-w-0 truncate">{item}</span>
              <StatusBadge value="Not built" tone="slate" />
            </li>
          ))}
        </ul>
      </SectionCard>

      <Toolbar
        query={searchDraft}
        setQuery={setSearchDraft}
        placeholder="Search transaction id or payment method…"
        filters={
          <SelectFilter
            label="Status"
            value={status}
            onChange={(value) => navigate({ status: value, page: null })}
            options={["All", "Paid", "Pending", "Failed", "Refunded"]}
          />
        }
      />

      <DataTable
        rows={result.rows}
        density="compact"
        getRowKey={(row) => row.id}
        emptyTitle="No payments found"
        emptyMessage="Manual package payments and future gateway payments will appear here."
        columns={[
          { header: "Payment ID", cell: (row) => <Strong title={shortId(row.id)} subtitle={formatDate(row.created_at)} /> },
          { header: "Vendor", cell: (row) => vendorName(vendorPool, row.vendor_id) },
          { header: "Package", cell: (row) => packageName(packages, row.package_id) },
          { header: "Amount", cell: (row) => <span className="font-semibold text-slate-950">{formatINR(row.amount)}</span> },
          { header: "Mode", cell: (row) => <StatusBadge value={row.payment_method || "Manual"} tone="slate" /> },
          { header: "Status", cell: (row) => <StatusBadge value={row.payment_status || "Pending"} /> },
          { header: "Transaction", cell: (row) => row.transaction_id || "Not linked" },
        ]}
      />

      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        noun="payments"
        isPending={isPending}
        onPageChange={(page) => navigate({ page })}
      />
    </div>
  );
}

/** Kept for reuse by any small finance summaries. */
export function FinanceTile({ label, value, tone }: { label: string; value: ReactNode; tone: "emerald" | "amber" | "blue" | "slate" }) {
  const toneClass = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    blue: "bg-sky-500",
    slate: "bg-slate-400",
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-lg font-semibold text-slate-950">{value}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${toneClass}`} />
      </div>
    </div>
  );
}
