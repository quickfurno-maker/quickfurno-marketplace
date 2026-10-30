# VOX P0-5 — `is_admin()` Staging promotion-readiness packet — 29 Oct 2026

## Objective

Prepare the already-tested P0-2 `public.is_admin()` hardening for a **future protected Staging-only apply** without changing managed Staging or Production in this work.

The behavioral change remains intentionally minimal:

`admin role` **AND** `profiles.is_active IS TRUE`

No `owns_vendor()` change is bundled.

## Prepared source artifacts

Forward candidate:
- `ops/security/sql-candidates/vox_p0_2_is_admin_active_candidate.sql`

Exact observed-baseline rollback candidate:
- `ops/security/sql-candidates/vox_p0_5_is_admin_rollback_candidate.sql`

Rollback proof:
- `ops/security/tests/vox_p0_5_is_admin_forward_rollback_pg17.sql`
- `ops/security/tests/invoke-vox-p0-5-is-admin-forward-rollback-pg17.ps1`

CI source-only workflow:
- `.github/workflows/vox-p0-2-admin-rls-source-only.yml`
- now runs P0-2 baseline, P0-4 session transitions, and P0-5 forward/rollback proof in one network-isolated PostgreSQL 17 container.

## Verified local evidence

- P0-2: **9/9 PASS**
- P0-4: **11/11 PASS**
- P0-5: **6/6 PASS**
- all fixtures ended in `ROLLBACK`
- disposable Docker uses `--network none`
- no managed credentials or live data used

P0-5 proves:
1. exact current Staging baseline treats a disabled profile with role=admin as admin;
2. forward candidate keeps active admin allowed;
3. forward candidate revokes disabled admin;
4. forward candidate keeps non-admin denied;
5. exact rollback restores the baseline disabled-admin behavior;
6. rollback preserves active-admin allow and non-admin deny.

## Current managed Staging precondition

Read-only truth captured 29 Oct 2026:
- `public.is_admin()` still has no `is_active` predicate.
- 59 current RLS policies call `is_admin()`.
- 22 current RLS policies call `owns_vendor()`.
- function is SQL/STABLE/SECURITY DEFINER with `search_path=public`.
- authenticated has EXECUTE; anon/PUBLIC do not.
- the source CRM duplicate-policy set is not installed live.

A future apply must abort if these preconditions have materially drifted.

## Protected Staging apply design

When authorized later, use a **new proper migration** generated at that time from the reviewed forward candidate. Do not move this source candidate into `supabase/migrations` early.

Before apply:
1. confirm exact project is QuickFurno Staging, never Production;
2. re-read `pg_get_functiondef(public.is_admin())`;
3. re-count helper-dependent policies;
4. confirm rollback candidate matches the then-current pre-change function;
5. capture current migration frontier and database recovery evidence;
6. keep external providers/workers disabled for the VOX security change window.

Apply only the single `CREATE OR REPLACE FUNCTION public.is_admin()` change. Do not rewrite 59 policies individually.

## Required post-apply Staging verification

Immediately after a future authorized apply:
1. `pg_get_functiondef` contains `role='admin'` and `is_active is true`;
2. function signature, stability and grants remain expected;
3. current 59-policy fan-out remains intact unless independently reviewed drift explains a new count;
4. active admin retains expected SELECT/INSERT/UPDATE routes;
5. disabled admin with the same valid session loses admin RLS immediately;
6. NULL-active admin fails closed;
7. non-admin remains denied;
8. missing profile remains denied;
9. no policy objects are added/dropped by the function-only migration;
10. Supabase security advisors show no new regression caused by this change.

## Real-auth / AAL2 gate

The database helper keys off `auth.uid()` and a live `profiles` lookup, not a cached role claim. Therefore the same-session revoke behavior should not require token refresh, but managed Staging still needs a genuine Supabase Auth validation before Production promotion.

Use separate governed principals:
- active admin / Owner
- disabled test admin
- non-admin Staff
- vendor test principal where relevant

For protected admin web/API actions, preserve the existing AAL2 gate independently from this database helper. Do not weaken MFA to make the RLS test pass.

## Rollback trigger and procedure

Rollback if an expected active admin is unexpectedly denied, policy calls produce permission errors, or any unexplained live policy drift appears after apply.

Rollback is the exact pre-change function body captured in:
`ops/security/sql-candidates/vox_p0_5_is_admin_rollback_candidate.sql`

For managed migration-ledger safety, P0-6 also prepares `ops/security/sql-candidates/vox_p0_6_is_admin_staging_rollback_migration_candidate.sql`. If rollback is ever required after an applied forward migration, use a **new later migration** based on that candidate; never delete or rewrite the already-applied forward migration history row.

After rollback:
- verify active admin allowed;
- verify the pre-change disabled-admin behavior is restored;
- re-read function definition and policy count;
- keep Production promotion blocked and investigate.

## Security items intentionally not bundled

Current Supabase advisor findings for authenticated-callable `SECURITY DEFINER` helpers and `vendor_public_v` are separate AppSec decisions. Do not combine helper relocation, EXECUTE-grant changes, `search_path` redesign, view conversion, or `owns_vendor()` behavior changes into this minimal `is_admin()` patch.

Combining them would make rollback and authorization impact harder to reason about.

## P0-5 status

**SOURCE PREPARATION + DISPOSABLE ROLLBACK PROOF COMPLETE.**
**MANAGED STAGING APPLY NOT PERFORMED.**
**PRODUCTION APPLY NOT AUTHORIZED.**

Next managed implementation, after the remaining identity/review gate is satisfied: generate the one-function migration from the reviewed candidate, apply to protected Staging only, run the real-auth matrix plus 59-policy smoke, then issue a separate Production go/no-go receipt.
