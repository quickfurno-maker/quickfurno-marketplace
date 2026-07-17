// ============================================================================
// QuickFurno — lib/communication/providers/providerAccountOwnership.ts  (Phase 8B-1B-A)
//
// PURE provider-account OWNERSHIP authority. It answers exactly one question:
//
//     Which durable `communication_provider_accounts` row OWNS this identity?
//
// It is deliberately SEPARATE from send-eligibility (`evaluateProviderAccountReadiness`):
// ownership is READINESS-AGNOSTIC — a disabled / unhealthy / historical account still OWNS
// its own callbacks and messages. This module holds only the types + the PURE classification
// of an already-fetched result set; the DB query lives in the runtime service.
//
// It never selects a first row (a >1 result is AMBIGUOUS, never "pick one"), never falls back
// to environment config, never evaluates send-readiness, and never touches the network.
// A query error, a MALFORMED database result and an invalid input are TYPED, distinct,
// fail-closed outcomes — never collapsed into `not_found` or `owned`.
//
// The projection is IDENTITY-ONLY (see OwningProviderAccountRow): no secret and no eligibility
// column is ever retrieved. Readiness-agnosticism is therefore structural rather than a promise —
// the resolver cannot gate on state it never fetched.
// ============================================================================

// The Meta identifier grammar is REUSED verbatim from the Phase 8B-1A callback-identity
// authority — this module deliberately defines no second (and therefore no conflicting)
// Meta-ID definition. That module is imported read-only and is not modified here.
import { META_CALLBACK_ID_GRAMMAR } from "./metaCallbackIdentity";

/**
 * The MINIMAL account projection ownership needs — IDENTITY ONLY.
 *
 * It carries exactly the columns required to answer "which account owns this identity":
 * the durable FK target (`id`), the identity the caller looked up (`provider_key`, `channel`,
 * `phone_number_reference`) and the WABA the caller may validate against
 * (`business_account_reference`).
 *
 * It deliberately carries NO ELIGIBILITY STATE — no readiness_status, configuration_status,
 * business_verification_status, phone_number_status, webhook_status, health_status or
 * billing_status. Ownership is readiness-AGNOSTIC, so those columns are not merely ignored,
 * they are never RETRIEVED: a projection that cannot see eligibility can never gate on it.
 * Send-eligibility remains the separate concern of `evaluateProviderAccountReadiness`.
 */
export interface OwningProviderAccountRow {
  readonly id: string;
  readonly provider_key: string;
  readonly channel: string;
  readonly business_account_reference: string | null;
  readonly phone_number_reference: string | null;
}

/**
 * The EXACT column list the resolver SELECTs, in this exact order. Explicit so that no secret
 * and no eligibility column is ever fetched. It must stay in lockstep with
 * {@link OwningProviderAccountRow}.
 */
export const OWNING_PROVIDER_ACCOUNT_COLUMNS =
  "id, provider_key, channel, business_account_reference, phone_number_reference";

/** The closed, fail-closed ownership outcome union. */
export type ProviderAccountOwnership =
  | { readonly kind: "owned"; readonly account: OwningProviderAccountRow }
  | { readonly kind: "not_found" }
  | { readonly kind: "ambiguous"; readonly count: number }
  | { readonly kind: "waba_mismatch"; readonly account: OwningProviderAccountRow }
  | { readonly kind: "invalid_input" }
  | { readonly kind: "query_error" };

export interface OwnershipResolutionInput {
  readonly providerKey: string;
  readonly channel: string;
  readonly phoneNumberReference: string;
  /** Optional WABA (business_account_reference) to validate the resolved row against. */
  readonly expectedWabaId?: string;
}

/**
 * The grammar for INTERNAL identifiers (provider keys and channels): a bounded lowercase
 * snake_case token. This is NOT a Meta identifier grammar. Every provider key in the repository
 * (`meta_whatsapp_cloud`, `exotel_sms`, `mock_sms`, `mock`, `system`) and every channel the schema
 * accepts (`whatsapp`, `sms`, `rcs`) matches it. It deliberately does NOT restate the channel
 * CHECK's closed set — that set is the database's authority and duplicating it here would create a
 * second definition that could silently drift.
 *
 * Because the grammar admits no whitespace, no control character and at most 64 characters, a
 * PADDED, control-character-bearing or oversized identifier is REJECTED — never silently trimmed.
 */
export const OWNERSHIP_INTERNAL_ID_GRAMMAR = /^[a-z][a-z0-9_]{0,63}$/;

function isInternalId(v: unknown): v is string {
  return typeof v === "string" && OWNERSHIP_INTERNAL_ID_GRAMMAR.test(v);
}

/**
 * Meta identifiers (phone-number id / WABA id) reuse the Phase 8B-1A callback-identity grammar
 * (`^[0-9]{1,64}$`) verbatim, so an ownership lookup and a callback-identity decision can never
 * disagree about what a well-formed Meta id is.
 */
function isMetaId(v: unknown): v is string {
  return typeof v === "string" && META_CALLBACK_ID_GRAMMAR.test(v);
}

/**
 * PURE input validation. A MALFORMED identity fails closed exactly like a blank one: padding,
 * control characters, over-length values and wrong-shaped identifiers are all rejected, so a
 * caller can never launder a bad identity into a database query.
 *
 * `expectedWabaId` is optional, but when SUPPLIED it must be a well-formed Meta id — an empty or
 * malformed expected WABA can never prove a match, so it is malformed input, not "no expectation".
 */
export function isValidOwnershipInput(input: OwnershipResolutionInput): boolean {
  if (!input || typeof input !== "object") return false;
  if (!isInternalId(input.providerKey)) return false;
  if (!isInternalId(input.channel)) return false;
  if (!isMetaId(input.phoneNumberReference)) return false;
  if (input.expectedWabaId !== undefined && !isMetaId(input.expectedWabaId)) return false;
  return true;
}

/**
 * PURE ownership classification of an ALREADY-FETCHED, exact-match result set. The resolver runs the
 * exact `(provider_key, channel, phone_number_reference)` query and hands its rows here.
 *
 *   • 0 rows              → not_found;
 *   • >1 rows             → ambiguous (NEVER first-row selection);
 *   • exactly 1 row + an `expectedWabaId` that differs from business_account_reference → waba_mismatch;
 *   • exactly 1 row otherwise → owned.
 *
 * Readiness-AGNOSTIC: a disabled / unhealthy / historical account still resolves as `owned`. This
 * function never inspects readiness/configuration/health to decide ownership.
 */
export function classifyOwnership(
  rows: readonly OwningProviderAccountRow[],
  expectedWabaId?: string
): ProviderAccountOwnership {
  if (!Array.isArray(rows)) return { kind: "query_error" };
  if (rows.length === 0) return { kind: "not_found" };
  if (rows.length > 1) return { kind: "ambiguous", count: rows.length };
  const account = rows[0];
  if (expectedWabaId !== undefined && account.business_account_reference !== expectedWabaId) {
    return { kind: "waba_mismatch", account };
  }
  return { kind: "owned", account };
}
