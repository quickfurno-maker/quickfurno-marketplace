// ============================================================================
// QuickFurno — services/campaignCommunicationResultService.ts   (QF-MVP-40.8)
//
// SERVER ONLY. The Core-owned boundary that lets QF-MVP-50 reconcile a campaign
// communication INTENT from its canonical communication MESSAGE, and lets CRM read
// a safe per-campaign projection.
//
// WHAT THIS IS
//   A reconciler and a reader. It derives truth from Core tables and writes only
//   `communication_intents.status` (plus `dispatched_at` on first dispatch).
//
// WHAT THIS IS NOT — and these omissions are the security model:
//   * NOT a dispatcher, claimer, batcher, scheduler or retry worker (QF-MVP-50).
//   * NOT an n8n route, webhook or callback endpoint (QF-MVP-50).
//   * NOT an operations dashboard or manual-retry surface (QF-MVP-70).
//   * NOT a provider caller — it contacts no provider and sends nothing.
//   * NOT a campaign lifecycle authority — it never touches vendor_campaigns.
//
// THE CALLER CANNOT ASSERT AN OUTCOME
//   Every operation takes IDENTIFIERS ONLY. There is no parameter for a desired
//   status, provider message id, delivery claim, recipient, destination, template
//   substitution, consent/suppression/frequency result, provider account or
//   retryability. An orchestrator can say "reconcile intent X"; it can never say
//   "intent X succeeded". Core re-reads the canonical message and decides.
//
// PRIVACY
//   No `recipient_ref`, destination, phone, email, message body or raw provider
//   payload is ever selected or returned. Failures are closed reason codes.
// ============================================================================

import "server-only";

import { adminClient } from "../lib/supabase";
import type { CommunicationMessageStatus } from "../lib/communication/types";
import {
  CAMPAIGN_AGGREGATE_TYPE,
  CAMPAIGN_INTENT_CHANNEL,
  INTENT_ENTITY_TYPE,
  IntentResultStatus,
  ReconcileRefusal,
  campaignCorrelationId,
  campaignMessageIdempotencyKey,
  isForwardTransition,
  isTerminalIntentStatus,
  projectIntentStatus,
  type CampaignResultProjection,
  type IntentReconcileResult,
  type IntentResultStatusValue,
  type ReconcileRefusalValue,
} from "../lib/communication/campaignResultContract";

function db() { return adminClient(); }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Only the columns Core needs. `recipient_ref` is deliberately never selected. */
const INTENT_COLUMNS = "id, aggregate_type, aggregate_id, channel, template_purpose, payload_ref, status, dispatched_at";
const MESSAGE_COLUMNS = "id, entity_type, entity_id, channel, template_key, status, idempotency_key";

type IntentRow = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  channel: string;
  template_purpose: string;
  payload_ref: Record<string, unknown> | null;
  status: string;
  dispatched_at: string | null;
};

type MessageRow = {
  id: string;
  entity_type: string | null;
  entity_id: string | null;
  channel: string;
  template_key: string;
  status: CommunicationMessageStatus;
  idempotency_key: string;
};

const refuse = (reason: ReconcileRefusalValue) => ({ ok: false as const, reason });

/**
 * The execution plan an orchestrator needs in order to create the canonical
 * message. It is DERIVED, never supplied: every field is computed by Core from
 * the intent's own committed evidence.
 *
 * Note what is absent: no destination, no rendered body, no provider account and
 * no template variables. Resolving a recipient and rendering an approved template
 * remain the existing CommunicationService/outbound responsibilities, behind the
 * unchanged consent, mapping and runtime gates.
 */
export interface CampaignExecutionPlan {
  readonly intentId: string;
  readonly campaignId: string;
  readonly channel: string;
  readonly templateKey: string;
  readonly entityType: typeof INTENT_ENTITY_TYPE;
  readonly entityId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly consentScope: string | null;
  readonly snapshotId: string | null;
  readonly snapshotRevision: number | null;
}

async function loadIntent(intentId: string): Promise<IntentRow | null> {
  const { data, error } = await db()
    .from("communication_intents").select(INTENT_COLUMNS).eq("id", intentId).maybeSingle();
  if (error) return null;
  return (data as IntentRow | null) ?? null;
}

/** The single message that may serve this intent, found by its deterministic key. */
async function loadLinkedMessage(intentId: string): Promise<MessageRow | null> {
  const { data, error } = await db()
    .from("communication_messages").select(MESSAGE_COLUMNS)
    .eq("idempotency_key", campaignMessageIdempotencyKey(intentId)).maybeSingle();
  if (error) return null;
  return (data as MessageRow | null) ?? null;
}

/**
 * Validate the intent and derive its execution plan. Core proves every fact:
 * the intent exists, is a campaign intent, belongs to the supplied campaign,
 * uses the supported channel, and carries the committed campaign evidence.
 */
export async function buildCampaignExecutionPlan(input: {
  intentId: unknown;
  campaignId?: unknown;
}): Promise<{ ok: true; plan: CampaignExecutionPlan } | { ok: false; reason: ReconcileRefusalValue }> {
  if (!isUuid(input?.intentId)) return refuse(ReconcileRefusal.INTENT_NOT_FOUND);
  if (input.campaignId !== undefined && !isUuid(input.campaignId)) {
    return refuse(ReconcileRefusal.INTENT_CAMPAIGN_MISMATCH);
  }

  const intent = await loadIntent(input.intentId);
  if (!intent) return refuse(ReconcileRefusal.INTENT_NOT_FOUND);
  if (intent.aggregate_type !== CAMPAIGN_AGGREGATE_TYPE) return refuse(ReconcileRefusal.INTENT_NOT_CAMPAIGN);
  if (input.campaignId !== undefined && intent.aggregate_id !== input.campaignId) {
    return refuse(ReconcileRefusal.INTENT_CAMPAIGN_MISMATCH);
  }
  if (intent.channel !== CAMPAIGN_INTENT_CHANNEL) return refuse(ReconcileRefusal.INTENT_CHANNEL_UNSUPPORTED);

  // The committed evidence the handoff RPC wrote. A template supplied any other
  // way is refused, so an orchestrator cannot substitute one.
  const payload = intent.payload_ref ?? {};
  const templateKey = payload["template_key"];
  const campaignInPayload = payload["campaign_id"];
  if (typeof templateKey !== "string" || templateKey === "" || templateKey !== intent.template_purpose) {
    return refuse(ReconcileRefusal.INTENT_EVIDENCE_INVALID);
  }
  if (campaignInPayload !== intent.aggregate_id) return refuse(ReconcileRefusal.INTENT_EVIDENCE_INVALID);

  const snapshotRevision = payload["snapshot_revision"];
  return {
    ok: true,
    plan: {
      intentId: intent.id,
      campaignId: intent.aggregate_id,
      channel: intent.channel,
      templateKey,
      entityType: INTENT_ENTITY_TYPE,
      entityId: intent.id,
      correlationId: campaignCorrelationId(intent.aggregate_id),
      idempotencyKey: campaignMessageIdempotencyKey(intent.id),
      consentScope: typeof payload["consent_scope"] === "string" ? (payload["consent_scope"] as string) : null,
      snapshotId: typeof payload["snapshot_id"] === "string" ? (payload["snapshot_id"] as string) : null,
      snapshotRevision: typeof snapshotRevision === "number" ? snapshotRevision : null,
    },
  };
}

/**
 * Reconcile ONE intent from ITS canonical message.
 *
 * Idempotent by construction: the derived status is a pure function of the
 * message, so repeating the call yields the same answer. A same-status result is
 * reported `unchanged` and performs no write, so `dispatched_at` is never rewritten.
 *
 * The update is COMPARE-AND-SET on the status we observed. A concurrent writer
 * that moved the row first makes the update match zero rows, which is reported as
 * CONCURRENT_MODIFICATION rather than being silently overwritten.
 */
export async function reconcileCampaignIntent(input: {
  intentId: unknown;
  campaignId?: unknown;
}): Promise<IntentReconcileResult> {
  const planned = await buildCampaignExecutionPlan(input);
  if (!planned.ok) return { ok: false, reason: planned.reason };
  const plan = planned.plan;

  const message = await loadLinkedMessage(plan.intentId);
  if (!message) return refuse(ReconcileRefusal.MESSAGE_NOT_FOUND);

  // The message must be bound to THIS intent. A message carrying another intent's
  // entity id, or none, can never reconcile this one.
  if (message.entity_type !== INTENT_ENTITY_TYPE || message.entity_id !== plan.intentId) {
    return refuse(ReconcileRefusal.MESSAGE_LINKAGE_MISMATCH);
  }
  if (message.channel !== plan.channel) return refuse(ReconcileRefusal.MESSAGE_CHANNEL_MISMATCH);
  if (message.template_key !== plan.templateKey) return refuse(ReconcileRefusal.MESSAGE_TEMPLATE_MISMATCH);

  const currentIntent = await loadIntent(plan.intentId);
  if (!currentIntent) return refuse(ReconcileRefusal.INTENT_NOT_FOUND);
  const current = currentIntent.status as IntentResultStatusValue;

  const derived = projectIntentStatus(message.status);

  if (derived === current) {
    return {
      ok: true, intentId: plan.intentId, intentStatus: current,
      canonicalMessageStatus: message.status, unchanged: true,
      uncertain: current === IntentResultStatus.UNCERTAIN,
      terminal: isTerminalIntentStatus(current),
    };
  }
  if (!isForwardTransition(current, derived)) return refuse(ReconcileRefusal.STATUS_REGRESSION_REFUSED);

  const patch: Record<string, unknown> = { status: derived };
  // Stamp the FIRST dispatch only. Checked in code against the row we just read,
  // so a later forward move (dispatched -> delivered) never rewrites the stamp.
  if (derived === IntentResultStatus.DISPATCHED && currentIntent.dispatched_at === null) {
    patch.dispatched_at = new Date().toISOString();
  }

  const { data, error } = await db()
    .from("communication_intents")
    .update(patch)
    .eq("id", plan.intentId)
    .eq("status", current)            // COMPARE-AND-SET on the observed status
    .select("id");

  if (error) return refuse(ReconcileRefusal.RECONCILE_FAILED);
  if (!data || data.length === 0) return refuse(ReconcileRefusal.CONCURRENT_MODIFICATION);

  return {
    ok: true, intentId: plan.intentId, intentStatus: derived,
    canonicalMessageStatus: message.status, unchanged: false,
    uncertain: derived === IntentResultStatus.UNCERTAIN,
    terminal: isTerminalIntentStatus(derived),
  };
}

/** A safe, sanitized single-intent read. Identifiers and states only. */
export async function getCampaignIntentResult(input: {
  intentId: unknown;
  campaignId?: unknown;
}): Promise<IntentReconcileResult> {
  const planned = await buildCampaignExecutionPlan(input);
  if (!planned.ok) return { ok: false, reason: planned.reason };
  const plan = planned.plan;

  const intent = await loadIntent(plan.intentId);
  if (!intent) return refuse(ReconcileRefusal.INTENT_NOT_FOUND);
  const message = await loadLinkedMessage(plan.intentId);
  if (!message) return refuse(ReconcileRefusal.MESSAGE_NOT_FOUND);
  if (message.entity_type !== INTENT_ENTITY_TYPE || message.entity_id !== plan.intentId) {
    return refuse(ReconcileRefusal.MESSAGE_LINKAGE_MISMATCH);
  }

  const status = intent.status as IntentResultStatusValue;
  return {
    ok: true, intentId: plan.intentId, intentStatus: status,
    canonicalMessageStatus: message.status, unchanged: true,
    uncertain: status === IntentResultStatus.UNCERTAIN,
    terminal: isTerminalIntentStatus(status),
  };
}

/**
 * Per-campaign CRM projection. Aggregates only.
 *
 * Deliberately absent: any `recipient_ref` list, destination, phone, email,
 * message body or provider payload. This is a read model, not the QF-MVP-70
 * operations console — there is no retry control and no status override.
 */
export async function getCampaignResultProjection(campaignId: unknown): Promise<CampaignResultProjection> {
  if (!isUuid(campaignId)) {
    return emptyProjection(typeof campaignId === "string" ? campaignId : "");
  }

  const { data: intentRows, error: intentErr } = await db()
    .from("communication_intents")
    .select("id, status, created_at, dispatched_at")
    .eq("aggregate_type", CAMPAIGN_AGGREGATE_TYPE)
    .eq("aggregate_id", campaignId);
  if (intentErr) return emptyProjection(campaignId);

  const intents = (intentRows ?? []) as { id: string; status: string; created_at: string; dispatched_at: string | null }[];
  if (intents.length === 0) return emptyProjection(campaignId);

  // One correlated read for the whole campaign — no per-intent fan-out.
  const { data: msgRows } = await db()
    .from("communication_messages")
    .select("entity_id, status")
    .eq("entity_type", INTENT_ENTITY_TYPE)
    .eq("correlation_id", campaignCorrelationId(campaignId));
  const messages = (msgRows ?? []) as { entity_id: string | null; status: CommunicationMessageStatus }[];
  const byIntent = new Map(messages.filter((m) => m.entity_id).map((m) => [m.entity_id as string, m.status]));

  const byIntentStatus: Record<string, number> = {};
  const byCanonicalMessageStatus: Record<string, number> = {};
  let linked = 0, anomalies = 0, readCount = 0;
  let latestCreated: string | null = null, latestDispatched: string | null = null;

  for (const i of intents) {
    byIntentStatus[i.status] = (byIntentStatus[i.status] ?? 0) + 1;
    if (!latestCreated || i.created_at > latestCreated) latestCreated = i.created_at;
    if (i.dispatched_at && (!latestDispatched || i.dispatched_at > latestDispatched)) latestDispatched = i.dispatched_at;

    const msgStatus = byIntent.get(i.id);
    if (!msgStatus) continue;
    linked += 1;
    byCanonicalMessageStatus[msgStatus] = (byCanonicalMessageStatus[msgStatus] ?? 0) + 1;
    if (msgStatus === "read") readCount += 1;
    // An anomaly is a linked intent whose stored status disagrees with what its
    // canonical message projects to — i.e. reconciliation has not caught up, or
    // something wrote the intent out of band. Surfaced, never auto-corrected here.
    if (projectIntentStatus(msgStatus) !== (i.status as IntentResultStatusValue)) anomalies += 1;
  }

  const n = (s: string) => byIntentStatus[s] ?? 0;
  return {
    campaignId,
    aggregateType: CAMPAIGN_AGGREGATE_TYPE,
    totalIntents: intents.length,
    byIntentStatus,
    byCanonicalMessageStatus,
    linkedCount: linked,
    unlinkedCount: intents.length - linked,
    pendingOrClaimedCount: n(IntentResultStatus.PENDING) + n(IntentResultStatus.CLAIMED),
    dispatchedCount: n(IntentResultStatus.DISPATCHED),
    deliveredCount: n(IntentResultStatus.DELIVERED),
    readCount,
    failedCount: n(IntentResultStatus.FAILED),
    uncertainCount: n(IntentResultStatus.UNCERTAIN),
    reconciliationAnomalies: anomalies,
    latestIntentCreatedAt: latestCreated,
    latestDispatchedAt: latestDispatched,
  };
}

function emptyProjection(campaignId: string): CampaignResultProjection {
  return {
    campaignId, aggregateType: CAMPAIGN_AGGREGATE_TYPE, totalIntents: 0,
    byIntentStatus: {}, byCanonicalMessageStatus: {}, linkedCount: 0, unlinkedCount: 0,
    pendingOrClaimedCount: 0, dispatchedCount: 0, deliveredCount: 0, readCount: 0,
    failedCount: 0, uncertainCount: 0, reconciliationAnomalies: 0,
    latestIntentCreatedAt: null, latestDispatchedAt: null,
  };
}
