# VOX-08J — Core-only governed EOD and private team-chat candidates
**16 Oct 2026. DRAFT source/isolated testing ONLY; managed Staging and Production untouched.**

## Existing decisions and re-use
Sole QuickFurno Core Superadmin remains the only Admin identity. All Staff and scoped Team Leaders continue using **existing Supabase Auth** and `getVerifiedScopedStaff`, with genuine verified AAL2, live membership, department/city/team/object scope/expiry/revocation. No second token system, owner impersonation, chat provider send or financially effective action.

Existing `vox_work_items_candidate_v1`, `vox_work_events_candidate_v1`, Staff memberships and approved department grant records are reused. The existing bounded daily EOD view remains **PARTIAL_UNVERIFIED_TOTAL**; a submitted Core-only report is NOT certified as a full CRM/agent/WhatsApp daily report.

## Candidate SQL, separate from managed Supabase migration history
**Install ONLY after human-reviewed Staff source-of-truth, historical migration reconciliation, protected backup and rollback review.** The isolated real restored Staging schema needs quarantined legacy Staff foundation 20261014010000, reviewed department 20261015010000 + 20261015020000, work candidate 20261015030000. Then:
1. `20261016010000_vox08j_eod_partial_review_candidate.sql`: append-only partial Staff EOD report row (7 fixed counters computed in SQL from at most 100 real current IST business-day staff work transition events with current object+city+department proofs); one day/team/staff unique; nonce idempotency; immutable counts/source and reviewer event, no DELETE. Only a separately verified **current Team Leader in the same team/city** can acknowledge/reject at revision 0; no self-approval. All writes through service-role-only SECURITY DEFINER RPC after Core AAL2 verification.
2. `20261016020000_vox08j_staff_team_chat_candidate.sql`: append-only private same-team Staff text, limited 500 characters, no control chars, separate nonce, index for 25 latest, no client or vendor provider send, no WhatsApp and no new staff. SQL revalidates active neutral Staff and exact team and city. Team Leader role requires independently governed identity.
Both are RLS enabled + FORCE RLS, no anon/auth table grants, privileged RPCs restricted to service_role, empty search_path. No direct browser Supabase service-role key.

## Protected Core endpoints, ALL DEFAULT OFF
- `GET/POST /api/vox/v1/eod-submissions`: exact-own history and partial SQL-generated day submission; POST accepts ONLY nonce+TODAY's IST date; no actor, count, team or city from browser.
- `GET/POST /api/vox/v1/eod-reviews`: exact Team Leader pending list and independent Core atomic review; POST only report ID + revision 0 + nonce + decision. **No AI/manual owner self-signoff**.
- `GET/POST /api/vox/v1/staff-chat`: latest 25 exact-team messages, no overbounded results, nonce-specific idempotent internal message send; no recipient/city/role/client/vendor/team JSON.
- Flags: common `VOX_STAFF_GRANTS_ENABLED=staging`, `VOX_DEPARTMENT_ENFORCEMENT_ENABLED=staging`; `VOX_EOD_SUBMISSIONS_ENABLED=staging` for EOD, extra `VOX_EOD_TL_REVIEW_ENABLED=staging` for Team Leader; `VOX_STAFF_TEAM_CHAT_ENABLED=staging` for internal chat. **All remain disabled**, no managed SQL is present and no real Staff MFA/TL signer exists.

## Isolated QA, not deployment authority
- New actual TypeScript route-handler VM with stubbed Auth and DB, 14 independent checks of flags, fake actor/role/team/recipient rejection, replay receipts, current IST date, stale revision, PII stripping, bounded chat, GET filtering, 405 other methods. **NOT** actual Supabase verified JWT E2E.
- Core baseline VOX source regressions, TypeScript and PR-only CI to be recorded with exact git SHA.
- Real protected staging archive SHA256 D88176856CDBEDE5FD31216E6217A388D64A95D137C728A0CB0DE0A605BDE71E recovered on *disposable network-none PG17* with original 86 migration records, then all six SQL files in order; no persistent DB changes. Additional separate SQL assertions verify forced RLS/no anon-or-auth table access, service-only RPCs, fake actor/TL denial, no data/history mutations. Disposable container removed.
- Critical future negative tests once truly human-authorized test identities exist: stale/refreshed JWT, cross-team, expired reviewer, revoked grant, first Team Leader/independence, deterministic concurrent nonce, 100/101 events, exact real auth trigger and Browser SSRF/CSRF, participant lifecycle and retention, EOD TL acknowledged-but-revoked, no provider delivery and rollback. **Not certified without these.**

## Explicit remaining feature backlog
- All-source daily report completeness and signed final business EOD (this is only Core work ledger partial snapshot).
- Client Riya team/customer grants and real staff-to-client handover/provider consent rules; no broad cross-channel communication.
- Staff in-app notification delivery and receipts, unread markers, retention/abuse controls, offline replay, mobile push; the existing Needs Attention page is a derived read-only list, NOT notification delivery.
- Protected source merge, reviewed roles/security/DB history, DBA and independent first TL reviewers, actual Staff AAL2 onboarding, integration E2E across Jarvis/AOS/AGNI, immutable release rollout and restore rehearsal; Owner separate go/no-go.

**Never promote a quarantined legacy migration or mark all remaining work complete based on isolated tests.**
