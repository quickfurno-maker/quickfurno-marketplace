# VOX Owner Intelligence — controlled Staging rollout

Commit scope: single `GET /api/vox/v1/aos-health` read-only endpoint; reused existing Core AOS V2 Admin Snapshot; allowlisted aggregate projection. No new database tables, SQL migrations, automation execution, outbound dispatch, approvals, or agent activation.

Security gates: `VOX_AOS_HEALTH_ENABLED=staging` (default off); verified Supabase Owner/Superadmin bearer at AAL2; read-only methods GET only; response hides IDs, traces, prompts, memory and provider payload; unknown/unavailable AOS persistence reports UNAVAILABLE, not fake zero metrics.

Staging discovery 2026-10-29: `aos_runs` and `aos_recommendations` tables exist; zero rows currently; `aos_runtime_settings` has no AOS V2 shadow activation row. Observability endpoint may correctly report OFF while enabled for *reading*, without changing the actual AOS runtime. That is expected and must not be confused with agent activation.

Verification: `node scripts/mvp/vox/validate-vox-10-aos.mjs` 17/17 PASS; full TypeScript compile PASS. CI no-deploy workflow `vox-10-aos-source.yml` triggers on PR and validates the exact source. Additional no-auth API response must be 403 after Staging deploy; authenticated AAL2 Owner 200/allowlisted schema requires private browser verification.

Rollout: merge only after CI, build Core Staging exact SHA, isolated candidate with no-auth 503 before explicit flag, then on Staging only set the read-only AOS flag and perform protected public no-auth 403 postflight. Keep previous Core image + compose/env rollback. Then activate web `VOX_INTELLIGENCE_VIEW_ENABLED=staging` only after the protected Core route is proven and web build/tests pass. Production HOLD.
