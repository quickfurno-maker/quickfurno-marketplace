# QuickFurno Finance V2 — PAY-1 + PAY-2 integrated source-only review
Date: 22 October 2026. Base: Phase-1 Core exact SHA `71e2cfc307753603bf31ef4cba982ab1713db89e`.
Review parent: [Finance V2 canonical Notion architecture](https://app.notion.com/p/401751ba167c816190caf175662b5b4f).

## PAY-1: money integrity
- Conservative normalized manual bank UTR unique index; distinct Razorpay reference untouched. Optional feature-gated server bank-reference normalizer, OFF by default until independent review and SQL install. No bank settlement assertion.
- New service-role-only security-invoker all-row SQL projection for Razorpay LIVE CAPTURED money, Razorpay TEST exclusion, manual paid but unreconciled separated, IST monthly capture totals. No accounting revenue assertion, no settlement/GST claim.
- Admin Payments screen uses source-only opt-in `FINANCE_V2_COLLECTIONS_ENABLED=true` to call the reviewed view. Default shows 'Not certified' rather than falsely aggregating TEST payments into live revenue. No disabled branch implicitly creates credits or payments.

## PAY-2: event, attempt, refund and audit history
- Four new append-only finance tables with RLS + FORCE RLS, no anon/auth SELECT/DML, service_role INSERT/SELECT only, BEFORE UPDATE/DELETE immutable guard. Provider-event and payment/refund-ID unique constraints scoped by provider+mode+merchant. External webhook receipt includes SHA256 digest only, never raw body or keys.
- Verified raw webhook helper reads signed raw bytes and event ID, refuses altered bodies/invalid event IDs, emits only whitelisted metadata. NOT wired into production webhook yet; source only. Refund requests are intentionally NON-EXECUTABLE pending governed approval/cumulative refund cap/status projections and provider canaries.

## Local reproducible QA (synthetic only, NOT protected Staging)
- Existing Razorpay source validator 51/51 PASS.
- Existing Core/VOX 507/507 Node tests PASS.
- New PAY-1+PAY-2 pure tests 7/7 PASS.
- Full npm TypeScript typecheck PASS; Next production build PASS.
- Docker `postgres:17-alpine --network none` applied both candidate SQL files to disposable fixture PASS. Demonstrated normalized duplicate manual UTR rejected; fake 100 INR LIVE+900 INR TEST projections return LIVE 100, TEST-excluded 900; zero browser-access, 4/4 new tables FORCE RLS; duplicate provider payment/event denied; unverifiable provider event denied; history UPDATE/DELETE denied; offline prechange pg_dump restored with zero Finance V2 objects.
- GitHub exact commit workflows must be checked independently; source evidence is not provider or Staging certification.

## P0/P1 still pending
- Independent DBA/AppSec review, full real Staging + Production migration histories/data unique-index preflight/rollbacks, finance retention preservation, real verified UTR bank statement evidence and two-person approval. No production removal of financial `ON DELETE CASCADE` yet.
- Build safe processor that durably stores deduped provider events before background worker can call Core activation; enforce exact mode/account/order/amount and captured truth. Current provider webhook remains original, not upgraded.
- Cumulative partial refund cap, chargeback/settlement ledger, invoice numbering/tax confirmation, payment-to-package FK, safe human-approved credit reversal. PAY-3 role-scoped AAL2 Finance Staff 360 not built.
- Real Razorpay TEST capture/retry/refund/out-of-order/webhook idempotency E2E, stage signed deploy and Owner GO/NO-GO not performed.

**All code DRAFT, unmerged, candidate SQL uninstalled, gateway outbound disabled, no customer/vendor money or Auth/DB changes. RELEASE HOLD.**
