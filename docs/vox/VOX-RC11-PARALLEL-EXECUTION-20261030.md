# VOX RC11 — Parallel Tracks A–F: signed-key revocation and Finance attempt evidence

**30 October 2026 · Protected PR #450 DRAFT · RELEASE HOLD**

**Scope:** internal/source and disposable PostgreSQL integration only. No managed Staging or Production database, metadata, deployment, MFA key, signing key, payment, webhook, provider send, refunds or credit mutation. Do not call this full Finance V2 or a ready-to-activate signed EOD service.

## A — Original Core conversation integration / constraint
- The RC10 review-only native vendor conversation writer remains validated and production-hard-off. Real local PG17 transaction regression **PASS**. No release flag changed.
- The canonical source stores `communication_conversations.subject_type='client'` `subject_id` as a `client_accounts.id`; canonical `client_accounts` has no city or service_zone_id. It is **unsafe to infer** an authenticated client's team-city authority from an unrelated lead, phone number or UI-supplied city. No client-side workaround or unilateral city grant has been added. Designing and reviewing a canonical client->project/service-zone binding remains **OPEN**, as does the AB7B original `CORE_CONVERSATION` CHECK and trusted Core AAL2 transaction injection.

## B — Signed approvals: actual replay-revocation fencing
- Added `ops/vox/rc7-review-candidates/20261030030000_vox_rc11_signer_revocation_lock_review_only.sql`, UNINSTALLED and outside deployable migrations. It establishes a FK from key revocations to enrolled signer registry, makes revocations append-only by SQL trigger, and offers an **SECURITY INVOKER** revoker procedure. That procedure first takes `FOR UPDATE` on the enrolled key; current pending-intent writer takes `FOR SHARE` on enrolled keys before crypto verification and before the atomic 3-claim+1-pending-intent commit. Revocation cannot commit during a signed writer's key lock, removing the read/phantom-insert window **for reviewed revokers that use this procedure**.
- Extended existing genuine disposable PG17 signing integration test to apply the review-only candidate, hold key share lock, assert revoker `lock_timeout` denial `55P03`, rollback the holder, verify revocation commits, and verify subsequent Ed25519 approval denies the revoked key. Test **PASS**. Other synthetic signed-approval replay/tamper/Owner+TL metadata/current-team controls remain passing.
- **Not live security certification.** Only a reviewed dedicated revoker role and human key ceremony can close the direct privileged DML path. Existing production official EOD writer remains hard-off; test signers are synthetic; no real human approval.

## C — Recovery and database governance
- Repeated isolated PostgreSQL17 30/30 existing SQL candidate installation and full-fidelity snapshot replay. **Baseline catalog parity FALSE / script exits nonzero**; exact two-field owner ACL reconciliation in opt-in disposable restore produces **TRUE**. Original strict FAIL preserved; NO managed Auth/Vault/Storage/roles/PITR recovery or qualified independent DBA/AppSec acceptance.
- Two new RC11 SQL files live in `ops/vox/rc7-review-candidates` only. No change to `supabase/migrations`, the pinned 30 SQL candidate list or quarantined legacy migrations; do not apply to managed Staging without review.

## D — Finance attempt events and Owner timeline
- Added `ops/vox/rc7-review-candidates/20261030040000_vox_rc11_payment_attempt_audit_review_only.sql` review-only schema for **append-only attempt evidence**, keyed by globally unique `attempt_id` and exact `(attempt_id,attempt_sequence)`, linked by FK to canonical `vendor_package_orders`. TEST/LIVE provider-mode lock, order/token hash scoped sequence validation, immutable update/delete trigger, hash-only request/event evidence. The table stores NO payment provider IDs, bank details, phone numbers or UTR; no payment mutations. Table denies anon/authenticated writes; service_role gets SELECT only (no DML). A dedicated authorized evidence recorder role and actual event ingestion remain **NOT IMPLEMENTED** and need independent review.
- Actual PG17 isolated harness `validate-vox-rc11-real-pg-finance-attempts.mjs` **PASS** with 3 records/2 distinct attempts, ordered append, duplicate attempt sequence, cross-order, TEST/LIVE, missing parent, mutation and unauthorized Auth role writes DENIED; canonical payment status untouched.
- New Owner Core `GET /api/vox/v1/finance/order/[orderId]/attempts`, **separately flag-gated** `VOX_FINANCE_ATTEMPTS_READ_ENABLED=staging` plus preceding Finance/Staff gates. Reads only bounded 50 audit rows and exact existing order, uses real verified Owner AAL2 BEFORE and AFTER awaits; GET only, all mutations 405; no-store and explicit `isCompleteHistory=false`, `isProviderSettlementVerified=false` and zero financial authority.
- Strict `rc11PaymentAttemptTimeline` model and separately gated VOX Web BFF `VOX_FINANCE_ATTEMPTS_READ_UI_ENABLED=staging` with Owner MFA, pinned Core origin, no-store, strict minimal data validation. VOX Web Finance order detail now shows bounded event timeline when independent source and UI flags are explicitly enabled, otherwise a clear unavailable—not proof of zero attempts.
- Focused model/bundled actual HTTP route/auth/DB stubs/Web source tests **9/9 PASS** (invalid/missing owner, mid-request revocation, cross-order/over-limit, no raw provider fields, POST/PUT/PATCH/DELETE 405, flags default OFF). New SQL is NOT installed anywhere managed, and historical full provider attempt capture is not certified. No provider status confirmation, refunds or credit issuance.

## E — QA & security gates
- SOURCE QA orchestrator **118 suites / 778 of 778 PASS**; `test-results/vox-rc11-source-qa.json` SHA256 `e967d623fea7516fd2566db7529f45bb563314c5c075f32242b4f51453b5926a`; `SOURCE_PASS releaseDecision=HOLD`. The source-only orchestrator marks real PG/Auth stages BLOCKED; below tests were run **independently** and do not convert source-only verdict to managed acceptance.
- **Three separate genuine local PostgreSQL17 suites PASS:** Core transaction (existing vendor scope), synthetic Owner+TL signed-pending-intent plus new revocation interlock, Finance append-only attempt audit. All loopback-only disposable containers cleaned.
- Real local GoTrue + PostgREST + PG17 actual VOX Core Owner route TOTP AAL2 harness **8/8 PASS**, not live human MFA. Targeted Finance/manifest/source security guard checks **15/15 PASS**.
- Root Next.js 16.4.1 production build + TypeScript PASS; pinned VOX Web Next.js 16.3.8 `npm test` and production build PASS.
- Strict managed recovery validation BLOCKED; original full-fidelity ACL baseline still fails as designed.

## F — Deterministic source release evidence
- `scripts/mvp/vox/rc11-release-evidence.mjs`: 23 SHA256 source-file entries, digest `8ef30573419ffc37ee19da0477f5ec5f35356201e6a1e4462cfabc601d9be50a`. Local JSON SHA256 `b2227dcd59559901cc23ed16ad570526fe069ebab0ca2ad61cdee1be2c7cf2ec`.
- **UNSIGNED_NOT_DEPLOYABLE / HOLD**: human MFA/key enrollment, independent DBA/AppSec, production cryptographic publisher, authenticated managed Staging and Production GO remain denied. No policy test weakened.

## Remaining P0
Canonical client geography/source-writer trusted AAL2 and real AB7B original source binding; human-enrolled independent Owner+Team Leader keys and official signed EOD release; reviewed Finance attempt recorder and actual provider ingestion/reconciliation/refund/consumed-credit authority; managed full restore and independent DBA/AppSec; all-feature real authenticated managed Staging E2E, signed deployment and separate Owner Production GO.

PR remains **DRAFT** until exact RC11 CI success and all genuine launch gates. **No managed environment modified.**
