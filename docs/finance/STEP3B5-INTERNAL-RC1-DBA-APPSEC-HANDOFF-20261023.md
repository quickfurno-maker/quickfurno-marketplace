# QuickFurno / VOX / Finance — Step 3B-5 internal RC1 and DBA/AppSec handoff

**Prepared:** 23 October 2026 · **Project:** QuickFurno Staging `uckafzuochmbvtiodmcl` · **Governance:** SOURCE/ISOLATED ONLY; managed Staging and Production **HOLD**. Owner action and independent signoffs **not yet obtained**.

## Executive disposition

This is a **technical internal release candidate**, not an approved deployment release. A genuine 22-Oct Staging 4-schema backup with SHA256 `E303BC25D904899459C56493F7D67B1960056DA4F4EAF78905B4F2F50AF75753` was previously restored offline, and Phase22 applied/reapplied to a network-isolated clone in 3B-4. In this 3B-5 batch, restored-clone negative tests covered inactive Admin and inactive/suspended/forged vendor ownership; exact source-only safety gates, dry-run Owner transition planner and permanently fail-closed legacy grant added. **No managed migration, Auth grant, MFA or payment actions.**

### Track A — authorization/RLS impact inventory

Current Staging SELECT-only policy inventory:
- `public.is_admin()` (SECURITY DEFINER, authenticated EXECUTE): **59 policies** across multiple domains; operation distribution **ALL 28 / SELECT 27 / UPDATE 3 / INSERT 1**. Only **3 of the 59** contain visible `is_active|status` text anywhere in the policy expression. Baseline helper `auth.uid()` + `profiles.role='admin'` returns **TRUE** for deactivated `profiles.is_active=false` if admin JWT remains valid. A *non-runnable, review-only* SQL candidate in `docs/finance/sql-review/20261023010000_step3b4_is_admin_active_guard_REVIEW_ONLY.sql` includes `is_active IS TRUE` and passes offline active TRUE/inactive FALSE/forged FALSE. **Candidate not deployed.** Assess effective RLS policy composition (permissive OR/restrictive AND), MFA and existing role/claims; do not treat profile revocation as sufficient until positive and negative tests pass.
- `public.owns_vendor(uuid)` (SECURITY DEFINER, authenticated EXECUTE): **22 policies**; operation distribution **SELECT 14 / INSERT 5 / UPDATE 2 / ALL 1**. **0 of 22** has status/suspension/approved text inside the policy SQL expression. Baseline ownership helper recognizes disabled or `status='Suspended'` vendor, if its `user_id` matches; synthetic transaction-only fixture on restored Staging clone reproduced this. *Review-only* `docs/finance/sql-review/20261023020000_step3b5_owns_vendor_status_guard_REVIEW_ONLY.sql` demands active and Approved status; tested active allow, inactive deny, suspended deny and forged owner deny on disposable clone. **DO NOT deploy wholesale** without deciding whether suspended vendors should retain access to invoices, existing leads, disputes/support and payout history. Distinguish `view_history` versus `create_new_work` permissions in a separately authorized design.
- `public.vendor_public_v` is publicly SELECT-granted and has default SECURITY DEFINER behavior; projects public vendor attributes with Approved, active, visible, credit-positive filters. Product/AppSec must confirm intended discoverability; no blanket revoke or invoker conversion.
- Existing Supabase lints (not introduced by this RC): one security-definer view ERROR, two authenticated-executable security-definer functions WARN, 102 RLS-enabled-without-policy INFO. No production security impact claimed without verified execution path.

### Track B — Owner bootstrap safety V2

The historical `scripts/grant-superadmin.mjs` used unsafe ordering (**Auth app_metadata grant → `profiles.role='admin'` → durable Phase22 role**), creating possible partial elevation. Its entrypoint is now **unconditionally disabled with a thrown security error BEFORE env loading, user creation, Auth Admin API calls or DB writes**; execution check exits 1. It cannot be accidentally used to grant privileged access under this RC.

The existing fail-closed read-only `scripts/owner-superadmin-bootstrap-preflight.mjs` plus new *pure* `scripts/owner-superadmin-transition-plan.mjs` form a **dry-run decision design**, never an execution engine. The planner requires matching Staging ID and exact Phase22 SHA, existing email-confirmed target account, active provider principal + profile, distinct DBA/AppSec reviewer records, exact scoped Owner authorization, valid legacy retirement and session revoke/break-glass plans, verified managed rollback, current identity epoch, recent evidence and unique replay reference. It **always outputs `authorizedToExecute:false`, `actualManagedMutation:false`, `crossSystemTransactionCertified:false`**, even with synthetic fully positive inputs, because real Auth API + PostgreSQL operations are not a single ACID transaction. Fault injection enumerates required compensations and never fakes an automatic rollback. **No user creation, privileges, or AAL2 changes.**

### Track C — exact Staging-only migration + recovery package

- Intended Phase22 source: `supabase/migrations/20261006113720_phase22_identity_portability.sql`, exact SHA256 **`6F53E1781E4D2BD277645ED17B2EB635BE70F1D2C4DF7525CD176DFB0C2F28BA`**. This hash must match immediately before separately authorized Staging-only execution.
- Supabase migration ledger: both managed environments record **86 versions** but only **34 common** (52 uniquely recorded in each); not evidence of equivalence. Seven legacy VOX SQL files are quarantined with pinned source digest and remain unapplied. Preserve **23 canonical candidate SQL files** plus seven quarantined; do not fake ledger repair, unquarantine sources or run general `db push`.
- Pre-migration snapshot: private 2,010,560-byte four-schema `pg_dump -Fc` from 22-Oct (public,auth,storage,supabase_migrations), tested by offline PG17 `pg_restore --single-transaction --no-acl --no-owner` with 86 migration records, two Auth users, 178 tables, 166 RLS tables, 74 policies, 212 functions, 75 triggers and 272 FKs (zero unvalidated). Four-schema restore and structural fingerprints **PASS**. It does **not** certify global roles/owners/grants, Auth provider live sign-in, storage object binaries, PITR, full-cluster recovery or row-by-row equality.
- Phase22 existing Staging clone application/reapplication/restore rollback were tested 3B-4. In this RC, managed Phase22 is **not installed** and no migration ledger row was inserted. Independently approved controlled migration mechanism, dynamic fresh backup, transaction timeout/lock plan, rollback stop criteria and post-apply catalogue/RLS/provider mapping login proof remain required.
- Reproducible SELECT-only pre/post catalogue script: `docs/finance/sql-review/STEP3B5-PHASE22-MANAGED-CATALOG-READONLY.sql` (no DDL/DML).

### Track D — disposable negative acceptance coverage

- Network-isolated disposable PG17 restored the exact 22-Oct Staging archive then applied Phase22. Transactional fixtures **ROLLBACK** all temporary profile/vendor changes.
- Admin current helper: synthetic Active **allow**, Inactive **incorrect allow**, spoofed subject **deny**. Non-runnable admin candidate: Active **allow**, Inactive **deny**, spoofed **deny**.
- Vendor current helper: synthetic linked Active Approved **allow**, Inactive **incorrect allow**, Suspended **incorrect allow**, spoofed owner **deny**. Review-only vendor candidate: Active Approved **allow**, Inactive **deny**, Suspended **deny**, spoofed owner **deny**. Real Staging vendor rows were not modified.
- Identity Owner state machine: forged/nonexisting email, missing mapping, wrong Auth claim, absent durable role, stale record, reviewer identity overlap, missing owner approval, missing backup/rollback, wrong project/hash, partial failure, replay reference and undefined fault **fail closed** in source tests. Real Auth AAL2/login, Team Leader bootstrap, client/agent provider integrations remain managed-environment acceptance items, not certified in offline clone.

### Track E — source tests and CI

- Existing VOX Core suite **507/507 PASS**; Finance focused **79/79 PASS**, Phase22 source **19/19 PASS**, 3B1 ledger validator PASS, 3B2/3B3 static evidence **12/12 PASS**, 3B4 evidence **15/15 PASS**.
- Owner read-only preflight **10** + new transition planner **17** = **27/27 PASS**.
- Step3B5 source-only HOLD guard **11/11 PASS**; no SQL candidates added to pinned VOX directory.
- Core TypeScript and VOX TypeScript **PASS**.
- This batch's exact-head GitHub CI must be checked on the final committed SHA; local green does not certify independent deployment.

## Track F — handoff and decisions for genuinely independent signoff

DBA reviewer must determine real managed role/ACL/default-privilege equivalence, secure full rollback beyond four-schema restore, migration provenance 52/52 differences, trigger changes and concurrent Auth signup risk, and signed approved Phase22 Staging-only cutover/rollback. AppSec reviewer must determine `is_admin` 59-policy safety and revocation behavior, `owns_vendor` 22-policy split for historical access vs new operations, public vendor view exposure, and legacy placeholder Superadmin retirement + real Owner AAL2/session invalidation. Owner separately must approve the exact Staging-only migration with dates/SHA and approve first Team Leader governance.

**No two-person approval recorded here. No signed independent DBA/AppSec decision. No approved managed Staging execution. No real Owner grant, MFA, Finance/Razorpay TEST charge or Production promotion. RELEASE HOLD.**

Reviewer handoff fields (intentionally blank; do not self-complete):
- DBA identity / signature / reviewed SHA / rollback approval: **PENDING**
- AppSec identity / signature / privileged placeholder + RLS decision: **PENDING**
- Owner explicit precise Staging-only authorization: **PENDING**
- Post-apply security QA, real AAL2 + Team Leader: **PENDING**
