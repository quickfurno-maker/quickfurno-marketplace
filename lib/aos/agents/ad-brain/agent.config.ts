import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const adBrainAgentConfig: FutureAgentConfig = {
  id: "ad-brain",
  name: "QF-AOS-AdBrain",
  slug: "ad-brain",
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
  description: "Analyze Google/Meta campaign performance and suggest marketing actions later.",
  futureResponsibilities: [
    "Analyze Google/Meta campaign performance",
    "Suggest budget and targeting actions",
    "Flag underperforming campaigns",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default adBrainAgentConfig;
