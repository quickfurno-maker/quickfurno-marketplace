// Phase 1D — minimal placeholder schema for QF-AOS-SEOScout (future inactive).
// Intentionally loose: makes NO assumptions about future database tables.

export interface SeoScoutInput {
  // Optional, free-form context for a future activation. No DB shape implied.
  entityId?: string;
  context?: Record<string, unknown>;
}

export interface SeoScoutOutput {
  status: "future_inactive";
  message: string;
  // Reserved for future structured output once the agent is activated.
  details?: Record<string, unknown>;
}
