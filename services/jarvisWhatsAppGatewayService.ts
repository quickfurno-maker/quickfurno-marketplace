import { randomUUID } from "crypto";
import { adminClient } from "../lib/supabase";
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
  | { readonly ok: false; readonly reason: "disabled" | "config_missing" | "unavailable" | "refused" };

function gatewayConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.QF_JARVIS_WHATSAPP_ENABLED?.trim().toLowerCase() !== "true") return null;
  const baseUrl = env.QF_JARVIS_BASE_URL?.trim();
  const keyId = env.QF_JARVIS_SIGNING_KEY_ID?.trim();
  const privateKeyPem = env.QF_JARVIS_SIGNING_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n").trim();
  if (!baseUrl || !keyId || !privateKeyPem) return null;
  try {
    const url = new URL(baseUrl);
    const loopback = ["127.0.0.1","localhost","::1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return { baseUrl: url.toString(), keyId, privateKeyPem };
  } catch { return null; }
}

export async function sendJarvisWhatsAppTurn(
  input: Omit<QfjWhatsAppTurnV1,"protocol"|"version"|"caller"|"audience">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<JarvisWhatsAppGatewayResult> {
  if (env.QF_JARVIS_WHATSAPP_ENABLED?.trim().toLowerCase() !== "true") return { ok: false, reason: "disabled" };
  const cfg = gatewayConfig(env);
  if (!cfg) return { ok: false, reason: "config_missing" };
  const turn = buildQfjWhatsAppTurn(input);
  const body = JSON.stringify(turn);
  const raw = Buffer.from(body, "utf8");
  let signature: string;
  try { signature = signQfjWhatsAppTurn(raw, turn.requestId, turn.issuedAt, cfg.keyId, cfg.privateKeyPem); }
  catch { return { ok: false, reason: "config_missing" }; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(new URL(QFJ_WHATSAPP_TURN_PATH, cfg.baseUrl), {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        [QFJ_WHATSAPP_TURN_KEY_ID_HEADER]: cfg.keyId,
        [QFJ_WHATSAPP_TURN_SIGNATURE_HEADER]: signature,
      },
      body,
    });
    if (response.status === 202 || response.status === 200) return { ok: true, status: "accepted" };
    if (response.status >= 400 && response.status < 500) return { ok: false, reason: "refused" };
    return { ok: false, reason: "unavailable" };
  } catch { return { ok: false, reason: "unavailable" }; }
  finally { clearTimeout(timer); }
}

export async function dispatchNextJarvisWhatsAppTurn(): Promise<{ processed: boolean; status: string }> {
  if (process.env.QF_JARVIS_WHATSAPP_ENABLED?.trim().toLowerCase() !== "true") {
    return { processed: false, status: "disabled" };
  }
  const now = new Date().toISOString();
  const { data: rows } = await adminClient()
    .from("communication_jarvis_turn_outbox")
    .select("id")
    .in("status", ["pending", "retry_scheduled"])
    .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(1);
  const id = Array.isArray(rows) && rows.length ? rows[0]?.id : null;
  if (!id) return { processed: false, status: "idle" };

  const { data: claimedRows } = await adminClient()
    .from("communication_jarvis_turn_outbox")
    .update({ status: "claimed", claimed_at: now, updated_at: now })
    .eq("id", id)
    .in("status", ["pending", "retry_scheduled"])
    .select("*");
  if (!Array.isArray(claimedRows) || claimedRows.length !== 1) {
    return { processed: true, status: "claim_conflict" };
  }
  const claimed: any = claimedRows[0];

  const [{ data: conversation }, { data: inbound }] = await Promise.all([
    adminClient().from("communication_conversations").select("*").eq("id", claimed.conversation_id).maybeSingle(),
    adminClient().from("communication_inbound_messages")
      .select("id,message_type,content_minimized,received_at")
      .eq("id", claimed.inbound_message_id)
      .maybeSingle(),
  ]);

  if (
    !conversation || !inbound ||
    conversation.state !== "OPEN" ||
    conversation.human_takeover === true ||
    conversation.jarvis_enabled !== true ||
    Number(conversation.revision) !== Number(claimed.conversation_revision)
  ) {
    await adminClient().from("communication_jarvis_turn_outbox").update({
      status: "cancelled", last_safe_code: "TURN_STALE_OR_NOT_SENDABLE", completed_at: now, updated_at: now,
    }).eq("id", claimed.id).eq("status", "claimed");
    return { processed: true, status: "cancelled" };
  }

  const text = inbound.message_type === "text" && typeof inbound.content_minimized?.text === "string"
    ? inbound.content_minimized.text.slice(0, 4096)
    : ["button_reply", "list_reply"].includes(String(inbound.message_type)) && typeof inbound.content_minimized?.title === "string"
      ? inbound.content_minimized.title.slice(0, 4096)
      : undefined;
  const result = await sendJarvisWhatsAppTurn({
    requestId: randomUUID(),
    issuedAt: new Date().toISOString(),
    conversationId: conversation.id,
    conversationRevision: Number(conversation.revision),
    inboundMessageId: inbound.id,
    receivedAt: inbound.received_at,
    assignedActor: claimed.assigned_actor,
    subjectType: conversation.subject_type,
    ...(text ? { normalizedText: text } : {}),
  });

  if (result.ok) {
    const completedAt = new Date().toISOString();
    await adminClient().from("communication_jarvis_turn_outbox").update({
      status: "accepted",
      attempt_count: Number(claimed.attempt_count ?? 0) + 1,
      last_safe_code: "JARVIS_TURN_ACCEPTED",
      completed_at: completedAt,
      updated_at: completedAt,
    }).eq("id", claimed.id).eq("status", "claimed");
    await adminClient().from("communication_conversation_events").insert({
      conversation_id: conversation.id,
      event_type: "jarvis.turn_accepted",
      actor_type: "SYSTEM",
      safe_summary: "QuickFurno delivered a normalized WhatsApp turn to the separate Jarvis service.",
      reference_type: "inbound_message",
      reference_id: inbound.id,
      event_data: { actor: claimed.assigned_actor },
    });
    return { processed: true, status: "accepted" };
  }

  const attempt = Number(claimed.attempt_count ?? 0) + 1;
  const retryable = result.reason === "unavailable" && attempt < 5;
  const delayMs = Math.min(120_000, 5_000 * Math.pow(2, Math.max(0, attempt - 1)));
  await adminClient().from("communication_jarvis_turn_outbox").update({
    status: retryable ? "retry_scheduled" : "failed",
    attempt_count: attempt,
    next_retry_at: retryable ? new Date(Date.now() + delayMs).toISOString() : null,
    last_safe_code: `JARVIS_TURN_${result.reason.toUpperCase()}`,
    completed_at: retryable ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", claimed.id).eq("status", "claimed");

  return { processed: true, status: retryable ? "retry_scheduled" : "failed" };
}
