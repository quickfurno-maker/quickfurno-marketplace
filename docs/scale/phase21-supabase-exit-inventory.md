# Phase 21 Exit Inventory — Phase 20 Design Record

Status: inventory-only prerequisite for Phase 21. This does **not** claim a Supabase exit rehearsal.

## Live QuickFurno Supabase inventory — 2026-10-06

Project: `yqpgcsduqbxulrlzwzap` (QuickFurno), PostgreSQL 17.

- Public tables: **139**
- Public views: **1**
- Public RLS policies: **75**
- Public functions/RPC surface: **181**
- Auth users: **9**
- Storage buckets: **1**
- Storage objects at sample time: **0**
- Edge Functions: **0**
- Realtime publication: `supabase_realtime` contains:
  - `public.communication_inbound_messages`
  - `public.communication_messages`

Installed extensions requiring portability classification:
- `postgis 3.3.7` — portable to standard PostgreSQL with PostGIS.
- `pgcrypto 1.3` — portable PostgreSQL contrib extension.
- `uuid-ossp 1.1` — portable PostgreSQL contrib extension.
- `pg_stat_statements 1.11` — operational extension; portable when provider permits.
- `supabase_vault 0.3.1` — **provider-specific**, must be replaced or proven unused before exit.
- `plpgsql 1.0` — core PostgreSQL language.

Storage:
- Bucket `vendor-media`: public, 8 MiB limit, JPEG/PNG/WebP allowlist.
- Phase 21 must export/import objects through the object-storage adapter and re-create bucket policy/config independently of database restore.

## Provider-coupled surfaces

1. **Database / Data API / PostgREST**
   - PostgreSQL is authoritative business truth.
   - Repository migrations are the schema authority.
   - The application uses Supabase Data API and a large server-side RPC surface. Phase 21 must generate an exact RPC call-site manifest and classify every RPC as portable SQL, provider API dependency, or removable legacy surface.

2. **Auth**
   - Current sessions/users are Supabase Auth identities.
   - Business records currently contain Supabase UUID references in existing domains.
   - Phase 22 owns the stable internal-principal mapping and provider adapter; Phase 21 only inventories export/import and token/session limitations.

3. **Storage**
   - `vendor-media` is the only live bucket at the sample point.
   - Database PITR does not restore Storage objects; Phase 17 already treats object recovery as an independent domain.

4. **Realtime**
   - Two communication tables are published.
   - A replacement may use PostgreSQL logical replication, WebSocket/event gateway, managed pub/sub, or another provider, but business correctness must continue to come from durable database state.

5. **Vault**
   - `supabase_vault` is installed and is provider-specific.
   - Phase 21 must prove whether application migrations/runtime actually depend on Vault contents; plaintext-secret export is forbidden.

6. **Project configuration not represented solely in SQL**
   - Auth provider/password/session settings.
   - Data API exposed-schema/grant configuration.
   - Realtime publication/service settings.
   - Storage bucket settings.
   - Database/pooler settings, backups/PITR and network restrictions.
   - API keys/JWT signing configuration.

## Exit-pack deliverables for Phase 21

- Version-controlled schema + migration chain verified against live migration history.
- Logical `pg_dump`/restore into disposable vanilla PostgreSQL/PostGIS.
- RPC/PostgREST call-site manifest and replacement strategy.
- Extension portability matrix and Vault disposition.
- Storage object export/import + checksum manifest.
- Realtime publication replacement contract.
- Auth user/principal export mapping and session invalidation plan.
- RLS/grant/policy portability test suite.
- Non-SQL Supabase project configuration inventory.
- Disposable non-Supabase smoke suite covering matching, credits, assignments, consent, payments and worker claims.

## Phase 20 conclusion

The exit **inventory exists** and is sufficient to start Phase 21, but Phase 21 remains a future growth phase until the disposable non-Supabase restore + smoke exit gate actually passes.
