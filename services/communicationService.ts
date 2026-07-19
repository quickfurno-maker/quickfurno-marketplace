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
import { ACTIVE_DISPATCH_CHANNEL, RECIPIENT_REFERENCE_DESTINATION } from "../lib/communication/types";
import type {
  CommunicationChannel,
  CommunicationIntent,
  CommunicationMessage,
  CommunicationMessageStatus,
  CommunicationNormalizedEventType,
  CommunicationTemplate,
  CommunicationWebhookProcessingStatus,
  CommunicationWebhookReceipt,
} from "../lib/communication/types";
import {
  CHANNEL_DISPATCH_ERROR,
  isChannelDispatchable,
  isTemplateChannelConsistent,
} from "../lib/communication/channelDispatchGuard";
import type {
  WhatsAppProvider,
  WhatsAppSendResult,
  WhatsAppWebhookEvent,
} from "../lib/communication/providers/whatsappProvider";
import { effectiveOutcomeCertainty } from "../lib/communication/providers/whatsappProvider";
import { supportsResolvedTemplate } from "../lib/communication/whatsappTemplate";
import type {
  OutboundConsentEnforcer,
  OutboundConsentOutcome,
} from "./outboundConsentEnforcementService";
import {
  createFailClosedOutboundConsentEnforcer,
  isOutboundConsentEnforcer,
  normalizeOutboundConsentOutcome,
  FAIL_CLOSED_CONSENT_OUTCOME,
} from "./outboundConsentEnforcementService";
import {
  OutboundPreparationReason,
  type ApprovedTemplateOutboundCoordinator,
} from "../lib/communication/approvedTemplateOutbound";
import {
  AUTH_NETWORK_DEADLINE_EXHAUSTED,
  AUTH_NETWORK_DEADLINE_MESSAGE,
  isViableAuthNetworkBudget,
  type AuthNetworkDeadline,
} from "../lib/auth/hookDeadline";
import { normalizeProviderException } from "../lib/communication/providers/providerError";
// Phase 8B-1B-B — the outbound provider-account attribution vocabulary. CommunicationService does NOT
// import the runtime service: the FROZEN Phase 8B-1B-A resolver arrives ONLY through the injected
// dependency (`resolveOwnership`), so this service never learns where ownership resolution lives.
import {
  ATTRIBUTION_FAILURE,
  attributionUnavailable,
  decideFromBinding,
  decideFromOwnership,
  isUsableAttributionDependency,
  type BindingOutcome,
  type OutboundAccountAttributionDependency,
  type OutboundAttributionDecision,
} from "../lib/communication/outboundProviderAccountAttribution";
import type { ProviderAccountOwnership } from "../lib/communication/providers/providerAccountOwnership";
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
//
// `setActiveWhatsAppProvider` is the EXPLICIT OVERRIDE used by tests and by any
// caller that injects an adapter. The runtime resolution boundary
// (`services/runtimeCommunicationService.ts`) honours the override first and only
// then consults `selectWhatsAppProvider`, so a test injection always wins and a
// missing override never silently becomes a Meta send. `getActiveWhatsAppProvider`
// keeps its historical default (mock) so `new CommunicationService()` is unchanged.
// No secret is read at module import time.
// ----------------------------------------------------------------------------
let whatsAppProviderOverride: WhatsAppProvider | null = null;
let defaultMockProvider: WhatsAppProvider | null = null;

export function getActiveWhatsAppProvider(): WhatsAppProvider {
  if (whatsAppProviderOverride) return whatsAppProviderOverride;
  return (defaultMockProvider ??= new MockWhatsAppProvider());
}

export function setActiveWhatsAppProvider(provider: WhatsAppProvider): void {
  whatsAppProviderOverride = provider;
}

/** The explicit override, or null when none was ever registered. */
export function getWhatsAppProviderOverride(): WhatsAppProvider | null {
  return whatsAppProviderOverride;
}

/** Clears the explicit override so runtime selection applies again. */
export function clearWhatsAppProviderOverride(): void {
  whatsAppProviderOverride = null;
}

/**
 * Ledger-safe message for every approved-mapping preparation failure. The specific
 * reason travels as the error CODE; no secret or provider payload is ever included.
 */
const OUTBOUND_PREPARATION_MESSAGE =
  "The approved provider template dispatch could not be prepared (runtime gate or approved mapping); no provider request was made.";

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
  UNSUPPORTED_DISPATCH_CHANNEL:
    "This communication channel is not dispatchable by the active provider; the message was not sent on another channel.",
  UNSUPPORTED_DISPATCH_PROVIDER:
    "This message is owned by a different provider and was not dispatched by the active provider.",
  TEMPLATE_CHANNEL_MISMATCH:
    "The communication template channel does not match the requested channel.",
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
  // Phase 5F-D3-B — outbound consent enforcement. Sanitized and closed: none of these carries a
  // destination, a hash, a disposition, a matched row id, or a database error.
  CONSENT_SUPPRESSED: "An active suppression prohibits this communication; nothing was sent.",
  CONSENT_NOT_GRANTED: "Consent for this communication was not granted; nothing was sent.",
  UNCLASSIFIED_MESSAGE_TYPE: "This message type is not classified for consent; nothing was sent.",
  MESSAGE_TYPE_TEMPLATE_MISMATCH:
    "The message type and template do not form an approved pair; nothing was sent.",
  MESSAGE_LANE_SCOPE_MISMATCH: "The message lane does not match its approved consent scope; nothing was sent.",
  CONSENT_AUTHORITY_UNAVAILABLE: "The consent authority could not be evaluated; nothing was sent.",
  CONSENT_AUTHORITY_INTEGRITY: "The consent authority returned an untrustworthy result; nothing was sent.",
  CONSENT_ENFORCEMENT_INVALID: "The consent enforcement request was invalid; nothing was sent.",
  INVALID_WEBHOOK_SIGNATURE: "Webhook signature verification failed.",
  WEBHOOK_PAYLOAD_UNPARSEABLE: "Webhook body is not a JSON object.",
  WEBHOOK_RECEIPT_INSERT_FAILED: "The webhook receipt could not be written.",
  // Phase 8B-1B-B — a concurrent ownership/status change detected by the pre-network binding CAS.
  // No provider request occurred and the conflicting row is preserved untouched.
  PROVIDER_ACCOUNT_BIND_CONFLICT: "The message ownership state changed concurrently; nothing was dispatched.",
  PROVIDER_ACCOUNT_MISMATCH: "The message is already bound to a different provider account; nothing was dispatched.",
  // Phase 8B-1B-C — inbound/delivery binding. Sanitized: never an account id / phone / WABA / payload.
  PROVIDER_ACCOUNT_ATTRIBUTION_REQUIRED: "The provider account was not attributed to this callback; nothing was persisted.",
  WEBHOOK_PROVIDER_ACCOUNT_CONFLICT: "The webhook event is already bound to a different provider account; nothing was persisted.",
} as const;

type CommunicationErrorCode = keyof typeof COMMUNICATION_ERROR_MESSAGES;

function commError(code: CommunicationErrorCode): AppError {
  return new AppError(code, COMMUNICATION_ERROR_MESSAGES[code]);
}

/** Phase 8B-1B-C — a `communication_provider_accounts.id` shape (a plain UUID). No env, no lookup here. */
const PROVIDER_ACCOUNT_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  dispatching: ["accepted", "sent", "failed", "retry_scheduled", "dead_letter", "outcome_unknown"],
  accepted: ["sent", "delivered", "read", "failed"],
  sent: ["delivered", "read", "failed"],
  delivered: ["read"],
  read: [],
  failed: ["retry_scheduled", "dead_letter", "cancelled"],
  retry_scheduled: ["dispatching", "failed", "dead_letter", "cancelled"],
  dead_letter: [],
  cancelled: [],
  // A parked unknown outcome only moves FORWARD, and only via a later verified
  // provider webhook — never to retry_scheduled / dispatching / dead_letter.
  outcome_unknown: ["sent", "delivered", "read", "failed"],
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

/**
 * PHASE 5F-D3-B — the CLOSED ledger-channel → consent-channel map. PURE and total.
 *
 * `whatsapp` and `sms` are the only channels D3-B enforces consent for. Anything else — `rcs`, or any
 * future channel added to the ledger vocabulary — returns `null`, and the caller FAILS CLOSED. It is
 * never coerced to `whatsapp`: a channel we cannot ask D2-C about must not inherit another channel's
 * consent decision. Exported so the harness can prove the coercion is impossible.
 */
export function toEnforcementChannel(channel: string | null | undefined): "whatsapp" | "sms" | null {
  if (channel === "whatsapp") return "whatsapp";
  if (channel === "sms") return "sms";
  return null; // rcs / unknown / missing → NO consent channel → fail closed. Never WhatsApp.
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
  /**
   * The internal template language. Required by an approved-mapping adapter, which
   * re-resolves the pinned mapping at the network boundary on EVERY dispatch — the
   * initial send included. There is deliberately no in-memory resolved-descriptor
   * fast path: a descriptor prepared before the ledger insert could no longer be
   * trusted by the time the request is issued.
   */
  readonly templateLanguage?: string | null;
  /**
   * The enclosing request's total deadline (Supabase Auth Hook). When present, the
   * authentication-lane network timeout is clamped to the remaining safe budget, and
   * an already-spent budget fails locally with ZERO provider calls.
   */
  readonly authDeadline?: AuthNetworkDeadline;
}

/** Per-send options threaded from an enclosing, time-bounded request. */
export interface SendOptions {
  readonly authDeadline?: AuthNetworkDeadline;
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
  /**
   * Injected ONLY for an `approved_provider_mapping` adapter (Meta). The mock path
   * never touches it. Absent + approved-mapping adapter ⇒ fail closed.
   */
  private readonly approvedTemplateCoordinator: ApprovedTemplateOutboundCoordinator | null;
  /**
   * PHASE 8A — the outbound CONSENT ENFORCEMENT coordinator. NON-NULLABLE, and REQUIRED on the constructor.
   *
   * It was previously `| null = null`, and `enforceOutboundConsent` treated absence as "continue" — so a
   * direct construction that omitted it sent WITHOUT ANY CONSENT EVALUATION, silently and legally. That
   * fail-open branch is gone: this field always holds an enforcer, and if the caller supplies anything that
   * is not one, it holds the FAIL-CLOSED enforcer, which can only ever answer `unavailable`.
   *
   * This service NEVER interprets consent. It consumes only the coordinator's CLOSED outcome and never
   * sees a disposition, a preference row or a suppression row.
   */
  private readonly consentEnforcer: OutboundConsentEnforcer;

  /**
   * Phase 8B-1B-B — the coherent, NON-SECRET identity of the selected provider runtime, injected by
   * the production runtime factory from the SAME snapshot that built the adapter. `null` for mock
   * adapters (no attribution needed) and for explicit overrides (no coherent identity exists), in
   * which case an `approved_provider_mapping` dispatch fails closed before any provider call.
   */
  private readonly accountAttribution: OutboundAccountAttributionDependency | null;

  /**
   * `consentEnforcer` is REQUIRED (Phase 8A, layer 1 — TypeScript). Every construction must state its
   * consent posture explicitly: `new CommunicationService(provider)` no longer compiles. The earlier
   * parameters keep their defaults, so a caller that wants them passes `undefined` positionally.
   *
   * Layer 2 — RUNTIME — is the normalization below. TypeScript cannot reach plain JavaScript (every harness
   * is `.mjs`), `as any`, reflection, or a future unsafe call site, so a structurally invalid enforcer
   * (missing / null / undefined / primitive / array / no callable `authorize`) is replaced with the
   * fail-closed enforcer rather than trusted. Absence is never permission.
   */
  constructor(
    provider: WhatsAppProvider = getActiveWhatsAppProvider(),
    recipientResolver: CommunicationRecipientResolver = getActiveRecipientResolver(),
    approvedTemplateCoordinator: ApprovedTemplateOutboundCoordinator | null = null,
    consentEnforcer: OutboundConsentEnforcer,
    // Phase 8B-1B-B — the outbound provider-account ATTRIBUTION dependency. Optional at the
    // constructor so every historical mock construction stays source-compatible, but the RUNTIME
    // is closed: an `approved_provider_mapping` adapter with a missing/malformed dependency fails
    // closed at the network boundary with ZERO provider calls. Absence is never permission.
    accountAttribution: OutboundAccountAttributionDependency | null = null
  ) {
    this.provider = provider;
    this.recipientResolver = recipientResolver;
    this.approvedTemplateCoordinator = approvedTemplateCoordinator;
    this.consentEnforcer = isOutboundConsentEnforcer(consentEnforcer)
      ? consentEnforcer
      : createFailClosedOutboundConsentEnforcer();
    this.accountAttribution = isUsableAttributionDependency(accountAttribution) ? accountAttribution : null;
  }

  /** True when this adapter requires an approved provider mapping (capability, not a key). */
  private requiresApprovedMapping(): boolean {
    return this.provider.templateResolutionMode === "approved_provider_mapping";
  }

  /**
   * PHASE 8B-1B-B — a PRE-NETWORK attribution failure. No provider request occurred, so the outcome
   * is always `definitive_failure` (never `unknown_outcome`). `retryable` distinguishes an
   * INFRASTRUCTURE failure — the lookup or the binding write broke — which the EXISTING closed retry
   * authority in `recordDispatchFailure` may safely re-run (business lane, attempts remaining), from
   * a DEFINITIVE configuration/security failure. Authentication stays single-shot either way.
   * The message is a sanitized, closed constant: it never carries an id, secret or raw driver error.
   */
  private attributionFailure(
    decision: Extract<OutboundAttributionDecision, { kind: "blocked" }>
  ): WhatsAppSendResult {
    return {
      accepted: false,
      provider: this.provider.providerKey,
      providerMessageId: null,
      normalizedStatus: "failed",
      errorCode: decision.code,
      errorMessage: decision.message,
      retryable: decision.retryable,
      outcomeCertainty: "definitive_failure",
    };
  }

  /**
   * PHASE 8B-1B-B — prove ownership of the sending identity and DURABLY BIND the exact account to
   * the claimed row. Returns `proceed` ONLY after the account is committed to the database.
   *
   * The identity is the injected, coherent runtime identity — never a fresh environment read, never
   * a default, never a readiness inference, never a positional row pick.
   */
  private async bindOutboundProviderAccount(
    message: CommunicationMessage
  ): Promise<OutboundAttributionDecision> {
    const dep = this.accountAttribution;
    // Absence is never permission: no coherent identity ⇒ no proof ⇒ no request.
    if (!isUsableAttributionDependency(dep)) return attributionUnavailable();

    // The resolver is fail-closed by construction, but an escaping exception here would strand the
    // claim and — worse — must never be mistaken for permission. Treat a throw as an INFRASTRUCTURE
    // lookup failure: zero provider calls, safe retry for the business lane.
    let ownership: ProviderAccountOwnership;
    try {
      ownership = await dep.resolveOwnership({
        providerKey: dep.identity.providerKey,
        channel: dep.identity.channel,
        phoneNumberReference: dep.identity.phoneNumberReference,
        expectedWabaId: dep.identity.expectedWabaId,
      });
    } catch {
      return decideFromOwnership({ kind: "query_error" });
    }
    const decided = decideFromOwnership(ownership);
    if (decided.kind === "blocked") return decided;

    const outcome = await this.applyProviderAccountBinding(message.id, decided.accountId);
    return decideFromBinding(outcome, decided.accountId);
  }

  /**
   * The GUARDED binding compare-and-set. Constrained by all three of `id`, `status = 'dispatching'`
   * and `provider_account_id IS NULL`, so it can bind ONLY the row we still hold the claim on and
   * ONLY while it is still unbound. Exactly one row must match.
   *
   * A zero-row result is NEVER assumed to be success and NEVER repaired by an unconstrained update:
   * we re-read the row to classify it. A row already bound to the SAME account is an idempotent
   * same-account retry (a concurrent worker or an earlier attempt bound it); a DIFFERENT account is
   * a mismatch that is never reassigned; anything else is a genuine concurrent conflict whose row we
   * preserve untouched.
   */
  private async applyProviderAccountBinding(messageId: string, accountId: string): Promise<BindingOutcome> {
    try {
      const { data, error } = await adminClient()
        .from("communication_messages")
        .update({ provider_account_id: accountId, updated_at: new Date().toISOString() })
        .eq("id", messageId)
        .eq("status", "dispatching")
        .is("provider_account_id", null)
        .select("id");
      if (error) return { kind: "error" };
      if ((data ?? []).length === 1) return { kind: "bound" };

      // Zero rows matched — classify, never guess.
      const { data: current, error: readError } = await adminClient()
        .from("communication_messages")
        .select("status, provider_account_id")
        .eq("id", messageId)
        .limit(2);
      if (readError) return { kind: "error" };
      const rows = (current ?? []) as { status: string; provider_account_id: string | null }[];
      if (rows.length !== 1) return { kind: "conflict" };
      const row = rows[0];
      if (row.provider_account_id === accountId && row.status === "dispatching") return { kind: "same_account" };
      if (row.provider_account_id != null && row.provider_account_id !== accountId) return { kind: "mismatch" };
      return { kind: "conflict" };
    } catch {
      return { kind: "error" };
    }
  }

  /** A preflight failure that never reached the provider — definitive, never retried. */
  private preflightFailure(code: string, message: string): WhatsAppSendResult {
    return {
      accepted: false,
      provider: this.provider.providerKey,
      providerMessageId: null,
      normalizedStatus: "failed",
      errorCode: code,
      errorMessage: message,
      retryable: false,
      outcomeCertainty: "definitive_failure",
    };
  }

  /**
   * The channel this service dispatches on — its provider's channel. A
   * WhatsAppProvider declares `channel: "whatsapp"` (Phase 5F-A); a provider that
   * predates the field is, by type, the WhatsApp adapter, so it defaults to the
   * active WhatsApp dispatch channel. This never yields sms/rcs, so an sms/rcs
   * message/intent is always refused by the channel guards.
   */
  private dispatchChannel(): CommunicationChannel {
    return (this.provider as { channel?: CommunicationChannel }).channel ?? ACTIVE_DISPATCH_CHANNEL;
  }

  /**
   * Whether a persisted message's channel is FOREIGN to the active provider — an
   * EXPLICIT sms/rcs channel this WhatsApp service must never dispatch. A row with
   * no channel is treated as the provider's own channel: `communication_messages.
   * channel` is NOT NULL in the database, so this only covers non-DB callers, and
   * an sms/rcs message always carries an explicit channel and is therefore always
   * caught. This only classifies — it never coerces or reroutes a channel.
   */
  private isForeignChannel(channel: CommunicationChannel | null | undefined): boolean {
    return channel != null && !isChannelDispatchable(channel, this.dispatchChannel());
  }

  /**
   * Whether a persisted message's provider is FOREIGN to the active provider (Phase
   * 5F-B provider identity fence). A message may only be dispatched by the provider
   * that owns it — exact, case-sensitive equality of the persisted `message.provider`
   * and the active `provider.providerKey`. An explicit mismatch is refused; the
   * channel/provider is never rewritten and queued messages are never migrated
   * between providers. A row without a provider (non-DB callers only; the column is
   * NOT NULL) is treated as the active provider's own.
   */
  private isForeignProvider(messageProvider: string | null | undefined): boolean {
    return (
      typeof messageProvider === "string" &&
      messageProvider.length > 0 &&
      messageProvider !== this.provider.providerKey
    );
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
  async send(
    intent: CommunicationIntent,
    sendOptions: SendOptions = {}
  ): Promise<Result<CommunicationMessage>> {
    try {
      if (!intent.idempotency_key || !intent.template_key) {
        throw appError("VALIDATION");
      }

      // Phase 5F-A runtime channel safety (INITIAL SEND GUARD). CommunicationService
      // dispatches ONLY on its provider's channel (whatsapp). An sms/rcs intent fails
      // closed HERE — before any communication_messages insert and before any
      // provider call — and is never silently rewritten to whatsapp and never
      // fallen back to another channel.
      if (!isChannelDispatchable(intent.channel, this.dispatchChannel())) {
        return fail(commError("UNSUPPORTED_DISPATCH_CHANNEL"));
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
      // TEMPLATE CHANNEL CONSISTENCY. The template must be for the SAME channel as
      // the intent. A mismatch (e.g. a whatsapp intent pointed at an sms template,
      // or the reverse) fails closed before any provider call — the template is
      // never rewritten onto another channel.
      if (!isTemplateChannelConsistent(template.channel, intent.channel)) {
        return fail(commError("TEMPLATE_CHANNEL_MISMATCH"));
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

      const destinationHash = hashPhoneE164(destination);

      // EARLY APPROVED-MAPPING PREFLIGHT (Phase 5F-B). For an approved_provider_mapping
      // adapter (Meta) the infrastructure gate and the approved active mapping are
      // resolved BEFORE the ledger row is persisted and BEFORE any provider call:
      //   outbound config → runtime policy → provider account → canary → mapping
      // Any failure returns here: ZERO communication_messages insert, ZERO Meta call.
      //
      // This is a cheap early exit, NOT the security boundary: the FINAL runtime
      // infrastructure gate and the fingerprint verification run again after the
      // dispatch claim, immediately before the request. What this preflight
      // contributes to the dispatch is the pinned mapping IDENTITY + FINGERPRINT.
      // The mock (internal_template) adapter never enters this branch.
      let mappingId: string | null = null;
      let mappingVersion: string | null = null;
      let mappingFingerprint: string | null = null;
      if (this.requiresApprovedMapping()) {
        if (!this.approvedTemplateCoordinator) {
          return fail(new AppError(OutboundPreparationReason.COORDINATOR_UNAVAILABLE, OUTBOUND_PREPARATION_MESSAGE));
        }
        const prepared = await this.approvedTemplateCoordinator.prepareInitialOutbound({
          templateKey: intent.template_key,
          language: template.language,
          destinationHash,
        });
        if (!prepared.ok) {
          return fail(new AppError(prepared.reason, OUTBOUND_PREPARATION_MESSAGE));
        }
        mappingId = prepared.mappingId;
        mappingVersion = prepared.mappingVersion;
        mappingFingerprint = prepared.mappingFingerprint;
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
        destination_hash: destinationHash,
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
        // PROVIDER IDENTITY: the runtime-selected provider OWNS this message. It is
        // never rewritten, never rerouted, never migrated between providers.
        provider: this.provider.providerKey,
        // Deterministic replay: pin WHICH approved mapping was used (id + version) and
        // a fingerprint of its EXACT content, so an in-place edit under the same
        // id + version cannot be replayed on a later dispatch.
        provider_template_mapping_id: mappingId,
        provider_template_version: mappingVersion,
        provider_template_mapping_fingerprint: mappingFingerprint,
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
        templateLanguage: template.language,
        authDeadline: sendOptions.authDeadline,
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
        // Nothing in-memory survives a restart: an approved-mapping adapter re-resolves
        // the mapping from the identity + fingerprint pinned on the message, behind the
        // final runtime gate.
        templateLanguage: template?.language ?? null,
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
      // PERSISTED-MESSAGE DISPATCH GUARD (defence in depth at the FINAL dispatch
      // boundary). A persisted row whose channel is not the active provider's
      // channel — a queued or retry sms/rcs message — must never be dispatched by
      // the WhatsApp service. Fail closed BEFORE the claim so zero provider calls
      // occur, and never mutate or reroute the channel. This holds even when a row
      // reaches dispatch via a scheduled send or a retry, not only at enqueue time.
      if (this.isForeignChannel(message.channel)) {
        return fail(commError("UNSUPPORTED_DISPATCH_CHANNEL"));
      }
      // PROVIDER IDENTITY FENCE (final dispatch boundary). A persisted message may
      // only be dispatched by the provider that owns it. Fail closed BEFORE the
      // claim so zero provider calls occur; never reroute or migrate the message.
      if (this.isForeignProvider(message.provider)) {
        return fail(commError("UNSUPPORTED_DISPATCH_PROVIDER"));
      }

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

      // ────────────────────────────────────────────────────────────────────────
      // PHASE 5F-D3-B — THE ONE AUTHORITATIVE CONSENT GATE
      //
      // Placed AFTER the destination is resolved (so the hash is verified against the row) and
      // BEFORE the atomic claim (so a denial can still be terminalized from `queued` /
      // `retry_scheduled`; `dispatching` has NO legal edge to `cancelled`). It runs EXACTLY ONCE
      // per dispatch attempt, which is what makes an immediate send, a future scheduled send and
      // every retry ALL re-evaluate consent — so a STOP created after enqueue but before dispatch
      // IS observed.
      //
      // This service NEVER interprets consent: it consumes the coordinator's CLOSED outcome and
      // never sees a disposition, a preference row or a suppression row.
      //
      // HONEST LIMIT: there is NO transaction spanning the Supabase consent read and the external
      // provider request. A STOP committed inside that window can still be followed by one
      // in-flight send. This gate makes that window as small as it can be (read → claim → send);
      // it does not — and cannot — eliminate it.
      // ────────────────────────────────────────────────────────────────────────
      const consentDenial = await this.enforceOutboundConsent(message);
      if (consentDenial) return consentDenial;

      // Atomic claim. A loser here has sent nothing and must send nothing.
      const claim = await this.claimMessageForDispatch(message);
      if (!claim.ok) return claim;
      const claimed = claim.data;

      const currentAttempt = claimed.attempt_count + 1;
      const providerTemplate = options.providerTemplateName || claimed.template_key || "";

      try {
        const result = await this.invokeProvider(claimed, destination, providerTemplate, options);
        // CANONICAL FAIL-CLOSED DECISION ORDER (independent of adapter correctness):
        //   1) derive the EFFECTIVE certainty (missing/invalid/contradictory →
        //      unknown_outcome; never inferred from result.accepted);
        //   2) ONLY a valid `accepted` certainty (which requires accepted === true)
        //      enters success handling;
        //   3) everything else — unknown_outcome (any accepted/retryable), or a
        //      contradictory result — goes to the failure path, where unknown_outcome
        //      is parked in outcome_unknown and a valid definitive_failure follows the
        //      existing lane retry rules.
        // PHASE 8B-1B-B — a binding CONFLICT/MISMATCH means the row's status or ownership moved
        // concurrently, so the row we hold is no longer the row we believe. `recordDispatchFailure`
        // ultimately writes through the ID-ONLY `applyMessageUpdate`, which would CLOBBER that
        // concurrent state. No provider request occurred and nothing is stranded (the conflicting
        // writer owns the row), so return a safe closed error and preserve the row untouched.
        if (
          !result.accepted &&
          (result.errorCode === ATTRIBUTION_FAILURE.BIND_CONFLICT ||
            result.errorCode === ATTRIBUTION_FAILURE.MISMATCH)
        ) {
          return fail(commError(result.errorCode));
        }
        return effectiveOutcomeCertainty(result) === "accepted"
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
   * PHASE 5F-D3-B — enforce the outbound consent layer for ONE dispatch attempt.
   *
   * Returns `null` when the dispatch may CONTINUE, or a terminal `Result` (already reflected in the
   * ledger) when it must STOP. In every stop case ZERO provider calls have occurred.
   *
   * PHASE 8A. There is NO LONGER a "missing enforcer ⇒ continue" branch. `this.consentEnforcer` is
   * non-nullable and was normalized in the constructor, so the ONLY way out of this method towards the
   * provider is a FULLY VALIDATED `allow`. A missing, null, undefined, malformed or throwing authority
   * all converge here on a terminal or retryable STOP — never on a send.
   */
  private async enforceOutboundConsent(
    message: CommunicationMessage
  ): Promise<Result<CommunicationMessage> | null> {
    // EXPLICIT, CLOSED channel mapping — never a coercion.
    //
    // `whatsapp` → `whatsapp` and `sms` → `sms`, and NOTHING else. An `rcs` row, or any future/unknown
    // channel, is NOT silently treated as WhatsApp: it has no consent channel we are authorized to ask
    // about, so it FAILS CLOSED here — before the consent authorization, before the claim, and before any
    // provider invocation. There is deliberately no fallback-to-WhatsApp path. (The foreign-channel guard
    // at the top of `dispatchMessage` already rejects such a row for this provider; this is the second,
    // independent fence, so a future provider whose channel differs can never inherit WhatsApp's consent.)
    const enforcementChannel = toEnforcementChannel(message.channel);
    if (!enforcementChannel) {
      return await this.terminalizeBeforeClaim(
        message,
        "failed",
        "UNSUPPORTED_DISPATCH_CHANNEL",
        COMMUNICATION_ERROR_MESSAGES.UNSUPPORTED_DISPATCH_CHANNEL
      );
    }

    let outcome: OutboundConsentOutcome;
    try {
      // VALIDATE, never trust. The authorize() return value is an object of unknown provenance — a mock, a
      // hostile stub, a future adapter, a half-migrated implementation. `normalizeOutboundConsentOutcome`
      // checks the COMPLETE closed union (discriminant, required fields, code membership, `retryable`, and
      // the absence of contradictory fields) and re-mints it canonically. A duck-typed `{ kind: "allow" }`
      // carrying no scope is NOT an authorization and becomes CONSENT_AUTHORITY_INTEGRITY.
      //
      // The normalization is INSIDE the try on purpose: an enforcer that resolves `undefined` used to make
      // `outcome.kind` throw a TypeError out of this method, so it fail-closed only by accident of an outer
      // catch. Now it is a DELIBERATE integrity failure with a real code and a real ledger entry.
      outcome = normalizeOutboundConsentOutcome(
        await this.consentEnforcer.authorize({
          channel: enforcementChannel,
          messageType: message.message_type,
          templateKey: message.template_key ?? "",
          lane: message.lane,
          destinationHash: message.destination_hash,
          destinationSource: message.destination_source,
          recipientType: message.recipient_type,
          recipientId: message.recipient_id,
        })
      );
    } catch {
      // A thrown enforcer is INFRASTRUCTURE, never a decision. Treated exactly like `unavailable`.
      outcome = FAIL_CLOSED_CONSENT_OUTCOME;
    }

    // The ONLY path to the claim and the provider: a fully validated allow.
    if (outcome.kind === "allow") return null;

    const code = outcome.code as CommunicationErrorCode;
    const reason = COMMUNICATION_ERROR_MESSAGES[code];

    // DENY — a definitive consent refusal. CANCEL it: `cancelled` is a legal edge from both `queued`
    // and `retry_scheduled`, it is terminal, and it is NOT `failed` (nothing failed — we chose not to
    // send). No `failed_at` is stamped.
    if (outcome.kind === "deny") {
      return await this.terminalizeBeforeClaim(message, "cancelled", code, reason);
    }

    // INVALID / INTEGRITY — the request or the authority is untrustworthy. Deterministic: retrying can
    // never help, so it is a definitive `failed` (with `failed_at`), never a cancellation.
    if (outcome.kind === "invalid") {
      return await this.terminalizeBeforeClaim(message, "failed", code, reason);
    }

    // UNAVAILABLE — infrastructure, not a decision. The two lanes diverge, and deliberately so:
    //
    //   AUTHENTICATION: the OTP is NEVER persisted, so this row can never be re-dispatched by any
    //   worker. Leaving it queued would leak a permanently undeliverable row. It becomes `failed`;
    //   the user simply requests a fresh OTP, which re-evaluates consent from scratch.
    //
    //   BUSINESS: the row IS re-dispatchable. Do NOT cancel and do NOT fail it — a transient consent
    //   authority blip must never destroy a legitimate message. Leave its status UNCHANGED and return
    //   a retryable failure, so a future dispatch re-evaluates consent.
    if (message.lane === "authentication") {
      return await this.terminalizeBeforeClaim(message, "failed", code, reason);
    }
    return fail(commError(code));
  }

  /**
   * PHASE 5F-D3-B — COMPARE-AND-SET terminalization, BEFORE any claim.
   *
   * Updates by `id` AND the EXACT status we read. If another worker claimed or moved the row in
   * between, ZERO rows match: we return the existing safe concurrent-claim outcome and — critically —
   * the provider is NEVER called on either side. An unconditional update would clobber a row another
   * worker is already dispatching.
   */
  private async terminalizeBeforeClaim(
    message: CommunicationMessage,
    target: Extract<CommunicationMessageStatus, "cancelled" | "failed">,
    failureCode: CommunicationErrorCode,
    failureReason: string
  ): Promise<Result<CommunicationMessage>> {
    if (!isValidTransition(message.status, target)) {
      return fail(commError("INVALID_STATE_TRANSITION"));
    }

    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown> = {
      status: target,
      next_retry_at: null,
      failure_code: failureCode,
      failure_reason_sanitized: sanitizeFailureReason(failureReason),
      updated_at: nowIso,
    };
    // `cancelled` is not a failure: nothing broke, we declined to send. Only `failed` stamps failed_at.
    if (target === "failed") updates.failed_at = nowIso;

    const { data, error } = await adminClient()
      .from("communication_messages")
      .update(updates)
      .eq("id", message.id)
      .eq("status", message.status)
      .select("*");

    if (error) throw error;

    const updated = (data ?? []) as CommunicationMessage[];
    // Lost the race: another worker moved the row between our read and our write. Return the safe
    // concurrent outcome and call NO provider. We never clobber their claim.
    if (updated.length !== 1) return fail(commError("MESSAGE_ALREADY_CLAIMED"));
    return ok(updated[0]);
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
    // PROVIDER/MESSAGE CHANNEL IDENTITY CHECK immediately before the provider call
    // (defence in depth with the dispatch-boundary guard). If a message whose
    // channel is not this provider's channel ever reaches here, refuse with ZERO
    // provider invocation and fold it into a non-retryable failure result — never
    // rewrite or reroute the channel.
    if (this.isForeignChannel(message.channel)) {
      return {
        accepted: false,
        provider: this.provider.providerKey,
        providerMessageId: null,
        normalizedStatus: "failed",
        errorCode: CHANNEL_DISPATCH_ERROR.UNSUPPORTED_DISPATCH_CHANNEL,
        errorMessage: "The message channel does not match the active provider channel.",
        retryable: false,
        outcomeCertainty: "definitive_failure",
      };
    }
    // PROVIDER IDENTITY FENCE immediately before the provider call (defence in depth
    // with the dispatch-boundary fence). A message owned by a different provider is
    // refused here with ZERO provider invocation — never rerouted.
    if (this.isForeignProvider(message.provider)) {
      return {
        accepted: false,
        provider: this.provider.providerKey,
        providerMessageId: null,
        normalizedStatus: "failed",
        errorCode: "UNSUPPORTED_DISPATCH_PROVIDER",
        errorMessage: "The message provider does not match the active provider.",
        retryable: false,
        outcomeCertainty: "definitive_failure",
      };
    }
    // APPROVED-MAPPING DISPATCH (Phase 5F-B). An `approved_provider_mapping` adapter
    // is NEVER called through the bare sendAuthenticationMessage/sendTemplateMessage
    // methods. It dispatches an approved RESOLVED DESCRIPTOR only, re-resolved HERE —
    // at the network boundary, on EVERY dispatch including the initial send — from the
    // mapping identity pinned on the message.
    //
    // The final fence runs, in order: pinned mapping (by id, re-validated) → FINAL
    // runtime infrastructure gate (freshly-read runtime policy / provider account /
    // canary rows) → mapping content fingerprint verification. This closes the race in
    // which an operator pauses Meta, disables outbound, un-readies the account, expires
    // the canary row, or edits the mapping row in place AFTER the early preflight but
    // BEFORE the request is issued.
    //
    // Any failure is a standing configuration failure: definitive, never retried, never
    // outcome_unknown (no provider request occurred), and ZERO network calls.
    if (this.requiresApprovedMapping()) {
      if (!supportsResolvedTemplate(this.provider)) {
        return this.preflightFailure(OutboundPreparationReason.SENDER_UNSUPPORTED, OUTBOUND_PREPARATION_MESSAGE);
      }
      if (!this.approvedTemplateCoordinator) {
        return this.preflightFailure(OutboundPreparationReason.COORDINATOR_UNAVAILABLE, OUTBOUND_PREPARATION_MESSAGE);
      }
      const language = options.templateLanguage ?? null;
      if (!message.template_key || !language) {
        return this.preflightFailure(OutboundPreparationReason.TEMPLATE_UNRESOLVED, OUTBOUND_PREPARATION_MESSAGE);
      }

      const prepared = await this.approvedTemplateCoordinator.prepareFinalOutbound({
        templateKey: message.template_key,
        language,
        destinationHash: message.destination_hash,
        mappingId: message.provider_template_mapping_id ?? null,
        mappingVersion: message.provider_template_version ?? null,
        mappingFingerprint: message.provider_template_mapping_fingerprint ?? null,
      });
      if (!prepared.ok) {
        return this.preflightFailure(prepared.reason, OUTBOUND_PREPARATION_MESSAGE);
      }

      const lane = message.lane === "authentication" ? "authentication" : "business";
      // Authentication carries the OTP from REQUEST MEMORY to the provider call and
      // nowhere else; business uses the persisted, already-sanitized variables.
      const sourceVariables =
        message.lane === "authentication"
          ? (options.rawVariables as Record<string, string>)
          : this.sanitizeVariables(options.rawVariables ?? message.variables ?? {});

      // AUTH TOTAL DEADLINE. Read the remaining safe budget HERE — after signature
      // verification, the operational gate, the DB lookups, the ledger insert, the
      // claim, and the final gate have all consumed part of the hook window. An
      // exhausted budget fails LOCALLY: zero provider calls, a deterministic definitive
      // failure, never outcome_unknown (no request was initiated). Business dispatch
      // never carries a deadline and is unaffected.
      let maxNetworkTimeoutMs: number | undefined;
      if (lane === "authentication" && options.authDeadline) {
        const remainingMs = options.authDeadline.remainingNetworkBudgetMs();
        if (!isViableAuthNetworkBudget(remainingMs)) {
          return this.preflightFailure(AUTH_NETWORK_DEADLINE_EXHAUSTED, AUTH_NETWORK_DEADLINE_MESSAGE);
        }
        maxNetworkTimeoutMs = remainingMs;
      }

      // PHASE 8B-1B-B — THE PRE-NETWORK OWNERSHIP FENCE. The LAST thing before the request.
      //
      //     UNPROVEN OR UNBOUND PROVIDER ACCOUNT = ZERO PROVIDER CALLS.
      //
      // Ownership is PROVEN from the identity the adapter will actually send with, and the exact
      // account is DURABLY BOUND to the claimed row, BEFORE any network call. A message that
      // reaches Meta is therefore always attributable to the account that sent it — attribution
      // can never be reconstructed after the fact, and a send can never precede its proof.
      const attribution = await this.bindOutboundProviderAccount(message);
      if (attribution.kind === "blocked") {
        return this.attributionFailure(attribution);
      }

      try {
        return await this.provider.sendResolvedTemplate(destination, prepared.resolved, sourceVariables, {
          lane,
          maxNetworkTimeoutMs,
        });
      } catch (providerException) {
        return normalizeProviderException(providerException, this.provider.providerKey);
      }
    }

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

    // UNKNOWN OUTCOME (Phase 5F-B): the provider may actually have accepted the
    // request (a timeout / abort / ambiguous network / ambiguous 5xx / 2xx without a
    // usable id, a contradictory result, or a missing/invalid certainty). We can
    // neither prove nor disprove delivery, so we PARK the message in
    // `outcome_unknown`: NO retry, NO dead_letter, NO `failed_at` stamp, and
    // `next_retry_at = null`. A later verified webhook reconciles it forward. This
    // DOMINATES the retryable flag: an unknown outcome is never collapsed into
    // `failed`, and `retryable=true` never turns it into a retry.
    if (effectiveOutcomeCertainty(result) === "unknown_outcome") {
      return this.applyMessageUpdate(message.id, {
        status: "outcome_unknown" as CommunicationMessageStatus,
        attempt_count: attemptCount,
        failure_code: result.errorCode,
        failure_reason_sanitized: sanitizeFailureReason(result.errorMessage),
        next_retry_at: null,
        updated_at: nowIso,
      });
    }

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
    secret: string,
    // Phase 8B-1B-C — the ALREADY-RESOLVED owning account from the webhook orchestration layer. Optional at
    // the TS boundary so the not-yet-wired caller still compiles; a VALID delivery callback fails CLOSED at
    // runtime when it is missing/malformed. This method NEVER resolves ownership and never reads env.
    providerAccountId?: string | null
  ): Promise<Result<WebhookProcessingOutcome>> {
    try {
      const providerKey = this.provider.providerKey;
      const payloadHash = crypto.createHash("sha256").update(rawBody ?? "").digest("hex");

      const signatureValid = this.provider.verifyWebhookSignature(rawBody, signature, secret);
      if (!signatureValid) {
        // Recorded for admin monitoring. Rejected receipts occupy a SEPARATE partial unique index, so a
        // forged body can never poison the payload hash slot of a legitimate one. Phase 8B-1B-C: an
        // invalid-signature receipt is ALWAYS provider_account_id = NULL — it never requires and is never
        // bound to an account, and it creates no delivery events. (No provider_account_id is passed below.)
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

      // Phase 8B-1B-C — the signature is VALID, so every receipt/event from here is an OWNED effect. A
      // missing/malformed provider account FAILS CLOSED: zero valid-receipt writes, zero delivery events.
      if (typeof providerAccountId !== "string" || !PROVIDER_ACCOUNT_ID_SHAPE.test(providerAccountId)) {
        return fail(commError("PROVIDER_ACCOUNT_ATTRIBUTION_REQUIRED"));
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
          provider_account_id: providerAccountId,
        });
        return fail(commError("WEBHOOK_PAYLOAD_UNPARSEABLE"));
      }

      const providerEventId = this.provider.deriveWebhookEventId(payload);

      const { receipt, duplicate, conflict } = await this.recordReceipt({
        provider: providerKey,
        provider_event_id: providerEventId,
        payload_hash: payloadHash,
        signature_valid: true,
        processing_status: "verified",
        provider_account_id: providerAccountId,
      });

      if (conflict) {
        // CROSS-ACCOUNT REDELIVERY: the stored receipt for this global provider event is bound to a
        // DIFFERENT account. Preserve the original stored row as authority; make ZERO new receipt/event
        // writes and ZERO message-lifecycle mutations; never reassign. Sanitized — no id/phone/WABA/payload.
        console.warn("[webhook.provider_account_conflict] a stored webhook receipt is bound to a different provider account; preserved unchanged.");
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
          const { application, deliveryEventRecorded } = await this.applyWebhookEvent(event, providerAccountId);
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
    event: WhatsAppWebhookEvent,
    providerAccountId: string
  ): Promise<{ application: EventApplication; deliveryEventRecorded: boolean }> {
    const message = await this.getMessageByProviderMessageId(event.providerMessageId);
    if (!message) return { application: "unmatched", deliveryEventRecorded: false };

    // WEBHOOK CHANNEL FENCE. The lookup above is already scoped to this provider's
    // key, but this is the explicit channel-level guarantee: a WhatsApp webhook can
    // never advance (or fail) a message whose channel is not the active provider's
    // channel — an sms/rcs message is never touched by WhatsApp webhook processing.
    // Treat any such match as unmatched; do not mutate or reroute it.
    if (this.isForeignChannel(message.channel)) {
      return { application: "unmatched", deliveryEventRecorded: false };
    }

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

    const deliveryEventRecorded = await this.insertDeliveryEvent(message.id, event, providerAccountId);
    return { application, deliveryEventRecorded };
  }

  /** Append-only trace. A unique conflict means it was already recorded. Phase 8B-1B-C: BIND the owning
   *  account at INSERT (the SAME account the valid receipt carries). Never UPDATEd, never reassigned. */
  private async insertDeliveryEvent(
    messageId: string,
    event: WhatsAppWebhookEvent,
    providerAccountId: string
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
        provider_account_id: providerAccountId,
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
    provider_account_id?: string | null;
  }): Promise<{ receipt: CommunicationWebhookReceipt | null; duplicate: boolean; conflict: boolean }> {
    const boundAccount = row.provider_account_id ?? null;

    // Phase 8B-1B-C — READ-FIRST for a VALID-signature BOUND receipt. The account-scoped uniques do not, by
    // themselves, stop a SECOND row for the same global event under a different account, so the stored row
    // is the authority: never a second row, never a reassignment, a legacy NULL preserved, a DIFFERENT
    // stored account a deterministic conflict. Invalid-signature / NULL-account receipts skip this and keep
    // their original insert-then-resolve behaviour (they are never bound).
    if (row.signature_valid && boundAccount !== null) {
      const existing = await this.findExistingReceipt(row);
      if (existing) {
        const stored = existing.provider_account_id ?? null;
        if (stored !== null && stored !== boundAccount) return { receipt: existing, duplicate: false, conflict: true };
        await this.incrementReceiptDuplicateCount(existing); // same account, or legacy NULL (preserved)
        return { receipt: existing, duplicate: true, conflict: false };
      }
    }

    const { data, error } = await adminClient()
      .from("communication_webhook_receipts")
      .insert(row)
      .select("*")
      .single();

    if (!error && data) {
      return { receipt: data as CommunicationWebhookReceipt, duplicate: false, conflict: false };
    }

    if (error && isUniqueViolationError(error)) {
      const existing = await this.findExistingReceipt(row);
      if (existing) {
        const stored = existing.provider_account_id ?? null;
        if (row.signature_valid && boundAccount !== null && stored !== null && stored !== boundAccount) {
          return { receipt: existing, duplicate: false, conflict: true };
        }
        await this.incrementReceiptDuplicateCount(existing);
      }
      return { receipt: existing, duplicate: true, conflict: false };
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
