"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Blank,
  ChartCard,
  DataTable,
  Drawer,
  InfoGrid,
  NoteBar,
  Panel,
  ProgressBar,
  Quiet,
  SectionCard,
  SecondaryButton,
  StatusBadge,
} from "@/components/admin/AdminPrimitives";
import { AdminIcon } from "@/components/admin/AdminIcon";
import type { AdminIconName } from "@/components/admin/adminConfig";
import {
  emptyCommandCenterData,
  type CommandCenterData,
  type Lead,
  type LeadSampleRow,
  type Vendor,
} from "@/components/admin/adminTypes";
import { PIPELINE_COLUMNS } from "@/components/admin/crm/lead/leadCrmTypes";
import { statusBucket } from "@/components/admin/crm/lead/leadCrmUtils";
import {
  assignmentStatus,
  formatDate,
  formatINR,
  formatNumber,
  groupBy,
  maskPhone,
  packageName,
  revenueByPackage,
  shortId,
  vendorName,
} from "@/components/admin/adminUtils";

const closedLeadStatuses = new Set(["converted", "won", "lost", "duplicate", "spam", "invalid"]);

/**
 * Every entry points at an admin route that already exists in adminConfig.
 * Nothing here performs a mutation — these are navigation shortcuts only.
 */
const quickOperations: Array<{ href: string; label: string; detail: string; icon: AdminIconName }> = [
  { href: "/admin/vendors", label: "Vendor queue", detail: "Verify and manage vendors", icon: "vendors" },
  { href: "/admin/lead-distribution", label: "Lead distribution", detail: "Rules, logs, eligibility", icon: "distribution" },
  { href: "/admin/packages", label: "Packages", detail: "Lead packs and pricing", icon: "packages" },
  { href: "/admin/cities", label: "Cities", detail: "Coverage and launch status", icon: "cities" },
  { href: "/admin/categories", label: "Categories", detail: "Services and subcategories", icon: "categories" },
  { href: "/admin/settings", label: "Settings", detail: "Global marketplace controls", icon: "settings" },
];

/** Semantic accent palette for the CSS donut + legends (dark theme tokens). */
const CHART_COLORS = ["#2d7cff", "#00d8ff", "#13d89a", "#7c4dff", "#ff9f1c", "#71839d"];

type QueueItem = {
  id: string;
  label: string;
  value: number;
  severity: "critical" | "warning" | "clear";
  icon: AdminIconName;
  href: string;
  approximate?: boolean;
};

/**
 * C-PERF1: the dashboard consumes the bounded CommandCenterData contract
 * (accurate count-query KPIs + ≤10-row previews + a thin ≤50-row aggregate
 * sample) instead of the broad every-table snapshot. The approved dark
 * command-center composition is unchanged.
 */
export function AdminDashboard({ data, error }: { data: CommandCenterData | null; error?: string | null }) {
  const d = data ?? emptyCommandCenterData();
  const stats = d.stats ?? {};
  const totalLeads = d.meta?.totals?.total_leads ?? Number(stats.total_leads ?? 0);
  const sampleSize = d.leadSample.length;
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);

  // Sample-scoped figures (labelled as such): derived from the thin latest-N
  // lead sample, exactly like the previous 50-row snapshot, but ~1/10th the
  // payload. Nothing here pretends to be a global total.
  const hotLeads = d.leadSample.filter(isHotLead);
  const unassignedLeads = d.leadSample.filter(isUnassignedLead);
  const followUpsDue = Number(stats.pending_followups ?? 0);
  // Vendor lookup pool for drawers (recent + credit-watch, deduped).
  const vendorPool = useMemo(() => {
    const map = new Map<string, Vendor>();
    [...d.vendors, ...d.creditWatch].forEach((vendor) => map.set(vendor.id, vendor));
    return [...map.values()];
  }, [d.vendors, d.creditWatch]);
  const lowBalanceTotal = Number(stats.low_balance_vendors ?? 0);

  const queueItems: QueueItem[] = [
    { id: "unassigned-leads", label: "Unassigned leads", value: unassignedLeads.length, severity: unassignedLeads.length > 0 ? "warning" : "clear", icon: "distribution", href: "/admin/leads", approximate: true },
    { id: "pending-vendors", label: "Vendors pending approval", value: Number(stats.pending_vendors ?? 0), severity: Number(stats.pending_vendors ?? 0) > 0 ? "warning" : "clear", icon: "vendors", href: "/admin/vendors" },
    { id: "pending-payments", label: "Pending payments", value: Number(stats.pending_payments ?? 0), severity: Number(stats.pending_payments ?? 0) > 0 ? "warning" : "clear", icon: "payments", href: "/admin/payments" },
    { id: "low-balance", label: "Low credit vendors", value: lowBalanceTotal, severity: lowBalanceTotal > 0 ? "critical" : "clear", icon: "subscriptions", href: "/admin/vendor-subscriptions" },
    { id: "expired-vendors", label: "Package renewals due", value: Number(stats.expired_vendors ?? 0), severity: Number(stats.expired_vendors ?? 0) > 0 ? "warning" : "clear", icon: "subscriptions", href: "/admin/vendor-subscriptions" },
    { id: "bad-lead-reports", label: "Bad lead reports", value: Number(stats.bad_lead_reports_pending ?? 0), severity: Number(stats.bad_lead_reports_pending ?? 0) > 0 ? "warning" : "clear", icon: "reviews", href: "/admin/lead-distribution" },
  ];

  /**
   * Primary KPI rail — six real metrics, mirroring the approved command
   * center. Trend arrows are shown NOWHERE because no metric history table
   * exists; each tile carries a truthful contextual line instead.
   */
  const kpis: Array<{
    label: string;
    value: React.ReactNode;
    helper: string;
    icon: AdminIconName;
    glow: string;
    bloom: string;
    href: string;
  }> = [
    { label: "Total Leads", value: formatNumber(stats.total_leads), helper: `${formatNumber(stats.leads_this_week)} this week`, icon: "leads", glow: "qfa-glow-violet", bloom: "rgba(124, 77, 255, 0.22)", href: "/admin/leads" },
    { label: "New Leads Today", value: formatNumber(stats.leads_today), helper: `${formatNumber(stats.leads_this_month)} this month`, icon: "leads", glow: "qfa-glow-cyan", bloom: "rgba(0, 216, 255, 0.18)", href: "/admin/leads" },
    { label: "Hot Leads", value: formatNumber(hotLeads.length), helper: `In latest ${formatNumber(sampleSize)} leads`, icon: "notifications", glow: "qfa-glow-red", bloom: "rgba(255, 77, 103, 0.2)", href: "/admin/crm" },
    { label: "Unassigned Leads", value: formatNumber(unassignedLeads.length), helper: `In latest ${formatNumber(sampleSize)} leads`, icon: "distribution", glow: "qfa-glow-amber", bloom: "rgba(255, 159, 28, 0.2)", href: "/admin/leads" },
    { label: "Follow-ups Due", value: formatNumber(followUpsDue), helper: "Sales queue", icon: "crm", glow: "qfa-glow-blue", bloom: "rgba(45, 124, 255, 0.22)", href: "/admin/crm" },
    { label: "Revenue This Month", value: formatINR(stats.revenue_this_month), helper: `${formatINR(stats.total_revenue)} lifetime`, icon: "payments", glow: "qfa-glow-green", bloom: "rgba(19, 216, 154, 0.2)", href: "/admin/payments" },
  ];

  /**
   * Pipeline stages use the SAME deterministic bucketing as the CRM
   * pipeline view (statusBucket), so the dashboard and CRM never disagree.
   * Counts cover the thin latest-N sample — labelled as such.
   */
  const pipeline = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of d.leadSample) {
      const bucket = statusBucket(lead as Lead, lead.lead_assignments?.length ?? 0);
      // "duplicate" shares the Spam / Duplicate column, same as the CRM board.
      const key = bucket === "duplicate" ? "spam" : bucket;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return PIPELINE_COLUMNS.map((column) => ({
      bucket: column.bucket,
      label: column.label,
      count: counts.get(column.bucket) ?? 0,
    })).filter((stage) => stage.bucket !== "spam" || stage.count > 0);
  }, [d.leadSample]);

  const cityRows = useMemo(() => groupBy(d.leadSample, (lead) => lead.city || "City not set"), [d.leadSample]);
  const categoryRows = useMemo(
    () => groupBy(d.leadSample, (lead) => lead.service_required || lead.category || "Not specified"),
    [d.leadSample],
  );
  const sourceRows = useMemo(() => groupBy(d.leadSample, (lead) => lead.source || "Website"), [d.leadSample]);
  // Revenue-by-package over the FULL paid-payments ledger (column-only
  // projection) — no longer a latest-50 subset.
  const revenueRows = useMemo(() => revenueByPackage(d.paidPayments, d.packages), [d.paidPayments, d.packages]);
  const recentActivity = useMemo(() => buildRecentActivity(d), [d]);
  const recentLeads = d.recentLeads;
  const vendorHealthRows = d.creditWatch;

  return (
    <div className="space-y-4">
      {/* Command strip: live context left, real destinations right. */}
      <div className="flex flex-col gap-2.5 border-b border-[color:var(--qfa-line)] pb-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StatusBadge value="Superadmin" tone="slate" />
          <StatusBadge value={`${formatNumber(totalLeads)} leads`} tone="emerald" />
          <StatusBadge value={`${formatNumber(stats.active_vendors)} active vendors`} tone="blue" />
          <StatusBadge value={`Updated ${formatDate(d.generatedAt)}`} tone="slate" />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <LinkButton href="/admin/leads" icon="leads">Review leads</LinkButton>
          <LinkButton href="/admin/vendors" icon="vendors">Vendor queue</LinkButton>
          <LinkButton href="/admin/payments" icon="payments">Revenue</LinkButton>
        </div>
      </div>

      {error ? (
        <NoteBar tone="warning">Admin data loaded with fallback UI because Supabase returned: {error}</NoteBar>
      ) : null}

      {/* KPI rail — six primary metrics across desktop, each a real route. */}
      <section className="grid grid-cols-2 gap-2.5 md:grid-cols-3 2xl:grid-cols-6" aria-label="Marketplace key figures">
        {kpis.map((kpi, index) => (
          <Link
            key={kpi.label}
            href={kpi.href}
            className={`qfa-kpi qfa-focus qfa-rise ${index >= 2 ? `qfa-rise-${Math.min(4, index)}` : ""} px-3.5 py-3`}
            style={{ "--kpi-bloom": kpi.bloom } as React.CSSProperties}
          >
            <div className="flex items-center gap-2.5">
              <span className={`qfa-glow-chip ${kpi.glow} shrink-0`} aria-hidden="true">
                <AdminIcon name={kpi.icon} className="h-4 w-4" />
              </span>
              <span className="min-w-0 truncate text-xs font-semibold text-slate-600">{kpi.label}</span>
            </div>
            <div className="mt-2.5 truncate text-[26px] font-semibold leading-none tracking-tight text-slate-950 tabular-nums">
              {kpi.value}
            </div>
            <p className="mt-2 truncate text-[11px] text-slate-500">{kpi.helper}</p>
          </Link>
        ))}
      </section>

      <p className="text-[11px] text-slate-500">
        KPI totals are live server-side counts. Sample-scoped figures (hot, unassigned, pipeline, distributions) cover the
        latest {formatNumber(sampleSize)} leads and are labelled as such.
      </p>

      {/* Pipeline overview — same buckets as the CRM board, chevron rail. */}
      <SectionCard
        title="Lead Pipeline Overview"
        description={`Across the latest ${formatNumber(sampleSize)} leads.`}
        action={
          <Link href="/admin/crm" className="qfa-focus rounded text-[13px] font-semibold text-emerald-700 hover:underline">
            View full pipeline
          </Link>
        }
      >
        <div className="qfa-pipe" role="list" aria-label="Lead pipeline stages">
          {pipeline.map((stage) => {
            const percent = sampleSize ? Math.round((stage.count / sampleSize) * 100) : 0;
            return (
              <div key={stage.bucket} role="listitem" className={`qfa-pipe-seg qfa-pipe--${stage.bucket}`}>
                <p className="qfa-pipe-label truncate text-[11px] font-bold uppercase tracking-wide">{stage.label}</p>
                <p className="mt-1 text-xl font-semibold leading-none tracking-tight text-slate-950 tabular-nums">
                  {formatNumber(stage.count)}
                </p>
                <p className="mt-1 text-[10px] font-semibold text-slate-500 tabular-nums">{percent}%</p>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Center band: dense recent-leads table + founder action queue. */}
      <section className="grid gap-4 xl:grid-cols-[1.55fr_0.85fr]">
        <SectionCard
          title="Recent Leads"
          description={`Latest ${formatNumber(recentLeads.length)} enquiries. Open any row for full detail.`}
          action={
            <Link href="/admin/leads" className="qfa-focus rounded text-[13px] font-semibold text-emerald-700 hover:underline">
              View all
            </Link>
          }
          className="min-w-0"
        >
          <DataTable
            columns={[
              {
                header: "Client",
                cell: (lead: Lead) => (
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-slate-950">{lead.name || "Unnamed lead"}</p>
                    <p className="truncate text-[11px] text-slate-500">{maskPhone(lead.phone)}</p>
                  </div>
                ),
              },
              {
                header: "Requirement",
                cell: (lead: Lead) => (
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-slate-700">{lead.service_required || lead.category || <Blank />}</p>
                    <p className="truncate text-[11px] text-slate-500">{lead.budget || "Budget not set"}</p>
                  </div>
                ),
              },
              { header: "City", cell: (lead: Lead) => <span className="text-[13px] text-slate-700">{lead.city || <Blank />}</span> },
              {
                header: "Quality",
                cell: (lead: Lead) => <QualityCell lead={lead} />,
              },
              { header: "Status", cell: (lead: Lead) => <StatusBadge value={lead.status || "New"} /> },
              {
                header: "Created",
                cell: (lead: Lead) => <span className="whitespace-nowrap text-[11px] text-slate-500">{formatDate(lead.created_at)}</span>,
              },
              {
                header: "",
                cell: (lead: Lead) => (
                  <SecondaryButton size="sm" onClick={() => setSelectedLead(lead)} aria-label={`View ${lead.name || "lead"}`}>
                    View
                  </SecondaryButton>
                ),
                className: "text-right",
              },
            ]}
            rows={recentLeads}
            density="compact"
            getRowKey={(lead) => lead.id}
            emptyTitle="No leads yet"
            emptyMessage="New public enquiries will appear here automatically."
          />
        </SectionCard>

        {/* Founder Action Queue — real actionable counts, real destinations. */}
        <SectionCard
          title="Founder Action Queue"
          description="Everything that needs a decision, ranked by severity."
          className="h-fit"
        >
          <div className="space-y-0.5">
            {queueItems.map((item) => (
              <Link key={item.id} href={item.href} className="qfa-queue-row qfa-focus group">
                <span
                  className={`qfa-glow-chip shrink-0 ${
                    item.severity === "critical" ? "qfa-glow-red" : item.severity === "warning" ? "qfa-glow-amber" : "qfa-glow-green"
                  }`}
                  aria-hidden="true"
                >
                  <AdminIcon name={item.icon} className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-700 group-hover:text-slate-950">
                  {item.label}
                  {item.approximate ? <span className="sr-only"> (in latest {sampleSize} leads)</span> : null}
                </span>
                <span className={`qfa-count qfa-count--${item.severity}`}>
                  {formatNumber(item.value)}
                </span>
              </Link>
            ))}
          </div>
          <p className="mt-3 border-t border-[color:var(--qfa-line-soft)] pt-2.5 text-[11px] leading-4 text-slate-500">
            Unassigned leads are counted over the latest {formatNumber(sampleSize)}-lead sample; the other counts are live
            server-side totals.
          </p>
        </SectionCard>
      </section>

      {/* Analytics band — four compact panels over the labelled sample. */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DonutPanel title="Leads by City" rows={cityRows} total={sampleSize} />
        <ChartCard title="Leads by Category" rows={categoryRows} />
        <ChartCard title="Lead Sources" rows={sourceRows} />

        <SectionCard title="Vendor Credit Balance" description="Lowest credit balances across all vendors.">
          <div className="space-y-2">
            {vendorHealthRows.length ? (
              vendorHealthRows.map((vendor) => {
                const remaining = Number(vendor.remaining_credits ?? 0);
                const total = Number(vendor.total_credits ?? 0);
                const pct = total > 0 ? Math.round((remaining / total) * 100) : 0;
                const low = remaining <= 3;
                return (
                  <button
                    key={vendor.id}
                    type="button"
                    onClick={() => setSelectedVendor(vendor)}
                    className="qfa-focus w-full rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line-soft)] bg-white p-2.5 text-left transition-colors hover:border-[color:var(--qfa-line-strong)] hover:bg-[color:var(--qfa-inset)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate text-[13px] font-semibold text-slate-950">{vendor.business_name || "Unnamed vendor"}</p>
                      <span className="shrink-0 text-[12px] font-semibold tabular-nums text-slate-900">
                        {formatNumber(remaining)}
                        {total > 0 ? <span className="text-slate-400">/{formatNumber(total)}</span> : null}
                      </span>
                    </div>
                    {total > 0 ? (
                      <div className="mt-1.5">
                        <ProgressBar value={pct} tone={low ? "rose" : pct >= 40 ? "emerald" : "amber"} />
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-slate-400">No package credits recorded.</p>
                    )}
                    {low ? (
                      <p className="mt-1 text-[11px] font-semibold text-rose-700">Low balance — at or under 3 credits.</p>
                    ) : null}
                  </button>
                );
              })
            ) : (
              <p className="text-[13px] text-slate-500">Vendor credit balances will appear after vendor onboarding starts.</p>
            )}
          </div>
        </SectionCard>
      </section>

      {/* Secondary band: revenue, activity, quick operations. */}
      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Revenue Snapshot" description="Paid collections by package, over the full payment ledger.">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <MetricPill label="Month" value={formatINR(stats.revenue_this_month)} />
            <MetricPill label="Lifetime" value={formatINR(stats.total_revenue)} />
          </div>
          <FunnelRows rows={revenueRows} total={Number(stats.total_revenue ?? 0)} money />
        </SectionCard>

        <SectionCard title="Recent Activity" description="Latest lead, vendor, and payment events.">
          <div className="divide-y divide-[color:var(--qfa-line-soft)]">
            {recentActivity.length ? (
              recentActivity.map((item) => (
                <div key={`${item.type}-${item.id}`} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge value={item.type} tone={item.tone} />
                      <p className="truncate text-[13px] font-semibold text-slate-950">{item.title}</p>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{item.detail}</p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-400">{formatDate(item.date)}</span>
                </div>
              ))
            ) : (
              <Quiet className="p-3 text-[13px] text-slate-500">Recent marketplace activity will appear here.</Quiet>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Quick Operations" description="Jump straight into an existing admin workspace.">
          <div className="grid gap-1.5">
            {quickOperations.map((op) => (
              <Link
                key={op.href}
                href={op.href}
                className="qfa-focus group flex items-center gap-2.5 rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line-soft)] bg-white px-3 py-2 transition-colors hover:border-[color:var(--qfa-line-strong)] hover:bg-[color:var(--qfa-inset)]"
              >
                <AdminIcon name={op.icon} className="h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-emerald-600" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-slate-900">{op.label}</span>
                  <span className="block truncate text-[11px] text-slate-500">{op.detail}</span>
                </span>
              </Link>
            ))}
          </div>
        </SectionCard>
      </section>

      {selectedLead ? <LeadDrawer lead={selectedLead} vendors={vendorPool} onClose={() => setSelectedLead(null)} /> : null}
      {selectedVendor ? <VendorDrawer vendor={selectedVendor} onClose={() => setSelectedVendor(null)} /> : null}
    </div>
  );
}

/**
 * Lead quality cell. `lead_quality_score` is a real stored column; when it is
 * absent we fall back to the stored priority label, and to a quiet dash when
 * neither exists. Nothing synthesises a score.
 */
function QualityCell({ lead }: { lead: Lead }) {
  const score = lead.lead_quality_score;
  if (score != null && Number.isFinite(Number(score))) {
    const value = Number(score);
    const tone = value >= 70 ? "qfa-count--clear" : value >= 40 ? "qfa-count--warning" : "qfa-count--critical";
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={`qfa-count ${tone}`}>{value}</span>
        {lead.lead_priority ? <StatusBadge value={lead.lead_priority} /> : null}
      </span>
    );
  }
  if (lead.lead_priority) return <StatusBadge value={lead.lead_priority} />;
  return <Blank />;
}

/**
 * CSS-only donut over real grouped counts (top 5 + Others). No chart
 * dependency; the ring is a conic-gradient and the hole is a mask.
 */
function DonutPanel({ title, rows, total }: { title: string; rows: Array<{ label: string; value: number }>; total: number }) {
  const top = rows.slice(0, 5);
  const otherValue = rows.slice(5).reduce((sum, row) => sum + row.value, 0);
  const segments = otherValue > 0 ? [...top, { label: "Others", value: otherValue }] : top;
  const sum = Math.max(1, segments.reduce((acc, seg) => acc + seg.value, 0));

  let cursor = 0;
  const stops = segments.map((segment, index) => {
    const start = (cursor / sum) * 360;
    cursor += segment.value;
    const end = (cursor / sum) * 360;
    return `${CHART_COLORS[index % CHART_COLORS.length]} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
  });

  return (
    <SectionCard title={title}>
      {segments.length ? (
        <div className="flex items-center gap-4">
          <div className="relative shrink-0" aria-hidden="true">
            <div className="qfa-donut" style={{ background: `conic-gradient(${stops.join(", ")})` }} />
            <div className="absolute inset-0 grid place-items-center">
              <span className="text-center">
                <span className="block text-lg font-semibold leading-none tracking-tight text-slate-950 tabular-nums">
                  {formatNumber(total)}
                </span>
                <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-wide text-slate-500">Latest</span>
              </span>
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {segments.map((segment, index) => {
              const percent = Math.round((segment.value / sum) * 100);
              return (
                <li key={segment.label} className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                  />
                  <span className="min-w-0 flex-1 truncate text-slate-600">{segment.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                    {formatNumber(segment.value)} <span className="font-normal text-slate-500">({percent}%)</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-[13px] text-slate-500">No data in this snapshot yet.</p>
      )}
    </SectionCard>
  );
}

function LinkButton({ href, children, icon }: { href: string; children: React.ReactNode; icon: AdminIconName }) {
  return (
    <Link
      href={href}
      className="qfa-focus inline-flex h-[var(--qfa-control-h)] items-center justify-center gap-1.5 rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line)] bg-white px-3 text-[13px] font-semibold text-slate-700 transition-colors hover:border-[color:var(--qfa-line-strong)] hover:bg-[color:var(--qfa-inset)]"
    >
      <AdminIcon name={icon} className="h-3.5 w-3.5 text-slate-400" />
      {children}
    </Link>
  );
}

function MetricPill({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Quiet className="px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 truncate text-[15px] font-semibold text-slate-950">{value}</p>
    </Quiet>
  );
}

function FunnelRows({ rows, total, money = false }: { rows: Array<{ label: string; value: number }>; total: number; money?: boolean }) {
  const normalizedTotal = Math.max(1, total);
  const visibleRows = rows.length ? rows.slice(0, 6) : [];

  if (!visibleRows.length) {
    return <p className="text-[13px] text-slate-500">No data in this snapshot yet.</p>;
  }

  return (
    <div className="space-y-2.5">
      {visibleRows.map((row) => {
        const percent = total ? Math.round((row.value / normalizedTotal) * 100) : 0;
        return (
          <div key={row.label} className="space-y-1">
            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="min-w-0 truncate text-slate-600">{row.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                {money ? formatINR(row.value) : `${formatNumber(row.value)} (${percent}%)`}
              </span>
            </div>
            <ProgressBar value={Math.max(row.value ? 6 : 3, percent)} />
          </div>
        );
      })}
      {rows.length > 6 ? (
        <p className="pt-0.5 text-[11px] text-slate-500">+{rows.length - 6} more not shown.</p>
      ) : null}
    </div>
  );
}

function LeadDrawer({ lead, vendors, onClose }: { lead: Lead; vendors: Vendor[]; onClose: () => void }) {
  return (
    <Drawer
      title={lead.name || "Lead details"}
      subtitle={`Lead ID ${shortId(lead.id)}`}
      onClose={onClose}
      header={
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge value={lead.status || "New"} />
          {lead.lead_priority ? <StatusBadge value={lead.lead_priority} /> : null}
          <StatusBadge value={lead.source || "Website"} tone="slate" />
        </div>
      }
    >
      <div className="space-y-4">
        <DrawerBlock title="Client">
          <InfoGrid
            rows={[
              ["Phone", lead.phone || <Blank />],
              ["Email", lead.email || <Blank />],
              ["City", lead.city || <Blank />],
              ["Locality", lead.locality || lead.area || <Blank />],
            ]}
          />
        </DrawerBlock>

        <DrawerBlock title="Requirement">
          <InfoGrid
            rows={[
              ["Category", lead.service_required || lead.category || <Blank />],
              ["Budget", lead.budget || <Blank />],
              ["Timeline", lead.timeline || <Blank />],
            ]}
          />
          <p className="mt-2 text-[13px] leading-5 text-slate-600">
            {lead.message || "No detailed requirement message was provided."}
          </p>
        </DrawerBlock>

        <DrawerBlock title="Assigned vendors">
          <div className="space-y-1.5">
            {lead.lead_assignments?.length ? (
              lead.lead_assignments.map((assignment) => (
                <div key={assignment.id} className="flex items-center justify-between gap-3 rounded-[var(--qfa-radius-sm)] bg-[color:var(--qfa-inset)] px-2.5 py-1.5 text-[13px]">
                  <span className="min-w-0 truncate font-medium text-slate-700">{vendorName(vendors, assignment.vendor_id)}</span>
                  <StatusBadge value={assignmentStatus(assignment)} />
                </div>
              ))
            ) : (
              <p className="text-[13px] text-slate-500">No vendor assignment recorded yet.</p>
            )}
          </div>
        </DrawerBlock>
      </div>
    </Drawer>
  );
}

function VendorDrawer({ vendor, onClose }: { vendor: Vendor; onClose: () => void }) {
  return (
    <Drawer
      title={vendor.business_name || "Vendor details"}
      subtitle={`Vendor ID ${shortId(vendor.id)}`}
      onClose={onClose}
      header={
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge value={vendor.status || "Pending"} />
          <StatusBadge value={vendor.is_active === false ? "Disabled" : "Enabled"} />
          <StatusBadge value={`${formatNumber(vendor.remaining_credits)} credits left`} tone="slate" />
        </div>
      }
    >
      <div className="space-y-4">
        <DrawerBlock title="Contact">
          <InfoGrid
            rows={[
              ["Owner", vendor.owner_name || <Blank />],
              ["Phone", vendor.phone || <Blank />],
              ["Email", vendor.email || <Blank />],
              ["City", vendor.city || <Blank />],
            ]}
          />
        </DrawerBlock>

        <DrawerBlock title="Coverage">
          <InfoGrid
            rows={[
              ["Categories", vendor.service_categories?.join(", ") || <Blank />],
              ["Areas", vendor.areas_covered?.join(", ") || <Blank />],
            ]}
          />
        </DrawerBlock>

        <DrawerBlock title="Capacity">
          <InfoGrid
            rows={[
              ["Credits remaining", formatNumber(vendor.remaining_credits)],
              ["Credits purchased", vendor.total_credits != null ? formatNumber(vendor.total_credits) : <Blank />],
              ["Package", vendor.package_name || <Blank />],
              ["Package status", vendor.package_status || <Blank />],
              ["Rating", vendor.rating ? `${vendor.rating}/5` : "Not rated"],
              ["Public visibility", vendor.public_visibility === false ? "Hidden" : "Visible"],
            ]}
          />
        </DrawerBlock>

        {/* The action menu that used to sit here offered "Assign package",
            "Pause vendor" and "Add internal note", all wired to `() => {}`.
            Those are real operations that belong to the guarded Vendors and
            Vendor Subscriptions workspaces, so this panel links to them
            instead of presenting menu items that do nothing. */}
        <Panel className="p-3">
          <p className="text-[13px] font-semibold text-slate-900">Manage this vendor</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Verification, package and credit changes are performed in their own guarded workspaces.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Link
              href="/admin/vendors"
              className="qfa-focus inline-flex h-8 items-center rounded-[var(--qfa-radius-sm)] border border-[color:var(--qfa-line)] bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Vendors workspace
            </Link>
            <Link
              href="/admin/vendor-subscriptions"
              className="qfa-focus inline-flex h-8 items-center rounded-[var(--qfa-radius-sm)] border border-[color:var(--qfa-line)] bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Subscriptions & credits
            </Link>
            <Link
              href={`/admin/vendor-crm/${vendor.id}`}
              className="qfa-focus inline-flex h-8 items-center rounded-[var(--qfa-radius-sm)] border border-[color:var(--qfa-line)] bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Vendor CRM profile
            </Link>
          </div>
        </Panel>
      </div>
    </Drawer>
  );
}

/** Section wrapper inside a drawer: heading + quiet grouping, not a card stack. */
function DrawerBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function isHotLead(lead: LeadSampleRow) {
  const priority = String(lead.lead_priority ?? "").toLowerCase();
  const status = String(lead.status ?? "").toLowerCase();
  const score = Number(lead.lead_quality_score ?? 0);
  return priority.includes("hot") || priority.includes("high") || score >= 70 || status.includes("interested") || status.includes("quotation");
}

function isUnassignedLead(lead: LeadSampleRow) {
  const status = String(lead.status ?? "New").toLowerCase();
  return !closedLeadStatuses.has(status) && (lead.lead_assignments?.length ?? 0) === 0;
}

function buildRecentActivity(d: CommandCenterData) {
  return [
    ...d.recentLeads.slice(0, 5).map((lead) => ({
      id: lead.id,
      type: "Lead",
      tone: "blue" as const,
      title: lead.name || "New lead",
      detail: `${lead.service_required || lead.category || "Requirement"} - ${lead.city || "City not set"}`,
      date: lead.created_at,
    })),
    ...d.vendors.slice(0, 4).map((vendor) => ({
      id: vendor.id,
      type: "Vendor",
      tone: "emerald" as const,
      title: vendor.business_name || "Vendor registration",
      detail: `${vendor.city || "City not set"} - ${vendor.status || "Pending"}`,
      date: vendor.created_at,
    })),
    ...d.payments.slice(0, 4).map((payment) => ({
      id: payment.id,
      type: "Payment",
      tone: "amber" as const,
      title: formatINR(payment.amount),
      detail: `${vendorName(d.vendors, payment.vendor_id)} - ${packageName(d.packages, payment.package_id)}`,
      date: payment.created_at,
    })),
  ]
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, 8);
}
