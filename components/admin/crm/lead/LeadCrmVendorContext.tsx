"use client";

import { useMemo } from "react";
import {
  ChartCard,
  DataTable,
  NoteBar,
  SectionCard,
  StatusBadge,
} from "../../AdminPrimitives";
import {
  type Lead,
  type LeadDeliveryLog,
  type Vendor,
} from "../../adminTypes";
import {
  formatDate,
} from "../../adminUtils";
import { type CrmRow } from "./leadCrmTypes";
import { MiniStat } from "./leadCrmShared";

/**
 * Vendor activity on assigned leads.
 *
 * WORDING MATTERS HERE. This surface was previously titled "Vendor Response",
 * which implied a per-lead accept/reject contract. No such contract exists.
 * `assignment.vendor_status` is the vendor's PROGRESS on a lead already assigned
 * to them (New -> Contacted -> …) — the same field
 * lib/automation/vendorDispatchRegistry.ts describes as "progressed past
 * vendor_status = 'New' … a contact/progress nudge". A vendor never accepts,
 * rejects, declines or awaits acceptance of a lead in QuickFurno.
 */
export function VendorResponse({ rows, vendorsById, deliveryLogs }: { rows: CrmRow[]; vendorsById: Map<string, Vendor>; deliveryLogs: LeadDeliveryLog[] }) {
  const progressCounts = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row) => row.assignments.forEach((a) => {
      const status = a.vendor_status || "New";
      map.set(status, (map.get(status) ?? 0) + 1);
    }));
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [rows]);

  const recentDeliveries = deliveryLogs.slice(0, 40);

  return (
    <div className="space-y-3">
      <NoteBar>
        How vendors are <strong className="font-semibold text-slate-800">progressing</strong> leads already assigned to
        them, plus delivery records. Vendors do not accept or reject assigned leads in QuickFurno.
      </NoteBar>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Vendor progress on assigned leads" rows={progressCounts} />
        <SectionCard title="Delivery snapshot" description="Dashboard + WhatsApp-preview delivery logs (preview only — no live sends).">
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniStat label="Delivery logs" value={deliveryLogs.length} tone="blue" />
            <MiniStat label="Contact shared" value={deliveryLogs.filter((l) => l.contact_shared).length} tone="emerald" />
            <MiniStat label="Credit deducted" value={deliveryLogs.filter((l) => l.credit_deducted).length} tone="amber" />
          </div>
        </SectionCard>
      </div>
      {deliveryLogs.length > recentDeliveries.length ? (
        <p className="text-xs text-slate-500">
          Showing the {recentDeliveries.length} most recent of {deliveryLogs.length} delivery records.
        </p>
      ) : null}

      <DataTable
        rows={recentDeliveries}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source Analytics
// ---------------------------------------------------------------------------
