# QuickFurno VOX — Claude P0-3: real LOCAL GoTrue-backed Owner Auth integration tests
Work only in this worktree and branch `feat/vox-claude-p0-3-auth-20261029` based on PR #421 SHA `f8ef5873d0a4bdbbc064dd6850df60e395f8ffd6`. Independent of P0-4, PR #422 and live VPS.

## Purpose
Replace limitations of the **synthetic** fixture with a repeatable **real but LOCAL/disposable Supabase GoTrue-issued token** test for the actual Owner-only Core GET route. The source-only fixture suite 02b/02c remains unchanged. Differentiate local-GoTrue verification from real Owner MFA session and live Staging 200; NEVER claim Staging/Production AAL2 certified.

## Baseline evidence
- Actual read-only Core route `app/api/vox/v1/overview/route.ts`, `services/vox/verifiedStaffBearer.ts`, `lib/supabase.ts`.
- Existing offline source test `scripts/mvp/vox/validate-vox-02c-owner-auth200.harness.mjs` uses mocked Supabase and fake unsigned JWT, passed 6/6; cannot prove real getUser(token).
- Working *reference* for genuine disposable GoTrue+PostgREST+PG+Next HTTP test: `scripts/mvp/automation/certify-vl01-real-auth-http.mjs`. Read before designing. It uses ephemeral Docker, loopback only, generated synthetic secrets, no real accounts and cleanup, official pinned container images. Do not copy production credentials.
- Owner-only PR #419 and #421 remain DRAFT, no signed image, no live Staging Core route (it still 404), Owner TOTP enrollment exists but live Owner AAL2 positive HTTP 200 is not verified.

## First implementation (separate non-deploy test suite)
1. Inspect existing real-auth harness, package dependencies and how actual Core `verifySupabaseBearerUser` calls Supabase Auth `getUser(token)`, `auth.mfa` and Owner role profiles.
2. Add a new source-only **local GoTrue validation harness** under `scripts/mvp/vox/` (and fixtures if necessary). Use synthetic users/rows, ephemeral localhost-bound GoTrue+PostgREST+PG or proven equivalent, genuine signed GoTrue-issued JWT and real getUser over localhost; test at least anonymous, malformed, AAL1, expired/revoked (when supported) denial. Include positive AAL2 **only if actually authenticated via local GoTrue MFA**; do not fake local AAL2, promote jwt claim without server verification or weaken production auth. If doing real MFA is not feasible, mark that case BLOCKED and leave no fake pass.
3. Source-safety: explicit hard fail if any managed SUPABASE_URL/DATABASE_URL/service_role secret present, never read/write Production/Staging or issue provider calls; temporary port bound only to localhost, containers cleaned in finally; PIN container images and no auto publishing.
4. Add a new **no-deploy** workflow ONLY if local runner is reliable; no runtime secret/environment, signing/merge, managed DB writes or provider network.
5. Keep precise docs `docs/vox/VOX-P0-3-AUTH-QA-20261029.md`: tested vs untested; how operator executes and interprets evidence.

## Execution limits for this Claude session
Code-only file edits in this worktree; no Bash, PowerShell, terminal, Docker, network, managed DB tools, remote GitHub or VPS. Do not run tests yourself; operator independently validates. Avoid touching production route/auth source unless strictly required and explained. Don't edit outside worktree, don't commit/push/deploy. If too broad, create the smallest useful executable test and document missing local AAL2 without inventing a green result.
Return precise changed files and operator commands.
