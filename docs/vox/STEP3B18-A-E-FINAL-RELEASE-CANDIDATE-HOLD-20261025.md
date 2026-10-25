# QuickFurno Phase 3B-18 — A–E internal cleanup release candidate

**25 October 2026 • Controlled source-only candidate • Protected managed Staging and Production remain HOLD.** This is a reviewer packet and offline evidence package, **NOT** an authorized Production purge, managed database migration, Auth change, merchant payment action, or live marketplace activation.

Previous stacked source candidates: [draft #412](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/412), [draft #411](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/411), and #410. Critical approval issue [#413](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/413). Phase 3B-17 exact-head CI **5/5 PASS**; current 3B-18 GitHub exact-head CI should be reported separately once its commit is pushed.

## Scope and preservation commitments
Owner requested eventual deletion of **all 29 TEST vendors** (Pune 27, Mumbai 2), **all 74 TEST leads** and their test-only child operational records. The goal does not authorize deleting genuine accounts or changing QuickFurno immutable credit/assignment audit safeguards. Latest SELECT-only Production check still shows 29 vendors, 74 leads, 71 assignments, 73 immutable assignment events, ten Auth users total, eight test-vendor-linked Auth sessions, zero Storage object rows. Production has PostGIS **3.3.7**, Supabase Vault **0.3.1**, pgcrypto 1.3, uuid-ossp 1.1, pg_stat_statements 1.11, and plpgsql 1.0.

### 3B-18A — Immutable evidence custody
Verified source/Production trigger `qf_prevent_lead_assignment_event_mutation()` refuses event DELETE for every role, and `qf_prevent_lead_assignment_event_truncate()` refuses TRUNCATE. The protected lead/vendor FKs remain RESTRICT for 73 events. Only nullable assignment/operation *back-references* can be cleared without changing lineage. No exceptional purge mechanism has been approved, coded or applied.

**Review-required true-deletion design:** identify TEST-only UUIDs in a confidential encrypted off-repository allowlist; freeze original event IDs, timestamps, source attribution, related credit/assignment facts, canonical serialized row hash and backed-up archive SHA; create a separately governed immutable evidentiary archive with independent integrity attestation, tamper-evident custody, explicit retention period, access logging, rollback/recovery tests and retention/legal/security authorization. A *design* or copy of hash metadata does not prove original event custody or permit breaking the existing trigger. External DBA/AppSec and Owner must separately approve the proposed immutable-history disposition; only then may a separately reviewed migration be designed. **No trigger/FK bypass in this branch.**

### 3B-18B — Backup and full-recovery gap analysis
Validated real JARVIS archive `C:\Users\KESHAV SHARMA\QuickFurno-VL05-Predelete-Backup-20261013\production\all-test-data-purge-20261024\quickfurno-production-prealltestpurge-20261024.dump` is 4,879,114 bytes, SHA256 `5EEAEC9949485E839126285EE2FF29E67363404BF8ABCDF063D9848A0161E797`. Custom-format PostgreSQL17 logical export covers public/auth/storage/supabase_migrations, **not** complete physical data, global roles/ACL/PITR, actual Storage binaries or all extension-managed schemas.

New read-only `scripts/scale/step3b18-local-backup-audit.py` checks real local archive, environment and manifest, SHA, `pg_restore --list`, private 21-table restore evidence counts and orphan checks, exact nine vendor-linked Auth users/eight sessions. Locally **PASS**: 21 selected affected tables reconstructed in prior disposable PG17 recovery probe. Outputs **full_supabase_restore_certified=false** and **production_deletion_authorized=false**.

P0 still needs an independently verified *genuine Supabase-compatible* extension-capable restore with PostGIS 3.3.7, Vault 0.3.1, full FKs/triggers/RLS, roles/ACLs, Auth service lifecycle, PITR rollback and Storage object binary recovery. JARVIS's data-only scratch deliberately normalized extension-specific geography and an Auth enum; its pass must not be upgraded to full certification.

### 3B-18C — Protected Auth lifecycle and identity isolation
Production read-only audit: ten Auth users, **nine TEST-vendor-linked** Auth users, nine identities, eight sessions and nine profiles; **one nonvendor Auth user** to protect. A separate sweep counted all **39 public user-reference columns** with UUID/text author/owner/user names; the only nonzero test-vendor Auth ID references were `vendors.user_id` = 9 and `vendor_dashboard_users.user_id` = 8. This sweep does *not* prove that external providers, unstructured JSON, private schemas or runtime tokens contain no references.

New SELECT-only `ops/vox/sql-review/STEP3B18C-AUTH-AND-IMMUTABLE-READ_ONLY.sql` inventories grouped record counts, live triggers/functions, extension versions and auth-reference columns without listing identities, emails or sensitive IDs.

**Future Auth Admin protocol (no actions taken):** verify allowlist by source-backed identity and exclude Owner/nonvendor credentials; audit cross-application dependencies; suspend/restrict sign-in and outbound assignments via authorized supported controls; revoke/expire all relevant refresh sessions and account tokens, account for nonrevoked JWT lifetime and independently verify credential denial; only then use supported Supabase Auth Admin deletion APIs under approval and do Owner-login regression. Do not directly delete `auth.users` via SQL, expose service keys, or presume account deletion immediately revokes existing access tokens.

### 3B-18D — Trigger-aware exact-scope deletion rehearsal
`scripts/scale/step3b18-childfirst-negative-generate.mjs` derives real immutable-policy SQL from governed migration `20260723000500_qf_mvp_assignment_universal_enforcement.sql` via the prior 3B17 generator, then performs an offline synthetic **child-first** rehearsal: remove 36 simulated assignment operations and 71 assignment rows, confirm all event assignment backrefs were cleared, verify that linked vendor/lead DELETE still fails the immutable events' RESTRICT FKs, and confirm the 29 vendor/74 lead/73 event roots survived. **Local native PG17 PASS** and scratch cluster removed; CI network-none Docker PG17 runner `scripts/scale/step3b18-childfirst-negative-ci.sh` also provided.

This deliberately does *not* prove a full-schema deletion plan succeeds; a full real clone, legal retention approval, protected event archival and governed exception are mandatory before a successful clone purge rehearsal can be built. No direct Production deletion SQL included.

### 3B-18E — Continuous QA and release
- Local inherited Phase3B16 + 3B17 plus 3B18 evidence/contract gates **42/42 PASS**, no pending failures in the local run.
- Isolated local PG17 actual-trigger child-first refusal test **PASS**; local scratch stopped/wiped. Two independent offline CI runners now protect invariant behavior.
- Previous Phase3B17 exact-head GitHub **5/5 PASS**. Phase3B18 exact-head GitHub workflows require verification after source push.
- New `scripts/scale/step3b18-evidence-gates.mjs` is a pure advisory gate over A–E. Requires immutable evidence custody, verified complete recovery, Auth identity/session handling, exact UUID and JSON/opaque references, actual full-schema clone rehearsal, pinned reviewer source SHA, independent DBA/AppSec signoffs, and **separate final Owner approval**. All-green input still returns only `REQUIRES_SEPARATE_PRODUCTION_CHANGE`, never executable GO.

## Release decision and outstanding dependencies

| Domain | Verified internal proof | Remaining external/managed gate | Decision |
| --- | --- | --- | --- |
| A Immutable event custody | Actual trigger and 73 event links confirmed; design completed | Independent signed archive/retention/exception | HOLD |
| B Full recovery | Fresh archive SHA and 21-table data-only recovery checker PASS | Full extension/ACL/Auth/PITR/Storage clone restoration | HOLD |
| C Auth deprovision | 9 users/8 sessions + 39 public columns audited | Admin API revocation and Owner/nonvendor check | HOLD |
| D Production purge | Actual source trigger synthetic child-first PG17 negative PASS | Protected event exception + true full-schema positive rehearsal | HOLD |
| E Release QA | 42/42 local gates PASS; CI runner included | Exact-head PR CI + independent DBA/AppSec/Owner release authorizations | HOLD |

**Do not merge/deploy Production or managed Staging; do not delete, alter, truncate, disable triggers, change Auth or assign real leads, debit credits or send messages.** Protected VOX/Finance migration/RLS/MFA/Razorpay gates and public beta/onboarding remain independently HOLD. Launch only after all release gates genuinely pass. The reviewer and Owner decision remains tracked in [P0 issue #413](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/413).
