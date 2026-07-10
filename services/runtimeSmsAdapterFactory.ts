// ============================================================================
// QuickFurno — services/runtimeSmsAdapterFactory.ts   (Phase 5F-C3-B, server-only)
//
// The ONE place an SMS adapter is constructed. It is the caller-injected factory that
// `createRuntimeSmsProvider` (Phase 5F-C2) applies its provider identity fence to.
//
// CONSTRUCTING AN ADAPTER IS NOT AUTHORIZATION. A fallback SMS additionally requires the
// C2 runtime infrastructure gate (no Exotel policy, account, template mapping or canary row
// exists) AND Phase 5F-C1's decision, an explicit active failure rule (the table is empty),
// an attempt budget, and an atomic attempt claim. Nothing here enables any of that.
//
// THE MOCK IS DELIBERATELY ABSENT. `MockSmsProvider` is test/dev only and no production
// file may instantiate it, so a `mock` SMS candidate resolves NO adapter here and the
// fallback path simply stops. Selection already refuses `mock` in production; this is the
// second, independent fence.
//
// Today the only real adapter is Exotel, and it refuses to send without an approved,
// DLT-registered resolved template descriptor. DLT registration remains external and
// pending (Phase 5F-C3-C), so this factory cannot put an SMS on the wire.
// ============================================================================

import { FetchHttpTransport, type HttpTransport } from "../lib/communication/httpTransport";
import type { SmsProvider } from "../lib/communication/providers/smsProvider";
import {
  EXOTEL_SMS_PROVIDER_KEY,
  resolveExotelConfig,
} from "../lib/communication/providers/exotelConfig";
import { ExotelSmsProvider } from "../lib/communication/providers/exotelSmsProvider";
import type { SmsProviderCandidate } from "./smsProviderSelection";
import type { SmsProviderFactory } from "./runtimeSmsProviderService";

export const SMS_ADAPTER_UNSUPPORTED_CANDIDATE = "SMS_ADAPTER_UNSUPPORTED_CANDIDATE";
export const SMS_ADAPTER_CONFIG_INCOMPLETE = "SMS_ADAPTER_CONFIG_INCOMPLETE";

/**
 * A construction fault. Carries only a stable code — never a credential, a variable value,
 * or an environment dump. The runtime boundary catches it and fails the fallback closed.
 */
export class SmsAdapterConstructionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SmsAdapterConstructionError";
  }
}

/**
 * Build the adapter for a SELECTED candidate. Never called at import time.
 *
 * The returned adapter's `providerKey` is checked against the candidate by
 * `createRuntimeSmsProvider`, and the orchestrator independently checks it against the
 * provider the C1 decision allowed. Two fences, neither derived from the other.
 */
export function createSmsAdapterForCandidate(
  candidate: SmsProviderCandidate,
  transport: HttpTransport = new FetchHttpTransport()
): SmsProvider {
  if (candidate.providerKey === EXOTEL_SMS_PROVIDER_KEY) {
    const config = resolveExotelConfig();
    if (!config.ok) {
      // Variable NAMES stay inside the loader; only a stable code escapes.
      throw new SmsAdapterConstructionError(SMS_ADAPTER_CONFIG_INCOMPLETE);
    }
    return new ExotelSmsProvider(config.config, transport);
  }
  // A mock candidate, or any candidate this factory does not know, resolves no adapter.
  throw new SmsAdapterConstructionError(SMS_ADAPTER_UNSUPPORTED_CANDIDATE);
}

/** The factory reference the orchestrator injects. */
export const runtimeSmsAdapterFactory: SmsProviderFactory = (candidate) =>
  createSmsAdapterForCandidate(candidate);
