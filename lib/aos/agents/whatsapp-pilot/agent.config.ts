import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const whatsappPilotAgentConfig: FutureAgentConfig = {
  id: "whatsapp-pilot",
  name: "QF-AOS-WhatsAppPilot",
  slug: "whatsapp-pilot",
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
  description: "Future WhatsApp automation controller for clients, vendors, admin alerts, reminders.",
  futureResponsibilities: [
    "Coordinate WhatsApp templates and reminders (future)",
    "Route client/vendor/admin alerts (future)",
    "Respect strict opt-in and rate limits",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default whatsappPilotAgentConfig;
