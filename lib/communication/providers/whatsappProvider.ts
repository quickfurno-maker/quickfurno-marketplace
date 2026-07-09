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

/**
 * Safe outcome-certainty vocabulary (Phase 5F-B), aligned with the Phase 5F-A auth
 * transport vocabulary. `unknown_outcome` (timeout / ambiguous / 5xx) is NEVER
 * automatically fallback-eligible and must not be auto-resent inside an adapter.
 */
export type ProviderOutcomeCertainty = "accepted" | "definitive_failure" | "unknown_outcome";

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

/**
 * A provider result is CONTRADICTORY when a PRESENT certainty disagrees with the
 * acceptance flag — e.g. `accepted=true` with a non-`accepted` certainty, or
 * `accepted=false` with `accepted` certainty. A contradictory result must never be
 * treated as a normal success; callers fold it into a conservative `unknown_outcome`.
 * An ABSENT certainty is not contradictory here — the defensive path in
 * {@link effectiveOutcomeCertainty} handles it conservatively.
 */
export function isContradictorySendResult(result: WhatsAppSendResult): boolean {
  if (!result.outcomeCertainty) return false;
  const acceptedCertainty = result.outcomeCertainty === "accepted";
  return result.accepted !== acceptedCertainty;
}

/** The certainty values that are recognised at runtime. */
const KNOWN_OUTCOME_CERTAINTIES: readonly ProviderOutcomeCertainty[] = ["accepted", "definitive_failure", "unknown_outcome"];

/**
 * The effective certainty of a result, failing CONSERVATIVE. The field is required at
 * the type level; this is the defensive RUNTIME path for a legacy/duck-typed/unsafe
 * result. Certainty is NEVER inferred from `result.accepted`:
 *   • missing or invalid certainty → `unknown_outcome` (never `accepted`, never
 *     `definitive_failure`).
 *   • present but contradictory (disagrees with `accepted`) → `unknown_outcome`.
 *   • otherwise the declared certainty.
 */
export function effectiveOutcomeCertainty(result: WhatsAppSendResult): ProviderOutcomeCertainty {
  const c = result.outcomeCertainty;
  if (!KNOWN_OUTCOME_CERTAINTIES.includes(c)) return "unknown_outcome";
  if (isContradictorySendResult(result)) return "unknown_outcome";
  return c;
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
