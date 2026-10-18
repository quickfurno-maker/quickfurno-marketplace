# VOX AB-8 — Native Service Desk atomic PostgreSQL 17 QA (18 October 2026)

**Status:** SOURCE-ONLY / DRAFT / RELEASE HOLD. This is isolated certification evidence for AB-7B; it is not managed-Staging or Production authorization.

## Exact source and coverage

- Base: AB-7B atomic Service Desk task worktree at `1d278f4c344a21b930090f73aaa6b4c5ed658872`, layered after AB-8 `16a47477d159b77d0846524d6b46557a025d6eda`.
- Native SQL candidate: `ops/vox/sql-candidates/20261018040000_vox_ab7b_support_task_atomic_candidate.sql`. SHA256 `52aa49f95f337a96f257d3866649f1fda925b9af24f85b418704743415186e14`. **Not installed in managed environments.**
- Companion native source SQL SHA256 `4b0334875b9b0e33d92640132049b3baf06adfe1cb10cc187396d3eaac884d47`.
- Reproducible isolated test: `pwsh -NoProfile -File scripts/mvp/vox/validate-voxAB7B-support-pg17.ps1`. Runs `postgres:17-alpine` in `--network none` disposable Docker, with synthetic schema, grants and actors; container cleaned in `finally`.
- Local result: **19/19 named checks PASS**, exit 0. First 11 retain synthetic CRM/Support/Conversation original-event → immutable F1 → one-use nonce proof. Eight additional checks cover authorized native Support Task creation, identical source-event/receipt, exact 1:4:4:4 canonical task/native/F1/nonce totals, idempotency replay, anonymous denial, revoked Staff object grant transactional rollback, closed support thread denial and unchanged ledgers.

## Security observations

- The original writer uses `SELECT ... FOR UPDATE` on `vendor_support_threads`, and `FOR SHARE` on `vendors` and `marketplace_service_zones`. The first disposable fixture incorrectly gave `service_role` only SELECT privileges and correctly failed on `vendor_support_threads`. The corrected **synthetic test-only** fixture explicitly grants locking privileges on those three tables; rerun passed. A real independent DBA must check exact managed ACLs and row-lock semantics; no managed grants were changed.
- Service-role RPC is restricted by the uninstalled candidate SQL. Real Supabase Staff AAL2, admin-vs-neutral identity, object/city/department grants, RLS and original source column compatibility remain protected staging tests, **not** certified by fixture data.
- No vendor/customer messages, wallet, lead assignment or provider transport are exercised by the suite. No first Team Leader bootstrap or independent approval is implied.
- This QA branch extends `.github/workflows/vox-ab8-integrated-release-hold.yml` to run the new 19-check disposable suite for relevant Core Support changes. **CI status must be checked on the exact pushed commit before claiming green.**

## Next integration gates

1. Align all native CRM/Support/Conversation original mutation hooks with canonical Core schemas and independent reviewed migration chain; no synthetic-only attribution in release.
2. Run isolated signed Jarvis consent/nonce handover, EOD official database writes, and internal notification worker lifetime tests alongside this suite.
3. Complete protected staging AAL2, human first Team Leader, independent DBA/AppSec, rollback and Owner GO/NO-GO in AB-9. **Release stays HOLD.**
