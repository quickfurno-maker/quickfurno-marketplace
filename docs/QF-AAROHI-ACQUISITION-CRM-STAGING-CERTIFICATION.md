# QF Aarohi Acquisition CRM — Staging Certification

Date: 2026-09-17
Status: `STAGING_APPLIED_VERIFIED_PRODUCTION_UNTOUCHED`

## Certified source

- Branch: `feat/aarohi-acquisition-crm`
- Migration: `20260917000000_aarohi_acquisition_crm_foundation.sql`
- Canonical SHA-256: `43a68f3c262d4a8c842138703002d630e6e10c4c3cb4e0c8275090e7bb3f8c5d`
- Source phase: `QF-AAROHI-ACQUISITION-CRM`
- Application workspace: `Desktop\qf-aarohi-staging-apply-20260917`
- The application workspace is not a Git repository and contains no seed file.

## Target proof

The external workspace was linked only to the governed QuickFurno staging project. Its linked project ref matched the staging ref in the staging-history manifest and did not match the production ref.

Before application, `supabase migration list --linked` returned:

- local migrations: **41**
- remote migrations: **40**
- pending migrations: **1**
- sole pending version: **`20260917000000`**
- remote-only versions: **0**

The workspace contained the exact 40 versions already present in staging plus the Aarohi migration, and no other pending QuickFurno authority.
## Exact-one dry run and application

`npx supabase db push --linked --dry-run` exited 0 and proposed exactly:

`20260917000000_aarohi_acquisition_crm_foundation.sql`

No `--include-all`, `--include-seed`, `migration repair`, `migration up`, `db reset`, hand-executed SQL, or production link was used for the staging application.

`npx supabase db push --linked` was then executed once. The CLI applied exactly the Aarohi migration and exited 0.

The independent post-apply migration re-list returned:

- local migrations: **41**
- remote migrations: **41**
- pending migrations: **0**
- `20260917000000`: **present in staging migration history**

## Live staging schema verification

A read-only `supabase db dump --linked --schema public` after application confirmed all **13** Aarohi tables and all **4** governed Aarohi RPCs are present in staging. The dump contained the Aarohi schema and was used only as verification evidence; no data dump or mutation was performed.
## Production boundary

Production was inspected separately through a read-only external workspace. No production migration or data write was performed.

Production verification established:

- `20260917000000` is **absent** from production migration history.
- A read-only production `public` schema dump contains **no Aarohi tables or Aarohi RPCs**.
- A fresh direct Data API probe using the canonical production `.env.local` returned `PGRST205` for `aarohi_prospects`, while a known canonical table remained readable.

Therefore this certification makes **no production-application claim**. Production remains behind its own future deployment gate.

## Scope boundary

This certification completes the QuickFurno-side Aarohi CRM staging foundation only. It does not activate Jarvis, does not enable outbound communication, does not create vendors directly, does not create payment/package authority, and does not grant provider execution authority.

Evidence marker: `QF_AAROHI_ACQUISITION_CRM_S1_STAGING_MIGRATION_APPLIED_AND_VERIFIED`