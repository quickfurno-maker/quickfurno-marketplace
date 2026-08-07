// ============================================================================
// QuickFurno — QF-MVP-50.2E signed client-execution service
//
// Server-only Core boundary. The single place where a Core-authorized client
// automation attempt is turned into a real communication, and the single place
// that decides which sanitized orchestration state n8n is told.
//
// AUTHORITY
//   n8n supplies FIVE identity fields and nothing else. Every business fact —
//   action, workflow family, entity, recipient, template, variables, consent,
//   provider mapping, provider account, idempotency key — is rebuilt here from
//   Core's own ledgers and registries.
//
// THE AUTHORITATIVE SPLIT
//   Durable evidence, never a failure-category guess. Core resolves its OWN key
//   `qf_auto_v1:{jobId}:{attemptId}` against `communication_messages`:
//
//     a row EXISTS  -> the persisted communication status is the sole authority.
//                      Core NEVER finalizes the attempt itself. Completion, if
//                      any, belongs to QF-MVP-50.2D.
//     NO row exists -> and only then may Core directly finalize a safely
//                      classifiable pre-communication failure.
//
//   This is a property of the control flow below, not a convention: the
//   pre-communication ruling table is unreachable from any branch in which a
//   communication row was observed.
//
// NO PROVIDER REWRITE
//   Nothing here re-implements dispatch. The communication service, recipient
//   resolver, consent enforcer, provider adapters, dispatch registry, variable
//   builders and business template contracts are consumed exactly as they are.
// ============================================================================

import { adminClient } from "@/lib/supabase";
import {
  buildAutomationCommunicationIdempotencyKey,
  getClientDispatchDefinition,
  isAllowedClientDispatchEntityType,
  type ClientAutomationDispatchDefinition,
} from "@/lib/automation/clientDispatchRegistry";
import { getClientActionVariableBuilder } from "@/lib/automation/clientDispatchVariables";
import type { AutomationWorkflowFamily } from "@/lib/automation/actionRegistry";
import {
  resolveCommunicationExecutionPartition,
  resolvePreCommunicationRuling,
} from "@/lib/automation/clientExecutionContract";
import { buildAutomationNextRetryAt } from "@/lib/automation/retryPolicy";
import {
  completeAutomationAttempt,
  getClaimedAutomationJobEnvelope,
  proveCurrentAutomationAttemptOwnership,
} from "@/services/automationPersistenceService";
import {
  getRecordedClientExecutionIdentity,
  recordClientExecutionTransportIdentity,
} from "@/services/automationTransportService";
import { createRuntimeCommunicationService } from "@/services/runtimeCommunicationService";
import { RECIPIENT_REFERENCE_DESTINATION } from "@/lib/communication/types";
import type { CommunicationIntent } from "@/lib/communication/types";
import type { BusinessVariableResult } from "@/lib/communication/businessTemplateVariables";
import type { N8nExecuteClientSuccessBody } from "@/lib/automation/transportTypes";

/** The exact shape `getClientActionVariableBuilder` returns. */
type ClientVariableBuilder = (input: never) => BusinessVariableResult;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/**
 * The client workflow family dispatches on exactly one channel. Declared as a
 * closed derivation from the Core-derived family rather than written as a bare
 * string at the intent, so a future family cannot silently inherit WhatsApp.
 */
const WORKFLOW_FAMILY_CHANNEL: Readonly<
  Partial<Record<AutomationWorkflowFamily, "whatsapp">>
> = Object.freeze({
  client_whatsapp: "whatsapp",
});

export interface ExecuteClientAutomationInput {
  readonly requestId: string;
  readonly workerId: string;
  readonly bodySha256: string;
  readonly jobId: string;
  readonly attemptId: string;
  /** Canonical clock, injected so retry timing is deterministic under test. */
  readonly now?: Date;
}

export type ExecuteClientAutomationResult =
  | { ok: true; body: N8nExecuteClientSuccessBody }
  | { ok: false; status: 409; code: string };

interface CommunicationEvidence {
  readonly id: string;
  readonly status: string;
}

/**
 * Execute one Core-authorized client automation attempt.
 *
 * Ordering is the security property. Evidence is consulted BEFORE anything is
 * reserved or executed, so a replay of an already-answered attempt never touches
 * the ledger, never re-sends and never re-finalizes.
 */
export async function executeClientAutomationForN8nTransport(
  input: ExecuteClientAutomationInput,
): Promise<ExecuteClientAutomationResult> {
  if (!UUID_RE.test(input.requestId)) {
    throw new Error("AUTOMATION_TRANSPORT_REQUEST_ID_INVALID");
  }
  if (!SAFE_WORKER_RE.test(input.workerId)) {
    throw new Error("AUTOMATION_TRANSPORT_WORKER_ID_INVALID");
  }
  if (!/^[0-9a-f]{64}$/.test(input.bodySha256)) {
    throw new Error("AUTOMATION_TRANSPORT_BODY_HASH_INVALID");
  }
  if (!UUID_RE.test(input.jobId) || !UUID_RE.test(input.attemptId)) {
    throw new Error("AUTOMATION_TRANSPORT_EXECUTION_IDENTITY_INVALID");
  }

  // -------------------------------------------------------------------------
  // A. Ownership and currency of the exact attempt
  // -------------------------------------------------------------------------
  const ownership = await proveCurrentAutomationAttemptOwnership({
    jobId: input.jobId,
    attemptId: input.attemptId,
    workerId: input.workerId,
  });

  if (ownership.verdict === "not_owned") {
    return { ok: false, status: 409, code: ownership.code };
  }

  const { job, attempt } = ownership;

  const idempotencyKey = buildAutomationCommunicationIdempotencyKey(
    input.jobId,
    input.attemptId,
  );
  if (!idempotencyKey) {
    throw new Error("AUTOMATION_TRANSPORT_EXECUTION_IDENTITY_INVALID");
  }

  // -------------------------------------------------------------------------
  // B. Durable communication evidence FIRST — the authoritative split
  // -------------------------------------------------------------------------
  const existingEvidence = await readCommunicationEvidence(idempotencyKey);

  if (existingEvidence) {
    // A row exists. Core does not classify, does not finalize and does not
    // re-execute: the persisted status is the only authority from here on.
    return evidenceResult(
      input.requestId,
      existingEvidence,
      ownership.verdict === "owned_completed",
    );
  }

  if (ownership.verdict === "owned_completed") {
    // No communication row and the attempt is already finalized. That is the
    // exact shape of a lost response after a pre-communication finalization —
    // but only if WE reserved this attempt. Without that proof Core would be
    // taking credit for somebody else's completion.
    const reservation = await getRecordedClientExecutionIdentity({
      jobId: input.jobId,
      attemptId: input.attemptId,
    });
    if (!reservation) {
      return {
        ok: false,
        status: 409,
        code: "AUTOMATION_EXECUTION_ATTEMPT_ALREADY_FINALIZED_ELSEWHERE",
      };
    }
    return {
      ok: true,
      body: {
        ok: true,
        transportVersion: 1,
        requestId: input.requestId,
        route: "execute_v1",
        orchestrationState: "attempt_finalized",
        replayed: true,
      },
    };
  }

  // -------------------------------------------------------------------------
  // C. Rebuild every business fact from Core evidence
  // -------------------------------------------------------------------------
  // `getClaimedAutomationJobEnvelope` re-proves job ownership independently and
  // derives `workflowFamily` from the action registry. There is deliberately no
  // action-type prefix parsing anywhere on this path.
  const envelope = await getClaimedAutomationJobEnvelope(
    {
      job_id: job.id,
      action_request_id: job.action_request_id,
      attempt_id: attempt.id,
      attempt_number: attempt.attempt_number,
      max_attempts: job.max_attempts,
    },
    input.workerId,
  );

  const definition = getClientDispatchDefinition(envelope.actionType);
  if (!definition) {
    // Not one of the exact six client actions. A vendor or campaign job is NOT
    // this route's work, and consuming it as a business result would burn an
    // attempt that QF-MVP-50.3 / 50.4 legitimately own. Refuse, do not finalize.
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_ACTION_NOT_CLIENT_DISPATCHABLE",
    };
  }

  if (envelope.workflowFamily !== definition.workflowFamily) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_WORKFLOW_FAMILY_MISMATCH",
    };
  }

  if (!isAllowedClientDispatchEntityType(envelope.actionType, envelope.entityType)) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_ENTITY_TYPE_NOT_ALLOWED",
    };
  }

  if (!UUID_RE.test(envelope.entityId)) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_ENTITY_IDENTITY_INVALID",
    };
  }

  const builder = getClientActionVariableBuilder(envelope.actionType);
  if (!builder) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_VARIABLE_BUILDER_MISSING",
    };
  }

  const channel = WORKFLOW_FAMILY_CHANNEL[definition.workflowFamily];
  if (!channel) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_WORKFLOW_FAMILY_MISMATCH",
    };
  }

  // -------------------------------------------------------------------------
  // D. Reserve the durable, attempt-scoped execution identity
  //
  //    Reserved BEFORE the execution, so a crash between the two is recoverable:
  //    a replay re-reads truth (steps A/B) rather than trusting a stored verdict.
  //    No cross-system atomicity is claimed or needed.
  // -------------------------------------------------------------------------
  let reservationReplayed = false;
  try {
    const reservation = await recordClientExecutionTransportIdentity({
      requestId: input.requestId,
      workerId: input.workerId,
      bodySha256: input.bodySha256,
      jobId: input.jobId,
      attemptId: input.attemptId,
    });
    reservationReplayed = reservation.isReplay;
  } catch {
    // A refused reservation leaves NO side effect: the RPC's pristine insert
    // rolls back with the refusal, so a refused request identity is never burned.
    //
    // The refusal is reported as exactly that. It is deliberately NOT relabelled
    // as a replay conflict: the RPC refuses for several distinct reasons (replay
    // conflict, an identity bound to another route, an incomplete prior
    // transaction, a lost ownership race) and the detail is discarded here, so
    // asserting one of them would be a guess. Either way, execution never
    // proceeds and the attempt is left owned and open.
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_RESERVATION_REFUSED",
    };
  }

  // -------------------------------------------------------------------------
  // E. Execute through the EXISTING Core communication locus
  // -------------------------------------------------------------------------
  const prepared = await buildClientCommunicationIntent({
    definition,
    channel,
    leadId: envelope.entityId,
    correlationId: envelope.correlationId,
    idempotencyKey,
    builder,
  });

  let failureCode: string | null = null;

  if (!prepared.ok) {
    failureCode = prepared.code;
  } else {
    // THE production construction boundary. A direct `new CommunicationService`
    // would bypass the consent enforcer and the provider-account attribution.
    const service = createRuntimeCommunicationService();
    if (!service.ok) {
      failureCode = service.code;
    } else {
      const sent = await service.data.send(prepared.intent);
      failureCode = sent.ok ? null : sent.code;
    }
  }

  // -------------------------------------------------------------------------
  // F. Re-read durable evidence. This, not the return value above, decides.
  // -------------------------------------------------------------------------
  const evidence = await readCommunicationEvidence(idempotencyKey);
  if (evidence) {
    return evidenceResult(input.requestId, evidence, reservationReplayed);
  }

  // -------------------------------------------------------------------------
  // G. No communication row exists — and ONLY here may Core finalize directly
  // -------------------------------------------------------------------------
  const ruling = resolvePreCommunicationRuling(failureCode);
  if (!ruling) {
    // Core cannot safely classify this. It does not guess: the attempt is left
    // owned and open for QF-MVP-50.5 recovery.
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_PRE_COMMUNICATION_UNCLASSIFIED",
    };
  }

  // Only a retryable failure may carry a retry timestamp, and Core alone
  // computes it. `null` when the budget is spent lets the RPC apply its own
  // dead-letter rule. This is safe precisely because no communication row
  // exists: there is nothing for the communication lane to retry, so a new
  // automation attempt cannot duplicate a send.
  const nextRetryAt =
    ruling.classification === "retryable_failure"
      ? buildAutomationNextRetryAt({
          attemptCount: job.attempt_count,
          maxAttempts: job.max_attempts,
          now: input.now ?? new Date(),
        })
      : null;

  await completeAutomationAttempt({
    jobId: input.jobId,
    attemptId: input.attemptId,
    workerId: input.workerId,
    classification: ruling.classification,
    safeCode: ruling.safeCode,
    // There is no communication row, so there is nothing legitimate to
    // reference. Never a synthesized or borrowed identifier.
    executorReference: null,
    nextRetryAt,
  });

  return {
    ok: true,
    body: {
      ok: true,
      transportVersion: 1,
      requestId: input.requestId,
      route: "execute_v1",
      orchestrationState: "attempt_finalized",
      replayed: reservationReplayed,
    },
  };
}

/**
 * Map durable communication evidence onto the public orchestration state.
 *
 * `executorReference` is emitted ONLY for `execution_recorded`, and is only ever
 * the real `communication_messages.id`. It is deliberately withheld on
 * `communication_pending` so a state-blind orchestrator cannot even construct a
 * QF-MVP-50.2D completion body for a row the completion route would refuse.
 */
function evidenceResult(
  requestId: string,
  evidence: CommunicationEvidence,
  replayed: boolean,
): ExecuteClientAutomationResult {
  const partition = resolveCommunicationExecutionPartition(evidence.status);

  if (!partition) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_COMMUNICATION_STATE_UNKNOWN",
    };
  }

  if (partition === "pending") {
    // The communication lane owns this row's next move. 50.2E never opens a new
    // automation attempt for it, never re-dispatches it and never completes it.
    return {
      ok: true,
      body: {
        ok: true,
        transportVersion: 1,
        requestId,
        route: "execute_v1",
        orchestrationState: "communication_pending",
        replayed,
      },
    };
  }

  return {
    ok: true,
    body: {
      ok: true,
      transportVersion: 1,
      requestId,
      route: "execute_v1",
      orchestrationState: "execution_recorded",
      replayed,
      executorReference: evidence.id,
    },
  };
}

/**
 * `provider_message_id`, `destination_hash` and `destination_masked` are not in
 * this projection. They are never read here and therefore can never be surfaced.
 */
async function readCommunicationEvidence(
  idempotencyKey: string,
): Promise<CommunicationEvidence | null> {
  const { data, error } = await adminClient()
    .from("communication_messages")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  return (data as CommunicationEvidence | null) ?? null;
}

type PreparedIntent =
  | { ok: true; intent: CommunicationIntent }
  | { ok: false; code: string };

/**
 * Build the communication intent from Core-owned rows only.
 *
 * `intent.type` is the TEMPLATE KEY, matching the existing outbound consent
 * scope registry, which binds (messageType, templateKey, lane) as a triple. An
 * action whose template is not registered there is refused by the consent layer
 * as unclassified — which is the correct fail-closed answer, not a bug.
 */
async function buildClientCommunicationIntent(args: {
  definition: ClientAutomationDispatchDefinition;
  channel: "whatsapp";
  leadId: string;
  correlationId: string;
  idempotencyKey: string;
  builder: ClientVariableBuilder;
}): Promise<PreparedIntent> {
  const facts = await readLeadFacts(args.leadId);
  if (!facts.ok) return { ok: false, code: facts.code };

  // QF-MVP-50.2 FINAL CLOSURE — EXECUTION-TIME BUSINESS ELIGIBILITY REPROOF.
  //
  // A business-scheduled action was enqueued from truth that was current at
  // PRODUCER time (+24h reminder, +48h follow-up). By the time it runs, that
  // truth may have moved on. Core re-proves it from the live row before any
  // communication is attempted; n8n is never consulted and never sees lead state.
  const eligibility = await proveExecutionTimeEligibility(args.definition, args.leadId, facts.lead);
  if (!eligibility.ok) return { ok: false, code: eligibility.code };

  const variableInput = resolveVariableInput(args.definition, facts.lead);
  if (!variableInput.ok) return { ok: false, code: variableInput.code };

  // The builders are declared with an `input: never` parameter so no caller can
  // hand-roll a variable record against the wrong contract. The single cast here
  // is the one place a Core-resolved input is handed to its own builder; the
  // builder still validates every field and still proves that the emitted key set
  // equals its declared contract exactly.
  const built = (args.builder as (input: Record<string, unknown>) => BusinessVariableResult)(
    variableInput.input,
  );
  if (!built.ok) {
    return { ok: false, code: "QF_EXEC_VARIABLES_UNRESOLVED" };
  }

  return {
    ok: true,
    intent: {
      type: args.definition.templateKey,
      lane: args.definition.communicationLane,
      channel: args.channel,
      recipient_type: "lead",
      recipient_id: args.leadId,
      // Business communications must always resolve their destination from the
      // durable recipient reference. The ephemeral path is authentication-only.
      destination_source: RECIPIENT_REFERENCE_DESTINATION,
      template_key: args.definition.templateKey,
      variables: built.variables,
      entity_type: "lead",
      entity_id: args.leadId,
      correlation_id: args.correlationId,
      idempotency_key: args.idempotencyKey,
      priority: "normal",
      scheduled_at: null,
      policy_decision_id: null,
      metadata: {},
    },
  };
}

/**
 * QF-MVP-50.2 owner policy B1/B2 — the exact business states a delayed client
 * action requires AT EXECUTION TIME.
 *
 * Immediate actions have no separate reproof: their producer transaction and
 * their execution observe effectively the same truth, and every one of them
 * still passes the full Core revalidation chain plus the consent, template,
 * mapping and provider-account gates inside `send()`.
 *
 * A refusal here is a PRE-COMMUNICATION no-send: no communication row is
 * created, no provider is contacted, and the attempt is finalized through the
 * existing bounded ruling table as a deliberate terminal non-send — exactly how
 * an outbound consent refusal is already modelled. It is never reported as a
 * provider failure and never fabricates communication evidence.
 */
type EligibilityResult = { ok: true } | { ok: false; code: string };

async function proveExecutionTimeEligibility(
  definition: ClientAutomationDispatchDefinition,
  leadId: string,
  lead: LeadFacts,
): Promise<EligibilityResult> {
  switch (definition.actionType) {
    case "client.missing_information_reminder": {
      // Owner policy B1: only remind while the clarification is genuinely still
      // outstanding. A lead that answered, or whose clarification was resolved
      // or withdrawn, must never be chased.
      const { data, error } = await adminClient()
        .from("leads")
        .select("clarification_required, clarification_status")
        .eq("id", leadId)
        .maybeSingle();

      if (error) return { ok: false, code: "QF_EXEC_LEAD_LOOKUP_FAILED" };
      const row = data as
        | { clarification_required: boolean | null; clarification_status: string | null }
        | null;
      if (!row) return { ok: false, code: "QF_EXEC_LEAD_NOT_FOUND" };

      if (row.clarification_required !== true) {
        return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      }
      // `preview_prepared` is the outstanding state the producer fired on. Any
      // later state means the clarification has moved on and the reminder is moot.
      if (row.clarification_status !== "preview_prepared") {
        return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      }
      return { ok: true };
    }

    case "client.transactional_followup": {
      // Owner policy B2: only follow up while the lead is STILL exactly in the
      // status that justified the follow-up. If it moved on — won, lost,
      // re-quoted, anything — the follow-up is silently dropped.
      if (lead.status !== "Quotation Sent") {
        return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      }
      return { ok: true };
    }

    default:
      return { ok: true };
  }
}

interface LeadFacts {
  readonly name: string | null;
  readonly status: string | null;
  readonly matchedVendorCount: number;
  readonly reference: string;
}

type LeadFactsResult =
  | { ok: true; lead: LeadFacts }
  | { ok: false; code: string };

/**
 * Read the Core facts a client template may legitimately be built from.
 *
 * Nothing here comes from the requester: `safeContext` is deliberately NOT a
 * variable source, because a request source (including a future agent) must
 * never be able to choose message content.
 */
async function readLeadFacts(leadId: string): Promise<LeadFactsResult> {
  const { data, error } = await adminClient()
    .from("leads")
    .select("id, name, status")
    .eq("id", leadId)
    .maybeSingle();

  // A broken lookup is INFRASTRUCTURE, not a business fact. Distinguishing the
  // two is what keeps a transient database blip from becoming a permanent
  // definitive failure.
  if (error) return { ok: false, code: "QF_EXEC_LEAD_LOOKUP_FAILED" };

  const lead = data as { id: string; name: string | null; status: string | null } | null;
  if (!lead) return { ok: false, code: "QF_EXEC_LEAD_NOT_FOUND" };

  const { count, error: countError } = await adminClient()
    .from("lead_assignments")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId);

  if (countError) return { ok: false, code: "QF_EXEC_LEAD_LOOKUP_FAILED" };

  return {
    ok: true,
    lead: {
      name: lead.name,
      status: lead.status,
      matchedVendorCount: count ?? 0,
      // A deterministic, non-PII Core reference. The raw internal UUID is never
      // placed in a customer-visible message.
      reference: `QF-${leadId.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
    },
  };
}

type VariableInputResult =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; code: string };

/**
 * Map Core-owned lead facts onto each action's declared builder input.
 *
 * `outstandingItem` has NO proven Core source in this repository today, so the
 * two clarification actions resolve to nothing and fail closed. That is the
 * honest answer: inventing a value would put unproven text in front of a client.
 * Both of those templates are DRAFT and unmapped in any case, so this changes no
 * live capability — it records the gap instead of papering over it.
 */
function resolveVariableInput(
  definition: ClientAutomationDispatchDefinition,
  lead: LeadFacts,
): VariableInputResult {
  const unresolved: VariableInputResult = {
    ok: false,
    code: "QF_EXEC_VARIABLES_UNRESOLVED",
  };

  switch (definition.actionType) {
    case "client.lead_confirmation":
      return { ok: true, input: { clientName: lead.name } };
    case "client.matching_update":
      return {
        ok: true,
        input: { clientName: lead.name, matchedVendorCount: lead.matchedVendorCount },
      };
    case "client.lead_status_update":
      return {
        ok: true,
        input: { clientName: lead.name, leadStatusLabel: lead.status },
      };
    case "client.transactional_followup":
      return {
        ok: true,
        input: { clientName: lead.name, leadReference: lead.reference },
      };
    case "client.requirement_collection":
    case "client.missing_information_reminder":
      return unresolved;
    default:
      return unresolved;
  }
}
