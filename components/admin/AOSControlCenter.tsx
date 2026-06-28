"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DataTable,
  InfoGrid,
  ProgressBar,
  SecondaryButton,
  SectionCard,
  StatCard,
  StatusBadge,
  Tabs,
} from "./AdminPrimitives";
import type { Snapshot } from "./adminTypes";
import { AOS_AGENT_REGISTRY } from "@/lib/aos/agents/agentRegistry";
import { getPreviewWorkflowRoutes } from "@/lib/aos/events/n8nPreviewWorkflowMap";
import {
  AUTO_ASSIGNMENT_ENABLED,
  CREDIT_DEDUCTION_ENABLED,
  N8N_ENABLED,
  N8N_OUTBOUND_WEBHOOK_ENABLED,
  WHATSAPP_SENDING_ENABLED,
} from "@/lib/aos/config/featureFlags";
import type {
  AOSAgent,
  AOSAgentLog,
  AOSAgentMemory,
  AOSAgentPermission,
  AOSAgentPrompt,
  AOSAgentRule,
  AOSAgentVersion,
  AOSApprovalRequest,
  AOSCostLog,
  AOSFailure,
  AOSTestRun,
} from "@/lib/aos/types";

type AOSControlCenterProps = {
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  data: Snapshot;
};

type AOSDisplayStatus = "foundation" | "testing" | "future" | "inactive" | "paused";

const tabs = [
  "Agent Overview",
  "Agent Logs",
  "Agent Logic",
  "Prompt Versions",
  "Rule Versions",
  "Agent Memory",
  "Test Lab",
  "Approval Queue",
  "Error Center",
  "Cost Monitor",
  "Security Permissions",
  "Rollback Center",
];

const foundationSlugs = new Set(["nexus-kernel", "furno-memory", "lead-lens", "trust-shield", "match-forge", "lead-flow", "ops-brief"]);
const pausedSlugs = new Set(["whatsapp-pilot"]);
const safeAgentTestEvents = ["lead.created", "lead.qualified", "lead.assignment_preview", "aos.failure"];
const n8nWorkflowRoutes = getPreviewWorkflowRoutes();

const agents: AOSAgent[] = AOS_AGENT_REGISTRY.map((entry) => {
  const status: AOSDisplayStatus = foundationSlugs.has(entry.slug)
    ? entry.num <= 2 ? "foundation" : "testing"
    : pausedSlugs.has(entry.slug) ? "paused" : entry.num <= 24 ? "future" : "inactive";
  const isFoundation = foundationSlugs.has(entry.slug);

  return {
    id: `agent-${entry.slug}`,
    agent_key: entry.slug,
    agent_name: entry.name,
    purpose: entry.purpose,
    status,
    version: isFoundation ? "0.1.0-foundation" : "0.1.0-future",
    mode: isFoundation ? "rule_based" : "placeholder",
    last_run_at: isFoundation ? `2026-06-27T${String(8 + entry.num).padStart(2, "0")}:15:00.000Z` : null,
    runs_today: isFoundation ? 6 + entry.num : 0,
    success_rate: isFoundation ? Math.max(86, 98 - entry.num) : null,
    error_count: isFoundation ? entry.num % 2 : 0,
    average_confidence: isFoundation ? Math.max(72, 88 - entry.num) : null,
    average_response_time_ms: isFoundation ? 360 + entry.num * 28 : null,
    memory_access: isFoundation ? `${entry.slug.replaceAll("-", " ")} memory` : "No memory access",
    permission_level: isFoundation ? "mock read-only" : "disabled",
    created_at: "2026-06-27T00:00:00.000Z",
    updated_at: "2026-06-27T00:00:00.000Z",
    metadata: { group: entry.group, registry_num: entry.num },
  };
});

const agentLogs: AOSAgentLog[] = [
  log("log-001", "lead-lens", "lead_quality_preview", "lead", "lead_mock_8f3a", "Masked Pune interior lead with budget and timeline present.", "Qualified preview, no lead update executed.", "recommend_qualified", "Budget, city, service, and urgency are complete.", 0.82, "completed", null),
  log("log-002", "match-forge", "vendor_matching_preview", "lead", "lead_mock_4a91", "Civil work lead, Kharadi area, max 3 vendor cap.", "Two safe vendor candidates found in preview only.", "recommend_manual_review", "Only two eligible vendors in sample set.", 0.76, "completed", null),
  log("log-003", "trust-shield", "spam_signal_preview", "lead", "lead_mock_b218", "Repeated masked phone pattern and vague message.", "Sent to spam review placeholder.", "hold_for_review", "Duplicate-like submission pattern. No status update executed.", 0.69, "blocked", "Permission gate blocks live lead write."),
  log("log-004", "ops-brief", "daily_summary", "report", "report_mock_today", "Admin-safe daily summary using aggregate counts only.", "Generated read-only operations summary placeholder.", "summarize_only", "No secrets or client phone values included.", 0.91, "completed", null),
  log("log-005", "whatsapp-pilot", "send_whatsapp", "message", "message_mock_disabled", "Template send requested in test mode.", "Blocked before provider call.", "block_side_effect", "WhatsApp is disabled in this phase.", 0.99, "blocked", "WhatsApp message failed: provider not connected by design."),
];

const promptVersions: AOSAgentPrompt[] = [
  prompt("prompt-001", "lead-lens", "0.1.0", "active", "Superadmin", "Lead scoring prompt baseline for budget, urgency, duplicate, and service fit."),
  prompt("prompt-002", "lead-lens", "0.2.0-draft", "draft", "Superadmin", "Adds invalid-lead replacement recommendation language."),
  prompt("prompt-003", "match-forge", "0.1.0", "active", "Superadmin", "Vendor matching preview prompt with max 3 vendor rule."),
  prompt("prompt-004", "trust-shield", "0.1.0", "testing", "Superadmin", "Spam and abuse review prompt for manual review."),
  prompt("prompt-005", "ops-brief", "0.0.9", "archived", "Superadmin", "Archived reporting summary prompt."),
];

const agentVersions: AOSAgentVersion[] = [
  version("ver-001", "lead-lens", "0.1.0", "active", "Lead scoring baseline."),
  version("ver-002", "lead-lens", "0.2.0-draft", "draft", "Adds nurture and replacement hints."),
  version("ver-003", "match-forge", "0.1.0", "active", "Vendor preview baseline."),
  version("ver-004", "trust-shield", "0.1.0", "testing", "Spam review baseline."),
  version("ver-005", "ops-brief", "0.0.9", "archived", "Old summary format."),
];

const ruleVersions: AOSAgentRule[] = [
  rule("rule-001", "lead-lens", "LeadLens scoring rules", "0.1.0", "active", "Budget, service completeness, urgency, city support, duplicate risk."),
  rule("rule-002", "trust-shield", "TrustShield spam rules", "0.1.0", "testing", "Repeated masked phone, suspicious text, invalid service, spam-like source."),
  rule("rule-003", "match-forge", "MatchForge vendor matching rules", "0.1.0", "active", "Max 3 vendors, active status, city/category/area, no disabled vendors."),
  rule("rule-004", "lead-flow", "LeadFlow assignment rules", "0.1.0", "draft", "Assignment remains approval-only; invalid leads route to replacement review."),
  rule("rule-005", "ops-brief", "OpsBrief reporting rules", "0.1.0", "active", "Read-only summary by leads, vendors, cost, failures, approvals."),
  rule("rule-006", "lead-nurture", "LeadNurture follow-up rules", "0.1.0", "draft", "Future follow-up timing, reactivation, and nurture-stage placeholders."),
  rule("rule-007", "source-tracker", "SourceTracker attribution rules", "0.1.0", "draft", "Future source, UTM, campaign, referrer, and landing page attribution."),
];

const memoryRows: AOSAgentMemory[] = [
  memory("mem-001", "lead-lens", "lead_quality_signal", "lead", "lead_mock_8f3a", "masked_phone_pattern", "******0553", "lead-lens", 0.81, "2026-07-27T00:00:00.000Z", true),
  memory("mem-002", "match-forge", "vendor_match_context", "vendor", "vendor_mock_21c4", "area_fit", "Kharadi, Viman Nagar, Hadapsar", "match-forge", 0.74, "2026-07-12T00:00:00.000Z", false),
  memory("mem-003", "ops-brief", "daily_summary", "report", "report_mock_today", "assignment_health", "Preview-only. No live assignment triggered.", "ops-brief", 0.88, "2026-06-28T00:00:00.000Z", false),
  memory("mem-004", "trust-shield", "risk_signal", "lead", "lead_mock_b218", "contact_quality", "Masked contact has repeated submissions.", "trust-shield", 0.67, "2026-07-04T00:00:00.000Z", true),
];

const testRuns: AOSTestRun[] = [
  testRun("test-001", "lead-lens", "old: qualified", "new: qualified + nurture_7_days", "Adds nurture stage", "low", "Keep draft for more sample testing."),
  testRun("test-002", "trust-shield", "old: qualified", "new: spam_review", "More conservative spam handling", "medium", "Review manually before activation."),
  testRun("test-003", "match-forge", "old: 3 vendors", "new: 2 vendors", "Excludes low-credit sample vendor", "low", "Good change; verify paid priority later."),
];

const approvalRows: AOSApprovalRequest[] = [
  approval("approval-001", "suspend vendor", "vendor", "vendor_mock_91aa", "critical", "TrustShield recommends manual vendor suspension review."),
  approval("approval-002", "approve replacement lead", "lead", "lead_mock_bad_01", "high", "Vendor reported invalid lead. Replacement, not refund."),
  approval("approval-003", "reject replacement lead", "lead", "lead_mock_bad_02", "medium", "Evidence suggests lead is valid; admin decision required."),
  approval("approval-004", "change package price", "package", "package_growth", "critical", "Revenue-affecting change must be approved."),
  approval("approval-005", "send bulk campaign", "campaign", "campaign_mock_july", "critical", "Messaging disabled until feature flag and templates exist."),
  approval("approval-006", "change vendor priority", "vendor", "vendor_mock_paid", "high", "Paid priority rules are not active yet."),
  approval("approval-007", "publish SEO page", "content", "seo_page_mock", "medium", "ContentCraft publish action is disabled."),
  approval("approval-008", "delete lead/vendor data", "lead", "lead_mock_delete", "critical", "Destructive data action requires separate policy."),
  approval("approval-009", "deduct credits", "vendor", "vendor_mock_credit", "critical", "Credit deduction cannot be automated by AOS."),
];

const failures: AOSFailure[] = [
  failure("fail-001", "lead-lens", "AI API failed", "call-ai-api", "blocked", "AI calls are disabled in this phase."),
  failure("fail-002", "ops-brief", "invalid JSON output", "report.generated", "failed", "Mock parser rejected malformed sample payload."),
  failure("fail-003", "furno-memory", "Supabase insert failed", "memory.write", "blocked", "AOS tables are migration-only suggestions until applied."),
  failure("fail-004", "lead-flow", "n8n webhook failed", "call-n8n", "blocked", "n8n connection is intentionally disabled."),
  failure("fail-005", "whatsapp-pilot", "WhatsApp message failed", "send-whatsapp", "blocked", "WhatsApp sending is intentionally disabled."),
  failure("fail-006", "match-forge", "permission denied", "auto-assign-lead", "blocked", "Live lead distribution is not allowed."),
  failure("fail-007", "trust-shield", "timeout", "spam_signal_preview", "failed", "Sample run exceeded preview timeout."),
  failure("fail-008", "vault-guard", "missing data", "permission.audit", "failed", "Mock audit input missing actor summary."),
];

const costLogs: AOSCostLog[] = [
  cost("cost-001", "lead-lens", "lead_quality_preview", 24, 18200, 0, "0.00", "completed"),
  cost("cost-002", "match-forge", "vendor_matching_preview", 12, 9700, 0, "0.00", "completed"),
  cost("cost-003", "ops-brief", "daily_summary", 4, 4400, 0, "0.00", "completed"),
  cost("cost-004", "trust-shield", "spam_signal_preview", 7, 5100, 0, "0.00", "failed"),
];

const permissions: AOSAgentPermission[] = agents.map((agent) => ({
  id: `perm-${agent.agent_key}`,
  agent_key: agent.agent_key,
  status: agent.status,
  read_leads: ["lead-lens", "match-forge", "lead-flow", "ops-brief", "trust-shield", "lead-nurture", "source-tracker"].includes(agent.agent_key),
  write_leads: false,
  send_whatsapp: false,
  deduct_credits: false,
  access_revenue: agent.agent_key === "revenue-vault",
  access_client_phone: false,
  approval_required: true,
  auto_execute_allowed: false,
  permission_level: agent.permission_level ?? "disabled",
  created_at: "2026-06-27T00:00:00.000Z",
  updated_at: "2026-06-27T00:00:00.000Z",
}));

export function AOSControlCenter({ notify }: AOSControlCenterProps) {
  const [active, setActive] = useState(tabs[0]);
  const [selectedAgent, setSelectedAgent] = useState("lead-lens");
  const [currentVersion, setCurrentVersion] = useState("0.1.0");
  const [draftVersion, setDraftVersion] = useState("0.2.0-draft");

  const stats = useMemo(() => {
    const foundation = agents.filter((agent) => agent.status === "foundation" || agent.status === "testing").length;
    const inactive = agents.filter((agent) => agent.status === "inactive" || agent.status === "future").length;
    const blocked = failures.filter((item) => item.status === "blocked").length;
    const pending = approvalRows.filter((item) => item.status === "pending").length;
    return { foundation, inactive, blocked, pending };
  }, []);

  function placeholder(action: string) {
    notify(`${action} is a safe placeholder. No AI, WhatsApp, n8n, credit, or lead-distribution action was executed.`);
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-900">
        AOS Control Center is in foundation-only mode. All data on this page is mock or safe fallback UI.
        No real AI calls, WhatsApp sends, n8n calls, lead distribution, database edits, or credit deductions are connected here.
      </section>

      <N8nFoundationStatusCard />
      <SafeAgentTestCard />
      <N8nWorkflowRoutesCard />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Agents Registered" value={agents.length} helper={`${stats.foundation} foundation/testing`} icon="aos" tone="indigo" />
        <StatCard label="Inactive/Future" value={stats.inactive} helper="No side effects enabled" icon="settings" tone="slate" />
        <StatCard label="Pending Approvals" value={stats.pending} helper="Human review required" icon="audit" tone="amber" />
        <StatCard label="Blocked Side Effects" value={stats.blocked} helper="Safety gates active" icon="notifications" tone="rose" />
      </section>

      <Tabs tabs={tabs} active={active} onChange={setActive} />

      {active === "Agent Overview" ? <AgentOverview placeholder={placeholder} /> : null}
      {active === "Agent Logs" ? <AgentLogs /> : null}
      {active === "Agent Logic" ? <AgentLogic placeholder={placeholder} /> : null}
      {active === "Prompt Versions" ? <PromptVersions placeholder={placeholder} /> : null}
      {active === "Rule Versions" ? <RuleVersions placeholder={placeholder} /> : null}
      {active === "Agent Memory" ? <AgentMemory /> : null}
      {active === "Test Lab" ? (
        <TestLab
          selectedAgent={selectedAgent}
          setSelectedAgent={setSelectedAgent}
          currentVersion={currentVersion}
          setCurrentVersion={setCurrentVersion}
          draftVersion={draftVersion}
          setDraftVersion={setDraftVersion}
          placeholder={placeholder}
        />
      ) : null}
      {active === "Approval Queue" ? <ApprovalQueue placeholder={placeholder} /> : null}
      {active === "Error Center" ? <ErrorCenter placeholder={placeholder} /> : null}
      {active === "Cost Monitor" ? <CostMonitor /> : null}
      {active === "Security Permissions" ? <SecurityPermissions /> : null}
      {active === "Rollback Center" ? <RollbackCenter /> : null}
    </div>
  );
}

function N8nFoundationStatusCard() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">n8n Foundation Status</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">Safe placeholder only. No webhook, WhatsApp, credits, or assignment path is active.</p>
        </div>
        <StatusBadge value="development mock" tone="slate" />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MiniMetric label="n8n enabled" value={String(N8N_ENABLED)} />
        <MiniMetric label="outbound webhook" value={String(N8N_OUTBOUND_WEBHOOK_ENABLED)} />
        <MiniMetric label="WhatsApp sending" value={String(WHATSAPP_SENDING_ENABLED)} />
        <MiniMetric label="auto assignment" value={String(AUTO_ASSIGNMENT_ENABLED)} />
        <MiniMetric label="credit deduction" value={String(CREDIT_DEDUCTION_ENABLED)} />
        <MiniMetric label="mode" value="development mock" />
      </div>
    </section>
  );
}

function SafeAgentTestCard() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">Safe Agent Test</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Display-only reference for the `/api/aos/events` preview route. The route runs TrustShield,
            LeadLens, MatchForge, LeadFlow, and OpsBrief placeholders with all side effects disabled.
          </p>
        </div>
        <StatusBadge value="safe preview" tone="emerald" />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {safeAgentTestEvents.map((event) => (
          <MiniMetric key={event} label="supported test event" value={event} />
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MiniMetric label="WhatsApp" value="false" />
        <MiniMetric label="credits" value="false" />
        <MiniMetric label="auto assign" value="false" />
        <MiniMetric label="database write" value="false" />
        <MiniMetric label="provider call" value="false" />
        <MiniMetric label="n8n call" value="env-gated" />
      </div>
    </section>
  );
}

function N8nWorkflowRoutesCard() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">n8n Workflow Routes</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Display-only reference of the preview workflow router. No live trigger buttons exist here.
            Routing is documented in `lib/aos/events/n8nPreviewWorkflowMap.ts` and the docs/n8n-workflows folder.
          </p>
        </div>
        <StatusBadge value="template-ready" tone="slate" />
      </div>
      <DataTable
        rows={n8nWorkflowRoutes}
        emptyTitle="No routes"
        emptyMessage="Preview workflow routes will appear here."
        columns={[
          { header: "event type", cell: (row) => row.eventType },
          { header: "preview workflow", cell: (row) => <span className="block min-w-72">{row.workflowName}</span> },
          { header: "status", cell: (row) => <StatusBadge value={row.status} tone={row.status === "template-ready" ? "emerald" : "slate"} /> },
        ]}
      />
    </section>
  );
}

function AgentOverview({ placeholder }: { placeholder: (action: string) => void }) {
  return (
    <div className="space-y-5">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.slice(0, 6).map((agent) => (
          <article key={agent.agent_key} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <Strong title={agent.agent_name} subtitle={agent.agent_key} />
              <StatusBadge value={agent.status} />
            </div>
            <p className="mt-4 min-h-14 text-sm leading-6 text-slate-500">{agent.purpose}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MiniMetric label="Mode" value={agent.mode} />
              <MiniMetric label="Version" value={agent.version} />
              <MiniMetric label="Confidence" value={agent.average_confidence ? `${agent.average_confidence}%` : "N/A"} />
              <MiniMetric label="Response" value={agent.average_response_time_ms ? `${agent.average_response_time_ms}ms` : "N/A"} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {["View Logs", "Test", "Edit Logic", "Pause", "Rollback"].map((action) => (
                <SafeAction key={action} onClick={() => placeholder(`${action} ${agent.agent_name}`)}>{action}</SafeAction>
              ))}
            </div>
          </article>
        ))}
      </section>

      <DataTable
        rows={agents}
        emptyTitle="No agents registered"
        emptyMessage="The AOS agent registry will appear here."
        columns={[
          { header: "agent name", cell: (row) => <Strong title={row.agent_name} subtitle={row.agent_key} /> },
          { header: "purpose", cell: (row) => <span className="block min-w-80">{row.purpose}</span> },
          { header: "status", cell: (row) => <StatusBadge value={row.status} /> },
          { header: "version", cell: (row) => row.version },
          { header: "mode", cell: (row) => row.mode ?? "placeholder" },
          { header: "last run", cell: (row) => formatDateTime(row.last_run_at) },
          { header: "runs today", cell: (row) => row.runs_today ?? 0 },
          { header: "success rate", cell: (row) => <PercentCell value={row.success_rate} /> },
          { header: "error count", cell: (row) => row.error_count ?? 0 },
          { header: "avg confidence", cell: (row) => <PercentCell value={row.average_confidence} /> },
          { header: "avg response time", cell: (row) => row.average_response_time_ms ? `${row.average_response_time_ms}ms` : "N/A" },
          { header: "memory access", cell: (row) => row.memory_access ?? "No memory access" },
          { header: "permission level", cell: (row) => row.permission_level ?? "disabled" },
          { header: "buttons", cell: (row) => <SafeAction onClick={() => placeholder(`Open controls for ${row.agent_name}`)}>Controls</SafeAction> },
        ]}
      />
    </div>
  );
}

function AgentLogs() {
  return (
    <DataTable
      rows={agentLogs}
      emptyTitle="No agent logs"
      emptyMessage="Safe mock logs will appear here until AOS tables are applied."
      columns={[
        { header: "agent_key", cell: (row) => row.agent_key },
        { header: "task_type", cell: (row) => row.task_type },
        { header: "entity_type", cell: (row) => row.entity_type ?? "N/A" },
        { header: "entity_id", cell: (row) => row.entity_id ?? "N/A" },
        { header: "input_summary", cell: (row) => <span className="block min-w-80">{row.input_summary}</span> },
        { header: "output_summary", cell: (row) => <span className="block min-w-80">{row.output_summary}</span> },
        { header: "decision", cell: (row) => row.decision ?? "N/A" },
        { header: "reason", cell: (row) => <span className="block min-w-72">{row.reason}</span> },
        { header: "confidence_score", cell: (row) => `${Math.round(row.confidence_score * 100)}%` },
        { header: "status", cell: (row) => <StatusBadge value={row.status} /> },
        { header: "error_message", cell: (row) => row.error_message ?? "None" },
        { header: "created_at", cell: (row) => formatDateTime(row.created_at) },
      ]}
    />
  );
}

function AgentLogic({ placeholder }: { placeholder: (action: string) => void }) {
  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <SectionCard title="Prompt Logic" description="Read-only placeholder. Live prompt editing is not enabled.">
        <ReadOnlyBox value="Prompt Logic placeholder: draft prompts will be versioned, tested on sample records, approved by superadmin, then activated in a future phase." />
      </SectionCard>
      <SectionCard title="Version Controls" description="Documented controls only. No live logic changes.">
        <InfoGrid
          rows={[
            ["Active Version", "0.1.0"],
            ["Draft Version", "0.2.0-draft"],
            ["Version Notes", "Draft only. No live logic is editable from this UI."],
            ["Live Editing", <StatusBadge key="live-editing" value="Disabled" />],
          ]}
        />
        <div className="mt-5 flex flex-wrap gap-2">
          {["Create New Version", "Test Draft", "Activate Version", "Rollback Version"].map((action) => (
            <SecondaryButton key={action} onClick={() => placeholder(action)}>
              {action}
            </SecondaryButton>
          ))}
        </div>
      </SectionCard>
      <SectionCard title="Rule Logic" description="Read-only placeholder for rule-based versions.">
        <ReadOnlyBox value="Rule Logic placeholder: LeadLens, TrustShield, MatchForge, LeadFlow, OpsBrief, LeadNurture, and SourceTracker rule versions are read-only until migrations and approvals are connected." />
      </SectionCard>
      <SectionCard title="Safety Gates" description="Foundation rules for future live activation.">
        <div className="space-y-3 text-sm leading-6 text-slate-600">
          <p>No live prompt or rule editing is enabled.</p>
          <p>Activation and rollback controls are safe placeholders only.</p>
          <p>Dangerous actions must route through approval queue in a future phase.</p>
        </div>
      </SectionCard>
    </section>
  );
}

function PromptVersions({ placeholder }: { placeholder: (action: string) => void }) {
  return (
    <DataTable
      rows={promptVersions}
      emptyTitle="No prompt versions"
      emptyMessage="Prompt history will appear here after version tables are connected."
      columns={[
        { header: "version", cell: (row) => row.version },
        { header: "agent", cell: (row) => row.agent_key },
        { header: "status", cell: (row) => <StatusBadge value={row.status} /> },
        { header: "created_by", cell: (row) => row.created_by },
        { header: "created_at", cell: (row) => formatDateTime(row.created_at) },
        { header: "state", cell: (row) => row.status },
        { header: "notes", cell: (row) => <span className="block min-w-72">{row.version_notes}</span> },
        { header: "rollback option", cell: (row) => <SafeAction onClick={() => placeholder(`Rollback prompt ${row.version}`)}>Rollback</SafeAction> },
      ]}
    />
  );
}

function RuleVersions({ placeholder }: { placeholder: (action: string) => void }) {
  return (
    <DataTable
      rows={ruleVersions}
      emptyTitle="No rule versions"
      emptyMessage="Business rules will appear here after rule versioning is connected."
      columns={[
        { header: "Rule Set", cell: (row) => <Strong title={row.rule_name} subtitle={row.agent_key} /> },
        { header: "Version", cell: (row) => row.version },
        { header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
        { header: "Rule Summary", cell: (row) => <span className="block min-w-96">{row.rule_summary}</span> },
        { header: "Created", cell: (row) => formatDateTime(row.created_at) },
        { header: "Actions", cell: (row) => <SafeAction onClick={() => placeholder(`Open ${row.rule_name}`)}>Open</SafeAction> },
      ]}
    />
  );
}

function AgentMemory() {
  return (
    <DataTable
      rows={memoryRows}
      emptyTitle="No memory entries"
      emptyMessage="Agent memory will appear here after memory tables are connected."
      columns={[
        { header: "memory_type", cell: (row) => row.memory_type },
        { header: "entity_type", cell: (row) => row.entity_type },
        { header: "entity_id", cell: (row) => row.entity_id },
        { header: "memory_key", cell: (row) => row.memory_key },
        { header: "memory_value", cell: (row) => <span className={row.is_sensitive ? "font-semibold text-slate-900" : ""}>{row.is_sensitive ? maskSensitive(row.memory_value) : row.memory_value}</span> },
        { header: "created_by_agent", cell: (row) => row.created_by_agent },
        { header: "confidence_score", cell: (row) => `${Math.round(row.confidence_score * 100)}%` },
        { header: "expires_at", cell: (row) => formatDateTime(row.expires_at) },
      ]}
    />
  );
}

function TestLab({
  selectedAgent,
  setSelectedAgent,
  currentVersion,
  setCurrentVersion,
  draftVersion,
  setDraftVersion,
  placeholder,
}: {
  selectedAgent: string;
  setSelectedAgent: (value: string) => void;
  currentVersion: string;
  setCurrentVersion: (value: string) => void;
  draftVersion: string;
  setDraftVersion: (value: string) => void;
  placeholder: (action: string) => void;
}) {
  return (
    <div className="space-y-5">
      <SectionCard title="Test Lab" description="Compare current and draft versions on old sample leads. No real AI call is made.">
        <div className="grid gap-3 md:grid-cols-4">
          <SelectBox label="Select agent" value={selectedAgent} onChange={setSelectedAgent} options={agents.map((agent) => agent.agent_key)} />
          <SelectBox label="Current version" value={currentVersion} onChange={setCurrentVersion} options={["0.1.0", "0.0.9", "0.0.8"]} />
          <SelectBox label="Draft version" value={draftVersion} onChange={setDraftVersion} options={["0.2.0-draft", "0.1.1-draft", "No draft"]} />
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => placeholder("Run test on sample old leads")}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              Run sample test
            </button>
          </div>
        </div>
      </SectionCard>
      <DataTable
        rows={testRuns}
        emptyTitle="No test runs"
        emptyMessage="Draft comparison tests will appear here after the test lab is connected."
        columns={[
          { header: "old decision", cell: (row) => row.old_decision },
          { header: "new decision", cell: (row) => row.new_decision },
          { header: "difference", cell: (row) => row.difference },
          { header: "risk", cell: (row) => <StatusBadge value={row.risk} /> },
          { header: "recommendation", cell: (row) => <span className="block min-w-72">{row.recommendation}</span> },
        ]}
      />
    </div>
  );
}

function ApprovalQueue({ placeholder }: { placeholder: (action: string) => void }) {
  return (
    <DataTable
      rows={approvalRows}
      emptyTitle="No pending approvals"
      emptyMessage="Sensitive agent actions will queue here before execution."
      columns={[
        { header: "Action", cell: (row) => <Strong title={row.action_type} subtitle={row.agent_key ?? "manual/admin"} /> },
        { header: "Entity", cell: (row) => `${row.entity_type}: ${row.entity_id}` },
        { header: "Risk", cell: (row) => <StatusBadge value={row.risk_level} /> },
        { header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
        { header: "Summary", cell: (row) => <span className="block min-w-80">{row.request_summary}</span> },
        { header: "Created", cell: (row) => formatDateTime(row.created_at) },
        { header: "Actions", cell: (row) => <SafeAction onClick={() => placeholder(`Review ${row.action_type}`)}>Review</SafeAction> },
      ]}
    />
  );
}

function ErrorCenter({ placeholder }: { placeholder: (action: string) => void }) {
  return (
    <DataTable
      rows={failures}
      emptyTitle="No failures"
      emptyMessage="Failed or blocked agent runs will appear here."
      columns={[
        { header: "Failure", cell: (row) => <Strong title={row.failure_type} subtitle={row.agent_key} /> },
        { header: "Task", cell: (row) => row.task_type },
        { header: "Entity", cell: (row) => row.entity_type ? `${row.entity_type}: ${row.entity_id}` : "Not linked" },
        { header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
        { header: "Error", cell: (row) => <span className="block min-w-72">{row.error_message}</span> },
        { header: "Created", cell: (row) => formatDateTime(row.created_at) },
        { header: "Actions", cell: (row) => <SafeAction onClick={() => placeholder(`Inspect ${row.failure_type}`)}>Inspect</SafeAction> },
      ]}
    />
  );
}

function CostMonitor() {
  const runsToday = costLogs.reduce((sum, row) => sum + row.runs_count, 0);
  const tokenEstimate = costLogs.reduce((sum, row) => sum + row.token_estimate, 0);
  const failedRuns = costLogs.filter((row) => row.status === "failed").reduce((sum, row) => sum + row.runs_count, 0);

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Agent Runs Today" value={runsToday} helper="Mock cost log total" icon="aos" />
        <StatCard label="Token Estimate" value={tokenEstimate.toLocaleString("en-IN")} helper="No real model usage" icon="reports" tone="indigo" />
        <StatCard label="Cost Estimate" value="INR 0.00" helper="No AI provider connected" icon="payments" tone="emerald" />
        <StatCard label="Failed Cost" value="INR 0.00" helper={`${failedRuns} failed mock runs`} icon="audit" tone="rose" />
      </section>
      <InfoGrid
        rows={[
          ["Cost per lead", "INR 0.00"],
          ["Monthly estimate", "INR 0.00"],
          ["Most expensive agent", "None. No real AI calls."],
          ["Billing status", <StatusBadge key="billing" value="Not connected" />],
        ]}
      />
      <DataTable
        rows={costLogs}
        emptyTitle="No cost logs"
        emptyMessage="Cost logs will appear after cost tracking is connected."
        columns={[
          { header: "Agent", cell: (row) => row.agent_key },
          { header: "Task", cell: (row) => row.task_type },
          { header: "Runs", cell: (row) => row.runs_count },
          { header: "Token Estimate", cell: (row) => row.token_estimate.toLocaleString("en-IN") },
          { header: "Cost Estimate", cell: (row) => `INR ${row.cost_estimate}` },
          { header: "Cost per lead", cell: (row) => `INR ${row.cost_per_lead ?? "0.00"}` },
          { header: "Monthly estimate", cell: (row) => `INR ${row.monthly_estimate ?? 0}` },
          { header: "Failed cost", cell: (row) => `INR ${row.failed_cost ?? 0}` },
          { header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
          { header: "Created", cell: (row) => formatDateTime(row.created_at) },
        ]}
      />
    </div>
  );
}

function SecurityPermissions() {
  return (
    <DataTable
      rows={permissions}
      emptyTitle="No permissions"
      emptyMessage="Agent permissions will appear here after permission tables are connected."
      columns={[
        { header: "Agent", cell: (row) => <Strong title={row.agent_key} subtitle={row.permission_level} /> },
        { header: "read leads", cell: (row) => <Bool value={row.read_leads} /> },
        { header: "write leads", cell: (row) => <Bool value={row.write_leads} /> },
        { header: "send WhatsApp", cell: (row) => <Bool value={row.send_whatsapp} /> },
        { header: "deduct credits", cell: (row) => <Bool value={row.deduct_credits} /> },
        { header: "access revenue", cell: (row) => <Bool value={row.access_revenue} /> },
        { header: "access client phone", cell: (row) => <Bool value={row.access_client_phone} /> },
        { header: "approval required", cell: (row) => <Bool value={row.approval_required} /> },
        { header: "auto execute allowed", cell: (row) => <Bool value={row.auto_execute_allowed} /> },
        { header: "status", cell: (row) => <StatusBadge value={row.status} /> },
      ]}
    />
  );
}

function RollbackCenter() {
  const actions = [
    "Pause All Agents",
    "Disable WhatsApp Sending",
    "Disable Credit Deduction",
    "Switch to Rule-Based Mode",
    "Rollback Agent Version",
  ];

  return (
    <section className="rounded-lg border border-rose-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">Emergency Controls</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            These controls are intentionally disabled placeholders. They document the rollback model
            without changing runtime behavior, sending messages, deducting credits, or switching live workflows.
          </p>
        </div>
        <StatusBadge value="Disabled placeholders" />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            disabled
            className="min-h-16 rounded-lg border border-slate-200 bg-slate-100 px-4 py-3 text-left text-sm font-semibold text-slate-400"
          >
            {action}
            <span className="mt-1 block text-xs font-medium text-slate-400">Placeholder only</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PercentCell({ value }: { value?: number | null }) {
  if (value == null) return <span className="text-slate-400">N/A</span>;
  return (
    <div className="min-w-28">
      <div className="mb-1 text-xs font-semibold text-slate-700">{value}%</div>
      <ProgressBar value={value} tone={value >= 80 ? "emerald" : value >= 50 ? "amber" : "rose"} />
    </div>
  );
}

function ReadOnlyBox({ value }: { value: string }) {
  return (
    <textarea
      value={value}
      readOnly
      className="min-h-48 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600 outline-none"
    />
  );
}

function SafeAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
    >
      {children}
    </button>
  );
}

function MiniMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <div className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function Strong({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="min-w-44">
      <p className="font-semibold text-slate-950">{title}</p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
    </div>
  );
}

function SelectBox({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Bool({ value }: { value: boolean }) {
  return <StatusBadge value={value ? "Yes" : "No"} tone={value ? "emerald" : "slate"} />;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not run";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function maskSensitive(value: string) {
  if (!value) return "Masked";
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}${"*".repeat(Math.min(8, value.length - 4))}${value.slice(-2)}`;
}

function version(id: string, agent_key: string, versionValue: string, status: AOSAgentVersion["status"], notes: string): AOSAgentVersion {
  return {
    id,
    agent_key,
    version: versionValue,
    status,
    prompt_version: versionValue,
    rule_version: versionValue,
    version_notes: notes,
    created_by: "Superadmin",
    created_at: "2026-06-27T08:00:00.000Z",
  };
}

function prompt(id: string, agent_key: string, versionValue: string, status: AOSAgentPrompt["status"], created_by: string, notes: string): AOSAgentPrompt {
  return {
    id,
    agent_key,
    version: versionValue,
    status,
    created_by,
    created_at: "2026-06-27T08:00:00.000Z",
    prompt_logic: "Masked placeholder prompt logic. Not editable.",
    version_notes: notes,
  };
}

function rule(id: string, agent_key: string, rule_name: string, versionValue: string, status: AOSAgentRule["status"], rule_summary: string): AOSAgentRule {
  return {
    id,
    agent_key,
    rule_name,
    version: versionValue,
    status,
    rule_summary,
    rule_logic: {},
    created_by: "Superadmin",
    created_at: "2026-06-27T08:10:00.000Z",
  };
}

function log(
  id: string,
  agent_key: string,
  task_type: string,
  entity_type: string,
  entity_id: string,
  input_summary: string,
  output_summary: string,
  decision: string,
  reason: string,
  confidence_score: number,
  status: AOSAgentLog["status"],
  error_message: string | null,
): AOSAgentLog {
  return {
    id,
    agent_key,
    task_type,
    entity_type,
    entity_id,
    input_summary,
    output_summary,
    decision,
    reason,
    confidence_score,
    status,
    error_message,
    created_at: "2026-06-27T09:00:00.000Z",
  };
}

function memory(
  id: string,
  agent_key: string,
  memory_type: string,
  entity_type: string,
  entity_id: string,
  memory_key: string,
  memory_value: string,
  created_by_agent: string,
  confidence_score: number,
  expires_at: string,
  is_sensitive: boolean,
): AOSAgentMemory {
  return {
    id,
    agent_key,
    memory_type,
    entity_type,
    entity_id,
    memory_key,
    memory_value,
    created_by_agent,
    confidence_score,
    expires_at,
    is_sensitive,
    created_at: "2026-06-27T08:20:00.000Z",
  };
}

function testRun(id: string, agent_key: string, old_decision: string, new_decision: string, difference: string, risk: AOSTestRun["risk"], recommendation: string): AOSTestRun {
  return {
    id,
    agent_key,
    current_version: "0.1.0",
    draft_version: "0.2.0-draft",
    sample_entity_type: "lead",
    sample_entity_id: `sample_${id}`,
    old_decision,
    new_decision,
    difference,
    risk,
    recommendation,
    status: "completed",
    created_at: "2026-06-27T08:30:00.000Z",
  };
}

function approval(id: string, action_type: string, entity_type: string, entity_id: string, risk_level: AOSApprovalRequest["risk_level"], request_summary: string): AOSApprovalRequest {
  return {
    id,
    agent_key: null,
    action_type,
    entity_type,
    entity_id,
    request_summary,
    risk_level,
    status: "pending",
    requested_by_agent: "QF-AOS-VaultGuard",
    created_at: "2026-06-27T08:40:00.000Z",
  };
}

function failure(id: string, agent_key: string, failure_type: string, task_type: string, status: AOSFailure["status"], error_message: string): AOSFailure {
  return {
    id,
    agent_key,
    failure_type,
    task_type,
    entity_type: "mock",
    entity_id: `${id}_entity`,
    status,
    error_message,
    created_at: "2026-06-27T08:50:00.000Z",
  };
}

function cost(id: string, agent_key: string, task_type: string, runs_count: number, token_estimate: number, cost_estimate: number, cost_per_lead: string, status: AOSCostLog["status"]): AOSCostLog {
  return {
    id,
    agent_key,
    task_type,
    entity_type: "mock",
    entity_id: `${id}_entity`,
    runs_count,
    token_estimate,
    cost_estimate,
    cost_per_lead,
    monthly_estimate: 0,
    failed_cost: 0,
    status,
    created_at: "2026-06-27T09:00:00.000Z",
  };
}
