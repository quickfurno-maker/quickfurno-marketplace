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
- **Lifetime = distinct vendors in `lead_assignment_events`** (append-only, non-cascading). `rejected/expired/cancelled/invalid/replaced` **retain** their lifetime slot; a `requested` or failed candidate **never** consumes one. L4/L5 assert against the lineage table, not `lead_assignments`.
- **Replacement** transitions the original to `replaced` (never deletes) and is capped one-per-lead by a partial unique index — L6/L7 map to T7/T8, plus new **T9** (replacement cannot exceed lifetime six).
- **Idempotency has three layers** — `assignment_operations.idempotency_key`, `uq_vendor_credit_logs_reference`, `lead_assignments UNIQUE(lead_id,vendor_id)`. L8/L9 map to T3/T4.
- **No caller-controlled ceiling exists** — a static assertion replaces L21's `max_vendors_per_lead` tampering test: `qf_assign_lead_vendors_v2` has no limit parameter and `ADMIN_MANUAL_TOTAL_VENDOR_LIMIT` reaches no RPC.
- **Public projection** is `vendor_public_v` with an explicit allow-list; L14 gains **T13** (no `select("*")` on public paths) alongside anon column-privilege assertions.
- **Communication** is an intent row only; L17/L18 map to T15/T16/T17, and **uncertain outcomes are terminal** (T18).
- **New additions:** T10 (anon/PUBLIC cannot execute the canonical RPC), T19 (zero legacy callers), T20 (Auth trigger provisions exactly once — dedicated window only), T21 (rollback rehearsal), T22 (tooling rejects the production ref).

Deterministic fixtures (seeded UUIDs, 8 vendors so lifetime-6 can be exceeded) and real parallel-session concurrency barriers are mandatory; staging must return to zero application rows between suites.

## Gate

QF-MVP-20 is not COMPLETE until: all L1–L24 pass on staging; concurrency and RLS/grant classes pass; migration rehearsal + rollback verified; historical ledger investigation closed (no blind mutation); `verify:mvp` green. Production canary only after founder sign-off.
