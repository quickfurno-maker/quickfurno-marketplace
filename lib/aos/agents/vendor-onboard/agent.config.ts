import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const vendorOnboardAgentConfig: FutureAgentConfig = {
  id: "vendor-onboard",
  name: "QF-AOS-VendorOnboard",
  slug: "vendor-onboard",
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
  description: "Vendor onboarding, profile completeness, service area checks, verification readiness.",
  futureResponsibilities: [
    "Check vendor profile completeness",
    "Validate service areas and categories",
    "Assess verification readiness",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default vendorOnboardAgentConfig;
