// Phase 1D — minimal placeholder schema for QF-AOS-SalesCoach (future inactive).
// Intentionally loose: makes NO assumptions about future database tables.

export interface SalesCoachInput {
  // Optional, free-form context for a future activation. No DB shape implied.
  entityId?: string;
  context?: Record<string, unknown>;
}

export interface SalesCoachOutput {
  status: "future_inactive";
  message: string;
  // Reserved for future structured output once the agent is activated.
  details?: Record<string, unknown>;
}
