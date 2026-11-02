# VOX RC22 parallel source and disposable-runtime checkpoint — 31 October 2026

**Scope:** consolidated Draft PR #450; local JARVIS Windows machine, Docker Desktop Linux PG17/GoTrue/PostgREST; no managed Staging/Production changes. RC22 is an engineering/QA batch, not release authorization.

## A — database recovery and migration review

- New deterministic `scripts/mvp/vox/rc22-migration-release-packet.mjs` inventories **162 deployable source migration SQL files** with an aggregate SHA256, pins the known historical malformed Razorpay V1 migration and the uninstalled review-only V2 function candidate by SHA256, and emits a strict `HOLD` with five external evidence requirements. **2/2 unit tests pass.** No connection, row read, secret, migration or restore is performed.
- Prior isolated real PG17 **seven-migration restore PASS** (10 VOX tables, all FORCE RLS, 0 policies intentional default-deny, 5 functions, archive checksum, tested anon denial). This is not Supabase Auth/Storage/Vault/physical objects/PITR restoration.

## B — Finance webhook and ledger authority

- New `lib/payments/vendorPackageWebhookBoundary.mjs` and TypeScript `.d.mts` declaration. The HMAC-verified webhook handler now rejects inconsistent payment/order identity, and safely ignores unrelated signed event types **before** privilege-bearing order lookup or provider fetch. Known `payment.captured` continues to fetch provider truth server-side before the existing transaction/credit gate; `payment.failed` continues to require the existing failure receipt. No refund, capture or provider action is added.
- **4/4 new webhook tests passed**, plus existing payment receipt tests, and root TypeScript passed. Existing real disposable Finance V2 **five SQL function PG17 PASS** with zero provider calls. Actual managed provider reconciliation, refund and consumed-credit reversal still absent/unauthorized.

## C — authorized Core

- Real disposable PG17 test now verifies the **immutable approved client-project binding can expire after the original lock but before COMMIT**. A dedicated short-lived synthetic binding and clock wait are used (no attempt to modify immutable approval), and the native transaction rolls back with **zero additional conversation event, receipt, revision or takeover**. Existing Staff scope-expiry, D2 consent, signed source and zone-revocation tests remain. Live writer stays hard OFF.

## D — independent signer verification

- RC4 exports a pure recheck of the **branded, server-minted verified Owner and Team Leader AAL2** contexts using the original verifier rules. The real PostgreSQL pending-EOD receipt writer checks freshness again before COMMIT, in addition to the already implemented envelope and session expiry checks.
- Genuine isolated PG17 test ages AAL2 from valid at verification to older than the 15-minute freshness policy before COMMIT while keeping signed envelopes and sessions valid. **Full nonce/receipt rollback verified**; synthetic signing keys only, production signer publication hard OFF, no actual humans enrolled.

## E — continuous integration and release gates

- Integrated **RC17–RC22 source-contract 66/66 PASS**, final source-only 161/161 PASS, real local GoTrue/PostgREST TOTP AAL2 **8/8 PASS**, Finance/Operational Core/signed-EOD real PG17 suites PASS, isolated seven-migration restore PASS, root TypeScript PASS, full VOX Web `npm test` PASS and Next.js production build PASS. The locally tested fail-closed loopback HTTP 8/8 remains prior evidence, not authenticated Staging acceptance.
- Existing `vox-rc17-six-tracks-hold.yml` now runs RC21/RC22 source tests and prints the HOLD migration inventory, without activation. Exact-head GitHub Actions need their own completed results after push.

## Outstanding hard gates (unchanged)

1. Independent DBA/AppSec adjudication of the live migration ledger and legacy V1 replay; exact managed Supabase-compatible restore including Auth/Storage/Vault, roles/RLS and physical objects.
2. Payment-provider reconciliation, webhook recovery, consumed-credit policy and independently authorized real refund/reversal accounting.
3. Approved canonical Staff/Core/AB7B consent writer integration and protected Staging authenticated functional acceptance for all intended VOX features.
4. Real Owner and Team Leader MFA, separate human signing ceremony, verified publication authority and independent review.
5. Explicit Owner Production GO and completed exact-head CI.

**Release decision: HOLD.** Draft PR #450 unmerged. No managed SQL installs, real payments/refunds/credits, provider sends, live Staff onboarding or official EOD publication.
