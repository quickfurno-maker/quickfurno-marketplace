# VOX Tracks A–E — JARVIS isolated local execution evidence — 2026-10-31

**Candidate:** Draft PR #450, branch `feat/vox-rc6-operational-20261030`, tested base `0821bd8475743dd9a67b358026b6589589c9b9ef`.

**Scope:** authorized JARVIS desktop, Docker Desktop Linux engine, isolated synthetic PostgreSQL/GoTrue environments. No managed Supabase/Staging/Production mutation; no provider payment, refund, credit grant, outbound WhatsApp or official signed EOD. Native operational writers and managed finance migration remain hard-OFF/review-only.

## Track A — Database disaster recovery

Executed `powershell -File scripts/mvp/vox/validate-vox20-isolated-recovery.ps1` from the isolated PR worktree. Exit code **0**:

`VOX20_ISOLATED_PG17_SEVEN_MIGRATION_RESTORE_PASS migrations=7 vox_tables=10 rls_tables=10 profiles=2 cities=2 sha256_verified=true privileges_preserved=true restored_anon_denied=true live_staging_backup=false live_staging_modified=false`.

This demonstrates seven quarantined VOX migrations and synthetic archive restore, **not** full managed Supabase/Auth/Storage/Vault restoration or authorization for managed migration.

## Track B — Finance V2

Real disposable PostgreSQL 17 execution:

`VOX_RC17_REAL_PG17_RAZORPAY_V2_PASS funcs=5 exact_once_credit=true test_live_fenced=true claim_replay_denied=true browser_rpc_denied=true provider_calls=0`.

No real Razorpay calls, no real credits, and no managed migration installation. The independent refund/consumed-credit reconciliation policy and operational provider settlement remain subject to review.

## Track C — Core and Staff

Real disposable PostgreSQL 17:

- `VOX_RC12_REAL_PG17_AB7B_F1_SOURCE_ATOMIC_PASS`
- `VOX_RC12_REAL_PG17_CLIENT_REVIEWED_PROJECT_SCOPE_PASS`
- `VOX_RC8_CORE_REAL_PG17_VENDOR_CONSENT_WRITER_PASS`

Local GoTrue/PostgREST/Postgres authentication: `VOX_03_REAL_LOCAL_GOTRUE_OWNER_AUTH_PASS 8 passed, 0 blocked, 0 failed`, including actual TOTP AAL2, expired-token and deleted-user denial. The test-only synthetic identities do not establish enrolled human Staff or activate canonical managed AB7B writers.

## Track D — EOD

Real disposable PostgreSQL 17: `VOX_RC8_REAL_PG17_SIGNED_INTENT_PASS`; synthetic Owner/TL keys, replay/tamper denial and current actor checks. Explicit `official_eod=false production_gate=false`. Human signer ceremony and official publication still pending.

## Track E — Continuous QA

- Root RC17–20 source contracts **47/47 PASS**.
- Root `npm run typecheck` **PASS**.
- `apps/vox-web/npm test` **PASS**, including guarded CRM, Staff, Owner, vendor and UI routes.
- `apps/vox-web/npm run typecheck` **PASS**.
- Prior exact-branch production Web build and source-only suite also documented in `docs/vox/VOX-RC-LOCAL-DISPOSABLE-CERTIFICATION-20261031.md`.

These tests do not constitute browser E2E against managed Staging and do not prove all operational features are live.

## Unrelated concurrent local activity

A separate untracked `scripts/mvp/vox/validate-vox-rc21-legacy-v1-parser-pg17.mjs` and associated `qf-vox-rc21-v1-parser-pg17` container appeared while testing. They were **not created or validated** in this A–E execution and were intentionally not modified, killed, staged, or certified.

## Deployment and release verdict

**HOLD**: full managed Supabase-compatible recoverable restore and migration rehearsal, actual Staging Staff/Owner MFA and roles, real provider settlement/refunds/consumed-credit policy, native Core writer authorization/consent integration, genuine human EOD signing/publication, independent DBA/AppSec and Staging functional acceptance remain open. GitHub Actions queued status cannot be converted to PASS from local results. PR #450 remains Draft.

This document records directly observed local evidence only. No managed Staging/Production approval or deployment is claimed.
