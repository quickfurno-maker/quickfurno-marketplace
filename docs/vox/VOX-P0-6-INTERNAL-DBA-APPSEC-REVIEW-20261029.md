# VOX P0-6 — Internal DBA/AppSec review checklist — 29 Oct 2026

This checklist is internal AI/operator evidence. It is not independent human certification.

## DBA review

- Forward change is one `CREATE OR REPLACE FUNCTION public.is_admin()` only.
- Signature remains zero-argument boolean, SQL, STABLE, SECURITY DEFINER, `search_path=public`.
- No migration rewrites/drops the 59 dependent policies.
- `CREATE OR REPLACE` is paired with an exact pre-change rollback candidate captured from managed Staging.
- Preflight and postflight queries are SELECT-only.
- Managed Staging precondition is 59 `is_admin()`, 22 `owns_vendor()`, 69 union.
- No `owns_vendor()` behavior is bundled.
- No historical migration file is edited.
- Rollback is function-only and restores the observed pre-change behavior.

## AppSec review

- Active admin remains allowed.
- Disabled and NULL-active admins fail closed.
- Role downgrade revokes same-session admin authorization because `is_admin()` queries `profiles` on each authorization evaluation.
- Missing profile and non-admin remain denied.
- Existing Auth/MFA/AAL2 enforcement remains a separate outer gate and is not weakened.
- SECURITY DEFINER / authenticated EXECUTE advisor warnings are acknowledged but intentionally not combined with this minimal behavior patch.
- `vendor_public_v` security-definer-view advisor error is tracked separately.
- No secret, provider, payment, marketplace, or Production action is bundled.
- Real Supabase Auth/AAL2 Staging validation remains mandatory before Production promotion.

## Required exact-head evidence before managed apply

1. `git diff --check` PASS.
2. P0-2 9/9 + P0-4 11/11 + P0-5 6/6 combined isolated PG17 PASS.
3. P0-6 migration candidate byte-for-byte reviewed.
4. Claude restricted read-only challenge review has no unresolved P0/P1 finding.
5. Branch pushed and exact-head GitHub Actions source-only workflow SUCCESS.
6. Notion updated with exact commit SHA and CI run.
7. Managed Staging preflight re-run immediately before apply; abort on unexplained drift.

## Managed gate

Do not apply to managed Staging until the Owner identity/MFA gate is ready for the real-auth regression. Do not apply to Production until Staging real-auth and 59-policy smoke evidence are green.
