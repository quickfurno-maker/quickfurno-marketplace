# QuickFurno — Phase 5F-D2-C

## Read-Only Communication Consent Decision Authority

**Status: one server-only, read-only consent/suppression precedence authority. It performs NO
writes, is NOT wired into anything, implements NO STOP/START/HELP, sends nothing, and enables no
Meta. Meta remains disabled.**

Files: `lib/communication/consentPolicy.ts`, `services/communicationConsentDecisionService.ts`.
Test: `npm run test:phase5f:d2c`.

---

## Authority ownership

Consent decisions belong to **QuickFurno Core** (truth + policy + operational state). Jarvis, n8n,
Meta, campaign workflows and provider adapters must **not** independently decide consent. This
service is the **sole** read-only consent + suppression precedence authority. It reads
`communication_suppressions` (always) and `communication_preferences` (only for an EXACT identity),
and never writes.

## Policy version

`lib/communication/consentPolicy.ts` exports the immutable code constant
`CONSENT_POLICY_VERSION = "qf-consent-v1"` (satisfies the live `policy_version ~ '^[A-Za-z0-9._:-]{1,64}$'`
fence). It is **never** read from a browser request, provider payload, or the environment, and is
never mutated at runtime. D2-D will reuse it.

## Input contract (exact)

```ts
interface CommunicationConsentDecisionInput {
  channel: "whatsapp" | "sms" | "rcs";
  scope: "authentication" | "transactional" | "marketing";
  destinationHash: string;                 // sha256(canonical E.164) lowercase hex
  identityConfidence: "exact" | "ambiguous" | "unknown";
  principal: { type: "client" | "vendor" | "admin"; id: string } | null;
  evaluatedAt?: Date;                       // injected clock when omitted
}
```

**Input invariants** (validated before any DB access; a violation returns `INVALID_DECISION_INPUT`):
`destinationHash` is exactly 64 lowercase hex; `exact` ⟹ a principal with a valid UUID id;
`ambiguous`/`unknown` ⟹ principal is null; channel/scope are supported; a supplied `evaluatedAt` is a
valid timestamp. It accepts **no** plaintext phone / `phone_e164` / `wa_id` / raw message / webhook
payload / provider token / user-controlled policy version / arbitrary purpose string / browser actor.

## Output contract (exact) — why no universal boolean

There is deliberately **no universal `allowed: boolean`**, because consent semantics are **not** final
send authorization. The result is a discriminated union:

```ts
type ConsentDisposition = "blocked" | "marketing_opted_in" | "no_consent_objection" | "unknown";
type ReconsentEligibility = "self_service_allowed" | "admin_only" | "provider_resolution_required" | "not_reversible" | "not_applicable";
type ConsentDecisionSuccess = {
  ok: true; disposition: ConsentDisposition; reasonCode: string;
  policyVersion: "qf-consent-v1"; principalConfidence: "exact" | "ambiguous" | "unknown";
  matchedPreferenceId: string | null; matchedSuppressionId: string | null;
  suppressionReason: "user_stop" | "provider_block" | "hard_bounce" | "complaint" | "admin" | "legal" | "abuse" | "unspecified" | null;
  reconsent: ReconsentEligibility;
};
type ConsentDecisionFailure = { ok: false; code: "INVALID_DECISION_INPUT" | "AUTHORITY_LOOKUP_FAILED" | "AUTHORITY_INTEGRITY_VIOLATION" };
```

The result never contains the destination hash, a plaintext destination, a raw database error,
SQLSTATE, a stack, full rows, provider payload, or credentials.

`marketing_opted_in` / `no_consent_objection` mean only that the **consent** requirement passed — not
that the provider is available, runtime is enabled, a template is valid, a campaign is approved, or a
message may be sent. **Authentication** still requires a valid user-initiated auth action + the
authentication transport policy + runtime/provider capability. **Transactional** messaging still
requires a valid service/transactional basis + runtime/provider capability + workflow policy. D2-C
owns consent + suppression precedence only.

## Suppression precedence + read-time expiry

Query order: validate → read suppressions → resolve precedence → (if blocking) return `blocked` and
**short-circuit the preference lookup** → otherwise read the exact preference (only when identity is
exact) → derive. Candidate scopes: marketing → {global, marketing}; transactional → {global,
transactional}; **authentication → {global} only**.

**Effective activity is computed at read time in application code**, never `is_active` alone and never
the wall clock: `is_active AND (expires_at IS NULL OR expires_at > evaluatedAt)`. An expired-but-active
row does **not** block. **Global always wins** over an exact-scope suppression (its id/reason are
returned; no combined decision). A blocking suppression returns `blocked` with reasonCode
`global_suppression_active` or `scope_suppression_active`, `matchedSuppressionId`, `suppressionReason`,
and a `reconsent` eligibility.

## Identity-confidence rules

- **EXACT** → principal preference (exact tuple) + destination suppression both consulted.
- **AMBIGUOUS / UNKNOWN** → **no** principal preference is ever selected (no first-row-win, no guess);
  destination suppression still applies. The preference table is only read for an EXACT identity.

## Disposition rules

- **Marketing default-deny** — no preference, ambiguous, or unknown → `unknown` (**not permitted for
  marketing**), with reason codes `no_marketing_preference` / `ambiguous_identity_no_marketing_authority`
  / `unknown_identity_no_marketing_authority`.
- **Authentication no-objection** — no exact preference → `no_consent_objection`
  (`authentication_no_consent_objection`). Absence does **not** mean consent-granted; it means no
  consent objection. Final auth authorization stays with the auth action + transport/runtime policies.
- **Transactional no-objection** — no exact preference → `no_consent_objection`
  (`transactional_no_consent_objection`). Not final send authorization; a transactional basis must pass.
- **Explicit allowed** — marketing → `marketing_opted_in`; authentication/transactional →
  `no_consent_objection`.
- **Explicit blocked** — all scopes → `blocked` (`preference_blocked`), even if the preference's stored
  policy version differs from the current one.

## Policy-version mismatch behavior

For an **allowed** preference whose `policy_version` differs from `CONSENT_POLICY_VERSION`: marketing →
`unknown` (`preference_policy_version_mismatch`) — a stale allowed preference must never authorize
marketing; authentication/transactional → `no_consent_objection`
(`preference_policy_version_mismatch_no_objection`). A **blocked** preference stays blocking regardless
of its stored policy version.

## Re-consent mapping

`user_stop → self_service_allowed`; `provider_block → provider_resolution_required`; `hard_bounce →
provider_resolution_required`; `complaint / admin / legal / abuse / unspecified → admin_only`; no active
suppression → `not_applicable`. This is **returned only** — D2-C never mutates a suppression and never
implements START.

## Failure model

- **Infrastructure failure** — a suppression or preference read that throws returns
  `AUTHORITY_LOOKUP_FAILED`. It is **never** collapsed into `unknown` / `no_consent_objection` /
  `marketing_opted_in` (the D1-B truth principle).
- **Integrity failure** — every returned DB row is **fully structurally validated** (before any
  expiry or precedence) as a second fence beyond the live CHECKs; a violation returns
  `AUTHORITY_INTEGRITY_VIOLATION` for: a malformed row `id` (non-UUID); a **malformed timestamp**
  (`expires_at`/`deactivated_at`/`consented_at`/`withdrawn_at` that does not parse) — which is
  **never** silently treated as expired; a malformed `policy_version` shape; a scope/reason/state
  outside the schema vocabulary; an inactive row returned by the active query; an active row with
  `deactivated_at` set; more than one physically-active global or exact-scope suppression (detected
  **before** expiry, so a duplicate where one row is expired is still caught); a corrupt exact-scope
  row alongside a valid global (the valid global never hides the corruption); more than one
  preference for the exact tuple; or contradictory preference state/timestamps. The corrupt row is
  never exposed.

The hardened preference table cannot store `state = 'unknown'`; **absence of a row means unknown** and
no durable unknown preference state is supported. A **malformed** `policy_version` is an integrity
violation; a **well-formed but different** version is a normal stale-version decision.

## Immutable evaluation instant

The decision instant is resolved **once** — from `input.evaluatedAt` or the injected `now()` — and
**frozen to a numeric millisecond** (`Number.isFinite` validated) used for every row comparison. It is
never re-read from a mutable `Date` across an `await`, so a caller mutating the passed `Date` cannot
alter the decision mid-flight. An invalid `Date` from either the input or the injected clock returns
`INVALID_DECISION_INPUT` **before any DB call**. Expiry boundary: `expires_at == evaluatedAt` is
**expired** (does not block); one millisecond later still blocks.

## Database timestamp validation (strict, timezone-qualified RFC3339)

Every DB timestamp (`communication_suppressions.expires_at` / `deactivated_at`,
`communication_preferences.consented_at` / `withdrawn_at`) is validated with a **strict, anchored,
timezone-qualified RFC3339** parser — **not** lenient `Date.parse`. It requires a `T` separator, full
`HH:MM:SS`, an **explicit timezone** (`Z` or `±HH:MM`), and at most microsecond (1–6 digit) fractional
precision (matching PostgreSQL/Supabase `timestamptz`). A regex match is **not** sufficient: the
year/month/day/hour/minute/second and offset components are **range- and calendar-validated** (a UTC
round-trip via `setUTCFullYear`/`setUTCHours` rejects normalization such as Feb 30 → Mar 2), and a
valid leap day (e.g. `2028-02-29T00:00:00Z`) is accepted.

**Accepted:** `…Z`, `….123Z`, `….123456Z`, `…+05:30`, `….123456-04:00`. **Rejected as
`AUTHORITY_INTEGRITY_VIOLATION`:** timezone-less (`2026-07-11T10:30:00`), date-only (`2026-07-11`),
locale (`07/11/2026`), space-instead-of-`T`, empty/whitespace, impossible calendar dates
(`2026-02-29…`, `2026-04-31…`, `2026-13-01…`), out-of-range hour/minute/second (incl. a rejected leap
second `:60`), invalid offset hour/minute, and leading/trailing text. A `null` column is a valid null;
an `undefined` (silently-missing selected column) is an integrity violation. A malformed database
timestamp is **never** degraded to absence, expiry, `unknown`, `no_consent_objection`, or
`marketing_opted_in`, and the malformed value is never exposed in the result.

## Typed reason codes

`reasonCode` is a closed literal union (`ConsentReasonCode`), never an arbitrary string. There is no
universal `allowed`/`canSend`/`authorized` boolean — the discriminated `disposition`
(`blocked | marketing_opted_in | no_consent_objection | unknown`) is preserved.

## Production adapter (cardinality-preserving, testable)

The production adapter uses `select`-only queries with **no** `.single()` / `.maybeSingle()` /
`.limit()`, so duplicate rows are preserved for integrity detection. Response normalization is a small
exported pure helper (`normalizeSupabaseReadResult`) tested directly: `data + null error → rows
preserved`; `null data → []`; `data + error → error takes precedence (throws → AUTHORITY_LOOKUP_FAILED)`;
duplicate rows preserved verbatim.

## Server-only mechanism

The repository has **no** `import "server-only"` convention anywhere; its established mechanism is
service-layer placement plus the documented server-only `adminClient` (which bypasses RLS). This
module follows that mechanism (a server-layer service imported by no client code, exposing no API
route) rather than introducing a new dependency for cosmetic consistency.

## Phase-boundary harness (two-mode; not future-blocking)

`scripts/phase5f-d2c-…harness.mjs` validates the phase boundary in **two modes**: **pre-commit**
(`HEAD == D2-C base`) checks the working-tree delta is exactly the six approved D2-C files; **post-commit /
future-phase** (`HEAD` ahead) locates the first-parent D2-C commit after the fixed base (message
`Phase 5F-D2-C:`) and validates **that commit's** six-file delta + parent — so a later D2-D/D3 worktree
never fails D2-C. It **fails loud** (never silently falls back to worktree validation) if the chained
D2-C commit is unreachable. The corrected D2-B harness likewise depends on the chained D2-B commit being
reachable; normal chained commits / fast-forward / normal merge preserve reachability, while a squash
that discards the commit requires harness adaptation.

## Read-only guarantees & privacy

The injected DB dependency exposes **read methods only**; the production adapter uses `select`-only
queries. The service calls **no** `insert`/`update`/`upsert`/`delete`/`rpc`, writes **no**
`communication_consent_events`, and mutates neither preferences nor suppressions. Only the minimal
columns are selected. The destination is passed as a hash and is never echoed in the result; no raw DB
error is exposed.

## No integration yet

This authority is **not** called from `metaWhatsAppWebhookService`, `inboundWhatsAppMessageService`,
`CommunicationService`, authentication transport, campaign code, an n8n bridge, or any API route.
Integration happens only after **D2-D** (the controlled transactional writer) and the **D2-E**
checkpoint. There is **no writer**, **no RPC**, **no schema change / no migration**, and no env change
in D2-C.

## Migration-history drift (out of scope)

The live consent schema was manually applied and recent migration files are not recorded in
`supabase_migrations.schema_migrations`. D2-C does **not** run `supabase db push` / `migration up` /
`migration repair` / `db reset`, and does not attempt migration-history reconciliation.
