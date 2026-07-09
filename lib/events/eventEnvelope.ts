// ============================================================================
// QuickFurno — lib/events/eventEnvelope.ts   (Phase 5F-A future-compat)
//
// PURE, FUTURE-COMPATIBILITY canonical event-envelope CONTRACT for the future
// Jarvis integration boundary (signed events). It is inert TYPES + METADATA only.
//
// Phase 5F-A adds NO persistence for this envelope: it creates no table, no event
// bus, no outbox, no consumer, and no execution path. Nothing here reads or writes
// a database, calls a provider, runs n8n, or authorizes an action.
//
// PERSISTENCE IS DEFERRED. A committed workflow-kernel migration
// (supabase/migrations/20260706000146_create_qf_workflow_kernel_foundation.sql, with
// lib/aos/workflow/domainEventService.ts + outboxService.ts) DEFINES
// public.domain_events / public.outbox_events in the repo, but that migration is NOT
// applied to the live database and this envelope is NOT wired to it. The canonical
// event persistence target — whether the workflow-kernel outbox or a dedicated
// canonical store — is a LATER controlled-phase decision, taken only after the
// QuickFurno event taxonomy and integration boundaries are finalized (see
// docs/QF-Jarvis-Integration-Boundary.md). This contract does not decide it.
//
// SECURITY: the envelope exposes NO secret field. The payload is carried ONLY as
// `safePayload` — a sanitized, non-secret projection. There is no OTP, token,
// secret, credential, password, session, or raw-payload field.
// ============================================================================

// ----------------------------------------------------------------------------
// Vocabularies
// ----------------------------------------------------------------------------
export const EventActorType = {
  SYSTEM: "system",
  ADMIN: "admin",
  WORKFLOW: "workflow",
  AGENT: "agent",
  PROVIDER: "provider",
} as const;

export type EventActorTypeValue = (typeof EventActorType)[keyof typeof EventActorType];

export const EventRiskLevel = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
} as const;

export type EventRiskLevelValue = (typeof EventRiskLevel)[keyof typeof EventRiskLevel];

// ----------------------------------------------------------------------------
// The canonical envelope (a pure logical contract)
// ----------------------------------------------------------------------------
/**
 * A canonical event envelope: a pure logical CONTRACT for a FUTURE signed-event
 * integration boundary. It is inert data — Phase 5F-A neither persists it nor maps
 * it onto any live table. Its field set is a deliberately broad logical superset;
 * the concrete storage layout (a future additive column set and/or payload
 * metadata) is chosen in a later controlled phase, not here.
 *
 * There is NO secret field. `safePayload` is a sanitized projection only.
 */
export interface CanonicalEventEnvelope {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly sourceSystem: string;
  readonly actorType: EventActorTypeValue;
  /** A LOGICAL actor id (e.g. a logical agent label) — never a DB role or credential. */
  readonly actorId: string | null;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly idempotencyKey: string;
  readonly riskLevel: EventRiskLevelValue;
  readonly approvalRequired: boolean;
  readonly payloadSchemaVersion: number;
  /** Sanitized, non-secret payload projection ONLY. Never a raw/secret payload. */
  readonly safePayload: Record<string, unknown>;
  readonly traceId: string | null;
}

/**
 * Persistence status for this envelope. Documented so a test can assert Phase 5F-A
 * introduces no event table, bus, outbox, consumer, or execution path — and makes
 * NO live mapping. `repoDefinedUnappliedTables` records the workflow-kernel tables
 * that EXIST in a committed migration but are UNAPPLIED on the live database and
 * NOT wired to this contract; they are neither a live mapping nor a persistence
 * decision for this envelope.
 */
export const EVENT_PERSISTENCE_STATUS = Object.freeze({
  persistedByPhase5FA: false,
  createsTable: false,
  createsEventBus: false,
  createsOutbox: false,
  createsConsumer: false,
  createsExecutionPath: false,
  authorizesActions: false,
  /** No table this envelope currently reads or writes. */
  liveMappedTables: [] as readonly string[],
  /**
   * Defined by supabase/migrations/20260706000146_create_qf_workflow_kernel_foundation.sql
   * but UNAPPLIED on live and NOT wired here. Not a live mapping.
   */
  repoDefinedUnappliedTables: ["domain_events", "outbox_events"] as readonly string[],
});

/**
 * The envelope field names that MUST NEVER exist (secret leakage guard). A test
 * asserts none appears on the contract. Includes OTP and session-credential names.
 */
export const FORBIDDEN_ENVELOPE_FIELDS: readonly string[] = Object.freeze([
  "token", "access_token", "secret", "app_secret", "api_key", "private_key",
  "credential", "password", "raw_payload", "rawPayload", "service_account",
  "otp", "otp_code", "session", "session_token", "sessionToken",
]);
