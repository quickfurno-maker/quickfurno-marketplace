import type { FutureAgentConfig } from "../../types";

// Phase 1D — FUTURE INACTIVE agent. Placeholder only. Not activated, no side effects.
export const calendarSyncAgentConfig: FutureAgentConfig = {
  id: "calendar-sync",
  name: "QF-AOS-CalendarSync",
  slug: "calendar-sync",
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
  description: "CRM calendar, follow-up reminders, site visit reminders, future Google Calendar sync.",
  futureResponsibilities: [
    "Maintain internal CRM calendar events",
    "Prepare follow-up and site-visit reminders",
    "Future Google Calendar two-way sync",
  ],
  permissions: {
    canReadData: false,
    canWriteData: false,
    canSendMessages: false,
    canDeductCredits: false,
  },
};

export default calendarSyncAgentConfig;
