// ============================================================================
// QuickFurno — lib/communication/providers/whatsappProvider.ts
//
// Provider-neutral interface for all WhatsApp provider adapters.
// Matches the repository style and wraps all provider response formats
// into normalized QuickFurno shapes.
// ============================================================================

export interface WhatsAppSendResult {
  readonly accepted: boolean;
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
  readonly normalizedEventType: "accepted" | "sent" | "delivered" | "read" | "failed";
  readonly occurredAt: string;
  readonly sanitizedMetadata: Record<string, unknown>;
}

export interface WhatsAppProviderHealth {
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
   * Validates provider webhook signature authenticity.
   */
  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean;

  /**
   * Normalizes provider webhook body into unified event structure.
   */
  normalizeWebhook(
    payload: Record<string, unknown>
  ): WhatsAppWebhookEvent[];

  /**
   * Performs provider latency and health checks.
   */
  healthCheck(): Promise<WhatsAppProviderHealth>;
}
