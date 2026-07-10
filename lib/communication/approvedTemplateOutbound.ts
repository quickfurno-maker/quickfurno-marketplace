// ============================================================================
// QuickFurno — lib/communication/approvedTemplateOutbound.ts   (Phase 5F-B)
//
// PURE contract for the narrow outbound-preparation boundary an approved-mapping
// adapter (Meta) requires before a real provider call.
//
// It prepares INFRASTRUCTURE TRANSPORT ONLY: outbound config → runtime activation /
// provider-account readiness / canary gate → approved active provider mapping →
// resolved descriptor + mapping fingerprint. It NEVER authorizes a communication
// (Phase 4 Policy Engine remains the business authorization authority), never
// generates or verifies an OTP, never chooses recipients, never calls n8n or Jarvis,
// and never falls back to SMS.
//
// TWO PREPARATION POINTS, deliberately:
//
//   prepareInitialOutbound — the EARLY preflight, before any ledger row exists.
//       outbound config → runtime policy → provider account → canary → approved
//       mapping → fingerprint. A failure here writes nothing and calls nothing.
//
//   prepareFinalOutbound — the FINAL network-boundary fence, after the atomic
//       dispatch claim and immediately before the provider HTTP request.
//       pinned mapping (by id) → FINAL runtime infrastructure gate → fingerprint
//       verification. This closes the race in which an operator pauses the provider,
//       de-activates the account, expires the canary row, or edits the mapping row
//       in place AFTER the early preflight passed but BEFORE the request is issued.
//
// Every failure on either path is FAIL CLOSED and yields ZERO provider network calls.
// ============================================================================

import type { WhatsAppResolvedTemplate } from "./whatsappTemplate";

/** Ledger-safe, identifier-shaped preparation failure codes. */
export const OutboundPreparationReason = {
  /** No coordinator was injected for an approved-mapping adapter. */
  COORDINATOR_UNAVAILABLE: "APPROVED_TEMPLATE_COORDINATOR_UNAVAILABLE",
  /** The adapter cannot accept a resolved descriptor. */
  SENDER_UNSUPPORTED: "APPROVED_TEMPLATE_SENDER_UNSUPPORTED",
  /** Server-only outbound config is absent/invalid. */
  CONFIG_MISSING: "META_OUTBOUND_CONFIG_MISSING",
  /** EARLY preflight: runtime policy / provider account / canary gate refused. */
  RUNTIME_GATE_BLOCKED: "META_RUNTIME_GATE_BLOCKED",
  /** FINAL network-boundary fence: the infrastructure gate refused at dispatch time. */
  FINAL_RUNTIME_GATE_BLOCKED: "META_FINAL_RUNTIME_GATE_BLOCKED",
  /** No approved, active provider mapping for this template/language. */
  MAPPING_UNRESOLVED: "META_APPROVED_MAPPING_UNRESOLVED",
  /** A retry has no pinned mapping identity — cannot reproduce deterministically. */
  MAPPING_IDENTITY_MISSING: "META_MAPPING_IDENTITY_MISSING",
  /** The pinned mapping no longer matches (superseded/version changed). */
  MAPPING_IDENTITY_CHANGED: "META_MAPPING_IDENTITY_CHANGED",
  /** No fingerprint was pinned, so mutated mapping CONTENT could not be ruled out. */
  MAPPING_FINGERPRINT_MISSING: "META_MAPPING_FINGERPRINT_MISSING",
  /** The mapping row was edited in place under the same id + version. */
  MAPPING_FINGERPRINT_MISMATCH: "META_MAPPING_FINGERPRINT_MISMATCH",
  /** The internal template row could not be read on the dispatch path. */
  TEMPLATE_UNRESOLVED: "META_INTERNAL_TEMPLATE_UNRESOLVED",
} as const;

export type OutboundPreparationReasonValue =
  (typeof OutboundPreparationReason)[keyof typeof OutboundPreparationReason];

export type OutboundPreparation =
  | {
      readonly ok: true;
      readonly resolved: WhatsAppResolvedTemplate;
      readonly mappingId: string | null;
      readonly mappingVersion: string;
      /** SHA-256 (lowercase hex) of the exact dispatch-critical mapping content. */
      readonly mappingFingerprint: string;
    }
  | { readonly ok: false; readonly reason: OutboundPreparationReasonValue; readonly detail?: string };

export interface InitialOutboundInput {
  readonly templateKey: string;
  readonly language: string;
  /** Non-reversible destination hash — never a plaintext number. */
  readonly destinationHash: string;
}

/**
 * The identity pinned on the message at initial send. All three are required at the
 * final network boundary: the id selects the exact row, the version rejects a
 * supersede, and the fingerprint rejects an in-place edit under the same id+version.
 */
export interface FinalOutboundInput extends InitialOutboundInput {
  readonly mappingId: string | null;
  readonly mappingVersion: string | null;
  readonly mappingFingerprint: string | null;
}

/**
 * The infrastructure preparation boundary. Neither method authorizes a communication,
 * and neither performs a provider network call.
 */
export interface ApprovedTemplateOutboundCoordinator {
  prepareInitialOutbound(input: InitialOutboundInput): Promise<OutboundPreparation>;
  prepareFinalOutbound(input: FinalOutboundInput): Promise<OutboundPreparation>;
}
