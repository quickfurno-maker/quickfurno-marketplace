// ============================================================================
// QuickFurno — services/consentAckWorkerService.ts   (Phase 5F-D4-C, server-only)
//
// THE CORE-OWNED WORKER that delivers durable consent-command acknowledgements.
//
// It is the ONLY thing that may send one. It claims an intent, OPENS the sealed destination, RE-EVALUATES
// D2-C, reserves THE SINGLE provider attempt, dispatches through the ordinary CommunicationService path, and
// terminalizes — purging the sealed destination in the same statement.
//
// AUTHORITY. QuickFurno Core is authoritative. D2-C remains the sole consent/suppression decision authority
// and is asked AGAIN, immediately before dispatch — an intent enqueued 14 minutes ago must not be sent if a
// global suppression landed 1 minute ago. n8n and Jarvis can neither authorize, own, retry nor schedule this
// path; a cron trigger may only ask this worker to run a bounded batch, and every decision is re-derived here.
//
// AT MOST ONE PROVIDER ATTEMPT. The provider is called ONLY if the compare-and-set reservation
// (claimed → dispatching, provider_attempt_count 0 → 1) succeeds. After it succeeds there is NO reclaim and
// NO automatic retry: a timeout, a throw or any ambiguous result becomes TERMINAL `uncertain`. A duplicate
// "you have been unsubscribed" is worse than a missing one.
//
// THE ONE-SHOT, EVIDENCE-BOUND ENFORCER lives here (private, never exported). The three acknowledgement types
// remain DELIBERATELY ABSENT from the ordinary D3-B registry, so `authorizeOutboundConsent` denies them as
// UNCLASSIFIED_MESSAGE_TYPE. The only authorizer that can pass one is bound 1:1 to a single validated intent.
//
// PRIVACY. The opened plaintext lives in worker memory for the duration of one send. It is never persisted,
// never logged, never returned, and never placed in an error. Results carry counts, ack types and closed
// outcome codes — never a phone, ciphertext, nonce, key id or destination hash.
// ============================================================================

import { adminClient } from "../lib/supabase";
import { hashPhoneE164, normalizePhoneE164 } from "../lib/communication/phone";
import { ephemeralAuthDestination, type CommunicationIntent } from "../lib/communication/types";
import {
  ACK_CLAIM_BATCH_MAX,
  canonicalAckAad,
  isValidAckAadFields,
  MAX_PROVIDER_ATTEMPTS,
  OUTCOME_TO_TERMINAL_STATUS,
  PROVIDER_ATTEMPT_TIMEOUT_MS,
  STALE_DISPATCH_RECOVERY_MS,
  type AckAadFields,
  type AckMaintenanceResult,
  type AckWorkerBatchResult,
  type AckWorkerItemResult,
  type AckWorkerOutcome,
} from "../lib/communication/consentAckIntent";
import { hashesEqual, openAckDestination } from "../lib/communication/consentAckDestinationSeal";
import {
  ACK_CHANNEL,
  ACK_LANE,
  ACK_RECIPIENT_TYPE,
  ackTemplateKeyFor,
  CONSENT_ACK_TYPES,
  type ConsentAckTypeValue,
} from "../lib/communication/consentCommandResponse";
import { decideCommunicationConsent } from "./communicationConsentDecisionService";
import type {
  OutboundConsentEnforcementInput,
  OutboundConsentEnforcer,
  OutboundConsentOutcome,
} from "./outboundConsentEnforcementService";
import { createRuntimeCommunicationService } from "./runtimeCommunicationService";

// ----------------------------------------------------------------------------
// The claimed row (exactly the columns the worker needs)
// ----------------------------------------------------------------------------
export interface ClaimedAckIntent {
  readonly id: string;
  readonly idempotency_key: string;
  readonly consent_command_receipt_id: string | null;
  readonly inbound_message_id: string;
  readonly ack_type: string;
  readonly command: string;
  readonly authoritative_disposition: string;
  readonly provider: string;
  readonly canonical_provider_message_hash: string;
  readonly destination_hash: string;
  readonly sealed_destination_ciphertext: string | null;
  readonly sealed_destination_nonce: string | null;
  readonly sealed_destination_auth_tag: string | null;
  readonly encryption_key_id: string | null;
  readonly aad_schema_version: number;
  readonly expires_at: string;
  readonly status: string;
  readonly locked_by: string | null;
  readonly provider_attempt_count: number;
}

export interface ConsentAckWorkerDeps {
  /** MAINTENANCE — terminalize EXPIRED pending/claimed intents and purge their sealed destination. */
  readonly expireIntents: () => Promise<number>;
  /**
   * MAINTENANCE — recover STALE `dispatching` intents (attempt already reserved, worker died) to TERMINAL
   * `uncertain`, purging the seal. Never back to pending/claimed; never a second provider attempt.
   */
  readonly recoverStaleDispatching: (staleAfterSeconds: number) => Promise<number>;
  readonly claim: (workerId: string, limit: number) => Promise<readonly ClaimedAckIntent[]>;
  /** Compare-and-set: claimed → dispatching AND provider_attempt_count 0 → 1. Only one worker can win. */
  readonly reserveAttempt: (intentId: string, workerId: string) => Promise<boolean>;
  readonly terminalize: (intentId: string, status: string, terminalCode: string) => Promise<boolean>;
  /** The SOLE consent decision authority. Never bypassed, never re-implemented. */
  readonly decide: typeof decideCommunicationConsent;
  /** The PRODUCTION construction boundary. The one-shot enforcer is injected THROUGH it. */
  readonly createService: (enforcer: OutboundConsentEnforcer) => ReturnType<typeof createRuntimeCommunicationService>;
  readonly now: () => Date;
  readonly env: NodeJS.ProcessEnv;
  /**
   * The BOUNDED wait for one provider attempt. Production is always PROVIDER_ATTEMPT_TIMEOUT_MS (60s); it is
   * injectable only so the timeout path can be exercised without a 60-second test. It can never be used to
   * grant a second attempt — the reservation has already been consumed by the time it matters.
   */
  readonly providerTimeoutMs: number;
}

export function defaultConsentAckWorkerDeps(): ConsentAckWorkerDeps {
  return {
    async expireIntents() {
      const db = adminClient();
      const { data, error } = await db.rpc("qf_expire_consent_ack_intents", { p_limit: 100 });
      if (error) throw error;
      return typeof data === "number" ? data : 0;
    },
    async recoverStaleDispatching(staleAfterSeconds) {
      const db = adminClient();
      const { data, error } = await db.rpc("qf_recover_stale_dispatching_consent_ack_intents", {
        // The SQL enforces its own >= 120s floor; we pass the reviewed 180s explicitly rather than relying
        // on a default, so the threshold is visible at the call site.
        p_stale_after: `${staleAfterSeconds} seconds`,
        p_limit: 100,
      });
      if (error) throw error;
      return typeof data === "number" ? data : 0;
    },
    async claim(workerId, limit) {
      const db = adminClient();
      const { data, error } = await db.rpc("qf_claim_consent_ack_intents", {
        p_worker_id: workerId,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as ClaimedAckIntent[];
    },
    async reserveAttempt(intentId, workerId) {
      const db = adminClient();
      const { data, error } = await db.rpc("qf_reserve_consent_ack_provider_attempt", {
        p_intent_id: intentId,
        p_worker_id: workerId,
      });
      if (error) throw error;
      return data === true;
    },
    async terminalize(intentId, status, terminalCode) {
      const db = adminClient();
      const { data, error } = await db.rpc("qf_terminalize_consent_ack_intent", {
        p_intent_id: intentId,
        p_status: status,
        p_terminal_code: terminalCode,
      });
      if (error) throw error;
      return data === true;
    },
    decide: (input, deps) => decideCommunicationConsent(input, deps),
    createService: (enforcer) => createRuntimeCommunicationService(process.env, undefined, enforcer),
    now: () => new Date(),
    env: process.env,
    providerTimeoutMs: PROVIDER_ATTEMPT_TIMEOUT_MS,
  };
}

// ----------------------------------------------------------------------------
// THE ONE-SHOT, EVIDENCE-BOUND ENFORCER  (private to this module — never exported)
// ----------------------------------------------------------------------------
const invalid = (): OutboundConsentOutcome => ({ kind: "invalid", code: "CONSENT_ENFORCEMENT_INVALID", retryable: false });
const denied = (): OutboundConsentOutcome => ({ kind: "deny", code: "CONSENT_SUPPRESSED", retryable: false });
const unavailable = (): OutboundConsentOutcome => ({ kind: "unavailable", code: "CONSENT_AUTHORITY_UNAVAILABLE", retryable: true });

/**
 * Authorizes EXACTLY ONE outbound message, and only the one this intent describes.
 *
 * ONE-USE: the second call fails closed, so a single validated intent can never authorize a stream of sends.
 * Every field of the enforcement input is compared to the intent — channel, message type, template key, lane,
 * destination hash, destination source, neutral recipient shape. Any mismatch is a closed `invalid`.
 *
 * Only AFTER that binding passes does it consult D2-C, with the fixed, non-negotiable identity:
 *   channel: whatsapp · scope: authentication · identityConfidence: unknown · principal: null
 * `authentication` is the ONLY scope D2-C evaluates against GLOBAL suppression alone — exactly the rule a
 * user-solicited command response needs. A global suppression (hard bounce, complaint, legal, provider block)
 * still BLOCKS the acknowledgement, as it must.
 */
function createOneShotAckEnforcer(
  intent: ClaimedAckIntent,
  deps: ConsentAckWorkerDeps
): OutboundConsentEnforcer {
  let used = false;

  return {
    async authorize(input: OutboundConsentEnforcementInput): Promise<OutboundConsentOutcome> {
      if (used) return invalid();
      used = true;

      if (!input) return invalid();
      if (input.channel !== ACK_CHANNEL) return invalid();
      if (input.messageType !== intent.ack_type) return invalid();
      if (input.templateKey !== ackTemplateKeyFor(intent.ack_type as ConsentAckTypeValue)) return invalid();
      if (input.lane !== ACK_LANE) return invalid();
      if (input.destinationHash !== intent.destination_hash) return invalid();
      if (input.destinationSource !== "ephemeral_auth_destination") return invalid();
      if (input.recipientType !== ACK_RECIPIENT_TYPE) return invalid();
      if (input.recipientId !== null) return invalid();   // never an exact principal

      // D2-C — the sole authority, RE-EVALUATED at dispatch time.
      let decision;
      try {
        decision = await deps.decide({
          channel: ACK_CHANNEL,
          scope: "authentication",        // global-suppression-only semantics (see the header)
          destinationHash: intent.destination_hash,
          identityConfidence: "unknown",  // NEVER upgraded from an inbound principal id
          principal: null,
        });
      } catch {
        return unavailable();             // infrastructure, never a decision
      }

      if (!decision.ok) {
        if (decision.code === "AUTHORITY_LOOKUP_FAILED") return unavailable();
        return invalid();                 // integrity violation / invalid input / anything unexpected
      }

      if (decision.disposition === "blocked") return denied();           // global suppression
      if (decision.disposition === "no_consent_objection") {
        return { kind: "allow", scope: "authentication" };
      }
      return invalid();                   // unknown / marketing_opted_in / any future disposition
    },
  };
}

// ----------------------------------------------------------------------------
// The batch
// ----------------------------------------------------------------------------
export interface ConsentAckWorkerOutcome {
  readonly ok: boolean;
  readonly result: AckWorkerBatchResult;
  readonly maintenance: AckMaintenanceResult;
}

/**
 * Run ONE bounded batch: MAINTENANCE first, then delivery.
 *
 *   1. terminalize EXPIRED pending/claimed intents (purging their seal);
 *   2. recover STALE dispatching intents to terminal `uncertain` (purging their seal);
 *   3. claim due pending / stale-claimed intents and deliver them.
 *
 * Maintenance runs FIRST so that a stale row can never be delivered, and so that the sealed destination of a
 * dead intent is purged at the earliest possible moment rather than lingering until someone notices. Neither
 * maintenance step can cause a provider call: expiry only touches pending/claimed rows, and recovery only
 * touches rows whose single attempt was ALREADY reserved.
 *
 * A maintenance failure FAILS THE BATCH CLOSED (`ok: false`, nothing claimed, nothing sent) — running
 * delivery on a table we could not sweep is exactly the situation that produces stale acknowledgements.
 * The error is sanitized; no row, hash, ciphertext, key id or SQLSTATE escapes.
 */
export async function processConsentAckIntents(
  options: { readonly workerId?: string; readonly limit?: number } = {},
  deps: ConsentAckWorkerDeps = defaultConsentAckWorkerDeps()
): Promise<ConsentAckWorkerOutcome> {
  const workerId = typeof options.workerId === "string" && options.workerId.trim() !== ""
    ? options.workerId.trim().slice(0, 64)
    : `qf-ack-worker-${process.pid}`;
  const limit = Math.min(Math.max(Number.isInteger(options.limit) ? (options.limit as number) : ACK_CLAIM_BATCH_MAX, 1), ACK_CLAIM_BATCH_MAX);

  // ── 1 + 2) MAINTENANCE ────────────────────────────────────────────────────────────────────────────────
  let maintenance: AckMaintenanceResult;
  try {
    const expired = await deps.expireIntents();
    const recoveredUncertain = await deps.recoverStaleDispatching(Math.floor(STALE_DISPATCH_RECOVERY_MS / 1000));
    maintenance = { expired, recoveredUncertain };
  } catch {
    return { ok: false, result: emptyBatch(), maintenance: { expired: 0, recoveredUncertain: 0 } };
  }

  // ── 3) DELIVERY ───────────────────────────────────────────────────────────────────────────────────────
  const items: AckWorkerItemResult[] = [];
  let claimed: readonly ClaimedAckIntent[] = [];
  try {
    claimed = await deps.claim(workerId, limit);
  } catch {
    return { ok: false, result: emptyBatch(), maintenance };   // nothing claimed, nothing to undo
  }

  for (const intent of claimed) {
    let outcome: AckWorkerOutcome;
    try {
      outcome = await deliverOne(intent, workerId, deps);
    } catch {
      // A throw AFTER the attempt was reserved is unknowable. Before it, nothing was sent.
      outcome = intent.provider_attempt_count >= MAX_PROVIDER_ATTEMPTS ? "uncertain" : "send_failed";
    }

    const terminal = OUTCOME_TO_TERMINAL_STATUS[outcome];
    if (terminal) {
      // Terminalize AND purge the sealed destination — one statement, always.
      try { await deps.terminalize(intent.id, terminal, outcome); } catch { /* swept later; never resent */ }
    }
    items.push({ intentId: intent.id, ackType: intent.ack_type, outcome });
  }

  return { ok: true, result: tally(claimed.length, items), maintenance };
}

/**
 * Deliver ONE intent. Every step before the reservation can fail freely — nothing has been sent. Every step
 * after it is at-most-once territory.
 */
async function deliverOne(
  intent: ClaimedAckIntent,
  workerId: string,
  deps: ConsentAckWorkerDeps
): Promise<AckWorkerOutcome> {
  // 1) Lease + state. The claim RPC already guarantees these; re-checking is defence in depth.
  if (intent.status !== "claimed") return "evidence_invalid";
  if (intent.locked_by !== workerId) return "evidence_invalid";
  if (intent.provider_attempt_count !== 0) return "evidence_invalid";

  // 2) EXPIRY. An expired acknowledgement is never sent — a late "your STOP was processed" is worse than
  //    silence. Checked BEFORE any crypto and long before any provider call.
  if (Date.parse(intent.expires_at) <= deps.now().getTime()) return "expired";

  // 3) The acknowledgement type must still be one of the three. A row outside the closed set is never sent.
  if (!(CONSENT_ACK_TYPES as readonly string[]).includes(intent.ack_type)) return "evidence_invalid";

  // 4) OPEN THE SEALED DESTINATION. The AAD is rebuilt from the ROW — so a ciphertext transplanted from any
  //    other intent, receipt, inbound message, provider event, destination or expiry FAILS to open.
  if (
    !intent.sealed_destination_ciphertext ||
    !intent.sealed_destination_nonce ||
    !intent.sealed_destination_auth_tag ||
    !intent.encryption_key_id
  ) {
    return "seal_failed";
  }

  const aadFields: AckAadFields = {
    schemaVersion: intent.aad_schema_version,
    intentId: intent.id,
    consentCommandReceiptId: intent.consent_command_receipt_id,
    inboundMessageId: intent.inbound_message_id,
    canonicalProviderMessageHash: intent.canonical_provider_message_hash,
    destinationHash: intent.destination_hash,
    ackType: intent.ack_type as ConsentAckTypeValue,
    expiresAt: intent.expires_at,
  };
  if (!isValidAckAadFields(aadFields)) return "evidence_invalid";

  // The AAD canonicalizes the expiry to an INSTANT, so Postgres's `timestamptz` rendering
  // (`+00:00`, microseconds) cannot change these bytes. An unparseable expiry fails closed.
  const aad = canonicalAckAad(aadFields);
  if (!aad) return "evidence_invalid";

  const opened = openAckDestination(
    {
      ciphertext: intent.sealed_destination_ciphertext,
      nonce: intent.sealed_destination_nonce,
      authTag: intent.sealed_destination_auth_tag,
      keyId: intent.encryption_key_id,
    },
    aad,
    deps.env
  );
  // Missing key, unknown key id, malformed envelope, AEAD failure, WRONG AAD — all fail closed. There is no
  // fallback destination, no recipient guess, no canonical-profile substitution.
  if (!opened.ok) return "seal_failed";

  // 5) CANONICALIZE + RE-HASH. The opened value must hash to EXACTLY the bound destination_hash, so a
  //    substituted destination can never be silently used.
  const normalized = normalizePhoneE164(opened.value);
  if (!normalized.ok) return "destination_mismatch";
  let observedHash: string;
  try {
    observedHash = hashPhoneE164(normalized.e164);
  } catch {
    return "destination_mismatch";
  }
  if (!hashesEqual(observedHash, intent.destination_hash)) return "destination_mismatch";

  // 6) RESERVE THE SINGLE PROVIDER ATTEMPT. The provider is NOT called unless this wins.
  let reserved = false;
  try {
    reserved = await deps.reserveAttempt(intent.id, workerId);
  } catch {
    return "send_failed";                  // reservation failed → nothing was sent
  }
  if (!reserved) return "attempt_not_reserved";  // another worker won; this one sends nothing and exits

  // ── AT-MOST-ONCE TERRITORY. From here, ambiguity is TERMINAL `uncertain`. ────────────────────────────
  const service = deps.createService(createOneShotAckEnforcer(intent, deps));
  if (!service.ok) return "send_failed";   // no provider configured → fail closed. Consent untouched.

  const intentToSend: CommunicationIntent = {
    type: intent.ack_type,
    lane: ACK_LANE,
    channel: ACK_CHANNEL,
    recipient_type: ACK_RECIPIENT_TYPE,    // neutral: an inbound sender is never claimed as a principal
    recipient_id: null,
    destination_source: ephemeralAuthDestination(normalized.e164),
    template_key: ackTemplateKeyFor(intent.ack_type as ConsentAckTypeValue),
    variables: {},                         // no variables at all — the copy is fixed and reviewed
    entity_type: null,
    entity_id: null,
    correlation_id: null,
    idempotency_key: intent.idempotency_key,
    priority: "high",
    scheduled_at: null,                    // NEVER scheduled
    policy_decision_id: null,
    metadata: sanitizedAckMetadata(intent),
  };

  // BOUNDED WAIT. The send is awaited through a 60-second timeout. On timeout the outcome is UNKNOWABLE, so
  // it becomes TERMINAL `uncertain`.
  //
  // HONEST LIMITATION: this does NOT cancel the underlying provider request — the existing
  // CommunicationService/provider path exposes no cancellation, so the HTTP call may still complete at Meta
  // after we stop waiting. At-most-once does not mean "the message definitely was not sent"; it means
  // QUICKFURNO NEVER ATTEMPTS IT AGAIN. `provider_attempt_count` is already 1, the row terminalizes
  // `uncertain`, and the claim RPC can never return it.
  let result;
  try {
    result = await withTimeout(service.data.send(intentToSend), deps.providerTimeoutMs);
  } catch {
    // A throw or a TIMEOUT after reservation. Either way the provider outcome is unknowable. NEVER retried.
    return "uncertain";
  }

  if (!result.ok) {
    // A CLOSED, definitive failure. The consent decision codes are known-not-sent, so they are safe to
    // classify precisely; anything else is a closed send failure. None of these is ever retried.
    if (result.code === "CONSENT_SUPPRESSED") return "suppressed";
    if (result.code === "CONSENT_AUTHORITY_UNAVAILABLE") return "authority_unavailable";
    if (result.code === "CONSENT_ENFORCEMENT_INVALID" || result.code === "CONSENT_AUTHORITY_INTEGRITY") {
      return "evidence_invalid";
    }
    return "send_failed";
  }

  const status = result.data.status;
  if (status === "accepted" || status === "sent" || status === "delivered" || status === "read") return "sent";
  // Persisted but not definitively accepted by the provider ⇒ the outcome is NOT known to be a non-send.
  return "uncertain";
}

/**
 * The SANITIZED metadata persisted with the acknowledgement message row. It records the provider-event
 * identity the acknowledgement answers plus the durable linkage. NO plaintext destination, NO destination
 * hash, NO ciphertext, NO key id, NO raw payload, NO consent row, NO provider secret.
 */
function sanitizedAckMetadata(intent: ClaimedAckIntent): Record<string, unknown> {
  return {
    consent_command_response: true,
    async_delivery: true,
    ack_intent_id: intent.id,
    ack_type: intent.ack_type,
    command: intent.command,
    disposition: intent.authoritative_disposition,
    provider: intent.provider,
    provider_message_id: intent.canonical_provider_message_hash, // the sha256 digest, never the raw wamid
    inbound_message_id: intent.inbound_message_id,
    consent_command_receipt_id: intent.consent_command_receipt_id,
  };
}

/**
 * Await a promise through a bounded timeout. Rejects with a closed marker on expiry.
 *
 * It does NOT cancel the underlying work — see the note at the call site. The provider request may therefore
 * still SETTLE after we have stopped waiting, so the losing promise is ALWAYS given a rejection observer:
 * a late rejection can never surface as an `unhandledRejection` and crash the worker. The late value or
 * error is observed and DISCARDED — it can never produce a retry, a second terminal transition, an allow,
 * or leak a provider error. The intent is already terminal `uncertain` by then.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  // Attach the observer to the ORIGINAL promise. This does not consume it: `Promise.race` below still sees
  // p's own settlement, so a send that wins the race resolves normally.
  p.catch(() => { /* late settlement after timeout: observed, discarded, never acted upon */ });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("PROVIDER_ATTEMPT_TIMEOUT")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function emptyBatch(): AckWorkerBatchResult {
  return { claimed: 0, sent: 0, suppressed: 0, expired: 0, failed: 0, uncertain: 0, items: [] };
}

function tally(claimed: number, items: readonly AckWorkerItemResult[]): AckWorkerBatchResult {
  let sent = 0, suppressed = 0, expired = 0, failed = 0, uncertain = 0;
  for (const i of items) {
    if (i.outcome === "sent") sent++;
    else if (i.outcome === "suppressed") suppressed++;
    else if (i.outcome === "expired") expired++;
    else if (i.outcome === "uncertain") uncertain++;
    else if (i.outcome !== "attempt_not_reserved") failed++;
  }
  return { claimed, sent, suppressed, expired, failed, uncertain, items };
}
