# VOX RC38 Core: vendor-task-transition has no fallback write path

Route: `app/api/vox/v1/vendor-task-transition/route.ts`

## Change
- The service-role compare-and-set fallback (reads of `vendor_tasks`/`vendors`/`marketplace_service_zones`, then `update vendor_tasks`) that ran when `VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED` was absent is **removed**. The route has no `.from()` calls and no direct table writes.
- All three flags must equal exactly `"staging"`, checked **before** any header, Auth or request-body access:
  `VOX_VENDOR_CRM_TASKS_ENABLED`, `VOX_VENDOR_TASK_TRANSITIONS_ENABLED`, `VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED`.
  Absent, empty or any other value returns `503 VENDOR_TASKS_DISABLED`.
- The only writer is the RPC `qf_vox_core_vendor_task_transition_atomic_candidate_v1`. Any RPC error, missing function or malformed result fails closed (403/409/400/503 mapping unchanged); there is no retry through another path.
- Staff AAL2 / role / scope checks (`getVerifiedScopedStaff`) are unchanged.

## Status (honest)
- The RPC SQL is still **review-only** at `ops/vox/rc37-review-candidates/` and is **not installed**. Until DBA installs it and the flags are deliberately enabled, this endpoint returns 503. That is intended.
- No flag was enabled; no migration, manifest or workflow was changed.
- The executed DB proof remains `validate-vox-rc37-core-vendor-task-transition-atomic-pg17.ps1` (CI only; not run locally).

## Tests
- `rc38-core-vendor-task-transition-no-fallback.test.mjs` (new): 9^3-1 flag combinations, request-access spy, positives, RPC-failure negatives, source guards.
- `rc35-core-vendor-task-transition.test.mjs` and `rc37-core-vendor-task-transition-atomic.test.mjs`: revised; CAS-assuming tests replaced with no-fallback proofs.
- CI note: `.github/workflows/vox-rc17-six-tracks-hold.yml` globs `rc17`..`rc37` only; adding `rc38-*.test.mjs` there is outside this Core change and still needed.
