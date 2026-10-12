# VL-01 — Genuine Auth + Next HTTP certification

Status: source/isolated-stage engineering. Never conflate this test with production deployment, actual Supabase Cloud Auth or a graphical browser checkbox.

This test isolates the exact merged Core Next.js route `/api/admin/automation-studio`, starts a fresh PostgreSQL 16 database and a real Supabase GoTrue Auth v2.196 service in disposable local Docker containers, and uses real `@supabase/ssr` cookie/session signing and `auth.getUser()` rather than a mocked role. A tightly allowlisted local read-only REST adapter translates the tiny PostgREST query surface consumed by this route into the disposable PostgreSQL fixture; it is explicitly **not** the actual Supabase PostgREST service. The real Next.js route and production admin-identity resolution source execute in a local HTTP server.

## Commands and scope
- `node scripts/mvp/automation/certify-vl01-gotrue-auth-postgres.mjs` — genuine synthetic registration/session `/user` validation and disposable resource cleanup
- `node scripts/mvp/automation/certify-vl01-next-auth-http.mjs` — exact local Core Next HTTP route, genuine synthetic GoTrue sessions, disposable Postgres and allowlisted REST adapter; **9/9 assertions** on Windows, 12 Oct 2026
- CI workflow: `.github/workflows/vl01-real-auth-http.yml`; Docker-backed `ubuntu-latest`, `npm ci` exact lockfile, no external account secrets
- Both scripts generate ephemeral usernames and keys in process memory; Docker publishes service ports to 127.0.0.1 only and removes the synthetic containers and network after the run.

## Real HTTP assertions
1. Unauthenticated HTTP caller rejected.
2. Authenticated GoTrue vendor denied superadmin trace.
3. Genuine GoTrue superadmin identity (admin role in canonical profile, Superadmin in signed app metadata) resolves on actual Next route to a SQL-backed authorized trace.
4. Core authorization reported as an observation, not evidence of external Meta delivery.
5. Malformed job UUID rejected.
6. Correctly formed nonexistent UUID returns not found.
7. Malformed JSON rejected.
8. HTTP cache-control no-store.
9. Disposable PostgreSQL job row count unchanged.

## What this does not certify
- It is not a graphical browser click or real Supabase Cloud Auth project test; the local REST adapter mimics only the route's narrow PostgREST SELECT contract.
- It does not authorize or apply SQL migrations to staging/production, use real vendor identities, send WhatsApp messages, process payments, replay old jobs, or activate Anisha memory.
- It does not verify actual VPS source digest/configuration, live delivery receipts or AGNI alerts.
- A production release must retain the separate backup, exact migration-ledger, security signoff and owner authorization gates. The broader end-to-end blueprint remains in Notion.

## Evidence baseline
Previous VL-01 source PR #181 merged to Core main `0bb57ab04cb58ad83f514750fde3783f0fd18df8` with 19/19 applicable PR checks and all five post-merge workflows green; signed image `sha256:591211b7b97307b95db5528b66edb092d19d3502a7fa40d750319f8a98d6084f`. Existing SQL-backed mocked-session route 10/10 and synthetic permission migration 6/6 remain independent. The genuine local Next HTTP/GoTrue test adds a stronger identity + request-layer proof, not a replacement for actual production access.
