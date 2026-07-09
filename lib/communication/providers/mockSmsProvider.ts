// ============================================================================
// QuickFurno — lib/communication/providers/mockSmsProvider.ts   (Phase 5F-A)
//
// Deterministic Mock SMS Provider for tests and the dev sandbox. Bounded strictly
// to mock execution: ZERO network calls, ZERO real SMS sends, no credential.
//
// DETERMINISM CONTRACT
//   • Message ids come from a per-instance monotonic counter plus a stable hash of
//     the send input — never Math.random(), never Date.now() (the timestamp is
//     injectable for tests).
//   • The retained record keeps variable NAMES only. The OTP value travels to the
//     (mock) provider call and NOWHERE else — it is never logged or retained.
//
// THIS ADAPTER IS TEST/DEV ONLY. It must NEVER be registered as an active provider,
// and Phase 5F-A does not wire any SMS send path. A real adapter implements the
// same SmsProvider interface in a later phase.
// ============================================================================

import crypto from "crypto";
import type {
  SmsProvider,
  SmsProviderHealth,
  SmsSendResult,
} from "./smsProvider";

/** The one provider identity this adapter ever reports. */
export const MOCK_SMS_PROVIDER_KEY = "mock_sms";

/**
 * Reserved E.164 destinations that steer the simulation. Real numbers are never
 * used; the triggers are valid E.164 so they survive phone normalization.
 */
export const MOCK_SMS_DESTINATIONS = {
  /** Returns a retryable failure result (never reached the provider). */
  RETRYABLE_FAILURE: "+15550100001",
  /** Returns a permanent failure result. */
  PERMANENT_FAILURE: "+15550100002",
} as const;

const SMS_MAX_LEN = 918; // generous multi-part ceiling; content itself is never inspected

/** What the mock retained about a send. Never holds an OTP or any plaintext secret. */
export interface MockSmsSendRecord {
  readonly to: string;
  readonly templateKey: string;
  /** Variable NAMES only — enough to assert templating, no values retained. */
  readonly variableKeys: readonly string[];
}

/** Stable, order-independent hash of an arbitrary JSON-ish value. */
function stableHash(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
  return `{${entries.join(",")}}`;
}

export class MockSmsProvider implements SmsProvider {
  readonly providerKey = MOCK_SMS_PROVIDER_KEY;
  readonly channel = "sms" as const;

  private sendSequence = 0;
  private lastSentRecords: MockSmsSendRecord[] = [];

  getLastSentRecords(): readonly MockSmsSendRecord[] {
    return this.lastSentRecords;
  }

  reset(): void {
    this.sendSequence = 0;
    this.lastSentRecords = [];
  }

  async sendAuthenticationMessage(
    to: string,
    templateKey: string,
    variables: Record<string, string>
  ): Promise<SmsSendResult> {
    // SECURITY: retain variable NAMES only — the OTP value is never logged/retained.
    this.lastSentRecords.push({
      to,
      templateKey,
      variableKeys: Object.keys(variables),
    });
    return this.simulateSend(to, templateKey, variables);
  }

  private simulateSend(
    to: string,
    templateKey: string,
    variables: Record<string, string>
  ): SmsSendResult {
    if (to === MOCK_SMS_DESTINATIONS.RETRYABLE_FAILURE) {
      return {
        accepted: false,
        provider: this.providerKey,
        channel: "sms",
        providerMessageId: null,
        normalizedStatus: "failed",
        errorCode: "MOCK_SMS_RETRYABLE",
        errorMessage: "Mock SMS transient failure (never reached the provider).",
        retryable: true,
      };
    }
    if (to === MOCK_SMS_DESTINATIONS.PERMANENT_FAILURE) {
      return {
        accepted: false,
        provider: this.providerKey,
        channel: "sms",
        providerMessageId: null,
        normalizedStatus: "failed",
        errorCode: "MOCK_SMS_PERMANENT",
        errorMessage: "Mock SMS permanent rejection.",
        retryable: false,
      };
    }

    // Deterministic id: monotonic counter + stable hash of the send input (never
    // the OTP value — only the variable names participate).
    this.sendSequence += 1;
    const idSeed = stableHash({ seq: this.sendSequence, to, templateKey, keys: Object.keys(variables).sort() });
    return {
      accepted: true,
      provider: this.providerKey,
      channel: "sms",
      providerMessageId: `mock-sms-${this.sendSequence}-${idSeed.slice(0, 12)}`,
      normalizedStatus: "accepted",
      errorCode: null,
      errorMessage: null,
      retryable: false,
    };
  }

  async healthCheck(): Promise<SmsProviderHealth> {
    // Deterministic, no clock dependency beyond an ISO stamp; a mock is always
    // "configured" but never a live provider.
    return {
      provider: this.providerKey,
      channel: "sms",
      configured: true,
      reachable: true,
      status: "healthy",
      checkedAt: new Date(0).toISOString(),
      latencyMs: 0,
      detailsSanitized: { adapter: "mock", note: "test/dev only — never a live SMS sender" },
    };
  }

  /** Content-length ceiling helper (content itself is never inspected/logged). */
  static isWithinLengthCeiling(text: string): boolean {
    return typeof text === "string" && text.length <= SMS_MAX_LEN;
  }
}
