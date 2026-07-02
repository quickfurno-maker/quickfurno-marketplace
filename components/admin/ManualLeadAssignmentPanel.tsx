"use client";

// ============================================================================
// QuickFurno — Phase 26A-2C admin manual lead-assignment UI.
// Shows primary/recovery slot state per lead, and a modal that groups candidate
// vendors into Best match / Interior fallback / Recovery eligible / Not eligible.
// Assignment (top-up / fallback / recovery, up to 9) runs server-side through
// the existing safe RPC; this UI only selects vendors.
// ============================================================================
import { type ReactNode, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminAssignLeadManually, adminPreviewManualLeadAssignment } from "@/app/actions";
import { DataTable, SectionCard, SecondaryButton, PrimaryButton, StatCard, StatusBadge, Toolbar, SelectFilter } from "./AdminPrimitives";
import type { Lead, ManualCandidateVendorView, ManualPreviewView, Snapshot } from "./adminTypes";
import { formatNumber, includesQuery, maskPhone, shortId } from "./adminUtils";

const PRIMARY_LIMIT = 3;
const TOTAL_LIMIT = 9;

const reasonLabels: Record<string, string> = {
  vendor_pending_approval: "Pending approval",
  vendor_suspended: "Suspended",
  vendor_inactive: "Inactive",
  free_unpaid_vendor_not_eligible_for_assignment: "Free/unpaid — not eligible",
  package_expired: "Package expired",
  no_credits: "No credits",
  city_mismatch: "City mismatch",
  category_mismatch: "Category label mismatch",
  subcategory_mismatch: "Subcategory mismatch",
  already_assigned: "Already assigned",
};
function reasonLabel(reason: string): string {
  return reasonLabels[reason] ?? reason.replace(/_/g, " ");
}

type Counts = {
  total: number; primary: number; recovery: number; pendingPrimary: number;
  recoveryRemaining: number; state: string; label: string; action: string;
};

// Client-side mirror of the service's slot model, from the snapshot's
// distinct assigned vendor count — avoids a server call per list row.
function deriveCounts(total: number): Counts {
  const primary = Math.min(total, PRIMARY_LIMIT);
  const recovery = Math.max(total - PRIMARY_LIMIT, 0);
  const pendingPrimary = PRIMARY_LIMIT - primary;
  const recoveryRemaining = Math.max(TOTAL_LIMIT - total, 0);
  let state: string, label: string, action: string;
  if (total <= 0) { state = "unassigned"; label = "Unassigned"; action = "Assign vendors"; }
  else if (total < PRIMARY_LIMIT) { state = "needs_top_up"; label = "Needs top-up"; action = "Top up vendors"; }
  else if (total === PRIMARY_LIMIT) { state = "primary_full"; label = "Primary full"; action = "Recovery assign"; }
  else if (total < TOTAL_LIMIT) { state = "recovery_active"; label = "Recovery active"; action = "Recovery assign"; }
  else { state = "max_manual_assignment_reached"; label = "Max reached"; action = "Max reached"; }
  return { total, primary, recovery, pendingPrimary, recoveryRemaining, state, label, action };
}

function stateTone(state: string): "emerald" | "amber" | "rose" | "slate" | "blue" {
  if (state === "primary_full") return "emerald";
  if (state === "unassigned" || state === "needs_top_up") return "amber";
  if (state === "recovery_active") return "blue";
  if (state === "max_manual_assignment_reached") return "rose";
  return "slate";
}

type Notify = (message: string, tone?: "success" | "error" | "info") => void;

const FILTERS = [
  "All", "Unassigned 0/3", "Needs top-up 1/3", "Needs top-up 2/3",
  "Primary full 3/3", "Recovery active 4-8/9", "Max reached 9/9",
  "Manual top-up needed", "Recovery needed",
];

export function ManualLeadAssignmentPanel({ data, notify }: { data: Snapshot; notify: Notify }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Manual top-up needed");
  const [activeLead, setActiveLead] = useState<Lead | null>(null);

  const runStatusByLead = useMemo(() => {
    const map = new Map<string, string>();
    (data.leadMatchingRuns ?? []).forEach((run) => {
      if (run.lead_id && !map.has(run.lead_id)) map.set(run.lead_id, String(run.run_status ?? ""));
    });
    return map;
  }, [data.leadMatchingRuns]);

  const distinctCount = useCallback((lead: Lead) => {
    const ids = new Set((lead.lead_assignments ?? []).map((a) => a.vendor_id).filter(Boolean));
    return ids.size;
  }, []);

  const leads = useMemo(() => {
    return data.leads.filter((lead) => {
      const total = distinctCount(lead);
      const passFilter =
        filter === "All" ? true
        : filter === "Unassigned 0/3" ? total === 0
        : filter === "Needs top-up 1/3" ? total === 1
        : filter === "Needs top-up 2/3" ? total === 2
        : filter === "Primary full 3/3" ? total === 3
        : filter === "Recovery active 4-8/9" ? total >= 4 && total <= 8
        : filter === "Max reached 9/9" ? total >= 9
        : filter === "Manual top-up needed" ? total < 3
        : filter === "Recovery needed" ? total >= 3 && total < 9
        : true;
      if (!passFilter) return false;
      const category = lead.service_required || lead.category || "";
      return includesQuery([lead.name, lead.phone, lead.city, lead.area, category, lead.status], query);
    });
  }, [data.leads, filter, query, distinctCount]);

  const topUpNeeded = useMemo(() => data.leads.filter((l) => distinctCount(l) < 3).length, [data.leads, distinctCount]);
  const recoveryNeeded = useMemo(() => data.leads.filter((l) => { const t = distinctCount(l); return t >= 3 && t < 9; }).length, [data.leads, distinctCount]);

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="All Leads" value={formatNumber(data.leads.length)} helper="Complete lead database" icon="leads" />
        <StatCard label="Manual Top-up Needed" value={formatNumber(topUpNeeded)} helper="Below 3 primary vendors" icon="distribution" tone="amber" />
        <StatCard label="Recovery Available" value={formatNumber(recoveryNeeded)} helper="3/3 primary, room to 9" icon="vendors" tone="indigo" />
        <StatCard label="In View" value={formatNumber(leads.length)} helper="Matching current filter" icon="reports" tone="slate" />
      </section>

      <SectionCard
        title="Manual Lead Assignment"
        description="Primary top-up (max 3), interior fallback, and recovery assignment (up to 9). Auto matching stays max 3. Assignment reuses the existing safe RPC — one credit per vendor, no double-assign, no double-deduct. WhatsApp stays preview/log only."
      >
        <Toolbar
          query={query}
          setQuery={setQuery}
          placeholder="Search name, masked phone, city, area, category..."
          filters={<SelectFilter label="State" value={filter} onChange={setFilter} options={FILTERS} />}
        />
        <div className="mt-4">
          <DataTable
            rows={leads}
            emptyTitle="No leads in this view"
            emptyMessage="Adjust the state filter or search to find a lead to assign."
            columns={[
              { header: "Lead", cell: (lead: Lead) => <Strong title={lead.name || "Unnamed lead"} subtitle={`${shortId(lead.id)} · ${maskPhone(lead.phone)}`} /> },
              { header: "Requirement", cell: (lead: Lead) => <Strong title={lead.service_required || lead.category || "Not set"} subtitle={[lead.area, lead.city].filter(Boolean).join(", ") || "City not set"} /> },
              { header: "Primary", cell: (lead: Lead) => { const c = deriveCounts(distinctCount(lead)); return <StatusBadge value={`${c.primary}/3`} tone={c.primary === 3 ? "emerald" : "amber"} />; } },
              { header: "Pending", cell: (lead: Lead) => { const c = deriveCounts(distinctCount(lead)); return <span className="text-xs text-slate-600">{c.pendingPrimary} slot(s)</span>; } },
              { header: "Recovery", cell: (lead: Lead) => { const c = deriveCounts(distinctCount(lead)); return <span className="text-xs text-slate-600">{c.recovery}/6</span>; } },
              { header: "Total", cell: (lead: Lead) => { const c = deriveCounts(distinctCount(lead)); return <StatusBadge value={`${c.total}/9`} tone={stateTone(c.state)} />; } },
              { header: "State", cell: (lead: Lead) => { const c = deriveCounts(distinctCount(lead)); return <StatusBadge value={c.label} tone={stateTone(c.state)} />; } },
              { header: "Auto", cell: (lead: Lead) => { const s = runStatusByLead.get(lead.id); return s ? <StatusBadge value={s} tone={s.startsWith("manual") || s === "matched" ? "emerald" : s === "waiting" ? "amber" : "slate"} /> : <span className="text-xs text-slate-400">—</span>; } },
              {
                header: "Actions",
                cell: (lead: Lead) => {
                  const c = deriveCounts(distinctCount(lead));
                  const disabled = c.state === "max_manual_assignment_reached";
                  return disabled
                    ? <StatusBadge value="Max reached" tone="rose" />
                    : <SecondaryButton onClick={() => setActiveLead(lead)}>{c.action}</SecondaryButton>;
                },
              },
            ]}
          />
        </div>
      </SectionCard>

      {activeLead ? <ManualAssignmentModal lead={activeLead} notify={notify} onClose={() => setActiveLead(null)} /> : null}
    </div>
  );
}

function ManualAssignmentModal({ lead, notify, onClose }: { lead: Lead; notify: Notify; onClose: () => void }) {
  const router = useRouter();
  const [preview, setPreview] = useState<ManualPreviewView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subFilter, setSubFilter] = useState("Best Match");
  const [isPending, startTransition] = useTransition();

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result = await adminPreviewManualLeadAssignment(lead.id);
    if (!result.ok) { setLoadError(result.error ?? "Could not load candidate vendors."); setPreview(null); }
    else setPreview(result.data as ManualPreviewView);
    setLoading(false);
  }, [lead.id]);
  useEffect(() => { void loadPreview(); }, [loadPreview]);

  const candidates = preview?.candidates ?? [];
  const counts = preview?.counts;
  const mode = preview?.mode ?? "primary";
  const maxSelectable = preview?.max_selectable ?? 0;
  const consentOk = preview?.consent_ok ?? false;
  const canSelect = consentOk && mode !== "max";

  const filtered = useMemo(() => {
    const bySub = (v: ManualCandidateVendorView) => {
      if (subFilter === "Show All") return true;
      if (subFilter === "Best Match") return v.match_type === "best_match" || v.match_type === "recovery_eligible";
      if (subFilter === "All Interior Fallback") return v.match_type === "interior_fallback";
      const cats = (v.service_categories ?? []).map((c) => c.toLowerCase());
      return cats.some((c) => c.includes(subFilter.toLowerCase()));
    };
    return candidates.filter(bySub);
  }, [candidates, subFilter]);

  const groups = useMemo(() => ({
    best: filtered.filter((v) => v.match_type === "best_match"),
    fallback: filtered.filter((v) => v.match_type === "interior_fallback"),
    recovery: filtered.filter((v) => v.match_type === "recovery_eligible"),
    not: filtered.filter((v) => v.match_type === "not_eligible"),
  }), [filtered]);

  const candidateById = useMemo(() => new Map(candidates.map((v) => [v.id, v])), [candidates]);

  function toggle(vendor: ManualCandidateVendorView) {
    if (!canSelect || !vendor.assignable) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(vendor.id)) next.delete(vendor.id);
      else {
        if (next.size >= maxSelectable) { notify(`You can select at most ${maxSelectable} vendor(s) for this lead now.`, "error"); return current; }
        next.add(vendor.id);
      }
      return next;
    });
  }

  function confirm() {
    if (selected.size === 0) { notify("Select at least one vendor.", "error"); return; }
    startTransition(async () => {
      const result = await adminAssignLeadManually(lead.id, [...selected]);
      if (!result.ok) { notify(result.error ?? "Manual assignment failed.", "error"); return; }
      const s = result.data;
      const parts = [`${formatNumber(s.assigned_count)} assigned`];
      if (s.delivered_count) parts.push(`${formatNumber(s.delivered_count)} delivered`);
      if (s.skipped_vendor_ids.length) parts.push(`${formatNumber(s.skipped_vendor_ids.length)} skipped`);
      const modeLabel = s.recovery_used ? "Recovery" : s.fallback_used ? "Fallback" : "Manual";
      notify(`${modeLabel} assignment complete: ${parts.join(", ")}.`, "success");
      router.refresh();
      onClose();
    });
  }

  const buttonLabel = mode === "recovery"
    ? (selected.size === 0 ? "Select vendor to recovery assign" : "Recovery assign selected vendors")
    : selected.size === 0 ? "Select vendor to assign"
    : selected.size === 1 ? "Assign 1 vendor"
    : `Assign ${selected.size} vendors`;

  return (
    <ModalShell title="Assign Vendors Manually" subtitle={lead.name || "Lead"} onClose={onClose}>
      <div className="space-y-4">
        <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="grid gap-1.5 sm:grid-cols-2">
            <Detail label="Lead ID" value={shortId(lead.id)} />
            <Detail label="Phone" value={maskPhone(lead.phone)} />
            <Detail label="City / Area" value={[lead.city, lead.area].filter(Boolean).join(" / ") || "Not set"} />
            <Detail label="Category" value={lead.service_required || lead.category || "Not set"} />
          </div>
        </article>

        {counts ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="Primary" value={`${counts.primary}/3`} tone={counts.primary === 3 ? "emerald" : "amber"} />
            <MiniStat label="Pending primary" value={`${counts.pending_primary_slots}`} tone="slate" />
            <MiniStat label="Total" value={`${counts.total}/9`} tone={stateTone(counts.state)} />
            <MiniStat label="Recovery slots" value={`${counts.recovery_slots_remaining}`} tone="blue" />
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
          Mode: {mode === "primary" ? "Primary top-up" : mode === "recovery" ? "Recovery" : "Max reached"}
          {" · "}You can select up to {maxSelectable} vendor(s).
        </div>

        {!consentOk ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This lead has no client sharing consent, so vendors cannot be assigned. Ask the client to consent first.
          </div>
        ) : mode === "max" ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Maximum manual assignment limit reached for this lead.
          </div>
        ) : null}

        {preview && preview.exact_match_count === 0 ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            No exact subcategory vendors available. Showing active interior fallback vendors so the lead does not remain unassigned.
          </div>
        ) : preview && preview.exact_match_count > 0 && preview.exact_match_count < 3 ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Exact match vendors are fewer than 3. You may add interior fallback vendors.
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <SelectFilter
            label="Vendor subcategory"
            value={subFilter}
            onChange={setSubFilter}
            options={["Best Match", "All Interior Fallback", "Interior Designers", "Carpenters", "Modular Factory", "Premium Interiors", "Show All"]}
          />
          <span className="text-xs font-semibold text-slate-500">{selected.size}/{maxSelectable} selected</span>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading candidate vendors…</p>
        ) : loadError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {loadError}
            <button type="button" onClick={() => void loadPreview()} className="ml-2 font-semibold underline">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500">No vendors match this subcategory filter.</p>
        ) : (
          <div className="max-h-[42vh] space-y-4 overflow-y-auto pr-1">
            <CandidateGroup title="Best Match Vendors" hint="Exact subcategory match" tone="emerald" vendors={groups.best} selected={selected} canSelect={canSelect} onToggle={toggle} />
            <CandidateGroup title="Interior Fallback Vendors" hint="Active package, same interior parent category" tone="amber" selectLabel="Assign as Fallback" vendors={groups.fallback} selected={selected} canSelect={canSelect} onToggle={toggle} />
            <CandidateGroup title="Recovery Eligible Vendors" hint="Manual recovery eligible" tone="blue" vendors={groups.recovery} selected={selected} canSelect={canSelect} onToggle={toggle} />
            <CandidateGroup title="Not Eligible Vendors" hint="Blocked by a hard reason or outside interior group" tone="rose" vendors={groups.not} selected={selected} canSelect={canSelect} onToggle={toggle} />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={confirm}>{isPending ? "Assigning…" : buttonLabel}</PrimaryButton>
        </div>
      </div>
    </ModalShell>
  );
}

function CandidateGroup({
  title, hint, tone, vendors, selected, canSelect, onToggle, selectLabel,
}: {
  title: string; hint: string; tone: "emerald" | "amber" | "rose" | "blue";
  vendors: ManualCandidateVendorView[]; selected: Set<string>; canSelect: boolean;
  onToggle: (v: ManualCandidateVendorView) => void; selectLabel?: string;
}) {
  if (vendors.length === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <StatusBadge value={`${title} (${vendors.length})`} tone={tone} />
        <span className="text-xs text-slate-500">{hint}</span>
      </div>
      <div className="space-y-2">
        {vendors.map((vendor) => (
          <CandidateRow key={vendor.id} vendor={vendor} checked={selected.has(vendor.id)} disabled={!canSelect || !vendor.assignable} selectLabel={selectLabel} onToggle={() => onToggle(vendor)} />
        ))}
      </div>
    </section>
  );
}

function CandidateRow({
  vendor, checked, disabled, selectLabel, onToggle,
}: { vendor: ManualCandidateVendorView; checked: boolean; disabled: boolean; selectLabel?: string; onToggle: () => void }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
      disabled ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-70"
      : checked ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white hover:border-emerald-200"}`}>
      <input type="checkbox" className="mt-1 h-4 w-4 accent-emerald-600" checked={checked} disabled={disabled} onChange={onToggle} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-slate-950">{vendor.business_name || shortId(vendor.id)}</span>
          <div className="flex flex-wrap gap-1.5">
            {selectLabel && vendor.assignable && !disabled ? <StatusBadge value={selectLabel} tone="amber" /> : null}
            {vendor.already_assigned ? <StatusBadge value="Already assigned" tone="amber" /> : null}
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-500">{[vendor.city || "City not set", (vendor.service_categories ?? []).join(", ") || "No categories"].join(" · ")}</p>
        <p className="mt-1 text-xs text-slate-500">{vendor.covers_full_city ? "Covers full city" : `Areas: ${(vendor.areas_covered ?? []).join(", ") || "not set"}`}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <StatusBadge value={vendor.status || "Pending"} tone={vendor.status === "Approved" ? "emerald" : "slate"} />
          <StatusBadge value={`Pkg: ${vendor.package_status || vendor.paid_status || "none"}`} tone={vendor.visibility_type === "paid" || vendor.visibility_type === "trial" ? "emerald" : "slate"} />
          <StatusBadge value={`${formatNumber(vendor.remaining_credits)} credits`} tone={vendor.remaining_credits > 0 ? "emerald" : "rose"} />
        </div>
        {vendor.assignable ? (
          <p className="mt-2 text-xs font-medium text-slate-600">Match: {vendor.match_reason}</p>
        ) : (
          <p className="mt-2 text-xs font-medium text-rose-600">
            {vendor.hard_block_reasons.length > 0 ? `Blocked: ${vendor.hard_block_reasons.map(reasonLabel).join(" · ")}` : vendor.match_reason}
          </p>
        )}
      </div>
    </label>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: "emerald" | "amber" | "rose" | "slate" | "blue" }) {
  const toneClass = { emerald: "text-emerald-700", amber: "text-amber-700", rose: "text-rose-700", blue: "text-sky-700", slate: "text-slate-700" }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${toneClass}`}>{value}</p>
    </div>
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
    <div className="min-w-40">
      <p className="font-semibold text-slate-950">{title}</p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
    </div>
  );
}

function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4 py-8 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
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
