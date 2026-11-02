# VOX-L6 source integration and release HOLD

**Date:** 2026-10-16 IST. **Status:** CONSOLIDATED SOURCE TESTS ONLY, NEVER production promotion.

## Why VOX-L6 exists
Separate VOX-L1..L5 and AGNI-L3 draft PRs all had green individual CI,
but the earliest **first combined PR branch FAILED actual signed-route
execution** because its Core base branch did not contain the earlier
`contracts/vox/outboxMetricsAttestation.mjs` from VOX-08R. The new
route source compiled because a `.d.mts` declaration existed but would
fail at runtime. This is precisely why isolated TypeScript success is
not a substitute for dependency integration. Corrected by carrying
the exact prerequisite source commits (but **not** applying SQL):
- VOX-08N transactional internal-only notification candidate
  `74165413` → L6 integration `f8f6389`
- VOX-08N two-independent-PG-session concurrency test `8d4542b3`
  → `6b9cd18`
- VOX-08R Core outbox aggregate RPC + signed contract `a02ee65d`
  → `b58acd6`
L4 Web (PR #325) is L6 parent. L1 (PR #322), L2 (PR #323),
Core L3 (PR #324), and independent L5 (PR #326) are brought in
as separately reviewable commits, without GitHub merging their
draft PRs or elevating permissions.

## Source test evidence on JARVIS
- Core merged VOX source suite: 236/236 PASS after prerequisite restoration.
- Actual Core private AGNI route loaded and executed in synthetic
  TypeScript/VM environment: 8/8 PASS (signed request/actor, 503
  on feature OFF/missing RPC, 405 wrong verb, strict payload, narrow HMAC).
- Actual Core EOD + Riya GET route handlers loaded and executed with
  synthetic DB/AAL2 rows: 10/10 PASS, including positive canonical
  Google city/Place, negative cross-city, absent object grants, missing
  department and overflow. **Not genuine Stage Auth or a real SQL migration.**
- Core Next TypeScript PASS; Staff Web npm regression PASS; Web
  TypeScript PASS; Web production build PASS with new client cases,
  EOD source readiness, seven scoped internal Work transitions.
- Actual Core HMAC signer (from this exact integrated worktree) passed
  an **offline cross-repository runtime** roundtrip into compiled
  AGNI `voxCoreOutboxSignedView.js` from AGNI L3 PR #87
  (source `6fa59afe8627f9a585189d759daa5bee6648c359`):
  6/6 PASS including valid signature, owner/replay revocation,
  stale timestamp and forged external message denial.
  Explicit `VOX_L6_AGNI_DIST` input is mandatory; the offline
  script intentionally does not run in GitHub Core CI without a
  separately pinned AGNI build.
- Earlier L4 production localhost flags-OFF HTTP 8/8 PASS; L6
  unified code has not yet been promoted or Staff-activated.
- **No fresh PG17 stage-clone replay**: Docker daemon unavailable
  on JARVIS when checked; verified staging archive, extension SQL and
  independent DBA approval still required. Earlier 08N/08R
  isolated PG17 proof is historical, not a fresh L6 certification.

## Why live remains BLOCKED
- STAGING: latest read-only evidence 86 schema history rows, ZERO
  installed VOX tables, one Auth user, ZERO verified MFA.
- PRODUCTION: 86 rows, ZERO VOX tables, nine Auth users, ZERO verified
  MFA. Legacy migration provenance previously exhibited differing
  SQL bodies and non-shared migration IDs. Never run migrations
  on a live project before independent DBA signed approval.
- Independent human reviewer signs the first Team Leader nomination;
  Owner/AI cannot self-review. Independent AppSec signs SQL
  SECURITY DEFINER/RLS/IDOR and Staff AAL2/city/department revocation.
- User-facing Riya is only exact Core case **metadata**; real signed
  Jarvis client pause/handover ACK, current project object ownership
  and provider consent are unapproved. No outbound sends.
- Four-source EOD **source objects** are not four signed event readers;
  employee performance total, official EOD submit and comprehensive
  staff reporting remain unverified.
- Notification SQL/worker and AGNI service-to-service transport are
  source-only. No Cron worker, real PostgreSQL replay, live
  authenticated Owner telemetry, or external delivery authority.
- Core matching (3 vendors), payments, Google-verified locations,
  existing Superadmin role and regulated identity remain unchanged.

## Exact acceptance gates
1. Reconcile 86/86 migration histories; independently audit candidate
   SQL table owners, RLS and definer source, verified backup/restore.
2. Real first TL independent nomination and genuine new Staff AAL2.
3. Protected Staging source DB migration, negative-auth and rollback.
4. Signed Jarvis real pause ACK and fresh channel consent/subject grant.
5. Real Core outbox worker and signed AGNI Owner HTTP + PostgreSQL replay.
6. Four separately attributable Staff event collectors and accurate EOD.
7. Authenticated six-Staff-role, cross-team, cross-city and race E2E.
8. Signed reviewer, Owner and canary approval for any production cutover.

**Release instruction: preserve all feature gates OFF, all PRs DRAFT
and unmerged until human and protected-staging approvals are complete.**
