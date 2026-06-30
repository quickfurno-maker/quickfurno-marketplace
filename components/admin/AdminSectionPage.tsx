"use client";

import { type ReactNode, useMemo, useState, useTransition } from "react";
import {
  adminApproveVendor,
  adminRejectVendor,
  adminSetCategoryActive,
  adminSetCityActive,
  adminSetPackageActive,
  adminSuspendVendor,
  adminUpdateLeadStatus,
} from "@/app/actions";
import {
  ActionMenu,
  ChartCard,
  ConfirmDialog,
  DataTable,
  Drawer,
  EmptyState,
  InfoGrid,
  PageHeader,
  PrimaryButton,
  ProgressBar,
  SecondaryButton,
  SelectFilter,
  SectionCard,
  StatCard,
  StatusBadge,
  Tabs,
  Toast,
  ToggleSwitch,
  Toolbar,
} from "./AdminPrimitives";
import { getAdminSectionByKey, type AdminSectionKey } from "./adminConfig";
import { emptySnapshot, type Category, type City, type Lead, type PackageRow, type Snapshot, type Vendor } from "./adminTypes";
import {
  assignmentStatus,
  formatDate,
  formatINR,
  formatNumber,
  groupBy,
  includesQuery,
  leadName,
  maskPhone,
  packageName,
  shortId,
  uniqueOptions,
  vendorName,
} from "./adminUtils";
import { AOSControlCenter } from "./AOSControlCenter";
import { CRMDashboard } from "./CRMDashboard";
import { AnalyticsDashboard } from "./AnalyticsDashboard";
import { AosAutomationControl } from "./AosAutomationControl";

const leadStatuses = ["All", "New", "Assigned", "Contacted", "Interested", "Site Visit Scheduled", "Quotation Sent", "Converted", "Lost", "Duplicate", "Spam", "Invalid"];
const closedLeadStatuses = new Set(["converted", "won", "lost", "duplicate", "spam", "invalid"]);
const packageTemplates = [
  { name: "Starter Package", price: "INR 1,250", leads: "5 leads", validity: "30 days", features: ["Basic delivery", "City/category match", "Standard support"] },
  { name: "Growth Package", price: "INR 3,500", leads: "15 leads", validity: "45 days", features: ["Priority delivery", "Daily lead controls", "Renewal alerts"] },
  { name: "Premium Package", price: "Custom", leads: "50 leads", validity: "90 days", features: ["Featured listing", "Priority delivery", "Performance review"] },
  { name: "Enterprise Package", price: "Custom", leads: "Custom", validity: "Custom", features: ["Dedicated support", "Featured placement", "Custom lead caps"] },
];
const aiAgents = [
  ["Lead Quality Agent", "Analyze lead quality, budget strength, urgency and duplicate suspicion."],
  ["Vendor Matching Agent", "Suggest best vendors by city, category, rating, balance and response speed."],
  ["Follow-up Agent", "Detect leads that need follow-up today."],
  ["Vendor Renewal Agent", "Spot low-balance and expiring vendors."],
  ["Category Growth Agent", "Suggest categories that need more vendors."],
  ["City Expansion Agent", "Find city and locality demand signals."],
  ["Website UX Agent", "Suggest funnel and experience improvements."],
  ["Content Agent", "Draft homepage, FAQ, category and ad copy ideas."],
  ["Fraud/Duplicate Lead Agent", "Find repeated phones, spam entries and invalid leads."],
];
const automationRows = [
  ["New Lead Notification", "New lead created", "Send admin notification", "Draft"],
  ["Vendor Lead Assignment", "Lead assigned", "Send vendor notification", "Draft"],
  ["Package Expiry Reminder", "Vendor package expiring", "Send reminder", "Draft"],
  ["Low Balance Reminder", "Vendor lead balance low", "Send renewal alert", "Draft"],
  ["Daily Lead Report", "Daily schedule", "Email report placeholder", "Draft"],
  ["Weekly Revenue Report", "Weekly schedule", "Email finance report", "Draft"],
  ["n8n Webhook", "CRM webhook placeholder", "Send webhook", "Disabled"],
  ["WhatsApp Notification", "Lead assigned", "WhatsApp placeholder", "Disabled"],
];

export function AdminSectionPage({ section, snapshot, error }: { section: AdminSectionKey; snapshot: Snapshot | null; error?: string | null }) {
  const data = snapshot ?? emptySnapshot();
  const config = getAdminSectionByKey(section);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<{ ok: boolean; error?: string }> } | null>(null);
  const [isPending, startTransition] = useTransition();

  function notify(message: string, tone: "success" | "error" | "info" = "info") {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 2800);
  }

  function runAction(title: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        notify(result.error ?? `${title} failed.`, "error");
        return;
      }
      notify(`${title} completed.`, "success");
    });
  }

  function ask(title: string, message: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    setConfirm({ title, message, action });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={config.label}
        description={config.description}
        actions={
          <>
            <SecondaryButton onClick={() => notify("Filter drawer placeholder is ready.")}>Filter</SecondaryButton>
            <PrimaryButton onClick={() => notify(`${config.addLabel} flow is ready for backend wiring.`)}>{config.addLabel}</PrimaryButton>
          </>
        }
      />

      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          This page is showing safe fallback UI because Supabase returned: {error}
        </div>
      ) : null}

      {renderSection(section, data, { notify, ask, runAction, isPending, error: error ?? null })}

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const action = confirm.action;
            const title = confirm.title;
            setConfirm(null);
            runAction(title, action);
          }}
        />
      ) : null}
    </div>
  );
}

function renderSection(
  section: AdminSectionKey,
  data: Snapshot,
  helpers: {
    notify: (message: string, tone?: "success" | "error" | "info") => void;
    ask: (title: string, message: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
    runAction: (title: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
    isPending: boolean;
    error: string | null;
  }
) {
  switch (section) {
    case "leads":
      return <LeadsPage data={data} {...helpers} />;
    case "vendors":
      return <VendorsPage data={data} {...helpers} />;
    case "packages":
      return <PackagesPage data={data} {...helpers} />;
    case "categories":
      return <CategoriesPage data={data} {...helpers} />;
    case "cities":
      return <CitiesPage data={data} {...helpers} />;
    case "payments":
      return <PaymentsPage data={data} {...helpers} />;
    case "lead-distribution":
      return <LeadDistributionPage data={data} {...helpers} />;
    case "vendor-subscriptions":
      return <SubscriptionsPage data={data} {...helpers} />;
    case "reports":
      return <ReportsPage data={data} />;
    case "aos":
      return <AOSControlCenter notify={helpers.notify} data={data} />;
    case "crm":
      return <CRMDashboard data={data} notify={helpers.notify} error={helpers.error} />;
    case "analytics":
      return <AnalyticsDashboard data={data} />;
    case "ai-agents":
      return <AIAgentsPage />;
    case "automations":
      return <AutomationsPage notify={helpers.notify} />;
    case "website-content":
      return <WebsiteContentPage notify={helpers.notify} />;
    case "reviews":
      return <ReviewsPage />;
    case "notifications":
      return <NotificationsPage data={data} notify={helpers.notify} />;
    case "users":
      return <AdminUsersPage data={data} />;
    case "settings":
      return <SettingsPage notify={helpers.notify} />;
    case "audit-logs":
      return <AuditLogsPage data={data} />;
    default:
      return <EmptyState title="Page not available" message="This admin page is not configured yet." />;
  }
}

function LeadsPage({ data, notify, runAction }: { data: Snapshot; notify: (message: string, tone?: "success" | "error" | "info") => void; runAction: any }) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("All");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");
  const [source, setSource] = useState("All");
  const [priority, setPriority] = useState("All");
  const [selected, setSelected] = useState<Lead | null>(null);

  const hotLeads = data.leads.filter(isHotLead);
  const unassignedLeads = data.leads.filter(isUnassignedLead);
  const leads = useMemo(() => data.leads.filter((lead) => {
    const leadCategory = lead.service_required || lead.category || "";
    const leadSource = lead.source || "Website";
    const leadPriorityValue = leadPriorityLabel(lead);
    return includesQuery([lead.name, lead.phone, lead.city, leadCategory, lead.status, leadSource, leadPriorityValue], query)
      && (city === "All" || lead.city === city)
      && (category === "All" || leadCategory === category)
      && (status === "All" || lead.status === status)
      && (source === "All" || leadSource === source)
      && (priority === "All" || leadPriorityValue === priority);
  }), [data.leads, query, city, category, status, source, priority]);

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="All Leads" value={formatNumber(data.leads.length)} helper="Complete lead database" icon="leads" />
        <StatCard label="Hot Leads" value={formatNumber(hotLeads.length)} helper="High intent or scored" icon="notifications" tone="amber" />
        <StatCard label="Unassigned" value={formatNumber(unassignedLeads.length)} helper="Needs vendor matching" icon="distribution" tone="rose" />
        <StatCard label="Filtered View" value={formatNumber(leads.length)} helper="Rows matching filters" icon="reports" tone="slate" />
      </section>

      <Toolbar
        query={query}
        setQuery={setQuery}
        placeholder="Search name, masked phone, city, category, source..."
        filters={
          <>
            <SelectFilter label="City" value={city} onChange={setCity} options={uniqueOptions(data.leads.map((lead) => lead.city))} />
            <SelectFilter label="Category" value={category} onChange={setCategory} options={uniqueOptions(data.leads.map((lead) => lead.service_required || lead.category))} />
            <SelectFilter label="Status" value={status} onChange={setStatus} options={leadStatuses} />
            <SelectFilter label="Priority" value={priority} onChange={setPriority} options={["All", "Hot", "High", "Normal", "Low"]} />
            <SelectFilter label="Source" value={source} onChange={setSource} options={uniqueOptions(data.leads.map((lead) => lead.source || "Website"))} />
          </>
        }
        action={<SecondaryButton onClick={() => notify("CSV export placeholder ready.")}>Export CSV</SecondaryButton>}
      />

      <DataTable
        rows={leads}
        emptyTitle="No leads match this view"
        emptyMessage="Try a different search or filter, or wait for new public form submissions."
        columns={[
          { header: "Client", cell: (lead) => <Strong title={lead.name || "Unnamed lead"} subtitle={maskPhone(lead.phone)} /> },
          { header: "Requirement", cell: (lead) => <Strong title={lead.service_required || lead.category || "Not set"} subtitle={lead.city || "City not set"} /> },
          { header: "Budget", cell: (lead) => lead.budget || "Not set" },
          { header: "Priority", cell: (lead) => <LeadPriorityBadge lead={lead} /> },
          { header: "Source", cell: (lead) => <SourceBadge value={lead.source || "Website"} /> },
          { header: "Status", cell: (lead) => <StatusBadge value={lead.status || "New"} /> },
          { header: "Assigned", cell: (lead) => <StatusBadge value={`${formatNumber(lead.lead_assignments?.length ?? 0)} vendors`} tone={(lead.lead_assignments?.length ?? 0) > 0 ? "emerald" : "amber"} /> },
          { header: "Created", cell: (lead) => formatDate(lead.created_at) },
          {
            header: "Actions",
            cell: (lead) => (
              <ActionMenu
                actions={[
                  { label: "View lead", onClick: () => setSelected(lead) },
                  { label: "Mark contacted", onClick: () => runAction("Lead status update", () => adminUpdateLeadStatus(lead.id, "Contacted")) },
                  { label: "Assign vendor", onClick: () => notify("Manual assign drawer placeholder ready.") },
                  { label: "Export lead", onClick: () => notify("Single lead export placeholder ready.") },
                ]}
              />
            ),
          },
        ]}
      />

      {selected ? <LeadDetailDrawer lead={selected} vendors={data.vendors} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function VendorsPage({ data, notify, ask }: { data: Snapshot; notify: (message: string, tone?: "success" | "error" | "info") => void; ask: any }) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("All");
  const [status, setStatus] = useState("All");
  const [packageStatus, setPackageStatus] = useState("All");
  const [selected, setSelected] = useState<Vendor | null>(null);

  const packageOptions = useMemo(() => uniqueOptions(data.vendors.map((vendor) => vendorPackageStatus(vendor, latestVendorPackage(vendor.id, data.vendorPackages))), "All"), [data.vendors, data.vendorPackages]);
  const vendors = useMemo(() => data.vendors.filter((vendor) => {
    const latestPackage = latestVendorPackage(vendor.id, data.vendorPackages);
    const currentPackageStatus = vendorPackageStatus(vendor, latestPackage);
    return includesQuery([vendor.business_name, vendor.owner_name, vendor.phone, vendor.city, vendor.status, vendor.service_categories?.join(" "), currentPackageStatus], query)
      && (city === "All" || vendor.city === city)
      && (status === "All" || vendor.status === status)
      && (packageStatus === "All" || currentPackageStatus === packageStatus);
  }), [data.vendors, data.vendorPackages, query, city, status, packageStatus]);

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Vendors" value={formatNumber(data.vendors.length)} helper="All vendor records" icon="vendors" />
        <StatCard label="Active Vendors" value={formatNumber(data.stats.active_vendors)} helper="Ready for leads" icon="vendors" tone="emerald" />
        <StatCard label="Paid Vendors" value={formatNumber(data.stats.paid_vendors)} helper="Package attached" icon="subscriptions" tone="indigo" />
        <StatCard label="Low Credits" value={formatNumber(data.stats.low_balance_vendors)} helper="Renewal risk" icon="notifications" tone="amber" />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {vendors.slice(0, 4).map((vendor) => (
          <button
            key={vendor.id}
            type="button"
            onClick={() => setSelected(vendor)}
            className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <Strong title={vendor.business_name || "Unnamed vendor"} subtitle={vendor.city || "City not set"} />
              <VendorHealthBadge vendor={vendor} />
            </div>
            <div className="mt-4">
              <CreditsMeter value={Number(vendor.remaining_credits ?? 0)} total={Number(vendor.total_credits ?? 0)} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusBadge value={vendor.status || "Pending"} />
              <StatusBadge value={vendorPackageStatus(vendor, latestVendorPackage(vendor.id, data.vendorPackages))} />
            </div>
          </button>
        ))}
      </section>

      <Toolbar
        query={query}
        setQuery={setQuery}
        placeholder="Search vendor, masked phone, city, category..."
        filters={
          <>
            <SelectFilter label="City" value={city} onChange={setCity} options={uniqueOptions(data.vendors.map((vendor) => vendor.city))} />
            <SelectFilter label="Status" value={status} onChange={setStatus} options={uniqueOptions(data.vendors.map((vendor) => vendor.status))} />
            <SelectFilter label="Package" value={packageStatus} onChange={setPackageStatus} options={packageOptions} />
          </>
        }
        action={<SecondaryButton onClick={() => notify("Vendor export placeholder ready.")}>Export Vendors</SecondaryButton>}
      />

      <DataTable
        rows={vendors}
        emptyTitle="No vendors match this view"
        emptyMessage="Try different filters or approve vendor registration requests."
        columns={[
          { header: "Vendor / Business", cell: (vendor) => <Strong title={vendor.business_name || "Unnamed vendor"} subtitle={`${vendor.owner_name || "No owner"} - ${maskPhone(vendor.phone)}`} /> },
          { header: "City", cell: (vendor) => vendor.city || "Not set" },
          { header: "Categories", cell: (vendor) => <span className="line-clamp-2 min-w-44">{vendor.service_categories?.join(", ") || "Not set"}</span> },
          { header: "Package", cell: (vendor) => <VendorPackageCell vendor={vendor} data={data} /> },
          { header: "Credits", cell: (vendor) => <CreditsMeter value={Number(vendor.remaining_credits ?? 0)} total={Number(vendor.total_credits ?? 0)} /> },
          { header: "Health", cell: (vendor) => <VendorHealthBadge vendor={vendor} /> },
          { header: "Status", cell: (vendor) => <StatusBadge value={vendor.status || "Pending"} /> },
          { header: "Rating", cell: (vendor) => vendor.rating ? `${vendor.rating}/5` : "Not rated" },
          {
            header: "Actions",
            cell: (vendor) => (
              <ActionMenu
                actions={[
                  { label: "View vendor", onClick: () => setSelected(vendor) },
                  { label: "Approve", onClick: () => ask("Approve vendor", "This will mark the vendor as approved.", () => adminApproveVendor(vendor.id)) },
                  { label: "Reject", onClick: () => ask("Reject vendor", "This will reject the vendor application.", () => adminRejectVendor(vendor.id)) },
                  { label: "Suspend", onClick: () => ask("Suspend vendor", "This will suspend vendor visibility and operations.", () => adminSuspendVendor(vendor.id)) },
                ]}
              />
            ),
          },
        ]}
      />

      {selected ? <VendorDetailDrawer vendor={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function PackagesPage({ data, notify, ask }: { data: Snapshot; notify: (message: string) => void; ask: any }) {
  const activePackages = data.packages.filter((item) => item.is_active !== false).length;
  const avgLeadPrice = data.packages.length
    ? Math.round(data.packages.reduce((sum, item) => sum + Number(item.price_per_lead ?? 0), 0) / data.packages.length)
    : 0;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Packages" value={formatNumber(data.packages.length || packageTemplates.length)} helper="Live rows or templates" icon="packages" />
        <StatCard label="Active" value={formatNumber(activePackages)} helper="Visible for sales" icon="subscriptions" tone="emerald" />
        <StatCard label="Avg Lead Price" value={avgLeadPrice ? formatINR(avgLeadPrice) : "Prepared"} helper="From package rows" icon="payments" tone="indigo" />
        <StatCard label="Revenue" value={formatINR(data.stats.total_revenue)} helper="Paid collections" icon="reports" tone="amber" />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.packages.length ? (
          data.packages.map((item) => (
            <PackageRowCard key={item.id} item={item} notify={notify} ask={ask} />
          ))
        ) : (
          packageTemplates.map((item) => (
            <PackageTemplateCard key={item.name} item={item} notify={notify} />
          ))
        )}
      </section>

      <DataTable
        rows={data.packages}
        emptyTitle="No packages in Supabase"
        emptyMessage="Package templates are shown above. Real package rows will appear here after creation."
        columns={[
          { header: "Package Name", cell: (item) => <Strong title={item.name || "Unnamed package"} subtitle={`ID ${shortId(item.id)}`} /> },
          { header: "Price", cell: (item) => formatINR(item.total_price || item.display_price) },
          { header: "Leads", cell: (item) => formatNumber(item.lead_count) },
          { header: "Per Lead", cell: (item) => item.price_per_lead ? formatINR(item.price_per_lead) : "Not set" },
          { header: "Validity", cell: (item) => `${formatNumber(item.validity_days)} days` },
          { header: "Status", cell: (item) => <StatusBadge value={item.is_active ? "Active" : "Inactive"} /> },
          {
            header: "Actions",
            cell: (item) => (
              <ActionMenu actions={[
                { label: "Edit", onClick: () => notify("Package edit placeholder ready.") },
                { label: item.is_active ? "Disable" : "Enable", onClick: () => ask("Update package", "This will change package visibility.", () => adminSetPackageActive(item.id, !item.is_active)) },
                { label: "Duplicate", onClick: () => notify("Duplicate package placeholder ready.") },
              ]} />
            ),
          },
        ]}
      />
    </div>
  );
}

function CategoriesPage({ data, notify, ask }: { data: Snapshot; notify: (message: string) => void; ask: any }) {
  const parentCategories = data.categories.filter((item) => !item.parent_id);
  const subcategories = data.categories.filter((item) => item.parent_id);
  const visibleParents = parentCategories.length ? parentCategories : data.categories.slice(0, 5);
  const tableRows = subcategories.length ? subcategories : data.categories;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Categories" value={formatNumber(data.categories.length)} helper="Service taxonomy" icon="categories" />
        <StatCard label="Parent Categories" value={formatNumber(parentCategories.length || visibleParents.length)} helper="Top-level services" icon="categories" tone="indigo" />
        <StatCard label="Subcategories" value={formatNumber(subcategories.length)} helper="Nested service rows" icon="reports" tone="slate" />
        <StatCard label="Homepage Visible" value={formatNumber(data.categories.filter((item) => item.show_on_homepage !== false).length)} helper="Marked for public display" icon="content" tone="emerald" />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {visibleParents.length ? (
          visibleParents.map((item) => (
            <CategoryParentCard key={item.id} item={item} subcategoryCount={subcategories.filter((child) => child.parent_id === item.id).length} />
          ))
        ) : (
          <SectionCard title="Parent Categories" description="Create categories to organize homepage and lead form options.">
            <p className="text-sm text-slate-500">No category rows available in this snapshot.</p>
          </SectionCard>
        )}
      </section>

      <SectionCard title="Subcategory Table" description="Status, homepage visibility, sort order, and safe actions for category rows.">
        <DataTable
          rows={tableRows}
          emptyTitle="No categories found"
          emptyMessage="Active categories from Supabase will appear here and can power public forms."
          columns={[
            { header: "Category", cell: (item) => <Strong title={item.name || "Unnamed category"} subtitle={item.slug || shortId(item.id)} /> },
            { header: "Type", cell: (item) => <StatusBadge value={item.parent_id ? "Subcategory" : "Parent"} tone={item.parent_id ? "blue" : "violet"} /> },
            { header: "Homepage", cell: (item) => <ToggleSwitch checked={Boolean(item.show_on_homepage ?? true)} /> },
            { header: "Status", cell: (item) => <StatusBadge value={item.is_active ? "Active" : "Inactive"} /> },
            { header: "Sort Order", cell: (item) => formatNumber(item.sort_order ?? 100) },
            { header: "Actions", cell: (item) => <ActionMenu actions={[{ label: "Edit", onClick: () => notify("Category editor placeholder ready.") }, { label: item.is_active ? "Disable" : "Enable", onClick: () => ask("Update category", "This changes public form visibility for the category.", () => adminSetCategoryActive(item.id, !item.is_active)) }, { label: "Add subcategory", onClick: () => notify("Subcategory drawer placeholder ready.") }]} /> },
          ]}
        />
      </SectionCard>
    </div>
  );
}

function CitiesPage({ data, notify, ask }: { data: Snapshot; notify: (message: string) => void; ask: any }) {
  const active = data.cities.filter((city) => city.is_active).length;
  const comingSoon = data.cities.filter((city) => city.launch_status === "Coming Soon").length;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Cities" value={formatNumber(data.cities.length)} helper="All configured cities" icon="cities" />
        <StatCard label="Active Cities" value={formatNumber(active)} helper="Accepting leads" icon="cities" tone="emerald" />
        <StatCard label="Coming Soon" value={formatNumber(comingSoon)} helper="Visible but paused" icon="notifications" tone="amber" />
        <StatCard label="Locality Manager" value="Prepared" helper="Placeholder UI only" icon="reports" tone="slate" />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.cities.slice(0, 6).map((city) => (
          <CityCoverageCard key={city.id} city={city} data={data} />
        ))}
      </section>

      <DataTable
        rows={data.cities}
        emptyTitle="No cities found"
        emptyMessage="Cities from Supabase will appear here. Only active cities should show in public lead forms."
        columns={[
          { header: "City", cell: (item) => <Strong title={item.name || "Unnamed city"} subtitle={item.slug || shortId(item.id)} /> },
          { header: "State", cell: (item) => item.state || "Maharashtra" },
          { header: "Demand", cell: (item) => <StatusBadge value={`${formatNumber(cityDemand(item, data))} leads`} tone="blue" /> },
          { header: "Supply", cell: (item) => <StatusBadge value={`${formatNumber(citySupply(item, data))} vendors`} tone="emerald" /> },
          { header: "Launch Status", cell: (item) => <StatusBadge value={item.launch_status || (item.is_active ? "Active" : "Hidden")} /> },
          { header: "Homepage", cell: (item) => <ToggleSwitch checked={Boolean(item.show_on_homepage ?? true)} /> },
          { header: "Localities", cell: () => <StatusBadge value="Manager prepared" tone="slate" /> },
          { header: "Actions", cell: (item) => <ActionMenu actions={[{ label: "Edit city", onClick: () => notify("City editor placeholder ready.") }, { label: item.is_active ? "Disable" : "Enable", onClick: () => ask("Update city", "This changes public form city visibility.", () => adminSetCityActive(item.id, !item.is_active)) }, { label: "Manage localities", onClick: () => notify("Locality manager placeholder ready.") }]} /> },
        ]}
      />
    </div>
  );
}

function PaymentsPage({ data, notify }: { data: Snapshot; notify: (message: string) => void }) {
  const paidPayments = data.payments.filter((payment) => String(payment.payment_status ?? "").toLowerCase() === "paid");
  const pendingPayments = data.payments.filter((payment) => String(payment.payment_status ?? "").toLowerCase() === "pending");

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Revenue" value={formatINR(data.stats.total_revenue)} helper={`${formatNumber(paidPayments.length)} paid payments`} icon="payments" />
        <StatCard label="Monthly Revenue" value={formatINR(data.stats.revenue_this_month)} helper="This month" icon="reports" tone="emerald" />
        <StatCard label="Pending Collections" value={formatNumber(pendingPayments.length || data.stats.pending_payments)} helper="Needs follow-up" icon="notifications" tone="amber" />
        <StatCard label="Renewal Risk" value={formatNumber(data.stats.expired_vendors)} helper="Expired vendors" icon="subscriptions" tone="rose" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <SectionCard title="Revenue Snapshot" description="Live payment rows summarized for quick finance review.">
          <div className="grid gap-3 sm:grid-cols-2">
            <FinanceTile label="Paid" value={formatNumber(paidPayments.length)} tone="emerald" />
            <FinanceTile label="Pending" value={formatNumber(pendingPayments.length)} tone="amber" />
            <FinanceTile label="Gateway" value="Prepared" tone="slate" />
            <FinanceTile label="Invoice UI" value="Ready" tone="blue" />
          </div>
        </SectionCard>

        <SectionCard title="Collection Notes" description="Operational placeholders only; no payment logic changed.">
          <div className="grid gap-3 sm:grid-cols-3">
            {["Manual collection", "Invoice download", "Renewal follow-up"].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => notify(`${item} placeholder ready.`)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50/40"
              >
                {item}
              </button>
            ))}
          </div>
        </SectionCard>
      </section>

      <DataTable
        rows={data.payments}
        emptyTitle="No payments found"
        emptyMessage="Manual package payments and future gateway payments will appear here."
        columns={[
          { header: "Payment ID", cell: (row) => <Strong title={shortId(row.id)} subtitle={formatDate(row.created_at)} /> },
          { header: "Vendor", cell: (row) => vendorName(data.vendors, row.vendor_id) },
          { header: "Package", cell: (row) => packageName(data.packages, row.package_id) },
          { header: "Amount", cell: (row) => <span className="font-semibold text-slate-950">{formatINR(row.amount)}</span> },
          { header: "Mode", cell: (row) => <StatusBadge value={row.payment_method || "Manual"} tone="slate" /> },
          { header: "Status", cell: (row) => <StatusBadge value={row.payment_status || "Pending"} /> },
          { header: "Transaction", cell: (row) => row.transaction_id || "Not linked" },
          { header: "Actions", cell: () => <SecondaryButton onClick={() => notify("Invoice placeholder ready.")}>Invoice</SecondaryButton> },
        ]}
      />
    </div>
  );
}

function LeadPriorityBadge({ lead }: { lead: Lead }) {
  const priority = leadPriorityLabel(lead);
  return <StatusBadge value={priority} tone={priority === "Hot" || priority === "High" ? "amber" : priority === "Low" ? "slate" : "blue"} />;
}

function SourceBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = normalized.includes("google") || normalized.includes("ads") ? "violet" : normalized.includes("whatsapp") ? "emerald" : normalized.includes("website") ? "blue" : "slate";
  return <StatusBadge value={value} tone={tone} />;
}

function VendorHealthBadge({ vendor }: { vendor: Vendor }) {
  const score = vendorHealthScore(vendor);
  return <StatusBadge value={`${score}%`} tone={score >= 75 ? "emerald" : score >= 45 ? "amber" : "rose"} />;
}

function CreditsMeter({ value, total }: { value: number; total: number }) {
  const normalizedTotal = Math.max(total, value, 1);
  const percentage = Math.round((Math.max(value, 0) / normalizedTotal) * 100);
  const tone = percentage <= 20 ? "rose" : percentage <= 45 ? "amber" : "emerald";

  return (
    <div className="min-w-36 space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs font-medium">
        <span className="text-slate-500">Credits</span>
        <span className="text-slate-900">{formatNumber(value)} / {formatNumber(normalizedTotal)}</span>
      </div>
      <ProgressBar value={percentage} tone={tone} />
    </div>
  );
}

function VendorPackageCell({ vendor, data }: { vendor: Vendor; data: Snapshot }) {
  const latestPackage = latestVendorPackage(vendor.id, data.vendorPackages);
  const currentPackage = latestPackage ? packageName(data.packages, latestPackage.package_id) : "No package";
  const status = vendorPackageStatus(vendor, latestPackage);

  return (
    <div className="min-w-40">
      <p className="font-semibold text-slate-950">{currentPackage}</p>
      <div className="mt-1">
        <StatusBadge value={status} />
      </div>
    </div>
  );
}

function PackageRowCard({ item, notify, ask }: { item: PackageRow; notify: (message: string) => void; ask: any }) {
  const features = packageFeatures(item);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-slate-950">{item.name || "Unnamed package"}</h2>
          <p className="mt-1 text-sm text-slate-500">{formatNumber(item.lead_count)} leads / {formatNumber(item.validity_days)} days</p>
        </div>
        <StatusBadge value={item.is_active ? "Active" : "Inactive"} />
      </div>
      <p className="mt-5 text-3xl font-semibold tracking-tight text-slate-950">{formatINR(item.total_price || item.display_price)}</p>
      <ul className="mt-5 space-y-2 text-sm text-slate-600">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <ToggleSwitch checked={Boolean(item.is_active)} label="Visible" />
        <ActionMenu actions={[
          { label: "Edit", onClick: () => notify("Package edit placeholder ready.") },
          { label: item.is_active ? "Disable" : "Enable", onClick: () => ask("Update package", "This will change package visibility.", () => adminSetPackageActive(item.id, !item.is_active)) },
        ]} />
      </div>
    </article>
  );
}

function PackageTemplateCard({ item, notify }: { item: (typeof packageTemplates)[number]; notify: (message: string) => void }) {
  return (
    <article className="rounded-lg border border-dashed border-slate-300 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{item.name}</h2>
          <p className="mt-1 text-sm text-slate-500">{item.leads} / {item.validity}</p>
        </div>
        <StatusBadge value="Template" tone="slate" />
      </div>
      <p className="mt-5 text-3xl font-semibold tracking-tight text-slate-950">{item.price}</p>
      <ul className="mt-5 space-y-2 text-sm text-slate-600">
        {item.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => notify("Package editor placeholder ready.")} className="mt-5 w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        Configure package
      </button>
    </article>
  );
}

function CategoryParentCard({ item, subcategoryCount }: { item: Category; subcategoryCount: number }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <Strong title={item.name || "Unnamed category"} subtitle={item.slug || shortId(item.id)} />
        <StatusBadge value={item.is_active ? "Active" : "Inactive"} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Subcategories</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">{formatNumber(subcategoryCount)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Sort</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">{formatNumber(item.sort_order ?? 100)}</p>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
        <span className="text-sm font-semibold text-slate-600">Homepage</span>
        <ToggleSwitch checked={Boolean(item.show_on_homepage ?? true)} />
      </div>
    </article>
  );
}

function CityCoverageCard({ city, data }: { city: City; data: Snapshot }) {
  const demand = cityDemand(city, data);
  const supply = citySupply(city, data);
  const balance = demand ? Math.min(100, Math.round((supply / Math.max(demand, 1)) * 100)) : supply ? 100 : 0;

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <Strong title={city.name || "Unnamed city"} subtitle={city.state || "Maharashtra"} />
        <StatusBadge value={city.launch_status || (city.is_active ? "Active" : "Hidden")} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Demand</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">{formatNumber(demand)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Supply</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">{formatNumber(supply)}</p>
        </div>
      </div>
      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between text-xs font-medium text-slate-500">
          <span>Demand/supply fit</span>
          <span>{formatNumber(balance)}%</span>
        </div>
        <ProgressBar value={balance} tone={balance >= 60 ? "emerald" : balance >= 30 ? "amber" : "rose"} />
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
        <span className="text-sm font-semibold text-slate-600">Localities</span>
        <StatusBadge value="Prepared" tone="slate" />
      </div>
    </article>
  );
}

function FinanceTile({ label, value, tone }: { label: string; value: ReactNode; tone: "emerald" | "amber" | "blue" | "slate" }) {
  const toneClass = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    blue: "bg-sky-500",
    slate: "bg-slate-400",
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-lg font-semibold text-slate-950">{value}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${toneClass}`} />
      </div>
    </div>
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

function leadPriorityLabel(lead: Lead) {
  const priority = String(lead.lead_priority ?? "").trim();
  const score = Number(lead.lead_quality_score ?? 0);
  if (priority) return priority.charAt(0).toUpperCase() + priority.slice(1);
  if (isHotLead(lead)) return "Hot";
  if (score >= 50) return "High";
  if (score > 0 && score < 30) return "Low";
  return "Normal";
}

function latestVendorPackage(vendorId: string, rows: any[]) {
  return rows.find((row) => row.vendor_id === vendorId) ?? null;
}

function vendorPackageStatus(vendor: Vendor, latestPackage: any) {
  const status = String(latestPackage?.status || latestPackage?.payment_status || "").trim();
  if (status) return status;
  if (Number(vendor.remaining_credits ?? 0) > 0) return "Active credits";
  return "No package";
}

function vendorHealthScore(vendor: Vendor) {
  const credits = Math.min(40, Number(vendor.remaining_credits ?? 0) * 8);
  const rating = Math.min(25, Number(vendor.rating ?? 0) * 5);
  const active = vendor.is_active !== false && ["approved", "active"].includes(String(vendor.status ?? "").toLowerCase()) ? 25 : 8;
  const visibility = vendor.public_visibility === false ? 0 : 10;
  return Math.max(8, Math.min(98, Math.round(credits + rating + active + visibility)));
}

function packageFeatures(item: PackageRow) {
  return [
    `${formatNumber(item.lead_count)} verified leads`,
    `${formatNumber(item.validity_days)} day validity`,
    item.price_per_lead ? `${formatINR(item.price_per_lead)} per lead` : "Pricing review prepared",
  ];
}

function cityDemand(city: City, data: Snapshot) {
  return data.leads.filter((lead) => String(lead.city ?? "").toLowerCase() === String(city.name ?? "").toLowerCase()).length;
}

function citySupply(city: City, data: Snapshot) {
  return data.vendors.filter((vendor) => String(vendor.city ?? "").toLowerCase() === String(city.name ?? "").toLowerCase()).length;
}

function LeadDistributionPage({ data, notify }: { data: Snapshot; notify: (message: string) => void }) {
  const [tab, setTab] = useState("Rules & Settings");
  const tabs = ["Rules & Settings", "Recent Assignments", "Failed Assignments", "Vendor Eligibility Checker", "Distribution Logs"];

  return (
    <div className="space-y-5">
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === "Rules & Settings" ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {["Auto assignment", "Match by city", "Match by locality", "Verified vendors only", "Paid vendors only", "Remaining leads required", "Duplicate protection", "Fair rotation"].map((rule, index) => (
            <article key={rule} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-semibold text-slate-950">{rule}</h2>
                <ToggleSwitch checked={index < 6} />
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-500">Future-ready distribution rule. Persist in settings when backend rule storage is finalized.</p>
            </article>
          ))}
        </section>
      ) : tab === "Recent Assignments" ? (
        <AssignmentsTable data={data} rows={data.assignments.slice(0, 20)} />
      ) : tab === "Failed Assignments" ? (
        <AssignmentsTable data={data} rows={data.assignments.filter((row) => String(row.vendor_status || "").toLowerCase().includes("failed"))} failed />
      ) : tab === "Vendor Eligibility Checker" ? (
        <EligibilityChecker data={data} notify={notify} />
      ) : (
        <AssignmentsTable data={data} rows={data.assignments.slice(0, 20)} />
      )}
    </div>
  );
}

function AssignmentsTable({ data, rows, failed = false }: { data: Snapshot; rows: any[]; failed?: boolean }) {
  return (
    <DataTable
      rows={rows}
      emptyTitle={failed ? "No failed assignments" : "No assignments yet"}
      emptyMessage="Assignment records will appear here after lead distribution runs."
      columns={[
        { header: "Lead", cell: (row) => leadName(data.leads, row.lead_id) },
        { header: "Category", cell: (row) => data.leads.find((lead) => lead.id === row.lead_id)?.service_required || "Not set" },
        { header: "City", cell: (row) => data.leads.find((lead) => lead.id === row.lead_id)?.city || "Not set" },
        { header: "Assigned Vendor", cell: (row) => vendorName(data.vendors, row.vendor_id) },
        { header: "Status", cell: (row) => <StatusBadge value={assignmentStatus(row)} /> },
        { header: "Credits", cell: () => "1 deducted" },
        { header: "Time", cell: (row) => formatDate(row.assigned_at || row.created_at) },
      ]}
    />
  );
}

function EligibilityChecker({ data, notify }: { data: Snapshot; notify: (message: string) => void }) {
  const [city, setCity] = useState(data.cities[0]?.name || "Pune");
  const [category, setCategory] = useState(data.categories[0]?.name || "Interior");
  const eligible = data.vendors.filter((vendor) => vendor.city === city && (vendor.service_categories ?? []).some((item) => item === category) && Number(vendor.remaining_credits ?? 0) > 0);

  return (
    <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Eligibility Checker</h2>
        <div className="mt-5 space-y-3">
          <SelectFilter label="City" value={city} onChange={setCity} options={uniqueOptions(data.cities.map((item) => item.name), city)} />
          <SelectFilter label="Category" value={category} onChange={setCategory} options={uniqueOptions(data.categories.map((item) => item.name), category)} />
          <PrimaryButton onClick={() => notify("Eligibility check refreshed.")}>Check Vendors</PrimaryButton>
        </div>
      </div>
      <DataTable
        rows={eligible}
        emptyTitle="No eligible vendors"
        emptyMessage="Skipped vendor reasons include city mismatch, category mismatch, no leads remaining, paused status, or verification gaps."
        columns={[
          { header: "Vendor", cell: (vendor) => vendor.business_name || "Unnamed vendor" },
          { header: "City", cell: (vendor) => vendor.city || "Not set" },
          { header: "Credits", cell: (vendor) => formatNumber(vendor.remaining_credits) },
          { header: "Status", cell: (vendor) => <StatusBadge value={vendor.status || "Pending"} /> },
          { header: "Score", cell: (vendor) => `${Math.min(98, 65 + Number(vendor.rating ?? 0) * 5)}%` },
        ]}
      />
    </section>
  );
}

function SubscriptionsPage({ data, notify }: { data: Snapshot; notify: (message: string) => void }) {
  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Low Balance" value={formatNumber(data.stats.low_balance_vendors)} helper="At or below threshold" icon="subscriptions" tone="amber" />
        <StatCard label="Expiring Soon" value="Prepared" helper="Needs expiry date column" icon="notifications" tone="amber" />
        <StatCard label="Expired" value={formatNumber(data.stats.expired_vendors)} helper="Stopped from assignment" icon="packages" tone="rose" />
        <StatCard label="High Performers" value="Prepared" helper="Upgrade opportunity" icon="reports" tone="emerald" />
      </section>
      <DataTable
        rows={data.vendorPackages}
        emptyTitle="No vendor subscriptions found"
        emptyMessage="Vendor package history will appear here after packages are assigned."
        columns={[
          { header: "Vendor", cell: (row: any) => vendorName(data.vendors, row.vendor_id) },
          { header: "Package", cell: (row: any) => packageName(data.packages, row.package_id) },
          { header: "Purchased", cell: (row: any) => formatNumber(row.total_leads ?? row.leads_purchased ?? row.lead_count ?? 0) },
          { header: "Used", cell: (row: any) => formatNumber(row.leads_used ?? 0) },
          { header: "Remaining", cell: (row: any) => formatNumber(row.remaining_leads ?? row.leads_remaining ?? row.remaining_credits ?? 0) },
          { header: "Expiry", cell: (row: any) => formatDate(row.expiry_date) },
          { header: "Status", cell: (row: any) => <StatusBadge value={row.status || "Active"} /> },
          { header: "Actions", cell: () => <SecondaryButton onClick={() => notify("Renewal drawer placeholder ready.")}>Renew</SecondaryButton> },
        ]}
      />
    </div>
  );
}

function ReportsPage({ data }: { data: Snapshot }) {
  const reports = ["Daily leads", "Weekly leads", "Monthly leads", "Leads by category", "Leads by city", "Leads by source", "Vendor-wise usage", "Revenue by package", "Low balance vendors", "Duplicate/spam leads", "Lost lead reasons"];
  return (
    <div className="space-y-5">
      <section className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Leads by Category" rows={groupBy(data.leads, (lead) => lead.service_required || lead.category)} />
        <ChartCard title="Leads by City" rows={groupBy(data.leads, (lead) => lead.city)} />
        <ChartCard title="Leads by Source" rows={groupBy(data.leads, (lead) => lead.source || "Website")} />
      </section>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reports.map((report) => (
          <article key={report} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">{report}</h2>
            <p className="mt-2 text-sm text-slate-500">CSV, Excel-compatible export, and printable layout placeholder.</p>
            <button type="button" className="mt-4 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Export</button>
          </article>
        ))}
      </section>
    </div>
  );
}

function AIAgentsPage() {
  return (
    <div className="space-y-5">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {aiAgents.map(([name, purpose], index) => (
          <article key={name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">{name}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">{purpose}</p>
              </div>
              <ToggleSwitch checked={index < 2} />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <StatusBadge value={index < 2 ? "Draft" : "Disabled"} />
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">{index + 2} suggestions</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Confidence {72 + index}%</span>
            </div>
          </article>
        ))}
      </section>
      <DataTable
        rows={[
          ["Lead quality", "Lead", "Budget and urgency look strong", "86%", "New"],
          ["Vendor match", "Vendor", "Prioritize vendors with remaining credits", "78%", "New"],
          ["Renewal", "Vendor", "Low balance vendor needs reminder", "74%", "Draft"],
        ]}
        emptyTitle="No AI suggestions"
        emptyMessage="Suggestions will appear here when AI agents are connected."
        columns={[
          { header: "Suggestion", cell: (row) => row[2] },
          { header: "Module", cell: (row) => row[1] },
          { header: "Confidence", cell: (row) => row[3] },
          { header: "Status", cell: (row) => <StatusBadge value={row[4]} /> },
          { header: "Action", cell: () => <ActionMenu actions={[{ label: "Accept", onClick: () => {} }, { label: "Reject", onClick: () => {} }]} /> },
        ]}
      />
    </div>
  );
}

function AutomationsPage({ notify }: { notify: (message: string, tone?: "success" | "error" | "info") => void }) {
  return (
    <div className="space-y-5">
      <AosAutomationControl notify={notify} />
      <SectionCard title="Automation Workflows" description="Placeholder workflow catalog. n8n forwarding is governed by the AOS / n8n control above.">
        <DataTable
          rows={automationRows}
          emptyTitle="No automations"
          emptyMessage="Automation workflows will appear here after the automations table is connected."
          columns={[
            { header: "Automation", cell: (row) => <Strong title={row[0]} subtitle={row[1]} /> },
            { header: "Trigger", cell: (row) => row[1] },
            { header: "Action", cell: (row) => row[2] },
            { header: "Status", cell: (row) => <StatusBadge value={row[3]} /> },
            { header: "Last Run", cell: () => "Not run" },
            { header: "Success", cell: () => "0" },
            { header: "Failed", cell: () => "0" },
            { header: "Actions", cell: () => <ActionMenu actions={[{ label: "Test webhook", onClick: () => notify("Webhook test placeholder ready.") }, { label: "Enable/disable", onClick: () => notify("Automation toggle placeholder ready.") }]} /> },
          ]}
        />
      </SectionCard>
    </div>
  );
}

function WebsiteContentPage({ notify }: { notify: (message: string) => void }) {
  const sections = ["Hero Content", "CTA Buttons", "Featured Categories", "Featured Cities", "Testimonials", "FAQs", "Contact Info", "SEO Settings"];
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      {sections.map((section) => (
        <article key={section} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">{section}</h2>
          <div className="mt-4 space-y-3">
            <input className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" placeholder={`${section} title`} />
            <textarea className="min-h-24 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" placeholder={`${section} content`} />
            <PrimaryButton onClick={() => notify(`${section} save placeholder ready.`)}>Save</PrimaryButton>
          </div>
        </article>
      ))}
    </section>
  );
}

function ReviewsPage() {
  return (
    <DataTable
      rows={[] as Array<[string, string, string, string, string]>}
      emptyTitle="No reviews found"
      emptyMessage="Client reviews will appear here when the reviews table receives records."
      columns={[
        { header: "Vendor", cell: (row) => row[0] },
        { header: "Client", cell: (row) => row[1] },
        { header: "Rating", cell: (row) => row[2] },
        { header: "Status", cell: (row) => <StatusBadge value={row[3]} /> },
        { header: "Actions", cell: () => <ActionMenu actions={[{ label: "Approve", onClick: () => {} }, { label: "Reject", onClick: () => {} }]} /> },
      ]}
    />
  );
}

function NotificationsPage({ data, notify }: { data: Snapshot; notify: (message: string) => void }) {
  const notifications = [
    ...data.leads.slice(0, 4).map((lead) => ({ title: "New lead", message: `${lead.name || "Client"} submitted a requirement`, type: "New lead", priority: "High", date: lead.created_at })),
    ...data.vendors.filter((vendor) => Number(vendor.remaining_credits ?? 0) <= 3).slice(0, 4).map((vendor) => ({ title: "Low balance vendor", message: `${vendor.business_name || "Vendor"} has low lead balance`, type: "Low balance vendor", priority: "Medium", date: vendor.created_at })),
  ];
  return (
    <DataTable
      rows={notifications}
      emptyTitle="No notifications"
      emptyMessage="Admin alerts will appear here when notification persistence is connected."
      columns={[
        { header: "Title", cell: (row) => <Strong title={row.title} subtitle={row.message} /> },
        { header: "Type", cell: (row) => row.type },
        { header: "Priority", cell: (row) => <StatusBadge value={row.priority} /> },
        { header: "Read", cell: () => <StatusBadge value="Unread" /> },
        { header: "Date", cell: (row) => formatDate(row.date) },
        { header: "Actions", cell: () => <SecondaryButton onClick={() => notify("Notification marked read placeholder.")}>Mark read</SecondaryButton> },
      ]}
    />
  );
}

function AdminUsersPage({ data }: { data: Snapshot }) {
  return (
    <DataTable
      rows={data.profiles.filter((profile) => profile.role === "admin")}
      emptyTitle="No admin users found"
      emptyMessage="Supabase Auth users with admin profiles will appear here."
      columns={[
        { header: "Name", cell: (profile) => <Strong title={profile.full_name || "Admin user"} subtitle={profile.id} /> },
        { header: "Email", cell: () => "Managed in Supabase Auth" },
        { header: "Role", cell: (profile) => <StatusBadge value={profile.admin_role || "Superadmin"} /> },
        { header: "Status", cell: (profile) => <StatusBadge value={profile.is_active === false ? "Disabled" : "Active"} /> },
        { header: "Last Login", cell: () => "Auth dashboard" },
        { header: "Created", cell: (profile) => formatDate(profile.created_at) },
      ]}
    />
  );
}

function SettingsPage({ notify }: { notify: (message: string) => void }) {
  const groups = ["Business Settings", "Lead Settings", "Vendor Settings", "Distribution Settings", "AI Settings", "Automation Settings", "Security Settings"];
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      {groups.map((group, index) => (
        <article key={group} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-950">{group}</h2>
              <p className="mt-2 text-sm text-slate-500">Global marketplace controls prepared for Supabase persistence.</p>
            </div>
            <ToggleSwitch checked={index < 4} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" placeholder="Setting key" />
            <input className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" placeholder="Setting value" />
          </div>
          <button type="button" onClick={() => notify(`${group} save placeholder ready.`)} className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Save</button>
        </article>
      ))}
    </section>
  );
}

function AuditLogsPage({ data }: { data: Snapshot }) {
  return (
    <EmptyState
      title="Audit log UI is ready"
      message={`Admin audit log rows need the audit_logs table exposed to the server snapshot. Current snapshot contains ${formatNumber(data.badReports.length)} bad-lead reports and ${formatNumber(data.assignments.length)} assignments for context.`}
    />
  );
}

function LeadDetailDrawer({ lead, vendors, onClose }: { lead: Lead; vendors: Vendor[]; onClose: () => void }) {
  return (
    <Drawer title={lead.name || "Lead details"} subtitle={`Lead ID ${shortId(lead.id)}`} onClose={onClose}>
      <div className="space-y-5">
        <InfoGrid rows={[
          ["Phone", lead.phone || "Not provided"],
          ["Email", lead.email || "Not provided"],
          ["City", lead.city || "Not provided"],
          ["Locality", lead.locality || lead.area || "Not provided"],
          ["Category", lead.service_required || lead.category || "Not provided"],
          ["Budget", lead.budget || "Not provided"],
          ["Timeline", lead.timeline || "Not provided"],
          ["Status", <StatusBadge key="status" value={lead.status || "New"} />],
        ]} />
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-950">Requirement</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{lead.message || "No requirement message provided."}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-950">Assignment Timeline</h3>
          <div className="mt-3 space-y-2">
            {(lead.lead_assignments ?? []).length ? lead.lead_assignments?.map((assignment) => (
              <div key={assignment.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span>{vendorName(vendors, assignment.vendor_id)}</span>
                <StatusBadge value={assignmentStatus(assignment)} />
              </div>
            )) : <p className="text-sm text-slate-500">No assignment events yet.</p>}
          </div>
        </article>
      </div>
    </Drawer>
  );
}

function VendorDetailDrawer({ vendor, onClose }: { vendor: Vendor; onClose: () => void }) {
  return (
    <Drawer title={vendor.business_name || "Vendor details"} subtitle={`Vendor ID ${shortId(vendor.id)}`} onClose={onClose}>
      <InfoGrid rows={[
        ["Owner", vendor.owner_name || "Not provided"],
        ["Phone", vendor.phone || "Not provided"],
        ["Email", vendor.email || "Not provided"],
        ["City", vendor.city || "Not provided"],
        ["Categories", vendor.service_categories?.join(", ") || "Not provided"],
        ["Areas", vendor.areas_covered?.join(", ") || "Not provided"],
        ["Leads Remaining", formatNumber(vendor.remaining_credits)],
        ["Status", <StatusBadge key="status" value={vendor.status || "Pending"} />],
      ]} />
    </Drawer>
  );
}

function Strong({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="min-w-44">
      <p className="font-semibold text-slate-950">{title}</p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
    </div>
  );
}
