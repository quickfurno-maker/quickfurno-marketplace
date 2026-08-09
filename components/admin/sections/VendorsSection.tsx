"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminApproveVendorProfileChangeRequest,
  adminRejectVendorProfileChangeRequest,
  adminReplyVendorSupportThread,
} from "@/app/actions";
import { evaluateVendorEligibility, evaluateVendorLeadAssignmentEligibility, type VendorEligibility, type VendorLeadAssignmentEligibility } from "@/lib/vendors/vendorEligibility";
import { getVendorPublicVisibility, type VendorPublicVisibility } from "@/lib/vendors/vendorVisibility";
import {
  ActionMenu,
  DataTable,
  Drawer,
  InfoGrid,
  PrimaryButton,
  SecondaryButton,
  SelectFilter,
  SectionCard,
  StatCard,
  StatusBadge,
  Toolbar,
} from "../AdminPrimitives";
import { type Category, type City, type Lead, type Snapshot, type Vendor, type VendorSupportMessage } from "../adminTypes";
import {
  formatDate,
  formatNumber,
  includesQuery,
  maskPhone,
  packageName,
  shortId,
  uniqueOptions,
  vendorName,
} from "../adminUtils";
import { ModalShell, CreditsMeter, Strong } from "./shared";
import { marketplaceSettingsObject } from "./SettingsSection";
import { activeCityNames, activeCategoryNames } from "./LeadDistributionSection";

export function VendorsPage({ data, notify }: { data: Snapshot; notify: (message: string, tone?: "success" | "error" | "info") => void }) {
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
export function vendorRowPackageStatus(vendor: Vendor): string {
  const value = (vendor as Record<string, unknown>).package_status;
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : "none";
}

export function isLivePackage(vendor: Vendor): boolean {
  const status = vendorRowPackageStatus(vendor);
  return status === "active" || status === "trial";
}

export function VendorEligibilityBadge({ eligibility }: { eligibility?: VendorEligibility }) {
  if (!eligibility) return <StatusBadge value="Unknown" tone="slate" />;
  if (eligibility.eligible) return <StatusBadge value="Eligible for lead preview" tone="emerald" />;
  const reason = eligibility.reasons[0] ?? "Not eligible";
  return (
    <span title={eligibility.reasons.join(" · ")}>
      <StatusBadge value={`Not eligible: ${reason}`} tone="rose" />
    </span>
  );
}

export function VendorAssignmentEligibilityBadge({ eligibility }: { eligibility?: VendorLeadAssignmentEligibility }) {
  if (!eligibility) return <StatusBadge value="Unknown" tone="slate" />;
  if (eligibility.eligible) return <StatusBadge value="Paid lead eligible" tone="emerald" />;
  const reason = eligibility.reasons[0] ? assignmentReasonLabel(eligibility.reasons[0]) : "Not eligible for assignment";
  return (
    <span title={eligibility.reasons.map(assignmentReasonLabel).join(" - ")}>
      <StatusBadge value={reason} tone={eligibility.reasons.includes("no_credits") ? "amber" : "rose"} />
    </span>
  );
}

export function VendorInternalBadges({
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

export function assignmentReasonLabel(reason: string): string {
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

export function VendorRowPackageCell({ vendor }: { vendor: Vendor }) {
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


export function ManageCreditsModal({ vendor, busy, onClose, onSave }: { vendor: Vendor; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
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

export function AssignPackageModal({ vendor, busy, onClose, onSave }: { vendor: Vendor; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
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

export function CreditLogModal({ vendor, notify, onClose }: { vendor: Vendor; notify: (message: string, tone?: "success" | "error" | "info") => void; onClose: () => void }) {
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


export function VendorDetailDrawer({
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


export function SupportThreadMessages({ messages }: { messages: VendorSupportMessage[] }) {
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

export function ProfileChangeSnapshot({ value }: { value?: Record<string, unknown> | null }) {
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

export function profileChangeLabel(key: string) {
  return key
    .replace(/^public_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function profileChangeValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "Not set");
}
