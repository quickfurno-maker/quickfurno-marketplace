import "server-only";

import { adminClient } from "../lib/supabase";
import { openConversationValue } from "../lib/communication/conversationSeal";
import {
  parseSerializedQfWhatsAppExperience,
  renderQfWhatsAppExperienceFallback,
} from "../lib/jarvis/whatsAppExperience";
import { conversationOutboxBodyAad } from "./conversationalWhatsAppService";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_QUEUE = 50;
const MAX_THREAD = 60;

export interface HumanDeskConversation {
  readonly id: string;
  readonly destinationMasked: string;
  readonly subjectType: "unknown" | "prospect" | "client" | "vendor";
  readonly revision: number;
  readonly lastInboundAt: string | null;
  readonly serviceWindowExpiresAt: string | null;
  readonly updatedAt: string;
  readonly canFreeformReply: boolean;
}

export interface HumanDeskThreadEvent {
  readonly id: string;
  readonly direction: "inbound" | "outbound";
  readonly occurredAt: string;
  readonly actor: string;
  readonly status: string;
  readonly body: string;
}

export interface HumanDeskThread {
  readonly conversation: HumanDeskConversation;
  readonly events: readonly HumanDeskThreadEvent[];
}

function serviceWindowOpen(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
}

export async function listHumanDeskConversations(): Promise<readonly HumanDeskConversation[]> {
  const { data, error } = await adminClient()
    .from("communication_conversations")
    .select("id,destination_masked,subject_type,revision,last_inbound_at,service_window_expires_at,updated_at")
    .eq("state", "HUMAN")
    .eq("human_takeover", true)
    .order("updated_at", { ascending: false })
    .limit(MAX_QUEUE);
  if (error) throw error;
  return Object.freeze(((data ?? []) as Record<string, unknown>[]).map((row) => Object.freeze({
    id: String(row.id),
    destinationMasked: String(row.destination_masked ?? "—"),
    subjectType: ["prospect", "client", "vendor"].includes(String(row.subject_type))
      ? String(row.subject_type) as "prospect" | "client" | "vendor"
      : "unknown",
    revision: Number(row.revision ?? 0),
    lastInboundAt: typeof row.last_inbound_at === "string" ? row.last_inbound_at : null,
    serviceWindowExpiresAt: typeof row.service_window_expires_at === "string" ? row.service_window_expires_at : null,
    updatedAt: String(row.updated_at ?? ""),
    canFreeformReply: serviceWindowOpen(row.service_window_expires_at),
  })));
}

function inboundBody(messageType: string, content: unknown): string {
  const record = content && typeof content === "object" && !Array.isArray(content)
    ? content as Record<string, unknown>
    : {};
  const text = typeof record.text === "string" ? record.text.trim()
    : typeof record.title === "string" ? record.title.trim()
      : typeof record.caption === "string" ? record.caption.trim()
        : "";
  if (text) return text.slice(0, 4096);
  if (messageType === "audio") return "[Voice note / audio received]";
  if (messageType === "image") return "[Image received]";
  if (messageType === "document") return "[Document received]";
  if (messageType === "video") return "[Video received]";
  if (messageType === "sticker") return "[Sticker received]";
  if (messageType === "location") return "[Location received — precise coordinates are not shown here]";
  if (messageType === "contact") return "[Contact card received — contact details are not shown here]";
  if (messageType === "order") return "[WhatsApp order received]";
  if (messageType === "reaction") return typeof record.emoji === "string" ? `[Reaction: ${record.emoji}]` : "[Reaction received]";
  if (messageType === "system") return "[WhatsApp system event]";
  return "[Unsupported/non-text message received]";
}

export async function getHumanDeskThread(conversationId: string): Promise<HumanDeskThread | null> {
  if (!UUID.test(conversationId)) return null;
  const { data: conversation, error } = await adminClient()
    .from("communication_conversations")
    .select("id,destination_masked,subject_type,revision,last_inbound_at,service_window_expires_at,updated_at,state,human_takeover")
    .eq("id", conversationId)
    .maybeSingle();
  if (
    error || !conversation ||
    conversation.state !== "HUMAN" ||
    conversation.human_takeover !== true
  ) return null;

  const [inboundResult, outboxResult] = await Promise.all([
    adminClient()
      .from("communication_inbound_messages")
      .select("id,received_at,message_type,content_minimized")
      .eq("conversation_id", conversationId)
      .order("received_at", { ascending: false })
      .limit(MAX_THREAD),
    adminClient()
      .from("communication_conversation_outbox")
      .select("id,created_at,proposal_source,expected_revision,body_digest,sealed_body_ciphertext,sealed_body_nonce,sealed_body_auth_tag,encryption_key_id,status")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(MAX_THREAD),
  ]);
  if (inboundResult.error) throw inboundResult.error;
  if (outboxResult.error) throw outboxResult.error;

  const events: HumanDeskThreadEvent[] = [];
  for (const raw of (inboundResult.data ?? []) as Record<string, unknown>[]) {
    events.push({
      id: String(raw.id),
      direction: "inbound",
      occurredAt: String(raw.received_at ?? ""),
      actor: "Customer",
      status: "received",
      body: inboundBody(String(raw.message_type ?? "unsupported"), raw.content_minimized),
    });
  }

  for (const raw of (outboxResult.data ?? []) as Record<string, unknown>[]) {
    const id = String(raw.id);
    const revision = Number(raw.expected_revision ?? -1);
    const digest = String(raw.body_digest ?? "");
    let body = "[Outbound message unavailable]";
    if (revision >= 0 && /^[0-9a-f]{64}$/.test(digest)) {
      const opened = openConversationValue({
        ciphertext: String(raw.sealed_body_ciphertext ?? ""),
        nonce: String(raw.sealed_body_nonce ?? ""),
        authTag: String(raw.sealed_body_auth_tag ?? ""),
        keyId: String(raw.encryption_key_id ?? ""),
      }, conversationOutboxBodyAad(id, conversationId, revision, digest));
      if (opened.ok) {
        const experience = parseSerializedQfWhatsAppExperience(opened.value);
        if (experience) body = renderQfWhatsAppExperienceFallback(experience);
      }
    }
    events.push({
      id,
      direction: "outbound",
      occurredAt: String(raw.created_at ?? ""),
      actor: String(raw.proposal_source ?? "SYSTEM"),
      status: String(raw.status ?? "pending"),
      body,
    });
  }

  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  const bounded = events.slice(Math.max(0, events.length - MAX_THREAD));

  return Object.freeze({
    conversation: Object.freeze({
      id: String(conversation.id),
      destinationMasked: String(conversation.destination_masked ?? "—"),
      subjectType: ["prospect", "client", "vendor"].includes(String(conversation.subject_type))
        ? String(conversation.subject_type) as "prospect" | "client" | "vendor"
        : "unknown",
      revision: Number(conversation.revision ?? 0),
      lastInboundAt: typeof conversation.last_inbound_at === "string" ? conversation.last_inbound_at : null,
      serviceWindowExpiresAt: typeof conversation.service_window_expires_at === "string"
        ? conversation.service_window_expires_at : null,
      updatedAt: String(conversation.updated_at ?? ""),
      canFreeformReply: serviceWindowOpen(conversation.service_window_expires_at),
    }),
    events: Object.freeze(bounded.map((event) => Object.freeze(event))),
  });
}
