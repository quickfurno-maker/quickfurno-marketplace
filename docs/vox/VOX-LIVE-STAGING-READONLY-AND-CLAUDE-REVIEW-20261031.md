# VOX — Verified managed Staging read-only inventory and second-AI corrections
Date: 2026-10-31. Draft PR #450. Decision: **HOLD**, no managed schema mutation or protected deployment.

## Provenance
Read-only Supabase connector connected to the named **QuickFurno Staging** project, not the QuickFurno Production project; the SQL used explicit `BEGIN READ ONLY` and `ROLLBACK`. Only aggregate counts and PostgreSQL catalog privileges were inspected. No identity rows, credentials, private customer data, backup contents or production services were requested.

### Actual current managed Staging (connector-verified)
- PostgreSQL 17.6 family; **86** recorded applied migrations, latest `20261013144901`.
- **0** `public.vox_%` tables, **0** VOX RLS policies; canonical `vox_staff_memberships_v1` absent.
- **142/142 public tables have RLS enabled**, with 73 catalog policies.
- Auth MFA: exactly **1 verified factor / 1 distinct verified principal** (aggregate only).
- `auth`, `storage`, `vault`, `supabase_migrations` schemas present; Vault extension present.
- `vendor_package_orders` exists. These observations do NOT establish that the Finance V2 candidate is deployed.

### Current security advisor observations requiring human classification
- ERROR: `public.vendor_public_v` is an owner-rights/SECURITY DEFINER view; `anon` and `authenticated` can SELECT it.
- WARN: `public.is_admin()` and `public.owns_vendor(p_vendor_id uuid)` are SECURITY DEFINER functions executable by `authenticated`; not by `anon` in the read-only privilege check.
- INFO: 102 RLS tables have no policies. Absence of policies with RLS enabled defaults deny, and is not automatically a data leak.
- **Important context**: the source migration `20260723000600_qf_mvp_public_projection_privilege_hardening.sql` explicitly documents the owner-rights vendor projection as intentional: allowlisted columns + deterministic vendor visibility predicates, while base-table direct grants are revoked. Thus the advisor's view warning is an *exception for qualified AppSec to confirm*, not permission to switch `security_invoker` on or revoke public visibility blindly. The two helper functions are old policy dependencies and must be reviewed in the same RLS/grants context.

## Claude second-AI code review (not an independent human attestation)
Claude Code 2.1.312, authenticated on the JARVIS machine, reviewed five specified source files in read-only plan mode. Claude identified commit-time Staff/TL grant binding, client reviewer TTL, source migration hash enforcement and EOD membership/clock boundaries. No personal or managed database data was provided to Claude beyond aggregate staging status.

The consolidated source candidate has now been corrected and validated:
1. Core final grant lookup binds the original `scope.id`, `cap.id`, same-team TL, request/team/city and reviewed revision.
2. Core client binding final check verifies the independently reviewed TL team and unexpired membership.
3. RC22 migration handoff enforces exact expected 162 migration files, source aggregate SHA256 and historic V1/V2 file SHA256, and rejects duplicate 14-digit migration versions.
4. Pending signed-EOD writer rechecks actual PG Team Leader **and Staff subject** membership TTL immediately before COMMIT and rejects expiration with full rollback; production wrapper overrides caller time with host wall clock.
5. Native Core writer's test-only unbranded Staff AAL2 structure, D2-D consent insertion/deactivation serialization, designated reviewed privileged DB roles and signed official publication remain explicit unmet production dependencies. The production Core entry remains HARD-OFF.

## Non-interchangeable engineering evidence
- Source migration inventory is **162 repo SQL files** with pinned aggregate digest. This MUST NOT be interpreted as '76 safe migrations to run' merely by subtracting the 86 managed ledger rows. Histories have different baselines and require *version/name and function-level* reconciliation with a qualified DBA.
- Historical Razorpay V1 parser and initial NULL-claim defects persist. V2 authority remains **REVIEW ONLY / UNINSTALLED**.
- A 27-Oct five-schema backup was tested offline against disposable Supabase-compatible PG17, but is not current full managed Auth/Storage/Vault/roles/ACL/physical-object/PITR recovery certification.
- The separate seven-migration disposable PG17 restore is synthetic and does not satisfy managed backup recovery.
- Source tests and local GoTrue MFA tests are not genuine Owner/TL MFA enrollment in Staging.

## Launch gates / stop conditions
1. Qualified independent DBA/AppSec: sign named decisions on V1 migration history/parser repair; schema, rights and owner ACL parity; `vendor_public_v` exception; helper functions; Staff RLS and direct privileged DML; offline-to-managed restore, physical storage/PITR and rollback.
2. Approved protected Staging migration/install plan (not blanket `db push --include-all`); preserve backups and immutable source provenance; inspect post-migration policies and real Auth.
3. Actual Owner and different Team Leader enrolled with real AAL2; server-enrolled signers and independent dual signoff.
4. Fully functional protected Staging acceptance: Vendor360, Staff, CRM, Service Desk, Finance read and non-financial transactions, signed EOD, recovery, negative/IDOR tests and authorized activation.
5. Actual provider-side payment settlement/webhook/refund/consumed-credit reconciliation and human policy approvals before money actions.
6. Explicit Owner production GO plus human independent security and recovery signoff. **Draft PR #450 not merged; managed Staging and Production HOLD.**

No bypass, no provider messaging, no payments/refunds/credits, no human MFA or signing has been activated.

## Exact current migration ledger reconciliation (live read-only)
A version-by-version comparison of the managed Staging `list_migrations` response against the **162** exact SQL files in the consolidated Draft PR worktree produced **55 shared versions, 31 Staging-only versions and 107 source-only versions**. All 55 shared version labels also matched source filenames by normalized name. The complete filename-level discrepancy and shared-version evidence is saved, without user records, in `docs/vox/VOX-MANAGED-STAGING-MIGRATION-DRIFT-READONLY-20261031.json`.
This confirms material lineage divergence; **do not subtract 86 from 162, repair migration history, or run unreviewed `db push --include-all`**. A qualified DBA must classify the 31 and 107 entries, including source baseline versions, with live source-digest, role and dependency evidence before any installation.
