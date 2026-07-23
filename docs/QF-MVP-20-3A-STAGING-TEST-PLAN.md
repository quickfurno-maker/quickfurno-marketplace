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
| **T9** | Replacement cannot exceed lifetime six | integration | lineage already 6, replace with a **new** vendor | rejected `lifetime_limit_reached`; original stays active; replacing with an **existing** lineage vendor is blocked by `UNIQUE(lead_id,vendor_id)` |
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
| **T24** | Lineage seed is idempotent | migration rehearsal | 46 lineage rows + **1** batch operation row; re-run inserts **0** (`ON CONFLICT (lead_id,vendor_id) DO NOTHING`); `first_assigned_at` equals the source `assigned_at`; no ledger row created |
| **T25** | Lineage survives lead/vendor deletion attempt | DB integrity | `DELETE FROM leads`/`vendors` for a lead/vendor with lineage **fails with RESTRICT**; lineage row intact; no cascade fires |
| **T26** | Enforcement triggers are absent in B1 and present in B2 | migration rehearsal | after B1: 0 new triggers, legacy RPCs still succeed; after B2: 3 triggers, caps enforced |
| **T27** | Legacy 9-vendor recovery is rejected after B2 | integration | a `p_total_limit=9`-style attempt fails with `active_limit_reached`; **no partial assignment, no debit** |
| **T28** | Temporary suspension is a hard gate | integration | vendor with `assignment_suspended_at` set and `assignment_suspended_until` in the future → `vendor_not_eligible`; after expiry (time-shifted fixture) → eligible again; admin override **cannot** bypass it |
| **T29** | Suspension fields never reach the public projection | API + view | `vendor_public_v` exposes no `assignment_suspension_*`/`status`/`verification_status` column |
| **T30** | Public intake cannot set internal columns | API contract | a crafted intake payload containing `lead_quality_score`, `status`, `preferred_vendor_id`, `lead_priority`, `internal_notes` → those fields are **ignored/server-set**; the stored row carries defaults |
| **T31** | anon has no table privilege on `leads`/`vendors` after C | grant | `information_schema.role_table_grants` returns **no rows** for `anon` on either table; the always-true `leads` INSERT policy no longer exists |
| **T32** | Divergence view is read-only and classifies correctly | view | `vendor_wallet_package_divergence_v` returns a row per vendor with the expected `divergence_class`; executing it mutates **nothing** (balances and ledger counts unchanged before/after) |

**Note on T20 (Auth trigger):** unchanged — runs only inside the dedicated Auth window; no Auth user is created in any other suite.

## Gate

20.3B is complete only when **T1–T19, T21, T22 pass on staging**, the catalog delta matches, and the corrected verification artifact (updated for the new objects) returns all-PASS. **T20 runs only inside the dedicated Auth window.**
