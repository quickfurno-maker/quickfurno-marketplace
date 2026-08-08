// ============================================================================
// QF-MVP-50.4 — campaign automation execution service
//
// The per-recipient loop QF-MVP-40.8 §7 assigns to QF-MVP-50, and nothing more.
//
// This service creates NO audience, NO recipient, NO communication intent and
// NO campaign result authority. The frozen audience
// (vendor_campaign_audience_members), the bounded handoff
// (qf_handoff_vendor_campaign_intents_v1, 1..500 default 100) and the
// per-recipient unit (communication_intents) all remain exactly where they are.
//
// The seam is the binding one from docs/QF-MVP-40-8-CAMPAIGN-RESULT-CONTRACT.md:
//
//   buildCampaignExecutionPlan({ intentId })
//     -> the EXISTING CommunicationService outbound path
//     -> reconcileCampaignIntent({ intentId })
//
// The intent id is derived ONLY from durable automation job/action truth. n8n
// supplies an attempt identity and nothing else: not a recipient, a template, a
// provider, a consent decision, a frequency cap or an aggregate.
// ============================================================================

import { adminClient } from "@/lib/supabase";
import {
  getCampaignDispatchDefinition,
  getNonProducedCampaignReason,
  isAllowedCampaignDispatchEntityType,
} from "@/lib/automation/campaignDispatchRegistry";
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
import {
  buildCampaignExecutionPlan,
  reconcileCampaignIntent,
} from "@/services/campaignCommunicationResultService";
import { createRuntimeCommunicationService } from "@/services/runtimeCommunicationService";
import { RECIPIENT_REFERENCE_DESTINATION } from "@/lib/communication/types";
import { buildAutomationCommunicationIdempotencyKey } from "@/lib/automation/clientDispatchRegistry";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** The exact family this route may ever execute. */
export const CAMPAIGN_EXECUTION_WORKFLOW_FAMILY = "campaign_execution" as const;

export interface ExecuteCampaignAutomationInput {
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

export async function executeCampaignAutomationForN8nTransport(
  input: ExecuteCampaignAutomationInput,
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

  // A. Ownership and currency of the exact attempt
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

  // B. Durable communication evidence FIRST
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

  // C. Rebuild every fact from Core evidence
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

  // FAMILY FENCE. A client or vendor job is not this route's work; refusing
  // without finalizing leaves the attempt for its real executor.
  if (envelope.workflowFamily !== CAMPAIGN_EXECUTION_WORKFLOW_FAMILY) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_WORKFLOW_FAMILY_MISMATCH",
    };
  }

  // campaign.execute_batch is REGISTERED but never produced: batch advance
  // remains the Core-owned handoff. If one ever reaches here, fail closed
  // rather than inventing a second fan-out authority.
  if (getNonProducedCampaignReason(envelope.actionType)) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_CAMPAIGN_ACTION_NOT_PRODUCED",
    };
  }

  const definition = getCampaignDispatchDefinition(envelope.actionType);
  if (!definition) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_ACTION_NOT_CAMPAIGN_DISPATCHABLE",
    };
  }
  if (!isAllowedCampaignDispatchEntityType(envelope.actionType, envelope.entityType)) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_ENTITY_TYPE_NOT_ALLOWED",
    };
  }
  // THE INTENT ID COMES FROM DURABLE JOB TRUTH — never from the request.
  const intentId = envelope.entityId;
  if (!UUID_RE.test(intentId)) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_ENTITY_IDENTITY_INVALID",
    };
  }

  // D. Reserve the durable, attempt-scoped execution identity
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

  // E. THE 40.8 SEAM.
  //
  //    Step 1 — Core validates the intent and derives the plan. Every campaign
  //    fact (channel, template, linkage, correlation, idempotency, consent
  //    scope, snapshot evidence) comes from the committed intent row; this
  //    service adds none of them and recalculates no audience.
  let failureCode: string | null = null;
  let planned: Awaited<ReturnType<typeof buildCampaignExecutionPlan>> | null = null;

  planned = await buildCampaignExecutionPlan({ intentId });
  if (!planned.ok) {
    // A cancelled, mismatched, already-reconciled or otherwise ineligible
    // intent is a Core-owned refusal, mapped to a bounded terminal non-send.
    failureCode = "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE";
  } else {
    //  Step 2 — dispatch through the EXISTING CommunicationService outbound
    //  path. Consent, suppression, frequency, mapping, provider-account and
    //  runtime gates are all re-checked there, at the network boundary.
    const service = createRuntimeCommunicationService();
    if (!service.ok) {
      failureCode = service.code;
    } else {
      const plan = planned.plan;
      const sent = await service.data.send({
        type: plan.templateKey,
        lane: "business",
        channel: "whatsapp",
        recipient_type: "vendor",
        recipient_id: plan.entityId,
        destination_source: RECIPIENT_REFERENCE_DESTINATION,
        template_key: plan.templateKey,
        variables: {},
        entity_type: plan.entityType,
        entity_id: plan.intentId,
        correlation_id: plan.correlationId,
        idempotency_key: plan.idempotencyKey,
        priority: "normal",
        scheduled_at: null,
        policy_decision_id: null,
        metadata: {},
      });
      failureCode = sent.ok ? null : sent.code;

      //  Step 3 — reconcile. Safe to call repeatedly; it derives the intent
      //  status from the canonical message and never invents an aggregate.
      await reconcileCampaignIntent({ intentId: plan.intentId });
    }
  }

  // F. Re-read durable evidence — the send may have persisted a row
  const evidence = await readCommunicationEvidence(idempotencyKey);
  if (evidence) {
    return evidenceResult(input.requestId, evidence, false);
  }

  if (!failureCode) {
    return {
      ok: false,
      status: 409,
      code: "AUTOMATION_EXECUTION_PRE_COMMUNICATION_UNCLASSIFIED",
    };
  }

  // G. No communication row exists — and ONLY here may Core finalize directly
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
