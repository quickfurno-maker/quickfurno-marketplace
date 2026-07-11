// ============================================================================
// QuickFurno — lib/communication/providers/smsRuntimeGate.ts   (Phase 5F-C2)
//
// PURE, fail-closed evaluation of whether the SMS transport INFRASTRUCTURE is ready.
//
// No database, no environment, no network, no provider call, no clock — the caller passes
// already-fetched row projections and, where expiry matters, an explicit `now`.
//
// THIS GATE NEVER AUTHORIZES A FALLBACK.
//   Its vocabulary is deliberately infrastructural: SMS_RUNTIME_READY / SMS_RUNTIME_BLOCKED.
//   There is no `FALLBACK_ALLOWED` here and there never will be. Whether an authentication
//   action may fall back to SMS is decided ONLY by Phase 5F-C1's
//   `evaluateAuthenticationFallback` — which additionally requires an operational transport
//   policy, an explicit active failure rule, an attempt budget, and an atomic attempt claim.
//   A provider being technically ready is not permission to send anything.
//
// It also never authenticates, never chooses a recipient, never touches an OTP, and never
// mutates a row.
// ============================================================================

/** The activation states in which outbound delivery is even conceptually permitted. */
export const SMS_SENDABLE_ACTIVATION_STATUSES: readonly string[] = Object.freeze(["canary", "active"]);

/** The one channel this gate ever evaluates. */
export const SMS_CHANNEL = "sms";

/** The required production-ready values on an SMS provider account. */
export const REQUIRED_SMS_ACCOUNT_READINESS = Object.freeze({
  readiness_status: "provider_ready",
  configuration_status: "complete",
  /**
   * An AUTHENTICATION transport demands a healthy provider. `degraded` is refused: an OTP
   * that arrives late is an OTP that has already expired.
   */
  health_status: "healthy",
});

/** The only template category an authentication SMS may ever use. */
export const AUTHENTICATION_TEMPLATE_CATEGORY = "authentication";

// ----------------------------------------------------------------------------
// Row projections (non-secret columns only — none of these tables has a secret column)
// ----------------------------------------------------------------------------
export interface SmsRuntimePolicyRow {
  readonly provider_key: string;
  readonly channel: string;
  readonly activation_status: string;
  readonly outbound_enabled: boolean;
  /**
   * Whether an operator has enabled explicit provider HEALTH CHECKS for this (provider, sms)
   * — parity with `MetaRuntimePolicyRow`. Projected here so an EXPLICIT, read-only caller (the
   * Phase 5F-C3-C-2 canary readiness probe) can honour it. THE SEND GATE
   * (`evaluateSmsRuntimeGate`) DOES NOT CONSULT THIS FIELD: outbound send eligibility is
   * decided ONLY by `outbound_enabled` + `activation_status`, exactly as before. Adding this
   * projection changes nothing about who may send.
   */
  readonly health_check_enabled: boolean;
}

export interface SmsProviderAccountRow {
  readonly provider_key: string;
  readonly channel: string;
  readonly readiness_status: string;
  readonly configuration_status: string;
  readonly health_status: string;
}

export interface SmsTemplateMappingRow {
  readonly id?: string | null;
  readonly template_key: string;
  readonly channel: string;
  readonly provider_key: string;
  readonly language: string;
  readonly provider_template_name: string | null;
  readonly provider_template_id: string | null;
  readonly provider_category: string | null;
  readonly approval_status: string;
  readonly is_active: boolean;
}

/** Destination HASH only — a plaintext number never enters this module. */
export interface SmsCanaryDestinationRow {
  readonly provider_key: string;
  readonly channel: string;
  readonly destination_hash: string;
  readonly is_active: boolean;
  readonly expires_at: string | null;
}

// ----------------------------------------------------------------------------
// Decision vocabulary — INFRASTRUCTURE, never authorization
// ----------------------------------------------------------------------------
export const SMS_RUNTIME_READY = "SMS_RUNTIME_READY" as const;
export const SMS_RUNTIME_BLOCKED = "SMS_RUNTIME_BLOCKED" as const;

export const SmsRuntimeBlockReason = {
  PROVIDER_KEY_MISSING: "PROVIDER_KEY_MISSING",
  PROVIDER_CHANNEL_NOT_SMS: "PROVIDER_CHANNEL_NOT_SMS",

  RUNTIME_POLICY_MISSING: "RUNTIME_POLICY_MISSING",
  RUNTIME_POLICY_PROVIDER_MISMATCH: "RUNTIME_POLICY_PROVIDER_MISMATCH",
  RUNTIME_POLICY_CHANNEL_NOT_SMS: "RUNTIME_POLICY_CHANNEL_NOT_SMS",
  OUTBOUND_DISABLED: "OUTBOUND_DISABLED",
  ACTIVATION_NOT_SENDABLE: "ACTIVATION_NOT_SENDABLE",

  PROVIDER_ACCOUNT_MISSING: "PROVIDER_ACCOUNT_MISSING",
  PROVIDER_ACCOUNT_AMBIGUOUS: "PROVIDER_ACCOUNT_AMBIGUOUS",
  PROVIDER_ACCOUNT_PROVIDER_MISMATCH: "PROVIDER_ACCOUNT_PROVIDER_MISMATCH",
  PROVIDER_ACCOUNT_CHANNEL_NOT_SMS: "PROVIDER_ACCOUNT_CHANNEL_NOT_SMS",
  PROVIDER_ACCOUNT_NOT_READY: "PROVIDER_ACCOUNT_NOT_READY",
  PROVIDER_ACCOUNT_CONFIGURATION_INCOMPLETE: "PROVIDER_ACCOUNT_CONFIGURATION_INCOMPLETE",
  PROVIDER_ACCOUNT_UNHEALTHY: "PROVIDER_ACCOUNT_UNHEALTHY",

  TEMPLATE_MAPPING_MISSING: "TEMPLATE_MAPPING_MISSING",
  TEMPLATE_MAPPING_AMBIGUOUS: "TEMPLATE_MAPPING_AMBIGUOUS",
  TEMPLATE_MAPPING_NOT_APPROVED: "TEMPLATE_MAPPING_NOT_APPROVED",
  TEMPLATE_MAPPING_INACTIVE: "TEMPLATE_MAPPING_INACTIVE",
  TEMPLATE_MAPPING_CATEGORY_NOT_AUTHENTICATION: "TEMPLATE_MAPPING_CATEGORY_NOT_AUTHENTICATION",
  TEMPLATE_MAPPING_PROVIDER_NAME_MISSING: "TEMPLATE_MAPPING_PROVIDER_NAME_MISSING",

  CANARY_DESTINATION_NOT_ALLOWLISTED: "CANARY_DESTINATION_NOT_ALLOWLISTED",

  /** The read service could not obtain a trustworthy projection. Fail closed. */
  RUNTIME_READ_FAILED: "RUNTIME_READ_FAILED",
} as const;

export type SmsRuntimeBlockReasonValue =
  (typeof SmsRuntimeBlockReason)[keyof typeof SmsRuntimeBlockReason];

/** The approved, active SMS authentication template the gate resolved. Non-secret. */
export interface ResolvedSmsTemplateMapping {
  readonly mappingId: string | null;
  readonly templateKey: string;
  readonly providerKey: string;
  readonly channel: "sms";
  readonly language: string;
  readonly providerTemplateName: string;
  readonly providerTemplateId: string | null;
  readonly providerCategory: "authentication";
}

export type SmsRuntimeDecision =
  | {
      readonly status: typeof SMS_RUNTIME_READY;
      readonly providerKey: string;
      readonly channel: "sms";
      readonly activation: "canary" | "active";
      readonly mapping: ResolvedSmsTemplateMapping;
    }
  | {
      readonly status: typeof SMS_RUNTIME_BLOCKED;
      readonly reason: SmsRuntimeBlockReasonValue;
      readonly detail?: string;
    };

export interface SmsRuntimeGateInput {
  readonly providerKey: string;
  /** The candidate adapter's declared channel. Must be exactly `"sms"`. */
  readonly channel: string;
  readonly templateKey: string;
  readonly language: string;
  /** Non-reversible destination hash. NEVER a plaintext number. */
  readonly destinationHash: string;
  readonly policy: SmsRuntimePolicyRow | null;
  /** Every account row for this provider, whatever channel — the gate discriminates. */
  readonly accounts: readonly SmsProviderAccountRow[];
  /** Every mapping row for this template key — the gate discriminates, never the query. */
  readonly mappings: readonly SmsTemplateMappingRow[];
  readonly canaryRows: readonly SmsCanaryDestinationRow[];
  /** REQUIRED whenever expiry matters. The gate owns no clock. */
  readonly now: number | string | Date;
}

function blocked(reason: SmsRuntimeBlockReasonValue, detail?: string): SmsRuntimeDecision {
  return detail === undefined
    ? { status: SMS_RUNTIME_BLOCKED, reason }
    : { status: SMS_RUNTIME_BLOCKED, reason, detail };
}

function isCanaryRowUsable(row: SmsCanaryDestinationRow, nowMs: number): boolean {
  if (row.is_active !== true) return false;
  if (row.expires_at === null || row.expires_at === undefined) return true;
  const expiresAt = Date.parse(row.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

/**
 * Evaluate SMS transport INFRASTRUCTURE readiness. Fails closed on the first failing
 * condition, in a fixed order, so the reason is always the most fundamental one.
 *
 * A `SMS_RUNTIME_READY` decision means only: "the infrastructure could carry an SMS right
 * now." It is NOT permission to send, and it is NOT a fallback authorization.
 */
export function evaluateSmsRuntimeGate(input: SmsRuntimeGateInput): SmsRuntimeDecision {
  // ---- 1-2: the candidate provider identity itself -------------------------
  if (typeof input.providerKey !== "string" || input.providerKey.trim() === "") {
    return blocked(SmsRuntimeBlockReason.PROVIDER_KEY_MISSING);
  }
  if (input.channel !== SMS_CHANNEL) {
    return blocked(SmsRuntimeBlockReason.PROVIDER_CHANNEL_NOT_SMS, input.channel);
  }

  // ---- 3-7: the runtime activation policy ---------------------------------
  const policy = input.policy;
  if (!policy) return blocked(SmsRuntimeBlockReason.RUNTIME_POLICY_MISSING);
  if (policy.provider_key !== input.providerKey) {
    return blocked(SmsRuntimeBlockReason.RUNTIME_POLICY_PROVIDER_MISMATCH);
  }
  if (policy.channel !== SMS_CHANNEL) {
    return blocked(SmsRuntimeBlockReason.RUNTIME_POLICY_CHANNEL_NOT_SMS, policy.channel);
  }
  if (policy.outbound_enabled !== true) {
    return blocked(SmsRuntimeBlockReason.OUTBOUND_DISABLED);
  }
  if (!SMS_SENDABLE_ACTIVATION_STATUSES.includes(policy.activation_status)) {
    // disabled / readiness_only / shadow / paused all stop here.
    return blocked(SmsRuntimeBlockReason.ACTIVATION_NOT_SENDABLE, policy.activation_status);
  }
  const activation = policy.activation_status as "canary" | "active";

  // ---- 8-13: the provider account -----------------------------------------
  const accounts = input.accounts ?? [];
  const candidates = accounts.filter(
    (a) => a.provider_key === input.providerKey && a.channel === SMS_CHANNEL
  );
  if (candidates.length === 0) {
    if (accounts.some((a) => a.provider_key === input.providerKey && a.channel !== SMS_CHANNEL)) {
      return blocked(SmsRuntimeBlockReason.PROVIDER_ACCOUNT_CHANNEL_NOT_SMS);
    }
    if (accounts.some((a) => a.channel === SMS_CHANNEL && a.provider_key !== input.providerKey)) {
      return blocked(SmsRuntimeBlockReason.PROVIDER_ACCOUNT_PROVIDER_MISMATCH);
    }
    return blocked(SmsRuntimeBlockReason.PROVIDER_ACCOUNT_MISSING);
  }
  if (candidates.length > 1) {
    // Readiness must never depend on which row a query happened to return first.
    return blocked(SmsRuntimeBlockReason.PROVIDER_ACCOUNT_AMBIGUOUS);
  }
  const account = candidates[0];
  if (account.readiness_status !== REQUIRED_SMS_ACCOUNT_READINESS.readiness_status) {
    // not_configured / credentials_pending / account_ready / webhook_pending /
    // template_mapping_pending / disabled all stop here. `account_ready` is NOT
    // `provider_ready`.
    return blocked(SmsRuntimeBlockReason.PROVIDER_ACCOUNT_NOT_READY, account.readiness_status);
  }
  if (account.configuration_status !== REQUIRED_SMS_ACCOUNT_READINESS.configuration_status) {
    return blocked(SmsRuntimeBlockReason.PROVIDER_ACCOUNT_CONFIGURATION_INCOMPLETE, account.configuration_status);
  }
  if (account.health_status !== REQUIRED_SMS_ACCOUNT_READINESS.health_status) {
    return blocked(SmsRuntimeBlockReason.PROVIDER_ACCOUNT_UNHEALTHY, account.health_status);
  }

  // ---- 14-22: the approved, active authentication template mapping ---------
  const mappings = input.mappings ?? [];
  const matching = mappings.filter(
    (m) =>
      m.template_key === input.templateKey &&
      m.channel === SMS_CHANNEL &&
      m.provider_key === input.providerKey &&
      m.language === input.language
  );
  if (matching.length === 0) {
    return blocked(SmsRuntimeBlockReason.TEMPLATE_MAPPING_MISSING);
  }
  const active = matching.filter((m) => m.is_active === true);
  if (active.length === 0) {
    const approved = matching.some((m) => m.approval_status === "approved");
    return blocked(
      approved ? SmsRuntimeBlockReason.TEMPLATE_MAPPING_INACTIVE : SmsRuntimeBlockReason.TEMPLATE_MAPPING_NOT_APPROVED
    );
  }
  if (active.length > 1) {
    // Ambiguity is a security bug: eligibility must never depend on row order.
    return blocked(SmsRuntimeBlockReason.TEMPLATE_MAPPING_AMBIGUOUS);
  }
  const mapping = active[0];
  if (mapping.approval_status !== "approved") {
    // draft / ready_for_submission / submitted / rejected / paused / disabled / superseded.
    return blocked(SmsRuntimeBlockReason.TEMPLATE_MAPPING_NOT_APPROVED, mapping.approval_status);
  }
  if (mapping.provider_category !== AUTHENTICATION_TEMPLATE_CATEGORY) {
    // A utility/marketing/service template may never carry an authentication OTP.
    return blocked(
      SmsRuntimeBlockReason.TEMPLATE_MAPPING_CATEGORY_NOT_AUTHENTICATION,
      mapping.provider_category ?? "null"
    );
  }
  if (typeof mapping.provider_template_name !== "string" || mapping.provider_template_name.trim() === "") {
    // For SMS this is the registered (e.g. DLT) content template. Never fabricated.
    return blocked(SmsRuntimeBlockReason.TEMPLATE_MAPPING_PROVIDER_NAME_MISSING);
  }

  // ---- 23-24: the canary allowlist ----------------------------------------
  if (activation === "canary") {
    const nowMs = typeof input.now === "number" ? input.now : new Date(input.now).getTime();
    const allowed = (input.canaryRows ?? []).some(
      (row) =>
        row.provider_key === input.providerKey &&
        row.channel === SMS_CHANNEL &&
        row.destination_hash === input.destinationHash &&
        isCanaryRowUsable(row, nowMs)
    );
    if (!allowed) return blocked(SmsRuntimeBlockReason.CANARY_DESTINATION_NOT_ALLOWLISTED);
  }
  // `active` requires no canary row.

  return {
    status: SMS_RUNTIME_READY,
    providerKey: input.providerKey,
    channel: "sms",
    activation,
    mapping: {
      mappingId: mapping.id ?? null,
      templateKey: mapping.template_key,
      providerKey: mapping.provider_key,
      channel: "sms",
      language: mapping.language,
      providerTemplateName: mapping.provider_template_name.trim(),
      providerTemplateId: mapping.provider_template_id,
      providerCategory: AUTHENTICATION_TEMPLATE_CATEGORY,
    },
  };
}

/**
 * True ONLY when the infrastructure is ready. Kept separate so a caller cannot mistake a
 * reasoned block for a boolean "maybe" — and named `runtimeReady`, never `authorized`.
 */
export function isSmsRuntimeReady(decision: SmsRuntimeDecision): boolean {
  return decision.status === SMS_RUNTIME_READY;
}
