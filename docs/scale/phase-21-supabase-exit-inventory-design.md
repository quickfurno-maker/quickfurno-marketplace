# Phase 21 Design Input — Supabase Exit Inventory

This document satisfies the Phase 20 requirement that a concrete Supabase-exit inventory exists. It does **not** mark Phase 21 complete and performs no provider migration.

## Live inventory snapshot — 2026-10-06

### QuickFurno
- Managed migration head: `20261003093648 aarohi_phase2_ops_fk_indexes`.
- Public functions: 181.
- SECURITY DEFINER public functions: 136.
- Installed extensions:
  - `pg_stat_statements 1.11`
  - `pgcrypto 1.3`
  - `plpgsql 1.0`
  - `postgis 3.3.7`
  - `supabase_vault 0.3.1`
  - `uuid-ossp 1.1`
- Storage:
  - bucket `vendor-media`, public, 8 MiB file limit, 3 allowed MIME types;
  - live object count at snapshot: 0.
- Realtime publication `supabase_realtime`:
  - `public.communication_inbound_messages`
  - `public.communication_messages`
- Public-schema direct FK couplings to `auth.users`:
  - `client_accounts.user_id`
  - `password_reset_grants.user_id`
  - `profiles.id`
  - `vendor_dashboard_users.user_id`
  - `verification_challenges.user_id`

### Jarvis
- Managed project uses the repository-owned `qf_jarvis.schema_migration` ledger.
- Live observed head: version 1 / `0001_event_log.sql`.
- Installed provider-visible extensions:
  - `pg_stat_statements 1.11`
  - `pgcrypto 1.3`
  - `plpgsql 1.0`
  - `supabase_vault 0.3.1`
  - `uuid-ossp 1.1`
- Jarvis application architecture already uses direct PostgreSQL/session semantics rather than depending on PostgREST for the event backbone.

## Portability classification
### Portable with normal PostgreSQL support
- core relational tables, indexes, constraints, triggers
- `pgcrypto`, `uuid-ossp`
- PostgreSQL functions/policies after target-specific privilege review
- Jarvis event ledger and durable queues

### Requires target capability
- PostGIS 3.x
- pg_stat_statements or equivalent observability

### Supabase-specific adapter/replacement required
- Supabase Auth / `auth.users`
- Storage API + `storage.*`
- Realtime publication/client integration
- PostgREST/Data API client calls
- `supabase_vault`
- Supabase project/Auth configuration and managed PITR controls

## Phase 21 execution pack to build later
1. versioned schema-only dump with owner/privilege normalization;
2. full logical data export and restore to disposable vanilla PostgreSQL + PostGIS;
3. extension compatibility matrix with provider-specific replacements;
4. machine-generated RPC/function inventory with callers and execution grants;
5. PostgREST/Data API call inventory and replacement interface;
6. Storage bucket/object metadata export plus content-addressed object copy/verification;
7. Realtime publication/subscriber inventory and replacement event path;
8. Auth user/identity export plan, password-hash portability limitations, MFA/session/recovery constraints;
9. RLS/authorization portability test suite;
10. project configuration inventory;
11. source/target row-count + checksum reconciliation;
12. reversible shadow/cutover plan.

## Exit trigger
Phase 21 activates when Supabase becomes a material availability, cost, scaling, compliance or portability constraint. It is not a launch dependency.
