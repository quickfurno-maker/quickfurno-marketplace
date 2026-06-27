import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const seoScoutAgentConfig: FutureAgentConfig = {
  id: "seo-scout",
  name: "QF-AOS-SEOScout",
  slug: "seo-scout",
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
  description: "Find SEO page opportunities from lead demand, service, city, and area data.",
  futureResponsibilities: [
    "Find SEO page opportunities from demand data",
    "Suggest service/city/area landing pages",
    "Prioritize by search potential",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default seoScoutAgentConfig;
