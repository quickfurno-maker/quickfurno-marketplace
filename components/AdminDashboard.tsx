"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ActionMenu,
  ChartCard,
  DataTable,
  Drawer,
  EmptyState,
  InfoGrid,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatCard,
  StatusBadge,
  Toast,
} from "@/components/admin/AdminPrimitives";
import { emptySnapshot, type Lead, type Snapshot, type Vendor } from "@/components/admin/adminTypes";
import {
  assignmentStatus,
  formatDate,
  formatINR,
  formatNumber,
  groupBy,
  groupLeadsByDate,
  packageName,
  revenueByPackage,
  shortId,
  vendorName,
} from "@/components/admin/adminUtils";

export function AdminDashboard({ snapshot, error }: { snapshot: Snapshot | null; error?: string | null }) {
  const data = snapshot ?? emptySnapshot();
  const stats = data.stats ?? {};
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const recentLeads = data.leads.slice(0, 8);
  const recentVendors = data.vendors.slice(0, 8);
  const failedAssignments = data.assignments.filter((item) => String(item.vendor_status ?? "").toLowerCase().includes("failed")).slice(0, 6);
  const packageAlerts = data.vendorPackages
    .filter((item) => String(item.status ?? "").toLowerCase().includes("expired") || Number(item.remaining_leads ?? item.leads_remaining ?? item.remaining_credits ?? 0) <= 3)
    .slice(0, 6);

  const cards = [
    ["Total Leads", formatNumber(stats.total_leads), `${formatNumber(stats.leads_today)} today`, "leads", "emerald"],
    ["Leads Today", formatNumber(stats.leads_today), `${formatNumber(stats.leads_this_week)} this week`, "leads", "indigo"],
    ["Active Vendors", formatNumber(stats.active_vendors), `${formatNumber(stats.pending_vendors)} pending`, "vendors", "emerald"],
    ["Paid Vendors", formatNumber(stats.paid_vendors), `${formatNumber(stats.expired_vendors)} expired`, "subscriptions", "indigo"],
    ["Revenue This Month", formatINR(stats.revenue_this_month), `${formatINR(stats.total_revenue)} lifetime`, "payments", "emerald"],
    ["Pending Payments", formatNumber(stats.pending_payments), "Collections queue", "payments", "amber"],
    ["Expired Packages", formatNumber(stats.expired_vendors), "Needs renewal follow-up", "packages", "rose"],
    ["Active Cities", formatNumber(stats.active_cities), `Top: ${stats.top_city || "Not enough data"}`, "cities", "slate"],
    ["Low Balance Vendors", formatNumber(stats.low_balance_vendors), "Renewal opportunity", "subscriptions", "amber"],
    ["Pending Follow-ups", formatNumber(stats.pending_followups), "Sales queue", "notifications", "amber"],
    ["Conversion Rate", `${formatNumber(stats.conversion_rate)}%`, "Converted / total", "reports", "emerald"],
    ["Assignment Success", `${formatNumber(stats.lead_distribution_success_rate)}%`, `${formatNumber(stats.leads_distributed)} assignments`, "distribution", "indigo"],
  ] as const;

  const charts = useMemo(
    () => [
      { title: "Leads by Date", rows: groupLeadsByDate(data.leads) },
      { title: "Leads by Category", rows: groupBy(data.leads, (lead) => lead.service_required || lead.category) },
      { title: "Revenue by Package", rows: revenueByPackage(data.payments, data.packages) },
      { title: "Lead Status Funnel", rows: groupBy(data.leads, (lead) => lead.status || "New") },
    ],
    [data]
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Marketplace Command Center"
        description="Manage leads, vendors, packages, cities, payments, and automation from one place."
        actions={
          <>
            <LinkButton href="/admin/leads">Add Lead</LinkButton>
            <LinkButton href="/admin/vendors">Add Vendor</LinkButton>
            <LinkButton href="/admin/packages">Add Package</LinkButton>
            <LinkButton href="/admin/cities">Add City</LinkButton>
          </>
        }
      />

      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          Admin data loaded with fallback UI because Supabase returned: {error}
        </div>
      ) : null}

      {data.warnings?.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-sm">
          <p className="font-semibold text-slate-950">Supabase fallback notices</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {data.warnings.slice(0, 4).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, helper, icon, tone]) => (
          <StatCard key={label} label={label} value={value} helper={helper} icon={icon} tone={tone} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        {charts.map((chart) => (
          <ChartCard key={chart.title} title={chart.title} rows={chart.rows} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="Recent Leads" action={<Link href="/admin/leads" className="text-sm font-semibold text-emerald-700">View all</Link>}>
          <DataTable
            rows={recentLeads}
            emptyTitle="No leads yet"
            emptyMessage="Client enquiries will appear here as soon as the public form receives submissions."
            columns={[
              { header: "Client", cell: (lead) => <PersonCell title={lead.name || "Unnamed lead"} subtitle={lead.phone || "No phone"} /> },
              { header: "City", cell: (lead) => lead.city || "Not set" },
              { header: "Category", cell: (lead) => lead.service_required || lead.category || "Not set" },
              { header: "Status", cell: (lead) => <StatusBadge value={lead.status || "New"} /> },
              { header: "Actions", cell: (lead) => <SecondaryButton onClick={() => setSelectedLead(lead)}>View</SecondaryButton> },
            ]}
          />
        </Panel>

        <Panel title="Recent Vendors" action={<Link href="/admin/vendors" className="text-sm font-semibold text-emerald-700">View all</Link>}>
          <DataTable
            rows={recentVendors}
            emptyTitle="No vendors yet"
            emptyMessage="Vendor registrations and approved studios will appear here."
            columns={[
              { header: "Vendor", cell: (vendor) => <PersonCell title={vendor.business_name || "Unnamed vendor"} subtitle={vendor.phone || "No phone"} /> },
              { header: "City", cell: (vendor) => vendor.city || "Not set" },
              { header: "Credits", cell: (vendor) => formatNumber(vendor.remaining_credits) },
              { header: "Status", cell: (vendor) => <StatusBadge value={vendor.status || "Pending"} /> },
              { header: "Actions", cell: (vendor) => <SecondaryButton onClick={() => setSelectedVendor(vendor)}>View</SecondaryButton> },
            ]}
          />
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="Package Expiry Alerts">
          <DataTable
            rows={packageAlerts}
            emptyTitle="No expiry alerts"
            emptyMessage="Low-balance and expired vendor packages will appear here."
            columns={[
              { header: "Vendor", cell: (row: any) => vendorName(data.vendors, row.vendor_id) },
              { header: "Package", cell: (row: any) => packageName(data.packages, row.package_id) },
              { header: "Remaining", cell: (row: any) => formatNumber(row.remaining_leads ?? row.leads_remaining ?? row.remaining_credits ?? 0) },
              { header: "Status", cell: (row: any) => <StatusBadge value={row.status || row.payment_status || "Needs review"} /> },
            ]}
          />
        </Panel>

        <Panel title="Failed Lead Assignments">
          <DataTable
            rows={failedAssignments}
            emptyTitle="No failed assignments"
            emptyMessage="Failed distribution attempts will be shown here for operations review."
            columns={[
              { header: "Lead", cell: (row) => shortId(row.lead_id) },
              { header: "Vendor", cell: (row) => vendorName(data.vendors, row.vendor_id) },
              { header: "Status", cell: (row) => <StatusBadge value={assignmentStatus(row)} /> },
              { header: "Time", cell: (row) => formatDate(row.assigned_at || row.created_at) },
            ]}
          />
        </Panel>
      </section>

      {selectedLead ? <LeadDrawer lead={selectedLead} vendors={data.vendors} onClose={() => setSelectedLead(null)} /> : null}
      {selectedVendor ? <VendorDrawer vendor={selectedVendor} onClose={() => setSelectedVendor(null)} /> : null}
      {toast ? <Toast message={toast} tone="info" /> : null}

      <div className="hidden">
        <PrimaryButton onClick={() => setToast("Action placeholder ready for implementation.")}>Hidden action</PrimaryButton>
      </div>
    </div>
  );
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm shadow-emerald-900/10 transition hover:bg-emerald-700">
      {children}
    </Link>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-lg font-semibold tracking-tight text-slate-950">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function PersonCell({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="min-w-44">
      <p className="font-semibold text-slate-950">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
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
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-950">Requirement</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{lead.message || "No detailed requirement message was provided."}</p>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-950">Assigned Vendors</h3>
          <div className="mt-3 space-y-2">
            {lead.lead_assignments?.length ? (
              lead.lead_assignments.map((assignment) => (
                <div key={assignment.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-700">{vendorName(vendors, assignment.vendor_id)}</span>
                  <StatusBadge value={assignmentStatus(assignment)} />
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No vendor assignment recorded yet.</p>
            )}
          </div>
        </section>
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
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Vendor Status</h3>
              <p className="mt-1 text-sm text-slate-500">Operational status and public visibility.</p>
            </div>
            <StatusBadge value={vendor.status || "Pending"} />
          </div>
          <div className="mt-4">
            <ActionMenu actions={[{ label: "Assign package", onClick: () => {} }, { label: "Pause vendor", onClick: () => {} }, { label: "Add internal note", onClick: () => {} }]} />
          </div>
        </section>
      </div>
    </Drawer>
  );
}
