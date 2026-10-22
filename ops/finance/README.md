# Finance V2 SQL candidate quarantine
This directory is deliberately **outside** `supabase/migrations`. The existing canonical migration-history reconciliation validator pins precisely which migration versions have been reviewed, and adding unapproved finance candidate versions directly would break the audit chain.

**DO NOT APPLY / DO NOT AUTORUN.** Current candidates:
- `sql-candidates/20261022090100_finance_v2_pay1_integrity_candidate.sql` — normalized manual UTR index, service-only LIVE-vs-TEST collection view.
- `sql-candidates/20261022090200_finance_v2_pay2_history_candidate.sql` — four append-only finance event/attempt/refund/audit candidate tables and immutable-history guard.

Only network-isolated local PostgreSQL17 rehearsal uses them. Before any managed installation independent DBA must:
1. Reconcile real Staging and production migration histories, existing data and all pending changed SQL.
2. Validate current live manual UTR duplicates and banking-reference scoping, vendor-related financial FK deletion behavior, RLS/grants/function search_path, real backup and rollback.
3. Approve exact immutable sources/signatures, issue proper signed migration versions in the canonical migration directory, run controlled protected Staging first.
4. Require independent AppSec/Owner approval, real Razorpay TEST canaries, Finance Staff genuine AAL2 and no-send E2E.

No payment service, approval, gateway key, webhook or wallet is activated by these files.
