# VOX — A–E isolated worktree batch, 31 October 2026

## Provenance and release boundary

The five isolated Windows/JARVIS Git worktrees were all cut from consolidated Draft PR #450 head `8edc32d34777aa3087cdd4096ab0f98a2097a294`:

- Track A: `qf-vox-track-a-20261031` (restore and RLS)
- Track B: `qf-vox-track-b-20261031` (Finance)
- Track C: `qf-vox-track-c-20261031` (Core)
- Track D: `qf-vox-track-d-20261031` (signed EOD)
- Track E: `qf-vox-track-e-20261031` (VOX Web and QA)

Each produced a separately committed patch, verified locally, then was cherry-picked into the existing PR branch without merging or force-pushing anything to `main`.

## Changes and real evidence

**A — database recovery:** Enhanced the **isolated seven-migration PostgreSQL 17 restore** in `scripts/mvp/vox/validate-vox20-isolated-recovery.ps1` to capture and compare policy and function inventory in addition to table count, forced RLS, source/restored roles, privileges, and checksum parity. Direct disposable result: `VOX20_ISOLATED_PG17_SEVEN_MIGRATION_RESTORE_PASS` with **10 VOX tables, 10 forced-RLS, 0 policies (intentional default-deny), 5 functions, 7 migrations, source/restored checksum and access-denial parity**. Initially an overly strict assertion incorrectly required at least one policy; the actual source security design uses zero policies, so the assertion now requires exactly zero and fails if one unexpectedly appears. This is NOT a full live Supabase Auth/Storage/Vault/PITR restore.

**B — Finance:** New pure `lib/payments/vendorPackageCreditLedgerReview.mjs` and `rc21-credit-ledger-review.test.mjs` evaluate *provided* order-scoped debit evidence. Exact order/vendor identity, UUID lead, unit debit, one lead/one credit, consumption totals and duplicate charge denial are verified; missing and cross-order rows deny. Every result explicitly has `refundAllowed:false`, `creditRevocationAllowed:false`, and `requiresHumanReview:true`. This is a **read-only review primitive only**, not independently proven provider settlement, source provenance, refund execution, credit reversal, or a new authority path. The existing Finance V2 five SQL functions again passed on genuine disposable PG17 with zero provider calls.

**C — Operational Core:** `rc8PgVendorConversationOperator.ts` and `rc19VerifiedConversationWriter.ts` now reject `expectedRevision>2147483646` before attempting a PostgreSQL int4 revision increment. New source guard test. Actual disposable PG17 native Core transaction/consent/AB7B F1 receipt and rollback suite passed. Live writer remains hard OFF and canonical managed SQL/Staff approval outstanding.

**D — signed EOD:** The RC4 verifier now returns the minimum signed-envelope expiry to the native pending-intent writer. Before transaction COMMIT, it rechecks signed envelope, Owner and Team Leader session expiries and Team Leader membership expiry. On failure, full transaction ROLLBACK is required. Added source guard and a **genuine disposable PG17 regression** that forces post-verification expiry before commit and verifies **zero persisted nonce claims and zero receipts**. The source's production writer flag and human approval gates are unchanged (disabled); this is not official EOD signature enrollment or publication.

**E — UI and continuous QA:** Vendor 360 distinguishes missing MFA from 403 scope denial and 503 Core unavailability, and sends only genuine 401 to Login. Operations no longer loops an already verified user back to Login when Core is unavailable. Added regression tests; a full VOX Web `npm test`, production `npm run build`, and root `npm run typecheck` passed on the consolidated branch. No claim that protected managed Staging feature actions are active.

## Consolidated local QA

- RC17 through RC21 source/contract test suite: **57/57 PASS**.
- Finance V2: **real disposable PG17 five-function PASS**, provider calls 0.
- Native Core: **real disposable PG17 transaction/consent PASS**, no outbound sends.
- Signed EOD: **real disposable PG17 PASS**, including expiry-before-COMMIT rollback and synthetic keys; official publication disabled.
- Synthetic seven-migration restore: **real disposable PG17 PASS** with tables/RLS/policies/functions and privileges.
- Root TypeScript: **PASS**.
- VOX Web full `npm test` and Next.js production build: **PASS**.
- Existing local real-GoTrue TOTP AAL2 8/8 PASS is prior evidence only, not rerun in this five-worktree batch.
- The above results are local. **GitHub Actions results for the new exact head must be checked after push** and are not inferred from local success.

## Open production gates

1. Historical Razorpay V1 migration replay defects and managed-schema inventory adjudicated by qualified independent DBA/AppSec. Candidate V2 financial SQL remains REVIEW ONLY, uninstalled.
2. Exact managed Supabase-compatible restore, including Auth, Storage objects, Vault, roles/grants, RLS, PITR as applicable. Synthetic restore does not certify these.
3. Genuine Razorpay reconciliation/webhook/refund/consumed-credit accounting policy and atomic activation/reversal; no refund or provider operation enabled.
4. Canonical Core AB7B approval, Staff AAL2, consent serialization and real Vendor 360/CRM/Service Desk workflows in protected Staging.
5. Actual Owner/Team Leader MFA enrollment, independent signing key ceremony, reviewed EOD publication authority.
6. Full managed Staging UI/functional E2E acceptance and explicit Owner Production GO.

**Release remains HOLD**. No managed Staging/Production changes, no real credits/payments/refunds, no provider messaging, no official EOD publication, no bypass of human review.
