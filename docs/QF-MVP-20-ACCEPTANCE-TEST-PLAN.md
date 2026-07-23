# QF-MVP-20 — Acceptance Test Plan (section L)

**Branch:** `mvp/qf-mvp-20-marketplace-engine-v1` · **Type:** DESIGN ONLY — test matrix specification; no tests are implemented, no DB/provider access.
**Evidence baseline:** QF-MVP-10. Companion: [`QF-MVP-20-AUTHORITY-REPAIR-DESIGN.md`](QF-MVP-20-AUTHORITY-REPAIR-DESIGN.md), [`QF-MVP-20-MIGRATION-PLAN.md`](QF-MVP-20-MIGRATION-PLAN.md).

Every acceptance criterion below must have a proving test **before** the corresponding authority is enabled in production. Concurrency, RLS/grant, and rollback classes require staging (`OPEN_PREREQUISITE`).

## Test matrix

| # | Scenario | Type | Expected result |
|---|---|---|---|
| L1 | Concurrent automatic assignments to one lead | DB concurrency | never > 3 active; the losing txn re-reads under lock and is rejected `active_limit_reached` |
| L2 | Admin manual assignment beyond capacity | integration | never exceeds 3 active; 4th rejected |
| L3 | Client-selected assignment beyond capacity | integration | never exceeds 3 active; excess deterministically skipped/rejected |
| L4 | Lifetime unique vendors across the lead's history | integration | never exceeds 6 distinct vendors ever assigned |
| L5 | Request a 7th unique vendor (after 6 distinct historical) | integration/DB | rejected `lifetime_limit_reached`; no assignment, no debit |
| L6 | Replacement preserves history | integration | original → `replaced` (not deleted); `lead_assignment_events` row persists; lifetime count unchanged for that vendor |
| L7 | Two concurrent replacements on one lead | DB concurrency | only one in progress; the second rejected `replacement_in_progress` (partial unique index) |
| L8 | Replay assignment with same idempotency key | integration | no double assignment; returns `already_applied` |
| L9 | Replay assignment with same idempotency key | integration | no double debit; `uq_vendor_credit_logs_reference` blocks a second ledger row |
| L10 | Ledger write fails mid-transaction | DB | assignment **and** debit roll back (all-or-nothing) |
| L11 | Assignment insert fails after debit attempt | DB | debit rolls back (single transaction) |
| L12 | Anon calls assignment mutation | RLS/grant | rejected — `service_role`-only execute; no effect |
| L13 | Authenticated user mutates another user's lead | RLS/grant + integration | rejected `unauthorized` (lead-ownership check); no effect |
| L14 | Public payload / API response inspection | API contract | contains **no** `total_credits`, `remaining_credits`, `paid_status`, `package_name`, `package_status`, `package_expires_at`, internal suspension/audit fields |
| L15 | Vendor-owner dashboard reads own commercial data | API contract + RLS | owner still sees own credit/package truth |
| L16 | Admin/CRM authorized view | API contract + RLS | sees authorized commercial truth |
| L17 | Communication intent creation | integration | exactly one intent per (assignment, template, vendor); `UNIQUE` enforced |
| L18 | Provider execution boundary | integration | no provider/Meta call and no final `whatsapp_logs` delivery inside the assignment transaction; execution is a post-commit worker |
| L19 | Uncertain provider result | integration | never blindly resent (D9 / rule 16); terminal |
| L20 | Historical ledger investigation run | integration | performs **no** automatic mutation; emits classified evidence report only (proven/disproven/indeterminate) |
| L21 | `app_settings.max_vendors_per_lead` tampering | integration | engine ignores it as authority; cap stays 3 (internal constant / DB policy) |
| L22 | Admin override attempts a hard-gate breach (credits/city/category/active-3/lifetime-6/duplicate) | integration | rejected; only ranking preferences are overridable; override audited |
| L23 | Eligibility determinism | unit | identical inputs → identical eligibility verdict and identical candidate order (stable tiebreak) |
| L24 | Public visibility is not an eligibility authority | unit/integration | a publicly-invisible but otherwise-eligible vendor can be assigned; a publicly-visible but ineligible vendor cannot |

## Test classes and coverage

- **Unit tests:** eligibility gates vs ranking signals (§H); cap constants; idempotency-key derivation; error-code sanitization; determinism/tiebreak (L23, L24). Offline, extend the existing `test:mvp` marketplace suite.
- **Integration tests:** full `qf_assign_lead_vendors_v2` per mode; replacement lifecycle; credit authority + ledger; communication-intent write; historical-investigation dry run (L2–L6, L8, L9, L17–L22).
- **Database concurrency tests:** parallel transactions proving 3-active / 6-lifetime / one-replacement invariants under lock (L1, L5, L7, L10, L11) — require staging.
- **RLS / grant tests:** anon/authenticated cannot execute mutation RPCs; ownership enforcement; column-level monetization non-exposure; owner/admin access (L12–L16) — require staging.
- **API contract tests:** public payload no-leak scan; owner/admin payload completeness (L14–L16).
- **Migration rehearsal tests:** apply the staged additive migrations (§K.4–K.11) on staging in order; verify each step is additive and the engine flag can fall back to legacy.
- **Rollback tests:** each production-bound step has a proven reverse migration / re-grant / flag-off; snapshot-restore rehearsed on staging (§K.13).

## QF-MVP-20.3A refinement — locked definitions the tests must use

The 20.3A design fixes the semantics these acceptance tests depend on. L1–L24 above remain valid; the following are now **locked** and the staging matrix in [`QF-MVP-20-3A-STAGING-TEST-PLAN.md`](QF-MVP-20-3A-STAGING-TEST-PLAN.md) (T1–T22) is the executable form:

- **Active set = `{assigned, delivered, accepted}`** on the new `lead_assignments.lifecycle_status` column (10-value vocabulary). `vendor_status` is the vendor CRM pipeline and is **not** the lifecycle. L1–L3 must count the active set, not row totals.
- **Lifetime = distinct vendors in `lead_assignment_events`** (append-only, non-cascading), computed by **query** — `COUNT(DISTINCT vendor_id)` over `event_type='assignment_created' AND lifecycle_to='assigned'` — **not** by a uniqueness constraint. `rejected/expired/cancelled/invalid/replaced` **retain** their lifetime slot; a `requested` or failed candidate **never** consumes one. L4/L5 assert against the lineage table, not `lead_assignments`.
- **Replacement** transitions the original to `replaced` (never deletes) and is capped one-per-lead by a partial unique index — L6/L7 map to T7/T8, plus new **T9** (replacement cannot exceed lifetime six).
- **Idempotency has four separate boundaries** (corrected by 20.3A1R; the earlier "three layers" wording is superseded) — `assignment_operations.idempotency_key`, `lead_assignments UNIQUE(lead_id,vendor_id)`, `uq_vendor_credit_logs_reference`, and `lead_assignment_events UNIQUE(event_idempotency_key)`. Each protects its own object; **no single broad uniqueness constraint may substitute for them**. L8/L9 map to T3/T4.
- **No caller-controlled ceiling exists** — a static assertion replaces L21's `max_vendors_per_lead` tampering test: `qf_assign_lead_vendors_v2` has no limit parameter and `ADMIN_MANUAL_TOTAL_VENDOR_LIMIT` reaches no RPC.
- **Public projection** is `vendor_public_v` with an explicit allow-list; L14 gains **T13** (no `select("*")` on public paths) alongside anon column-privilege assertions.
- **Communication** is an intent row only; L17/L18 map to T15/T16/T17, and **uncertain outcomes are terminal** (T18).
- **New additions:** T10 (anon/PUBLIC cannot execute the canonical RPC), T19 (zero legacy callers), T20 (Auth trigger provisions exactly once — dedicated window only), T21 (rollback rehearsal), T22 (tooling rejects the production ref).

Deterministic fixtures (seeded UUIDs, 8 vendors so lifetime-6 can be exceeded) and real parallel-session concurrency barriers are mandatory; staging must return to zero application rows between suites.

## QF-MVP-20.3A1 closure — final locked definitions

- **Active set is final: `{assigned, delivered, accepted}`.** `in_progress` is **not** a lifecycle status (CRM-only); any earlier active set containing it is **superseded and void**. All acceptance tests read the set from one shared SQL+TS constant.
- **Backfill/lineage tests added** (T23–T25): 46 rows → `assigned` deterministically; 46 lineage events + 1 batch operation, idempotent; lineage survives a lead/vendor delete attempt via `RESTRICT`.
- **Trigger sequencing tests added** (T26, T27): no triggers after B1, triggers present after B2, and a legacy 9-vendor recovery attempt is rejected post-B2 with no partial assignment or debit.
- **Suspension tests added** (T28, T29): temporary suspension is a hard gate that admin override cannot bypass, and suspension fields never reach the public projection.
- **Intake and privilege tests added** (T30, T31): crafted intake payloads cannot set `lead_quality_score`/`status`/`preferred_vendor_id`/`lead_priority`/`internal_notes`; after Migration C, `anon` holds **no** table privilege on `leads` or `vendors` and the always-true INSERT policy is gone.
- **Divergence view test added** (T32): `vendor_wallet_package_divergence_v` classifies correctly and mutates nothing; the wallet is the sole assignment-debit authority.

## QF-MVP-20.3A1R correction — assignment lineage idempotency

`lead_assignment_events` is an **append-only lifecycle event stream**. Any earlier statement making `(lead_id, vendor_id)` unique on that table — wherever it appears, including [`QF-MVP-20-AUTHORITY-REPAIR-DESIGN.md`](QF-MVP-20-AUTHORITY-REPAIR-DESIGN.md) — is **superseded and void**; that document is outside this correction's permitted paths and is superseded in writing rather than edited. Event uniqueness is carried by `event_idempotency_key` (seed `legacy_assignment_seed_v1:<assignment_id>`, runtime `assignment_event:<operation_id>:<assignment_id>:<event_type>`), always derived by the authoritative transaction and never by a caller. The existing `lead_assignments UNIQUE(lead_id, vendor_id)` is **unchanged**.

Consequences for this matrix: **L6** must assert that the replaced vendor's `assignment_created` event persists *and* that a further `replaced` event is appended alongside it (not in place of it); **L4/L5** must count distinct vendors by query. Ten binding tests **T33–T42** in [`QF-MVP-20-3A-STAGING-TEST-PLAN.md`](QF-MVP-20-3A-STAGING-TEST-PLAN.md) prove the corrected model — including two event types for one (lead, vendor), the full `assigned → delivered → accepted → completed` chain, duplicate-key no-op, distinct-key acceptance, later events consuming no slot, failed candidates consuming no slot, 7th-vendor rejection, and append-only immutability. T34/T35/T37/T42 fail under the withdrawn model and are the regression guards.

## QF-MVP-20.3B1 — the migrations under test now exist

L1–L24 are unchanged. What changed is that the objects they assert against are now generated files rather than a specification: `20260723000100` (A), `20260723000200` (A2) and `20260723000300` (B1), all `GENERATED_NOT_APPLIED`. Record and hashes: [`QF-MVP-20-3B1-MIGRATION-GENERATION-RESULTS.md`](QF-MVP-20-3B1-MIGRATION-GENERATION-RESULTS.md).

Bindings this adds to the matrix:

- **L1–L3 (active-three) and L4/L5 (lifetime-six) are enforced by `qf_assign_lead_vendors_v2` only, not yet by triggers.** B1 ships with **zero** enforcement triggers by design, because it lands before the R1 consumer release. Until Migration B2, a write that bypasses the canonical RPC is *not* capped. Every cap test in this phase must therefore drive the canonical RPC, and a separate B2 test must later prove the trigger layer independently.
- **L21 (`max_vendors_per_lead` tampering)** is now a static fact: `qf_assign_lead_vendors_v2` has no limit parameter and the cap is an internal constant that reads no `app_settings` row. The offline validator asserts no `p_total_limit`-style parameter exists.
- **L8/L9 (replay)** map to the operation key plus the ledger reference; a replay returns the stored `assignment_operations.result` merged with `already_applied`. Consumers must treat `already_applied` as success.
- **L10/L11 (atomicity)** are satisfied within one function body: assignment insert, ledger debit, lineage event and communication intent share a transaction with no explicit COMMIT/ROLLBACK/SAVEPOINT.
- **L14/L15/L16 (public projection)** remain **untestable in this phase** — `vendor_public_v` belongs to Migration C, which is deliberately not generated. So does `vendor_wallet_package_divergence_v` (T32).
- **L12 (anon cannot execute)** is provable now for the canonical RPCs, which are `service_role`-only. It is **not** yet provable for the legacy blockers in production: those remain anon-executable until Migration E. Applying A/A2/B1 to production closes no existing exposure.
- **L18/L19 (provider boundary)** hold structurally: the migrations contain no `pg_net`, `http`, `dblink` or `pg_background` primitive, and the transaction writes an intent whose `recipient_ref` is a hash, never a plaintext destination.

New rehearsal coverage **T43–T48** in [`QF-MVP-20-3A-STAGING-TEST-PLAN.md`](QF-MVP-20-3A-STAGING-TEST-PLAN.md) proves clean application, empty-staging inertness, per-lead seeding, re-run no-op, incomplete-history skip-and-report, and the B1/B2 boundary.

## QF-MVP-20.3B1R — reviewed authority contracts

The review corrected three of four contracts. Consequences for this matrix:

- **L8/L9 (replay) are strengthened and split.** Idempotency is no longer decided on the key alone. The authority compares a **normalized request fingerprint** (lead, mode, deduplicated and sorted candidates, reason code, replacement reference, actor), so the matrix now needs four outcomes, not one: exact replay returns the persisted result with `already_applied=true` and zero new rows (**T49–T51**); same key with a different request returns **`idempotency_conflict`** with zero mutation (**T52**); a still-`in_progress` row returns `conflict_retry` rather than a fabricated success (**T56**); concurrent duplicates resolve to exactly one operation (**T54/T55**). `idempotency_conflict` joins the sanitized reason vocabulary.
- **L10/L11 (atomicity) gain a persistence obligation.** Operation completion and result persistence happen inside the assignment transaction, and a terminal operation is constrained to carry both `completed_at` and a non-empty `result` — otherwise a later replay could not be reconstructed.
- **L21 is now provable twice over.** `ASSIGNMENT_CREDIT_COST = 1` is a locked internal constant: no caller parameter, no `app_settings` read, no `vendor_packages` inference, no variation by mode. **T57–T63** prove one credit per created assignment, zero for rejected, cap-blocked and replayed candidates, no clamping, and byte-identical `vendor_packages`.
- **L13 (ownership) is deferred, not weakened.** `client_selected` mode is **fail-closed** (`R1_BLOCKED_PENDING_OWNER_BINDING`): the schema has no lead-to-client binding and no canonical phone normalizer, so the mode returns `unauthorized` before any write rather than trusting phone equality. **L13 cannot be satisfied in this phase**; it becomes testable only after R1 introduces an explicit ownership binding. **T64/T65** prove the fail-closed behaviour and that no untrusted role can reach the authority in any mode.
- **L20 (historical investigation) is unaffected.** **T66/T67** confirm no `audit_logs` dependency and that A2 leaves the 27 ledger-gap assignments byte-identical.

## QF-MVP-20.3B1A staging application outcome

**A and A2 are live on staging; B1 is not.** The canonical authority does not yet exist on any database, so every L-class test that drives `qf_assign_lead_vendors_v2` or `qf_apply_credit_mutation_v2` remains **unrunnable** until QF-MVP-20.3B1R2 lands B1.

What the partial application *does* establish:

- **A2's empty-staging contract is proven in a real database** (T44): on zero historical assignments it created **0** operations and **0** lineage events, wrote **0** ledger rows and **0** intents, and its own verification block confirmed the ledger and intent counts never moved.
- **A's authority substrate is proven installed and self-verified**: `request_fingerprint` NOT NULL, the terminal-completion CHECK, `UNIQUE (event_idempotency_key)` with **no** `(lead_id, vendor_id)` uniqueness on the event table, the pre-existing `lead_assignments UNIQUE(lead_id, vendor_id)` preserved, correct lineage FK retention, and all five new tables RLS-on with `service_role`-only grants.
- **The B1/B2 boundary holds** (T48, partially): zero enforcement triggers exist and all six legacy assignment RPCs remain callable — A and A2 took no authority away.

**Lesson for the matrix.** A migration's *in-database* verification block is itself untested code that only executes at apply time. Neither a dry-run nor an offline validator can exercise it. Any future migration carrying a `DO` block with negative assertions needs a rehearsal apply on a disposable database before it is treated as ready.

## QF-MVP-20.3B1R2 — verification-tooling correction

The B1 failure exposed a defect **in the verification tooling itself**, not in the acceptance criteria. Both the migration's in-database guard and six rows of the phase verifier asserted properties of SQL by pattern-matching `pg_get_functiondef()`, whose output retains comments and string literals. Two verifier rows would have failed even against a correctly applied B1.

Consequences for this matrix:

- **No acceptance criterion changed.** L1–L24 and T1–T67 stand exactly as written; the corrected B1 preserves all eighteen locked behaviours byte-for-byte.
- **Proof responsibility is now explicitly partitioned.** Catalog facts (`pg_proc`, `pg_attribute`, `pg_constraint`, `pg_trigger`, `proconfig`, `has_function_privilege`) are proved in-database. Executable-source prohibitions are proved by the tokenizing offline validator. Behaviour is proved by staging tests. No layer may substitute a lexical scan of comment-retaining text for any of the three.
- **L21 (no configurable cap/cost)** is now proved two ways that cannot be fooled by prose: the signature check over `pg_get_function_identity_arguments` (comment-free by construction) and the offline validator's executable-SQL view.
- **T68** in the staging test plan generalises the lesson, and the validator's fixtures A–G lock it in — including fixture F, which reproduces the exact guard that failed and confirms it is now rejected before application.

## QF-MVP-20.3B1A2 — B1 live on staging; one invariant unmet

Migration B1 applied at exit 0 and the corrected phase verifier returned **57 PASS / 1 FAIL**. The canonical authority now exists on staging, so the L-class tests that drive it are finally runnable in a later behavioural phase.

**Proved by this application:**

- **L12 (untrusted roles cannot execute assignment mutation)** — all five canonical functions hold **zero** EXECUTE for `PUBLIC`, `anon` and `authenticated`; `service_role` holds all five. This is now a live catalog fact, not a design claim.
- **L21 (no configurable cap or cost)** — the live signature is `p_lead_id, p_mode, p_candidate_vendors, p_operation_key, p_actor_kind, p_actor_id, p_replacement_ref, p_reason_code`. No cost, delta, credit, limit or max parameter exists.
- **L18/L19 (provider boundary)** — no provider send, no `whatsapp_logs` delivery authority, no `audit_logs` dependency, and zero communication delivery rows.
- **L13 (ownership)** remains **untestable**: `client_selected` is fail-closed pending R1's ownership binding.

**One acceptance criterion is now demonstrably unmet.** The append-only guarantee behind **L6** and the lineage half of **L4/L5** rests on `lead_assignment_events` being immutable. On staging it currently is not: Supabase default privileges left `UPDATE`/`DELETE` for `postgres` and `service_role`, and B2's immutability trigger does not yet exist. Untrusted roles hold nothing and zero rows exist, so nothing is at risk today — but **no L-class test that depends on lineage immutability may be treated as satisfied until a forward grant-hardening migration closes it.**

**Lesson for the matrix.** A narrow `GRANT` is not a privilege contract on Supabase. Platform default privileges grant `arwdDxtm` on every new `public` table to four roles, so any table claiming a restricted posture must issue an explicit `REVOKE` first. Every future migration that creates a table needs a grant-posture assertion, not just a grant statement.

## Gate

QF-MVP-20 is not COMPLETE until: all L1–L24 pass on staging; concurrency and RLS/grant classes pass; migration rehearsal + rollback verified; historical ledger investigation closed (no blind mutation); `verify:mvp` green. Production canary only after founder sign-off.
