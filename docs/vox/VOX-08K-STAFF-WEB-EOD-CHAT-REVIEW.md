# VOX-08K — Staff web Core partial EOD, TL review & internal chat
**Status: DRAFT / source and locked-loopback tested only; not deployed. 16 October 2026.**

## Exact stack
Base is VOX-08J Core candidate draft PR #307 (commit e87fdcb407324e79ea3f96334386d8178f55e5b0), which itself stacks on VOX-08I #306 and 08H #305. Reuses existing `apps/vox-web`, Supabase `verifiedMfaSession`, single Core base origin `origin()`, the Core /api/vox/v1 routes and current Team workspace. No additional identity authority or agent send channel.

## Staff UI developed
- `/team/chat` and same-origin `/api/team-chat`: AAL2 Staff-only private team messages; max 25 displayed, max 500 chars, idempotency nonce, origin CSRF and strict JSON type/field/content allowlist. Never a WhatsApp/client/vendor message or delivered push.
- `/team/eod-submissions` and BFF: current India day Core work-ledger evidence only, one nonce per submit retry, no client counts/other data. Explicitly PARTIAL_UNVERIFIED_TOTAL, requires independently authorized Core staff scope.
- `/team/eod-reviews` and BFF: no self-review; intended only for a separate current Core Team Leader with AAL2. Team+city+revocation+revision checked again atomically by Core SQL. Only ACKNOWLEDGED / REJECTED statuses; no Owner impersonation or privileged role grant.
- Shared mobile layout `app/team/workflow.css`; Team homepage navigation and daily preview link updated. Locked pages render with precise errors while all stage flags remain OFF.
- `lib/teamWorkflow.ts` is server-only, derives identity from existing MFA session, uses a pinned HTTPS Core origin, bounded JSON, no redirects, 3.5s timeout, denies any unexpected PII, fake completion, fake provider delivery or mismatched receipt. BFF POST uses pinned origin/Host CSRF checks and unsupported methods 405.
- Additional web flags `VOX_TEAM_CHAT_UI_ENABLED`, `VOX_EOD_SUBMIT_UI_ENABLED`, `VOX_EOD_TL_REVIEW_UI_ENABLED` must each explicitly equal `staging` along with Staff portal/team workspace/current mode. Existing Core flag gates independently enforced. All remain **disabled**.

## Actual checks (not fake signoff)
- Root Core VOX baseline 189/189 isolated tests PASS.
- Web full `npm test`: existing suite PASS and 14/14 VOX-08I tests plus **12/12 new VOX-08K web adapter / boundary tests** PASS.
- Web `npm run typecheck` PASS and `npm run build` PASS (actual dynamic Next routes present).
- Actual separate loopback Next production build, all flags DISABLED: **13/13 HTTP checks PASS** including 503 locked GETs, 400 unsupported filter, 403 browser-origin rejections, 405 DELETE, and 200 locked Staff pages. Local test process stopped, no staging or production calls.
- PR-only GitHub workflow `vox-to08k-web-chat-eod.yml` executes npm test, TS, build without deployment permissions. GitHub CI result must be observed separately.
- Human first TL, external DBA/security 86-history/ACL, protected true AAL2 and real Staff/consumer/agent/provider end-to-end all remain untested and launch-blocking.

## Open risks and future work
- Service-role-only Core functions remain SQL candidates, not migrated. Independent human DBA must approve even if disposable PostgreSQL tests succeed. No IAM/OTP bypass or Staff signup.
- Core partial EOD remains only Core work events, not complete operations/CRM/agent performance. Acknowledgment is scoped *receipt* of the partial report, not full certified employee productivity.
- Chat lacks independently reviewed data-retention schedule, delivery receipts, unread counters, and optional Core-authorized staff notification generation. No external send and no automatic notification. Implement or govern these separately.
- Real AAL2, self/team revocation race, nonce concurrent delivery, tenancy isolation with real credentials, source provenance, staging rollback and signed images/AGNI/agents/AOS integration are mandatory before launch.

**GO/NO-GO:** Safe isolated development complete; protected staging and production release remain HOLD.
