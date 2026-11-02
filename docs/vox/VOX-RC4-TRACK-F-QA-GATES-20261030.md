# VOX RC4 Track F — Continuous source and genuine auth QA (30 Oct 2026)

**Status: SOURCE-ONLY / RELEASE HOLD.** The QA orchestrator can exercise local tests and collect read-only evidence, but source QA never proves real managed Staging. A missing genuine user, database migration, signed image, or Auth session is **BLOCKED**, not PASS.

## Implemented checks

`scripts/mvp/vox/rc4-qa-lib.mjs` defines strict PASS/FAIL/BLOCKED statuses and excludes misleading partial success. `rc4-qa-orchestrator.mjs` executes local source suites and optional local-only Auth HTTP probes with loopback URL restrictions; child processes receive an allow-listed environment without secrets. It validates the pinned 30 SQL source digests, release HOLD gate shapes, malformed unsafe SQL, and 401/403/200 local HTTP behavior when genuine test principals are configured. Persisted reports redact JWTs and token-like content. Production-hosted URLs and remote Supabase access are forbidden. `rc4-qa.test.mjs` tests fail-closed aggregation and forged-success rejection.

A dedicated `.github/workflows/vox-rc4-qa-source-gate.yml` workflow uses read-only permissions, pinned Actions, no secrets, and a source-only orchestrator; it must never authorize a release or interpret a blocked real-Auth probe as authenticated production proof.

## Commands

`node --test scripts/mvp/vox/rc4-qa.test.mjs`

`node scripts/mvp/vox/rc4-qa-orchestrator.mjs --mode source-only --out test-results/vox-rc4/qa-report.json`

`node scripts/mvp/vox/rc4-qa-orchestrator.mjs --mode full` only when the approved disposable GoTrue/PostgREST/PostgreSQL stack and genuine test MFA principals are provided via ephemeral loopback-only context. This command never modifies managed environments.

## Remaining gates

Must still verify actual managed Staging Owner/Team Leader/Staff AAL2 identities, cross-role 401/403/200, revoked same-session access, city/team isolation, real API CRUD, navigation, signing/consent workflows and rollback on the approved signed Core/Web images. Staging and Production changes remain HOLD pending independent qualified human DBA/AppSec and Owner GO.
