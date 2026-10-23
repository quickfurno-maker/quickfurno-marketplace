# Step 3B-6D — Immutable-source release engineering and rollback runbook
Source candidate ancestry: RC1 SHA `06267c094e9aad9d55bbeef80ac955968c5b75be`; PR #400 draft and unmerged at checkpoint. No runnable Staging deployment change included.
1. Verify branch parent, all file hashes, Phase22 pinned SHA, 7 quarantined + 23 candidate SQL inventory, semantic 52/52 migration discrepancy.
2. Ensure current managed Staging physical/PITR, role/ACL/global grants and storage binaries backup/snapshot capability is explicitly reviewed. A four-schema logical restore alone is INSUFFICIENT.
3. Obtain distinct real DBA and AppSec decisions (signed identity + decision scope), Owner exact-SHA, Staging project ID and change-window scope, break-glass and rollback approvals. Missing or stale evidence => HARD STOP.
4. Run only a separately designed and reviewed Staging migration procedure, never blanket `supabase db push`; record lock timeout, statement timeout, pre/post SQL catalogue outputs, dependency logs and immutable actual executed SHA. This runbook DOES NOT authorize execution.
5. Aborts: unexpected ledger changes, RLS effective access drift, altered privilege grants, active sessions remaining for retired admin, missing legitimate historical support/invoice read, delayed/failed audit record, Auth/provider identity mismatch or outbound/payment action.
6. Failure: stop writes, revoke affected sessions/claims if needed, preserve forensic evidence; DBA executes separately approved restoration or forward fix and certifies data/permission integrity. Don't pretend Auth/Admin API rolls back with Postgres.
7. Promotion from Staging to Production is a NEW independent decision, not implicit in test success.
Current status: unsigned / unapproved / executionPermitted=false / Staging HOLD / Production HOLD.
