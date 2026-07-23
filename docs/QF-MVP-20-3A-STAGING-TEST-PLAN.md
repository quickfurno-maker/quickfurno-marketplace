# QF-MVP-20.3A — Staging Test Plan for the Remediation Migration

Tests the future 20.3B migration on **staging only** (`uckafzuochmbvtiodmcl`). Production is never a test target. **No test is executed in this task.**

## Deterministic test-data requirements

Staging is currently **empty (all 62 tables zero rows)**, which is the correct starting point. Tests need a **deterministic, disposable fixture** created by an explicitly-labelled test harness (never by the production runtime paths):

- Fixed UUIDs (seeded constants, not random) for: 1 lead per scenario, 8 vendors (`V1…V8`) so lifetime-6 can be exceeded, 1 admin actor, 1 client actor.
- Vendors seeded `status='Approved'`, `is_active=true`, `accepting_leads=true`, `remaining_credits=10`, same `city`, compatible parent category — so eligibility is not the variable under test unless the test says so.
- Every fixture row is created through the **canonical authority or a labelled test helper**, never through legacy RPCs, and is torn down after each suite.
- Fixtures are **staging-only**; the harness must hard-fail if the target ref is not `uckafzuochmbvtiodmcl`.
- Concurrency tests need **real parallel sessions** (separate connections), not sequential calls.

## Concurrency barriers

For T1, T3, T8: N sessions each `BEGIN`, then synchronise on a barrier (advisory lock or a client-side latch) so all issue the RPC within the same window, then `COMMIT`. Assert the *aggregate* outcome, not per-session ordering.

---

## Test matrix

| # | Test | Type | Setup | Assertion |
|---|---|---|---|---|
| **T1** | Concurrent automatic assignments never exceed 3 active | DB concurrency | 1 lead, 6 eligible vendors, 6 parallel sessions | exactly **3** rows in ACTIVE `{assigned,delivered,accepted}`; losers return `active_limit_reached`; **no** 4th debit |
| **T2** | Seventh lifetime unique vendor rejected | DB integration | drive the lead through 6 distinct vendors (assign → replace/cancel) so lineage = 6 | 7th distinct vendor → `lifetime_limit_reached`; `lead_assignment_events` stays at **6**; no assignment, no debit |
| **T3** | Duplicate replay creates no new assignment | integration | same `p_operation_key` twice | 2nd returns `already_applied` with the **identical stored result**; `lead_assignments` count unchanged |
| **T4** | Duplicate replay creates no second debit | integration | as T3 | `vendor_credit_logs` count unchanged; balance unchanged; `uq_vendor_credit_logs_reference` holds |
| **T5** | Ledger failure rolls back assignment | DB fault-injection | force the ledger insert to fail (e.g. temporary constraint violation on a test-only sentinel) | **no** `lead_assignments` row, **no** lineage row, **no** intent; balance unchanged |
| **T6** | Assignment failure rolls back credit mutation | DB fault-injection | force the assignment insert to fail after debit | balance unchanged; no ledger row persists |
| **T7** | Replacement preserves original history | integration | assign V1, replace with V2 | V1 row still exists with `lifecycle_status='replaced'` and `replaced_by_assignment_id` set; V1 lineage row **intact**; lifetime = 2 |
| **T8** | Second concurrent replacement request rejected | DB concurrency | 2 parallel replacement requests for one lead | exactly **1** open request; the other → `replacement_in_progress` (partial unique index proven) |
| **T9** | Replacement cannot exceed lifetime six | integration | lineage already 6 distinct vendors, replace with a **new** vendor | rejected `lifetime_limit_reached`; original stays active; replacing with a vendor already in the lead's lineage is blocked by the existing `lead_assignments UNIQUE(lead_id, vendor_id)` — **not** by any constraint on `lead_assignment_events`, which has none |
| **T10** | public/anon cannot execute assignment RPC | RLS/grant | — | `has_function_privilege` false for `PUBLIC`/`anon`/`authenticated` on `qf_assign_lead_vendors_v2` and all four legacy blockers; direct PostgREST call fails |
| **T11** | Authenticated user cannot mutate another lead | integration | user A session, lead owned by B | `unauthorized`; no assignment/debit/intent |
| **T12** | Public vendor projection leaks no monetization | API + grant | query `vendor_public_v` as anon; scan every public API payload | no `total_credits/remaining_credits/paid_status/package_name/package_status/package_expires_at`/package id/private contact; `has_column_privilege('anon','vendors',<monetization>,'SELECT')` all **false** |
| **T13** | `select("*")` removed from public paths | static + runtime | grep public services; inspect payloads | zero `select("*")` on public vendor reads; payload matches the allow-list exactly |
| **T14** | Owner and admin retain commercial view | API + RLS | vendor-owner session; superadmin session | owner sees own credits/package via RLS-scoped path; admin sees authorized commercial truth |
| **T15** | Communication intent written exactly once | integration | assign, then replay the same operation | exactly **1** `communication_intents` row per (assignment, template, recipient); `idempotency_key` unique holds |
| **T16** | No `whatsapp_logs` write inside the canonical transaction | DB assertion | run a canonical assignment | `whatsapp_logs` count **unchanged**; only an intent row appears |
| **T17** | Provider worker not invoked in-transaction | integration | assignment with the provider worker stubbed | zero provider/Meta/n8n calls during the transaction; the worker only acts post-commit |
| **T18** | Uncertain provider result not blindly retried | integration | worker receives an uncertain outcome | intent → `status='uncertain'`, `uncertain_outcome=true`, terminal; **no** automatic re-dispatch; `attempt_count` does not climb |
| **T19** | Legacy RPC consumer tests migrated | integration + static | after consumer release | zero repository callers of the 6 legacy assignment RPCs and 3 legacy credit primitives; legacy RPCs still exist but are `service_role`-only |
| **T20** | Auth trigger provisions profile exactly once | Auth (dedicated window) | Migration D applied; create **one** Auth user in the isolated Auth test window | exactly **1** `profiles` row; re-running the trigger path creates no duplicate; user then cleaned up. **Not run outside this window.** |
| **T21** | Migration rollback restores staging | migration rehearsal | apply A→D, then roll back per the rollback plan | catalog returns to the pre-migration delta; baseline objects intact; corrected verifier still passes on the restored shape |
| **T22** | Production project reference rejected by tooling | tooling | point any migration/verification tool at `yqpgcsduqbxulrlzwzap` | tool **hard-fails** before connecting; no production call is made |

---

## Supplementary assertions (run with every suite)

- **Catalog delta** matches the schema contract §11 (67 tables, 45 functions, 37 SD, 1 view, 3 public triggers, 67 policies unchanged).
- **`rls_enabled_no_policy` remains intentional** for the 5 new tables (fail-closed assertion, not an advisory regression).
- **Active-set consistency:** the DB trigger, `marketplaceAssignmentService`, admin views and tests all read `{assigned,delivered,accepted}` from a **single shared constant**; a test asserts DB and TS agree.
- **No caller-controlled limit:** static assertion that `qf_assign_lead_vendors_v2` has no `p_total_limit`-style parameter and that `ADMIN_MANUAL_TOTAL_VENDOR_LIMIT` no longer reaches any RPC.
- **Zero-data invariant** between suites: fixtures torn down; no residual application rows.

## QF-MVP-20.3A1 additions (binding)

| # | Test | Type | Assertion |
|---|---|---|---|
| **T23** | Lifecycle backfill is deterministic and idempotent | migration rehearsal | seeded copy of the 46-row production shape → all rows `lifecycle_status='assigned'`; re-running A2 changes **0** rows |
| **T24** | Lineage seed is idempotent | migration rehearsal | 46 `assignment_created`/`lifecycle_to='assigned'` events + **1** batch operation row; re-run inserts **0** via `ON CONFLICT (event_idempotency_key) DO NOTHING` (**not** `(lead_id, vendor_id)` — no such constraint exists); each key equals `legacy_assignment_seed_v1:<assignment_id>`; `occurred_at` equals the source `assigned_at`; no ledger row created |
| **T25** | Lineage survives lead/vendor deletion attempt | DB integrity | `DELETE FROM leads`/`vendors` for a lead/vendor with lineage **fails with RESTRICT**; lineage row intact; no cascade fires |
| **T26** | Enforcement triggers are absent in B1 and present in B2 | migration rehearsal | after B1: 0 new triggers, legacy RPCs still succeed; after B2: 3 triggers, caps enforced |
| **T27** | Legacy 9-vendor recovery is rejected after B2 | integration | a `p_total_limit=9`-style attempt fails with `active_limit_reached`; **no partial assignment, no debit** |
| **T28** | Temporary suspension is a hard gate | integration | vendor with `assignment_suspended_at` set and `assignment_suspended_until` in the future → `vendor_not_eligible`; after expiry (time-shifted fixture) → eligible again; admin override **cannot** bypass it |
| **T29** | Suspension fields never reach the public projection | API + view | `vendor_public_v` exposes no `assignment_suspension_*`/`status`/`verification_status` column |
| **T30** | Public intake cannot set internal columns | API contract | a crafted intake payload containing `lead_quality_score`, `status`, `preferred_vendor_id`, `lead_priority`, `internal_notes` → those fields are **ignored/server-set**; the stored row carries defaults |
| **T31** | anon has no table privilege on `leads`/`vendors` after C | grant | `information_schema.role_table_grants` returns **no rows** for `anon` on either table; the always-true `leads` INSERT policy no longer exists |
| **T32** | Divergence view is read-only and classifies correctly | view | `vendor_wallet_package_divergence_v` returns a row per vendor with the expected `divergence_class`; executing it mutates **nothing** (balances and ledger counts unchanged before/after) |

**Note on T20 (Auth trigger):** unchanged — runs only inside the dedicated Auth window; no Auth user is created in any other suite.

## QF-MVP-20.3A1R additions — assignment lineage idempotency (binding)

These ten tests prove the corrected model: `lead_assignment_events` is an **append-only stream** whose only unique constraint is `event_idempotency_key`, and whose lifetime-vendor count is a **query**, not a constraint. Any test that would pass under a `(lead_id, vendor_id)` unique constraint but fail under the corrected model — or vice versa — is deliberately included.

| # | Test | Type | Setup | Assertion |
|---|---|---|---|---|
| **T33** | Backfill A2 run twice is a no-op | migration rehearsal | seeded 46-row assignment shape; run A2, then run A2 again | second run inserts **0** events and **0** operation rows; total stays 46 events + 1 operation; no assignment row, balance or ledger row changes |
| **T34** | Two different event types for one (lead, vendor) both persist | DB integrity | insert `assignment_created`/`assigned`, then `assignment_delivered`/`delivered` for the **same** `lead_id` + `vendor_id`, distinct keys | **both rows exist** (2 rows for the pair). Proves no `(lead_id, vendor_id)` uniqueness. Under the withdrawn model this test fails — that is the point |
| **T35** | Full lifecycle chain appends four events | DB integrity | drive one (lead, vendor) through `assigned → delivered → accepted → completed` | **4** rows for the pair, `lifecycle_to` values in order, `occurred_at` non-decreasing; no row updated or deleted |
| **T36** | Duplicate `event_idempotency_key` is a silent no-op | DB integrity | insert an event, then re-insert the **identical** key with `ON CONFLICT (event_idempotency_key) DO NOTHING` | row count unchanged; the stored row is byte-identical to the original (no overwrite); no error surfaced to the caller |
| **T37** | Different keys, same (lead, vendor), both accepted | DB integrity | two inserts sharing `lead_id`+`vendor_id` but with distinct `event_idempotency_key` values | **both** rows inserted; no unique violation |
| **T38** | Lifetime count derives from distinct `assignment_created` vendors | query semantics | lead with 3 distinct vendors, each carrying several lifecycle events | `COUNT(DISTINCT vendor_id) WHERE event_type='assignment_created' AND lifecycle_to='assigned'` = **3**, not the raw row count |
| **T39** | A later lifecycle event consumes no additional lifetime slot | query semantics | append `delivered`, `accepted`, `rejected`, `replaced` for an already-counted vendor | lifetime count stays **unchanged**; the lifetime-6 gate verdict is unaffected |
| **T40** | A failed candidate consumes no lifetime slot | integration | candidate rejected by eligibility, losing a race, or only `requested` — no assignment row created | **zero** `assignment_created` events written for that vendor; lifetime count unchanged; no debit |
| **T41** | 7th distinct vendor is rejected | integration | lead with 6 distinct vendors in lineage; request a 7th **new** vendor | rejected `lifetime_limit_reached`; **no** assignment row, **no** debit, **no** lineage event; the 6 existing vendors are untouched |
| **T42** | The event stream is append-only | DB integrity | attempt `UPDATE` and `DELETE` on an existing `lead_assignment_events` row as the runtime role | both are **refused** (no privilege / guard trigger); row count and content unchanged; the immutability guarantee holds for lifetime history |

**Cross-check binding on T33/T24:** the seed key is `legacy_assignment_seed_v1:<assignment_id>` and the runtime key is `assignment_event:<operation_id>:<assignment_id>:<event_type>`. Tests must assert the **key format**, not merely that a rerun inserted zero rows — a rerun of a broken seed can also insert zero rows for the wrong reason.

## QF-MVP-20.3B1 additions — generated migrations (binding)

The three migrations now exist as reviewed files and are `GENERATED_NOT_APPLIED`. Record: [`QF-MVP-20-3B1-MIGRATION-GENERATION-RESULTS.md`](QF-MVP-20-3B1-MIGRATION-GENERATION-RESULTS.md). Phase verifier: `supabase/staging-verification/verify_qf_mvp_20_3b1.sql` (SHA256 `ebe0ef75…`), separate from the locked baseline verifier.

| # | Test | Type | Setup | Assertion |
|---|---|---|---|---|
| **T43** | A/A2/B1 apply cleanly in order on empty staging | migration rehearsal | staging at baseline `920a4aa0…`, zero application rows | all three apply in one push; history gains exactly `20260723000100`, `20260723000200`, `20260723000300`; `verify_qf_mvp_20_3b1.sql` returns **all-PASS**; the locked baseline verifier still passes unchanged |
| **T44** | A2 on empty staging creates nothing | migration rehearsal | zero `lead_assignments` rows | **0** backfill operations and **0** lineage events; no ledger row, no intent, no application data of any kind |
| **T45** | A2 on a production-shaped fixture seeds per lead | migration rehearsal | seeded copy of the production shape (N assignments across M distinct leads) | exactly **M** operations keyed `qf_mvp_20_a2_lineage_backfill_v1:<lead_id>` and **N** events keyed `legacy_assignment_seed_v1:<assignment_id>`; every event anchored to the operation of **its own** lead; counts derived, never hardcoded |
| **T46** | A2 is a no-op on a third run | migration rehearsal | run A2, run again, run again | second and third runs insert **0** operations and **0** events; ledger count, intent count, balances and every assignment column are byte-identical across runs |
| **T47** | A2 skips and reports incomplete history | migration rehearsal | fixture with one row having NULL `vendor_id` | that row receives **no** lineage event; the migration emits a skip notice naming the count; all complete rows are still seeded; the migration does **not** fail |
| **T48** | B1 deploys without constraining legacy flows | migration rehearsal | apply B1, then exercise a legacy assignment RPC as `service_role` | **0** triggers exist on `lead_assignments`/`lead_assignment_events`; all six legacy assignment RPCs remain; the legacy call still succeeds exactly as before B1; no lineage event is written by the legacy path |

**T48 is the B1/B2 boundary proof.** If it fails, B1 has taken authority away before the R1 consumer release, which the split exists to prevent.

**Verifier-behaviour binding:** `verify_qf_mvp_20_3b1.sql` must be run **twice** — once against empty staging (T44) and once against the production-shaped fixture (T45) — and must return all-PASS both times. A verifier that only passes on one shape is not acceptable, because it will be run against production later.

## Gate

20.3B is complete only when **T1–T19, T21, T22 pass on staging**, the catalog delta matches, and the corrected verification artifact (updated for the new objects) returns all-PASS. **T20 runs only inside the dedicated Auth window.** The 20.3A1 additions (T23–T32), the 20.3A1R lineage additions (**T33–T42**) and the 20.3B1 migration-rehearsal additions (**T43–T48**) are equally binding; **T34, T35, T37 and T42 are the regression guards** against reintroducing lead/vendor uniqueness on the event table, and **T48** is the guard against B1 absorbing B2's enforcement.
