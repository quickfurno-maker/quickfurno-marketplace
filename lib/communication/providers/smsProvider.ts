// ============================================================================
// QuickFurno — lib/communication/providers/smsProvider.ts   (Phase 5F-A)
//
// Provider-neutral interface for SMS provider adapters. FOUNDATION ONLY: no real
// SMS is sent in Phase 5F-A, no SMS provider is activated, and CommunicationService
// does NOT yet route SMS. This contract exists so a future real adapter (and the
// Phase 5F-C authentication transport router) drop in without inventing a new
// shape or leaking a provider literal into business logic.
//
// A future real adapter is added by implementing this interface — the `"mock"`
// literal appears only inside the mock adapter (see `providerKey`).
//
// SECURITY: the OTP is treated as highly confidential — never logged, stored, or
// echoed. Result/health shapes carry only sanitized, non-secret fields.
// ============================================================================

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
  readonly errorCode: string | null;
  /** Ledger-safe: an allowlisted identifier sentence only, never a raw provider error. */
  readonly errorMessage: string | null;
  /** True only when the request provably never reached the provider. */
  readonly retryable: boolean;
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
   * Stable provider identity persisted on communication_messages.provider. The
   * single source of the provider name — services must never hardcode a literal.
   */
  readonly providerKey: string;

  /** Every SMS adapter reports channel `"sms"`. */
  readonly channel: "sms";

  /**
   * Dispatches a sensitive authentication OTP over SMS. The OTP value is highly
   * confidential and is never logged, stored, or echoed. (Business SMS is NOT part
   * of this phase — no `sendTemplateMessage` is defined yet.)
   */
  sendAuthenticationMessage(
    to: string,
    templateKey: string,
    variables: Record<string, string>
  ): Promise<SmsSendResult>;

  /** Latency/health check. Returns only sanitized, non-secret details. */
  healthCheck(): Promise<SmsProviderHealth>;
}
