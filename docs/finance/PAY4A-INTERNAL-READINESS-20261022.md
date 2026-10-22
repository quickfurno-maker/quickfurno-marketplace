# PAY-4A — Internal Database, Finance Operations and VOX Review Candidate
**Date:** 2026-10-22 (Asia/Kolkata)
**Branch:** `test/finance-v2-pay4a-internal-20261022` stacked on PAY-3 Final Integration draft #388.
**Classification:** INTERNAL SOURCE REVIEW ONLY · Release HOLD · NEVER execute PAY-4A SQL against managed Supabase without independent DBA/AppSec and Owner approval.

## Track 1 — Migration inventory and security
The inherited validator `scripts/mvp/migration/validate-qf-phase1-migration-reconciliation.mjs` expects
`supabase/migrations/20261014010000_vox_v1_scoped_staff_authority.sql` and errors ENOENT on this branch.
This is **not a missing source**: the SQL is in
`ops/vox/quarantined-migrations/legacy-20261014/20261014010000_vox_v1_scoped_staff_authority.sql`.
The historical pinned SHA-256 is
`a5d0da20590b178b5e0aaff5045fe9957e367f9396baea4e86222bcc7d076c4c` and matches the
quarantined source. The post-G1 ledger indicates `exactVersionPresence.staging=false` and `production=false`;
its old `path` points to the no-longer-runnable migration directory.

`scripts/mvp/payments/audit-finance-pay4a-migration.mjs` now checks source bytes against
the ledger, remote presence assertions recorded in the ledger (NOT fresh remote checks), unauthorized
runnable copies and candidate collisions. It **never** rewrites deployment history.
Independent DBA action: reconcile canonical manifests and live migration lists against evidence,
decide whether the legacy migration remains quarantined, and authorize only a signed explicit
new staging migration manifest. **Do not copy this SQL into supabase/migrations or disable validation
to make the older validator pass.** Historical validator currently remains FAIL; isolated QA does not
waive this.

Finance candidate audit:
- PAY1/PAY2 and PAY3/PAY4A candidates remain outside `supabase/migrations`.
- All 18 candidate financial tables in offline PostgreSQL 17 use FORCE RLS and exclude
  anon/authenticated direct SELECT/INSERT. Security-invoker read views are service-role only.
- `security definer` RPCs pin `search_path`, revoke public/anon/authenticated EXECUTE and
  use service-role-only runtime. Reviewer must verify execute privileges in the actual managed
  database, extension grants, search-path shadowing and Supabase RLS behavior.
- Immutable financial history has BEFORE UPDATE/DELETE triggers. The lease queue is the
  only deliberately mutable processing state; it needs atomic row locks and lease fencing.
- New PAY4A review cases have requester-provenance constraints and a separate owner review record.
- Old database vendor-delete cascade relations, payment/order FK retention and retention policies
  need independent schema inspection against actual staging backup before certification.
- SQL comments and source checks cannot establish financial bank receipt or tenant ACL correctness;
  generate a post-deploy read-only privilege diff and independently sign it.

### Rollback/restore
Use a verified native PostgreSQL 17 pre-change backup (plus object inventory/role privilege snapshot).
Quarantined Finance candidates are installed **only in a disposable isolated Docker database**
for tests; test restores the original backup and asserts zero `finance_%` tables.
For actual Staging, prepare a DBA-reviewed forward recovery/compensating migration and isolated
`pg_restore` rehearsal. Do not drop PAY2/PAY3/PAY4A finance tables once genuine money records exist;
halt workers, preserve immutable ledgers and arrange transaction-safe forward remediation.
No Production rollback plan is certified.

## Track 2 — Payment operations and recovery
- Dedicated `POST /api/internal/finance-pay4a-canary` is **OFF by default** and TEST only.
  Requires exact `FINANCE_V2_PAY4A_CRON_ENABLED=staging`,
  `FINANCE_V2_PAY3_INBOX_WORKER_ENABLED=staging`,
  `RAZORPAY_VENDOR_PACKAGE_MODE=test`, and an internal Bearer token from
  `FINANCE_V2_PAY4A_CRON_TOKEN` (>=32 bytes/characters). No real cron, schedule,
  API secret, external provider request or database job is created by this change.
  Worker is audit-only and uses DB lease fencing. Real scheduling requires a secured
  separate scheduler and alerting/timeout/retry/replay setup after Staging certification.
- `20261022143000_finance_v2_pay4a_refund_release_candidate.sql` appends immutable
  cancellation/release proof; existing refund reservation rows remain preserved.
  The SQL refuses release if *any* gateway refund journal on the same payment attempt exists.
  It requires independent requester/approver and a purported provider non-submission proof
  fingerprint. Because external provider evidence is not itself verified in SQL, the
  release function **must stay uninstalled and uninvoked** until reviewed upstream
  Razorpay GET/reconciliation and independent approval provenance are integrated.
  Reused approval IDs fail closed; transactional advisory lock preserves cumulative cap.
  Even approved refund requests do NOT submit Razorpay refund or reverse vendor credits.
- If package credits have already been consumed, automatic clawback is prohibited.
  Human refund policy, cost allocation and positive reconciliation evidence remain P0.

## Track 3 — VOX Finance review casework
- One shared `financeStaffAllowed` service enforces actual Core Staff AAL2,
  department enforcement, current vendor object assignment, independent expiring
  Finance grant and revocation checks; no second auth system.
- `POST /api/vox/v1/finance-case` creates a narrowly-scoped, evidence-hash-only
  manual receipt or refund-policy request under `FINANCE_V2_PAY4A_CASE_WRITES_ENABLED=staging`.
  New `finance_staff_case_requests` SQL candidate has requester+UUID dedup and FORCE RLS.
- `GET/POST /api/vox/v1/finance-case-review` uses independently verified Owner Superadmin
  AAL2; reviewer must differ from staff requester. Decision is a separate immutable row
  in `finance_staff_case_reviews`; 'APPROVED_FOR_FURTHER_CHECKS' deliberately grants
  **zero financial execution authority**.
- VOX /finance gains an evidence request form and Owner review inbox, gated with
  `VOX_FINANCE_PAY4A_CASE_UI_ENABLED=staging` and the existing Staff portal gate.
  Proxy requests use the existing VOX MFA server session; no client service-role secrets.
  The interface remains disabled in production and shared staging until signed approval.
- Exact canonical order ID remains the only Finance history lookup; broad indexed
  cross-payment UTR/vendor history search, reviewer roster/provenance bootstrap, private
  bank file upload, and payment-status mutation workflows remain **not complete**.
- A 64-character SHA-256 fingerprint is not a bank statement authenticity check.
  Real bank-document storage with retention/access controls and bank-line reconciliation
  must be certified before any Paid or refund action.

## Continuous QA and external gates
Offline QA covers wrong-mode/tampered event/lease replay, duplicate requests,
self review/incorrect provenance, pending refund caps/release, RLS, bank reconciliation,
and pre-change pg_dump/pg_restore in a network-disconnected database. Core and VOX
TypeScript/full Next.js builds and original Razorpay 51-case validation run on every PR.
The Finance PAY-4A development branch is stacked on #388, not merged, deployed or activated.

**Required next:** independent DBA/AppSec review including raw migration hashes/role-grant SQL,
auth and finance case legal/privacy handling, real Staging MFA + staff grants,
Razorpay TEST true capture/failure/refund/retry/duplicate, statement imports and credit
reversal policy, QA and signed Owner GO/NO-GO. All release switches remain OFF.
