"use client";

// ============================================================================
// C-PERF2 — Lead Distribution with ACTIVE-TAB data loading.
//
// The page no longer receives (or waits on) an every-table snapshot: each tab
// fetches ONLY its own bounded payload when it becomes active, with URL
// ?tab= state so refresh/back/forward preserve the view. Tables page at 20
// rows; related lead/vendor names resolve via bounded current-page IN
// lookups; self-contained panels (Requirement Groups, Recent/Failed
// Assignments, Distribution Logs) keep their own bounded fetching.
//
// No assignment authority, eligibility policy or Core semantics change here.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  adminDistributionTab,
  adminMarkFreeVendorInterestStatus,
  adminRecheckLeadAssignmentQueue,
  adminRunAutoMatchPreview,
  adminVendorsForEligibility,
} from "@/app/actions";
import { evaluateVendorEligibility } from "@/lib/vendors/vendorEligibility";
import {
  ActionMenu,
  DataTable,
  NoteBar,
  PrimaryButton,
  SecondaryButton,
  SelectFilter,
  SectionCard,
  StatCard,
  StatusBadge,
  TabPanel,
  Tabs,
} from "../AdminPrimitives";
import { Pagination } from "../Pagination";
import { type Category, type City, type Lead, type Snapshot, type Vendor, emptySnapshot } from "../adminTypes";
import {
  formatDate,
  formatNumber,
  leadName,
  maskPhone,
  shortId,
  vendorName,
} from "../adminUtils";
import { LeadAssignmentApprovalControl } from "../LeadAssignmentApprovalControl";
import { DistributionLogsPanel, FailedAssignmentsPanel, RecentAssignmentsPanel } from "../AssignmentLedgerPanels";
import { DeliveryLogsAuditPanel, MatchingRunsAuditPanel, PreviewMessagesPanel } from "../LeadMatchingAuditPanels";
import { ManualLeadAssignmentPanel } from "../ManualLeadAssignmentPanel";
import { RequirementGroupsPanel } from "../RequirementGroupsPanel";
import { Strong } from "./shared";

const TABS = [
  "Auto Matching & Queue",
  "Manual Assignment",
  "Requirement Groups",
  "Matching Audit",
  "Delivery Logs",
  "Preview Messages",
  "Rules & Settings",
  "Assignment Approval Preview",
  "Recent Assignments",
  "Failed Assignments",
  "Vendor Eligibility Checker",
  "Distribution Logs",
] as const;
type TabLabel = (typeof TABS)[number];

/** URL slug + server loader key per tab. `loader: null` = the tab either
 *  needs no server payload or its panel fetches its own bounded data. */
const TAB_CONFIG: Record<TabLabel, { slug: string; loader: "queue" | "manual" | "matching-audit" | "delivery" | "preview-messages" | "approval" | "eligibility" | null }> = {
  "Auto Matching & Queue": { slug: "queue", loader: "queue" },
  "Manual Assignment": { slug: "manual", loader: "manual" },
  "Requirement Groups": { slug: "requirement-groups", loader: null },
  "Matching Audit": { slug: "matching-audit", loader: "matching-audit" },
  "Delivery Logs": { slug: "delivery", loader: "delivery" },
  "Preview Messages": { slug: "preview-messages", loader: "preview-messages" },
  "Rules & Settings": { slug: "rules", loader: null },
  "Assignment Approval Preview": { slug: "approval", loader: "approval" },
  "Recent Assignments": { slug: "recent", loader: null },
  "Failed Assignments": { slug: "failed", loader: null },
  "Vendor Eligibility Checker": { slug: "eligibility", loader: "eligibility" },
  "Distribution Logs": { slug: "logs", loader: null },
};

function tabFromSlug(slug: string | null): TabLabel {
  const found = TABS.find((label) => TAB_CONFIG[label].slug === slug);
  return found ?? TABS[0];
}

export function LeadDistributionPage({
  notify,
  runAction,
}: {
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  runAction: (title: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = tabFromSlug(searchParams.get("tab"));
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [payload, setPayload] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const navigate = useCallback(
    (updates: Record<string, string | number | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === "" || (key === "page" && Number(value) <= 1)) next.delete(key);
        else next.set(key, String(value));
      });
      router.replace(`${pathname}${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const loaderKey = TAB_CONFIG[tab].loader;
  useEffect(() => {
    if (!loaderKey) {
      setLoading(false);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    const seq = ++requestSeq.current;
    setLoading(true);
    (async () => {
      const result = await adminDistributionTab(loaderKey, page);
      if (cancelled || seq !== requestSeq.current) return;
      if (!result.ok) {
        setLoadError(result.error ?? "Could not load this tab.");
        setLoading(false);
        return;
      }
      setLoadError(null);
      setPayload((current) => ({ ...current, [loaderKey]: result.data }));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loaderKey, page]);

  const setTab = (label: string) => navigate({ tab: TAB_CONFIG[label as TabLabel]?.slug ?? null, page: null });

  return (
    <div className="space-y-5" aria-busy={loading}>
      <Tabs id="lead-distribution-tabs" tabs={[...TABS]} active={tab} onChange={setTab} label="Lead distribution sections" />
      <TabPanel id="lead-distribution-tabs" active={tab}>
      {loadError ? (
        <p role="alert" className="rounded-[var(--qfa-radius)] border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          {loadError}
        </p>
      ) : null}

      {tab === "Auto Matching & Queue" ? (
        <AutoMatchingQueuePanel
          data={payload.queue ?? null}
          loading={loading}
          notify={notify}
          runAction={runAction}
          onPageChange={(next) => navigate({ page: next })}
        />
      ) : tab === "Manual Assignment" ? (
        <ManualAssignmentAdapter data={payload.manual ?? null} loading={loading} notify={notify} />
      ) : tab === "Requirement Groups" ? (
        <RequirementGroupsPanel notify={notify} />
      ) : tab === "Matching Audit" ? (
        <PagedPanelAdapter
          loading={loading}
          result={payload["matching-audit"]?.result}
          onPageChange={(next) => navigate({ page: next })}
          noun="matching runs"
        >
          <MatchingRunsAuditPanel
            data={{
              ...emptySnapshot(),
              leadMatchingRuns: payload["matching-audit"]?.result?.rows ?? [],
              leads: payload["matching-audit"]?.leads ?? [],
              vendors: payload["matching-audit"]?.vendors ?? [],
            }}
            notify={notify}
          />
        </PagedPanelAdapter>
      ) : tab === "Delivery Logs" ? (
        <PagedPanelAdapter
          loading={loading}
          result={payload.delivery?.result}
          onPageChange={(next) => navigate({ page: next })}
          noun="delivery logs"
        >
          <DeliveryLogsAuditPanel
            data={{
              ...emptySnapshot(),
              leadDeliveryLogs: payload.delivery?.result?.rows ?? [],
              leads: payload.delivery?.leads ?? [],
              vendors: payload.delivery?.vendors ?? [],
            }}
          />
        </PagedPanelAdapter>
      ) : tab === "Preview Messages" ? (
        <div className="space-y-3">
          {payload["preview-messages"]?.totals ? (
            <NoteBar>
              Showing the latest {formatNumber((payload["preview-messages"]?.clientLogs ?? []).length)} of{" "}
              {formatNumber(payload["preview-messages"].totals.clientTotal)} client previews and{" "}
              {formatNumber((payload["preview-messages"]?.vendorPreviewLogs ?? []).length)} of{" "}
              {formatNumber(payload["preview-messages"].totals.vendorPrevTotal)} vendor previews.
            </NoteBar>
          ) : null}
          <PreviewMessagesPanel
            data={{
              ...emptySnapshot(),
              clientNotificationLogs: payload["preview-messages"]?.clientLogs ?? [],
              leadDeliveryLogs: payload["preview-messages"]?.vendorPreviewLogs ?? [],
              leads: payload["preview-messages"]?.leads ?? [],
              vendors: payload["preview-messages"]?.vendors ?? [],
            }}
          />
        </div>
      ) : tab === "Rules & Settings" ? (
        <div className="space-y-3">
          <NoteBar tone="warning">
            Reference list only. These rules are enforced by Core matching; they are not switched on or off from this
            screen, and no rule state is stored here.
          </NoteBar>
          <SectionCard title="Distribution rules applied by Core">
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {["Auto assignment", "Match by city", "Match by locality", "Verified vendors only", "Paid vendors only", "Remaining leads required", "Duplicate protection", "Fair rotation"].map((rule) => (
                <li key={rule} className="flex items-center gap-2 text-[13px] text-slate-700">
                  <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                  {rule}
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      ) : tab === "Assignment Approval Preview" ? (
        <div className="space-y-3">
          <NoteBar>
            Lead selector covers the latest {formatNumber((payload.approval?.leads ?? []).length)} open unassigned
            leads. Use the Leads directory search to locate older leads first.
          </NoteBar>
          <LeadAssignmentApprovalControl leads={(payload.approval?.leads ?? []) as Lead[]} notify={notify} />
        </div>
      ) : tab === "Recent Assignments" ? (
        <RecentAssignmentsPanel notify={notify} />
      ) : tab === "Failed Assignments" ? (
        <FailedAssignmentsPanel notify={notify} />
      ) : tab === "Vendor Eligibility Checker" ? (
        <EligibilityChecker
          cities={(payload.eligibility?.cities ?? []) as City[]}
          categories={(payload.eligibility?.categories ?? []) as Category[]}
          notify={notify}
        />
      ) : (
        <DistributionLogsPanel notify={notify} />
      )}
      </TabPanel>
    </div>
  );
}

/** Wraps a legacy panel with the shared pager for its 20-row page. */
function PagedPanelAdapter({
  children,
  result,
  loading,
  onPageChange,
  noun,
}: {
  children: React.ReactNode;
  result?: { page: number; pageSize: number; total: number };
  loading: boolean;
  onPageChange: (page: number) => void;
  noun: string;
}) {
  return (
    <div className="space-y-3">
      {children}
      {result ? (
        <Pagination page={result.page} pageSize={result.pageSize} total={result.total} noun={noun} isPending={loading} onPageChange={onPageChange} />
      ) : null}
    </div>
  );
}

function ManualAssignmentAdapter({
  data,
  loading,
  notify,
}: {
  data: { leads: Lead[]; matchingRuns: any[] } | null;
  loading: boolean;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  return (
    <div className="space-y-3">
      <NoteBar>
        Working set: the latest {formatNumber((data?.leads ?? []).length)} open unassigned leads. Use the Leads
        directory search for older leads.
      </NoteBar>
      <ManualLeadAssignmentPanel
        data={{ ...emptySnapshot(), leads: (data?.leads ?? []) as Lead[], leadMatchingRuns: data?.matchingRuns ?? [] }}
        notify={notify}
      />
      {loading ? <p className="text-[11px] text-slate-500">Loading…</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto Matching & Queue — server-paged queue + bounded embedded panels
// ---------------------------------------------------------------------------

function AutoMatchingQueuePanel({
  data,
  loading,
  notify,
  runAction,
  onPageChange,
}: {
  data: {
    queue: { rows: any[]; page: number; pageSize: number; total: number };
    counts: { queueTotal: number; matchedPreview: number; suggestedCount: number; autoLogsTotal: number; freeInterestsTotal: number };
    autoLogs: any[];
    freeInterests: any[];
    unassignedLeads: Lead[];
    leads: Lead[];
    vendors: Vendor[];
  } | null;
  loading: boolean;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  runAction: (title: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
  onPageChange: (page: number) => void;
}) {
  const queue = data?.queue ?? { rows: [], page: 1, pageSize: 20, total: 0 };
  const counts = data?.counts ?? { queueTotal: 0, matchedPreview: 0, suggestedCount: 0, autoLogsTotal: 0, freeInterestsTotal: 0 };
  const autoLogs = data?.autoLogs ?? [];
  const freeInterests = data?.freeInterests ?? [];
  const unassignedLeads = data?.unassignedLeads ?? [];
  const leads = data?.leads ?? [];
  const vendors = data?.vendors ?? [];

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Queued Leads" value={formatNumber(counts.queueTotal)} helper="Awaiting paid vendor supply (live count)" icon="distribution" tone="amber" />
        <StatCard label="Matched Preview" value={formatNumber(counts.matchedPreview)} helper="Suggestions ready, not assigned (live count)" icon="vendors" tone="emerald" />
        <StatCard label="Auto Suggestions" value={formatNumber(counts.suggestedCount)} helper="Preview logs only (live count)" icon="reports" tone="indigo" />
        <StatCard label="Free Vendor Interests" value={formatNumber(counts.freeInterestsTotal)} helper="Masked client contact only (live count)" icon="notifications" tone="slate" />
      </section>

      <SectionCard title="Queued Leads" description="Recheck is manual in this phase. Matched previews are not final assignments.">
        <DataTable
          rows={queue.rows}
          density="compact"
          getRowKey={(row, index) => String(row.id ?? index)}
          emptyTitle="No queued leads"
          emptyMessage="Leads will appear here when paid-only preview matching cannot find enough eligible vendors."
          columns={[
            { header: "Lead", cell: (row) => <Strong title={leadName(leads, row.lead_id)} subtitle={shortId(row.lead_id)} /> },
            { header: "Reason", cell: (row) => <StatusBadge value={row.queue_reason || "queued"} tone={row.queue_status === "matched_preview" ? "emerald" : "amber"} /> },
            { header: "Eligible Paid", cell: (row) => `${formatNumber(row.eligible_vendor_count ?? 0)} / ${formatNumber(row.required_vendor_count ?? 1)}` },
            { header: "Selected Preview", cell: (row) => <span className="line-clamp-2 min-w-44 text-xs text-slate-500">{selectedVendorNames(row.selected_vendor_ids ?? [], vendors)}</span> },
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
        <Pagination page={queue.page} pageSize={queue.pageSize} total={queue.total} noun="queued leads" isPending={loading} onPageChange={onPageChange} />
      </SectionCard>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard title="Run Preview For Unassigned Leads" description="Preview-only. No assignment, vendor notification, credit deduction, or WhatsApp.">
          <DataTable
            rows={unassignedLeads}
            getRowKey={(lead) => lead.id}
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

        <SectionCard title="Preview Logs" description={`Latest ${formatNumber(autoLogs.length)} of ${formatNumber(counts.autoLogsTotal)} records from lead_auto_assignment_logs. Suggestions are not final assignments.`}>
          <DataTable
            rows={autoLogs}
            getRowKey={(row, index) => String(row.id ?? index)}
            emptyTitle="No preview logs"
            emptyMessage="Auto matching preview runs will be logged after the migration is applied."
            columns={[
              { header: "Lead", cell: (row) => <Strong title={leadName(leads, row.lead_id)} subtitle={shortId(row.lead_id)} /> },
              { header: "Status", cell: (row) => <StatusBadge value={row.status || "preview"} tone={row.status === "auto_suggested" ? "emerald" : "amber"} /> },
              { header: "Eligible", cell: (row) => formatNumber(row.eligible_vendor_count ?? 0) },
              { header: "Selected", cell: (row) => <span className="line-clamp-2 min-w-36 text-xs text-slate-500">{selectedVendorNames(row.selected_vendor_ids ?? [], vendors)}</span> },
              { header: "Date", cell: (row) => formatDate(row.created_at) },
            ]}
          />
        </SectionCard>
      </section>

      <SectionCard title="Free Vendor Interest Capture" description={`Latest ${formatNumber(freeInterests.length)} of ${formatNumber(counts.freeInterestsTotal)}. Client phones are masked/hashed; no vendor receives client contact in this phase.`}>
        <DataTable
          rows={freeInterests}
          getRowKey={(row, index) => String(row.id ?? index)}
          emptyTitle="No free vendor interests"
          emptyMessage="Requests from gated free vendor profiles will appear here after capture."
          columns={[
            { header: "Vendor", cell: (row) => <Strong title={vendorName(vendors, row.vendor_id)} subtitle={shortId(row.vendor_id)} /> },
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

// ---------------------------------------------------------------------------
// Shared vocabulary helpers (Phase 14B/14C source of truth) — unchanged.
// ---------------------------------------------------------------------------

/** Phase 14B: active admin-managed city names — the single source of truth. */
export function activeCityNames(cities: City[]): string[] {
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
export function activeCategoryNames(categories: Category[]): string[] {
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

export function selectedVendorNames(ids: string[] | null | undefined, vendors: Vendor[]): string {
  const list = Array.isArray(ids) ? ids : [];
  if (list.length === 0) return "No vendor selected";
  return list.map((id) => vendorName(vendors, id)).join(", ");
}

// ---------------------------------------------------------------------------
// Eligibility checker — vendors fetched per selected city, bounded + counted.
// ---------------------------------------------------------------------------

export function EligibilityChecker({ cities, categories, notify }: { cities: City[]; categories: Category[]; notify: (message: string) => void }) {
  // Phase 14B/14C: city + category options come ONLY from admin-managed active
  // cities (public.cities) and active categories (public.service_categories).
  const activeCities = useMemo(() => activeCityNames(cities), [cities]);
  const activeCategories = useMemo(() => activeCategoryNames(categories), [categories]);
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [vendorRows, setVendorRows] = useState<Vendor[]>([]);
  const [vendorTotal, setVendorTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (activeCities.length && !activeCities.includes(city)) setCity(activeCities[0]);
  }, [activeCities, city]);
  useEffect(() => {
    if (activeCategories.length && !activeCategories.includes(category)) setCategory(activeCategories[0]);
  }, [activeCategories, category]);

  // C-PERF2: vendors are fetched for the SELECTED CITY only (bounded ≤50 +
  // live count), instead of shipping a vendor directory to the browser.
  useEffect(() => {
    if (!city) {
      setVendorRows([]);
      setVendorTotal(0);
      return;
    }
    let cancelled = false;
    const seq = ++requestSeq.current;
    setLoading(true);
    (async () => {
      const result = await adminVendorsForEligibility(city);
      if (cancelled || seq !== requestSeq.current) return;
      if (result.ok) {
        const data = result.data as { vendors: Vendor[]; total: number };
        setVendorRows(data.vendors);
        setVendorTotal(data.total);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [city]);

  // Phase 14: full eligibility reasoning via the SAME shared helper the Lead
  // Assignment Approval Preview uses — policy is never duplicated into SQL.
  const vendorsInCity = useMemo(
    () =>
      vendorRows.map((vendor) => ({
        vendor,
        eligibility: evaluateVendorEligibility(vendor as Record<string, unknown>, { leadCity: city, leadCategory: category }),
      })),
    [vendorRows, city, category],
  );
  const eligibleCount = vendorsInCity.filter((row) => row.eligibility.eligible).length;

  return (
    <section className="grid gap-5 xl:grid-cols-[360px_1fr]" aria-busy={loading}>
      <div className="qfa-panel p-4">
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
          <p className="mt-1 text-slate-500">
            of {formatNumber(vendorsInCity.length)} loaded vendor(s) in {city}
            {vendorTotal > vendorsInCity.length ? ` (latest ${formatNumber(vendorsInCity.length)} of ${formatNumber(vendorTotal)})` : ""}
          </p>
        </div>
      </div>
      <DataTable
        rows={vendorsInCity}
        getRowKey={(row) => row.vendor.id}
        emptyTitle={loading ? "Loading vendors…" : "No vendors in this city"}
        emptyMessage={loading ? "Fetching vendors for the selected city." : "No vendor records match the selected city. Eligibility requires approved + active + active package + credits, and (for a lead) city + category match."}
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
