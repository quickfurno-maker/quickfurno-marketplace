# QuickFurno Finance V2 — PAY-3 Final Integration source candidate
Date: 22 October 2026 · State: **SOURCE ONLY — RELEASE HOLD**

Parent draft PR chain: #385 (PAY1/2) → #386 (PAY3 read/policies) → #387 (PAY3 SQL inbox/refund/staff/settlement).
This candidate introduces source-gated integration and independent human financial evidence. It is **NOT** a payment release.

## A — signed Razorpay ingestion and test-mode provider worker
The existing vendor-package webhook route is preserved by default. Only when
`FINANCE_V2_PAY3_WEBHOOK_RECEIPT_ENABLED=staging` is explicitly enabled does
it first verify the raw HMAC plus the Razorpay event ID, reconcile mode, merchant
mapping, payment ID, canonical provider order and amount, then call the reviewed
`qf_finance_v2_record_webhook_v1` SQL candidate. The RPC atomically links an
immutable event to a provider payment ID and enqueues a unique job. Identical
replay returns the same event; conflicting replay/mode/amount rejects. Only
after journaling does the original handler fetch provider truth and use the
existing Core exact-once credit activation. No parallel credit authority is added.

`runFinanceV2StagingInboxCanary` is a **separate, explicitly invoked,
test-mode-only** provider GET and receipt-audit processor; it never calls wallet
activation or refund APIs. It is not scheduled, deployed, or automatically
invoked by the webhook. The individual request/retry/dead-letter SQL primitives
were tested in network-isolated Docker PostgreSQL 17.

Variables are intentionally **not configured or activated** in any release:
- `FINANCE_V2_PAY3_WEBHOOK_RECEIPT_ENABLED=staging` — source branch only, OFF
- `FINANCE_V2_PAY3_INBOX_WORKER_ENABLED=staging` — source branch only, OFF
- `FINANCE_V2_TEST_MERCHANT_ACCOUNT_ID` and `FINANCE_V2_LIVE_MERCHANT_ACCOUNT_ID` —
  explicit distinct merchant identity values, required only if receipt gate approved
- Existing `RAZORPAY_VENDOR_PACKAGE_MODE=test` and protected TEST keys apply
  to any staging-only worker; LIVE worker is hard denied.

**Before activation:** independently review HMAC/event ID canonical headers,
credential rotations, order identity and duplicate webhook handling, app
transport semantics, permission-limited RPCs, legacy exact-once wallet behavior,
and actual Razorpay TEST capture/failure/retry canaries.

## B — VOX Finance Staff and banking casework
VOX /finance displays exact Core order UUID, mode, provider/activation status
and read-only filterable event timeline. It does not provide broad unscoped
financial search. Core finance reads require Owner AAL2, or verified Core
Staff AAL2 plus vendor object assignment, active vendor-success department,
independently approved finance grant and fresh revocation recheck.
Manual UTR review policy only issues an **evidence candidate** after a
separate bank statement line matches normalized UTR, amount and receiving
account and is reviewed by a different current MFA reviewer. It never sets
Paid or adds wallet credits. No actual staff grant bootstrap or bank upload
UI/approval mutation is enabled.

## C — settlement/bank/refund governance
Service-only `qf_finance_v2_bank_reconciliation_v` reports
MISSING_PROVIDER_LINES, BANK_EVIDENCE_NOT_VERIFIED, THREE_WAY_DISCREPANCY,
or THREE_WAY_AMOUNT_MATCH. Only immutable bank proof with distinct
recorders/reviewers can yield three-way amount match, which **does not
certify revenue, tax, bank ownership or actual account statement import**.
Refund partial reservations remain transaction-serialized, do not call
Razorpay refund endpoints, and must not claw back consumed vendor credits.

## QA
- Run `node --test scripts/mvp/payments/validate-finance-v2-pay*.test.mjs`.
- Run `node scripts/mvp/payments/validate-vendor-package-razorpay.mjs`.
- Run `scripts/mvp/payments/validate-finance-v2-pay3-pg17.ps1`:
  isolated Docker network none, exact schema/RPC tests, pg_dump restore.
- Run Core and VOX typecheck and Next production builds.
- PAY-3 GitHub CI and broader VOX checks must pass for exact source commit.

## Release and open gaps
- All PAY-2/PAY-3 SQL is in `ops/finance/sql-candidates`, never in
  `supabase/migrations`; do NOT apply to managed Staging or Production.
- Independent DBA must reconcile inherited legacy migration manifest
  (missing `20261014010000_vox_v1_scoped_staff_authority.sql` in current
  worktree) and review security-definer RPC, RLS, retention and rollback.
- Genuine Owner/Staff MFA, approval provenance and role bootstrap required.
- Real provider TEST payment/fail/retry/refund and bank statement verification
  still untested. Provider refund execution, human approval writes, disputed
  payment resolution, consumed-credit policy, ledger→bank posting and actual
  financial settlement import are not implemented/activated.
- Owner PAY-4 final signed GO/NO-GO is mandatory.

**No provider, wallet, Supabase, Staging or Production financial writes during
this source implementation.** RELEASE HOLD.
