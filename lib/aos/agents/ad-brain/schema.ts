// Phase 1D — minimal placeholder schema for QF-AOS-AdBrain (future inactive).
// Intentionally loose: makes NO assumptions about future database tables.

export interface AdBrainInput {
  // Optional, free-form context for a future activation. No DB shape implied.
  entityId?: string;
  context?: Record<string, unknown>;
}

export interface AdBrainOutput {
  status: "future_inactive";
  message: string;
  // Reserved for future structured output once the agent is activated.
  details?: Record<string, unknown>;
}
