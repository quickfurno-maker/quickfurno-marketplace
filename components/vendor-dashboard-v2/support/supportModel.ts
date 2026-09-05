// ============================================================================
// QuickFurno — Vendor Support view model (QF-UI-V2-04)
//
// PURE presentation over threads listVendorSupportThreads() already returns.
// Ownership, thread creation and message sending are untouched.
//
// Deliberately absent, because none of it exists in the product: live chat,
// WhatsApp support, attachments, file upload, SLA or response-time promises,
// and priority escalation.
// ============================================================================
import type {
  VendorSupportMessage,
  VendorSupportThreadWithMessages,
} from "@/services/vendorSupportService";

/** Exactly the topics the server accepts. */
export const SUPPORT_TOPICS: readonly { value: string; label: string }[] = [
  { value: "general", label: "General" },
  { value: "profile", label: "Profile" },
  { value: "package", label: "Package / recharge" },
  { value: "leads", label: "Leads" },
  { value: "billing", label: "Billing" },
];

/** Mirrors cleanText() in vendorSupportService. Advisory in the UI only. */
export const SUPPORT_LIMITS = {
  subject: 140,
  message: 1200,
} as const;

export function supportTopicLabel(topic: string | null | undefined): string {
  const key = (topic ?? "general").trim().toLowerCase();
  return SUPPORT_TOPICS.find((t) => t.value === key)?.label ?? "General";
}

export type SupportStatusTone = "open" | "closed" | "neutral";

export interface SupportStatus {
  label: string;
  tone: SupportStatusTone;
}

/**
 * Status label only. No capability is inferred from it — the server does not
 * forbid replying to a closed thread, so the UI does not pretend it does.
 */
export function supportStatusOf(status: string | null | undefined): SupportStatus {
  const key = (status ?? "open").trim().toLowerCase();
  if (key === "closed" || key === "resolved") {
    return { label: key === "resolved" ? "Resolved" : "Closed", tone: "closed" };
  }
  if (key === "open" || key === "") return { label: "Open", tone: "open" };
  return { label: key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), tone: "neutral" };
}

export interface SupportThreadSummary {
  messageCount: number;
  /** Chronologically last message, already loaded with the thread. */
  latest: VendorSupportMessage | null;
  awaitingQuickFurno: boolean;
}

/** Derived from the messages already attached to the thread. No extra query. */
export function summarizeThread(thread: VendorSupportThreadWithMessages): SupportThreadSummary {
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const latest = messages.length > 0 ? messages[messages.length - 1] : null;
  return {
    messageCount: messages.length,
    latest,
    // Purely a reading of who spoke last — not a claim about response time.
    awaitingQuickFurno: latest ? latest.sender_type !== "admin" : false,
  };
}

export function senderLabel(senderType: string | null | undefined): string {
  return (senderType ?? "").trim().toLowerCase() === "admin" ? "QuickFurno" : "You";
}

export function isAdminMessage(senderType: string | null | undefined): boolean {
  return (senderType ?? "").trim().toLowerCase() === "admin";
}

/** Single-line preview of a message body, for a collapsed thread row. */
export function messagePreview(message: VendorSupportMessage | null, max = 110): string | null {
  if (!message) return null;
  const text = (message.message ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function formatSupportTime(value: string | null | undefined): string {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// ---------------------------------------------------------------------------
// Feedback for the existing ?support= contract.
// ---------------------------------------------------------------------------
export type SupportFeedbackTone = "ok" | "error";

export interface SupportFeedback {
  tone: SupportFeedbackTone;
  message: string;
}

export function readSupportFeedback(param: string | undefined): SupportFeedback | null {
  switch (param) {
    case "created":
      return { tone: "ok", message: "Support request created. QuickFurno will reply in this thread." };
    case "sent":
      return { tone: "ok", message: "Message sent." };
    case "failed":
      return { tone: "error", message: "That did not go through. Check the fields and try again." };
    case "no-vendor":
      return { tone: "error", message: "We could not find your vendor profile for that action." };
    default:
      return null;
  }
}
