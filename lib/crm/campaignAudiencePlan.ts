// ============================================================================
// QF-MVP-30.4C — campaign audience planning (PURE).
//
// The batch-consent boundary. PURE: no DB, no `server-only`, no secret — so the
// inclusion rule and the batched dependency factory are executed directly by the
// offline validator.
//
// WHY THIS EXISTS
//  `decideCommunicationConsent` is the single consent authority and must NOT be
//  reimplemented. Its default dependencies issue ONE suppression query and ONE
//  preference query per call, so calling it per vendor would be a textbook N+1.
//  `buildBatchConsentDeps` therefore backs those same dependencies with maps that
//  were pre-loaded in TWO batched reads, so each per-vendor decision performs
//  ZERO database I/O while the authority's logic (suppression precedence,
//  reconsent, policy version) runs unchanged.
//
// LOCKED PROPERTIES
//  * `blocked` is NEVER included;
//  * a MARKETING campaign includes only `marketing_opted_in` — `unknown` is never
//    treated as marketing permission;
//  * a TRANSACTIONAL campaign additionally includes `no_consent_objection` and
//    `unknown`;
//  * excluded vendors are reduced to sanitized reason-code COUNTS — no excluded
//    identity is ever returned for persistence;
//  * the frozen set is ordered deterministically by vendor id, so the snapshot
//    fingerprint is reproducible;
//  * nothing here writes, sends, or infers communication authorisation.
// ============================================================================

import {
  CAMPAIGN_EXCLUSION_REASONS, CAMPAIGN_MAX_AUDIENCE,
  type CampaignConsentScope, type CampaignExclusionReason,
} from "./campaignContracts";

/** A raw suppression row as PostgREST returns it. Nullable exactly where the
 *  driver can hand back null; declared locally so this module never imports the
 *  server-only consent service. */
export interface BatchSuppressionRow {
  readonly id: string;
  readonly destination_hash: string;
  readonly channel: string;
  readonly scope: string;
  readonly reason: string | null;
  readonly policy_version: string | null;
  readonly is_active: boolean | null;
  readonly expires_at: string | null;
  readonly deactivated_at: string | null;
}
/** A raw preference row as PostgREST returns it. */
export interface BatchPreferenceRow {
  readonly id: string;
  readonly principal_type: string;
  readonly principal_id: string;
  readonly channel: string;
  readonly scope: string;
  readonly state: string;
  readonly policy_version: string | null;
  readonly consented_at: string | null;
  readonly withdrawn_at: string | null;
}

/**
 * The row shapes the authority validates. Deliberately IDENTICAL to its
 * `ConsentSuppressionRow` / `ConsentPreferenceRow`, so `BatchConsentDeps` is
 * structurally assignable to `ConsentDecisionDeps` with NO cast — a cast would
 * let a future drift in the authority's contract pass silently.
 */
export interface AuthoritySuppressionShape {
  readonly id: string;
  readonly scope: string;
  readonly reason: string;
  readonly policy_version: string;
  readonly is_active: boolean;
  readonly expires_at: string | null;
  readonly deactivated_at: string | null;
}
export interface AuthorityPreferenceShape {
  readonly id: string;
  readonly state: string;
  readonly policy_version: string;
  readonly consented_at: string | null;
  readonly withdrawn_at: string | null;
}

/** The shape `decideCommunicationConsent` accepts for injected reads. */
export interface BatchConsentDeps {
  readonly now: () => Date;
  readonly readSuppressions: (q: {
    readonly destinationHash: string;
    readonly channel: string;
    readonly scopes: readonly string[];
  }) => Promise<AuthoritySuppressionShape[]>;
  readonly readExactPreference: (q: {
    readonly principalType: string;
    readonly principalId: string;
    readonly channel: string;
    readonly scope: string;
  }) => Promise<AuthorityPreferenceShape[]>;
}

/**
 * Build consent dependencies backed by PRE-LOADED rows.
 *
 * `evaluatedAt` is captured once by the caller and returned by `now()`, so every
 * per-vendor decision in one prepare shares a single evaluation instant.
 * Cardinality is preserved verbatim (duplicates included) because the authority
 * relies on duplicate detection to raise an integrity violation.
 */
export function buildBatchConsentDeps(
  suppressions: readonly BatchSuppressionRow[],
  preferences: readonly BatchPreferenceRow[],
  evaluatedAt: Date,
): BatchConsentDeps {
  const suppByHash = new Map<string, BatchSuppressionRow[]>();
  for (const row of suppressions) {
    const list = suppByHash.get(row.destination_hash) ?? [];
    list.push(row);
    suppByHash.set(row.destination_hash, list);
  }
  const prefByKey = new Map<string, BatchPreferenceRow[]>();
  for (const row of preferences) {
    const key = `${row.principal_type}|${row.principal_id}|${row.channel}|${row.scope}`;
    const list = prefByKey.get(key) ?? [];
    list.push(row);
    prefByKey.set(key, list);
  }

  return {
    now: () => evaluatedAt,
    // The batch is already channel-scoped by its query, but the channel is
    // re-checked here so a mis-scoped batch can never widen a decision.
    readSuppressions: async ({ destinationHash, channel, scopes }) =>
      (suppByHash.get(destinationHash) ?? [])
        .filter((r) => r.channel === channel && r.is_active === true && scopes.includes(r.scope))
        .map(toAuthoritySuppression),
    readExactPreference: async ({ principalType, principalId, channel, scope }) =>
      (prefByKey.get(`${principalType}|${principalId}|${channel}|${scope}`) ?? [])
        .map(toAuthorityPreference),
  };
}

/**
 * Project a raw row onto the authority's shape WITHOUT repairing it.
 *
 * A null `reason`/`policy_version`/`state` becomes the literal "null", which is
 * outside every closed vocabulary the authority accepts — so a malformed row is
 * refused as an integrity violation and the vendor is EXCLUDED. Substituting a
 * plausible default here would silently convert corruption into permission.
 */
function toAuthoritySuppression(r: BatchSuppressionRow): AuthoritySuppressionShape {
  return {
    id: r.id,
    scope: String(r.scope),
    reason: String(r.reason),
    policy_version: String(r.policy_version),
    is_active: r.is_active === true,
    expires_at: r.expires_at,
    deactivated_at: r.deactivated_at,
  };
}
function toAuthorityPreference(r: BatchPreferenceRow): AuthorityPreferenceShape {
  return {
    id: r.id,
    state: String(r.state),
    policy_version: String(r.policy_version),
    consented_at: r.consented_at,
    withdrawn_at: r.withdrawn_at,
  };
}

/**
 * The inclusion rule.
 *
 * `blocked` never qualifies. For a MARKETING campaign only an explicit
 * `marketing_opted_in` qualifies — `unknown` and `no_consent_objection` are
 * absence of objection, NOT marketing permission. A TRANSACTIONAL campaign may
 * additionally include those two.
 */
export function isIncludableDisposition(
  disposition: string, consentScope: CampaignConsentScope,
): boolean {
  if (disposition === "blocked") return false;
  if (consentScope === "marketing") return disposition === "marketing_opted_in";
  return disposition === "marketing_opted_in"
    || disposition === "no_consent_objection"
    || disposition === "unknown";
}

/** Map a non-inclusion into the closed sanitized exclusion vocabulary. */
export function exclusionReasonFor(input: {
  readonly hasUsableDestination: boolean;
  readonly vendorEnabled: boolean;
  readonly vendorVerified: boolean;
  readonly disposition: string | null;
  readonly suppressed: boolean;
}): CampaignExclusionReason {
  if (!input.hasUsableDestination) return "missing_contact_channel";
  if (!input.vendorEnabled) return "vendor_disabled";
  if (!input.vendorVerified) return "vendor_unverified";
  if (input.suppressed) return "suppressed";
  return "consent_blocked";
}

/** Accumulate sanitized reason -> count. Never carries an identity. */
export function summarizeExclusions(reasons: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reasons) {
    if (!(CAMPAIGN_EXCLUSION_REASONS as readonly string[]).includes(r)) {
      throw new Error(`unknown exclusion reason code: ${r}`);
    }
    out[r] = (out[r] ?? 0) + 1;
  }
  const sorted: Record<string, number> = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];
  return sorted;
}

export interface PlannedRecipient {
  readonly vendor_id: string;
  readonly consent_disposition: string;
  readonly consent_reason_code: string;
  readonly consent_policy_version: string;
  readonly suppression_reason: string;
}

/**
 * Deterministic frozen order: ascending vendor id.
 *
 * The snapshot fingerprint is computed over this order and the DB stores a dense
 * ordinal, so the order is part of the frozen identity and must be stable across
 * runs and machines.
 */
export function orderPlannedRecipients(rows: readonly PlannedRecipient[]): PlannedRecipient[] {
  return [...rows].sort((a, b) => (a.vendor_id < b.vendor_id ? -1 : a.vendor_id > b.vendor_id ? 1 : 0));
}

/** Audience overflow FAILS CLOSED — never a silent truncation. */
export function assertAudienceWithinBounds(count: number): void {
  if (!Number.isInteger(count) || count < 0) throw new Error("invalid audience count");
  if (count > CAMPAIGN_MAX_AUDIENCE) {
    throw new Error(`audience of ${count} exceeds the ${CAMPAIGN_MAX_AUDIENCE} limit`);
  }
}

/**
 * An included recipient always carries suppression_reason 'none'.
 *
 * A suppressed principal is always EXCLUDED, so the authority's richer reason
 * vocabulary (user_stop, provider_block, hard_bounce, …) never needs to be
 * persisted — and deliberately is not, since the audience table's column
 * vocabulary is the campaign-side one. Exclusions are represented by counts only.
 */
export const INCLUDED_SUPPRESSION_REASON = "none" as const;
