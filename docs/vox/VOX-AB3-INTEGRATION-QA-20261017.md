# VOX AB-3A + AB-3B — Governed integration and isolated QA

**Date:** 17 October 2026. **Classification:** SOURCE CANDIDATE, RELEASE HOLD.

**Branch:** `feat/vox-ab3-integration-qa-20261017`, based on local/remote `test/vox-ab2-integration-20261017` which combines earlier unmerged AB-2 Core/Web draft features. Neither branch grants production/staging approval. Cursor independent review explicitly deferred.

## Implemented in AB-3A
- **Actual protected Core HTTP route** `GET /api/vox/v1/ab3-domain-work`, node runtime, default OFF unless all four flags are exactly `staging`: `VOX_AB3_DOMAIN_READ_ENABLED`, `VOX_STAFF_GRANTS_ENABLED`, `VOX_DEPARTMENT_ENFORCEMENT_ENABLED`, `VOX_WORK_QUEUE_READ_ENABLED`.
- Calls the existing separately authenticated/Core-verified `work-queue` handler using the same real Bearer. Role-to-department selection is **server-controlled**, not a browser filter: acquisition_agent→acquisition, vendor_success_agent→vendor_success, support_agent→service_support. Client-only Riya cases and TL are not exposed by this route.
- Fresh verified Staff AAL2/team/city/current approved department rechecks, canonical DB work state/revision/assignee and source object grant rechecks for each item, before and after source projection. Bounded 25 metadata rows only, no PII, no complete workload count, no actions, no page authorization.
- Explicit POST/PUT/PATCH/DELETE HTTP **405**; disabled GET **503**. No existing lead matching/credit/invite paths modified.

## Implemented in AB-3B
- **Staff independent invitation evidence**: SQL candidate `20261017030000_vox_ab3_staff_invitation_review_candidate.sql` creates immutable pending requests and separate immutable human decisions. Checks owner and different current TL/active team/city/unique nonce/reviewer decision and allowed department packs. Neither table provisions Auth users, sends invites, or activates grants. Depends on separately verified genuine Superadmin/TL AAL2 sessions in future signed Core writer. The Core Staff lifecycle itself is *not* yet live.
- **Four-source closed-day snapshot**: SQL candidate `20261017040000_vox_ab3_closed_day_source_snapshot_candidate.sql` only under `ops/vox/sql-candidates/`, depends on existing uninstalled F1 source tables, verifies exact event count and deterministic SHA256 checksum against current actor/team/city closed IST day and matching F1 watermark. Inserts immutable read-only source snapshot (no official EOD approval). PostgreSQL trigger checks **checksum**, but the F1 opaque watermark signature itself must also be independently cryptographically verified outside SQL.
- **Pinned, genuine Ed25519 source signature preflight**: `ab3SignedEodReadiness.mjs` verifies four distinct signed source manifests against four protected keys and actual current Core object-grant/DB source callback; still `official:false`, and requires independent TL AAL2 and final Core atomic transaction.
- **Scoped PostgreSQL synthetic benchmark**: `benchmark-voxAB3-scoped-queue-pg17.ps1` generates 100,000 synthetic work rows and executes a single actor/team/city/source filtered query with 25-row bound. Results stored at `D:\QuickFurno-Workspace\VOX-AB3-SYNTHETIC-PG17-BENCHMARK-20261017.json`. Query planner execution time ≠ end-to-end VOX Core/Web p95 and does not certify staging throughput.

## Local QA
- Core new protected route 6/6 source tests PASS; full combined Core suite and TS/build to verify on exact final branch.
- Staff SQL in disposable `postgres:17-alpine --network none`: pending review insert, duplicate nonce, self reviewer, non-TL, invalid department pack, Auth/anon access denied, second decision denied, immutable requests/decisions, forced RLS and narrow grants **PASS**.
- EOD SQL in disposable `postgres:17-alpine --network none`: four exact source snapshots, duplicate and forged count/missing watermark, Auth/anon denial, immutable records and forced RLS **PASS**.
- Four-signature Ed25519 EOD review test 4/4 PASS.
- Synthetic benchmark 100,000 rows, 25-row response, PostgreSQL reported p50/p95 **0.068/0.079 ms** in the observed disposable dataset; no claim of live system speed.

## Known remaining engineering and human release gates
Genuine Staff invitations/activation/Auth session revocation; source-specific transactional native mutations and Staff actor attribution; proper four-sealed-source watermark writer with official EOD submission/independent TL ACK; real Core/Jarvis private HTTPS signed transport with durable DB nonce/consent; complete signed keyset DB pagination, staff queues and workload SLAs; Core/Aarohi/Vendor 360/Riya full authorized UI integration and staging load benchmarks.

Human independent DBA/AppSec reviewers, 86-migration ledger reconciliation/rollback, first Team Leader approved bootstrap, verified Staff AAL2, approved Core seven VOX migrations plus AGNI 0008 in protected staging only, signed artifacts and Owner GO/NO-GO remain pending. **Do NOT merge, install candidate SQL in managed Supabase, activate public `vox.quickfurno.in`, or send providers until release approval.**
