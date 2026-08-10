"use client";

import { useMemo } from "react";
import {
  ChartCard,
  DataTable,
  NoteBar,
  SectionCard,
  StatusBadge,
} from "../../AdminPrimitives";
import { Pagination } from "../../Pagination";
import {
  type LeadDeliveryLog,
  type Vendor,
} from "../../adminTypes";
import {
  formatDate,
} from "../../adminUtils";
import { MiniStat } from "./leadCrmShared";

/**
 * Vendor activity on assigned leads.
 *
 * WORDING MATTERS HERE. This surface was previously titled "Vendor Response",
 * which implied a per-lead accept/reject contract. No such contract exists.
 * `assignment.vendor_status` is the vendor's PROGRESS on a lead already assigned
 * to them (New -> Contacted -> …). A vendor never accepts, rejects, declines
 * or awaits acceptance of a lead in QuickFurno.
 *
 * C-PERF2: delivery logs are server-paged (20/page, live totals); the
 * progress distribution comes from a column-only vendor_status projection.
 */
export function VendorResponse({
  result,
  progressAgg,
  counts,
  vendorsById,
  isPending,
  onPageChange,
}: {
  result: { rows: LeadDeliveryLog[]; page: number; pageSize: number; total: number };
  progressAgg: Array<{ vendor_status?: string | null }>;
  counts: { logsTotal: number; contactShared: number; creditDeducted: number };
  vendorsById: Map<string, Vendor>;
  isPending: boolean;
  onPageChange: (page: number) => void;
}) {
  const progressCounts = useMemo(() => {
    const map = new Map<string, number>();
    progressAgg.forEach((row) => {
      const status = row.vendor_status || "New";
      map.set(status, (map.get(status) ?? 0) + 1);
    });
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [progressAgg]);

  return (
    <div className="space-y-3" aria-busy={isPending}>
      <NoteBar>
        How vendors are <strong className="font-semibold text-slate-800">progressing</strong> leads already assigned to
        them, plus delivery records. Vendors do not accept or reject assigned leads in QuickFurno.
      </NoteBar>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Vendor progress on assigned leads" rows={progressCounts} />
        <SectionCard title="Delivery snapshot" description="Dashboard + WhatsApp-preview delivery logs (preview only — no live sends). Live counts.">
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniStat label="Delivery logs" value={counts.logsTotal} tone="blue" />
            <MiniStat label="Contact shared" value={counts.contactShared} tone="emerald" />
            <MiniStat label="Credit deducted" value={counts.creditDeducted} tone="amber" />
          </div>
        </SectionCard>
      </div>

      <DataTable
        rows={result.rows}
        density="compact"
        getRowKey={(row, index) => String(row.id ?? index)}
        emptyTitle="No delivery logs yet"
        emptyMessage="Vendor lead deliveries (dashboard + WhatsApp preview) will appear here."
        columns={[
          { header: "Lead", cell: (row) => <span className="font-mono text-xs">{String(row.lead_id ?? "").slice(0, 8)}</span> },
          { header: "Vendor", cell: (row) => vendorsById.get(String(row.vendor_id ?? ""))?.business_name ?? <span className="font-mono text-xs">{String(row.vendor_id ?? "").slice(0, 8)}</span> },
          { header: "Channel", cell: (row) => <StatusBadge value={row.delivery_channel || "—"} tone="slate" /> },
          { header: "Status", cell: (row) => <StatusBadge value={row.delivery_status || "—"} /> },
          { header: "Contact", cell: (row) => <StatusBadge value={row.contact_shared ? "Shared" : "Held"} tone={row.contact_shared ? "emerald" : "amber"} /> },
          { header: "WhatsApp", cell: (row) => <StatusBadge value={row.whatsapp_status || "preview_only"} tone="slate" /> },
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
