// ============================================================================
// QuickFurno — lib/communication/leadAssignmentDispatchContract.ts
//
// QF-MVP-80.13A — the PURE contract for the lead-assignment WhatsApp lane.
//
// WHAT THIS CLOSES
//   public.qf_assign_lead_vendors_v2 has always written one
//   public.communication_intents row per successful assignment
//   (aggregate_type = 'lead_assignment', template_purpose = 'vendor_lead_assigned',
//   channel = 'whatsapp', status = 'pending'). NOTHING has ever consumed it — the
//   only reconciler in the repository is scoped to 'vendor_campaign'. Vendors are
//   debited for a lead and never told about it.
//
//   This module is the DECISION half of that seam and holds no I/O at all, so
//   every rule below is provable offline, without a database, a provider or a
//   credential.
//
// WHAT IT DELIBERATELY IS NOT
//   Not an event bus, not a queue, not a scheduler, not a second channel, not a
//   second template vocabulary and not an n8n lane. It answers exactly one
//   question: "may THIS intent become THIS one approved template send, and with
//   which variables?" The answer is closed — an unrecognised aggregate type,
//   purpose, channel or status is refused, never guessed.
//
// THE ACTIVATION BOUNDARY, AND WHY IT EXISTS
//   Production carries SIX historical pending 'lead_assignment' intents accrued
//   while the lane was dead. A naive "select every pending lead_assignment intent"
//   consumer would, on its first run, flush all six to real vendors — messages for
//   assignments made weeks earlier. So selection is FORWARD-ONLY against an
//   explicit owner-configured instant, and the boundary has NO permissive default:
//   absent, malformed, or non-instant configuration yields ZERO eligible intents.
//   `parseActivationBoundary` is the only way to obtain one, and it can only
//   return a boundary for a strict UTC ISO-8601 instant.
// ============================================================================

import {
  INTENT_ENTITY_TYPE,
  IntentResultStatus,
  type IntentResultStatusValue,
} from "./campaignResultContract";
import { buildLeadAssignmentAlertVariables } from "./businessTemplateVariables";
import { RECIPIENT_REFERENCE_DESTINATION, type CommunicationIntent } from "./types";

// ---------------------------------------------------------------------------
// The closed lane identity
// ---------------------------------------------------------------------------

/** The ONLY aggregate type this lane accepts. */
export const LEAD_ASSIGNMENT_AGGREGATE_TYPE = "lead_assignment" as const;

/** The ONLY channel this lane accepts. CommunicationService dispatches whatsapp. */
export const LEAD_ASSIGNMENT_INTENT_CHANNEL = "whatsapp" as const;

/** The ONLY intent status that is selectable for a first dispatch. */
export const LEAD_ASSIGNMENT_SELECTABLE_STATUS: IntentResultStatusValue =
  IntentResultStatus.PENDING;

/** The ONLY template purpose this lane accepts. */
export const LEAD_ASSIGNMENT_TEMPLATE_PURPOSE = "vendor_lead_assigned" as const;

/** The ONLY internal template key this lane can ever produce. */
export const LEAD_ASSIGNMENT_TEMPLATE_KEY = "lead_assignment_alert" as const;

/** The lane the template is registered under in public.communication_templates. */
export const LEAD_ASSIGNMENT_COMMUNICATION_LANE = "business" as const;

/**
 * The owner-locked activation boundary lives in the EXISTING append-only
 * `automation_policy_configs` surface under this key, exactly as the vendor
 * low-credit threshold already does. No new table, no new column, no migration:
 * an absent row IS the fail-closed state.
 */
export const LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY =
  "lead_assignment_dispatch_activation" as const;

/** The config field holding the boundary instant. */
export const LEAD_ASSIGNMENT_ACTIVATION_FIELD = "activationNotBefore" as const;

/**
 * The message idempotency namespace. Derived from the INTENT id, so a retry of
 * the same intent collides on `communication_messages.idempotency_key` and can
 * never produce a second message or a second provider call.
 */
export const LEAD_ASSIGNMENT_MESSAGE_IDEMPOTENCY_PREFIX =
  "qf_mvp_80_13a_lead_assignment_intent_v1:";

export const LEAD_ASSIGNMENT_CORRELATION_PREFIX = "qf_lead_assignment:";

/**
 * The EXPLICIT purpose -> template mapping. One entry. There is deliberately no
 * default branch, no prefix parser and no string similarity: a purpose absent
 * from this record resolves to null and the caller refuses.
 */
const PURPOSE_TEMPLATE_MAP: Readonly<Record<string, typeof LEAD_ASSIGNMENT_TEMPLATE_KEY>> =
  Object.freeze({
    [LEAD_ASSIGNMENT_TEMPLATE_PURPOSE]: LEAD_ASSIGNMENT_TEMPLATE_KEY,
  });

export function resolveLeadAssignmentTemplateKey(purpose: unknown): string | null {
  if (typeof purpose !== "string") return null;
  return Object.prototype.hasOwnProperty.call(PURPOSE_TEMPLATE_MAP, purpose)
    ? PURPOSE_TEMPLATE_MAP[purpose]
    : null;
}

// ---------------------------------------------------------------------------
// Refusal vocabulary — every non-dispatch is a NAMED, inspectable outcome
// ---------------------------------------------------------------------------

export const LeadAssignmentDispatchRefusal = Object.freeze({
  ACTIVATION_BOUNDARY_UNCONFIGURED: "ACTIVATION_BOUNDARY_UNCONFIGURED",
  ACTIVATION_BOUNDARY_MALFORMED: "ACTIVATION_BOUNDARY_MALFORMED",
  INTENT_NOT_FOUND: "INTENT_NOT_FOUND",
  INTENT_IDENTITY_INVALID: "INTENT_IDENTITY_INVALID",
  INTENT_NOT_LEAD_ASSIGNMENT: "INTENT_NOT_LEAD_ASSIGNMENT",
  INTENT_PURPOSE_UNSUPPORTED: "INTENT_PURPOSE_UNSUPPORTED",
  INTENT_CHANNEL_UNSUPPORTED: "INTENT_CHANNEL_UNSUPPORTED",
  INTENT_NOT_PENDING: "INTENT_NOT_PENDING",
  INTENT_CREATED_AT_INVALID: "INTENT_CREATED_AT_INVALID",
  INTENT_BEFORE_ACTIVATION_BOUNDARY: "INTENT_BEFORE_ACTIVATION_BOUNDARY",
  INTENT_EVIDENCE_INVALID: "INTENT_EVIDENCE_INVALID",
  ASSIGNMENT_NOT_FOUND: "ASSIGNMENT_NOT_FOUND",
  VENDOR_UNRESOLVED: "VENDOR_UNRESOLVED",
  LEAD_REFERENCE_UNRESOLVED: "LEAD_REFERENCE_UNRESOLVED",
  VARIABLES_UNRESOLVED: "VARIABLES_UNRESOLVED",
  LOOKUP_FAILED: "LOOKUP_FAILED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  SEND_REFUSED: "SEND_REFUSED",
} as const);

export type LeadAssignmentDispatchRefusalValue =
  (typeof LeadAssignmentDispatchRefusal)[keyof typeof LeadAssignmentDispatchRefusal];

// ---------------------------------------------------------------------------
// The activation boundary
// ---------------------------------------------------------------------------

/** The durable shape this lane reads out of `communication_intents`. */
export interface LeadAssignmentIntentRow {
  readonly id: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly channel: string;
  readonly template_purpose: string;
  readonly payload_ref: unknown;
  readonly status: string;
  readonly created_at: string;
}

export interface LeadAssignmentActivationBoundary {
  readonly notBeforeIso: string;
  readonly notBeforeMs: number;
}

export type ActivationBoundaryResult =
  | { readonly ok: true; readonly boundary: LeadAssignmentActivationBoundary }
  | { readonly ok: false; readonly reason: LeadAssignmentDispatchRefusalValue };

/**
 * A STRICT UTC ISO-8601 instant. Deliberately not `new Date(x)`: that accepts
 * "2026" and "September 2026", either of which would silently open the lane to
 * the entire history. The value must round-trip through Date to be accepted, so
 * an impossible calendar date ("2026-02-31T00:00:00Z") is refused too.
 */
const STRICT_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function parseStrictInstantMs(value: unknown): number | null {
  if (typeof value !== "string" || !STRICT_UTC_INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  // Round-trip on the whole-second prefix; a rolled-over calendar date fails here.
  if (new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return ms;
}

/**
 * Derive the boundary from a policy config document. ABSENCE IS NEVER PERMISSION:
 * a null/absent config is UNCONFIGURED and a present-but-unparseable value is
 * MALFORMED. Both yield zero eligible intents; neither falls back to "now",
 * "epoch" or "any".
 */
export function parseActivationBoundary(configJson: unknown): ActivationBoundaryResult {
  if (configJson === null || configJson === undefined) {
    return { ok: false, reason: LeadAssignmentDispatchRefusal.ACTIVATION_BOUNDARY_UNCONFIGURED };
  }
  if (typeof configJson !== "object" || Array.isArray(configJson)) {
    return { ok: false, reason: LeadAssignmentDispatchRefusal.ACTIVATION_BOUNDARY_MALFORMED };
  }
  const raw = (configJson as Record<string, unknown>)[LEAD_ASSIGNMENT_ACTIVATION_FIELD];
  if (raw === undefined || raw === null) {
    return { ok: false, reason: LeadAssignmentDispatchRefusal.ACTIVATION_BOUNDARY_UNCONFIGURED };
  }
  const ms = parseStrictInstantMs(raw);
  if (ms === null) {
    return { ok: false, reason: LeadAssignmentDispatchRefusal.ACTIVATION_BOUNDARY_MALFORMED };
  }
  return { ok: true, boundary: { notBeforeIso: raw as string, notBeforeMs: ms } };
}

// ---------------------------------------------------------------------------
// The closed eligibility gate
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EligibilityResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: LeadAssignmentDispatchRefusalValue };

const refuse = (reason: LeadAssignmentDispatchRefusalValue): EligibilityResult => ({
  ok: false,
  reason,
});

/**
 * The complete admission test. Every clause is an EQUALITY against the one
 * accepted value, so a widened enum in a later migration cannot leak a new
 * aggregate type, channel or status into this lane by default.
 *
 * The boundary comparison is STRICTLY AFTER. An intent created at the exact
 * boundary instant is refused: when the two are indistinguishable, the safe
 * answer is the one that does not send.
 */
export function isEligibleLeadAssignmentIntent(
  row: LeadAssignmentIntentRow | null | undefined,
  boundary: LeadAssignmentActivationBoundary | null | undefined
): EligibilityResult {
  if (!boundary || !Number.isFinite(boundary.notBeforeMs)) {
    return refuse(LeadAssignmentDispatchRefusal.ACTIVATION_BOUNDARY_UNCONFIGURED);
  }
  if (!row || typeof row !== "object") {
    return refuse(LeadAssignmentDispatchRefusal.INTENT_NOT_FOUND);
  }
  if (!UUID_RE.test(String(row.id)) || !UUID_RE.test(String(row.aggregate_id))) {
    return refuse(LeadAssignmentDispatchRefusal.INTENT_IDENTITY_INVALID);
  }
  if (row.aggregate_type !== LEAD_ASSIGNMENT_AGGREGATE_TYPE) {
    return refuse(LeadAssignmentDispatchRefusal.INTENT_NOT_LEAD_ASSIGNMENT);
  }
  if (resolveLeadAssignmentTemplateKey(row.template_purpose) === null) {
    return refuse(LeadAssignmentDispatchRefusal.INTENT_PURPOSE_UNSUPPORTED);
  }
  if (row.channel !== LEAD_ASSIGNMENT_INTENT_CHANNEL) {
    return refuse(LeadAssignmentDispatchRefusal.INTENT_CHANNEL_UNSUPPORTED);
  }
  if (row.status !== LEAD_ASSIGNMENT_SELECTABLE_STATUS) {
    return refuse(LeadAssignmentDispatchRefusal.INTENT_NOT_PENDING);
  }
  const createdMs = Date.parse(String(row.created_at));
  if (!Number.isFinite(createdMs)) {
    return refuse(LeadAssignmentDispatchRefusal.INTENT_CREATED_AT_INVALID);
  }
  if (createdMs <= boundary.notBeforeMs) {
    return refuse(LeadAssignmentDispatchRefusal.INTENT_BEFORE_ACTIVATION_BOUNDARY);
  }
  // The authority stamped the assignment id into the payload. If the payload
  // disagrees with the aggregate, the row is not the one the authority wrote.
  const payload = row.payload_ref;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return refuse(LeadAssignmentDispatchRefusal.INTENT_EVIDENCE_INVALID);
  }
  const assignmentInPayload = (payload as Record<string, unknown>).assignment_id;
  if (assignmentInPayload !== row.aggregate_id) {
    return refuse(LeadAssignmentDispatchRefusal.INTENT_EVIDENCE_INVALID);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Derived identities
// ---------------------------------------------------------------------------

export function leadAssignmentMessageIdempotencyKey(intentId: string): string {
  return `${LEAD_ASSIGNMENT_MESSAGE_IDEMPOTENCY_PREFIX}${intentId}`;
}

export function leadAssignmentCorrelationId(assignmentId: string): string {
  return `${LEAD_ASSIGNMENT_CORRELATION_PREFIX}${assignmentId}`;
}

// ---------------------------------------------------------------------------
// The plan — the exact CommunicationIntent this lane may hand to the canonical
// CommunicationService, or a named refusal. Still pure.
// ---------------------------------------------------------------------------

export type LeadAssignmentDispatchPlan =
  | { readonly ok: true; readonly intent: CommunicationIntent }
  | { readonly ok: false; readonly reason: LeadAssignmentDispatchRefusalValue };

/**
 * Variables come from the SINGLE existing builder. This module states no source
 * key of its own and expands no client PII: `lead_reference` is the whole
 * payload the approved production template accepts, and `assemble` already
 * refuses any key set that is not exactly the declared contract.
 */
export function buildLeadAssignmentDispatchPlan(input: {
  readonly row: LeadAssignmentIntentRow | null | undefined;
  readonly boundary: LeadAssignmentActivationBoundary | null | undefined;
  readonly vendorId: unknown;
  readonly leadReference: unknown;
}): LeadAssignmentDispatchPlan {
  const eligible = isEligibleLeadAssignmentIntent(input.row, input.boundary);
  if (!eligible.ok) return { ok: false, reason: eligible.reason };
  const row = input.row as LeadAssignmentIntentRow;

  const templateKey = resolveLeadAssignmentTemplateKey(row.template_purpose);
  if (templateKey === null) {
    return { ok: false, reason: LeadAssignmentDispatchRefusal.INTENT_PURPOSE_UNSUPPORTED };
  }

  if (typeof input.vendorId !== "string" || !UUID_RE.test(input.vendorId)) {
    return { ok: false, reason: LeadAssignmentDispatchRefusal.VENDOR_UNRESOLVED };
  }

  const built = buildLeadAssignmentAlertVariables({ leadReference: input.leadReference });
  if (!built.ok) {
    return { ok: false, reason: LeadAssignmentDispatchRefusal.VARIABLES_UNRESOLVED };
  }

  return {
    ok: true,
    intent: {
      type: templateKey,
      lane: LEAD_ASSIGNMENT_COMMUNICATION_LANE,
      channel: LEAD_ASSIGNMENT_INTENT_CHANNEL,
      recipient_type: "vendor",
      recipient_id: input.vendorId,
      // Business sends always resolve their destination from the durable
      // recipient reference; the ephemeral path is authentication-only.
      destination_source: RECIPIENT_REFERENCE_DESTINATION,
      template_key: templateKey,
      variables: built.variables,
      // The same linkage the campaign lane uses, so one reconciliation shape
      // covers both: the message points back at the intent that authorized it.
      entity_type: INTENT_ENTITY_TYPE,
      entity_id: row.id,
      correlation_id: leadAssignmentCorrelationId(row.aggregate_id),
      idempotency_key: leadAssignmentMessageIdempotencyKey(row.id),
      priority: "normal",
      scheduled_at: null,
      policy_decision_id: null,
      metadata: {},
    },
  };
}
