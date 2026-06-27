import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const leadNurtureAgentConfig: FutureAgentConfig = {
  id: "lead-nurture",
  name: "QF-AOS-LeadNurture",
  slug: "lead-nurture",
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
  description: "Long-term lead nurturing, follow-up scheduling, custom nurture dates, future reactivation.",
  futureResponsibilities: [
    "Schedule long-term nurture follow-ups (including custom dates beyond two months)",
    "Recommend reactivation of dormant leads",
    "Coordinate nurture stages with the CRM nurture queue",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default leadNurtureAgentConfig;
