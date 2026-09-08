// ============================================================================
// QuickFurno — lib/automation/clientClarificationExecution.ts   (PURE)
//
// QF-MVP-50.9 — the exact clarification-request execution authority.
//
// WHY THIS EXISTS
// `client.requirement_collection` and `client.missing_information_reminder`
// both need an `outstandingItem` — the human phrase naming what the client
// still has to tell us. Until now no Core source for it was ever proven, so
// both actions failed closed with QF_EXEC_VARIABLES_UNRESOLVED. That was the
// honest answer, but it left two real jobs permanently unexecutable.
//
// THE HARD PART IS NOT FINDING A VALUE — IT IS FINDING THE RIGHT ONE.
// A lead can be asked for clarification more than once. "The latest
// clarification request for this lead" would let a NEWER request silently
// supply the content for an OLDER queued job, so a client could be asked about
// details they were never actually asked for, or asked again after answering.
//
// So the authority is SOURCE-BOUND: the producer already sealed the exact
// clarification request id into the action's idempotency key, and this module
// reads it back out of that key. The chain is
//
//   clarification request -> producer evidence token -> idempotency key
//     -> claimed job envelope -> executor
//
// and every link is verified. There is deliberately no query "by lead".
//
// SEPARATION OF ROLES, kept strict:
//   * the EXACT producer request is MESSAGE-CONTENT authority;
//   * the CURRENT lead row is EXECUTION-TIME BUSINESS-ELIGIBILITY authority.
// Neither substitutes for the other. Content never comes from mutable lead
// fields, and eligibility is never inferred from the frozen request alone.
//
// NEVER a content source: `safeContext`, the request body, n8n, provider text,
// `preview_message`, free-text `questions_json[*].text`, or a default phrase.
// A request source — including a future agent — must not be able to choose
// what a client is told.
//
// PURE: no I/O, no clock, no randomness, no database, no provider.
// ============================================================================

import { MAX_BUSINESS_VARIABLE_LENGTH } from "../communication/businessTemplateVariables";

/** The only two actions this authority governs. */
export const CLARIFICATION_ACTION_TYPES = Object.freeze([
  "client.requirement_collection",
  "client.missing_information_reminder",
] as const);

export type ClarificationActionType = (typeof CLARIFICATION_ACTION_TYPES)[number];

export function isClarificationActionType(value: unknown): value is ClarificationActionType {
  return (
    typeof value === "string" &&
    (CLARIFICATION_ACTION_TYPES as readonly string[]).includes(value)
  );
}

/**
 * The evidence prefix each action's producer seals into its idempotency key.
 * They are DIFFERENT on purpose: a reminder key can never authenticate a
 * requirement-collection job, or the reverse.
 *
 * Note `clarrem` begins with `clar`. The patterns below are fully anchored and
 * demand EXACTLY 32 hex characters after the prefix, so `clarrem<32hex>` cannot
 * satisfy the `clar` form (it would leave `rem` + 32 chars, which is 35).
 */
const EVIDENCE_PREFIX: Readonly<Record<ClarificationActionType, string>> = Object.freeze({
  "client.requirement_collection": "clar",
  "client.missing_information_reminder": "clarrem",
});

/**
 * Hex is accepted in LOWERCASE ONLY, deliberately.
 *
 * The producer derives this token from a Postgres uuid, which renders lowercase,
 * so lowercase is the only shape that is actually produced. Accepting uppercase
 * would mean accepting a token this system never emits — and case-folding it
 * would make two different strings resolve to the same request. An uppercase
 * token fails closed instead.
 */
const LOWER_HEX_32 = /^[0-9a-f]{32}$/;
const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ClarificationIdentityResult =
  | { readonly ok: true; readonly requestId: string }
  | { readonly ok: false };

/**
 * Recover the EXACT clarification request id the producer sealed into this
 * action's idempotency key, proving on the way that the key belongs to this
 * action and this lead.
 *
 * Accepted forms, in full, with nothing before or after:
 *
 *   qf_action_v1:client.requirement_collection:lead:<lead-uuid>:clar<32hex>
 *   qf_action_v1:client.missing_information_reminder:lead:<lead-uuid>:clarrem<32hex>
 *
 * Everything else — a wrong action, a wrong entity token, a lead uuid that is
 * not the envelope's lead, the wrong evidence prefix, 31 or 33 hex characters,
 * non-hex, an extra colon, or any trailing material — returns `ok: false`, and
 * the caller turns that into a fail-closed refusal. It never guesses.
 */
export function parseClarificationRequestIdentity(input: {
  actionType: unknown;
  leadId: unknown;
  idempotencyKey: unknown;
}): ClarificationIdentityResult {
  const { actionType, leadId, idempotencyKey } = input;

  if (!isClarificationActionType(actionType)) return { ok: false };
  if (typeof leadId !== "string" || !LOWER_UUID.test(leadId)) return { ok: false };
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) return { ok: false };

  // Split on ":" and require EXACTLY five segments. This is what rejects an
  // extra colon and any trailing material, rather than a prefix match that
  // would happily ignore whatever followed.
  const segments = idempotencyKey.split(":");
  if (segments.length !== 5) return { ok: false };

  const [namespace, action, entityToken, embeddedLeadId, evidence] = segments;
  if (namespace !== "qf_action_v1") return { ok: false };
  if (action !== actionType) return { ok: false };
  if (entityToken !== "lead") return { ok: false };
  if (embeddedLeadId !== leadId) return { ok: false };

  const prefix = EVIDENCE_PREFIX[actionType];
  if (!evidence.startsWith(prefix)) return { ok: false };

  const hex = evidence.slice(prefix.length);
  if (!LOWER_HEX_32.test(hex)) return { ok: false };

  const requestId = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");

  // Belt and braces: the reconstruction must itself be a canonical uuid.
  if (!LOWER_UUID.test(requestId)) return { ok: false };

  return { ok: true, requestId };
}

/**
 * The CLOSED client-safe label for every question key the clarification
 * generator can persist.
 *
 * Internal keys are schema vocabulary, not customer language — "the interior
 * service you need" is what a person can answer; `interior_leaf_category` is
 * not. Equally, the free-text `questions_json[*].text` is NOT used: it is
 * generator output that could change wording, length or tone without any
 * template review, and it would become provider-visible content.
 *
 * An unknown key is a REFUSAL, never a fallback phrase. If the generator learns
 * a new question, this map must learn it in the same review.
 */
export const CLARIFICATION_QUESTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  interior_leaf_category: "the interior service you need",
  sofa_work_type: "the sofa work you need",
  painting_work_type: "the painting work you need",
  civil_work_type: "the civil work you need",
  property_type: "your property type",
  property_size: "your property size",
  site_type: "your site type",
  sofa_size: "your sofa size",
  photo_available: "whether you have a photo or video",
  budget: "your budget range",
  timeline: "your preferred timeline",
  area_location: "your area or locality",
});

export type OutstandingItemResult =
  | { readonly ok: true; readonly outstandingItem: string; readonly keyCount: number }
  | { readonly ok: false };

/** Control characters a business variable may never carry. */
const CONTROL_CHARACTERS = /[\r\n\t]/;

/**
 * Read the ordered question KEYS out of a persisted `questions_json` array.
 *
 * Order is the PERSISTED order — never sorted — because the questions were
 * generated in the order the client will be asked them, and re-ordering would
 * change the message for no reason a reader could audit.
 */
function readQuestionKeys(questionsJson: unknown): readonly string[] | null {
  if (!Array.isArray(questionsJson) || questionsJson.length === 0) return null;

  const keys: string[] = [];
  for (const entry of questionsJson) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
    const key = (entry as { key?: unknown }).key;
    if (typeof key !== "string" || key.length === 0) return null;
    keys.push(key);
  }
  return keys;
}

/**
 * Derive the client-safe `outstandingItem` phrase from the EXACT producer
 * request's persisted questions.
 *
 * Joining: one item is itself; two are joined with "and"; three or more use a
 * serial comma. Nothing is ever truncated — an over-long result is a refusal,
 * because a message cut mid-phrase is worse than a message not sent.
 */
export function deriveOutstandingItem(questionsJson: unknown): OutstandingItemResult {
  const keys = readQuestionKeys(questionsJson);
  if (keys === null) return { ok: false };

  // A duplicated key would produce "your property type and your property type".
  // Fail closed rather than silently de-duplicating something the generator
  // should never have written.
  if (new Set(keys).size !== keys.length) return { ok: false };

  const labels: string[] = [];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(CLARIFICATION_QUESTION_LABELS, key)) {
      return { ok: false };
    }
    labels.push(CLARIFICATION_QUESTION_LABELS[key]);
  }

  let outstandingItem: string;
  if (labels.length === 1) {
    outstandingItem = labels[0];
  } else if (labels.length === 2) {
    outstandingItem = `${labels[0]} and ${labels[1]}`;
  } else {
    outstandingItem = `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
  }

  if (CONTROL_CHARACTERS.test(outstandingItem)) return { ok: false };
  // The business variable builder validates this again and remains the final
  // authority; refusing here as well means an over-long value never even
  // reaches the builder, and is never truncated to fit.
  if (outstandingItem.length > MAX_BUSINESS_VARIABLE_LENGTH) return { ok: false };

  return { ok: true, outstandingItem, keyCount: keys.length };
}
