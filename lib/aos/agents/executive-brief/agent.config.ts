import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const executiveBriefAgentConfig: FutureAgentConfig = {
  id: "executive-brief",
  name: "QF-AOS-ExecutiveBrief",
  slug: "executive-brief",
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
  description: "Founder-level daily/weekly business summary, revenue projection, urgent actions, growth suggestions.",
  futureResponsibilities: [
    "Compose founder-level daily/weekly summaries",
    "Project revenue and highlight urgent actions",
    "Recommend growth opportunities",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default executiveBriefAgentConfig;
