# VOX RC19 — Internal parallel integration checkpoint

**Date:** 30 October 2026  
**Scope:** GitHub repository, Draft PR #450 only; PC offline  
**Release:** HOLD. This is internal implementation, not deployed production functionality.

## A — Finance V2 and consumed-credit safety

- Added `lib/payments/vendorPackageRefundEvidence.mjs` and a TypeScript declaration. The pure conservative evaluator requires exact provider payment identity, explicit TEST/LIVE mode, independently reconciled capture, canonical credit-ledger and assignment evidence, non-refunded/non-pending lifecycle and exact granted = consumed + remaining counts. It denies automatic refund authorization **in every case**; when fully unconsumed it permits **independent review only**, never a provider refund or a credit reversal.
- RC19 Node regression tests cover valid reviewed evidence, partial/full consumption, missing/wrong identity, stale/ambiguous lifecycle and inconsistent credit figures.
- Core's RC18 atomic activation and failed webhook result guards remain active in source. The five RC17 V2 SQL RPCs are **review-only and NOT installed**. Actual provider reversal and consumed-credit ledger transaction are **not complete**.

## B — Real Staff AAL2 → native Core transaction wiring

- Added `services/vox/rc19VerifiedConversationWriter.ts`. It obtains a genuine GoTrue AAL2 operations-manager bearer, revalidates current team/city/grants and forwards only the server-derived actor into the existing RC8 SERIALIZABLE native Core operator.
- The adapter does not accept caller-supplied verifiedStaff or source-proof bypass.
- **`RC19_VERIFIED_CORE_WRITER_INSTALLED=false`**. Missing independent DBA/AppSec, full active consent mutation serialization, correct AB7B/ACL/minimal writer role, genuine Staff enrollment and recoverable managed staging remain blockers. No live route or provider sends.

## C — EOD crypto source truth

- Updated `scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs` for EOD intents to lock the actual four-source report `FOR UPDATE` and require a matching subject, team, city, source digest, 4 source entries, independent TL reviewer, unpublished state and approved review state.
- Updated the **real disposable PG17 signer fixture** `validate-vox-rc8-real-pg-signed-intent.mjs` to create a genuine local synthetic EOD source/report row and exercise three-source and wrong-TL denial before valid verified intent. Existing key revocation, nonce replay and live Staff rechecks remain in the fixture.
- This makes the **pending signed-intent** validation stronger. It is NOT official EOD publication: human Owner and TL keys, approval ceremony, minimal writer role, receipt publication and qualified security/DBA signoff remain missing. Existing official route remains hard OFF.

## D — Recovery and transaction evidence

- Strengthened `validate-vox-rc17-razorpay-v2-real-pg17.mjs` to call the actual V2 activation RPC concurrently twice and require exactly 10 credits once and zero on duplicate callback; it also preserves null-provider, TEST/LIVE, claim replay, strict release and browser grant negative tests.
- New RC19 source gate rejects any accidental promotion of review-only Razorpay/EOD candidates into `supabase/migrations` and records historical V1 migration issues without editing the original ledger.
- Full V1→V2 migration replay, production/staging schema inventory, Supabase Auth+Vault+Storage+roles restore and independent DBA/AppSec review remain outstanding.

## E — VOX operational UI

- Owner Finance recent read-only preview now supports **India (Asia/Kolkata) month** and payment-status filters simultaneously. Extracted typed reusable helper `apps/vox-web/lib/financeMonth.mjs` (and `.d.mts`).
- Regression cases include exact 18:30 UTC month/year rollover and malformed/out-of-snapshot months. Counts and filtered records remain a **bounded Core preview**, not a settlement ledger or complete historic analytics.
- Full Staff/CRM/Vendor360/Finance operational activation and managed Staging acceptance are not complete.

## F — Continuous QA

- RC19 tests: `rc19-refund-evidence.test.mjs`, `rc19-core-eod-source.test.mjs`, `rc19-finance-month.test.mjs` and `rc19-database-release-hold.test.mjs`.
- Updated `.github/workflows/vox-rc17-six-tracks-hold.yml` to run all RC17/RC18/RC19 source-contract tests, typecheck and the genuine disposable PG17 Finance integration. Updated RC15 PG17 signer fixture is triggered by its independent workflow.
- **At the last exact-head check the returned workflows were still QUEUED. No new exact-head CI pass, local real PG17 pass or managed integration result is being claimed.** No test was skipped or made optional. This environment has no local Docker/PostgreSQL executable, so real PG17 execution remains dependent on GitHub runners.

## Open final blockers

- #451: Reviewed, installed Razorpay V2 migrations, provider captured-payment reconciliation, full lifecycle refunds and consumed-credit ledger; authorized managed DB restore.
- #444: current canonical client/vendor ownership + consent source and complete serialized writers; transactional Staff AAL2 and minimal DB authorization.
- #447: two genuinely enrolled independent Owner/TL signer keys, cryptographic official EOD receipt writer, functional E2E coverage.
- #420: qualified independent DBA/AppSec, managed Supabase-compatible recovery, verified Staging acceptance, actual Owner MFA and explicit separate Production GO.

**Release decision:** Draft PR #450, managed Staging/Production HOLD. No managed schema change, live payments/refunds, credits, official EOD release, external messages or deployment occurred.
