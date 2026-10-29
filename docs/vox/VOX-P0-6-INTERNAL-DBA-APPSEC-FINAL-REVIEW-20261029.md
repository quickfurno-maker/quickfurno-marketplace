# VOX P0-6 — Internal DBA/AppSec final review — 29 Oct 2026

**Verdict: PASS_WITH_NOTES for source freeze and protected-Staging readiness.**

This is AI/operator review evidence, not independent human certification. Managed Staging mutation remains gated on Owner real-auth/MFA validation readiness.

## Evidence reviewed

- Managed Staging live catalog: 59 policies call `is_admin()`, 22 call `owns_vendor()`, union 69.
- `public.is_admin()` owner `postgres`; SQL/STABLE/SECURITY DEFINER; `search_path=public`; authenticated EXECUTE=true; anon/PUBLIC=false.
- Exactly 1 admin profile exists in Staging; it is active. Disabled admin profiles=0; NULL-active admin profiles=0.
- `profiles.is_active` is nullable boolean default `true`; `IS TRUE` therefore fails closed on NULL.
- Latest captured Staging migration frontier: `20261013144901 vendor_profile_approval_atomic_v3_staging_20261013`.
- `public` schema CREATE is denied to anon/authenticated/PUBLIC, reducing object-shadowing risk for the existing `SECURITY DEFINER ... search_path=public` helper.
- PostgreSQL documents that `CREATE OR REPLACE FUNCTION` preserves function ownership and permissions; local P0-6 proof independently verifies the expected EXECUTE grants survive replacement.

## Test evidence

- P0-2 baseline: 9/9 PASS.
- P0-4 same-session transitions: 11/11 PASS.
- P0-5 forward/rollback: 6/6 PASS.
- P0-6 exact migration candidate: 8/8 PASS, including function properties and grant preservation plus rollback.
- Combined isolated PostgreSQL 17 execution: **34 asserted PASS checks**, network none, no managed credentials, final rollback.
- `git diff --check` clean at pre-freeze validation.

## Severity findings

### P0

None found.

### P1

None found in the scoped `is_admin()` change.

### P2 — accepted / separately tracked

1. Supabase advisor warns that `public.is_admin()` and `public.owns_vendor(uuid)` are authenticated-callable SECURITY DEFINER functions. For this patch, revoking EXECUTE is unsafe because RLS policies depend on these helpers. Their bodies return authorization booleans only and browser roles cannot CREATE in `public`. Deeper helper relocation/private-schema redesign is separate hardening debt.
2. Supabase advisor reports `vendor_public_v` as a security-definer/owner-rights view. Source and live evidence show this is intentional: anon has no direct `vendors` SELECT/INSERT; the view exposes a fixed 21-column allowlist and only Approved + active + public_visibility + credited rows; view writes are denied. Treat the advisor error as an explicit design exception, not an unreviewed exposure.
3. 102 Staging tables have RLS enabled with no policies (advisor INFO). RLS therefore defaults to deny for ordinary browser roles. This is not an authorization bypass; feature-specific reachability still needs review when each internal feature is activated.

### P3 — operational notes

1. Source snapshot and Staging policy catalogs materially differ; live counts must be re-read immediately before apply.
2. Claude read-only challenge review was attempted in parallel but its local 5-hour quota was exhausted. No Claude PASS is claimed or used as release evidence.
3. Human DBA/AppSec review remains deferred by Owner and is not represented as completed.

## Forward/rollback design decision

- Forward managed change: one `CREATE OR REPLACE FUNCTION public.is_admin()` adding `AND is_active IS TRUE`.
- No `owns_vendor()` change and no per-policy rewrite.
- Exact rollback body is captured.
- If forward is recorded in the managed migration ledger and rollback becomes necessary, rollback must be a **new later migration**, not removal/rewrite of migration history.
- Real Supabase Auth/AAL2 Staging validation remains mandatory before Production promotion.

## Release disposition

Internal source work may be committed/pushed and run through exact-head CI. Protected Staging apply remains HOLD until Owner identity/MFA is ready for immediate real-auth regression. Production remains HOLD until the Staging apply, real-auth matrix and live 59-policy smoke are green.
