# STEP3B21 — One-transaction Staging TEST-data erasure rehearsal (actual restored schema)

**3 November 2026 • Review-only implementation on existing Draft PR #414 • No live managed SQL/Auth/worker/provider changes.**

## Decision and scope

Owner has repeatedly authorized **permanent deletion**, not archive-in-place, of the identified Pune/Mumbai TEST vendors/leads in Production and Staging. This certificate relates to the **Staging TEST cohort only**. It does not certify authorized managed deletion, Production, Owner-account Auth revocation or deletion from retained backups.

Root scope in restored Staging: 26 TEST vendors, 7 TEST leads, 9 assignments, 6 immutable events and 6 test-linked credit logs. One unrelated Staging canary vendor and two unrelated Auth users must survive. There were no Staging vendor-linked TEST Auth users and no recorded payments.

## What was implemented

- `scripts/scale/step3b21_staging_atomic_offline.py`: strict, non-networked generator assembling **four existing privately stored PostgreSQL cleanup probes** into **a single transaction**. The original November 3 scoped UUIDs are captured in a temporary table *before* deleting any root, so later automation/communication/opaque-reference cleanup reads a stable in-transaction source. Unlike the earlier scripts, the generated transaction has **no cross-database `dblink` dependency**.
- Every source must have the recognized offline-only header and transaction framing; the generator rejects missing exact-ID drift guards, deleted protected-history guard references, auth.users raw deletes, broad TRUNCATE, replication-role changes and unexpected SQL layout.
- The generated SQL **refuses any database other than `qf_purge_staging`** and additionally requires the isolated `qf_source_staging` sidecar, exact original total counts, two protected Auth users and no payments. It locks root and protected-history tables, retains named trigger exceptions strictly inside the disposable transaction, verifies post-commit requirements *before* COMMIT and aborts if residual UUID scanning returns any reference, timeout or error.
- Generated SQL is kept **private, outside Git** at `D:\QuickFurno-Workspace\Artifacts\QF-20261103-ATOMIC-STAGING-ISOLATED-REHEARSAL-v3.sql`; SHA256 `BCEC3C1414B81525C9203130A06C7A9D595D7E93F55EABFBAAFFF32FD93E48E1`. The original private backup and SQL sources also remain off Git. The generator now checks the raw SHA-256 of each of the four exact private SQL sources before it can generate output, and rejects modified source bytes.
- `scripts/scale/step3b21_staging_atomic_offline_test.py`: eight fail-closed generator regression tests, including wrong source, incomplete transaction, protected guard removal, cross-DB reference substitution, unauthorized auth DELETE and unsafe TRUNCATE.
- The existing **VOX Source Gates** GitHub workflow now runs the focused cleanup source/guard tests (Node + Python), with no production secrets, DB credentials, provider messaging, or deployment capability.

## Actual network-isolated restored-database evidence

Used `public.ecr.aws/supabase/postgres:17.6.1.165` with `--network none`, no published ports, original November 3 Staging archive mounted **read-only**, and source evidence mounted read-only. Original archive SHA256 `720165400E7B8807CAFEC19D81AF9B9C606FD234A1D3B95FD6B285D996FBD1A5`. PostgreSQL 17.6 full-four-schema logical restore + real FK/trigger/RLS reconstruction PASS (with --no-owner/--no-acl). This does **not** certify managed Supabase Auth/role/ACL/Vault/PITR/Storage binary recovery.

| Test | Observed result |
| --- | --- |
| Original restored Staging | 27 vendors including one unrelated canary; 7 leads; 6 immutable events; 106 automation action requests; 2 Auth users |
| First atomic attempt | **Denied** because `dblink` was not available before automation step; all writes automatically rolled back |
| Second atomic attempt | **Denied** by PostgreSQL password requirement for cross-DB `dblink`; all writes automatically rolled back |
| Revised single-transaction run | **PASS, COMMIT** with 26 TEST vendors, 7 TEST leads, 6 protected events, 70 linked automation requests/jobs, 17 attempts, 42 transport requests and scoped dependent rows erased |
| After-image | **1** unrelated canary vendor; **0** leads/events/assignments/credits; **2** untouched Auth users; **36** unrelated action requests/jobs, **42** attempts and **115** transports retained |
| Integrity | Zero invalid foreign keys, zero disabled noninternal triggers, **zero** original target UUID matches in scanned public base tables |
| Full-transaction ROLLBACK | **PASS**: after deliberately replacing the final COMMIT with ROLLBACK, original 27 vendors, 7 leads, 6 events and 106 automation action requests remain; all protected triggers still enabled |
| Wrong-database negative test | **PASS**: `qf_source_staging` refused with `QF_OFFLINE_ONLY_WRONG_DATABASE` before any mutation; original 27/7/6 counts and active triggers unchanged |
| Local regression suites | Existing **61/61 Node** source gates and new **8/8 Python** generator tests PASS |

The snapshot-source sidecar is used only to make both positive and negative tests reproducible: no dblink source read or external connection remains in the generated transaction. The immutable triggers are enabled in both source and final scratch image. There was **no managed Supabase SQL or Auth write**, and the original TEST rows remain in managed Staging and Production.

## What this closes and what remains

**Closed in this batch:** exact four-source SHA-256 input pinning, combined atomic Staging deletion order and rollback on a true schema clone, stable in-transaction original-UUID matching, protected Staging canary/Auth/automation survivor assertions, negative wrong-database guard and automated CI source tests.

**Not closed / live P0 HOLD:**
1. Independent DBA and AppSec review of the exceptional handling of immutable assignment history, frozen campaign audience membership, append-only vendor internal notes and automation histories. In scratch, narrow named triggers had to be temporarily disabled within the transaction. **This is a deliberate security exception proposal, not a license to disable live triggers.**
2. Genuine managed full recovery/rollback certification including roles, ACL, Auth API, extensions, Storage objects and PITR; the restored logical dump is insufficient by itself.
3. Certified managed Staging maintenance freeze across workers, lead matching, provider/outbox queues, finance, callbacks and new-signup ingestion. A record-count SELECT cannot certify a frozen worker.
4. Live Staging independent exact-ID recheck and operational approval of a *separately reviewed managed procedure*. The generated scratch script is deliberately **incompatible** with managed database names and must **never be run there**.
5. Production permitted read-only recheck currently blocked by connected service safety controls; do not circumvent. Production Auth Admin API lifecycle for only the nine dedicated TEST identities and preservation of the Owner account remains separately gated.
6. Backup retention, provider copies and unstructured TEST PII deletion/expiry evidence; live row erasure does not imply immediate deletion of all snapshots.

**Release verdict:** Code and isolated PG17 transactional rehearsal complete. Managed Staging and Production **DELETE HOLD**; Owner permanent-deletion authorization is already on record; no further preference approval is required. Keep genuine registration, live assignments, provider messaging and Finance activation HOLD until their own end-to-end and security gates pass.
