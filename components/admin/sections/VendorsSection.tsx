"use client";

// C-PERF1: the vendor directory is server-paged (20/page, URL-backed state).
// Search and the city/category/status/package filters run in the database
// over ALL vendors; totals are live count queries. The eligibility filter is
// the one exception — eligibility is computed by the shared client helper
// (never duplicated into SQL, per policy), so it refines the CURRENT PAGE
// only and the UI says so.

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  Toast,
  Toolbar,
} from "../AdminPrimitives";
import { Pagination } from "../Pagination";
import { type Lead, type Vendor, type VendorSupportMessage, type VendorsDirectoryData } from "../adminTypes";
import {
  formatDate,
  formatNumber,
  maskPhone,
  packageName,
  shortId,
  vendorName,
} from "../adminUtils";
import { ModalShell, CreditsMeter, Strong } from "./shared";
import { marketplaceSettingsObject } from "./SettingsSection";

const VENDOR_FILTER_KEYS = ["search", "city", "category", "status", "package"] as const;
type VendorFilterKey = (typeof VENDOR_FILTER_KEYS)[number];

export function VendorsPage({ data, error }: { data: VendorsDirectoryData | null; error?: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const [eligibility, setEligibility] = useState("All");
  const [selected, setSelected] = useState<Vendor | null>(null);
  const [creditsFor, setCreditsFor] = useState<Vendor | null>(null);
  const [packageFor, setPackageFor] = useState<Vendor | null>(null);
  const [logFor, setLogFor] = useState<Vendor | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const result = data?.result ?? { rows: [], page: 1, pageSize: 20, total: 0 };
  const totals = data?.totals ?? { all: 0, approved: 0, pending: 0, lowBalance: 0 };
  const pageRows = result.rows;
  const marketplaceSettings = useMemo(() => marketplaceSettingsObject(data?.marketplaceSettings ?? []), [data?.marketplaceSettings]);

  const notify = useCallback((message: string, tone: "success" | "error" | "info" = "info") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  // URL-backed filter state (server-side semantics).
  const params = useMemo(() => {
    const out: Record<VendorFilterKey, string> = { search: "", city: "All", category: "All", status: "All", package: "All" };
    VENDOR_FILTER_KEYS.forEach((key) => {
      const value = searchParams.get(key);
      if (value) out[key] = value;
    });
    return out;
  }, [searchParams]);
  const [searchDraft, setSearchDraft] = useState(params.search);
  useEffect(() => setSearchDraft(params.search), [params.search]);

  const navigate = useCallback(
    (updates: Record<string, string | number | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === "" || value === "All" || (key === "page" && Number(value) <= 1)) next.delete(key);
        else next.set(key, String(value));
      });
      startTransition(() => {
        router.replace(`${pathname}${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
      });
    },
    [router, pathname, searchParams],
  );
  const setFilter = useCallback((key: VendorFilterKey, value: string) => navigate({ [key]: value, page: null }), [navigate]);

  useEffect(() => {
    if (searchDraft === params.search) return;
    const timer = window.setTimeout(() => setFilter("search", searchDraft), 350);
    return () => window.clearTimeout(timer);
  }, [searchDraft, params.search, setFilter]);

  // Vendor-name pool for panels/drawers: current page + thin panel rows.
  const vendorPool = useMemo(() => {
    const map = new Map<string, Vendor>();
    [...pageRows, ...(data?.panelVendors ?? [])].forEach((vendor) => map.set(vendor.id, vendor));
    return [...map.values()];
  }, [pageRows, data?.panelVendors]);

  // Phase 13B: ONE shared eligibility helper, same as the Lead Assignment
  // Approval Preview, so the two surfaces always agree. Evaluated for the
  // rows on THIS page (display + page-scoped refinement only).
  const eligibilityById = useMemo(() => {
    const map = new Map<string, VendorEligibility>();
    pageRows.forEach((vendor) => map.set(vendor.id, evaluateVendorEligibility(vendor as Record<string, unknown>)));
    return map;
  }, [pageRows]);
  const assignmentEligibilityById = useMemo(() => {
    const map = new Map<string, VendorLeadAssignmentEligibility>();
    pageRows.forEach((vendor) => map.set(vendor.id, evaluateVendorLeadAssignmentEligibility(vendor as Record<string, unknown>, null, marketplaceSettings)));
    return map;
  }, [pageRows, marketplaceSettings]);
  const publicVisibilityById = useMemo(() => {
    const map = new Map<string, VendorPublicVisibility>();
    pageRows.forEach((vendor) => map.set(vendor.id, getVendorPublicVisibility(vendor as Record<string, unknown>, marketplaceSettings)));
    return map;
  }, [pageRows, marketplaceSettings]);

  // Eligibility is the documented page-scoped refinement.
  const vendors = useMemo(
    () =>
      pageRows.filter((vendor) => {
        if (eligibility === "All") return true;
        const isEligible = assignmentEligibilityById.get(vendor.id)?.eligible ?? false;
        return eligibility === "Eligible" ? isEligible : !isEligible;
      }),
    [pageRows, assignmentEligibilityById, eligibility],
  );

  const profileChangeRequests = data?.profileChangeRequests ?? [];
  const supportThreads = data?.supportThreads ?? [];
  const supportMessagesByThread = useMemo(() => {
    const map = new Map<string, VendorSupportMessage[]>();
    (data?.supportMessages ?? []).forEach((message) => {
      if (!message.thread_id) return;
      const current = map.get(message.thread_id) ?? [];
      current.push(message);
      map.set(message.thread_id, current);
    });
    return map;
  }, [data?.supportMessages]);

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
    <div className="space-y-5" aria-busy={isPending}>
      {error ? (
        <div className="rounded-[var(--qfa-radius)] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          Vendors could not be loaded: {error}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Vendors" value={formatNumber(totals.all)} helper="All vendor records (live count)" icon="vendors" />
        <StatCard label="Approved" value={formatNumber(totals.approved)} helper="Verified vendors (live count)" icon="vendors" tone="emerald" />
        <StatCard label="Pending Approval" value={formatNumber(totals.pending)} helper="Awaiting verification (live count)" icon="vendors" tone="indigo" />
        <StatCard label="Low Credits" value={formatNumber(totals.lowBalance)} helper="Renewal risk (live count)" icon="notifications" tone="amber" />
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
        query={searchDraft}
        setQuery={setSearchDraft}
        placeholder="Search vendor, owner, phone, city..."
        filters={
          <>
            <SelectFilter label="City" value={params.city} onChange={(v) => setFilter("city", v)} options={["All", ...(data?.filterOptions.cities ?? [])]} />
            <SelectFilter label="Category" value={params.category} onChange={(v) => setFilter("category", v)} options={["All", ...(data?.filterOptions.categories ?? [])]} />
            <SelectFilter label="Status" value={params.status} onChange={(v) => setFilter("status", v)} options={["All", "Pending", "Approved", "Rejected", "Suspended"]} />
            <SelectFilter label="Package" value={params.package} onChange={(v) => setFilter("package", v)} options={["All", "active", "trial", "expired", "none"]} />
            <SelectFilter label="Eligibility" value={eligibility} onChange={setEligibility} options={["All", "Eligible", "Not eligible"]} />
          </>
        }
      />

      <p className="text-[11px] text-slate-500">
        Search and the City / Category / Status / Package filters cover the complete vendor database. The Eligibility
        filter refines the current page only — eligibility is computed by the shared policy helper, never in SQL.
      </p>

      <SectionCard
        title="Profile Change Requests"
        description="Review vendor-submitted public profile changes. Approval applies only safe public fields."
      >
        <DataTable
          rows={profileChangeRequests}
          emptyTitle="No pending profile change requests"
          emptyMessage="Vendor profile edits that need approval will appear here."
          columns={[
            { header: "Vendor", cell: (request) => <Strong title={vendorName(vendorPool, request.vendor_id)} subtitle={formatDate(request.created_at)} /> },
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
            { header: "Vendor", cell: (thread) => <Strong title={vendorName(vendorPool, thread.vendor_id)} subtitle={formatDate(thread.updated_at)} /> },
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

      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        noun={result.total === totals.all ? "vendors" : "matching vendors"}
        isPending={isPending}
        onPageChange={(page) => navigate({ page })}
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
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
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
    // `not_accepting_leads` is the vendor AVAILABILITY switch
    // (vendors.accepting_leads): the vendor is not open to receiving NEW lead
    // assignments. It is NOT a per-lead decision — QuickFurno has no vendor
    // accept/reject of an assigned lead. The label is worded so it can never be
    // read as one. Previously this code had no mapping at all and the raw
    // identifier "not_accepting_leads" leaked into the admin UI.
    not_accepting_leads: "Unavailable for new assignments",
    vendor_not_approved: "Not approved",
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
          <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" placeholder="0" className="mt-1 qfa-control w-full px-2.5 outline-none" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Reason</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Manual top-up after payment" className="mt-1 qfa-control w-full px-2.5 outline-none" />
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
          <input value={packageName} onChange={(event) => setPackageName(event.target.value)} placeholder="e.g. Growth Package" className="mt-1 qfa-control w-full px-2.5 outline-none" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Package status</span>
          <select value={packageStatus} onChange={(event) => setPackageStatus(event.target.value)} className="mt-1 qfa-control w-full px-2.5 font-medium outline-none">
            {statuses.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Credits to add (optional)</span>
          <input value={creditsToAdd} onChange={(event) => setCreditsToAdd(event.target.value)} type="number" placeholder="0" className="mt-1 qfa-control w-full px-2.5 outline-none" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Expiry date (optional)</span>
          <input value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} type="date" className="mt-1 qfa-control w-full px-2.5 outline-none" />
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
        <article className="qfa-panel p-4">
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
