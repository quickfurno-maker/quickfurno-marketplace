// ============================================================================
// QuickFurno — services/runtimeCommunicationService.ts   (Phase 5F-B, server-only)
//
// The RUNTIME PROVIDER RESOLUTION BOUNDARY. Every real auth and business send goes
// through here, so the provider that owns a message is the runtime-selected one.
//
//   1. an EXPLICIT override (setActiveWhatsAppProvider) always wins — test injection
//      and any caller-supplied adapter stay fully compatible;
//   2. otherwise `selectWhatsAppProvider` decides:
//        • non-production + mode absent → mock;
//        • production + mode absent    → FAIL CLOSED;
//        • explicit mock               → mock;
//        • explicit meta_cloud + complete outbound config → Meta candidate;
//        • meta_cloud + invalid config → FAIL CLOSED (never mock).
//
// Resolution is LAZY (called per request, never at module import), so no secret is
// validated at import time and a Next.js build never depends on Meta credentials.
//
// Selecting a provider is NOT authorization: the Meta adapter still passes the
// runtime policy, provider-account readiness, canary and approved-mapping gates
// inside CommunicationService before any network call. Phase 4 Policy Engine remains
// the business authorization authority.
// ============================================================================

import { AppError, fail, ok, type Result } from "../lib/errors";
import type { WhatsAppProvider } from "../lib/communication/providers/whatsappProvider";
import type { ApprovedTemplateOutboundCoordinator } from "../lib/communication/approvedTemplateOutbound";
import { CommunicationService, getWhatsAppProviderOverride } from "./communicationService";
import { getActiveRecipientResolver } from "./communicationRecipientResolver";
import { selectWhatsAppProvider } from "./whatsAppProviderSelection";
import { getMetaOutboundCoordinator } from "./metaWhatsAppOutboundService";
import {
  createOutboundConsentEnforcer,
  type OutboundConsentEnforcer,
} from "./outboundConsentEnforcementService";

export const RUNTIME_PROVIDER_UNAVAILABLE = "WHATSAPP_PROVIDER_NOT_CONFIGURED";

const RUNTIME_PROVIDER_MESSAGE =
  "The WhatsApp provider is not configured for this environment; no communication was dispatched.";

type EnvSource = Record<string, string | undefined>;

/**
 * Resolve the provider that will OWN this dispatch. Fail closed rather than fall back
 * to mock when Meta was explicitly requested but is misconfigured, or when a
 * production environment leaves the provider mode unset.
 */
export function resolveRuntimeWhatsAppProvider(env: EnvSource = process.env): Result<WhatsAppProvider> {
  const override = getWhatsAppProviderOverride();
  if (override) return ok(override);

  const selection = selectWhatsAppProvider(env);
  if (!selection.ok) {
    return fail(new AppError(RUNTIME_PROVIDER_UNAVAILABLE, RUNTIME_PROVIDER_MESSAGE));
  }
  return ok(selection.provider);
}

/**
 * Build a CommunicationService bound to the runtime-selected provider, with the Meta
 * outbound coordinator attached. The coordinator is only ever consulted by an
 * `approved_provider_mapping` adapter; the mock path never touches it and needs no
 * Meta env, runtime policy, provider account, mapping, or canary row.
 */
export function createRuntimeCommunicationService(
  env: EnvSource = process.env,
  coordinator: ApprovedTemplateOutboundCoordinator = getMetaOutboundCoordinator(env),
  // Phase 5F-D3-B — the outbound CONSENT ENFORCER. Appended as an OPTIONAL last parameter so every
  // existing call site stays source-compatible, and DEFAULTED to the real coordinator so production
  // can never construct a service without consent enforcement.
  consentEnforcer: OutboundConsentEnforcer = createOutboundConsentEnforcer()
): Result<CommunicationService> {
  const provider = resolveRuntimeWhatsAppProvider(env);
  if (!provider.ok) return provider;
  // THE PRODUCTION CONSTRUCTION BOUNDARY. Every real send path builds its CommunicationService here,
  // so the consent enforcer is ALWAYS bound. A direct `new CommunicationService(...)` in production
  // would bypass the consent layer — the D3-B harness statically proves no production send path does
  // that, and would catch a future one.
  return ok(
    new CommunicationService(provider.data, getActiveRecipientResolver(), coordinator, consentEnforcer)
  );
}
