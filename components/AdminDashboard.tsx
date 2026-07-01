"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ActionMenu,
  ChartCard,
  Drawer,
  InfoGrid,
  PageHeader,
  ProgressBar,
  SectionCard,
  SecondaryButton,
  StatCard,
  StatusBadge,
} from "@/components/admin/AdminPrimitives";
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

export function AdminDashboard({ snapshot, error }: { snapshot: Snapshot | null; error?: string | null }) {
  const data = snapshot ?? emptySnapshot();
  const stats = data.stats ?? {};
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);

  const hotLeads = data.leads.filter(isHotLead);
  const unassignedLeads = data.leads.filter(isUnassignedLead);
  const followUpsDue = Number(stats.pending_followups ?? data.leads.filter((lead) => ["New", "Verified", "Assigned", "Contacted"].includes(lead.status || "")).length);
  const lowBalanceVendors = data.vendors.filter((vendor) => Number(vendor.remaining_credits ?? 0) <= 3);
  const pendingActions = [
    { label: "Unassigned leads", value: unassignedLeads.length, href: "/admin/leads", tone: "amber" as const },
    { label: "Pending vendor approvals", value: Number(stats.pending_vendors ?? 0), href: "/admin/vendors", tone: "blue" as const },
    { label: "Pending payments", value: Number(stats.pending_payments ?? 0), href: "/admin/payments", tone: "amber" as const },
    { label: "Low balance vendors", value: lowBalanceVendors.length, href: "/admin/vendor-subscriptions", tone: "rose" as const },
  ];

  const kpis = [
    ["Total Leads", formatNumber(stats.total_leads), `${formatNumber(stats.leads_this_week)} this week`, "leads", "emerald"],
    ["Leads Today", formatNumber(stats.leads_today), `${formatNumber(stats.leads_this_month)} this month`, "leads", "indigo"],
    ["Hot Leads", formatNumber(hotLeads.length), "High intent or priority", "notifications", "amber"],
    ["Unassigned Leads", formatNumber(unassignedLeads.length), "Needs vendor matching", "distribution", "rose"],
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
    <div className="space-y-5">
      <PageHeader
        title="Marketplace Command Center"
        description="Monitor leads, vendor capacity, collections, and urgent marketplace operations from one calm superadmin workspace."
        meta={
          <>
            <StatusBadge value="Superadmin" tone="slate" />
            <StatusBadge value={`${formatNumber(data.leads.length)} leads indexed`} tone="emerald" />
            <StatusBadge value={`Updated ${formatDate(data.generatedAt)}`} tone="blue" />
          </>
        }
        actions={
          <>
            <LinkButton href="/admin/leads">Review Leads</LinkButton>
            <LinkButton href="/admin/vendors">Vendor Queue</LinkButton>
            <LinkButton href="/admin/payments">Revenue</LinkButton>
          </>
        }
      />

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          Admin data loaded with fallback UI because Supabase returned: {error}
        </div>
      ) : null}

      {data.warnings?.length ? (
        <SectionCard title="Supabase Fallback Notices">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            {data.warnings.slice(0, 4).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(([label, value, helper, icon, tone]) => (
          <StatCard key={label} label={label} value={value} helper={helper} icon={icon} tone={tone} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard
          title="Today's Priority"
          description="The shortest path to keeping the marketplace moving today."
          action={<Link href="/admin/leads" className="text-sm font-semibold text-emerald-700">Open leads</Link>}
        >
          <div className="grid gap-3">
            {priorityLeads.length ? (
              priorityLeads.map((lead) => (
                <div key={lead.id} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-emerald-200 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{lead.name || "Unnamed lead"}</p>
                      <StatusBadge value={lead.lead_priority || (isHotLead(lead) ? "Hot" : "Unassigned")} />
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {lead.service_required || lead.category || "Requirement not set"} in {lead.city || "city not set"} - {maskPhone(lead.phone)}
                    </p>
                  </div>
                  <SecondaryButton onClick={() => setSelectedLead(lead)}>View</SecondaryButton>
                </div>
              ))
            ) : (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No urgent leads in this snapshot. New public enquiries will appear here automatically.
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Pending Actions" description="Operations queues that need a human decision.">
          <div className="space-y-3">
            {pendingActions.map((item) => (
              <Link key={item.label} href={item.href} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3.5 transition hover:border-emerald-200 hover:bg-emerald-50/30">
                <span className="text-sm font-semibold text-slate-700">{item.label}</span>
                <StatusBadge value={formatNumber(item.value)} tone={item.tone} />
              </Link>
            ))}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <SectionCard title="Lead Funnel" description="Placeholder-ready funnel view backed by live lead statuses." className="xl:col-span-1">
          <FunnelRows rows={leadFunnelRows} total={data.leads.length} />
        </SectionCard>

        <SectionCard title="Vendor Health" description="Capacity and response risk at a glance." className="xl:col-span-1">
          <div className="space-y-4">
            {vendorHealthRows.length ? (
              vendorHealthRows.map((vendor) => {
                const score = vendorHealthScore(vendor);
                return (
                  <button
                    key={vendor.id}
                    type="button"
                    onClick={() => setSelectedVendor(vendor)}
                    className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/30"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">{vendor.business_name || "Unnamed vendor"}</p>
                        <p className="mt-1 text-xs text-slate-500">{vendor.city || "City not set"} - {formatNumber(vendor.remaining_credits)} credits</p>
                      </div>
                      <StatusBadge value={`${score}%`} tone={score >= 75 ? "emerald" : score >= 45 ? "amber" : "rose"} />
                    </div>
                    <div className="mt-3">
                      <ProgressBar value={score} tone={score >= 75 ? "emerald" : score >= 45 ? "amber" : "rose"} />
                    </div>
                  </button>
                );
              })
            ) : (
              <p className="text-sm text-slate-500">Vendor health will appear after vendor onboarding starts.</p>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Revenue Snapshot" description="Paid collections by package, using current payment data.">
          <div className="mb-5 grid grid-cols-2 gap-3">
            <MetricPill label="Month" value={formatINR(stats.revenue_this_month)} />
            <MetricPill label="Lifetime" value={formatINR(stats.total_revenue)} />
          </div>
          <FunnelRows rows={revenueRows} total={Number(stats.total_revenue ?? 0)} money />
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <ChartCard title="Lead Sources" rows={groupBy(data.leads, (lead) => lead.source || "Website")} />

        <SectionCard title="Recent Activity" description="Latest lead, vendor, and payment events.">
          <div className="space-y-3">
            {recentActivity.length ? (
              recentActivity.map((item) => (
                <div key={`${item.type}-${item.id}`} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge value={item.type} tone={item.tone} />
                      <p className="truncate text-sm font-semibold text-slate-950">{item.title}</p>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-slate-400">{formatDate(item.date)}</span>
                </div>
              ))
            ) : (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                Recent marketplace activity will appear here.
              </p>
            )}
          </div>
        </SectionCard>
      </section>

      {selectedLead ? <LeadDrawer lead={selectedLead} vendors={data.vendors} onClose={() => setSelectedLead(null)} /> : null}
      {selectedVendor ? <VendorDrawer vendor={selectedVendor} onClose={() => setSelectedVendor(null)} /> : null}
    </div>
  );
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm shadow-emerald-900/15 transition hover:-translate-y-0.5 hover:bg-emerald-700">
      {children}
    </Link>
  );
}

function MetricPill({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 truncate text-base font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function FunnelRows({ rows, total, money = false }: { rows: Array<{ label: string; value: number }>; total: number; money?: boolean }) {
  const normalizedTotal = Math.max(1, total);
  const visibleRows = rows.length ? rows.slice(0, 6) : [{ label: "Prepared", value: 0 }];

  return (
    <div className="space-y-4">
      {visibleRows.map((row) => {
        const percent = total ? Math.round((row.value / normalizedTotal) * 100) : 0;
        return (
          <div key={row.label} className="space-y-1.5">
            <div className="flex items-center justify-between gap-4 text-xs font-medium">
              <span className="truncate text-slate-600">{row.label}</span>
              <span className="text-slate-900">{money ? formatINR(row.value) : `${formatNumber(row.value)} (${percent}%)`}</span>
            </div>
            <ProgressBar value={Math.max(row.value ? 8 : 4, percent)} />
          </div>
        );
      })}
    </div>
  );
}

function LeadDrawer({ lead, vendors, onClose }: { lead: Lead; vendors: Vendor[]; onClose: () => void }) {
  return (
    <Drawer title={lead.name || "Lead details"} subtitle={`Lead ID ${shortId(lead.id)}`} onClose={onClose}>
      <div className="space-y-5">
        <InfoGrid
          rows={[
            ["Phone", lead.phone || "Not provided"],
            ["Email", lead.email || "Not provided"],
            ["City", lead.city || "Not provided"],
            ["Locality", lead.locality || lead.area || "Not provided"],
            ["Category", lead.service_required || lead.category || "Not provided"],
            ["Budget", lead.budget || "Not provided"],
            ["Timeline", lead.timeline || "Not provided"],
            ["Source", lead.source || "Website"],
          ]}
        />
        <SectionCard title="Requirement">
          <p className="text-sm leading-6 text-slate-600">{lead.message || "No detailed requirement message was provided."}</p>
        </SectionCard>
        <SectionCard title="Assigned Vendors">
          <div className="space-y-2">
            {lead.lead_assignments?.length ? (
              lead.lead_assignments.map((assignment) => (
                <div key={assignment.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-700">{vendorName(vendors, assignment.vendor_id)}</span>
                  <StatusBadge value={assignmentStatus(assignment)} />
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No vendor assignment recorded yet.</p>
            )}
          </div>
        </SectionCard>
      </div>
    </Drawer>
  );
}

function VendorDrawer({ vendor, onClose }: { vendor: Vendor; onClose: () => void }) {
  return (
    <Drawer title={vendor.business_name || "Vendor details"} subtitle={`Vendor ID ${shortId(vendor.id)}`} onClose={onClose}>
      <div className="space-y-5">
        <InfoGrid
          rows={[
            ["Owner", vendor.owner_name || "Not provided"],
            ["Phone", vendor.phone || "Not provided"],
            ["Email", vendor.email || "Not provided"],
            ["City", vendor.city || "Not provided"],
            ["Categories", vendor.service_categories?.join(", ") || "Not provided"],
            ["Areas", vendor.areas_covered?.join(", ") || "Not provided"],
            ["Remaining Leads", formatNumber(vendor.remaining_credits)],
            ["Rating", vendor.rating ? `${vendor.rating}/5` : "Not rated"],
          ]}
        />
        <SectionCard title="Vendor Status" description="Operational status and public visibility.">
          <div className="flex items-center justify-between gap-3">
            <StatusBadge value={vendor.status || "Pending"} />
            <ActionMenu actions={[{ label: "Assign package", onClick: () => {} }, { label: "Pause vendor", onClick: () => {} }, { label: "Add internal note", onClick: () => {} }]} />
          </div>
        </SectionCard>
      </div>
    </Drawer>
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

function vendorHealthScore(vendor: Vendor) {
  const credits = Math.min(40, Number(vendor.remaining_credits ?? 0) * 8);
  const rating = Math.min(25, Number(vendor.rating ?? 0) * 5);
  const active = vendor.is_active !== false && ["approved", "active"].includes(String(vendor.status ?? "").toLowerCase()) ? 25 : 8;
  const visibility = vendor.public_visibility === false ? 0 : 10;
  return Math.max(8, Math.min(98, Math.round(credits + rating + active + visibility)));
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
