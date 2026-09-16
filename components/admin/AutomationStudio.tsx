"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AutomationStudioDefinition,
  AutomationStudioNode,
  AutomationStudioNodeKind,
  AutomationStudioOverview,
  AutomationStudioSimulationResult,
  AutomationStudioWorkflowKey,
  AutomationStudioWorkflowRuntime,
} from "@/lib/automation/studioContract";

const ENDPOINT = "/api/admin/automation-studio";
const NODE_W = 194;
const NODE_H = 62;

type Tab = "executions" | "versions" | "alerts";
type Tone = "violet" | "magenta" | "red" | "blue" | "green" | "amber";
const toneClass: Record<Tone, string> = {
  violet: "bg-violet-50 text-violet-700 border-violet-100",
  magenta: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100",
  red: "bg-rose-50 text-rose-700 border-rose-100",
  blue: "bg-blue-50 text-blue-700 border-blue-100",
  green: "bg-emerald-50 text-emerald-700 border-emerald-100",
  amber: "bg-amber-50 text-amber-700 border-amber-100",
};

const ACTION_OPTIONS: Readonly<Record<AutomationStudioWorkflowKey, readonly (readonly [string, string])[]>> = Object.freeze({
  client_journey: [
    ["client.transactional_followup", "Client transactional follow-up"],
    ["client.missing_information_reminder", "Missing information reminder"],
    ["client.matching_update", "Client matching update"],
    ["client.lead_status_update", "Client status update"],
    ["vendor.lead_offer", "Vendor Client Match alert"],
  ],
  vendor_journey: [
    ["vendor.onboarding_reminder", "Vendor onboarding reminder"],
    ["vendor.document_reminder", "Vendor document reminder"],
    ["vendor.package_expiry_warning", "Package expiry warning"],
    ["vendor.low_credit_warning", "Low credit warning"],
    ["vendor.lead_offer", "Vendor Client Match alert"],
  ],
  campaigns: [["campaign.execute_recipient", "Campaign recipient execution"]],
  recovery: [],
  orphan_cleanup: [],
  stale_cleanup: [],
});

const nodeTone: Record<AutomationStudioNodeKind, string> = {
  trigger: "border-violet-200 bg-violet-50 text-violet-700",
  condition: "border-amber-200 bg-amber-50 text-amber-700",
  core_action: "border-blue-200 bg-blue-50 text-blue-700",
  whatsapp: "border-emerald-200 bg-emerald-50 text-emerald-700",
  wait: "border-indigo-200 bg-indigo-50 text-indigo-700",
  retry: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  branch: "border-cyan-200 bg-cyan-50 text-cyan-700",
  control: "border-slate-200 bg-slate-50 text-slate-700",
  stop: "border-rose-200 bg-rose-50 text-rose-700",
};
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function formatTime(value: string | null) {
  if (!value) return "No recent run";
  const date = new Date(value);
  const diff = Math.max(0, Date.now() - date.getTime());
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function shortId(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}
export function AutomationStudio() {
  const [overview, setOverview] = useState<AutomationStudioOverview | null>(null);
  const [selectedKey, setSelectedKey] = useState<AutomationStudioWorkflowKey>("client_journey");
  const [draft, setDraft] = useState<AutomationStudioDefinition | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("executions");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<AutomationStudioSimulationResult | null>(null);
  const [dirty, setDirty] = useState(false);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store" });
      const body = await response.json() as AutomationStudioOverview & { error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Automation Studio unavailable.");
      setOverview(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Automation Studio unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selectedWorkflow = useMemo(
    () => overview?.workflows.find((item) => item.key === selectedKey) ?? null,
    [overview, selectedKey],
  );

  useEffect(() => {
    if (!selectedWorkflow) return;
    setDraft(clone(selectedWorkflow.draftDefinition));
    setSelectedNodeId(selectedWorkflow.draftDefinition.nodes[0]?.id ?? null);
    setSimulation(null);
    setDirty(false);
  }, [selectedWorkflow]);

  const selectedNode = draft?.nodes.find((item) => item.id === selectedNodeId) ?? null;

  async function post(body: Record<string, unknown>) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { ok?: boolean; error?: string; [key: string]: unknown };
    if (!response.ok || result.ok === false) throw new Error(result.error || "Automation Studio action failed.");
    return result;
  }

  async function runAction(task: () => Promise<void>) {
    setSaving(true);
    try { await task(); } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Action failed.");
    } finally { setSaving(false); }
  }
  function updateDraft(mutator: (next: AutomationStudioDefinition) => void) {
    if (!draft) return;
    const next = clone(draft);
    mutator(next);
    setDraft(next);
    setDirty(true);
    setSimulation(null);
  }

  async function saveDraft() {
    if (!draft) return;
    await runAction(async () => {
      await post({ action: "save_draft", workflowKey: selectedKey, definition: draft });
      setDirty(false);
      notify("Draft saved safely.");
      await load();
    });
  }

  async function simulate() {
    if (!draft) return;
    await runAction(async () => {
      const result = await post({ action: "simulate", workflowKey: selectedKey, definition: draft });
      setSimulation(result as unknown as AutomationStudioSimulationResult);
      notify("Simulation complete - no live actions were executed.");
    });
  }

  async function publish() {
    if (!draft) return;
    await runAction(async () => {
      await post({ action: "publish", workflowKey: selectedKey, definition: draft, changeSummary: "Published from Automation Studio" });
      setDirty(false);
      notify("Workflow version published.");
      await load();
    });
  }
  async function setGlobalEnabled(enabled: boolean) {
    await runAction(async () => {
      await post({ action: "set_global_enabled", enabled });
      notify(enabled ? "Automation resumed." : "New automation execution paused.");
      await load();
    });
  }

  async function setWorkflowEnabled(workflowKey: AutomationStudioWorkflowKey, enabled: boolean) {
    await runAction(async () => {
      await post({ action: "set_workflow_enabled", workflowKey, enabled });
      notify(enabled ? "Workflow enabled." : "Workflow paused.");
      await load();
    });
  }

  async function rollback(version: number) {
    await runAction(async () => {
      await post({ action: "rollback", workflowKey: selectedKey, version });
      notify(`Rolled back by publishing v${version} as the newest version.`);
      await load();
    });
  }

  function patchSelectedNode(patch: Partial<AutomationStudioNode>) {
    if (!selectedNodeId) return;
    updateDraft((next) => {
      const index = next.nodes.findIndex((item) => item.id === selectedNodeId);
      if (index >= 0) next.nodes[index] = { ...next.nodes[index], ...patch };
    });
  }
  function patchSelectedSetting(key: string, value: string | number | boolean) {
    if (!selectedNode) return;
    patchSelectedNode({ settings: { ...(selectedNode.settings ?? {}), [key]: value } });
  }

  function addPolicyNode(kind: AutomationStudioNodeKind) {
    if (!draft || kind === "trigger" || kind === "core_action" || kind === "control") return;
    if (kind === "whatsapp" && ACTION_OPTIONS[selectedKey].length === 0) {
      notify("This workflow has no certified WhatsApp action block.");
      return;
    }
    const id = `custom-${kind}-${Date.now()}`;
    const anchor = selectedNode;
    const node: AutomationStudioNode = {
      id, kind,
      label: kind === "wait" ? "Wait / Delay" : kind === "whatsapp" ? "WhatsApp Step" : kind[0].toUpperCase() + kind.slice(1),
      description: "New editable policy step",
      authority: "editable_policy",
      enabled: true,
      x: anchor ? anchor.x : 300,
      y: anchor ? anchor.y + 96 : Math.max(120, ...draft.nodes.map((item) => item.y + 90)),
      settings: kind === "wait" ? { durationMinutes: 60 } : kind === "retry" ? { retryAttempts: 3, retryDelaySeconds: 60 } : {},
      actionType: kind === "whatsapp" ? ACTION_OPTIONS[selectedKey][0]?.[0] : undefined,
    };
    updateDraft((next) => {
      next.nodes.push(node);
      if (!anchor || anchor.kind === "condition" || anchor.kind === "branch") return;
      const outgoing = next.edges.find((edge) => edge.from === anchor.id && (!edge.outcome || edge.outcome === "default" || edge.outcome === "success"));
      if (outgoing) {
        const previousTarget = outgoing.to;
        outgoing.to = id;
        next.edges.push({ id: `edge-${Date.now()}-insert`, from: id, to: previousTarget, outcome: "default" });
      } else {
        next.edges.push({ id: `edge-${Date.now()}-append`, from: anchor.id, to: id, outcome: "default" });
      }
    });
    setSelectedNodeId(id);
  }
  function removeSelectedNode() {
    if (!selectedNode || selectedNode.authority === "locked_core") return;
    updateDraft((next) => {
      next.nodes = next.nodes.filter((item) => item.id !== selectedNode.id);
      next.edges = next.edges.filter((edge) => edge.from !== selectedNode.id && edge.to !== selectedNode.id);
    });
    setSelectedNodeId(draft?.nodes[0]?.id ?? null);
  }
  function setEdgeTarget(fromId: string, outcome: "yes" | "no" | "default", toId: string) {
    updateDraft((next) => {
      const matches = (edge: AutomationStudioDefinition["edges"][number]) =>
        edge.from === fromId && (outcome === "default" ? !edge.outcome || edge.outcome === "default" || edge.outcome === "success" : edge.outcome === outcome);
      const existing = next.edges.find(matches);
      if (!toId) {
        next.edges = next.edges.filter((edge) => !matches(edge));
        return;
      }
      if (existing) {
        existing.to = toId;
        existing.outcome = outcome === "default" ? "default" : outcome;
        existing.label = outcome === "yes" ? "Yes" : outcome === "no" ? "No" : undefined;
      } else {
        next.edges.push({ id: `edge-${Date.now()}-${outcome}`, from: fromId, to: toId, outcome: outcome === "default" ? "default" : outcome, label: outcome === "yes" ? "Yes" : outcome === "no" ? "No" : undefined });
      }
    });
  }
  if (loading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading Automation Studio...</div>;
  }
  if (error || !overview || !draft || !selectedWorkflow) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
        <p className="font-semibold text-rose-900">Automation Studio unavailable</p>
        <p className="mt-1 text-sm text-rose-700">{error ?? "No workflow data returned."}</p>
        <button onClick={() => void load()} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Retry</button>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] w-full min-w-0 max-w-full overflow-x-hidden bg-[#f7f8fc] p-1 text-slate-900 sm:p-2">
      {toast ? <div className="fixed right-5 top-20 z-[90] rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-2xl">{toast}</div> : null}
      <StudioHeader overview={overview} saving={saving} onGlobalToggle={setGlobalEnabled} />
      <WorkflowCards workflows={overview.workflows} selectedKey={selectedKey} onSelect={setSelectedKey} onToggle={setWorkflowEnabled} />
      <div className="mt-4 grid gap-4 2xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <BuilderToolbar workflow={selectedWorkflow} dirty={dirty} saving={saving} onSave={saveDraft} onSimulate={simulate} onPublish={publish} />
          <div className="grid min-h-[690px] min-w-0 lg:grid-cols-[190px_1fr]">
            <BlockLibrary onAdd={addPolicyNode} />
            <WorkflowCanvas definition={draft} selectedNodeId={selectedNodeId} simulation={simulation} onSelect={setSelectedNodeId} onMove={(id, x, y) => updateDraft((next) => { const node = next.nodes.find((item) => item.id === id); if (node) { node.x = x; node.y = y; } })} />
          </div>
        </div>
        <NodeInspector node={selectedNode} workflow={selectedWorkflow} definition={draft} onPatch={patchSelectedNode} onSetting={patchSelectedSetting} onConnect={setEdgeTarget} onRemove={removeSelectedNode} />
      </div>
      <ActivityPanel overview={overview} workflow={selectedWorkflow} tab={tab} onTab={setTab} onRollback={rollback} />
    </div>
  );
}
function StudioHeader({ overview, saving, onGlobalToggle }: {
  overview: AutomationStudioOverview;
  saving: boolean;
  onGlobalToggle: (enabled: boolean) => Promise<void>;
}) {
  const healthy = overview.nativeEngine.healthy;
  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5 xl:flex-row xl:items-center xl:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-3"><StudioMark /><h1 className="min-w-0 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Automation Studio</h1></div>
        <p className="mt-1 max-w-full break-words text-sm leading-5 text-slate-500">Design, control and monitor QuickFurno automation from the native engine.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <HealthPill label={healthy ? "System healthy" : "Native engine needs attention"} healthy={healthy} />
        <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{overview.nativeEngine.mode.toUpperCase()}</span>
        <button
          type="button"
          disabled={saving}
          onClick={() => void onGlobalToggle(!overview.globalEnabled)}
          className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-sm transition disabled:opacity-50 ${overview.globalEnabled ? "bg-violet-600 hover:bg-violet-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
        >{overview.globalEnabled ? "Pause All Automations" : "Resume Automations"}</button>
      </div>
    </div>
  );
}
function WorkflowCards({ workflows, selectedKey, onSelect, onToggle }: {
  workflows: AutomationStudioWorkflowRuntime[];
  selectedKey: AutomationStudioWorkflowKey;
  onSelect: (key: AutomationStudioWorkflowKey) => void;
  onToggle: (key: AutomationStudioWorkflowKey, enabled: boolean) => Promise<void>;
}) {
  return (
    <div className="mt-4 grid w-full min-w-0 max-w-full gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {workflows.map((workflow) => (
        <button key={workflow.key} type="button" onClick={() => onSelect(workflow.key)}
          className={`min-w-0 rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${selectedKey === workflow.key ? "border-violet-300 ring-2 ring-violet-100" : "border-slate-200"}`}>
          <div className="flex items-start justify-between gap-3">
            <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${toneClass[workflow.accent]}`}><WorkflowGlyph tone={workflow.accent} /></span>
            <MiniToggle checked={workflow.enabled} onChange={(checked) => void onToggle(workflow.key, checked)} />
          </div>
          <h2 className="mt-3 text-sm font-bold text-slate-950">{workflow.name}</h2>
          <p className="mt-0.5 min-h-[32px] text-[11px] leading-4 text-slate-500">{workflow.shortDescription}</p>
          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500"><span>Success 24h</span><b className="text-slate-800">{workflow.successRate24h == null ? "-" : `${workflow.successRate24h}%`}</b></div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500"><span>Queue</span><b className="text-slate-800">{workflow.queue}</b></div>
          <div className="mt-3 flex items-center justify-between"><HealthPill compact label={workflow.health} healthy={workflow.health === "healthy"} /><span className="text-[10px] font-semibold text-slate-400">v{workflow.currentVersion}</span></div>
        </button>
      ))}
    </div>
  );
}
function BuilderToolbar({ workflow, dirty, saving, onSave, onSimulate, onPublish }: {
  workflow: AutomationStudioWorkflowRuntime;
  dirty: boolean;
  saving: boolean;
  onSave: () => Promise<void>;
  onSimulate: () => Promise<void>;
  onPublish: () => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
      <div className="flex items-center gap-3">
        <div><p className="text-sm font-bold text-slate-950">Workflow Builder</p><p className="text-[11px] text-slate-500">{workflow.name} / {workflow.engineLane}</p></div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${workflow.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{workflow.enabled ? "ACTIVE" : "PAUSED"}</span>
        {dirty ? <span className="text-[10px] font-bold text-amber-600">UNSAVED</span> : null}
      </div>
      <div className="flex items-center gap-2">
        <button disabled={saving || !dirty} onClick={() => void onSave()} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">Save Draft</button>
        <button disabled={saving} onClick={() => void onSimulate()} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 disabled:opacity-40">Simulate</button>
        <button disabled={saving} onClick={() => void onPublish()} className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-sm disabled:opacity-40">Publish</button>
      </div>
    </div>
  );
}
function BlockLibrary({ onAdd }: { onAdd: (kind: AutomationStudioNodeKind) => void }) {
  const blocks: Array<[AutomationStudioNodeKind, string, string]> = [
    ["condition", "Condition", "Decision logic"], ["whatsapp", "WhatsApp", "Approved message"],
    ["wait", "Wait / Delay", "Bounded pause"], ["retry", "Retry", "Core retry policy"],
    ["branch", "Branch", "Split the flow"], ["stop", "Stop", "End safely"],
  ];
  return (
    <aside className="border-b border-slate-200 bg-slate-50/70 p-3 lg:border-b-0 lg:border-r">
      <p className="mb-3 px-1 text-[11px] font-extrabold uppercase tracking-[.14em] text-slate-400">Add policy step</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {blocks.map(([kind, label, detail]) => (
          <button key={kind} type="button" onClick={() => onAdd(kind)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition hover:border-violet-200 hover:shadow">
            <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${nodeTone[kind]}`}><NodeGlyph kind={kind} /></span>
            <span><span className="block text-xs font-bold text-slate-800">{label}</span><span className="block text-[10px] text-slate-400">{detail}</span></span>
          </button>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-[10px] leading-4 text-blue-800">
        <b>Core actions are locked.</b><br />New business authority is added in code, certified, then appears here as a reusable block.
      </div>
    </aside>
  );
}
function WorkflowCanvas({ definition, selectedNodeId, simulation, onSelect, onMove }: {
  definition: AutomationStudioDefinition;
  selectedNodeId: string | null;
  simulation: AutomationStudioSimulationResult | null;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
}) {
  const byId = new Map(definition.nodes.map((item) => [item.id, item]));
  const visited = new Set(simulation?.visited.map((item) => item.nodeId) ?? []);
  const height = Math.max(700, ...definition.nodes.map((item) => item.y + 120));
  return (
    <div className="overflow-auto bg-white">
      <div className="relative min-w-[820px] bg-[radial-gradient(#dbe1ea_1px,transparent_1px)] [background-size:18px_18px]" style={{ height }}>
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {definition.edges.map((edge) => {
            const from = byId.get(edge.from); const to = byId.get(edge.to); if (!from || !to) return null;
            const x1 = from.x + NODE_W / 2, y1 = from.y + NODE_H;
            const x2 = to.x + NODE_W / 2, y2 = to.y;
            const midY = (y1 + y2) / 2;
            return <g key={edge.id}><path d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`} fill="none" stroke="#94a3b8" strokeWidth="1.6" />{edge.label ? <text x={(x1+x2)/2+6} y={midY-4} fontSize="10" fill="#64748b">{edge.label}</text> : null}</g>;
          })}
        </svg>
        {definition.nodes.map((node) => (
          <button key={node.id} type="button" draggable
            onDragEnd={(event) => {
              const parent = event.currentTarget.parentElement?.getBoundingClientRect();
              if (!parent) return;
              onMove(node.id, Math.max(12, Math.round(event.clientX - parent.left - NODE_W / 2)), Math.max(12, Math.round(event.clientY - parent.top - NODE_H / 2)));
            }}
            onClick={() => onSelect(node.id)}
            style={{ left: node.x, top: node.y, width: NODE_W, minHeight: NODE_H }}
            className={`absolute rounded-xl border bg-white p-2.5 text-left shadow-sm transition hover:shadow-md ${selectedNodeId === node.id ? "border-violet-400 ring-2 ring-violet-100" : visited.has(node.id) ? "border-emerald-300 ring-2 ring-emerald-100" : "border-slate-200"}`}>
            <div className="flex items-start gap-2">
              <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${nodeTone[node.kind]}`}><NodeGlyph kind={node.kind} /></span>
              <span className="min-w-0"><span className="block truncate text-[11px] font-extrabold text-slate-900">{node.label}</span><span className="mt-0.5 block line-clamp-2 text-[9px] leading-3 text-slate-500">{node.description}</span></span>
            </div>
            <span className={`absolute -right-1.5 -top-1.5 h-3 w-3 rounded-full border-2 border-white ${node.authority === "locked_core" ? "bg-blue-500" : "bg-violet-500"}`} />
          </button>
        ))}
        {simulation ? <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-emerald-200 bg-emerald-50/95 p-3 text-[10px] text-emerald-800 shadow-sm"><b>Simulation path:</b> {simulation.visited.map((item) => item.label).join(" -> ")}<span className="ml-2 text-emerald-600">No live mutation or send.</span></div> : null}
      </div>
    </div>
  );
}
function NodeInspector({ node, workflow, definition, onPatch, onSetting, onConnect, onRemove }: {
  node: AutomationStudioNode | null;
  workflow: AutomationStudioWorkflowRuntime;
  definition: AutomationStudioDefinition;
  onPatch: (patch: Partial<AutomationStudioNode>) => void;
  onSetting: (key: string, value: string | number | boolean) => void;
  onConnect: (fromId: string, outcome: "yes" | "no" | "default", toId: string) => void;
  onRemove: () => void;
}) {
  if (!node) return <aside className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Select a workflow step.</aside>;
  const locked = node.authority === "locked_core";
  const targets = definition.nodes.filter((item) => item.id !== node.id);
  const outgoing = definition.edges.filter((edge) => edge.from === node.id);
  const targetFor = (outcome: "yes" | "no" | "default") => {
    const edge = outgoing.find((item) => outcome === "default"
      ? !item.outcome || item.outcome === "default" || item.outcome === "success"
      : item.outcome === outcome);
    return edge?.to ?? "";
  };
  const branchStep = node.kind === "condition" || node.kind === "branch";
  return (
    <aside className="self-start rounded-2xl border border-slate-200 bg-white shadow-sm 2xl:sticky 2xl:top-4">
      <div className="border-b border-slate-200 px-5 py-4"><p className="text-sm font-bold text-slate-950">Step Configuration</p><p className="mt-1 text-[11px] text-slate-500">{workflow.name}</p></div>
      <div className="space-y-4 p-5">
        <div className={`rounded-xl border p-3 ${locked ? "border-blue-100 bg-blue-50" : "border-violet-100 bg-violet-50"}`}>
          <div className="flex items-center gap-2"><span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border ${nodeTone[node.kind]}`}><NodeGlyph kind={node.kind} /></span><div><p className="text-xs font-bold text-slate-900">{node.label}</p><p className="text-[10px] text-slate-500">{locked ? "Locked QuickFurno Core authority" : "Editable orchestration policy"}</p></div></div>
        </div>
        <Field label="Step name"><input disabled={locked} value={node.label} onChange={(e) => onPatch({ label: e.target.value })} className="qfas-input" /></Field>
        <Field label="Description"><textarea disabled={locked} value={node.description} onChange={(e) => onPatch({ description: e.target.value })} rows={3} className="qfas-input resize-none" /></Field>
        {Object.entries(node.settings ?? {}).map(([key, value]) => (
          <Field key={key} label={humanize(key)}>
            {typeof value === "boolean" ? <MiniToggle checked={value} onChange={(checked) => onSetting(key, checked)} /> : (
              <input type={typeof value === "number" ? "number" : "text"} value={String(value ?? "")}
                onChange={(e) => onSetting(key, typeof value === "number" ? Number(e.target.value) : e.target.value)} className="qfas-input" />
            )}
          </Field>
        ))}
        {node.kind === "whatsapp" && !locked ? (
          <Field label="Certified Core action">
            <select value={node.actionType ?? ""} onChange={(event) => onPatch({ actionType: event.target.value })} className="qfas-input">
              {ACTION_OPTIONS[workflow.key].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
        ) : node.actionType ? (
          <Field label="Core action"><div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-mono text-slate-600">{node.actionType}</div></Field>
        ) : null}
        {node.capability ? <Field label="Certified capability"><div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-mono text-blue-700">{node.capability}</div></Field> : null}
        {!locked ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-bold text-slate-800">Flow connections</p>
            <p className="mb-3 mt-1 text-[10px] leading-4 text-slate-500">Choose where this policy step continues. Core-owned routes stay locked.</p>
            {branchStep ? (
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                <ConnectionSelect label="Yes path" value={targetFor("yes")} targets={targets} onChange={(value) => onConnect(node.id, "yes", value)} />
                <ConnectionSelect label="No path" value={targetFor("no")} targets={targets} onChange={(value) => onConnect(node.id, "no", value)} />
              </div>
            ) : (
              <ConnectionSelect label="Next step" value={targetFor("default")} targets={targets} onChange={(value) => onConnect(node.id, "default", value)} />
            )}
          </div>
        ) : outgoing.length ? (
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-[10px] leading-4 text-blue-800">
            <b>Locked route:</b> {outgoing.map((edge) => definition.nodes.find((item) => item.id === edge.to)?.label ?? edge.to).join(" / ")}
          </div>
        ) : null}
        <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-3"><div><p className="text-xs font-semibold text-slate-800">Enable this step</p><p className="text-[10px] text-slate-400">Locked Core steps cannot be disabled.</p></div><MiniToggle checked={node.enabled} disabled={locked} onChange={(checked) => onPatch({ enabled: checked })} /></div>
        {!locked ? <button type="button" onClick={onRemove} className="w-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">Remove policy step</button> : null}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[10px] leading-4 text-slate-500"><b className="text-slate-700">Safety boundary:</b> this editor cannot change SQL, secrets, HMAC signing, assignment authority, credit authority, provider credentials or arbitrary HTTP endpoints.</div>
      </div>
    </aside>
  );
}
function ConnectionSelect({ label, value, targets, onChange }: {
  label: string;
  value: string;
  targets: AutomationStudioNode[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold text-slate-600">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="qfas-input">
        <option value="">No connection</option>
        {targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
      </select>
    </label>
  );
}

function ActivityPanel({ overview, workflow, tab, onTab, onRollback }: {
  overview: AutomationStudioOverview;
  workflow: AutomationStudioWorkflowRuntime;
  tab: Tab;
  onTab: (tab: Tab) => void;
  onRollback: (version: number) => Promise<void>;
}) {
  const executions = overview.executions.filter((item) => item.workflowKey === workflow.key || item.workflowKey === "unknown").slice(0, 12);
  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-4 pt-3">
        <TabButton active={tab === "executions"} onClick={() => onTab("executions")}>Live Executions</TabButton>
        <TabButton active={tab === "versions"} onClick={() => onTab("versions")}>Workflow Versions</TabButton>
        <TabButton active={tab === "alerts"} onClick={() => onTab("alerts")}>Runtime Health</TabButton>
        <button onClick={() => location.reload()} className="ml-auto mb-2 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600">Refresh</button>
      </div>
      {tab === "executions" ? <ExecutionTable rows={executions} /> : null}
      {tab === "versions" ? <VersionTable workflow={workflow} onRollback={onRollback} /> : null}
      {tab === "alerts" ? <RuntimeHealth overview={overview} /> : null}
    </section>
  );
}

function ExecutionTable({ rows }: { rows: AutomationStudioOverview["executions"] }) {
  if (!rows.length) return <EmptyPanel text="No recent executions for this workflow." />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[11px]"><thead className="bg-slate-50 text-slate-500"><tr>{["ID","Action","Current step","Status","Started","Attempts"].map((h) => <th key={h} className="px-4 py-2.5 font-bold">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id} className="text-slate-700"><td className="px-4 py-3 font-mono text-[10px]">{shortId(row.id)}</td><td className="px-4 py-3">{row.actionType ?? "Maintenance"}</td><td className="px-4 py-3 font-semibold">{row.currentStep}</td><td className="px-4 py-3"><Status value={row.status} /></td><td className="px-4 py-3">{formatDate(row.startedAt)}</td><td className="px-4 py-3">{row.attemptCount}</td></tr>)}</tbody></table></div>;
}
function VersionTable({ workflow, onRollback }: { workflow: AutomationStudioWorkflowRuntime; onRollback: (version: number) => Promise<void> }) {
  if (!workflow.versions.length) return <EmptyPanel text="No published version history yet. Publish this workflow to create v1." />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[11px]"><thead className="bg-slate-50 text-slate-500"><tr>{["Version","Published","Summary","Actor","Action"].map((h) => <th key={h} className="px-4 py-2.5 font-bold">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{workflow.versions.map((version) => <tr key={version.version}><td className="px-4 py-3 font-bold text-slate-800">v{version.version}</td><td className="px-4 py-3 text-slate-600">{formatDate(version.publishedAt)}</td><td className="px-4 py-3 text-slate-700">{version.changeSummary}</td><td className="px-4 py-3 font-mono text-[10px] text-slate-500">{shortId(version.publishedBy)}</td><td className="px-4 py-3"><button disabled={version.version === workflow.currentVersion} onClick={() => void onRollback(version.version)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-bold text-violet-700 disabled:opacity-30">Rollback</button></td></tr>)}</tbody></table></div>;
}

function RuntimeHealth({ overview }: { overview: AutomationStudioOverview }) {
  const items = [
    ["QuickFurno Native Engine", overview.nativeEngine.healthy ? "Healthy" : "Needs attention"],
    ["Runtime mode", overview.nativeEngine.mode],
    ["Worker state", overview.nativeEngine.state],
    ["Engine version", overview.nativeEngine.engineVersion ?? "Not seen"],
    ["Production worker", overview.nativeEngine.workerId ?? "Not seen"],
    ["Worker cycles", String(overview.nativeEngine.cycles)],
    ["Jobs processed", String(overview.nativeEngine.jobsProcessed)],
    ["Automation queue", String(overview.queueTotal)],
    ["Last claim", formatTime(overview.nativeEngine.lastClaimAt)],
    ["Last success", formatTime(overview.nativeEngine.lastSuccessAt)],
    ["Last heartbeat", formatTime(overview.nativeEngine.lastHeartbeatAt)],
    ["Last safe code", overview.nativeEngine.lastSafeCode ?? "None"],
    ["Lead dispatch lane", formatTime(overview.nativeEngine.systemLanes.leadAssignmentDispatchAt)],
    ["Consent acknowledgement lane", formatTime(overview.nativeEngine.systemLanes.consentAckAt)],
    ["Delayed fill lane", formatTime(overview.nativeEngine.systemLanes.delayedFillAt)],
  ];
  return <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">{items.map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">{label}</p><p className="mt-2 break-all text-sm font-bold text-slate-900">{value}</p></div>)}</div>;
}

function EmptyPanel({ text }: { text: string }) { return <div className="p-8 text-center text-sm text-slate-500">{text}</div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">{label}</span>{children}</label>;
}

function MiniToggle({ checked, disabled = false, onChange }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <span role="switch" aria-checked={checked} aria-disabled={disabled} onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!checked); }}
    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition ${checked ? "bg-emerald-500" : "bg-slate-300"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}>
    <span className={`h-4 w-4 rounded-full bg-white shadow transition ${checked ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
  </span>;
}

function HealthPill({ label, healthy, compact = false }: { label: string; healthy: boolean; compact?: boolean }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full font-bold ${compact ? "px-2 py-1 text-[9px]" : "px-3 py-2 text-[11px]"} ${healthy ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}><span className={`h-1.5 w-1.5 rounded-full ${healthy ? "bg-emerald-500" : "bg-amber-500"}`} />{label}</span>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`border-b-2 px-3 pb-3 pt-1 text-[11px] font-bold transition ${active ? "border-violet-600 text-violet-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{children}</button>;
}
function Status({ value }: { value: string }) {
  const positive = value === "succeeded";
  const active = value === "pending" || value === "processing" || value === "retry_scheduled";
  return <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${positive ? "bg-emerald-50 text-emerald-700" : active ? "bg-blue-50 text-blue-700" : "bg-rose-50 text-rose-700"}`}>{value.replaceAll("_", " ")}</span>;
}

function humanize(value: string) {
  return value.replace(/([A-Z])/g, " $1").replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());
}

function StudioMark() {
  return <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-200"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M5 4h5v5H5zM14 4h5v5h-5zM5 15h5v5H5zM14 15h5v5h-5zM10 6.5h4M7.5 9v6M16.5 9v6M10 17.5h4" /></svg></span>;
}

function WorkflowGlyph({ tone }: { tone: Tone }) {
  const paths: Record<Tone, string> = { violet: "M5 12h4l3-6 3 12 2-6h2", magenta: "M4 19V8l8-4 8 4v11M8 19v-5h8v5", red: "M4 12h4l8-6v12l-8-6H4zM18 9v6", blue: "M7 7a7 7 0 1 1-1 8M7 7V3M7 7h4", green: "M12 3l7 4v5c0 4-2.5 7-7 9-4.5-2-7-5-7-9V7zM9 12l2 2 4-5", amber: "M12 7v5l3 2M5 5l2 2M19 5l-2 2M12 3v2M4 12H2M22 12h-2" };
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[tone]} /></svg>;
}
function NodeGlyph({ kind }: { kind: AutomationStudioNodeKind }) {
  const path: Record<AutomationStudioNodeKind, string> = {
    trigger: "M8 5l10 7-10 7z",
    condition: "M12 3l8 9-8 9-8-9z",
    core_action: "M5 5h14v14H5zM8 9h8M8 13h5",
    whatsapp: "M4 20l1-4a8 8 0 1 1 3 3zM9 10c1 2 2 3 5 4",
    wait: "M12 7v5l3 2M12 3a9 9 0 1 1-9 9",
    retry: "M6 8a7 7 0 1 1-1 7M6 8V4M6 8h4",
    branch: "M6 4v16M6 8h6a4 4 0 0 1 4 4v8M16 12l-3-3M16 12l3-3",
    control: "M4 12h16M12 4v16M7 7l10 10M17 7L7 17",
    stop: "M7 7l10 10M17 7L7 17M12 3a9 9 0 1 1-9 9",
  };
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={path[kind]} /></svg>;
}

