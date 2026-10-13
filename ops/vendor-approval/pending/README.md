# Vendor Approval V3 — Pending Migration

This SQL package is intentionally kept outside the canonical Supabase migration directory until a reviewed Staging migration release. The repository's legacy staging-history validation requires an explicit ledger reconciliation for any new runnable migration.

The application calls a restricted Core database function for public-profile approvals. Until the reviewed migration is applied and verified on the intended Staging project, approval fails closed; do not deploy the application ahead of the migration.

The SQL has been tested against an isolated PostgreSQL 17 database restored from the certified Staging backup. Those tests do not constitute a live Staging application or database deployment.

Requirements before enabling: confirm latest backup and database identity, apply the exact reviewed SQL through the governed Staging migration process, verify function grants, triggers, audit records and replay/stale behavior, and then certify and release the immutable Staging application digest. Production requires a separate release approval.
