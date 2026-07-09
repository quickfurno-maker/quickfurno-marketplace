// ============================================================================
// QuickFurno — services/whatsAppProviderSelection.ts  (Phase 5F-B, server-only)
//
// Controlled, LAZY WhatsApp provider selection.
//   • non-production + mode absent → MockWhatsAppProvider (implicit mock allowed).
//   • production + mode absent → FAIL CLOSED (no accidental implicit mock).
//   • explicit mock → MockWhatsAppProvider.
//   • meta_cloud + complete OUTBOUND config → MetaCloudWhatsAppProvider candidate
//     (no app secret / verify token required to SEND).
//   • meta_cloud + invalid config → FAIL CLOSED; never silently downgrades to mock.
//
// Selecting the Meta adapter is NOT permission to send. A Meta outbound dispatch must
// additionally pass the runtime policy, provider-account readiness, approved template
// mapping, and (in canary mode) the canary allowlist gates. Selection is resolved at
// RUNTIME (never at import time), so a missing production credential never breaks the
// build. This module does not change CommunicationService's default provider.
// ============================================================================

import { MockWhatsAppProvider } from "../lib/communication/providers/mockWhatsAppProvider";
import { MetaCloudWhatsAppProvider } from "../lib/communication/providers/metaCloudWhatsAppProvider";
import {
  outboundToRuntime,
  resolveOutboundMetaConfig,
  resolveProviderModeDecision,
  type MetaOutboundConfig,
} from "../lib/communication/providers/metaCloudWhatsAppConfig";
import { FetchHttpTransport, type HttpTransport } from "../lib/communication/httpTransport";
import type { WhatsAppProvider } from "../lib/communication/providers/whatsappProvider";

export type WhatsAppProviderSelection =
  | { readonly ok: true; readonly mode: "mock"; readonly provider: WhatsAppProvider }
  | {
      readonly ok: true;
      readonly mode: "meta_cloud";
      readonly provider: MetaCloudWhatsAppProvider;
      readonly config: MetaOutboundConfig;
    }
  | {
      readonly ok: false;
      readonly reason: "mode_required_in_production" | "invalid_mode" | "outbound_config_incomplete";
      readonly missing: readonly string[];
      readonly invalid: readonly string[];
    };

/**
 * Select the WhatsApp provider adapter for the current environment. Fail closed on a
 * production-absent mode or a misconfigured Meta mode — never fall back to mock.
 * `transport` is injectable so tests never touch the network.
 */
export function selectWhatsAppProvider(
  env: Record<string, string | undefined> = process.env,
  transport: HttpTransport = new FetchHttpTransport()
): WhatsAppProviderSelection {
  const modeDecision = resolveProviderModeDecision(env);
  if (!modeDecision.ok) {
    return { ok: false, reason: modeDecision.reason, missing: [modeDecision.variable], invalid: [] };
  }
  if (modeDecision.mode === "mock") {
    return { ok: true, mode: "mock", provider: new MockWhatsAppProvider() };
  }

  // meta_cloud — SENDING needs only the outbound config (no app secret / verify token).
  const outbound = resolveOutboundMetaConfig(env);
  if (!outbound.ok) {
    return { ok: false, reason: "outbound_config_incomplete", missing: outbound.missing, invalid: outbound.invalid };
  }
  return {
    ok: true,
    mode: "meta_cloud",
    provider: new MetaCloudWhatsAppProvider(outboundToRuntime(outbound.config), transport),
    config: outbound.config,
  };
}
