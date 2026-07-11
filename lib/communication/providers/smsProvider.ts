// ============================================================================
// QuickFurno — lib/communication/providers/smsProvider.ts   (Phase 5F-A, hardened 5F-C2)
//
// Provider-neutral interface for SMS provider adapters. FOUNDATION ONLY: no real SMS is
// sent, no SMS provider is activated, no commercial vendor is chosen, and
// CommunicationService does NOT route SMS. This contract exists so a future real adapter
// (Phase 5F-C3/C4) drops in without inventing a new shape or leaking a provider literal
// into business logic.
//
// A future real adapter is added by implementing this interface — the `"mock_sms"`
// literal appears only inside the mock adapter (see `providerKey`).
//
// PHASE 5F-C2 HARDENING
//   • `outcomeCertainty` is REQUIRED on every result, using the ONE generic vocabulary in
//     `providerOutcome.ts`. Certainty is never inferred from `accepted`, `retryable`, an
//     HTTP status, a timeout, or a thrown exception.
//   • An authentication send may carry a `maxNetworkTimeoutMs` CEILING. It may only ever
//     SHORTEN the adapter's configured timeout — never extend it.
//   • A real adapter MUST use the repository's abortable `HttpTransport` (AbortController
//     cancels the ACTUAL request). A `Promise.race` pseudo-timeout is forbidden: it
//     rejects the waiter while the request keeps running, which is a duplicate-OTP hazard.
//
// SECURITY: the OTP is highly confidential — never logged, stored, or echoed. Result and
// health shapes carry only sanitized, non-secret operational fields: no OTP, no raw
// provider payload, no provider secret, no Authorization header, no response body.
// ============================================================================

import { effectiveRequestTimeoutMs } from "../httpTransport";
import type { ProviderOutcomeCertainty } from "./providerOutcome";

/** Re-exported so an SMS adapter never imports the certainty type from a WhatsApp module. */
export type { ProviderOutcomeCertainty };

/** Normalized SMS lifecycle vocabulary shared by every SMS adapter. */
export type SmsNormalizedStatus = "queued" | "accepted" | "sent" | "delivered" | "failed";

export interface SmsSendResult {
  readonly accepted: boolean;
  /** Always the emitting adapter's `providerKey`. */
  readonly provider: string;
  /** Always `"sms"`. */
  readonly channel: "sms";
  readonly providerMessageId: string | null;
  readonly normalizedStatus: SmsNormalizedStatus;
  /** Ledger-safe: an allowlisted identifier only, never a raw provider error code dump. */
  readonly errorCode: string | null;
  /** Ledger-safe: an allowlisted identifier sentence only, never a raw provider error. */
  readonly errorMessage: string | null;
  /**
   * True ONLY when the request provably never reached the provider. It is a transport
   * hint, never an authentication attempt budget: Phase 5F-C1's ledger caps every
   * authentication action at two transport attempts, and nothing resends here.
   */
  readonly retryable: boolean;
  /**
   * REQUIRED (Phase 5F-C2). `accepted` ⟺ `accepted === true`. An explicit provider
   * rejection or a PROVEN pre-connect failure is `definitive_failure`. A timeout / abort /
   * ambiguous network / ambiguous 5xx / 2xx-without-a-usable-id is `unknown_outcome` and
   * is NEVER retry authorization and NEVER fallback authorization.
   */
  readonly outcomeCertainty: ProviderOutcomeCertainty;
}

/**
 * Per-send options for an authentication SMS.
 *
 * `maxNetworkTimeoutMs` is a CEILING supplied by an enclosing request deadline. It may
 * only SHORTEN the adapter's configured timeout; it can never extend it. The clamped value
 * still drives the AbortController, so a timed-out request is genuinely cancelled.
 */
export interface SmsAuthenticationSendOptions {
  readonly maxNetworkTimeoutMs?: number | null;
}

/**
 * The single definition of "the effective SMS request timeout": never above the adapter's
 * configured timeout, never above a caller-supplied ceiling. Absent a ceiling the
 * configured value is used unchanged.
 */
export function resolveSmsNetworkTimeoutMs(
  configuredMs: number,
  options: SmsAuthenticationSendOptions = {}
): number {
  return effectiveRequestTimeoutMs(configuredMs, options.maxNetworkTimeoutMs);
}

export interface SmsProviderHealth {
  /** Always the emitting adapter's `providerKey`. */
  readonly provider: string;
  readonly channel: "sms";
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly status: "healthy" | "unhealthy";
  readonly checkedAt: string;
  readonly latencyMs: number | null;
  readonly detailsSanitized: Record<string, unknown>;
}

/**
 * A QuickFurno-RESOLVED authentication SMS (Phase 5F-C3-C-1). Provider-neutral: it carries
 * DELIVERY FACTS only, and QuickFurno — never the provider — decides the message content.
 *
 *   • `messageBody` is already rendered by the reviewed, code-owned renderer with the OTP
 *     substituted in. The provider forwards it verbatim; it never re-renders or edits it. It
 *     is highly confidential (it contains the OTP) and is never logged, stored, or echoed.
 *   • `providerTemplateName` / `providerTemplateId` are the approved provider template
 *     identity the runtime mapping resolved (a readiness fact). A provider forwards them to
 *     any regulatory registry it must satisfy (e.g. India DLT); it never derives or invents
 *     them, and their presence is not proof of approval.
 *
 * ONE TEMPLATE-IDENTITY AUTHORITY, NO FALLBACK. For the authentication resolved-send path the
 * DLT content-template identity follows exactly ONE chain:
 *   reviewed QuickFurno template → runtime mapping → `providerTemplateId` → this descriptor →
 *   the provider's template id.
 * `providerTemplateId` is therefore REQUIRED and non-empty: the renderer fails closed when the
 * runtime mapping lacks a usable id rather than emit a descriptor a provider could rescue from
 * its own configuration. Account-level registry ids (e.g. a DLT ENTITY id) live in the
 * provider's OWN config and are NOT part of this neutral contract — and a provider must never
 * substitute a config template id for a missing `providerTemplateId`.
 */
export interface ResolvedAuthenticationSms {
  readonly messageBody: string;
  readonly providerTemplateName: string;
  readonly providerTemplateId: string;
}

export interface SmsProvider {
  /**
   * Stable provider identity persisted on communication_messages.provider. The single
   * source of the provider name — services must never hardcode a literal.
   */
  readonly providerKey: string;

  /** Every SMS adapter reports channel `"sms"`. */
  readonly channel: "sms";

  /**
   * Dispatches a sensitive authentication OTP over SMS. The OTP value is highly
   * confidential and is never logged, stored, or echoed. (Business SMS is NOT part of this
   * foundation — no `sendTemplateMessage` is defined.)
   *
   * A real adapter must honour `options.maxNetworkTimeoutMs` as a ceiling and abort the
   * ACTUAL request via `HttpTransport`. It must never loop or resend internally.
   */
  sendAuthenticationMessage(
    to: string,
    templateKey: string,
    variables: Record<string, string>,
    options?: SmsAuthenticationSendOptions
  ): Promise<SmsSendResult>;

  /**
   * Dispatches a QuickFurno-RESOLVED authentication OTP (Phase 5F-C3-C-1). The body is
   * already rendered from a reviewed, code-owned template — the provider decides NONE of the
   * QuickFurno message content; it only formats and delivers the transport request. Same OTP
   * secrecy rules (never logged/stored/echoed), same `outcomeCertainty` vocabulary, same
   * `maxNetworkTimeoutMs` ceiling, and the same one-request rule: it must never loop, resend,
   * or make more than one request.
   *
   * This is the ONLY method that can put an authentication SMS on the wire. A real adapter
   * (e.g. Exotel) that needs an approved registered content descriptor refuses
   * {@link sendAuthenticationMessage} (a bare template key) and delivers only here.
   */
  sendResolvedAuthenticationSms(
    to: string,
    resolved: ResolvedAuthenticationSms,
    options?: SmsAuthenticationSendOptions
  ): Promise<SmsSendResult>;

  /** Latency/health check. Returns only sanitized, non-secret details. */
  healthCheck(): Promise<SmsProviderHealth>;
}
