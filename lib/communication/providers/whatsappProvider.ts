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

import type { ProviderOutcomeCertainty } from "./providerOutcome";

/**
 * Safe outcome-certainty vocabulary (Phase 5F-B), now defined once for EVERY channel in
 * `providerOutcome.ts` (Phase 5F-C2). `unknown_outcome` (timeout / ambiguous / 5xx) is
 * NEVER automatically fallback-eligible and must not be auto-resent inside an adapter.
 *
 * Re-exported under its historical name so every existing WhatsApp import — the Meta
 * adapter, `providerError.ts`, `communicationService.ts` — keeps working unchanged.
 */
export type { ProviderOutcomeCertainty };

/**
 * The certainty helpers, re-exported under their historical WhatsApp names. There is ONE
 * implementation (`providerOutcome.ts`), so the SMS contract can never drift into a weaker
 * copy of these rules.
 */
export {
  isContradictoryProviderOutcome as isContradictorySendResult,
  effectiveProviderOutcomeCertainty as effectiveOutcomeCertainty,
} from "./providerOutcome";

/** Normalized delivery lifecycle vocabulary shared by every provider adapter. */
export type WhatsAppNormalizedEventType = "accepted" | "sent" | "delivered" | "read" | "failed";

/**
 * How an adapter resolves the template it sends — a capability, so business logic
 * branches on the MODE, never on `providerKey === "mock"`.
 *   internal_template         — send by internal template key (mock).
 *   approved_provider_mapping — REQUIRE an approved, active provider mapping (Meta).
 */
export type ProviderTemplateResolutionMode = "internal_template" | "approved_provider_mapping";

export interface WhatsAppSendResult {
  readonly accepted: boolean;
  /** Always the emitting adapter's `providerKey`. */
  readonly provider: string;
  readonly providerMessageId: string | null;
  readonly normalizedStatus: "queued" | "accepted" | "sent" | "delivered" | "read" | "failed";
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly retryable: boolean;
  /**
   * REQUIRED (Phase 5F-B): every provider result explicitly declares its certainty.
   * `accepted` ⟺ accepted=true; a deterministic provider rejection or a preflight/
   * config rejection is `definitive_failure`; a timeout/abort/network/ambiguous-5xx/
   * 2xx-without-id is `unknown_outcome`. Never derived into an automatic fallback
   * here — Phase 5F-C owns any fallback decision.
   */
  readonly outcomeCertainty: ProviderOutcomeCertainty;
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
   * How this adapter resolves the template it sends (Phase 5F-B capability). Lets
   * callers branch on the MODE instead of hardcoding `providerKey === "mock"`.
   */
  readonly templateResolutionMode: ProviderTemplateResolutionMode;

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
