import { randomUUID } from "crypto";
import { adminClient } from "../lib/supabase";
import { deriveJarvisNormalizedText } from "../lib/communication/providers/metaWhatsAppInbound";
import { signalConversationalWhatsAppPresence } from "./conversationalWhatsAppService";
import { resolveJarvisSigningPrivateKey } from "../lib/jarvis/signingPrivateKeySource";
import { resolvePortableServiceBaseUrl } from "../lib/runtime/serviceDiscovery";
import { postJarvisScale } from "./jarvisScaleTransport";
import {
  QFJ_WHATSAPP_TURN_KEY_ID_HEADER,
  QFJ_WHATSAPP_TURN_PATH,
  QFJ_WHATSAPP_TURN_SIGNATURE_HEADER,
  buildQfjWhatsAppTurn,
  signQfjWhatsAppTurn,
  type QfjWhatsAppTurnV1,
} from "../lib/jarvis/whatsAppTurnContract";

export type JarvisWhatsAppGatewayResult =
  | { readonly ok: true; readonly status: "accepted" }
  | {
      readonly ok: false;
      readonly reason:
        "disabled" | "config_missing" | "unavailable" | "refused";
    };

function qualificationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.QF_JARVIS_RIYA_QUALIFICATION_ENABLED?.trim().toLowerCase() === "true"
  );
}
function conversationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.QF_JARVIS_WHATSAPP_ENABLED?.trim().toLowerCase() === "true";
}
function turnEnabled(
  purpose: QfjWhatsAppTurnV1["turnPurpose"],
  env: NodeJS.ProcessEnv,
): boolean {
  return purpose === "lead_qualification"
    ? qualificationEnabled(env)
    : conversationEnabled(env);
}
function canonicalInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function gatewayConfig(env: NodeJS.ProcessEnv = process.env) {
  const baseUrl = resolvePortableServiceBaseUrl(env.QF_JARVIS_BASE_URL, {
    allowLoopbackHttp: true,
  });
  const keyId = env.QF_JARVIS_SIGNING_KEY_ID?.trim();
  const privateKeyPem = resolveJarvisSigningPrivateKey(env);
  if (!baseUrl || !keyId || !privateKeyPem) return null;
  return { baseUrl, keyId, privateKeyPem };
}

export async function sendJarvisWhatsAppTurn(
  input: Omit<
    QfjWhatsAppTurnV1,
    "protocol" | "version" | "caller" | "audience"
  >,
  env: NodeJS.ProcessEnv = process.env,
): Promise<JarvisWhatsAppGatewayResult> {
  if (!turnEnabled(input.turnPurpose ?? "conversation", env))
    return { ok: false, reason: "disabled" };
  const cfg = gatewayConfig(env);
  if (!cfg) return { ok: false, reason: "config_missing" };
  const turn = buildQfjWhatsAppTurn(input);
  const body = JSON.stringify(turn);
  const raw = Buffer.from(body, "utf8");
  let signature: string;
  try {
    signature = signQfjWhatsAppTurn(
      raw,
      turn.requestId,
      turn.issuedAt,
      cfg.keyId,
      cfg.privateKeyPem,
    );
  } catch {
    return { ok: false, reason: "config_missing" };
  }
  const result = await postJarvisScale({
    url: new URL(QFJ_WHATSAPP_TURN_PATH, cfg.baseUrl).toString(),
    path: QFJ_WHATSAPP_TURN_PATH,
    body,
    keyId: cfg.keyId,
    privateKeyPem: cfg.privateKeyPem,
    actor: turn.assignedActor,
    requestId: turn.requestId,
    idempotencyKey: turn.inboundMessageId,
    expectedRevision: turn.conversationRevision,
    headers: {
      "content-type": "application/json",
      [QFJ_WHATSAPP_TURN_KEY_ID_HEADER]: cfg.keyId,
      [QFJ_WHATSAPP_TURN_SIGNATURE_HEADER]: signature,
    },
  });
  if (!result.ok) return { ok: false, reason: "unavailable" };
  const response = result.response;
  if (response.status === 202 || response.status === 200)
    return { ok: true, status: "accepted" };
  if (response.status >= 400 && response.status < 500)
    return { ok: false, reason: "refused" };
  return { ok: false, reason: "unavailable" };
}

export async function dispatchNextJarvisWhatsAppTurn(): Promise<{
  processed: boolean;
  status: string;
}> {
  const genericOn = conversationEnabled();
  const qualificationOn = qualificationEnabled();
  if (!genericOn && !qualificationOn) {
    return { processed: false, status: "disabled" };
  }
  const now = new Date().toISOString();
  const { data: claimedRows, error: claimError } = await adminClient().rpc(
    "qf_claim_jarvis_turn_outbox_v1",
    {
      p_allow_conversation: genericOn,
      p_allow_qualification: qualificationOn,
    },
  );
  if (claimError) throw claimError;
  const claimed: any =
    Array.isArray(claimedRows) && claimedRows.length ? claimedRows[0] : null;
  if (!claimed) return { processed: false, status: "idle" };

  const [{ data: conversation }, { data: inbound }] = await Promise.all([
    adminClient()
      .from("communication_conversations")
      .select("*")
      .eq("id", claimed.conversation_id)
      .maybeSingle(),
    adminClient()
      .from("communication_inbound_messages")
      .select(
        "id,provider_message_id,message_type,content_minimized,received_at",
      )
      .eq("id", claimed.inbound_message_id)
      .maybeSingle(),
  ]);

  const qualificationTurn = claimed.turn_purpose === "lead_qualification";
  const laneValid = qualificationTurn
    ? qualificationOn &&
      claimed.assigned_actor === "RIYA" &&
      typeof claimed.qualification_request_id === "string"
    : genericOn && conversation?.jarvis_enabled === true;
  if (
    !conversation ||
    !inbound ||
    conversation.state !== "OPEN" ||
    conversation.human_takeover === true ||
    !laneValid ||
    Number(conversation.revision) !== Number(claimed.conversation_revision)
  ) {
    await adminClient()
      .from("communication_jarvis_turn_outbox")
      .update({
        status: "cancelled",
        last_safe_code: "TURN_STALE_OR_NOT_SENDABLE",
        completed_at: now,
        updated_at: now,
      })
      .eq("id", claimed.id)
      .eq("status", "claimed");
    return { processed: true, status: "cancelled" };
  }

  const text =
    deriveJarvisNormalizedText(
      String(inbound.message_type),
      (inbound.content_minimized ?? {}) as Record<string, unknown>,
    ) ?? undefined;
  if (
    Number(claimed.attempt_count ?? 0) === 0 &&
    typeof inbound.provider_message_id === "string"
  ) {
    try {
      await signalConversationalWhatsAppPresence({
        conversationId: conversation.id,
        inboundProviderMessageId: inbound.provider_message_id,
        typing: true,
      });
    } catch {
      /* presence is best-effort; it never controls whether an AI turn may execute */
    }
  }

  const receivedAt = canonicalInstant(inbound.received_at);
  if (!receivedAt) {
    const failedAt = new Date().toISOString();
    await adminClient()
      .from("communication_jarvis_turn_outbox")
      .update({
        status: "failed",
        attempt_count: Number(claimed.attempt_count ?? 0) + 1,
        next_retry_at: null,
        last_safe_code: "TURN_INBOUND_TIME_INVALID",
        completed_at: failedAt,
        updated_at: failedAt,
      })
      .eq("id", claimed.id)
      .eq("status", "claimed");
    return { processed: true, status: "failed" };
  }

  const result = await sendJarvisWhatsAppTurn({
    requestId: randomUUID(),
    issuedAt: new Date().toISOString(),
    conversationId: conversation.id,
    conversationRevision: Number(conversation.revision),
    inboundMessageId: inbound.id,
    receivedAt,
    assignedActor: claimed.assigned_actor,
    subjectType: conversation.subject_type,
    turnPurpose: qualificationTurn ? "lead_qualification" : "conversation",
    ...(qualificationTurn
      ? { qualificationRequestId: String(claimed.qualification_request_id) }
      : {}),
    ...(text ? { normalizedText: text } : {}),
  });

  if (result.ok) {
    const completedAt = new Date().toISOString();
    await adminClient()
      .from("communication_jarvis_turn_outbox")
      .update({
        status: "accepted",
        attempt_count: Number(claimed.attempt_count ?? 0) + 1,
        last_safe_code: "JARVIS_TURN_ACCEPTED",
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", claimed.id)
      .eq("status", "claimed");
    await adminClient()
      .from("communication_conversation_events")
      .insert({
        conversation_id: conversation.id,
        event_type: "jarvis.turn_accepted",
        actor_type: "SYSTEM",
        safe_summary:
          "QuickFurno delivered a normalized WhatsApp turn to the separate Jarvis service.",
        reference_type: "inbound_message",
        reference_id: inbound.id,
        event_data: { actor: claimed.assigned_actor },
      });
    return { processed: true, status: "accepted" };
  }

  const attempt = Number(claimed.attempt_count ?? 0) + 1;
  const retryable = result.reason === "unavailable" && attempt < 5;
  const delayMs = Math.min(
    120_000,
    5_000 * Math.pow(2, Math.max(0, attempt - 1)),
  );
  await adminClient()
    .from("communication_jarvis_turn_outbox")
    .update({
      status: retryable ? "retry_scheduled" : "failed",
      attempt_count: attempt,
      next_retry_at: retryable
        ? new Date(Date.now() + delayMs).toISOString()
        : null,
      last_safe_code: `JARVIS_TURN_${result.reason.toUpperCase()}`,
      completed_at: retryable ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", claimed.id)
    .eq("status", "claimed");

  return { processed: true, status: retryable ? "retry_scheduled" : "failed" };
}
