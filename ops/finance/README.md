# Finance V2 SQL candidate quarantine
This directory is deliberately **outside** `supabase/migrations`. The existing canonical migration-history reconciliation validator pins precisely which migration versions have been reviewed, and adding unapproved finance candidate versions directly would break the audit chain.

**DO NOT APPLY / DO NOT AUTORUN.** Current candidates:
- `sql-candidates/20261022090100_finance_v2_pay1_integrity_candidate.sql` — normalized manual UTR index, service-only LIVE-vs-TEST collection view.
- `sql-candidates/20261022090200_finance_v2_pay2_history_candidate.sql` — four append-only finance event/attempt/refund/audit candidate tables and immutable-history guard.
- `sql-candidates/20261022120100_finance_v2_pay3_evidence_candidate.sql` — four additional immutable settlement, settlement-line, manual bank-receipt and event-processing evidence tables.
- `sql-candidates/20261022133000_finance_v2_pay3_inbox_candidate.sql` — mutable leased inbox queue with signed receipt references, bounded retries, fencing token, append-only completion evidence and dead-letter visibility; no live webhook wiring.
- `sql-candidates/20261022134000_finance_v2_pay3_refund_reservation_candidate.sql` — captured payment evidence + transactionally serialized, immutable partial refund reservations; no Razorpay refund execution.
- `sql-candidates/20261022135000_finance_v2_pay3_staff_read_candidate.sql` — granular vendor-scoped Finance Staff read grants and immutable revocations; requires genuine Core AAL2 and separate certified bootstrap.
- `sql-candidates/20261022140000_finance_v2_pay3_settlement_projection_candidate.sql` — security-invoker provider-settlement versus ledger-line comparison; never claims verified bank deposit or taxable revenue.
- `sql-candidates/20261022141000_finance_v2_pay3_webhook_receipt_candidate.sql` — atomic immutable signed-event/payment link + idempotent durable inbox receipt, without an alternative wallet-credit authority.
- `sql-candidates/20261022142000_finance_v2_pay3_bank_proof_candidate.sql` — independent immutable bank settlement evidence and service-only three-way reconciliation view; no real bank import or tax certification.
- `sql-candidates/20261022143000_finance_v2_pay4a_refund_release_candidate.sql` — immutable independently reviewed reservation release, conservative gateway-execution block and advisory-locked remaining refund cap; uninstalled and not provider-certified.
- `sql-candidates/20261022144000_finance_v2_pay4a_vox_cases_candidate.sql` — immutable Staff Finance case requests and independent Owner review provenance; approval is evidence-only, not a financial action.

PAY-4A source/rollback/security status: `docs/finance/PAY4A-INTERNAL-READINESS-20261022.md`. All PAY-4A RPCs and UI/workers OFF by default.

Only network-isolated local PostgreSQL17 rehearsal uses them. Before any managed installation independent DBA must:
1. Reconcile real Staging and production migration histories, existing data and all pending changed SQL.
2. Validate current live manual UTR duplicates and banking-reference scoping, vendor-related financial FK deletion behavior, RLS/grants/function search_path, real backup and rollback.
3. Approve exact immutable sources/signatures, issue proper signed migration versions in the canonical migration directory, run controlled protected Staging first.
4. Require independent AppSec/Owner approval, real Razorpay TEST canaries, Finance Staff genuine AAL2 and no-send E2E.

No payment service, approval, gateway key, webhook or wallet is activated by these files.
