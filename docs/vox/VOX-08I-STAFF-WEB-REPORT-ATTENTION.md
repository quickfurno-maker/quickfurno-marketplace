# VOX-08I — Staff EOD + Attention UI / All-Pending Source QA
**Date:** 16 October 2026. **Status:** SOURCE BUILT / WEB TESTS PASS / PROTECTED STAGING and PRODUCTION ON HOLD.

## Implemented in existing `apps/vox-web` (no second Auth)
1. **Server-only Staff EOD adapter** `apps/vox-web/lib/eod.ts` reuses `verifiedMfaSession` and the *existing* HTTPS-pinned `origin()` from `lib/core.ts`. Strict response schema, current IST date, exact seven count keys (safe 0..100), `PARTIAL_UNVERIFIED_TOTAL`, and no leaked Core row IDs/PII/reasons/transcripts. Rejects unreadable or overlarge Core data, failed MFA, unexpected counters, false completion claim, provider delivery claim, and unknown identity mode. Does not submit reports or mutate any SQL.
2. **Read-only same-origin EOD BFF** `GET /api/eod-preview`, with strict no-query-param gate; POST/PUT/PATCH/DELETE 405. Source uses private `safeJson` and existing MFA-scoped adapter, no direct browser-to-Core bearer token or browser-side Supabase service role.
3. **Staff `/team/daily-report`** server-rendered accessible page shows verified bounded current-day Core work counts with explicit partial/unsubmitted warning, no fake total, link to existing work queue and attention. Distinguishes 401, 403 and service-unavailable state; no counts in denied mode. Scoped/dual Staff only, not Owner or Team Leader impersonation.
4. **Needs Attention `/team/attention`** server-rendered page derives 0..25 *already verified* Core queue items in BLOCKED, WAITING_APPROVAL, WAITING_EXTERNAL and NEW states. This is **NOT a push, WhatsApp, internal delivery or notification receipt**. Priority ordering, stable IDs, de-duplication, bounds, forbidden state and invalid role/assignee guards; no NEW assigned-to-me. Visual labels explicitly say bounded/no total/no send.
5. Added both navigation cards to existing `/team`. Kept all existing Staff directory/Team Leader/Owner security distinctions and all old feature flags. No new admin identity, new SQL, external provider credentials or background task.
6. New web flag `VOX_EOD_PREVIEW_UI_ENABLED=staging` required alongside `VOX_STAFF_PORTAL_ENABLED=staging`, `VOX_TEAM_WORKSPACE_ENABLED=staging`, and scoped/dual Staff mode. The Core endpoint separately requires `VOX_EOD_PREVIEW_ENABLED=staging` and three existing Core flags. **All flags remain OFF**, and no protected schema exists in live Staging.

## Source and local HTTP QA
- Web `npm ci --offline --ignore-scripts` installed 44 pinned packages via local cache.
- `npm test`: baseline existing web suite PASS **plus 14/14 new adversarial tests**, using the actual TS adapter in an isolated VM with fake Auth and Core network. Negative cases: four UI modes/flags, missing MFA, pinned origin missing, 403/500, PII extra fields, bad count, fake complete source, stale IST date, overflow, unauthorized client data; attention fakes and duplicate IDs. Tests prove **synthetic** behavior only.
- `npm run typecheck`: PASS.
- `npm run build`: PASS; routes `/team/daily-report`, `/team/attention` and `/api/eod-preview` present in compiled Next production build.
- Core existing VOX-08H EOD canonical source tests: 12/12 PASS.
- **Separate locked loopback Next server HTTP smoke** with all flags disabled: 6/6 PASS (GET EOD 503, GET with forbidden past date param 400, POST EOD 405, daily-report locked HTML 200, attention locked HTML 200, Team Operations locked HTML 200). Local Next test server stopped after use; no network delivery.
- GitHub PR-only `.github/workflows/vox-to08i-staff-eod-web.yml` executes pinned checkout, clean npm install, existing+new web tests, TypeScript, and Next production build. No write permissions or provider secrets.

## Critical unresolved items: cannot declare all work complete
### Features requiring more SOURCE work and/or independent activation
- Full **daily report submission** with durable Core event/audit entry and Team Leader acknowledgment is **NOT implemented**; preview must not be confused with submitted official report.
- True **internal Team Chat** transport, durable staff messages, unread receipts, push delivery and reminders are **NOT certified**; the attention list is only an authorized queue-derived *preview*. Vendor/client WhatsApp requires provider-approved consent and governed Core broker and human handover, not these pages.
- True assignments/claim/transitions remain governed Core SQL candidates and existing default-OFF VOX routes; real protected Stage Staff identities/grants and live concurrency tests not done. Do NOT enable.
- Riya/Client independent canonical Core client-subject permissions remain gated; no unrestricted client inbox.
- External independent DBA/security and first Team Leader reviewer required by current governance; full historical stage-prod migration SQL parity and managed ACL/recovery signoff incomplete.
- Staging Auth (prior read-only evidence): 1 user, 0 verified MFA factors, 0 VOX staff tables. Production 9 Auth users, 0 MFA, 0 VOX tables. No account or schema changed in this pass.
- QF Jarvis, AGNI source suites passed in previous VOX-07G (310 distinct focused tests), but **not repeated as live full E2E** here. Build/source claims only.
- Signed immutable Docker, protected staging AAL2/IDOR, data retention, real restore/rollback and owner go/no-go before production all still pending.

## Release authority
This branch is **DRAFT, unmerged**, stacked over VOX-08H PR #305. Local source green is **not** an authorization to merge parent or enable stage/prod. The owner chose to postpone sourcing the external reviewers until final staging activation; reviewer approval must not be bypassed simply because source and synthetic tests pass.
