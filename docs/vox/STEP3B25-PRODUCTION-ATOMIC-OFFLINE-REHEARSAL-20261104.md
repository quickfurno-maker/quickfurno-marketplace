# 3B25 — Production TEST-only atomic deletion rehearsal on authentic November 3 restore

**Date:** 4 November 2026
**Status:** Production **offline scratch rehearsal COMPLETE**; managed Production/Staging **DELETE HOLD**.
**User decision:** permanently remove Pune/Mumbai TEST vendors/leads for final launch when secure release gates are actually met. This does not authorize disabling protected live audit controls, bypassing an independently reviewed protected-history exception, or claiming live cleanup occurred.

## What actually ran

This was **not source-only**. On JARVIS, a freshly created disposable container `qf-3b25-prod-atomic-isolated-20261104` used `public.ecr.aws/supabase/postgres:17.6.1.165` with `--network none`, no public ports, and the private Production November 3 archive mounted **read-only**. Original archive was independently verified: **4,891,678 bytes**, SHA256 `679457E1FEFB79FBB2996F11E3BAD6077FCE476C430FA3996F82565066BF516F`.

The full 4-schema Production archive restored with **original object owners, table/function/default ACLs preserved** (`pg_restore --single-transaction --exit-on-error` as isolated `supabase_admin`) — **exit code 0**. A restored source database was cloned into disposable `qf_purge_production`; zero managed database connections were made by this rehearsal.

Isolated original: **29 TEST vendors**, **74 TEST leads**, **73 protected immutable assignment events**, **10 Auth users** (includes Owner/nonvendor principal), **83 automation action requests**, **83 jobs**, **25 attempts**, **32,165 transport requests** and **0 invalid foreign keys**.

`scripts/scale/step3b25_production_atomic_offline.py` is a **non-networked private SQL generator** building the exact four pinned private cleanup components into one all-or-nothing transaction, using the previously tested `step3b21_staging_atomic_offline.py` strict source unwrap and SHA-256 pinning, and removing all prior cross-database dblink dependencies. It can generate private SQL only; neither Python module contains DB credentials, a network driver, or an execution operation. The generated SQL itself refuses any database name except `qf_purge_production` and additionally demands the local `qf_source_production` source database, exact original data counts and the fixed historical UUID-set fingerprints.

The original four private SQL source files, archive and generated executable SQL are **excluded from Git**; the final generated script is stored only in the restricted JARVIS Artifacts location.

## Genuine execution evidence: positive, rollback and negative

| Isolated test | Result |
| --- | --- |
| Source full restore with preserved ownership/ACLs | **PASS**, pg_restore exit 0 |
| Positive transaction on `qf_purge_production` | **PASS, COMMIT**, psql exit 0 |
| Post-transaction scoped roots | **0 vendors / 0 leads / 0 assignments / 0 immutable events / 0 vendor-credit logs** |
| Protected Auth users after transaction | **10 unchanged**, including Owner/nonvendor and the nine dedicated TEST Auth users; real Auth deprovisioning is intentionally a separately approved Admin API operation |
| Protected non-target automation after-image | **32,114 transport requests** retained; 83 test action requests/jobs, 25 attempts and 51 linked transport requests removed |
| Structural and audit integrity | **0 invalid foreign keys, 0 disabled user-defined triggers, 0 payment rows** |
| Original target ID reference scan after cleanup | **0 residual matches** in public base-table JSON scanning; any scanning error/timeout would cause a rollback |
| Full same-operation transaction with terminal `ROLLBACK` on a fresh clone | **PASS, ROLLBACK**, psql exit 0; original 29 vendors, 74 leads, 73 immutable events, 10 Auth users and 32,165 transports unchanged |
| Wrong-database negative run against `qf_source_production` | **PASS denial**, exact `QF_PROD_OFFLINE_ONLY_WRONG_DATABASE` before mutation; source original 29/74/73/10 unchanged |

Private artifacts and hashes (do not upload raw records, tokens or executable SQL to GitHub):

- Production restore log `QF-20261104-PRODUCTION-ISOLATED-RESTORE-LOG.log` SHA256 `174231C899F8746F296F1EB1B75F4AD4A61B465A5DCAEFD6646E1B33A2A7944F`.
- SQL `QF-20261104-PRODUCTION-ATOMIC-OFFLINE-TEST.sql` SHA256 `A420262BBBE8C218A2F5885D3B29B12B900AC93493E996E23BD1818164A1C03A`.
- COMMIT log `QF-20261104-PRODUCTION-ATOMIC-OFFLINE-TEST-RESULT.log` SHA256 `1BA05FD487AA3E6112BE63CEAE0C89C539D926E0A338690F8A2078F045FC9108`.
- ROLLBACK log `QF-20261104-PRODUCTION-ATOMIC-OFFLINE-ROLLBACK-RESULT.log` SHA256 `5B288D2512AA224B8D991691BFCC647B5605A4079BD3809B7E3AC070DFDFA500`.

The generated SQL executes **temporarily disabled narrowly scoped immutable triggers within the disposable clone** and re-enables them before final postflight. That is a test of the exception's feasibility, **NOT approval to suppress a protected ledger on a managed database**.

## Release conclusion and remaining real-world dependencies

**Resolved:** genuine Production single-transaction deletion ordering and revert, full-schema local ownership/ACL restore, Auth preservation, target ID and non-target automation retention checks, no cross-DB dblink, wrong-DB protection. Production source test gates now validate the generator against malicious/unexpected input and ensure all cases are non-deploying.

**Still unreleased:**
1. Qualified independent DBA and AppSec approval of the permanent TEST-only immutable-event, campaign, vendor-note and automation-history erasure exception; evidence custody and proper legal/PII/finance retention disposition. [Blocking issue #413](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/413) remains OPEN. No independent PR #414 review submitted.
2. Current actual **managed** Supabase backup/PITR, restore, roles/ACL, Auth API/user recovery and Storage-object rollback proof. Logical PostgreSQL restore, even preserving ACLs, cannot certify the managed platform. Production online census from previously blocked access requires a permitted channel and fresh exact-ID allowlist/fingerprint reconciliation.
3. Verified full writer/provider/cron/queue freeze with independent operations proof; never shut down shared Jarvis/AGNI/Traefik blindly. For Staging specifically, the running `qf-core-staging` and `qf-vox-20261102-mfa-ui-test` containers were found dependent on Staging.
4. Execute **Staging first** under an independently reviewed managed-specific procedure, preserving the one unrelated canary and two unrelated Auth users; only then certify a separate Production exact-ID transaction and supported Supabase Auth Admin deletion of the nine dedicated TEST Auth principals, preserving the unrelated Owner principal.
5. Govern private backup, PITR snapshot and provider-copy retention; live row deletion does not automatically erase retained external copies.

**This batch changed no managed Staging or Production records, triggers, Auth users or providers.** No buyer/seller live launch approval is inferred from source CI, offline success or deletion authorization.
