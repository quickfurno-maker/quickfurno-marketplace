# QF-MVP-20.4 — Historical Credit-Ledger Reconciliation (Design + SELECT-only Audit Contract)

**Status: `HISTORICAL_LEDGER_EXCEPTION_REGISTER_APPLIED_AND_VERIFIED_ON_STAGING`.**

> **20.4A DESIGN + 20.4B PRODUCTION SELECT-ONLY AUDIT + 20.4C EXCEPTION-REGISTER MIGRATION COMPLETE.**
> 20.4A built the audit pack; 20.4B (founder-authorized) executed it read-only against production and
> found all **27** candidates `INSUFFICIENT_EVIDENCE`; on that evidence the **founder ruled
> NO_FINANCIAL_CHANGE** (zero debit, zero refund, zero package change, no `vendor_credit_logs` backfill).
> 20.4C then **generated** — but did **not apply** — a forward-only migration for an immutable,
> append-only exception register that records those rulings as evidence with no credit-mutation
> semantics. **Facts and a schema only — no classification changed, no correction executed, no data
> written, no managed database accessed in 20.4C.** Evidence lives outside Git; only aggregate,
> UUID-free facts are committed here.

## 0-D. Exception-register staging application (QF-MVP-20.4CA) — APPLIED + VERIFIED

**Date:** 2026-07-24 (13:53–13:57 UTC) · **Linked target:** authorized staging `uckafzuochmbvtiodmcl`
(production `yqpgcsduqbxulrlzwzap` and QF-Jarvis `coilipywdvxklewquqvv` not the target, not contacted).
**Migration `20260723000900` is APPLIED to staging** via exactly one `supabase db push --linked`
(13:54:46→13:54:53 UTC, **exit 0**); exactly that migration applied, no earlier migration, no
repair/reset, no second push. The migration's in-transaction `$verify$` self-check NOTICE fired (immutable
append-only table, RLS on, service_role SELECT+INSERT only, U/D/T trigger-blocked for every role, financial
outcome locked to INSUFFICIENT_EVIDENCE / EXCEPTION_RECORD_ONLY / NO_FINANCIAL_CHANGE, all mutation flags
false, no `vendor_credit_logs` backfill, only a non-cascading self-supersession FK, **zero rows**, A…E
intact). Trailing `pgdelta-target-ca.crt ENOENT` is the known non-blocking local edge-runtime cache
artifact (same as the E application); exit 0.

**Identity:** applied at HEAD `06b900a37f65cafee162fa16f5b970ea3860d955` (parent
`729abc4698547a5a18558ca2462ab1720dd92fbd`, origin identical, **0/0**, clean). Locked hashes exact
(migration `75b6faf2…`, validator `0a4256a1…`, verifier `1cfd9104…`, manifest `bafe0951…`); applied
A/A2/B1/G/B2/C/D/E + 20.4A artifacts byte-unchanged.

**History:** before **10 local / 9 remote** (`20260723000900` sole pending) → after **10 local / 10
remote**, all versions paired exactly once, the register migration applied once with no duplicate.

**Locked verifier `verify_qf_mvp_20_4c.sql` (`1cfd9104…`) ran once against staging: 22 rows, 22 PASS / 0
FAIL.** Proven live: register present with exactly the 20-column contract and **0 rows**; RLS enabled;
PUBLIC/anon/authenticated hold **zero** privilege; `service_role` **SELECT+INSERT only** (no
UPDATE/DELETE/TRUNCATE); the `BEFORE UPDATE|DELETE` row trigger (tgtype 27) and `BEFORE TRUNCATE` statement
trigger (tgtype 34) both present and bound to their guards; trigger functions not untrusted-executable; the
six financial locks and ten integrity constraints (incl. unique `idempotency_key`) all present; the **only**
FK is the non-cascading self-supersession reference; `vendor_credit_logs` untouched (its reference-unique
index + `lead_assignment_debit` CHECK remain); and A/A2/B1/G/B2/C/D/E all intact. Register owner is
`postgres` (break-glass, informational).

**No financial write:** a post-application SELECT-only pass confirmed the register holds **0 rows** and the
sum of ALL public-table rows is **0**; `vendors` / `vendor_packages` / `lead_assignments` /
`vendor_credit_logs` / `auth.users` / `profiles` all remain **0**; public base tables went 67 → 68 (only the
register added). The sole database change was schema `20260723000900` — no exception row, no
balance/package/assignment/ledger mutation, no state-changing RPC, no candidate data, no owner
binding/`profiles` grant/`admin_role` change.

**Gates:** 20.4C **42/42**, 20.4A 39/39, E 51/51, D 110/110, C 83/83, B2 61/61, B1/G 165/165, R1 62/62,
`verify:mvp` exit 0, typecheck/lint/build clean, `git diff --check` exit 0. Transcript + queries + before/
after captures outside Git in `qf-staging-workspace/QF-MVP-20.4CA-APPLICATION-20260724T135333Z/`.

**Next:** founder-approved exception-population design/review, or a Marketplace closeout decision — **not**
automatic candidate insertion. Populating the 27 exceptions stays a separate, founder-authorized insertion
plan (still not authorized). `profiles`-GRANT, `admin_role` and owner binding remain separate follow-ups.

## 0-C. Exception-register staging preflight (QF-MVP-20.4CP) — COMPLETE, NOT APPLIED

**Date:** 2026-07-24 (13:29–13:32 UTC) · **Linked target:** authorized staging `uckafzuochmbvtiodmcl`
(production `yqpgcsduqbxulrlzwzap` and QF-Jarvis `coilipywdvxklewquqvv` not the linked target, not contacted).
**Nothing was applied** — one `supabase db push --linked --dry-run`, plus SELECT-only catalog checks and
`migration list`. No `db push` without `--dry-run`, no `migration up/repair/reset`, no hand-executed SQL,
no exception-register row, no RPC, no balance/package/assignment/ledger change.

**Identity:** generated at HEAD `729abc4698547a5a18558ca2462ab1720dd92fbd` (parent
`854709d206d115a8e375b4cb406ee2c94de18b72`, origin identical, **0/0**, clean; the generation commit touched
exactly its eight authorized paths). **Phase-locked full hashes** (match the 20.4C prefixes): migration
`75b6faf2f7ed52007b79b9036dd5998f00eb67d88e62ffa34b3d9d1343c5039d`, validator
`0a4256a1b534c91a18f240de0be8ea28a2e8e2c3325e07e08733c20968c6a9b2`, verifier
`1cfd910408c196b3a2e857d233bcdcf9d19ba6492bc0dc65c374dbfe593fbcbc`, contract manifest
`bafe0951d8a4b8f0f72fd1524c1a2034394e4d611869e99f9fa62df1264462fc`. Applied A/A2/B1/G/B2/C/D/E, the 20.4A
audit/validator/manifest-schema, and the R1 runtime are byte-unchanged.

**External apply workspace (`qf-staging-apply`, outside Git):** no `seed.sql`, no Edge Functions; migrations
held exactly the nine applied files (baseline + A…E, all byte-identical to the repo); the register
`20260723000900` was absent, so **only** the locked migration was copied in (byte-identical, hash `75b6faf2…`),
giving exactly ten SQL migrations.

**Live pre-state (SELECT-only) — as expected:** register table / immutability functions / immutability
triggers **absent**; `20260723000900` **absent** from remote history; **nine** earlier migrations present;
A/A2/B1/G/B2/C/D/E preserved (B1 authority, four B2 triggers, C `vendor_public_v`, D `on_auth_user_created`,
E six-RPC untrusted-EXECUTE = 0); **67** public tables summing to **0** rows; `auth.users` = 0, `profiles` = 0,
`lead_assignments`/`vendor_credit_logs`/`vendors`/`vendor_packages` = 0 (no candidate rows anywhere); no
owner-binding column on `leads`; `profiles.admin_role` absent on staging and `authenticated` holds no
`profiles` grant (both follow-ups un-implemented).

**Migration history:** **10 local / 9 remote**; baseline…E paired; `20260723000900` local-only and the **sole
pending** migration.

**Dry run (once, exit 0):** `DRY RUN: migrations will *not* be pushed`; **exactly one** proposed migration —
`20260723000900_qf_mvp_credit_ledger_reconciliation_exception_register.sql`; no earlier migration, no
application claim.

**No-write proof:** re-listing history and re-running the pre-state after the dry run returned **identical**
results — remote still nine, `20260723000900` still local-only, register still absent, all tables still empty.

**Offline gates:** 20.4C **42/42**, 20.4A 39/39, E 51/51, D 110/110, C 83/83, B2 61/61, B1/G 165/165, R1
62/62, `verify:mvp` exit 0, typecheck/lint/build clean, `git diff --check` exit 0. Transcript + query +
before/after captures live outside Git in `qf-staging-workspace/QF-MVP-20.4CP-PREFLIGHT-…/`.

**Next: application review** — a separately authorized single `db push` that applies exactly
`20260723000900` (schema only, zero rows), then the SELECT-only verifier `verify_qf_mvp_20_4c.sql`.
Populating the 27 exceptions stays a later, separate founder-authorized insertion plan.

## 0-B. Immutable exception-register migration (QF-MVP-20.4C) — GENERATED, NOT APPLIED

**Founder ruling (LOCKED).** On the 20.4B evidence — all **27** historical candidates
`INSUFFICIENT_EVIDENCE`, zero canonical or legacy ledger evidence, zero conflicts, zero arithmetic
violations — the **founder approved NO_FINANCIAL_CHANGE**: **zero debit, zero refund, zero package
change, and no `vendor_credit_logs` backfill**. No candidate is corrected; each is recorded only as an
unresolved evidence exception.

**What 20.4C produced (schema only, unapplied).** A single forward-only migration
`supabase/migrations/20260723000900_qf_mvp_credit_ledger_reconciliation_exception_register.sql` that
creates one **immutable, append-only** table `public.credit_ledger_reconciliation_exceptions`. The
register is **generated and reviewed but not applied**; **no managed database was accessed in 20.4C**,
and **no candidate row, UUID or PII is embedded** — the migration ships **empty** (expected
post-application state: **zero rows**), and populating it is a separate, founder-authorized insertion
plan.

**Register architecture (why it is safe).**

- **Separate from `vendor_credit_logs`.** Per §8, the arithmetic ledger cannot honestly hold
  evidence-only rows. The register is a distinct table carrying **no credit-mutation semantics** — it
  never touches `vendors`, `vendor_packages`, `lead_assignments` or `vendor_credit_logs`. **No
  `vendor_credit_logs` backfill** occurs or is implied.
- **Financial outcome pinned in the schema.** CHECK constraints hard-lock
  `classification = 'INSUFFICIENT_EVIDENCE'`, `correction_mode = 'EXCEPTION_RECORD_ONLY'`,
  `founder_decision = 'NO_FINANCIAL_CHANGE'`, and `balance_mutation = package_mutation =
  vendor_credit_logs_backfill = false`. A row can physically only encode "evidence recorded, nothing
  changed."
- **Immutable and append-only.** RLS is enabled; `UPDATE`, `DELETE` and `TRUNCATE` are blocked for
  **every** role — including `service_role` — by a `BEFORE UPDATE OR DELETE` row trigger
  (`trg_clre_immutable`) and a `BEFORE TRUNCATE` statement trigger (`trg_clre_no_truncate`), backed by
  matching privilege revokes. Future resolution is **append-only** via a new superseding row
  (`supersedes_record_id`, self-FK `ON DELETE RESTRICT`); existing rulings are never rewritten.
- **Least privilege.** `PUBLIC`, `anon` and `authenticated` receive **nothing**; `service_role` is
  granted **only `SELECT` and `INSERT`**. No policy targets an untrusted role.
- **Evidence-preserving keys.** `assignment_id` and `vendor_id` are plain UUIDs with **no** foreign key
  to operational tables — an operational delete can never erase reconciliation history, and no cascade
  can. Each row carries `audit_run_id`, `audit_sql_sha256`, `evidence_manifest_sha256` (64-hex CHECK),
  `reviewer_actor` (`FOUNDER`/`AUTHORIZED_ADMIN`), `reviewed_at`, `reason`, and a **unique**
  `idempotency_key`.

**Offline safety validator.** `scripts/mvp/reconciliation/validate-qf-mvp-20-4c.mjs` grades the
migration, the SELECT-only staging verifier, the contract manifest and this document with one-defect
fixtures for every financial/immutability rule — it rejects any INSERT/backfill, production UUID/PII,
use of `vendor_credit_logs` as the register, balance/package/assignment mutation, `UPDATE`/`DELETE`/
`TRUNCATE` grant to `service_role`, any `PUBLIC`/`anon`/`authenticated` privilege, missing RLS, missing
immutability triggers, cascade delete, missing false-flag/classification/correction/decision locks,
missing actor/reason/`reviewed_at`, missing evidence hashes, weak idempotency, a writable verifier, a
broad/default-privilege change, owner-binding/`profiles`-grant/`admin_role` scope creep, or edits to an
already-applied migration.

**No financial change was executed by this phase.** 20.4C writes a schema, not money.

## 0-A. Production SELECT-only evidence audit (QF-MVP-20.4B) — COMPLETE

**Date:** 2026-07-24 · **Project ref:** `yqpgcsduqbxulrlzwzap` (production "QuickFurno", ap-southeast-1,
PostgreSQL 17.6). **Connection truth:** `transaction_read_only = off` — the connection is *technically
writable*; SELECT-only was **process-enforced** through the R00–R11 allowlist, not connection-enforced.
Staging and QF-Jarvis were not contacted.

**Locked artifacts (hashes exact):** audit SQL `615d3712…`, validator `3f660420…` (39/39), manifest
schema `a63d04a7…`. The R02 fingerprint confirms the expected model — `qf_apply_vendor_credit_delta`
definition MD5 **`45ad58beb9cb1dd8ea4f77466909cc0e`**, matching the QF-MVP-10 record. **Fingerprint
gate: PASS.** Migration history reported (4 rows, `HISTORY_DRIFT`) — **not repaired**.

**Aggregate findings (no UUIDs / no PII):**

| Metric | Value |
|---|---|
| Total assignments (R03) | 46 |
| `credit_deducted` assignments | 46 |
| Canonical assignment-debit ledger rows | 19 |
| Logs without `reference_id` | 28 |
| **Candidate population (R04)** | **27** |
| Source breakdown (R05) | admin 5 · automatic 16 · client-selected 6 |
| Legacy/equivalent supporting signals (R06) | 0 unreferenced `lead_assignment_debit` logs for every candidate vendor |
| Duplicate/reference conflicts (R07) | 0 |
| Arithmetic violations (R08) | 0 |
| Distinct candidate vendors (R09) | 3 (current balances — **prohibited as sole proof**) |
| Unreconcilable rows (R10) | 0 |
| Conservative SQL class (R11) | **27 → `INSUFFICIENT_EVIDENCE`** · 0 `PROVEN_*` · 0 `DATA_INVARIANT_VIOLATION` · 0 `DUPLICATE_OR_REFERENCE_CONFLICT` |

**Comparison with the historical 46/19/27 (2026-07-22): UNCHANGED** — identical totals and source
split; no divergence. No schema/fingerprint warning.

**Evidence class outcome:** every one of the 27 candidates is `INSUFFICIENT_EVIDENCE`. No candidate
has any ledger evidence (canonical *or* legacy) and none carries a conflict or arithmetic violation,
so **no strong-evidence path exists in the current data** — therefore **no `PROVEN_DEBIT_ALREADY_APPLIED`
or `PROVEN_NO_DEBIT` may be asserted**, and none was.

**Decision state:** reviewer_decision **PENDING**; approval actor **unset**; correction_mode
**NONE_PENDING_REVIEW**; `balance_mutation=false`; `package_mutation=false`; execution **not authorized**
(schema enum `NOT_STARTED`); verification **evidence-captured-only** (schema enum `NOT_VERIFIED`). **No
classification is approved and no correction is authorized by this phase.**

**Evidence location (outside Git):** `qf-production-workspace/QF-MVP-20.4B-PRODUCTION-AUDIT-…/` holds the
transcript, query allowlist + statement hashes, complete R00–R11 outputs + hashes, the schema-valid
evidence-manifest instance (27 candidate UUIDs), and the aggregate report. **No production UUID, row or
secret entered Git.**

**No-write proof:** only the identity SELECT and the exact R00–R11 SELECTs ran, each once; no write/DDL/
DCL/`CALL`/`DO`/`COPY`, no RPC (no `qf_apply_vendor_credit_delta`/`deduct_`/`restore_`/`increment_vendor_credit`/
assignment RPC), no migration command, no session change, no data change.

**Next: founder evidence review + a correction-plan decision** — *not* a migration application. Any
correction remains gated on an approved manifest (§6–§7). `profiles`-GRANT, `admin_role` and owner
binding remain separate.

---

Generated at HEAD `46c97e4628a075b6f169680a751668a6805bda8f` (origin identical, 0/0). The locked
release sequence A → A2 → B1 → G → R1 → B2 → C → D → **E is complete on staging**; QF-MVP-20.4 is the
next scope, beginning with this design and a later, separately founder-authorized production
SELECT-only evidence audit.

## 1. The problem, from committed QF-MVP-10 evidence

`docs/QF-MVP-10-RECONCILIATION-RESULTS.md` §F recorded, from a **process-enforced SELECT-only**
production reconciliation on **2026-07-22**:

- **46** assignments marked `credit_deducted` (34 automatic, 7 client-selected, 5 admin);
- **19** canonical assignment-debit ledger rows (`vendor_credit_logs` with
  `reference_type='lead_assignment'`, `reference_id=<assignment uuid>`, `change_type='lead_assignment_debit'`);
- **27** credit-deducted assignments **lacking** that canonical ledger evidence:
  **admin 5 · automatic 16 · client-selected 6**.

**These 46/19/27 counts are HISTORICAL OBSERVATIONS, not invariants.** Production is
`HISTORY_DRIFT` (only 4 recorded migration rows despite many present objects). The later audit
reports whatever the live data actually shows and flags any divergence with a factual explanation.

**Why the gap exists (from the same evidence):** the four PUBLIC/anon-executable assignment RPCs
(`admin_smart_assign_lead_to_vendors`, `assign_client_selected_vendor_to_group`,
`assign_vendor_to_requirement_group`, `assign_lead_to_preferred_vendor`) and the legacy credit
functions **change balances without writing mandatory assignment-linked ledger evidence**:
`deduct_vendor_credit` (decrements `vendors.remaining_credits`, FIFO-burns `vendor_packages.remaining_leads`,
**no ledger**), `restore_vendor_credit` (increments, no approval, **no ledger**),
`increment_vendor_credits` (**no ledger**). The canonical `qf_apply_vendor_credit_delta`
(service_role only, row-locks the vendor, dedupes on `uq_vendor_credit_logs_reference`, **writes the
ledger**) is the only path that leaves canonical evidence.

## 2. Authoritative credit model (repository-proved)

| Object | Facts |
|---|---|
| `public.lead_assignments` | `id, lead_id, vendor_id, assigned_at, assignment_type {client_selected,auto_assigned,admin_assigned}, vendor_status, credit_deducted (bool, default true), requirement_group_id, assignment_source` |
| `public.vendor_credit_logs` | `id, vendor_id, change_type (CHECK incl. lead_assignment_debit, invalid_lead_refund, correction, …), credits_before, credits_delta, credits_after, reason, updated_by, created_at, reference_type, reference_id` |
| index `uq_vendor_credit_logs_reference` | `UNIQUE (reference_type, reference_id) WHERE reference_id IS NOT NULL` — the idempotency spine |
| `public.vendors` | `total_credits, remaining_credits` (integers) |
| `public.vendor_packages` | `total_leads, remaining_leads` |
| `qf_apply_vendor_credit_delta(uuid,integer,text,text,text,text,text,boolean)` | CANONICAL; service_role only; locks vendor; dup-reference check; **writes `vendor_credit_logs`**; returns `already_applied` on duplicate |
| `deduct_vendor_credit`, `restore_vendor_credit`, `increment_vendor_credits` | LEGACY; mutate balances/package leads; **write no ledger** — the root cause of missing evidence |
| canonical assignment authority `qf_assign_lead_vendors_v2` (B1, staging) / `assign_lead_to_paid_vendors_phase26a` + `assign_lead_to_vendors` (production service-role RPCs) | write mandatory assignment-linked ledger rows |

**Canonical assignment-debit evidence for assignment `A` is EXACTLY:**
`vendor_credit_logs WHERE reference_type='lead_assignment' AND reference_id = A.id::text AND change_type='lead_assignment_debit'`.

## 3. Frozen candidate population (structural, not a hardcoded count)

An assignment enters the audit population **iff all** hold:

1. the `lead_assignments` row exists;
2. `credit_deducted IS TRUE` (per the actual schema) — **a candidate filter, never proof of debit**;
3. **no** canonical assignment-debit ledger row exists for it (the exact contract in §2);
4. it is not already represented by a separately approved immutable reconciliation record (`ALREADY_RECONCILED`);
5. it is not a duplicate/reference collision (surfaced separately);
6. it is not excluded by a proved non-credit assignment mode (`OUT_OF_SCOPE_NON_CREDIT_ASSIGNMENT`).

The audit reports the **observed** candidate count and source breakdown, and **must not** require the
result to equal 27. Any divergence from the historical 27 is reported with a factual explanation
requirement, never silently "corrected".

**No blind backfill.** Being in the candidate population is *not* proof a debit occurred (nor that it
did not). No historical or compensating ledger evidence may be written for any candidate until a
**strong** proof path (§5) is reviewed and founder-approved (§6). A missing ledger row is treated as
missing *evidence*, never as a missing *debit*.

## 4. Closed evidence classification vocabulary

No candidate may be classified by a single weak signal. Each candidate is exactly one of:

- **A. `PROVEN_DEBIT_ALREADY_APPLIED_LEDGER_MISSING`** — strong evidence proves the balance/package
  entitlement was actually consumed, but canonical assignment-linked ledger evidence is missing.
- **B. `PROVEN_NO_DEBIT`** — strong evidence proves no debit occurred despite `credit_deducted`.
- **C. `ALREADY_HAS_EQUIVALENT_LEDGER_EVIDENCE`** — a legacy/non-canonical ledger row exists that can
  be **deterministically** linked (no ambiguity) to this assignment/vendor.
- **D. `DUPLICATE_OR_REFERENCE_CONFLICT`** — more than one candidate ledger/reference, or conflicting
  evidence, exists.
- **E. `INSUFFICIENT_EVIDENCE`** — current records cannot prove whether the debit happened. **The safe
  default.**
- **F. `DATA_INVARIANT_VIOLATION`** — arithmetic, vendor identity, source, timestamps or package state
  contradict one another.
- **G. `ALREADY_RECONCILED`** — a separately approved immutable reconciliation record already exists.
- **H. `OUT_OF_SCOPE_NON_CREDIT_ASSIGNMENT`** — the assignment did not require credit under the proved
  business contract.

## 5. Evidence-strength hierarchy

**STRONG** (repository-proved facts; ≥1 required for class A or B):
- an exact canonical ledger reference; a legacy ledger row deterministically linked by
  assignment/vendor/time/change semantics **without ambiguity**; an immutable assignment event tying
  the same vendor+assignment to a successful debit result; an idempotency/reference record from
  `qf_apply_vendor_credit_delta`; an audited package-consumption record with an exact assignment
  reference; a trusted function result persisted atomically with the assignment; or an arithmetic
  sequence reconstructable **without guessing**.

**SUPPORTING** (never sole proof): assignment source; assignment `assigned_at`; vendor/package state
around the event; an admin audit record; the legacy function path known for that source.

**PROHIBITED AS SOLE PROOF** (emitted as facts, never as proof): `credit_deducted`; current
`remaining_credits`; current package `remaining_leads`; assignment existence; current vendor plan;
current balance minus an expected debit; source type alone; timestamp proximity without exact
identity/reference; comments, UI labels or recollection.

The audit SQL therefore emits only a **conservative** `sql_proposed_class` (`DATA_INVARIANT_VIOLATION`,
`DUPLICATE_OR_REFERENCE_CONFLICT`, or the default `INSUFFICIENT_EVIDENCE`) and **never** proposes
`PROVEN_DEBIT_ALREADY_APPLIED_LEDGER_MISSING` or `PROVEN_NO_DEBIT` — those require human review of a
strong proof path plus founder approval.

## 6. Decision and approval authority matrix

| Actor | Authority |
|---|---|
| SELECT-only audit collector (this pack) | **no decision authority** — collects facts only |
| Automated classifier | may produce evidence + a **proposed** class only; never decides money |
| **Founder** or specifically authorized **admin** | approves any historical correction |
| `service_role` executor | may execute **only** an approved, immutable correction plan |
| Jarvis / n8n | **no authority** of any kind |

Every approved correction plan must carry: candidate assignment UUID; vendor UUID; source; proposed
classification; evidence references; current balance/package facts; intended correction type; whether
balance changes; whether package entitlement changes; reason; approving actor; approval timestamp;
deterministic idempotency/reference key; rollback/compensation strategy; audit-record identity. These
are the manifest's `reviewer_decision` + `approval` + `execution` fields.

## 7. Correction modes (DESIGN ONLY — not implemented here)

- **MODE 1 `EVIDENCE_ONLY`** — debit proved already applied; add historical/reconciliation **evidence**
  without changing vendor balance or package entitlement.
- **MODE 2 `STATE_CORRECTION_DEBIT`** — no debit occurred but policy requires one. **Never automatic**;
  requires founder/admin approval, current-entitlement validation, an atomic ledger-backed debit, and
  a **separate operational decision** on whether retroactive charging is even appropriate.
- **MODE 3 `STATE_CORRECTION_REFUND`** — an erroneous debit is proved; requires founder/admin approval
  and an atomic ledger-backed restoration.
- **MODE 4 `EXCEPTION_RECORD_ONLY`** — evidence insufficient/conflicting; record an immutable unresolved
  exception; **no money/credit change**.
- **MODE 5 `LINK_EXISTING_LEGACY_EVIDENCE`** — equivalent historical evidence exists; record a
  deterministic reconciliation link without duplicating a debit or mutating balance.

## 8. Can `vendor_credit_logs` safely hold evidence-only history? — **NO**

`vendor_credit_logs` is an **arithmetic** ledger: each row asserts `credits_before + credits_delta =
credits_after` and participates in the vendor balance sequence, and `uq_vendor_credit_logs_reference`
makes `(reference_type, reference_id)` unique. An **evidence-only** reconciliation row (MODE 1) that
must **not** change the balance cannot honestly carry a non-zero delta, and a zero-delta row would
still (a) pollute the arithmetic sequence readers assume, (b) risk colliding with the real debit's
future reference, and (c) be indistinguishable from a genuine mutation to any consumer. It also cannot
be rolled back cleanly.

**Recommendation — now realized in QF-MVP-20.4C (generated, unapplied):** a dedicated, append-only,
immutable `credit_ledger_reconciliation_exceptions` table with a unique `idempotency_key`, holding the
evidence class, founder decision, reviewer actor, correction mode, audit references and evidence
hashes — **separate** from `vendor_credit_logs`, so evidence-only history never perturbs balance
arithmetic (see §0-B). The 20.4C migration implements exactly this and nothing more: it records the
`NO_FINANCIAL_CHANGE` rulings as evidence and mutates no balance, package, assignment or ledger row.

## 9. SELECT-only production audit pack

`supabase/reconciliation/qf_mvp_20_4_historical_credit_ledger_audit.sql` (SHA-256 recorded in the
board) is **pure SELECT/CTE**, outside `supabase/migrations`. It:

- opens with a prominent SELECT-ONLY / READ-ONLY warning; contains no write/DDL/DCL/transaction/`DO`/
  `COPY`/`SELECT INTO`/writable-CTE statement; invokes **no** user-defined or state-changing function
  (only read-only catalog builtins `to_regclass`/`to_regprocedure`/`pg_get_functiondef`/`md5`);
- produces deterministically ordered result sets **R00–R11**: audit-run fingerprint (R00), migration-
  history facts without repair (R01), schema/function fingerprints (R02), coverage totals (R03), the
  candidate population (R04), source breakdown (R05), legacy/equivalent **supporting** signals with an
  explicit ambiguity caveat (R06), duplicate/reference conflicts (R07), arithmetic violations (R08),
  per-vendor state **facts labelled prohibited-as-proof** (R09), unreconcilable rows (R10), and a
  conservative `sql_proposed_class` HINT (R11);
- **minimises PII**: exposes only UUIDs, timestamps, source/type, ledger reference facts and integer
  balances — never name/phone/email/address;
- **separates raw facts (R04) from the proposed class (R11)** and never emits `PROVEN_*` from SQL;
- reports enough to populate the empty evidence manifest later **without embedding any live row in Git**.

**Offline safety validator:** `scripts/mvp/reconciliation/validate-qf-mvp-20-4a.mjs` grades the audit
SQL (rules S01–S14), the manifest schema and this document, with 16 one-defect fixtures. It rejects
any write/DDL/DCL, writable CTE, transaction control, state-changing-RPC invocation, missing SELECT-
only header, PII column, hardcoded `27` gate, SQL-emitted `PROVEN_*`, class derived from
`credit_deducted`, missing deterministic ordering, secret/URL, missing breakdown/fingerprint, or a
weakened reference contract.

## 10. Production-audit runbook (the LATER phase)

1. Requires **explicit founder authorization** for production SELECT-only access.
2. The connection may be **technically writable**; safety is **process-enforced** through a strict
   SELECT-only allowlist (exactly the QF-MVP-10 operating mode).
3. Capture the full query text, `sha256`, R00/R02 fingerprints, timestamps and output **outside Git**.
4. **No correction in the same session.** No automatic import of results.
5. Founder/admin review occurs **after** evidence capture; a correction design is generated **only**
   from an approved manifest.
6. **No automatic migration application** against drifted production — no `db push`, `migration up`,
   `reset` or `repair` (`HISTORY_DRIFT`); history is reported (R01), never repaired.
7. Ambiguous rows remain **unresolved with zero balance effect** (`EXCEPTION_RECORD_ONLY`).

## 11. Independent review — defects considered and controls

Reviewed for: double-debit risk (Mode 2 never automatic; idempotency key mandatory), false-refund
risk (Mode 3 needs proved erroneous debit + approval), fabricated balances (current balances are
prohibited-as-proof; no before/after invented), duplicate references (R07 + class D block first),
current-state-as-historical-proof (explicitly prohibited; R09 labelled), legacy-function ambiguity
(R06 supporting-only with caveat), package-entitlement drift (facts only, no mutation), assignment
deletion/cancellation/invalid-lead effects (R10 unreconcilable + Mode 4), timestamp/timezone
ambiguity (never a sole link — S09/§5), actor/approval weakness (§6 matrix; Jarvis has none),
unsafe SQL hidden in CTEs/comments (tokenizer strips comments/strings before rule checks; S02 blocks
writable CTEs), PII leakage (S06 allowlist), production history-drift (R01 reports, never repairs;
runbook forbids migration commands), inability to roll back evidence-only records (§8 → separate
immutable table recommended, not `vendor_credit_logs`), and future QF-MVP-20.7 credit-authority
overlap (this phase writes nothing and defines only evidence + decision contracts, leaving the
canonical credit authority untouched).

## 12. Follow-ups still tracked (out of scope here)

- `profiles` `authenticated` table-GRANT — mandatory separate follow-up before final closeout.
- `profiles.admin_role` drift — inert schema cleanup.
- Owner binding (`R1_BLOCKED_PENDING_OWNER_BINDING`) — deferred.
- The recommended immutable `credit_ledger_reconciliation` table — a **later, separately reviewed**
  migration; not created here.

## 13. Next phase

The exception register is **applied and verified on staging** (§0-D): `20260723000900` applied once
(10 local / 10 remote), the locked verifier returned **22/22 PASS**, and a post-application SELECT-only
pass proved the register is **empty** with no financial/operational write. Next is a **founder-approved
exception-population design/review** (a separate, founder-authorized insertion plan that would record the
27 `INSUFFICIENT_EVIDENCE` rulings as append-only rows — still **not** authorized, and never automatic),
**or** a Marketplace closeout decision. `profiles`-GRANT, `admin_role` and owner binding remain separate
follow-ups. Migrations A, A2, B1, G, B2, C, D, E and now the 20.4C exception register remain applied and
immutable.
