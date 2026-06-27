export type AgentStatus = "active" | "inactive" | "future" | "disabled";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped";

export type AgentName =
  | "QF-AOS-NexusKernel"
  | "QF-AOS-FurnoMemory"
  | "QF-AOS-LeadLens"
  | "QF-AOS-TrustShield"
  | "QF-AOS-MatchForge"
  | "QF-AOS-LeadFlow"
  | "QF-AOS-OpsBrief"
  | "QF-AOS-ClientCare"
  | "QF-AOS-VendorPulse"
  | "QF-AOS-RevenueVault"
  | "QF-AOS-ReviewShield"
  | "QF-AOS-GrowthRadar"
  | "QF-AOS-ContentCraft"
  | "QF-AOS-AdminCopilot"
  | "QF-AOS-VaultGuard";

export interface AgentPermission {
  canReadLeads: boolean;
  canReadVendors: boolean;
  canWriteDatabase: boolean;
  canSendWhatsApp: boolean;
  canSendEmail: boolean;
  canCallExternalApis: boolean;
  canAutoAssignLeads: boolean;
  requiresApproval: boolean;
  notes?: string[];
}

export interface AgentConfig {
  id: string;
  name: AgentName;
  slug: string;
  status: AgentStatus;
  version: string;
  description: string;
  capabilities: string[];
  permissions: AgentPermission;
}

export interface AgentTask {
  id: string;
  agentName: AgentName;
  type: string;
  input: Record<string, unknown>;
  requestedBy?: string;
  createdAt: string;
  dryRun: boolean;
}

export interface AgentResult {
  taskId: string;
  agentName: AgentName;
  status: AgentRunStatus;
  summary: string;
  data: Record<string, unknown>;
  decisions: string[];
  warnings: string[];
  requiresApproval: boolean;
  createdAt: string;
}

export interface AgentMemory {
  agentName: AgentName;
  namespace: string;
  entries: Record<string, unknown>;
  updatedAt: string;
}

export interface AgentLog {
  id: string;
  agentName: AgentName;
  taskId?: string;
  level: "info" | "warn" | "error";
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  agentName: AgentName;
  taskId: string;
  title: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "expired";
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AOSEvent {
  id: string;
  type: string;
  source: AgentName | "system" | "admin";
  payload: Record<string, unknown>;
  createdAt: string;
}

export type AOSAgentStatus =
  | "testing"
  | "active"
  | "paused"
  | "disabled"
  | "future"
  | "inactive"
  | "future/inactive"
  | "archived";

export type AOSVersionStatus = "active" | "draft" | "testing" | "archived";

export type AOSApprovalStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired";

export type AOSRiskLevel = "low" | "medium" | "high" | "critical";

export interface AOSAgent {
  id: string;
  agent_key: string;
  agent_name: AgentName | string;
  purpose: string;
  status: AOSAgentStatus;
  version: string;
  last_run_at?: string | null;
  runs_today?: number | null;
  success_rate?: number | null;
  error_count?: number | null;
  average_confidence?: number | null;
  average_response_time_ms?: number | null;
  memory_access?: string | null;
  permission_level?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AOSAgentVersion {
  id: string;
  agent_key: string;
  version: string;
  status: AOSVersionStatus;
  prompt_version?: string | null;
  rule_version?: string | null;
  version_notes?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  activated_at?: string | null;
  archived_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AOSAgentPrompt {
  id: string;
  agent_key: string;
  version: string;
  status: AOSVersionStatus;
  prompt_logic: string;
  version_notes?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AOSAgentRule {
  id: string;
  agent_key: string;
  rule_name: string;
  version: string;
  status: AOSVersionStatus;
  rule_summary?: string | null;
  rule_logic: Record<string, unknown>;
  created_by?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AOSAgentPermission {
  id: string;
  agent_key: string;
  status: AOSAgentStatus | "testing" | "disabled";
  permission_level: string;
  read_leads: boolean;
  write_leads: boolean;
  send_whatsapp: boolean;
  deduct_credits: boolean;
  access_revenue: boolean;
  access_client_phone: boolean;
  approval_required: boolean;
  auto_execute_allowed: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AOSAgentLog {
  id: string;
  agent_key: string;
  task_type: string;
  entity_type?: string | null;
  entity_id?: string | null;
  input_summary?: string | null;
  output_summary?: string | null;
  decision?: string | null;
  reason?: string | null;
  confidence_score: number;
  status: AgentRunStatus | "completed" | "blocked" | "failed";
  error_message?: string | null;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface AOSAgentMemory {
  id: string;
  agent_key: string;
  memory_type: string;
  entity_type?: string | null;
  entity_id?: string | null;
  memory_key: string;
  memory_value: string;
  created_by_agent: string;
  confidence_score: number;
  expires_at?: string | null;
  is_sensitive?: boolean;
  created_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AOSTestRun {
  id: string;
  agent_key: string;
  current_version: string;
  draft_version: string;
  sample_entity_type?: string | null;
  sample_entity_id?: string | null;
  old_decision?: string | null;
  new_decision?: string | null;
  difference?: string | null;
  risk: AOSRiskLevel;
  recommendation?: string | null;
  status: "queued" | "running" | "completed" | "failed";
  created_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AOSApprovalRequest {
  id: string;
  agent_key?: string | null;
  action_type: string;
  entity_type?: string | null;
  entity_id?: string | null;
  request_summary: string;
  risk_level: AOSRiskLevel;
  status: AOSApprovalStatus;
  requested_by_agent?: string | null;
  requested_by?: string | null;
  reviewed_by?: string | null;
  created_at?: string | null;
  reviewed_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AOSFailure {
  id: string;
  agent_key: string;
  failure_type: string;
  task_type?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  status: "failed" | "blocked" | "resolved" | "retrying";
  error_message?: string | null;
  retry_count?: number | null;
  created_at?: string | null;
  resolved_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AOSCostLog {
  id: string;
  agent_key: string;
  task_type?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  runs_count: number;
  token_estimate: number;
  cost_estimate: number;
  cost_per_lead?: string | null;
  monthly_estimate?: number | null;
  failed_cost?: number | null;
  status: "completed" | "failed" | "blocked" | "estimated";
  created_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AOSAuditLog {
  id: string;
  agent_key?: string | null;
  actor_type: "system" | "admin" | "agent";
  actor_id?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  status: "recorded" | "blocked" | "approved" | "rejected";
  reason?: string | null;
  before_summary?: string | null;
  after_summary?: string | null;
  approval_request_id?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Phase 1D — Future inactive agent extensions (agents 16–30).
// These types describe placeholder-only agents that are NOT activated and have
// NO side effects. They reuse the existing foundation types where possible.
// ----------------------------------------------------------------------------
export type AgentMode = "placeholder" | "rule_based" | "ai_assisted" | "hybrid";

export type AgentLifecycleStatus =
  | "active"
  | "testing"
  | "paused"
  | "future"
  | "inactive";

export type AgentRiskLevel = "controlled" | "low" | "medium" | "high";

// Safety flags for a future agent. Literal `false`/`true` types make it a
// compile-time error to accidentally enable a side effect on a future agent.
export interface FutureAgentPermissionFlags {
  canReadData: boolean; // false by default unless clearly marked as a future permission
  canWriteData: false;
  canSendMessages: false;
  canDeductCredits: false;
}

export interface FutureAgentConfig {
  id: string;
  name: string;
  slug: string;
  status: "future";
  isActive: false;
  autoExecute: false;
  aiEnabled: false;
  whatsappEnabled: false;
  n8nEnabled: false;
  creditDeductionEnabled: false;
  requiresAdminApproval: true;
  mode: "placeholder";
  version: "v0.1-future";
  riskLevel: "controlled";
  description: string;
  futureResponsibilities: string[];
  permissions: FutureAgentPermissionFlags;
}

// Safe result shape returned by future-agent placeholder services. Distinct from
// AgentResult so it can carry the "future_inactive" status without side effects.
export interface FutureAgentResult {
  agentName: string;
  status: "future_inactive";
  mode: "placeholder";
  summary: string;
  data: Record<string, unknown>;
  warnings: string[];
  executedSideEffects: false;
  requiresAdminApproval: true;
  createdAt: string;
}

export const noExternalSideEffectsPermission: AgentPermission = {
  canReadLeads: false,
  canReadVendors: false,
  canWriteDatabase: false,
  canSendWhatsApp: false,
  canSendEmail: false,
  canCallExternalApis: false,
  canAutoAssignLeads: false,
  requiresApproval: true,
  notes: [
    "Phase 1 placeholder only.",
    "No database writes, WhatsApp sends, email sends, n8n calls, or AI API calls.",
  ],
};
