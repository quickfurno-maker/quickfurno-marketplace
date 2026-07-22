# QF-MVP-20 — Staged Migration Plan (section K)

**Branch:** `mvp/qf-mvp-20-marketplace-engine-v1` · **Type:** DESIGN ONLY — no migration file is created, no DB is accessed, nothing is applied.
**Evidence baseline:** QF-MVP-10 reconciliation. Companion: [`QF-MVP-20-AUTHORITY-REPAIR-DESIGN.md`](QF-MVP-20-AUTHORITY-REPAIR-DESIGN.md), [`QF-MVP-20-ACCEPTANCE-TEST-PLAN.md`](QF-MVP-20-ACCEPTANCE-TEST-PLAN.md).

## Hard constraints

- Production shows **`HISTORY_DRIFT`**: only **4** migration-history rows vs **68** repository migrations, yet canonical objects exist live (unrecorded ≠ absent). **Do not assume repository migrations can be replayed.**
- **No `db reset`, no broad `db push`, no automatic replay against production.** Every production change is a narrowly-scoped, reviewed, additive migration applied through the approved path, staging-first, canary-gated.
- **Staging is `OPEN_PREREQUISITE`.** No remediation migration touches production before a staging project (or approved dev branch) exists and the sequence below has rehearsed there.

## Staged sequence

### K.1 Repository consumer inventory (no DB) — ✅ COMPLETE (QF-MVP-20.1)

The consumer audit is done and recorded in [`QF-MVP-20-CONSUMER-CALL-PATH-AUDIT.md`](QF-MVP-20-CONSUMER-CALL-PATH-AUDIT.md). It replaces the earlier assumptions with audited `file:line` evidence. Authoritative consumer map:

- `assign_lead_to_paid_vendors_phase26a` → `leadDeliveryService.ts:54` (auto-match; service-role).
- `assign_lead_to_vendors` → `leadService.ts:373` (via `assignLead` public `app/actions.ts:167` **[auth gap]** + `adminAssignLead` superadmin `:685`); **writes `whatsapp_logs` in-txn**.
- `admin_smart_assign_lead_to_vendors` → `manualLeadAssignmentService.ts:471` (superadmin) + `delayedLeadFillService.ts:444` (secret cron); **un-ledgered**; caller `p_total_limit` up to **9** (`manualLeadAssignmentService.ts:314`).
- `assign_client_selected_vendor_to_group` → `clientRequirementGroupService.ts:619` (public `sendClientSelectedVendorEnquiry` `app/actions.ts:179→250`); **un-ledgered**.
- `assign_vendor_to_requirement_group` → `clientRequirementGroupService.ts:371` (public + superadmin processors); **un-ledgered**.
- `assign_lead_to_preferred_vendor` → `preferredVendorLeadService.ts:256` (public funnel) + `delayedLeadFillService.ts:425` (cron).
- `qf_apply_vendor_credit_delta` → `vendorCreditWalletService.ts:53` (canonical, ACTIVE_SAFE).
- `deduct_vendor_credit` / `restore_vendor_credit` / `increment_vendor_credits` → **no direct `.rpc()`**; invoked only inside the legacy assignment RPC bodies (retire after those bodies are replaced).
- Direct `vendors`/`whatsapp_logs`/`vendor_credit_logs` writes: mapped in the audit §7 (credits/ledger have **no** direct TS writer — RPC-only; `whatsapp_logs` written only inside `assign_lead_to_vendors` SQL + the `whatsapp-dispatch` edge fn).

**Unresolved consumers that remain revoke-blockers** (must be closed before the matching revoke): (a) the live RPC-body question (migrations 141–145 applied? — audit §16.1) determines whether the "ledgered" paths are truly ledgered; (b) `whatsapp-dispatch` edge-fn deploy/schedule state (audit §16.2); (c) `assignLead` server-action invocability without a UI caller (audit §16.3). Until each is proven, its dependent revoke stays **NOT READY**.

### K.2 Staging provisioning — ✅ PROVISIONED (QF-MVP-20.2A)
Staging project `QuickFurno Staging` (ref `uckafzuochmbvtiodmcl`, `ap-southeast-1`, `ACTIVE_HEALTHY`) is provisioned and **EMPTY** (0 public tables, 0 migration-history rows, no production data). This unblocks the staging-first path. The **staging baseline** — how to reconstruct the current production public schema on staging safely — is audited in [`QF-MVP-20-STAGING-BASELINE-AUDIT.md`](QF-MVP-20-STAGING-BASELINE-AUDIT.md) and planned in [`QF-MVP-20-STAGING-BASELINE-PLAN.md`](QF-MVP-20-STAGING-BASELINE-PLAN.md) (QF-MVP-20.2A). Baseline generation/apply is QF-MVP-20.2B; **no baseline SQL exists yet**.

### K.3 Live-definition snapshot comparison — ✅ EVIDENCE CAPTURED (schema-only dump)
The current production **public** schema was captured as a schema-only `supabase db dump` (external, SHA256 `269c9265…`) and audited in 20.2A. It **resolves the 20.1 §16.1 "which body is live" unknown** for the assignment RPCs: the live `assign_lead_to_paid_vendors_phase26a` / `assign_lead_to_vendors` / `assign_lead_to_preferred_vendor` bodies are the **ledgered** versions; `admin_smart_assign_lead_to_vendors`, `assign_client_selected_vendor_to_group`, `assign_vendor_to_requirement_group` are **un-ledgered** (deduct_vendor_credit, no `vendor_credit_logs`). MD5 parity against QF-MVP-10 §D/§F is a 20.2B check. Counts match QF-MVP-10 (62 tables / 39 functions / 33 SECURITY DEFINER / 0 triggers). No writes; the dump is not committed to Git.

### K.4 Additive schema preparation (staging first)
Applied **after** the reviewed staging baseline (20.2B). Additive, non-breaking migrations only: `lead_assignment_events` (append-only history), `assignment_transactions` (idempotency), `replacement_requests` / `replacement_approvals`, `communication_intents` (or map to existing outbox), credit-restoration approval table, and the cap-enforcing triggers/partial indexes (§C.7) — noting production has **0 enforcement triggers today** (audit §6), so these are net-new. Nothing dropped.

### K.5 Canonical authority deployment (staging)
Deploy `qf_assign_lead_vendors_v2` and the canonical credit authority (folding the strong parts of `qf_apply_vendor_credit_delta`, `assign_lead_to_paid_vendors_phase26a`, `assign_lead_to_vendors`) as **`service_role`-execute-only**. Legacy RPCs remain in place (not yet revoked). Deploy the public projection view (§I) unpopulated of grants yet.

### K.6 Compatibility adapters
Where a consumer cannot migrate immediately, provide thin deprecated shims (legacy name → canonical authority + mandatory ledger, §E.3.4) so no path loses ledger evidence during transition. Adapters are temporary and labeled.

### K.7 Consumer migration
Migrate each repository consumer (from K.1) to the orchestrator/`qf_assign_lead_vendors_v2` and the canonical credit authority; migrate public reads to `vendor_public_v`/DTO; migrate assignment comms to the intent boundary (§J). Verify on staging.

### K.8 Grant restriction — consumer-gated (audited prerequisites)

Consumers are now fully mapped (K.1), so the ordered grant-restriction sequence is:

1. **Interim app-gate (no revoke, do first):** guard the two public entries that reach a blocker RPC — `sendClientSelectedVendorEnquiry` (`app/actions.ts:179`) and `assignLead` (`app/actions.ts:167`). This closes the *app* bypass immediately without touching grants.
2. **Migrate credit consumers** (B1–B4, audit §10) onto the canonical ledger authority — a revoke of the un-ledgered RPCs must not strand an un-migrated debit path.
3. **Deploy `qf_assign_lead_vendors_v2`** (service-role only) + migrate assignment consumers (K.7).
4. **`REVOKE EXECUTE ... FROM public, anon, authenticated`** on the four blocker RPCs (`admin_smart_assign_lead_to_vendors`, `assign_client_selected_vendor_to_group`, `assign_vendor_to_requirement_group`, `assign_lead_to_preferred_vendor`) — this closes the residual **direct-PostgREST** bypass the app cannot fix.
5. **Revoke `anon SELECT`** on `vendors.{total_credits,remaining_credits,paid_status,package_name,package_status,package_expires_at}` (or revoke direct base-table read and force `vendor_public_v`).

**Revoke-readiness rule (hard):** a revoke for RPC *X* is marked READY **only when every consumer of *X* in K.1 is migrated and verified on staging**. Today **no revoke is READY** — the unresolved consumers in K.1 (live-body question, edge-fn state, `assignLead` invocability) plus the pending consumer migration keep every revoke **NOT READY**. Interim app-gating (step 1) is the only action available now.

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
