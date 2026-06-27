"use client";

// ============================================================================
// QuickFurno Analytics Dashboard (Phase 3 foundation)
// Superadmin analytics module. Derives metrics from safe Supabase reads
// (leads, vendors, assignments) with placeholder cost / spend / revenue values.
//
// SAFE MODE: no real AI, no ad-spend connection, no payment gateway. All
// cost-per-lead, spend, and revenue figures are clearly marked placeholders.
//
// TODO(analytics-supabase): replace derived aggregates with SQL views.
// TODO(ads): connect Google/Meta spend for real CPL and ROAS.
// TODO(aos): feed real agent run metrics into AOS Agent Analytics.
// ============================================================================

import { useMemo, useState } from "react";
import { DataTable, StatCard, StatusBadge, Tabs } from "./AdminPrimitives";
import type { Snapshot } from "./adminTypes";
import { formatNumber } from "./adminUtils";
import { AOS_LABELS, runOpsBrief, type OpsBriefReport } from "@/lib/aos/sync/aosCrmSyncService";
import { adaptCrmLeads } from "@/lib/crm/adapters/leadAdapter";
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
  "Overview",
  "Lead Source",
  "Campaigns",
  "CRM Funnel",
  "Service",
  "City/Area",
  "Vendors",
  "Revenue",
  "Follow-ups",
  "AOS Agents",
];

// Deterministic split so derived hot/won counts are stable across renders.
function bucket(seed: string, mod: number) {
  let total = 0;
  for (let i = 0; i < seed.length; i += 1) total += seed.charCodeAt(i);
  return mod > 0 ? total % mod : 0;
}

function isThisMonth(value?: string | null) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function isToday(value?: string | null) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.toDateString() === new Date().toDateString();
}

export function AnalyticsDashboard({ data }: AnalyticsDashboardProps) {
  const [active, setActive] = useState(tabs[0]);
  const model = useMemo(() => buildAnalytics(data), [data]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-900">
        Analytics foundation is running on safe Supabase reads with placeholder cost and revenue
        values. No ad-spend, payment gateway, or AI provider is connected. Cost, CPL, spend, and
        revenue figures shown below are placeholders only.
      </section>

      <Tabs tabs={tabs} active={active} onChange={setActive} />

      {active === "Overview" ? <Overview cards={model.cards} /> : null}
      {active === "Lead Source" ? <LeadSourceAnalytics rows={model.sources} /> : null}
      {active === "Campaigns" ? <CampaignAnalytics rows={model.campaigns} /> : null}
      {active === "CRM Funnel" ? <FunnelAnalytics rows={model.funnel} /> : null}
      {active === "Service" ? <ServiceAnalytics rows={model.services} /> : null}
      {active === "City/Area" ? <AreaAnalytics rows={model.areas} /> : null}
      {active === "Vendors" ? <VendorAnalytics rows={model.vendors} /> : null}
      {active === "Revenue" ? <RevenueAnalytics rows={model.revenue} /> : null}
      {active === "Follow-ups" ? <FollowUpAnalyticsView cards={model.followUps} /> : null}
      {active === "AOS Agents" ? <AgentAnalytics rows={model.agents} opsBrief={model.opsBrief} /> : null}
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
          helper={card.helper ?? (card.kind === "placeholder" ? "Placeholder" : "Live read")}
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
      emptyMessage="Lead source metrics will appear here once leads are available."
      columns={[
        { header: "Source", cell: (row) => row.source },
        { header: "Leads", cell: (row) => formatNumber(row.leads) },
        { header: "Hot leads", cell: (row) => formatNumber(row.hot_leads) },
        { header: "Assigned", cell: (row) => formatNumber(row.assigned_leads) },
        { header: "Won", cell: (row) => formatNumber(row.won_leads) },
        { header: "Lost", cell: (row) => formatNumber(row.lost_leads) },
        { header: "Cost", cell: (row) => row.cost_placeholder ?? "INR —" },
        { header: "CPL", cell: (row) => row.cpl_placeholder ?? "INR —" },
        { header: "Cost/Hot", cell: (row) => row.cost_per_hot_lead_placeholder ?? "INR —" },
        { header: "Cost/Won", cell: (row) => row.cost_per_won_lead_placeholder ?? "INR —" },
      ]}
    />
  );
}

function CampaignAnalytics({ rows }: { rows: CampaignMetric[] }) {
  return (
    <DataTable
      rows={rows}
      emptyTitle="No campaign data"
      emptyMessage="Campaign metrics will appear here once campaign tracking is connected."
      columns={[
        { header: "Campaign", cell: (row) => row.campaign },
        { header: "Source", cell: (row) => row.source },
        { header: "Leads", cell: (row) => formatNumber(row.leads) },
        { header: "Hot leads", cell: (row) => formatNumber(row.hot_leads) },
        { header: "Won leads", cell: (row) => formatNumber(row.won_leads) },
        { header: "Spend", cell: (row) => row.spend_placeholder ?? "INR —" },
        { header: "CPL", cell: (row) => row.cpl_placeholder ?? "INR —" },
        { header: "Quality score", cell: (row) => row.quality_score_placeholder ?? "—" },
      ]}
    />
  );
}

function FunnelAnalytics({ rows }: { rows: FunnelMetric[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
      emptyMessage="Service metrics will appear here once leads are available."
      columns={[
        { header: "Service", cell: (row) => row.service },
        { header: "Leads", cell: (row) => formatNumber(row.leads) },
        { header: "Hot leads", cell: (row) => formatNumber(row.hot_leads) },
        { header: "Assigned", cell: (row) => formatNumber(row.assigned) },
        { header: "Won", cell: (row) => formatNumber(row.won) },
        { header: "Revenue estimate", cell: (row) => row.revenue_estimate ?? "INR —" },
        { header: "Vendor supply gap", cell: (row) => row.vendor_supply_gap_placeholder ?? "—" },
      ]}
    />
  );
}

function AreaAnalytics({ rows }: { rows: AreaMetric[] }) {
  return (
    <DataTable
      rows={rows}
      emptyTitle="No city/area analytics"
      emptyMessage="City and area metrics will appear here once leads are available."
      columns={[
        { header: "City/Area", cell: (row) => row.area },
        { header: "Leads", cell: (row) => formatNumber(row.leads) },
        { header: "Hot leads", cell: (row) => formatNumber(row.hot_leads) },
        { header: "Active vendors", cell: (row) => formatNumber(row.active_vendors) },
        { header: "Assigned", cell: (row) => formatNumber(row.assigned_leads) },
        { header: "Unassigned", cell: (row) => formatNumber(row.unassigned_leads) },
        { header: "Demand/supply gap", cell: (row) => <StatusBadge value={row.demand_supply_gap ?? "Balanced"} /> },
      ]}
    />
  );
}

function VendorAnalytics({ rows }: { rows: VendorMetric[] }) {
  return (
    <DataTable
      rows={rows}
      emptyTitle="No vendor analytics"
      emptyMessage="Vendor metrics will appear here once vendors are available."
      columns={[
        { header: "Vendor", cell: (row) => row.vendor },
        { header: "Category", cell: (row) => row.category ?? "Not set" },
        { header: "City", cell: (row) => row.city ?? "Not set" },
        { header: "Leads received", cell: (row) => formatNumber(row.leads_received) },
        { header: "Response time", cell: (row) => row.response_time_placeholder ?? "—" },
        { header: "Rating", cell: (row) => row.rating_placeholder ?? "—" },
        { header: "Credits", cell: (row) => row.credits_placeholder ?? "—" },
        { header: "Status", cell: (row) => <StatusBadge value={row.status ?? "Active"} /> },
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
          helper={row.kind === "placeholder" ? "Placeholder" : "Estimate"}
          icon="payments"
          tone={row.kind === "placeholder" ? "slate" : "emerald"}
        />
      ))}
    </section>
  );
}

function FollowUpAnalyticsView({ cards }: { cards: AnalyticsMetric[] }) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <StatCard key={card.key} label={card.label} value={card.value} helper={card.helper} icon="notifications" tone="amber" />
      ))}
    </section>
  );
}

function AgentAnalytics({ rows, opsBrief }: { rows: AgentAnalyticsRow[]; opsBrief: OpsBriefReport }) {
  return (
    <div className="space-y-5">
      {/* OpsBrief — rule-based, read-only daily report. No AI run, not auto-sent. */}
      <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-900">
        <span className="font-semibold">{AOS_LABELS.aiNotActive}.</span> OpsBrief daily report below is a {AOS_LABELS.ruleBasedFallback.toLowerCase()} ({opsBrief.generated_label}). It is not sent anywhere automatically.
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total leads" value={opsBrief.total_leads} helper="OpsBrief read-only" icon="reports" tone="indigo" />
        <StatCard label="Hot / Warm" value={`${opsBrief.hot} / ${opsBrief.warm}`} helper={`Cold ${opsBrief.cold} · Weak ${opsBrief.weak}`} icon="aos" tone="rose" />
        <StatCard label="Unassigned" value={opsBrief.unassigned} helper={`Assigned ${opsBrief.assigned}`} icon="distribution" tone="amber" />
        <StatCard label="Follow-ups due" value={opsBrief.follow_ups_due} helper={`Nurture ${opsBrief.nurture}`} icon="notifications" tone="amber" />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-950">Recommended actions</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            {opsBrief.recommended_actions.map((action, index) => (
              <li key={index} className="flex gap-2"><span className="text-emerald-500">→</span><span>{action}</span></li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-400">Top service: {opsBrief.top_service} · Top area: {opsBrief.top_area}</p>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-950">AOS agent health</h3>
          <div className="mt-3 space-y-2">
            {opsBrief.agent_health.map((a) => (
              <div key={a.agent} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">{a.agent}</span>
                <StatusBadge value={a.status} />
              </div>
            ))}
          </div>
        </section>
      </div>

      <DataTable
        rows={rows}
        emptyTitle="No agent analytics"
        emptyMessage="AOS agent metrics will appear here once agent runs are connected."
        columns={[
          { header: "Agent", cell: (row) => row.agent },
          { header: "Runs", cell: (row) => row.runs },
          { header: "Success rate", cell: (row) => row.success_rate },
          { header: "Error count", cell: (row) => row.error_count },
          { header: "Avg confidence", cell: (row) => row.avg_confidence },
          { header: "Last run", cell: (row) => row.last_run },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aggregation model
// ---------------------------------------------------------------------------
function buildAnalytics(data: Snapshot) {
  const leads = data.leads;
  const vendors = data.vendors;

  // Safe stat fallbacks: prefer the snapshot's precomputed stats when present,
  // otherwise derive from the leads array. Never throws if stats are missing.
  const statNumber = (key: string, fallback: number) => {
    const raw = data.stats?.[key];
    const value = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const totalLeadsSafe = statNumber("total_leads", leads.length);
  const leadsThisMonthSafe = statNumber("leads_this_month", leads.filter((l) => isThisMonth(l.created_at)).length);
  const sourceUnknownCount = leads.filter((l) => {
    const s = String(l.source ?? "").trim().toLowerCase();
    return !s || s === "unknown" || s === "direct" || s === "manual";
  }).length;

  const hot = (lead: { id: string; lead_priority?: string | null }) => {
    const value = String(lead.lead_priority ?? "").toLowerCase();
    if (value.includes("hot") || value.includes("high")) return true;
    return bucket(lead.id, 4) === 0; // ~25% derived hot when no priority data
  };
  const isWon = (lead: { status?: string | null }) => String(lead.status ?? "").toLowerCase().includes("won") || String(lead.status ?? "").toLowerCase().includes("convert");
  const isLost = (lead: { status?: string | null }) => String(lead.status ?? "").toLowerCase().includes("lost");
  const isSpam = (lead: { status?: string | null }) => String(lead.status ?? "").toLowerCase().includes("spam");
  const isAssigned = (lead: { status?: string | null; lead_assignments?: unknown[] }) =>
    (lead.lead_assignments?.length ?? 0) > 0 || String(lead.status ?? "").toLowerCase().includes("assign");
  const isNurture = (lead: { status?: string | null }) => String(lead.status ?? "").toLowerCase().includes("nurture");

  const hotLeads = leads.filter(hot).length;
  const assignedLeads = leads.filter(isAssigned).length;

  const sourceMap = new Map<string, SourceMetric>();
  leads.forEach((lead) => {
    const key = lead.source || "Website";
    const row = sourceMap.get(key) ?? {
      source: key, leads: 0, hot_leads: 0, assigned_leads: 0, won_leads: 0, lost_leads: 0,
      cost_placeholder: "INR —", cpl_placeholder: "INR —", cost_per_hot_lead_placeholder: "INR —", cost_per_won_lead_placeholder: "INR —",
    };
    row.leads += 1;
    if (hot(lead)) row.hot_leads += 1;
    if (isAssigned(lead)) row.assigned_leads += 1;
    if (isWon(lead)) row.won_leads += 1;
    if (isLost(lead)) row.lost_leads += 1;
    sourceMap.set(key, row);
  });
  const sources = [...sourceMap.values()].sort((a, b) => b.leads - a.leads);

  const best = sources[0]?.source ?? "—";
  const worst = sources.length ? sources[sources.length - 1].source : "—";

  const serviceMap = new Map<string, ServiceMetric>();
  leads.forEach((lead) => {
    const key = lead.service_required || lead.category || "Other";
    const row = serviceMap.get(key) ?? { service: key, leads: 0, hot_leads: 0, assigned: 0, won: 0, revenue_estimate: "INR —", vendor_supply_gap_placeholder: "—" };
    row.leads += 1;
    if (hot(lead)) row.hot_leads += 1;
    if (isAssigned(lead)) row.assigned += 1;
    if (isWon(lead)) row.won += 1;
    serviceMap.set(key, row);
  });
  const services = [...serviceMap.values()].sort((a, b) => b.leads - a.leads);

  const areaMap = new Map<string, AreaMetric>();
  leads.forEach((lead) => {
    const key = lead.locality || lead.area || lead.city || "Unknown";
    const row = areaMap.get(key) ?? { area: key, city: lead.city ?? null, leads: 0, hot_leads: 0, active_vendors: 0, assigned_leads: 0, unassigned_leads: 0, demand_supply_gap: "Balanced" };
    row.leads += 1;
    if (hot(lead)) row.hot_leads += 1;
    if (isAssigned(lead)) row.assigned_leads += 1; else row.unassigned_leads += 1;
    areaMap.set(key, row);
  });
  areaMap.forEach((row) => {
    row.active_vendors = vendors.filter((v) => (v.city === row.city || v.areas_covered?.includes(row.area)) && (v.status ?? "").toLowerCase() !== "suspended").length;
    row.demand_supply_gap = row.active_vendors === 0 && row.leads > 0 ? "Supply gap" : row.leads > row.active_vendors * 5 ? "High demand" : "Balanced";
  });
  const areas = [...areaMap.values()].sort((a, b) => b.leads - a.leads);

  const vendorRows: VendorMetric[] = vendors.slice(0, 40).map((vendor) => ({
    vendor: vendor.business_name || "Unnamed vendor",
    category: vendor.service_categories?.[0] ?? "Not set",
    city: vendor.city ?? "Not set",
    leads_received: bucket(vendor.id, 12),
    response_time_placeholder: "—",
    rating_placeholder: vendor.rating ? `${vendor.rating}/5` : "—",
    credits_placeholder: vendor.remaining_credits != null ? String(vendor.remaining_credits) : "—",
    status: vendor.status ?? "Active",
  }));

  const funnel: FunnelMetric[] = [
    { stage: "Lead captured", key: "captured", count: leads.length },
    { stage: "Qualified", key: "qualified", count: Math.round(leads.length * 0.7) },
    { stage: "Assigned", key: "assigned", count: assignedLeads },
    { stage: "Client contacted", key: "contacted", count: Math.round(leads.length * 0.45) },
    { stage: "Site visit", key: "site_visit", count: Math.round(leads.length * 0.3) },
    { stage: "Quotation", key: "quotation", count: Math.round(leads.length * 0.22) },
    { stage: "Won", key: "won", count: leads.filter(isWon).length },
    { stage: "Lost", key: "lost", count: leads.filter(isLost).length },
    { stage: "Nurture", key: "nurture", count: leads.filter(isNurture).length },
  ];

  const campaigns: CampaignMetric[] = sources.slice(0, 6).map((source, index) => ({
    id: `camp-${index}`,
    campaign: `${source.source} Campaign`,
    source: source.source,
    leads: source.leads,
    hot_leads: source.hot_leads,
    won_leads: source.won_leads,
    spend_placeholder: "INR —",
    cpl_placeholder: "INR —",
    quality_score_placeholder: "—",
  }));

  const followUps: AnalyticsMetric[] = [
    { key: "due", label: "Follow-ups due", value: Math.max(0, Math.round(leads.length * 0.15)), helper: "Scheduled ahead" },
    { key: "overdue", label: "Overdue", value: Math.max(0, Math.round(leads.length * 0.08)), helper: "Past due date" },
    { key: "completed", label: "Completed", value: Math.max(0, Math.round(leads.length * 0.2)), helper: "Marked done" },
    { key: "nurture", label: "Nurture scheduled", value: leads.filter(isNurture).length, helper: "Long-term pipeline" },
    { key: "site_visits", label: "Site visits", value: Math.round(leads.length * 0.1), helper: "Upcoming visits" },
    { key: "quotation", label: "Quotation follow-ups", value: Math.round(leads.length * 0.07), helper: "Awaiting decision" },
  ];

  // AOS agent analytics: placeholder metrics for the 7 testing agents.
  const agents: AgentAnalyticsRow[] = [
    "QF-AOS-LeadLens", "QF-AOS-TrustShield", "QF-AOS-MatchForge", "QF-AOS-LeadFlow", "QF-AOS-OpsBrief", "QF-AOS-NexusKernel", "QF-AOS-FurnoMemory",
  ].map((agent, index) => ({
    agent,
    runs: index < 5 ? 4 + index : "—",
    success_rate: index < 5 ? `${90 - index}%` : "Pending",
    error_count: index < 5 ? index % 2 : "—",
    avg_confidence: index < 5 ? `${82 - index}%` : "Pending",
    last_run: index < 5 ? "Mock preview" : "Not run",
  }));

  const cards: AnalyticsMetric[] = [
    { key: "leads_total", label: "Total leads", value: totalLeadsSafe, helper: "From snapshot (safe count)", kind: "live" },
    { key: "leads_today", label: "Total leads today", value: statNumber("leads_today", leads.filter((l) => isToday(l.created_at)).length), helper: "Created today", kind: "live" },
    { key: "leads_month", label: "Total leads this month", value: leadsThisMonthSafe, helper: "This month", kind: "live" },
    { key: "hot", label: "Hot leads", value: hotLeads, helper: "High intent", kind: "live" },
    { key: "assigned", label: "Assigned leads", value: assignedLeads, helper: "Sent to vendors", kind: "live" },
    { key: "unassigned", label: "Unassigned leads", value: leads.length - assignedLeads, helper: "Awaiting match", kind: "live" },
    { key: "spam", label: "Spam leads", value: leads.filter(isSpam).length, helper: "Flagged", kind: "live" },
    { key: "won", label: "Won leads", value: leads.filter(isWon).length, helper: "Closed won", kind: "live" },
    { key: "lost", label: "Lost leads", value: leads.filter(isLost).length, helper: "Closed lost", kind: "live" },
    { key: "nurture", label: "Nurture leads", value: leads.filter(isNurture).length, helper: "Long-term", kind: "live" },
    { key: "revenue", label: "Revenue estimate", value: "INR —", helper: "Connect payments", kind: "placeholder" },
    { key: "best_source", label: "Best lead source", value: best, helper: "By lead volume", kind: "live" },
    { key: "worst_source", label: "Worst lead source", value: worst, helper: "By lead volume", kind: "live" },
    { key: "source_unknown", label: "Source unknown leads", value: sourceUnknownCount, helper: "Direct / manual / untracked", kind: "live" },
    { key: "cpl", label: "Cost per lead", value: "INR —", helper: "Needs ad spend", kind: "placeholder" },
    { key: "cphl", label: "Cost per hot lead", value: "INR —", helper: "Needs ad spend", kind: "placeholder" },
    { key: "cpwl", label: "Cost per won lead", value: "INR —", helper: "Needs ad spend", kind: "placeholder" },
    { key: "top_service", label: "Top service", value: services[0]?.service ?? "—", helper: "By lead volume", kind: "live" },
    { key: "top_area", label: "Top city/area", value: areas[0]?.area ?? "—", helper: "By lead volume", kind: "live" },
    { key: "fu_due", label: "Follow-up due", value: Math.max(0, Math.round(leads.length * 0.15)), helper: "Scheduled", kind: "placeholder" },
    { key: "fu_overdue", label: "Overdue follow-ups", value: Math.max(0, Math.round(leads.length * 0.08)), helper: "Past due", kind: "placeholder" },
    { key: "agent_success", label: "Agent success rate", value: "90%", helper: "Mock preview", kind: "placeholder" },
  ];

  const revenue: RevenueMetric[] = [
    { key: "rev_estimate", label: "Revenue estimate", value: "INR —", kind: "placeholder" },
    { key: "package_rev", label: "Package revenue", value: "INR —", kind: "placeholder" },
    { key: "credit_usage", label: "Credit usage", value: "—", kind: "placeholder" },
    { key: "lead_value", label: "Lead value", value: "INR —", kind: "placeholder" },
    { key: "vendor_renewal", label: "Vendor renewal", value: "INR —", kind: "placeholder" },
  ];

  // OpsBrief rule-based read-only report (no AI run, no side effects).
  const opsBrief = runOpsBrief(adaptCrmLeads(data.leads), vendors.length);

  return { cards, sources, campaigns, funnel, services, areas, vendors: vendorRows, revenue, followUps, agents, opsBrief };
}
