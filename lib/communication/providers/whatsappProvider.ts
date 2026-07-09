// ============================================================================
// QuickFurno — lib/communication/providers/whatsappProvider.ts
//
// Provider-neutral interface for all WhatsApp provider adapters.
// Matches the repository style and wraps all provider response formats
// into normalized QuickFurno shapes.
//
// A future real provider is added by implementing this interface — no
// communication business logic changes, and no `"mock"` literal appears
// anywhere outside the mock adapter itself (see `providerKey`).
// ============================================================================

/** Normalized delivery lifecycle vocabulary shared by every provider adapter. */
export type WhatsAppNormalizedEventType = "accepted" | "sent" | "delivered" | "read" | "failed";

export interface WhatsAppSendResult {
  readonly accepted: boolean;
  /** Always the emitting adapter's `providerKey`. */
  readonly provider: string;
  readonly providerMessageId: string | null;
  readonly normalizedStatus: "queued" | "accepted" | "sent" | "delivered" | "read" | "failed";
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly retryable: boolean;
}

export interface WhatsAppWebhookEvent {
  readonly providerEventId: string;
  readonly providerMessageId: string;
  readonly normalizedEventType: WhatsAppNormalizedEventType;
  readonly occurredAt: string;
  readonly sanitizedMetadata: Record<string, unknown>;
}

export interface WhatsAppProviderHealth {
  /** Always the emitting adapter's `providerKey`. */
  readonly provider: string;
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly status: "healthy" | "unhealthy";
  readonly checkedAt: string;
  readonly latencyMs: number | null;
  readonly detailsSanitized: Record<string, unknown>;
}

export interface WhatsAppProvider {
  /**
   * Stable provider identity persisted on communication_messages.provider,
   * webhook receipts and delivery events. The single source of the provider
   * name — communication services must never hardcode a provider literal.
   */
  readonly providerKey: string;

  /**
   * The transport channel this adapter serves — always `"whatsapp"`. Made
   * explicit (Phase 5F-A) so CommunicationService can assert a message's channel
   * matches the active provider's channel before dispatch, and never sends an
   * sms/rcs message over the WhatsApp adapter.
   */
  readonly channel: "whatsapp";

  /**
   * Dispatches sensitive authentication OTP messages.
   * OTP values are treated as highly confidential and are not logged or stored.
   */
  sendAuthenticationMessage(
    to: string,
    templateKey: string,
    variables: Record<string, string>
  ): Promise<WhatsAppSendResult>;

  /**
   * Dispatches general business notification/alert messages.
   */
  sendTemplateMessage(
    to: string,
    templateKey: string,
    variables: Record<string, string>
  ): Promise<WhatsAppSendResult>;

  /**
   * Validates provider webhook signature authenticity against the RAW request
   * body — never a re-serialized object, whose key order the provider did not
   * sign. Implementations must compare in constant time.
   */
  verifyWebhookSignature(
    rawBody: string,
    signature: string,
    secret: string
  ): boolean;

  /**
   * Deterministically derives the provider's event id for a webhook payload.
   * Used to key the webhook receipt before the payload is normalized. Must be a
   * pure function of the payload: the same payload always yields the same id.
   */
  deriveWebhookEventId(payload: Record<string, unknown>): string;

  /**
   * Normalizes a provider webhook body into unified event structures. Must be a
   * pure function of the payload — no clock, no randomness.
   *
   * Events the adapter cannot map safely (unknown status, missing message id,
   * missing timestamp) MUST be dropped, never coerced onto a lifecycle state.
   * Returning `[]` tells the service the payload carried nothing actionable.
   */
  normalizeWebhook(
    payload: Record<string, unknown>
  ): WhatsAppWebhookEvent[];

  /**
   * Performs provider latency and health checks.
   */
  healthCheck(): Promise<WhatsAppProviderHealth>;
}
