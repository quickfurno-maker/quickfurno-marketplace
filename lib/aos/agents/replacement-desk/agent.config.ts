import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const replacementDeskAgentConfig: FutureAgentConfig = {
  id: "replacement-desk",
  name: "QF-AOS-ReplacementDesk",
  slug: "replacement-desk",
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
  description: "Handle invalid lead replacement requests and recommend approval/rejection.",
  futureResponsibilities: [
    "Review invalid lead replacement requests",
    "Recommend approve/reject (replacement, not refund)",
    "Prepare evidence summaries for admin",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default replacementDeskAgentConfig;
