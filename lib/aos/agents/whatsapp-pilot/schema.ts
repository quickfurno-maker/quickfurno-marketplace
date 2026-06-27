// Phase 1D — minimal placeholder schema for QF-AOS-WhatsAppPilot (future inactive).
// Intentionally loose: makes NO assumptions about future database tables.

export interface WhatsappPilotInput {
  // Optional, free-form context for a future activation. No DB shape implied.
  entityId?: string;
  context?: Record<string, unknown>;
}

export interface WhatsappPilotOutput {
  status: "future_inactive";
  message: string;
  // Reserved for future structured output once the agent is activated.
  details?: Record<string, unknown>;
}
