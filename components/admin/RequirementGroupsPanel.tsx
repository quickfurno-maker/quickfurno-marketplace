"use client";

// ============================================================================
// QuickFurno — components/admin/RequirementGroupsPanel.tsx
// Phase 26A-2D: admin view of per-parent-category requirement groups + the
// manual 1-hour auto-fill trigger (no cron this phase). Read + trigger only;
// all credit-touching work happens server-side through the safe RPC.
// ============================================================================
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  adminListRequirementGroups,
  adminProcessDueRequirementAutoFills,
  adminProcessRequirementAutoFill,
  adminProcessPreferredVendorWindow,
  adminProcessPreferredVendorRechargeWindows,
} from "@/app/actions";

type GroupCounts = {
  total: number;
  client_selected: number;
  auto_assigned: number;
  manual_assigned: number;
  primary: number;
  recovery: number;
  pending_primary_slots: number;
  state: string;
};

type GroupRow = {
  id: string;
  client_phone: string | null;
  client_name: string | null;
  city: string | null;
  parent_category_group: string | null;
  primary_service: string | null;
  client_selection_deadline_at: string | null;
  normal_assignment_expires_at: string | null;
  auto_fill_enabled: boolean | null;
  auto_fill_status: string | null;
  status: string | null;
  preferred_vendor_id: string | null;
  preferred_vendor_name: string | null;
  preferred_vendor_status: string | null;
  preferred_vendor_status_reason: string | null;
  preferred_vendor_recharge_deadline_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  derived: GroupCounts;
};

/** Read the package-audit warning (vendor has credits but no active package). */
function packageAuditWarning(metadata: Record<string, unknown> | null): string | null {
  const warning = (metadata as { package_audit_warning?: { message?: string } } | null)?.package_audit_warning;
  return warning && typeof warning.message === "string" ? warning.message : null;
}

const FILTERS = [
  "All",
  "Interior",
  "Sofa",
  "Painting",
  "Civil Work",
  "Preferred vendor waiting",
  "Waiting for client selection",
  "Auto-fill due",
  "Auto-fill failed",
  "Needs admin top-up",
  "Fully assigned",
  "Recovery active",
] as const;
type FilterKey = (typeof FILTERS)[number];

function maskPhone(phone: string | null): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return `••• ••• ${digits.slice(-4)}`;
}

function fmt(value: string | null): string {
  if (!value) return "—";
  const t = Date.parse(value);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString();
}

function stateLabel(state: string): string {
  return state.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function preferredStatusLabel(status: string | null): string {
  switch (status) {
    case "assigned_immediately":
      return "Assigned immediately";
    case "waiting_for_recharge":
      return "Waiting for recharge";
    case "assigned_after_recharge":
      return "Assigned after recharge";
    case "expired":
      return "Expired · auto-fill started";
    case "not_eligible":
      return "Not eligible";
    default:
      return status ? status.replace(/_/g, " ") : "—";
  }
}

export function RequirementGroupsPanel({
  notify,
}: {
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("All");
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await adminListRequirementGroups(200);
    if (res.ok) {
      setRows((res.data as GroupRow[]) ?? []);
    } else {
      setLoadError(res.error);
      setRows([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const state = row.derived?.state ?? "";
      const group = row.parent_category_group ?? "";
      switch (filter) {
        case "All":
          return true;
        case "Interior":
        case "Sofa":
        case "Painting":
        case "Civil Work":
          return group === filter;
        case "Preferred vendor waiting":
          return row.preferred_vendor_status === "waiting_for_recharge";
        case "Waiting for client selection":
          return state === "waiting_for_client_selection";
        case "Auto-fill due":
          return state === "auto_fill_due";
        case "Auto-fill failed":
          return state === "auto_fill_failed";
        case "Needs admin top-up":
          return (row.derived?.pending_primary_slots ?? 0) > 0 && state !== "waiting_for_client_selection" && state !== "auto_fill_due";
        case "Fully assigned":
          return state === "fully_assigned";
        case "Recovery active":
          return state === "recovery_active";
        default:
          return true;
      }
    });
  }, [rows, filter]);

  function processDue() {
    startTransition(async () => {
      const res = await adminProcessDueRequirementAutoFills();
      if (!res.ok) {
        notify(res.error, "error");
        return;
      }
      const processed = (res.data as { processed?: unknown[] }).processed ?? [];
      notify(`Processed ${processed.length} due requirement group(s).`, "success");
      await load();
    });
  }

  function processOne(groupId: string) {
    startTransition(async () => {
      const res = await adminProcessRequirementAutoFill(groupId);
      if (!res.ok) {
        notify(res.error, "error");
        return;
      }
      const data = res.data as { status?: string; filled?: number; message?: string };
      notify(data.message ?? `Auto-fill ${data.status ?? "processed"}.`, data.filled ? "success" : "info");
      await load();
    });
  }

  function processPreferredDue() {
    startTransition(async () => {
      const res = await adminProcessPreferredVendorRechargeWindows();
      if (!res.ok) {
        notify(res.error, "error");
        return;
      }
      const processed = (res.data as { processed?: unknown[] }).processed ?? [];
      notify(`Processed ${processed.length} preferred-vendor window(s).`, "success");
      await load();
    });
  }

  function processPreferred(groupId: string) {
    startTransition(async () => {
      const res = await adminProcessPreferredVendorWindow(groupId);
      if (!res.ok) {
        notify(res.error, "error");
        return;
      }
      const data = res.data as { status?: string; assigned?: boolean; message?: string };
      notify(data.message ?? `Preferred window ${data.status ?? "processed"}.`, data.assigned ? "success" : "info");
      await load();
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">Requirement groups</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            One client is capped at 3 vendors per parent category group. Auto-fill only tops groups up to 3 after the
            1-hour client selection window lapses — it never exceeds 3. Recovery above 3 stays admin-only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={processPreferredDue}
            disabled={pending}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-400 disabled:opacity-50"
          >
            {pending ? "Processing…" : "Process due preferred windows"}
          </button>
          <button
            type="button"
            onClick={processDue}
            disabled={pending}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? "Processing…" : "Process due auto-fills"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              filter === key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      {loadError ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {loadError.includes("MIGRATION") || loadError.includes("migration")
            ? "Requirement groups are unavailable — apply migration 20260701000032_phase26a2d_client_requirement_groups.sql on the live database."
            : loadError}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Group</th>
              <th className="px-3 py-2">Client / City</th>
              <th className="px-3 py-2">Preferred vendor</th>
              <th className="px-3 py-2">Selected / Auto / Manual</th>
              <th className="px-3 py-2">Primary</th>
              <th className="px-3 py-2">Pending</th>
              <th className="px-3 py-2">Recovery</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">Selection deadline</th>
              <th className="px-3 py-2">Auto-fill</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-slate-400">
                  Loading requirement groups…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-slate-400">
                  No requirement groups for this filter yet.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const c = row.derived ?? ({} as GroupCounts);
                const canAutoFill = (c.pending_primary_slots ?? 0) > 0 && row.status === "active";
                return (
                  <tr key={row.id} className="align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{row.parent_category_group ?? "—"}</div>
                      <div className="font-mono text-[11px] text-slate-400">{row.id.slice(0, 8)}</div>
                      {row.primary_service ? <div className="text-[11px] text-slate-500">{row.primary_service}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-slate-700">{row.client_name || "Client"}</div>
                      <div className="text-[11px] text-slate-500">{maskPhone(row.client_phone)}</div>
                      <div className="text-[11px] text-slate-500">{row.city || "—"}</div>
                    </td>
                    <td className="px-3 py-2">
                      {row.preferred_vendor_id ? (
                        <>
                          <div className="text-slate-700">{row.preferred_vendor_name || "Vendor"}</div>
                          <div className="text-[11px] font-medium text-slate-600">{preferredStatusLabel(row.preferred_vendor_status)}</div>
                          {row.preferred_vendor_status_reason ? (
                            <div className="text-[11px] text-slate-500">{row.preferred_vendor_status_reason.replace(/_/g, " ")}</div>
                          ) : null}
                          {row.preferred_vendor_status === "waiting_for_recharge" ? (
                            <div className="text-[11px] text-amber-600">recharge by {fmt(row.preferred_vendor_recharge_deadline_at)}</div>
                          ) : null}
                          {packageAuditWarning(row.metadata) ? (
                            <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-1 text-[11px] text-amber-700">
                              ⚠ {packageAuditWarning(row.metadata)}
                            </div>
                          ) : null}
                        </>
                      ) : packageAuditWarning(row.metadata) ? (
                        <div className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-1 text-[11px] text-amber-700">
                          ⚠ {packageAuditWarning(row.metadata)}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {c.client_selected ?? 0} / {c.auto_assigned ?? 0} / {c.manual_assigned ?? 0}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">{c.primary ?? 0}/3</td>
                    <td className="px-3 py-2 text-slate-700">{c.pending_primary_slots ?? 0}</td>
                    <td className="px-3 py-2 text-slate-700">{c.recovery ?? 0}/6</td>
                    <td className="px-3 py-2 text-slate-700">{c.total ?? 0}/9</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">{fmt(row.client_selection_deadline_at)}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">{row.auto_fill_status ?? "not_started"}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700">
                        {stateLabel(c.state ?? "")}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1.5">
                        {row.preferred_vendor_status === "waiting_for_recharge" ? (
                          <button
                            type="button"
                            onClick={() => processPreferred(row.id)}
                            disabled={pending}
                            className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 transition hover:border-amber-400 disabled:opacity-50"
                          >
                            Process preferred window
                          </button>
                        ) : null}
                        {canAutoFill ? (
                          <button
                            type="button"
                            onClick={() => processOne(row.id)}
                            disabled={pending}
                            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
                          >
                            Assign alternate now
                          </button>
                        ) : null}
                        {row.preferred_vendor_status !== "waiting_for_recharge" && !canAutoFill ? (
                          <span className="text-[11px] text-slate-400">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
