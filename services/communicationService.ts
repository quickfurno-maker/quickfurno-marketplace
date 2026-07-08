// ============================================================================
// QuickFurno — services/communicationService.ts   (server-only)
//
// Core Communication Service implementing the Unified Communication Core logic.
// Enforces lane rules, security sanitization, safe status transitions, retries,
// and webhook processing.
//
// DESIGN INVARIANTS
//   • No plaintext destination is ever persisted. Destinations are resolved from
//     the durable recipient reference by a CommunicationRecipientResolver at
//     dispatch time, which is what makes scheduled/retry delivery restart-safe.
//   • No provider literal appears here. Everything reads `provider.providerKey`,
//     so a real adapter drops in without touching business logic.
//   • The database unique constraints are the final authority on idempotency and
//     webhook de-duplication; the SELECT-then-INSERT pre-check is only a fast
//     path, and a 23505 conflict is a normal, successful outcome.
//   • The authentication lane never retries, never dead-letters, and never
//     persists its variables (they carry the OTP).
// ============================================================================

import crypto from "crypto";
import { adminClient } from "../lib/supabase";
import { AppError, appError, fail, ok, type Result } from "../lib/errors";
import {
  isForbiddenSecurityMetadataKey,
  sanitizeAuthSecurityMetadata,
} from "../lib/identity/authSecurityEvent";
import {
  hashPhoneE164,
  maskPhoneE164,
  normalizePhoneE164,
  phoneNormalizationError,
} from "../lib/communication/phone";
import { isUniqueViolationError, isUniqueViolationOn } from "../lib/communication/dbErrors";
import type { CommunicationRecipientResolver } from "../lib/communication/recipientResolver";
import {
  getActiveRecipientResolver,
} from "./communicationRecipientResolver";
import { RECIPIENT_REFERENCE_DESTINATION } from "../lib/communication/types";
import type {
  CommunicationIntent,
  CommunicationMessage,
  CommunicationMessageStatus,
  CommunicationNormalizedEventType,
  CommunicationTemplate,
  CommunicationWebhookProcessingStatus,
  CommunicationWebhookReceipt,
} from "../lib/communication/types";
import type {
  WhatsAppProvider,
  WhatsAppSendResult,
  WhatsAppWebhookEvent,
} from "../lib/communication/providers/whatsappProvider";
import { normalizeProviderException } from "../lib/communication/providers/providerError";
import { MockWhatsAppProvider } from "../lib/communication/providers/mockWhatsAppProvider";

// The canonical destination helpers live in lib/communication/phone.ts; these
// aliases keep the historical service-level names available to callers.
export {
  hashPhoneE164 as hashDestination,
  maskPhoneE164 as maskDestination,
  normalizePhoneE164,
} from "../lib/communication/phone";

// ----------------------------------------------------------------------------
// Provider registry — provider-neutral switching, no literal ever hardcoded.
// ----------------------------------------------------------------------------
let activeWhatsAppProvider: WhatsAppProvider = new MockWhatsAppProvider();

export function getActiveWhatsAppProvider(): WhatsAppProvider {
  return activeWhatsAppProvider;
}

export function setActiveWhatsAppProvider(provider: WhatsAppProvider): void {
  activeWhatsAppProvider = provider;
}

/** The authentication lane is single-shot: one attempt, no asynchronous retry. */
export const AUTHENTICATION_MAX_ATTEMPTS = 1;
export const BUSINESS_MAX_ATTEMPTS = 5;

const RETRY_BASE_SECONDS = 10;
const RETRY_MAX_SECONDS = 3600;
const FAILURE_REASON_MAX_LENGTH = 500;

// ----------------------------------------------------------------------------
// Service error vocabulary
// ----------------------------------------------------------------------------
const COMMUNICATION_ERROR_MESSAGES = {
  TEMPLATE_NOT_FOUND_OR_INACTIVE: "The communication template does not exist or is inactive.",
  TEMPLATE_LANE_MISMATCH: "The communication template belongs to a different lane.",
  TEMPLATE_NOT_READY: "The communication template is not ready to be sent.",
  AUTH_LANE_SCHEDULING_UNSUPPORTED:
    "Authentication messages cannot be scheduled: their variables are never persisted.",
  AUTH_LANE_NOT_REDISPATCHABLE:
    "Authentication messages cannot be re-dispatched from stored state: the OTP is never persisted.",
  MESSAGE_INSERT_FAILED: "The communication message could not be written to the ledger.",
  MESSAGE_UPDATE_FAILED: "The communication message could not be updated.",
  MESSAGE_NOT_FOUND: "No communication message matches this reference.",
  MESSAGE_NOT_DISPATCHABLE: "The communication message is not in a dispatchable state.",
  MESSAGE_NOT_DUE: "The communication message is not due for dispatch yet.",
  MESSAGE_ALREADY_CLAIMED:
    "Another worker already claimed this message for dispatch; no communication was sent.",
  EPHEMERAL_DESTINATION_AUTH_LANE_ONLY:
    "An ephemeral destination may only be used by the authentication lane.",
  EPHEMERAL_DESTINATION_NOT_SCHEDULABLE:
    "An ephemeral destination is request-memory only and can never be scheduled.",
  EPHEMERAL_DESTINATION_NOT_REDISPATCHABLE:
    "An ephemeral destination is request-memory only and can never be re-dispatched from stored state.",
  DESTINATION_HASH_MISMATCH: "The supplied destination does not match the recorded destination hash.",
  RECIPIENT_DESTINATION_CHANGED:
    "The recipient destination changed after this message was queued; the message was not re-routed.",
  INVALID_STATE_TRANSITION: "The requested communication status transition is not allowed.",
  INVALID_WEBHOOK_SIGNATURE: "Webhook signature verification failed.",
  WEBHOOK_PAYLOAD_UNPARSEABLE: "Webhook body is not a JSON object.",
  WEBHOOK_RECEIPT_INSERT_FAILED: "The webhook receipt could not be written.",
} as const;

type CommunicationErrorCode = keyof typeof COMMUNICATION_ERROR_MESSAGES;

function commError(code: CommunicationErrorCode): AppError {
  return new AppError(code, COMMUNICATION_ERROR_MESSAGES[code]);
}

// ----------------------------------------------------------------------------
// Status state machine
// ----------------------------------------------------------------------------
/**
 * Forward-only lifecycle. Out-of-order provider webhooks are tolerated by
 * allowing forward jumps (accepted → delivered, accepted → read, sent → read),
 * while every backwards edge is rejected.
 *
 * `delivered → failed` is deliberately ABSENT: a message the provider confirmed
 * as delivered must never regress to failed on a late or duplicated event.
 */
const ALLOWED_TRANSITIONS: Record<CommunicationMessageStatus, CommunicationMessageStatus[]> = {
  queued: ["dispatching", "failed", "cancelled"],
  dispatching: ["accepted", "sent", "failed", "retry_scheduled", "dead_letter"],
  accepted: ["sent", "delivered", "read", "failed"],
  sent: ["delivered", "read", "failed"],
  delivered: ["read"],
  read: [],
  failed: ["retry_scheduled", "dead_letter", "cancelled"],
  retry_scheduled: ["dispatching", "failed", "dead_letter", "cancelled"],
  dead_letter: [],
  cancelled: [],
};

/**
 * Pure transition validator. A same-state transition is "valid" (a duplicate
 * webhook is safe) but callers should treat it as a no-op — see
 * {@link isSameStateTransition} — so timestamps are never rewritten.
 */
export function isValidTransition(
  from: CommunicationMessageStatus,
  to: CommunicationMessageStatus
): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

export function isSameStateTransition(
  from: CommunicationMessageStatus,
  to: CommunicationMessageStatus
): boolean {
  return from === to;
}

/** Timestamp column each terminal-ish lifecycle state stamps exactly once. */
const EVENT_TIMESTAMP_COLUMN: Record<CommunicationNormalizedEventType, string> = {
  accepted: "accepted_at",
  sent: "sent_at",
  delivered: "delivered_at",
  read: "read_at",
  failed: "failed_at",
};

function sanitizeFailureReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return reason.replace(/\s+/g, " ").trim().slice(0, FAILURE_REASON_MAX_LENGTH) || null;
}

/**
 * Reads a scalar out of provider metadata. An object or array coerces to
 * "[object Object]" under String(), which would silently corrupt failure_code.
 */
function readScalar(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Exponential backoff, capped, computed from the attempt just consumed. */
export function nextRetryDelaySeconds(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(RETRY_BASE_SECONDS * 2 ** exponent, RETRY_MAX_SECONDS);
}

// ----------------------------------------------------------------------------
// Dispatch + webhook result shapes
// ----------------------------------------------------------------------------
export interface DispatchOptions {
  /**
   * In-memory variables for this dispatch. REQUIRED for the authentication lane
   * (the OTP is never persisted, so it can only come from the caller's memory).
   * Omitted on retry/scheduled dispatch, where the persisted, already-sanitized
   * `message.variables` are used instead.
   */
  readonly rawVariables?: Record<string, string>;
  readonly providerTemplateName?: string | null;
  /**
   * Destination already resolved earlier in the same request (the initial send
   * path), avoiding a second lookup. It is verified against the persisted
   * `destination_hash` before use, so it can never redirect a message.
   */
  readonly preResolvedDestination?: string;
}

export interface WebhookProcessingOutcome {
  readonly receiptId: string | null;
  readonly processingStatus: CommunicationWebhookProcessingStatus;
  readonly duplicate: boolean;
  readonly eventsNormalized: number;
  readonly messagesUpdated: number;
  readonly deliveryEventsRecorded: number;
  readonly unmatchedEvents: number;
}

type EventApplication = "applied" | "ignored_transition" | "noop_same_state" | "unmatched";

export class CommunicationService {
  private readonly provider: WhatsAppProvider;
  private readonly recipientResolver: CommunicationRecipientResolver;

  constructor(
    provider: WhatsAppProvider = getActiveWhatsAppProvider(),
    recipientResolver: CommunicationRecipientResolver = getActiveRecipientResolver()
  ) {
    this.provider = provider;
    this.recipientResolver = recipientResolver;
  }

  // --------------------------------------------------------------------------
  // Enqueue + immediate send
  // --------------------------------------------------------------------------

  /**
   * Dispatches an authorized CommunicationIntent. The intent carries no
   * plaintext destination field — the recipient reference is resolved
   * server-side, unless the caller supplied a fenced ephemeral authentication
   * destination (first-time client OTP, before any client_accounts row exists).
   */
  async send(intent: CommunicationIntent): Promise<Result<CommunicationMessage>> {
    try {
      if (!intent.idempotency_key || !intent.template_key) {
        throw appError("VALIDATION");
      }

      const destinationSource = intent.destination_source ?? RECIPIENT_REFERENCE_DESTINATION;

      // Fence the ephemeral path before anything else touches the database.
      if (destinationSource.kind === "ephemeral_auth_destination") {
        if (intent.lane !== "authentication") {
          // Business communications must always go through the resolver.
          return fail(commError("EPHEMERAL_DESTINATION_AUTH_LANE_ONLY"));
        }
        if (intent.scheduled_at) {
          // The plaintext lives in request memory only; there is nothing to
          // dispatch from later, so scheduling is refused outright.
          return fail(commError("EPHEMERAL_DESTINATION_NOT_SCHEDULABLE"));
        }
      }

      const isScheduled = Boolean(intent.scheduled_at && new Date(intent.scheduled_at) > new Date());
      if (intent.lane === "authentication" && isScheduled) {
        // We cannot persist the OTP, so we could never dispatch it later.
        return fail(commError("AUTH_LANE_SCHEDULING_UNSUPPORTED"));
      }

      // Fast path: skip provider work when we already know this key was handled.
      // The unique constraint below remains the authority (see fix #12).
      const existing = await this.getMessageByIdempotencyKey(intent.idempotency_key);
      if (existing) return ok(existing);

      const template = await this.getTemplate(intent.template_key);
      if (!template || !template.is_active) {
        return fail(commError("TEMPLATE_NOT_FOUND_OR_INACTIVE"));
      }
      if (template.category !== intent.lane) {
        return fail(commError("TEMPLATE_LANE_MISMATCH"));
      }
      if (template.readiness_status === "draft" || template.readiness_status === "disabled") {
        return fail(commError("TEMPLATE_NOT_READY"));
      }

      // Establish the destination BEFORE writing the ledger row: an unresolvable
      // recipient must not leave a queued message that can never be delivered.
      let destination: string;
      if (destinationSource.kind === "ephemeral_auth_destination") {
        const normalized = normalizePhoneE164(destinationSource.destination);
        if (!normalized.ok) return fail(phoneNormalizationError(normalized.code));
        destination = normalized.e164;
      } else {
        const resolved = await this.recipientResolver.resolveDestination(
          intent.recipient_type,
          intent.recipient_id
        );
        if (!resolved.ok) return resolved;
        destination = resolved.data;
      }

      const sanitizedMetadata = sanitizeAuthSecurityMetadata(intent.metadata);
      // The authentication lane persists NO variables at all: `variables` carries
      // the OTP, and a redacted copy still tells an attacker the shape of it.
      const dbVariables =
        intent.lane === "authentication" ? {} : this.sanitizeVariables(intent.variables);

      const insertRow = {
        message_type: intent.type,
        lane: intent.lane,
        channel: intent.channel,
        recipient_type: intent.recipient_type,
        recipient_id: intent.recipient_id,
        destination_source: destinationSource.kind,
        // Only the hash and the mask are ever written. `destination` itself dies
        // with this request — for BOTH sources, identically.
        destination_hash: hashPhoneE164(destination),
        destination_masked: maskPhoneE164(destination),
        template_key: intent.template_key,
        entity_type: intent.entity_type,
        entity_id: intent.entity_id,
        correlation_id: intent.correlation_id,
        idempotency_key: intent.idempotency_key,
        policy_decision_id: intent.policy_decision_id,
        status: "queued" as const,
        priority: intent.priority,
        scheduled_at: intent.scheduled_at,
        attempt_count: 0,
        max_attempts:
          intent.lane === "authentication" ? AUTHENTICATION_MAX_ATTEMPTS : BUSINESS_MAX_ATTEMPTS,
        provider: this.provider.providerKey,
        variables: dbVariables,
        metadata: sanitizedMetadata,
      };

      const { data: dbMsg, error: insertError } = await adminClient()
        .from("communication_messages")
        .insert(insertRow)
        .select("*")
        .single();

      if (insertError) {
        // Concurrency-safe idempotency: a racing request won the insert. Return
        // ITS message and dispatch nothing — no duplicate send, no error.
        if (isUniqueViolationOn(insertError, "idempotency_key")) {
          const winner = await this.getMessageByIdempotencyKey(intent.idempotency_key);
          if (winner) return ok(winner);
        }
        throw insertError;
      }
      if (!dbMsg) throw commError("MESSAGE_INSERT_FAILED");

      const message = dbMsg as CommunicationMessage;

      // Scheduled for later: leave it queued. A worker calls
      // dispatchPersistedMessage() when it comes due, and the resolver recovers
      // the destination then — even after a process restart.
      if (isScheduled) return ok(message);

      return this.dispatchMessage(message, {
        rawVariables: intent.variables,
        providerTemplateName: template.provider_template_name,
        preResolvedDestination: destination,
      });
    } catch (e) {
      return fail(e);
    }
  }

  // --------------------------------------------------------------------------
  // Dispatch
  // --------------------------------------------------------------------------

  /**
   * Dispatches a persisted message that has come due — a scheduled send or a
   * retry. Everything needed is recovered from the ledger row plus the recipient
   * resolver, so this is safe to call from a fresh process.
   */
  async dispatchPersistedMessage(messageId: string): Promise<Result<CommunicationMessage>> {
    try {
      const message = await this.getMessageById(messageId);
      if (!message) return fail(commError("MESSAGE_NOT_FOUND"));

      // The OTP was never written down, so a stored auth message is undeliverable
      // by design. Fail loudly rather than send an empty template.
      if (message.lane === "authentication") {
        return fail(commError("AUTH_LANE_NOT_REDISPATCHABLE"));
      }
      // Defence in depth: the schema already constrains ephemeral rows to the
      // authentication lane, so this is unreachable — and stays unreachable.
      if (message.destination_source === "ephemeral_auth_destination") {
        return fail(commError("EPHEMERAL_DESTINATION_NOT_REDISPATCHABLE"));
      }
      if (message.status !== "queued" && message.status !== "retry_scheduled") {
        return fail(commError("MESSAGE_NOT_DISPATCHABLE"));
      }

      const now = Date.now();
      if (message.scheduled_at && new Date(message.scheduled_at).getTime() > now) {
        return fail(commError("MESSAGE_NOT_DUE"));
      }
      if (message.next_retry_at && new Date(message.next_retry_at).getTime() > now) {
        return fail(commError("MESSAGE_NOT_DUE"));
      }

      const template = message.template_key ? await this.getTemplate(message.template_key) : null;

      return await this.dispatchMessage(message, {
        providerTemplateName: template?.provider_template_name ?? null,
      });
    } catch (e) {
      return fail(e);
    }
  }

  /**
   * Executes one delivery attempt. Public so workers and tests can drive it.
   *
   * The message is CLAIMED with a compare-and-set before the provider is ever
   * touched, so two workers racing on the same row produce exactly one provider
   * invocation. Whatever the provider then does — return, reject, or throw — the
   * message always leaves `dispatching`.
   */
  async dispatchMessage(
    message: CommunicationMessage,
    options: DispatchOptions = {}
  ): Promise<Result<CommunicationMessage>> {
    try {
      if (message.lane === "authentication" && !options.rawVariables) {
        return fail(commError("AUTH_LANE_NOT_REDISPATCHABLE"));
      }

      const destinationResult = await this.resolveDispatchDestination(
        message,
        options.preResolvedDestination
      );
      if (!destinationResult.ok) {
        // Fail closed and leave an auditable reason. No fallback number, ever.
        await this.markMessageFailed(message, destinationResult.code, destinationResult.error);
        return destinationResult;
      }
      const destination = destinationResult.data;

      // Atomic claim. A loser here has sent nothing and must send nothing.
      const claim = await this.claimMessageForDispatch(message);
      if (!claim.ok) return claim;
      const claimed = claim.data;

      const currentAttempt = claimed.attempt_count + 1;
      const providerTemplate = options.providerTemplateName || claimed.template_key || "";

      try {
        const result = await this.invokeProvider(claimed, destination, providerTemplate, options);
        return result.accepted
          ? await this.recordDispatchSuccess(claimed, currentAttempt, result)
          : await this.recordDispatchFailure(claimed, currentAttempt, result);
      } catch (recordingError) {
        // We hold the claim and the outcome write failed. Surrender the claim as
        // `failed` rather than abandon the row in `dispatching`.
        await this.releaseClaimAsFailed(claimed);
        throw recordingError;
      }
    } catch (e) {
      return fail(e);
    }
  }

  /**
   * Compare-and-set dispatch claim: the UPDATE is constrained by both the message
   * id AND the status the caller believes it read. Exactly one concurrent worker
   * can match, so exactly one calls the provider — the database, not a read-then-
   * write in application code, is what serializes them.
   */
  private async claimMessageForDispatch(
    message: CommunicationMessage
  ): Promise<Result<CommunicationMessage>> {
    if (message.status === "dispatching") {
      // Same-state is "valid" for webhooks but must never re-claim a dispatch.
      return fail(commError("MESSAGE_ALREADY_CLAIMED"));
    }
    if (!isValidTransition(message.status, "dispatching")) {
      return fail(commError("INVALID_STATE_TRANSITION"));
    }

    const { data, error } = await adminClient()
      .from("communication_messages")
      .update({ status: "dispatching", updated_at: new Date().toISOString() })
      .eq("id", message.id)
      .eq("status", message.status)
      .select("*");

    if (error) throw error;

    const claimed = (data ?? []) as CommunicationMessage[];
    // Zero rows claimed: another worker moved the row between our read and our
    // write. Return a safe result — do NOT call the provider.
    if (claimed.length !== 1) return fail(commError("MESSAGE_ALREADY_CLAIMED"));
    return ok(claimed[0]);
  }

  /**
   * The single place the provider is invoked. A throwing adapter is folded into
   * the provider-neutral failure result so the ordinary lane rules apply, and no
   * provider-specific exception type leaks into this service.
   */
  private async invokeProvider(
    message: CommunicationMessage,
    destination: string,
    providerTemplate: string,
    options: DispatchOptions
  ): Promise<WhatsAppSendResult> {
    try {
      if (message.lane === "authentication") {
        // Sensitive variables travel to the provider call and nowhere else.
        return await this.provider.sendAuthenticationMessage(
          destination,
          providerTemplate,
          options.rawVariables as Record<string, string>
        );
      }
      // On a retry there are no in-memory variables — the persisted (already
      // sanitized) ones are the record of what this message is supposed to say.
      const variables = this.sanitizeVariables(options.rawVariables ?? message.variables ?? {});
      return await this.provider.sendTemplateMessage(destination, providerTemplate, variables);
    } catch (providerException) {
      // Never rethrow: an escaping exception would strand the claim.
      return normalizeProviderException(providerException, this.provider.providerKey);
    }
  }

  private async resolveDispatchDestination(
    message: CommunicationMessage,
    preResolvedDestination?: string
  ): Promise<Result<string>> {
    if (preResolvedDestination) {
      const normalized = normalizePhoneE164(preResolvedDestination);
      if (!normalized.ok) return fail(phoneNormalizationError(normalized.code));
      if (hashPhoneE164(normalized.e164) !== message.destination_hash) {
        return fail(commError("DESTINATION_HASH_MISMATCH"));
      }
      return ok(normalized.e164);
    }

    // Without a request-memory destination an ephemeral message is unrecoverable
    // by construction. Never fall through to the resolver for one.
    if (message.destination_source === "ephemeral_auth_destination") {
      return fail(commError("EPHEMERAL_DESTINATION_NOT_REDISPATCHABLE"));
    }

    const resolved = await this.recipientResolver.resolveDestination(
      message.recipient_type,
      message.recipient_id
    );
    if (!resolved.ok) return resolved;

    // The message was authorized for the destination recorded at enqueue time.
    // If the recipient's number changed since, do NOT silently re-route it.
    if (hashPhoneE164(resolved.data) !== message.destination_hash) {
      return fail(commError("RECIPIENT_DESTINATION_CHANGED"));
    }
    return resolved;
  }

  private async recordDispatchSuccess(
    message: CommunicationMessage,
    attemptCount: number,
    result: WhatsAppSendResult
  ): Promise<Result<CommunicationMessage>> {
    const nowIso = new Date().toISOString();
    // A provider that reports "sent" synchronously lands on sent; everything
    // else that was merely accepted stays accepted. `sent_at` is stamped only
    // when the normalized state actually becomes `sent` (review fix #7).
    const target: CommunicationMessageStatus = result.normalizedStatus === "sent" ? "sent" : "accepted";

    const updates: Record<string, unknown> = {
      status: target,
      provider: this.provider.providerKey,
      provider_message_id: result.providerMessageId,
      attempt_count: attemptCount,
      next_retry_at: null,
      failure_code: null,
      failure_reason_sanitized: null,
      accepted_at: message.accepted_at ?? nowIso,
      updated_at: nowIso,
    };
    if (target === "sent") updates.sent_at = nowIso;

    return this.applyMessageUpdate(message.id, updates);
  }

  private async recordDispatchFailure(
    message: CommunicationMessage,
    attemptCount: number,
    result: WhatsAppSendResult
  ): Promise<Result<CommunicationMessage>> {
    const nowIso = new Date().toISOString();

    // Authentication is a single-shot lane: it never schedules a retry and it
    // never dead-letters. Its first delivery failure is simply `failed`.
    const laneAllowsRetry = message.lane !== "authentication";
    const attemptsRemaining = attemptCount < message.max_attempts;

    let finalStatus: CommunicationMessageStatus;
    if (result.retryable && laneAllowsRetry && attemptsRemaining) {
      finalStatus = "retry_scheduled";
    } else if (result.retryable && laneAllowsRetry) {
      // Exhausted retryable asynchronous business message — this is the only
      // path that produces a dead letter.
      finalStatus = "dead_letter";
    } else {
      finalStatus = "failed";
    }

    const updates: Record<string, unknown> = {
      status: finalStatus,
      attempt_count: attemptCount,
      failure_code: result.errorCode,
      failure_reason_sanitized: sanitizeFailureReason(result.errorMessage),
      updated_at: nowIso,
    };

    if (finalStatus === "retry_scheduled") {
      updates.next_retry_at = new Date(
        Date.now() + nextRetryDelaySeconds(attemptCount) * 1000
      ).toISOString();
    } else {
      updates.next_retry_at = null;
      updates.failed_at = nowIso;
    }

    return this.applyMessageUpdate(message.id, updates);
  }

  /**
   * Terminal failure that never reached the provider (e.g. unresolvable
   * recipient). Compare-and-set on the status we read, so a worker whose
   * pre-flight failed can never clobber a row another worker already claimed.
   */
  private async markMessageFailed(
    message: CommunicationMessage,
    failureCode: string,
    failureReason: string
  ): Promise<void> {
    if (!isValidTransition(message.status, "failed")) return;
    const nowIso = new Date().toISOString();
    await adminClient()
      .from("communication_messages")
      .update({
        status: "failed",
        next_retry_at: null,
        failed_at: nowIso,
        failure_code: failureCode,
        failure_reason_sanitized: sanitizeFailureReason(failureReason),
        updated_at: nowIso,
      })
      .eq("id", message.id)
      .eq("status", message.status);
  }

  /**
   * Last-resort release of a held claim when the outcome write itself failed.
   * Best-effort and constrained to `dispatching`, so it can only ever free a row
   * this worker is still holding. Swallows its own errors — the original error is
   * the one worth surfacing.
   */
  private async releaseClaimAsFailed(claimed: CommunicationMessage): Promise<void> {
    const nowIso = new Date().toISOString();
    try {
      await adminClient()
        .from("communication_messages")
        .update({
          status: "failed",
          next_retry_at: null,
          failed_at: nowIso,
          failure_code: "DISPATCH_RECORDING_FAILED",
          failure_reason_sanitized: "The dispatch outcome could not be recorded.",
          updated_at: nowIso,
        })
        .eq("id", claimed.id)
        .eq("status", "dispatching");
    } catch {
      /* best effort — never mask the original failure */
    }
  }

  private async applyMessageUpdate(
    messageId: string,
    updates: Record<string, unknown>
  ): Promise<Result<CommunicationMessage>> {
    const { data, error } = await adminClient()
      .from("communication_messages")
      .update(updates)
      .eq("id", messageId)
      .select("*")
      .single();

    if (error) throw error;
    if (!data) throw commError("MESSAGE_UPDATE_FAILED");
    return ok(data as CommunicationMessage);
  }

  // --------------------------------------------------------------------------
  // Webhooks
  // --------------------------------------------------------------------------

  /**
   * Processes an inbound provider webhook.
   *
   * `rawBody` is the exact bytes the provider signed — never a re-serialized
   * object, whose key order would change both the signature check and the
   * payload hash.
   *
   * De-duplication is enforced by the receipt table's unique indexes rather than
   * by a racy pre-check: a redelivery increments `duplicate_count` on the row
   * that already exists and returns idempotent success, creating no second
   * receipt, no second delivery event, and no second state change.
   */
  async processWebhook(
    rawBody: string,
    signature: string,
    secret: string
  ): Promise<Result<WebhookProcessingOutcome>> {
    try {
      const providerKey = this.provider.providerKey;
      const payloadHash = crypto.createHash("sha256").update(rawBody ?? "").digest("hex");

      const signatureValid = this.provider.verifyWebhookSignature(rawBody, signature, secret);
      if (!signatureValid) {
        // Recorded for admin monitoring. Rejected receipts occupy a SEPARATE
        // partial unique index, so a forged body can never poison the payload
        // hash slot of a legitimate one.
        await this.recordReceipt({
          provider: providerKey,
          provider_event_id: null,
          payload_hash: payloadHash,
          signature_valid: false,
          processing_status: "rejected",
          failure_reason_sanitized: "INVALID_WEBHOOK_SIGNATURE",
        });
        return fail(commError("INVALID_WEBHOOK_SIGNATURE"));
      }

      const payload = parseWebhookBody(rawBody);
      if (!payload) {
        await this.recordReceipt({
          provider: providerKey,
          provider_event_id: null,
          payload_hash: payloadHash,
          signature_valid: true,
          processing_status: "failed",
          failure_reason_sanitized: "WEBHOOK_PAYLOAD_UNPARSEABLE",
        });
        return fail(commError("WEBHOOK_PAYLOAD_UNPARSEABLE"));
      }

      const providerEventId = this.provider.deriveWebhookEventId(payload);

      const { receipt, duplicate } = await this.recordReceipt({
        provider: providerKey,
        provider_event_id: providerEventId,
        payload_hash: payloadHash,
        signature_valid: true,
        processing_status: "verified",
      });

      if (duplicate) {
        // Idempotent success: the provider stops redelivering, and nothing in the
        // ledger moves a second time.
        return ok({
          receiptId: receipt?.id ?? null,
          processingStatus: "duplicate",
          duplicate: true,
          eventsNormalized: 0,
          messagesUpdated: 0,
          deliveryEventsRecorded: 0,
          unmatchedEvents: 0,
        });
      }

      const events = this.provider.normalizeWebhook(payload);

      if (events.length === 0) {
        // Unknown status, missing message id, or missing timestamp. The adapter
        // refused to guess, so no message is touched — never "delivered".
        await this.finalizeReceipt(receipt, {
          processing_status: "rejected",
          failure_reason_sanitized: "UNSUPPORTED_OR_INCOMPLETE_WEBHOOK_EVENT",
        });
        return ok({
          receiptId: receipt?.id ?? null,
          processingStatus: "rejected",
          duplicate: false,
          eventsNormalized: 0,
          messagesUpdated: 0,
          deliveryEventsRecorded: 0,
          unmatchedEvents: 0,
        });
      }

      let messagesUpdated = 0;
      let deliveryEventsRecorded = 0;
      let unmatchedEvents = 0;

      try {
        for (const event of events) {
          const { application, deliveryEventRecorded } = await this.applyWebhookEvent(event);
          if (application === "applied") messagesUpdated += 1;
          if (application === "unmatched") unmatchedEvents += 1;
          if (deliveryEventRecorded) deliveryEventsRecorded += 1;
        }
      } catch (applyError) {
        // The receipt already occupies its de-duplication slot, so a redelivery
        // would be swallowed as a duplicate. Mark it `failed` so an operator can
        // see — and replay — the payload that never finished processing.
        await this.finalizeReceipt(receipt, {
          processing_status: "failed",
          failure_reason_sanitized: sanitizeFailureReason(
            applyError instanceof Error ? applyError.message : "WEBHOOK_APPLY_FAILED"
          ),
        });
        throw applyError;
      }

      await this.finalizeReceipt(receipt, {
        processing_status: "processed",
        normalized_event_type: events[0].normalizedEventType,
      });

      return ok({
        receiptId: receipt?.id ?? null,
        processingStatus: "processed",
        duplicate: false,
        eventsNormalized: events.length,
        messagesUpdated,
        deliveryEventsRecorded,
        unmatchedEvents,
      });
    } catch (e) {
      return fail(e);
    }
  }

  /**
   * Applies one normalized event: advances the message if — and only if — the
   * transition is a legal forward step, then appends the immutable trace row.
   */
  private async applyWebhookEvent(
    event: WhatsAppWebhookEvent
  ): Promise<{ application: EventApplication; deliveryEventRecorded: boolean }> {
    const message = await this.getMessageByProviderMessageId(event.providerMessageId);
    if (!message) return { application: "unmatched", deliveryEventRecorded: false };

    let application: EventApplication;

    if (isSameStateTransition(message.status, event.normalizedEventType)) {
      // A duplicate same-state event must not rewrite the original timestamp.
      application = "noop_same_state";
    } else if (!isValidTransition(message.status, event.normalizedEventType)) {
      // Backwards or forbidden (e.g. delivered → failed): trace it, ignore it.
      application = "ignored_transition";
    } else {
      const nowIso = new Date().toISOString();
      const updates: Record<string, unknown> = {
        status: event.normalizedEventType,
        updated_at: nowIso,
      };
      updates[EVENT_TIMESTAMP_COLUMN[event.normalizedEventType]] = event.occurredAt;

      if (event.normalizedEventType === "failed") {
        updates.failure_code = readScalar(event.sanitizedMetadata.error_code) ?? "WEBHOOK_FAILED";
        updates.failure_reason_sanitized = sanitizeFailureReason(
          readScalar(event.sanitizedMetadata.error_message) ?? "Webhook reported delivery failure"
        );
      }

      const { error } = await adminClient()
        .from("communication_messages")
        .update(updates)
        .eq("id", message.id);
      if (error) throw error;

      application = "applied";
    }

    const deliveryEventRecorded = await this.insertDeliveryEvent(message.id, event);
    return { application, deliveryEventRecorded };
  }

  /** Append-only trace. A unique conflict means it was already recorded. */
  private async insertDeliveryEvent(
    messageId: string,
    event: WhatsAppWebhookEvent
  ): Promise<boolean> {
    const { error } = await adminClient()
      .from("communication_delivery_events")
      .insert({
        communication_message_id: messageId,
        provider: this.provider.providerKey,
        provider_event_id: event.providerEventId,
        normalized_event_type: event.normalizedEventType,
        provider_message_id: event.providerMessageId,
        occurred_at: event.occurredAt,
        sanitized_metadata: event.sanitizedMetadata,
      });

    if (!error) return true;
    if (isUniqueViolationError(error)) return false;
    throw error;
  }

  /**
   * Inserts a webhook receipt, letting the unique indexes decide what is a
   * duplicate. On conflict the existing receipt is returned and its best-effort
   * `duplicate_count` is bumped — no conflicting row is ever written.
   */
  private async recordReceipt(row: {
    provider: string;
    provider_event_id: string | null;
    payload_hash: string;
    signature_valid: boolean;
    processing_status: CommunicationWebhookProcessingStatus;
    failure_reason_sanitized?: string;
  }): Promise<{ receipt: CommunicationWebhookReceipt | null; duplicate: boolean }> {
    const { data, error } = await adminClient()
      .from("communication_webhook_receipts")
      .insert(row)
      .select("*")
      .single();

    if (!error && data) {
      return { receipt: data as CommunicationWebhookReceipt, duplicate: false };
    }

    if (error && isUniqueViolationError(error)) {
      const existing = await this.findExistingReceipt(row);
      if (existing) await this.incrementReceiptDuplicateCount(existing);
      return { receipt: existing, duplicate: true };
    }

    throw error ?? commError("WEBHOOK_RECEIPT_INSERT_FAILED");
  }

  /**
   * Locates the receipt a unique violation collided with. Both candidate columns
   * are queried with equality filters rather than an interpolated PostgREST `or=`
   * expression — a provider-supplied event id must never be spliced into filter
   * syntax, even after its signature has been verified.
   */
  private async findExistingReceipt(row: {
    provider: string;
    provider_event_id: string | null;
    payload_hash: string;
    signature_valid: boolean;
  }): Promise<CommunicationWebhookReceipt | null> {
    const scoped = () =>
      adminClient()
        .from("communication_webhook_receipts")
        .select("*")
        .eq("provider", row.provider)
        .eq("signature_valid", row.signature_valid);

    if (row.provider_event_id) {
      const byEvent = await scoped().eq("provider_event_id", row.provider_event_id).limit(1);
      const hit = ((byEvent.data ?? []) as CommunicationWebhookReceipt[])[0];
      if (hit) return hit;
    }

    const byPayload = await scoped().eq("payload_hash", row.payload_hash).limit(1);
    return ((byPayload.data ?? []) as CommunicationWebhookReceipt[])[0] ?? null;
  }

  /**
   * Best-effort monitoring counter. Two simultaneous redeliveries may record a
   * single increment; the value is diagnostic, never a correctness input.
   */
  private async incrementReceiptDuplicateCount(receipt: CommunicationWebhookReceipt): Promise<void> {
    await adminClient()
      .from("communication_webhook_receipts")
      .update({
        duplicate_count: (receipt.duplicate_count ?? 0) + 1,
        last_duplicate_at: new Date().toISOString(),
      })
      .eq("id", receipt.id);
  }

  private async finalizeReceipt(
    receipt: CommunicationWebhookReceipt | null,
    updates: Record<string, unknown>
  ): Promise<void> {
    if (!receipt) return;
    await adminClient()
      .from("communication_webhook_receipts")
      .update({ ...updates, processed_at: new Date().toISOString() })
      .eq("id", receipt.id);
  }

  // --------------------------------------------------------------------------
  // Persistence helpers
  // --------------------------------------------------------------------------

  private async getMessageById(id: string): Promise<CommunicationMessage | null> {
    const { data, error } = await adminClient()
      .from("communication_messages")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return data as CommunicationMessage;
  }

  private async getMessageByIdempotencyKey(key: string): Promise<CommunicationMessage | null> {
    const { data, error } = await adminClient()
      .from("communication_messages")
      .select("*")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (error || !data) return null;
    return data as CommunicationMessage;
  }

  /** Provider message ids are scoped to the provider that issued them. */
  private async getMessageByProviderMessageId(
    providerMessageId: string
  ): Promise<CommunicationMessage | null> {
    const { data, error } = await adminClient()
      .from("communication_messages")
      .select("*")
      .eq("provider", this.provider.providerKey)
      .eq("provider_message_id", providerMessageId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) return null;
    const rows = (data ?? []) as CommunicationMessage[];
    return rows[0] ?? null;
  }

  private async getTemplate(key: string): Promise<CommunicationTemplate | null> {
    const { data, error } = await adminClient()
      .from("communication_templates")
      .select("*")
      .eq("template_key", key)
      .maybeSingle();
    if (error || !data) return null;
    return data as CommunicationTemplate;
  }

  /**
   * Redacts secret-looking variable keys using the Phase 5A vocabulary — the one
   * definition of "forbidden key" in the codebase. No weaker local copy.
   */
  private sanitizeVariables(variables: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
      sanitized[key] = isForbiddenSecurityMetadataKey(key) ? "[REDACTED]" : value;
    }
    return sanitized;
  }
}

function parseWebhookBody(rawBody: string): Record<string, unknown> | null {
  if (typeof rawBody !== "string" || rawBody.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
