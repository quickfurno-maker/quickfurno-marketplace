import type {
  DomainEventRecord,
  JsonRecord,
  WorkflowInstanceRecord,
  WorkflowTransitionRecord,
} from "../../../workflow/workflowPersistenceTypes";
import type { LeadLifecycleEventTypeValue } from "../leadLifecycleEvents";

/**
 * QuickFurno Lead Lifecycle — Distribution Control shared types (Phase 3A).
 *
 * Phase 3A builds the *controlled distribution decision and approval contract*
 * for the STANDARD marketplace route only. It never assigns vendors, deducts
 * credits, calls assignment/delivery RPCs, sends WhatsApp, or calls n8n. Every
 * type here is a pure contract; nothing in this file touches the database.
 *
 * The preferred-vendor route and the requirement-group / client-selected route
 * remain owned entirely by their existing services and are explicitly *deferred*
 * (never merged) by the standard-route guard below.
 */

/** Bounded maximum vendors the standard distribution decision may ever recommend/approve. */
export const MAX_DISTRIBUTION_VENDORS = 3;

/** Pure validation result, mirroring the lifecycle validation contract. */
export type DistributionValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

/**
 * Immutable, normalized recommendation snapshot bound to a single authoritative
 * `lead.matching.completed` event. Recommendation order is authoritative and is
 * never re-ranked in Phase 3A.
 */
export interface LeadDistributionRecommendationSnapshot {
  readonly recommendationEventId: string;
  readonly leadId: string;
  readonly workflowInstanceId: string;
  readonly recommendedVendorIds: readonly string[];
  readonly recommendedVendorCount: number;
}

/** Identity a recommendation snapshot must be bound to (same lead, same workflow). */
export interface LeadDistributionRecommendationExpectation {
  recommendationEventId: string;
  expectedWorkflowInstanceId: string;
  expectedLeadId: string;
}

/**
 * The authoritative lead routing fields that distinguish the assignment models.
 * These are the ONLY real `public.leads` columns Phase 3A reads to classify a
 * route — no guessed field names. All exist today:
 *
 *   - lead_intent            (general_auto_match | preferred_vendor)      [mig 035]
 *   - target_vendor_id       (a specific vendor the client picked from a CTA) [mig 035]
 *   - preferred_vendor_id    (preferred-vendor routing target)            [mig 035]
 *   - requirement_group_id   (per-parent-category requirement group)      [mig 032]
 *   - selected_vendor_id     (a client-selected vendor)                   [mig 032]
 *   - assignment_intent      (e.g. "client_selected_vendor")             [mig 032]
 */
export interface LeadRoutingSnapshot {
  leadIntent: string | null;
  targetVendorId: string | null;
  preferredVendorId: string | null;
  requirementGroupId: string | null;
  selectedVendorId: string | null;
  assignmentIntent: string | null;
}

/**
 * The exact `leads.assignment_intent` value written by the client-selected flow
 * (services/clientRequirementGroupService.ts). No fuzzy matching.
 */
export const CLIENT_SELECTED_ASSIGNMENT_INTENT = "client_selected_vendor";

/**
 * Route classifications derived strictly from real routing fields. The
 * client-selected route is now isolated as a first-class classification so a
 * client-selected lead can never fall through to the standard route.
 */
export const LeadDistributionRoute = {
  STANDARD: "standard_route",
  PREFERRED_VENDOR: "preferred_vendor_route",
  CLIENT_SELECTED: "client_selected_route",
  REQUIREMENT_GROUP: "requirement_group_route",
} as const;

export type LeadDistributionRouteValue =
  (typeof LeadDistributionRoute)[keyof typeof LeadDistributionRoute];

export interface LeadDistributionRouteDecision {
  classification: LeadDistributionRouteValue;
  isStandardRoute: boolean;
  /** Human-safe reason the classifier chose this route. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Ports (injected; each has a Supabase-backed default in leadDistributionAdapters)
// ---------------------------------------------------------------------------

/** Read-only access to a durable domain event by id (for snapshot resolution). */
export interface LeadDistributionRecommendationEventPort {
  getDomainEventById(eventId: string): Promise<DomainEventRecord | null>;
}

/** Read-only access to the authoritative lead routing fields. */
export interface LeadDistributionRoutingPort {
  readLeadRouting(leadId: string): Promise<LeadRoutingSnapshot | null>;
}

/** Read-only access to authoritative workflow state (for the approval gate). */
export interface LeadDistributionWorkflowStatePort {
  getWorkflowInstanceById(id: string): Promise<WorkflowInstanceRecord | null>;
}

/**
 * The recommendation snapshot currently awaiting approval, derived from the most
 * recent authoritative `→ DISTRIBUTION_APPROVAL_PENDING` transition. This is the
 * authorization/integrity gate: only the exact currently-pending recommendation
 * may be approved (a stale historical recommendation cannot).
 */
export interface LeadDistributionApprovalBinding {
  recommendationEventId: string;
}

/**
 * Read-only access to workflow_transition_history for the current approval
 * binding. Returns the newest transition whose to_state is
 * DISTRIBUTION_APPROVAL_PENDING, or null when none exists.
 */
export interface LeadDistributionApprovalBindingPort {
  readCurrentApprovalBindingTransition(
    workflowInstanceId: string,
  ): Promise<WorkflowTransitionRecord | null>;
}

/**
 * Durable domain-event writer used by the approval publisher. Same shape as the
 * Phase 2B lifecycle event repository so the existing Supabase implementation can
 * be reused, while keeping the (pure) approval publisher decoupled from it.
 */
export interface LeadDistributionDomainEventInsert {
  eventType: LeadLifecycleEventTypeValue;
  entityType: string;
  entityId: string;
  payload: JsonRecord;
  traceId: string | null;
  correlationId: string | null;
  causationId: string | null;
  idempotencyKey: string;
}

export interface LeadDistributionDomainEventRepository {
  insert(input: LeadDistributionDomainEventInsert): Promise<DomainEventRecord>;
  findByIdempotencyKey(idempotencyKey: string): Promise<DomainEventRecord | null>;
}

// ---------------------------------------------------------------------------
// Human approval command contract
// ---------------------------------------------------------------------------

export interface ApproveLeadDistributionInput {
  workflowInstanceId: string;
  leadId: string;
  recommendationEventId: string;
  approvedVendorIds: string[];
  approvedBy: string;
  reason?: string;
}

/** Validated approval_required event payload contract. */
export interface DistributionApprovalRequiredContract {
  recommendationEventId: string;
  recommendedVendorCount: number;
  recommendedVendorIds: string[];
}

/** Validated approved event payload contract. */
export interface DistributionApprovedContract {
  recommendationEventId: string;
  recommendedVendorCount: number;
  recommendedVendorIds: string[];
  approvedVendorCount: number;
  approvedVendorIds: string[];
  approvedBy: string;
  approvalReason: string | null;
}

/** A published distribution approval payload (no PII), for reuse across modules. */
export type DistributionApprovalEventPayload = JsonRecord;
