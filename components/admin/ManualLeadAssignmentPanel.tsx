"use client";

// ============================================================================
// QuickFurno — Phase 26A-2B admin manual lead-assignment fallback UI.
// Lets an admin assign a lead to up to 3 eligible vendors when auto matching
// fails or queues. Assignment goes through the existing safe RPC via
// adminAssignLeadManually; this UI only selects vendors and shows results.
// ============================================================================
import { type ReactNode, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminAssignLeadManually,
  adminPreviewManualLeadAssignment,
} from "@/app/actions";
import { DataTable, SectionCard, SecondaryButton, PrimaryButton, StatCard, StatusBadge, Toolbar, SelectFilter } from "./AdminPrimitives";
import type { Lead, ManualCandidateVendorView, ManualPreviewView, Snapshot } from "./adminTypes";
import { formatDate, formatNumber, includesQuery, maskPhone, shortId, uniqueOptions } from "./adminUtils";

const MAX_MANUAL_VENDORS = 3;

const reasonLabels: Record<string, string> = {
  vendor_pending_approval: "Pending approval",
  vendor_suspended: "Suspended",
  vendor_inactive: "Inactive",
  free_unpaid_vendor_not_eligible_for_assignment: "Free/unpaid — not eligible",
  package_expired: "Package expired",
  no_credits: "No credits",
  city_mismatch: "City mismatch",
  category_mismatch: "Category mismatch",
  subcategory_mismatch: "Subcategory mismatch",
  service_area_mismatch: "Service area mismatch",
  already_assigned: "Already assigned",
};

function reasonLabel(reason: string): string {
  return reasonLabels[reason] ?? reason.replace(/_/g, " ");
}

type Notify = (message: string, tone?: "success" | "error" | "info") => void;

export function ManualLeadAssignmentPanel({ data, notify }: { data: Snapshot; notify: Notify }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("Unassigned");
  const [activeLead, setActiveLead] = useState<Lead | null>(null);

  // Latest auto-matching run status per lead, for admin context.
  const runStatusByLead = useMemo(() => {
    const map = new Map<string, string>();
    (data.leadMatchingRuns ?? []).forEach((run) => {
      if (run.lead_id && !map.has(run.lead_id)) map.set(run.lead_id, String(run.run_status ?? ""));
    });
    return map;
  }, [data.leadMatchingRuns]);

  const leads = useMemo(() => {
    return data.leads.filter((lead) => {
      const assignedCount = lead.lead_assignments?.length ?? 0;
      if (scope === "Unassigned" && assignedCount > 0) return false;
      if (scope === "Assigned" && assignedCount === 0) return false;
      const category = lead.service_required || lead.category || "";
      return includesQuery([lead.name, lead.phone, lead.city, lead.area, category, lead.status], query);
    });
  }, [data.leads, scope, query]);

  const unassignedCount = useMemo(() => data.leads.filter((lead) => (lead.lead_assignments?.length ?? 0) === 0).length, [data.leads]);

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="All Leads" value={formatNumber(data.leads.length)} helper="Complete lead database" icon="leads" />
        <StatCard label="Unassigned" value={formatNumber(unassignedCount)} helper="Fallback candidates" icon="distribution" tone="amber" />
        <StatCard label="In View" value={formatNumber(leads.length)} helper="Matching current filter" icon="reports" tone="slate" />
        <StatCard label="Max Per Lead" value={formatNumber(MAX_MANUAL_VENDORS)} helper="Hard cap enforced by RPC" icon="vendors" tone="indigo" />
      </section>

      <SectionCard
        title="Manual Lead Assignment"
        description="Fallback for when auto matching fails or queues. Assignment reuses the existing safe RPC: one credit per assigned vendor, no double-assign, no double-deduct. WhatsApp remains preview/log only."
      >
        <Toolbar
          query={query}
          setQuery={setQuery}
          placeholder="Search name, masked phone, city, area, category..."
          filters={<SelectFilter label="Scope" value={scope} onChange={setScope} options={["Unassigned", "Assigned", "All"]} />}
        />
        <div className="mt-4">
          <DataTable
            rows={leads}
            emptyTitle="No leads in this view"
            emptyMessage="Adjust the scope or search to find a lead to assign manually."
            columns={[
              { header: "Lead", cell: (lead: Lead) => <Strong title={lead.name || "Unnamed lead"} subtitle={`ID ${shortId(lead.id)} · ${maskPhone(lead.phone)}`} /> },
              { header: "Requirement", cell: (lead: Lead) => <Strong title={lead.service_required || lead.category || "Not set"} subtitle={[lead.area, lead.city].filter(Boolean).join(", ") || "City not set"} /> },
              { header: "Budget", cell: (lead: Lead) => lead.budget || "Not set" },
              { header: "Timeline", cell: (lead: Lead) => lead.timeline || "Not set" },
              { header: "Status", cell: (lead: Lead) => <StatusBadge value={lead.status || "New"} /> },
              {
                header: "Auto Matching",
                cell: (lead: Lead) => {
                  const status = runStatusByLead.get(lead.id);
                  return status ? <StatusBadge value={status} tone={status === "matched" || status === "manual_assigned" ? "emerald" : status === "waiting" ? "amber" : "slate"} /> : <span className="text-xs text-slate-400">No run</span>;
                },
              },
              {
                header: "Assigned",
                cell: (lead: Lead) => {
                  const count = lead.lead_assignments?.length ?? 0;
                  return <StatusBadge value={`${formatNumber(count)} vendors`} tone={count > 0 ? "emerald" : "amber"} />;
                },
              },
              {
                header: "Actions",
                cell: (lead: Lead) => (
                  <SecondaryButton onClick={() => setActiveLead(lead)}>Assign Vendors Manually</SecondaryButton>
                ),
              },
            ]}
          />
        </div>
      </SectionCard>

      {activeLead ? (
        <ManualAssignmentModal lead={activeLead} notify={notify} onClose={() => setActiveLead(null)} />
      ) : null}
    </div>
  );
}

function ManualAssignmentModal({ lead, notify, onClose }: { lead: Lead; notify: Notify; onClose: () => void }) {
  const router = useRouter();
  const [preview, setPreview] = useState<ManualPreviewView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result = await adminPreviewManualLeadAssignment(lead.id);
    if (!result.ok) {
      setLoadError(result.error ?? "Could not load candidate vendors.");
      setPreview(null);
    } else {
      setPreview(result.data as ManualPreviewView);
    }
    setLoading(false);
  }, [lead.id]);

  useEffect(() => { void loadPreview(); }, [loadPreview]);

  const candidates = preview?.candidates ?? [];
  const existingCount = preview?.existing_assignment_count ?? (lead.lead_assignments?.length ?? 0);
  const alreadyAssignedLead = existingCount > 0;

  function toggle(vendorId: string, eligible: boolean) {
    if (!eligible) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(vendorId)) {
        next.delete(vendorId);
      } else {
        if (next.size >= MAX_MANUAL_VENDORS) {
          notify(`You can select at most ${MAX_MANUAL_VENDORS} vendors.`, "error");
          return current;
        }
        next.add(vendorId);
      }
      return next;
    });
  }

  function confirm() {
    if (selected.size === 0) {
      notify("Select at least one eligible vendor.", "error");
      return;
    }
    startTransition(async () => {
      const result = await adminAssignLeadManually(lead.id, [...selected]);
      if (!result.ok) {
        notify(result.error ?? "Manual assignment failed.", "error");
        return;
      }
      const summary = result.data;
      const parts = [`${formatNumber(summary.assigned_count)} assigned`];
      if (summary.delivered_count) parts.push(`${formatNumber(summary.delivered_count)} delivered`);
      if (summary.skipped_vendor_ids.length) parts.push(`${formatNumber(summary.skipped_vendor_ids.length)} skipped`);
      notify(`Manual assignment complete: ${parts.join(", ")}.`, "success");
      router.refresh();
      onClose();
    });
  }

  return (
    <ModalShell title="Assign Vendors Manually" subtitle={lead.name || "Lead"} onClose={onClose}>
      <div className="space-y-4">
        <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="grid gap-1.5 sm:grid-cols-2">
            <Detail label="Lead ID" value={shortId(lead.id)} />
            <Detail label="Phone" value={maskPhone(lead.phone)} />
            <Detail label="City / Area" value={[lead.city, lead.area].filter(Boolean).join(" / ") || "Not set"} />
            <Detail label="Category" value={lead.service_required || lead.category || "Not set"} />
            <Detail label="Budget" value={lead.budget || "Not set"} />
            <Detail label="Timeline" value={lead.timeline || "Not set"} />
          </div>
        </article>

        {alreadyAssignedLead ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This lead already has {formatNumber(existingCount)} assigned vendor(s). The safe RPC assigns each lead only once, so a new
            manual assignment will be rejected as already assigned. Use this only for leads with no assignment yet.
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-700">Candidate vendors</p>
          <span className="text-xs font-semibold text-slate-500">{selected.size}/{MAX_MANUAL_VENDORS} selected</span>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading candidate vendors…</p>
        ) : loadError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {loadError}
            <button type="button" onClick={() => void loadPreview()} className="ml-2 font-semibold underline">Retry</button>
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-slate-500">No vendors found for this lead.</p>
        ) : (
          <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
            {candidates.map((vendor) => (
              <CandidateRow
                key={vendor.id}
                vendor={vendor}
                checked={selected.has(vendor.id)}
                onToggle={() => toggle(vendor.id, vendor.eligible)}
              />
            ))}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={confirm}>{isPending ? "Assigning…" : "Assign selected vendors"}</PrimaryButton>
        </div>
      </div>
    </ModalShell>
  );
}

function CandidateRow({ vendor, checked, onToggle }: { vendor: ManualCandidateVendorView; checked: boolean; onToggle: () => void }) {
  const disabled = !vendor.eligible;
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
        disabled
          ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-70"
          : checked
            ? "border-emerald-300 bg-emerald-50"
            : "border-slate-200 bg-white hover:border-emerald-200"
      }`}
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 accent-emerald-600"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-slate-950">{vendor.business_name || shortId(vendor.id)}</span>
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge value={vendor.eligible ? "Eligible" : "Not eligible"} tone={vendor.eligible ? "emerald" : "rose"} />
            {vendor.already_assigned ? <StatusBadge value="Already assigned" tone="amber" /> : null}
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {[vendor.city || "City not set", (vendor.service_categories ?? []).join(", ") || "No categories"].join(" · ")}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {vendor.covers_full_city ? "Covers full city" : `Areas: ${(vendor.areas_covered ?? []).join(", ") || "not set"}`}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <StatusBadge value={vendor.status || "Pending"} tone={vendor.status === "Approved" ? "emerald" : "slate"} />
          <StatusBadge value={`Pkg: ${vendor.package_status || vendor.paid_status || "none"}`} tone={vendor.visibility_type === "paid" || vendor.visibility_type === "trial" ? "emerald" : "slate"} />
          <StatusBadge value={`${formatNumber(vendor.remaining_credits)} credits`} tone={vendor.remaining_credits > 0 ? "emerald" : "rose"} />
        </div>
        {!vendor.eligible && vendor.reasons.length > 0 ? (
          <p className="mt-2 text-xs font-medium text-rose-600">{vendor.reasons.map(reasonLabel).join(" · ")}</p>
        ) : null}
      </div>
    </label>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-0.5 font-medium text-slate-900">{value}</p>
    </div>
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

function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4 py-8 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
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
