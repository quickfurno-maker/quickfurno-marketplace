# QuickFurno VOX — Claude P0-4: RLS regression matrix and local policy tests
Work only in this worktree and branch `feat/vox-claude-p0-4-rls-20261029` based on PR #422 SHA `de8f533e7f6a8880d4d72189c285bead8c6ab443`. Separate from P0-3 and Owner Core.

## Purpose
Expand confidence in the **NONDEPLOYABLE** `is_admin() AND profiles.is_active IS TRUE` candidate. Existing `ops/security/sql-candidates/vox_p0_2_is_admin_active_candidate.sql` plus synthetic `ops/security/tests/vox_p0_2_admin_rls_pg17.sql` and PowerShell runner + GitHub CI passed **9/9**. In managed Staging 59 RLS policies depend on is_admin(), 22 on owns_vendor(). Do not touch live DB.

## Task
1. Read original `supabase/migrations/20260620000002_rls_policies.sql` and other source policy files, the existing candidate and test runner, and `docs/vox/VOX-P0-2-RLS-CANDIDATE-20261029.md`.
2. Create a **source-derived** inventory matrix `docs/vox/VOX-P0-4-ADMIN-POLICY-MATRIX-20261029.md`: policy / table / command / USING / WITH CHECK / admin helper / vendor helper, including any `FOR ALL` policies. Label source-only counts distinct from the verified *managed Staging catalog* counts 59/22; don't invent that source snapshot accounts for all live policies.
3. Add isolated PG17 regression tests (extend or create new SQL fixture under `ops/security/tests`) checking positive active admin SELECT + write, active→disabled in same session revokes, disabled→active restores, admin→nonadmin revokes, NULL inactive fails, and denied UPDATE with representative policies. Test `is_admin()` using real zero-arg function and auth.uid shim; no weakened test model, no dependence on production data.
4. IMPORTANT: Don't change `owns_vendor()` or historical reads, no per-policy managed SQL migration and no sweeping policy rewrite. Surface unresolved behavior as explicit follow-up risk.
5. If adding tests, update **source-only** P0-2 CI workflow to run them, including invalid state denial and cleanup, but never add environment secrets, deployment, signing or live data access.
6. Report actual changed files, expected operator commands and verification limitations. Do not claim tests passed until operator reruns.

## Execution limits
Claude: worktree file tools only, no Bash/PowerShell/DB/Docker/remote tools. No managed Staging/Production changes, PR merges, providers, credentials or protected-runtime bypass. Do not modify unrelated source, don't commit/push, don't edit other worktrees. Human paid security review explicitly deferred by Owner; AI reviews never represent independent human certification.
