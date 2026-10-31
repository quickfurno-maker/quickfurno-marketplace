# VOX RC28 — Internal implementation batch, 31 October 2026

**Release decision: DRAFT PR #450 ONLY; managed Staging, Production, payments/refunds/credits, EOD publication, staff enrollment and migration application remain HOLD.** No deploy, no real Razorpay API request, no managed database write. This was implementation and executable recovery work—not approval to activate.

## P0 — Three prior GitHub CI failures closed
- **RC4 source QA**: moved the real PostgreSQL two-session race from an opt-in/skipped `*.test.mjs` source test into its own mandatory disposable PG17 runner. Source gate now SOURCE_PASS with zero skipped suites; the actual native race separately passes.
- **VOX-20 isolated seven-migration restore**: all eight disposable SQL connection paths and readiness use final local PostgreSQL TCP instead of the temporary initdb socket. Validated three consecutive restores, complete schema/RLS/ACL/role denial parity. No managed credentials/target.
- **UI-04 Core authenticated runtime**: prior `npm ci` failure proved transient on GitHub failed-job rerun; npm install, auth tests and production build then PASSED. No bogus install workaround.
- At previous protected PR head `c7e88866`, GitHub RC4, VOX20, UI04 and real Finance workflows were PASS; remaining exact-head checks must be queried again before whole-PR certification.

## A — Core source integration
- Added `services/vox/rc28VerifiedCoreOutcomeReconciliation.ts`: genuinely verifies current GoTrue Staff AAL2 through `verifyVoxOperationsStaffBearer`, derives actor ID exclusively from server-verified identity (never request body), binds read-only PostgreSQL nonce/event/receipt reconciliation through the RC26 native reconciler.
- Rejects extra fields, forged actor/source, expired or non-AAL2 Staff, missing native adapter before any mutation; no route, sends or DB writes. **5/5 focused new tests PASS**; combined Core existing and new source 12/12 PASS; native Core STOP/takeover PostgreSQL race and AB7B receipt integration PASS.
- `RC28_CORE_RECONCILIATION_ROUTE_INSTALLED=false`; operational writer and full genuine Staff/Core route exposure remain unapproved.

## B — Finance source + genuine isolated PostgreSQL integration
- Added `lib/payments/vendorPackageProviderEventRepository.mjs` (plus typings), a transactional claim/complete PostgREST RPC adapter bound to the immutable event, raw body SHA256, mode, provider payment/order and exact claim attempt (stale claim completion refused).
- Added a **review-only/non-deployable** PostgreSQL 17 SQL fixture `scripts/mvp/vox/fixtures/rc28-review-only-provider-event-ledger.pg17.sql`: composite unique (mode,event), atomic row lock claim, lease/retry/quarantine, accepted outcome checks, attempt fencing, FORCE RLS and narrowly granted `service_role` RPCs with PUBLIC/anon/authenticated denied. It was deliberately moved **OUT of the signed `ops/vox/sql-candidates` migration discovery** when integrated QA caught a protected manifest mismatch; no signed pin modified.
- Added `validate-vox-rc28-provider-event-ledger-pg17.mjs`: actual isolated PG17 test exercising the REAL repository adapter, orchestration and SQL together. Confirms duplicate webhook Core action not rerun, hash drift conflict, test/live separation, claimed-lease fencing, quarantine, FORCE RLS and denied client privileges. **Three independent disposable PostgreSQL runs PASS**, no providers, no managed DB.
- Source repository 5/5, combined RC26/27/28 Finance source 22/22 PASS. **Not wired into live Razorpay route**: real provider event-ID path, reviewed managed SQL + finance role/grants, durability/recovery, refund and consumed-credit policy require approval. `RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED=false`; LIVE remains fail-closed.
- Razorpay official docs identify `x-razorpay-event-id` as the retry deduplication header; production binding remains gated because HMAC signs the raw body, not arbitrary headers, and finance operations need separate idempotent business-level constraints.

## C — Genuine human EOD pending receipt path
- Added `services/vox/rc28PendingSignedEodReview.ts` with authentic Owner and separate Team Leader AAL2 verification, strict 3-field receipt input, read-only durable PG17 signed-intent reconciliation, post-commit uncertainty rejection. No caller-supplied Owner/TL signer and no official publication authority.
- New focused 5/5 and combined existing/new 17/17 PASS; original signed pending EOD native PostgreSQL 17 PASS.
- `RC28_SIGNED_EOD_REVIEW_ROUTE_INSTALLED=false`; real distinct Owner/TL keys, MFA ceremony, human independent review and official EOD publication stay external and HOLD.

## D — Actual database release engineering
- Real isolated seven-version VOX20 custom-format PG17 dump/recovery succeeded 3/3 with SHA-256, 10 RLS/FORCE tables, five functions and privilege denials, without touching Staging or Production. The protected legacy 7+23 SQL fingerprint remains unchanged and is enforced.
- 31 managed-only / 107 source-only capture drift, 12 missing evidence items and unresolved historical V1 Razorpay parser remain review/HOLD, not an auto-migration.

## E — QA and CI
- Combined JARVIS `node --test scripts/mvp/vox/*.test.mjs`: **978/978 PASS, zero FAIL, zero SKIP**.
- RC4 source-only orchestrator SOURCE_PASS, actual independent RC27 PG17 race PASS; real isolated PG17 Core, EOD and RC28 persistent Finance PASS.
- Razorpay security/authority script **51/51 PASS**; root TypeScript `npm run typecheck` PASS; VOX Web tests and build independently run.
- RC17 protected CI now includes RC28 source suite and actual native PG17 Finance repository/SQL, preserving previous P0 checks, explicit release HOLD and disposable-container cleanup detection.

## Remaining operational and external launch gates
1. Reviewed Staff AAL2 bootstrap and actual Core writer + AB7B source route/grant installation; full genuine CRM, Vendor 360, Service Desk, Staff end-to-end flows.
2. DBA/AppSec-reviewed durable Finance ledger in the approved managed migration sequence, verified Razorpay event-ID/HMAC boundary and refund/consumed-credit settlement flow; financial activation separately authorized.
3. Real distinct Owner & Team Leader signed enrollment, official EOD authorized publishing writer and independent review.
4. Full-fidelity managed Supabase restore covering Auth, Storage physical objects, Vault, role/ACL grants, PITR; adjudicate 31/107 mismatch, missing SQL and historical V1.
5. Approved managed Staging deployment and real functional acceptance, then independently signed Owner Production GO.

**These are real remaining integrations and approvals. Internal source progress is not equivalent to fully functional managed Staging or Production readiness. No quality/security gate was bypassed.**
