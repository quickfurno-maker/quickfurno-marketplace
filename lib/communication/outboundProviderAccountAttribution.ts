// ============================================================================
// QuickFurno — lib/communication/outboundProviderAccountAttribution.ts  (Phase 8B-1B-B)
//
// PURE, NON-SECRET outbound provider-account attribution vocabulary.
//
// THE INVARIANT THIS SERVES:
//
//     A Meta provider request may occur ONLY AFTER the message has been durably bound
//     to the exact `communication_provider_accounts.id` that owns the provider runtime
//     identity used for that request.
//
//     UNPROVEN OR UNBOUND PROVIDER ACCOUNT = ZERO PROVIDER CALLS.
//
// This module holds ONLY types and closed mappings. It performs NO database query (the
// lookup is the FROZEN Phase 8B-1B-A resolver's job), NO provider access, NO network,
// NO environment read and NO readiness evaluation. Ownership stays strictly separate
// from send-eligibility: a disabled / unhealthy / historical account still OWNS its
// identity, and this module never re-decides that.
//
// The safe identity carries the four NON-SECRET fields needed to prove ownership and
// nothing else — never an access token, app secret, verify token, plaintext destination
// or provider payload.
// ============================================================================

import type {
  OwnershipResolutionInput,
  ProviderAccountOwnership,
} from "./providers/providerAccountOwnership";

/**
 * The NON-SECRET provider identity of the SELECTED runtime, projected from the single
 * immutable outbound configuration snapshot that also built the provider adapter. It is
 * the identity the Meta request URL is actually built from — so resolving it records the
 * REAL sender; it never infers or guesses an owner.
 */
export interface SafeOutboundProviderIdentity {
  readonly providerKey: string;
  readonly channel: string;
  readonly phoneNumberReference: string;
  readonly expectedWabaId: string;
}

/** The ownership resolver the production factory injects — the FROZEN Phase 8B-1B-A authority. */
export type OutboundOwnershipResolver = (input: OwnershipResolutionInput) => Promise<ProviderAccountOwnership>;

/**
 * The narrow dependency injected into CommunicationService by the runtime factory. It carries the
 * NON-SECRET identity to prove AND the resolver that proves it. CommunicationService therefore never
 * imports the runtime service and never learns where the resolver was implemented — the production
 * factory binds the exact frozen `resolveOwningProviderAccount`, and a test binds it too.
 */
export interface OutboundAccountAttributionDependency {
  readonly identity: SafeOutboundProviderIdentity;
  readonly resolveOwnership: OutboundOwnershipResolver;
}

/** Every closed, sanitized attribution failure code. No raw error or identity ever leaks. */
export const ATTRIBUTION_FAILURE = {
  NOT_FOUND: "PROVIDER_ACCOUNT_NOT_FOUND",
  AMBIGUOUS: "PROVIDER_ACCOUNT_AMBIGUOUS",
  WABA_MISMATCH: "PROVIDER_ACCOUNT_WABA_MISMATCH",
  IDENTITY_INVALID: "PROVIDER_ACCOUNT_IDENTITY_INVALID",
  LOOKUP_FAILED: "PROVIDER_ACCOUNT_LOOKUP_FAILED",
  BIND_FAILED: "PROVIDER_ACCOUNT_BIND_FAILED",
  BIND_CONFLICT: "PROVIDER_ACCOUNT_BIND_CONFLICT",
  MISMATCH: "PROVIDER_ACCOUNT_MISMATCH",
  UNAVAILABLE: "PROVIDER_ACCOUNT_ATTRIBUTION_UNAVAILABLE",
} as const;

export type AttributionFailureCode = (typeof ATTRIBUTION_FAILURE)[keyof typeof ATTRIBUTION_FAILURE];

/** Sanitized, closed operator-facing messages. They never contain an id, secret or raw error. */
export const ATTRIBUTION_FAILURE_MESSAGE: Record<AttributionFailureCode, string> = {
  [ATTRIBUTION_FAILURE.NOT_FOUND]: "No provider account owns the configured sending identity; nothing was dispatched.",
  [ATTRIBUTION_FAILURE.AMBIGUOUS]: "The configured sending identity resolves to more than one provider account; nothing was dispatched.",
  [ATTRIBUTION_FAILURE.WABA_MISMATCH]: "The owning provider account disagrees with the configured business account; nothing was dispatched.",
  [ATTRIBUTION_FAILURE.IDENTITY_INVALID]: "The configured sending identity is malformed; nothing was dispatched.",
  [ATTRIBUTION_FAILURE.LOOKUP_FAILED]: "The provider account could not be resolved; nothing was dispatched.",
  [ATTRIBUTION_FAILURE.BIND_FAILED]: "The provider account could not be durably bound; nothing was dispatched.",
  [ATTRIBUTION_FAILURE.BIND_CONFLICT]: "The message ownership state changed concurrently; nothing was dispatched.",
  [ATTRIBUTION_FAILURE.MISMATCH]: "The message is already bound to a different provider account; nothing was dispatched.",
  [ATTRIBUTION_FAILURE.UNAVAILABLE]: "Provider-account attribution is unavailable for this sender; nothing was dispatched.",
};

/**
 * The closed attribution decision.
 *   • `proceed`  — ownership PROVEN and the account is durably bound; the provider may be called.
 *   • `blocked`  — fail closed. `retryable` distinguishes an INFRASTRUCTURE failure (the lookup or
 *                  the binding write broke — no request occurred, so the existing retry authority
 *                  may safely re-run it) from a DEFINITIVE configuration/security failure.
 *                  `preserveRow` marks a concurrent-state conflict that must NOT be overwritten by
 *                  an unconstrained id-only failure update.
 */
export type OutboundAttributionDecision =
  | { readonly kind: "proceed"; readonly accountId: string }
  | {
      readonly kind: "blocked";
      readonly code: AttributionFailureCode;
      readonly message: string;
      readonly retryable: boolean;
      readonly preserveRow: boolean;
    };

function blocked(code: AttributionFailureCode, retryable: boolean, preserveRow = false): OutboundAttributionDecision {
  return { kind: "blocked", code, message: ATTRIBUTION_FAILURE_MESSAGE[code], retryable, preserveRow };
}

const NON_EMPTY = /\S/;

/**
 * PURE validation of the injected dependency. A missing or malformed identity can never
 * produce a valid ownership query — it fails closed BEFORE any lookup is attempted.
 */
export function isUsableAttributionDependency(
  dep: OutboundAccountAttributionDependency | null | undefined
): dep is OutboundAccountAttributionDependency {
  if (!dep || typeof dep !== "object") return false;
  if (typeof dep.resolveOwnership !== "function") return false;
  const id = dep.identity;
  if (!id || typeof id !== "object") return false;
  for (const v of [id.providerKey, id.channel, id.phoneNumberReference, id.expectedWabaId]) {
    if (typeof v !== "string" || !NON_EMPTY.test(v)) return false;
  }
  return true;
}

/** A missing/malformed dependency is a DEFINITIVE, non-retryable failure with zero provider calls. */
export function attributionUnavailable(): OutboundAttributionDecision {
  return blocked(ATTRIBUTION_FAILURE.UNAVAILABLE, false);
}

/**
 * Map the FROZEN resolver's closed ownership union onto the closed attribution decision.
 *
 * `query_error` is an INFRASTRUCTURE failure and is NEVER collapsed into `not_found`.
 * `ambiguous` is NEVER promoted to `owned` and never selects a row by position.
 */
export function decideFromOwnership(ownership: ProviderAccountOwnership): OutboundAttributionDecision {
  switch (ownership.kind) {
    case "owned":
      return { kind: "proceed", accountId: ownership.account.id };
    case "not_found":
      return blocked(ATTRIBUTION_FAILURE.NOT_FOUND, false);
    case "ambiguous":
      return blocked(ATTRIBUTION_FAILURE.AMBIGUOUS, false);
    case "waba_mismatch":
      return blocked(ATTRIBUTION_FAILURE.WABA_MISMATCH, false);
    case "invalid_input":
      return blocked(ATTRIBUTION_FAILURE.IDENTITY_INVALID, false);
    case "query_error":
      return blocked(ATTRIBUTION_FAILURE.LOOKUP_FAILED, true);
    default:
      return blocked(ATTRIBUTION_FAILURE.UNAVAILABLE, false);
  }
}

/** The closed outcome of the guarded binding compare-and-set. */
export type BindingOutcome =
  | { readonly kind: "bound" }
  | { readonly kind: "same_account" }
  | { readonly kind: "mismatch" }
  | { readonly kind: "conflict" }
  | { readonly kind: "error" };

/** Map the binding outcome onto the closed decision. Only `bound`/`same_account` may proceed. */
export function decideFromBinding(outcome: BindingOutcome, accountId: string): OutboundAttributionDecision {
  switch (outcome.kind) {
    case "bound":
    case "same_account":
      return { kind: "proceed", accountId };
    case "mismatch":
      // Never reassign a row that already belongs to a different account.
      return blocked(ATTRIBUTION_FAILURE.MISMATCH, false, true);
    case "conflict":
      // Zero rows matched: status or ownership moved concurrently. Preserve the row —
      // an unconstrained id-only failure update would clobber the concurrent state.
      return blocked(ATTRIBUTION_FAILURE.BIND_CONFLICT, false, true);
    case "error":
      return blocked(ATTRIBUTION_FAILURE.BIND_FAILED, true);
    default:
      return blocked(ATTRIBUTION_FAILURE.BIND_FAILED, true);
  }
}
