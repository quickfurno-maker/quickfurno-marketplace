# VOX — Focused internal corrections, 31 October 2026

Target: Draft PR #450 on `feat/vox-rc6-operational-20261030`.
Decision: **SOURCE TESTED; MANAGED STAGING AND PRODUCTION HOLD**.
This is a direct defect-correction round, not another certificate or a permission to install unreviewed database SQL.

## 1. Immediate CI failure repaired — Razorpay A06

Actual GitHub Actions run **41178212331**, job **124470057673** ("QF MVP 50 Quality Gate" / "Vendor package payment authority"), was the only reported failed run on RC24 head `675d0e5a`: **50/51 PASS, FAIL A06 webhook uses raw body**. The legacy assertion demanded `await request.text()`, which RC24 intentionally removed to cap the actual raw-body stream at 64 KiB before HMAC. The real production webhook route retains raw text and calls `handleVendorPackageRazorpayWebhook(bounded.rawBody, signature)` only after the length/UTF-8 guard.

Changed `scripts/mvp/payments/validate-vendor-package-razorpay.mjs` to enforce **the new stronger invariant**, not weaken the security contract: bounded intake precedes HMAC, raw text is passed unchanged, no unbounded request.text, explicit oversize guard, existing cryptographic verifier unchanged. Executed the **actual exact quality-gate script 51/51 PASS** locally. Added that same command to the protected RC17–RC25 GitHub workflow, alongside `rc25-*.test.mjs`.

## 2. Core transactional commit outcome

The genuinely executed (disposable PG17) review-only native Core writer previously returned `committed:false` when `COMMIT` threw. If the database committed but the response was lost, this was a false "rollback" assertion and could lead to unsafe retries. The writer now responds:
`{ok:false,reason:"COMMIT_OUTCOME_UNKNOWN",conversationId,nonce,committed:null,requiresReconciliation:true,providerMessagesSent:0,canonicalAb7bSourceReady:false}`.

Real disposable PostgreSQL 17 integration now simulates a network error **AFTER a successful SQL COMMIT**, checks the returned state is unknown and confirms the original conversation revision, event and receipt **really are persisted**. Existing replay, staff/city/consent revocation, original AB7B F1 proof and atomicity checks still pass. This is source hardening only; `RC8_CORE_WRITER_INSTALLED=false` and `RC19_VERIFIED_CORE_WRITER_INSTALLED=false` remain.

## 3. Signed EOD transactional commit outcome

The genuine disposable PG17 pending signed-intent writer also falsely reported `committed:false` after a possibly successful `COMMIT`. It now returns `{ok:false,reason:"COMMIT_OUTCOME_UNKNOWN",intentId,subjectId,committed:null,requiresReconciliation:true,approved:false,canAuthorize:false,officialEodEnabled:false}` for ambiguous commit transport failures.

The real PostgreSQL integration simulates this after actual COMMIT, confirms three durable nonce/subject claims and one receipt, verifies no official publication authorization, and preserves replay, signer-key expiry, stale AAL2, Team Leader/Staff membership, source integrity and revocation tests. No human signing keys were enrolled. Official EOD remains HARD OFF; receipt success is not publication.

## 4. Finance V2 and migration release handoff

Finance V2 five-function disposable PG17 test PASS, including exact-once credit, TEST/LIVE isolation and browser RPC denial, **0 provider calls**. The specific A06 regression is corrected as above. No live refund or consumed-credit mutation was attempted.

The SHA-pinned read-only managed Staging migration snapshot still proves **86 applied versions**, **162 source SQL files**, **55 shared**, **31 managed-only**, **107 historical source-only** and **0 straightforward append-only candidates**. The historical Razorpay V1 SQL issue and independently certified Auth/Storage/Vault/roles/ACL/physical objects/PITR recoverability remain blocked. Do not run blanket migration replay or alter migration-history records.

## 5. Combined local tests

- Actual QF MVP 50 Razorpay quality script: **51/51 PASS**.
- RC17–RC25 source tests: **88/88 PASS**.
- VOX final internal source-only regression: **161/161 PASS**.
- Native Core real disposable PG17 including post-COMMIT ambiguity: **PASS**.
- Signed EOD real disposable PG17 including post-COMMIT ambiguity: **PASS**.
- Finance V2 actual disposable PG17: **PASS**, no payment provider calls.
- Root TypeScript: **PASS**.
- VOX Web full `npm test` and production `npm run build`: **PASS**.
- New RC25 contract suite added to workflow, plus independent QF MVP 50 payment authority test.

## 6. Exact remaining blockers — NOT INTERNALLY COMPLETE

1. Managed Staging migration lineage adjudication (31 / 107), reviewed historical V1 correction, dedicated writer roles/grants and qualified independent DBA/AppSec authorization.
2. Fresh full-fidelity Supabase managed Staging recovery proof (Auth, Storage, Vault, roles, ACL/ownership, physical objects and PITR where applicable).
3. Approved operational Core/AB7B original source writer and genuine Staff AAL2 bridge, direct Staff/CRM/Vendor360/Service Desk Staging transactions and all D2 consent mutation integrations.
4. Real-money provider settlement, durable webhook recovery, refund/consumed-credit policy and reconciliation with a protected financial ledger.
5. Official EOD human Owner and distinct TL MFA/signing ceremony, release writer/publishing privileges and real protected Staging acceptance.
6. Actual authenticated end-to-end QA and separate Owner Production GO.

**Operational safety preserved:** PR remains Draft and unmerged, no managed Staging or Production DDL or deployment, no real payment/refund/credit action, no outbound messaging and no official EOD publishing.
