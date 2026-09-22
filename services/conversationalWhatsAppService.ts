import { createHash, randomUUID } from "crypto";
import { adminClient } from "../lib/supabase";
import { hashPhoneE164, maskPhoneE164, normalizePhoneE164 } from "../lib/communication/phone";
import { openConversationValue, sealConversationValue } from "../lib/communication/conversationSeal";
import { resolveConversationalMetaConfig, outboundToRuntime } from "../lib/communication/providers/metaCloudWhatsAppConfig";
import { MetaCloudWhatsAppProvider, META_WHATSAPP_CLOUD_PROVIDER_KEY } from "../lib/communication/providers/metaCloudWhatsAppProvider";
import { FetchHttpTransport } from "../lib/communication/httpTransport";
import { evaluateMetaOutboundGateForMessage } from "./communicationProviderRuntimeService";
import { authorizeConversationalWhatsAppConsent } from "./outboundConsentEnforcementService";
import { effectiveProviderOutcomeCertainty } from "../lib/communication/providers/providerOutcome";
import { resolveWhatsAppConciergeRouting } from "../lib/communication/whatsAppConciergeRouting";
import {
  classifyQfWhatsAppDataClass,
  deriveQfJarvisSubjectStatus,
  type QfJarvisDataClass,
  type QfJarvisSubjectStatus,
} from "../lib/jarvis/whatsAppAuthorityPolicy";
import {
  parseSerializedQfWhatsAppExperience,
  renderQfWhatsAppExperienceFallback,
  serializeQfWhatsAppExperience,
  humanTextExperience,
  textExperience,
  type QfWhatsAppExperienceV1,
} from "../lib/jarvis/whatsAppExperience";
import {
  deriveQfWhatsAppInboundMaterial,
  type QfWhatsAppInboundMaterialV1,
} from "../lib/jarvis/whatsAppInboundMaterial";

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const CHANNEL = "whatsapp";

type ClosedReason =
  | "provider_account_not_conversational"
  | "conversation_not_found"
  | "conversation_not_sendable"
  | "stale_revision"
  | "service_window_closed"
  | "suppressed"
  | "consent_unavailable"
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
export function conversationOutboxBodyAad(
  id: string,
  conversationId: string,
  expectedRevision: number,
  digest: string,
): string {
  return ["qf.conversation.outbox.body.v1", id, conversationId, String(expectedRevision), digest].join("\n");
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

const SUBJECT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JarvisAuthorityActor = "AAROHI" | "ANISHA" | "RIYA" | "HUMAN" | "SYSTEM";
type JarvisPartyType = "CLIENT" | "VENDOR" | "PROSPECT" | "UNKNOWN";

function partyTypeForSubject(subjectType: string): JarvisPartyType {
  return subjectType === "client" ? "CLIENT"
    : subjectType === "vendor" ? "VENDOR"
      : subjectType === "prospect" ? "PROSPECT"
        : "UNKNOWN";
}

async function readSubjectAuthority(conversation: any): Promise<{
  subjectRef?: string;
  subjectStatus: QfJarvisSubjectStatus;
  aiPaused: boolean;
  humanTakeover: boolean;
  cancelled: boolean;
}> {
  const subjectType = String(conversation.subject_type);
  const subjectRefRaw = subjectType === "prospect"
    ? conversation.aarohi_prospect_id
    : conversation.subject_id;
  const subjectRef = typeof subjectRefRaw === "string" && SUBJECT_UUID.test(subjectRefRaw)
    ? subjectRefRaw
    : undefined;

  let subjectEligible: boolean | undefined;
  let aiPaused = conversation.state === "PAUSED";
  let humanTakeover = conversation.human_takeover === true || conversation.state === "HUMAN";
  let cancelled = conversation.state === "CLOSED";

  if (subjectRef && subjectType === "client") {
    const { data, error } = await adminClient().from("client_accounts")
      .select("id,status").eq("id", subjectRef).maybeSingle();
    subjectEligible = !error && !!data && String(data.status).toLowerCase() === "active";
  } else if (subjectRef && subjectType === "vendor") {
    const { data, error } = await adminClient().from("vendors")
      .select("id,status,is_active").eq("id", subjectRef).maybeSingle();
    const blocked = ["rejected", "disabled", "suspended"].includes(String(data?.status ?? "").toLowerCase());
    subjectEligible = !error && !!data && data.is_active !== false && !blocked;
  } else if (subjectRef && subjectType === "prospect") {
    const { data, error } = await adminClient().from("aarohi_prospects")
      .select("id,prospect_stage,do_not_contact,ai_paused,human_takeover,merged_into_prospect_id")
      .eq("id", subjectRef).eq("tenant_id", String(conversation.tenant_id)).maybeSingle();
    subjectEligible = !error && !!data && !data.merged_into_prospect_id;
    aiPaused = aiPaused || data?.ai_paused === true;
    humanTakeover = humanTakeover || data?.human_takeover === true;
    cancelled = cancelled || data?.do_not_contact === true ||
      String(data?.prospect_stage ?? "").toUpperCase() === "SUPPRESSED" ||
      Boolean(data?.merged_into_prospect_id);
  }

  return {
    ...(subjectRef ? { subjectRef } : {}),
    subjectStatus: deriveQfJarvisSubjectStatus({ subjectRef, subjectEligible }),
    aiPaused,
    humanTakeover,
    cancelled,
  };
}

export async function signalConversationalWhatsAppPresence(input: {
  readonly conversationId: string;
  readonly inboundProviderMessageId: string;
  readonly typing?: boolean;
}): Promise<"sent" | "skipped"> {
  const providerMessageId = input.inboundProviderMessageId?.trim();
  if (!providerMessageId || providerMessageId.length > 512) return "skipped";

  const { data: conversation, error } = await adminClient()
    .from("communication_conversations")
    .select("id,provider_account_id,destination_hash,last_inbound_provider_message_id,state")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (
    error || !conversation ||
    conversation.last_inbound_provider_message_id !== providerMessageId ||
    !["OPEN", "HUMAN"].includes(String(conversation.state))
  ) return "skipped";

  const account = await providerAccount(String(conversation.provider_account_id));
  if (
    !account ||
    account.provider_key !== META_WHATSAPP_CLOUD_PROVIDER_KEY ||
    account.channel !== CHANNEL ||
    account.account_role !== "conversational"
  ) return "skipped";

  const config = resolveConversationalMetaConfig();
  if (!config.ok) return "skipped";
  if (
    account.phone_number_reference !== config.config.phoneNumberId ||
    account.business_account_reference !== config.config.wabaId
  ) return "skipped";

  const gate = await evaluateMetaOutboundGateForMessage({
    config: { phoneNumberId: config.config.phoneNumberId, wabaId: config.config.wabaId },
    destinationHash: String(conversation.destination_hash),
  });
  if (!gate.ok) return "skipped";

  const provider = new MetaCloudWhatsAppProvider(outboundToRuntime(config.config), new FetchHttpTransport());
  const result = input.typing === false
    ? await provider.markInboundRead(providerMessageId)
    : await provider.markInboundReadWithTyping(providerMessageId);
  return effectiveProviderOutcomeCertainty(result) === "accepted" ? "sent" : "skipped";
}

export async function recordConversationalInbound(input: {
  readonly providerAccountId: string;
  readonly inboundMessageId: string;
  readonly senderPhoneE164: string;
  readonly providerMessageId: string;
  readonly occurredAt?: string | null;
  readonly identityConfidence: "exact" | "ambiguous" | "unknown";
  readonly principalType: "client" | "vendor" | "admin" | null;
  readonly principalId: string | null;
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
    currentState: existing?.state,
    currentHumanTakeover: existing?.human_takeover === true,
    isNewConversation: !existing,
  });
  const exactSubjectId = input.identityConfidence === "exact" &&
    input.principalType === routing.subjectType &&
    typeof input.principalId === "string" &&
    SUBJECT_UUID.test(input.principalId)
      ? input.principalId
      : null;
  const preservedSubjectId = existing?.subject_type === routing.subjectType &&
    typeof existing?.subject_id === "string" &&
    SUBJECT_UUID.test(existing.subject_id)
      ? existing.subject_id
      : null;
  const subjectId = exactSubjectId ?? preservedSubjectId;
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
        subject_id: subjectId,
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
        subject_id: subjectId,
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

export interface JarvisWhatsAppAuthorityState {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly revision: number;
  readonly assignedActor: JarvisAuthorityActor;
  readonly subjectType: "unknown" | "prospect" | "client" | "vendor";
  readonly partyType: JarvisPartyType;
  readonly conversationState: "OPEN" | "PAUSED" | "HUMAN" | "CLOSED";
  readonly jarvisAllowed: boolean;
  readonly dataClass: QfJarvisDataClass;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
  readonly cancelled: boolean;
  readonly subjectStatus: QfJarvisSubjectStatus;
  readonly subjectRef?: string;
  readonly observedAt: string;
}

export async function readJarvisWhatsAppAuthorityState(input: {
  readonly tenantId: string;
  readonly conversationId: string;
}): Promise<ConversationalResult<JarvisWhatsAppAuthorityState>> {
  const { data: conversation, error } = await adminClient()
    .from("communication_conversations")
    .select("*")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (error || !conversation || String(conversation.tenant_id) !== input.tenantId) {
    return { ok: false, reason: "conversation_not_found" };
  }

  let messageType: string | null = null;
  if (typeof conversation.last_inbound_provider_message_id === "string") {
    const { data: currentInbound, error: inboundError } = await adminClient()
      .from("communication_inbound_messages")
      .select("message_type")
      .eq("conversation_id", conversation.id)
      .eq("provider_message_id", conversation.last_inbound_provider_message_id)
      .maybeSingle();
    if (inboundError) return { ok: false, reason: "inbound_message_mismatch" };
    messageType = typeof currentInbound?.message_type === "string" ? currentInbound.message_type : null;
  }

  const actor = String(conversation.assigned_actor) as JarvisAuthorityActor;
  const subjectType = String(conversation.subject_type) as JarvisWhatsAppAuthorityState["subjectType"];
  const subject = await readSubjectAuthority(conversation);
  const conversationState = String(conversation.state) as JarvisWhatsAppAuthorityState["conversationState"];
  const jarvisAllowed = conversationState === "OPEN" &&
    conversation.jarvis_enabled === true &&
    subject.humanTakeover !== true &&
    subject.aiPaused !== true &&
    subject.cancelled !== true;

  return { ok: true, value: {
    tenantId: String(conversation.tenant_id),
    conversationId: String(conversation.id),
    revision: Number(conversation.revision),
    assignedActor: actor,
    subjectType,
    partyType: partyTypeForSubject(subjectType),
    conversationState,
    jarvisAllowed,
    dataClass: classifyQfWhatsAppDataClass(messageType),
    humanTakeover: subject.humanTakeover,
    aiPaused: subject.aiPaused,
    cancelled: subject.cancelled,
    subjectStatus: subject.subjectStatus,
    ...(subject.subjectRef ? { subjectRef: subject.subjectRef } : {}),
    observedAt: String(conversation.updated_at),
  }};
}

export async function readJarvisWhatsAppTurnMaterial(input: {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly inboundMessageId: string;
  readonly expectedRevision: number;
}): Promise<ConversationalResult<JarvisWhatsAppAuthorityState & {
  readonly inboundMessageId: string;
  readonly receivedAt: string;
  readonly inbound: QfWhatsAppInboundMaterialV1;
  readonly normalizedText?: string;
}>> {
  const authority = await readJarvisWhatsAppAuthorityState({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  });
  if (!authority.ok) return authority;
  if (authority.value.revision !== input.expectedRevision) {
    return { ok: false, reason: "stale_revision" };
  }

  const [{ data: conversation }, { data: inbound, error: inboundError }, { data: turn, error: turnError }] = await Promise.all([
    adminClient().from("communication_conversations")
      .select("last_inbound_provider_message_id").eq("id", input.conversationId).maybeSingle(),
    adminClient().from("communication_inbound_messages")
      .select("id,conversation_id,provider_message_id,message_type,content_minimized,received_at")
      .eq("id", input.inboundMessageId).maybeSingle(),
    adminClient().from("communication_jarvis_turn_outbox")
      .select("conversation_id,inbound_message_id,conversation_revision,assigned_actor")
      .eq("inbound_message_id", input.inboundMessageId).maybeSingle(),
  ]);
  if (
    inboundError || turnError || !conversation || !inbound || !turn ||
    inbound.conversation_id !== input.conversationId ||
    inbound.provider_message_id !== conversation.last_inbound_provider_message_id ||
    turn.conversation_id !== input.conversationId ||
    turn.inbound_message_id !== input.inboundMessageId ||
    Number(turn.conversation_revision) !== input.expectedRevision
  ) return { ok: false, reason: "inbound_message_mismatch" };

  const inboundMaterial = deriveQfWhatsAppInboundMaterial({
    messageType: inbound.message_type,
    contentMinimized: (inbound.content_minimized ?? {}) as Record<string, unknown>,
  });
  const normalizedText = inboundMaterial.normalizedText;

  return { ok: true, value: {
    ...authority.value,
    inboundMessageId: input.inboundMessageId,
    receivedAt: String(inbound.received_at),
    inbound: inboundMaterial,
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
  const consent = await authorizeConversationalWhatsAppConsent({
    destinationHash: String(conversation.destination_hash),
    subjectType: ["prospect", "client", "vendor"].includes(String(conversation.subject_type))
      ? String(conversation.subject_type) as "prospect" | "client" | "vendor"
      : "unknown",
    subjectId: typeof conversation.subject_id === "string" ? conversation.subject_id : null,
  });
  if (consent.kind === "deny") return { ok: false, reason: "suppressed" };
  if (consent.kind !== "allow") return { ok: false, reason: "consent_unavailable" };

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
  if (input.source === "HUMAN" && experience.actor !== "HUMAN") {
    return { ok: false, reason: "conversation_not_sendable" };
  }

  let serialized: string;
  try { serialized = serializeQfWhatsAppExperience(experience); }
  catch { return { ok: false, reason: "conversation_not_sendable" }; }
  if (serialized.length < 2 || serialized.length > 8_192) return { ok: false, reason: "conversation_not_sendable" };

  const id = randomUUID();
  const digest = bodyDigest(serialized);
  const sealed = sealConversationValue(serialized, conversationOutboxBodyAad(id, input.conversationId, input.expectedRevision, digest));
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

const HUMAN_OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function queueHumanConversationReply(input: {
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly operationId: string;
  readonly operatorUserId: string;
  readonly body: string;
}): Promise<ConversationalResult<{ outboxId: string }>> {
  const body = input.body.trim();
  if (
    !HUMAN_OPERATION_ID.test(input.operationId) ||
    !HUMAN_OPERATION_ID.test(input.operatorUserId) ||
    body.length < 1 ||
    body.length > 3072
  ) return { ok: false, reason: "conversation_not_sendable" };

  const { data: conversation, error } = await adminClient()
    .from("communication_conversations")
    .select("id,state,human_takeover,assigned_actor,revision")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (
    error || !conversation ||
    conversation.state !== "HUMAN" ||
    conversation.human_takeover !== true ||
    conversation.assigned_actor !== "HUMAN" ||
    Number(conversation.revision) !== input.expectedRevision
  ) return { ok: false, reason: "conversation_not_sendable" };

  const idempotencyKey = createHash("sha256").update([
    "qf.whatsapp.human.reply.v1",
    input.conversationId,
    String(input.expectedRevision),
    input.operationId,
    input.operatorUserId,
    body,
  ].join("\n"), "utf8").digest("hex");

  const queued = await queueConversationExperience({
    source: "HUMAN",
    conversationId: input.conversationId,
    expectedRevision: input.expectedRevision,
    proposalId: `human:${input.operationId}`,
    idempotencyKey,
    experience: humanTextExperience(body),
  });
  if (!queued.ok) return queued;

  await adminClient().from("communication_conversation_events").insert({
    conversation_id: input.conversationId,
    event_type: "human.reply_queued",
    actor_type: "HUMAN",
    safe_summary: "A QuickFurno operator queued a human WhatsApp reply through the governed conversation outbox.",
    reference_type: "outbox",
    reference_id: queued.value.outboxId,
    event_data: { operatorUserId: input.operatorUserId },
  });
  return queued;
}

function actorForSubject(subjectType: string): AiConversationActor | null {
  return subjectType === "client" ? "RIYA"
    : subjectType === "vendor" ? "ANISHA"
      : subjectType === "prospect" ? "AAROHI"
        : null;
}

export async function releaseHumanConversationToAi(input: {
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly operatorUserId: string;
}): Promise<ConversationalResult<{ actor: AiConversationActor; revision: number }>> {
  if (!HUMAN_OPERATION_ID.test(input.operatorUserId)) {
    return { ok: false, reason: "conversation_not_sendable" };
  }
  const { data: conversation, error } = await adminClient()
    .from("communication_conversations")
    .select("id,provider_account_id,subject_type,assigned_actor,state,human_takeover,revision")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (
    error || !conversation ||
    conversation.state !== "HUMAN" ||
    conversation.human_takeover !== true ||
    conversation.assigned_actor !== "HUMAN" ||
    Number(conversation.revision) !== input.expectedRevision
  ) return { ok: false, reason: "conversation_not_sendable" };

  const actor = actorForSubject(String(conversation.subject_type));
  if (!actor) return { ok: false, reason: "conversation_not_sendable" };
  const account = await providerAccount(String(conversation.provider_account_id));
  if (!account || account.account_role !== "conversational" || account.jarvis_access_mode !== "proposal_only") {
    return { ok: false, reason: "provider_account_not_conversational" };
  }

  const revision = input.expectedRevision + 1;
  const { data: updated, error: updateError } = await adminClient()
    .from("communication_conversations")
    .update({
      assigned_actor: actor,
      state: "OPEN",
      human_takeover: false,
      jarvis_enabled: true,
      revision,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.conversationId)
    .eq("revision", input.expectedRevision)
    .eq("state", "HUMAN")
    .eq("human_takeover", true)
    .select("id");
  if (updateError || !Array.isArray(updated) || updated.length !== 1) {
    return { ok: false, reason: "stale_revision" };
  }

  await adminClient().from("communication_conversation_outbox").update({
    status: "superseded",
    failure_code: "HUMAN_RELEASE_REVISION_ADVANCED",
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("conversation_id", input.conversationId).eq("proposal_source", "JARVIS").eq("status", "pending");

  await adminClient().from("communication_conversation_events").insert({
    conversation_id: input.conversationId,
    event_type: "human.takeover_released",
    actor_type: "HUMAN",
    safe_summary: "A QuickFurno operator released human takeover. Future inbound turns may return to the trusted specialist actor.",
    event_data: { operatorUserId: input.operatorUserId, nextActor: actor, revision },
  });
  return { ok: true, value: { actor, revision } };
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
  const consent = await authorizeConversationalWhatsAppConsent({
    destinationHash: String(conversation.destination_hash),
    subjectType: ["prospect", "client", "vendor"].includes(String(conversation.subject_type))
      ? String(conversation.subject_type) as "prospect" | "client" | "vendor"
      : "unknown",
    subjectId: typeof conversation.subject_id === "string" ? conversation.subject_id : null,
  });
  if (consent.kind === "deny") {
    await failOutbox(claimed.id, "cancelled", "CONSENT_SUPPRESSED");
    return { ok: false, reason: "suppressed" };
  }
  if (consent.kind !== "allow") {
    await failOutbox(claimed.id, "failed", "CONSENT_AUTHORITY_UNAVAILABLE");
    return { ok: false, reason: "consent_unavailable" };
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
  }, conversationOutboxBodyAad(claimed.id, claimed.conversation_id, Number(claimed.expected_revision), claimed.body_digest));
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

  if (source === "SYSTEM" && typeof conversation.last_inbound_provider_message_id === "string") {
    try {
      await signalConversationalWhatsAppPresence({
        conversationId: conversation.id,
        inboundProviderMessageId: conversation.last_inbound_provider_message_id,
        typing: true,
      });
    } catch {
      /* presence is best-effort and can never change outbox delivery authority */
    }
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
