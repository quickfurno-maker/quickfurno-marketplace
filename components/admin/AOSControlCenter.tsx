"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  DataTable,
  InfoGrid,
  SecondaryButton,
  StatCard,
  StatusBadge,
  Tabs,
} from "./AdminPrimitives";
import type { Snapshot } from "./adminTypes";
import type {
  AOSAgent,
  AOSAgentLog,
  AOSAgentMemory,
  AOSAgentPermission,
  AOSAgentPrompt,
  AOSAgentRule,
  AOSApprovalRequest,
  AOSCostLog,
  AOSFailure,
  AOSTestRun,
} from "@/lib/aos/types";
import { adaptCrmLeads } from "@/lib/crm/adapters/leadAdapter";
import { getLeadAosSnapshot } from "@/lib/aos/sync/aosCrmSyncService";
import { AOS_FEATURE_FLAGS } from "@/lib/aos/config/featureFlags";
import { adminLogAosDecision } from "@/app/actions";

type AOSControlCenterProps = {
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  data: Snapshot;
};

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

const agentsSeedOrder = [
  "nexus-kernel",
  "furno-memory",
  "lead-lens",
  "trust-shield",
  "match-forge",
  "lead-flow",
  "ops-brief",
];

const agents: AOSAgent[] = [
  aosAgent("nexus-kernel", "QF-AOS-NexusKernel", "Routes agent tasks, checks permissions, and keeps all AOS runs in mock-only orchestration.", "testing", "System memory", "Kernel approval"),
  aosAgent("furno-memory", "QF-AOS-FurnoMemory", "Stores future context snapshots for leads, vendors, clients, and agent decisions.", "testing", "Read/write draft", "Memory steward"),
  aosAgent("lead-lens", "QF-AOS-LeadLens", "Reviews lead quality, duplicate risk, budget strength, urgency, and CRM fit.", "testing", "Lead memory", "Review only"),
  aosAgent("trust-shield", "QF-AOS-TrustShield", "Reviews spam, abuse, vendor trust signals, and unsafe marketplace patterns.", "testing", "Trust memory", "Review only"),
  aosAgent("match-forge", "QF-AOS-MatchForge", "Previews vendor matches while respecting max 3 vendors and disabled-vendor exclusions.", "testing", "Lead/vendor memory", "Preview only"),
  aosAgent("lead-flow", "QF-AOS-LeadFlow", "Models CRM lifecycle, follow-ups, invalid lead replacement, and assignment readiness.", "testing", "CRM memory", "Approval required"),
  aosAgent("ops-brief", "QF-AOS-OpsBrief", "Creates read-only operations summaries for leads, vendors, quality, and workload.", "testing", "Analytics memory", "Read only"),
  aosAgent("client-care", "QF-AOS-ClientCare", "Future client follow-up, support, and nurture assistant.", "future/inactive", "None", "Disabled"),
  aosAgent("vendor-pulse", "QF-AOS-VendorPulse", "Future vendor health, response, renewal, and capacity assistant.", "future/inactive", "None", "Disabled"),
  aosAgent("revenue-vault", "QF-AOS-RevenueVault", "Future package, payment, revenue, and credit intelligence assistant.", "future/inactive", "None", "Disabled"),
  aosAgent("review-shield", "QF-AOS-ReviewShield", "Future review moderation and public trust assistant.", "future/inactive", "None", "Disabled"),
  aosAgent("growth-radar", "QF-AOS-GrowthRadar", "Future city, service category, SEO, and demand growth assistant.", "future/inactive", "None", "Disabled"),
  aosAgent("content-craft", "QF-AOS-ContentCraft", "Future SEO page, content, and marketplace copy assistant.", "future/inactive", "None", "Disabled"),
  aosAgent("admin-copilot", "QF-AOS-AdminCopilot", "Future superadmin assistant for summaries, drafts, and safe recommendations.", "future/inactive", "None", "Disabled"),
  aosAgent("vault-guard", "QF-AOS-VaultGuard", "Future secret, permission, audit, and rollback guardian.", "future/inactive", "None", "Disabled"),
];

const agentLogs: AOSAgentLog[] = [
  {
    id: "log-001",
    agent_key: "lead-lens",
    task_type: "lead_quality_preview",
    entity_type: "lead",
    entity_id: "lead_mock_8f3a",
    input_summary: "Masked lead from Pune, service Interior, budget range present.",
    output_summary: "Qualified lead preview with medium urgency.",
    decision: "recommend_qualified",
    reason: "Budget, service, and city are complete. Phone is masked in logs.",
    confidence_score: 0.82,
    status: "completed",
    error_message: null,
    created_at: "2026-06-27T09:30:00.000Z",
  },
  {
    id: "log-002",
    agent_key: "match-forge",
    task_type: "vendor_matching_preview",
    entity_type: "lead",
    entity_id: "lead_mock_4a91",
    input_summary: "Civil work lead, Kharadi area, max 3 vendor cap.",
    output_summary: "Two safe vendor candidates found in preview only.",
    decision: "recommend_manual_review",
    reason: "Only two eligible vendors in sample set. No assignment executed.",
    confidence_score: 0.76,
    status: "completed",
    error_message: null,
    created_at: "2026-06-27T10:05:00.000Z",
  },
  {
    id: "log-003",
    agent_key: "trust-shield",
    task_type: "spam_signal_preview",
    entity_type: "lead",
    entity_id: "lead_mock_b218",
    input_summary: "Repeated masked phone pattern and vague message.",
    output_summary: "Sent to spam review placeholder.",
    decision: "hold_for_review",
    reason: "Duplicate-like submission pattern. No status update executed.",
    confidence_score: 0.69,
    status: "blocked",
    error_message: "Permission gate blocks live lead write.",
    created_at: "2026-06-27T10:22:00.000Z",
  },
];

const promptVersions: AOSAgentPrompt[] = [
  prompt("prompt-001", "lead-lens", "0.1.0", "active", "Superadmin", "Lead scoring prompt baseline for budget, urgency, duplicate, and service fit."),
  prompt("prompt-002", "lead-lens", "0.2.0-draft", "draft", "Superadmin", "Adds invalid-lead replacement recommendation language."),
  prompt("prompt-003", "match-forge", "0.1.0", "active", "Superadmin", "Vendor matching preview prompt with max 3 vendor rule."),
  prompt("prompt-004", "trust-shield", "0.1.0", "testing", "Superadmin", "Spam and abuse review prompt for safe manual review."),
  prompt("prompt-005", "ops-brief", "0.0.9", "archived", "Superadmin", "Archived reporting summary prompt."),
];

const ruleVersions: AOSAgentRule[] = [
  rule("rule-001", "lead-lens", "LeadLens scoring rules", "0.1.0", "active", "Budget, service completeness, urgency, city support, duplicate risk."),
  rule("rule-002", "trust-shield", "TrustShield spam rules", "0.1.0", "testing", "Repeated masked phone, suspicious text, invalid service, spam-like source."),
  rule("rule-003", "match-forge", "MatchForge vendor matching rules", "0.1.0", "active", "Max 3 vendors, active status, city/category/area, no disabled vendors."),
  rule("rule-004", "lead-flow", "LeadFlow assignment rules", "0.1.0", "draft", "Assignment remains approval-only; invalid leads route to replacement review."),
  rule("rule-005", "ops-brief", "OpsBrief reporting rules", "0.1.0", "active", "Read-only summary by leads, vendors, cost, failures, approvals."),
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
  failure("fail-003", "furno-memory", "Supabase insert failed", "memory.write", "blocked", "AOS tables are not required at runtime yet."),
  failure("fail-004", "lead-flow", "n8n webhook failed", "call-n8n", "blocked", "n8n connection is intentionally disabled."),
  failure("fail-005", "client-care", "WhatsApp message failed", "send-whatsapp", "blocked", "WhatsApp sending is intentionally disabled."),
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
  status: agent.status === "testing" ? "testing" : "disabled",
  read_leads: ["lead-lens", "match-forge", "lead-flow", "ops-brief", "trust-shield"].includes(agent.agent_key),
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

export function AOSControlCenter({ notify, data }: AOSControlCenterProps) {
  const [active, setActive] = useState(tabs[0]);
  const [selectedAgent, setSelectedAgent] = useState("lead-lens");
  const [currentVersion, setCurrentVersion] = useState("0.1.0");
  const [draftVersion, setDraftVersion] = useState("0.2.0-draft");

  const testingAgents = agents.filter((agent) => agent.status === "testing").length;
  const inactiveAgents = agents.length - testingAgents;
  const blockedFailures = failures.filter((item) => item.status === "blocked").length;
  const pendingApprovals = approvalRows.filter((item) => item.status === "pending").length;

  function placeholder(action: string) {
    notify(`${action} is a safe placeholder. No live AOS action was executed.`);
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-900">
        AOS Control Center is running in safe management mode. The first 5 agents are activated in
        rule-based mode. No real AI calls, WhatsApp sends, n8n calls, lead distribution, or credit
        deductions are connected from this page.
      </section>

      <Phase7ActivationPanel data={data} notify={notify} />


      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Agents Registered" value={agents.length} helper={`${testingAgents} in testing, ${inactiveAgents} inactive`} icon="aos" tone="indigo" />
        <StatCard label="Runs Today" value="47" helper="Mock-only placeholder count" icon="reports" />
        <StatCard label="Pending Approvals" value={pendingApprovals} helper="All require human review" icon="audit" tone="amber" />
        <StatCard label="Blocked Side Effects" value={blockedFailures} helper="Permissions working as intended" icon="settings" tone="rose" />
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

// Phase 7: shows agent activation status, feature flags, and recent rule-based
// decisions computed live from real leads (no AI, no side effects).
function Phase7ActivationPanel({
  data,
  notify,
}: {
  data: Snapshot;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [isPending, startTransition] = useTransition();

  const activation = [
    { agent: "QF-AOS-LeadLens", status: "Active (rule-based)", tone: "active" },
    { agent: "QF-AOS-TrustShield", status: "Active (rule-based)", tone: "active" },
    { agent: "QF-AOS-MatchForge", status: "Active (suggestions only)", tone: "active" },
    { agent: "QF-AOS-LeadFlow", status: "Preview only", tone: "testing" },
    { agent: "QF-AOS-OpsBrief", status: "Active (read-only)", tone: "active" },
  ];

  // Compute recent decisions from up to 6 real leads (rule-based, read-only).
  const recent = adaptCrmLeads(data.leads)
    .slice(0, 6)
    .map((lead) => ({ lead, aos: getLeadAosSnapshot(lead, data.vendors) }));

  function persistSample() {
    const sample = recent[0];
    if (!sample) {
      notify("No leads available to log a sample decision.", "info");
      return;
    }
    // Safe, masked summary only — no raw phone or secrets. Writes to aos_agent_logs
    // if it exists; otherwise the action returns a safe fallback (never fails).
    startTransition(async () => {
      const result = await adminLogAosDecision({
        agent_key: "lead-lens",
        task_type: "lead_quality_score",
        entity_type: "lead",
        entity_id: sample.lead.id,
        input_summary: `Masked lead ${sample.lead.client_name} · ${sample.lead.service} · ${sample.lead.city}`,
        output_summary: `Score ${sample.aos.leadLens.lead_score} (${sample.aos.leadLens.lead_quality})`,
        decision: sample.aos.leadLens.lead_quality,
        reason: sample.aos.leadLens.reason,
        confidence_score: sample.aos.leadLens.confidence / 100,
        status: "completed",
      });
      if (!result.ok) {
        notify("Could not log decision; lead flow is unaffected.", "error");
        return;
      }
      notify(result.data.message, result.data.persisted ? "success" : "info");
    });
  }

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-950">Phase 7 — Agent Activation</h2>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">AI not active yet · rule-based</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {activation.map((item) => (
          <div key={item.agent} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="truncate text-sm font-semibold text-slate-900">{item.agent}</p>
            <div className="mt-2"><StatusBadge value={item.status} /></div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Feature flags</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {AOS_FEATURE_FLAGS.map((flag) => (
            <div key={flag.key} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
              <span className="font-mono font-semibold text-slate-700">{flag.key}</span>
              <StatusBadge value={flag.value ? "On" : "Off"} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent agent decisions (live, rule-based)</h3>
          <SecondaryButton onClick={persistSample}>{isPending ? "Logging…" : "Persist sample decision (safe)"}</SecondaryButton>
        </div>
        <div className="mt-3">
          <DataTable
            rows={recent}
            emptyTitle="No decisions yet"
            emptyMessage="Recent agent decisions appear here once leads exist. Decisions are rule-based and read-only."
            columns={[
              { header: "Lead", cell: (row) => <Strong title={row.lead.client_name} subtitle={row.lead.phone_masked} /> },
              { header: "LeadLens", cell: (row) => `${row.aos.leadLens.lead_score} (${row.aos.leadLens.lead_quality})` },
              { header: "TrustShield", cell: (row) => <StatusBadge value={`spam ${row.aos.trustShield.spam_risk}`} /> },
              { header: "MatchForge", cell: (row) => `${row.aos.matchForge.suggested_vendors.length} suggestion(s)` },
              { header: "LeadFlow", cell: (row) => row.aos.leadFlow.assignment_status },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function AgentOverview({ placeholder }: { placeholder: (action: string) => void }) {
  return (
    <div className="space-y-5">
      <section className="grid gap-4 xl:grid-cols-3">
        {agents.map((agent) => (
          <article key={agent.agent_key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-slate-950">{agent.agent_name}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">{agent.purpose}</p>
              </div>
              <StatusBadge value={agent.status} />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <MiniMetric label="Version" value={agent.version} />
              <MiniMetric label="Last Run" value={agent.last_run_at ?? "Not run"} />
              <MiniMetric label="Runs Today" value={agent.runs_today} />
              <MiniMetric label="Success" value={agent.success_rate != null ? `${agent.success_rate}%` : "Pending"} />
              <MiniMetric label="Errors" value={agent.error_count} />
              <MiniMetric label="Confidence" value={agent.average_confidence != null ? `${agent.average_confidence}%` : "Pending"} />
              <MiniMetric label="Avg Time" value={agent.average_response_time_ms != null ? `${agent.average_response_time_ms} ms` : "Pending"} />
              <MiniMetric label="Permission" value={agent.permission_level} />
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Memory access</p>
            <p className="mt-1 text-sm text-slate-700">{agent.memory_access}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {["View Logs", "Test", "Edit Logic", "Pause", "Rollback"].map((action) => (
                <SafeAction key={`${agent.agent_key}-${action}`} onClick={() => placeholder(`${action} for ${agent.agent_name}`)}>
                  {action}
                </SafeAction>
              ))}
            </div>
          </article>
        ))}
      </section>

      <DataTable
        rows={agents}
        emptyTitle="No agents"
        emptyMessage="AOS agents will appear here after the registry is connected."
        columns={[
          { header: "Agent", cell: (agent) => <Strong title={agent.agent_name} subtitle={agent.agent_key} /> },
          { header: "Purpose", cell: (agent) => <span className="block min-w-72 text-slate-600">{agent.purpose}</span> },
          { header: "Status", cell: (agent) => <StatusBadge value={agent.status} /> },
          { header: "Version", cell: (agent) => agent.version },
          { header: "Last Run", cell: (agent) => agent.last_run_at ?? "Not run" },
          { header: "Runs Today", cell: (agent) => agent.runs_today },
          { header: "Success", cell: (agent) => agent.success_rate != null ? `${agent.success_rate}%` : "Pending" },
          { header: "Errors", cell: (agent) => agent.error_count },
          { header: "Confidence", cell: (agent) => agent.average_confidence != null ? `${agent.average_confidence}%` : "Pending" },
          { header: "Avg Response", cell: (agent) => agent.average_response_time_ms != null ? `${agent.average_response_time_ms} ms` : "Pending" },
          { header: "Memory", cell: (agent) => agent.memory_access },
          { header: "Permission", cell: (agent) => agent.permission_level },
          {
            header: "Actions",
            cell: (agent) => (
              <div className="flex min-w-72 flex-wrap gap-2">
                {["View Logs", "Test", "Edit Logic", "Pause", "Rollback"].map((action) => (
                  <SafeAction key={`${agent.agent_key}-table-${action}`} onClick={() => placeholder(`${action} for ${agent.agent_name}`)}>
                    {action}
                  </SafeAction>
                ))}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

function AgentLogs() {
  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm leading-6 text-amber-900">
        <span className="font-semibold">AI not active yet.</span>
        <span>These are placeholder / rule-based fallback events.</span>
        <span className="rounded-full border border-amber-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-amber-700">No WhatsApp sent</span>
        <span className="rounded-full border border-amber-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-amber-700">No credits deducted</span>
      </section>
      <DataTable
      rows={agentLogs}
      emptyTitle="No agent logs"
      emptyMessage="Agent logs will appear here after AOS logging tables are connected."
      columns={[
        { header: "agent_key", cell: (row) => row.agent_key },
        { header: "task_type", cell: (row) => row.task_type },
        { header: "entity_type", cell: (row) => row.entity_type },
        { header: "entity_id", cell: (row) => row.entity_id },
        { header: "input_summary", cell: (row) => <span className="block min-w-64">{row.input_summary}</span> },
        { header: "output_summary", cell: (row) => <span className="block min-w-64">{row.output_summary}</span> },
        { header: "decision", cell: (row) => row.decision },
        { header: "reason", cell: (row) => <span className="block min-w-72">{row.reason}</span> },
        { header: "confidence_score", cell: (row) => `${Math.round(row.confidence_score * 100)}%` },
        { header: "status", cell: (row) => <StatusBadge value={row.status} /> },
        { header: "error_message", cell: (row) => row.error_message ?? "None" },
        { header: "created_at", cell: (row) => formatDateTime(row.created_at) },
      ]}
      />
    </div>
  );
}

function AgentLogic({ placeholder }: { placeholder: (action: string) => void }) {
  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <Panel title="Prompt Logic">
        <ReadOnlyBox value="Placeholder prompt logic. Future editor will require draft versioning, test lab comparison, admin approval, and rollback metadata before activation." />
      </Panel>
      <Panel title="Active / Draft Version">
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
      </Panel>
      <Panel title="Rule Logic">
        <ReadOnlyBox value="Placeholder rule logic. LeadLens, TrustShield, MatchForge, LeadFlow, and OpsBrief rule versions are read-only until migrations and approval workflows are connected." />
      </Panel>
      <Panel title="Safety Gates">
        <div className="space-y-3 text-sm leading-6 text-slate-600">
          <p>No live prompt or rule editing is enabled.</p>
          <p>Activation and rollback controls are safe placeholders only.</p>
          <p>Dangerous actions will route through approval queue in a future phase.</p>
        </div>
      </Panel>
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
        { header: "memory_value", cell: (row) => <span className={row.is_sensitive ? "font-semibold text-slate-900" : ""}>{row.memory_value}</span> },
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
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <SelectBox label="Select agent" value={selectedAgent} onChange={setSelectedAgent} options={agents.map((agent) => agent.agent_key)} />
          <SelectBox label="Current version" value={currentVersion} onChange={setCurrentVersion} options={["0.1.0", "0.0.9", "0.0.8"]} />
          <SelectBox label="Draft version" value={draftVersion} onChange={setDraftVersion} options={["0.2.0-draft", "0.1.1-draft", "No draft"]} />
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => placeholder("Run test on sample old leads")}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              Run sample test
            </button>
          </div>
        </div>
      </section>
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
    <section className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
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
            className="min-h-16 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-left text-sm font-semibold text-slate-400"
          >
            {action}
            <span className="mt-1 block text-xs font-medium text-slate-400">Placeholder only</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ReadOnlyBox({ value }: { value: string }) {
  return (
    <textarea
      value={value}
      readOnly
      className="min-h-48 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600 outline-none"
    />
  );
}

function SafeAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
    >
      {children}
    </button>
  );
}

function MiniMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</div>
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
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
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
  return <StatusBadge value={value ? "Yes" : "No"} />;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function aosAgent(
  agent_key: string,
  agent_name: string,
  purpose: string,
  status: AOSAgent["status"],
  memory_access: string,
  permission_level: string,
): AOSAgent {
  const activeIndex = agentsSeedOrder.indexOf(agent_key);
  const isTesting = status === "testing";
  return {
    id: `agent-${agent_key}`,
    agent_key,
    agent_name,
    purpose,
    status,
    version: "0.1.0",
    last_run_at: isTesting ? `2026-06-27T0${Math.min(9, activeIndex + 1)}:15:00.000Z` : null,
    runs_today: isTesting ? 4 + activeIndex : 0,
    success_rate: isTesting ? 90 - activeIndex : null,
    error_count: isTesting ? activeIndex % 2 : 0,
    average_confidence: isTesting ? 82 - activeIndex : null,
    average_response_time_ms: isTesting ? 420 + activeIndex * 45 : null,
    memory_access,
    permission_level,
    created_at: "2026-06-27T00:00:00.000Z",
    updated_at: "2026-06-27T00:00:00.000Z",
  };
}

function prompt(id: string, agent_key: string, version: string, status: AOSAgentPrompt["status"], created_by: string, notes: string): AOSAgentPrompt {
  return {
    id,
    agent_key,
    version,
    status,
    created_by,
    created_at: "2026-06-27T08:00:00.000Z",
    prompt_logic: "Masked placeholder prompt logic. Not editable.",
    version_notes: notes,
  };
}

function rule(id: string, agent_key: string, rule_name: string, version: string, status: AOSAgentRule["status"], rule_summary: string): AOSAgentRule {
  return {
    id,
    agent_key,
    rule_name,
    version,
    status,
    rule_summary,
    rule_logic: {},
    created_by: "Superadmin",
    created_at: "2026-06-27T08:10:00.000Z",
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
