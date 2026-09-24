export type QfJarvisDataClass = "HOSTED_ALLOWED" | "LOCAL_ONLY" | "HUMAN_ONLY";
export type QfJarvisSubjectStatus =
  | "clear"
  | "erased"
  | "anonymised"
  | "tombstoned"
  | "in-progress";

const HOSTED_TEXT_TYPES = new Set(["text", "button_reply", "list_reply"]);
const LOCAL_MEDIA_TYPES = new Set(["image", "document", "audio", "video", "sticker"]);

/**
 * QuickFurno-owned processing policy for conversational WhatsApp.
 *
 * Minimized text/selection turns may use an approved hosted model. Media is LOCAL_ONLY:
 * the signed bridge may deliver exact, turn-bound bytes to Jarvis, but a hosted provider
 * cannot receive them unless a later reviewed policy explicitly changes this class.
 * Location, contacts, orders and unsupported/system payloads remain HUMAN_ONLY.
 */
export function classifyQfWhatsAppDataClass(messageType: unknown): QfJarvisDataClass {
  if (typeof messageType !== "string") return "HUMAN_ONLY";
  if (HOSTED_TEXT_TYPES.has(messageType)) return "HOSTED_ALLOWED";
  return LOCAL_MEDIA_TYPES.has(messageType) ? "LOCAL_ONLY" : "HUMAN_ONLY";
}

/**
 * Only a durable subject whose current QuickFurno lifecycle has been positively
 * re-read as eligible is clear. A missing subject reference is intentionally
 * non-clear: absence of privacy/subject authority must never be upgraded into
 * permission merely to let Jarvis run.
 */
export function deriveQfJarvisSubjectStatus(input: {
  readonly subjectRef?: string;
  readonly subjectEligible?: boolean;
}): QfJarvisSubjectStatus {
  return input.subjectRef !== undefined && input.subjectEligible === true
    ? "clear"
    : "in-progress";
}
