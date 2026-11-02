# VOX RC18 — Finance receipt truth, verified Staff identity, recovery and read-only operations

**2026-10-30 · GitHub-only protected implementation · Draft PR #450 · RELEASE HOLD**

## What changed

### Track A — Core Finance, payment activation receipt correctness
- Added `lib/payments/vendorPackagePaymentReceipts.mjs` and `.d.mts` with strict `inspectRazorpayActivationReceipt` and `inspectRazorpayFailureReceipt` guards.
- `services/vendorPackagePaymentService.ts` now accepts activation only when the V2 transaction returns a matching local order ID, exact credited amount, valid vendor package ID and expiry for a fresh activation, or an explicit `already_applied` response with zero new credits. Failed-payment webhook handling distinguishes `marked_failed` from `ignored_paid`/`ignored_refunded`/`ignored_activated`; missing or malformed receipts fail closed. These guards do **not** independently verify money settlement; Razorpay's server-side captured-payment verification remains the separate prerequisite.
- Added `rc18-payment-receipts.test.mjs` positive and negative tests for invalid, duplicate and ignored responses.
- RC17 V2 SQL review candidate now forbids any new order claim unless stored provider is explicitly `not_connected` with no persisted mode; SQL NULL cannot bypass this check. RC17 real PG17 test adds a NULL-provider negative case.

### Track B — Genuine operations Staff identity preflight
- Added `verifyVoxOperationsStaffBearer` in `services/vox/verifiedStaffBearer.ts`: verifies bearer with actual Supabase GoTrue `getUser` before using AAL2 claims; checks current Staff principal metadata, active neutral profile, live unrevoked operations-manager membership, active team and valid city. Rejects AAL1, stale/expired token, revoked, wrong role/team or missing schema without default allowance.
- This is read-only identity **preflight**, not an installed RC8 mutation route or an atomic SQL-bound Staff proof. The writer must recheck authorization and live consent state in its own transaction. RC8 production writer remains hard OFF.

### Track C — Independent Team Leader signer authentication preparation
- Added `verifyVoxTeamLeaderBearer`, using real GoTrue AAL2 token verification and current Team Leader membership, team and city, with no privilege escalation from client-supplied actor claims.
- This function creates no signer key, publication, approval, or EOD receipt; separate cryptographic signing and human enrollment plus approved atomic writer remain P0. Existing RC17 review-only service-role publication revocation stays uninstalled.

### Track D — Database recovery and release evidence
- Added `scripts/mvp/vox/rc18-finance-release-recovery-preflight.mjs`, a read-only checksum and gap assessment for the historical Razorpay V1 migration and review-only V2 five-RPC candidate. It always reports explicit `HOLD` until independent managed inventory/restore and approvals.
- It flags suspicious historical V1 function dollar delimiters and first-claim token logic for actual ledger verification, **without altering an immutable migration checksum**.
- New PG17 SQL case rejects NULL-provider order claim (not just unexpected modes) and protects exact TEST/LIVE replay behavior.

### Track E — Better read-only Finance UI
- Owner Finance now shows how many records in the **bounded** recent Core snapshot have `pending` or `failed` status, with explicit wording that provider reconciliation is a separate evidence process. Existing status filters and read-only guarantees remain; this is not a comprehensive financial ledger.

### Track F — QA and exact-head CI
- Added `rc18-staff-auth-preflight.test.mjs` and `rc18-eod-recovery-finance.test.mjs` in addition to payment receipt tests.
- Updated `.github/workflows/vox-rc17-six-tracks-hold.yml` to trigger on RC18 source files, run RC17+RC18 source-contract/security tests, TypeScript check and real disposable PG17 V2 integration; no managed credentials, external Razorpay providers or production migration applies.
- **CI is queued/pending; no new exact-head GREEN claim is authorized.** Run results must be inspected for failures and fixed rather than waived.

## Mandatory blockers before functional launch

1. **Finance:** exact historical V1→V2 source/managed ledger reconciliation, approved forward migration, actual captured-payment authority/financial reconciliation, refunds and consumed-credit handling, real managed restore and separate activation authorization (#451).
2. **Core:** verified Owner/Staff AAL2 connected all the way into the transactional native Core writer, canonical consent writers sharing destination serialization and genuine client project ownership, independently approved AB7B/ACL (#444).
3. **EOD:** two independent human Owner and Team Leader keys, real current authentications, durable nonce claims, a narrowly authorized publication writer with signature proof, human approvals (#447).
4. **Database/release:** independently qualified human DBA and AppSec decisions, source-vs-managed schema parity, full Supabase-compatible Auth/Storage/Vault/ACL/PITR restore, release candidate exact-head CI, authorized Staging then separate Production Owner GO (#420).

**No managed database or payment/provider/identity mutation and no Staging/Production deployment. PR #450 remains Draft. Release HOLD.**
