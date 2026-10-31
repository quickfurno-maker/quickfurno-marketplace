# VOX RC20 — A–F parallel implementation checkpoint (30 October 2026)

**Scope:** GitHub Draft PR #450, repository-only; managed Staging and Production intentionally held.  
**Quality:** No verified exact-head CI PASS at authoring; GitHub Actions checks remained queued/pending. This is not a production-ready certification.

## A — Finance V2, payer and credit safety

- `services/vendorPackagePaymentService.ts`: checkout now rejects any order not explicitly `created` and `not_started`/`pending`/`failed` before the existing bound-order fast path; cancelled, completed, expired, paid and refunded orders cannot be offered the old checkout again.
- The captured-payment activation path now denies locally refunded/refund-pending order status and a different persisted provider payment ID **before** delegating to the native V2 RPC. These are first fences; the SQL transaction is still the final authority.
- Existing RC18 activation receipt validation and RC19 conservative consumed-credit refund review stay in place. There is **no** provider refund execution or automated credit reversal.
- `ops/vox/rc17-review-candidates/20261031001000_rc17_razorpay_v2_authority_REVIEW_ONLY.sql`: the native activation RPC preserves exact-once `already_applied` response for an already activated order, then rejects any **new** activation of order state other than `created` or payment state other than `pending`/`failed`, including SQL NULL/refunded/cancelled/expired states. Candidate is **uninstalled**, no money or credits moved.

## B — Current Staff authorization in native Core

- `services/vox/rc8PgVendorConversationOperator.ts`: the same PostgreSQL SERIALIZABLE transaction now rechecks `auth.users.raw_app_meta_data.vox_role='operations_manager'` in addition to genuine active Staff membership, profile, team/city and object/capability grants.
- `scripts/mvp/vox/validate-vox-rc8-real-pg-vendor-core.mjs`: synthetic Postgres fixture now includes current operations role and verifies a mismatched `team_leader` metadata role is denied despite existing operations-manager membership.
- RC19 real-GoTrue-to-Core bridge remains **hard OFF** awaiting approved native AB7B source, complete canonical consent-writer serialization, current Staff AAL2 and managed migration/recovery review. This commit creates no live mutation route or provider send.

## C — Cryptographically signed EOD

- `scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs` now rechecks that the Owner and Team Leader identities returned by the cryptographic verifier equal the live authenticated Owner and Team Leader identities, while preserving independence and locked four-source report constraints.
- `scripts/mvp/vox/validate-vox-rc8-real-pg-signed-intent.mjs` added synthetic real PG17 negatives for mismatched TL reviewer, incomplete report, changed digest and already-published report.
- Actual signer-key enrollment, genuine Owner/TL recent factor attestation, independently reviewed writer roles and official EOD publication are still **not enabled**.

## D — Database and recovery

- The five V2 Razorpay RPCs remain in review-only SQL outside `supabase/migrations`. The original V1 migration remains immutable pending historical ledger adjudication.
- `scripts/mvp/vox/validate-vox-rc17-razorpay-v2-real-pg17.mjs` now checks cancelled/refunded new activation rejections, as well as two simultaneous callbacks granting credits once, cross-mode, claim fencing and denied browser roles.
- The RC18 source-recovery checksum/HOLD preflight is now a dedicated CI step, **not** a reason to mark managed recovery certified. Full verified Supabase Auth/Vault/Storage/role/PITR restore is still external and P0.

## E — Owner Finance operational UX

- Finance view adds shortcut links to pending and failed records in the bounded Core preview, retaining the selected Asia/Kolkata month and payment-status filters; the page performs no capture, refund, reconciliation or credit mutation.

## F — Quality assurance and CI

- `rc20-finance-core-signer.test.mjs` adds source regression checks for the payment lifecycle, V2 SQL ordering of exact-once replay, real Staff role, signed EOD identity/current review, and read-only Finance shortcuts.
- Fixed a proven RC19 source-test false positive that disallowed the word `sourceProof` in a descriptive comment instead of checking for an actual bypass assignment.
- The dedicated RC17–RC20 source + real PG17 CI workflow includes RC20 files and a source recovery checksum/HOLD step; independent RC15 native Core/Signer PostgreSQL17 workflows also observe the updated fixtures.
- **GitHub runners were queued/pending at latest check.** These tests are committed but have **not been witnessed passing on the latest SHA**. No claimed tests were made optional or skipped to force GREEN.

## Still blocking final launch

- **#451 Finance:** exact managed source migration replay, provider capture/reconciliation, genuine refunds and consumed-credit accounting, independent review.
- **#444 Core:** genuine Staff authentication bound to scoped production PostgreSQL writer, canonical consent/suppression insertion/deactivation serialization, AB7B reviewed native source and least-privilege DB role.
- **#447 Signer:** genuinely enrolled Owner and Team Leader, real live AAL2, approved atomic official publication writer, independently accepted end-to-end EOD.
- **#420 Release:** reliable managed Supabase-compatible recovery evidence, qualified independent DBA/AppSec approval, Staging integration acceptance and explicit separate Owner Production GO.

**Safety and status:** PR #450 remains Draft and RELEASE HOLD. No managed database changes, provider payments/refunds/credits, external messages, signing, official EOD or deployment during this batch.
