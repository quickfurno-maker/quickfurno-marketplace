// ============================================================================
// QuickFurno — services/smsProviderSelection.ts   (Phase 5F-C2, extended 5F-C3-A)
//
// Controlled, LAZY SMS provider selection.
//
// This is PROVIDER SELECTION ONLY. It is not an authentication authority, not a fallback
// authority, not an attempt authority, and not a business policy authority. Selecting a
// provider is never permission to send: an SMS dispatch would additionally have to pass
// the SMS runtime infrastructure gate AND Phase 5F-C1's fallback decision, failure rule,
// attempt budget and atomic attempt claim.
//
// PHASE 5F-C3-A — the mode vocabulary gains EXACTLY ONE reviewed value, `exotel_sms`, and
// remains CLOSED. There is no MSG91, Twilio, Gupshup, Kaleyra, Plivo, Vonage or AWS SNS
// mode, no alias, and no normalization: an unrecognised mode fails closed and never
// silently becomes mock. NO ACCOUNT EXISTS, NOTHING IS ACTIVATED, and no code path
// constructs the adapter — a reviewed mode only makes a provider a CANDIDATE.
//
// Production remains fail-closed EXACTLY as C2 defined it: an absent mode is closed, and an
// explicit `mock` is closed (a mock must never carry a live OTP). Selection is resolved at
// RUNTIME, never at import time, so a missing environment variable can never break the
// build.
//
// It returns a CANDIDATE DESCRIPTOR, not an adapter instance: nothing here constructs an
// SMS provider, so no adapter, credential, or HTTP endpoint enters this module.
// ============================================================================

import { MOCK_SMS_PROVIDER_KEY } from "../lib/communication/providers/mockSmsProvider";
import {
  EXOTEL_SMS_PROVIDER_KEY,
  firstExotelConfigVariable,
  resolveExotelConfig,
} from "../lib/communication/providers/exotelConfig";

export const SMS_PROVIDER_MODE_ENV = "SMS_PROVIDER_MODE";

/** The CLOSED mode vocabulary. Exactly two reviewed values exist in Phase 5F-C3-A. */
export const SmsProviderMode = {
  MOCK: "mock",
  EXOTEL_SMS: "exotel_sms",
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
  /**
   * A reviewed provider mode whose server-only configuration is absent or malformed. The
   * provider is NOT a candidate. Never downgraded to mock, in any environment.
   */
  PROVIDER_CONFIG_INCOMPLETE: "provider_config_incomplete",
} as const;

export type SmsSelectionBlockReasonValue =
  (typeof SmsSelectionBlockReason)[keyof typeof SmsSelectionBlockReason];

/**
 * The selected candidate. An IDENTITY, never an adapter instance — selection sends nothing,
 * so it constructs nothing.
 */
export interface SmsProviderCandidate {
  readonly mode: SmsProviderModeValue;
  readonly providerKey: string;
  readonly channel: "sms";
  /** True only for the deterministic test/dev adapter. */
  readonly isMock: boolean;
}

export type SmsProviderSelection =
  | { readonly ok: true; readonly candidate: SmsProviderCandidate }
  | {
      readonly ok: false;
      readonly reason: SmsSelectionBlockReasonValue;
      /** A variable NAME. A variable VALUE can never appear here. */
      readonly variable: string;
      /** Variable NAMES only — supplied for a config failure, never values. */
      readonly missing?: readonly string[];
      readonly invalid?: readonly string[];
    };

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

const EXOTEL_CANDIDATE: SmsProviderCandidate = Object.freeze({
  mode: SmsProviderMode.EXOTEL_SMS,
  providerKey: EXOTEL_SMS_PROVIDER_KEY,
  channel: "sms",
  isMock: false,
});

/**
 * A reviewed real provider is a CANDIDATE only when its complete server-only config
 * resolves. An incomplete config fails closed with variable NAMES only — never a value, and
 * never a fallback to mock.
 */
function selectExotel(env: EnvSource): SmsProviderSelection {
  const config = resolveExotelConfig(env);
  if (!config.ok) {
    return {
      ok: false,
      reason: SmsSelectionBlockReason.PROVIDER_CONFIG_INCOMPLETE,
      variable: firstExotelConfigVariable(config),
      missing: config.missing,
      invalid: config.invalid,
    };
  }
  return { ok: true, candidate: EXOTEL_CANDIDATE };
}

/**
 * Select the SMS provider candidate for the current environment. LAZY: called per request,
 * never at module import.
 *
 *   ANY ENVIRONMENT
 *     `exotel_sms` + complete config   → Exotel CANDIDATE (still not permission to send)
 *     `exotel_sms` + incomplete config → FAIL CLOSED (provider_config_incomplete)
 *
 *   NON-PRODUCTION
 *     mode absent      → controlled mock
 *     explicit `mock`  → controlled mock
 *     unknown mode     → FAIL CLOSED
 *
 *   PRODUCTION
 *     mode absent      → FAIL CLOSED (mode_required_in_production)
 *     explicit `mock`  → FAIL CLOSED (mock_forbidden_in_production)
 *     unknown mode     → FAIL CLOSED (unsupported_provider_mode)
 *
 * There is NO implicit mock fallback in production, an unknown mode never silently becomes
 * mock, and a reviewed provider with an incomplete config never becomes mock either.
 *
 * A CANDIDATE IS NOT AUTHORIZATION. Even a complete Exotel config cannot send: the SMS
 * runtime gate has no Exotel policy, account, template mapping or canary row, and Phase
 * 5F-C1 ships zero active failure rules.
 */
export function selectSmsProvider(env: EnvSource = process.env): SmsProviderSelection {
  const raw = readTrimmed(env, SMS_PROVIDER_MODE_ENV);
  const isProduction = readTrimmed(env, "NODE_ENV") === "production";

  // A reviewed real provider behaves identically in every environment: candidacy depends on
  // its config alone, and candidacy authorizes nothing.
  if (raw === SmsProviderMode.EXOTEL_SMS) {
    return selectExotel(env);
  }

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
