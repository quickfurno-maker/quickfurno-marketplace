"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminApproveVendorProfileChangeRequest,
  adminRejectVendorProfileChangeRequest,
  adminReplyVendorSupportThread,
  adminSetCategoryActive,
  adminSetCityActive,
  adminSetPackageActive,
  adminMarkFreeVendorInterestStatus,
  adminRecheckLeadAssignmentQueue,
  adminRunAutoMatchPreview,
  adminUpdateMarketplaceRuntimeSetting,
  adminUpdateLeadStatus,
} from "@/app/actions";
import { evaluateVendorEligibility, evaluateVendorLeadAssignmentEligibility, type VendorEligibility, type VendorLeadAssignmentEligibility } from "@/lib/vendors/vendorEligibility";
import { getVendorPublicVisibility, type VendorPublicVisibility } from "@/lib/vendors/vendorVisibility";
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
import { emptySnapshot, type Category, type City, type Lead, type MarketplaceRuntimeSetting, type PackageRow, type Snapshot, type Vendor, type VendorProfileChangeRequest, type VendorSupportMessage, type VendorSupportThread } from "./adminTypes";
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
import { LeadAssignmentApprovalControl } from "./LeadAssignmentApprovalControl";
import { DistributionLogsPanel, FailedAssignmentsPanel, RecentAssignmentsPanel } from "./AssignmentLedgerPanels";
import { CategoryManager } from "./CategoryManager";
import {
  BadLeadReportsReviewPanel,
  DeliveryLogsAuditPanel,
  MatchingRunsAuditPanel,
  PreviewMessagesPanel,
} from "./LeadMatchingAuditPanels";
import { ManualLeadAssignmentPanel } from "./ManualLeadAssignmentPanel";
import { RequirementGroupsPanel } from "./RequirementGroupsPanel";

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
  const router = useRouter();
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
      router.refresh();
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
      return <SettingsPage data={data} notify={helpers.notify} runAction={helpers.runAction} />;
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

      <BadLeadReportsReviewPanel data={data} notify={notify} runAction={runAction} />

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

function VendorsPage({ data, notify }: { data: Snapshot; notify: (message: string, tone?: "success" | "error" | "info") => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("All");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");
  const [packageStatus, setPackageStatus] = useState("All");
  const [eligibility, setEligibility] = useState("All");
  const [selected, setSelected] = useState<Vendor | null>(null);
  const [creditsFor, setCreditsFor] = useState<Vendor | null>(null);
  const [packageFor, setPackageFor] = useState<Vendor | null>(null);
  const [logFor, setLogFor] = useState<Vendor | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const marketplaceSettings = useMemo(() => marketplaceSettingsObject(data.marketplaceSettings), [data.marketplaceSettings]);

  // Phase 13B: ONE shared eligibility helper, same as the Lead Assignment
  // Approval Preview, so the two surfaces always agree.
  const eligibilityById = useMemo(() => {
    const map = new Map<string, VendorEligibility>();
    data.vendors.forEach((vendor) => map.set(vendor.id, evaluateVendorEligibility(vendor as Record<string, unknown>)));
    return map;
  }, [data.vendors]);
  const assignmentEligibilityById = useMemo(() => {
    const map = new Map<string, VendorLeadAssignmentEligibility>();
    data.vendors.forEach((vendor) => map.set(vendor.id, evaluateVendorLeadAssignmentEligibility(vendor as Record<string, unknown>, null, marketplaceSettings)));
    return map;
  }, [data.vendors, marketplaceSettings]);
  const publicVisibilityById = useMemo(() => {
    const map = new Map<string, VendorPublicVisibility>();
    data.vendors.forEach((vendor) => map.set(vendor.id, getVendorPublicVisibility(vendor as Record<string, unknown>, marketplaceSettings)));
    return map;
  }, [data.vendors, marketplaceSettings]);

  const packageOptions = useMemo(() => uniqueOptions(data.vendors.map((vendor) => vendorRowPackageStatus(vendor)), "All"), [data.vendors]);
  const vendors = useMemo(() => data.vendors.filter((vendor) => {
    const currentPackageStatus = vendorRowPackageStatus(vendor);
    const isEligible = assignmentEligibilityById.get(vendor.id)?.eligible ?? false;
    return includesQuery([vendor.business_name, vendor.owner_name, vendor.phone, vendor.city, vendor.status, vendor.service_categories?.join(" "), currentPackageStatus], query)
      && (city === "All" || vendor.city === city)
      && (category === "All" || (vendor.service_categories ?? []).includes(category))
      && (status === "All" || vendor.status === status)
      && (packageStatus === "All" || currentPackageStatus === packageStatus)
      && (eligibility === "All" || (eligibility === "Eligible" ? isEligible : !isEligible));
  }), [data.vendors, assignmentEligibilityById, query, city, category, status, packageStatus, eligibility]);

  const eligibleCount = useMemo(() => [...assignmentEligibilityById.values()].filter((e) => e.eligible).length, [assignmentEligibilityById]);
  const profileChangeRequests = useMemo(
    () => (data.vendorProfileChangeRequests ?? []).filter((request) => request.status === "pending"),
    [data.vendorProfileChangeRequests],
  );
  const supportThreads = useMemo(
    () => (data.vendorSupportThreads ?? []).filter((thread) => (thread.status ?? "open") !== "closed"),
    [data.vendorSupportThreads],
  );
  const supportMessagesByThread = useMemo(() => {
    const map = new Map<string, VendorSupportMessage[]>();
    (data.vendorSupportMessages ?? []).forEach((message) => {
      if (!message.thread_id) return;
      const current = map.get(message.thread_id) ?? [];
      current.push(message);
      map.set(message.thread_id, current);
    });
    return map;
  }, [data.vendorSupportMessages]);

  // Mutations go through the Phase 13B admin APIs, then refresh the snapshot.
  const mutate = useCallback(async (vendorId: string, path: string, body: Record<string, unknown>, successMsg: string) => {
    setBusyId(vendorId);
    try {
      const res = await fetch(`/api/admin/vendors/${vendorId}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !result?.ok) {
        notify(result?.error ?? "Action failed.", "error");
        return false;
      }
      notify(successMsg, "success");
      router.refresh();
      return true;
    } catch {
      notify("Action failed. Please try again.", "error");
      return false;
    } finally {
      setBusyId(null);
    }
  }, [notify, router]);

  const approveProfileRequest = useCallback(async (requestId: string) => {
    setBusyId(requestId);
    const result = await adminApproveVendorProfileChangeRequest(requestId);
    setBusyId(null);
    if (!result.ok) {
      notify(result.error ?? "Profile request approval failed.", "error");
      return;
    }
    notify("Profile changes approved.", "success");
    router.refresh();
  }, [notify, router]);

  const rejectProfileRequest = useCallback(async (requestId: string) => {
    const reason = window.prompt("Rejection reason for the vendor");
    if (!reason?.trim()) {
      notify("Rejection reason is required.", "error");
      return;
    }
    setBusyId(requestId);
    const result = await adminRejectVendorProfileChangeRequest(requestId, reason);
    setBusyId(null);
    if (!result.ok) {
      notify(result.error ?? "Profile request rejection failed.", "error");
      return;
    }
    notify("Profile changes rejected.", "success");
    router.refresh();
  }, [notify, router]);

  const replySupportThread = useCallback(async (threadId: string) => {
    const message = window.prompt("Reply to vendor support thread");
    if (!message?.trim()) {
      notify("Reply message is required.", "error");
      return;
    }
    setBusyId(threadId);
    const result = await adminReplyVendorSupportThread(threadId, message);
    setBusyId(null);
    if (!result.ok) {
      notify(result.error ?? "Support reply failed.", "error");
      return;
    }
    notify("Support reply sent.", "success");
    router.refresh();
  }, [notify, router]);

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Vendors" value={formatNumber(data.vendors.length)} helper="All vendor records" icon="vendors" />
        <StatCard label="Paid Lead Eligible" value={formatNumber(eligibleCount)} helper="Paid/trial, active, with credits" icon="vendors" tone="emerald" />
        <StatCard label="Active Vendors" value={formatNumber(data.stats.active_vendors)} helper="Ready for leads" icon="vendors" tone="indigo" />
        <StatCard label="Low Credits" value={formatNumber(data.stats.low_balance_vendors)} helper="Renewal risk" icon="notifications" tone="amber" />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {vendors.slice(0, 4).map((vendor) => (
          <button
            key={vendor.id}
            type="button"
            onClick={() => setSelected(vendor)}
            className="qf-card-shadow qf-card-hover rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-200"
          >
            <div className="flex items-start justify-between gap-3">
              <Strong title={vendor.business_name || "Unnamed vendor"} subtitle={vendor.city || "City not set"} />
              <VendorEligibilityBadge eligibility={eligibilityById.get(vendor.id)} />
            </div>
            <div className="mt-4">
              <CreditsMeter value={Number(vendor.remaining_credits ?? 0)} total={Number(vendor.total_credits ?? 0)} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusBadge value={vendor.status || "Pending"} />
              <StatusBadge value={vendor.is_active === false ? "Inactive" : "Active"} tone={vendor.is_active === false ? "rose" : "emerald"} />
              <StatusBadge value={`Pkg: ${vendorRowPackageStatus(vendor)}`} tone={isLivePackage(vendor) ? "emerald" : "slate"} />
            </div>
            <div className="mt-3">
              <VendorInternalBadges
                visibility={publicVisibilityById.get(vendor.id)}
                assignmentEligibility={assignmentEligibilityById.get(vendor.id)}
              />
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
            <SelectFilter label="City" value={city} onChange={setCity} options={uniqueOptions(activeCityNames(data.cities), "All")} />
            <SelectFilter label="Category" value={category} onChange={setCategory} options={uniqueOptions(activeCategoryNames(data.categories), "All")} />
            <SelectFilter label="Status" value={status} onChange={setStatus} options={uniqueOptions(data.vendors.map((vendor) => vendor.status))} />
            <SelectFilter label="Package" value={packageStatus} onChange={setPackageStatus} options={packageOptions} />
            <SelectFilter label="Eligibility" value={eligibility} onChange={setEligibility} options={["All", "Eligible", "Not eligible"]} />
          </>
        }
        action={<SecondaryButton onClick={() => notify("Vendor export placeholder ready.")}>Export Vendors</SecondaryButton>}
      />

      <SectionCard
        title="Profile Change Requests"
        description="Review vendor-submitted public profile changes. Approval applies only safe public fields."
      >
        <DataTable
          rows={profileChangeRequests}
          emptyTitle="No pending profile change requests"
          emptyMessage="Vendor profile edits that need approval will appear here."
          columns={[
            { header: "Vendor", cell: (request) => <Strong title={vendorName(data.vendors, request.vendor_id)} subtitle={formatDate(request.created_at)} /> },
            { header: "Current", cell: (request) => <ProfileChangeSnapshot value={request.current_snapshot} /> },
            { header: "Proposed", cell: (request) => <ProfileChangeSnapshot value={request.proposed_changes} /> },
            { header: "Status", cell: (request) => <StatusBadge value={request.status || "pending"} tone="amber" /> },
            {
              header: "Actions",
              cell: (request) => (
                <div className="flex flex-wrap gap-2">
                  <SecondaryButton onClick={() => void approveProfileRequest(request.id)}>{busyId === request.id ? "Working..." : "Approve"}</SecondaryButton>
                  <SecondaryButton onClick={() => void rejectProfileRequest(request.id)}>Reject</SecondaryButton>
                </div>
              ),
            },
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Vendor Support Inbox"
        description="View vendor support threads and reply. Replies create a vendor dashboard notification."
      >
        <DataTable
          rows={supportThreads}
          emptyTitle="No active support threads"
          emptyMessage="Vendor support threads will appear here after vendors create them."
          columns={[
            { header: "Vendor", cell: (thread) => <Strong title={vendorName(data.vendors, thread.vendor_id)} subtitle={formatDate(thread.updated_at)} /> },
            { header: "Subject", cell: (thread) => <Strong title={thread.subject || "Support thread"} subtitle={thread.topic || "general"} /> },
            { header: "Status", cell: (thread) => <StatusBadge value={thread.status || "open"} tone={thread.status === "admin_replied" ? "emerald" : "amber"} /> },
            {
              header: "Conversation",
              cell: (thread) => (
                <SupportThreadMessages messages={supportMessagesByThread.get(thread.id) ?? []} />
              ),
            },
            {
              header: "Actions",
              cell: (thread) => (
                <SecondaryButton onClick={() => void replySupportThread(thread.id)}>
                  {busyId === thread.id ? "Sending..." : "Reply"}
                </SecondaryButton>
              ),
            },
          ]}
        />
      </SectionCard>

      <DataTable
        rows={vendors}
        emptyTitle="No vendors match this view"
        emptyMessage="Try different filters or approve vendor registration requests."
        columns={[
          { header: "Vendor / Business", cell: (vendor) => <Strong title={vendor.business_name || "Unnamed vendor"} subtitle={`${vendor.owner_name || "No owner"} - ${maskPhone(vendor.phone)}`} /> },
          { header: "City", cell: (vendor) => vendor.city || "Not set" },
          { header: "Categories", cell: (vendor) => <span className="line-clamp-2 min-w-44">{vendor.service_categories?.join(", ") || "Not set"}</span> },
          { header: "Package", cell: (vendor) => <VendorRowPackageCell vendor={vendor} /> },
          { header: "Credits", cell: (vendor) => <CreditsMeter value={Number(vendor.remaining_credits ?? 0)} total={Number(vendor.total_credits ?? 0)} /> },
          { header: "Active", cell: (vendor) => <StatusBadge value={vendor.is_active === false ? "Inactive" : "Active"} tone={vendor.is_active === false ? "rose" : "emerald"} /> },
          { header: "Status", cell: (vendor) => <StatusBadge value={vendor.status || "Pending"} /> },
          { header: "Assignment", cell: (vendor) => <VendorAssignmentEligibilityBadge eligibility={assignmentEligibilityById.get(vendor.id)} /> },
          { header: "Internal Badges", cell: (vendor) => <VendorInternalBadges visibility={publicVisibilityById.get(vendor.id)} assignmentEligibility={assignmentEligibilityById.get(vendor.id)} /> },
          {
            header: "Actions",
            cell: (vendor) => (
              <ActionMenu
                actions={[
                  { label: "View vendor", onClick: () => setSelected(vendor) },
                  { label: "Approve vendor", onClick: () => void mutate(vendor.id, "status", { action: "approve" }, "Vendor approved.") },
                  { label: "Reject vendor", onClick: () => void mutate(vendor.id, "status", { action: "reject" }, "Vendor rejected.") },
                  { label: "Suspend vendor", onClick: () => void mutate(vendor.id, "status", { action: "suspend" }, "Vendor suspended.") },
                  { label: "Activate vendor", onClick: () => void mutate(vendor.id, "status", { action: "activate" }, "Vendor activated.") },
                  { label: "Deactivate vendor", onClick: () => void mutate(vendor.id, "status", { action: "deactivate" }, "Vendor deactivated.") },
                  { label: "Manage Credits", onClick: () => setCreditsFor(vendor) },
                  { label: "Assign / Update Package", onClick: () => setPackageFor(vendor) },
                  { label: "Mark Package Expired", onClick: () => void mutate(vendor.id, "package", { packageStatus: "expired", packageName: vendor.package_name ?? null }, "Package marked expired.") },
                  { label: "View Credit Log", onClick: () => setLogFor(vendor) },
                ]}
              />
            ),
          },
        ]}
      />

      {selected ? (
        <VendorDetailDrawer
          vendor={selected}
          eligibility={eligibilityById.get(selected.id)}
          publicVisibility={publicVisibilityById.get(selected.id)}
          leadAssignmentEligibility={assignmentEligibilityById.get(selected.id)}
          onClose={() => setSelected(null)}
        />
      ) : null}
      {creditsFor ? <ManageCreditsModal vendor={creditsFor} busy={busyId === creditsFor.id} onClose={() => setCreditsFor(null)} onSave={(body) => mutate(creditsFor.id, "credits", body, "Credits updated.").then((ok) => { if (ok) setCreditsFor(null); })} /> : null}
      {packageFor ? <AssignPackageModal vendor={packageFor} busy={busyId === packageFor.id} onClose={() => setPackageFor(null)} onSave={(body) => mutate(packageFor.id, "package", body, "Package updated.").then((ok) => { if (ok) setPackageFor(null); })} /> : null}
      {logFor ? <CreditLogModal vendor={logFor} notify={notify} onClose={() => setLogFor(null)} /> : null}
    </div>
  );
}

/** Denormalized package status from the vendor row (Phase 13B). */
function vendorRowPackageStatus(vendor: Vendor): string {
  const value = (vendor as Record<string, unknown>).package_status;
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : "none";
}

function isLivePackage(vendor: Vendor): boolean {
  const status = vendorRowPackageStatus(vendor);
  return status === "active" || status === "trial";
}

function VendorEligibilityBadge({ eligibility }: { eligibility?: VendorEligibility }) {
  if (!eligibility) return <StatusBadge value="Unknown" tone="slate" />;
  if (eligibility.eligible) return <StatusBadge value="Eligible for lead preview" tone="emerald" />;
  const reason = eligibility.reasons[0] ?? "Not eligible";
  return (
    <span title={eligibility.reasons.join(" · ")}>
      <StatusBadge value={`Not eligible: ${reason}`} tone="rose" />
    </span>
  );
}

function VendorAssignmentEligibilityBadge({ eligibility }: { eligibility?: VendorLeadAssignmentEligibility }) {
  if (!eligibility) return <StatusBadge value="Unknown" tone="slate" />;
  if (eligibility.eligible) return <StatusBadge value="Paid lead eligible" tone="emerald" />;
  const reason = eligibility.reasons[0] ? assignmentReasonLabel(eligibility.reasons[0]) : "Not eligible for assignment";
  return (
    <span title={eligibility.reasons.map(assignmentReasonLabel).join(" - ")}>
      <StatusBadge value={reason} tone={eligibility.reasons.includes("no_credits") ? "amber" : "rose"} />
    </span>
  );
}

function VendorInternalBadges({
  visibility,
  assignmentEligibility,
}: {
  visibility?: VendorPublicVisibility;
  assignmentEligibility?: VendorLeadAssignmentEligibility;
}) {
  const badges: Array<{ label: string; tone: "emerald" | "amber" | "rose" | "slate" | "blue" }> = [];
  if (visibility?.isPubliclyVisible) badges.push({ label: "Publicly visible", tone: "blue" });
  if (visibility?.visibilityType === "free_visible") badges.push({ label: "Free visible only", tone: "amber" });
  if (assignmentEligibility?.eligible) badges.push({ label: "Paid lead eligible", tone: "emerald" });
  if (assignmentEligibility && !assignmentEligibility.eligible) badges.push({ label: "Not eligible for assignment", tone: "rose" });
  if (assignmentEligibility?.reasons.includes("no_credits")) badges.push({ label: "No credits", tone: "amber" });
  if (assignmentEligibility?.reasons.includes("package_expired")) badges.push({ label: "Package expired", tone: "rose" });

  const unique = badges.filter((badge, index) => badges.findIndex((item) => item.label === badge.label) === index);
  if (unique.length === 0) return <StatusBadge value="Hidden" tone="slate" />;
  return (
    <div className="flex min-w-44 flex-wrap gap-1.5">
      {unique.map((badge) => <StatusBadge key={badge.label} value={badge.label} tone={badge.tone} />)}
    </div>
  );
}

function assignmentReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    free_unpaid_vendor_not_eligible_for_assignment: "Not eligible for assignment",
    package_expired: "Package expired",
    no_credits: "No credits",
    city_mismatch: "City mismatch",
    category_mismatch: "Category mismatch",
    subcategory_mismatch: "Subcategory mismatch",
    vendor_inactive: "Inactive",
    vendor_pending_approval: "Pending approval",
    vendor_suspended: "Suspended",
  };
  return labels[reason] ?? reason;
}

function VendorRowPackageCell({ vendor }: { vendor: Vendor }) {
  const status = vendorRowPackageStatus(vendor);
  const name = (vendor as Record<string, unknown>).package_name;
  return (
    <div className="min-w-40">
      <p className="font-semibold text-slate-950">{typeof name === "string" && name ? name : "No package"}</p>
      <div className="mt-1">
        <StatusBadge value={status} tone={isLivePackage(vendor) ? "emerald" : status === "expired" ? "rose" : "slate"} />
      </div>
    </div>
  );
}

function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Close</button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function ManageCreditsModal({ vendor, busy, onClose, onSave }: { vendor: Vendor; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [mode, setMode] = useState<"add" | "set">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const current = Number(vendor.remaining_credits ?? 0);
  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && (mode === "add" ? true : parsed >= 0);

  return (
    <ModalShell title="Manage Credits" subtitle={vendor.business_name || "Vendor"} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Current credits</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{formatNumber(current)}</p>
        </div>
        <div className="inline-flex gap-2 rounded-xl border border-slate-200 bg-white p-1">
          {(["add", "set"] as const).map((option) => (
            <button key={option} type="button" onClick={() => setMode(option)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${mode === option ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {option === "add" ? "Add credits" : "Set credits"}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">{mode === "add" ? "Credits to add (negative removes)" : "Set credits to"}</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" placeholder="0" className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Reason</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Manual top-up after payment" className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
        </label>
        <p className="text-xs text-slate-500">No credits are ever deducted automatically. This change is logged.</p>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={() => { if (valid) onSave({ mode, amount: parsed, reason: reason.trim() || null }); }}>{busy ? "Saving..." : "Save"}</PrimaryButton>
        </div>
      </div>
    </ModalShell>
  );
}

function AssignPackageModal({ vendor, busy, onClose, onSave }: { vendor: Vendor; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const row = vendor as Record<string, unknown>;
  const [packageName, setPackageName] = useState(typeof row.package_name === "string" ? row.package_name : "");
  const [packageStatus, setPackageStatus] = useState(vendorRowPackageStatus(vendor));
  const [creditsToAdd, setCreditsToAdd] = useState("");
  const [expiresAt, setExpiresAt] = useState(typeof row.package_expires_at === "string" ? String(row.package_expires_at).slice(0, 10) : "");
  const statuses = ["none", "trial", "active", "expired", "cancelled"];

  return (
    <ModalShell title="Assign / Update Package" subtitle={vendor.business_name || "Vendor"} onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Package name</span>
          <input value={packageName} onChange={(event) => setPackageName(event.target.value)} placeholder="e.g. Growth Package" className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Package status</span>
          <select value={packageStatus} onChange={(event) => setPackageStatus(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100">
            {statuses.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Credits to add (optional)</span>
          <input value={creditsToAdd} onChange={(event) => setCreditsToAdd(event.target.value)} type="number" placeholder="0" className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Expiry date (optional)</span>
          <input value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} type="date" className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
        </label>
        <p className="text-xs text-slate-500">Updating the package never notifies the vendor and never triggers n8n.</p>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={() => onSave({ packageName: packageName.trim() || null, packageStatus, creditsToAdd: Number(creditsToAdd) || 0, packageExpiresAt: expiresAt || null })}>{busy ? "Saving..." : "Save"}</PrimaryButton>
        </div>
      </div>
    </ModalShell>
  );
}

function CreditLogModal({ vendor, notify, onClose }: { vendor: Vendor; notify: (message: string, tone?: "success" | "error" | "info") => void; onClose: () => void }) {
  const [rows, setRows] = useState<Array<Record<string, any>> | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/admin/vendors/${vendor.id}/credit-log`, { cache: "no-store" });
        const data = (await res.json()) as { ok?: boolean; log?: Array<Record<string, any>>; error?: string };
        if (!active) return;
        if (!res.ok || !data?.ok) {
          notify(data?.error ?? "Could not load the credit log.", "error");
          setRows([]);
          return;
        }
        setRows(data.log ?? []);
      } catch {
        if (active) { notify("Could not load the credit log.", "error"); setRows([]); }
      }
    })();
    return () => { active = false; };
  }, [vendor.id, notify]);

  return (
    <ModalShell title="Credit Log" subtitle={vendor.business_name || "Vendor"} onClose={onClose}>
      {rows === null ? (
        <p className="text-sm text-slate-500">Loading credit log...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No credit changes recorded yet for this vendor.</p>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {rows.map((row, index) => (
            <div key={row.id ?? index} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <StatusBadge value={String(row.changeType ?? "change")} tone={Number(row.creditsDelta ?? 0) >= 0 ? "emerald" : "rose"} />
                <span className="font-semibold text-slate-900">{Number(row.creditsBefore ?? 0)} → {Number(row.creditsAfter ?? 0)}</span>
              </div>
              {row.reason ? <p className="mt-1 text-xs text-slate-500">{row.reason}</p> : null}
              <p className="mt-1 text-xs text-slate-400">{row.updatedBy ? `${row.updatedBy} · ` : ""}{formatDate(row.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
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

function CategoriesPage({ data, notify }: { data: Snapshot; notify: (message: string, tone?: "success" | "error" | "info") => void }) {
  // Phase 14C governance: full admin-only category/subcategory management.
  return <CategoryManager categories={data.categories} notify={notify} />;
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

function PackageRowCard({ item, notify, ask }: { item: PackageRow; notify: (message: string) => void; ask: any }) {
  const features = packageFeatures(item);

  return (
    <article className="qf-card-shadow qf-card-hover rounded-xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-emerald-200">
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
    <article className="qf-card-shadow qf-card-hover rounded-xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-emerald-200">
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
    <article className="qf-card-shadow qf-card-hover rounded-xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-emerald-200">
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

function LeadDistributionPage({
  data,
  notify,
  runAction,
}: {
  data: Snapshot;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  runAction: (title: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [tab, setTab] = useState("Auto Matching & Queue");
  const tabs = ["Auto Matching & Queue", "Manual Assignment", "Requirement Groups", "Matching Audit", "Delivery Logs", "Preview Messages", "Rules & Settings", "Assignment Approval Preview", "Recent Assignments", "Failed Assignments", "Vendor Eligibility Checker", "Distribution Logs"];

  return (
    <div className="space-y-5">
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === "Auto Matching & Queue" ? (
        <AutoMatchingQueuePanel data={data} notify={notify} runAction={runAction} />
      ) : tab === "Manual Assignment" ? (
        <ManualLeadAssignmentPanel data={data} notify={notify} />
      ) : tab === "Requirement Groups" ? (
        <RequirementGroupsPanel notify={notify} />
      ) : tab === "Matching Audit" ? (
        <MatchingRunsAuditPanel data={data} notify={notify} />
      ) : tab === "Delivery Logs" ? (
        <DeliveryLogsAuditPanel data={data} />
      ) : tab === "Preview Messages" ? (
        <PreviewMessagesPanel data={data} />
      ) : tab === "Assignment Approval Preview" ? (
        <LeadAssignmentApprovalControl leads={data.leads} notify={notify} />
      ) : tab === "Rules & Settings" ? (
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
        <RecentAssignmentsPanel notify={notify} />
      ) : tab === "Failed Assignments" ? (
        <FailedAssignmentsPanel notify={notify} />
      ) : tab === "Vendor Eligibility Checker" ? (
        <EligibilityChecker data={data} notify={notify} />
      ) : (
        <DistributionLogsPanel notify={notify} />
      )}
    </div>
  );
}

/** Phase 14B: active admin-managed city names — the single source of truth. */
function AutoMatchingQueuePanel({
  data,
  notify,
  runAction,
}: {
  data: Snapshot;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  runAction: (title: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const queuedRows = data.leadAssignmentQueue ?? [];
  const autoLogs = data.autoAssignmentLogs ?? [];
  const freeInterests = data.freeVendorInterests ?? [];
  const unassignedLeads = data.leads.filter(isUnassignedLead).slice(0, 8);
  const matchedPreviewCount = queuedRows.filter((row) => row.queue_status === "matched_preview").length;
  const suggestedCount = autoLogs.filter((row) => row.status === "auto_suggested").length;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Queued Leads" value={formatNumber(queuedRows.length)} helper="Awaiting paid vendor supply" icon="distribution" tone="amber" />
        <StatCard label="Matched Preview" value={formatNumber(matchedPreviewCount)} helper="Suggestions ready, not assigned" icon="vendors" tone="emerald" />
        <StatCard label="Auto Suggestions" value={formatNumber(suggestedCount)} helper="Preview logs only" icon="reports" tone="indigo" />
        <StatCard label="Free Vendor Interests" value={formatNumber(freeInterests.length)} helper="Masked client contact only" icon="notifications" tone="slate" />
      </section>

      <SectionCard title="Queued Leads" description="Recheck is manual in this phase. Matched previews are not final assignments.">
        <DataTable
          rows={queuedRows}
          emptyTitle="No queued leads"
          emptyMessage="Leads will appear here when paid-only preview matching cannot find enough eligible vendors."
          columns={[
            { header: "Lead", cell: (row) => <Strong title={leadName(data.leads, row.lead_id)} subtitle={shortId(row.lead_id)} /> },
            { header: "Reason", cell: (row) => <StatusBadge value={row.queue_reason || "queued"} tone={row.queue_status === "matched_preview" ? "emerald" : "amber"} /> },
            { header: "Eligible Paid", cell: (row) => `${formatNumber(row.eligible_vendor_count ?? 0)} / ${formatNumber(row.required_vendor_count ?? 1)}` },
            { header: "Selected Preview", cell: (row) => <span className="line-clamp-2 min-w-44 text-xs text-slate-500">{selectedVendorNames(row.selected_vendor_ids ?? [], data.vendors)}</span> },
            { header: "Attempts", cell: (row) => formatNumber(row.matching_attempt_count ?? 0) },
            { header: "Last Checked", cell: (row) => formatDate(row.last_checked_at) },
            {
              header: "Actions",
              cell: (row) => (
                <ActionMenu
                  actions={[
                    { label: "Recheck paid vendors", onClick: () => runAction("Queue recheck", () => adminRecheckLeadAssignmentQueue(row.id)) },
                    { label: "Copy lead id", onClick: () => notify(`Lead id: ${row.lead_id}`) },
                  ]}
                />
              ),
            },
          ]}
        />
      </SectionCard>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard title="Run Preview For Unassigned Leads" description="Preview-only. No assignment, vendor notification, credit deduction, or WhatsApp.">
          <DataTable
            rows={unassignedLeads}
            emptyTitle="No unassigned leads"
            emptyMessage="Open unassigned leads will appear here for manual preview."
            columns={[
              { header: "Lead", cell: (lead) => <Strong title={lead.name || "Unnamed lead"} subtitle={maskPhone(lead.phone)} /> },
              { header: "Requirement", cell: (lead) => <Strong title={lead.service_required || lead.category || "Not set"} subtitle={lead.city || "City not set"} /> },
              { header: "Created", cell: (lead) => formatDate(lead.created_at) },
              { header: "Action", cell: (lead) => <SecondaryButton onClick={() => runAction("Auto match preview", () => adminRunAutoMatchPreview(lead.id))}>Preview</SecondaryButton> },
            ]}
          />
        </SectionCard>

        <SectionCard title="Preview Logs" description="Records from lead_auto_assignment_logs. Suggestions are not final assignments.">
          <DataTable
            rows={autoLogs.slice(0, 8)}
            emptyTitle="No preview logs"
            emptyMessage="Auto matching preview runs will be logged after the migration is applied."
            columns={[
              { header: "Lead", cell: (row) => <Strong title={leadName(data.leads, row.lead_id)} subtitle={shortId(row.lead_id)} /> },
              { header: "Status", cell: (row) => <StatusBadge value={row.status || "preview"} tone={row.status === "auto_suggested" ? "emerald" : "amber"} /> },
              { header: "Eligible", cell: (row) => formatNumber(row.eligible_vendor_count ?? 0) },
              { header: "Selected", cell: (row) => <span className="line-clamp-2 min-w-36 text-xs text-slate-500">{selectedVendorNames(row.selected_vendor_ids ?? [], data.vendors)}</span> },
              { header: "Date", cell: (row) => formatDate(row.created_at) },
            ]}
          />
        </SectionCard>
      </section>

      <SectionCard title="Free Vendor Interest Capture" description="Client phones are masked/hashed. No vendor receives client contact in this phase.">
        <DataTable
          rows={freeInterests.slice(0, 10)}
          emptyTitle="No free vendor interests"
          emptyMessage="Requests from gated free vendor profiles will appear here after capture."
          columns={[
            { header: "Vendor", cell: (row) => <Strong title={vendorName(data.vendors, row.vendor_id)} subtitle={shortId(row.vendor_id)} /> },
            { header: "Client", cell: (row) => <Strong title={row.client_name || "Client"} subtitle={row.client_phone_masked || "masked"} /> },
            { header: "Requirement", cell: (row) => <Strong title={row.category || "Not set"} subtitle={[row.area, row.city].filter(Boolean).join(", ") || "Area not set"} /> },
            { header: "Status", cell: (row) => <StatusBadge value={row.status || "interest_captured"} /> },
            { header: "n8n Preview", cell: (row) => <StatusBadge value={row.n8n_preview_called ? "Preview called" : "Mock only"} tone={row.n8n_preview_called ? "blue" : "slate"} /> },
            { header: "Created", cell: (row) => formatDate(row.created_at) },
            {
              header: "Actions",
              cell: (row) => (
                <ActionMenu
                  actions={[
                    { label: "Mark reviewed", onClick: () => runAction("Interest status update", () => adminMarkFreeVendorInterestStatus(row.id, "reviewed")) },
                    { label: "Mark team followed up", onClick: () => runAction("Interest status update", () => adminMarkFreeVendorInterestStatus(row.id, "team_followed_up")) },
                  ]}
                />
              ),
            },
          ]}
        />
      </SectionCard>
    </div>
  );
}

function activeCityNames(cities: City[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cities) {
    if (c.is_active !== true) continue;
    const name = (c.name ?? "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

/**
 * Phase 14C: selectable active category names (the single source of truth).
 * Subcategories + childless top-level categories; a parent that has active
 * subcategories is a grouping, not a selectable service, so it is excluded.
 * (On a flat schema with no parent_id, every active category is selectable.)
 */
function activeCategoryNames(categories: Category[]): string[] {
  const activeParentIds = new Set(
    categories.filter((c) => c.is_active === true && c.parent_id).map((c) => c.parent_id as string),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of categories) {
    if (c.is_active !== true) continue;
    if (activeParentIds.has(c.id)) continue;
    const name = (c.name ?? "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

function marketplaceSettingsObject(rows?: MarketplaceRuntimeSetting[]): MarketplaceSettingsView {
  const settings = { ...marketplaceSettingDefaults };
  (rows ?? []).forEach((row) => {
    const key = row.key as keyof MarketplaceSettingsView;
    if (!(key in settings)) return;
    const fallback = settings[key];
    if (typeof fallback === "boolean") {
      settings[key] = readBooleanValue(row.value, fallback) as never;
    } else if (typeof fallback === "number") {
      const value = Number(row.value);
      settings[key] = (Number.isFinite(value) ? value : fallback) as never;
    } else if (key === "auto_assignment_mode") {
      const value = String(row.value ?? "").trim();
      settings[key] = (value === "off" || value === "preview" || value === "auto_suggest" ? value : fallback) as never;
    }
  });
  return settings;
}

function readBooleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return fallback;
}

function selectedVendorNames(ids: string[] | null | undefined, vendors: Vendor[]): string {
  const list = Array.isArray(ids) ? ids : [];
  if (list.length === 0) return "No vendor selected";
  return list.map((id) => vendorName(vendors, id)).join(", ");
}

function EligibilityChecker({ data, notify }: { data: Snapshot; notify: (message: string) => void }) {
  // Phase 14B/14C: city + category options come ONLY from admin-managed active
  // cities (public.cities) and active categories (public.service_categories).
  const activeCities = useMemo(() => activeCityNames(data.cities), [data.cities]);
  const activeCategories = useMemo(() => activeCategoryNames(data.categories), [data.categories]);
  const [city, setCity] = useState(() => activeCities[0] ?? "");
  const [category, setCategory] = useState(() => activeCategories[0] ?? "");
  useEffect(() => {
    if (activeCities.length && !activeCities.includes(city)) setCity(activeCities[0]);
  }, [activeCities, city]);
  useEffect(() => {
    if (activeCategories.length && !activeCategories.includes(category)) setCategory(activeCategories[0]);
  }, [activeCategories, category]);
  // Phase 14: show full eligibility reasoning for every vendor in the selected
  // city using the SAME shared helper the Lead Assignment Approval Preview uses.
  const vendorsInCity = useMemo(
    () =>
      data.vendors
        .filter((vendor) => String(vendor.city ?? "").trim().toLowerCase() === city.trim().toLowerCase())
        .map((vendor) => ({
          vendor,
          eligibility: evaluateVendorEligibility(vendor as Record<string, unknown>, { leadCity: city, leadCategory: category }),
        })),
    [data.vendors, city, category],
  );
  const eligibleCount = vendorsInCity.filter((row) => row.eligibility.eligible).length;

  return (
    <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Eligibility Checker</h2>
        <p className="mt-2 text-sm text-slate-500">Uses the shared vendorEligibility helper — the same logic as the Lead Assignment Approval Preview.</p>
        <div className="mt-5 space-y-3">
          {activeCities.length === 0 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No active cities configured. Add cities from Admin → Cities & Locations.</p>
          ) : (
            <SelectFilter label="City" value={city} onChange={setCity} options={activeCities} />
          )}
          {activeCategories.length === 0 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No active categories configured. Add categories from Admin → Categories.</p>
          ) : (
            <SelectFilter label="Category" value={category} onChange={setCategory} options={activeCategories} />
          )}
          <PrimaryButton onClick={() => notify(`${eligibleCount} eligible vendor(s) in ${city || "—"} for ${category || "—"}.`)}>Check Vendors</PrimaryButton>
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <p className="font-semibold text-slate-900">{eligibleCount} eligible</p>
          <p className="mt-1 text-slate-500">of {vendorsInCity.length} vendor(s) in {city}</p>
        </div>
      </div>
      <DataTable
        rows={vendorsInCity}
        emptyTitle="No vendors in this city"
        emptyMessage="No vendor records match the selected city. Eligibility requires approved + active + active package + credits, and (for a lead) city + category match."
        columns={[
          { header: "Vendor", cell: (row) => row.vendor.business_name || "Unnamed vendor" },
          { header: "Eligible", cell: (row) => <StatusBadge value={row.eligibility.eligible ? "Eligible" : "Not eligible"} tone={row.eligibility.eligible ? "emerald" : "rose"} /> },
          { header: "Reasons", cell: (row) => <span className="line-clamp-2 min-w-44 text-xs text-slate-500">{row.eligibility.reasons.length ? row.eligibility.reasons.join(", ") : "All checks passed"}</span> },
          { header: "Status", cell: (row) => <StatusBadge value={row.eligibility.status} /> },
          { header: "Active", cell: (row) => <StatusBadge value={row.eligibility.isActive ? "Active" : "Inactive"} tone={row.eligibility.isActive ? "emerald" : "rose"} /> },
          { header: "Package", cell: (row) => <StatusBadge value={row.eligibility.packageStatus} tone={row.eligibility.packageStatus === "active" || row.eligibility.packageStatus === "trial" ? "emerald" : "slate"} /> },
          { header: "Credits", cell: (row) => formatNumber(row.eligibility.credits) },
          { header: "City match", cell: (row) => <StatusBadge value={row.eligibility.cityMatch ? "Yes" : "No"} tone={row.eligibility.cityMatch ? "emerald" : "rose"} /> },
          { header: "Category match", cell: (row) => <StatusBadge value={row.eligibility.categoryMatch ? "Yes" : "No"} tone={row.eligibility.categoryMatch ? "emerald" : "rose"} /> },
        ]}
      />
    </section>
  );
}

function SubscriptionsPage({ data, notify }: { data: Snapshot; notify: (message: string) => void }) {
  const packageOrders = data.vendorPackageOrders ?? [];
  const notActivatedOrders = packageOrders.filter((order) => String(order.activation_status ?? "").toLowerCase() !== "activated");

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Low Balance" value={formatNumber(data.stats.low_balance_vendors)} helper="At or below threshold" icon="subscriptions" tone="amber" />
        <StatCard label="Package Orders" value={formatNumber(packageOrders.length)} helper="Audit only" icon="payments" tone="indigo" />
        <StatCard label="Expired" value={formatNumber(data.stats.expired_vendors)} helper="Stopped from assignment" icon="packages" tone="rose" />
        <StatCard label="Not Activated" value={formatNumber(notActivatedOrders.length)} helper="Awaiting verified payment" icon="notifications" tone="amber" />
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

      <SectionCard title="Package Order Audit" description="Vendor-created order intents. Audit only: no approve/reject or activation controls.">
        <DataTable
          rows={packageOrders}
          emptyTitle="No package orders found"
          emptyMessage="Package order audit will appear here after package order tracking is enabled."
          columns={[
            { header: "Order", cell: (row) => <Strong title={shortId(row.id)} subtitle={formatDate(row.created_at)} /> },
            { header: "Vendor", cell: (row) => vendorName(data.vendors, row.vendor_id) },
            { header: "Package", cell: (row) => row.package_name || packageName(data.packages, row.package_id) },
            { header: "Amount", cell: (row) => <span className="font-semibold text-slate-950">{formatINR(row.package_price)}</span> },
            { header: "Credits", cell: (row) => formatNumber(row.credits_included ?? 0) },
            { header: "Payment", cell: (row) => <StatusBadge value={row.payment_status || "not_started"} tone="amber" /> },
            { header: "Activation", cell: (row) => <StatusBadge value={row.activation_status || "not_activated"} tone="slate" /> },
            { header: "Provider", cell: (row) => row.payment_provider || "not_connected" },
            {
              header: "Provider Refs",
              cell: (row) => (
                <div className="min-w-36 text-xs text-slate-500">
                  <p>Order: {row.provider_order_id || "—"}</p>
                  <p className="mt-0.5">Payment: {row.provider_payment_id || "—"}</p>
                </div>
              ),
            },
          ]}
        />
      </SectionCard>
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

type MarketplaceSettingsView = {
  show_free_vendors_publicly: boolean;
  allow_free_vendor_interest_capture: boolean;
  notify_free_vendor_recharge_interest: boolean;
  allow_trial_vendors_for_assignment: boolean;
  minimum_paid_vendors_required_for_auto_assignment: number;
  max_vendors_per_lead: number;
  auto_assignment_mode: "off" | "preview" | "auto_suggest";
};

const marketplaceSettingDefaults: MarketplaceSettingsView = {
  show_free_vendors_publicly: true,
  allow_free_vendor_interest_capture: true,
  notify_free_vendor_recharge_interest: true,
  allow_trial_vendors_for_assignment: true,
  minimum_paid_vendors_required_for_auto_assignment: 1,
  max_vendors_per_lead: 3,
  auto_assignment_mode: "preview",
};

function MarketplaceRuntimeSettingsPanel({
  settingsRows,
  runAction,
}: {
  settingsRows: MarketplaceRuntimeSetting[];
  runAction: (title: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [settings, setSettings] = useState(() => marketplaceSettingsObject(settingsRows));
  useEffect(() => {
    setSettings(marketplaceSettingsObject(settingsRows));
  }, [settingsRows]);

  function save<K extends keyof MarketplaceSettingsView>(key: K, value: MarketplaceSettingsView[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    runAction("Marketplace setting update", () => adminUpdateMarketplaceRuntimeSetting(key, value));
  }

  return (
    <SectionCard title="Paid-Only Auto Matching Controls" description="These switches separate public visibility from paid/trial lead assignment. Changes are stored in marketplace_runtime_settings.">
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="grid gap-3 md:grid-cols-2">
          <MarketplaceToggle
            label="Show approved free vendors publicly"
            checked={settings.show_free_vendors_publicly}
            onChange={(value) => save("show_free_vendors_publicly", value)}
          />
          <MarketplaceToggle
            label="Allow free vendor interest capture"
            checked={settings.allow_free_vendor_interest_capture}
            onChange={(value) => save("allow_free_vendor_interest_capture", value)}
          />
          <MarketplaceToggle
            label="Notify free vendor to recharge on interest"
            checked={settings.notify_free_vendor_recharge_interest}
            onChange={(value) => save("notify_free_vendor_recharge_interest", value)}
          />
          <MarketplaceToggle
            label="Allow trial vendors for assignment"
            checked={settings.allow_trial_vendors_for_assignment}
            onChange={(value) => save("allow_trial_vendors_for_assignment", value)}
          />
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase text-slate-500">Minimum paid vendors required</span>
            <input
              type="number"
              min={1}
              value={settings.minimum_paid_vendors_required_for_auto_assignment}
              onChange={(event) => save("minimum_paid_vendors_required_for_auto_assignment", Math.max(1, Number(event.target.value) || 1))}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase text-slate-500">Max vendors per lead</span>
            <input
              type="number"
              min={1}
              max={3}
              value={settings.max_vendors_per_lead}
              onChange={(event) => save("max_vendors_per_lead", Math.max(1, Math.min(3, Number(event.target.value) || 1)))}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase text-slate-500">Auto assignment mode</span>
            <select
              value={settings.auto_assignment_mode}
              onChange={(event) => save("auto_assignment_mode", event.target.value as MarketplaceSettingsView["auto_assignment_mode"])}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
            >
              <option value="off">off</option>
              <option value="preview">preview</option>
              <option value="auto_suggest">auto_suggest</option>
            </select>
          </label>
        </div>
      </div>
    </SectionCard>
  );
}

function MarketplaceToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/30"
      aria-pressed={checked}
    >
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      <span className={`flex h-6 w-11 shrink-0 items-center rounded-full p-1 transition ${checked ? "bg-emerald-500" : "bg-slate-200"}`}>
        <span className={`h-4 w-4 rounded-full bg-white shadow transition ${checked ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

function SettingsPage({
  data,
  notify,
  runAction,
}: {
  data: Snapshot;
  notify: (message: string) => void;
  runAction: (title: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const groups = ["Business Settings", "Lead Settings", "Vendor Settings", "Distribution Settings", "AI Settings", "Automation Settings", "Security Settings"];
  return (
    <div className="space-y-5">
      <MarketplaceRuntimeSettingsPanel settingsRows={data.marketplaceSettings ?? []} runAction={runAction} />
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
    </div>
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

function VendorDetailDrawer({
  vendor,
  eligibility,
  publicVisibility,
  leadAssignmentEligibility,
  onClose,
}: {
  vendor: Vendor;
  eligibility?: VendorEligibility;
  publicVisibility?: VendorPublicVisibility;
  leadAssignmentEligibility?: VendorLeadAssignmentEligibility;
  onClose: () => void;
}) {
  const row = vendor as Record<string, unknown>;
  return (
    <Drawer title={vendor.business_name || "Vendor details"} subtitle={`Vendor ID ${shortId(vendor.id)}`} onClose={onClose}>
      <div className="space-y-5">
        <InfoGrid rows={[
          ["Owner", vendor.owner_name || "Not provided"],
          ["Phone", vendor.phone || "Not provided"],
          ["Email", vendor.email || "Not provided"],
          ["City", vendor.city || "Not provided"],
          ["Categories", vendor.service_categories?.join(", ") || "Not provided"],
          ["Areas", vendor.areas_covered?.join(", ") || "Not provided"],
          ["Leads Remaining", formatNumber(vendor.remaining_credits)],
          ["Status", <StatusBadge key="status" value={vendor.status || "Pending"} />],
          ["Active", <StatusBadge key="active" value={vendor.is_active === false ? "Inactive" : "Active"} tone={vendor.is_active === false ? "rose" : "emerald"} />],
          ["Package", `${typeof row.package_name === "string" && row.package_name ? `${row.package_name} · ` : ""}${vendorRowPackageStatus(vendor)}`],
        ]} />
        {eligibility ? (
          <article className={`rounded-2xl border p-4 ${eligibility.eligible ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-950">Lead preview eligibility</h3>
              <VendorEligibilityBadge eligibility={eligibility} />
            </div>
            {eligibility.eligible ? (
              <p className="mt-2 text-sm text-emerald-800">This vendor will appear as selectable in the Lead Assignment Approval Preview when city and category match.</p>
            ) : (
              <p className="mt-2 text-sm text-rose-800">Not eligible: {eligibility.reasons.join(", ")}.</p>
            )}
          </article>
        ) : null}
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Phase 25A internal status</h3>
              <p className="mt-1 text-xs text-slate-500">Public visibility is separate from paid lead assignment.</p>
            </div>
            <VendorInternalBadges visibility={publicVisibility} assignmentEligibility={leadAssignmentEligibility} />
          </div>
          <div className="mt-3 grid gap-2 text-xs text-slate-600">
            <p>Visibility: {publicVisibility?.visibilityType ?? "hidden"}</p>
            <p>Assignment: {leadAssignmentEligibility?.eligible ? "eligible" : "not eligible"}</p>
            {leadAssignmentEligibility?.reasons.length ? (
              <p>Reasons: {leadAssignmentEligibility.reasons.map(assignmentReasonLabel).join(", ")}</p>
            ) : null}
          </div>
        </article>
      </div>
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

function SupportThreadMessages({ messages }: { messages: VendorSupportMessage[] }) {
  const visible = messages.slice(-3);
  if (!visible.length) return <span className="text-xs text-slate-500">No messages yet</span>;
  return (
    <div className="grid min-w-72 gap-2 text-xs text-slate-600">
      {visible.map((message) => (
        <div key={message.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="font-semibold text-slate-800">
            {message.sender_type === "admin" ? "Admin" : "Vendor"} - {formatDate(message.created_at)}
          </p>
          <p className="mt-1 line-clamp-3">{message.message || "No message"}</p>
        </div>
      ))}
    </div>
  );
}

function ProfileChangeSnapshot({ value }: { value?: Record<string, unknown> | null }) {
  const entries = Object.entries(value ?? {}).slice(0, 6);
  if (!entries.length) return <span className="text-xs text-slate-500">No values</span>;
  return (
    <div className="grid min-w-64 gap-1 text-xs text-slate-600">
      {entries.map(([key, item]) => (
        <p key={key} className="line-clamp-2">
          <span className="font-semibold text-slate-800">{profileChangeLabel(key)}:</span>{" "}
          {profileChangeValue(item)}
        </p>
      ))}
    </div>
  );
}

function profileChangeLabel(key: string) {
  return key
    .replace(/^public_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function profileChangeValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "Not set");
}
