"use client";

import { DataTable, NoteBar, SectionCard, StatusBadge } from "../../AdminPrimitives";
import { Pagination } from "../../Pagination";
import { type LeadDeliveryLog, type Vendor } from "../../adminTypes";
import { formatDate } from "../../adminUtils";
import { MiniStat } from "./leadCrmShared";

/**
 * Delivery evidence only. QuickFurno stops operational ownership after a
 * Core-approved quality lead is successfully delivered to the assigned vendor.
 * Vendor sales progress is intentionally not tracked here.
 */
export function VendorResponse({
  result,
  counts,
  vendorsById,
  isPending,
  onPageChange,
}: {
  result: { rows: LeadDeliveryLog[]; page: number; pageSize: number; total: number };
  counts: { logsTotal: number; contactShared: number; creditDeducted: number };
  vendorsById: Map<string, Vendor>;
  isPending: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="space-y-3" aria-busy={isPending}>
      <NoteBar>
        Delivery evidence only: who received the lead, whether contact details were shared, and whether the lead credit was deducted.
        Quotation, site visit, negotiation and sale progress are outside QuickFurno.
      </NoteBar>

      <SectionCard title="Delivery snapshot" description="Marketplace delivery evidence across the current ledger.">
        <div className="grid gap-2 sm:grid-cols-3">
          <MiniStat label="Delivery logs" value={counts.logsTotal} tone="blue" />
          <MiniStat label="Contact shared" value={counts.contactShared} tone="emerald" />
          <MiniStat label="Credit deducted" value={counts.creditDeducted} tone="amber" />
        </div>
      </SectionCard>

      <DataTable
        rows={result.rows}
        density="compact"
        getRowKey={(row, index) => String(row.id ?? index)}
        emptyTitle="No delivery logs yet"
        emptyMessage="Verified lead-delivery evidence will appear here."
        columns={[
          { header: "Lead", cell: (row) => <span className="font-mono text-xs">{String(row.lead_id ?? "").slice(0, 8)}</span> },
          { header: "Vendor", cell: (row) => vendorsById.get(String(row.vendor_id ?? ""))?.business_name ?? <span className="font-mono text-xs">{String(row.vendor_id ?? "").slice(0, 8)}</span> },
          { header: "Channel", cell: (row) => <StatusBadge value={row.delivery_channel || "?"} tone="slate" /> },
          { header: "Delivery", cell: (row) => <StatusBadge value={row.delivery_status || "?"} /> },
          { header: "Contact", cell: (row) => <StatusBadge value={row.contact_shared ? "Shared" : "Held"} tone={row.contact_shared ? "emerald" : "amber"} /> },
          { header: "Credit", cell: (row) => <StatusBadge value={row.credit_deducted ? "Deducted" : "Not deducted"} tone={row.credit_deducted ? "emerald" : "slate"} /> },
          { header: "Created", cell: (row) => <span className="whitespace-nowrap">{formatDate(row.created_at)}</span> },
        ]}
      />

      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        noun="delivery logs"
        isPending={isPending}
        onPageChange={onPageChange}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source Analytics
// ---------------------------------------------------------------------------
