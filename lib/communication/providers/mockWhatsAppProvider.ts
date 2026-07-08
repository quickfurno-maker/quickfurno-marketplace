// ============================================================================
// QuickFurno — lib/communication/providers/mockWhatsAppProvider.ts
//
// Mock WhatsApp Provider implementation for tests and dev sandbox.
// Bounded strictly to mock execution: zero network calls, zero SMS/WhatsApp sends.
// Supports deterministic success, retryable failure, and permanent failure.
// ============================================================================

import type {
  WhatsAppProvider,
  WhatsAppProviderHealth,
  WhatsAppSendResult,
  WhatsAppWebhookEvent,
} from "./whatsappProvider";
import { sanitizeAuthSecurityMetadata } from "../../identity/authSecurityEvent";

export class MockWhatsAppProvider implements WhatsAppProvider {
  private lastSentPayloads: Array<{ to: string; templateKey: string; variables: Record<string, string> }> = [];

  getLastSentPayloads() {
    return this.lastSentPayloads;
  }

  clearLastSentPayloads() {
    this.lastSentPayloads = [];
  }

  async sendAuthenticationMessage(
    to: string,
    templateKey: string,
    variables: Record<string, string>
  ): Promise<WhatsAppSendResult> {
    // SECURITY: sanitize variables so no plaintext OTP is stored in debug logs or properties
    const sanitizedVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
      if (
        /(otp|pass|code|secret|token|key|auth|header)/i.test(key) &&
        !/hash/i.test(key)
      ) {
        sanitizedVars[key] = "[REDACTED_OTP]";
      } else {
        sanitizedVars[key] = value;
      }
    }

    this.lastSentPayloads.push({ to, templateKey, variables: sanitizedVars });

    return this.simulateSend(to);
  }

  async sendTemplateMessage(
    to: string,
    templateKey: string,
    variables: Record<string, string>
  ): Promise<WhatsAppSendResult> {
    // SECURITY: sanitize variables
    const sanitizedVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
      if (
        /(otp|pass|code|secret|token|key|auth|header)/i.test(key) &&
        !/hash/i.test(key)
      ) {
        sanitizedVars[key] = "[REDACTED]";
      } else {
        sanitizedVars[key] = value;
      }
    }

    this.lastSentPayloads.push({ to, templateKey, variables: sanitizedVars });

    return this.simulateSend(to);
  }

  private simulateSend(to: string): WhatsAppSendResult {
    const cleanTo = to.trim();

    if (cleanTo.includes("fail-retry")) {
      return {
        accepted: false,
        provider: "mock",
        providerMessageId: null,
        normalizedStatus: "failed",
        errorCode: "RATE_LIMIT_EXCEEDED",
        errorMessage: "Simulated mock provider rate limit exceeded",
        retryable: true,
      };
    }

    if (cleanTo.includes("fail-permanent")) {
      return {
        accepted: false,
        provider: "mock",
        providerMessageId: null,
        normalizedStatus: "failed",
        errorCode: "INVALID_DESTINATION_NUMBER",
        errorMessage: "Simulated mock provider invalid recipient destination",
        retryable: false,
      };
    }

    // Success simulation
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    const mockId = `mock-msg-${Date.now()}-${randomSuffix}`;

    return {
      accepted: true,
      provider: "mock",
      providerMessageId: mockId,
      normalizedStatus: "accepted",
      errorCode: null,
      errorMessage: null,
      retryable: false,
    };
  }

  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    if (!signature || !secret) return false;
    // Mock signature verification check
    return signature === "mock-valid-signature" || signature.startsWith("sha256=");
  }

  normalizeWebhook(payload: Record<string, unknown>): WhatsAppWebhookEvent[] {
    const eventId = String(payload.event_id || payload.eventId || `mock-evt-${Math.random()}`);
    const messageId = String(payload.message_id || payload.messageId || "");
    const status = String(payload.status || "delivered");
    const occurredAt = String(payload.timestamp || new Date().toISOString());

    const allowedStatuses = ["accepted", "sent", "delivered", "read", "failed"] as const;
    const normalizedEventType = allowedStatuses.includes(status as any)
      ? (status as any)
      : "delivered";

    const rawMeta = (payload.metadata as Record<string, unknown>) || {};
    const sanitizedMetadata = sanitizeAuthSecurityMetadata(rawMeta);

    return [
      {
        providerEventId: eventId,
        providerMessageId: messageId,
        normalizedEventType,
        occurredAt,
        sanitizedMetadata,
      },
    ];
  }

  async healthCheck(): Promise<WhatsAppProviderHealth> {
    return {
      provider: "mock",
      configured: true,
      reachable: true,
      status: "healthy",
      checkedAt: new Date().toISOString(),
      latencyMs: 12,
      detailsSanitized: { info: "Mock provider online" },
    };
  }
}
