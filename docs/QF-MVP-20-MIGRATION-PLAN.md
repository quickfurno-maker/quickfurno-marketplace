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

### K.4b Staging baseline generated (QF-MVP-20.2B) — outside the migration chain
The reviewed staging baseline SQL is **generated** (offline; not applied) at `supabase/staging-baseline/20260722000100_qf_mvp_staging_baseline_269c9265.sql` (SHA256 `920a4aa0…`), with a SELECT-only verifier `verify_qf_mvp_staging_baseline.sql` (SHA256 `e82b757f…`, current; supersedes `89362a35…` per QF-MVP-20.2C1R identity-scoped function parity). It is deliberately **outside `supabase/migrations/`** so `supabase db push` can never discover it, and it strips production ownership/grants/default-privileges, locks the four blocker RPCs + legacy credit primitives + `qf_apply_vendor_credit_delta` to service_role-only, and grants anon **no** table/monetization access. See [`QF-MVP-20-STAGING-BASELINE-REVIEW.md`](QF-MVP-20-STAGING-BASELINE-REVIEW.md).

**Migration-history invariants (unchanged):** production migration history is **not modified**; no fake rows; the 68 repository migrations are **not** replayed and **not** marked applied. The baseline applies (in 20.2C) under **one** controlled identity `qf_mvp_staging_baseline_269c9265`; all QF-MVP-20 remediation is **forward-only** after it. Production HISTORY_DRIFT repair remains a separate, still-open production decision. **20.2C application gate:** target ref must be `uckafzuochmbvtiodmcl` (never `yqpgcsduqbxulrlzwzap`), staging empty (preflight-enforced), verify SQL all `PASS`.

### K.4d Staging baseline APPLIED AND VERIFIED (QF-MVP-20.2C2R) ✅
The corrected SELECT-only verifier (`7ba9792f…`, supersedes `e82b757f…`) returns **40/40 PASS** against staging. Function parity is proven by **exact `to_regprocedure` OID resolution** (39 found / 0 missing / 0 duplicate-or-unresolved / 33 SECURITY DEFINER / 1 managed / 0 unexpected / 40 total) and index parity by **`pg_constraint.conindid` classification** (77 constraint-backed, 180 standalone, 32 standalone unique, 47 combined, 257/109 catalog totals). Structure, privilege lockdowns, zero-data, provider inactivity and the single truthful history row all PASS. Corrections were **offline**; **no `db push`, no reapplication, no reset/repair, no migration-history change, no staging write, no production access**. Baseline SQL unchanged (`920a4aa0…`). Advisors read (staging only) — none blocking; `multiple_permissive_policies`, `unindexed_foreign_keys`, `auth_rls_initplan`, `duplicate_index` and the permissive `leads public insert` policy are **K.5 / QF-MVP-20.3A remediation candidates**. **K.5 is now unblocked.**

### K.4c Staging baseline APPLIED (QF-MVP-20.2C2) — initial verification `FAILED_REQUIRES_REVIEW` (superseded by K.4d)
The reviewed baseline was applied to **staging only** (`uckafzuochmbvtiodmcl`) with a single `npx supabase db push --linked` (**exit 0**), creating **one** honest migration-history row: version `20260722000100`, name `qf_mvp_staging_baseline_269c9265` (821 statements). **Production migration history was not touched**; the 68 repository migrations remain unrecorded and unreplayed; no reset/repair/seed/retry occurred.

**Verification: 24 PASS / 6 FAIL** → the phase is **not** complete. The failures are expectation defects in the verification artifact (`pg_get_function_identity_arguments` returns `argname type`; `pg_indexes`/`indisunique` include constraint-backed indexes), not schema defects — standalone indexes measured **180** and standalone unique **32**, matching the reviewed inventory. Correcting the verification artifact and re-running to all-PASS is the gate before **K.5**. See [`QF-MVP-20-STAGING-BASELINE-APPLICATION-RESULTS.md`](QF-MVP-20-STAGING-BASELINE-APPLICATION-RESULTS.md).

### K.4e Remediation release designed (QF-MVP-20.3A) — K.5 now specified
The canonical authority deployment (K.5) is fully specified by [`QF-MVP-20-3A-REMEDIATION-MIGRATION-DESIGN.md`](QF-MVP-20-3A-REMEDIATION-MIGRATION-DESIGN.md) + [`SCHEMA-CONTRACT`](QF-MVP-20-3A-SCHEMA-CONTRACT.md) + [`CONSUMER-MIGRATION-MATRIX`](QF-MVP-20-3A-CONSUMER-MIGRATION-MATRIX.md) + [`STAGING-TEST-PLAN`](QF-MVP-20-3A-STAGING-TEST-PLAN.md) + [`ROLLBACK-PLAN`](QF-MVP-20-3A-ROLLBACK-PLAN.md). It is **five separate forward-only migrations**, not one:

- **A — foundation (additive):** `lead_assignment_events` (append-only lineage, non-cascading FKs, sole unique constraint `UNIQUE (event_idempotency_key)`), `assignment_operations` (idempotency), `replacement_requests`, `credit_restoration_approvals`, `communication_intents`; additive columns on `lead_assignments` (`lifecycle_status` + 3) and `vendor_credit_logs` (approval ref, idempotency key, trusted actor) with a widened `change_type` CHECK.
- **B — canonical authority (enforcing):** `qf_assign_lead_vendors_v2` (no caller-controlled limit), `qf_apply_credit_mutation_v2`, `qf_request_replacement_v2`, `qf_approve_credit_restoration_v2`, `qf_vendor_assignment_eligible`, plus the **3 enforcement triggers** (active-3, lifetime-6, lineage-immutable).
- **C — public projection + privilege hardening (restrictive):** `vendor_public_v` (explicit allow-list, `security_invoker`), anon monetization revoke, duplicate-index cleanup.
- **D — Auth trigger restoration (independent):** `auth.users → public.handle_new_user`, idempotent, deliberately decoupled.
- **E — legacy revokes (restrictive, last):** REVOKE only, **no DROP**, only after zero legacy callers is proven.

**Ordering rule:** A → migrate consumers → B → C → E (so legacy writers never meet a trigger they can violate), unless staging proves legacy paths already satisfy the caps. **Grant/revoke sequence is unchanged from K.8** and remains consumer-gated; the public no-auth `assignLead` action must be **removed** before E. The 27-row historical ledger gap is explicitly **out of scope** here and is assigned to **QF-MVP-20.4 — Historical Credit-Ledger Reconciliation** (no blind backfill; indeterminate ⇒ no mutation).

### K.4f Decisions closed (QF-MVP-20.3A1) — final release order is binding
SELECT-only reconciliation of **production and staging** closed every remaining decision; see [`QF-MVP-20-3A1-DECISION-CLOSURE.md`](QF-MVP-20-3A1-DECISION-CLOSURE.md). The release order below **supersedes** any earlier ordering and fixes the inversion in which consumer migration preceded canonical-authority deployment:

**A** (foundation) → **A2** (reviewed data backfill: historical rows → `assigned`; one `assignment_created` lineage event per qualifying assignment, idempotent via `ON CONFLICT (event_idempotency_key) DO NOTHING`) → **B1** (canonical RPCs; legacy retained; **no triggers**) → **R1** (runtime consumer release) → **B2** (enable the 3 enforcement triggers after zero-legacy proof) → **C** (public projection; **revoke anon on `leads` and `vendors`**; drop the always-true `leads` INSERT policy) → **D** (Auth trigger) → **E** (legacy EXECUTE revocation) → **QF-MVP-20.4** (historical reconciliation) → later legacy removal.

### K.4g A / A2 / B1 GENERATED AND REVIEWED (QF-MVP-20.3B1 + 20.3B1R) — `GENERATED_REVIEWED_NOT_APPLIED`

The first three steps now exist as reviewed, forward-only files. Full record and object deltas: [`QF-MVP-20-3B1-MIGRATION-GENERATION-RESULTS.md`](QF-MVP-20-3B1-MIGRATION-GENERATION-RESULTS.md).

| Step | File | SHA256 | State |
|---|---|---|---|
| **A** | `supabase/migrations/20260723000100_qf_mvp_marketplace_authority_foundation.sql` | `b6307094…` | GENERATED_REVIEWED_NOT_APPLIED |
| **A2** | `supabase/migrations/20260723000200_qf_mvp_assignment_lineage_backfill.sql` | `9d77f446…` | GENERATED_REVIEWED_NOT_APPLIED |
| **B1** | `supabase/migrations/20260723000300_qf_mvp_canonical_assignment_authority.sql` | `a4b5c378…` | GENERATED_REVIEWED_NOT_APPLIED |
| Phase verifier | `supabase/staging-verification/verify_qf_mvp_20_3b1.sql` | `688ab439…` | SELECT-only, 58 checks |
| Offline validator | `scripts/mvp/staging/validate-qf-mvp-20-3b1.mjs` | `4497a3c0…` | PASS 105/105 |

Locked baseline `920a4aa0…` and baseline verifier `7ba9792f…` are **unchanged**; the baseline verifier was not converted into a forward-migration verifier.

**Two design contradictions were resolved by founder decision before authoring** (both had blocked an earlier attempt at this step):

1. **A2 operation model.** `assignment_operations.lead_id` stays `uuid NOT NULL`, so a single global batch row spanning many leads is structurally impossible. A2 creates **one operation per distinct qualifying lead**, keyed `qf_mvp_20_a2_lineage_backfill_v1:<lead_id>`; the shared batch identity is retained in metadata. This **supersedes** every earlier requirement for one global batch operation row. Counts are derived at runtime and never hardcoded — the frozen 46/24 evidence is documentation, not an assertion.
2. **Audit model.** `public.audit_logs` is **absent** from the applied baseline (created only by drifted migration `20260621000006`), so it is neither created in A nor written in B1. `assignment_operations`, `lead_assignment_events`, `vendor_credit_logs`, `credit_restoration_approvals` and `communication_intents` are the authoritative domain audit evidence, and B1 **completes the `assignment_operations` result** in place of the separate audit step.

Also locked: `source_kind = 'migration_backfill'` (never `'backfill'`), and `source_reference = 'legacy_assignment_seed_v1:<assignment_id>'`.

**Deliberately excluded from these three files:** every B2 enforcement trigger (none created, none defined) · all Migration C work (`vendor_public_v`, `vendor_wallet_package_divergence_v`, anon revokes, policy replacement, duplicate-index removal) · Migration D's `auth.users` trigger · Migration E's legacy revocations · any `audit_logs` object · any suspension or restoration **mutation** path (the five `vendors` suspension columns are inert storage that B1 only reads).

**QF-MVP-20.3B1R review corrections (three of four contracts changed):**

1. **Replay is no longer key-only.** `assignment_operations` gains `request_fingerprint text NOT NULL` plus a terminal-completion CHECK, and B1 compares a normalized fingerprint (lead, mode, deduplicated and sorted candidates, reason code, replacement reference, actor). Same key + same request replays the persisted result with `already_applied=true`; same key + **different** request returns **`idempotency_conflict`** with zero mutation; an `in_progress` or vanished claim returns `conflict_retry`. No branch recomputes eligibility or mints a new id.
2. **`ASSIGNMENT_CREDIT_COST = 1` is a single locked authority** — no caller parameter, no `app_settings` read, no `vendor_packages` inference, no variation by mode, no clamping.
3. **`client_selected` mode fails closed** as `R1_BLOCKED_PENDING_OWNER_BINDING`. The schema has no lead-to-client ownership binding and no canonical phone normalizer, so the mode is refused before any write rather than authorised by phone equality. **R1 must add an explicit ownership binding before the mode can be activated.**
4. **Audit model confirmed unchanged** — no `audit_logs` created or written; A2 fabricates no ledger evidence and the 27 historical gaps stay untouched.

**Baseline-validator reproducibility is RESOLVED.** The approved external production schema source was located, hashed to the required `269c9265…`, and `validate-staging-baseline.mjs` returned **PASS**. The `BLOCKED_EXTERNAL_EVIDENCE` status carried by 20.3B1 no longer applies, so **B1P is not blocked on it**.

**QF-MVP-20.3B1P staging application preflight: PASSED** ([record](QF-MVP-20-3B1-STAGING-APPLICATION-PREFLIGHT.md)). Staging proven as the only linked target; 20/20 SELECT-only precheck items as expected; the locked baseline verifier re-executed verbatim to **40 PASS / 0 FAIL**; `migration list --linked` shows 1 remote / 4 local / 3 pending; and one `db push --linked --dry-run` returned exit **0** proposing **exactly** A → A2 → B1 and nothing else. A post-dry-run SELECT-only sweep proved zero schema and zero data change. **A/A2/B1 remain unapplied.** The next step is QF-MVP-20.3B1A, whose prerequisites are enumerated in §17 of the preflight record.

**Consequence for production planning:** applying A/A2/B1 to production **closes no existing production exposure**. The anon privileges on `leads`/`vendors` and the anon-executable blocker RPCs remain until C and E respectively. A2 additionally mutates production data (lineage rows) and requires founder sign-off separately from the schema DDL.

**Production evidence driving this (SELECT-only, this task):** production `lead_assignments` matches the staging baseline exactly; 46 rows, all `vendor_status='New'`, all `credit_deducted=true`, 0 nulls/orphans/duplicates, max 3 rows and 3 distinct vendors per lead (so the caps are satisfiable, but legacy `p_total_limit=9` flows would break — hence the B1/B2 split); the **27-row ledger gap is reconfirmed exactly**; `vendor_packages` has **0 rows** (wallet is already the sole balance); the **four blocker RPCs are live-verified `PUBLIC/anon/authenticated = true` in production**; and **anon holds `INSERT/SELECT/UPDATE/DELETE/TRUNCATE` on `leads` and `vendors`** with an always-true `leads` INSERT policy permitting 17 internal columns to be set — the largest open exposure, closed by C and E.

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
