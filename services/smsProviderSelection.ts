// ============================================================================
// QuickFurno — services/smsProviderSelection.ts   (Phase 5F-C2, server-only)
//
// Controlled, LAZY SMS provider selection.
//
// This is PROVIDER SELECTION ONLY. It is not an authentication authority, not a fallback
// authority, not an attempt authority, and not a business policy authority. Selecting a
// provider is never permission to send: an SMS dispatch would additionally have to pass
// the SMS runtime infrastructure gate AND Phase 5F-C1's fallback decision, failure rule,
// attempt budget and atomic attempt claim.
//
// NO COMMERCIAL PROVIDER IS CHOSEN. The mode vocabulary is closed and contains exactly one
// value — `mock` — which is the deterministic test/dev adapter. There is no MSG91, Exotel,
// Twilio, Gupshup, Kaleyra, Plivo, Vonage or AWS SNS mode, and none may be added here
// without the C3 review.
//
// Consequently PRODUCTION ALWAYS FAILS CLOSED — including on an explicit `mock`, which
// must never send a live OTP. Selection is resolved at RUNTIME, never at import time, so a
// missing environment variable can never break the build.
//
// It returns a CANDIDATE DESCRIPTOR, not an adapter instance: Phase 5F-C2 constructs no
// SMS provider anywhere in production code.
// ============================================================================

import { MOCK_SMS_PROVIDER_KEY } from "../lib/communication/providers/mockSmsProvider";

export const SMS_PROVIDER_MODE_ENV = "SMS_PROVIDER_MODE";

/** The CLOSED mode vocabulary. Exactly one value exists in Phase 5F-C2. */
export const SmsProviderMode = {
  MOCK: "mock",
} as const;

export type SmsProviderModeValue = (typeof SmsProviderMode)[keyof typeof SmsProviderMode];

export const KNOWN_SMS_PROVIDER_MODES: readonly SmsProviderModeValue[] = Object.freeze(
  Object.values(SmsProviderMode)
);

export const SmsSelectionBlockReason = {
  /** Production with no explicit mode: never an accidental implicit mock. */
  MODE_REQUIRED_IN_PRODUCTION: "mode_required_in_production",
  /** Production with an explicit mock: a mock must never carry a live OTP. */
  MOCK_FORBIDDEN_IN_PRODUCTION: "mock_forbidden_in_production",
  /** Any mode outside the closed vocabulary. Never downgraded to mock. */
  UNSUPPORTED_PROVIDER_MODE: "unsupported_provider_mode",
} as const;

export type SmsSelectionBlockReasonValue =
  (typeof SmsSelectionBlockReason)[keyof typeof SmsSelectionBlockReason];

/**
 * The selected candidate. An IDENTITY, never an adapter instance — Phase 5F-C2 sends
 * nothing, so it constructs nothing.
 */
export interface SmsProviderCandidate {
  readonly mode: SmsProviderModeValue;
  readonly providerKey: string;
  readonly channel: "sms";
  /** True only for the deterministic test/dev adapter. */
  readonly isMock: true;
}

export type SmsProviderSelection =
  | { readonly ok: true; readonly candidate: SmsProviderCandidate }
  | { readonly ok: false; readonly reason: SmsSelectionBlockReasonValue; readonly variable: string };

type EnvSource = Record<string, string | undefined>;

function readTrimmed(env: EnvSource, name: string): string | null {
  const raw = env[name];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

const MOCK_CANDIDATE: SmsProviderCandidate = Object.freeze({
  mode: SmsProviderMode.MOCK,
  providerKey: MOCK_SMS_PROVIDER_KEY,
  channel: "sms",
  isMock: true,
});

/**
 * Select the SMS provider candidate for the current environment. LAZY: called per request,
 * never at module import.
 *
 *   NON-PRODUCTION
 *     mode absent      → controlled mock
 *     explicit `mock`  → controlled mock
 *     unknown mode     → FAIL CLOSED
 *
 *   PRODUCTION (no commercial provider exists yet)
 *     mode absent      → FAIL CLOSED (mode_required_in_production)
 *     explicit `mock`  → FAIL CLOSED (mock_forbidden_in_production)
 *     unknown mode     → FAIL CLOSED (unsupported_provider_mode)
 *
 * There is NO implicit mock fallback in production, and an unknown mode never silently
 * becomes mock.
 */
export function selectSmsProvider(env: EnvSource = process.env): SmsProviderSelection {
  const raw = readTrimmed(env, SMS_PROVIDER_MODE_ENV);
  const isProduction = readTrimmed(env, "NODE_ENV") === "production";

  if (isProduction) {
    if (raw === null) {
      return { ok: false, reason: SmsSelectionBlockReason.MODE_REQUIRED_IN_PRODUCTION, variable: SMS_PROVIDER_MODE_ENV };
    }
    if (raw === SmsProviderMode.MOCK) {
      return { ok: false, reason: SmsSelectionBlockReason.MOCK_FORBIDDEN_IN_PRODUCTION, variable: SMS_PROVIDER_MODE_ENV };
    }
    return { ok: false, reason: SmsSelectionBlockReason.UNSUPPORTED_PROVIDER_MODE, variable: SMS_PROVIDER_MODE_ENV };
  }

  if (raw === null || raw === SmsProviderMode.MOCK) {
    return { ok: true, candidate: MOCK_CANDIDATE };
  }
  return { ok: false, reason: SmsSelectionBlockReason.UNSUPPORTED_PROVIDER_MODE, variable: SMS_PROVIDER_MODE_ENV };
}

/** True only when a candidate could be selected. Never a "maybe". */
export function isSmsProviderSelected(selection: SmsProviderSelection): boolean {
  return selection.ok === true;
}
