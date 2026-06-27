import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const fraudRadarAgentConfig: FutureAgentConfig = {
  id: "fraud-radar",
  name: "QF-AOS-FraudRadar",
  slug: "fraud-radar",
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
  description: "Advanced fraud, competitor testing, vendor spying, fake client and suspicious activity detection.",
  futureResponsibilities: [
    "Detect fraud and competitor testing",
    "Flag fake clients and vendor spying",
    "Surface suspicious activity for review",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default fraudRadarAgentConfig;
