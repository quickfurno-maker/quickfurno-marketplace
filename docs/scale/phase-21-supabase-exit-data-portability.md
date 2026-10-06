# Phase 21 — Supabase Exit & Data Portability Pack

Status: IMPLEMENTED / certification gate pending merge

Phase 21 makes the current Supabase dependency reversible without moving production traffic or data.

## Certified source inventory

QuickFurno production remains on Supabase PostgreSQL 17. The live non-secret snapshot records 139 public tables, 1 public view, 75 RLS policies, 181 public functions, 9 Auth users, one empty `vendor-media` bucket, no Edge Functions, two Realtime-published communication tables and zero public runtime Vault references.

The production migration ledger is captured separately from repository migration filenames. The repository migration chain is a reconstruction source; exact filename/version equality is deliberately not inferred because production contains environment-specific baseline entries.

## Portability pack

- canonical cross-repo contract: `qfj.phase21.supabase-exit.v1`
- live catalog fingerprints and production migration history
- deterministic runtime Supabase call-site manifest
- SQL portability classifier across every repository migration
- supported managed export runner using pinned Supabase CLI 2.119.0
- separate roles / schema / COPY-data dump artifacts with SHA-256 manifest
- explicit Auth, Storage, Realtime, Vault and Data API dispositions
- plain PostgreSQL compatibility certification for idempotent credits/assignments, consent append-only behavior, payment idempotency, distributed worker claims and RLS primitives

## Security / data handling

Production dump files contain private data and are forbidden from Git. No production credential is stored in the repository. No production table is changed by this phase. The private export runner requires an operator-supplied database URL only at execution time.

Existing Phase 20 accepted advisor findings remain unchanged: `vendor_public_v`, `is_admin()` and `owns_vendor(uuid)`. The leaked-password-protection warning remains absent.

## Provider dispositions

PostgreSQL remains the durable authority. PostgREST/Data API access is treated as a replaceable persistence/API boundary. Storage moves through an object-storage adapter with per-object SHA-256 verification. Realtime is replaceable by the durable database plus a provider-neutral event gateway. Supabase Auth is not rewritten in Phase 21; Phase 22 introduces stable internal principals and a provider adapter, with session invalidation/re-authentication on a provider cutover.

## Exit condition

Phase 21 is complete when the three repositories carry the same contract bytes, QuickFurno and Jarvis gates pass on disposable PostgreSQL 17, the supply-chain gates are green after merge, and the roadmap evidence is recorded. There is no production cutover, no production DB migration, no AWS/Kubernetes dependency and no AGNI authority expansion.
