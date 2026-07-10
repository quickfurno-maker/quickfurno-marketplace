// ============================================================================
// QuickFurno — services/clientLoginOtpDeliveryOrchestrator.ts  (Phase 5F-C3-B, server-only)
//
// Wires `client_login_otp` to the Phase 5F-C1 attempt ledger and adds an OPTIONAL SMS
// fallback. IT SHIPS OPERATIONALLY DISABLED: `authentication_transport_policies` is not
// operationally enabled, `authentication_transport_failure_rules` is EMPTY (default deny),
// and no Exotel runtime policy / account / template mapping / canary row exists. In
// production every path below terminates at the WhatsApp primary exactly as it does today.
//
// NO SECOND OTP, EVER. The OTP is generated once, by Supabase, and travels in REQUEST
// MEMORY. A fallback re-sends THAT SAME value over a second transport; nothing here
// generates, derives, stores, hashes, logs, or returns an OTP.
//
// NO RETRY, NO QUEUE, NO n8n. At most two transport attempts exist per authentication
// action, and Phase 5F-C1's atomic RPC — not this file — is the race-safety authority.
//
// THE LEDGER IS BEST-EFFORT FOR THE PRIMARY, AUTHORITATIVE FOR THE FALLBACK.
//   The Phase 5F-C1 ledger IS live: the table and both RPCs exist, and on a healthy
//   database a claim always resolves. Best-effort is purely an AVAILABILITY decision, not a
//   schema-readiness one: a TRANSIENT database fault (a dropped connection, a statement
//   timeout, a failover) must never deny a legitimate user their login. So if the claim
//   cannot be recorded, the WhatsApp primary is STILL delivered, and the degraded path is
//   made OBSERVABLE — a sanitized `ledger_unavailable` security event is emitted — never
//   silent. On a healthy database this path is unreachable, and the harness proves it.
//   A fallback then becomes IMPOSSIBLE: without a claimed, finalized attempt 1 there is no
//   lineage to fall back from, and the code refuses to synthesize one — so a fallback SMS
//   and a ledger-unavailable state can never coexist in one action.
//
// WHAT IS NEVER PERSISTED, LOGGED, OR RETURNED
//   the OTP; the plaintext phone number; the raw provider response; the hook secret or
//   signature. The destination reaches the ledger only as a non-reversible SHA-256 hash,
//   and the authentication action only as its derived 64-character SHA-256 identity.
// ============================================================================

import type { AuthNetworkDeadline } from "../lib/auth/hookDeadline";
import {
  AUTH_NETWORK_DEADLINE_EXHAUSTED,
  isViableAuthNetworkBudget,
} from "../lib/auth/hookDeadline";
import {
  isLocalPreflightFailureCode,
  localFailureAttemptOutcome,
  mapMessageStatusToAttemptOutcome,
  mapProviderResultToAttemptOutcome,
  safeFailureCode,
  type AttemptOutcome,
} from "../lib/auth/authAttemptOutcomeMapping";
import { deriveClientLoginActionId } from "../lib/communication/authenticationActionIdentity";
import type { AuthenticationActionId } from "../lib/communication/authenticationActionIdentity";
import { hashPhoneE164 } from "../lib/communication/phone";
import {
  AuthFallbackRequestMode,
  type AuthenticationFallbackDecision,
} from "../lib/communication/authenticationTransportDecision";
import { SMS_RUNTIME_READY } from "../lib/communication/providers/smsRuntimeGate";
import type { SmsRuntimeDecision } from "../lib/communication/providers/smsRuntimeGate";
import type { CommunicationIntent, CommunicationMessage } from "../lib/communication/types";
import type { Result } from "../lib/errors";
import {
  AuthAttemptClaimOutcome,
  claimFallbackAttempt,
  claimPrimaryAttempt,
  finalizeAttempt,
  type AuthAttemptClaimResult,
} from "./authenticationDeliveryAttemptService";
import { decideAuthenticationFallback } from "./authenticationTransportPolicyService";
import { createRuntimeCommunicationService, resolveRuntimeWhatsAppProvider } from "./runtimeCommunicationService";
import { createRuntimeSmsProvider } from "./runtimeSmsProviderService";
import { runtimeSmsAdapterFactory } from "./runtimeSmsAdapterFactory";
import { evaluateSmsRuntimeReadiness } from "./smsProviderRuntimeService";
import { recordAuthSecurityEvent } from "./authSecurityEventService";
import { AuthSecurityEventType } from "../lib/identity/authSecurityEvent";

/** This orchestrator serves exactly ONE auth flow. The vendor flows never reach it. */
export const ORCHESTRATED_AUTH_FLOW = "client_login_otp" as const;
export const CLIENT_OTP_AUTH_REFERENCE_TYPE = "auth_user" as const;
/** The language an SMS authentication template mapping must be approved under. */
export const CLIENT_OTP_SMS_LANGUAGE = "en";

/** The sanitized reason recorded when the attempt ledger could not be reached. */
export const LEDGER_UNAVAILABLE_REASON = "ledger_unavailable";

/**
 * Fixed, greppable prefix for the DB-INDEPENDENT server log emitted when the attempt ledger
 * is unreachable. This log is the only degraded-path signal that survives a full database
 * outage (the `auth_security_events` write does not — it lives in the same database).
 */
export const LEDGER_UNAVAILABLE_LOG_PREFIX = "[auth.client_login_otp.ledger_unavailable]";

// ----------------------------------------------------------------------------
// Outcome vocabulary — maps 1:1 onto the hook's existing outcome kinds
// ----------------------------------------------------------------------------
export const ClientOtpDeliveryKind = {
  DELIVERED: "delivered",
  DELIVERY_FAILED: "delivery_failed",
  DELIVERY_UNCERTAIN: "delivery_uncertain",
  IN_PROGRESS: "in_progress",
} as const;

export type ClientOtpDeliveryKindValue =
  (typeof ClientOtpDeliveryKind)[keyof typeof ClientOtpDeliveryKind];

/**
 * The observable result. Every field is non-secret and safe to log: a stable kind, boolean
 * facts, and identifier-shaped reason codes. No OTP, no phone, no provider payload.
 */
export interface ClientOtpDeliveryResult {
  readonly kind: ClientOtpDeliveryKindValue;
  readonly dispatchAttempted: boolean;
  /** True only when an SMS request actually left this process. */
  readonly smsSent: boolean;
  /** True only when a fallback attempt row was atomically claimed. */
  readonly fallbackClaimed: boolean;
  /** Why the fallback did not happen. `null` when no fallback was considered at all. */
  readonly fallbackBlockedReason: string | null;
  /** True when the attempt ledger could not be reached; the primary still dispatched. */
  readonly ledgerUnavailable: boolean;
}

/** The reasons this orchestrator itself refuses a fallback, before or after C1's decision. */
export const OrchestratorFallbackBlockReason = {
  PRIMARY_NOT_DEFINITIVE: "PRIMARY_NOT_DEFINITIVE",
  LEDGER_UNAVAILABLE: "LEDGER_UNAVAILABLE",
  /** A local/preflight failure is never fallback-eligible. Deny-only. */
  LOCAL_PREFLIGHT_FAILURE: "LOCAL_PREFLIGHT_FAILURE",
  DECISION_READ_FAILED: "DECISION_READ_FAILED",
  SMS_RUNTIME_BLOCKED: "SMS_RUNTIME_BLOCKED",
  SMS_PROVIDER_UNAVAILABLE: "SMS_PROVIDER_UNAVAILABLE",
  /** The runtime adapter is not the provider the decision allowed. */
  SMS_PROVIDER_IDENTITY_MISMATCH: "SMS_PROVIDER_IDENTITY_MISMATCH",
  BUDGET_EXHAUSTED: AUTH_NETWORK_DEADLINE_EXHAUSTED,
  FALLBACK_CLAIM_REJECTED: "FALLBACK_CLAIM_REJECTED",
} as const;

// ----------------------------------------------------------------------------
// Input + injectable dependencies
// ----------------------------------------------------------------------------
export interface ClientOtpDeliveryInput {
  readonly authUserId: string;
  /** Canonical E.164. Hashed before it reaches any ledger write. Never persisted raw. */
  readonly phoneE164: string;
  /** Supabase's OTP, from request memory. Never regenerated, never persisted. */
  readonly otp: string;
  /** The `webhook-id` of a request whose Standard Webhooks signature ALREADY verified. */
  readonly verifiedWebhookId: string;
  /** Covers BOTH attempts. Started at the route's POST entry. */
  readonly deadline: AuthNetworkDeadline;
  /** Built by the caller so the OTP never travels through this module's own construction. */
  readonly buildPrimaryIntent: () => CommunicationIntent;
}

/**
 * Every collaborator, injectable. Defaults bind the real services; the harness injects
 * fakes so no database, no network, and no real provider is ever touched by a test.
 */
export interface ClientOtpDeliveryDeps {
  readonly resolveWhatsAppProviderKey: () => Result<string>;
  readonly createCommunicationService: () => Result<{
    send: (intent: CommunicationIntent, options: { authDeadline: AuthNetworkDeadline }) => Promise<Result<CommunicationMessage>>;
  }>;
  readonly claimPrimaryAttempt: typeof claimPrimaryAttempt;
  readonly claimFallbackAttempt: typeof claimFallbackAttempt;
  readonly finalizeAttempt: typeof finalizeAttempt;
  readonly decideAuthenticationFallback: typeof decideAuthenticationFallback;
  readonly evaluateSmsRuntimeReadiness: typeof evaluateSmsRuntimeReadiness;
  readonly createRuntimeSmsProvider: typeof createRuntimeSmsProvider;
  /**
   * Emits the DB-INDEPENDENT `ledger_unavailable` server log line. Runs BEFORE the security
   * event write, because it is the only signal that survives a full database outage.
   * Best-effort: invoked inside a `try/catch`, so a throw here can never deny a login.
   */
  readonly logLedgerUnavailable: (line: LedgerUnavailableLogLine) => void;
  /**
   * Records the sanitized `ledger_unavailable` security event. Best-effort and non-throwing:
   * it is only ever invoked from a `try/catch` that swallows any failure, so the OTP send
   * proceeds even if observability is itself unavailable.
   */
  readonly recordLedgerUnavailableEvent: (input: LedgerUnavailableEventInput) => Promise<unknown>;
}

/** The non-secret fields of the DB-independent server log line. */
export interface LedgerUnavailableLogLine {
  readonly authFlow: typeof ORCHESTRATED_AUTH_FLOW;
  readonly reason: typeof LEDGER_UNAVAILABLE_REASON;
  /** A sanitized, identifier-shaped classification. Never raw database error text. */
  readonly failureClassification: string;
}

/** The non-secret facts a `ledger_unavailable` event carries. Never an OTP, phone, or error text. */
export interface LedgerUnavailableEventInput {
  readonly authFlow: typeof ORCHESTRATED_AUTH_FLOW;
  readonly authUserId: string;
  /** A SHA-256 digest — the pre-image (the phone) never appears here. */
  readonly destinationHash: string;
  readonly correlationId: string;
  /** A sanitized, identifier-shaped classification of why the claim could not be recorded. */
  readonly failureClassification: string;
}

/** LAZY: constructed per request, never at module import. */
export function defaultClientOtpDeliveryDeps(): ClientOtpDeliveryDeps {
  return {
    resolveWhatsAppProviderKey: () => {
      const provider = resolveRuntimeWhatsAppProvider();
      return provider.ok ? { ok: true, data: provider.data.providerKey } : provider;
    },
    createCommunicationService: () => createRuntimeCommunicationService(),
    claimPrimaryAttempt,
    claimFallbackAttempt,
    finalizeAttempt,
    decideAuthenticationFallback,
    evaluateSmsRuntimeReadiness,
    createRuntimeSmsProvider: (factory, env) => createRuntimeSmsProvider(factory, env),
    // A single structured, sanitized, DB-INDEPENDENT server log line under a fixed greppable
    // prefix. Deliberately not a database write: it must survive a total DB outage.
    logLedgerUnavailable: (line) => {
      console.error(LEDGER_UNAVAILABLE_LOG_PREFIX, {
        auth_flow: line.authFlow,
        reason: line.reason,
        failure_classification: line.failureClassification,
      });
    },
    recordLedgerUnavailableEvent: (event) =>
      recordAuthSecurityEvent({
        eventType: AuthSecurityEventType.CLIENT_OTP_REQUEST_FAILED,
        actorUserId: event.authUserId,
        correlationId: event.correlationId,
        // A SHA-256 digest — the service rejects anything that is not already hashed.
        destinationHash: event.destinationHash,
        // sanitizeAuthSecurityMetadata drops secret-looking keys; these are all safe.
        metadata: {
          auth_flow: event.authFlow,
          reason: LEDGER_UNAVAILABLE_REASON,
          failure_classification: event.failureClassification,
        },
      }),
  };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function result(
  kind: ClientOtpDeliveryKindValue,
  over: Partial<ClientOtpDeliveryResult> = {}
): ClientOtpDeliveryResult {
  return {
    kind,
    dispatchAttempted: false,
    smsSent: false,
    fallbackClaimed: false,
    fallbackBlockedReason: null,
    ledgerUnavailable: false,
    ...over,
  };
}

/** The hook outcome a `communication_messages.status` maps to. Unchanged from Phase 5D. */
function hookKindForMessageStatus(status: string): ClientOtpDeliveryKindValue {
  if (status === "accepted" || status === "sent" || status === "delivered" || status === "read") {
    return ClientOtpDeliveryKind.DELIVERED;
  }
  if (status === "outcome_unknown") return ClientOtpDeliveryKind.DELIVERY_UNCERTAIN;
  if (status === "failed" || status === "cancelled" || status === "dead_letter") {
    return ClientOtpDeliveryKind.DELIVERY_FAILED;
  }
  return ClientOtpDeliveryKind.IN_PROGRESS;
}

/** The hook outcome an attempt-2 certainty maps to. */
function hookKindForCertainty(certainty: string): ClientOtpDeliveryKindValue {
  if (certainty === "accepted") return ClientOtpDeliveryKind.DELIVERED;
  if (certainty === "definitive_failure") return ClientOtpDeliveryKind.DELIVERY_FAILED;
  return ClientOtpDeliveryKind.DELIVERY_UNCERTAIN;
}

/**
 * A primary claim outcome that permits the WhatsApp dispatch to proceed.
 *   CLAIMED         — the normal path.
 *   ALREADY_EXISTS  — an idempotent replay of the SAME verified action. CommunicationService
 *                     dedupes on the webhook id, so nothing is re-sent.
 *   DATABASE_ERROR  — the ledger is unavailable. The primary still goes out (today's
 *                     behaviour). No fallback is possible without a claimed attempt.
 * Anything else is a STRUCTURAL refusal (attempt limit, lineage, invalid request) and the
 * OTP must NOT be dispatched: a second delivery is the one thing this design forbids.
 */
function primaryClaimPermitsDispatch(outcome: string): boolean {
  return (
    outcome === AuthAttemptClaimOutcome.CLAIMED ||
    outcome === AuthAttemptClaimOutcome.ALREADY_EXISTS ||
    outcome === AuthAttemptClaimOutcome.DATABASE_ERROR
  );
}

/**
 * Emit the sanitized `ledger_unavailable` signals. Both are FULLY best-effort and neither may
 * gate or delay OTP delivery — the OTP has already been dispatched by the time this runs.
 *
 * ORDER MATTERS. The DB-independent server LOG is emitted FIRST, because
 * `ledgerUnavailable` fires precisely when the database is unreachable — and
 * `auth_security_events` lives in that same database, so its write would fail in the exact
 * outage this safeguard exists for. The log line is the only signal that survives a full DB
 * outage; the security-event row is a richer signal for the narrower case where the RPC is
 * broken but the database is healthy.
 *
 * The classification is derived only from the claim's already-sanitized structural `detail`
 * (an identifier or nothing), never from a raw database error message. Neither signal ever
 * carries the OTP, the plaintext phone, the destination-hash pre-image, or raw error text.
 */
async function emitLedgerUnavailable(
  deps: ClientOtpDeliveryDeps,
  input: ClientOtpDeliveryInput,
  destinationHash: string,
  claimResult: AuthAttemptClaimResult | null
): Promise<void> {
  const failureClassification = safeFailureCode(claimResult?.detail) ?? LEDGER_UNAVAILABLE_REASON;

  // (a) DB-INDEPENDENT server log FIRST. The only signal that survives a full DB outage.
  try {
    deps.logLedgerUnavailable({
      authFlow: ORCHESTRATED_AUTH_FLOW,
      reason: LEDGER_UNAVAILABLE_REASON,
      failureClassification,
    });
  } catch {
    // Logging must never deny a login.
  }

  // (b) The richer DB-backed event. Useless if the database itself is down, but valuable
  // when only the RPC is broken. Also best-effort; a failure is swallowed.
  try {
    await deps.recordLedgerUnavailableEvent({
      authFlow: ORCHESTRATED_AUTH_FLOW,
      authUserId: input.authUserId,
      destinationHash,
      correlationId: input.verifiedWebhookId,
      failureClassification,
    });
  } catch {
    // Observability is advisory. A failure here must never deny a login.
  }
}

// ----------------------------------------------------------------------------
// The orchestration
// ----------------------------------------------------------------------------
/**
 * Steps, in a fixed order. Each is fail-closed and none can be reached out of sequence:
 *
 *   1-2 the caller has ALREADY verified the signature and parsed the payload;
 *   3   derive the action identity from the VERIFIED webhook id;
 *   4   hash the destination;
 *   5   claim attempt 1 atomically, under the runtime WhatsApp provider's identity;
 *   6   dispatch WhatsApp with the SAME OTP from request memory;
 *   7   finalize attempt 1 from the WhatsApp outcome;
 *   8   accepted        → done, no fallback;
 *   9   unknown_outcome → parked, no fallback (the OTP may already have arrived);
 *  10   definitive_failure → ask Phase 5F-C1;
 *  11   blocked → delivery_failed;
 *  12   allowed → evaluate the C2 SMS runtime infrastructure gate;
 *  13   prove the runtime SMS adapter IS the provider the decision allowed;
 *  14   check the remaining budget, then claim attempt 2 atomically;
 *  15   claim rejected → NO SMS;
 *  16   send the SAME OTP over SMS;
 *  17   finalize attempt 2;
 *  18   the hook response comes from attempt 2's outcome.
 */
export async function deliverClientLoginOtp(
  input: ClientOtpDeliveryInput,
  deps: ClientOtpDeliveryDeps = defaultClientOtpDeliveryDeps()
): Promise<ClientOtpDeliveryResult> {
  // 5a — the provider that will OWN attempt 1. Resolved BEFORE the claim so the ledger
  // records the provider that actually sent, never a guess.
  const providerKey = deps.resolveWhatsAppProviderKey();
  if (!providerKey.ok) return result(ClientOtpDeliveryKind.DELIVERY_FAILED);

  // 3 — the deterministic action identity. Never the raw webhook id, never an OTP.
  let authActionId: AuthenticationActionId;
  try {
    authActionId = deriveClientLoginActionId(input.verifiedWebhookId);
  } catch {
    return result(ClientOtpDeliveryKind.DELIVERY_FAILED);
  }

  // 4 — the non-reversible destination hash. The plaintext number stops here.
  const destinationHash = hashPhoneE164(input.phoneE164);

  const lineage = {
    authFlow: ORCHESTRATED_AUTH_FLOW,
    authActionId,
    authReferenceType: CLIENT_OTP_AUTH_REFERENCE_TYPE,
    authReferenceId: input.authUserId,
    destinationHash,
  } as const;

  // 5b — claim attempt 1 atomically.
  const claim = await deps.claimPrimaryAttempt({
    ...lineage,
    providerKey: providerKey.data,
    authUserId: input.authUserId,
  });

  const claimResult: AuthAttemptClaimResult | null = claim.ok ? claim.data : null;
  // A thrown claim is indistinguishable from an unreachable ledger: never a silent block.
  const claimOutcome = claimResult?.outcome ?? AuthAttemptClaimOutcome.DATABASE_ERROR;
  if (!primaryClaimPermitsDispatch(claimOutcome)) {
    return result(ClientOtpDeliveryKind.DELIVERY_FAILED);
  }
  const ledgerUnavailable = claimOutcome === AuthAttemptClaimOutcome.DATABASE_ERROR;
  const primaryAttemptId = ledgerUnavailable ? null : claimResult?.attemptId ?? null;

  // 6 — the WhatsApp dispatch, with the SAME OTP the caller already put in the intent.
  const service = deps.createCommunicationService();
  if (!service.ok) {
    // The provider resolved but the service could not be built. If the ledger was ALSO
    // unavailable, the degraded path is still made observable before returning.
    if (ledgerUnavailable) await emitLedgerUnavailable(deps, input, destinationHash, claimResult);
    return result(ClientOtpDeliveryKind.DELIVERY_FAILED, { ledgerUnavailable });
  }
  const sent = await service.data.send(input.buildPrimaryIntent(), { authDeadline: input.deadline });

  // 7 — finalize attempt 1 from what the transport actually reported.
  let outcome: AttemptOutcome;
  let failureCode: string | null;
  let hookKind: ClientOtpDeliveryKindValue;
  let messageId: string | null = null;

  if (!sent.ok) {
    // A local send-path refusal (template gate, lane validation). It provably never
    // reached the provider, so it is a definitive failure — and a LOCAL one.
    outcome = localFailureAttemptOutcome();
    failureCode = safeFailureCode(sent.code);
    hookKind = ClientOtpDeliveryKind.DELIVERY_FAILED;
  } else {
    outcome = mapMessageStatusToAttemptOutcome(sent.data.status);
    failureCode = safeFailureCode(sent.data.failure_code);
    hookKind = hookKindForMessageStatus(sent.data.status);
    messageId = sent.data.id;
  }

  if (primaryAttemptId) {
    await deps.finalizeAttempt({
      attemptId: primaryAttemptId,
      status: outcome.status,
      outcomeCertainty: outcome.certainty,
      failureCode,
      communicationMessageId: messageId,
    });
  }

  const base = { dispatchAttempted: true, ledgerUnavailable };

  // OBSERVABILITY: the degraded ledger path is never silent. The OTP has ALREADY been
  // dispatched above, so this can only make a rare availability incident visible — it can
  // never affect delivery. It is emitted exactly once, carries only sanitized facts (a hash,
  // a flow, a classification — never the OTP, the plaintext phone, the hash pre-image, or
  // raw database error text), and is fully best-effort: any failure is swallowed.
  if (ledgerUnavailable) {
    await emitLedgerUnavailable(deps, input, destinationHash, claimResult);
  }

  // 8 — proven acceptance. Stop. Never a fallback.
  // 9 — unknown outcome. Park. NEVER a fallback: the OTP may already have arrived.
  if (outcome.certainty !== "definitive_failure") {
    return result(hookKind, base);
  }

  // 10 — a PROVEN non-delivery. Only now may a fallback even be considered.
  const blocked = (reason: string): ClientOtpDeliveryResult =>
    result(ClientOtpDeliveryKind.DELIVERY_FAILED, { ...base, fallbackBlockedReason: reason });

  if (ledgerUnavailable || !primaryAttemptId) {
    // No claimed, finalized attempt 1 exists, so no lineage can anchor a fallback. The
    // orchestrator refuses to synthesize one.
    return blocked(OrchestratorFallbackBlockReason.LEDGER_UNAVAILABLE);
  }
  if (isLocalPreflightFailureCode(failureCode)) {
    // DENY-ONLY. A local misconfiguration must never be hidden behind a second channel.
    return blocked(OrchestratorFallbackBlockReason.LOCAL_PREFLIGHT_FAILURE);
  }

  const decision = await deps.decideAuthenticationFallback({
    authFlow: ORCHESTRATED_AUTH_FLOW,
    requestMode: AuthFallbackRequestMode.AUTOMATIC,
    primaryAttempt: {
      ...lineage,
      attemptNumber: 1,
      channel: "whatsapp",
      providerKey: providerKey.data,
      status: outcome.status,
      outcomeCertainty: outcome.certainty,
      failureCode,
    },
    attemptHistory: { authActionId, totalAttempts: 1, hasFallbackAttempt: false },
    request: lineage,
  });
  if (!decision.ok) return blocked(OrchestratorFallbackBlockReason.DECISION_READ_FAILED);

  // 11 — default deny. The policy ships operationally disabled and no failure rule exists.
  const allowed: AuthenticationFallbackDecision = decision.data;
  if (!allowed.allowed) return blocked(allowed.reason);
  const allowedProviderKey = allowed.providerKey;

  // 12 — the C2 SMS runtime infrastructure gate, evaluated for the provider the decision
  // allowed. Readiness is never authorization; this only proves the transport could carry.
  const gate: SmsRuntimeDecision = await deps.evaluateSmsRuntimeReadiness({
    providerKey: allowedProviderKey,
    channel: "sms",
    templateKey: input.buildPrimaryIntent().template_key ?? "",
    language: CLIENT_OTP_SMS_LANGUAGE,
    destinationHash,
  });
  if (gate.status !== SMS_RUNTIME_READY) {
    return blocked(OrchestratorFallbackBlockReason.SMS_RUNTIME_BLOCKED);
  }

  // 13 — PROVIDER IDENTITY. `createRuntimeSmsProvider` fences the adapter against the C2
  // candidate; this independently fences it against the provider C1's decision allowed.
  // A factory that throws (missing config, unknown candidate) fails the fallback closed.
  let smsProvider;
  try {
    const built = deps.createRuntimeSmsProvider(runtimeSmsAdapterFactory, process.env);
    if (!built.ok) return blocked(OrchestratorFallbackBlockReason.SMS_PROVIDER_UNAVAILABLE);
    smsProvider = built.data;
  } catch {
    return blocked(OrchestratorFallbackBlockReason.SMS_PROVIDER_UNAVAILABLE);
  }
  if (smsProvider.providerKey !== allowedProviderKey || smsProvider.channel !== "sms") {
    return blocked(OrchestratorFallbackBlockReason.SMS_PROVIDER_IDENTITY_MISMATCH);
  }

  // 14a — the deadline covers BOTH attempts. Below the minimum viable network budget a
  // request is not worth starting: it would abort mid-flight and park as `outcome_unknown`,
  // i.e. a possible silent second OTP. Nothing is claimed and nothing is sent.
  const remainingMs = input.deadline.remainingNetworkBudgetMs();
  if (!isViableAuthNetworkBudget(remainingMs)) {
    return blocked(OrchestratorFallbackBlockReason.BUDGET_EXHAUSTED);
  }

  // 14b — claim attempt 2 atomically. The RPC re-checks lineage, the primary's proven
  // definitive failure, the possession-flow ban and the per-action ceiling under an
  // action-scoped advisory lock, so a race can never produce two fallbacks.
  const fallbackClaim = await deps.claimFallbackAttempt({
    ...lineage,
    providerKey: allowedProviderKey,
    authUserId: input.authUserId,
    decisionReason: allowed.reason,
  });

  // 15 — a rejected claim means NO SMS. Never a send without a claim.
  if (!fallbackClaim.ok || fallbackClaim.data.outcome !== AuthAttemptClaimOutcome.CLAIMED) {
    return blocked(OrchestratorFallbackBlockReason.FALLBACK_CLAIM_REJECTED);
  }
  const fallbackAttemptId = fallbackClaim.data.attemptId;
  if (!fallbackAttemptId) return blocked(OrchestratorFallbackBlockReason.FALLBACK_CLAIM_REJECTED);

  // 16 — the SAME OTP, from request memory, over the second transport. Never regenerated.
  // The remaining budget CEILING can only shorten the adapter's abortable timeout.
  const smsResult = await smsProvider.sendAuthenticationMessage(
    input.phoneE164,
    gate.mapping.templateKey,
    { otp: input.otp },
    { maxNetworkTimeoutMs: remainingMs }
  );

  // 17 — finalize attempt 2.
  const smsOutcome = mapProviderResultToAttemptOutcome(smsResult);
  await deps.finalizeAttempt({
    attemptId: fallbackAttemptId,
    status: smsOutcome.status,
    outcomeCertainty: smsOutcome.certainty,
    failureCode: safeFailureCode(smsResult.errorCode),
  });

  // 18 — the hook response is attempt 2's outcome. There is no attempt 3.
  return result(hookKindForCertainty(smsOutcome.certainty), {
    ...base,
    smsSent: true,
    fallbackClaimed: true,
  });
}
