export type QfJarvisDataClass = "HOSTED_ALLOWED" | "LOCAL_ONLY" | "HUMAN_ONLY";
export type QfJarvisSubjectStatus =
  | "clear"
  | "erased"
  | "anonymised"
  | "tombstoned"
  | "in-progress";

const HOSTED_TEXT_TYPES = new Set(["text", "button_reply", "list_reply"]);

/**
 * QuickFurno-owned hosted-processing policy for conversational WhatsApp.
 *
 * Only minimized text/selection turns are eligible for the hosted Jarvis model.
 * Attachments, audio, location, contact cards, orders and unsupported/system
 * payloads remain HUMAN_ONLY. There is no permissive default.
 */
export function classifyQfWhatsAppDataClass(messageType: unknown): QfJarvisDataClass {
  return typeof messageType === "string" && HOSTED_TEXT_TYPES.has(messageType)
    ? "HOSTED_ALLOWED"
    : "HUMAN_ONLY";
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
