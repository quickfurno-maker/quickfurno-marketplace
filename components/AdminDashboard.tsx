"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Blank,
  ChartCard,
  Drawer,
  InfoGrid,
  NoteBar,
  Panel,
  ProgressBar,
  Quiet,
  SectionCard,
  SecondaryButton,
  StatCard,
  StatusBadge,
} from "@/components/admin/AdminPrimitives";
import { AdminIcon } from "@/components/admin/AdminIcon";
import { AttentionCenter, type AttentionItem } from "@/components/admin/AttentionCenter";
import type { AdminIconName } from "@/components/admin/adminConfig";
import { emptySnapshot, type Lead, type Snapshot, type Vendor } from "@/components/admin/adminTypes";
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

export function AdminDashboard({ snapshot, error }: { snapshot: Snapshot | null; error?: string | null }) {
  const data = snapshot ?? emptySnapshot();
  const stats = data.stats ?? {};
  // The snapshot returns the latest limited rows (see services/adminService.ts);
  // KPI totals below come from accurate server-side count queries.
  const meta = data.snapshotMeta;
  const totalLeads = meta?.totals?.total_leads ?? Number(stats.total_leads ?? data.leads.length);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);

  const hotLeads = data.leads.filter(isHotLead);
  const unassignedLeads = data.leads.filter(isUnassignedLead);
  const followUpsDue = Number(stats.pending_followups ?? data.leads.filter((lead) => ["New", "Verified", "Assigned", "Contacted"].includes(lead.status || "")).length);
  const lowBalanceVendors = data.vendors.filter((vendor) => Number(vendor.remaining_credits ?? 0) <= 3);
  // `low_balance_vendors` is a server-side count over ALL vendors. The filtered
  // list above only covers the latest loaded rows and is used for the detail
  // table, never for the headline number.
  const lowBalanceTotal = Number(stats.low_balance_vendors ?? lowBalanceVendors.length);

  const attentionItems: AttentionItem[] = [
    {
      id: "unassigned-leads",
      label: "Unassigned leads",
      value: unassignedLeads.length,
      detail: "Leads with no vendor matched yet.",
      severity: unassignedLeads.length > 0 ? "warning" : "clear",
      icon: "distribution",
      href: "/admin/leads",
      approximate: true,
    },
    {
      id: "pending-vendors",
      label: "Pending vendor approvals",
      value: Number(stats.pending_vendors ?? 0),
      detail: "Vendor accounts awaiting verification.",
      severity: Number(stats.pending_vendors ?? 0) > 0 ? "warning" : "clear",
      icon: "vendors",
      href: "/admin/vendors",
    },
    {
      id: "pending-payments",
      label: "Pending payments",
      value: Number(stats.pending_payments ?? 0),
      detail: "Collections not yet reconciled.",
      severity: Number(stats.pending_payments ?? 0) > 0 ? "warning" : "clear",
      icon: "payments",
      href: "/admin/payments",
    },
    {
      id: "low-balance",
      label: "Low balance vendors",
      value: lowBalanceTotal,
      detail: "Vendors close to running out of lead credits.",
      severity: lowBalanceTotal > 0 ? "critical" : "clear",
      icon: "subscriptions",
      href: "/admin/vendor-subscriptions",
    },
    {
      id: "expired-vendors",
      label: "Expired packages",
      value: Number(stats.expired_vendors ?? 0),
      detail: "Vendors whose package validity has lapsed.",
      severity: Number(stats.expired_vendors ?? 0) > 0 ? "warning" : "clear",
      icon: "subscriptions",
      href: "/admin/vendor-subscriptions",
    },
    {
      id: "bad-lead-reports",
      label: "Bad lead reports",
      value: Number(stats.bad_lead_reports_pending ?? 0),
      detail: "Vendor-reported lead quality disputes awaiting review.",
      severity: Number(stats.bad_lead_reports_pending ?? 0) > 0 ? "warning" : "clear",
      icon: "reviews",
      href: "/admin/lead-distribution",
    },
  ];

  const kpis = [
    ["Total Leads", formatNumber(stats.total_leads), `${formatNumber(stats.leads_this_week)} this week`, "leads", "emerald"],
    ["Leads Today", formatNumber(stats.leads_today), `${formatNumber(stats.leads_this_month)} this month`, "leads", "indigo"],
    ["Hot Leads", formatNumber(hotLeads.length), "In latest loaded leads", "notifications", "amber"],
    ["Unassigned Leads", formatNumber(unassignedLeads.length), "In latest loaded leads", "distribution", "rose"],
    ["Active Vendors", formatNumber(stats.active_vendors), `${formatNumber(stats.pending_vendors)} pending`, "vendors", "emerald"],
    ["Paid Vendors", formatNumber(stats.paid_vendors), `${formatNumber(stats.expired_vendors)} expired`, "subscriptions", "indigo"],
    ["Revenue This Month", formatINR(stats.revenue_this_month), `${formatINR(stats.total_revenue)} lifetime`, "payments", "emerald"],
    ["Follow-ups Due", formatNumber(followUpsDue), "Sales queue", "crm", "amber"],
  ] as const;

  const leadFunnelRows = useMemo(() => groupBy(data.leads, (lead) => lead.status || "New"), [data.leads]);
  const revenueRows = useMemo(() => revenueByPackage(data.payments, data.packages), [data.payments, data.packages]);
  const recentActivity = useMemo(() => buildRecentActivity(data), [data]);
  const priorityLeads = [...hotLeads, ...unassignedLeads.filter((lead) => !hotLeads.includes(lead))].slice(0, 5);
  const vendorHealthRows = (lowBalanceVendors.length ? lowBalanceVendors : data.vendors).slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Compact command strip.
          This used to be a full-height white hero card that repeated the page
          title AdminShell already prints. It is now a single ~64px row: live
          context on the left, the three real destinations on the right. */}
      <div className="flex flex-col gap-2.5 border-b border-[color:var(--qfa-line)] pb-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StatusBadge value="Superadmin" tone="slate" />
          <StatusBadge value={`${formatNumber(totalLeads)} leads`} tone="emerald" />
          <StatusBadge value={`Updated ${formatDate(data.generatedAt)}`} tone="blue" />
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

      {data.warnings?.length ? (
        <SectionCard title="Supabase fallback notices">
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-600">
            {data.warnings.slice(0, 4).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4" aria-label="Marketplace key figures">
        {kpis.map(([label, value, helper, icon, tone]) => (
          <StatCard key={label} label={label} value={value} helper={helper} icon={icon} tone={tone} />
        ))}
      </section>

      {meta ? (
        <p className="text-[11px] text-slate-500">
          Showing the latest {formatNumber(meta.rowsLoaded?.leads ?? data.leads.length)} of {formatNumber(totalLeads)} leads
          and latest {formatNumber(meta.rowsLoaded?.vendors ?? data.vendors.length)} of {formatNumber(meta.totals?.total_vendors ?? data.vendors.length)} vendors.
          KPI totals are counted live and stay accurate.
        </p>
      ) : null}

      <AttentionCenter items={attentionItems} />

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard
          title="Today's priority"
          description="The shortest path to keeping the marketplace moving today."
          action={
            <Link href="/admin/leads" className="qfa-focus rounded text-[13px] font-semibold text-emerald-700 hover:underline">
              Open leads
            </Link>
          }
        >
          <div className="grid gap-2">
            {priorityLeads.length ? (
              priorityLeads.map((lead) => (
                <Quiet key={lead.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-[13px] font-semibold text-slate-950">{lead.name || "Unnamed lead"}</p>
                      <StatusBadge value={lead.lead_priority || (isHotLead(lead) ? "Hot" : "Unassigned")} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {lead.service_required || lead.category || "Requirement not set"} · {lead.city || "City not set"} · {maskPhone(lead.phone)}
                    </p>
                  </div>
                  <SecondaryButton size="sm" onClick={() => setSelectedLead(lead)}>View</SecondaryButton>
                </Quiet>
              ))
            ) : (
              <Quiet className="p-3 text-[13px] text-slate-500">
                No urgent leads in this snapshot. New public enquiries will appear here automatically.
              </Quiet>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Quick operations" description="Jump straight into an existing admin workspace.">
          <div className="grid gap-1.5 sm:grid-cols-2">
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

      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Lead funnel" description="Live lead statuses across the leads loaded in this snapshot.">
          <FunnelRows rows={leadFunnelRows} total={data.leads.length} />
        </SectionCard>

        <SectionCard title="Vendor credit balance" description="Lead credits remaining against the credits purchased.">
          {/* This panel used to show a "health score" percentage synthesised
              from credits, rating, status and visibility with invented weights.
              No such score exists in the product, so it has been replaced with
              the underlying facts: real credit balance, real status, real
              rating. Nothing here is computed from a made-up formula. */}
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
                    className="qfa-focus w-full rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line-soft)] bg-white p-3 text-left transition-colors hover:border-[color:var(--qfa-line-strong)] hover:bg-[color:var(--qfa-inset)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-slate-950">{vendor.business_name || "Unnamed vendor"}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">
                          {vendor.city || "City not set"} · {vendor.status || "Status not set"}
                        </p>
                      </div>
                      <span className="shrink-0 text-right">
                        <span className="block text-[13px] font-semibold tabular-nums text-slate-900">
                          {formatNumber(remaining)}
                          {total > 0 ? <span className="text-slate-400">/{formatNumber(total)}</span> : null}
                        </span>
                        <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">credits</span>
                      </span>
                    </div>
                    {total > 0 ? (
                      <div className="mt-2">
                        <ProgressBar value={pct} tone={low ? "rose" : pct >= 40 ? "emerald" : "amber"} />
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] text-slate-400">No package credits recorded.</p>
                    )}
                    {low ? (
                      <p className="mt-1.5 text-[11px] font-semibold text-rose-700">Low balance — at or under 3 credits.</p>
                    ) : null}
                  </button>
                );
              })
            ) : (
              <p className="text-[13px] text-slate-500">Vendor credit balances will appear after vendor onboarding starts.</p>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Revenue snapshot" description="Paid collections by package, using current payment data.">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <MetricPill label="Month" value={formatINR(stats.revenue_this_month)} />
            <MetricPill label="Lifetime" value={formatINR(stats.total_revenue)} />
          </div>
          <FunnelRows rows={revenueRows} total={Number(stats.total_revenue ?? 0)} money />
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <ChartCard title="Lead sources" rows={groupBy(data.leads, (lead) => lead.source || "Website")} />

        <SectionCard title="Recent activity" description="Latest lead, vendor, and payment events.">
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
      </section>

      {selectedLead ? <LeadDrawer lead={selectedLead} vendors={data.vendors} onClose={() => setSelectedLead(null)} /> : null}
      {selectedVendor ? <VendorDrawer vendor={selectedVendor} onClose={() => setSelectedVendor(null)} /> : null}
    </div>
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

function isHotLead(lead: Lead) {
  const priority = String(lead.lead_priority ?? "").toLowerCase();
  const status = String(lead.status ?? "").toLowerCase();
  const score = Number(lead.lead_quality_score ?? 0);
  return priority.includes("hot") || priority.includes("high") || score >= 70 || status.includes("interested") || status.includes("quotation");
}

function isUnassignedLead(lead: Lead) {
  const status = String(lead.status ?? "New").toLowerCase();
  return !closedLeadStatuses.has(status) && (lead.lead_assignments?.length ?? 0) === 0;
}

function buildRecentActivity(data: Snapshot) {
  return [
    ...data.leads.slice(0, 5).map((lead) => ({
      id: lead.id,
      type: "Lead",
      tone: "blue" as const,
      title: lead.name || "New lead",
      detail: `${lead.service_required || lead.category || "Requirement"} - ${lead.city || "City not set"}`,
      date: lead.created_at,
    })),
    ...data.vendors.slice(0, 4).map((vendor) => ({
      id: vendor.id,
      type: "Vendor",
      tone: "emerald" as const,
      title: vendor.business_name || "Vendor registration",
      detail: `${vendor.city || "City not set"} - ${vendor.status || "Pending"}`,
      date: vendor.created_at,
    })),
    ...data.payments.slice(0, 4).map((payment) => ({
      id: payment.id,
      type: "Payment",
      tone: "amber" as const,
      title: formatINR(payment.amount),
      detail: `${vendorName(data.vendors, payment.vendor_id)} - ${packageName(data.packages, payment.package_id)}`,
      date: payment.created_at,
    })),
  ]
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, 8);
}
