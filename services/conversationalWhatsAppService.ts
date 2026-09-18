import { createHash, randomUUID } from "crypto";
import { adminClient } from "../lib/supabase";
import { hashPhoneE164, maskPhoneE164, normalizePhoneE164 } from "../lib/communication/phone";
import { openConversationValue, sealConversationValue } from "../lib/communication/conversationSeal";
import { resolveConversationalMetaConfig, outboundToRuntime } from "../lib/communication/providers/metaCloudWhatsAppConfig";
import { MetaCloudWhatsAppProvider, META_WHATSAPP_CLOUD_PROVIDER_KEY } from "../lib/communication/providers/metaCloudWhatsAppProvider";
import { FetchHttpTransport } from "../lib/communication/httpTransport";
import { evaluateMetaOutboundGateForMessage } from "./communicationProviderRuntimeService";
import { effectiveProviderOutcomeCertainty } from "../lib/communication/providers/providerOutcome";

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
        subject_type: "unknown",
        assigned_actor: "AAROHI",
        state: "OPEN",
        jarvis_enabled: account.jarvis_access_mode === "proposal_only",
        human_takeover: false,
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

  const actor = String(conversation.assigned_actor);
  if (
    input.suppressJarvisTurn !== true &&
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

export async function queueJarvisConversationReply(input: {
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly proposalId: string;
  readonly body: string;
  readonly idempotencyKey: string;
}): Promise<ConversationalResult<{ outboxId: string }>> {
  const { data: conversation, error } = await adminClient()
    .from("communication_conversations")
    .select("*")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (error || !conversation) return { ok: false, reason: "conversation_not_found" };
  if (
    conversation.state !== "OPEN" ||
    conversation.jarvis_enabled !== true ||
    conversation.human_takeover === true
  ) return { ok: false, reason: "conversation_not_sendable" };
  if (Number(conversation.revision) !== input.expectedRevision) return { ok: false, reason: "stale_revision" };

  const expires = conversation.service_window_expires_at ? Date.parse(conversation.service_window_expires_at) : NaN;
  if (!Number.isFinite(expires) || expires <= Date.now()) return { ok: false, reason: "service_window_closed" };
  if (await activeSuppression(conversation.destination_hash)) return { ok: false, reason: "suppressed" };

  const account = await providerAccount(conversation.provider_account_id);
  if (!account || account.account_role !== "conversational" || account.jarvis_access_mode !== "proposal_only") {
    return { ok: false, reason: "provider_account_not_conversational" };
  }

  const body = input.body.trim();
  if (body.length < 1 || body.length > 4096) return { ok: false, reason: "conversation_not_sendable" };
  const id = randomUUID();
  const digest = bodyDigest(body);
  const sealed = sealConversationValue(body, bodyAad(id, input.conversationId, input.expectedRevision, digest));
  if (!sealed.ok) return { ok: false, reason: "seal_unavailable" };

  const { data, error: insertError } = await adminClient()
    .from("communication_conversation_outbox")
    .insert({
      id,
      conversation_id: input.conversationId,
      provider_account_id: conversation.provider_account_id,
      proposal_source: "JARVIS",
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
      .select("id")
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existing?.id) return { ok: true, value: { outboxId: existing.id } };
    return { ok: false, reason: "conversation_not_sendable" };
  }

  await adminClient().from("communication_conversation_events").insert({
    conversation_id: input.conversationId,
    event_type: "jarvis.reply_queued",
    actor_type: "JARVIS",
    safe_summary: "Jarvis reply proposal accepted into QuickFurno's governed conversational outbox.",
    reference_type: "outbox",
    reference_id: data.id,
    event_data: { expectedRevision: input.expectedRevision },
  });

  return { ok: true, value: { outboxId: data.id } };
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
  if (!conversation || conversation.state !== "OPEN" || conversation.human_takeover || !conversation.jarvis_enabled) {
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

  const provider = new MetaCloudWhatsAppProvider(outboundToRuntime(config.config), new FetchHttpTransport());
  const send = await provider.sendTextMessage(
    destination.value,
    body.value,
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
