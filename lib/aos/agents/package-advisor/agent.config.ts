import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const packageAdvisorAgentConfig: FutureAgentConfig = {
  id: "package-advisor",
  name: "QF-AOS-PackageAdvisor",
  slug: "package-advisor",
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
  description: "Recommend vendor packages based on category, demand, city, performance, and budget.",
  futureResponsibilities: [
    "Recommend vendor packages by category/city/demand",
    "Factor in vendor performance and budget",
    "Suggest upgrade opportunities",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default packageAdvisorAgentConfig;
