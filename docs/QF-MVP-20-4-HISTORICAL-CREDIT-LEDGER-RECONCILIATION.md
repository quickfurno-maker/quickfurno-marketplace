# QF-MVP-20.4 — Historical Credit-Ledger Reconciliation (Design + SELECT-only Audit Contract)

**Status: `HISTORICAL_LEDGER_RECONCILIATION_DESIGN_READY_FOR_PRODUCTION_SELECT_ONLY_AUDIT`.**

> **DESIGN + AUDIT PACK ONLY — NO DATABASE ACCESSED.** This phase designed the reconciliation, built
> a **SELECT-only** production audit SQL pack, an offline safety validator, and an **empty**
> evidence-manifest schema. No production, staging or QF-Jarvis was contacted; no migration was
> created; no data was read or written; nothing was pushed.

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

**Recommendation (for a LATER, separately reviewed migration — NOT created here):** a dedicated,
append-only, immutable `credit_ledger_reconciliation` table keyed by `(assignment_id)` with a unique
idempotency reference, holding the evidence class, decision, approver, correction mode, references and
audit id — **separate** from `vendor_credit_logs`, so evidence-only history never perturbs balance
arithmetic. This design does not implement it.

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

A **separately founder-authorized production SELECT-only evidence audit** that runs
`qf_mvp_20_4_historical_credit_ledger_audit.sql` under the §10 runbook, captures evidence outside Git,
and populates the manifest for founder review. **No correction, no migration, no write** occurs until
an approved manifest exists. Migrations A, A2, B1, G, B2, C, D and E remain applied and immutable.
