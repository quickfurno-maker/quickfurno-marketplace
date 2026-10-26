# VOX-06C — Protected, real Supabase Auth and Core read-only acceptance

**Status: prepared in source, NOT run on a live QuickFurno staging environment; no release authority.**

The existing Core endpoint guards remain OFF until independent DBA/security approval and installation of the VOX Staff/work schema. This runner cannot change them.

## Independent prerequisites

1. One selected, independently reviewed canonical Staff authority SQL/HTTP chain (only ONE of the legacy and new department systems) and reconciled immutable 86/86 migration history.
2. Genuine isolated backup/restoration of actual protected QuickFurno Staging; independent DBA approval and verifiable signing evidence.
3. Independently human-approved first Team Leader, tested MFA and one-use Core bootstrap nonce; existing Core Superadmin remains the sole Owner/Admin.
4. Protected staging Core at exactly `https://staging-core.quickfurno.in`, reviewed enabled read-only flags and synthetic Auth users with six distinct **real** tokens for: AAL1; foreign city AAL2; cross-team AAL2; revoked AAL2; missing independent reviewed department AAL2; valid exact-scope AAL2. Keep tokens in protected operator secret storage, not GitHub, chat, Notion or logs.
5. Protected operator provides `VOX_STAGE_QA_EXPECTED_ORIGIN=https://staging-core.quickfurno.in`, `VOX_STAGE_QA_APPROVAL_ACK=EXTERNAL_REVIEWER_SIGNED_SEPARATELY` and six corresponding `VOX_STAGE_QA_*_TOKEN` secrets. The ACK text is only a **configuration guard**; it does NOT cryptographically attest an independent reviewer. Human credentials/signature evidence must be separately checked.
6. Explicit controlled command: `node scripts/mvp/vox/run-vox06c-protected-staging.mjs --protected-read-only`.

## Test paths and expected results

The runner issues **nine GET-only requests** to pinned Core. Anonymous, AAL1, foreign city, cross-team, revoked Staff and missing department must receive 401/403; the authorized Staff must receive 200 from `/api/vox/v1/work-queue`, `/api/vox/v1/desk` and `/api/vox/v1/my-work`. The positive responses must match current Core schema, bounded masked metadata and `actionsEnabled:false`. Any unapproved status, redirect, oversized response, malformed schema, executable action flag or provider data causes a fail-closed result.

**What the suite does NOT test:** privileged write approvals, first TL creation, actual WhatsApp consent/send, Google Place geofencing and 3-vendor matching, Riya/Anisha/Aarohi signed Jarvis handover, AGNI controlled actions, migration backup/restore, canary/rollback. Those remain independent P0 suites. A green outcome always sets `releaseAuthorized:false`.

GitHub CI runs only controlled mock response tests and an unconfigured no-network dry run. It never fetches protected secrets or contacts staging.
