export const QF_WHATSAPP_EXPERIENCE_VERSION = 1 as const;

export const QF_WHATSAPP_ACTORS = ["RIYA", "ANISHA", "AAROHI", "SYSTEM", "HUMAN"] as const;
export type QfWhatsAppActor = (typeof QF_WHATSAPP_ACTORS)[number];

export const QF_WHATSAPP_EXPERIENCE_KINDS = [
  "text", "menu", "confirmation", "summary", "status", "handoff", "agent_transition",
] as const;
export type QfWhatsAppExperienceKind = (typeof QF_WHATSAPP_EXPERIENCE_KINDS)[number];

export interface QfWhatsAppActionV1 {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
}

export interface QfWhatsAppExperienceV1 {
  readonly version: 1;
  readonly actor: QfWhatsAppActor;
  readonly kind: QfWhatsAppExperienceKind;
  readonly heading?: string;
  readonly body: string;
  readonly items?: readonly string[];
  readonly actions?: readonly QfWhatsAppActionV1[];
  readonly nextExpectedIntent?: string;
  readonly handoffRequested?: boolean;
}
export const QF_CONCIERGE_ACTIONS = Object.freeze({
  CLIENT: "qf.route.client",
  VENDOR: "qf.route.vendor",
  PROSPECT: "qf.route.prospect",
  HUMAN: "qf.route.human",
  MENU: "qf.route.menu",
} as const);

const ACTION_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const INTENT_ID = /^[A-Za-z0-9._:-]{1,120}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validText(value: unknown, max: number, min = 1): value is string {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseAction(value: unknown): QfWhatsAppActionV1 | null {
  if (!isRecord(value) || !exactKeys(value, ["id", "title", "description"])) return null;
  if (typeof value.id !== "string" || !ACTION_ID.test(value.id)) return null;
  if (!validText(value.title, 24)) return null;
  if (value.description !== undefined && !validText(value.description, 72)) return null;
  return Object.freeze({
    id: value.id,
    title: value.title.trim(),
    ...(value.description === undefined ? {} : { description: value.description.trim() }),
  });
}

export function parseQfWhatsAppExperience(value: unknown): QfWhatsAppExperienceV1 | null {
  if (!isRecord(value)) return null;
  if (!exactKeys(value, [
    "version", "actor", "kind", "heading", "body", "items", "actions",
    "nextExpectedIntent", "handoffRequested",
  ])) return null;
  if (value.version !== 1) return null;
  if (typeof value.actor !== "string" || !(QF_WHATSAPP_ACTORS as readonly string[]).includes(value.actor)) return null;
  if (typeof value.kind !== "string" || !(QF_WHATSAPP_EXPERIENCE_KINDS as readonly string[]).includes(value.kind)) return null;
  if (!validText(value.body, 3072)) return null;
  if (value.heading !== undefined && !validText(value.heading, 60)) return null;

  let items: readonly string[] | undefined;
  if (value.items !== undefined) {
    if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 10) return null;
    const parsedItems = value.items.map((item) => typeof item === "string" ? item.trim() : "");
    if (parsedItems.some((item) => item.length < 1 || item.length > 240)) return null;
    items = Object.freeze(parsedItems);
  }
  let actions: readonly QfWhatsAppActionV1[] | undefined;
  if (value.actions !== undefined) {
    if (!Array.isArray(value.actions) || value.actions.length < 1 || value.actions.length > 10) return null;
    const parsed = value.actions.map(parseAction);
    if (parsed.some((action) => action === null)) return null;
    const concrete = parsed as QfWhatsAppActionV1[];
    const ids = new Set(concrete.map((action) => action.id));
    if (ids.size !== concrete.length) return null;
    actions = Object.freeze(concrete);
  }

  if (value.nextExpectedIntent !== undefined) {
    if (typeof value.nextExpectedIntent !== "string" || !INTENT_ID.test(value.nextExpectedIntent)) return null;
  }
  if (value.handoffRequested !== undefined && typeof value.handoffRequested !== "boolean") return null;

  return Object.freeze({
    version: 1,
    actor: value.actor as QfWhatsAppActor,
    kind: value.kind as QfWhatsAppExperienceKind,
    ...(value.heading === undefined ? {} : { heading: value.heading.trim() }),
    body: value.body.trim(),
    ...(items === undefined ? {} : { items }),
    ...(actions === undefined ? {} : { actions }),
    ...(value.nextExpectedIntent === undefined ? {} : { nextExpectedIntent: value.nextExpectedIntent }),
    ...(value.handoffRequested === undefined ? {} : { handoffRequested: value.handoffRequested }),
  });
}
export function serializeQfWhatsAppExperience(experience: QfWhatsAppExperienceV1): string {
  const parsed = parseQfWhatsAppExperience(experience);
  if (!parsed) throw new Error("INVALID_WHATSAPP_EXPERIENCE");
  return JSON.stringify(parsed);
}

export function parseSerializedQfWhatsAppExperience(value: string): QfWhatsAppExperienceV1 | null {
  try {
    return parseQfWhatsAppExperience(JSON.parse(value));
  } catch {
    return null;
  }
}

export function renderQfWhatsAppExperienceFallback(experience: QfWhatsAppExperienceV1): string {
  const parsed = parseQfWhatsAppExperience(experience);
  if (!parsed) throw new Error("INVALID_WHATSAPP_EXPERIENCE");
  const lines: string[] = [];
  if (parsed.heading) lines.push("*" + parsed.heading + "*");
  lines.push(parsed.body);
  if (parsed.items?.length) lines.push("", ...parsed.items.map((item) => "• " + item));
  if (parsed.actions?.length) {
    lines.push("", ...parsed.actions.map((action, index) =>
      String(index + 1) + ". " + action.title + (action.description ? " — " + action.description : "")));
  }
  return lines.join("\n").trim().slice(0, 4096);
}
export function buildQuickFurnoConciergeMenu(): QfWhatsAppExperienceV1 {
  return Object.freeze({
    version: 1,
    actor: "SYSTEM",
    kind: "menu",
    heading: "QuickFurno Concierge ✦",
    body: "Tell us what you need and we’ll connect you to the right QuickFurno specialist.",
    actions: Object.freeze([
      { id: QF_CONCIERGE_ACTIONS.CLIENT, title: "Find furniture", description: "Riya · Client Concierge" },
      { id: QF_CONCIERGE_ACTIONS.VENDOR, title: "Existing vendor", description: "Anisha · Partner Concierge" },
      { id: QF_CONCIERGE_ACTIONS.PROSPECT, title: "New business enquiry", description: "Aarohi · Growth Concierge" },
      { id: QF_CONCIERGE_ACTIONS.HUMAN, title: "Talk to QuickFurno", description: "Human assistance" },
    ]),
    nextExpectedIntent: "concierge.route",
  });
}

export function buildAgentTransitionExperience(
  actor: Exclude<QfWhatsAppActor, "SYSTEM" | "HUMAN">,
): QfWhatsAppExperienceV1 {
  const copy = actor === "RIYA"
    ? ["Riya · Client Concierge", "I’ll help with furniture requirements, recommendations and your QuickFurno journey."]
    : actor === "ANISHA"
      ? ["Anisha · Partner Concierge", "I’ll help with your registered vendor account, leads and fulfilment."]
      : ["Aarohi · Growth Concierge", "I’ll help with new supplier, partnership and business opportunities."];
  return Object.freeze({
    version: 1,
    actor,
    kind: "agent_transition",
    heading: copy[0],
    body: copy[1],
  });
}

export function buildVendorIdentityRequiredExperience(): QfWhatsAppExperienceV1 {
  return Object.freeze({
    version: 1,
    actor: "SYSTEM",
    kind: "confirmation",
    heading: "QuickFurno Partner Desk",
    body: "I couldn’t match this WhatsApp number to a registered vendor account. Choose a new-business route or human assistance.",
    actions: Object.freeze([
      { id: QF_CONCIERGE_ACTIONS.PROSPECT, title: "New business enquiry" },
      { id: QF_CONCIERGE_ACTIONS.HUMAN, title: "Talk to QuickFurno" },
    ]),
    nextExpectedIntent: "concierge.vendor_identity",
  });
}

export function buildHumanHandoffExperience(): QfWhatsAppExperienceV1 {
  return Object.freeze({
    version: 1,
    actor: "HUMAN",
    kind: "handoff",
    heading: "QuickFurno Team",
    body: "Your conversation has been moved to human assistance. A QuickFurno team member can continue from here.",
    handoffRequested: true,
  });
}

export function buildNonTextGuidanceExperience(messageType: string): QfWhatsAppExperienceV1 {
  const label = messageType === "image" ? "image"
    : messageType === "document" ? "document"
      : messageType === "audio" ? "voice note or audio"
        : messageType === "video" ? "video"
          : messageType === "sticker" ? "sticker"
            : messageType === "location" ? "location"
              : messageType === "contact" ? "contact card"
                : messageType === "order" ? "WhatsApp order"
                  : "message";
  const detail = ["image", "document", "video"].includes(messageType)
    ? "If it has a caption, I can use that text. Otherwise, add a short message describing what you want help with."
    : messageType === "audio"
      ? "Please add the key details in text, or choose human assistance if you prefer."
      : messageType === "location"
        ? "For privacy, please type the city, area or pincode you want us to use."
        : messageType === "contact"
          ? "For privacy, please tell us in text what you want us to do with that contact."
          : messageType === "order"
            ? "QuickFurno does not infer fulfilment instructions from a WhatsApp catalog order. Add the request in text or ask for human assistance."
            : "Add a short text message so I can help accurately.";
  return Object.freeze({
    version: 1,
    actor: "SYSTEM",
    kind: "confirmation",
    heading: "QuickFurno Concierge",
    body: `I received your ${label}. ${detail}`,
    actions: Object.freeze([
      { id: QF_CONCIERGE_ACTIONS.MENU, title: "Main menu" },
      { id: QF_CONCIERGE_ACTIONS.HUMAN, title: "Talk to QuickFurno" },
    ]),
    nextExpectedIntent: "concierge.non_text_followup",
  });
}

export function textExperience(
  actor: Exclude<QfWhatsAppActor, "SYSTEM" | "HUMAN">,
  body: string,
): QfWhatsAppExperienceV1 {
  return Object.freeze({ version: 1, actor, kind: "text", body });
}

export function humanTextExperience(body: string): QfWhatsAppExperienceV1 {
  return Object.freeze({
    version: 1,
    actor: "HUMAN",
    kind: "text",
    heading: "QuickFurno Team",
    body: body.trim(),
  });
}