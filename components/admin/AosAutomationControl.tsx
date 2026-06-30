"use client";

// ============================================================================
// QuickFurno AOS — Phase 12: Admin-Controlled AOS / n8n Activation Switch (UI)
//
// Superadmin control surface for the AOS -> n8n master router runtime switch.
// Talks ONLY to /api/admin/aos-runtime-settings. It never sees the n8n webhook
// URL or QF_N8N_SECRET — the API returns booleans and labels only.
//
// Preview-only by design: this never sends WhatsApp, notifies vendors, deducts
// credits, auto-assigns leads, or writes to the DB from n8n.
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import { PrimaryButton, SecondaryButton, SectionCard, StatCard, StatusBadge } from "./AdminPrimitives";

type RuntimeMode = "off" | "preview" | "production_locked";

interface RuntimeStatus {
  ok: boolean;
  envLock: {
    n8nEnabled: boolean;
    outboundWebhookEnabled: boolean;
    bothEnabled: boolean;
  };
  runtime: {
    enabled: boolean;
    mode: RuntimeMode;
    description: string | null;
    updatedBy: string | null;
    updatedAt: string | null;
    exists: boolean;
  };
  shouldCallN8n: boolean;
  reason: string;
  selectableModes: RuntimeMode[];
  safetyStatus: {
    whatsappSending: string;
    vendorNotification: string;
    creditDeduction: string;
    autoAssignment: string;
    n8nDatabaseWrites: string;
  };
}

const ENDPOINT = "/api/admin/aos-runtime-settings";

const MODE_OPTIONS: Array<{ value: RuntimeMode; label: string; disabled?: boolean }> = [
  { value: "off", label: "Off" },
  { value: "preview", label: "Preview" },
  { value: "production_locked", label: "Production (coming soon)", disabled: true },
];

export function AosAutomationControl({ notify }: { notify: (message: string, tone?: "success" | "error" | "info") => void }) {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Draft (uncommitted) form state.
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<RuntimeMode>("off");

  const applyStatus = useCallback((data: RuntimeStatus) => {
    setStatus(data);
    setEnabled(data.runtime.enabled);
    setMode(data.runtime.mode === "production_locked" ? "off" : data.runtime.mode);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(ENDPOINT, { method: "GET", cache: "no-store" });
      if (res.status === 403) {
        setLoadError("Superadmin access is required to manage this switch.");
        return;
      }
      const data = (await res.json()) as RuntimeStatus;
      if (!res.ok || !data?.ok) {
        setLoadError("Could not load the automation status.");
        return;
      }
      applyStatus(data);
    } catch {
      setLoadError("Could not reach the automation status endpoint.");
    } finally {
      setLoading(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, mode: enabled ? mode : "off" }),
      });
      const data = (await res.json()) as RuntimeStatus & { error?: string };
      if (!res.ok || !data?.ok) {
        notify(data?.error ?? "Could not save the automation switch.", "error");
        return;
      }
      applyStatus(data);
      notify("AOS automation switch saved.", "success");
    } catch {
      notify("Could not save the automation switch.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SectionCard title="AOS / n8n Automation Control" description="Loading current automation status...">
        <p className="text-sm text-slate-500">Reading the two-lock safety state...</p>
      </SectionCard>
    );
  }

  if (loadError || !status) {
    return (
      <SectionCard title="AOS / n8n Automation Control" description="Admin-controlled AOS event forwarding to the n8n Master Preview Router.">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {loadError ?? "Automation status is unavailable right now."}
        </div>
        <div className="mt-4">
          <SecondaryButton onClick={() => void load()}>Retry</SecondaryButton>
        </div>
      </SectionCard>
    );
  }

  const dirty = enabled !== status.runtime.enabled || (enabled ? mode : "off") !== status.runtime.mode;
  const liveOn = status.shouldCallN8n;

  return (
    <div className="space-y-5">
      <SectionCard
        title="AOS / n8n Automation Control"
        description="Two-lock safety: the server env (Lock 1) and this admin switch (Lock 2) must both be ON before any event is forwarded to the n8n Master Preview Router."
        action={<StatusBadge value={liveOn ? "Forwarding (preview)" : "Mock / safe mode"} tone={liveOn ? "emerald" : "slate"} />}
      >
        {/* Status cards */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Lock 1 · N8N_ENABLED"
            value={status.envLock.n8nEnabled ? "Available" : "Disabled"}
            helper="Server environment flag"
            icon="automations"
            tone={status.envLock.n8nEnabled ? "emerald" : "slate"}
          />
          <StatCard
            label="Lock 1 · Outbound Webhook"
            value={status.envLock.outboundWebhookEnabled ? "Available" : "Disabled"}
            helper="N8N_OUTBOUND_WEBHOOK_ENABLED"
            icon="automations"
            tone={status.envLock.outboundWebhookEnabled ? "emerald" : "slate"}
          />
          <StatCard
            label="Lock 2 · Runtime Switch"
            value={status.runtime.enabled ? "ON" : "OFF"}
            helper="AOS n8n Master Router"
            icon="aos"
            tone={status.runtime.enabled ? "emerald" : "slate"}
          />
          <StatCard
            label="Current Mode"
            value={modeLabel(status.runtime.mode)}
            helper={`Last updated ${formatUpdated(status.runtime.updatedAt)}`}
            icon="aos"
            tone={status.runtime.mode === "preview" ? "indigo" : "slate"}
          />
        </section>

        {/* Warning banner */}
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong className="font-semibold">Preview mode only.</strong> This does not send WhatsApp,
          notify vendors, deduct credits, or auto-assign leads.
        </div>

        {/* Combined gate reason */}
        <p className="mt-3 text-sm text-slate-500">{status.reason}</p>
      </SectionCard>

      {/* Controls */}
      <SectionCard
        title="Controls"
        description="Enable AOS → n8n preview routing and choose the mode. Saving updates the runtime switch (Lock 2) only; Lock 1 stays controlled by the server environment."
      >
        <div className="space-y-5">
          {/* Toggle */}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Enable AOS → n8n Preview Routing</p>
              <p className="mt-1 text-xs text-slate-500">When OFF, AOS events stay in safe mock mode and n8n is never called.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled((value) => !value)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${enabled ? "bg-emerald-500" : "bg-slate-300"}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${enabled ? "translate-x-5" : "translate-x-1"}`} />
            </button>
          </div>

          {/* Mode segmented control */}
          <div className={enabled ? "" : "opacity-50"}>
            <p className="text-xs font-semibold uppercase text-slate-500">Mode</p>
            <div className="mt-2 inline-flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-1">
              {MODE_OPTIONS.map((option) => {
                const active = (enabled ? mode : "off") === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={option.disabled || !enabled}
                    onClick={() => {
                      if (option.disabled) return;
                      setMode(option.value);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                      active
                        ? "bg-emerald-600 text-white shadow-sm"
                        : option.disabled
                          ? "cursor-not-allowed text-slate-300"
                          : "text-slate-600 hover:bg-slate-100"
                    }`}
                    title={option.disabled ? "Coming soon. Locked for safety." : undefined}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">Only Off and Preview are usable. Production mode is locked for safety and coming soon.</p>
          </div>

          {/* Save + Refresh */}
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <PrimaryButton onClick={() => void save()}>{saving ? "Saving..." : "Save"}</PrimaryButton>
            <SecondaryButton onClick={() => void load()}>Refresh status</SecondaryButton>
            {dirty ? <span className="text-xs font-semibold text-amber-600">Unsaved changes</span> : null}
          </div>
        </div>
      </SectionCard>

      {/* Safety status */}
      <SectionCard title="Safety status" description="These side effects are hard-disabled in this phase and do not depend on the switch above.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SafetyRow label="WhatsApp sending" value={status.safetyStatus.whatsappSending} />
          <SafetyRow label="Vendor notification" value={status.safetyStatus.vendorNotification} />
          <SafetyRow label="Credit deduction" value={status.safetyStatus.creditDeduction} />
          <SafetyRow label="Auto assignment" value={status.safetyStatus.autoAssignment} />
          <SafetyRow label="n8n DB writes" value={status.safetyStatus.n8nDatabaseWrites} />
        </div>
      </SectionCard>
    </div>
  );
}

function SafetyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <StatusBadge value={value} tone="rose" />
    </div>
  );
}

function modeLabel(mode: RuntimeMode): string {
  if (mode === "preview") return "Preview";
  if (mode === "production_locked") return "Production (locked)";
  return "Off";
}

function formatUpdated(value: string | null): string {
  if (!value) return "not yet set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString();
}
