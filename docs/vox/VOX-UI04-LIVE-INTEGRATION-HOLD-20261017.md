# VOX UI-04 — Actual Core protected workspace route, SOURCE-ONLY release hold (17 Oct 2026)

## What was wired
- New `GET /api/vox/v1/ui04-workspace` is a **real compiled Next.js Core route** in `app/api/vox/v1/ui04-workspace/route.ts`.
- It is disabled unless **all five** are exactly `staging`: `VOX_UI04_WORKSPACE_READ_ENABLED`, `VOX_STAFF_GRANTS_ENABLED`, `VOX_DEPARTMENT_ENFORCEMENT_ENABLED`, `VOX_WORK_QUEUE_READ_ENABLED`, `VOX_RIYA_CLIENT_CASE_READ_ENABLED`.
- The server derives identity only from `getVerifiedScopedStaff`: Supabase Auth getUser, verified JWT AAL2, current neutral Staff, membership, city/team, object and independently reviewed department grants. Only `support_agent` or `operations_manager` with `client_success` may use the initial combined view.
- The route **calls existing protected Core GET handlers** for `work-queue` and `riya-client-cases` with the same bearer; it does not impersonate a browser or trust a client's actor/team/city filters.
- `contracts/vox/ui04RouteFusion.mjs` validates source HTTP 200, application/json, no-store and bounded bodies, rejects partial responses, and runs `ui04UnifiedQueue.mjs` over the two independently authenticated readers. It returns only canonical work/conversation references, state and timestamps; no transcript, contacts, addresses, emails or mutations.
- The server **rechecks** staff authorization/current departments/object IDs on every object and compares current work state/revision and actor/city/team, or client state/revision/lead+zone and Google Place ID/coordinates. Missing/revoked metadata denies the full view.
- `POST`, `PUT`, `PATCH` and `DELETE` always return 405. No public dispatch, notification, staff grant or WhatsApp handler.

## Internal QA evidence
- `node --test scripts/mvp/vox/validate-voxUI04-route-fusion.test.mjs scripts/mvp/vox/validate-voxUI04-parallel-core.test.mjs`: **24/24 PASS** new focused tests (including forged PII, source 403, stale grants, non-JSON, cacheable response, oversized payload and flags-off).
- TypeScript `npm run typecheck`: PASS; `npm run build`: PASS with compiled protected Next route.
- Source-level full VOX regression should be rerun after final commit; new tests run by `.github/workflows/vox-ui04-core-runtime-readonly.yml`.
- Loopback-only Next standalone smoke at 127.0.0.1:3113 with synthetic INVALID Supabase env and all flags OFF: warmed `GET` HTTP **503** (`UI04_WORKSPACE_DISABLED`), mutation verbs HTTP **405**, `/livez` HTTP 200. Initial cold request took longer than 12 seconds, but the warmed response confirmed safe closed behavior. No real staging Auth/migrations were tested, no genuine credentials used.
- Previously separately isolated F1 PostgreSQL candidate `postgres:17-alpine --network none` append-only/RLS/denial checks passed; this is not an installed managed migration or evidence of real staff attribution.

## REMAINING external approval and genuine runtime gaps
1. Core Staff AAL2 authenticated staging session and approved first independent Team Leader bootstrap.
2. Reconciled original managed 86-row staging migration ledger, 25 version aliases and six source-only files, reviewed Auth/Storage recovery, DBA SQL/RLS/rollback signoff. Seven VOX migrations + AGNI 0008 still unavailable/uninstalled for real protected staging; do not manually copy or install the source candidate.
3. Durable source-specific Core-native writes: Aarohi free-text event actors, nullable support sender and conversation revision/state cannot be assumed attributable to authenticated Staff. Actual mutations must emit verified canonical events and DB transaction receipts. No historical backfill.
4. Genuine signed Core⇄Jarvis private pause/consent/handover, revoked grant end-to-end cases, notifications, EOD sealed source watermarks and human independent ACK, and real staff invite/suspension/revoke atomic workflows. These remain incomplete/not live.
5. Signed staging image, protected private deploy, live Auth/DB HTTP E2E, rollback, independent human AppSec review and final Owner GO/NO-GO. Cursor review and visual design review deferred by Owner.

**Status: source and isolated QA only, release HOLD.** No public `vox.quickfurno.in` activation, migrations, new staff identity, payment, matching or provider send.
