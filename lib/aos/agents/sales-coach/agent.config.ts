import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const salesCoachAgentConfig: FutureAgentConfig = {
  id: "sales-coach",
  name: "QF-AOS-SalesCoach",
  slug: "sales-coach",
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
  description: "Help sales/admin team with follow-up suggestions, objection handling, and next best action.",
  futureResponsibilities: [
    "Suggest follow-ups and next best action",
    "Offer objection-handling guidance",
    "Coach on lead prioritization",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default salesCoachAgentConfig;
