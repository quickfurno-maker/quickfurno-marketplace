// ============================================================================
// QuickFurno — services/metaWhatsAppOutboundService.ts   (Phase 5F-B, server-only)
//
// The Meta outbound COORDINATOR: a narrow infrastructure-transport preparation
// boundary between CommunicationService and the Meta adapter.
//
// It coordinates ONLY: server-only outbound config → runtime activation policy →
// provider-account readiness → canary allowlist → approved active provider template
// mapping → resolved descriptor + deterministic mapping fingerprint.
//
//   EARLY PREFLIGHT (prepareInitialOutbound), before any ledger row exists:
//     outbound config → runtime policy → provider account → canary → mapping
//
//   FINAL NETWORK-BOUNDARY FENCE (prepareFinalOutbound), after the dispatch claim
//   and immediately before the provider HTTP request:
//     pinned mapping (by id) → FINAL runtime infrastructure gate → fingerprint
//
// The final fence re-reads every runtime row, so an operator who pauses the provider,
// disables outbound, un-readies the account, or expires the canary row between the
// early preflight and the network call is honoured — the request is never issued.
//
// It NEVER: authorizes a business communication (Phase 4 Policy Engine remains the
// authorization authority), generates or verifies an OTP, chooses recipients, calls
// n8n or Jarvis, implements campaign logic, or implements SMS fallback.
// CommunicationService remains the ledger and dispatch boundary.
//
// Every failure is FAIL CLOSED with ZERO provider network calls.
// ============================================================================

import {
  OutboundPreparationReason,
  type ApprovedTemplateOutboundCoordinator,
  type FinalOutboundInput,
  type InitialOutboundInput,
  type OutboundPreparation,
  type OutboundPreparationReasonValue,
} from "../lib/communication/approvedTemplateOutbound";
import type { WhatsAppResolvedTemplate } from "../lib/communication/whatsappTemplate";
import {
  computeMappingFingerprint,
  mappingFingerprintMatches,
} from "../lib/communication/providerMappingFingerprint";
import { resolveOutboundMetaConfig } from "../lib/communication/providers/metaCloudWhatsAppConfig";
import { evaluateMetaOutboundGateForMessage } from "./communicationProviderRuntimeService";
import { resolveApprovedMetaMapping, resolveApprovedMetaMappingById } from "./providerTemplateMappingService";

type EnvSource = Record<string, string | undefined>;

type PreparationFailure = Exclude<OutboundPreparation, { ok: true }>;

/** A resolved descriptor plus the fingerprint of the exact content it carries. */
function prepared(resolved: WhatsAppResolvedTemplate, fingerprint: string): OutboundPreparation {
  return {
    ok: true,
    resolved,
    mappingId: resolved.mappingId,
    mappingVersion: resolved.version,
    mappingFingerprint: fingerprint,
  };
}

export class MetaWhatsAppOutboundCoordinator implements ApprovedTemplateOutboundCoordinator {
  constructor(private readonly env: EnvSource = process.env) {}

  /**
   * Server-only outbound config + the composed runtime gate, freshly re-read on every
   * invocation: runtime policy exists → outbound_enabled → activation is canary/active
   * → provider account exists → phone-number id matches → WABA id matches → every
   * readiness status is production-ready → (canary only) the destination hash is
   * allowlisted on an active, unexpired row.
   *
   * Returns null on success, or the fail-closed preparation failure tagged with the
   * caller's reason so an EARLY block and a FINAL block are distinguishable in the
   * ledger's `failure_code`.
   */
  private async gate(
    destinationHash: string,
    blockedReason: OutboundPreparationReasonValue
  ): Promise<PreparationFailure | null> {
    const cfg = resolveOutboundMetaConfig(this.env);
    if (!cfg.ok) {
      return { ok: false, reason: OutboundPreparationReason.CONFIG_MISSING };
    }
    const gate = await evaluateMetaOutboundGateForMessage({
      config: { phoneNumberId: cfg.config.phoneNumberId, wabaId: cfg.config.wabaId },
      destinationHash,
    });
    if (!gate.ok) {
      return { ok: false, reason: blockedReason, detail: gate.reason };
    }
    return null;
  }

  /**
   * EARLY PREFLIGHT. Gate first, then resolve the approved active mapping, then
   * fingerprint its exact content so the initial send can pin it on the message.
   */
  async prepareInitialOutbound(input: InitialOutboundInput): Promise<OutboundPreparation> {
    const blocked = await this.gate(input.destinationHash, OutboundPreparationReason.RUNTIME_GATE_BLOCKED);
    if (blocked) return blocked;

    const mapping = await resolveApprovedMetaMapping({
      templateKey: input.templateKey,
      language: input.language,
    });
    if (!mapping.ok) {
      return { ok: false, reason: OutboundPreparationReason.MAPPING_UNRESOLVED, detail: mapping.reason };
    }
    return prepared(mapping.template, computeMappingFingerprint(mapping.template));
  }

  /**
   * FINAL NETWORK-BOUNDARY FENCE, immediately before the provider HTTP request — on
   * the initial auth send, the initial business send, AND a business retry after a
   * process restart. In order:
   *
   *   1. re-resolve the EXACT pinned mapping BY ID and re-validate it through the same
   *      strict selector (template / channel / provider / language must still match; it
   *      must still be approved and active), then re-check the pinned version;
   *   2. re-evaluate the FULL runtime infrastructure gate against freshly-read rows;
   *   3. recompute the content fingerprint and compare it with EXACT equality.
   *
   * A missing identity, a superseded version, a paused provider, or a mapping row
   * edited in place under the same id + version all fail closed here: the dispatcher
   * never silently sends different content, a different mapping, provider, channel,
   * template, or language than the one the initial send pinned.
   */
  async prepareFinalOutbound(input: FinalOutboundInput): Promise<OutboundPreparation> {
    // 1 — the exact pinned mapping, re-validated.
    if (!input.mappingId) {
      return { ok: false, reason: OutboundPreparationReason.MAPPING_IDENTITY_MISSING };
    }
    if (!input.mappingVersion) {
      return { ok: false, reason: OutboundPreparationReason.MAPPING_IDENTITY_MISSING };
    }
    const mapping = await resolveApprovedMetaMappingById({
      mappingId: input.mappingId,
      templateKey: input.templateKey,
      language: input.language,
    });
    if (!mapping.ok) {
      return { ok: false, reason: OutboundPreparationReason.MAPPING_UNRESOLVED, detail: mapping.reason };
    }
    if (mapping.template.version !== input.mappingVersion) {
      return { ok: false, reason: OutboundPreparationReason.MAPPING_IDENTITY_CHANGED };
    }

    // 2 — FINAL runtime infrastructure gate, immediately before the network request.
    const blocked = await this.gate(input.destinationHash, OutboundPreparationReason.FINAL_RUNTIME_GATE_BLOCKED);
    if (blocked) return blocked;

    // 3 — deterministic content fingerprint, compared with EXACT equality.
    if (!input.mappingFingerprint) {
      return { ok: false, reason: OutboundPreparationReason.MAPPING_FINGERPRINT_MISSING };
    }
    const recomputed = computeMappingFingerprint(mapping.template);
    if (!mappingFingerprintMatches(input.mappingFingerprint, recomputed)) {
      return { ok: false, reason: OutboundPreparationReason.MAPPING_FINGERPRINT_MISMATCH };
    }
    return prepared(mapping.template, recomputed);
  }
}

/** Runtime factory. Constructing it performs no DB read and no network call. */
export function getMetaOutboundCoordinator(env: EnvSource = process.env): ApprovedTemplateOutboundCoordinator {
  return new MetaWhatsAppOutboundCoordinator(env);
}
