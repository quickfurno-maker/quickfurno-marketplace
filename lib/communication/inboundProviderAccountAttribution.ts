// ============================================================================
// QuickFurno — lib/communication/inboundProviderAccountAttribution.ts  (Phase 8B-1B-C)
//
// PURE, closed decision mapping for INBOUND / DELIVERY provider-account attribution.
//
// THE INVARIANT THIS SERVES:
//
//     A new Meta INBOUND_MESSAGE or DELIVERY_STATUS callback may produce receipt,
//     inbound, delivery, consent-command or acknowledgement effects ONLY when
//     `resolveOwningProviderAccount` returns `owned`.
//
// This module holds ONLY types + the pure classification of an ALREADY-FETCHED ownership
// result. It performs NO database query (the frozen Phase 8B-1B-A resolver owns that), NO
// provider access, NO network, NO environment read, NO first-row selection and NO readiness
// evaluation. It preserves every resolver outcome DISTINCTLY:
//
//     owned        → BIND the exact account id and continue processing.
//     query_error  → RETRY: the caller returns HTTP 503 with ZERO effect-bearing writes.
//     not_found    ┐
//     ambiguous    │ → REJECTED (deterministic): the caller returns the generic HTTP 200
//     waba_mismatch│   posture with ZERO receipt/inbound/delivery/consent/ack effects and a
//     invalid_input┘   sanitized operational log — never a first-row fallback, never unbound
//                      persistence.
//
// Every code/reason is a sanitized, closed constant: it never carries an id, a secret, a
// token, a phone number or a raw driver error.
// ============================================================================

import type { ProviderAccountOwnership } from "./providers/providerAccountOwnership";

/** Every closed, sanitized inbound/delivery attribution failure code. No raw error or identity ever leaks. */
export const INBOUND_ATTRIBUTION_FAILURE = {
  NOT_FOUND: "INBOUND_PROVIDER_ACCOUNT_NOT_FOUND",
  AMBIGUOUS: "INBOUND_PROVIDER_ACCOUNT_AMBIGUOUS",
  WABA_MISMATCH: "INBOUND_PROVIDER_ACCOUNT_WABA_MISMATCH",
  IDENTITY_INVALID: "INBOUND_PROVIDER_ACCOUNT_IDENTITY_INVALID",
  LOOKUP_FAILED: "INBOUND_PROVIDER_ACCOUNT_LOOKUP_FAILED",
  UNAVAILABLE: "INBOUND_PROVIDER_ACCOUNT_ATTRIBUTION_UNAVAILABLE",
} as const;

export type InboundAttributionFailureCode =
  (typeof INBOUND_ATTRIBUTION_FAILURE)[keyof typeof INBOUND_ATTRIBUTION_FAILURE];

/** Sanitized, closed operator-facing reasons. They NEVER contain an id, secret, token or phone. */
export const INBOUND_ATTRIBUTION_REASON: Record<InboundAttributionFailureCode, string> = {
  [INBOUND_ATTRIBUTION_FAILURE.NOT_FOUND]: "no provider account owns the callback identity; nothing was persisted.",
  [INBOUND_ATTRIBUTION_FAILURE.AMBIGUOUS]: "the callback identity resolves to more than one provider account; nothing was persisted.",
  [INBOUND_ATTRIBUTION_FAILURE.WABA_MISMATCH]: "the owning provider account disagrees with the callback business account; nothing was persisted.",
  [INBOUND_ATTRIBUTION_FAILURE.IDENTITY_INVALID]: "the callback identity is malformed; nothing was persisted.",
  [INBOUND_ATTRIBUTION_FAILURE.LOOKUP_FAILED]: "the provider account could not be resolved; nothing was persisted (retryable).",
  [INBOUND_ATTRIBUTION_FAILURE.UNAVAILABLE]: "provider-account attribution is unavailable; nothing was persisted.",
};

/**
 * The closed inbound attribution decision.
 *   • `owned`     — ownership PROVEN; the caller binds `accountId` on every persisted row and continues.
 *   • `retry`     — an INFRASTRUCTURE (query) failure: the caller returns 503 with ZERO effect-bearing
 *                   writes so Meta retries the whole verified path.
 *   • `rejected`  — a DETERMINISTIC non-owned outcome: the caller returns the generic 200 posture with
 *                   ZERO effects and a sanitized log. A retry could never change it.
 */
export type InboundAttributionDecision =
  | { readonly kind: "owned"; readonly accountId: string }
  | { readonly kind: "retry"; readonly code: InboundAttributionFailureCode; readonly reason: string }
  | { readonly kind: "rejected"; readonly code: InboundAttributionFailureCode; readonly reason: string };

function rejected(code: InboundAttributionFailureCode): InboundAttributionDecision {
  return { kind: "rejected", code, reason: INBOUND_ATTRIBUTION_REASON[code] };
}

/**
 * Map the FROZEN resolver's closed ownership union onto the closed inbound decision.
 *
 * `owned` is the ONLY outcome that continues to effects. `query_error` is retryable infrastructure and is
 * NEVER collapsed into `not_found`. `ambiguous` is NEVER promoted to `owned` and never selects a row by
 * position (the resolver already refuses first-row; this mapping does too). Every other outcome is a
 * DETERMINISTIC rejection with zero effects.
 */
export function decideInboundAttribution(ownership: ProviderAccountOwnership): InboundAttributionDecision {
  switch (ownership.kind) {
    case "owned":
      return { kind: "owned", accountId: ownership.account.id };
    case "query_error":
      return {
        kind: "retry",
        code: INBOUND_ATTRIBUTION_FAILURE.LOOKUP_FAILED,
        reason: INBOUND_ATTRIBUTION_REASON[INBOUND_ATTRIBUTION_FAILURE.LOOKUP_FAILED],
      };
    case "not_found":
      return rejected(INBOUND_ATTRIBUTION_FAILURE.NOT_FOUND);
    case "ambiguous":
      return rejected(INBOUND_ATTRIBUTION_FAILURE.AMBIGUOUS);
    case "waba_mismatch":
      return rejected(INBOUND_ATTRIBUTION_FAILURE.WABA_MISMATCH);
    case "invalid_input":
      return rejected(INBOUND_ATTRIBUTION_FAILURE.IDENTITY_INVALID);
    default:
      return rejected(INBOUND_ATTRIBUTION_FAILURE.UNAVAILABLE);
  }
}
