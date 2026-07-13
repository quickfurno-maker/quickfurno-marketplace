// ============================================================================
// QuickFurno — services/consentCommandResponseService.ts   (Phase 5F-D4-B, server-only)
//
// The EVIDENCE-BOUND acknowledgement path for inbound consent commands (STOP / START / HELP).
//
// AUTHORITY. QuickFurno Core remains authoritative. This service DECIDES NOTHING about consent:
//   • D2-D remains the sole STOP/START writer — this service never writes consent state;
//   • D2-C remains the sole consent/suppression decision authority — this service asks it, and obeys;
//   • D2-E remains the sole inbound command integrator — this service only READS its completed result.
// It writes no consent row, reads no consent table, and never interprets a suppression or preference.
//
// WHY A SEPARATE PATH. A STOP makes D2-D suppress `marketing` AND `transactional`, so an ordinary
// transactional acknowledgement would be cancelled by the very STOP it confirms. The acknowledgement is a
// one-shot, user-solicited response to the user's OWN explicit command, so it is authorized by PROOF OF
// THAT COMMAND — never by a bypass flag. The three acknowledgement types are DELIBERATELY ABSENT from the
// ordinary D3-B registry, so `authorizeOutboundConsent` denies them as UNCLASSIFIED_MESSAGE_TYPE. The only
// authorizer that can pass one is the PRIVATE, ONE-SHOT, evidence-bound enforcer below. There is no
// reusable suppression bypass: the bypass is bound 1:1 to a single validated inbound command.
//
// ORDER (never violated). verified webhook → D1-B persist → D2-E command (→ D2-D write) → THEN this.
// For STOP/START the writer result must already exist; this service only ever sees a COMPLETED D2-E result.
//
// BEST-EFFORT, NON-AUTHORITATIVE. Acknowledgement delivery NEVER rolls back, repeats, weakens or alters the
// consent command, and never changes the webhook's success/failure decision. A missing template, an absent
// provider, a suppression, a rate limit, a rejection, a timeout or a throw all end in ZERO further effect.
//
// PRIVACY. The plaintext destination is re-derived in REQUEST MEMORY only (from the already-verified,
// already-parsed payload, via the same pure normalizer D1-B uses) and is never persisted, never logged and
// never returned. No raw webhook body, OTP, consent row, provider secret or database error ever escapes.
// ============================================================================

import { hashPhoneE164 } from "../lib/communication/phone";
import { normalizeMetaInboundWebhook } from "../lib/communication/providers/metaWhatsAppInbound";
import { ephemeralAuthDestination, type CommunicationIntent } from "../lib/communication/types";
import {
  ACK_CHANNEL,
  ACK_DESTINATION_SOURCE,
  ACK_LANE,
  ACK_RECIPIENT_TYPE,
  CONSENT_ACK_TYPES,
  deriveConsentAckPlan,
  type AckCommand,
  type AckRejectReasonValue,
  type ConsentAckPlan,
  type ConsentCommandEvidence,
} from "../lib/communication/consentCommandResponse";
import { decideCommunicationConsent } from "./communicationConsentDecisionService";
import type {
  OutboundConsentEnforcementInput,
  OutboundConsentEnforcer,
  OutboundConsentOutcome,
} from "./outboundConsentEnforcementService";
import { createRuntimeCommunicationService } from "./runtimeCommunicationService";

// ----------------------------------------------------------------------------
// Public input — ONLY verified, already-processed facts
// ----------------------------------------------------------------------------
/** The minimal shape of one D1-B processed item this service reads. */
export interface AckPersistedItem {
  readonly message: { readonly providerMessageId: string; readonly messageType: string };
  readonly receipt: {
    readonly inboundMessageId: string;
    readonly provider: string;
    readonly providerMessageId: string;
    readonly destinationHash: string;
    readonly receivedAt: string;
  };
}

/** The minimal shape of one D2-E command result this service reads. */
export interface AckCommandItem {
  readonly inboundMessageId: string;
  readonly command: string | null;
  readonly disposition: string;
  readonly replayed: boolean;
}

export interface ConsentCommandResponseInput {
  /** The ALREADY-VERIFIED, ALREADY-PARSED Meta payload. This service verifies nothing. */
  readonly payload: Record<string, unknown>;
  /** The whole-payload webhook receipt id D1-B obtained, when it did. */
  readonly webhookReceiptId: string | null;
  /** D1-B's durably-persisted items (the SUCCESSFUL persistence result). */
  readonly persisted: readonly AckPersistedItem[];
  /** D2-E's COMPLETED per-item command results. For STOP/START the writer result already exists. */
  readonly commands: readonly AckCommandItem[];
}

// ----------------------------------------------------------------------------
// Public output — sanitized; never a phone, payload, provider error or consent row
// ----------------------------------------------------------------------------
export type AckItemOutcome =
  | "sent"
  | "not_a_command"
  | "ineligible_disposition"
  | "replayed"
  | "invalid_evidence"
  | "destination_mismatch"
  | "provider_message_mismatch"
  | "unsupported_channel"
  | "suppressed"
  | "authority_unavailable"
  | "enforcement_invalid"
  | "send_failed";

export interface AckItemResult {
  readonly inboundMessageId: string;
  readonly ackType: string | null;
  readonly outcome: AckItemOutcome;
}

export interface ConsentCommandResponseResult {
  readonly candidates: number;
  readonly attempted: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
  readonly items: readonly AckItemResult[];
}

/** ALWAYS `ok: true`. Acknowledgement is BEST-EFFORT: it can never fail the inbound command flow. */
export interface ConsentCommandResponseOutcome {
  readonly ok: true;
  readonly result: ConsentCommandResponseResult;
}

// ----------------------------------------------------------------------------
// Injectable collaborators — production binds D2-C and the runtime factory
// ----------------------------------------------------------------------------
export interface ConsentCommandResponseDeps {
  /** The SOLE consent decision authority. Never bypassed, never re-implemented. */
  readonly decide: typeof decideCommunicationConsent;
  /** The PRODUCTION construction boundary. The one-shot enforcer is injected THROUGH it. */
  readonly createService: (enforcer: OutboundConsentEnforcer) => ReturnType<typeof createRuntimeCommunicationService>;
}

export function defaultConsentCommandResponseDeps(): ConsentCommandResponseDeps {
  return {
    decide: (input, deps) => decideCommunicationConsent(input, deps),
    // The existing runtime factory, with the ONE-SHOT enforcer substituted for the ordinary D3-B one.
    // Every provider, runtime, approved-template, mapping and canary gate stays exactly as it is.
    createService: (enforcer) => createRuntimeCommunicationService(process.env, undefined, enforcer),
  };
}

// ----------------------------------------------------------------------------
// THE ONE-SHOT, EVIDENCE-BOUND ENFORCER  (private to this module — never exported)
// ----------------------------------------------------------------------------
const invalid = (): OutboundConsentOutcome => ({ kind: "invalid", code: "CONSENT_ENFORCEMENT_INVALID", retryable: false });
const denied = (): OutboundConsentOutcome => ({ kind: "deny", code: "CONSENT_SUPPRESSED", retryable: false });
const unavailable = (): OutboundConsentOutcome => ({ kind: "unavailable", code: "CONSENT_AUTHORITY_UNAVAILABLE", retryable: true });

/**
 * Authorizes EXACTLY ONE outbound message, and only the one the plan describes.
 *
 * It is ONE-USE: the second call fails closed, so a compromised or buggy caller cannot reuse a single
 * validated command to authorize a stream of sends. Every field of the enforcement input is compared to the
 * approved plan — channel, message type, template key, lane, destination hash, destination source and the
 * neutral recipient shape. Any mismatch is a closed `invalid`.
 *
 * Only AFTER that binding passes does it consult D2-C, with the fixed, non-negotiable identity:
 *   channel: whatsapp · scope: authentication · identityConfidence: unknown · principal: null
 * `authentication` is the ONLY scope D2-C evaluates against GLOBAL suppression alone — which is exactly the
 * rule a user-solicited command response needs. A global suppression (hard bounce, complaint, legal,
 * provider block) still BLOCKS the acknowledgement, as it must.
 */
function createOneShotAckEnforcer(
  plan: ConsentAckPlan,
  deps: ConsentCommandResponseDeps
): OutboundConsentEnforcer {
  let used = false;

  return {
    async authorize(input: OutboundConsentEnforcementInput): Promise<OutboundConsentOutcome> {
      // ONE-USE. A second authorization attempt can never succeed.
      if (used) return invalid();
      used = true;

      if (!input) return invalid();
      // EXACT binding to the approved plan. Nothing here is caller-selectable.
      if (input.channel !== plan.channel) return invalid();
      if (input.messageType !== plan.ackType) return invalid();
      if (input.templateKey !== plan.templateKey) return invalid();
      if (input.lane !== plan.lane) return invalid();
      if (input.destinationHash !== plan.destinationHash) return invalid();
      if (input.destinationSource !== plan.destinationSource) return invalid();
      if (input.recipientType !== plan.recipientType) return invalid();
      if (input.recipientId !== null) return invalid();     // never an exact principal

      // D2-C — the sole authority. This module never reads a consent table and never interprets a row.
      let decision;
      try {
        decision = await deps.decide({
          channel: ACK_CHANNEL,
          scope: "authentication",       // global-suppression-only semantics (see the header)
          destinationHash: plan.destinationHash,
          identityConfidence: "unknown", // NEVER upgraded from an inbound principal id
          principal: null,
        });
      } catch {
        return unavailable();            // infrastructure, never a decision
      }

      if (!decision.ok) {
        // Fail closed. A lookup failure is retryable infrastructure; everything else is untrustworthy.
        if (decision.code === "AUTHORITY_LOOKUP_FAILED") return unavailable();
        return invalid();                // integrity violation / invalid input / anything unexpected
      }

      if (decision.disposition === "blocked") return denied();                 // global suppression
      if (decision.disposition === "no_consent_objection") {
        return { kind: "allow", scope: "authentication" };
      }
      return invalid();                  // unknown / marketing_opted_in / any future disposition
    },
  };
}

// ----------------------------------------------------------------------------
// The orchestration
// ----------------------------------------------------------------------------
const REJECT_TO_OUTCOME: Readonly<Record<AckRejectReasonValue, AckItemOutcome>> = Object.freeze({
  NOT_A_COMMAND: "not_a_command",
  INELIGIBLE_DISPOSITION: "ineligible_disposition",
  REPLAYED_COMMAND: "replayed",
  INVALID_EVIDENCE: "invalid_evidence",
  DESTINATION_HASH_MISMATCH: "destination_mismatch",
  PROVIDER_MESSAGE_MISMATCH: "provider_message_mismatch",
  UNSUPPORTED_CHANNEL: "unsupported_channel",
});

const isAckCommand = (v: unknown): v is AckCommand => v === "stop" || v === "start" || v === "help";

/**
 * Attempt at most ONE acknowledgement per inbound command. BEST-EFFORT: it always returns `ok: true`, so a
 * failure here can never turn a successful consent command into a webhook error.
 */
export async function processConsentCommandResponses(
  input: ConsentCommandResponseInput,
  deps: ConsentCommandResponseDeps = defaultConsentCommandResponseDeps()
): Promise<ConsentCommandResponseOutcome> {
  const items: AckItemResult[] = [];
  let attempted = 0;
  let sent = 0;
  let failed = 0;

  const commands = Array.isArray(input?.commands) ? input.commands : [];
  const persisted = Array.isArray(input?.persisted) ? input.persisted : [];

  // Re-derive the sender destination IN REQUEST MEMORY, from the already-verified payload, using the SAME
  // pure normalizer D1-B used. `senderPhoneE164` is a request-memory-only sibling: it is never persisted,
  // never logged and never returned. This is why D1-B's privacy contract needs no change.
  const normalized = normalizeMetaInboundWebhook(input?.payload ?? {});
  const plaintextByWamid = new Map<string, string>();
  for (const n of normalized) {
    if (n.ok) plaintextByWamid.set(n.message.providerMessageId, n.senderPhoneE164);
  }
  const persistedById = new Map<string, AckPersistedItem>();
  for (const p of persisted) {
    if (p?.receipt?.inboundMessageId) persistedById.set(p.receipt.inboundMessageId, p);
  }

  for (const cmd of commands) {
    // Only a real STOP/START/HELP is ever answered. Unsupported text and non-text never reach the plan.
    if (!isAckCommand(cmd?.command)) continue;

    const inboundMessageId = typeof cmd.inboundMessageId === "string" ? cmd.inboundMessageId : "";
    const item = persistedById.get(inboundMessageId);
    const push = (ackType: string | null, outcome: AckItemOutcome): void => {
      items.push({ inboundMessageId, ackType, outcome });
    };

    if (!item) { push(null, "invalid_evidence"); failed++; continue; }

    const evidence: ConsentCommandEvidence = {
      inboundMessageId,
      webhookReceiptId: input.webhookReceiptId ?? null,
      provider: item.receipt.provider,
      // The CANONICAL provider identity D2-E gave D2-D (the sha256 digest), not the raw wamid.
      providerMessageId: item.receipt.providerMessageId,
      channel: ACK_CHANNEL,
      destinationHash: item.receipt.destinationHash,
      command: cmd.command,
      disposition: cmd.disposition,
      replayed: cmd.replayed,
      receivedAt: item.receipt.receivedAt,
    };

    // The plaintext is needed ONLY to address the send. Its hash MUST equal the persisted hash.
    const plaintext = plaintextByWamid.get(item.message.providerMessageId);
    let observedHash = "";
    if (typeof plaintext === "string" && plaintext !== "") {
      try { observedHash = hashPhoneE164(plaintext); } catch { observedHash = ""; }
    }

    const planned = deriveConsentAckPlan(evidence, {
      destinationHash: observedHash,
      providerMessageId: item.receipt.providerMessageId,
    });
    if (!planned.ok) {
      push(null, REJECT_TO_OUTCOME[planned.reason]);
      continue;
    }
    const plan = planned.plan;

    // ── AUTHORIZE + SEND ───────────────────────────────────────────────────────────────────────────
    attempted++;
    const outcome = await sendAcknowledgement(plan, plaintext as string, deps);
    push(plan.ackType, outcome);
    if (outcome === "sent") sent++;
    else failed++;
  }

  const skipped = items.length - attempted;
  return {
    ok: true,
    result: { candidates: items.length, attempted, sent, skipped, failed, items },
  };
}

/**
 * Build the ONE immediate acknowledgement intent and send it through the ORDINARY CommunicationService
 * path, with the one-shot enforcer substituted. Every provider, runtime, approved-template, mapping and
 * canary gate remains active. A missing template or absent provider fails closed WITHOUT touching consent.
 */
async function sendAcknowledgement(
  plan: ConsentAckPlan,
  plaintextDestination: string,
  deps: ConsentCommandResponseDeps
): Promise<AckItemOutcome> {
  const intent: CommunicationIntent = {
    type: plan.ackType,
    lane: ACK_LANE,
    channel: ACK_CHANNEL,
    // A NEUTRAL recipient. An inbound command sender is never claimed as a client/vendor/admin identity.
    recipient_type: ACK_RECIPIENT_TYPE,
    recipient_id: null,
    // The plaintext lives in REQUEST MEMORY only. The ledger stores its hash + mask, never the number.
    destination_source: ephemeralAuthDestination(plaintextDestination),
    template_key: plan.templateKey,
    variables: {},                 // no variables at all — the copy is fixed and reviewed
    entity_type: null,
    entity_id: null,
    correlation_id: null,
    idempotency_key: plan.idempotencyKey, // the rate-limit fence: the ledger's UNIQUE key enforces it
    priority: "high",
    scheduled_at: null,            // NEVER scheduled (an ephemeral destination cannot be, by construction)
    policy_decision_id: null,      // Phase-4 policy engine field — never reused for consent
    metadata: sanitizedAckMetadata(plan),
  };

  const service = deps.createService(createOneShotAckEnforcer(plan, deps));
  if (!service.ok) return "send_failed";  // no provider configured → fail closed, consent untouched

  let result;
  try {
    result = await service.data.send(intent);
  } catch {
    return "send_failed";                 // never rethrown: acknowledgement is non-authoritative
  }
  if (!result.ok) return mapSendFailure(result.code);

  // `accepted`/`sent` — anything the provider did NOT definitively accept is simply not "sent". Either way
  // the consent command is untouched.
  const status = result.data.status;
  return status === "accepted" || status === "sent" || status === "delivered" || status === "read"
    ? "sent"
    : "send_failed";
}

/** Map the CommunicationService failure to a CLOSED outcome. No raw error, code detail or row leaks. */
function mapSendFailure(code: string): AckItemOutcome {
  if (code === "CONSENT_SUPPRESSED") return "suppressed";
  if (code === "CONSENT_AUTHORITY_UNAVAILABLE") return "authority_unavailable";
  if (code === "CONSENT_ENFORCEMENT_INVALID" || code === "CONSENT_AUTHORITY_INTEGRITY") return "enforcement_invalid";
  return "send_failed";
}

/**
 * The SANITIZED metadata persisted with the acknowledgement row. It records the exact provider-event
 * identity the acknowledgement answers — which the rate-limit key deliberately does not carry — plus the
 * durable inbound linkage. It contains NO plaintext destination, NO destination hash, NO raw payload, NO
 * consent row and NO provider secret.
 */
function sanitizedAckMetadata(plan: ConsentAckPlan): Record<string, unknown> {
  return {
    consent_command_response: true,
    ack_type: plan.ackType,
    command: plan.evidence.command,
    disposition: plan.evidence.disposition,
    provider: plan.evidence.provider,
    provider_message_id: plan.evidence.providerMessageId, // the sha256 digest — never the raw wamid
    inbound_message_id: plan.evidence.inboundMessageId,
    webhook_receipt_id: plan.evidence.webhookReceiptId,
  };
}

/** The three acknowledgement types, re-exported for boundary tests. They are NOT in the D3-B registry. */
export const ACK_MESSAGE_TYPES = CONSENT_ACK_TYPES;
export { ACK_DESTINATION_SOURCE };
