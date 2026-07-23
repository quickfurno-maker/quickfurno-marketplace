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

## QF-MVP-20.3B1R additions — reviewed authority contracts (binding)

These fifteen tests prove the four contracts closed by the 20.3B1R review. Record: [`QF-MVP-20-3B1-MIGRATION-GENERATION-RESULTS.md`](QF-MVP-20-3B1-MIGRATION-GENERATION-RESULTS.md) §12b.

### Replay and idempotency conflict

| # | Test | Type | Setup | Assertion |
|---|---|---|---|---|
| **T49** | Exact replay returns the persisted IDs | integration | run an assignment, then re-invoke with the **same** operation key and the **same** request | returns the original `operation_id`, the original `assignment_id`s, `vendor_id`s, `credit_ledger_id`s, `active_count_after`, `lifetime_count_after` and `communication_intent_ids`, plus `already_applied = true`. **No new UUID appears anywhere in the response.** |
| **T50** | Exact replay creates zero new child rows | integration/DB | count `lead_assignments`, `vendor_credit_logs`, `lead_assignment_events`, `communication_intents` and `assignment_operations` before and after the replay | all five deltas are **0**; vendor balances unchanged; the operation's `result` and `completed_at` are unchanged |
| **T51** | Replay is immune to later state drift | integration | after the original commit, change the vendor's credit balance, suspend a vendor and add an unrelated assignment; then replay | the replayed result is **byte-identical** to the original; eligibility is not recalculated and the answer does not move |
| **T52** | Conflicting request under the same key is refused | integration | replay the same operation key with a **different** candidate vendor list (or different mode/reason/replacement ref) | returns `idempotency_conflict`; **zero mutation** across all five tables; the original operation row is untouched |
| **T53** | Candidate ordering is not a conflict | integration | replay the same key with the same candidate set in a **different order**, and with a duplicate id added | treated as an **exact replay**, not a conflict — the fingerprint deduplicates and sorts, so caller ordering is only a ranking preference |
| **T54** | Concurrent identical requests produce one result | DB concurrency | two parallel sessions, same key, same request | exactly **one** `assignment_operations` row; one session applies and the other returns the same persisted result; exactly one set of assignments, debits, events and intents |
| **T55** | Concurrent conflicting requests: one success, one conflict | DB concurrency | two parallel sessions, same key, **different** requests | one applies; the other returns `idempotency_conflict` and mutates nothing. Never two operations, never a merged result |
| **T56** | Incomplete attempt is not replayed as success | DB | force an operation row to remain `in_progress`, then invoke with the same key and request | returns `conflict_retry`, **not** `already_applied`; no result is invented; zero mutation |

### Assignment credit cost

| # | Test | Type | Setup | Assertion |
|---|---|---|---|---|
| **T57** | One successful assignment debits exactly one credit | integration | vendor with N credits, one eligible candidate | balance becomes **N−1**; exactly **one** `lead_assignment_debit` row with `credits_delta = -1`, correct `credits_before`/`credits_after`, `reference_type='lead_assignment'`, `reference_id = assignment_id` |
| **T58** | Two successful assignments debit exactly two credits | integration | two distinct eligible vendors in one operation | each vendor loses exactly 1; exactly **two** ledger rows, each `-1`; no third row |
| **T59** | Rejected candidates debit zero | integration | mix eligible and ineligible candidates (wrong city, wrong category, suspended, insufficient credits) | rejected vendors' balances are **unchanged**; **zero** ledger rows for them; they appear in `skipped[]` with sanitized reason codes |
| **T60** | Cap rejection debits zero | integration | lead already at 3 active, and separately a 7th distinct lifetime vendor | `active_limit_reached` / `lifetime_limit_reached`; **zero** ledger rows, zero assignments, zero events, zero intents |
| **T61** | Replay debits zero | integration | replay a successful operation | ledger row count and every vendor balance are **unchanged** |
| **T62** | Package counters remain unchanged | integration/DB | snapshot `vendor_packages` (all columns) before and after every assignment, replacement and restoration test | **byte-identical** afterwards; the wallet is the sole debit target |
| **T63** | Insufficient balance never clamps | integration | vendor with 0 credits | `insufficient_credits`; balance stays **0**, never negative; no assignment, no ledger row |

### Authorization and audit

| # | Test | Type | Setup | Assertion |
|---|---|---|---|---|
| **T64** | `client_selected` mode fails closed | integration | invoke as `service_role` with `p_mode='client_selected'` and any actor | returns `unauthorized`; **zero mutation** — not even an `assignment_operations` row is created. Ambiguous, zero-match and multi-match phone situations are irrelevant because no phone path exists |
| **T65** | Canonical authority is unreachable by anon/authenticated | RLS/grant | attempt `qf_assign_lead_vendors_v2` (every mode, including `client_selected`) as `anon` and as `authenticated` | rejected on privilege; `has_function_privilege` is false for both roles on all five canonical functions |
| **T66** | No `audit_logs` table is required | migration rehearsal | apply A → A2 → B1 on a database where `public.audit_logs` does **not** exist | all three apply and every canonical RPC executes successfully; no statement references `audit_logs` |
| **T67** | A2 leaves the historical ledger gap unchanged | migration rehearsal | production-shaped fixture reproducing assignments with no matching ledger evidence | the count of assignments lacking ledger evidence is **identical** before and after A2; `vendor_credit_logs` row count unchanged; no debit fabricated |

**T51, T52 and T56 are the replay regression guards.** Each one passes under the corrected fingerprint model and fails under the withdrawn key-only model. **T62** is the wallet-authority guard, and **T64/T65** together are the authorization guards.

**Verifier-behaviour binding:** `verify_qf_mvp_20_3b1.sql` must be run **twice** — once against empty staging (T44) and once against the production-shaped fixture (T45) — and must return all-PASS both times. A verifier that only passes on one shape is not acceptable, because it will be run against production later.

## QF-MVP-20.3B1A execution status (real staging run)

| Test | Status | Evidence |
|---|---|---|
| **T43** apply A/A2/B1 in order on empty staging | **FAILED** | A and A2 applied; **B1 aborted and rolled back**. History gained only `20260723000100` and `20260723000200`. Phase verifier not run as a gate. |
| **T44** A2 on empty staging creates nothing | **PASSED** | 0 backfill operations, 0 lineage events, 0 ledger rows, 0 intents; A2's own verification block confirmed ledger and intent counts never moved |
| **T45** A2 seeds per lead on production-shaped data | not run | requires a production-shaped fixture; no fixture may be created in the application phase |
| **T46** A2 no-op on re-run | not run | blocked with T45 |
| **T47** A2 skips and reports incomplete history | not run | blocked with T45 |
| **T48** B1 deploys without constraining legacy flows | **partially observed** | 0 enforcement triggers exist and all 6 legacy assignment RPCs remain — but B1 itself never installed, so the full assertion is unproven |

**Root cause of the T43 failure is a defect in B1, not in the test or the environment.** B1's §7.5c self-verification guard runs a negative regex over `pg_get_functiondef()`, whose output **includes comments**; the body of `qf_assign_lead_vendors_v2` documents that it never reads `app_settings` or `vendor_packages`, so the guard matched its own prose. Full analysis: [`QF-MVP-20-3B1-STAGING-APPLICATION-RESULTS.md`](QF-MVP-20-3B1-STAGING-APPLICATION-RESULTS.md) §12.

### New binding test — in-migration verification blocks are untested code

| # | Test | Type | Setup | Assertion |
|---|---|---|---|---|
| **T68** | Every in-migration `DO` verification block is rehearsed before it is declared ready | migration rehearsal | apply the migration to a disposable database that matches the target's pre-state | the block runs to completion. A **negative** assertion (`NOT LIKE`, `!~`, `~* '(...)'` used to forbid something) over `pg_get_functiondef()`, `prosrc` or any catalog text that retains comments must additionally be proven not to match the object's own documentation |

**T68 is now enforced offline by validator fixtures A–G** (QF-MVP-20.3B1R2): forbidden names in line comments, block comments and string literals must PASS; a real executable `SELECT FROM public.app_settings` and `UPDATE public.vendor_packages` must FAIL; a raw `pg_get_functiondef` negative-regex guard must be **rejected**; and an unterminated construct must fail closed. Fixture F reproduces the exact guard that aborted B1. The validator additionally forbids any lexical assertion over `pg_get_functiondef` / `prosrc` / `routine_definition` in **all three** migrations *and* in the phase verifier — which is how the six defective verifier rows were caught before they could fail a second application.

T68 exists because neither a dry-run nor an offline validator can execute a `DO` block: the dry-run proves only *which* migrations would run, and the validator inspects comment-stripped file text while the in-database guard inspects comment-retaining catalog output. The two disagreed, and only the database-side view was wrong.

## QF-MVP-20.3B1A2 execution status (corrected B1 applied)

| Test | Status | Evidence |
|---|---|---|
| **T43** apply A/A2/B1 in order on empty staging | **PASSED on retry** | corrected B1 applied at exit 0; history holds four truthful rows; the 20.3B1A `pg_get_functiondef` failure did not recur |
| **T44** A2 on empty staging creates nothing | **PASSED (re-confirmed)** | 0 backfill operations, 0 lineage events, 0 ledger rows, 0 intents; still 0 rows across all 67 tables |
| **T45–T47** A2 on production-shaped data | not run | requires a fixture; fixtures are not created in an application phase |
| **T48** B1 deploys without constraining legacy flows | **PASSED** | 0 enforcement triggers exist, all six legacy assignment RPCs remain, legacy `service_role` EXECUTE retained, no legacy grant broadened |
| **T68** in-migration `DO` blocks rehearsed before declared ready | **PASSED** | the corrected §7 block ran to completion against a real database — the outcome T68 exists to force |

**New failure surfaced by the phase verifier:** `R03_lineage_append_only_grants` — expected 0 UPDATE/DELETE grants on `lead_assignment_events`, found **4** (`postgres` and `service_role`, from Supabase default privileges that Migration A never revoked). Full analysis: [`QF-MVP-20-3B1A2-STAGING-APPLICATION-RESULTS.md`](QF-MVP-20-3B1A2-STAGING-APPLICATION-RESULTS.md) §14.

### New binding test — grant posture is not implied by a narrow GRANT

| # | Test | Type | Setup | Assertion |
|---|---|---|---|---|
| **T69** | A restricted table's privilege posture is asserted, not assumed | migration rehearsal + grant | apply any migration that creates a `public` table claiming a restricted posture (append-only, service_role-only, read-only) | after apply, `information_schema.role_table_grants` for that table contains **only** the privileges the migration explicitly intends — for **every** grantee including `postgres` and `service_role`, not merely `anon`/`authenticated`. Supabase default privileges grant `arwdDxtm` on creation, so the migration must `REVOKE ALL … FROM service_role, postgres` **before** its narrow `GRANT`. A migration that only grants, and never revokes, must fail this test |
| **T70** | Lineage immutability is enforced by at least one live mechanism | DB integrity | attempt `UPDATE` and `DELETE` on a `lead_assignment_events` row as `service_role` | both refused — by privilege, by trigger, or by both. Today **neither** is in force, which is exactly why this test exists. `service_role` bypasses RLS, so RLS alone can never satisfy T70 |

T69 generalises the finding: on Supabase, "grant only what you need" is not sufficient, because the platform has already granted everything. T70 is the behavioural backstop for the invariant that failed.

## QF-MVP-20.3B1G additions — grant repair (binding)

Migration **G** `20260723000400` is authored and reviewed but **not applied**. It is the mechanism that will satisfy **T69** and the privilege half of **T70**.

| # | Test | Type | Setup | Assertion |
|---|---|---|---|---|
| **T71** | Migration G applies as exactly one pending migration | migration rehearsal | staging at baseline + A + A2 + B1 | `migration list --linked` shows 5 local / 4 remote / **exactly one pending**; dry-run proposes only `20260723000400`; `db push` exits 0; history gains exactly one row |
| **T72** | Post-G lineage privilege posture is exact | grant | after G applies | `has_table_privilege` is **false** for `public`, `anon` and `authenticated` across all eight privileges; **false** for `service_role` on `UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN`; **true** for `service_role` on `SELECT` and `INSERT`. Effective checks only — `information_schema.role_table_grants` omits PUBLIC grants and must never be the proof |
| **T73** | Migration G is idempotent | migration rehearsal | apply G, then replay its statements against an already-repaired database | the pre-check still passes (service_role retains SELECT/INSERT), the revokes are no-ops, and the post-check still passes; no privilege is lost that the contract requires |
| **T74** | G does not disturb the other new tables | grant | before/after G | privileges on `assignment_operations`, `replacement_requests`, `credit_restoration_approvals` and `communication_intents` are **byte-identical**; G touches only the lineage table |

**T70 remains only half-satisfied after G.** G closes the privilege boundary; the trigger backstop is still Migration B2. `service_role` bypasses RLS, so RLS can never satisfy T70 on its own.

## Gate

20.3B is complete only when **T1–T19, T21, T22 pass on staging**, the catalog delta matches, and the corrected verification artifact (updated for the new objects) returns all-PASS. **T20 runs only inside the dedicated Auth window.** The 20.3A1 additions (T23–T32), the 20.3A1R lineage additions (**T33–T42**), the 20.3B1 migration-rehearsal additions (**T43–T48**) and the 20.3B1R authority-contract additions (**T49–T67**) are equally binding; **T34, T35, T37 and T42 are the regression guards** against reintroducing lead/vendor uniqueness on the event table, **T48** is the guard against B1 absorbing B2's enforcement, and **T51, T52, T56** are the guards against regressing to key-only idempotency.
