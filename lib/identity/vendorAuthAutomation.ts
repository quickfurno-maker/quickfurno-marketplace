// ============================================================================
// QuickFurno — Identity Foundation: vendor auth automation gate (Phase 5E)
//
// A PURE evaluator of a `communication_automation_catalog` row. It answers one
// question — "may the vendor WhatsApp verification / password reset path invoke
// the WhatsApp provider right now?" — and it fails CLOSED on every uncertainty.
//
// WHY THIS EXISTS (mock-safety)
//   Phase 5B ships a mock provider as the code default. A route being deployed, a
//   template being active, and the mock returning `accepted` must NEVER add up to
//   production WhatsApp delivery. The single thing that makes the difference is an
//   operator explicitly enabling the automation (`is_operationally_enabled`), and
//   the database additionally forbids enabling anything whose readiness is not
//   `active`. Both layers are re-checked here before any provider call.
//
// The Phase 5E shipped state is `mock_ready`, `is_operationally_enabled = false`,
// `provider_required = 'mock'` — so this evaluator BLOCKS in production.
//
// This module reads NOTHING and imports no Supabase client: the caller loads the
// catalog row and passes it in with the ACTIVE provider adapter's key.
// ============================================================================

import type { CommunicationAutomationCatalog } from "../communication/types";
import { VerificationPurpose, type VerificationPurposeValue } from "./verification";

export const VENDOR_AUTH_LANE = "authentication" as const;
export const VENDOR_AUTH_CHANNEL = "whatsapp" as const;

/** The one provider key that denotes the non-delivering test/dev adapter. */
export const MOCK_PROVIDER_REQUIRED = "mock";

/**
 * Delivery-channel vocabulary. Phase 5E delivers on and attests EXACTLY
 * `whatsapp`. `sms` is forward VOCABULARY readiness only — there is no SMS adapter,
 * template, send path, or attestation, so it can never be an active delivery
 * channel today. RCS is deliberately absent from the vocabulary entirely.
 */
export const VendorAuthDeliveryChannel = {
  WHATSAPP: "whatsapp",
  /** Vocabulary readiness only — NOT implemented in Phase 5E. */
  SMS: "sms",
} as const;

export type VendorAuthDeliveryChannelValue =
  (typeof VendorAuthDeliveryChannel)[keyof typeof VendorAuthDeliveryChannel];

/** The channels the DB vocabulary admits. */
export const KNOWN_VENDOR_AUTH_DELIVERY_CHANNELS: readonly VendorAuthDeliveryChannelValue[] =
  Object.freeze(Object.values(VendorAuthDeliveryChannel));

/** The ONLY channel Phase 5E actually delivers on and accepts for attestation. */
export const ACTIVE_VENDOR_AUTH_DELIVERY_CHANNEL: VendorAuthDeliveryChannelValue =
  VendorAuthDeliveryChannel.WHATSAPP;

export function isKnownVendorAuthDeliveryChannel(value: unknown): value is VendorAuthDeliveryChannelValue {
  return typeof value === "string" && (KNOWN_VENDOR_AUTH_DELIVERY_CHANNELS as string[]).includes(value);
}

/**
 * The immutable binding between a verification purpose, its automation catalog
 * key, its template, and the communication message type it dispatches. A purpose
 * can never borrow another purpose's automation, template, or ledger rows.
 */
export interface VendorAuthAutomationBinding {
  readonly purpose: VerificationPurposeValue;
  readonly automationKey: string;
  readonly templateKey: string;
  readonly messageType: string;
  /** The channel this binding delivers on and requires for attestation. */
  readonly channel: VendorAuthDeliveryChannelValue;
}

export const VENDOR_WHATSAPP_VERIFY_BINDING: VendorAuthAutomationBinding = Object.freeze({
  purpose: VerificationPurpose.VENDOR_WHATSAPP_VERIFY,
  automationKey: "vendor_whatsapp_verify",
  templateKey: "vendor_whatsapp_verify",
  messageType: "vendor_whatsapp_verify",
  channel: ACTIVE_VENDOR_AUTH_DELIVERY_CHANNEL,
});

export const VENDOR_PASSWORD_RESET_BINDING: VendorAuthAutomationBinding = Object.freeze({
  purpose: VerificationPurpose.VENDOR_PASSWORD_RESET,
  automationKey: "vendor_password_reset",
  templateKey: "vendor_password_reset",
  messageType: "vendor_password_reset",
  channel: ACTIVE_VENDOR_AUTH_DELIVERY_CHANNEL,
});

export const VENDOR_AUTH_BINDINGS: readonly VendorAuthAutomationBinding[] = Object.freeze([
  VENDOR_WHATSAPP_VERIFY_BINDING,
  VENDOR_PASSWORD_RESET_BINDING,
]);

/** The binding for a purpose, or null. Never guesses. */
export function vendorAuthBindingForPurpose(
  purpose: unknown
): VendorAuthAutomationBinding | null {
  return VENDOR_AUTH_BINDINGS.find((b) => b.purpose === purpose) ?? null;
}

export const VendorAuthGateBlockReason = {
  /** No catalog row for this automation key — fail closed. */
  MISSING_CATALOG_ROW: "missing_catalog_row",
  /** The operator has not switched the automation on. This is the Phase 5E state. */
  NOT_OPERATIONALLY_ENABLED: "not_operationally_enabled",
  /** Readiness is not `active`; the DB constraint should make this unreachable. */
  READINESS_NOT_ACTIVE: "readiness_not_active",
  LANE_MISMATCH: "lane_mismatch",
  CHANNEL_MISMATCH: "channel_mismatch",
  TEMPLATE_MISMATCH: "template_mismatch",
  /** The required provider does not match the active provider adapter. */
  PROVIDER_MISMATCH: "provider_mismatch",
} as const;

export type VendorAuthGateBlockReasonValue =
  (typeof VendorAuthGateBlockReason)[keyof typeof VendorAuthGateBlockReason];

export type VendorAuthGateDecision =
  | {
      readonly ok: true;
      readonly purpose: VerificationPurposeValue;
      readonly automationKey: string;
      readonly templateKey: string;
      readonly messageType: string;
      /** The provider key the automation is wired to (equals the active provider). */
      readonly providerRequired: string;
      /** True when the wired provider is the mock adapter (never real delivery). */
      readonly isMockProvider: boolean;
    }
  | { readonly ok: false; readonly reason: VendorAuthGateBlockReasonValue };

type CatalogRow = Pick<
  CommunicationAutomationCatalog,
  | "automation_key"
  | "lane"
  | "channel"
  | "template_key"
  | "readiness_status"
  | "provider_required"
  | "is_operationally_enabled"
>;

/**
 * Evaluate whether `binding`'s automation may invoke the ACTIVE provider.
 *
 * Fails closed on a missing row, a key mismatch, disablement, non-active
 * readiness, a structural mismatch, or a provider mismatch. It NEVER returns `ok`
 * for a disabled automation, so the Phase 5E shipped state always blocks.
 */
export function evaluateVendorAuthGate(
  row: CatalogRow | null | undefined,
  activeProviderKey: string,
  binding: VendorAuthAutomationBinding
): VendorAuthGateDecision {
  if (!row || row.automation_key !== binding.automationKey) {
    return { ok: false, reason: VendorAuthGateBlockReason.MISSING_CATALOG_ROW };
  }
  if (row.lane !== VENDOR_AUTH_LANE) {
    return { ok: false, reason: VendorAuthGateBlockReason.LANE_MISMATCH };
  }
  if (row.channel !== VENDOR_AUTH_CHANNEL) {
    return { ok: false, reason: VendorAuthGateBlockReason.CHANNEL_MISMATCH };
  }
  if (row.template_key !== binding.templateKey) {
    return { ok: false, reason: VendorAuthGateBlockReason.TEMPLATE_MISMATCH };
  }
  // The production kill-switch. Phase 5E leaves this false.
  if (row.is_operationally_enabled !== true) {
    return { ok: false, reason: VendorAuthGateBlockReason.NOT_OPERATIONALLY_ENABLED };
  }
  // Defence in depth: the DB CHECK already ties enablement to `active`.
  if (row.readiness_status !== "active") {
    return { ok: false, reason: VendorAuthGateBlockReason.READINESS_NOT_ACTIVE };
  }
  // The wired provider must be exactly the active adapter. A mock-only automation
  // can never masquerade as real delivery, and a real automation can never run on
  // the mock adapter.
  if (
    typeof row.provider_required !== "string" ||
    row.provider_required.trim() === "" ||
    row.provider_required !== activeProviderKey
  ) {
    return { ok: false, reason: VendorAuthGateBlockReason.PROVIDER_MISMATCH };
  }

  return {
    ok: true,
    purpose: binding.purpose,
    automationKey: binding.automationKey,
    templateKey: binding.templateKey,
    messageType: binding.messageType,
    providerRequired: row.provider_required,
    isMockProvider: row.provider_required === MOCK_PROVIDER_REQUIRED,
  };
}
