# Step 3B-4 A–D — Internal Phase 22 Staging-clone rehearsal, Owner bootstrap preflight and security review

**Evidence date:** 23 October 2026 · **Status:** INTERNAL REHEARSAL COMPLETE; **INDEPENDENT APPROVAL AND MANAGED STAGING ACTIVATION HOLD**. This was requested with Cursor unavailable. No internal review is misrepresented as a second independent DBA or AppSec approver.

## Track A — Exact Phase 22 rehearsal on actual Staging clone — PASS (bounded)

- Source: actual **22-Oct** Staging four-schema archive `staging-public-auth-storage-migrationhistory-step3b2-20261022.dump`, 2,010,560 bytes, SHA256 **`E303BC25D904899459C56493F7D67B1960056DA4F4EAF78905B4F2F50AF75753`**, previously restored and certified offline. New disposable local Docker **`public.ecr.aws/supabase/postgres:17.6.1.147`**, container `qf-3b4-phase22-rehearsal`, **network none**, no published ports.
- Created empty local database `qf_step3b4_stage_clone`, installed Supabase local extension prerequisites, restored exact archive using `pg_restore --exit-on-error --single-transaction --no-owner --no-acl`, exit 0. Baseline had **2** Auth users, **2** Core profiles, **86** migration records, no Phase22 tables.
- Copied **exact** source `supabase/migrations/20261006113720_phase22_identity_portability.sql`, SHA256 **`6F53E1781E4D2BD277645ED17B2EB635BE70F1D2C4DF7525CD176DFB0C2F28BA`** into local container. **First apply exit 0**, **second idempotent reapply exit 0**, no duplicates.
- Post-apply: **2 principals**, **2 provider links**, **2 business/profile bindings**, **1 privileged legacy Superadmin durable role**, **4** Phase22 identity tables with RLS, **0** anon/authenticated direct SELECT grants, **4** service_role SELECT grants, and `public.handle_new_user` not executable directly by authenticated. Existing business rows remained 2 users/2 profiles. Existing RLS-policy-definition MD5 remains **`c9f988a3a64b83fb11d745f80333af88`**.
- Negative direct access on local clone: `SET ROLE authenticated` attempting to select `identity_admin_roles` failed; `SET ROLE anon` reading `identity_principals` also failed. **LIMITATION:** because original archive restored with `--no-acl`, local container rejected `public` schema access in those negative tests; this is not a substitute for verifying managed Supabase ACL/RLS.
- Offline **rollback-by-restore rehearsal PASS:** created separate local database `qf_step3b4_rollback_clone`, restored the **same pre-migration archive** with no Phase22 DDL applied, verified **2 Auth / 2 profiles / 86 migration records / Phase22 identity tables ABSENT**. This is a logical restore to a *different* local DB, **not** an in-place managed Staging rollback or PITR/full owner/ACL recovery. Clone apply via `psql` did not append a Supabase migration ledger entry (version remains **86**) and must not be reported as a managed migration deployment proof.

## Track B — Source-only Owner bootstrap hardening — mock PASS, execution NOT wired

- Existing source `scripts/grant-superadmin.mjs` **still unsafe** and **unmodified**: sets `auth.users.app_metadata.admin_role` first, then upserts `profiles.role=admin`, then attempts to resolve Phase22 principal/durable role. If an earlier step succeeds and later one fails, live grants may be left partially applied. Do **NOT RUN** until a separately authorized cross-service atomic/compensating design and reviewer signoff exist. The script even can create user with SEED_ADMIN_PASSWORD, which is not acceptable for this preexisting Owner-account migration.
- Newly integrated read-only `scripts/owner-superadmin-bootstrap-preflight.mjs` (initially drafted 22 Oct), enhanced to fail for a revoked existing durable admin role and a different existing target provider `app_metadata.admin_role`. No mutation routes. `scripts/owner-superadmin-bootstrap-preflight.test.mjs` now **10/10 PASS**, including nonexistent tables, missing principal, disabled principal, role conflicts/revocation, wrong email, unconfirmed email, inactive profile, inherited legacy authority and *no independent approval*. Pure mock tests; **not** a live Auth credentials test and **not connected to the unsafe grant script**. Flagged `independentApprovalVerified:false`, `atomicTransactionCertified:false`, `actualBootstrapApplied:false` deliberately.
- P0: Phase22 imports exactly **one** pre-existing Staging legacy Superadmin into durable `identity_admin_roles` while the new genuine Owner email stays neutral. Need independent approved old-account retirement, cutover, new Owner transition, rollback, MFA and session invalidation. Not performed.

## Track C — Adversarial internal AppSec findings

- Live Staging current `public.is_admin()` body checks only `profiles.id=auth.uid() AND role='admin'`; **does not enforce `is_active=true`**. It is referenced by **59** existing RLS policies; `authenticated` can execute. In an *offline restored clone*, a synthetic JWT subject was set for existing admin and its profile set `is_active=false` inside a transaction: **`is_admin()` still returned TRUE** after deactivation. Transaction was **ROLLED BACK** and original profile remained active. Live Staging has 0 inactive admins now, so risk is latent but reproducible. **HIGH internal finding**: profile deactivation alone is not a sufficient admin revocation in dependent policies.
- Created **non-runnable review-only SQL candidate** `ops/vox/sql-candidates/20261023010000_step3b4_is_admin_active_guard_REVIEW_ONLY.sql`. It adds `p.is_active IS TRUE` to the helper, qualifies schema and preserves intended authenticated EXECUTE. On the local clone ONLY it applied with exit 0; same synthetic JWT test returned `is_admin=true` for active admin, **FALSE for inactive admin**. Its database effects are confined to the isolated clone. Do not move into runnable migrations or deploy until broader RLS use (59 policies), legacy role behavior, and role/ACL review pass. This candidate does NOT fix privileged placeholder transition.
- `public.owns_vendor(uuid)` checks only `vendors.id = p_vendor_id AND user_id = auth.uid()`; it is referenced by **22** RLS policies and does **not** check vendor active/suspended/approved state. All **27** existing Staging vendor records have `user_id=NULL`, so an actual linked vendor revocation scenario could not be meaningfully certified from current Staging data without synthetic fixture. Internal review required to determine whether downstream policies add the necessary checks; do not blindly change.
- Existing `public.vendor_public_v` has default view-owner/security-definer behavior and is SELECT-granted to `anon` and `authenticated`. SELECT projection includes only public business attributes; WHERE filters approved, active, visible and positive-credit vendors. The ability to bypass base RLS may be intentional for marketplace discovery; P1 independent intentional-publicity and data-exposure review before `security_invoker` changes.
- Supabase native Staging security lints remain 1 definer-view ERROR, 2 executable-definer-function WARN, 102 RLS-no-policy INFO. These are preexisting; do not silently repair permissions with uncontrolled DDL.
- Seven Oct14 VOX migration files remain intentionally quarantined, with pinned SHA256 7/7; old runnable-tree validator remains red at 169 vs 162. Staging/Production each have 86 recorded migrations but only 34 shared versions; independent ledger/schema-meaning classification remains P0.

## Track D — Continuous internal QA

- Source-only Owner bootstrap preflight mocks: **10/10 PASS**.
- Phase22 static/source certification: **19/19 PASS**.
- Step3B1 live-version inventory + seven quarantined SHA pins: **PASS**.
- Step3B2/3B3 immutable restore/security evidence validator: **12/12 PASS**.
- Finance focused tests: **79/79 PASS**; **NO Razorpay real money/provider actions**.
- Core Next TypeScript typecheck: **PASS**. VOX Web TypeScript typecheck: **PASS**.
- Phase22 real Staging-clone apply, reapply and logical rollback: **PASS** in network-isolated disposable PG17.
- Exact-head GitHub CI to be verified after commit; this does **not** constitute security/DBA approvals.

## Required next gates

1. Independent DBA/AppSec review: precise Staging migration hash, historical divergence, live schema owners/global role/ACL/dump scope, revocation P0, duplicate Auth trigger behavior, rollback protocol and session safety. Can supply this internal package to independent reviewer later; cannot self-attest.
2. After review, Owner explicitly approves `20261006113720` **Staging-only** promotion. Install through controlled signed migration mechanism, verify live managed catalog roles/RLS and end-to-end Auth; do not run legacy bootstrap now.
3. Separately authorized multi-system Owner bootstrap (existing `quickfurno@gmail.com` account, not create new), genuine AAL2 MFA, independent first Team Leader bootstrap. Then Finance V2/Razorpay TEST and rollout readiness.

**NO STAGING OR PRODUCTION CHANGES. NO ADMIN ROLE CHANGE. FINANCE RELEASE HOLD.**
