"use client";

// ============================================================================
// QuickFurno AOS — Phase 13: Lead Assignment Approval Workflow (Preview Only)
//
// Superadmin control surface to review a lead, see a vendor match preview,
// select up to 3 vendors, and APPROVE the assignment in preview mode.
//
// Talks ONLY to:
//   GET  /api/admin/lead-assignment-preview?leadId=
//   POST /api/admin/lead-assignment-approval
// It never sees the service-role key, the n8n webhook URL, or any secret — the
// APIs return masked/labelled data only.
//
// Preview-only by design: approving NEVER sends WhatsApp, notifies vendors,
// deducts credits, or auto-assigns leads. Only a preview approval record is
// saved. The n8n call depends on the Phase 12 two-lock safety gate.
// ============================================================================
import { useCallback, useMemo, useState } from "react";
import {
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  StatCard,
  StatusBadge,
} from "./AdminPrimitives";
import type { Lead } from "./adminTypes";

const PREVIEW_ENDPOINT = "/api/admin/lead-assignment-preview";
const APPROVAL_ENDPOINT = "/api/admin/lead-assignment-approval";
const MAX_VENDORS = 3;

interface PreviewLead {
  id: string;
  name: string | null;
  maskedPhone: string | null;
  city: string | null;
  area: string | null;
  category: string | null;
  budget: string | null;
  propertyType: string | null;
  timeline: string | null;
  status: string | null;
  message: string | null;
  currentAssignmentCount: number;
  assignmentStatusLabel: string;
}

interface PreviewVendor {
  id: string;
  businessName: string;
  city: string | null;
  areasCovered: string[];
  coversFullCity: boolean;
  serviceCategories: string[];
  categoryMatch: boolean;
  localityMatch: boolean;
  paidStatus: string | null;
  priority: boolean;
  remainingCredits: number;
  totalCredits: number;
  rating: number;
  completedProjects: number;
  matchReason: string;
  eligible: boolean;
  eligibilityReasons: string[];
  packageStatus: string;
}

interface PreviewPayload {
  ok: true;
  lead: PreviewLead;
  suggestedVendors: PreviewVendor[];
  maxSelectableVendors: number;
  agents: string[];
}

interface ApprovalResult {
  ok: true;
  status: string;
  assignmentApprovalId: string;
  selectedVendorCount: number;
  aosEventEmitted: boolean;
  n8nWebhookCalled: boolean;
  mockMode: boolean;
  runtimeAutomationEnabled: boolean;
  runtimeAutomationMode: string;
  sideEffects: {
    whatsappSent: boolean;
    vendorNotified: boolean;
    creditsDeducted: boolean;
    leadAutoAssigned: boolean;
    n8nWebhookCalled: boolean;
    databaseWritten: string;
  };
  reason: string;
  message: string;
}

export function LeadAssignmentApprovalControl({
  leads,
  notify,
}: {
  leads: Lead[];
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [approvalNote, setApprovalNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ApprovalResult | null>(null);

  const leadOptions = useMemo(
    () =>
      leads
        .filter((lead) => lead.id)
        .map((lead) => ({
          id: lead.id,
          label: `${lead.name || "Unnamed lead"} · ${lead.city || "City?"} · ${lead.service_required || lead.category || "Category?"}`,
        })),
    [leads],
  );

  const loadPreview = useCallback(
    async (leadId: string) => {
      if (!leadId) return;
      setLoading(true);
      setPreview(null);
      setResult(null);
      setSelectedVendorIds([]);
      try {
        const res = await fetch(`${PREVIEW_ENDPOINT}?leadId=${encodeURIComponent(leadId)}`, {
          method: "GET",
          cache: "no-store",
        });
        if (res.status === 403) {
          notify("Superadmin access is required for assignment approvals.", "error");
          return;
        }
        const data = (await res.json()) as PreviewPayload & { error?: string };
        if (!res.ok || !data?.ok) {
          notify(data?.error ?? "Could not load the assignment preview.", "error");
          return;
        }
        setPreview(data);
      } catch {
        notify("Could not reach the assignment preview endpoint.", "error");
      } finally {
        setLoading(false);
      }
    },
    [notify],
  );

  function toggleVendor(vendor: PreviewVendor) {
    if (!vendor.eligible) {
      notify(`Not eligible: ${vendor.eligibilityReasons.join(", ")}.`, "info");
      return;
    }
    setSelectedVendorIds((current) => {
      if (current.includes(vendor.id)) return current.filter((id) => id !== vendor.id);
      if (current.length >= MAX_VENDORS) {
        notify(`You can select at most ${MAX_VENDORS} vendors for one lead.`, "info");
        return current;
      }
      return [...current, vendor.id];
    });
  }

  async function approve() {
    if (!preview) return;
    if (selectedVendorIds.length === 0) {
      notify("Select at least one vendor to approve.", "info");
      return;
    }
    if (selectedVendorIds.length > MAX_VENDORS) {
      notify(`You can select at most ${MAX_VENDORS} vendors for one lead.`, "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(APPROVAL_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadId: preview.lead.id,
          selectedVendorIds,
          approvalNote: approvalNote.trim() || null,
        }),
      });
      const data = (await res.json()) as ApprovalResult & { error?: string };
      if (!res.ok || !data?.ok) {
        notify(data?.error ?? "Could not save the assignment approval.", "error");
        return;
      }
      setResult(data);
      notify("Assignment approval saved in preview mode.", "success");
    } catch {
      notify("Could not save the assignment approval.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Lead Assignment Approval Preview"
        description="Review a lead, see the vendor match preview, select up to 3 vendors, and approve in preview mode. This never sends WhatsApp, notifies vendors, deducts credits, or auto-assigns leads."
        action={<StatusBadge value="Preview only" tone="amber" />}
      >
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong className="font-semibold">Safe preview.</strong> Approving saves a preview/draft record only. No vendor
          notification, no WhatsApp, no credit deduction, and no auto-assignment is performed. n8n is called only when the
          Phase 12 two-lock safety gate is fully ON (preview mode).
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500">Lead</span>
            <select
              value={selectedLeadId}
              onChange={(event) => {
                const next = event.target.value;
                setSelectedLeadId(next);
                void loadPreview(next);
              }}
              className="mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
            >
              <option value="">Select a lead to review...</option>
              {leadOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <SecondaryButton onClick={() => void loadPreview(selectedLeadId)}>
            {loading ? "Loading..." : "Reload preview"}
          </SecondaryButton>
        </div>
      </SectionCard>

      {loading ? (
        <SectionCard title="Loading preview" description="Reading lead details and matching vendors...">
          <p className="text-sm text-slate-500">Building the safe vendor match preview...</p>
        </SectionCard>
      ) : null}

      {!loading && !preview ? (
        <EmptyState
          title="No lead selected"
          message="Choose a lead above to see its details and a preview of matching vendors. Nothing is assigned until you approve a preview, and even then no vendor is notified."
        />
      ) : null}

      {preview ? (
        <>
          {/* Lead details */}
          <SectionCard title="Lead details" description="Client context for this assignment preview.">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="City" value={preview.lead.city ?? "Not set"} helper={preview.lead.area ? `Area: ${preview.lead.area}` : "Area not set"} icon="leads" tone="slate" />
              <StatCard label="Category" value={preview.lead.category ?? "Not set"} helper="Service required" icon="categories" tone="indigo" />
              <StatCard label="Budget" value={preview.lead.budget ?? "Not set"} helper={preview.lead.timeline ? `Timeline: ${preview.lead.timeline}` : "Timeline not set"} icon="payments" tone="emerald" />
              <StatCard label="Assignment status" value={preview.lead.assignmentStatusLabel} helper={`Lead status: ${preview.lead.status ?? "New"}`} icon="distribution" tone={preview.lead.currentAssignmentCount > 0 ? "emerald" : "amber"} />
            </section>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Info label="Client" value={preview.lead.name ?? "Not provided"} />
              <Info label="Phone (masked)" value={preview.lead.maskedPhone ?? "Not provided"} />
              <Info label="Property type" value={preview.lead.propertyType ?? "Not provided"} />
              <Info label="Requirement" value={preview.lead.message ?? "No requirement message"} />
            </dl>
          </SectionCard>

          {/* Suggested vendors */}
          <SectionCard
            title="Suggested vendors"
            description="Approved, active, credited vendors in this city. Select up to 3 to approve in preview mode."
            action={<StatusBadge value={`${selectedVendorIds.length}/${MAX_VENDORS} selected`} tone={selectedVendorIds.length >= MAX_VENDORS ? "emerald" : "slate"} />}
          >
            {preview.suggestedVendors.length === 0 ? (
              <EmptyState
                title="No matching vendors"
                message="No approved, active, credited vendor matched this lead's city. Nothing to approve. No assignment or notification is attempted."
                compact
              />
            ) : (
              <div className="grid gap-3">
                {preview.suggestedVendors.map((vendor) => {
                  const checked = selectedVendorIds.includes(vendor.id);
                  const blockedByMax = !checked && selectedVendorIds.length >= MAX_VENDORS;
                  const disabled = !vendor.eligible || blockedByMax;
                  return (
                    <button
                      key={vendor.id}
                      type="button"
                      onClick={() => toggleVendor(vendor)}
                      disabled={disabled}
                      title={!vendor.eligible ? `Not eligible: ${vendor.eligibilityReasons.join(", ")}` : undefined}
                      className={`rounded-xl border px-4 py-3 text-left transition ${
                        checked
                          ? "border-emerald-300 bg-emerald-50/60 ring-2 ring-emerald-200"
                          : disabled
                            ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
                            : "border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-950">{vendor.businessName}</span>
                            {vendor.priority ? <StatusBadge value="Priority" tone="violet" /> : null}
                            <StatusBadge value={vendor.eligible ? "Eligible" : "Not eligible"} tone={vendor.eligible ? "emerald" : "rose"} />
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {vendor.city ?? "City?"}
                            {vendor.coversFullCity ? " · full city" : vendor.areasCovered.length ? ` · ${vendor.areasCovered.slice(0, 3).join(", ")}` : ""}
                          </p>
                        </div>
                        <span
                          className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border text-xs font-bold ${
                            checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white text-transparent"
                          }`}
                          aria-hidden
                        >
                          ✓
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <StatusBadge value={vendor.categoryMatch ? "Category match" : "Category mismatch"} tone={vendor.categoryMatch ? "emerald" : "rose"} />
                        <StatusBadge value={`Pkg: ${vendor.packageStatus}`} tone={vendor.packageStatus === "active" || vendor.packageStatus === "trial" ? "emerald" : "slate"} />
                        <StatusBadge value={`${vendor.remainingCredits} credits`} tone={vendor.remainingCredits > 0 ? "emerald" : "rose"} />
                        <StatusBadge value={vendor.rating ? `${vendor.rating}/5` : "No rating"} tone="slate" />
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-500">{vendor.matchReason}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Approval */}
          <SectionCard title="Approve assignment preview" description="Saves a preview/draft approval record and emits the safe lead.assignment_approved AOS event. No vendor is notified.">
            <label className="block">
              <span className="text-xs font-semibold uppercase text-slate-500">Approval note (optional)</span>
              <textarea
                value={approvalNote}
                onChange={(event) => setApprovalNote(event.target.value)}
                placeholder="Why these vendors? Notes are stored on the preview record only."
                className="mt-1 min-h-24 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <PrimaryButton onClick={() => void approve()}>
                {submitting ? "Saving preview..." : "Approve Assignment Preview"}
              </PrimaryButton>
              <span className="text-xs font-medium text-slate-500">
                {selectedVendorIds.length} of max {MAX_VENDORS} vendors selected
              </span>
            </div>
          </SectionCard>

          {/* Success panel */}
          {result ? <ApprovalSuccessPanel result={result} /> : null}
        </>
      ) : null}
    </div>
  );
}

function ApprovalSuccessPanel({ result }: { result: ApprovalResult }) {
  return (
    <SectionCard
      title="Assignment approval saved in preview mode"
      description="Preview/draft record stored. No live assignment was executed."
      action={<StatusBadge value={result.mockMode ? "Mock mode" : "Preview forwarded"} tone={result.mockMode ? "slate" : "emerald"} />}
    >
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <ul className="space-y-1">
          <li>Assignment approval saved in preview mode.</li>
          <li>No vendor notification sent.</li>
          <li>No WhatsApp sent.</li>
          <li>No credits deducted.</li>
          <li>No auto-assignment executed.</li>
        </ul>
      </div>

      <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Approval record" value={result.status} helper={`ID ${result.assignmentApprovalId.slice(0, 8)}`} icon="reports" tone="indigo" />
        <StatCard label="Vendors selected" value={String(result.selectedVendorCount)} helper="Preview only" icon="vendors" tone="slate" />
        <StatCard label="n8n webhook" value={result.n8nWebhookCalled ? "Called" : "Not called"} helper={result.mockMode ? "mockMode=true" : "mockMode=false"} icon="automations" tone={result.n8nWebhookCalled ? "emerald" : "slate"} />
        <StatCard label="Runtime switch" value={result.runtimeAutomationEnabled ? `ON · ${result.runtimeAutomationMode}` : "OFF"} helper="Phase 12 Lock 2" icon="aos" tone={result.runtimeAutomationEnabled ? "emerald" : "slate"} />
      </section>

      <p className="mt-4 text-sm text-slate-500">{result.reason}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SafeRow label="WhatsApp sent" value={result.sideEffects.whatsappSent} />
        <SafeRow label="Vendor notified" value={result.sideEffects.vendorNotified} />
        <SafeRow label="Credits deducted" value={result.sideEffects.creditsDeducted} />
        <SafeRow label="Lead auto-assigned" value={result.sideEffects.leadAutoAssigned} />
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span className="text-sm font-medium text-slate-700">Database written</span>
          <StatusBadge value="Preview approval record only" tone="blue" />
        </div>
      </div>
    </SectionCard>
  );
}

function SafeRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <StatusBadge value={value ? "Yes" : "No"} tone={value ? "rose" : "emerald"} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
