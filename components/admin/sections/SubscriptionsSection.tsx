"use client";

// ============================================================================
// C-PERF2 — server-paged Vendor Subscriptions (20/page) + Package-Order
// audit (20/page, independent ?orders_page URL state). Counts are live
// server-side; vendor names resolve via bounded current-page IN lookups.
// Audit only: no renew / package change / credit / activation control.
// ============================================================================

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DataTable,
  SectionCard,
  StatCard,
  StatusBadge,
} from "../AdminPrimitives";
import { Pagination } from "../Pagination";
import { type PackageRow, type Vendor, type VendorPackageOrder } from "../adminTypes";
import {
  formatDate,
  formatINR,
  formatNumber,
  packageName,
  shortId,
  vendorName,
} from "../adminUtils";
import { Strong } from "./shared";

export type AdminSubscriptionsPageData = {
  subscriptions: { rows: any[]; page: number; pageSize: number; total: number };
  orders: { rows: VendorPackageOrder[]; page: number; pageSize: number; total: number };
  totals: { lowBalance: number; expiredVendors: number; notActivated: number };
  vendors: Vendor[];
  packages: PackageRow[];
};

export function SubscriptionsPage({ data }: { data: AdminSubscriptionsPageData | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const subscriptions = data?.subscriptions ?? { rows: [], page: 1, pageSize: 20, total: 0 };
  const orders = data?.orders ?? { rows: [], page: 1, pageSize: 20, total: 0 };
  const totals = data?.totals ?? { lowBalance: 0, expiredVendors: 0, notActivated: 0 };
  const vendors = data?.vendors ?? [];
  const packages = data?.packages ?? [];

  const navigate = useCallback(
    (key: "page" | "orders_page", value: number) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value <= 1) next.delete(key);
      else next.set(key, String(value));
      startTransition(() => {
        router.replace(`${pathname}${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
      });
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="space-y-5" aria-busy={isPending}>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Low Balance" value={formatNumber(totals.lowBalance)} helper="At or below threshold (live count)" icon="subscriptions" tone="amber" />
        <StatCard label="Package Orders" value={formatNumber(orders.total)} helper="Audit only (live count)" icon="payments" tone="indigo" />
        <StatCard label="Expired" value={formatNumber(totals.expiredVendors)} helper="Stopped from assignment (live count)" icon="packages" tone="rose" />
        <StatCard label="Not Activated" value={formatNumber(totals.notActivated)} helper="Awaiting verified payment (live count)" icon="notifications" tone="amber" />
      </section>

      <SectionCard title="Vendor Subscriptions" description="Vendor package history, newest first.">
        <DataTable
          rows={subscriptions.rows}
          density="compact"
          getRowKey={(row, index) => String(row.id ?? index)}
          emptyTitle="No vendor subscriptions found"
          emptyMessage="Vendor package history will appear here after packages are assigned."
          columns={[
            { header: "Vendor", cell: (row: any) => vendorName(vendors, row.vendor_id) },
            { header: "Package", cell: (row: any) => packageName(packages, row.package_id) },
            { header: "Purchased", cell: (row: any) => formatNumber(row.total_leads ?? row.leads_purchased ?? row.lead_count ?? 0) },
            { header: "Used", cell: (row: any) => formatNumber(row.leads_used ?? 0) },
            { header: "Remaining", cell: (row: any) => formatNumber(row.remaining_leads ?? row.leads_remaining ?? row.remaining_credits ?? 0) },
            { header: "Expiry", cell: (row: any) => formatDate(row.expiry_date) },
            { header: "Status", cell: (row: any) => <StatusBadge value={row.status || "Active"} /> },
          ]}
        />
        <Pagination
          page={subscriptions.page}
          pageSize={subscriptions.pageSize}
          total={subscriptions.total}
          noun="subscriptions"
          isPending={isPending}
          onPageChange={(page) => navigate("page", page)}
        />
      </SectionCard>

      <SectionCard title="Package Order Audit" description="Vendor-created order intents. Audit only: no approve/reject or activation controls.">
        <DataTable
          rows={orders.rows}
          density="compact"
          getRowKey={(row, index) => String(row.id ?? index)}
          emptyTitle="No package orders found"
          emptyMessage="Package order audit will appear here after package order tracking is enabled."
          columns={[
            { header: "Order", cell: (row) => <Strong title={shortId(row.id)} subtitle={formatDate(row.created_at)} /> },
            { header: "Vendor", cell: (row) => vendorName(vendors, row.vendor_id) },
            { header: "Package", cell: (row) => row.package_name || packageName(packages, row.package_id) },
            { header: "Amount", cell: (row) => <span className="font-semibold text-slate-950">{formatINR(row.package_price)}</span> },
            { header: "Credits", cell: (row) => formatNumber(row.credits_included ?? 0) },
            { header: "Payment", cell: (row) => <StatusBadge value={row.payment_status || "not_started"} tone="amber" /> },
            { header: "Activation", cell: (row) => <StatusBadge value={row.activation_status || "not_activated"} tone="slate" /> },
            { header: "Provider", cell: (row) => row.payment_provider || "not_connected" },
            {
              header: "Provider Refs",
              cell: (row) => (
                <div className="min-w-36 text-xs text-slate-500">
                  <p>Order: {row.provider_order_id || "—"}</p>
                  <p className="mt-0.5">Payment: {row.provider_payment_id || "—"}</p>
                </div>
              ),
            },
          ]}
        />
        <Pagination
          page={orders.page}
          pageSize={orders.pageSize}
          total={orders.total}
          noun="package orders"
          isPending={isPending}
          onPageChange={(page) => navigate("orders_page", page)}
        />
      </SectionCard>
    </div>
  );
}
