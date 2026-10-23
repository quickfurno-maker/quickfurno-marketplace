# Step 3B-2 + 3B-3 — Fresh Offline Staging Restore and Internal AppSec Review

**Evidence dated:** 2026-10-23 · **Source:** QuickFurno STAGING (`uckafzuochmbvtiodmcl`) + JARVIS private local file, absolutely no managed writes · **Release:** **HOLD**.

## Track A — Fresh restore result: bounded 4-schema recovery PASS

**Fresh original managed Staging archive** captured 2026-10-22 16:25:54 UTC via native PostgreSQL 17.10 `pg_dump -Fc --no-owner --no-acl` on authorized JARVIS, source schemas `public`, `auth`, `storage`, `supabase_migrations`.

- **Archive:** `staging-public-auth-storage-migrationhistory-step3b2-20261022.dump` (private JARVIS directory; **never commit the archive**).
- **Size:** 2,010,560 bytes. Host/manifest/disposable container SHA256 **`E303BC25D904899459C56493F7D67B1960056DA4F4EAF78905B4F2F50AF75753`**; `pg_restore --list` validated archive TOC.
- **Restore execution:** disposable container `public.ecr.aws/supabase/postgres:17.6.1.147`, `--network none`, no published ports, fresh database `qf_step3b2_disposable_restored`. Initialized Supabase-dependent local extensions using existing offline restore prerequisites. `pg_restore --exit-on-error --single-transaction --no-owner --no-acl` **exit 0**. Scratch container **stopped and removed**. This did not use the cloud Staging DB endpoint for any writes.
- **Restored structural inventory matches first-party Staging SELECT-only inventory:** 86 migrations, 2 Auth users, 2 profiles, 27 vendors, 7 leads, 178 base tables, 166 RLS-enabled tables, 74 policies, 212 functions, 75 non-internal triggers, 272 foreign keys and 0 unvalidated foreign keys. All 4 Phase22 tables remain absent as expected before rollout.
- **Exact catalog fingerprint matches (restored/live):** migration versions and names **`16f601bdd81762584c541b707c9446ef`** (84 distinct migration names); SQL RLS policy definitions **`c9f988a3a64b83fb11d745f80333af88`**; trigger bindings **`b0ba2c6649e816f917e7827717c327f9`**; FK constraints/definitions **`d1e326e7468b80e11203b05159062dc4`**.
- Private evidence certificate on JARVIS `%USERPROFILE%\QuickFurno-VL05-Predelete-Backup-20261013\staging\step3b2-20261023-fresh-offline-restore-verification.json`, local certificate SHA256 **`03A35627262E5386234FB8C537D9554A38A9EEB5D8265327719A72F3FD3CDA95`**. Separate public-safe summary `ops/vox/certification/STEP3B2-3B3-FRESH-RESTORE-SECURITY-EVIDENCE-20261023.json` (no data rows/credentials).
- **Scope limitation:** This is a **bounded four-schema logical restore** with no independent human DBA signature. It does **not** test PostgreSQL global roles/owners/ACL replay, point-in-time recovery, associated object-storage binaries, email/provider secrets, complete Auth login functionality, or row-by-row table contents. Exact shape/count/fingerprint tests passed; historical data operations can still need independent review. The container image tag was not pinned to an immutable digest. All managed database migrations are unchanged.

## Track B — Internal AppSec/DBA evidence and decisions

**Live managed Staging preflight** (first-party read-only, 2026-10-23):
- Phase22 migration source `supabase/migrations/20261006113720_phase22_identity_portability.sql`, SHA256 `6F53E1781E4D2BD277645ED17B2EB635BE70F1D2C4DF7525CD176DFB0C2F28BA`. Not in Staging history; 4 identity tables absent; existing protected Core dependencies, profiles/client_accounts/vendor_dashboard_users tables and Auth onboarding trigger present.
- **P0 legacy Superadmin backfill / replacement risk:** One existing legacy placeholder account meets the migration's `raw_app_meta_data.admin_role` plus `profiles.role` criteria. Phase22 as written imports that privileged account. The real `quickfurno@gmail.com` remains neutral and has no verified MFA. A separate approved revocation-and-Owner-bootstrap plan, with tested login/session invalidation and rollback, is **mandatory**. Running current `scripts/grant-superadmin.mjs` prior to safe identity migration could leave partial grants. Do not change Auth by direct SQL.
- **Pre-existing Supabase security advisor findings:** 1 `security_definer_view` ERROR, 2 `authenticated_security_definer_function_executable` WARN, 102 `rls_enabled_no_policy` INFO. Underlying read-only verification: `public.vendor_public_v` uses default security-definer semantics (no `security_invoker` relation option) and is SELECT-granted to `anon` and `authenticated`. Projection includes public business properties, covers only approved/active/publicly visible/credit-positive vendors. Intended public exposure needs business/AppSec confirmation; do not automatically revoke to avoid breaking marketplace.
- `public.is_admin()` and `public.owns_vendor(uuid)` are SECURITY DEFINER, executable by `authenticated` but not `anon`, with `search_path=public`. These are pre-existing RPC surfaces and must be independently reviewed for parameter handling, privilege boundaries and their RLS dependency (no blind revoke).
- Phase22 source enables RLS and denies `public`, `anon` and `authenticated` table rights on all four identity tables while granting restricted `service_role`; its isolated PostgreSQL17 migrations and repeat application passed previous Step3A tests; contract 19/19 PASS. This is **not** evidence of safe managed promotion without role/ACL and existing default-privilege catalog audit.
- Seven quarantined Oct14 VOX SQL versions remain absent from runnable tree and both managed ledgers, all 7 SHA pins matched (3B-1), do not unquarantine or repair ledger. Both environments have 86 migrations but only 34 versions in common; semantic equivalence still not proven. No other DDL or money flows authorized.
- Existing private PowerShell Staging backup script may be retained for future backup; do not submit Staging database password, Supabase recovery links, archive bytes, sessions or Auth hashes to PR/Notion/ChatGPT.

## Approval checklist (explicit HOLD)

- [x] Fresh Staging logical archive checksum independently verified.
- [x] Actual **fresh** archive restored successfully in isolated PostgreSQL 17, with structural and definition fingerprints matched to first-party live Staging; scratch container removed.
- [x] Internal source/Phase22 and AppSec exposure review evidence recorded.
- [ ] Genuine independent DBA verifies rollback/restore beyond the bounded four-schema scope, historical migration reconciliation and source hash; approves managed Staging migration path.
- [ ] Independent AppSec resolves the legacy Superadmin transition and identified SECURITY DEFINER surface risks.
- [ ] Owner gives explicit narrowly scoped **Staging-only** approval after signoffs.
- [ ] Apply precisely reviewed Phase22 migration to Staging with rollback gate, verify RLS/identity mapping and Auth behavior under signed deployment procedures.
- [ ] Independently approved Owner authorization then real MFA AAL2 and Team Leader bootstrap.
- [ ] Finance/Razorpay TEST certification and production release gate; **do not promote now**.

**Verdict:** Track A **bounded offline restore PASS**. Track B **internal security evidence completed, independent review OPEN**. Live Staging and Production databases unchanged, Finance release **HOLD**.
