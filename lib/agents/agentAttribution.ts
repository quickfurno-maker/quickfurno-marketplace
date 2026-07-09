// ============================================================================
// QuickFurno — lib/agents/agentAttribution.ts   (Phase 5F-A future-compat)
//
// PURE attribution contracts. FUTURE-COMPATIBILITY ONLY: no autonomous action, no
// LLM call, no execution engine, no database role, no service-role identity. These
// values ATTRIBUTE a communication decision to a source for AUDIT; they NEVER
// authorize one.
//
// AUTHORITY BOUNDARY (unchanged): the Phase 4 Policy Engine remains the business
// communication authorization authority. Attribution is data, not a capability —
// there is deliberately no field here that can grant authorization, and
// `attributionAuthorizes()` is a hard `false`.
//
// The logical agent names below (qf_jarvis, riya, …) are LOGICAL labels only. They
// are NOT Supabase users, NOT PostgreSQL roles, NOT service-role identities, and
// NOT provider credentials. QF Jarvis is a SEPARATE future repository/deployment
// that integrates only through narrow read/recommendation/approval/signed-event/
// controlled-action APIs — see docs/QF-Jarvis-Integration-Boundary.md.
// ============================================================================

// ----------------------------------------------------------------------------
// Decision source
// ----------------------------------------------------------------------------
/** What KIND of source a communication decision is attributed to (audit only). */
export const DecisionSourceType = {
  SYSTEM: "system",
  ADMIN: "admin",
  WORKFLOW: "workflow",
  AGENT: "agent",
} as const;

export type DecisionSourceTypeValue = (typeof DecisionSourceType)[keyof typeof DecisionSourceType];

export const KNOWN_DECISION_SOURCE_TYPES: readonly DecisionSourceTypeValue[] =
  Object.freeze(Object.values(DecisionSourceType));

export function isDecisionSourceType(value: unknown): value is DecisionSourceTypeValue {
  return typeof value === "string" && (KNOWN_DECISION_SOURCE_TYPES as string[]).includes(value);
}

// ----------------------------------------------------------------------------
// Logical agent attribution vocabulary
// ----------------------------------------------------------------------------
/**
 * Logical agent labels for ATTRIBUTION only. These are NOT auth principals — a
 * dispatch is never authorized because it is attributed to one of these.
 */
export const LogicalAgent = {
  QF_JARVIS: "qf_jarvis",
  RIYA: "riya",
  JITIN: "jitin",
  KABIR: "kabir",
  ARJUN: "arjun",
  MEERA: "meera",
  VEER: "veer",
} as const;

export type LogicalAgentValue = (typeof LogicalAgent)[keyof typeof LogicalAgent];

export const KNOWN_LOGICAL_AGENTS: readonly LogicalAgentValue[] =
  Object.freeze(Object.values(LogicalAgent));

export function isLogicalAgent(value: unknown): value is LogicalAgentValue {
  return typeof value === "string" && (KNOWN_LOGICAL_AGENTS as string[]).includes(value);
}

/**
 * These logical names are NOT database roles / Supabase users / service-role
 * identities. Reserved PostgreSQL/Supabase role names are listed so a test can
 * prove no logical agent collides with a privileged role.
 */
export const RESERVED_DB_ROLE_NAMES: readonly string[] = Object.freeze([
  "postgres", "service_role", "authenticated", "anon", "supabase_admin",
  "supabase_auth_admin", "supabase_storage_admin", "authenticator", "pg_read_all_data",
]);

/** True only if a value would collide with a privileged DB/Supabase role. */
export function isReservedDbRole(value: unknown): boolean {
  return typeof value === "string" && (RESERVED_DB_ROLE_NAMES as string[]).includes(value);
}

// ----------------------------------------------------------------------------
// Communication decision context (attribution — NEVER authorization)
// ----------------------------------------------------------------------------
/**
 * Attribution/audit context for a communication decision. Every field is a
 * REFERENCE for tracing — none confers authorization. A dispatch is authorized ONLY
 * by the Phase 4 Policy Engine, then consent/suppression, then a channel/provider
 * decision — never by anything on this object.
 *
 * Maps to future NULLABLE audit columns; nothing here is a credential or a secret.
 */
export interface CommunicationDecisionContext {
  readonly decisionSourceType: DecisionSourceTypeValue;
  /** For an agent source, a LOGICAL agent label; otherwise an opaque id. Non-auth. */
  readonly decisionSourceId: string | null;
  readonly recommendationId: string | null;
  readonly approvalRequestId: string | null;
  readonly campaignId: string | null;
  readonly experimentId: string | null;
  /** The Phase 4 policy decision that DID authorize (the real authority). */
  readonly policyDecisionId: string | null;
  readonly correlationId: string | null;
}

/**
 * THE hard guarantee: attribution never authorizes a communication. This function
 * ALWAYS returns false — a mutation that lets attribution authorize is caught. A
 * communication is authorized only by a Phase 4 policy decision (and then
 * consent/suppression + a channel/provider decision), never by who/what is
 * attributed to it.
 */
export function attributionAuthorizes(_context?: CommunicationDecisionContext): boolean {
  return false;
}

/**
 * The ONLY thing that authorizes a dispatch is a present Phase 4 policy decision
 * reference. Attribution alone (agent/recommendation/campaign) is never sufficient.
 * This does NOT re-implement Phase 4 authorization — it merely refuses to treat
 * attribution as authorization.
 */
export function hasPolicyAuthorizationReference(context: CommunicationDecisionContext): boolean {
  return typeof context.policyDecisionId === "string" && context.policyDecisionId.trim() !== "";
}
