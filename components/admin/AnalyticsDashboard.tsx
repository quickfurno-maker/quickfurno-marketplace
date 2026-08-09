"use client";

// ============================================================================
// QuickFurno Analytics Dashboard — REAL DATA ONLY (C-PERF1 P0-H).
//
// Every figure rendered here is computed from live marketplace data: the
// snapshot's count-query stats or the loaded lead/vendor rows (scoped and
// labelled). The previous version rendered placeholder ad-spend / CPL /
// conversion / revenue / AOS columns and whole placeholder tabs — those are
// REMOVED, not restyled. Unconnected integrations are stated as unavailable
// in plain text; no synthetic values are shown.
// ============================================================================

import { useMemo, useState } from "react";
import { DataTable, NoteBar, StatCard, StatusBadge, TabPanel, Tabs } from "./AdminPrimitives";
import type { Snapshot } from "./adminTypes";
import { formatINR, formatNumber } from "./adminUtils";
import { buildAnalyticsModel } from "@/lib/analytics/analyticsAdapter";
import type {
  AreaMetric,
  FunnelMetric,
  ServiceMetric,
  SourceMetric,
  VendorMetric,
} from "@/lib/analytics/types";

type AnalyticsDashboardProps = {
  data: Snapshot;
};

const tabs = [
  "Overview",
  "Lead Sources",
  "CRM Funnel",
  "Services",
  "Cities & Areas",
  "Vendors",
  "Revenue",
];

export function AnalyticsDashboard({ data }: AnalyticsDashboardProps) {
  const [active, setActive] = useState(tabs[0]);
  const model = useMemo(() => buildAnalyticsModel(data), [data]);
  const stats = data.stats ?? {};
  const sampleSize = data.leads?.length ?? 0;

  return (
    <div className="space-y-5">
      <NoteBar>
        Analytics are computed from live marketplace data. KPI totals are server-side counts; per-source, funnel,
        service, area and vendor breakdowns cover the latest {formatNumber(sampleSize)} loaded leads and are labelled
        as such. Ad-spend, CPL and campaign metrics are not connected and are therefore not shown.
      </NoteBar>

      <Tabs id="analytics-tabs" tabs={tabs} active={active} onChange={setActive} />

      <TabPanel id="analytics-tabs" active={active}>
        {active === "Overview" ? <Overview stats={stats} /> : null}
        {active === "Lead Sources" ? <LeadSourceAnalytics rows={model.sources} /> : null}
        {active === "CRM Funnel" ? <FunnelAnalytics rows={model.funnel} /> : null}
        {active === "Services" ? <ServiceAnalytics rows={model.services} /> : null}
        {active === "Cities & Areas" ? <AreaAnalytics rows={model.areas} /> : null}
        {active === "Vendors" ? <VendorAnalytics rows={model.vendors} /> : null}
        {active === "Revenue" ? <RevenueAnalytics stats={stats} /> : null}
      </TabPanel>
    </div>
  );
}

/** All Overview cards come from the accurate count/aggregate stats block. */
function Overview({ stats }: { stats: Record<string, number | string> }) {
  const cards: Array<{ key: string; label: string; value: React.ReactNode; helper: string; tone: "emerald" | "indigo" | "amber" | "rose" | "slate" }> = [
    { key: "total_leads", label: "Total Leads", value: formatNumber(stats.total_leads), helper: "Live count", tone: "indigo" },
    { key: "leads_today", label: "Leads Today", value: formatNumber(stats.leads_today), helper: "Created today (live count)", tone: "emerald" },
    { key: "assigned_leads", label: "Assigned Leads", value: formatNumber(stats.assigned_leads), helper: "Assigned or later stage (live count)", tone: "indigo" },
    { key: "conversion_rate", label: "Conversion Rate", value: `${Number(stats.conversion_rate ?? 0)}%`, helper: "Converted / total (live counts)", tone: "emerald" },
    { key: "active_vendors", label: "Active Vendors", value: formatNumber(stats.active_vendors), helper: "Approved and active (live count)", tone: "indigo" },
    { key: "paid_vendors", label: "Paid Vendors", value: formatNumber(stats.paid_vendors), helper: "With a paid/active package", tone: "emerald" },
    { key: "followups_due", label: "Follow-ups Due", value: formatNumber(stats.pending_followups), helper: "Open working statuses (live count)", tone: "amber" },
    { key: "revenue_month", label: "Revenue This Month", value: formatINR(stats.revenue_this_month), helper: `${formatINR(stats.total_revenue)} lifetime`, tone: "emerald" },
  ];
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <StatCard key={card.key} label={card.label} value={card.value} helper={card.helper} icon="reports" tone={card.tone} />
      ))}
    </section>
  );
}

function LeadSourceAnalytics({ rows }: { rows: SourceMetric[] }) {
  return (
    <DataTable
      rows={rows}
      emptyTitle="No source analytics"
      emptyMessage="Lead sources will appear as leads arrive."
      columns={[
        { header: "Source", cell: (row) => row.source },
        { header: "Leads", cell: (row) => formatNumber(row.leads) },
        { header: "Hot leads", cell: (row) => formatNumber(row.hot_leads) },
        { header: "Assigned", cell: (row) => formatNumber(row.assigned_leads) },
        { header: "Won", cell: (row) => formatNumber(row.won_leads) },
        { header: "Lost", cell: (row) => formatNumber(row.lost_leads) },
      ]}
    />
  );
}

function FunnelAnalytics({ rows }: { rows: FunnelMetric[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <section className="qfa-panel p-4">
      <h3 className="text-base font-semibold text-slate-950">CRM Funnel</h3>
      <div className="mt-5 space-y-4">
        {rows.map((row) => (
          <div key={row.key} className="space-y-1.5">
            <div className="flex items-center justify-between gap-4 text-xs font-medium">
              <span className="text-slate-600">{row.stage}</span>
              <span className="text-slate-900">{formatNumber(row.count)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(row.count ? 6 : 3, (row.count / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ServiceAnalytics({ rows }: { rows: ServiceMetric[] }) {
  return (
    <DataTable
      rows={rows}
      emptyTitle="No service analytics"
      emptyMessage="Service categories will appear as leads arrive."
      columns={[
        { header: "Service category", cell: (row) => row.service },
        { header: "Leads", cell: (row) => formatNumber(row.leads) },
        { header: "Hot leads", cell: (row) => formatNumber(row.hot_leads) },
        { header: "Assigned", cell: (row) => formatNumber(row.assigned) },
        { header: "Won", cell: (row) => formatNumber(row.won) },
      ]}
    />
  );
}

function AreaAnalytics({ rows }: { rows: AreaMetric[] }) {
  return (
    <DataTable
      rows={rows}
      emptyTitle="No city/area analytics"
      emptyMessage="Cities and areas will appear as leads arrive."
      columns={[
        { header: "City", cell: (row) => row.city },
        { header: "Area/locality", cell: (row) => row.locality },
        { header: "Lead count", cell: (row) => formatNumber(row.lead_count ?? row.leads) },
        { header: "Vendor count", cell: (row) => formatNumber(row.vendor_count) },
      ]}
    />
  );
}

function VendorAnalytics({ rows }: { rows: VendorMetric[] }) {
  return (
    <DataTable
      rows={rows}
      emptyTitle="No vendor analytics"
      emptyMessage="Vendors will appear after onboarding starts."
      columns={[
        { header: "Vendor name", cell: (row) => row.vendor },
        { header: "Assigned leads", cell: (row) => formatNumber(row.assigned_leads) },
        { header: "Status", cell: (row) => <StatusBadge value={row.status ?? "Active"} /> },
        // Real stored credit balance (was mislabelled "lead balance placeholder").
        { header: "Credits remaining", cell: (row) => row.lead_balance_placeholder ?? "—" },
      ]}
    />
  );
}

/** Real payment-ledger figures from the accurate stats block. */
function RevenueAnalytics({ stats }: { stats: Record<string, number | string> }) {
  const cards = [
    { key: "revenue_month", label: "Revenue This Month", value: formatINR(stats.revenue_this_month), helper: "Paid payments this month", tone: "emerald" as const },
    { key: "revenue_total", label: "Lifetime Revenue", value: formatINR(stats.total_revenue), helper: "All paid payments", tone: "indigo" as const },
    { key: "pending_payments", label: "Pending Payments", value: formatNumber(stats.pending_payments), helper: "Awaiting reconciliation (count)", tone: "amber" as const },
    { key: "expired_vendors", label: "Expired / Renewal Due", value: formatNumber(stats.expired_vendors), helper: "Vendors with lapsed packages", tone: "rose" as const },
  ];
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <StatCard key={card.key} label={card.label} value={card.value} helper={card.helper} icon="payments" tone={card.tone} />
      ))}
    </section>
  );
}
