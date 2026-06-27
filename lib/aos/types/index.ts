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

