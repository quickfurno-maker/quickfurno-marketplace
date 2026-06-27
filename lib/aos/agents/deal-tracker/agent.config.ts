import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const dealTrackerAgentConfig: FutureAgentConfig = {
  id: "deal-tracker",
  name: "QF-AOS-DealTracker",
  slug: "deal-tracker",
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
  description: "Track lead outcome, site visit, quotation, won/lost, vendor conversion.",
  futureResponsibilities: [
    "Track lead lifecycle to won/lost",
    "Record site visits and quotations",
    "Measure vendor conversion",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default dealTrackerAgentConfig;
