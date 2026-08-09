"use client";

import {
  DataTable,
  SecondaryButton,
  SectionCard,
  StatCard,
  StatusBadge,
} from "../AdminPrimitives";
import { type Snapshot, type Vendor } from "../adminTypes";
import {
  formatDate,
  formatINR,
  formatNumber,
  packageName,
  shortId,
  vendorName,
} from "../adminUtils";
import { Strong } from "./shared";

export function SubscriptionsPage({ data, notify }: { data: Snapshot; notify: (message: string) => void }) {
  const packageOrders = data.vendorPackageOrders ?? [];
  const notActivatedOrders = packageOrders.filter((order) => String(order.activation_status ?? "").toLowerCase() !== "activated");

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Low Balance" value={formatNumber(data.stats.low_balance_vendors)} helper="At or below threshold" icon="subscriptions" tone="amber" />
        <StatCard label="Package Orders" value={formatNumber(packageOrders.length)} helper="Audit only" icon="payments" tone="indigo" />
        <StatCard label="Expired" value={formatNumber(data.stats.expired_vendors)} helper="Stopped from assignment" icon="packages" tone="rose" />
        <StatCard label="Not Activated" value={formatNumber(notActivatedOrders.length)} helper="Awaiting verified payment" icon="notifications" tone="amber" />
      </section>
      <DataTable
        rows={data.vendorPackages}
        emptyTitle="No vendor subscriptions found"
        emptyMessage="Vendor package history will appear here after packages are assigned."
        columns={[
          { header: "Vendor", cell: (row: any) => vendorName(data.vendors, row.vendor_id) },
          { header: "Package", cell: (row: any) => packageName(data.packages, row.package_id) },
          { header: "Purchased", cell: (row: any) => formatNumber(row.total_leads ?? row.leads_purchased ?? row.lead_count ?? 0) },
          { header: "Used", cell: (row: any) => formatNumber(row.leads_used ?? 0) },
          { header: "Remaining", cell: (row: any) => formatNumber(row.remaining_leads ?? row.leads_remaining ?? row.remaining_credits ?? 0) },
          { header: "Expiry", cell: (row: any) => formatDate(row.expiry_date) },
          { header: "Status", cell: (row: any) => <StatusBadge value={row.status || "Active"} /> },
          { header: "Actions", cell: () => <SecondaryButton onClick={() => notify("Renewal drawer placeholder ready.")}>Renew</SecondaryButton> },
        ]}
      />

      <SectionCard title="Package Order Audit" description="Vendor-created order intents. Audit only: no approve/reject or activation controls.">
        <DataTable
          rows={packageOrders}
          emptyTitle="No package orders found"
          emptyMessage="Package order audit will appear here after package order tracking is enabled."
          columns={[
            { header: "Order", cell: (row) => <Strong title={shortId(row.id)} subtitle={formatDate(row.created_at)} /> },
            { header: "Vendor", cell: (row) => vendorName(data.vendors, row.vendor_id) },
            { header: "Package", cell: (row) => row.package_name || packageName(data.packages, row.package_id) },
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
      </SectionCard>
    </div>
  );
}
