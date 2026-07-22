# QF-MVP-20 — Staged Migration Plan (section K)

**Branch:** `mvp/qf-mvp-20-marketplace-engine-v1` · **Type:** DESIGN ONLY — no migration file is created, no DB is accessed, nothing is applied.
**Evidence baseline:** QF-MVP-10 reconciliation. Companion: [`QF-MVP-20-AUTHORITY-REPAIR-DESIGN.md`](QF-MVP-20-AUTHORITY-REPAIR-DESIGN.md), [`QF-MVP-20-ACCEPTANCE-TEST-PLAN.md`](QF-MVP-20-ACCEPTANCE-TEST-PLAN.md).

## Hard constraints

- Production shows **`HISTORY_DRIFT`**: only **4** migration-history rows vs **68** repository migrations, yet canonical objects exist live (unrecorded ≠ absent). **Do not assume repository migrations can be replayed.**
- **No `db reset`, no broad `db push`, no automatic replay against production.** Every production change is a narrowly-scoped, reviewed, additive migration applied through the approved path, staging-first, canary-gated.
- **Staging is `OPEN_PREREQUISITE`.** No remediation migration touches production before a staging project (or approved dev branch) exists and the sequence below has rehearsed there.

## Staged sequence

### K.1 Repository consumer inventory (no DB)
Grep the repo for every consumer of the six legacy assignment RPCs and the three legacy credit functions, plus direct reads of `vendors` monetization columns and direct `whatsapp_logs` writes. Produce a consumer map (service/route/RPC → target authority). **This gates every revoke** — nothing is revoked before its consumers are known. Output: a consumer-inventory artifact (external review folder).

### K.2 Staging provisioning
Provision a separate Supabase staging project (or approved dev branch). Establish read-only + service-role credentials out-of-band. This is the mandatory unblock for everything downstream (matches QF-MVP-10 §J launch prerequisite).

### K.3 Live-definition snapshot comparison
Under process-enforced SELECT-only, snapshot live production object definitions (function bodies + MD5s already captured in QF-MVP-10 §D/§F, table/constraint/grant/RLS/index state) and diff against staging and the repository. Resolve the exact live lifecycle-status vocabulary for the active-set definition (§C.1) and confirm which objects truly exist (given `HISTORY_DRIFT`). No writes.

### K.4 Additive schema preparation (staging first)
Additive, non-breaking migrations only: `lead_assignment_events` (append-only history), `assignment_transactions` (idempotency), `replacement_requests` / `replacement_approvals`, `communication_intents` (or map to existing outbox), credit-restoration approval table, and the cap-enforcing triggers/partial indexes (§C.7) created in a non-enforcing/validate-first mode. Nothing dropped.

### K.5 Canonical authority deployment (staging)
Deploy `qf_assign_lead_vendors_v2` and the canonical credit authority (folding the strong parts of `qf_apply_vendor_credit_delta`, `assign_lead_to_paid_vendors_phase26a`, `assign_lead_to_vendors`) as **`service_role`-execute-only**. Legacy RPCs remain in place (not yet revoked). Deploy the public projection view (§I) unpopulated of grants yet.

### K.6 Compatibility adapters
Where a consumer cannot migrate immediately, provide thin deprecated shims (legacy name → canonical authority + mandatory ledger, §E.3.4) so no path loses ledger evidence during transition. Adapters are temporary and labeled.

### K.7 Consumer migration
Migrate each repository consumer (from K.1) to the orchestrator/`qf_assign_lead_vendors_v2` and the canonical credit authority; migrate public reads to `vendor_public_v`/DTO; migrate assignment comms to the intent boundary (§J). Verify on staging.

### K.8 Grant restriction
Only after K.1/K.7 prove consumers are migrated: `REVOKE EXECUTE` on the four public/anon SECURITY DEFINER assignment RPCs from `public, anon, authenticated`; revoke `anon` `SELECT` on `vendors` monetization columns (or revoke direct base-table read and force `vendor_public_v`). **First security priority**, but consumer-gated — as an immediate interim, route-level auth gates (§G) neutralize the bypass without dropping the RPCs.

### K.9 Legacy authority disablement
Transition the six RPCs to `deprecated_gated` / `superseded`; keep bodies present (rollback safety) with execute revoked from end-user roles. Legacy credit functions revoked/shimmed per §E.3.

### K.10 Historical ledger investigation (non-destructive)
Run the §F classification over the 27 gap assignments (5 admin / 16 auto / 6 client-selected) on staging/forensic data. Produce the classified evidence report. Any corrective/compensating ledger write is a **separate approved migration**, founder-signed, **never** blind, **never** in this phase. Indeterminate → manual review, no mutation.

### K.11 Public projection migration
Enforce the grant/RLS changes (§I) and point all public APIs at the safe projection. Add the no-leak regression tests (§L) to the gate.

### K.12 Canary verification
On staging, run the full acceptance matrix (§L), including concurrency and RLS/grant tests. Then a limited production canary (read-verification + a controlled, reversible slice) only after founder sign-off. Uncertain outcomes are never blindly retried.

### K.13 Rollback plan
Every step is additive and reversible: new objects can be dropped without touching legacy authority (still present until K.14); grant revokes can be re-granted; the engine can be feature-flagged off to fall back to the (still-present, now route-gated) legacy path. Snapshot before each production step; document the exact reverse migration. No `db reset`.

### K.14 Eventual legacy removal
Only after: zero repository consumers (re-verified), canary green over a defined window, historical ledger investigation closed, and founder sign-off — drop the deprecated legacy RPCs and legacy credit functions in a final reviewed migration. Migrations are never deleted without DB proof (QF-MVP-10 rule).

## Sequencing guardrails
- Order is strictly: inventory → staging → snapshot → additive prep → deploy canonical → adapters → migrate consumers → restrict grants → disable legacy → investigate ledger → projection → canary → (rollback ready) → eventual removal.
- No production migration automation (`apply_migration`/`db push`/`db reset`/`migration repair`) runs until the approved baseline strategy exists.
