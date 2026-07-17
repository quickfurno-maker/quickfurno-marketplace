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
import type { OutboundAccountAttributionDependency } from "../lib/communication/outboundProviderAccountAttribution";
// Phase 8B-1B-B — the FROZEN Phase 8B-1B-A ownership authority, imported here at the PRODUCTION
// construction boundary (never inside CommunicationService) and injected as the resolver dependency.
import { resolveOwningProviderAccount } from "./communicationProviderRuntimeService";

/** Phase 8B-1B-B — the selected provider plus the safe identity projected from the SAME selection. */
export interface RuntimeWhatsAppContext {
  readonly provider: WhatsAppProvider;
  readonly attribution: OutboundAccountAttributionDependency | null;
}

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
  const context = resolveRuntimeWhatsAppContext(env);
  // Propagate the failure VERBATIM: it already carries the exact RUNTIME_PROVIDER_UNAVAILABLE code.
  // Re-wrapping it through fail() would normalize the string message and DROP the code.
  if (!context.ok) return context;
  return ok(context.data.provider);
}

/**
 * Phase 8B-1B-B — the COHERENT RUNTIME CONTEXT. The provider and the safe attribution
 * identity come from ONE selection, so the identity can never drift from the adapter that
 * will actually issue the request: `selectWhatsAppProvider` returns the very
 * `MetaOutboundConfig` it used to construct the provider, and the Meta request URL is built
 * from that same `phoneNumberId`. Resolving THAT identity therefore records the REAL sender
 * — it is not an environment guess, a default, or an inference.
 *
 * An EXPLICIT override wins (test injection stays compatible) but carries NO configuration,
 * so it yields NO identity. An `approved_provider_mapping` adapter without a coherent
 * identity FAILS CLOSED at the network boundary inside CommunicationService — never here,
 * because selecting a provider is not authorization.
 *
 * The identity is NON-SECRET by construction: only providerKey / channel /
 * phoneNumberReference / expectedWabaId are projected. The access token stays in the
 * adapter's runtime and is never copied into the attribution dependency.
 */
export function resolveRuntimeWhatsAppContext(env: EnvSource = process.env): Result<RuntimeWhatsAppContext> {
  const override = getWhatsAppProviderOverride();
  if (override) return ok({ provider: override, attribution: overrideAttribution(override, env) });

  const selection = selectWhatsAppProvider(env);
  if (!selection.ok) {
    return fail(new AppError(RUNTIME_PROVIDER_UNAVAILABLE, RUNTIME_PROVIDER_MESSAGE));
  }
  if (selection.mode !== "meta_cloud") {
    // Mock adapters resolve templates internally and need no provider-account attribution.
    return ok({ provider: selection.provider, attribution: null });
  }
  return ok({
    provider: selection.provider,
    attribution: {
      identity: {
        providerKey: selection.provider.providerKey,
        channel: selection.provider.channel,
        phoneNumberReference: selection.config.phoneNumberId,
        expectedWabaId: selection.config.wabaId,
      },
      // The EXACT frozen Phase 8B-1B-A resolver. It is the only ownership authority production ever
      // injects — never a default account, a readiness check or an environment-derived owner.
      resolveOwnership: resolveOwningProviderAccount,
    },
  });
}

/**
 * Attribution for an EXPLICIT provider override (test injection). The override wins for the provider,
 * but an `approved_provider_mapping` adapter still needs a coherent NON-SECRET identity. Project it
 * from the env's Meta selection when the env yields a complete Meta config (so an override paired with
 * a complete Meta env still binds); otherwise NONE — an identity-less approved_provider_mapping override
 * carries no attribution and FAILS CLOSED at the network boundary. Mock / internal-template overrides
 * never require attribution. The access token stays in the env; only the four non-secret ids are copied.
 */
function overrideAttribution(
  override: WhatsAppProvider,
  env: EnvSource
): OutboundAccountAttributionDependency | null {
  if (override.templateResolutionMode !== "approved_provider_mapping") return null;
  const selection = selectWhatsAppProvider(env);
  if (!selection.ok || selection.mode !== "meta_cloud") return null;
  return {
    identity: {
      providerKey: override.providerKey,
      channel: override.channel,
      phoneNumberReference: selection.config.phoneNumberId,
      expectedWabaId: selection.config.wabaId,
    },
    resolveOwnership: resolveOwningProviderAccount,
  };
}

/**
 * Build a CommunicationService bound to the runtime-selected provider, with the Meta
 * outbound coordinator attached. The coordinator is only ever consulted by an
 * `approved_provider_mapping` adapter; the mock path never touches it and needs no
 * Meta env, runtime policy, provider account, mapping, or canary row.
 */
export function createRuntimeCommunicationService(
  env: EnvSource = process.env,
  // Phase 8B-1B-B — ONE immutable environment snapshot feeds provider selection, coordinator
  // creation AND the safe attribution identity, so all three describe the same runtime. A later
  // environment mutation can never make the bound account disagree with the sending adapter.
  coordinator?: ApprovedTemplateOutboundCoordinator,
  // Phase 5F-D3-B — the outbound CONSENT ENFORCER. Appended as an OPTIONAL last parameter so every
  // existing call site stays source-compatible, and DEFAULTED to the real coordinator so production
  // can never construct a service without consent enforcement.
  consentEnforcer: OutboundConsentEnforcer = createOutboundConsentEnforcer()
): Result<CommunicationService> {
  const envSnapshot = Object.freeze({ ...env });
  const context = resolveRuntimeWhatsAppContext(envSnapshot);
  if (!context.ok) return context; // propagate verbatim — preserves the exact fail-closed code
  const resolvedCoordinator = coordinator ?? getMetaOutboundCoordinator(envSnapshot);
  // THE PRODUCTION CONSTRUCTION BOUNDARY. Every real send path builds its CommunicationService here,
  // so the consent enforcer is ALWAYS bound, AND the coherent provider-account attribution identity
  // is ALWAYS injected. A direct `new CommunicationService(...)` in production would bypass the
  // consent layer — the D3-B harness statically proves no production send path does that, and would
  // catch a future one.
  return ok(
    new CommunicationService(
      context.data.provider,
      getActiveRecipientResolver(),
      resolvedCoordinator,
      consentEnforcer,
      context.data.attribution
    )
  );
}
