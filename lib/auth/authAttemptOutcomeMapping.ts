// ============================================================================
// QuickFurno — lib/auth/authAttemptOutcomeMapping.ts   (Phase 5F-C3-B)
//
// PURE translation between a transport result and a C1 attempt-ledger outcome.
//
// No database, no environment, no network, no clock, no provider. This module decides
// NOTHING about fallback: it only converts one already-observed fact into the ledger's
// (status, certainty) vocabulary, and it never invents certainty from a boolean.
//
// THE ONE RULE THAT MATTERS
//   `unknown_outcome` is never downgraded to a proven failure. A message whose delivery
//   can be neither proven nor disproven may already have reached the user's handset, so
//   treating it as "failed" would authorize a fallback that delivers a SECOND OTP.
//   Every status this module does not explicitly recognise therefore maps to
//   `unknown_outcome`, never to `definitive_failure`.
//
// LOCAL / PREFLIGHT FAILURE CODES
//   A `definitive_failure` is not automatically fallback-eligible, and a large family of
//   definitive failures never should be: a missing credential, an unrendered template, a
//   spent hook budget, a provider identity mismatch. These are LOCAL faults — the request
//   never left this process. Falling back to SMS would hide the misconfiguration behind a
//   second channel and a second bill, forever.
//
//   `isLocalPreflightFailureCode` exists so the orchestrator can refuse to even ASK for a
//   fallback on such a code. It is a DENY-ONLY guard: returning `false` grants nothing.
//   Fallback still requires Phase 5F-C1's explicit, active, unambiguous failure rule, and
//   `authentication_transport_failure_rules` ships EMPTY (default deny).
// ============================================================================

import type { AuthOutcomeCertaintyValue } from "../identity/authTransport";
import { isConsistentAttemptOutcome } from "../communication/authenticationTransportDecision";
import { effectiveProviderOutcomeCertainty } from "../communication/providers/providerOutcome";
import { AUTH_NETWORK_DEADLINE_EXHAUSTED } from "./hookDeadline";

/** Only an allowlisted, identifier-shaped code may reach the ledger. */
const SAFE_FAILURE_CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * A ledger-safe failure code, or null. A raw provider payload, an exception message, an
 * OTP, or a phone number can never satisfy this pattern.
 */
export function safeFailureCode(value: unknown): string | null {
  return typeof value === "string" && SAFE_FAILURE_CODE.test(value) ? value : null;
}

/** One attempt's recorded transport outcome, in the ledger's vocabulary. */
export interface AttemptOutcome {
  readonly status: string;
  readonly certainty: AuthOutcomeCertaintyValue;
}

/**
 * `communication_messages.status` → attempt outcome.
 *
 *   accepted / sent / delivered / read → accepted
 *   failed / cancelled                 → definitive_failure
 *   dead_letter                        → definitive_failure, recorded as `failed`
 *   everything else (queued, dispatching, retry_scheduled, outcome_unknown, unrecognised)
 *                                      → unknown_outcome
 */
export function mapMessageStatusToAttemptOutcome(status: string): AttemptOutcome {
  switch (status) {
    case "accepted":
    case "sent":
    case "delivered":
    case "read":
      return { status, certainty: "accepted" };
    case "failed":
    case "cancelled":
      return { status, certainty: "definitive_failure" };
    case "dead_letter":
      // Not a ledger status; it IS a proven terminal non-delivery.
      return { status: "failed", certainty: "definitive_failure" };
    case "outcome_unknown":
      return { status: "outcome_unknown", certainty: "unknown_outcome" };
    default:
      // queued / dispatching / retry_scheduled / anything new. Never a proven failure.
      return { status: "dispatching", certainty: "unknown_outcome" };
  }
}

/**
 * A provider send result → attempt outcome. Certainty comes from the generic, conservative
 * `effectiveProviderOutcomeCertainty` (a contradictory or missing certainty folds to
 * `unknown_outcome`); it is never inferred from `accepted` or `retryable`.
 */
export function mapProviderResultToAttemptOutcome(result: {
  readonly accepted: boolean;
  readonly outcomeCertainty: AuthOutcomeCertaintyValue;
}): AttemptOutcome {
  const certainty = effectiveProviderOutcomeCertainty(result);
  if (certainty === "accepted") return { status: "accepted", certainty };
  if (certainty === "definitive_failure") return { status: "failed", certainty };
  return { status: "outcome_unknown", certainty: "unknown_outcome" };
}

/** A local send-path error (never reached a provider) is a PROVEN non-delivery. */
export function localFailureAttemptOutcome(): AttemptOutcome {
  return { status: "failed", certainty: "definitive_failure" };
}

/** Mirrors the ledger CHECK. A contradictory pair must never be written. */
export function isWritableAttemptOutcome(outcome: AttemptOutcome): boolean {
  return isConsistentAttemptOutcome(outcome.status, outcome.certainty);
}

// ----------------------------------------------------------------------------
// Local / preflight failure codes — DENY-ONLY
// ----------------------------------------------------------------------------

/** Exact codes emitted before, or instead of, a provider request leaving this process. */
export const LOCAL_PREFLIGHT_FAILURE_CODES: ReadonlySet<string> = new Set([
  AUTH_NETWORK_DEADLINE_EXHAUSTED,
  // Provider resolution / identity
  "WHATSAPP_PROVIDER_NOT_CONFIGURED",
  "SMS_PROVIDER_NOT_CONFIGURED",
  "SMS_PROVIDER_IDENTITY_MISMATCH",
  "UNSUPPORTED_DISPATCH_CHANNEL",
  "UNSUPPORTED_DISPATCH_PROVIDER",
  // Meta adapter preflight
  "META_RESOLVED_TEMPLATE_REQUIRED",
  "META_OUTBOUND_CONFIG_MISSING",
  // Exotel adapter preflight
  "EXOTEL_RESOLVED_TEMPLATE_REQUIRED",
  "EXOTEL_DESTINATION_INVALID",
  "EXOTEL_TEMPLATE_NAME_MISSING",
  "EXOTEL_TEMPLATE_BODY_MISSING",
  // Template / lane validation, and an unclassifiable adapter throw
  "VALIDATION",
  "TEMPLATE_NOT_FOUND_OR_INACTIVE",
  "TEMPLATE_NOT_READY",
  "TEMPLATE_LANE_MISMATCH",
  "TEMPLATE_CHANNEL_MISMATCH",
  "AUTH_LANE_SCHEDULING_UNSUPPORTED",
  "DISPATCH_RECORDING_FAILED",
  "PROVIDER_EXCEPTION",
]);

/** Families of local codes whose suffix varies (render reason, gate reason, …). */
export const LOCAL_PREFLIGHT_FAILURE_PREFIXES: readonly string[] = Object.freeze([
  "META_TEMPLATE_RENDER_",
  "APPROVED_TEMPLATE_",
  "RUNTIME_GATE_",
]);

/**
 * True when a failure code proves the request never left this process, so a fallback
 * would paper over a local misconfiguration.
 *
 * DENY-ONLY. A `true` result blocks a fallback. A `false` result AUTHORIZES NOTHING: the
 * Phase 5F-C1 decision engine still requires an operationally enabled policy and an
 * explicit, active, unambiguous failure rule, and no such rule exists.
 *
 * An absent or unsanitizable code is treated as local — fail closed.
 */
export function isLocalPreflightFailureCode(code: string | null | undefined): boolean {
  const safe = safeFailureCode(code);
  if (safe === null) return true;
  if (LOCAL_PREFLIGHT_FAILURE_CODES.has(safe)) return true;
  return LOCAL_PREFLIGHT_FAILURE_PREFIXES.some((prefix) => safe.startsWith(prefix));
}
