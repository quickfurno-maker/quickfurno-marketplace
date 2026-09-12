"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  StatCard,
  StatusBadge,
} from "./AdminPrimitives";

interface AosV2Status {
  ok: boolean;
  runtime: {
    intelligenceEnabled: boolean;
    mode: "off" | "shadow";
    actionProposalsEnabled: boolean;
    legacyDirectN8nRetired: true;
  };
  persistenceReady: boolean;
  counts: {
    totalAgents: number;
    operationalAgents: number;
    runs24h: number;
    completed24h: number;
    failed24h: number;
    recommendations24h: number;
    proposable24h: number;
  };
  architecture: {
    coreAuthority: true;
    directN8nFromAos: false;
    legacyPreviewRouterRetired: true;
    oldWorkflowKernelInstalledByAosV2: false;
    actionProposalsEnabled: boolean;
  };
  agents: Array<{
    slug: string;
    name: string;
    purpose: string;
    state: "operational" | "registered_inactive";
    authority: "advisory_only";
    sourceOfTruth: string;
  }>;
  latestRuns: Array<Record<string, unknown>>;
  latestRecommendations: Array<Record<string, unknown>>;
  error?: string;
}

const ENDPOINT = "/api/admin/aos-runtime-settings";

export function AosAutomationControl({
  notify,
}: {
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [status, setStatus] = useState<AosV2Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((next: AosV2Status) => {
    setStatus(next);
    setDraftEnabled(next.runtime.intelligenceEnabled);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store" });
      const body = (await response.json()) as AosV2Status;
      if (!response.ok || !body.ok) {
        setError(body.error ?? "Could not load AOS V2 status.");
        return;
      }
      apply(body);
    } catch {
      setError("Could not reach the AOS V2 status endpoint.");
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: draftEnabled }),
      });
      const body = (await response.json()) as AosV2Status;
      if (!response.ok || !body.ok) {
        notify(body.error ?? "Could not update AOS V2.", "error");
        return;
      }
      apply(body);
      notify(
        draftEnabled
          ? "AOS V2 intelligence enabled in shadow/advisory mode."
          : "AOS V2 intelligence disabled.",
        "success",
      );
    } catch {
      notify("Could not update AOS V2.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SectionCard title="AOS V2 Intelligence" description="Reading the production AOS control plane...">
        <p className="text-sm text-slate-500">Loading runtime, persistence and agent state.</p>
      </SectionCard>
    );
  }

  if (error || !status) {
    return (
      <SectionCard title="AOS V2 Intelligence" description="Production intelligence control plane.">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error ?? "AOS V2 status is unavailable."}
        </div>
        <div className="mt-4"><SecondaryButton onClick={() => void load()}>Retry</SecondaryButton></div>
      </SectionCard>
    );
  }

  const dirty = draftEnabled !== status.runtime.intelligenceEnabled;
  const operational = status.agents.filter((agent) => agent.state === "operational");

  return (
    <div className="space-y-5">
      <SectionCard
        title="AOS V2 Intelligence"
        description="AOS observes canonical QuickFurno Core facts and produces durable recommendations. Core remains the only business authority; AOS has no direct n8n path."
        action={
          <StatusBadge
            value={status.runtime.intelligenceEnabled ? "Active · shadow" : "Off"}
            tone={status.runtime.intelligenceEnabled ? "emerald" : "slate"}
          />
        }
      >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Persistence" value={status.persistenceReady ? "Ready" : "Migration required"} helper="AOS V2 durable tables" icon="aos" tone={status.persistenceReady ? "emerald" : "amber"} />
          <StatCard label="Runs · 24h" value={String(status.counts.runs24h)} helper={`${status.counts.completed24h} completed · ${status.counts.failed24h} failed`} icon="aos" tone="indigo" />
          <StatCard label="Recommendations · 24h" value={String(status.counts.recommendations24h)} helper={`${status.counts.proposable24h} carry a governed proposal hint`} icon="automations" tone="indigo" />
          <StatCard label="Agents" value={String(status.counts.operationalAgents)} helper="Canonical operational agents" icon="aos" tone="slate" />
        </section>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <ArchitectureRow label="QuickFurno Core business authority" good={status.architecture.coreAuthority} />
          <ArchitectureRow label="Direct AOS → n8n" good={!status.architecture.directN8nFromAos} value="Retired / impossible" />
          <ArchitectureRow label="Legacy preview router" good={status.architecture.legacyPreviewRouterRetired} value="Retired" />
          <ArchitectureRow label="Old AOS workflow kernel" good={!status.architecture.oldWorkflowKernelInstalledByAosV2} value="Not installed" />
          <ArchitectureRow label="AOS action proposals" good={!status.architecture.actionProposalsEnabled} value={status.architecture.actionProposalsEnabled ? "Enabled" : "Locked off"} />
        </div>
      </SectionCard>

      <SectionCard title="Runtime control" description="This switch controls intelligence only. It cannot enable messaging, assignment, credits or n8n execution.">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Enable AOS V2 intelligence</p>
            <p className="mt-1 text-xs text-slate-500">Shadow/advisory mode. Recommendations are durable but never self-authorize.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draftEnabled}
            onClick={() => setDraftEnabled((value) => !value)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${draftEnabled ? "bg-emerald-500" : "bg-slate-300"}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${draftEnabled ? "translate-x-5" : "translate-x-1"}`} />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <PrimaryButton onClick={() => void save()}>{saving ? "Saving..." : "Save AOS state"}</PrimaryButton>
          <SecondaryButton onClick={() => void load()}>Refresh</SecondaryButton>
          {dirty ? <span className="self-center text-xs font-semibold text-amber-600">Unsaved change</span> : null}
        </div>
      </SectionCard>

      <SectionCard title={`Operational agents · ${operational.length}`} description="These identities now have certified AOS V2 adapters to canonical Core truth.">
        <AgentGrid agents={operational} />
      </SectionCard>

    </div>
  );
}

function ArchitectureRow({ label, good, value }: { label: string; good: boolean; value?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <span className="text-sm text-slate-700">{label}</span>
      <StatusBadge value={value ?? (good ? "Yes" : "No")} tone={good ? "emerald" : "rose"} />
    </div>
  );
}

function AgentGrid({ agents }: { agents: AosV2Status["agents"] }) {
  if (!agents.length) return <p className="text-sm text-slate-500">No agents in this state.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {agents.map((agent) => (
        <div key={agent.slug} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">{agent.name}</p>
            <StatusBadge value="Operational" tone="emerald" />
          </div>
          <p className="mt-2 text-xs text-slate-600">{agent.purpose}</p>
          <p className="mt-2 text-[11px] text-slate-500">Source: {agent.sourceOfTruth}</p>
        </div>
      ))}
    </div>
  );
}
