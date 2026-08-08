// ============================================================================
// QF-MVP-50.3 — vendor automation execution service
//
// n8n asks Core to execute the vendor work for the exact attempt it already
// owns. Core re-proves every business fact from its own ledgers, executes
// through its OWN communication subsystem, and answers with a sanitized
// orchestration state. n8n chooses nothing: not the vendor, the phone number,
// the package, the credit balance, the template, the provider or the consent
// outcome.
//
// Ordering is the security property, exactly as in the frozen QF-MVP-50.2E
// client service: durable communication evidence is consulted BEFORE anything
// is reserved or executed, so a replay of an already-answered attempt never
// touches the ledger, never re-sends and never re-finalizes.
//
// NO VENDOR ACCEPT / REJECT. `vendor.lead_offer` is a one-way transactional
// assignment notification and `vendor.response_reminder` means only "an
// assigned lead has not progressed past vendor_status = 'New'". Neither reads,
// writes or implies a vendor decision, and there is no acceptance or rejection
// measure anywhere on this path.
// ============================================================================

import { adminClient } from "@/lib/supabase";
import {
  getVendorDispatchDefinition,
  getNonProducibleVendorReason,
  isAllowedVendorDispatchEntityType,
  VENDOR_LOW_CREDIT_THRESHOLD_POLICY_KEY,
  type VendorAutomationDispatchDefinition,
} from "@/lib/automation/vendorDispatchRegistry";
import {
  resolveCommunicationExecutionPartition,
  resolvePreCommunicationRuling,
} from "@/lib/automation/clientExecutionContract";
import type { FamilyExecutionResult } from "@/lib/automation/familyExecutionContract";
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
import { BUSINESS_VARIABLE_BUILDERS } from "@/lib/communication/businessTemplateVariables";
import type { BusinessVariableResult } from "@/lib/communication/businessTemplateVariables";
import { buildAutomationCommunicationIdempotencyKey } from "@/lib/automation/clientDispatchRegistry";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** The exact family this route may ever execute. */
export const VENDOR_EXECUTION_WORKFLOW_FAMILY = "vendor_whatsapp" as const;

export interface ExecuteVendorAutomationInput {
  readonly requestId: string;
  readonly workerId: string;
  readonly bodySha256: string;
  readonly jobId: string;
  readonly attemptId: string;
}

interface CommunicationEvidence {
  readonly id: string;
  readonly status: string;
}

export async function executeVendorAutomationForN8nTransport(
  input: ExecuteVendorAutomationInput,
): Promise<FamilyExecutionResult> {
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
    return evidenceResult(
      input.requestId,
      existingEvidence,
      ownership.verdict === "owned_completed",
    );
  }

  if (ownership.verdict === "owned_completed") {
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

  // FAMILY FENCE. A client or campaign job is NOT this route's work. Refusing
  // without finalizing leaves the attempt owned and open for its real executor
  // rather than burning it — the family-aware claim should already prevent this
  // ever happening, and this is the second, independent guard.
  if (envelope.workflowFamily !== VENDOR_EXECUTION_WORKFLOW_FAMILY) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_WORKFLOW_FAMILY_MISMATCH",
    };
  }

  // A registered-but-non-producible action must never be executed either. It
  // cannot legitimately exist as a job, so this is reported distinctly.
  const nonProducible = getNonProducibleVendorReason(envelope.actionType);
  if (nonProducible) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_VENDOR_ACTION_NOT_PRODUCIBLE",
    };
  }

  const definition = getVendorDispatchDefinition(envelope.actionType);
  if (!definition) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_ACTION_NOT_VENDOR_DISPATCHABLE",
    };
  }
  if (!isAllowedVendorDispatchEntityType(envelope.actionType, envelope.entityType)) {
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

  // -------------------------------------------------------------------------
  // D. Reserve the durable, attempt-scoped execution identity
  // -------------------------------------------------------------------------
  try {
    await recordClientExecutionTransportIdentity({
      requestId: input.requestId,
      workerId: input.workerId,
      bodySha256: input.bodySha256,
      jobId: input.jobId,
      attemptId: input.attemptId,
    });
  } catch {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_RESERVATION_REFUSED",
    };
  }

  // -------------------------------------------------------------------------
  // E. Execute through the EXISTING Core communication locus
  // -------------------------------------------------------------------------
  const prepared = await buildVendorCommunicationIntent({
    definition,
    entityType: envelope.entityType,
    entityId: envelope.entityId,
    sourceEventKey: envelope.idempotencyKey,
    correlationId: envelope.correlationId,
    idempotencyKey,
  });

  let failureCode: string | null = null;

  if (!prepared.ok) {
    failureCode = prepared.code;
  } else {
    const service = createRuntimeCommunicationService();
    if (!service.ok) {
      failureCode = service.code;
    } else {
      const sent = await service.data.send(prepared.intent);
      failureCode = sent.ok ? null : sent.code;
    }
  }

  // -------------------------------------------------------------------------
  // F. Re-read durable evidence — the send may have persisted a row
  // -------------------------------------------------------------------------
  const evidence = await readCommunicationEvidence(idempotencyKey);
  if (evidence) {
    return evidenceResult(input.requestId, evidence, false);
  }

  if (!failureCode) {
    // No row and no failure is not a state Core can classify.
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_PRE_COMMUNICATION_UNCLASSIFIED",
    };
  }

  // -------------------------------------------------------------------------
  // G. No communication row exists — and ONLY here may Core finalize directly
  // -------------------------------------------------------------------------
  const ruling = resolvePreCommunicationRuling(failureCode);
  if (!ruling) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_PRE_COMMUNICATION_UNCLASSIFIED",
    };
  }

  const nextRetryAt =
    ruling.classification === "retryable_failure"
      ? buildAutomationNextRetryAt({
          attemptCount: job.attempt_count,
          maxAttempts: job.max_attempts,
          now: new Date(),
        })
      : null;

  await completeAutomationAttempt({
    jobId: input.jobId,
    attemptId: input.attemptId,
    workerId: input.workerId,
    classification: ruling.classification,
    safeCode: ruling.safeCode,
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
      replayed: false,
    },
  };
}

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

/**
 * `executorReference` is emitted ONLY for `execution_recorded`, and is only ever
 * the durable communication row id. A pending state stops n8n: there is no
 * completion, no redispatch and no second attempt — that is QF-MVP-50.5.
 */
function evidenceResult(
  requestId: string,
  evidence: CommunicationEvidence,
  replayed: boolean,
): FamilyExecutionResult {
  const partition = resolveCommunicationExecutionPartition(evidence.status);

  if (!partition) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_COMMUNICATION_STATE_UNKNOWN",
    };
  }

  if (partition === "pending") {
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

// ---------------------------------------------------------------------------
// Intent construction — Core-owned rows only
// ---------------------------------------------------------------------------

type PreparedIntent =
  | { ok: true; intent: CommunicationIntent }
  | { ok: false; code: string };

interface VendorFacts {
  readonly vendorId: string;
  readonly vendorName: string | null;
}

async function buildVendorCommunicationIntent(args: {
  definition: VendorAutomationDispatchDefinition;
  entityType: string;
  entityId: string;
  sourceEventKey: string;
  correlationId: string;
  idempotencyKey: string;
}): Promise<PreparedIntent> {
  // 1. Resolve the vendor this action is about, from durable truth only.
  const facts = await resolveVendorFacts(args.entityType, args.entityId);
  if (!facts.ok) return { ok: false, code: facts.code };

  // 2. QF-MVP-50.3 EXECUTION-TIME BUSINESS ELIGIBILITY REPROOF, before any
  //    communication is attempted. n8n is never consulted and never sees
  //    vendor state.
  const eligibility = await proveVendorExecutionEligibility(
    args.definition,
    args.entityType,
    args.entityId,
    facts.facts,
    args.sourceEventKey,
  );
  if (!eligibility.ok) return { ok: false, code: eligibility.code };

  // 3. Variables come from the existing business template contracts. A vendor
  //    template with no bound variable contract is a Core-owned DEFINITIVE
  //    non-send, exactly as two client actions already are — never a guessed
  //    payload. Binding those contracts is QF-MVP-40.12 territory.
  const builder = BUSINESS_VARIABLE_BUILDERS[args.definition.templateKey] as
    | ((input: Record<string, unknown>) => BusinessVariableResult)
    | undefined;
  if (!builder) {
    return { ok: false, code: "QF_EXEC_VARIABLES_UNRESOLVED" };
  }

  const built = builder({ vendorName: facts.facts.vendorName });
  if (!built.ok) {
    return { ok: false, code: "QF_EXEC_VARIABLES_UNRESOLVED" };
  }

  return {
    ok: true,
    intent: {
      type: args.definition.templateKey,
      lane: args.definition.communicationLane,
      channel: "whatsapp",
      recipient_type: "vendor",
      recipient_id: facts.facts.vendorId,
      // Business communications always resolve their destination from the
      // durable recipient reference; the ephemeral path is authentication-only.
      destination_source: RECIPIENT_REFERENCE_DESTINATION,
      template_key: args.definition.templateKey,
      variables: built.variables,
      entity_type: args.entityType,
      entity_id: args.entityId,
      correlation_id: args.correlationId,
      idempotency_key: args.idempotencyKey,
      priority: "normal",
      scheduled_at: null,
      policy_decision_id: null,
      metadata: {},
    },
  };
}

type VendorFactsResult =
  | { ok: true; facts: VendorFacts }
  | { ok: false; code: string };

/**
 * An assignment-scoped action resolves its vendor THROUGH the assignment, so
 * the notification can never be addressed to a vendor the assignment does not
 * belong to.
 */
async function resolveVendorFacts(
  entityType: string,
  entityId: string,
): Promise<VendorFactsResult> {
  let vendorId = entityId;

  if (entityType === "lead_assignment") {
    const { data, error } = await adminClient()
      .from("lead_assignments")
      .select("id, vendor_id")
      .eq("id", entityId)
      .maybeSingle();
    if (error) return { ok: false, code: "QF_EXEC_LEAD_LOOKUP_FAILED" };
    const row = data as { id: string; vendor_id: string | null } | null;
    if (!row) return { ok: false, code: "QF_EXEC_VENDOR_ASSIGNMENT_NOT_FOUND" };
    if (!row.vendor_id) {
      return { ok: false, code: "QF_EXEC_VENDOR_ASSIGNMENT_NOT_FOUND" };
    }
    vendorId = row.vendor_id;
  }

  const { data, error } = await adminClient()
    .from("vendors")
    .select("id, business_name")
    .eq("id", vendorId)
    .maybeSingle();
  if (error) return { ok: false, code: "QF_EXEC_LEAD_LOOKUP_FAILED" };
  const vendor = data as { id: string; business_name: string | null } | null;
  if (!vendor) return { ok: false, code: "QF_EXEC_VENDOR_NOT_FOUND" };

  return {
    ok: true,
    facts: { vendorId: vendor.id, vendorName: vendor.business_name },
  };
}

type EligibilityResult = { ok: true } | { ok: false; code: string };

/**
 * QF-MVP-50.3 owner-locked execution-time reproof.
 *
 * A refusal here is a PRE-COMMUNICATION no-send: no communication row, no
 * provider contact, and the attempt is finalized through the existing bounded
 * ruling table as a deliberate terminal non-send. It is never reported as a
 * provider failure and never fabricates communication evidence.
 */
async function proveVendorExecutionEligibility(
  definition: VendorAutomationDispatchDefinition,
  entityType: string,
  entityId: string,
  facts: VendorFacts,
  sourceEventKey: string,
): Promise<EligibilityResult> {
  switch (definition.actionType) {
    case "vendor.lead_offer": {
      // The assignment must still exist and still belong to this vendor. This
      // is a one-way notice: no acceptance is requested, recorded or measured.
      const { data, error } = await adminClient()
        .from("lead_assignments")
        .select("id, vendor_id")
        .eq("id", entityId)
        .maybeSingle();
      if (error) return { ok: false, code: "QF_EXEC_LEAD_LOOKUP_FAILED" };
      const row = data as { id: string; vendor_id: string | null } | null;
      if (!row) return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      if (row.vendor_id !== facts.vendorId) {
        return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      }
      return { ok: true };
    }

    case "vendor.response_reminder": {
      // The 2h and 24h reminders are distinguished by their durable source
      // identity; both require the SAME live truth: the assigned lead has not
      // progressed past 'New'. This is a progress nudge, never an acceptance
      // prompt.
      const window =
        sourceEventKey.endsWith(":resp2h")
          ? "resp2h"
          : sourceEventKey.endsWith(":resp24h")
            ? "resp24h"
            : null;
      if (!window) {
        return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      }

      const { data, error } = await adminClient()
        .from("lead_assignments")
        .select("id, vendor_id, vendor_status")
        .eq("id", entityId)
        .maybeSingle();
      if (error) return { ok: false, code: "QF_EXEC_LEAD_LOOKUP_FAILED" };
      const row = data as
        | { id: string; vendor_id: string | null; vendor_status: string | null }
        | null;
      if (!row || row.vendor_id !== facts.vendorId) {
        return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      }
      if (row.vendor_status !== "New") {
        return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      }
      return { ok: true };
    }

    case "vendor.onboarding_reminder": {
      // Eligible only while onboarding has not progressed from the exact
      // canonical initial stage the producer bound this reminder to.
      const { data, error } = await adminClient()
        .from("vendor_crm_profiles")
        .select("vendor_id, onboarding_stage")
        .eq("vendor_id", facts.vendorId)
        .maybeSingle();
      if (error) return { ok: false, code: "QF_EXEC_LEAD_LOOKUP_FAILED" };
      const row = data as
        | { vendor_id: string; onboarding_stage: string | null }
        | null;
      if (!row) return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      if (row.onboarding_stage !== "new") {
        return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      }
      return { ok: true };
    }

    case "vendor.package_expiry_warning": {
      // The producer bound this warning to an EXACT expiry instant. A renewal
      // that moves package_expires_at makes the old warning stale, and the new
      // expiry produces its own new pair.
      const stamp = sourceEventKey.split(".").pop() ?? "";
      if (!/^\d{14}$/.test(stamp)) {
        return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      }

      const { data, error } = await adminClient()
        .from("vendors")
        .select("id, package_status, package_expires_at")
        .eq("id", facts.vendorId)
        .maybeSingle();
      if (error) return { ok: false, code: "QF_EXEC_LEAD_LOOKUP_FAILED" };
      const row = data as
        | { id: string; package_status: string | null; package_expires_at: string | null }
        | null;
      if (!row) return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      if (row.package_status !== "active" || !row.package_expires_at) {
        return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      }
      if (formatExpiryStamp(row.package_expires_at) !== stamp) {
        return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      }
      return { ok: true };
    }

    case "vendor.low_credit_warning": {
      // The threshold is read from the SAME policy config the producer used.
      // There is deliberately no numeric fallback here: an unconfigured
      // threshold is a terminal non-send, never an assumed 3.
      const threshold = await readLowCreditThreshold();
      if (threshold === null) {
        return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      }

      const { data, error } = await adminClient()
        .from("vendors")
        .select("id, remaining_credits")
        .eq("id", facts.vendorId)
        .maybeSingle();
      if (error) return { ok: false, code: "QF_EXEC_LEAD_LOOKUP_FAILED" };
      const row = data as { id: string; remaining_credits: number | null } | null;
      if (!row || row.remaining_credits === null) {
        return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      }
      // A recharge back above the threshold makes the warning stale.
      if (row.remaining_credits > threshold) {
        return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
      }
      return { ok: true };
    }

    default:
      return { ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" };
  }
}

/** `YYYYMMDDHH24MISS` in UTC — the exact producer stamp format. */
function formatExpiryStamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`
  );
}

/**
 * The owner-locked low-credit threshold, read from `automation_policy_configs`
 * through the SAME canonical policy key the producer uses. Returns null when
 * unconfigured — the caller then refuses rather than assuming a number.
 */
async function readLowCreditThreshold(): Promise<number | null> {
  const { data, error } = await adminClient()
    .from("automation_policy_active_configs")
    .select("policy_key, automation_policy_configs!inner(config_json)")
    .eq("policy_key", VENDOR_LOW_CREDIT_THRESHOLD_POLICY_KEY)
    .maybeSingle();

  if (error || !data) return null;

  const joined = (data as { automation_policy_configs?: unknown })
    .automation_policy_configs;
  const config = Array.isArray(joined) ? joined[0] : joined;
  const configJson = (config as { config_json?: unknown } | undefined)?.config_json;
  if (typeof configJson !== "object" || configJson === null) return null;

  const raw = (configJson as Record<string, unknown>).thresholdCredits;
  return typeof raw === "number" && Number.isInteger(raw) ? raw : null;
}
