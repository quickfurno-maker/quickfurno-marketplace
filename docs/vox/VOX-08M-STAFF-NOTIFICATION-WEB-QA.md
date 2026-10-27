# VOX-08M — Staff notifications inbox UI (source-only)
**16 October 2026. Stacked on Core VOX-08L draft PR #309. Production and protected staging RELEASE HOLD.**

## Work actually done
- Existing VOX Staff Team Operations now links to `/team/notifications`. Server-rendered page shows current Core-authorized persisted Staff work-event notifications with plain-language event-kind labels, at most 25 rows, strictly "unread within this bounded window" not total, safe locked states and a separate "mark as read" internal receipt action.
- Private same-origin `GET/POST /api/staff-notifications` server BFF uses configured Origin/Host CSRF gate on write, exact two-UUID payload (notificationId+nonce), no browser actor, client, vendor or role choice. Other HTTP methods 405. All data flows through `lib/staffNotifications.ts` using existing `verifiedMfaSession` and pinned Core `origin()`. No new authentication.
- Reads retain only allowlisted current source fields; Web rejects fake complete counts, any additional contact data/PII, unsupported event kind, mismatched read revision, unexpected delivery claims or duplicated/more-than-25 rows. POST accepts only Core verified revision=1 receipt and explicitly no external push or message delivery.
- New `VOX_STAFF_NOTIFICATIONS_UI_ENABLED=staging` is required alongside existing Staff portal/team workspace/scoped mode, and Core requires `VOX_STAFF_WORK_NOTIFICATIONS_ENABLED=staging` and prior Staff flags. All flags stay OFF; there are no managed notification tables or genuine Staff MFA currently.
- This is a view + receipt interface, NOT an automatic event-to-notification worker, push service, full audit history or delivered notification receipt. The notification source candidate itself is in PR #309 and currently cannot self-generate events.

## QA completed
- Next production build PASS with /team/notifications and same-origin API built.
- Web TypeScript PASS; existing Web npm test suite PASS and new 9/9 synthetic Auth/Core negative tests PASS. Existing 08I 14/14 and 08K 12/12 also exercised in the aggregate suite.
- PR-only CI for web; verify its exact run before claiming remote success.
- Separate true local Next.js loopback locked-state HTTP smoke to verify GET 503, browser-origin denial 403, method 405, blocked Staff page 200 and unavailable unauthorized browser reads. Server stopped after smoke.
- No actual Supabase token AAL2 validation, real work event-to-inbox enqueue, no push provider interaction, no stage/prod DB writes.

## Remaining delivery / launch dependencies
- Independent DBA/security review and original 86 migration row provenance, single reviewed Staff grant stack and real restore/rollback, genuine neutral Staff MFA and independent first TL appointment.
- Need a reviewed Core transition-to-notification enqueue worker with reliable exactly-once dedupe, durable retries and failure handling; real staff grant/city revocation tests. This SQL source alone does not schedule such a worker.
- Retention/lifecycle and customer privacy review, unread delivery receipts, mobile push, provider consent, Riya/Anisha/Aarohi cross-channel handover and Jarvis/AOS/AGNI signed protected staging/production acceptance. DO NOT claim launch certified.

Source code DRAFT only, no activation.
