# VOX AB-7L — Archived real Staging schema parity and 30-source candidate compatibility

**Status:** Source-level / offline verification PASS. **Release HOLD.** No managed Staging or production SQL/Auth/AI/provider/VPS actions were taken.

## Evidence and scope

- Certified base: [AB-7K draft PR #379](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/379), exact SHA `7c7508a020720fd5b92b46ea2fab991d263c8d99`.
- Archive: QuickFurno Staging snapshot from **2026-10-16**, `public, auth, storage, supabase_migrations`; existing four-schema restore certificate, SHA-256 **`D88176856CDBEDE5FD31216E6217A388D64A95D137C728A0CB0DE0A605BDE71E`**. Original archive is on authorized JARVIS computer only; **not uploaded, not in Git**, and no password or URL was accessed.
- Script: `scripts/mvp/vox/validate-voxAB7L-archived-staging-schema-pg17.ps1`, takes `-ArchivePath` on authorized local machine. Uses immutable Supabase PG17 Docker image `public.ecr.aws/supabase/postgres@sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518`, `--network none` with no published ports. `pg_restore --schema-only --no-owner --no-acl --exit-on-error` on a **disposable database**. Verifies zero restored Auth users, Aarohi prospects or VOX tables before installing candidates, and deletes container on exit. This is a **structural/functional-schema** test, not a data backup restoration.
- Current QuickFurno Staging was separately queried **read-only 2026-10-20**. The archive's restored baseline matches **exact counts and digests** of current Staging schema:

| Object definitions, four restored schemas | Count | MD5 over canonical ordered metadata |
|---|---:|---|
| Columns (type, nullability, default) | 2,441 | `9353af8b65889b2a4ba5823e2d821a5d` |
| Functions (identity and pg_get_functiondef) | 212 | `55c5ab92e50a8d5426c45b1b873a22a8` |
| Non-internal triggers | 75 | `5f45a978554dd40104eb1cf16f1960a3` |
| Indexes | 708 | `a948e7608a8aea7ec3dbdb80b7a17e6a` |
| Constraints | 1,103 | `2426ec853fd70573f6be691feb9c0f3a` |
| RLS policy definitions | 74 | `1074f4271259203defff256380386a42` |

- Against the restored **real Staging schema-only baseline** the full sequence of **7 quarantined foundational + 23 uninstalled VOX candidate source SQL** files applied **30/30 PASS**. After installation: **39/39 VOX tables ENABLE and FORCE RLS**, no `anon` or `authenticated` direct VOX table DML privileges, no anonymous `qf_vox_*` SECURITY DEFINER EXECUTE; only the two AAL2-gated, independently scoped Owner/TL human approval proposal/confirmation RPCs are available to `authenticated`. There are zero restored customer records.
- **CI** can test this script's security invariants, but cannot run the real Staging archive test because the local archive must never be uploaded to Actions. Re-run on JARVIS for any source, archive or current Staging changes. It fails closed if the archive hash, schema definitions, SQL file count, row absence or resulting RLS/grants drift.

## Remaining launch-gated work (do NOT mark as complete)

This verifies schema/DDL compatibility as of the 16 Oct archive *and* current 20 Oct structural parity, **not** full managed Staging tenancy, data, function ACL/grant parity or extension ownership (restore explicitly omits owner and ACL), nor migration-history reconciliation. Staging itself still has **zero installed VOX public tables, one Auth user, zero verified MFA**, and the 31 Staging-only vs 107 repo-only migration version aliases still require independent DBA semantic mapping. No genuine Team Leader AAL2, independent external DBA/AppSec/Cursor review, signed rollback/first TL bootstrap, real signed multi-service staging deployment, user-authenticated Core/Jarvis/VOX/AGNI E2E, worker scheduler nor Owner GO have been completed. No provider sends were made.

**All PRs remain DRAFT/UNMERGED. RELEASE HOLD.**
