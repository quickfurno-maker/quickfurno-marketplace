// ============================================================================
// QuickFurno — lib/communication/consentCommandResponse.ts   (Phase 5F-D4-B, pure module)
//
// The CLOSED vocabulary + EVIDENCE CONTRACT for consent-command acknowledgements (STOP / START / HELP).
// PURE: no I/O, no database, no network, no logging, no clock, no randomness, no environment.
//
// WHY THIS EXISTS — THE STOP-ACKNOWLEDGEMENT CONFLICT
//   D2-D's locked policy P1 makes a STOP write suppressions on `marketing` AND `transactional`. D2-C then
//   BLOCKS every ordinary transactional send to that destination. So an acknowledgement sent as an ordinary
//   transactional message would be cancelled by the very STOP it is confirming. The acknowledgement is
//   therefore NOT ordinary outbound traffic: it is a one-shot, user-solicited response to the user's own
//   explicit inbound command, and it must be authorized by PROOF OF THAT COMMAND — never by a bypass flag.
//
// THE NON-REUSABLE BYPASS
//   The three acknowledgement message types below are DELIBERATELY ABSENT from the ordinary D3-B outbound
//   registry (`lib/communication/outboundConsentScope.ts`). An ordinary `authorizeOutboundConsent` call for
//   any of them therefore returns `UNCLASSIFIED_MESSAGE_TYPE` → DENY. There is no flag, no option and no
//   caller-selected scope that can change that. The ONLY way to authorize one is the evidence-bound,
//   one-shot enforcer in `services/consentCommandResponseService.ts`, which requires a validated binding to
//   the exact inbound command. The bypass is not merely un-exposed — it is unreachable by construction.
//
// THE BORROWED LANE (storage compatibility only)
//   The persisted row uses `lane: authentication`, template category `authentication`, channel `whatsapp`
//   and an ephemeral destination. That is dictated by the LIVE DATABASE CONSTRAINTS: `lane` is only
//   ('authentication','business'), and `chk_comm_message_ephemeral_is_authentication` fences an ephemeral
//   (caller-supplied) destination to the authentication lane — and an inbound STOP from an unknown sender
//   has no recipient reference, only a hash. The authentication lane is ALSO the only scope D2-C evaluates
//   against `global` suppression ALONE, which is precisely the rule a command response needs.
//   THIS DOES NOT MAKE THESE MESSAGES AUTHENTICATION SEMANTICALLY. Their internal classification is
//   `consent_command_response`.
// ============================================================================

/** The INTERNAL classification. Never `authentication`, never `transactional`, never `marketing`. */
export const CONSENT_COMMAND_RESPONSE_CLASS = "consent_command_response" as const;

/** The three — and only three — acknowledgement message types. Also their template keys, verbatim. */
export const ConsentAckType = {
  STOP: "consent_stop_acknowledgement",
  START: "consent_start_acknowledgement",
  HELP: "consent_help_response",
} as const;
export type ConsentAckTypeValue = (typeof ConsentAckType)[keyof typeof ConsentAckType];

export const CONSENT_ACK_TYPES: readonly ConsentAckTypeValue[] = Object.freeze([
  ConsentAckType.STOP,
  ConsentAckType.START,
  ConsentAckType.HELP,
]);

/** The persisted lane/channel/category the DB constraints force. Storage compatibility ONLY. */
export const ACK_LANE = "authentication" as const;
export const ACK_CHANNEL = "whatsapp" as const;
export const ACK_TEMPLATE_CATEGORY = "authentication" as const;
export const ACK_DESTINATION_SOURCE = "ephemeral_auth_destination" as const;
/** A neutral recipient. An inbound command sender is NEVER claimed as a client/vendor/admin identity. */
export const ACK_RECIPIENT_TYPE = "system" as const;

/** The normalized inbound command an acknowledgement can answer. `unsupported` is never answered. */
export type AckCommand = "stop" | "start" | "help";

/** command → the ONE acknowledgement type that may answer it. No other mapping exists. */
const COMMAND_TO_ACK: Readonly<Record<AckCommand, ConsentAckTypeValue>> = Object.freeze({
  stop: ConsentAckType.STOP,
  start: ConsentAckType.START,
  help: ConsentAckType.HELP,
});

/** The template key is IDENTICAL to the message type. A swapped template can never be approved. */
export function ackTemplateKeyFor(ackType: ConsentAckTypeValue): string {
  return ackType;
}

// ----------------------------------------------------------------------------
// Eligible dispositions — FOUNDER-RATIFIED, closed
// ----------------------------------------------------------------------------
/**
 * STOP may be acknowledged ONLY when the suppression is genuinely in force.
 * START may be acknowledged for every outcome that is NOT a stronger-suppression block — telling a user
 * "you're resumed" when a complaint/legal/provider block still silences them would be a lie.
 * HELP has no writer result at all (D2-D P3: HELP writes nothing), so its disposition is fixed.
 */
const ELIGIBLE_DISPOSITIONS: Readonly<Record<AckCommand, readonly string[]>> = Object.freeze({
  stop: Object.freeze(["stop_applied", "stop_already_effective"]),
  start: Object.freeze(["start_applied", "start_partially_applied", "start_no_reversible_stop"]),
  help: Object.freeze(["help_acknowledged"]),
});

/** NEVER acknowledged: a stronger suppression still silences the user; a failure wrote nothing. */
export function isEligibleDisposition(command: AckCommand, disposition: unknown): boolean {
  if (typeof disposition !== "string") return false;
  return ELIGIBLE_DISPOSITIONS[command]?.includes(disposition) ?? false;
}

// ----------------------------------------------------------------------------
// Rate-limit windows (fixed)
// ----------------------------------------------------------------------------
export const ACK_WINDOW_MS: Readonly<Record<AckCommand, number>> = Object.freeze({
  stop: 15 * 60 * 1000,   // 15 minutes
  start: 15 * 60 * 1000,  // 15 minutes
  help: 24 * 60 * 60 * 1000, // 24 hours
});

// ----------------------------------------------------------------------------
// The evidence contract
// ----------------------------------------------------------------------------
/**
 * The binding that authorizes ONE acknowledgement. Every field is required; a missing, malformed or
 * mismatched field is a REJECTION. Note what is ABSENT by design: no `bypassConsent`, no
 * `ignoreSuppression`, no `forceSend`, no caller-selected scope, no caller-selected identity confidence,
 * no arbitrary acknowledgement type and no arbitrary template key. The type and template are DERIVED from
 * the command; they are never supplied.
 */
export interface ConsentCommandEvidence {
  readonly inboundMessageId: string;
  /** The verified whole-payload webhook receipt, when D1-B obtained one. */
  readonly webhookReceiptId: string | null;
  readonly provider: string;
  /** The CANONICAL provider message identity (the sha256 digest D2-E gives D2-D) — never the raw wamid. */
  readonly providerMessageId: string;
  readonly channel: string;
  readonly destinationHash: string;
  readonly command: AckCommand;
  readonly disposition: string;
  readonly replayed: boolean;
  /** The PERSISTED inbound capture time (D1-B `received_at`) — the rate-limit bucket derives from it. */
  readonly receivedAt: string;
}

export const AckRejectReason = {
  NOT_A_COMMAND: "NOT_A_COMMAND",
  INELIGIBLE_DISPOSITION: "INELIGIBLE_DISPOSITION",
  REPLAYED_COMMAND: "REPLAYED_COMMAND",
  INVALID_EVIDENCE: "INVALID_EVIDENCE",
  DESTINATION_HASH_MISMATCH: "DESTINATION_HASH_MISMATCH",
  PROVIDER_MESSAGE_MISMATCH: "PROVIDER_MESSAGE_MISMATCH",
  UNSUPPORTED_CHANNEL: "UNSUPPORTED_CHANNEL",
} as const;
export type AckRejectReasonValue = (typeof AckRejectReason)[keyof typeof AckRejectReason];

/** The fully-derived, immutable plan. Nothing here is caller-supplied. */
export interface ConsentAckPlan {
  readonly ackType: ConsentAckTypeValue;
  readonly templateKey: string;
  readonly lane: typeof ACK_LANE;
  readonly channel: typeof ACK_CHANNEL;
  readonly destinationSource: typeof ACK_DESTINATION_SOURCE;
  readonly recipientType: typeof ACK_RECIPIENT_TYPE;
  readonly destinationHash: string;
  readonly idempotencyKey: string;
  readonly evidence: ConsentCommandEvidence;
}

export type ConsentAckPlanOutcome =
  | { readonly ok: true; readonly plan: ConsentAckPlan }
  | { readonly ok: false; readonly reason: AckRejectReasonValue };

const HEX64 = /^[0-9a-f]{64}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOUNDED_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

// ----------------------------------------------------------------------------
// Idempotency / rate-limit key
// ----------------------------------------------------------------------------
/**
 * DETERMINISTIC key: acknowledgement type + destination hash + a TIME BUCKET floored from the PERSISTED
 * inbound `received_at`.
 *
 *   • A webhook REPLAY carries the same persisted `received_at` (D1-B returns the durable row), so it lands
 *     in the SAME bucket → the ledger's `idempotency_key UNIQUE` makes a second send impossible.
 *   • Two identical commands inside the window share a bucket → at most ONE acknowledgement.
 *   • STOP / START / HELP have DISTINCT keys (the type is in the key), so a STOP ack never suppresses a
 *     later HELP response.
 *   • The key contains a sha256 hash and a bucket number — NEVER a plaintext destination.
 */
export function deriveAckIdempotencyKey(
  ackType: ConsentAckTypeValue,
  command: AckCommand,
  destinationHash: string,
  receivedAtIso: string
): string | null {
  if (!HEX64.test(destinationHash)) return null;
  const ms = Date.parse(receivedAtIso);
  if (!Number.isFinite(ms)) return null;
  const windowMs = ACK_WINDOW_MS[command];
  const bucket = Math.floor(ms / windowMs);
  return `ack:${ackType}:${destinationHash}:${bucket}`;
}

// ----------------------------------------------------------------------------
// Plan derivation (the ONE gate every acknowledgement must pass)
// ----------------------------------------------------------------------------
/**
 * Derive the acknowledgement plan for ONE inbound command. Pure + total: every failure is a closed reason.
 * `observedDestinationHash` is the hash RE-COMPUTED in request memory from the verified payload; it must
 * equal the PERSISTED hash, or the evidence does not describe this message and nothing is sent.
 */
export function deriveConsentAckPlan(
  evidence: ConsentCommandEvidence,
  observed: { readonly destinationHash: string; readonly providerMessageId: string }
): ConsentAckPlanOutcome {
  const reject = (reason: AckRejectReasonValue): ConsentAckPlanOutcome => ({ ok: false, reason });

  if (!evidence || !observed) return reject(AckRejectReason.INVALID_EVIDENCE);

  // 1) Only a real command is ever answered. `unsupported` and non-text never reach here.
  if (evidence.command !== "stop" && evidence.command !== "start" && evidence.command !== "help") {
    return reject(AckRejectReason.NOT_A_COMMAND);
  }

  // 2) REPLAY GUARD — a redelivered/replayed command produces ZERO new acknowledgements.
  if (evidence.replayed !== false) return reject(AckRejectReason.REPLAYED_COMMAND);

  // 3) The authoritative result must be one that may be acknowledged. A writer failure, an integrity
  //    violation, an unsupported policy version, or `start_blocked_by_stronger_suppression` never is.
  if (!isEligibleDisposition(evidence.command, evidence.disposition)) {
    return reject(AckRejectReason.INELIGIBLE_DISPOSITION);
  }

  // 4) Structural evidence fences.
  if (typeof evidence.inboundMessageId !== "string" || !UUID_SHAPE.test(evidence.inboundMessageId)) {
    return reject(AckRejectReason.INVALID_EVIDENCE);
  }
  if (evidence.webhookReceiptId !== null && (typeof evidence.webhookReceiptId !== "string" || !UUID_SHAPE.test(evidence.webhookReceiptId))) {
    return reject(AckRejectReason.INVALID_EVIDENCE);
  }
  if (typeof evidence.provider !== "string" || !BOUNDED_ID.test(evidence.provider)) {
    return reject(AckRejectReason.INVALID_EVIDENCE);
  }
  if (typeof evidence.providerMessageId !== "string" || !BOUNDED_ID.test(evidence.providerMessageId)) {
    return reject(AckRejectReason.INVALID_EVIDENCE);
  }
  if (typeof evidence.receivedAt !== "string" || !ISO_INSTANT.test(evidence.receivedAt)) {
    return reject(AckRejectReason.INVALID_EVIDENCE);
  }
  if (typeof evidence.destinationHash !== "string" || !HEX64.test(evidence.destinationHash)) {
    return reject(AckRejectReason.INVALID_EVIDENCE);
  }

  // 5) CHANNEL — D4-B answers WhatsApp only.
  if (evidence.channel !== ACK_CHANNEL) return reject(AckRejectReason.UNSUPPORTED_CHANNEL);

  // 6) The evidence must describe THIS message: the observed (re-derived) identity must match the
  //    persisted one, exactly. A mismatch means the binding is wrong — nothing is sent.
  if (typeof observed.destinationHash !== "string" || observed.destinationHash !== evidence.destinationHash) {
    return reject(AckRejectReason.DESTINATION_HASH_MISMATCH);
  }
  if (typeof observed.providerMessageId !== "string" || observed.providerMessageId !== evidence.providerMessageId) {
    return reject(AckRejectReason.PROVIDER_MESSAGE_MISMATCH);
  }

  // 7) The type and template are DERIVED from the command. They are never supplied by a caller.
  const ackType = COMMAND_TO_ACK[evidence.command];
  const templateKey = ackTemplateKeyFor(ackType);

  const idempotencyKey = deriveAckIdempotencyKey(ackType, evidence.command, evidence.destinationHash, evidence.receivedAt);
  if (!idempotencyKey) return reject(AckRejectReason.INVALID_EVIDENCE);

  return {
    ok: true,
    plan: {
      ackType,
      templateKey,
      lane: ACK_LANE,
      channel: ACK_CHANNEL,
      destinationSource: ACK_DESTINATION_SOURCE,
      recipientType: ACK_RECIPIENT_TYPE,
      destinationHash: evidence.destinationHash,
      idempotencyKey,
      evidence,
    },
  };
}

// ----------------------------------------------------------------------------
// The FIXED approved copy (documentation of intent; the template rows are seeded in a LATER phase)
// ----------------------------------------------------------------------------
/**
 * The exact reviewed English body of each acknowledgement. NO links, offers, pricing, promotions, phone
 * variables, dynamic free text or opt-in CTA. D4-B does NOT create template rows — Phase 7C owns that.
 * Recorded here so the seed cannot drift from what was approved.
 */
export const APPROVED_ACK_COPY: Readonly<Record<ConsentAckTypeValue, string>> = Object.freeze({
  [ConsentAckType.STOP]:
    "Your STOP request has been processed. QuickFurno marketing and service-update WhatsApp messages are now stopped. Authentication messages you request may still be sent. Reply START to request resumption.",
  [ConsentAckType.START]:
    "Your START request has been processed. Messages previously stopped by your QuickFurno STOP request may resume. Other safety, legal, provider, or account restrictions remain in effect.",
  [ConsentAckType.HELP]:
    "QuickFurno messaging help: Reply STOP to stop marketing and service-update WhatsApp messages. Reply START to request resumption. HELP does not change your messaging preferences. Authentication messages may still be sent when you request them.",
});
