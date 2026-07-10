// ============================================================================
// QuickFurno — lib/communication/providers/mockSmsProvider.ts  (Phase 5F-A, hardened 5F-C2)
//
// Deterministic Mock SMS Provider for tests and the dev sandbox. Bounded strictly to mock
// execution: ZERO network calls, ZERO real SMS sends, no credential.
//
// DETERMINISM CONTRACT
//   • Message ids come from a per-instance monotonic counter plus a stable hash of the
//     NON-SENSITIVE send input — never Math.random(), never Date.now().
//   • Three deterministic outcomes, each with an EXPLICIT `outcomeCertainty`:
//       accepted            — an ordinary destination.
//       definitive_failure  — a proven non-delivery (retryable or permanent).
//       unknown_outcome     — delivery can be neither proven nor disproven.
//
// SECURITY — WHAT THE MOCK RETAINS
//   The retained record keeps the template key, the variable NAMES, the deterministic
//   sequence number, and the simulated outcome. It retains NO OTP value, NO variable
//   values, NO Authorization header, NO credential, NO raw request body, and — Phase
//   5F-C2 — NO plaintext destination. The reserved test destination is compared
//   TRANSIENTLY in memory to steer the simulation and is then dropped; it never reaches
//   the retained history and never seeds a provider message id.
//
// THIS ADAPTER IS TEST/DEV ONLY. It must NEVER be registered as an active provider, and
// no production file may instantiate it. A real adapter implements the same SmsProvider
// interface in a later phase.
// ============================================================================

import crypto from "crypto";
import type { ProviderOutcomeCertainty } from "./providerOutcome";
import type {
  SmsAuthenticationSendOptions,
  SmsProvider,
  SmsProviderHealth,
  SmsSendResult,
} from "./smsProvider";

/** The one provider identity this adapter ever reports. */
export const MOCK_SMS_PROVIDER_KEY = "mock_sms";

/**
 * Reserved E.164 destinations that steer the simulation. Real numbers are never used; the
 * triggers are valid E.164 so they survive phone normalization. They are compared
 * transiently and never retained.
 */
export const MOCK_SMS_DESTINATIONS = {
  /** A PROVEN non-delivery that never reached the provider: definitive, safely retryable. */
  RETRYABLE_FAILURE: "+15550100001",
  /** A PROVEN permanent provider rejection: definitive, not retryable. */
  PERMANENT_FAILURE: "+15550100002",
  /** Delivery can be neither proven nor disproven: unknown_outcome, NEVER retried. */
  UNKNOWN_OUTCOME: "+15550100003",
} as const;

const SMS_MAX_LEN = 918; // generous multi-part ceiling; content itself is never inspected

/** The deterministic outcome a simulated send took. Non-sensitive. */
export type MockSmsOutcome = "accepted" | "definitive_failure" | "unknown_outcome";

/**
 * What the mock retained about a send. It never holds an OTP, a variable value, a
 * credential, a raw body, or a plaintext destination.
 */
export interface MockSmsSendRecord {
  readonly templateKey: string;
  /** Variable NAMES only — enough to assert templating, no values retained. */
  readonly variableKeys: readonly string[];
  /** Deterministic, non-sensitive test markers. */
  readonly sequence: number;
  readonly outcome: MockSmsOutcome;
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
    variables: Record<string, string>,
    _options: SmsAuthenticationSendOptions = {}
  ): Promise<SmsSendResult> {
    // The destination steers the simulation transiently; it is never retained. The OTP
    // value travels no further than this call frame.
    this.sendSequence += 1;
    const result = this.simulateSend(to, templateKey, variables);

    // SECURITY: variable NAMES only, no destination, no OTP, no values.
    this.lastSentRecords.push({
      templateKey,
      variableKeys: Object.keys(variables),
      sequence: this.sendSequence,
      outcome: result.outcomeCertainty as MockSmsOutcome,
    });
    return result;
  }

  private failure(
    errorCode: string,
    errorMessage: string,
    outcomeCertainty: ProviderOutcomeCertainty,
    retryable: boolean
  ): SmsSendResult {
    return {
      accepted: false,
      provider: this.providerKey,
      channel: "sms",
      providerMessageId: null,
      normalizedStatus: "failed",
      errorCode,
      errorMessage,
      retryable,
      outcomeCertainty,
    };
  }

  private simulateSend(
    to: string,
    templateKey: string,
    variables: Record<string, string>
  ): SmsSendResult {
    if (to === MOCK_SMS_DESTINATIONS.RETRYABLE_FAILURE) {
      // Provably never reached the provider, so a resend cannot duplicate a message.
      return this.failure(
        "MOCK_SMS_RETRYABLE",
        "Mock SMS transient failure (proven: never reached the provider).",
        "definitive_failure",
        true
      );
    }
    if (to === MOCK_SMS_DESTINATIONS.PERMANENT_FAILURE) {
      return this.failure(
        "MOCK_SMS_PERMANENT",
        "Mock SMS permanent rejection.",
        "definitive_failure",
        false
      );
    }
    if (to === MOCK_SMS_DESTINATIONS.UNKNOWN_OUTCOME) {
      // The provider may already have delivered. NEVER retried, never fallback-eligible.
      return this.failure(
        "MOCK_SMS_UNKNOWN_OUTCOME",
        "Mock SMS outcome could be neither proven nor disproven.",
        "unknown_outcome",
        false
      );
    }

    // Deterministic id: monotonic counter + stable hash of the NON-SENSITIVE send input.
    // Neither the OTP value nor the destination participates.
    const idSeed = stableHash({
      seq: this.sendSequence,
      templateKey,
      keys: Object.keys(variables).sort(),
    });
    return {
      accepted: true,
      provider: this.providerKey,
      channel: "sms",
      providerMessageId: `mock-sms-${this.sendSequence}-${idSeed.slice(0, 12)}`,
      normalizedStatus: "accepted",
      errorCode: null,
      errorMessage: null,
      retryable: false,
      outcomeCertainty: "accepted",
    };
  }

  async healthCheck(): Promise<SmsProviderHealth> {
    // Deterministic, no clock dependency beyond a fixed ISO stamp; a mock is always
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
