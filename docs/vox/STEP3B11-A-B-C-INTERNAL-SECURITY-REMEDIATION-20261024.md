# VOX 3B-11 A/B/C — Source-only guarded security closure checkpoint (24 Oct 2026)

**Environment:** JARVIS isolated worktree `D:\QuickFurno-Workspace\Worktrees\qf-vox-step3b11-20261024` on branch `test/vox-step3b11-audit-20261024`; pinned baseline commit `593b9dc17970a44ca987108997ae6ab0544dede2`. No managed Staging/Production DDL, roles, authentication, passwords, payments, DNS or provider messages changed.

## 11A — DBA migration reconciliation: seven exact versions
Machine-readable reviewer queue `ops/vox/certification/STEP3B11A-SEVEN-VERSION-DBA-TRIAGE-20261024.json` lists per-conflict statement counts, byte lengths, rollback array counts and SQL-array SHA-256 in both environments. Seven confirmed different fingerprints despite same version ID:
`20260801152049`, `20260905000000`, `20260906000000`, `20260910060000`, `20260918120000`, `20260921054654`, `20260921055639`.
34 shared versions in source ledger: 26 fingerprint matches, 7 different and 1 blank (`20260817000000`). 104 environment-only ledger occurrences; all 72 missing Git SQL paths have data in managed ledger statement arrays but raw SQL is not extracted or reviewed. **Do not confuse fingerprint/count differences with proven semantic inequality; qualified DBA needs confidential SQL comparison and full ACL/PITR/storage/Auth recovery review before approval.** No reviewer assigned or signed.

## 11B — AppSec guard prototype; no managed changes
`ops/vox/sql-review/STEP3B11B-HELPER-STATUS-GUARDS-REVIEW_ONLY.sql` proposes active-profile `is_admin()` and approved/active `owns_vendor(uuid)` plus **optional** historical read helper. The historical path is **not** an approved blanket access policy; it requires domain and AppSec decision per table (invoices/refunds/disputes). Default PUBLIC function grants are revoked; needed role grants must be explicit/approved. Existing function argument name `p_vendor_id` must be preserved for PostgreSQL CREATE OR REPLACE compatibility.

**Genuine locally isolated PG17.10 proof, not synthetic-only:** `scripts/scale/step3b11b-pg17-rls-isolated.sql` and local-only script `scripts/scale/run-step3b11b-isolated-pg17.ps1` ran a 127.0.0.1-only scratch PG17 test cluster. Verified legacy helper permits inactive Admin audit insertion and suspended Vendor new-work reads, whereas proposed helper blocks inactive Admin audit reads, preserves active Admin audit reads+insert, blocks suspended Vendor new work, allows active Vendor own work, denies cross-vendor reads. Under an *explicit offline-only grant* a suspended Vendor could read immutable historical records by a separately scoped policy. Two initial negative failures (inconsistent existing input parameter name, missing history helper execute grant) were corrected before final offline PASS. The tests use mocked public data and **do not prove managed effective RLS across all 69 policies or real Staff MFA**. Scratch server shut down; test evidence in JARVIS command logs.

## 11C — Final source chain, still draft
GitHub snapshot at 24 Oct: stacked draft PRs #402 `12eb177f` -> #403 `e52a3055` -> #404 `0b17ec8d` -> #405 `3bf66045` -> #406 `593b9dc1`. All five were observed open, unmerged, draft and mergeable; last reviewed #406 exact-head 5/5 workflow success, but that is NOT future PR #407 CI. Machine readable checkpoint `STEP3B11C-UNSIGNED-STACK-CHECKPOINT-20261024.json` keeps all release grants false, new final SHA intentionally unset, final signed image digests absent. Must independently certify any new source PR and real signed Core/VOX/Jarvis/AGNI deployment versions.

## Open protected release blockers
- Qualified **human independent DBA**: 104 environment-only versions, seven conflicting shared-version SQL fingerprints, all 72 original SQL bodies via confidential custody, full role/ACL/PITR/physical storage/Auth restore, signed rollback.
- Qualified **human independent AppSec**: all 69 RLS policies/40 tables (37 write/ALL, 53 on multi-policy tables), direct grants, SECURITY DEFINER function owner, historical reads, stale JWT and real auth privilege; signed exact SQL before managed application.
- Real Owner exact-SHA Staging-only GO, genuine verified MFA, initial Team Leader separately approved bootstrap.
- Approved managed VOX + Finance migrations; signed compatible Core/VOX/Jarvis/AGNI staging build; real Staff/Agent/Finance E2E and Razorpay TEST; separate Production GO.
- **Managed Staging, Production, privileged Auth, real money, DNS and external messages remain HOLD.**
