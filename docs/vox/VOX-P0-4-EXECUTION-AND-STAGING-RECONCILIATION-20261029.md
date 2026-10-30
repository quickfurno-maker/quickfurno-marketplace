# VOX P0-4 — Internal execution and managed Staging reconciliation receipt — 29 Oct 2026

## Status

**P0-4 internal evidence: PASS.**
**Managed Staging/Production mutation: NONE.**
**P0-2 `is_admin()` candidate deployment: still HOLD.**

This receipt records operator-side verification performed after the source-only Claude task. It is internal AI/operator evidence, not independent human DBA/AppSec certification.

## A. Disposable PostgreSQL 17 execution

Executed on JARVIS from:
`D:\QuickFurno-Workspace\Worktrees\qf-vox-claude-p0-4-rls-20261029`

Commands:
- `ops/security/tests/invoke-vox-p0-2-admin-rls-pg17.ps1`
- `ops/security/tests/invoke-vox-p0-4-admin-rls-session-transitions-pg17.ps1`

Environment controls observed in both runners:
- disposable `postgres:17-alpine`
- `--network none`
- no published ports
- repository mounted read-only
- `ON_ERROR_STOP=1`
- cleanup always stops/removes the container
- SQL fixtures end in `ROLLBACK`

Results:
- P0-2 baseline: **9/9 PASS notices**, no assertion failure, final rollback.
- P0-4 session-transition fixture: **11/11 PASS notices**, no assertion failure, final rollback.
- P0-4 covered active-admin SELECT/INSERT/UPDATE; active→disabled same-session revoke; disabled→active same-session restore; admin→nonadmin same-session revoke; active→NULL fail-closed; denied UPDATE under representative `FOR ALL` RLS.

## B. Corrected source inventory

Independent recount found an off-by-one error in the draft matrix: section 2.2 contains 15 rows, not 14.

Correct source-snapshot figures:
- `is_admin()`: **103** distinct policy names
- `owns_vendor()`: **21**
- helper union: **111**
- `FOR ALL`: **70**

The matrix document was corrected in-place. No migration/source runtime file was changed.

## C. Managed QuickFurno Staging read-only catalog

Project: QuickFurno Staging (`uckafzuochmbvtiodmcl`), PostgreSQL 17.6.1.

Current `public.pg_policies` helper catalog:
- union: **69**
- `is_admin()`: **59** across **40 tables**
- `owns_vendor()`: **22** across **15 tables**
- both helpers: **12**
- command shape: **28 ALL / 32 SELECT / 6 INSERT / 3 UPDATE / 0 DELETE**

This confirms the previously stated Staging 59/22 figures.

## D. Source ↔ Staging reconciliation

### `owns_vendor()`

Exact reconciliation:
- shared source+Staging: **17**
- source-only: **4**
- Staging-only: **5**

Source-only policies not currently live:
1. `assign owner update`
2. `vendor_package_orders owner read`
3. `vendor_package_orders owner insert`
4. `vendor_profile_change_requests owner insert`

Staging-only policies absent from this source snapshot:
1. `vendor_lead_activity_logs vendor read own`
2. `vendor_lead_report_comments vendor insert own`
3. `vendor_lead_report_comments vendor read own`
4. `vendor_lead_reports vendor insert own`
5. `vendor_lead_reports vendor read own`

Important live-state notes:
- `vendor_package_orders` exists in Staging with RLS enabled but currently has **no policies**.
- `lead_assignments` currently has `assign admin all` and `assign owner read`; the source `assign owner update` policy is not present live.
- `vendor_profile_change_requests` currently has admin/owner **read** policies but no owner insert policy.

### `is_admin()`

Current Staging contains **59** helper-dependent policies. Source contains **103**.

Four Staging admin policies are not represented in the source matrix:
1. `vendor_lead_activity_logs admin all`
2. `vendor_lead_report_comments admin all`
3. `vendor_lead_reports admin all`
4. `vendor_profile_change_requests admin read`

The source snapshot contains **48 admin policy names not currently live**. Large contributors are the AOS management foundation and the CRM analytics + placeholder policy generators. The CRM analytics duplicate-policy concern is **not live today**: Staging has no matching CRM admin / admin-placeholder policy objects on those ten source tables.

Net conclusion: the source checkout and managed Staging are materially different policy snapshots. The candidate remains mechanically relevant to every live policy that actually calls the same zero-argument `public.is_admin()`, but source counts must never be substituted for live counts.

## E. Live helper-function truth

Managed Staging currently defines:
- `public.is_admin()` = profile `id = auth.uid()` AND `role = 'admin'`; **no `is_active` condition yet**.
- `public.owns_vendor(uuid)` = vendor `id` + `user_id = auth.uid()`; unchanged.

Both are:
- SQL, STABLE
- `SECURITY DEFINER`
- `search_path=public`
- executable by `authenticated`
- not executable by `anon` or `PUBLIC`

Therefore the P0-2 candidate has **not** been applied to managed Staging.

## F. Current Supabase security-advisor context

Read-only security advisors currently report:
- 102 RLS-enabled tables with no policy (INFO; many are deliberately service/internal shaped but require table-by-table disposition)
- `public.vendor_public_v` security-definer view (ERROR)
- `public.is_admin()` and `public.owns_vendor(uuid)` authenticated-callable SECURITY DEFINER functions (WARN)

These are existing security-posture items. Do not “fix” them by blindly revoking EXECUTE because RLS policies depend on these helpers. Any hardening must preserve policy execution and be separately tested.

## G. P0-4 verdict

P0-4's intended internal work is complete:
- source inventory exists and corrected
- P0-2 baseline rerun PASS
- P0-4 extended PG17 regression PASS
- live Staging 59/22 catalog verified read-only
- source/live drift reconciled enough to explain the 21↔22 vendor mismatch and identify admin live-only/source-only drift
- duplicate CRM source-policy risk checked against Staging and confirmed **not currently installed**
- no managed changes performed

**P0-4 can be marked internally complete.**

The next implementation is not another inventory pass. It is a bounded P0-5 promotion-readiness packet for the `is_admin()` candidate: exact migration/rollback proposal, real Supabase Auth/AAL2 regression matrix, protected Staging apply gate, and post-apply 59-policy smoke verification. Production remains blocked until that Staging evidence is green.
