// ============================================================================
// QuickFurno — services/leadAssignmentDispatchService.ts   (server-only)
//
// QF-MVP-80.13A — the I/O half of the lead-assignment WhatsApp lane.
//
// THE SEAM, IN ONE LINE
//   communication_intents (aggregate_type='lead_assignment')
//     -> leadAssignmentDispatchContract (pure admission + plan)
//     -> the EXISTING CommunicationService.send()
//     -> the existing consent / runtime-policy / account / canary / mapping gates
//     -> the existing provider adapter, webhook and reconciliation
//
//   Every decision this file makes is delegated: eligibility and the plan come
//   from the pure contract, authorization comes from CommunicationService. What
//   remains here is reading durable truth and writing the intent's own status.
//
// WHAT THIS FILE STRUCTURALLY CANNOT DO
//   * It never calls Meta, or any provider, or any HTTP endpoint. There is no
//     fetch, no graph.facebook.com, no n8n. The only network actor reachable
//     from here is CommunicationService, through the runtime factory.
//   * It never enables, relaxes or bypasses a gate. It holds no runtime-policy
//     write, no canary write, no provider-account write and no env mutation. A
//     disabled policy or outbound_enabled=false simply makes `send` refuse, and
//     this file reports that refusal verbatim.
//   * It never selects an intent created at or before the owner-configured
//     activation boundary, and it has no code path that runs without one. The
//     six historical pending production intents are therefore unreachable from
//     every function below.
//   * It never widens the template vocabulary. `lead_assignment_alert` with
//     `lead_reference` at body position 1 is the only thing it can produce.
// ============================================================================

import { adminClient } from "@/lib/supabase";
import {
  INTENT_ENTITY_TYPE,
  IntentResultStatus,
  isForwardTransition,
  projectIntentStatus,
  type IntentResultStatusValue,
} from "@/lib/communication/campaignResultContract";
import {
  LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY,
  LEAD_ASSIGNMENT_AGGREGATE_TYPE,
  LEAD_ASSIGNMENT_INTENT_CHANNEL,
  LEAD_ASSIGNMENT_SELECTABLE_STATUS,
  LEAD_ASSIGNMENT_TEMPLATE_PURPOSE,
  LeadAssignmentDispatchRefusal,
  buildLeadAssignmentDispatchPlan,
  isEligibleLeadAssignmentIntent,
  parseActivationBoundary,
  type LeadAssignmentActivationBoundary,
  type LeadAssignmentDispatchRefusalValue,
  type LeadAssignmentIntentRow,
} from "@/lib/communication/leadAssignmentDispatchContract";
import { deriveLeadReference } from "@/lib/communication/leadReference";
import { createRuntimeCommunicationService } from "@/services/runtimeCommunicationService";
import type { CommunicationMessageStatus } from "@/lib/communication/types";

const INTENT_COLUMNS =
  "id, aggregate_type, aggregate_id, channel, template_purpose, payload_ref, status, created_at";

/** A bounded read. There is no "drain everything" mode and no unbounded loop. */
const DEFAULT_SELECT_LIMIT = 25;
const MAX_SELECT_LIMIT = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const db = () => adminClient();

// ---------------------------------------------------------------------------
// 1. The activation boundary — read from the EXISTING policy-config surface
// ---------------------------------------------------------------------------

export type ActivationBoundaryRead =
  | { readonly ok: true; readonly boundary: LeadAssignmentActivationBoundary }
  | { readonly ok: false; readonly reason: LeadAssignmentDispatchRefusalValue };

/**
 * Read the owner-locked activation instant through the SAME join the vendor
 * low-credit threshold uses: the mutable active pointer resolved to its
 * immutable, fingerprinted config version.
 *
 * There is deliberately no fallback of any kind. An unconfigured key, a lookup
 * error, an absent config or an unparseable instant all resolve to a refusal,
 * and every caller treats a refusal as ZERO eligible intents. This is the
 * property that keeps the six historical production intents parked.
 */
export async function readLeadAssignmentActivationBoundary(): Promise<ActivationBoundaryRead> {
  const { data, error } = await db()
    .from("automation_policy_active_configs")
    .select("policy_key, automation_policy_configs!inner(config_json)")
    .eq("policy_key", LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, reason: LeadAssignmentDispatchRefusal.ACTIVATION_BOUNDARY_UNCONFIGURED };
  }

  const joined = (data as { automation_policy_configs?: unknown }).automation_policy_configs;
  const config = Array.isArray(joined) ? joined[0] : joined;
  const configJson = (config as { config_json?: unknown } | undefined)?.config_json;

  const parsed = parseActivationBoundary(configJson ?? null);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  return { ok: true, boundary: parsed.boundary };
}

// ---------------------------------------------------------------------------
// 2. Selection — forward-only, and empty whenever the boundary is unresolved
// ---------------------------------------------------------------------------

export interface EligibleIntentSelection {
  readonly boundary: LeadAssignmentActivationBoundary | null;
  readonly refusal: LeadAssignmentDispatchRefusalValue | null;
  readonly intents: readonly LeadAssignmentIntentRow[];
}

/**
 * The ONLY query in this lane that returns candidate intents.
 *
 * Three independent fences, so no single mistake opens the historical set:
 *   1. the boundary must resolve, or the function returns before querying;
 *   2. the query itself is `created_at > boundary` plus exact equality on
 *      aggregate type, purpose, channel and status;
 *   3. every returned row is re-admitted through the pure gate, which repeats
 *      all of the above on the actual row and adds the payload evidence check.
 */
export async function selectEligibleLeadAssignmentIntents(
  options: { readonly limit?: number } = {}
): Promise<EligibleIntentSelection> {
  const boundaryRead = await readLeadAssignmentActivationBoundary();
  if (!boundaryRead.ok) {
    // FAIL CLOSED: no boundary, no query, no candidates.
    return { boundary: null, refusal: boundaryRead.reason, intents: [] };
  }
  const boundary = boundaryRead.boundary;

  const requested = Number.isInteger(options.limit) ? (options.limit as number) : DEFAULT_SELECT_LIMIT;
  const limit = Math.max(1, Math.min(MAX_SELECT_LIMIT, requested));

  const { data, error } = await db()
    .from("communication_intents")
    .select(INTENT_COLUMNS)
    .eq("aggregate_type", LEAD_ASSIGNMENT_AGGREGATE_TYPE)
    .eq("template_purpose", LEAD_ASSIGNMENT_TEMPLATE_PURPOSE)
    .eq("channel", LEAD_ASSIGNMENT_INTENT_CHANNEL)
    .eq("status", LEAD_ASSIGNMENT_SELECTABLE_STATUS)
    // STRICTLY AFTER the boundary. This is the clause that parks the historical set.
    .gt("created_at", boundary.notBeforeIso)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return { boundary, refusal: LeadAssignmentDispatchRefusal.LOOKUP_FAILED, intents: [] };
  }

  const rows = (data ?? []) as LeadAssignmentIntentRow[];
  // Fence 3: the pure gate is the authority, not the query builder.
  const admitted = rows.filter((row) => isEligibleLeadAssignmentIntent(row, boundary).ok);
  return { boundary, refusal: null, intents: admitted };
}

// ---------------------------------------------------------------------------
// 3. Dispatch — one intent, through the canonical send stack
// ---------------------------------------------------------------------------

export type LeadAssignmentDispatchOutcome =
  | {
      readonly ok: true;
      readonly intentId: string;
      readonly messageId: string;
      readonly messageStatus: CommunicationMessageStatus;
      readonly intentStatus: IntentResultStatusValue;
    }
  | {
      readonly ok: false;
      readonly intentId: string | null;
      readonly reason: LeadAssignmentDispatchRefusalValue | string;
    };

interface AssignmentFacts {
  readonly vendorId: string;
  readonly leadReference: string;
}

type AssignmentFactsResult =
  | { readonly ok: true; readonly facts: AssignmentFacts }
  | { readonly ok: false; readonly reason: LeadAssignmentDispatchRefusalValue };

/**
 * Resolve the two facts a send needs, from durable truth only.
 *
 * The vendor is resolved THROUGH the assignment, so an alert can never be
 * addressed to a vendor the assignment does not belong to, and the reference is
 * the lead's own `reference` — no client name, phone, address, budget or service
 * text is read here at all.
 */
async function resolveAssignmentFacts(assignmentId: string): Promise<AssignmentFactsResult> {
  const { data, error } = await db()
    .from("lead_assignments")
    .select("id, lead_id, vendor_id")
    .eq("id", assignmentId)
    .maybeSingle();

  if (error) return { ok: false, reason: LeadAssignmentDispatchRefusal.LOOKUP_FAILED };
  const assignment = data as { id: string; lead_id: string | null; vendor_id: string | null } | null;
  if (!assignment) return { ok: false, reason: LeadAssignmentDispatchRefusal.ASSIGNMENT_NOT_FOUND };
  if (!assignment.vendor_id || !UUID_RE.test(assignment.vendor_id)) {
    return { ok: false, reason: LeadAssignmentDispatchRefusal.VENDOR_UNRESOLVED };
  }
  if (!assignment.lead_id || !UUID_RE.test(assignment.lead_id)) {
    return { ok: false, reason: LeadAssignmentDispatchRefusal.LEAD_REFERENCE_UNRESOLVED };
  }

  // The lead must still exist. A deleted lead is a definitive non-send: the
  // reference derivation is pure and would happily produce a value for an id
  // that no longer names anything.
  const { data: leadData, error: leadError } = await db()
    .from("leads")
    .select("id")
    .eq("id", assignment.lead_id)
    .maybeSingle();

  if (leadError) return { ok: false, reason: LeadAssignmentDispatchRefusal.LOOKUP_FAILED };
  if (!leadData) return { ok: false, reason: LeadAssignmentDispatchRefusal.LEAD_REFERENCE_UNRESOLVED };

  // The SINGLE shared derivation. `public.leads` has no reference column, and
  // this lane states no formula of its own — the client lane and this one give
  // the same lead the same reference by construction.
  const reference = deriveLeadReference(assignment.lead_id);
  if (reference === null) {
    return { ok: false, reason: LeadAssignmentDispatchRefusal.LEAD_REFERENCE_UNRESOLVED };
  }

  return { ok: true, facts: { vendorId: assignment.vendor_id, leadReference: reference } };
}

/**
 * Dispatch exactly ONE lead-assignment intent.
 *
 * The intent is re-read and re-admitted here even when the caller selected it a
 * moment ago: a row that changed status, or a boundary that moved, must be able
 * to stop the send. Nothing about the send is decided by the caller.
 */
export async function dispatchLeadAssignmentIntent(input: {
  readonly intentId: unknown;
}): Promise<LeadAssignmentDispatchOutcome> {
  const intentId = typeof input?.intentId === "string" ? input.intentId : "";
  if (!UUID_RE.test(intentId)) {
    return { ok: false, intentId: null, reason: LeadAssignmentDispatchRefusal.INTENT_IDENTITY_INVALID };
  }

  const boundaryRead = await readLeadAssignmentActivationBoundary();
  if (!boundaryRead.ok) {
    return { ok: false, intentId, reason: boundaryRead.reason };
  }

  const { data, error } = await db()
    .from("communication_intents")
    .select(INTENT_COLUMNS)
    .eq("id", intentId)
    .maybeSingle();

  if (error) return { ok: false, intentId, reason: LeadAssignmentDispatchRefusal.LOOKUP_FAILED };
  const row = (data ?? null) as LeadAssignmentIntentRow | null;
  if (!row) return { ok: false, intentId, reason: LeadAssignmentDispatchRefusal.INTENT_NOT_FOUND };

  const facts = await resolveAssignmentFacts(row.aggregate_id);
  if (!facts.ok) return { ok: false, intentId, reason: facts.reason };

  // The pure contract decides admission AND builds the exact CommunicationIntent.
  const plan = buildLeadAssignmentDispatchPlan({
    row,
    boundary: boundaryRead.boundary,
    vendorId: facts.facts.vendorId,
    leadReference: facts.facts.leadReference,
  });
  if (!plan.ok) return { ok: false, intentId, reason: plan.reason };

  // The runtime factory owns provider selection and every injected gate. A
  // production environment with no configured provider fails closed HERE.
  const service = createRuntimeCommunicationService();
  if (!service.ok) {
    return { ok: false, intentId, reason: service.code ?? LeadAssignmentDispatchRefusal.PROVIDER_UNAVAILABLE };
  }

  // The canonical send stack. Consent, runtime policy, provider-account
  // readiness, canary allowlist and the approved active template mapping are all
  // enforced INSIDE this call — this lane neither repeats nor relaxes them.
  const sent = await service.data.send(plan.intent);
  if (!sent.ok) {
    return { ok: false, intentId, reason: sent.code ?? LeadAssignmentDispatchRefusal.SEND_REFUSED };
  }

  const message = sent.data;
  const intentStatus = await advanceLeadAssignmentIntentStatus({
    intentId: row.id,
    observedStatus: row.status as IntentResultStatusValue,
    messageStatus: message.status,
  });

  return {
    ok: true,
    intentId: row.id,
    messageId: message.id,
    messageStatus: message.status,
    intentStatus,
  };
}

// ---------------------------------------------------------------------------
// 4. Intent status — forward-only, compare-and-set, lane-scoped
// ---------------------------------------------------------------------------

/**
 * Advance the intent to the status its message projects, reusing the SAME
 * projection and forward-only rank the campaign reconciler uses. No second
 * status vocabulary is invented here.
 *
 * Scoped hard to this lane: the UPDATE carries `aggregate_type='lead_assignment'`
 * so it cannot touch a campaign intent even if handed one, and it is
 * COMPARE-AND-SET on the status we observed, so a concurrent writer wins and
 * this call becomes a no-op rather than a regression. A failure to advance is
 * deliberately NOT fatal — the message is already sent, and the durable
 * `communication_messages` row remains the delivery authority.
 */
async function advanceLeadAssignmentIntentStatus(input: {
  readonly intentId: string;
  readonly observedStatus: IntentResultStatusValue;
  readonly messageStatus: CommunicationMessageStatus;
}): Promise<IntentResultStatusValue> {
  const derived = projectIntentStatus(input.messageStatus);
  if (derived === input.observedStatus) return input.observedStatus;
  if (!isForwardTransition(input.observedStatus, derived)) return input.observedStatus;

  const patch: Record<string, unknown> = { status: derived };
  // `dispatched_at` is stamped once, on the first move to dispatched.
  if (derived === IntentResultStatus.DISPATCHED) {
    patch.dispatched_at = new Date().toISOString();
  }

  const { data, error } = await db()
    .from("communication_intents")
    .update(patch)
    .eq("id", input.intentId)
    .eq("aggregate_type", LEAD_ASSIGNMENT_AGGREGATE_TYPE)
    .eq("status", input.observedStatus)
    .select("id, status");

  if (error || !data || data.length === 0) return input.observedStatus;
  return derived;
}

// ---------------------------------------------------------------------------
// 5. The bounded runner seam
// ---------------------------------------------------------------------------

export interface LeadAssignmentDispatchRunSummary {
  readonly selected: number;
  readonly dispatched: number;
  readonly refused: number;
  readonly boundaryIso: string | null;
  readonly selectionRefusal: LeadAssignmentDispatchRefusalValue | null;
  readonly outcomes: readonly LeadAssignmentDispatchOutcome[];
}

/**
 * One bounded pass, intended to be called by an existing production runner. It
 * is deliberately NOT a daemon, a cron, a scheduler or a background loop: it
 * does a single bounded batch and returns.
 *
 * With no activation boundary configured this returns a summary of zeros and
 * performs no send and no write — which is exactly its state on production
 * today, and the reason merging this phase changes no live behaviour.
 */
export async function runLeadAssignmentDispatchBatch(
  options: { readonly limit?: number } = {}
): Promise<LeadAssignmentDispatchRunSummary> {
  const selection = await selectEligibleLeadAssignmentIntents(options);
  if (selection.intents.length === 0) {
    return {
      selected: 0,
      dispatched: 0,
      refused: 0,
      boundaryIso: selection.boundary?.notBeforeIso ?? null,
      selectionRefusal: selection.refusal,
      outcomes: [],
    };
  }

  const outcomes: LeadAssignmentDispatchOutcome[] = [];
  for (const row of selection.intents) {
    outcomes.push(await dispatchLeadAssignmentIntent({ intentId: row.id }));
  }

  return {
    selected: selection.intents.length,
    dispatched: outcomes.filter((o) => o.ok).length,
    refused: outcomes.filter((o) => !o.ok).length,
    boundaryIso: selection.boundary?.notBeforeIso ?? null,
    selectionRefusal: null,
    outcomes,
  };
}

/** Re-exported so an operator surface never re-derives the lane's identity. */
export { INTENT_ENTITY_TYPE, LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY };
