import type {
  ClarificationQuestion,
  ClarificationOption,
} from "@/lib/lead-quality/clarificationPresets";
import type { QfWhatsAppExperienceV1 } from "@/lib/jarvis/whatsAppExperience";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX32_RE = /^[0-9a-f]{32}$/;
const START_PREFIX = "qfclar";
const ANSWER_PREFIX = "qfcla1";

export type LeadEnrichmentReplyToken =
  | { readonly kind: "start"; readonly requestId: string }
  | {
      readonly kind: "answer";
      readonly requestId: string;
      readonly questionIndex: number;
      readonly optionIndex: number;
    };

export function buildLeadEnrichmentStartToken(requestId: string): string | null {
  const hex = uuidToHex(requestId);
  return hex ? `${START_PREFIX}:${hex}` : null;
}

export function buildLeadEnrichmentAnswerToken(
  requestId: string,
  questionIndex: number,
  optionIndex: number,
): string | null {
  const hex = uuidToHex(requestId);
  if (
    !hex ||
    !Number.isInteger(questionIndex) ||
    questionIndex < 0 ||
    questionIndex > 99 ||
    !Number.isInteger(optionIndex) ||
    optionIndex < 0 ||
    optionIndex > 99
  ) {
    return null;
  }
  return `${ANSWER_PREFIX}:${hex}:${questionIndex}:${optionIndex}`;
}

export function parseLeadEnrichmentReplyToken(
  value: unknown,
): LeadEnrichmentReplyToken | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  const parts = raw.split(":");

  if (
    parts.length === 2 &&
    parts[0] === START_PREFIX &&
    HEX32_RE.test(parts[1])
  ) {
    return { kind: "start", requestId: hexToUuid(parts[1]) };
  }

  if (
    parts.length === 4 &&
    parts[0] === ANSWER_PREFIX &&
    HEX32_RE.test(parts[1]) &&
    /^\d{1,2}$/.test(parts[2]) &&
    /^\d{1,2}$/.test(parts[3])
  ) {
    return {
      kind: "answer",
      requestId: hexToUuid(parts[1]),
      questionIndex: Number(parts[2]),
      optionIndex: Number(parts[3]),
    };
  }
  return null;
}

export function buildLeadEnrichmentQuestionExperience(input: {
  requestId: string;
  question: ClarificationQuestion;
  questionIndex: number;
  totalQuestions: number;
}): QfWhatsAppExperienceV1 | null {
  const { question } = input;
  const heading = input.totalQuestions > 1
    ? `Quick detail ${input.questionIndex + 1}/${input.totalQuestions}`
    : "Quick project detail";

  if (question.type === "single_choice") {
    const options = Array.isArray(question.options) ? question.options : [];
    if (options.length < 1 || options.length > 10) return null;
    const actions = options.map((option, optionIndex) => {
      const id = buildLeadEnrichmentAnswerToken(
        input.requestId,
        input.questionIndex,
        optionIndex,
      );
      if (!id) return null;
      return {
        id,
        title: optionTitle(option),
      };
    });
    if (actions.some((action) => action === null)) return null;

    return {
      version: 1,
      actor: "SYSTEM",
      kind: "menu",
      heading,
      body: question.text,
      actions: actions as NonNullable<QfWhatsAppExperienceV1["actions"]>,
      nextExpectedIntent: "lead.enrichment.answer",
    };
  }

  if (question.type === "free_text_later") {
    return {
      version: 1,
      actor: "SYSTEM",
      kind: "text",
      heading,
      body: `${question.text}. Reply with the detail in a short message.`,
      nextExpectedIntent: "lead.enrichment.free_text",
    };
  }

  return null;
}

export function buildLeadEnrichmentCompleteExperience(): QfWhatsAppExperienceV1 {
  return {
    version: 1,
    actor: "SYSTEM",
    kind: "confirmation",
    heading: "Details received ✓",
    body:
      "Thanks. Your requirement details are updated. QuickFurno will now verify the enquiry and match it only when it is ready.",
  };
}

export function buildLeadEnrichmentNeedsReviewExperience(): QfWhatsAppExperienceV1 {
  return {
    version: 1,
    actor: "SYSTEM",
    kind: "confirmation",
    heading: "Details received",
    body:
      "Thanks. We saved your response. A QuickFurno team member will review anything that still needs clarification before matching.",
  };
}

function optionTitle(option: ClarificationOption): string {
  const title = String(option.label || option.value || "Option").trim();
  if (title.length <= 24) return title;
  return title.slice(0, 23).trimEnd() + "…";
}

function uuidToHex(value: string): string | null {
  if (!UUID_RE.test(value)) return null;
  return value.toLowerCase().replace(/-/g, "");
}

function hexToUuid(hex: string): string {
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
