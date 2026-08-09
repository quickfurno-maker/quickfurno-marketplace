"use client";

import { type ReactNode } from "react";
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

export function PaymentsPage({ data, notify }: { data: Snapshot; notify: (message: string) => void }) {
  const paidPayments = data.payments.filter((payment) => String(payment.payment_status ?? "").toLowerCase() === "paid");
  const pendingPayments = data.payments.filter((payment) => String(payment.payment_status ?? "").toLowerCase() === "pending");

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Revenue" value={formatINR(data.stats.total_revenue)} helper={`${formatNumber(paidPayments.length)} paid payments`} icon="payments" />
        <StatCard label="Monthly Revenue" value={formatINR(data.stats.revenue_this_month)} helper="This month" icon="reports" tone="emerald" />
        <StatCard label="Pending Collections" value={formatNumber(pendingPayments.length || data.stats.pending_payments)} helper="Needs follow-up" icon="notifications" tone="amber" />
        <StatCard label="Renewal Risk" value={formatNumber(data.stats.expired_vendors)} helper="Expired vendors" icon="subscriptions" tone="rose" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <SectionCard title="Revenue Snapshot" description="Live payment rows summarized for quick finance review.">
          <div className="grid gap-3 sm:grid-cols-2">
            <FinanceTile label="Paid" value={formatNumber(paidPayments.length)} tone="emerald" />
            <FinanceTile label="Pending" value={formatNumber(pendingPayments.length)} tone="amber" />
            <FinanceTile label="Gateway" value="Prepared" tone="slate" />
            <FinanceTile label="Invoice UI" value="Ready" tone="blue" />
          </div>
        </SectionCard>

        <SectionCard title="Collection Notes" description="Operational placeholders only; no payment logic changed.">
          <div className="grid gap-3 sm:grid-cols-3">
            {["Manual collection", "Invoice download", "Renewal follow-up"].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => notify(`${item} placeholder ready.`)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50/40"
              >
                {item}
              </button>
            ))}
          </div>
        </SectionCard>
      </section>

      <DataTable
        rows={data.payments}
        emptyTitle="No payments found"
        emptyMessage="Manual package payments and future gateway payments will appear here."
        columns={[
          { header: "Payment ID", cell: (row) => <Strong title={shortId(row.id)} subtitle={formatDate(row.created_at)} /> },
          { header: "Vendor", cell: (row) => vendorName(data.vendors, row.vendor_id) },
          { header: "Package", cell: (row) => packageName(data.packages, row.package_id) },
          { header: "Amount", cell: (row) => <span className="font-semibold text-slate-950">{formatINR(row.amount)}</span> },
          { header: "Mode", cell: (row) => <StatusBadge value={row.payment_method || "Manual"} tone="slate" /> },
          { header: "Status", cell: (row) => <StatusBadge value={row.payment_status || "Pending"} /> },
          { header: "Transaction", cell: (row) => row.transaction_id || "Not linked" },
          { header: "Actions", cell: () => <SecondaryButton onClick={() => notify("Invoice placeholder ready.")}>Invoice</SecondaryButton> },
        ]}
      />
    </div>
  );
}


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
