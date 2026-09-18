import { createHash, randomUUID } from "crypto";
import { adminClient } from "../lib/supabase";
import { hashPhoneE164, maskPhoneE164, normalizePhoneE164 } from "../lib/communication/phone";
import { openConversationValue, sealConversationValue } from "../lib/communication/conversationSeal";
import { resolveConversationalMetaConfig, outboundToRuntime } from "../lib/communication/providers/metaCloudWhatsAppConfig";
import { MetaCloudWhatsAppProvider, META_WHATSAPP_CLOUD_PROVIDER_KEY } from "../lib/communication/providers/metaCloudWhatsAppProvider";
import { FetchHttpTransport } from "../lib/communication/httpTransport";
import { evaluateMetaOutboundGateForMessage } from "./communicationProviderRuntimeService";
import { effectiveProviderOutcomeCertainty } from "../lib/communication/providers/providerOutcome";
import { resolveWhatsAppConciergeRouting } from "../lib/communication/whatsAppConciergeRouting";
import { deriveJarvisNormalizedText } from "../lib/communication/providers/metaWhatsAppInbound";
import {
  parseSerializedQfWhatsAppExperience,
  renderQfWhatsAppExperienceFallback,
  serializeQfWhatsAppExperience,
  textExperience,
  type QfWhatsAppExperienceV1,
} from "../lib/jarvis/whatsAppExperience";

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const CHANNEL = "whatsapp";

type ClosedReason =
  | "provider_account_not_conversational"
  | "conversation_not_found"
  | "conversation_not_sendable"
  | "stale_revision"
  | "service_window_closed"
  | "suppressed"
  | "seal_unavailable"
  | "provider_not_configured"
  | "provider_account_mismatch"
  | "inbound_message_mismatch"
  | "runtime_gate_blocked"
  | "outbox_not_found"
  | "outbox_not_dispatchable"
  | "claim_conflict";

export type ConversationalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: ClosedReason };

function destinationAad(id: string, providerAccountId: string, destinationHash: string): string {
  return ["qf.conversation.destination.v1", id, providerAccountId, destinationHash].join("\n");
}
function bodyAad(id: string, conversationId: string, expectedRevision: number, bodyDigest: string): string {
  return ["qf.conversation.outbox.body.v1", id, conversationId, String(expectedRevision), bodyDigest].join("\n");
}
function bodyDigest(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}
function safeOccurredAt(value: string | null | undefined): Date {
  const parsed = value ? new Date(value) : new Date();
  const now = Date.now();
  const ms = parsed.getTime();
  if (!Number.isFinite(ms) || ms > now + 5 * 60 * 1000) return new Date(now);
  return parsed;
}

async function providerAccount(providerAccountId: string) {
  const { data, error } = await adminClient()
    .from("communication_provider_accounts")
    .select("id,provider_key,channel,account_alias,account_role,jarvis_access_mode,phone_number_reference,business_account_reference,readiness_status")
    .eq("id", providerAccountId)
    .maybeSingle();
  return error || !data ? null : data as any;
}

async function activeSuppression(destinationHash: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await adminClient()
    .from("communication_suppressions")
    .select("id,scope,expires_at")
    .eq("destination_hash", destinationHash)
    .eq("channel", CHANNEL)
    .eq("is_active", true)
    .in("scope", ["global", "transactional"]);
  if (error) return true;
  return (data ?? []).some((row: any) => !row.expires_at || row.expires_at > now);
}

export async function recordConversationalInbound(input: {
  readonly providerAccountId: string;
  readonly inboundMessageId: string;
  readonly senderPhoneE164: string;
  readonly providerMessageId: string;
  readonly occurredAt?: string | null;
  readonly identityConfidence: "exact" | "ambiguous" | "unknown";
  readonly principalType: "client" | "vendor" | "admin" | null;
  readonly messageType: string;
  readonly contentMinimized: Record<string, unknown>;
  /** Persist/audit the turn but never enqueue it for Jarvis (used for STOP / START / HELP). */
  readonly suppressJarvisTurn?: boolean;
}): Promise<ConversationalResult<{ conversationId: string; revision: number; jarvisEnabled: boolean }>> {
  const account = await providerAccount(input.providerAccountId);
  if (!account || account.provider_key !== META_WHATSAPP_CLOUD_PROVIDER_KEY || account.channel !== CHANNEL || account.account_role !== "conversational") {
    return { ok: false, reason: "provider_account_not_conversational" };
  }

  const normalized = normalizePhoneE164(input.senderPhoneE164);
  if (!normalized.ok) return { ok: false, reason: "seal_unavailable" };

  // The durable inbound row is the identity authority. A Meta redelivery may carry request-memory
  // plaintext again, but it must never be allowed to rebind a stored wamid to a different sender/account.
  const { data: durableInbound, error: inboundError } = await adminClient()
    .from("communication_inbound_messages")
    .select("id,provider_account_id,provider_message_id,sender_hash,conversation_id")
    .eq("id", input.inboundMessageId)
    .maybeSingle();
  const requestDestinationHash = hashPhoneE164(normalized.e164);
  if (
    inboundError || !durableInbound ||
    durableInbound.provider_account_id !== input.providerAccountId ||
    durableInbound.provider_message_id !== input.providerMessageId ||
    durableInbound.sender_hash !== requestDestinationHash
  ) return { ok: false, reason: "inbound_message_mismatch" };

  // Idempotency fence: once this durable inbound row is linked, any provider redelivery is a no-op
  // for conversation revision/window/Jarvis-turn creation. This also handles old-message redeliveries.
  if (durableInbound.conversation_id) {
    const { data: linked, error: linkedError } = await adminClient()
      .from("communication_conversations")
      .select("id,provider_account_id,destination_hash,revision,jarvis_enabled")
      .eq("id", durableInbound.conversation_id)
      .maybeSingle();
    if (
      linkedError || !linked ||
      linked.provider_account_id !== input.providerAccountId ||
      linked.destination_hash !== durableInbound.sender_hash
    ) return { ok: false, reason: "inbound_message_mismatch" };
    return { ok: true, value: {
      conversationId: linked.id,
      revision: Number(linked.revision),
      jarvisEnabled: linked.jarvis_enabled === true,
    }};
  }

  const destinationHash = durableInbound.sender_hash;
  const occurred = safeOccurredAt(input.occurredAt);
  const serviceWindowExpiresAt = new Date(occurred.getTime() + SERVICE_WINDOW_MS).toISOString();

  const { data: existing } = await adminClient()
    .from("communication_conversations")
    .select("*")
    .eq("provider_account_id", input.providerAccountId)
    .eq("destination_hash", destinationHash)
    .in("state", ["OPEN", "PAUSED", "HUMAN"])
    .maybeSingle();

  // Recovery fence for the narrow failure window where the conversation was advanced but the
  // inbound-row link did not commit. Replaying the same latest wamid repairs the link without another revision.
  if (existing && existing.last_inbound_provider_message_id === input.providerMessageId) {
    const { data: relinked, error: relinkError } = await adminClient()
      .from("communication_inbound_messages")
      .update({ conversation_id: existing.id })
      .eq("id", input.inboundMessageId)
      .eq("provider_account_id", input.providerAccountId)
      .eq("provider_message_id", input.providerMessageId)
      .eq("sender_hash", destinationHash)
      .is("conversation_id", null)
      .select("id");
    if (relinkError) return { ok: false, reason: "inbound_message_mismatch" };
    if (!Array.isArray(relinked) || relinked.length > 1) return { ok: false, reason: "inbound_message_mismatch" };
    return { ok: true, value: {
      conversationId: existing.id,
      revision: Number(existing.revision),
      jarvisEnabled: existing.jarvis_enabled === true,
    }};
  }

  const routing = resolveWhatsAppConciergeRouting({
    identityConfidence: input.identityConfidence,
    principalType: input.principalType,
    messageType: input.messageType,
    contentMinimized: input.contentMinimized,
    currentSubjectType: existing?.subject_type,
    currentActor: existing?.assigned_actor,
    currentHumanTakeover: existing?.human_takeover === true,
    isNewConversation: !existing,
  });
  const jarvisAllowedByAccount = account.jarvis_access_mode === "proposal_only";

  let conversation: any;
  if (existing) {
    const aad = destinationAad(existing.id, input.providerAccountId, destinationHash);
    const sealed = sealConversationValue(normalized.e164, aad);
    if (!sealed.ok) return { ok: false, reason: "seal_unavailable" };
    const nextRevision = Number(existing.revision ?? 0) + 1;
    const { data, error } = await adminClient()
      .from("communication_conversations")
      .update({
        sealed_destination_ciphertext: sealed.value.ciphertext,
        sealed_destination_nonce: sealed.value.nonce,
        sealed_destination_auth_tag: sealed.value.authTag,
        encryption_key_id: sealed.value.keyId,
        destination_masked: maskPhoneE164(normalized.e164),
        subject_type: routing.subjectType,
        assigned_actor: routing.assignedActor,
        state: routing.state,
        jarvis_enabled: jarvisAllowedByAccount && routing.jarvisEnabled,
        human_takeover: routing.humanTakeover,
        last_inbound_at: occurred.toISOString(),
        service_window_expires_at: serviceWindowExpiresAt,
        last_inbound_provider_message_id: input.providerMessageId,
        revision: nextRevision,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("revision", existing.revision)
      .select("*")
      .single();
    if (error || !data) return { ok: false, reason: "stale_revision" };
    conversation = data;
  } else {
    const id = randomUUID();
    const aad = destinationAad(id, input.providerAccountId, destinationHash);
    const sealed = sealConversationValue(normalized.e164, aad);
    if (!sealed.ok) return { ok: false, reason: "seal_unavailable" };
    const { data, error } = await adminClient()
      .from("communication_conversations")
      .insert({
        id,
        provider_key: META_WHATSAPP_CLOUD_PROVIDER_KEY,
        provider_account_id: input.providerAccountId,
        destination_hash: destinationHash,
        destination_masked: maskPhoneE164(normalized.e164),
        sealed_destination_ciphertext: sealed.value.ciphertext,
        sealed_destination_nonce: sealed.value.nonce,
        sealed_destination_auth_tag: sealed.value.authTag,
        encryption_key_id: sealed.value.keyId,
        subject_type: routing.subjectType,
        assigned_actor: routing.assignedActor,
        state: routing.state,
        jarvis_enabled: jarvisAllowedByAccount && routing.jarvisEnabled,
        human_takeover: routing.humanTakeover,
        last_inbound_at: occurred.toISOString(),
        service_window_expires_at: serviceWindowExpiresAt,
        last_inbound_provider_message_id: input.providerMessageId,
        revision: 1,
      })
      .select("*")
      .single();
    if (error || !data) return { ok: false, reason: "conversation_not_sendable" };
    conversation = data;
  }

  const { data: linkedRows, error: linkError } = await adminClient()
    .from("communication_inbound_messages")
    .update({ conversation_id: conversation.id })
    .eq("id", input.inboundMessageId)
    .eq("provider_account_id", input.providerAccountId)
    .eq("provider_message_id", input.providerMessageId)
    .eq("sender_hash", destinationHash)
    .is("conversation_id", null)
    .select("id");
  if (linkError || !Array.isArray(linkedRows) || linkedRows.length !== 1) {
    // A concurrent replay may have linked the same durable row first. Accept only that exact convergence.
    const { data: rebound } = await adminClient()
      .from("communication_inbound_messages")
      .select("conversation_id")
      .eq("id", input.inboundMessageId)
      .maybeSingle();
    if (!rebound || rebound.conversation_id !== conversation.id) {
      return { ok: false, reason: "inbound_message_mismatch" };
    }
  }

  await adminClient().from("communication_conversation_events").insert({
    conversation_id: conversation.id,
    event_type: "whatsapp.inbound_captured",
    actor_type: "META",
    safe_summary: "Verified inbound WhatsApp turn captured and service window refreshed.",
    reference_type: "inbound_message",
    reference_id: input.inboundMessageId,
    event_data: { serviceWindowExpiresAt },
  });

  if (input.suppressJarvisTurn !== true && routing.systemExperience !== undefined) {
    await queueSystemConversationExperience({
      conversationId: conversation.id,
      expectedRevision: Number(conversation.revision),
      inboundMessageId: input.inboundMessageId,
      experience: routing.systemExperience,
    });
  }

  const actor = String(conversation.assigned_actor);
  if (
    input.suppressJarvisTurn !== true &&
    routing.suppressJarvisTurn !== true &&
    conversation.state === "OPEN" &&
    conversation.human_takeover !== true &&
    conversation.jarvis_enabled === true &&
    process.env.QF_JARVIS_WHATSAPP_ENABLED?.trim().toLowerCase() === "true" &&
    ["AAROHI", "ANISHA", "RIYA"].includes(actor)
  ) {
    await adminClient().from("communication_jarvis_turn_outbox").upsert({
      conversation_id: conversation.id,
      inbound_message_id: input.inboundMessageId,
      conversation_revision: Number(conversation.revision),
      assigned_actor: actor,
      status: "pending",
      attempt_count: 0,
    }, { onConflict: "inbound_message_id", ignoreDuplicates: true });
  }

  return { ok: true, value: {
    conversationId: conversation.id,
    revision: Number(conversation.revision),
    jarvisEnabled: conversation.jarvis_enabled === true,
  }};
}

export async function readJarvisWhatsAppTurnMaterial(input: {
  readonly conversationId: string;
  readonly inboundMessageId: string;
  readonly expectedRevision: number;
}): Promise<ConversationalResult<{
  assignedActor: "AAROHI" | "ANISHA" | "RIYA";
  subjectType: "prospect" | "client" | "vendor";
  tenantId: "quickfurno.marketplace";
  dataClass: "HOSTED_ALLOWED";
  subjectRef?: string;
  receivedAt: string;
  normalizedText?: string;
}>> {
  const [{ data: conversation, error: conversationError }, { data: inbound, error: inboundError }] = await Promise.all([
    adminClient().from("communication_conversations").select("*").eq("id", input.conversationId).maybeSingle(),
    adminClient().from("communication_inbound_messages")
      .select("id,conversation_id,message_type,content_minimized,received_at,identity_confidence,resolved_principal_type,resolved_principal_id")
      .eq("id", input.inboundMessageId)
      .maybeSingle(),
  ]);
  if (conversationError || !conversation) return { ok: false, reason: "conversation_not_found" };
  if (inboundError || !inbound || inbound.conversation_id !== conversation.id) {
    return { ok: false, reason: "inbound_message_mismatch" };
  }
  if (
    conversation.state !== "OPEN" ||
    conversation.jarvis_enabled !== true ||
    conversation.human_takeover === true ||
    Number(conversation.revision) !== input.expectedRevision
  ) return { ok: false, reason: "conversation_not_sendable" };

  const actor = String(conversation.assigned_actor);
  const subjectType = String(conversation.subject_type);
  if (!["AAROHI", "ANISHA", "RIYA"].includes(actor) || !["prospect", "client", "vendor"].includes(subjectType)) {
    return { ok: false, reason: "conversation_not_sendable" };
  }
  const normalizedText = deriveJarvisNormalizedText(
    String(inbound.message_type),
    (inbound.content_minimized ?? {}) as Record<string, unknown>,
  ) ?? undefined;

  const subjectRef = inbound.identity_confidence === "exact" &&
    inbound.resolved_principal_type === subjectType &&
    typeof inbound.resolved_principal_id === "string"
      ? inbound.resolved_principal_id
      : undefined;

  return { ok: true, value: {
    assignedActor: actor as "AAROHI" | "ANISHA" | "RIYA",
    subjectType: subjectType as "prospect" | "client" | "vendor",
    tenantId: "quickfurno.marketplace",
    dataClass: "HOSTED_ALLOWED",
    ...(subjectRef ? { subjectRef } : {}),
    receivedAt: inbound.received_at,
    ...(normalizedText ? { normalizedText } : {}),
  }};
}

type ConversationProposalSource = "JARVIS" | "SYSTEM" | "HUMAN";
type AiConversationActor = "AAROHI" | "ANISHA" | "RIYA";

async function queueConversationExperience(input: {
  readonly source: ConversationProposalSource;
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly proposalId: string;
  readonly idempotencyKey: string;
  readonly experience?: QfWhatsAppExperienceV1;
  readonly legacyBody?: string;
  readonly actor?: AiConversationActor;
}): Promise<ConversationalResult<{ outboxId: string }>> {
  const { data: conversation, error } = await adminClient()
    .from("communication_conversations")
    .select("*")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (error || !conversation) return { ok: false, reason: "conversation_not_found" };
  if (Number(conversation.revision) !== input.expectedRevision) return { ok: false, reason: "stale_revision" };

  if (input.source === "JARVIS") {
    if (
      conversation.state !== "OPEN" ||
      conversation.jarvis_enabled !== true ||
      conversation.human_takeover === true ||
      !["AAROHI", "ANISHA", "RIYA"].includes(String(conversation.assigned_actor))
    ) return { ok: false, reason: "conversation_not_sendable" };
  } else if (!["OPEN", "HUMAN"].includes(String(conversation.state))) {
    return { ok: false, reason: "conversation_not_sendable" };
  }

  const expires = conversation.service_window_expires_at ? Date.parse(conversation.service_window_expires_at) : NaN;
  if (!Number.isFinite(expires) || expires <= Date.now()) return { ok: false, reason: "service_window_closed" };
  if (await activeSuppression(conversation.destination_hash)) return { ok: false, reason: "suppressed" };

  const account = await providerAccount(conversation.provider_account_id);
  if (!account || account.account_role !== "conversational" || account.jarvis_access_mode !== "proposal_only") {
    return { ok: false, reason: "provider_account_not_conversational" };
  }

  let experience: QfWhatsAppExperienceV1;
  if (input.experience !== undefined && input.legacyBody !== undefined) {
    return { ok: false, reason: "conversation_not_sendable" };
  }
  if (input.experience !== undefined) {
    experience = input.experience;
  } else if (input.legacyBody !== undefined && input.source === "JARVIS") {
    const actor = String(conversation.assigned_actor);
    if (!["AAROHI", "ANISHA", "RIYA"].includes(actor)) return { ok: false, reason: "conversation_not_sendable" };
    experience = textExperience(actor as AiConversationActor, input.legacyBody.trim());
  } else {
    return { ok: false, reason: "conversation_not_sendable" };
  }

  if (input.source === "JARVIS") {
    const actor = String(conversation.assigned_actor);
    if (input.actor !== undefined && input.actor !== actor) return { ok: false, reason: "conversation_not_sendable" };
    if (experience.actor !== actor) return { ok: false, reason: "conversation_not_sendable" };
  }

  let serialized: string;
  try { serialized = serializeQfWhatsAppExperience(experience); }
  catch { return { ok: false, reason: "conversation_not_sendable" }; }
  if (serialized.length < 2 || serialized.length > 8_192) return { ok: false, reason: "conversation_not_sendable" };

  const id = randomUUID();
  const digest = bodyDigest(serialized);
  const sealed = sealConversationValue(serialized, bodyAad(id, input.conversationId, input.expectedRevision, digest));
  if (!sealed.ok) return { ok: false, reason: "seal_unavailable" };

  const { data, error: insertError } = await adminClient()
    .from("communication_conversation_outbox")
    .insert({
      id,
      conversation_id: input.conversationId,
      provider_account_id: conversation.provider_account_id,
      proposal_source: input.source,
      proposal_id: input.proposalId,
      expected_revision: input.expectedRevision,
      body_digest: digest,
      sealed_body_ciphertext: sealed.value.ciphertext,
      sealed_body_nonce: sealed.value.nonce,
      sealed_body_auth_tag: sealed.value.authTag,
      encryption_key_id: sealed.value.keyId,
      idempotency_key: input.idempotencyKey,
      status: "pending",
      attempt_count: 0,
    })
    .select("id")
    .single();

  if (insertError) {
    const { data: existing } = await adminClient()
      .from("communication_conversation_outbox")
      .select("id,conversation_id,provider_account_id,proposal_source,proposal_id,expected_revision,body_digest")
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (
      existing?.id &&
      existing.conversation_id === input.conversationId &&
      existing.provider_account_id === conversation.provider_account_id &&
      existing.proposal_source === input.source &&
      existing.proposal_id === input.proposalId &&
      Number(existing.expected_revision) === input.expectedRevision &&
      existing.body_digest === digest
    ) {
      return { ok: true, value: { outboxId: existing.id } };
    }
    return { ok: false, reason: "conversation_not_sendable" };
  }

  await adminClient().from("communication_conversation_events").insert({
    conversation_id: input.conversationId,
    event_type: input.source === "JARVIS" ? "jarvis.reply_queued" : "concierge.experience_queued",
    actor_type: input.source,
    safe_summary: input.source === "JARVIS"
      ? "Jarvis reply proposal accepted into QuickFurno's governed conversational outbox."
      : "QuickFurno Concierge experience accepted into the governed conversational outbox.",
    reference_type: "outbox",
    reference_id: data.id,
    event_data: { expectedRevision: input.expectedRevision, experienceKind: experience.kind },
  });

  return { ok: true, value: { outboxId: data.id } };
}

export async function queueJarvisConversationReply(input: {
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly proposalId: string;
  readonly idempotencyKey: string;
  readonly body?: string;
  readonly actor?: AiConversationActor;
  readonly experience?: QfWhatsAppExperienceV1;
}): Promise<ConversationalResult<{ outboxId: string }>> {
  return queueConversationExperience({
    source: "JARVIS",
    conversationId: input.conversationId,
    expectedRevision: input.expectedRevision,
    proposalId: input.proposalId,
    idempotencyKey: input.idempotencyKey,
    ...(input.body === undefined ? {} : { legacyBody: input.body }),
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.experience === undefined ? {} : { experience: input.experience }),
  });
}

export type JarvisWhatsAppReplyClaimResult =
  | { readonly ok: true; readonly status: "claimed" | "resume"; readonly requestDigest: string }
  | { readonly ok: false; readonly reason: "replay" | "conflict" | "unavailable" };

export async function claimJarvisWhatsAppReplyReceipt(input: {
  readonly requestId: string;
  readonly version: 1 | 2;
  readonly issuedAt: string;
  readonly idempotencyKey: string;
  readonly rawBody: Uint8Array;
}): Promise<JarvisWhatsAppReplyClaimResult> {
  const requestDigest = createHash("sha256").update(input.rawBody).digest("hex");
  const db = adminClient();
  const { error } = await db.from("communication_jarvis_callback_receipts").insert({
    request_id: input.requestId,
    protocol: "qfj.whatsapp.reply",
    request_version: input.version,
    request_digest: requestDigest,
    idempotency_key: input.idempotencyKey,
    outbox_id: null,
    issued_at: input.issuedAt,
    finalized_at: null,
  });
  if (!error) return { ok: true, status: "claimed", requestDigest };
  if (error.code !== "23505") return { ok: false, reason: "unavailable" };

  const { data: prior, error: priorError } = await db
    .from("communication_jarvis_callback_receipts")
    .select("request_version,request_digest,idempotency_key,outbox_id")
    .eq("request_id", input.requestId)
    .maybeSingle();
  if (priorError || !prior) return { ok: false, reason: "unavailable" };
  if (
    Number(prior.request_version) !== input.version ||
    prior.request_digest !== requestDigest ||
    prior.idempotency_key !== input.idempotencyKey
  ) {
    return { ok: false, reason: "conflict" };
  }
  if (prior.outbox_id) return { ok: false, reason: "replay" };
  return { ok: true, status: "resume", requestDigest };
}

export type JarvisWhatsAppReplyFinalizeResult =
  | { readonly ok: true; readonly status: "finalized" }
  | { readonly ok: false; readonly reason: "conflict" | "unavailable" };

export async function finalizeJarvisWhatsAppReplyReceipt(input: {
  readonly requestId: string;
  readonly requestDigest: string;
  readonly idempotencyKey: string;
  readonly outboxId: string;
}): Promise<JarvisWhatsAppReplyFinalizeResult> {
  const db = adminClient();
  const finalizedAt = new Date().toISOString();
  const { data: rows, error } = await db
    .from("communication_jarvis_callback_receipts")
    .update({ outbox_id: input.outboxId, finalized_at: finalizedAt })
    .eq("request_id", input.requestId)
    .eq("request_digest", input.requestDigest)
    .eq("idempotency_key", input.idempotencyKey)
    .is("outbox_id", null)
    .select("outbox_id");
  if (error) return { ok: false, reason: "unavailable" };
  if (Array.isArray(rows) && rows.length === 1 && rows[0]?.outbox_id === input.outboxId) {
    return { ok: true, status: "finalized" };
  }

  const { data: prior, error: priorError } = await db
    .from("communication_jarvis_callback_receipts")
    .select("request_digest,idempotency_key,outbox_id")
    .eq("request_id", input.requestId)
    .maybeSingle();
  if (priorError || !prior) return { ok: false, reason: "unavailable" };
  if (
    prior.request_digest === input.requestDigest &&
    prior.idempotency_key === input.idempotencyKey &&
    prior.outbox_id === input.outboxId
  ) {
    return { ok: true, status: "finalized" };
  }
  return { ok: false, reason: "conflict" };
}

async function queueSystemConversationExperience(input: {
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly inboundMessageId: string;
  readonly experience: QfWhatsAppExperienceV1;
}): Promise<ConversationalResult<{ outboxId: string }>> {
  const serialized = serializeQfWhatsAppExperience(input.experience);
  const idempotencyKey = createHash("sha256")
    .update(["qf.concierge.system.v1", input.inboundMessageId, serialized].join("\n"), "utf8")
    .digest("hex");
  return queueConversationExperience({
    source: "SYSTEM",
    conversationId: input.conversationId,
    expectedRevision: input.expectedRevision,
    proposalId: `concierge:${input.inboundMessageId}`,
    idempotencyKey,
    experience: input.experience,
  });
}

async function failOutbox(id: string, status: "failed" | "cancelled" | "superseded" | "outcome_unknown", code: string) {
  await adminClient().from("communication_conversation_outbox").update({
    status,
    attempt_count: 1,
    failure_code: code,
    failure_reason_sanitized: "Conversational WhatsApp dispatch was refused or could not be proven.",
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("status", "claimed");
}

export async function dispatchConversationalOutbox(
  outboxId: string,
): Promise<ConversationalResult<{ status: string; providerMessageId: string | null }>> {
  const { data: pending, error } = await adminClient()
    .from("communication_conversation_outbox")
    .select("*")
    .eq("id", outboxId)
    .maybeSingle();
  if (error || !pending) return { ok: false, reason: "outbox_not_found" };
  if (pending.status !== "pending") return { ok: false, reason: "outbox_not_dispatchable" };

  const { data: claimedRows, error: claimError } = await adminClient()
    .from("communication_conversation_outbox")
    .update({ status: "claimed", claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", outboxId)
    .eq("status", "pending")
    .select("*");
  if (claimError || !Array.isArray(claimedRows) || claimedRows.length !== 1) {
    return { ok: false, reason: "claim_conflict" };
  }
  const claimed: any = claimedRows[0];

  const { data: conversation } = await adminClient()
    .from("communication_conversations")
    .select("*")
    .eq("id", claimed.conversation_id)
    .maybeSingle();
  const source = String(claimed.proposal_source) as ConversationProposalSource;
  const sourceAllowed = source === "JARVIS"
    ? conversation?.state === "OPEN" && conversation?.human_takeover !== true && conversation?.jarvis_enabled === true
    : !!conversation && ["OPEN", "HUMAN"].includes(String(conversation.state));
  if (!conversation || !["JARVIS", "SYSTEM", "HUMAN"].includes(source) || !sourceAllowed) {
    await failOutbox(claimed.id, "cancelled", "CONVERSATION_NOT_SENDABLE");
    return { ok: false, reason: "conversation_not_sendable" };
  }
  if (Number(conversation.revision) !== Number(claimed.expected_revision)) {
    await failOutbox(claimed.id, "superseded", "STALE_REVISION");
    return { ok: false, reason: "stale_revision" };
  }
  const expires = conversation.service_window_expires_at ? Date.parse(conversation.service_window_expires_at) : NaN;
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    await failOutbox(claimed.id, "cancelled", "SERVICE_WINDOW_CLOSED");
    return { ok: false, reason: "service_window_closed" };
  }
  if (await activeSuppression(conversation.destination_hash)) {
    await failOutbox(claimed.id, "cancelled", "DESTINATION_SUPPRESSED");
    return { ok: false, reason: "suppressed" };
  }

  const account = await providerAccount(conversation.provider_account_id);
  if (!account || account.account_role !== "conversational" || account.jarvis_access_mode !== "proposal_only") {
    await failOutbox(claimed.id, "cancelled", "PROVIDER_ACCOUNT_NOT_CONVERSATIONAL");
    return { ok: false, reason: "provider_account_not_conversational" };
  }

  const config = resolveConversationalMetaConfig();
  if (!config.ok) {
    await failOutbox(claimed.id, "failed", "CONVERSATIONAL_PROVIDER_CONFIG_MISSING");
    return { ok: false, reason: "provider_not_configured" };
  }
  if (
    account.phone_number_reference !== config.config.phoneNumberId ||
    account.business_account_reference !== config.config.wabaId
  ) {
    await failOutbox(claimed.id, "failed", "PROVIDER_ACCOUNT_REFERENCE_MISMATCH");
    return { ok: false, reason: "provider_account_mismatch" };
  }

  const gate = await evaluateMetaOutboundGateForMessage({
    config: { phoneNumberId: config.config.phoneNumberId, wabaId: config.config.wabaId },
    destinationHash: conversation.destination_hash,
  });
  if (!gate.ok) {
    await failOutbox(claimed.id, "failed", "RUNTIME_GATE_BLOCKED");
    return { ok: false, reason: "runtime_gate_blocked" };
  }

  const destination = openConversationValue({
    ciphertext: conversation.sealed_destination_ciphertext,
    nonce: conversation.sealed_destination_nonce,
    authTag: conversation.sealed_destination_auth_tag,
    keyId: conversation.encryption_key_id,
  }, destinationAad(conversation.id, conversation.provider_account_id, conversation.destination_hash));
  if (!destination.ok || hashPhoneE164(destination.value) !== conversation.destination_hash) {
    await failOutbox(claimed.id, "failed", "DESTINATION_SEAL_INVALID");
    return { ok: false, reason: "seal_unavailable" };
  }

  const body = openConversationValue({
    ciphertext: claimed.sealed_body_ciphertext,
    nonce: claimed.sealed_body_nonce,
    authTag: claimed.sealed_body_auth_tag,
    keyId: claimed.encryption_key_id,
  }, bodyAad(claimed.id, claimed.conversation_id, Number(claimed.expected_revision), claimed.body_digest));
  if (!body.ok || bodyDigest(body.value) !== claimed.body_digest) {
    await failOutbox(claimed.id, "failed", "BODY_SEAL_INVALID");
    return { ok: false, reason: "seal_unavailable" };
  }

  let experience = parseSerializedQfWhatsAppExperience(body.value);
  if (!experience && source === "JARVIS") {
    const actor = String(conversation.assigned_actor);
    if (!["AAROHI", "ANISHA", "RIYA"].includes(actor) || body.value.trim().length < 1 || body.value.trim().length > 4096) {
      await failOutbox(claimed.id, "failed", "EXPERIENCE_INVALID");
      return { ok: false, reason: "conversation_not_sendable" };
    }
    experience = textExperience(actor as AiConversationActor, body.value.trim());
  }
  if (!experience) {
    await failOutbox(claimed.id, "failed", "EXPERIENCE_INVALID");
    return { ok: false, reason: "conversation_not_sendable" };
  }
  if (source === "JARVIS" && experience.actor !== String(conversation.assigned_actor)) {
    await failOutbox(claimed.id, "superseded", "ACTOR_MISMATCH");
    return { ok: false, reason: "conversation_not_sendable" };
  }

  const provider = new MetaCloudWhatsAppProvider(outboundToRuntime(config.config), new FetchHttpTransport());
  const interactiveBody = [experience.body, ...(experience.items ?? []).map((item) => "• " + item)].join("\n");
  const canSendInteractive = Boolean(experience.actions?.length) && interactiveBody.length <= 1024;
  const send = canSendInteractive
    ? await provider.sendInteractiveMessage(
        destination.value,
        {
          ...(experience.heading ? { heading: experience.heading } : {}),
          body: interactiveBody,
          actions: experience.actions ?? [],
          menuButtonText: experience.actions && experience.actions.length > 3 ? "View options" : undefined,
        },
        { replyToProviderMessageId: conversation.last_inbound_provider_message_id },
      )
    : await provider.sendTextMessage(
        destination.value,
        renderQfWhatsAppExperienceFallback(experience),
        { replyToProviderMessageId: conversation.last_inbound_provider_message_id },
      );
  const certainty = effectiveProviderOutcomeCertainty(send);
  if (certainty === "unknown_outcome") {
    await failOutbox(claimed.id, "outcome_unknown", send.errorCode ?? "META_OUTCOME_UNKNOWN");
    return { ok: true, value: { status: "outcome_unknown", providerMessageId: send.providerMessageId } };
  }
  if (certainty !== "accepted") {
    await failOutbox(claimed.id, "failed", send.errorCode ?? "META_SEND_FAILED");
    return { ok: true, value: { status: "failed", providerMessageId: send.providerMessageId } };
  }

  const now = new Date().toISOString();
  await adminClient().from("communication_conversation_outbox").update({
    status: "accepted",
    provider_message_id: send.providerMessageId,
    attempt_count: 1,
    completed_at: now,
    updated_at: now,
  }).eq("id", claimed.id).eq("status", "claimed");

  await adminClient().from("communication_conversations").update({
    last_outbound_at: now,
    last_outbound_provider_message_id: send.providerMessageId,
    revision: Number(conversation.revision) + 1,
    updated_at: now,
  }).eq("id", conversation.id).eq("revision", conversation.revision);

  await adminClient().from("communication_conversation_events").insert({
    conversation_id: conversation.id,
    event_type: "whatsapp.reply_accepted",
    actor_type: "SYSTEM",
    safe_summary: "QuickFurno accepted a governed conversational reply for Meta delivery.",
    reference_type: "outbox",
    reference_id: claimed.id,
    event_data: { providerMessageIdPresent: Boolean(send.providerMessageId) },
  });

  return { ok: true, value: { status: "accepted", providerMessageId: send.providerMessageId } };
}

export async function dispatchNextConversationalOutbox(): Promise<{ processed: boolean; status: string }> {
  const { data } = await adminClient()
    .from("communication_conversation_outbox")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);
  const id = Array.isArray(data) && data.length ? data[0]?.id : null;
  if (!id) return { processed: false, status: "idle" };
  const result = await dispatchConversationalOutbox(String(id));
  return { processed: true, status: result.ok ? result.value.status : result.reason };
}
