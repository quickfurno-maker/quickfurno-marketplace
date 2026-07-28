"use client";
// ============================================================================
// QF-MVP-30.5C1 — Communication frequency policy history manager.
//
// The operator surface for the Core rule that bounds how often a recipient may
// be contacted. It can LIST history, PUBLISH a new explicit version and RETIRE
// an active one — nothing else.
//
// Deliberately absent, because the database refuses them anyway:
//   * no edit of a published policy (its meaning is frozen);
//   * no delete and no truncate;
//   * no reactivate of a retired policy;
//   * no silent replacement of an active policy.
//
// NO DEFAULT IS PREFILLED. The threshold and window are a business decision, so
// every field starts empty. The examples below are descriptive placeholder text
// only — they are never submitted, and an empty field is rejected rather than
// substituted.
// ============================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  frequencyPolicyCreate, frequencyPolicyList, frequencyPolicyRetire,
} from "@/app/actions/campaignHandoffActions";
import {
  SectionCard, PrimaryButton, SecondaryButton, StatusBadge, DataTable, EmptyState, Toast,
} from "../../AdminPrimitives";

type Policy = {
  id: string; channel: string; scope: string;
  minInterval: string; maxPerWindow: number; windowLength: string;
  isActive: boolean; effectiveFrom: string; effectiveTo: string | null;
  policyReference: string; createdBy: string | null; createdAt: string; updatedAt: string;
};

const CHANNELS = ["whatsapp", "sms", "email", "dashboard"];
const SCOPES = ["transactional", "marketing"];

const EMPTY_FORM = {
  channel: "", scope: "", maxPerWindow: "", windowHours: "", minIntervalHours: "",
  policyReference: "", effectiveFrom: "", effectiveTo: "",
};

export function FrequencyPolicyManager({ policies }: { policies: Policy[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Policy[]>(policies ?? []);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const busy = pending || inFlight;

  function set(field: keyof typeof EMPTY_FORM, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function reload() {
    const res = await frequencyPolicyList();
    if (res.ok) setRows(res.data as Policy[]);
  }

  function publish() {
    if (busy) return;
    setInFlight(true);
    startTransition(async () => {
      try {
        const res = await frequencyPolicyCreate({
          channel: form.channel,
          scope: form.scope,
          maxPerWindow: form.maxPerWindow,
          windowHours: form.windowHours,
          minIntervalHours: form.minIntervalHours,
          policyReference: form.policyReference,
          effectiveFrom: form.effectiveFrom || undefined,
          effectiveTo: form.effectiveTo || undefined,
        });
        if (!res.ok) setToast({ message: res.error, tone: "error" });
        else {
          setToast({ message: "New frequency policy published.", tone: "success" });
          setForm({ ...EMPTY_FORM });
          await reload();
          router.refresh();
        }
      } finally {
        setInFlight(false);
      }
    });
  }

  function retire(id: string) {
    if (busy) return;
    setInFlight(true);
    startTransition(async () => {
      try {
        const res = await frequencyPolicyRetire(id);
        if (!res.ok) setToast({ message: res.error, tone: "error" });
        else {
          setToast({ message: "Policy retired. Its history is retained.", tone: "success" });
          await reload();
          router.refresh();
        }
      } finally {
        setInFlight(false);
      }
    });
  }

  const activeCount = rows.filter((r) => r.isActive).length;

  return (
    <>
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}

      <SectionCard
        title="Publish a new frequency policy"
        description="Every value is an explicit business decision. Nothing is prefilled, and a published policy can never be edited — publish a new version instead."
      >
        <div className="qf-form-grid">
          <label>
            Channel
            <select value={form.channel} onChange={(e) => set("channel", e.target.value)}>
              <option value="">Select a channel…</option>
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            Purpose
            <select value={form.scope} onChange={(e) => set("scope", e.target.value)}>
              <option value="">Select a purpose…</option>
              {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            Maximum messages per window
            <input
              type="number" min={0} max={1000} inputMode="numeric"
              value={form.maxPerWindow} placeholder="e.g. 1"
              onChange={(e) => set("maxPerWindow", e.target.value)}
            />
          </label>
          <label>
            Window length (hours)
            <input
              type="number" min={1} max={8760} inputMode="numeric"
              value={form.windowHours} placeholder="e.g. 168 for 7 days"
              onChange={(e) => set("windowHours", e.target.value)}
            />
          </label>
          <label>
            Minimum gap between messages (hours)
            <input
              type="number" min={0} max={8760} inputMode="numeric"
              value={form.minIntervalHours} placeholder="e.g. 24"
              onChange={(e) => set("minIntervalHours", e.target.value)}
            />
          </label>
          <label>
            Approval reference
            <input
              type="text" maxLength={200} value={form.policyReference}
              placeholder="Who approved this rule, and where it is recorded"
              onChange={(e) => set("policyReference", e.target.value)}
            />
          </label>
        </div>
        <p className="qf-note">
          Placeholders are examples only — they are never submitted. Publishing requires an explicit
          value in every field. At most one policy can be active per channel and purpose, so retire
          the current one first.
        </p>
        <div className="qf-actions">
          <PrimaryButton onClick={busy ? undefined : publish}>
            {busy ? "Working…" : "Publish policy"}
          </PrimaryButton>
        </div>
      </SectionCard>

      <SectionCard
        title="Policy history"
        description={`${activeCount} active, ${rows.length - activeCount} retired. History is append-only — retired rules are retained, never deleted.`}
      >
        {rows.length === 0 ? (
          <EmptyState
            title="No frequency policy has been published"
            message="Until an active policy exists, campaign handoff fails closed and no campaign can create communication intents."
          />
        ) : (
          <DataTable
            rows={rows}
            emptyTitle="No frequency policy has been published"
            emptyMessage="Until an active policy exists, campaign handoff fails closed."
            columns={[
              { header: "State",
                cell: (r: Policy) => <StatusBadge value={r.isActive ? "active" : "retired"} tone={r.isActive ? "emerald" : "slate"} /> },
              { header: "Channel", cell: (r: Policy) => r.channel },
              { header: "Purpose", cell: (r: Policy) => r.scope },
              { header: "Threshold", cell: (r: Policy) => `${r.maxPerWindow} per ${r.windowLength}` },
              { header: "Minimum gap", cell: (r: Policy) => r.minInterval },
              { header: "Effective",
                cell: (r: Policy) => `${r.effectiveFrom}${r.effectiveTo ? ` → ${r.effectiveTo}` : ""}` },
              { header: "Approval reference", cell: (r: Policy) => r.policyReference },
              { header: "Created", cell: (r: Policy) => r.createdAt },
              { header: "",
                cell: (r: Policy) => (r.isActive
                  ? <SecondaryButton onClick={busy ? undefined : () => retire(r.id)}>Retire</SecondaryButton>
                  : <span className="qf-muted">Retired</span>) },
            ]}
          />
        )}
      </SectionCard>
    </>
  );
}
