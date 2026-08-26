// ============================================================================
// QF-MVP-40-R8 — THE CANONICAL META STAGING IDENTITY BOUNDARY.
//
// This module is the SINGLE future-facing source of truth for which Meta assets are
// the dedicated QuickFurno staging/test assets. Every operator written from R8 onward
// imports its pins from here and re-declares nothing.
//
// WHY IT EXISTS — THE DEFECT IT CLOSES
//   Between R7B (2026-08-13) and R7N (2026-08-24) the repository pinned a "staging"
//   identity triple that was MIXED: the app id digest was the genuine QuickFurno Staging
//   app, but the WABA and phone-number digests were the PRODUCTION WABA and PRODUCTION
//   phone number. Eight one-shot authorities executed against that triple. Live
//   diagnosis on 2026-08-25 proved the actual dedicated staging/test WABA is a different
//   asset entirely, carrying only Meta's own sample templates.
//
//   The historical pins are therefore preserved below as HISTORICAL_MIXED_IDENTITY_DIGESTS
//   — that is what those operations genuinely ran against, and rewriting it would be
//   evidence forgery. They are NOT a staging identity and nothing new may target them.
//
// IDENTITY IS EXACT, AND ONLY EXACT
//   A Meta display name, a WABA name, a phone `verified_name`, the word "test" and an
//   environment label are all free text. None of them appears in this file and none may
//   ever be admitted as evidence. The only accepted proof that an asset is the staging
//   asset is SHA-256 digest equality against the pins below.
//
// DIGESTS, NOT RAW IDS
//   The repository keeps raw Meta asset ids out of committed artifacts (the packet
//   validator rule `noSecretOrPii` rejects a "waba_id" key; the remote-state ledger
//   records none). Digests preserve that posture while still failing closed against every
//   other asset: an operator hashes the id supplied at runtime and compares.
// ============================================================================

import { createHash } from "node:crypto";

export function sha256Hex(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

/** The three identity roles, in the order they are reported. Not a free-form key set. */
export const IDENTITY_ROLES = Object.freeze(["appId", "wabaId", "phoneNumberId"]);

// ---------------------------------------------------------------------------
// THE ACTUAL dedicated staging/test assets. Proven live on 2026-08-25.
// ---------------------------------------------------------------------------
export const ACTUAL_STAGING_IDENTITY_DIGESTS = Object.freeze({
  appId: "6de73d8d79a40245af3dfa60065ae6a86274b043d8646ec3a84a0719273ece80",
  wabaId: "0ffbaea4f1e46fced957497877dbbd974597ecae5bb317437a9e60b49a69fae0",
  phoneNumberId: "0a9b1bb3881a05e5b4d49ccf040180174e9fd37b7d7a86aada6d5eb101979edb",
});

// ---------------------------------------------------------------------------
// THE PRODUCTION assets. Committed as a DENY LIST, never as a target.
//
// These are here so that production rejection is an INDEPENDENT layer rather than a
// side effect of the allow-list. If a staging pin above were ever edited carelessly to a
// production value, the allow-list would happily accept it; this list still refuses.
// ---------------------------------------------------------------------------
export const KNOWN_PRODUCTION_IDENTITY_DIGESTS = Object.freeze({
  appId: "6ce1cc0c3ba0d2d1daf40bdfa0e0448ae5e3a52ea8f20a521b68f988c0701da3",
  wabaId: "c9b1f7e0bda69377219b80f8ca73b91475405aefe1e48babd0dc24231cc8037a",
  phoneNumberId: "1b93eabc591212e3cfa0cd53423d6ebb333afa0f07f7e4a5a4ea246d736c969c",
});

// ---------------------------------------------------------------------------
// THE HISTORICAL MIXED triple that R7B..R7N actually executed against.
//
// Preserved verbatim as historical evidence. It is deliberately NOT a staging identity:
// its wabaId and phoneNumberId are the production assets above. R7B re-exports this as
// its `EXPECTED_IDENTITY_DIGESTS` so the historical operators keep describing, exactly,
// the identity they really used — and so they can never be repointed by a constant edit.
// ---------------------------------------------------------------------------
export const HISTORICAL_MIXED_IDENTITY_DIGESTS = Object.freeze({
  appId: ACTUAL_STAGING_IDENTITY_DIGESTS.appId,
  wabaId: KNOWN_PRODUCTION_IDENTITY_DIGESTS.wabaId,
  phoneNumberId: KNOWN_PRODUCTION_IDENTITY_DIGESTS.phoneNumberId,
});

export const IdentityFault = Object.freeze({
  MISSING: "identity_missing",
  MALFORMED: "identity_malformed",
  NOT_ACTUAL_STAGING: "identity_not_actual_staging",
  IS_PRODUCTION: "identity_is_production",
});

/** A Meta identifier is a bare decimal string. Anything else is malformed, not "close". */
export const META_ID_PATTERN = /^[0-9]{6,}$/;

/**
 * Classify a runtime-supplied identity triple against the ACTUAL staging pins.
 *
 * Accepts raw ids only — never a name, label or environment string. Returns every fault
 * it finds rather than the first, so an operator can print a complete refusal reason.
 *
 * Two independent rejection layers run for each role:
 *   1. the digest must equal the ACTUAL staging pin;
 *   2. the digest must NOT equal any known production pin.
 * Layer 2 is redundant while layer 1's pins are correct. That redundancy is the point.
 */
export function classifyStagingIdentity(supplied = {}) {
  const faults = [];
  const digests = {};

  for (const role of IDENTITY_ROLES) {
    const raw = supplied[role];
    if (raw === undefined || raw === null || String(raw) === "") {
      faults.push(`${IdentityFault.MISSING}:${role}`);
      continue;
    }
    if (!META_ID_PATTERN.test(String(raw))) {
      faults.push(`${IdentityFault.MALFORMED}:${role}`);
      continue;
    }
    const digest = sha256Hex(raw);
    digests[role] = digest;

    if (digest !== ACTUAL_STAGING_IDENTITY_DIGESTS[role]) {
      faults.push(`${IdentityFault.NOT_ACTUAL_STAGING}:${role}`);
    }
    // Independent of the allow-list, and reported even when the allow-list already failed:
    // "this is production" is a materially different fault from "this is not staging".
    if (Object.values(KNOWN_PRODUCTION_IDENTITY_DIGESTS).includes(digest)) {
      faults.push(`${IdentityFault.IS_PRODUCTION}:${role}`);
    }
  }

  return { ok: faults.length === 0, faults, digests };
}

/** True only for the exact ACTUAL staging triple. Convenience over classifyStagingIdentity. */
export function isActualStagingIdentity(supplied = {}) {
  return classifyStagingIdentity(supplied).ok;
}

/**
 * Whether a single digest is a known production asset digest, in ANY role.
 * Used by write-side operators as a last independent fence before a mutation.
 */
export function isKnownProductionDigest(digest) {
  return Object.values(KNOWN_PRODUCTION_IDENTITY_DIGESTS).includes(String(digest));
}

// ===========================================================================
// QF-MVP-40-R8 — RETIREMENT OF THE HISTORICAL ONE-SHOT AUTHORITIES
//
// Seven one-shot operators executed against HISTORICAL_MIXED_IDENTITY_DIGESTS: the R7B
// creation authority, the five creation authorities that import R7B's pure layer
// (R7I, R7K, R7L, R7M, R7N) and the R7C database rebind. Every one is spent — their
// manifests record EXECUTED_ONCE / CONSUMED / SPENT and no target is pending. They are
// retained because their code is the evidence of what ran.
//
// THEY ARE NOW READ-ONLY, PERMANENTLY, AND FOR TWO INDEPENDENT REASONS:
//
//   1. This retirement. Each CLI passes its parsed flags through
//      `retireHistoricalMutation()` immediately after parsing and before any network,
//      database or decision call, so the mutation bit is false no matter which flags
//      were typed. Dry-run reading still works — that is deliberate, because read-only
//      reconciliation against the historical WABA remains legitimate evidence-gathering.
//
//   2. Their identity pins. They remain bound to HISTORICAL_MIXED_IDENTITY_DIGESTS, so
//      pointing one at the ACTUAL staging WABA fails its own identity check.
//
// Neither reason can be undone by editing a constant, which is the property
// QF-MVP-40-R8 exists to guarantee: a spent authority must not become a NEW authority
// against a DIFFERENT WABA merely because the pins under it changed. New work against
// the actual staging assets requires a NEW operator with its OWN owner acknowledgement.
// ===========================================================================

export const HISTORICAL_AUTHORITY_RETIREMENT = "QF-MVP-40-R8-IDENTITY-BOUNDARY";

/**
 * Force the mutation bit of a historical operator's parsed flags to false.
 *
 * `mutationKey` is the operator's own gate name (`mayPost` for the Meta creation
 * operators, `mayWrite` for the R7C database rebind). The returned object is frozen so a
 * later line cannot re-enable it, and it carries the retirement marker for printing.
 */
export function retireHistoricalMutation(flags = {}, { operatorId, mutationKey } = {}) {
  if (!operatorId || !mutationKey) {
    throw new Error("retireHistoricalMutation requires operatorId and mutationKey");
  }
  return Object.freeze({
    ...flags,
    [mutationKey]: false,
    historicalAuthorityRetired: true,
    retiredBy: HISTORICAL_AUTHORITY_RETIREMENT,
    retiredOperatorId: operatorId,
  });
}

/**
 * The banner a retired operator prints, so an operator run can never look authorised.
 *
 * Returns ONE pre-joined string rather than an array on purpose: every call site would
 * otherwise need a `for` loop, and several of these operators are validated by a
 * control-flow scanner that (correctly) refuses any loop construct in a one-shot
 * mutation operator. A helper must not force its callers to trip that rule.
 */
export function historicalRetirementBanner(operatorId) {
  return [
    `   authority state         : RETIRED (${HISTORICAL_AUTHORITY_RETIREMENT})`,
    `   retired operator        : ${operatorId}`,
    "   mutation capability     : NONE — read-only, whatever flags were supplied",
    "   reason                  : this authority executed against the historical mixed",
    "                             identity (staging app + PRODUCTION WABA/phone). It is",
    "                             spent, and it is not an authority for the actual",
    "                             staging WABA. New work needs a new owner-acknowledged",
    "                             operator built on ACTUAL_STAGING_IDENTITY_DIGESTS.",
  ].join("\n");
}
