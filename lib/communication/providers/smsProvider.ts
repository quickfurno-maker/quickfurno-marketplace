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

  /** Latency/health check. Returns only sanitized, non-secret details. */
  healthCheck(): Promise<SmsProviderHealth>;
}
