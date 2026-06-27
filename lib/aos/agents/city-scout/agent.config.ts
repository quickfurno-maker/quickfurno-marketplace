import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const cityScoutAgentConfig: FutureAgentConfig = {
  id: "city-scout",
  name: "QF-AOS-CityScout",
  slug: "city-scout",
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
  description: "Analyze area/city demand and suggest city/category expansion.",
  futureResponsibilities: [
    "Analyze area/city demand vs vendor supply",
    "Recommend city/category expansion",
    "Highlight supply gaps",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default cityScoutAgentConfig;
