// ============================================================================
// QuickFurno — services/runtimeSmsProviderService.ts   (Phase 5F-C2, server-only)
//
// The RUNTIME SMS PROVIDER RESOLUTION BOUNDARY — capability preparation ONLY.
//
// Phase 5F-C2 sends nothing. This module exists so a later phase (C3/C4) has one place to
// obtain the selected SMS candidate, and one place where a provider-identity fence is
// applied. It:
//
//   • calls the controlled SMS provider selection LAZILY (never at import time);
//   • exposes the selected candidate identity;
//   • constructs an adapter only from a factory the CALLER injects, and only after the
//     adapter's `providerKey` and `channel` are verified against the selected candidate.
//
// It deliberately NEVER:
//   • sends an SMS or calls `sendAuthenticationMessage`;
//   • names, imports, or instantiates any adapter (mock or commercial);
//   • claims an authentication delivery attempt;
//   • calls the Phase 5F-C1 fallback decision engine;
//   • touches the communication ledger or any policy row.
//
// Resolving a provider is NOT authorization. An actual SMS dispatch must additionally pass
// the SMS runtime infrastructure gate AND Phase 5F-C1's fallback decision, explicit failure
// rule, attempt budget and atomic attempt claim. `vendor_whatsapp_verify` can never reach
// any of it.
// ============================================================================

import { AppError, fail, ok, type Result } from "../lib/errors";
import type { SmsProvider } from "../lib/communication/providers/smsProvider";
import {
  selectSmsProvider,
  type SmsProviderCandidate,
  type SmsProviderSelection,
} from "./smsProviderSelection";

export const RUNTIME_SMS_PROVIDER_UNAVAILABLE = "SMS_PROVIDER_NOT_CONFIGURED";
export const RUNTIME_SMS_PROVIDER_IDENTITY_MISMATCH = "SMS_PROVIDER_IDENTITY_MISMATCH";

const UNAVAILABLE_MESSAGE =
  "No SMS provider is configured for this environment; nothing was dispatched.";
const IDENTITY_MISMATCH_MESSAGE =
  "The supplied SMS adapter does not match the selected provider candidate; nothing was dispatched.";

type EnvSource = Record<string, string | undefined>;

/**
 * The candidate the runtime would use, or a fail-closed error. Production always fails
 * closed today: no commercial SMS provider exists and a mock may never carry a live OTP.
 */
export function resolveSmsProviderCandidate(env: EnvSource = process.env): Result<SmsProviderCandidate> {
  const selection: SmsProviderSelection = selectSmsProvider(env);
  if (!selection.ok) {
    return fail(new AppError(RUNTIME_SMS_PROVIDER_UNAVAILABLE, UNAVAILABLE_MESSAGE));
  }
  return ok(selection.candidate);
}

/** True only when a candidate resolves. Never a "maybe". */
export function isSmsProviderCandidateAvailable(env: EnvSource = process.env): boolean {
  return resolveSmsProviderCandidate(env).ok;
}

/**
 * The factory a CALLER injects. This module never names an adapter, so no provider literal
 * — mock or commercial — can leak into the runtime boundary.
 */
export type SmsProviderFactory = (candidate: SmsProviderCandidate) => SmsProvider;

/**
 * Build the SMS adapter for the selected candidate, behind a PROVIDER IDENTITY FENCE: the
 * factory's adapter must declare exactly the selected `providerKey` and channel `"sms"`, or
 * this fails closed. Building an adapter is still not permission to send.
 */
export function createRuntimeSmsProvider(
  factory: SmsProviderFactory,
  env: EnvSource = process.env
): Result<SmsProvider> {
  const candidate = resolveSmsProviderCandidate(env);
  if (!candidate.ok) return candidate;

  const provider = factory(candidate.data);
  if (provider.providerKey !== candidate.data.providerKey || provider.channel !== "sms") {
    return fail(new AppError(RUNTIME_SMS_PROVIDER_IDENTITY_MISMATCH, IDENTITY_MISMATCH_MESSAGE));
  }
  return ok(provider);
}
