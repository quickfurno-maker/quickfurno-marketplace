import type { AgentName } from "../types";

export interface PermissionCheck {
  agentName: AgentName;
  action: string;
  allowed: boolean;
  reason: string;
}

const BLOCKED_ACTIONS = new Set([
  "database-write",
  "send-whatsapp",
  "send-email",
  "call-ai-api",
  "call-n8n",
  "auto-assign-lead",
]);

export function checkAgentPermission(agentName: AgentName, action: string): PermissionCheck {
  const blocked = BLOCKED_ACTIONS.has(action);

  return {
    agentName,
    action,
    allowed: !blocked,
    reason: blocked
      ? "Action is blocked in Phase 1 foundation mode."
      : "Action is permitted only as a no-side-effect placeholder.",
  };
}

