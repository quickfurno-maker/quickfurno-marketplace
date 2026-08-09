"use client";

import { useEffect, useMemo, useState } from "react";
import {
  adminMarkFreeVendorInterestStatus,
  adminRecheckLeadAssignmentQueue,
  adminRunAutoMatchPreview,
} from "@/app/actions";
import { evaluateVendorEligibility } from "@/lib/vendors/vendorEligibility";
import {
  ActionMenu,
  DataTable,
  PrimaryButton,
  SecondaryButton,
  SelectFilter,
  SectionCard,
  StatCard,
  StatusBadge,
  Tabs,
  NoteBar,
  ToggleSwitch,
} from "../AdminPrimitives";
import { type Category, type City, type Lead, type Snapshot, type Vendor } from "../adminTypes";
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
import { isUnassignedLead } from "./LeadsSection";

export function LeadDistributionPage({
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
        /* These eight rules used to render an enable switch whose state came
           from `index < 6` — a fabricated value on a control that persisted
           nothing. Distribution policy is enforced in Core and configured
           through the marketplace runtime settings, so this is now a plain
           reference list of the rules the matcher applies. */
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
export function AutoMatchingQueuePanel({
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


export function EligibilityChecker({ data, notify }: { data: Snapshot; notify: (message: string) => void }) {
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
