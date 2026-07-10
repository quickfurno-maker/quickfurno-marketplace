// ============================================================================
// QuickFurno — lib/communication/providers/providerOutcome.ts   (Phase 5F-C2)
//
// The ONE definition of provider outcome CERTAINTY, shared by every channel.
//
// Phase 5F-B established these semantics for WhatsApp. Phase 5F-C2 centralizes them
// here so the SMS contract cannot drift into a weaker copy. `whatsappProvider.ts`
// re-exports the type and both helpers under their historical names, so every existing
// WhatsApp import keeps working unchanged.
//
// THE RULES (never relaxed)
//   • `accepted` ⟺ `accepted === true`. Nothing else may claim acceptance.
//   • A PRESENT certainty that disagrees with `accepted` is CONTRADICTORY and folds to
//     `unknown_outcome` — never to a success and never to a proven failure.
//   • A MISSING or INVALID certainty at an unsafe runtime boundary folds to
//     `unknown_outcome`.
//   • `unknown_outcome` is NEVER retry authorization: the provider may already have
//     delivered the message, so resending risks a duplicate OTP.
//
// Certainty is NEVER inferred from `accepted === false`, from `retryable === true`, from
// the mere existence of an HTTP error, a timeout, or a thrown exception. Those facts say
// nothing about whether the provider accepted the request.
// ============================================================================

import {
  AMBIGUOUS_ERROR_NAMES,
  AMBIGUOUS_TRANSPORT_CODES,
  PROVEN_PRECONNECT_FAILURE_CODES,
} from "./providerError";

/**
 * Safe outcome-certainty vocabulary, aligned with the Phase 5F-A auth transport
 * vocabulary (`lib/identity/authTransport.ts#AuthOutcomeCertainty`).
 *   accepted           — the provider PROVABLY accepted the request.
 *   definitive_failure — the request PROVABLY did not deliver.
 *   unknown_outcome    — neither can be proven (timeout / abort / ambiguous network /
 *                        ambiguous 5xx / 2xx without a usable provider message id).
 */
export type ProviderOutcomeCertainty = "accepted" | "definitive_failure" | "unknown_outcome";

/** The certainty values recognised at runtime. Anything else is unsafe. */
export const KNOWN_OUTCOME_CERTAINTIES: readonly ProviderOutcomeCertainty[] = [
  "accepted",
  "definitive_failure",
  "unknown_outcome",
];

/**
 * The minimal structural shape every channel's send result satisfies. Deliberately
 * narrow: the certainty helpers must never depend on a channel-specific field.
 */
export interface ProviderOutcomeResult {
  readonly accepted: boolean;
  readonly outcomeCertainty: ProviderOutcomeCertainty;
}

/**
 * A result is CONTRADICTORY when a PRESENT certainty disagrees with the acceptance flag —
 * `accepted=true` with a non-`accepted` certainty, or `accepted=false` with `accepted`
 * certainty. An ABSENT certainty is not contradictory here; the defensive path in
 * {@link effectiveProviderOutcomeCertainty} handles that conservatively.
 */
export function isContradictoryProviderOutcome(result: ProviderOutcomeResult): boolean {
  if (!result.outcomeCertainty) return false;
  const acceptedCertainty = result.outcomeCertainty === "accepted";
  return result.accepted !== acceptedCertainty;
}

/**
 * The effective certainty of a result, failing CONSERVATIVE. The field is required at the
 * type level; this is the defensive RUNTIME path for a legacy, duck-typed, or otherwise
 * unsafe result. Certainty is NEVER inferred from `result.accepted`.
 */
export function effectiveProviderOutcomeCertainty(result: ProviderOutcomeResult): ProviderOutcomeCertainty {
  const c = result.outcomeCertainty;
  if (!KNOWN_OUTCOME_CERTAINTIES.includes(c)) return "unknown_outcome";
  if (isContradictoryProviderOutcome(result)) return "unknown_outcome";
  return c;
}

/**
 * Whether a result may be AUTOMATICALLY retried by a transport layer.
 *
 * ONLY a PROVEN `definitive_failure` that the adapter also marked safely retryable
 * qualifies. An `unknown_outcome` never qualifies — however "transient" it looks, the
 * provider may already have delivered. An `accepted` result obviously never qualifies.
 *
 * NOTE: this authorizes at most a TRANSPORT-level retry of the same attempt. It is NOT an
 * authentication attempt budget. Phase 5F-C1's ledger remains authoritative: a maximum of
 * two transport attempts per authentication action, ever. Nothing in Phase 5F-C2 loops.
 */
export function permitsAutomaticRetry(
  result: ProviderOutcomeResult & { readonly retryable: boolean }
): boolean {
  return effectiveProviderOutcomeCertainty(result) === "definitive_failure" && result.retryable === true;
}

// ----------------------------------------------------------------------------
// Generic transport-level certainty
// ----------------------------------------------------------------------------
/**
 * A PROVIDER-INDEPENDENT transport outcome. This models what the HTTP/socket layer can
 * prove on its own — nothing about a specific provider's API payload.
 */
export type GenericTransportOutcome =
  | { readonly kind: "response"; readonly status: number; readonly hasProviderMessageId: boolean }
  | { readonly kind: "aborted" }
  | { readonly kind: "network_error"; readonly code: string | null };

export interface TransportCertainty {
  readonly outcomeCertainty: ProviderOutcomeCertainty;
  /** Only ever true for a PROVEN pre-connect failure. */
  readonly retryable: boolean;
}

/**
 * Classify a provider-INDEPENDENT transport outcome.
 *
 *   aborted (timeout)                     → unknown_outcome, never retried
 *   ambiguous / unclassified network error → unknown_outcome, never retried
 *   PROVEN pre-connect failure             → definitive_failure, safely retryable
 *   2xx WITH a usable provider message id  → accepted
 *   2xx WITHOUT one                        → unknown_outcome
 *   4xx (explicit rejection)               → definitive_failure, not retryable
 *   5xx (ambiguous)                        → unknown_outcome
 *
 * IMPORTANT — this deliberately does NOT interpret any provider's own response body,
 * error codes, or API-level semantics. A real adapter added in a later phase MUST
 * classify its provider's payload explicitly; generic code cannot guess it, and pretending
 * otherwise would silently mislabel a delivered message as a proven failure.
 */
export function classifyTransportCertainty(outcome: GenericTransportOutcome): TransportCertainty {
  if (outcome.kind === "aborted") {
    return { outcomeCertainty: "unknown_outcome", retryable: false };
  }
  if (outcome.kind === "network_error") {
    const code = typeof outcome.code === "string" ? outcome.code : null;
    if (code && PROVEN_PRECONNECT_FAILURE_CODES.has(code)) {
      return { outcomeCertainty: "definitive_failure", retryable: true };
    }
    // Ambiguous transport codes AND anything unclassified: never provable.
    return { outcomeCertainty: "unknown_outcome", retryable: false };
  }
  const { status, hasProviderMessageId } = outcome;
  if (status >= 200 && status < 300) {
    return hasProviderMessageId
      ? { outcomeCertainty: "accepted", retryable: false }
      : { outcomeCertainty: "unknown_outcome", retryable: false };
  }
  if (status >= 400 && status < 500) {
    return { outcomeCertainty: "definitive_failure", retryable: false };
  }
  return { outcomeCertainty: "unknown_outcome", retryable: false };
}

/** Re-exported so an adapter can reason about a thrown value without a second copy. */
export { AMBIGUOUS_ERROR_NAMES, AMBIGUOUS_TRANSPORT_CODES, PROVEN_PRECONNECT_FAILURE_CODES };
