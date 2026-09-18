import {
  QF_CONCIERGE_ACTIONS,
  buildAgentTransitionExperience,
  buildHumanHandoffExperience,
  buildQuickFurnoConciergeMenu,
  buildVendorIdentityRequiredExperience,
  type QfWhatsAppExperienceV1,
} from "../jarvis/whatsAppExperience";

export type ConciergeSubjectType = "unknown" | "prospect" | "client" | "vendor";
export type ConciergeActor = "AAROHI" | "ANISHA" | "RIYA" | "HUMAN" | "SYSTEM";
export type ConciergeState = "OPEN" | "PAUSED" | "HUMAN";

export interface ConciergeRoutingInput {
  readonly identityConfidence: "exact" | "ambiguous" | "unknown";
  readonly principalType: "client" | "vendor" | "admin" | null;
  readonly messageType: string;
  readonly contentMinimized: Record<string, unknown>;
  readonly currentSubjectType?: ConciergeSubjectType;
  readonly currentActor?: ConciergeActor;
  readonly currentHumanTakeover?: boolean;
  readonly isNewConversation?: boolean;
}

export interface ConciergeRoutingDecision {
  readonly subjectType: ConciergeSubjectType;
  readonly assignedActor: ConciergeActor;
  readonly jarvisEnabled: boolean;
  readonly humanTakeover: boolean;
  readonly state: ConciergeState;
  readonly suppressJarvisTurn: boolean;
  readonly systemExperience?: QfWhatsAppExperienceV1;
  readonly source: "identity" | "choice" | "intent" | "existing" | "menu" | "human";
}
const GREETINGS = new Set(["hi", "hello", "hey", "hii", "hiii", "namaste", "start", "menu"]);
const HUMAN = new Set(["human", "agent", "talk to human", "talk to a person", "talk to quickfurno"]);
const CLIENT_PHRASES = [
  "find furniture", "need furniture", "looking for furniture", "office chair", "office chairs",
  "office desk", "office desks", "workstation", "sofa", "table", "chairs", "furniture requirement",
];
const VENDOR_PHRASES = [
  "existing vendor", "vendor account", "my vendor account", "vendor leads", "my leads",
  "fulfilment", "fulfillment", "vendor dashboard",
];
const PROSPECT_PHRASES = [
  "new business enquiry", "business enquiry", "become a vendor", "register as vendor",
  "register as a vendor", "become supplier", "become a supplier", "sell on quickfurno",
  "partnership", "partner with quickfurno",
];

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length ? normalized.slice(0, 4096) : null;
}

function routeToken(input: ConciergeRoutingInput): string | null {
  if (input.messageType === "button_reply" || input.messageType === "list_reply") {
    return normalizeText(input.contentMinimized.replyId);
  }
  if (input.messageType === "text") return normalizeText(input.contentMinimized.text);
  return null;
}
function containsAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => text === phrase || text.includes(phrase));
}

function route(
  subjectType: ConciergeSubjectType,
  assignedActor: ConciergeActor,
  source: ConciergeRoutingDecision["source"],
  options: { suppress?: boolean; experience?: QfWhatsAppExperienceV1; human?: boolean } = {},
): ConciergeRoutingDecision {
  const human = options.human === true;
  return Object.freeze({
    subjectType,
    assignedActor,
    jarvisEnabled: !human && assignedActor !== "SYSTEM",
    humanTakeover: human,
    state: human ? "HUMAN" : "OPEN",
    suppressJarvisTurn: options.suppress === true || human || assignedActor === "SYSTEM",
    ...(options.experience === undefined ? {} : { systemExperience: options.experience }),
    source,
  });
}

function identityDecision(input: ConciergeRoutingInput): ConciergeRoutingDecision | null {
  if (input.identityConfidence !== "exact") return null;
  if (input.principalType === "client") return route("client", "RIYA", "identity");
  if (input.principalType === "vendor") return route("vendor", "ANISHA", "identity");
  if (input.principalType === "admin") {
    return route("unknown", "HUMAN", "human", { human: true, experience: buildHumanHandoffExperience() });
  }
  return null;
}
function existingDecision(input: ConciergeRoutingInput): ConciergeRoutingDecision | null {
  if (input.currentHumanTakeover === true) {
    return route(input.currentSubjectType ?? "unknown", "HUMAN", "human", { human: true });
  }
  const subject = input.currentSubjectType ?? "unknown";
  const actor = input.currentActor;
  if (subject === "client" && actor === "RIYA") return route("client", "RIYA", "existing");
  if (subject === "vendor" && actor === "ANISHA") return route("vendor", "ANISHA", "existing");
  if (subject === "prospect" && actor === "AAROHI") return route("prospect", "AAROHI", "existing");
  return null;
}

export function resolveWhatsAppConciergeRouting(input: ConciergeRoutingInput): ConciergeRoutingDecision {
  const token = routeToken(input);

  if (token === QF_CONCIERGE_ACTIONS.HUMAN || (token !== null && HUMAN.has(token))) {
    return route(input.currentSubjectType ?? "unknown", "HUMAN", "human", {
      human: true,
      experience: buildHumanHandoffExperience(),
    });
  }

  const exactIdentity = identityDecision(input);
  if (exactIdentity) {
    if (token === QF_CONCIERGE_ACTIONS.MENU || token === "menu") {
      return route(exactIdentity.subjectType, exactIdentity.assignedActor, "menu", {
        suppress: true, experience: buildQuickFurnoConciergeMenu(),
      });
    }
    if (input.isNewConversation && token !== null && GREETINGS.has(token)) {
      return route(exactIdentity.subjectType, exactIdentity.assignedActor, "identity", {
        suppress: true, experience: buildAgentTransitionExperience(exactIdentity.assignedActor as "RIYA" | "ANISHA"),
      });
    }
    return exactIdentity;
  }
  if (token === QF_CONCIERGE_ACTIONS.VENDOR || (token !== null && containsAny(token, VENDOR_PHRASES))) {
    return route("unknown", "SYSTEM", "menu", {
      suppress: true, experience: buildVendorIdentityRequiredExperience(),
    });
  }
  if (token === QF_CONCIERGE_ACTIONS.PROSPECT || (token !== null && containsAny(token, PROSPECT_PHRASES))) {
    return route("prospect", "AAROHI", "choice", {
      suppress: token === QF_CONCIERGE_ACTIONS.PROSPECT,
      experience: token === QF_CONCIERGE_ACTIONS.PROSPECT ? buildAgentTransitionExperience("AAROHI") : undefined,
    });
  }
  if (token === QF_CONCIERGE_ACTIONS.CLIENT || (token !== null && containsAny(token, CLIENT_PHRASES))) {
    return route("client", "RIYA", "choice", {
      suppress: token === QF_CONCIERGE_ACTIONS.CLIENT,
      experience: token === QF_CONCIERGE_ACTIONS.CLIENT ? buildAgentTransitionExperience("RIYA") : undefined,
    });
  }

  const existing = existingDecision(input);
  if (existing) return existing;

  if (token === QF_CONCIERGE_ACTIONS.MENU || token === null || GREETINGS.has(token)) {
    return route("unknown", "SYSTEM", "menu", { suppress: true, experience: buildQuickFurnoConciergeMenu() });
  }

  return route("unknown", "SYSTEM", "menu", { suppress: true, experience: buildQuickFurnoConciergeMenu() });
}