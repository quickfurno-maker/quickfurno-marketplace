// ============================================================================
// QuickFurno — Identity Foundation: client login OTP operational gate (Phase 5D)
//
// A PURE evaluator of the `client_login_otp` communication automation catalog row
// (Phase 5B). It answers one question: "may the client login OTP path invoke the
// WhatsApp provider right now?" — and it fails CLOSED on every uncertainty.
//
// Why this exists (mock-safety):
//   • Phase 5B ships a mock provider as the code default. A route being deployed,
//     a template being active, and the mock returning `accepted` must NEVER add up
//     to production WhatsApp delivery. The one thing that makes the difference is
//     an operator explicitly enabling the automation — `is_operationally_enabled`.
//   • Enablement is gated in the database (a CHECK forbids enabling anything whose
//     readiness is not `active`), and it is re-checked here in code before any
//     provider call, so neither layer alone can turn delivery on by accident.
//
// This module reads NOTHING and imports no Supabase client — the caller loads the
// catalog row and passes it in, together with the active provider's key.
// ============================================================================

import type { CommunicationAutomationCatalog } from "../communication/types";

/** The automation + template keys the client login OTP path is bound to. */
export const CLIENT_LOGIN_OTP_AUTOMATION_KEY = "client_login_otp";
export const CLIENT_LOGIN_OTP_TEMPLATE_KEY = "client_login_otp";
export const CLIENT_LOGIN_OTP_LANE = "authentication" as const;
export const CLIENT_LOGIN_OTP_CHANNEL = "whatsapp" as const;
export const CLIENT_LOGIN_OTP_MESSAGE_TYPE = "client_login_otp";
export const CLIENT_LOGIN_OTP_ENTITY_TYPE = "auth_user";

export const ClientOtpGateBlockReason = {
  /** No client_login_otp row in the automation catalog — fail closed. */
  MISSING_CATALOG_ROW: "missing_catalog_row",
  /** The operator has not switched the automation on. This is the Phase 5D state. */
  NOT_OPERATIONALLY_ENABLED: "not_operationally_enabled",
  /** Readiness is not `active`; the DB constraint should make this unreachable. */
  READINESS_NOT_ACTIVE: "readiness_not_active",
  /** The row is not the authentication lane. */
  LANE_MISMATCH: "lane_mismatch",
  /** The row is not the WhatsApp channel. */
  CHANNEL_MISMATCH: "channel_mismatch",
  /** The row is mapped to a different template. */
  TEMPLATE_MISMATCH: "template_mismatch",
  /** The required provider does not match the active provider adapter. */
  PROVIDER_MISMATCH: "provider_mismatch",
} as const;

export type ClientOtpGateBlockReasonValue =
  (typeof ClientOtpGateBlockReason)[keyof typeof ClientOtpGateBlockReason];

export type ClientOtpGateDecision =
  | {
      readonly ok: true;
      /** The provider key the automation is wired to (equals the active provider). */
      readonly providerRequired: string;
      /** True when the wired provider is the mock adapter (never real delivery). */
      readonly isMockProvider: boolean;
    }
  | { readonly ok: false; readonly reason: ClientOtpGateBlockReasonValue };

/** The one provider key that denotes the non-delivering test/dev adapter. */
export const MOCK_PROVIDER_REQUIRED = "mock";

/**
 * Evaluate whether the client login OTP automation may invoke the active
 * provider. Fails closed on a missing row, disablement, provider mismatch, or any
 * structural mismatch. It NEVER returns `ok` for a disabled automation, so the
 * Phase 5D shipped state (`is_operationally_enabled = false`) always blocks.
 */
export function evaluateClientOtpOperationalGate(
  row: Pick<
    CommunicationAutomationCatalog,
    | "automation_key"
    | "lane"
    | "channel"
    | "template_key"
    | "readiness_status"
    | "provider_required"
    | "is_operationally_enabled"
  > | null | undefined,
  activeProviderKey: string
): ClientOtpGateDecision {
  if (!row || row.automation_key !== CLIENT_LOGIN_OTP_AUTOMATION_KEY) {
    return { ok: false, reason: ClientOtpGateBlockReason.MISSING_CATALOG_ROW };
  }
  if (row.lane !== CLIENT_LOGIN_OTP_LANE) {
    return { ok: false, reason: ClientOtpGateBlockReason.LANE_MISMATCH };
  }
  if (row.channel !== CLIENT_LOGIN_OTP_CHANNEL) {
    return { ok: false, reason: ClientOtpGateBlockReason.CHANNEL_MISMATCH };
  }
  if (row.template_key !== CLIENT_LOGIN_OTP_TEMPLATE_KEY) {
    return { ok: false, reason: ClientOtpGateBlockReason.TEMPLATE_MISMATCH };
  }
  // The production kill-switch. Phase 5D leaves this false.
  if (row.is_operationally_enabled !== true) {
    return { ok: false, reason: ClientOtpGateBlockReason.NOT_OPERATIONALLY_ENABLED };
  }
  // Defence in depth: the DB constraint already ties enablement to `active`.
  if (row.readiness_status !== "active") {
    return { ok: false, reason: ClientOtpGateBlockReason.READINESS_NOT_ACTIVE };
  }
  // The wired provider must be exactly the active adapter. A mock-only automation
  // can never masquerade as real delivery, and a real automation can never run on
  // the mock adapter.
  if (
    typeof row.provider_required !== "string" ||
    row.provider_required.trim() === "" ||
    row.provider_required !== activeProviderKey
  ) {
    return { ok: false, reason: ClientOtpGateBlockReason.PROVIDER_MISMATCH };
  }

  return {
    ok: true,
    providerRequired: row.provider_required,
    isMockProvider: row.provider_required === MOCK_PROVIDER_REQUIRED,
  };
}
