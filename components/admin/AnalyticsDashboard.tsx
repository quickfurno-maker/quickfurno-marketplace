"use client";

// ============================================================================
// QuickFurno Analytics Dashboard (CRM + Analytics foundation)
// Display-only superadmin analytics. Uses safe adapter data, with placeholder
// spend, CPL, conversion, revenue, and AOS metrics until real integrations are
// explicitly activated later.
// ============================================================================

import { useMemo, useState } from "react";
import { DataTable, StatCard, StatusBadge, Tabs } from "./AdminPrimitives";
import type { Snapshot } from "./adminTypes";
import { formatNumber } from "./adminUtils";
import { buildAnalyticsModel } from "@/lib/analytics/analyticsAdapter";
import type {
  AgentAnalyticsRow,
  AnalyticsMetric,
  AreaMetric,
  CampaignMetric,
  FunnelMetric,
  RevenueMetric,
  ServiceMetric,
  SourceMetric,
  VendorMetric,
} from "@/lib/analytics/types";

type AnalyticsDashboardProps = {
  data: Snapshot;
};

const tabs = [
  "Overview Analytics",
  "Lead Source Analytics",
  "Campaign Analytics",
  "CRM Funnel Analytics",
  "Service Analytics",
  "City/Area Analytics",
  "Vendor Analytics",
  "Revenue Analytics",
  "AOS Agent Analytics",
];

export function AnalyticsDashboard({ data }: AnalyticsDashboardProps) {
  const [active, setActive] = useState(tabs[0]);
  const model = useMemo(() => buildAnalyticsModel(data), [data]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-900">
        Analytics foundation is display-only. Ad spend, payment revenue, AOS events, CPL, and
        conversion metrics are placeholders. No automation, WhatsApp, n8n, credit deduction, or
        lead assignment is triggered here.
      </section>

      <Tabs tabs={tabs} active={active} onChange={setActive} />

      {active === "Overview Analytics" ? <Overview cards={model.cards} /> : null}
      {active === "Lead Source Analytics" ? <LeadSourceAnalytics rows={model.sources} /> : null}
      {active === "Campaign Analytics" ? <CampaignAnalytics rows={model.campaigns} /> : null}
      {active === "CRM Funnel Analytics" ? <FunnelAnalytics rows={model.funnel} /> : null}
      {active === "Service Analytics" ? <ServiceAnalytics rows={model.services} /> : null}
      {active === "City/Area Analytics" ? <AreaAnalytics rows={model.areas} /> : null}
      {active === "Vendor Analytics" ? <VendorAnalytics rows={model.vendors} /> : null}
      {active === "Revenue Analytics" ? <RevenueAnalytics rows={model.revenue} /> : null}
      {active === "AOS Agent Analytics" ? <AgentAnalytics rows={model.agents} /> : null}
    </div>
  );
}

function Overview({ cards }: { cards: AnalyticsMetric[] }) {
  const toneFor = (kind?: string): "emerald" | "indigo" | "amber" | "rose" | "slate" =>
    kind === "placeholder" ? "slate" : "indigo";
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <StatCard
          key={card.key}
          label={card.label}
          value={card.value}
          helper={card.helper ?? (card.kind === "placeholder" ? "Placeholder" : "Safe read")}
          icon="reports"
          tone={toneFor(card.kind)}
        />
      ))}
    </section>
  );
}

function LeadSourceAnalytics({ rows }: { rows: SourceMetric[] }) {
  return (
    <DataTable
      rows={rows}
      emptyTitle="No source analytics"
      emptyMessage="Lead source placeholder categories are ready."
      columns={[
        { header: "Source", cell: (row) => row.source },
        { header: "Leads", cell: (row) => formatNumber(row.leads) },
        { header: "Hot leads", cell: (row) => formatNumber(row.hot_leads) },
        { header: "Assigned", cell: (row) => formatNumber(row.assigned_leads) },
        { header: "Won", cell: (row) => formatNumber(row.won_leads) },
        { header: "Lost", cell: (row) => formatNumber(row.lost_leads) },
        { header: "Cost placeholder", cell: (row) => row.cost_placeholder ?? "INR --" },
        { header: "CPL placeholder", cell: (row) => row.cpl_placeholder ?? "INR --" },
      ]}
    />
  );
}

function CampaignAnalytics({ rows }: { rows: CampaignMetric[] }) {
  return (
    <DataTable
      rows={rows}
      emptyTitle="No campaign data"
      emptyMessage="Campaign placeholders will be replaced only after ad integrations are activated."
      columns={[
        { header: "Campaign name", cell: (row) => row.campaign },
        { header: "Source", cell: (row) => row.source },
        { header: "Spend placeholder", cell: (row) => row.spend_placeholder ?? "INR --" },
        { header: "Leads", cell: (row) => formatNumber(row.leads) },
        { header: "CPL placeholder", cell: (row) => row.cpl_placeholder ?? "INR --" },
        { header: "Conversion placeholder", cell: (row) => row.conversion_placeholder ?? "--" },
      ]}
    />
  );
}

function FunnelAnalytics({ rows }: { rows: FunnelMetric[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-950">CRM Funnel Analytics</h3>
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
      emptyMessage="Requested service categories are ready as placeholders."
      columns={[
        { header: "Service category", cell: (row) => row.service },
        { header: "Leads", cell: (row) => formatNumber(row.leads) },
        { header: "Hot leads", cell: (row) => formatNumber(row.hot_leads) },
        { header: "Assigned", cell: (row) => formatNumber(row.assigned) },
        { header: "Won", cell: (row) => formatNumber(row.won) },
        { header: "Revenue placeholder", cell: (row) => row.revenue_estimate ?? "INR --" },
        { header: "Supply placeholder", cell: (row) => row.vendor_supply_gap_placeholder ?? "--" },
      ]}
    />
  );
}

function AreaAnalytics({ rows }: { rows: AreaMetric[] }) {
  return (
    <DataTable
      rows={rows}
      emptyTitle="No city/area analytics"
      emptyMessage="City and area placeholders are ready."
      columns={[
        { header: "City", cell: (row) => row.city },
        { header: "Area/locality", cell: (row) => row.locality },
        { header: "Lead count", cell: (row) => formatNumber(row.lead_count ?? row.leads) },
        { header: "Vendor count", cell: (row) => formatNumber(row.vendor_count) },
        { header: "Demand/supply placeholder", cell: (row) => <StatusBadge value={row.demand_supply_gap ?? "Placeholder"} /> },
      ]}
    />
  );
}

function VendorAnalytics({ rows }: { rows: VendorMetric[] }) {
  return (
    <DataTable
      rows={rows}
      emptyTitle="No vendor analytics"
      emptyMessage="Vendor analytics placeholders are ready."
      columns={[
        { header: "Vendor name", cell: (row) => row.vendor },
        { header: "Assigned leads", cell: (row) => formatNumber(row.assigned_leads) },
        { header: "Response rate placeholder", cell: (row) => row.response_rate_placeholder ?? "--" },
        { header: "Package", cell: (row) => row.package ?? "Package placeholder" },
        { header: "Status", cell: (row) => <StatusBadge value={row.status ?? "Active"} /> },
        { header: "Lead balance placeholder", cell: (row) => row.lead_balance_placeholder ?? "--" },
      ]}
    />
  );
}

function RevenueAnalytics({ rows }: { rows: RevenueMetric[] }) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <StatCard
          key={row.key}
          label={row.label}
          value={row.value}
          helper="Placeholder"
          icon="payments"
          tone="slate"
        />
      ))}
    </section>
  );
}

function AgentAnalytics({ rows }: { rows: AgentAnalyticsRow[] }) {
  return (
    <DataTable
      rows={rows}
      emptyTitle="No AOS agent analytics"
      emptyMessage="AOS agent analytics are placeholders until agent runs are persisted."
      columns={[
        { header: "Agent", cell: (row) => row.agent },
        { header: "Runs", cell: (row) => row.runs },
        { header: "Success rate", cell: (row) => row.success_rate },
        { header: "Error count", cell: (row) => row.error_count },
        { header: "Avg confidence", cell: (row) => row.avg_confidence },
        { header: "Last run", cell: (row) => row.last_run },
      ]}
    />
  );
}
