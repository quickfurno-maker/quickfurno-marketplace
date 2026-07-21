# QF-MVP-10.7 — Reconciliation Results

**Branch:** `mvp/qf-mvp-10-core-data-truth-v1` · **HEAD:** `cd3bbf4`

## ⚠ Execution status: PENDING — read-only credentials & `psql` unavailable in this environment

The read-only reconciliation **tool + runbook are built and self-tested** (`scripts/mvp/reconciliation/**`, `npm run reconcile:mvp:{selftest,staging,production,compare}`). **Live collection has NOT run** because, at HEAD `cd3bbf4`, neither `QF_STAGING_READONLY_DATABASE_URL` nor `QF_PRODUCTION_READONLY_DATABASE_URL` is set and `psql` is not installed. Per the task rule, **no results are fabricated**: every *database-truth* answer below is `UNKNOWN_UNVERIFIED` until the tool is run with credentials. Answers that follow from **repository evidence** or **locked founder decisions** are given and labelled as such.

**To resolve:** on a host with `psql` + read-only credentials, run `reconcile:mvp:staging`, `reconcile:mvp:production`, `reconcile:mvp:compare` (each collection twice, byte-identical), then replace the "pending" answers here with the tool output and update the Migration Ledger status columns.

---

## The 15 questions

| # | Question | Repository evidence / founder decision (known now) | Database truth |
|---|---|---|---|
| 1 | Which repo migrations are **recorded in staging**? | 68 migrations committed | **UNKNOWN_UNVERIFIED** — `reconcile:mvp:staging` → `migrationsRecorded` |
| 2 | Which are **recorded in production**? | — | **UNKNOWN_UNVERIFIED** — `reconcile:mvp:production` |
| 3 | Which **DO-NOT-AUTO-APPLY** migrations appear represented by live objects? | 12 flagged (140–150, 300) | **UNKNOWN_UNVERIFIED** — object-existence via `compare.migrationPresence` (note: presence of a same-named object ≠ applied) |
| 4 | Which **assignment RPC** is live? | repo has ≥3 versions of `assign_lead_to_paid_vendors_phase26a` (migr 27/34/42/**45**); 45 is DO-NOT-AUTO-APPLY | **UNKNOWN_UNVERIFIED** — `loadBearingFunctions[].body`/`body_md5` |
| 5 | Which **credit RPC** is live? | canonical `qf_apply_vendor_credit_delta` (migr 44, DO-NOT-AUTO-APPLY) vs legacy `deduct_vendor_credit` (migr 3) | **UNKNOWN_UNVERIFIED** — `loadBearingFunctions` |
| 6 | Does **every assignment debit write `vendor_credit_logs`**? | ledger-backed RPCs (142/143/144) DO; **`admin_smart_assign_lead_to_vendors` does NOT** (A7, HIGH) | **UNKNOWN_UNVERIFIED** — `writes_vendor_credit_logs` flag on the *live* body |
| 7 | Does **credit-log idempotency** exist? | migr 141 declares `uq_vendor_credit_logs_reference` (DO-NOT-AUTO-APPLY) | **UNKNOWN_UNVERIFIED** — `indexes`/`constraints` + `safeCounts.vendor_credit_log_duplicate_references` |
| 8 | Is the **active-3 limit** enforced? | RPC body (`least(…,3)`) + preview CHECK `lead_assignments_max_three_vendors`; TS mirrors 8× | **UNKNOWN_UNVERIFIED** — live RPC body + `constraints` |
| 9 | **Lifetime limit** — 6, 9, or absent? | **Founder decision = 6** (locked). Code today: **no lifetime constraint in DB**; TS `ADMIN_MANUAL_TOTAL_VENDOR_LIMIT=9` (**rejected**, must be corrected to 6 in QF-MVP-20) | **UNKNOWN_UNVERIFIED** (expect: no DB-level lifetime cap) |
| 10 | Which **consent + Meta provider-account** objects are live? | declared by migr 55, 59, 60, 63–68 | **UNKNOWN_UNVERIFIED** — `constraints`/`columns`/`indexes` |
| 11 | Which **expected constraints are missing**? | watchlist: `uq_vendor_credit_logs_reference`, `communication_delivery_events_provider_account_required_check`, `communication_consent_ack_intents_provider_account_req_check`, `lead_assignments (lead_id,vendor_id)` unique | **UNKNOWN_UNVERIFIED** — `constraints` section |
| 12 | What **definition/history drift** exists? | — | **UNKNOWN_UNVERIFIED** — `compare` (function `body_md5` across envs; migration history vs committed set) |
| 13 | What must **QF-MVP-20 fix**? | see below (derivable now) | partially pending (which RPC body is live) |
| 14 | What must **QF-MVP-40 reconcile**? | see below (derivable now) | partially pending |
| 15 | **Safe to mark QF-MVP-10 COMPLETE?** | **NO** — reconciliation not executed | — |

## Q13 — QF-MVP-20 must fix (repository + founder-decision derived; confirm live state first)

1. **Correct the lifetime cap to 6** unique vendors per lead (founder-locked); remove/replace the rejected `9` (`ADMIN_MANUAL_TOTAL_VENDOR_LIMIT`); enforce **in the assignment RPC**, not only TS.
2. **Close the un-ledgered debit (A7):** rewrite `admin_smart_assign_lead_to_vendors` to the ledger contract so **every** credit mutation writes `vendor_credit_logs` (founder decision 5).
3. **Verify/apply the ledger-backed wallet** (migr 141–145) and confirm `uq_vendor_credit_logs_reference` exists before relying on idempotency.
4. **Consolidate the 5 eligibility interpretations (A2)** onto the credits-only canonical (`vendorAutomaticEligibility` + live RPC gate); derive TS mirrors from **one** cap constant (A3).
5. **Credit restoration** must require founder/authorized-admin approval and be audited (founder decision 4); wire the currently-unwired `refundCreditForInvalidLead`.

## Q14 — QF-MVP-40 must reconcile (repository derived; confirm live state first)

1. Confirm the whole communication/consent schema is **applied** (migr 55, 59, 60, 63–68 + consent-command-writer 300, DO-NOT-AUTO-APPLY) — gates fail closed if absent.
2. Verify provider-account **NOT-NULL** hardening constraints (67/68) and the ownership/binding objects exist before activation.
3. Flip Meta activation via **DB rows** (runtime policy → `canary`/`active`, seed provider account + approved template mappings) — none seeded today; canary-first.
4. Confirm STOP/START writer RPC + ack-intent tables/functions are applied; seed the 3 consent-ack templates; schedule the ack worker.

## Q6/Q7 privacy note (founder decisions 6/7)
Public vendor profiles must not expose package/plan/credit-balance/monetization status; these appear only in authorized vendor/admin/CRM views. `publicVendorService` maps a "safe" field set (free vendors → `activePaidPlan=false`); **QF-MVP-20/30 must add a test asserting no package/credit/monetization field ever reaches a public payload**, and reconciliation's `table_grants` must show no `anon`/`authenticated` read grant exposing credit/package columns.

## Completion decision (Q15)
**QF-MVP-10 is NOT safe to mark COMPLETE.** The evidence map (10.1–10.6, 10.8) is done and the reconciliation tool is built + self-tested, but the **read-only live-DB reconciliation is unexecuted** (no credentials/`psql` in this environment). QF-MVP-10 **remains `IN_PROGRESS`** until the tool is run against staging + production (or the reconciliation is formally waived by an explicit founder decision). This is the single outstanding gate before QF-MVP-20.
