import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const sourceTrackerAgentConfig: FutureAgentConfig = {
  id: "source-tracker",
  name: "QF-AOS-SourceTracker",
  slug: "source-tracker",
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
  description: "Track lead source, UTM, campaign, GCLID, FBCLID, referrer, landing page.",
  futureResponsibilities: [
    "Attribute leads to source/medium/campaign",
    "Capture GCLID/FBCLID/referrer/landing page",
    "Feed attribution into analytics",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default sourceTrackerAgentConfig;
