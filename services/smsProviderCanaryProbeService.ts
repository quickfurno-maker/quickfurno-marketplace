// ============================================================================
// QuickFurno — services/smsProviderCanaryProbeService.ts   (Phase 5F-C3-C-2, server-only)
//
// An ISOLATED, READ-ONLY SMS provider CANARY READINESS PROBE. It answers exactly one
// question: "is the SMS transport infrastructure ready for a future, controlled, founder-hash
// canary send?" — and then STOPS. IT SENDS NOTHING.
//
// WHAT THIS IS NOT
//   Not an authentication action, not an auth fallback, not a C1 decision, not an auth
//   attempt, not a Supabase OTP event, not a business communication, not a campaign, and not
//   an n8n workflow. It bypasses the authentication orchestration entirely: it imports and
//   calls NONE of the C1 decision engine, the attempt ledger, the fallback policy service, the
//   Supabase Send-SMS hook, or Supabase OTP generation. A real client OTP never enters here.
//
// BYPASSING AUTH IS NOT BYPASSING RUNTIME SAFETY
//   The probe still requires the FULL Phase 5F-C2 SMS runtime infrastructure to be ready, and
//   — because it is a CANARY probe — it additionally requires the runtime activation to be
//   exactly `canary` (full `active` production is deliberately NOT acceptable here). It fences
//   the provider identity three ways, honours the runtime policy's `health_check_enabled`
//   toggle, demands a fully healthy provider, and proves the exact runtime mapping resolves
//   through the reviewed QuickFurno content boundary.
//
// NO SEND CAPABILITY. This module NEVER calls `sendResolvedAuthenticationSms`,
// `sendAuthenticationMessage`, `CommunicationService.send`, or any provider send endpoint.
// The only provider method it invokes is the read-only `healthCheck()`. A harness statically
// proves there is no send call site here.
//
// NO DB WRITES. Every collaborator is a READ-ONLY projection. The probe never marks a provider
// healthy, never changes readiness/configuration/activation state, never activates a canary
// destination, never creates a mapping/failure rule, and never enables anything.
//
// SECRECY. The founder phone enters only in request memory and is hashed IMMEDIATELY; only the
// non-reversible `destinationHash` reaches any query or the result. The synthetic canary code
// and the rendered body stay in this stack frame and are never persisted, logged, or returned.
// ============================================================================

import { hashPhoneE164, isNormalizablePhone } from "../lib/communication/phone";
import { resolveAuthenticationSmsContent } from "../lib/communication/authSmsBodyRenderer";
import { SMS_CHANNEL, SMS_RUNTIME_READY } from "../lib/communication/providers/smsRuntimeGate";
import type { SmsProvider, SmsProviderHealth } from "../lib/communication/providers/smsProvider";
import { evaluateSmsRuntimeReadiness, readSmsRuntimePolicy } from "./smsProviderRuntimeService";
import { createRuntimeSmsProvider } from "./runtimeSmsProviderService";
import { runtimeSmsAdapterFactory } from "./runtimeSmsAdapterFactory";

/** The one canary the probe ever prepares for. The vendor flows never reach it. */
export const CANARY_REVIEWED_TEMPLATE_KEY = "client_login_otp" as const;
export const CANARY_LANGUAGE = "en" as const;

/**
 * A SYNTHETIC numeric test code. It is NOT a Supabase OTP, is never an authentication
 * authority, and never links to a user session. Same shape the reviewed renderer accepts.
 */
export const SYNTHETIC_CANARY_CODE_PATTERN = /^[0-9]{4,10}$/;

// ----------------------------------------------------------------------------
// Result vocabulary — INFRASTRUCTURE readiness, never authorization to send
// ----------------------------------------------------------------------------
export const SmsCanaryProbeStatus = {
  READY: "SMS_CANARY_PROBE_READY",
  BLOCKED: "SMS_CANARY_PROBE_BLOCKED",
} as const;
export type SmsCanaryProbeStatusValue =
  (typeof SmsCanaryProbeStatus)[keyof typeof SmsCanaryProbeStatus];

/** The semantic readiness verdict on the READY path. Still NOT permission to send. */
export const SMS_CANARY_READINESS = "READY_FOR_CONTROLLED_CANARY" as const;

export const SmsCanaryProbeBlockReason = {
  INVALID_INPUT: "INVALID_INPUT",
  RUNTIME_NOT_READY: "RUNTIME_NOT_READY",
  ACTIVATION_NOT_CANARY: "ACTIVATION_NOT_CANARY",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  PROVIDER_IDENTITY_MISMATCH: "PROVIDER_IDENTITY_MISMATCH",
  HEALTH_CHECK_DISABLED: "HEALTH_CHECK_DISABLED",
  HEALTH_CHECK_FAILED: "HEALTH_CHECK_FAILED",
  HEALTH_IDENTITY_MISMATCH: "HEALTH_IDENTITY_MISMATCH",
  PROVIDER_UNHEALTHY: "PROVIDER_UNHEALTHY",
  RESOLVED_CONTENT_UNAVAILABLE: "RESOLVED_CONTENT_UNAVAILABLE",
} as const;
export type SmsCanaryProbeBlockReasonValue =
  (typeof SmsCanaryProbeBlockReason)[keyof typeof SmsCanaryProbeBlockReason];

/**
 * The observable result. Every field is non-secret: a stable status/reason, the provider
 * identity, a non-reversible destination hash, and boolean readiness facts. NEVER the phone,
 * the synthetic code, the rendered body, a raw provider response, or a credential.
 */
export interface SmsCanaryProbeResult {
  readonly status: SmsCanaryProbeStatusValue;
  readonly readiness: typeof SMS_CANARY_READINESS | null;
  readonly reason: SmsCanaryProbeBlockReasonValue | null;
  readonly providerKey: string | null;
  readonly channel: typeof SMS_CHANNEL;
  /** A SHA-256 digest — the plaintext founder phone never appears here. */
  readonly destinationHash: string | null;
  readonly activation: "canary" | null;
  /** True only once the single read-only health check has run. */
  readonly healthChecked: boolean;
  /** True only when the reviewed content resolved. The body itself is never returned. */
  readonly contentResolved: boolean;
}

// ----------------------------------------------------------------------------
// Input + injectable dependencies
// ----------------------------------------------------------------------------
export interface SmsCanaryProbeInput {
  readonly providerKey: string;
  /** Founder E.164, request memory ONLY. Hashed immediately; never persisted/logged/returned/sent. */
  readonly founderPhoneE164: string;
  readonly reviewedTemplateKey: string;
  readonly language: string;
  /** SYNTHETIC numeric test code — NOT a Supabase OTP, never an authentication authority. */
  readonly syntheticCanaryCode: string;
}

/** Every collaborator is a READ-ONLY projection or a pure function. Injected for testing. */
export interface SmsCanaryProbeDeps {
  readonly evaluateSmsRuntimeReadiness: typeof evaluateSmsRuntimeReadiness;
  readonly readSmsRuntimePolicy: typeof readSmsRuntimePolicy;
  readonly createRuntimeSmsProvider: typeof createRuntimeSmsProvider;
  readonly resolveAuthenticationSmsContent: typeof resolveAuthenticationSmsContent;
}

/** LAZY: constructed per request, never at module import. Binds the real read-only services. */
export function defaultSmsCanaryProbeDeps(): SmsCanaryProbeDeps {
  return {
    evaluateSmsRuntimeReadiness,
    readSmsRuntimePolicy,
    createRuntimeSmsProvider: (factory, env) => createRuntimeSmsProvider(factory, env),
    resolveAuthenticationSmsContent,
  };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function blocked(
  reason: SmsCanaryProbeBlockReasonValue,
  over: Partial<SmsCanaryProbeResult> = {}
): SmsCanaryProbeResult {
  return {
    status: SmsCanaryProbeStatus.BLOCKED,
    readiness: null,
    reason,
    providerKey: null,
    channel: SMS_CHANNEL,
    destinationHash: null,
    activation: null,
    healthChecked: false,
    contentResolved: false,
    ...over,
  };
}

// ----------------------------------------------------------------------------
// The probe
// ----------------------------------------------------------------------------
/**
 * Steps, in a fixed order. Each is fail-closed; none can be reached out of sequence:
 *
 *   1  validate the canary input;
 *   2  hash the destination (the plaintext founder phone stops here);
 *   3  evaluate the existing SMS runtime readiness, keyed on the HASH only;
 *   4  require SMS_RUNTIME_READY;
 *   5  require activation EXACTLY `canary` (`active` is not acceptable for a canary probe);
 *   6  construct the runtime SMS adapter behind the existing identity fence;
 *   7  fence the adapter again against the decision's provider (exact key + sms channel);
 *   8  require the runtime policy to have health checks enabled (else no health call);
 *   9  perform EXACTLY ONE read-only health check;
 *  10  fence the health result identity (exact provider + sms channel);
 *  11  require configured + reachable + healthy;
 *  12  resolve the EXACT runtime mapping through the reviewed content boundary;
 *  13  return a sanitized readiness result;
 *  14  STOP. No SMS is sent.
 */
export async function probeSmsProviderCanaryReadiness(
  input: SmsCanaryProbeInput,
  deps: SmsCanaryProbeDeps = defaultSmsCanaryProbeDeps()
): Promise<SmsCanaryProbeResult> {
  // 1 — validate the canary input. A malformed provider/template/language/code, or a phone that
  // does not normalise, fails closed with no downstream call.
  if (!isNonEmptyString(input.providerKey) || !isNonEmptyString(input.reviewedTemplateKey) || !isNonEmptyString(input.language)) {
    return blocked(SmsCanaryProbeBlockReason.INVALID_INPUT);
  }
  if (typeof input.syntheticCanaryCode !== "string" || !SYNTHETIC_CANARY_CODE_PATTERN.test(input.syntheticCanaryCode)) {
    return blocked(SmsCanaryProbeBlockReason.INVALID_INPUT);
  }
  if (typeof input.founderPhoneE164 !== "string" || !isNormalizablePhone(input.founderPhoneE164)) {
    return blocked(SmsCanaryProbeBlockReason.INVALID_INPUT);
  }

  // 2 — the non-reversible destination hash. The plaintext founder phone stops here and never
  // reaches a query, the result, a log, or a provider.
  let destinationHash: string;
  try {
    destinationHash = hashPhoneE164(input.founderPhoneE164);
  } catch {
    return blocked(SmsCanaryProbeBlockReason.INVALID_INPUT);
  }
  const base = { providerKey: input.providerKey, destinationHash } as const;

  // 3-4 — the existing SMS runtime readiness gate (read-only), keyed on the HASH only.
  const decision = await deps.evaluateSmsRuntimeReadiness({
    providerKey: input.providerKey,
    channel: SMS_CHANNEL,
    templateKey: input.reviewedTemplateKey,
    language: input.language,
    destinationHash, // HASH ONLY — never the plaintext founder phone
  });
  if (decision.status !== SMS_RUNTIME_READY) {
    return blocked(SmsCanaryProbeBlockReason.RUNTIME_NOT_READY, base);
  }

  // 5 — CANARY-specific: a canary probe must not silently operate under full production
  // activation. Only exactly `canary` continues; `active` is refused here.
  if (decision.activation !== "canary") {
    return blocked(SmsCanaryProbeBlockReason.ACTIVATION_NOT_CANARY, { ...base, providerKey: decision.providerKey });
  }
  const decidedProviderKey = decision.providerKey;

  // 6-7 — construct the runtime SMS adapter behind the existing identity fence, then fence it
  // AGAIN against the decision's provider. No aliasing, trim-repair, case-fold, family match,
  // or silent substitution. A factory that throws or fails fails the probe closed.
  let adapter: SmsProvider;
  try {
    const built = deps.createRuntimeSmsProvider(runtimeSmsAdapterFactory, process.env);
    if (!built.ok) return blocked(SmsCanaryProbeBlockReason.PROVIDER_UNAVAILABLE, { ...base, providerKey: decidedProviderKey });
    adapter = built.data;
  } catch {
    return blocked(SmsCanaryProbeBlockReason.PROVIDER_UNAVAILABLE, { ...base, providerKey: decidedProviderKey });
  }
  if (adapter.providerKey !== decidedProviderKey || adapter.channel !== SMS_CHANNEL) {
    return blocked(SmsCanaryProbeBlockReason.PROVIDER_IDENTITY_MISMATCH, { ...base, providerKey: decidedProviderKey });
  }

  // 8 — a health check must NOT run unless the runtime policy explicitly enables it. Reuses the
  // existing runtime-policy authority (parity with the Meta health service); no second toggle.
  const policy = await deps.readSmsRuntimePolicy(decidedProviderKey);
  if (!policy || policy.health_check_enabled !== true) {
    return blocked(SmsCanaryProbeBlockReason.HEALTH_CHECK_DISABLED, { ...base, providerKey: decidedProviderKey, activation: "canary" });
  }

  // 9 — EXACTLY ONE read-only health check. Advisory infrastructure observation; no DB write,
  // no state change, no auth attempt. A thrown check fails closed with a sanitized reason.
  let health: SmsProviderHealth;
  try {
    health = await adapter.healthCheck();
  } catch {
    return blocked(SmsCanaryProbeBlockReason.HEALTH_CHECK_FAILED, { ...base, providerKey: decidedProviderKey, activation: "canary", healthChecked: true });
  }

  // 10 — the health result must carry the EXACT provider identity and sms channel.
  if (health.provider !== decidedProviderKey || health.channel !== SMS_CHANNEL) {
    return blocked(SmsCanaryProbeBlockReason.HEALTH_IDENTITY_MISMATCH, { ...base, providerKey: decidedProviderKey, activation: "canary", healthChecked: true });
  }
  // 11 — an authentication canary demands a fully healthy provider; `degraded`/unreachable/
  // unconfigured is refused (a late OTP is an expired OTP).
  if (health.configured !== true || health.reachable !== true || health.status !== "healthy") {
    return blocked(SmsCanaryProbeBlockReason.PROVIDER_UNHEALTHY, { ...base, providerKey: decidedProviderKey, activation: "canary", healthChecked: true });
  }

  // 12 — prove the EXACT runtime mapping resolves through the reviewed QuickFurno content
  // boundary. The synthetic code is mapped onto the renderer's only accepted field name; it is
  // NOT a Supabase OTP. The renderer cross-checks key/language/category and requires a present
  // provider template name and id, exactly as on the real send path.
  const resolved = deps.resolveAuthenticationSmsContent({
    reviewedTemplateKey: input.reviewedTemplateKey,
    language: input.language,
    otp: input.syntheticCanaryCode,
    runtimeMapping: {
      templateKey: decision.mapping.templateKey,
      language: decision.mapping.language,
      providerTemplateName: decision.mapping.providerTemplateName,
      providerTemplateId: decision.mapping.providerTemplateId,
      providerCategory: decision.mapping.providerCategory,
    },
  });
  if (!resolved.ok) {
    return blocked(SmsCanaryProbeBlockReason.RESOLVED_CONTENT_UNAVAILABLE, { ...base, providerKey: decidedProviderKey, activation: "canary", healthChecked: true });
  }
  // `resolved.resolved.messageBody` is readiness EVIDENCE only. It stays in this stack frame —
  // never returned, logged, or persisted. C3-C-2 sends NOTHING.

  // 13 — sanitized READY result. 14 — STOP. There is no send call anywhere in this module.
  return {
    status: SmsCanaryProbeStatus.READY,
    readiness: SMS_CANARY_READINESS,
    reason: null,
    providerKey: decidedProviderKey,
    channel: SMS_CHANNEL,
    destinationHash,
    activation: "canary",
    healthChecked: true,
    contentResolved: true,
  };
}
