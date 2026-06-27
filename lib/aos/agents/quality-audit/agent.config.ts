import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const qualityAuditAgentConfig: FutureAgentConfig = {
  id: "quality-audit",
  name: "QF-AOS-QualityAudit",
  slug: "quality-audit",
  status: "future",
  isActive: false,
  autoExecute: false,
  aiEnabled: false,
  whatsappEnabled: false,
  n8nEnabled: false,
  creditDeductionEnabled: false,
  requiresAdminApproval: true,
  mode: "placeholder",
  version: "v0.1-future",
  riskLevel: "controlled",
  description: "Audit lead quality, vendor quality, bad matching, repeated complaints, poor source quality.",
  futureResponsibilities: [
    "Audit lead and vendor quality",
    "Detect bad matches and repeated complaints",
    "Flag poor-quality sources",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default qualityAuditAgentConfig;
